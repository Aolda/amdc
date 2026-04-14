export interface SessionContext {
  token: string;
  sessionId: string;
  agentId: string;
}

export type PluginKind = "native" | "mcp-upstream";

export type ToolLevel = 1 | 2 | 3;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  level: ToolLevel;
}

export interface ToolContent {
  type: "text";
  text: string;
}

export interface ToolCallResult {
  content: ToolContent[];
  isError?: boolean;
  [key: string]: unknown;
}

export interface Plugin {
  name: string;
  kind: PluginKind;
  description: string;
  defaultLevel: ToolLevel;
  listTools(): Promise<ToolDefinition[]>;
  callTool(
    toolName: string,
    input: unknown,
    ctx: SessionContext,
  ): Promise<ToolCallResult>;
}

export interface NativeToolMeta {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface NativePluginMeta {
  name: string;
  kind: "native";
  description: string;
  defaultLevel: ToolLevel;
  tools: NativeToolMeta[];
  loadHandler: () => Promise<{
    default: NativeHandler;
  }>;
}

export type NativeHandler = (
  toolName: string,
  input: unknown,
  ctx: SessionContext,
) => Promise<ToolCallResult>;

export interface UpstreamPluginMeta {
  name: string;
  kind: "mcp-upstream";
  description: string;
  defaultLevel: ToolLevel;
  upstreamUrl: string;
}

export type PluginMeta = NativePluginMeta | UpstreamPluginMeta;

export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
}

export interface PermissionChecker {
  check(
    ctx: SessionContext,
    plugin: Plugin,
    toolName: string,
  ): Promise<PermissionDecision>;
}

export interface AllowListProvider {
  isApproved(
    ctx: SessionContext,
    pluginName: string,
    toolName: string,
  ): Promise<boolean>;
}

export interface AgentLike {
  id: string;
  plugins: { name: string; levelOverride: 1 | 2 | 3 | null }[];
}
