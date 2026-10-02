import type { DiagnosisRequest, DiagnosisResult, DiagnosticRunnerContext } from "../diagnostic/types.js";
import { ReportAgentError } from "../report-agent/errors.js";
import { createMvpReport, validateMvpReport, type MvpReport } from "../report-agent/mvp-report.js";
import type { ReportModelAdapter } from "../report-agent/report-agent.js";
import type { MvpReportStore } from "../reports/mvp-report-store.js";

export interface ReportFlowDependencies {
  readonly diagnose: (request: DiagnosisRequest, context: DiagnosticRunnerContext) => Promise<DiagnosisResult>;
  readonly model: ReportModelAdapter;
  readonly store: MvpReportStore;
  readonly containsSecret: (value: string) => boolean;
}

/** The caller receives only the validated report read back after persistence. */
export function createReportFlow(dependencies: ReportFlowDependencies) {
  return async (request: DiagnosisRequest, context: DiagnosticRunnerContext): Promise<MvpReport> => {
    if (context.runnerMode !== "langchain" || !request.symptom.trim() || request.symptom.length > 4000) {
      throw new ReportAgentError("invalid_report_generation");
    }
    if (dependencies.containsSecret(JSON.stringify(request))) {
      throw new ReportAgentError("secret_exposure_risk");
    }
    const result = await dependencies.diagnose(request, context);
    if (!result.diagnosis) throw new ReportAgentError("invalid_report_generation");
    const report = await createMvpReport(result.diagnosis, dependencies);
    await dependencies.store.save(report);
    const persisted = await dependencies.store.read(report.diagnosis_id);
    if (!persisted || JSON.stringify(persisted) !== JSON.stringify(report)) {
      throw new ReportAgentError("invalid_report_generation");
    }
    return validateMvpReport(persisted, dependencies.containsSecret);
  };
}
