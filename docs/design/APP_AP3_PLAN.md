# AP-3 이어온 앱 — 착수 계획(설치 승인용)

작성 2026-11-14(신산님 "다음 작업 진행하자"). 근거: [MESSENGER_EXPANSION](MESSENGER_EXPANSION.md) B·C(AP0~AP6, B8 만드는 방법), [WORK_AND_VOICE](WORK_AND_VOICE.md) V1. 이 문서는 **착수 전 확인**이다 — 설치 0·코드 0.

## 1. 확인한 것(읽기만)

| # | 사실 |
| --- | --- |
| F1 | 참고 구조 `D:\Project\Aidot-Webchat`: **Next.js 16(정적 내보내기 `out/`) + Capacitor 8(안드로이드·아이폰) + Electron 42(PC 설치형, electron-builder)**, 스크립트 `mobile:android`·`package:android`(디버그 APK)·`package:desktop`. Aidot API·방 하나에 봇 하나 구조라 **화면 부품만 참고**하고 이어온 기능(AI 직원·방·카드·승인)은 새로 만든다(B8) |
| F2 | 이 PC에 안드로이드 빌드 도구가 이미 있음: Android Studio JBR(자바), SDK 플랫폼 34~36.1, build-tools, **에뮬레이터 AVD 5개**(Medium_Phone 등) — 디버그 APK 빌드·에뮬레이터 실행을 내가 직접 할 수 있음 |
| F3 | 서버 쪽 준비(AP-2): 1회용 연결 코드 → 앱 기기 열쇠, 대화·방·카드·승인 API, 새 소식 SSE(번호·상태만) |
| F4 | 앱은 다른 출처(origin)에서 서버를 부르므로 **CORS**가 필요: 휴대폰은 Capacitor 네이티브 HTTP(CORS 우회)로, PC 설치형(Electron)·웹 앱은 서버가 **앱 출처만** 허용하도록 서버 수정 필요(`Authorization: Bearer <앱 열쇠>`만, 쿠키 없음) |

## 2. 만드는 범위(단계)

| 단계 | 내용 | 완료 기준(내가 직접 시험) |
| --- | --- | --- |
| **AP-3a** | 저장소 안 `app/` 폴더(서버와 분리된 package.json). 첫 화면 "서버 주소 + 연결 코드" → 열쇠 저장, **AI 직원(대화) 목록·1:1 대화·질문 보내기·답·카드(승인 허용/거부·다시 보내기·확인 필요)**, 새 소식(SSE)으로 바로 갱신. 웹·PC 설치형(Electron)·안드로이드(Capacitor) 같은 화면. 서버 CORS(앱 출처만) | 단위 시험, Next 빌드, Electron 실행 화면 확인, **안드로이드 디버그 APK 빌드 + 에뮬레이터에서 연결·목록·질문 왕복**(시험 대화, 모델 호출 승인 필요) |
| AP-3b | 앱에서 **방**(만들기·@이름·사용 중 알림·넘기기·다시 보내기)과 AI 직원 이름·역할·아이콘 | 같은 방식 |
| AP-3c | **V1 음성**: 기기 내장 받아쓰기(말로 질문)·읽어 주기(답을 소리로), 음성으로 승인 없음 | 에뮬레이터·PC에서 동작 확인, 실제 휴대폰은 신산님 |
| (AP-4) | 알림(원문 없음)·아이폰 빌드·PC 설치 파일 | 다음 단계 |

열쇠 보관: 휴대폰은 Capacitor Preferences(앱 전용 저장소), PC는 Electron 사용자 폴더 — 원문을 로그·화면에 다시 보이지 않음. 앱 아이콘·이름 "이어온".

## 3. 설치가 필요한 것(이번 승인 대상)

`app/` 폴더 안에만 설치(서버 `node_modules`와 분리, 이어온 서버 동작에 영향 없음). npm 공식 저장소에서:

| 부품 | 쓰는 곳 |
| --- | --- |
| next, react, react-dom | 화면(정적 내보내기) |
| @capacitor/core, @capacitor/cli, @capacitor/android, @capacitor/preferences | 안드로이드 앱·열쇠 보관 |
| electron, electron-builder | PC 설치형 |
| typescript, @types/react, @types/node, vitest | 개발·시험 |

크기는 수백 MB(Electron·Next 포함). 아이폰(@capacitor/ios)은 맥이 필요해 AP-4에서.

## 4. 그 밖의 승인

- **에뮬레이터 실행**: 이 PC에서 안드로이드 에뮬레이터를 띄움(로컬 디버그 포트 사용). 시험 뒤 끔.
- **모델 호출**: 앱에서 질문 왕복 확인 1~2차례(시험 대화).
- **배포**: 서버 CORS 수정은 기존처럼 PR → 허브·이 PC 적용 승인.
- 신산님 몫(나중): 실제 안드로이드 휴대폰에 APK 설치해 보기, 스토어 계정(AP-5).

## 5. AP-3a 결과(2026-11-14, 신산님 "설치·에뮬레이터 승인")

- 설치: `app/` 안에만 404개(`npm install`), Electron 실행 파일은 첫 실행 때 받음. 막힌 설치 스크립트는 electron-winstaller 1개(설치 파일 만들 때만 필요 — AP-4).
- 만든 것·시험: [MESSENGER_EXPANSION B13](MESSENGER_EXPANSION.md). 모델 호출 0 — 질문 왕복은 가짜 서버(가짜 PC)로 확인해 실제 Codex 왕복은 아직(필요하면 1~2차례 승인 후).
- 만드는 법(`app/`): `npm test` · `npm run desktop`(PC 앱 실행) · `npm run package:android`(디버그 APK → `app/dist/release/`).
- 배포: 서버 CORS 수정은 허브·이 PC 적용 승인 뒤에 실제 서버에서 앱을 쓸 수 있음.

## 6. AP-3b 결과(2026-11-14)

- 앱에 방(만들기·@이름·사용 중 알림·다시 보내기·넘기기·방 안 허락 카드)과 AI 직원 이름·아이콘 바꾸기, 안드로이드 뒤로 가기. 서버 코드 변경 없음(시험만 추가) — 앱만 바뀌어 배포는 필요 없고, 새 APK·PC 앱으로 쓰면 됨. 자세한 것: [MESSENGER_EXPANSION B14](MESSENGER_EXPANSION.md).
