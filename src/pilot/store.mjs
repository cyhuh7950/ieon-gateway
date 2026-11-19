// 접수·중복·세션 잠금·상태·receipt를 SQLite 단일 writer로 원자 저장한다.
import { t as i18nT } from '../i18n/index.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { STATUS, RELEASING, EngineError, STOP_UNSUPPORTED } from './contracts.mjs';
import { canAccess, sessionKey } from './guard.mjs';
import { NEW_ENGINES, SESSION_STATES, resolveProfile, validateName, workspacePath, appAllowed } from './new-sessions.mjs';
import { PLATFORMS, DEFAULT_BOT, validBotId, validCallName, normalizeCallName, botAppId } from './bots.mjs';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
CREATE TABLE IF NOT EXISTS bindings (
  conversation_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, app_ids TEXT NOT NULL,
  host_id TEXT NOT NULL, engine TEXT NOT NULL, session_ref TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS requests (
  request_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL,
  app_id TEXT NOT NULL, idem_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
  question TEXT, answer TEXT, status TEXT NOT NULL, receipt TEXT, error_code TEXT,
  error_http INTEGER, generation INTEGER NOT NULL,
  UNIQUE (conversation_id, user_id, app_id, idem_key));
CREATE TABLE IF NOT EXISTS new_sessions (
  conversation_id TEXT PRIMARY KEY, host_id TEXT NOT NULL, name TEXT NOT NULL, engine TEXT NOT NULL,
  profile TEXT NOT NULL, state TEXT NOT NULL, workspace TEXT NOT NULL, created_via TEXT NOT NULL,
  created_at TEXT NOT NULL, last_used_at TEXT NOT NULL, UNIQUE (host_id, name));
CREATE TABLE IF NOT EXISTS roles (
  role_id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, engines TEXT NOT NULL, profiles TEXT NOT NULL,
  ai_guide TEXT NOT NULL, default_session TEXT);
CREATE TABLE IF NOT EXISTS bots (
  platform TEXT NOT NULL, bot_id TEXT NOT NULL, name TEXT NOT NULL, role_id TEXT, call_names TEXT NOT NULL,
  extra_users TEXT NOT NULL, enabled INTEGER NOT NULL, PRIMARY KEY (platform, bot_id));
CREATE TABLE IF NOT EXISTS bot_sessions (
  platform TEXT NOT NULL, bot_id TEXT NOT NULL, conversation_id TEXT NOT NULL, PRIMARY KEY (platform, bot_id, conversation_id));
CREATE TABLE IF NOT EXISTS api_apps (
  app_id TEXT PRIMARY KEY, name TEXT NOT NULL, token_sha256 TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS app_sessions (
  app_id TEXT NOT NULL, conversation_id TEXT NOT NULL, PRIMARY KEY (app_id, conversation_id));
CREATE TABLE IF NOT EXISTS web_sessions (
  sid_sha256 TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS devices (
  host_id TEXT PRIMARY KEY, name TEXT NOT NULL, token_sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
  revoked_at TEXT, last_seen_at TEXT);
CREATE TABLE IF NOT EXISTS device_events (
  at TEXT NOT NULL, host_id TEXT NOT NULL, action TEXT NOT NULL, user_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS locks (
  session_key TEXT PRIMARY KEY, holder_request_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS staff (
  conversation_id TEXT PRIMARY KEY, name TEXT NOT NULL, role_id TEXT, icon TEXT, guide_pending INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS staff_name_any ON staff (lower(name));
CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL, lead_conversation_id TEXT NOT NULL,
  guide TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL, conversation_id TEXT NOT NULL, PRIMARY KEY (room_id, conversation_id));
CREATE TABLE IF NOT EXISTS app_devices (
  device_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, token_sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
  last_seen_at TEXT, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS app_pair_codes (
  code_sha256 TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at TEXT, tries INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS work_modes (
  conversation_id TEXT PRIMARY KEY, set_by TEXT NOT NULL, set_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS approvals (
  approval_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, conversation_id TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL,
  cwd TEXT, status TEXT NOT NULL, decided_by TEXT, created_at TEXT NOT NULL, decided_at TEXT);
CREATE TABLE IF NOT EXISTS room_posts (
  post_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT, conversation_id TEXT, request_id TEXT,
  code TEXT, idem_key TEXT, at TEXT NOT NULL);
`;

const hash = (payload) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');

export const CONNECT_MODES = Object.freeze(['alternate', 'shared_server']);
const NEEDS_REVIEW = new Set([STATUS.unknown, STATUS.approvalRequired]);
// W3: 예약 한 줄을 화면·실행기용 모양으로
const scheduleView = (r) => ({ scheduleId: r.schedule_id, ownerUserId: r.owner_user_id, conversationId: r.conversation_id, question: r.question, kind: r.kind,
  spec: JSON.parse(r.spec), tz: r.tz, maxPerDay: r.max_per_day, enabled: r.enabled === 1, pausedReason: r.paused_reason ?? null, lastRunAt: r.last_run_at ?? null,
  lastRequestId: r.last_request_id ?? null, lastResult: r.last_result ?? null, runsDay: r.runs_day ?? null, runsToday: r.runs_today ?? 0, nextRunAt: r.next_run_at ?? null,
  createdAt: r.created_at, approvedAt: r.approved_at });
// RC1: 승인 카드 한 장의 상태 — 결정(status)과 실제 실행 결과(exec_status)를 하나로.
// pending 승인 대기 · denied 거부 · expired 시간 지남 · turn_ended 차례가 끝남 · approved 승인됨(엔진에 전달 전)
// · running 실행 중 · completed 완료 · failed 실패 · unknown 결과 불명
export function approvalState(a) {
  if (a.status !== 'allowed') return a.status;
  return a.exec_status ?? 'approved';
}

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  // X2.4: Codex 세션별 연결 모드. 기존 DB에는 열을 추가한다. 기본값은 실증된 alternate다.
  if (!db.prepare('PRAGMA table_info(bindings)').all().some((c) => c.name === 'connect_mode')) {
    db.exec("ALTER TABLE bindings ADD COLUMN connect_mode TEXT NOT NULL DEFAULT 'alternate'");
  }
  // 엔진이 알려 준 사용량(토큰 수만). 없으면 NULL이다.
  // 여러 봇 M3: 역할 봇에서 만든 새 세션의 AI 역할 안내(첫 질문 앞에 붙임)
  // AP-1: 방에서 보낸 질문의 방 ID·머리말(방 공통 안내·역할 안내). 저장된 질문은 원문 그대로 둔다.
  if (!db.prepare('PRAGMA table_info(requests)').all().some((c) => c.name === 'prefix')) {
    db.exec('ALTER TABLE requests ADD COLUMN prefix TEXT');
    db.exec('ALTER TABLE requests ADD COLUMN room_id TEXT');
  }
  // W1(WORK_AND_VOICE A3): 승인 기록은 180일 보관
  db.prepare('DELETE FROM approvals WHERE created_at < ?').run(new Date(Date.now() - 180 * 86400_000).toISOString());
  // RC1: 승인 뒤 실제 실행 결과(실행 중·완료·실패·결과 불명)·대화별 번호·그때의 AI 직원과 엔진·엔진 항목 ID
  {
    const cols = new Set(db.prepare('PRAGMA table_info(approvals)').all().map((c) => c.name));
    for (const [name, type] of [['exec_status', 'TEXT'], ['exec_at', 'TEXT'], ['exit_code', 'INTEGER'], ['item_id', 'TEXT'], ['seq', 'INTEGER'], ['agent', 'TEXT'], ['engine', 'TEXT']]) {
      if (!cols.has(name)) db.exec(`ALTER TABLE approvals ADD COLUMN ${name} ${type}`);
    }
  }
  // AP-4b: 앱 기기의 휴대폰 알림 주소(FCM 토큰). 비밀값은 아니지만 화면·로그에 내보내지 않는다.
  if (!db.prepare('PRAGMA table_info(app_devices)').all().some((c) => c.name === 'push_token')) db.exec('ALTER TABLE app_devices ADD COLUMN push_token TEXT');
  // 웹 알림 구독(브라우저마다). 주소·키는 화면·로그에 내보내지 않는다.
  // M2 여러 사람: 가입한 사용자(관리자는 여기 없음 — 허브 비밀번호 auth.admin). 상태 pending·approved·rejected·disabled
  // M3: 메신저 계정(메신저·그 메신저의 사용자 ID) ↔ 가입자. 연결된 사람이 봇에 말하면 그 가입자의 대화만 보인다
  db.exec('CREATE TABLE IF NOT EXISTS messenger_links (platform TEXT NOT NULL, sender_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT, created_at TEXT NOT NULL, PRIMARY KEY (platform, sender_id))');
  db.exec('DROP INDEX IF EXISTS staff_name'); // M2-b: AI 직원 이름은 같은 사람 안에서만 겹치지 않게(코드에서 확인)
  db.exec('CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, pw_hash TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT)');
  // M4: 가입할 때 이용 약관·개인정보 처리방침에 동의한 때(예전 가입자는 빈칸)
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'terms_at')) db.exec('ALTER TABLE users ADD COLUMN terms_at TEXT');
  // M2: PC 기기의 주인(연결을 승인한 사람). 예전 기기(빈칸)는 관리자 것
  if (!db.prepare('PRAGMA table_info(devices)').all().some((c) => c.name === 'owner_user_id')) db.exec('ALTER TABLE devices ADD COLUMN owner_user_id TEXT');
  db.exec('CREATE TABLE IF NOT EXISTS web_push_subs (endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL)');
  // RC3: 작업 화면에 보일 접수 시각·마지막 상태 변경 시각(전부터 있던 요청은 비어 있음)
  if (!db.prepare('PRAGMA table_info(requests)').all().some((c) => c.name === 'created_at')) {
    db.exec('ALTER TABLE requests ADD COLUMN created_at TEXT');
    db.exec('ALTER TABLE requests ADD COLUMN updated_at TEXT');
  }
  // WS1-a 작업공간: 직원에 붙인 폴더 이름·권한·차단 수준(화면·메신저 표시용 — 실제 기준은 그 기기 설정)과 붙이기 기록(누가·언제·어느 폴더·권한, 180일)
  db.exec('CREATE TABLE IF NOT EXISTS workspace_views (conversation_id TEXT PRIMARY KEY, view TEXT NOT NULL, updated_at TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS workspace_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id TEXT NOT NULL, conversation_id TEXT NOT NULL, host_id TEXT, detail TEXT NOT NULL)');
  db.prepare('DELETE FROM workspace_log WHERE at < ?').run(new Date(Date.now() - 180 * 86400_000).toISOString());
  // W3 예약 작업: 주인·대화·질문·언제(종류·값·시간대)·하루 한도·켜짐·멈춘 이유·마지막 실행과 결과·다음 실행
  db.exec(`CREATE TABLE IF NOT EXISTS schedules (schedule_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, conversation_id TEXT NOT NULL, question TEXT NOT NULL,
    kind TEXT NOT NULL, spec TEXT NOT NULL, tz TEXT NOT NULL, max_per_day INTEGER NOT NULL, enabled INTEGER NOT NULL, paused_reason TEXT,
    last_run_at TEXT, last_request_id TEXT, last_result TEXT, runs_day TEXT, runs_today INTEGER NOT NULL DEFAULT 0, next_run_at TEXT, created_at TEXT NOT NULL, approved_at TEXT NOT NULL,
    notified_request_id TEXT)`); // notified_request_id: 메신저 방에 답을 알린 마지막 예약 질문
  // RC5: 대화마다 "사람이 직접 할 일" 규칙(종류·명령에 든 글자). 맞는 요청은 엔진에 거부로 답하고 사람에게 넘긴다.
  db.exec('CREATE TABLE IF NOT EXISTS handoff_policies (conversation_id TEXT PRIMARY KEY, kinds TEXT NOT NULL, patterns TEXT NOT NULL, set_by TEXT NOT NULL, set_at TEXT NOT NULL)');
  // SV3-b: 이 질문이 쓴 계정("<PC>:<계정 ID>") — 계정별 사용량·한도
  if (!db.prepare('PRAGMA table_info(requests)').all().some((c) => c.name === 'account_key')) db.exec('ALTER TABLE requests ADD COLUMN account_key TEXT');
  // RC4: 그때의 실행 정보(엔진·PC·세션 ID·연결 방식·작업 모드)와 실제로 답한 세션 ID — 끊긴 뒤 같은 세션인지 확인용
  if (!db.prepare('PRAGMA table_info(requests)').all().some((c) => c.name === 'snap')) {
    db.exec('ALTER TABLE requests ADD COLUMN snap TEXT');
    db.exec('ALTER TABLE requests ADD COLUMN ran_session_ref TEXT');
  }
  // RC2: 사람이 그 요청만 멈추라고 한 시각·누가(실행 중이면 연결부가 읽어 가 엔진을 멈춘다)
  if (!db.prepare('PRAGMA table_info(requests)').all().some((c) => c.name === 'stop_requested_at')) {
    db.exec('ALTER TABLE requests ADD COLUMN stop_requested_at TEXT');
    db.exec('ALTER TABLE requests ADD COLUMN stop_by TEXT');
  }
  // AP-1: 방에서 다시 보낸 글 표시(같은 글을 두 번 다시 보내지 않게 버튼을 감춤)
  if (!db.prepare('PRAGMA table_info(room_posts)').all().some((c) => c.name === 'retried')) db.exec('ALTER TABLE room_posts ADD COLUMN retried INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(new_sessions)').all().some((c) => c.name === 'role_guide')) {
    db.exec('ALTER TABLE new_sessions ADD COLUMN role_guide TEXT');
  }
  // P1-b: 기존 세션 등록의 표시 이름과 출처(file = server.json, web = 웹에서 등록)
  if (!db.prepare('PRAGMA table_info(bindings)').all().some((c) => c.name === 'label')) db.exec('ALTER TABLE bindings ADD COLUMN label TEXT');
  if (!db.prepare('PRAGMA table_info(bindings)').all().some((c) => c.name === 'source')) db.exec("ALTER TABLE bindings ADD COLUMN source TEXT NOT NULL DEFAULT 'file'");
  if (!db.prepare('PRAGMA table_info(new_sessions)').all().some((c) => c.name === 'notified_at')) {
    db.exec('ALTER TABLE new_sessions ADD COLUMN notified_at TEXT');
  }
  if (!db.prepare('PRAGMA table_info(requests)').all().some((c) => c.name === 'usage')) {
    db.exec('ALTER TABLE requests ADD COLUMN usage TEXT');
  }
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };

  const binding = (id) => {
    const row = db.prepare('SELECT * FROM bindings WHERE conversation_id = ?').get(id);
    // 웹 봇 관리에서 봇에게 보이게 한 세션(bot_sessions)은 그 봇의 앱 ID를 appIds에 더해 준다.
    // server.json의 appIds는 서버를 켤 때마다 다시 쓰이므로 웹 설정은 따로 둔다.
    const granted = row ? [
      ...db.prepare('SELECT platform, bot_id FROM bot_sessions WHERE conversation_id = ?').all(id).map((g) => botAppId(g.platform, g.bot_id)),
      // W2b: 웹에서 발급한 외부 프로그램(API 키)에게 보이게 한 세션
      ...db.prepare('SELECT a.app_id FROM app_sessions s JOIN api_apps a ON a.app_id = s.app_id WHERE s.conversation_id = ? AND a.revoked_at IS NULL').all(id).map((g) => g.app_id),
    ] : [];
    return row && {
      conversationId: row.conversation_id, ownerUserId: row.owner_user_id,
      appIds: [...new Set([...JSON.parse(row.app_ids), ...granted])], hostId: row.host_id, engine: row.engine,
      label: row.label ?? null, source: row.source, storedAppIds: JSON.parse(row.app_ids),
      sessionRef: row.session_ref, generation: row.generation, connectMode: row.connect_mode,
    };
  };
  const newSession = (id) => db.prepare('SELECT * FROM new_sessions WHERE conversation_id = ?').get(id);
  const request = (id) => db.prepare('SELECT * FROM requests WHERE request_id = ?').get(id);
  const newSessionView = (id) => {
    const ns = newSession(id);
    if (!ns) return {};
    // 사람이 직접 열 때 쓰는 엔진 세션 ID(Codex 대화 ID·Claude 세션 ID). 아직 만들기 전(pending)이면 없다.
    const ref = binding(id)?.sessionRef;
    return { newSession: { name: ns.name, state: ns.state, profile: ns.profile,
      ...(ref && !ref.startsWith('pending:') ? { sessionId: ref } : {}) } };
  };
  // 새 세션의 첫 실행에서 연결부가 만든 엔진 세션 ID를 한 번만 받아 pending을 벗어난다.
  // 이미 정해진 ID는 바꾸지 않는다(연결부 보고로 다른 대화를 가리키게 하지 않는다). 사용 시각도 갱신한다.
  const adoptSessionRef = (b, ref, now = Date.now()) => {
    const ns = newSession(b.conversationId);
    if (!ns) return;
    tx(() => {
      if (ns.state === 'pending' && b.sessionRef.startsWith('pending:') && typeof ref === 'string' && /^[0-9a-f-]{36}$/i.test(ref)) {
        db.prepare('UPDATE bindings SET session_ref = ? WHERE conversation_id = ?').run(ref, b.conversationId);
        db.prepare("UPDATE new_sessions SET state = 'active' WHERE conversation_id = ?").run(b.conversationId);
      }
      db.prepare('UPDATE new_sessions SET last_used_at = ? WHERE conversation_id = ?').run(new Date(now).toISOString(), b.conversationId);
    });
  };
  const locked = (b) => Boolean(db.prepare('SELECT 1 FROM locks WHERE session_key = ?').get(sessionKey(b)));
  let nsConfig = null; // configureNewSessions로 받은 새 세션 설정(동시 실행 한도용). 없으면 한도를 걸지 않는다.
  // SV4 동시 질문 수(설계 SERVER_SESSIONS 2-6): 기기(PC·엔진 칸) 하나가 한꺼번에 맡는 질문(기다림+처리 중) 수. 넘으면 줄 세우지 않고 host_busy로 거절(자동 재전송 없음). 0이면 한도 없음.
  let perHost = 3;
  const roleView = (r) => r && { roleId: r.role_id, name: r.name, description: r.description, engines: JSON.parse(r.engines),
    profiles: JSON.parse(r.profiles), aiGuide: r.ai_guide, defaultSession: r.default_session };
  const botView = (b) => b && { platform: b.platform, botId: b.bot_id, name: b.name, roleId: b.role_id,
    callNames: JSON.parse(b.call_names), extraUsers: JSON.parse(b.extra_users), enabled: Boolean(b.enabled) };
  // 보관하지 않은 새 세션 수(총수·엔진별).
  const activeCounts = (hostId) => {
    const rows = db.prepare("SELECT engine, COUNT(*) AS n FROM new_sessions WHERE host_id = ? AND state != 'archived' GROUP BY engine").all(hostId);
    const per = Object.fromEntries(Object.keys(NEW_ENGINES).map((e) => [e, rows.find((r) => r.engine === e)?.n ?? 0]));
    return { total: rows.reduce((s, r) => s + r.n, 0), ...per };
  };
  const view = (row) => row && {
    requestId: row.request_id, status: row.status, errorCode: row.error_code,
    http: row.error_http, receipt: row.receipt, answer: row.answer, usage: row.usage ? JSON.parse(row.usage) : null,
    stopRequested: Boolean(row.stop_requested_at),
  };

  function setStatus(row, status, fields = {}) {
    const f = { receipt: row.receipt, answer: row.answer, error_code: row.error_code, error_http: row.error_http, ...fields };
    tx(() => {
      db.prepare('UPDATE requests SET status = ?, receipt = ?, answer = ?, error_code = ?, error_http = ?, updated_at = ? WHERE request_id = ?')
        .run(status, f.receipt, f.answer, f.error_code, f.error_http, new Date().toISOString(), row.request_id);
      if (RELEASING.has(status)) db.prepare('DELETE FROM locks WHERE holder_request_id = ?').run(row.request_id);
    });
  }

  // 답변은 접수 당시 generation이 현재와 같을 때만 저장한다(삭제 후 재생성 방지).
  function keepAnswer(row, answer) {
    return binding(row.conversation_id).generation === row.generation ? answer : null;
  }

  // 재시작 시 전송 가능성이 있는 요청은 완료를 증명할 수 없으므로 unknown으로 격리한다.
  // 규칙 점검 3(2026-11-18 신산님): 표시(server_restarted)를 남겨, 연결부가 엔진 차례의 실제 결과를 나중에 보내면 그 결과로 자동 정리한다(공식 결과만, 짐작 없음).
  db.prepare("UPDATE requests SET status = 'unknown', error_code = COALESCE(error_code, 'server_restarted') WHERE status IN ('dispatching', 'running')").run();

  return {
    // server.json의 기존 세션 등록(출처 file). 서버를 켤 때마다 다시 쓴다(파일이 정본).
    addBinding(b) {
      db.prepare(`INSERT INTO bindings (conversation_id, owner_user_id, app_ids, host_id, engine, session_ref, label, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'file') ON CONFLICT (conversation_id) DO UPDATE SET app_ids = excluded.app_ids,
        label = excluded.label, source = 'file'`)
        .run(b.conversationId, b.ownerUserId, JSON.stringify(b.appIds), b.hostId, b.engine, b.sessionRef, b.label ?? null);
    },

    // --- P1-b: 웹에서 등록하는 기존 세션(출처 web). 파일 등록·새 세션은 여기서 바꾸지 않는다. ---
    // M2: ownerUserId를 주면 그 사람 것만(남의 등록은 보이지 않음)
    listBindings(ownerUserId = null) {
      return db.prepare('SELECT b.conversation_id FROM bindings b LEFT JOIN new_sessions n ON n.conversation_id = b.conversation_id WHERE n.conversation_id IS NULL AND (? IS NULL OR b.owner_user_id = ?) ORDER BY b.rowid').all(ownerUserId, ownerUserId)
        .map((r) => binding(r.conversation_id))
        .map((b) => ({ conversationId: b.conversationId, label: b.label, engine: b.engine, hostId: b.hostId, sessionRef: b.sessionRef,
          appIds: b.storedAppIds, source: b.source, busy: locked(b) }));
    },
    saveBinding(ownerUserId, b) {
      const cur = binding(b.conversationId);
      if (cur && newSession(b.conversationId)) return { http: 409, code: 'is_new_session' };
      if (cur && cur.source !== 'web') return { http: 409, code: 'file_managed' };
      if (cur && cur.ownerUserId !== ownerUserId) return { http: 409, code: 'id_taken' }; // M2: 남의 등록은 덮어쓰지 않음
      return tx(() => {
        if (cur && locked(cur) && (cur.sessionRef !== b.sessionRef || cur.engine !== b.engine || cur.hostId !== b.hostId)) {
          return { http: 409, code: 'conversation_busy' };
        }
        db.prepare(`INSERT INTO bindings (conversation_id, owner_user_id, app_ids, host_id, engine, session_ref, label, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'web') ON CONFLICT (conversation_id) DO UPDATE SET app_ids = excluded.app_ids,
          host_id = excluded.host_id, engine = excluded.engine, session_ref = excluded.session_ref, label = excluded.label`)
          .run(b.conversationId, ownerUserId, JSON.stringify(b.appIds), b.hostId, b.engine, b.sessionRef, b.label);
        return { http: 200, binding: this.listBindings(ownerUserId).find((x) => x.conversationId === b.conversationId) };
      });
    },
    deleteBinding(conversationId, ownerUserId = null) {
      const cur = binding(conversationId);
      if (!cur || newSession(conversationId) || (ownerUserId && cur.ownerUserId !== ownerUserId)) return { http: 404, code: 'not_found' };
      if (cur.source !== 'web') return { http: 409, code: 'file_managed' };
      return tx(() => {
        if (locked(cur)) return { http: 409, code: 'conversation_busy' };
        db.prepare('DELETE FROM requests WHERE conversation_id = ?').run(conversationId);
        db.prepare('DELETE FROM bot_sessions WHERE conversation_id = ?').run(conversationId);
        db.prepare('DELETE FROM bindings WHERE conversation_id = ?').run(conversationId);
        return { http: 204 };
      });
    },

    submit(principal, conversationId, key, payload, { prefix = null, roomId = null, accountKey = null } = {}) {
      const b = binding(conversationId);
      if (!canAccess(principal, b)) return { http: 404, code: 'not_found' };
      // 새 세션은 첫 질문 때 연결부가 엔진 세션을 만든다(Codex N1, Claude N2: 채널이 아닌 claude_cli 엔진).
      const ns = newSession(conversationId);
      const payloadHash = hash(payload);
      return tx(() => {
        const prior = db.prepare(`SELECT request_id, payload_hash FROM requests
          WHERE conversation_id = ? AND user_id = ? AND app_id = ? AND idem_key = ?`)
          .get(conversationId, principal.userId, principal.appId, key);
        if (prior) {
          return prior.payload_hash === payloadHash
            ? { http: 202, requestId: prior.request_id }
            : { http: 409, code: 'idempotency_conflict' };
        }
        const lockKey = sessionKey(b);
        if (db.prepare('SELECT 1 FROM locks WHERE session_key = ?').get(lockKey)) {
          return { http: 409, code: 'conversation_busy' };
        }
        if (perHost) {
          const n = db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status IN ('queued', 'dispatching', 'running') AND json_extract(snap, '$.hostId') = ?").get(b.hostId).n;
          if (n >= perHost) return { http: 429, code: 'host_busy', limit: perHost };
        }
        if (ns) {
          // 보관된 새 세션은 꺼내기(restore) 전까지 받지 않는다. 잠든 세션은 질문이 오면 깨운다.
          if (ns.state === 'archived') return { http: 409, code: 'session_archived' };
          const max = nsConfig?.limits.maxActive;
          if (max) {
            const running = db.prepare(`SELECT COUNT(*) AS n FROM locks l JOIN requests r ON r.request_id = l.holder_request_id
              JOIN new_sessions n ON n.conversation_id = r.conversation_id WHERE n.host_id = ?`).get(b.hostId).n;
            if (running >= max) return { http: 409, code: 'active_limit', limit: max };
          }
          if (ns.state === 'sleeping') db.prepare("UPDATE new_sessions SET state = 'active' WHERE conversation_id = ?").run(conversationId);
        }
        const requestId = `req_${randomUUID()}`;
        // AP-1: 역할을 새로 정한 AI 직원은 다음 질문 한 번에만 역할 안내를 붙인다(매번 붙이지 않음 — 세션이 기억)
        const st = db.prepare('SELECT s.guide_pending, r.ai_guide FROM staff s LEFT JOIN roles r ON r.role_id = s.role_id WHERE s.conversation_id = ?').get(conversationId);
        const roleGuide = st?.guide_pending && st.ai_guide?.trim() ? i18nT('server.role_guide', { guide: st.ai_guide.trim() }) : '';
        if (st?.guide_pending) db.prepare('UPDATE staff SET guide_pending = 0 WHERE conversation_id = ?').run(conversationId);
        const fullPrefix = (roleGuide + (prefix ?? '')) || null;
        db.prepare(`INSERT INTO requests (request_id, conversation_id, user_id, app_id, idem_key,
          payload_hash, question, status, generation, prefix, room_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`)
          .run(requestId, conversationId, principal.userId, principal.appId, key, payloadHash,
            String(payload.question ?? ''), b.generation, fullPrefix, roomId, new Date().toISOString(), new Date().toISOString());
        db.prepare('INSERT INTO locks (session_key, holder_request_id) VALUES (?, ?)').run(lockKey, requestId);
        if (accountKey) db.prepare('UPDATE requests SET account_key = ? WHERE request_id = ?').run(String(accountKey).slice(0, 120), requestId);
        // RC4: 그때의 실행 정보(다시 붙었을 때 같은 세션인지 비교). 작업 폴더는 그 PC 설정이라 PC가 알려 주지 않으면 비워 둔다.
        db.prepare('UPDATE requests SET snap = ? WHERE request_id = ?').run(JSON.stringify({ engine: b.engine, hostId: b.hostId, sessionRef: b.sessionRef, connectMode: b.connectMode,
          workMode: Boolean(db.prepare('SELECT 1 FROM work_modes WHERE conversation_id = ?').get(conversationId)) }), requestId);
        return { http: 202, requestId };
      });
    },

    // queued 요청만 실행한다. 이미 시작했거나 끝난 요청은 다시 보내지 않는다.
    async execute(requestId, adapter, { hook } = {}) {
      let row = request(requestId);
      if (!row || row.status !== STATUS.queued) return view(row);
      const b = binding(row.conversation_id);
      setStatus(row, STATUS.dispatching);
      hook?.('before_send');
      let result;
      try {
        result = await adapter.run({ engine: b.engine, sessionRef: b.sessionRef, question: row.question });
      } catch (error) {
        row = request(requestId);
        if (error instanceof EngineError) {
          setStatus(row, STATUS.failed, { error_code: error.code, error_http: error.http });
        } else {
          setStatus(row, STATUS.unknown);
        }
        return view(request(requestId));
      }
      row = request(requestId);
      if (result.approvalRequired) {
        setStatus(row, STATUS.approvalRequired);
        return view(request(requestId));
      }
      setStatus(row, STATUS.running, { receipt: result.receipt });
      hook?.('after_receipt');
      setStatus(request(requestId), STATUS.completed, { answer: keepAnswer(row, result.answer) });
      return view(request(requestId));
    },

    // S2 연결부용: 해당 PC의 queued 요청 하나를 dispatching으로 바꿔 넘긴다. 한 번 넘긴 요청은 다시 넘기지 않는다.
    claim(hostId) {
      return tx(() => {
        const row = db.prepare(`SELECT r.request_id, r.question, r.prefix, r.conversation_id, b.engine, b.session_ref, b.connect_mode FROM requests r
          JOIN bindings b ON b.conversation_id = r.conversation_id
          WHERE b.host_id = ? AND r.status = 'queued' ORDER BY r.rowid LIMIT 1`).get(hostId);
        if (!row) return null;
        db.prepare("UPDATE requests SET status = 'dispatching' WHERE request_id = ?").run(row.request_id);
        const ns = db.prepare(`SELECT n.name, n.profile, n.workspace, n.state, n.role_guide FROM new_sessions n JOIN requests r
          ON r.conversation_id = n.conversation_id WHERE r.request_id = ?`).get(row.request_id);
        // 역할 봇에서 만든 새 세션의 첫 질문(엔진 세션을 만드는 질문)에만 AI 역할 안내를 붙인다. 저장된 질문은 그대로다.
        const base = row.prefix ? row.prefix + i18nT('server.question_head') + row.question : row.question; // AP-1 방·역할 머리말
        const question = ns?.state === 'pending' && ns.role_guide ? i18nT('server.role_guide', { guide: ns.role_guide }) + i18nT('server.question_head') + base : base;
        return { requestId: row.request_id, engine: row.engine, sessionRef: row.session_ref, question,
          ...(row.engine === 'codex_thread' ? { connectMode: row.connect_mode } : {}),
          // W2: 작업 모드인 대화의 질문만(연결부가 승인 카드로 묻고 쓰기를 작업 폴더 안으로)
          ...(db.prepare('SELECT 1 FROM work_modes WHERE conversation_id = ?').get(row.conversation_id) ? { workMode: true } : {}),
          ...(ns ? { newSession: { name: ns.name, profile: ns.profile, workspace: ns.workspace } } : {}) };
      });
    },

    // 연결부가 보고한 결과를 반영한다. dispatching/running 요청만 받는다.
    report(hostId, requestId, outcome, { now } = {}) {
      const row = request(requestId);
      const b = row && binding(row.conversation_id);
      // 서버 재시작으로 결과 불명이 된 요청은 그 기기 연결부가 보낸 실제 결과로 정리한다(규칙 점검 3).
      const late = row?.status === STATUS.unknown && row.error_code === 'server_restarted';
      if (!b || b.hostId !== hostId || (![STATUS.dispatching, STATUS.running].includes(row.status) && !late)) return null;
      if (late) row.error_code = null;
      adoptSessionRef(b, outcome.sessionRef, now);
      // RC4: 실제로 답한 세션 ID(새 세션은 이때 정해짐). 형식이 맞는 것만.
      if (typeof outcome.sessionRef === 'string' && /^[\w:-]{6,120}$/.test(outcome.sessionRef)) db.prepare('UPDATE requests SET ran_session_ref = ? WHERE request_id = ?').run(outcome.sessionRef, requestId);
      // W1: 차례가 끝나면 아직 답하지 않은 승인 요청은 거부(turn_ended)
      db.prepare("UPDATE approvals SET status = 'turn_ended', decided_at = ? WHERE request_id = ? AND status = 'pending'").run(new Date().toISOString(), requestId);
      // RC1: 허용했는데 실행 결과가 오지 않은 채 차례가 끝나면 결과 불명(완료로 짐작하지 않는다)
      db.prepare("UPDATE approvals SET exec_status = 'unknown', exec_at = ? WHERE request_id = ? AND status = 'allowed' AND (exec_status IS NULL OR exec_status = 'running')").run(new Date().toISOString(), requestId);
      if (outcome.status === STATUS.completed) {
        setStatus(row, STATUS.completed, { receipt: outcome.receipt ?? null, answer: keepAnswer(row, outcome.answer ?? null) });
        if (outcome.usage) db.prepare('UPDATE requests SET usage = ? WHERE request_id = ?').run(JSON.stringify(outcome.usage), requestId);
      } else if (outcome.status === STATUS.failed) {
        setStatus(row, STATUS.failed, { error_code: outcome.errorCode ?? 'failed', error_http: outcome.http ?? null });
      } else if (outcome.status === STATUS.approvalRequired) {
        setStatus(row, STATUS.approvalRequired);
      } else if (outcome.status === STATUS.cancelled && row.stop_requested_at) {
        // RC2: 사람이 멈추라고 했고 연결부가 엔진 차례가 끝난 것을 확인함 → 중지됨(세션 잠금도 풂)
        setStatus(row, STATUS.cancelled, { error_code: 'stopped_by_user' });
      } else {
        // 멈추라고 하지 않았는데 중지됐다고 오거나, 멈춘 것을 확인하지 못한 경우 → 결과 불명(자동 재전송 없음)
        setStatus(row, STATUS.unknown, { error_code: outcome.status === STATUS.cancelled ? 'unexpected_stop' : (outcome.errorCode ?? null) });
      }
      return view(request(requestId));
    },

    // RC2: 그 요청만 멈추기. 대기 중이면 바로 취소, 실행 중이면 멈춤 요청을 남기고 연결부가 엔진을 멈춘 뒤 보고한다.
    // 이미 끝난 요청은 바꾸지 않는다(먼저 확정된 쪽이 이긴다). 사람이 띄운 Claude 채널은 실행 중에는 멈출 수 없다.
    stopRequest(principal, requestId) {
      // 동기 DB 호출만 쓰므로 이 안에서 다른 요청이 끼어들지 않는다(setStatus가 자체 트랜잭션을 씀)
      {
        const row = request(requestId);
        const b = row && binding(row.conversation_id);
        if (!b || !canAccess(principal, b)) return { http: 404, code: 'not_found' };
        const now = new Date().toISOString();
        if (row.status === STATUS.queued) {
          db.prepare('UPDATE requests SET stop_requested_at = ?, stop_by = ? WHERE request_id = ?').run(now, principal.userId, requestId);
          setStatus(request(requestId), STATUS.cancelled, { error_code: 'stopped_by_user' });
          return { http: 200, status: STATUS.cancelled };
        }
        if (row.status === STATUS.dispatching || row.status === STATUS.running) {
          if (STOP_UNSUPPORTED.has(b.engine)) return { http: 409, code: 'stop_unsupported', status: row.status };
          if (!row.stop_requested_at) db.prepare('UPDATE requests SET stop_requested_at = ?, stop_by = ? WHERE request_id = ?').run(now, principal.userId, requestId);
          // 기다리던 승인 카드는 더 묻지 않는다(엔진에는 거부로 전달되고, 곧 차례가 멈춘다)
          db.prepare("UPDATE approvals SET status = 'turn_ended', decided_at = ? WHERE request_id = ? AND status = 'pending'").run(now, requestId);
          return { http: 202, status: 'stopping' };
        }
        return { http: 409, code: 'not_running', status: row.status };
      }
    },
    // RC5: "사람이 직접 할 일" 규칙. kinds: command·file·permissions 중 고른 것(그 종류는 전부 넘김), patterns: 명령에 이 글자가 들어 있으면 넘김.
    handoffPolicy(principal, conversationId) {
      const b = binding(conversationId);
      if (!b || !canAccess(principal, b)) return null;
      const r = db.prepare('SELECT kinds, patterns, set_at FROM handoff_policies WHERE conversation_id = ?').get(conversationId);
      return { kinds: r ? JSON.parse(r.kinds) : [], patterns: r ? JSON.parse(r.patterns) : [], setAt: r?.set_at ?? null };
    },
    setHandoffPolicy(principal, conversationId, { kinds = [], patterns = [] } = {}) {
      const b = binding(conversationId);
      if (!b || !canAccess(principal, b)) return { http: 404, code: 'not_found' };
      if (!Array.isArray(kinds) || kinds.some((k) => !['command', 'file', 'permissions'].includes(k))) return { http: 400, code: 'bad_kinds' };
      const ps = Array.isArray(patterns) ? [...new Set(patterns.map((p) => String(p ?? '').trim()).filter(Boolean))] : null;
      if (!ps || ps.length > 20 || ps.some((p) => p.length > 60)) return { http: 400, code: 'bad_patterns' };
      if (!kinds.length && !ps.length) { db.prepare('DELETE FROM handoff_policies WHERE conversation_id = ?').run(conversationId); return { http: 200, policy: { kinds: [], patterns: [] } }; }
      db.prepare(`INSERT INTO handoff_policies (conversation_id, kinds, patterns, set_by, set_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET kinds = excluded.kinds, patterns = excluded.patterns, set_by = excluded.set_by, set_at = excluded.set_at`)
        .run(conversationId, JSON.stringify([...new Set(kinds)]), JSON.stringify(ps), principal.userId, new Date().toISOString());
      return { http: 200, policy: { kinds: [...new Set(kinds)], patterns: ps } };
    },
    handoffMatch(conversationId, kind, summary) {
      const r = db.prepare('SELECT kinds, patterns FROM handoff_policies WHERE conversation_id = ?').get(conversationId);
      if (!r) return false;
      if (JSON.parse(r.kinds).includes(kind)) return true;
      const s = String(summary ?? '').toLowerCase();
      return kind === 'command' && JSON.parse(r.patterns).some((p) => s.includes(String(p).toLowerCase()));
    },
    // SV3-b: 계정별 사용량 — 오늘(이 서버 시간 0시부터) 질문 수, 이번 달 토큰(입력+출력). 취소·접수 거절은 빼고 접수된 질문은 센다.
    accountUsage(accountKey, now = new Date()) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const month = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const today = db.prepare("SELECT COUNT(*) AS n FROM requests WHERE account_key = ? AND created_at >= ? AND status != 'cancelled'").get(accountKey, day).n;
      let tokens = 0;
      for (const r of db.prepare('SELECT usage FROM requests WHERE account_key = ? AND created_at >= ? AND usage IS NOT NULL').all(accountKey, month)) {
        try { const u = JSON.parse(r.usage); tokens += (Number(u.inputTokens) || 0) + (Number(u.outputTokens) || 0); } catch { /* 형식이 틀리면 건너뜀 */ }
      }
      return { todayQuestions: today, monthTokens: tokens };
    },
    accountKeysSeen() { return db.prepare('SELECT DISTINCT account_key FROM requests WHERE account_key IS NOT NULL').all().map((r) => r.account_key); },
    // RC4: 재개 확인 — 그때 보낸 세션과 지금 이 대화의 세션이 같은지, 이어온 보관 기록이 그대로인지, 지금 막혀 있는지.
    // 엔진 쪽 이력(원래 세션에 그 차례가 남았는지)은 여기서 보지 않는다 — 사람이 원래 앱에서 확인하고 /review로 정리한다.
    resumeCheck(requestId) {
      const row = request(String(requestId ?? ''));
      const b = row && binding(row.conversation_id);
      if (!b) return null;
      let snap = null; try { snap = row.snap ? JSON.parse(row.snap) : null; } catch { snap = null; }
      if (!snap) return { known: false }; // RC4 전에 접수된 질문 — 그때 정보가 없음
      const thenRef = row.ran_session_ref ?? snap.sessionRef;
      const pendingThen = String(snap.sessionRef ?? '').startsWith('pending:');
      const sameSession = thenRef === b.sessionRef || (pendingThen && !row.ran_session_ref && String(b.sessionRef).startsWith('pending:'));
      const last = db.prepare('SELECT request_id, status FROM requests WHERE conversation_id = ? ORDER BY rowid DESC LIMIT 1').get(row.conversation_id);
      const held = db.prepare("SELECT r.request_id, r.status FROM locks l JOIN requests r ON r.request_id = l.holder_request_id WHERE l.session_key = ?").get(sessionKey(b));
      const checks = { sameSession, sameEngine: snap.engine === b.engine, sameHost: snap.hostId === b.hostId, sameConnectMode: (snap.connectMode ?? null) === (b.connectMode ?? null),
        historyKept: row.generation === b.generation, isLatest: last?.request_id === row.request_id };
      const verdict = !checks.sameSession || !checks.sameEngine || !checks.sameHost ? 'mismatch'
        : held && ['unknown', 'approval_required'].includes(held.status) ? 'needs_review' : 'same';
      // 세션 ID는 응답에 싣지 않는다(지금까지처럼 서버 안에서만) — 같은지·다른지만 알려 준다.
      return { known: true, verdict, ...checks,
        then: { engine: snap.engine, hostId: snap.hostId, connectMode: snap.connectMode ?? null, workMode: Boolean(snap.workMode) },
        now: { engine: b.engine, hostId: b.hostId, connectMode: b.connectMode ?? null },
        heldBy: held ? { requestId: held.request_id, status: held.status, isThis: held.request_id === row.request_id } : null };
    },
    // RC3: 작업(요청 단위) 목록 — 내가 볼 수 있는 대화의 질문만. filter: active(진행 중·확인 필요) | all(최근)
    tasks(principal, { filter = 'all', limit = 50, ttlMs } = {}) {
      const ACTIVE = ['queued', 'dispatching', 'running', 'approval_required', 'unknown'];
      const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
      const rows = db.prepare(`SELECT request_id FROM requests ${filter === 'active' ? `WHERE status IN (${ACTIVE.map(() => '?').join(',')})` : ''} ORDER BY rowid DESC LIMIT 1000`)
        .all(...(filter === 'active' ? ACTIVE : []));
      const out = [];
      for (const r of rows) {
        const t = this.taskDetail(principal, r.request_id, { brief: true, ttlMs });
        if (t) out.push(t);
        if (out.length >= n) break;
      }
      return out;
    },
    // RC3: 작업 하나 — 질문·상태·답·그 질문의 승인과 실행 결과·멈출 수 있는지
    taskDetail(principal, requestId, { brief = false, ttlMs } = {}) {
      const row = request(String(requestId ?? ''));
      const b = row && binding(row.conversation_id);
      if (!b || !canAccess(principal, b)) return null;
      const staff = db.prepare('SELECT name, icon FROM staff WHERE conversation_id = ?').get(row.conversation_id);
      const ids = db.prepare('SELECT approval_id FROM approvals WHERE request_id = ? ORDER BY created_at').all(row.request_id);
      const approvals = ids.map((x) => this.approvalStatus(x.approval_id, { ttlMs })).map((a) => ({ approvalId: a.approval_id, n: a.seq ?? null, kind: a.kind, summary: a.summary, cwd: a.cwd,
        state: approvalState(a), exitCode: a.exit_code ?? null, decidedAt: a.decided_at ?? null }));
      const running = [STATUS.dispatching, STATUS.running].includes(row.status);
      const t = { requestId: row.request_id, conversationId: row.conversation_id, label: staff?.name ?? b.label, icon: staff?.icon ?? null, engine: b.engine,
        status: row.status, errorCode: row.error_code, stopRequested: Boolean(row.stop_requested_at), createdAt: row.created_at ?? null, updatedAt: row.updated_at ?? null,
        canStop: row.status === STATUS.queued || (running && !STOP_UNSUPPORTED.has(b.engine) && !row.stop_requested_at),
        pendingApprovals: approvals.filter((a) => a.state === 'pending').length,
        preview: String(row.question ?? '').replace(/\s+/g, ' ').slice(0, 80) };
      if (brief) return t;
      return { ...t, question: row.question, answer: row.status === STATUS.completed ? row.answer : null, approvals, resume: this.resumeCheck(row.request_id) };
    },
    // RC3: 승인 대기함 — 내가 볼 수 있는 모든 대화의 기다리는 승인(시간이 지난 것은 읽을 때 거부로 바뀜)
    pendingApprovals(principal, { ttlMs } = {}) {
      const rows = db.prepare("SELECT approval_id, conversation_id FROM approvals WHERE status IN ('pending', 'handoff') ORDER BY created_at").all();
      return rows.filter((r) => canAccess(principal, binding(r.conversation_id))).map((r) => this.approvalStatus(r.approval_id, { ttlMs }))
        .filter((a) => a.status === 'pending' || a.status === 'handoff').map((a) => {
          const b = binding(a.conversation_id); const staff = db.prepare('SELECT name FROM staff WHERE conversation_id = ?').get(a.conversation_id);
          return { approvalId: a.approval_id, requestId: a.request_id, conversationId: a.conversation_id, label: staff?.name ?? b.label, n: a.seq ?? null,
            kind: a.kind, summary: a.summary, cwd: a.cwd, createdAt: a.created_at, ...(a.status === 'handoff' ? { handoff: true } : {}) };
        });
    },
    // RC2: 연결부가 실행 중인 요청을 멈춰야 하는지 묻는다(그 PC의 요청만)
    stopRequested(hostId, requestId) {
      const row = request(String(requestId ?? ''));
      const b = row && binding(row.conversation_id);
      if (!b || b.hostId !== hostId) return null;
      return Boolean(row.stop_requested_at) && [STATUS.dispatching, STATUS.running].includes(row.status);
    },

    conversations(principal) {
      return db.prepare('SELECT conversation_id FROM bindings ORDER BY rowid').all()
        .map((r) => binding(r.conversation_id))
        .filter((b) => canAccess(principal, b))
        .map((b) => {
          const holder = db.prepare('SELECT holder_request_id FROM locks WHERE session_key = ?').get(sessionKey(b));
          const held = holder && request(holder.holder_request_id);
          // sessionRef는 서버 안에서만(계정 이름표 찾기, A2) — 응답에는 필드를 골라 내보내므로 밖으로 나가지 않는다.
          return { conversationId: b.conversationId, label: b.label, engine: b.engine, hostId: b.hostId, sessionRef: b.sessionRef, busy: Boolean(holder),
            // 결과 불명·권한 확인 대기는 사람이 원래 세션을 보고 정리해야 풀린다.
            ...(held && NEEDS_REVIEW.has(held.status)
              ? { heldBy: { requestId: held.request_id, status: held.status, errorCode: held.error_code } } : {}),
            ...(b.engine === 'codex_thread' ? { connectMode: b.connectMode } : {}),
            ...newSessionView(b.conversationId) };
        });
    },

    // 새 세션 등록(N0). 엔진 쪽 세션은 아직 만들지 않으므로 sessionRef는 pending 표식이고 상태는 pending이다.
    // 기존 세션 연결(사람이 등록한 binding)은 한도에 세지 않고, 보관된 새 세션도 세지 않는다.
    // role: 만든 봇의 역할({ engines, profiles, aiGuide }) — 있으면 엔진·권한을 그 안으로 제한하고 AI 역할 안내를 남긴다.
    createSession(principal, { engine, name, profile, hostId, via, role }, config) {
      if (!config.enabled) return { http: 403, code: 'new_sessions_disabled' };
      if (!principal || !appAllowed(config, principal.appId)) return { http: 403, code: 'app_not_allowed' };
      if (!validateName(name)) return { http: 400, code: 'bad_name' };
      if (!Object.hasOwn(NEW_ENGINES, engine)) return { http: 400, code: 'bad_engine' };
      if (role && !role.engines.includes(engine)) return { http: 403, code: 'engine_not_allowed_for_role', allowed: role.engines };
      if (role && profile !== undefined && !role.profiles.includes(profile)) return { http: 403, code: 'profile_not_allowed_for_role', allowed: role.profiles };
      const p = resolveProfile(config, profile ?? role?.profiles[0]);
      if (!p.profile) return p;
      // M2-b: 가입한 사람(users 표)은 ID에 사람 표식을 붙여 다른 사람의 같은 이름과 겹치지 않게(관리자는 전처럼 n_<이름>)
      const conversationId = db.prepare('SELECT 1 FROM users WHERE user_id = ?').get(principal.userId) ? `n_${name}_${principal.userId.slice(2, 8)}` : `n_${name}`;
      return tx(() => {
        if (binding(conversationId) || db.prepare('SELECT 1 FROM new_sessions WHERE host_id = ? AND name = ?').get(hostId, name)) {
          return { http: 409, code: 'name_taken' };
        }
        const counted = activeCounts(hostId);
        if (counted.total >= config.limits.maxSessions) return { http: 409, code: 'session_limit', limit: config.limits.maxSessions };
        const perEngine = config.limits.maxPerEngine[engine];
        if (counted[engine] >= perEngine) return { http: 409, code: 'engine_limit', limit: perEngine };
        const now = new Date().toISOString();
        const workspace = workspacePath(config, name);
        db.prepare(`INSERT INTO bindings (conversation_id, owner_user_id, app_ids, host_id, engine, session_ref)
          VALUES (?, ?, ?, ?, ?, ?)`).run(conversationId, principal.userId,
          // 추가 봇이 만든 세션은 만든 봇 + 웹에서만 보인다. 그 밖은 creatorApps의 앱들(지금과 같음).
          JSON.stringify(principal.appId.startsWith('app_bot_') ? [principal.appId, 'app_web'] : config.creatorApps.filter((a) => !a.endsWith('*'))), hostId,
          NEW_ENGINES[engine], `pending:${randomUUID()}`);
        db.prepare(`INSERT INTO new_sessions (conversation_id, host_id, name, engine, profile, state, workspace, created_via,
          created_at, last_used_at, role_guide) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`)
          .run(conversationId, hostId, name, engine, p.profile, workspace, String(via ?? 'unknown'), now, now, role?.aiGuide?.trim() || null);
        return { http: 201, conversationId, name, engine, profile: p.profile, workspace };
      });
    },

    configureNewSessions(config) { nsConfig = config; },
    configureHostLimit(n) { perHost = Number.isInteger(n) && n >= 0 ? n : 3; },
    hostLimit() { return perHost; },

    // 정리(N3): 잠들기(active→sleeping, 대화 유지)·보관(archived, 목록·한도 제외)·보관 예고.
    // 처리 중·확인 필요 잠금이 있는 세션은 건드리지 않는다. 삭제는 여기서 하지 않는다(사람 확인 필요).
    runCleanup(config, now = Date.now()) {
      const { idleSleepMinutes, archiveAfterDays, archiveNoticeDays } = config.cleanup;
      const DAY = 86400000;
      const changes = [];
      const notices = [];
      for (const ns of db.prepare("SELECT * FROM new_sessions WHERE state != 'archived' ORDER BY rowid").all()) {
        const b = binding(ns.conversation_id);
        if (!b || locked(b)) continue;
        const last = Date.parse(ns.last_used_at);
        const idle = now - last;
        let to = null;
        if (idle >= archiveAfterDays * DAY) to = 'archived';
        else if (ns.state === 'active' && idle >= idleSleepMinutes * 60000) to = 'sleeping';
        if (to) {
          db.prepare('UPDATE new_sessions SET state = ? WHERE conversation_id = ?').run(to, ns.conversation_id);
          changes.push({ conversationId: ns.conversation_id, name: ns.name, from: ns.state, to });
        }
        const archiveAt = last + archiveAfterDays * DAY;
        if (to !== 'archived' && archiveAt - now <= archiveNoticeDays * DAY
          && (!ns.notified_at || now - Date.parse(ns.notified_at) >= DAY)) {
          db.prepare('UPDATE new_sessions SET notified_at = ? WHERE conversation_id = ?').run(new Date(now).toISOString(), ns.conversation_id);
          notices.push({ conversationId: ns.conversation_id, name: ns.name, archiveAt: new Date(archiveAt).toISOString() });
        }
      }
      return { changes, notices };
    },

    // 보관에서 꺼낸다. 한도 안에서만 되고, 바로 다시 보관되지 않게 사용 시각을 지금으로 둔다.
    restoreSession(principal, conversationId, config, now = Date.now()) {
      const b = binding(conversationId);
      const ns = newSession(conversationId);
      if (!ns || !canAccess(principal, b)) return { http: 404, code: 'not_found' };
      if (ns.state !== 'archived') return { http: 409, code: 'not_archived' };
      return tx(() => {
        const counted = activeCounts(b.hostId);
        if (counted.total >= config.limits.maxSessions) return { http: 409, code: 'session_limit', limit: config.limits.maxSessions };
        if (counted[ns.engine] >= config.limits.maxPerEngine[ns.engine]) {
          return { http: 409, code: 'engine_limit', limit: config.limits.maxPerEngine[ns.engine] };
        }
        db.prepare("UPDATE new_sessions SET state = 'sleeping', last_used_at = ?, notified_at = NULL WHERE conversation_id = ?")
          .run(new Date(now).toISOString(), conversationId);
        return { http: 200, conversationId, state: 'sleeping' };
      });
    },

    // 사람이 이름을 확인해야 지운다. 이어온 등록·보관 기록만 지우고 원래 엔진 세션 기록은 두며,
    // 작업 폴더는 removeWorkspace가 true일 때 호출한 쪽이 지운다(store는 파일을 건드리지 않는다).
    deleteSession(principal, conversationId, { confirm } = {}, config) {
      const b = binding(conversationId);
      const ns = newSession(conversationId);
      if (!ns || !canAccess(principal, b)) return { http: 404, code: 'not_found' };
      if (config.cleanup.deleteRequiresConfirm && confirm !== ns.name) return { http: 400, code: 'confirm_mismatch' };
      return tx(() => {
        if (locked(b)) return { http: 409, code: 'conversation_busy' };
        db.prepare('DELETE FROM requests WHERE conversation_id = ?').run(conversationId);
        db.prepare('DELETE FROM new_sessions WHERE conversation_id = ?').run(conversationId);
        db.prepare('DELETE FROM bindings WHERE conversation_id = ?').run(conversationId);
        return { http: 200, conversationId, name: ns.name, workspace: ns.workspace, removeWorkspace: config.cleanup.deleteWorkspaceOnClose };
      });
    },

    // 사람이 바로 잠재운다(/sleep). 처리 중이면 거절한다.
    sleepSession(principal, conversationId) {
      const b = binding(conversationId);
      const ns = newSession(conversationId);
      if (!ns || !canAccess(principal, b)) return { http: 404, code: 'not_found' };
      if (ns.state !== 'active') return { http: 409, code: 'not_active' };
      if (locked(b)) return { http: 409, code: 'conversation_busy' };
      db.prepare("UPDATE new_sessions SET state = 'sleeping' WHERE conversation_id = ?").run(conversationId);
      return { http: 200, conversationId, state: 'sleeping' };
    },

    setSessionState(conversationId, state) {
      if (!SESSION_STATES.includes(state)) throw new Error(`bad_state:${state}`);
      return db.prepare('UPDATE new_sessions SET state = ? WHERE conversation_id = ?').run(state, conversationId).changes === 1;
    },

    // 설정 파일의 sessionOverrides가 만들 때 고른 프로필보다 우선한다(full은 여기로만 지정). 새 세션이 아니면 null.
    effectiveProfile(conversationId, config) {
      const ns = newSession(conversationId);
      return ns ? (config.sessionOverrides[ns.name]?.profile ?? ns.profile) : null;
    },

    sessionLimits(config, hostId = 'h_sinsan') {
      const { total, ...perEngine } = activeCounts(hostId);
      return { sessions: total, maxSessions: config.limits.maxSessions, perEngine,
        maxPerEngine: config.limits.maxPerEngine, maxActive: config.limits.maxActive };
    },

    // Codex 연결 모드 전환. 이 세션에 처리 중·결과 불명 요청(잠금)이 있으면 바꾸지 않는다.
    // thread 자체의 잠금 반납은 서버가 볼 수 없으므로, 다음 실행 때 연결부가 모드별 사전 확인으로 다시 막는다.
    setConnectMode(principal, conversationId, mode) {
      const b = binding(conversationId);
      if (!canAccess(principal, b)) return { http: 404, code: 'not_found' };
      if (b.engine !== 'codex_thread') return { http: 400, code: 'not_codex' };
      if (!CONNECT_MODES.includes(mode)) return { http: 400, code: 'bad_mode' };
      return tx(() => {
        if (db.prepare('SELECT 1 FROM locks WHERE session_key = ?').get(sessionKey(b))) {
          return { http: 409, code: 'conversation_busy' };
        }
        db.prepare('UPDATE bindings SET connect_mode = ? WHERE conversation_id = ?').run(mode, conversationId);
        return { http: 200, connectMode: mode };
      });
    },

    // W2(WORK_AND_VOICE A1·WV1·WV4): 대화별 작업 모드(기본 꺼짐). 지금은 Codex 기존 대화만(W0: app-server 경로 가능, Claude는 보류).
    // 새 세션은 자기 권한 프로필이 따로 있어 대상이 아님. 처리 중이면 바꾸지 않는다.
    workMode(conversationId) { return Boolean(db.prepare('SELECT 1 FROM work_modes WHERE conversation_id = ?').get(conversationId)); },
    // W3 예약 작업 — 주인 것만 보이고 바뀐다
    schedules(principal) {
      return db.prepare('SELECT * FROM schedules WHERE owner_user_id = ? ORDER BY created_at').all(principal.userId).map(scheduleView);
    },
    dueSchedules(nowIso) { return db.prepare('SELECT * FROM schedules WHERE enabled = 1 AND paused_reason IS NULL AND next_run_at IS NOT NULL AND next_run_at <= ?').all(nowIso).map(scheduleView); },
    addSchedule(principal, conversationId, s, { id, nextRunAt, max }) {
      const b = binding(conversationId);
      if (!canAccess(principal, b)) return { http: 404, code: 'not_found' };
      if (db.prepare('SELECT COUNT(*) AS n FROM schedules WHERE owner_user_id = ?').get(principal.userId).n >= max) return { http: 409, code: 'too_many_schedules' };
      const at = new Date().toISOString();
      db.prepare(`INSERT INTO schedules (schedule_id, owner_user_id, conversation_id, question, kind, spec, tz, max_per_day, enabled, next_run_at, created_at, approved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(id, principal.userId, conversationId, s.question, s.kind, JSON.stringify(s.spec), s.tz, s.maxPerDay, nextRunAt, at, at);
      return { http: 201, schedule: scheduleView(db.prepare('SELECT * FROM schedules WHERE schedule_id = ?').get(id)) };
    },
    schedule(principal, id) { const r = db.prepare('SELECT * FROM schedules WHERE schedule_id = ? AND owner_user_id = ?').get(id, principal.userId); return r ? scheduleView(r) : null; },
    // 켜기(다시 켜기 = 다시 승인: 멈춘 이유를 지우고 승인 시각을 새로)·끄기
    setScheduleEnabled(principal, id, on, nextRunAt) {
      const r = db.prepare('SELECT 1 FROM schedules WHERE schedule_id = ? AND owner_user_id = ?').get(id, principal.userId);
      if (!r) return { http: 404, code: 'not_found' };
      if (on) db.prepare('UPDATE schedules SET enabled = 1, paused_reason = NULL, approved_at = ?, next_run_at = ? WHERE schedule_id = ?').run(new Date().toISOString(), nextRunAt, id);
      else db.prepare('UPDATE schedules SET enabled = 0 WHERE schedule_id = ?').run(id);
      return { http: 200, schedule: scheduleView(db.prepare('SELECT * FROM schedules WHERE schedule_id = ?').get(id)) };
    },
    deleteSchedule(principal, id) { return db.prepare('DELETE FROM schedules WHERE schedule_id = ? AND owner_user_id = ?').run(id, principal.userId).changes ? { http: 204 } : { http: 404, code: 'not_found' }; },
    // 실행기가 회차를 끝낸 뒤: 결과·다음 실행·하루 횟수(그 시간대의 날짜로)·멈춤
    recordScheduleRun(id, { at, requestId = null, result, nextRunAt, day, counted, pause = null, disable = false }) {
      const r = db.prepare('SELECT runs_day, runs_today FROM schedules WHERE schedule_id = ?').get(id);
      if (!r) return;
      const today = r.runs_day === day ? r.runs_today : 0;
      db.prepare(`UPDATE schedules SET last_run_at = ?, last_request_id = COALESCE(?, last_request_id), last_result = ?, next_run_at = ?, runs_day = ?, runs_today = ?,
        paused_reason = COALESCE(?, paused_reason), enabled = CASE WHEN ? THEN 0 ELSE enabled END WHERE schedule_id = ?`)
        .run(at, requestId, result, nextRunAt, day, today + (counted ? 1 : 0), pause, disable ? 1 : 0, id);
    },
    pauseSchedule(id, reason) { db.prepare('UPDATE schedules SET paused_reason = ? WHERE schedule_id = ?').run(reason, id); },
    // W3: 끝났는데 아직 메신저 방에 알리지 않은 예약 질문(답·상태). 가져가면 알린 것으로 적는다.
    takeScheduleResults() {
      const rows = db.prepare(`SELECT s.schedule_id, s.conversation_id, s.kind, s.spec, s.tz, s.last_request_id, r.status, r.answer, r.error_code FROM schedules s
        JOIN requests r ON r.request_id = s.last_request_id
        WHERE (s.notified_request_id IS NULL OR s.notified_request_id != s.last_request_id) AND r.status IN ('completed', 'failed', 'unknown', 'cancelled', 'approval_required')`).all();
      for (const r of rows) db.prepare('UPDATE schedules SET notified_request_id = ? WHERE schedule_id = ?').run(r.last_request_id, r.schedule_id);
      return rows.map((r) => ({ conversationId: r.conversation_id, kind: r.kind, spec: JSON.parse(r.spec), tz: r.tz, requestId: r.last_request_id, status: r.status, answer: r.answer ?? null, errorCode: r.error_code ?? null }));
    },
    requestStatus(requestId) { return db.prepare('SELECT status FROM requests WHERE request_id = ?').get(requestId)?.status ?? null; },
    // WS1-a: 붙인 작업 공간 표시(없으면 null)·기록
    workspaceView(conversationId) { const r = db.prepare('SELECT view FROM workspace_views WHERE conversation_id = ?').get(conversationId); try { return r ? JSON.parse(r.view) : null; } catch { return null; } },
    saveWorkspace(principal, conversationId, view) {
      const b = binding(conversationId);
      if (!canAccess(principal, b)) return { http: 404, code: 'not_found' };
      const at = new Date().toISOString();
      if (view) db.prepare('INSERT INTO workspace_views (conversation_id, view, updated_at) VALUES (?, ?, ?) ON CONFLICT(conversation_id) DO UPDATE SET view = excluded.view, updated_at = excluded.updated_at').run(conversationId, JSON.stringify(view), at);
      else db.prepare('DELETE FROM workspace_views WHERE conversation_id = ?').run(conversationId);
      db.prepare('INSERT INTO workspace_log (at, user_id, conversation_id, host_id, detail) VALUES (?, ?, ?, ?, ?)').run(at, principal.userId, conversationId, b.hostId ?? null,
        JSON.stringify(view ? { personal: view.personal, shared: view.shared } : { detached: true }));
      return { http: 200 };
    },
    workspaceLog(principal, conversationId, limit = 20) {
      const b = binding(conversationId);
      if (!canAccess(principal, b)) return null;
      return db.prepare('SELECT at, user_id, detail FROM workspace_log WHERE conversation_id = ? ORDER BY id DESC LIMIT ?').all(conversationId, limit)
        .map((r) => ({ at: r.at, userId: r.user_id, ...JSON.parse(r.detail) }));
    },
    setWorkMode(principal, conversationId, on) {
      const b = binding(conversationId);
      if (!canAccess(principal, b)) return { http: 404, code: 'not_found' };
      if (typeof on !== 'boolean') return { http: 400, code: 'bad_work_mode' };
      if (on && (!['codex_thread', 'agy_cli'].includes(b.engine) || newSession(conversationId))) return { http: 400, code: 'work_mode_not_supported' }; // E3: Antigravity도(ACP)
      return tx(() => {
        if (db.prepare('SELECT 1 FROM locks WHERE session_key = ?').get(sessionKey(b))) return { http: 409, code: 'conversation_busy' };
        if (on) db.prepare('INSERT OR REPLACE INTO work_modes (conversation_id, set_by, set_at) VALUES (?, ?, ?)').run(conversationId, principal.userId, new Date().toISOString());
        else db.prepare('DELETE FROM work_modes WHERE conversation_id = ?').run(conversationId);
        return { http: 200, workMode: on };
      });
    },

    // unknown 요청을 공식 조회 결과로만 정리한다. 재전송은 하지 않는다.
    resolveUnknown(requestId, { found, receipt = null, answer = null }) {
      const row = request(requestId);
      if (!row || row.status !== STATUS.unknown) return view(row);
      if (found) setStatus(row, STATUS.completed, { receipt, answer: keepAnswer(row, answer) });
      else setStatus(row, STATUS.failed, { error_code: 'not_executed' });
      return view(request(requestId));
    },

    // 사람이 원래 세션(Desktop·TUI·터미널) 화면을 보고 확인한 결과로 정리한다. 재전송은 하지 않는다.
    // executed=true: 실행된 것으로 닫되, 섞였을 수 있거나 받지 못한 답은 저장하지 않는다.
    // executed=false: 실행되지 않은 것으로 닫는다. 같은 질문을 다시 보낼지는 사람이 정한다.
    resolveByReview(principal, requestId, executed) {
      const row = request(requestId);
      if (!row || !canAccess(principal, binding(row.conversation_id))) return { http: 404, code: 'not_found' };
      if (!NEEDS_REVIEW.has(row.status)) return { http: 409, code: 'not_reviewable' };
      if (typeof executed !== 'boolean') return { http: 400, code: 'bad_request' };
      const reason = row.error_code ?? row.status;
      if (executed) setStatus(row, STATUS.completed, { answer: null, error_code: `reviewed_executed:${reason}` });
      else setStatus(row, STATUS.failed, { error_code: `reviewed_not_executed:${reason}` });
      return { ...view(request(requestId)), http: 200 };
    },

    getRequest(principal, requestId) {
      const row = request(requestId);
      if (!row || !canAccess(principal, binding(row.conversation_id))) return null;
      return view(row);
    },

// --- AP-2 이어온 앱 기기 연결(MESSENGER_EXPANSION B6·AP5): 1회용 연결 코드(10분) → 앱 기기 열쇠(해시만 저장) ---
    addAppPairCode(userId, codeHash, ttlMs = 10 * 60_000) {
      const now = Date.now();
      db.prepare('DELETE FROM app_pair_codes WHERE expires_at < ? OR used_at IS NOT NULL').run(now);
      if (db.prepare('SELECT COUNT(*) AS n FROM app_pair_codes WHERE user_id = ?').get(userId).n >= 5) return { http: 429, code: 'too_many_codes' };
      db.prepare('INSERT INTO app_pair_codes (code_sha256, user_id, expires_at) VALUES (?, ?, ?)').run(codeHash, userId, now + ttlMs);
      return { http: 201, expiresAt: new Date(now + ttlMs).toISOString() };
    },
    // 코드는 한 번만, 10분 안에만. 맞으면 새 앱 기기를 만든다(열쇠 해시만 저장).
    useAppPairCode(codeHash, { deviceId, name, tokenHash }) {
      return tx(() => {
        const c = db.prepare('SELECT * FROM app_pair_codes WHERE code_sha256 = ?').get(codeHash);
        if (!c || c.used_at || c.expires_at < Date.now()) return { http: 403, code: 'bad_code' };
        db.prepare('UPDATE app_pair_codes SET used_at = ? WHERE code_sha256 = ?').run(new Date().toISOString(), codeHash);
        db.prepare('INSERT INTO app_devices (device_id, user_id, name, token_sha256, created_at) VALUES (?, ?, ?, ?, ?)').run(deviceId, c.user_id, name, tokenHash, new Date().toISOString());
        return { http: 201, userId: c.user_id };
      });
    },
    requestConversation(requestId) { return request(requestId)?.conversation_id ?? null; },
    approvalConversation(approvalId) { return db.prepare('SELECT conversation_id FROM approvals WHERE approval_id = ?').get(approvalId)?.conversation_id ?? null; },
    activeAppDeviceHashes() { return db.prepare('SELECT device_id, user_id, token_sha256 FROM app_devices WHERE revoked_at IS NULL').all().map((d) => ({ deviceId: d.device_id, userId: d.user_id, tokenSha256: d.token_sha256 })); },
    // AP-4b: 앱이 알림 주소를 알림(같은 주소를 다른 기기가 갖고 있으면 그쪽은 지움 — 같은 휴대폰을 다시 연결한 경우)
    setAppPushToken(deviceId, token) {
      db.prepare('UPDATE app_devices SET push_token = NULL WHERE push_token = ? AND device_id != ?').run(token, deviceId);
      db.prepare('UPDATE app_devices SET push_token = ? WHERE device_id = ? AND revoked_at IS NULL').run(token, deviceId);
    },
    addWebSub(userId, s) { db.prepare('INSERT INTO web_push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth').run(s.endpoint, userId, s.keys.p256dh, s.keys.auth, new Date().toISOString()); },
    removeWebSub(endpoint) { db.prepare('DELETE FROM web_push_subs WHERE endpoint = ?').run(endpoint); },
    webSubs(userId) { return db.prepare('SELECT endpoint, p256dh, auth FROM web_push_subs WHERE user_id = ?').all(userId).map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } })); },
    clearPushToken(token) { db.prepare('UPDATE app_devices SET push_token = NULL WHERE push_token = ?').run(token); },
    // 그 대화 주인의 알림 받을 앱 기기들
    pushTargets(conversationId) {
      const owner = binding(conversationId)?.ownerUserId;
      return owner ? { owner, tokens: db.prepare('SELECT push_token FROM app_devices WHERE user_id = ? AND revoked_at IS NULL AND push_token IS NOT NULL').all(owner).map((d) => d.push_token) } : { owner: null, tokens: [] };
    },
    touchAppDevice(deviceId) { db.prepare('UPDATE app_devices SET last_seen_at = ? WHERE device_id = ?').run(new Date().toISOString(), deviceId); },
    appDevices(userId) { return db.prepare('SELECT device_id, name, created_at, last_seen_at, revoked_at, push_token FROM app_devices WHERE user_id = ? ORDER BY created_at DESC').all(userId).map((d) => ({ deviceId: d.device_id, name: d.name, createdAt: d.created_at, lastSeenAt: d.last_seen_at, revokedAt: d.revoked_at, push: Boolean(d.push_token) })); },
    revokeAppDevice(userId, deviceId) { return db.prepare('UPDATE app_devices SET revoked_at = ? WHERE device_id = ? AND user_id = ? AND revoked_at IS NULL').run(new Date().toISOString(), deviceId, userId).changes === 1; },

// --- W1 승인 카드(WORK_AND_VOICE A1·A3). 15분 안에 답이 없으면 거부, 차례가 끝나면 거부, 허용·거부는 주인만 ---
    addApproval(hostId, { requestId, kind, summary, cwd, itemId }) {
      const row = request(String(requestId ?? ''));
      const b = row && binding(row.conversation_id);
      if (!b || b.hostId !== hostId || ![STATUS.dispatching, STATUS.running].includes(row.status)) return { http: 404, code: 'not_found' };
      if (!['command', 'file', 'permissions'].includes(kind)) return { http: 400, code: 'bad_kind' };
      const id = `apv_${randomUUID()}`;
      return tx(() => {
        // RC1: 대화마다 1부터 매기는 번호(메신저 /허용 n — 메신저를 다시 켜도 같은 번호), 그때의 AI 직원 이름과 엔진
        const seq = (db.prepare('SELECT MAX(seq) AS m FROM approvals WHERE conversation_id = ?').get(row.conversation_id)?.m ?? 0) + 1;
        const agent = db.prepare('SELECT name FROM staff WHERE conversation_id = ?').get(row.conversation_id)?.name ?? b.label ?? null;
        // RC5: "사람이 직접 할 일" 규칙에 맞으면 묻지 않고 바로 넘김(엔진에는 거부로 전달 — 연결부가 handoff를 거부로 읽음)
        const handoff = this.handoffMatch(row.conversation_id, kind, summary);
        const now = new Date().toISOString();
        db.prepare("INSERT INTO approvals (approval_id, request_id, conversation_id, kind, summary, cwd, status, created_at, seq, agent, engine, item_id, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(id, row.request_id, row.conversation_id, kind, String(summary ?? '').slice(0, 500), cwd ? String(cwd).slice(0, 300) : null, handoff ? 'handoff' : 'pending', now,
            seq, agent ? String(agent).slice(0, 60) : null, b.engine, itemId ? String(itemId).slice(0, 120) : null, handoff ? 'policy' : null, handoff ? now : null);
        return { http: 201, approvalId: id, n: seq, ...(handoff ? { handoff: true } : {}) };
      });
    },
    // 시간이 지난 것은 읽을 때 거부로 바꾼다(타이머 없이도 15분 규칙이 지켜지게)
    approvalStatus(approvalId, { ttlMs = 15 * 60_000 } = {}) {
      const a = db.prepare('SELECT * FROM approvals WHERE approval_id = ?').get(approvalId);
      if (!a) return null;
      if (a.status === 'pending' && Date.now() - Date.parse(a.created_at) > ttlMs) {
        db.prepare("UPDATE approvals SET status = 'expired', decided_at = ? WHERE approval_id = ? AND status = 'pending'").run(new Date().toISOString(), approvalId);
        a.status = 'expired';
      }
      return a;
    },
    approvalHost(approvalId) {
      const a = db.prepare('SELECT conversation_id FROM approvals WHERE approval_id = ?').get(approvalId);
      return a ? binding(a.conversation_id)?.hostId ?? null : null;
    },
    decideApproval(principal, approvalId, decision, opts) {
      const a = this.approvalStatus(approvalId, opts);
      if (!a || !canAccess(principal, binding(a.conversation_id))) return { http: 404, code: 'not_found' };
      // RC5: 사람에게 넘긴 일 — 직접 처리함(done) 또는 하지 않음(drop)을 원래 요청에 기록(한 번만)
      if (decision === 'done' || decision === 'drop') {
        if (a.status !== 'handoff') return { http: 409, code: 'approval_closed', status: a.status };
        const st = decision === 'done' ? 'handoff_done' : 'handoff_dropped';
        const ch = db.prepare("UPDATE approvals SET status = ?, decided_by = ?, decided_at = ? WHERE approval_id = ? AND status = 'handoff'").run(st, `${principal.userId}:${principal.appId}`, new Date().toISOString(), approvalId);
        return ch.changes === 1 ? { http: 200, status: st } : { http: 409, code: 'approval_closed', status: this.approvalStatus(approvalId, opts)?.status };
      }
      if (!['allow', 'deny'].includes(decision)) return { http: 400, code: 'bad_decision' };
      if (a.status !== 'pending') return { http: 409, code: 'approval_closed', status: a.status };
      const done = db.prepare('UPDATE approvals SET status = ?, decided_by = ?, decided_at = ? WHERE approval_id = ? AND status = ?')
        .run(decision === 'allow' ? 'allowed' : 'denied', `${principal.userId}:${principal.appId}`, new Date().toISOString(), approvalId, 'pending');
      // 두 화면이 같은 순간에 답해도 먼저 닿은 답 하나만 적용된다
      if (done.changes !== 1) return { http: 409, code: 'approval_closed', status: this.approvalStatus(approvalId, opts)?.status };
      return { http: 200, status: decision === 'allow' ? 'allowed' : 'denied' };
    },
    // RC1: 연결부가 허용 결정을 읽어 간 순간부터 "실행 중"(엔진에 허용을 전달함)
    markApprovalPicked(approvalId) {
      return db.prepare("UPDATE approvals SET exec_status = 'running' WHERE approval_id = ? AND status = 'allowed' AND exec_status IS NULL").run(approvalId).changes === 1;
    },
    // RC1: 허용한 항목의 실제 실행 결과. 그 PC가 처리 중인 승인만, 허용된 것만, 한 번만. 엔진 항목이 다르면 받지 않는다.
    reportApprovalResult(hostId, approvalId, { outcome, exitCode, itemId } = {}) {
      const a = db.prepare('SELECT * FROM approvals WHERE approval_id = ?').get(approvalId);
      if (!a || binding(a.conversation_id)?.hostId !== hostId) return { http: 404, code: 'not_found' };
      if (!['completed', 'failed'].includes(outcome)) return { http: 400, code: 'bad_outcome' };
      if (a.status !== 'allowed') return { http: 409, code: 'not_allowed', status: a.status };
      if (a.item_id && itemId && String(itemId) !== a.item_id) return { http: 409, code: 'item_mismatch' };
      if (a.exec_status && a.exec_status !== 'running') return { http: 409, code: 'result_closed', execStatus: a.exec_status };
      const code = Number.isInteger(exitCode) ? exitCode : null;
      db.prepare("UPDATE approvals SET exec_status = ?, exec_at = ?, exit_code = ? WHERE approval_id = ? AND status = 'allowed' AND (exec_status IS NULL OR exec_status = 'running')")
        .run(outcome, new Date().toISOString(), code, approvalId);
      return { http: 200, execStatus: outcome };
    },
    approvals(principal, conversationId, { pendingOnly = false, ttlMs } = {}) {
      if (!canAccess(principal, binding(conversationId))) return null;
      const rows = db.prepare(`SELECT approval_id FROM approvals WHERE conversation_id = ? ${pendingOnly ? "AND status = 'pending'" : ''} ORDER BY created_at DESC LIMIT 20`).all(conversationId);
      return rows.map((r) => this.approvalStatus(r.approval_id, { ttlMs })).filter((a) => !pendingOnly || a.status === 'pending')
        .map((a) => ({ approvalId: a.approval_id, requestId: a.request_id, kind: a.kind, summary: a.summary, cwd: a.cwd, status: a.status,
          createdAt: a.created_at, decidedAt: a.decided_at, decidedBy: a.decided_by ? a.decided_by.split(':')[0] : null,
          n: a.seq ?? null, agent: a.agent ?? null, engine: a.engine ?? null, state: approvalState(a),
          execStatus: a.exec_status ?? null, execAt: a.exec_at ?? null, exitCode: a.exit_code ?? null }));
    },

    // --- AP-1 AI 직원(대화 하나에 이름·역할·아이콘) ---
    staffOf(conversationId) {
      const s = db.prepare('SELECT s.name, s.role_id, s.icon, r.name AS role_name FROM staff s LEFT JOIN roles r ON r.role_id = s.role_id WHERE s.conversation_id = ?').get(conversationId);
      return s ? { name: s.name, roleId: s.role_id, roleName: s.role_name ?? null, icon: s.icon ?? null } : null;
    },
    setStaff(principal, conversationId, { name, roleId = null, icon = null }) {
      const b = binding(conversationId);
      if (!canAccess(principal, b)) return { http: 404, code: 'not_found' };
      const n = String(name ?? '').trim();
      if (!/^[\p{L}\p{N}_-]{1,20}$/u.test(n)) return { http: 400, code: 'bad_staff_name' }; // @이름으로 부를 수 있게 빈칸 없이
      if (roleId && !db.prepare('SELECT 1 FROM roles WHERE role_id = ?').get(roleId)) return { http: 400, code: 'unknown_role' };
      const ic = icon ? String(icon).trim() : null;
      if (ic && [...ic].length > 2) return { http: 400, code: 'bad_icon' };
      const taken = db.prepare('SELECT s.conversation_id FROM staff s JOIN bindings b ON b.conversation_id = s.conversation_id WHERE lower(s.name) = lower(?) AND b.owner_user_id = ?').get(n, b.ownerUserId); // M2-b: 같은 사람 안에서만
      if (taken && taken.conversation_id !== conversationId) return { http: 409, code: 'staff_name_taken' };
      const prev = db.prepare('SELECT role_id FROM staff WHERE conversation_id = ?').get(conversationId);
      const pending = roleId && prev?.role_id !== roleId ? 1 : 0; // 역할이 바뀌면 다음 질문 한 번에 역할 안내
      db.prepare(`INSERT INTO staff (conversation_id, name, role_id, icon, guide_pending) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET name = excluded.name, role_id = excluded.role_id, icon = excluded.icon,
        guide_pending = CASE WHEN excluded.guide_pending = 1 THEN 1 ELSE staff.guide_pending END`).run(conversationId, n, roleId || null, ic, pending);
      return { http: 200, staff: this.staffOf(conversationId) };
    },

    // --- AP-1 방(AI 직원 여러 명). 사람은 사용자 한 명(방 주인) ---
    rooms(principal) {
      return db.prepare('SELECT room_id FROM rooms WHERE owner_user_id = ? ORDER BY created_at').all(principal.userId).map((r) => this.room(principal, r.room_id)).filter(Boolean);
    },
    room(principal, roomId) {
      const r = db.prepare('SELECT * FROM rooms WHERE room_id = ? AND owner_user_id = ?').get(roomId, principal.userId);
      if (!r) return null;
      const members = db.prepare('SELECT conversation_id FROM room_members WHERE room_id = ? ORDER BY rowid').all(roomId).map((m) => m.conversation_id)
        .filter((id) => canAccess(principal, binding(id)));
      return { roomId: r.room_id, name: r.name, lead: r.lead_conversation_id, guide: r.guide, members, createdAt: r.created_at };
    },
    saveRoom(principal, roomId, { name, members, lead, guide = '' }) {
      const n = String(name ?? '').trim();
      if (!n || n.length > 30) return { http: 400, code: 'bad_room_name' };
      const ids = [...new Set((Array.isArray(members) ? members : []).map(String))];
      if (ids.length < 1 || ids.length > 10) return { http: 400, code: 'bad_members' };
      if (ids.some((id) => !canAccess(principal, binding(id)))) return { http: 400, code: 'bad_members' };
      if (!ids.includes(String(lead))) return { http: 400, code: 'bad_lead' };
      const g = String(guide ?? '').trim();
      if (g.length > 1000) return { http: 400, code: 'too_long' };
      if (roomId && !db.prepare('SELECT 1 FROM rooms WHERE room_id = ? AND owner_user_id = ?').get(roomId, principal.userId)) return { http: 404, code: 'not_found' };
      const id = roomId ?? `room_${randomUUID()}`;
      tx(() => {
        db.prepare(`INSERT INTO rooms (room_id, owner_user_id, name, lead_conversation_id, guide, created_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(room_id) DO UPDATE SET name = excluded.name, lead_conversation_id = excluded.lead_conversation_id, guide = excluded.guide`)
          .run(id, principal.userId, n, String(lead), g, new Date().toISOString());
        db.prepare('DELETE FROM room_members WHERE room_id = ?').run(id);
        for (const m of ids) db.prepare('INSERT INTO room_members (room_id, conversation_id) VALUES (?, ?)').run(id, m);
      });
      return { http: roomId ? 200 : 201, room: this.room(principal, id) };
    },
    // 방 기록만 지운다(각 AI 직원 세션·1:1 기록은 그대로)
    deleteRoom(principal, roomId) {
      if (!db.prepare('SELECT 1 FROM rooms WHERE room_id = ? AND owner_user_id = ?').get(roomId, principal.userId)) return { http: 404, code: 'not_found' };
      tx(() => { for (const tb of ['room_posts', 'room_members', 'rooms']) db.prepare(`DELETE FROM ${tb} WHERE room_id = ?`).run(roomId); });
      return { http: 204 };
    },
    addRoomPost(roomId, post) {
      db.prepare('INSERT INTO room_posts (post_id, room_id, kind, text, conversation_id, request_id, code, idem_key, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(`post_${randomUUID()}`, roomId, post.kind, post.text ?? null, post.conversationId ?? null, post.requestId ?? null, post.code ?? null, post.idemKey ?? null, new Date().toISOString());
    },
    markRoomRetried(roomId, postId) { return db.prepare('UPDATE room_posts SET retried = 1 WHERE room_id = ? AND post_id = ? AND retried = 0').run(roomId, postId).changes === 1; },
    roomPostByKey(roomId, key) { return db.prepare("SELECT 1 FROM room_posts WHERE room_id = ? AND idem_key = ? AND kind = 'user'").get(roomId, key) ? true : false; },
    // 방 기록: 사용자 글·보낸 질문(상태·답은 요청에서)·사용 중 알림
    roomPosts(principal, roomId) {
      if (!this.room(principal, roomId)) return null;
      return db.prepare(`SELECT p.post_id, p.kind, p.text, p.conversation_id, p.request_id, p.code, p.at, p.retried, q.status, q.answer, q.error_code, q.question
        FROM room_posts p LEFT JOIN requests q ON q.request_id = p.request_id WHERE p.room_id = ? ORDER BY p.rowid`).all(roomId)
        .map((r) => ({ postId: r.post_id, kind: r.kind, text: r.kind === 'busy' ? null : r.text, conversationId: r.conversation_id, requestId: r.request_id, code: r.code, at: r.at, retried: Boolean(r.retried),
          resend: r.kind === 'busy' ? r.text : r.kind === 'ask' ? r.question : null, // 다시 보내기용 원문(화면에는 내보내지 않음)
          ...(r.request_id ? { status: r.status, answer: r.status === 'completed' ? r.answer : null, errorCode: r.error_code } : {}) }));
    },

    messages(principal, conversationId) {
      const b = binding(conversationId);
      if (!canAccess(principal, b)) return null;
      return db.prepare(`SELECT request_id, question, answer FROM requests
        WHERE conversation_id = ? AND generation = ? AND status = 'completed' ORDER BY rowid`)
        .all(conversationId, b.generation)
        .map((r) => ({ requestId: r.request_id, question: r.question, answer: r.answer }));
    },

    // 서버 보관 원문만 지운다. 원래 세션 기록에는 손대지 않는다.
    deleteMessages(principal, conversationId) {
      const b = binding(conversationId);
      if (!canAccess(principal, b)) return { http: 404, code: 'not_found' };
      tx(() => {
        db.prepare('UPDATE bindings SET generation = generation + 1 WHERE conversation_id = ?').run(conversationId);
        db.prepare('UPDATE requests SET question = NULL, answer = NULL WHERE conversation_id = ?').run(conversationId);
      });
      return { http: 204 };
    },

    // --- 여러 봇(MULTI_BOTS M0): 역할·봇 정의. 토큰은 저장하지 않는다(.env에만). ---
    listRoles() { return db.prepare('SELECT * FROM roles ORDER BY role_id').all().map(roleView); },
    saveRole(r) {
      const engines = Array.isArray(r.engines) ? [...new Set(r.engines)] : [];
      const profiles = Array.isArray(r.profiles) ? [...new Set(r.profiles)] : [];
      if (!validBotId(r.roleId)) return { http: 400, code: 'bad_role_id' };
      if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 30) return { http: 400, code: 'bad_name' };
      if (!engines.length || engines.some((e) => !Object.hasOwn(NEW_ENGINES, e))) return { http: 400, code: 'bad_engines' };
      // full(명령 실행·인터넷)은 역할로 줄 수 없다. 설정 파일 sessionOverrides로만.
      if (!profiles.length || profiles.some((p) => !['read_only', 'workspace'].includes(p))) return { http: 400, code: 'bad_profiles' };
      const guide = String(r.aiGuide ?? '');
      if (guide.length > 2000 || String(r.description ?? '').length > 200) return { http: 400, code: 'too_long' };
      const def = r.defaultSession ? String(r.defaultSession) : null;
      if (def && !binding(def)) return { http: 400, code: 'unknown_session' };
      db.prepare(`INSERT INTO roles (role_id, name, description, engines, profiles, ai_guide, default_session) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (role_id) DO UPDATE SET name = excluded.name, description = excluded.description, engines = excluded.engines,
        profiles = excluded.profiles, ai_guide = excluded.ai_guide, default_session = excluded.default_session`)
        .run(r.roleId, r.name.trim(), String(r.description ?? ''), JSON.stringify(engines), JSON.stringify(profiles), guide, def);
      return { http: 200, role: roleView(db.prepare('SELECT * FROM roles WHERE role_id = ?').get(r.roleId)) };
    },
    deleteRole(roleId) {
      if (!db.prepare('SELECT 1 FROM roles WHERE role_id = ?').get(roleId)) return { http: 404, code: 'not_found' };
      if (db.prepare('SELECT 1 FROM bots WHERE role_id = ?').get(roleId)) return { http: 409, code: 'role_in_use' };
      db.prepare('DELETE FROM roles WHERE role_id = ?').run(roleId);
      return { http: 204 };
    },
    // 메신저마다 default 봇(지금 쓰는 봇)이 없으면 만든다. 이미 있으면 사용자가 바꾼 이름·역할을 건드리지 않는다.
    ensureDefaultBots() {
      for (const p of ['telegram', 'discord', 'slack', 'line']) { // L1: 라인도 기본 봇을 두어 메신저 창에서 고를 수 있게
        db.prepare(`INSERT OR IGNORE INTO bots (platform, bot_id, name, role_id, call_names, extra_users, enabled)
          VALUES (?, ?, ?, NULL, '[]', '[]', 1)`).run(p, DEFAULT_BOT, i18nT('server.default_bot_name'));
      }
    },
    listBots() { return db.prepare('SELECT * FROM bots ORDER BY platform, bot_id').all().map(botView); },
    bot(platform, botId) { return botView(db.prepare('SELECT * FROM bots WHERE platform = ? AND bot_id = ?').get(platform, botId)); },
    saveBot(b) {
      if (!PLATFORMS.includes(b.platform)) return { http: 400, code: 'bad_platform' };
      if (!validBotId(b.botId)) return { http: 400, code: 'bad_bot_id' };
      if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 30) return { http: 400, code: 'bad_name' };
      const role = b.roleId ? String(b.roleId) : null;
      if (role && !db.prepare('SELECT 1 FROM roles WHERE role_id = ?').get(role)) return { http: 400, code: 'unknown_role' };
      const calls = Array.isArray(b.callNames) ? b.callNames.map((c) => String(c).trim()).filter(Boolean) : [];
      if (calls.some((c) => !validCallName(c))) return { http: 400, code: 'bad_call_name' };
      const norm = calls.map(normalizeCallName);
      if (new Set(norm).size !== norm.length) return { http: 400, code: 'duplicate_call_name' };
      // 같은 메신저의 다른 봇과 부르는 이름이 겹치면 어느 봇을 부른 것인지 알 수 없다.
      for (const other of db.prepare('SELECT bot_id, call_names FROM bots WHERE platform = ? AND bot_id != ?').all(b.platform, b.botId)) {
        const theirs = [other.bot_id, ...JSON.parse(other.call_names)].map(normalizeCallName);
        const clash = [b.botId, ...calls].map(normalizeCallName).find((n) => theirs.includes(n));
        if (clash) return { http: 409, code: 'call_name_taken', callName: clash, botId: other.bot_id };
      }
      const users = Array.isArray(b.extraUsers) ? b.extraUsers.map(String).filter((u) => /^[\w.:@-]{1,128}$/.test(u)) : []; // 카카오 사용자 ID는 66자
      db.prepare(`INSERT INTO bots (platform, bot_id, name, role_id, call_names, extra_users, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (platform, bot_id) DO UPDATE SET name = excluded.name, role_id = excluded.role_id, call_names = excluded.call_names,
        extra_users = excluded.extra_users, enabled = excluded.enabled`)
        .run(b.platform, b.botId, b.name.trim(), role, JSON.stringify(calls), JSON.stringify(users), b.enabled === false ? 0 : 1);
      return { http: 200, bot: this.bot(b.platform, b.botId) };
    },
    // 봇이 볼 수 있는 기존 세션(웹에서 고름). 목록 전체를 바꾼다. 없는 세션은 거절한다.
    botSessions(platform, botId) {
      return db.prepare('SELECT conversation_id FROM bot_sessions WHERE platform = ? AND bot_id = ? ORDER BY conversation_id').all(platform, botId).map((r) => r.conversation_id);
    },
    setBotSessions(platform, botId, ids) {
      if (!this.bot(platform, botId)) return { http: 404, code: 'not_found' };
      const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
      if (list.some((id) => !db.prepare('SELECT 1 FROM bindings WHERE conversation_id = ?').get(id))) return { http: 400, code: 'unknown_session' };
      tx(() => {
        db.prepare('DELETE FROM bot_sessions WHERE platform = ? AND bot_id = ?').run(platform, botId);
        for (const id of list) db.prepare('INSERT INTO bot_sessions (platform, bot_id, conversation_id) VALUES (?, ?, ?)').run(platform, botId, id);
      });
      return { http: 200, sessions: this.botSessions(platform, botId) };
    },

    deleteBot(platform, botId) {
      if (botId === DEFAULT_BOT) return { http: 409, code: 'default_bot' };
      db.prepare('DELETE FROM bot_sessions WHERE platform = ? AND bot_id = ?').run(platform, botId);
      if (!db.prepare('DELETE FROM bots WHERE platform = ? AND bot_id = ?').run(platform, botId).changes) return { http: 404, code: 'not_found' };
      return { http: 204 };
    },

    // --- P1: 웹에서 바꾼 설정(없으면 파일 값을 쓴다) ---
    getSetting(key) {
      const r = db.prepare('SELECT value, updated_at FROM settings WHERE key = ?').get(key);
      return r ? { value: JSON.parse(r.value), updatedAt: r.updated_at } : null;
    },
    setSetting(key, value) {
      db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, JSON.stringify(value), new Date().toISOString());
    },
    // W2b: 외부 프로그램 API 키(웹에서 발급, 키는 해시만). 프로그램마다 볼 수 있는 세션을 따로 둔다.
    listApiApps() {
      return db.prepare('SELECT app_id, name, created_at, revoked_at FROM api_apps ORDER BY created_at').all().map((a) => ({ appId: a.app_id, name: a.name,
        createdAt: a.created_at, revokedAt: a.revoked_at,
        sessions: db.prepare('SELECT conversation_id FROM app_sessions WHERE app_id = ? ORDER BY conversation_id').all(a.app_id).map((r) => r.conversation_id) }));
    },
    activeApiAppHashes() { return db.prepare('SELECT app_id, token_sha256 FROM api_apps WHERE revoked_at IS NULL').all().map((a) => ({ appId: a.app_id, tokenSha256: a.token_sha256 })); },
    addApiApp(appId, name, tokenSha256) {
      if (db.prepare('SELECT 1 FROM api_apps WHERE app_id = ?').get(appId)) return { http: 409, code: 'app_taken' };
      db.prepare('INSERT INTO api_apps (app_id, name, token_sha256, created_at) VALUES (?, ?, ?, ?)').run(appId, name, tokenSha256, new Date().toISOString());
      return { http: 201 };
    },
    revokeApiApp(appId) {
      const r = db.prepare('UPDATE api_apps SET revoked_at = ? WHERE app_id = ? AND revoked_at IS NULL').run(new Date().toISOString(), appId);
      return r.changes ? { http: 200 } : { http: 404, code: 'not_found' };
    },
    setAppSessions(appId, ids) {
      if (!db.prepare('SELECT 1 FROM api_apps WHERE app_id = ?').get(appId)) return { http: 404, code: 'not_found' };
      const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
      if (list.some((id) => !db.prepare('SELECT 1 FROM bindings WHERE conversation_id = ?').get(id))) return { http: 400, code: 'unknown_session' };
      tx(() => {
        db.prepare('DELETE FROM app_sessions WHERE app_id = ?').run(appId);
        for (const id of list) db.prepare('INSERT INTO app_sessions (app_id, conversation_id) VALUES (?, ?)').run(appId, id);
      });
      return { http: 200 };
    },
    // W1: 웹 로그인 세션(쿠키). 쿠키 값은 해시만 둔다.
    addWebSession(sidSha256, userId, expiresAt) {
      db.prepare("DELETE FROM web_sessions WHERE expires_at < ?").run(Date.now());
      db.prepare("INSERT INTO web_sessions (sid_sha256, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(sidSha256, userId, new Date().toISOString(), expiresAt);
    },
    webSession(sidSha256) {
      const r = db.prepare("SELECT user_id, expires_at FROM web_sessions WHERE sid_sha256 = ?").get(sidSha256);
      return r && r.expires_at > Date.now() ? { userId: r.user_id } : null;
    },
    deleteWebSession(sidSha256) { db.prepare("DELETE FROM web_sessions WHERE sid_sha256 = ?").run(sidSha256); },
    deleteAllWebSessions() { db.prepare("DELETE FROM web_sessions").run(); },
    deleteWebSessionsOf(userId) { db.prepare('DELETE FROM web_sessions WHERE user_id = ?').run(userId); },
    // --- M2 사용자 ---
    addUser(userId, email, pwHash, termsAt = null) {
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return { http: 409, code: 'email_taken' };
      db.prepare("INSERT INTO users (user_id, email, pw_hash, status, created_at, terms_at) VALUES (?, ?, ?, 'pending', ?, ?)").run(userId, email, pwHash, new Date().toISOString(), termsAt);
      return { http: 201 };
    },
    userByEmail(email) { const r = db.prepare('SELECT * FROM users WHERE email = ?').get(email); return r ? { userId: r.user_id, email: r.email, pwHash: r.pw_hash, status: r.status } : null; },
    user(userId) { const r = db.prepare('SELECT user_id, email, status FROM users WHERE user_id = ?').get(userId); return r ? { userId: r.user_id, email: r.email, status: r.status } : null; },
    listUsers() {
      return db.prepare("SELECT u.user_id, u.email, u.status, u.created_at, u.decided_at, u.terms_at, (SELECT COUNT(*) FROM devices d WHERE d.owner_user_id = u.user_id AND d.revoked_at IS NULL) AS devices FROM users u ORDER BY u.created_at DESC").all()
        .map((r) => ({ userId: r.user_id, email: r.email, status: r.status, createdAt: r.created_at, decidedAt: r.decided_at, termsAt: r.terms_at, devices: r.devices }));
    },
    // M4: 그 사람이 since(ISO) 뒤에 보낸 질문 수(웹·앱·메신저·예약 모두 — 요청 주인 기준)
    userQuestionsSince(userId, since) { return db.prepare('SELECT COUNT(*) AS n FROM requests WHERE user_id = ? AND created_at >= ?').get(userId, since).n; },
    // --- M3 메신저 연결 ---
    linkMessenger(platform, senderId, userId, name = null) { db.prepare('INSERT INTO messenger_links (platform, sender_id, user_id, name, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (platform, sender_id) DO UPDATE SET user_id = excluded.user_id, name = excluded.name').run(platform, senderId, userId, name, new Date().toISOString()); },
    unlinkMessenger(userId, platform, senderId) { return db.prepare('DELETE FROM messenger_links WHERE user_id = ? AND platform = ? AND sender_id = ?').run(userId, platform, senderId).changes === 1; },
    messengerLinks(userId) { return db.prepare('SELECT platform, sender_id, name, created_at FROM messenger_links WHERE user_id = ? ORDER BY created_at').all(userId).map((r) => ({ platform: r.platform, senderId: r.sender_id, name: r.name, createdAt: r.created_at })); },
    // 승인된 가입자에 연결된 메신저 계정만(끊기거나 승인 전이면 없는 것으로)
    linkedUser(platform, senderId) { return db.prepare("SELECT l.user_id FROM messenger_links l JOIN users u ON u.user_id = l.user_id WHERE l.platform = ? AND l.sender_id = ? AND u.status = 'approved'").get(platform, senderId)?.user_id ?? null; },
    linkedUserIds() { return db.prepare("SELECT DISTINCT l.user_id FROM messenger_links l JOIN users u ON u.user_id = l.user_id WHERE u.status = 'approved'").all().map((r) => r.user_id); },
    linkedSenders() { const out = {}; for (const r of db.prepare("SELECT l.platform, l.sender_id FROM messenger_links l JOIN users u ON u.user_id = l.user_id WHERE u.status = 'approved'").all()) (out[r.platform] ??= []).push(r.sender_id); return out; },
    setUserPassword(userId, pwHash) {
      const n = db.prepare('UPDATE users SET pw_hash = ? WHERE user_id = ?').run(pwHash, userId).changes;
      if (n) db.prepare('DELETE FROM web_sessions WHERE user_id = ?').run(userId); // 바꾸면 그 사람 로그인은 모두 끊김
      return n === 1;
    },
    // M2-b 가입자 지우기: 그 사람의 대화(이어온 기록)·방·예약·기기·앱 연결·알림·로그인을 모두 지운다. 원래 엔진 세션 기록(그 사람 PC)은 그대로.
    deleteUser(userId) {
      if (!db.prepare('SELECT 1 FROM users WHERE user_id = ?').get(userId)) return { http: 404, code: 'not_found' };
      return tx(() => {
        const convs = db.prepare('SELECT conversation_id FROM bindings WHERE owner_user_id = ?').all(userId).map((r) => r.conversation_id);
        for (const c of convs) {
          for (const t of ['approvals', 'requests', 'bot_sessions', 'app_sessions', 'staff', 'room_members', 'work_modes', 'workspace_views', 'handoff_policies', 'schedules', 'new_sessions', 'bindings']) db.prepare(`DELETE FROM ${t} WHERE conversation_id = ?`).run(c);
        }
        const rooms = db.prepare('SELECT room_id FROM rooms WHERE owner_user_id = ?').all(userId).map((r) => r.room_id);
        for (const r of rooms) for (const t of ['room_posts', 'room_members', 'rooms']) db.prepare(`DELETE FROM ${t} WHERE room_id = ?`).run(r);
        db.prepare('DELETE FROM schedules WHERE owner_user_id = ?').run(userId);
        const now = new Date().toISOString();
        for (const d of db.prepare('SELECT host_id FROM devices WHERE owner_user_id = ?').all(userId)) db.prepare('INSERT INTO device_events (at, host_id, action, user_id) VALUES (?, ?, ?, ?)').run(now, d.host_id, 'delete_with_user', userId);
        db.prepare('DELETE FROM devices WHERE owner_user_id = ?').run(userId);
        for (const t of ['app_devices', 'app_pair_codes', 'web_push_subs', 'web_sessions', 'messenger_links']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
        db.prepare('DELETE FROM users WHERE user_id = ?').run(userId);
        return { http: 200, conversations: convs.length, rooms: rooms.length };
      });
    },
    setUserStatus(userId, status) {
      const n = db.prepare('UPDATE users SET status = ?, decided_at = ? WHERE user_id = ?').run(status, new Date().toISOString(), userId).changes;
      if (n && status !== 'approved') db.prepare('DELETE FROM web_sessions WHERE user_id = ?').run(userId); // 끊으면 바로 로그아웃
      return n === 1;
    },
    deleteSetting(key) { return db.prepare('DELETE FROM settings WHERE key = ?').run(key).changes === 1; },

    // --- P1-c: 웹에서 등록한 기기(PC 연결부). 토큰은 해시만 저장한다. server.json 기기는 여기 없다. ---
    // M2: ownerUserId를 주면 그 사람 기기만. 주인 빈칸(예전 기기)은 관리자(adminUserId) 것으로 본다
    listDevices(ownerUserId = null, adminUserId = null) {
      return db.prepare('SELECT host_id, name, created_at, revoked_at, last_seen_at, owner_user_id FROM devices ORDER BY created_at').all()
        .filter((d) => ownerUserId === null || (d.owner_user_id ?? adminUserId) === ownerUserId)
        .map((d) => ({ hostId: d.host_id, name: d.name, createdAt: d.created_at, revokedAt: d.revoked_at, lastSeenAt: d.last_seen_at, ownerUserId: d.owner_user_id ?? adminUserId }));
    },
    deviceEvents(limit = 50) {
      return db.prepare('SELECT at, host_id, action, user_id FROM device_events ORDER BY rowid DESC LIMIT ?').all(limit)
        .map((e) => ({ at: e.at, hostId: e.host_id, action: e.action, userId: e.user_id }));
    },
    deviceOwner(hostId) { const r = db.prepare('SELECT owner_user_id FROM devices WHERE host_id = ?').get(hostId); return r ? (r.owner_user_id ?? null) : undefined; },
    // 인증용: 폐기되지 않은 기기의 토큰 해시
    activeDeviceHashes() {
      return db.prepare('SELECT host_id, token_sha256 FROM devices WHERE revoked_at IS NULL').all().map((d) => ({ hostId: d.host_id, tokenSha256: d.token_sha256 }));
    },
    addDevice(hostId, name, tokenSha256, userId) {
      if (db.prepare('SELECT 1 FROM devices WHERE host_id = ?').get(hostId)) return { http: 409, code: 'host_taken' };
      const now = new Date().toISOString();
      tx(() => {
        db.prepare('INSERT INTO devices (host_id, name, token_sha256, created_at, owner_user_id) VALUES (?, ?, ?, ?, ?)').run(hostId, name, tokenSha256, now, userId ?? null);
        db.prepare('INSERT INTO device_events (at, host_id, action, user_id) VALUES (?, ?, ?, ?)').run(now, hostId, 'register', userId);
      });
      return { http: 201 };
    },
    // 재발급: 새 해시로 바꾸면 이전 토큰은 그 순간 무효다. 폐기된 기기도 재발급하면 다시 살아난다.
    reissueDevice(hostId, tokenSha256, userId) {
      if (!db.prepare('SELECT 1 FROM devices WHERE host_id = ?').get(hostId)) return { http: 404, code: 'not_found' };
      const now = new Date().toISOString();
      tx(() => {
        db.prepare('UPDATE devices SET token_sha256 = ?, revoked_at = NULL WHERE host_id = ?').run(tokenSha256, hostId);
        db.prepare('INSERT INTO device_events (at, host_id, action, user_id) VALUES (?, ?, ?, ?)').run(now, hostId, 'reissue', userId);
      });
      return { http: 200 };
    },
    // 폐기: 그 기기의 실행 중이던 질문은 결과 불명, 아직 넘기지 않은 질문은 실행 안 됨으로 정리한다(자동 재전송 없음).
    revokeDevice(hostId, confirm, userId) {
      const d = db.prepare('SELECT name, revoked_at FROM devices WHERE host_id = ?').get(hostId);
      if (!d) return { http: 404, code: 'not_found' };
      if (d.revoked_at) return { http: 409, code: 'already_revoked' };
      if (confirm !== d.name) return { http: 400, code: 'confirm_mismatch' };
      const now = new Date().toISOString();
      const counts = tx(() => {
        db.prepare('UPDATE devices SET revoked_at = ? WHERE host_id = ?').run(now, hostId);
        db.prepare('INSERT INTO device_events (at, host_id, action, user_id) VALUES (?, ?, ?, ?)').run(now, hostId, 'revoke', userId);
        const rows = db.prepare(`SELECT r.request_id, r.status FROM requests r JOIN bindings b ON b.conversation_id = r.conversation_id
          WHERE b.host_id = ? AND r.status IN ('queued', 'dispatching', 'running')`).all(hostId);
        for (const r of rows) {
          // queued는 연결부가 가져가기 전이라 실행되지 않았음이 확실하다. 나머지는 전달됐을 수 있어 결과 불명.
          if (r.status === 'queued') {
            db.prepare("UPDATE requests SET status = 'failed', error_code = 'device_revoked' WHERE request_id = ?").run(r.request_id);
            db.prepare('DELETE FROM locks WHERE holder_request_id = ?').run(r.request_id);
          } else db.prepare("UPDATE requests SET status = 'unknown', error_code = 'device_revoked' WHERE request_id = ?").run(r.request_id);
        }
        return { notExecuted: rows.filter((r) => r.status === 'queued').length, unknown: rows.filter((r) => r.status !== 'queued').length };
      });
      return { http: 200, ...counts };
    },
    touchDevice(hostId, at) { db.prepare('UPDATE devices SET last_seen_at = ? WHERE host_id = ?').run(at, hostId); },
    // RC4 실제 끊김(2026-11-20 실측): 연결부가 다시 켜졌다 = 그 연결부가 처리하던 질문은 이제 아무도 처리하지 않는다. 계속 '처리 중'으로 두지 않고
    // 결과 불명으로 돌려 확인 카드를 띄운다(엔진이 실제로 돌았는지는 모름 — 자동으로 다시 보내지 않음). 서버 다시 시작과 같은 처리.
    // 2026-11-20 실측: 연결부 경로는 끝날 때까지 dispatching(보내는 중)으로만 보였다 — 연결부가 엔진 실행을 시작하면 running(처리 중)으로
    markRunning(hostId, requestId) {
      const row = request(String(requestId ?? '')); const b = row && binding(row.conversation_id);
      if (!b || b.hostId !== hostId) return false;
      if (row.status !== STATUS.dispatching) return row.status === STATUS.running;
      setStatus(row, STATUS.running); return true;
    },
    deviceRestarted(hostId) {
      const rows = db.prepare("SELECT request_id, conversation_id FROM requests WHERE status IN ('dispatching', 'running') AND json_extract(snap, '$.hostId') = ?").all(hostId);
      for (const r of rows) db.prepare("UPDATE requests SET status = 'unknown', error_code = COALESCE(error_code, 'connector_restarted') WHERE request_id = ?").run(r.request_id);
      return rows.map((r) => r.conversation_id);
    },

    close() { if (db.isOpen) db.close(); },
  };
}