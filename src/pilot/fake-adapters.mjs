// 모델 없는 실행 대역. 실제 Codex SDK·Claude 채널을 import하지 않는다.
import { t as i18nT } from '../i18n/index.mjs';
import { EngineError } from './contracts.mjs';

function base(engine, opts, reject) {
  const adapter = {
    engine, calls: [], deletes: 0,
    async run(job) {
      adapter.calls.push(job);
      reject?.();
      if (opts.needsApproval) return { approvalRequired: true };
      if (opts.loseAck) throw new Error('ack lost after send');
      opts.beforeReturn?.();
      return { receipt: `${engine}-turn-${adapter.calls.length}`, answer: opts.answer ?? i18nT('server.fake_answer') };
    },
  };
  return adapter;
}

export function fakeCodexThread(opts = {}) {
  return base('codex_thread', opts, () => {
    if (opts.desktopHoldsThread) throw new EngineError('desktop_holds_thread', 409);
  });
}

export function fakeClaudeChannel(opts = {}) {
  return base('claude_channel', opts, () => {
    if (opts.sessionRunning === false) throw new EngineError('session_not_running', 503);
  });
}
