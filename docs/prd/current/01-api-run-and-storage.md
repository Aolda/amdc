# PRD 01. API, Run 수명주기 및 저장소

상태: 현재
최종 검토: 2026-09-04
소유 범위: HTTP API, 인증, Run 상태, 큐 접수, SQLite 스키마와 보존 정책

## 게이트 검토

[핵심 검토]
게이트 상태: ready_for_implementation

REST API는 비동기 Run을 만들지만 SQLite와 프로세스 내 대기열은 하나의 원자적
시스템이 아니다. P0는 접수 허가와 저장·대기열 삽입 순서를 고정하고, 중간
프로세스 중단에서 고아 Run을 재개하지 않고 명시적 실패로 복구한다.

[대안 비교]

SQLite를 영속 작업 대기열처럼 주기 조회하는 방식은 재시작 복구에 강하지만 P0
범위를 키운다. 메모리에만 Run을 둔 방식은 빠르지만 접수된 Run을 재조회할 수
없다. 크기 제한 프로세스 내 대기열과 SQLite Run 저장소를 선택하고 중단 구간을
시작 복구와 최종 오류로 드러낸다.

[실행 가능한 다음 단계]

API 스키마와 저장소/대기열 계약 테스트를 먼저 만들고 원천/제공자 호출을
붙이기 전에 모든 상태 전이와 프로세스 중단 지점을 실패 주입으로 고정한다.

## 공통 규칙

- JSON 요청 본문 한도: 8 KiB
- 모든 timestamp: UTC RFC 3339, 고정 밀리초 형식
  `YYYY-MM-DDTHH:mm:ss.SSSZ`
- Run/Evidence/Request ID: 충돌 검사를 거친 ULID 기반 `run_`, `ev_`, `req_` prefix
- 모든 `/v1` 응답: `Content-Type: application/json`
- 서버는 각 요청에 새 `request_id`를 만들고 응답과 구조화된 로그에 포함한다.
- `problem`과 `requested_by`는 UTF-8 앞뒤 공백 제거 후 길이를 계산한다.
- 원시 Authorization 헤더, 제공자/원천 응답, 프롬프트는 API로 반환하지 않는다.

## 인증 및 입력 사전 검사

`GET /healthz`를 제외한 모든 `/v1` 요청은 `Authorization: Bearer <token>`을
요구한다. token은 startup에 로드한 값과 timing-safe 비교한다. 누락·형식 오류·불일치
모두 동일한 `401 unauthorized`를 반환하며 body와 logs에 token이나 비교 결과를
넣지 않는다.

POST 본문의 `problem`과 `requested_by`는 Run 생성과 제공자 전달 전에 PRD 03의
비밀정보 검사를 통과해야 한다. 탐지 시 `422 sensitive_input_rejected`를 반환하고
Run 행, 원문, 제공자 요청을 만들지 않는다. `requested_by`는 표시용 레이블일
뿐 인증 identity가 아니다.

## 공통 오류 봉투

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

`message`는 코드별 서버 소유 고정 문구다. 검증 라이브러리, SQLite, 제공자,
원천의 원문 오류를 넣지 않는다. 모든 오류 응답은 위 정확한 5필드
`error` object를 사용한다. `run_error_code`는 `code=run_failed`일 때만 해당 Run의
sanitized error code이고, 그 외에는 null이다.

| HTTP | code | Run 행 |
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
변환한다. HTML/기본 오류 본문과 검증 라이브러리 세부 내용은 외부로 내보내지
않는다.

## HTTP API

### POST /v1/runs

요청:

~~~json
{
  "scenario": "backend_5xx_increase",
  "environment": "dev",
  "problem": "최근 10분 동안 AMDB Backend 5xx가 증가했다.",
  "requested_by": "operator-alias"
}
~~~

검증:

- 정확한 키만 허용. 추가 키는 `400 invalid_request`
- scenario: P0에서는 `backend_5xx_increase`만 허용
- 환경: 런타임에서 활성화된 `dev` 또는 `prod`
- problem: 1-2000 Unicode 문자
- requested_by: 1-100 Unicode 문자
- 본문 필드는 영속화 전에 비밀정보 검사
- 대기열 접수 허가가 없으면 `429 queue_full`, `Retry-After: 1`
- 성공은 `queued` Run 커밋과 프로세스 내 대기열 게시가 모두 끝난 뒤의 `202`

응답:

~~~json
{
  "request_id": "req_01J...",
  "run_id": "run_01J...",
  "status": "queued"
}
~~~

P0는 멱등성 키와 자동 중복 제거를 지원하지 않는다. 클라이언트 재시도는 새
Run을 만들 수 있다.

### GET /v1/runs/:runId

응답 필드:

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

`problem`은 사전 검사를 통과해 저장된 정규화 텍스트다. 원시 도구 출력, 프롬프트,
제공자 응답 전문, 엔드포인트, 자격 증명은 반환하지 않는다.

### GET /v1/runs/:runId/evidence

queued, running, completed, failed Run에 현재까지 저장된 sanitized Evidence와
sanitized Tool Error를 반환한다. failed Run도 실패 전에 이미 검증·commit된 safe
artifact는 보존하고 조회할 수 있다. 아무 artifact도 없으면 두 array가 비어 있다.
도구 호출 최대치는 PRD 02가 소유하며 P0에서는 페이지네이션하지 않는다.

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

배열은 `tool_calls.call_index`, 그다음 레코드 ID 오름차순이다. 정확한 항목 형태는
PRD 03이 소유한다. 원시 원천 전송 내용과 자유형 상위 오류 메시지는 포함하지
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

`report`만 PRD 03의 정본 7필드 객체다.

- `queued`/`running`: `409 report_not_ready`
- `failed`: `409 run_failed`, 응답 봉투의 `run_id`와 `run_error_code` 포함
- 존재하지 않는 Run: `404 run_not_found`

### GET /v1/runs

- 제한: 기본값 20, 정수 1-100
- 커서: 이전 페이지 마지막 `(created_at, id)`를 담은 버전이 있는 불투명 base64url 토큰
- 필터: `environment=dev|prod`, `run_status=queued|running|completed|failed`,
  `report_status=absent|available`
- 순서: `created_at DESC, id DESC`
- 커서는 필터 집합과 결합한다. 다른 필터로 재사용하면 `400 invalid_cursor`다.

응답:

~~~json
{
  "request_id": "req_01J...",
  "items": [],
  "next_cursor": null
}
~~~

각 항목은 `GET /v1/runs/:runId`의 `run` 형태를 사용한다. 키 집합 페이지네이션에서
중복과 누락이 없어야 한다.

### GET /healthz

인증 없이 process와 SQLite 연결 가능 여부만 반환한다.

~~~json
{
  "status": "ok",
  "database": "ok"
}
~~~

제공자, 원천 엔드포인트, 활성화된 환경, 모델, 토큰, AMDB 내부 상태는
노출하지 않는다. DB가 연결되지 않으면 `503`과 `status=degraded`를 반환한다.

## Run 수명주기

Run 상태:

~~~text
queued | running | completed | failed
~~~

허용 전이:

~~~text
queued -> running -> completed
queued -> failed
running -> failed
~~~

불변 조건:

- 상태 전이는 비교 후 설정 조건을 포함한 SQLite 트랜잭션으로 수행한다.
- `queued`: `started_at`, `ended_at`, `error_code`가 `null`
- `running`: `started_at`은 `null`이 아니고, `ended_at`, `error_code`가 `null`
- `completed`: `started_at`, `ended_at`은 `null`이 아니고, `error_code`는 `null`, 스키마에 맞는 리포트
  정확히 1개
- `failed`: `ended_at`, `error_code`는 `null`이 아니고, 리포트 0개
- 최종 상태에서 다른 상태로 전이하지 않는다.
- 도구 실패는 곧 Run 실패가 아니다. PRD 02/03의 결정표로 유효한
  `insufficient_tools` 또는 `problem_detected` 리포트를 만들 수 있으면 Run은
  `completed`다.
- `report_status=available`은 completed와 동치다. 그 외에는 absent다.

### Run 오류 코드 목록

이 표가 persisted `runs.error_code`의 유일한 소유 계약이다.

| code | 종료 원인 |
|---|---|
| `queue_admission_failed` | `queued` 커밋 뒤 대기열 게시 실패 |
| `server_restarted` | startup recovery가 발견한 이전 process의 queued/running Run |
| `queue_wait_timeout` | queued 상태로 최대 wait 초과 |
| `server_shutdown` | graceful shutdown deadline 안에 끝나지 못함 |
| `provider_failure` | 진단/리포트 모델 제공자의 시간 초과, 사용량 제한, 네트워크 또는 사용 불가 |
| `agent_budget_exhausted` | 진단 또는 리포트 에이전트의 허용 모델 호출 예산 초과 |
| `invalid_report_generation` | 버전이 있는 진단/리포트 인계, 제공자 서술 초안, 리포트 에이전트 포트 결과 또는 최종 리포트 검증 실패 |
| `run_timeout` | running wall-clock deadline 도달 |
| `secret_exposure_risk` | Run 생성 뒤 비밀정보 표식 탐지 |
| `storage_failure` | 산출물 또는 최종 트랜잭션 실패. 별도 실패 전이는 성공 |
| `internal_policy_violation` | 불가능해야 하는 Tool Core/runner 경계 위반 |

도구 수준 코드는 PRD 03이 소유한다. 원천/도구 실패가 위 Run 실패로 직결되는지
완료 리포트로 흡수되는지는 PRD 02/03의 결과와 실패 매트릭스가 결정한다.

## 큐 접수 및 복구

- 구현 방식: 크기가 제한된 프로세스 내 대기열
- 작업자 동시성: 2
- 대기 허가 수: 20
- 최대 접수 Run 수: 실행 중 2 + 대기 중 20 = 22
- 최대 대기열 대기 시간: 120초
- Run 벽시계 시간 초과: `running` 전이부터 60초. 대기열 대기는 포함하지 않음
- 자동 재시도 횟수: 0

접수 프로토콜:

1. 인증, 본문 검증, 비밀정보 사전 검사를 끝낸다.
2. 대기열 뮤텍스 아래에서 실행/대기 접수 허가 하나를 예약한다.
3. SQLite transaction으로 queued Run을 insert한다.
4. 커밋 후 프로세스 내 대기열에서 작업자가 볼 수 있게 게시한다.
5. publish가 끝난 뒤에만 `202`를 반환한다.

DB insert가 실패하면 permit을 해제하고 Run row 없이 `503 storage_unavailable`을
반환한다. publish가 실패하면 별도 transaction으로 Run을
`failed/queue_admission_failed`로 전환한다. 이 전이가 성공한 경우에만 permit을
해제하고 `503 queue_admission_failed`를 반환한다. publish와 failed 전이가 모두
실패하면 permit을 임의 해제하거나 queued Run을 정상으로 취급하지 않는다. 즉시
admission/readiness를 닫고 HTTP listener를 중단한 뒤 process를 fail-stop한다.

시작 순서는 `설정 검증 -> DB 열기/마이그레이션 -> 오래된 Run 복구 커밋 -> 대기열/작업자 생성 -> HTTP 수신`으로 고정한다. 복구는 기존 `queued`/`running`
Run을 `failed/server_restarted`로 전환하며 10초 안에 commit돼야 한다. recovery가
실패하거나 timeout이면 worker와 listener를 시작하지 않는다. P0는 재개나 자동
replay를 하지 않는다.

각 접수 허가에는 프로세스 로컬 `releaseOnce` 토큰이 있다. 게시 전에는 접수
처리기, 게시 뒤에는 대기열/최종 상태 조정기가 소유한다. 작업자는
`queued -> running` CAS에 성공한 경우만 실행한다. 대기열 대기 시간 초과, 종료,
작업자 대기열 제거가 경합하면 최종 상태/CAS 승자 하나만 접수 허가를 해제하며
패자는 원천, 상태, DB를 변경하지 않는다.

대기열 대기 120초를 넘은 Run은 `failed/queue_wait_timeout`이 된다. 정상
종료는 접수 뮤텍스 아래 `admission_closed=true`를 먼저 설정하고 이미
진입한 접수 트랜잭션/예약이 커밋+게시 또는 롤백을 끝낼
때까지 기다린다. 커밋 전 중단된 요청은 롤백, 허가 해제, Run 행
없음, `503 server_shutting_down`이다. 그 차단 경계 뒤 `running` Run에 최대 10초를
준다. 남은 queued Run은 `failed/server_shutdown`, deadline 후 running Run도
`failed/server_shutdown`으로 전환하고 네트워크 작업을 중단한다.

각 Run의 에이전트 상태, 도구 인수, Evidence는 독립 객체 그래프를 사용한다. 전역
변경 가능 에이전트 메모리나 Run 간 캐시를 두지 않는다.

## SQLite 모델

### runs

- `id TEXT PRIMARY KEY`
- `request_id TEXT NOT NULL UNIQUE`
- `scenario TEXT NOT NULL CHECK (scenario = 'backend_5xx_increase')`
- `environment TEXT NOT NULL CHECK (environment IN ('dev','prod'))`
- `problem TEXT NOT NULL`
- `requested_by TEXT NOT NULL`
- `status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed'))`
- `error_code TEXT NULL`; null 또는 이 문서의 Run Error Code Catalog만 허용하는
  테이블 수준 `CHECK`
- `diagnostic_prompt_version TEXT NOT NULL CHECK
  (diagnostic_prompt_version = trim(diagnostic_prompt_version) AND
  length(diagnostic_prompt_version) > 0)`
- `report_prompt_version TEXT NULL CHECK
  (report_prompt_version IS NULL OR
  (report_prompt_version = trim(report_prompt_version) AND
  length(report_prompt_version) > 0))`
- `toolset_version TEXT NOT NULL`
- `source_contract_set_version TEXT NOT NULL`, `source_contract_set_hash TEXT NOT NULL`
- `model_id TEXT NULL`
- `evidence_schema_version TEXT NOT NULL`, `tool_error_schema_version TEXT NOT NULL`
- `report_schema_version TEXT NOT NULL`
- `started_at TEXT NULL`, `ended_at TEXT NULL`, `created_at TEXT NOT NULL`

`source_contract_set_hash`도 정본 활성 계약 집합의 소문자 SHA-256 16진수
64자다. 가짜 구현 전용 핵심 Run은 버전이 있는 가짜 설명자 집합을 사용한다.

`diagnostic_prompt_version`은 queued Run 삽입 트랜잭션에서 고정하고 이후
변경하지 않는다. 같은 Run의 모든 진단 모델 호출은 이 버전만 사용하며 실행 시점의
현재 구성으로 대체하지 않는다.

`report_prompt_version`은 `NULL`로 시작한다. PRD 02 결과 해석기가
`problem_detected`를 계산하고 PRD 06 Report prompt artifact 검증이 끝난 뒤,
외부 제공자 호출 전에 짧은 트랜잭션으로 `NULL`에서 검증된 버전으로 한 번만
전이한다. non-`NULL`은 Report prompt binding이 완료됐다는 뜻이며 로컬 adapter
호출, 제공자 수신·응답 또는 성공을 뜻하지 않는다. terminal Run의 `NULL`은 Report
binding 경계를 넘지 않았다는 뜻이고, nonterminal Run의 `NULL`은 아직 그 경계에
도달하지 않았을 수 있다는 뜻이다. unknown, 누락 또는 마이그레이션 실패를 `NULL`로
표현하지 않는다.

`completed` Run의 정본 리포트 상태가 `problem_detected`이면
`report_prompt_version`은 non-null이어야 하고, 다른 완료 상태면 `NULL`이어야 한다.
`failed` Run은 binding 경계를 넘었는지에 따라 두 값 중 하나를 가질 수 있지만 어느
경우도 정상 Report나 제공자 수신을 주장하지 않는다. 이 저장 필드/리포트 상태 조합만
`completed` 전이의 DB 불변조건이다.

Report 모델 호출 횟수는 PRD 06의 런타임 예산과 PRD 03/04의 관측·가짜 어댑터
검증이 소유한다. 비동기 구조화 로그의 `model_call_started` 존재나 개수는 SQLite
완료 트랜잭션의 선행조건이 아니며, 로그 누락이 이미 커밋된 terminal 상태를
변경하지 않는다. 호출 시도에 대한 crash-safe 영속 감사가 필요해지면 별도
데이터 모델 결정으로 `model_calls` 원장을 검토한다.

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
도구는 가짜 구현 또는 PRD 05 실제 계약의 버전/해시를 쓴다. `unknown_tool`은 원시
에이전트 이름을 저장하지 않고 고정 `tool_name=unknown`, `source=tool_core`,
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
정제된 도구 오류는 `tool_calls.status/error_code/duration_ms`에서 재구성한다.

필수 인덱스:

- `runs(created_at DESC, id DESC)`
- `runs(environment, status, created_at DESC, id DESC)`
- `tool_calls(run_id, call_index)`
- `evidence(run_id, created_at, id)`

## 저장소 규칙

- `PRAGMA foreign_keys=ON`, WAL 모드, `busy_timeout=5000ms`
- 순번 SQL 마이그레이션을 버전 관리하고 시작할 때 한 번만 적용
- 원천/제공자/네트워크 호출 중 SQLite 트랜잭션을 열어두지 않음
- 원시 프롬프트, 원시 모델 응답, 원시 도구 응답, 원시 상위 오류 저장 금지
- JSON은 스키마 검증과 비밀정보 검사 후에만 저장
- 리포트 완료는 하나의 `BEGIN IMMEDIATE` 트랜잭션이 소유한다. `running`
  Run 확인 -> 스키마에 맞는 리포트 1개 삽입 -> `running -> completed` CAS와
  `ended_at` 기록 -> 영향받은 행 1개 확인 -> 커밋 순서다. 어느 단계든 실패하면
  전체 롤백하므로 리포트만 남거나 리포트 없이 `completed`가 되는 상태는 없다.
- 완료 트랜잭션이 롤백되면 별도 트랜잭션으로
  `failed/storage_failure`를 시도한다. 그 실패 전이도 저장할 수 없으면
  접수/준비 상태를 닫고 프로세스를 즉시 중단하며 `completed` 또는 정상 리포트를
  주장하지 않는다. 다음 시작 복구 전에는 새 요청을 받지 않는다.
- 증거와 도구 오류는 각 도구 호출이 검증을 통과한 뒤 짧은 트랜잭션으로
  먼저 저장한다. 최종 완료 트랜잭션 중 원천/제공자/네트워크
  작업을 수행하지 않는다.
- 마이그레이션 전 DB 파일과 존재하는 `-wal`/`-shm` 상태를 안전하게 체크포인트한 뒤
  백업
- 마이그레이션 실패 시 시작 중단. 부분 마이그레이션을 현재 상태로 표시하지 않음
- `origin/develop@71f2069`에는 SQLite와 `runs` table이 없으므로 첫 P0 migration은
  `diagnostic_prompt_version`과 nullable `report_prompt_version`을 처음부터 생성함
- 기존 DB에서 단일 `runs.prompt_version`, old/new column 혼합 또는 알 수 없는 schema를
  발견하면 자동 변환하지 않고 migration을 rollback한 뒤 시작/접수를 중단함. 기본값,
  추정 backfill과 경고 후 계속 실행 금지
- 실제 legacy DB가 별도로 확인되면 schema fingerprint, 허용 version ID, 행/키/외래 키
  검증, 담당 검토자와 rollback을 가진 versioned migration manifest를 별도 결정한 뒤에만
  변환을 구현함
- 마이그레이션 또는 배포 rollback 중 검증된 백업 복원도 실패하면 DB를 current로
  열거나 worker/listener를 시작하지 않고 시작 실패로 종료. 수동 복구로 백업과 DB
  무결성을 다시 검증하기 전 자동 재시도와 접수 금지

## 보존 정책

- 기본 보존 기간: 최종 `ended_at` 기준 30일
- 시작 시점과 이후 24시간마다 정리
- `completed`/`failed` Run과 연쇄 연관 레코드만 대상
- 한 트랜잭션에서 최대 Run 500개 삭제
- `running`/`queued` Run 삭제 금지
- 배치 사이 트랜잭션을 닫아 쓰기 잠금을 장시간 보유하지 않음
- 정리 실패는 정제된 구조화 로그로 남기고 Run 작업자를 중단하지 않음

## 검증 소유권

API, Run, 대기열, 저장 계약의 실행 가능한 성공 기준과 실패 주입은
[PRD 04](04-verification-and-handoff.md)가 소유한다.
