// 메신저 공통 처리. 메신저별 연결(텔레그램·디스코드·슬랙)은 메시지를 이 모듈에 넘기고, 돌려받은 글을 보낸다.
// - 허용 목록에 없는 발신자는 /whoami 외에는 응답하지 않는다(처음 설정할 때 내 ID 확인용).
// - 대화방마다 세션 하나를 연결하거나(/use), 1:1 대화에서 /use로 대상 세션을 고른다.
// - 질문은 이어온 서버 API로만 넣는다. 결과 불명이면 다시 보내지 않고 /review로 정리한다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_BOT, migrateRooms } from '../bots.mjs';

const MAX_CHUNK = { telegram: 3800, discord: 1900, slack: 3800, kakao: 950, line: 4800 };
const ERR = {
  conversation_busy: '이 세션에서 처리 중인 질문이 있어 보낼 수 없음',
  device_unavailable: 'PC 연결이 끊겨 보낼 수 없음',
  hub_mode: '이 PC는 허브에 연결돼 있어 여기서 받은 질문은 처리하지 않음 — 허브에 연결된 봇이나 허브 화면에서 보내기',
  desktop_holds_thread: 'Desktop에서 이 대화를 열고 있어 보내지 않았음 — Desktop에서 대화를 닫고 다시 보내기',
  thread_busy: '공유 서버에서 이 대화가 사용 중이라 보내지 않았음',
  thread_not_open: '공유 서버에 이 대화가 열려 있지 않음',
  shared_server_down: '공유 App Server가 꺼져 있음',
  session_not_running: '세션이 실행 중이 아님',
  live_disabled: '연결부에서 실제 실행이 꺼져 있음',
  thread_not_allowed: '허용되지 않은 대화',
  session_archived: '보관된 세션 — /restore <이름>으로 꺼낸 뒤 질문하세요',
  active_limit: '새 세션 질문을 동시에 처리할 수 있는 수를 넘음 — 잠시 후 다시 보내기',
  session_forked: '같은 Claude 세션을 터미널에서 열고 있어 결과를 확인할 수 없음',
  usage_limit: '계정의 사용 한도에 걸려 실행되지 않았음',
  account_not_logged_in: '고른 이어온 계정이 로그인돼 있지 않아 보내지 않았음(이어온 화면 → 설정 → 계정에서 로그인)',
  account_missing: '고른 이어온 계정이 없어 보내지 않았음(이어온 화면 → 설정 → 계정에서 다시 고르기)',
};
// 새 세션 만들기·정리 명령의 거절 사유
const NS_ERR = {
  new_sessions_disabled: '새 세션 만들기가 꺼져 있음(설정 enabled)',
  app_not_allowed: '이 앱에서는 새 세션을 만들 수 없음(설정 creatorApps)',
  bad_name: '이름은 영문·숫자·- 2~32자(앞뒤는 영문·숫자)',
  bad_engine: '엔진은 codex 또는 claude',
  unknown_profile: '없는 권한 프로필',
  profile_not_allowed: 'full 권한은 메신저에서 고를 수 없음 — PC 설정 파일의 sessionOverrides로만 지정',
  name_taken: '같은 이름의 세션이 이미 있음',
  session_limit: '세션 수 한도를 넘음 — /archived·/close로 정리',
  engine_limit: '이 엔진의 세션 수 한도를 넘음',
  not_active: '깨어 있는 세션이 아님',
  not_archived: '보관된 세션이 아님',
  conversation_busy: '처리 중이거나 확인 필요 질문이 있음',
  confirm_mismatch: '이름 확인이 맞지 않음',
  engine_not_allowed_for_role: '이 봇의 역할로는 그 엔진을 만들 수 없음',
  profile_not_allowed_for_role: '이 봇의 역할로는 그 권한을 고를 수 없음',
};
const STATE = { pending: '첫 질문 전', active: '깨어 있음', sleeping: '잠듦', archived: '보관됨' };

// 메시지 맨 앞의 부르는 이름을 찾는다: "리뷰, …" · "리뷰: …" · "리뷰야 …" · "@리뷰 …" · "리뷰"만. 찾으면 이름을 떼고 나머지를 돌려준다.
export function stripCallName(text, names) {
  const t = String(text ?? '').trimStart();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const n of [...names].map((x) => String(x).trim()).filter(Boolean).sort((a, b) => b.length - a.length)) {
    const m = t.match(new RegExp(`^@?${esc(n)}(?:야|아)?(?:[,:，]\\s*|\\s+|$)`, 'i'));
    if (m) return { called: true, text: t.slice(m[0].length).trim() };
  }
  return { called: false, text };
}

export function splitText(text, max) {
  const out = [];
  let rest = String(text ?? '');
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.length || !out.length) out.push(rest);
  return out;
}

// opts: { api({method, path, body, headers}) → {status, body}, allowedUsers: {telegram:[], …}, roomsPath, pollMs, waitMs }
export function createBridge(opts) {
  const pollMs = opts.pollMs ?? 2000;
  const waitMs = opts.waitMs ?? 300000;
  // 대화방 연결은 봇마다 따로다. 옛 형식(봇 구분 없음)은 처음 읽을 때 default 봇 것으로 바꿔 저장한다(MULTI_BOTS 3-4).
  // 여러 봇이 함께 쓰도록 roomStore({ rooms, save })를 넘겨받을 수 있다(키에 봇 ID가 있어 겹치지 않음).
  let roomStore = opts.roomStore;
  if (!roomStore) {
    const loaded = migrateRooms(existsSync(opts.roomsPath) ? JSON.parse(readFileSync(opts.roomsPath, 'utf8')) : {});
    roomStore = { rooms: loaded.data.rooms, save: () => writeFileSync(opts.roomsPath, JSON.stringify({ _v: 2, rooms: roomStore.rooms }, null, 2)) };
    if (loaded.changed && existsSync(opts.roomsPath)) roomStore.save();
  }
  const rooms = roomStore.rooms;
  const saveRooms = () => roomStore.save();
  const allowed = opts.isAllowed ?? ((m) => (opts.allowedUsers?.[m.platform] ?? []).map(String).includes(String(m.userId)));
  // W2: 승인(허용·거부)은 주인만 — 봇마다 더한 사람(extraUsers)이 아니라 공통 허용 사용자(사용자 본인)
  const isOwner = opts.isOwner ?? ((m) => (opts.allowedUsers?.[m.platform] ?? []).map(String).includes(String(m.userId)));
  // RC1: 승인 번호(n)는 서버가 대화마다 매긴다 — 메신저를 다시 켜도 /허용 n 이 같은 승인을 가리킨다(전에는 이 프로그램 메모리에만 있었음).
  const EXEC_WORD = { completed: '실행 완료', failed: '실행 실패', unknown: '실행 결과를 확인하지 못함' };
  // 서버가 예전 버전이라 카드에 번호가 없을 때만 쓰는 대비용 번호(대화방 → [{ n, approvalId }], 이 프로그램 메모리)
  const roomApprovals = new Map();
  const roomKey = (m) => `${m.platform}:${m.botId ?? opts.botId ?? DEFAULT_BOT}:${m.chatId}${m.threadKey ? `:${m.threadKey}` : ''}`;
  const channelKey = (m) => roomKey({ ...m, threadKey: undefined });
  // 슬랙 스레드는 자기 연결이 있으면 그것, 없으면 채널 연결을 따른다(전에는 스레드를 나누지 않아 모두 채널 연결이었음 — 그 동작 보존).
  // 텔레그램 주제(topic)는 전부터 따로였고 채널 연결을 따르지 않는다.
  const roomConv = (m) => rooms[roomKey(m)] ?? (m.platform === 'slack' && m.threadKey ? rooms[channelKey(m)] : undefined);
  const log = opts.log ?? (() => {});
  // 같은 원본 메시지는 한 번만(메신저 재전송·재접속) — 프로그램 안에서는 10분 기억, 다시 켠 뒤에는 같은 요청 열쇠로 서버가 막음
  const seen = new Map();
  const botOf = (m) => m.botId ?? opts.botId ?? DEFAULT_BOT;
  const seenBefore = (m) => {
    if (!m.msgId) return false;
    const k = `${m.platform}:${botOf(m)}:${m.msgId}`;
    for (const [x, at] of seen) if (Date.now() - at > 10 * 60_000) seen.delete(x);
    if (seen.has(k)) return true;
    seen.set(k, Date.now()); return false;
  };
  const idemKey = (m) => (m.msgId ? 'msg-' + createHash('sha256').update(`${m.platform}:${botOf(m)}:${m.msgId}`).digest('hex').slice(0, 40) : `msg-${randomUUID()}`);
  // 엔진 실행 완료와 답 전달 완료를 나눈다: 대화방 → { requestId, label, delivered }
  const lastAnswer = new Map();
  const retryMs = opts.deliverRetryMs ?? 2000;
  // 안내 글은 못 보내도 처리를 멈추지 않는다(기록만, 내용 없이)
  const safeSend = async (m, send, text) => { try { await send(text); return true; } catch (e) { log({ platform: m.platform, event: 'send_failed', error: String(e.message).slice(0, 40) }); return false; } };
  // 답 전달: 잠깐 실패(retryable)는 두 번 더 해 보고, 끝내 실패하면 기록하고 /last로 다시 받게 한다. 엔진은 다시 돌리지 않는다.
  async function deliver(m, send, conv, requestId, answer) {
    const parts = splitText(answer ?? '(보관하지 않은 답변)', MAX_CHUNK[m.platform] ?? 1900);
    for (const part of parts) {
      for (let attempt = 0; ; attempt++) {
        try { await send(part); break; } catch (e) {
          if (e.retryable && attempt < 2) { await new Promise((ok) => setTimeout(ok, retryMs * (attempt + 1))); continue; }
          lastAnswer.set(roomKey(m), { requestId, label: conv.label, delivered: false });
          log({ platform: m.platform, event: 'deliver_failed', requestId, error: String(e.message).slice(0, 40) });
          await safeSend(m, send, `[${conv.label}] 답을 보내지 못했어요(${String(e.message).slice(0, 30)}) — 엔진은 다시 돌리지 않아요. /last 로 다시 받을 수 있어요`);
          return false;
        }
      }
    }
    lastAnswer.set(roomKey(m), { requestId, label: conv.label, delivered: true });
    return true;
  }

  async function sessions() {
    const r = await opts.api({ method: 'GET', path: '/v1/conversations' });
    return r.status === 200 ? r.body.conversations : [];
  }
  const lastSend = new Map(); // 대화방 → 마지막으로 쓴 send(보관 예고를 그 방에 보내기 위해)
  let noticeAfter = new Date().toISOString();
  const byName = (all, name) => all.find((c) => c.newSession?.name === name);
  const nsFail = (r) => NS_ERR[r.body?.error] ?? `할 수 없음: ${r.body?.error}`;
  const describe = (c, i) => {
    const engine = c.engine === 'claude_channel' ? 'Claude' : c.engine === 'claude_cli' ? 'Claude(새 세션)' : c.engine === 'agy_cli' ? 'Antigravity' : c.engine === 'grok_cli' ? 'Grok' : `Codex(${c.connectMode === 'shared_server' ? '동시 사용' : '번갈아 쓰기'})`;
    const ns = c.newSession ? ` · 새 세션 ${STATE[c.newSession.state] ?? c.newSession.state}` : '';
    const state = !c.deviceOnline ? 'PC 연결 끊김' : c.heldBy ? '확인 필요' : c.engineReady === false ? '엔진 꺼짐' : c.busy ? '처리 중' : '보낼 수 있음';
    // 어느 PC·작업 모드인지도 보이게(허브는 PC 이름을 알려 줌)
    const where = `${c.host?.name ? ` · PC ${c.host.name}` : ''}${c.workMode ? ' · 작업 모드' : ''}`;
    return `${i + 1}. ${c.label} — ${engine} · ${state}${where}${ns}${c.account?.label ? `\n   계정: ${c.account.label}` : ''}`;
  };

  async function ask(m, conv, question, send) {
    const r = await opts.api({
      method: 'POST', path: `/v1/conversations/${conv.conversationId}/requests`,
      headers: { 'idempotency-key': idemKey(m) }, body: { question },
    });
    if (r.status !== 202) return safeSend(m, send, `[${conv.label}] ${ERR[r.body?.error] ?? `보낼 수 없음: ${r.body?.error}`}`);
    lastAnswer.set(roomKey(m), { requestId: r.body.requestId, label: conv.label, delivered: null, askedBy: String(m.userId) });
    // RC3: 작업 열기 링크(서버가 공개 웹 주소를 알 때만 — 열면 로그인·권한을 먼저 확인)
    await safeSend(m, send, `[${conv.label}] 접수됨 — 답을 기다리는 중${conv.workMode ? ' (작업 모드: 파일 수정·명령 실행은 허용을 물어봐요)' : ''}${r.body.taskUrl ? `
작업 보기: ${r.body.taskUrl}` : ''}`);
    const started = Date.now();
    const announced = new Set();
    const told = new Set(); // 실행 결과를 알린 승인(RC1)
    // 작업 모드는 승인을 기다리는 동안(최대 15분) 더 오래 기다린다
    const limit = conv.workMode ? Math.max(waitMs, 20 * 60_000) : waitMs;
    while (Date.now() - started < limit) {
      await new Promise((ok) => setTimeout(ok, pollMs));
      const s = (await opts.api({ method: 'GET', path: `/v1/requests/${r.body.requestId}` })).body;
      // W2: 처리 중 승인 요청이 오면 이 대화방에 알리고 /허용 n · /거부 n 으로 받는다(이번 한 번만, 주인만)
      // RC1: 허용한 뒤의 실제 실행 결과(완료·실패·결과 불명)도 같은 대화방에 한 번 알린다. 차례가 끝난 직후에도 한 번 더 본다.
      if (conv.workMode && (['running', 'dispatching'].includes(s.status) || announced.size > told.size)) {
        const cards = (await opts.api({ method: 'GET', path: `/v1/conversations/${conv.conversationId}/cards` }).catch(() => null))?.body?.cards ?? [];
        for (const k of cards.filter((x) => x.kind === 'approval' && !announced.has(x.approvalId))) {
          announced.add(k.approvalId);
          const what = { command: '명령 실행', file: '파일 수정', permissions: '권한 추가' }[k.approvalKind] ?? '허용 요청';
          let n = k.n;
          if (!Number.isInteger(n)) { const list = roomApprovals.get(roomKey(m)) ?? []; n = (list.at(-1)?.n ?? 0) + 1; list.push({ n, approvalId: k.approvalId }); roomApprovals.set(roomKey(m), list.slice(-20)); }
          await safeSend(m, send, `[${conv.label}] 승인 요청 ${n}: ${what} — ${k.summary}${k.cwd ? ` (작업 폴더 ${k.cwd})` : ''}\n허용: /허용 ${n}   거부: /거부 ${n}   (15분 안에, 이번 한 번만)`);
        }
        for (const k of cards.filter((x) => x.kind === 'approval_result' && x.requestId === r.body.requestId && EXEC_WORD[x.state] && !told.has(x.approvalId))) {
          told.add(k.approvalId);
          await safeSend(m, send, `[${conv.label}] 승인 요청 ${k.n}: ${EXEC_WORD[k.state]}${k.state === 'failed' && Number.isInteger(k.exitCode) ? `(종료 코드 ${k.exitCode})` : ''}`);
        }
      }
      if (s.status === 'completed') return deliver(m, send, conv, r.body.requestId, s.answer);
      // A1: 한도는 어느 계정인지와 고를 수 있는 길을 함께(실행 안 됨이 확실 — 잠그지 않음, 자동으로 다시 보내지 않음).
      if (s.status === 'failed' && s.errorCode === 'usage_limit') {
        return safeSend(m, send, `[${conv.label}] ${ERR.usage_limit} — 지금 쓰는 계정: ${conv.account?.label ?? '알 수 없음'}. 한도가 풀린 뒤 같은 질문을 다시 보내거나, 등록해 둔 다른 계정으로 바꾸세요(이어온 화면 → 설정 → 계정).`);
      }
      if (s.status === 'failed') return safeSend(m, send, `[${conv.label}] ${ERR[s.errorCode] ?? `실행 실패: ${s.errorCode}`}`);
      if (s.status === 'unknown') {
        return safeSend(m, send, `[${conv.label}] 결과를 확인할 수 없음${s.errorCode === 'turn_joined_by_other_input' ? '(TUI 입력이 합류했을 수 있음)' : ''} — 자동으로 다시 보내지 않습니다. 원래 세션을 확인한 뒤 /review done 또는 /review not`);
      }
      if (s.status === 'approval_required') return safeSend(m, send, `[${conv.label}] 원래 세션에서 권한 확인이 필요해 멈춤 — 처리 후 /review done 또는 /review not`);
      // RC2: 사람이 이 질문만 멈춤(엔진 차례가 끝난 것까지 확인됨)
      if (s.status === 'cancelled') return safeSend(m, send, `[${conv.label}] 중지됨 — 이 질문만 멈췄어요(다시 보내지 않음)`);
    }
    return safeSend(m, send, `[${conv.label}] 아직 답이 없음 — 끝나면 /last로 받을 수 있어요(다시 실행하지 않음)`);
  }

  // 그 대화방에서 다른 우리 봇이 세션에 연결돼 있는지(키 "<메신저>:<봇>:<대화방>[:<주제>]"의 대화방 부분이 같은 것).
  const otherBotConnected = (m) => {
    const [platform, bot, ...rest] = roomKey(m).split(':');
    const suffix = rest.join(':');
    return Object.keys(rooms).some((k) => { const [p, b, ...r] = k.split(':'); return p === platform && b !== bot && r.join(':') === suffix; });
  };
  const info = () => opts.botInfo?.() ?? {};

  // m: { platform, botId?, userId, chatId, threadKey?, text, isGroup?, called?, forOther? }, send(text) → Promise
  async function handle(m, send) {
    if (m.forOther) return; // /명령@다른 봇
    if (seenBefore(m)) return log({ platform: m.platform, event: 'duplicate' }); // 같은 원본 메시지가 다시 옴
    const bot = info();
    // 부르는 이름이 없으면 봇 ID로 부를 수 있다.
    const call = stripCallName(m.text, bot.callNames?.length ? bot.callNames : [m.botId ?? opts.botId ?? DEFAULT_BOT]);
    let text = (call.called ? call.text : String(m.text ?? '')).trim();
    // 슬랙은 /명령을 앱이 가로채므로 !명령을 쓴다. 부르는 이름을 뗀 뒤에도 같은 뜻으로 바꾼다.
    if (m.platform === 'slack') text = text.replace(/^!(\w+)/, '/$1');
    if (!text) return;
    // 같은 메신저의 다른 우리 봇을 멘션했거나 그 봇 스레드에 답장했고 이 봇은 안 불렸으면 그 봇 것이다(슬랙).
    const others = new Set(bot.otherBotUserIds ?? []);
    if (m.isGroup && !m.called && !call.called
      && ((m.mentionIds ?? []).some((id) => others.has(id)) || (m.parentUserId && others.has(m.parentUserId)))) return;
    // 같은 메신저의 다른 우리 봇 부르는 이름으로 시작하면 그 봇 것이다(이 봇 이름이 아닐 때).
    if (m.isGroup && !m.called && !call.called && stripCallName(m.text, bot.otherCallNames ?? []).called) return;
    // 그룹·채널에서는 부른 봇만 답한다. 부르지 않았어도 그 방에 연결된 우리 봇이 이 봇뿐(또는 아무도 없음)이면 받는다.
    if (m.isGroup && !m.called && !call.called && otherBotConnected(m)) return;
    if (/^\/whoami\b/.test(text)) {
      return send(`플랫폼: ${m.platform}\n봇 ID: ${m.botId ?? opts.botId ?? DEFAULT_BOT}${bot.name ? `\n봇 이름: ${bot.name}` : ''}${bot.role ? `\n역할: ${bot.role.name}` : ''}${bot.callNames?.length ? `\n부르는 이름: ${bot.callNames.join(', ')}` : ''}\n사용자 ID: ${m.userId}\n대화방: ${roomKey(m)}\n허용 여부: ${allowed(m) ? '허용됨' : '허용 목록에 없음'}`);
    }
    if (!allowed(m)) return; // 허용되지 않은 발신자에게는 아무것도 하지 않는다.
    lastSend.set(roomKey(m), send);
    const all = await sessions();
    // 보관된 새 세션은 목록·번호에서 빼고 /archived로 따로 본다.
    const list = all.filter((c) => c.newSession?.state !== 'archived');
    let current = list.find((c) => c.conversationId === roomConv(m));
    // 역할의 기본 세션: 연결이 없는 대화방이면 /use 없이 그 세션에 연결한다(이 봇이 볼 수 있는 세션일 때만).
    if (!current && bot.role?.defaultSession && !/^\/(help|start|sessions|use|new)\b/.test(text)) {
      const d = list.find((c) => c.conversationId === bot.role.defaultSession);
      if (d) {
        rooms[roomKey(m)] = d.conversationId;
        saveRooms();
        current = d;
        await send(`이 대화방을 기본 세션 "${d.label}"에 연결했습니다(${bot.role.name} 역할). 바꾸려면 /sessions 후 /use <번호>.`);
      }
    }

    if (/^\/(help|start)\b/.test(text)) {
      const head = bot.name ? `${bot.name}${bot.role ? ` · ${bot.role.name}${bot.role.description ? ` — ${bot.role.description}` : ''}` : ''}${bot.callNames?.length ? `\n그룹에서 부르기: "${bot.callNames[0]}, …" 또는 @멘션` : ''}\n\n` : '';
      return send(head + '명령어\n/sessions 세션 목록\n/use <번호> 이 대화방을 그 세션에 연결\n/status 연결된 세션 상태\n/review done|not 확인 필요 질문 정리\n'
        + '/new codex|claude <이름> [read_only|workspace] 새 세션을 만들고 이 대화방에 연결\n/sleep <이름> 잠재우기\n/archived 보관 목록\n'
        + '/restore <이름> 보관에서 꺼내기\n/close <이름> 삭제(확인 단계 있음)\n/limits 세션 수와 한도\n/허용 <번호> · /거부 <번호> 작업 모드 승인 요청에 답하기(주인만)\n/last 마지막 답 다시 받기(다시 실행하지 않음)\n/stop 이 대화방의 마지막 질문만 멈추기(물어본 사람·주인)\n/whoami 내 ID\n그 밖의 글은 연결된 세션에 질문으로 보냅니다.');
    }
    const create = text.match(/^\/new\s+(codex|claude)\s+(\S+)(?:\s+(\S+))?\s*$/);
    if (create) {
      const r = await opts.api({ method: 'POST', path: '/v1/sessions', body: { engine: create[1], name: create[2], ...(create[3] ? { profile: create[3] } : {}) } });
      if (r.status !== 201) return send(`새 세션을 만들 수 없음: ${nsFail(r)}${r.body?.allowed ? ` (가능: ${r.body.allowed.join(', ')})` : ''}`);
      rooms[roomKey(m)] = r.body.conversationId;
      saveRooms();
      return send(`새 ${create[1] === 'codex' ? 'Codex' : 'Claude'} 세션 "${r.body.name}"(권한 ${r.body.profile})을 만들고 이 대화방에 연결했습니다. 첫 질문을 보내면 시작합니다.`);
    }
    if (/^\/new\b/.test(text)) return send('사용법: /new codex|claude <이름> [read_only|workspace]');
    if (/^\/limits\b/.test(text)) {
      const r = await opts.api({ method: 'GET', path: '/v1/sessions/limits' });
      if (r.status !== 200) return send(nsFail(r));
      const l = r.body;
      return send(`새 세션 ${l.sessions}/${l.maxSessions} (Codex ${l.perEngine.codex}/${l.maxPerEngine.codex}, Claude ${l.perEngine.claude}/${l.maxPerEngine.claude}) · 동시 처리 ${l.maxActive}`);
    }
    if (/^\/archived\b/.test(text)) {
      const arch = all.filter((c) => c.newSession?.state === 'archived');
      return send(arch.length ? `보관된 세션\n${arch.map((c) => `- ${c.newSession.name}`).join('\n')}\n꺼내기: /restore <이름>` : '보관된 세션 없음');
    }
    const act = text.match(/^\/(sleep|restore)\s+(\S+)\s*$/);
    if (act) {
      const c = byName(all, act[2]);
      if (!c) return send(`"${act[2]}" 새 세션이 없음`);
      const r = await opts.api({ method: 'POST', path: `/v1/sessions/${c.conversationId}/${act[1]}` });
      return send(r.status === 200 ? `"${act[2]}" ${act[1] === 'sleep' ? '잠재움(질문하면 다시 깨어남)' : '보관에서 꺼냄'}` : nsFail(r));
    }
    const close = text.match(/^\/close\s+(\S+)(\s+확인)?\s*$/);
    if (close) {
      const c = byName(all, close[1]);
      if (!c) return send(`"${close[1]}" 새 세션이 없음`);
      if (!close[2]) return send(`"${close[1]}"을 지웁니다. 이어온 기록이 지워지고 되돌릴 수 없습니다(원래 Codex·Claude 기록과 작업 폴더는 설정에 따라 남음). 계속하려면: /close ${close[1]} 확인`);
      const r = await opts.api({ method: 'DELETE', path: `/v1/sessions/${c.conversationId}`, body: { confirm: close[1] } });
      if (r.status !== 200) return send(nsFail(r));
      for (const [k, v] of Object.entries(rooms)) if (v === c.conversationId) delete rooms[k];
      saveRooms();
      return send(`"${close[1]}" 삭제함${r.body.workspaceRemoved ? '(작업 폴더도 지움)' : ''}`);
    }
    // W2: 승인 답(/허용 n, /거부 n — 영문 /allow n, /deny n). 주인만, 이 대화방에 알린 번호만.
    const dec = text.match(/^\/(허용|거부|allow|deny)\s+(\d+)\s*$/i);
    if (dec) {
      if (!isOwner(m)) return send('승인은 이 봇의 주인만 할 수 있어요');
      // RC1: 이 대화방에 연결된 대화의 승인 번호로 찾는다(서버가 매긴 번호 — 메신저를 다시 켜도 같다)
      const convId = roomConv(m);
      const found = convId ? ((await opts.api({ method: 'GET', path: `/v1/conversations/${convId}/approvals` })).body?.approvals ?? []).find((x) => x.n === Number(dec[2])) : null;
      const item = found ? { n: found.n, approvalId: found.approvalId } : (roomApprovals.get(roomKey(m)) ?? []).find((x) => x.n === Number(dec[2])) ?? null;
      if (!item) return send(`승인 요청 ${dec[2]}번이 이 대화방에 없어요`);
      const decision = /^(허용|allow)$/i.test(dec[1]) ? 'allow' : 'deny';
      const r = await opts.api({ method: 'POST', path: `/v1/approvals/${item.approvalId}`, body: { decision } });
      if (r.status === 200) return send(`승인 요청 ${item.n}: ${decision === 'allow' ? '허용함(이번 한 번)' : '거부함'}`);
      return send(r.body?.error === 'approval_closed' ? `승인 요청 ${item.n}은 이미 끝났어요(${({ expired: '시간이 지나 거부됨', turn_ended: '차례가 끝나 거부됨', allowed: '허용됨', denied: '거부됨' })[r.body.status] ?? r.body.status})` : `처리하지 못했어요: ${r.body?.error}`);
    }
    // RC2: 이 대화방의 마지막 질문만 멈추기(/stop · /중지). 물어본 사람이나 주인만. 다른 대화방·다른 질문은 그대로.
    if (/^\/(stop|중지)(\s|$)/i.test(text)) {
      const la = lastAnswer.get(roomKey(m));
      if (!la) return send('멈출 질문이 없음(이 대화방에서 이번에 받은 질문이 없음)');
      if (la.askedBy !== String(m.userId) && !isOwner(m)) return send('그 질문을 보낸 사람이나 주인만 멈출 수 있어요');
      const r = await opts.api({ method: 'POST', path: `/v1/requests/${la.requestId}/stop` });
      if (r.status === 200) return send(`[${la.label}] 중지됨 — 아직 시작 전이라 바로 취소했어요`);
      if (r.status === 202) return send(`[${la.label}] 멈추는 중 — 엔진이 멈춘 것을 확인하면 "중지됨"으로 알려요`);
      if (r.body?.error === 'stop_unsupported') return send(`[${la.label}] 이 세션(사람이 띄운 Claude 창)은 실행 중에 여기서 멈출 수 없어요 — 원래 창에서 멈추세요`);
      const word = { completed: '이미 끝남', failed: '이미 실패함', cancelled: '이미 중지됨', unknown: '결과 불명(원래 세션 확인 필요)', approval_required: '권한 확인 대기' }[r.body?.status];
      return send(`[${la.label}] 멈출 수 없어요: ${word ?? r.body?.error ?? '알 수 없음'}`);
    }
    // 마지막 답 다시 받기 — 요청을 다시 읽어 전달만(엔진을 다시 돌리지 않음)
    if (/^\/last\b/.test(text)) {
      const la = lastAnswer.get(roomKey(m));
      if (!la) return send('다시 보낼 답이 없음(이 대화방에서 이번에 받은 질문이 없음)');
      const s = (await opts.api({ method: 'GET', path: `/v1/requests/${la.requestId}` })).body ?? {};
      if (s.status === 'completed') return deliver(m, send, { label: la.label }, la.requestId, s.answer);
      const word = { queued: '기다리는 중', dispatching: '보내는 중', running: '실행 중', failed: '실패', unknown: '결과 불명', approval_required: '권한 확인 필요', cancelled: '중지됨' }[s.status];
      return send(`[${la.label}] 마지막 질문은 아직 끝나지 않았거나 답이 없음(${word ?? s.status ?? '알 수 없음'})`);
    }
    if (/^\/sessions\b/.test(text)) return send(list.length ? list.map(describe).join('\n') : '연결할 수 있는 세션이 없음');
    const use = text.match(/^\/use\s+(\d+)\s*$/);
    if (use) {
      const c = list[Number(use[1]) - 1];
      if (!c) return send('그 번호의 세션이 없음 — /sessions로 확인');
      rooms[roomKey(m)] = c.conversationId;
      saveRooms();
      return send(`이 대화방을 "${c.label}"에 연결했습니다.`);
    }
    if (!current) return send('이 대화방에 연결된 세션이 없음 — /sessions 후 /use <번호>');
    if (/^\/status\b/.test(text)) {
      const la = lastAnswer.get(roomKey(m));
      // RC4: 이 대화를 막고 있는 확인 필요 질문이 있으면 그때 보낸 세션과 지금 세션이 같은지 한 줄
      let rs = '';
      if (current.heldBy?.requestId) {
        const r = (await opts.api({ method: 'GET', path: `/v1/tasks/${current.heldBy.requestId}` }).catch(() => null))?.body?.resume;
        if (r?.known) rs = r.sameSession ? '\n확인 필요 질문: 그때 보낸 세션과 지금 세션이 같음 — 원래 앱에서 확인 후 /review done 또는 /review not'
          : '\n확인 필요 질문: ⚠ 그때 보낸 세션과 지금 연결된 세션이 다름 — 그때 세션을 열어 확인';
      }
      return send(describe(current, list.indexOf(current)) + (la?.delivered === false ? '\n마지막 답: 답 전달 실패 — /last 로 다시 받기' : '') + rs);
    }
    const review = text.match(/^\/review\s+(done|not)\s*$/);
    if (review) {
      if (!current.heldBy) return send(`[${current.label}] 정리할 질문이 없음`);
      const r = await opts.api({ method: 'POST', path: `/v1/requests/${current.heldBy.requestId}/review`, body: { executed: review[1] === 'done' } });
      return send(r.status === 200
        ? `[${current.label}] ${review[1] === 'done' ? '실행된 것으로 정리함(답은 저장하지 않음)' : '실행되지 않은 것으로 정리함 — 필요하면 다시 질문하세요'}`
        : `[${current.label}] 정리할 수 없음: ${r.body?.error}`);
    }
    if (text.startsWith('/')) return send('모르는 명령어 — /help');
    return ask(m, current, text, send);
  }

  // 보관 예고를 그 세션에 연결된 대화방으로 보낸다. 대화방의 send는 그 방에서 마지막으로 받은 메시지 것을 쓴다
  // (메신저 봇을 다시 켠 뒤 그 방에서 아직 아무 말도 없으면 보낼 수 없어 건너뛴다).
  async function deliverNotices() {
    const r = await opts.api({ method: 'GET', path: `/v1/sessions/notices?after=${encodeURIComponent(noticeAfter)}` });
    if (r.status !== 200) return 0;
    let sent = 0;
    for (const n of r.body.notices) {
      noticeAfter = n.at > noticeAfter ? n.at : noticeAfter;
      for (const [k, v] of Object.entries(rooms)) {
        const send = v === n.conversationId && lastSend.get(k);
        if (send) { await send(`[${n.name}] ${n.archiveAt.slice(0, 10)}에 보관될 예정 — 계속 쓰려면 질문을 보내세요(보관돼도 /restore로 꺼낼 수 있음)`); sent += 1; }
      }
    }
    return sent;
  }

  return { handle, roomKey, deliverNotices, allowed };
}

// 이어온 서버 API 호출기. 토큰은 파일에서 읽고 출력하지 않는다.
// botHeader("<메신저>:<봇ID>")를 주면 요청마다 x-ieon-bot을 붙여 서버가 그 봇으로 처리하게 한다(여러 봇 M1).
export function serverApi(baseUrl, tokenFile, botHeader) {
  const token = readFileSync(tokenFile, 'utf8').trim();
  return async ({ method, path, body, headers = {} }) => {
    const r = await fetch(baseUrl + path, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(botHeader ? { 'x-ieon-bot': botHeader } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
  };
}