// I18N-a: 시험이 읽는 웹 화면.
// - webPage(): 서버가 보내는 화면(고정 글 {{키}}를 채우고 사전·t()를 넣은 것).
// - koView(): 화면 코드를 "한국어 문구가 코드에 있던 모양"으로 펼친 것. 문구를 사전으로 옮기기 전부터 있던 시험이
//   코드 모양(예: "'승인 대기 ' + n")을 그대로 확인할 수 있게 한다 — t('키') → '문구', t('키', { n }) → '…' + n + '…', {{키}} → 문구.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { injectPage, fillPage, loadDict, PAGE_NAMESPACES as NS } from '../../src/i18n/index.mjs';

const raw = (file) => readFileSync(fileURLToPath(new URL(`../../src/pilot/web/${file}`, import.meta.url)), 'utf8');
export function webPage(file, lang = 'ko') {
  const html = raw(file);
  return NS[file] ? injectPage(html, lang, NS[file]) : html;
}

const KO = loadDict('ko');
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
function endStr(s, i) { const ch = s[i]; i++; while (i < s.length && s[i] !== ch) { if (s[i] === '\\') i++; i++; } return i + 1; }
// 괄호 깊이 0의 쉼표로 나눔(문자열 안은 건너뜀)
function splitTop(s) {
  const out = []; let depth = 0, cur = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') { const j = endStr(s, i); cur += s.slice(i, j); i = j; continue; }
    if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function closeParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') { i = endStr(s, i) - 1; continue; }
    if (c === '(') depth++; else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}
function unT(src) {
  const re = /\bt\('([a-z][\w.]*)'/g; let out = ''; let last = 0; let m;
  while ((m = re.exec(src))) {
    const open = m.index + 1; const close = closeParen(src, open);
    if (close < 0 || !(m[1] in KO)) continue;
    const args = splitTop(src.slice(open + 1, close));
    const text = KO[m[1]];
    let rep;
    if (args.length < 2) rep = q(text);
    else {
      const obj = args.slice(1).join(',').trim().replace(/^\{\s*|\s*\}$/g, '');
      const vars = Object.fromEntries(splitTop(obj).map((p) => { const i = p.indexOf(':'); const k = (i < 0 ? p : p.slice(0, i)).trim(); return [k, unT(i < 0 ? k : p.slice(i + 1).trim())]; }));
      const parts = []; const vr = /\{(\w+)\}/g; let at = 0; let mm;
      while ((mm = vr.exec(text))) { if (mm.index > at) parts.push(q(text.slice(at, mm.index))); parts.push(vars[mm[1]] ?? mm[0]); at = mm.index + mm[0].length; }
      if (at < text.length) parts.push(q(text.slice(at)));
      rep = parts.join(' + ');
    }
    out += src.slice(last, m.index) + rep; last = close + 1; re.lastIndex = close + 1;
  }
  return out + src.slice(last);
}

export function koView(file) {
  const html = raw(file).replace(/\r\n/g, '\n');
  const filled = NS[file] ? fillPage(html, 'ko', NS[file]) : html;
  const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return filled.split(/(<script>[\s\S]*?<\/script>)/).map((part, i) => (i % 2 ? unT(part) : unesc(part))).join('');
}
