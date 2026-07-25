# AMDC P0 Architecture

Status: current  
Last reviewed: 2026-07-22

구현 계약은 `docs/prd/current/README.md`와 numbered PRD만 기준으로 한다.

```text
Operator
  -> Fastify REST API
  -> SQLite Run Store + bounded in-process Queue
  -> LangChain.js Diagnostic Agent
       -> static LangChain Tool wrappers
       -> AMDC Tool Core
       -> Prometheus / Loki / AMDB Backend read-only adapters
       -> Evidence Normalizer + Sanitized Tool Error
  -> AMDC Outcome Resolver
  -> Report Schema + Semantic Validator
  -> SQLite Evidence / Report Store
  -> Run / Evidence / Report read APIs
```

## Responsibility Boundary

LangChain owns:

- model/provider loop
- registered Tool selection and permitted argument proposal
- Evidence-dependent investigation order
- constrained suspected-cause draft

AMDC owns:

- API/auth, queue/Run lifecycle, SQLite
- immutable Run environment
- Tool Registry/Core and source adapters
- call/time/size budgets and actual abort
- secret scan, redaction, Evidence/Error normalization
- canonical observations/permission flag assembly, allowed Report status,
  schema/semantic validation, persistence

## Trust Boundaries

- Agent-visible Tool input never contains environment, endpoint, credential, or query.
- LangChain Tool wrappers can call only Tool Core, never source adapters directly.
- Tool strings are untrusted data, not instructions.
- raw Tool output and raw model response are bounded in memory and never persisted.
- canonical schema, traceability, semantic guard, and secret scan을 통과한 Evidence와
  Report만 저장한다.
- source/provider failure는 raw message가 아니라 fixed sanitized error code로 남긴다.

## P0 Deployment Boundary

- single Node.js 20+/TypeScript process and single replica
- Fastify REST API; product CLI 없음
- SQLite WAL single file
- bounded in-process queue; exact limits는 PRD 01 소유
- shared Bearer token
- dev enabled by default; prod requires explicit startup enablement
- OpenAI adapter in production, explicit fake adapter in tests
- live Prometheus/Loki/Backend query/route mapping은 PRD 05 source contract gate 뒤에만
  활성화

MCP, dynamic plugins, custom LangGraph state machine, Web UI, distributed queue,
Trigger, RAG, approval execution, mutation/remediation은 P0 아키텍처가 아니다.
