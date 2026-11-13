// P1(설계 HUB_AND_PC_PROFILES 4절): 파일에 있던 설정 일부를 서버 DB·웹에서 관리한다.
// 웹에서 바꾼 값이 있으면 그 값, 없으면 파일 값(대체 값)을 쓴다. "파일 값으로 되돌리기"는 DB 값을 지운다.
// 안전 설정(연결부 허용 목록·live·작업 폴더·full·sessionOverrides·삭제 시 작업 폴더 지우기·삭제 확인)은 여기서 다루지 않는다(원칙 1).
import { PLATFORMS } from './bots.mjs';
import { loadNewSessionsConfig } from './new-sessions.mjs';

const fail = (code) => { throw Object.assign(new Error(code), { http: 400, code }); };
const posInt = (v, code, min = 1, max = 100000) => { if (!Number.isInteger(v) || v < min || v > max) fail(code); return v; };

// 메신저별 허용 사용자 ID. 값은 메신저 사용자 ID(비밀 아님).
export function validateAllowedUsers(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('bad_allowed_users');
  const out = {};
  for (const [p, ids] of Object.entries(v)) {
    if (!PLATFORMS.includes(p)) fail('bad_platform');
    if (!Array.isArray(ids) || ids.length > 200) fail('bad_allowed_users');
    const list = [...new Set(ids.map((x) => String(x).trim()).filter(Boolean))];
    if (list.some((x) => !/^[\w.@:-]{1,128}$/.test(x))) fail('bad_user_id');
    out[p] = list;
  }
  return out;
}

// 카카오 중계 주소·콜백 제한 시간. 주소는 https(로컬 시험용 http://127.0.0.1·localhost만 예외).
export function validateKakao(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('bad_kakao');
  const out = {};
  if (v.relayUrl !== undefined && v.relayUrl !== null && v.relayUrl !== '') {
    let u;
    try { u = new URL(String(v.relayUrl)); } catch { fail('bad_relay_url'); }
    const local = u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname);
    if (u.protocol !== 'https:' && !local) fail('bad_relay_url');
    if (u.username || u.password || u.search || u.hash) fail('bad_relay_url');
    out.relayUrl = u.toString().replace(/\/$/, '');
  } else out.relayUrl = null;
  if (v.callbackLimitMs !== undefined && v.callbackLimitMs !== null) out.callbackLimitMs = posInt(v.callbackLimitMs, 'bad_callback_limit', 5000, 120000);
  return out;
}

// P1-b: 웹에서 등록하는 기존 세션. 업무 대화는 거절한다(AGENTS 안전 규칙). Codex 대화는 PC 연결부 허용 목록에도 있어야 실행된다.
const EXCLUDED_THREAD = '01a0dadd-739f-74d2-93c5-9c405cc1019b';
export function validateBinding(id, v, knownHosts) {
  if (!/^c_[A-Za-z0-9_-]{1,60}$/.test(id)) fail('bad_conversation_id');
  if (!v || typeof v !== 'object') fail('bad_binding');
  const engine = v.engine;
  if (!['codex_thread', 'claude_channel', 'agy_cli', 'grok_cli'].includes(engine)) fail('bad_engine');
  const label = String(v.label ?? '').trim();
  if (!label || label.length > 60) fail('bad_label');
  const hostId = String(v.hostId ?? '');
  if (!knownHosts.includes(hostId)) fail('unknown_host');
  const sessionRef = String(v.sessionRef ?? (engine === 'claude_channel' ? 'ieon' : '')).trim();
  if (engine === 'codex_thread' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionRef)) fail('bad_session_ref');
  if (engine === 'claude_channel' && !/^[A-Za-z0-9_-]{1,40}$/.test(sessionRef)) fail('bad_session_ref');
  if (engine === 'agy_cli' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionRef)) fail('bad_session_ref');
  if (engine === 'grok_cli' && !/^[\w-]{6,80}$/.test(sessionRef)) fail('bad_session_ref');
  if (sessionRef.toLowerCase() === EXCLUDED_THREAD) fail('excluded_session');
  const appIds = Array.isArray(v.appIds) ? [...new Set(v.appIds.map(String))] : ['app_web'];
  if (!appIds.length || appIds.some((a) => !/^app_[a-z0-9_-]{1,60}$/i.test(a))) fail('bad_app_ids');
  return { conversationId: id, engine, label, hostId, sessionRef, appIds };
}

// 새 세션 설정 중 웹에서 바꿀 수 있는 부분만 받는다. 그 밖의 키는 거절한다.
const NS_WEB = { enabled: 1, limits: 1, cleanup: 1, permissions: 1 };
export function validateNewSessionsWeb(v, fileRaw) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('bad_new_sessions');
  for (const k of Object.keys(v)) if (!NS_WEB[k]) fail('field_not_editable');
  const out = {};
  if (v.enabled !== undefined) { if (typeof v.enabled !== 'boolean') fail('bad_enabled'); out.enabled = v.enabled; }
  if (v.limits !== undefined) {
    const l = v.limits;
    for (const k of Object.keys(l ?? {})) if (!['maxSessions', 'maxActive', 'maxPerEngine'].includes(k)) fail('field_not_editable');
    out.limits = {};
    if (l.maxSessions !== undefined) out.limits.maxSessions = posInt(l.maxSessions, 'bad_limits', 1, 1000);
    if (l.maxActive !== undefined) out.limits.maxActive = posInt(l.maxActive, 'bad_limits', 1, 1000);
    if (l.maxPerEngine !== undefined) {
      out.limits.maxPerEngine = {};
      for (const [e, n] of Object.entries(l.maxPerEngine ?? {})) {
        if (!['codex', 'claude'].includes(e)) fail('bad_limits');
        out.limits.maxPerEngine[e] = posInt(n, 'bad_limits', 1, 1000);
      }
    }
  }
  if (v.cleanup !== undefined) {
    out.cleanup = {};
    for (const [k, n] of Object.entries(v.cleanup ?? {})) {
      // 삭제 확인·삭제 시 작업 폴더 지우기는 안전 설정이라 파일에만 둔다.
      if (!['idleSleepMinutes', 'archiveAfterDays', 'archiveNoticeDays'].includes(k)) fail('field_not_editable');
      out.cleanup[k] = posInt(n, 'bad_cleanup', 1, 100000);
    }
  }
  if (v.permissions !== undefined) {
    for (const k of Object.keys(v.permissions ?? {})) if (k !== 'default') fail('field_not_editable');
    if (v.permissions.default !== undefined) {
      if (v.permissions.default === 'full') fail('profile_not_allowed');
      out.permissions = { default: String(v.permissions.default) };
    }
  }
  // 합친 결과가 규칙에 맞는지(예: 동시 한도 ≤ 총 한도, 있는 프로필) 실제 로더로 확인한다.
  try { loadNewSessionsConfig(mergeNewSessions(fileRaw, out)); } catch (e) { fail(String(e.message).replace('new_sessions_config:', 'bad_new_sessions:')); }
  return out;
}

// 파일 값 위에 웹 값을 겹친다(얕은 단계별 병합).
export function mergeNewSessions(fileRaw = {}, web = {}) {
  const f = fileRaw ?? {};
  return {
    ...f,
    ...(web.enabled !== undefined ? { enabled: web.enabled } : {}),
    limits: { ...f.limits, ...web.limits, maxPerEngine: { ...f.limits?.maxPerEngine, ...web.limits?.maxPerEngine } },
    cleanup: { ...f.cleanup, ...web.cleanup },
    permissions: { ...f.permissions, ...(web.permissions?.default ? { default: web.permissions.default } : {}) },
  };
}
