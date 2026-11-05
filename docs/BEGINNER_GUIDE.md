# 이어온 처음 쓰는 사람을 위한 따라 하기 설명서

- 기준: 2026-11-05 main · 대상: 이어온을 처음 쓰는 사람(SINSAN PC 1대, 사용자 1명)
- 이 문서는 처음부터 순서대로 따라 하는 설명서다. 항목별 요약은 [사용 설명서](MANUAL.md), 내 프로그램과 연결하는 방법은 [개발 프로그램 연동 설명서](API_GUIDE.md), 메신저 봇 만들기는 [메신저 설정 설명서](MESSENGER_MANUAL.md)를 본다.

---

## 0. 먼저 알아 둘 것

### 이어온이란

이어온(ieon-gateway)은 **이미 쓰고 있는 AI 작업 세션**(Codex 대화, Claude Code 터미널)에 다른 곳에서 질문을 넣고 답을 받아 오는 프로그램이다.

- 웹 화면, 휴대폰, 메신저(텔레그램·디스코드·슬랙), 직접 만든 프로그램에서 질문할 수 있다.
- 기본은 **기존 세션 연결**이다. 새 대화를 만들지 않고, 질문은 원래 세션에 그대로 이어진다(4·5·6장).
- 설정에서 켜면 **새 세션 만들기**도 쓸 수 있다. 이어온이 새 Codex·Claude 세션과 전용 작업 폴더를 만들어 준다(6-A장).
- ChatGPT·Claude 웹사이트의 채팅방과는 연결되지 않는다.

### 그림으로 보는 구성

```
[웹 화면 / 휴대폰 / 메신저 / 내 프로그램]
              │  질문
              ▼
     이어온 서버 (127.0.0.1:28760)   ← 질문과 답을 보관
              ▲
              │  연결부가 먼저 접속해서 질문을 가져감
     연결부 (같은 PC)
              │
              ▼
   엔진: Codex 대화 · 공유 App Server(28761) · Claude 채널(28762)
```

| 이름 | 쉽게 말하면 |
| --- | --- |
| 이어온 서버 | 질문을 받아 두는 접수 창구. 웹 화면도 여기서 열린다 |
| 연결부 | 접수 창구에서 질문을 가져가 AI 세션에 전달하는 심부름꾼 |
| 엔진 | 실제로 답을 만드는 AI 세션(Codex 또는 Claude Code) |
| 토큰 | 이어온에 들어가기 위한 비밀번호 같은 긴 문자열 |
| 실제 엔진 실행(Live) | 켜야 AI가 실제로 답한다. 끄면 접수만 되고 AI는 호출되지 않는다 |

### 꼭 지킬 약속

1. **토큰은 남에게 보여 주지 않는다.** 채팅, 스크린샷, 메모에 붙여 넣지 않는다.
2. **실제 엔진 실행(`-Live`)은 필요할 때만 켜고, 다 쓰면 끈다.** 켜 두면 AI 사용량이 생긴다.
3. 업무 대화 `01a0dadd-739f-74d2-93c5-9c405cc1019b`는 이어온에 연결하지 않는다.

---

## 1. 설치와 처음 설정 (한 번만)

이미 설치돼 있는 PC라면 1-6(설치 확인)만 해 보고 2장으로 넘어간다.

### 1-1. PowerShell 7 열기

이 설명서의 명령은 모두 **PowerShell 7**에서 실행한다.

1. 키보드에서 `Windows` 키를 누른다.
2. `pwsh`를 입력하고 **PowerShell 7**을 클릭한다.
3. 창이 뜨면 명령을 붙여 넣고 `Enter`를 누른다.

`pwsh`가 검색되지 않으면 기본 "Windows PowerShell"을 열고 아래를 실행한 뒤, 창을 닫았다가 다시 1번부터 한다.

```powershell
winget install --id Microsoft.PowerShell -e
```

### 1-2. 필요한 프로그램 설치

| 프로그램 | 왜 필요한가 | 설치 명령 | 확인 명령 → 기대 결과 |
| --- | --- | --- | --- |
| Git | 저장소 내려받기 | `winget install --id Git.Git -e` | `git --version` → `git version 2.…` |
| Node.js 24 | 이어온 실행 | [nodejs.org](https://nodejs.org/) 다운로드 페이지에서 **v24** Windows 설치 파일(.msi) | `node --version` → `v24.…` |
| Claude Code | Claude 세션 연결(쓸 때만) | `npm install -g @anthropic-ai/claude-code` | `claude --version` → `2.1.…` |
| Codex 앱 | Codex 대화 연결(쓸 때만) | 공식 사이트에서 Codex Desktop 설치 | 앱이 열리고 로그인됨 |

- 설치 명령을 실행한 뒤에는 **PowerShell 창을 닫고 다시 열어야** 새 프로그램이 인식된다.
- Node는 이어온을 확인한 버전인 **24**로 설치한다. 이미 다른 버전이 있으면 `node --version`으로 확인하고, 24가 아니면 v24 설치 파일로 다시 설치한다.
- Codex 실행 파일은 따로 설치하지 않는다. 1-4의 `npm install`이 이어온 폴더 안에 함께 받는다.

### 1-3. 저장소 내려받기

```powershell
cd D:\Project
git clone git@github-cyhuh7950:cyhuh7950/ieon-gateway.git
cd D:\Project\ieon-gateway
```

- `github-cyhuh7950`는 이 PC의 SSH 설정(`C:\Users\<사용자>\.ssh\config`)에 등록된 GitHub 계정 별칭이다. 새 PC라면 SSH 키 등록을 먼저 해야 한다. 키·계정 설정은 신산님이 직접 한다.
- 이미 폴더가 있으면 내려받기 대신 최신으로 맞춘다.
  ```powershell
  cd D:\Project\ieon-gateway
  git pull --ff-only
  ```

이후 명령은 **모두 `D:\Project\ieon-gateway` 폴더에서** 실행한다. 창을 새로 열었다면 `cd D:\Project\ieon-gateway`부터 한다.

### 1-4. 부품 설치

```powershell
npm install
```

마지막에 `found 0 vulnerabilities`처럼 끝나면 된다. 확인:

```powershell
Test-Path node_modules\@openai\codex-sdk
```

`True`가 나오면 성공이다.

### 1-5. 설정 파일과 토큰 만들기

이어온의 설정과 토큰은 `.local` 폴더에 둔다. 이 폴더는 `.gitignore`에 들어 있어서 **GitHub에 올라가지 않는다.**

> **이미 `.local` 폴더가 있으면 이 단계를 하지 않는다.** 다시 만들면 토큰이 모두 바뀌어 웹·메신저·Claude 세션에 다시 로그인해야 한다. 확인: `Test-Path .local\s2\server.json` → `True`면 건너뛴다.

아래 블록 전체를 복사해 PowerShell에 한 번에 붙여 넣는다. 토큰을 새로 만들고, 서버에는 토큰 원문 대신 sha256 해시만 적는다. 화면에는 토큰이 표시되지 않는다.

```powershell
$Root = 'D:\Project\ieon-gateway'
$L = Join-Path $Root '.local'
$R = $Root -replace '\\', '/'
's2', 'x2', 'c1\.claude', 'messenger', 'run' | ForEach-Object { New-Item -ItemType Directory -Force (Join-Path $L $_) | Out-Null }

function New-Token([string]$Path) {
  $bytes = [byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  Set-Content $Path $token -NoNewline -Encoding ascii
  $hash = [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($token))
  return -join ($hash | ForEach-Object { $_.ToString('x2') })
}
$webHash = New-Token "$L\s2\user-token"
$msgHash = New-Token "$L\messenger\token"
$devHash = New-Token "$L\s2\device-token"
$x2Hash = New-Token "$L\x2\token"; Set-Content "$L\x2\token.sha256" $x2Hash -NoNewline -Encoding ascii
New-Token "$L\c1\token" | Out-Null

@{
  port = 28760; dbPath = "$R/.local/s2/pilot.db"
  users = @(
    @{ userId = 'u_sinsan'; appId = 'app_web'; tokenSha256 = $webHash },
    @{ userId = 'u_sinsan'; appId = 'app_messenger'; tokenSha256 = $msgHash })
  devices = @(@{ hostId = 'h_sinsan'; tokenSha256 = $devHash })
  bindings = @(@{ conversationId = 'c_claude_main'; label = 'Claude 채널 세션'; ownerUserId = 'u_sinsan'
      appIds = @('app_web', 'app_messenger'); hostId = 'h_sinsan'; engine = 'claude_channel'; sessionRef = 'ieon' })
} | ConvertTo-Json -Depth 6 | Set-Content "$L\s2\server.json" -Encoding utf8

@{
  serverUrl = 'http://127.0.0.1:28760'; deviceTokenFile = "$R/.local/s2/device-token"
  receiptPath = "$R/.local/s2/receipts.jsonl"; live = $false
  codex = @{ allowlist = @(); modes = @{}; workingDirectories = @{}
    shared = @{ endpoint = 'ws://127.0.0.1:28761'; tokenFile = "$R/.local/x2/token" } }
  claude = @{ baseUrl = 'http://127.0.0.1:28762'; tokenFile = "$R/.local/c1/token" }
} | ConvertTo-Json -Depth 6 | Set-Content "$L\s2\connector.json" -Encoding utf8

@{ mcpServers = @{ ieon = @{ command = 'node'; args = @("$R/src/pilot/ieon-channel.mjs")
      env = @{ IEON_CHANNEL_PORT = '28762'; IEON_CHANNEL_TOKEN_FILE = "$R/.local/c1/token" } } }
} | ConvertTo-Json -Depth 6 | Set-Content "$L\c1\.mcp.json" -Encoding utf8
@{ enabledMcpjsonServers = @('ieon'); enableAllProjectMcpServers = $true } |
  ConvertTo-Json | Set-Content "$L\c1\.claude\settings.local.json" -Encoding utf8

@{
  serverUrl = 'http://127.0.0.1:28760'; userTokenFile = "$R/.local/messenger/token"
  envFile = "$R/.local/.env"; roomsPath = "$R/.local/messenger/rooms.json"
  allowedUsers = @{ telegram = @(); discord = @(); slack = @() }
} | ConvertTo-Json -Depth 6 | Set-Content "$L\messenger\config.json" -Encoding utf8
'설정을 만들었습니다.'
```

마지막에 `설정을 만들었습니다.`가 나오면 끝이다. 만들어진 것:

| 파일 | 하는 일 |
| --- | --- |
| `.local\s2\server.json` | 서버 설정: 포트(28760), 사용자, PC, 연결할 세션 목록(처음엔 Claude 세션 1개) |
| `.local\s2\connector.json` | 연결부 설정: Codex 허용 대화(처음엔 비어 있음), Claude 채널 주소, 실제 실행 여부 |
| `.local\s2\user-token` | 웹 화면 접속 토큰 |
| `.local\s2\device-token` | 연결부가 서버에 접속하는 토큰 |
| `.local\messenger\token`, `config.json` | 메신저 봇용 토큰과 설정 |
| `.local\x2\token`, `token.sha256` | Codex 동시 사용 서버 토큰과 해시 |
| `.local\c1\` | Claude 채널 세션이 열리는 폴더(`.mcp.json`, 채널 토큰) |
| `.local\.env` | 메신저 봇 토큰. 메신저를 쓸 때 직접 만든다(8장) |

- 다른 폴더에 설치했다면 첫 줄의 `$Root` 값만 그 폴더로 바꾼다.
- Codex 대화는 처음에 하나도 연결돼 있지 않다. 6장에서 추가한다.
- 휴대폰 접속(7장)과 메신저 사용자(8장)도 쓰기 전에 따로 추가한다.

### 1-6. 설치 확인

먼저 설치 점검을 한다. 프로그램·부품·설정 파일과 **Codex·Claude Code의 설치와 로그인 여부**를 한 번에 본다. AI는 호출하지 않고, 계정 이메일·토큰은 표시하지 않는다.

```powershell
pwsh scripts/ieon.ps1 check
```

```
결과      항목                            내용
----      ----                            ----
OK        Node.js 24                      v24.22.1
OK        부품(npm install)               @openai/codex-sdk 있음
OK        설정 파일(.local)               있음
OK        Codex 실행 파일(이어온 폴더 안) codex-cli 0.165.0
OK        Codex 로그인                    Logged in using ChatGPT
OK        Claude Code 설치                2.1.314 (Claude Code)
OK        Claude Code 로그인(구독 계정)   방식 claude.ai, 구독 pro

Codex 사용: 가능 · Claude 사용: 가능
설치 점검 통과.
```

- "확인 필요"가 있으면 같은 줄의 **할일** 칸대로 처리하고 `check`를 다시 한다.
- Codex·Claude는 **둘 중 하나만 "가능"해도** 이어온을 쓸 수 있다. 쓰지 않는 쪽은 "확인 필요"로 남아도 된다.
- Claude는 구독 계정(Pro/Max)으로 로그인해야 "가능"이 된다. API 키 로그인은 쓰지 않는다.
- Codex 로그인은 Codex 앱·CLI와 같은 정보(`%USERPROFILE%\.codex`)를 쓴다. 이미 Codex 앱에 로그인돼 있으면 따로 할 일이 없다.

다음으로 실제로 켜 본다.

```powershell
pwsh scripts/ieon.ps1 start
pwsh scripts/ieon.ps1 status
```

`이어온 서버(28760) : True`가 나오면 설치가 끝난 것이다. 이어서 3장처럼 웹 화면에 들어가 목록에 **Claude 채널 세션**이 보이는지 확인한다. 아직 Claude 세션을 켜지 않았으므로 "세션 꺼짐"으로 보이는 것이 정상이다.

확인이 끝나면 끈다.

```powershell
pwsh scripts/ieon.ps1 stop
```

> `status` 마지막 줄의 "시험 Codex 대화 잠금"은 개발 시험용 항목이다. 새로 설치한 PC에서는 `NO_LOCK_FILE` 등으로 나와도 문제없다.

---

## 2. 이어온 켜기와 끄기

### 2-1. 켜기 (연습 모드: AI는 호출되지 않음)

```powershell
pwsh scripts/ieon.ps1 start
```

이렇게 나오면 성공이다.

```
server: 시작(PID 12345)
connector: 시작(PID 23456)
실제 엔진 실행: 끔 · 웹: http://127.0.0.1:28760
```

이 상태에서는 질문을 보내도 "연결부에서 실제 실행이 꺼져 있음"으로 끝난다. 화면과 연결을 연습할 때 쓴다.

### 2-2. 실제로 답을 받고 싶을 때

```powershell
pwsh scripts/ieon.ps1 stop
pwsh scripts/ieon.ps1 start -Live
```

- 이미 켜져 있으면 **먼저 `stop`** 해야 한다. 연결부는 켤 때만 설정을 읽기 때문이다.
- 마지막 줄이 `실제 엔진 실행: 켬`이면 된다.

### 2-3. 상태 보기

```powershell
pwsh scripts/ieon.ps1 status
```

| 항목 | `True`의 뜻 |
| --- | --- |
| 이어온 서버(28760) | 서버가 켜져 있다 |
| 공유 App Server(28761) | Codex 동시 사용 서버가 켜져 있다 |
| Claude 채널(28762) | Claude 채널 세션이 켜져 있다 |
| 실제 엔진 실행 | AI가 실제로 답한다 |

### 2-4. 끄기

```powershell
pwsh scripts/ieon.ps1 stop
```

이 스크립트가 켠 것(서버·연결부·메신저·공유 서버)만 끄고, 실제 엔진 실행도 끈다. 다른 프로그램은 건드리지 않는다.

> 하루 작업이 끝나면 꼭 `stop` 한다.

---

## 3. 웹 화면에서 질문하기

### 3-1. 접속하기

1. 이어온을 켠다(2-1 또는 2-2).
2. 접속 토큰을 클립보드에 복사한다. 화면에는 표시되지 않는다.
   ```powershell
   Get-Content D:\Project\ieon-gateway\.local\s2\user-token -Raw | Set-Clipboard
   ```
3. 브라우저 주소창에 `http://127.0.0.1:28760`을 입력한다.
4. 토큰 입력칸에 `Ctrl+V`로 붙여 넣고 들어간다.

### 3-2. 질문 보내기

1. 왼쪽 목록에서 세션을 고른다. 배지로 종류를 구분한다.
   - `Codex · thread`: Codex 대화
   - `Claude · 채널`: Claude Code 세션
2. 세션 옆 상태 문구를 확인한다.

| 문구 | 뜻 | 할 일 |
| --- | --- | --- |
| 보낼 수 있음 | 준비됨 | 질문을 보낸다 |
| 처리 중 | 이전 질문을 처리하고 있음 | 끝날 때까지 기다린다 |
| PC 연결 끊김 | 연결부가 꺼져 있음 | `start` |
| 세션 꺼짐 | Claude 세션이 꺼져 있음 | 4장 Claude 세션 켜기 |
| 공유 서버 꺼짐 | Codex 동시 사용 서버가 꺼져 있음 | `start -Shared` 또는 번갈아 쓰기로 바꾸기 |

3. 아래 입력칸에 질문을 쓰고 **보내기**를 누른다.
4. "접수됨 — 답을 기다리는 중"이 나온 뒤 답이 표시된다.

---

## 4. Claude Code 세션 연결하기

Claude는 **켜져 있는 Claude Code 터미널**에 질문이 들어가는 방식이다. 그래서 질문하기 전에 세션을 먼저 켜 둔다.

### 4-1. 세션 켜기

```powershell
pwsh scripts/ieon.ps1 claude
```

새 PowerShell 창이 열리고 Claude Code가 시작된다.

### 4-2. 처음 한 번 로그인

- 그 창에 로그인 안내가 나오면 `/login`을 입력하고 **Claude 구독 계정(Pro/Max)** 으로 직접 로그인한다.
- API 키 로그인은 쓰지 않는다(별도 요금이 나간다).

### 4-3. 꼭 확인할 것

- 창 아래쪽에 `manual mode`라고 보여야 한다. `auto mode`면 `Shift+Tab`을 눌러 바꾼다.
- 이 창에는 **질문을 직접 입력하지 않는다.** 여기 입력한 내용은 이어온으로 답이 가지 않는다.
- 이 창을 닫거나 `/exit`하면 Claude 세션도 꺼진다. 웹 목록에는 "세션 꺼짐"으로 보인다.

### 4-4. 질문해 보기

1. `pwsh scripts/ieon.ps1 stop` → `pwsh scripts/ieon.ps1 start -Live`
2. 웹 화면에서 `Claude · 채널` 세션을 고르고 질문을 보낸다.
3. 답이 오면 성공이다.

---

## 5. Codex 대화 연결하기

Codex는 두 가지 방식이 있다. 세션을 고르면 나오는 **"Codex 연결 모드"** 에서 바꾼다.

| 방식 | 언제 쓰나 | 주의 |
| --- | --- | --- |
| 번갈아 쓰기(기본) | Codex 앱과 이어온 중 한쪽만 쓸 때 | 보낼 때 **그 대화가 Codex 앱에 열려 있으면 거절된다.** 앱은 켜져 있어도 되고 그 대화만 닫으면 된다 |
| 동시 사용 | 터미널(TUI)로 보면서 이어온으로도 질문할 때 | 이 대화는 Codex 앱에서 열지 않는다 |

### 5-1. 번갈아 쓰기로 질문하기

1. Codex 앱에서 그 대화를 닫는다(다른 대화를 보고 있으면 된다).
2. 이어온을 `start -Live`로 켠다.
3. 웹 화면에서 `Codex · thread` 세션을 골라 질문한다.
4. 나중에 Codex 앱에서 그 대화를 다시 열면 이어온에서 한 질문과 답이 보인다.

### 5-2. 동시 사용으로 질문하기

```powershell
pwsh scripts/ieon.ps1 stop
pwsh scripts/ieon.ps1 start -Shared -Live
pwsh scripts/ieon.ps1 tui
```

1. 새 창에 Codex TUI가 열린다. hook 확인 화면이 나오면 **Continue without trusting**을 고른다.
2. 웹 화면에서 그 세션의 연결 모드를 **동시 사용**으로 바꾼다.
3. 웹에서 질문하면 TUI 화면에도 질문과 답이 바로 보인다.
4. 이어온이 처리하는 도중 TUI에 입력하려면 **`Enter` 대신 `Tab`** 을 누른다. `Enter`를 누르면 진행 중인 답에 끼어들어 답이 섞인다.

### 5-3. 이어온에서 온 Codex 질문의 한계

이어온에서 보낸 Codex 질문은 **읽기 전용**으로 실행된다. 파일 수정·명령 실행·인터넷 검색은 하지 않는다. 그런 작업은 원래 세션에서 사람이 직접 한다.

---

## 6. 새 세션 추가하기

1-5로 새로 설치했다면 처음에는 Claude 세션 1개(`c_claude_main`)만 등록돼 있다(개발 PC에는 시험용 `c_codex_test`, `c_claude_test`가 있다). Codex 대화를 연결하려면 아래처럼 한다. 설정 파일을 고치기 전에 **반드시 `stop`** 하고, 고친 뒤 `start` 한다.

### 6-1. Codex 대화 ID 찾기

Codex 대화는 `C:\Users\<사용자>\.codex\sessions\` 아래에 날짜별 파일로 저장된다. 파일 이름 끝의 긴 문자열이 대화 ID다.

```powershell
Get-ChildItem $env:USERPROFILE\.codex\sessions -Recurse -Filter rollout-*.jsonl |
  Sort-Object LastWriteTime -Descending | Select-Object -First 10 LastWriteTime, Name
```

예: `rollout-2026-10-29T21-09-09-01a18790-63c7-73e3-a60b-6ddb60fd5be8.jsonl` → ID는 `01a18790-63c7-73e3-a60b-6ddb60fd5be8`

### 6-2. 서버에 세션 등록 (`.local\s2\server.json`)

`bindings` 목록에 한 덩어리를 추가한다. 앞 항목 끝에 쉼표(`,`)를 잊지 않는다.

```json
{
  "conversationId": "c_codex_myproject",
  "label": "내 프로젝트",
  "ownerUserId": "u_sinsan",
  "appIds": ["app_web", "app_messenger"],
  "hostId": "h_sinsan",
  "engine": "codex_thread",
  "sessionRef": "<6-1에서 찾은 대화 ID>"
}
```

| 항목 | 넣을 값 |
| --- | --- |
| `conversationId` | 이어온 안에서 부를 이름. 영문·숫자·`_`·`-`만 |
| `label` | 화면에 보일 이름 |
| `appIds` | 이 세션을 쓸 수 있는 곳(웹 `app_web`, 메신저 `app_messenger`, 내 프로그램 `app_...`) |
| `engine` | Codex는 `codex_thread`, Claude는 `claude_channel` |
| `sessionRef` | Codex 대화 ID |

### 6-3. 연결부에 허용 등록 (`.local\s2\connector.json`)

`codex` 안의 세 곳에 같은 ID를 추가한다.

```json
"allowlist": ["01a18790-...", "<새 대화 ID>"],
"modes": { "<새 대화 ID>": "alternate" },
"workingDirectories": { "<새 대화 ID>": "<그 대화를 처음 만든 작업 폴더>" }
```

- `workingDirectories`는 그 Codex 대화가 원래 쓰던 폴더다. 틀리면 엉뚱한 폴더에서 실행된다.
- 업무 대화 `01a0dadd-…`는 넣지 않는다(넣어도 코드에서 거부한다).

### 6-4. 확인

```powershell
pwsh scripts/ieon.ps1 start
```

웹 화면 목록에 새 세션이 보이면 등록이 끝난 것이다.

> Claude 채널은 지금 한 PC에 하나(`sessionRef: "ieon"`)만 연결된다.

---

## 6-A. 이어온에서 새 세션 만들기

6장은 **이미 있는** Codex 대화를 등록하는 방법이다. 이 장은 이어온이 **새** Codex·Claude 세션을 만들어 주는 기능이다. 웹·메신저·내 프로그램에서 이름만 정하면 세션과 전용 작업 폴더가 생기고, 첫 질문부터 대화가 시작된다.

### 6-A-1. 기능 켜기 (처음 한 번)

기본으로 꺼져 있다. `stop` 한 뒤 아래 블록을 PowerShell에 붙여 넣는다.

```powershell
$Root = 'D:\Project\ieon-gateway'; $L = "$Root\.local"; $R = $Root -replace '\\', '/'
# 1) 새 세션 설정: 기능 켜기, 작업 폴더 위치(세션마다 이 아래에 폴더가 생김)
@{ enabled = $true; workspaceRoot = 'D:/ieon-workspaces' } | ConvertTo-Json | Set-Content "$L\new-sessions.json" -Encoding utf8
# 2) 서버가 이 설정을 읽게 한다
$s = Get-Content "$L\s2\server.json" -Raw | ConvertFrom-Json
$s | Add-Member -Force newSessionsConfigPath "$R/.local/new-sessions.json"
$s | ConvertTo-Json -Depth 8 | Set-Content "$L\s2\server.json" -Encoding utf8
# 3) 연결부가 이 설정을 읽고, 자기가 만든 세션 ID를 기록하게 한다
$c = Get-Content "$L\s2\connector.json" -Raw | ConvertFrom-Json
$c | Add-Member -Force newSessions @{ configPath = "$R/.local/new-sessions.json"; createdPath = "$R/.local/s2/new-threads.jsonl" }
$c | ConvertTo-Json -Depth 8 | Set-Content "$L\s2\connector.json" -Encoding utf8
'새 세션 기능을 켰습니다.'
```

그다음 `pwsh scripts/ieon.ps1 start -Live`. 웹 화면 왼쪽 위에 **새 세션 만들기**가 보이면 켜진 것이다.

- Claude 새 세션을 쓰려면 Claude Code가 설치·로그인돼 있어야 한다(`check`로 확인). Claude 터미널 창(`ieon.ps1 claude`)은 **필요 없다**.
- 끄려면 `new-sessions.json`의 `enabled`를 `false`로 바꾸고 `stop` → `start`.

### 6-A-2. 만들기

| 어디서 | 방법 |
| --- | --- |
| 웹 | **새 세션 만들기** 펼치기 → 엔진(Codex·Claude), 이름(영문·숫자·`-` 2~32자), 권한 → **만들기** |
| 텔레그램·디스코드 | `/new codex 이름` 또는 `/new claude 이름` (권한을 고르려면 끝에 `read_only`) |
| 슬랙 | `!new codex 이름` |
| 내 프로그램 | [개발 프로그램 연동 설명서](API_GUIDE.md) 8장 |

- 메신저에서 만들면 **그 대화방에 바로 연결**된다. 다음 메시지부터 그 세션에 질문으로 간다.
- 작업 폴더는 `D:\ieon-workspaces\<이름>`에 첫 질문 때 생긴다.

### 6-A-3. 권한

| 권한 | 할 수 있는 일 |
| --- | --- |
| 작업 폴더 안 읽기·쓰기(`workspace`, 기본) | 작업 폴더 안 파일 만들기·고치기. 명령 실행·인터넷은 막힘 |
| 읽기 전용(`read_only`) | 읽고 답하기만 |
| 모두 허용(`full`) | 작업 폴더 안 명령 실행·인터넷까지. **화면·메신저에서는 고를 수 없고** `new-sessions.json`에 `"sessionOverrides": { "<이름>": { "profile": "full" } }`로만 지정 |

권한 밖 작업을 하려 하면 "권한 확인이 필요해 멈춤"으로 멈춘다. 9-2처럼 정리한다.

### 6-A-4. 상태와 정리

| 상태 | 뜻 |
| --- | --- |
| 첫 질문 전 | 만들기만 함. 첫 질문 때 실제 세션이 생긴다 |
| 깨어 있음 | 최근에 썼음 |
| 잠듦 | 30분 동안 질문 없음. 질문하면 저절로 깨어난다(대화는 그대로) |
| 보관됨 | 14일 동안 안 씀. 목록에서 빠져 **보관함**으로 간다. 질문하려면 먼저 꺼낸다 |

| 하고 싶은 일 | 웹 | 메신저 |
| --- | --- | --- |
| 바로 잠재우기 | 세션 선택 → **잠재우기** | `/sleep 이름` |
| 보관 목록 보기 | 왼쪽 아래 **보관함** | `/archived` |
| 보관에서 꺼내기 | 보관함 → **꺼내기** | `/restore 이름` |
| 지우기 | 세션 선택 → **삭제** → 이름 입력 | `/close 이름` → `/close 이름 확인` |
| 남은 개수 보기 | 새 세션 만들기 아래 숫자 | `/limits` |

- 지우면 이어온 기록만 지워진다. 원래 Codex·Claude 대화 기록과 작업 폴더는 남는다(작업 폴더까지 지우려면 설정 `cleanup.deleteWorkspaceOnClose: true`).
- 보관 3일 전부터 하루 한 번, 그 세션에 연결된 메신저 대화방에 예고가 간다.
- 기본 한도: 새 세션 10개(Claude는 3개), 동시에 처리하는 질문 3개. `new-sessions.json`의 `limits`에서 바꾼다.

### 6-A-5. 사람이 직접 열기

웹에서 세션을 고르면 **직접 열기 ID**가 보인다(첫 질문 뒤).

- Codex: 일반 Codex 대화라 Codex 앱 목록이나 `codex resume <ID>`로 연다. 번갈아 쓰기처럼, 이어온으로 보낼 때는 앱에서 그 대화를 닫아 둔다.
- Claude: 작업 폴더(`D:\ieon-workspaces\<이름>`)에서 `claude --resume <ID>`. 터미널에서 쓰는 동안에는 이어온으로 질문하지 않는다(보내면 "결과를 확인할 수 없음"으로 멈춘다).

---

## 7. 휴대폰에서 쓰기 (Tailscale)

집 밖에서도 휴대폰으로 질문할 수 있다. 공개 인터넷에 열지 않고 Tailscale(개인용 암호화 네트워크)만 쓴다.

1. PC와 휴대폰에 Tailscale을 설치하고 같은 계정으로 로그인한다.
2. Tailscale 앱에서 PC 주소(`100.`으로 시작)와 휴대폰 주소를 확인한다.
3. `stop` 후 `.local\s2\server.json`에 두 줄을 넣는다.
   ```json
   "extraHosts": ["<PC Tailscale 주소>"],
   "extraAllowedClients": ["<휴대폰 Tailscale 주소>"]
   ```
4. `start` 후 휴대폰 브라우저에서 `http://<PC Tailscale 주소>:28760`을 연다.
5. 웹 화면과 같은 방법으로 토큰을 넣고 쓴다.

- 등록하지 않은 기기는 403(접근 거부)이 나온다.
- 쓰지 않을 때는 두 줄을 지우거나 `stop` 한다.

---

## 8. 메신저에서 쓰기

텔레그램·디스코드·슬랙 봇으로 질문할 수 있다. 봇 만들기는 [메신저 설정 설명서](MESSENGER_MANUAL.md)를 따라 하고, 여기서는 쓰는 순서만 적는다.

1. 봇 토큰을 `.local\.env`에 넣는다(직접 입력, 남에게 보여 주지 않음). 파일이 없으면 메모장으로 만든다.
   ```powershell
   notepad .local\.env
   ```
   "새 파일을 만드시겠습니까?"에 **예**를 누르고, 쓰는 메신저 줄만 적은 뒤 저장한다. `=` 앞뒤에 공백을 넣지 않는다.
   ```
   TELEGRAM_BOT_TOKEN=<텔레그램 봇 토큰>
   DISCORD_BOT_TOKEN=<디스코드 봇 토큰>
   SLACK_APP_TOKEN=<xapp-로 시작하는 토큰>
   SLACK_BOT_TOKEN=<xoxb-로 시작하는 토큰>
   ```
2. 이어온을 켜고 봇을 켠다.
   ```powershell
   pwsh scripts/ieon.ps1 start -Live
   pwsh scripts/ieon.ps1 messenger
   ```
3. 메신저에서 봇에게 `/whoami`를 보내 내 사용자 ID를 확인한다.
4. 그 ID를 `.local\messenger\config.json`의 `allowedUsers`에 넣고 `stop` → `start -Live` → `messenger`.
5. 봇에게 아래 명령을 쓴다. 슬랙은 `/` 대신 `!`를 쓴다.

| 명령 | 하는 일 |
| --- | --- |
| `/sessions` | 세션 목록 보기 |
| `/use 1` | 이 대화방을 1번 세션에 연결 |
| `/status` | 연결된 세션 상태 |
| `/review done` / `/review not` | 확인 필요 정리(9장) |
| `/help` | 도움말 |
| 그 밖의 글 | 연결된 세션에 질문으로 보냄 |

> 카카오톡은 공개 HTTPS 서버가 필요해 지금은 지원하지 않는다.

---

## 9. 문제가 생겼을 때

### 9-1. 자주 나오는 안내

| 안내 | 왜 그런가 | 할 일 |
| --- | --- | --- |
| 연결부에서 실제 실행이 꺼져 있음 | `-Live` 없이 켰다 | `stop` → `start -Live` |
| PC 연결 끊김 | 연결부가 꺼졌다 | `start` |
| 세션이 실행 중이 아님 | Claude 창이 닫혔다 | `pwsh scripts/ieon.ps1 claude` |
| Desktop에서 이 대화를 열고 있어 보내지 않았음 | Codex 앱에서 그 대화가 열려 있다 | 앱에서 그 대화만 닫고 다시 보낸다 |
| 공유 서버에서 이 대화가 사용 중이라 보내지 않았음 | TUI에서 처리 중이다 | TUI 답이 끝난 뒤 다시 보낸다 |
| 원래 세션에서 권한 확인이 필요해 멈춤 | AI가 파일·명령 작업을 하려 했다 | 원래 세션에서 처리 후 9-2 |
| 결과를 확인할 수 없음 | 중간에 연결이 끊겼다 | 9-2 |

새 세션(6-A장)에서만 나오는 안내:

| 안내 | 왜 그런가 | 할 일 |
| --- | --- | --- |
| 새 세션 만들기가 꺼져 있음 / 웹에 "새 세션 만들기"가 안 보임 | 기능이 꺼져 있거나 서버 설정에 경로가 없다 | 6-A-1 블록 실행 → `stop` → `start` |
| 연결부에 새 세션 설정이 없음 | `connector.json`에 `newSessions`가 없다 | 6-A-1 블록 실행 → `stop` → `start` |
| 이름은 영문·숫자·- 2~32자 | 한글·공백·밑줄·한 글자 이름 | 예: `my-proj` |
| 같은 이름의 세션이 이미 있음 | 이름 중복(보관된 세션 포함) | 다른 이름, 또는 기존 세션 삭제 |
| 세션 수 한도를 넘음 | 새 세션이 10개(Claude 3개) | 안 쓰는 세션을 삭제하거나 설정 `limits` 변경 |
| full 권한은 고를 수 없음 | 명령 실행 권한은 화면·메신저에서 못 고른다 | 6-A-3의 `sessionOverrides` |
| 보관된 세션 | 14일 동안 안 써서 보관됐다 | 보관함에서 **꺼내기**(메신저 `/restore 이름`) |
| 동시에 처리할 수 있는 수를 넘음 | 새 세션 질문 3개가 처리 중 | 잠시 후 다시 보낸다 |
| 같은 Claude 세션을 터미널에서 열고 있어 결과를 확인할 수 없음 | 사람이 `claude --resume`으로 연 채 질문했다 | 터미널을 닫고 9-2로 정리 |
| Claude 새 세션이 실패(claude_not_installed) | Claude Code가 없다 | 1-2 설치, `check`로 확인 |

### 9-2. "확인 필요" 정리하기

결과를 모르는 질문이 있으면 그 세션이 잠긴다. 같은 질문이 두 번 실행되는 것을 막기 위해서다. 이어온은 **절대 자동으로 다시 보내지 않는다.**

1. 원래 세션 화면(Codex 앱, TUI, Claude 터미널)에서 그 질문이 실행됐는지 눈으로 본다.
2. 웹에서 그 세션을 고르면 노란 안내와 버튼 두 개가 나온다.
   - 실행됐으면 **원래 세션에서 실행된 것을 확인함**
   - 실행되지 않았으면 **실행되지 않은 것을 확인함** (필요하면 질문을 다시 보낸다)
3. 누르면 잠금이 풀린다.

### 9-3. 켜지지 않을 때

| 증상 | 확인 |
| --- | --- |
| `start` 했는데 웹이 안 열림 | `pwsh scripts/ieon.ps1 status`에서 이어온 서버가 `True`인지 본다. `False`면 `.local\run\server.log` 마지막 줄을 본다 |
| "이미 실행 중" | 이미 켜져 있다. 다시 켜려면 `stop` 후 `start` |
| 포트를 이미 쓰고 있다는 오류 | 다른 프로그램이 28760~28762를 쓰고 있다. 그 프로그램을 끄거나 담당자에게 알린다 |
| 웹에서 토큰이 틀렸다고 나옴 | 3-1의 복사 명령으로 다시 복사한다. 앞뒤 공백이 들어가지 않게 한다 |
| 무엇이 빠졌는지 모르겠음 | `pwsh scripts/ieon.ps1 check`로 Node·부품·설정·Codex·Claude 로그인을 한 번에 본다(1-6) |
| 설정을 고쳤는데 그대로임 | 서버·연결부는 켤 때만 설정을 읽는다. `stop` → `start` |

로그 보기:

```powershell
Get-Content .local\run\server.log -Tail 20
Get-Content .local\run\connector.log -Tail 20
```

로그에는 질문·답변 원문과 토큰이 남지 않는다.

---

## 10. 하루 사용 순서 요약

```powershell
cd D:\Project\ieon-gateway
pwsh scripts/ieon.ps1 start -Live          # 1. 켜기
pwsh scripts/ieon.ps1 claude               # 2. 기존 Claude 세션을 쓸 때만(새 세션은 필요 없음)
pwsh scripts/ieon.ps1 messenger            # 3. 메신저로 쓸 때만
# 4. 브라우저 http://127.0.0.1:28760 → 세션 선택(또는 "새 세션 만들기") → 질문
pwsh scripts/ieon.ps1 stop                 # 5. 다 쓰면 끄기
```

처음 설치했거나 무엇인가 안 될 때는 먼저 `pwsh scripts/ieon.ps1 check`.
