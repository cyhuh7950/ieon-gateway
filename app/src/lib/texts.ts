import { t } from "./i18n";
// 오류 문구는 사전 한 곳(locales/<언어>/errors.json — 웹·앱·메신저가 같이 씀). 앱 전용 문구는 errors.app.<코드>.
export { errText } from "./i18n";

export const ENGINE: Record<string, string> = {
  codex_thread: "Codex", claude_channel: "Claude Code", agy_cli: "Antigravity", grok_cli: "Grok",
};

// 대화를 막는 상태 카드(보내기 전 알려 줌)
// SV1: 허브 새 세션은 글 답만
export const CARD_TEXT: Record<string, string> = {
  text_only: t('app.texts.1'),
  hub_mode: t('app.texts.2'),
  device_offline: t('app.texts.3'),
  engine_off: t('app.texts.4'),
  archived: t('app.texts.5'),
  live_off: t('app.texts.6'),
  hub_codex_login: t('app.texts.7'),
};
