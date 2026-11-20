# V2 OpenAI 음성 — 실시간 대화(가)·한 번씩 말하고 듣기(나)

2026-11-20 신산님 결정: "진행하자, OpenAI API를 사용할거야" → 대답하는 쪽은 **하던 작업 세션**(①, OpenAI는 통역사), 만드는 방법은 **가(실시간 음성 연결)**, 그리고 "나중에 만들지 말고 지금 다 만들어"로 **나(한 번씩 말하고 듣기)도 같이**. 설정에서 언제든 방식을 바꿔 시험하고, 바꾸면 바로 쓴다. 지금 실제 시험은 가만. 상위 설계: [WORK_AND_VOICE](WORK_AND_VOICE.md) B절(V1 기기 내장).

## 1. 왜

걷거나 운전할 때 손을 쓰지 않고 하던 Codex·Claude 세션에 "그 작업 어떻게 됐어?"를 묻고 소리로 듣는다. 이어온의 핵심(하던 세션과 연결)을 목소리로 하는 것이지, 따로 노는 음성 AI(ChatGPT 음성 같은)를 만드는 것이 아니다.

## 2. 목표·아닌 것

- 목표: 이어온 앱(안드로이드·PC)·웹 대화 화면에서 열려 있는 대화에 대고 말하면, 그 말이 그 세션에 일반 질문으로 가고 답을 목소리로 듣는다. 질문·답은 지금처럼 그 대화에 남는다.
- 목표: OpenAI API 키·방식·모델·목소리·하루 한도를 **설정 화면에서** 넣고 바꾸며, 저장하면 다시 켜지 않고 바로 쓴다.
- 아닌 것: OpenAI가 스스로 작업 내용을 지어내 답하기, 음성으로 승인하기(승인은 카드 버튼만 — WORK_AND_VOICE WV6), 실제 전화번호, 음성 저장, 메신저 음성.
- 실패로 보는 것: 세션이 아닌 OpenAI가 작업 내용을 답함, 키가 앱·로그·화면 응답에 나감, 음성이 실패하면 글자 입력도 막힘.

## 3. 방식(설정 "음성 방식")

| 값 | 마이크 버튼을 누르면 | 키 |
| --- | --- | --- |
| `device`(기본) | V1 그대로 — 기기 받아쓰기 → 입력칸 | 없음 |
| `openai_turn`(나) | 녹음(다시 누르면 끝) → 서버가 OpenAI 받아쓰기 → **입력칸에 넣기**(V1처럼 고친 뒤 보냄) · 답이 오면 OpenAI 목소리로 읽기(자동 읽기 켰거나 🔊 누를 때) | OpenAI |
| `openai_live`(가) | **실시간 대화 창** — 손 대지 않고 이어 말하기, 세션에 묻고 요약해 읽어 줌 | OpenAI |

키가 없거나 방식이 `device`이면 지금과 똑같다(기능은 보이고, 못 쓰면 이유만 — 기억 feature-vs-usable).

## 4. 고른 방법(Approaches)

- **가 실시간(고름):** 앱·웹이 OpenAI Realtime에 WebRTC로 바로 붙는다. 이어온 서버는 키로 짧게 쓰는 열쇠(client secret, 60초 안에 연결)를 만들어 줄 뿐 소리는 지나가지 않는다. 손 안 대고 이어 말하기·끼어들기·기다리는 동안 알려 주기. 연결 시간만큼 요금 → 말 없으면 자동 끊기·하루 한도.
- **나 한 번씩(같이 만듦):** 녹음 파일을 서버가 OpenAI 받아쓰기로, 답 글을 서버가 OpenAI 목소리로 바꿔 돌려줌(키가 앱에 가지 않게 서버를 거침, 서버는 메모리에서만 다루고 저장하지 않음). 싸고 단순, 버튼을 매번 누름.
- 뺀 것: 서버가 실시간 소리를 중계 — 느리고 서버 부담만 큼.

## 5. 가 — 실시간 대화 흐름

1. 대화 화면의 🎤 — 방식이 `openai_live`이면 누를 때 실시간 대화를 시작하고 다시 누르면 끊는다(따로 📞 버튼을 두지 않음 — 버튼 하나가 설정을 따름, 구현 때 판단). 처음 한 번 "목소리와 대화 일부가 OpenAI로 갑니다" 확인.
2. 앱·웹 → `POST /v1/voice/live {conversationId}` → 서버: 그 사람이 볼 수 있는 대화인지·키·방식·가입자 허용·오늘 남은 시간 확인 → OpenAI `POST /v1/realtime/client_secrets`(모델·목소리·지시문·도구·말 끝 감지 semantic_vad, 받아쓰기 끔, `OpenAI-Safety-Identifier`는 사용자 해시) → `{ liveId, clientSecret, expiresAt, model, tickSec:30, idleSec, maxSec, remainingSec }`.
3. 앱·웹 → 마이크(getUserMedia) + `RTCPeerConnection` → `POST https://api.openai.com/v1/realtime/calls`(SDP, 열쇠) → 소리 재생, 데이터 채널 `oai-events`.
4. 지시문(보는 사람 언어, 사전 `server.voice_live.instructions`): 너는 이어온의 음성 통역사, 작업 세션 "{대화 이름}"과 사람 사이. 작업·코드·프로젝트에 관한 것은 모르니 **반드시 ask_session으로 사람 말을 그대로** 보낸다(지어내지 않음). 기다리는 동안 짧게 알려 줌. 답이 오면 1~3문장 요약 + 전체는 화면에. 승인은 음성으로 하지 않고 "화면 카드 버튼". 짧게 말함.
5. 도구(앱·웹이 처리):
   - `ask_session({ question })` → 이어온 `POST /v1/conversations/{id}/requests`(새 접수 키) → 곧바로 `{ sent: true }` 돌려줌. 앱·웹이 2초마다 `GET /v1/requests/{id}` — 끝나면(completed·failed·unknown·cancelled) 대화에 시스템 글 "세션 답: …"을 넣고 `response.create`로 읽게 함. 승인이 필요하면 "화면 카드에서 승인해 주세요"를 넣음. 바쁨(busy)·PC 끊김 등 거절은 그 이유를 넣음. 한 번에 질문 하나(처리 중이면 `{ busy: true }`).
   - `check_status()` → 지금 질문 상태.
   - `stop_request()` → 지금 질문 중지(`POST /v1/requests/{id}/stop`). 중지는 승인 아님.
6. 시간: 30초마다 `POST /v1/voice/live/{liveId}/tick` → 서버가 오늘 사용 초에 더하고 `{ remainingSec, stop }`. 한도·최대 길이(기본 15분)면 앱·웹이 끊음. 사람·AI 둘 다 말이 없고 질문 대기도 없이 `idleSec`(기본 60초) 지나면 끊음. 끊을 때 `POST …/end`.
7. 화면: 입력칸 위 막대 하나 — 상태(연결 중·듣는 중·말하는 중·세션 답 기다리는 중), 남은 시간, [음소거]·[끊기]. 질문·답은 대화 화면에 평소처럼 쌓임(질문 옆 🎤). 다른 대화로 가면 끊음.

## 5-1. 구현(2026-11-20)

- 서버 `src/pilot/voice-openai.mjs`(설정 검사·열쇠·tick·받아쓰기·읽기 중계), `server.mjs`의 `/v1/voice/*`·`PUT /v1/admin/settings/voice`, 공통 코드 `src/pilot/web/voice-core.js`(웹은 `/voice-core.js`, 앱은 `app/scripts/copy-locales.mjs`가 `app/src/locales/voice-core.ts`로 복사), 웹 `app.html`·`settings.html`, 앱 `Voice.tsx`·`Chat.tsx`·`Room.tsx`·`api.ts`, 안드로이드 마이크 권한, PC 앱 마이크(소리만) 허용. 시험 `tests/pilot/v2-voice.test.mjs`(가짜 OpenAI).

## 6. 나 — 한 번씩 말하고 듣기

- 받아쓰기: 앱·웹이 MediaRecorder로 녹음(최대 60초) → `POST /v1/voice/transcribe`(소리 파일 본문, 15MB 이하) → 서버가 OpenAI `/v1/audio/transcriptions`(설정 모델, 기본 `gpt-4o-mini-transcribe`, 언어=보는 사람 언어) → `{ text }` → 입력칸.
- 읽기: `POST /v1/voice/speak { text }`(4000자 이하, 앱이 읽기 좋게 줄인 글) → 서버가 OpenAI `/v1/audio/speech`(기본 `gpt-4o-mini-tts`, 설정 목소리) → mp3 → 재생. 실패하면 기기 목소리로.
- 사용량: 받아쓰기 한 번 = 녹음 초, 읽기 한 번 = 글자 수/15초로 오늘 사용에 더함(같은 하루 한도).

## 7. 설정(설정 → 내 설정 → 계정 → "OpenAI 음성")

관리자만 바꿈. 칸: OpenAI API 키(넣기·바꾸기·지우기, 저장 뒤엔 끝 4자만), 음성 방식(기기 내장·OpenAI 한 번씩·OpenAI 실시간), 실시간 모델(기본 `gpt-realtime-mini`), 목소리(기본 `marin`), 받아쓰기·읽기 모델(접어 둠), 하루 최대(분, 기본 30), 말 없으면 끊기(초, 기본 60), 한 번 최대(분, 기본 15), 가입자도 쓰기(기본 끔)·가입자 하루 최대(분, 기본 10), 오늘 쓴 시간. 키를 새로 넣으면 OpenAI 모델 목록(무료 조회)으로 확인해 틀리면 저장하지 않음. 저장은 DB 설정(`voice.openai`, push 키와 같은 방식) — 다음 요청부터 바로 적용. 키는 응답·로그·화면에 다시 나가지 않는다.

`GET /v1/voice/config`(로그인한 사람) → `{ mode, configured, live, turn, remainingSec, reason }` — 앱·웹이 마이크를 누를 때마다 읽어 방식을 정함(설정을 바꾸면 바로).

## 8. 지켜야 할 것

- 허브·PC형 같음(기억 pc-hub-feature-parity): 앱·웹이 붙은 그 서버가 키를 가진다. 허브에 연결된 PC(허브 모드)에서는 질문처럼 허브 화면으로 안내(`hub_mode`).
- 로그에 키·소리·받아쓴 글·질문·답을 남기지 않음(사건 이름·초만).
- 안드로이드 앱: 마이크 권한(RECORD_AUDIO·MODIFY_AUDIO_SETTINGS), WebView 마이크 요청 허용. PC 앱: Electron 권한 처리에 `media` 허용(마이크만). 웹: https 또는 이 PC 주소에서만 마이크가 열림(브라우저 규칙).
- 실패해도 글자 입력·V1은 그대로.

## 9. 빌더에게 맡긴 것·확인할 것

- 실제 시험(2026-11-20, WORK_STATUS 0-320): 모델 `gpt-realtime-mini`·ask_session 그대로 전달·시스템 글 + `response.create`로 요약 읽기·말 없으면 끊기·시간 세기 PASS. 남은 확인: 실제 목소리 인식(semantic_vad)·소리 듣기, 안드로이드 WebView 마이크(사람).
- 내 판단: 질문은 하나씩, 기다림 2초 조회, 요약 길이 1~3문장, 사용량은 앱이 보내는 30초 tick으로 셈(서버가 소리를 보지 않으므로 — 자기 앱이 보내는 값).
