# 별도 App Server — 공식 로그인·원래 thread 재개와 교대 사용 판정

- 기준: 2026-10-29 / 공식 tag rust-v0.165.0-alpha.1.2, commit720fec862a608ae1e5878d1eecb04fb93192e93c.
- 현재 수행: 공개 문서·정확한 버전 source 정적 대조와 승인된 제목/ID/상태 metadata 대조(8절). 로그인·서버 기동·대화 본문 조회/재개·모델 호출·검증 프로그램 구현 없음.
- Remote Control 보류는 유지한다. 별도 프로세스의 원래 저장 thread 재개를 검토하는 것이며 Desktop 소유 runtime attach 성공과 구분한다.

## 1. 두 조건의 판정

| 조건 | 판정 | 실제로 남은 확인 |
| --- | --- | --- |
| ① 공식 인증으로 같은 계정에 새로 로그인하고 원래 thread를 재개 | **조건부 가능: 공식 로그인·동일 ID resume·인증 메모리 격리 경로를 source에서 확인** | 선택 thread·같은 계정/workspace·허용 모델/정책·저장 경로·기존 인증 미사용/미변경의 실제 확인은 NOT_RUN |
| ②-A Desktop과 별도 App Server가 같은 thread를 동시에 소유/실행 | **동시 writer는 허용하지 않음. 동일 lock 경로의 두 번째 소유자는 충돌 거부하도록 구현됨** | 현재 Windows/해당 thread에서 실제 양방향 거부·UI 처리 시험은 NOT_RUN |
| ②-B 두 runtime에 같은 thread를 계속 로드한 채 질문만 번갈아 전송 | **보장하지 못함** | turn 완료/idle은 writer 반납이 아님. 로드된 메모리 상태 재사용과 잠금 때문에 단순 교대는 충분하지 않음 |
| ②-C writer 정상 반납 → 다른 쪽의 fresh resume로 교대 | **조건부 가능: 단일 소유권·잠금 후 최신 history 재로딩 경로를 source에서 확인** | Desktop에서의 안전한 unload/정상 종료·재열기, 양방향 맥락 반영·원본/설정 보존은 실제 실증 필요 |

여기서 가능은 지원되는 코드 경로가 있다는 뜻이다. 해당 대상에서 동작·구현·인수가 완료됐다는 판정이 아니다.

## 2. 공식 같은 계정 로그인은 인증 정보 복사와 다르다

사용자가 공식 브라우저 OAuth에서 기존과 같은 계정/workspace를 선택해 **새 인증을 발급받는 것**은 허용 가능한 검토 경로다. Desktop의 토큰·쿠키·auth.json·keyring 값을 읽어 다른 프로세스에 복사/주입하는 방식과 구분한다. 같은 계정 로그인만으로 기록이 내려오는 것은 아니며 원래 로컬 thread 저장소에 접근할 수 있어야 한다.

제안하는 조합은 **같은 실제 CODEX_HOME으로 원래 기록과 writer lock namespace를 유지하되, 별도 App Server의 인증 저장만 process-level ephemeral로 설정**하는 것이다. 새 로그인 결과는 해당 프로세스 메모리에만 두고 종료 시 없앤다. CODEX_HOME을 복제하거나 auth cache를 공유해 인증하지 않는다.

- [공식 인증 문서](https://learn.chatgpt.com/docs/auth): ChatGPT 공식 로그인, ephemeral credential storage.
- [storage.rs 564–603·621–633](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/login/src/auth/storage.rs#L564-L633): ephemeral 저장은 프로세스 static memory map이다.
- [manager.rs 1537–1601](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/login/src/auth/manager.rs#L1537-L1601): ephemeral 명시 시 persistent credential fallback 없이 None 반환. 단 상속 API/access-token 환경값은 우선될 수 있으므로 검증 child에서 제외해야 한다.
- [OAuth callback 828–872](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/login/src/server.rs#L828-L872)과 [account processor 615–625](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server/src/request_processors/account_processor.rs#L615-L625): 선택한 credential 저장 모드가 공식 로그인 저장 처리로 전달된다.

실행 전 effective ephemeral 옵션과 managed policy, child의 인증 환경 상속 배제, 기존 credential 파일/keyring을 읽거나 변경하지 않는 경계를 확인해야 한다. 검토한 저장 모듈의 보장이 앱의 모든 시작 부작용까지 없다는 뜻은 아니다. 실제 설정은 변경하지 않았다.

## 3. 원래 thread와 실행 충돌의 근거

- [thread resume 분기](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server/src/request_processors/thread_processor.rs#L3929-L4048): 기존 thread의 저장 history를 읽어 재개하는 경로가 있다. fork/새 대화를 만들 필요가 있는 API가 아니다. [공식 resume 문서](https://learn.chatgpt.com/docs/app-server).
- [이미 로드된 thread 분기](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server/src/request_processors/thread_processor.rs#L4624-L4692): 해당 프로세스에 이미 있는 runtime을 재사용한다. 따라서 새 인증만 하면 다른 프로세스의 메모리까지 갱신된다고 가정하지 않는다.
- [WriterLockCoordinator 33–86](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/rollout/src/writer_lock.rs#L33-L86): CODEX_HOME/thread-writer-locks/<thread-id>.lock에서 OS File.try_lock을 사용하고 두 번째 writer에는 WouldBlock을 반환한다.
- [LocalThreadStore 374–389](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/thread-store/src/local/mod.rs#L374-L389): WouldBlock을 thread store Conflict로 변환한다.
- [resume writer 75–131](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/thread-store/src/local/live_writer.rs#L75-L131): writer 소유권을 먼저 얻고 저장 revision을 대조해 최신 rollout history를 로드한다.
- [정상 shutdown 204–243](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/thread-store/src/local/live_writer.rs#L204-L243): recorder shutdown/저장 경로 동기화 후 live writer를 제거한다. SQLite projection 경고가 있어도 이력의 정확한 표시를 확인해야 하므로 단순 종료코드만으로 반영 PASS를 선언하지 않는다.

기술적 충돌 거부는 두 실행 주체가 같은 실제 CODEX_HOME과 thread ID·호환 writer 경로를 사용할 때의 source 근거다. 다른 CODEX_HOME에서 원래 rollout 경로만 지정하면 잠금 namespace가 달라질 수 있어 제안하지 않는다. 잠금파일을 수동 삭제하거나 다른 writer를 강제로 중단하지 않는다. 실제 Desktop 거부 동작과 거의 동시 시작의 Windows 시험은 미실행이다.

## 4. 허용 가능한 교대 조건

1. 대상 대화의 이전 turn·goal·승인·queued 입력/하위 작업이 끝났는지 확인한다. 하나라도 미확인/진행 중이면 전환하지 않는다.
2. 이전 writer를 정상 unload/shutdown하고 저장 완료·잠금 소유권 해제를 확인한다. 화면을 바꾸거나 질문을 보내지 않는 것만으로 해제됐다고 보지 않는다.
3. 다음 실행 주체가 같은 원래 ID로 fresh resume한다. 명확한 writer 충돌은 사용 중으로 거부하고, timeout/결과불명은 unknown으로 두며 자동 재전송하지 않는다.
4. 이어온 종료 후에도 writer를 정상 반납하고, Desktop이 새로 로드한 원래 대화에서 저장 이력과 맥락을 확인한다.

Desktop UI의 대화 닫기/전환이 실제 unload와 일치하는지는 미확인이다. 첫 실증에서 그 동작을 입증하지 못하면 **Desktop 정상 종료 → 독립 App Server → 독립 App Server 정상 종료 → Desktop 재실행**이라는 보수적인 단독 소유 조건으로 범위를 제한한다. 다른 Desktop 대화·도구·작업도 종료 영향을 받을 수 있으므로 모두 idle이며 신산님이 종료/재실행 영향을 승인한 경우에만 적용한다. 현재 개발 대화를 포함한 진행 작업을 임의 중단하지 않는다.

## 5. 실제 검증 제안 — 아직 실행 승인 아님

### 대상과 인증

- 사용자 지정: **어울 전용 작업 지시 세션** / `01a0dadd-739f-74d2-93c5-9c405cc1019b`.
- 현재 이어온 개발 thread는 계속 읽기 전용이며 실증 대상에서 제외한다.
- 최초 제안 시 실제 metadata는 미조회였다. 후속 승인 전 조사(8절)에서 앱 목록의 이름/ID/local/PMO/idle만 확인했다. 실제 loaded·writer 소유·goal·모델·저장형식은 미확인이다.
- SINSAN의 설치 엔진0.165.0-alpha.1.2를 별도 local stdio child로 사용한다. 새 daemon·Remote Control·App Server 수신 listener·Oracle는 없다.
- 공식 account/login/start의 ChatGPT browser flow에서 신산님이 같은 계정/workspace를 확인한다. 새 인증은 child 메모리에만 저장한다. localhost OAuth callback listener가 일시적으로 필요하며 실제 port 충돌을 시작 전에 확인한다. 기존 auth cache·OS keyring·토큰/쿠키를 읽어 복사하지 않는다. API 키/외부 bearer를 상속하지 않고 유료 API fallback도 없다.

### P0 — 우선 제안하는 무모델 단계

| 순서 | 동작 | 기대 결과 |
| --- | --- | --- |
| 준비 | 안전 백업·유효 설정·자동 목표/도구/MCP 시작 억제·동일 lock root·다른 Desktop 작업 idle·독립 검증 runner 수명을 확정 | 확인 불가이면 기동/인증 전에 중단. runner도 아직 미구현이다 |
| 인증 | 승인된 별도 child에서 공식 같은 계정 새 로그인 1회. 로그인 전에는 해당 child가 미인증임을 확인 | 기존 Desktop 인증 미사용. 결과는 boolean/안전 receipt만 기록 |
| Desktop 소유 | 대상이 Desktop에 로드됐고 idle임을 확인한 뒤 이어온 측 resume 1회 | writer Conflict·추가 turn 0. 예상 밖 성공/소유권 불명은 중단 |
| 인계 | 승인된 정상 unload 또는 Desktop 정상 종료 후 이어온 측 resume 1회 | 같은 원래 ID·저장 경로·writer 소유. 입력/turn 없음 |
| 반대 거부 | 이어온이 writer를 보유한 동안 Desktop에서 대상 열기만 시도 | 사용 중/충돌 처리. 질문은 보내지 않고 추가 turn 0 |
| 반환 | 이어온 writer·child 정상 종료 후 Desktop에서 원래 대화 새로 열기 | 같은 ID·기존 기록·로그인 유지. 단순 메모리 화면이 아닌 새 로드인지 확인 |

P0 예상: **모델 turn 0회**, 공식 로그인 시작1회, 이어온 측 명시 resume 최대2회. Desktop UI가 내부적으로 보내는 metadata RPC 수는 미확인이다. unknown 후 자동 재시도는 없고, 명확한 최초 Conflict 뒤 소유권을 반납한 다음의 두 번째 resume는 위 절차의 별도 승인된 단계다. Desktop 종료 중에도 동작할 독립 runner가 필요하며, 앱을 닫아도 agent 도구가 계속 실행된다고 가정하지 않는다.

P0는 현재 버전 source의 보호 장치가 실제 Windows/지정 대화에서 성립하는지 확인하는 단계다. 질문이 없으므로 의미적 맥락 반영까지 PASS로 선언하지 않는다. 거의 동시 시작 경합 시험은 P0에 포함하지 않고 미확인으로 남긴다.

### P1 — P0 결과 후 별도 승인할 실제 대화 단계

- 사용자 turn 최대 **3회: Desktop D1 → 이어온 I1 → Desktop D2**. 각 인계는 위 writer 반납/fresh resume 절차를 따른다.
- D1은 원래 대화의 비민감 과거 사실을 답하게 하여 기존 맥락을 확인하고 표식 A를 남긴다. I1은 A/과거 맥락을 확인하고 표식 B를 남긴다. D2는 B/과거 맥락을 확인한다. 기대 정답은 입력에 그대로 넣지 않는다.
- 대상의 실제 모델/effort/문구·정답 기준·구독 잔여 한도·도구 차단·원래 설정 보존을 P0 후 구체화한다. 현재 모델 이름을 추측하지 않는다. P1의 공식 새 로그인은 P0 child 종료 후 다시1회가 필요할 수 있다.
- 3회는 사용자 turn 상한이며 내부 inference/compaction/retry 요청 수·토큰을 뜻하지 않는다. 수집하지 못한 사용량/비용은 미확인이다. 구독 포함 사용만 허용하고 API·추가 크레딧 지출/자동 구매 0을 예산 조건으로 제안한다. 이 조건을 확인하지 못하면 P1은 시작하지 않는다.
- 모델이 도구/권한 변경을 요구하거나 자동 목표·추가 turn/compaction 비용 조건이 발생하면 자동 승인/추가 실행 없이 중단·보고한다. 읽기 전용 경계와 turn override의 원래 기본값 보존을 검증하지 못하면 P1은 BLOCKED다.

## 6. 원본 영향과 복구안

- **P0도 완전 무변경은 아니다.** 새 로그인은 새 인증 세션을 만들고, App Server 기동/재개는 로그·index/DB·writer lock 및 stale lock 관리에 영향을 줄 수 있다. 기존 질문·답변 추가는 예상0이지만 실제 변경을 비교한다. 숨은 자동 복구/목표/도구 실행이 억제된다는 확인이 선행한다.
- P1은 원래 대화에 승인된 시험 질문/답변3turn을 추가한다. 같은 ID의 실제 이어쓰기이며 새 대화/복제본을 원본 성공으로 사용하지 않는다.
- 첫 live 기동 전에 모든 writer가 멈춘 상태에서 **대상 thread 데이터와 관련 index의 안전 백업·복원 경계**를 확정한다. 원래 auth.json/keyring/토큰/쿠키는 백업/복사 대상에서 제외한다. 상태 DB 전체를 무검토 복사하지 않고 credential/enrollment 정보 포함 여부와 대상 thread 복원 범위를 먼저 확인한다. 안전한 범위를 확정하지 못하면 P0를 시작하지 않는다. 백업은 복구용이며 다른 대화/성공 대체본으로 사용하지 않는다.
- 임시 인증 옵션은 child에만 적용하고 기존 config 파일·Desktop 로그인·원래 thread의 모델/권한 기본값은 바꾸지 않는다. 실제 도구 억제에 원래 기본값 변경이 필요하면 적용하지 않고 별도 영향/복구안을 먼저 제시한다.
- 정상 종료로 writer·OAuth callback·child를 종료하고 임시 메모리 인증/검증 자원을 정리한다. 원래 Desktop 로그인은 로그아웃하거나 덮어쓰지 않는다. child 종료가 계정 서버 측 새 로그인 세션/승인까지 철회한다는 뜻은 아니며, 전체 계정 로그아웃/기존 토큰 회수는 하지 않는다.
- 실패/timeout/연결 단절은 unknown으로 보존하며 모델 재전송·새 thread 대체·수동 lock 삭제·다른 작업 kill 없음. 새 인증/metadata 오류와 실제 turn 상태를 분리한다.
- 원본 손상 의심 시 모든 해당 writer를 안전 정지하고 현재 상태를 보존한 뒤 백업과 대조한다. 그사이 사용자 변경이 있으면 덮어쓰지 않는다. 데이터 복원은 대상/차이/손실 가능성을 제시하고 별도 확인 후 실행한다.
- 승인된 P1 시험 turn도 기본은 이력으로 남긴다. 자동 삭제/revert로 원본을 재작성하지 않는다. 신산님이 제거/복원을 원할 때 그때의 변경분과 범위를 확인한다.

## 7. 현재 승인·완료 상태

이번에 완료한 것은 두 조건의 **문서/source 판정과 검증 제안서**, 후속 승인된 제목/ID/상태 metadata 확인이다. 실제 로그인·선택 thread 본문/재개·writer 충돌·Desktop 종료/재열기·양방향 의미 반영은 NOT_RUN이다. 모델 없는 준비/실증과 실제3turn을 각각 구분해 승인받기 전에는 시작하지 않는다. 구현 완료·실제 연결 성공·사용자 인수로 처리하지 않는다.

[정제 source/대상/판정 증거](s0-auth-resume-handoff-evidence.json). 별도 App Server의 hosted/commercial 인증 허용 범위는 기존 검토와 별도이며 이번 제안은 신산님 자신의 SINSAN PC local prototype에 한정한다.

## 8. P0 승인 전 신원·단독 unload·전체 종료 영향 확인

2026-10-29 15:56 KST 기록. 신산님은 실행 전에 대상의 실제 제목/ID 확인과 안전한 인계 조건 보고만 요청했다. 로그인/P0는 그 결과를 본 뒤 승인하며 P1 질문 전송은 승인하지 않았다. [정제 조사 증거](s0-p0-preflight-evidence.json).

### 확인한 대상과 확인하지 않은 상태

| 항목 | 조회 결과와 의미 |
| --- | --- |
| ID | `01a0dadd-739f-74d2-93c5-9c405cc1019b` 정확히 일치 |
| 실제 제목 | **어울 전용 작업 지시 세션** 정확히 일치 |
| 앱 metadata | `kind=codex`, `hostId=local`, `cwd=D:\Project\PMO`, `status=idle` |
| 증거 범위 | Codex 앱 `list_threads`의 목록 metadata. target 본문/turn/preview는 사용하지 않고 결과의 summary 필드는 출력·저장하지 않았다 |
| 아직 미확인 | 현재 Desktop App Server의 loaded 여부, OS writer 소유, queued/승인/goal·하위 작업, 실제 저장 파일·모델. `idle`을 이 항목들의 확인으로 바꾸지 않는다 |

이 대상은 PMO 프로젝트에 연결된 기존 대화다. 격리된 시험용 대화로 단정하지 않으며 제목만으로 원본 영향이 작다고 판단하지 않는다. 목록 조회는 Desktop runtime 외부 attach나 실제 resume 성공의 증거가 아니다.

### 그 대화만 안전하게 내려놓을 수 있는가

**즉시 수동으로 특정 대화만 unload하는 공개 Desktop UI 경로는 확인하지 못했다. 불가능으로 확정한 것은 아니다.**

- [공식 App Server 문서](https://learn.chatgpt.com/docs/app-server)는 `thread/unsubscribe`가 **요청한 연결 자신**의 구독을 제거한다고 설명한다. [정확한 버전 구현 1079–1104](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server/src/request_processors/thread_processor.rs#L1079-L1104)도 connection ID를 전달한다. 별도 App Server 연결에서 요청한다고 Desktop 연결의 구독/잠금이 해제되지 않는다. 요청은 보내지 않았다.
- 설치본의 공급 JS에는 자동 inactive unsubscriber가 있다. 활성 화면/stream follower/진행 상태 등으로 보존이 필요한 대화를 제외하고, 비활성 TTL `108e5`ms(3시간) 또는 비활성 owner 수 상한10을 넘는 조건에서 `thread/unsubscribe`를 보낸다. 파일 SHA256와 문자 offset은 receipt에 기록했다. 이는 설치 코드의 조건이며 대상에서 실제 타이머·분기·구독 해제가 실행됐다는 증거가 아니다. 내부 함수를 외부 API처럼 호출하지 않는다.
- App Server는 구독자 없음과 비활성의 두 조건 뒤 설정된 유예 시간을 거쳐 unload한다. [정확한 lifecycle 58–88·241–244](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server/src/request_processors/thread_lifecycle.rs#L58-L88). 현재 공개 문서는30분을 안내하지만 이 Desktop의 유효 `thread_unload_delay`는 읽지 않았으므로 3시간30분 뒤 인계를 보장하지 않는다.
- [Desktop 명령 문서](https://learn.chatgpt.com/docs/app/commands)의 탭/창 닫기는 writer 해제를 보장하지 않는다. 대화 전환·탭 닫기·idle·예상 시간 경과를 인계 성공으로 처리하지 않는다. 대상의 `notLoaded`/`thread/closed`와 실제 배타 소유권 확인이 필요하나 이번에는 실행하지 않았다.
- archive는 저장 이력 위치/조회 상태와 하위 대화를 바꿀 수 있으므로 단순 unload 대체로 제안하지 않는다. 삭제·강제 종료·잠금파일 삭제·내부 protocol 호출도 하지 않는다.

따라서 **앱 전체 종료가 반드시 필요한지는 미확인**이다. 대상이 이미 unloaded라면 종료 없이 원래 thread 인계를 검토할 수 있지만 현재 목록 metadata만으로 판단할 수 없다. 즉시 인계를 위해 정상 전체 종료를 택하는 안은 별도 영향 승인을 전제로 하는 보수적 대안이다.

### 전체 종료를 택할 때 다른 작업에 미치는 영향

조회 목록(비고정 최근50개와 고정 항목, 총51항목)의 snapshot에서 현재 이어온 조사 외에 다음 **최소4개**가 `active`였다. 전체 대화/실행 주체의 완전한 inventory가 아니며 이후 상태는 바뀔 수 있다.

| 실제 제목 | 목록 상태 |
| --- | --- |
| Now 작업 - 서버담당 | active |
| CGA 기반 신규 설계 진행 | active |
| Now 작업 - 전체 기준표, 버전, 릴리즈 검증 담당 | active |
| Active - Anvil C-09 복구 책임자 | active |

현재 프로세스 metadata는 Desktop PID19212의 App Server PID21356, 별도 exec-server PID34344를 확인했다. App Server의 `--listen`/proxy/daemon은 없었다. 새 프로세스는 시작하지 않았다.

- 전체 Desktop 종료는 해당 앱의 다른 대화 실행·승인 대기·도구/terminal 연결과 **현재 조사 대화**에도 영향을 줄 수 있다. 실행 중 작업의 중단, 외부 명령의 잔류, 저장 전 입력 손실과 완료 상태 불명이 가능하다. 다른 작업이 안전하다고 현재 목록만으로 보장하지 않는다.
- 다른 담당자의 작업을 임의 중단하거나 메시지를 보내지 않는다. 전체 종료 직전에는 각 진행 작업의 정상 완료/안전 checkpoint, 미저장 입력·파일, 남은 외부 명령과 재개 지점을 담당자가 확인해야 한다. Git에 이미 저장된 소스는 앱 종료로 없어지는 것은 아니지만 dirty 파일이 저장됐는지 이번 조사에서 확인하지 않았다.
- 앱 종료를 포함하는 P0는 이 대화와 독립된 runner 및 영속 receipt가 필요하다. 이 agent나 도구가 앱 종료 후 계속 실행된다고 가정하지 않는다. 앱 재실행이 중단된 모든 모델/도구를 정확히 복원하는 것도 보장하지 않는다. unknown 상태의 자동 재실행은 금지한다.
- 위 active 작업과 현재 조사 turn이 진행 중인 지금은 종료하지 않는다. 정상 종료가 실패해도 강제 kill로 진행하지 않고 현재 상태와 대안을 보고한다.

### 제안하는 백업·복구 범위와 실행 전 조건

아래는 **범위 제안**이며 실제 파일/DB 조회·복사·복구는 수행하지 않았다. metadata에는 실제 rollout 위치와 history mode가 없으므로 파일 경로·수량·checksum을 추측해 확정하지 않는다.

| 구분 | 포함/제외와 복구 한계 |
| --- | --- |
| 대상 원본 데이터 | 해당 ID의 원래 history 저장 파일/필요 shard·revision과 대상에 종속된 첨부/참조. 실제 저장 형식과 관련 파일을 확인한 후 정확한 경로·크기·checksum manifest를 확정한다. 백업 원문은 private Git/일반 로그에도 넣지 않고 승인된 로컬 보호 위치에 둔다 |
| 대상 metadata | 이름/원래 ID/실제 rollout 경로/설정·소유 관계, 해당 thread의 index 행·dynamic tool 정의·첨부 연관 등 실제 schema와 참조 관계로 필요한 항목만 지정한다. tool 정의 보존은 tool 실행 허용이 아니다. 원문을 포함하는 필드는 민감 데이터로 취급한다 |
| 공유 DB와 인증 | DB 전체·CODEX_HOME 전체의 무검토 복사/복원은 제외한다. [공식 state schema](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/state/migrations/0024_remote_control_enrollments.sql#L1-L10)에는 계정/환경 enrollment metadata도 있어 대상 이력과 무관한 상태가 섞인다. 이 표만으로 토큰 원문 저장을 단정하지 않는다. auth.json·keyring·토큰·쿠키·브라우저 프로필·API 키는 읽기/복사 대상에서 제외한다 |
| 다른 작업 | 대상 백업은 다른 대화·프로젝트·외부 서비스의 복원본이 아니다. 각 담당자의 기존 Git checkpoint와 미저장 자료 보존을 별도로 확인한다. 다른 대화의 전체 원문을 백업하기 위한 포괄 승인을 가정하지 않는다 |
| 일관성 | 실행 writer가 있는 DB/원본 파일과 WAL을 제각각 복사하지 않는다. 모든 관련 writer가 정상 반납한 안전 시점 또는 검증된 일관 snapshot 방식이 필요하다. 대상만으로 완전한 복구가 불가능한 형식이면 그 의존성과 확대 범위를 보고한 뒤 결정한다 |
| 복구 | 손상 시 현재 변경을 먼저 별도 보존하고 manifest/최신 revision과 대조한다. 관련 writer가 멈춘 상태에서 해당 ID의 확인된 데이터만 복구하며 DB 전량 되감기·다른 대화 덮어쓰기·인증/설정 되돌리기는 하지 않는다. 백업 이후 사용자 변경은 자동으로 지우지 않는다. 정확한 복구 diff/손실과 별도 승인이 선행한다 |
| 복구 불가능한 항목 | 메모리의 실행 위치·진행 중 외부 작업·OS 잠금·새 OAuth 서버 세션·저장되지 않은 UI 입력은 대상 이력 백업으로 복원되지 않는다. 잠금파일은 백업/복사로 소유권을 복원하지 않는다 |

P0 실행 전 확인할 조건은 ① 대상의 실제 저장형식/일관 백업 manifest와 복구 경계, ② 단독 unload를 실제 관찰할 수 있는 경로 또는 모든 진행 작업의 완료 후 정상 전체 종료 영향 승인, ③ 모델/자동 목표/도구 시작 억제와 원래 설정 보존, ④ Desktop과 독립 runner 및 ephemeral 공식 로그인 조건이다. 대상 본문이 필요한 백업 준비도 지금의 제목/상태 확인 범위를 넘겨 자동 시작하지 않는다.

권장안은 **지금 다른 작업을 종료하지 않고, 이 확인 결과와 미확인 조건을 먼저 검토한 뒤 실행 창과 P0 범위를 정하는 것**이다. 대상 제목 확인은 완료했지만 안전한 단독 unload·백업·인계 성공은 미확인이므로 P0 준비 완료로 보고하지 않는다. 로그인/P0 승인 전 기동·재개를 하지 않으며 P1 질문은 별도 승인 전 계속0회다.

## 9. 앱 유지 P0 승인 후 실제 잠금 사전 검사 결과

2026-10-29 16:20 KST. 후속 직접 지시로 앱 전체 종료 없이 P0, P0 통과 시 단순 대화 최대3turn P1이 승인됐다. 로그인은 신산님 직접 수행이며 충돌 시 강제 해제/재시도 없이 중단한다. 이 승인은 위 과거 미승인/대기 기록을 해당 범위에서 갱신한다.

- 실제 검사: 기존 대상 lock 파일을 쓰기 권한 없이 열고 비차단 공유 OS 잠금을1회 요청했다. **Windows ERROR_LOCK_VIOLATION(33)**이 반환돼 다른 배타 잠금과 충돌했다. probe handle은 닫았으며 잠금파일 생성/삭제/byte 쓰기는 없었다. [실행 증거](p0-lock-precheck-20261029.json).
- 범위: 원본/인증 쓰기 전 사전 검사다. 대상 이력·DB·인증 원문은 읽거나 복사하지 않았다. 기존 title/ID 확인은 유지하지만 잠금 owner PID·현재 Desktop 소유인지·다른 실행 주체인지는 미확인이다. 새 엔진 로그인이나 원래 thread를 복제해 우회하지 않는다.
- **중단 판정: P0 미통과, P1 미실행.** App Server 기동0, 로그인0, 공식 thread/resume 요청0, 모델 turn0, 재시도0. 이 결과는 App Server의 resume 응답이나 공식 재개 성공/실패 검증을 대신하지 않는다.
- 원본 쓰기 전에 중단해 백업/복구·임시 권한/설정 변경·OAuth callback 자원을 만들지 않았다. 앱 종료·다른 작업 중단·원본 덮어쓰기·잠금 해제는 없었다. source의 잠금 경로를 찾았다는 조사와 실제 Windows 충돌 관찰을 구분해 보존한다.
- 새 직접 지시 없이 잠금 상태 재조회/재시도/추가 로그인·재개·P1을 자동 실행하지 않는다. 그다음 실제 실행이 가능해지더라도 같은 ID의 P0 전체와 안전한 Desktop 교대가 통과해야 P1 조건이 충족된다.

## 10. 잠금 파일 사용 프로세스 조회와 정상 반납 방법

2026-10-29 16:23 KST. 후속 직접 지시로 소유 프로세스를 읽기 전용으로 조사했다. 동일 잠금 검사 반복/파일 삭제/강제 해제는 금지하고, 전체 종료가 필요하면 신산님이 다른 작업 정리 후 직접 수행한다. 정상 해제 후 기존 승인 P0/P1을 이어간다.

- [Windows Restart Manager RmGetList](https://learn.microsoft.com/en-us/windows/win32/api/restartmanager/nf-restartmanager-rmgetlist)1회 결과 해당 lock 파일의 사용 프로세스는 **codex PID21356 하나**였다. 임시 진단 세션은 정상 EndSession했고 Shutdown/Restart는 호출하지 않았다. 이 API는 파일 사용 프로세스를 반환하며 byte-range 잠금 소유 PID를 직접 반환하는 API가 아니다.
- 읽기 전용 CIM 대조에서21356의 부모는 **Desktop ChatGPT.exe PID19212**, 실행 파일은 설치 엔진0.165.0-alpha.1.2의 codex.exe였다. App Server/listener없음/proxy없음/daemon없음. 기존 단일 OS 잠금 충돌과 합치면 Desktop App Server가 잠금 소유자로 유력하다는 추론이다. [정제 대조 증거](p0-lock-owner-20261029.json).
- 대상 대화만 즉시 정상 unload하는 공개 UI는 여전히 미확인이다. 이전에 확인한 자동 inactive unsubscribe는 즉시 반납 보장이 아니므로 새로 조사를 반복하거나 기다리면 반드시 풀린다고 안내하지 않는다. archive/삭제/내부 unsubscribe 호출/설정 변경/자식 process kill로 대신하지 않는다.

**제시하는 정상 반납 절차:**

1. 신산님이 다른 진행 작업을 완료하거나 저장/checkpoint하고 미저장 입력·진행 외부 명령의 재개 지점을 확인한다. Agent가 다른 작업에 중단 지시를 보내지 않는다.
2. 앱 종료 동안 현재 조사 agent가 유지된다고 가정하지 않으므로, 종료 전에 독립 실행 절차/영속 receipt와 공식 사용자 로그인 수단을 준비한다. 현재 독립 runner는 미구현·미기동이며 지금 바로 앱을 닫아도 자동 검증이 계속된다고 안내하지 않는다.
3. 전체 종료가 필요하다고 선택하면 신산님이 앱 메뉴의 정상 Quit 또는 [공식 Windows 종료 단축키 Ctrl+Q](https://learn.chatgpt.com/docs/app/commands)를 직접 사용한다. 창 숨김·탭 닫기를 정상 종료로 대체하지 않는다. 정상 종료가 안 돼도 Agent는 강제 kill하지 않는다.
4. 정상 반납 후 기존21356 프로세스의 종료 metadata를 확인한다. 같은 LockFileEx 공유 잠금 검사는 반복하지 않고 파일을 삭제하지 않는다. 프로세스 종료만으로 전체 P0 통과로 선언하지 않으며, 이후 공식 thread/resume1회의 원래 ID/배타 writer 취득으로 실제 인계를 확인한다. 불명/충돌/오류이면 재시도하지 않는다.
5. 사용자 공식 로그인은 동일 계정의 새 인증을 process ephemeral로만 사용한다. 원본 credential을 복사하지 않는다. 실제 resume 전에 대상 한정 이력/필수 metadata의 일관 백업 명세를 확정하고 모델·자동 목표·도구/MCP 시작 억제를 확인한다. 복구는 현재 변경을 먼저 보존하고 비교하며 원본/공유 DB를 자동 덮어쓰지 않는다.
6. P0의 실제 원래 thread 재개와 안전한 반환이 확인된 후에만 승인된 Desktop→이어온→Desktop 최대3turn을 진행한다. 각 인계에서 동일 잠금 검사/실패 요청을 반복하지 않는다. Desktop 반납 방법이 성립하지 않아 안전한 교대가 불가하면 P1은 실행하지 않고 그 한계를 보고한다.

현재는 파일 사용 프로세스 확인과 방법 제시까지다. **실제 정상 반납/로그인/공식 resume/P0 통과/P1은 아직 미실행**이며, user의 정상 종료를 먼저 Agent가 수행하지 않는다.

## 11. 별도 시험용 세션으로 대상 변경

2026-10-29 16:27 KST. 신산님은 기존 업무 대화 대신 별도 시험용 세션으로 검증하도록 지시했다. **01a0dadd-739f-74d2-93c5-9c405cc1019b는 이제 실행/추가 조회 대상이 아니다.** 1~10절의 원래 대상과 결과는 조사 이력으로만 보존한다. 새 대상 ID와 ‘계정 변경’의 의미는 사용자 답변 대기다.

1. 신산님이 Desktop의 별도 시험용 세션에 민감하지 않은 사실2개를 한 사용자 turn으로 남긴다(D1). 파일/도구/하위 작업을 요청하지 않는다. 새 thread 링크/ID를 전달받고 이후 allowlist를 그 ID 하나로 제한한다. 최초 맥락도 승인된 총3개 사용자 turn에 포함한다.
2. 시험용 세션만 정상 반납하는 구체 경로를 확정하고 실제 결과를 확인한다. 단순 탭 닫기/idle을 반납으로 처리하지 않으며 업무 대화/프로세스나 전체 앱을 임의 종료하지 않는다. 새 시험만의 보관/해제 후보도 metadata와 저장 위치를 변경하므로 지금 실행 확정하지 않는다. [exact source1107–1139](https://github.com/openai/codex/blob/720fec862a608ae1e5878d1eecb04fb93192e93c/codex-rs/app-server/src/request_processors/thread_processor.rs#L1107-L1139)는 archive 준비가 shutdown 실패/timeout에도 진행할 수 있어 별도 정상 반납 확인이 필요하다.
3. 인증 전환 범위가 같은 ChatGPT 계정의 새 로그인인지, 다른 ChatGPT 계정인지, API 키 전환인지 사용자 확인 후 시험 프로세스의 공식 인증으로만 진행한다. 신산님이 직접 로그인하며 Desktop의 업무 계정/credential을 임의 교체·복사하지 않는다. API 키 전환은 유료 모델 호출 승인을 자동 의미하지 않는다.
4. 아래 단계는 각각 별도 PASS/FAIL/UNKNOWN/NOT_RUN으로 기록한다. 이전 단계 PASS를 다음 단계 성공으로 승격하지 않는다.

| 구분 | 확인 대상 | 인정하지 않는 확대 해석 |
| --- | --- | --- |
| A 목록 표시 | 변경된 인증 경로의 시험 프로세스에서 정확한 새 ID가 목록에 나타나는지 | 계정 소유권 이전·cloud history 동기화·본문 접근/모델 생성 성공 |
| B 본문 열기 | 같은 ID의 D1 본문이 실제로 열리고 예상 맥락과 일치하는지 | 실제 답변 생성·다른 계정의 정당한 사용 정책/권한까지 입증 |
| P0 원래 ID resume | 정상 반납 후 공식 App Server의 같은 원래 ID 재개·writer 소유·안전한 반환 | 저장 파일 복사/fork/새 대화 대체·현재 Desktop runtime attach |
| C 실제 답변 생성 | P0 통과 후 I1이 D1 사실을 질문에 복사하지 않고 회상하며 표식B를 남기고, Desktop D2에서 B와 앞선 맥락을 확인 | 목록/본문만 열린 결과·테스트 대역·계정 변경 전 결과 |

5. I1과 D2는 남은 최대2turn이며 단순 대화로만 제한한다. 유료 API 자동 전환·추가 turn·실패 재시도·다른 작업 중단·원본 덮어쓰기 없이 불명/충돌이면 중단한다. 토큰/비용 미수집은 미확인으로 남긴다. 시험 세션의 보관/삭제·복구도 업무 대화에 적용하지 않는다.

현재 추가 모델 호출/새 thread 생성/로그인/업무 대상 접근은 없다. 새 ID와 인증 전환 답변 전에는 종속 실행을 시작하지 않는다.
