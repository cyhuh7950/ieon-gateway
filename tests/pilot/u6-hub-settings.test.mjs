// U6: 허브 PC 연결 링크(1회용 초대) · 허브 목록 PC별 묶음 · 허브 Codex 로그인 카드 · 설정 화면 옮기기(모델 0, 외부 접속 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const users = [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }];
const ADMIN_IP = '198.51.100.9';
// U8: 예전 화면(index.html)을 지우면서, U6 점검표의 기준(예전 화면 관리 부분의 입력·버튼·목록 ID와 관리 API)을 여기에 고정했다(2026-11-12 index.html 기준).
const OLD_IDS = [
  'admin', 'atabs', 'devBox', 'devLive', 'devConn', 'devThreads', 'devAdd', 'devThread', 'devMode', 'devDir', 'hubLinkBox', 'hubLinkState',
  'hubLinkForm', 'hlUrl', 'hlName', 'hlReconnect', 'hlStop', 'hlForget', 'botRows', 'botAdd', 'addPlatform', 'addBotId', 'addHint',
  'botEdit', 'botEditTitle', 'botForm', 'bName', 'bRole', 'bCalls', 'bUsers', 'bSessions', 'bEnabled', 'bTokens', 'bStatus', 'bDelete',
  'deniedRows', 'auSrc', 'auForm', 'auTelegram', 'auDiscord', 'auSlack', 'auKakao', 'auReset', 'skillBox', 'relayState', 'skillShow',
  'skillCopy', 'skillUrl', 'kkSrc', 'kkForm', 'kkUrl', 'kkLimit', 'kkReset', 'bdRows', 'bdForm', 'bdId', 'bdLabel', 'bdEngine', 'bdHost',
  'bdRef', 'bdWeb', 'bdMsg', 'bdDelete', 'bdNew', 'nsSrc', 'nsForm', 'nsOn', 'nsMax', 'nsActive', 'nsCodex', 'nsClaude', 'nsIdle', 'nsArch',
  'nsNotice', 'nsDefault', 'nsRoot', 'nsReset', 'roleRows', 'roleForm', 'rId', 'rName', 'rDesc', 'rGuide', 'rDefault', 'rDelete', 'rNew',
  'pairBox', 'pairRows', 'dvRows', 'dvEvents', 'secBox', 'secSrc', 'secIp', 'secForm', 'secIpOn', 'secCfOn', 'secTsOn', 'secIps', 'secAddMe',
  'secTeam', 'secAud', 'secReset', 'cxBox', 'cxState', 'cxStart', 'cxCancel', 'hubEngineRow', 'hubLive', 'appRows', 'appAdd', 'appName',
  'appKey', 'appKeyText', 'appKeyCopy', 'appKeyHide',
];
const OLD_APIS = [
  '/v1/admin/settings', '/v1/admin/settings/', '/v1/admin/bindings', '/v1/admin/bindings/', '/v1/admin/devices', '/v1/admin/devices/',
  '/v1/admin/pairings', '/v1/admin/pairings/', '/v1/admin/local/device', '/v1/admin/local/device/codex/', '/v1/admin/local/device/live',
  '/v1/admin/local/hub', '/v1/admin/local/hub/connect', '/v1/admin/local/hub/reconnect', '/v1/admin/local/hub/disconnect',
  '/v1/admin/secrets', '/v1/admin/secrets/', '/v1/admin/apps', '/v1/admin/apps/', '/v1/admin/denied', '/v1/admin/denied/allow',
  '/v1/admin/codex', '/v1/admin/hub/engine', '/v1/admin/codex/login', '/v1/admin/codex/login/cancel', '/v1/admin/security',
  '/v1/admin/kakao/skill-url', '/v1/admin/kakao/relay-status', '/v1/admin/bots', '/v1/admin/roles', '/v1/admin/sessions', '/v1/admin/bots/',
  '/v1/admin/roles/',
];
import { webPage as web } from './web-page.mjs'; // 서버가 보내는 화면(사전·t() 포함)

async function hubAndPc(t, hubExtra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-u6-'));
  const logs = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s, ...a) => { logs.push(String(s)); return origWrite(s, ...a); };
  const hub = createApp({ dbPath: join(dir, 'hub.db'), users, devices: [], bindings: [],
    webAccess: { modes: ['ip_allowlist'], ipAllowlist: [ADMIN_IP], trustedProxies: ['127.0.0.1'] }, ...hubExtra(dir) });
  const hubUrl = `http://127.0.0.1:${await hub.listen(0)}`;
  const pc = createApp({ dbPath: join(dir, 'pc.db'), users, devices: [], bindings: [] });
  const pcUrl = `http://127.0.0.1:${await pc.listen(0)}`;
  t.after(async () => { process.stderr.write = origWrite; await hub.close(); await pc.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = (base, path, { method = 'GET', body, xff } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { authorization: 'Bearer web', 'content-type': 'application/json', ...(xff ? { 'x-forwarded-for': xff } : {}) } })
    .then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }));
  const hubCall = (path, o = {}) => call(hubUrl, path, { xff: ADMIN_IP, ...o });
  return { dir, hub, pc, hubUrl, pcUrl, call, hubCall, logs };
}
const plain = (t, extra) => hubAndPc(t, () => extra ?? {});

test('PC 연결 링크: 허브 관리자가 만든 초대로 PC가 연결하면 코드 확인 없이 바로 짝맺기가 끝나고, 초대는 1회용', async (t) => {
  const s = await plain(t);
  const inv = await s.hubCall('/v1/admin/pairings/invite', { method: 'POST', body: {} });
  assert.equal(inv.status, 201);
  assert.match(inv.body.invite, /^[\w-]{43}$/);
  // PC: 링크로 연결(이름을 비우면 컴퓨터 이름)
  const r = await s.call(s.pcUrl, '/v1/admin/local/hub/connect', { method: 'POST', body: { hubUrl: s.hubUrl, invite: inv.body.invite } });
  assert.equal(r.status, 200);
  assert.equal(r.body.approved, true);
  const st = (await s.call(s.pcUrl, '/v1/admin/local/hub')).body;
  assert.equal(st.state, 'paired');
  assert.match(readFileSync(s.pc.hubLink.paths.tokenFile, 'utf8'), /^[0-9a-f]{64}$/);
  // 허브 기기 목록에 들어갔고, 연결 요청(코드 승인 대기)에는 남지 않는다
  assert.ok((await s.hubCall('/v1/admin/devices')).body.devices.some((d) => d.hostId === st.hostId && d.source === 'web'));
  assert.deepEqual((await s.hubCall('/v1/admin/pairings')).body.pairings, []);
  // 같은 초대를 다시 쓰면 거절(1회용), 틀린 초대도 거절 — 코드 확인 대기로 넘어가지 않는다
  const again = await fetch(`${s.hubUrl}/v1/pair/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', invite: inv.body.invite }) });
  assert.equal(again.status, 403);
  assert.equal((await again.json()).error, 'bad_invite');
  const wrong = await fetch(`${s.hubUrl}/v1/pair/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', invite: 'a'.repeat(43) }) });
  assert.equal(wrong.status, 403);
  assert.deepEqual((await s.hubCall('/v1/admin/pairings')).body.pairings, []);
  // 초대 값은 서버 기록에 남지 않는다
  assert.ok(!s.logs.join('').includes(inv.body.invite));
  assert.ok(s.logs.join('').includes('pair_invite_created'));
});

test('PC 연결 링크 보호: 만들기는 접속 제한 안의 관리자만, PC 화면(허브 아님)에는 없음, 아직 안 쓴 초대는 5개까지', async (t) => {
  const s = await plain(t);
  assert.equal((await s.call(s.hubUrl, '/v1/admin/pairings/invite', { method: 'POST', body: {}, xff: '203.0.113.7' })).status, 403);
  assert.equal((await s.call(s.pcUrl, '/v1/admin/pairings/invite', { method: 'POST', body: {} })).status, 404);
  assert.equal((await s.hubCall('/v1/admin/pairings/invite', { method: 'POST', body: { replaceHostId: 'h_none' } })).body.error, 'unknown_device');
  for (let i = 0; i < 5; i += 1) assert.equal((await s.hubCall('/v1/admin/pairings/invite', { method: 'POST', body: {} })).status, 201);
  assert.equal((await s.hubCall('/v1/admin/pairings/invite', { method: 'POST', body: {} })).body.error, 'too_many_invites');
});

test('허브 화면: 목록에 PC(기기 이름)가 붙고, 허브 Codex 로그인이 안 돼 있으면 새 Codex 세션에 로그인 카드', async (t) => {
  let loggedIn = false;
  const codexLogin = { status: async () => ({ loggedIn, method: loggedIn ? 'chatgpt' : null }), start: () => ({ state: 'idle' }), cancel: () => ({ state: 'idle' }), view: () => ({ state: 'idle' }) };
  const s = await hubAndPc(t, (dir) => {
    const ns = join(dir, 'ns.json');
    writeFileSync(ns, JSON.stringify({ enabled: true, workspaceRoot: join(dir, 'ws') }));
    return { codexLogin, newSessionsConfigPath: ns, newSessionsHostId: 'h_hub', devices: [{ tokenSha256: sha('dev'), hostId: 'h_hub' }],
      bindings: [{ conversationId: 'c_pc', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_hub', engine: 'codex_thread', sessionRef: '01a18790-63c7-73e3-a60b-6ddb60fd5be8' }] };
  });
  assert.equal((await s.hubCall('/v1/sessions', { method: 'POST', body: { engine: 'codex', name: 'hub-one' } })).status, 201);
  assert.equal((await s.hubCall('/v1/admin/codex')).body.login.loggedIn, false); // 확인 결과를 서버가 기억
  const list = (await s.hubCall('/v1/conversations')).body.conversations;
  assert.deepEqual(list.map((c) => c.host), [{ id: 'h_hub', name: 'h_hub' }, { id: 'h_hub', name: 'h_hub' }]);
  const kinds = async (id) => (await s.hubCall(`/v1/conversations/${id}/cards`)).body.cards.map((k) => k.kind);
  assert.ok((await kinds('n_hub-one')).includes('hub_codex_login'));
  assert.ok(!(await kinds('c_pc')).includes('hub_codex_login'), '등록한 PC 대화에는 없음(그 PC의 Codex로 실행)');
  loggedIn = true;
  await s.hubCall('/v1/admin/codex');
  assert.ok(!(await kinds('n_hub-one')).includes('hub_codex_login'));
  // PC 화면 목록에는 host가 없다(묶지 않음)
  assert.ok((await s.call(s.pcUrl, '/v1/conversations')).body.conversations.every((c) => !('host' in c)));
});

test('설정 화면: 예전 화면의 관리 항목이 모두 옮겨졌고(누락 0), 새 화면은 예전 화면 대신 설정으로 연결', async (t) => {
  const s = await plain(t);
  const page = await fetch(`${s.pcUrl}/settings`);
  assert.equal(page.status, 200);
  const SET = web('settings.html'); const APP = web('app.html');
  assert.equal(await page.text(), SET);
  // 점검표: 예전 화면 관리 부분의 입력·버튼·목록 ID가 설정 화면에 모두 있다
  assert.equal(OLD_IDS.length, 115);
  assert.deepEqual(OLD_IDS.filter((id) => !SET.includes(`id="${id}"`)), []);
  // 예전 화면이 부르던 관리 API도 모두
  const apis = (h) => new Set([...h.matchAll(/'(\/v1\/admin\/[\w/-]*)/g)].map((m) => m[1]));
  assert.equal(OLD_APIS.length, 33);
  // A2-d: 기기 설정(AI 응답·허용 목록)은 PC형·허브형 공통 명령(/v1/admin/local/run · /v1/admin/hosts/<PC>/run)으로 옮겼다(서버의 예전 주소는 그대로).
  const viaRun = (a) => a.startsWith('/v1/admin/local/device') && SET.includes("'/v1/admin/local/run'") && SET.includes("devRun('device.");
  assert.deepEqual(OLD_APIS.filter((a) => !apis(SET).has(a) && !viaRun(a)), []);
  // 2026-11-20 탭 재구성: 내 설정 5개 + 관리 4개, 예전 탭 이름으로 들어와도 열림
  for (const [grp, tab] of [['me', 'pc'], ['me', 'work'], ['me', 'acct'], ['me', 'msg'], ['me', 'apps'], ['admin', 'reg'], ['admin', 'msgadv'], ['admin', 'hubsec'], ['admin', 'ext']]) assert.ok(SET.includes(`<button type="button" data-grp="${grp}" data-atab="${tab}">`), tab);
  assert.ok(SET.includes("const OLD_TAB = { bots: 'msg', messenger: 'msg', roles: 'msgadv', sessions: 'reg', newsess: 'reg', conv: 'reg', ws: 'work', hub: 'apps', devices: 'apps' };"));
  // PC 연결 링크: https 허브만, 읽은 뒤 주소에서 지움, 허브 화면에서는 연결하지 않음
  assert.ok(SET.includes("if (join && !/^https?:\\/\\/[^\\s/?#@]+$/.test(join.hubUrl)) join = null;"), '규칙 점검 8: http 허브도');
  assert.ok(SET.includes("history.replaceState(null, '', location.pathname + '#apps'); }"));
  assert.ok(SET.includes("if (join && hub) { $('joinHubOnly').hidden = false; join = null; }"));
  assert.ok(!/innerHTML\s*=\s*[^'"`\s]/.test(SET.replace(/innerHTML = ''/g, '')), '서버 값은 textContent로만');
  // 새 화면에서 예전 화면으로 가는 길이 없다
  assert.ok(!APP.includes('/classic'));
  assert.ok(APP.includes("location.href = '/settings#reg'") && APP.includes('href="/settings#msg"') && APP.includes("k.kind === 'hub_codex_login'"));
});