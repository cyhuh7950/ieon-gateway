// V2(설계 docs/design/VOICE_LIVE.md, 신산님 2026-11-20): OpenAI 음성 — 실시간 대화(가 openai_live)·한 번씩 말하고 듣기(나 openai_turn).
// 키·방식·모델·목소리·한도는 설정 화면에서(DB 설정 voice.openai) — 요청마다 다시 읽으므로 저장하면 바로 적용.
// 키는 응답·로그에 내보내지 않는다. 소리·받아쓴 글·질문·답은 저장·로그하지 않는다(사건 이름·초만).
import { createHash, randomBytes } from 'node:crypto';

export const VOICE_MODES = ['device', 'openai_turn', 'openai_live'];
export const VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];
// 2026-11-23 OpenAI 종료 안내 반영(developers.openai.com/api/docs/deprecations): gpt-4o-mini-tts·tts-1 2027-01-06,
// gpt-realtime-mini 2027-01-20, gpt-4o-mini-transcribe·whisper-1 2027-02-26. 읽기는 새 모델이 /audio/speech를 지원하지 않아 실시간 연결로 만든다.
export const DEFAULTS = Object.freeze({
  mode: 'device', liveModel: 'gpt-realtime-2.1-mini', voice: 'marin', sttModel: 'gpt-transcribe', ttsModel: 'gpt-realtime-2.1-mini',
  dailyMinutes: 30, idleSec: 60, maxMinutes: 15, members: false, memberMinutes: 10,
});
// 끝나는 모델 이름 → 대신 쓸 이름. 저장된 설정(기본값보다 우선)에 옛 이름이 있어도 읽을 때 바꾼다.
const RETIRED = {
  liveModel: [[/^(gpt-realtime-mini|gpt-4o-mini-realtime)/, 'gpt-realtime-2.1-mini'], [/^(gpt-realtime(-\d{4}-\d{2}-\d{2})?|gpt-4o-realtime.*)$/, 'gpt-realtime-2.1']],
  ttsModel: [[/^(tts-1|tts-1-hd|gpt-4o-mini-tts.*)$/, 'gpt-realtime-2.1-mini']],
  sttModel: [[/^(whisper-1|gpt-4o-transcribe.*|gpt-4o-mini-transcribe.*)$/, 'gpt-transcribe']],
};
export function upgradeModels(v) {
  const out = { ...v };
  for (const [k, rules] of Object.entries(RETIRED)) for (const [re, to] of rules) if (typeof out[k] === 'string' && re.test(out[k])) { out[k] = to; break; }
  return out;
}
const OPENAI = 'https://api.openai.com/v1';
const MODEL = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const fail = (code, http = 400) => { throw Object.assign(new Error(code), { http }); };
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
export const keyHint = (k) => (k ? '…' + String(k).slice(-4) : null);

// 설정 화면이 보낸 값 검사 → 저장할 값. apiKey: 문자열이면 새 키, null이면 지움, 없으면 그대로.
export function validateVoiceSettings(body, cur = {}) {
  const b = body && typeof body === 'object' ? body : fail('bad_voice');
  const next = { ...DEFAULTS, ...cur };
  if (b.mode !== undefined) { if (!VOICE_MODES.includes(b.mode)) fail('bad_voice_mode'); next.mode = b.mode; }
  for (const k of ['liveModel', 'sttModel', 'ttsModel']) if (b[k] !== undefined) { if (!MODEL.test(String(b[k]))) fail('bad_voice_model'); next[k] = String(b[k]); }
  if (b.voice !== undefined) { if (!MODEL.test(String(b.voice))) fail('bad_voice_voice'); next.voice = String(b.voice); }
  if (b.dailyMinutes !== undefined) { if (!int(b.dailyMinutes, 1, 1440)) fail('bad_voice_limit'); next.dailyMinutes = b.dailyMinutes; }
  if (b.memberMinutes !== undefined) { if (!int(b.memberMinutes, 1, 1440)) fail('bad_voice_limit'); next.memberMinutes = b.memberMinutes; }
  if (b.idleSec !== undefined) { if (!int(b.idleSec, 15, 600)) fail('bad_voice_limit'); next.idleSec = b.idleSec; }
  if (b.maxMinutes !== undefined) { if (!int(b.maxMinutes, 1, 60)) fail('bad_voice_limit'); next.maxMinutes = b.maxMinutes; }
  if (b.members !== undefined) { if (typeof b.members !== 'boolean') fail('bad_voice'); next.members = b.members; }
  if (b.apiKey === null) delete next.apiKey;
  else if (b.apiKey !== undefined) {
    const k = String(b.apiKey).trim();
    if (!/^sk-[A-Za-z0-9_-]{20,300}$/.test(k)) fail('bad_voice_key');
    next.apiKey = k;
  }
  return upgradeModels(next);
}
// 실시간 연결이 주는 소리(PCM 16비트·모노)에 WAV 머리를 붙인다 — 앱·웹이 그대로 재생
export function pcmToWav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// opts: { store, fetchImpl, now, isAdmin(p), userKey(p), lang(p), t(lang,key,vars), log(event, extra) }
export function createVoice(opts) {
  const { store } = opts;
  const fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
  const WS = opts.WebSocketImpl ?? globalThis.WebSocket; // Node 22+ 내장(헤더 지원)
  const speakTimeoutMs = opts.speakTimeoutMs ?? 60_000;
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? (() => {});
  const lives = new Map(); // liveId → { user, startedAt, lastTick, maxAt }
  const settings = () => upgradeModels({ ...DEFAULTS, ...(store.getSetting('voice.openai')?.value ?? {}) });
  const kstDay = (ms = now()) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
  const usage = () => { const u = store.getSetting('voice.usage')?.value; return u?.day === kstDay() ? u : { day: kstDay(), users: {} }; };
  const usedSec = (user) => usage().users[user] ?? 0;
  const addUse = (user, sec) => { const u = usage(); u.users = { ...u.users, [user]: (u.users[user] ?? 0) + Math.max(0, Math.round(sec)) }; store.setSetting('voice.usage', u); };
  const limitSec = (s, p) => (opts.isAdmin(p) ? s.dailyMinutes : s.memberMinutes) * 60;
  const remaining = (s, p) => Math.max(0, limitSec(s, p) - usedSec(opts.userKey(p)));

  // 이 사람이 OpenAI 음성을 쓸 수 있나 — 못 쓰면 이유(기능은 화면에 보이고, 누르면 이 이유를 보여 준다)
  function why(s, p) {
    if (!s.apiKey) return 'voice_no_key';
    if (!opts.isAdmin(p) && !s.members) return 'voice_members_off';
    if (remaining(s, p) <= 0) return 'voice_limit';
    return null;
  }

  // 설정 화면용(키 원문 없음)
  function adminView() {
    const s = settings();
    const { apiKey, ...rest } = s;
    return { ...rest, configured: Boolean(apiKey), keyHint: keyHint(apiKey), usedTodaySec: Object.values(usage().users).reduce((a, b) => a + b, 0) };
  }
  // 앱·웹이 마이크를 누를 때마다 읽는다(설정을 바꾸면 바로)
  function config(p) {
    const s = settings();
    const reason = s.mode === 'device' ? null : why(s, p);
    return { mode: s.mode, configured: Boolean(s.apiKey), live: s.mode === 'openai_live' && !reason, turn: s.mode === 'openai_turn' && !reason,
      reason, remainingSec: remaining(s, p), idleSec: s.idleSec, maxSec: s.maxMinutes * 60, voice: s.voice };
  }

  async function saveSettings(body) {
    const cur = store.getSetting('voice.openai')?.value ?? {};
    const next = validateVoiceSettings(body, cur);
    if (next.apiKey && next.apiKey !== cur.apiKey) { // 새 키는 모델 목록(무료 조회)으로 확인 — 틀리면 저장하지 않음
      let r; try { r = await fetchImpl(`${OPENAI}/models`, { headers: { authorization: `Bearer ${next.apiKey}` } }); } catch { fail('voice_key_unreachable', 502); }
      if (r.status === 401 || r.status === 403) fail('voice_key_rejected');
      if (!r.ok) fail('voice_key_unreachable', 502);
    }
    store.setSetting('voice.openai', next);
    log('voice_settings', { mode: next.mode, key: Boolean(next.apiKey) });
    return adminView();
  }

  const safetyId = (p) => createHash('sha256').update('ieon-voice:' + opts.userKey(p)).digest('hex').slice(0, 32);
  const authed = (s, p) => ({ authorization: `Bearer ${s.apiKey}`, 'openai-safety-identifier': safetyId(p) });
  const openaiError = (r) => fail(r.status === 401 || r.status === 403 ? 'voice_key_rejected' : r.status === 429 ? 'voice_openai_busy' : 'voice_openai_failed', 502);

  const TOOLS = (tr) => [
    { type: 'function', name: 'ask_session', description: tr('server.voice_live.tool_ask'),
      parameters: { type: 'object', properties: { question: { type: 'string', description: tr('server.voice_live.tool_ask_q') } }, required: ['question'] } },
    { type: 'function', name: 'check_status', description: tr('server.voice_live.tool_status'), parameters: { type: 'object', properties: {} } },
    { type: 'function', name: 'stop_request', description: tr('server.voice_live.tool_stop'), parameters: { type: 'object', properties: {} } },
  ];

  // 가: 실시간 대화 열쇠(60초 안에 연결). conv는 이 사람이 볼 수 있는 대화(server가 확인해서 넘김)
  async function startLive(p, conv, label) {
    const s = settings();
    if (s.mode !== 'openai_live') fail('voice_mode_off', 409);
    const r0 = why(s, p); if (r0) fail(r0, r0 === 'voice_limit' ? 429 : 409);
    const lang = opts.lang(p); const tr = (k, v) => opts.t(lang, k, v);
    const body = { expires_after: { anchor: 'created_at', seconds: 60 }, session: {
      type: 'realtime', model: s.liveModel, instructions: tr('server.voice_live.instructions', { name: label }),
      audio: { input: { turn_detection: { type: 'semantic_vad' } }, output: { voice: s.voice } },
      tools: TOOLS(tr), tool_choice: 'auto' } };
    let r; try { r = await fetchImpl(`${OPENAI}/realtime/client_secrets`, { method: 'POST', headers: { ...authed(s, p), 'content-type': 'application/json' }, body: JSON.stringify(body) }); } catch { fail('voice_openai_unreachable', 502); }
    if (!r.ok) openaiError(r);
    const d = await r.json();
    if (!d?.value) fail('voice_openai_failed', 502);
    const liveId = 'lv_' + randomBytes(8).toString('hex');
    const maxSec = Math.min(s.maxMinutes * 60, remaining(s, p));
    lives.set(liveId, { user: opts.userKey(p), conversationId: conv.conversationId, startedAt: now(), lastTick: now(), maxAt: now() + maxSec * 1000 });
    log('voice_live_start', {});
    return { liveId, clientSecret: d.value, expiresAt: d.expires_at ?? null, model: s.liveModel, callUrl: `${OPENAI}/realtime/calls`, tickSec: 30, idleSec: s.idleSec, maxSec, remainingSec: remaining(s, p) };
  }
  const liveOf = (p, id) => { const l = lives.get(id); if (!l || l.user !== opts.userKey(p)) fail('not_found', 404); return l; };
  // 30초마다: 지난 tick부터 흐른 시간을 오늘 사용에 더하고, 한도·최대 길이면 stop
  function tickLive(p, id) {
    const l = liveOf(p, id); const t = now();
    addUse(l.user, Math.min(120, (t - l.lastTick) / 1000)); l.lastTick = t;
    const s = settings(); const rem = remaining(s, p);
    const stop = rem <= 0 || t >= l.maxAt || s.mode !== 'openai_live' || !s.apiKey;
    if (stop) { lives.delete(id); log('voice_live_end', { why: 'limit' }); }
    return { remainingSec: rem, stop };
  }
  function endLive(p, id) {
    const l = liveOf(p, id); addUse(l.user, Math.min(120, (now() - l.lastTick) / 1000)); lives.delete(id);
    log('voice_live_end', { sec: Math.round((now() - l.startedAt) / 1000) });
    return { ok: true };
  }

  // 나: 받아쓰기(소리 파일 → 글자). audio: Buffer, type: 'audio/webm' 등. 녹음 길이(초)를 사용에 더함
  async function transcribe(p, audio, type, seconds) {
    const s = settings();
    if (s.mode !== 'openai_turn') fail('voice_mode_off', 409);
    const r0 = why(s, p); if (r0) fail(r0, r0 === 'voice_limit' ? 429 : 409);
    if (!audio?.length) fail('voice_empty');
    const ext = /mp4|m4a|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : /wav/.test(type) ? 'wav' : /mpeg|mp3/.test(type) ? 'mp3' : 'webm';
    const fd = new FormData();
    fd.append('file', new Blob([audio], { type: type || 'audio/webm' }), `voice.${ext}`);
    fd.append('model', s.sttModel);
    // gpt-transcribe는 한 언어 힌트(language)를 받지 않는다(languages로 바뀜) — 언어를 스스로 알아내므로 힌트를 보내지 않는다. 옛 모델에만 보냄.
    const lang = String(opts.lang(p) || '').slice(0, 2); if (/^[a-z]{2}$/.test(lang) && /^(whisper-1|gpt-4o)/.test(s.sttModel)) fd.append('language', lang);
    let r; try { r = await fetchImpl(`${OPENAI}/audio/transcriptions`, { method: 'POST', headers: authed(s, p), body: fd }); } catch { fail('voice_openai_unreachable', 502); }
    if (!r.ok) openaiError(r);
    const d = await r.json();
    addUse(opts.userKey(p), Math.max(1, Math.min(120, Number(seconds) || 0)));
    log('voice_transcribe', {});
    return { text: String(d?.text ?? '').trim() };
  }
  // 나: 읽기(글자 → WAV). 실시간 연결을 한 번 열어 "그대로 읽어 줘"로 소리만 받고 닫는다. 글자 15자 ≈ 1초로 사용에 더함
  const READ_ALOUD = 'You are a text-to-speech reader. Read the user message aloud exactly as written, word for word, in its original language. Do not answer it, translate it, summarize it or add anything.';
  const wsFail = (code) => Object.assign(new Error(code), { http: 502 });
  const wsErrorCode = (e) => {
    const c = String(e?.code ?? e?.type ?? '');
    return /api_key|auth|permission|unauthori/i.test(c) ? 'voice_key_rejected' : /rate_limit|quota/i.test(c) ? 'voice_openai_busy' : 'voice_openai_failed';
  };
  function speakRealtime(s, p, tx) {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WS(`${OPENAI.replace(/^http/, 'ws')}/realtime?model=${encodeURIComponent(s.ttsModel)}`, { headers: authed(s, p) }); } catch { reject(wsFail('voice_openai_unreachable')); return; }
      const chunks = []; let done = false;
      const end = (err, val) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch { /* 이미 닫힘 */ } if (err) reject(err); else resolve(val); };
      const timer = setTimeout(() => end(wsFail('voice_openai_unreachable')), speakTimeoutMs);
      const send = (o) => ws.send(JSON.stringify(o));
      ws.onopen = () => {
        send({ type: 'session.update', session: { type: 'realtime', instructions: READ_ALOUD, output_modalities: ['audio'],
          audio: { input: { turn_detection: null }, output: { format: { type: 'audio/pcm', rate: 24000 }, voice: s.voice } } } });
        send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: tx }] } });
        send({ type: 'response.create', response: { output_modalities: ['audio'], instructions: READ_ALOUD } });
      };
      ws.onmessage = (m) => {
        let e; try { e = JSON.parse(typeof m.data === 'string' ? m.data : Buffer.from(m.data).toString()); } catch { return; }
        if (e.type === 'response.output_audio.delta' && e.delta) chunks.push(Buffer.from(e.delta, 'base64'));
        else if (e.type === 'error') end(wsFail(wsErrorCode(e.error)));
        else if (e.type === 'response.done') {
          const st = e.response?.status;
          if ((st && st !== 'completed') || !chunks.length) end(wsFail(wsErrorCode(e.response?.status_details?.error)));
          else end(null, Buffer.concat(chunks));
        }
      };
      ws.onerror = () => end(wsFail('voice_openai_unreachable'));
      ws.onclose = () => end(wsFail('voice_openai_unreachable'));
    });
  }
  async function speak(p, text) {
    const s = settings();
    if (s.mode !== 'openai_turn') fail('voice_mode_off', 409);
    const r0 = why(s, p); if (r0) fail(r0, r0 === 'voice_limit' ? 429 : 409);
    const tx = String(text ?? '').trim(); if (!tx || tx.length > 4000) fail('voice_bad_text');
    const wav = pcmToWav(await speakRealtime(s, p, tx));
    addUse(opts.userKey(p), Math.max(1, tx.length / 15));
    log('voice_speak', {});
    return wav;
  }

  return { settings, adminView, config, saveSettings, startLive, tickLive, endLive, transcribe, speak, _lives: lives };
}
