import { and, eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { mcps, mcpTools } from "../db/schema.js";
import type { ToolLevel } from "./types.js";
import type { WrapperConfig, WrapperKind, WrapperRow } from "./wrapper.js";

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function fetchMcpConfig(
  db: DB,
  mcpName: string,
): Promise<WrapperConfig> {
  const rows = await db.select().from(mcps).where(eq(mcps.name, mcpName));
  if (!rows[0]) return {};
  return parseJson<WrapperConfig>(rows[0].config, {});
}

export async function updateMcpConfig(
  db: DB,
  mcpName: string,
  config: WrapperConfig,
): Promise<void> {
  await db
    .update(mcps)
    .set({
      config: JSON.stringify(config),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(mcps.name, mcpName));
}

function rowToWrapper(row: typeof mcpTools.$inferSelect): WrapperRow {
  const kind = row.kind as WrapperKind;
  const underlyingToolName =
    row.underlyingToolName ?? (kind === "mcp" ? row.toolName : null);
  return {
    mcpName: row.mcpName,
    wrapperName: row.toolName,
    underlyingToolName,
    kind,
    level: row.level as ToolLevel,
    description: row.description,
    inputSchema: parseJson<Record<string, unknown>>(row.inputSchema, {}),
    hidden: row.hidden !== 0,
    config: parseJson<WrapperConfig>(row.config, {}),
  };
}

export async function fetchWrapperRows(
  db: DB,
  mcpName: string,
): Promise<WrapperRow[]> {
  const rows = await db
    .select()
    .from(mcpTools)
    .where(eq(mcpTools.mcpName, mcpName));
  return rows.map(rowToWrapper);
}

export async function fetchWrapperRow(
  db: DB,
  mcpName: string,
  wrapperName: string,
): Promise<WrapperRow | null> {
  const rows = await db
    .select()
    .from(mcpTools)
    .where(
      and(eq(mcpTools.mcpName, mcpName), eq(mcpTools.toolName, wrapperName)),
    );
  const row = rows[0];
  return row ? rowToWrapper(row) : null;
}

export async function insertWrapperRow(db: DB, row: WrapperRow): Promise<void> {
  await db.insert(mcpTools).values({
    mcpName: row.mcpName,
    toolName: row.wrapperName,
    level: row.level,
    kind: row.kind,
    underlyingToolName: row.underlyingToolName,
    description: row.description,
    inputSchema: JSON.stringify(row.inputSchema),
    hidden: row.hidden ? 1 : 0,
    config: JSON.stringify(row.config),
  });
}

export async function updateWrapperRow(db: DB, row: WrapperRow): Promise<void> {
  await db
    .update(mcpTools)
    .set({
      level: row.level,
      kind: row.kind,
      underlyingToolName: row.underlyingToolName,
      description: row.description,
      inputSchema: JSON.stringify(row.inputSchema),
      hidden: row.hidden ? 1 : 0,
      config: JSON.stringify(row.config),
    })
    .where(
      and(
        eq(mcpTools.mcpName, row.mcpName),
        eq(mcpTools.toolName, row.wrapperName),
      ),
    );
}

export async function deleteWrapperRow(
  db: DB,
  mcpName: string,
  wrapperName: string,
): Promise<void> {
  await db
    .delete(mcpTools)
    .where(
      and(eq(mcpTools.mcpName, mcpName), eq(mcpTools.toolName, wrapperName)),
    );
}
