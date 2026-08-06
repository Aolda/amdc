import { PluginRegistry } from "./plugin-registry.js";
import { executeConfiguredHttpHealth } from "./source-adapters/configured-http-health-adapter.js";
import type {
  JsonObjectSchema,
  SanitizedToolError,
  ToolRuntime,
  ToolRuntimeContext,
  ToolRuntimeResult,
  ToolExecutionRequest
} from "./types.js";

export class YamlToolRuntime implements ToolRuntime {
  constructor(private readonly registry: PluginRegistry) {}

  async execute(
    request: ToolExecutionRequest,
    context: ToolRuntimeContext
  ): Promise<ToolRuntimeResult> {
    const tool = this.registry.getTool(request.toolName);
    const occurredAt = context.referenceTime.toISOString();

    if (!tool) {
      return {
        ok: false,
        error: {
          toolName: request.toolName,
          pluginName: null,
          code: "unknown_tool",
          message: "Unknown tool requested.",
          occurredAt
        }
      };
    }

    if (!tool.allowedEnvironments.includes(context.environment)) {
      return {
        ok: false,
        error: buildToolError(tool.name, tool.pluginName, "environment_not_allowed", occurredAt)
      };
    }

    if (!isValidObjectInput(request.args, tool.inputSchema)) {
      return {
        ok: false,
        error: buildToolError(tool.name, tool.pluginName, "invalid_input", occurredAt)
      };
    }

    if (context.signal?.aborted) {
      return {
        ok: false,
        error: buildToolError(tool.name, tool.pluginName, "tool_timeout", occurredAt)
      };
    }

    if (tool.execution.operation === "system_check_configured_http_health") {
      return executeConfiguredHttpHealth(tool, context, occurredAt);
    }

    return {
      ok: false,
      error: buildToolError(tool.name, tool.pluginName, "source_unavailable", occurredAt)
    };
  }
}

function buildToolError(
  toolName: string,
  pluginName: SanitizedToolError["pluginName"],
  code: SanitizedToolError["code"],
  occurredAt: string
): SanitizedToolError {
  const messages: Record<SanitizedToolError["code"], string> = {
    unknown_tool: "Unknown tool requested.",
    invalid_input: "Tool input did not match the declared schema.",
    environment_not_allowed: "Tool is not allowed in the current environment.",
    tool_timeout: "Tool execution exceeded its deadline.",
    source_request_failed: "Tool source request failed.",
    source_unavailable: "Live source adapter is not connected for this read-only tool yet."
  };

  return {
    toolName,
    pluginName,
    code,
    message: messages[code],
    occurredAt
  };
}

function isValidObjectInput(value: unknown, schema: JsonObjectSchema): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const input = value as Record<string, unknown>;
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(input)) {
      if (!(key in properties)) {
        return false;
      }
    }
  }

  for (const key of required) {
    if (!(key in input)) {
      return false;
    }
  }

  for (const [key, rawValue] of Object.entries(input)) {
    const property = properties[key];

    if (!property) {
      continue;
    }

    if (property.type === "number" && typeof rawValue !== "number") {
      return false;
    }

    if (property.type === "string" && typeof rawValue !== "string") {
      return false;
    }

    if (property.type === "boolean" && typeof rawValue !== "boolean") {
      return false;
    }

    if ("enum" in property && property.enum && !property.enum.includes(rawValue as never)) {
      return false;
    }

    if (property.type === "number") {
      if (typeof rawValue !== "number") {
        return false;
      }

      if (property.minimum !== undefined && rawValue < property.minimum) {
        return false;
      }

      if (property.maximum !== undefined && rawValue > property.maximum) {
        return false;
      }
    }

    if (property.type === "string") {
      if (typeof rawValue !== "string") {
        return false;
      }

      if (property.minLength !== undefined && rawValue.length < property.minLength) {
        return false;
      }

      if (property.maxLength !== undefined && rawValue.length > property.maxLength) {
        return false;
      }
    }
  }

  return true;
}
