// I18N-a-4: 저장소 맨 위 locales/<언어>/의 common·errors·app 사전을 앱 안(src/locales)으로 복사한다(빌드 전에 자동 — package.json prebuild).
// 채우기 함수(src/i18n/format.mjs)도 TS로 복사하고, PC 앱 바깥 글(창 제목·메뉴)은 electron/locales.json으로 만든다.
// 손으로 고치지 말고 이 도구를 다시 돌린다(시험이 같은지 확인).
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const OUT = fileURLToPath(new URL('../src/locales/', import.meta.url));
export const ELECTRON_OUT = fileURLToPath(new URL('../electron/locales.json', import.meta.url));
export const ANDROID_RES = fileURLToPath(new URL('../android/app/src/main/res/', import.meta.url));
const NS = ['common', 'errors', 'app'];

// 돌려주는 값: { files: { '<src/locales 안 파일 이름>': 내용 }, electron: 'electron/locales.json 내용' }
export function build() {
  const langs = readdirSync(`${ROOT}locales`, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort((a, b) => (a === 'ko' ? -1 : b === 'ko' ? 1 : a.localeCompare(b)));
  const files = {}; const el = {};
  for (const l of langs) {
    const flat = {};
    for (const ns of NS) {
      const p = `${ROOT}locales/${l}/${ns}.json`;
      if (!existsSync(p)) continue;
      for (const [k, v] of Object.entries(JSON.parse(readFileSync(p, 'utf8')))) flat[`${ns}.${k}`] = v;
    }
    files[`${l}.json`] = JSON.stringify(flat, null, 2) + '\n';
    el[l] = Object.fromEntries(Object.entries(flat).filter(([k]) => k === 'common.product' || k.startsWith('app.electron.')));
  }
  const fmt = readFileSync(`${ROOT}src/i18n/format.mjs`, 'utf8').replace(/\r\n/g, '\n');
  files['format.ts'] = '// 자동 생성(app/scripts/copy-locales.mjs) — 원본 src/i18n/format.mjs\n// @ts-nocheck\n' + fmt.replace(/^\/\/.*\n/gm, '');
  const id = (l) => l.replace(/-/g, '_');
  files['index.ts'] = '// 자동 생성(app/scripts/copy-locales.mjs) — 원본 locales/<언어>/{common,errors,app}.json\n'
    + langs.map((l) => `import ${id(l)} from "./${l}.json";`).join('\n') + '\n'
    + 'export { ieonFormat } from "./format";\n'
    + `export const LOCALES: Record<string, Record<string, string>> = { ${langs.map((l) => `"${l}": ${id(l)}`).join(', ')} };\n`;
  // 안드로이드 앱 이름: 기본(values) = 영어(사전 없는 언어의 기기도 영어), 그 밖 언어는 values-<언어>. 기본 파일의 나머지 값은 그대로.
  const android = {};
  const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, "\\'");
  const name = (l) => xmlEsc(JSON.parse(files[`${l}.json`])['common.product']);
  const def = langs.includes('en') ? 'en' : 'ko';
  const base = readFileSync(`${ANDROID_RES}values/strings.xml`, 'utf8').replace(/\r\n/g, '\n');
  android['values/strings.xml'] = base.replace(/(<string name="(?:app_name|title_activity_main)">)[^<]*(<\/string>)/g, (all, a, b) => a + name(def) + b);
  for (const l of langs.filter((x) => x !== def)) {
    android[`values-${l}/strings.xml`] = `<?xml version='1.0' encoding='utf-8'?>\n<!-- 자동 생성(app/scripts/copy-locales.mjs) -->\n<resources>\n    <string name="app_name">${name(l)}</string>\n    <string name="title_activity_main">${name(l)}</string>\n</resources>\n`;
  }
  return { files, electron: JSON.stringify(el, null, 2) + '\n', android };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { files, electron, android } = build();
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  for (const [f, s] of Object.entries(files)) writeFileSync(OUT + f, s);
  writeFileSync(ELECTRON_OUT, electron);
  for (const [f, s] of Object.entries(android)) { mkdirSync(ANDROID_RES + f.split('/')[0], { recursive: true }); writeFileSync(ANDROID_RES + f, s); }
  console.log(`앱 사전 ${Object.keys(files).length}개 → app/src/locales, PC 앱 바깥 글 → app/electron/locales.json`);
}
