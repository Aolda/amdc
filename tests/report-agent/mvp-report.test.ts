import assert from "node:assert/strict";
import test from "node:test";
import { createSecretDetector } from "../../src/report-agent/security.js";
import { ReportAgentError } from "../../src/report-agent/errors.js";
import { createMvpReport, validateMvpReport } from "../../src/report-agent/mvp-report.js";
import { createReportValidators } from "../../src/report-agent/validation.js";
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
function shell(output: string, stream: "stdout" | "stderr" = "stdout"): Input {
  const call = mysql();
  call.result = { toolName: call.tool, pluginName: call.plugin, source: "amdb_backend", collectedAt: at,
    transport: "local_shell", execution: { stdout: "", stderr: "", [stream]: output, exitCode: 0 } };
  call.comment = { observation: "The response alone does not establish a cause.", hypothesis: null, limitation: null };
  return call;
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

test("multiline request stays outside report model input and report output", async () => {
  const input = handoff();
  input.request = "SYMPTOM_INPUT_ONLY\nfirst sample\r\nsecond\tcolumn";
  const model = new Model();
  const report = await createMvpReport(input, { model, containsSecret: scanner });
  assert.equal(model.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(model.calls), /SYMPTOM_INPUT_ONLY/);
  assert.doesNotMatch(JSON.stringify(report), /SYMPTOM_INPUT_ONLY/);
  assert.equal(input.request, "SYMPTOM_INPUT_ONLY\nfirst sample\r\nsecond\tcolumn");
});

test("request still rejects non-text, empty, whitespace-only and oversized input", async () => {
  for (const request of [null, 42, {}, "", "\t\r\n", "x".repeat(4001)]) {
    const input = handoff();
    input.request = request;
    const model = new Model();
    await code(input, "invalid_report_generation", model);
    assert.equal(model.calls.length, 0);
  }
});

test("report output still rejects multiline interpretation", async () => {
  const call = mysql();
  call.comment = { observation: "first\nsecond", hypothesis: null, limitation: null };
  const model = new Model();
  await code(handoff([call]), "invalid_report_generation", model);
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

test("shell JSON scalar echoes are rejected across framing, escaping and both streams", async () => {
  const rawValue = "private-customer-identifier-123";
  const body = JSON.stringify({ details: [{ customer: rawValue }] }, null, 2).replace("[", "[\n");
  const values = [
    body,
    JSON.stringify(rawValue),
    JSON.stringify({ customer: rawValue }).replace("private", "\\u0070rivate"),
    JSON.stringify({ nested: JSON.stringify({ customer: rawValue }) }),
    `{"customer":"${rawValue}","customer":"public"}`,
    `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nTrailer: X-Checksum\r\n\r\n${body}X-Checksum: synthetic-checksum\r\n`,
    `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n${body}`,
    `HTTP/2 200\nContent-Type: application/json\n\n${body}`,
    `HTTP/1.1 200 Connection established\r\n\r\nHTTP/1.1 103 Early Hints\r\nLink: unused\r\n\r\nHTTP/2 200\r\nContent-Type: application/json\r\n\r\n${body}`,
  ];
  for (const stream of ["stdout", "stderr"] as const) {
    for (const value of values) {
      const call = shell(value, stream);
      call.comment = { observation: `Observed ${rawValue}.`, hypothesis: null, limitation: null };
      const model = new Model();
      await code(handoff([call]), "invalid_report_generation", model);
      assert.equal(model.calls.length, 0);
    }
  }
});

test("shell header values and complete non-JSON bodies cannot be echoed", async () => {
  const rawValue = "private-customer-identifier-123";
  for (const output of [
    `HTTP/1.1 200 OK\r\nX-Customer: ${rawValue}\r\n\r\n{}`,
    `HTTP/1.1 204 No Content\r\nX-Customer: ${rawValue}\r\n\r\n`,
    `HTTP/1.1 200 OK\nContent-Type: text/plain\n\n${rawValue}`,
    `HTTP/1.1 200 OK\r\n\r\n\ufeff${JSON.stringify({ customer: rawValue })}\r\n`,
    `${rawValue}\r\n`,
    rawValue,
  ]) {
    const call = shell(output);
    call.comment = { observation: `Observed ${rawValue}.`, hypothesis: null, limitation: null };
    const model = new Model();
    await code(handoff([call]), "invalid_report_generation", model);
    assert.equal(model.calls.length, 0);
  }
});

test("raw shell values cannot return through the model draft either", async () => {
  for (const body of [
    '{"customer":"private-customer-identifier-123"}',
    '{"customer":"private-customer-identifier-123","customer":"public"}',
    '{"customer":"private-customer-identifier-123"}X-Checksum: synthetic-checksum\r\n',
  ]) {
    for (const stream of ["stdout", "stderr"] as const) {
      const call = shell(`HTTP/1.1 200 OK\r\n\r\n${body}`, stream);
      const model = new Model();
      model.result = { suspected_cause: "Observed private-customer-identifier-123." };
      await code(handoff([call]), "invalid_report_generation", model);
      assert.equal(model.calls.length, 1);
    }
  }
});

test("serialized JSON values share the same guard for HTTP and MySQL", async () => {
  const body = JSON.stringify({ nested: '{"customer":"private-customer-identifier-123","customer":"public"}' });
  const sqlCall = mysql();
  (sqlCall.result as Input).rows = [{ body }];
  const httpCall = mysql();
  httpCall.result = { toolName: httpCall.tool, pluginName: httpCall.plugin, source: "amdb_backend", collectedAt: at,
    transport: "http", response: { statusCode: 200, contentType: "application/json", body } };
  for (const call of [sqlCall, httpCall]) {
    call.comment = { observation: "Observed private-customer-identifier-123.", hypothesis: null, limitation: null };
    const model = new Model();
    await code(handoff([call]), "invalid_report_generation", model);
    assert.equal(model.calls.length, 0);
  }
});

test("raw text parsing preserves normal comments and existing transport metadata", async () => {
  for (const output of ["", "HTTP/1.1 200 OK\r\n\r\n{invalid json", "plain diagnostic output", '{"details":["private-customer-identifier-123"]}']) {
    const model = new Model();
    const report = await createMvpReport(handoff([shell(output)]), { model, containsSecret: scanner });
    assert.equal(model.calls.length, 1);
    assert.equal(report.observations[0].execution_summary, "로컬 수집 실행 완료; 종료 코드 0.");
    assert.equal(report.observations[0].diagnostic_comment?.observation, "The response alone does not establish a cause.");
    assert.doesNotMatch(JSON.stringify(model.calls) + JSON.stringify(report), /private-customer-identifier-123|invalid json|plain diagnostic output/);
  }
  const http = shell("");
  http.result = { toolName: http.tool, pluginName: http.plugin, source: "amdb_backend", collectedAt: at,
    transport: "http", response: { statusCode: 200, contentType: "application/json", body: '{"customer":"private-customer-identifier-123"}' } };
  http.comment = { observation: "Observed private-customer-identifier-123.", hypothesis: null, limitation: null };
  const model = new Model();
  await code(handoff([http]), "invalid_report_generation", model);
  assert.equal(model.calls.length, 0);
});

test("decoded shell JSON still obeys depth and node budgets", async () => {
  for (const body of ["[".repeat(41) + '"private-customer-identifier-123"' + "]".repeat(41), JSON.stringify(Array(65537).fill(0))]) {
    const model = new Model();
    await code(handoff([shell(`HTTP/1.1 200 OK\r\n\r\n${body}`)]), "invalid_report_generation", model);
    assert.equal(model.calls.length, 0);
  }
});

test("draft and final cause limits agree on Unicode code points", async () => {
  const validators = createReportValidators({ containsSecret: scanner });
  for (const length of [299, 300]) {
    const cause = "A".repeat(length - 20) + "😀".repeat(20);
    assert.equal([...cause].length, length);
    assert.equal(validators.draft({ suspected_cause: cause }).suspected_cause, cause);
    const model = new Model(); model.result = { suspected_cause: cause };
    const report = await createMvpReport(handoff(), { model, containsSecret: scanner });
    assert.equal(report.suspected_cause, cause);
    assert.equal(model.calls.length, 1);
    assert.equal(validateMvpReport(report, scanner).suspected_cause, cause);
  }
  const cause = "A".repeat(281) + "😀".repeat(20);
  assert.throws(() => validators.draft({ suspected_cause: cause }), /invalid_report_generation/);
  const model = new Model(); model.result = { suspected_cause: cause };
  await code(handoff(), "invalid_report_generation", model);
  const report = await createMvpReport(handoff(), { model: new Model(), containsSecret: scanner });
  assert.throws(() => validateMvpReport({ ...report, suspected_cause: cause }, scanner), /invalid_report_generation/);
});
