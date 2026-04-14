import {
  buildUpstreamMcp,
  type UpstreamTransportFactory,
} from "./plugins/mcp-upstream/factory.js";
import type {
  CliMcpMeta,
  Mcp,
  McpMeta,
  NativeHandler,
  NativeMcpMeta,
  SessionContext,
  ToolCallResult,
  ToolDefinition,
} from "./types.js";

export interface McpRegistry {
  listMcps(): Mcp[];
  findMcp(name: string): Mcp | null;
  listAllTools(): Promise<ToolDefinition[]>;
  findMcpForTool(toolName: string): Promise<Mcp | null>;
  resolveTool(
    toolName: string,
  ): Promise<{ mcp: Mcp; tool: ToolDefinition } | null>;
  addMcp(meta: McpMeta): void;
  removeMcp(name: string): void;
}

function buildNativeMcp(meta: NativeMcpMeta): Mcp {
  let cachedHandler: NativeHandler | null = null;

  async function ensureHandler(): Promise<NativeHandler> {
    if (cachedHandler) return cachedHandler;
    const mod = await meta.loadHandler();
    cachedHandler = mod.default;
    return cachedHandler;
  }

  return {
    name: meta.name,
    kind: meta.kind,
    description: meta.description,
    defaultLevel: meta.defaultLevel,
    async listTools(): Promise<ToolDefinition[]> {
      return meta.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        level: tool.level ?? meta.defaultLevel,
      }));
    },
    async callTool(
      toolName: string,
      input: unknown,
      ctx: SessionContext,
    ): Promise<ToolCallResult> {
      const handler = await ensureHandler();
      return handler(toolName, input, ctx);
    },
  };
}

function buildCliMcp(meta: CliMcpMeta): Mcp {
  return {
    name: meta.name,
    kind: "cli",
    description: meta.description,
    defaultLevel: meta.defaultLevel,
    async listTools(): Promise<ToolDefinition[]> {
      return [];
    },
    async callTool(): Promise<ToolCallResult> {
      return {
        content: [
          {
            type: "text",
            text: `cli mcp '${meta.name}' must be dispatched via wrapper row`,
          },
        ],
        isError: true,
      };
    },
  };
}

function buildMcp(
  meta: McpMeta,
  upstreamTransportFactory?: UpstreamTransportFactory,
): Mcp {
  if (meta.kind === "native") return buildNativeMcp(meta);
  if (meta.kind === "cli") return buildCliMcp(meta);
  return buildUpstreamMcp(meta, upstreamTransportFactory);
}

export interface CreateMcpRegistryOptions {
  upstreamTransportFactory?: UpstreamTransportFactory;
}

export function createMcpRegistry(
  metas: McpMeta[],
  options: CreateMcpRegistryOptions = {},
): McpRegistry {
  const byName = new Map<string, Mcp>();
  for (const meta of metas) {
    byName.set(meta.name, buildMcp(meta, options.upstreamTransportFactory));
  }

  return {
    listMcps() {
      return Array.from(byName.values());
    },
    findMcp(name) {
      return byName.get(name) ?? null;
    },
    async listAllTools() {
      const all: ToolDefinition[] = [];
      for (const mcp of byName.values()) {
        const tools = await mcp.listTools();
        all.push(...tools);
      }
      return all;
    },
    async findMcpForTool(toolName) {
      for (const mcp of byName.values()) {
        const tools = await mcp.listTools();
        if (tools.some((t) => t.name === toolName)) return mcp;
      }
      return null;
    },
    async resolveTool(toolName) {
      for (const mcp of byName.values()) {
        const tools = await mcp.listTools();
        const tool = tools.find((t) => t.name === toolName);
        if (tool) return { mcp, tool };
      }
      return null;
    },
    addMcp(meta) {
      byName.set(meta.name, buildMcp(meta, options.upstreamTransportFactory));
    },
    removeMcp(name) {
      byName.delete(name);
    },
  };
}
