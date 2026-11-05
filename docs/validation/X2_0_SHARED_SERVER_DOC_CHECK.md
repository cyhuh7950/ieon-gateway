# X2.0 — 공유 App Server 모드 문서·계약 확인 (실행 없음)

- 기록: 2026-10-30 / 어울 / branch `feat/s1-safety-core`
- 대상 바이너리: `node_modules/@openai/codex-win32-x64/.../codex.exe` = `codex-cli 0.165.0`(SDK 동봉). Desktop 동봉 엔진(0.165.0-alpha.1.2)과는 별개.
- 수행: `--help` 출력 확인, `app-server generate-json-schema --experimental`로 프로토콜 스키마를 scratchpad에 생성해 조회. **서버 기동·포트 개방·로그인·thread 접근·모델 호출 0회.** 스키마 생성은 파일 출력만 하는 명령이다.

## 1. 확인 결과

| 항목 | 0.165.0 실제 | 설계 영향 |
| --- | --- | --- |
| 서버 실행 | `codex app-server --listen <URL>`, 값 `stdio://`(기본)·`unix://[PATH]`·`ws://IP:PORT`·`off`. 명령 전체가 **[experimental]** | 설계대로 `ws://127.0.0.1:포트`. 실험 기능이라 버전 고정 필요 |
| 서버 측 TLS | `wss://` listen 값 없음 | loopback 한정 유지. 외부 노출 금지 근거가 더 강해짐 |
| 서버 인증 | `--ws-auth capability-token`(`--ws-token-file` 절대경로 또는 `--ws-token-sha256`) / `signed-bearer-token`(JWT: shared secret file·issuer·audience·clock skew) | loopback이라도 `capability-token` + `--ws-token-sha256` 권장(토큰 원문 파일 불필요). 인증 없는 기동 금지를 설계에 명시 |
| 사람 화면 | `codex --remote ws://…|wss://…|unix://` + `--remote-auth-token-env <ENV>` | 설계와 일치 |
| `codex queue` | `--thread`·`--message`·`--remote`·`--remote-auth-token-env`. 그 밖에 `--approve-for-me`·`--dangerously-bypass-approvals-and-sandbox`·`-s`·`-m`·`-C` 존재 | 승인 우회·설정 변경 옵션은 사용 금지. 답 반환 없음은 그대로 |
| daemon | `app-server daemon start/stop/restart/version/bootstrap/enable-remote-control` | 상시 실행 후보. 단 `enable-remote-control`은 Remote Control 보류 결정에 따라 사용 금지 |
| 프로토콜 입력 | `turn/start`, `turn/steer`, `turn/interrupt`, `thread/resume`, `thread/loaded/list`, `thread/queue/add·list·start·update·delete·reorder`, `thread/inject_items` | 아래 2절 |

## 2. 입력 경로 판단

- **`ExternalMessage`는 프로토콜 메서드가 아니다.** Python SDK 계층 개념으로 보이며, 이 PC에 Python SDK가 없어 0.165 기준 구현은 **미확인**이다.
- 대신 프로토콜에 직접 쓸 수 있는 공식 메서드가 있다. 이어온 연결부는 Node(현 구성)에서 WebSocket으로 `turn/start`를 보내고 이벤트로 답을 받으면 된다. **Python SDK 설치가 필수가 아닐 수 있다** → X2.1 승인 항목에서 설치를 빼는 안을 제안한다.
- `TurnStartParams.turnTrigger` 설명에 "이미 실행 중인 turn을 steer할 때는 무시"라고 되어 있어, **실행 중 thread에 `turn/start`를 보내면 기존 turn에 합류(steer)할 수 있다.** 기본 정책 `reject_busy`를 지키려면 연결부가 먼저 thread 상태를 조회하고 실행 중이면 보내지 않아야 한다.
- `thread/queue/add`(필수: threadId·input·clientUserMessageId)는 대기열 접수 경로다. `clientUserMessageId`는 이어온 request_id와 대응시켜 중복 방지에 쓸 수 있다(동작 미확인).
- `turn/start`의 model·cwd·sandboxPolicy·approvalPolicy 등은 "이 turn과 이후 turn"에 남는다. **override를 넘기지 않는다**는 기존 설계(8절)를 그대로 적용한다.

## 3. 미확인으로 남는 것

- 실제 기동, TUI `--remote` 연결, Desktop이 만든 thread를 공유 엔진에서 여는 것, TUI 실시간 표시.
- Windows에서 `unix://` 동작, 방화벽 경고 여부(loopback이라 예상은 없음).
- 실행 중 판정을 어떤 메서드/알림으로 안정적으로 하는지(`thread/loaded/list`·turn 알림 후보).
- Python SDK `ExternalMessage`의 0.165 대응 여부.

## 4. X2.1 승인 요청 시 범위 제안

1. Codex 앱 종료 상태에서 `codex app-server --listen ws://127.0.0.1:<빈 포트> --ws-auth capability-token --ws-token-sha256 <해시>` 기동 1회(토큰은 신산님 PC 환경 변수, 원문 비기록).
2. TUI `codex --remote … --remote-auth-token-env <ENV>`로 시험 thread `01a18790…` 열기(모델 0).
3. 이어온 측은 Node WebSocket 클라이언트로 상태 조회만(모델 0). Python SDK 설치 없음.
4. 모델 turn 3회(X2.2)는 그 다음 별도 승인.
