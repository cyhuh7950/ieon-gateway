// W3 예약 작업(설계 WORK_AND_VOICE A4·WV5, 신산님 2026-11-18 "남은 작업을 차례로 진행"): 정해진 때 AI 직원에게 질문을 보낸다.
// 사람이 없을 때 모델이 호출되므로 — 예약마다 웹 화면에서 사람이 승인(만들기·다시 켜기 = 승인), 하루 횟수 한도, 질문만(작업 모드인 대화는 그때 보내지 않음),
// 결과 불명(확인 필요)이 남아 있으면 그 예약을 멈추고 사람이 다시 켤 때까지 보내지 않는다. 자동 재전송 없음 — 보낼 수 없었던 회차는 건너뛰고 기록만 남긴다.
// 시간은 그 예약의 시간대(기본 Asia/Seoul) 벽시계 기준.
import { t as i18nT } from '../i18n/index.mjs';

export const SCHEDULE_KINDS = ['daily', 'interval', 'once'];
export const MAX_SCHEDULES = 20;
export const MIN_INTERVAL_MIN = 15;
const fail = (code) => { throw Object.assign(new Error(code), { http: 400 }); };

// 그 시간대의 벽시계와 UTC의 차이(밀리초). Intl만 사용(부품 없음).
export function tzOffsetMs(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(date).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}
const validTz = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
// 그 시간대의 "오늘" 날짜(YYYY-MM-DD) — 하루 횟수를 셀 때
export function localDay(date, tz) { return new Date(date.getTime() + tzOffsetMs(date, tz)).toISOString().slice(0, 10); }

export function validateSchedule(v = {}) {
  const kind = String(v.kind ?? '');
  if (!SCHEDULE_KINDS.includes(kind)) fail('bad_kind');
  const question = String(v.question ?? '').trim();
  if (!question || question.length > 4000) fail('bad_question');
  const tz = String(v.tz ?? 'Asia/Seoul');
  if (!validTz(tz)) fail('bad_tz');
  let spec;
  if (kind === 'daily') {
    const m = String(v.time ?? '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!m) fail('bad_time');
    spec = { time: `${m[1]}:${m[2]}` };
  } else if (kind === 'interval') {
    const n = Number(v.minutes);
    if (!Number.isInteger(n) || n < MIN_INTERVAL_MIN || n > 7 * 24 * 60) fail('bad_minutes');
    spec = { minutes: n };
  } else {
    const at = new Date(String(v.at ?? ''));
    if (Number.isNaN(at.getTime())) fail('bad_at');
    spec = { at: at.toISOString() };
  }
  const maxPerDay = v.maxPerDay === undefined || v.maxPerDay === null || v.maxPerDay === '' ? (kind === 'interval' ? 24 : 1) : Number(v.maxPerDay);
  if (!Number.isInteger(maxPerDay) || maxPerDay < 1 || maxPerDay > 96) fail('bad_max_per_day');
  return { kind, question, tz, spec, maxPerDay };
}

// 다음 보낼 때(ISO). from 이후로. once는 지났으면 null.
export function nextRun(s, from = new Date()) {
  const t = from.getTime();
  if (s.kind === 'once') { const at = new Date(s.spec.at).getTime(); return at > t ? new Date(at).toISOString() : null; }
  if (s.kind === 'interval') {
    const step = s.spec.minutes * 60_000;
    const base = s.lastRunAt ? new Date(s.lastRunAt).getTime() : t;
    let n = base + step; if (n <= t) n = t + step; // 서버가 꺼져 있었던 동안 밀린 회차는 몰아서 보내지 않음
    return new Date(n).toISOString();
  }
  const [h, mi] = s.spec.time.split(':').map(Number);
  const off = tzOffsetMs(from, s.tz);
  const local = new Date(t + off);
  let cand = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, mi) - off;
  if (cand <= t) cand += 86_400_000;
  // 하루를 더해 시간대 차이가 바뀌는 곳(서머타임)에서도 벽시계 시각을 맞춤
  return new Date(cand + (off - tzOffsetMs(new Date(cand), s.tz))).toISOString();
}

// 사람이 읽는 말의 키·값(화면·봇이 보는 사람 언어로 바꿈). 한 번 예약은 시각(at)·시간대(tz)를 넘겨 그 언어 형식으로
export function scheduleWhen(s) {
  if (s.kind === 'daily') return { whenKey: 'server.sched.daily', whenVars: { time: s.spec.time } };
  if (s.kind === 'interval') return s.spec.minutes % 60 === 0 ? { whenKey: 'server.sched.hours', whenVars: { n: s.spec.minutes / 60 } } : { whenKey: 'server.sched.minutes', whenVars: { n: s.spec.minutes } };
  return { whenKey: 'server.sched.once', whenVars: {}, whenAt: s.spec.at, whenTz: s.tz };
}
// 사람이 읽는 말(화면·목록)
export function describeSchedule(s) {
  if (s.kind === 'daily') return i18nT('server.sched.daily', { time: s.spec.time });
  if (s.kind === 'interval') return s.spec.minutes % 60 === 0 ? i18nT('server.sched.hours', { n: s.spec.minutes / 60 }) : i18nT('server.sched.minutes', { n: s.spec.minutes });
  return i18nT('server.sched.once', { at: new Date(s.spec.at).toLocaleString(i18nT('common.intl_locale'), { timeZone: s.tz }) });
}
