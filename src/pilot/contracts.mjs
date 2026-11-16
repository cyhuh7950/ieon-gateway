// 이어온 S1 공통 계약. 상태 문자열은 DESIGN 7절과 같다.
export const STATUS = Object.freeze({
  queued: 'queued', dispatching: 'dispatching', running: 'running',
  approvalRequired: 'approval_required', completed: 'completed',
  failed: 'failed', cancelled: 'cancelled', unknown: 'unknown',
});

export const ENGINES = Object.freeze(['codex_thread', 'claude_channel', 'claude_cli', 'agy_cli', 'grok_cli']); // E1·E2: Antigravity·Grok(질문마다 CLI 한 번)

// 세션 잠금을 풀어도 되는 끝 상태. unknown·approval_required는 잠금을 유지한다.
export const RELEASING = new Set([STATUS.completed, STATUS.failed, STATUS.cancelled]);

// RC2: 사람이 그 요청만 멈췄고, 엔진 차례가 실제로 끝난 것을 확인한 경우(중지됨). 확인하지 못하면 이것을 쓰지 않는다(결과 불명).
export class StoppedError extends Error {
  constructor() { super('stopped_by_user'); this.code = 'stopped_by_user'; }
}
// RC2: 실행 중에 멈출 수 없는 엔진(사람이 띄운 Claude 채널 창). 대기 중 취소만 된다.
export const STOP_UNSUPPORTED = new Set(['claude_channel']);

// 엔진이 실행 전에 명확히 거부한 경우. 모델이 실행되지 않았음이 확실할 때만 쓴다.
export class EngineError extends Error {
  constructor(code, http) {
    super(code);
    this.code = code;
    this.http = http;
  }
}
