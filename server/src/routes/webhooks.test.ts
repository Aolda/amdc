import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { createDatabase, type DB } from "../db/index.js";
import { createScenario } from "../scenarios/repository.js";
import { findInvocationsByScenarioId } from "../invocations/repository.js";
import { getWebhookAuthKey } from "../settings/repository.js";
import type { Express } from "express";
import type { ScenarioRow } from "../scenarios/types.js";

let app: Express;
let db: DB;
let scenario: ScenarioRow;
let authKey: string;

beforeEach(async () => {
  db = await createDatabase(":memory:");
  app = createApp({ db });
  scenario = await createScenario(db, {
    name: "db-high-cpu",
    promptTemplate: "{{instance}}에서 CPU가 {{value}}%입니다. 분석하세요.",
  });
  authKey = await getWebhookAuthKey(db);
});

const makePayload = (scenarioName: string) => ({
  status: "firing",
  alerts: [
    {
      status: "firing",
      labels: {
        alertname: "HighCPU",
        instance: "db-1",
        scenario: scenarioName,
      },
      annotations: { summary: "CPU too high" },
      startsAt: "2026-04-07T15:00:00Z",
      endsAt: "0001-01-01T00:00:00Z",
      generatorURL: "http://grafana:3000/alerting/amdc-high-cpu/view",
      fingerprint: "abc123",
      values: { value: 95.2 },
    },
  ],
});

describe("POST /api/webhooks", () => {
  it("should render variables and include full alert data", async () => {
    const res = await request(app)
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${authKey}`)
      .send(makePayload("db-high-cpu"));

    expect(res.status).toBe(200);
    const prompt = res.body.data.prompts[0];
    expect(prompt).toContain("db-1에서 CPU가 95.2%입니다. 분석하세요.");
    expect(prompt).toContain("--- Alert Data ---");
    expect(prompt).toContain('"alertname": "HighCPU"');
    expect(prompt).toContain('"summary": "CPU too high"');
  });

  it("should reject invalid auth key", async () => {
    const res = await request(app)
      .post("/api/webhooks")
      .set("Authorization", "Bearer sk-wrong")
      .send(makePayload("db-high-cpu"));

    expect(res.status).toBe(401);
  });

  it("should reject missing auth header", async () => {
    const res = await request(app)
      .post("/api/webhooks")
      .send(makePayload("db-high-cpu"));

    expect(res.status).toBe(401);
  });

  it("should return 404 when scenario label is missing", async () => {
    const payload = {
      status: "firing",
      alerts: [
        {
          status: "firing",
          labels: { alertname: "HighCPU" },
          annotations: {},
          startsAt: "2026-04-07T15:00:00Z",
          endsAt: "0001-01-01T00:00:00Z",
          values: {},
        },
      ],
    };

    const res = await request(app)
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${authKey}`)
      .send(payload);

    expect(res.status).toBe(404);
  });

  it("should return 404 for non-existent scenario name", async () => {
    const res = await request(app)
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${authKey}`)
      .send(makePayload("nonexistent"));

    expect(res.status).toBe(404);
  });

  it("should not process when scenario is disabled", async () => {
    const { updateScenario } = await import("../scenarios/repository.js");
    await updateScenario(db, scenario.id, { enabled: false });

    const res = await request(app)
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${authKey}`)
      .send(makePayload("db-high-cpu"));

    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(false);
  });

  it("should save invocation to database", async () => {
    const res = await request(app)
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${authKey}`)
      .send(makePayload("db-high-cpu"));

    expect(res.body.data.invocationId).toBeDefined();

    const invocations = await findInvocationsByScenarioId(db, scenario.id);
    expect(invocations).toHaveLength(1);
    expect(invocations[0].status).toBe("firing");
    expect(invocations[0].alertCount).toBe(1);
    expect(invocations[0].prompts[0]).toContain("db-1에서 CPU가 95.2%");
  });

  it("should skip auth when scenario has requireAuth false", async () => {
    const { updateScenario } = await import("../scenarios/repository.js");
    await updateScenario(db, scenario.id, { requireAuth: false });

    const res = await request(app)
      .post("/api/webhooks")
      .send(makePayload("db-high-cpu"));

    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(true);
  });

  it("should not save invocation for disabled scenario", async () => {
    const { updateScenario } = await import("../scenarios/repository.js");
    await updateScenario(db, scenario.id, { enabled: false });

    await request(app)
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${authKey}`)
      .send(makePayload("db-high-cpu"));

    const invocations = await findInvocationsByScenarioId(db, scenario.id);
    expect(invocations).toHaveLength(0);
  });
});
