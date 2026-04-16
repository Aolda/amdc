import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createProxyMcpServer,
  type ProxyMcpServerDeps,
} from "./proxy-server.js";
import { createMcpRegistry } from "./mcp-registry.js";
import {
  AllowAllPermissionChecker,
  LevelPermissionChecker,
} from "./permission.js";
import { echoMeta } from "./plugins/echo.js";
import { createDatabase, type DB } from "../db/index.js";
import { syncMcpsToDb, seedNativeToolLevels } from "./mcp-sync.js";
import { insertWrapperRow } from "./wrapper-repository.js";
import type { UpstreamTransportFactory } from "./plugins/mcp-upstream/factory.js";
import type { McpMeta, PermissionChecker, UpstreamMcpMeta } from "./types.js";

function makeMockUpstream(
  tools: { name: string; inputSchema?: Record<string, unknown> }[],
  handler: (name: string, args: unknown) => unknown,
): UpstreamTransportFactory {
  return (_meta) => {
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
  const deps: ProxyMcpServerDeps = {
    registry,
    permissionChecker: checker,
    db,
  };
  const proxyServer = createProxyMcpServer(deps);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await proxyServer.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0" });
  await client.connect(clientTransport);
  return { client, db };
}

describe("proxy mcp server", () => {
  it("lists loader meta-tools (not raw tools) initially", async () => {
    const { client } = await connectClient([echoMeta]);
    const result = await client.listTools();
    expect(result.tools.map((t) => t.name)).toEqual(["use_echo"]);
    expect(result.tools[0].description).toContain("echo");
    await client.close();
  });

  it("loading an mcp reveals its tools", async () => {
    const { client } = await connectClient([echoMeta]);
    const loadResult = await client.callTool({
      name: "use_echo",
      arguments: {},
    });
    expect(loadResult.isError).toBeFalsy();
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).toContain("echo");
    expect(names).not.toContain("use_echo");
    await client.close();
  });

  it("calls tool after loading and receives result", async () => {
    const { client } = await connectClient([echoMeta]);
    await client.callTool({ name: "use_echo", arguments: {} });
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

  it("returns error for unknown mcp in loader", async () => {
    const { client } = await connectClient([echoMeta]);
    const result = await client.callTool({
      name: "use_nonexistent",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("level 3 tools pass LevelPermissionChecker", async () => {
    const checker = new LevelPermissionChecker();
    const { client } = await connectClient([echoMeta], checker);
    await client.callTool({ name: "use_echo", arguments: {} });
    const result = await client.callTool({
      name: "echo",
      arguments: { message: "hi" },
    });
    expect(result.isError).toBeFalsy();
    await client.close();
  });

  it("applies fixedParams from wrapper row to upstream call", async () => {
    const upstreamMeta: UpstreamMcpMeta = {
      name: "mock",
      kind: "upstream",
      description: "mock upstream",
      defaultLevel: 3,
      transport: "http",
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
    await client.callTool({ name: "use_mock", arguments: {} });
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
    await client.callTool({ name: "use_echo", arguments: {} });
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toEqual([]);
    await client.close();
  });
});
