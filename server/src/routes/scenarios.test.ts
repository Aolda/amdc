import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { createDatabase, type DB } from "../db/index.js";
import { createInvocation } from "../invocations/repository.js";
import type { Express } from "express";

let app: Express;
let db: DB;

beforeEach(async () => {
  db = await createDatabase(":memory:");
  app = createApp({ db });
});

const validBody = {
  name: "db-high-cpu",
  description: "Analyze slow queries when CPU spikes",
  promptTemplate: "DB CPU is at {{value}}%. Analyze slow queries.",
};

describe("GET /api/scenarios", () => {
  it("should return empty array initially", async () => {
    const res = await request(app).get("/api/scenarios");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe("POST /api/scenarios", () => {
  it("should create a scenario", async () => {
    const res = await request(app).post("/api/scenarios").send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("db-high-cpu");
    expect(res.body.data.requireAuth).toBe(true);
    expect(res.body.data.enabled).toBe(true);
  });

  it("should reject missing fields", async () => {
    const res = await request(app)
      .post("/api/scenarios")
      .send({ description: "incomplete" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/scenarios/:id", () => {
  it("should return scenario by id", async () => {
    const created = await request(app).post("/api/scenarios").send(validBody);
    const res = await request(app).get(
      `/api/scenarios/${created.body.data.id}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("db-high-cpu");
  });

  it("should return 404 for non-existent", async () => {
    const res = await request(app).get("/api/scenarios/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/scenarios/:id", () => {
  it("should update scenario", async () => {
    const created = await request(app).post("/api/scenarios").send(validBody);
    const res = await request(app)
      .put(`/api/scenarios/${created.body.data.id}`)
      .send({ name: "updated" });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("updated");
  });

  it("should toggle enabled", async () => {
    const created = await request(app).post("/api/scenarios").send(validBody);
    const res = await request(app)
      .put(`/api/scenarios/${created.body.data.id}`)
      .send({ enabled: false });

    expect(res.body.data.enabled).toBe(false);
  });
});

describe("GET /api/scenarios/:id/invocations", () => {
  it("should return invocations for a scenario", async () => {
    const created = await request(app).post("/api/scenarios").send(validBody);
    const id = created.body.data.id;

    await createInvocation(db, {
      scenarioId: id,
      status: "firing",
      alertCount: 1,
      payload: { alerts: [] },
      prompts: ["test prompt"],
    });

    const res = await request(app).get(`/api/scenarios/${id}/invocations`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe("firing");
  });

  it("should include invocationCount in scenario list", async () => {
    const created = await request(app).post("/api/scenarios").send(validBody);
    const id = created.body.data.id;

    await createInvocation(db, {
      scenarioId: id,
      status: "firing",
      alertCount: 1,
      payload: {},
      prompts: ["p"],
    });

    const res = await request(app).get("/api/scenarios");
    expect(res.body.data[0].invocationCount).toBe(1);
  });
});

describe("DELETE /api/scenarios/:id", () => {
  it("should delete scenario", async () => {
    const created = await request(app).post("/api/scenarios").send(validBody);
    const res = await request(app).delete(
      `/api/scenarios/${created.body.data.id}`,
    );
    expect(res.status).toBe(204);
  });

  it("should return 404 for non-existent", async () => {
    const res = await request(app).delete("/api/scenarios/nonexistent");
    expect(res.status).toBe(404);
  });
});
