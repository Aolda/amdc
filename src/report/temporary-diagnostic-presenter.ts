import type { AgentDiagnosisResult } from "../agent/types.js";
import type { DiagnosticPresentation } from "./types.js";

// Preview of the factual handoff. A Report Agent owns final interpretation.
export class TemporaryDiagnosticPresenter {
  createPresentation(diagnosis: AgentDiagnosisResult): DiagnosticPresentation {
    return structuredClone(diagnosis);
  }
}
