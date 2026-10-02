import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAmdcLangChainTools } from '../src/agent/langchain-tool-wrapper.js';
import { DiagnosisLedger } from '../src/report/diagnosis-handoff.js';
import { TemporaryDiagnosticPresenter } from '../src/report/temporary-diagnostic-presenter.js';
import { executeMysqlTool } from '../src/tools/source-adapters/mysql-adapter.js';
import { executeLocalShellTool } from '../src/tools/source-adapters/local-shell-adapter.js';
import { loadToolCatalogFromYaml } from '../src/tools/catalog-loader.js';
import { PluginRegistry } from '../src/tools/plugin-registry.js';
import type { AgentVisibleToolDescriptor, ToolRuntime, ToolRuntimeResult } from '../src/tools/types.js';
const registry = new PluginRegistry(loadToolCatalogFromYaml(fileURLToPath(new URL('../src/tools/catalogs/amdb-tools.yaml', import.meta.url))));
const context = { environment: 'dev' as const, referenceTime: new Date('2026-09-25T00:00:00.000Z'), runId: 'fixture', traceSink: { record: async () => {} } };
const descriptor: AgentVisibleToolDescriptor = { name: 'read', pluginName: 'mysql', description: 'fixture', readOnly: true,
  inputSchema: { type: 'object', additionalProperties: false, properties: { id: {type:'integer'} }, required:['id'] } };
const raw: ToolRuntimeResult = { ok: true, rawResult: { toolName:'read', pluginName:'mysql', source:'mysql', collectedAt:context.referenceTime.toISOString(), transport:'mysql', rows:[], appliedFilters:{}, limit:1, returnedRows:0, truncated:false } };

test('raw successes survive assembly and the handoff never adds a health verdict', () => {
  const ledger = new DiagnosisLedger('diag-raw');
  const call = ledger.begin(descriptor, {id:1});
  ledger.finish(call, raw);
  const diagnosis = ledger.assemble('fixture', {completion_reason:'investigation_complete', comments:[{
    tool_call_id:call.tool_call_id,
    comment:{observation:null,hypothesis:'Suspected failure',limitation:'No impact has been confirmed.'},
    related_call_ids:[]
  }]});
  const presenter = new TemporaryDiagnosticPresenter();
  const presentation = presenter.createPresentation(diagnosis);
  assert.ok(raw.ok && 'rawResult' in raw);
  assert.deepEqual(presentation.observations[0].result,raw.rawResult);
  assert.equal(presentation.observations[0].comment?.hypothesis,'Suspected failure');
  assert.deepEqual(presentation,diagnosis);
  assert.notEqual(presentation,diagnosis);
  assert.equal('status' in presentation,false);

  const empty = presenter.createPresentation(new DiagnosisLedger('diag-empty').assemble('fixture',{
    completion_reason:'investigation_complete',comments:[]
  }));
  assert.equal(empty.completion_reason,'insufficient_evidence');
  assert.equal('status' in empty,false);
  for (const status of ['normal','critical'] as const) {
    const observed = new DiagnosisLedger(`diag-${status}`);
    observed.finish(observed.begin(descriptor,{id:1}),{ok:true,observation:{
      toolName:'read',pluginName:'mysql',source:'mysql',status,summary:'fixture',facts:[],collectedAt:context.referenceTime.toISOString()
    }});
    const result=presenter.createPresentation(observed.assemble('fixture',{completion_reason:'investigation_complete',comments:[]}));
    const source=result.observations[0].result;
    assert.ok(source && 'status' in source);
    assert.equal(source.status,status);
    assert.equal('status' in result,false);
  }
});
test('changing IDs cannot bypass each tool limit; other tools and new diagnoses have independent budgets', async () => {
  let active=0, peak=0, calls=0;
  const runtime: ToolRuntime = { execute:async () => { calls++; peak=Math.max(peak,++active); await new Promise(resolve=>setTimeout(resolve,2)); active--; return raw; } };
  const ledger=new DiagnosisLedger(context.runId);
  const disabledTools=new Set<string>();
  const tools=createAmdcLangChainTools([descriptor,{...descriptor,name:'other'}],runtime,{...context,ledger,disabledTools});
  const results=await Promise.allSettled(Array.from({length:20},(_,id)=>tools[id%2].invoke({id})));
  assert.equal(calls,16); assert.equal(peak,1); assert.equal(results.filter(r=>r.status==='rejected').length,0);
  assert.equal(results.filter(r=>r.status==='fulfilled' && String(r.value).includes('tool_call_limit_reached')).length,4);

  assert.deepEqual([...disabledTools].sort(),['other','read']);
  const handoff=ledger.assemble('fixture',{completion_reason:'insufficient_evidence',comments:[]});
  assert.equal(handoff.observations.length,20);
  assert.deepEqual(handoff.observations.map(call=>call.seq),Array.from({length:20},(_,index)=>index+1));
  assert.deepEqual(handoff.observations.map(call=>call.input.id),Array.from({length:20},(_,id)=>id));
  assert.deepEqual(handoff.observations.map(call=>call.tool_call_id),results.map(result=>{
    assert.equal(result.status,'fulfilled');
    return JSON.parse(String(result.value)).tool_call_id;
  }));
  assert.equal(handoff.observations.filter(call=>call.error?.code==='tool_call_limit_reached').length,4);
  await createAmdcLangChainTools([descriptor],runtime,{...context,runId:'second'})[0].invoke({id:0});
  assert.equal(calls,17);
});

test('schema rejection, duplicate rejection and runtime errors consume budget without deadlocking',async()=>{
  let calls=0;
  const [tool]=createAmdcLangChainTools([descriptor],{execute:async()=>{calls++;throw Error('private-source-error');}},context);
  await assert.rejects(tool.invoke({id:'invalid'}));
  assert.doesNotMatch(String(await tool.invoke({id:1})),/private-source-error/);
  assert.match(String(await tool.invoke({id:1})),/Identical tool input/);
  for(let id=2;id<=6;id++) await tool.invoke({id});
  assert.match(String(await tool.invoke({id:7})),/tool_call_limit_reached/);
  assert.equal(calls,6);
});

test('MySQL and ProxySQL preserve SQL structure without literal values',async()=>{
  for(const name of ['mysql_get_all_processlist','mysql_get_all_transactions','proxysql_get_all_processlist','proxysql_get_query_digests']) {
    const definition = registry.getTool(name)!;
    assert.ok(definition);
    assert.ok(definition.execution.type==='mysql_sql'||definition.execution.type==='proxysql_sql');
    const prefix=definition.execution.environmentPrefix.dev;
    const statement='SELECT id FROM fixture_table WHERE id = 1';
    const result=await executeMysqlTool(definition,{},context,async()=>({ execute:async()=>[{connectionId:'1',currentStatement:statement,info:statement,digest_text:statement}],destroy(){} }),{[prefix+'HOST']:'fake',[prefix+'USER']:'fake',[prefix+'PASSWORD']:'fixture-password'});
    assert.ok(result.ok);
    const visible = registry.listAllTools().find(d=>d.name===definition.name)!;
    const [wrapped]=createAmdcLangChainTools([visible],{execute:async()=>result},context);
    const output=String(await wrapped.invoke({}));
    assert.ok(!output.includes(statement));
    assert.match(output,/SELECT/);
    assert.match(output,/\?/);
    assert.doesNotMatch(output,/= 1/);
    assert.match(output,/connectionId/);
  }
});

test('health configuration rejects unsafe schemes, credentials, queries and glob targets before execution',async()=>{
  const tool=registry.getTool('backend_get_health')!;
  const previous=process.env.AMDC_DEV_HEALTHCHECK_URL;
  try {
    for(const value of ['file:///etc/passwd','ftp://example.invalid/health','--output /tmp/file','https://user:pass@example.invalid/health','https://example.invalid/?token=fixture','https://example.invalid/#fragment','http://{one,two}/health','http://example.invalid/\nfile']) {
      process.env.AMDC_DEV_HEALTHCHECK_URL=value;
      const result=await executeLocalShellTool(tool,context,context.referenceTime.toISOString(),async()=>{assert.fail('must not execute');});
      assert.equal(result.ok,false);
    }
    process.env.AMDC_DEV_HEALTHCHECK_URL='https://example.invalid/health';
    let called=false;
    await executeLocalShellTool(tool,context,context.referenceTime.toISOString(),async command=>{
      called=true; assert.match(command,/curl --disable --globoff --proto =http,https/);assert.match(command,/--max-redirs 0/);assert.doesNotMatch(command,/--location/);
      return {ok:true,stdout:'fixture',stderr:'',exitCode:0};
    });
    assert.ok(called);
  } finally { if(previous===undefined)delete process.env.AMDC_DEV_HEALTHCHECK_URL;else process.env.AMDC_DEV_HEALTHCHECK_URL=previous; }
});

import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { LangChainDiagnosticAgent } from '../src/agent/langchain-diagnostic-agent.js';

test('LangChain hides exhausted tools, preserves limit responses and continues with another tool',async t=>{
  const fixtureRegistry=new PluginRegistry({plugins:[{name:'mysql',description:'fixture',domainHints:['mysql'],tools:[{
    ...descriptor,access:{level:0,readOnly:true},source:'mysql',allowedEnvironments:['dev'],timeoutMs:1000,execution:{type:'source_adapter',operation:'fixture'}
  },{...descriptor,name:'other',access:{level:0,readOnly:true},source:'mysql',allowedEnvironments:['dev'],timeoutMs:1000,execution:{type:'source_adapter',operation:'fixture'}}]}]});
  let modelCalls=0,active=0,peak=0,executions=0;
  t.mock.method(ChatOpenAI.prototype,'_generate',async(messages:BaseMessage[],options:{tools?:{function:{name:string}}[]})=>{
    modelCalls++;
    const names=options.tools?.map(t=>t.function.name)??[];
    let calls;
    if(modelCalls===1) calls=[{id:'select',name:'select_plugin',args:{pluginName:'mysql'},type:'tool_call' as const}];
    else if(modelCalls===2) calls=Array.from({length:9},(_,id)=>({id:`read-${id}`,name:'read',args:{id},type:'tool_call' as const}));
    else if(modelCalls===3) {
      assert.ok(!names.includes('read')); assert.ok(names.includes('other'));
      const results=messages.filter(m=>m.name==='read');
      assert.equal(results.length,9);
      assert.ok(results.some(m=>String(m.content).includes('tool_call_limit_reached')));
      calls=[{id:'stale-read',name:'read',args:{id:99},type:'tool_call' as const}];
    } else if(modelCalls===4) {
      assert.match(String(messages.filter(m=>m.name==='read').at(-1)!.content),/tool_call_limit_reached/);
      calls=[{id:'select-again',name:'select_plugin',args:{pluginName:'mysql'},type:'tool_call' as const}];
    } else if(modelCalls===5) {
      assert.ok(!names.includes('read')); assert.ok(names.includes('other'));
      const payload=JSON.parse(String(messages.filter(m=>m.name==='select_plugin').at(-1)!.content));
      assert.deepEqual(payload.loadedTools.map((t:{name:string})=>t.name),['other']);
      calls=[{id:'other-call',name:'other',args:{id:1},type:'tool_call' as const}];
    } else {
      assert.equal(modelCalls,6);
      const payloads=messages.filter(message=>message.name==='read'||message.name==='other').map(message=>JSON.parse(String(message.content)));
      assert.equal(payloads.length,11);
      assert.equal(new Set(payloads.map(payload=>payload.tool_call_id)).size,11);
      const limited=payloads.filter(payload=>payload.error?.code==='tool_call_limit_reached');
      assert.equal(limited.length,2);
      calls=[{id:'final',name:names.find(n=>n.startsWith('extract-'))!,args:{
        completion_reason:'insufficient_evidence',comments:limited.map(payload=>({
          tool_call_id:payload.tool_call_id,
          comment:{observation:null,hypothesis:null,limitation:'The tool call budget was exhausted.'},
          related_call_ids:[payloads[0].tool_call_id]
        }))
      },type:'tool_call' as const}];
    }
    return {generations:[{text:'',message:new AIMessage({content:'',tool_calls:calls})}]};
  });
  const agent=new LangChainDiagnosticAgent(fixtureRegistry,{execute:async()=>{
    executions++;peak=Math.max(peak,++active);await new Promise(resolve=>setTimeout(resolve,2));active--;return raw;
  }},{model:'fixture',apiKey:'fixture'});
  const result=await agent.diagnose({symptom:'fixture',environment:'dev',requestedBy:'fixture',receivedAt:context.referenceTime.toISOString()});
  assert.equal(executions,9);assert.equal(peak,1);
  assert.equal(result.observations.filter(call=>call.status==='success').length,9);
  assert.equal(result.observations.length,11);
  assert.deepEqual(result.observations.map(call=>call.seq),Array.from({length:11},(_,index)=>index+1));
  assert.deepEqual(result.observations.map(call=>call.input.id),[0,1,2,3,4,5,6,7,8,99,1]);
  const limited=result.observations.filter(call=>call.error?.code==='tool_call_limit_reached');
  assert.equal(limited.length,2);
  assert.ok(limited.every(call=>call.comment?.limitation==='The tool call budget was exhausted.'));
  assert.ok(limited.every(call=>call.related_call_ids[0]===result.observations[0].tool_call_id));
  const presentation=new TemporaryDiagnosticPresenter().createPresentation(result);
  assert.equal(presentation.completion_reason,'insufficient_evidence');
  assert.equal('status' in presentation,false);
});
