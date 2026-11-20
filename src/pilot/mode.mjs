// M1(INSTALL_MODES): 이 PC의 사용 방식 하나를 .local/mode.json에 둔다. ① 'pc'(이 PC에서만) · ② 'hub'(내 허브에 연결).
// ③(공용 서비스)은 M2·M3에서. 서버가 이 값으로 맞지 않는 기능을 켜지 않는다(화면에서 숨기는 것만이 아니라 서버가 거부).
// 파일이 없으면(예전 설치) null — 지금처럼 동작하고 화면이 고르기를 권한다(허브에 짝맺어 있으면 ② 추천).
import { t as i18nT } from '../i18n/index.mjs';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const MODES = ['pc', 'hub'];

export function readMode(path) {
  if (!path || !existsSync(path)) return null;
  try { const m = JSON.parse(readFileSync(path, 'utf8')).mode; return MODES.includes(m) ? m : null; } catch { return null; }
}

export function writeMode(path, mode) {
  if (!MODES.includes(mode)) throw Object.assign(new Error('bad_mode'), { http: 400 });
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ mode, setAt: new Date().toISOString() }, null, 2) + '\n');
  renameSync(tmp, path);
}

// 바꿀 때 무엇이 꺼지고 켜지는지(화면이 확인 전에 보여 준다)
export function modeEffects(from, to) {
  // I18N-b: 글(서버 언어)과 키를 같이 — 화면이 보는 사람 언어로 다시 바꿈
  const both = (off, on) => ({ off: off.map((k) => i18nT(k)), on: on.map((k) => i18nT(k)), offKeys: off, onKeys: on });
  if (to === 'hub') return both(['server.mode.off_hub.bots', 'server.mode.off_hub.kakao', 'server.mode.local_web'], ['server.mode.on_hub']);
  return both(['server.mode.off_pc'], ['server.mode.on_pc.bots', 'server.mode.local_web']);
}
