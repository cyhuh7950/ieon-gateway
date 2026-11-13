# E0 실측 준비 — Grok·Gemini(Antigravity) 세션을 이어온에서 이어 쓸 수 있나

작성 2026-11-13(신산님 "다음 작업 진행하자"). 이 문서는 **준비**다. 설치 0·로그인 0·모델 호출 0.
근거 설계: `docs/design/MORE_ENGINES.md`(ME1~ME7), WORK_PLAN E0.

## 1. 준비 중 확인한 사실(공식 문서·검색, 읽기만)

| # | 사실 | 출처 |
| --- | --- | --- |
| F1 | **(고침, 신산님 "둘 다 설치돼 있는데")** 명령 경로(PATH)에만 없었을 뿐 설치돼 있음: **Antigravity CLI `agy` 1.4.10** = `%USERPROFILE%.geminiinagy.exe`(PATH에 없음), Antigravity 앱·Antigravity IDE도 설치, `~/.gemini/antigravity/conversations` 있음. **Grok은 데스크톱 앱 "Grok Bot" 0.77.0(SpaceXAI, Electron 채팅 앱)만** 있고 세션 이어 쓰기용 **Grok Build CLI(`grok`)는 없음**(`~/.grok` 없음). WSL에는 둘 다 없음 | 파일 위치·버전 확인 |
| F1-1 | `agy --help`(1.4.10): **`-p/--print` 한 번 실행, `--output-format text|json|stream-json`, `--conversation <ID>` 이어 쓰기, `-c`, `--mode accept-edits|auto|plan`, `--sandbox`(터미널 제한), `--print-timeout`**, `--dangerously-skip-permissions`(쓰지 않음), `--remote-control`(쓰지 않음) | `agy --help` |
| F2 | **Grok Build CLI는 Windows 공식 설치가 있음**: PowerShell `irm https://x.ai/cli/install.ps1 \| iex` → `%USERPROFILE%\.grok\bin`. 로그인 `grok login`(브라우저) / `grok login --device-auth`(기기 코드), 로그인 정보는 `~/.grok/auth.json` | [docs.x.ai CLI reference](https://docs.x.ai/build/cli/reference), [flaviocopes 안내](https://flaviocopes.com/grok-build/) |
| F3 | Grok 이어 쓰기: `-r, --resume <ID>`, `-c`(이 폴더 최근), `--fork-session`(갈라 쓰기 — **이어온은 쓰지 않음**). 권한: `--always-approve`(=`--yolo`, **쓰지 않음**)·`--allow`/`--deny` 규칙·`--sandbox <프로필>`. ACP는 `grok agent stdio` — `session/load` 지원은 문서에 없음. 질문 한 번 실행(`-p`)·JSON 출력은 "Headless & Scripting" 문서에 있다고만 확인 | 같은 문서 |
| F4 | Grok에 **로그인 상태 확인 명령이 문서에 없음**(`grok inspect`는 설정만). 사용 중(잠금) 판별도 문서에 없음 → 실측 | 같은 문서 |
| F5 | **Antigravity CLI(`agy`)도 Windows 공식 설치가 있음**: PowerShell `irm https://antigravity.google/cli/install.ps1 \| iex` → `%LOCALAPPDATA%\agy\bin`. 개인 Google 계정 로그인은 브라우저, 로그인 정보는 **Windows 자격 증명 관리자**(OS 열쇠고리). 이어 쓰기 `--conversation <ID>`·`-c`, TUI `/resume`. 비대화형 한 번 실행·JSON 출력·권한 모드·ACP 세부는 공식 문서에서 확인 못 함 → 실측 | [Antigravity 설치·인증](https://antigravity.google/docs/install?tab=cli), [computingforgeeks 설치 안내](https://computingforgeeks.com/install-antigravity-cli-linux-macos-windows/) |
| F6 | Antigravity: Windows 11 24H2에서 첫 실행 때 Defender가 몇 분 격리할 수 있음(안내 글). WSL에서는 로그인이 유지되지 않는 버그 보고 | 위 안내·[Google 포럼](https://discuss.ai.google.dev/t/bug-antigravity-cli-agy-fails-to-persist-authentication-state-in-wsl-2-environment/146059) |
| F7 | Gemini CLI는 2026-06-18부터 개인 Google 계정 로그인이 막혀 API 키(종량제)만 — **이번 실측 대상 아님**(ME3: Antigravity 먼저) | MORE_ENGINES 0절 |

## 2. 실측 절차(엔진마다 시험용 세션만, 업무·기존 세션 미사용)

임시 폴더 `.local/e0/<엔진>/ws`(git 제외)에서 새 시험 세션을 만들어 쓴다. API 키 환경 변수(`XAI_API_KEY`·`GEMINI_API_KEY`)는 실행 때 지운다(종량제로 새지 않게, ME7). 자동 승인(`--always-approve` 등)은 쓰지 않는다.

| 단계 | 내용 | 모델 호출 | 확인할 것 |
| --- | --- | --- | --- |
| G0 | Grok 설치(공식 설치 명령) → `grok --version`, `grok --help`(headless·권한·세션 옵션 실제 확인) | 0 | Windows에서 도는지 |
| G1 | 신산님 `grok login --device-auth`(grok.com 구독 계정) → 로그인 상태를 확인하는 방법 찾기(파일 내용은 읽지 않음) | 0 | 구독 로그인 여부 판별 |
| G2 | 시험 세션 만들기: `grok -p "준비됨이라고만 답해" --output-format json`(읽기 전용 쪽 설정) | **1** | 세션 ID가 나오는지, 세션 파일 위치 |
| G3 | 같은 세션 이어 쓰기: `grok -r <ID> -p "…" --output-format json` | **1** | 같은 세션 파일에 이어지는지(새 세션·fork 아님) |
| G4 | 사용 중 판별: 신산님이 그 세션을 TUI로 열어 둔 채 G3처럼 보냄 | **1**(거부되면 0) | 거부되는지·잠금 파일이 있는지·섞이는지 |
| G5 | 읽기 전용: G3에서 "파일 만들어 줘"라고 시켜 권한 없이 거부되는지(`--deny` 규칙·샌드박스) | **1** | 파일이 안 생기는지 |
| A0~A5 | Antigravity(`agy`)로 G0~G5와 같은 순서(이어 쓰기는 `--conversation <ID>`) | **4** | 같은 항목 + Desktop 앱과 CLI가 같은 대화를 쓰는지 |

**모델 호출:** Grok 4차례 + Antigravity 4차례 = 최대 8차례(사용 중 판별에서 거부되면 그만큼 줄어듦). G4·A4는 신산님이 TUI(또는 Antigravity 앱)에서 시험 세션을 열어 두는 손이 필요 — 이것만은 본인이 해야 하는 일.

## 3. 멈춤 조건

- 이어 쓰기가 새 세션·갈라 쓰기(fork)로 바뀜 → 그 엔진 "불가"(ME4).
- 읽기 전용 지시인데 파일이 생기거나 명령이 실행됨 → 중단·불가(질문만 원칙).
- 로그인이 구독이 아니라 종량제(API 키)로 잡힘 → 중단.
- Windows에서 설치·실행이 안 됨 → 그 엔진은 이 PC에서 보류(WSL·다른 PC는 별도 결정, MORE_ENGINES 7절).

## 4. 신산님께 필요한 것

1. **설치 승인**: Grok Build CLI, Antigravity CLI — 각 공식 설치 명령(위 F2·F5, 공식 주소에서 받아 실행). 설치 위치는 사용자 폴더(관리자 권한 불필요).
2. **구독 확인**: Grok — grok.com 구독(로그인으로 쓰는 요금제)이 있는지, Antigravity — 개인 Google 계정(무료 또는 AI Pro)으로 쓸지.
3. **로그인**: 설치 뒤 각 공식 로그인(브라우저에서 승인) — 본인만 가능.
4. **모델 호출 승인**: 최대 8차례(엔진별로 나눠 승인해도 됨).
