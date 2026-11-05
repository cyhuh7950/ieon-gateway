// 이어온 S1 공통 계약. 상태 문자열은 DESIGN 7절과 같다.
export const STATUS = Object.freeze({
  queued: 'queued', dispatching: 'dispatching', running: 'running',
  approvalRequired: 'approval_required', completed: 'completed',
  failed: 'failed', cancelled: 'cancelled', unknown: 'unknown',
});

export const ENGINES = Object.freeze(['codex_thread', 'claude_channel', 'claude_cli']);

// 세션 잠금을 풀어도 되는 끝 상태. unknown·approval_required는 잠금을 유지한다.
export const RELEASING = new Set([STATUS.completed, STATUS.failed, STATUS.cancelled]);

// 엔진이 실행 전에 명확히 거부한 경우. 모델이 실행되지 않았음이 확실할 때만 쓴다.
export class EngineError extends Error {
  constructor(code, http) {
    super(code);
    this.code = code;
    this.http = http;
  }
}
