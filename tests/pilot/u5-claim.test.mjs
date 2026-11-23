// U5(UD3): 메신저 주인 등록 숫자 — 6자리·1회용·만료·틀린 시도 5번 잠금, 메신저에서 숫자를 보내면 허용(모델 0, 실제 메신저 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';
import { createBotRunner } from '../../src/pilot/messenger/runner.mjs';
import { koView } from './web-page.mjs'; // I18N-a: 문구를 사전으로 옮긴 화면을 한국어 코드 모양으로 펼쳐 읽음

const sha = (s) => createHash('sha256').update(s).digest('hex');
const APP = koView('app.html');

async function server(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-u5-'));
  const app = createApp({ dbPath: join(dir, 'pilot.db'), devices: [], bindings: [],
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }], ...extra });
  const port = await app.listen(0);
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = (path, { method = 'GET', body, token = 'web' } = {}) => fetch(`http://127.0.0.1:${port}${path}`, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));
  const extraUsers = async () => (await call('/v1/admin/bots')).body.bots.find((b) => b.platform === 'telegram' && b.botId === 'default').extraUsers;
  const claim = (code, userId = '777') => call('/v1/messenger/claim', { method: 'POST', token: 'msg', body: { platform: 'telegram', botId: 'default', userId, name: '신산', code } });
  return { call, extraUsers, claim };
}

test('숫자를 받아 메신저에서 보내면 그 사람이 허용되고, 같은 숫자는 다시 못 쓴다', async (t) => {
  const s = await server(t);
  const r = await s.call('/v1/admin/messenger/claim', { method: 'POST', body: { platform: 'telegram', botId: 'default' } });
  assert.equal(r.status, 200); assert.match(r.body.code, /^\d{6}$/);
  assert.equal((await s.call('/v1/admin/messenger/claim?platform=telegram&botId=default')).body.state, 'waiting');
  const wrong = String((Number(r.body.code) + 1) % 1000000).padStart(6, '0');
  assert.equal((await s.claim(wrong)).body.error, 'wrong_code');
  assert.ok(!(await s.extraUsers()).includes('777'));
  assert.equal((await s.claim(r.body.code)).status, 200);
  assert.ok((await s.extraUsers()).includes('777'));
  assert.deepEqual((await s.call('/v1/admin/messenger/claim?platform=telegram&botId=default')).body, { state: 'claimed', name: '신산' });
  assert.equal((await s.claim(r.body.code, '888')).body.error, 'no_claim', '1회용');
  assert.ok(!(await s.extraUsers()).includes('888'));
});

test('틀린 숫자 5번이면 잠기고, 그 뒤에는 맞는 숫자도 안 된다', async (t) => {
  const s = await server(t);
  const { code } = (await s.call('/v1/admin/messenger/claim', { method: 'POST', body: { platform: 'telegram' } })).body;
  const wrong = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 4; i += 1) assert.equal((await s.claim(wrong)).body.error, 'wrong_code');
  assert.equal((await s.claim(wrong)).body.error, 'claim_locked');
  assert.equal((await s.claim(code)).body.error, 'no_claim');
  assert.equal((await s.call('/v1/admin/messenger/claim?platform=telegram&botId=default')).body.state, 'locked');
  assert.ok(!(await s.extraUsers()).includes('777'));
});

test('만료된 숫자는 안 되고, 웹 앱은 메신저 확인 API를 부를 수 없다', async (t) => {
  const s = await server(t, { claimMs: 30 });
  const { code } = (await s.call('/v1/admin/messenger/claim', { method: 'POST', body: { platform: 'telegram' } })).body;
  await new Promise((ok) => setTimeout(ok, 60));
  assert.equal((await s.call('/v1/admin/messenger/claim?platform=telegram&botId=default')).body.state, 'expired');
  assert.equal((await s.claim(code)).body.error, 'no_claim');
  assert.equal((await s.call('/v1/messenger/claim', { method: 'POST', body: { platform: 'telegram', botId: 'default', userId: '1', code } })).status, 403);
  assert.equal((await s.call('/v1/admin/messenger/claim', { method: 'POST', token: 'msg', body: { platform: 'telegram' } })).status, 403, '메신저는 숫자를 만들 수 없음');
});

test('메신저: 허용되지 않은 사람이 6자리 숫자를 보낼 때만 확인하고, 맞으면 주인 등록 안내', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-u5r-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const state = { extraUsers: [], claims: [], logs: [] };
  const api = async (req) => {
    if (req.path === '/v1/messenger/bots') return { status: 200, body: { bots: [{ platform: 'telegram', botId: 'default', name: '기본', callNames: [], extraUsers: state.extraUsers, enabled: true }] } };
    if (req.path === '/v1/messenger/config') return { status: 200, body: {} };
    if (req.path === '/v1/messenger/claim') { state.claims.push(req.body.code); if (req.body.code === '246810') { state.extraUsers = [req.body.userId]; return { status: 200, body: { claimed: true } }; } return { status: 403, body: { error: 'wrong_code' } }; }
    return { status: 200, body: {} };
  };
  let onMessage;
  const runner = createBotRunner({ api, apiFor: () => api, env: { TELEGRAM_BOT_TOKEN: 'tok' }, roomsPath: join(d, 'rooms.json'), allowRefreshMs: 0,
    log: (e) => state.logs.push(e), runners: { telegram: (o) => { onMessage = o.onMessage; } } });
  await runner.sync(); t.after(() => runner.stopAll());
  const say = async (text, userId = 'u9') => { const out = []; await onMessage({ platform: 'telegram', userId, chatId: 'c', text }, async (x) => { out.push(x); }); return out.join('\n'); };
  assert.equal(await say('안녕'), '', '숫자가 아니면 확인하지 않고 조용히');
  assert.deepEqual(state.claims, []);
  assert.match(await say('111111'), /맞지 않아요/);
  assert.match(await say(' 246810 '), /주인으로 등록됐어요/);
  assert.match(await say('/whoami'), /허용됨/, '등록 뒤 바로 허용');
  assert.deepEqual(state.claims, ['111111', '246810']);
  assert.ok(!JSON.stringify(state.logs).includes('246810') && !JSON.stringify(state.logs).includes('111111'), '숫자는 기록하지 않음');
});

test('이미 허용된 사람(주인)이 숫자를 보내면: 틀려도 잠금 횟수에 안 들어가고, 맞으면 허용 목록은 그대로 완료만', async (t) => {
  const s = await server(t);
  const { code } = (await s.call('/v1/admin/messenger/claim', { method: 'POST', body: { platform: 'telegram' } })).body;
  const wrong = code === '123456' ? '654321' : '123456';
  const owner = (c) => s.call('/v1/messenger/claim', { method: 'POST', token: 'msg', body: { platform: 'telegram', botId: 'default', userId: '555', name: '신산', code: c, allowed: true } });
  for (let i = 0; i < 6; i += 1) assert.equal((await owner(wrong)).body.error, 'wrong_code');
  assert.equal((await s.call('/v1/admin/messenger/claim?platform=telegram&botId=default')).body.state, 'waiting');
  assert.deepEqual((await owner(code)).body, { claimed: true, already: true });
  assert.ok(!(await s.extraUsers()).includes('555'), '허용 목록은 바꾸지 않음');
  assert.deepEqual((await s.call('/v1/admin/messenger/claim?platform=telegram&botId=default')).body, { state: 'claimed', name: '신산' });
});

test('메신저: 허용된 사람이 보낸 숫자는 질문으로 대화에 들어가지 않고, 기다리는 숫자가 없을 때만 일반 글', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-u5o-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const state = { claims: [], paths: [] };
  const api = async (req) => {
    state.paths.push(req.path);
    if (req.path === '/v1/messenger/bots') return { status: 200, body: { bots: [{ platform: 'telegram', botId: 'default', name: '기본', callNames: [], extraUsers: ['u1'], enabled: true }] } };
    if (req.path === '/v1/messenger/config') return { status: 200, body: {} };
    if (req.path === '/v1/messenger/claim') { state.claims.push({ code: req.body.code, allowed: req.body.allowed }); return req.body.code === '246810' ? { status: 200, body: { claimed: true, already: true } } : { status: 404, body: { error: 'no_claim' } }; }
    return { status: 200, body: { conversations: [] } };
  };
  let onMessage;
  const runner = createBotRunner({ api, apiFor: () => api, env: { TELEGRAM_BOT_TOKEN: 'tok' }, roomsPath: join(d, 'rooms.json'), allowRefreshMs: 0,
    log: () => {}, runners: { telegram: (o) => { onMessage = o.onMessage; } } });
  await runner.sync(); t.after(() => runner.stopAll());
  const say = async (text) => { const out = []; await onMessage({ platform: 'telegram', userId: 'u1', chatId: 'c', text }, async (x) => { out.push(x); }); return out.join('\n'); };
  state.paths = [];
  assert.match(await say('246810'), /이미 허용된 분/);
  assert.deepEqual(state.paths, ['/v1/messenger/claim'], '숫자는 대화(질문)로 가지 않음');
  assert.deepEqual(state.claims, [{ code: '246810', allowed: true }]);
  state.paths = [];
  await say('135790');
  assert.ok(state.paths.length > 1, '기다리는 숫자가 없으면 일반 글로 처리');
});

test('화면: 메신저 연결 창 — 토큰 칸·카카오 스킬 URL·숫자 보내기·완료', () => {
  for (const id of ['id="msg"', 'id="m1"', 'id="m2"', 'id="m3"', 'id="m4"', 'id="msgBtn"']) assert.ok(APP.includes(id), id);
  assert.ok(APP.includes("'/v1/admin/messenger/claim'") && APP.includes("'/v1/admin/secrets/' + inp.dataset.name") && APP.includes("'/v1/admin/kakao/skill-url'"));
  assert.ok(APP.includes("$('sMsg').onclick = () => openMsg();"), '처음 설정 3단계에서도 연다');
  assert.ok(APP.includes('btnEl.disabled = Boolean(off);'), '꺼 둔 봇(허브로 옮긴 봇)만 고를 수 없음 — 쓸 수 없음은 눌러서 이유');
});