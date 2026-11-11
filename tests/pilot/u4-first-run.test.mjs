// U4: 처음 설정 3단계와 첫 질문 확인(UD1) — 대역 시험(모델 0, 실제 Codex 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const APP = readFileSync(fileURLToPath(new URL('../../src/pilot/web/app.html', import.meta.url)), 'utf8');

async function server(t, status) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-u4-'));
  const app = createApp({ dbPath: join(dir, 'pilot.db'), devices: [], bindings: [],
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], localCodexStatus: status });
  const port = await app.listen(0);
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  return (path, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { headers: { authorization: 'Bearer web', ...headers } })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
}

test('준비 확인: 이 PC의 Codex 로그인 여부만 돌려주고 계정 정보는 내보내지 않는다', async (t) => {
  const call = await server(t, async () => ({ loggedIn: true, method: 'chatgpt', email: 'someone@example.com', raw: 'Logged in using ChatGPT' }));
  const r = await call('/v1/admin/local/engines');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { codex: { loggedIn: true, method: 'chatgpt' } });
  assert.equal((await call('/v1/admin/local/engines', { 'x-forwarded-for': '203.0.113.9' })).status, 403, '이 PC에서 연 화면만');
});

test('준비 확인: 확인이 실패하면 로그인 안 됨으로(막지 않고 계속할 수 있게)', async (t) => {
  const call = await server(t, async () => { throw new Error('codex missing'); });
  assert.deepEqual((await call('/v1/admin/local/engines')).body, { codex: { loggedIn: false, method: null } });
});

test('화면: 연결한 대화가 없는 이 PC 화면에서 처음 설정을 열고, 꼭 할 일은 대화 고르기뿐', () => {
  assert.ok(APP.includes('id="setup"') && APP.includes('id="s1"') && APP.includes('id="s2"') && APP.includes('id="s3"'));
  assert.ok(APP.includes("if (device && (location.hash === '#setup' || (!convs.length && !done))) openSetup();"), '이 PC 화면 + 대화 없음(또는 #setup)일 때만');
  assert.ok(APP.includes("loadThreads($('sList'),"), '2단계는 대화 연결과 같은 목록');
  assert.ok(APP.includes("localStorage.setItem('ieon_setup_done', '1')"), '나중에 하기·완료 뒤 다시 열리지 않음');
  assert.ok(APP.includes("'/v1/admin/local/engines'"));
});

test('첫 질문 확인(UD1): AI 응답이 꺼져 있으면 보내기 전에 묻고, 켠 뒤에만 보낸다', () => {
  const send = APP.slice(APP.indexOf('async function send(question)'), APP.indexOf('async function send(question)') + 700);
  const ask = send.indexOf('askFirst()'); const on = send.indexOf('setLive(true, { confirmed: true })'); const post = send.indexOf("/requests'");
  assert.ok(ask > 0 && on > ask && post > on, '확인 → 켜기 → 보내기 순서');
  assert.ok(send.includes("if (device && device.live === false)"), '이 PC 화면에서 꺼져 있을 때만 묻는다(허브·메신저는 서버 기준)');
  assert.ok(send.includes('qa.value = question; return;'), '취소하면 보내지 않고 입력을 돌려준다');
  assert.ok(APP.includes('id="firstAsk"') && APP.includes('켜고 보내기'));
});