import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { createDatabase, type DB } from "../db/index.js";
import { syncMcpsToDb, seedNativeToolLevels } from "../mcp/mcp-sync.js";
import { createMcpRegistry } from "../mcp/mcp-registry.js";
import { echoMeta } from "../mcp/plugins/echo.js";
import type { Express } from "express";

let app: Express;
let db: DB;

beforeEach(async () => {
  db = await createDatabase(":memory:");
  await syncMcpsToDb(db, [echoMeta]);
  await seedNativeToolLevels(db, [echoMeta]);
  const mcpRegistry = createMcpRegistry([echoMeta]);
  app = createApp({ db, mcpRegistry });
});

describe("GET /api/mcps", () => {
  it("lists all mcps with meta fields", async () => {
    const res = await request(app).get("/api/mcps");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      name: "echo",
      kind: "native",
      defaultLevel: 3,
    });
  });

  it("returns empty array when no mcps seeded", async () => {
    const emptyDb = await createDatabase(":memory:");
    const emptyApp = createApp({
      db: emptyDb,
      mcpRegistry: createMcpRegistry([]),
    });
    const res = await request(emptyApp).get("/api/mcps");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe("GET /api/mcps/:name/tools", () => {
  it("lists tool definitions for a registered mcp", async () => {
    const res = await request(app).get("/api/mcps/echo/tools");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      name: "echo",
      level: 3,
    });
  });

  it("returns 404 for unknown mcp", async () => {
    const res = await request(app).get("/api/mcps/unknown/tools");
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/mcps/:name/tools/:toolName", () => {
  it("updates a tool level and GET reflects it", async () => {
    const put = await request(app)
      .put("/api/mcps/echo/tools/echo")
      .send({ level: 1 });
    expect(put.status).toBe(200);
    expect(put.body.data.level).toBe(1);
    const list = await request(app).get("/api/mcps/echo/tools");
    expect(list.body.data[0].level).toBe(1);
  });

  it("returns 400 for invalid level", async () => {
    const res = await request(app)
      .put("/api/mcps/echo/tools/echo")
      .send({ level: 5 });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown tool", async () => {
    const res = await request(app)
      .put("/api/mcps/echo/tools/nope")
      .send({ level: 1 });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/mcps", () => {
  it("creates a new upstream mcp", async () => {
    const res = await request(app).post("/api/mcps").send({
      name: "grafana",
      description: "Grafana MCP",
      defaultLevel: 2,
      upstreamUrl: "http://example.invalid/mcp",
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: "grafana",
      kind: "upstream",
      defaultLevel: 2,
      upstreamUrl: "http://example.invalid/mcp",
    });
  });

  it("returns 400 when required fields missing", async () => {
    const res = await request(app)
      .post("/api/mcps")
      .send({ name: "incomplete" });
    expect(res.status).toBe(400);
  });

  it("returns 409 on duplicate name", async () => {
    await request(app).post("/api/mcps").send({
      name: "dup",
      defaultLevel: 3,
      upstreamUrl: "http://x",
    });
    const res = await request(app).post("/api/mcps").send({
      name: "dup",
      defaultLevel: 3,
      upstreamUrl: "http://x",
    });
    expect(res.status).toBe(409);
  });
});

describe("PUT /api/mcps/:name", () => {
  it("updates an upstream mcp", async () => {
    await request(app).post("/api/mcps").send({
      name: "u1",
      defaultLevel: 3,
      upstreamUrl: "http://a",
    });
    const res = await request(app).put("/api/mcps/u1").send({
      defaultLevel: 1,
      upstreamUrl: "http://b",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.defaultLevel).toBe(1);
    expect(res.body.data.upstreamUrl).toBe("http://b");
  });

  it("rejects native mcp with 403", async () => {
    const res = await request(app).put("/api/mcps/echo").send({
      defaultLevel: 1,
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/mcps with stdio transport", () => {
  it("creates an upstream mcp with stdio transport and command", async () => {
    const res = await request(app)
      .post("/api/mcps")
      .send({
        name: "notion",
        kind: "upstream",
        transport: "stdio",
        defaultLevel: 2,
        upstreamCommand: ["npx", "@notionhq/notion-mcp-server"],
        upstreamEnv: { NOTION_TOKEN: "xxx" },
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: "notion",
      kind: "upstream",
      transport: "stdio",
    });
    expect(res.body.data.upstreamCommand).toEqual([
      "npx",
      "@notionhq/notion-mcp-server",
    ]);
  });

  it("rejects stdio without upstreamCommand", async () => {
    const res = await request(app).post("/api/mcps").send({
      name: "bad_stdio",
      kind: "upstream",
      transport: "stdio",
      defaultLevel: 2,
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/mcps with kind=cli", () => {
  it("creates a cli kind mcp without upstreamUrl", async () => {
    const res = await request(app).post("/api/mcps").send({
      name: "amdb_cli",
      kind: "cli",
      description: "AMDB CLI wrappers",
      defaultLevel: 2,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: "amdb_cli",
      kind: "cli",
      defaultLevel: 2,
    });
  });

  it("rejects cli kind if caller still sends invalid fields", async () => {
    const res = await request(app).post("/api/mcps").send({
      name: "bad",
      kind: "cli",
      defaultLevel: 7,
    });
    expect(res.status).toBe(400);
  });

  it("upstream kind still requires upstreamUrl", async () => {
    const res = await request(app).post("/api/mcps").send({
      name: "u_no_url",
      defaultLevel: 2,
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/mcps/:name/tools", () => {
  it("creates a new wrapper row", async () => {
    const res = await request(app)
      .post("/api/mcps/echo/tools")
      .send({
        wrapperName: "echo_shout",
        underlyingToolName: "echo",
        description: "loud echo",
        level: 2,
        config: { fixedParams: { prefix: "!!! " } },
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: "echo_shout",
      wrapperName: "echo_shout",
      underlyingToolName: "echo",
      level: 2,
      hidden: false,
    });
    expect(res.body.data.config.fixedParams).toEqual({ prefix: "!!! " });
  });

  it("returns 409 on duplicate wrapperName", async () => {
    await request(app)
      .post("/api/mcps/echo/tools")
      .send({ wrapperName: "x", level: 3 });
    const res = await request(app)
      .post("/api/mcps/echo/tools")
      .send({ wrapperName: "x", level: 3 });
    expect(res.status).toBe(409);
  });

  it("returns 400 for invalid level", async () => {
    const res = await request(app)
      .post("/api/mcps/echo/tools")
      .send({ wrapperName: "bad", level: 9 });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown mcp", async () => {
    const res = await request(app)
      .post("/api/mcps/nope/tools")
      .send({ wrapperName: "x", level: 3 });
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/mcps/:name/tools/:toolName (full update)", () => {
  it("updates description and hidden on an existing wrapper", async () => {
    await request(app)
      .post("/api/mcps/echo/tools")
      .send({ wrapperName: "shout", underlyingToolName: "echo", level: 3 });
    const res = await request(app)
      .put("/api/mcps/echo/tools/shout")
      .send({ description: "updated", hidden: true });
    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe("updated");
    expect(res.body.data.hidden).toBe(true);
  });
});

describe("DELETE /api/mcps/:name/tools/:toolName", () => {
  it("deletes an existing wrapper row", async () => {
    await request(app)
      .post("/api/mcps/echo/tools")
      .send({ wrapperName: "temp", level: 3 });
    const del = await request(app).delete("/api/mcps/echo/tools/temp");
    expect(del.status).toBe(204);
  });

  it("returns 404 for missing wrapper", async () => {
    const res = await request(app).delete("/api/mcps/echo/tools/ghost");
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/mcps/:name", () => {
  it("deletes an upstream mcp", async () => {
    await request(app).post("/api/mcps").send({
      name: "u2",
      defaultLevel: 3,
      upstreamUrl: "http://x",
    });
    const res = await request(app).delete("/api/mcps/u2");
    expect(res.status).toBe(204);
  });

  it("rejects native mcp delete with 403", async () => {
    const res = await request(app).delete("/api/mcps/echo");
    expect(res.status).toBe(403);
  });
});
