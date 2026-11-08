// 봇을 끄면 연결을 닫고, 같은 봇이 다른 곳에도 켜져 있으면 "연결됨"이 아니라 충돌로 보고한다(실제 메신저 없이, 모델 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDiscord, runSlack, runTelegram } from '../../src/pilot/messenger/platforms.mjs';
import { createBotRunner } from '../../src/pilot/messenger/runner.mjs';

class FakeSocket {
  static all = [];
  closed = false;
  constructor(url) { this.url = url; FakeSocket.all.push(this); }
  send() {}
  close() { if (this.closed) return; this.closed = true; this.onclose?.({ code: 1000 }); }
  emit(data) { this.onmessage({ data: JSON.stringify(data) }); }
}
const tick = (ms = 15) => new Promise((ok) => setTimeout(ok, ms));

function stubs(t, fetchImpl) {
  const original = { ws: globalThis.WebSocket, fetch: globalThis.fetch };
  FakeSocket.all = [];
  globalThis.WebSocket = FakeSocket;
  globalThis.fetch = fetchImpl;
  t.after(() => { globalThis.WebSocket = original.ws; globalThis.fetch = original.fetch; });
}
const reply = (body) => ({ ok: true, json: async () => body });
const slackFetch = async (url) => reply(String(url).includes('apps.connections.open') ? { ok: true, url: 'wss://slack.test' } : { ok: true, user: 'b', team: 't', user_id: 'U1' });

test('디스코드: 봇을 끄면 연결을 닫고 다시 붙지 않는다', async (t) => {
  stubs(t, slackFetch);
  const ac = new AbortController();
  runDiscord({ token: 'x', onMessage: async () => {}, log: () => {}, signal: ac.signal });
  assert.equal(FakeSocket.all.length, 1);
  ac.abort();
  assert.equal(FakeSocket.all[0].closed, true);
  await tick(2100 + 50); // 다시 붙는 대기(2초)가 지나도
  assert.equal(FakeSocket.all.length, 1);
});

test('슬랙: 봇을 끄면 연결을 닫는다', async (t) => {
  stubs(t, slackFetch);
  const ac = new AbortController();
  runSlack({ appToken: 'a', botToken: 'b', onMessage: async () => {}, log: () => {}, signal: ac.signal });
  await tick();
  assert.equal(FakeSocket.all.length, 1);
  ac.abort();
  assert.equal(FakeSocket.all[0].closed, true);
  await tick(2100 + 50);
  assert.equal(FakeSocket.all.length, 1);
});

test('슬랙: 연결이 둘 이상이면 충돌, 다시 접속해 하나면 해제', async (t) => {
  stubs(t, slackFetch);
  const ac = new AbortController();
  t.after(() => ac.abort());
  const events = [];
  runSlack({ appToken: 'a', botToken: 'b', onMessage: async () => {}, log: (e) => events.push(e), signal: ac.signal, recheckMs: 5 });
  await tick();
  FakeSocket.all[0].emit({ type: 'hello', num_connections: 2 });
  assert.ok(events.some((e) => e.event === 'conflict' && e.connections === 2));
  await tick(30);
  assert.equal(FakeSocket.all[0].closed, true, '겹친 동안에는 끊고 다시 확인한다');
  await tick(4100); // 다시 접속 대기
  assert.equal(FakeSocket.all.length, 2);
  FakeSocket.all[1].emit({ type: 'hello', num_connections: 1 });
  assert.ok(events.some((e) => e.event === 'conflict_clear'));
});

test('텔레그램: 409면 충돌, 정상 응답이 오면 해제', async (t) => {
  const ac = new AbortController();
  t.after(() => ac.abort());
  const updates = [{ ok: false, error_code: 409 }, { ok: false, error_code: 409 }, { ok: true, result: [] }];
  const events = [];
  stubs(t, async (url) => {
    if (String(url).endsWith('/getMe')) return reply({ ok: true, result: { username: 'b' } });
    const next = updates.shift();
    if (!next) { ac.abort(); return reply({ ok: true, result: [] }); }
    return reply(next);
  });
  runTelegram({ token: 'x', onMessage: async () => {}, log: (e) => events.push(e.event), signal: ac.signal, retryMs: 1 });
  await tick(60);
  assert.deepEqual(events, ['started', 'conflict', 'conflict', 'conflict_clear']);
});

test('실행기: 충돌은 바로 보고하고 준비 완료가 덮어쓰지 않으며, 해제되면 연결됨', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-conflict-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const reports = [];
  let botLog;
  const api = async (req) => {
    if (req.path === '/v1/messenger/bots') return { status: 200, body: { bots: [{ platform: 'telegram', botId: 'default', name: '기본', callNames: [], extraUsers: [], enabled: true }] } };
    if (req.path === '/v1/messenger/config') return { status: 200, body: {} };
    if (req.path === '/v1/messenger/bots/status') reports.push(...req.body.bots);
    return { status: 200, body: {} };
  };
  const runner = createBotRunner({ api, apiFor: () => api, env: { TELEGRAM_BOT_TOKEN: 'token-value' }, roomsPath: join(d, 'rooms.json'),
    runners: { telegram: ({ log }) => { botLog = log; } } });
  await runner.sync();
  botLog({ event: 'conflict', code: 409 });
  assert.equal(reports.at(-1).state, 'conflict');
  botLog({ event: 'started', bot: '@b' });
  assert.equal(reports.at(-1).state, 'conflict', '준비 완료가 충돌을 지우면 안 된다');
  botLog({ event: 'conflict_clear' });
  assert.equal(reports.at(-1).state, 'connected');
  assert.equal(reports.at(-1).username, '@b');
  assert.ok(!JSON.stringify(reports).includes('token-value'));
  runner.stopAll();
});