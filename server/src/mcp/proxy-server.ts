import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { DB } from "../db/index.js";
import type { McpRegistry } from "./mcp-registry.js";
import type { PermissionChecker, SessionContext } from "./types.js";
import {
  composeAllTools,
  dispatchComposedCall,
  resolveComposedTool,
} from "./dispatch.js";

export function createProxyMcpServer(
  ctx: SessionContext,
  registry: McpRegistry,
  permissionChecker: PermissionChecker,
  db: DB,
): Server {
  const server = new Server(
    { name: "amdc-proxy-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const entries = await composeAllTools(db, registry);
    const tools: { name: string; description: string; inputSchema: unknown }[] =
      [];
    for (const entry of entries) {
      const decision = await permissionChecker.check(
        ctx,
        entry.mcp,
        entry.definition,
      );
      if (!decision.allowed) continue;
      tools.push({
        name: entry.definition.name,
        description: entry.definition.description,
        inputSchema: entry.definition.inputSchema,
      });
    }
    return { tools };
  });

  async function handleCallTool(request: {
    params: { name: string; arguments?: Record<string, unknown> };
  }): Promise<CallToolResult> {
    const wrapperName = request.params.name;
    const resolved = await resolveComposedTool(db, registry, wrapperName);
    if (!resolved) {
      return {
        content: [{ type: "text", text: "unknown tool: " + wrapperName }],
        isError: true,
      };
    }
    const decision = await permissionChecker.check(
      ctx,
      resolved.mcp,
      resolved.definition,
    );
    if (!decision.allowed) {
      const suffix = decision.reason ? ": " + decision.reason : "";
      return {
        content: [{ type: "text", text: "permission denied" + suffix }],
        isError: true,
      };
    }
    const result = await dispatchComposedCall(
      db,
      resolved,
      request.params.arguments ?? {},
      ctx,
    );
    return result as unknown as CallToolResult;
  }

  server.setRequestHandler(CallToolRequestSchema, handleCallTool);

  return server;
}
