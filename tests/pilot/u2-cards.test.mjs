// U2: 대화 안의 카드 — 서버가 대화별로 처리할 일을 모아 주고, 허브에 연결된 PC는 질문을 받지 않는다(모델 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const APP = readFileSync(fileURLToPath(new URL('../../src/pilot/web/app.html', import.meta.url)), 'utf8');

async function server(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-u2-'));
  const app = createApp({ dbPath: join(dir, 'pilot.db'),
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('other'), userId: 'u_other', appId: 'app_web' }],
    bindings: [
      { conversationId: 'c_codex', label: '코덱스', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: '01a18790-63c7-73e3-a60b-6ddb60fd5be8' },
      { conversationId: 'c_claude', label: '클로드', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'claude_channel', sessionRef: 'c1' },
    ], ...extra(dir) });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = (path, { token = 'web', method = 'GET', body, headers = {} } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const poll = (health) => fetch(base + '/v1/device/jobs', { headers: { authorization: 'Bearer dev', ...(health ? { 'x-ieon-health': JSON.stringify(health) } : {}) } });
  const cards = async (id) => (await call(`/v1/conversations/${id}/cards`)).body.cards.map((c) => c.kind);
  const attention = async () => Object.fromEntries((await call('/v1/conversations')).body.conversations.map((c) => [c.conversationId, c.attention]));
  return { app, dir, call, poll, cards, attention };
}

test('PC가 꺼져 있으면 "PC 연결 끊김" 카드, 켜지면 사라지고 목록 개수도 따라간다', async (t) => {
  const s = await server(t, () => ({}));
  assert.deepEqual(await s.cards('c_codex'), ['device_offline']);
  assert.equal((await s.attention()).c_codex, 1);
  await s.poll({ codexShared: 'down', claudeChannel: 'up' });
  assert.deepEqual(await s.cards('c_codex'), []);
  assert.equal((await s.attention()).c_codex, 0);
});

test('Claude 채널이 꺼져 있으면 그 대화에만 카드', async (t) => {
  const s = await server(t, () => ({}));
  await s.poll({ codexShared: 'down', claudeChannel: 'down' });
  assert.deepEqual(await s.cards('c_claude'), ['engine_off']);
  assert.deepEqual(await s.cards('c_codex'), []);
});

test('이 PC의 AI 응답이 꺼져 있으면 카드, 켜면 사라진다', async (t) => {
  let cfg;
  const s = await server(t, (dir) => { cfg = join(dir, 'connector.json'); writeFileSync(cfg, JSON.stringify({ live: false })); return { connectorConfigPath: cfg }; });
  await s.poll();
  assert.deepEqual(await s.cards('c_codex'), ['live_off']);
  writeFileSync(cfg, JSON.stringify({ live: true }));
  assert.deepEqual(await s.cards('c_codex'), []);
});

test('허브에 연결된 PC는 질문을 받지 않고(처리되지 않은 채 남지 않게) 카드로 알린다', async (t) => {
  const s = await server(t, (dir) => { const cfg = join(dir, 'connector.json'); writeFileSync(cfg, JSON.stringify({ live: false })); return { connectorConfigPath: cfg }; });
  await s.poll();
  s.app.hubLink.hubMode = () => true;
  assert.deepEqual(await s.cards('c_codex'), ['hub_mode'], 'AI 응답 꺼짐보다 허브 연결이 먼저, 꺼짐 카드는 내지 않음');
  assert.equal((await s.call('/v1/conversations')).body.hubMode, true, '목록도 허브 연결을 알려 상태 문구가 카드와 같게');
  const r = await s.call('/v1/conversations/c_codex/requests', { method: 'POST', body: { question: '비밀 질문' }, headers: { 'idempotency-key': 'k-hubmode-0001' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'hub_mode');
  s.app.hubLink.hubMode = () => false;
  assert.equal((await s.call('/v1/conversations')).body.hubMode, undefined);
  const ok = await s.call('/v1/conversations/c_codex/requests', { method: 'POST', body: { question: '비밀 질문' }, headers: { 'idempotency-key': 'k-hubmode-0002' } });
  assert.equal(ok.status, 202);
  const held = JSON.stringify((await s.call('/v1/conversations/c_codex/cards')).body);
  assert.ok(!held.includes('비밀 질문'), '카드에는 질문 원문이 없다');
});

test('다른 사람의 대화나 없는 대화의 카드는 404', async (t) => {
  const s = await server(t, () => ({}));
  assert.equal((await s.call('/v1/conversations/c_codex/cards', { token: 'other' })).status, 404);
  assert.equal((await s.call('/v1/conversations/c_none/cards')).status, 404);
  assert.equal((await s.call('/v1/conversations/c_codex/cards', { token: 'nope' })).status, 401);
});

test('화면: 카드는 위쪽에 모으고, 누른 결과를 남기며, 다시 보내기는 사용자가 누를 때만', () => {
  assert.ok(APP.includes('id="cards"') && APP.includes("'/cards'"));
  for (const kind of ['hub_mode', 'device_offline', 'engine_off', 'held', 'archived', 'live_off']) assert.ok(APP.includes(`k.kind === '${kind}'`), kind);
  assert.ok(APP.includes('const done = []') && APP.includes("'✓ '"), '결과 기록');
  assert.ok(APP.includes("btn('다시 보내기'"), '다시 보내기 버튼');
  // 결과 불명(unknown)은 다시 보내기 대상이 아니다
  // A1: 계정 사용 한도(usage_limit)도 실행 안 된 것이 확실해 다시 보내기 대상(누를 때만)
  const retryCodes = APP.match(/\['desktop_holds_thread', 'thread_busy', 'conversation_busy', 'active_limit', 'usage_limit', 'session_in_use']/);
  assert.ok(retryCodes, '다시 보내기는 보내지 않은 것이 확실한 경우만');
  assert.ok(!/retry = \{[^}]*unknown/.test(APP));
  assert.ok(APP.includes("'/v1/admin/denied/allow'"), '메신저 허용 요청을 그 자리에서');
  assert.ok(APP.includes("if (hubMode) return ['warn'"), '허브 연결 중 목록 상태');
});