# 이어온 작업계획

> **2026-11-08 갱신:** 첫 실증(아래 S1~S2) 이후 단계는 바로 다음 절 "첫 실증 이후 단계"에 둔다. 첫 실증 계획 본문은 그대로 보존한다.

## 첫 실증 이후 단계 (2026-11-08 기준)

공통 승인 경계: 실제 모델 호출·서버 기동(loopback 포함)·Oracle 쓰기·DNS·메신저·카카오 설정·로그인은 단계마다 별도 승인. 저장소 코드·단위 테스트는 단계 승인 안에서 진행. 커밋은 `claude/<목적>` branch → `pr-request` 태그 → PR Broker 병합(CRLF는 수정 파일만 개별 add, `diff --check` 확인).

### 새 세션 만들기 (설계 [NEW_SESSIONS](design/NEW_SESSIONS.md))

| 단계 | 내용 | 상태 |
| --- | --- | --- |
| N0 | 설정·세션 등록 DB·한도·권한 규칙 | 완료 |
| N1 | Codex 새 대화 생성·재개 | 완료(실측) |
| N2 | Claude 새 세션(`claude -p`) | 완료(실측) |
| N3 | 잠들기·보관·꺼내기·삭제·동시 한도 | 완료 |
| N4 | 웹·메신저·API에서 만들기 | 완료(텔레그램 실측) |
| N5 | Linux 실행(`ieon.sh`·systemd)·WSL 실측 | 완료 |
| N6 | Oracle(sinsan-server, 전용 사용자 `ieon`) 배포·실측 | 완료(O1~O6, H1). H2·H3는 허브형 결정으로 폐기, O7은 P5로 대체 |

### 여러 봇·메신저 (설계 [MULTI_BOTS](design/MULTI_BOTS.md))

| 단계 | 내용 | 상태 |
| --- | --- | --- |
| M0~M2·M2-W | 봇·역할 정의, 봇별 연결, 부른 봇만 답, 부르는 이름, 웹 봇 관리 | 완료(텔레그램·디스코드·슬랙 실측) |
| M3 | 봇별 세션 범위·역할 엔진·권한 제한·AI 역할 안내 | 완료(텔레그램 실측) |
| M4 | 공개 수신 중계(`ieon-relay`, sinsan-server Docker) | 배포 완료([RELAY_DEPLOY](design/RELAY_DEPLOY.md)) |
| M5 | Teams | **보류**(개인 계정으로는 어려움, M365 개발 테넌트가 생기면 재개) |
| M6 | 카카오톡(Aidot 봇, 콜백) | 실측 완료. 미확인: 콜백 유효 시간·횟수, 실제 채널 배포 대화 |

### 설치 형태 분리 (설계 [HUB_AND_PC_PROFILES](design/HUB_AND_PC_PROFILES.md))

| 단계 | 내용 | 승인 경계 | 상태 |
| --- | --- | --- | --- |
| P0 | 설치 형태·이름·호스트·접속 제한·기기 토큰 화면 결정 | 없음 | 완료(2026-11-06·11-08) |
| **P1** | 허용 사용자·카카오 설정·기존 세션 등록·새 세션 설정·기기 등록을 서버 DB·웹으로(파일 설정은 대체 값 유지) | 저장소 코드 | **완료(2026-11-08)**: P1-a 허용 사용자·카카오·새 세션, P1-b 기존 세션 등록, P1-c 기기 등록·재발급·폐기 |
| P2 | 카카오 중계를 `ieon-gateway.sinsan.kr`로 이전(NPM 호스트 추가, 카카오 스킬 URL 교체), `ieun-gateway`는 허브용으로 비움 | Oracle NPM 변경, 카카오 설정 | **완료(2026-11-08)**: W8(신산님 NPM)·W9 바깥 확인 PASS·W10 PC 중계 주소 전환·W11 스킬 URL 교체와 카카오 `/whoami` 응답·W12 정리. `ieun-gateway`는 NPM에서 `ieun-relay`(아직 없음)를 가리켜 502 — P4 허브 배포에서 채운다. [RELAY_DEPLOY 8절](design/RELAY_DEPLOY.md) |
| P3 | `ieon.ps1 connect <허브 주소>`(PC 연결부가 허브에 HTTPS 접속, 로컬 서버와 동시 실행 방지, 기기 API 요청 횟수 제한) | 저장소 코드, 이후 연결 시험(Codex 별도 승인) | **코드 완료(2026-11-08)**: connect 명령(ps1·sh)·허브 주소 검사·동시 실행 방지·기기 API 요청 횟수 제한, 테스트 4건. 실제 허브 연결 시험은 P4 배포 후(미검증) |
| P4 | 허브 접속 제한 코드(IP 허용 목록·Cloudflare Access·Tailscale, 설정 파일 선택)·기기 토큰 화면 → 허브 배포·확인 | 저장소 코드, 이후 Oracle 쓰기 | **코드 완료(2026-11-08)**: `web-access.mjs`(세 방식·믿는 앞단·기본 닫힘)·공개용 Unix 소켓·전달기 `ieun-relay`(deploy/hub), 테스트 5건. **배포(2026-11-08)**: D0 IP 허용 목록·D1~D4 완료(허브 `https://ieun-gateway.sinsan.kr` 접속 제한 동작, [5-1-3](design/HUB_AND_PC_PROFILES.md)). D5 PC↔허브 연결 PASS(신산님 허브 화면 확인). **P4 완료** |
| P5 | 메신저를 허브로 이전(카카오부터, 봇 토큰은 신산님이 서버 비밀 파일에 직접) | 별도 승인, 모델 호출 별도 | 대기 |

### 다음 순서

1. ~~P1~~ 완료(2026-11-08).
2. ~~P2~~ 완료(2026-11-08).
3. ~~P3~~ 코드 완료(2026-11-08, 실제 허브 연결 시험은 P4 뒤).
4. P4 → P5.

---

# 첫 실증 작업계획(2026-10-29~30, 보존)

> 기준(2026-10-29, v0.2): 신산님 결정으로 **Claude Code = Channels(방식 1), Codex = 대화방↔thread ID 매핑 후 SDK `resumeThread`로 재개(방식 2)**. [DESIGN.md](design/DESIGN.md) v0.2를 따른다. 각 단계의 실제 기동·plugin 설치·로그인·모델 호출은 해당 단계 승인 후에만 진행한다. 이전 경로(Remote Control·업무 대화 P0·관리 App Server·클라우드 조회)의 실행 기록은 맨 아래 [이력](#이력)에 보존한다.

**목표:** 외부 프로그램에서 지정한 기존 세션과 대화한다. Codex는 같은 thread로 Desktop → 이어온 → Desktop, Claude는 실행 중인 같은 세션으로 외부 → 세션 → 외부 왕복을 확인하고 busy·중복 방지·unknown 처리의 실제 성립 여부를 보고한다.

**구조:** 최소 테스트 웹 / 인증 API / 내구 요청 상태 / SINSAN 연결부 / 엔진 adapter 2개(`codex-thread`, `claude-channel`). 모델 없는 검증을 먼저 통과한 뒤 승인된 실제 turn만 실행한다.

**기술 제안:** Node.js 24 ESM, Codex TypeScript SDK(`@openai/codex-sdk`), 내장 http·crypto·test·SQLite. Claude 채널은 공식 plugin(Bun 필요)을 먼저 쓰고, 이어온 전용 채널 MCP 서버는 C1에서 결정한다. 정식 stack은 실증 후 확정한다.

## 공통 제한

- 기존 세션 필수. 복사·fork·새 세션을 이어쓰기 성공으로 인정하지 않는다.
- 업무 대화 01a0dadd-739f-74d2-93c5-9c405cc1019b는 대상에서 제외하며 조회·재개·잠금 검사를 하지 않는다. 시험용 세션만 사용한다.
- 신산님 1명·SINSAN 1대. 사용자/앱/PC/세션 소유권 분리·거부 검증 포함.
- 사용 중·세션 미실행·PC 단절·상태 확인 불가면 실행하지 않는다. 다른 작업 중단·turn/steer·잠금 강제 해제 없음.
- 자동 재전송·유료 API fallback·새 세션 fallback 없음. Codex 잠금 충돌은 busy이며 재시도하지 않는다.
- 공식 로그인은 신산님이 직접 수행한다. credential·bot token 복사·로그 기록 금지.
- `--dangerously-skip-permissions` 사용 금지. 채널 sender allowlist는 신산님 본인만.
- 테스트 대역·읽기 전용 조사·실제 turn·사용자 인수 결과를 분리 기록한다.

## 단계 지도와 중단점

| 단계 | 산출물 | 선행조건·판정 |
| --- | --- | --- |
| S1 | 모델 없는 공통 안전·내구성 검증(두 엔진 대역) | 설계 v0.2 확인. 모델 호출 0 |
| X0 | Codex P0: 시험 thread 재개 가능·Desktop 점유 시 거부 확인 | 시험용 로컬 thread ID, 신산님이 Desktop에서 대화를 놓음. 모델 호출 0 |
| X1 | Codex P1: Desktop → 이어온 → Desktop 사용자 turn 3회 | X0 통과. 승인된 최대 3 turn(최초 맥락 포함) |
| X2 | Codex 동시 사용 모드: 공유 App Server + TUI + 이어온 `ExternalMessage` | 엔진 기동·SDK 설치·모델 3 turn 승인 |
| C0 | Claude: 공식 fakechat 채널 왕복·세션 미실행 거부 | plugin 설치·`--channels` 기동 승인. 시험용 세션 |
| C1 | Claude: 이어온 전용 채널 또는 공식 Discord/Telegram 왕복 | C0 통과, 경로 선택, bot token은 신산님이 직접 설정 |
| S2 | 최소 로컬 실증 화면/API/연결부 | S1 통과와 X0/C0 결과. loopback 한정 |
| 검토 | 엔진별 결과·한계·후속 범위 | 신산님 확인. 새 세션·API 키·RAG/MCP·Oracle 자동 착수 없음 |

X 계열과 C 계열은 서로 독립이며 신산님이 정하는 순서로 진행한다.

## 검토 때 집중할 실패 조건

1. 같은 세션을 다른 표시 이름·인증 경로로 두 번 등록해 잠금이 우회되는 경우.
2. 실행 요청은 전달됐지만 ack·receipt 저장 전에 단절·재시작하는 경우.
3. Codex: Desktop이 thread를 열고 있는데 재개가 성공하거나, 재개 후 Desktop에서 이어온 turn이 보이지 않는 경우.
4. Claude: 세션이 권한 확인에서 멈춘 채 메시지가 쌓이거나, allowlist 밖 발신자가 승인 응답을 보내는 경우.
5. 삭제 직후 늦은 답변이 도착해 삭제 원문이 되살아나는 경우.
6. 구독 한도·인증 전환이 기존 로그인·세션 설정을 바꾸거나 별도 과금을 시작하는 경우.

## S1 — 모델 없는 공통 안전·내구성 검증

설계 추적: DESIGN 5·6·7·9.

| 파일 | 책임·주요 인터페이스 |
| --- | --- |
| src/pilot/contracts.mjs | Principal, VerifiedBinding(engine, session_ref), RequestStatus, ExecutionReceipt |
| src/pilot/store.mjs | 접수/중복/잠금/상태/receipt 원자 저장. createRequest(principal, binding, key, payload), reconcile(requestId, receipt) |
| src/pilot/guard.mjs | 소유권·세션 상태·PC 상태·허용 모델·도구·호출 한도 거부. session_key=(host, engine, session_ref) 잠금 |
| src/pilot/fake-adapters.mjs | `codex-thread`(잠금 충돌 주입 포함)·`claude-channel`(세션 미실행·권한 대기 주입) 대역 |
| tests/pilot/*.test.mjs | 불변식과 장애 경계. 실제 adapter를 import하지 않음 |

- [x] **S1.1 RED/GREEN** `ownership.test.mjs`: 다른 user/app/host/session ID는 거부, adapter 실행 0. body의 user_id·raw thread ID·임의 경로로 권한이 생기지 않음.
- [x] **S1.2 RED/GREEN** `idempotency.test.mjs`: 같은 key·payload 2회→같은 request·실행 1회, 같은 key·다른 payload→409·추가 실행 0.
- [x] **S1.3 RED/GREEN** `busy.test.mjs`: Codex 잠금 충돌→409 `desktop_holds_thread`·재시도 0, Claude 세션 미실행→503 `session_not_running`, 같은 세션 경합→추가 실행 0.
- [x] **S1.4 RED/GREEN** `recovery.test.mjs`: 접수 전/후·전송 전·전송 후 ack 전·receipt 저장 후·답변 저장 전 재시작. 전송 가능성이 있으면 unknown, 재연결 후 추가 실행 0.
- [x] **S1.5 RED/GREEN** `retention.test.mjs`: 삭제 전 보관, 다른 앱 조회/삭제 거부, 늦은 결과의 원문 재생성 금지, 원래 세션 삭제 호출 0.
- [x] **S1.6** `node --test tests/pilot/*.test.mjs`와 `node --check`. 실제 임시 SQLite 파일·프로세스 재시작으로 복구 확인. in-memory만으로 내구성 PASS를 선언하지 않는다.

완료 조건: 실패 조건 검사와 디스크 복구 통과, 모델 실행 0·Secret/원문 로그 0. rollback: 이 단계의 코드/시험 DB만 되돌린다.

**S1 결과(2026-10-29, branch feat/s1-safety-core):** RED(모듈 없음) 확인 후 구현, `node --test tests/pilot/*.test.mjs` 27/27 통과(기존 inspect 7 포함), `node --check` 통과. Node 24.22.1 내장 SQLite(WAL·synchronous FULL) 임시 파일과 별도 Node 프로세스 강제 종료(before_send·after_send·after_receipt)로 재시작 복구를 확인했다. 대역 결과이며 실제 Codex·Claude 연결 성공을 뜻하지 않는다. 세부 결정: unknown·approval_required는 세션 잠금을 유지하고, 엔진의 명확한 실행 전 거부(EngineError)만 failed로 잠금을 푼다. settings-recovery 시험은 실제 설정 변경 계획이 없어 제외했다.

## X0 — Codex 시험 thread 재개 가능성(모델 0)

설계 추적: DESIGN 3·4·8·10.

- [x] **X0.1** 신산님이 Desktop에서 시험용 로컬 대화를 만들고 ID를 전달한다. 이 대화의 첫 맥락 turn은 X1의 3 turn에 포함한다.
- [x] **X0.2** Desktop이 그 대화를 연 상태에서 lock 파일의 읽기 전용·nonblocking 잠금 검사 1회 → 충돌이면 "Desktop 사용 중 거부" 근거로 기록한다(재개 시도 없음).
- [x] **X0.3** 신산님이 Desktop에서 그 대화를 닫거나 앱을 직접 종료한 뒤 같은 검사 1회 → 충돌 없음을 확인한다. 충돌이면 중단·보고, 강제 해제 없음.
- [x] **X0.4** 설치된 Codex CLI/SDK 버전과 `resumeThread` 호환을 확인한다. 모델 turn 없이 확인할 수 있는 범위만 수행하고, 불가하면 X1 첫 turn을 재개 검증으로 겸한다고 명시한다.
- [x] **X0.5** `docs/validation/`에 버전·호출 수·잠금 결과·미검증을 기록한다.

정리: X0가 만든 조회 프로세스·임시 파일만 정리한다. Desktop·업무 대화·인증은 건드리지 않는다.

**X0 결과:** 대화 닫기·10분 대기로는 잠금이 유지되고 앱 종료 시 반납됨. X0.4는 모델 없이 확인할 수단이 없어 X1 I1이 재개 검증을 겸했다.

## X1 — Codex Desktop → 이어온 → Desktop (사용자 turn 3회)

**X1 결과(2026-10-30): 조건부 PASS.** D1·I1·D2 모두 수행, 같은 thread·양방향 맥락 확인. 이어온 재개에는 앱 종료가 필요하고 Desktop 반영은 재실행 후 확인했다. [결과서](validation/FIRST_CONTINUITY_RESULT.md).

| 순서 | 실행·관찰 | 합격 근거 |
| --- | --- | --- |
| D1 | Desktop 시험 대화에서 비민감 표식 A를 남기는 질문 1회 | thread ID·turn 기록 |
| 반납 | 신산님이 Desktop에서 대화를 닫음 → 잠금 검사 1회 | 충돌 없음 |
| I1 | 이어온 연결부가 `resumeThread(ID).run()`으로 A를 묻고 표식 B를 남김 | 같은 thread ID·A 정답·완료. 동일 key 반복은 추가 turn 0 |
| busy | (모델 0) Desktop에서 대화를 연 상태로 이어온 접수 시도 | 409 busy·추가 turn 0 |
| D2 | Desktop에서 대화를 다시 열어 I1 표시 확인 후 B를 묻는 질문 1회 | I1 내용 반영·같은 thread. 새로 열어야 보였는지 기록 |

이어온 turn 중 Desktop 입력 차단은 추가 turn이 생길 수 있으므로 시행하지 않고 UNVERIFIED로 둔다. 3회로 부족하면 자동 추가하지 않는다.

## X2 — Codex 동시 사용 모드(`shared_server`) 검증 (미승인)

2026-10-30 결정: Codex는 `alternate`(X1 실증)와 `shared_server` 두 모드를 모두 두고 세션 설정에서 고른다([설계 3절](design/DESIGN.md#codex-연결-모드--설정에서-선택-2026-10-30-신산님-결정)). 아래는 승인 전 실행하지 않는다.

- [x] **X2.0** 설치 버전(0.165) 기준 `app-server --listen`·`--remote`·원격 토큰·`ExternalMessage` 문서/소스 확인(실행 없음). 결과: [X2.0 확인서](validation/X2_0_SHARED_SERVER_DOC_CHECK.md) — `ExternalMessage` 대신 프로토콜 `turn/start` 직접 사용 가능, Python SDK 설치 불필요 가능성.
- [x] **X2.1** 승인 후 Codex 앱 종료 상태에서 loopback 공유 엔진 기동, 시험 thread를 TUI `--remote`로 열기(모델 0). Python SDK 설치도 이 승인에 포함.
- [x] **X2.2** TUI 질문 1회 → 이어온 `ExternalMessage` 1회(답 수집·TUI 실시간 표시 확인) → TUI 질문 1회. 모델 turn 3회 별도 승인.
- [x] **X2.3** 사용 중 정책 `reject_busy` 확인(모델 0 범위만), 엔진 종료 후 잠금 반납 확인, 결과 기록.
- [x] **X2.4** S2에 세션별 모드 설정·전환 조건(진행 중 요청 없음, 잠금 반납 확인)과 UI-07 설정 시안 반영. 결과: 대화별 `connect_mode` 저장(기본 alternate, 기존 DB 자동 열 추가), `PUT /v1/conversations/{id}/settings`(Codex만, 처리 중·결과 불명 잠금이 있으면 409), 연결부 작업에 모드 전달, 웹 화면 Codex 설정 영역(UI-07을 실제 화면으로 구현). thread 잠금 반납은 서버가 볼 수 없어 전환 시점이 아니라 다음 실행 때 모드별 사전 확인(alternate=잠금 검사, shared_server=idle 확인)으로 막는다. 테스트 36/36, 실제 화면 조작은 미확인.

## C0 — Claude 공식 채널 왕복

- [x] **C0.1** Bun 설치 여부 확인. 없으면 설치 승인을 받는다.
- [x] **C0.2** 시험용 작업 폴더에서 `fakechat@claude-plugins-official` 설치 → `claude --channels plugin:fakechat@claude-plugins-official` 기동(신산님 승인 후).
- [x] **C0.3** localhost fakechat 화면에서 단순 질문 1회 → 같은 세션 답변이 화면으로 돌아오는지, 터미널에 수신 줄이 남는지 확인. 첫 reply 권한 확인은 신산님이 직접 승인.
- [x] **C0.4** 세션 종료 후 메시지 전송 → 도달하지 않음을 확인(세션 미실행 판정 근거).
- [x] **C0.5** 결과 기록. 파일 변경·도구 실행 없는 단순 대화만.

## C1 — Claude 실제 외부 경로

- 선택지 ① 공식 Discord/Telegram plugin: bot 생성·token 설정은 신산님이 직접, pairing 후 allowlist 정책 적용.
- 선택지 ② 이어온 전용 채널 MCP 서버: 이어온 웹 질문을 같은 세션에 push. 연구 미리보기 동안 `--dangerously-load-development-channels`로만 시험 가능하므로 별도 승인.
- 판정: 같은 세션 맥락 사용·응답 도착·allowlist 밖 발신자 차단.

**C1 결과(2026-10-30): 이어온 전용 채널 왕복 PASS.** 이어온 측 전송 1회→세션 reply→REPLIED(62초). 발신자 차단은 토큰 대역 검사만.

## S2 — 최소 실증 경로

설계 추적: DESIGN 4·5·8·12. 1명·1대·엔진별 시험 세션 1개의 검증용 경로다.

- [x] **S2.1** `src/pilot/server.mjs`: 허용 세션 조회(엔진 포함)·질문 접수·상태/답변 API. raw user/thread/path/command를 신뢰하지 않는다.
- [x] **S2.2** `src/pilot/connector.mjs`: PC가 서버로 먼저 연결, 실행 전 durable receipt와 세션 잠금 확인. PC 수신 포트 없음.
- [x] **S2.3** `src/pilot/adapters/codex-thread.mjs`: 승인된 thread allowlist·잠금 사전 확인·`resumeThread`·결과 대조. 기본 live 실행 차단.
- [x] **S2.4** `src/pilot/adapters/claude-channel.mjs`: C1에서 고른 경로에 맞춘 전달·응답 수집. 세션 미실행 감지.
- [x] **S2.5** 확정한 웹 화면을 같은 API에 연결. 엔진 배지와 엔진별 busy/미실행 문구, unknown에 재전송 버튼 없음.

**S2 구현(2026-10-30):** 모델 없는 경로 검사 34/34, loopback 18760 live=false 실측(접수→연결부→live_disabled). live 왕복 Codex·Claude 각 1회 PASS(2026-10-30). 첫 검증은 loopback 한정이다.

## 결과 보고와 다음 결정

`docs/validation/FIRST_CONTINUITY_RESULT.md`에 엔진별로 commit·버전·대상 세션·turn 대응·원래 화면 증거·상태 전이·중복 turn 0·설정 보존·사용량/미확인을 기록한다. 상태는 PASS/FAIL/UNVERIFIED/BLOCKED이며 fixture PASS로 가리지 않는다. 신산님이 결과를 확인한 뒤에만 다음 범위를 확정한다.

## 현재 산출물·검증 상태

2026-10-30 기준 계획한 단계(S1·X0·X1·X2·C0·C1·S2)를 모두 수행했다. 종합 판정과 미확인 목록은 [결과서 0절](validation/FIRST_CONTINUITY_RESULT.md#0-종합-판정-2026-10-30)이다.

| 단계 | 판정 |
| --- | --- |
| S1 모델 없는 안전·내구성 | PASS (현재 전체 36/36) |
| X0·X1 Codex 번갈아 쓰기 | 조건부 PASS — 대상 대화를 Desktop에서 열지 않아야 함 |
| X2 Codex 동시 사용 | PASS — 사람 화면은 TUI |
| C0 Claude 공식 채널(fakechat) | 조건부 PASS — 구독 로그인·reply 승인 필요 |
| C1 Claude 이어온 전용 채널 | PASS — 개발 채널 플래그 |
| S2 최소 웹·서버·연결부 | PASS — Codex·Claude 각 1회 live 왕복, 모드 설정 포함 |

다음 범위는 신산님이 결과를 확인한 뒤 확정한다.

## 이력

v0.1 계획(S0~S3, 기존 Desktop runtime 직결 전제)의 실행 기록:

- S0: 설치 엔진 0.165.0-alpha.1.2 확인, 기존 local socket initialize 전 연결 거부(OS 10061), Desktop stdio/daemon WebSocket 구분. [FEASIBILITY](validation/FEASIBILITY.md), [연결 경로](validation/WINDOWS_DESKTOP_CONNECTION_PATH.md).
- Remote Control: 공개 client 계약 미확인으로 보류. [근거](validation/REMOTE_CONTROL_PUBLIC_CLIENT_AND_STANDALONE.md).
- 인증·resume 판정과 업무 대화 P0: 잠금 사전 검사 충돌(오류 33), 소유 후보 codex PID 21356(부모 Desktop PID 19212, 추론). 이후 업무 대화 제외. [판정서](validation/AUTH_RESUME_AND_ALTERNATION_ASSESSMENT.md).
- 다른 계정 클라우드 조회: 공식 로그인 1회 후 cloud list/status 각 1회, 목록 0개·NOT_FOUND. [결과](validation/CLOUD_ACCOUNT_ACCESS_RESULT.md).
- 관리 App Server 대안 검토: [검토서](design/MANAGED_APP_SERVER_OPTIONS_REVIEW.md).
- Channels·Codex 외부 입력 비교: [비교서](validation/CLAUDE_CHANNELS_CODEX_INPUT_REVIEW.md).
