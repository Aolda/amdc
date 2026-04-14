import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createProxyMcpServer } from "./proxy-server.js";
import { createMcpRegistry } from "./mcp-registry.js";
import {
  AgentDefaultPermissionChecker,
  AllowAllPermissionChecker,
} from "./permission.js";
import { echoMeta } from "./plugins/echo.js";
import { createDatabase, type DB } from "../db/index.js";
import { syncMcpsToDb, seedNativeToolLevels } from "./mcp-sync.js";
import { insertWrapperRow } from "./wrapper-repository.js";
import type { UpstreamTransportFactory } from "./plugins/mcp-upstream/factory.js";
import type {
  AgentLike,
  McpMeta,
  PermissionChecker,
  SessionContext,
  UpstreamMcpMeta,
} from "./types.js";

const ctx: SessionContext = {
  token: "tkn",
  sessionId: "ses",
  agentId: "agent-1",
};

async function connectClient(
  metas: McpMeta[],
  checker: PermissionChecker = new AllowAllPermissionChecker(),
  upstreamTransportFactory?: UpstreamTransportFactory,
  dbOverride?: DB,
): Promise<{ client: Client; db: DB }> {
  const db = dbOverride ?? (await createDatabase(":memory:"));
  if (!dbOverride) {
    await syncMcpsToDb(db, metas);
    await seedNativeToolLevels(db, metas);
  }
  const registry = createMcpRegistry(metas, { upstreamTransportFactory });
  const server = createProxyMcpServer(ctx, registry, checker, db);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0" });
  await client.connect(clientTransport);
  return { client, db };
}

function makeMockUpstream(
  tools: { name: string; inputSchema?: Record<string, unknown> }[],
  handler: (name: string, args: unknown) => unknown,
): UpstreamTransportFactory {
  return (_url) => {
    const server = new Server(
      { name: "mock", version: "0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map((t) => ({
        name: t.name,
        description: "",
        inputSchema: t.inputSchema ?? { type: "object" },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            handler(req.params.name, req.params.arguments ?? {}),
          ),
        },
      ],
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
}

describe("proxy mcp server", () => {
  it("lists echo tool via tools/list", async () => {
    const { client } = await connectClient([echoMeta]);
    const result = await client.listTools();
    expect(result.tools.map((t) => t.name)).toContain("echo");
    await client.close();
  });

  it("calls echo tool and receives echoed message", async () => {
    const { client } = await connectClient([echoMeta]);
    const result = await client.callTool({
      name: "echo",
      arguments: { message: "hello proxy" },
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as { type: string; text: string }[];
    expect(content[0].text).toBe("hello proxy");
    await client.close();
  });

  it("returns error for unknown tool", async () => {
    const { client } = await connectClient([echoMeta]);
    const result = await client.callTool({
      name: "nonexistent",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("filters tools/list by agent mcp permission", async () => {
    const agent: AgentLike = { id: "agent-1", mcps: [] };
    const checker = new AgentDefaultPermissionChecker({
      getAgent: async () => agent,
    });
    const { client } = await connectClient([echoMeta], checker);
    const result = await client.listTools();
    expect(result.tools).toEqual([]);
    await client.close();
  });

  it("returns permission-denied error on callTool when mcp not allowed", async () => {
    const agent: AgentLike = { id: "agent-1", mcps: [] };
    const checker = new AgentDefaultPermissionChecker({
      getAgent: async () => agent,
    });
    const { client } = await connectClient([echoMeta], checker);
    const result = await client.callTool({
      name: "echo",
      arguments: { message: "hi" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text: string }[];
    expect(content[0].text).toContain("permission denied");
    await client.close();
  });

  it("exposes upstream MCP tools through passthrough with namespaced names", async () => {
    const upstreamMeta: UpstreamMcpMeta = {
      name: "mock",
      kind: "upstream",
      description: "mock upstream",
      defaultLevel: 3,
      upstreamUrl: "http://ignored",
    };
    const factory = makeMockUpstream([{ name: "ping" }], (_name, args) => ({
      args,
    }));
    const { client } = await connectClient([upstreamMeta], undefined, factory);
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toEqual(["mock__ping"]);
    const call = await client.callTool({
      name: "mock__ping",
      arguments: { v: 42 },
    });
    expect(call.isError).toBeFalsy();
    const content = call.content as { type: string; text: string }[];
    expect(JSON.parse(content[0].text)).toEqual({ args: { v: 42 } });
    await client.close();
  });

  it("applies fixedParams from wrapper row to upstream call", async () => {
    const upstreamMeta: UpstreamMcpMeta = {
      name: "mock",
      kind: "upstream",
      description: "",
      defaultLevel: 3,
      upstreamUrl: "http://ignored",
    };
    const factory = makeMockUpstream([{ name: "query" }], (_name, args) => ({
      args,
    }));
    const db = await createDatabase(":memory:");
    await syncMcpsToDb(db, [upstreamMeta]);
    await insertWrapperRow(db, {
      mcpName: "mock",
      wrapperName: "cpu_usage",
      underlyingToolName: "query",
      kind: "mcp",
      level: 3,
      description: "cpu",
      inputSchema: {},
      hidden: false,
      config: { fixedParams: { metric: "cpu_seconds" } },
    });
    const { client } = await connectClient(
      [upstreamMeta],
      undefined,
      factory,
      db,
    );
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual([
      "cpu_usage",
      "mock__query",
    ]);
    const call = await client.callTool({
      name: "cpu_usage",
      arguments: { range: "5m" },
    });
    const content = call.content as { type: string; text: string }[];
    expect(JSON.parse(content[0].text)).toEqual({
      args: { range: "5m", metric: "cpu_seconds" },
    });
    await client.close();
  });

  it("hidden wrapper is not exposed via listTools", async () => {
    const db = await createDatabase(":memory:");
    await syncMcpsToDb(db, [echoMeta]);
    await insertWrapperRow(db, {
      mcpName: "echo",
      wrapperName: "echo",
      underlyingToolName: "echo",
      kind: "native",
      level: 3,
      description: "",
      inputSchema: {},
      hidden: true,
      config: {},
    });
    const { client } = await connectClient(
      [echoMeta],
      undefined,
      undefined,
      db,
    );
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toEqual([]);
    await client.close();
  });

  it("exposes tool when agent has mcp selected with default level", async () => {
    const agent: AgentLike = {
      id: "agent-1",
      mcps: [{ name: "echo", levelOverride: null, toolOverrides: [] }],
    };
    const checker = new AgentDefaultPermissionChecker({
      getAgent: async () => agent,
    });
    const { client } = await connectClient([echoMeta], checker);
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toEqual(["echo"]);
    const call = await client.callTool({
      name: "echo",
      arguments: { message: "hi" },
    });
    expect(call.isError).toBeFalsy();
    await client.close();
  });
});
