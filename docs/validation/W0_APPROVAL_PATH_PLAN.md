# W0 실측 준비 — 엔진의 승인 요청을 이어온 승인 카드로 받을 수 있나

작성 2026-11-13(신산님 "계속하자"). 이 문서는 **준비**다. 실측은 아직 하지 않았다(모델 호출 0, 서버·포트 기동 0).
근거 설계: `docs/design/WORK_AND_VOICE.md` A2·A3·WV1~WV4, WORK_PLAN W0.

## 1. 준비 중 확인한 사실(읽기만, 이 PC에서 공식 도구로 프로토콜 정의만 뽑음)

| # | 사실 | 근거 |
| --- | --- | --- |
| F1 | **Codex SDK(번갈아 쓰기에 쓰는 것, 0.165.0)에는 승인 요청을 넘겨받는 길이 없다.** `approvalPolicy`를 넘길 수만 있고, 이벤트 종류에 승인 요청이 없다(SDK는 `codex exec` 비대화형 실행) | `node_modules/@openai/codex-sdk/dist/index.d.ts` |
| F2 | **Codex app-server 프로토콜에는 승인 요청이 있다.** 서버 → 이어온 요청 `item/commandExecution/requestApproval`(명령·작업 폴더·이유), `item/fileChange/requestApproval`(바꿀 파일·이유), `item/permissions/requestApproval`. 답은 `accept`·`acceptForSession`·`decline`·`cancel` — 이어온은 **`accept`(이번 한 번)와 `decline`만** 쓴다(항상 허용 없음, WV1) | `codex app-server generate-json-schema`(0.165.0) |
| F3 | `turn/start`·`thread/resume`이 **차례마다** `approvalPolicy`(`untrusted`·`on-request`·`never`)·`sandboxPolicy`·`approvalsReviewer`를 받는다 → 작업 모드인 차례만 승인을 묻게 할 수 있다 | 같은 정의 |
| F4 | **`approvalsReviewer` 기본은 `user`, `auto_review`(AI가 대신 판단)도 있다.** 이어온은 늘 `user`로 명시해야 한다(자동 승인 금지) | 같은 정의 |
| F5 | 지금 이어온의 공유 서버 경로(`runShared`)는 서버가 보내는 요청(승인 요청)에 **답하지 않는다** — 오면 답이 없어 시간 초과(180초)까지 멈춘다. 지금은 명령 실행이 시작되면 차례를 멈추는 방식이라 실제로는 거의 오지 않음 | `src/pilot/adapters/codex-thread.mjs` |
| F6 | **번갈아 쓰기도 app-server를 쓸 수 있다**: 질문마다 `codex app-server`를 표준 입출력(stdio, 포트 없음)으로 잠깐 띄워 `thread/resume`·`turn/start` 하고 끝나면 닫는 방식(OpenMausBot과 같음). 잠금(Desktop이 열어 두면 거부)은 같은 잠금 파일을 쓰므로 그대로 | 위 정의, OpenMausBot `codex.ts`(WORK_AND_VOICE 0절) |
| F7 | Claude Code 2.1.314: `-p`(비대화형)에서 `--permission-prompts host`(SDK 호스트 또는 `--permission-prompt-tool`)/`none`(묻는 것은 모두 자동 거부). 승인 도구는 MCP 도구로 둔다 | `claude --help` |

**지금 결론(실측 전):** Codex는 **app-server 경로로만** 승인 카드가 가능해 보인다(SDK 번갈아 쓰기는 불가 → 번갈아 쓰기의 작업 모드는 F6 방식으로 바꾸면 가능). Claude 새 세션은 `--permission-prompt-tool`로 가능해 보인다. 실제 왕복은 아래 실측으로 확인한다.

## 2. 실측 절차

공통: **기존 대화는 쓰지 않는다**(업무 대화·시험 thread 01a18790 포함). 실측마다 `.local/w0/<엔진>/ws` 임시 작업 폴더에 **새 시험 세션**을 하나 만든다. 서버·포트는 띄우지 않는다(app-server·MCP 도구는 표준 입출력 자식 프로세스). 결과는 `docs/validation/w0-*.json`에, 명령·파일 내용 원문은 남기지 않는다(종류·허용/거부·결과만).

| 단계 | 내용 | 모델 호출(차례) | 확인할 것 |
| --- | --- | --- | --- |
| W0-1 | Codex app-server(stdio) + 이어온 전용 계정(A0의 `.local/accounts/codex/a0`, 없으면 PC 기본 로그인 — 신산님 선택) 새 thread, `approvalPolicy: untrusted`·`sandboxPolicy: workspaceWrite(네트워크 없음)`·`approvalsReviewer: user`. 지시: "ws 안에 a.txt를 만들고 `dir`을 실행" → **파일 수정 요청은 허용, 명령 요청은 거부**로 답함 | **1** | 승인 요청이 오는지(종류·내용), 허용한 것만 실행되는지(a.txt 있음, 명령 결과 없음), 거부 뒤 차례가 정상으로 끝나는지, 답하지 않으면 어떻게 되는지(15분 대신 시험은 60초 뒤 거부) |
| W0-2 | (선택) Codex SDK 번갈아 쓰기에 `approvalPolicy: on-request`로 같은 지시 | **1** | F1대로 승인을 넘겨받지 못하는지, 그때 엔진이 어떻게 하는지(자동 거부·실패·멈춤) — 실측 없이 F1로 갈음해도 됨 |
| W0-3 | Claude `-p` 새 세션 + 시험용 승인 MCP 도구(stdio, 이어온 시험 스크립트) `--permission-prompt-tool`, `--permission-mode default`. 같은 지시 → **파일 쓰기 허용, 명령 거부** | **1** | 승인 도구가 불리는지·넘어오는 내용(도구 이름·입력)·허용/거부가 그대로 지켜지는지 |
| W0-4 | (선택) W0-3을 `--resume`으로 한 번 더(같은 세션 이어서) | **1** | 이어 쓴 세션에서도 승인 도구가 그대로 동작하는지 |

필수만(W0-1·W0-3) **모델 호출 2차례**, 선택까지 최대 4차례. 한 차례 안에서 엔진이 여러 번 생각할 수 있어 사용량은 짧은 질문보다 조금 더 든다.

## 3. 안전 장치(실측 중에도)

- `never`·`acceptForSession`·`auto_review`·`bypassPermissions`·`--dangerously-skip-permissions`는 쓰지 않는다.
- 작업 폴더는 `.local/w0` 아래 임시 폴더만, 네트워크 꺼짐. 실측 뒤 임시 폴더는 지운다(새 시험 세션 기록은 엔진 쪽에 남음 — 지우지 않음).
- 결과 불명이면 다시 보내지 않는다. 승인 요청 내용은 화면에 보이되 로그에는 종류만.

## 4. 멈춤 조건

- 승인 요청 없이 명령이 실행됨 → 즉시 중단, 그 경로는 "불가"로 기록하고 작업 모드에서 뺀다(조용히 자동 허용으로 넘어가지 않음, WORK_AND_VOICE 6절).
- 거부했는데 실행됨 → 중단·불가.
- 작업 폴더 밖에 쓰려 함 → 거부하고 기록.

## 5. 신산님께 필요한 것

1. **모델 호출 승인**: 필수 2차례(W0-1 Codex, W0-3 Claude), 선택 W0-2·W0-4 각 1차례.
2. **Codex 계정**: A0 때 로그인한 이어온 전용 계정(`a0`) 또는 PC 기본 로그인 중 무엇으로 할지(Desktop 계정은 한도에 걸렸던 적 있음).
3. Claude는 이 PC의 Claude Code 로그인을 그대로 씀.
