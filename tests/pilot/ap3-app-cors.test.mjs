// AP-3: 이어온 앱(다른 출처)이 서버를 부를 수 있게 — 앱 출처만 CORS 허용, 쿠키는 허용하지 않음(열쇠로만), 앱 폴더 기본 확인. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const root = fileURLToPath(new URL('../../', import.meta.url));

async function setup(t, extra = {}) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-ap3-'));
  const app = createApp({ dbPath: join(d, 'p.db'), ...extra,
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }],
    devices: [{ tokenSha256: sha('dev'), hostId: 'h_pc' }],
    bindings: [{ conversationId: 'c1', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: '01a18790-0000-7000-8000-000000000001' }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  return { app, base };
}

test('앱 출처(https://localhost·capacitor://localhost·app://ieon)만 CORS 허용, 쿠키 허용 없음, 미리 묻기(OPTIONS)에 필요한 헤더', async (t) => {
  const s = await setup(t);
  for (const origin of ['https://localhost', 'capacitor://localhost', 'app://ieon']) {
    const pre = await fetch(s.base + '/v1/conversations', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, idempotency-key' } });
    assert.equal(pre.status, 204, origin);
    assert.equal(pre.headers.get('access-control-allow-origin'), origin);
    assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
    assert.match(pre.headers.get('access-control-allow-headers'), /idempotency-key/);
    assert.equal(pre.headers.get('access-control-allow-credentials'), null, '쿠키 허용 없음');
    const r = await fetch(s.base + '/v1/conversations', { headers: { origin, authorization: 'Bearer web' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), origin);
  }
  // 다른 출처에는 허용 헤더가 없다(브라우저가 응답을 못 읽음)
  const evil = await fetch(s.base + '/v1/conversations', { headers: { origin: 'https://evil.example', authorization: 'Bearer web' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const evilPre = await fetch(s.base + '/v1/conversations', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.notEqual(evilPre.status, 204);
  assert.equal(evilPre.headers.get('access-control-allow-origin'), null);
  // 화면(/)·설정에는 붙이지 않음
  const page = await fetch(s.base + '/', { headers: { origin: 'https://localhost' } });
  assert.equal(page.headers.get('access-control-allow-origin'), null);
});

test('연결 코드 받기와 새 소식(SSE)도 앱 출처에서 읽을 수 있음, 개발용 출처는 설정 파일로만 추가', async (t) => {
  const s = await setup(t, { appOrigins: ['http://localhost:3340'] });
  const pair = await fetch(s.base + '/v1/app/pair', { method: 'POST', headers: { origin: 'https://localhost', 'content-type': 'application/json' }, body: JSON.stringify({ code: '00000000' }) });
  assert.equal(pair.status, 403);
  assert.equal(pair.headers.get('access-control-allow-origin'), 'https://localhost', '틀린 코드 오류도 앱이 읽을 수 있음');
  const ac = new AbortController(); t.after(() => ac.abort());
  const ev = await fetch(s.base + '/v1/events', { headers: { origin: 'app://ieon', authorization: 'Bearer web' }, signal: ac.signal });
  assert.equal(ev.headers.get('access-control-allow-origin'), 'app://ieon');
  assert.equal(ev.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const dev = await fetch(s.base + '/v1/conversations', { headers: { origin: 'http://localhost:3340', authorization: 'Bearer web' } });
  assert.equal(dev.headers.get('access-control-allow-origin'), 'http://localhost:3340');
  ac.abort();
});

test('앱 폴더: 서버와 분리된 package.json, 열쇠는 Bearer로만, 정적 내보내기, PC 설치형 출처 app://ieon', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'app/package.json'), 'utf8'));
  assert.equal(pkg.name, 'ieon-app');
  const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const dep of ['next', 'electron', '@capacitor/core']) assert.ok(!JSON.stringify(rootPkg).includes(`"${dep}"`), `서버 package.json에 ${dep} 없음`);
  const api = readFileSync(join(root, 'app/src/lib/api.ts'), 'utf8');
  assert.ok(api.includes('authorization: "Bearer "') && !api.includes('credentials: "include"'));
  assert.ok(readFileSync(join(root, 'app/next.config.ts'), 'utf8').includes('output: "export"'));
  assert.ok(readFileSync(join(root, 'app/electron/main.cjs'), 'utf8').includes('app://ieon/'));
  assert.ok(existsSync(join(root, 'app/capacitor.config.ts')));
});

test('AP-3b: 앱 열쇠로 방 만들기·글 보내기·AI 직원 이름 바꾸기가 되고, 설정(역할 목록)은 안 됨', async (t) => {
  const s = await setup(t);
  const H = (tok, extra = {}) => ({ authorization: `Bearer ${tok}`, 'content-type': 'application/json', origin: 'https://localhost', ...extra });
  const code = (await (await fetch(s.base + '/v1/admin/app-devices/code', { method: 'POST', headers: H('web'), body: '{}' })).json()).code;
  const { token } = await (await fetch(s.base + '/v1/app/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: '폰' }) })).json();
  const st = await fetch(s.base + '/v1/conversations/c1/staff', { method: 'PUT', headers: H(token), body: JSON.stringify({ name: '코덱스', icon: '🛠', roleId: null }) });
  assert.equal(st.status, 200); assert.equal((await st.json()).name, '코덱스');
  const room = await fetch(s.base + '/v1/rooms', { method: 'POST', headers: H(token), body: JSON.stringify({ name: '팀', members: ['c1'], lead: 'c1', guide: '' }) });
  assert.equal(room.status, 201);
  const { roomId } = await room.json();
  await fetch(s.base + '/v1/device/jobs', { headers: { authorization: 'Bearer dev' } }); // PC 연결 표시
  const post = await fetch(s.base + `/v1/rooms/${roomId}/posts`, { method: 'POST', headers: H(token, { 'idempotency-key': 'app-room-0001' }), body: JSON.stringify({ text: '@코덱스 안녕' }) });
  assert.equal(post.status, 202);
  assert.equal(post.headers.get('access-control-allow-origin'), 'https://localhost');
  const posts = (await post.json()).posts;
  assert.deepEqual(posts.map((p) => p.kind), ['user', 'ask']);
  assert.ok(!JSON.stringify(posts).includes('resend'), '다시 보내기용 원문은 내보내지 않음');
  assert.equal((await (await fetch(s.base + '/v1/admin/roles', { headers: H(token) })).json()).error, 'app_not_allowed');
});

test('V1 음성: 웹 화면에 말로 쓰기·읽어 주기·처음 안내, 받아쓴 글은 입력칸에만(바로 보내지 않음), 음성 승인 없음, 서버는 음성을 받지 않음', () => {
  const A = readFileSync(join(root, 'src/pilot/web/app.html'), 'utf8');
  assert.ok(A.includes('id="micBtn"') && A.includes('id="speakBtn"') && A.includes('id="voiceAsk"'));
  assert.ok(A.includes("rec.lang = 'ko-KR'"));
  const mic = A.slice(A.indexOf("$('micBtn').onclick"), A.indexOf("$('compose').onsubmit"));
  assert.ok(mic.includes('qa.value =') && !mic.includes('requestSubmit') && !mic.includes('send('), '받아쓴 글은 입력칸에만');
  assert.ok(!/decide|approvals/.test(mic), '음성으로 승인하지 않음');
  assert.ok(A.includes('카드 버튼으로만'));
  const S = readFileSync(join(root, 'src/pilot/server.mjs'), 'utf8');
  assert.ok(!/audio|voice/i.test(S.replace(/\/\/.*$/gm, '')), '서버는 음성을 받거나 저장하지 않음');
  const P = readFileSync(join(root, 'app/android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.ok(!P.includes('RECORD_AUDIO'), '안드로이드 앱은 마이크 권한을 갖지 않음(기기 받아쓰기 창이 녹음)');
});
