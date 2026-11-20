"use client";
// I18N: 언어 고르기(앱 첫 화면·목록 아래). 고르면 이 기기에 기억하고 다시 불러온다.
import { lang, languages, setLang, t } from "../lib/i18n";

export function LangSelect() {
  return (
    <select className="lang" value={lang} aria-label={t("common.language")} onChange={(e) => setLang(e.target.value)}>
      {languages().map(([code, name]) => <option key={code} value={code}>{name}</option>)}
    </select>
  );
}
