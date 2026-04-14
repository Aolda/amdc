import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  Plugin,
  SessionContext,
  ToolCallResult,
  ToolDefinition,
  UpstreamPluginMeta,
} from "../../types.js";

export const UPSTREAM_NAME_SEPARATOR = "__";

function namespaceTool(pluginName: string, toolName: string): string {
  return `${pluginName}${UPSTREAM_NAME_SEPARATOR}${toolName}`;
}

function stripNamespace(pluginName: string, fullToolName: string): string {
  const prefix = pluginName + UPSTREAM_NAME_SEPARATOR;
  if (!fullToolName.startsWith(prefix)) return fullToolName;
  return fullToolName.slice(prefix.length);
}

export interface UpstreamTransportFactory {
  (url: string): {
    client: Client;
    connect: () => Promise<void>;
  };
}

export const defaultUpstreamTransportFactory: UpstreamTransportFactory = (
  url,
) => {
  const client = new Client({ name: "amdc-proxy-upstream", version: "0.1.0" });
  return {
    client,
    connect: async () => {
      const transport = new StreamableHTTPClientTransport(new URL(url));
      await client.connect(transport);
    },
  };
};

export function buildUpstreamPlugin(
  meta: UpstreamPluginMeta,
  transportFactory: UpstreamTransportFactory = defaultUpstreamTransportFactory,
): Plugin {
  let clientPromise: Promise<Client> | null = null;
  let cachedTools: ToolDefinition[] | null = null;

  async function ensureClient(): Promise<Client> {
    if (!clientPromise) {
      clientPromise = (async () => {
        const { client, connect } = transportFactory(meta.upstreamUrl);
        await connect();
        return client;
      })();
    }
    return clientPromise;
  }

  return {
    name: meta.name,
    kind: "mcp-upstream",
    description: meta.description,
    defaultLevel: meta.defaultLevel,
    async listTools(): Promise<ToolDefinition[]> {
      if (cachedTools) return cachedTools;
      try {
        const client = await ensureClient();
        const result = await client.listTools();
        cachedTools = result.tools.map((tool) => ({
          name: namespaceTool(meta.name, tool.name),
          description: tool.description ?? "",
          inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
          level: meta.defaultLevel,
        }));
        return cachedTools;
      } catch (err) {
        console.warn(
          `[mcp-upstream] failed to list tools for '${meta.name}': ${err instanceof Error ? err.message : String(err)}`,
        );
        cachedTools = [];
        return cachedTools;
      }
    },
    async callTool(
      toolName: string,
      input: unknown,
      _ctx: SessionContext,
    ): Promise<ToolCallResult> {
      const client = await ensureClient();
      const upstreamName = stripNamespace(meta.name, toolName);
      const result = await client.callTool({
        name: upstreamName,
        arguments: (input ?? {}) as Record<string, unknown>,
      });
      return result as unknown as ToolCallResult;
    },
  };
}
