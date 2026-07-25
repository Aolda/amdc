# AMDC P0 Implementation PRD Package

Status: canonical implementation package  
Package Gate Status: ready_for_design  
Core Contract Gate Status: ready_for_implementation  
Live Source Gate Status: ready_for_design  
Delivery Status: not_started  
Architecture decision date: 2026-07-07  
Last reviewed: 2026-07-22

이 폴더의 문서만 현재 P0 개발 계약으로 사용한다. Notion, archive, 과거
배포본, 기존 MCP config/fixture/script는 의사결정 이력이나 실험 근거일 뿐
구현 기준이 아니다. 과거 자료의 아이디어는 numbered PRD에 반영된 뒤에만
현재 계약이 된다.

Gate Status는 구현 계약의 준비도이고 `Delivery Status`는 실제 코드/검증 진척이다.
API, queue, LangChain/Tool Core, fake adapter, Evidence/Report core는 구현할 수 있지만
live source mapping이 미확정이므로 package 전체는 `ready_for_design`이다. 실행 가능한
P0 코드는 아직 없다.

## 읽기 순서

1. [00-product-scope-and-decisions.md](00-product-scope-and-decisions.md)
   - 제품 문제, LangChain/AMDC 경계, runtime 설정, P0 범위와 비목표
2. [01-api-run-and-storage.md](01-api-run-and-storage.md)
   - HTTP API, 인증, Run lifecycle, queue admission, SQLite 계약
3. [02-agent-tool-core-and-scenario.md](02-agent-tool-core-and-scenario.md)
   - LangChain Agent, Tool Core, 첫 진단 시나리오와 Tool 3개
4. [03-evidence-report-security.md](03-evidence-report-security.md)
   - Evidence, sanitized Tool Error, 7-field Report, redaction, 실패 의미
5. [04-verification-and-handoff.md](04-verification-and-handoff.md)
   - core 지표, 테스트 환경, 파일 경계, 구현 순서, rollback, 완료 조건
6. [05-live-source-integration.md](05-live-source-integration.md)
   - Prometheus/Loki/Backend exact mapping과 dev smoke gate

## 단일 기준 규칙

- 각 계약은 위 문서 중 한 곳에서만 정의한다.
- 다른 문서에서는 소유 PRD를 참조하고 필드나 수치를 독립적으로 재정의하지
  않는다.
- 계약 변경 시 소유 문서, 관련 schema/test, 이 README의 두 상태를 함께
  검토한다.
- 문서 간 충돌이 있으면 번호 순서가 아니라 해당 계약의 `Owns` 문서가 우선한다.
- 구현 진척과 과거 prototype 결과는 PRD가 아니라 별도 progress ledger에
  기록한다.

## 확정된 P0 한 줄

~~~text
Fastify REST API
-> SQLite Run Store + bounded in-process Queue
-> LangChain.js Diagnostic Agent
-> AMDC-owned Tool Core
  -> versioned Prometheus/Loki/AMDB Backend read-only adapters
-> sanitized Evidence
-> schema-valid 7-field Report
~~~

LangChain은 조사 순서, 등록 Tool 선택, 허용된 입력 제안, suspected cause 가설을
담당한다.
API, 환경 고정, queue/상태, 실행, timeout, budget, redaction, Evidence, 저장,
semantic validation은 AMDC가 소유한다. MCP server/client/transport/discovery는
P0 실행 경로에 없다.

## 2026-07-22 Review에서 닫힌 결정

- P0 entry surface는 REST API이며 과거 operator CLI는 제품 범위가 아니다.
- P0 runtime은 단일 Node.js/TypeScript 프로세스다. Python service 분리는 없다.
- Run 환경은 서버가 고정하며 Agent-visible Tool input에 포함하지 않는다.
- sanitized Evidence 조회 API를 제공한다.
- Run status는 `queued | running | completed | failed` 네 개만 사용한다.
- queue slot 예약, Run 저장, enqueue, 202 응답 순서를 정의한다.
- Tool 결과와 Report 상태는 AMDC의 결정표와 semantic validator가 강제한다.
- Evidence, sanitized Tool Error, Report는 각각 canonical JSON Schema를 가진다.
- Trigger, RAG, Web UI, approval execution, mutation은 P0에 포함하지 않는다.

## 2026-07-22 Review에서 남은 결정

- current repository와 검토한 Notion에는 exact Prometheus metric/label/PromQL,
  Loki selector/LogQL, Backend health route/payload의 authoritative 값이 없다.
- 이 값은 과거 MCP 문서에서 추정하지 않는다. PRD 05의 versioned source contract와
  dev fixture가 확정될 때까지 live adapter와 dev smoke는 design gate에 둔다.

## 구현 시작 조건

- 제품/범위/runtime 설정: 00 문서에서 닫힘
- API/상태/저장/admission: 01 문서에서 닫힘
- Agent/Tool/진단 판정 core: 02 문서에서 닫힘
- Evidence/Report/보안/오류: 03 문서에서 닫힘
- core 검증/handoff/rollback: 04 문서에서 닫힘
- live query/route/parser: 05 문서에서 미확정

따라서 core contract만 `ready_for_implementation`, package 전체와 live source는
`ready_for_design`이다. core 구현 완료는 PRD 04, demo 준비는 PRD 05의 smoke가 실제로
통과한 뒤에만 판정한다.
