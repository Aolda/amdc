# AMDC Tool And Plugin Design Decisions

Status: discussion record, not a PRD
Last updated: 2026-08-28

이 문서는 Tool 개발 과정에서 논의한 내용과 현재 결론을 정리한 기록이다. 구현
계약이나 acceptance를 변경하지 않으며, 추후 PRD를 수정할 때 참고 자료로 사용한다.

## Tool의 역할

Tool은 하나의 관측 대상을 읽는 read-only 기능이다.

- Backend health를 본다.
- Prometheus target을 본다.
- MySQL connection metric을 본다.
- 특정 service의 Loki log를 본다.

Tool이 5xx 비율을 계산하거나 장애 여부를 판정하고 원인을 요약하지 않는다. 계산,
해석, 다음 행동 결정은 LLM이 raw 결과를 보고 수행한다. Tool description에는 무엇을
조회하고 무엇을 반환하는지만 적고 “어떤 경우에 사용하면 좋다”는 전략은 넣지 않는다.

## Plugin의 역할과 크기

Plugin은 Tool 실행 단위가 아니라 진단 domain별 Tool 묶음이다.

- `backend`: AMDB Backend가 직접 제공하는 상태와 응답
- `prometheus`: Prometheus 수집 target과 수집 계층 자체
- `logs`: Loki에 저장된 service/container log
- `mysql`: MySQL 상태, connection, 사용자·DB 관련 관측
- `proxy`: ProxySQL 상태, rule, connection pool
- `backup`: backup/restore job, schedule, coverage
- `system`: 여러 서비스에 걸친 system-level 상태 후보

provider와 진단 domain은 구분한다. MySQL metric을 Prometheus API로 가져오더라도
사용 목적이 MySQL 진단이면 `mysql` plugin에 둔다.

## Lazy Loading

최초에는 plugin 목록과 `select_plugin`만 LLM에 제공한다. plugin을 고르면 그
plugin의 Tool만 노출한다.

- 현재 active plugin의 Tool만 사용할 수 있다.
- 다른 plugin을 선택하면 이전 plugin Tool은 숨긴다.
- 이전 Tool 결과, conversation state, 방문 plugin 기록은 유지한다.
- 필요하면 이전 plugin을 다시 선택할 수 있다.

모든 방문 plugin의 Tool을 누적 노출하지 않는다. plugin 선택은 Agent loop 안의 Tool
call이며 plugin을 열기 위한 별도 독립 LLM 요청을 추가하는 구조는 아니다.

현재는 plugin 전환 수나 Tool 호출 수를 제한하지 않는다. 실제 비용은 호출 횟수보다
token과 지연의 영향을 크게 받으므로 trace를 측정한 뒤 제한 필요성을 판단한다.

## 조사 흐름

~~~text
증상
-> 관련 plugin 선택
-> Tool 결과 확인
-> 같은 plugin의 다른 Tool 또는 다른 plugin 선택
-> 이전 결과와 새 결과를 함께 해석
-> 원인을 찾거나 부족한 source를 명시할 때까지 반복
~~~

Backend health가 정상이라는 사실은 health endpoint가 정상이라는 뜻일 뿐, AMDB
전체에 문제가 없다는 뜻이 아니다. 넓은 증상에서 문제를 찾지 못했다면 Prometheus,
logs, MySQL, proxy 등 관련 domain으로 조사를 확장해야 한다.

Prometheus나 Loki를 모든 진단 시작 전에 공통 점검하는 plugin은 만들지 않는다.
해당 source를 사용하는 Tool이 실패할 때 unavailable, permission, timeout을 결과로
드러내는 편이 불필요한 호출과 결합을 줄인다.

## LLM과 AMDC의 책임

LLM은 다음만 결정한다.

- 어떤 plugin을 열지
- 어떤 Tool을 사용할지
- Tool schema가 허용하는 semantic argument
- 결과를 보고 다음에 무엇을 확인할지

AMDC는 다음을 결정하고 실행한다.

- environment와 endpoint env key
- command, HTTP method/path, PromQL, LogQL, SQL
- timeout, byte limit, permission, secret scan
- executor 실행과 sanitized failure

LLM이 script를 작성하는 구조가 아니다. YAML에 실행 계약을 미리 만들고, LLM이
Tool을 선택하면 AMDC가 해당 정의를 실행해 결과만 돌려준다.

## YAML과 Executor

YAML에는 다음을 선언한다.

- plugin, Tool name, description
- read-only access와 allowed environment
- timeout과 input schema
- execution type과 fixed command/path/query
- secret 값이 아닌 environment key 이름

executor는 TypeScript가 소유한다.

- `local_shell`: YAML에 고정된 local command
- `prometheus_http`: 고정 Prometheus GET
- `source_adapter`: 아직 연결되지 않은 code-owned operation
- 다음 후보 `loki_http`: 고정 Loki query-range 요청

Backend의 fixed curl은 허용하지만 LLM input을 command에 넣거나 arbitrary shell을
허용하지 않는다. HTTP source는 전용 adapter가 URL과 query 규칙을 강제한다.

## Tool Input의 구체성

LLM이 전체 데이터를 본 뒤 특정 사용자, 계정, DB, service, 시간대를 좁혀 조회하는
흐름은 지원할 수 있다.

허용 후보:

- enum service
- validated database/user identifier
- bounded 시간 범위와 결과 수

금지 대상:

- raw SQL, PromQL, LogQL
- arbitrary URL, command, regex
- environment와 credential

identifier는 runtime이 검증하고 code-owned mapping 또는 안전한 parameterization을
사용한다.

## 결과 반환

초기 단계에서는 adapter가 결과를 분석하지 않고 raw하게 반환한다.

- local shell: stdout, stderr, exit code
- HTTP source: status code, content type, body

raw도 timeout, 64 KiB 제한, JSON 형식 검증, secret scan을 통과해야 한다. upstream
error body는 반환하지 않는다. raw result는 현재 Agent Run에서 해석하되 trace,
`DiagnosisResult`, Discord presentation, persistence에 복사하지 않는다.

DB를 도입하더라도 raw payload 저장을 기본값으로 두지 않는다. 재현성과 감사에
필요한 최소 Evidence, provenance, retention, 민감정보 정책을 별도로 설계한다.

## 현재 동작하는 Tool

| Plugin | Tool | Source | 반환 |
|---|---|---|---|
| backend | `backend_get_health` | fixed local curl | raw stdout/stderr/exit code |
| prometheus | `prometheus_get_targets` | Prometheus targets API | raw JSON |
| mysql | `mysql_get_service_status` | fixed Prometheus query | raw JSON |
| mysql | `mysql_get_connections` | fixed Prometheus query | raw JSON |

catalog의 다른 Tool 후보는 live adapter가 없으면 `source_unavailable`을 반환한다.
순차적으로 완성할 예정이므로 미구현 Tool만 임시로 숨기는 코드는 만들지 않는다.

## Prometheus 결론

Prometheus에서는 target 상태, MySQL, ProxySQL, VM, AMDB custom metric을 조회할 수
있다. 모든 metric마다 Tool을 만들지 않고 진단 목적별 raw reader로 나눈다. PromQL은
YAML에 고정한다.

custom exporter의 일부 `_total` gauge는 query digest reset 때문에 일반적인 monotonic
counter와 다를 수 있다. 이름만 보고 `rate()`를 적용하는 계산 Tool을 만들지 않는다.

## Loki 결론

Loki는 직접 수집하지 않는다. Promtail이 Docker stdout/stderr를 수집해 Loki로
push하고 Loki가 저장·색인·조회한다.

첫 Tool 후보는 `logs_get_service_entries`다.

- input: enum service, bounded window, bounded limit
- fixed selector: `project="managed_db"`와 mapped service
- fixed query-range endpoint와 backward direction
- output: bounded raw Loki JSON
- arbitrary LogQL, pattern summary, level 판정 없음

level filter와 특정 시각 주변 조회는 후속 Tool로 둔다. query digest 조회는 사용자
식별자와 normalized SQL 노출 위험 때문에 별도 보안 검토 후 구현한다.

## 남은 과제

- Backend 정상 결과만 보고 종료하지 않는 multi-plugin 조사 검증
- Loki adapter와 첫 logs Tool 구현
- model/provider 지연에 대한 전체 diagnosis wall-clock budget 검토
- raw result 이후 Evidence, Report, DB 저장 계약
- prod source smoke
