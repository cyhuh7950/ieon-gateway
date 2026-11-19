// U8: 예전 화면 제거 마무리 — 예전 대화 화면의 기능도 새 화면에 모두 있음(누락 0), 새 세션 만들기, 설명서에 예전 화면 안내 없음(모델 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const APP = read('src/pilot/web/app.html');

// 예전 화면(2026-11-12 index.html) 대화 부분이 부르던 API. U6 점검표는 관리 부분만 봐서 "새 세션 만들기"가 빠졌다(U8에서 발견·추가).
const OLD_CONV_APIS = ['/v1/auth/setup', '/v1/auth/login', '/v1/auth/logout', '/v1/auth/state', '/v1/auth/local', '/v1/sessions/limits', '/v1/conversations', '/v1/sessions/', '/v1/conversations/', '/v1/requests/'];

test('예전 대화 화면의 기능이 새 화면에 모두 있다(새 세션 만들기 포함)', () => {
  assert.ok(!existsSync(join(root, 'src/pilot/web/index.html')), '예전 화면 파일은 없앰');
  assert.deepEqual(OLD_CONV_APIS.filter((a) => !APP.includes(`'${a}`)), []);
  assert.ok(APP.includes("api('/v1/sessions', { method: 'POST'"), '새 세션 만들기');
  assert.ok(APP.includes('<button type="button" class="addbtn" id="newSessBtn" hidden>＋ 새 세션</button>'), '기본은 숨김');
  assert.ok(APP.includes("$('newSessBtn').hidden = r.status !== 200;"), '새 세션 기능이 켜져 있을 때만 보임');
  assert.ok(APP.includes('허브 연결을 끊으려면 설정 → 앱과 기기 → 허브 연결에서 "연결 끊기".'), '카드가 실제 위치를 가리킴');
});

test('새 세션: 기능이 꺼져 있으면 한도 API가 403(버튼 숨김), 켜면 200이고 만들 수 있다', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-u8-'));
  const apps = [];
  t.after(async () => { for (const a of apps) await a.close(); rmSync(dir, { recursive: true, force: true }); }); // 서버를 먼저 닫고 폴더를 지운다
  const make = async (ns) => {
    let nsPath;
    if (ns) { nsPath = join(dir, 'ns.json'); writeFileSync(nsPath, JSON.stringify({ enabled: true, workspaceRoot: join(dir, 'ws') })); }
    const app = createApp({ dbPath: join(dir, ns ? 'on.db' : 'off.db'), ...(nsPath ? { newSessionsConfigPath: nsPath } : {}),
      users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }], bindings: [] });
    const base = `http://127.0.0.1:${await app.listen(0)}`;
    apps.push(app);
    return (p, init = {}) => fetch(base + p, { ...init, headers: { authorization: 'Bearer web', 'content-type': 'application/json' } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  };
  const off = await make(false);
  assert.equal((await off('/v1/sessions/limits')).status, 403);
  const on = await make(true);
  assert.equal((await on('/v1/sessions/limits')).status, 200);
  const r = await on('/v1/sessions', { method: 'POST', body: JSON.stringify({ engine: 'codex', name: 'u8-one', profile: 'workspace' }) });
  assert.equal(r.status, 201);
  assert.ok((await on('/v1/conversations')).body.conversations.some((c) => c.conversationId === r.body.conversationId));
});

test('설명서는 새 화면만 안내한다(예전 화면·봇 관리 탭 없음)', () => {
  for (const f of ['docs/MANUAL.md', 'docs/MESSENGER_MANUAL.md', 'docs/BEGINNER_GUIDE.md', 'docs/API_GUIDE.md']) {
    const t = read(f);
    assert.ok(!/봇 관리|\/classic|예전 화면|이 PC 탭/.test(t), f);
    assert.ok(t.includes('2026-11-19'), f + ': 기준 날짜'); // 2026-11-19 설명서 전체 점검으로 기준 날짜를 옮김
  }
});