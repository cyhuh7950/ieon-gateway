#!/bin/sh
# SV4 이어온 서버 설치(리눅스, 신산님 2026-11-17 "SV4 진행해", 설계 SERVER_SESSIONS 4절). 저장소 폴더에서 한 번:
#   sh deploy/server/install.sh
# 하는 일: Docker 확인(없으면 공식 설치 스크립트로 설치할지 물음) → 몇 가지 질문(Enter = 기본값) → 설치 폴더 환경 파일(.env)에 저장 →
#          이어온 컨테이너 빌드·시작(처음 설정은 컨테이너가 스스로 만듦) → 작업용 엔진 칸 하나(선택) → 웹 주소 안내.
# 나머지(관리자 비밀번호·Codex/Claude 로그인·메신저 봇)는 모두 웹 화면에서 한다. 다시 실행해도 이미 적은 값·데이터는 바꾸지 않는다.
# 키 값은 화면·로그에 내지 않는다(입력할 때도 가림, 환경 파일은 주인만 읽음).
set -eu
cd "$(dirname "$0")/../.."
ENVF=.env
say() { printf '%s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }
has() { [ -f "$ENVF" ] && grep -q "^$1=" "$ENVF"; }
get() { if [ -f "$ENVF" ]; then sed -n "s/^$1=//p" "$ENVF" | head -1 | tr -d '"\r'; fi; }
put() { has "$1" || { (umask 077; printf '%s=%s\n' "$1" "$2" >> "$ENVF"); }; }
ask() { printf '%s [%s]: ' "$1" "$2"; REPLY=''; read -r REPLY || true; [ -n "$REPLY" ] || REPLY="$2"; }
ask_secret() { printf '%s (없으면 Enter): ' "$1"; stty -echo 2>/dev/null || true; REPLY=''; read -r REPLY || true; stty echo 2>/dev/null || true; printf '\n'; }
SUDO=''; [ "$(id -u)" -eq 0 ] || SUDO='sudo'

say "== 이어온 서버 설치 =="
# 1) Docker
if ! command -v docker >/dev/null 2>&1; then
  ask "Docker가 없어요. 지금 공식 설치 스크립트(get.docker.com)로 설치할까요? (Y/n)" "Y"
  case "$REPLY" in [Nn]*) die "Docker를 설치한 뒤 다시 실행하세요: https://docs.docker.com/engine/install/";; esac
  command -v curl >/dev/null 2>&1 || die "curl이 필요해요(예: sudo apt-get install -y curl)"
  curl -fsSL https://get.docker.com | $SUDO sh
fi
DOCKER=docker
docker info >/dev/null 2>&1 || DOCKER="$SUDO docker"
$DOCKER compose version >/dev/null 2>&1 || die "Docker Compose(docker compose)가 필요해요 — Docker를 최신으로 설치하세요"

# 2) 이 서버 크기 → 권장 사양과 비교, 컨테이너 크기 정하기
CPUS=$(nproc 2>/dev/null || echo 1)
MEMG=$(awk '/MemTotal/{printf "%d", $2/1024/1024 + 0.5}' /proc/meminfo 2>/dev/null || echo 0)
say "이 서버: CPU ${CPUS}코어 · 메모리 약 ${MEMG}GB"
if [ "$CPUS" -lt 2 ] || [ "$MEMG" -lt 4 ]; then
  say "주의: 권장 사양(개인용 2코어·4GB, 직원 몇 명 서비스 4코어·8GB)보다 작아요. 설치는 하지만 질문이 겹치면 느리거나 멈출 수 있어요."
fi
HUBMEM=$(( MEMG / 2 )); [ "$HUBMEM" -ge 1 ] || HUBMEM=1; [ "$HUBMEM" -le 4 ] || HUBMEM=4

# 3) 질문(이미 적은 값은 묻지 않음)
if ! has IEON_INSTALL_KIND; then
  say "쓰임: 1) 서버 설치형 — 이 서버에서만 AI 엔진을 돌림(PC 연결 없음)   2) 허브형 — 이 서버 + 연결한 PC들"
  ask "고르세요" "1"; case "$REPLY" in 2) put IEON_INSTALL_KIND hub;; *) put IEON_INSTALL_KIND server;; esac
fi
if ! has IEON_PORT; then ask "웹 화면 포트" "28770"; put IEON_PORT "$REPLY"; fi
PORT=$(get IEON_PORT)
if ! has IEON_WEB_ALLOW; then
  MYIP=$(printf '%s' "${SSH_CLIENT:-}" | awk '{print $1}')
  say "웹 화면을 열 수 있는 곳(보안): 처음엔 지금 이 서버에 접속한 곳만 열어 두고, 나중에 화면(설정 → 허브 보안)에서 바꿀 수 있어요."
  say "  주소 여러 개는 쉼표로. 어디서나 열려면 all (그래도 관리자 비밀번호는 필요)."
  ask "열어 둘 주소" "${MYIP:-all}"
  [ "$REPLY" = all ] && REPLY='0.0.0.0/0'
  put IEON_WEB_ALLOW "$REPLY"
fi
if ! has IEON_HUB_URL; then
  SIP=$(hostname -I 2>/dev/null | awk '{print $1}')
  say "이 서버의 공개 주소: https 도메인이 있으면 넣으세요(카카오·이어온 앱에 필요). 없으면 Enter — 이 http 주소로도 PC를 연결할 수 있어요(암호화는 안 돼요)."
  ask "공개 주소" "http://${SIP:-127.0.0.1}:${PORT}"; put IEON_HUB_URL "$REPLY"
fi
put IEON_MEM "${HUBMEM}g"; put IEON_PIDS 512; put ENGINE_MEM 1g; put ENGINE_PIDS 256
if ! has OPENAI_API_KEY; then ask_secret "OpenAI API 키(Codex를 API 요금으로 쓸 때 — 구독 로그인은 나중에 화면에서)"; [ -z "$REPLY" ] || put OPENAI_API_KEY "$REPLY"; fi
if ! has ANTHROPIC_API_KEY; then ask_secret "Anthropic API 키(Claude를 API 요금으로 쓸 때 — 구독 로그인은 나중에 화면에서)"; [ -z "$REPLY" ] || put ANTHROPIC_API_KEY "$REPLY"; fi
REPLY=''
chmod 600 "$ENVF"

# 4) 데이터 폴더(컨테이너 사용자 1001만)
$SUDO mkdir -p hub/data engines
$SUDO chown 1001:1001 hub/data engines
$SUDO chmod 700 hub/data

# 5) 빌드·시작 — 처음이면 컨테이너가 처음 설정(내부 토큰·설정 파일)을 스스로 만든다
say "이어온을 빌드하고 시작해요(처음엔 몇 분 걸려요)…"
$DOCKER compose --env-file "$ENVF" -f deploy/server/compose.yaml up -d --build
HUB_C=$(get IEON_CONTAINER); HUB_C=${HUB_C:-ieun-relay}
i=0; until [ "$($DOCKER inspect -f '{{.State.Health.Status}}' "$HUB_C" 2>/dev/null)" = healthy ]; do
  i=$((i + 1)); [ "$i" -le 40 ] || die "시작을 확인하지 못했어요 — 로그: $DOCKER logs $HUB_C"
  sleep 3
done
say "이어온이 켜졌어요."

# 6) 로그인 같이 쓰기(환경 파일의 API 키가 있으면 넣음) + 작업용 엔진 칸(파일 작업·명령은 칸에서)
$SUDO sh deploy/hub/ieun.sh engine share-login
if ! $DOCKER ps -a --format '{{.Names}}' | grep -q '^ieun-engine-'; then
  ask "작업용 엔진 칸(파일 읽기·고치기, 명령은 승인 카드)을 하나 만들까요? (Y/n)" "Y"
  case "$REPLY" in [Nn]*) ;; *) $SUDO sh deploy/hub/ieun.sh engine add main ;; esac
fi

URL=$(get IEON_HUB_URL)
say ""
say "== 설치 끝 =="
say "웹 화면: $URL"
say "  1. 처음 화면에서 관리자 비밀번호를 만드세요(10자 이상)."
say "  2. 설정 → 계정에서 Codex·Claude 로그인(구독은 승인 창에서 승인, API 키는 붙여 넣기) — 한 번이면 모든 칸이 같이 써요."
say "  3. 설정 → 메신저에서 쓸 메신저 봇 토큰을 넣으세요."
say "다시 실행해도 괜찮아요(적은 값·데이터는 그대로). 업데이트: git pull 뒤 같은 명령."
