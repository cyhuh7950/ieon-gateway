#!/bin/sh
# SV1 엔진 칸 관리(서버에서 한 번 명령 — 허브 컨테이너에 Docker 제어권을 주지 않기 위해 서버 쪽에서만).
# 위치: ~/deploy/ieon-gateway 에서 실행.  사용:
#   sh deploy/hub/ieun.sh engine add <이름>       칸 만들기 → 허브에서 1회용 초대 받기 → 띄우기 → 허브와 자동 짝짓기(목록에 "서버 · <이름>")
#   sh deploy/hub/ieun.sh engine remove <이름>    칸 끄고 지우기(데이터 폴더는 남김 — 지우려면 직접)
#   sh deploy/hub/ieun.sh engine list             칸 목록·상태
#   sh deploy/hub/ieun.sh engine tui <이름> [codex 대화 ID]   그 칸의 Codex CLI를 사람이 직접 열기(같은 대화 이력)
# 초대·토큰 값은 화면에 나오지 않는다(허브 컨테이너 → 칸 데이터 폴더 파일로 바로, 권한 600).
set -eu
cd "$(dirname "$0")/../.."
cmd="${1:-}"; sub="${2:-}"; name="${3:-}"
die() { echo "$*" >&2; exit 1; }
check_name() { echo "$1" | grep -Eq '^[a-z0-9][a-z0-9-]{0,19}$' || die "이름은 영문 소문자·숫자·- 로 1~20자(예: law, tax-1)"; }

[ "$cmd" = engine ] || die "사용: sh deploy/hub/ieun.sh engine add|remove|list|tui ..."
case "$sub" in
  add)
    check_name "$name"
    [ -d "engines/$name/data" ] && [ -f "engines/$name/data/.local/s2/hub/hub.json" ] && die "이미 있는 칸: $name (다시 띄우려면 docker start ieun-engine-$name)"
    mkdir -p "engines/$name/data"
    chown 1001:1001 "engines/$name" "engines/$name/data" 2>/dev/null || true
    chmod 700 "engines/$name/data"
    # 허브에서 1회용 초대(10분)를 받아 칸 데이터 폴더에 바로 넣는다(화면에 출력하지 않음)
    umask 077
    docker exec ieun-relay node src/hub/invite.mjs /data > "engines/$name/data/invite" || { rm -f "engines/$name/data/invite"; die "허브에서 초대를 받지 못했어요(허브가 켜져 있는지 확인)"; }
    chown 1001:1001 "engines/$name/data/invite" 2>/dev/null || true
    ENGINE_NAME="$name" ENGINE_LABEL="서버 · $name" docker compose -f deploy/hub/engine.compose.yaml up -d
    echo "칸 '$name'을 띄웠어요. 잠시 뒤 허브 화면 목록에 '서버 · $name'으로 나와요(허브 화면에서 이 칸의 Codex 로그인·AI 응답·허용 목록을 정해요)."
    ;;
  remove)
    check_name "$name"
    ENGINE_NAME="$name" docker compose -f deploy/hub/engine.compose.yaml down
    echo "칸 '$name'을 껐어요. 데이터(engines/$name/data — 엔진 로그인·대화 이력)는 남겨 뒀어요. 허브 화면 기기 목록에서 이 칸을 끊을 수 있어요."
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
  *) die "사용: sh deploy/hub/ieun.sh engine add|remove|list|tui ..." ;;
esac
