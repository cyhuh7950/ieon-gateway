// U1: 대화 중심 새 화면(설계 UI_CHAT_FIRST) — `/` 새 화면, `/classic` 예전 화면, 기존 API만, 서버 데이터는 textContent로(모델 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';

const web = (f) => readFileSync(fileURLToPath(new URL(`../../src/pilot/web/${f}`, import.meta.url)), 'utf8');
const APP = web('app.html');
const CLASSIC = web('index.html');

test('서버: `/`는 새 화면, `/classic`은 예전 화면', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-u1-'));
  const app = createApp({ dbPath: join(dir, 'pilot.db'), devices: [], users: [], bindings: [] });
  const port = await app.listen(0);
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const get = (p) => fetch(`http://127.0.0.1:${port}${p}`).then(async (r) => ({ status: r.status, type: r.headers.get('content-type'), text: await r.text() }));
  const root = await get('/');
  assert.equal(root.status, 200);
  assert.match(root.type, /text\/html/);
  assert.ok(root.text.includes('id="liveSwitch"') && root.text.includes('연결 설정'), '새 화면');
  const classic = await get('/classic');
  assert.equal(classic.status, 200);
  assert.ok(classic.text.includes('id="atabs"'), '예전 화면');
  assert.notEqual(root.text, classic.text);
});

test('새 화면은 서버 데이터를 HTML로 넣지 않는다(innerHTML 없음)', () => {
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(APP));
});

test('새 화면은 이미 있는 API만 부른다', () => {
  const allowed = new Set(['/v1/auth/state', '/v1/auth/local', '/v1/auth/login', '/v1/auth/setup', '/v1/auth/logout',
    '/v1/conversations', '/v1/conversations/', '/v1/requests/', '/v1/sessions/', '/v1/admin/local/device', '/v1/admin/local/device/live',
    '/v1/admin/denied', '/v1/admin/denied/allow']); // U2: 메신저 허용 요청
  const used = [...new Set([...APP.matchAll(/'(\/v1\/[^'+]*)'/g)].map((m) => m[1]))];
  assert.ok(used.length >= 8, used.join(','));
  for (const p of used) assert.ok(allowed.has(p), `새 API를 부르면 안 됨: ${p}`);
});

test('새 화면에서 여는 예전 화면 탭은 실제로 있다', () => {
  const hashes = [...new Set([...APP.matchAll(/\/classic#([a-z]+)/g)].map((m) => m[1]))];
  assert.deepEqual(hashes.sort(), ['bots', 'pc', 'sessions']);
  for (const h of hashes) assert.ok(CLASSIC.includes(`data-atab="${h}"`), h);
  assert.ok(CLASSIC.includes('function openHash') && CLASSIC.includes('href="/"'), '예전 화면은 주소의 탭을 열고 새 화면으로 돌아갈 수 있다');
});

test('휴대폰 폭에서는 목록과 대화를 번갈아 보여 준다', () => {
  assert.match(APP, /@media \(max-width: 760px\)/);
  assert.ok(APP.includes('.app:not(.in-chat) .chat') && APP.includes('.app.in-chat .side'));
  assert.ok(APP.includes('id="backBtn"'));
});

test('보낼 수 없는 이유와 확인 필요는 대화 안에 보이고, 자동으로 다시 보내지 않는다', () => {
  for (const code of ['device_unavailable', 'desktop_holds_thread', 'live_disabled', 'session_not_running', 'session_archived']) assert.ok(APP.includes(code + ':'), code);
  assert.ok(APP.includes("'/review'") || APP.includes('/review'), '확인 필요 정리 버튼');
  assert.ok(!/setTimeout\([^)]*requests'[^)]*method: 'POST'/.test(APP));
  // 질문은 사용자가 보낼 때만, 매번 새 중복 방지 키로
  assert.equal((APP.match(/\/requests', \{ method: 'POST'/g) || []).length, 1);
  assert.ok(APP.includes("'idempotency-key': crypto.randomUUID()"));
});