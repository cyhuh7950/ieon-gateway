// I18N-b-3: 화면 점검용 가짜 언어 xx, 영어 소개 영상(장면·화면 글)이 한국어판과 맞는지. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { languages, loadDict, makeT, pseudoText, PSEUDO } from '../../src/i18n/index.mjs';
import { SCENES as KO } from '../../tools/video/intro-scenes.mjs';
import { SCENES as EN } from '../../tools/video/intro-scenes.en.mjs';

test('가짜 언어 xx: 평소에는 없고, IEON_PSEUDO_LOCALE=1일 때만 — [!! … !!]로 1.4배, {자리}·날짜·음성·명령 값은 그대로', () => {
  assert.ok(!languages().includes(PSEUDO), '평소에는 언어 목록에 없음');
  const before = process.env.IEON_PSEUDO_LOCALE;
  process.env.IEON_PSEUDO_LOCALE = '1';
  try {
    assert.ok(languages().includes(PSEUDO));
    const t = makeT(PSEUDO);
    const s = t('messenger.ask.received', { label: 'X' });
    assert.match(s, /^\[!! .*~+ !!\]$/); assert.ok(s.includes('[X]'), '자리 표시를 채움');
    assert.equal(t('common.intl_locale'), 'en-US');
    assert.equal(t('messenger.alias.allow'), loadDict('en')['messenger.alias.allow']);
    assert.equal(pseudoText('{n} files'), '[!! {n} files~~ !!]');
  } finally { if (before === undefined) delete process.env.IEON_PSEUDO_LOCALE; else process.env.IEON_PSEUDO_LOCALE = before; }
});

test('영어 소개 영상: 장면이 한국어판과 같은 순서·같은 수, 화면 글 L(…)은 모두 영어 표에 있음', () => {
  assert.deepEqual(EN.map((s) => s.id), KO.map((s) => s.id));
  for (const s of EN) assert.ok(s.say && !/[가-힣]/.test(s.say), s.id);
  const html = readFileSync(new URL('../../tools/video/intro.html', import.meta.url), 'utf8');
  const keys = [...new Set([...html.matchAll(/L\((['"])((?:\\.|(?!\1).)*)\1\)/g)].map((m) => Function(`return ${m[1]}${m[2]}${m[1]}`)()))];
  const ctx = { window: {} }; vm.runInNewContext(readFileSync(new URL('../../tools/video/intro-text.en.js', import.meta.url), 'utf8'), ctx);
  const missing = keys.filter((k) => !(k in ctx.window.__TEXT) && k !== '<b>이</b>'); // 로고 글자는 앱 아이콘과 같게 그대로
  assert.deepEqual(missing, []);
  for (const v of Object.values(ctx.window.__TEXT)) assert.ok(!/[가-힣]/.test(v), v);
  assert.match(html, /document\.write\('<script src="intro-text\.' \+ window\.__LANG \+ '\.js"><\\\/script>'\)/, '글 표를 불러오는 줄이 스크립트를 끊지 않음');
});
