import type { AmdcEnvironment } from "../config/env.js";
import type {
  AgentVisibleToolDescriptor,
  ObservationStatus,
  PluginName,
  SanitizedToolError,
  ToolObservation
} from "../tools/types.js";

export interface DiagnosticAgentInput {
  readonly symptom: string;
  readonly environment: AmdcEnvironment;
  readonly requestedBy: string;
  readonly receivedAt: string;
}

export interface InferredDomain {
  readonly domain: PluginName;
  readonly reason: string;
}

export interface PreliminaryFinding {
  readonly finding: string;
  readonly basis: readonly string[];
  readonly level: ObservationStatus;
}

export interface SuspectedCause {
  readonly cause: string;
  readonly reason: string;
  readonly confidence: "low" | "medium" | "high";
}

export interface AgentDiagnosisResult {
  readonly symptom: string;
  readonly environment: AmdcEnvironment;
  readonly inferredDomains: readonly InferredDomain[];
  readonly selectedTools: readonly AgentVisibleToolDescriptor[];
  readonly observations: readonly ToolObservation[];
  readonly toolErrors: readonly SanitizedToolError[];
  readonly preliminaryFindings: readonly PreliminaryFinding[];
  readonly suspectedCauses: readonly SuspectedCause[];
  readonly recommendedChecks: readonly string[];
  readonly incompleteReasons: readonly string[];
}

export interface DiagnosticAgentPort {
  diagnose(input: DiagnosticAgentInput): Promise<AgentDiagnosisResult>;
}
