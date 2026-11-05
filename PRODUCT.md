# 이어온 제품 맥락

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

시안은 서버 없이 여는 독립 HTML/CSS/JavaScript다. 제품 backend·PC 연결 프로그램의 실제 기술 스택은 첫 실증 설계안이며 아직 구현·승인되지 않았다.

## Users

첫 실증 사용자는 신산님 한 명, Windows Codex 데스크톱을 사용하는 SINSAN PC 한 대다. 가입·다중 사용자 관리 화면은 제외하되 사용자·앱·PC·대화의 소유권은 구분한다.

## Product Purpose

외부 앱이 이미 존재하는 특정 Codex 대화에 질문하고 원래 맥락을 이어받는다. 데스크톱과 이어온에서 번갈아 사용해도 같은 thread를 유지하는 것이 핵심이며 새 대화로 대체할 수 없다.

## Operating Context

최소 테스트 웹 → 이어온 인증 API → SINSAN 연결 구성요소 → 기존 Codex 실행 환경의 구조를 검토한다. Oracle는 배치 후보이며 실제 배포는 별도 승인이다. 처음에는 새 검색·RAG·MCP 없이 대화 연속성을 검증한다.

## Capabilities and Constraints

- 기존 thread 연결과 새 대화 생성은 별도 기능이다. 첫 실증 이후 나머지 범위를 확정한다.
- 사용 중인 대화는 추가 실행하지 않는다. 단절·결과불명 때 자동 재전송·새 대화 대체를 금지한다.
- 구독 로그인과 API 키는 별도 인증 경로이며 자동 유료 전환이 없다. 첫 실증은 구독 로그인이다.
- 보관된 질문·답변은 사용자 삭제 전까지 유지하고 허용된 사용자·앱만 조회한다. 서버 삭제는 원래 Codex 대화를 지우지 않는다.
- 인증정보·대화 원문을 기본 운영 로그에 중복 기록하지 않는다.
- 설계 확인 전 제품 구현·운영 배포·모델 호출·키 등록·보안 설정 변경을 하지 않는다.

## Brand Commitments

서비스명은 이어온, 한국어로 작성한다. 화면 표준은 PMO PRODUCT_DESIGN_STANDARD이며 신규 브랜드·마케팅·대규모 관리 시스템은 이번 요청이 아니다.

## Evidence on Hand

환경 조사·인터뷰 기록은 docs/WORK_STATUS.md와 docs/DEVELOPMENT_ENVIRONMENT.md다. 실제 thread 재사용과 인증 전환은 아직 미검증이다. 시안은 예시 데이터만 쓴다.

## Product Principles

1. 원래 대화와 사용자 작업을 보존한다.
2. 접수와 완료, 실패와 결과불명을 구분한다.
3. 권한·비용·인증을 암묵적으로 확대하지 않는다.
4. 이어쓰기 실증을 먼저 하고 구현 확대는 결과 검토 후 결정한다.

## Accessibility & Inclusion

PMO의 한국어 폰트·키보드·상태 문구·명도 대비·1920/1440/430 viewport 기준을 적용한다. 상세한 토큰과 화면 계약은 docs/design/DESIGN.md가 정본이다.