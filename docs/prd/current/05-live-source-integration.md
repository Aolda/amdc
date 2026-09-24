# PRD 05. Live Source Integration

Status: current  
Last reviewed: 2026-09-04
Owns: Prometheus/Loki/AMDB Backend의 exact live mapping, source credential binding,
dev read-only smoke gate

## Gate Review

[Critical Review]
Gate Status: ready_for_design

현재 repository와 검토한 AMDC/AMDB Notion 문서에는 P0가 사용할 authoritative
Prometheus metric/label, LogQL selector, Backend health route와 response shape가 없다.
과거 문서에는 MCP/Claude Code 기반 예시와 일반적인 health/metrics/logs 흐름이
있지만, 이를 2026-07 LangChain P0의 live contract로 복사하면 정상 데이터를 잘못
판정하거나 다른 service/environment를 조회할 수 있다.

2026-09-04 `origin/develop@71f2069`에는 환경별 URL로 generic GET을 수행하는
`system_check_configured_http_health` 경로가 하나 존재한다. 이 경로는 HTTP 상태와
지연 시간만 정규화하며 P0 `backend_health`의 exact route/response schema, contract
version/hash, response byte limit과 Run/Evidence 저장을 구현하지 않는다. Prometheus와
Loki 작업도 아직 `source_unavailable`이므로 이 시제품을 live source gate 승격
근거로 사용하지 않는다.

[Trade-off Analysis]

Path A: reviewed versioned source contract. Chosen.

- query/route/parser를 Agent와 runtime input에서 분리하고 code review할 수 있다.
- AMDB deployment가 바뀌면 contract version과 fixture를 함께 올릴 수 있다.
- 최초 exact mapping은 AMDB owner의 확인이 필요하다.

Path B: PromQL/LogQL/route를 environment variable로 자유롭게 설정한다.

- 배포 변경은 빠르다.
- startup schema와 code review를 우회하고 query drift, secret/log 노출, 환경별 의미
  불일치가 생긴다.

Path C: 기존 문서의 이름을 추정해 hard-code한다.

- 구현을 바로 시작할 수 있다.
- 실제 AMDB telemetry와 맞는다는 근거가 없어 dev smoke 전까지 오류를 발견하기
  어렵다.

[Actionable Next Step]

AMDB owner가 아래 세 mapping의 exact 값을 제공하고 dev에서 read-only sample을
확인한다. 값, parser fixture, expected assessment가 함께 review되면 이 PRD를
ready_for_implementation으로 승격한다.

## Source Contract Artifact

Live adapter는 environment별 code-reviewed JSON artifact를 사용한다.

~~~text
config/source-contracts/dev.v1.json
config/source-contracts/prod.v1.json  # prod를 enable할 때만 필요
schemas/source-contract.schema.json
~~~

artifact에는 credential, token, full source URL을 넣지 않는다. endpoint base URL과
auth material은 PRD 00의 deployment secret/config에서 resolve한다. 각 enabled
environment는 정확히 하나의 valid contract를 가져야 하며 startup 후 수정하지
않는다. canonical contract hash와 version은 Run metadata와 각 Tool call에 저장한다.

허용 placeholder는 Tool Core가 만든 UTC start, end, baseline_start,
baseline_end, server-owned result limit뿐이다. user problem, requested_by, Agent가
만든 label/query/URL을 substitute하지 않는다.

## Required Exact Mapping

### Prometheus: backend_5xx_rate/v1

Gate promotion 전에 다음을 모두 확정한다.

- request total과 Backend 5xx count를 계산하는 exact metric name과 fixed label matcher
- current/baseline용 exact PromQL 또는 안전하게 parameterized query template
- instant/range endpoint, step, response result type와 numeric parser
- service/route label cardinality 처리와 합산 규칙
- missing series, counter reset, NaN/Infinity, partial response의 normalized reason
- request count/error count/rate 단위와 PRD 02 threshold fixture
- server-owned maximum series/sample count

### Loki: backend_error_log_patterns/v1

Gate promotion 전에 다음을 모두 확정한다.

- Backend stream을 고르는 exact fixed label selector와 error filter
- exact LogQL, direction, page/result limit과 pagination 완료 판정
- timestamp parser와 complete-window 판정
- raw line을 저장하지 않는 redaction/normalization/grouping algorithm
- pattern count, first/last seen mapping과 deterministic sort/tie-break
- server-owned maximum entries scanned와 pattern 10개 제한

### AMDB Backend: backend_health/v1

Gate promotion 전에 다음을 모두 확정한다.

- base URL에 결합할 exact relative path; method는 GET, query/body 없음
- success status code와 exact JSON response schema
- service status, dependency name/status, checked_at의 field mapping
- required dependency set과 unknown/missing field 처리
- response byte limit과 PRD 02의 30-second freshness fixture

## Transport And Credential Boundary

- auth mode와 token env key는 PRD 00의 environment/source mapping만 사용
- source client는 redirect를 따르지 않고 TLS certificate 검증을 끄지 않음
- configured base URL 밖 host/scheme/port로 이동하지 않음
- GET/read API만 허용; request body, mutation method, arbitrary header 없음
- response는 Tool Core의 raw byte limit에서 streaming abort
- 401/403, 429, 5xx, timeout/network와 malformed response는 PRD 03의 fixed Tool Error로
  변환하고 upstream body/header를 보존하지 않음
- credential과 contract 값은 Agent-visible Tool schema, prompt, Evidence, Report,
  default log에 노출하지 않음

## Gate Promotion Evidence

ready_for_implementation 조건:

- 세 exact mapping과 owner/review date가 source contract에 존재
- contract JSON Schema와 secret scan 통과
- recorded sanitized dev response fixture 1개씩과 malformed/empty/permission fixture
- PRD 02 Tool output과 PRD 03 typed Evidence로 lossless normalize하는 contract test
- metric/log time-window alignment와 health freshness test
- query에 user/Agent-controlled fragment가 들어가는 경로 0개

Demo ready 조건:

- 명시적으로 준비된 dev credential로 read-only smoke Run 1회
- 세 source call의 contract version/hash와 sanitized result trace 확인
- raw response/query/credential persistence 0건
- Report schema/semantic/secret scan 통과

prod source call과 smoke는 별도 명시 승인 없이는 수행하지 않는다.
