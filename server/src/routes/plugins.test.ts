import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { createDatabase, type DB } from "../db/index.js";
import { syncPluginsToDb } from "../mcp/plugin-sync.js";
import { echoMeta } from "../mcp/plugins/echo.js";
import type { Express } from "express";

let app: Express;
let db: DB;

beforeEach(async () => {
  db = await createDatabase(":memory:");
  await syncPluginsToDb(db, [echoMeta]);
  app = createApp({ db });
});

describe("GET /api/plugins", () => {
  it("lists all plugins with meta fields", async () => {
    const res = await request(app).get("/api/plugins");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      name: "echo",
      kind: "native",
      defaultLevel: 3,
    });
  });

  it("returns empty array when no plugins seeded", async () => {
    const emptyDb = await createDatabase(":memory:");
    const emptyApp = createApp({ db: emptyDb });
    const res = await request(emptyApp).get("/api/plugins");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
