# 이어온 제품 맥락

<!-- impeccable:product-schema 1 -->

기준: 2026-11-19

## Platform

web, Android 앱, Windows PC 앱

## Stack

이어온 서버는 Node.js 24다. PC형은 Windows PC에서, 허브·서버 설치형은 리눅스 서버의 Docker에서 돈다. 웹 화면은 서버가 내주는 HTML/CSS/JavaScript다. 앱은 같은 화면 기술로 만든 안드로이드(Capacitor)·PC(Electron) 앱이다.

## Users

- **허브 주인(관리자):** 허브를 설치하고 설정·보안·메신저 봇·계정을 관리한다.
- **승인된 가입자:** 약관에 동의하고 가입 신청 → 관리자 승인 뒤 쓴다. 하루 질문 한도가 있을 수 있다(한국 시간 0시에 다시).
- 누구나 **자기 PC의 자기 세션만** 쓴다. 관리자도 가입자의 대화를 화면·API로는 볼 수 없다.

## Product Purpose

이어온은 이미 쓰고 있는 **Codex·Claude Code·Antigravity 작업 세션**을 웹·안드로이드/PC 앱·메신저(텔레그램·디스코드·슬랙·라인·카카오톡)·HTTP API에 연결한다. 복사본이나 새 대화가 아니라 **같은 세션**을 이어 쓴다. 필요하면 이어온이 새 세션도 만든다.

## Operating Context

| 설치 형태 | 무엇을 켜 두나 |
| --- | --- |
| PC형 | 내 PC 하나(`http://127.0.0.1:28760`) |
| 허브형 | 공개 서버(허브) + 허브에 연결한 PC들 |
| 서버 설치형 | 리눅스 서버 하나 — AI는 서버의 엔진 칸(컨테이너)에서 돈다. 나중에 허브형으로 바꿀 수 있다 |

설치는 명령 한 번이고, 나머지 설정·로그인은 모두 웹 화면에서 한다.

## Capabilities and Constraints

- **계정:** PC 기본 로그인(그 PC의 앱 로그인) 또는 이어온 전용 계정(Codex·Claude·Antigravity). 구독 로그인, API 키, 호환 주소를 쓸 수 있다. 한도에 걸려도 다른 계정으로 몰래 바꾸지 않는다.
- **작업 모드:** 평소 질문은 읽기 전용이다. 작업 모드를 켠 대화만 파일 수정·명령 실행을 하고, 할 때마다 승인 카드(웹·앱)나 `/허용 n`·`/거부 n`(메신저)으로 묻는다(Codex·Antigravity).
- **안전:** 사용 중인 세션에는 보내지 않는다. 결과 불명이면 자동으로 다시 보내지 않고 사람이 정리한다. 업무 대화는 대상에서 뺀다.
- **기록:** 로그에는 질문·답·비밀값 원문을 남기지 않는다. 이어온 보관 기록을 지워도 원래 세션 기록은 남는다.
- **앱·알림:** 앱은 스토어 없이 허브에서 받는다. 휴대폰·PC·웹 알림은 "○○가 답했어요"처럼 내용 없이 온다. 아이폰 앱은 보류다.

## Brand Commitments

서비스명은 이어온, 한국어로 작성한다. 화면 표준은 PMO PRODUCT_DESIGN_STANDARD다. 첫 기준은 사용자 편의 — 할 일이 가장 적고 바로 되는 것.

## Evidence on Hand

현황·실측 기록은 docs/WORK_STATUS.md, 실제 환경은 docs/DEVELOPMENT_ENVIRONMENT.md, 첫 실증 결과는 docs/validation/FIRST_CONTINUITY_RESULT.md다.

설명서: [MANUAL](docs/MANUAL.md)(요약) · [BEGINNER_GUIDE](docs/BEGINNER_GUIDE.md)(설치·처음 쓰기) · [APP_GUIDE](docs/APP_GUIDE.md)(앱) · [MEMBER_GUIDE](docs/MEMBER_GUIDE.md)(가입자) · [MESSENGER_MANUAL](docs/MESSENGER_MANUAL.md)(메신저) · [OPERATIONS](docs/OPERATIONS.md)(허브 운영) · [API_GUIDE](docs/API_GUIDE.md)(HTTP API)

## Product Principles

1. 원래 세션과 사용자 작업을 보존한다(같은 세션, 복사·대체 없음).
2. 접수와 완료, 실패와 결과 불명을 구분한다.
3. 권한·비용·계정을 몰래 넓히지 않는다.
4. 사용자가 할 일을 가장 적게 한다 — 이어온 안에서 다 한다.

## Accessibility & Inclusion

PMO의 한국어 폰트·키보드·상태 문구·명도 대비·1920/1440/430 viewport 기준을 적용한다. 상세한 토큰과 화면 계약은 docs/design/DESIGN.md가 정본이다.
