import { createConnection } from "mysql2/promise";
import type { ConnectionOptions, RowDataPacket } from "mysql2";
import type { ToolDefinition, ToolRuntimeContext, ToolRuntimeResult, SanitizedToolError } from "../types.js";

const MAX_BYTES = 65536;
export interface MysqlReader {
  execute(sql: string, values: (string | number)[]): Promise<Record<string, unknown>[]>;
  destroy(): void;
}
export type MysqlConnect = (options: ConnectionOptions) => Promise<MysqlReader>;
const connect: MysqlConnect = async (options) => {
  const connection = await createConnection(options);
  return {
    execute: async (sql, values) => (await connection.execute<RowDataPacket[]>(sql, values))[0],
    destroy: () => connection.destroy()
  };
};

// SQL and optional predicates are trusted catalog definitions; values are bound separately.
export function buildMysqlQuery(tool: ToolDefinition, args: Record<string, unknown>) {
  if (tool.execution.type !== "mysql_sql") throw new Error("invalid_execution");
  const execution = tool.execution;
  const properties = tool.inputSchema.properties ?? {};
  if (Object.keys(args).some(k => !(k in properties))) throw new Error("invalid_input");
  for (const key of tool.inputSchema.required ?? []) if (!(key in args)) throw new Error("invalid_input");
  for (const [key, value] of Object.entries(args)) {
    const p = properties[key];
    if (p.type === "string") {
      if (typeof value !== "string" || value.includes("\0") || (p.minLength !== undefined && value.length < p.minLength) || (p.maxLength !== undefined && value.length > p.maxLength) || (p.pattern && !new RegExp(p.pattern).test(value)) || (p.enum && !p.enum.includes(value))) throw new Error("invalid_input");
    } else if (p.type === "boolean") {
      if (typeof value !== "boolean") throw new Error("invalid_input");
    } else if (typeof value !== "number" || !Number.isFinite(value) || (p.type === "integer" && !Number.isInteger(value)) || (p.minimum !== undefined && value < p.minimum) || (p.maximum !== undefined && value > p.maximum) || (p.enum && !p.enum.includes(value))) throw new Error("invalid_input");
  }
  for (const [key, dependency] of Object.entries(execution.requires)) if (args[key] !== undefined && args[dependency] === undefined) throw new Error("invalid_input");
  const effective = { ...execution.defaults, ...args };
  const limit = effective.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("invalid_input");
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  for (const filter of execution.filters) {
    if (effective[filter.input] === undefined || (filter.when !== undefined && effective[filter.input] !== filter.when)) continue;
    conditions.push(filter.sql);
    for (const binding of filter.bindings) {
      const value = effective[binding];
      if (typeof value !== "string" && typeof value !== "number") throw new Error("invalid_input");
      values.push(value);
    }
  }
  const conjunction = /\bWHERE\b/i.test(execution.sql) ? " AND " : " WHERE ";
  return { sql: execution.sql + (conditions.length ? conjunction + conditions.join(" AND ") : "") + " ORDER BY " + execution.orderBy + " LIMIT ?", values: [...values, limit + 1], limit };
}

export async function executeMysqlTool(tool: ToolDefinition, args: Record<string, unknown>, context: ToolRuntimeContext,
  connector: MysqlConnect = connect, environment: NodeJS.ProcessEnv = process.env): Promise<ToolRuntimeResult> {
  const failure = (code: SanitizedToolError["code"]): ToolRuntimeResult => ({ ok: false, error: {
    toolName: tool.name, pluginName: tool.pluginName, code,
    message: `MySQL read failed: ${code}.`, occurredAt: new Date().toISOString()
  } });
  if (tool.execution.type !== "mysql_sql") return failure("source_unavailable");
  const execution = tool.execution;
  let query;
  try { query = buildMysqlQuery(tool, args); } catch { return failure("invalid_input"); }
  const prefix = tool.execution.environmentPrefix[context.environment];
  const host = environment[`${prefix}HOST`], user = environment[`${prefix}USER`], password = environment[`${prefix}PASSWORD`];
  const port = Number(environment[`${prefix}PORT`] ?? 3306);
  if (!host || !user || !password || !Number.isInteger(port) || port < 1 || port > 65535) return failure("source_unavailable");
  // Production connections require CA-verified TLS; never silently downgrade.
  const ca = environment[`${prefix}TLS_CA`];
  if (context.environment === "prod" && !ca) return failure("source_unavailable");
  if (context.signal?.aborted) return failure("tool_timeout");
  let reader: MysqlReader | undefined;
  let expired = false;
  let rejectDeadline: (error: Error) => void = () => {};
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const abort = () => { expired = true; reader?.destroy(); rejectDeadline(new Error("tool_timeout")); };
  const timer = setTimeout(abort, tool.timeoutMs);
  context.signal?.addEventListener("abort", abort, { once: true });
  try {
    const work = async () => {
      reader = await connector({ host, user, password, port, connectTimeout: tool.timeoutMs,
        supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, multipleStatements: false,
        ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}) });
      if (expired) { reader.destroy(); throw new Error("tool_timeout"); }
      const sql = query.sql.replace(/^SELECT /, `SELECT /*+ MAX_EXECUTION_TIME(${Math.max(1, Math.floor(tool.timeoutMs))}) */ `);
      const rows = await reader.execute(sql, query.values);
      const selected = rows.slice(0, query.limit);
      const body = JSON.stringify(selected);
      if (Buffer.byteLength(body) > MAX_BYTES) return failure("tool_output_too_large");
      const secrets = Object.entries(environment).filter(([k,v]) => /TOKEN|PASSWORD|SECRET|API_KEY|PRIVATE_KEY|SESSION/i.test(k) && v && v.length >= 8).map(([,v]) => v!);
      if (secrets.some(s => body.includes(s)) || /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i.test(body)) return failure("secret_exposure_risk");
      return { ok: true, rawResult: { toolName: tool.name, pluginName: tool.pluginName, source: "mysql",
        transport: "mysql", collectedAt: new Date().toISOString(), rows: selected,
        appliedFilters: Object.fromEntries(Object.entries({ ...args,
          ...Object.fromEntries(Object.entries(execution.defaults).filter(([key]) => key !== "limit" && args[key] === undefined))
        }).filter(([key]) => key !== "limit")), limit: query.limit,
        returnedRows: selected.length, truncated: rows.length > query.limit } } satisfies ToolRuntimeResult;
    };
    return await Promise.race([work(), deadline]);
  } catch (error) {
    const code = (error as { code?: string }).code;
    return failure(expired || code === "ER_QUERY_TIMEOUT" || code === "ETIMEDOUT" ? "tool_timeout" : ["ER_ACCESS_DENIED_ERROR", "ER_TABLEACCESS_DENIED_ERROR", "ER_SPECIFIC_ACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR"].includes(code ?? "")
      ? "source_permission_denied" : ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(code ?? "") ? "source_unavailable" : "source_request_failed");
  } finally {
    clearTimeout(timer); context.signal?.removeEventListener("abort", abort); reader?.destroy();
  }
}
