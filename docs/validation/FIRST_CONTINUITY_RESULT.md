# 첫 이어쓰기 실증 결과 — Codex·Claude Code (X0~X2·C0·C1·S2)

## 0. 종합 판정 (2026-10-30)

| 경로 | 판정 | 조건·제약 | 근거 |
| --- | --- | --- | --- |
| Codex 번갈아 쓰기(`alternate`) | 조건부 PASS | 이어온이 보낼 때 대상 대화가 Desktop에서 열려 있지 않아야 함(앱 자체는 켜져 있어도 됨, S2 실측). Desktop 반영은 대화를 다시 열 때 | 1~5절, 9절 |
| Codex 동시 사용(`shared_server`) | PASS | 사람 화면은 공식 TUI. 공유 엔진 상시 실행·loopback·토큰 | 6절 |
| Claude 공식 채널(fakechat) | 조건부 PASS | 구독 계정 로그인, reply 승인, 회신은 reply 도구로만 | 7절 |
| Claude 이어온 전용 채널 | PASS | 연구 미리보기 개발 플래그, 질문당 reply 1회 | 8절 |
| 이어온 웹→서버→연결부→엔진 | PASS | Codex·Claude 각 1회, loopback, 재전송 0 | 9절 |

공통으로 지킨 것: 같은 세션 재사용(복사·fork·새 대화 없음), 업무 대화 미접촉, 자동 재전송·유료 API 전환 0, 질문·답변·토큰 원문 비기록. 모델 turn은 단계마다 승인 범위 안에서 쓰되 C0은 로그인 만료 중 대기 메시지 자동 처리로 1회 초과.

**UNVERIFIED (별도 승인 필요):** C1 reply 권한 확인 생략 원인(재현됨, 설정 규칙은 배제, Claude Code 2.1.312→2.1.314 변경 가능성), 실제 휴대폰 키보드 가림(화면 표시는 Tailscale로 확인). 메신저(텔레그램·디스코드·슬랙) Codex 왕복은 PASS(2026-10-31).

- 기록: 2026-10-30 / 어울 / branch `feat/s1-safety-core`
- 대상: Codex Desktop 시험용 로컬 대화 `01a18790-63c7-73e3-a60b-6ddb60fd5be8`("시험 표식 확인"). 업무 대화 01a0dadd…는 대상 제외·미접촉.
- 버전: Desktop 동봉 엔진 0.165.0-alpha.1.2, 이어온 측 `@openai/codex-sdk` 0.165.0(동봉 codex 0.165.0). npm CLI 0.161.0은 사용하지 않음.
- 판정: **Codex 방식 2 기본 왕복 PASS(조건부)** — 같은 thread로 Desktop → 이어온 → Desktop 맥락이 양방향으로 이어졌다. 조건: 이어온이 재개하려면 Codex 앱이 종료되어 있어야 하고, Desktop은 다시 실행한 뒤 이어온 turn을 표시했다.

## 1. 잠금 반납 조건 (X0)

| 시각(KST) | 상황 | 검사 결과 | 증거 |
| --- | --- | --- | --- |
| 10-29 21:09 | Desktop에서 대화 연 상태 | WRITER_LOCK_CONFLICT(33) | [x0-lock-open](x0-lock-open-20261029.json) |
| 10-29 21:11 | 대화 닫은 직후 | WRITER_LOCK_CONFLICT(33) | [x0-lock-closed](x0-lock-closed-20261029.json) |
| 10-29 21:22 | 닫고 약 11분 대기 | WRITER_LOCK_CONFLICT(33) | [x0-lock-wait10m](x0-lock-wait10m-20261029.json) |
| 10-30 13:39 | 신산님이 앱 직접 종료 | NO_LOCK_FILE, codex 프로세스 없음 | [x0-lock-appquit](x0-lock-appquit-20261030.json) |

검사는 매번 [lock-probe.ps1](../../src/pilot/lock-probe.ps1)로 1회(읽기 전용·비차단·즉시 닫음, 생성·삭제·쓰기 없음)만 수행했다. Desktop은 대화를 닫거나 10분 기다려도 writer 잠금을 놓지 않았고, 앱 종료 시 잠금 파일까지 정리했다.

## 2. 사용자 turn 3회 (X1)

| 순서 | 위치 | 내용 요약 | 결과 |
| --- | --- | --- | --- |
| D1 | Desktop (10-29 21:09) | 표식 A "사과" 지정 | 신산님 수행 |
| I1 | 이어온 SDK (10-30 13:42) | 앞선 표식 질문 + 표식 B "바나나" 지정 | `resumeThread` 1회·turn 1회 COMPLETED, 반환 thread ID 동일, A 정답. 도구 실행 없음, 실행 후 잠금 반납. [x1-i1-resume](x1-i1-resume-20261030.json) |
| 반영 | Desktop 재실행 후 | 대화 화면 확인 | D1 뒤에 I1 질문·답변이 같은 대화로 표시(신산님 캡처) |
| D2 | Desktop (10-30) | "새 시험 표식이 뭐였지?" | "바나나" — 이어온 turn의 맥락이 Desktop에서 이어짐(신산님 캡처) |

승인된 사용자 turn 3회를 모두 사용했다. 자동 재시도·추가 turn·유료 API 전환은 없었다.

## 3. 판정표

| 항목 | 결과 |
| --- | --- |
| 같은 thread ID 재사용(새 대화·fork 없음) | PASS |
| Desktop → 이어온 맥락 | PASS (A 정답) |
| 이어온 → Desktop 반영·맥락 | PASS (화면 표시, B 정답) — 앱 재실행 후 확인 |
| Desktop 점유 중 외부 재개 차단 | PASS (OS 잠금 충돌 3회 관찰, 재개 시도 0) |
| 실행 중 Desktop 화면 실시간 갱신 | UNVERIFIED (앱 종료 상태에서만 실행) |
| 이어온 turn 중 Desktop 입력 차단 | UNVERIFIED (시행 안 함) |
| 원래 thread 설정 보존 | UNVERIFIED (ThreadOptions 미전달, 작업 디렉터리 변경 여부 미확인) |
| 이어온 서버·연결부를 통한 왕복 | NOT_RUN (직접 실행기로만 확인, S2 범위) |

## 4. 확인 필요 사항

1. I1 항목 중 `error` 1건: 내용을 저장하지 않아 원인 미상. turn은 정상 완료.
2. I1 input_tokens 185,518(cached 113,408): 단순 대화치고 크다. 작업 폴더 지침·도구 정의 포함으로 추정, 미확인. 운영 시 비용 판단에 필요하다.
3. 작업 디렉터리: SDK 실행 위치가 이 저장소였다. 원래 대화의 작업 폴더가 바뀌었는지 Desktop 설정으로 확인 필요.

## 5. 설계에 주는 의미

- 방식 2(thread 매핑·재개)는 공식 SDK만으로 실제로 동작한다.
- 그러나 **Desktop과 번갈아 쓰려면 매번 Codex 앱을 종료해야 한다.** 대화 닫기로는 잠금이 풀리지 않는다. 일상 사용에는 불편이 크다.
- 대안 검토 대상: ① Desktop 대신 공식 TUI를 공유 App Server(`codex app-server --listen` + `--remote`)에 붙이고 이어온은 같은 서버로 `ExternalMessage`/queue 사용, ② Desktop은 확인용으로만 쓰고 이어쓰기는 이어온 전용으로 운영. 방향은 신산님이 결정한다.

## 6. 동시 사용 모드(shared_server) 실증 — X2 (2026-10-30)

| 단계 | 결과 | 증거 |
| --- | --- | --- |
| X2.0 문서 확인 | 0.165.0 `app-server --listen ws://`·`--ws-auth capability-token`·TUI `--remote`·프로토콜 `turn/start` 확인 | [X2.0 확인서](X2_0_SHARED_SERVER_DOC_CHECK.md) |
| X2.1 기동·연결(모델 0) | 앱 종료 후 127.0.0.1:18761 토큰 인증 기동, TUI로 시험 thread 열림(이력 표시), 이어온 접속·loaded 확인, 공유 엔진이 writer | [status](x2-1-status-20261030.json), [lock](x2-1-lock-shared-20261030.json) |
| X2.2 T1 (TUI) | 표식 C "체리" | 신산님 캡처 |
| X2.2 I1 (이어온) | idle 확인 후 `turn/start` 1회 COMPLETED, C 정답·D "포도" 전달. TUI에 질문·진행·답이 실시간 표시 | [i1](x2-2-i1-turn-20261030.json), 캡처 |
| X2.2 T2 (TUI) | "포도" — 이어온 맥락이 TUI에서 이어짐 | 캡처 |
| X2.3 종료 | 공유 엔진 종료 후 NO_WRITER_LOCK | [lock](x2-3-lock-stopped-20261030.json) |

판정: **동시 사용 모드 기본 왕복 PASS** — 앱 종료·재실행 없이 같은 thread를 사람(TUI)과 이어온이 번갈아 쓰고 실시간으로 본다. 미확인: 이어온 turn 중 TUI 입력, 실제 경합에서 reject_busy, usage 수집(turn/completed에 없음), TUI 경고 1건·미신뢰 hook 1건 내용, 사용 화면이 Desktop이 아니라는 제약은 그대로.

## 7. Claude Code Channels 실증 — C0 (2026-10-30)

- 환경: Claude Code 2.1.312, Bun 1.4.4, `fakechat@claude-plugins-official`(시험 폴더 `.local/c0` local 범위), 구독 계정(Claude Pro) 로그인.

| 항목 | 결과 |
| --- | --- |
| 채널 → 실행 중 세션 전달 | PASS (터미널 `← fakechat · web:` 수신 줄) |
| 세션 → 채널 회신 | PASS (reply 도구, 신산님 1회 승인, 웹에 인용 답장) |
| 세션 종료 후 전송 | PASS: 도달 불가(8787 listen 0). 단 웹 화면은 실패를 알리지 않음 |
| 로그인 만료 | 첫 시도 차단. 비구독 계정은 연결 불가, 구독 계정 로그인 후 진행 |

주의: ① "도구 금지" 지시는 reply 도구까지 막아 회신이 터미널에만 남는다. ② 로그인 만료 중 받은 메시지는 재로그인 후 자동 처리되어 모델 turn이 1회 늘었다(중복 실행 위험). ③ 저장소 하위 폴더 세션은 상위 지침을 읽는다. 모델 turn 총 3회.

## 8. 이어온 전용 채널 실증 — C1 (2026-10-30)

- 구성: `src/pilot/ieon-channel.mjs`(의존성 없는 MCP stdio 채널, 127.0.0.1:18762 Bearer 토큰), `claude --dangerously-load-development-channels server:ieon`(시험 폴더 `.local/c1`), Claude Code 2.1.314·Claude Pro.
- 결과: 이어온 측 질문 1회 → 실행 중 세션 수신 → reply_to=request_id로 reply(신산님 1회 승인) → 이어온 측 REPLIED, 62초, 재전송 0. [증거](c1-send-20261030.json).
- 관찰: 터미널 직접 입력에는 message_id가 없어 세션이 reply를 거부(오답장 방지). 단독 검사: 토큰 없는 접속 401, 같은 request_id 409, 다른 reply_to 거부(28/28).
- 미확인: 실세션에서 무단 발신자 차단, 세션 종료 후 전송, reply 상시 허용 운영.

## 9. 최소 실증 경로 — S2 (2026-10-30)

- 구성: `src/pilot/server.mjs`(127.0.0.1:18760) · `connector.mjs`(PC→서버 polling, 실행 전 receipt) · `adapters/codex-thread.mjs`(alternate/shared_server) · `adapters/claude-channel.mjs` · `web/index.html`. 설정·토큰은 `.local/s2`(git 무시).
- 모델 0 검사: 36/36(소유권·토큰·PC 미연결 503·busy·desktop_holds_thread·session_not_running·unknown 재실행 금지·모드 전환).
- live 왕복(신산님 웹 화면 조작):

| 엔진 | 질문 → 답 | 서버 상태 | 사후 |
| --- | --- | --- | --- |
| Codex alternate(시험 thread) | 마지막 표식 → "포도"(X2 맥락) | completed·receipt | 잠금 없음. Codex 앱 실행 중이었으나 대상 대화를 열지 않아 충돌 없음 |
| Claude 이어온 채널 | "수박" → "수박 받았습니다." | completed·receipt | 재전송 0. reply 권한 확인 화면이 뜨지 않음(원인 미확인) |

- X2.4: 대화별 연결 모드 저장·전환 API·웹 설정 영역 구현. 처리 중이면 전환 거부, 잠금 반납은 다음 실행 때 모드별 사전 확인으로 막음. 실제 화면 조작은 미확인.

## 10. 미확인 항목 검증 1차 (2026-10-30)

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| Codex SDK 재개 시 원래 설정 보존 | **FAIL → 수정 후 PASS.** 수정 전 SDK turn은 이 PC config.toml을 따라 `danger-full-access`·`approval never`·이어온 폴더로 실행됨(도구 실행은 없었음). 수정 후 `read-only`·`never`·원래 폴더 `C:\Users\cyhuh\Documents\Codex`로 실행됨 | 시험 thread rollout turn_context, live 2회 |
| `--cd` 옵션 | exec resume에서 os error 2로 실패 → 프로세스 시작 시점 폴더 지정으로 대체 | live 실패 1회(모델 0) |
| 큰 input_tokens | 해소: SDK usage는 thread 누적값. 실제 turn은 6만~13만 입력 중 대부분 캐시 | rollout token_count |
| X1 `error` 항목 | 미해소(추정): rollout에 없음, SDK 스트림 비치명 경고로 보임 | 매 SDK 실행마다 1건 |
| C1 reply 권한 확인 생략 | 미해소: 허용 규칙 없음 확인 | 설정 파일 조회 |

## 11. 미확인 항목 검증 2차 (2026-10-30, 모델 0)

| 항목 | 결과 |
| --- | --- |
| 실세션 무단 발신자 차단(C1) | PASS: 토큰 없음·틀린 토큰·다른 용도 토큰 모두 401, 세션 수신 없음 |
| 웹 Codex 모드 설정 조작 | PASS: 전환·복귀 반영, Claude 대화에는 설정 영역 없음. API 실측 200/400/400/200 |
| 모바일 폭(375px) | 한 줄 배치·가로 잘림 없음(브라우저 폭 변경). 실제 휴대폰 미확인 |
| 웹 안내 문구가 바로 사라짐 | 결함 수정: 주기 새로고침이 안내를 지우지 않게 함 |

## 12. 미확인 항목 검증 3차 (2026-10-30, 모델 6회)

| 항목 | 결과 |
| --- | --- |
| 동시 사용 모드 사용량 수집 | PASS: `thread/tokenUsage/updated`의 turn별 last 합산(예: input 140,287·cached 133,248·output 15), 서버 저장·API 반환 |
| 사람이 TUI에서 처리 중일 때 이어온 질문 | PASS: `thread_busy`로 거절, turn/start 없음, TUI 답에 섞임 없음 |
| 이어온 처리 중 사람 TUI 입력 | 섞임 없음 PASS. 대기열/합류 방식은 이어온 turn이 3초로 짧아 구분 못함 |
| SDK `error` 항목 | 해소: config.toml 미인식 설정(`computer_use.windows.always_allowed_app_ids`) 경고, 비치명 |
| C1 reply 권한 확인 생략 | 재현됨(manual mode, 허용 규칙 없음), 원인 미확인. reply는 채널 답장만 가능 |

## 13. 동시 사용 모드 — 이어온 처리 중 TUI 입력 (2026-10-30, 모델 1)

- 결과: **FAIL(답 오염) → 감지 수정.** 이어온 turn(101~220 목록) 진행 중 TUI에서 Enter로 입력하자 대기열이 아니라 같은 turn에 합류(steer)했고, 모델은 사람 입력에 답("확인")했으며 이어온은 그것을 정상 완료로 받았다. rollout상 한 turn에 user 메시지 2개.
- 수정: 공유 모드 어댑터가 turn 안의 userMessage가 2개 이상이면 `unknown`(`turn_joined_by_other_input`)으로 보고하고 답을 저장하지 않는다. **실제 엔진으로 감지 확인(PASS, 21:05).** unknown 잠금 정리는 아직 수동이다.
- 운영 규칙 후보: 동시 사용 모드에서 이어온 처리 중 사람은 TUI에서 Tab(대기열)으로만 입력한다. 3초짜리 A3에서 섞임이 없었던 것은 turn이 먼저 끝났기 때문이다.
