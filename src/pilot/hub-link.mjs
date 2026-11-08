// W3: 짝맺기(PC 쪽). PC 로컬 웹의 "허브에 연결"이 이것을 부른다. 사용자는 허브 주소만 넣고, 화면의 6자리 코드를
// 허브 웹에서 승인한다. 승인되면 기기 토큰을 .local/hub에 저장하고(권한 600, 출력 없음) 허브용 연결부를 이 서버가 직접 띄운다.
// 연결부의 안전 설정(허용 목록·실제 실행·작업 폴더)은 그대로 이 PC의 connector.json이다(원칙 6).
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateServerUrl } from './connector.mjs';
import { childEnv } from './parent-watch.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function createHubLink({ dir, connectorConfigPath, fetchImpl = fetch, spawnImpl = spawn, pollMs = 3000, log = () => {} }) {
  const tokenFile = join(dir, 'device-token');
  const infoFile = join(dir, 'hub.json');
  let pending = null; // { hubUrl, pairId, code, expiresAt, error }
  let child = null; let wantRunning = false; let timer = null;
  const info = () => { try { return JSON.parse(readFileSync(infoFile, 'utf8')); } catch { return null; } };

  function startConnector() {
    const i = info();
    if (!i || !existsSync(tokenFile)) return 'not_paired';
    if (!connectorConfigPath || !existsSync(connectorConfigPath)) return 'no_connector_config';
    if (child) return 'running';
    wantRunning = true;
    mkdirSync(dir, { recursive: true });
    const out = openSync(join(dir, 'connector.log'), 'a');
    const c = spawnImpl(process.execPath, ['src/pilot/connector.mjs', connectorConfigPath, '--server', i.hubUrl, '--token-file', tokenFile],
      { cwd: ROOT, env: childEnv(), stdio: ['ignore', out, out] });
    child = c;
    log({ event: 'hub_connector_start', hub: i.hubUrl });
    // 끝난 것이 지금 연결부일 때만 처리한다. 다시 띄운 뒤 늦게 온 이전 연결부의 종료 알림이 새 연결부를 놓치게 하면
    // 추적되지 않는 연결부가 쌓인다(2026-11-08 기본 시험에서 발견).
    c.on('exit', (code) => {
      if (child !== c) return;
      child = null;
      log({ event: 'hub_connector_exit', code });
      if (wantRunning) setTimeout(() => { if (wantRunning && !child) startConnector(); }, 5000).unref?.();
    });
    return 'running';
  }
  function stopConnector() { wantRunning = false; if (child) { child.kill('SIGTERM'); child = null; } }

  async function pollOnce() {
    if (!pending) return;
    if (Date.parse(pending.expiresAt) < Date.now()) { pending = { ...pending, error: 'expired' }; return; }
    let r;
    try {
      r = await fetchImpl(`${pending.hubUrl}/v1/pair/poll`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pairId: pending.pairId }), signal: AbortSignal.timeout(10000) });
    } catch { return; } // 잠깐 끊긴 것은 다음 주기에 다시 묻는다
    const body = await r.json().catch(() => ({}));
    if (body.status === 'approved' && body.token && body.hostId) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(tokenFile, body.token, { mode: 0o600 });
      if (process.platform !== 'win32') chmodSync(tokenFile, 0o600);
      writeFileSync(infoFile, JSON.stringify({ hubUrl: pending.hubUrl, hostId: body.hostId, pairedAt: new Date().toISOString() }, null, 2) + '\n');
      log({ event: 'hub_paired', hub: pending.hubUrl, hostId: body.hostId });
      pending = null;
      startConnector();
    } else if (['rejected', 'expired'].includes(body.status)) {
      pending = { ...pending, error: body.status };
    }
  }

  return {
    status() {
      const i = info();
      return { state: pending && !pending.error ? 'pairing' : i ? 'paired' : 'none', hubUrl: pending?.hubUrl ?? i?.hubUrl ?? null,
        hostId: i?.hostId ?? null, code: pending && !pending.error ? pending.code : null, error: pending?.error ?? null,
        connector: child ? 'running' : 'stopped', canRun: Boolean(connectorConfigPath && existsSync(connectorConfigPath)) };
    },
    hubMode: () => Boolean(child),
    async connect({ hubUrl, name }) {
      const url = validateServerUrl(hubUrl);
      const n = String(name ?? '').trim();
      if (!n || n.length > 40) throw Object.assign(new Error('bad_name'), { http: 400 });
      let r;
      try {
        r = await fetchImpl(`${url}/v1/pair/start`, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: n }), signal: AbortSignal.timeout(10000) });
      } catch { throw Object.assign(new Error('hub_unreachable'), { http: 502 }); }
      const body = await r.json().catch(() => ({}));
      if (r.status !== 201) throw Object.assign(new Error(body.error ?? `hub_${r.status}`), { http: 502 });
      pending = { hubUrl: url, pairId: body.pairId, code: body.code, expiresAt: body.expiresAt, error: null };
      clearInterval(timer);
      timer = setInterval(() => { pollOnce().catch(() => {}); if (!pending) clearInterval(timer); }, pollMs);
      timer.unref?.();
      return { code: body.code, expiresAt: body.expiresAt };
    },
    pollOnce,
    reconnect: () => startConnector(),
    disconnect({ forget = false } = {}) {
      stopConnector(); pending = null; clearInterval(timer);
      if (forget) { rmSync(tokenFile, { force: true }); rmSync(infoFile, { force: true }); }
      return { forgotten: forget };
    },
    // 서버를 켤 때: 이미 짝맺은 허브가 있으면 다시 연결한다(재부팅 뒤에도 사용자가 할 일 없음).
    resume() { return info() ? startConnector() : 'not_paired'; },
    close() { stopConnector(); clearInterval(timer); },
    paths: { tokenFile, infoFile, dir: dirname(tokenFile) },
  };
}
