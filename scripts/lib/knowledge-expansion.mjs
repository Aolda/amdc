// Optional recall fallback. Expansion is a query, never evidence or an identifier source.
export async function expandQuery(query, model) {
  const response = await model.invoke([
    { role:'system', content:'검색어 변환기다. 질문의 의미를 유지하면서 일반적인 기술 용어와 동의어로 검색어를 3개 이하 제안하라. 원래 없는 고유 서비스명, 계정명, DB명, 숫자나 식별자를 새로 만들지 말라. 답변이나 원인을 생성하지 말라. 출력은 JSON 문자열 배열만 허용한다. 각 검색어는 80자 이하여야 한다.' },
    { role:'user', content:query }
  ]);
  if(typeof response.content !== 'string' || response.content.length>1000) throw Error('invalid_expansion');
  const parsed=JSON.parse(response.content);
  if(!Array.isArray(parsed)||parsed.length>3||!parsed.every(x=>typeof x==='string'&&x.trim().length>0&&x.length<=80)) throw Error('invalid_expansion');
  return [...new Set(parsed)];
}
