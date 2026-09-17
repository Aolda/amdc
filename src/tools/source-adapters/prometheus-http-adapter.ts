import type {
  PrometheusHttpToolExecution,
  SanitizedToolError,
  ToolDefinition,
  ToolRuntimeContext,
  ToolRuntimeResult
} from "../types.js";

const MAX_OUTPUT_BYTES = 64 * 1024;

type FetchFunction = typeof fetch;

export async function executePrometheusHttpTool(
  tool: ToolDefinition,
  context: ToolRuntimeContext,
  occurredAt: string,
  fetchFunction: FetchFunction = fetch,
  args: Record<string, unknown> = {}
): Promise<ToolRuntimeResult> {
  if (tool.execution.type !== "prometheus_http") {
    return failure(tool, "source_unavailable", occurredAt);
  }

  let target;
  try { target = buildTarget(tool.execution, context, args); }
  catch { return failure(tool, "invalid_input", occurredAt); }
  if (!target.ok) {
    return failure(tool, "source_unavailable", occurredAt);
  }

  const controller = new AbortController();
  if (context.signal?.aborted) return failure(tool, "tool_timeout", occurredAt);
  const timeout = setTimeout(() => controller.abort(), tool.timeoutMs);
  const abortFromParent = () => controller.abort();
  context.signal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    if (Object.keys(tool.execution.labelInputs ?? {}).length > 0 && tool.execution.selection !== "series") {
      const lookup = new URL("/api/v1/series", target.url);
      lookup.searchParams.set("match[]", target.url.searchParams.get("query")!);
      const at = target.url.searchParams.get("time");
      lookup.searchParams.set("start", target.url.searchParams.get("start") ?? String(Number(at) - 300));
      lookup.searchParams.set("end", target.url.searchParams.get("end") ?? at!);
      const response = await fetchFunction(lookup, { method: "GET", redirect: "error", signal: controller.signal, headers: { accept: "application/json" } });
      if (response.status === 401 || response.status === 403) return failure(tool, "source_permission_denied", occurredAt);
      if (!response.ok) return failure(tool, "source_request_failed", occurredAt);
      const body = await readBoundedBody(response, controller);
      if (!body.ok) return failure(tool, "tool_output_too_large", occurredAt);
      let parsed;
      try { parsed = JSON.parse(body.value); } catch { return failure(tool, "malformed_source_response", occurredAt); }
      if (parsed?.status !== "success" || !Array.isArray(parsed.data)) return failure(tool, "malformed_source_response", occurredAt);
      if (parsed.data.length === 0) return unobservedLabel(tool, occurredAt);
    }
    const response = await fetchFunction(target.url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { accept: "application/json" }
    });

    if (response.status === 401 || response.status === 403) {
      return failure(tool, "source_permission_denied", occurredAt);
    }

    if (!response.ok) {
      return failure(tool, "source_request_failed", occurredAt);
    }

    const body = await readBoundedBody(response, controller);
    if (!body.ok) {
      return failure(tool, "tool_output_too_large", occurredAt);
    }

    try {
      const parsed = JSON.parse(body.value);
      if (parsed.status !== "success" || !("data" in parsed)) return failure(tool, "malformed_source_response", occurredAt);
      if (tool.execution.selection === "series" && Object.keys(tool.execution.labelInputs ?? {}).length > 0 && Array.isArray(parsed.data) && parsed.data.length === 0) return unobservedLabel(tool, occurredAt);
    } catch {
      return failure(tool, "malformed_source_response", occurredAt);
    }

    if (containsSensitiveSourceOutput(body.value)) {
      return failure(tool, "secret_exposure_risk", occurredAt);
    }

    return {
      ok: true,
      rawResult: {
        toolName: tool.name,
        pluginName: tool.pluginName,
        source: tool.source,
        collectedAt: occurredAt,
        transport: "http",
        response: {
          statusCode: response.status,
          contentType: response.headers.get("content-type"),
          body: body.value
        }
      }
    };
  } catch (error) {
    return failure(
      tool,
      error instanceof Error && error.name === "AbortError"
        ? "tool_timeout"
        : "source_request_failed",
      occurredAt
    );
  } finally {
    clearTimeout(timeout);
    context.signal?.removeEventListener("abort", abortFromParent);
  }
}

function unobservedLabel(tool: ToolDefinition, occurredAt: string): ToolRuntimeResult {
  const result = failure(tool, "invalid_input", occurredAt);
  if (result.ok) return result;
  return { ...result, error: { ...result.error, message: "No series with this metric and label value was observed in the lookup interval. This does not establish a service fault or global absence. The unfiltered metric series tool returns label sets for a specified interval." } };
}

function buildTarget(
  execution: PrometheusHttpToolExecution,
  context: ToolRuntimeContext,
  args: Record<string, unknown>
): { readonly ok: true; readonly url: URL } | { readonly ok: false } {
  const environmentName = execution.baseUrlEnvironment[context.environment];
  const rawBaseUrl = environmentName
    ? process.env[environmentName]?.trim()
    : undefined;

  if (!rawBaseUrl) {
    return { ok: false };
  }

  const parameters = buildPrometheusParameters(execution, args, context.referenceTime);
  try {
    const baseUrl = new URL(rawBaseUrl);
    if (
      (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash ||
      (baseUrl.pathname !== "/" && baseUrl.pathname !== "") ||
      (context.environment === "prod" && baseUrl.protocol !== "https:")
    ) {
      return { ok: false };
    }

    const target = new URL(execution.path, baseUrl);
    for (const [name, value] of Object.entries(parameters)) {
      target.searchParams.set(name, value);
    }

    return { ok: true, url: target };
  } catch {
    return { ok: false };
  }
}

// Only a metric identifier and exact label values enter the fixed selector.
// No agent-supplied operators, functions, paths, or free-form PromQL.
export function buildPrometheusParameters(execution: PrometheusHttpToolExecution, args: Record<string, unknown>, referenceTime: Date): Record<string, string> {
  const parameters = { ...execution.query };
  if (!execution.selection) return parameters;
  const metric = args.metricName;
  if (typeof metric !== "string" || !/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(metric)) throw new Error("invalid_metric");
  if (execution.selection === "metadata") return { ...parameters, metric };
  const matchers = [`__name__=${JSON.stringify(metric)}`];
  for (const [input, label] of Object.entries(execution.labelInputs ?? {})) {
    const value = args[input];
    if (value === undefined) continue;
    if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value)) throw new Error("invalid_label");
    matchers.push(`${label}=${JSON.stringify(value)}`);
  }
  const selector = `{${matchers.join(",")}}`;
  parameters[execution.selection === "series" ? "match[]" : "query"] = selector;
  const timestamp = (value: unknown): number => {
    if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) throw new Error("invalid_time");
    const millis = Date.parse(value);
    if (!Number.isFinite(millis)) throw new Error("invalid_time");
    return millis / 1000;
  };
  if (execution.selection === "instant") {
    parameters.time = String(args.time === undefined ? referenceTime.getTime() / 1000 : timestamp(args.time));
  } else {
    const start = timestamp(args.start), end = timestamp(args.end);
    if (end < start || end - start > 86400) throw new Error("invalid_range");
    parameters.start = String(start); parameters.end = String(end);
    if (execution.selection === "range") {
      const step = args.stepSeconds ?? 60;
      if (typeof step !== "number" || !Number.isInteger(step) || step < 15 || step > 3600 || (end - start) / step + 1 > 1441) throw new Error("invalid_step");
      parameters.step = String(step);
    }
  }
  return parameters;
}

async function readBoundedBody(
  response: Response,
  controller: AbortController
): Promise<{ readonly ok: true; readonly value: string } | { readonly ok: false }> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_OUTPUT_BYTES) {
    controller.abort();
    return { ok: false };
  }

  if (!response.body) {
    return { ok: true, value: "" };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    byteLength += value.byteLength;
    if (byteLength > MAX_OUTPUT_BYTES) {
      controller.abort();
      await reader.cancel();
      return { ok: false };
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, value: new TextDecoder().decode(combined) };
}

function containsSensitiveSourceOutput(value: string): boolean {
  const configuredSecrets = Object.entries(process.env)
    .filter(
      ([name, secret]) =>
        Boolean(secret) &&
        secret!.length >= 8 &&
        /(TOKEN|PASSWORD|SECRET|API_KEY|PRIVATE_KEY|SESSION)/i.test(name)
    )
    .map(([, secret]) => secret as string);

  return (
    configuredSecrets.some((secret) => value.includes(secret)) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i.test(
      value
    )
  );
}

function failure(
  tool: ToolDefinition,
  code: SanitizedToolError["code"],
  occurredAt: string
): ToolRuntimeResult {
  const messages: Record<SanitizedToolError["code"], string> = {
    unknown_tool: "Unknown tool requested.",
    invalid_input: "Tool input did not match the declared schema.",
    environment_not_allowed: "Tool is not allowed in the current environment.",
    tool_timeout: "Tool execution exceeded its deadline.",
    tool_output_too_large: "Tool source response exceeded the allowed size.",
    malformed_source_response: "Tool source response did not match the expected format.",
    source_request_failed: "Tool source request failed.",
    source_permission_denied: "Tool source denied read-only access.",
    source_unavailable: "Tool source is not configured.",
    secret_exposure_risk: "Tool source response contained sensitive data."
  };

  return {
    ok: false,
    error: {
      toolName: tool.name,
      pluginName: tool.pluginName,
      code,
      message: messages[code],
      occurredAt
    }
  };
}
