import type { ToolDefinition, ToolLevel } from "./types.js";

export type WrapperKind = "mcp" | "native" | "cli" | "script";

export interface WrapperConfig {
  secrets?: Record<string, string>;
  routing?: Record<string, Record<string, unknown>>;
  fixedEnv?: Record<string, string>;
  fixedParams?: Record<string, unknown>;
  command?: string[];
  commandPrefix?: string[];
}

export interface WrapperRow {
  mcpName: string;
  wrapperName: string;
  underlyingToolName: string | null;
  kind: WrapperKind;
  level: ToolLevel;
  description: string;
  inputSchema: Record<string, unknown>;
  hidden: boolean;
  config: WrapperConfig;
}

function mergeRecord<T>(
  a: Record<string, T> | undefined,
  b: Record<string, T> | undefined,
): Record<string, T> | undefined {
  if (!a && !b) return undefined;
  return { ...(a ?? {}), ...(b ?? {}) };
}

function mergeRouting(
  a: WrapperConfig["routing"],
  b: WrapperConfig["routing"],
): WrapperConfig["routing"] {
  if (!a && !b) return undefined;
  const envs = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const out: Record<string, Record<string, unknown>> = {};
  for (const env of envs) {
    out[env] = { ...(a?.[env] ?? {}), ...(b?.[env] ?? {}) };
  }
  return out;
}

export function mergeWrapperConfig(
  mcp: WrapperConfig,
  tool: WrapperConfig,
): WrapperConfig {
  const result: WrapperConfig = {};
  const secrets = mergeRecord(mcp.secrets, tool.secrets);
  if (secrets) result.secrets = secrets;
  const routing = mergeRouting(mcp.routing, tool.routing);
  if (routing) result.routing = routing;
  const fixedEnv = mergeRecord(mcp.fixedEnv, tool.fixedEnv);
  if (fixedEnv) result.fixedEnv = fixedEnv;
  const fixedParams = mergeRecord(mcp.fixedParams, tool.fixedParams);
  if (fixedParams) result.fixedParams = fixedParams;
  if (mcp.commandPrefix || tool.command) {
    result.command = [...(mcp.commandPrefix ?? []), ...(tool.command ?? [])];
  }
  return result;
}

function hasEntries(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).length > 0;
}

function overlayMetadata(
  row: WrapperRow,
  baseline: ToolDefinition | null,
): ToolDefinition {
  return {
    name: row.wrapperName,
    description: row.description || baseline?.description || "",
    inputSchema: hasEntries(row.inputSchema)
      ? row.inputSchema
      : (baseline?.inputSchema ?? {}),
    level: row.level,
  };
}

interface RowIndex {
  byWrapperName: Map<string, WrapperRow>;
  hiddenBaselineNames: Set<string>;
  extraRows: WrapperRow[];
}

function indexRows(rows: WrapperRow[]): RowIndex {
  const byWrapperName = new Map<string, WrapperRow>();
  const hiddenBaselineNames = new Set<string>();
  const extraRows: WrapperRow[] = [];
  for (const row of rows) {
    byWrapperName.set(row.wrapperName, row);
    const underlying = row.underlyingToolName;
    const isPassthrough = underlying !== null && underlying === row.wrapperName;
    if (!isPassthrough) {
      extraRows.push(row);
      continue;
    }
    if (row.hidden && underlying !== null) {
      hiddenBaselineNames.add(underlying);
    }
  }
  return { byWrapperName, hiddenBaselineNames, extraRows };
}

function projectBaseline(
  baseline: ToolDefinition[],
  index: RowIndex,
): ToolDefinition[] {
  const out: ToolDefinition[] = [];
  for (const base of baseline) {
    if (index.hiddenBaselineNames.has(base.name)) continue;
    const row = index.byWrapperName.get(base.name);
    if (!row) {
      out.push(base);
      continue;
    }
    if (row.hidden) continue;
    out.push(overlayMetadata(row, base));
  }
  return out;
}

function findBaselineByUnderlying(
  baseline: ToolDefinition[],
  underlying: string,
): ToolDefinition | null {
  const direct = baseline.find((b) => b.name === underlying);
  if (direct) return direct;
  const suffix = "__" + underlying;
  return baseline.find((b) => b.name.endsWith(suffix)) ?? null;
}

function projectExtras(
  baseline: ToolDefinition[],
  extras: WrapperRow[],
): ToolDefinition[] {
  const out: ToolDefinition[] = [];
  for (const row of extras) {
    if (row.hidden) continue;
    const underlyingBaseline =
      row.underlyingToolName !== null
        ? findBaselineByUnderlying(baseline, row.underlyingToolName)
        : null;
    out.push(overlayMetadata(row, underlyingBaseline));
  }
  return out;
}

export function composeListedTools(
  baseline: ToolDefinition[],
  rows: WrapperRow[],
): ToolDefinition[] {
  const index = indexRows(rows);
  return [
    ...projectBaseline(baseline, index),
    ...projectExtras(baseline, index.extraRows),
  ];
}
