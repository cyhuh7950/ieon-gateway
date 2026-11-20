// V2 OpenAI 음성(설계 docs/design/VOICE_LIVE.md, 신산님 2026-11-20 "OpenAI API를 사용할거야"·"지금 다 만들어"·"설정에서 바꾸면 바로"):
// 가 실시간 대화(열쇠 발급·시간 세기), 나 한 번씩(받아쓰기·읽기 중계), 설정 저장(키 확인·끝 4자만), 화면·앱이 같은 공통 코드. 실제 OpenAI 호출 없음(가짜 fetch).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/pilot/server.mjs';
import { createVoice, validateVoiceSettings, DEFAULTS } from '../../src/pilot/voice-openai.mjs';
import { build } from '../../app/scripts/copy-locales.mjs';

const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const KEY = 'sk-test' + 'x'.repeat(40) + 'WXYZ';
const T1 = '01a18790-0000-7000-8000-0000000000v2'.replace('v2', 'b2');

function fakeOpenai() {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    const auth = init.headers?.authorization;
    if (auth !== `Bearer ${KEY}`) return new Response('{"error":{}}', { status: 401 });
    if (u.endsWith('/models')) return new Response('{"data":[]}', { status: 200 });
    if (u.endsWith('/realtime/client_secrets')) return Response.json({ value: 'ek_test_secret', expires_at: 1, session: { id: 'sess_1' } });
    if (u.endsWith('/audio/transcriptions')) return Response.json({ text: ' 안녕하세요 ' });
    if (u.endsWith('/audio/speech')) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    return new Response('{}', { status: 404 });
  };
  return { f, calls };
}
function memStore() { const m = new Map(); return { getSetting: (k) => (m.has(k) ? { value: structuredClone(m.get(k)) } : null), setSetting: (k, v) => m.set(k, structuredClone(v)), _m: m }; }

test('V2 설정 검사: 기본값, 틀린 방식·모델·시간·키 모양은 거절, 키 null이면 지움', () => {
  assert.equal(validateVoiceSettings({}).mode, 'device');
  assert.equal(validateVoiceSettings({ mode: 'openai_live', dailyMinutes: 5 }).dailyMinutes, 5);
  for (const [b, e] of [[{ mode: 'x' }, 'bad_voice_mode'], [{ liveModel: 'A B' }, 'bad_voice_model'], [{ dailyMinutes: 0 }, 'bad_voice_limit'], [{ idleSec: 5 }, 'bad_voice_limit'],
    [{ maxMinutes: 61 }, 'bad_voice_limit'], [{ members: 'yes' }, 'bad_voice'], [{ apiKey: 'nope' }, 'bad_voice_key']]) assert.throws(() => validateVoiceSettings(b), new RegExp(e), JSON.stringify(b));
  assert.equal(validateVoiceSettings({ apiKey: null }, { apiKey: KEY }).apiKey, undefined);
  assert.equal(DEFAULTS.liveModel, 'gpt-realtime-mini');
});

test('V2 모듈: 설정 저장(새 키는 OpenAI 확인, 틀리면 저장 안 함), 화면엔 끝 4자만, 이유(키 없음·가입자 꺼짐·한도)', async () => {
  const { f, calls } = fakeOpenai(); const store = memStore(); let admin = true; let now = Date.parse('2026-11-20T03:00:00Z');
  const v = createVoice({ store, fetchImpl: f, now: () => now, isAdmin: () => admin, userKey: () => (admin ? 'admin' : 'u_m'), lang: () => 'ko', t: (l, k, x) => `${k}:${x?.name ?? ''}` });
  assert.deepEqual(v.config({}).reason, null, '기기 내장은 이유 없음');
  await v.saveSettings({ mode: 'openai_live' });
  assert.equal(v.config({}).reason, 'voice_no_key');
  await assert.rejects(v.saveSettings({ apiKey: 'sk-wrong' + 'y'.repeat(30) }), /voice_key_rejected/);
  assert.equal(store.getSetting('voice.openai').value.apiKey, undefined, '틀린 키는 저장 안 함');
  const view = await v.saveSettings({ apiKey: KEY });
  assert.equal(view.keyHint, '…WXYZ'); assert.equal(view.configured, true); assert.ok(!JSON.stringify(view).includes(KEY), '화면 값에 키 원문 없음');
  assert.ok(calls.some((c) => c.url.endsWith('/models')), '키 확인은 모델 목록');
  assert.equal(v.config({}).live, true);
  admin = false; assert.equal(v.config({}).reason, 'voice_members_off');
  await v.saveSettings({ members: true, memberMinutes: 1 }); assert.equal(v.config({}).live, true, '가입자 켜면 바로');
  admin = true;
});

test('V2 가: 실시간 열쇠 — 모델·목소리·지시문(대화 이름)·도구 3개, 사용자 해시, 30초 tick이 시간을 세고 한도면 stop', async () => {
  const { f, calls } = fakeOpenai(); const store = memStore(); let now = Date.parse('2026-11-20T03:00:00Z');
  const v = createVoice({ store, fetchImpl: f, now: () => now, isAdmin: () => true, userKey: () => 'admin', lang: () => 'ko', t: (l, k, x) => `${l}|${k}|${x?.name ?? ''}` });
  await v.saveSettings({ apiKey: KEY, mode: 'openai_turn' });
  await assert.rejects(v.startLive({}, { conversationId: 'c1' }, '결제 작업'), /voice_mode_off/, '방식이 실시간이 아니면 거절');
  await v.saveSettings({ mode: 'openai_live', voice: 'cedar', dailyMinutes: 1, maxMinutes: 15 });
  const s = await v.startLive({}, { conversationId: 'c1' }, '결제 작업');
  assert.equal(s.clientSecret, 'ek_test_secret'); assert.match(s.liveId, /^lv_[0-9a-f]{16}$/); assert.equal(s.maxSec, 60, '남은 하루 시간이 더 짧으면 그만큼');
  const c = calls.find((x) => x.url.endsWith('/realtime/client_secrets')); const body = JSON.parse(c.init.body);
  assert.equal(body.session.model, 'gpt-realtime-mini'); assert.equal(body.session.audio.output.voice, 'cedar');
  assert.equal(body.session.instructions, 'ko|server.voice_live.instructions|결제 작업');
  assert.deepEqual(body.session.tools.map((x) => x.name), ['ask_session', 'check_status', 'stop_request']);
  assert.equal(body.expires_after.seconds, 60);
  assert.match(c.init.headers['openai-safety-identifier'], /^[0-9a-f]{32}$/); assert.ok(!c.init.headers['openai-safety-identifier'].includes('admin'));
  now += 30_000; assert.deepEqual(v.tickLive({}, s.liveId), { remainingSec: 30, stop: false });
  now += 30_000; assert.equal(v.tickLive({}, s.liveId).stop, true, '하루 1분이 다 되면 끊음');
  assert.throws(() => v.tickLive({}, s.liveId), /not_found/, '끊긴 뒤 tick은 없음');
  assert.equal(v.config({}).reason, 'voice_limit');
  await assert.rejects(v.startLive({}, { conversationId: 'c1' }, 'x'), /voice_limit/);
  now += 24 * 3600_000; assert.equal(v.config({}).reason, null, '다음 날(한국 시각)이면 다시');
});

test('V2 나: 받아쓰기·읽기를 서버가 OpenAI로 넘김(언어·모델·목소리), 방식이 다르면 거절, 쓴 만큼 셈', async () => {
  const { f, calls } = fakeOpenai(); const store = memStore();
  const v = createVoice({ store, fetchImpl: f, isAdmin: () => true, userKey: () => 'admin', lang: () => 'en', t: (l, k) => k });
  await v.saveSettings({ apiKey: KEY, mode: 'openai_live' });
  await assert.rejects(v.transcribe({}, Buffer.from('x'), 'audio/webm', 3), /voice_mode_off/);
  await v.saveSettings({ mode: 'openai_turn', voice: 'marin' });
  assert.deepEqual(await v.transcribe({}, Buffer.from('abc'), 'audio/webm;codecs=opus', 3), { text: '안녕하세요' });
  const tr = calls.find((x) => x.url.endsWith('/audio/transcriptions'));
  assert.equal(tr.init.body.get('model'), 'gpt-4o-mini-transcribe'); assert.equal(tr.init.body.get('language'), 'en'); assert.equal(tr.init.body.get('file').name, 'voice.webm');
  const mp3 = await v.speak({}, 'Hello there');
  assert.deepEqual([...mp3], [1, 2, 3]);
  const sp = JSON.parse(calls.find((x) => x.url.endsWith('/audio/speech')).init.body);
  assert.deepEqual([sp.model, sp.voice, sp.input, sp.response_format], ['gpt-4o-mini-tts', 'marin', 'Hello there', 'mp3']);
  await assert.rejects(v.speak({}, ''), /voice_bad_text/);
  assert.ok(v.adminView().usedTodaySec >= 4, '받아쓰기 3초 + 읽기 1초 이상');
});

test('V2 서버: 설정 API로 바꾸면 바로 /v1/voice/config에 반영, 실시간 열쇠는 볼 수 있는 대화만, 받아쓰기·읽기 길, 화면 응답에 키 없음', async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'ieon-v2-'));
  const { f } = fakeOpenai();
  const app = createApp({ dbPath: join(d, 'p.db'), voiceFetch: f, users: [{ tokenSha256: sha('web'), userId: 'u_sinsan', appId: 'app_web' }], devices: [],
    bindings: [{ conversationId: 'c1', ownerUserId: 'u_sinsan', appIds: ['app_web'], hostId: 'h_pc', engine: 'codex_thread', sessionRef: T1, label: '결제 작업' }] });
  const base = `http://127.0.0.1:${await app.listen(0)}`;
  t.after(async () => { await app.close(); rmSync(d, { recursive: true, force: true }); });
  const call = async (path, { method = 'GET', body, raw, type } = {}) => {
    const r = await fetch(base + path, { method, body: raw ?? (body && JSON.stringify(body)), headers: { authorization: 'Bearer web', 'content-type': type ?? 'application/json' } });
    const ct = r.headers.get('content-type') ?? '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), ct };
  };
  assert.equal((await call('/v1/voice/config')).body.mode, 'device');
  const saved = await call('/v1/admin/settings/voice', { method: 'PUT', body: { apiKey: KEY, mode: 'openai_live' } });
  assert.equal(saved.status, 200); assert.equal(saved.body.voiceOpenai.keyHint, '…WXYZ');
  assert.ok(!JSON.stringify((await call('/v1/admin/settings')).body).includes(KEY), '설정 화면 값에 키 원문 없음');
  const cfg = (await call('/v1/voice/config')).body; assert.equal(cfg.live, true); assert.ok(!JSON.stringify(cfg).includes(KEY));
  assert.equal((await call('/v1/voice/live', { method: 'POST', body: { conversationId: 'nope' } })).status, 404, '모르는 대화');
  const s = await call('/v1/voice/live', { method: 'POST', body: { conversationId: 'c1', lang: 'en' } });
  assert.equal(s.status, 200); assert.equal(s.body.clientSecret, 'ek_test_secret'); assert.equal(s.body.callUrl, 'https://api.openai.com/v1/realtime/calls');
  assert.equal((await call(`/v1/voice/live/${s.body.liveId}/tick`, { method: 'POST', body: {} })).body.stop, false);
  assert.equal((await call(`/v1/voice/live/${s.body.liveId}/end`, { method: 'POST', body: {} })).body.ok, true);
  assert.equal((await call('/v1/voice/transcribe?sec=2', { method: 'POST', raw: Buffer.from('abc'), type: 'audio/webm' })).body.error, 'voice_mode_off', '실시간 방식이면 받아쓰기 거절');
  await call('/v1/admin/settings/voice', { method: 'PUT', body: { mode: 'openai_turn' } });
  assert.equal((await call('/v1/voice/config')).body.turn, true, '저장하면 바로 적용');
  assert.equal((await call('/v1/voice/transcribe?sec=2&lang=ko', { method: 'POST', raw: Buffer.from('abc'), type: 'audio/webm' })).body.text, '안녕하세요');
  const sp = await call('/v1/voice/speak', { method: 'POST', body: { text: '읽어 줘' } });
  assert.equal(sp.ct, 'audio/mpeg'); assert.deepEqual([...sp.body], [1, 2, 3]);
  assert.equal((await call('/v1/admin/settings/voice', { method: 'PUT', body: { apiKey: null } })).body.voiceOpenai.configured, false);
  assert.equal((await call('/v1/voice/config')).body.reason, 'voice_no_key', '키를 지우면 이유가 보임');
});

test('V2 화면·앱: 같은 공통 코드(가 도구·나 녹음), 설정 화면 칸, 마이크 버튼이 방식을 따름, 음성 승인 없음', () => {
  const core = readFileSync(join(root, 'src/pilot/web/voice-core.js'), 'utf8');
  for (const s of ['ask_session', 'check_status', 'stop_request', "createDataChannel('oai-events')", 'response.function_call_arguments.done', 'APPROVAL NEEDED', 'Never approve by voice', 'MediaRecorder'])
    assert.ok(core.includes(s), s);
  assert.ok(!/decide|\/v1\/approvals\/[^']/.test(core), '공통 코드는 승인하지 않음(승인 대기만 봄)');
  const copied = build().files['voice-core.ts'];
  assert.equal(readFileSync(join(root, 'app/src/locales/voice-core.ts'), 'utf8').replace(/\r\n/g, '\n'), copied, '앱 복사본이 원본과 같음(app/scripts/copy-locales.mjs)');
  const S = readFileSync(join(root, 'src/pilot/web/settings.html'), 'utf8');
  for (const id of ['voMode', 'voKeyForm', 'voKeyDel', 'voVoice', 'voDaily', 'voIdle', 'voMax', 'voMembers', 'voMemberMin', 'voLiveModel', 'voSttModel', 'voTtsModel']) assert.ok(S.includes(`id="${id}"`), id);
  assert.ok(S.includes("$('voMode').onchange = () => saveVoice("), '바꾸면 바로 저장');
  const A = readFileSync(join(root, 'src/pilot/web/app.html'), 'utf8');
  assert.ok(A.includes('<script src="/voice-core.js"></script>'));
  const mic = A.slice(A.indexOf("$('micBtn').onclick"), A.indexOf("$('compose').onsubmit"));
  assert.ok(mic.includes('await voiceCfg()') && mic.includes('startLive()') && mic.includes('turnListen()'), '누를 때마다 방식을 물음');
  const V = readFileSync(join(root, 'app/src/components/Voice.tsx'), 'utf8');
  assert.ok(V.includes('import IeonVoiceCore from "../locales/voice-core"') && V.includes('api.voiceConfig(lang)'));
  const C = readFileSync(join(root, 'app/src/components/Chat.tsx'), 'utf8');
  assert.ok(C.includes('useVoice({ api, conversationId: id, ask:') && C.includes('<LiveBar v={v} />'));
});
