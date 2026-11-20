// I18N-b-2(설계 docs/design/I18N.md 3-6·4절): 번역 문서 — 처리방침·약관 언어 고르기, 설명서 번역본이 있는지, 원본이 바뀌면 알림(오래됨).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/pilot/server.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HANGUL = /[가-힣]/;
// 번역본 → 원본
const TRANSLATIONS = [
  ...['BEGINNER_GUIDE', 'APP_GUIDE', 'MANUAL', 'MESSENGER_MANUAL', 'API_GUIDE', 'MEMBER_GUIDE', 'OPERATIONS'].map((n) => [`docs/en/${n}.md`, `docs/${n}.md`]),
  ['docs/store/PLAY_LISTING.en.md', 'docs/store/PLAY_LISTING.md'],
  ['src/pilot/web/privacy.en.html', 'src/pilot/web/privacy.html'],
  ['src/pilot/web/terms.en.html', 'src/pilot/web/terms.html'],
];
const sourceOf = (text) => text.match(/<!-- source: (\S+) @ ([0-9a-f]{7,40}) -->/);

test('번역 문서: 사람이 읽는 설명서 7종·스토어 글·처리방침·약관의 영어판이 있고, 원본 표시가 있으며, 한국어가 남지 않음', () => {
  for (const [en, ko] of TRANSLATIONS) {
    assert.ok(existsSync(join(ROOT, en)), en);
    const text = readFileSync(join(ROOT, en), 'utf8');
    const m = sourceOf(text);
    assert.ok(m, `${en}: 원본 표시(<!-- source: … @ 커밋 -->)`);
    assert.equal(m[1], ko, `${en}: 원본 경로`);
    // 코드 표기(`…`) 안의 한국어는 그대로 둠 — 한국어 봇의 명령 별칭(`/허용 n`)·실제 봇 이름처럼 그대로 쳐야 하는 글
    const body = text.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/`[^`\n]*`/g, '');
    const left = body.split('\n').filter((l) => HANGUL.test(l));
    assert.deepEqual(left, [], `${en}: 한국어가 남은 줄`);
    const heads = (s) => (s.match(/^#{1,6} /gm) ?? []).length;
    if (en.endsWith('.md')) assert.equal(heads(text), heads(readFileSync(join(ROOT, ko), 'utf8')), `${en}: 제목 수가 원본과 같음`);
  }
});

test('설명서 오래됨: 번역본의 원본 기준 커밋 뒤에 원본이 바뀌었으면 알린다(시험은 실패하지 않고 목록만)', () => {
  let git = true;
  try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd: ROOT, stdio: 'ignore' }); } catch { git = false; }
  if (!git) return;
  const stale = [];
  for (const [en, ko] of TRANSLATIONS) {
    const m = sourceOf(readFileSync(join(ROOT, en), 'utf8'));
    let changed = '';
    try { changed = execFileSync('git', ['log', '--oneline', `${m[2]}..HEAD`, '--', ko], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { continue; } // 기준 커밋이 없는 복사본(얕은 받기)
    if (changed) stale.push(`${en} ← ${ko}: ${changed.split('\n').length}개 커밋 뒤 바뀜`);
  }
  if (stale.length) console.log('[I18N] 번역 문서가 원본보다 오래됨 — 다시 번역하고 원본 표시의 커밋을 고치세요:\n  ' + stale.join('\n  '));
  assert.ok(Array.isArray(stale));
});

test('처리방침·약관: ?lang=en·영어 브라우저는 영어판, 한국어 브라우저·?lang=ko는 한국어 원본, 사전 없는 언어는 영어', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-doc-'));
  const app = createApp({ dbPath: join(dir, 'p.db'), devices: [], bindings: [], users: [] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const get = async (path, lang) => (await fetch(base + path, { headers: lang ? { 'accept-language': lang } : {} })).text();
  for (const page of ['privacy', 'terms']) {
    const ko = readFileSync(join(ROOT, `src/pilot/web/${page}.html`), 'utf8');
    const en = readFileSync(join(ROOT, `src/pilot/web/${page}.en.html`), 'utf8');
    assert.equal(await get(`/${page}`, 'ko-KR'), ko);
    assert.equal(await get(`/${page}`, 'en-US'), en);
    assert.equal(await get(`/${page}?lang=en`, 'ko-KR'), en, '주소의 lang이 먼저');
    assert.equal(await get(`/${page}?lang=ko`, 'en-US'), ko);
    assert.equal(await get(`/${page}`, 'fr-FR'), en);
    assert.match(en, /<html lang="en">/);
  }
});
