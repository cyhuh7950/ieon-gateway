# S0-A — Remote Control 보류와 별도 App Server 대안

- 일시: 2026-10-29 KST / 담당: 어울
- 기준: 신산님의 최신 직접 지시. Remote Control 공개 외부 client 계약이 없으면 보류하고 별도 App Server 대안을 검토한다.
- 현재 단계: **DEVELOPMENT_PRIVATE / 문서·계약 검토만. 기동·인증 등록·기존 대화 조회/재개·시험 질문·모델 호출 미수행.**

## 1. Remote Control 판정

현재 Desktop의 Remote Control은 비활성화다. 근거는 신산님의 직접 확인이며 앱 설정이나 상태 API를 재조회하지 않았다.

| 필요한 공개 계약 | 조사 결과 |
| --- | --- |
| 외부 앱을 Remote Control client로 등록/승인하는 절차 | 확인하지 못함 |
| 해당 client의 공식 인증·scope·credential 발급/수명/폐기 | 확인하지 못함 |
| 등록 client가 Desktop 호스트/기존 thread에 접속하는 공개 endpoint/API·SDK·지원 범위 | 확인하지 못함 |

확인한 공식 문서는 ChatGPT mobile/desktop의 승인 기기 pairing과 CLI의 managed remote-control/SSH 흐름이다. CLI pair의 JSON 출력·내부 source의 relay 코드·일반 OAuth 앱 등록만으로 외부 Remote Control client의 공개 지원 계약이 성립한다고 보지 않는다.

판정은 **HOLD_NO_PUBLIC_CLIENT_CONTRACT**다. 확인 범위에서 공개 지원 계약을 찾지 못했다는 뜻이며 비공개/파트너 계약의 존재 여부나 영구 미지원까지 단정하지 않는다. 공식 외부 client 계약이 새로 제공되고 신산님이 재검토를 지시할 때만 재개한다. 활성화·pairing·내부 프로토콜 모방·credential 재사용·인증 복사는 하지 않는다. 기존의 source 분석은 참고 이력으로 보존한다.

공개 근거:

- [Remote connections](https://learn.chatgpt.com/docs/remote-connections): 동일 계정/workspace의 지원 ChatGPT 기기 연결과 pairing. 외부 서비스 client 등록 계약은 확인하지 못함.
- [Developer commands](https://learn.chatgpt.com/docs/developer-commands#codex-remote-control): managed remote-control/SSH 흐름은 자체 protocol client의 app-server listen을 대신하지 않는다고 구분.
- [Sign in with ChatGPT](https://developers.openai.com/siwc): 일반 앱 client ID 등록·로그인·eligible AI requests 문서. Remote Control의 승인 기기/relay 접속 API로 해석하지 않음.

## 2. 단일 대안: SINSAN의 이어온 전용 App Server를 stdio로 소유

이어온 PC 연결 구성요소가 별도의 공식 Codex App Server child를 소유하고 JSONL/stdio로 통신하는 방식을 검토한다. old socket/proxy·managed daemon·Remote Control을 사용하지 않으며 PC 수신 listener나 인터넷 App Server port를 추가하지 않는다. Oracle는 후속 인증 HTTP 중개/요청 보관 후보이고 현재 배포하지 않는다.

이는 **현재 Desktop runtime과 다른 실행 주체**다. 같은 파일을 읽거나 같은 thread ID를 전달했다는 이유로 기존 Desktop에 붙었다고 보고하지 않는다. 새 대화는 기존 대화 재사용의 대체 성공 기준이 아니다.

기본 요구는 그대로 유지한다: 기존 thread ID의 보존, 과거 맥락, 이어온 처리 내용의 Desktop 반영, 반대 방향 반영, 사용 중/unknown 처리·원래 대화 보존. 별도 App Server가 이를 지원하는지는 아직 확인되지 않았다.

### 먼저 확인할 계약

| 순서 | 다음 검토 내용 | 통과 전 금지/결과 기준 |
| --- | --- | --- |
| A0 | 공식 stdio 인터페이스와 해당 버전의 기존 thread 재개 계약·소유 데이터 접근/저장 범위 | 본문/원본 파일 조회·thread/resume·새 thread 생성·서버 기동 없음. 단순 문서 존재는 실제 재개 PASS가 아님 |
| A1 | Desktop 자격증명과 분리한 공식 인증·state/config 경계. 기존 대화 기록에 필요한 권한과 인증 저장을 분리할 수 있는가 | Desktop 토큰/쿠키/auth 파일/저장 인증 재사용·복사 없음. 새 공식 로그인·키 등록도 별도 승인 전 미실행 |
| A2 | 기존 thread의 단일 writer·Desktop 사용 중 감지·양방향 상태 갱신·거의 동시 시작의 차단을 두 runtime에서 보장할 방법 | 사용자 교대 약속·같은 파일 접근만으로 차단 PASS 아님. 이 경계가 없으면 기존 대화 실제 실행은 BLOCKED로 보고 |
| A3 | 모델 없는 최소 전송/안전 검사 제안. 이후 정확한 대상/인증/실행 자원/영향/rollback 계획 | 실제 기동·로그인·thread mutation·비용/모델 호출을 자동 시작하지 않음. 기존 thread 실증은 별도 승인 |

구현 가능성의 가장 큰 미확정은 **인증 격리와 원래 대화 접근의 양립**, 그리고 **Desktop을 포함한 실행 배타 제어**다. 해결되지 않으면 별도 App Server의 자체 기능이 동작해도 원래 요구 충족으로 보고하지 않는다. 원본 기록 복사/fork/새 대화로 우회하지 않는다. 새로운 대화 기능은 후속 별도 기능으로 남긴다.

## 3. 인증·서비스 범위

별도 프로세스가 Desktop의 로그인 캐시를 자동 사용하는 방식은 채택하지 않는다. 전용 인증/state 위치는 검토 후 결정하고 실제 Secret은 기록하지 않는다. 인증이 필요해지면 독립적인 공식 로그인 또는 승인된 API 키 경로를 명확히 선택하며, 구독 한도로 유료 API를 자동 선택하지 않는다. 현재 첫 실제 검증의 구독 로그인 선호를 API 키 사용 승인으로 바꾸지 않는다.

공식 App Server 문서는 local/open-source 앱과 commercial/hosted 서비스의 인증 범위를 구분한다. 따라서 local prototype의 인증 가능성을 Oracle 서비스 운영 허용으로 확대하지 않는다. 일반 Sign in with ChatGPT의 공식 등록/지원 범위를 서비스 단계에서 별도 확인해야 한다. 현재 앱 등록이나 파트너 문의는 하지 않았다. [App Server auth endpoints](https://learn.chatgpt.com/docs/app-server#auth-endpoints)

stdio/JSON-RPC 통합과 기존 thread resume API는 공식 문서에 있지만, 현재 Desktop과 교차 사용 성공·인증 분리·동시 실행 차단을 보장하지는 않는다. App Server 명령의 실험적 지원 범위도 별도로 유지한다. [App Server](https://learn.chatgpt.com/docs/app-server)

## 4. 현재 수행·미수행

수행: 공개 문서 검색/본문 열람, Remote Control 보류 기록, 별도 App Server 대안의 계약 검토 순서 정리.

미수행: 내부 protocol 추가 분석/모방, 인증 정보/설정/대화 원문 조회, 인증 재사용/복사, Remote Control enable/pair, socket/proxy 재시도, daemon/별도 서버/listener 기동, 기능 코드/테스트 변경, 실제 이어쓰기/모델 호출/Oracle 배포.

이번 전환은 대안 검토 순서의 전환이다. 기존 Desktop 직접 runtime 연결·기존 대화 이어쓰기 성공을 선언하거나 전체 구현을 승인한 것이 아니다.
## 5. 두 조건의 source 판정 갱신

공식 같은 계정 신규 로그인은 기존 인증 원문 복사와 다르다. 정확한 버전에는 process ephemeral credential 저장 및 persistent fallback 배제, 같은 state/lock root의 기존 ID resume 경로가 있다. 같은 CODEX_HOME/thread의 OS 단일 writer 잠금으로 두 번째 소유자가 충돌 거부되며, writer 반납 후 fresh resume는 최신 history를 로드한다. 따라서 A1/A2는 source상 조건부 경로가 확인됐지만 실제 Desktop·선택 대화 검증은 NOT_RUN이다. 단순 idle/질문 교대를 기술적 인계로 간주하지 않는다. [판정·지정 대상·0모델 우선 실증/복구 제안](AUTH_RESUME_AND_ALTERNATION_ASSESSMENT.md)을 우선하며 아직 실행하지 않는다.
