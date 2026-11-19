// G1(신산님 2026-11-20 "grok을 설치하고 테스트만 하면 사용할 수 있어야"): Grok 이어온 전용 계정 — Antigravity(A3)와 같은 모양.
// 계정 하나 = 폴더 하나(그 폴더에 api-key, 600). 실행할 때 XAI_API_KEY로 넘긴다(공식 문서의 Grok CLI 키 변수).
// PC 기본 로그인(Grok CLI에 이미 로그인된 구독·키)은 지금처럼 그대로. 계정 폴더별 구독 로그인 길은 공식 문서에 없어 API 키만.
// TO_VERIFY(실제 시험 때): Grok CLI가 XAI_API_KEY를 받아 그 키로 답하는지, 새 세션 JSON의 세션 ID 칸 이름.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanLabel, MAX_ACCOUNTS, PC_DEFAULT } from './accounts.mjs';

const ID = /^[a-z0-9]{2,16}$/;
const fail = (code, http = 400) => { throw Object.assign(new Error(code), { http }); };
export const GROK_KEY = /^\S{20,200}$/;

export const grokHomeOf = (dir, id) => { if (!ID.test(String(id))) fail('bad_account'); return join(dir, 'grok', id); };
export function grokAccounts(c) {
  const list = Array.isArray(c.grokAccounts?.accounts) ? c.grokAccounts.accounts.filter((a) => ID.test(String(a?.id))) : [];
  return list.map((a) => ({ id: a.id, label: cleanLabel(a.label) || a.id }));
}
export const grokDefaultAccount = (c) => c.grokAccounts?.defaultAccount ?? PC_DEFAULT;
export const grokAccountKind = (home) => (existsSync(join(home, 'api-key')) ? 'api' : null);
export function saveGrokApiKey(home, key) { mkdirSync(home, { recursive: true }); writeFileSync(join(home, 'api-key'), String(key).trim() + '\n', { mode: 0o600 }); }
export function grokLogoutFiles(home) { rmSync(join(home, 'api-key'), { force: true }); }

// 새 세션을 그 계정으로 실행할 준비: { accountId, env } 또는 PC 기본이면 null. 없는 계정·키 없음이면 보내기 전에 거절.
export function grokRunFor(c, dir, accountId, { env = process.env } = {}) {
  const id = accountId ?? grokDefaultAccount(c);
  if (id === PC_DEFAULT) return null;
  if (!grokAccounts(c).some((a) => a.id === id)) fail('account_missing', 409);
  const home = grokHomeOf(dir, id);
  if (!grokAccountKind(home)) fail('account_not_logged_in', 409);
  const e = { ...env }; delete e.XAI_API_KEY;
  e.XAI_API_KEY = readFileSync(join(home, 'api-key'), 'utf8').trim();
  return { accountId: id, env: e };
}

// 연결부 상태 보고: Grok 새 세션별 이어온 계정 이름표(created 기록의 account)·새 세션 기본 이름표. 이름표만.
export function grokAccountHealth(c) {
  const label = (id) => (id && id !== PC_DEFAULT ? grokAccounts(c).find((a) => a.id === id)?.label ?? null : null);
  const per = {};
  try {
    const f = c.newSessions?.createdPath;
    if (f && existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-500)) { try { const r = JSON.parse(l); const lb = label(r.account); if (lb && /^[\w-]{6,80}$/.test(String(r.id))) per[String(r.id).toLowerCase()] = lb; } catch { /* 깨진 줄 */ } }
  } catch { /* 기록 없음 */ }
  return { grokAccounts: per, grokDefault: label(grokDefaultAccount(c)) };
}
export { MAX_ACCOUNTS, PC_DEFAULT };
