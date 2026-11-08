// 이어온 아이콘(ieon.ico) 만들기. 청록 둥근 사각형 위에 흰색 "ㅇ"+"ㅣ"(= 이). 외부 부품 없이 직접 그린다.
// 사용: node scripts/make-icon.mjs  → src/pilot/web/ieon.ico (16·32·48 크기)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BG = [0x1f, 0x6f, 0x6b]; // 청록
const FG = [0xff, 0xff, 0xff];

// 0~1 좌표계에서 점 하나의 색(배경 알파·글자 여부)
function sample(x, y) {
  // 둥근 사각형(가장자리 여백 0.04, 모서리 반경 0.22)
  const m = 0.04, r = 0.22;
  const cx = Math.min(Math.max(x, m + r), 1 - m - r), cy = Math.min(Math.max(y, m + r), 1 - m - r);
  const inBg = (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= m && x <= 1 - m && y >= m && y <= 1 - m;
  if (!inBg) return null;
  // ㅇ: 중심 (0.40, 0.50), 바깥 반경 0.20, 두께 0.075
  const d = Math.hypot(x - 0.40, y - 0.50);
  const ring = d <= 0.20 && d >= 0.20 - 0.075;
  // ㅣ: x 0.69~0.765, y 0.24~0.76
  const bar = x >= 0.69 && x <= 0.765 && y >= 0.24 && y <= 0.76;
  return ring || bar ? 'fg' : 'bg';
}

function render(size) {
  const ss = 4; // 가장자리를 부드럽게(4x4 표본)
  const px = Buffer.alloc(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      let a = 0, fg = 0;
      for (let i = 0; i < ss; i++) for (let j = 0; j < ss; j++) {
        const s = sample((col + (j + 0.5) / ss) / size, (row + (i + 0.5) / ss) / size);
        if (s) { a++; if (s === 'fg') fg++; }
      }
      const n = ss * ss; const t = a ? fg / a : 0;
      const c = BG.map((b, k) => Math.round(b * (1 - t) + FG[k] * t));
      // BMP는 아래에서 위로, BGRA
      const o = ((size - 1 - row) * size + col) * 4;
      px[o] = c[2]; px[o + 1] = c[1]; px[o + 2] = c[0]; px[o + 3] = Math.round((a / n) * 255);
    }
  }
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); header.writeInt32LE(size, 4); header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14); header.writeUInt32LE(0, 16);
  header.writeUInt32LE(px.length, 20);
  const maskRow = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRow * size); // 알파를 쓰므로 AND 마스크는 0
  return Buffer.concat([header, px, mask]);
}

export function makeIcon(sizes = [16, 32, 48]) {
  const images = sizes.map(render);
  const dir = Buffer.alloc(6 + 16 * sizes.length);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(sizes.length, 4);
  let offset = dir.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    dir.writeUInt8(s, e); dir.writeUInt8(s, e + 1); dir.writeUInt8(0, e + 2); dir.writeUInt8(0, e + 3);
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(images[i].length, e + 8); dir.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([dir, ...images]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = fileURLToPath(new URL('../src/pilot/web/ieon.ico', import.meta.url));
  writeFileSync(out, makeIcon());
  console.log('아이콘을 만들었습니다: src/pilot/web/ieon.ico');
}
