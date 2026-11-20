import { useState } from "react";
import { cleanCode, normalizeServer, pair, type Conn } from "../lib/api";
import { platformName } from "../lib/storage";
import { errText } from "../lib/texts";
import { codeOf } from "./common";
import { lang, t } from "../lib/i18n";
import { LangSelect } from "./LangSelect";

export function PairScreen({ lost, onDone }: { lost: boolean; onDone: (c: Conn) => Promise<void> }) {
  const [server, setServer] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState(() => t('app.pair.1', { platform_name: platformName() }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(lost ? errText("unauthorized") : "");
  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    const s = normalizeServer(server);
    if (!s) return setErr(t('app.pair.12'));
    if (cleanCode(code).length !== 8) return setErr(t('app.pair.13'));
    setBusy(true); setErr("");
    try { await onDone(await pair(s, code, name.trim() || t('app.pair.14'))); } catch (x) { setErr(errText(codeOf(x))); } finally { setBusy(false); }
  };
  return (
    <main className="pair">
      <div className="logo" aria-hidden>{t('app.pair.2')}</div>
      <h1>{t('app.pair.3')}</h1>
      <p className="muted">{t('app.pair.4')} <b>{t('app.pair.5')}</b>{t('app.pair.6')} <b>{t('app.pair.7')}</b>{t('app.pair.8')}</p>
      <form onSubmit={submit}>
        <label>{t('app.pair.9')}<input value={server} onChange={(e) => setServer(e.target.value)} placeholder="ieun-gateway.sinsan.kr" inputMode="url" autoCapitalize="none" autoCorrect="off" required /></label>
        <label>{t('app.pair.10')}<input value={code} onChange={(e) => setCode(cleanCode(e.target.value))} placeholder="12345678" inputMode="numeric" maxLength={8} required /></label>
        <details><summary>{t('app.pair.11')}</summary><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label={t('app.pair.11')} /></details>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="primary" disabled={busy}>{busy ? t('app.pair.15') : t('app.pair.16')}</button>
      </form>
      <a className="muted policy" href={"https://ieun-gateway.sinsan.kr/privacy?lang=" + lang} target="_blank" rel="noopener noreferrer">{t('app.list.9')}</a>
      <LangSelect />
    </main>
  );
}
