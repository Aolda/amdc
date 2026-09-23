import 'dotenv/config';
import {ChatOpenAI} from '@langchain/openai';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {expandQuery} from './lib/knowledge-expansion.mjs';
const model=new ChatOpenAI({model:process.env.AMDC_AGENT_MODEL,apiKey:process.env.OPENAI_API_KEY,temperature:0,timeout:60000,maxRetries:0,configuration:{baseURL:process.env.OPENAI_BASE_URL||process.env.LITELLM_BASE_URL}});
const cases=[
 ['접속자가 늘었을 때 누가 얼마나 붙었는지 알고 싶어','metric-labels'],
 ['새 스키마 신청이 중간에서 멈췄어','database-provisioning'],
 ['암호를 재발급했는데 로그인이 안 돼','password-reset'],
 ['복구 작업이 대기열에서 진행되지 않아','backup-queue'],
 ['내일 제주도 날씨',null]
];
const search=q=>JSON.parse(execFileSync(process.execPath,['scripts/knowledge-local.mjs','search',q],{encoding:'utf8'})).results;
const report=[];
for(const [query,expected] of cases){
 const before=search(query);const start=Date.now();
 try{
  const expansions=before.length?[]:await expandQuery(query,model);
  // RRF merges ranks, not incomparable scores. Bound the final context to 3 whole cards.
  const fused=new Map();
  for(const result of [before,...expansions.map(search)])result.forEach((c,i)=>{
   const previous=fused.get(c.id);fused.set(c.id,{card:c,rank:(previous?.rank??0)+1/(60+i+1)});
  });
  const after=[...fused.values()].sort((a,b)=>b.rank-a.rank).slice(0,3).map(x=>x.card.id);
  report.push({query,expansions,before:before.map(c=>c.id),after,expected,pass:expected?after.includes(expected):after.length===0,ms:Date.now()-start});
 }catch(e){report.push({query,pass:false,error:e.name});}
 console.log(JSON.stringify(report.at(-1)));
}
writeFileSync('.codex-temp/knowledge-paraphrase-eval.json',JSON.stringify(report,null,2),{mode:0o600});
