import { eq, desc, count } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DB } from "../db/index.js";
import { invocations } from "../db/schema.js";
import type { CreateInvocationInput, InvocationRow } from "./types.js";

function toRow(raw: typeof invocations.$inferSelect): InvocationRow {
  return {
    ...raw,
    payload: JSON.parse(raw.payload) as Record<string, unknown>,
    prompts: JSON.parse(raw.prompts) as string[],
  };
}

export async function createInvocation(
  db: DB,
  input: CreateInvocationInput,
): Promise<InvocationRow> {
  const id = randomUUID();
  const now = new Date().toISOString();

  await db.insert(invocations).values({
    id,
    scenarioId: input.scenarioId,
    status: input.status,
    alertCount: input.alertCount,
    payload: JSON.stringify(input.payload),
    prompts: JSON.stringify(input.prompts),
    createdAt: now,
  });

  const rows = await db
    .select()
    .from(invocations)
    .where(eq(invocations.id, id));
  if (!rows[0]) throw new Error("Failed to create invocation");
  return toRow(rows[0]);
}

export async function findInvocationsByScenarioId(
  db: DB,
  scenarioId: string,
  limit = 50,
  offset = 0,
): Promise<InvocationRow[]> {
  const rows = await db
    .select()
    .from(invocations)
    .where(eq(invocations.scenarioId, scenarioId))
    .orderBy(desc(invocations.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(toRow);
}

export async function countInvocationsByScenarioId(
  db: DB,
  scenarioId: string,
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(invocations)
    .where(eq(invocations.scenarioId, scenarioId));
  return rows[0]?.value ?? 0;
}
