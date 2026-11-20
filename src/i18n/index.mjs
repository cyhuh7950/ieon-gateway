// I18N-a: 언어별 사전(locales/<언어>/<묶음>.json)을 읽어 t()를 만든다. 설계 docs/design/I18N.md
// - 한국어가 원본. 사전에 없는 키는 고른 언어 → 영어 → 한국어 순으로 찾는다(화면에 빈칸·키 이름이 나오지 않게).
// - 언어 더하기 = locales/<새 언어>/ 폴더 더하기. 이 파일은 바꾸지 않는다.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ieonFormat } from './format.mjs';

export const LOCALES_DIR = fileURLToPath(new URL('../../locales/', import.meta.url));
export const BASE_LANG = 'ko'; // 원본
const FALLBACK = ['en', BASE_LANG];
const cache = new Map();

// 사전이 있는 언어(폴더 이름). 한국어가 늘 먼저.
export function languages() {
  const all = existsSync(LOCALES_DIR) ? readdirSync(LOCALES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(d.name)).map((d) => d.name) : [];
  return [BASE_LANG, ...all.filter((l) => l !== BASE_LANG).sort()];
}

// 한 언어의 사전: 묶음 이름을 앞에 붙인 평평한 표 { 'errors.hub_mode': '…' }
export function loadDict(lang, namespaces = null) {
  const key = `${lang}|${namespaces ? namespaces.join(',') : '*'}`;
  if (cache.has(key)) return cache.get(key);
  const dir = new URL(`../../locales/${lang}/`, import.meta.url);
  const out = {};
  if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(lang) && existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const ns = f.slice(0, -5);
      if (namespaces && !namespaces.includes(ns)) continue;
      const table = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
      for (const [k, v] of Object.entries(table)) out[`${ns}.${k}`] = v;
    }
  }
  cache.set(key, out);
  return out;
}

const chain = (lang, namespaces) => [...new Set([lang, ...FALLBACK])].map((l) => loadDict(l, namespaces));

// t('errors.hub_mode', { name: '…' }) — lang 생략하면 서버 기본 언어
export function makeT(lang) {
  const dicts = chain(lang);
  const t = (key, vars) => ieonFormat(dicts, key, vars, lang);
  t.has = (key) => dicts.some((d) => typeof d[key] === 'string');
  t.lang = lang;
  return t;
}

// 오류 코드 → 문구. 그 자리 전용 문구(errors.<자리>.<코드>)가 있으면 그것, 없으면 errors.<코드>, 그것도 없으면 fallback 키
export function errText(tr, code, { surface, fallback, ns } = {}) {
  const keys = [surface && `errors.${surface}.${ns ? 'ns.' : ''}${code}`, ns && `errors.ns.${code}`, `errors.${code}`].filter(Boolean);
  for (const k of keys) if (tr.has(k)) return tr(k);
  return fallback ? tr(fallback, { code: code ?? '' }) : String(code ?? '');
}

// 서버 기본 언어(메신저 봇 답·카카오 중계 안내·AI 머리말·서버가 만드는 글). I18N-b에서 설정으로 바꿀 수 있게 한다.
let serverLangValue = normLang(process.env.IEON_LANG) ?? BASE_LANG;
export function serverLang() { return serverLangValue; }
export function setServerLang(lang) { serverLangValue = normLang(lang) ?? BASE_LANG; tServer = makeT(serverLangValue); }
let tServer = makeT(serverLangValue);
export const t = (key, vars) => tServer(key, vars);
t.has = (key) => tServer.has(key);
Object.defineProperty(t, 'lang', { get: () => tServer.lang });

// 이 PC·서버의 언어(사전이 있는 것만): 환경 변수 LC_ALL·LC_MESSAGES·LANG(예: ko_KR.UTF-8), Windows는 시스템 언어. C·POSIX·모르면 null
export function detectOsLang() {
  for (const v of [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG]) {
    if (!v || /^(C|POSIX)(.|$)/i.test(v)) continue;
    const l = normLang(String(v).split('.')[0]); if (l) return l;
  }
  if (process.platform === 'win32') { try { return normLang(Intl.DateTimeFormat().resolvedOptions().locale); } catch { /* 모름 */ } }
  return null;
}
// 서버 기본 언어 정하기: 웹 설정에서 고른 것 → 설치 때 정한 IEON_LANG → 이 PC 언어 → 한국어
export function initServerLang(saved) { setServerLang(normLang(saved) ?? normLang(process.env.IEON_LANG) ?? detectOsLang() ?? BASE_LANG); return serverLang(); }

// 'en-US' → 'en'(사전이 있는 언어만). 없으면 null
export function normLang(v) {
  if (!v) return null;
  const s = String(v).trim().replace('_', '-');
  const have = languages();
  if (have.includes(s)) return s;
  const base = s.split('-')[0].toLowerCase();
  return have.includes(base) ? base : null;
}

// 웹 화면 언어: 쿠키 ieon_lang → 브라우저 언어(Accept-Language) → 영어 → 한국어
export function pickLang(req) {
  const cookie = String(req?.headers?.cookie ?? '').match(/(?:^|;\s*)ieon_lang=([^;]+)/);
  const fromCookie = cookie ? normLang(decodeURIComponent(cookie[1])) : null;
  if (fromCookie) return fromCookie;
  const accept = String(req?.headers?.['accept-language'] ?? '').split(',').map((p) => { const [tag, q] = p.trim().split(';q='); return { tag, q: q === undefined ? 1 : Number(q) || 0 }; })
    .filter((x) => x.tag && x.q > 0).sort((a, b) => b.q - a.q);
  for (const { tag } of accept) { const l = normLang(tag); if (l) return l; }
  return normLang('en') ?? BASE_LANG;
}

const escJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

// 웹 화면에 넣는 부분: 사전(고른 언어·영어·한국어 순)과 t() — 따로 불러오지 않아 깜빡임이 없다.
export function pageScript(lang, namespaces) {
  const dicts = chain(lang, namespaces);
  return `<script>const I18N = ${escJson({ lang, languages: languages().map((l) => [l, loadDict(l)['common.lang_name'] || l]), dicts })};\nconst ieonFormat = ${ieonFormat.toString()};\n`
    + 'function t(key, vars) { return ieonFormat(I18N.dicts, key, vars, I18N.lang); }\n'
    + 'function setLang(l) { document.cookie = \'ieon_lang=\' + encodeURIComponent(l) + \'; path=/; max-age=31536000; samesite=lax\'; location.reload(); }</script>\n';
}

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 화면의 고정 글 {{묶음.키}}를 고른 언어 문구로 채운다(<script>·<style> 안은 건드리지 않음).
export function fillPage(html, lang, namespaces) {
  const dicts = chain(lang, namespaces);
  return html.split(/(<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>)/).map((part, i) => (i % 2 ? part
    : part.replace(/\{\{([a-z][\w.]*)\}\}/g, (all, key) => escHtml(ieonFormat(dicts, key, null, lang))))).join('');
}

// 화면 파일마다 넣는 사전 묶음(서버와 시험이 같이 씀)
export const PAGE_NAMESPACES = { 'app.html': ['common', 'errors', 'web'], 'settings.html': ['common', 'errors', 'web', 'settings'] };

// 페이지 원문에 언어(<html lang>)·고정 글({{키}})·사전을 넣는다.
export function injectPage(html, lang, namespaces) {
  const script = pageScript(lang, namespaces);
  return fillPage(html, lang, namespaces).replace(/<html lang="[^"]*">/, () => `<html lang="${lang}">`).replace('<head>', () => `<head>\n${script}`); // 함수로 넘겨 문구 속 $가 바뀌지 않게
}
