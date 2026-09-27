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
