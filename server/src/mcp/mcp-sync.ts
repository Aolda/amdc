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
    return JSON.stringify({ upstreamUrl: meta.upstreamUrl });
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

export async function loadUpstreamMcpsFromDb(
  db: DB,
): Promise<UpstreamMcpMeta[]> {
  const rows = await db.select().from(mcps).where(ne(mcps.kind, "native"));
  const result: UpstreamMcpMeta[] = [];
  for (const row of rows) {
    if (row.kind !== "upstream") continue;
    let upstreamUrl = "";
    try {
      const parsed = JSON.parse(row.metadata) as Record<string, unknown>;
      if (typeof parsed.upstreamUrl === "string") {
        upstreamUrl = parsed.upstreamUrl;
      }
    } catch {
      // skip malformed metadata
    }
    result.push({
      name: row.name,
      kind: "upstream",
      description: row.description,
      defaultLevel: row.defaultLevel as ToolLevel,
      upstreamUrl,
    });
  }
  return result;
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
