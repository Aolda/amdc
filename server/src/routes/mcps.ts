import { Router, type Router as ExpressRouter } from "express";
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { mcps as mcpsTable } from "../db/schema.js";
import type { McpRegistry } from "../mcp/mcp-registry.js";
import type {
  CliMcpMeta,
  McpKind,
  ToolLevel,
  UpstreamMcpMeta,
} from "../mcp/types.js";
import { upsertMcpToolLevel } from "../mcp/mcp-sync.js";
import type { WrapperConfig, WrapperKind, WrapperRow } from "../mcp/wrapper.js";
import {
  deleteWrapperRow,
  fetchWrapperRow,
  fetchWrapperRows,
  insertWrapperRow,
  updateWrapperRow,
} from "../mcp/wrapper-repository.js";

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

interface WrapperRowPayload {
  wrapperName?: string;
  underlyingToolName?: string | null;
  kind?: WrapperKind;
  level?: number;
  description?: string;
  inputSchema?: Record<string, unknown>;
  hidden?: boolean;
  config?: WrapperConfig;
}

const WRAPPER_KINDS: ReadonlySet<WrapperKind> = new Set([
  "mcp",
  "native",
  "cli",
  "script",
]);

function validateWrapperPayload(
  body: Partial<WrapperRowPayload>,
  { partial }: { partial: boolean },
): { error?: string } {
  if (body.level !== undefined && ![1, 2, 3].includes(body.level)) {
    return { error: "level must be 1|2|3" };
  }
  if (body.kind !== undefined && !WRAPPER_KINDS.has(body.kind)) {
    return { error: "kind must be mcp|native|cli|script" };
  }
  if (!partial && body.level === undefined) {
    // level is optional on create (falls back to mcp.defaultLevel), so no error
  }
  return {};
}

function mergeWrapperPayload(
  base: WrapperRow,
  body: Partial<WrapperRowPayload>,
): WrapperRow {
  return {
    ...base,
    underlyingToolName:
      body.underlyingToolName !== undefined
        ? body.underlyingToolName
        : base.underlyingToolName,
    kind: body.kind ?? base.kind,
    level: (body.level ?? base.level) as ToolLevel,
    description: body.description ?? base.description,
    inputSchema: body.inputSchema ?? base.inputSchema,
    hidden: body.hidden ?? base.hidden,
    config: body.config ?? base.config,
  };
}

function seedWrapperFromBaseline(
  mcpName: string,
  wrapperName: string,
  baseline: {
    description: string;
    inputSchema: Record<string, unknown>;
    level: ToolLevel;
  },
): WrapperRow {
  return {
    mcpName,
    wrapperName,
    underlyingToolName: wrapperName,
    kind: "mcp",
    level: baseline.level,
    description: "",
    inputSchema: {},
    hidden: false,
    config: {},
  };
}

function wrapperRowToJson(row: WrapperRow): Record<string, unknown> {
  return {
    name: row.wrapperName,
    wrapperName: row.wrapperName,
    underlyingToolName: row.underlyingToolName,
    kind: row.kind,
    level: row.level,
    description: row.description,
    inputSchema: row.inputSchema,
    hidden: row.hidden,
    config: row.config,
  };
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
    const baseline = await mcp.listTools();
    const dbRows = await fetchWrapperRows(db, req.params.name);
    const dbByName = new Map(dbRows.map((r) => [r.wrapperName, r]));
    const data: Record<string, unknown>[] = [];
    const toSeed: { name: string; level: ToolLevel }[] = [];
    for (const base of baseline) {
      const row = dbByName.get(base.name);
      if (row) {
        data.push(
          wrapperRowToJson({
            ...row,
            description: row.description || base.description,
            inputSchema:
              Object.keys(row.inputSchema).length > 0
                ? row.inputSchema
                : base.inputSchema,
          }),
        );
      } else {
        data.push({
          name: base.name,
          wrapperName: base.name,
          underlyingToolName: base.name,
          kind: "mcp",
          level: base.level,
          description: base.description,
          inputSchema: base.inputSchema,
          hidden: false,
          config: {},
        });
        toSeed.push({ name: base.name, level: base.level });
      }
    }
    for (const row of dbRows) {
      if (row.underlyingToolName !== row.wrapperName) {
        data.push(wrapperRowToJson(row));
      }
    }
    for (const seed of toSeed) {
      await upsertMcpToolLevel(db, req.params.name, seed.name, seed.level);
    }
    res.json({ data });
  });

  router.put("/:name/tools/:toolName", async (req, res) => {
    if (!registry) {
      res.status(503).json({ error: { message: "registry not configured" } });
      return;
    }
    const mcp = registry.findMcp(req.params.name);
    if (!mcp) {
      res.status(404).json({ error: { message: "mcp not found" } });
      return;
    }
    const existing = await fetchWrapperRow(
      db,
      req.params.name,
      req.params.toolName,
    );
    const fromBaseline = existing
      ? undefined
      : (await mcp.listTools()).find((t) => t.name === req.params.toolName);
    if (!existing && !fromBaseline) {
      res.status(404).json({ error: { message: "tool not found" } });
      return;
    }
    const body = req.body as Partial<WrapperRowPayload>;
    const validation = validateWrapperPayload(body, { partial: true });
    if (validation.error) {
      res.status(400).json({ error: { message: validation.error } });
      return;
    }
    const base =
      existing ??
      seedWrapperFromBaseline(
        req.params.name,
        req.params.toolName,
        fromBaseline as {
          description: string;
          inputSchema: Record<string, unknown>;
          level: ToolLevel;
        },
      );
    const merged = mergeWrapperPayload(base, body);
    if (existing) {
      await updateWrapperRow(db, merged);
    } else {
      await insertWrapperRow(db, merged);
    }
    res.json({ data: wrapperRowToJson(merged) });
  });

  router.post("/:name/tools", async (req, res) => {
    const mcpRow = await db
      .select()
      .from(mcpsTable)
      .where(eq(mcpsTable.name, req.params.name));
    if (!mcpRow[0]) {
      res.status(404).json({ error: { message: "mcp not found" } });
      return;
    }
    const body = req.body as Partial<WrapperRowPayload>;
    const validation = validateWrapperPayload(body, { partial: false });
    if (validation.error) {
      res.status(400).json({ error: { message: validation.error } });
      return;
    }
    if (!body.wrapperName) {
      res.status(400).json({ error: { message: "wrapperName required" } });
      return;
    }
    const existing = await fetchWrapperRow(
      db,
      req.params.name,
      body.wrapperName,
    );
    if (existing) {
      res.status(409).json({
        error: { message: "wrapper with that name already exists" },
      });
      return;
    }
    const defaultKind: WrapperKind =
      mcpRow[0].kind === "upstream" ? "mcp" : (mcpRow[0].kind as WrapperKind);
    const row: WrapperRow = {
      mcpName: req.params.name,
      wrapperName: body.wrapperName,
      underlyingToolName: body.underlyingToolName ?? null,
      kind: body.kind ?? defaultKind,
      level: (body.level ?? mcpRow[0].defaultLevel) as ToolLevel,
      description: body.description ?? "",
      inputSchema: body.inputSchema ?? {},
      hidden: body.hidden ?? false,
      config: body.config ?? {},
    };
    await insertWrapperRow(db, row);
    res.status(201).json({ data: wrapperRowToJson(row) });
  });

  router.delete("/:name/tools/:toolName", async (req, res) => {
    const existing = await fetchWrapperRow(
      db,
      req.params.name,
      req.params.toolName,
    );
    if (!existing) {
      res.status(404).json({ error: { message: "tool not found" } });
      return;
    }
    await deleteWrapperRow(db, req.params.name, req.params.toolName);
    res.status(204).send();
  });

  router.post("/", async (req, res) => {
    const { name, description, defaultLevel, upstreamUrl, kind } = req.body as {
      name?: string;
      description?: string;
      defaultLevel?: number;
      upstreamUrl?: string;
      kind?: McpKind;
    };
    const resolvedKind: McpKind = kind ?? "upstream";
    if (resolvedKind !== "upstream" && resolvedKind !== "cli") {
      res
        .status(400)
        .json({ error: { message: "kind must be upstream or cli" } });
      return;
    }
    if (
      !name ||
      typeof name !== "string" ||
      defaultLevel === undefined ||
      ![1, 2, 3].includes(defaultLevel)
    ) {
      res.status(400).json({
        error: { message: "name and defaultLevel(1|2|3) required" },
      });
      return;
    }
    if (
      resolvedKind === "upstream" &&
      (!upstreamUrl || typeof upstreamUrl !== "string")
    ) {
      res
        .status(400)
        .json({ error: { message: "upstreamUrl required for upstream kind" } });
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
      kind: resolvedKind,
      description: description ?? "",
      defaultLevel,
      metadata:
        resolvedKind === "upstream" ? JSON.stringify({ upstreamUrl }) : "{}",
      createdAt: now,
      updatedAt: now,
    });
    if (registry) {
      const meta: UpstreamMcpMeta | CliMcpMeta =
        resolvedKind === "upstream"
          ? {
              name,
              kind: "upstream",
              description: description ?? "",
              defaultLevel: defaultLevel as ToolLevel,
              upstreamUrl: upstreamUrl ?? "",
            }
          : {
              name,
              kind: "cli",
              description: description ?? "",
              defaultLevel: defaultLevel as ToolLevel,
            };
      registry.addMcp(meta);
    }
    res.status(201).json({
      data: {
        name,
        kind: resolvedKind,
        description: description ?? "",
        defaultLevel,
        upstreamUrl: resolvedKind === "upstream" ? upstreamUrl : undefined,
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
    if (existing.kind === "native") {
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
    const nextMetadata =
      existing.kind === "upstream"
        ? JSON.stringify({
            upstreamUrl:
              upstreamUrl ??
              parseUpstreamMetadata(existing.metadata).upstreamUrl,
          })
        : existing.metadata;
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
      const meta: UpstreamMcpMeta | CliMcpMeta =
        existing.kind === "upstream"
          ? {
              name: existing.name,
              kind: "upstream",
              description: nextDescription,
              defaultLevel: nextDefaultLevel as ToolLevel,
              upstreamUrl: parseUpstreamMetadata(nextMetadata).upstreamUrl,
            }
          : {
              name: existing.name,
              kind: "cli",
              description: nextDescription,
              defaultLevel: nextDefaultLevel as ToolLevel,
            };
      registry.addMcp(meta);
    }
    res.json({
      data: {
        name: existing.name,
        kind: existing.kind,
        description: nextDescription,
        defaultLevel: nextDefaultLevel,
        upstreamUrl:
          existing.kind === "upstream"
            ? parseUpstreamMetadata(nextMetadata).upstreamUrl
            : undefined,
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
    if (existing.kind === "native") {
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
