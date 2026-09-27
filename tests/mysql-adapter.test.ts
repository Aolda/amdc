import test from "node:test";
import assert from "node:assert/strict";
import { jsonObjectSchemaToZod } from "../src/agent/langchain-schemas.js";
import { loadToolCatalogFromYaml, parseToolCatalog } from "../src/tools/catalog-loader.js";
import { PluginRegistry } from "../src/tools/plugin-registry.js";
import { buildMysqlQuery as buildQuery, executeMysqlTool, type MysqlConnect } from "../src/tools/source-adapters/mysql-adapter.js";
const registry = new PluginRegistry(loadToolCatalogFromYaml(new URL("../src/tools/catalogs/amdb-tools.yaml", import.meta.url).pathname));
const MYSQL_OPERATIONS = registry.listAllTools().filter(t => registry.getTool(t.name)?.execution.type === "mysql_sql").map(t => t.name);
const buildMysqlQuery = (name: string, args: Record<string, unknown>) => buildQuery(registry.getTool(name)!, args);
const env = { AMDC_DEV_MYSQL_HOST: "fake", AMDC_DEV_MYSQL_USER: "diagnostic", AMDC_DEV_MYSQL_PASSWORD: "fake-password" };
const context = { environment: "dev" as const, referenceTime: new Date() };
const tool = registry.getTool("mysql_get_all_processlist")!;

test("all direct readers are registered; filter values never enter SQL", () => {
  for (const operation of MYSQL_OPERATIONS) {
    assert.equal(registry.getTool(operation)?.source, "mysql");
    const args = operation.endsWith("by_connection_id") ? { connectionId: "1" }
      : operation === "mysql_get_transaction_by_transaction_id" ? { transactionId: "1" }
      : operation.endsWith("by_database") ? { databaseName: "sg" }
      : operation.endsWith("by_table") ? { databaseName: "sg", tableName: "items" }
      : {};
    assert.match(buildMysqlQuery(operation, args).sql, /^SELECT /);
  }
  const name = "sg_' OR 1=1 --";
  const q = buildMysqlQuery("mysql_get_processlist_by_database", { databaseName: name });
  assert.ok(!q.sql.includes(name));
  assert.equal((q.sql.match(/\bWHERE\b/g) ?? []).length, 1);
  assert.match(q.sql, /AND t.PROCESSLIST_DB = \?/);
  assert.deepEqual(q.values, [name, 101]);
  assert.match(q.sql, /COMMAND <> 'Sleep'/);
  assert.doesNotMatch(buildMysqlQuery("mysql_get_all_processlist", {}).sql, /COMMAND <> 'Sleep'/);
  assert.match(buildMysqlQuery("mysql_get_active_processlist", {}).sql, /COMMAND <> 'Sleep'/);
  assert.throws(() => buildMysqlQuery("mysql_get_all_processlist", { includeIdle: true }));
  assert.throws(() => buildMysqlQuery("mysql_get_all_processlist", { databaseName: "sg" }));
});
test("account remains output-only for processlist and transactions", () => {
  for (const name of ["mysql_get_processlist_by_connection_id", "mysql_get_transactions_by_connection_id"]) {
    assert.equal(registry.getTool(name)?.inputSchema.properties?.mysqlUser, undefined);
    assert.throws(() => buildMysqlQuery(name, { mysqlUser: "root" }));
    const query = buildMysqlQuery(name, { connectionId: "2153" });
    assert.match(query.sql, /PROCESSLIST_USER AS mysqlUser/);
    assert.doesNotMatch(query.sql, /PROCESSLIST_USER =/);
    assert.deepEqual(query.values, ["2153", name === "mysql_get_processlist_by_connection_id" ? 2 : 101]);
  }
});
test("model schema matches ID and integer execution constraints", () => {
  const byIdTool = registry.getTool("mysql_get_processlist_by_connection_id")!;
  const schema = jsonObjectSchemaToZod(byIdTool.inputSchema);
  for (const args of [{}, { connectionId: "?" }, { connectionId: "1".repeat(21) }, { connectionId: "1", limit: 1 }]) {
    assert.equal(schema.safeParse(args).success, false);
    assert.throws(() => buildMysqlQuery("mysql_get_processlist_by_connection_id", args));
  }
  assert.equal(schema.safeParse({ connectionId: "2153" }).success, true);
  assert.deepEqual(buildMysqlQuery("mysql_get_processlist_by_connection_id", { connectionId: "2153" }).values, ["2153", 2]);
});
test("database, table and connection lock readers bind only their required scope", () => {
  assert.throws(() => buildMysqlQuery("mysql_get_all_lock_waits", { connectionId: "1" }));
  assert.deepEqual(buildMysqlQuery("mysql_get_lock_waits_by_database", { databaseName: "sg" }).values, ["sg", 101]);
  assert.deepEqual(buildMysqlQuery("mysql_get_lock_waits_by_table", { databaseName: "sg", tableName: "items" }).values, ["sg", "items", 101]);
  const byConnection = buildMysqlQuery("mysql_get_lock_waits_by_connection_id", { connectionId: "5" });
  assert.deepEqual(byConnection.values, ["5", "5", 101]);
  assert.match(byConnection.sql, /r.PROCESSLIST_ID = \? OR b.PROCESSLIST_ID = \?/);
  assert.doesNotMatch(byConnection.sql, /LOCK_DATA/);
});
test("a catalog-defined tool needs no name-specific SQL dispatch", () => {
  const original = registry.getTool("mysql_get_lock_waits_by_connection_id")!;
  assert.equal(original.execution.type, "mysql_sql");
  const renamed = { ...original, name: "new_catalog_reader" };
  assert.deepEqual(buildQuery(renamed, { connectionId: "99" }), buildQuery(original, { connectionId: "99" }));
});
test("SQL catalog rejects undeclared bindings, multiple statements and malformed defaults", () => {
  const original = registry.getTool("mysql_get_all_processlist")!;
  assert.equal(original.execution.type, "mysql_sql");
  if (original.execution.type !== "mysql_sql") return;
  const parse = (execution: unknown) => parseToolCatalog({ plugins: [{ name: "mysql", description: "MySQL reads", domainHints: [], tools: [{ ...original, input: original.inputSchema, execution }] }] });
  for (const change of [
    { sql: "SELECT 1; DELETE FROM items" },
    { filters: [{ input: "missing", sql: "x = ?", bindings: ["missing"] }] },
    { filters: [{ input: "schema", sql: "x = ?", bindings: [] }] },
    { defaults: { limit: 1.5 } }
  ]) assert.throws(() => parse({ ...original.execution, ...change }));
});
test("reject unsupported inputs and fractional limits", () => {
  for (const args of [{ limit: 1.2 }, { limit: NaN }, { limit: 201 }, { connectionId: "1" }, { sql: "SELECT 1" }]) {
    assert.throws(() => buildMysqlQuery("mysql_get_all_processlist", args));
  }
  for (const args of [{}, { connectionId: 12 }, { connectionId: "1 OR 1" }, { connectionId: "1", schema: "sg" }])
    assert.throws(() => buildMysqlQuery("mysql_get_processlist_by_connection_id", args));
  assert.throws(() => buildMysqlQuery("mysql_get_processlist_by_database", {}));
  assert.throws(() => buildMysqlQuery("mysql_get_processlist_by_database", { databaseName: "sg", connectionId: "1" }));
  assert.throws(() => buildMysqlQuery("mysql_get_lock_waits_by_database", {}));
  assert.throws(() => buildMysqlQuery("mysql_get_lock_waits_by_table", { databaseName: "sg" }));
  assert.throws(() => buildMysqlQuery("mysql_get_lock_waits_by_connection_id", { connectionId: "?" }));
  assert.throws(() => buildMysqlQuery("mysql_get_all_transactions", { connectionId: "1" }));
  assert.throws(() => buildMysqlQuery("mysql_get_transactions_by_connection_id", {}));
  assert.throws(() => buildMysqlQuery("mysql_get_transaction_by_transaction_id", {}));
  assert.throws(() => buildMysqlQuery("mysql_list_databases", { namePrefix: "sg" }));
});
test("returns raw rows and truncation with cleanup", async () => {
  let closed = false;
  const result = await executeMysqlTool(tool, { limit: 1 }, context, async options => {
    assert.equal(options.multipleStatements, false);
    return { execute: async (sql, values) => {
      assert.match(sql, /MAX_EXECUTION_TIME/); assert.equal(values.at(-1), 2);
      return [{ connectionId: "1", currentStatement: null }, { connectionId: "2" }];
    }, destroy: () => { closed = true; } };
  }, env);
  assert.ok(closed); assert.ok(result.ok && "rawResult" in result && result.rawResult.transport === "mysql");
  if (result.ok && "rawResult" in result && result.rawResult.transport === "mysql") {
    assert.equal(result.rawResult.truncated, true); assert.equal(result.rawResult.returnedRows, 1);
    assert.equal(result.rawResult.rows[0].currentStatement, null);
    assert.deepEqual(result.rawResult.appliedFilters, {});
    assert.equal(result.rawResult.limit, 1);
  }
});
test("errors and secrets do not expose provider data", async () => {
  const denied: MysqlConnect = async () => { throw Object.assign(new Error("secret SQL"), { code: "ER_TABLEACCESS_DENIED_ERROR" }); };
  const r = await executeMysqlTool(tool, {}, context, denied, env);
  assert.ok(!r.ok && r.error.code === "source_permission_denied"); assert.ok(!JSON.stringify(r).includes("secret SQL"));
  for (const [rows, code] of [[[{ value: "fake-password" }], "secret_exposure_risk"], [[{ value: "x".repeat(65537) }], "tool_output_too_large"]] as const) {
    const r = await executeMysqlTool(tool, {}, context, async () => ({ execute: async () => [...rows], destroy() {} }), env);
    assert.ok(!r.ok && r.error.code === code);
  }
});
test("deadline destroys active and late connections; parallel calls remain isolated", async () => {
  let closed = 0;
  const slow = { ...tool, timeoutMs: 10 };
  const r = await executeMysqlTool(slow, {}, context, async () => ({ execute: () => new Promise(() => {}), destroy() { closed++; } }), env);
  assert.ok(!r.ok && r.error.code === "tool_timeout"); assert.ok(closed > 0);
  let lateClosed = false;
  const late = await executeMysqlTool(slow, {}, context, async () => {
    await new Promise(r => setTimeout(r, 30));
    return { execute: async () => { throw Error("must not execute"); }, destroy() { lateClosed = true; } };
  }, env);
  assert.ok(!late.ok && late.error.code === "tool_timeout");
  await new Promise(r => setTimeout(r, 40)); assert.ok(lateClosed);
  let destroyed = 0;
  const results = await Promise.all(Array.from({ length: 12 }, () => executeMysqlTool(tool, {}, context,
    async () => ({ execute: async (_sql, values) => [{ id: values[0] }], destroy() { destroyed++; } }), env)));
  assert.equal(destroyed, 12); assert.ok(results.every(r => r.ok));
});
test("missing config and pre-aborted calls do not connect", async () => {
  const connector: MysqlConnect = async () => { throw Error("unexpected connection"); };
  const missing = await executeMysqlTool(tool, {}, context, connector, {});
  assert.ok(!missing.ok && missing.error.code === "source_unavailable");
  const aborted = await executeMysqlTool(tool, {}, { ...context, signal: AbortSignal.abort() }, connector, env);
  assert.ok(!aborted.ok && aborted.error.code === "tool_timeout");
});
