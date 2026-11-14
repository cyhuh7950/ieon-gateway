// 미리 보기 그림을 한 장으로 모으기: node tools/video/sheet.mjs <폴더> <출력.png>
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const [dir, out] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => /^f_[\d.]+\.png$/.test(f)).sort((a, b) => parseFloat(a.slice(2)) - parseFloat(b.slice(2)));
const args = files.flatMap((f) => ['-i', join(dir, f)]);
const filt = files.map((_, k) => `[${k}:v]scale=480:270[v${k}]`).join(';') + ';' + files.map((_, k) => `[v${k}]`).join('')
  + `xstack=inputs=${files.length}:layout=${files.map((_, k) => `${(k % 4) * 480}_${Math.floor(k / 4) * 270}`).join('|')}:fill=black`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args, '-filter_complex', filt, '-frames:v', '1', out]);
console.log('sheet', files.length, out);
