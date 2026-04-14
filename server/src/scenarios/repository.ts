import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DB } from "../db/index.js";
import { scenarios } from "../db/schema.js";
import type {
  CreateScenarioInput,
  UpdateScenarioInput,
  ScenarioRow,
} from "./types.js";

function toRow(raw: typeof scenarios.$inferSelect): ScenarioRow {
  return {
    ...raw,
    requireAuth: raw.requireAuth === 1,
    enabled: raw.enabled === 1,
  } as ScenarioRow;
}

export async function createScenario(
  db: DB,
  input: CreateScenarioInput,
): Promise<ScenarioRow> {
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(scenarios).values({
    id,
    name: input.name,
    description: input.description ?? "",
    promptTemplate: input.promptTemplate,
    requireAuth: input.requireAuth === false ? 0 : 1,
    createdAt: now,
    updatedAt: now,
  });

  const created = await findScenarioById(db, id);
  if (!created) throw new Error("Failed to create scenario");
  return created;
}

export async function findAllScenarios(db: DB): Promise<ScenarioRow[]> {
  const rows = await db.select().from(scenarios);
  return rows.map(toRow);
}

export async function findScenarioById(
  db: DB,
  id: string,
): Promise<ScenarioRow | undefined> {
  const rows = await db.select().from(scenarios).where(eq(scenarios.id, id));
  return rows[0] ? toRow(rows[0]) : undefined;
}

export async function findScenarioByName(
  db: DB,
  name: string,
): Promise<ScenarioRow | undefined> {
  const rows = await db
    .select()
    .from(scenarios)
    .where(eq(scenarios.name, name));
  return rows[0] ? toRow(rows[0]) : undefined;
}

export async function updateScenario(
  db: DB,
  id: string,
  input: UpdateScenarioInput,
): Promise<ScenarioRow | undefined> {
  const existing = await findScenarioById(db, id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  await db
    .update(scenarios)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
      ...(input.promptTemplate !== undefined && {
        promptTemplate: input.promptTemplate,
      }),
      ...(input.requireAuth !== undefined && {
        requireAuth: input.requireAuth ? 1 : 0,
      }),
      ...(input.enabled !== undefined && {
        enabled: input.enabled ? 1 : 0,
      }),
      updatedAt: now,
    })
    .where(eq(scenarios.id, id));

  return findScenarioById(db, id);
}

export async function deleteScenario(db: DB, id: string): Promise<boolean> {
  const result = await db
    .delete(scenarios)
    .where(eq(scenarios.id, id))
    .returning();
  return result.length > 0;
}
