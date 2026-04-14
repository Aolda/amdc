import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase, type DB } from "../db/index.js";
import { plugins } from "../db/schema.js";
import { syncPluginsToDb } from "./plugin-sync.js";
import { echoMeta } from "./plugins/echo.js";

let db: DB;

beforeEach(async () => {
  db = await createDatabase(":memory:");
});

describe("syncPluginsToDb", () => {
  it("inserts a plugin row on first sync", async () => {
    await syncPluginsToDb(db, [echoMeta]);
    const rows = await db.select().from(plugins);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("echo");
    expect(rows[0].kind).toBe("native");
    expect(rows[0].defaultLevel).toBe(3);
  });

  it("updates existing row on second sync without duplicating", async () => {
    await syncPluginsToDb(db, [echoMeta]);
    await syncPluginsToDb(db, [echoMeta]);
    const rows = await db.select().from(plugins);
    expect(rows).toHaveLength(1);
  });
});
