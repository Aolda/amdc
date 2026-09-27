import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { retrieve, tokenize } from '../scripts/lib/knowledge-retrieval.mjs';
const data = JSON.parse(readFileSync(new URL('../knowledge/amdb-domain.json', import.meta.url), 'utf8'));
test('knowledge retrieval handles natural Korean queries without query-specific aliases', () => {
  assert.ok(retrieve('sg DB가 느려졌는데 어떤 계정으로 확인해야 해?', data.cards).some(c=>c.id==='database-identity'));
  assert.ok(retrieve('메트릭 연결 수 라벨',data.cards).some(c=>c.id==='metric-labels'));
  assert.deepEqual(retrieve('내일 제주도 날씨', data.cards), []);
});
test('knowledge retrieval preserves provenance and bounds query/context', () => {
  for(const c of retrieve('SQL 계정',data.cards)) assert.ok(c.sources.length);
  assert.equal(retrieve('SQL 계정',data.cards,{maxChars:1}).length,0);
  assert.throws(()=>retrieve('x'.repeat(1001),data.cards));
  assert.throws(()=>retrieve('test',data.cards,{limit:100}));
  assert.ok(tokenize('amdb_user_connections').includes('amdb_user_connections'));
});
test('knowledge includes exact identifier and metric label mappings', () => {
  assert.ok(data.cards.find(c=>c.id==='database-identity').content.includes("name + '_' + user_id.replace('-', '')[:8]"));
  assert.ok(data.cards.find(c=>c.id==='metric-labels').content.includes('username=mysql_db_name'));
});
