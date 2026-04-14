export interface SessionContext {
  token: string;
  sessionId: string;
  agentId: string;
}

export type McpKind = "native" | "upstream";

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

export interface Mcp {
  name: string;
  kind: McpKind;
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
  level?: ToolLevel;
}

export interface NativeMcpMeta {
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

export interface UpstreamMcpMeta {
  name: string;
  kind: "upstream";
  description: string;
  defaultLevel: ToolLevel;
  upstreamUrl: string;
}

export type McpMeta = NativeMcpMeta | UpstreamMcpMeta;

export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
}

export interface PermissionChecker {
  check(
    ctx: SessionContext,
    mcp: Mcp,
    tool: ToolDefinition,
  ): Promise<PermissionDecision>;
}

export interface AllowListProvider {
  isApproved(
    ctx: SessionContext,
    mcpName: string,
    toolName: string,
  ): Promise<boolean>;
}

export interface AgentLike {
  id: string;
  mcps: AgentLikeMcp[];
}

export interface AgentLikeMcp {
  name: string;
  levelOverride: ToolLevel | null;
  toolOverrides: { toolName: string; level: ToolLevel }[];
}
