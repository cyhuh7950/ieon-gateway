# S0 추가 조사 — Windows Desktop의 공식 연결 경로

- 조사일: 2026-10-29 KST / 담당: 어울
- 범위: 현재 실행 중인 Windows Desktop의 연결 방식·공식 지원·기존 socket 소속 판단. 기능 구현·모델/이어쓰기 검증은 수행하지 않음.
- 판정: **App Server 연동과 first-party Remote Control은 공식 기능이다. 그러나 현재 Windows Desktop의 살아 있는 runtime에 이어온 같은 외부 client가 연결하는 공개 지원 경로는 확인하지 못했다.** 전체 미지원으로 단정하지 않으며 해당 설치 환경의 외부 연결은 미확인이다.

## 1. 현재 설치·실행 증거

| 항목 | 실제 확인 |
| --- | --- |
| 앱 | OpenAI.Codex 패키지 26.1023.6123.0. 실행 부모 PID 19212의 파일명은 ChatGPT.exe |
| 대화 실행 엔진 | 동봉/관리 엔진 0.165.0-alpha.1.2, PID21356, 부모19212. 명령 종류 app-server, analytics flag만 확인. listen/remote/daemon/proxy flag 없음 |
| 별도 자식 | PID34344, 부모19212, 명령 종류 exec-server. --remote·--environment-id는 파일/명령 실행 서버의 옵션이며 대화 App Server 접속 증거가 아님 |
| 관리 daemon 기록 | 기록 PID21016은 종료. 읽기 전용 daemon version은 exit1로 관리 서버 버전을 확인하지 못함 |
| 기존 socket | ~/.codex/app-server-control/app-server-control.sock 엔트리 존재, 수정 2026-10-08T16:21:03Z. 이전 S0에서 연결 거부10061. 이번에 proxy는 재실행하지 않았으며 daemon version 조회 1회는 exit1 |

설치된 app.asar의 공급 코드도 정적으로 대조했다. 사용자 기록·설정·auth 내용은 열람하지 않았으며 공급 코드를 실행·추출·수정하지 않았다.

`application-network-startup-DMyt3FBI.js`의 로컬 연결 선택 조건은 **Windows 이외**이고, 별도의 로컬 daemon 사용 조건과 버전 확인을 만족해야 control socket에 연결한다. Windows에서는 이 분기를 선택하지 않고 `StdioConnection`을 생성한다. 해당 클래스는 App Server child를 생성하고 stdin/stdout pipe로 주고받는다. 현재 앱의 부모·자식·명령 flag 구성이 이 경로와 일치한다.

정적 증거 fingerprint: SHA-256 `c4497beb1a68f4322acd6ec2fd1a44c06c24025b115b12324aefae5569849e9d`. 근거 위치는 파일 내 decoded Unicode 문자 offset 기준 class `_c` 264234, pipe spawn 266024, control socket 선택 270430 근처다. 전체 파일/원문을 repository에 복사하지 않았다. [정제 증거](s0-desktop-path-evidence.json)에 확인 조건·경로·hash를 보존한다.

이 정적 분기는 현재 설치 구현을 설명하는 보조 근거다. 비공개 환경변수나 내부 IPC가 보인다는 이유로 외부 client 공식 지원이라고 판정하지 않는다. Windows를 제외하는 분기가 있어, 로컬 daemon 관련 환경변수만 켜고 앱을 재시작하면 해결된다고 제안하지 않는다.

## 2. 기존 socket은 현재 runtime의 것인가

**현재 Windows Desktop이 사용하는 접속 경로로 확인되지 않았고, 설치 코드상 현재 로컬 stdio 경로와 다르다.** 종료된 daemon 기록·오래된 엔트리·연결 거부까지 일치한다. 그러나 파일의 생성 주체나 과거 어느 실행이 만들었는지는 확인하지 않았으므로 과거 daemon의 잔재라고 확정하지 않는다. 삭제·재생성·권한 변경도 하지 않는다.

기존 socket의 파일명, 같은 사용자 계정, 같은 engine binary, 같은 CODEX_HOME을 근거로 현재 PID21356의 endpoint라고 취급하지 않는다. 원래 runtime의 listener/프로세스 식별과 공식 초기화·대상 상태 대조가 함께 필요하다. 이번에는 그 연결이 성립하지 않았다.

## 3. 공식 경로별 지원과 한계

| 경로 | 공식 확인 | 현재 Desktop과 같은 runtime인지 |
| --- | --- | --- |
| App Server stdio / Unix socket / WebSocket + JSON-RPC | 자체 client 통합용 문서 존재. listen에 연결 후 initialize. App Server 명령과 WebSocket transport는 실험적이며 production 지원 아님 | 연결 대상 서버 자체의 runtime이다. 현재 앱 소유 stdio child에 외부 client가 나중에 붙는 공개 절차는 찾지 못함 |
| CLI --remote / agents | 지정한 App Server endpoint에 접속하는 공식 client 경로 | 실제 Desktop이 사용하는 같은 서버 endpoint를 지정해야 성립. 현재 Desktop에 그 endpoint가 확보되지 않음 |
| CLI 기본 shared daemon / daemon proxy | 관리 서버·기존 control socket 연결 기능은 도움말/CLI 문서에 존재 | CLI들 사이 공유 가능성과 이 Desktop 공유는 별도다. 현재 설치 앱의 Windows 로컬 분기는 daemon socket을 선택하지 않음 |
| Desktop Remote Control | 동일 계정/workspace·승인 기기·호스트 연결과 기기 pairing이 문서화됨 | first-party 기기에서 같은 호스트의 기존 채팅 접근을 지원. 이어온용 공개 client 등록·endpoint·인증 규격은 해당 문서에서 확인하지 못함 |
| SSH remote host | Desktop이 SSH를 통해 원격 App Server를 시작하는 공식 경로 | 현재 Windows local runtime 접속 증거가 아니며 실행 위치가 달라짐. 현재 대화의 runtime을 유지한 직접 연결로 대체하지 않음 |
| /app 또는 codex://threads/<id> | 같은 저장 채팅을 앱에서 여는 경로 | 창/저장 채팅 접근 절차이며 살아 있는 원래 실행 상태 공유의 증거가 아님. 이번에는 실행하지 않음 |

새 `codex app-server`를 실행하면 별도 프로세스/서버가 생긴다. 기본 CLI는 자체 managed daemon을 선택할 수 있어 항상 독립이라고 일반화하지 않지만, 어느 쪽도 현재 Desktop child에 자동으로 붙는다고 보장되지 않는다. 이번에는 별도 CLI/App Server를 시작하지 않았다.

같은 저장 파일에서 thread를 찾거나 같은 ID로 재개할 수 있다는 것과, 원래 Desktop의 active turn·승인 대기·메모리 상태·실행 잠금을 공유하는 것은 구분한다. 다른 서버에서 notLoaded/idle로 보여도 원래 Desktop의 idle 증거가 아니다. 저장 파일을 읽는 비교 실험도 이번에는 하지 않았다.

## 4. 재시작·설정 변경이 필요하다면

**지금 재시작이나 daemon 시작으로 문제가 해결된다는 근거는 없다. 현재 단계에서는 권장하거나 수행하지 않는다.** 공개 지원 경로 확인이 먼저다.

| 후보 조치 | 필요한 선행 확인·사용자 영향 | 이번 수행 |
| --- | --- | --- |
| Desktop Remote Control 설정·기기 pairing | 공식 first-party 기기 경로를 따로 확인하는 목적임을 명시. 원격 접근 허용과 계정/기기 인증이 필요하며 이어온 API 제공을 보장하지 않음. 현재 계정·빌드의 가용성은 미확인 | 미수행 |
| Desktop 재시작·업데이트 | 해당 빌드의 외부 client 연결 지원과 정확한 전환 절차부터 확정. 진행 중 turn·도구·승인·IPC가 끊길 수 있으므로 다른 작업까지 idle 확인 및 안전 기록 필요. 재시작이 연결 문제를 해결한다고 보장하지 않음 | 미수행 |
| shared daemon/listen으로 실행 경로 전환 | Windows Desktop이 그 서버에 접속하는 공식 지원 방법, endpoint 인증, 기존 thread·설정 보존, 원자 차단, rollback을 먼저 확인. 단순 daemon 시작은 Desktop runtime 전환이 아님 | 미수행 |

추후 전환이 필요하다고 확인되면 대상 앱/프로세스·설정 항목·중단 영향·복구 방법·원래 대화 보존·비용 0 조건을 먼저 보고하고 직접 승인 후 적용한다. 비공개 환경변수 강제, App Server port 공개, 기존 pipe 탈취/중계, auth 복사는 제안 경로로 채택하지 않는다.

## 5. 권장 다음 조치와 문의할 정확한 내용

현재 실행 상태를 유지하고, 공식 지원 채널/문서에서 다음 계약을 확인하는 것이 우선이다. 외부 문의 메시지는 발송하지 않았다.

1. Windows 앱 26.1023.6123.0 / engine0.165.0-alpha.1.2에서 외부 프로그램이 기존 앱 소유 runtime에 attach하는 공식 지원 경로가 있는가?
2. 있다면 local endpoint 발견·서버 식별·사용자 승인/인증 방법은 무엇이며, 실행 중인 앱을 재시작하지 않고 가능한가?
3. Remote Control은 승인된 first-party client 외에 별도 HTTP 서비스를 위한 공개 client API를 제공하는가?
4. 같은 thread를 두 client가 사용할 때 활성 turn에 입력을 끼워 넣지 않도록 보장하는 원자적 거부 계약이 있는가?

공식 답변/계약이 없으면 이어온의 기존 Windows Desktop runtime 연결은 미확인 또는 지원 경로 부재라는 한계를 유지한다. 새 서버·새 thread·기록 복사를 성공 대체로 쓰지 않는다. 기능 구현·실제 이어쓰기 대상을 정하는 것은 이 결과 검토 뒤 별도다.

## 공식 근거

- [Codex App Server](https://learn.chatgpt.com/docs/app-server): 통합 프로토콜·transport·초기화·runtime 상태·실험적 지원 범위.
- [CLI reference](https://learn.chatgpt.com/docs/cli/reference): remote 지정 client·shared daemon·remote-control과 자체 protocol client의 구분.
- [Remote connections](https://learn.chatgpt.com/docs/remote-connections): first-party 기기·동일 계정/workspace·기기 pairing·SSH 실행·재시작 관련 조건. 가용성은 rollout에 따라 다름.
- [Developer commands](https://learn.chatgpt.com/docs/developer-commands): /app은 같은 저장 채팅 열기이며 같은 runtime 연결 보장은 아님.

문서의 제품 표시명은 ChatGPT desktop으로 바뀌어 있으며, 로컬 설치 package 이름은 OpenAI.Codex다. 최신 문서만으로 이 installed build의 기능 가용성을 확정하지 않았다. 이번 추가 조사는 thread/turn RPC·본문 조회·질문 전송·대화 생성/재개·검증용 모델 호출·기능 구현·앱 재시작·설정/인증 변경 모두 0회다. 도움말상 읽기 전용 daemon version 조회 1회가 있었으며 그 명령 내부 IPC 시도 여부는 따로 검증하지 않았다. 기존 조사 source와 테스트는 수정·재실행하지 않았다.
## 6. 설치 버전 전송 형식과 기존 조사 코드 대조

이 절은 공식 버전 소스를 확인하기 전의 조사 기록이다. proxy 변환 여부의 최신 판정은 아래 **7절**을 우선한다. 현재 Desktop 외부 attach 미확인 판정은 유지한다.

2026-10-29 추가 정적 대조. 앱 버전·engine PID·공급 모듈 SHA-256가 앞선 조사와 같음을 재확인했다. 기존 socket 재접속·daemon 기동/버전 조회·추가 listener·모델 호출은 하지 않았다. 동봉 CLI는 proxy --help만 실행했다.

| 경계 | 설치 버전 근거 | 기존 조사 코드 | 판정 |
| --- | --- | --- | --- |
| Desktop → 앱 소유 child stdio | StdioConnection의 stdin 개행 송신·stdout JSONL parser·pipe spawn 확인 | JSON.stringify(message)+개행, 개행 분리 JSON.parse | JSONL 문법은 일치. 그러나 현재 Desktop의 기존 pipe에 붙는 기능은 조사 코드에 없음 |
| local daemon Unix socket | 공급 모듈은 WebSocket URL과 Unix createConnection을 함께 사용. 이 분기는 현재 Windows에서 제외 | 조사 코드는 socket에 직접 WebSocket 연결하지 않음 | 현재 Desktop 경로와 다름. 실제 전송으로 사용하려면 HTTP Upgrade 및 WebSocket 프레임 처리가 필요 |
| 조사 코드 → codex app-server proxy --sock | 도움말은 stdio bytes를 기존 control socket으로 proxy한다고 설명. JSONL↔WebSocket 변환 여부를 명시하지 않음 | proxy stdin에 JSONL을 쓰고 stdout도 JSONL로 파싱. 자체 HTTP Upgrade/framing 구현 없음 | **변환 계약 미확인. 해당 proxy 경로의 설치 버전 호환을 확인했다고 할 수 없음** |
| RPC JSON schema | 설치 버전의 메시지 필드·method 정의 | 해당 schema로 알림 이름만 추출 | 메시지 계약 확인이며 transport/handshake/frame 호환 증거가 아님 |

이 대조는 정적 분석이다. 직접 stdio의 JSONL 문법 일치와 기존 Desktop runtime attach 성공은 서로 다른 판정이다. 별도 서버가 같은 thread 파일을 읽는 실험으로 이 간격을 채우지 않았다.

이전 OS10061은 서버 연결 단계에서의 거부다. 이후 handshake·프레임·initialize가 시험되지 않았으므로 전송 호환 성공/실패 또는 thread 접근 결과로 해석하지 않는다. 앞선 대역 안전 검사 7개도 논리 메시지 대역을 사용하므로 실제 proxy의 전송 호환을 검증하지 않는다.

현재 코드에 WebSocket 구현이 없다는 사실만으로 proxy가 절대 변환하지 않는다고 단정하지 않는다. 그 변환의 공식/설치 구현 계약을 확보하지 못한 상태다. 이 미확인을 해소하기 위한 코드 수정·서버 기동·기존 socket 재시도는 이번 범위에서 하지 않았다. 조사 CLI의 재실행 예시는 현재 승인된 실행 경로가 아니며 그대로 재사용하지 않는다.

공식 문서는 stdio는 JSONL, Unix socket은 WebSocket over socket과 HTTP Upgrade로 구분한다. 설치 Desktop 코드의 분기도 이 구분과 일치한다. [App Server Protocol](https://learn.chatgpt.com/docs/app-server)

### 현재 필요한 승인 전 패킷

공식 공유 경로가 먼저 확인되어야 한다. 아래는 조치 실행 제안이 아니라, 필요성이 입증됐을 때 제출할 영향·복구 조건이다. 현재는 적용하지 않는다.

| 조치 | 사전 영향 확인 | 복구안·중단 조건 |
| --- | --- | --- |
| Desktop 재시작/실행 전환 | 어떤 공식 기능을 위해 필요한지, 대상 앱·engine 버전·진행 turn/도구/승인·다른 대화 영향 명시. 모든 관련 작업 idle과 안전 기록 확인 | 원래 공식 시작 경로·버전·설정 유지/복원 방법부터 확정. 재접속 후 원래 thread의 실행 여부가 불확실하면 unknown, 시험 질문/재전송 없음 |
| local listener 추가 | 현재 Desktop 소유 App Server가 그 listener를 공식 지원하는지, bind 주소/인증/접근 주체/수명·기존 stdio 공존 영향 명시. 별도 서버 listener를 Desktop 공유로 제안하지 않음 | 이번 작업이 만든 정확한 listener/프로세스만 종료하고 잔류 확인. 공용 port/기존 프로세스는 변경하지 않음. 현재 Desktop에 listener를 붙이는 지원 경로 자체가 미확인 |
| 지속 설정 변경 | 정확한 키·원래 revision·적용값·재시작 필요 여부·다른 대화 영향·Secret 처리 명시 | 원자 비교/복원 조건과 사용자 중간 변경 보존. 달라진 현재값은 덮어쓰지 않고 충돌 보고. 공식 복원 계약 없으면 적용하지 않음 |

어떤 조치도 지금 필요하다고 확정하지 않았다. 공개 attach 경로·전송 변환 계약이 확인되기 전에는 현재 개발 대화에 질문을 보내지 않고, 같은 저장 파일·새 thread·새 App Server로 성공을 대체하지 않는다.

## 7. 0.165.0-alpha.1.2 공식 소스의 확정 판정

**proxy는 JSONL과 WebSocket을 변환하지 않는다.** stdin↔Unix socket↔stdout 사이의 raw byte relay다. 현재 Desktop runtime 외부 attach 지원은 별도로 미확인이다.

### 정확한 버전과 추적 경로

공식 저장소 openai/codex의 `rust-v0.165.0-alpha.1.2` tag를 `git ls-remote`로 확인했다. annotated tag object는 `3237dd94e20d69fbb5b424baec89833901ff835e`, peeled commit은 `720fec862a608ae1e5878d1eecb04fb93192e93c`다. 다음 근거는 모두 해당 commit으로 고정했다. 최신 main이나 유사 버전, fork·이슈 작성자의 재현을 근거로 대체하지 않았다.

| 공식 파일·줄 | 확인한 내용 |
| --- | --- |
| [cli/src/main.rs 1478–1486](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/cli/src/main.rs#L1478-L1486) | Proxy dispatch는 --sock 또는 기본 control socket 경로를 구한 뒤 codex_stdio_to_uds::run을 호출 |
| [stdio-to-uds/src/lib.rs 12–43](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/stdio-to-uds/src/lib.rs#L12-L43) | UnixStream::connect 후 socket→stdout과 stdin→socket을 각각 tokio::io::copy로 전달. JSON parse·HTTP Upgrade·WebSocket encode/decode 없음 |
| [uds/src/lib.rs 77–98](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/uds/src/lib.rs#L77-L98) | AsyncRead/AsyncWrite를 내부 byte stream으로 위임. Windows도 UDS compatibility stream을 사용하며 JSONL↔WebSocket 변환 계층이 아님 |
| [transport/unix_socket.rs 193 이후](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server-transport/src/transport/unix_socket.rs#L193) | control socket이 accept_hdr_async_with_config로 WebSocket handshake를 수행 |

따라서 proxy를 통과하는 client가 HTTP Upgrade와 WebSocket frame을 처리해야 한다. proxy를 사용한다는 이유로 JSONL을 바로 쓸 수 있는 것은 아니다. 이 결론은 source의 실제 dispatch·relay·listener를 연결해 확인한 정적 판정이다.

### 두 판정의 분리

| 항목 | 판정 |
| --- | --- |
| 정확한 버전 proxy의 변환 기능 | **없음 — raw byte relay로 확정** |
| 기존 조사 코드의 JSONL→proxy→WebSocket control socket 형식 | **부적합**. 코드에 필요한 handshake/frame 처리가 없음 |
| 현재 Desktop 소유 stdio에 외부 client가 공식 attach 가능한가 | **미확인**. 위 source는 현재 Desktop의 pipe 소유권이나 외부 attach 경로를 제공한다는 증거가 아님 |
| 이전 OS10061의 실제 실패 원인 | 기존 receipt대로 연결 거부. handshake 이전이어서 framing 불일치가 당시 오류를 일으켰다고 바꾸지 않음 |
| 실제 설치 binary의 live 전송 성공 | 미실행. source 재빌드·재현 build·실제 소켓 연결로 binary와 대응 검증하지 않았음 |

현재 조사 코드의 7개 대역 검사는 raw proxy의 실제 wire transport를 검사하지 않았다. 이를 transport 호환이나 Desktop 연결 PASS로 재사용하지 않는다. 코드 수정·새 WebSocket adapter 구현·socket 재시도는 하지 않았다. 별도 App Server가 같은 저장 파일을 읽는 실험도 하지 않았다.

이번에 읽은 공식 원본은 메모리에서만 분석했고 clone·build·dependency 설치·source 전체 영구 복사는 하지 않았다. [소스 증거](s0-proxy-source-evidence.json)에 tag→commit·파일 SHA-256·근거 줄·실행하지 않은 범위를 기록했다. 기존 설치 버전 문자열과 같은 공식 tag를 조사한 것이며, 설치 binary가 이 commit의 재현 가능한 build라는 추가 검증까지 했다는 뜻은 아니다.

이 소스 조사에서는 socket 접속/재시도·daemon/version/start·앱 재시작·listener·설정/인증 변경·thread/turn RPC·검증용 모델 호출 모두 0회다. 현재 Desktop runtime 외부 연결 여부는 계속 미확인으로 보고한다.
## 8. stdio App Server 자체의 외부 경로 — 정확한 버전 소스 추적

분석 commit은 동일한 `720fec862a608ae1e5878d1eecb04fb93192e93c`(tag `rust-v0.165.0-alpha.1.2`)다. 이번에는 현재 PC 설정·앱 상태·계정·소켓을 조회하지 않고 해당 공식 source만 읽었다.

**판정은 세 가지로 나뉜다.**

| 질문 | 판정 |
| --- | --- |
| 이미 실행 중인 stdio에 외부 client가 직접 붙는 local attach / 추가 listener가 있는가 | 검토한 source에서 찾지 못함. stdio transport 선택은 stdin/stdout 연결 하나만 시작하며 Unix/WebSocket listener 선택과 분리됨 |
| stdio와 같은 App Server 프로세스에 외부 입력 경로를 구성할 코드가 있는가 | **있음: 조건부 Remote Control 보조 transport.** 별도 daemon만의 기능으로 한정되지 않음 |
| 현재 Windows Desktop에서 그 경로가 활성화됐고 이어온이 공식 client로 연결 가능한가 | **미확인.** 현재 활성/등록/페어링 상태를 조회하지 않았고 이어온용 공개 client 등록·인증·접속 계약도 확인하지 못함 |

### 같은 runtime인 소스 경로

- [app-server/src/lib.rs 815–861](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server/src/lib.rs#L815-L861): Stdio는 start_stdio_connection, UnixSocket은 start_control_socket_acceptor, WebSocket은 start_websocket_acceptor. stdio 선택이 기존 소켓/listener를 자동 제공하는 구조가 아니다.
- [같은 파일 888–901](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server/src/lib.rs#L888-L901): transport 선택 뒤 start_remote_control을 호출하며 **같은 transport_event_tx**, state DB, auth manager, stdio client 이름 수신 경로를 전달한다. 이는 다른 서버에서 저장 파일을 읽는 경로가 아니다.
- [remote_control/controller.rs 265–311](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server-transport/src/transport/remote_control/controller.rs#L265-L311): 관리 정책·state DB·startup mode에 따라 disabled/unknown/enabled desired state를 만든다. handle/task를 구성한다는 사실이 현재 원격 접근 활성화를 뜻하지 않는다. stdio client 이름을 구분해 보관 선호를 처리한다.
- [remote_control/client_tracker.rs 150–176](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server-transport/src/transport/remote_control/client_tracker.rs#L150-L176): RemoteControl origin의 ConnectionOpened와 IncomingMessage를 해당 transport event queue로 전달한다. source상 같은 App Server의 요청 처리 경로다.
- [message_processor.rs 1197–1216](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server/src/message_processor.rs#L1197-L1216): 이미 초기화된 client의 remote-control enable/disable/status 요청을 그 프로세스의 handle로 처리한다.

Remote Control은 관리 서비스/relay와 인증된 peer를 사용하는 보조 경로다. 기존 stdio pipe에 외부 client가 직접 연결하는 공개 local endpoint를 뜻하지 않는다. enable RPC의 존재도 처음 연결할 수 없는 외부 client에게 bootstrap 경로를 제공하지 않는다.

### 조건·인증·수명과 별도 daemon의 구분

| 경계 | 같은 source에서 확인한 것 | 현재 환경에서 확인하지 않은 것 |
| --- | --- | --- |
| 활성화 | startup mode/보관 선호/관리 정책/state DB 조건. 기존 client를 통한 enable 가능 | 현재 Desktop의 활성 여부·관리 정책·등록/페어링·권한 |
| 인증 | [remote_control/auth.rs 100–141](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server-transport/src/transport/remote_control/auth.rs#L100-L141)는 ChatGPT 인증을 요구하고 이 relay의 API-key 인증을 허용하지 않음 | 사용자의 실제 credential·토큰·계정 상세는 조회하지 않음. 이 제한을 일반 App Server 실행 인증 전체의 제한으로 확대하지 않음 |
| 임시 활성화 | [remote_control_processor.rs 41–60](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server/src/request_processors/remote_control_processor.rs#L41-L60)에 ephemeral enable 분기가 있음. source상 재시작이 항상 필수는 아님 | 현재 Desktop UI/외부 client가 이 경로를 공식 지원하는지. ephemeral도 접근 권한을 바꾸므로 호출하지 않음 |
| stdio 수명 | [lib.rs 1215–1218](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server/src/lib.rs#L1215-L1218)에서 stdio 연결 종료 시 remote-control shutdown token을 취소 | 실제 강제 종료/복구는 시험하지 않음 |
| 별도 daemon | [daemon launch.rs 15–25](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server-daemon/src/launch.rs#L15-L25)는 Daemon::from_environment와 자체 설치/설정/lock의 start를 사용. [pid_start.rs 214–216](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server-daemon/src/backend/pid_start.rs#L214-L216)은 별도 child를 spawn | 해당 관리 서버를 시작해도 기존 Desktop 소유 stdio child가 그 서버에 다시 붙는다는 경로는 확인하지 못함. 실제 시작하지 않음 |

### 이번 조사로 해결된 것과 남은 한계

앞선 “외부 경로 미확인”은 **이어온이 현재 Desktop에 접속 가능한 공식 외부 client 경로를 확보하지 못했다**는 의미로 유지한다. “stdio에는 외부 입력 경로 코드가 전혀 없다”는 의미로 해석하면 부정확하다. 이번에는 같은 프로세스 Remote Control 경로의 존재를 source로 확인했다.

남은 조건은 현재 Desktop에서의 공식 활성화/승인 기기 등록 경로와, 이어온 client의 공개 지원·인증/승인·endpoint 계약이다. 이 engine tag의 구현만으로 Desktop 프런트엔드의 공개 지원 정책·현재 계정의 가용성까지 확정할 수 없다. 직접 local attach는 검토한 source에서 찾지 못했으며, 확인 범위 밖의 모든 구현이나 미래 버전까지 미지원으로 단정하지 않는다.

source에 restart 없이 enable 가능한 분기가 있으므로 우선 재시작부터 제안하지 않는다. 실제 활성화가 필요하면 대상 Desktop/계정·원격 접근 확대·보관 여부·기존 작업 영향·종료/원래 상태 복구를 먼저 구체화해 승인받아야 한다. 별도 daemon 기동·인증 복사·비공개 pipe 중계·저장 파일 공유로 현재 runtime 연결을 대체하지 않는다.

이번에는 소켓/RPC/daemon/version/start/listener/설정 변경/시험 질문/모델 호출·source/test 수정 모두 0회다. 검증은 source의 연결 구조에 대한 정적 대조이며 실제 peer 연결·양방향 이어쓰기 성공이 아니다. [정제 source 증거](s0-stdio-runtime-source-evidence.json)에 파일 hash·근거 줄·미실행을 보존했다.
## 9. 최신 경로 결정 — Remote Control 보류

신산님이 현재 Desktop의 Remote Control 비활성화를 확인했다. 공개 외부 client 등록·인증·접속 문서/API를 확인하지 못했으므로 이 경로를 보류한다. 내부 구현 존재를 공개 client 계약으로 취급하지 않으며 추가 내부 protocol 분석·모방·인증 재사용·활성화를 하지 않는다. 별도 PC App Server 대안은 같은 Desktop runtime이 아닌 실행 주체로 계약 검토한다. 원래 thread/양방향/동시 차단 요구는 유지한다. 최신 검토·한계·A0~A3는 [Remote Control 공개 계약 판정 및 별도 App Server 대안](REMOTE_CONTROL_PUBLIC_CLIENT_AND_STANDALONE.md)에 둔다.
