// U3: 이 PC의 최근 Codex 대화 목록(쉬운 화면의 "대화 연결"). 공식 Codex app-server의 thread/list만 쓴다.
// 안전(AGENTS UD2 예외): 업무 대화는 Codex에 excludedThreadIds로 빼 달라고 요청하고, 받은 목록에서 한 번 더 뺀다.
// 이 목록은 화면 응답에만 쓰고 로그에 남기지 않는다. 대화 본문은 읽지 않는다(Codex가 주는 제목·첫 줄 미리보기만).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXCLUDED_THREAD } from './lock-probe.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODEX_JS = fileURLToPath(new URL('../../node_modules/@openai/codex/bin/codex.js', import.meta.url));

// 실행 방법: 지정한 명령이 있으면 그것, 없으면 이어온에 들어 있는 Codex(npm 패키지)를 node로 실행한다.
export function codexCommand(override) {
  if (override?.command) return { command: override.command, args: override.args ?? [] };
  if (existsSync(CODEX_JS)) return { command: process.execPath, args: [CODEX_JS] };
  return { command: 'codex', args: [] };
}

const shortText = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// 목록 한 줄. 제목이 없으면 첫 질문 미리보기를 짧게 쓴다.
export function toListItem(t) {
  const at = Number(t.recencyAt ?? t.updatedAt ?? t.createdAt);
  return { threadId: String(t.id).toLowerCase(), title: shortText(t.name || t.preview || '(제목 없음)', 60),
    workingDirectory: typeof t.cwd === 'string' && t.cwd ? t.cwd.replaceAll('\\', '/') : null,
    updatedAt: Number.isFinite(at) && at > 0 ? new Date(at * 1000).toISOString() : null };
}

export function safeThreads(data) {
  return (Array.isArray(data) ? data : [])
    .filter((t) => t && typeof t.id === 'string' && UUID.test(t.id) && t.id.toLowerCase() !== EXCLUDED_THREAD && !t.ephemeral)
    .map(toListItem);
}

// app-server를 잠깐 띄워(표준 입출력, 포트 없음) 목록만 받고 끈다.
// useStateDbOnly: 모든 기록 파일을 훑지 않고 Codex 상태 DB에서 바로 답한다(기본값은 파일을 다 훑어 대화가 많으면 20초를 넘김, 2026-11-12 이 PC).
// 시간 제한은 Codex 시작(약 5초)을 넉넉히 덮도록 45초.
export function listCodexThreads({ codex, limit = 30, timeoutMs = 45000, spawnImpl = spawn } = {}) {
  const { command, args } = codexCommand(codex);
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnImpl(command, [...args, 'app-server'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }); } catch (e) { reject(Object.assign(new Error('codex_unavailable'), { cause: e })); return; }
    let buf = ''; let done = false;
    const finish = (err, value) => {
      if (done) return; done = true; clearTimeout(timer);
      try { child.stdin.end(); child.kill(); } catch { /* 이미 끝남 */ }
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('codex_timeout')), timeoutMs);
    const send = (msg) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
    child.on('error', (e) => finish(Object.assign(new Error('codex_unavailable'), { cause: e })));
    child.on('exit', () => finish(new Error('codex_exited')));
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          if (msg.error) return finish(new Error('codex_init_failed'));
          send({ method: 'initialized' });
          send({ id: 2, method: 'thread/list', params: { limit, archived: false, excludedThreadIds: [EXCLUDED_THREAD], sortKey: 'recency_at', sortDirection: 'desc', useStateDbOnly: true } });
        } else if (msg.id === 2) {
          if (msg.error) return finish(new Error('codex_list_failed'));
          return finish(null, safeThreads(msg.result?.data));
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'ieon', title: '이어온', version: '0.0.1' } } });
  });
}