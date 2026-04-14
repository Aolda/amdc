import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { buildUpstreamMcp, type UpstreamTransportFactory } from "./factory.js";
import type { SessionContext, UpstreamMcpMeta } from "../../types.js";

const ctx: SessionContext = {
  token: "t",
  sessionId: "s",
  agentId: "a",
};

interface MockUpstreamOptions {
  tools: {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }[];
  onCall?: (name: string, args: unknown) => unknown;
}

async function buildMockUpstream(
  opts: MockUpstreamOptions,
): Promise<UpstreamTransportFactory> {
  return (_url) => {
    const server = new Server(
      { name: "mock-upstream", version: "0.0.1" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: opts.tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema ?? { type: "object" },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const output = opts.onCall?.(req.params.name, req.params.arguments ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(output ?? {}) }],
      };
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "amdc-proxy-upstream", version: "0" });
    return {
      client,
      connect: async () => {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
      },
    };
  };
}

const meta: UpstreamMcpMeta = {
  name: "upstream",
  kind: "upstream",
  description: "mock upstream",
  defaultLevel: 3,
  upstreamUrl: "http://ignored",
};

describe("buildUpstreamMcp", () => {
  it("namespaces upstream tools with mcp name prefix", async () => {
    const factory = await buildMockUpstream({
      tools: [{ name: "ping" }, { name: "status" }],
    });
    const mcp = buildUpstreamMcp(meta, factory);
    const tools = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "upstream__ping",
      "upstream__status",
    ]);
  });

  it("forwards callTool to upstream with unnamespaced name", async () => {
    let receivedName: string | null = null;
    let receivedArgs: unknown = null;
    const factory = await buildMockUpstream({
      tools: [{ name: "ping" }],
      onCall: (name, args) => {
        receivedName = name;
        receivedArgs = args;
        return { pong: true };
      },
    });
    const mcp = buildUpstreamMcp(meta, factory);
    await mcp.listTools();
    const result = await mcp.callTool("upstream__ping", { x: 1 }, ctx);
    expect(receivedName).toBe("ping");
    expect(receivedArgs).toEqual({ x: 1 });
    expect(result.isError).toBeFalsy();
  });

  it("caches tools across multiple listTools calls", async () => {
    let listCount = 0;
    const factory: UpstreamTransportFactory = (_url) => {
      const server = new Server(
        { name: "u", version: "0" },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => {
        listCount += 1;
        return { tools: [{ name: "a", inputSchema: { type: "object" } }] };
      });
      server.setRequestHandler(CallToolRequestSchema, async () => ({
        content: [{ type: "text", text: "" }],
      }));
      const [ct, st] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "c", version: "0" });
      return {
        client,
        connect: async () => {
          await server.connect(st);
          await client.connect(ct);
        },
      };
    };
    const mcp = buildUpstreamMcp(meta, factory);
    await mcp.listTools();
    await mcp.listTools();
    await mcp.listTools();
    expect(listCount).toBe(1);
  });

  it("returns empty tools list when upstream connection fails", async () => {
    const factory: UpstreamTransportFactory = (_url) => ({
      client: new Client({ name: "c", version: "0" }),
      connect: async () => {
        throw new Error("connection refused");
      },
    });
    const mcp = buildUpstreamMcp(meta, factory);
    const tools = await mcp.listTools();
    expect(tools).toEqual([]);
  });
});
