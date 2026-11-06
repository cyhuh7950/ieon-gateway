# N6 Oracle 배포 계획 (이어온 서버·연결부·Codex)

기준: 2026-11-06. 상태: **O1~O6 완료**(조사·전용 사용자·코드 전달·로그인·유닛 기동·새 Codex 세션 스모크). 서버·연결부가 켜져 있고 live는 꺼짐. O7(메신저·중계 연결)은 별도 결정.

## 1. 결정 (2026-11-06, 신산님: 권장안으로 진행)

| 항목 | 결정 |
| --- | --- |
| 서버 | `sinsan-server`(168.107.4.6, aarch64) — 중계 컨테이너가 이미 있는 서버 |
| 엔진 | **Codex만.** Claude는 서버 구독 로그인의 약관이 불명확하고 토큰 복사가 프로젝트 규칙에 걸려 이번에 제외 |
| 로그인 | 신산님이 서버 SSH 터미널에서 **직접** `codex login --device-auth`. `auth.json`·토큰을 PC에서 서버로 복사하지 않는다. 유료 API 키는 쓰지 않는다 |
| 실행 방식 | Docker가 아니라 직접 실행 + systemd 사용자 유닛(엔진 CLI·작업 폴더가 필요). 웹 화면은 공개하지 않고 SSH 터널(127.0.0.1)로만 |
| 격리 | sudo·docker 권한이 없는 **전용 OS 사용자 `ieon`**으로 실행. 다른 서비스 약 30개의 배포 폴더가 있는 `ubuntu` 계정과 분리 |
| 범위 | Oracle에서 **새로 만든 Codex 세션만**. PC의 기존 세션을 Oracle 서버에 붙이는 하이브리드 구조는 별도 단계 |

- 구독 로그인의 서버 사용: Codex 공식 문서는 원격 서버에는 디바이스 코드 로그인(ChatGPT 보안 설정에서 먼저 켜야 함)을 권장한다. 다만 MANAGED_APP_SERVER_OPTIONS_REVIEW는 구독 로그인이 상용·호스팅 서비스에는 허용되지 않는다고 적고 "개인 PC 성공을 Oracle 운영 허용으로 확대하지 않는다"고 했다. 이번 진행은 1인 개인용이라는 신산님의 판단에 따른다. 약관이 바뀌거나 사용자가 늘면 다시 검토한다.

## 2. O1 읽기 전용 조사 결과 (2026-11-06, 변경 없음)

| 항목 | 결과 |
| --- | --- |
| 계정 | `ubuntu`(UID 1001)는 sudo(비밀번호 없이)·docker 그룹. 다른 사용자는 `opc`(UID 1000)뿐, **`ieon` 없음** |
| 홈 권한 | `/home/ubuntu`는 `drwxr-x---`(750) → `ieon`은 읽을 수 없다. `~/deploy/ieon-gateway/relay`(중계)는 ubuntu 소유로 그대로 둔다 |
| 런타임 | `/usr/local/bin/node` v24.22.1(systemd 기본 PATH에 있음), npm 11.19.1, tmux·git·curl·useradd·loginctl 있음 |
| systemd | 사용자 서비스 동작(`running`), `ubuntu`는 linger 꺼짐. `ieon`용은 `loginctl enable-linger ieon` 필요 |
| 포트 | 호스트 28700~28769 사용 없음(중계는 컨테이너 내부 28770). 이어온 서버는 127.0.0.1:28760만 쓴다 |
| 자원 | 메모리 가용 약 6.4GB, 디스크 26GB 여유(74% 사용), 2 CPU |
| SSH | 비밀번호 로그인 끔, 공개키만(`ubuntu`의 authorized_keys에 키 2개: ed25519·rsa) |
| 네트워크 | 레지스트리 도달, `chatgpt.com` 200, `auth.openai.com` 403(기본 curl 차단으로 보이며 로그인 가능 여부는 O4에서 확인), `api.openai.com` 421(도달) |
| arm64 Codex | `@openai/codex@0.165.0-linux-arm64`(락 파일의 resolved와 일치), 압축 해제 약 400MB. 별도 `@openai/codex-linux-arm64` 이름으로는 조회되지 않음(별칭 패키지라 정상) |

## 3. 단계와 승인 항목

| 단계 | 내용 | 승인 | 모델 호출 | 되돌리기 |
| --- | --- | --- | --- | --- |
| O1 | 위 읽기 전용 조사 | 완료 | 0 | — |
| O2 | `ieon` 사용자 생성, 홈 750, 비밀번호 잠금, 공개키(ubuntu의 authorized_keys 사본) 설치, linger | sudo 쓰기 | 0 | `sudo userdel -r ieon` |
| O3 | 코드 전달(PC에서 묶어 scp, git 자격 증명 두지 않음) → `/home/ieon/deploy/ieon-gateway`, `npm ci`(약 400MB), `ieon.sh init`, 시험 토큰은 그 사용자 `.local`에만 | 서버 쓰기 | 0 | 폴더 삭제 |
| O4 | **신산님 직접** `ssh ieon@…`로 접속해 `codex login --device-auth`, 코드 입력·승인 | 신산님 직접 | 0 | 신산님 `codex logout` |
| O5 | systemd 사용자 유닛 설치·기동(live 꺼짐), `check` | 서버 쓰기·포트 기동(loopback) | 0 | 유닛 disable·삭제 |
| O6 | 새 Codex 세션 스모크: 질문 2회(같은 thread) + 잠금 관찰 + 잠들기 후 1회 | **별도 승인** | 3(제안) | 세션 삭제 |
| O7 | 메신저·중계 연결(PC 메신저는 끔), 웹은 SSH 터널 | **별도 승인** | 필요 시 | 메신저 stop |

### O2 명령 초안 (승인 후)

```bash
sudo useradd -m -s /bin/bash -U ieon            # sudo·docker 그룹에 넣지 않는다
sudo chmod 750 /home/ieon
sudo passwd -l ieon                              # 비밀번호 로그인 잠금(공개키만)
sudo install -d -m 700 -o ieon -g ieon /home/ieon/.ssh
sudo install -m 600 -o ieon -g ieon /home/ubuntu/.ssh/authorized_keys /home/ieon/.ssh/authorized_keys   # 공개키만 복사
sudo loginctl enable-linger ieon
```

- 이후 접속은 이 PC에서 `ssh -o User=ieon sinsan-server`(기존 별칭·키 그대로)로 한다.
- 이어온 폴더는 유닛 파일의 `%h/deploy/ieon-gateway`와 맞춰 `/home/ieon/deploy/ieon-gateway`로 한다.

## 4. 위험과 미확인

- 이 서버의 aarch64에서 Codex가 실제로 실행되는지(O3 뒤 `check`·O6에서 확인).
- 디바이스 코드 로그인이 신산님 계정에서 켜져 있는지(ChatGPT 보안 설정), 서버에서 로그인 URL에 접속 가능한지(O4).
- Codex `read_only`는 쓰기만 막고 읽기는 파일 시스템 전체가 가능하다. 그래서 전용 사용자·홈 750으로 다른 서비스 폴더를 읽지 못하게 한다. `opc`·`root`·다른 서비스 폴더의 권한은 O2 후 `ieon`으로 읽기 시도해 확인한다.
- 메모리는 Node 프로세스 수백 MB 수준 예상이나 다른 서비스와 같은 서버라 O5 후 `free`로 확인한다.
- Claude·하이브리드(PC 기존 세션 연결)·메신저 상시 운영은 이 계획의 범위 밖이다.

## 5. 되돌리기 전체

유닛 `disable`·삭제 → 신산님 `codex logout` → `sudo loginctl disable-linger ieon` → `sudo userdel -r ieon`(홈과 작업 폴더 삭제). 중계 컨테이너·NPM·기존 서비스는 건드리지 않는다.

## 6. O2 결과 (2026-11-06, 모델 호출 0)

- 실행한 sudo 작업: `useradd -m -s /bin/bash -U ieon`(sudo·docker 그룹 없음, `groups: ieon`뿐), 홈 750, `passwd -l`(비밀번호 로그인 잠금), `.ssh` 700과 `authorized_keys` 600(ubuntu의 **공개키** 2개 ed25519·rsa를 복사, 개인키는 건드리지 않음), `loginctl enable-linger ieon`(Linger=yes). UID 1002.
- 확인: `ssh -o User=ieon sinsan-server`로 키 접속 성공(비밀번호 잠금 상태에서도 가능), 홈 `/home/ieon`, `XDG_RUNTIME_DIR=/run/user/1002`, `systemctl --user` running.
- **격리 검증(ieon 계정으로 접근 시도, 내용은 읽지 않고 성공 여부만):** 차단 — `/home/ubuntu`·`/home/ubuntu/deploy`·중계 비밀 파일·ubuntu `.ssh`·`/home/opc`·`/root`·`/etc/shadow`·`docker ps`·docker 소켓·`/var/lib/docker`·`sudo`. **열림 — 로컬 루프백 TCP 연결**(예: 127.0.0.1:5432 `shared-db`). 접속에는 해당 서비스의 계정이 필요하며 `ieon`에는 없다.
- 참고: 다른 사용자의 프로세스 목록이 보인다(324개, 명령줄에 비밀이 있으면 노출될 수 있으나 이 서버의 다른 서비스 소관), `/tmp`에 다른 사용자의 읽기 가능 파일이 1개 있다(내용 확인 안 함).
- 루프백 열림에 대한 판단: Codex 새 세션은 기본 `read_only`·`networkAccessEnabled: false`이고 `full`(명령 실행·네트워크)은 채팅에서 고를 수 없다. 그래서 위험은 낮다고 보고 방화벽(UID별 규칙)은 추가하지 않았다. `full`을 켜게 되면 `ieon` UID의 루프백 접속을 막는 방화벽 규칙을 다시 검토한다.
- 되돌리기: `sudo loginctl disable-linger ieon && sudo userdel -r ieon`.

## 7. O3 결과 (2026-11-06, 모델 호출 0)

- 코드 전달: PC에서 `git archive HEAD`(main `4a76946`, 추적 파일만, `node_modules`·`.local` 제외)를 `ssh -o User=ieon`으로 `/home/ieon/deploy/ieon-gateway`에 풀었다(154개 파일, 2.8MB). 서버에는 git 저장소·자격 증명이 없다.
- `npm ci`: 성공(`exit=0`), node_modules 382MB, 디스크 여유 25GB. arm64 Codex는 `node_modules/@openai/codex-linux-arm64/vendor/aarch64-unknown-linux-musl/bin/codex`(ELF aarch64)이고 `codex --version` → `codex-cli 0.165.0` 실행 확인(네트워크·모델 호출 없음). `node:sqlite`·`@openai/codex-sdk` 로드 확인.
- `ieon.sh init`: `.local/s2/`에 시험 토큰 2개(권한 600, 값은 출력하지 않음)·`server.json`·`connector.json`·`new-sessions.json` 생성(live 꺼짐, 기존 세션 없음, 127.0.0.1 전용).
- `ieon.sh check`: Node 24·부품·설정·Codex 실행 파일·`/proc/locks` OK. **Codex 로그인 안 됨**(O4에서 신산님이 직접), Claude Code 미설치(이번 범위 밖). `status`: 서버·연결부 꺼짐, live false, 프로세스 0개.
- 변경 범위: `/home/ieon`(코드·설정·node_modules·npm 캐시)뿐. 기존 서비스와 `ubuntu` 계정은 건드리지 않았다. 되돌리기: `/home/ieon/deploy` 삭제.
- **O4 안내(신산님 직접):** `ssh -o User=ieon sinsan-server`로 접속해 `cd ~/deploy/ieon-gateway && ./node_modules/@openai/codex-linux-arm64/vendor/aarch64-unknown-linux-musl/bin/codex login --device-auth` 실행 → 화면의 주소와 코드를 신산님 PC 브라우저에서 입력·승인. 먼저 ChatGPT 보안 설정에서 디바이스 코드 로그인을 켜야 한다. 자격 증명은 서버의 `/home/ieon/.codex/`에만 저장된다(PC에서 복사하지 않음).

## 8. O4·O5 결과 (2026-11-06, 모델 호출 0)

- **O4(신산님 직접 로그인):** ChatGPT 보안 화면의 "Codex, Excel, PowerPoint 및 Word의 기기 코드 로그인 활성화" 토글(앱 보안 섹션 맨 아래)을 켜고 서버에서 `codex login --device-auth` 실행·승인. `check`가 "설치 점검 통과", Codex 로그인 `Logged in using ChatGPT`. 인증 파일 `~/.codex/auth.json`은 `-rw-------`, `ubuntu` 계정에서 `/home/ieon/.codex` 접근 **차단**. 이후 토글은 다시 끄도록 안내했다(로그인은 유지됨, 서버 로그인 해제는 보안 화면의 활성 세션에서).
- **O5(유닛 설치·기동):** `ieon-server`·`ieon-connector`를 `/home/ieon/.config/systemd/user`에 설치하고 `enable --now`(linger로 부팅 후 자동 시작). 둘 다 `active`·`enabled`, 서버는 **127.0.0.1:28760만** 바인딩, 웹 `GET /` 200, 토큰 없는 API 401, 사용자 토큰으로 한도 조회 정상, 디바이스 토큰 호출은 401이 아님(인증 통과).
- 자동 재시작: 서버·연결부를 각각 `kill -9`하자 8초 안에 새 PID로 재기동(NRestarts 1). 재시작 뒤에도 `live=false`. 연결부는 기동 직후와 서버가 끊긴 동안 `poll_error ECONNREFUSED`를 재시도하며 남기고 서버가 돌아오면 정상(유닛에 서버 준비 대기는 없고 연결부의 재시도에 맡김).
- 자원: server 62MB, connector 60MB(RSS), 서버 전체 메모리 가용 약 6.3GB 유지. 모델 호출 기록(receipts) 0.
- 메신저 유닛은 만들지 않았다. 되돌리기: `systemctl --user disable --now ieon-connector ieon-server` 후 유닛 파일 삭제.

## 9. O6 결과 — Oracle(aarch64)에서 새 Codex 세션 스모크 (2026-11-06, Codex 모델 호출 3회)

- 준비: `live`를 켜고 연결부를 재시작, 새 세션 `oracle-t1`(read_only) 생성.
- **Q1:** "시험 표식은 자두" → `completed`, 답 "확인". 새 thread `01a1ae97-…` 생성, 작업 폴더 `/home/ieon/ieon-workspaces/oracle-t1`, Codex 기록 파일 1개 생성.
- **Q2(잠금 관찰 동시):** `completed`, 답 "자두"(같은 thread, thread 기록 1개). 질문이 실행되는 약 3.3~6.2초 동안만 `~/.codex/thread-writer-locks/<id>.lock`이 생기고 `/proc/locks`에 **FLOCK ADVISORY WRITE**로 보여 검사가 `WRITER_LOCK_CONFLICT`를 냈고, 끝나자 파일이 사라져 `NO_LOCK_FILE`. WSL과 같은 동작이다(aarch64에서도 flock).
- **Q3(잠들기 후):** `sleeping` → 질문 → 깨어나 "자두"(앞 대화 기억), 상태 `active`, thread 기록 1개 유지.
- 정리: 세션 삭제(`deleted`, 작업 폴더는 기본 설정대로 남김), `live`를 다시 끔(`false`) 후 연결부 재시작, 서버·연결부 `active`, 새 세션 수 0. **호출 횟수(receipts) 3건 = 승인 3회.** 업무 대화는 이 서버에 없어 건드리지 않음.
- 자원: server 66MB, connector 76MB(RSS).
- **남은 것(삭제하지 않음, `ieon` 홈 안):** 작업 폴더 `/home/ieon/ieon-workspaces/oracle-t1`(빈 폴더), Codex 기록 파일 `~/.codex/sessions/2026/11/06/rollout-2026-11-06T11-02-26-01a1ae97-….jsonl`. 사용자 `ieon`을 지우면 함께 사라진다.
- 모델 호출은 신산님의 ChatGPT 구독 계정(서버에 로그인한 것)에 잡혔다.
- **미확인:** Oracle에서 Claude, 메신저·중계 연결(O7), PC의 기존 세션을 Oracle 서버에 붙이는 하이브리드, 사람이 연 Codex Desktop·TUI가 실제로 잠글 때의 검사.

## 10. O7 계획 — 하이브리드(PC 기존 세션 연결)와 메신저 이전 (2026-11-06, 계획만, 변경 없음)

### 목표 구조

```
메신저(텔레그램·디스코드·슬랙·카카오 중계)
        │
   Oracle: 이어온 서버·메신저(ieon 사용자, systemd) ── 새 세션: Oracle 연결부(Codex)
        ▲ 127.0.0.1:28760 (SSH 터널로만)
        │ PC가 먼저 접속(터널 포트 28765)
   PC: 연결부만 실행 ── 기존 Codex 대화·Claude 채널 세션
```

- 봇이 Oracle에서 상시 동작하므로 PC가 꺼져도 Oracle 세션은 응답한다. PC 세션은 기존처럼 "PC 연결 끊김"으로 보인다.
- 서버는 이미 기기 여러 대(`devices`: 기기마다 `hostId`·토큰 해시)와 세션 등록별 `hostId`를 지원한다. 새 세션은 `newSessionsHostId`로 Oracle 기기에 고정한다.

### 단계 (모두 별도 승인)

| 단계 | 내용 | 모델 호출 | 되돌리기 |
| --- | --- | --- | --- |
| H1 | PC에서 Oracle용 기기 토큰 새로 생성(`.local/s2/device-token-oracle`, 원문은 PC에만). **해시만** Oracle `server.json`에 기기 `h_pc`로 추가하고 PC 세션 2개를 `hostId: h_pc`로 등록, `newSessionsHostId: h_sinsan` 고정, Oracle 서버 재시작 | 0 | server.json 되돌리고 재시작 |
| H2 | PC에 `ieon.ps1 tunnel`(SSH `-N -L 28765:127.0.0.1:28760`, PID 관리)과 Oracle용 연결부 설정(`connector-oracle.json`, 서버 주소 `127.0.0.1:28765`)·`start -Oracle` 모드 추가(코드·테스트는 저장소에서, 로컬 서버와 동시에 켜지 않게 막음) | 0 | 코드 PR 되돌리기 |
| H3 | 시험: Oracle API에서 PC 세션이 `deviceOnline=true`로 보이는지(모델 0), PC의 Codex 시험 thread에 질문 2회(번갈아 쓰기, Desktop에서 열지 않음) | Codex 2 | 터널·연결부 stop |
| O7-1 | Oracle 메신저 설정: 허용 사용자 ID(비밀 아님)와 `kakaoRelayUrl`을 설정 파일에 넣고, **봇 토큰·중계 토큰은 신산님이 직접** Oracle `ieon` 홈의 env 파일에 넣는다(제가 읽거나 복사하지 않음) | 0 | 파일 삭제 |
| O7-2 | PC 서버 DB의 봇·역할 정의(이름·부르는 이름·역할, 비밀 없음)를 API로 읽어 Oracle 서버에 다시 등록 | 0 | 봇 삭제 |
| O7-3 | **카카오 먼저 전환:** PC 메신저 stop(같은 중계를 두 곳에서 폴링하면 질문이 갈라진다) → Oracle 메신저 기동(카카오만) → `/whoami`·`/sessions`(Oracle+PC 세션이 함께 보임)·Oracle 세션 질문 1회 | Codex 1~2 | Oracle 메신저 stop, PC 메신저 start |
| O7-4 | 텔레그램·디스코드·슬랙 전환: 신산님이 Oracle env 파일에 봇 토큰을 넣고 PC 메신저를 끈 뒤 Oracle 메신저 재기동. 방별 연결(`rooms.json`)은 복사하거나 `/use`로 다시 연결 | 0~1 | 동일 |
| O7-5 | systemd `ieon-messenger` 유닛 설치·자동 재시작 확인, PC의 env에서 봇 토큰 제거(신산님), PC `messenger` 명령에 Oracle 모드일 때 경고 추가 | 0 | 유닛 삭제 |

제안 모델 호출 총량: **Codex 5회 이내**(H3 2 + O7-3 2 + 여유 1), Claude 0.

### 위험과 결정 사항

- **질문·답변 본문이 Oracle DB에 저장된다**(서버 `requests` 표). 위치는 `ieon` 홈(권한 750, 다른 서비스 계정은 읽기 불가). 지금은 PC 서버 DB에만 있다. 삭제하면 해당 세션의 본문이 지워지는 기능이 있다.
- **Oracle 서버가 PC 실행의 제어 지점이 된다.** 서버가 뚫리면 PC 연결부의 허용 목록(allowlist) 안에서만 질문이 들어간다. PC Codex는 읽기 전용·승인 없음·네트워크 차단으로 고정이라 영향이 작다. 허용 목록은 지금처럼 시험 세션만 둔다.
- **터널 의존:** Windows의 SSH 터널이 끊기면 PC 세션이 오프라인으로 보이고 연결부가 재시도한다. Oracle 세션은 영향이 없다.
- **봇 토큰 위치가 PC에서 Oracle로 옮겨간다.** 두 곳에 동시에 두지 않는다(텔레그램은 같은 토큰의 동시 수신을 거부하고 슬랙·디스코드는 중복 응답이 난다).
- 로컬 서버·웹은 PC에서 지금처럼 쓸 수 있다(로컬 모드). Oracle 모드와 동시에 켜지 않는다.
- 결정: (1) H→O7 순서(권장), (2) 카카오 먼저, (3) 본문 Oracle 저장 허용, (4) 토큰은 신산님이 직접 Oracle에 입력.

## 11. H1 결과 (2026-11-06, 모델 호출 0)

- PC: Oracle용 기기 토큰을 새로 만들었다(`.local/s2/device-token-oracle`, 64자, git 제외, **원문은 PC에만** 있고 출력·복사하지 않음).
- Oracle `~/deploy/ieon-gateway/.local/s2/server.json`: 변경 전 백업 `server.json.bak-h1`. 병합한 것은 기기 `h_pc`의 **토큰 해시(sha256)**, PC 세션 2개(`c_codex_test`·`c_claude_test`, `hostId: h_pc`, 기존 `appIds`·`sessionRef` 그대로), `newSessionsHostId: h_sinsan`(새 세션은 Oracle 기기에 고정). 기기 목록은 `h_sinsan`(Oracle)·`h_pc`.
- Oracle 서버 재시작 후: 서버·연결부 `active`, 세션 목록에 PC 세션 2개가 `deviceOnline=false`로 보임(PC 미연결이라 정상), 새 세션 한도·수 정상(0개), 기기 API는 무토큰·틀린 토큰 모두 401, 연결부 로그에 PC 세션 작업 시도 없음, receipts 3(변화 없음)·`live=false`.
- 되돌리기: Oracle에서 `server.json.bak-h1`을 `server.json`으로 복구하고 서버 재시작, PC의 `device-token-oracle` 삭제.
- 다음: H2(PC `tunnel`·Oracle용 연결부 설정·`start -Oracle` 모드, 저장소 코드·테스트), H3(PC 연결 확인과 PC 시험 thread 질문 2회).
