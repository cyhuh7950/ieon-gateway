// 이어온 아이콘 한 벌 만들기(2026-11-18 신산님 "D로 하자" — 잇는 다리). 원본: scripts/icon/ieon-mark.svg(배경 없는 표식).
// 사용: node scripts/make-icons.mjs  (그림 변환은 app/node_modules의 sharp — 앱 빌드 부품에 이미 있음, 새 설치 없음)
// 만드는 것: 웹(icon-192·512 png, ieon.ico), PC 앱(app/build/icon.ico), 안드로이드(실행 아이콘·둥근 아이콘·적응형 앞그림·시작 화면).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const sharp = createRequire(join(ROOT, 'app/package.json'))('sharp');
const BG = '#0B4F43'; // 짙은 청록
const BG2 = '#04342C'; // 아래쪽 더 짙게
const mark = readFileSync(join(ROOT, 'scripts/icon/ieon-mark.svg'), 'utf8').replace(/<\?xml[^>]*>/, '');
const inner = mark.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

// 배경 + 표식. shape: 'round'(둥근 사각) | 'circle' | 'square'(꽉 참) | 'none'(투명). scale: 표식 크기(1 = 원본 그대로)
function svg({ shape = 'round', scale = 1 } = {}) {
  const off = (1024 - 1024 * scale) / 2;
  const bg = shape === 'none' ? '' : `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG}"/><stop offset="1" stop-color="${BG2}"/></linearGradient></defs>`
    + (shape === 'circle' ? '<circle cx="512" cy="512" r="512" fill="url(#g)"/>' : shape === 'square' ? '<rect width="1024" height="1024" fill="url(#g)"/>' : '<rect width="1024" height="1024" rx="228" fill="url(#g)"/>');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${bg}<g transform="translate(${off} ${off}) scale(${scale})">${inner}</g></svg>`);
}
const png = (opts, size) => sharp(svg(opts), { density: 384 }).resize(size, size).png().toBuffer();

// ICO(그 안에 PNG를 담는 형식, Windows Vista 이후)
function ico(pngs) {
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length); let offset = 6 + dir.length;
  pngs.forEach(({ size, buf }, i) => {
    const o = i * 16; dir[o] = size >= 256 ? 0 : size; dir[o + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(buf.length, o + 8); dir.writeUInt32LE(offset, o + 12); offset += buf.length;
  });
  return Buffer.concat([head, dir, ...pngs.map((p) => p.buf)]);
}
const icoOf = async (sizes) => ico(await Promise.all(sizes.map(async (size) => ({ size, buf: await png({ shape: 'round', scale: size <= 32 ? 1.12 : 1 }, size) }))));

const out = [];
const save = (p, buf) => { mkdirSync(join(ROOT, p, '..'), { recursive: true }); writeFileSync(join(ROOT, p), buf); out.push(p); };

// 웹: 홈 화면 추가용(가득 찬 사각 — 휴대폰이 모양을 잘라도 표식이 안 잘림)
save('src/pilot/web/icon-192.png', await png({ shape: 'square', scale: 0.86 }, 192));
save('src/pilot/web/icon-512.png', await png({ shape: 'square', scale: 0.86 }, 512));
save('src/pilot/web/ieon.ico', await icoOf([16, 32, 48]));
// PC 앱
save('app/build/icon.ico', await icoOf([16, 24, 32, 48, 64, 128, 256]));
// 안드로이드 실행 아이콘(mdpi 48 기준) · 적응형 앞그림(108dp 중 안전 영역 66dp 안에 표식)
const RES = join(ROOT, 'app/android/app/src/main/res');
const D = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(D)) {
  save(`app/android/app/src/main/res/mipmap-${d}/ic_launcher.png`, await png({ shape: 'round' }, Math.round(48 * k)));
  save(`app/android/app/src/main/res/mipmap-${d}/ic_launcher_round.png`, await png({ shape: 'circle', scale: 0.9 }, Math.round(48 * k)));
  save(`app/android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png`, await png({ shape: 'none', scale: 0.6 }, Math.round(108 * k)));
}
// 적응형 아이콘 배경색
const bgXml = join(RES, 'values/ic_launcher_background.xml');
writeFileSync(bgXml, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`); out.push('values/ic_launcher_background.xml');
// 시작 화면: 있는 splash.png마다 같은 크기로 — 짙은 청록 바탕 가운데 표식
for (const dir of readdirSync(RES).filter((x) => x.startsWith('drawable'))) {
  const f = join(RES, dir, 'splash.png');
  if (!existsSync(f)) continue;
  const { width, height } = await sharp(f).metadata();
  const side = Math.round(Math.min(width, height) * 0.42);
  const markPng = await png({ shape: 'none' }, side);
  const buf = await sharp({ create: { width, height, channels: 4, background: BG2 } }).composite([{ input: markPng, gravity: 'center' }]).png().toBuffer();
  save(`app/android/app/src/main/res/${dir}/splash.png`, buf);
}
console.log(`만든 파일 ${out.length}개`);
