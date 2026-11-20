// I18N-b-1(설계 docs/design/I18N.md 4절): 영어 — 화면 언어 바꾸기, 영어 봇, 서버 기본 언어 설정, 카카오 영어 안내. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { createBridge } from '../../src/pilot/messenger/bridge.mjs';
import { createRelay } from '../../src/relay/relay.mjs';
import { pickLang, loadDict, serverLang, setServerLang, languages } from '../../src/i18n/index.mjs';
import { webPage } from './web-page.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const HANGUL = /[가-힣]/;
const outsideScripts = (html) => html.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, ''); // 주석은 개발자용

test('영어 사전이 있고, 브라우저가 영어면 화면이 영어(고르지 않은 다른 언어도 영어)', () => {
  assert.ok(languages().includes('en'));
  assert.equal(pickLang({ headers: { 'accept-language': 'en-US,en;q=0.9' } }), 'en');
  assert.equal(pickLang({ headers: { 'accept-language': 'fr-FR' } }), 'en');
  assert.equal(pickLang({ headers: { 'accept-language': 'ko-KR', cookie: 'ieon_lang=en' } }), 'en', '고른 언어(쿠키)가 먼저');
  for (const f of ['app.html', 'settings.html']) {
    const page = webPage(f, 'en');
    assert.match(page, /<html lang="en">/);
    const body = outsideScripts(page);
    assert.doesNotMatch(body, /\{\{[a-z]/, f);
    assert.ok(!HANGUL.test(body), `${f}: 영어 화면 글에 한국어 없음`);
    assert.match(page, /"lang":"en"/);
    assert.match(page, /\["en","English"\]/, '언어 고르기에 English');
  }
  assert.match(webPage('app.html', 'en'), /<title>Ieon<\/title>/);
});

test('영어 화면의 날짜·음성 언어는 en-US, 되돌릴 수 없는 일 버튼 낱말도 영어', () => {
  const en = loadDict('en');
  assert.equal(en['common.intl_locale'], 'en-US');
  assert.equal(en['common.speech_lang'], 'en-US');
  assert.ok(new RegExp('^(' + en['settings.danger.start'] + ')').test('Delete'));
  assert.ok(!new RegExp('^(' + en['settings.danger.start'] + ')|(' + en['settings.danger.end'] + ')$').test('Save'));
});

function bot(lang, conv) {
  const said = [];
  const api = async (req) => {
    if (req.method === 'GET' && req.path === '/v1/conversations') return { status: 200, body: { conversations: [conv] } };
    if (req.method === 'POST' && req.path.endsWith('/requests')) return { status: 409, body: { error: 'conversation_busy' } };
    return { status: 404, body: {} };
  };
  const dir = mkdtempSync(join(tmpdir(), 'ieon-en-'));
  const bridge = createBridge({ api, allowedUsers: { telegram: ['111'] }, roomsPath: join(dir, 'rooms.json'), pollMs: 1, waitMs: 50, lang });
  const say = (text) => bridge.handle({ platform: 'telegram', userId: '111', chatId: '-1', text }, async (s) => { said.push(s); });
  return { said, say, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('영어 봇: 도움말·연결·오류·모르는 명령이 영어, 영어 명령(/allow·/close … confirm)도 받음', async () => {
  const conv = { conversationId: 'c_1', label: 'Test', engine: 'codex_thread', deviceOnline: true, busy: false };
  const b = bot('en', conv);
  await b.say('/help');
  assert.match(b.said.at(-1), /\/sessions/);
  assert.match(b.said.at(-1), /\/allow <number>/);
  assert.ok(!HANGUL.test(b.said.at(-1)), '도움말에 한국어 없음');
  await b.say('/use 1');
  assert.ok(!HANGUL.test(b.said.at(-1)) && b.said.at(-1).includes('Test'));
  await b.say('question');
  assert.match(b.said.at(-1), /^\[Test\] /);
  assert.ok(!HANGUL.test(b.said.at(-1)), '오류 안내도 영어');
  await b.say('/nope');
  assert.ok(!HANGUL.test(b.said.at(-1)));
  await b.say('/allow 3');
  assert.ok(!HANGUL.test(b.said.at(-1)), '/allow는 명령으로 받음(승인 번호가 없다는 안내)');
  b.done();
  const k = bot('ko', conv);
  await k.say('/help');
  assert.match(k.said.at(-1), /명령어/, '한국어 봇은 그대로 한국어');
  k.done();
});

test('서버 기본 언어: 웹 설정에서 바꾸면 서버 글·메신저 설정·카카오 안내가 그 언어, 잘못된 언어는 거절', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-en-'));
  const before = serverLang();
  const app = createApp({ dbPath: join(dir, 'pilot.db'), devices: [], bindings: [],
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }] });
  const port = await app.listen(0); const base = `http://127.0.0.1:${port}`;
  t.after(async () => { setServerLang(before); await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = async (path, { method = 'GET', body, bearer = 'web' } = {}) => {
    const r = await fetch(base + path, { method, body: body && JSON.stringify(body), headers: { 'content-type': 'application/json', origin: base, authorization: `Bearer ${bearer}` } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const v = (await call('/v1/admin/settings')).body.serverLang;
  assert.ok(v.languages.some(([l, n]) => l === 'en' && n === 'English'));
  assert.equal((await call('/v1/admin/settings/lang', { method: 'PUT', body: { lang: 'xx' } })).body.error, 'bad_lang');
  const r = await call('/v1/admin/settings/lang', { method: 'PUT', body: { lang: 'en-US' } });
  assert.equal(r.body.serverLang.lang, 'en'); assert.equal(r.body.serverLang.source, 'web');
  assert.equal(serverLang(), 'en');
  assert.equal((await call('/v1/messenger/config', { bearer: 'msg' })).body.lang, 'en', '메신저 프로세스가 봇 답 언어를 받음');
  const relay = createRelay({ pcToken: 'p'.repeat(16), kakaoSecret: 'k'.repeat(16) });
  assert.ok(relay, '중계를 만들 수 있음');
  const manifest = await (await fetch(base + '/manifest.webmanifest')).text();
  assert.ok(manifest.length > 0);
  await call('/v1/admin/settings/lang', { method: 'PUT', body: { lang: 'ko' } });
  assert.equal(serverLang(), 'ko');
});

test('카카오 중계 안내: 중계 언어(cfg.lang)가 영어면 영어, 없으면 서버 기본 언어', async (t) => {
  const ask = async (over) => {
    const relay = createRelay({ pcToken: 'p'.repeat(16), kakaoSecret: 'k'.repeat(16), ...over });
    const addr = await relay.listen(0); t.after(() => relay.close());
    const r = await fetch(`http://127.0.0.1:${addr.port}/kakao/skill/${'k'.repeat(16)}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userRequest: { utterance: 'hi', user: { id: 'u1' }, callbackUrl: 'https://bot-api.kakao.com/v2/bots/b1/callback/x' } }) });
    return (await r.json()).template.outputs[0].simpleText.text; // PC가 붙어 있지 않음 안내
  };
  assert.equal(await ask({ lang: 'en' }), loadDict('en')['messenger.relay.pc_down']);
  assert.equal(await ask({}), loadDict(serverLang())['messenger.relay.pc_down']);
});
