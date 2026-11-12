// M1(INSTALL_MODES): 이 PC의 사용 방식 하나를 .local/mode.json에 둔다. ① 'pc'(이 PC에서만) · ② 'hub'(내 허브에 연결).
// ③(공용 서비스)은 M2·M3에서. 서버가 이 값으로 맞지 않는 기능을 켜지 않는다(화면에서 숨기는 것만이 아니라 서버가 거부).
// 파일이 없으면(예전 설치) null — 지금처럼 동작하고 화면이 고르기를 권한다(허브에 짝맺어 있으면 ② 추천).
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
  if (to === 'hub') return { off: ['이 PC의 메신저 봇(텔레그램·디스코드·슬랙·라인)', '이 PC의 카카오 중계 연결', '이 PC 화면에서 질문 보내기'], on: ['허브 연결(허브 화면에서 질문·메신저·이 PC 설정)'] };
  return { off: ['허브 연결(짝맺은 정보는 남겨 둠 — 다시 ②로 바꾸면 이어짐)'], on: ['이 PC의 메신저 봇·카카오 중계(설정해 둔 것)', '이 PC 화면에서 질문 보내기'] };
}
