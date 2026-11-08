// 봇 토큰 비밀 파일(KEY=값 줄). 웹에서 입력한 토큰을 여기에 쓴다(2026-11-08 신산님: 모든 설정은 웹에서).
// 값은 다시 읽어 보여 주지 않는다(있음/없음만). 파일은 권한 600, 임시 파일에 쓴 뒤 바꿔치기한다. 주석·다른 줄은 그대로 둔다.
import { existsSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';

const NAME = /^[A-Z][A-Z0-9_]{1,80}$/;

export function parseEnvText(text) {
  const env = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

export const readEnvFile = (path) => (path && existsSync(path) ? parseEnvText(readFileSync(path, 'utf8')) : {});

export function validSecretValue(v) {
  return typeof v === 'string' && v.length >= 1 && v.length <= 4096 && !/[\r\n\0]/.test(v) && v.trim() === v && !/^['"]|['"]$/.test(v);
}

// value가 null이면 그 줄을 지운다. 이름·값 검사는 호출하는 쪽과 여기서 한 번 더 한다.
export function writeEnvValue(path, name, value) {
  if (!NAME.test(name)) throw Object.assign(new Error('bad_secret_name'), { http: 400 });
  if (value !== null && !validSecretValue(value)) throw Object.assign(new Error('bad_secret_value'), { http: 400 });
  const lines = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n') : [];
  const re = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
  const out = lines.filter((l) => !re.test(l));
  if (value !== null) out.push(`${name}=${value}`);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, out.filter((l, i) => l !== '' || i < out.length - 1).join('\n') + '\n', { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}
