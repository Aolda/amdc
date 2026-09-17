// Stops only the local mysql-exporter container and always restarts it.
import 'dotenv/config';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {loadToolCatalogFromYaml} from '../dist/tools/catalog-loader.js';
import {PluginRegistry} from '../dist/tools/plugin-registry.js';
import {YamlToolRuntime} from '../dist/tools/yaml-tool-runtime.js';
if(process.env.AMDC_LOCAL_MONITORING_TEST!=='1')throw Error('Set AMDC_LOCAL_MONITORING_TEST=1.');
const docker=process.env.AMDC_TEST_DOCKER || 'docker';
const initial=JSON.parse(execFileSync(docker,['inspect','mysql-exporter'],{encoding:'utf8'}))[0];
assert.equal(initial.State.Running,true,'mysql-exporter must initially be running');
process.env.AMDC_DEV_PROMETHEUS_URL='http://127.0.0.1:9090';
const rt=new YamlToolRuntime(new PluginRegistry(loadToolCatalogFromYaml('dist/tools/catalogs/amdb-tools.yaml')));
const read=async(toolName,args={})=>{const r=await rt.execute({toolName,args},{environment:'dev',referenceTime:new Date()});assert.ok(r.ok,r.ok?'':r.error.code);return JSON.parse(r.rawResult.response.body).data;};
async function waitValue(expected){
 for(let i=0;i<30;i++){
  const r=await read('prometheus_get_metric_value_by_instance',{metricName:'up',instance:'mysql-exporter:9104'});
  if(r.result.some(s=>Number(s.value[1])===expected))return;
  await new Promise(r=>setTimeout(r,2000));
 }
 assert.fail('scrape state did not become '+expected);
}
await waitValue(1);
const start=new Date().toISOString();
try {
 execFileSync(docker,['stop','-t','2','mysql-exporter'],{stdio:'pipe'});
 await waitValue(0);
 const targets=await read('prometheus_get_targets');
 assert.ok(targets.activeTargets.some(t=>t.labels.job==='mysql' && t.health==='down' && t.lastError));
 console.log('PASS: exporter unavailable -> up=0 and target scrape error');
}finally{execFileSync(docker,['start','mysql-exporter'],{stdio:'pipe'});}
await waitValue(1);
const range=await read('prometheus_get_metric_range_by_instance',{metricName:'up',instance:'mysql-exporter:9104',start,end:new Date().toISOString(),stepSeconds:15});
assert.ok(range.result.some(s=>s.values.some(v=>Number(v[1])===0)));
console.log('PASS: exporter recovery -> up=1; historical range retains outage');
