// 자동 생성(app/scripts/copy-locales.mjs) — 원본 src/i18n/format.mjs
// @ts-nocheck
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
