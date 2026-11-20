// U7: PC 창(Edge 앱 창, UD5) · 휴대폰 폭 배치 · 홈 화면 추가(PWA). 모델 0, 외부 접속 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';
import { koView } from './web-page.mjs'; // I18N-a: 문구를 사전으로 옮긴 화면을 한국어 코드 모양으로 펼쳐 읽음

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const pngSize = (b) => ({ sig: b.subarray(1, 4).toString(), w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

test('홈 화면 추가: 설치 정보(manifest)와 아이콘 192·512 PNG를 준다', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-u7-'));
  const app = createApp({ dbPath: join(dir, 'p.db'), devices: [], bindings: [], users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const m = await fetch(base + '/manifest.webmanifest');
  assert.equal(m.status, 200);
  assert.match(m.headers.get('content-type'), /^application\/manifest\+json/);
  const man = await m.json();
  assert.equal(man.start_url, '/'); assert.equal(man.display, 'standalone'); assert.equal(man.name, '이어온');
  for (const size of [192, 512]) {
    const icon = man.icons.find((i) => i.sizes === `${size}x${size}` && i.purpose === 'any');
    const r = await fetch(base + icon.src);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.deepEqual(pngSize(Buffer.from(await r.arrayBuffer())), { sig: 'PNG', w: size, h: size });
  }
  assert.ok(man.icons.some((i) => i.purpose === 'maskable'));
});

test('두 화면 모두 홈 화면 추가 정보를 걸고, 오프라인 캐시(서비스 워커)는 두지 않는다', () => {
  for (const f of ['src/pilot/web/app.html', 'src/pilot/web/settings.html']) {
    const h = read(f);
    assert.ok(h.includes('<link rel="manifest" href="/manifest.webmanifest">') && h.includes('<meta name="theme-color"') && h.includes('<link rel="apple-touch-icon" href="/icon-192.png">'), f);
    assert.ok(!h.includes('caches.') && !/serviceWorker\.register\((?!'\/sw\.js')/.test(h), f + ': 옛 화면을 캐시해 보여 주지 않음');
  }
  // 웹 알림용 서비스 워커는 알림만 — 요청 가로채기·저장 없음
  const sw = read('src/pilot/web/sw.js');
  assert.ok(!sw.includes("addEventListener('fetch'") && !sw.includes('caches.'), 'sw.js는 알림만');
});

test('휴대폰 폭: 새 화면 버튼 44px, 설정 화면은 표가 페이지를 넓히지 않고 입력칸·탭이 커진다', () => {
  const app = koView('app.html');
  const mq = app.slice(app.indexOf('@media (max-width: 760px)'));
  assert.match(mq, /\.row, \.side-bottom a, \.side-bottom button, \.pbtn, \.back, \.switch, \.addbtn, \.acts a, \.acts button, \.modal button, \.linkbtn, #panelBtn \{ min-height:44px; \}/);
  assert.ok(app.includes('@media (display-mode: standalone)'), '홈 화면 앱에서 상태 표시줄에 가리지 않음');
  const set = read('src/pilot/web/settings.html');
  // 2026-11-20 디자인 통일: 분기점 760px(대화 화면과 같음), 표는 한 줄에 한 카드로 쌓고(옆으로 밀지 않음) 누를 것·입력칸 44px
  const smq = set.slice(set.indexOf('@media (max-width:760px)'));
  for (const rule of ['table.list, table.list tbody, table.list tr, table.list td { display:block; width:100%; }', 'table.list thead { display:none; }', 'button, a.btn, nav.atabs button, table.list td button { min-height:44px; }', 'input:not([type=checkbox]):not([type=radio]), select, textarea { min-height:44px; font-size:16px; }']) assert.ok(smq.includes(rule), rule);
});

test('PC 창: Edge가 있으면 바탕화면 바로 가기를 Edge 앱 창으로, 없으면 예전처럼 브라우저 탭', () => {
  const s = read('scripts/install.ps1');
  assert.ok(s.includes("$AppLink = Join-Path $Desktop '이어온.lnk'"));
  assert.ok(s.includes('$lnk.TargetPath = $Edge; $lnk.Arguments = "--app=$Url"'));
  assert.ok(s.includes('Remove-Item $Shortcut -ErrorAction SilentlyContinue -Confirm:$false  # 예전 브라우저 탭 바로 가기는 지운다'));
  assert.ok(/\} else \{\n  Set-Content -Path \$Shortcut -Value "\[InternetShortcut\]/.test(s.replace(/\r\n/g, '\n')), 'Edge가 없으면 .url');
  assert.ok(s.includes('if ($Edge) { Start-Process $Edge "--app=$Url" } else { Start-Process $Url }'));
  assert.ok(s.replace(/\r\n/g, '\n').includes('  Remove-Item $AppLink -ErrorAction SilentlyContinue -Confirm:$false\n  Stop-Ieon'), '제거할 때 앱 창 바로 가기도');
});

test('PC 창: 설치 미리보기가 어떤 바로 가기를 만들지 알려 준다', { skip: process.platform !== 'win32' }, () => {
  const r = spawnSync('pwsh', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; & ./scripts/install.ps1 -DryRun'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /바로 가기: .*(이어온\.lnk \(Edge 앱 창\)|이어온\.url \(브라우저 탭\))/);
});