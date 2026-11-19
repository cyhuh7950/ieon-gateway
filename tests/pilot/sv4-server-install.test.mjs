// SV4(신산님 2026-11-17 "SV4 진행해", 설계 SERVER_SESSIONS 2-1·2-6·4절): 새 리눅스 서버 설치형.
// 컨테이너 첫 실행에 처음 설정을 스스로 만들고(토큰 해시만·이미 있으면 그대로), ① 서버 설치형/② 허브형을 화면에서 바꾸고,
// 설치 스크립트·서버용 compose가 크기·포트를 설치 폴더 환경 파일에서 받는지 본다. 모델 0·서버 기동은 시험 안에서만(127.0.0.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initHubData, initFromEnv, parseList } from '../../scripts/hub-init.mjs';
import { createApp } from '../../src/pilot/server.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'ieon-sv4-')); t.after(() => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows 잠금 */ } }); return d; };

test('처음 설정: 허브 데이터를 만들고(웹 접속 주소·쓰임·카카오 바로 받기), 토큰은 파일(600)에만·설정엔 해시, 두 번째는 그대로', (t) => {
  const d = tmp(t);
  assert.throws(() => initHubData(d, {}), /need_ip_allowlist/);
  assert.throws(() => initHubData(d, { ipAllowlist: ['1.2.3.4'], installKind: 'x' }), /bad_install_kind/);
  const made = initHubData(d, { ipAllowlist: ['203.0.113.7'], installKind: 'server' });
  assert.ok(made.includes('s2/server.json'));
  const s = JSON.parse(readFileSync(join(d, 's2/server.json'), 'utf8'));
  assert.deepEqual(s.webAccess, { modes: ['ip_allowlist'], ipAllowlist: ['203.0.113.7'], trustedProxies: [] });
  assert.deepEqual([s.installKind, s.publicListen.port, s.newSessionsHostId, s.devices[0].hostId], ['server', 28770, 'h_hub', 'h_hub']);
  assert.deepEqual(s.users.map((u) => u.appId), ['app_web', 'app_messenger']);
  const tok = readFileSync(join(d, 's2/user-token'), 'utf8');
  assert.match(tok, /^[0-9a-f]{64}$/);
  for (const f of ['s2/server.json', 's2/connector.json', 'messenger/config.json']) assert.ok(!readFileSync(join(d, f), 'utf8').includes(tok), `${f}에 토큰 원문 없음`);
  if (process.platform !== 'win32') for (const f of ['s2/user-token', 's2/device-token', 'messenger/token', 'messenger/bots.env']) assert.equal(statSync(join(d, f)).mode & 0o777, 0o600, f);
  const c = JSON.parse(readFileSync(join(d, 's2/connector.json'), 'utf8'));
  assert.equal(c.live, true, 'AI 응답은 켜 둠(신산님: 운영 중 켜 둠)');
  assert.equal(JSON.parse(readFileSync(join(d, 'messenger/config.json'), 'utf8')).kakaoRelayUrl, 'http://127.0.0.1:28760', '카카오는 중계 없이 이 서버가 바로');
  assert.equal(JSON.parse(readFileSync(join(d, 'new-sessions.json'), 'utf8')).enabled, true);
  assert.deepEqual(initHubData(d, { ipAllowlist: ['9.9.9.9'] }), [], '이미 있으면 바꾸지 않음');
  assert.equal(readFileSync(join(d, 's2/user-token'), 'utf8'), tok);
  // 환경 변수(설치 폴더 환경 파일 → compose)로
  const e = tmp(t);
  initFromEnv(e, { IEON_WEB_ALLOW: '198.51.100.9, bad value, 10.0.0.0/8', IEON_INSTALL_KIND: 'hub' });
  const s2 = JSON.parse(readFileSync(join(e, 's2/server.json'), 'utf8'));
  assert.deepEqual([s2.webAccess.ipAllowlist, s2.installKind], [['198.51.100.9', '10.0.0.0/8'], 'hub']);
  assert.deepEqual(parseList('0.0.0.0/0'), ['0.0.0.0/0']);
});

test('만든 설정으로 서버가 뜨고 처음 화면은 관리자 만들기 · 쓰임(서버 설치형)이 보이고 화면에서 허브형으로 바꿈', async (t) => {
  const d = tmp(t);
  initHubData(d, { ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'], installKind: 'server' });
  const cfg = JSON.parse(readFileSync(join(d, 's2/server.json'), 'utf8'));
  delete cfg.publicListen; // 시험은 127.0.0.1 한 포트만
  // 서버 시작 코드와 같게: 내장 중계 열쇠는 봇 비밀 파일에서(처음 설정이 만들어 둠 — 없으면 서버가 못 뜸)
  const env = Object.fromEntries(readFileSync(cfg.relay.envFile, 'utf8').split('\n').map((l) => l.split('=')).filter((p) => p.length === 2));
  assert.ok(env.IEON_RELAY_PC_TOKEN?.length >= 16 && env.KAKAO_RELAY_TOKEN === env.IEON_RELAY_PC_TOKEN && env.IEON_RELAY_KAKAO_SECRET);
  cfg.relay = { pcToken: env.IEON_RELAY_PC_TOKEN, kakaoSecret: env.IEON_RELAY_KAKAO_SECRET };
  const app = createApp(cfg);
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(() => app.close());
  const token = readFileSync(join(d, 's2/user-token'), 'utf8').trim();
  const call = (path, { method = 'GET', body, auth = true } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { ...(auth ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.9' } })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const st = (await call('/v1/auth/state', { auth: false })).body;
  assert.deepEqual([st.mode, st.setupRequired, st.installKind], ['hub', true, 'server']);
  assert.equal((await call('/v1/admin/settings')).body.installKind, 'server');
  assert.equal((await call('/v1/admin/settings/install-kind', { method: 'PUT', body: { kind: 'nope' } })).status, 400);
  assert.equal((await call('/v1/admin/settings/install-kind', { method: 'PUT', body: { kind: 'hub' } })).body.installKind, 'hub');
  assert.equal((await call('/v1/auth/state', { auth: false })).body.installKind, 'hub');
});

test('설치 스크립트·서버용 compose: 크기·포트·주소는 설치 폴더 환경 파일, 키는 가려 입력·주인만 읽음, 칸 관리는 같은 도구', () => {
  const sh = read('deploy/server/install.sh');
  for (const k of ['IEON_INSTALL_KIND', 'IEON_PORT', 'IEON_WEB_ALLOW', 'IEON_HUB_URL', 'IEON_MEM', 'ENGINE_MEM', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) assert.ok(sh.includes(k), k);
  assert.ok(sh.includes('stty -echo') && sh.includes('chmod 600') && sh.includes('umask 077'), '키는 가려 입력, 파일은 주인만');
  assert.ok(sh.includes('--env-file') && sh.includes('deploy/server/compose.yaml') && sh.includes('ieun.sh engine share-login') && sh.includes('ieun.sh engine add main'));
  assert.ok(sh.includes('get.docker.com') && /ask "Docker가 없어요/.test(sh), 'Docker 설치는 묻고 나서');
  assert.ok(sh.includes('has IEON_TRUSTED_PROXIES || put IEON_TRUSTED_PROXIES "172.16.0.0/12"'), '같은 서버 앞단(Docker 망) 뒤에서도 실제 접속 주소를 읽음(SV4 실측)');
  assert.ok(!/echo .*\$REPLY/.test(sh) && !/say .*API_KEY=/.test(sh), '입력한 키를 화면에 내지 않음');
  const yml = read('deploy/server/compose.yaml');
  for (const k of ['${IEON_PORT:-28770}:28770', '${IEON_MEM:-2g}', '${IEON_PIDS:-512}', '${IEON_CONTAINER:-ieun-relay}', 'cap_drop: [ALL]', 'no-new-privileges:true', '../../hub/data:/data', 'deploy/hub/Dockerfile'])
    assert.ok(yml.includes(k), k);
  assert.ok(!yml.includes('docker.sock') && !yml.includes('privileged'));
  assert.ok(read('deploy/hub/compose.yaml').includes('${IEON_MEM:-1g}'), '지금 허브도 크기를 환경 파일로(기본은 그대로)');
  const ieun = read('deploy/hub/ieun.sh');
  assert.ok(ieun.includes('docker exec "$HUB_C" node src/hub/invite.mjs') && ieun.includes('HUB_C=${HUB_C:-ieun-relay}') && ieun.includes('export IEON_HUB_URL'));
  assert.ok(read('src/hub/run.mjs').includes('initFromEnv(data)'), '컨테이너 첫 실행에 처음 설정');
  const set = read('src/pilot/web/settings.html');
  assert.ok(set.includes('id="pcLinkOff"') && set.includes("'/v1/admin/settings/install-kind'") && set.includes("authState?.installKind === 'server'"));
  assert.ok(existsSync(join(ROOT, 'scripts/hub-init.mjs')));
});
