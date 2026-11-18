// AP-5: 나눠 줄 앱(최신 안드로이드 정식 APK·PC 설치 파일)과 판 정보(meta.json)를 .local/apps/에 모은다. 허브에는 배포 때 데이터 폴더 apps/로 복사.
// 사용: node scripts/publish-apps.mjs
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(ROOT, '.local', 'apps');
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); return false; };
const latest = (dir, re) => existsSync(dir) ? readdirSync(dir).map((f) => [f, f.match(re)?.[1]]).filter(([, v]) => v).sort((a, b) => (newer(a[1], b[1]) ? -1 : 1))[0] ?? null : null;
const sha = (f) => new Promise((ok) => { const h = createHash('sha256'); createReadStream(f).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))); });
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) rmSync(join(OUT, f));
const meta = {};
const apk = latest(join(ROOT, 'app/dist/release'), /^ieon-android-(\d+\.\d+\.\d+)\.apk$/); // 정식 서명판만(디버그 제외)
if (apk) {
  const code = Number(readFileSync(join(ROOT, 'app/android/app/build.gradle'), 'utf8').match(/versionCode (\d+)/)?.[1] ?? 0);
  const src = join(ROOT, 'app/dist/release', apk[0]); copyFileSync(src, join(OUT, apk[0]));
  meta.android = { version: apk[1], versionCode: code, file: apk[0], size: statSync(src).size, sha256: await sha(src) };
}
const exe = latest(join(ROOT, 'app/dist/desktop'), /^ieon-setup-(\d+\.\d+\.\d+)\.exe$/);
if (exe) {
  const src = join(ROOT, 'app/dist/desktop', exe[0]); copyFileSync(src, join(OUT, exe[0]));
  meta.desktop = { version: exe[1], file: exe[0], size: statSync(src).size, sha256: await sha(src) };
}
meta.publishedAt = new Date().toISOString();
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
console.log('올릴 앱:', [meta.android && 'android ' + meta.android.version, meta.desktop && 'PC ' + meta.desktop.version].filter(Boolean).join(', ') || '없음');
