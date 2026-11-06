# 새 세션 만들기 기능 설계

- 상태: **설계 확정안 · 구현 승인 전.** 신산님이 이 문서를 확인하면 WORK_PLAN에 단계를 올리고 구현을 시작한다.
- 작성: 2026-11-05 · 요청: 신산님 · 근거: 2026-11-05 인터뷰(10절) · 관련: [DESIGN](DESIGN.md), [DEVELOPMENT_ENVIRONMENT](../DEVELOPMENT_ENVIRONMENT.md)

## 1. 목표

이어온에 **새 세션을 만드는 기능**을 더한다. 지금 있는 "기존 세션에 연결하는 기능"은 그대로 두고, 같은 이어온 안에서 두 기능을 함께 쓴다.

| | 기존 세션 연결(지금 기능) | 새 세션 만들기(이 문서) |
| --- | --- | --- |
| 대상 | 그 PC에 이미 있는 Codex 대화·Claude Code 세션 | 이어온이 새로 만든 Codex·Claude 세션 |
| 세션 등록 | 사람이 `server.json`에 적음 | 웹·메신저·API에서 만들면 자동 등록 |
| 사람이 직접 보기 | Codex Desktop·TUI·Claude 터미널 | 같음. 만든 세션도 그 PC·서버에서 직접 열어 이어 쓸 수 있다 |
| 설치 위치 | 이어온을 설치한 곳 | 같음. Windows PC와 Linux 서버(WSL·Oracle)를 함께 지원 |

- 기존 기능의 목표("기존 세션 재사용, 새 대화 대체는 성공 아님")는 바꾸지 않는다.
- 새 세션은 목록에서 `새 세션` 표시로 기존 세션과 구분한다.
- 대표 사용 예: Oracle 클라우드 서버에 Codex CLI, Claude Code CLI, 이어온을 설치하고 텔레그램에서 새 세션을 만들어 대화한다.

## 2. 구조

```
웹 화면 · 텔레그램 · 디스코드 · 슬랙 · 내 프로그램(HTTP API)
                         │  만들기 / 질문
              이어온 서버 127.0.0.1:28760  ── 세션 등록(DB)
                         │
          연결부  ─┬─ 기존 세션 연결 (지금과 같음)
                   └─ 세션 관리자 (새로 만듦: 생성 · 깨우기 · 잠들기 · 보관 · 한도)
                         ├─ Codex CLI : SDK startThread → 이후 resumeThread
                         └─ Claude Code CLI : 질문마다 claude -p, 같은 세션 ID로 --resume (엔진 이름 claude_cli)
                                 └─ 세션별 작업 폴더 <workspaceRoot>/<세션 이름>
```

- 공개 포트를 열지 않는다. 서버·채널 포트는 모두 127.0.0.1 전용이고, 메신저는 이어온 쪽에서 먼저 접속한다.
- 세션 관리자는 기존 연결부 안에 더한다. 기존 세션과 새 세션이 같은 목록·같은 질문 흐름(접수 → 조회, 중복 방지, 확인 필요 잠금)을 쓴다.
- 실행: Windows는 `ieon.ps1`, Linux는 같은 명령을 가진 셸 스크립트와 systemd 서비스(재부팅 시 자동 시작).

## 3. 만드는 곳

| 어디서 | 방법 |
| --- | --- |
| 웹 화면 | 목록 위 **새 세션** 버튼 → 엔진(Codex·Claude), 이름, 권한 프로필 선택 |
| 텔레그램·디스코드·슬랙 | `/new codex <이름> [프로필]`, `/new claude <이름> [프로필]` (슬랙은 `!new`) |
| HTTP API | `POST /v1/sessions` 본문 `{ "engine": "codex"\|"claude", "name": "...", "profile": "..." }` → 201 `{ conversationId }` |

- 이름은 영문·숫자·`-` 2~32자, 같은 PC 안에서 중복 불가.
- 메신저에서 만들면 **그 대화방(텔레그램 주제, 디스코드 채널·스레드, 슬랙 채널)에 바로 연결**한다. 다른 세션으로 바꾸려면 지금처럼 `/use`.
- 만들 수 있는 사용자·앱은 지금의 허용 목록과 같다. 만들 수 있는 앱은 `new-sessions.json`의 `creatorApps`(기본 `app_web`, `app_messenger`)다. 내 프로그램(API)으로 만들려면 그 앱 ID를 여기에 추가한다. 만든 세션은 `creatorApps`의 앱들에서 모두 보인다.

## 4. 작업 폴더

- 세션마다 `<workspaceRoot>/<세션 이름>` **새 빈 폴더**를 자동으로 만든다. 세션끼리 파일이 섞이지 않는다.
- 기본 `workspaceRoot`: Windows `D:\ieon-workspaces`, Linux `~/ieon-workspaces`. 이어온 저장소 폴더 안에는 두지 않는다.
- AI는 자기 작업 폴더 밖을 쓰지 못한다. 이어온 폴더·`.local`·다른 세션 폴더는 대상이 아니다.

## 5. 설정

모든 정책은 `.local/new-sessions.json`(git 무시)에서 정한다. 아래는 기본값이다. 설정을 바꾼 뒤 `stop` → `start` 하면 적용되고, 권한은 **다음에 깨어나는 세션부터** 적용된다.

```json
{
  "enabled": false,
  "workspaceRoot": "D:/ieon-workspaces",
  "limits": {
    "maxSessions": 10,
    "maxActive": 3,
    "maxPerEngine": { "codex": 10, "claude": 3 }
  },
  "permissions": {
    "default": "workspace",
    "allowFullFromChat": false,
    "profiles": {
      "read_only": { "codex": { "sandbox": "read-only", "network": false },
                     "claude": { "allowedTools": ["Read", "Grep", "Glob"] } },
      "workspace": { "codex": { "sandbox": "workspace-write", "network": false },
                     "claude": { "allowedTools": ["Read", "Grep", "Glob", "Edit", "Write"] } },
      "full":      { "codex": { "sandbox": "workspace-write", "network": true },
                     "claude": { "allowedTools": ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "WebFetch"] } }
    }
  },
  "cleanup": {
    "idleSleepMinutes": 30,
    "archiveAfterDays": 14,
    "archiveNoticeDays": 3,
    "deleteRequiresConfirm": true,
    "deleteWorkspaceOnClose": false
  }
}
```

### 5-1. AI 권한

| 프로필 | 할 수 있는 일 | 고르는 곳 |
| --- | --- | --- |
| `read_only` | 읽고 답하기만 | 웹·메신저·API |
| `workspace`(**기본**) | 작업 폴더 안 파일 만들기·고치기. 명령 실행·인터넷은 막음 | 웹·메신저·API |
| `full` | 작업 폴더 안 명령 실행·인터넷까지 | **설정 파일에서만**(`allowFullFromChat: false`) |

- `full`을 쓰려면 PC·서버의 `new-sessions.json`에 `"sessionOverrides": { "<세션 이름>": { "profile": "full" } }`를 적는다(만들 때 고른 프로필보다 우선). 메신저 계정을 잃어도 명령 실행 권한은 넘어가지 않게 하기 위해서다.
- 권한 밖 작업이 필요하면 지금처럼 `approval_required`로 **멈추고 알린다.** 허용·거부는 PC·서버에서 사람이 직접 하고, 메신저 버튼으로는 하지 않는다.
- `--dangerously-skip-permissions`·auto mode는 쓰지 않는다(AGENTS 안전 규칙).
- 프로필 이름·도구 목록은 설정에서 바꾸거나 새로 만들 수 있다.

### 5-2. 세션 수

| 설정 | 기본 | 뜻 | 넘으면 |
| --- | --- | --- | --- |
| `maxSessions` | 10 | 등록된 새 세션 총수(잠든 세션 포함, 보관 제외) | 만들기 거절 + 정리 후보(오래 안 쓴 순) 안내 |
| `maxActive` | 3 | 동시에 깨어 있는(프로세스가 떠 있는) 세션 수 | 가장 오래 쓰지 않은 **유휴** 세션을 잠재우고 새 세션을 깨움. 모두 처리 중이면 "잠시 후 다시" 안내 |
| `maxPerEngine` | Codex 10, Claude 3 | 엔진별 등록 한도(Claude는 세션마다 프로세스·메모리 사용) | 만들기 거절 |

기존 세션 연결(사람이 등록한 세션)은 이 한도에 넣지 않는다.

## 6. 세션 정리

정리는 **잠들기 → 보관 → 삭제** 3단계다. 대화를 잃지 않는 앞의 두 단계는 자동, 되돌릴 수 없는 삭제만 사람이 한다.

| 단계 | 언제 | 하는 일 | 대화 | 되돌리기 |
| --- | --- | --- | --- | --- |
| 잠들기 | 30분 동안 질문 없음, 또는 `maxActive` 초과 | 프로세스만 끈다 | 그대로 | 다음 질문 때 자동으로 깨움(첫 답이 몇 초 늦음) |
| 보관 | 14일 동안 사용 없음 | 목록·한도에서 뺌 | 그대로 | `/restore <이름>`, 웹 보관함 |
| 삭제 | 사람이 `/close <이름>` → 확인 | 이어온 등록·기록 삭제 | 이어온 기록 삭제 | 없음 |

- 작업 폴더는 삭제해도 기본으로 남긴다(`deleteWorkspaceOnClose: false`). 원래 Codex·Claude 대화 기록도 지우지 않는다.
- 처리 중이거나 "확인 필요" 잠금이 있는 세션은 **어느 단계도 적용하지 않는다**(같은 질문이 두 번 실행될 위험).
- 사람이 PC·서버에서 그 세션을 직접 열어 쓰는 중이면 잠들기·보관하지 않는다.
- 매일 한 번, 3일 안에 보관될 세션을 만든 대화방(없으면 웹)에 미리 알린다.
- 모든 시간 값은 설정에서 바꾼다.

**구현 메모(N3)**

- Codex·Claude 새 세션 모두 질문이 있을 때만 프로세스가 뜨므로 "잠들기"는 상태 표시(`sleeping`)다. 잠든 세션에 질문하면 자동으로 `active`가 된다.
- `maxActive`는 "동시에 처리 중인 새 세션 질문 수"로 적용한다. 넘으면 409 `active_limit`(기존 세션 연결은 세지 않음).
- 보관된 세션에 질문하면 409 `session_archived`. 꺼내면(`restore`) 한도를 다시 검사하고 `sleeping`으로 돌아오며 보관 시계가 다시 시작된다.
- 삭제는 이름 확인(`confirm`)이 맞고 잠금이 없을 때만. 이어온 등록·질문 기록만 지우고 원래 Codex·Claude 기록은 남긴다. 작업 폴더는 `deleteWorkspaceOnClose`일 때만 `removeWorkspace`로 지운다(workspaceRoot 바로 아래 같은 이름만).
- 서버는 `server.json`의 `newSessionsConfigPath`가 있고 `enabled`일 때 1분마다 정리를 돈다. 보관 예고는 서버 메모리에 모아 두고 N4에서 메신저·웹으로 보낸다.
- 보관된 세션도 목록 API에는 `state: archived`로 남는다. 화면에서 보관함으로 나누는 것은 N4.
- 미구현: "사람이 직접 열어 쓰는 중이면 잠들기·보관하지 않음"은 감지 방법이 없어 넣지 않았다(잠들기는 표시일 뿐이라 대화에는 영향 없음).

## 7. 사람이 직접 열기

| 엔진 | 방법 | 주의 |
| --- | --- | --- |
| Codex | 새 대화도 일반 Codex 대화라 Codex 앱 목록과 `codex resume <ID>`에 보인다 | 기존 기능과 같다: 번갈아 쓰기에서는 이어온이 보낼 때 그 대화를 닫아 둔다. 동시 사용(TUI)도 지원 |
| Claude | 웹·`/sessions`에서 세션 ID를 보여 준다. 그 작업 폴더에서 `claude --resume <ID>` | 이어온은 질문이 있을 때만 `claude -p`를 잠깐 실행하므로 평소에는 프로세스가 없다. 사람이 그 세션을 열어 둔 채 이어온 질문이 들어오면 Claude가 복사본으로 실행해 다른 ID를 돌려준다. 이어온은 이를 **결과 불명(`session_forked`)** 으로 멈추고 다시 보내지 않는다. 직접 쓸 때는 이어온 질문을 보내지 않는다 |

## 8. 명령·API 추가분

**메신저**

| 명령 | 하는 일 |
| --- | --- |
| `/new codex\|claude <이름> [프로필]` | 새 세션을 만들고 이 대화방에 연결 |
| `/sessions` | 기존 목록 + 새 세션 상태(깨어 있음·잠듦·보관 예정)·세션 ID |
| `/sleep <이름>` | 바로 잠재우기 |
| `/archived`, `/restore <이름>` | 보관 목록, 다시 꺼내기 |
| `/close <이름>` | 삭제(확인 단계 있음) |
| `/limits` | 세션 수와 한도 |

**HTTP API**

| 요청 | 하는 일 |
| --- | --- |
| `POST /v1/sessions` | 새 세션 만들기 |
| `POST /v1/sessions/{id}/sleep`, `/restore` | 잠재우기, 보관에서 꺼내기 |
| `DELETE /v1/sessions/{id}` | 삭제(본문 `{ "confirm": "<세션 이름>" }`) |
| `GET /v1/sessions/limits` | 한도와 현재 수 |

질문·결과 조회는 지금의 `/v1/conversations/{id}/requests`, `/v1/requests/{id}`를 그대로 쓴다.

## 9. 구현 단계와 검증

**연결부 설정(N1~):** `connector.json`에 `"newSessions": { "configPath": "<.local/new-sessions.json>", "createdPath": "<.local/s2/new-threads.jsonl>" }`를 두고 `new-sessions.json`의 `enabled`가 `true`일 때만 새 세션을 실행한다. `createdPath`에는 연결부가 만든 Codex 대화 ID만 쌓이고, 연결부는 이 목록에 있는 대화만 새 세션으로 재개한다(서버 DB가 다른 대화를 가리켜도 거부).

**Claude 실행(N2):** `claude -p --output-format json --restricted --strict-mcp-config --permission-prompts none --tools <프로필 도구> --allowedTools <프로필 도구>`와 첫 질문은 `--session-id <새 UUID>`, 이후 `--resume <ID>`. 질문은 표준 입력으로만 넘긴다. `--restricted`는 사용자·프로젝트 설정·훅을 무시하고 파일 도구를 작업 폴더로 제한하며 bypassPermissions를 거부한다. 결과의 `permission_denials`가 있으면 `approval_required`, 결과 세션 ID가 다르면(사람이 열어 둔 세션의 복사본) 결과 불명 `session_forked`.

**Codex 권한 적용(N1 실측):** 프로필의 `sandboxMode`·`networkAccessEnabled`·`approvalPolicy: never`를 SDK 옵션으로 넘기면 사용자 `config.toml`(이 PC는 `danger-full-access`)보다 우선한다. `workspace`는 파일 변경만 허용하고 명령 실행·웹 검색 item이 시작되면 멈춰 `approval_required`로 돌린다. 명령 실행·웹 검색은 네트워크를 연 프로필(`full`)에서만 허용한다.

| 단계 | 내용 | 완료 기준 |
| --- | --- | --- |
| N0 | 설정 파일·세션 등록 DB·한도 검사·권한 프로필(모델 0) | 단위 테스트: 한도 초과 거절, `full`은 채팅에서 거절, 이름 중복·형식 거절 — **완료(2026-11-05, `tests/pilot/new-sessions.test.mjs` 10건)** |
| N1 | Codex 새 세션: `startThread` + 프로필별 sandbox·작업 폴더, 이후 `resumeThread` | 새 대화 생성 → 2회 대화가 같은 대화 ID에 이어짐 → Codex 앱·`codex resume`에서 보임 — **완료(2026-11-05)**: 실제 3회 왕복, Codex 기록 파일 생성 확인. Codex 앱 화면 표시는 미확인 |
| N2 | Claude 새 세션: 세션별 프로세스와 세션 ID 보존, 잠들기·깨우기(resume) | 생성 → 대화 → 잠들기 → 깨워서 앞 대화를 기억 → 사람이 `--resume`으로 직접 열기 — **완료(2026-11-05)**: 질문마다 `claude -p`로 실행하는 방식으로 확정, 실제 5회 확인 |
| N3 | 정리: 잠들기·보관·알림·삭제 확인, 처리 중·잠금 보호 | 시간을 줄인 설정으로 자동 잠들기·보관 확인, 잠금 세션은 그대로 — **완료(2026-11-05)**: 단위 테스트 9건, 1분 잠들기 설정으로 서버 자동 정리 실측(모델 0). 보관은 일 단위라 단위 테스트로 확인 |
| N4 | 만드는 곳: 웹 버튼, 텔레그램·디스코드·슬랙 `/new` 등, HTTP API | 각 경로에서 만들기·연결·질문 — **완료(2026-11-05)**: 웹(만들기·질문·잠재우기)과 API(Claude 만들기·질문) 실측, 메신저는 대역 API 단위 테스트 |
| N5 | Linux 실행(셸 스크립트·systemd)·`check`의 Linux판, WSL에서 N1~N4 재확인 | WSL에서 같은 시험 통과 — **로컬 작성 완료(2026-11-06)**: `scripts/ieon.sh`(start·stop·status·messenger·check), `deploy/systemd/` 사용자 유닛 3개·README, Codex 잠금 검사의 Linux판 `src/pilot/lock-probe.mjs`(/proc/locks 읽기, Windows는 기존 ps1), 단위 테스트(모델 0). **WSL 실측 완료(2026-11-06, Codex 3회)**: S0·N1~N4·systemd 서버·연결부 유닛 통과, 잠금(flock) 실측 확인(아래 "N5 WSL 실측"). Claude·메신저는 WSL에서 하지 않음 |
| N6 | Oracle 서버(aarch64) 설치·로그인·배포 | **별도 승인 후** 진행 |

- 실증 범위: **Windows PC와 WSL까지.** Oracle(N6)은 후보 버전과 되돌리는 방법을 제시하고 별도 승인을 받는다.
- 모델 호출: 실증 동안 **Codex·Claude 각 10회까지 미리 승인**(2026-11-05). 넘을 것 같으면 그 전에 멈추고 다시 승인받는다. 사용 횟수는 WORK_STATUS에 단계별로 기록한다.
- 시험은 시험 전용 새 세션만 쓴다. 업무 대화 `01a0dadd-…`와 기존 시험 세션은 건드리지 않는다.

### N5 WSL 검증 결과 (2026-11-06, 모델 호출 0)

- 환경: WSL2 Ubuntu 24.04(`daon@SINSAN`, `~/deploy/ieon-gateway`), Node 24.22.1, systemd 동작 중(`systemctl --user` running), `flock`·`python3` 있음, `pwsh` 없음. main `e89a569`로 동기화(저장소 깨끗), `npm ci` 성공(Codex 0.165.0 Linux 실행 파일 `codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex` 설치, `ieon.sh`의 검색으로 찾아짐).
- 단위 테스트 **140/140**(Linux 전용 스크립트·잠금 테스트 포함, 모델 호출 없음).
- `scripts/ieon.sh check`: Node·부품·Codex 실행 파일(0.165.0)·Codex 로그인(WSL에 이미 로그인됨)·`/proc/locks` OK, Claude Code 미설치, `.local` 설정 파일 없음 → "Codex 사용 가능·Claude 불가". `status`는 설정이 없으면 오류로 끊기는 버그를 발견해 고침(설정 없음 표시, `stop`·`start`도 설정이 없을 때 끊기지 않거나 이유를 알림).
- **잠금 검사 Linux판 실측:** 임시 파일에 `flock`과 POSIX(`lockf`) 쓰기 잠금을 걸어 `probeLinux`가 둘 다 `WRITER_LOCK_CONFLICT`, 해제 후 `NO_WRITER_LOCK`을 내는 것을 확인(Codex 파일은 건드리지 않음).
- **미확인:** 실제 Codex가 Linux에서 thread를 열어 두는 동안 그 잠금 파일에 OS 잠금을 거는지, `ieon.sh start`·`messenger`와 systemd 유닛 실행, WSL에서 N1~N4 실측(서버 설정·시험 토큰 생성, 모델 호출 승인 필요), Claude Code 설치·로그인.

### N5 WSL 실측(S0·N1~N4·systemd) 결과 (2026-11-06, Codex 모델 호출 3회)

- 준비: `scripts/ieon.sh init`으로 WSL에 최소 설정(웹·디바이스 시험 토큰 해시, 기존 세션 없음, 새 세션 켬, live 꺼짐)을 만들고 서버·연결부를 `start`로 기동(127.0.0.1 전용). 웹 `GET /` 200, 토큰 없는 API 401. WSL의 Codex 로그인은 기존 것을 사용.
- **N1:** Codex 새 세션 `wsl-t1`(read_only) → 첫 질문 "시험 표식은 자두" → `completed`, 새 thread 생성·작업 폴더·Codex 기록 파일(`~/.codex/sessions/2026/11/06/rollout-…jsonl`) 생성. 두 번째 질문 → "자두"(같은 thread에 이어짐, thread 기록 1개).
- **잠금 실측(핵심):** 두 번째 질문이 실행되는 약 2.0~4.3초 동안만 `~/.codex/thread-writer-locks/<id>.lock`이 생기고 `/proc/locks`에 **FLOCK ADVISORY WRITE**로 보였다. Linux판 검사는 이 구간에 `WRITER_LOCK_CONFLICT`, 끝난 뒤 파일이 사라져 `NO_LOCK_FILE`. 즉 Linux의 Codex는 flock으로 잠그고, `/proc/locks` 방식 검사가 이를 감지한다. (사람이 연 Desktop·TUI가 오래 쥐는 경우는 같은 잠금이므로 같은 방식으로 보이리라 추정하나 직접 시험하지 않음.)
- **N3:** 잠들기 `sleeping` → 보관되지 않은 세션 `restore`는 `not_archived` 거절 → 질문하자 깨어나 "자두"(앞 대화 기억), 상태 `active`. 삭제(`close`)는 이어온 기록만 지우고 작업 폴더는 남김(기본값). 보관(archive)은 일 단위 자동이라 WSL에서는 실행하지 않음(단위 테스트로 확인).
- **N4:** 웹 화면·HTTP API 경로(생성·질문·잠들기·삭제·한도 조회) 확인. 메신저 경로는 WSL에서 켜지 않았다(같은 봇 토큰 충돌 방지).
- **systemd:** 사용자 유닛 `ieon-server`·`ieon-connector`를 설치해 기동(`active`), 무토큰 API 401, `kill -9` 뒤 `Restart=on-failure`로 자동 재시작(PID 변경, journal에 restart 기록), live는 계속 false. 시험 유닛은 제거. **messenger 유닛은 실행하지 않음.**
- **시험 중 발견·수정한 버그 3건(모두 PR 병합):** (1) `ieon.sh status`가 설정이 없으면 오류로 끊김(#27). (2) `ieon.sh`가 서브셸 PID를 기록하고 프로세스 이름(`MainThread`)으로 확인해 `stop`이 서버·연결부를 못 끄고 `start`가 중복 기동(#29, Linux 회귀 테스트 추가). (3) 서버가 만든 작업 폴더 경로가 `~`를 펼치지 않아 연결부 재검사가 `bad_workspace`로 거절 — Linux 기본값 `~/ieon-workspaces`에서만 발생(#30). (2)(3)의 실패 시점에는 모델 호출이 일어나지 않았다.
- 정리: `stop` 후 WSL의 `.local`과 `~/ieon-workspaces`(모두 이번에 만든 것)를 삭제. **남은 것:** Codex 기록 파일 1개(`~/.codex/sessions/2026/11/06/rollout-2026-11-06T09-58-07-01a1ae5c-….jsonl`)는 이어온이 지울 수 없어 남겼다.
- **미확인:** WSL에서 Claude 새 세션(Claude Code 미설치), 메신저·중계 유닛, 사람이 연 Codex Desktop·TUI가 실제로 잠글 때의 검사, Oracle(aarch64) 환경.

### 미확인(구현 중 확인)

- ~~Claude 실행 방식~~ → N2에서 **질문마다 `claude -p`** 로 확정. 채널(연구 미리보기)·상시 프로세스가 필요 없고, 질문이 없을 때 프로세스가 없으므로 잠들기는 따로 할 일이 없다(`maxActive`는 동시에 실행 중인 질문 수로 적용).
- ~~Claude 작업 폴더 밖 쓰기~~ → `--restricted`로 막힘 실측(N2 ⑤). Bash를 여는 `full`에서는 명령으로 폴더 밖을 건드릴 수 있으므로 OS 사용자·폴더 권한으로 한 겹 더 막는 것은 Oracle 배포 전에 다시 검토.
- Codex: SDK `startThread`에 sandbox·network 옵션이 기대대로 적용되는지(기존 기능에서 사용자 `config.toml` 설정을 따르는 문제가 있었음).
- Oracle 서버 aarch64에서 Codex 실행 파일 설치와 Claude Code 동작, 화면 없는 로그인.
- 구독 사용량 한도는 PC·서버가 함께 쓴다.

## 10. 인터뷰 기록 (2026-11-05, 신산님)

| 질문 | 답 |
| --- | --- |
| 기능의 위치 | 기존 PC 설치 기능에 **추가**. 기존 = 있는 세션에 연결, 새 기능 = 새 세션 생성 |
| 만드는 곳 | 텔레그램, 웹 화면, 디스코드·슬랙, HTTP API 모두 |
| 작업 폴더 | 세션마다 새 빈 폴더 |
| 사람이 직접 열기 | 필요함 |
| 지원 환경 우선순위 | Windows PC와 Linux 서버 동시에 |
| 기본 AI 권한 | 작업 폴더 안 읽기·쓰기(`workspace`). 권한 범위는 설정에서 |
| `full` 권한 선택 | 설정 파일에서만 |
| 세션 수 | 등록 10 / 동시 3(설정에서 변경) |
| 세션 정리 | 30분 유휴 잠들기 → 14일 미사용 보관 → 삭제는 사람 확인, 작업 폴더 유지(설정에서 변경) |
| 메신저 연결 | 만든 대화방에 바로 연결 |
| 권한 확인 요청 | 멈추고 알림. 허용은 PC·서버에서 직접 |
| 실증 범위 | PC·WSL까지, Oracle은 별도 승인 |
| 모델 호출 | 엔진별 10회까지 미리 승인 |
