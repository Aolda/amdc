import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpRegistry } from "./mcp-registry.js";
import type {
  PermissionChecker,
  SessionContext,
  ToolCallResult,
  ToolDefinition,
} from "./types.js";

interface ResolvedTool {
  definition: ToolDefinition;
  mcpName: string;
}

async function resolveAllTools(registry: McpRegistry): Promise<ResolvedTool[]> {
  const resolved: ResolvedTool[] = [];
  for (const mcp of registry.listMcps()) {
    const tools = await mcp.listTools();
    for (const tool of tools) {
      resolved.push({ definition: tool, mcpName: mcp.name });
    }
  }
  return resolved;
}

export function createProxyMcpServer(
  ctx: SessionContext,
  registry: McpRegistry,
  permissionChecker: PermissionChecker,
): Server {
  const server = new Server(
    { name: "amdc-proxy-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const resolved = await resolveAllTools(registry);
    const filtered: typeof resolved = [];
    for (const entry of resolved) {
      const mcp = registry.findMcp(entry.mcpName);
      if (!mcp) continue;
      const decision = await permissionChecker.check(
        ctx,
        mcp,
        entry.definition,
      );
      if (decision.allowed) filtered.push(entry);
    }
    return {
      tools: filtered.map(({ definition }) => ({
        name: definition.name,
        description: definition.description,
        inputSchema: definition.inputSchema,
      })),
    };
  });

  async function handleCallTool(request: {
    params: { name: string; arguments?: Record<string, unknown> };
  }): Promise<CallToolResult> {
    const toolName = request.params.name;
    const resolved = await registry.resolveTool(toolName);
    if (!resolved) {
      return {
        content: [{ type: "text", text: "unknown tool: " + toolName }],
        isError: true,
      };
    }
    const decision = await permissionChecker.check(
      ctx,
      resolved.mcp,
      resolved.tool,
    );
    if (!decision.allowed) {
      const suffix = decision.reason ? ": " + decision.reason : "";
      return {
        content: [{ type: "text", text: "permission denied" + suffix }],
        isError: true,
      };
    }
    const result: ToolCallResult = await resolved.mcp.callTool(
      toolName,
      request.params.arguments ?? {},
      ctx,
    );
    return result;
  }

  server.setRequestHandler(CallToolRequestSchema, handleCallTool);

  return server;
}
