export interface DiagnosticPresentation {
  readonly status: "mock" | "problem_detected" | "no_problem_detected" | "insufficient_tools";
  readonly summary: string;
  readonly suspectedCause: string;
  readonly recommendedActions: readonly string[];
}
