import { createDiagnosisPipeline } from "./diagnosis-pipeline-factory.js";
import { MockDiagnosticRunner } from "../diagnostic/mock-diagnostic-runner.js";
import type {
  DiagnosisRequest,
  DiagnosisResult,
  DiagnosticRunnerContext
} from "../diagnostic/types.js";

const mockRunner = new MockDiagnosticRunner();

export async function runDiagnosis(
  request: DiagnosisRequest,
  context: DiagnosticRunnerContext
): Promise<DiagnosisResult> {
  if (context.runnerMode === "mock") {
    return mockRunner.run(request, context);
  }

  const pipeline = createDiagnosisPipeline(context);
  return pipeline.run(request, context);
}
