// A2-d(신산님 2026-11-12 "AI 응답·허용 목록까지"): 기기 관리 명령 한 벌. PC형 화면(이 PC 로컬 웹)과 허브형 화면(허브가 그 PC에
// 명령을 맡기면 PC가 가져가 실행)이 **같은 코드**로 같은 기능을 쓴다 — 실제 실행(AI 응답)·Codex 허용 목록·이어온 전용 계정.
// 허브 자신(허브 새 세션)의 계정도 같은 명령으로 다룬다. 업무 대화 제외·로그인 파일 미열람 같은 안전 규칙은 아래 함수들이 그대로 지킨다.
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { readDevice, setLive, upsertCodexThread, removeCodexThread, addCodexAccount, removeCodexAccount, useCodexAccount } from './device-settings.mjs';
import { accountsDirFor, codexHomeOf, createCodexHome, removeCodexHome, hasLogin, desktopCodexHome } from './accounts.mjs';
import { createCodexLogin } from './codex-login.mjs';

// 명령 목록(이 밖의 것은 거절). read: 보기만(앞단을 거친 PC 화면 요청도 허용), 나머지는 바꾸기.
export const OPS = {
  'device.get': 'read', 'device.live': 'write', 'device.codex.put': 'write', 'device.codex.delete': 'write',
  'accounts.get': 'read', 'accounts.add': 'write', 'accounts.use': 'write', 'accounts.login': 'write',
  'accounts.login.cancel': 'write', 'accounts.logout': 'write', 'accounts.delete': 'write',
};
// 허브 자신에게 허용하는 명령: 계정만(허브 실제 실행은 허브 보안·Codex 탭, 허브는 기존 대화 허용 목록이 없음).
export const HUB_SELF_OPS = new Set(['accounts.get', 'accounts.add', 'accounts.use', 'accounts.login', 'accounts.login.cancel', 'accounts.logout', 'accounts.delete']);

export function createDeviceAdmin({ connectorConfigPath, applyDevice = async () => ({ restarted: false, restartRequired: true }), accountLogin, connectorState = () => ({}), log = () => {} }) {
  const logins = new Map(); // 계정별 공식 로그인 진행 상태
  const cfg = () => {
    if (!connectorConfigPath || !existsSync(connectorConfigPath)) throw Object.assign(new Error('no_connector_config'), { http: 404 });
    return connectorConfigPath;
  };
  const dirOf = (p) => accountsDirFor(p, JSON.parse(readFileSync(p, 'utf8')));
  const envOf = (p, id) => ({ ...process.env, CODEX_HOME: codexHomeOf(dirOf(p), id), CODEX_SQLITE_HOME: desktopCodexHome() });
  const loginOf = (p, id) => {
    if (!logins.has(id)) logins.set(id, (accountLogin ?? ((env) => createCodexLogin({ env })))(envOf(p, id)));
    return logins.get(id);
  };
  const device = (p) => ({ ...readDevice(p), ...connectorState() });
  const accounts = (p) => {
    const d = readDevice(p); const dir = dirOf(p);
    return { accounts: d.codexAccounts.map((a) => ({ ...a, engine: 'codex', loggedIn: hasLogin(codexHomeOf(dir, a.id)), login: logins.get(a.id)?.view() ?? { state: 'idle' } })),
      defaultAccount: d.codexDefaultAccount, accountFor: d.codexAccountFor, threads: d.codexThreads.map((t) => ({ threadId: t.threadId, mode: t.mode })) };
  };
  const known = (p, id) => {
    if (!/^[a-z0-9]{2,16}$/.test(String(id)) || !readDevice(p).codexAccounts.some((a) => a.id === id)) throw Object.assign(new Error('not_found'), { http: 404 });
    return id;
  };

  async function perform(op, a) {
    const p = cfg();
    switch (op) {
      case 'device.get': return { status: 200, body: device(p) };
      case 'device.live':
        setLive(p, a.live);
        log({ event: 'device_live', live: a.live });
        return { status: 200, body: { live: a.live, ...(await applyDevice()) } };
      case 'device.codex.put':
        upsertCodexThread(p, { threadId: a.threadId, mode: a.mode, workingDirectory: a.workingDirectory ?? null });
        return { status: 200, body: { ...device(p), ...(await applyDevice()) } };
      case 'device.codex.delete':
        if (!removeCodexThread(p, a.threadId)) return { status: 404, body: { error: 'not_found' } };
        return { status: 200, body: { ...device(p), ...(await applyDevice()) } };
      case 'accounts.get': return { status: 200, body: accounts(p) };
      case 'accounts.add': {
        const id = 'a' + randomBytes(4).toString('hex');
        addCodexAccount(p, { id, label: a.label });
        try { createCodexHome(dirOf(p), id); } catch (e) { removeCodexAccount(p, id); throw e; }
        log({ event: 'account_added', engine: 'codex' });
        return { status: 201, body: { id, ...accounts(p) } };
      }
      case 'accounts.use':
        useCodexAccount(p, { threadId: a.threadId ?? null, accountId: String(a.accountId ?? '') });
        return { status: 200, body: { ...accounts(p), ...(await applyDevice()) } };
      case 'accounts.login': loginOf(p, known(p, a.id)).start(); return { status: 200, body: accounts(p) };
      case 'accounts.login.cancel': loginOf(p, known(p, a.id)).cancel(); return { status: 200, body: accounts(p) };
      case 'accounts.logout': await loginOf(p, known(p, a.id)).logout(); return { status: 200, body: accounts(p) };
      case 'accounts.delete': {
        const id = known(p, a.id);
        if (hasLogin(codexHomeOf(dirOf(p), id))) await loginOf(p, id).logout();
        loginOf(p, id).cancel(); logins.delete(id);
        // 폴더를 먼저 지우고 성공하면 설정에서 뺀다(실패하면 목록에 남아 다시 지울 수 있게).
        removeCodexHome(dirOf(p), id);
        removeCodexAccount(p, id);
        log({ event: 'account_removed', engine: 'codex' });
        return { status: 200, body: { ...accounts(p), ...(await applyDevice()) } };
      }
      default: return { status: 400, body: { error: 'bad_op' } };
    }
  }

  return {
    // { status, body }. 오류는 그 코드로(설정 검사 오류는 400, 없는 것은 404).
    async run(op, args = {}) {
      if (!Object.hasOwn(OPS, op)) return { status: 400, body: { error: 'bad_op' } };
      const a = args && typeof args === 'object' ? args : {};
      try { return await perform(op, a); } catch (e) { return { status: e.http ?? 500, body: { error: e.http ? e.message : 'internal' } }; }
    },
  };
}
