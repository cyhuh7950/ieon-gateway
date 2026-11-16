// SV1: 엔진 칸을 허브에 붙일 1회용 초대(PC 연결 링크와 같은 것, 10분)를 허브 컨테이너 안에서 받는다.
// 사용(허브 컨테이너 안, ieun.sh engine add가 부름): node src/hub/invite.mjs [/data] > <엔진 칸 데이터>/invite
// 허브 웹 사용자 토큰 파일(/data/s2/user-token)로 이 컨테이너 안의 서버(127.0.0.1)에만 묻는다. 토큰은 출력하지 않고, 초대 값만 표준 출력으로 넘긴다.
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

const data = process.argv[2] ?? '/data';
const server = JSON.parse(readFileSync(posix.join(data, 's2/server.json'), 'utf8'));
const token = readFileSync(posix.join(data, 's2/user-token'), 'utf8').trim();
const r = await fetch(`http://127.0.0.1:${server.port ?? 28760}/v1/admin/pairings/invite`, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
const body = await r.json().catch(() => ({}));
if (r.status !== 201 || !body.invite) { process.stderr.write(`invite_failed:${r.status}:${body.error ?? ''}\n`); process.exit(1); }
process.stdout.write(body.invite);
