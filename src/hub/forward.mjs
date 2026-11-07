// P4: 허브 전달기(컨테이너 이름 ieun-relay). NPM(proxy-network)에서 받은 HTTP를 같은 기계의 허브 Unix 소켓으로 넘긴다.
// 허브 서버는 127.0.0.1·Unix 소켓만 열고, 방화벽·호스트 포트는 바꾸지 않는다. 내용을 보거나 저장하지 않는다.
// 사용: IEUN_HUB_SOCKET=/run/hub/ieun-hub.sock IEUN_FORWARD_PORT=28770 node src/hub/forward.mjs
import { createServer, request } from 'node:http';
import { fileURLToPath } from 'node:url';

const HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'];

export function createForwarder({ socketPath, timeoutMs = 130000 }) {
  return createServer((req, res) => {
    const headers = { ...req.headers };
    for (const h of HOP) delete headers[h];
    // 바로 앞 상대(NPM)의 주소를 X-Forwarded-For 끝에 붙인다. 허브는 trustedProxies로 이 체인을 해석한다.
    const peer = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    headers['x-forwarded-for'] = headers['x-forwarded-for'] ? `${headers['x-forwarded-for']}, ${peer}` : peer;
    const up = request({ socketPath, method: req.method, path: req.url, headers, timeout: timeoutMs }, (r) => {
      const out = { ...r.headers };
      for (const h of HOP) delete out[h];
      res.writeHead(r.statusCode, out);
      r.pipe(res);
    });
    up.on('timeout', () => up.destroy(new Error('timeout')));
    up.on('error', () => {
      if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"error":"hub_unavailable"}'); } else res.destroy();
    });
    req.pipe(up);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const socketPath = process.env.IEUN_HUB_SOCKET ?? '/run/hub/ieun-hub.sock';
  const port = Number(process.env.IEUN_FORWARD_PORT ?? 28770);
  createForwarder({ socketPath }).listen(port, process.env.IEUN_FORWARD_HOST ?? '0.0.0.0', () => {
    process.stderr.write(JSON.stringify({ ch: 'hub-forward', event: 'listen', port }) + '\n');
  });
}
