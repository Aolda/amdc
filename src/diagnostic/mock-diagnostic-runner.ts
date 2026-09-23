import { randomUUID } from "node:crypto";
import type {
  DiagnosisRequest,
  DiagnosisResult,
  DiagnosticRunner,
  DiagnosticRunnerContext
} from "./types.js";

export class MockDiagnosticRunner implements DiagnosticRunner {
  async run(
    request: DiagnosisRequest,
    context: DiagnosticRunnerContext
  ): Promise<DiagnosisResult> {
    return {
      presentation: {
        diagnosis_id: `mock-${randomUUID()}`,
        request: request.symptom,
        completion_reason: "mock",
        observations: []
      }
    };
  }
}
