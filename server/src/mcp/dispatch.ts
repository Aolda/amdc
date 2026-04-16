import type { DB } from "../db/index.js";
import type { McpRegistry } from "./mcp-registry.js";
import type {
  Mcp,
  PermissionChecker,
  SessionContext,
  ToolDefinition,
} from "./types.js";
import {
  composeListedTools,
  mergeWrapperConfig,
  type WrapperRow,
} from "./wrapper.js";
import { fetchMcpConfig, fetchWrapperRows } from "./wrapper-repository.js";
import {
  composeMiddleware,
  type ToolCallContext,
  type ToolCallNext,
} from "./middleware/types.js";
import { authMiddleware } from "./middleware/auth.js";
import { envMiddleware } from "./middleware/env.js";
import { fixedParamsMiddleware } from "./middleware/fixed-params.js";
import { secretMaskMiddleware } from "./middleware/secret-mask.js";
import { logMiddleware } from "./middleware/log.js";

export interface ComposedTool {
  mcp: Mcp;
  definition: ToolDefinition;
  row: WrapperRow | null;
}

async function composeForMcp(db: DB, mcp: Mcp): Promise<ComposedTool[]> {
  const baseline = await mcp.listTools();
  const rows = await fetchWrapperRows(db, mcp.name);
  const composed = composeListedTools(baseline, rows);
  const byName = new Map(rows.map((r) => [r.wrapperName, r]));
  return composed.map((definition) => ({
    mcp,
    definition,
    row: byName.get(definition.name) ?? null,
  }));
}

export async function composeAllTools(
  db: DB,
  registry: McpRegistry,
): Promise<ComposedTool[]> {
  const all: ComposedTool[] = [];
  for (const mcp of registry.listMcps()) {
    const entries = await composeForMcp(db, mcp);
    all.push(...entries);
  }
  return all;
}

export async function resolveComposedTool(
  db: DB,
  registry: McpRegistry,
  wrapperName: string,
): Promise<ComposedTool | null> {
  for (const mcp of registry.listMcps()) {
    const entries = await composeForMcp(db, mcp);
    const found = entries.find((e) => e.definition.name === wrapperName);
    if (found) return found;
  }
  return null;
}

export async function buildToolCallContext(
  db: DB,
  tool: ComposedTool,
  rawInput: unknown,
  session: SessionContext,
): Promise<ToolCallContext> {
  const mcpConfig = await fetchMcpConfig(db, tool.mcp.name);
  const rowConfig = tool.row?.config ?? {};
  const mergedConfig = mergeWrapperConfig(mcpConfig, rowConfig);
  const input = (rawInput ?? {}) as Record<string, unknown>;
  return {
    session,
    tool,
    input,
    mergedConfig,
    namespaces: {
      input: input as Record<string, string | number | boolean | undefined>,
    },
  };
}

export function createDispatchFinal(): ToolCallNext {
  return async (ctx) => {
    const { tool, input, session, mergedConfig } = ctx;
    const kind = tool.row?.kind;
    if (kind === "cli" && tool.row) {
      const { runCliTool } = await import("./plugins/cli/runner.js");
      return runCliTool({ ...tool.row, config: mergedConfig }, input, session);
    }
    const underlyingName = tool.row?.underlyingToolName ?? tool.definition.name;
    return tool.mcp.callTool(underlyingName, input, session);
  };
}

export function createPipeline(checker: PermissionChecker): ToolCallNext {
  return composeMiddleware(
    [
      authMiddleware(checker),
      envMiddleware(),
      fixedParamsMiddleware(),
      secretMaskMiddleware(),
      logMiddleware(),
    ],
    createDispatchFinal(),
  );
}
