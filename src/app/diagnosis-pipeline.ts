import type { DiagnosticAgentPort } from "../agent/types.js";
import { TemporaryDiagnosticPresenter } from "../report/temporary-diagnostic-presenter.js";
import type {
  DiagnosisRequest,
  DiagnosisResult,
  DiagnosticRunnerContext
} from "../diagnostic/types.js";

export class DiagnosisPipeline {
  constructor(
    private readonly diagnosticAgent: DiagnosticAgentPort,
    private readonly presenter: TemporaryDiagnosticPresenter
  ) {}

  async run(
    request: DiagnosisRequest,
    context: DiagnosticRunnerContext
  ): Promise<DiagnosisResult> {
    const diagnosis = await this.diagnosticAgent.diagnose({
      symptom: request.symptom,
      environment: context.environment,
      requestedBy: request.requestedBy,
      receivedAt: request.receivedAt
    });

    return {
      diagnosis,
      presentation: this.presenter.createPresentation(diagnosis)
    };
  }
}
