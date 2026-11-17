// 화면 문구(웹 화면 app.html의 ERR와 같은 뜻)
export const ERR: Record<string, string> = {
  network: "서버에 닿지 않았어요. 인터넷·서버 주소를 확인하세요.",
  unauthorized: "이 기기 연결이 끊겼어요. 웹 화면에서 새 연결 코드를 만들어 다시 연결하세요.",
  bad_code: "연결 코드가 맞지 않거나 이미 썼거나 10분이 지났어요. 웹 화면에서 새 코드를 만드세요.",
  rate_limited: "너무 여러 번 시도했어요. 1분 뒤 다시 하세요.",
  usage_limit: "계정의 사용 한도에 걸려 실행되지 않았어요.",
  session_in_use: "그 세션을 다른 곳에서 쓰는 중이라 보내지 않았어요. 끝난 뒤 다시 보내세요.",
  session_load_failed: "그 세션을 불러오지 못해 보내지 않았어요(새 세션으로 대신하지 않아요).",
  engine_not_installed: "그 PC에 이 엔진의 CLI가 설치돼 있지 않아요.",
  work_dir_required: "작업 모드는 작업 폴더가 정해진 대화만 쓸 수 있어 보내지 않았어요.",
  work_dir_missing: "이 대화의 작업 폴더가 그 PC에 없어 보내지 않았어요.",
  account_not_logged_in: "고른 이어온 계정이 로그인돼 있지 않아 보내지 않았어요. 웹 화면 설정 → 계정에서 로그인하세요.",
  account_missing: "고른 이어온 계정이 없어 보내지 않았어요.",
  conversation_busy: "이 대화에서 처리 중인 질문이 있어 보낼 수 없어요.",
  host_busy: "그 PC·칸이 다른 질문을 여러 개 처리 중이라 보내지 않았어요 — 잠시 뒤 다시 보내 주세요(자동으로 다시 보내지 않아요)",
  device_unavailable: "PC 연결이 끊겨 보낼 수 없어요. PC가 켜져 있는지 확인하세요.",
  hub_mode: "이 PC는 허브에 연결돼 있어 여기서 보낸 질문은 처리하지 않아요. 허브 주소로 연결하세요.",
  desktop_holds_thread: "Codex 앱에서 이 대화를 열고 있어 보내지 않았어요. 앱에서 닫은 뒤 다시 보내세요.",
  thread_busy: "공유 서버에서 이 대화가 사용 중이라 보내지 않았어요.",
  shared_server_down: "공유 App Server가 실행 중이 아니에요.",
  session_not_running: "Claude 세션이 실행 중이 아니에요.",
  live_disabled: "AI 응답이 꺼져 있어요. 웹 화면에서 켜세요.",
  session_archived: "보관된 세션이에요. 웹 화면에서 꺼낸 뒤 질문하세요.",
  active_limit: "동시에 처리할 수 있는 수를 넘었어요. 잠시 후 다시 보내세요.",
  session_changed: "결과를 확인할 수 없어요(자동으로 다시 보내지 않아요). 확인 카드를 보세요.",
  approval_closed: "이미 결정됐거나 시간이 지난 승인이에요.",
};
export const errText = (code: string | null | undefined) => (code && ERR[code]) || `처리하지 못했어요(${code ?? "알 수 없음"}).`;

export const ENGINE: Record<string, string> = {
  codex_thread: "Codex", claude_channel: "Claude Code", agy_cli: "Antigravity", grok_cli: "Grok",
};

// 대화를 막는 상태 카드(보내기 전 알려 줌)
// SV1: 허브 새 세션은 글 답만
export const CARD_TEXT: Record<string, string> = {
  text_only: "이 세션은 글로만 답해요(허브가 직접 돌리는 새 세션은 명령 실행·파일 작업이 안 돼요 — 서버의 엔진 칸 대화에 맡기세요).",
  hub_mode: "이 PC는 허브에 연결돼 있어요. 허브 주소로 연결한 앱에서 보내세요.",
  device_offline: "PC 연결이 끊겨 있어요. PC가 켜져 있는지 확인하세요.",
  engine_off: "이 AI가 지금 실행 중이 아니에요.",
  archived: "보관된 세션이에요. 웹 화면에서 꺼낸 뒤 질문하세요.",
  live_off: "AI 응답이 꺼져 있어요. 웹 화면에서 켜세요.",
  hub_codex_login: "허브의 Codex 로그인이 필요해요. 웹 화면 설정에서 로그인하세요.",
};
