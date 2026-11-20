// I18N-a: 웹 화면 문구를 한국어 사전으로 옮기는 도구(한 번 돌리는 개발 도구 — 제품 실행에는 쓰지 않음).
//   node scripts/i18n-extract.mjs <화면 파일> <묶음>      예) node scripts/i18n-extract.mjs src/pilot/web/app.html web
// - 화면(HTML)의 한국어 글·속성값 → {{키}} (서버가 화면을 보낼 때 고른 언어 문구로 채움, src/i18n/index.mjs injectPage)
// - <script> 안의 한국어 문자열 → t('키'). 'a' + x + 'b'처럼 이어 붙인 문장은 t('키', { x })와 "a{x}b" 한 문장으로 합친다.
// - 같은 글은 같은 키를 다시 쓴다. 키 = <묶음>.<자리>.<번호>(자리 = 둘러싼 함수 이름 또는 가까운 요소 id).
// - locales/ko/<묶음>.json에 더한다(이미 있는 키는 그대로).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [file, ns] = process.argv.slice(2);
if (!file || !ns) { console.error('사용법: node scripts/i18n-extract.mjs <화면 파일> <묶음>'); process.exit(2); }
const HANGUL = /[가-힣ㄱ-ㆎ]/;
const dictPath = new URL(`../locales/ko/${ns}.json`, import.meta.url);
const dict = existsSync(dictPath) ? JSON.parse(readFileSync(dictPath, 'utf8')) : {};
const byText = new Map(Object.entries(dict).map(([k, v]) => [v, k]));
const seq = new Map();
const snake = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'misc';
function keyFor(text, area) {
  if (byText.has(text)) return byText.get(text);
  const a = snake(area);
  let n = seq.get(a) ?? Object.keys(dict).filter((k) => k.startsWith(`${a}.`)).length;
  let k; do { n += 1; k = `${a}.${n}`; } while (k in dict);
  seq.set(a, n); dict[k] = text; byText.set(text, k);
  return k;
}
const full = (k) => `${ns}.${k}`;

// ---------- JS 낱말 나누기 ----------
function lex(src) {
  const toks = []; let i = 0; const n = src.length;
  const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];
  const regexOk = () => { const p = toks.at(-1); if (!p) return true; if (p.type === 'punct') return !/^[)\]}]$/.test(p.v); if (p.type === 'ident') return /^(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await|instanceof)$/.test(p.v); return false; };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    const start = i;
    if (c === '"' || c === "'") { i++; while (src[i] !== c) { if (src[i] === '\\') i++; i++; } i++; toks.push({ type: 'str', start, end: i, v: src.slice(start, i) }); continue; }
    if (c === '`') { i++; let depth = 0; while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (depth === 0 && src[i] === '`') break; if (src[i] === '$' && src[i + 1] === '{') { depth++; i += 2; continue; } if (depth && src[i] === '}') { depth--; i++; continue; } if (depth && (src[i] === "'" || src[i] === '"')) { const q = src[i]; i++; while (src[i] !== q) { if (src[i] === '\\') i++; i++; } } i++; } i++; toks.push({ type: 'tpl', start, end: i, v: src.slice(start, i) }); continue; }
    if (c === '/' && regexOk()) { i++; let cls = false; while (i < n && src[i] !== '\n') { const d = src[i]; if (d === '\\') { i += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; i++; } i++; while (/[a-z]/i.test(src[i] ?? '')) i++; toks.push({ type: 're', start, end: i, v: src.slice(start, i) }); continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) { while (/[0-9a-zA-Z_.]/.test(src[i] ?? '')) i++; toks.push({ type: 'num', start, end: i, v: src.slice(start, i) }); continue; }
    if (/[A-Za-z_$\u0080-￿]/.test(c)) { while (/[A-Za-z0-9_$\u0080-￿]/.test(src[i] ?? '')) i++; toks.push({ type: 'ident', start, end: i, v: src.slice(start, i) }); continue; }
    const p = PUNCT.find((x) => src.startsWith(x, i)) ?? c; i += p.length;
    toks.push({ type: 'punct', start, end: i, v: p });
  }
  // 괄호 짝
  const st = [];
  toks.forEach((t, k) => { if (t.type !== 'punct') return; if ('([{'.includes(t.v)) st.push(k); else if (')]}'.includes(t.v)) { const o = st.pop(); if (o !== undefined) { toks[o].match = k; t.match = o; } } });
  return toks;
}
const isOpen = (t) => t?.type === 'punct' && '([{'.includes(t.v);
const isClose = (t) => t?.type === 'punct' && ')]}'.includes(t.v);
const isPrim = (t) => t && ['str', 'tpl', 'num', 'ident', 're'].includes(t.type) && !(t.type === 'ident' && /^(return|typeof|case|in|of|new|delete|void|throw|await|instanceof|else|do)$/.test(t.v));
// 피연산자 하나의 끝(뒤로): k는 피연산자의 첫 낱말
function operandFwd(toks, k) {
  if (toks[k]?.type === 'punct' && (toks[k].v === '!' || toks[k].v === '-')) return null; // 단항 연산은 묶지 않음
  let j;
  if (isPrim(toks[k])) j = k; else if (isOpen(toks[k]) && toks[k].match !== undefined) j = toks[k].match; else return null;
  for (;;) {
    const nx = toks[j + 1];
    if (nx?.type === 'punct' && (nx.v === '.' || nx.v === '?.') && toks[j + 2]) { if (toks[j + 2].type === 'ident') { j += 2; continue; } if (isOpen(toks[j + 2])) { j = toks[j + 2].match; continue; } }
    if (nx?.type === 'punct' && (nx.v === '(' || nx.v === '[') && nx.match !== undefined) { j = nx.match; continue; }
    return j;
  }
}
// 피연산자 하나의 시작(앞으로): k는 피연산자의 마지막 낱말
function operandBack(toks, k) {
  let j = k;
  for (;;) {
    if (isClose(toks[j])) { j = toks[j].match; if (j === undefined) return null; if (toks[j].v === '{') return null; const pv = toks[j - 1]; if (pv && (isPrim(pv) || isClose(pv)) && toks[j].v !== '{') { j -= 1; continue; } if (pv?.type === 'punct' && pv.v === '?.') { j -= 2; continue; } return j; }
    if (!isPrim(toks[j])) return null;
    const pv = toks[j - 1];
    if (pv?.type === 'punct' && (pv.v === '.' || pv.v === '?.')) { j -= 2; continue; }
    return j;
  }
}
const evalStr = (lit) => Function(`"use strict"; return (${lit});`)();
const LOW = new Set(['*', '/', '%', '**', '.', '?.', '-']); // 이것과 붙어 있으면 덧셈 사슬로 보지 않음
const nameOf = (expr, used) => {
  const ids = expr.replace(/\?\./g, '.').match(/[A-Za-z_$][\w$]*/g)?.filter((x) => !/^(length|body|value|textContent|toLocaleString|toString|join|map|slice|String|Number|r|x|d|c|b|e|s|a|n|o|m|p)$/.test(x)) ?? [];
  let base = snake(ids.at(-1) ?? 'v').replace(/^(\d)/, 'v$1'); if (!/^[a-z]/.test(base)) base = 'v' + base;
  let nm = base, i = 2; while (used.has(nm)) nm = base + i++;
  used.add(nm); return nm;
};

function convertScript(src, areaAt) {
  for (let pass = 0; pass < 20; pass++) {
    const toks = lex(src);
    const edits = [];
    const taken = new Set();
    for (let k = 0; k < toks.length; k++) {
      const tk = toks[k];
      if (tk.type !== 'str' || !HANGUL.test(tk.v) || taken.has(k)) continue;
      // 사슬 찾기: 이 문자열 왼쪽·오른쪽으로 '+'로 이어진 피연산자들
      let first = k, last = k;
      const parts = [{ s: k, e: k }];
      // 왼쪽
      for (;;) {
        const plus = toks[first - 1];
        if (!(plus?.type === 'punct' && plus.v === '+')) break;
        const e = first - 2; const s = operandBack(toks, e);
        if (s === null || s === undefined) break;
        parts.unshift({ s, e }); first = s;
      }
      // 오른쪽
      for (;;) {
        const plus = toks[last + 1];
        if (!(plus?.type === 'punct' && plus.v === '+')) break;
        const s = last + 2; const e = operandFwd(toks, s);
        if (e === null || e === undefined) break;
        parts.push({ s, e }); last = e;
      }
      const before = toks[first - 1], after = toks[last + 1];
      const chainOk = parts.length > 1 && !(before?.type === 'punct' && LOW.has(before.v)) && !(after?.type === 'punct' && LOW.has(after.v));
      const area = areaAt(tk.start);
      if (!chainOk) { edits.push({ start: tk.start, end: tk.end, text: `t('${full(keyFor(evalStr(tk.v), area))}')` }); taken.add(k); continue; }
      // 첫 문자열 앞의 피연산자들은 숫자 덧셈일 수 있어 하나로 묶는다
      const firstStr = parts.findIndex((p) => p.s === p.e && toks[p.s].type === 'str');
      let text = ''; const vars = []; const used = new Set();
      const exprOf = (p) => src.slice(toks[p.s].start, toks[p.e].end);
      if (firstStr > 0) { const ex = parts.slice(0, firstStr).map(exprOf).join(' + '); const nm = nameOf(ex, used); vars.push([nm, firstStr > 1 ? `(${ex})` : ex]); text += `{${nm}}`; }
      for (const p of parts.slice(Math.max(firstStr, 0))) {
        if (p.s === p.e && toks[p.s].type === 'str') { const v = evalStr(toks[p.s].v); if (/\{\w+(\|[^{}]*)?\}/.test(v)) { text = null; break; } text += v; for (let q = p.s; q <= p.e; q++) taken.add(q); }
        else { const ex = exprOf(p); const nm = nameOf(ex, used); vars.push([nm, ex]); text += `{${nm}}`; }
      }
      if (text === null) { edits.push({ start: tk.start, end: tk.end, text: `t('${full(keyFor(evalStr(tk.v), area))}')` }); taken.add(k); continue; }
      for (let q = first; q <= last; q++) taken.add(q);
      const obj = vars.length ? `, { ${vars.map(([nm, ex]) => (nm === ex ? nm : `${nm}: ${ex}`)).join(', ')} }` : '';
      edits.push({ start: toks[first].start, end: toks[last].end, text: `t('${full(keyFor(text, area))}'${obj})` });
    }
    if (!edits.length) return src;
    // 겹치지 않는 것만(바깥 사슬 먼저) — 나머지는 다음 차례에
    edits.sort((a, b) => a.start - b.start || b.end - a.end);
    const keep = []; let lastEnd = -1;
    for (const e of edits) if (e.start >= lastEnd) { keep.push(e); lastEnd = e.end; }
    for (const e of keep.reverse()) src = src.slice(0, e.start) + e.text + src.slice(e.end);
  }
  throw new Error('끝나지 않음');
}

// ---------- HTML ----------
const unesc = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function convertHtml(html) {
  const out = []; let i = 0;
  const re = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g; let m;
  const segs = [];
  while ((m = re.exec(html))) { segs.push({ html: true, s: html.slice(i, m.index) }); segs.push({ html: false, s: m[0], tag: m[1] }); i = m.index + m[0].length; }
  segs.push({ html: true, s: html.slice(i) });
  let pos = 0;
  for (const seg of segs) {
    if (!seg.html) {
      if (seg.tag === 'script' && /^<script>/.test(seg.s)) {
        const body = seg.s.slice('<script>'.length, -'</script>'.length);
        const decls = [...body.matchAll(/^(?:async\s+)?function\s+([\w$]+)|^(?:const|let)\s+([\w$]+)\s*=/gm)].map((d) => [d.index, d[1] ?? d[2]]);
        const areaAt = (p) => { let a = 'script'; for (const [at, nm] of decls) { if (at <= p) a = nm; else break; } return a; };
        out.push('<script>' + convertScript(body, areaAt) + '</script>');
      } else out.push(seg.s);
      pos += seg.s.length; continue;
    }
    let s = seg.s;
    const areaAt = (p) => { const before = html.slice(0, pos + p); const ids = [...before.matchAll(/\sid="([^"]+)"/g)]; return 'html_' + (ids.at(-1)?.[1] ?? 'top'); };
    // 속성값
    s = s.replace(/(\s(?:placeholder|aria-label|title|data-tip|alt|value|content)=")([^"]*[가-힣][^"]*)(")/g, (all, a, v, b, off) => `${a}{{${full(keyFor(unesc(v), areaAt(off)))}}}${b}`);
    // 글 마디
    s = s.replace(/>([^<>]*[가-힣][^<>]*)</g, (all, txt, off) => {
      const lead = txt.match(/^\s*/)[0], trail = txt.match(/\s*$/)[0];
      const core = txt.slice(lead.length, txt.length - trail.length);
      return `>${lead}{{${full(keyFor(unesc(core), areaAt(off)))}}}${trail}<`;
    });
    out.push(s); pos += seg.s.length;
  }
  return out.join('');
}

const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const res = convertHtml(src);
writeFileSync(file, res);
writeFileSync(dictPath, JSON.stringify(dict, null, 2) + '\n');
console.log(`키 ${Object.keys(dict).length}개 → locales/ko/${ns}.json`);
