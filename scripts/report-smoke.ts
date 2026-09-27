import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { reportMvpFixture } from "../examples/report-mvp.js";
import { createReportFlow } from "../src/app/report-flow.js";
import { ReportAgentError } from "../src/report-agent/errors.js";
import { createSecretDetector } from "../src/report-agent/security.js";
import { formatMvpDiscordReport } from "../src/reports/mvp-discord-formatter.js";
import { createFileMvpReportStore } from "../src/reports/mvp-report-store.js";

type Mode = "fake" | "live-model";

class SmokeConfigError extends Error {
  constructor(readonly code: string) { super(code); }
}

function providerFailureMetadata(error: unknown): string {
  const source = error !== null && typeof error === "object" ? error as Record<string, unknown> : {};
  const nested = source.error !== null && typeof source.error === "object" ? source.error as Record<string, unknown> : {};
  const knownNames = new Set(["APIError", "BadRequestError", "AuthenticationError", "PermissionDeniedError", "RateLimitError", "InternalServerError", "APIConnectionError", "APIConnectionTimeoutError", "TypeError"]);
  const name = typeof source.name === "string" && knownNames.has(source.name) ? source.name : "other";
  const status = typeof source.status === "number" && Number.isInteger(source.status) && source.status >= 100 && source.status <= 599 ? source.status : "none";
  const knownCodes = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
  const code = typeof source.code === "string" && knownCodes.has(source.code) ? source.code : "none";
  const markers = ["temperature", "max_tokens", "max_completion_tokens", "response_format", "json_schema", "strict", "additionalProperties", "unsupported_parameter", "unsupported_value", "tools", "model_not_found", "invalid_api_key", "insufficient_quota", "minimum", "maximum"] as const;
  const message = [source.message, nested.message].filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
  const flags = markers.filter(marker => message.includes(marker.toLowerCase()));
  const allowedFields = new Set<string>(markers);
  const allowedCodes = new Set(["invalid_request_error", "unsupported_parameter", "unsupported_value", "model_not_found", "invalid_api_key", "insufficient_quota"]);
  const field = [source.param, nested.param].find(value => typeof value === "string" && allowedFields.has(value));
  const providerCode = [source.code, nested.code].find(value => typeof value === "string" && allowedCodes.has(value));
  return `provider_error name=${name} status=${status} code=${code} flags=${flags.join(",") || "none"} param=${field ?? "none"} provider_code=${providerCode ?? "none"}`;
}

async function modelFor(mode: Mode) {
  if (mode === "fake") {
    return {
      model: { async generate() { return { suspected_cause: "잠금 대기가 지연에 기여했을 가능성이 있습니다." }; } },
      containsSecret: createSecretDetector(),
      agentModel: "fake",
    };
  }
  const { config } = await import("dotenv");
  config({ path: resolve(".env"), quiet: true });
  const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
  const agentModel = process.env.AMDC_AGENT_MODEL?.trim();
  const suppliedBaseUrl = process.env.OPENAI_BASE_URL?.trim() || process.env.LITELLM_BASE_URL?.trim();
  const missing = [
    !openaiApiKey && "OPENAI_API_KEY",
    !agentModel && "AMDC_AGENT_MODEL",
    !suppliedBaseUrl && "OPENAI_BASE_URL_or_LITELLM_BASE_URL",
  ].filter(Boolean);
  if (missing.length) throw new SmokeConfigError(`live_model_config_missing:${missing.join(",")}`);
  let openaiBaseUrl: string;
  try {
    const url = new URL(suppliedBaseUrl!);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    openaiBaseUrl = url.toString().replace(/\/$/, "");
  } catch {
    throw new SmokeConfigError("live_model_base_url_invalid");
  }
  const { createOpenAIReportModel } = await import("../src/report-agent/openai-report-model.js");
  const adapter = createOpenAIReportModel({ agentModel: agentModel!, openaiApiKey, openaiBaseUrl });
  return {
    model: { async generate(request: Parameters<typeof adapter.generate>[0], options: Parameters<typeof adapter.generate>[1]) {
      try { return await adapter.generate(request, options); }
      catch (error) { process.stderr.write(providerFailureMetadata(error) + "\n"); throw error; }
    } },
    containsSecret: createSecretDetector([openaiApiKey!]),
    agentModel: agentModel!,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--live-model") || args.length > 1) {
    throw new SmokeConfigError("usage: report-smoke.ts [--live-model]");
  }
  const mode: Mode = args.length ? "live-model" : "fake";
  const configured = await modelFor(mode);
  const diagnosisId = `diag-${randomUUID()}`;
  const directory = resolve(".codex-temp", "report-smoke", diagnosisId);
  const handoff = reportMvpFixture(diagnosisId);
  const flow = createReportFlow({
    diagnose: async () => ({ diagnosis: handoff, presentation: handoff }),
    model: configured.model,
    store: createFileMvpReportStore(directory, configured.containsSecret),
    containsSecret: configured.containsSecret,
  });
  const started = performance.now();
  const report = await flow({
    symptom: "데이터베이스 지연 조사", requestedBy: "synthetic-smoke", source: "api",
    receivedAt: new Date().toISOString(),
  }, { environment: "dev", runnerMode: "langchain", agentModel: configured.agentModel });
  const formatted = formatMvpDiscordReport(report, configured.containsSecret);
  await writeFile(resolve(directory, "amdc-report.md"), formatted.files[0].attachment);
  await writeFile(resolve(directory, "discord-preview.txt"), formatted.content, "utf8");
  process.stdout.write(JSON.stringify({
    mode, directory, diagnosis_id: report.diagnosis_id,
    elapsed_ms: Math.round(performance.now() - started), message_length: formatted.content.length,
  }) + "\n");
}

try {
  await main();
} catch (error) {
  // Provider errors can contain request metadata; only fixed local codes are printable.
  const code = error instanceof SmokeConfigError ? error.code
    : error instanceof ReportAgentError ? error.code : "report_smoke_failed";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
