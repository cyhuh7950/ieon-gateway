// 허브에서 설치 파일 받기(신산님 2026-11-19 — 저장소는 비공개 그대로): 관리자가 만든 1시간짜리 열쇠가 있을 때만
// 설치 스크립트·묶음을 내줌(새 서버는 접속 허용 목록 밖이어도), 열쇠 없거나 틀리면 404, 가입자는 못 만듦. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { loadDict } from '../../src/i18n/index.mjs'; // I18N-a: 문구는 사전에
const KO = loadDict('ko');

const sha = (s) => createHash('sha256').update(s).digest('hex');

test('설치 링크: 관리자만 만들고, 열쇠로 스크립트·묶음을 받음(허용 목록 밖에서도), 틀린 열쇠는 404', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-inst-'));
  const bundle = join(d, 'b.tar.gz'); writeFileSync(bundle, Buffer.from('fake-tar-gz'));
  const app = createApp({ dbPath: join(d, 'p.db'), installBundle: bundle, webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1', '::1', '::ffff:127.0.0.1'] },
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [], bindings: [] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  const admin = (path, o = {}) => fetch(base + path, { ...o, headers: { authorization: 'Bearer web', 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.9', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'hub.example.com' } });
  const outsider = (path) => fetch(base + path, { headers: { 'x-forwarded-for': '203.0.113.77' } });
  const r = await admin('/v1/admin/install-link', { method: 'POST', body: '{}' });
  assert.equal(r.status, 201);
  const j = await r.json();
  const m = j.command.match(/^curl -fsSL https:\/\/hub\.example\.com\/install\/([\w-]{20,40})\/install\.sh \| sh$/);
  assert.ok(m, j.command); assert.equal(j.bundle, true);
  const sh = await outsider(`/install/${m[1]}/install.sh`);
  assert.equal(sh.status, 200);
  const script = await sh.text();
  assert.ok(script.includes(`BASE='https://hub.example.com/install/${m[1]}'`) && script.includes('tar -xz') && script.includes('</dev/tty') && script.includes('deploy/server/install.sh'));
  const tgz = await outsider(`/install/${m[1]}/ieon-gateway.tar.gz`);
  assert.equal(tgz.status, 200); assert.equal(Buffer.from(await tgz.arrayBuffer()).toString(), 'fake-tar-gz');
  assert.equal((await outsider('/install/AAAAAAAAAAAAAAAAAAAAAAAA/install.sh')).status, 404, '틀린 열쇠');
  assert.equal((await outsider('/v1/admin/install-link')).status === 201, false, '밖에서는 못 만듦');
});

test('묶음·화면: 허브 이미지가 설치 묶음을 만들고, 설정에 설치 명령 칸, 설치 끝 안내가 허브 명령을 가리킴', () => {
  const df = readFileSync(new URL('../../deploy/hub/Dockerfile', import.meta.url), 'utf8');
  assert.ok(df.includes('COPY deploy/ ./deploy/') && df.includes('tar -czf /app/ieon-gateway.tar.gz package.json package-lock.json src scripts deploy'));
  const SET = readFileSync(new URL('../../src/pilot/web/settings.html', import.meta.url), 'utf8');
  assert.ok(SET.includes('id="instBox"') && SET.includes("'/v1/admin/install-link'"));
  assert.ok(readFileSync(new URL('../../deploy/server/install.sh', import.meta.url), 'utf8').includes("허브 화면의 '서버 설치 명령'"));
});

test('업데이트(2026-11-19 daon 실측): 설치 스크립트는 터미널이 실제로 열릴 때만 질문을 터미널에서, 다시 설치하면 이미 있는 칸도 새 판으로', () => {
  const srv = readFileSync(new URL('../../src/pilot/server.mjs', import.meta.url), 'utf8');
  assert.ok(srv.includes("if (exec </dev/tty) 2>/dev/null; then exec sh deploy/server/install.sh </dev/tty; else exec sh deploy/server/install.sh </dev/null; fi"));
  const ieun = readFileSync(new URL('../../deploy/hub/ieun.sh', import.meta.url), 'utf8');
  assert.ok(ieun.includes('  update)') && ieun.includes('up -d --force-recreate'));
  const sh = readFileSync(new URL('../../deploy/server/install.sh', import.meta.url), 'utf8');
  assert.ok(sh.includes("sed -n 's/^ieun-engine-//p'") && sh.includes('deploy/hub/ieun.sh engine update'));
  assert.ok(srv.includes("label: i18nT('server.account.cell_codex')") && KO['server.account.cell_codex'] === '서버 칸의 Codex 로그인(허브 로그인을 같이 씀)', '엔진 칸 대화 계정 문구');
});
