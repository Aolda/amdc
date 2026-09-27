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
  fetchFunction: FetchFunction = fetch
): Promise<ToolRuntimeResult> {
  if (tool.execution.type !== "prometheus_http") {
    return failure(tool, "source_unavailable", occurredAt);
  }

  const target = buildTarget(tool.execution, context);
  if (!target.ok) {
    return failure(tool, "source_unavailable", occurredAt);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), tool.timeoutMs);
  const abortFromParent = () => controller.abort();
  context.signal?.addEventListener("abort", abortFromParent, { once: true });

  try {
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
      JSON.parse(body.value);
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

function buildTarget(
  execution: PrometheusHttpToolExecution,
  context: ToolRuntimeContext
): { readonly ok: true; readonly url: URL } | { readonly ok: false } {
  const environmentName = execution.baseUrlEnvironment[context.environment];
  const rawBaseUrl = environmentName
    ? process.env[environmentName]?.trim()
    : undefined;

  if (!rawBaseUrl) {
    return { ok: false };
  }

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
    for (const [name, value] of Object.entries(execution.query)) {
      target.searchParams.set(name, value);
    }

    return { ok: true, url: target };
  } catch {
    return { ok: false };
  }
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
