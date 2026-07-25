# PRD 04. Verification And Implementation Handoff

Status: current  
Last reviewed: 2026-07-22  
Core Contract Gate Status: ready_for_implementation  
Delivery Status: not_started  
Owns: core 성공 지표, 테스트 환경, 파일 경계, 구현 순서, rollback, 완료 판정

## Gate Review

[Critical Review]
Gate Status: ready_for_implementation

기존 `scripts/validate_skeleton.py` 성공은 MCP/YAML plugin과 legacy `.claude`
자산을 검증할 뿐 Fastify, LangChain, Tool Core, SQLite 구현을 검증하지 않는다.
현재 P0는 `npm test`가 current-only tests를 실제로 실행할 때부터 구현 진척으로
계산한다.

이 gate와 아래 handoff는 API/queue/storage, LangChain/Tool Core, fake source,
Evidence/Error/Report core까지만 대상으로 한다. live source adapter와 dev smoke의
exact mapping은 PRD 05가 소유하며 아직 `ready_for_design`이다.

[Trade-off Analysis]

모든 테스트를 live AMDB/OpenAI에 의존시키면 실제성은 높지만 재현과 failure
injection이 불가능하다. fake만 쓰면 provider/source integration을 놓친다. P0는
deterministic fake suite를 core completion gate로 두고, PRD 05의 source contract가
확정된 뒤 별도 dev read-only smoke를 demo gate로 둔다. prod smoke는 자동화하지
않는다.

[Actionable Next Step]

Node/TypeScript test skeleton, canonical Evidence/Tool Error/Report schema tests, fake
adapter vertical slice를
먼저 만들고 legacy fixture/validator를 current test command에서 제외한다.

## Reproducible Test Environment

Performance threshold는 다음 baseline에서 측정한다.

- Node.js 20.x, dependency lockfile 그대로 설치
- production build, test-only fake model/Tools
- 최소 4 vCPU, 8 GiB RAM, local SSD workspace
- SQLite WAL + PRD 01의 busy timeout
- 같은 process에서 20 warm-up Runs 후 측정
- latency workload마다 최소 5회 반복, 각 반복의 p95 중 최악값 사용
- monotonic clock으로 server-side duration과 client-observed duration을 함께 기록
- GC 강제 호출에 의존하지 않음
- live network 결과와 fake benchmark 결과를 같은 표본에 섞지 않음

다른 환경에서 실행하면 CPU/RAM/OS/Node version, workload, 표본 수를 결과와 함께
기록하고 threshold 비교 여부를 명시한다.

## Success Metrics

### Correctness And Traceability

- fixture outcomes 4개: `problem_detected`, `no_problem_detected`,
  `insufficient_tools`, `needs_permission`
- 모든 저장 Evidence/Report가 canonical JSON Schema 통과
- 모든 Report가 actual same-Run Evidence/Error와 semantic validator 통과
- untraceable observation 저장 0건
- required Tool failure를 숨긴 `no_problem_detected` 0건
- Report extra/missing/conditional-invalid field 허용 0건
- accepted Run은 정확히 한 terminal 상태에 도달; terminal 전이 중복 0건
- dev Run의 prod source 호출과 cross-run state leakage 0건

### Security

- API input, provider input/output, sanitized args, Evidence, Tool Error, logs,
  Report, SQLite에서 injected secret 노출 0건
- registry/Tool Core 밖 실행 0건
- mutation/shell/SSH/provider CLI/arbitrary SQL/HTTP 경로 0개
- source deadline 이후 state/DB 변경 0건
- auth failure response/log 차이로 token 정보를 추론할 분기 0건

### Latency And Read Performance

- admission workload: fake Run 실행 <= 50 ms 조건에서 200 POST를 10 rps로 제출,
  성공 POST p95 <= 200 ms, 예상 밖 429/5xx 0건
- read workload: 10,000 terminal fixture Runs에서 무작위 Run/Evidence/Report/List
  read 각 1,000회, endpoint별 p95 <= 300 ms
- fake vertical-slice E2E 100 Runs의 running duration p95 <= 10 seconds
- dev live smoke Run running duration <= PRD 01 wall-clock deadline

Admission latency와 Run completion latency를 별도 histogram으로 측정한다. 429는
admission 성공 latency 표본에 넣지 않고 saturation 결과에 별도 계산한다.

### Concurrency And Backpressure

- worker를 latch로 막은 상태에서 PRD 01의 configured admission permits까지만
  accepted되고 다음 요청은 429; accepted + rejected = submitted
- 202 accepted request는 모두 DB row가 있고, DB가 fixture recovery point에서 다시
  writable해진 뒤 terminal에 도달한다. rejected request는 DB row 0개 또는 명시적
  failed admission row만 가진다.
- running worker count가 PRD 01의 configured concurrency를 초과한 표본 0건
- 10개 동시 제출에서도 각 Run의 environment/args/Evidence/Report 혼입 0건
- same-Run Tool execution은 항상 sequential
- queue wait expiry와 shutdown에서 permit leak 0건

### Memory

- 1,000 fake Runs soak 후 peak RSS <= 256 MiB
- 마지막 500 Runs의 linear RSS slope <= 1 MiB / 100 Runs
- terminal Run 뒤 Agent message, raw Tool buffer, provider output retained reference 0개
- Evidence/Tool raw byte limit을 넘긴 allocation이 unbounded growth로 이어지는 표본
  0건

### Reliability And Operations

- provider/각 Tool timeout, network loss, partial failure, malformed source/model output,
  SQLite write failure, queue crash window를 deterministic fixture로 재현
- DB가 writable한 startup에서 listener를 열기 전, 최대 10초 안에 stale
  queued/running Run을 configured failure code로 전환
- automatic retry count 0을 provider/source fake call count로 증명
- 모든 accepted Run에서 request_id -> run_id -> terminal event correlation 가능
- retention batch가 configured limit을 넘지 않고 active Run 삭제 0건
- dev rollback drill RTO <= 10 minutes

## Contract Test Matrix

| Owner | Stimulus | Expected Run | Expected Report/artifact |
|---|---|---|---|
| PRD 00/01 | unsupported scenario | Run 없음 | 422 `unsupported_scenario` |
| PRD 01/03 | secret-bearing input | Run 없음 | 422, provider/DB 전달 0 |
| PRD 01 | admission saturation | accepted 또는 429 | accepted만 DB row |
| PRD 01 | crash after queued commit | failed after startup | `server_restarted`, Report 없음 |
| PRD 01 | publish + failed-transition DB failure | process fail-stop | 202 없음, recovery 전 listen 없음 |
| PRD 01 | shutdown during admission | row 없음 또는 failed | permit 정확히 1회 release |
| PRD 02 | metric positive + supporting success | completed | `problem_detected` |
| PRD 02 | all three negative | completed | `no_problem_detected` |
| PRD 02 | Tool timeout, no positive | completed | `insufficient_tools` |
| PRD 02 | Tool failure + positive Evidence | completed | `problem_detected` + error trace |
| PRD 02 | source permission denial, no positive | completed | `needs_permission` |
| PRD 02 | Tool prompt injection string | policy unchanged | non-registered/env-changing call 0 |
| PRD 02 | dev Run requests prod in Tool data | policy unchanged | prod source call 0 |
| PRD 02/03 | diagnostic Tool budget exhausted | completed | outcome resolver status, never false negative |
| PRD 02/03 | final model budget exhausted | failed | `agent_budget_exhausted`, Report 없음 |
| PRD 02/03 | zero Tool result/error finalization | failed | `invalid_report_generation`, Report 없음 |
| PRD 02/03 | repeated negative + error/inconclusive | completed | `insufficient_tools` |
| PRD 03 | Evidence item/total at byte boundary | unchanged or safe error | 16/64 KiB invariant |
| PRD 03 | secret in Tool/provider output | failed | raw artifact/Report 없음 |
| PRD 03 | wrong Report status/flag/nullability | failed | `invalid_report_generation` |
| PRD 03 | missing Evidence/Error reference | failed | Report 저장 0 |
| PRD 01/03 | failed Run Evidence 조회 | failed 유지 | 이전 safe artifacts exact 반환 |
| PRD 01/03 | Report insert/completed CAS crash | running 또는 failed | partial Report/completed 0 |
| PRD 01/03 | SQLite Report write failure | failed if writable | completed/Report response 0 |

각 row는 unit 또는 integration test 이름, fixture ID, 최종 DB assertion으로
추적한다.

## Required Tests

### Unit

- runtime config startup validation과 explicit fake selection
- API body/exact-key/length/scenario와 400/413/415/default-route envelope validation
- Bearer rejection과 timing-safe comparison wrapper
- input secret pre-scan
- Run state/timestamp/error/report invariants
- keyset cursor encode/decode/filter binding
- queue permit, bound, wait timeout, shutdown release
- Tool Registry deep-freeze, duplicate/read-only/environment rejection
- Agent/wrapper forbidden-import dependency rule와 immutable/opaque session boundary
- Tool Core input/context/budget/timeout/AbortSignal/output byte enforcement
- 5xx deterministic assessment threshold와 low-sample/no-series cases
- Loki/health output schema와 no-data/malformed mapping
- Evidence typed payload/provenance, strict RFC 3339/calendar/time-order validator,
  RFC 8785 16/64 KiB boundaries
- redaction과 exact loaded-secret scan, false-positive fixtures
- sanitized Tool Error JSON Schema/catalog와 unknown Tool sentinel
- Report JSON Schema, fixed summary/detected problem/next action, exact canonical
  observation array, status semantic validator
- retention terminal-age/batch behavior

### Integration

- POST -> SQLite/queue -> fake LangChain runner -> fake Tool Core -> Evidence -> Report
  -> GET Run/Evidence/Report
- 네 가지 Report status fixture
- partial Tool failure + positive Evidence precedence
- model status mismatch/malformed structured output
- provider/Tool timeout and actual abort
- SQLite startup recovery-before-listen와 migration failure
- queue full, admission publish/failed-transition double failure, graceful shutdown barrier
- failed Run Evidence 조회와 safe-artifact preservation
- 10,000 fixture rows의 list cursor/filter 중복·누락 검증

### Concurrency, Failure Injection And Profile

- admission saturation with blocked workers
- 10 submitted Run isolation and immutable environment
- atomic total/same-Tool budget under concurrent callback attempt
- late Tool callback after timeout
- provider/source network loss and malformed responses
- SQLite busy/write/Report commit failure
- process restart at DB insert/commit/enqueue/running/Report-insert/completed-CAS points
- wait-timeout/worker-dequeue/shutdown race에서 terminal winner와 permit release-once
- 1,000 Run RSS soak and retained-object inspection

## Implementation Scope

Files/modules:

- `package.json`, lockfile, `tsconfig.json`: pinned runtime and test setup
- `src/server.ts`: startup/shutdown and recovery
- `src/app.ts`: Fastify composition
- `src/config/runtime-config.ts`: current env contract and fail-fast validation
- `src/errors/catalog.ts`: safe API/Run/Tool error codes and messages
- `src/api/auth.ts`: Bearer authentication
- `src/api/routes/runs.ts`: create/list/get/report API
- `src/api/routes/evidence.ts`: sanitized Evidence/Error API
- `src/runs/run-service.ts`: lifecycle and invariants
- `src/runs/run-queue.ts`: permits, queue, workers, shutdown
- `src/runs/run-orchestrator.ts`: Agent/Evidence/Report terminal coordination
- `src/agent/agent-runner.ts`: provider-independent interface
- `src/agent/langchain-runner.ts`: LangChain `createAgent` integration
- `src/agent/provider.ts`: explicit OpenAI/fake adapters
- `src/agent/prompt.ts`: versioned data/policy boundaries
- `src/tools/public.ts`: frozen descriptor와 opaque session interface
- `src/tools/registry.ts`: Tool Core private static registration
- `src/tools/tool-core.ts`: authoritative execution boundary
- `src/tools/backend-5xx-rate.ts`
- `src/tools/backend-error-log-patterns.ts`
- `src/tools/backend-health.ts`
- `src/tools/adapters/fake/*`: current-only deterministic source adapters
- `src/evidence/normalizer.ts`, `src/evidence/validator.ts`
- `src/reports/validator.ts`, `src/reports/outcome-resolver.ts`
- `src/security/redaction.ts`, `src/security/secret-scan.ts`
- `src/storage/sqlite-repository.ts`, `migrations/*.sql`
- `src/observability/logger.ts`, `src/observability/metrics.ts`
- `schemas/evidence.schema.json`, `schemas/tool-error.schema.json`,
  `schemas/monitoring-report.schema.json`
- `tests/fixtures/p0`, `tests/unit`, `tests/integration`, `tests/load`

Interfaces/contracts:

- PRD 00: product/runtime/LangChain boundary
- PRD 01: API, lifecycle, queue, storage
- PRD 02: Agent, Tool, source assessment, outcome resolver
- PRD 03: Evidence, Tool Error, Report, security, failure semantics

Explicit non-goals:

- PRD 00의 모든 비목표
- 추가 장애 시나리오와 dynamic plugin
- PRD 05 확정 전 Prometheus/Loki/Backend live adapter와 source contract 값
- live failure의 fixture fallback
- production deterministic runner fallback
- 계약에 없는 generic framework abstraction

Migration/rollback:

- migration 전 WAL checkpoint와 SQLite backup 생성·검증
- migration은 forward-only numbered file; 실패 시 startup/admission 중단
- 배포 rollback은 새 admission 중단 -> 최대 10초 drain -> 이전 known-good build
  재배포 -> compatible DB open 또는 검증된 backup restore 순서
- incompatible schema에서 이전 build를 억지로 기동하지 않음
- rollback 뒤 health, stale Run recovery, fixture read를 확인한 후 admission 재개
- fake/deterministic AgentRunner는 test 전용이며 production rollback 수단이 아님

## Legacy Hygiene Boundary

다음은 current test나 implementation input이 아니다.

- `scripts/validate_skeleton.py`
- `scripts/run-amdc-proxy-mcp.sh`
- `config/plugins/**`, `config/keys/**`
- `tests/fixtures/monitoring/**`
- `.claude/**`
- `docs/prd/archive/**`, `dist/archive/**`, MCP hackathon 문서

삭제는 이 PRD의 범위가 아니다. 새 `npm test`와 build가 위 경로를 import하거나
검증 성공 근거로 계산하지 않음을 test/config로 보장한다.

## Development Order

1. Node.js/TypeScript/Fastify/test skeleton과 current-only test command
2. runtime config/error catalog, canonical Evidence/Tool Error/Report schema tests
3. SQLite migration/repository와 Run invariants
4. auth, Run/Evidence API, bounded queue admission/recovery
5. static Tool Registry/Core와 fake Tool 3개
6. source assessment, Evidence Normalizer, outcome resolver
7. fake AgentRunner vertical-slice E2E
8. LangChain runner와 fake ChatModel structured-output tests
9. OpenAI provider adapter
10. concurrency, failure-injection, memory/load tests
11. core rollback drill

PRD 05가 승격된 뒤 별도 순서:

12. source contract schema/artifact와 recorded parser fixtures
13. Prometheus/Loki/Backend dev adapters
14. dev read-only smoke와 full rollback drill

## Completion Boundary

Core implementation complete:

- required unit/integration/concurrency/failure/profile suite 통과
- fixture metrics threshold 충족
- live credential 없이 `npm test` 실행 가능
- current build/test에서 MCP/plugin.yaml runtime reference 0건
- 위 core implementation scope의 required modules 존재

Demo ready는 PRD 05 gate 승격 후에만 판정한다.

Demo ready:

- dev AMDB read-only smoke 1회 성공
- Run/Evidence/Report 재조회와 observation trace 시연
- Report schema/semantic/secret scan 통과
- rollback drill 기록 존재

Not required:

- prod smoke
- Web UI, Trigger, RAG
- mutation/approval execution

prod smoke는 별도 명시 승인 없이 실행하지 않는다.
