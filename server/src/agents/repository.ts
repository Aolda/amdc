import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DB } from "../db/index.js";
import {
  agents,
  agentSkills,
  agentSubAgents,
  agentMcps,
  agentMcpTools,
} from "../db/schema.js";
import type { MarkdownStore } from "../storage/markdown.js";
import type {
  AgentMcpLink,
  AgentRow,
  CreateAgentInput,
  ToolLevel,
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
  const mcpLinks = await db
    .select()
    .from(agentMcps)
    .where(eq(agentMcps.agentId, raw.id));
  const toolOverrideRows = await db
    .select()
    .from(agentMcpTools)
    .where(eq(agentMcpTools.agentId, raw.id));
  return {
    ...raw,
    body: await store.read(raw.name),
    skillIds: skillLinks.map((link) => link.skillId),
    subAgentIds: subAgentLinks.map((link) => link.subAgentId),
    mcps: mcpLinks.map((link) => ({
      name: link.mcpName,
      levelOverride: (link.levelOverride as ToolLevel | null) ?? null,
      toolOverrides: toolOverrideRows
        .filter((row) => row.mcpName === link.mcpName)
        .map((row) => ({
          toolName: row.toolName,
          level: row.levelOverride as ToolLevel,
        })),
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

async function setMcpLinks(
  db: DB,
  agentId: string,
  links: AgentMcpLink[],
): Promise<void> {
  await db.delete(agentMcpTools).where(eq(agentMcpTools.agentId, agentId));
  await db.delete(agentMcps).where(eq(agentMcps.agentId, agentId));
  if (links.length === 0) return;
  await db.insert(agentMcps).values(
    links.map((link) => ({
      agentId,
      mcpName: link.name,
      levelOverride: link.levelOverride,
    })),
  );
  const toolRows = links.flatMap((link) =>
    (link.toolOverrides ?? []).map((override) => ({
      agentId,
      mcpName: link.name,
      toolName: override.toolName,
      levelOverride: override.level,
    })),
  );
  if (toolRows.length > 0) {
    await db.insert(agentMcpTools).values(toolRows);
  }
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
  if (input.mcps && input.mcps.length > 0) {
    await setMcpLinks(db, id, input.mcps);
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
  if (input.mcps !== undefined) {
    await setMcpLinks(db, id, input.mcps);
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
