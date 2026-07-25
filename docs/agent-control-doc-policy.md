# Agent Control Markdown Policy

This policy keeps AI-facing markdown as executable guardrails instead of
README-style explanation.

## Line Budgets

The budgets are practical operating limits, not research-proven magic numbers.

| File type | Target | Rule |
|---|---:|---|
| Root `AGENTS.md`/`CLAUDE.md` | 80-120 lines | Always-loaded, high-signal only. |
| Role agent contract | 100-200 lines | More detail allowed for output contracts. |
| Reference/runbook/schema | No fixed cap | Load only when needed. |
| Journal/thinking log | No fixed cap | Historical record, not control context. |

If a control file exceeds the budget, first split reference material out before
deleting safety rules.

## Classification

- `control`: behavior rules, exact commands, forbidden actions, output shape.
- `reference`: architecture, config schema, runbook, examples, rationale.
- `journal`: dated decisions, migration notes, audit history.

Only `control` files need strict pruning. Long reference docs are acceptable
when they are not injected as default prompt context.

## Keep In Control Files

- Exact verification commands and mandatory success checks.
- Think-before-coding, keep-it-simple, surgical-edit, goal, and verify-loop
  rules.
- Live-system, secret, mutation, and approval boundaries.
- Repeated mistakes as short "do not repeat" constraints.
- Links to the reference docs that hold long explanation.

## Move Out

- Project pitch, motivation, demo narrative.
- Directory tours and framework facts visible from code/config.
- Long JSON/YAML examples, schemas, and command catalogs.
- Historical notes and superseded decisions.
- Vague advice such as "write clean code" or "test thoroughly".

## Rationale

Long-context research shows models can miss relevant information in long inputs,
especially when key details sit in the middle. Vendor docs also recommend clear,
specific project memory. Therefore AMDC keeps always-loaded control docs short
and moves detail into explicit references.

References:

- Lost in the Middle: How Language Models Use Long Contexts
  https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00638/119630/Lost-in-the-Middle-How-Language-Models-Use-Long
- Claude Code memory docs
  https://code.claude.com/docs/en/memory
- AGENTS.md convention
  https://agents.md/

## Verification

Before finishing a control-doc edit:

1. Count root control file lines.
2. Confirm exact validation commands or blockers are documented.
3. Confirm moved content still exists in reference docs.
4. Run `python scripts/validate_skeleton.py` for AMDC skeleton changes.
