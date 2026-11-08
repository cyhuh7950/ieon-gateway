// W0: 허브 컨테이너(ieun-relay) 안에서 서버·허브 연결부·메신저를 함께 돌린다. 하나가 끝나면 그것만 다시 켠다.
// 사용: node src/hub/run.mjs <데이터 폴더(/data)>
// 세 프로세스는 컨테이너 안 127.0.0.1로 서로 부른다. 공개는 서버의 publicListen 포트 하나뿐이다.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from '../pilot/parent-watch.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function hubCommands(data) {
  return [
    { name: 'server', args: ['src/pilot/server.mjs', posix.join(data, 's2/server.json')], delayMs: 0 },
    { name: 'connector', args: ['src/pilot/connector.mjs', posix.join(data, 's2/connector.json')], delayMs: 2000, env: { IEON_EXIT_ON_CONFIG_CHANGE: '1' } },
    { name: 'messenger', args: ['src/pilot/messenger/main.mjs', posix.join(data, 'messenger/config.json')], delayMs: 3000, optional: true },
  ];
}

export function supervise(cmds, { spawnImpl = spawn, log = (e) => process.stderr.write(JSON.stringify({ ch: 'hub', ...e }) + '\n'), maxBackoffMs = 60000 } = {}) {
  const children = new Map();
  let stopping = false;
  const start = (c, backoff = 5000) => {
    if (stopping) return;
    const p = spawnImpl(process.execPath, c.args, { cwd: ROOT, env: { ...childEnv(), ...(c.env ?? {}) }, stdio: ['ignore', 'inherit', 'inherit'] });
    const at = Date.now();
    children.set(c.name, p);
    log({ event: 'start', name: c.name });
    p.on('exit', (code) => {
      children.delete(c.name);
      if (stopping) return;
      // 오래 돌다 끝났으면 대기 시간을 처음으로 돌린다. 곧바로 끝나기를 반복하면 점점 늘린다.
      const next = Date.now() - at > 60000 ? 5000 : Math.min(maxBackoffMs, backoff * 2);
      log({ event: 'exit', name: c.name, code, restartInMs: next });
      setTimeout(() => start(c, next), next).unref?.();
    });
  };
  for (const c of cmds) setTimeout(() => start(c), c.delayMs);
  return {
    children,
    stop() { stopping = true; for (const p of children.values()) p.kill('SIGTERM'); },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = process.argv[2] ?? '/data';
  const cmds = hubCommands(data).filter((c) => !c.optional || existsSync(c.args[1]));
  const s = supervise(cmds);
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { s.stop(); setTimeout(() => process.exit(0), 3000); });
  setInterval(() => {}, 1 << 30); // 감독 프로세스는 계속 떠 있는다
}
