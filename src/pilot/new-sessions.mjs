// 새 세션 만들기(설계: docs/design/NEW_SESSIONS.md) 설정·이름·권한 규칙. 모델·파일 시스템을 건드리지 않는 순수 함수만 둔다.
import { rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, posix, resolve, win32 } from 'node:path';

// Claude 새 세션은 채널(기존 실행 중 세션)이 아니라 claude -p로 실행하는 별도 엔진이다(N2).
// E4(2026-11-19 신산님 "9번까지 차례로"): Antigravity 새 세션(agy -p, 처음 질문에 새 대화 → 받은 대화 ID로 이어 씀). Grok은 실제 시험 보류라 아직.
export const NEW_ENGINES = Object.freeze({ codex: 'codex_thread', claude: 'claude_cli', antigravity: 'agy_cli' });
// Antigravity 실행 방식(--mode): plan(읽기만·계획) / accept-edits(파일 고치기 허용) / auto(명령까지). 권한 프로필마다 기본값.
export const AGY_MODES = new Set(['plan', 'accept-edits', 'auto']);
const AGY_DEFAULT = { read_only: { mode: 'plan' }, workspace: { mode: 'accept-edits' }, full: { mode: 'auto' } };
export const SESSION_STATES = Object.freeze(['pending', 'active', 'sleeping', 'archived']);
const CODEX_SANDBOXES = new Set(['read-only', 'workspace-write']);

const DEFAULTS = Object.freeze({
  enabled: true, // 신산님 2026-11-17 "기본 켜기": 설치하면 바로 새 세션을 만들 수 있게(끄려면 설정 파일 enabled:false 또는 화면)
  workspaceRoot: process.platform === 'win32' ? 'D:/ieon-workspaces' : '~/ieon-workspaces',
  // app_bot_*: 웹 봇 관리에서 정의한 모든 추가 봇(MULTI_BOTS 4절)
  creatorApps: ['app_web', 'app_messenger', 'app_bot_*'],
  // 규칙 점검 9(2026-11-18 신산님): 처음 쓸 때 걸리지 않게 넉넉히(전에는 전체 10·동시 3·Claude 3). 웹에서 바꿀 수 있음.
  limits: { maxSessions: 30, maxActive: 5, maxPerEngine: { codex: 30, claude: 10, antigravity: 10 } },
  permissions: {
    default: 'workspace',
    allowFullFromChat: false,
    profiles: {
      read_only: { codex: { sandbox: 'read-only', network: false }, claude: { allowedTools: ['Read', 'Grep', 'Glob'] }, agy: AGY_DEFAULT.read_only },
      workspace: { codex: { sandbox: 'workspace-write', network: false },
        claude: { allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'] }, agy: AGY_DEFAULT.workspace },
      full: { codex: { sandbox: 'workspace-write', network: true },
        claude: { allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'WebFetch'] }, agy: AGY_DEFAULT.full },
    },
  },
  cleanup: { idleSleepMinutes: 30, archiveAfterDays: 14, archiveNoticeDays: 3, deleteRequiresConfirm: true, deleteWorkspaceOnClose: false },
  sessionOverrides: {},
});

const fail = (why) => { throw new Error(`new_sessions_config:${why}`); };
const posInt = (v, why) => { if (!Number.isInteger(v) || v < 1) fail(why); return v; };

// 설정 파일 내용(raw)에 기본값을 채우고 검사한다. 잘못된 값은 조용히 고치지 않고 거부한다.
export function loadNewSessionsConfig(raw = {}) {
  const limits = { ...DEFAULTS.limits, ...raw.limits, maxPerEngine: { ...DEFAULTS.limits.maxPerEngine, ...raw.limits?.maxPerEngine } };
  posInt(limits.maxSessions, 'maxSessions');
  posInt(limits.maxActive, 'maxActive');
  if (limits.maxActive > limits.maxSessions) fail('maxActive_over_maxSessions');
  for (const e of Object.keys(NEW_ENGINES)) posInt(limits.maxPerEngine[e], `maxPerEngine.${e}`);

  const permissions = { ...DEFAULTS.permissions, ...raw.permissions,
    profiles: { ...DEFAULTS.permissions.profiles, ...raw.permissions?.profiles } };
  for (const [name, p] of Object.entries(permissions.profiles)) {
    if (p && !p.agy) permissions.profiles[name] = { ...p, agy: AGY_DEFAULT[name] ?? { mode: 'plan' } }; // 예전 설정 파일(agy 없음)은 이름별 기본, 모르는 이름은 읽기만
    if (!AGY_MODES.has(permissions.profiles[name]?.agy?.mode)) fail(`profile.${name}.agy`);
    if (!CODEX_SANDBOXES.has(p?.codex?.sandbox) || typeof p.codex.network !== 'boolean') fail(`profile.${name}.codex`);
    if (!Array.isArray(p?.claude?.allowedTools) || p.claude.allowedTools.some((x) => typeof x !== 'string')) fail(`profile.${name}.claude`);
  }
  if (!permissions.profiles[permissions.default]) fail('default_profile');
  if (typeof permissions.allowFullFromChat !== 'boolean') fail('allowFullFromChat');

  const cleanup = { ...DEFAULTS.cleanup, ...raw.cleanup };
  for (const k of ['idleSleepMinutes', 'archiveAfterDays', 'archiveNoticeDays']) posInt(cleanup[k], k);

  const sessionOverrides = { ...raw.sessionOverrides };
  for (const [name, o] of Object.entries(sessionOverrides)) {
    if (!validateName(name) || (o.profile !== undefined && !permissions.profiles[o.profile])) fail(`override.${name}`);
  }
  const creatorApps = raw.creatorApps ?? DEFAULTS.creatorApps;
  if (!Array.isArray(creatorApps)) fail('creatorApps');

  return { enabled: raw.enabled !== false, workspaceRoot: raw.workspaceRoot ?? DEFAULTS.workspaceRoot,
    creatorApps, limits, permissions, cleanup, sessionOverrides };
}

// creatorApps 항목은 앱 ID 또는 "접두어*"(예: app_bot_*)
export function appAllowed(config, appId) {
  return config.creatorApps.some((a) => (a.endsWith('*') ? String(appId).startsWith(a.slice(0, -1)) : a === appId));
}

// 폴더 이름으로도 쓰므로 경로 구분자·점·밑줄·공백을 받지 않는다.
export function validateName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,30}[A-Za-z0-9])$/.test(name);
}

// 만들 때 고른 프로필을 정한다. full처럼 명령 실행을 여는 프로필은 allowFullFromChat이 켜져 있을 때만 요청으로 받는다.
export function resolveProfile(config, requested) {
  const name = requested ?? config.permissions.default;
  if (!config.permissions.profiles[name]) return { http: 400, code: 'unknown_profile' };
  if (name === 'full' && !config.permissions.allowFullFromChat) return { http: 403, code: 'profile_not_allowed' };
  return { profile: name };
}

// 연결부 쪽 재검사: 서버가 보낸 프로필·작업 폴더를 이 PC 설정으로 다시 확인한다(서버 DB만 믿지 않는다).
// full은 이 PC 설정 파일(sessionOverrides·allowFullFromChat)이 허용할 때만, 작업 폴더는 workspaceRoot 바로 아래 같은 이름만.
export function checkNewSession(config, ns) {
  const override = config.sessionOverrides[ns.name]?.profile;
  const name = override ?? ns.profile;
  const profile = config.permissions.profiles[name];
  if (!profile) throw Object.assign(new Error('unknown_profile'), { code: 'unknown_profile', http: 400 });
  if (name === 'full' && !override && !config.permissions.allowFullFromChat) {
    throw Object.assign(new Error('profile_not_allowed'), { code: 'profile_not_allowed', http: 403 });
  }
  const root = resolve(config.workspaceRoot.replace(/^~(?=$|[\\/])/, homedir()));
  // SV2: 작업 폴더는 이 연결부(PC·엔진 칸)의 작업 폴더 뿌리 + 이름으로 정한다. 허브가 보낸 경로의 앞부분은 다른 기계(허브)의 경로라
  // 쓰지 않는다(이름만 맞는지 본다) — 그래서 어떤 경로가 와도 이 연결부의 workspaceRoot 바로 아래를 벗어나지 않는다.
  const workspace = resolve(root, String(ns.name ?? ''));
  if (!validateName(ns.name) || basename(resolve(String(ns.workspace ?? ''))) !== ns.name || dirname(workspace) !== root || basename(workspace) !== ns.name) {
    throw Object.assign(new Error('bad_workspace'), { code: 'bad_workspace', http: 400 });
  }
  return { profileName: name, profile, workspace };
}

// 삭제 때 작업 폴더를 지운다(deleteWorkspaceOnClose가 켜진 경우만 호출). workspaceRoot 바로 아래 같은 이름 폴더만 허용한다.
export function removeWorkspace(config, name, path) {
  const root = resolve(config.workspaceRoot.replace(/^~(?=$|[\\/])/, homedir()));
  const target = resolve(path);
  if (!validateName(name) || dirname(target) !== root || basename(target) !== name) {
    throw Object.assign(new Error('bad_workspace'), { code: 'bad_workspace', http: 400 });
  }
  rmSync(target, { recursive: true, force: true });
  return true;
}

export function workspacePath(config, name) {
  // checkNewSession(연결부 재검사)과 같게 ~는 홈 폴더로 펼친다(안 펼치면 Linux 기본값 ~/ieon-workspaces가 bad_workspace로 거절된다).
  const root = config.workspaceRoot.replace(/^~(?=$|[\\/])/, homedir());
  return (/^[A-Za-z]:[\\/]/.test(root) ? win32 : posix).join(root, name).replaceAll('\\', '/');
}
