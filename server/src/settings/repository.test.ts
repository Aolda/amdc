import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase, type DB } from "../db/index.js";
import {
  getSetting,
  setSetting,
  getWebhookAuthKey,
  regenerateWebhookAuthKey,
} from "./repository.js";

let db: DB;

beforeEach(async () => {
  db = await createDatabase(":memory:");
});

describe("getSetting / setSetting", () => {
  it("should return undefined for missing key", async () => {
    expect(await getSetting(db, "nonexistent")).toBeUndefined();
  });

  it("should set and get a value", async () => {
    await setSetting(db, "foo", "bar");
    expect(await getSetting(db, "foo")).toBe("bar");
  });

  it("should overwrite existing value", async () => {
    await setSetting(db, "foo", "bar");
    await setSetting(db, "foo", "baz");
    expect(await getSetting(db, "foo")).toBe("baz");
  });
});

describe("getWebhookAuthKey", () => {
  it("should auto-generate key on first call", async () => {
    const key = await getWebhookAuthKey(db);
    expect(key).toMatch(/^sk-/);
  });

  it("should return same key on subsequent calls", async () => {
    const key1 = await getWebhookAuthKey(db);
    const key2 = await getWebhookAuthKey(db);
    expect(key1).toBe(key2);
  });
});

describe("regenerateWebhookAuthKey", () => {
  it("should generate a new key", async () => {
    const old = await getWebhookAuthKey(db);
    const newKey = await regenerateWebhookAuthKey(db);
    expect(newKey).not.toBe(old);
    expect(await getWebhookAuthKey(db)).toBe(newKey);
  });
});
