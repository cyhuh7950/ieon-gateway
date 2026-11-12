# A0 실측 준비 — 이어온 전용 계정 + Desktop 세션 이어 쓰기

작성 2026-11-12(신산님 "A0 실측 준비"). 이 문서는 **준비**다. 아래 실측은 아직 하나도 하지 않았다(모델 호출 0, 로그인 0, 폴더 생성 0).
근거 설계: `docs/design/ENGINE_ACCOUNTS.md` 원칙 0·3-2(B안), WORK_PLAN A0.

## 1. 준비 중 확인한 사실(읽기만)

| # | 사실 | 근거 |
|---|---|---|
| F1 | Codex는 **로그인(auth.json)과 세션 기록(sessions·archived_sessions)·잠금(thread-writer-locks)·상태 DB(state_5.sqlite)를 한 폴더 `%USERPROFILE%\.codex`에 둔다.** | 폴더 이름 목록만 확인(파일 내용은 읽지 않음) |
| F2 | 공식 문서: `CODEX_HOME`은 "config, auth, logs, sessions…"의 뿌리. **세션 위치만 따로 정하는 설정은 없다.** | learn.chatgpt.com 환경 변수·설정 참조(2026-11-12) |
| F3 | 공식 문서: **상태 DB 위치는 따로 정할 수 있다** — `sqlite_home`(설정) 또는 `CODEX_SQLITE_HOME`(환경 변수, 설정이 우선). | 같은 문서 |
| F4 | 공식 문서: 로그인 보관 방식 `cli_auth_credentials_store = file \| keyring \| auto \| ephemeral`. keyring 항목을 무엇으로 구분하는지는 문서에 없음. 이 PC 설정에는 지정 없음(기본값). | 같은 문서, config.toml에서 그 키 한 줄만 검색 |
| F5 | 공식 문서: `CODEX_API_KEY`는 "비대화형 Codex 실행에 API 키를 준다". 이어온이 쓰는 SDK(0.165.0)는 `new Codex({ apiKey })`를 이 변수로 넘긴다 → **API 키 방식은 `.codex`를 바꾸지 않고도 가능.** | 문서 + `node_modules/@openai/codex-sdk` |
| F6 | SDK는 `new Codex({ env, baseUrl, apiKey, config })`를 받는다 → 질문마다 `CODEX_HOME`·`CODEX_SQLITE_HOME`을 넘길 수 있다. 지금 이어온은 옵션 없이 `new Codex()`(PC 기본 로그인). | `codex-thread.mjs:33·108·116` |
| F7 | **잠금 판별 주의:** `lock-probe.mjs:38`(리눅스)은 `process.env.CODEX_HOME`을 따라간다. 이어온 전용 `CODEX_HOME`을 프로세스 전체에 걸면 **Desktop 잠금이 아닌 빈 폴더를 보게 된다.** 윈도 판별(`lock-probe.ps1`)은 `%USERPROFILE%\.codex` 고정이라 괜찮음. → 구현 때 잠금 폴더는 "Desktop 폴더"로 명시해야 함(A2 할 일). | 코드 |
| F8 | 이미 있는 `codex-login.mjs`(허브 W5)가 `env`를 받아 공식 `codex login --device-auth`를 띄운다 → `CODEX_HOME`만 바꿔 넘기면 **이어온 전용 폴더에 공식 로그인**을 웹에서 할 수 있다(파일을 읽거나 옮기지 않음). | 코드 |
| F9 | 사용 한도 오류 모양은 이미 실물 확보: `turn.failed` + "You've hit your usage limit… try again at 7:04 PM."(A1에서 처리). A0 ⑤는 **추가 호출 없이 완료로 본다**(다른 모양이 나오면 그때 보탬). | A1, a1-accounts 시험 |

## 2. 실측할 구성(Codex, B안)

이어온 전용 폴더 `.local/accounts/codex/<이름>/`을 이어온 질문의 `CODEX_HOME`으로 쓴다.

| 항목 | 위치 | 방법 |
|---|---|---|
| 로그인(auth) | 이어온 전용 폴더 | 신산님이 웹 "Codex 로그인"(기기 코드)으로 공식 로그인. 이어온은 파일을 읽지 않음 |
| 세션 기록 `sessions`, `archived_sessions` | Desktop 폴더 | 전용 폴더 안에 **디렉터리 연결(junction, 관리자 권한 불필요)** |
| 잠금 `thread-writer-locks` | Desktop 폴더 | junction — **Desktop과 같은 잠금 폴더를 봐야** 동시 쓰기를 서로 안다 |
| 상태 DB | Desktop 폴더 | 공식 `CODEX_SQLITE_HOME=%USERPROFILE%\.codex`(F3) — 파일 연결 없이 |
| 설정 config.toml | 전용 폴더 | 최소 설정만(모델·MCP 등 Desktop 설정을 복사하지 않음; 필요한 것만 확인 후) |

API 키 방식(F5)은 이 구성이 필요 없다 — 같은 `.codex`에 `CODEX_API_KEY`만 넘긴다. 키 등록은 별도 승인.

## 3. 절차와 승인 단위

대상은 **Codex 시험 thread `01a18790-63c7-73e3-a60b-6ddb60fd5be8`만**. 업무 대화 `01a0dadd-…`는 목록·본문·잠금 어디에도 쓰지 않는다. 각 단계 결과는 `docs/validation/a0-*.json`과 WORK_STATUS에 남기고, 미실행은 PASS로 적지 않는다.

| 단계 | 내용 | 모델 호출 | 신산님 할 일 / 승인 |
|---|---|---|---|
| A0-1 | 전용 폴더 만들기 + junction 3개 + 최소 config. 시험 하나: 전용 `CODEX_HOME`으로 `codex login status`(로그인 전이라 "안 됨"이 정상) | 0 | 승인(이 PC `.local` 안 폴더 생성) |
| A0-2 | 전용 폴더에 공식 로그인(기기 코드). `login status`로 로그인됨만 확인(계정 이메일 등은 읽지 않음) | 0 | **신산님이 직접 로그인** — 어느 계정으로 할지 결정(Desktop의 "MS"와 다른, 한도가 남은 계정 권장) |
| A0-3 | 잠금 판별: 시험 thread를 Desktop에서 열어 둔 상태 → 이어온 판별이 "Desktop이 잡고 있음"으로 거부하는지, 닫으면 풀리는지. 질문은 판별에서 멈춤 | 0 | Desktop에서 시험 대화 열기·닫기 |
| A0-4 | 전용 계정으로 시험 thread 이어 쓰기 1회("한 줄로 자기소개"). 확인: 답이 오는지, 기록이 Desktop의 `sessions` 파일에 이어지는지, 이전 답의 암호화 조각 때문에 실패하는지 | **1** | 호출 1회 승인 |
| A0-5 | Desktop에서 그 시험 대화를 다시 열어 이어온이 쓴 질문·답이 보이는지, 목록 순서·상태가 어긋나지 않는지 | 0(신산님이 Desktop에서 보기만) | 화면 확인 |
| A0-6 | (선택) Claude Code: `.local/accounts/claude/<이름>`을 `CLAUDE_CONFIG_DIR`로, `projects`는 `%USERPROFILE%\.claude\projects`에 junction, 공식 `/login` 후 **시험용 Claude 세션** 이어 쓰기 1회 | **1** | 신산님 로그인, 시험용 Claude 세션 지정(지금 승인된 시험 세션 없음), 호출 승인 |
| A0-7 | (선택) Claude Code × Solar: 신산님의 기존 `claude-solar`로 시험 Claude 세션 이어 쓰기 + 도구 호출 1개(파일 읽기) 1회, 원래 Claude 모델로 돌아와 1회 | **2** | 키는 신산님 기존 설정 그대로(이어온이 읽지 않음), 호출 승인 |

필수(Codex)만 하면 **모델 호출 1회**, Claude까지 하면 2회, Solar까지 하면 4회.

## 4. 멈춤 조건(하나라도 나오면 그 자리에서 멈추고 보고)

- 잠금 판별이 Desktop의 열림을 못 알아봄(A0-3) → B안 중단, A4(엔진 폴더 로그인 바꾸기) 검토.
- 이어 쓰기가 새 대화를 만들거나 fork로 대체됨, 기록이 Desktop 파일이 아닌 곳에 생김 → 실패로 기록.
- Desktop에서 시험 대화가 깨지거나 목록에서 사라짐 → 전용 폴더 연결을 끊고(junction 삭제만, 대상 파일은 건드리지 않음) 보고.
- 업무 대화 ID가 어떤 출력·로그에 나타남 → 즉시 중단.
- 결과 불명 → 다시 보내지 않고 공식 조회로만 정리.

## 5. 되돌리기

전용 폴더 `.local/accounts/codex/<이름>/`의 junction을 먼저 지우고(연결만 삭제) 폴더를 지운다. 로그인 해제는 신산님이 `codex logout`(그 폴더 기준)으로. Desktop `.codex`의 파일은 어떤 단계에서도 만들거나 지우지 않는다(이어 쓰기로 시험 thread 기록이 늘어나는 것만 예외).

## 6. 아직 모르는 것(실측으로 답할 것)

1. 전용 `CODEX_HOME`의 CLI가 junction된 `sessions`에서 시험 thread를 찾는가(A0-4).
2. 상태 DB를 공유(`CODEX_SQLITE_HOME`)해도 Desktop 앱과 충돌이 없는가(A0-4·5).
3. 계정이 바뀐 상태로 이전 답의 암호화 조각(encrypted reasoning)을 이어 받을 수 있는가(A0-4).
4. Claude는 `CLAUDE_CONFIG_DIR`를 바꿔도 `projects` 연결로 기존 세션을 이어 쓰는가(A0-6).
