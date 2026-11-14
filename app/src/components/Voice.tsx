// V1 음성 화면 부품: 🎤(말로 쓰기 → 입력칸), 🔊(새 답 자동으로 읽어 주기, 기본 꺼짐), 답마다 🔈 읽기, 처음 한 번 안내.
import { useCallback, useEffect, useRef, useState } from "react";
import { VOICE_ERR, VOICE_NOTICE, VoiceError, autoRead, listenOnce, markNoticeSeen, noticeSeen, setAutoRead, speak, stopSpeaking, voiceSupport, type Voice } from "../lib/voice";

export function useVoice() {
  const [support, setSupport] = useState<Voice | null>(null);
  const [auto, setAuto] = useState(false);
  const [asking, setAsking] = useState<null | ((ok: boolean) => void)>(null);
  const [hint, setHint] = useState("");
  const [listening, setListening] = useState(false);
  useEffect(() => { voiceSupport().then(setSupport); setAuto(autoRead()); return () => { stopSpeaking(); }; }, []);
  // 처음 쓸 때 한 번: 음성이 기기 회사 서버를 거칠 수 있다는 안내
  const ensureNotice = useCallback(() => new Promise<boolean>((resolve) => {
    if (noticeSeen()) return resolve(true);
    setAsking(() => (ok: boolean) => { setAsking(null); if (ok) markNoticeSeen(); resolve(ok); });
  }), []);
  const listen = useCallback(async (): Promise<string | null> => {
    if (!support?.listen) return null;
    if (!(await ensureNotice())) return null;
    if (support.listen === "hint") { setHint("입력칸을 누른 뒤 키보드의 Windows 키 + H를 누르고 말하세요(Windows 받아쓰기)."); return null; }
    setHint(""); setListening(true);
    try { return await listenOnce(support.kind); }
    catch (e) { const c = e instanceof VoiceError ? e.code : "failed"; if (c !== "cancelled") setHint(VOICE_ERR[c] ?? VOICE_ERR.failed); return null; }
    finally { setListening(false); }
  }, [support, ensureNotice]);
  const toggleAuto = useCallback(async () => {
    if (!auto && !(await ensureNotice())) return;
    const on = !auto; setAuto(on); setAutoRead(on);
    if (!on) stopSpeaking();
  }, [auto, ensureNotice]);
  const read = useCallback(async (text: string) => { if (support?.speak && (await ensureNotice())) speak(text, support.kind).catch(() => {}); }, [support, ensureNotice]);
  const notice = asking ? <NoticeDialog onAnswer={asking} /> : null;
  return { support, auto, toggleAuto, listen, listening, read, hint, setHint, notice };
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
    if (fresh.length && v.auto && v.support?.speak) v.read(fresh[fresh.length - 1].text!);
  }, [answers, v, ready]);
}

export function SpeakerToggle({ v }: { v: VoiceApi }) {
  if (!v.support?.speak) return null;
  return <button className={"ghost" + (v.auto ? " on" : "")} onClick={v.toggleAuto} aria-pressed={v.auto} aria-label={v.auto ? "새 답 읽어 주기 끄기" : "새 답 읽어 주기 켜기"} title="새 답 읽어 주기">{v.auto ? "🔊" : "🔈"}</button>;
}

export function ReadButton({ v, text }: { v: VoiceApi; text: string }) {
  if (!v.support?.speak || !text) return null;
  return <button className="read" onClick={() => v.read(text)} aria-label="이 답 읽어 주기">🔈 읽기</button>;
}

export function MicButton({ v, onText }: { v: VoiceApi; onText: (t: string) => void }) {
  if (!v.support?.listen) return null;
  return <button type="button" className={"mic" + (v.listening ? " on" : "")} disabled={v.listening} aria-label="말로 쓰기"
    onClick={async () => { const t = await v.listen(); if (t) onText(t); }}>🎤</button>;
}

function NoticeDialog({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  return (
    <div className="dim" role="dialog" aria-modal="true" aria-labelledby="vnT">
      <div className="dialog">
        <b id="vnT">음성 쓰기 전에</b>
        <p>{VOICE_NOTICE}</p>
        <div className="acts"><button className="primary" onClick={() => onAnswer(true)}>확인</button><button onClick={() => onAnswer(false)}>그만두기</button></div>
      </div>
    </div>
  );
}
