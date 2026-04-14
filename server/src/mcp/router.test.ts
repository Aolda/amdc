import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { createDatabase, type DB } from "../db/index.js";
import {
  createSessionRegistry,
  type SessionRegistry,
} from "./session-registry.js";
import {
  createPluginRegistry,
  type PluginRegistry,
} from "./plugin-registry.js";
import { AllowAllPermissionChecker } from "./permission.js";
import { echoMeta } from "./plugins/echo.js";
import type { Express } from "express";

let app: Express;
let db: DB;
let sessionRegistry: SessionRegistry;
let pluginRegistry: PluginRegistry;

beforeEach(async () => {
  db = await createDatabase(":memory:");
  sessionRegistry = createSessionRegistry();
  pluginRegistry = createPluginRegistry([echoMeta]);
  app = createApp({
    db,
    sessionRegistry,
    pluginRegistry,
    permissionChecker: new AllowAllPermissionChecker(),
  });
});

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

describe("POST /mcp/:token", () => {
  it("returns 404 for unknown token", async () => {
    const res = await request(app)
      .post("/mcp/does-not-exist")
      .set(MCP_HEADERS)
      .send(INIT_BODY);
    expect(res.status).toBe(404);
  });

  it("handles initialize for a valid token", async () => {
    const ctx = sessionRegistry.issueToken({ agentId: "a1" });
    const res = await request(app)
      .post(`/mcp/${ctx.token}`)
      .set(MCP_HEADERS)
      .send(INIT_BODY);
    expect(res.status).toBe(200);
  });
});

describe("DELETE /mcp/:token", () => {
  it("revokes the token", async () => {
    const ctx = sessionRegistry.issueToken({ agentId: "a1" });
    const del = await request(app).delete(`/mcp/${ctx.token}`);
    expect(del.status).toBe(204);
    expect(sessionRegistry.resolve(ctx.token)).toBeNull();
  });
});
