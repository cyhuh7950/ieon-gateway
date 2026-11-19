// I18N-a: 시험이 읽는 웹 화면 = 서버가 보내는 화면(사전·t()가 들어간 것). 화면 문구는 사전에 있으므로
// 문구를 찾는 시험은 이 함수로 읽는다(원문 파일만 읽으면 사전으로 옮긴 문구를 못 찾음).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { injectPage, PAGE_NAMESPACES as NS } from '../../src/i18n/index.mjs';

export function webPage(file, lang = 'ko') {
  const html = readFileSync(fileURLToPath(new URL(`../../src/pilot/web/${file}`, import.meta.url)), 'utf8');
  return NS[file] ? injectPage(html, lang, NS[file]) : html;
}
