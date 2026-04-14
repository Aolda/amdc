import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase, type DB } from "../db/index.js";
import { createScenario } from "../scenarios/repository.js";
import {
  createInvocation,
  findInvocationsByScenarioId,
  countInvocationsByScenarioId,
} from "./repository.js";

let db: DB;
let scenarioId: string;

beforeEach(async () => {
  db = await createDatabase(":memory:");
  const scenario = await createScenario(db, {
    name: "test-scenario",
    promptTemplate: "Test {{value}}",
  });
  scenarioId = scenario.id;
});

describe("createInvocation", () => {
  it("should create and return an invocation", async () => {
    const inv = await createInvocation(db, {
      scenarioId,
      status: "firing",
      alertCount: 2,
      payload: { alerts: [] },
      prompts: ["prompt1", "prompt2"],
    });

    expect(inv.id).toBeDefined();
    expect(inv.scenarioId).toBe(scenarioId);
    expect(inv.status).toBe("firing");
    expect(inv.alertCount).toBe(2);
    expect(inv.prompts).toEqual(["prompt1", "prompt2"]);
    expect(inv.createdAt).toBeDefined();
  });
});

describe("findInvocationsByScenarioId", () => {
  it("should return invocations for a scenario ordered by newest first", async () => {
    await createInvocation(db, {
      scenarioId,
      status: "firing",
      alertCount: 1,
      payload: {},
      prompts: ["first"],
    });
    await createInvocation(db, {
      scenarioId,
      status: "resolved",
      alertCount: 1,
      payload: {},
      prompts: ["second"],
    });

    const results = await findInvocationsByScenarioId(db, scenarioId);
    expect(results).toHaveLength(2);
    const allPrompts = results.map((r) => r.prompts[0]);
    expect(allPrompts).toContain("first");
    expect(allPrompts).toContain("second");
  });

  it("should support limit and offset", async () => {
    for (let i = 0; i < 5; i++) {
      await createInvocation(db, {
        scenarioId,
        status: "firing",
        alertCount: 1,
        payload: {},
        prompts: [`prompt-${i}`],
      });
    }

    const page = await findInvocationsByScenarioId(db, scenarioId, 2, 1);
    expect(page).toHaveLength(2);
  });

  it("should return empty for unknown scenario", async () => {
    const results = await findInvocationsByScenarioId(db, "nonexistent");
    expect(results).toEqual([]);
  });
});

describe("countInvocationsByScenarioId", () => {
  it("should return correct count", async () => {
    await createInvocation(db, {
      scenarioId,
      status: "firing",
      alertCount: 1,
      payload: {},
      prompts: ["p"],
    });
    await createInvocation(db, {
      scenarioId,
      status: "firing",
      alertCount: 1,
      payload: {},
      prompts: ["p"],
    });

    expect(await countInvocationsByScenarioId(db, scenarioId)).toBe(2);
  });

  it("should return 0 for unknown scenario", async () => {
    expect(await countInvocationsByScenarioId(db, "nonexistent")).toBe(0);
  });
});
