# 작업공간 — 직원 개인 폴더 · 프로젝트 공유 폴더 · 실제 차단(WS1)

작성 2026-11-14(신산님 "작업공간 설계"). 근거: [RELIABILITY_WORKSPACE_REVIEW](RELIABILITY_WORKSPACE_REVIEW.md) 7절, 신산님 요청 원문(OpenClaw 작업공간 비교). **설계만 — 구현은 승인 뒤.**

## 0. 출발점(요청 원문 요약)

- 직원 개인 공간과 프로젝트 공유 공간을 **함께** 두되, PC·서버에서 **어떤 폴더를 쓰고 공유할지는 사람이 지정·승인**.
- **이미 있는 기능은 보존**하고 빠진 부분만 더함.
- **정리상 분리 ≠ 보안상 차단.** 폴더만 나누면 다른 폴더를 못 읽는다는 보장이 없음 — 막으려면 샌드박스·OS 권한이 따로 필요.
- AI 직원의 **기억·지식 분리**와 **PC 파일 작업공간 분리**는 다른 문제.

## 1. 지금 이어온(2026-11-14 코드 확인)

| 대상 | 작업 폴더를 누가 정하나 | 엔진에 어떻게 넘기나 | 실제로 막는 것 |
| --- | --- | --- | --- |
| Codex 기존 세션(일반) | 사람 — PC 설정 허용 목록에서 세션마다(`workingDirectories`) | 그 폴더에서 시작(`cwd`) | 원래 세션의 설정 그대로(이어온이 더하지 않음) |
| Codex 기존 세션(작업 모드) | 같음 — 작업 폴더가 없으면 작업 모드 거부(`work_dir_required`) | app-server `sandboxPolicy: workspaceWrite, writableRoots: [작업 폴더], networkAccess: false`, 승인 카드 | **쓰기는 작업 폴더 안만**(Windows 자체 샌드박스), 인터넷 막음. **읽기는 막지 않음**(공식 문서에 읽기 제한 없음) |
| Codex 새 세션 | 이어온 — `D:/ieon-workspaces/<이름>` 자동 | 그 폴더에서 시작, 프로필 `workspace` = `workspace-write`·인터넷 없음 | 쓰기 작업 폴더 안만, 읽기 제한 없음 |
| Claude 새 세션(`claude -p`) | 이어온 — 같은 자동 폴더 | 그 폴더에서 시작, `--restricted`·도구 허용 목록(`Read·Grep·Glob·Edit·Write`)·그 밖 권한 자동 거부 | 문서 기준 **파일 읽기·쓰기 모두 작업 폴더 안**(`--restricted`), 명령 도구 없음(`full` 제외) — 실측 필요 |
| Claude 기존 세션(채널) | 사용자가 Claude Code를 연 폴더 | 이어온은 질문만 넣음 | 그 세션의 권한 설정 그대로 |
| Antigravity·Grok 기존 세션 | 사람 — PC 설정 허용 목록 | 그 폴더에서 시작, Antigravity는 `--mode plan --sandbox`(읽기 전용) | Antigravity: 쓰기 안 함(plan·샌드박스), 읽기 제한 미확인 |
| AI 직원 | 이름·역할·아이콘, 역할 안내(다음 질문 한 번 머리말) | — | — |
| 방 | 대화를 나누는 곳(파일 공유 아님) | — | — |

**빠진 것:** ① 직원별 **지침 파일·메모 폴더**(OpenClaw의 AGENTS.md·SOUL.md·memory/에 해당) ② **프로젝트 공유 폴더** ③ **읽기 차단**(다른 직원·다른 프로젝트 폴더) ④ 지금 차단 수준을 **사람이 알아볼 수 있게 표시**.

## 2. 설계

### 2-1. 개념

| 낱말 | 뜻 |
| --- | --- |
| **개인 폴더** | AI 직원(세션) 하나가 맡아 쓰는 폴더. 지침 파일(`AGENTS.md` 등)과 메모 폴더를 둘 수 있음 |
| **공유 폴더** | 프로젝트(= 방 또는 직원 묶음)가 함께 쓰는 폴더. 직원마다 **읽기만** 또는 **읽기·쓰기**를 따로 줌 |
| **작업 공간 묶음** | 한 직원이 쓸 수 있는 폴더 목록 = 개인 폴더(쓰기) + 공유 폴더들(읽기 또는 쓰기) |
| **차단 수준** | 엔진·OS가 실제로 막는 정도: **차단**(샌드박스·OS가 막음) / **정리만**(지침으로 부탁할 뿐 막지 않음) |

### 2-2. 사람이 지정·승인(AI가 스스로 넓히지 않음)

1. 웹 설정 → **PC 설정 → 작업 폴더**(PC형·허브형 같은 화면, 허브는 PC를 골라서 — 지금 허용 목록과 같은 방식·같은 기기 관리 명령 `device.*`).
2. **폴더 등록:** PC의 실제 폴더를 사람이 입력(또는 고르기) → 이름 붙이기(예: `보험-개인`, `상속프로젝트-공유`). 그 PC에 실제로 있는지 PC가 확인.
3. **직원에 붙이기:** AI 직원(대화)마다 개인 폴더 하나 + 공유 폴더 여러 개(읽기/쓰기 고르기).
4. **바꿀 때마다 확인 화면:** "이 직원이 이 폴더를 **쓰기**로 쓸 수 있게 됩니다 — 이 PC에서 실제로 막히는 수준: 차단/정리만"을 보여 주고 사람이 **승인**.
5. 기록: 누가·언제·어느 폴더를·어떤 권한으로(내용 없이) — 승인 기록처럼 180일.
6. 메신저·앱에서는 **보기만**(바꾸기는 웹 화면에서만 — 지금 설정 원칙과 같음).

### 2-3. 보존(바꾸지 않는 것)

- 기존 세션의 **원래 폴더·원래 권한**: 직원에 작업 공간 묶음을 붙이지 않으면 지금과 똑같이 동작.
- 새 세션 자동 폴더(`D:/ieon-workspaces/<이름>`) — 그대로, 그 폴더가 곧 개인 폴더.
- 작업 모드의 승인 카드·인터넷 막음·15분 거부 — 그대로.
- 업무 대화 제외 규칙 — 작업 공간을 붙일 수 없음(목록에서 빠짐).

### 2-4. 실행할 때(엔진별)

| 엔진 | 개인 폴더 | 공유(쓰기) | 공유(읽기만)·다른 폴더 읽기 막기 |
| --- | --- | --- | --- |
| Codex(작업 모드·새 세션) | 시작 폴더(`cwd`) + 쓰기 허용 | `writableRoots`에 더함 → **쓰기 차단 수준** | **엔진만으로는 못 막음**(읽기 제한 없음) → 2-5 OS 격리를 고른 경우만 차단, 아니면 "정리만" |
| Claude 새 세션 | 시작 폴더(`--restricted` — 이미 씀) | `--add-dir`로 더함 | 읽기만 공유는 `--settings`에 그 폴더 `Edit(...)` 거부 + `blockReadsOutsideWorkingDirectories`·`blockWritesOutsideWorkingDirectories` → 파일 도구는 **차단**. Bash가 있는 `full`은 Windows에서 "정리만" |
| Claude 기존 세션(채널) | 이어온이 실행하지 않음 → 사람에게 그 세션 설정을 안내만 | — | "정리만"(이어온이 못 바꿈) |
| Antigravity | 시작 폴더(지금 읽기 전용 plan) | 쓰기 없음 | 미확인 → "정리만" |

- **지침·메모:** 개인 폴더의 `AGENTS.md`(엔진이 스스로 읽는 지침 파일 — Codex·Claude 모두 작업 폴더의 지침 파일을 읽음)를 사람이 쓰고, 이어온은 만들지도 고치지도 않음. 메모 폴더는 개인 폴더 안 `memory/` 같은 이름 규칙만 안내(쓰기는 엔진이 개인 폴더 안에서).
- 공유 폴더 이름·권한을 질문 머리말에 한 줄로 알려 줌(예: `[작업 공간] 개인: D:/…/보험 · 공유(읽기): D:/…/상속`) — 엔진이 어디를 써야 하는지 알게(이것은 안내일 뿐 차단 아님).

### 2-5. 읽기까지 막고 싶을 때 — OS 수준 격리(선택, 무거움)

엔진 샌드박스가 읽기를 막지 못하므로, 읽기 차단이 필요한 직원만 **별도 OS 사용자**로 엔진을 실행하는 길을 둔다.

| 방법 | 어떻게 | 장단점 |
| --- | --- | --- |
| **A. 직원별 Windows 사용자** | 직원마다 표준 사용자 계정을 만들고, 그 직원 폴더(개인·공유)에만 NTFS 권한. 연결부가 그 사용자로 엔진 실행 | 진짜 읽기 차단. 계정 만들기·로그인 정보·엔진 로그인(계정마다)이 필요 → 사람 손이 많이 감, 관리자 권한 필요 |
| **B. 컨테이너(허브·리눅스)** | 직원마다 컨테이너, 그 직원 폴더만 연결(mount) | 허브(리눅스)에 잘 맞음. Windows PC는 Docker·WSL이 필요 |
| **C. 안 함(기본)** | 엔진 샌드박스(쓰기 차단)만 | 가장 가벼움. 화면에 "읽기는 정리만"을 분명히 표시 |

- **기본은 C**, A·B는 필요한 사람만 골라 켜는 고급 기능(설치 모드·보안 설정 변경이라 매번 승인).

### 2-6. 화면에 정직하게 표시

직원 연결 설정에 작업 공간 칸:

```
개인 폴더   D:/staff/보험              쓰기: 차단(Codex 샌드박스)
공유 폴더   D:/projects/상속  (읽기)    읽기 막기: 정리만 — 이 직원은 다른 폴더도 읽을 수 있어요
인터넷      막음
```

메신저 `/status`에도 한 줄(폴더 이름만, 전체 경로는 웹에서만).

## 3. 엔진별 차단 수단(공식 문서 확인 2026-11-14 — 실측 결과는 3-1)

**Codex** ([Sandboxing](https://learn.chatgpt.com/docs/sandboxing), [Windows sandbox 글](https://openai.com/index/building-codex-windows-sandbox/))
- `read-only`: 읽기만. `workspace-write`: 읽기 + 작업 폴더 안 쓰기·명령. `writable_roots`(app-server `writableRoots`)로 쓰기 폴더를 더함.
- **읽기 범위를 좁히는 공식 설정은 문서에 없음**(제3자 글에 "제한 읽기"가 일부 언급되나 확인 안 됨) → Codex만으로는 다른 폴더 읽기를 막지 못한다고 보고 설계.
- Windows는 Windows 자체 샌드박스(제한 토큰)로 쓰기를 막음. `.git`·`.codex` 등은 작업 폴더 안에서도 읽기 전용. (사용자 보고: Windows 샌드박스가 폴더 소유자를 바꿔 쓰기가 계속 실패한 사례 — 공식 확인 아님, WS0에서 지켜봄)

**Claude Code** ([permissions](https://code.claude.com/docs/en/permissions), [sandboxing](https://code.claude.com/docs/en/sandboxing), [cli-reference](https://code.claude.com/docs/en/cli-reference))
- **`--restricted`(이어온 Claude 새 세션이 이미 씀):** 내장 파일 도구를 작업 폴더 안으로 가두고, `--tools`에 적지 않은 명령 도구는 없앰, 디스크 설정은 관리 설정과 `--settings`만 읽음. 지금 프로필 `read_only`·`workspace`에는 명령 도구(Bash)가 없음 → **파일 읽기·쓰기 모두 작업 폴더 안**(문서 기준, 실측 필요). `full` 프로필은 Bash가 있어 아래 한계.
- **경로 규칙:** `Read(//d/other/**)` 같은 경로 거부(Windows 경로는 `/d/...`로 바뀜). Read 거부는 같은 경로의 쓰기도 막음. 단 **Bash 명령(`type`·`cat`)은 막지 못함** — 문서도 "보안 경계가 아님".
- **확실한 막기 설정:** `permissions.blockReadsOutsideWorkingDirectories`·`blockWritesOutsideWorkingDirectories` — 모든 모드에서 파일 도구의 작업 폴더 밖 읽기·쓰기를 막음(Bash·MCP는 아님).
- **공유 폴더:** `--add-dir <폴더>`(또는 설정 `additionalDirectories`) — 그 폴더를 읽기·편집 허용으로 더함(읽기만 주는 옵션은 없음 → 읽기 전용 공유는 그 폴더에 `Edit(...)` 거부 규칙을 함께).
- **OS 샌드박스:** 명령(Bash·PowerShell)의 파일·인터넷을 OS가 막음 — **macOS·Linux·WSL2만, Windows 그대로는 지원 안 함**(샌드박스 없이 실행). 리눅스(허브 Docker)에서는 `sandbox.filesystem.denyRead/allowRead/allowWrite`로 읽기까지 막을 수 있음.
- 세션마다 다르게: `claude -p`에 `--settings <JSON>`, `--add-dir`, `--restricted`, `--tools`를 그 세션 것으로 넘기면 한 PC에서 직원마다 경계를 다르게 줄 수 있음.

**정리 — 차단 수준표(설계 기준, WS0 실측으로 확정)**

| 엔진·실행 | 개인 폴더 밖 쓰기 | 다른 폴더 읽기 | 명령으로 우회 |
| --- | --- | --- | --- |
| Codex(작업 모드·새 세션, Windows) | **차단** | 정리만 | 쓰기는 차단, 읽기는 정리만 |
| Claude 새 세션 `read_only`·`workspace`(`--restricted`, Bash 없음) | **차단** | **차단**(파일 도구) | 명령 도구 없음 |
| Claude 새 세션 `full`(Bash, Windows) | 파일 도구는 차단 | 파일 도구는 차단 | **정리만**(Windows는 OS 샌드박스 없음) |
| Claude 새 세션 `full`(허브·리눅스 + 샌드박스) | 차단 | 차단 | 차단(문서 기준) |
| Claude 기존 세션(채널) | 그 세션 설정 | 그 세션 설정 | 그 세션 설정 — 이어온이 바꾸지 않음 |
| Antigravity(plan·sandbox) | 쓰기 안 함 | 미확인 | 미확인 |

### 3-1. WS0 실측 결과(2026-11-14, 이 PC Windows 11, codex-cli 0.165.0 · Claude Code 2.1.314)

시험 폴더 `.local/ws0/{staffA,staffB,shared,outside}`(git 무시), 시험 전용 새 세션만(Codex `exec --ephemeral`, Claude `-p` 새 세션). 업무 대화·기존 세션은 건드리지 않음. 모델 호출 Codex 3회·Claude 2회. 근거: [`docs/validation/ws0-sandbox-20261114.json`](../validation/ws0-sandbox-20261114.json).

| 시험 | 결과 | 판정 |
| --- | --- | --- |
| Codex `workspace-write`, staffA에서 `..\outside`에 쓰기(폴더가 **D:** 아래) | `Access ... is denied` — **막힘** | 설계와 같음 |
| 같은 시험을 **%TEMP% 아래** 폴더에서 | **써짐** | ⚠ Codex는 `/tmp`·`$TMPDIR`(Windows는 %TEMP%)을 늘 쓰기 허용 → 임시 폴더 아래는 서로 막히지 않음 |
| Codex로 `..\staffB\secret.txt` 읽기 | **읽힘** | 설계(정리만)와 같음 |
| Codex `--add-dir shared`(= writable_roots) | shared 쓰기 됨, outside·staffB 쓰기 **막힘** | 설계와 같음 |
| Claude `--restricted`, 도구 Read·Grep·Glob·Edit·Write, 밖 쓰기·staffB 읽기 | 둘 다 **막힘**(`--restricted confines the file tools…`, `permission_denials`에 기록) | 설계와 같음 — 별도 `--settings` 없이 `--restricted`만으로 읽기도 막힘 |
| Claude `--add-dir shared` + Write | shared 쓰기 됨, outside 쓰기 **막힘** | 설계와 같음 |
| Claude에 Bash를 허용(`full`과 같은 조건)하고 `cat staffB/secret.txt`, `echo > outside/c3.txt` | **둘 다 됨**(비밀 읽힘, 밖에 파일 생김) | 설계(정리만)와 같음 — Bash가 있으면 Windows에서는 막지 못함 |

**설계에 반영할 점**
1. 개인·공유 폴더는 **%TEMP%(임시 폴더) 아래에 둘 수 없게** 등록 단계에서 거부한다(Codex가 임시 폴더를 늘 쓰기 허용하므로 직원끼리 막히지 않음). 화면 안내: "임시 폴더 아래는 쓸 수 없어요".
2. Claude 새 세션 `read_only`·`workspace`는 `--restricted`만으로 읽기·쓰기가 막힌다 → WS1-b는 `--add-dir`(공유 폴더)만 더하면 됨. 읽기 전용 공유의 `Edit(...)` 거부는 아직 실측 안 함(WS1-b에서 시험).
3. `full`(Bash) 프로필과 Codex 읽기는 "정리만"으로 화면에 표시(표 그대로).
4. **미측정:** Codex는 CLI `exec`로 쟀다. 작업 모드가 쓰는 SDK·app-server `writableRoots` 경로는 같은 샌드박스지만 따로 재지 않음(WS1-a 구현 후 시험 세션으로 확인). 허브(리눅스) Claude OS 샌드박스, WS0-5(직원별 Windows 사용자)는 하지 않음.

## 3-2. WS1-a 구현(2026-11-18, 신산님 "WS1-a 진행")

- **저장 위치:** 그 기기(PC·엔진 칸)의 연결부 설정 `workspaces` — `folders: [{id, name, path}]`, `attach: {"<엔진>:<세션 ID>": {personal, shared: [{id, write}]}}`. 실제로 막는 것이 그 기기의 연결부라서 허브 DB가 아니라 기기 설정이 기준. 코드 `src/pilot/workspaces.mjs`.
- **폴더 등록**(기기 명령 `workspace.folder.add`·`workspace.folder.delete`, PC형·허브형 같은 명령): 그 기기에 실제로 있는 절대 경로만, 이름 1~40자, 30개까지. 임시 폴더(%TEMP%·/tmp) 아래·같은 폴더·같은 이름은 거절(3-1 실측 1). 직원이 쓰는 폴더는 빼지 못함(먼저 떼기). 폴더 안 파일은 건드리지 않음.
- **직원에 붙이기:** 전용 주소 `POST /v1/admin/workspaces/attach {conversationId, personal, shared}`만 — 서버가 대화 주인·엔진을 확인하고 그 기기에 `workspace.attach`를 맡김, 그 기기가 허용 목록·업무 대화·폴더를 다시 검사해 저장. 일반 기기 명령 주소로는 붙이지 못함(`use_workspace_route`, 기록 없이 바뀌지 않게). 대상: Codex·서버 Claude·Antigravity·Grok의 **기존 대화**(허용 목록). 새 세션(자동 폴더가 곧 개인 폴더)·Claude 채널·허브 자신은 아님. 허용 목록에서 빼면 작업 공간도 같이 뗌.
- **확인 화면:** 설정 → **작업 폴더** 탭(PC형·허브형 같은 화면, 허브는 PC·칸을 고름) → 직원의 [폴더 정하기] → 저장할 때 "이 직원이 이 폴더를 쓰기/읽기만으로 씁니다 + 이 기기에서 실제로 막히는 정도"를 보여 주고 승인.
- **기록:** 허브(또는 PC형 서버) DB `workspace_log` — 누가·언제·어느 대화·어느 폴더 이름·권한(경로·내용 없음), 180일. 보기 `GET /v1/admin/workspaces/log/<대화>`(주인만).
- **실행:** Codex — 개인 폴더가 그 세션의 작업 폴더(cwd), 작업 모드 app-server `writableRoots = [개인, 공유(쓰기)…]`(지금 없는 폴더는 빼고 보냄). 읽기만 공유는 writableRoots에 넣지 않음. 다른 엔진은 폴더를 바꾸지 않음(Claude 기존 대화는 그 폴더의 대화라 cwd를 바꾸면 이어지지 않음) — 안내만. 모든 붙인 직원의 질문 앞에 한 줄 `[작업 공간] 개인: … · 공유(쓰기): … · 공유(읽기만): …`(안내일 뿐 차단 아님).
- **막는 정도 표시**(설정 화면·대화 목록 `workspace.level`): Codex 쓰기 = 차단(Codex 샌드박스, 작업 모드), 엔진 칸 = 컨테이너가 경계(칸 안 폴더끼리는 정리만), Codex 읽기 = 정리만, Claude(서버)·Grok = 정리만, Antigravity = 쓰지 않음(읽기 전용 실행).
- **메신저 `/status`·`/sessions`:** "작업 공간: 개인 보험, 공유 상속(읽기)"처럼 폴더 이름만(경로는 웹 설정 화면에서만).
- **시험:** `tests/pilot/ws1-workspaces.test.mjs` 6건(모델 0). **미확인:** 실제 Codex 작업 모드에서 writableRoots 두 개가 막히는지(3-1 실측 4 — 시험 세션·모델 호출 필요), 화면 실제 확인(배포 뒤).

## 4. 실측 계획(구현 전에 — W0처럼)

| # | 무엇을 | 성공 기준 |
| --- | --- | --- |
| WS0-1 | Codex 작업 모드(Windows)에서 작업 폴더 **밖에 쓰기** 시도 | 막힘(쓰기 실패), 승인 카드에도 안 뜨거나 거부 |
| WS0-2 | Codex에 `writableRoots` 두 개(개인·공유) | 둘 다 쓰기 됨, 그 밖은 막힘 |
| WS0-3 | Codex로 다른 직원 폴더 **읽기** 시도 | (예상: 읽힘) → "정리만" 표시가 맞는지 확인 |
| WS0-4 | Claude 새 세션: 3절 수단으로 밖 읽기·쓰기·명령 시도 | 문서대로 막히는지 |
| WS0-5 | (A를 고를 경우) 다른 Windows 사용자로 엔진 실행·로그인·폴더 권한 | 읽기까지 막힘 |

- 시험 폴더·시험 세션만, 모델 호출 몇 회 — **승인 뒤**.
- **2026-11-14 실측 완료(WS0-1~4, 3-1절):** 1·2·3·4 모두 설계 표와 같음. 추가 발견 — Codex는 임시 폴더(%TEMP%)를 늘 쓰기 허용. WS0-5는 안 함(A 선택 안 됨).

## 5. 단계

| 단계 | 내용 | 승인 |
| --- | --- | --- |
| **WS0** | 4절 실측 | [모델] |
| **WS1-a** | 폴더 등록·직원에 붙이기·확인 화면·기록(PC·허브 같은 화면), Codex `writableRoots`, 머리말 안내, 차단 수준 표시, `/status` 한 줄 | [PC] [배포] |
| **WS1-b** | Claude 새 세션 경로 제한(WS0-4 결과대로) | [PC] [배포] |
| **WS1-c**(선택) | OS 수준 격리 A 또는 B | [보안 설정] [배포] — 매번 |

- 시험: 폴더를 안 붙인 직원은 지금과 똑같이 동작(보존), 붙인 직원만 `writableRoots`가 바뀜, 업무 대화에는 붙일 수 없음, 메신저·앱에서 못 바꿈, 차단 수준 표시가 엔진·설정과 맞음, 기록에 내용 없음.

## 6. 범위 밖

- 세션을 학습시키거나 전문 MCP를 붙여 전문 봇으로 키우는 일 — 사용자 몫이자 다음 프로젝트(이어온은 연결만).
- 직원의 "기억"을 이어온이 따로 저장하는 일 — 기억은 원래 세션 대화와 개인 폴더의 파일(사람·엔진이 쓰는 것)로 둠.
