// I18N-b-1b: 봇마다 답 언어, 서버가 만드는 글을 보는 사람 언어로(글 + 키·값). 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { createBridge, botT } from '../../src/pilot/messenger/bridge.mjs';
import { kakaoBody } from '../../src/pilot/messenger/kakao.mjs';
import { modeEffects } from '../../src/pilot/mode.mjs';
import { blockLevel } from '../../src/pilot/workspaces.mjs';
import { scheduleWhen, describeSchedule } from '../../src/pilot/schedules.mjs';
import { makeT, loadDict } from '../../src/i18n/index.mjs';
import { koView } from './web-page.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const HANGUL = /[가-힣]/;
const TID = '01a18790-63c7-73e3-a60b-6ddb60fd5be8';

async function server(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-vw-'));
  const app = createApp({ dbPath: join(dir, 'p.db'), devices: [{ tokenSha256: sha('d'), hostId: 'h_pc' }],
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }],
    bindings: [{ conversationId: 'c_codex', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: TID }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = async (path, { method = 'GET', body, bearer = 'web' } = {}) => {
    const r = await fetch(base + path, { method, body: body && JSON.stringify(body), headers: { 'content-type': 'application/json', origin: base, authorization: `Bearer ${bearer}` } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { app, call };
}

test('봇마다 답 언어: 저장·되돌리기(빈 값 = 서버 언어), 없는 언어는 거절, 다른 칸만 바꿀 때는 그대로, 메신저가 받음', async (t) => {
  const { call } = await server(t);
  const put = (body) => call('/v1/admin/bots/telegram/default', { method: 'PUT', body: { name: 'Bot', callNames: [], ...body } });
  assert.equal((await put({ lang: 'xx' })).body.error, 'bad_lang');
  assert.equal((await put({ lang: 'en-GB' })).body.lang, 'en');
  assert.equal((await put({ name: 'Bot 2' })).body.lang, 'en', '언어를 안 보내면 그대로');
  const bots = (await call('/v1/messenger/bots', { bearer: 'msg' })).body.bots;
  assert.equal(bots.find((b) => b.platform === 'telegram' && b.botId === 'default').lang, 'en');
  assert.equal((await put({ lang: null })).body.lang, null, '비우면 서버 언어를 따름');
});

test('봇 언어는 그때그때 정함: 웹에서 바꾸면 메신저를 다시 켜지 않아도 다음 답부터 그 언어', async () => {
  let lang = null;
  const said = [];
  const dir = mkdtempSync(join(tmpdir(), 'ieon-vw-'));
  const bridge = createBridge({ api: async () => ({ status: 200, body: { conversations: [] } }), allowedUsers: { telegram: ['1'] }, roomsPath: join(dir, 'r.json'), lang: () => lang });
  const say = (text) => bridge.handle({ platform: 'telegram', userId: '1', chatId: '1', text }, async (s) => { said.push(s); });
  await say('/sessions'); assert.ok(HANGUL.test(said.at(-1)));
  lang = 'en'; await say('/sessions'); assert.ok(!HANGUL.test(said.at(-1)), said.at(-1));
  rmSync(dir, { recursive: true, force: true });
  assert.equal(botT('en')('messenger.kakao.cut'), loadDict('en')['messenger.kakao.cut']);
  const long = 'x'.repeat(5000);
  assert.ok(kakaoBody(long, makeT('en')).template.outputs.at(-1).simpleText.text.endsWith(loadDict('en')['messenger.kakao.cut']), '카카오 줄임 안내도 봇 언어');
});

test('계정 이름표: 글(서버 언어)과 키·값을 같이 보내고, 화면·봇은 키가 있으면 보는 사람 언어로', async (t) => {
  const { call } = await server(t);
  const a = (await call('/v1/conversations')).body.conversations.find((c) => c.conversationId === 'c_codex').account;
  assert.equal(a.labelKey, 'server.account.pc_codex');
  assert.equal(a.label, makeT('ko')(a.labelKey));
  assert.ok(!HANGUL.test(makeT('en')(a.labelKey, a.labelVars)));
  const app = koView('app.html');
  assert.ok(app.includes('tFrom(c.account.label, c.account.labelKey, c.account.labelVars)'), '대화 화면은 키로 다시 바꿈');
});

test('사용 방식 안내·작업 폴더 막는 정도·예약 시각도 키를 같이(화면이 보는 사람 언어로)', () => {
  const e = modeEffects('pc', 'hub');
  assert.equal(e.off.length, e.offKeys.length); assert.equal(e.on.length, e.onKeys.length);
  for (const k of [...e.offKeys, ...e.onKeys]) assert.ok(loadDict('en')[k], k);
  for (const lv of [blockLevel('claude_cli'), blockLevel('codex_thread', { newSession: true, full: true }), blockLevel('agy_cli'), blockLevel('x')]) {
    assert.equal(lv.writeText, makeT('ko')(lv.writeKey)); assert.equal(lv.readText, makeT('ko')(lv.readKey));
  }
  assert.deepEqual(scheduleWhen({ kind: 'daily', spec: { time: '09:00' } }), { whenKey: 'server.sched.daily', whenVars: { time: '09:00' } });
  assert.equal(makeT('en')('server.sched.hours', scheduleWhen({ kind: 'interval', spec: { minutes: 120 } }).whenVars).includes('2'), true);
  const once = scheduleWhen({ kind: 'once', spec: { at: '2026-11-21T00:00:00.000Z' }, tz: 'Asia/Seoul' });
  assert.equal(once.whenKey, 'server.sched.once'); assert.equal(once.whenTz, 'Asia/Seoul');
  assert.ok(describeSchedule({ kind: 'daily', spec: { time: '09:00' } }).includes('09:00'));
  const set = koView('settings.html');
  assert.ok(set.includes('tFrom(lv.writeText, lv.writeKey)') && set.includes('const whenText = (s) =>') && set.includes("e.offKeys ? e.offKeys.map((k) => t(k))"));
});
