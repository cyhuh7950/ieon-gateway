// 접수·중복·세션 잠금·상태·receipt를 SQLite 단일 writer로 원자 저장한다.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { STATUS, RELEASING, EngineError } from './contracts.mjs';
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
`;

const hash = (payload) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');

export const CONNECT_MODES = Object.freeze(['alternate', 'shared_server']);
const NEEDS_REVIEW = new Set([STATUS.unknown, STATUS.approvalRequired]);

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  // X2.4: Codex 세션별 연결 모드. 기존 DB에는 열을 추가한다. 기본값은 실증된 alternate다.
  if (!db.prepare('PRAGMA table_info(bindings)').all().some((c) => c.name === 'connect_mode')) {
    db.exec("ALTER TABLE bindings ADD COLUMN connect_mode TEXT NOT NULL DEFAULT 'alternate'");
  }
  // 엔진이 알려 준 사용량(토큰 수만). 없으면 NULL이다.
  // 여러 봇 M3: 역할 봇에서 만든 새 세션의 AI 역할 안내(첫 질문 앞에 붙임)
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
  };

  function setStatus(row, status, fields = {}) {
    const f = { receipt: row.receipt, answer: row.answer, error_code: row.error_code, error_http: row.error_http, ...fields };
    tx(() => {
      db.prepare('UPDATE requests SET status = ?, receipt = ?, answer = ?, error_code = ?, error_http = ? WHERE request_id = ?')
        .run(status, f.receipt, f.answer, f.error_code, f.error_http, row.request_id);
      if (RELEASING.has(status)) db.prepare('DELETE FROM locks WHERE holder_request_id = ?').run(row.request_id);
    });
  }

  // 답변은 접수 당시 generation이 현재와 같을 때만 저장한다(삭제 후 재생성 방지).
  function keepAnswer(row, answer) {
    return binding(row.conversation_id).generation === row.generation ? answer : null;
  }

  // 재시작 시 전송 가능성이 있는 요청은 완료를 증명할 수 없으므로 unknown으로 격리한다.
  db.prepare("UPDATE requests SET status = 'unknown' WHERE status IN ('dispatching', 'running')").run();

  return {
    // server.json의 기존 세션 등록(출처 file). 서버를 켤 때마다 다시 쓴다(파일이 정본).
    addBinding(b) {
      db.prepare(`INSERT INTO bindings (conversation_id, owner_user_id, app_ids, host_id, engine, session_ref, label, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'file') ON CONFLICT (conversation_id) DO UPDATE SET app_ids = excluded.app_ids,
        label = excluded.label, source = 'file'`)
        .run(b.conversationId, b.ownerUserId, JSON.stringify(b.appIds), b.hostId, b.engine, b.sessionRef, b.label ?? null);
    },

    // --- P1-b: 웹에서 등록하는 기존 세션(출처 web). 파일 등록·새 세션은 여기서 바꾸지 않는다. ---
    listBindings() {
      return db.prepare('SELECT b.conversation_id FROM bindings b LEFT JOIN new_sessions n ON n.conversation_id = b.conversation_id WHERE n.conversation_id IS NULL ORDER BY b.rowid').all()
        .map((r) => binding(r.conversation_id))
        .map((b) => ({ conversationId: b.conversationId, label: b.label, engine: b.engine, hostId: b.hostId, sessionRef: b.sessionRef,
          appIds: b.storedAppIds, source: b.source, busy: locked(b) }));
    },
    saveBinding(ownerUserId, b) {
      const cur = binding(b.conversationId);
      if (cur && newSession(b.conversationId)) return { http: 409, code: 'is_new_session' };
      if (cur && cur.source !== 'web') return { http: 409, code: 'file_managed' };
      return tx(() => {
        if (cur && locked(cur) && (cur.sessionRef !== b.sessionRef || cur.engine !== b.engine || cur.hostId !== b.hostId)) {
          return { http: 409, code: 'conversation_busy' };
        }
        db.prepare(`INSERT INTO bindings (conversation_id, owner_user_id, app_ids, host_id, engine, session_ref, label, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'web') ON CONFLICT (conversation_id) DO UPDATE SET app_ids = excluded.app_ids,
          host_id = excluded.host_id, engine = excluded.engine, session_ref = excluded.session_ref, label = excluded.label`)
          .run(b.conversationId, ownerUserId, JSON.stringify(b.appIds), b.hostId, b.engine, b.sessionRef, b.label);
        return { http: 200, binding: this.listBindings().find((x) => x.conversationId === b.conversationId) };
      });
    },
    deleteBinding(conversationId) {
      const cur = binding(conversationId);
      if (!cur || newSession(conversationId)) return { http: 404, code: 'not_found' };
      if (cur.source !== 'web') return { http: 409, code: 'file_managed' };
      return tx(() => {
        if (locked(cur)) return { http: 409, code: 'conversation_busy' };
        db.prepare('DELETE FROM requests WHERE conversation_id = ?').run(conversationId);
        db.prepare('DELETE FROM bot_sessions WHERE conversation_id = ?').run(conversationId);
        db.prepare('DELETE FROM bindings WHERE conversation_id = ?').run(conversationId);
        return { http: 204 };
      });
    },

    submit(principal, conversationId, key, payload) {
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
        db.prepare(`INSERT INTO requests (request_id, conversation_id, user_id, app_id, idem_key,
          payload_hash, question, status, generation) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`)
          .run(requestId, conversationId, principal.userId, principal.appId, key, payloadHash,
            String(payload.question ?? ''), b.generation);
        db.prepare('INSERT INTO locks (session_key, holder_request_id) VALUES (?, ?)').run(lockKey, requestId);
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
        const row = db.prepare(`SELECT r.request_id, r.question, b.engine, b.session_ref, b.connect_mode FROM requests r
          JOIN bindings b ON b.conversation_id = r.conversation_id
          WHERE b.host_id = ? AND r.status = 'queued' ORDER BY r.rowid LIMIT 1`).get(hostId);
        if (!row) return null;
        db.prepare("UPDATE requests SET status = 'dispatching' WHERE request_id = ?").run(row.request_id);
        const ns = db.prepare(`SELECT n.name, n.profile, n.workspace, n.state, n.role_guide FROM new_sessions n JOIN requests r
          ON r.conversation_id = n.conversation_id WHERE r.request_id = ?`).get(row.request_id);
        // 역할 봇에서 만든 새 세션의 첫 질문(엔진 세션을 만드는 질문)에만 AI 역할 안내를 붙인다. 저장된 질문은 그대로다.
        const question = ns?.state === 'pending' && ns.role_guide ? `[역할 안내]\n${ns.role_guide}\n\n[질문]\n${row.question}` : row.question;
        return { requestId: row.request_id, engine: row.engine, sessionRef: row.session_ref, question,
          ...(row.engine === 'codex_thread' ? { connectMode: row.connect_mode } : {}),
          ...(ns ? { newSession: { name: ns.name, profile: ns.profile, workspace: ns.workspace } } : {}) };
      });
    },

    // 연결부가 보고한 결과를 반영한다. dispatching/running 요청만 받는다.
    report(hostId, requestId, outcome, { now } = {}) {
      const row = request(requestId);
      const b = row && binding(row.conversation_id);
      if (!b || b.hostId !== hostId || ![STATUS.dispatching, STATUS.running].includes(row.status)) return null;
      adoptSessionRef(b, outcome.sessionRef, now);
      if (outcome.status === STATUS.completed) {
        setStatus(row, STATUS.completed, { receipt: outcome.receipt ?? null, answer: keepAnswer(row, outcome.answer ?? null) });
        if (outcome.usage) db.prepare('UPDATE requests SET usage = ? WHERE request_id = ?').run(JSON.stringify(outcome.usage), requestId);
      } else if (outcome.status === STATUS.failed) {
        setStatus(row, STATUS.failed, { error_code: outcome.errorCode ?? 'failed', error_http: outcome.http ?? null });
      } else if (outcome.status === STATUS.approvalRequired) {
        setStatus(row, STATUS.approvalRequired);
      } else {
        setStatus(row, STATUS.unknown, { error_code: outcome.errorCode ?? null });
      }
      return view(request(requestId));
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
      const conversationId = `n_${name}`;
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
          VALUES (?, ?, '기본 봇', NULL, '[]', '[]', 1)`).run(p, DEFAULT_BOT);
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
    deleteSetting(key) { return db.prepare('DELETE FROM settings WHERE key = ?').run(key).changes === 1; },

    // --- P1-c: 웹에서 등록한 기기(PC 연결부). 토큰은 해시만 저장한다. server.json 기기는 여기 없다. ---
    listDevices() {
      return db.prepare('SELECT host_id, name, created_at, revoked_at, last_seen_at FROM devices ORDER BY created_at').all()
        .map((d) => ({ hostId: d.host_id, name: d.name, createdAt: d.created_at, revokedAt: d.revoked_at, lastSeenAt: d.last_seen_at }));
    },
    deviceEvents(limit = 50) {
      return db.prepare('SELECT at, host_id, action, user_id FROM device_events ORDER BY rowid DESC LIMIT ?').all(limit)
        .map((e) => ({ at: e.at, hostId: e.host_id, action: e.action, userId: e.user_id }));
    },
    // 인증용: 폐기되지 않은 기기의 토큰 해시
    activeDeviceHashes() {
      return db.prepare('SELECT host_id, token_sha256 FROM devices WHERE revoked_at IS NULL').all().map((d) => ({ hostId: d.host_id, tokenSha256: d.token_sha256 }));
    },
    addDevice(hostId, name, tokenSha256, userId) {
      if (db.prepare('SELECT 1 FROM devices WHERE host_id = ?').get(hostId)) return { http: 409, code: 'host_taken' };
      const now = new Date().toISOString();
      tx(() => {
        db.prepare('INSERT INTO devices (host_id, name, token_sha256, created_at) VALUES (?, ?, ?, ?)').run(hostId, name, tokenSha256, now);
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

    close() { if (db.isOpen) db.close(); },
  };
}