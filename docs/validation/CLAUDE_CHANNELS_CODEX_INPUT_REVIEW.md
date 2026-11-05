# Claude Channels와 Codex 열린 세션 외부 입력 비교

- 기록: 2026-10-29 17:57 KST / 어울 / 문서·공식 source 비교만 수행.
- 설치 버전과 대응하는 official tag `rust-v0.165.0-alpha.1.2`, commit `720fec862a608ae1e5878d1eecb04fb93192e93c`을 대조했다. source 존재와 실제 설치/runtime 동작은 구분한다.
- [source fingerprint·미실행 증거](codex-external-input-source-evidence.json).

## 1. 답과 정정

**Codex에서도 열린 같은 실행 세션으로 외부 메시지를 넣고 결과를 받아오는 유사 구조를 설계할 수 있다.** 공식 SDK/API의 입력 경로와 queue 명령이 있다. ‘Codex는 MCP pull만 가능하고 외부 메시지 입력은 없다’는 일반화는 부정확하다.

필수 조건은 **그 thread를 소유한 같은 App Server에 접근할 수 있어야 한다**는 것이다. 무조건 세션을 닫거나 새 대화로 바꿔야 하는 것은 아니다. 반대로 ID와 계정 로그인만으로 임의 Desktop/클라우드 runtime에 접속할 수 있다는 뜻도 아니다.

현재 Windows Desktop의 기존 stdio App Server에 외부 이어온 프로그램이 공식적으로 바로 붙는 경로는 여전히 미확인이다. 이번에 이를 확인하기 위해 socket/daemon/queue/메시지를 실행하지 않았다. 기존 stdio 관찰은 [이전 조사](WINDOWS_DESKTOP_CONNECTION_PATH.md)의 증거이며 현재 runtime을 새로 조회한 것이 아니다.

## 2. 공식 Codex 입력 경로

| 경로 | 확인한 기능 | 한계 |
| --- | --- | --- |
| Python SDK `ExternalMessage` | 대기 중인 thread에서는 turn을 시작하고, 실행 중인 일반 turn에는 합류. 수신 handle에서 결과 수집/이벤트 stream 가능 | 연결한 App Server의 thread에 대한 기능. 기본 SDK를 새로 띄워 원래 Desktop과 자동 공유한다는 보장은 아님 |
| App Server `turn/start`의 `toolOutput` | 앞선 tool call 없이 외부 tool 출력을 입력. 일반 turn이 active이면 해당 turn으로 queue | user input과 tool output을 같은 요청에 혼합하지 않음. 외부 내용이 사용자 승인/상위 지시가 되지 않음 |
| `codex queue` | 기존 ID에 텍스트 메시지를 enqueue. 공유 로컬 서버 또는 명시 remote endpoint 사용 | 출력은 queued submission 접수 확인이며 최종 답변이 아님. 이 명령만으로 메신저 왕복이 완성되지 않음 |
| `turn/steer` | 실행 중인 turn에 사용자 입력 추가 | active turn ID 대조 필요. 사용자 입력용과 비신뢰 외부 event를 구분해야 함 |

근거: [SDK API 309–356](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/sdk/python/docs/api-reference.md#L309-L356), [App Server turn·tool output](https://learn.chatgpt.com/docs/app-server), [공식 queue 명령](https://learn.chatgpt.com/docs/developer-commands#codex-queue).

SDK 문서는 ExternalMessage를 tool-level 권한의 비신뢰 입력으로 설명하며 사용자 승인이나 권한 부여가 아니라고 명시한다. 문서상 최소 CLI는0.151.0이다. 이번0.165 source에 문서가 존재하지만 Python SDK 설치/호환·실제 메시지 왕복은 시험하지 않았다. [SDK FAQ 40–68](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/sdk/python/docs/faq.md#L40-L68)

## 3. queue와 Desktop 접속을 구분할 근거

- [queue_cmd.rs 29–62](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/cli/src/queue_cmd.rs#L29-L62)는 endpoint를 결정하고 TUI session queue 경로를 호출한다.
- [session_queue_commands.rs 27–80](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/tui/src/session_queue_commands.rs#L27-L80)는 공유 서버를 발견해야 별도 서버를 통한 쓰기를 피한다고 설명하며 local queue의 no-daemon 경로를 거부한다. embedded 경로 충돌/미지원 서버도 오류로 처리한다.
- 같은 파일84–127은 `thread/queue/add`에 thread ID·입력·client message ID를 전송한다. 실제 응답은 queued submission ID다.
- [session_archive_commands.rs 253–294](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/tui/src/session_archive_commands.rs#L253-L294)는 명시 remote면 그 서버에 연결하고, 그렇지 않으면 조건에 따라 local daemon 탐색/launch 경로를 고른다.

따라서 **queue가 source에 존재한다는 이유로 현재 Desktop stdio를 대상으로 바로 실행하면 안 된다.** 별도 서버/daemon을 시작할 수 있는 경로를 이 조사에서 호출하지 않았다. Desktop가 같은 공유 서버를 사용하는지·공식 외부 endpoint가 있는지는 별도 조건이다. queue를 모델 없는 상태 조회 명령으로 취급하지 않는다.

## 4. Claude Channels와 비교

Claude Channels는 MCP 기반 event를 이미 열린 Claude Code 세션에 보내고 channel의 reply tool로 응답을 전달하는 공식 연구 미리보기다. 지원 plugin·사용자 opt-in·조직 allowlist/권한 조건이 있다. 일반 MCP 연결만으로 활성화되는 기능이 아니다. [공식 Channels 문서](https://code.claude.com/docs/en/channels)

Claude도 세션이 떠 있어야 수신하고 승인 대기에 멈출 수 있다. ‘Channels이므로 동시성/권한/중복 문제가 없어짐’으로 일반화하지 않는다.

| 비교 | Claude Channels | Codex의 유사 구조 |
| --- | --- | --- |
| 외부 event 입력 | channel MCP push | SDK ExternalMessage/App Server toolOutput, 또는 검증된 사용자 메시지 queue |
| 맥락 | 채널을 활성화한 세션의 맥락 | 접근 가능한 같은 App Server의 같은 thread 맥락 |
| 응답 전달 | channel reply tool | SDK 결과/이벤트를 이어온 연결부가 수집해 허용된 외부 앱에 전달하도록 구현 |
| 준비된 plugin | 공식 미리보기 plugin 제공 | 이번에는 동일한 메신저 plugin 패키지의 존재까지 확인한 것이 아님. 입력/queue API와 연결부 설계 가능성을 확인 |
| 승인/권한 | channel opt-in·sender allowlist·조직/도구 승인 | 이어온 앱/이용자 소유권·발신자 검증·기존 sandbox/승인 유지 필요 |

이 비교는 Claude로 Provider를 변경하자는 제안이 아니다. 대상은 계속 Codex다.

## 5. 이어온의 화면과 실행 구조에 주는 영향

개념 후보는 **메신저/외부 앱 ↔ 이어온 연결부 ↔ 공유 Codex App Server ↔ 같은 열린 thread**다. 사람의 공식 CLI/TUI 화면 또는 이어온 웹도 그 같은 서버를 사용한다. 서로 다른 실행기가 같은 저장 파일의 writer를 따로 잡는 방식을 기본으로 삼지 않는다.

공식 문서는 TUI와 queue에 `--remote` 접속을 안내한다. 따라서 **공식 CLI/TUI를 같은 공유 App Server의 사용자 화면으로 쓰는 안**도 검토 후보에 추가한다. 이것은 기존 Windows Codex Desktop 창과 다른 화면이다. 실제 화면 동기화/재시작/권한/응답 라우팅 성공은 미검증이다. raw App Server listener를 인터넷에 공개하는 안은 채택하지 않는다.

이어온이 직접 새 App Server를 띄우는 것은 한 방법이다. **기존에 공식 접속 가능한 공유 App Server가 있다면 그 서버를 사용하는 안도 원리상 후보**다. ‘직접 새로 띄우는 방법만 가능’이라고 좁히지 않는다. 그러나 원래 PC의 기록/작업 폴더·같은 runtime 접근 조건은 그대로이며, Oracle의 새 thread를 원래 thread로 바꾸어 부르지 않는다.

기존 요청의 ‘작업 중 끼워넣지 않음·사용 중이면 차단’은 이번 비교만으로 변경되지 않는다. 기술적으로 active turn 합류가 가능하다는 설명과 제품에서 허용하는 정책을 구분한다. 이를 채택하려면 메시지 대기/병합/거부·중복/unknown·발신자 권한/답변 라우팅을 방향 결정 후 명시해야 한다.

## 6. 미실행과 다음 경계

- 명령·SDK·MCP event·메신저 발송·기존 대화 조회/메시지·socket/daemon·새 로그인·모델·설정 변경 모두0.
- 현재 Desktop의 외부 attach·원래 thread에서의 양방향 실제 성공은 미확인이다.
- 이 기능 발견이 구독 인증의 호스팅 제한이나 private 앱 SIWC 자격을 바꾸지 않는다. [인증·호스팅 검토](../design/MANAGED_APP_SERVER_OPTIONS_REVIEW.md)를 유지한다.
- 현재 앱에 제공된 다른 thread 메시지 송신 도구도 실제 실행하지 않았다. 앱 내부 권한의 도구와 외부 이어온 프로그램의 공개 client 접속 계약은 별개다.
- 방향 결정 전에는 비교 문서만 보완한다. 실제 메시지/모델 검증은 대상·접속 경로·허용 turn/비용을 정한 뒤 승인 범위에서만 수행한다.
