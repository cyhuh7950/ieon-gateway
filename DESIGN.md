---
name: 이어온
description: 메신저·웹·앱과 PC의 AI 작업 세션을 잇는 화면
colors:
  accent: "#0f766e"
  accent-soft: "#e6f4f2"
  on-accent: "#ffffff"
  bg: "#f3f5f7"
  surface: "#ffffff"
  surface-alt: "#f7f9fb"
  text: "#1f2329"
  muted: "#5b6573"
  border: "#dfe3e8"
  ok: "#17654d"
  warn: "#7a4f00"
  warn-soft: "#fdf3dc"
  err: "#a12b37"
  err-soft: "#fbe9eb"
  engine-codex: "#3b4a63"
  engine-claude: "#9a5634"
  dark-accent: "#2bb3a5"
  dark-bg: "#0f1214"
  dark-surface: "#171b1e"
  dark-surface-alt: "#1d2226"
  dark-text: "#e8ecef"
  dark-muted: "#9aa6b1"
  dark-border: "#2a3136"
typography:
  title:
    fontFamily: "Pretendard Variable, Pretendard, Noto Sans KR, Malgun Gothic, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.35
  headline:
    fontFamily: "Pretendard Variable, Pretendard, Noto Sans KR, Malgun Gothic, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.4
  label:
    fontFamily: "Pretendard Variable, Pretendard, Noto Sans KR, Malgun Gothic, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "Pretendard Variable, Pretendard, Noto Sans KR, Malgun Gothic, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  caption:
    fontFamily: "Pretendard Variable, Pretendard, Noto Sans KR, Malgun Gothic, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "14px"
  card: "20px"
  pill: "99px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.err}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  chip:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  input:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "9px 11px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: 이어온

## Overview

**Creative North Star: "조용한 연결 창구"**

이어온 화면은 사람이 PC의 AI 세션에 말을 건네는 창구다. 주인공은 대화와 그 대화의 상태(보낼 수 있음·바쁨·꺼짐)이고, 화면 장식은 뒤로 물러난다. 하얀 바탕과 차분한 회색 위에 청록 하나만 강조로 쓰고, 어두운 모드에서도 같은 관계를 지킨다.

밀도는 업무 화면 수준(PMO 기준 12px 본문)이다. 대화 화면과 설정·관리 화면이 같은 글자 크기·색·모서리·버튼을 쓴다. 어느 화면으로 옮겨도 같은 앱으로 느껴져야 한다. 고급 항목은 접어 두고 기본값으로 바로 동작하는 것이 먼저다.

**Key Characteristics:**
- 강조색은 청록 하나, 상태색(ok·warn·err)은 의미가 있을 때만
- 밝은·어두운 모드를 모든 화면이 같은 토큰으로 지원
- 그림자보다 테두리와 바탕 단계로 층을 나눔(창·서랍만 그림자)
- 둥근 모서리(10~14px), 칩과 배지는 알약 모양
- 누를 것은 휴대폰에서 44px 이상

## Colors

차분한 회색 바탕에 청록 하나가 길을 안내한다.

### Primary
- **이어온 청록** (accent, 어두운 모드 dark-accent): 주 버튼, 내 말풍선, 선택된 탭·목록, 포커스 테두리, 링크. 화면마다 주 버튼은 하나.
- **옅은 청록** (accent-soft): 선택된 대화 줄, 숫자 코드 상자 바탕.

### Neutral
- **바탕 회색** (bg): 페이지 바탕.
- **종이 흰색** (surface): 목록·머리줄·카드·창.
- **한 단계 바탕** (surface-alt): 입력칸, 칩, 마우스를 올린 줄.
- **글자 먹색** (text) / **흐린 글자** (muted): 본문과 보조 설명.
- **선 회색** (border): 모든 테두리와 나눔선.

### 상태색
- **됨** (ok), **주의** (warn / warn-soft), **오류** (err / err-soft): 상태 문구·카드·알림에만. 상태를 색만으로 알리지 않고 글자를 함께 쓴다.
- **엔진 색** (engine-codex, engine-claude): 대화 아바타 바탕. 흰 글자와 4.5:1 이상.

### Named Rules
**한 목소리 규칙.** 청록은 화면에서 "지금 누를 것·지금 고른 것"에만 쓴다. 남색·파랑 같은 두 번째 강조색을 만들지 않는다.

**토큰만 규칙.** 색은 `:root` 토큰으로만 쓴다. `#fff4d6` 같은 값을 바로 쓰면 어두운 모드에서 흰 칸이 생긴다.

## Typography

**Body Font:** Pretendard Variable (Noto Sans KR, 맑은 고딕으로 대체)

**Character:** 한 글꼴로 굵기와 크기만 달리 쓴다. 한국어 존댓말 문장이 편히 읽히는 것이 기준이다.

### Hierarchy
- **Title** (700, 20px): 처음 설정·로그인 카드 제목.
- **Headline** (700, 16px): 대화 머리줄 제목, 창 제목, 설정 화면 탭 제목(h2).
- **Label** (600, 14px): 섹션 소제목(h3)·접는 줄, 메뉴.
- **Body** (400, 12px, 1.6): 모든 화면의 본문·말풍선·표·입력칸(휴대폰 입력칸은 16px).
- **Caption** (400, 11px): 배지·칩·짧은 상태·표 머리글.
- 숫자 코드(메신저 연결 숫자)만 24px.

### Named Rules
**12px 기준 규칙(PMO PRODUCT_DESIGN_STANDARD 4.2, 2026-11-20 신산님 "PMO 기준 12px로").** 본문·입력은 12px. 14px은 메뉴·소제목·강조에만, 휴대폰 입력칸은 16px(iOS 확대 방지), 10px 이하는 쓰지 않는다.

**제목 차례 규칙.** h1 → h2 → h3 차례를 건너뛰거나 뒤집지 않는다.

## Layout

대화 화면은 왼쪽 목록(280px), 가운데 대화, 오른쪽 패널(320px)의 세 칸이다. 760px 아래에서는 한 칸씩 보여 주고 패널은 오른쪽 서랍이 된다. 설정 화면은 가운데 정렬된 폭 960px 안에서 탭 하나가 한 화면에 들어오게 하고, 고급 항목은 접는다. 모든 화면의 휴대폰 분기점은 760px 하나다. 간격은 4·8·12·16·24px 단계만 쓴다.

## Elevation & Depth

평면이 기본이다. 층은 바탕(bg) → 종이(surface) → 한 단계 바탕(surface-alt)과 1px 테두리로 나눈다. 그림자(0 12px 40px rgba(20,30,40,.14), 어두운 모드 rgba(0,0,0,.5))는 화면 위에 뜨는 창·서랍·알림에만 쓴다.

## Shapes

부드러운 모서리: 입력칸·버튼 10px, 목록 줄·카드 12px, 말풍선 14px(보낸 쪽 꼬리 4px), 처음 설정·로그인 카드 20px, 칩·배지 알약(99px). 직각 모서리와 6px 이하 모서리는 쓰지 않는다.

## Components

### Buttons
- **Shape:** 10px 모서리, 휴대폰에서 높이 44px 이상.
- **Primary:** 청록 바탕, 흰(어두운 모드는 먹색) 글자, 굵게. 한 묶음에 하나.
- **Secondary:** 종이 바탕, 선 회색 테두리.
- **Danger:** 종이 바탕에 오류색 글자와 테두리. 지우기·끊기·폐기처럼 되돌릴 수 없는 일은 이 모양과 확인 창을 함께 쓴다.
- **Focus:** 2px 청록 테두리, 2px 띄움.

### Chips
- **Style:** 한 단계 바탕, 선 회색 테두리, 흐린 글자 12px, 알약 모양. 상태 표시용이며 누르는 버튼이 아니다.

### Cards / Containers
- **Corner Style:** 12px. **Background:** 종이. **Border:** 1px 선 회색. **Shadow:** 없음. **Padding:** 12~16px.
- **상태 카드(card2):** 테두리와 글자를 상태색으로, 바탕을 상태색 옅은 판으로. 할 일 버튼을 카드 안에 둔다.

### Inputs / Fields
- **Style:** 한 단계 바탕, 1px 선 회색, 10px 모서리, 9px 11px 안쪽 여백.
- **Focus:** 2px 청록 테두리.

### Navigation
- **설정 탭:** 알약 모양 버튼 줄. 고른 탭은 청록 바탕. 한 줄에 5개 이하.
- **대화 목록:** 아바타 36px + 제목/상태 두 줄. 고른 줄은 옅은 청록.

### 풍선 도움말(ⓘ)
- **설명은 여기에만.** 화면 본문에 설명 문단을 쓰지 않는다. 제목·접는 줄·항목 옆 18px 원(선 회색, 기울인 i)에 마우스를 올리면(터치는 누르면) 먹색 바탕·종이색 글자 12px 풍선이 아이콘 오른쪽 아래로 펼쳐진다(최대 340px).
- 마크업: `<span class="tip" tabindex="0" role="note" aria-label="설명" data-tip="설명">i</span>`, 화면 코드에서는 `tip('설명')`.
- 상태는 짧은 낱말(연결됨·꺼짐·없음)만, 괄호 설명을 붙이지 않는다.

### 대화 아바타 (Signature)
엔진마다 바탕색이 다른 36px 둥근 사각형(10px)에 엔진 머리글자. 한눈에 Codex·Claude를 가른다.

## Do's and Don'ts

### Named Rules
**보이기 규칙(2026-11-20 신산님).** 기능이 있는 것과 지금 쓸 수 있는 것은 다르다. 개발한 기능은 모두 보인다(미설치·꺼짐·구독 없음·시험 전이라도). 쓸 수 있게 되는 즉시 자동으로 활성으로 되돌릴 수 있을 때만 비활성으로 두고, 아니면 활성으로 두어 사용자가 판단한다. AI가 판단해 숨기거나 막지 않는다.

**설명은 ⓘ 규칙.** 설명문은 풍선 도움말로만(PMO PRODUCT_DESIGN_STANDARD 8·8.1절).

### Do:
- **Do** 새 화면은 app.html과 같은 `:root` 토큰과 어두운 모드 블록을 쓴다.
- **Do** 고급·드문 설정은 `<details>`로 접는다.
- **Do** 오류 상태에는 다음에 할 일 버튼을 같이 둔다(설명은 ⓘ).
- **Do** 위험한 동작은 Danger 버튼과 확인 창으로 구분한다.

### Don't:
- **Don't** 남색(#24344d)이나 파랑(#2563eb) 같은 두 번째 강조색을 쓰지 않는다.
- **Don't** 본문을 12px보다 크게 키우지 않는다(PMO 4.2 — 메뉴·소제목·강조만 14px).
- **Don't** 브라우저 기본 버튼·링크 모양을 그대로 두지 않는다.
- **Don't** 내부 ID(`c_…`, `h_…`)나 파일 이름을 일반 사용자 화면에 그대로 보이지 않는다.
- **Don't** 지금 못 쓴다는 이유로 기능을 숨기지 않는다.
- **Don't** 화면 본문에 설명 문단·괄호 설명을 달지 않는다.
