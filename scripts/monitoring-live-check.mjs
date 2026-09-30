// Opt-in read-only smoke; localhost endpoints only. Run after npm run build.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { loadToolCatalogFromYaml } from '../dist/tools/catalog-loader.js';
import { PluginRegistry } from '../dist/tools/plugin-registry.js';
import { YamlToolRuntime } from '../dist/tools/yaml-tool-runtime.js';
if (process.env.AMDC_LOCAL_MONITORING_TEST !== '1') throw Error('Set AMDC_LOCAL_MONITORING_TEST=1.');
process.env.AMDC_DEV_PROMETHEUS_URL='http://127.0.0.1:9090';
process.env.AMDC_DEV_PROXYSQL_HOST='127.0.0.1';
process.env.AMDC_DEV_PROXYSQL_PORT='6032';
const registry=new PluginRegistry(loadToolCatalogFromYaml('dist/tools/catalogs/amdb-tools.yaml'));
const runtime=new YamlToolRuntime(registry);
const ctx={environment:'dev',referenceTime:new Date()};
const elapsed=[];
async function read(toolName,args={}){
 const start=performance.now();const r=await runtime.execute({toolName,args},ctx);
 assert.ok(r.ok, `${toolName}: ${r.ok?'':r.error.code}`);
 const result=r.rawResult; const ms=performance.now()-start;elapsed.push(ms);
 console.log(JSON.stringify({tool:toolName,ok:true,ms:Math.round(ms),rows:result.returnedRows}));
 return result.transport==='http'?JSON.parse(result.response.body).data:result;
}
const names=await read('prometheus_list_metric_names');assert.ok(names.includes('up'));
await read('prometheus_get_targets');await read('prometheus_get_metric_metadata',{metricName:'up'});
const start=new Date(Date.now()-300000).toISOString(),end=new Date().toISOString();
await read('prometheus_get_metric_series',{metricName:'up',start,end});
const instant=await read('prometheus_get_metric_value',{metricName:'up'});
assert.ok(instant.result.length>0);
await read('prometheus_get_metric_range',{metricName:'up',start,end,stepSeconds:60});
const instance=instant.result[0].metric.instance;
for(const kind of ['series','value','range']) {
 const args={metricName:'up',instance,...(kind==='value'?{}:{start,end}),...(kind==='range'?{stepSeconds:60}:{})};
 await read('prometheus_get_metric_'+kind+'_by_instance',args);
}
const databaseSeries=await read('prometheus_get_metric_series',{metricName:'amdb_db_table_count',start,end});
const databaseName=databaseSeries.find(s=>s.database)?.database;
assert.ok(databaseName,'No local database-labeled fixture available');
for(const kind of ['series','value','range']) {
 const args={metricName:'amdb_db_table_count',databaseName,...(kind==='value'?{}:{start,end}),...(kind==='range'?{stepSeconds:60}:{})};
 const data=await read('prometheus_get_metric_'+kind+'_by_database',args);
 const rows=kind==='series'?data:data.result.map(r=>r.metric);
 assert.ok(rows.length>0 && rows.every(r=>r.database===databaseName));
}
const absent=await runtime.execute({toolName:'prometheus_get_metric_range_by_instance',args:{metricName:'up',instance:'__amdc_absent__',start,end}},ctx);
assert.ok(!absent.ok && absent.error.code==='invalid_input');
const pool=await read('proxysql_get_connection_pool');assert.ok(pool.returnedRows>0);
await read('proxysql_get_connection_pool_by_hostgroup',{hostgroup:Number(pool.rows[0].hostgroup)});
const users=await read('proxysql_get_users');
await read('proxysql_get_all_processlist');
for(const suffix of ['database','user','session_id']){
 const args=suffix==='database'?{databaseName:'__amdc_absent__'}:suffix==='user'?{username:'__amdc_absent__'}:{sessionId:'999999999'};
 const r=await read('proxysql_get_processlist_by_'+suffix,args);assert.equal(r.returnedRows,0);
}
await read('proxysql_get_query_digests');
await read('proxysql_get_query_digests_by_database',{databaseName:'__amdc_absent__'});
await read('proxysql_get_query_digests_by_user',{username:users.rows[0]?.username ?? '__amdc_absent__'});
await read('proxysql_get_errors');await read('proxysql_get_command_counters');await read('proxysql_get_global_status');
for(const toolName of ['proxysql_get_processlist_by_session_id','prometheus_get_metric_value']){
 const r=await runtime.execute({toolName,args:{}},ctx);assert.ok(!r.ok && r.error.code==='invalid_input');
}
const concurrent=await Promise.all(Array.from({length:12},()=>runtime.execute({toolName:'proxysql_get_users',args:{}},ctx)));
assert.ok(concurrent.every(r=>r.ok));
elapsed.sort((a,b)=>a-b);
console.log(JSON.stringify({result:'PASS',tools:elapsed.length,parallelCalls:12,p50ms:Math.round(elapsed[Math.floor(elapsed.length*.5)]),p95ms:Math.round(elapsed[Math.floor(elapsed.length*.95)]),rssMiB:Math.round(process.memoryUsage().rss/1048576)}));
