import assert from "node:assert/strict";
import { test } from "node:test";
import { ConsoleDiagnosticTraceSink } from "../src/observability/diagnostic-trace.js";

test("writes one structured JSON line without raw tool output", async () => {
  const lines: string[] = [];
  const sink = new ConsoleDiagnosticTraceSink((line) => lines.push(line));

  await sink.record({
    event: "tool.finished",
    runId: "run-1",
    occurredAt: "2026-08-27T00:00:00.000Z",
    plugin: "backend",
    tool: "backend_get_health",
    durationMs: 42,
    outcome: "succeeded",
    exitCode: 0
  });

  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    component: "amdc.diagnostic_trace",
    event: "tool.finished",
    runId: "run-1",
    occurredAt: "2026-08-27T00:00:00.000Z",
    plugin: "backend",
    tool: "backend_get_health",
    durationMs: 42,
    outcome: "succeeded",
    exitCode: 0
  });
  assert.doesNotMatch(lines[0], /stdout|stderr|command|healthcheck_url/i);
});

test("writes bounded model completion timing without provider payload", async () => {
  const lines: string[] = [];
  const sink = new ConsoleDiagnosticTraceSink((line) => lines.push(line));

  await sink.record({
    event: "model.finished",
    runId: "run-2",
    occurredAt: "2026-08-28T08:10:00.000Z",
    modelCallIndex: 2,
    activePlugin: "mysql",
    durationMs: 321
  });

  assert.deepEqual(JSON.parse(lines[0]), {
    component: "amdc.diagnostic_trace",
    event: "model.finished",
    runId: "run-2",
    occurredAt: "2026-08-28T08:10:00.000Z",
    modelCallIndex: 2,
    activePlugin: "mysql",
    durationMs: 321
  });
  assert.doesNotMatch(lines[0], /prompt|response|token|body/i);
});

test("writes safe model failure stage and metadata without provider message", async () => {
  const lines: string[] = [];
  const sink = new ConsoleDiagnosticTraceSink((line) => lines.push(line));

  await sink.record({
    event: "model.failed",
    runId: "run-3",
    occurredAt: "2026-08-29T01:19:43.455Z",
    modelCallIndex: 3,
    activePlugin: "system",
    durationMs: 7_848,
    errorName: "ZodError",
    errorStage: "model_call",
    errorDetails: {
      name: "ZodError",
      constructorName: "Error",
      category: "structured_output",
      causes: [],
      validationIssues: [
        { code: "invalid_type", path: ["suspectedCauses", 0, "confidence"] }
      ]
    }
  });

  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.errorStage, "model_call");
  assert.equal(parsed.errorDetails.category, "structured_output");
  assert.deepEqual(parsed.errorDetails.validationIssues, [
    { code: "invalid_type", path: ["suspectedCauses", 0, "confidence"] }
  ]);
  assert.doesNotMatch(lines[0], /prompt|response|body|credential|message/);
});
import { diagnosisDraftSchema } from "../src/agent/langchain-schemas.js";
import { TemporaryDiagnosticPresenter } from "../src/report/temporary-diagnostic-presenter.js";
import { formatDiagnosticPresentationMessages } from "../src/adapters/discord/format-report.js";
import { DiagnosisLedger } from "../src/report/diagnosis-handoff.js";

test("handoff annotations reject old narrative contract and Discord preserves full JSON separately", () => {
  const ledger = new DiagnosisLedger("diag-test");
  const call = ledger.begin({ name: "mysql_get_all_processlist", pluginName: "mysql", description: "Read sessions", readOnly: true, inputSchema: { type: "object" } }, {});
  const body = "긴 관측값 ".repeat(700);
  ledger.finish(call, { ok: true, rawResult: { toolName: call.tool, pluginName: "mysql", source: "mysql", collectedAt: "2026-09-19T00:00:00.000Z", transport: "mysql", rows: [{ body }], appliedFilters: {}, limit: 1, returnedRows: 1, truncated: false } });
  const draft = { completion_reason: "investigation_complete", comments: [{ tool_call_id: call.tool_call_id, comment: { observation: "현재 연결 조회", hypothesis: null, limitation: "이전 시점은 조회하지 않음" }, related_call_ids: [] }] };
  assert.ok(diagnosisDraftSchema.safeParse(draft).success);
  assert.equal(diagnosisDraftSchema.safeParse({ ...draft, suspectedCauses: [], recommendedChecks: [] }).success, false);
  const presentation = new TemporaryDiagnosticPresenter().createPresentation(ledger.assemble("느림", draft));
  const messages = formatDiagnosticPresentationMessages(presentation);
  assert.ok(messages.every(message => message.length <= 1900));
  const text = messages.join("");
  assert.ok(text.includes("현재 연결 조회") && text.includes("이전 시점은 조회하지 않음"));
  assert.match(text, /표시 생략/);
  assert.equal((JSON.stringify(presentation).match(/긴 관측값/g) ?? []).length, 700);
  assert.doesNotMatch(text, /Recommended Actions|Suspected Cause|\*\*Status/);
});
