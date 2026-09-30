import type { AgentDiagnosisResult } from "../agent/types.js";
import type { DiagnosticPresentation } from "./types.js";

// Temporary presenter for the diagnostic-agent skeleton.
// The final Report Agent is intentionally out of scope for this slice.
export class TemporaryDiagnosticPresenter {
  createPresentation(diagnosis: AgentDiagnosisResult): DiagnosticPresentation {
    const hasCritical = diagnosis.observations.some(
      (observation) => observation.status === "critical"
    );
    const hasWarning = diagnosis.observations.some(
      (observation) => observation.status === "warning"
    );

    return {
      status: hasCritical || hasWarning
        ? "problem_detected"
        : diagnosis.toolErrors.length > 0 || diagnosis.observations.length === 0 ||
          (diagnosis.rawResults?.length ?? 0) > 0 || diagnosis.incompleteReasons.length > 0 ||
          diagnosis.observations.some(observation => observation.status !== "normal") ||
          diagnosis.preliminaryFindings.some(finding => finding.level !== "normal")
          ? "insufficient_tools"
          : "no_problem_detected",
      summary: buildSummary(diagnosis),
      suspectedCause: diagnosis.suspectedCauses[0]?.cause ?? "Unknown",
      recommendedActions:
        diagnosis.recommendedChecks.length > 0
          ? [...diagnosis.recommendedChecks]
          : ["Review the structured diagnosis result and run additional read-only checks if needed."]
    };
  }
}

function buildSummary(diagnosis: AgentDiagnosisResult): string {
  const domains = diagnosis.inferredDomains.map((domain) => domain.domain).join(", ");
  const finding = diagnosis.preliminaryFindings[0]?.finding ?? "No preliminary finding.";

  return `Domains: ${domains || "unknown"}. ${finding}`;
}
