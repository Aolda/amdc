import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app.js";
import { createDatabase, type DB } from "../db/index.js";
import { createMarkdownStore } from "../storage/markdown.js";
import { createSkill } from "../skills/repository.js";
import { syncPluginsToDb } from "../mcp/plugin-sync.js";
import { echoMeta } from "../mcp/plugins/echo.js";
import type { Express } from "express";

let app: Express;
let db: DB;
let agentDir: string;
let skillDir: string;
let skillStore: ReturnType<typeof createMarkdownStore>;

beforeEach(async () => {
  db = await createDatabase(":memory:");
  agentDir = mkdtempSync(join(tmpdir(), "amdc-agents-route-"));
  skillDir = mkdtempSync(join(tmpdir(), "amdc-skills-route-"));
  skillStore = createMarkdownStore(skillDir);
  await syncPluginsToDb(db, [echoMeta]);
  app = createApp({
    db,
    agentStore: createMarkdownStore(agentDir),
    skillStore,
  });
});

afterEach(() => {
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(skillDir, { recursive: true, force: true });
});

const validBody = {
  name: "ops",
  description: "primary ops agent",
  body: "# Ops agent instructions",
};

describe("POST /api/agents", () => {
  it("creates an agent", async () => {
    const res = await request(app).post("/api/agents").send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("ops");
    expect(res.body.data.skillIds).toEqual([]);
    expect(res.body.data.subAgentIds).toEqual([]);
  });

  it("creates an agent with sub-agent links", async () => {
    const sub = await request(app)
      .post("/api/agents")
      .send({ name: "helper", body: "# helper" });
    const res = await request(app)
      .post("/api/agents")
      .send({ ...validBody, subAgentIds: [sub.body.data.id] });
    expect(res.status).toBe(201);
    expect(res.body.data.subAgentIds).toEqual([sub.body.data.id]);
  });

  it("creates an agent with skill links", async () => {
    const s1 = await createSkill(db, skillStore, {
      name: "s1",
      body: "x",
    });
    const res = await request(app)
      .post("/api/agents")
      .send({ ...validBody, skillIds: [s1.id] });
    expect(res.status).toBe(201);
    expect(res.body.data.skillIds).toEqual([s1.id]);
  });

  it("returns 400 when required fields missing", async () => {
    const res = await request(app)
      .post("/api/agents")
      .send({ description: "x" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/agents", () => {
  it("lists agents", async () => {
    await request(app).post("/api/agents").send(validBody);
    const res = await request(app).get("/api/agents");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe("GET /api/agents/:id", () => {
  it("returns single agent with body and skills", async () => {
    const created = await request(app).post("/api/agents").send(validBody);
    const res = await request(app).get(`/api/agents/${created.body.data.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.body).toBe("# Ops agent instructions");
  });

  it("returns 404 for missing agent", async () => {
    const res = await request(app).get("/api/agents/nope");
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/agents/:id", () => {
  it("updates agent and replaces skill links", async () => {
    const s1 = await createSkill(db, skillStore, {
      name: "s1",
      body: "",
    });
    const s2 = await createSkill(db, skillStore, {
      name: "s2",
      body: "",
    });
    const created = await request(app)
      .post("/api/agents")
      .send({ ...validBody, skillIds: [s1.id] });
    const res = await request(app)
      .put(`/api/agents/${created.body.data.id}`)
      .send({ skillIds: [s2.id], body: "updated" });
    expect(res.status).toBe(200);
    expect(res.body.data.skillIds).toEqual([s2.id]);
    expect(res.body.data.body).toBe("updated");
  });
});

describe("agent plugin links", () => {
  it("creates an agent with plugin links and returns them", async () => {
    const res = await request(app)
      .post("/api/agents")
      .send({
        ...validBody,
        plugins: [{ name: "echo", levelOverride: 2 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.plugins).toEqual([{ name: "echo", levelOverride: 2 }]);
  });

  it("updates an agent's plugin links via PUT", async () => {
    const created = await request(app).post("/api/agents").send(validBody);
    const res = await request(app)
      .put(`/api/agents/${created.body.data.id}`)
      .send({ plugins: [{ name: "echo", levelOverride: null }] });
    expect(res.status).toBe(200);
    expect(res.body.data.plugins).toEqual([
      { name: "echo", levelOverride: null },
    ]);
  });

  it("returns empty plugins array when none provided", async () => {
    const res = await request(app).post("/api/agents").send(validBody);
    expect(res.body.data.plugins).toEqual([]);
  });
});

describe("DELETE /api/agents/:id", () => {
  it("deletes an agent", async () => {
    const created = await request(app).post("/api/agents").send(validBody);
    const res = await request(app).delete(
      `/api/agents/${created.body.data.id}`,
    );
    expect(res.status).toBe(204);
  });
});
