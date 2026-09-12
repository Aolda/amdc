// Opt-in local Docker integration test. Creates and removes an isolated fixture.
// Run: AMDC_LOCAL_MYSQL_TEST=1 node scripts/mysql-live-check.mjs
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
if (process.env.AMDC_LOCAL_MYSQL_TEST !== '1') throw Error('Set AMDC_LOCAL_MYSQL_TEST=1 for local fixture creation.');
const docker = process.env.AMDC_TEST_DOCKER || 'docker';
const database = 'amdc_tool_check_' + randomBytes(8).toString('hex');
const password = randomBytes(24).toString('hex');
const admin = sql => execFileSync(docker, ['exec', '-i', 'mysql_1', 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot --batch'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 });
try {
  admin(`CREATE DATABASE \`${database}\`; CREATE USER '${database}'@'%' IDENTIFIED BY '${password}'; GRANT ALL ON \`${database}\`.* TO '${database}'@'%'; CREATE TABLE \`${database}\`.items(id INT PRIMARY KEY, value INT); INSERT INTO \`${database}\`.items VALUES(1,0);`);
  const source = `
import assert from 'node:assert/strict';
import {createConnection} from 'mysql2/promise';
import {loadToolCatalogFromYaml} from './dist/tools/catalog-loader.js';
import {PluginRegistry} from './dist/tools/plugin-registry.js';
import {YamlToolRuntime} from './dist/tools/yaml-tool-runtime.js';
const fixture=${JSON.stringify({database,user:database,password})};
const rt=new YamlToolRuntime(new PluginRegistry(loadToolCatalogFromYaml('./dist/tools/catalogs/amdb-tools.yaml')));
const ctx={environment:'dev',referenceTime:new Date()};
const connections=[];
process.on('uncaughtException', e => { console.log(JSON.stringify({event:'check_failed',name:e.name,code:e.code,stackFrames:e.stack?.split('\\n').filter(line=>line.trim().startsWith('at '))})); for(const c of connections)c.destroy();process.exit(1); });
async function read(name,args){const start=Date.now();const r=await rt.execute({toolName:name,args},ctx);if(!r.ok)console.log(JSON.stringify({tool:name,error:r.error.code}));assert.equal(r.ok,true);console.log(JSON.stringify({tool:name,rows:r.rawResult.returnedRows,ms:Date.now()-start}));return r.rawResult;}
const watchdog=setTimeout(()=>{for(const c of connections)c.destroy();process.exitCode=1;},45000);
try {
 for(let i=0;i<2;i++)connections.push(await createConnection({...fixture,host:process.env.AMDC_DEV_MYSQL_HOST,port:Number(process.env.AMDC_DEV_MYSQL_PORT),connectTimeout:5000}));
 const [a,b]=connections;
 await b.query('SET SESSION innodb_lock_wait_timeout=15');
 const [[ai]]=await a.query('SELECT CONNECTION_ID() id');const [[bi]]=await b.query('SELECT CONNECTION_ID() id');
 const aid=String(ai.id),bid=String(bi.id);
 assert.ok((await read('mysql_list_databases',{})).rows.some(r=>r.databaseName===fixture.database));
 await a.beginTransaction();await a.query('UPDATE items SET value=1 WHERE id=1');
 const pending=b.query('UPDATE items SET value=2 WHERE id=1').then(()=>true,()=>false);
 let locks;
 for(let i=0;i<20;i++){locks=await read('mysql_get_lock_waits_by_table',{databaseName:fixture.database,tableName:'items'});if(locks.rows.length)break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(locks.rows.some(r=>r.blockingConnectionId===aid&&r.waitingConnectionId===bid));
 assert.ok((await read('mysql_get_all_lock_waits',{})).rows.some(r=>r.objectDatabase===fixture.database));
 const p=await read('mysql_get_processlist_by_connection_id',{connectionId:aid});assert.equal(p.rows[0].mysqlUser,fixture.user);
 const rejectedAll=await rt.execute({toolName:'mysql_get_all_processlist',args:{connectionId:aid}},ctx);assert.equal(rejectedAll.ok,false);assert.equal(rejectedAll.error.code,'invalid_input');
 assert.equal((await read('mysql_get_transactions_by_connection_id',{connectionId:aid})).rows[0].mysqlUser,fixture.user);
 const limited=await read('mysql_get_processlist_by_database',{databaseName:fixture.database,includeIdle:true,limit:1});assert.equal(limited.returnedRows,1);assert.equal(limited.truncated,true);
 for(const args of [{connectionId:'?'},{connectionId:'1'.repeat(21)},{mysqlUser:'root'}]){const r=await rt.execute({toolName:'mysql_get_processlist_by_connection_id',args},ctx);assert.equal(r.ok,false);assert.equal(r.error.code,'invalid_input');}
 assert.equal((await read('mysql_get_lock_waits_by_table',{databaseName:fixture.database,tableName:'missing'})).returnedRows,0);
 await a.rollback();assert.equal(await pending,true);
 assert.equal((await read('mysql_get_lock_waits_by_database',{databaseName:fixture.database})).returnedRows,0);
 console.log('PASS: schema, locks, connection/account output, idle filtering, truncation, invalid inputs, recovery');
}finally{clearTimeout(watchdog);for(const c of connections)c.destroy();}
`;
  const output = execFileSync(docker, ['exec', '-i', 'amdc-discord-bot', 'node', '--input-type=module'], { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
  console.log(output);
} catch (error) {
  process.exitCode = 1;
  for (const line of String(error.stdout ?? '').split('\n')) {
    if (line.startsWith('{')) { try { console.log(JSON.stringify(JSON.parse(line))); } catch {} }
  }
  console.error('MySQL live check failed; provider payload omitted.');
} finally {
  admin(`DROP DATABASE IF EXISTS \`${database}\`; DROP USER IF EXISTS '${database}'@'%';`);
  console.log('Isolated fixture removed.');
}
