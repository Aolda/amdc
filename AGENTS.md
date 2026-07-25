# AMDC Agent Guardrails

This file is a control surface, not a README. Keep explanation, architecture,
schemas, and long examples in `docs/`. See `docs/universal-project-agent-contract.md`
and `docs/agent-control-doc-policy.md`.

## Gate

Use PAAR for project work:

- Problem: user, bottleneck, failure condition, or risk.
- Analyze: compare at least two approaches and failure modes.
- Action: bounded scope, interfaces, non-goals, rollback.
- Result: measurable success threshold and verification environment.

PAS: use only for persuasion docs and demo story. Problem: who has which
concrete pain. Agitation: what gets worse. Solution: the minimum credible AMDC
flow.

PAR gates implementation before code or handoff. Problem: the bottleneck is
explicit. Analysis: at least two approaches are compared. Result: success can be
proven with metrics and tests.

If PAR is missing, do not implement. Ask for the smallest missing decision input.

## Required Response Shape

For project progress, feature proposals, implementation requests, and
presentation/doc structure reviews, respond in this order:

```text
[Critical Review]
Gate Status: <blocked | ready_for_design | ready_for_implementation | ready_for_verification>
<weak assumptions, missing metrics, design risks>

[Trade-off Analysis]
<proposed path vs 1-2 alternatives>

[Actionable Next Step]
<decision question, verification scenario, or implementation handoff>
```

## Work Rules

- Think before coding: inspect first; ask only for blocking unknowns.
- Keep it simple: smallest sufficient change; no speculative features.
- Make surgical edits: every changed line must trace to the request or a
  verified prerequisite.
- Define the goal before action: success criteria, non-goals, verification.
- Iterate until verified: run checks, fix failures, or report a concrete blocker.
- Do not claim local success as project success without reproducible evidence.

## AMDC Defaults

- Codex is the default project workbench; root `AGENTS.md` is the canonical
  control surface. Treat `.claude/` files as legacy/reference artifacts unless
  explicitly requested.
- `docs/prd/current/README.md` is the only canonical P0 entrypoint. Read its
  numbered PRDs in order and change the document that owns the affected contract.
- Current P0 axis: `REST API -> LangChain Diagnostic Agent -> AMDC Tool Core ->
  sanitized Evidence -> schema-valid Report`.
- P0 does not use MCP. Files under `docs/prd/archive/` and old MCP config,
  fixtures, and scripts are reference artifacts only.
- LangChain may choose only statically registered read-only Tools. Tool Core
  owns input/env validation, call budgets, timeout, redaction, and execution.
- Direct shell, SSH, provider CLI, arbitrary SQL/HTTP, secret file reads,
  deployment, restart, delete, and mutation are forbidden P0 paths.
- Tests use fake provider and fake Tools by default. Do not require live AMDB or
  OpenAI credentials for unit, integration, or concurrency tests.
- Do not expose credentials, tokens, service account JSON, raw auth output,
  private keys, API keys, or `.env` values in prompts, docs, logs, or reports.
- Explain AMDC as safe reproducible investigation, not "AI runs operations by
  itself."

## Metrics Before Implementation

Consider latency p50/p95/p99, throughput, concurrency, peak RSS, per-item memory
growth, error rate, retry count, RTO, idempotency, duplicate handling, logs,
alerts, and rollback time.

## Extreme Conditions

Stress handoffs against race/lock/retry storms, provider timeout/network loss,
partial failure, duplicate responses, hot-path O(N) scans, queue backlog, worker
exhaustion, memory leaks, permission failure, secret exposure, wrong environment
execution, schema drift, rollback failure, and unreproducible logs.

## Implementation Handoff

Only when `Gate Status: ready_for_implementation`, include:

```text
Implementation Scope:
- Files/modules:
- Interfaces/contracts:
- Explicit non-goals:
- Migration/rollback:

Verification:
- Unit/integration tests:
- Load or concurrency test:
- Memory/profile check:
- Failure injection:
- Success threshold:
```
