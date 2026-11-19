// I18N-a: 사전에서 문구를 찾아 {이름}을 채운다. 웹 화면에도 이 함수 원문을 그대로 넣어 쓰므로(서버가 페이지에 넣음)
// 바깥 변수·import를 쓰지 않는 함수 하나로 둔다.
// dicts: 찾을 순서대로 [고른 언어, 영어, 한국어] 사전(평평한 { '묶음.키': '문구' })
// 채우기: {name}  ·  한국어 조사 {name|이가} {name|을를} {name|은는} {name|과와} {name|아야} {name|으로} {name|이에요} {name|이라}
//         영어 단수·복수 {count|one:# file|other:# files}(#은 그 수)
export function ieonFormat(dicts, key, vars, lang) {
  let s;
  for (const d of dicts) { if (d && typeof d[key] === 'string') { s = d[key]; break; } }
  if (s === undefined) return key;
  if (!vars) return s;
  const JOSA = { '이가': ['이', '가'], '을를': ['을', '를'], '은는': ['은', '는'], '과와': ['과', '와'], '아야': ['아', '야'], '으로': ['으로', '로'], '이에요': ['이에요', '예요'], '이라': ['이라', '라'] };
  return s.replace(/\{(\w+)(?:\|([^{}]*))?\}/g, (all, name, opt) => {
    if (!(name in vars)) return all;
    const v = vars[name] == null ? '' : String(vars[name]);
    if (opt === undefined) return v;
    if (JOSA[opt]) {
      const c = v.charCodeAt(v.length - 1);
      const hangul = c >= 0xac00 && c <= 0xd7a3;
      const jong = hangul ? (c - 0xac00) % 28 : 0;
      const has = opt === '으로' ? hangul && jong !== 0 && jong !== 8 : hangul && jong !== 0; // '으로'는 ㄹ 받침이면 '로'
      return v + JOSA[opt][has ? 0 : 1];
    }
    const forms = {};
    for (const part of opt.split('|')) { const i = part.indexOf(':'); if (i > 0) forms[part.slice(0, i)] = part.slice(i + 1); }
    let cat = 'other';
    try { cat = new Intl.PluralRules(lang || 'en').select(Number(v)); } catch { /* 모르는 언어면 other */ }
    return (forms[cat] ?? forms.other ?? v).replace(/#/g, v);
  });
}
