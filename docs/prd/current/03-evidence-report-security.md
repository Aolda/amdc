# PRD 03. Evidence, Report And Security

Status: current  
Last reviewed: 2026-07-22  
Owns: Evidence, sanitized Tool Error, Report 의미, redaction, failure, observability

## Gate Review

[Critical Review]
Gate Status: ready_for_implementation

schema-valid JSON만으로 진단의 의미가 안전해지지는 않는다. Report status는 실제
Evidence/Error와 일치해야 하고, 모든 observation은 저장된 근거나 sanitized Tool
Error로 추적돼야 한다. P0는 JSON Schema와 AMDC semantic validator를 모두
통과한 artifact만 저장한다.

[Trade-off Analysis]

raw source output을 저장하면 재분석은 쉽지만 secret과 운영 데이터 노출면이
커진다. 요약 문자열만 저장하면 검증과 단위가 사라진다. P0는 Tool별 typed payload와
source/time/version metadata를 가진 bounded Evidence를 저장하고 raw payload는
즉시 폐기한다.

[Actionable Next Step]

Evidence/Report schema validator와 semantic decision fixture를 구현해 provider를
붙이기 전에 invalid, oversized, untraceable, secret-bearing artifact를 모두 거부한다.

## Evidence Contract

Canonical validator:

~~~text
schemas/evidence.schema.json
schema_version: 1.1.0
~~~

Example:

~~~json
{
  "evidence_id": "ev_01J4Z3Y7YJ7T5B5W9R7F6A2K1M",
  "run_id": "run_01J4Z3XZE5N7N7P0B6H0D3K2Q1",
  "tool_call_id": "tc_01J4Z3Y6R8R1W4M7Q8A2C6V9N0",
  "tool_name": "backend_5xx_rate",
  "source": "prometheus",
  "source_contract_version": "backend_5xx_rate/v1",
  "time_range": {
    "start": "2026-07-22T00:00:00.000Z",
    "end": "2026-07-22T00:10:00.000Z"
  },
  "category": "metric",
  "assessment": "positive",
  "severity": "warning",
  "summary": "최근 10분 Backend 5xx 비율이 baseline보다 증가했다.",
  "payload": {
    "baseline_range": {
      "start": "2026-07-21T23:50:00.000Z",
      "end": "2026-07-22T00:00:00.000Z"
    },
    "request_count": 1000,
    "error_5xx_count": 42,
    "error_rate": 0.042,
    "baseline_request_count": 1200,
    "baseline_error_5xx_count": 5,
    "baseline_error_rate": 0.004,
    "source_assessment": "elevated",
    "reason": "rate_and_delta_threshold_exceeded"
  },
  "truncated": false,
  "redaction_status": "passed",
  "collected_at": "2026-07-22T00:10:01.000Z"
}
~~~

Rules:

- exact fields only; extra/missing field는 validation failure
- category: `metric | log | health`
- assessment: `positive | negative | inconclusive`
- severity: `info | warning | critical | unknown`
- generic key/value facts가 아니라 `tool_name`으로 구분되는 typed `payload`를 사용한다.
  metric은 baseline/current count와 rate, log는 최대 10개 redacted pattern,
  health는 service와 최대 20개 dependency 상태를 보존한다.
- source time과 adapter contract version을 반드시 포함
- health Evidence는 `time_range.start=end=checked_at`
- schema의 tool/source/category/source-contract 조합은 세 P0 Tool의 fixed mapping만
  허용한다.
- timestamp는 fixed-millisecond regex뿐 아니라 RFC 3339 calendar validator를
  통과해야 한다. `time_range.start <= time_range.end <= collected_at`을 semantic
  validator가 확인한다.
- raw log sample, raw response, endpoint, query, credential field는 존재하지 않음
- Evidence item은 RFC 8785 JSON Canonicalization Scheme으로 serialize한 UTF-8 byte
  length 최대 16 KiB
- 한 Run에 저장하고 Agent에 전달하는 accepted Evidence array 전체의 canonical
  UTF-8 byte length은 최대 64 KiB
- normalizer는 model 요약으로 크기를 줄이지 않음
- adapter가 server-owned limit로 pattern/dependency를 줄인 경우만
  `truncated=true`
- 새 item으로 64 KiB를 넘으면 그 item을 저장하지 않고
  `evidence_budget_exhausted` Tool Error를 기록한 뒤 기존 Evidence로 finalize
- schema, secret scan, redaction을 통과하지 못한 item은 DB와 provider에 전달하지
  않음

Tool output과 Evidence mapping:

| Tool source assessment | Evidence assessment | severity |
|---|---|---|
| metric `elevated` | positive | warning |
| metric `not_elevated` | negative | info |
| metric `insufficient_data` | inconclusive | unknown |
| log `errors_observed` | positive | warning |
| log `none_observed` | negative | info |
| log `insufficient_data` | inconclusive | unknown |
| health `healthy` | negative | info |
| health `degraded` | positive | warning |
| health `unhealthy` | positive | critical |
| health `insufficient_data` | inconclusive | unknown |

metric baseline은 current window 바로 앞의 동일 길이여야 한다. log pattern은
`pattern`, `count`, `first_seen`, `last_seen`을 하나의 typed item으로 유지한다.
health dependency name은 item 안에서 unique하고 service/dependency worst-of가
source assessment와 일치해야 한다. metric count/rate/reason/threshold, log
assessment/cardinality/unique pattern/time containment, health aggregate/truncation,
모든 finite/safe number와 time 관계는 JSON Schema에 더해 application semantic
validator가 확인한다. schema/JCS 전에 `Number.isFinite`와 safe-integer guard를
적용한다.

## Sanitized Tool Error Contract

Source failure는 Evidence가 아니다. `tool_calls`에 안전한 code만 저장하고 API/Agent
경계에서는 다음 exact shape로 재구성한다.

Canonical validator:

~~~text
schemas/tool-error.schema.json
schema_version: 1.0.0
~~~

~~~json
{
  "tool_call_id": "tc_01J4Z3Y6R8R1W4M7Q8A2C6V9N0",
  "tool_name": "backend_health",
  "source": "amdb_backend",
  "code": "tool_timeout",
  "retryable": false,
  "occurred_at": "2026-07-22T00:10:01.000Z"
}
~~~

P0 codes:

| code | Meaning | Fixed observation message |
|---|---|---|
| `unknown_tool` | registry에 없음; `source=tool_core`, 실행 0 | 등록되지 않은 Tool 요청을 차단했다. |
| `invalid_input` | Agent input schema 실패; source 호출 0 | Tool 입력이 허용 schema를 통과하지 못했다. |
| `environment_not_allowed` | Run/server/Tool allowlist 불일치; source 호출 0 | Run 환경에서 이 Tool 실행을 허용하지 않았다. |
| `budget_exhausted` | total/same-Tool diagnostic call budget 소진 | 진단 Tool 호출 예산이 소진됐다. |
| `tool_timeout` | Tool deadline에 실제 operation abort | Tool 호출이 제한 시간 안에 끝나지 않았다. |
| `tool_output_too_large` | raw output 64 KiB 초과로 abort/폐기 | Tool 응답이 허용 크기를 초과해 폐기됐다. |
| `malformed_source_response` | output schema 또는 timestamp 실패 | Source 응답 형식이 계약과 일치하지 않았다. |
| `source_unavailable` | network/5xx 등 read source 사용 불가 | Read-only source를 사용할 수 없었다. |
| `source_permission_denied` | required read source가 401/403 | Read-only source 조회 권한이 부족했다. |
| `evidence_budget_exhausted` | accepted Evidence array 64 KiB 초과 방지 | Evidence 저장 예산을 초과해 새 항목을 제외했다. |
| `redaction_failed` | safe redaction을 보장할 수 없어 artifact 폐기 | 안전한 redaction을 보장할 수 없어 응답을 폐기했다. |
| `secret_exposure_risk` | secret marker 탐지; Run fail-closed | Report를 만들지 않으므로 observation 없음 |

`retryable`은 P0에서 항상 false다. upstream status body, exception message, stack,
URL, query, credential identifier는 Error에 넣지 않는다. 같은 Tool의 여러 실패는
서로 다른 `tool_call_id`와 `call_index`로 보존한다.

Tool Error의 `source`는 `tool_core | prometheus | loki | amdb_backend`다. known Tool은
registry의 fixed source를 사용한다. `unknown_tool`은 Agent가 제안한 raw name을
반사하지 않고 fixed `tool_name=unknown`, `source=tool_core`와 PRD 01의 sentinel
source-contract metadata를 사용한다.
`occurred_at`은 Evidence와 같은 fixed-millisecond RFC 3339 validator를 통과한다.
model budget/provider/Run deadline은 Tool call이 아니므로 Tool Error를 만들지 않고
PRD 01의 Run error code로만 종료한다.

## Report Contract

Canonical validator:

~~~text
schemas/monitoring-report.schema.json
schema_version: 1.1.0
~~~

Report는 정확히 다음 7개 field만 가진다.

~~~json
{
  "status": "problem_detected",
  "summary": "저장된 Evidence에서 문제 신호가 확인되었다.",
  "detected_problem": "최근 10분 Backend 5xx 비율이 baseline보다 증가했다.",
  "observations": [
    "[ev_01J4Z3Y7YJ7T5B5W9R7F6A2K1M] 5xx 비율이 baseline보다 증가했다."
  ],
  "suspected_cause": "가능성: Backend dependency health 저하",
  "recommended_next_action": "positive Evidence와 관련 dependency 상태를 수동 확인하고 담당자에게 에스컬레이션한다.",
  "needs_additional_permission": false
}
~~~

Field limits:

- summary: 1-500 characters
- detected_problem: null 또는 1-500 characters
- observations: 1-20 items, 각 1-500 characters, duplicate 없음
- suspected_cause: null 또는 1-1000 characters
- recommended_next_action: 1-1000 characters

Observation trace format과 content는 AMDC가 결정적으로 만든다.

- Evidence: `[<evidence_id>] <Evidence.summary exact text>`
- Tool failure: `[tool:<tool_call_id>/<error_code>] <fixed catalog message>`

Evidence summary는 최대 400 characters, fixed Tool Error message도 최대 400
characters로 제한해 prefix를 포함한 observation이 500 characters를 넘지 않게 한다.
`secret_exposure_risk`는 Report를 만들지 않으므로 Tool Error observation enum에는
포함하지 않는다.

Report Assembler는 accepted Evidence와 Tool Error를 call order로 정렬해 canonical
observation array를 만든다. model이 observation claim을 작성하거나 수정하지
않는다. semantic validator는 array가 같은 Run의 canonical array와 exact match인지
확인한다. 자유형 문장의 entailment를 validator가 판정한다고 주장하지 않는다.
Report에 endpoint, query, raw message를 복사하지 않는다.

AMDC가 status별 summary, detected problem, next action도 결정적으로 조립한다.

| status | fixed summary | detected_problem | fixed recommended_next_action |
|---|---|---|---|
| `problem_detected` | 저장된 Evidence에서 문제 신호가 확인되었다. | call order상 첫 positive Evidence.summary exact text | positive Evidence와 관련 dependency 상태를 수동 확인하고 담당자에게 에스컬레이션한다. |
| `no_problem_detected` | 세 required check에서 문제 신호가 확인되지 않았다. | null | 기존 모니터링을 계속하고 새 증상이 생기면 별도 Run을 생성한다. |
| `insufficient_tools` | 수집 범위가 부족해 문제 여부를 판단할 수 없다. | null | 누락되거나 inconclusive한 read-only source를 수동 확인한다. |
| `needs_permission` | 필수 read-only source의 조회 권한이 부족하다. | null | 필수 source의 read-only 조회 권한을 요청한다. |

Evidence summary, redacted pattern/dependency name, narrative draft와 final Report
문자열은 NFC normalize 후 trim한다. whitespace-only, C0 control, DEL, CR/LF를
거부한다. final Report 전체도 RFC 8785 canonical UTF-8 기준 64 KiB 이하여야 한다.
non-null `suspected_cause`는 `가능성: ` prefix로 가설임을 표시한다. semantic
validator는 이 model narrative field의 실제 인과관계를 증명한다고 주장하지
않으며, schema/secret policy만 강제한다. next action은 model output이 아니므로 URL,
shell/CLI command, 배포·재시작·삭제·설정 변경 지시가 들어갈 경로가 없다.

Status invariants:

| status | detected_problem | suspected_cause | permission flag |
|---|---|---|---|
| `problem_detected` | non-empty string | string 또는 null | false |
| `no_problem_detected` | null | null | false |
| `insufficient_tools` | null | null | false |
| `needs_permission` | null | null | true |

PRD 02의 outcome resolver가 allowed status를 계산한다. JSON Schema는 위
조건부 field 규칙을 강제하고, semantic validator는 status와 실제
Evidence/Error의 일치를 강제한다.

LangChain structured output은 canonical Report 자체가 아니라
`suspected_cause` 하나만 생성한다. AMDC Report Assembler가 status, fixed summary,
deterministic detected problem, observations, fixed next action, permission flag를 넣어
최종 7-field object를 만든다.

status precedence와 Tool/model/provider/deadline 결과는 PRD 02의 Outcome Resolver가
단독 소유한다. canonical observation이 0개면 Report를 만들지 않는다.
- invalid draft, extra/missing/invalid/untraceable final field는 Report 저장을 거부하고
  `failed/invalid_report_generation`
- invalid structured output에 provider/model retry를 하지 않음

## Security Pipeline

순서는 다음과 같다.

1. Authorization header를 body/context/log에서 분리
2. `problem`/`requested_by` input pre-scan; 탐지 시 Run 생성 전 422
3. server-owned endpoint/query/credential field를 Agent-visible data에서 제거
4. constructed provider input을 egress 직전 scan
5. bounded raw Tool output을 in-memory scan하고 허용된 운영 식별자만 redaction
6. typed Evidence normalize 후 schema/size/final secret scan
7. provider output scan 후 Report schema/semantic/final secret scan
8. 통과한 sanitized args, Evidence, Error code, Report만 transaction으로 저장

Secret scan은 최소한 다음을 탐지한다.

- process에 로드된 non-empty secret 값의 exact match; 길이 8 이상
- Authorization/cookie credential material
- API key/token/password로 식별되는 key-value
- private key/PEM, service account private material
- credential이 포함된 URL userinfo와 sensitive query parameter
- known provider token prefix와 JWT-like credential

Redaction은 비밀이 아닌 운영 식별자를 bounded placeholder로 바꾸고 artifact를
계속 사용할 수 있는 경우다. exact loaded secret, private key, raw auth material처럼
안전한 복구를 보장할 수 없는 탐지는 redaction으로 덮지 않고 fail-closed한다.
high-entropy만으로 secret을 단정하지 않으며 false-positive fixture를 유지한다.

secret marker 발견 시:

- 현재 raw artifact를 즉시 폐기
- Evidence/Report/자유형 Error로 저장하지 않음
- Run이 이미 있으면 `failed/secret_exposure_risk`
- log에는 `request_id`, `run_id`, stage, fixed error code만 기록
- secret 값, 일부 문자열, reversible hash/fingerprint를 기록하지 않음

## Failure And Artifact Matrix

| Failure/condition | Run | Report | Persisted safe artifacts |
|---|---|---|---|
| invalid/sensitive POST | 없음 | 없음 | request_id log only |
| queue full | 없음 | 없음 | queue metric only |
| Tool timeout/no-data, no positive Evidence | completed | `insufficient_tools` | Tool Error + accepted Evidence |
| partial Tool failure + positive Evidence | completed | `problem_detected` | Tool Error + positive Evidence |
| required source permission denial, no positive | completed | `needs_permission` | Tool Error + accepted Evidence |
| all required checks negative | completed | `no_problem_detected` | three negative Evidence |
| provider timeout/rate limit/network | failed/`provider_failure` | 없음 | 호출 전 commit된 safe Evidence + Tool Error |
| model invocation budget exhausted | failed/`agent_budget_exhausted` | 없음 | 호출 전 commit된 safe Evidence + Tool Error |
| malformed/semantic-invalid model output | failed/`invalid_report_generation` | 없음 | Evidence + Tool Error only |
| Run wall-clock timeout | failed/`run_timeout` | 없음 | deadline 전 accepted artifacts |
| DB write/Report completion failure | failed/`storage_failure` if writable; otherwise fail-stop | 없음 | rollback 전 commit된 safe artifacts only |
| secret exposure risk after Run creation | failed/`secret_exposure_risk` | 없음 | 현재 raw artifact 폐기; 이전 safe artifacts 보존 |

DB failure로 terminal state도 저장할 수 없으면 API와 log는 `storage_unavailable`만
알리고 completed를 주장하지 않는다. process는 PRD 01의 fail-stop/recovery 경로를
따른다. failed Run의 보존된 safe artifact는 Evidence API에서 조회할 수 있다.

## Observability

Structured log fields:

- `timestamp`, `level`
- `request_id`, `run_id` when assigned
- `stage`: `api | admission | queue | agent | tool_core | evidence | report | storage |
  cleanup | shutdown`
- `tool_call_id`, `tool_name` when applicable
- `duration_ms`, `error_code`
- `prompt_version`, `toolset_version`, `model_id`는 Run 시작/종료 event에만

Minimum metrics:

- Run admission/completion/failure counters by safe status/error code
- queue waiting/running gauges and queue-full counter
- Run, provider, Tool latency histograms
- Tool Error counter by tool/code
- Evidence/Report validation failure counter
- redaction count와 secret-risk fail-closed count; raw matched value label 금지

기본 logs에서 problem 전문, requested_by, prompt, raw Tool/provider output, Report
본문, endpoint, query, token을 기록하지 않는다. request_id와 run_id로 API부터
terminal event까지 연결할 수 있어야 한다.

## Verification Ownership

Evidence, Report, security, failure semantics의 실행 가능한 성공 기준과 fixture는
[PRD 04](04-verification-and-handoff.md)가 소유한다.
