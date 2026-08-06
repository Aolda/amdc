import type {
  SanitizedToolError,
  ToolDefinition,
  ToolObservation,
  ToolRuntimeContext,
  ToolRuntimeResult
} from "../types.js";

export async function executeConfiguredHttpHealth(
  tool: ToolDefinition,
  context: ToolRuntimeContext,
  occurredAt: string
): Promise<ToolRuntimeResult> {
  const target = readTargetUrl(context);

  if (!target.ok) {
    return {
      ok: false,
      error: buildToolError(tool, target.code, target.message, occurredAt)
    };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), tool.timeoutMs);
  const abortFromParent = () => controller.abort();
  context.signal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const response = await fetch(target.url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "application/json,text/plain,*/*"
      }
    });
    const latencyMs = Date.now() - startedAt;

    return {
      ok: true,
      observation: {
        toolName: tool.name,
        pluginName: tool.pluginName,
        source: tool.source,
        status: statusFromHttpStatus(response.status),
        summary: summaryFromHttpStatus(response.status, latencyMs),
        facts: [
          { label: "target", value: "configured_http_health" },
          { label: "status_code", value: response.status },
          { label: "latency_ms", value: latencyMs, unit: "ms" },
          { label: "redirected", value: response.status >= 300 && response.status < 400 }
        ],
        collectedAt: occurredAt
      }
    };
  } catch (error) {
    const code =
      error instanceof Error && error.name === "AbortError"
        ? "tool_timeout"
        : "source_request_failed";

    return {
      ok: false,
      error: buildToolError(tool, code, messageFromFetchError(error), occurredAt)
    };
  } finally {
    clearTimeout(timeout);
    context.signal?.removeEventListener("abort", abortFromParent);
  }
}

function readTargetUrl(
  context: ToolRuntimeContext
):
  | { readonly ok: true; readonly url: URL }
  | {
      readonly ok: false;
      readonly code: SanitizedToolError["code"];
      readonly message: string;
    } {
  const key = `AMDC_${context.environment.toUpperCase()}_HEALTHCHECK_URL`;
  const rawUrl = process.env[key]?.trim();

  if (!rawUrl) {
    return {
      ok: false,
      code: "source_unavailable",
      message: `${key} is not configured.`
    };
  }

  try {
    const url = new URL(rawUrl);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        ok: false,
        code: "source_unavailable",
        message: `${key} must use http or https.`
      };
    }

    if (url.username || url.password) {
      return {
        ok: false,
        code: "source_unavailable",
        message: `${key} must not include credentials.`
      };
    }

    return { ok: true, url };
  } catch {
    return {
      ok: false,
      code: "source_unavailable",
      message: `${key} is not a valid URL.`
    };
  }
}

function statusFromHttpStatus(statusCode: number): ToolObservation["status"] {
  if (statusCode >= 200 && statusCode < 400) {
    return "normal";
  }

  if (statusCode >= 400 && statusCode < 500) {
    return "warning";
  }

  if (statusCode >= 500) {
    return "critical";
  }

  return "unknown";
}

function summaryFromHttpStatus(statusCode: number, latencyMs: number): string {
  if (statusCode >= 200 && statusCode < 400) {
    return `Configured HTTP health endpoint responded successfully in ${latencyMs} ms.`;
  }

  return `Configured HTTP health endpoint returned HTTP ${statusCode} in ${latencyMs} ms.`;
}

function messageFromFetchError(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "Configured HTTP health endpoint timed out.";
  }

  return "Configured HTTP health endpoint request failed.";
}

function buildToolError(
  tool: ToolDefinition,
  code: SanitizedToolError["code"],
  message: string,
  occurredAt: string
): SanitizedToolError {
  return {
    toolName: tool.name,
    pluginName: tool.pluginName,
    code,
    message,
    occurredAt
  };
}
