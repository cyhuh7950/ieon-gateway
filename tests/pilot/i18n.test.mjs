// I18N-a(설계 docs/design/I18N.md 4절): 언어를 쉽게 더해도 안 깨지게 — 키 맞춤·채우기 맞춤·안 쓰는 키·직접 쓴 문구 금지.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ieonFormat } from '../../src/i18n/format.mjs';
import { languages, loadDict, makeT, pickLang, injectPage, errText, BASE_LANG } from '../../src/i18n/index.mjs';
import { jsStrings, jsxHangul, HANGUL } from './i18n-scan.mjs';
import { build as buildAppLocales, OUT as APP_LOCALES, ELECTRON_OUT, ANDROID_RES } from '../../app/scripts/copy-locales.mjs';
import { webPage } from './web-page.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = (p) => relative(ROOT, p).split(sep).join('/');
const slots = (s) => [...String(s).matchAll(/\{(\w+)(?:\|[^{}]*)?\}/g)].map((m) => m[1]).sort();

// 직접 쓴 문구 금지 대상(I18N-a에서 사전으로 옮긴 곳). 웹 화면은 NO_HARDCODE_PAGES, 앱은 APP_CODE.
const NO_HARDCODE = ['src/pilot', 'src/relay', 'src/hub', 'src/engine', 'src/i18n'];
const NO_HARDCODE_SKIP = [/^src\/pilot\/web\//];
// 웹 화면: 옮긴 화면은 <script> 안 문자열과 화면 글(주석 밖) 모두 한국어 0.
const NO_HARDCODE_PAGES = ['src/pilot/web/app.html', 'src/pilot/web/settings.html'];
// 허용 목록: 사람에게 보이는 화면 글이 아닌 것(파일 전체 또는 그 문자열만). 이유를 같이 적는다.
const ALLOW = [
  { file: 'src/i18n/format.mjs', why: '한국어 조사 표(채우기 함수)' },
  { file: 'src/pilot/codex-resume-once.mjs', why: '첫 실증 시험 도구(시험 질문)' },
  { file: 'src/pilot/shared-server-turn-once.mjs', why: '첫 실증 시험 도구(시험 질문)' },
  { file: 'src/pilot/accounts.mjs', text: '# 이어온 전용 계정 폴더', why: 'Codex 설정 파일(config.toml) 안의 주석' },
  { file: 'src/pilot/accounts.mjs', text: 'name = "이어온 호환 주소"', why: 'Codex 설정 파일(config.toml) 안의 제공자 이름' },
  { file: 'src/pilot/bots.mjs', text: '가-힣', why: '부르는 이름에 쓸 수 있는 글자 범위(검사용 정규식)' },
  { file: 'src/pilot/push.mjs', text: '{name|이가}', why: '조사 처리 채우기 표시' },
];
const allowed = (file, text) => ALLOW.some((a) => a.file === file && (!a.text || text.includes(a.text)));

// 이어온 앱(I18N-a-4): 화면 코드(app/src, 복사한 사전 app/src/locales 제외)와 PC 앱 메인(app/electron)
const APP_CODE = () => [...walk(join(ROOT, 'app/src')), ...walk(join(ROOT, 'app/electron'))].filter((p) => /\.(tsx?|cjs)$/.test(p) && !rel(p).startsWith('app/src/locales/'));

// 코드 속 문자열(키를 부르는 곳 찾기): src의 .mjs와 웹 화면의 <script>, 이어온 앱 코드
function codeStrings() {
  const out = [];
  for (const p of APP_CODE()) out.push(...jsStrings(readFileSync(p, 'utf8')));
  for (const p of walk(join(ROOT, 'src'))) {
    if (p.endsWith('.mjs')) out.push(...jsStrings(readFileSync(p, 'utf8')));
    else if (p.endsWith('.html')) {
      const html = readFileSync(p, 'utf8');
      for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) out.push(...jsStrings(m[1]));
      for (const m of html.matchAll(/\{\{([a-z][\w.]*)\}\}/g)) out.push({ kind: 'str', text: m[1] }); // 화면 고정 글
    }
  }
  return out;
}

test('I18N 채우기: {이름}·한국어 조사·영어 단수/복수·빠진 키는 영어 → 한국어 순, 끝내 없으면 키', () => {
  const ko = { 'a.hi': '{name|이가} 답했어요', 'a.obj': '{name|을를} 지워요', 'a.to': '{name|으로} 가요', 'a.only': '한국어만' };
  const en = { 'a.hi': '{name} replied', 'a.files': '{count|one:# file|other:# files}' };
  assert.equal(ieonFormat([ko], 'a.hi', { name: '리뷰' }, 'ko'), '리뷰가 답했어요');
  assert.equal(ieonFormat([ko], 'a.hi', { name: '코덱스봇' }, 'ko'), '코덱스봇이 답했어요');
  assert.equal(ieonFormat([ko], 'a.obj', { name: '파일' }, 'ko'), '파일을 지워요');
  assert.equal(ieonFormat([ko], 'a.to', { name: '서울' }, 'ko'), '서울로 가요'); // ㄹ 받침은 '로'
  assert.equal(ieonFormat([ko], 'a.to', { name: '부산' }, 'ko'), '부산으로 가요');
  assert.equal(ieonFormat([en, ko], 'a.files', { count: 1 }, 'en'), '1 file');
  assert.equal(ieonFormat([en, ko], 'a.files', { count: 3 }, 'en'), '3 files');
  assert.equal(ieonFormat([{}, en, ko], 'a.only', null, 'fr'), '한국어만');
  assert.equal(ieonFormat([{}, en, ko], 'a.nothing', null, 'fr'), 'a.nothing');
  assert.equal(ieonFormat([ko], 'a.hi', {}, 'ko'), '{name|이가} 답했어요'); // 값이 없으면 그대로(빈칸으로 만들지 않음)
});

test('I18N 언어 고르기: 쿠키 → 브라우저 언어 → 영어 → 한국어, 화면에 사전·lang이 들어감', () => {
  const have = languages();
  assert.equal(have[0], BASE_LANG);
  assert.equal(pickLang({ headers: { cookie: 'a=1; ieon_lang=ko' } }), 'ko');
  assert.equal(pickLang({ headers: { 'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8' } }), 'ko');
  assert.equal(pickLang({ headers: { 'accept-language': 'zz-ZZ' } }), have.includes('en') ? 'en' : 'ko'); // 없는 언어
  const html = injectPage('<!doctype html>\n<html lang="ko">\n<head>\n<title>x</title></head><body></body></html>', 'ko', ['errors']);
  assert.match(html, /<html lang="ko">/);
  assert.match(html, /const I18N = \{"lang":"ko"/);
  assert.match(html, /function t\(key, vars\)/);
  assert.doesNotMatch(html.split('const I18N')[1].split(';\n')[0], /<\//); // 사전 속 </script>가 화면을 끊지 않게
});

test('I18N 화면: 서버가 보내는 app.html은 고정 글 {{키}}가 모두 채워지고, 로그인 화면 아래 언어 고르기·날짜·음성은 화면 언어를 따름', () => {
  const page = webPage('app.html');
  assert.doesNotMatch(page.replace(/<script>[\s\S]*?<\/script>/g, ''), /\{\{[a-z]/);
  assert.match(page, /<title>이어온<\/title>/);
  assert.match(page, /id="langSel"[^>]*aria-label="언어"/);
  assert.ok(page.includes("setLang(s.value)") && page.includes("t('common.speech_lang')") && page.includes("t('common.intl_locale')"));
  assert.ok(!/'ko-KR'/.test(page.split('const I18N')[1].split('</script>').slice(1).join('')), '화면 코드에 ko-KR 고정 없음');
});

test('I18N 화면: 서버가 보내는 settings.html도 고정 글이 모두 채워지고, 맨 위에 언어 고르기, 날짜는 화면 언어', () => {
  const page = webPage('settings.html');
  assert.doesNotMatch(page.replace(/<script>[\s\S]*?<\/script>/g, ''), /\{\{[a-z]/);
  assert.match(page, /<header>[\s\S]*id="langSel"[^>]*aria-label="언어"[\s\S]*<\/header>/);
  assert.ok(page.includes('setLang(s.value)') && !page.includes("'ko-KR'"));
  assert.ok(page.includes("new RegExp('^(' + t('settings.danger.start')"), '되돌릴 수 없는 일 버튼 낱말도 사전에서');
});

test('I18N 오류 문구: 한 곳(errors)에서, 자리 전용 문구가 있으면 그것', () => {
  const t = makeT('ko');
  assert.equal(errText(t, 'hub_mode'), t('errors.hub_mode'));
  assert.match(errText(t, 'session_archived', { surface: 'messenger' }), /\/restore/);
  assert.doesNotMatch(errText(t, 'session_archived'), /\/restore/);
  assert.equal(errText(t, 'conversation_busy', { ns: true }), t('errors.ns.conversation_busy'));
  assert.equal(errText(t, 'no_such_code', { surface: 'messenger', fallback: 'messenger.fail.send' }), '보낼 수 없음: no_such_code');
});

test('I18N 키 맞춤: 모든 언어 사전이 한국어 사전의 키를 다 가짐(영어는 하나라도 빠지면 실패, 다른 언어는 빠진 수 보고)', () => {
  const ko = loadDict(BASE_LANG);
  assert.ok(Object.keys(ko).length > 100, '한국어 사전이 비어 있음');
  for (const [k, v] of Object.entries(ko)) assert.equal(typeof v, 'string', k);
  for (const lang of languages().filter((l) => l !== BASE_LANG)) {
    const d = loadDict(lang);
    const missing = Object.keys(ko).filter((k) => typeof d[k] !== 'string');
    const extra = Object.keys(d).filter((k) => !(k in ko));
    assert.deepEqual(extra, [], `${lang}: 한국어에 없는 키`);
    if (lang === 'en') assert.deepEqual(missing, [], 'en: 빠진 키');
    else if (missing.length) console.log(`[I18N] ${lang}: 빠진 키 ${missing.length}개(영어로 보임)`);
  }
});

test('I18N 채우기 맞춤: {이름} 자리 표시가 언어마다 같음', () => {
  const ko = loadDict(BASE_LANG);
  for (const lang of languages().filter((l) => l !== BASE_LANG)) {
    const d = loadDict(lang);
    for (const k of Object.keys(d)) if (k in ko) assert.deepEqual(slots(d[k]), slots(ko[k]), `${lang} ${k}`);
  }
});

test('I18N 안 쓰는 키: 사전의 키는 모두 코드에서 부른다(글자 그대로, 또는 `묶음.자리.${…}`처럼 앞부분으로)', () => {
  const strs = codeStrings();
  const exact = new Set(strs.map((s) => s.text));
  const prefixes = strs.filter((s) => s.kind === 'tpl' && /^[a-z]+(\.[a-z_]+)*\.$/.test(s.text)).map((s) => s.text);
  const unused = Object.keys(loadDict(BASE_LANG)).filter((k) => !exact.has(k) && !prefixes.some((p) => k.startsWith(p)));
  assert.deepEqual(unused, []);
});

test('I18N 없는 키: 코드가 부르는 키(글자 그대로)는 모두 한국어 사전에 있다', () => {
  const ko = loadDict(BASE_LANG);
  const files = [...APP_CODE(), ...walk(join(ROOT, 'src')).filter((p) => /\.(mjs|html)$/.test(p))];
  const used = new Set();
  for (const p of files) {
    const s = readFileSync(p, 'utf8');
    for (const m of s.matchAll(/\b(?:t|i18nT|tServer|tr)\(\s*['"]([a-z][\w.]*\w)['"]/g)) used.add(m[1]); // t('키'), 서버 i18nT('키'), PC 앱 tr("키")
    for (const m of s.matchAll(/\{\{([a-z][\w.]*)\}\}/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !(k in ko));
  assert.deepEqual(missing, []);
});

test('I18N 직접 쓴 문구 금지: 사전으로 옮긴 코드의 문자열 안 한국어 0(주석·시험·사전·허용 목록 제외)', () => {
  const found = [];
  for (const dir of NO_HARDCODE) {
    for (const p of walk(join(ROOT, dir)).filter((x) => /\.(mjs|js)$/.test(x))) {
      const file = rel(p);
      if (NO_HARDCODE_SKIP.some((re) => re.test(file))) continue;
      for (const s of jsStrings(readFileSync(p, 'utf8'))) if (HANGUL.test(s.text) && !allowed(file, s.text)) found.push(`${file}:${s.line} ${s.text.slice(0, 60)}`);
    }
  }
  for (const file of NO_HARDCODE_PAGES) {
    const html = readFileSync(join(ROOT, file), 'utf8');
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      const line0 = html.slice(0, m.index).split('\n').length - 1;
      for (const s of jsStrings(m[1])) if (HANGUL.test(s.text) && !allowed(file, s.text)) found.push(`${file}:${line0 + s.line} ${s.text.slice(0, 60)}`);
    }
    const blank = (x) => x.replace(/[^\n]/g, '');
    const outside = html.replace(/<script>[\s\S]*?<\/script>/g, blank).replace(/<!--[\s\S]*?-->/g, blank).replace(/\/\*[\s\S]*?\*\//g, blank);
    outside.split('\n').forEach((ln, i) => { if (HANGUL.test(ln)) found.push(`${file}:${i + 1} ${ln.trim().slice(0, 60)}`); });
  }
  // 이어온 앱: 문자열과 JSX 글 모두
  for (const p of APP_CODE()) {
    const file = rel(p); const src = readFileSync(p, 'utf8');
    for (const s of jsStrings(src)) if (HANGUL.test(s.text) && !allowed(file, s.text)) found.push(`${file}:${s.line} ${s.text.slice(0, 60)}`);
    for (const s of jsxHangul(src)) found.push(`${file}:${s.line} ${s.text.slice(0, 60)}`);
  }
  assert.deepEqual(found, [], '문구는 locales/ko/*.json에 두고 t()(스크립트·앱)나 {{키}}(화면 글)로 부르세요');
});

test('I18N 앱 사전: app/src/locales·app/electron/locales.json이 저장소 locales/와 같음(다르면 node app/scripts/copy-locales.mjs)', () => {
  const { files, electron, android } = buildAppLocales();
  const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  for (const [f, s] of Object.entries(files)) assert.equal(read(APP_LOCALES + f), s, f);
  assert.deepEqual(readdirSync(APP_LOCALES).sort(), Object.keys(files).sort());
  assert.equal(read(ELECTRON_OUT), electron);
  for (const [f, s] of Object.entries(android)) assert.equal(read(ANDROID_RES + f), s, f); // 안드로이드 앱 이름(values = 영어 기본, values-ko 등)
  const pkg = JSON.parse(readFileSync(join(ROOT, 'app/package.json'), 'utf8'));
  assert.equal(pkg.scripts.prebuild, 'node scripts/copy-locales.mjs', '빌드 전에 자동으로 복사');
});
