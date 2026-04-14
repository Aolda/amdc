import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase, type DB } from "../db/index.js";
import {
  createScenario,
  findAllScenarios,
  findScenarioById,
  findScenarioByName,
  updateScenario,
  deleteScenario,
} from "./repository.js";

let db: DB;

beforeEach(async () => {
  db = await createDatabase(":memory:");
});

const validInput = {
  name: "db-high-cpu",
  description: "CPU 임계치 초과 시 slow query 분석",
  promptTemplate: "DB CPU가 {{value}}%입니다. slow query를 분석하세요",
};

describe("createScenario", () => {
  it("should create with auto-generated id and given name", async () => {
    const result = await createScenario(db, validInput);

    expect(result.id).toBeDefined();
    expect(result.name).toBe("db-high-cpu");
    expect(result.requireAuth).toBe(true);
    expect(result.enabled).toBe(true);
  });

  it("should throw on duplicate name", async () => {
    await createScenario(db, validInput);
    await expect(createScenario(db, validInput)).rejects.toThrow();
  });
});

describe("findAllScenarios", () => {
  it("should return empty array initially", async () => {
    expect(await findAllScenarios(db)).toEqual([]);
  });

  it("should return all scenarios", async () => {
    await createScenario(db, validInput);
    await createScenario(db, {
      ...validInput,
      name: "disk-full",
    });
    expect(await findAllScenarios(db)).toHaveLength(2);
  });
});

describe("findScenarioById", () => {
  it("should find existing scenario", async () => {
    const created = await createScenario(db, validInput);
    const found = await findScenarioById(db, created.id);
    expect(found!.name).toBe("db-high-cpu");
  });

  it("should return undefined for non-existent", async () => {
    expect(await findScenarioById(db, "nope")).toBeUndefined();
  });
});

describe("findScenarioByName", () => {
  it("should find existing scenario by name", async () => {
    await createScenario(db, validInput);
    const found = await findScenarioByName(db, "db-high-cpu");
    expect(found!.name).toBe("db-high-cpu");
  });

  it("should return undefined for non-existent name", async () => {
    expect(await findScenarioByName(db, "nope")).toBeUndefined();
  });
});

describe("updateScenario", () => {
  it("should update name", async () => {
    const created = await createScenario(db, validInput);
    const updated = await updateScenario(db, created.id, {
      name: "new-name",
    });
    expect(updated!.name).toBe("new-name");
  });

  it("should throw on duplicate name update", async () => {
    const s1 = await createScenario(db, validInput);
    await createScenario(db, {
      name: "disk-full",
      promptTemplate: "test",
    });
    await expect(
      updateScenario(db, s1.id, { name: "disk-full" }),
    ).rejects.toThrow();
  });

  it("should toggle enabled", async () => {
    const created = await createScenario(db, validInput);
    const updated = await updateScenario(db, created.id, { enabled: false });
    expect(updated!.enabled).toBe(false);
  });

  it("should return undefined for non-existent", async () => {
    expect(await updateScenario(db, "nope", { name: "x" })).toBeUndefined();
  });
});

describe("deleteScenario", () => {
  it("should delete existing scenario", async () => {
    const created = await createScenario(db, validInput);
    expect(await deleteScenario(db, created.id)).toBe(true);
    expect(await findAllScenarios(db)).toHaveLength(0);
  });

  it("should return false for non-existent", async () => {
    expect(await deleteScenario(db, "nope")).toBe(false);
  });
});
