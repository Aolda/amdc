import { Router, type Router as ExpressRouter } from "express";
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { mcps as mcpsTable } from "../db/schema.js";
import type { McpRegistry } from "../mcp/mcp-registry.js";
import type { UpstreamMcpMeta } from "../mcp/types.js";

interface UpstreamMetadata {
  upstreamUrl: string;
}

function parseUpstreamMetadata(value: string): UpstreamMetadata {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.upstreamUrl !== "string") {
      throw new Error("upstreamUrl missing");
    }
    return { upstreamUrl: parsed.upstreamUrl };
  } catch {
    return { upstreamUrl: "" };
  }
}

export function createMcpsRouter(
  db: DB,
  registry?: McpRegistry,
): ExpressRouter {
  const router: ExpressRouter = Router();

  router.get("/", async (_req, res) => {
    const rows = await db.select().from(mcpsTable);
    const data = rows.map((row) => ({
      name: row.name,
      kind: row.kind,
      description: row.description,
      defaultLevel: row.defaultLevel,
      upstreamUrl:
        row.kind === "upstream"
          ? parseUpstreamMetadata(row.metadata).upstreamUrl
          : undefined,
    }));
    res.json({ data });
  });

  router.get("/:name/tools", async (req, res) => {
    if (!registry) {
      res.status(503).json({ error: { message: "registry not configured" } });
      return;
    }
    const mcp = registry.findMcp(req.params.name);
    if (!mcp) {
      res.status(404).json({ error: { message: "mcp not found" } });
      return;
    }
    const tools = await mcp.listTools();
    res.json({
      data: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        level: tool.level,
      })),
    });
  });

  router.post("/", async (req, res) => {
    const { name, description, defaultLevel, upstreamUrl } = req.body as {
      name?: string;
      description?: string;
      defaultLevel?: number;
      upstreamUrl?: string;
    };
    if (
      !name ||
      typeof name !== "string" ||
      !upstreamUrl ||
      typeof upstreamUrl !== "string" ||
      defaultLevel === undefined ||
      ![1, 2, 3].includes(defaultLevel)
    ) {
      res.status(400).json({
        error: {
          message: "name, upstreamUrl, defaultLevel(1|2|3) required",
        },
      });
      return;
    }
    const existing = await db
      .select()
      .from(mcpsTable)
      .where(eq(mcpsTable.name, name));
    if (existing[0]) {
      res
        .status(409)
        .json({ error: { message: "mcp with that name already exists" } });
      return;
    }
    const now = new Date().toISOString();
    await db.insert(mcpsTable).values({
      name,
      kind: "upstream",
      description: description ?? "",
      defaultLevel,
      metadata: JSON.stringify({ upstreamUrl }),
      createdAt: now,
      updatedAt: now,
    });
    if (registry) {
      const meta: UpstreamMcpMeta = {
        name,
        kind: "upstream",
        description: description ?? "",
        defaultLevel: defaultLevel as 1 | 2 | 3,
        upstreamUrl,
      };
      registry.addMcp(meta);
    }
    res.status(201).json({
      data: {
        name,
        kind: "upstream",
        description: description ?? "",
        defaultLevel,
        upstreamUrl,
      },
    });
  });

  router.put("/:name", async (req, res) => {
    const rows = await db
      .select()
      .from(mcpsTable)
      .where(eq(mcpsTable.name, req.params.name));
    const existing = rows[0];
    if (!existing) {
      res.status(404).json({ error: { message: "mcp not found" } });
      return;
    }
    if (existing.kind !== "upstream") {
      res.status(403).json({ error: { message: "native mcp is read-only" } });
      return;
    }
    const { description, defaultLevel, upstreamUrl } = req.body as {
      description?: string;
      defaultLevel?: number;
      upstreamUrl?: string;
    };
    const now = new Date().toISOString();
    const nextDescription = description ?? existing.description;
    const nextDefaultLevel = defaultLevel ?? existing.defaultLevel;
    if (![1, 2, 3].includes(nextDefaultLevel)) {
      res
        .status(400)
        .json({ error: { message: "defaultLevel must be 1|2|3" } });
      return;
    }
    const nextMetadata = JSON.stringify({
      upstreamUrl:
        upstreamUrl ?? parseUpstreamMetadata(existing.metadata).upstreamUrl,
    });
    await db
      .update(mcpsTable)
      .set({
        description: nextDescription,
        defaultLevel: nextDefaultLevel,
        metadata: nextMetadata,
        updatedAt: now,
      })
      .where(eq(mcpsTable.name, existing.name));
    if (registry) {
      registry.removeMcp(existing.name);
      registry.addMcp({
        name: existing.name,
        kind: "upstream",
        description: nextDescription,
        defaultLevel: nextDefaultLevel as 1 | 2 | 3,
        upstreamUrl: parseUpstreamMetadata(nextMetadata).upstreamUrl,
      });
    }
    res.json({
      data: {
        name: existing.name,
        kind: "upstream",
        description: nextDescription,
        defaultLevel: nextDefaultLevel,
        upstreamUrl: parseUpstreamMetadata(nextMetadata).upstreamUrl,
      },
    });
  });

  router.delete("/:name", async (req, res) => {
    const rows = await db
      .select()
      .from(mcpsTable)
      .where(eq(mcpsTable.name, req.params.name));
    const existing = rows[0];
    if (!existing) {
      res.status(404).json({ error: { message: "mcp not found" } });
      return;
    }
    if (existing.kind !== "upstream") {
      res.status(403).json({ error: { message: "native mcp is read-only" } });
      return;
    }
    await db.delete(mcpsTable).where(eq(mcpsTable.name, existing.name));
    if (registry) {
      registry.removeMcp(existing.name);
    }
    res.status(204).send();
  });

  return router;
}
