// 규칙 점검 7·10(2026-11-18 신산님 선택): 승인 카드 시간·로그인 유지 기간을 웹 설정으로, 지우기는 이름 입력 대신 확인 창. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { validateApprovalTtl, validateLoginDays } from '../../src/pilot/settings.mjs';
import { appServerTurn } from '../../src/pilot/adapters/codex-thread.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sha = (s) => createHash('sha256').update(s).digest('hex');

async function server(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-ra-'));
  const app = createApp({ dbPath: join(dir, 'pilot.db'), devices: [],
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], bindings: [] });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = async (path, { method = 'GET', body, bearer } = {}) => {
    const r = await fetch(base + path, { method, body: body && JSON.stringify(body), headers: { 'content-type': 'application/json', origin: base,
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } });
    return { status: r.status, body: await r.json().catch(() => null), set: r.headers.get('set-cookie') };
  };
  return { call };
}

test('7·10: 설정값 검사(승인 15분~24시간, 로그인 1~90일)', () => {
  assert.deepEqual(validateApprovalTtl({ minutes: 60 }), { minutes: 60 });
  for (const v of [{ minutes: 14 }, { minutes: 1441 }, { minutes: 'x' }, {}]) assert.throws(() => validateApprovalTtl(v), /bad_approval_ttl/);
  assert.deepEqual(validateLoginDays({ days: 30 }), { days: 30 });
  for (const v of [{ days: 0 }, { days: 91 }, {}]) assert.throws(() => validateLoginDays(v), /bad_login_days/);
});

test('7·10: 웹 설정 API — 기본 15분·30일, 바꾸면 쿠키 유지 기간이 바뀜', async (t) => {
  const s = await server(t);
  const v = (await s.call('/v1/admin/settings', { bearer: 'web' })).body;
  assert.deepEqual([v.approvalTtl, v.loginDays], [{ minutes: 15, source: 'file' }, { days: 30, source: 'file' }]);
  // 이 PC 화면 자동 로그인 쿠키: 기본 30일(전에는 12시간)
  assert.match((await s.call('/v1/auth/local', { method: 'POST' })).set, /Max-Age=2592000/);
  assert.equal((await s.call('/v1/admin/settings/approval-ttl', { method: 'PUT', bearer: 'web', body: { minutes: 120 } })).body.approvalTtl.minutes, 120);
  assert.equal((await s.call('/v1/admin/settings/login-days', { method: 'PUT', bearer: 'web', body: { days: 7 } })).body.loginDays.days, 7);
  assert.equal((await s.call('/v1/admin/settings/approval-ttl', { method: 'PUT', bearer: 'web', body: { minutes: 5 } })).body.error, 'bad_approval_ttl');
  assert.match((await s.call('/v1/auth/local', { method: 'POST' })).set, /Max-Age=604800/);
});

test('7: 작업 모드 차례는 승인 카드를 기다리는 동안 시간 제한을 멈춘다', async () => {
  let handler; const sent = [];
  const transport = { send: (m) => { sent.push(m); reply(m); }, onMessage: (h) => { handler = h; }, close() {} };
  const T = 'thread-1';
  function reply(m) {
    if (m.method === 'initialize') return setImmediate(() => handler({ id: m.id, result: {} }));
    if (m.method === 'thread/resume') return setImmediate(() => handler({ id: m.id, result: {} }));
    if (m.method === 'turn/start') {
      setImmediate(() => handler({ id: m.id, result: { turn: { id: 'turn-1' } } }));
      // 승인 요청 → 사람이 시간 제한(50ms)보다 오래(150ms) 걸려 허용 → 차례 완료
      setTimeout(() => handler({ id: 900, method: 'item/commandExecution/requestApproval', params: { threadId: T, turnId: 'turn-1', itemId: 'i1', command: 'npm test' } }), 5);
    }
    if (m.id === 900 && m.result) {
      setTimeout(() => { handler({ method: 'item/completed', params: { threadId: T, turnId: 'turn-1', item: { type: 'agentMessage', text: '끝' } } });
        handler({ method: 'turn/completed', params: { threadId: T, turn: { id: 'turn-1', status: 'completed' } } }); }, 10);
    }
  }
  const approve = () => new Promise((ok) => setTimeout(() => ok('accept'), 150));
  const r = await appServerTurn(transport, { threadId: T, question: 'q', cwd: 'C:/w', approve, timeoutMs: 50 });
  assert.equal(r.answer, '끝');
  assert.equal(sent.find((m) => m.id === 900).result.decision, 'accept');
});

test('10: 지우기는 이름 입력 대신 확인 창(새 세션·기기)', () => {
  const app = readFileSync(join(ROOT, 'src/pilot/web/app.html'), 'utf8');
  const set = readFileSync(join(ROOT, 'src/pilot/web/settings.html'), 'utf8');
  assert.ok(!app.includes('을 입력하세요') && app.includes("JSON.stringify({ confirm: c.newSession.name })"));
  assert.ok(!set.includes('기기 이름 "') && set.includes("JSON.stringify({ confirm: d.name })"));
  assert.ok(set.includes('id="ttlForm"') && set.includes("saveSetting('approval-ttl'") && set.includes("saveSetting('login-days'"));
});
