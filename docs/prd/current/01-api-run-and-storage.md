# PRD 01. API, Run Lifecycle And Storage

Status: current  
Last reviewed: 2026-07-22  
Owns: HTTP API, 인증, Run 상태, queue admission, SQLite schema와 retention

## Gate Review

[Critical Review]
Gate Status: ready_for_implementation

REST API는 비동기 Run을 만들지만 SQLite와 in-memory queue는 하나의 원자적
시스템이 아니다. P0는 admission permit과 저장·enqueue 순서를 고정하고, 중간
crash에서 orphan Run을 재개하지 않고 명시적 실패로 복구한다.

[Trade-off Analysis]

SQLite를 durable job queue처럼 polling하는 방식은 restart 복구에 강하지만 P0
범위를 키운다. 메모리에만 Run을 둔 방식은 빠르지만 accepted Run을 재조회할 수
없다. bounded in-process queue와 SQLite Run Store를 선택하고 crash window를
startup recovery와 terminal error로 드러낸다.

[Actionable Next Step]

API schema와 repository/queue contract test를 먼저 만들고 source/provider 호출을
붙이기 전에 모든 상태 전이와 crash point를 failure injection으로 고정한다.

## 공통 규칙

- JSON request body limit: 8 KiB
- 모든 timestamp: UTC RFC 3339, fixed millisecond format
  `YYYY-MM-DDTHH:mm:ss.SSSZ`
- Run/Evidence/Request ID: 충돌 검사를 거친 ULID 기반 `run_`, `ev_`, `req_` prefix
- 모든 `/v1` response: `Content-Type: application/json`
- 서버는 각 요청에 새 `request_id`를 만들고 response와 structured log에 포함한다.
- `problem`과 `requested_by`는 UTF-8 trim 후 길이를 계산한다.
- raw Authorization header, provider/source response, prompt는 API로 반환하지 않는다.

## Authentication And Input Pre-scan

`GET /healthz`를 제외한 모든 `/v1` 요청은 `Authorization: Bearer <token>`을
요구한다. token은 startup에 로드한 값과 timing-safe 비교한다. 누락·형식 오류·불일치
모두 동일한 `401 unauthorized`를 반환하며 body와 logs에 token이나 비교 결과를
넣지 않는다.

POST body의 `problem`과 `requested_by`는 Run 생성과 provider 전달 전에 PRD 03의
secret scan을 통과해야 한다. 탐지 시 `422 sensitive_input_rejected`를 반환하고
Run row, 원문, provider request를 만들지 않는다. `requested_by`는 표시용 label일
뿐 인증 identity가 아니다.

## Common Error Envelope

모든 API 오류는 다음 shape를 사용한다.

~~~json
{
  "error": {
    "code": "invalid_request",
    "message": "Request validation failed.",
    "request_id": "req_01J...",
    "run_id": null,
    "run_error_code": null
  }
}
~~~

`message`는 code별 server-owned 고정 문구다. validation library, SQLite, provider,
source의 원문 오류를 넣지 않는다. 모든 오류 response는 위 exact five-field
`error` object를 사용한다. `run_error_code`는 `code=run_failed`일 때만 해당 Run의
sanitized error code이고, 그 외에는 null이다.

| HTTP | code | Run row |
|---|---|---|
| 400 | `invalid_json`, `invalid_request`, `invalid_cursor` | 없음 |
| 401 | `unauthorized` | 없음 |
| 404 | `endpoint_not_found`, `run_not_found` | 없음 또는 변경 없음 |
| 409 | `report_not_ready`, `run_failed` | 기존 Run 참조 |
| 422 | `unsupported_scenario`, `sensitive_input_rejected` | 없음 |
| 413 | `payload_too_large` | 없음 |
| 415 | `unsupported_media_type` | 없음 |
| 429 | `queue_full` | 없음 |
| 503 | `storage_unavailable`, `queue_admission_failed`, `server_shutting_down` | 없거나 failed Run |
| 500 | `internal_error` | 가능한 경우 failed Run |

Fastify의 JSON parse error, body limit, content type, unknown route도 이 envelope로
변환한다. HTML/default error body와 validation library detail은 외부로 내보내지
않는다.

## HTTP API

### POST /v1/runs

Request:

~~~json
{
  "scenario": "backend_5xx_increase",
  "environment": "dev",
  "problem": "최근 10분 동안 AMDB Backend 5xx가 증가했다.",
  "requested_by": "operator-alias"
}
~~~

Validation:

- exact keys only; extra key는 `400 invalid_request`
- scenario: P0에서는 `backend_5xx_increase`만 허용
- environment: runtime에서 enable된 `dev` 또는 `prod`
- problem: 1-2000 Unicode characters
- requested_by: 1-100 Unicode characters
- body fields는 persistence 전에 secret scan
- queue admission permit이 없으면 `429 queue_full`, `Retry-After: 1`
- 성공은 queued Run commit과 in-memory queue publish가 모두 끝난 뒤의 `202`

Response:

~~~json
{
  "request_id": "req_01J...",
  "run_id": "run_01J...",
  "status": "queued"
}
~~~

P0는 idempotency key와 자동 deduplication을 지원하지 않는다. client retry는 새
Run을 만들 수 있다.

### GET /v1/runs/:runId

Response fields:

~~~json
{
  "request_id": "req_01J...",
  "run": {
    "run_id": "run_01J...",
    "scenario": "backend_5xx_increase",
    "environment": "dev",
    "problem": "최근 10분 동안 AMDB Backend 5xx가 증가했다.",
    "requested_by": "operator-alias",
    "status": "completed",
    "error_code": null,
    "tool_call_count": 3,
    "evidence_count": 3,
    "tool_error_count": 0,
    "report_status": "available",
    "created_at": "2026-07-22T00:00:00.000Z",
    "started_at": "2026-07-22T00:00:01.000Z",
    "ended_at": "2026-07-22T00:00:04.000Z"
  }
}
~~~

`problem`은 pre-scan을 통과해 저장된 normalized text다. raw Tool output, prompt,
provider response 전문, endpoint, credential은 반환하지 않는다.

### GET /v1/runs/:runId/evidence

queued, running, completed, failed Run에 현재까지 저장된 sanitized Evidence와
sanitized Tool Error를 반환한다. failed Run도 실패 전에 이미 검증·commit된 safe
artifact는 보존하고 조회할 수 있다. 아무 artifact도 없으면 두 array가 비어 있다.
Tool call 최대치는 PRD 02가 소유하며 P0에서는 pagination하지 않는다.

~~~json
{
  "request_id": "req_01J...",
  "run_id": "run_01J...",
  "evidence_schema_version": "1.1.0",
  "tool_error_schema_version": "1.0.0",
  "evidence": [],
  "tool_errors": []
}
~~~

array는 `tool_calls.call_index`, 그다음 record ID 오름차순이다. exact item shape는
PRD 03이 소유한다. raw source payload와 자유형 upstream error message는 포함하지
않는다.

### GET /v1/runs/:runId/report

완료된 Run은 다음 response를 반환한다.

~~~json
{
  "request_id": "req_01J...",
  "run_id": "run_01J...",
  "schema_version": "1.1.0",
  "report": {}
}
~~~

`report`만 PRD 03의 canonical 7-field object다.

- queued/running: `409 report_not_ready`
- failed: `409 run_failed`, envelope의 `run_id`와 `run_error_code` 포함
- 존재하지 않는 Run: `404 run_not_found`

### GET /v1/runs

- limit: default 20, integer 1-100
- cursor: 이전 page 마지막 `(created_at, id)`를 담은 versioned opaque base64url token
- filters: `environment=dev|prod`, `run_status=queued|running|completed|failed`,
  `report_status=absent|available`
- order: `created_at DESC, id DESC`
- cursor는 filter set과 결합한다. 다른 filter로 재사용하면 `400 invalid_cursor`다.

Response:

~~~json
{
  "request_id": "req_01J...",
  "items": [],
  "next_cursor": null
}
~~~

각 item은 `GET /v1/runs/:runId`의 `run` shape를 사용한다. keyset pagination에서
중복과 누락이 없어야 한다.

### GET /healthz

인증 없이 process와 SQLite 연결 가능 여부만 반환한다.

~~~json
{
  "status": "ok",
  "database": "ok"
}
~~~

provider, source endpoint, enabled environment, model, token, AMDB 내부 상태는
노출하지 않는다. DB가 연결되지 않으면 `503`과 `status=degraded`를 반환한다.

## Run Lifecycle

Run status:

~~~text
queued | running | completed | failed
~~~

허용 전이:

~~~text
queued -> running -> completed
queued -> failed
running -> failed
~~~

Invariants:

- 상태 전이는 compare-and-set 조건을 포함한 SQLite transaction으로 수행한다.
- queued: `started_at`, `ended_at`, `error_code`가 null
- running: `started_at` non-null, `ended_at`, `error_code`가 null
- completed: `started_at`, `ended_at` non-null, `error_code` null, schema-valid Report
  정확히 1개
- failed: `ended_at`, `error_code` non-null, Report 0개
- terminal 상태에서 다른 상태로 전이하지 않는다.
- Tool 실패는 곧 Run failure가 아니다. PRD 02/03의 결정표로 valid
  `insufficient_tools` 또는 `problem_detected` Report를 만들 수 있으면 Run은
  completed다.
- `report_status=available`은 completed와 동치다. 그 외에는 absent다.

### Run Error Code Catalog

이 표가 persisted `runs.error_code`의 유일한 소유 계약이다.

| code | Terminal cause |
|---|---|
| `queue_admission_failed` | queued commit 뒤 queue publish 실패 |
| `server_restarted` | startup recovery가 발견한 이전 process의 queued/running Run |
| `queue_wait_timeout` | queued 상태로 최대 wait 초과 |
| `server_shutdown` | graceful shutdown deadline 안에 끝나지 못함 |
| `provider_failure` | model provider timeout, rate limit, network 또는 unavailable |
| `agent_budget_exhausted` | 허용 model invocation을 모두 사용하고도 valid final draft 없음 |
| `invalid_report_generation` | narrative draft/final Report validation 실패 |
| `run_timeout` | running wall-clock deadline 도달 |
| `secret_exposure_risk` | Run 생성 뒤 secret marker 탐지 |
| `storage_failure` | artifact 또는 terminal transaction 실패; 별도 failure 전이는 성공 |
| `internal_policy_violation` | 불가능해야 하는 Tool Core/runner 경계 위반 |

Tool-level code는 PRD 03이 소유한다. source/Tool 실패가 위 Run failure로 직결되는지
completed Report로 흡수되는지는 PRD 02/03의 outcome과 failure matrix가 결정한다.

## Queue Admission And Recovery

- implementation: bounded in-process queue
- worker concurrency: 2
- waiting permits: 20
- maximum admitted Runs: running 2 + waiting 20 = 22
- maximum queue wait: 120 seconds
- Run wall-clock timeout: running 전이부터 60 seconds; queue wait는 포함하지 않음
- automatic retry count: 0

Admission protocol:

1. 인증, body validation, secret pre-scan을 끝낸다.
2. queue mutex 아래에서 running/waiting admission permit 하나를 예약한다.
3. SQLite transaction으로 queued Run을 insert한다.
4. commit 후 in-memory queue에서 worker가 볼 수 있게 publish한다.
5. publish가 끝난 뒤에만 `202`를 반환한다.

DB insert가 실패하면 permit을 해제하고 Run row 없이 `503 storage_unavailable`을
반환한다. publish가 실패하면 별도 transaction으로 Run을
`failed/queue_admission_failed`로 전환한다. 이 전이가 성공한 경우에만 permit을
해제하고 `503 queue_admission_failed`를 반환한다. publish와 failed 전이가 모두
실패하면 permit을 임의 해제하거나 queued Run을 정상으로 취급하지 않는다. 즉시
admission/readiness를 닫고 HTTP listener를 중단한 뒤 process를 fail-stop한다.

Startup 순서는 `config 검증 -> DB open/migration -> stale Run recovery commit ->
queue/worker 생성 -> HTTP listen`으로 고정한다. recovery는 기존 queued/running
Run을 `failed/server_restarted`로 전환하며 10초 안에 commit돼야 한다. recovery가
실패하거나 timeout이면 worker와 listener를 시작하지 않는다. P0는 재개나 자동
replay를 하지 않는다.

각 permit에는 process-local `releaseOnce` token이 있다. publish 전에는 admission
handler, publish 뒤에는 queue/terminal coordinator가 소유한다. worker는
`queued -> running` CAS에 성공한 경우만 실행한다. queue wait timeout, shutdown,
worker dequeue가 경합하면 terminal/CAS winner 하나만 permit을 해제하며 loser는
source, state, DB를 변경하지 않는다.

queue wait 120초를 넘은 Run은 `failed/queue_wait_timeout`이 된다. graceful
shutdown은 admission mutex 아래 `admission_closed=true`를 먼저 설정하고 이미
진입한 admission transaction/reservation이 commit+publish 또는 rollback을 끝낼
때까지 기다린다. commit 전 중단된 request는 rollback, permit release, Run row
없음, `503 server_shutting_down`이다. 그 barrier 뒤 running Run에 최대 10초를
준다. 남은 queued Run은 `failed/server_shutdown`, deadline 후 running Run도
`failed/server_shutdown`으로 전환하고 network operation을 abort한다.

각 Run의 Agent state, Tool args, Evidence는 독립 object graph를 사용한다. global
mutable Agent memory나 cross-run cache를 두지 않는다.

## SQLite Model

### runs

- `id TEXT PRIMARY KEY`
- `request_id TEXT NOT NULL UNIQUE`
- `scenario TEXT NOT NULL CHECK (scenario = 'backend_5xx_increase')`
- `environment TEXT NOT NULL CHECK (environment IN ('dev','prod'))`
- `problem TEXT NOT NULL`
- `requested_by TEXT NOT NULL`
- `status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed'))`
- `error_code TEXT NULL`; null 또는 이 문서의 Run Error Code Catalog만 허용하는
  table-level `CHECK`
- `prompt_version TEXT NOT NULL`
- `toolset_version TEXT NOT NULL`
- `source_contract_set_version TEXT NOT NULL`, `source_contract_set_hash TEXT NOT NULL`
- `model_id TEXT NULL`
- `evidence_schema_version TEXT NOT NULL`, `tool_error_schema_version TEXT NOT NULL`
- `report_schema_version TEXT NOT NULL`
- `started_at TEXT NULL`, `ended_at TEXT NULL`, `created_at TEXT NOT NULL`

`source_contract_set_hash`도 canonical enabled-contract set의 lowercase SHA-256 hex
64자다. fake-only core Run은 versioned fake descriptor set을 사용한다.

### tool_calls

- `id TEXT PRIMARY KEY`
- `run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE`
- `call_index INTEGER NOT NULL`
- `tool_name TEXT NOT NULL`, `source TEXT NOT NULL`
- `sanitized_args_json TEXT NOT NULL`
- `source_contract_version TEXT NOT NULL`, `source_contract_hash TEXT NOT NULL`
- `status TEXT NOT NULL CHECK (status IN ('succeeded','failed','blocked'))`
- `duration_ms INTEGER NOT NULL`, `error_code TEXT NULL`, `created_at TEXT NOT NULL`
- `UNIQUE(run_id, call_index)`

`source_contract_hash`는 canonical descriptor의 lowercase SHA-256 hex 64자다. known
Tool은 fake 또는 PRD 05 live contract의 version/hash를 쓴다. `unknown_tool`은 raw
Agent name을 저장하지 않고 fixed `tool_name=unknown`, `source=tool_core`,
`source_contract_version=tool_core/unknown/v1`과 그 server-owned sentinel descriptor
hash를 쓴다.

### evidence

- `id TEXT PRIMARY KEY`
- `run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE`
- `tool_call_id TEXT NOT NULL REFERENCES tool_calls(id) ON DELETE CASCADE`
- `schema_version TEXT NOT NULL`
- `normalized_json TEXT NOT NULL`
- `redaction_status TEXT NOT NULL CHECK (redaction_status IN ('passed','redacted'))`
- `created_at TEXT NOT NULL`

### reports

- `id TEXT PRIMARY KEY`
- `run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE`
- `schema_version TEXT NOT NULL`
- `report_json TEXT NOT NULL`
- `created_at TEXT NOT NULL`

Invalid Report는 저장하지 않으므로 `validation_status` column을 두지 않는다.
sanitized Tool Error는 `tool_calls.status/error_code/duration_ms`에서 재구성한다.

Required indexes:

- `runs(created_at DESC, id DESC)`
- `runs(environment, status, created_at DESC, id DESC)`
- `tool_calls(run_id, call_index)`
- `evidence(run_id, created_at, id)`

## Storage Rules

- `PRAGMA foreign_keys=ON`, WAL mode, `busy_timeout=5000ms`
- 순번 SQL migration을 version control하고 startup에 한 번만 적용
- source/provider/network 호출 중 SQLite transaction을 열어두지 않음
- raw prompt, raw model response, raw Tool response, raw upstream error 저장 금지
- JSON은 schema validation과 secret scan 후에만 저장
- Report completion은 하나의 `BEGIN IMMEDIATE` transaction이 소유한다. running
  Run 확인 -> schema-valid Report 1개 insert -> `running -> completed` CAS와
  `ended_at` 기록 -> affected row 1개 확인 -> commit 순서다. 어느 단계든 실패하면
  전체 rollback하므로 Report만 남거나 Report 없이 completed가 되는 상태는 없다.
- completion transaction이 rollback되면 별도 transaction으로
  `failed/storage_failure`를 시도한다. 그 failure 전이도 저장할 수 없으면
  admission/readiness를 닫고 process를 fail-stop하며 completed 또는 정상 Report를
  주장하지 않는다. 다음 startup recovery 전에는 새 요청을 받지 않는다.
- Evidence와 Tool Error는 각 Tool call이 검증을 통과한 뒤 짧은 transaction으로
  먼저 저장한다. terminal completion transaction 중 source/provider/network
  operation을 수행하지 않는다.
- migration 전 DB file과 존재하는 `-wal`/`-shm` 상태를 안전하게 checkpoint한 뒤
  backup
- migration 실패 시 startup 중단; 부분 migration을 current로 표시하지 않음

## Retention

- 기본 보존 기간: terminal `ended_at` 기준 30 days
- startup과 이후 24시간마다 cleanup
- completed/failed Run과 cascade 연관 레코드만 대상
- 한 transaction에서 최대 500 Runs 삭제
- running/queued Run 삭제 금지
- batch 사이 transaction을 닫아 writer lock을 장시간 보유하지 않음
- cleanup 실패는 sanitized structured log로 남기고 Run worker를 중단하지 않음

## Verification Ownership

API, Run, queue, storage 계약의 실행 가능한 성공 기준과 failure injection은
[PRD 04](04-verification-and-handoff.md)가 소유한다.
