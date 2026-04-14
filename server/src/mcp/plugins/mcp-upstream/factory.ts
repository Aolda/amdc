import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  Mcp,
  SessionContext,
  ToolCallResult,
  ToolDefinition,
  UpstreamMcpMeta,
} from "../../types.js";

export const UPSTREAM_NAME_SEPARATOR = "__";

function namespaceTool(mcpName: string, toolName: string): string {
  return `${mcpName}${UPSTREAM_NAME_SEPARATOR}${toolName}`;
}

function stripNamespace(mcpName: string, fullToolName: string): string {
  const prefix = mcpName + UPSTREAM_NAME_SEPARATOR;
  if (!fullToolName.startsWith(prefix)) return fullToolName;
  return fullToolName.slice(prefix.length);
}

export interface UpstreamTransportFactory {
  (meta: UpstreamMcpMeta): {
    client: Client;
    connect: () => Promise<void>;
  };
}

export const defaultUpstreamTransportFactory: UpstreamTransportFactory = (
  meta,
) => {
  const client = new Client({ name: "amdc-proxy-upstream", version: "0.1.0" });
  return {
    client,
    connect: async () => {
      if (meta.transport === "stdio") {
        const [command, ...args] = meta.upstreamCommand;
        if (!command) {
          throw new Error(
            `upstream stdio mcp '${meta.name}' has empty command`,
          );
        }
        const transport = new StdioClientTransport({
          command,
          args,
          env: meta.upstreamEnv,
          cwd: meta.upstreamCwd,
        });
        await client.connect(transport);
        return;
      }
      const transport = new StreamableHTTPClientTransport(
        new URL(meta.upstreamUrl),
      );
      await client.connect(transport);
    },
  };
};

export function buildUpstreamMcp(
  meta: UpstreamMcpMeta,
  transportFactory: UpstreamTransportFactory = defaultUpstreamTransportFactory,
): Mcp {
  let clientPromise: Promise<Client> | null = null;
  let cachedTools: ToolDefinition[] | null = null;

  async function ensureClient(): Promise<Client> {
    if (!clientPromise) {
      clientPromise = (async () => {
        const { client, connect } = transportFactory(meta);
        await connect();
        return client;
      })();
    }
    return clientPromise;
  }

  return {
    name: meta.name,
    kind: "upstream",
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
