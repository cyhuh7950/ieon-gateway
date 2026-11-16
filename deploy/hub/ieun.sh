#!/bin/sh
# SV1 엔진 칸 관리(서버에서 한 번 명령 — 허브 컨테이너에 Docker 제어권을 주지 않기 위해 서버 쪽에서만).
# 위치: ~/deploy/ieon-gateway 에서 실행.  사용:
#   sh deploy/hub/ieun.sh engine add <이름>       칸 만들기 → 허브에서 1회용 초대 받기 → 띄우기 → 허브와 자동 짝짓기(목록에 "서버 · <이름>")
#   sh deploy/hub/ieun.sh engine remove <이름>    칸 끄고 지우기(데이터 폴더는 남김 — 지우려면 직접)
#   sh deploy/hub/ieun.sh engine list             칸 목록·상태
#   sh deploy/hub/ieun.sh engine tui <이름> [codex 대화 ID]   그 칸의 Codex CLI를 사람이 직접 열기(같은 대화 이력)
#   sh deploy/hub/ieun.sh engine claude <이름> [새 세션 이름]   그 칸의 Claude Code를 사람이 직접 열기(서버 Claude 로그인, 세션 이름이면 이어서)
# 초대·토큰 값은 화면에 나오지 않는다(허브 컨테이너 → 칸 데이터 폴더 파일로 바로, 권한 600).
set -eu
cd "$(dirname "$0")/../.."
cmd="${1:-}"; sub="${2:-}"; name="${3:-}"
die() { echo "$*" >&2; exit 1; }
check_name() { echo "$1" | grep -Eq '^[a-z0-9][a-z0-9-]{0,19}$' || die "이름은 영문 소문자·숫자·- 로 1~20자(예: law, tax-1)"; }

# 허브의 Codex 로그인 파일을 "같이 쓰는 폴더"(hub/data/shared-auth/codex)로 옮기고, 허브는 그 파일을 가리키게 한다(처음 한 번).
# 칸들은 그 폴더만 붙여 같은 파일을 쓴다(허브 대화 이력은 칸에 보이지 않음). 파일 내용은 읽거나 출력하지 않는다.
# 설치 때 한 번: 이 폴더의 환경 파일(.env)에 OPENAI_API_KEY=... 를 적어 두면, 허브가 아직 Codex에 로그인 전일 때 그 키로 로그인한다.
# 키는 표준 입력으로만 넘기고 화면·로그에 내지 않는다. 이미 로그인돼 있으면(구독 로그인 등) 바꾸지 않는다 — 바꾸려면 허브 화면 계정 칸에서.
api_key_login() {
  [ -f .env ] || return 0
  [ -e hub/data/shared-auth/codex/auth.json ] && return 0
  [ -e hub/data/codex/auth.json ] && return 0
  key=$(sed -n 's/^OPENAI_API_KEY=//p' .env | head -1 | tr -d '"\r')
  [ -n "$key" ] || return 0
  if printf '%s\n' "$key" | docker exec -i ieun-relay node /app/node_modules/@openai/codex/bin/codex.js login --with-api-key >/dev/null 2>&1; then echo "환경 파일의 API 키로 허브 Codex에 로그인했어요(모든 칸이 같이 써요)."; else echo "환경 파일의 API 키로 로그인하지 못했어요 — 키를 확인하세요." >&2; fi
  key=''
}

# SV2: 환경 파일에 ANTHROPIC_API_KEY=... 가 있고 서버 Claude 로그인이 아직 없으면 그 키를 같이 쓰는 폴더에 넣는다(모든 칸이 같이 씀).
# 값은 화면·로그에 내지 않는다. 이미 로그인돼 있으면(구독 등) 바꾸지 않는다 — 바꾸려면 허브 화면 계정 칸에서.
claude_key_login() {
  d=hub/data/shared-auth/claude
  mkdir -p "$d"; chown 1001:1001 "$d" 2>/dev/null || true; chmod 700 "$d"
  [ -f .env ] || return 0
  { [ -s "$d/oauth-token" ] || [ -s "$d/api-key" ]; } && return 0
  k=$(sed -n 's/^ANTHROPIC_API_KEY=//p' .env | head -1 | tr -d '"\r')
  [ -n "$k" ] || return 0
  (umask 077; printf '%s\n' "$k" > "$d/api-key"); chown 1001:1001 "$d/api-key" 2>/dev/null || true
  k=''
  echo "환경 파일의 Claude API 키를 서버 Claude 로그인으로 넣었어요(모든 칸이 같이 써요)."
}

share_login() {
  api_key_login
  claude_key_login
  mkdir -p hub/data/shared-auth/codex
  chown 1001:1001 hub/data/shared-auth hub/data/shared-auth/codex 2>/dev/null || true
  chmod 700 hub/data/shared-auth hub/data/shared-auth/codex
  if [ -f hub/data/codex/auth.json ] && [ ! -L hub/data/codex/auth.json ] && [ ! -e hub/data/shared-auth/codex/auth.json ]; then
    mv hub/data/codex/auth.json hub/data/shared-auth/codex/auth.json
  fi
  if [ -e hub/data/shared-auth/codex/auth.json ] && [ ! -e hub/data/codex/auth.json ]; then
    ln -s ../shared-auth/codex/auth.json hub/data/codex/auth.json
    chown -h 1001:1001 hub/data/codex/auth.json 2>/dev/null || true
  fi
  [ -e hub/data/shared-auth/codex/auth.json ] || echo "주의: 허브가 아직 Codex에 로그인돼 있지 않아요 — 허브 화면(설정 → 허브 보안·Codex)에서 한 번 로그인하면 모든 칸이 같이 써요."
}

[ "$cmd" = engine ] || die "사용: sh deploy/hub/ieun.sh engine add|remove|list|tui ..."
case "$sub" in
  add)
    check_name "$name"
    [ -d "engines/$name/data" ] && [ -f "engines/$name/data/.local/s2/hub/hub.json" ] && die "이미 있는 칸: $name (다시 띄우려면 docker start ieun-engine-$name)"
    share_login
    mkdir -p "engines/$name/data"
    chown 1001:1001 "engines/$name" "engines/$name/data" 2>/dev/null || true
    chmod 700 "engines/$name/data"
    # 허브에서 1회용 초대(10분)를 받아 칸 데이터 폴더에 바로 넣는다(화면에 출력하지 않음)
    umask 077
    docker exec ieun-relay node src/hub/invite.mjs /data > "engines/$name/data/invite" || { rm -f "engines/$name/data/invite"; die "허브에서 초대를 받지 못했어요(허브가 켜져 있는지 확인)"; }
    chown 1001:1001 "engines/$name/data/invite" 2>/dev/null || true
    ENGINE_NAME="$name" ENGINE_LABEL="서버 · $name" docker compose -f deploy/hub/engine.compose.yaml up -d
    echo "칸 '$name'을 띄웠어요. 허브의 Codex 로그인을 같이 써서 따로 로그인하지 않아도 돼요. 잠시 뒤 허브 화면 목록에 '서버 · $name'으로 나와요."
    ;;
  remove)
    check_name "$name"
    ENGINE_NAME="$name" docker compose -f deploy/hub/engine.compose.yaml down
    echo "칸 '$name'을 껐어요. 데이터(engines/$name/data — 엔진 로그인·대화 이력)는 남겨 뒀어요. 허브 화면 기기 목록에서 이 칸을 끊을 수 있어요."
    ;;
  share-login)
    share_login; echo "허브 로그인을 칸들이 같이 쓰도록 맞췄어요."
    ;;
  list)
    docker ps -a --filter "name=ieun-engine-" --format '{{.Names}}\t{{.Status}}'
    ;;
  tui)
    check_name "$name"
    shift 3 || true
    if [ "${1:-}" ]; then docker exec -it "ieun-engine-$name" node node_modules/@openai/codex/bin/codex.js resume "$1"
    else docker exec -it "ieun-engine-$name" node node_modules/@openai/codex/bin/codex.js; fi
    ;;
  claude)
    # SV2: 그 칸의 Claude Code를 사람이 직접(같이 쓰는 서버 Claude 로그인). 새 세션 이름을 주면 그 작업 폴더의 마지막 세션을 이어서(--continue).
    # 이어온이 그 세션에 질문을 보내는 중에는 열지 않는다(동시에 쓰면 Claude가 복사본을 만들고 이어온은 결과 불명으로 잠금).
    check_name "$name"
    shift 3 || true
    sess="${1:-}"
    [ -z "$sess" ] || echo "$sess" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9-]{0,31}$' || die "세션 이름이 맞지 않아요"
    docker exec -it -e "IEON_SESS=$sess" "ieun-engine-$name" sh -c 'if [ -s /shared/claude/api-key ]; then ANTHROPIC_API_KEY=$(cat /shared/claude/api-key); export ANTHROPIC_API_KEY; elif [ -s /shared/claude/oauth-token ]; then CLAUDE_CODE_OAUTH_TOKEN=$(cat /shared/claude/oauth-token); export CLAUDE_CODE_OAUTH_TOKEN; fi; if [ -n "$IEON_SESS" ]; then cd "/data/workspaces/$IEON_SESS" && exec claude --continue; else mkdir -p /data/workspaces && cd /data/workspaces && exec claude; fi'
    ;;
  *) die "사용: sh deploy/hub/ieun.sh engine add|remove|list|tui ..." ;;
esac
