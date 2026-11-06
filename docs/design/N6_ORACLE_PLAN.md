# N6 Oracle 배포 계획 (이어온 서버·연결부·Codex)

기준: 2026-11-06. 상태: **계획과 O1 읽기 전용 조사만 완료. 서버에는 아무것도 만들거나 바꾸지 않았다.** O2부터는 단계마다 신산님 승인 후 진행한다.

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
