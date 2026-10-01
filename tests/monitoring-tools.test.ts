import assert from "node:assert/strict";
import { test } from "node:test";
import { loadToolCatalogFromYaml, parseToolCatalog } from "../src/tools/catalog-loader.js";
import { PluginRegistry } from "../src/tools/plugin-registry.js";
import { YamlToolRuntime } from "../src/tools/yaml-tool-runtime.js";
import { buildPrometheusParameters, executePrometheusHttpTool } from "../src/tools/source-adapters/prometheus-http-adapter.js";
import { bindProxySql, buildMysqlQuery, executeMysqlTool } from "../src/tools/source-adapters/mysql-adapter.js";
import { jsonObjectSchemaToZod } from "../src/agent/langchain-schemas.js";

const catalog = loadToolCatalogFromYaml("src/tools/catalogs/amdb-tools.yaml");
const registry = new PluginRegistry(catalog);
const runtime = new YamlToolRuntime(registry);
const ctx = { environment: "dev" as const, referenceTime: new Date("2026-09-17T12:00:00Z") };
const get = (name: string) => { const tool = registry.getTool(name); assert.ok(tool); return tool; };

test("Prometheus labels are literals; metric identifiers cannot inject PromQL", () => {
  const tool = get("prometheus_get_metric_value_by_database");
  const execution = tool.execution;
  assert.equal(execution.type, "prometheus_http");
  if(execution.type !== "prometheus_http") return;
  const value = 'a"} or up{job="x\\y';
  const query = buildPrometheusParameters(execution, {metricName:"amdb_db_size_bytes", databaseName:value}, ctx.referenceTime);
  assert.equal(query.query, `{__name__="amdb_db_size_bytes",database=${JSON.stringify(value)}}`);
  assert.throws(() => buildPrometheusParameters(execution, {metricName:"up or vector(1)"}, ctx.referenceTime));
});

test("range windows, step and missing times are bounded before transport", async () => {
  const tool = get("prometheus_get_metric_range");
  const execution = tool.execution;
  if(execution.type !== "prometheus_http") return assert.fail();
  const args = {metricName:"up",start:"2026-09-17T11:00:00Z",end:"2026-09-17T12:00:00Z",stepSeconds:60};
  assert.equal(buildPrometheusParameters(execution,args,ctx.referenceTime).step,"60");
  for(const invalid of [{...args,start:args.end,end:args.start},{...args,start:"2026-09-15T12:00:00Z"},{...args,stepSeconds:0},{...args,start:"2026-09-16T12:00:00Z",stepSeconds:15}]) {
    assert.throws(()=>buildPrometheusParameters(execution,invalid,ctx.referenceTime));
  }
  for(const name of ["prometheus_get_metric_value","prometheus_get_metric_series","proxysql_get_processlist_by_database","proxysql_get_processlist_by_session_id"]) {
    assert.equal(jsonObjectSchemaToZod(get(name).inputSchema).safeParse({}).success,false);
    const r = await runtime.execute({toolName:name,args:{}},ctx);
    assert.ok(!r.ok && r.error.code === "invalid_input");
  }
});

test("ProxySQL values use SQLite literals and cannot become extra statements", () => {
  const tool = get("proxysql_get_query_digests_by_database");
  const malicious = "x'; DELETE FROM mysql_users; --\\";
  const q = buildMysqlQuery(tool,{databaseName:malicious});
  assert.equal(q.values[0],malicious);
  assert.ok(!q.sql.includes(malicious));
  assert.ok(bindProxySql(q.sql,q.values).includes("'x''; DELETE FROM mysql_users; --\\'"));
  assert.throws(()=>bindProxySql("SELECT ?",["\0"]));
  assert.throws(()=>bindProxySql("SELECT ?",[]));
});

test("ProxySQL rejects reset tables and wildcard projections at catalog load", () => {
  const original = get("proxysql_get_users");
  const make = (sql:string) => ({plugins:[{name:"proxysql",description:"stats",domainHints:[],tools:[{...original,input:original.inputSchema,execution:{...original.execution,sql}}]}]});
  assert.throws(()=>parseToolCatalog(make("SELECT username FROM stats_mysql_query_digest_reset")));
  assert.throws(()=>parseToolCatalog(make("SELECT * FROM stats_mysql_users")));
});

test("ProxySQL shares bounded result and connection cleanup without MySQL hints", async () => {
  let closed=0;
  const tool=get("proxysql_get_users");
  const result = await executeMysqlTool(tool,{limit:1},ctx,async options=>{
    assert.equal(options.port,6032);
    assert.equal(options.multipleStatements,false);
    return {execute:async(sql)=>{assert.doesNotMatch(sql,/MAX_EXECUTION_TIME/);return [{username:"a"},{username:"b"}];},destroy:()=>{closed++;}};
  },{AMDC_DEV_PROXYSQL_HOST:"localhost",AMDC_DEV_PROXYSQL_PORT:"6032",AMDC_DEV_PROXYSQL_USER:"reader",AMDC_DEV_PROXYSQL_PASSWORD:"fixture-password"});
  assert.ok(result.ok && "rawResult" in result && result.rawResult.source === "proxysql");
  if(result.ok && "rawResult" in result && result.rawResult.transport === "mysql") assert.equal(result.rawResult.truncated,true);
  assert.equal(closed,1);
});

test("Prometheus pre-aborted call never fetches; malformed success is rejected", async () => {
  const before=process.env.AMDC_DEV_PROMETHEUS_URL;
  process.env.AMDC_DEV_PROMETHEUS_URL="http://localhost:9090";
  try {
    const tool=get("prometheus_get_targets");
    const aborted=await executePrometheusHttpTool(tool,{...ctx,signal:AbortSignal.abort()},ctx.referenceTime.toISOString(),async()=>{assert.fail("must not fetch");});
    assert.ok(!aborted.ok && aborted.error.code === "tool_timeout");
    const malformed=await executePrometheusHttpTool(tool,ctx,ctx.referenceTime.toISOString(),async()=>new Response('{"status":"error","error":"private"}'));
    assert.ok(!malformed.ok && malformed.error.code === "malformed_source_response");
    assert.doesNotMatch(JSON.stringify(malformed),/private/);
  } finally {if(before===undefined) delete process.env.AMDC_DEV_PROMETHEUS_URL; else process.env.AMDC_DEV_PROMETHEUS_URL=before;}
});
