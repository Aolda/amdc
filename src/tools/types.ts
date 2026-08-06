import type { AmdcEnvironment } from "../config/env.js";

export type PluginName = "backend" | "backup" | "db" | "logs" | "metrics" | "proxy" | "system";

export type ToolSource =
  | "amdb_admin_api"
  | "amdb_backend"
  | "cadvisor"
  | "http_health"
  | "loki"
  | "mysql"
  | "prometheus"
  | "proxysql";

export type ObservationStatus = "normal" | "warning" | "critical" | "unknown";

export interface AgentVisiblePluginDescriptor {
  readonly name: PluginName;
  readonly description: string;
  readonly domainHints: readonly string[];
}

export interface AgentVisibleToolDescriptor {
  readonly name: string;
  readonly pluginName: PluginName;
  readonly description: string;
  readonly inputSchema: JsonObjectSchema;
  readonly readOnly: true;
}

export interface JsonObjectSchema {
  readonly type: "object";
  readonly properties?: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export type JsonSchemaProperty =
  | {
      readonly type: "number";
      readonly enum?: readonly number[];
      readonly minimum?: number;
      readonly maximum?: number;
      readonly description?: string;
    }
  | {
      readonly type: "string";
      readonly enum?: readonly string[];
      readonly minLength?: number;
      readonly maxLength?: number;
      readonly description?: string;
    }
  | {
      readonly type: "boolean";
      readonly description?: string;
    };

export interface ToolCatalog {
  readonly plugins: readonly ToolPluginDefinition[];
}

export interface ToolPluginDefinition {
  readonly name: PluginName;
  readonly description: string;
  readonly domainHints: readonly string[];
  readonly tools: readonly ToolDefinition[];
}

export interface ToolDefinition {
  readonly name: string;
  readonly pluginName: PluginName;
  readonly description: string;
  readonly access: ToolAccessPolicy;
  readonly source: ToolSource;
  readonly allowedEnvironments: readonly AmdcEnvironment[];
  readonly timeoutMs: number;
  readonly inputSchema: JsonObjectSchema;
  readonly execution: SourceAdapterToolExecution;
}

export interface ToolAccessPolicy {
  readonly level: 0 | 1 | 2;
  readonly readOnly: boolean;
}

export interface SourceAdapterToolExecution {
  readonly type: "source_adapter";
  readonly operation: string;
}

export interface ToolExecutionRequest {
  readonly toolName: string;
  readonly args: unknown;
}

export interface ToolRuntimeContext {
  readonly environment: AmdcEnvironment;
  readonly referenceTime: Date;
  readonly signal?: AbortSignal;
}

export type ToolRuntimeResult =
  | { readonly ok: true; readonly observation: ToolObservation }
  | { readonly ok: false; readonly error: SanitizedToolError };

export interface ToolObservation {
  readonly toolName: string;
  readonly pluginName: PluginName;
  readonly source: ToolSource;
  readonly status: ObservationStatus;
  readonly summary: string;
  readonly facts: readonly ToolObservationFact[];
  readonly collectedAt: string;
}

export interface ToolObservationFact {
  readonly label: string;
  readonly value: string | number | boolean | null;
  readonly unit?: string;
}

export interface SanitizedToolError {
  readonly toolName: string;
  readonly pluginName: PluginName | null;
  readonly code:
    | "unknown_tool"
    | "invalid_input"
    | "environment_not_allowed"
    | "tool_timeout"
    | "source_request_failed"
    | "source_unavailable";
  readonly message: string;
  readonly occurredAt: string;
}

export interface ToolRuntime {
  execute(
    request: ToolExecutionRequest,
    context: ToolRuntimeContext
  ): Promise<ToolRuntimeResult>;
}
