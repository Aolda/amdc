import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { plugins } from "../db/schema.js";
import type { PluginMeta } from "./types.js";

function metadataFor(meta: PluginMeta): string {
  if (meta.kind === "mcp-upstream") {
    return JSON.stringify({ upstreamUrl: meta.upstreamUrl });
  }
  return "{}";
}

export async function syncPluginsToDb(
  db: DB,
  metas: PluginMeta[],
): Promise<void> {
  const now = new Date().toISOString();
  for (const meta of metas) {
    const existing = await db
      .select()
      .from(plugins)
      .where(eq(plugins.name, meta.name));
    const row = {
      name: meta.name,
      kind: meta.kind,
      description: meta.description,
      defaultLevel: meta.defaultLevel,
      metadata: metadataFor(meta),
      updatedAt: now,
    };
    if (existing[0]) {
      await db.update(plugins).set(row).where(eq(plugins.name, meta.name));
    } else {
      await db.insert(plugins).values({ ...row, createdAt: now });
    }
  }
}
