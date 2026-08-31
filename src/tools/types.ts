import type { AmdcEnvironment } from "../config/env.js";

export const PLUGIN_NAMES = [
  "amdb-tenant",
  "backend",
  "backup",
  "host",
  "logs",
  "mysql",
  "prometheus",
  "proxy",
  "system"
] as const;

export type PluginName = (typeof PLUGIN_NAMES)[number];

export function isPluginName(value: string): value is PluginName {
  return (PLUGIN_NAMES as readonly string[]).includes(value);
}

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
  readonly execution: ToolExecution;
}

export interface ToolAccessPolicy {
  readonly level: 0 | 1 | 2;
  readonly readOnly: boolean;
}

export interface SourceAdapterToolExecution {
  readonly type: "source_adapter";
  readonly operation: string;
}

export interface LocalShellToolExecution {
  readonly type: "local_shell";
  readonly command: string;
  readonly environment: Readonly<
    Record<string, Readonly<Record<AmdcEnvironment, string>>>
  >;
}

export interface PrometheusHttpToolExecution {
  readonly type: "prometheus_http";
  readonly baseUrlEnvironment: Readonly<Record<AmdcEnvironment, string>>;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
}

export type ToolExecution =
  | SourceAdapterToolExecution
  | LocalShellToolExecution
  | PrometheusHttpToolExecution;

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
  | { readonly ok: true; readonly rawResult: RawToolResult }
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

interface RawToolResultBase {
  readonly toolName: string;
  readonly pluginName: PluginName;
  readonly source: ToolSource;
  readonly collectedAt: string;
}

export interface RawLocalShellToolResult extends RawToolResultBase {
  readonly transport: "local_shell";
  readonly execution: {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
  };
}

export interface RawHttpToolResult extends RawToolResultBase {
  readonly transport: "http";
  readonly response: {
    readonly statusCode: number;
    readonly contentType: string | null;
    readonly body: string;
  };
}

export type RawToolResult = RawLocalShellToolResult | RawHttpToolResult;

export interface SanitizedToolError {
  readonly toolName: string;
  readonly pluginName: PluginName | null;
  readonly code:
    | "unknown_tool"
    | "invalid_input"
    | "environment_not_allowed"
    | "tool_timeout"
    | "tool_output_too_large"
    | "malformed_source_response"
    | "source_request_failed"
    | "source_permission_denied"
    | "source_unavailable"
    | "secret_exposure_risk";
  readonly message: string;
  readonly occurredAt: string;
}

export interface ToolRuntime {
  execute(
    request: ToolExecutionRequest,
    context: ToolRuntimeContext
  ): Promise<ToolRuntimeResult>;
}
