import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { createDatabase, type DB } from "../db/index.js";
import { syncMcpsToDb, seedNativeToolLevels } from "./mcp-sync.js";
import { createMcpRegistry, type McpRegistry } from "./mcp-registry.js";
import { LevelPermissionChecker } from "./permission.js";
import { createProxyMcpServer } from "./proxy-server.js";
import { echoMeta } from "./plugins/echo.js";
import type { Express } from "express";

let app: Express;
let db: DB;

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

const INIT_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "router-test", version: "0" },
  },
};

beforeEach(async () => {
  db = await createDatabase(":memory:");
  await syncMcpsToDb(db, [echoMeta]);
  await seedNativeToolLevels(db, [echoMeta]);
  const mcpRegistry: McpRegistry = createMcpRegistry([echoMeta]);
  const proxyServer = createProxyMcpServer({
    registry: mcpRegistry,
    permissionChecker: new LevelPermissionChecker(),
    db,
  });
  app = createApp({ db, mcpRegistry, proxyServer });
});

describe("POST /mcp", () => {
  it("handles initialize via JSON-RPC", async () => {
    const res = await request(app)
      .post("/mcp")
      .set(MCP_HEADERS)
      .send(INIT_BODY);
    expect(res.status).toBe(200);
  });
});
