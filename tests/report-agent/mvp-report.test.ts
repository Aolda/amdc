import assert from "node:assert/strict";
import test from "node:test";
import { createSecretDetector } from "../../src/report-agent/security.js";
import { ReportAgentError } from "../../src/report-agent/errors.js";
import { createMvpReport, validateMvpReport } from "../../src/report-agent/mvp-report.js";
import type { ReportModelAdapter, ReportModelRequest } from "../../src/report-agent/report-agent.js";

const diagnosis_id = "diag-123e4567-e89b-42d3-a456-426614174000";
const at = "2026-09-27T00:00:00.000Z";
const scanner = createSecretDetector(["TOP_SECRET"]);
type Input = Record<string, unknown>;
function mysql(seq = 1): Input {
  return {
    seq, tool_call_id: `${diagnosis_id}:call-${seq}`, plugin: "mysql", tool: "mysql_status",
    input: { scope: "system" }, observed_at: at, status: "success", error: null,
    result: { toolName: "mysql_status", pluginName: "mysql", source: "mysql", collectedAt: at,
      transport: "mysql", appliedFilters: {}, limit: 100, rows: [{ body: "private row value" }], returnedRows: 1, truncated: false },
    comment: { observation: "One row was returned; its value is not report evidence.", hypothesis: null, limitation: "The row was not interpreted." },
    related_call_ids: []
  };
}
function failure(seq = 1): Input {
  return {
    seq, tool_call_id: `${diagnosis_id}:call-${seq}`, plugin: "mysql", tool: "mysql_status",
    input: {}, observed_at: at, status: "error", result: null,
    error: { toolName: "mysql_status", pluginName: "mysql", code: "tool_call_limit_reached", message: "Budget exhausted", occurredAt: at },
    comment: null, related_call_ids: []
  };
}
function handoff(observations: Input[] = [mysql()]): Input {
  return { diagnosis_id, request: "Investigate service latency", completion_reason: "investigation_complete", observations };
}
class Model implements ReportModelAdapter {
  calls: ReportModelRequest[] = [];
  result: unknown = { suspected_cause: null };
  async generate(request: ReportModelRequest, _options: { signal: AbortSignal }): Promise<unknown> { this.calls.push(request); return this.result; }
}
async function code(input: unknown, expected: string, model = new Model()) {
  await assert.rejects(createMvpReport(input, { model, containsSecret: scanner }), (error: unknown) =>
    error instanceof ReportAgentError && error.code === expected && !error.message.includes("TOP_SECRET"));
}

test("projects PR14 result metadata, keeps model away from raw payloads, and labels comments as interpretation", async () => {
  const model = new Model();
  model.result = { suspected_cause: "A database query may be involved." };
  const report = await createMvpReport(handoff(), { model, containsSecret: scanner });
  assert.equal(report.schema_version, "diagnosis-report/1.0.0");
  assert.equal(report.suspected_cause, "A database query may be involved.");
  assert.equal(report.observations[0].execution_summary, "MySQL 조회 실행 완료; 반환 행 1건; 결과 잘림: 아니요.");
  assert.equal(report.observations[0].diagnostic_comment?.observation, "One row was returned; its value is not report evidence.");
  assert.equal(model.calls.length, 1);
  assert.equal(model.calls[0].maxOutputTokens, 256);
  assert.equal(model.calls[0].maxRetries, 0);
  assert.deepEqual(model.calls[0].tools, []);
  const exposed = JSON.stringify(model.calls[0]);
  const stored = JSON.stringify(report);
  assert.doesNotMatch(exposed, /Investigate service latency/);
  assert.match(model.calls[0].messages[0].content, /unverified diagnostic-agent interpretations/);
  for (const forbidden of ["private row value", "appliedFilters", "scope", "rows", "result", "input"]) {
    assert.ok(!exposed.includes(`\"${forbidden}\"`) && !stored.includes(`\"${forbidden}\"`), forbidden);
  }
  assert.doesNotMatch(exposed + stored, /private row value/);
  validateMvpReport(report, scanner);
});

test("all-failed and empty handoffs force insufficient evidence without a model call", async () => {
  const model = new Model();
  const failed = await createMvpReport(handoff([failure()]), { model, containsSecret: scanner });
  assert.equal(failed.completion_reason, "insufficient_evidence");
  assert.equal(failed.suspected_cause, null);
  assert.equal(failed.observations[0].error_code, "tool_call_limit_reached");
  assert.match(failed.limitations.join(" "), /실패|부족/);
  const empty = await createMvpReport(handoff([]), { model, containsSecret: scanner });
  assert.equal(empty.completion_reason, "insufficient_evidence");
  assert.match(empty.limitations.join(" "), /도구 호출 기록/);
  assert.equal(model.calls.length, 0);
});

test("transport completion without a diagnostic comment does not ask the model for a cause", async () => {
  const call = mysql(); call.comment = null;
  const model = new Model();
  const report = await createMvpReport(handoff([call]), { model, containsSecret: scanner });
  assert.equal(report.suspected_cause, null);
  assert.equal(model.calls.length, 0);
});

test("failed and truncated calls remain explicit when another call succeeds", async () => {
  const first = mysql();
  (first.result as Input).rows = [{ body: "hidden" }];
  (first.result as Input).limit = 1;
  (first.result as Input).truncated = true;
  const second = failure(2);
  second.related_call_ids = [`${diagnosis_id}:call-1`];
  const report = await createMvpReport(handoff([first, second]), { model: new Model(), containsSecret: scanner });
  assert.match(report.limitations.join(" "), /실패.*잘려/);
  assert.deepEqual(report.observations[1].related_call_ids, [`${diagnosis_id}:call-1`]);
});

test("rejects secret markers anywhere in the complete serialized handoff", async () => {
  for (const mutate of [
    (x: Input) => { ((x.observations as Input[])[0].result as Input).rows = [{ body: "TOP_SECRET" }]; },
    (x: Input) => { ((x.observations as Input[])[0].input as Input).password = "sample-value"; },
    (x: Input) => { ((x.observations as Input[])[0].result as Input).rows = [{ body: '{"password":"synthetic-review-credential"}' }]; },
    (x: Input) => { x.request = "Bearer abcdefghijklmnop"; }
  ]) {
    const input = handoff(); mutate(input);
    await code(input, "secret_exposure_risk");
  }
});

test("rejects bounds, altered references, unknown keys, mock mode and inconsistent transport metadata", async () => {
  const changes = [
    (x: Input) => { x.completion_reason = "mock"; },
    (x: Input) => { x.request = "x".repeat(4001); },
    (x: Input) => { x.extra = true; },
    (x: Input) => { x.diagnosis_id = "diag-1"; },
    (x: Input) => { (x.observations as Input[])[0].seq = 2; },
    (x: Input) => { (x.observations as Input[])[0].related_call_ids = ["foreign:call-1"]; },
    (x: Input) => { ((x.observations as Input[])[0].result as Input).returnedRows = 2; },
    (x: Input) => { ((x.observations as Input[])[0].result as Input).pluginName = "host"; },
    (x: Input) => { ((x.observations as Input[])[0].comment as Input).hypothesis = "curl https://private.example"; },
    (x: Input) => { ((x.observations as Input[])[0].comment as Input).hypothesis = "SELECT * FROM private_customer_table"; },
    (x: Input) => { ((x.observations as Input[])[0].comment as Input).observation = "private row value"; }
  ];
  for (const mutate of changes) { const input = handoff(); mutate(input); await code(input, "invalid_report_generation"); }
  await code(handoff(Array.from({ length: 101 }, (_, i) => mysql(i + 1))), "invalid_report_generation");
  const huge = handoff(); ((huge.observations as Input[])[0].result as Input).rows = [{ body: "x".repeat(1024 * 1024) }];
  await code(huge, "invalid_report_generation");
});

test("model prompt is bounded independently of the accepted raw handoff", async () => {
  const calls = Array.from({ length: 60 }, (_, index) => {
    const call = mysql(index + 1);
    (call.result as Input).rows = [];
    (call.result as Input).returnedRows = 0;
    call.comment = { observation: "x".repeat(1900), hypothesis: null, limitation: null };
    return call;
  });
  const model = new Model();
  await code(handoff(calls), "invalid_report_generation", model);
  assert.equal(model.calls.length, 0);
});

test("invalid model fields and output secrets fail closed with only one invocation", async () => {
  for (const result of [{ suspected_cause: "cause", extra: 1 }, { suspected_cause: "x".repeat(301) }, { suspected_cause: "TOP_SECRET" }, { suspected_cause: "private row value" }, { suspected_cause: "SELECT * FROM private_customer_table" }]) {
    const model = new Model(); model.result = result;
    await code(handoff(), result.suspected_cause === "TOP_SECRET" ? "secret_exposure_risk" : "invalid_report_generation", model);
    assert.equal(model.calls.length, 1);
  }
  const report = await createMvpReport(handoff(), { model: new Model(), containsSecret: scanner });
  await assert.rejects(async () => validateMvpReport({ ...report, extra: true }, scanner), /invalid_report_generation/);
  assert.throws(() => validateMvpReport({ ...report, summary: "SELECT * FROM private_customer_table" }, scanner), /invalid_report_generation/);
  const oversized = {
    ...report,
    observations: Array.from({ length: 100 }, (_, index) => ({ ...report.observations[0], seq: index + 1,
      tool_call_id: `${diagnosis_id}:call-${index + 1}`,
      diagnostic_comment: { observation: "x".repeat(1000), hypothesis: "y".repeat(1000), limitation: "z".repeat(1000) } }))
  };
  assert.throws(() => validateMvpReport(oversized, scanner), /invalid_report_generation/);
});

test("timeout aborts provider signal and consumes late completion without retry", async () => {
  const model = new Model();
  let signal: AbortSignal | undefined;
  let finish!: (value: unknown) => void;
  model.generate = async (request, options) => {
    model.calls.push(request); signal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  };
  const parent = new AbortController();
  const pending = createMvpReport(handoff(), { model, containsSecret: scanner, signal: parent.signal });
  await new Promise(resolve => setImmediate(resolve));
  parent.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof ReportAgentError && error.code === "run_timeout");
  assert.equal(signal?.aborted, true);
  finish({ suspected_cause: "late" });
  assert.equal(model.calls.length, 1);
});

test("absolute deadline rejects a provider result that settles after the event loop deadline", async () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  const model = new Model();
  model.generate = async (request) => {
    model.calls.push(request);
    now += 15_001;
    return { suspected_cause: null };
  };
  try {
    await code(handoff(), "run_timeout", model);
    assert.equal(model.calls.length, 1);
  } finally {
    Date.now = originalNow;
  }
});

test("absolute deadline is rechecked after final report validation", async () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  const model = new Model();
  const advancingScanner = (value: string) => {
    if (value.startsWith("도구 호출 1건 중")) now += 15_001;
    return false;
  };
  try {
    await assert.rejects(createMvpReport(handoff(), { model, containsSecret: advancingScanner }),
      (error: unknown) => error instanceof ReportAgentError && error.code === "run_timeout");
    assert.equal(model.calls.length, 1);
  } finally {
    Date.now = originalNow;
  }
});
