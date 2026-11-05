import { readFile, writeFile } from 'node:fs/promises';
import { createProxyTransport, probeReadOnly } from './app-server-transport.mjs';

// 위치 인수: 기존 binary, 기존 로컬 socket, 승인 thread, 버전 일치 schema, receipt 출력.
// 실행 대상과 출력은 명시 인수만 사용한다. daemon 기동·인증 조작은 없다.
const [executable, socket, threadId, notificationSchemaPath, output] = process.argv.slice(2);
if (!executable || !socket || !output || !/^[0-9a-f-]{36}$/.test(threadId ?? '')) throw new Error('S0_ARGUMENTS_REQUIRED');
const schema = JSON.parse(await readFile(notificationSchemaPath, 'utf8'));
const notificationMethods = schema.oneOf.flatMap(item => item.properties?.method?.enum ?? []);
if (!notificationMethods.includes('thread/status/changed')) throw new Error('S0_SCHEMA_MISMATCH');
const startedAt = new Date().toISOString();
const receipt = await probeReadOnly(createProxyTransport({ executable, socket }), { threadId, notificationMethods });
const outputReceipt = { startedAt, finishedAt: new Date().toISOString(), ...receipt,
  mutationRpcRequests: 0, bodyRpcRequests: 0, modelTurnStarts: 0, retries: 0 };
await writeFile(output, JSON.stringify(outputReceipt, null, 2) + '\n');
process.stdout.write(JSON.stringify(outputReceipt) + '\n');