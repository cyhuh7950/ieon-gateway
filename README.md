# 이어온 (ieon-gateway)

메신저(카카오톡·텔레그램·디스코드·슬랙·라인)·이어온 앱(안드로이드·PC)·웹 화면에서 **PC나 서버에서 하던 AI 작업 세션**(Codex·Claude Code, 그리고 Antigravity·Grok)과 대화하게 이어 주는 연결 프로그램입니다. 새 대화로 바꾸지 않고 **하던 그 세션**에 이어 묻고 답을 받습니다.

*Ieon connects messengers, the Ieon App and the web to the AI work sessions you already run on your PC or server (Codex, Claude Code, Antigravity, Grok) — continuing the same session, not starting a new chat. English manuals: [docs/en](docs/en/).*

## 무엇을 하나

- **세션 잇기:** 메신저·앱·웹에서 보낸 질문을 그 세션에 이어 보내고, 답을 보낸 곳으로 돌려줍니다. 쓰는 중·PC 꺼짐·결과 불명이면 보내지 않습니다.
- **작업 모드·승인 카드:** 파일 수정·명령 실행은 대화별로 켜고, 할 때마다 사람이 [허용]/[거부].
- **두 가지 설치:** 이 PC만 쓰는 PC형, 여러 PC·서버를 한 허브로 묶는 허브형(여러 사람 가입·한도 포함).
- **새 세션·엔진 칸·예약 작업·방(여러 AI 직원)·휴대폰 알림·음성**(기기 내장, OpenAI 한 번씩·실시간 대화)·**외국어**(한국어·영어, 언어 더하기 쉬움).

## 문서

| 무엇 | 문서 |
| --- | --- |
| 처음 쓰는 사람용 따라 하기 | [docs/BEGINNER_GUIDE.md](docs/BEGINNER_GUIDE.md) |
| 사용 설명서 | [docs/MANUAL.md](docs/MANUAL.md) |
| 이어온 앱 | [docs/APP_GUIDE.md](docs/APP_GUIDE.md) |
| 메신저 설정 | [docs/MESSENGER_MANUAL.md](docs/MESSENGER_MANUAL.md) |
| 다른 사람 허브에 가입해 쓰기 | [docs/MEMBER_GUIDE.md](docs/MEMBER_GUIDE.md) |
| 허브 운영(여러 사람·한도·백업) | [docs/OPERATIONS.md](docs/OPERATIONS.md) |
| 내 프로그램 연동(HTTP API) | [docs/API_GUIDE.md](docs/API_GUIDE.md) |
| 새 언어 더하기 | [docs/I18N_ADD_LANGUAGE.md](docs/I18N_ADD_LANGUAGE.md) |
| 제품 맥락 | [PRODUCT.md](PRODUCT.md) |
| 요구·설계 / 화면 디자인 기준 | [docs/design/DESIGN.md](docs/design/DESIGN.md) / [DESIGN.md](DESIGN.md) |
| 실행 계획 / 현황·기록 | [docs/WORK_PLAN.md](docs/WORK_PLAN.md) / [docs/WORK_STATUS.md](docs/WORK_STATUS.md) |
| 작업 지침(AI 작업자용) | [AGENTS.md](AGENTS.md) |

## 실행

- **이 PC(Windows):** `pwsh scripts/ieon.ps1 start | stop | status` — 자세한 것은 설명서 2절.
- **허브(서버, Docker):** [deploy/hub](deploy/hub/) — 배포 순서는 [OPERATIONS](docs/OPERATIONS.md).
- **새 서버 설치:** 허브 화면 **설정 → 관리 → 허브 보안 → 새 서버에 설치**의 명령 한 줄(또는 `sh deploy/server/install.sh`).
- **이어온 앱:** 허브의 `/app`에서 받기. 빌드는 [app/](app/) (`npm run package:android:release`, `npm run package:desktop`).

## 개발

- Node.js 24 이상. 시험: `node --test --test-timeout=60000 tests/pilot/*.test.mjs tests/relay/*.test.mjs`, 앱: `cd app && npm test`.
- 화면 글은 직접 쓰지 않고 사전(`locales/<언어>/*.json`)에 둡니다.
- main에 직접 커밋하지 않습니다. `claude/<목적>`·`codex/<목적>` branch → push → `pr-request/<sha>/<branch>` 태그로 PR Broker가 검사·병합(AGENTS.md "기록과 Git").
- 비공개 저장소입니다. 비밀값(키·토큰·비밀번호)은 코드·Git·로그에 넣지 않습니다.
