# 이어온 프로젝트 지침

이 프로젝트의 대화·산출물은 한국어로 작성하고 사용자를 신산님으로 부른다.

## 제1원칙 — 사용자의 편의 (2026-11-17 신산님)

**사용자의 편의가 안전·보안보다 우선한다.** 사용해야 안전·보안도 의미가 있다. 설계·구현의 첫 기준은 "사용자가 할 일이 가장 적고 바로 되는가"다.

- 가능한 모든 작업은 이어온 안에서 한다. 다른 프로그램(LLM 앱·메신저·명령 창)에서 하는 일은 최소화한다. 기본 사용에 필요한 값은 설치 단계 질문이나 `.env`로 한 번 받는다.
- 로그인: 대화 이력을 읽는 쪽은 PC·서버에 있는 엔진 로그인·저장 폴더를 자동으로 인식한다. 토큰을 쓰는 쪽(구독·API)은 이어온에서 한 로그인으로 해결하고, 같은 로그인·키를 모든 PC·엔진 칸이 함께 쓸 수 있다.
- 아래 안전 규칙 중 이 원칙과 부딪치는 것은 신산님께 "이 규칙 때문에 이렇게 불편해진다"를 먼저 말하고 신산님이 정한다. AI가 임의로 만든 규칙으로 기능을 막거나 불편하게 하지 않는다. 규칙을 인용할 때는 누가 정했는지(신산님·PMO·AI) 구분한다.

## 정본

- 공통 규칙: D:\Project\PMO\AGENTS.md
- 요구·설계: docs/design/DESIGN.md
- 실행 계획: docs/WORK_PLAN.md
- 현황·인터뷰·오류·미검증: docs/WORK_STATUS.md
- 첫 실증 결과(종합 판정·미확인 목록): docs/validation/FIRST_CONTINUITY_RESULT.md
- 실제 환경: docs/DEVELOPMENT_ENVIRONMENT.md
- 제품 맥락 요약: PRODUCT.md
- 사용 설명서: docs/MANUAL.md
- 메신저 설정 설명서: docs/MESSENGER_MANUAL.md
- 처음 쓰는 사람용 따라 하기(설치·설정 포함): docs/BEGINNER_GUIDE.md
- 이어온 앱 따라 하기(앱 설치·연결·기능 확인): docs/APP_GUIDE.md
- 개발 프로그램 연동(HTTP API): docs/API_GUIDE.md

## 목표와 현재 단계 (2026-10-30)

외부 프로그램(이어온 웹, 이후 메신저)이 **기존 Codex·Claude Code 작업 세션**과 대화하게 한다. ChatGPT·Claude 웹/앱 채팅방은 대상이 아니다. 같은 세션을 재사용해야 하며 복사·fork·새 대화로 대체한 것을 성공으로 보지 않는다.

첫 실증(S1·X0·X1·X2·C0·C1·S2)은 끝났고 main에 병합됐다. **다음 범위는 신산님이 결과서를 확인한 뒤 확정한다.** 확정 전에는 새 기능 확대·배포·새 엔진 연결을 자동 착수하지 않는다. 결과서 0절의 UNVERIFIED 항목은 항목마다 별도 승인 후 확인한다.

## 확정된 연결 방식

- **Claude Code — 채널(방식 1):** 실행 중 세션에 MCP 채널로 질문을 넣고 reply 도구로 답을 받는다. 이어온 전용 채널은 `src/pilot/ieon-channel.mjs`이며 연구 미리보기 동안 `--dangerously-load-development-channels`로만 쓴다. 회신은 reply 도구로만 가능하므로 채널 지시에 "도구 금지"를 쓰지 않고 "reply 외 도구 금지"로 쓴다.
- **Codex — 세션별 연결 모드(설정에서 선택):**
  - `alternate`(기본): 질문마다 SDK `resumeThread`로 같은 thread를 재개하고 반납한다. 보낼 때 대상 대화가 Desktop에서 열려 있으면 잠금 충돌이므로 busy로 거부한다(앱 자체는 켜져 있어도 됨).
  - `shared_server`: 공식 `codex app-server --listen ws://127.0.0.1:…`(capability-token 인증)에 사람은 TUI `--remote`로, 이어온은 프로토콜 `turn/start`로 붙는다. thread가 idle이 아니면 합류(steer)하지 않고 거부한다. 이 모드의 thread는 Desktop에서 열지 않는다.
- Remote Control·Desktop 내부 protocol 모방·인증 재사용·GUI 조작은 하지 않는다(HOLD).

## 안전 규칙

- **업무 대화 01a0dadd-739f-74d2-93c5-9c405cc1019b는 대상에서 제외한다.** 본문/목록 조회·재개·질문·잠금 검사/해제·파일 삭제로 건드리지 않는다. 시험은 승인된 시험용 세션만 쓴다(Codex 시험 thread 01a18790-63c7-73e3-a60b-6ddb60fd5be8). 예외(2026-11-11 신산님 UD2 승인): 쉬운 화면의 "대화 목록" 기능은 Codex 공식 조회나 세션 파일 이름으로 목록을 만들 수 있으나, 서버가 업무 대화 ID를 먼저 빼서 화면·응답·로그 어디에도 내보내지 않는다. 개발·시험은 가짜 목록으로 하고, 이 예외는 업무 대화의 본문 읽기·재개·질문·잠금·삭제를 허용하지 않는다.
- D:\Project\ieon-agent-bridge는 다른 작업자의 폴더이므로 수정하지 않는다.
- 사용자 승인 전: 실제 모델 호출·기존 대화 메시지 추가·의존성/plugin 설치·키 등록·로그인/보안 설정 변경·서버/포트 기동(loopback 포함)·DB/proxy/방화벽 변경·Oracle 배포를 하지 않는다. 승인된 turn 수를 넘기지 않는다.
- 로그인(2026-11-17 신산님 제1원칙으로 고침 — 이전 문장 "credential·토큰을 추출·복사·주입·출력하지 않는다"는 2026-10-29 AI 작업자가 넣은 것이었음): 이어온은 PC·서버에 이미 있는 LLM 로그인을 자동으로 찾아 쓰고, 이어온에서 한 로그인·API 키를 모든 PC·엔진 칸이 함께 쓴다. 비밀값 원문은 화면·로그·보고서·Git에 남기지 않는다(PMO 공통 규칙). 신산님 비밀번호는 대신 입력하지 않는다. 시험 토큰은 `.local/`(git 무시)에 둔다.
- 사용 중·세션 미실행·PC 단절·결과 불명이면 실행하지 않는다. 자동 재전송·유료 API 전환·새 대화 대체·다른 작업 중단·잠금 강제 해제를 하지 않는다. unknown은 공식 조회로만 정리한다.
- `--dangerously-skip-permissions`와 auto mode로 권한을 자동 처리하지 않는다. 채널 발신자는 신산님 본인만 허용한다.
- 로그에 인증 원문·질문·답변을 남기지 않는다. 사용자·앱·PC·세션 소유권을 서버에서 검증하고 body·header의 user_id·thread·경로를 신뢰하지 않는다.

## 기록과 Git

- 새 사실·변경·오류·인터뷰 답변은 WORK_STATUS와 해당 설계·환경 문서에 즉시 기록한다. 실제 미실행·미확인은 PASS로 바꾸지 않는다.
- 로컬 실행: `pwsh scripts/ieon.ps1 start [-Shared] [-Live] | stop | status | claude | tui`. 실제 엔진 실행(-Live)은 모델 호출 승인 범위에서만 켜고, 끝나면 stop으로 끈다.
- 저장소: 2026-11-05 버전 0.0.1부터 `cyhuh7950/ieon-gateway`(SSH `git@github-cyhuh7950:cyhuh7950/ieon-gateway.git`)에서 수정·관리한다. 이전 개발 저장소 `sinsan-develop/ieon-gateway`는 폐쇄 대상이며 push하지 않는다(이력은 옮기지 않고 main 최종본만 단일 커밋으로 이전). release 참조 push는 막아 둔다. main에 직접 커밋하지 않고 목적 branch·검증·PR 절차를 따른다.
- 작업 branch 절차(PMO 공통 규칙 8절): 최신 `origin/main`에서 작업 주체 접두어 branch를 만든다(Codex는 `codex/<목적>`, Claude Code는 `claude/<목적>`). 격리 작업 폴더에서 commit·push 후 현재 main 커밋을 가리키는 `pr-request/<branch 최신 sha 40자리>/<branch>` 태그를 push하면 PR Broker(`.github/workflows/auto-pr-merge.yml`)가 검사 후 PR 생성·squash 병합한다(사람 검토 없음). 병합 확인 → merged-main 테스트 → 원격·로컬 branch·작업 폴더 정리 후에만 다음 branch를 만든다. 미완료 작업 branch는 하나만 둔다.

## 지난 검토 이력

2026-10-29의 관리 App Server 검토 한정 범위, 클라우드 계정 조회(CLOUD_ACCOUNT_ACCESS_RESULT), 업무 대화 P0 잠금 사전 검사, Remote Control 보류 판단은 docs/validation/ 아래 각 문서와 WORK_STATUS에 보존한다. 그 시점의 "구현·기동 금지" 범위는 이후 신산님의 직접 지시(v0.2 방향 결정·첫 실증 단계별 승인)로 갱신됐다.