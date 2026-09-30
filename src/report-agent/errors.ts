/** Safe local report-boundary failures; no upstream producer error enum is defined here. */
export type ReportAgentErrorCode =
  | "invalid_report_generation"
  | "secret_exposure_risk"
  | "provider_failure"
  | "run_timeout"
  | "agent_budget_exhausted";

export class ReportAgentError extends Error {
  constructor(readonly code: ReportAgentErrorCode) {
    super(code);
    this.name = "ReportAgentError";
  }
}
