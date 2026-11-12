// A2-d(신산님 2026-11-12): PC형과 허브형은 동시에 쓰지 않는 별개 방식이므로 같은 기능이 양쪽에 있어야 한다.
// 허브 화면에서 PC의 AI 응답·허용 목록·계정을 바꾸면 허브가 명령을 맡기고, 그 PC(허브 연결 중인 이어온 서버)가 가져가 PC 화면과
// 같은 코드로 실행한다. 허브 자신의 계정도 같은 명령. 모델 0, 실제 로그인 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';
import { createDeviceAdmin, OPS } from '../../src/pilot/device-admin.mjs';
import { createAdminQueue } from '../../src/pilot/admin-queue.mjs';
import { createHubLink } from '../../src/pilot/hub-link.mjs';

const T1 = '01a18790-63c7-73e3-a60b-6ddb60fd5be8';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const users = [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }];
const HUB_ACCESS = { webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'] } };
const SET = readFileSync(fileURLToPath(new URL('../../src/pilot/web/settings.html', import.meta.url)), 'utf8');
const fakeLogin = (env) => ({ env, state: 'idle', start() { this.state = 'waiting'; }, cancel() {}, view() { return { state: this.state, url: null, code: null }; }, async logout() { return true; } });

async function setup(t, { adminTimeoutMs } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-a2d-'));
  const closers = [];
  t.after(async () => { for (const f of closers.reverse()) await f(); rmSync(d, { recursive: true, force: true }); });
  const prev = process.env.CODEX_HOME; const desk = join(d, 'desk'); mkdirSync(join(desk, 'sessions'), { recursive: true }); process.env.CODEX_HOME = desk;
  closers.push(() => { if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev; });
  // 허브(자기 연결부 설정은 데이터 폴더의 connector.json)
  mkdirSync(join(d, 'hub'));
  writeFileSync(join(d, 'hub', 'connector.json'), JSON.stringify({ live: false, codex: { allowlist: [] } }));
  const hub = createApp({ dbPath: join(d, 'hub', 'pilot.db'), users, devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }], bindings: [], accountLogin: fakeLogin, adminTimeoutMs, ...HUB_ACCESS });
  const hubUrl = `http://127.0.0.1:${await hub.listen(0)}`;
  closers.push(() => hub.close());
  // PC(이어온 서버 쪽 명령 실행기 + 허브 연결)
  mkdirSync(join(d, 'pc', 's2'), { recursive: true });
  const pcCfg = join(d, 'pc', 's2', 'connector.json');
  writeFileSync(pcCfg, JSON.stringify({ live: false, codex: { allowlist: [], modes: {}, workingDirectories: {} } }));
  const pcAdmin = createDeviceAdmin({ connectorConfigPath: pcCfg, accountLogin: fakeLogin });
  const linkDir = join(d, 'pc', 'hub'); mkdirSync(linkDir);
  writeFileSync(join(linkDir, 'hub.json'), JSON.stringify({ hubUrl, hostId: 'h_pc' }));
  writeFileSync(join(linkDir, 'device-token'), 'dev');
  const spawnImpl = () => Object.assign(new EventEmitter(), { kill() {} });
  const link = createHubLink({ dir: linkDir, connectorConfigPath: pcCfg, spawnImpl, adminPollMs: 3_600_000 });
  closers.push(() => link.close());
  link.setAdmin((op, args) => pcAdmin.run(op, args));
  link.resume();
  const admin = (host, op, args) => fetch(`${hubUrl}/v1/admin/hosts/${host}/run`, { method: 'POST', body: JSON.stringify({ op, args }),
    headers: { authorization: 'Bearer web', 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.9' } }).then(async (r) => ({ status: r.status, body: await r.json() }));
  // 허브 화면 요청은 PC가 가져가 결과를 낼 때까지 기다린다 → 요청을 보낸 뒤 PC 쪽 한 주기를 돌린다
  const viaHub = async (op, args) => { const p = admin('h_pc', op, args); await new Promise((r) => setTimeout(r, 50)); assert.equal(await link.adminOnce(), true, 'PC가 명령을 가져감'); return p; };
  const online = () => fetch(`${hubUrl}/v1/device/jobs`, { headers: { authorization: 'Bearer dev' } });
  return { d, hub, hubUrl, pcCfg, pcAdmin, link, admin, viaHub, online, desk, onClose: (f) => closers.push(f) };
}

test('허브 화면 → PC: AI 응답·허용 목록·계정을 PC 화면과 같은 결과로 바꾼다(업무 대화 제외 그대로)', async (t) => {
  const s = await setup(t);
  await s.online();
  let r = await s.viaHub('device.get');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, (await s.pcAdmin.run('device.get')).body, 'PC 화면과 같은 내용');
  r = await s.viaHub('device.live', { live: true });
  assert.equal(r.body.live, true);
  assert.equal(JSON.parse(readFileSync(s.pcCfg, 'utf8')).live, true, 'PC 설정 파일에 반영');
  r = await s.viaHub('device.codex.put', { threadId: T1, mode: 'alternate' });
  assert.deepEqual(r.body.codexThreads.map((x) => x.threadId), [T1]);
  r = await s.viaHub('device.codex.put', { threadId: '01a0dadd-739f-74d2-93c5-9c405cc1019b', mode: 'alternate' });
  assert.deepEqual([r.status, r.body.error], [400, 'excluded_session'], '업무 대화는 허브에서도 거절');
  r = await s.viaHub('accounts.add', { label: '회사' });
  assert.equal(r.status, 201);
  assert.ok(existsSync(join(s.d, 'pc', 'accounts', 'codex', r.body.id, 'config.toml')), '계정 폴더는 그 PC에');
  r = await s.viaHub('accounts.use', { threadId: T1, accountId: r.body.id });
  assert.equal(Object.keys(r.body.accountFor)[0], T1);
  r = await s.viaHub('device.codex.delete', { threadId: T1 });
  assert.deepEqual(r.body.codexThreads, []);
});

test('허브 자신의 계정: 같은 명령으로 허브 데이터 폴더에, 허브 자신에는 계정 명령만', async (t) => {
  const s = await setup(t);
  let r = await s.admin('hub', 'accounts.add', { label: '허브용' });
  assert.equal(r.status, 201);
  assert.ok(existsSync(join(s.d, 'hub', 'accounts', 'codex', r.body.id)), '허브 /data/accounts 자리');
  r = await s.admin('hub', 'accounts.login', { id: r.body.id });
  assert.equal(r.body.accounts[0].login.state, 'waiting');
  assert.equal((await s.admin('hub', 'device.live', { live: true })).body.error, 'bad_op');
});

test('PC가 꺼져 있거나 응답이 없으면 알리고 다시 보내지 않는다, 모르는 PC·명령은 거절', async (t) => {
  const s = await setup(t, { adminTimeoutMs: 300 });
  assert.deepEqual([(await s.admin('h_pc', 'device.get')).status, (await s.admin('h_pc', 'device.get')).body.error], [503, 'device_offline']);
  assert.equal((await s.admin('h_none', 'device.get')).body.error, 'unknown_host');
  await s.online();
  assert.equal((await s.admin('h_pc', 'rm -rf')).body.error, 'bad_op');
  const r = await s.admin('h_pc', 'device.get'); // PC가 가져가지 않음
  assert.deepEqual([r.status, r.body.error], [504, 'device_no_response']);
  assert.equal(await s.link.adminOnce(), false, '시간이 지난 명령은 남지 않음');
  // PC형 서버에는 허브용 주소가 없다
  const pc = createApp({ dbPath: join(s.d, 'pc.db'), users, devices: [], bindings: [], connectorConfigPath: s.pcCfg });
  const pcUrl = `http://127.0.0.1:${await pc.listen(0)}`;
  s.onClose(() => pc.close());
  assert.equal((await fetch(`${pcUrl}/v1/admin/hosts/h_pc/run`, { method: 'POST', headers: { authorization: 'Bearer web' }, body: '{}' })).status, 404);
  // PC 화면의 공통 명령: 보기는 앞단을 거쳐도, 바꾸기는 이 PC에서 연 화면만
  const run = (op, args, xff) => fetch(`${pcUrl}/v1/admin/local/run`, { method: 'POST', body: JSON.stringify({ op, args }),
    headers: { authorization: 'Bearer web', 'content-type': 'application/json', ...(xff ? { 'x-forwarded-for': xff } : {}) } }).then(async (x) => ({ status: x.status, body: await x.json() }));
  assert.equal((await run('device.get', {}, '100.100.1.2')).status, 200);
  assert.equal((await run('accounts.get', {}, '100.100.1.2')).status, 200, '계정 보기도 앞단 화면에서 됨');
  assert.equal((await run('device.live', { live: false }, '100.100.1.2')).body.error, 'local_only');
  assert.equal((await run('device.live', { live: false })).body.live, false);
});

test('대기열: 그 PC가 가져간 명령의 결과만 받는다', async () => {
  const q = createAdminQueue({ timeoutMs: 1000 });
  const p = q.send('h_a', 'device.get', {});
  assert.equal(q.take('h_b'), null, '다른 PC는 못 가져감');
  const cmd = q.take('h_a');
  assert.equal(q.done('h_b', cmd.id, { status: 200, body: { x: 1 } }), false, '다른 PC가 결과를 못 보냄');
  assert.equal(q.done('h_a', cmd.id, { status: 200, body: { ok: true } }), true);
  assert.deepEqual(await p, { status: 200, body: { ok: true } });
});

test('화면: 허브에서도 PC 설정·계정 탭(대상 PC 고르기), 모든 명령을 화면이 쓴다', () => {
  assert.ok(!SET.includes('#atabs [data-atab="acct"]\').hidden = hub'), '계정 탭을 허브에서 숨기지 않음');
  assert.ok(!SET.includes('#atabs [data-atab="pc"]\').hidden = hub'), 'PC 탭을 허브에서 숨기지 않음');
  assert.ok(SET.includes('id="pcTarget"') && SET.includes('id="acTarget"') && SET.includes("'/v1/admin/hosts/'") && SET.includes("'/v1/admin/local/run'"));
  assert.ok(SET.includes("['hub', '허브 자체(허브에서 만든 새 세션)']"));
  assert.ok(!SET.includes("api('/v1/admin/local/device") && !SET.includes("api('/v1/admin/local/accounts"), '한쪽 전용 주소를 화면이 직접 부르지 않음');
  for (const op of Object.keys(OPS)) assert.ok(SET.includes(`Run('${op}'`), op);
});

test('공개 중계 없이 쓰는 PC형: 카카오·라인은 오류가 아니라 "사용 안 함", 다른 메신저는 그대로', async (t) => {
  const { createBotRunner } = await import('../../src/pilot/messenger/runner.mjs');
  const d = mkdtempSync(join(tmpdir(), 'ieon-relayoff-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const reports = [];
  const api = async (req) => {
    if (req.path === '/v1/messenger/bots') return { status: 200, body: { bots: [
      { platform: 'kakao', botId: 'default', name: '기본', callNames: [], extraUsers: [], enabled: true },
      { platform: 'telegram', botId: 'default', name: '기본', callNames: [], extraUsers: [], enabled: true }] } };
    if (req.path === '/v1/messenger/bots/status') { reports.push(...req.body.bots); return { status: 204, body: null }; }
    return { status: 200, body: {} };
  };
  const runner = createBotRunner({ api, apiFor: () => api, env: { KAKAO_RELAY_TOKEN: 'x', TELEGRAM_BOT_TOKEN: 'y' }, roomsPath: join(d, 'r.json'),
    runners: { kakao: (o) => o.log({ platform: 'kakao', event: 'open_error', error: 'kakaoRelayUrl_missing' }), telegram: (o) => o.log({ platform: 'telegram', event: 'connected' }) } });
  await runner.sync(); t.after(() => runner.stopAll());
  assert.ok(reports.some((b) => b.platform === 'kakao' && b.state === 'relay_off'), JSON.stringify(reports));
  assert.ok(!reports.some((b) => b.platform === 'kakao' && b.state === 'error'));
  assert.ok(SET.includes("relay_off: ['muted', '사용 안 함 · 공개 중계 없이 쓰는 중"));
  assert.ok(SET.includes("token_missing: ['muted', '토큰 없음 · 쓰지 않으면 그대로 두세요']"), '쓰지 않는 메신저는 빨간 오류로 보이지 않음');
});

test('허브 자신의 연결부 기기는 PC 목록에서 빠지고(hubSelf), 그쪽 명령은 허브 자신으로 처리', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-a2dself-'));
  const closers = [];
  t.after(async () => { for (const f of closers.reverse()) await f(); rmSync(d, { recursive: true, force: true }); });
  writeFileSync(join(d, 'self-token'), 'selftok');
  writeFileSync(join(d, 'connector.json'), JSON.stringify({ live: false, deviceTokenFile: join(d, 'self-token'), codex: { allowlist: [] } }));
  const hub = createApp({ dbPath: join(d, 'pilot.db'), users, devices: [{ tokenSha256: sha('selftok'), hostId: 'h_self' }, { tokenSha256: sha('dev'), hostId: 'h_pc' }], bindings: [], accountLogin: fakeLogin, ...HUB_ACCESS });
  const url = `http://127.0.0.1:${await hub.listen(0)}`;
  closers.push(() => hub.close());
  const h = { authorization: 'Bearer web', 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.9' };
  const devs = (await fetch(url + '/v1/admin/devices', { headers: h }).then((r) => r.json())).devices;
  assert.deepEqual(devs.map((x) => [x.hostId, Boolean(x.hubSelf)]), [['h_self', true], ['h_pc', false]]);
  const run = (host, op) => fetch(`${url}/v1/admin/hosts/${host}/run`, { method: 'POST', headers: h, body: JSON.stringify({ op, args: {} }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  assert.equal((await run('h_self', 'accounts.get')).status, 200, '기다리지 않고 허브 자신이 처리');
  assert.equal((await run('h_self', 'device.get')).body.error, 'bad_op');
  assert.ok(SET.includes('!d.revokedAt && !d.hubSelf'), '화면 PC 목록에서 뺌');
});
