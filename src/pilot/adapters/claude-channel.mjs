// S2.4 Claude Code 채널 어댑터. C1의 이어온 전용 채널(ieon-channel.mjs)에 질문을 넣고 reply를 기다린다.
// 채널에 연결되지 않으면(세션 미실행) 전달 전이므로 session_not_running으로 거부한다.
// 전달(202) 후 답이 없으면 결과를 알 수 없으므로 unknown이다. 재전송하지 않는다.
import { readFileSync } from 'node:fs';
import { EngineError } from '../contracts.mjs';

// opts: { live, baseUrl, tokenFile, waitMs?, pollMs? }
export function claudeChannelAdapter(opts) {
  const waitMs = opts.waitMs ?? 180000;
  const pollMs = opts.pollMs ?? 2000;
  return {
    engine: 'claude_channel',
    async run({ requestId, question }) {
      if (!opts.live) throw new EngineError('live_disabled', 503);
      const headers = { authorization: `Bearer ${readFileSync(opts.tokenFile, 'utf8').trim()}`, 'content-type': 'application/json' };
      const channelId = requestId.replace(/^req_/, '');
      let post;
      try {
        post = await fetch(`${opts.baseUrl}/v1/messages`, { method: 'POST', headers, body: JSON.stringify({ request_id: channelId, text: question }) });
      } catch (error) {
        if (error.cause?.code === 'ECONNREFUSED') throw new EngineError('session_not_running', 503);
        throw error;
      }
      if (post.status === 401) throw new EngineError('channel_unauthorized', 503);
      if (post.status === 409) throw new Error('channel_duplicate');
      if (post.status !== 202) throw new EngineError('channel_rejected', 502);
      const started = Date.now();
      while (Date.now() - started < waitMs) {
        await new Promise((r) => setTimeout(r, pollMs));
        const r = await fetch(`${opts.baseUrl}/v1/replies?request_id=${channelId}`, { headers });
        const { replies = [] } = await r.json();
        if (replies.length) return { receipt: `claude:${channelId}`, answer: replies[0].text };
      }
      throw new Error('reply_timeout');
    },
  };
}
