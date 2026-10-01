// Opt-in, local Docker only. Creates isolated MySQL/ProxySQL fixtures and removes them.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'mysql2/promise';
import { loadToolCatalogFromYaml } from '../dist/tools/catalog-loader.js';
import { PluginRegistry } from '../dist/tools/plugin-registry.js';
import { YamlToolRuntime } from '../dist/tools/yaml-tool-runtime.js';
if(process.env.AMDC_LOCAL_MONITORING_TEST!=='1') throw Error('Set AMDC_LOCAL_MONITORING_TEST=1.');
const docker=process.env.AMDC_TEST_DOCKER || 'docker';
const env=name=>Object.fromEntries(JSON.parse(execFileSync(docker,['inspect',name],{encoding:'utf8'}))[0].Config.Env.map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
const backend=env('amdb_backend'),mysql=env('mysql_1');
process.env.AMDC_DEV_PROXYSQL_HOST='127.0.0.1';process.env.AMDC_DEV_PROXYSQL_PORT='6032';
process.env.AMDC_DEV_PROMETHEUS_URL='http://127.0.0.1:9090';
const rt=new YamlToolRuntime(new PluginRegistry(loadToolCatalogFromYaml('dist/tools/catalogs/amdb-tools.yaml')));
const read=async(toolName,args={})=>{const r=await rt.execute({toolName,args},{environment:'dev',referenceTime:new Date()});assert.ok(r.ok,`${toolName}: ${r.ok?'':r.error.code}`);return r.rawResult;};
const aName='amdc_px_'+randomBytes(5).toString('hex'),bName=aName+'_b';
const password=randomBytes(24).toString('hex');
let admin,root;const clients=[];
try {
 admin=await createConnection({host:'127.0.0.1',port:6032,user:backend.PROXYSQL_ADMIN_USER,password:backend.PROXYSQL_ADMIN_PASSWORD});
 root=await createConnection({host:'127.0.0.1',port:33061,user:'root',password:mysql.MYSQL_ROOT_PASSWORD});
 for(const name of [aName,bName]){
  await root.query('CREATE DATABASE `'+name+'`');
  await root.query('CREATE USER ?@\'%\' IDENTIFIED BY ?',[name,password]);
  await root.query('GRANT ALL ON `'+name+'`.* TO ?@\'%\'',[name]);
  await root.query('CREATE TABLE `'+name+'`.items (id INT PRIMARY KEY, value INT) ENGINE=InnoDB');
  await root.query('INSERT INTO `'+name+'`.items VALUES (1,0)');
  await admin.query('INSERT INTO mysql_users(username,password,default_hostgroup,default_schema,active,max_connections) VALUES (?,?,0,?,1,5)',[name,password,name]);
 }
 await admin.query('LOAD MYSQL USERS TO RUNTIME');
 for(const name of [aName,aName,bName]) clients.push(await createConnection({host:'127.0.0.1',port:3306,user:name,password,database:name}));
 const [blocker,waiter,other]=clients;
 await blocker.beginTransaction();await blocker.query('UPDATE items SET value=value+1 WHERE id=1');
 await waiter.query('SET SESSION innodb_lock_wait_timeout=15');
 const pending=waiter.query('UPDATE items SET value=value+1 WHERE id=1').then(()=>true,()=>false);
 await other.query('SELECT id FROM items');
 let sessions;
 for(let i=0;i<20;i++){
  sessions=await read('proxysql_get_processlist_by_database',{databaseName:aName});
  if(sessions.rows.some(r=>String(r.info).includes('UPDATE'))) break;
  await new Promise(r=>setTimeout(r,100));
 }
 assert.ok(sessions.rows.length>=2);assert.ok(sessions.rows.every(r=>r.db===aName));
 assert.ok(sessions.rows.some(r=>String(r.info).includes('UPDATE')));
 const byUser=await read('proxysql_get_processlist_by_user',{username:aName});assert.ok(byUser.rows.length>=2);assert.ok(byUser.rows.every(r=>r.user===aName));
 const id=String(sessions.rows[0].SessionID);
 const one=await read('proxysql_get_processlist_by_session_id',{sessionId:id});assert.equal(one.returnedRows,1);assert.equal(String(one.rows[0].SessionID),id);
 const pool=await read('proxysql_get_connection_pool');assert.ok(pool.rows.some(r=>Number(r.ConnUsed)>=2));
 const injected=await read('proxysql_get_processlist_by_database',{databaseName:"x' OR 1=1 --"});assert.equal(injected.returnedRows,0);
 const users=await read('proxysql_get_users');assert.ok(users.rows.some(r=>r.username===aName && Number(r.frontend_connections)===2));
 console.log('PASS: active wait, frontend session IDs, database/user isolation, pool usage, literal input');
 await blocker.rollback();assert.equal(await pending,true);
 await waiter.query('SELECT * FROM no_such_amdc_table').catch(()=>{});
 const digests=await read('proxysql_get_query_digests_by_database',{databaseName:aName});assert.ok(digests.rows.length>0);assert.ok(digests.rows.every(r=>r.schemaname===aName));
 const userDigests=await read('proxysql_get_query_digests_by_user',{username:bName});assert.ok(userDigests.rows.length>0);assert.ok(userDigests.rows.every(r=>r.username===bName));
 const errors=await read('proxysql_get_errors');assert.ok(errors.rows.some(r=>r.username===aName && Number(r.errno)===1146));
 console.log('PASS: completed query digests, per-user isolation, missing-table error counters');
 for(const c of clients) await c.end();clients.length=0;
 const gone=await read('proxysql_get_processlist_by_database',{databaseName:aName});assert.equal(gone.returnedRows,0);
 console.log('PASS: session recovery');
 // Wait for the existing custom-exporter scrape, then check exact DB labels.
 let metric;
 for(let i=0;i<25;i++){
  const raw=await read('prometheus_get_metric_value',{metricName:'amdb_db_table_count'});
  metric=JSON.parse(raw.response.body).data.result.filter(r=>r.metric.database===aName);
  if(metric.length)break;
  await new Promise(r=>setTimeout(r,2000));
 }
 assert.ok(metric.length>0,'custom exporter did not publish fixture metric');
 assert.ok(metric.every(r=>r.metric.database===aName && Number(r.value[1])===1));
 const rawOther=await read('prometheus_get_metric_value_by_database',{metricName:'amdb_db_table_count',databaseName:bName});
 const metricOther=JSON.parse(rawOther.response.body).data.result;
 assert.ok(metricOther.length>0);assert.ok(metricOther.every(r=>r.metric.database===bName));
 console.log('PASS: live custom-exporter metrics isolated by database label');
}catch(e){console.error('Local fault check failed:',e instanceof assert.AssertionError?e.message:(e.code ?? e.name));process.exitCode=1;}
finally{
 for(const c of clients)c.destroy();
 if(admin){for(const name of [aName,bName])await admin.query('DELETE FROM mysql_users WHERE username=?',[name]);await admin.query('LOAD MYSQL USERS TO RUNTIME');admin.destroy();}
 if(root){for(const name of [aName,bName]){await root.query('DROP DATABASE IF EXISTS `'+name+'`');await root.query('DROP USER IF EXISTS ?@\'%\'',[name]);}root.destroy();}
 console.log('Temporary databases and users removed; historical diagnostic counters retained.');
}
