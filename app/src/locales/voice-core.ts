// 자동 생성(app/scripts/copy-locales.mjs) — 원본 src/pilot/web/voice-core.js
// @ts-nocheck
// V2 OpenAI 음성 공통 코드(설계 docs/design/VOICE_LIVE.md) — 웹 대화 화면(/voice-core.js)과 이어온 앱(app/scripts/copy-locales.mjs가
// app/src/lib/voice-core.ts로 복사)이 같이 쓴다. 화면 글은 여기 없다(상태 코드만 알리고 화면이 사전으로 보여 줌).
// 가(live): OpenAI Realtime에 WebRTC로 바로 붙고, 작업 이야기는 ask_session 도구로 이어온 질문 API에 넘긴다(대답은 세션).
// 나(turn): 말하는 동안 실시간 받아쓰기(gpt-live-transcribe, 안 되면 녹음 한 번 → 서버 받아쓰기), 답 글 → 서버 목소리(WAV) 재생.
// 소리·글은 어디에도 저장하지 않는다. 음성으로 승인하지 않는다(승인은 화면 카드).
const IeonVoiceCore = (() => {
  const DONE = ['completed', 'failed', 'unknown', 'cancelled', 'approval_required'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const err = (code) => Object.assign(new Error(code), { code });

  // 가 — 실시간 대화. o: { api, conversationId, lang, onState(state, info), onEnd(why), onQuestion(requestId) }
  // api: live(conversationId, lang) · tick(liveId) · end(liveId) · ask(question) → requestId · request(requestId) → { status, answer, errorCode }
  //      · stop(requestId) · approvals() → [{ requestId }]
  async function startLive(o) {
    const api = o.api; const state = (s, info) => { try { o.onState?.(s, info); } catch { /* 화면 오류 무시 */ } };
    state('connecting');
    let mic;
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { throw err('voice_mic'); }
    let s;
    try { s = await api.live(o.conversationId, o.lang); } catch (e) { mic.getTracks().forEach((t) => t.stop()); throw e; }
    const pc = new RTCPeerConnection();
    const audio = document.createElement('audio'); audio.autoplay = true; audio.setAttribute('playsinline', '');
    pc.ontrack = (e) => { audio.srcObject = e.streams[0]; };
    const track = mic.getAudioTracks()[0]; pc.addTrack(track, mic);
    const dc = pc.createDataChannel('oai-events');
    let ended = false, pending = null, lastActivity = Date.now(), speaking = false, tickTimer = null, idleTimer = null, remainingSec = s.remainingSec;
    const send = (ev) => { if (dc.readyState === 'open') dc.send(JSON.stringify(ev)); };
    const respond = () => send({ type: 'response.create' });
    const note = (text) => { send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } }); respond(); };
    const toolOut = (callId, out) => { send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(out) } }); respond(); };
    const busyState = () => state(pending ? 'waiting' : speaking ? 'speaking' : 'listening', { remainingSec });

    async function watch(requestId) {
      let approvalTold = false;
      while (!ended && pending?.requestId === requestId) {
        await sleep(2000);
        let r; try { r = await api.request(requestId); } catch { continue; }
        if (DONE.includes(r.status)) {
          pending = null; lastActivity = Date.now();
          if (r.status === 'approval_required') note('APPROVAL NEEDED: the session stopped and is waiting for the user to approve on the screen card. Ask them to press the button on the screen. Never approve by voice.');
          else if (r.status === 'completed') note('SESSION ANSWER (summarize for the user in their language, 1-3 sentences; the full answer is on the screen):\n' + String(r.answer ?? '').slice(0, 6000));
          else note('SESSION RESULT: ' + r.status + (r.errorCode ? ' (' + r.errorCode + ')' : '') + '. Tell the user briefly; the details are on the screen.');
          busyState(); return;
        }
        if (!approvalTold && api.approvals) {
          try { if ((await api.approvals()).some((a) => a.requestId === requestId)) { approvalTold = true; note('APPROVAL NEEDED: the session is waiting for the user to approve on the screen card. Ask them to press the button on the screen. Never approve by voice.'); } } catch { /* 다음에 */ }
        }
      }
    }
    async function tool(name, callId, args) {
      lastActivity = Date.now();
      if (name === 'ask_session') {
        const q = String(args?.question ?? '').trim();
        if (!q) return toolOut(callId, { error: 'empty_question' });
        if (pending) return toolOut(callId, { busy: true, note: 'A question is still being answered. Wait or stop it.' });
        try {
          const requestId = await api.ask(q);
          pending = { requestId }; o.onQuestion?.(requestId); busyState();
          toolOut(callId, { sent: true, note: 'Sent to the work session. Tell the user you are waiting; the answer will arrive as a system message.' });
          watch(requestId);
        } catch (e) { toolOut(callId, { sent: false, error: e?.code || e?.message || 'failed' }); }
        return;
      }
      if (name === 'check_status') {
        if (!pending) return toolOut(callId, { pending: false });
        let r = null; try { r = await api.request(pending.requestId); } catch { /* 모름 */ }
        return toolOut(callId, { pending: true, status: r?.status ?? 'unknown' });
      }
      if (name === 'stop_request') {
        if (!pending) return toolOut(callId, { stopped: false, note: 'Nothing is running.' });
        try { await api.stop(pending.requestId); return toolOut(callId, { stopped: true }); } catch (e) { return toolOut(callId, { stopped: false, error: e?.code || 'failed' }); }
      }
      toolOut(callId, { error: 'unknown_tool' });
    }
    dc.onmessage = (m) => {
      let ev; try { ev = JSON.parse(m.data); } catch { return; }
      switch (ev.type) {
        case 'input_audio_buffer.speech_started': lastActivity = Date.now(); speaking = false; state('hearing', { remainingSec }); break;
        case 'input_audio_buffer.speech_stopped': lastActivity = Date.now(); busyState(); break;
        case 'output_audio_buffer.started': case 'response.output_audio.delta': lastActivity = Date.now(); if (!speaking) { speaking = true; busyState(); } break;
        case 'output_audio_buffer.stopped': case 'response.done': lastActivity = Date.now(); speaking = false; busyState(); break;
        case 'response.function_call_arguments.done': { let a = {}; try { a = JSON.parse(ev.arguments || '{}'); } catch { /* 빈 값 */ } tool(ev.name, ev.call_id, a); break; }
        case 'error': state('error', { code: ev.error?.code || 'voice_openai_failed' }); break;
        default: break;
      }
    };
    async function hangup(why = 'user') {
      if (ended) return; ended = true;
      clearInterval(tickTimer); clearInterval(idleTimer);
      try { dc.close(); } catch { /* 이미 닫힘 */ }
      try { pc.close(); } catch { /* 이미 닫힘 */ }
      mic.getTracks().forEach((t) => t.stop()); audio.srcObject = null;
      try { await api.end(s.liveId); } catch { /* 서버가 나중에 정리 */ }
      state('ended', { why }); o.onEnd?.(why);
    }
    try {
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      const r = await fetch(s.callUrl, { method: 'POST', body: offer.sdp, headers: { authorization: 'Bearer ' + s.clientSecret, 'content-type': 'application/sdp' } });
      if (!r.ok) throw err(r.status === 401 ? 'voice_key_rejected' : 'voice_connect_failed');
      await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
    } catch (e) { await hangup('error'); throw e.code ? e : err('voice_connect_failed'); }
    dc.onopen = () => { lastActivity = Date.now(); busyState(); };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState) && !ended) hangup('lost'); };
    tickTimer = setInterval(async () => {
      try { const t = await api.tick(s.liveId); remainingSec = t.remainingSec; if (t.stop) hangup('limit'); else busyState(); } catch { /* 다음 tick */ }
    }, (s.tickSec || 30) * 1000);
    idleTimer = setInterval(() => { if (!pending && !speaking && Date.now() - lastActivity > (s.idleSec || 60) * 1000) hangup('idle'); }, 5000);
    return { hangup, mute: (on) => { track.enabled = !on; }, info: () => ({ remainingSec, pending: Boolean(pending), maxSec: s.maxSec }) };
  }

  // 나 — 실시간 받아쓰기(gpt-live-transcribe, 2026-11-23). 말하는 동안 글이 onText(지금까지 글)로 들어온다.
  // stop()을 부르면 마지막 소리까지 받아 { text, sec }. maxSec이 지나면 done이 끝나므로 부른 쪽이 stop()한다(record와 같은 모양).
  // o: { api: { dictate(lang) → { dictateId, clientSecret, callUrl, maxSec }, end(dictateId) }, lang, onText(text) }
  async function dictate(o) {
    let mic; try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { throw err('voice_mic'); }
    let s; try { s = await o.api.dictate(o.lang); } catch (e) { mic.getTracks().forEach((t) => t.stop()); throw e; }
    const pc = new RTCPeerConnection();
    pc.addTrack(mic.getAudioTracks()[0], mic);
    const dc = pc.createDataChannel('oai-events');
    const order = [], finals = new Map(); let partial = '', closed = false, waiting = null, failed = null;
    const text = () => [...order.map((id) => finals.get(id) ?? ''), partial].join(' ').replace(/\s+/g, ' ').trim();
    const show = () => { try { o.onText?.(text()); } catch { /* 화면 오류 무시 */ } };
    const keep = (id) => { if (id && !order.includes(id)) order.push(id); };
    dc.onmessage = (m) => {
      let ev; try { ev = JSON.parse(m.data); } catch { return; }
      if (ev.type === 'input_audio_buffer.committed') keep(ev.item_id);
      else if (ev.type === 'conversation.item.input_audio_transcription.delta') { partial += ev.delta || ''; show(); }
      else if (ev.type === 'conversation.item.input_audio_transcription.completed') { keep(ev.item_id); finals.set(ev.item_id, String(ev.transcript ?? '').trim()); partial = ''; show(); waiting?.(); }
      else if (ev.type === 'conversation.item.input_audio_transcription.failed' || ev.type === 'error') { failed = ev.error?.code || 'voice_openai_failed'; waiting?.(); }
    };
    const started = Date.now(); let limit = null;
    async function close() {
      if (closed) return; closed = true; clearTimeout(limit);
      try { dc.close(); } catch { /* 이미 닫힘 */ }
      try { pc.close(); } catch { /* 이미 닫힘 */ }
      mic.getTracks().forEach((t) => t.stop());
      try { await o.api.end(s.dictateId); } catch { /* 서버가 나중에 정리 */ }
    }
    try {
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      const r = await fetch(s.callUrl, { method: 'POST', body: offer.sdp, headers: { authorization: 'Bearer ' + s.clientSecret, 'content-type': 'application/sdp' } });
      if (!r.ok) throw err(r.status === 401 ? 'voice_key_rejected' : 'voice_connect_failed');
      await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
    } catch (e) { await close(); throw e.code ? e : err('voice_connect_failed'); }
    let hitLimit; const done = new Promise((r) => { hitLimit = r; });
    limit = setTimeout(() => hitLimit(), (s.maxSec || 60) * 1000);
    async function stop() {
      if (closed) return { text: text(), sec: Math.round((Date.now() - started) / 1000) };
      await sleep(400); // 아직 오는 중인 마지막 소리
      const got = new Promise((r) => { waiting = r; setTimeout(r, 8000); });
      if (dc.readyState === 'open') dc.send(JSON.stringify({ type: 'input_audio_buffer.commit' })); else waiting();
      await got; waiting = null;
      const out = { text: text(), sec: Math.round((Date.now() - started) / 1000) };
      await close();
      if (!out.text && failed && failed !== 'input_audio_buffer_commit_empty') throw err(failed);
      return out;
    }
    return { stop, done };
  }

  // 나 — 녹음 한 번(예전 방식 — 실시간 받아쓰기를 못 쓸 때). stop()을 부르거나 maxSec이 지나면 끝. → { blob, type, sec }
  async function record(maxSec = 60) {
    let mic; try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { throw err('voice_mic'); }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((x) => window.MediaRecorder?.isTypeSupported?.(x)) || '';
    let rec; try { rec = new MediaRecorder(mic, type ? { mimeType: type } : undefined); } catch { mic.getTracks().forEach((t) => t.stop()); throw err('voice_mic'); }
    const chunks = []; const started = Date.now();
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const done = new Promise((resolve) => { rec.onstop = () => { mic.getTracks().forEach((t) => t.stop()); const bt = rec.mimeType || type || 'audio/webm'; resolve({ blob: new Blob(chunks, { type: bt }), type: bt, sec: Math.round((Date.now() - started) / 1000) }); }; });
    rec.start();
    const timer = setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, maxSec * 1000);
    return { stop: () => { clearTimeout(timer); if (rec.state !== 'inactive') rec.stop(); return done; }, done };
  }
  // 나 — 서버 목소리 재생(WAV, 예전 서버는 mp3). 끝나면 resolve. 돌려준 stop()으로 멈춤
  let playing = null;
  function play(buf) {
    stopPlay();
    const riff = buf && buf.byteLength >= 4 && String.fromCharCode(...new Uint8Array(buf, 0, 4)) === 'RIFF';
    const url = URL.createObjectURL(new Blob([buf], { type: riff ? 'audio/wav' : 'audio/mpeg' }));
    const a = new Audio(url); playing = a;
    const done = new Promise((resolve) => { a.onended = a.onerror = () => { URL.revokeObjectURL(url); if (playing === a) playing = null; resolve(); }; });
    a.play().catch(() => {});
    return done;
  }
  function stopPlay() { if (playing) { try { playing.pause(); } catch { /* 없음 */ } playing = null; } }

  return { startLive, dictate, record, play, stopPlay };
})();
if (typeof window !== 'undefined') window.IeonVoiceCore = IeonVoiceCore;
export default IeonVoiceCore;
