import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { createDatabase, type DB } from "../db/index.js";
import type { Express } from "express";

let app: Express;
let db: DB;

beforeEach(async () => {
  db = await createDatabase(":memory:");
  app = createApp({ db });
});

describe("GET /api/settings/webhook-auth-key", () => {
  it("should return auto-generated auth key", async () => {
    const res = await request(app).get("/api/settings/webhook-auth-key");
    expect(res.status).toBe(200);
    expect(res.body.data.key).toMatch(/^sk-/);
  });

  it("should return same key on repeated calls", async () => {
    const res1 = await request(app).get("/api/settings/webhook-auth-key");
    const res2 = await request(app).get("/api/settings/webhook-auth-key");
    expect(res1.body.data.key).toBe(res2.body.data.key);
  });
});

describe("POST /api/settings/webhook-auth-key/regenerate", () => {
  it("should generate a new key", async () => {
    const res1 = await request(app).get("/api/settings/webhook-auth-key");
    const res2 = await request(app).post(
      "/api/settings/webhook-auth-key/regenerate",
    );

    expect(res2.status).toBe(200);
    expect(res2.body.data.key).toMatch(/^sk-/);
    expect(res2.body.data.key).not.toBe(res1.body.data.key);
  });
});

describe("agent system prompt setting", () => {
  it("returns empty string by default", async () => {
    const res = await request(app).get("/api/settings/agent-system-prompt");
    expect(res.status).toBe(200);
    expect(res.body.data.value).toBe("");
  });

  it("persists an updated value", async () => {
    await request(app)
      .put("/api/settings/agent-system-prompt")
      .send({ value: "You are an expert SRE." });
    const res = await request(app).get("/api/settings/agent-system-prompt");
    expect(res.body.data.value).toBe("You are an expert SRE.");
  });

  it("rejects non-string value", async () => {
    const res = await request(app)
      .put("/api/settings/agent-system-prompt")
      .send({ value: 123 });
    expect(res.status).toBe(400);
  });
});
