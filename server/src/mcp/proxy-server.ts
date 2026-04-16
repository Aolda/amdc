import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { DB } from "../db/index.js";
import type { McpRegistry } from "./mcp-registry.js";
import type {
  Mcp,
  PermissionChecker,
  SessionContext,
  ToolDefinition,
} from "./types.js";
import {
  buildToolCallContext,
  composeAllTools,
  createPipeline,
  resolveComposedTool,
} from "./dispatch.js";

interface LoadedToolsState {
  loadedMcps: Set<string>;
}

function buildLoaderTools(
  mcps: Mcp[],
  loaded: LoadedToolsState,
): ToolDefinition[] {
  return mcps
    .filter((mcp) => !loaded.loadedMcps.has(mcp.name))
    .map((mcp) => ({
      name: `use_${mcp.name}`,
      description: `Load tools from ${mcp.name}: ${mcp.description}`,
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      level: 3 as const,
    }));
}

export interface ProxyMcpServerDeps {
  registry: McpRegistry;
  permissionChecker: PermissionChecker;
  db: DB;
}

export function createProxyMcpServer(deps: ProxyMcpServerDeps): Server {
  const { registry, permissionChecker, db } = deps;
  const server = new Server(
    { name: "amdc-proxy-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const stateBySession = new Map<string, LoadedToolsState>();

  function getState(sessionId: string): LoadedToolsState {
    let state = stateBySession.get(sessionId);
    if (!state) {
      state = { loadedMcps: new Set() };
      stateBySession.set(sessionId, state);
    }
    return state;
  }

  const pipeline = createPipeline(permissionChecker);

  server.setRequestHandler(ListToolsRequestSchema, async (_req, extra) => {
    const ctx = extra.sessionId
      ? ({
          sessionId: extra.sessionId,
          token: "",
          agentId: "",
        } as SessionContext)
      : ({ sessionId: "default", token: "", agentId: "" } as SessionContext);
    const state = getState(ctx.sessionId);
    const loaders = buildLoaderTools(registry.listMcps(), state);
    const loadedTools: {
      name: string;
      description: string;
      inputSchema: unknown;
    }[] = [];
    for (const mcpName of state.loadedMcps) {
      const entries = await composeAllTools(db, registry);
      for (const entry of entries) {
        if (entry.mcp.name !== mcpName) continue;
        const decision = await permissionChecker.check(
          ctx,
          entry.mcp,
          entry.definition,
        );
        if (!decision.allowed) continue;
        loadedTools.push({
          name: entry.definition.name,
          description: entry.definition.description,
          inputSchema: entry.definition.inputSchema,
        });
      }
    }
    return {
      tools: [
        ...loaders.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
        ...loadedTools,
      ],
    };
  });

  async function handleCallTool(
    request: {
      params: { name: string; arguments?: Record<string, unknown> };
    },
    extra: { sessionId?: string },
  ): Promise<CallToolResult> {
    const sessionId = extra.sessionId ?? "default";
    const ctx: SessionContext = {
      sessionId,
      token: "",
      agentId: "",
    };
    const state = getState(sessionId);
    const toolName = request.params.name;
    const loaderPrefix = "use_";
    if (toolName.startsWith(loaderPrefix)) {
      const mcpName = toolName.slice(loaderPrefix.length);
      const mcp = registry.findMcp(mcpName);
      if (!mcp) {
        return {
          content: [{ type: "text", text: "unknown mcp: " + mcpName }],
          isError: true,
        };
      }
      state.loadedMcps.add(mcpName);
      await server.sendToolListChanged();
      const tools = await mcp.listTools();
      const names = tools.map((t) => t.name).join(", ");
      return {
        content: [
          {
            type: "text",
            text: `Loaded ${tools.length} tools from ${mcpName}: ${names}. Call tools/list to see them.`,
          },
        ],
      };
    }
    const resolved = await resolveComposedTool(db, registry, toolName);
    if (!resolved) {
      return {
        content: [{ type: "text", text: "unknown tool: " + toolName }],
        isError: true,
      };
    }
    const callCtx = await buildToolCallContext(
      db,
      resolved,
      request.params.arguments ?? {},
      ctx,
    );
    const result = await pipeline(callCtx);
    return result as unknown as CallToolResult;
  }

  server.setRequestHandler(CallToolRequestSchema, handleCallTool);

  return server;
}
