# N6 Oracle 배포 계획 (이어온 서버·연결부·Codex)

기준: 2026-11-06. 상태: **O1~O5 완료**(조사·전용 사용자·코드 전달·로그인·유닛 기동). 서버·연결부가 켜져 있고 live는 꺼짐. **O6(모델 호출)부터는 별도 승인.**

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
