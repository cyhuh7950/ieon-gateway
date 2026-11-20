// L1 라인: 중계·허브 내장 중계의 라인 webhook(메신저별 대기열), 실행기의 서명 확인·1:1만·답장 표/보내기·중복 무시·기록에 원문 없음.
// 모델 0, 실제 라인 서버 0(가짜 fetch).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';
import { createRelay } from '../../src/relay/relay.mjs';
import { lineSignatureOk, runLine, RECEIVED, ONLY_DIRECT } from '../../src/pilot/messenger/line.mjs';
import { tokenEnvNames } from '../../src/pilot/bots.mjs';
import { koView } from './web-page.mjs'; // I18N-a: 문구를 사전으로 옮긴 화면을 한국어 코드 모양으로 펼쳐 읽음

const PC = 'line-relay-pc-token-0123456789';
const SECRET = 'line-kakao-secret-0123456789abcdef';
const CH_SECRET = 'line-channel-secret-abcdef';
const sign = (raw, s = CH_SECRET) => createHmac('sha256', s).update(raw).digest('base64');
const body = (events) => JSON.stringify({ destination: 'Ubot', events });
const textEv = (text, { id = 'ev1', user = 'U1234', type = 'user', token = 'rt1' } = {}) => ({ type: 'message', webhookEventId: id, replyToken: token,
  source: type === 'user' ? { type: 'user', userId: user } : { type, groupId: 'G1', userId: user }, message: { type: 'text', id: 'm1', text } });

test('중계: 라인 webhook은 비밀 경로·서명 헤더가 있어야 받고, 라인 몫은 ?channel=line으로만 나가며 카카오 실행기는 가져가지 않는다', async (t) => {
  const r = createRelay({ pcToken: PC, kakaoSecret: SECRET, log: () => {} });
  const addr = await r.listen(0);
  t.after(() => r.close());
  const base = `http://127.0.0.1:${addr.port}`;
  const raw = body([textEv('안녕')]);
  const hook = (secret, sig) => fetch(`${base}/line/webhook/${secret}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'x-line-signature': sig } : {}) }, body: raw });
  assert.equal((await hook('wrong-secret-xxxxxxxxxxxxxxxxxx', sign(raw))).status, 404);
  assert.equal((await hook(SECRET)).status, 401, '서명 헤더 없음');
  assert.equal((await hook(SECRET, sign(raw))).status, 200, 'PC가 안 붙어 있어도 라인에는 200');
  assert.equal(r.depth('line'), 0, 'PC가 없으면 맡아 두지 않음');
  const auth = { authorization: `Bearer ${PC}` };
  assert.equal((await fetch(`${base}/pc/poll?channel=wechat`, { headers: auth })).status, 400);
  const kakaoPoll = fetch(`${base}/pc/poll`, { headers: auth }).then((x) => x.json()); // 카카오 실행기(예전 방식)
  const linePoll = fetch(`${base}/pc/poll?channel=line`, { headers: auth }).then((x) => x.json());
  await new Promise((s) => setTimeout(s, 80));
  assert.equal((await hook(SECRET, sign(raw))).status, 200);
  const got = (await linePoll).items;
  assert.equal(got.length, 1);
  assert.equal(got[0].raw, raw, '본문 그대로(서명 확인용)');
  assert.equal(got[0].signature, sign(raw));
  await r.close();
  assert.deepEqual((await kakaoPoll).items, [], '카카오 실행기는 라인 몫을 가져가지 않음');
});

test('중계: 라인 몫이 이미 쌓여 있을 때 카카오 실행기가 와도 가져가지 않고, 라인 실행기만 가져간다', async (t) => {
  const r = createRelay({ pcToken: PC, kakaoSecret: SECRET, pollWaitMs: 60, log: () => {} });
  const addr = await r.listen(0);
  t.after(() => r.close());
  const base = `http://127.0.0.1:${addr.port}`;
  const auth = { authorization: `Bearer ${PC}` };
  const poll = (q = '') => fetch(`${base}/pc/poll${q}`, { headers: auth }).then((x) => x.json());
  await poll(); // PC가 붙어 있음(마지막 폴링 시각)
  const raw = body([textEv('쌓인 글')]);
  assert.equal((await fetch(`${base}/line/webhook/${SECRET}`, { method: 'POST', headers: { 'x-line-signature': sign(raw) }, body: raw })).status, 200);
  assert.equal(r.depth('line'), 1);
  assert.deepEqual((await poll()).items, [], '카카오 실행기(채널 없음)는 빈손');
  const got = (await poll('?channel=line')).items;
  assert.equal(got.length, 1);
  assert.equal(r.depth('line'), 0, '가져가면 지움');
});

test('허브: 라인 webhook은 접속 제한 예외로 내장 중계가 받고, webhook 주소는 같은 비밀 경로로 만든다. PC에 중계가 없으면 주소 없음', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-l1-'));
  const webUsers = [{ tokenSha256: createHash('sha256').update('web').digest('hex'), userId: 'u_sinsan', appId: 'app_web' }];
  const hub = createApp({ dbPath: join(dir, 'hub.db'), users: webUsers, devices: [], bindings: [], relay: { pcToken: PC, kakaoSecret: SECRET },
    webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'] } });
  const pc = createApp({ dbPath: join(dir, 'pc.db'), users: webUsers, devices: [], bindings: [] });
  const hubBase = `http://127.0.0.1:${await hub.listen(0)}`; const pcBase = `http://127.0.0.1:${await pc.listen(0)}`;
  t.after(async () => { await hub.close(); await pc.close(); rmSync(dir, { recursive: true, force: true }); });
  const raw = body([textEv('안녕')]);
  const r = await fetch(`${hubBase}/line/webhook/${SECRET}`, { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.7', 'x-line-signature': sign(raw) }, body: raw });
  assert.equal(r.status, 200, '허용 IP 밖에서도(라인 서버) 받음');
  const url = await fetch(`${hubBase}/v1/admin/line/webhook-url`, { headers: { authorization: 'Bearer web', 'x-forwarded-for': '198.51.100.9', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'hub.example' } }).then((x) => x.json());
  assert.equal(url.url, `https://hub.example/line/webhook/${SECRET}`);
  assert.equal((await fetch(`${pcBase}/v1/admin/line/webhook-url`, { headers: { authorization: 'Bearer web' } })).status, 404);
  // 라인 기본 봇과 토큰 이름
  const bots = await fetch(`${hubBase}/v1/admin/bots`, { headers: { authorization: 'Bearer web', 'x-forwarded-for': '198.51.100.9' } }).then((x) => x.json());
  assert.ok(bots.bots.some((b) => b.platform === 'line' && b.botId === 'default'));
  assert.deepEqual(tokenEnvNames('line', 'default'), { accessToken: 'LINE_CHANNEL_ACCESS_TOKEN', channelSecret: 'LINE_CHANNEL_SECRET' });
  assert.deepEqual(tokenEnvNames('line', 'sales-1'), { accessToken: 'LINE_BOT_SALES_1_ACCESS_TOKEN', channelSecret: 'LINE_BOT_SALES_1_CHANNEL_SECRET' });
});

test('서명 확인: 채널 비밀 값으로 만든 서명만 맞다', () => {
  const raw = body([textEv('x')]);
  assert.equal(lineSignatureOk(raw, sign(raw), CH_SECRET), true);
  assert.equal(lineSignatureOk(raw, sign(raw, 'other-secret'), CH_SECRET), false);
  assert.equal(lineSignatureOk(raw + ' ', sign(raw), CH_SECRET), false, '본문이 한 글자라도 다르면');
  assert.equal(lineSignatureOk(raw, 'short', CH_SECRET), false);
  assert.equal(lineSignatureOk(raw, '', CH_SECRET), false);
});

// 가짜 중계·가짜 라인 서버로 실행기를 돌린다. items를 한 번 주고, 그다음 폴링은 멈출 때까지 기다린다.
function harness(t, items, onMessage, opts = {}) {
  const calls = []; const logs = []; const ac = new AbortController();
  let served = false;
  const fetchImpl = async (url, init = {}) => {
    if (url.includes('/pc/poll')) {
      if (!served) { served = true; return { ok: true, status: 200, json: async () => ({ items }) }; }
      return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    if (url.endsWith('/v2/bot/info')) return { ok: true, status: 200, json: async () => ({ displayName: '이어온', basicId: '@ieon' }) };
    calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body), auth: init.headers.authorization });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  runLine({ relayUrl: 'http://relay', relayToken: PC, accessToken: 'line-access-token-xyz', channelSecret: CH_SECRET, onMessage, log: (e) => logs.push(e), signal: ac.signal, fetchImpl, flushMs: 5, ...opts });
  t.after(() => ac.abort());
  const until = async (pred, ms = 2000) => { const s = Date.now(); while (!pred()) { if (Date.now() - s > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };
  return { calls, logs, until };
}
const item = (events, sig) => { const raw = body(events); return { id: 'l1', channel: 'line', raw, signature: sig ?? sign(raw) }; };

test('실행기: 빨리 온 답은 답장 표로(무료), 같은 이벤트는 한 번만, 기록에 질문·답·토큰 없음', async (t) => {
  const seen = [];
  const h = harness(t, [item([textEv('안녕하세요'), textEv('안녕하세요', { id: 'ev1' })])], async (m, send) => { seen.push(m); await send('접수됨 — 답을 기다리는 중'); await send('답입니다'); });
  await h.until(() => h.calls.length >= 1);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(seen.length, 1, '같은 webhookEventId는 한 번만');
  assert.deepEqual({ platform: seen[0].platform, userId: seen[0].userId, isGroup: seen[0].isGroup, text: seen[0].text }, { platform: 'line', userId: 'U1234', isGroup: false, text: '안녕하세요' });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0], { path: '/v2/bot/message/reply', body: { replyToken: 'rt1', messages: [{ type: 'text', text: '답입니다' }] }, auth: 'Bearer line-access-token-xyz' });
  assert.ok(h.logs.some((e) => e.event === 'started' && e.bot === '이어온 (@ieon)'));
  const logText = JSON.stringify(h.logs);
  for (const s of ['안녕하세요', '답입니다', 'line-access-token-xyz', CH_SECRET]) assert.ok(!logText.includes(s), s);
});

test('실행기: 답이 늦으면 답장 표로 "받았어요"를 먼저 보내고, 실제 답은 보내기(push)로', async (t) => {
  const h = harness(t, [item([textEv('긴 질문', { id: 'ev2', token: 'rt2' })])], async (m, send) => { await new Promise((r) => setTimeout(r, 150)); await send('늦은 답'); }, { replyWaitMs: 40 });
  await h.until(() => h.calls.length >= 2);
  assert.deepEqual(h.calls.map((c) => c.path), ['/v2/bot/message/reply', '/v2/bot/message/push']);
  assert.deepEqual(h.calls[0].body.messages, [{ type: 'text', text: RECEIVED }]);
  assert.deepEqual(h.calls[1].body, { to: 'U1234', messages: [{ type: 'text', text: '늦은 답' }] });
});

test('실행기: 서명이 틀리면 버리고, 그룹·여러 사람 방은 안내만(1:1부터)', async (t) => {
  let called = 0;
  const bad = item([textEv('가짜')], sign('다른 본문'));
  const group = item([textEv('그룹에서', { id: 'ev3', type: 'group', token: 'rt3' })]);
  const h = harness(t, [bad, group], async () => { called += 1; });
  await h.until(() => h.calls.length >= 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(called, 0);
  assert.ok(h.logs.some((e) => e.event === 'signature_bad'));
  assert.deepEqual(h.calls[0].body, { replyToken: 'rt3', messages: [{ type: 'text', text: ONLY_DIRECT }] });
});

test('화면: 메신저 창에 라인(2칸·webhook 주소 복사), 설정 화면에 라인 봇 추가', () => {
  const web = (f) => readFileSync(fileURLToPath(new URL(`../../src/pilot/web/${f}`, import.meta.url)), 'utf8');
  const APP = koView('app.html'); const SET = web('settings.html');
  assert.ok(APP.includes("line: { name: '라인'") && APP.includes("LINE_CHANNEL_ACCESS_TOKEN: '채널 액세스 토큰', LINE_CHANNEL_SECRET: '채널 시크릿'"));
  assert.ok(APP.includes("api('/v1/admin/line/webhook-url')"));
  assert.ok(SET.includes('<option value="line">라인</option>'));
});