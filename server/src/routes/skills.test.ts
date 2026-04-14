import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app.js";
import { createDatabase, type DB } from "../db/index.js";
import { createMarkdownStore } from "../storage/markdown.js";
import type { Express } from "express";

let app: Express;
let db: DB;
let dir: string;

beforeEach(async () => {
  db = await createDatabase(":memory:");
  dir = mkdtempSync(join(tmpdir(), "amdc-skills-route-"));
  app = createApp({ db, skillStore: createMarkdownStore(dir) });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const validBody = {
  name: "log-grep",
  description: "search logs",
  body: "# Grep instructions",
};

describe("POST /api/skills", () => {
  it("creates a skill", async () => {
    const res = await request(app).post("/api/skills").send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("log-grep");
    expect(res.body.data.body).toBe("# Grep instructions");
  });

  it("returns 400 when required fields missing", async () => {
    const res = await request(app)
      .post("/api/skills")
      .send({ description: "x" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/skills", () => {
  it("lists skills", async () => {
    await request(app).post("/api/skills").send(validBody);
    const res = await request(app).get("/api/skills");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe("GET /api/skills/:id", () => {
  it("returns single skill with body", async () => {
    const created = await request(app).post("/api/skills").send(validBody);
    const res = await request(app).get(`/api/skills/${created.body.data.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.body).toBe("# Grep instructions");
  });

  it("returns 404 for missing skill", async () => {
    const res = await request(app).get("/api/skills/nope");
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/skills/:id", () => {
  it("updates a skill", async () => {
    const created = await request(app).post("/api/skills").send(validBody);
    const res = await request(app)
      .put(`/api/skills/${created.body.data.id}`)
      .send({ name: "renamed", body: "new body" });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("renamed");
    expect(res.body.data.body).toBe("new body");
  });
});

describe("DELETE /api/skills/:id", () => {
  it("deletes a skill", async () => {
    const created = await request(app).post("/api/skills").send(validBody);
    const res = await request(app).delete(
      `/api/skills/${created.body.data.id}`,
    );
    expect(res.status).toBe(204);
  });
});
