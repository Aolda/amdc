import type { AmdcEnvironment } from "../config/env.js";
import type { DiagnosisHandoff } from "../report/diagnosis-handoff.js";

export interface DiagnosticAgentInput {
  readonly symptom: string;
  readonly environment: AmdcEnvironment;
  readonly requestedBy: string;
  readonly receivedAt: string;
}

export type AgentDiagnosisResult = DiagnosisHandoff;

export interface DiagnosticAgentPort {
  diagnose(input: DiagnosticAgentInput): Promise<AgentDiagnosisResult>;
}
