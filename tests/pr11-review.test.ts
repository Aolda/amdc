import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAmdcLangChainTools } from '../src/agent/langchain-tool-wrapper.js';
import { extractToolArtifacts } from '../src/agent/langchain-diagnostic-agent.js';
import { TemporaryDiagnosticPresenter } from '../src/report/temporary-diagnostic-presenter.js';
import { executeMysqlTool } from '../src/tools/source-adapters/mysql-adapter.js';
import { executeLocalShellTool } from '../src/tools/source-adapters/local-shell-adapter.js';
import { loadToolCatalogFromYaml } from '../src/tools/catalog-loader.js';
import { PluginRegistry } from '../src/tools/plugin-registry.js';
import type { AgentDiagnosisResult } from '../src/agent/types.js';
import type { AgentVisibleToolDescriptor, ToolRuntime, ToolRuntimeResult } from '../src/tools/types.js';
const registry = new PluginRegistry(loadToolCatalogFromYaml(fileURLToPath(new URL('../src/tools/catalogs/amdb-tools.yaml', import.meta.url))));
const context = { environment: 'dev' as const, referenceTime: new Date('2026-09-25T00:00:00.000Z'), runId: 'fixture', traceSink: { record: async () => {} } };
const descriptor: AgentVisibleToolDescriptor = { name: 'read', pluginName: 'mysql', description: 'fixture', readOnly: true,
  inputSchema: { type: 'object', additionalProperties: false, properties: { id: {type:'integer'} }, required:['id'] } };
const raw: ToolRuntimeResult = { ok: true, rawResult: { toolName:'read', pluginName:'mysql', source:'mysql', collectedAt:context.referenceTime.toISOString(), transport:'mysql', rows:[], appliedFilters:{}, limit:1, returnedRows:0, truncated:false } };

test('raw successes survive assembly and cannot produce a healthy verdict', () => {
  const artifacts = extractToolArtifacts([{ name:'read', content:JSON.stringify(raw) }]);
  assert.equal(artifacts.rawResults.length, 1);
  const diagnosis: AgentDiagnosisResult = { symptom:'fixture', environment:'dev', inferredDomains:[], selectedTools:[],
    observations:artifacts.observations, rawResults:artifacts.rawResults, toolErrors:[], preliminaryFindings:[{finding:'Suspected failure',basis:[],level:'critical'}], suspectedCauses:[], recommendedChecks:[], incompleteReasons:[] };
  const presenter = new TemporaryDiagnosticPresenter();
  assert.equal(presenter.createPresentation(diagnosis).status,'insufficient_tools');
  assert.equal(presenter.createPresentation({...diagnosis, rawResults:[], preliminaryFindings:[]}).status,'insufficient_tools');
  const normal = {toolName:'read',pluginName:'mysql' as const,source:'mysql' as const,status:'normal' as const,summary:'fixture',facts:[],collectedAt:context.referenceTime.toISOString()};
  assert.equal(presenter.createPresentation({...diagnosis, observations:[normal], preliminaryFindings:[]}).status,'insufficient_tools');
  assert.equal(presenter.createPresentation({...diagnosis, observations:[normal], rawResults:[], preliminaryFindings:[]}).status,'no_problem_detected');
  assert.equal(presenter.createPresentation({...diagnosis, observations:[{...normal,status:'critical'}]}).status,'problem_detected');
});

test('changing IDs cannot bypass each tool limit; other tools and new diagnoses have independent budgets', async () => {
  let active=0, peak=0, calls=0;
  const runtime: ToolRuntime = { execute:async () => { calls++; peak=Math.max(peak,++active); await new Promise(resolve=>setTimeout(resolve,2)); active--; return raw; } };
  const tools=createAmdcLangChainTools([descriptor,{...descriptor,name:'other'}],runtime,context);
  const results=await Promise.allSettled(Array.from({length:20},(_,id)=>tools[id%2].invoke({id})));
  assert.equal(calls,16); assert.equal(peak,1); assert.equal(results.filter(r=>r.status==='rejected').length,4);
  for (const result of results) if(result.status==='rejected') assert.match(String(result.reason),/per_tool_call_budget_exhausted/);
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
  await assert.rejects(tool.invoke({id:7}),/per_tool_call_budget_exhausted/);
  assert.equal(calls,6);
});

test('MySQL and ProxySQL SQL text is omitted before wrapper/model output',async()=>{
  for(const name of ['mysql_get_all_processlist','mysql_get_all_transactions','proxysql_get_all_processlist','proxysql_get_query_digests']) {
    const definition = registry.getTool(name)!;
    assert.ok(definition);
    assert.ok(definition.execution.type==='mysql_sql'||definition.execution.type==='proxysql_sql');
    const prefix=definition.execution.environmentPrefix.dev;
    const secret='unregistered-fixture-value';
    const result=await executeMysqlTool(definition,{},context,async()=>({ execute:async()=>[{connectionId:'1',currentStatement:secret,info:secret,digest_text:secret}],destroy(){} }),{[prefix+'HOST']:'fake',[prefix+'USER']:'fake',[prefix+'PASSWORD']:'fixture-password'});
    assert.ok(result.ok);
    const visible = registry.listAllTools().find(d=>d.name===definition.name)!;
    const [wrapped]=createAmdcLangChainTools([visible],{execute:async()=>result},context);
    const output=String(await wrapped.invoke({}));
    assert.doesNotMatch(output,/unregistered-fixture-value/);
    assert.match(output,/SQL text omitted/); assert.match(output,/connectionId/);
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

test('actual LangChain loop preserves raw results and serializes a parallel model tool batch',async t=>{
  const fixtureRegistry=new PluginRegistry({plugins:[{name:'mysql',description:'fixture',domainHints:['mysql'],tools:[{
    ...descriptor,access:{level:0,readOnly:true},source:'mysql',allowedEnvironments:['dev'],timeoutMs:1000,execution:{type:'source_adapter',operation:'fixture'}
  }]}]});
  let modelCalls=0,active=0,peak=0,executions=0;
  t.mock.method(ChatOpenAI.prototype,'_generate',async(messages:BaseMessage[],options:{tools?:{function:{name:string}}[]})=>{
    modelCalls++;
    const names=options.tools?.map(t=>t.function.name)??[];
    let calls;
    if(modelCalls===1) calls=[{id:'select',name:'select_plugin',args:{pluginName:'mysql'},type:'tool_call' as const}];
    else if(modelCalls===2) calls=Array.from({length:8},(_,id)=>({id:`read-${id}`,name:'read',args:{id},type:'tool_call' as const}));
    else {
      assert.equal(modelCalls,3);
      assert.equal(messages.filter(m=>m.name==='read').length,8);
      calls=[{id:'final',name:names.find(n=>n.startsWith('extract-'))!,args:{inferredDomains:[],preliminaryFindings:[{finding:'Suspected failure',basis:['read'],level:'critical'}],suspectedCauses:[],recommendedChecks:[],incompleteReasons:[]},type:'tool_call' as const}];
    }
    return {generations:[{text:'',message:new AIMessage({content:'',tool_calls:calls})}]};
  });
  const agent=new LangChainDiagnosticAgent(fixtureRegistry,{execute:async()=>{
    executions++;peak=Math.max(peak,++active);await new Promise(resolve=>setTimeout(resolve,2));active--;return raw;
  }},{model:'fixture',apiKey:'fixture'});
  const result=await agent.diagnose({symptom:'fixture',environment:'dev',requestedBy:'fixture',receivedAt:context.referenceTime.toISOString()});
  assert.equal(executions,8);assert.equal(peak,1);assert.equal(result.rawResults?.length,8);
  assert.equal(new TemporaryDiagnosticPresenter().createPresentation(result).status,'insufficient_tools');
});
