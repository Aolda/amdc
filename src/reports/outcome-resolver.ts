import type { ReportAgentInputV1 } from "../report-agent/contracts.js";
import { ReportAgentError } from "../report-agent/errors.js";

export type ReportStatus =
  | "problem_detected"
  | "no_problem_detected"
  | "insufficient_tools"
  | "needs_permission";

const REQUIRED_TOOLS = [
  "backend_5xx_rate",
  "backend_error_log_patterns",
  "backend_health",
] as const;

/** PRD 02's Backend 5xx status priority. Call only after V1 input validation. */
export function resolveReportStatus(input: ReportAgentInputV1): ReportStatus {
  const reference = Date.parse(input.run.diagnostic_reference_time);
  for (const item of input.evidence) {
    if (item.assessment === "inconclusive") continue;
    if (item.tool_name === "backend_health") {
      if (Math.abs(Date.parse(item.payload.checked_at) - reference) > 30_000) {
        throw new ReportAgentError("invalid_report_generation");
      }
    } else {
      const end = Date.parse(item.time_range.end);
      const span = end - Date.parse(item.time_range.start);
      if (end !== reference || ![5, 10, 30].includes(span / 60_000)) {
        throw new ReportAgentError("invalid_report_generation");
      }
    }
  }
  if (input.evidence.some((item) => item.assessment === "positive")) {
    return "problem_detected";
  }
  if (input.tool_errors.some((item) =>
    item.code === "source_permission_denied" && item.tool_name !== "unknown")) {
    return "needs_permission";
  }
  if (input.tool_errors.length > 0 ||
      input.evidence.some((item) => item.assessment !== "negative" || item.truncated)) {
    return "insufficient_tools";
  }

  const coveredTools = new Set(input.evidence.map((item) => item.tool_name));
  if (REQUIRED_TOOLS.some((name) => !coveredTools.has(name))) {
    return "insufficient_tools";
  }

  // Repeated calls cannot silently select one favourable window.
  let windowMs: number | undefined;
  for (const item of input.evidence) {
    if (item.tool_name === "backend_health") {
      if (Math.abs(Date.parse(item.payload.checked_at) - reference) > 30_000) {
        return "insufficient_tools";
      }
      continue;
    }
    const end = Date.parse(item.time_range.end);
    const span = end - Date.parse(item.time_range.start);
    if (end !== reference || ![5, 10, 30].includes(span / 60_000) ||
        (windowMs !== undefined && span !== windowMs)) {
      return "insufficient_tools";
    }
    windowMs = span;
  }
  return "no_problem_detected";
}
