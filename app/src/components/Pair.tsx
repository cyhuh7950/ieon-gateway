import { useState } from "react";
import { cleanCode, normalizeServer, pair, type Conn } from "../lib/api";
import { platformName } from "../lib/storage";
import { errText } from "../lib/texts";
import { codeOf } from "./common";

export function PairScreen({ lost, onDone }: { lost: boolean; onDone: (c: Conn) => Promise<void> }) {
  const [server, setServer] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState(() => `이어온 ${platformName()}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(lost ? errText("unauthorized") : "");
  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    const s = normalizeServer(server);
    if (!s) return setErr("서버 주소를 확인하세요(예: ieun-gateway.sinsan.kr).");
    if (cleanCode(code).length !== 8) return setErr("연결 코드는 숫자 8자리예요.");
    setBusy(true); setErr("");
    try { await onDone(await pair(s, code, name.trim() || "이어온 앱")); } catch (x) { setErr(errText(codeOf(x))); } finally { setBusy(false); }
  };
  return (
    <main className="pair">
      <div className="logo" aria-hidden>이</div>
      <h1>이어온 연결</h1>
      <p className="muted">웹 화면 <b>설정 → 내 프로그램 연결 → 이어온 앱 연결</b>에서 <b>연결 코드 만들기</b>를 누르면 나오는 서버 주소와 8자리 코드를 넣으세요.</p>
      <form onSubmit={submit}>
        <label>서버 주소<input value={server} onChange={(e) => setServer(e.target.value)} placeholder="ieun-gateway.sinsan.kr" inputMode="url" autoCapitalize="none" autoCorrect="off" required /></label>
        <label>연결 코드<input value={code} onChange={(e) => setCode(cleanCode(e.target.value))} placeholder="12345678" inputMode="numeric" maxLength={8} required /></label>
        <details><summary>이 기기 이름</summary><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="이 기기 이름" /></details>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="primary" disabled={busy}>{busy ? "연결 중…" : "연결"}</button>
      </form>
      <a className="muted policy" href="https://ieun-gateway.sinsan.kr/privacy" target="_blank" rel="noopener noreferrer">개인정보 처리방침</a>
    </main>
  );
}
