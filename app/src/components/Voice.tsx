import { errText, lang, t } from "../lib/i18n";
// 음성 화면 부품: 🎤(말로 쓰기 → 입력칸), 🔊(새 답 자동으로 읽어 주기, 기본 꺼짐), 답마다 🔈 읽기, 처음 한 번 안내.
// V2(설계 VOICE_LIVE): 방식은 서버 설정(기기 내장·OpenAI 한 번씩·OpenAI 실시간) — 🎤를 누를 때마다 물어 바로 적용.
// 실시간 대화(가)는 1:1 대화에서만: OpenAI가 통역사, 대답은 그 세션(ask로 일반 질문을 보냄).
import { useCallback, useEffect, useRef, useState } from "react";
import type { Client, VoiceConfig } from "../lib/api";
import IeonVoiceCore from "../locales/voice-core";
import { VOICE_ERR, VOICE_NOTICE, VoiceError, autoRead, listenOnce, markNoticeSeen, noticeSeen, setAutoRead, speak, speakable, stopSpeaking, voiceSupport, type Voice } from "../lib/voice";

type LiveState = { state: string; remainingSec?: number } | null;
type Opts = { api?: Client; conversationId?: string; ask?: (question: string) => Promise<string> };
const OPENAI_NOTICE = "ieon.voice.openai.notice.v1";
const lsGet = (k: string) => { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } };
const lsSet = (k: string, v: string) => { try { globalThis.localStorage?.setItem(k, v); } catch { /* 저장 안 됨 */ } };
const codeOf = (e: unknown) => (e as { code?: string })?.code || (e as Error)?.message || "failed";

export function useVoice(o: Opts = {}) {
  const [support, setSupport] = useState<Voice | null>(null);
  const [auto, setAuto] = useState(false);
  const [asking, setAsking] = useState<null | { openai: boolean; answer: (ok: boolean) => void }>(null);
  const [hint, setHint] = useState("");
  const [listening, setListening] = useState(false);
  const [live, setLive] = useState<LiveState>(null);
  const liveRef = useRef<{ hangup: (why?: string) => Promise<void>; mute: (on: boolean) => void } | null>(null);
  const recRef = useRef<{ stop: () => Promise<{ blob: Blob; type: string; sec: number }>; done: Promise<unknown> } | null>(null);
  const [muted, setMuted] = useState(false);
  const optsRef = useRef(o); optsRef.current = o;
  useEffect(() => { voiceSupport().then(setSupport); setAuto(autoRead()); return () => { stopSpeaking(); IeonVoiceCore.stopPlay(); liveRef.current?.hangup("user"); }; }, []);
  // 처음 쓸 때 한 번: 음성이 기기 회사 서버(V1) 또는 OpenAI(V2)를 거친다는 안내
  const ensureNotice = useCallback((openai = false) => new Promise<boolean>((resolve) => {
    if (openai ? lsGet(OPENAI_NOTICE) === "1" : noticeSeen()) return resolve(true);
    setAsking({ openai, answer: (ok: boolean) => { setAsking(null); if (ok) { if (openai) lsSet(OPENAI_NOTICE, "1"); else markNoticeSeen(); } resolve(ok); } });
  }), []);
  const config = useCallback(async (): Promise<VoiceConfig | null> => {
    const api = optsRef.current.api; if (!api) return null;
    try { return await api.voiceConfig(lang); } catch { return null; }
  }, []);

  const startLive = useCallback(async () => {
    const { api, conversationId, ask } = optsRef.current;
    if (!api || !conversationId || !ask) { setHint(t("app.oai_voice.live_chat_only")); return; }
    if (!(await ensureNotice(true))) return;
    setHint(""); setLive({ state: "connecting" });
    try {
      liveRef.current = await IeonVoiceCore.startLive({
        conversationId, lang,
        api: {
          live: (id: string, l: string) => api.voiceLive(id, l), tick: (id: string) => api.voiceTick(id), end: (id: string) => api.voiceEnd(id),
          ask, request: (rid: string) => api.request(rid), stop: (rid: string) => api.stop(rid), approvals: () => api.pendingApprovals(),
        },
        onState: (state: string, info?: { remainingSec?: number }) => setLive(state === "ended" ? null : { state, remainingSec: info?.remainingSec }),
        onEnd: (why: string) => { liveRef.current = null; setLive(null); setMuted(false); if (why !== "user") setHint(t(`app.oai_voice.ended.${why}`)); },
      });
    } catch (e) { liveRef.current = null; setLive(null); setHint(errText(codeOf(e))); }
  }, [ensureNotice]);

  // 나: 녹음 한 번 → 서버 받아쓰기 → 글자
  const turnListen = useCallback(async (): Promise<string | null> => {
    const api = optsRef.current.api!;
    if (recRef.current) {
      const r = recRef.current; recRef.current = null; setListening(false); setHint(t("app.oai_voice.transcribing"));
      try { const { blob, type, sec } = await r.stop(); const { text } = await api.transcribe(blob, type, sec, lang); setHint(text ? "" : VOICE_ERR.no_speech); return text || null; }
      catch (e) { setHint(errText(codeOf(e))); return null; }
    }
    if (!(await ensureNotice(true))) return null;
    try { recRef.current = (await IeonVoiceCore.record(60)) as unknown as typeof recRef.current; setListening(true); setHint(t("app.oai_voice.recording")); }
    catch (e) { recRef.current = null; setHint(errText(codeOf(e))); }
    return null;
  }, [ensureNotice]);

  const listen = useCallback(async (): Promise<string | null> => {
    if (liveRef.current) { await liveRef.current.hangup("user"); return null; }
    if (recRef.current) return turnListen();
    const c = await config();
    if (c && c.mode !== "device") {
      if (c.hubMode) { setHint(errText("hub_mode")); return null; }
      if (c.reason) { setHint(errText(c.reason)); return null; }
      if (c.live) { await startLive(); return null; }
      if (c.turn) return turnListen();
    }
    if (!support?.listen) return null;
    if (!(await ensureNotice())) return null;
    if (support.listen === "hint") { setHint(t('app.voice.13')); return null; }
    setHint(""); setListening(true);
    try { return await listenOnce(support.kind); }
    catch (e) { const c2 = e instanceof VoiceError ? e.code : "failed"; if (c2 !== "cancelled") setHint(VOICE_ERR[c2] ?? VOICE_ERR.failed); return null; }
    finally { setListening(false); }
  }, [support, ensureNotice, config, startLive, turnListen]);
  const toggleAuto = useCallback(async () => {
    if (!auto && !(await ensureNotice())) return;
    const on = !auto; setAuto(on); setAutoRead(on);
    if (!on) { stopSpeaking(); IeonVoiceCore.stopPlay(); }
  }, [auto, ensureNotice]);
  // 읽기: 방식이 OpenAI 한 번씩이면 OpenAI 목소리(실패하면 기기 목소리)
  const read = useCallback(async (text: string) => {
    if (liveRef.current) return; // 실시간 대화 중에는 통역사가 읽어 줌
    const c = await config();
    if (c?.turn && optsRef.current.api) {
      if (!(await ensureNotice(true))) return;
      try { const said = speakable(text); if (said) { await stopSpeaking(); IeonVoiceCore.play(await optsRef.current.api.speak(said, lang)); } return; }
      catch (e) { setHint(errText(codeOf(e))); }
    }
    if (support?.speak && (await ensureNotice())) speak(text, support.kind).catch(() => {});
  }, [support, ensureNotice, config]);
  const hangup = useCallback(() => { liveRef.current?.hangup("user"); }, []);
  const mute = useCallback(() => { const on = !muted; liveRef.current?.mute(on); setMuted(on); }, [muted]);
  const notice = asking ? <NoticeDialog openai={asking.openai} onAnswer={asking.answer} /> : null;
  return { support, auto, toggleAuto, listen, listening, read, hint, setHint, notice, live, hangup, mute, muted, canOpenai: Boolean(o.api) };
}
export type VoiceApi = ReturnType<typeof useVoice>;

// 새 답이 오면(이 화면을 연 뒤 끝난 것만) 자동 읽기가 켜져 있을 때 읽는다
// ready: 처음 기록을 다 불러온 뒤 true — 그때 있던 답은 읽지 않는다
export function useAutoRead(v: VoiceApi, answers: { id: string; text: string | null | undefined }[], ready: boolean) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!ready) return;
    const done = answers.filter((a) => a.text);
    if (seen.current === null) { seen.current = new Set(done.map((a) => a.id)); return; }
    const fresh = done.filter((a) => !seen.current!.has(a.id));
    fresh.forEach((a) => seen.current!.add(a.id));
    if (fresh.length && v.auto && !v.live && (v.support?.speak || v.canOpenai)) v.read(fresh[fresh.length - 1].text!);
  }, [answers, v, ready]);
}

export function SpeakerToggle({ v }: { v: VoiceApi }) {
  if (!v.support?.speak && !v.canOpenai) return null;
  return <button className={"ghost" + (v.auto ? " on" : "")} onClick={v.toggleAuto} aria-pressed={v.auto} aria-label={v.auto ? t('app.voice.14') : t('app.voice.15')} title={t('app.voice.10')}>{v.auto ? "🔊" : "🔈"}</button>;
}

export function ReadButton({ v, text }: { v: VoiceApi; text: string }) {
  if ((!v.support?.speak && !v.canOpenai) || !text) return null;
  return <button className="read" onClick={() => v.read(text)} aria-label={t('app.voice.11')}>{t('app.voice.7')}</button>;
}

// 🎤: 기기 받아쓰기·OpenAI 녹음(다시 누르면 끝)·실시간 대화(다시 누르면 끊기) — 방식은 설정에 따라
export function MicButton({ v, onText }: { v: VoiceApi; onText: (tv: string) => void }) {
  if (!v.support?.listen && !v.canOpenai) return null;
  return <button type="button" className={"mic" + (v.listening ? " on" : "") + (v.live ? " live" : "")} aria-label={v.live ? t('app.oai_voice.hangup') : t('app.voice.12')} aria-pressed={v.listening || Boolean(v.live)}
    onClick={async () => { const tv = await v.listen(); if (tv) onText(tv); }}>🎤</button>;
}

// 가: 실시간 대화 막대(상태·남은 시간·음소거·끊기)
export function LiveBar({ v }: { v: VoiceApi }) {
  if (!v.live) return null;
  const left = v.live.remainingSec != null ? t("app.oai_voice.left", { min: Math.max(0, Math.ceil(v.live.remainingSec / 60)) }) : "";
  return (
    <div className="livebar" role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" /><span>{t(`app.oai_voice.state.${v.live.state}`)}</span>{left && <small className="muted">{left}</small>}
      <span className="sp" />
      <button className="small" onClick={v.mute} aria-pressed={v.muted}>{v.muted ? t("app.oai_voice.unmute") : t("app.oai_voice.mute")}</button>
      <button className="small danger" onClick={v.hangup}>{t("app.oai_voice.hangup")}</button>
    </div>
  );
}

function NoticeDialog({ openai, onAnswer }: { openai: boolean; onAnswer: (ok: boolean) => void }) {
  return (
    <div className="dim" role="dialog" aria-modal="true" aria-labelledby="vnT">
      <div className="dialog">
        <b id="vnT">{openai ? t('app.oai_voice.notice_title') : t('app.voice.8')}</b>
        <p>{openai ? t('app.oai_voice.notice_body') : VOICE_NOTICE}</p>
        <div className="acts"><button className="primary" onClick={() => onAnswer(true)}>{t('app.voice.9')}</button><button onClick={() => onAnswer(false)}>{t('app.room.10')}</button></div>
      </div>
    </div>
  );
}
