import {
  buildUpstreamPlugin,
  type UpstreamTransportFactory,
} from "./plugins/mcp-upstream/factory.js";
import type {
  NativeHandler,
  NativePluginMeta,
  Plugin,
  PluginMeta,
  SessionContext,
  ToolCallResult,
  ToolDefinition,
} from "./types.js";

export interface PluginRegistry {
  listPlugins(): Plugin[];
  findPlugin(name: string): Plugin | null;
  listAllTools(): Promise<ToolDefinition[]>;
  findPluginForTool(toolName: string): Promise<Plugin | null>;
}

function buildNativePlugin(meta: NativePluginMeta): Plugin {
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
        level: meta.defaultLevel,
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

function buildPlugin(
  meta: PluginMeta,
  upstreamTransportFactory?: UpstreamTransportFactory,
): Plugin {
  if (meta.kind === "native") return buildNativePlugin(meta);
  return buildUpstreamPlugin(meta, upstreamTransportFactory);
}

export interface CreatePluginRegistryOptions {
  upstreamTransportFactory?: UpstreamTransportFactory;
}

export function createPluginRegistry(
  metas: PluginMeta[],
  options: CreatePluginRegistryOptions = {},
): PluginRegistry {
  const plugins = metas.map((meta) =>
    buildPlugin(meta, options.upstreamTransportFactory),
  );
  const byName = new Map(plugins.map((p) => [p.name, p]));

  return {
    listPlugins() {
      return plugins.slice();
    },
    findPlugin(name) {
      return byName.get(name) ?? null;
    },
    async listAllTools() {
      const all: ToolDefinition[] = [];
      for (const plugin of plugins) {
        const tools = await plugin.listTools();
        all.push(...tools);
      }
      return all;
    },
    async findPluginForTool(toolName) {
      for (const plugin of plugins) {
        const tools = await plugin.listTools();
        if (tools.some((t) => t.name === toolName)) return plugin;
      }
      return null;
    },
  };
}
