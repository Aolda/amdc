# PRD 06. Diagnostic Agent And YAML Tool Runtime

Status: draft amendment  
Last reviewed: 2026-08-03  
Owns: Diagnostic Agent 판단 범위, plugin/tool 선택 구조, YAML 기반 Tool Runtime 실행 경계

## Gate Review

[Critical Review]
Gate Status: ready_for_design

Diagnostic Agent가 직접 source query, command, credential, environment를 다루면
LangChain이 사실상 실행 권한을 갖게 된다. AMDC의 핵심 가치는 AI가 운영 환경을
마음대로 조작하는 것이 아니라, 정해진 read-only Tool 안에서 조사 흐름을 판단하게
하는 데 있다.

따라서 Agent는 Tool을 직접 실행하지 않는다. Agent는 입력 증상, 인프라 컨텍스트,
이전 sanitized Evidence를 바탕으로 어떤 plugin과 Tool이 필요한지 선택하고, 실행은
AMDC Tool Runtime에 위임한다. Tool Runtime은 YAML Tool 정의를 읽어 environment,
query, command template, timeout, redaction 정책을 적용하고 결과를 정규화한 뒤
Agent에게 돌려준다.

이 문서는 기존 current PRD의 static Tool Registry 중심 표현을 최신 논의에 맞춰
보완하기 위한 draft amendment다. 이 방향을 확정하면 PRD 00, PRD 02, schema/test
계약을 함께 갱신해야 한다.

[Trade-off Analysis]

Path A: Agent가 LangChain Tool wrapper를 통해 source adapter를 직접 호출한다.

- 코드 경로가 짧고 LangChain 예제와 비슷하다.
- 그러나 endpoint, query, credential, timeout, redaction 정책이 wrapper로 새어
  나가기 쉽다.
- Tool이 많아지면 권한과 실행 정책이 분산된다.

Path B: Agent는 plugin/tool을 선택하고, AMDC Tool Runtime이 YAML 정의를 기반으로
실행한다. Chosen.

- 이전 proxy-mcp 구조의 장점인 YAML 기반 Tool 정의, env 주입, command/query 조립,
  실행 결과 정규화 아이디어를 MCP 없이 유지한다.
- Agent는 판단과 해석에 집중하고, 실행 권한은 AMDC 내부 runtime이 통제한다.
- plugin 단위 lazy loading과 domain-first 조사 흐름을 만들기 쉽다.

Path C: 장애 케이스별 playbook Tool을 만든다.

- 특정 demo는 빠르게 만들 수 있다.
- 하지만 `502_error_tool`처럼 사건별 Tool이 늘어나면 확장성이 떨어지고, Agent가
  진단하는 것이 아니라 고정 체크리스트를 고르는 구조가 된다.

[Actionable Next Step]

Diagnostic vertical slice는 먼저 LangChain.js Agent와 정적 YAML Tool catalog로
구현한다. `system_check_configured_http_health`는 서버 env의 URL로 실제 read-only
HTTP healthcheck를 수행한다. 아직 live source adapter가 연결되지 않은 나머지 Tool은
관찰값을 만들지 않고 sanitized `source_unavailable` Tool Error를 반환한다.

1. `symptom`을 입력으로 받는다.
2. Agent가 문제 범주를 추론해 plugin을 선택한다.
3. 선택한 plugin의 Tool 목록만 Agent-visible하게 제공한다.
4. Agent가 Tool 실행 요청을 만든다.
5. Tool Runtime이 YAML 정의를 기반으로 input/env/permission을 검증한다.
6. 정규화된 관측 결과를 Agent에게 반환한다.
7. Agent가 1차 DiagnosisResult를 생성한다.

## Product Scope

Diagnostic Agent의 제품 목표는 운영자가 입력한 장애 증상 또는 향후 Trigger가 만든
이상 상황을 바탕으로, AMDB 운영 환경의 여러 관측 데이터를 조사하고 Report Agent가
사용할 수 있는 1차 진단 결과를 만드는 것이다.

MVP 입력 예:

~~~text
/diagnose symptom:"AMDB 접속이 안 됩니다"
~~~

Diagnostic Agent는 최종 운영자용 문장을 완성하지 않는다. Agent의 결과는 Report
Agent 또는 report module이 읽을 수 있는 구조화된 판단 자료다.

## Core Principle

Tool은 장애 사례별로 만들지 않는다.

Avoid:

~~~text
502_error_tool
db_connection_error_tool
login_fail_tool
backup_failed_tool
~~~

Use:

~~~text
db plugin
proxy plugin
backend plugin
logs plugin
metrics plugin
network plugin
backup plugin
~~~

Agent는 "502 전용 Tool"을 찾지 않는다. 먼저 "이 증상은 backend/proxy/network/db 중
어떤 범주와 관련이 있는가"를 판단하고, 해당 domain plugin의 Tool 목록을 확인한다.
Tool은 과거 사례 검색 도구가 아니라 현재 운영 환경을 조회하고 검증하는 실제
진단 도구다.

## Runtime Flow

~~~text
Discord / REST API / Trigger
-> runDiagnosis()
-> Diagnostic Agent
-> Plugin Registry
-> selected Plugin Tool descriptors
-> Tool execution request
-> AMDC Tool Runtime
-> YAML Tool definition
-> env/query/command injection
-> read-only source execution
-> redaction / normalization
-> ToolObservation
-> Diagnostic Agent
-> DiagnosisResult
-> Report Agent
~~~

## Component Responsibilities

### Diagnostic Agent

Diagnostic Agent is responsible for:

- 입력된 `symptom` 이해
- 현재 문제 범주 추론
- 필요한 plugin 선택
- 선택된 plugin 안에서 필요한 Tool 선택
- Tool Runtime으로 실행 요청 생성
- ToolObservation 해석
- 1차 원인 후보와 근거 정리
- 추가 확인 필요 항목 정리
- Report Agent에 넘길 DiagnosisResult 생성

Diagnostic Agent must not:

- process environment 직접 읽기
- credential, token, private key 접근
- endpoint URL 직접 조립
- PromQL/LogQL/raw SQL/shell command 직접 생성
- dev/prod environment 임의 변경
- source adapter 직접 호출
- mutation Tool 호출

### Plugin Registry

Plugin Registry는 운영 domain별 Tool 묶음을 관리한다.

Agent가 처음 보는 정보는 plugin 수준의 설명이다.

~~~ts
interface AgentVisiblePluginDescriptor {
  readonly name: string;
  readonly description: string;
  readonly domainHints: readonly string[];
}
~~~

예시:

~~~text
db
- MySQL 상태, connection, slow query, replication 관련 진단 도구 묶음

proxy
- ProxySQL backend 상태, routing, connection pool 관련 진단 도구 묶음

backend
- AMDB Backend health, API error, dependency 상태 관련 진단 도구 묶음

logs
- Loki 기반 에러 로그, 패턴, 시간대별 로그 조회 도구 묶음

metrics
- Prometheus 기반 서비스 지표, resource 지표, error rate 조회 도구 묶음
~~~

Agent가 plugin을 선택하면 그 plugin의 sanitized Tool descriptor만 제공한다.

~~~ts
interface AgentVisibleToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly readOnly: true;
}
~~~

Agent-visible descriptor에는 source URL, env key, credential name, query template,
command template, timeout policy, adapter implementation이 포함되지 않는다.

### Tool Runtime

Tool Runtime is responsible for:

- YAML Tool catalog 로드
- Tool name 중복 검증
- Tool input schema 검증
- server-owned environment 선택
- allowed environment 검증
- env key resolve
- command/query/http request template 조립
- timeout, budget, cancellation 적용
- read-only execution 강제
- raw output redaction
- normalized ToolObservation 생성
- sanitized ToolError 생성

Tool Runtime은 Agent 요청을 그대로 실행하지 않는다. Agent 요청은 Tool name과
schema-valid argument일 뿐이며, 실제 실행 방식은 YAML과 server-owned config에서만
결정된다.

## YAML Tool Definition Contract

YAML은 Tool 실행 계약을 소유한다. Secret 값은 YAML에 쓰지 않고 deployment
environment에서 주입한다.

Example:

~~~yaml
name: backend_error_logs
plugin: logs
description: 최근 AMDB Backend 에러 로그 패턴을 조회한다.
readOnly: true
source: loki
allowedEnvironments:
  - dev
  - prod
timeoutMs: 10000
env:
  required:
    - LOKI_URL
input:
  type: object
  properties:
    windowMinutes:
      type: number
      enum: [5, 10, 30]
    maxPatterns:
      type: number
      minimum: 1
      maximum: 10
  required:
    - windowMinutes
    - maxPatterns
execution:
  type: http
  method: GET
  url: "${LOKI_URL}/loki/api/v1/query_range"
  query:
    query: "{app=\"amdb-backend\"} |= \"error\""
    limit: "${maxPatterns}"
redaction:
  removeHeaders:
    - authorization
  maskPatterns:
    - token
    - password
    - secret
normalization:
  outputKind: log_patterns
~~~

YAML에는 실행 방식과 필요한 env key 이름이 들어갈 수 있지만, 실제 credential 값은
절대 들어가지 않는다.

## Tool Execution Contract

Agent request:

~~~ts
interface ToolExecutionRequest {
  readonly toolName: string;
  readonly args: unknown;
}
~~~

Runtime context:

~~~ts
interface ToolRuntimeContext {
  readonly runId: string;
  readonly toolCallId: string;
  readonly environment: "dev" | "prod";
  readonly referenceTime: Date;
  readonly deadline: Date;
  readonly signal: AbortSignal;
}
~~~

Runtime result:

~~~ts
type ToolRuntimeResult =
  | { ok: true; observation: ToolObservation }
  | { ok: false; error: SanitizedToolError };
~~~

ToolObservation:

~~~ts
interface ToolObservation {
  readonly toolName: string;
  readonly pluginName: string;
  readonly source: "prometheus" | "loki" | "amdb_backend" | "mysql" | "proxysql" | "mock";
  readonly status: "normal" | "warning" | "critical" | "unknown";
  readonly summary: string;
  readonly facts: readonly {
    readonly label: string;
    readonly value: string | number | boolean | null;
    readonly unit?: string;
  }[];
  readonly collectedAt: string;
}
~~~

Raw source response is not passed to Report Agent and is not stored as evidence.
Only sanitized and normalized observations cross the Tool Runtime boundary.

## Diagnostic Agent Output

Diagnostic Agent returns DiagnosisResult.

~~~ts
interface DiagnosisResult {
  readonly symptom: string;
  readonly environment: "dev" | "prod";
  readonly inferredDomains: readonly {
    readonly domain: string;
    readonly reason: string;
  }[];
  readonly observations: readonly ToolObservation[];
  readonly preliminaryFindings: readonly {
    readonly finding: string;
    readonly basis: readonly string[];
    readonly level: "normal" | "warning" | "critical" | "unknown";
  }[];
  readonly suspectedCauses: readonly {
    readonly cause: string;
    readonly reason: string;
    readonly confidence: "low" | "medium" | "high";
  }[];
  readonly recommendedChecks: readonly string[];
  readonly incompleteReasons: readonly string[];
}
~~~

Example diagnosis wording:

~~~text
Backend 로그에서 최근 10분간 database connection timeout 패턴이 반복적으로 확인됨.
Prometheus 기준 Backend 5xx 비율이 직전 baseline보다 높음.
ProxySQL backend server 상태는 정상으로 확인됨.
현재로서는 Backend와 MySQL 연결 구간 문제가 우선 의심됨.
~~~

## Report Agent Boundary

Diagnostic Agent owns:

- 조사할 범주 선택
- Tool 선택
- Tool 실행 요청
- 관측 결과 해석
- 1차 판단 생성

Report Agent owns:

- 운영자 친화적인 리포트 문장 구성
- 근거, 예상 원인, 해결 방법, 추가 확인 사항 정리
- Discord/Web/API 응답 형식 구성
- 운영자 승인 필요 여부 표현

Future extension:

Report Agent may request additional diagnosis.

~~~text
Report Agent:
"현재 근거로는 부족하다. db plugin의 connection 관련 Tool을 추가로 확인해달라."

Diagnostic Agent:
추가 Tool 실행 -> updated DiagnosisResult 반환
~~~

This feedback loop is not MVP. MVP keeps a one-way flow from Diagnostic Agent
to Report Agent.

## MVP Scope

Included:

- Discord `/diagnose` 또는 REST entry에서 `symptom` 수신
- `runDiagnosis()` 호출
- Diagnostic Agent 기본 interface
- Plugin Registry 기본 interface
- YAML Tool catalog loader
- YAML 기반 Tool Runtime
- Agent-visible plugin descriptor
- Agent-visible Tool descriptor
- ToolObservation normalization
- DiagnosisResult 생성

Excluded:

- MCP server/client/transport/discovery
- Agent의 direct shell/SSH/provider CLI 실행
- Agent의 arbitrary PromQL/LogQL/SQL 생성
- production mutation
- Trigger 자동화
- Report Agent의 추가 진단 재요청 loop
- RAG/vector DB 기반 과거 사례 검색
- live Prometheus/Loki/AMDB source mapping 확정

## First Implementation Slice

The first implementation slice should use static YAML Tool descriptors and
LangChain Tool wrappers. Live source adapters are connected later through Tool
Core, not exposed directly to the Agent.

Example plugin:

~~~text
logs
- backend_error_logs

metrics
- backend_5xx_rate

backend
- backend_health
~~~

Expected behavior:

1. Operator sends symptom.
2. Agent decides related domains, for example `backend`, `logs`, `metrics`.
3. Runtime exposes only selected plugin Tool descriptors.
4. Agent requests selected Tool execution.
5. YAML Tool Runtime returns sanitized ToolObservation when a live adapter is
   connected, otherwise sanitized `source_unavailable`.
6. Agent generates DiagnosisResult.
7. Discord adapter returns temporary report-shaped output.

## Success Criteria

- Agent does not receive source URL, credential, env value, or command template.
- Agent can choose plugin/tool from sanitized descriptors.
- Tool Runtime can validate YAML Tool definitions and reject unavailable sources
  without fabricating observations.
- Tool Runtime rejects unknown Tool names and invalid args.
- Tool Runtime returns sanitized ToolObservation or SanitizedToolError.
- DiagnosisResult contains inferred domain, observation, preliminary finding,
  suspected cause, and recommended check.
- Existing Discord adapter can call `runDiagnosis()` without knowing Tool
  Runtime internals.
- Typecheck and build pass.

## Open Questions

- YAML schema format: JSON Schema, Zod-generated JSON Schema, or custom minimal schema.
- Whether plugin lazy loading should be LLM-driven in one step or controlled by
  deterministic domain classifier before Agent sees Tool descriptors.
- Where normalized ToolObservation should be persisted.
- How much previous incident context should be injected before first Tool choice.
- Which real AMDB source should be integrated first: Loki, Prometheus, or AMDB
  Backend API.
