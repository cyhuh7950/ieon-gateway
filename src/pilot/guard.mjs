// 소유권과 세션 잠금 키. 서버가 검증한 binding만 신뢰한다.
export function canAccess(principal, binding) {
  return Boolean(binding && principal
    && binding.ownerUserId === principal.userId
    && binding.appIds.includes(principal.appId));
}

// 표시 이름·대화 ID가 달라도 같은 host·엔진·세션이면 같은 잠금을 쓴다.
export function sessionKey(binding) {
  return `${binding.hostId}|${binding.engine}|${binding.sessionRef}`;
}
