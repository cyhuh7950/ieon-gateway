# 다른 계정 공식 로그인과 지정 클라우드 ID 조회 결과

- 기록: 2026-10-29 17:31 KST / private 개발 branch 실증.
- 대상: 사용자 지정 **PR-Test 설정**, `01a186a9-a58d-76d2-bc55-215f5b4a008e`.
- 사용자 진술: 다른 PC·다른 ChatGPT 계정의 클라우드 세션이며 원래 PC에서 로그아웃함.
- [정제 실제 receipt](cloud-account-access-20261029.json). 기존 업무 대상은 제외한다.

| 항목 | 실제 판정 |
| --- | --- |
| 새 공식 로그인 | 사용자 직접 완료 화면·응답 및 신규 프로필 생성으로 확인 |
| Codex Cloud 목록 요청 | 성공(exit0), 반환 항목0개, 지정 ID 미발견 |
| 지정 ID의 cloud status | 실패(exit1), NOT_FOUND 분류 |
| 본문 열기 | NOT_RUN |
| 실제 답변 생성 | NOT_RUN / 모델 turn0 |
| 기존 ID resume·P0/P1 | NOT_RUN / 통과 아님 |
| 로그인·실패 요청 재시도 | 로그인1회, 실패 요청 재시도0 |

이번 새 대상에서 잠금 오류는 관찰하지 않았다. 과거 다른 업무 대상에서 확인한 로컬 OS 잠금은 이 대상의 잠금 증거가 아니다. 여러 기기의 같은 계정 로그인 자체와 별도 로컬 writer 충돌을 구분한다.

이번 목록/상태 결과는 **공식 CLI가 조회한 Codex Cloud task 범위**다. 해당 계정의 모든 종류의 대화가 없거나 접근이 원천 불가능하다고 결론내리지 않는다. 제공된 `chatgpt.com/local/…`, `codex://threads/…`는 [공식 명령 문서](https://learn.chatgpt.com/docs/app/commands)에서 local chat으로 설명하는 형식이다. 사용자 진술과 이 형식만으로 실제 backend/type을 임의 확정하지 않는다.

[공식 CLI 문서](https://learn.chatgpt.com/docs/developer-commands)의 cloud list/status와 설치 버전 도움말을 사용했다. 도움말의 cloud 명령은 exec/status/list/apply/diff이며, 이 실행기는 생성/변경인 exec/apply/diff를 사용하지 않는다. 본문과 기존 대화 이어쓰기는 올바른 대화 유형과 공개 공식 접근 경로를 확인한 뒤 별도 증거로 판정해야 한다. 다른 계정의 브라우저에서 열린 결과를 이번 새 CLI 로그인 결과로 혼용하거나 내부 endpoint/credential 복사로 우회하지 않는다.

## 실행기와 보존

- 구현: [cloud_account_probe.py](../../src/pilot/cloud_account_probe.py), Python3.14 표준 라이브러리만 사용.
- 설치 엔진: `C:\Users\cyhuh\AppData\Local\OpenAI\Codex\bin\08d187884f2330d1\codex.exe`, 0.165.0-alpha.1.2.
- 신규 보호 프로필의 공식 file credential store만 사용했고 원래 Desktop 인증/업무 대화는 조작하지 않았다.
- 사용자 로그인은 실제 완료했으나 최초 wrapper의 출력 파이프 대기 때문에 로그인 CLI exit code는 수집하지 못했다. 해당 wrapper만 종료하고 같은 신규 인증으로 미실행 상태였던 list/status를 각1회 실행했다.
- 파이프 대기는 login 표준출력을 캡처하지 않고 자식 종료를 기다리는 코드로 수정했고 모델 없는 안전 검사8/8을 통과했다. 수정 후 실제 재로그인은 하지 않았다.
- 신규 credential/임시 프로필 제거 확인. 인증 원문/로그인 URL/대화 원문/사용자 첨부 이미지는 보고서·Git에 저장하지 않는다.
- 최초 코드 검토 Important1건(기존 profile 파일 삭제 위험)은 빈 디렉터리 gate와 보존 검사로 수정했다. 소유 미확인 `.serena/`는 보존·commit 제외한다.

기존 실패 요청이나 로그인을 반복하지 않는다. 정확한 공식 접근 경로가 확인되기 전 새 thread/fork·로컬 파일 복사로 성공을 대체하거나 모델을 호출하지 않는다.
