// W3: 짝맺기 — PC 로컬 웹 "허브에 연결" → 허브 웹 승인 → 토큰은 내부로만(모델 0, 외부 접속 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { createHubLink } from '../../src/pilot/hub-link.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const users = [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }];

async function hubAndPc(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-w3-'));
  const hub = createApp({ dbPath: join(dir, 'hub.db'), users, devices: [], bindings: [],
    webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'] } });
  const hubUrl = `http://127.0.0.1:${await hub.listen(0)}`;
  const pc = createApp({ dbPath: join(dir, 'pc.db'), users, devices: [], bindings: [] });
  const pcUrl = `http://127.0.0.1:${await pc.listen(0)}`;
  t.after(async () => { await hub.close(); await pc.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = (base, path, { method = 'GET', body, xff } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: 'Bearer web', 'content-type': 'application/json', ...(xff ? { 'x-forwarded-for': xff } : {}) } })
    .then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json() }));
  return { dir, hub, pc, hubUrl, pcUrl, call };
}

test('짝맺기 전체: PC가 요청 → 허브 기기 화면에 코드와 함께 뜸 → 승인 → PC가 토큰을 받아 저장하고 허브 기기 API에 붙는다', async (t) => {
  const s = await hubAndPc(t);
  // PC 로컬 웹: 허브에 연결
  let r = await s.call(s.pcUrl, '/v1/admin/local/hub/connect', { method: 'POST', body: { hubUrl: s.hubUrl, name: '집 PC' } });
  assert.equal(r.status, 200);
  assert.match(r.body.code, /^\d{6}$/);
  const code = r.body.code;
  assert.equal((await s.call(s.pcUrl, '/v1/admin/local/hub')).body.state, 'pairing');
  // 허브 웹(허용 IP): 연결 요청 목록에 같은 코드
  const list = (await s.call(s.hubUrl, '/v1/admin/pairings', { xff: '198.51.100.9' })).body.pairings;
  assert.equal(list.length, 1);
  assert.equal(list[0].code, code);
  assert.equal(list[0].name, '집 PC');
  assert.equal((await s.call(s.hubUrl, `/v1/admin/pairings/${list[0].id}/approve`, { method: 'POST', xff: '198.51.100.9', body: { code: '000000' === code ? '111111' : '000000' } })).body.error, 'code_mismatch');
  r = await s.call(s.hubUrl, `/v1/admin/pairings/${list[0].id}/approve`, { method: 'POST', xff: '198.51.100.9', body: { code } });
  assert.deepEqual(r.body, { hostId: 'h_pc', name: '집 PC' }); // 이름에서 영문만 남으면 기본 pc
  // PC가 결과를 받아 저장(토큰은 화면·응답에 나오지 않는다)
  await s.pc.hubLink.pollOnce();
  const st = (await s.call(s.pcUrl, '/v1/admin/local/hub')).body;
  assert.equal(st.state, 'paired');
  assert.equal(st.hostId, 'h_pc');
  assert.ok(!JSON.stringify(st).match(/[0-9a-f]{64}/));
  const token = readFileSync(s.pc.hubLink.paths.tokenFile, 'utf8');
  assert.match(token, /^[0-9a-f]{64}$/);
  // 그 토큰으로 허브 기기 API에 붙는다(접속 제한 밖 주소여도 기기 API는 예외)
  const dev = await fetch(`${s.hubUrl}/v1/device/jobs`, { headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.7' } });
  assert.equal(dev.status, 204);
  // 한 번 넘긴 토큰은 다시 받을 수 없다
  assert.equal((await s.call(s.hubUrl, '/v1/pair/poll', { method: 'POST', body: { pairId: 'x'.repeat(43) } })).body.status, 'expired');
  // 허브 기기 목록에 웹 기기로 보인다
  assert.ok((await s.call(s.hubUrl, '/v1/admin/devices', { xff: '198.51.100.9' })).body.devices.some((d) => d.hostId === 'h_pc' && d.source === 'web'));
  // 잊기
  await s.call(s.pcUrl, '/v1/admin/local/hub/disconnect', { method: 'POST', body: { forget: true } });
  assert.equal((await s.call(s.pcUrl, '/v1/admin/local/hub')).body.state, 'none');
  assert.ok(!existsSync(s.pc.hubLink.paths.tokenFile));
});

test('짝맺기 보호: 거절하면 PC에 거절로 보이고, 허브의 연결 요청은 접속 제한 밖에서도 되지만 승인은 관리자만, 요청 횟수 제한', async (t) => {
  const s = await hubAndPc(t);
  const start = (xff) => fetch(`${s.hubUrl}/v1/pair/start`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': xff }, body: JSON.stringify({ name: 'pc' }) });
  assert.equal((await start('203.0.113.7')).status, 201); // 허용 IP 밖에서도 요청은 된다
  assert.equal((await s.call(s.hubUrl, '/v1/admin/pairings', { xff: '203.0.113.7' })).status, 403); // 승인 화면은 접속 제한 안에서만
  // PC 쪽 거절 흐름
  await s.call(s.pcUrl, '/v1/admin/local/hub/connect', { method: 'POST', body: { hubUrl: s.hubUrl, name: '사무실' } });
  const q = (await s.call(s.hubUrl, '/v1/admin/pairings', { xff: '198.51.100.9' })).body.pairings.find((x) => x.name === '사무실');
  await s.call(s.hubUrl, `/v1/admin/pairings/${q.id}/reject`, { method: 'POST', xff: '198.51.100.9', body: {} });
  await s.pc.hubLink.pollOnce();
  const st = (await s.call(s.pcUrl, '/v1/admin/local/hub')).body;
  assert.equal(st.state, 'none');
  assert.equal(st.error, 'rejected');
  // 잘못된 허브 주소
  assert.equal((await s.call(s.pcUrl, '/v1/admin/local/hub/connect', { method: 'POST', body: { hubUrl: 'http://evil.example', name: 'x' } })).body.error, 'bad_server_url');
  // 같은 주소에서 1분에 10번까지
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await start('192.0.2.50')).status);
  assert.ok(codes.includes(429));
  // 허브에서는 PC용 "허브에 연결" API가 없다
  assert.equal((await s.call(s.hubUrl, '/v1/admin/local/hub', { xff: '198.51.100.9' })).status, 404);
});

test('연결부 관리: 짝맺은 뒤 허브용 연결부를 띄우고, 끝나면 다시 띄우며, 끊기면 멈춘다. 허브 연결 중 PC 서버는 작업을 내주지 않는다', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-w3l-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'connector.json'), '{}');
  const spawned = [];
  const spawnImpl = (_bin, args) => { const p = new EventEmitter(); p.args = args; p.kill = () => { p.killed = true; }; spawned.push(p); return p; };
  const fetchImpl = async (url) => ({ status: url.endsWith('/start') ? 201 : 200,
    json: async () => (url.endsWith('/start') ? { pairId: 'p'.repeat(43), code: '123456', expiresAt: new Date(Date.now() + 60000).toISOString() } : { status: 'approved', hostId: 'h_home', token: 'a'.repeat(64) }) });
  const link = createHubLink({ dir, connectorConfigPath: join(dir, 'connector.json'), spawnImpl, fetchImpl, pollMs: 600000 });
  t.after(() => link.close());
  const r = await link.connect({ hubUrl: 'https://ieun-gateway.sinsan.kr', name: '집' });
  assert.equal(r.code, '123456');
  assert.equal(link.status().state, 'pairing');
  await link.pollOnce();
  // 승인되면 토큰을 저장하고 허브용 연결부를 띄운다(토큰 파일 경로만 넘기고 값은 넘기지 않음)
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].args.slice(0, 4), ['src/pilot/connector.mjs', join(dir, 'connector.json'), '--server', 'https://ieun-gateway.sinsan.kr']);
  assert.ok(!spawned[0].args.includes('a'.repeat(64)));
  assert.equal(link.status().connector, 'running');
  assert.equal(link.hubMode(), true);
  // 연결부가 끝나면 5초 뒤 다시 띄운다
  spawned[0].emit('exit', 1);
  assert.equal(link.status().connector, 'stopped');
  await new Promise((ok) => setTimeout(ok, 5200));
  assert.equal(spawned.length, 2);
  // 연결 끊기 → 멈추고 다시 띄우지 않는다. 다시 연결 → 다시 띄운다
  link.disconnect();
  assert.ok(spawned[1].killed);
  assert.equal(link.hubMode(), false);
  assert.equal(link.reconnect(), 'running');
  assert.equal(spawned.length, 3);
  assert.equal(link.resume(), 'running'); // 이미 떠 있으면 그대로
});

test('PC 서버: 허브 연결부가 떠 있는 동안은 이 PC 서버의 작업 조회에 빈 응답(204)을 준다', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-w3m-'));
  const pc = createApp({ dbPath: join(dir, 'pc.db'), users, devices: [{ tokenSha256: sha('dev'), hostId: 'h_sinsan' }],
    bindings: [{ conversationId: 'c_a', label: 'A', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_sinsan', engine: 'codex_thread', sessionRef: 't1' }] });
  const base = `http://127.0.0.1:${await pc.listen(0)}`;
  t.after(async () => { await pc.close(); rmSync(dir, { recursive: true, force: true }); });
  await fetch(`${base}/v1/device/jobs`, { headers: { authorization: 'Bearer dev' } }); // 연결부가 붙어 있음
  const q = await fetch(`${base}/v1/conversations/c_a/requests`, { method: 'POST', headers: { authorization: 'Bearer web', 'content-type': 'application/json', 'idempotency-key': 'key-0001' }, body: JSON.stringify({ question: 'hi' }) });
  assert.equal(q.status, 202);
  pc.hubLink.hubMode = () => true;
  assert.equal((await fetch(`${base}/v1/device/jobs`, { headers: { authorization: 'Bearer dev' } })).status, 204);
  pc.hubLink.hubMode = () => false;
  assert.equal((await fetch(`${base}/v1/device/jobs`, { headers: { authorization: 'Bearer dev' } })).status, 200);
});

test('승인 방식: server.json 기기 ID는 피하고, 기존 웹 기기를 고르면 그 기기의 토큰만 바꿔 이어 쓴다', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-w3r-'));
  const hub = createApp({ dbPath: join(dir, 'hub.db'), users, devices: [{ tokenSha256: sha('file'), hostId: 'h_pc' }], bindings: [],
    webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'] } });
  const base = `http://127.0.0.1:${await hub.listen(0)}`;
  t.after(async () => { await hub.close(); rmSync(dir, { recursive: true, force: true }); });
  const post = (path, body, xff = '198.51.100.9') => fetch(base + path, { method: 'POST', headers: { authorization: 'Bearer web', 'content-type': 'application/json', 'x-forwarded-for': xff }, body: JSON.stringify(body) }).then((r) => r.json());
  const get = (path) => fetch(base + path, { headers: { authorization: 'Bearer web', 'x-forwarded-for': '198.51.100.9' } }).then((r) => r.json());
  const pairOnce = async (replaceHostId) => {
    const s = await post('/v1/pair/start', { name: 'PC' });
    const q = (await get('/v1/admin/pairings')).pairings[0];
    const a = await post(`/v1/admin/pairings/${q.id}/approve`, { code: s.code, replaceHostId });
    const p = await post('/v1/pair/poll', { pairId: s.pairId });
    return { a, p };
  };
  const first = await pairOnce();
  assert.equal(first.a.hostId, 'h_pc-2'); // server.json의 h_pc는 피한다
  const again = await pairOnce('h_pc-2');
  assert.equal(again.a.hostId, 'h_pc-2');
  // 이전 토큰은 바로 무효, 새 토큰만 통한다
  const jobs = (tok) => fetch(`${base}/v1/device/jobs`, { headers: { authorization: `Bearer ${tok}` } }).then((r) => r.status);
  assert.equal(await jobs(first.p.token), 401);
  assert.equal(await jobs(again.p.token), 204);
  assert.equal((await get('/v1/admin/devices')).devices.filter((d) => d.source === 'web').length, 1);
  assert.equal((await post(`/v1/admin/pairings/zzzzzzzzzzzz/approve`, { code: '1' })).error, 'not_found');
});
