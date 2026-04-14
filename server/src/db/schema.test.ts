import { describe, it, expect } from "vitest";
import { createDatabase } from "./index.js";
import {
  scenarios,
  settings,
  agents,
  skills,
  agentSkills,
  agentSubAgents,
} from "./schema.js";
import { eq } from "drizzle-orm";

describe("database schema", () => {
  it("should create scenarios table", async () => {
    const db = await createDatabase(":memory:");
    const result = await db.select().from(scenarios);
    expect(result).toEqual([]);
  });

  it("should insert and retrieve a scenario", async () => {
    const db = await createDatabase(":memory:");
    const now = new Date().toISOString();

    await db.insert(scenarios).values({
      id: "test-id",
      name: "db-high-cpu",
      promptTemplate: "CPU is high: {{value}}%",
      createdAt: now,
      updatedAt: now,
    });

    const rows = await db.select().from(scenarios);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("db-high-cpu");
    expect(rows[0].requireAuth).toBe(1);
    expect(rows[0].enabled).toBe(1);
  });

  it("should enforce unique name constraint", async () => {
    const db = await createDatabase(":memory:");
    const now = new Date().toISOString();
    const values = {
      id: "id-1",
      name: "duplicate",
      promptTemplate: "test",
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(scenarios).values(values);

    await expect(
      db.insert(scenarios).values({ ...values, id: "id-2" }),
    ).rejects.toThrow();
  });

  it("should delete a scenario by id", async () => {
    const db = await createDatabase(":memory:");
    const now = new Date().toISOString();

    await db.insert(scenarios).values({
      id: "del-id",
      name: "to-delete",
      promptTemplate: "test",
      createdAt: now,
      updatedAt: now,
    });

    await db.delete(scenarios).where(eq(scenarios.id, "del-id"));
    const rows = await db.select().from(scenarios);
    expect(rows).toHaveLength(0);
  });

  it("should create settings table", async () => {
    const db = await createDatabase(":memory:");
    const result = await db.select().from(settings);
    expect(result).toEqual([]);
  });

  it("should insert and retrieve an agent", async () => {
    const db = await createDatabase(":memory:");
    const now = new Date().toISOString();

    await db.insert(agents).values({
      id: "agent-1",
      name: "ops-agent",
      description: "primary ops",
      createdAt: now,
      updatedAt: now,
    });

    const rows = await db.select().from(agents);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("ops-agent");
  });

  it("should enforce unique name on agents", async () => {
    const db = await createDatabase(":memory:");
    const now = new Date().toISOString();
    const values = {
      id: "a-1",
      name: "dup",
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(agents).values(values);
    await expect(
      db.insert(agents).values({ ...values, id: "a-2" }),
    ).rejects.toThrow();
  });

  it("should insert and retrieve a skill", async () => {
    const db = await createDatabase(":memory:");
    const now = new Date().toISOString();

    await db.insert(skills).values({
      id: "skill-1",
      name: "log-grep",
      description: "search logs",
      createdAt: now,
      updatedAt: now,
    });

    const rows = await db.select().from(skills);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("log-grep");
  });

  it("should link agents and skills via agent_skills", async () => {
    const db = await createDatabase(":memory:");
    const now = new Date().toISOString();

    await db.insert(agents).values({
      id: "agent-1",
      name: "ops",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(skills).values([
      {
        id: "skill-1",
        name: "s1",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "skill-2",
        name: "s2",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(agentSkills).values([
      { agentId: "agent-1", skillId: "skill-1" },
      { agentId: "agent-1", skillId: "skill-2" },
    ]);

    const rows = await db
      .select()
      .from(agentSkills)
      .where(eq(agentSkills.agentId, "agent-1"));
    expect(rows).toHaveLength(2);
  });

  it("should enforce composite primary key on agent_skills", async () => {
    const db = await createDatabase(":memory:");
    const now = new Date().toISOString();

    await db.insert(agents).values({
      id: "agent-1",
      name: "ops",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(skills).values({
      id: "skill-1",
      name: "s1",
      createdAt: now,
      updatedAt: now,
    });

    await db
      .insert(agentSkills)
      .values({ agentId: "agent-1", skillId: "skill-1" });
    await expect(
      db.insert(agentSkills).values({ agentId: "agent-1", skillId: "skill-1" }),
    ).rejects.toThrow();
  });

  it("should link agents to sub-agents via agent_sub_agents", async () => {
    const db = await createDatabase(":memory:");
    const now = new Date().toISOString();

    await db.insert(agents).values([
      { id: "agent-1", name: "parent", createdAt: now, updatedAt: now },
      { id: "agent-2", name: "child", createdAt: now, updatedAt: now },
    ]);

    await db
      .insert(agentSubAgents)
      .values({ agentId: "agent-1", subAgentId: "agent-2" });

    const rows = await db
      .select()
      .from(agentSubAgents)
      .where(eq(agentSubAgents.agentId, "agent-1"));
    expect(rows).toHaveLength(1);
    expect(rows[0].subAgentId).toBe("agent-2");
  });

  it("should enforce composite primary key on agent_sub_agents", async () => {
    const db = await createDatabase(":memory:");
    const now = new Date().toISOString();

    await db.insert(agents).values([
      { id: "agent-1", name: "parent", createdAt: now, updatedAt: now },
      { id: "agent-2", name: "child", createdAt: now, updatedAt: now },
    ]);

    await db
      .insert(agentSubAgents)
      .values({ agentId: "agent-1", subAgentId: "agent-2" });
    await expect(
      db
        .insert(agentSubAgents)
        .values({ agentId: "agent-1", subAgentId: "agent-2" }),
    ).rejects.toThrow();
  });
});
