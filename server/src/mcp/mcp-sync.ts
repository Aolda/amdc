import { and, eq, ne } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { mcps, mcpTools } from "../db/schema.js";
import type {
  CliMcpMeta,
  McpMeta,
  ToolLevel,
  UpstreamMcpMeta,
} from "./types.js";

function metadataFor(meta: McpMeta): string {
  if (meta.kind === "upstream") {
    if (meta.transport === "stdio") {
      return JSON.stringify({
        transport: "stdio",
        upstreamCommand: meta.upstreamCommand,
        upstreamEnv: meta.upstreamEnv ?? {},
        upstreamCwd: meta.upstreamCwd,
      });
    }
    return JSON.stringify({
      transport: "http",
      upstreamUrl: meta.upstreamUrl,
    });
  }
  return "{}";
}

export async function syncMcpsToDb(db: DB, metas: McpMeta[]): Promise<void> {
  const now = new Date().toISOString();
  for (const meta of metas) {
    const existing = await db
      .select()
      .from(mcps)
      .where(eq(mcps.name, meta.name));
    const row = {
      name: meta.name,
      kind: meta.kind,
      description: meta.description,
      defaultLevel: meta.defaultLevel,
      metadata: metadataFor(meta),
      updatedAt: now,
    };
    if (existing[0]) {
      await db.update(mcps).set(row).where(eq(mcps.name, meta.name));
    } else {
      await db.insert(mcps).values({ ...row, createdAt: now });
    }
  }
}

export async function seedNativeToolLevels(
  db: DB,
  metas: McpMeta[],
): Promise<void> {
  for (const meta of metas) {
    if (meta.kind !== "native") continue;
    for (const tool of meta.tools) {
      const level: ToolLevel = tool.level ?? meta.defaultLevel;
      const existing = await db
        .select()
        .from(mcpTools)
        .where(
          and(
            eq(mcpTools.mcpName, meta.name),
            eq(mcpTools.toolName, tool.name),
          ),
        );
      if (existing[0]) continue;
      await db.insert(mcpTools).values({
        mcpName: meta.name,
        toolName: tool.name,
        level,
      });
    }
  }
}

export async function fetchMcpToolLevels(
  db: DB,
  mcpName: string,
): Promise<Map<string, ToolLevel>> {
  const rows = await db
    .select()
    .from(mcpTools)
    .where(eq(mcpTools.mcpName, mcpName));
  const map = new Map<string, ToolLevel>();
  for (const row of rows) {
    map.set(row.toolName, row.level as ToolLevel);
  }
  return map;
}

export async function upsertMcpToolLevel(
  db: DB,
  mcpName: string,
  toolName: string,
  level: ToolLevel,
): Promise<void> {
  const existing = await db
    .select()
    .from(mcpTools)
    .where(and(eq(mcpTools.mcpName, mcpName), eq(mcpTools.toolName, toolName)));
  if (existing[0]) {
    await db
      .update(mcpTools)
      .set({ level })
      .where(
        and(eq(mcpTools.mcpName, mcpName), eq(mcpTools.toolName, toolName)),
      );
  } else {
    await db.insert(mcpTools).values({ mcpName, toolName, level });
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter((v): v is string => typeof v === "string");
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return value as Record<string, string>;
}

function buildUpstreamMetaFromRow(
  row: { name: string; description: string; defaultLevel: number },
  parsed: Record<string, unknown>,
): UpstreamMcpMeta {
  const base = {
    name: row.name,
    kind: "upstream" as const,
    description: row.description,
    defaultLevel: row.defaultLevel as ToolLevel,
  };
  if (parsed.transport === "stdio") {
    return {
      ...base,
      transport: "stdio",
      upstreamCommand: toStringArray(parsed.upstreamCommand),
      upstreamEnv: toStringRecord(parsed.upstreamEnv),
      upstreamCwd:
        typeof parsed.upstreamCwd === "string" ? parsed.upstreamCwd : undefined,
    };
  }
  return {
    ...base,
    transport: "http",
    upstreamUrl:
      typeof parsed.upstreamUrl === "string" ? parsed.upstreamUrl : "",
  };
}

export async function loadUpstreamMcpsFromDb(
  db: DB,
): Promise<UpstreamMcpMeta[]> {
  const rows = await db.select().from(mcps).where(ne(mcps.kind, "native"));
  const result: UpstreamMcpMeta[] = [];
  for (const row of rows) {
    if (row.kind !== "upstream") continue;
    result.push(buildUpstreamMetaFromRow(row, safeParseObject(row.metadata)));
  }
  return result;
}

function safeParseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function loadCliMcpsFromDb(db: DB): Promise<CliMcpMeta[]> {
  const rows = await db.select().from(mcps).where(eq(mcps.kind, "cli"));
  return rows.map((row) => ({
    name: row.name,
    kind: "cli" as const,
    description: row.description,
    defaultLevel: row.defaultLevel as ToolLevel,
  }));
}
