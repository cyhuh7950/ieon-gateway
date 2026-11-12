# 엔진 넓히기 — Grok·Gemini 세션도 이어 쓰기

기준: 2026-11-12. 상태: **승인 2026-11-12(신산님 "추천안 승인").** 6절 추천안이 결정이다. 코드·서버 변경 없음. 개발은 신산님 지시대로 나중에(토큰 충전 뒤) 단계마다 승인 후.
관련: [DESIGN](DESIGN.md)(기존 세션 연결 원칙), [WORK_AND_VOICE](WORK_AND_VOICE.md)(승인 카드), [MESSENGER_EXPANSION](MESSENGER_EXPANSION.md)(AI 직원 = 세션).

## 0. 조사 결과(2026-11-12, 공식 문서·OpenMausBot 공개 코드 읽기만)

| | Grok | Gemini |
| --- | --- | --- |
| 공식 프로그램 | xAI 공식 **Grok Build CLI `grok`** | Google 공식 **Gemini CLI `gemini`** |
| 세션 저장 | `~/.grok/sessions/`(작업 폴더별 자동 저장) | `~/.gemini/tmp/<프로젝트 해시>/chats/`(자동 저장) |
| 같은 세션 이어 쓰기 | `grok --resume <id>`(`-r`), 질문 한 번 실행 `-p`, 결과 `--output-format json`의 `sessionId` | `gemini --resume <id>`(`-r`, `latest`·번호·ID), `--list-sessions`, 결과 `-o json`·`stream-json` |
| ACP(에이전트 공통 규약) | `grok agent stdio`. 공식 문서 예시는 `session/new`·`session/prompt`만, **`session/load` 지원 여부는 공식 확인 못 함** | `gemini --acp`(문서에 따라 `--experimental-acp`), `loadSession`(지난 세션 불러오기) 지원 |
| 로그인 | grok.com **구독 로그인**(`grok login --device-auth`) 또는 `XAI_API_KEY`(종량제). OpenMausBot은 키가 섞이면 종량제로 바뀌므로 실행 때 키를 지움 | **2026-06-18부터 개인 Google 계정 로그인(무료·AI Pro·Ultra)이 Gemini CLI에서 막힘**, Google은 **Antigravity**(`agy`)로 안내. CLI는 API 키·Vertex(종량제)·기업용 Code Assist |
| Windows | **확인 못 함**(OpenMausBot 주석에 Windows 설치 명령 없음) | 확인 필요 |
| 읽기 전용 | 확인 못 함(`--always-approve`가 없을 때 동작도 미확인) | 별도 읽기 전용 없음, `--approval-mode plan` + `--sandbox`가 가장 가까움 |

**OpenMausBot:** Grok은 `grok … agent stdio`(ACP)로 붙고, 이어 쓰기는 `session/load`, **불러오기에 실패하면 새 세션(`session/new`)에 지난 내용을 붙여 대체**한다(이어온은 금지). Gemini는 `gemini --acp`인데 "실제 CLI로 시험하지 않음"이라 기본 꺼짐이고, 개인 구독용으로 **Antigravity(`agy`) ACP + `session/resume`** 드라이버를 따로 둔다. 같은 세션에 질문이 겹치면 거부한다(이어온 "사용 중 거부"와 같음).

**ACP:** Gemini CLI가 직접 지원하고, Claude(`claude-agent-acp` 어댑터)·Codex(`codex-acp` 어댑터)도 있다. Grok·Antigravity는 공식 목록에 없다. 세션 불러오기는 `session/load`(지난 대화를 다시 보내 줌)와 `session/resume`(다시 보내지 않고 이어감) 두 가지이고, **에이전트가 지원한다고 알린 것만** 쓸 수 있다.

## 1. 원칙(지금 엔진과 똑같이)

- **같은 세션만:** 사용자가 이미 쓰던 Grok·Gemini 세션 ID로만 이어 쓴다. 불러오기에 실패하면 **거부**한다. 새 세션에 지난 내용을 붙여 대체하거나 갈라 쓰기(`--fork-session`·`/fork`)는 하지 않는다.
- **사용 중이면 거부:** 같은 세션을 사람이 TUI에서 쓰는 중인지 판별하는 공식 방법을 아직 모른다 → E0에서 실측해 정하고, **정하기 전에는 Codex "번갈아 쓰기"처럼 "보낼 때 그 세션을 다른 곳에서 열어 두지 않는다"를 조건으로** 한다(화면에 안내).
- **결과 불명이면 자동 재전송 없음:** 한 번 실행의 JSON 결과나 ACP `stopReason`이 없으면(끊김·시간 초과) "확인 필요"로 둔다.
- **읽기 전용·승인 없음(질문만):** 파일 수정·명령 실행은 하지 않는다. Gemini는 `plan` + 샌드박스, Grok은 E0에서 확인(안 되면 ACP 승인 요청에 항상 거부로 답하는 방식). 작업 모드는 [WORK_AND_VOICE](WORK_AND_VOICE.md) 승인 카드가 생긴 뒤.
- **구독 로그인만, 유료 API 자동 전환 없음:** 로그인은 사용자가 그 프로그램에서 직접. 이어온은 실행할 때 API 키 환경 변수를 지워 **구독이 종량제로 바뀌지 않게** 한다. API 키(종량제)는 사용자가 명시적으로 고를 때만(AGENTS "유료 API 전환 금지"와 같은 원칙).

## 2. 연결 방식

| 방식 | 모양 | 장점 | 제약 |
| --- | --- | --- | --- |
| **A. 질문마다 한 번 실행(추천, 처음)** | `grok -r <id> -p <질문> --output-format json`, `gemini -r <id> -o json <질문>` — Codex "번갈아 쓰기"와 같은 모양 | 단순, 지금 연결부 구조 그대로, 세션 파일이 그대로 이어짐 | 사용 중 판별·읽기 전용 옵션을 E0에서 확인해야 함 |
| B. ACP 상주 연결 | `grok agent stdio`·`gemini --acp`에 `session/load`(또는 `resume`) → `session/prompt` | 승인 요청(`session/request_permission`)을 받을 수 있어 나중에 승인 카드와 바로 연결, 여러 엔진을 한 클라이언트로 | Grok의 `session/load` 지원 미확인, 실패 시 대체 금지 처리 필요 |

처음엔 **A**, 승인 카드(WORK_AND_VOICE W1~W2)를 할 때 **B**(ACP 클라이언트 하나로 Grok·Gemini, 지원 확인된 것만)로 넓힌다.

## 3. Gemini 로그인 문제

개인 Google 계정으로는 Gemini CLI를 더 이상 쓸 수 없다(2026-06-18부터). 선택지는:

1. **Antigravity(`agy`)** — Google이 개인 구독용으로 안내하는 공식 런타임. OpenMausBot이 ACP `session/resume`로 붙는다. 사용자가 Antigravity에서 쓰던 세션을 이어 쓰는 모양이 된다. **E0에서 Windows 설치·세션 이어 쓰기·읽기 전용 확인 필요.**
2. **Gemini CLI + API 키·Vertex** — 동작은 문서상 확실하지만 **종량제 요금**. 사용자가 명시적으로 고를 때만.

## 4. 화면

- 대화 연결(＋ 대화 연결) 목록에 엔진 탭: Codex · Claude · **Grok** · **Gemini**. Grok·Gemini 목록은 각 프로그램의 공식 목록 기능(`--list-sessions` 등)이나 세션 파일 이름으로 만든다(본문은 읽지 않음).
- 엔진 표시·아이콘 추가, 카드: "Grok 로그인 필요"(그 PC에서 `grok login`), "Gemini 로그인 필요".
- 처음 설정 1단계(준비 확인)에 Grok·Gemini 로그인 여부(설치돼 있을 때만).
- 설명서 1-3(AI 준비)에 Grok·Gemini 계정·구독·프로그램 추가(설명서 원칙: 사전 준비 자세히).

## 5. 단계(안)

| 단계 | 내용 | 완료 기준 |
| --- | --- | --- |
| E0 | 실측(시험용 세션만, 설치·모델 호출 별도 승인): Windows 설치, `-r <id>` 이어 쓰기가 같은 세션 파일에 이어지는지, 사람이 TUI에서 열어 둔 채 보내면 어떻게 되는지(사용 중 판별), 읽기 전용 옵션, 구독 로그인 상태 확인 방법, Grok ACP `session/load` 지원, Antigravity 세션 이어 쓰기 | 엔진별 가능/불가 기록 |
| E1 | Grok 어댑터(방식 A), 대화 연결 목록·카드·준비 확인, 설명서 | 대역 시험(같은 세션만·불러오기 실패 거부·결과 불명·API 키 제거) + 시험 세션 실측(승인) |
| E2 | Gemini 계열 어댑터(3절 결정에 따라 Antigravity 또는 CLI) | 같은 기준 |
| E3 | ACP 상주 연결(방식 B) — 승인 카드와 함께 | WORK_AND_VOICE W2와 함께 |
| E4 | Grok·Gemini 새 세션 만들기(선택) | NEW_SESSIONS 규칙대로 |

## 6. 결정(2026-11-12 승인 — 아래 추천안이 결정)

| 번호 | 질문 | 추천 |
| --- | --- | --- |
| ME1 | 엔진 순서 | **Grok 먼저**(공식 CLI·구독 로그인·이어 쓰기 문서 있음), 단 E0에서 Windows 동작 확인이 먼저 |
| ME2 | 연결 방식 | **처음엔 질문마다 한 번 실행(A)**, 승인 카드 때 ACP(B) |
| ME3 | Gemini 로그인 | **Antigravity(`agy`)를 먼저 E0에서 확인**, 안 되면 API 키(종량제)는 신산님이 명시적으로 고를 때만 |
| ME4 | 불러오기 실패 | **거부**(새 세션 대체·갈라 쓰기 없음) |
| ME5 | 사용 중 판별 | **E0 실측 전에는 "보낼 때 다른 곳에서 열어 두지 않기"를 조건으로 안내**, 실측 뒤 판별 방법 확정 |
| ME6 | 읽기 전용 | **질문만**(Gemini `plan`+샌드박스, Grok은 E0 결과에 따라, 안 되면 승인 요청 항상 거부) |
| ME7 | 비용 | **구독 로그인만**, 실행 때 API 키 환경 변수 제거, 종량제는 명시적 선택 |

## 7. 위험

- **Windows 미지원 가능성:** Grok CLI가 Windows에서 안 돌면 이 PC에서는 WSL 또는 다른 PC에서만 가능 → E0 첫 항목.
- **문서끼리 다름:** Grok `-s` 설명, Gemini `--acp`/`--experimental-acp`가 문서마다 다르다 → 버전을 기록하고 실측 기준으로.
- **조용한 대체:** OpenMausBot식 "불러오기 실패 → 새 세션"이 섞이면 이어온의 핵심 약속(같은 세션)이 깨진다 → 실패 시 거부를 시험으로 고정.
- **요금:** API 키가 환경에 있으면 구독 대신 종량제로 바뀔 수 있다 → 실행 환경에서 키 제거를 시험으로 고정.
- **Gemini 정책 변경:** 개인 로그인 차단처럼 정책이 또 바뀔 수 있다 → 엔진별 로그인 방식을 설정에서 보이게 하고 실패 이유를 카드로.