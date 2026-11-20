// AP-5 앱 나눠 주기(구글 플레이 대신 허브에서): 판 정보·/app 이동·파일 받기, 접속 제한이 켜져 있어도 받을 수 있음, 판 정보에 없는 파일은 못 받음. 모델 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';
import { koView } from './web-page.mjs'; // I18N-a: 문구를 사전으로 옮긴 화면을 한국어 코드 모양으로 펼쳐 읽음

const sha = (s) => createHash('sha256').update(s).digest('hex');

test('허브: 판 정보·/app → APK·파일 받기(접속 제한 예외), 판 정보에 없는 파일·경로 바꾸기는 거절', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-ap5-'));
  const apps = join(d, 'apps'); mkdirSync(apps);
  writeFileSync(join(apps, 'ieon-android-0.1.6.apk'), 'APKDATA');
  writeFileSync(join(apps, 'secret.txt'), 'nope');
  writeFileSync(join(apps, 'meta.json'), JSON.stringify({ android: { version: '0.1.6', versionCode: 7, file: 'ieon-android-0.1.6.apk', size: 7, sha256: sha('APKDATA') } }));
  const app = createApp({ dbPath: join(d, 'p.db'), appsDir: apps, webAccess: { modes: ['ip_allowlist'], ipAllowlist: ['198.51.100.9'], trustedProxies: ['127.0.0.1'] },
    users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [], bindings: [] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  const get = (p) => fetch(base + p, { redirect: 'manual', headers: { 'x-forwarded-for': '203.0.113.7' } }); // 허용 목록에 없는 휴대폰
  assert.equal((await get('/v1/conversations')).status, 403, '다른 것은 접속 제한 그대로');
  assert.equal((await (await get('/v1/app/version')).json()).android.version, '0.1.6');
  const r = await get('/app');
  assert.deepEqual([r.status, r.headers.get('location')], [302, '/download/ieon-android-0.1.6.apk']);
  const f = await get('/download/ieon-android-0.1.6.apk');
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.equal(await f.text(), 'APKDATA');
  assert.equal((await get('/download/secret.txt')).status, 404, '판 정보에 없는 파일');
  assert.equal((await get('/download/..%2Fp.db')).status, 404, '폴더 밖');
});

test('올려 둔 앱이 없으면 빈 판 정보, /app은 404', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-ap5b-'));
  const app = createApp({ dbPath: join(d, 'p.db'), appsDir: join(d, 'none'), users: [], devices: [], bindings: [] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  assert.deepEqual(await (await fetch(base + '/v1/app/version')).json(), {});
  assert.equal((await fetch(base + '/app', { redirect: 'manual' })).status, 404);
});

test('설정 화면에 앱 받기, 정식 서명 키 파일은 git에 들어가지 않음', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const set = koView('settings.html');
  assert.ok(set.includes('id="appDl"') && set.includes("api('/v1/app/version')"));
  const gradle = readFileSync(join(root, 'app/android/app/build.gradle'), 'utf8');
  assert.ok(gradle.includes(".local/app-signing/keystore.properties") && !/storePassword\s+['"]/.test(gradle), '비밀번호를 빌드 파일에 적지 않음');
});
