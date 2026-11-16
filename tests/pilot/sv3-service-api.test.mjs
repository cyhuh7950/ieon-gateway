// SV3(SERVER_SESSIONS 2-4, 신산님 결정 "다른 사람이 쓰는 서비스는 API형"): 계정 종류(구독/API)를 자동으로 알고,
// 주인 밖의 사람도 받는 봇으로 온 질문은 API 키 계정일 때만 보낸다. 주인이 웹에서 쓰는 것은 그대로. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { codexKindCache, kindOfMethod, codexAccountHealth, healthHeader } from '../../src/pilot/connector.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T1 = '01a18790-0000-7000-8000-000000000051';

test('계정 종류는 Codex에 물어 자동으로 — ChatGPT면 구독, API key면 API, 5분 안에는 다시 묻지 않음, 대화별 계정 따라감', async () => {
  assert.deepEqual([kindOfMethod('chatgpt'), kindOfMethod('api_key'), kindOfMethod(null)], ['subscription', 'api', null]);
  const asked = [];
  const config = { accountsDir: '/acc', codex: { accounts: [{ id: 'abcd', label: '회사' }], accountFor: { [T1]: 'abcd' }, allowlist: [T1, '01a18790-0000-7000-8000-000000000052'], modes: {} } };
  const kc = codexKindCache(config, { statusOf: async (env) => { asked.push(env.CODEX_HOME ?? 'default'); return { method: env.CODEX_HOME?.includes('abcd') ? 'api_key' : 'chatgpt' }; } });
  await kc.refresh();
  assert.equal(kc.kindFor(null), config.codex.defaultAccount ? null : 'subscription', '기본 = 그 PC·칸의 원래 로그인');
  assert.equal(kc.kindFor(T1), 'api', '대화가 고른 계정의 종류');
  const n = asked.length; kc.get(); kc.get();
  assert.equal(asked.length, n, '바로 다시 묻지 않음(작업 조회마다 묻지 않게)');
  config.kindCache = kc;
  const h = codexAccountHealth(config);
  assert.deepEqual([h.codexKind, h.codexKinds[T1], h.codexKinds['01a18790-0000-7000-8000-000000000052']], ['subscription', 'api', 'subscription']);
});

async function setup(t) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-sv3-'));
  const app = createApp({ dbPath: join(d, 'p.db'),
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [{ conversationId: 'c1', label: '법률봇', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 },
      { conversationId: 'c2', label: '클로드', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'claude_channel', sessionRef: 'ch' }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows 잠금 */ } });
  // 봇 둘: 손님용(봇에 더한 사람 있음 = 서비스용), 개인용(주인만)
  assert.equal(app.store.saveBot({ platform: 'telegram', botId: 'shop', name: '손님용', callNames: [], extraUsers: ['111', '999'], enabled: true }).http, 200); // 주인(111, 숫자로 먼저 등록) + 다른 사람
  assert.equal(app.store.saveBot({ platform: 'telegram', botId: 'me', name: '개인용', callNames: [], extraUsers: ['111'], enabled: true }).http, 200); // 허브에서 숫자로 주인만 등록한 봇
  app.store.setBotSessions('telegram', 'shop', ['c1', 'c2']); app.store.setBotSessions('telegram', 'me', ['c1']);
  const health = (kinds) => fetch(base + '/v1/device/jobs', { headers: { authorization: 'Bearer dev', 'x-ieon-health': healthHeader({ codexShared: 'not_configured', claudeChannel: 'up', codexAccounts: {}, codexDefault: null, ...kinds }) } });
  let k = 0;
  const ask = (conv, { token = 'msg', bot } = {}) => fetch(`${base}/v1/conversations/${conv}/requests`, { method: 'POST', body: JSON.stringify({ question: 'q' }),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': `k-sv3-${++k}-xxxx`, ...(bot ? { 'x-ieon-bot': bot } : {}) } }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const conv = async (id) => (await fetch(base + '/v1/conversations', { headers: { authorization: 'Bearer web' } }).then((r) => r.json())).conversations.find((c) => c.conversationId === id);
  const stop = async (id) => fetch(`${base}/v1/requests/${id}/stop`, { method: 'POST', headers: { authorization: 'Bearer web' } });
  return { health, ask, conv, stop, app };
}

test('서비스용 봇(다른 사람도 받음) + 구독 계정이면 엔진에 보내지 않고 고치는 길을 알림 — API 키 계정이면 보냄', async (t) => {
  const s = await setup(t);
  await s.health({ codexKind: 'subscription', codexKinds: { [T1]: 'subscription' } });
  assert.deepEqual(await s.ask('c1', { bot: 'telegram:shop' }), { status: 409, body: { error: 'service_needs_api_key' } });
  assert.equal((await s.conv('c1')).busy, false, '보내지 않았으니 대화도 막히지 않음');
  await s.health({ codexKind: 'subscription', codexKinds: { [T1]: 'api' } });
  const ok = await s.ask('c1', { bot: 'telegram:shop' });
  assert.equal(ok.status, 202, 'API 키 계정이면 서비스용 봇도 보냄');
  assert.equal((await s.conv('c1')).account.kind, 'api', '화면에 계정 종류 표시');
  await s.stop(ok.body.requestId);
});

test('주인 편의는 그대로 — 개인용 봇·웹 화면은 구독 계정이어도 보냄, 계정 종류를 모르는 엔진(Claude)은 막지 않음', async (t) => {
  const s = await setup(t);
  await s.health({ codexKind: 'subscription', codexKinds: { [T1]: 'subscription' } });
  const a = await s.ask('c1', { bot: 'telegram:me' });
  assert.equal(a.status, 202, '주인만 받는 봇');
  await s.stop(a.body.requestId);
  const b = await s.ask('c1', { token: 'web' });
  assert.equal(b.status, 202, '주인의 웹 화면');
  await s.stop(b.body.requestId);
  assert.equal((await s.ask('c2', { bot: 'telegram:shop' })).status, 202, 'Claude는 계정 종류를 아직 몰라 막지 않음(SV2에서)');
  assert.equal((await s.conv('c1')).account.kind, 'subscription');
});

test('계정 종류를 아직 모르면(연결부가 알려 주기 전) 서비스용 봇은 보내지 않는다 — 다른 사람에게 구독 계정이 새지 않게', async (t) => {
  const s = await setup(t);
  await s.health({});
  assert.deepEqual((await s.ask('c1', { bot: 'telegram:shop' })).body, { error: 'service_needs_api_key' });
});

test('주인 판정: 숫자 주인 등록을 기록하면 그 사람만 주인 — 기록이 없으면 봇에 처음 더한 사람이 주인(예전 허브 등록)', async (t) => {
  const s = await setup(t);
  await s.health({ codexKind: 'subscription', codexKinds: { [T1]: 'subscription' } });
  const me = await s.ask('c1', { bot: 'telegram:me' });
  assert.equal(me.status, 202, '주인만 받는 봇은 개인용(신산님 본인 질문이 막히지 않음)');
  await s.stop(me.body.requestId);
  // 주인이 999로 기록되면 111은 다른 사람 → me 봇도 서비스용
  s.app.store.setSetting('messenger_owners', { telegram: ['999'] });
  assert.equal((await s.ask('c1', { bot: 'telegram:me' })).status, 409);
});

test('연결부 시작 코드(파일 위쪽)가 부르는 계정 종류 함수는 모듈을 다 읽기 전에도 쓸 수 있어야 한다(초기화 전 접근 오류 방지)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../src/pilot/connector.mjs', import.meta.url), 'utf8');
  const main = src.indexOf('if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])');
  for (const name of ['kindOfMethod', 'codexKindCache', 'codexAccountHealth', 'engineHealth']) {
    assert.ok(src.includes('export function ' + name + '(') || src.includes('export async function ' + name + '('), name + '는 함수 선언(끌어올려짐)');
    assert.ok(!src.includes('export const ' + name + ' '), name + '를 const로 두지 않음');
  }
  assert.ok(main > 0);
});
