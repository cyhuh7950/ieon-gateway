// SV1 엔진 칸(SERVER_SESSIONS 2-8 결정 A): 서버의 엔진 칸을 PC 한 대처럼 — 이 컨테이너 안에서 이어온 서버(허브 연결 모드)와
// 연결부를 돌리고, 허브와 1회용 초대로 자동 짝짓는다. 허브 입장에서는 PC가 하나 더 붙은 것과 같다(목록에 "서버 · 이름").
// 사용: node src/engine/run.mjs <데이터 폴더(/data)>
//  - 처음이면 /data/.local 아래에 PC와 같은 설정을 만든다(scripts/ieon-init.mjs의 initLocal, 토큰은 해시만 설정에, 원문은 권한 600 파일).
//  - 사용 방식은 ② 허브 연결(mode.json). 메신저·카카오는 이 칸에서 켜지 않는다(허브가 맡음).
//  - 아직 짝짓지 않았고 /data/invite(ieun.sh engine add가 허브에서 받아 넣은 1회용 초대)가 있으면 IEON_HUB_URL로 짝짓고 초대 파일을 지운다.
//  - 그 뒤 서버를 켜면 서버가 짝지은 허브로 연결부를 띄운다(hub_link_resume). 하나가 끝나면 다시 켠다.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initLocal } from '../../scripts/ieon-init.mjs';
import { writeMode, readMode } from '../pilot/mode.mjs';
import { createHubLink } from '../pilot/hub-link.mjs';
import { supervise } from '../hub/run.mjs';

const log = (e) => process.stderr.write(JSON.stringify({ ch: 'engine', ...e }) + '\n');

export function enginePaths(data) {
  const L = posix.join(data, '.local');
  return { local: L, server: posix.join(L, 's2/server.json'), connector: posix.join(L, 's2/connector.json'), mode: posix.join(L, 'mode.json'),
    hubDir: posix.join(L, 's2/hub'), invite: posix.join(data, 'invite') };
}

// 처음 한 번: PC와 같은 설정 + 사용 방식 ②. 이미 있으면 그대로 둔다(토큰이 바뀌지 않게).
export function prepareEngine(data) {
  const p = enginePaths(data);
  const made = existsSync(p.server) ? [] : initLocal(data, { workspaceRoot: posix.join(data, 'workspaces') });
  if (readMode(p.mode) !== 'hub') writeMode(p.mode, 'hub');
  return made;
}

// 아직 짝짓지 않았으면 초대로 짝짓는다. 초대는 한 번 쓰면 지운다(성공·실패 모두 — 10분짜리 1회용이라 다시 쓸 수 없음).
export async function pairIfNeeded(data, { hubUrl = process.env.IEON_HUB_URL, name = process.env.IEON_ENGINE_NAME, linkImpl = createHubLink, waitMs = 30000 } = {}) {
  const p = enginePaths(data);
  if (existsSync(join(p.hubDir, 'hub.json'))) return 'paired';
  if (!existsSync(p.invite)) return 'no_invite';
  if (!hubUrl || !name) return 'no_hub_url';
  const invite = readFileSync(p.invite, 'utf8').trim();
  const link = linkImpl({ dir: p.hubDir, connectorConfigPath: p.connector, pollMs: 1000 });
  try {
    await link.connect({ hubUrl, name, invite });
    const end = Date.now() + waitMs;
    while (Date.now() < end && link.status().state !== 'paired') { await new Promise((r) => setTimeout(r, 500)); await link.pollOnce?.().catch(() => {}); }
    return link.status().state === 'paired' ? 'paired_now' : 'pair_failed';
  } catch (e) {
    log({ event: 'pair_error', error: String(e.message).slice(0, 60) });
    return 'pair_failed';
  } finally {
    link.close?.();
    rmSync(p.invite, { force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = process.argv[2] ?? '/data';
  const made = prepareEngine(data);
  if (made.length) log({ event: 'initialized', files: made.length });
  log({ event: 'pair', result: await pairIfNeeded(data) });
  const p = enginePaths(data);
  supervise([{ name: 'server', args: ['src/pilot/server.mjs', p.server], delayMs: 0 }], { log });
}
