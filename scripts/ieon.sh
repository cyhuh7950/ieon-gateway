#!/usr/bin/env bash
# 이어온 Linux 실행 도우미(scripts/ieon.ps1의 Linux판). 서버·연결부·공유 App Server·메신저를 백그라운드로 켜고 끄고 상태를 본다.
#   scripts/ieon.sh start [--shared] [--live]   서버·연결부 시작(--shared: 공유 App Server도, --live: 실제 엔진 실행 켬)
#   scripts/ieon.sh stop                        이 스크립트가 띄운 프로세스만 종료하고 live를 끈다
#   scripts/ieon.sh status                      포트·프로세스·엔진 상태·시험 대화 잠금
#   scripts/ieon.sh messenger                   메신저 봇 시작(토큰은 .local 아래 env 파일에서 그 프로세스만 읽는다)
#   scripts/ieon.sh check                       설치 점검: Node·부품·설정 파일, Codex·Claude Code 설치와 로그인(모델 호출 없음)
#   scripts/ieon.sh claude | tui                터미널(tmux 등)에서 직접 실행할 명령을 안내한다
# 설정·토큰은 .local/ 아래에 둔다(git 무시). 토큰 원문은 출력하지 않는다. 모든 포트는 127.0.0.1 전용이다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL="$ROOT/.local"
RUN="$LOCAL/run"
CONNECTOR_CONFIG="$LOCAL/s2/connector.json"
TEST_THREAD='01a18790-63c7-73e3-a60b-6ddb60fd5be8'
mkdir -p "$RUN"

listening() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# Codex 실행 파일: 이어온 폴더 안(플랫폼 패키지)을 먼저, 없으면 PATH의 codex.
codex_bin() {
  local f
  f="$(find "$ROOT/node_modules/@openai" -path '*codex-linux-*' -type f -name codex 2>/dev/null | head -n1 || true)"
  if [[ -n "$f" ]]; then echo "$f"; elif command -v codex >/dev/null 2>&1; then command -v codex; fi
}

set_live() { # $1: true|false
  node -e '
    const fs = require("node:fs"); const p = process.argv[1];
    const c = JSON.parse(fs.readFileSync(p, "utf8")); c.live = process.argv[2] === "true";
    fs.writeFileSync(p, JSON.stringify(c, null, 2));' "$CONNECTOR_CONFIG" "$1"
}
get_live() { node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).live === true)' "$CONNECTOR_CONFIG"; }

pid_alive() { # PID 재사용 방지: 살아 있고 node/codex 프로세스일 때만
  local pid="$1" name
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 1
  name="$(ps -p "$pid" -o comm= 2>/dev/null || true)"
  [[ "$name" == node || "$name" == codex ]]
}

start_owned() { # $1 이름, 나머지: 실행 명령
  local name="$1"; shift
  local pidfile="$RUN/$name.pid"
  if [[ -f "$pidfile" ]] && pid_alive "$(cat "$pidfile")"; then echo "$name: 이미 실행 중"; return; fi
  (cd "$ROOT" && nohup "$@" >"$RUN/$name.out" 2>"$RUN/$name.log" </dev/null & echo $! >"$pidfile")
  echo "$name: 시작(PID $(cat "$pidfile"))"
}

stop_owned() {
  local name="$1" pidfile="$RUN/$1.pid"
  [[ -f "$pidfile" ]] || return 0
  local pid; pid="$(cat "$pidfile")"
  if pid_alive "$pid"; then kill "$pid" && echo "$name: 종료"; fi
  rm -f "$pidfile"
}

cmd="${1:-}"; shift || true
shared=false; live=false
for a in "$@"; do
  case "$a" in
    --shared) shared=true ;;
    --live) live=true ;;
    *) echo "알 수 없는 옵션: $a" >&2; exit 2 ;;
  esac
done

case "$cmd" in
  start)
    if $shared; then
      hash="$(tr -d '\r\n ' <"$LOCAL/x2/token.sha256")"
      bin="$(codex_bin)"
      [[ -n "$bin" ]] || { echo 'Codex 실행 파일을 찾을 수 없습니다(npm install 또는 codex 설치).' >&2; exit 1; }
      start_owned app-server "$bin" app-server --listen ws://127.0.0.1:28761 --ws-auth capability-token --ws-token-sha256 "$hash"
    fi
    # 연결부는 시작할 때만 설정을 읽는다. 이미 돌고 있으면 live를 바꾸지 않는다(바꾸려면 stop 후 start).
    if ! { [[ -f "$RUN/connector.pid" ]] && pid_alive "$(cat "$RUN/connector.pid")"; }; then set_live "$live"; fi
    start_owned server node src/pilot/server.mjs .local/s2/server.json
    sleep 1
    start_owned connector node src/pilot/connector.mjs .local/s2/connector.json
    if [[ "$(get_live)" == true ]]; then l='켬'; else l='끔'; fi
    echo "실제 엔진 실행: $l · 웹: http://127.0.0.1:28760"
    ;;
  stop)
    for n in messenger connector server app-server; do stop_owned "$n"; done
    set_live false
    echo '실제 엔진 실행: 끔'
    ;;
  status)
    for pair in '이어온 서버(28760):28760' '공유 App Server(28761):28761' 'Claude 채널(28762):28762'; do
      if listening "${pair##*:}"; then v=True; else v=False; fi
      printf '%-24s: %s\n' "${pair%:*}" "$v"
    done
    printf '%-24s: %s\n' '실제 엔진 실행' "$(get_live)"
    printf '%-24s: %s\n' '시험 Codex 대화 잠금' "$(node "$ROOT/src/pilot/lock-probe.mjs" "$TEST_THREAD" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).outcome))')"
    ;;
  messenger)
    listening 28760 || { echo '이어온 서버가 꺼져 있습니다. start로 먼저 켜세요.' >&2; exit 1; }
    start_owned messenger node src/pilot/messenger/main.mjs .local/messenger/config.json
    sleep 3
    tail -n 3 "$RUN/messenger.log" || true
    ;;
  claude)
    echo "터미널(tmux 등)에서 직접 실행하세요: cd $LOCAL/c1 && claude --dangerously-load-development-channels server:ieon"
    echo '하단이 manual mode인지 확인하세요.'
    ;;
  tui)
    listening 28761 || { echo '공유 App Server가 꺼져 있습니다. start --shared로 먼저 켜세요.' >&2; exit 1; }
    bin="$(codex_bin)"
    echo "터미널에서 직접 실행하세요: cd $ROOT && IEON_X2_TOKEN=\"\$(tr -d '\\r\\n' <$LOCAL/x2/token)\" $bin resume $TEST_THREAD --remote ws://127.0.0.1:28761 --remote-auth-token-env IEON_X2_TOKEN"
    echo 'Codex 앱에서는 이 대화를 열지 마세요.'
    ;;
  check)
    # 설치·로그인 여부만 본다. 모델 호출·로그인·설정 변경은 하지 않고 계정 이메일·토큰은 출력하지 않는다.
    fail=0
    row() { printf '%-10s %-34s %s\n' "$1" "$2" "$3"; }
    nodev="$(command -v node >/dev/null 2>&1 && node --version || true)"
    if [[ "$nodev" == v24.* ]]; then row OK 'Node.js 24' "$nodev"; else row '확인 필요' 'Node.js 24' "${nodev:-없음} — nodejs.org에서 v24 설치"; fail=1; fi
    if [[ -d "$ROOT/node_modules/@openai/codex-sdk" ]]; then row OK '부품(npm install)' '@openai/codex-sdk 있음'; else row '확인 필요' '부품(npm install)' '없음 — npm install'; fail=1; fi
    missing=()
    for f in s2/server.json s2/connector.json s2/user-token s2/device-token; do [[ -e "$LOCAL/$f" ]] || missing+=("$f"); done
    if ((${#missing[@]} == 0)); then row OK '설정 파일(.local)' '있음'; else row '확인 필요' '설정 파일(.local)' "없음: ${missing[*]}"; fail=1; fi
    codex_ok=false; claude_ok=false
    bin="$(codex_bin)"
    if [[ -n "$bin" ]]; then
      row OK 'Codex 실행 파일' "$("$bin" --version 2>/dev/null | head -n1)"
      if out="$("$bin" login status 2>&1)" && grep -q 'Logged in' <<<"$out"; then
        codex_ok=true; row OK 'Codex 로그인' "$(head -n1 <<<"$out")"
      else
        row '확인 필요' 'Codex 로그인' '로그인 안 됨 — 신산님이 직접 codex login'
      fi
    else
      row '확인 필요' 'Codex 실행 파일' '없음 — npm install 또는 codex 설치'
    fi
    if command -v claude >/dev/null 2>&1; then
      row OK 'Claude Code 설치' "$(claude --version 2>/dev/null | head -n1)"
      st="$(claude auth status 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);console.log(a.loggedIn&&a.authMethod==="claude.ai"&&["pro","max"].includes(a.subscriptionType)?"ok":"no")}catch{console.log("no")}})')"
      if [[ "$st" == ok ]]; then
        claude_ok=true; row OK 'Claude Code 로그인(구독 계정)' '구독 로그인됨'
      else
        row '확인 필요' 'Claude Code 로그인(구독 계정)' '로그인 안 됨 — 터미널에서 claude 실행 후 /login(Pro/Max 구독 계정, API 키 아님)'
      fi
    else
      row '확인 필요' 'Claude Code 설치' 'claude 명령 없음 — npm install -g @anthropic-ai/claude-code'
    fi
    # Linux 전용: 잠금 검사가 읽는 /proc/locks
    if [[ -r /proc/locks ]]; then row OK '잠금 검사(/proc/locks)' '읽을 수 있음'; else row '확인 필요' '잠금 검사(/proc/locks)' '읽을 수 없음 — Codex 번갈아 쓰기 모드는 실행되지 않음'; fi
    echo "Codex 사용: $($codex_ok && echo 가능 || echo 불가) · Claude 사용: $($claude_ok && echo 가능 || echo 불가)"
    if ((fail)) || { ! $codex_ok && ! $claude_ok; }; then
      echo '이어온을 쓰려면 위 "확인 필요" 항목을 처리하세요(엔진은 Codex·Claude 중 하나 이상 필요).'
      exit 1
    fi
    echo '설치 점검 통과.'
    ;;
  *)
    sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
