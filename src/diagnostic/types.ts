import type { AmdcEnvironment, DiagnosticRunnerMode } from "../config/env.js";
import type { AgentDiagnosisResult } from "../agent/types.js";
import type { DiagnosticPresentation } from "../report/types.js";

export interface DiagnosisRequest {
  symptom: string;
  requestedBy: string;
  source: "api" | "discord" | "trigger";
  receivedAt: string;
}

export interface DiagnosticRunnerContext {
  environment: AmdcEnvironment;
  runnerMode: DiagnosticRunnerMode;
  agentModel: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
}

export interface DiagnosisResult {
  diagnosis?: AgentDiagnosisResult;
  presentation: DiagnosticPresentation;
}

export interface DiagnosticRunner {
  run(
    request: DiagnosisRequest,
    context: DiagnosticRunnerContext
  ): Promise<DiagnosisResult>;
}
