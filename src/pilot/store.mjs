// 접수·중복·세션 잠금·상태·receipt를 SQLite 단일 writer로 원자 저장한다.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { STATUS, RELEASING, EngineError } from './contracts.mjs';
import { canAccess, sessionKey } from './guard.mjs';
import { NEW_ENGINES, SESSION_STATES, resolveProfile, validateName, workspacePath } from './new-sessions.mjs';

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
    return row && {
      conversationId: row.conversation_id, ownerUserId: row.owner_user_id,
      appIds: JSON.parse(row.app_ids), hostId: row.host_id, engine: row.engine,
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
    addBinding(b) {
      db.prepare(`INSERT INTO bindings (conversation_id, owner_user_id, app_ids, host_id, engine, session_ref)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (conversation_id) DO UPDATE SET app_ids = excluded.app_ids`)
        .run(b.conversationId, b.ownerUserId, JSON.stringify(b.appIds), b.hostId, b.engine, b.sessionRef);
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
        const ns = db.prepare(`SELECT n.name, n.profile, n.workspace FROM new_sessions n JOIN requests r
          ON r.conversation_id = n.conversation_id WHERE r.request_id = ?`).get(row.request_id);
        return { requestId: row.request_id, engine: row.engine, sessionRef: row.session_ref, question: row.question,
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
          return { conversationId: b.conversationId, engine: b.engine, hostId: b.hostId, busy: Boolean(holder),
            // 결과 불명·권한 확인 대기는 사람이 원래 세션을 보고 정리해야 풀린다.
            ...(held && NEEDS_REVIEW.has(held.status)
              ? { heldBy: { requestId: held.request_id, status: held.status, errorCode: held.error_code } } : {}),
            ...(b.engine === 'codex_thread' ? { connectMode: b.connectMode } : {}),
            ...newSessionView(b.conversationId) };
        });
    },

    // 새 세션 등록(N0). 엔진 쪽 세션은 아직 만들지 않으므로 sessionRef는 pending 표식이고 상태는 pending이다.
    // 기존 세션 연결(사람이 등록한 binding)은 한도에 세지 않고, 보관된 새 세션도 세지 않는다.
    createSession(principal, { engine, name, profile, hostId, via }, config) {
      if (!config.enabled) return { http: 403, code: 'new_sessions_disabled' };
      if (!principal || !config.creatorApps.includes(principal.appId)) return { http: 403, code: 'app_not_allowed' };
      if (!validateName(name)) return { http: 400, code: 'bad_name' };
      if (!Object.hasOwn(NEW_ENGINES, engine)) return { http: 400, code: 'bad_engine' };
      const p = resolveProfile(config, profile);
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
          VALUES (?, ?, ?, ?, ?, ?)`).run(conversationId, principal.userId, JSON.stringify(config.creatorApps), hostId,
          NEW_ENGINES[engine], `pending:${randomUUID()}`);
        db.prepare(`INSERT INTO new_sessions (conversation_id, host_id, name, engine, profile, state, workspace, created_via,
          created_at, last_used_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
          .run(conversationId, hostId, name, engine, p.profile, workspace, String(via ?? 'unknown'), now, now);
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

    close() { if (db.isOpen) db.close(); },
  };
}
