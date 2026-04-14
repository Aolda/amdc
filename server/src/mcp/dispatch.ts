import type { DB } from "../db/index.js";
import type { McpRegistry } from "./mcp-registry.js";
import type {
  Mcp,
  SessionContext,
  ToolCallResult,
  ToolDefinition,
} from "./types.js";
import {
  composeListedTools,
  mergeWrapperConfig,
  type WrapperRow,
} from "./wrapper.js";
import { fetchMcpConfig, fetchWrapperRows } from "./wrapper-repository.js";
import { runCliTool } from "./plugins/cli/runner.js";

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

function applyFixedParams(
  input: Record<string, unknown>,
  fixed: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!fixed) return input;
  return { ...input, ...fixed };
}

export async function dispatchComposedCall(
  db: DB,
  resolved: ComposedTool,
  rawInput: unknown,
  ctx: SessionContext,
): Promise<ToolCallResult> {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const mcpConfig = await fetchMcpConfig(db, resolved.mcp.name);
  const rowConfig = resolved.row?.config ?? {};
  const mergedConfig = mergeWrapperConfig(mcpConfig, rowConfig);
  const enrichedInput = applyFixedParams(input, mergedConfig.fixedParams);
  const kind = resolved.row?.kind;
  if (kind === "cli" && resolved.row) {
    return runCliTool(
      { ...resolved.row, config: mergedConfig },
      enrichedInput,
      ctx,
    );
  }
  const underlyingName =
    resolved.row?.underlyingToolName ?? resolved.definition.name;
  return resolved.mcp.callTool(underlyingName, enrichedInput, ctx);
}
