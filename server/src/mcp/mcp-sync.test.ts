import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase, type DB } from "../db/index.js";
import { mcps } from "../db/schema.js";
import { syncMcpsToDb } from "./mcp-sync.js";
import { echoMeta } from "./plugins/echo.js";

let db: DB;

beforeEach(async () => {
  db = await createDatabase(":memory:");
});

describe("syncMcpsToDb", () => {
  it("inserts an mcp row on first sync", async () => {
    await syncMcpsToDb(db, [echoMeta]);
    const rows = await db.select().from(mcps);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("echo");
    expect(rows[0].kind).toBe("native");
    expect(rows[0].defaultLevel).toBe(3);
  });

  it("updates existing row on second sync without duplicating", async () => {
    await syncMcpsToDb(db, [echoMeta]);
    await syncMcpsToDb(db, [echoMeta]);
    const rows = await db.select().from(mcps);
    expect(rows).toHaveLength(1);
  });
});
