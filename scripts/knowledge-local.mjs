// Local prototype only: no provider/LLM calls, no AMDB writes.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { dirname, delimiter } from 'node:path';
import { retrieve } from './lib/knowledge-retrieval.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const docker = process.env.AMDC_TEST_DOCKER || '/Applications/Docker.app/Contents/Resources/bin/docker';
const base = ['compose', '-f', 'compose.knowledge.yml'];
const command = process.argv[2];
const run = (args, input) => execFileSync(docker, [...base, ...args], { cwd: root, input, encoding: 'utf8', env: { ...process.env, PATH: dirname(docker) + delimiter + process.env.PATH }, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
const sql = text => run(['exec', '-T', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'amdc_local', '-d', 'amdc_knowledge', '-At'], text);
// SQL literals are hex-decoded UTF-8, never executable user text.
const literal = value => `convert_from(decode('${Buffer.from(value).toString('hex')}', 'hex'), 'UTF8')`;
const data = JSON.parse(readFileSync(new URL('../knowledge/amdb-domain.json', import.meta.url), 'utf8'));
assert.equal(data.scope, 'amdb_domain');
assert.match(data.sourceCommit, /^[a-f0-9]{40}$/);
assert.equal(new Set(data.cards.map(c => c.id)).size, data.cards.length);
for (const card of data.cards) assert.ok(card.title && card.content && card.sources.length);
if (command === 'start') {
  mkdirSync(root + '.codex-temp', { recursive: true, mode: 0o700 });
  const secret = root + '.codex-temp/knowledge-password';
  if (!existsSync(secret)) writeFileSync(secret, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  execFileSync(docker, [...base, 'up', '-d', '--quiet-pull', '--wait', '--wait-timeout', '90', 'postgres'], {
    cwd: root, stdio: 'inherit', timeout: 900000,
    env: { ...process.env, PATH: dirname(docker) + delimiter + process.env.PATH }
  });
} else if (command === 'seed') {
  const rows = data.cards.map(c => `(${literal(c.id)}, ${literal(data.sourceCommit)}, ${literal(c.title)}, ${literal(c.content)}, ${literal(JSON.stringify(c.sources))}::jsonb)`).join(',\n');
  console.log(sql(`BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS amdb_domain_cards (
 id text NOT NULL, source_commit text NOT NULL CHECK(length(source_commit)=40),
 title text NOT NULL, content text NOT NULL, sources jsonb NOT NULL CHECK(jsonb_array_length(sources)>0),
 scope text NOT NULL DEFAULT 'amdb_domain' CHECK(scope='amdb_domain'),
 embedding vector, embedding_model text, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(id,source_commit), CHECK((embedding IS NULL) = (embedding_model IS NULL))
);
INSERT INTO amdb_domain_cards(id,source_commit,title,content,sources) VALUES ${rows}
ON CONFLICT(id,source_commit) DO UPDATE SET title=excluded.title, content=excluded.content, sources=excluded.sources, embedding=NULL, embedding_model=NULL;
COMMIT;
SELECT count(*) FROM amdb_domain_cards;`));
} else if (command === 'search') {
  const term = process.argv[3];
  if (!term || term.length > 1000) throw Error('Provide a query (1–1000 characters).');
  const raw = sql(`SELECT jsonb_build_object('id',id,'title',title,'content',content,'sources',sources,'commit',source_commit) FROM amdb_domain_cards WHERE source_commit=${literal(data.sourceCommit)} ORDER BY id LIMIT 1001;`);
  const cards = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  if (cards.length > 1000) throw Error('Prototype corpus limit exceeded; use indexed retrieval before scaling.');
  console.log(JSON.stringify({ method:'lexical-v1', query:term, results:retrieve(term,cards) }));
} else if (command === 'check') {
  const count = Number(sql(`SELECT count(*) FROM amdb_domain_cards WHERE source_commit=${literal(data.sourceCommit)};`).trim());
  assert.equal(count, data.cards.length);
  assert.equal(Number(sql("SELECT '[1,0,0]'::vector <-> '[1,0,0]'::vector;").trim()), 0);
  for (const term of ['ProxySQL','mysql_db_name','Redis']) assert.ok(Number(sql(`SELECT count(*) FROM amdb_domain_cards WHERE source_commit=${literal(data.sourceCommit)} AND strpos(content,${literal(term)})>0;`).trim())>0);
  assert.equal(Number(sql('SELECT count(*) FROM amdb_domain_cards WHERE embedding IS NOT NULL;').trim()), 0);
  console.log(JSON.stringify({result:'PASS',cards:count,vectorArithmetic:true,keywordChecks:3,semanticEmbeddings:false}));
} else if (command === 'validate') {
  console.log(JSON.stringify({result:'PASS',cards:data.cards.length,scope:data.scope}));
} else throw Error('Usage: node scripts/knowledge-local.mjs start|seed|check|search <term>|validate');
