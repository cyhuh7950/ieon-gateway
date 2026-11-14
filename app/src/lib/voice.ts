// V1 음성(기기 내장만, 키·비용 없음). 받아쓴 글은 입력칸에 넣어 고친 뒤 보낸다(바로 보내지 않음). 음성으로 승인하지 않는다.
// - 안드로이드: 앱 안 IeonVoice(기기 받아쓰기 창 + TextToSpeech)
// - PC 설치형(Electron): 읽어 주기는 Windows 목소리, 받아쓰기는 Windows 받아쓰기(Win+H) 안내 — Electron에는 내장 인식이 없다
// - 웹 브라우저(크롬·엣지): Web Speech API
// 음성·받아쓴 글은 서버·로그 어디에도 저장하지 않는다.
import { Capacitor, registerPlugin } from "@capacitor/core";

type Native = {
  available(): Promise<{ listen: boolean; speak: boolean }>;
  listen(): Promise<{ text: string }>;
  speak(o: { text: string }): Promise<void>;
  stop(): Promise<void>;
};
const IeonVoice = registerPlugin<Native>("IeonVoice");

export type VoiceKind = "native" | "web" | "desktop" | "none";
export type Voice = { listen: "native" | "web" | "hint" | null; speak: boolean; kind: VoiceKind };

const g = globalThis as any;
export function voiceKind(): VoiceKind {
  try { if (Capacitor.isNativePlatform()) return "native"; } catch { /* 웹 */ }
  if (g.ieonDesktop) return "desktop";
  if (typeof window !== "undefined" && ("speechSynthesis" in window || g.SpeechRecognition || g.webkitSpeechRecognition)) return "web";
  return "none";
}

export async function voiceSupport(kind = voiceKind()): Promise<Voice> {
  if (kind === "native") {
    try { const a = await IeonVoice.available(); return { kind, listen: a.listen ? "native" : null, speak: a.speak }; } catch { return { kind, listen: null, speak: false }; }
  }
  const speak = typeof window !== "undefined" && "speechSynthesis" in window;
  if (kind === "desktop") return { kind, listen: "hint", speak };
  const SR = g.SpeechRecognition || g.webkitSpeechRecognition;
  return { kind, listen: SR ? "web" : null, speak };
}

export class VoiceError extends Error { constructor(public code: string) { super(code); } }

// 한 번 말한 것을 글자로. 취소·실패는 VoiceError(cancelled | no_speech | not_allowed | failed)
export async function listenOnce(kind = voiceKind()): Promise<string> {
  if (kind === "native") {
    try { return (await IeonVoice.listen()).text.trim(); } catch (e: any) { throw new VoiceError(e?.code === "cancelled" ? "cancelled" : "failed"); }
  }
  const SR = g.SpeechRecognition || g.webkitSpeechRecognition;
  if (!SR) throw new VoiceError("failed");
  return new Promise((resolve, reject) => {
    const r = new SR();
    r.lang = "ko-KR"; r.interimResults = false; r.maxAlternatives = 1;
    let got = "";
    r.onresult = (e: any) => { got = String(e.results?.[0]?.[0]?.transcript ?? ""); };
    r.onerror = (e: any) => reject(new VoiceError(e.error === "not-allowed" ? "not_allowed" : e.error === "no-speech" ? "no_speech" : e.error === "aborted" ? "cancelled" : "failed"));
    r.onend = () => (got ? resolve(got.trim()) : reject(new VoiceError("no_speech")));
    r.start();
  });
}

// 읽기 좋게: 코드 덩어리·링크 주소는 줄여 읽는다(화면 글은 그대로)
export function speakable(text: string): string {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " 코드 생략. ")
    .replace(/https?:\/\/\S+/g, " 링크. ")
    .replace(/[`*_#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

export async function speak(text: string, kind = voiceKind()): Promise<void> {
  const t = speakable(text);
  if (!t) return;
  if (kind === "native") { await IeonVoice.speak({ text: t }); return; }
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t);
  u.lang = "ko-KR";
  const ko = speechSynthesis.getVoices().find((v) => /^ko/i.test(v.lang));
  if (ko) u.voice = ko;
  await new Promise<void>((res) => { u.onend = () => res(); u.onerror = () => res(); speechSynthesis.speak(u); });
}

export async function stopSpeaking(kind = voiceKind()): Promise<void> {
  if (kind === "native") { try { await IeonVoice.stop(); } catch { /* 없음 */ } return; }
  if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
}

// 처음 한 번 안내·자동 읽기 켜기는 이 기기에만 기억(localStorage — 안드로이드 WebView도 앱 안에 남음)
const NOTICE = "ieon.voice.notice.v1"; const AUTO = "ieon.voice.auto.v1";
const ls = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
export const noticeSeen = () => ls()?.getItem(NOTICE) === "1";
export const markNoticeSeen = () => ls()?.setItem(NOTICE, "1");
export const autoRead = () => ls()?.getItem(AUTO) === "1";
export const setAutoRead = (on: boolean) => ls()?.setItem(AUTO, on ? "1" : "0");

export const VOICE_NOTICE = "말로 묻기·답 읽어 주기는 이 기기에 들어 있는 기능을 써요. 기기에 따라 음성이 기기 회사(구글·마이크로소프트·애플) 서버를 거칠 수 있어요. 이어온 서버에는 음성도, 받아쓴 글도 따로 저장하지 않아요. 허락(승인)은 말로 하지 않고 카드 버튼으로만 해요.";
export const VOICE_ERR: Record<string, string> = {
  not_allowed: "마이크를 쓸 수 없어요. 브라우저·기기 설정에서 마이크를 허용하세요.",
  no_speech: "말소리를 듣지 못했어요. 다시 눌러 말해 주세요.",
  failed: "받아쓰기를 하지 못했어요.",
};
