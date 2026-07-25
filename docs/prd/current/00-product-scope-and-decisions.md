# PRD 00. Product Scope And Decisions

Status: current  
Last reviewed: 2026-07-22  
Owns: 제품 문제, 사용자, 기술 선택, runtime 설정, P0 포함/제외 범위

## Gate Review

[Critical Review]
Gate Status: ready_for_design

AMDB 운영자는 오류 발생 시 MySQL, ProxySQL, FastAPI Backend, 백업 시스템,
Prometheus, Loki/Grafana를 오가며 조사한다. 조사 순서와 결론이 개인 경험에
의존하고, timeout이나 데이터 부재가 정상 상태로 오판될 수 있다.

과거 Notion과 repository에는 Claude Code, MCP server, dynamic plugin, Trigger,
Admin Page를 한 번에 구축하는 설계가 남아 있다. 이 자료의 제품 문제와
read-only 원칙은 승계하지만 실행 구조는 폐기한다. 최신 P0는 단일 REST server의
LangChain.js Diagnostic Agent와 AMDC-owned Tool Core만 구현한다.

P0의 핵심 실패 조건은 Agent가 임의 실행 권한이나 환경 선택권을 얻거나, Tool
실패를 숨긴 채 정상 Report를 만드는 것이다. 따라서 조사 판단은 LangChain이
담당하되 권한, 실행, 상태 의미와 저장은 AMDC가 소유한다.

LangChain 중심 전환과 core 경계는 닫혔지만 실제 AMDB telemetry의 exact
query/route/parser는 authoritative 자료가 없어 PRD 05로 분리했다. 이를 추정한 채
live adapter까지 구현하는 것은 허용하지 않는다.

[Trade-off Analysis]

Path A: LangChain.js `createAgent` + AMDC Tool Core. Chosen.

- 이전 Evidence에 따라 다음 read-only Tool을 고르는 핵심 가치를 검증한다.
- Agent loop는 재사용하면서 실행 경계와 결과 의미를 애플리케이션이 통제한다.
- Tool budget, prompt injection, structured output 실패를 직접 검증해야 한다.

Path B: 직접 LangGraph StateGraph를 설계한다.

- 단계와 전이를 더 세밀하게 통제할 수 있다.
- 단일 시나리오 P0에는 별도 graph state, checkpoint, resume 계약이 과하다.

Path C: 결정론적 진단 playbook.

- 예측 가능하고 테스트하기 쉽다.
- Evidence에 따라 조사 순서를 바꾸는 제품 가치를 검증하지 못한다.

Path D: MCP 기반 Tool runtime.

- discovery와 dispatcher 규격을 재사용할 수 있다.
- 별도 protocol/server 경계를 추가하며 현재 LangChain 중심 제품 구조와 맞지
  않는다.

Node.js REST server와 Python Agent service를 분리하는 안도 검토했지만, P0에서는
배포·인증·timeout·관측성 경계만 늘어난다. Node.js/TypeScript 단일 프로세스를
선택한다.

[Actionable Next Step]

PRD 04의 bounded core handoff로 current-only fixture와 schema validator를 구현할 수
있다. 병행해서 PRD 05의 source mapping을 AMDB owner와 확정한다. legacy MCP
validator의 성공을 현재 구현 진척으로 계산하지 않는다.

## PAS

### Problem

소규모 AMDB 운영팀은 이상 신호를 받은 뒤 무엇부터 확인할지 매번 다시 판단한다.
같은 문제도 담당자에 따라 조회 순서와 결과 형식이 달라진다.

### Agitation

초기 조사 지연은 장애 시간을 늘린다. AI에 shell, credential, 운영 변경 권한을
주면 조사 자동화보다 secret 노출, 잘못된 환경 실행, retry storm 위험이 커진다.

### Solution

운영자가 고정된 P0 시나리오와 자연어 상황을 서버에 제출하면 LangChain.js
Agent가 등록된 read-only Tool 안에서 조사한다. Tool Core가 모든 실행을 검증하고
sanitized Evidence와 고정 Report를 저장해 팀이 같은 `run_id`로 근거와 결론을
재조회한다.

## 제품 이름

P0에서 `AMDC`는 모델 중립적인 제품명이다. 과거 문서의 `Automated Monitor &
Debugger with Claude` 풀이는 historical naming이며 현재 runtime 계약이 아니다.
Claude Code, Codex CLI 또는 로컬 사용자 로그인 세션에 제품 identity를 묶지
않는다.

## 사용자

Primary User: AMDB 운영 개발자

- `backend_5xx_increase` 시나리오와 dev/prod 상황을 제출한다.
- Run 상태, sanitized Evidence, sanitized Tool Error, 최종 Report를 조회한다.
- 다른 운영자에게 `run_id`를 전달해 같은 근거를 재조회한다.

shared Bearer token은 API 접근 주체만 인증한다. `requested_by`는 사용자가 입력한
표시용 label이며 검증된 사용자 identity나 감사 주체로 취급하지 않는다.

## LangChain And AMDC Boundary

LangChain 소유:

- provider/model 호출 loop
- 이전 sanitized Evidence를 바탕으로 다음 등록 Tool 선택
- Agent-visible schema 범위 안의 Tool argument 제안
- Report narrative draft 생성: suspected cause 가설

AMDC 소유:

- REST API, 인증, request/run ID
- Run lifecycle, queue admission, SQLite persistence
- immutable Run environment와 enabled-environment allowlist
- static Tool Registry, Tool Core와 source adapter
- call/model/time/size budget와 실제 취소
- secret scan, redaction, Evidence normalization
- 결과 상태·fixed summary·detected problem·canonical observations·fixed next action·
  permission flag 조립, Report schema 및 semantic validation
- logs, metrics, retention, startup/shutdown recovery

LangChain Tool wrapper는 오직 Tool Core를 호출한다. source adapter, process
environment, credential resolver에 직접 접근하지 않는다. LangChain 내부 구현이
LangGraph를 사용하더라도 P0는 별도 custom graph/checkpoint/resume 계약을 만들지
않는다.

## 확정 결정

| 항목 | P0 결정 |
|---|---|
| 제품 형태 | 여러 운영자가 공유하는 단일 HTTP server |
| Entry surface | REST API only |
| Runtime | Node.js 20+ / TypeScript strict mode, single process |
| HTTP framework | Fastify |
| Agent runtime | LangChain.js v1 public `createAgent` API |
| Structured output | internal suspected-cause draft `responseFormat` + AMDC final assembly |
| LLM runtime | OpenAI ChatModel adapter, model은 명시적 환경 설정 |
| Tool 구조 | TypeScript static Tool Registry + Tool Core |
| MCP | server/client/transport/discovery 모두 사용하지 않음 |
| 저장소 | SQLite single file + repository interface |
| 배포 | single process, single replica |
| 인증 | health endpoint 외 shared Bearer token |
| 환경 | dev 기본, prod는 명시적으로 enable할 때만 허용 |
| 첫 시나리오 | `backend_5xx_increase` |
| 결과 | canonical sanitized Evidence + 7-field JSON Report |
| Live source mapping | PRD 05 versioned source contract; 현재 design gate |

`langchain`, provider package와 transitive dependency는 구현 시 lockfile로 exact
version을 고정한다. PRD는 public API 계약에만 의존하며 minor upgrade는 schema,
budget, tool-call, structured-output contract test를 다시 통과해야 한다.

공식 구현 참고 문서:

- [LangChain JavaScript Agents](https://docs.langchain.com/oss/javascript/langchain/agents)
- [LangChain JavaScript Structured Output](https://docs.langchain.com/oss/javascript/langchain/structured-output)

## Runtime Configuration Contract

P0 runtime은 process environment 또는 deployment secret injection만 사용한다.
tracked `.env`, YAML plugin catalog, credential file은 current 설정 계약이 아니다.

Required base settings:

- `AMDC_AUTH_TOKEN`: `/v1` shared Bearer token
- `AMDC_DATABASE_PATH`: SQLite file path
- `AMDC_AGENT_PROVIDER`: production은 `openai`, test는 명시적 `fake`
- `AMDC_MODEL`: production model ID
- `OPENAI_API_KEY`: production adapter를 선택한 경우만 필수
- `AMDC_ENABLED_ENVIRONMENTS`: 기본 `dev`, 허용값 `dev` 또는 `dev,prod`

각 enabled environment는 다음 server-owned source 설정을 가져야 한다.

- `AMDC_<ENV>_PROMETHEUS_URL`
- `AMDC_<ENV>_LOKI_URL`
- `AMDC_<ENV>_BACKEND_URL`
- 각 source의 `AMDC_<ENV>_<SOURCE>_AUTH_MODE`: `none | bearer`
- auth mode가 bearer이면 `AMDC_<ENV>_<SOURCE>_BEARER_TOKEN`

`<ENV>`는 `DEV | PROD`, `<SOURCE>`는 `PROMETHEUS | LOKI | BACKEND`다. URL은
userinfo, query, fragment를 허용하지 않고 prod는 HTTPS만 허용한다. credential은
deployment secret으로 주입하며 Agent에 env key 이름이나 값을 노출하지 않는다.

enabled environment의 URL/필수 credential, auth token, DB path, production provider
설정이 누락되면 startup을 중단한다. test에서 fake provider와 fake Tools를 쓰는
경우 live provider/source credential을 요구하지 않는다. fake로 자동 fallback하지
않는다. `AMDC_AGENT_PROVIDER=fake`는 `NODE_ENV=test`에서만 허용한다.

## P0 Scenario Admission

`POST /v1/runs`는 `scenario=backend_5xx_increase`만 받는다. `problem`은 해당
시나리오의 시간·증상·운영 맥락을 자연어로 보충한다. 다른 scenario는 Run을
만들지 않고 `422 unsupported_scenario`로 거절한다. 자연어만으로 임의 장애 유형을
분류하거나 추가 Tool을 동적으로 발견하는 기능은 P0가 아니다.

## 포함 범위

- Fastify server와 REST API
- Bearer 인증과 input pre-scan
- Run 생성, 목록, 상태, sanitized Evidence, Report 조회
- SQLite migration과 repository
- bounded in-process queue
- LangChain.js Diagnostic Agent
- OpenAI provider adapter와 test-only fake model
- static Tool Registry와 Tool Core
- 첫 시나리오 read-only Tool 3개
- Evidence normalization, Tool Error sanitization, redaction
- canonical Evidence/Report validation과 semantic result guard
- canonical sanitized Tool Error validation
- structured logs와 최소 metrics
- fixture test; source contract 확정 뒤 dev read-only smoke

## 명시적 비목표

- MCP server/client/compatibility/transport/discovery
- YAML dynamic plugin loading
- 제품 CLI와 Web UI
- custom LangGraph state machine, checkpoint, resume
- distributed queue와 multi-replica
- user account, RBAC, SSO
- Trigger, scheduler, webhook, notification
- RAG, vector DB, 과거 장애 similarity search
- approval execution, mutation, remediation
- shell, SSH, provider CLI, arbitrary SQL/HTTP
- restart, deploy, delete, config 변경
- MySQL, ProxySQL, backup 장애 시나리오 확장
- Run cancellation과 automatic request deduplication

## 후속 Phase

- P1: Report review Web UI, identity/RBAC, PostgreSQL 검토
- P2: Trigger/scheduler, idempotency key, distributed queue, cancellation
- P3: 과거 장애 검색/RAG
- P4: 별도 승인 계약 이후 제한된 조치 검토

각 Phase는 별도 PRD와 PAR gate를 통과해야 한다.
