// 중계 실행. 설정은 환경 변수로만 받는다(비밀 값은 파일·로그에 남기지 않는다).
//   IEON_RELAY_PORT(필수, 기본값 없음) · IEON_RELAY_HOST(기본 127.0.0.1)
//   IEON_RELAY_PC_TOKEN(16자 이상) · IEON_RELAY_KAKAO_SECRET(16자 이상) · IEON_RELAY_TRUST_PROXY=1(reverse proxy 뒤일 때)
import { createRelay } from './relay.mjs';
import { t } from '../i18n/index.mjs';

const env = process.env;
const port = Number(env.IEON_RELAY_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535) { process.stderr.write(t('server.relay.bad_port') + '\n'); process.exit(2); }
const relay = createRelay({
  pcToken: env.IEON_RELAY_PC_TOKEN, kakaoSecret: env.IEON_RELAY_KAKAO_SECRET, trustProxy: env.IEON_RELAY_TRUST_PROXY === '1',
  log: (e) => process.stderr.write(JSON.stringify(e) + '\n'),
});
const addr = await relay.listen(port, env.IEON_RELAY_HOST ?? '127.0.0.1');
process.stderr.write(JSON.stringify({ ch: 'relay', event: 'listening', port: addr.port }) + '\n');
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => relay.close().then(() => process.exit(0)));
