import type { ToolRuntimeResult } from "../tools/types.js";

export function localToolDetails(environment: string, args: Record<string, unknown>, result?: ToolRuntimeResult) {
  if (environment !== "dev" || process.env.AMDC_LOCAL_TOOL_TRACE !== "true") return {};
  const pick = (values: Readonly<Record<string, unknown>>) => Object.fromEntries(
    Object.entries(values).filter(([key]) => ["schema", "table", "namePrefix", "mysqlUser", "connectionId", "transactionId", "includeIdle", "limit", "databaseName", "tableName", "metricName", "job", "instance", "username", "device", "mode", "hostgroup", "start", "end", "time", "stepSeconds"].includes(key))
      .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 128) : typeof value === "boolean" || typeof value === "number" ? value : "[unsupported]"])
  );
  return { localDetails: {
    args: pick(args),
    ...prometheusCounts(result),
    ...(result?.ok && "rawResult" in result && result.rawResult.transport === "mysql" ? {
      appliedFilters: pick(result.rawResult.appliedFilters),
      returnedRows: result.rawResult.returnedRows,
      truncated: result.rawResult.truncated,
      limit: result.rawResult.limit
    } : {})
  } };
}

function prometheusCounts(result?: ToolRuntimeResult): { resultType?: string; seriesCount?: number; pointCount?: number; itemCount?: number } {
  if (!result?.ok || !("rawResult" in result) || result.rawResult.source !== "prometheus" || result.rawResult.transport !== "http") return {};
  try {
    const data = JSON.parse(result.rawResult.response.body).data;
    if (Array.isArray(data)) return { itemCount: data.length };
    if (!data || typeof data !== "object") return {};
    if (Array.isArray(data.result) && ["matrix", "vector"].includes(data.resultType)) {
      return {
        resultType: data.resultType,
        seriesCount: data.result.length,
        pointCount: data.result.reduce((count: number, series: { values?: unknown[]; value?: unknown[] }) => count + (Array.isArray(series?.values) ? series.values.length : Array.isArray(series?.value) ? 1 : 0), 0)
      };
    }
    return { itemCount: Array.isArray(data.activeTargets) ? data.activeTargets.length : Object.keys(data).length };
  } catch { return {}; }
}
