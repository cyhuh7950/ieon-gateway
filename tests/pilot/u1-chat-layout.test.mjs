// U1: 대화 중심 새 화면(설계 UI_CHAT_FIRST) — `/` 새 화면(U8에서 예전 화면 `/classic`은 없애고 설정으로 보냄), 기존 API만, 서버 데이터는 textContent로(모델 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';
import { loadDict } from '../../src/i18n/index.mjs'; // I18N-a: 문구는 사전에
import { koView } from './web-page.mjs'; // I18N-a: 문구를 사전으로 옮긴 화면을 한국어 코드 모양으로 펼쳐 읽음
const KO = loadDict('ko');

const web = (f) => readFileSync(fileURLToPath(new URL(`../../src/pilot/web/${f}`, import.meta.url)), 'utf8');
const APP = koView('app.html');

test('서버: `/`는 새 화면, 예전 주소 `/classic`은 설정 화면으로', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-u1-'));
  const app = createApp({ dbPath: join(dir, 'pilot.db'), devices: [], users: [], bindings: [] });
  const port = await app.listen(0);
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const get = (p) => fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual' }).then(async (r) => ({ status: r.status, type: r.headers.get('content-type'), text: await r.text() }));
  const root = await get('/');
  assert.equal(root.status, 200);
  assert.match(root.type, /text\/html/);
  assert.ok(root.text.includes('id="liveSwitch"') && root.text.includes('연결 설정'), '새 화면');
  const classic = await fetch(`http://127.0.0.1:${port}/classic`, { redirect: 'manual' });
  assert.equal(classic.status, 302);
  assert.equal(classic.headers.get('location'), '/settings');
});

test('새 화면은 서버 데이터를 HTML로 넣지 않는다(innerHTML 없음)', () => {
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(APP));
});

test('새 화면은 이미 있는 API만 부른다', () => {
  const allowed = new Set(['/v1/auth/state', '/v1/auth/local', '/v1/auth/login', '/v1/auth/setup', '/v1/auth/logout', '/v1/auth/signup',
    '/v1/conversations', '/v1/conversations/', '/v1/requests/', '/v1/sessions/', '/v1/admin/local/device', '/v1/admin/local/device/live',
    '/v1/admin/denied', '/v1/admin/denied/allow', // U2: 메신저 허용 요청
    '/v1/admin/local/threads', '/v1/admin/connections', // U3
    '/v1/admin/local/engines', // U4: 처음 설정 준비 확인
    '/v1/admin/bots', '/v1/admin/secrets', '/v1/admin/secrets/', '/v1/admin/kakao/skill-url', '/v1/admin/messenger/claim', '/v1/admin/messenger/claim?platform=', // U5: 메신저 연결
    '/v1/sessions', '/v1/sessions/limits', '/v1/admin/line/webhook-url', '/v1/admin/local/mode', // M1: 사용 방식
    '/v1/rooms', '/v1/rooms/', '/v1/admin/roles', '/v1/roles', // AP-1: 방·AI 직원 역할
    '/v1/approvals/', // W1: 승인 카드
    '/v1/approvals', '/v1/tasks?filter=active', '/v1/tasks?limit=30', '/v1/tasks/', // RC3: 작업 화면(승인 대기함·작업 목록·작업 하나)
    '/v1/admin/hosts/', // 가입자 대화 붙이기: 허브에서 고른 PC의 Codex 대화(기존 기기 명령 API)
    '/v1/admin/devices', // SV2: 새 세션 만들 곳(허브의 PC·엔진 칸) 고르기(기존 API)
    '/v1/voice/config?lang=', '/v1/voice/live', '/v1/voice/live/', '/v1/voice/speak', '/v1/voice/dictate', '/v1/voice/transcribe?sec=', // V2 OpenAI 음성
    '/v1/events', '/v1/webpush/key', '/v1/webpush/subscription']); // 웹 알림(탭을 닫아도) // AP-4a: 새 소식(알림, AP-2에서 만든 API) // U8, L1(라인 webhook 주소): 새 세션 만들기(예전 화면에서 옮김, 기존 API)
  const used = [...new Set([...APP.matchAll(/'(\/v1\/[^'+]*)'/g)].map((m) => m[1]))];
  assert.ok(used.length >= 8, used.join(','));
  for (const p of used) assert.ok(allowed.has(p), `새 API를 부르면 안 됨: ${p}`);
});

// U6: 새 화면은 설정 화면(/settings)의 탭으로 연결한다.
test('새 화면에서 여는 설정 탭은 실제로 있다', () => {
  const SETTINGS = koView('settings.html');
  const hashes = [...new Set([...APP.matchAll(/\/settings#([a-z]+)/g)].map((m) => m[1]))];
  assert.deepEqual(hashes.sort(), ['acct', 'apps', 'hubsec', 'msg', 'pc', 'reg']); // 2026-11-20 탭 재구성(hub→apps, conv→reg) // SV3-b: API 계정 한도 카드 → 계정 탭 // M1: 사용 방식 안내 → 이 PC 탭
  for (const h of hashes) assert.ok(SETTINGS.includes(`data-atab="${h}"`), h);
  assert.ok(SETTINGS.includes('href="/"'), '설정 화면에서 대화로 돌아갈 수 있다');
});

test('휴대폰 폭에서는 목록과 대화를 번갈아 보여 준다', () => {
  assert.match(APP, /@media \(max-width: 760px\)/);
  assert.ok(APP.includes('.app:not(.in-chat) .chat') && APP.includes('.app.in-chat .side'));
  assert.ok(APP.includes('id="backBtn"'));
});

test('보낼 수 없는 이유와 확인 필요는 대화 안에 보이고, 자동으로 다시 보내지 않는다', () => {
  for (const code of ['device_unavailable', 'desktop_holds_thread', 'live_disabled', 'session_not_running', 'session_archived']) assert.ok(KO['errors.' + code], code);
  assert.ok(APP.includes("'/review'") || APP.includes('/review'), '확인 필요 정리 버튼');
  assert.ok(!/setTimeout\([^)]*requests'[^)]*method: 'POST'/.test(APP));
  // 질문은 사용자가 보낼 때만, 매번 새 중복 방지 키로
  assert.equal((APP.match(/\/requests', \{ method: 'POST'/g) || []).length, 1);
  assert.ok(APP.includes("'idempotency-key': crypto.randomUUID()"));
});