import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, type DB } from "../db/index.js";
import { createMarkdownStore } from "../storage/markdown.js";
import { createSkill } from "../skills/repository.js";
import { syncPluginsToDb } from "../mcp/plugin-sync.js";
import { echoMeta } from "../mcp/plugins/echo.js";
import {
  createAgent,
  findAllAgents,
  findAgentById,
  updateAgent,
  deleteAgent,
} from "./repository.js";

describe("agents repository", () => {
  let db: DB;
  let agentDir: string;
  let skillDir: string;
  let agentStore: ReturnType<typeof createMarkdownStore>;
  let skillStore: ReturnType<typeof createMarkdownStore>;

  beforeEach(async () => {
    db = await createDatabase(":memory:");
    agentDir = mkdtempSync(join(tmpdir(), "amdc-agents-"));
    skillDir = mkdtempSync(join(tmpdir(), "amdc-skills-"));
    agentStore = createMarkdownStore(agentDir);
    skillStore = createMarkdownStore(skillDir);
    await syncPluginsToDb(db, [echoMeta]);
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(skillDir, { recursive: true, force: true });
  });

  it("creates an agent without skills or sub-agents", async () => {
    const agent = await createAgent(db, agentStore, {
      name: "ops",
      body: "# ops",
    });
    expect(agent.name).toBe("ops");
    expect(agent.body).toBe("# ops");
    expect(agent.skillIds).toEqual([]);
    expect(agent.subAgentIds).toEqual([]);
  });

  it("creates an agent with skills", async () => {
    const s1 = await createSkill(db, skillStore, {
      name: "s1",
      body: "x",
    });
    const s2 = await createSkill(db, skillStore, {
      name: "s2",
      body: "y",
    });
    const agent = await createAgent(db, agentStore, {
      name: "ops",
      body: "# ops",
      skillIds: [s1.id, s2.id],
    });
    expect(agent.skillIds.sort()).toEqual([s1.id, s2.id].sort());
  });

  it("lists all agents", async () => {
    await createAgent(db, agentStore, { name: "a", body: "a" });
    await createAgent(db, agentStore, { name: "b", body: "b" });
    const all = await findAllAgents(db, agentStore);
    expect(all).toHaveLength(2);
  });

  it("updates skill links replacing previous set", async () => {
    const s1 = await createSkill(db, skillStore, {
      name: "s1",
      body: "",
    });
    const s2 = await createSkill(db, skillStore, {
      name: "s2",
      body: "",
    });
    const s3 = await createSkill(db, skillStore, {
      name: "s3",
      body: "",
    });
    const agent = await createAgent(db, agentStore, {
      name: "ops",
      body: "x",
      skillIds: [s1.id, s2.id],
    });
    const updated = await updateAgent(db, agentStore, agent.id, {
      skillIds: [s3.id],
    });
    expect(updated?.skillIds).toEqual([s3.id]);
  });

  it("updates body file", async () => {
    const agent = await createAgent(db, agentStore, {
      name: "ops",
      body: "old",
    });
    const updated = await updateAgent(db, agentStore, agent.id, {
      body: "new",
    });
    expect(updated?.body).toBe("new");
  });

  it("creates an agent with sub-agent links", async () => {
    const sub = await createAgent(db, agentStore, {
      name: "helper",
      body: "# helper",
    });
    const agent = await createAgent(db, agentStore, {
      name: "ops",
      body: "# ops",
      subAgentIds: [sub.id],
    });
    expect(agent.subAgentIds).toEqual([sub.id]);
  });

  it("updates sub-agent links replacing previous set", async () => {
    const sub1 = await createAgent(db, agentStore, {
      name: "helper-1",
      body: "",
    });
    const sub2 = await createAgent(db, agentStore, {
      name: "helper-2",
      body: "",
    });
    const agent = await createAgent(db, agentStore, {
      name: "ops",
      body: "x",
      subAgentIds: [sub1.id],
    });
    const updated = await updateAgent(db, agentStore, agent.id, {
      subAgentIds: [sub2.id],
    });
    expect(updated?.subAgentIds).toEqual([sub2.id]);
  });

  it("creates an agent with plugin links", async () => {
    const agent = await createAgent(db, agentStore, {
      name: "ops",
      body: "# ops",
      plugins: [{ name: "echo", levelOverride: null }],
    });
    expect(agent.plugins).toEqual([{ name: "echo", levelOverride: null }]);
  });

  it("updates plugin links replacing previous set with override", async () => {
    const agent = await createAgent(db, agentStore, {
      name: "ops",
      body: "x",
      plugins: [{ name: "echo", levelOverride: null }],
    });
    const updated = await updateAgent(db, agentStore, agent.id, {
      plugins: [{ name: "echo", levelOverride: 2 }],
    });
    expect(updated?.plugins).toEqual([{ name: "echo", levelOverride: 2 }]);
  });

  it("clears plugin links when empty array passed", async () => {
    const agent = await createAgent(db, agentStore, {
      name: "ops",
      body: "x",
      plugins: [{ name: "echo", levelOverride: null }],
    });
    const updated = await updateAgent(db, agentStore, agent.id, {
      plugins: [],
    });
    expect(updated?.plugins).toEqual([]);
  });

  it("deletes agent and removes file", async () => {
    const agent = await createAgent(db, agentStore, {
      name: "ops",
      body: "x",
    });
    const ok = await deleteAgent(db, agentStore, agent.id);
    expect(ok).toBe(true);
    expect(await findAgentById(db, agentStore, agent.id)).toBeUndefined();
  });
});
