import assert from "node:assert/strict";
import test from "node:test";
import { createSecretDetector } from "../../src/report-agent/security.js";
import { DiscordReportFormatError, formatPersistedMonitoringReport } from "../../src/reports/discord-formatter.js";
import { createMonitoringReportBoundary } from "../../src/reports/monitoring-report.js";
import { makeContext, makeInput } from "../report-agent/fakes.js";

const safe = createSecretDetector();
const runId = "run_00000000000000000000000001";

function report() {
  const input = makeInput();
  const output = {
    contract_version: "report-agent-output/1.0.0", report_schema_version: "1.1.0",
    run_id: runId, suspected_cause: "A dependency may be degraded.",
  };
  return createMonitoringReportBoundary({ containsSecret: safe }).assemble({
    input, output, resultStatus: "problem_detected", context: makeContext(input),
  });
}

const invalid = (error: unknown) => error instanceof DiscordReportFormatError &&
  error.code === "discord_format_failed";

test("a validated report projects its stored fields and Run ID without new claims", () => {
  const value = report();
  const text = formatPersistedMonitoringReport(runId, value, safe);
  assert.match(text, /^상태: problem_detected\n요약: 저장된 Evidence에서 문제 신호가 확인되었다\./);
  assert.match(text, /확인된 문제: Backend health is degraded\./);
  assert.match(text, /관찰 결과:\n- \[ev_/);
  assert.match(text, /원인 가설: 가능성: A dependency may be degraded\./);
  assert.match(text, /후속 확인: positive Evidence와 관련 dependency 상태를 수동 확인/);
  assert.ok(text.endsWith(`Run ID: ${runId}`));
  assert.ok(Array.from(text).length <= 1900);
});

test("long observations are omitted only at item boundaries with an exact count", () => {
  const value = report();
  const observations = Array.from({ length: 12 }, (_, index) =>
    `[ev_${String(index + 1).padStart(26, "0")}] ${"가".repeat(450)}`);
  const rendered = formatPersistedMonitoringReport(runId, {
    ...value, observations,
    suspected_cause: `가능성: ${"😀".repeat(400)}`,
  }, safe);
  assert.ok(Array.from(rendered).length <= 1900);
  const included = (rendered.match(/^- \[ev_/gm) ?? []).length;
  assert.ok(included < observations.length);
  assert.match(rendered, new RegExp(`관찰 결과 ${observations.length - included}건 생략`));
  assert.ok(rendered.endsWith(`Run ID: ${runId}`));
  assert.doesNotMatch(rendered, /\uD800(?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  assert.match(rendered, /…/);
});

test("invalid Run, report fields, and secret text fail before channel use", () => {
  const value = report();
  assert.throws(() => formatPersistedMonitoringReport("run_other", value, safe), invalid);
  assert.throws(() => formatPersistedMonitoringReport(runId, { ...value, status: "healthy" }, safe), invalid);
  assert.throws(() => formatPersistedMonitoringReport(runId, { ...value, extra: "forbidden" }, safe), invalid);
  const sentinel = "fixture-secret-never-live";
  const detector = createSecretDetector([sentinel]);
  assert.throws(() => formatPersistedMonitoringReport(runId, {
    ...value, observations: [`[ev_00000000000000000000000001] ${sentinel}`],
  }, detector), invalid);
});

test("a failing final secret detector produces only the safe format error", () => {
  const value = report();
  let scans = 0;
  assert.throws(() => formatPersistedMonitoringReport(runId, value, () => {
    scans += 1;
    if (scans === 2) throw new Error("fixture-secret-never-live");
    return false;
  }), (failure: unknown) => invalid(failure) &&
    failure instanceof Error && !failure.message.includes("fixture-secret-never-live"));
  assert.equal(scans, 2);
});
