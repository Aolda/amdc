import assert from "node:assert/strict";
import test from "node:test";
import { ReportAgentError } from "../../src/report-agent/errors.js";
import { createSecretDetector } from "../../src/report-agent/security.js";
import { createMonitoringReportBoundary, type ReportAssemblySource } from "../../src/reports/monitoring-report.js";
import { makeContext, makeInput, REFERENCE_TIME } from "../report-agent/fakes.js";

const boundary = createMonitoringReportBoundary({ containsSecret: createSecretDetector() });
const invalid = (error: unknown) => error instanceof ReportAgentError && error.code === "invalid_report_generation";
type Fixture = Record<string, any>;

function output(input: Fixture, suspected_cause: string | null) {
  return {
    contract_version: "report-agent-output/1.0.0", report_schema_version: "1.1.0",
    run_id: input.run.run_id, suspected_cause,
  };
}

function source(input: Fixture, resultStatus: ReportAssemblySource["resultStatus"], cause: string | null,
  artifacts = makeContext(input).artifacts): ReportAssemblySource {
  return { input, output: output(input, cause), resultStatus,
    context: { ...makeContext(input), artifacts } };
}

function error(code: string, index: number, occurred_at = REFERENCE_TIME) {
  return {
    tool_call_id: `tc_${String(index).padStart(26, "0")}`,
    tool_name: "backend_health", source: "amdb_backend", code,
    retryable: false, occurred_at,
  };
}

function threeNegativeEvidence(): Fixture {
  const input = makeInput() as Fixture;
  const health = input.evidence[0];
  health.assessment = "negative";
  health.severity = "info";
  health.summary = "Backend health is healthy.";
  health.payload.service_status = "healthy";
  health.payload.dependencies[0].status = "healthy";
  health.payload.source_assessment = "healthy";
  health.evidence_id = "ev_00000000000000000000000003";
  health.tool_call_id = "tc_00000000000000000000000003";
  const range = { start: "2026-09-21T23:50:00.000Z", end: REFERENCE_TIME };
  const metric = {
    ...structuredClone(health), evidence_id: "ev_00000000000000000000000001",
    tool_call_id: "tc_00000000000000000000000001", tool_name: "backend_5xx_rate",
    source: "prometheus", source_contract_version: "backend_5xx_rate/v1", category: "metric",
    time_range: range, summary: "5xx rate is not elevated.",
    payload: {
      baseline_range: { start: "2026-09-21T23:40:00.000Z", end: range.start },
      request_count: 1000, error_5xx_count: 2, error_rate: 0.002,
      baseline_request_count: 1000, baseline_error_5xx_count: 2, baseline_error_rate: 0.002,
      source_assessment: "not_elevated", reason: "below_elevation_threshold",
    },
  };
  const log = {
    ...structuredClone(health), evidence_id: "ev_00000000000000000000000002",
    tool_call_id: "tc_00000000000000000000000002", tool_name: "backend_error_log_patterns",
    source: "loki", source_contract_version: "backend_error_log_patterns/v1", category: "log",
    time_range: range, summary: "No backend error patterns were observed.",
    payload: { patterns: [], source_assessment: "none_observed" },
  };
  input.evidence = [metric, log, health];
  input.diagnosis.preliminary_findings = [];
  input.diagnosis.suspected_causes = [];
  input.diagnosis.incomplete_reasons = [];
  return input;
}

test("positive evidence wins over a later timeout and every call keeps its place", () => {
  const input = makeInput() as Fixture;
  const first = input.evidence[0];
  const timeout = error("tool_timeout", 2, "2026-09-22T00:00:01.000Z");
  const last = structuredClone(first);
  last.evidence_id = "ev_00000000000000000000000003";
  last.tool_call_id = "tc_00000000000000000000000003";
  last.collected_at = "2026-09-22T00:00:02.000Z";
  input.evidence.push(last);
  input.tool_errors.push(timeout);
  input.diagnosis.incomplete_reasons = ["A follow-up call timed out."];
  const artifacts = [
    { toolCallId: first.tool_call_id, evidenceId: first.evidence_id },
    { toolCallId: timeout.tool_call_id },
    { toolCallId: last.tool_call_id, evidenceId: last.evidence_id },
  ];
  const current = source(input, "problem_detected", "  A dependency may be degraded.  ", artifacts);
  const report = boundary.assemble(current);
  assert.equal(report.status, "problem_detected");
  assert.equal(report.detected_problem, first.summary);
  assert.deepEqual(report.observations, [
    `[${first.evidence_id}] ${first.summary}`,
    `[tool:${timeout.tool_call_id}/tool_timeout] 도구 호출이 제한 시간 안에 끝나지 않았다.`,
    `[${last.evidence_id}] ${last.summary}`,
  ]);
  assert.equal(report.suspected_cause, "가능성: A dependency may be degraded.");
  assert.deepEqual(boundary.validate(report, current), report);
  assert.throws(() => boundary.validate({ ...report, observations: [...report.observations].reverse() }, current), invalid);
});

test("permission denial without positive evidence gives needs_permission", () => {
  const input = makeInput() as Fixture;
  input.evidence = [];
  input.diagnosis.preliminary_findings = [];
  input.diagnosis.suspected_causes = [];
  const denied = error("source_permission_denied", 1);
  input.tool_errors = [denied];
  input.diagnosis.incomplete_reasons = ["Read-only source access was denied."];
  const current = source(input, "needs_permission", null, [{ toolCallId: denied.tool_call_id }]);
  const report = boundary.assemble(current);
  assert.equal(report.status, "needs_permission");
  assert.equal(report.needs_additional_permission, true);
  assert.equal(report.suspected_cause, null);
  assert.deepEqual(report.observations, [
    `[tool:${denied.tool_call_id}/source_permission_denied] 읽기 전용 원천 조회 권한이 부족했다.`,
  ]);
  assert.throws(() => boundary.assemble({ ...current, resultStatus: "insufficient_tools" }), invalid);
});

test("positive evidence wins over permission denial but preserves the failed call", () => {
  const input = makeInput() as Fixture;
  const denied = error("source_permission_denied", 2, "2026-09-22T00:00:01.000Z");
  input.tool_errors = [denied];
  input.diagnosis.incomplete_reasons = ["A read-only source denied access."];
  const positive = input.evidence[0];
  const current = source(input, "problem_detected", "A dependency may be degraded.", [
    { toolCallId: positive.tool_call_id, evidenceId: positive.evidence_id },
    { toolCallId: denied.tool_call_id },
  ]);
  const report = boundary.assemble(current);
  assert.equal(report.status, "problem_detected");
  assert.equal(report.needs_additional_permission, false);
  assert.deepEqual(report.observations, [
    `[${positive.evidence_id}] ${positive.summary}`,
    `[tool:${denied.tool_call_id}/source_permission_denied] 읽기 전용 원천 조회 권한이 부족했다.`,
  ]);
  assert.throws(() => boundary.assemble({ ...current, resultStatus: "needs_permission" }), invalid);
});

test("a secret-exposure tool error blocks a report even when earlier evidence is positive", () => {
  const input = makeInput() as Fixture;
  const exposure = error("secret_exposure_risk", 2, "2026-09-22T00:00:01.000Z");
  input.tool_errors = [exposure];
  const positive = input.evidence[0];
  const current = source(input, "problem_detected", "A dependency may be degraded.", [
    { toolCallId: positive.tool_call_id, evidenceId: positive.evidence_id },
    { toolCallId: exposure.tool_call_id },
  ]);
  assert.throws(() => boundary.assemble(current),
    (failure: unknown) => failure instanceof ReportAgentError && failure.code === "secret_exposure_risk");
});

test("timeout alone is insufficient, and three aligned negative checks permit no_problem_detected", () => {
  const failed = makeInput() as Fixture;
  failed.evidence = [];
  failed.diagnosis.preliminary_findings = [];
  failed.diagnosis.suspected_causes = [];
  const timeout = error("tool_timeout", 1);
  failed.tool_errors = [timeout];
  const incomplete = boundary.assemble(source(failed, "insufficient_tools", null,
    [{ toolCallId: timeout.tool_call_id }]));
  assert.equal(incomplete.status, "insufficient_tools");
  assert.equal(incomplete.detected_problem, null);

  const input = threeNegativeEvidence();
  const current = source(input, "no_problem_detected", null);
  const report = boundary.assemble(current);
  assert.equal(report.status, "no_problem_detected");
  assert.equal(report.observations.length, 3);
  assert.equal(report.suspected_cause, null);
  assert.deepEqual(boundary.validate(report, current), report);
});

test("negative checks with a mismatched window or stale health cannot claim all clear", () => {
  const mismatched = threeNegativeEvidence();
  mismatched.evidence[1].time_range.start = "2026-09-21T23:55:00.000Z";
  assert.throws(() => boundary.assemble(source(mismatched, "no_problem_detected", null)), invalid);

  const stale = threeNegativeEvidence();
  const checked = "2026-09-22T00:00:31.000Z";
  stale.evidence[2].payload.checked_at = checked;
  stale.evidence[2].time_range = { start: checked, end: checked };
  stale.evidence[2].collected_at = checked;
  assert.throws(() => boundary.assemble(source(stale, "no_problem_detected", null)), invalid);
});

test("stale positive health cannot become a detected problem", () => {
  const input = makeInput() as Fixture;
  const checked = "2026-09-22T00:00:31.000Z";
  input.evidence[0].payload.checked_at = checked;
  input.evidence[0].time_range = { start: checked, end: checked };
  input.evidence[0].collected_at = checked;
  assert.throws(() => boundary.assemble(source(input, "problem_detected", "A dependency may be degraded.")), invalid);
});

test("final field and Run tampering, forbidden cause, and secret text fail closed", () => {
  const input = makeInput() as Fixture;
  const current = source(input, "problem_detected", "A dependency may be degraded.");
  const report = boundary.assemble(current);
  for (const altered of [
    { ...report, summary: "healthy" },
    { ...report, status: "no_problem_detected" },
    { ...report, detected_problem: "different claim" },
    { ...report, extra: "not allowed" },
  ]) assert.throws(() => boundary.validate(altered, current), invalid);
  assert.throws(() => boundary.assemble({ ...current, output: { ...output(input, null), run_id: "run_wrong" } }), invalid);

  const negatives = threeNegativeEvidence();
  assert.throws(() => boundary.assemble(source(negatives, "no_problem_detected", "false claim")), invalid);
  const secretBoundary = createMonitoringReportBoundary({
    containsSecret: createSecretDetector(["fixture-secret-never-live"]),
  });
  const leaked = makeInput() as Fixture;
  leaked.evidence[0].summary = "fixture-secret-never-live";
  assert.throws(() => secretBoundary.assemble(source(leaked, "problem_detected", null)),
    (error: unknown) => error instanceof ReportAgentError && error.code === "secret_exposure_risk");
});
