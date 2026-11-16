// SV3-b(SERVER_SESSIONS 2-4): API 계정마다 하루 질문·한 달 토큰 한도와 사용량. 기본은 한도 없음, API 계정에만 건다,
// 넘으면 보내지 않고 알림(대화 카드로 주인도 봄), 자동 재전송 없음, 한도는 웹 화면에서만. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { healthHeader } from '../../src/pilot/connector.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T1 = '01a18790-0000-7000-8000-000000000061';

async function setup(t) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-sv3b-'));
  const app = createApp({ dbPath: join(d, 'p.db'),
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [{ conversationId: 'c1', label: '하나', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows 잠금 */ } });
  const call = (path, { method = 'GET', body, token = 'web', key, headers = {} } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}), ...headers } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const health = (h) => fetch(base + '/v1/device/jobs', { headers: { authorization: 'Bearer dev', 'x-ieon-health': healthHeader({ codexShared: 'not_configured', claudeChannel: 'not_configured', codexAccounts: {}, codexDefault: null, ...h }) } });
  let k = 0;
  // 질문 하나를 끝까지(연결부가 가져가 토큰 사용량과 함께 완료 보고)
  const askDone = async (tokens = 100) => {
    const q = await call('/v1/conversations/c1/requests', { method: 'POST', body: { question: 'q' }, key: `k-sv3b-${++k}-xxxx` });
    if (q.status !== 202) return q;
    await call('/v1/device/jobs', { token: 'dev' });
    await call(`/v1/device/jobs/${q.body.requestId}/result`, { token: 'dev', method: 'POST', body: { status: 'completed', answer: 'a', usage: { inputTokens: tokens, outputTokens: 0 } } });
    return q;
  };
  return { call, health, askDone };
}

test('기본은 한도 없음 — 계정별로 오늘 질문·이번 달 토큰을 센다(대화가 쓰는 계정 ID 기준)', async (t) => {
  const s = await setup(t);
  await s.health({ codexKind: 'api', codexKinds: { [T1]: 'api' }, codexAccountIds: { [T1]: 'acc1' }, codexDefaultId: 'pc_default' });
  for (let i = 0; i < 3; i++) assert.equal((await s.askDone(400)).status, 202);
  const u = (await s.call('/v1/admin/account-usage')).body.accounts;
  assert.deepEqual(u.map((a) => [a.key, a.todayQuestions, a.monthTokens, a.limit]), [['h_pc:acc1', 3, 1200, null]]);
  assert.deepEqual((await s.call('/v1/admin/account-usage?host=h_other')).body.accounts, [], 'PC를 고르면 그 PC 계정만');
});

test('API 계정에 하루 질문 한도를 걸면 넘을 때 보내지 않고 알림·대화 카드, 한도를 없애면 다시 보냄', async (t) => {
  const s = await setup(t);
  await s.health({ codexKind: 'api', codexKinds: { [T1]: 'api' }, codexAccountIds: { [T1]: 'acc1' } });
  assert.deepEqual((await s.call('/v1/admin/account-limits/h_pc:acc1', { method: 'PUT', body: { perDay: 2 } })).body, { key: 'h_pc:acc1', limit: { perDay: 2 } });
  await s.askDone(); await s.askDone();
  const third = await s.askDone();
  assert.deepEqual([third.status, third.body.error, third.body.reason, third.body.usage.todayQuestions], [429, 'account_limit_reached', 'per_day', 2]);
  const card = (await s.call('/v1/conversations/c1/cards')).body.cards.find((c) => c.kind === 'account_limit');
  assert.deepEqual([card.reason, card.usage.todayQuestions, card.limit.perDay], ['per_day', 2, 2], '주인 화면에도 보임');
  assert.deepEqual((await s.call('/v1/admin/account-limits/h_pc:acc1', { method: 'PUT', body: { perDay: null } })).body, { key: 'h_pc:acc1', limit: null });
  assert.equal((await s.askDone()).status, 202, '한도를 없애면 다시 보냄');
});

test('한 달 토큰 한도 — 보고된 사용량(입력+출력) 합계로', async (t) => {
  const s = await setup(t);
  await s.health({ codexKind: 'api', codexKinds: { [T1]: 'api' }, codexAccountIds: { [T1]: 'acc1' } });
  await s.call('/v1/admin/account-limits/h_pc:acc1', { method: 'PUT', body: { tokensPerMonth: 1000 } });
  await s.askDone(600); await s.askDone(500);
  const r = await s.askDone();
  assert.deepEqual([r.status, r.body.reason, r.body.usage.monthTokens], [429, 'tokens_per_month', 1100]);
});

test('구독 계정에는 한도를 걸지 않는다(공급자 한도) · 한도는 웹 화면에서만·1 이상의 정수만', async (t) => {
  const s = await setup(t);
  await s.health({ codexKind: 'subscription', codexKinds: { [T1]: 'subscription' }, codexAccountIds: { [T1]: 'pc_default' } });
  await s.call('/v1/admin/account-limits/h_pc:pc_default', { method: 'PUT', body: { perDay: 1 } });
  await s.askDone();
  assert.equal((await s.askDone()).status, 202, '구독 계정은 이어온 한도를 걸지 않음');
  assert.equal((await s.call('/v1/admin/account-limits/h_pc:acc1', { method: 'PUT', token: 'msg', body: { perDay: 1 } })).status, 403);
  assert.deepEqual((await s.call('/v1/admin/account-limits/h_pc:acc1', { method: 'PUT', body: { perDay: -3 } })).body, { error: 'bad_limit' });
  assert.deepEqual((await s.call('/v1/admin/account-limits/h_pc:acc1', { method: 'PUT', body: { perDay: 1.5 } })).body, { error: 'bad_limit' });
});
