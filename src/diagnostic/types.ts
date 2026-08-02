import type { AmdcEnvironment, DiagnosticRunnerMode } from "../config/env.js";

export interface DiagnosisRequest {
  symptom: string;
  requestedBy: string;
  source: "discord";
  receivedAt: string;
}

export interface DiagnosticRunnerContext {
  environment: AmdcEnvironment;
  runnerMode: DiagnosticRunnerMode;
}

export interface DiagnosisReport {
  status: "mock" | "problem_detected" | "no_problem_detected" | "insufficient_tools";
  summary: string;
  suspectedCause: string;
  recommendedActions: string[];
}

export interface DiagnosisResult {
  report: DiagnosisReport;
}

export interface DiagnosticRunner {
  run(
    request: DiagnosisRequest,
    context: DiagnosticRunnerContext
  ): Promise<DiagnosisResult>;
}
