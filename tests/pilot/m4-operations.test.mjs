// M4 공용 서비스 운영 준비(2026-11-19 신산님 "9번까지 차례로"): 가입할 때 약관 동의, 이용 약관 화면(누구나), 가입자 하루 질문 한도(관리자가 정함). 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { loadDict } from '../../src/i18n/index.mjs'; // I18N-a: 문구는 사전에
import { koView } from './web-page.mjs'; // I18N-a: 문구를 사전으로 옮긴 화면을 한국어 코드 모양으로 펼쳐 읽음
const KO = loadDict('ko');

const sha = (s) => createHash('sha256').update(s).digest('hex');
const T1 = '01a18790-0000-7000-8000-0000000000e1';

async function hub(t) {
  const d = mkdtempSync(join(tmpdir(), 'ieon-m4-'));
  const app = createApp({ dbPath: join(d, 'p.db'), webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1', '::1', '::ffff:127.0.0.1'] },
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [], bindings: [] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  const browser = (ip = '198.51.100.9') => {
    let cookie = '';
    return async (path, { method = 'GET', body, key } = {}) => {
      const r = await fetch(base + path, { method, body: body && JSON.stringify(body), headers: { 'content-type': 'application/json', origin: base, 'x-forwarded-for': ip, ...(key ? { 'idempotency-key': 'idem-' + key + '-0000' } : {}), ...(cookie ? { cookie } : {}) } });
      const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
    };
  };
  return { app, base, browser };
}

test('M4: 약관·처리방침 화면은 접속 제한 밖에서도 열림, 가입은 동의해야 하고 동의한 때를 남김', async (t) => {
  const { app, base, browser } = await hub(t);
  for (const p of ['/terms', '/privacy']) {
    const r = await fetch(base + p, { headers: { 'x-forwarded-for': '203.0.113.50', 'accept-language': 'ko-KR' } }); // 허용 목록 밖, 한국어 브라우저
    assert.equal(r.status, 200, p); const html = await r.text();
    assert.ok(p === '/terms' ? html.includes('이용 약관') && html.includes('하루에 보낼 수 있는 질문 수') : html.includes('가입 정보'), p);
  }
  const admin = browser(); const u = browser();
  await admin('/v1/auth/setup', { method: 'POST', body: { password: 'admin-password-123' } });
  await admin('/v1/admin/settings/multi-user', { method: 'PUT', body: { enabled: true } });
  assert.equal((await u('/v1/auth/signup', { method: 'POST', body: { email: 'u@example.com', password: 'u-password-123' } })).body.error, 'terms_required');
  assert.equal((await u('/v1/auth/signup', { method: 'POST', body: { email: 'u@example.com', password: 'u-password-123', agree: 'yes' } })).body.error, 'terms_required');
  assert.equal((await u('/v1/auth/signup', { method: 'POST', body: { email: 'u@example.com', password: 'u-password-123', agree: true } })).status, 201);
  const row = (await admin('/v1/admin/users')).body.users[0];
  assert.ok(row.termsAt && Date.parse(row.termsAt) > 0, '동의한 때');
  assert.equal(app.store.listUsers()[0].termsAt, row.termsAt);
});

test('M4: 가입자 하루 질문 한도 — 기본·사람별(0은 한도 없음, 비우면 기본), 넘으면 보내지 않고 member_limit, 가입자는 한도를 못 바꿈', async (t) => {
  const { app, base, browser } = await hub(t);
  const admin = browser(); const u = browser();
  await admin('/v1/auth/setup', { method: 'POST', body: { password: 'admin-password-123' } });
  await admin('/v1/admin/settings/multi-user', { method: 'PUT', body: { enabled: true } });
  await u('/v1/auth/signup', { method: 'POST', body: { email: 'u@example.com', password: 'u-password-123', agree: true } });
  const uid = (await admin('/v1/admin/users')).body.users[0].userId;
  await admin(`/v1/admin/users/${uid}/approve`, { method: 'POST', body: {} });
  assert.equal((await u('/v1/admin/settings/member-limits', { method: 'PUT', body: { perDay: 1000 } })).body.error, 'admin_only');
  assert.equal((await admin('/v1/admin/settings/member-limits', { method: 'PUT', body: { perDay: -1 } })).body.error, 'bad_limit');
  assert.equal((await admin('/v1/admin/settings/member-limits', { method: 'PUT', body: { users: { u_0000000000000000: 3 } } })).body.error, 'bad_limit', '없는 사람');
  assert.deepEqual((await admin('/v1/admin/settings/member-limits', { method: 'PUT', body: { perDay: 2 } })).body, { perDay: 2, users: {} });
  // 가입자의 PC(기기 열쇠로 한 번 조회해 켜짐)와 대화 — 질문 접수까지만 본다
  const dev = await u('/v1/admin/devices', { method: 'POST', body: { hostId: 'h_upc', name: '내 PC' } });
  await fetch(base + '/v1/device/jobs', { headers: { authorization: `Bearer ${dev.body.token}` } });
  // 한 대화는 한 번에 하나만 처리하므로 질문마다 다른 대화(같은 가입자)로
  for (let i = 1; i <= 6; i++) assert.equal(app.store.saveBinding(uid, { conversationId: 'c_u' + i, label: 'u' + i, engine: 'codex_thread', hostId: 'h_upc', sessionRef: T1.slice(0, -1) + i, appIds: ['app_web'] }).http, 200);
  let n = 0;
  const ask = () => { n += 1; return u('/v1/conversations/c_u' + n + '/requests', { method: 'POST', body: { question: 'q' + n }, key: 'k' + n }); };
  const r1 = await ask(); assert.equal(r1.status, 202, JSON.stringify(r1.body));
  assert.equal((await ask()).status, 202);
  const over = await ask();
  assert.deepEqual([over.status, over.body.error, over.body.limit, over.body.used], [429, 'member_limit', 2, 2]);
  let list = (await admin('/v1/admin/users')).body; let row = list.users[0];
  assert.deepEqual([row.todayQuestions, row.limit, row.effectiveLimit, list.defaultPerDay], [2, null, 2, 2]);
  await admin('/v1/admin/settings/member-limits', { method: 'PUT', body: { users: { [uid]: 0 } } }); // 그 사람만 한도 없음
  assert.equal((await ask()).status, 202);
  await admin('/v1/admin/settings/member-limits', { method: 'PUT', body: { users: { [uid]: null } } }); // 기본을 따름
  row = (await admin('/v1/admin/users')).body.users[0];
  assert.deepEqual([row.limit, row.effectiveLimit], [null, 2]);
  assert.equal((await ask()).body.error, 'member_limit');
});

test('M4: 화면 — 가입 동의 칸·약관 링크, 관리자 한도 칸, 안내 문구', () => {
  const APP = koView('app.html');
  assert.ok(APP.includes('id="agree"') && APP.includes('href="/terms"') && APP.includes('agree: true') && KO['errors.member_limit']);
  const SET = koView('settings.html');
  assert.ok(SET.includes('id="muPerDay"') && SET.includes("'/v1/admin/settings/member-limits'"));
});
