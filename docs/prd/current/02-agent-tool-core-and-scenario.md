# PRD 02. Agent, Tool Core And First Scenario

Status: current  
Last reviewed: 2026-07-22  
Owns: LangChain Agent 권한, Tool interface, Tool Core 실행 순서, 첫 시나리오 판정

## Gate Review

[Critical Review]
Gate Status: ready_for_design

LangChain이 Tool을 선택하는 것과 source를 실행하는 것은 다른 권한이다. Agent가
environment, endpoint, query, timeout을 결정하면 Tool schema를 지켜도 prod 오조회와
정책 우회가 가능하다. P0는 environment를 immutable Run context로 주입하고 모든
LangChain Tool wrapper를 Tool Core의 단일 실행 경로로 만든다.
Core interface와 fake vertical slice는 구현 가능한 수준이지만, 실제 Prometheus,
Loki, Backend의 query/route/response mapping은 현재 저장소와 Notion에 authoritative
값이 없다. live adapter는 PRD 05의 source contract가 확정되기 전 구현하지 않는다.

[Trade-off Analysis]

Tool wrapper가 source adapter를 직접 호출하면 코드가 짧지만 validation, budget,
redaction이 분산된다. Tool Core 한 곳으로 실행을 모으면 wrapper가 단순해지고
failure injection이 가능하다. P0는 sequential execution으로 budget race와 source
burst를 제거하며, parallel Tool call은 후속 성능 요구가 생길 때 검토한다.

[Actionable Next Step]

PRD 04의 core handoff로 fake Tool 3개와 아래 outcome matrix를 contract test로
만든다. 동시에 AMDB owner와 PRD 05의 live source mapping을 닫아야 전체 P0가
`ready_for_implementation`으로 승격된다.

## 첫 진단 시나리오

Scenario ID:

~~~text
backend_5xx_increase
~~~

입력 예:

~~~text
최근 10분 동안 AMDB Backend 5xx가 증가했다.
~~~

조사 목표:

1. Prometheus metric으로 현재 window와 직전 동일 길이 baseline을 비교한다.
2. Loki에서 같은 시간대의 redacted error pattern을 확인한다.
3. AMDB Backend health와 dependency summary를 확인한다.
4. 수집 결과를 canonical Evidence로 정규화한다.
5. AMDC outcome resolver가 허용 Report status를 계산한다.
6. Agent가 그 status 안에서 원인 후보와 다음 확인 항목을 작성한다.

첫 시나리오 이외의 장애 coverage와 자연어 scenario 분류는 P0 완료 조건이 아니다.

## Execution Interfaces

~~~ts
interface ToolExecutionContext {
  readonly runId: string;
  readonly toolCallId: string;
  readonly environment: "dev" | "prod";
  readonly diagnosticReferenceTime: Date;
  readonly deadline: Date;
  readonly signal: AbortSignal;
}

interface PublicToolDescriptor<TInput> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: StandardSchema<TInput>;
}

interface InternalDiagnosticAdapter<TInput, TOutput> {
  readonly descriptor: PublicToolDescriptor<TInput>;
  readonly source: "prometheus" | "loki" | "amdb_backend";
  readonly outputSchema: StandardSchema<TOutput>;
  readonly allowedEnvironments: readonly ("dev" | "prod")[];
  readonly readOnly: true;
  readonly timeoutMs: number;
  readonly sourceContractVersion: string;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}

type ToolCoreResult =
  | { ok: true; evidence: Evidence }
  | { ok: false; error: SanitizedToolError };

interface ToolCoreSession {
  execute(toolName: string, agentArgs: unknown): Promise<ToolCoreResult>;
  close(): void;
}
~~~

`StandardSchema<T>`는 runtime validation과 TypeScript inference를 함께 제공하는
schema implementation을 뜻하며 P0 구현은 Zod를 사용한다.

Environment는 Tool input이 아니다. `POST /v1/runs`에서 검증한 값이 immutable
`ToolExecutionContext.environment`로 주입된다. Agent가 dev Run에서 prod를
선택하거나 덮어쓸 필드가 존재하지 않아야 한다.

`diagnosticReferenceTime`은 queued가 아니라 `queued -> running` 전이 시 서버가 한
번 고정한다. metric current range와 log range는 이 시각에 끝나고, metric baseline은
그 바로 앞의 동일 길이다. 같은 Run의 재호출도 call 시각이 아니라 이 reference를
사용해 비교 가능한 window를 유지한다.

Tool은 startup 시 코드로만 등록하고 descriptor/registry를 deep-freeze한다. duplicate
name, invalid schema,
`readOnly !== true`, enabled environment와 Tool allowlist 불일치는 startup error다.
Agent에는 name, description, sanitized input schema만 노출한다. source, endpoint,
header, credential, query template, output implementation과 internal adapter reference는
노출하지 않는다.

## P0 Tools

### backend_5xx_rate

- source: Prometheus read API
- Agent input: `window_minutes`, allowed `5 | 10 | 30`
- context input: immutable `environment`
- timeout: 10 seconds
- source contract version: `backend_5xx_rate/v1`

Output:

~~~json
{
  "current_range": {"start": "...", "end": "..."},
  "baseline_range": {"start": "...", "end": "..."},
  "request_count": 1000,
  "error_5xx_count": 42,
  "error_rate": 0.042,
  "baseline_request_count": 1200,
  "baseline_error_5xx_count": 5,
  "baseline_error_rate": 0.004,
  "source_assessment": "elevated",
  "reason": "rate_and_delta_threshold_exceeded"
}
~~~

Assessment는 Agent가 아니라 adapter가 계산한다.

- current 또는 baseline request count가 100 미만이면 `insufficient_data`
- current 5xx count >= 5, current rate >= 0.01이고 다음 중 하나면 `elevated`
  - current rate >= baseline rate의 2배
  - current rate - baseline rate >= 0.01
- 그 외는 `not_elevated`
- missing series, NaN/Infinity, 역전된 timestamp, counter/rate 해석 불가는
  `insufficient_data`

`source_assessment=elevated|not_elevated`이면 모든 count/rate는 non-null이다.
`insufficient_data`에서도 동일 field를 유지하되 알 수 없는 값은 null로 보존한다.
reason mapping은 elevated=`rate_and_delta_threshold_exceeded`,
not_elevated=`below_elevation_threshold`, insufficient_data=
`low_sample|missing_series|malformed_series`다. count는 non-negative safe integer,
5xx count는 request count 이하여야 하고 rate는 finite 0-1이어야 한다. adapter가
계산한 rate와 count ratio가 허용 오차 1e-9 안에서 일치해야 한다.

PromQL과 baseline window 계산은 PRD 05에서 확정한 versioned server-owned source
contract에 고정한다.

### backend_error_log_patterns

- source: Loki read API
- Agent input: `window_minutes` (`5 | 10 | 30`), `max_patterns` (1-10)
- context input: immutable `environment`
- timeout: 10 seconds
- source contract version: `backend_error_log_patterns/v1`

Output:

~~~json
{
  "time_range": {"start": "...", "end": "..."},
  "patterns": [
    {"pattern": "dependency request failed: <redacted>", "count": 12,
     "first_seen": "...", "last_seen": "..."}
  ],
  "truncated": false,
  "source_assessment": "errors_observed"
}
~~~

`source_assessment`는 `errors_observed | none_observed | insufficient_data`다. query 성공과
complete window가 확인된 상태에서 redacted pattern이 1개 이상이면
`errors_observed`, 0개면 `none_observed`다. partial page나 server-owned scan limit
전에 중단된 결과는 `insufficient_data`다. malformed timestamp/response는 Evidence가
아니라 `malformed_source_response` Tool Error다. raw log body는 Tool Core를 넘지
않으며 저장·provider 전송하지 않는다. LogQL과 pattern normalization은
PRD 05의 versioned server-owned source contract에 고정한다.

`errors_observed`는 pattern 1-10개, `none_observed`는 정확히 0개다. pattern은
normalized text로 unique하고 count 내림차순, pattern 오름차순으로 정렬한다.
각 `first_seen <= last_seen`이고 둘 다 requested time range 안이어야 한다.

### backend_health

- source: AMDB Backend read-only health API
- Agent input: empty object
- context input: immutable `environment`
- timeout: 5 seconds
- source contract version: `backend_health/v1`

Output:

~~~json
{
  "service_status": "healthy",
  "dependencies": [
    {"name": "database", "status": "healthy"}
  ],
  "checked_at": "...",
  "source_assessment": "healthy"
}
~~~

service/dependency status enum은 `healthy | degraded | unhealthy | unknown`이며
dependency는 최대 20개다. `source_assessment`는 service와 dependency의 worst-of
aggregate이며 `unhealthy > degraded > healthy` 순서다. unknown status나 20개 초과로
truncated된 dependency는 `insufficient_data`다. missing required field는 Evidence가
아니라 `malformed_source_response` Tool Error다. dependency name은 unique다. stale
`checked_at`은 `source_assessment=insufficient_data`로 정규화한다. `checked_at`이 Tool
Core 수신 시각보다 30초 이상 과거이거나 미래이면 stale이다. URL과 auth는
PRD 05의 server-owned adapter가 고정한다.

## Live Source Integration Gate

위 세 Tool의 input/output/assessment 의미는 이 문서가 소유한다. 실제 metric 이름,
label selector, PromQL/LogQL, pagination, Backend health route와 payload mapping은
[PRD 05](05-live-source-integration.md)가 소유한다. 이 값은 Agent input이나 generic
arbitrary query 설정이 아니며, code-reviewed versioned source contract여야 한다.
PRD 05가 `ready_for_implementation`이 되기 전에는 fake adapter로 core를 검증할 수
있지만 live adapter와 dev smoke 완료를 주장할 수 없다.

## Tool Core Enforcement

Run Orchestrator가 persisted Run record에서 private immutable context를 만들고
Tool Core에 전달해 per-Run session을 생성한다. context object와 environment는
Tool Core private state에 보관하며 wrapper나 Agent에 반환하지 않는다. 모든
LangChain Tool wrapper는 자신에게 closure로 주입된 session의 다음 함수만
호출한다.

~~~ts
session.execute(toolName, agentArgs)
~~~

Agent/wrapper가 `runContext`, environment, deadline, credential resolver를
parameter로 전달하거나 새 session을 만들 수 없다. session ID가 필요하면
unguessable opaque value로 Tool Core 내부에서만 관리한다. terminal 전환 시
`close()`한다. 이후 call은 source 실행, Tool Error/observation 저장, Run 상태 변경
없이 internal `session_closed` result로 버린다. 이는 PRD 03의 sanitized Tool Error
catalog가 아니라 late-callback invariant 위반이며 fixed
`internal_policy_violation` log/metric만 남긴다.

Tool Core 순서:

1. call attempt를 atomic per-Run budget에 반영
2. registered Tool 확인
3. Agent input schema validation
4. immutable Run environment와 runtime/Tool allowlist 확인
5. `readOnly === true` 확인
6. same-Tool와 total-call budget 확인
7. server-owned endpoint와 credential resolution
8. Tool별 timeout과 Run deadline을 결합한 `AbortSignal` 적용
9. raw response를 UTF-8 기준 최대 64 KiB에서 중단
10. output schema validation
11. secret scan과 redaction
12. Evidence normalization과 PRD 03 소유 byte budget 확인
13. sanitized `ToolCoreResult`만 Agent와 persistence layer에 반환

invalid/blocked attempt도 total call budget을 소비한다. timeout은 `Promise.race`로
끝내지 않고 실제 HTTP/source operation에 AbortSignal을 전달한다. deadline 이후
결과는 폐기하며 뒤늦은 callback이 state나 DB를 변경하지 못한다.

Unknown Tool이나 direct adapter 호출은 실행되지 않는다. compile-time import
boundary를 둔다. `src/agent/**`와 LangChain wrapper는 frozen public descriptor와
opaque `ToolCoreSession` type만 import할 수 있고 internal registry, adapter,
runtime config, credential resolver import는 lint와 dependency test에서 실패한다.
integration test도 Tool Core 우회를 확인한다. LangChain 제공 call-limit middleware는
defense-in-depth일 뿐 Tool Core의 authoritative budget을 대체하지 않는다.

## Agent Execution Contract

- production runner: LangChain.js v1 `createAgent`
- tools: static P0 wrappers 3개만
- structured output: internal `ReportNarrativeDraft` schema를 `responseFormat`으로
  전달
- model invocations per Run: maximum 6, 최종 Report invocation 포함
- 조사 Tool을 선택할 수 있는 model invocation: maximum 5
- sixth invocation에서는 Tool을 노출하지 않고 sanitized Evidence/Error와 AMDC가
  계산한 allowed status로 Report만 생성
- Tool calls per Run: maximum 8
- same Tool calls per Run: maximum 3
- Tool execution within one Run: sequential; parallel execution 0
- provider timeout per invocation: 15 seconds
- 전체 running wall clock: PRD 01의 60 seconds
- automatic Tool/provider/structured-output retry: 0

Tool-call budget은 Tool Core에 들어오는 세 `DiagnosticTool` call만 센다.
`responseFormat` 구현이 내부적으로 사용하는 structured-output virtual tool은
source를 실행하지 않고 budget에 포함하지 않지만, 해당 provider call은 model
invocation budget과 Run deadline에 포함된다.

`ReportNarrativeDraft` fields:

- `suspected_cause`

AMDC가 소유하는 `status`, fixed `summary`, deterministic `detected_problem`,
canonical `observations`, fixed `recommended_next_action`,
`needs_additional_permission`은 model output으로 받지 않는다. 조사 model
invocation 다섯 번을 사용했어도 여섯 번째 finalization invocation은 예약돼 있다.
여섯 번째 invocation이 또 Tool call을 요구하거나 runner가 일곱 번째 model call을
요청하면 `failed/agent_budget_exhausted`다. finalization response가 shape/semantic
규칙을 위반하면 `failed/invalid_report_generation`, provider timeout/rate
limit/network이면 `failed/provider_failure`, Run deadline이 먼저 도달하면
`failed/run_timeout`이다. model budget failure는 Tool call이 아니므로 sanitized Tool
Error를 만들지 않는다.

여러 Tool call이 한 model message에 포함돼도 Tool Core가 call order대로 하나씩
실행한다. remaining call/time/evidence budget을 넘는 call은 실행하지 않고
sanitized error로 반환한다. Run wall clock이 모든 개별 timeout보다 우선한다.

Agent state, message history, Tool result는 Run마다 새로 만들고 terminal 전환 후
참조를 해제한다. P0는 cross-run memory, checkpoint, resume를 사용하지 않는다.

## Outcome Resolver

Tool별 성공 output을 canonical Evidence assessment로 매핑한다.

- positive: metric `elevated`, log `errors_observed`, health `degraded|unhealthy`
- negative: metric `not_elevated`, log `none_observed`, health `healthy`
- inconclusive: 성공 output의 `insufficient_data` 또는 unknown

failed/blocked Tool은 Evidence를 만들지 않으며 resolver에서는 coverage gap으로
취급한다.

P0 Report status precedence:

| Condition | Allowed Report status |
|---|---|
| positive Evidence가 1개 이상 | `problem_detected` |
| positive 없음 + required Tool에 `source_permission_denied` | `needs_permission` |
| 세 required Tool 모두 coverage-valid negative이고 error/inconclusive 없음 | `no_problem_detected` |
| 그 외: timeout, failure, no-data, budget/deadline 부족 | `insufficient_tools` |

partial failure가 있어도 positive Evidence가 이미 문제를 직접 증명하면
`problem_detected`를 유지하고 실패한 범위를 observations에 명시한다.
같은 Tool을 재호출한 경우 accepted Evidence/Error 전부를 fold한다. 하나라도
positive면 첫 row가 이기고, positive가 없을 때 permission denial이 둘째 row를
이긴다. `no_problem_detected`는 세 Tool 각각에 negative가 1개 이상 있고 그 Run에
Tool Error나 inconclusive Evidence가 하나도 없을 때만 가능하다. metric과 log의
negative window는 같은 `diagnosticReferenceTime`과 같은 `window_minutes`여야 하며,
health `checked_at`은 그 reference의 ±30초 안이어야 한다. 이 coverage가 맞지 않으면
`insufficient_tools`다.
budget 소진은 같은 표로 판정하며 그 자체를 정상 근거로 쓰지 않는다.

valid completed Report에는 canonical observation이 최소 1개 필요하다. Agent가
Evidence나 Tool Error가 하나도 생기기 전에 finalization을 시도하면 AMDC는 user
problem을 근거로 Report를 만들지 않고 `failed/invalid_report_generation`으로
종료한다.

AMDC가 final model call 전에 allowed status와 canonical observations를 계산한다.
Agent는 이 context 안에서 suspected-cause draft만 반환한다. AMDC Report Assembler가
status, summary, detected problem, observations, next action, permission flag를
주입하고 PRD 03의 field/secret validator를 통과시킨다. problem이 아닌 status에서
cause를 주장하거나 draft shape가 잘못되면 `failed/invalid_report_generation`으로
종료한다.

## Untrusted Data Rule

로그, metric label, health message, Tool string은 전부 data다. 그 안의 명령,
prompt, URL, role marker를 system instruction으로 해석하지 않는다. Agent prompt는
policy, user problem, Evidence/Error를 별도 구획과 typed serialization로 전달한다.
Tool data가 registry 밖 호출, environment 변경, secret/config 요청을 지시해도
무시한다.

## Provider Boundary

- `AgentRunner` interface 뒤에 production LangChain/OpenAI adapter와 test-only fake
  adapter를 둔다.
- production provider는 tool calling과 configured structured-output strategy를
  지원해야 startup을 통과한다.
- provider/model ID, prompt version, toolset version을 Run metadata에 저장한다.
- live credential이 없거나 provider가 실패할 때 fake model로 fallback하지 않는다.
- provider timeout/rate limit/network failure는 자동 retry 없이 sanitized failure로
  전달한다.
- unit/integration/concurrency test는 fake model과 fake Tools만 사용한다.

## Verification Ownership

Agent, Tool Core, 첫 시나리오와 outcome resolver의 실행 가능한 성공 기준은
[PRD 04](04-verification-and-handoff.md)가 소유한다.
