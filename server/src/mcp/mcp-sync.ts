import { eq, ne } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { mcps } from "../db/schema.js";
import type { McpMeta, ToolLevel, UpstreamMcpMeta } from "./types.js";

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
