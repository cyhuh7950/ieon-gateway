// M1(INSTALL_MODES): 사용 방식 ① 이 PC에서만 · ② 내 허브. 서버가 모드에 맞지 않는 기능을 켜지 않는다(섞어 쓰기 0). 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';
import { readMode, writeMode, modeEffects } from '../../src/pilot/mode.mjs';

const T1 = '01a18790-63c7-73e3-a60b-6ddb60fd5be8';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const web = (f) => readFileSync(fileURLToPath(new URL(`../../src/pilot/web/${f}`, import.meta.url)), 'utf8');

async function pc(t, { s2 = false } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-m1-'));
  const closers = [];
  t.after(async () => { for (const f of closers.reverse()) await f(); rmSync(d, { recursive: true, force: true }); });
  const db = s2 ? join(d, 's2', 'pilot.db') : join(d, 'pilot.db');
  mkdirSync(join(d, 's2'), { recursive: true });
  const cfg = join(d, 's2', 'connector.json');
  writeFileSync(cfg, JSON.stringify({ live: true, codex: { allowlist: [T1] } }));
  const app = createApp({ dbPath: db, connectorConfigPath: cfg, hubLinkDir: join(d, 'hub'),
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }, { tokenSha256: sha('msg'), userId: 'u_sinsan', appId: 'app_messenger' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [{ conversationId: 'c1', ownerUserId: 'u_sinsan', appIds: ['app_web', 'app_messenger'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1 }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  closers.push(() => app.close());
  const call = (path, { method = 'GET', body, token = 'web', xff, headers = {} } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(xff ? { 'x-forwarded-for': xff } : {}), ...headers } })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  return { d, app, call, base };
}

test('모드 파일: 두 값만, 없으면 null, 바꿀 때 꺼지는 것·켜지는 것', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-m1f-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const p = join(d, 'mode.json');
  assert.equal(readMode(p), null);
  writeMode(p, 'hub'); assert.equal(readMode(p), 'hub');
  assert.throws(() => writeMode(p, 'public'), /bad_mode/);
  writeFileSync(p, '{"mode":"weird"}'); assert.equal(readMode(p), null);
  assert.ok(modeEffects('pc', 'hub').off.some((x) => x.includes('카카오 중계')));
  assert.ok(modeEffects('hub', 'pc').off.some((x) => x.includes('허브 연결')));
});

test('PC의 모드 파일은 .local/mode.json(설정 폴더 s2의 위), 허브 화면용 기기 설정에도 사용 방식', async (t) => {
  const s = await pc(t, { s2: true });
  assert.equal((await s.call('/v1/admin/local/mode', { method: 'PUT', body: { mode: 'pc' } })).status, 200);
  assert.ok(existsSync(join(s.d, 'mode.json')), '.local/mode.json 자리');
  assert.equal(s.app.mode(), 'pc');
  assert.equal((await s.call('/v1/admin/local/run', { method: 'POST', body: { op: 'device.get' } })).body.mode, 'pc');
  // 허브가 맡기는 것과 같은 공통 명령으로도 사용 방식 보기·바꾸기(IM10)
  assert.equal((await s.call('/v1/admin/local/run', { method: 'POST', body: { op: 'mode.get' } })).body.mode, 'pc');
  assert.equal((await s.call('/v1/admin/local/run', { method: 'POST', body: { op: 'mode.set', args: { mode: 'hub' } } })).body.mode, 'hub');
  assert.equal(s.app.mode(), 'hub');
});

test('고르지 않은 예전 설치: 지금처럼 동작, 짝맺지 않았으면 ① 추천', async (t) => {
  const s = await pc(t);
  const g = await s.call('/v1/admin/local/mode');
  assert.deepEqual([g.body.mode, g.body.suggested, g.body.paired], [null, 'pc', false]);
  assert.equal((await s.call('/v1/conversations')).body.mode, null, '화면이 고르기를 권할 수 있게');
  assert.notEqual((await s.call('/v1/admin/local/hub/connect', { method: 'POST', body: { hubUrl: 'https://127.0.0.1:1', name: 'x' } })).body?.error, 'mode_pc');
  assert.ok((await s.call('/v1/messenger/bots', { token: 'msg' })).body.bots.length > 0, '봇은 그대로');
});

test('① 이 PC에서만: 허브 연결·다시 연결을 거부하고, 이 PC 봇은 켠다', async (t) => {
  const s = await pc(t);
  await s.call('/v1/admin/local/mode', { method: 'PUT', body: { mode: 'pc' } });
  assert.deepEqual(Object.values(await s.call('/v1/admin/local/hub/connect', { method: 'POST', body: { hubUrl: 'https://hub.example', name: 'x' } })), [409, { error: 'mode_pc' }]);
  assert.equal((await s.call('/v1/admin/local/hub/reconnect', { method: 'POST', body: {} })).body.error, 'mode_pc');
  assert.ok((await s.call('/v1/messenger/bots', { token: 'msg' })).body.bots.length > 0);
  assert.equal((await s.call('/v1/conversations')).body.hubMode, undefined);
});

test('② 내 허브: 이 PC 봇(카카오 중계 포함)은 빈 목록, 이 PC 화면 질문·작업 내주기 거부, 카드로 안내', async (t) => {
  const s = await pc(t);
  await s.call('/v1/admin/local/mode', { method: 'PUT', body: { mode: 'hub' } });
  assert.deepEqual((await s.call('/v1/messenger/bots', { token: 'msg' })).body, { bots: [], mode: 'hub' });
  const r = await s.call('/v1/conversations/c1/requests', { method: 'POST', body: { question: 'q' }, headers: { 'idempotency-key': 'k-m1-hub-0001' } });
  assert.deepEqual([r.status, r.body.error], [409, 'hub_mode']);
  assert.equal((await fetch(s.base + '/v1/device/jobs', { headers: { authorization: 'Bearer dev' } })).status, 204);
  const list = (await s.call('/v1/conversations')).body;
  assert.deepEqual([list.hubMode, list.mode], [true, 'hub']);
  assert.deepEqual((await s.call('/v1/conversations/c1/cards')).body.cards.map((c) => c.kind), ['hub_mode']);
  // W3: 허브에 연결된 PC는 예약도 허브 화면에서 — 여기서는 만들지 않고 안내
  const sc = await s.call('/v1/schedules', { method: 'POST', body: { conversationId: 'c1', kind: 'interval', minutes: 15, question: 'q' } });
  assert.deepEqual([sc.status, sc.body.error], [409, 'hub_mode']);
  assert.equal((await s.call('/v1/schedules')).body.hubMode, true);
});

test('바꾸기: 이 PC 화면만, 두 값만, 처리 중인 질문이 있으면 바꾸지 않음', async (t) => {
  const s = await pc(t);
  assert.equal((await s.call('/v1/admin/local/mode', { method: 'PUT', body: { mode: 'hub' }, xff: '100.100.1.2' })).body.error, 'local_only');
  assert.equal((await s.call('/v1/admin/local/mode', { method: 'PUT', body: { mode: 'public' } })).body.error, 'bad_mode');
  await fetch(s.base + '/v1/device/jobs', { headers: { authorization: 'Bearer dev' } }); // PC 온라인
  const q = await s.call('/v1/conversations/c1/requests', { method: 'POST', body: { question: 'q' }, headers: { 'idempotency-key': 'k-m1-busy-0001' } });
  assert.equal(q.status, 202);
  assert.equal((await s.call('/v1/admin/local/mode', { method: 'PUT', body: { mode: 'hub' } })).body.error, 'requests_pending');
  assert.equal(s.app.mode(), null, '바뀌지 않음');
});

test('화면: 처음 설정 0단계(넘어가면 ①), 설정 → 이 PC → 사용 방식, 허브 화면에서도 바꾸기, 허브 연결 거부 안내', () => {
  const A = web('app.html'); const S = web('settings.html');
  assert.ok(A.includes('id="s0"') && A.includes('id="s0Pc"') && A.includes('id="s0Hub"') && A.includes('준비 중'));
  assert.ok(A.includes("$('sSkip').onclick = async () => { if (!$('s0').hidden) await setMode('pc'); closeSetup(); }"), '고르지 않고 넘어가면 ①');
  assert.ok(A.includes("setupStep(md?.status === 200 && !md.body.mode ? 0 : 1)"));
  assert.ok(A.includes('id="modeNote"') && A.includes("if ('mode' in body)"), '고르지 않은 예전 설치에 안내');
  assert.ok(S.includes('id="modeBox"') && S.includes('id="modeApply"') && S.includes("'/v1/admin/local/mode'"));
  assert.ok(S.includes("mode_pc: '사용 방식이"), '허브 연결 거부 이유');
  assert.ok(S.includes("await devRun('mode.set', { mode: next })") && S.includes('허브 화면에서는 이 PC를 더 다룰 수 없어요'), '허브 화면에서도 바꾸기(이 PC에서만으로 바꿀 때 경고)');
});
