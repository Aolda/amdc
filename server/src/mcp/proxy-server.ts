import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { PluginRegistry } from "./plugin-registry.js";
import type {
  PermissionChecker,
  SessionContext,
  ToolCallResult,
  ToolDefinition,
} from "./types.js";

interface ResolvedTool {
  definition: ToolDefinition;
  pluginName: string;
}

async function resolveAllTools(
  registry: PluginRegistry,
): Promise<ResolvedTool[]> {
  const resolved: ResolvedTool[] = [];
  for (const plugin of registry.listPlugins()) {
    const tools = await plugin.listTools();
    for (const tool of tools) {
      resolved.push({ definition: tool, pluginName: plugin.name });
    }
  }
  return resolved;
}

export function createProxyMcpServer(
  ctx: SessionContext,
  registry: PluginRegistry,
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
      const plugin = registry.findPlugin(entry.pluginName);
      if (!plugin) continue;
      const decision = await permissionChecker.check(
        ctx,
        plugin,
        entry.definition.name,
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
    const plugin = await registry.findPluginForTool(toolName);
    if (!plugin) {
      return {
        content: [{ type: "text", text: "unknown tool: " + toolName }],
        isError: true,
      };
    }
    const decision = await permissionChecker.check(ctx, plugin, toolName);
    if (!decision.allowed) {
      const suffix = decision.reason ? ": " + decision.reason : "";
      return {
        content: [{ type: "text", text: "permission denied" + suffix }],
        isError: true,
      };
    }
    const result: ToolCallResult = await plugin.callTool(
      toolName,
      request.params.arguments ?? {},
      ctx,
    );
    return result;
  }

  server.setRequestHandler(CallToolRequestSchema, handleCallTool);

  return server;
}
