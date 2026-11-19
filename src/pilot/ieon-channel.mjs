// C1: 이어온 전용 Claude Code 채널(MCP stdio 서버, 외부 의존성 없음).
// Claude Code가 `--dangerously-load-development-channels server:ieon`으로 이 프로세스를 띄운다.
// 이어온 연결부는 loopback HTTP(Bearer 토큰)로 질문을 넣고 reply를 받아 간다.
// 질문·답변 원문은 파일·로그에 남기지 않는다(메모리에만 보관).
import { t as i18nT } from '../i18n/index.mjs';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.IEON_CHANNEL_PORT ?? 28762);
const TOKEN_PATH = process.env.IEON_CHANNEL_TOKEN_FILE;
const MAX_TEXT = 8000;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

if (!TOKEN_PATH) throw new Error('IEON_CHANNEL_TOKEN_FILE required');
const token = Buffer.from(readFileSync(TOKEN_PATH, 'utf8').trim());

const delivered = new Map(); // request_id -> { replies: [], at }
const log = (event, extra = {}) => process.stderr.write(JSON.stringify({ ch: 'ieon', event, ...extra }) + '\n');

// --- MCP stdio (줄 단위 JSON-RPC) ---
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
const INSTRUCTIONS = i18nT('server.channel.instructions');
const TOOLS = [{
  name: 'reply',
  description: i18nT('server.channel.reply_desc'),
  inputSchema: {
    type: 'object',
    properties: { reply_to: { type: 'string' }, text: { type: 'string' } },
    required: ['reply_to', 'text'],
  },
}];

function handleRpc(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return send({ id, result: {
      protocolVersion: params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {}, experimental: { 'claude/channel': {} } },
      serverInfo: { name: 'ieon', version: '0.1.0' },
      instructions: INSTRUCTIONS,
    } });
  }
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const args = params?.arguments ?? {};
    const entry = delivered.get(args.reply_to);
    if (params?.name !== 'reply' || !entry || typeof args.text !== 'string') {
      log('reply_rejected');
      return send({ id, result: { content: [{ type: 'text', text: i18nT('server.channel.bad_reply_to') }], isError: true } });
    }
    // 질문 하나에 답은 하나만 받는다. 중복 답장은 이어온에 전달하지 않는다.
    if (entry.replies.length) {
      log('reply_duplicate', { request_id: args.reply_to });
      return send({ id, result: { content: [{ type: 'text', text: i18nT('server.channel.already_replied') }], isError: true } });
    }
    entry.replies.push({ text: args.text.slice(0, MAX_TEXT), at: new Date().toISOString() });
    log('reply_stored', { request_id: args.reply_to });
    return send({ id, result: { content: [{ type: 'text', text: 'sent' }] } });
  }
  if (method === 'ping') return send({ id, result: {} });
  if (id !== undefined) send({ id, error: { code: -32601, message: 'method not found' } });
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try { handleRpc(JSON.parse(line)); } catch { log('bad_rpc'); }
  }
});
process.stdin.on('end', () => process.exit(0));

// --- loopback HTTP (이어온 연결부 전용) ---
const authorized = (req) => {
  const got = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer /, ''));
  return got.length === token.length && timingSafeEqual(got, token);
};
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

createServer(async (req, res) => {
  if (!authorized(req)) return json(res, 401, { error: 'unauthorized' });
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    let raw = '';
    for await (const c of req) { raw += c; if (raw.length > 64 * 1024) return json(res, 413, { error: 'too_large' }); }
    let body;
    try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'bad_json' }); }
    const { request_id: rid, text } = body ?? {};
    if (!REQUEST_ID.test(rid ?? '') || typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) return json(res, 400, { error: 'bad_request' });
    if (delivered.has(rid)) return json(res, 409, { error: 'duplicate_request' });
    delivered.set(rid, { replies: [], at: new Date().toISOString() });
    send({ method: 'notifications/claude/channel', params: {
      content: text.trim(),
      meta: { chat_id: 'ieon', message_id: rid, user: 'ieon', ts: new Date().toISOString() },
    } });
    log('delivered', { request_id: rid });
    return json(res, 202, { request_id: rid, status: 'delivered_to_session' });
  }
  if (req.method === 'GET' && url.pathname === '/v1/replies') {
    const entry = delivered.get(url.searchParams.get('request_id'));
    if (!entry) return json(res, 404, { error: 'unknown_request' });
    return json(res, 200, { replies: entry.replies });
  }
  if (req.method === 'GET' && url.pathname === '/v1/health') return json(res, 200, { ok: true });
  return json(res, 404, { error: 'not_found' });
}).listen(PORT, '127.0.0.1', () => log('listening', { port: PORT }));
