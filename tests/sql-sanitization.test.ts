import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sanitizeSql, sanitizeSqlRow, OMITTED_SQL } from '../src/tools/security/sanitize-sql.js';
import { loadToolCatalogFromYaml } from '../src/tools/catalog-loader.js';
import { PluginRegistry } from '../src/tools/plugin-registry.js';
import { executeMysqlTool } from '../src/tools/source-adapters/mysql-adapter.js';
import { createAmdcLangChainTools } from '../src/agent/langchain-tool-wrapper.js';

test('common SQL retains structure but removes all literal values and comments',()=>{
 const cases=[
  ["UPDATE users SET password='fixture-secret' WHERE id=987654",['users','password']],
  ["INSERT INTO users (id, password) VALUES (987654, 'fixture-secret')",['users','password']],
  ["INSERT INTO users VALUES(987654,'fixture-secret','another-secret')",['users']],
  ["SELECT * FROM orders WHERE id=987654 AND token='fixture-secret'",['orders','token']],
  ["DELETE FROM sessions WHERE token='fixture-secret'",['sessions','token']],
  ["SELECT * FROM a JOIN b ON a.id=b.id WHERE a.x IN (987654,345678) ORDER BY a.id DESC LIMIT 876543",['a','b','JOIN']],
  ["SELECT COUNT(*) FROM users WHERE token='fixture-secret' /* another-secret */",['COUNT','users']],
  ["SELECT 'fixture-secret' -- another-secret\nFROM users",['users']],
  ["SELECT 'fixture-secret' # another-secret\nFROM users",['users']],
  ["SELECT 'fixture\\\'secret', 'another''secret', \"double-secret\", X'616263', b'010101', 0xABCDEF, -987654",['SELECT']]
 ] as const;
 for(const [sql,expected] of cases){
  const out=sanitizeSql(sql)!;assert.notEqual(out,OMITTED_SQL,sql);
  for(const fragment of expected)assert.ok(out.includes(fragment),out);
  assert.doesNotMatch(out,/secret|987654|345678|876543|616263|010101|ABCDEF|\/\*|--|#/i);
  assert.match(out,/\?/);
 }
});

test('unsupported, incomplete, oversized, ambiguous SQL never falls back to raw text',()=>{
 for(const sql of ["SELECT 'fixture-secret", "SELECT * FROM", "ALTER USER bob IDENTIFIED BY 'fixture-secret'", "SET PASSWORD = 'fixture-secret'", "CALL proc('fixture-secret')", "SELECT 1; SELECT 'fixture-secret'", "SELECT 1e987654", "SELECT @fixture_secret", "SELECT "+'('.repeat(65)+'1'+')'.repeat(65), 'x'.repeat(4096)])assert.equal(sanitizeSql(sql),OMITTED_SQL);
 assert.equal(sanitizeSql('SELECT 1',true),OMITTED_SQL);
 assert.equal(sanitizeSql(null),null);assert.equal(sanitizeSql({value:'secret'}),OMITTED_SQL);
 const row={connectionId:'123',waitSeconds:19,currentStatement:"SELECT 'fixture-secret'",info:null,statementTruncated:1};
 assert.deepEqual(sanitizeSqlRow(row),{...row,currentStatement:OMITTED_SQL});
 assert.equal(row.currentStatement,"SELECT 'fixture-secret'");
});

test('unknown secret cannot reach native LangChain ToolMessage from MySQL or ProxySQL',async()=>{
 const registry=new PluginRegistry(loadToolCatalogFromYaml(fileURLToPath(new URL('../src/tools/catalogs/amdb-tools.yaml',import.meta.url))));
 const context={environment:'dev' as const,referenceTime:new Date()};
 for(const name of ['mysql_get_all_processlist','mysql_get_all_transactions','proxysql_get_all_processlist','proxysql_get_query_digests']){
  const definition=registry.getTool(name)!;
  assert.ok(definition.execution.type==='mysql_sql'||definition.execution.type==='proxysql_sql');
  const prefix=definition.execution.environmentPrefix.dev;
  const sql="UPDATE users SET password='unregistered-fixture-secret' WHERE id=987654 /* private-comment */";
  const [tool]=createAmdcLangChainTools([registry.listAllTools().find(t=>t.name===name)!],{execute:async()=>executeMysqlTool(definition,{},context,async()=>({execute:async()=>[{connectionId:'123',waitSeconds:19,currentStatement:sql,info:sql,digest_text:sql}],destroy(){}}),{[prefix+'HOST']:'fake',[prefix+'USER']:'fake',[prefix+'PASSWORD']:'configured-fixture-password'})},{...context,runId:name,traceSink:{record:async()=>{}}});
  const message=await tool.invoke({name,id:'fixture-call',type:'tool_call',args:{}});
  const output=JSON.stringify(message);
  assert.doesNotMatch(output,/unregistered-fixture-secret|private-comment|987654/);
  assert.match(output,/users/);assert.match(output,/password/);assert.match(output,/connectionId/);assert.match(output,/123/);
 }
});

test('parallel SQL sanitization keeps inputs isolated and output bounded',async()=>{
 const outputs=await Promise.all(Array.from({length:100},async(_,i)=>sanitizeSql(`SELECT * FROM orders WHERE token='secret-${i}' AND id=${10000+i}`)));
 assert.equal(new Set(outputs).size,1);
 assert.ok(outputs.every(out=>out!==OMITTED_SQL && out!.length<8192 && !out!.includes('secret-')));
});
