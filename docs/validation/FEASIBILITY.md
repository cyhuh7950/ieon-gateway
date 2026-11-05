# S0 — 현재 개발 대화의 읽기 전용 연결 가능성 조사

- 일시: 2026-10-29 KST / 담당: 어울
- 판정: **현재 로컬 제어 경로 연결 불가. 실제 thread ID 대조·사용 중 상태는 UNVERIFIED. S0 전체 PASS 및 이어쓰기 가능 판정 아님.**
- 승인: 현재 이어온 개발 채팅의 ID·사용 중 상태만 관찰. 본문 조회·질문 전송·설정 변경 없음. 이 채팅의 실제 이어쓰기 대상 채택은 별도 결정.
- 관찰 입력 ID: `01a185d0-e8fd-7812-80d1-ba8ff1d470e9`. 사용자 승인으로 지정한 값이며 runtime에서 조회 성공한 ID로 표현하지 않는다.

최신 경로 결정: 현재 Desktop Remote Control은 비활성화라는 신산님 확인을 기록했다. 외부 앱용 공개 client 등록·인증·접속 계약을 확인하지 못해 Remote Control은 보류하고 [별도 App Server 대안의 계약 검토](REMOTE_CONTROL_PUBLIC_CLIENT_AND_STANDALONE.md)로 전환한다. 원래 thread 요구는 유지하고 기동/로그인/실제 재개는 하지 않는다.

두 조건 판정: 공식 같은 계정 새 로그인과 기존 인증 복사는 구분한다. 동일 physical CODEX_HOME의 기록/lock root와 process ephemeral 인증으로 원래 thread를 resume하는 source 경로, OS 단일 writer의 두 번째 소유자 충돌 거부를 확인했다. writer 반납 후 fresh resume 교대는 조건부 가능하지만 단순 질문 교대/실제 Windows·선택 대화의 성공은 미검증이다. [지정 대상·P0/P1·원본 영향/복구 제안](AUTH_RESUME_AND_ALTERNATION_ASSESSMENT.md)을 먼저 검토하며 실행은 하지 않았다.

추가 조사: [현재 Windows Desktop의 공식 연결 경로](WINDOWS_DESKTOP_CONNECTION_PATH.md). 설치 공급 코드에서 Windows의 로컬 연결은 child stdio이고 shared daemon socket 분기는 Windows를 제외함을 확인했다. 별도 서버의 저장 파일 접근은 같은 runtime 연결 증거가 아니다. 외부 client가 현재 Desktop runtime에 붙는 공개 지원 경로는 미확인이다. 이 추가 조사는 기능 구현·실제 이어쓰기를 포함하지 않는다.

전송 계약 최신 판정: 공식 tag rust-v0.165.0-alpha.1.2의 commit 720fec862a608ae1e5878d1eecb04fb93192e93c에서 proxy는 raw byte relay이며 JSONL↔WebSocket 변환이 없음을 확인했다. control socket은 WebSocket handshake를 요구하므로 기존 조사 코드의 JSONL 직결은 이 경로에 부적합하다. 현재 Desktop runtime 외부 attach는 별도로 미확인이고, 이전10061은 handshake 전 실패다. 소켓 재시도·daemon 기동 없이 공식 소스만 확인했으며 상세는 연결 경로 보고서 7절이다.

stdio 경로 추가 판정: 같은 commit에서 stdio transport의 추가 local listener/직접 attach는 찾지 못했지만, 동일 프로세스·동일 event queue의 조건부 Remote Control 입력 경로는 확인했다. 별도 daemon만의 기능으로 한정하지 않는다. 현재 Desktop의 활성 상태와 이어온용 공식 client 등록·인증·endpoint는 미확인이고 실제 설정/RPC/소켓 조회는 하지 않았다. 상세는 연결 경로 보고서 8절이다.

## 확인한 환경·실제 접속

| 항목 | 증거·판정 |
| --- | --- |
| Windows 앱 / 동봉 엔진 | 26.1023.6123.0 / 0.165.0-alpha.1.2. npm CLI 0.161.0은 사용하지 않음 |
| 공식 후보 | 동봉 엔진 도움말의 `app-server proxy --sock <기존 socket>`; 새 서버 기동 없이 실행 중 control socket으로 stdio 연결하는 명령 |
| socket 엔트리 | `C:\Users\cyhuh\.codex\app-server-control\app-server-control.sock` 존재, 마지막 수정 2026-10-08T16:21:03Z. 존재 자체는 수신 서버 생존 증거가 아님 |
| 첫 실제 관찰 시도 | 2026-10-29T05:32:28Z. initialize 응답 전 proxy 종료, `transport_error`; `initialized=false`, `targetLoaded=null`, `status=unknown` |
| 원인 분류용 별도 진단 | RPC 없이 같은 proxy 연결만 수행: exit 1, OS error 10061(connection refused), stdout 0. 오류 원문 미저장/미출력 |
| 기존 daemon 기록 | 기록된 PID 21016은 생존하지 않음. 기록 파일 삭제·수정·daemon 시작 없음 |
| 현재 엔진 | PID 21356은 app-server 명령으로 실행 중이며 `--listen` 플래그 없음. PID 34344도 유지. 명령행 원문은 출력/저장하지 않음 |
| 해석 | 문서상 명시 listen 없는 app-server 기본은 stdio. 현재 앱이 다른 엔진을 실행 중인 사실과 오래된 control socket의 연결 거부는 확인했다. 이 socket이 현재 Desktop 소유 runtime의 공유 endpoint라고 입증하지 못함. 다른 공식 연결 경로가 전혀 없다고 단정하지 않음 |
| 변화 | 기존 두 엔진 PID 유지. 이 조사가 띄운 proxy child만 종료. 기존 앱/daemon 재시작, 포트, 인증, 설정, 원래 대화 변경 없음 |

첫 시도의 `rpcRequests=1`은 proxy stdin에 initialize를 쓰려고 한 횟수이며 서버 수락/처리 횟수가 아니다. initialize 응답·thread/loaded/list 전송은 0회다. 원인 진단은 RPC 0회다. 연결 실패 뒤 동일 RPC 자동 재전송은 없었다.

원본 증거: [조회 receipt](s0-read-only-receipt.json), [환경·schema SHA-256](s0-environment-evidence.json). schema는 해당 동봉 엔진으로 생성했고 원문 사용자 기록은 읽지 않았다. 버전 fingerprint만 보존하며 생성 파일은 임시자원으로 정리한다.

## 이번 제한에 맞춰 제외한 조회

설치 버전 `thread/read`의 반환 Thread에는 `preview`가 있고 설명은 첫 사용자 메시지다. `includeTurns=false`는 이력 전체만 제외할 뿐 preview를 제거하지 않는다. 이번 직접 지시에 맞춰 thread/read·thread/list·turns/items 조회를 실행하지 않았다.

조사 스크립트의 송신 경로는 initialize → initialized → thread/loaded/list로 고정했다. 이 목록은 본문 없는 ID 조회다. 다른 알림은 설치 schema에서 가능한 이름을 찾아 연결별 opt-out하고, 수동 유발 없는 target status 알림만 허용했다. 알림 미수신·연결 불가는 idle로 추정하지 않고 unknown이다. 이번에는 initialize에 도달하지 못해 알림도 받지 못했다.

로그·receipt에는 target ID·상태·성공 여부·안전한 횟수/오류 분류만 남겼다. 원문 stderr, 명령행 전체, 인증 파일, config 내용, 대화 preview/본문, 원본 이벤트 로그는 저장하지 않았다. 별도 모델 turn 0회, thread 재개/생성/수정 0회, 본문 RPC 0회, 설정/로그인 RPC 0회, 유료 API 호출 0회다. 조사를 수행하는 현재 개발 채팅 자체의 평상시 사용량을 0이라고 의미하는 수치는 아니다.

## 사용 중 관찰과 실행 배타 제어

| 검증 대상 | 이번 결과 | 차단 책임·다음 증거 |
| --- | --- | --- |
| 현재 개발 thread ID가 원래 runtime에 있음 | UNVERIFIED | 기존 runtime의 본문 없는 ID 조회 성공 필요 |
| 현재 Desktop active 상태 관찰 | UNVERIFIED | 같은 runtime의 상태만 조회. 이 채팅에서 답변 작성 중이라는 사실은 adapter 관찰 성공의 대체 증거가 아님 |
| Desktop active → 이어온 거부 | NOT_RUN | connector의 거부 + 상태 확인과 실행 사이 경합 차단. S0에서는 실행 요청 없음 |
| 이어온 active → Desktop 거부 | NOT_RUN | 이어온 내부 잠금으로 Desktop은 막지 못함. 공유 runtime/공식 클라이언트의 거부 계약·증거 필요 |
| 거의 동시 시작 → 한 실행만 수락 | NOT_RUN | 두 클라이언트를 포괄하는 원자 수락·배타 제어 필요. 사후 상태 확인은 차단 아님 |
| 실제 D→I→D 맥락·원래 대화 보존 | NOT_RUN | S0 결과 후 대상·호출수·모델·예산·중단 조건 별도 승인 |

중요 발견: 설치 `TurnStartParams`의 parentTurnId/rootTurnId/turnTrigger 설명은 활성 turn에 입력 추가/steer될 수 있음을 명시한다. `turn/start`가 busy를 자동 거부한다고 가정할 수 없으며 schema에는 expected-idle/fencing 같은 원자 수락 조건이 확인되지 않았다. 실제 의미는 모델 없는 공식 계약 검토와 후속 승인 시험으로 확인해야 한다. 지금은 호출하지 않는다.

## 설정 보존과 갑작스러운 종료

- 이번 조사는 설정 내용을 직접 조회하거나 적용·복원하지 않았다. 따라서 원상 복구 성공이나 급종료 안전을 PASS로 표시하지 않는다.
- 공식 문서와 설치 schema에서 sandboxPolicy·cwd·model·effort 등의 turn override가 이후 기본값에도 남음을 확인했다. prompt로 쓰기 금지 문장을 넣는 것은 도구 실행 권한 강제의 대체가 아니다.
- 연결별/일회성 제한이 원래 thread를 바꾸지 않는 공식 경로인지 우선 확인한다. 현재 승인 범위에서는 이를 적용하지 않는다.
- 변경이 불가피하면 적용 전 내구 복구 기록, 원래 값/적용값/현재값/revision, 공식 원자 compare-and-set 또는 동등 배타 조건이 필요하다. 중간 사용자 변경·revision 불명·복원 경합이면 덮어쓰지 않고 restore_conflict와 실행 차단을 유지한다. 값 비교만으로 ABA(같은 값으로 돌아온 변경)나 read/write 경합을 해결했다고 주장하지 않는다.
- 적용 전/적용 후 기록 전/실행 중/복원 전/복원 후 기록 전의 connector 종료 및 사용자 중간 변경 시험은 NOT_RUN이다. unknown 요청은 복구 과정에서도 재전송하지 않는다.

## 수행한 코드 검증과 한계

`node --test tests/pilot/inspect.test.mjs`: 7개 통과. 미구현 모듈 import 실패를 먼저 확인한 뒤 구현했다. 본문 RPC 없는 송신 순서·알림 억제·대상만 투영·오류/timeout의 원문 미출력·무재시도·예상 밖 응답에서 추가 조회 금지를 확인했다. 조사 모듈 두 개의 `node --check` 통과. 최종 검토에서 발견한 상태 알림 후 단절 시 오래된 idle/active 유지 문제는 회귀 검사 실패를 먼저 확인한 뒤 unknown 무효화로 수정했다. timeout·transport 오류·RPC 오류의 6가지 조합을 모델 없이 확인했으며 실제 접속은 반복하지 않았다.

이 결과는 모델 없는 스크립트 안전 검사다. 기존 Desktop 연결·active 감지·원자 차단·실제 이어쓰기·설정 복원은 통과하지 않았다. 제품 API·DB·웹 화면·connector daemon·실행 adapter 전체는 구현하지 않았다.

## 다음 단계와 권장안

현재 상태에서는 기존 개발 thread를 실제 모델 실증 대상으로 사용하지 않는다. 같은 runtime에 붙을 공식 경로와 본문 없는 상태 관찰, 양방향 원자 차단, 설정을 바꾸지 않는 제한 또는 충돌 안전 복원이 먼저 필요하다.

권장 순서는 **공식 Desktop/daemon 공유 제어 지원과 필요한 실행 전환 조건을 먼저 확정**하는 것이다. 기존 앱 재시작·daemon 전환·새 listen·인증/보안 변경이 필요하면 정확한 대상·영향·복구안을 제시하고 별도 승인받는다. 이번 S0에서 이를 실행하지 않는다. 새 독립 App Server나 다른 thread로 바꾼 성공은 현재 Desktop 연결 증거로 인정하지 않는다. 공식 공유 경로를 확보하지 못하면 해당 제약을 그대로 보고하고 후속 범위를 결정한다.

공식 근거: [App Server](https://learn.chatgpt.com/docs/app-server) (초기화·읽기 조회·상태·연결별 알림 억제·turn override), [Developer commands](https://learn.chatgpt.com/docs/developer-commands) (stdio·로컬 listen 경로). 최신 문서와 설치 schema의 차이는 설치 버전의 실제 결과를 우선해 명시했다.
