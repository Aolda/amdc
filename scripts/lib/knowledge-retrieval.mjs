// Small-corpus lexical baseline. No query->card rules or synthetic embeddings.
const stop = new Set(['amdb', 'db', 'the', 'is', 'a', 'an', 'of', 'to', 'and', 'in', '어떤', '어떻게', '지금', '현재', '확인', '알려', '설명', '해줘', '있는', '있나', '위해', '대한']);
export function tokenize(text) {
  const normalized = text.normalize('NFKC').toLowerCase();
  const terms = [];
  for (const word of normalized.match(/[a-z0-9_]+|[가-힣]+/g) ?? []) {
    if (stop.has(word)) continue;
    if (/^[가-힣]+$/.test(word)) {
      // Character bigrams tolerate Korean particles without language-specific dictionaries.
      if (word.length < 2) continue;
      for (let i = 0; i < word.length - 1; i++) {
        const pair = word.slice(i, i + 2);
        if (!stop.has(pair)) terms.push(pair);
      }
    } else if (word.length > 1) terms.push(word);
  }
  return [...new Set(terms)];
}
export function retrieve(query, cards, { limit = 3, maxChars = 5000 } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 1000) throw new Error('invalid_query');
  if (!Number.isInteger(limit) || limit < 1 || limit > 5 || maxChars < 1 || maxChars > 10000) throw new Error('invalid_bounds');
  const terms = tokenize(query);
  const docs = cards.map(card => ({card, title:new Set(tokenize(card.title)), body:new Set(tokenize(card.content))}));
  const frequency = new Map(terms.map(t => [t, docs.filter(d => d.title.has(t) || d.body.has(t)).length]));
  const scored = docs.map(d => {
    const matched = terms.filter(t => d.title.has(t) || d.body.has(t));
    const score = matched.reduce((sum, t) => sum + Math.log(1 + (docs.length + 1) / (1 + frequency.get(t))) * (d.title.has(t) ? 2 : 1), 0) / Math.sqrt(1 + d.body.size / 100);
    return {...d.card, score:Number(score.toFixed(4)), matchedTerms:matched};
  }).filter(d => d.score >= 1.5 && (d.matchedTerms.length >= 2 || terms.length === 1))
    .sort((a,b) => b.score - a.score || a.id.localeCompare(b.id));
  const results = []; let size = 0;
  for (const card of scored) {
    if (results.length === limit) break;
    const n = JSON.stringify(card).length;
    if (size + n > maxChars) continue;
    results.push(card); size += n;
  }
  return results;
}
