// I18N 시험 도구: 코드 속 문자열(따옴표·템플릿·정규식)만 골라낸다. 주석은 건너뛴다.
// 직접 쓴 문구 금지 시험(한국어가 든 문자열 0)과 안 쓰는 키 시험(코드에서 부르는 키 찾기)에 쓴다.

// JS(.mjs·.js·.ts·.tsx) 원문 → [{ line, text, kind: 'str'|'tpl'|'re' }]
export function jsStrings(src) {
  const out = [];
  let i = 0, line = 1;
  const n = src.length;
  let prev = ''; // 마지막 의미 있는 글자(정규식인지 나누기인지 가르는 데 씀)
  const stack = []; // 템플릿 ${ … } 안의 중괄호 깊이
  const push = (kind, start, startLine, text) => out.push({ kind, line: startLine, text, start });
  const regexOk = () => prev === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || /\b(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(prev);
  function readTemplate() { // i는 ` 다음
    const startLine = line, start = i - 1; let text = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') { text += src.slice(i, i + 2); i += 2; continue; }
      if (c === '\n') line++;
      if (c === '`') { i++; push('tpl', start, startLine, text); return; }
      if (c === '$' && src[i + 1] === '{') { push('tpl', start, startLine, text); text = ''; i += 2; stack.push(0); return 'expr'; }
      text += c; i++;
    }
    push('tpl', start, startLine, text);
  }
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; line += (src.slice(i, end).match(/\n/g) ?? []).length; i = end; continue; }
    if (c === '"' || c === "'") {
      const startLine = line, start = i; i++; let text = '';
      while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { text += src.slice(i, i + 2); i += 2; continue; } text += src[i]; i++; }
      i++; push('str', start, startLine, text); prev = 'x'; continue;
    }
    if (c === '`') { i++; readTemplate(); prev = 'x'; continue; }
    if (c === '/' && regexOk()) {
      const startLine = line, start = i; i++; let text = '', cls = false;
      while (i < n && src[i] !== '\n') {
        const d = src[i];
        if (d === '\\') { text += src.slice(i, i + 2); i += 2; continue; }
        if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break;
        text += d; i++;
      }
      i++; while (/[a-z]/i.test(src[i] ?? '')) i++;
      push('re', start, startLine, text); prev = 'x'; continue;
    }
    if (stack.length) {
      if (c === '{') stack[stack.length - 1]++;
      else if (c === '}') { if (stack[stack.length - 1] === 0) { stack.pop(); i++; readTemplate(); prev = 'x'; continue; } stack[stack.length - 1]--; }
    }
    // 낱말·기호
    if (/[A-Za-z_$0-9\u0080-￿]/.test(c)) { let w = ''; while (i < n && /[A-Za-z_$0-9\u0080-￿]/.test(src[i])) w += src[i++]; prev = w; continue; }
    prev = c; i++;
  }
  return out;
}

export const HANGUL = /[가-힣ㄱ-ㆎ]/;
export const koreanStrings = (src) => jsStrings(src).filter((s) => HANGUL.test(s.text));
