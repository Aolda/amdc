import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DB } from "../db/index.js";
import {
  agents,
  agentSkills,
  agentSubAgents,
  agentPlugins,
} from "../db/schema.js";
import type { MarkdownStore } from "../storage/markdown.js";
import type {
  AgentPluginLink,
  AgentRow,
  CreateAgentInput,
  UpdateAgentInput,
} from "./types.js";

async function toRow(
  db: DB,
  raw: typeof agents.$inferSelect,
  store: MarkdownStore,
): Promise<AgentRow> {
  const skillLinks = await db
    .select()
    .from(agentSkills)
    .where(eq(agentSkills.agentId, raw.id));
  const subAgentLinks = await db
    .select()
    .from(agentSubAgents)
    .where(eq(agentSubAgents.agentId, raw.id));
  const pluginLinks = await db
    .select()
    .from(agentPlugins)
    .where(eq(agentPlugins.agentId, raw.id));
  return {
    ...raw,
    body: await store.read(raw.name),
    skillIds: skillLinks.map((link) => link.skillId),
    subAgentIds: subAgentLinks.map((link) => link.subAgentId),
    plugins: pluginLinks.map((link) => ({
      name: link.pluginName,
      levelOverride: (link.levelOverride as 1 | 2 | 3 | null) ?? null,
    })),
  };
}

async function setSkillLinks(
  db: DB,
  agentId: string,
  skillIds: string[],
): Promise<void> {
  await db.delete(agentSkills).where(eq(agentSkills.agentId, agentId));
  if (skillIds.length === 0) return;
  await db
    .insert(agentSkills)
    .values(skillIds.map((skillId) => ({ agentId, skillId })));
}

async function setSubAgentLinks(
  db: DB,
  agentId: string,
  subAgentIds: string[],
): Promise<void> {
  await db.delete(agentSubAgents).where(eq(agentSubAgents.agentId, agentId));
  if (subAgentIds.length === 0) return;
  await db
    .insert(agentSubAgents)
    .values(subAgentIds.map((subAgentId) => ({ agentId, subAgentId })));
}

async function setPluginLinks(
  db: DB,
  agentId: string,
  links: AgentPluginLink[],
): Promise<void> {
  await db.delete(agentPlugins).where(eq(agentPlugins.agentId, agentId));
  if (links.length === 0) return;
  await db.insert(agentPlugins).values(
    links.map((link) => ({
      agentId,
      pluginName: link.name,
      levelOverride: link.levelOverride,
    })),
  );
}

export async function createAgent(
  db: DB,
  store: MarkdownStore,
  input: CreateAgentInput,
): Promise<AgentRow> {
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(agents).values({
    id,
    name: input.name,
    description: input.description ?? "",
    createdAt: now,
    updatedAt: now,
  });
  await store.write(input.name, input.body);
  if (input.skillIds && input.skillIds.length > 0) {
    await setSkillLinks(db, id, input.skillIds);
  }
  if (input.subAgentIds && input.subAgentIds.length > 0) {
    await setSubAgentLinks(db, id, input.subAgentIds);
  }
  if (input.plugins && input.plugins.length > 0) {
    await setPluginLinks(db, id, input.plugins);
  }

  const created = await findAgentById(db, store, id);
  if (!created) throw new Error("Failed to create agent");
  return created;
}

export async function findAllAgents(
  db: DB,
  store: MarkdownStore,
): Promise<AgentRow[]> {
  const rows = await db.select().from(agents);
  return Promise.all(rows.map((row) => toRow(db, row, store)));
}

export async function findAgentById(
  db: DB,
  store: MarkdownStore,
  id: string,
): Promise<AgentRow | undefined> {
  const rows = await db.select().from(agents).where(eq(agents.id, id));
  return rows[0] ? toRow(db, rows[0], store) : undefined;
}

export async function updateAgent(
  db: DB,
  store: MarkdownStore,
  id: string,
  input: UpdateAgentInput,
): Promise<AgentRow | undefined> {
  const existing = await findAgentById(db, store, id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const newName = input.name ?? existing.name;

  await db
    .update(agents)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
      updatedAt: now,
    })
    .where(eq(agents.id, id));

  if (input.name && input.name !== existing.name) {
    await store.remove(existing.name);
  }
  if (input.body !== undefined || input.name !== undefined) {
    await store.write(newName, input.body ?? existing.body);
  }
  if (input.skillIds !== undefined) {
    await setSkillLinks(db, id, input.skillIds);
  }
  if (input.subAgentIds !== undefined) {
    await setSubAgentLinks(db, id, input.subAgentIds);
  }
  if (input.plugins !== undefined) {
    await setPluginLinks(db, id, input.plugins);
  }

  return findAgentById(db, store, id);
}

export async function deleteAgent(
  db: DB,
  store: MarkdownStore,
  id: string,
): Promise<boolean> {
  const existing = await findAgentById(db, store, id);
  if (!existing) return false;
  await db.delete(agents).where(eq(agents.id, id));
  await store.remove(existing.name);
  return true;
}
