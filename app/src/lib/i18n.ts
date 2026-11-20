// I18N-a-4: 앱 문구 = 사전(src/locales — 저장소 locales/에서 복사, app/scripts/copy-locales.mjs).
// 언어: 이 기기에 고른 것(ieon_lang) → 기기 언어(navigator.language, PC 앱은 Electron이 넘겨 줌) → 영어 → 한국어.
// 언어를 바꾸면 다시 불러온다(화면 전체가 같은 언어로).
import { LOCALES, ieonFormat } from "../locales";

const KEY = "ieon_lang";
const BASE = "ko";
const norm = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const s = String(v).trim().replace("_", "-");
  if (LOCALES[s]) return s;
  const base = s.split("-")[0].toLowerCase();
  return LOCALES[base] ? base : null;
};
function pick(): string {
  if (typeof window === "undefined") return BASE; // 빌드(미리 그리기) 때는 원본 언어
  try { const saved = norm(localStorage.getItem(KEY)); if (saved) return saved; } catch { /* 저장소를 못 쓰면 기기 언어 */ }
  for (const l of navigator.languages ?? [navigator.language]) { const n = norm(l); if (n) return n; }
  return norm("en") ?? BASE;
}
export const lang = pick();
const dicts = [...new Set([lang, "en", BASE])].map((l) => LOCALES[l]);

export function t(key: string, vars?: Record<string, unknown>): string { return ieonFormat(dicts, key, vars, lang); }
export const tHas = (key: string) => dicts.some((d) => d && typeof d[key] === "string");
// 언어 목록: [코드, 그 언어로 쓴 이름]
export const languages = (): [string, string][] => Object.keys(LOCALES).map((l) => [l, LOCALES[l]["common.lang_name"] ?? l]);
export function setLang(l: string) { try { localStorage.setItem(KEY, l); } catch { /* 기억 못 해도 이번엔 바꿈 */ } location.reload(); }
// 오류 코드 → 문구: 앱 전용(errors.app.<코드>) → 공통(errors.<코드>) → "처리하지 못했어요(코드)"
export function errText(code: string | null | undefined): string {
  if (code) for (const k of [`errors.app.${code}`, `errors.${code}`]) if (tHas(k)) return t(k);
  return t("errors.app.unknown", { code: code ?? t("errors.app.no_code") });
}
