import { createDiagnosticRunner } from "../diagnostic/diagnostic-runner-factory.js";
import type {
  DiagnosisRequest,
  DiagnosisResult,
  DiagnosticRunnerContext
} from "../diagnostic/types.js";

export async function runDiagnosis(
  request: DiagnosisRequest,
  context: DiagnosticRunnerContext
): Promise<DiagnosisResult> {
  const runner = createDiagnosticRunner(context.runnerMode);
  return runner.run(request, context);
}
