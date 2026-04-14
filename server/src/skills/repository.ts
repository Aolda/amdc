import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DB } from "../db/index.js";
import { skills } from "../db/schema.js";
import type { MarkdownStore } from "../storage/markdown.js";
import type { SkillRow, CreateSkillInput, UpdateSkillInput } from "./types.js";

async function toRow(
  raw: typeof skills.$inferSelect,
  store: MarkdownStore,
): Promise<SkillRow> {
  return { ...raw, body: await store.read(raw.name) };
}

export async function createSkill(
  db: DB,
  store: MarkdownStore,
  input: CreateSkillInput,
): Promise<SkillRow> {
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(skills).values({
    id,
    name: input.name,
    description: input.description ?? "",
    createdAt: now,
    updatedAt: now,
  });
  await store.write(input.name, input.body);

  const created = await findSkillById(db, store, id);
  if (!created) throw new Error("Failed to create skill");
  return created;
}

export async function findAllSkills(
  db: DB,
  store: MarkdownStore,
): Promise<SkillRow[]> {
  const rows = await db.select().from(skills);
  return Promise.all(rows.map((row) => toRow(row, store)));
}

export async function findSkillById(
  db: DB,
  store: MarkdownStore,
  id: string,
): Promise<SkillRow | undefined> {
  const rows = await db.select().from(skills).where(eq(skills.id, id));
  return rows[0] ? toRow(rows[0], store) : undefined;
}

export async function updateSkill(
  db: DB,
  store: MarkdownStore,
  id: string,
  input: UpdateSkillInput,
): Promise<SkillRow | undefined> {
  const existing = await findSkillById(db, store, id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const newName = input.name ?? existing.name;

  await db
    .update(skills)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
      updatedAt: now,
    })
    .where(eq(skills.id, id));

  if (input.name && input.name !== existing.name) {
    await store.remove(existing.name);
  }
  if (input.body !== undefined || input.name !== undefined) {
    await store.write(newName, input.body ?? existing.body);
  }

  return findSkillById(db, store, id);
}

export async function deleteSkill(
  db: DB,
  store: MarkdownStore,
  id: string,
): Promise<boolean> {
  const existing = await findSkillById(db, store, id);
  if (!existing) return false;
  await db.delete(skills).where(eq(skills.id, id));
  await store.remove(existing.name);
  return true;
}
