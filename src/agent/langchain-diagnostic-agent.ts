import { ChatOpenAI } from "@langchain/openai";
import { createAgent, toolStrategy } from "langchain";
import type { AmdcEnvironment } from "../config/env.js";
import { PluginRegistry } from "../tools/plugin-registry.js";
import type {
  ObservationStatus,
  PluginName,
  SanitizedToolError,
  ToolObservation,
  ToolRuntime
} from "../tools/types.js";
import {
  type AgentDiagnosisResult,
  type DiagnosticAgentInput,
  type DiagnosticAgentPort,
  type InferredDomain,
  type PreliminaryFinding,
  type SuspectedCause
} from "./types.js";
import { createAmdcLangChainTools } from "./langchain-tool-wrapper.js";
import { type DiagnosisDraft, diagnosisDraftSchema } from "./langchain-schemas.js";

export interface LangChainDiagnosticAgentOptions {
  readonly model: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
}

export class LangChainDiagnosticAgent implements DiagnosticAgentPort {
  constructor(
    private readonly registry: PluginRegistry,
    private readonly toolRuntime: ToolRuntime,
    private readonly options: LangChainDiagnosticAgentOptions
  ) {}

  async diagnose(input: DiagnosticAgentInput): Promise<AgentDiagnosisResult> {
    const referenceTime = new Date(input.receivedAt);
    const toolDescriptors = this.registry.listAllTools();
    const tools = createAmdcLangChainTools(toolDescriptors, this.toolRuntime, {
      environment: input.environment,
      referenceTime
    });

    const agent = createAgent({
      model: new ChatOpenAI({
        model: this.options.model,
        apiKey: this.options.apiKey,
        temperature: 0,
        configuration: this.options.baseUrl
          ? {
              baseURL: this.options.baseUrl
            }
          : undefined
      }),
      tools,
      responseFormat: toolStrategy(diagnosisDraftSchema),
      systemPrompt: buildSystemPrompt(input.environment)
    });

    const result = await agent.invoke({
      messages: [
        {
          role: "user",
          content: buildUserPrompt(input, toolDescriptors.map((descriptor) => descriptor.name))
        }
      ]
    });

    const draft = diagnosisDraftSchema.parse(result.structuredResponse);
    const toolArtifacts = extractToolArtifacts(result.messages);

    return {
      symptom: input.symptom,
      environment: input.environment,
      inferredDomains: toInferredDomains(draft),
      selectedTools: toolDescriptors.filter((descriptor) =>
        toolArtifacts.toolNames.has(descriptor.name)
      ),
      observations: toolArtifacts.observations,
      toolErrors: toolArtifacts.toolErrors,
      preliminaryFindings: toPreliminaryFindings(draft),
      suspectedCauses: toSuspectedCauses(draft),
      recommendedChecks: draft.recommendedChecks,
      incompleteReasons: [
        ...draft.incompleteReasons,
        ...toolArtifacts.toolErrors.map((error) => `${error.toolName}: ${error.message}`)
      ]
    };
  }
}

function buildSystemPrompt(environment: AmdcEnvironment): string {
  return [
    "You are AMDC Diagnostic Agent.",
    "Your job is to inspect AMDB infrastructure state with AMDC-provided read-only tools and produce structured diagnosis data for a separate Report Agent.",
    "Do not write Discord messages. Do not produce the final operator report.",
    "Do not ask for shell, SSH, database credentials, endpoint URLs, PromQL, LogQL, SQL, or arbitrary HTTP access.",
    "Use only the provided AMDC tools. These tools hide endpoints, credentials, query templates, and raw source output.",
    `The server-owned environment is ${environment}. Never change or override it.`,
    "Call tools based on their functional capability, not because a tool is tied to a specific incident case.",
    "Prefer a small set of relevant tools, but use multiple tools when needed to correlate health, logs, metrics, proxy, db, and backup state.",
    "Return structured diagnosis data only."
  ].join("\n");
}

function buildUserPrompt(
  input: DiagnosticAgentInput,
  toolNames: readonly string[]
): string {
  return [
    `Symptom: ${input.symptom}`,
    `Requested by: ${input.requestedBy}`,
    `Received at: ${input.receivedAt}`,
    "",
    "Available AMDC tool names:",
    toolNames.map((name) => `- ${name}`).join("\n"),
    "",
    "Use the tools you need, then return inferred domains, preliminary findings, suspected causes, recommended checks, and incomplete reasons."
  ].join("\n");
}

function extractToolArtifacts(messages: readonly unknown[]): {
  readonly observations: readonly ToolObservation[];
  readonly toolErrors: readonly SanitizedToolError[];
  readonly toolNames: ReadonlySet<string>;
} {
  const observations: ToolObservation[] = [];
  const toolErrors: SanitizedToolError[] = [];
  const toolNames = new Set<string>();

  for (const message of messages) {
    const maybeMessage = message as { content?: unknown; name?: unknown };

    if (typeof maybeMessage.name === "string") {
      toolNames.add(maybeMessage.name);
    }

    const text = typeof maybeMessage.content === "string" ? maybeMessage.content : null;
    if (!text) {
      continue;
    }

    try {
      const parsed = JSON.parse(text) as unknown;
      if (!isRecord(parsed) || typeof parsed.ok !== "boolean") {
        continue;
      }

      if (parsed.ok === true && isRecord(parsed.observation)) {
        observations.push(parsed.observation as unknown as ToolObservation);
      } else if (parsed.ok === false && isRecord(parsed.error)) {
        toolErrors.push(parsed.error as unknown as SanitizedToolError);
      }
    } catch {
      continue;
    }
  }

  return { observations, toolErrors, toolNames };
}

function toInferredDomains(draft: DiagnosisDraft): readonly InferredDomain[] {
  return draft.inferredDomains.map((domain) => ({
    domain: toPluginName(domain.domain),
    reason: domain.reason
  }));
}

function toPreliminaryFindings(draft: DiagnosisDraft): readonly PreliminaryFinding[] {
  return draft.preliminaryFindings.map((finding) => ({
    finding: finding.finding,
    basis: finding.basis,
    level: finding.level as ObservationStatus
  }));
}

function toSuspectedCauses(draft: DiagnosisDraft): readonly SuspectedCause[] {
  return draft.suspectedCauses.map((cause) => ({
    cause: cause.cause,
    reason: cause.reason,
    confidence: cause.confidence
  }));
}

function toPluginName(value: string): PluginName {
  const allowed = new Set(["backend", "backup", "db", "logs", "metrics", "proxy", "system"]);
  return allowed.has(value) ? (value as PluginName) : "system";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
