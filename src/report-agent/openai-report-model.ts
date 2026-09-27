import { ChatOpenAI } from "@langchain/openai";
import type { ReportModelAdapter } from "./report-agent.js";

// LiteLLM's JSON-schema endpoint rejects the lookaround in the authoritative
// draft schema. Keep provider structure minimal; createMvpReport validates the
// returned draft against that full schema before accepting it.
const PROVIDER_DRAFT_SCHEMA = {
  type: "object",
  properties: { suspected_cause: { type: ["string", "null"] } },
  required: ["suspected_cause"],
  additionalProperties: false
} as const;

/** Provider wiring only. The report boundary owns validation, budget and timeout. */
export function createOpenAIReportModel(config: { agentModel: string; openaiApiKey?: string; openaiBaseUrl?: string }): ReportModelAdapter {
  const model = new ChatOpenAI({
    model: config.agentModel,
    apiKey: config.openaiApiKey,
    temperature: 0,
    maxTokens: 256,
    maxRetries: 0,
    timeout: 15_000,
    configuration: config.openaiBaseUrl ? { baseURL: config.openaiBaseUrl } : undefined
  });
  return {
    async generate(request, options) {
      if (request.maxOutputTokens !== 256 || request.maxRetries !== 0 || request.tools.length !== 0) {
        throw new Error("Invalid report model request");
      }
      return model.withStructuredOutput(PROVIDER_DRAFT_SCHEMA, { name: "amdc_report_draft", method: "jsonSchema", strict: true })
        .invoke(request.messages.map(message => ({ role: message.role, content: message.content })), { signal: options.signal });
    }
  };
}
