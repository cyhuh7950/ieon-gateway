# 이어온 개발환경

## 1. 상태와 정본

- 기준 시각: 2026-10-29 14:18 +09:00ST
- 책임자: 어울 / 현재 채팅의 단일 작성자
- 프로젝트: `ieon-gateway` / 서비스명: `이어온` / 목적: 에이전트 세션 연결 서비스
- 문서 상태: 읽기 전용 조사 결과를 반영한 초기 인수 문서. 환경 준비·개발·배포 완료 판정이 아니며 미확정 항목을 아래에 명시한다.
- Git 단계: `DEVELOPMENT_PRIVATE`
- 로컬 정본 지정 경로: `D:\Project\ieon-gateway`
- 시작 패킷 기준: `D:\Project\PMO\docs\DEVELOPMENT_ENVIRONMENT_STARTUP_GUIDE.md`
- 관련 기록: [작업현황](WORK_STATUS.md)
- 새 사실·변경·오류·확인 결과는 발생 직후 이 문서와 작업현황에 누적한다. 실행 전 branch·commit·서비스·DB 등 동적 정보를 재확인한다. Secret 원문은 기록하지 않는다.
- 조사 시작 시 프로젝트 AGENTS·설계서·개발 작업계획서는 없었다. 이번 요청에서 임의 작성·승인 또는 제품 구현을 수행하지 않는다.

## 2. Git과 단계

| 항목 | 사용자 지정 계약 | 실제 확인 상태 |
| --- | --- | --- |
| 개발 저장소(현재) | `https://github.com/cyhuh7950/ieon-gateway` / private | 2026-11-05 버전 0.0.1부터. main 최종본만 단일 커밋으로 이전(PR·이력 제외), 이후 수정·upgrade는 여기서 한다 |
| 이전 개발 저장소(폐쇄 대상) | `https://github.com/sinsan-develop/ieon-gateway` / private | 사용자 비공개 전환 완료 통보. 전환 후 비인증 API 404·소유자 SSH 읽기 성공으로 공개 비노출 확인. `private` 필드 직접 조회는 현재 CLI 권한으로 불가 |
| 개발 SSH URL(현재) | `git@github-cyhuh7950:cyhuh7950/ieon-gateway.git` | `cyhuh7950` identity(`~/.ssh/id_ed25519_github_cyhuh7950`) |
| 이전 개발 SSH URL | `git@github-sinsan-develop:sinsan-develop/ieon-gateway.git` | `sinsan-develop` identity로 최초 private main push·WSL clone 성공 |
| 개발 remote | `origin` | 로컬·WSL fetch/push 모두 개발 SSH URL. main이 origin/main 추적 |
| 공식 owner | `cyhuh428-sinsan` | 현재 CLI 로그인·공식 SSH 실제 인증 identity와 일치 |
| 공식 저장소 | `https://github.com/cyhuh428-sinsan/ieon-gateway` | 현재 존재·`private:true`·owner admin/push 가능. 독립 README 기준선 `f07db77a1138601625b88fb58928e729cdb209ce` 생성 |
| 공식 SSH URL | `git@github-cyhuh428:cyhuh428-sinsan/ieon-gateway.git` | identity 인증 성공. 기존 빈 refs 상태에 공식 README main을 독립 생성 |
| release remote | `release` | 로컬 fetch URL은 공식 SSH URL. push URL은 `DISABLED_DURING_DEVELOPMENT_PRIVATE`로 비활성, 기본 push remote는 origin |
| 현재 branch / main / commit | 실제 조회 결과를 사용 | 로컬·WSL main·origin/main 최초 기준선 `ee1c1287f6e46c5847bda5818d4508f522dc0a58` 일치 확인. 구성 결과 기록 commit 후 재동기화 |
| 현재 단계 | `DEVELOPMENT_PRIVATE` | 사용자 지정, RC 전환 없음 |

`DEVELOPMENT_PRIVATE`의 Stage 흐름은 branch → 필수 검증 → private PR → private main 병합 → WSL smoke → branch와 임시 작업공간 정리다. 공식 저장소에 push하거나 private history를 노출하지 않는다.

`OFFICIAL_RC_UAT`는 개발계획과 WSL 검증 완료 후 공식 main에서 별도 clean checkout·RC branch를 만든다. private checkout의 remote 교체·이력 push를 금지하고, 확정 allowlist 파일만 전달한다. private commit → 공식 RC commit → image/artifact 대응 증거를 남긴다. 공식 RC PR은 인수 승인 전 병합하지 않는다. Oracle 배포·재배포·환경 변경은 정확한 후보와 rollback을 제시한 뒤 신산님 별도 명시적 승인을 받는다.

`OFFICIAL_RELEASED`는 인수 승인 후 공식 main 병합·재배포·smoke·정본 전환·RC 정리를 수행한다. private 전체 refs 백업·복원 검증 후 폐쇄 준비 상태를 보고하며 실제 저장소·계정 삭제는 별도 지시 사항이다.

신산님의 최신 직접 지시로 최초 Git 기준선을 구성한다. 최초 main 생성과 구성 결과 기록에 한정한 bootstrap이며 이후 일반 개발의 main 직접 수정·커밋 금지는 유지한다. 공식 main의 독립 README 기준선에는 private 개발 commit·문서를 포함하지 않는다. DNS는 추후 생성 지시로 보류한다.

## 3. 서버와 SSH

다음 값은 `ssh -G` 실제 조회 결과다. IdentityFile은 참조 경로만 기록하고 개인키 원문을 읽거나 복사하지 않는다.

| SSH alias | HostName / Port / User | IdentityFile | 역할과 지정 경로 |
| --- | --- | --- | --- |
| `github-cyhuh7950` | `github.com` / `22` / `git` | `~/.ssh/id_ed25519_github_cyhuh7950` | 현재 개발 Git(0.0.1~), `IdentitiesOnly yes` |
| `github-sinsan-develop` | `github.com` / `22` / `git` | `~/.ssh/sinsan-develop` | 이전 개발 Git(폐쇄 대상), `IdentitiesOnly yes` |
| `github-cyhuh428` | `github.com` / `22` / `git` | `~/.ssh/id_ed25519_github_cyhuh428-sinsan` | 공식 release Git, `IdentitiesOnly yes` |
| `WSL-server` | `172.27.253.53` / `22` / `daon` | `C:\Users\cyhuh\.ssh\WSL_server.key` | 개발·자체 테스트 `~/deploy/ieon-gateway` |
| `ysna-server` | `161.33.20.13` / `22` / `ubuntu` | `C:\Users\cyhuh\.ssh\ssh-key-ysna-server.key` | Oracle staging `~/deploy/ieon-gateway` |

`WSL-server` 접속 결과는 hostname `SINSAN`, user `daon`, home `/home/daon`이며 `/home/daon/deploy/ieon-gateway`에 private main을 Git clone했다. origin과 exact commit·clean 상태를 확인했다. 개발·테스트 지정 경로이며 별도 QA 하위 경로는 아직 없다. `ysna-server`는 hostname `ysna-server`, user `ubuntu`, home `/home/ubuntu`이며 `/home/ubuntu/deploy/ieon-gateway`는 존재하지 않는다. 기존 SSH·credential·host key 설정은 변경하지 않았다. `StrictHostKeyChecking=yes`, `BatchMode=yes`, 연결 timeout을 지정해 비대화형 확인했다.

## 4. 사용자 URL·서비스·Docker

- 사용자 확인 호스트: `ieon-gateway.sinsan.kr` — 신산님이 A `161.33.20.13`·DNS 전용·자동 TTL을 설정한 화면을 제공했다. 후속 로컬 DNS와 1.1.1.1 조회 모두 같은 IP를 확인했다. 최초 이름 해석 실패는 이 확인으로 대체한다. TLS·HTTP·health·서비스 배포는 별도 미검증이다.
- 로컬 port: 이어온 서버 `28760`, 공유 App Server `28761`, Claude 채널 `28762`(2026-10-31 신산님 지시로 ieon-agent의 18760~18762와 분리). WSL·Oracle service port는 미확정이며 임의 번호를 지정하거나 기존 서비스를 재사용하지 않는다.
- service / 실행 entrypoint / Compose 파일·project / container / image digest / network / volume / reverse proxy: 확인된 프로젝트 설정이 없다. source·manifest·프로젝트 Docker 자원이 없으므로 미확정이다.
- health / ready endpoint: 미확정. URL 응답만으로 프로젝트 health 또는 기능 완료로 판정하지 않는다.
- 두 서버에서 이름에 `ieon`이 포함된 container·network·volume과 Compose project가 모두 0개임을 확인했다. 이는 해당 이름 범위의 조회 결과이며 다른 이름·공유 자원의 전체 부재를 뜻하지 않는다.
- WSL에는 `.gitignore`와 내부 문서 2개를 private Git으로 수령했다. 제품 manifest·Compose·`.env`는 없다. Oracle 지정 폴더도 없으므로 실제 이어온 배포 service·port를 확정할 근거가 없다.

## 5. Database·migration

- DB 종류·버전·이름·schema·user·접속 방식·container·권한: 미확정.
- migration 도구·현재 revision·적용·rollback 명령·seed·QA 자료 정리·backup/restore: 미확정.
- 공유 DB가 발견되어도 이어온 DB로 임의 지정하지 않는다. DB 접속 문자열과 password 원문을 출력하지 않으며 DDL/DML·migration을 실행하지 않는다.

## 6. Runtime·설정·Secret

- 로컬 확인된 실행 파일: Git `C:\Program Files\Git\cmd\git.exe` 2.53.0.windows.2, GitHub CLI `C:\Program Files\GitHub CLI\gh.exe` 2.96.0, SSH `C:\Windows\System32\OpenSSH\ssh.exe`, Node `C:\Program Files\nodejs\node.exe` v24.22.1, npm `C:\Program Files\nodejs\npm.ps1` 11.19.1, Python `C:\Users\cyhuh\AppData\Local\Python\bin\python.exe` 3.14.3, uv `C:\Users\cyhuh\AppData\Local\hermes\bin\uv.exe` 0.11.2.
- 이는 로컬 설치 도구의 존재 정보이며 제품 기술 스택 선택·버전 고정이 아니다. Docker CLI는 이번 PATH 조회에서 확인되지 않았다.
- 제품 runtime / package manager / lockfile / 의존성 설치 명령: source와 승인 설계가 없어 미확정.
- WSL 설치 현황: Linux WSL2 x86_64, Git `/usr/bin/git` 2.43.0, Python `/usr/bin/python3` 3.12.3, Node `/usr/local/bin/node` v24.22.1, npm `/usr/local/bin/npm` 11.19.1, pnpm `/usr/local/bin/pnpm` 12.15.0, Docker `/usr/bin/docker` client/server 29.1.3.
- Oracle 설치 현황: Linux Oracle aarch64, Git `/usr/bin/git` 2.43.0, Python `/usr/bin/python3` 3.12.3, Node `/usr/local/bin/node` v26.12.1, npm `/usr/local/bin/npm` 12.2.1, Docker `/usr/bin/docker` client/server 29.6.1. `/usr/local/bin/pnpm`의 버전 조회는 OSError로 실패했으며 수정하지 않았다.
- 아키텍처는 WSL `x86_64`, staging `aarch64`로 다르다. RC image/artifact 방식을 결정할 때 대상 아키텍처·manifest digest·실행 image digest·WSL 검증 대응을 확정해야 한다. 현재 image와 검증 증거는 없다.
- 필요한 환경변수 이름·안전 기본값·최초 설정 질문: 미확정. 추측 이름을 만들지 않는다.
- 로컬 `.env`: 조사 시작 시 없었다. Secret이 실제로 필요한 시점에 비추적·접근 권한·입력 변수·주입 방식을 확정한다.
- WSL·staging Secret 주입 위치·소유자·권한·rotation: 미확정. 로컬 `.env`를 자동 복사하지 않는다.

## 7. 명령과 검증

| 목적 | 실제 사용 가능한 명령 또는 상태 |
| --- | --- |
| SSH 설정 조회 | `ssh -G WSL-server`, `ssh -G ysna-server` 확인 완료 |
| 서버 접속 확인 | `ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 WSL-server "hostname; whoami; pwd"` — 접속 확인 완료. 같은 옵션의 `ysna-server`도 접속 확인 완료 |
| 개발 refs 확인 | `git ls-remote --heads git@github-sinsan-develop:sinsan-develop/ieon-gateway.git main` — 최초 main push 후 실시간 SHA 재확인 |
| 공식 기준선 확인 | `gh api repos/cyhuh428-sinsan/ieon-gateway/commits/main` — 독립 `f07db77a1138601625b88fb58928e729cdb209ce`·parents 0개·README.md 단일 파일 확인 |
| 프로젝트 Docker 조회 | `docker ps -a --filter name=ieon`, `docker network ls --filter name=ieon`, `docker volume ls --filter name=ieon`, `docker compose ls --all --format json`의 `ieon` project 필터 — 두 서버 모두 대상 0개 |
| DNS 확인 | `Resolve-DnsName -Name ieon-gateway.sinsan.kr -Type A -DnsOnly` 및 `-Server 1.1.1.1` — 모두 `161.33.20.13` 확인 |
| WSL Git 갱신 | `git -C /home/daon/deploy/ieon-gateway fetch origin main`, clean·원격 SHA 확인 후 `git -C /home/daon/deploy/ieon-gateway merge --ff-only origin/main`. Windows source 복사·archive 전달은 하지 않는다. |
| build / typecheck / lint / unit / integration / smoke | 미확정. manifest·script·entrypoint 확인 전 명령을 꾸며내지 않는다. |
| deploy / health / ready / rollback / migration | 미확정. 이번 요청은 조사·문서화이며 배포·재시작·데이터 변경은 실행하지 않는다. |

## 8. 공식 RC 배포 allowlist와 비추적

- 구체적인 배포 파일 allowlist: 미확정. 현재 제품 파일이 없어 실제 경로 목록을 승인된 것으로 작성할 수 없다. 빈 allowlist 상태에서는 공식 저장소에 전달할 파일이 없다.
- 최초 저장소 구성의 별도 승인 범위에서 공식 main의 `README.md` 한 파일만 독립 생성했다. 이는 제품 배포 allowlist 확정이나 private 개발 파일·history 반영이 아니다.
- 확정 전에는 공식 push·RC 동기화·image 공개를 수행하지 않는다. 파일 복사에는 private `.git`·history·전체 디렉터리 mirror·bundle을 포함하지 않는다.
- 공식 저장소 제외 대상: 내부 설계서, `docs/WORK_PLAN.md`, `docs/WORK_STATUS.md`, 이 내부 개발환경 문서, 테스트·fixture·QA·검증자료, 임시자료, 로그, Secret, 실제 `.env`와 민감 설정 파일. allowlist 제외뿐 아니라 공식 Git 비추적 여부를 확인한다.
- private 저장소에서는 설계·계획·작업현황·개발환경·테스트·내부 검증 이력을 추적한다. 공식용 제외 규칙을 private 문서·테스트 전체 ignore로 대체하지 않는다.
- `.gitignore`만으로 이미 추적된 파일·과거 history가 제거되지는 않는다. 공식 main 기준 새 RC에서 허용 파일 집합과 Secret 검사·private commit 비포함을 검증해야 한다.
- 대응 기록의 보관 위치는 private 내부 기록이다. 공식 RC metadata에는 private 내부 문서·history를 복사하지 않는다.

## 9. 임시 자원·정리

- 이번 승인으로 생성한 영구 문서는 `docs/WORK_STATUS.md`, `docs/DEVELOPMENT_ENVIRONMENT.md`다. 기존 파일을 덮어쓰지 않는다.
- 임시 runtime·port·process·DB·container·network·volume·clone은 생성하지 않았다.
- 향후 임시 checkout·QA 자료는 PMO의 `D:\tmp` 원칙과 실행 환경 권한을 확인한 뒤 이름·이유·수명·정리 명령을 생성 전에 보고한다.

## 미확정 항목의 확인 책임·시점

| 항목 | 확인 책임·방법 | 필요한 시점 |
| --- | --- | --- |
| 공식 저장소·최초 기준선 | 최신 직접 지시로 정확한 저장소의 private 상태·README 독립 root commit을 확인 | 구성 확인 완료. 공식 RC 전환은 별도 |
| 개발 main·로컬/WSL Git | 최초 private main push와 WSL clone·SHA 일치 확인. 구성 결과 기록 후 final SHA를 재대조 | 최초 Git 구성 마무리 |
| 제품 기능·stack·package manager | 신산님 요구사항 인터뷰 후 어울이 대안과 권장안 제시, 설계·계획 승인 | 구현 전 |
| 공통 port·service·Compose·image | stack 결정 후 어울이 세 환경 점유와 아키텍처를 조회하고 후보를 제시해 확정 | 최초 실행·배포 전 |
| DB·migration·QA·backup/restore | 데이터 요구사항·승인 설계 후 어울이 도구·전용 이름·접속·명령을 확정 | DB 자원 생성·schema 변경 전 |
| 환경변수·Secret 주입 위치 | 실제 구현이 요구하는 변수 이름과 비밀 참조만 어울이 정리. 사용자 소유 실제 비밀값만 지정 위치에 입력 요청 | 해당 연동·실행 전 |
| build/test/deploy/health/rollback | 실제 source·manifest·entrypoint·배포 계획에서 어울이 확인하고 검증 결과 기록 | 명령 실행 전 |
| DNS·proxy·TLS | 어울이 staging 대상과 변경 영향을 제시하고 필요한 변경 승인 후 구성·검증 | 사용자 URL 제공 전 |
| 배포 allowlist | 실제 제품 파일·runtime dependency·설정 경계를 어울이 목록화하고 검토·확정 | 공식 RC에 파일 반영 전 |

이 항목들은 빈칸을 추측값으로 채운 설정이 아니다. 현재 미확정 사실과 재개 조건이며, 공유 자원·인증·DB·비용·배포 경계는 기존 별도 승인 원칙을 유지한다.

## 10. 변경 이력

### 2026-10-29 13:21 KST — 최초 Git 구성 지시 수용

- 신산님이 공식 저장소·개발 main/commit·로컬/WSL Git 최초 구성을 승인했다. 공식은 private 저장소에 개발과 독립된 README 기준선만 생성한다. private 개발 history는 전달하지 않는다.
- DNS는 사용자 지정 후속 항목으로 남긴다. 나머지 미확정 설정은 사용 장면·요구사항 인터뷰 후 확정하며 실제 값을 즉시 기록한다.
- 생성 대상은 지정된 로컬·WSL Git과 Secret 제외용 `.gitignore`, 두 저장소의 초기 기준선이다. 기존 문서는 보존하고 임시 runtime·DB·배포 자원은 생성하지 않는다.
- 공식 저장소 생성 요청은 HTTP 422 `name already exists on this account`로 실패했다. 기존 404와 상충하므로 미생성 단정을 보류하고 현재 owner·API·SSH 결과를 재확인한다. 무조건 재시도·대체 저장소 생성은 하지 않는다.
- 후속 재조회는 공식 저장소 존재·`private:true`·owner admin/push 가능·기본 branch 이름 main·SSH refs 0개를 확인했다. 기존 같은 저장소를 보존해 초기 README 기준선만 생성한다. 최초 생성 주체는 추측하지 않는다.
- 로컬·WSL의 기존 Git 작성자와 WSL 개발 SSH 접근을 확인했다. 인증 key·credential은 변경하지 않으며 `.gitignore`의 Secret 제외와 private 내부 문서 정상 추적을 적용한다.
- 공식 독립 README main `f07db77a1138601625b88fb58928e729cdb209ce`와 로컬 `.git`·main·origin/release 참조를 생성했다. release push 비활성 표식을 적용했다. private 최초 commit·push·WSL clone은 이어서 수행한다.
- private 최초 main `ee1c1287f6e46c5847bda5818d4508f522dc0a58`을 생성하고 origin에 push해 upstream을 연결했다. `.gitignore`와 내부 문서 2개만 추적하며 Secret 제외·diff check를 확인했다. WSL은 이 commit을 공식 개발 경로에 Git clone한다.
- WSL이 같은 exact commit을 clone하고 main 상태를 확인했다. 마지막 remote 출력 명령만 1회 실패해 명령 전달 형식과 실제 Git 상태를 확인한다. clone을 재실행하거나 자료를 삭제하지 않는다.
- 신산님이 DNS A `ieon-gateway.sinsan.kr` → `161.33.20.13`의 설정 화면을 제공했다. DNS 전용·자동 TTL 설정 증거를 수용하며 실제 이름 해석·TLS·HTTP는 별도 조회한다.

### 2026-10-29 13:07 KST

- 사용자 지정 프로젝트·Git 3단계·SSH alias를 수용하고 PMO 시작 패킷 기준으로 문서를 생성했다.
- 실제 로컬 root는 존재하지만 비어 있고 Git과 프로젝트 정본 문서가 없음을 확인했다. 임의 init·clone·main 생성은 하지 않았다.
- SSH alias 4개의 endpoint·user·identity 참조가 전달 내용과 일치함을 확인했다. 서버 접속과 원격 상태는 확인 중이다.

### 2026-10-29 — 실행 제한·개발 저장소 public 확인

- 기본 실행 환경의 API·Git shell·SSH 접근 제한을 확인하고 읽기 전용 확장 실행으로 재확인했다. credential·SSH 설정 변경은 없다.
- 개발 저장소 API 결과는 `private:false`, 기본 branch 이름 `main`, size `0`, 마지막 push 시각 `2026-10-29T03:55:20Z`다. 실제 main ref·commit은 추가 확인 대상이다.
- 현재 GitHub CLI identity에 개발 저장소 pull 권한만 있고 push/admin 권한은 없다. 공식 저장소 API는 HTTP 404다.
- 공개 상태는 사용자 지정 `DEVELOPMENT_PRIVATE` 계약과 불일치하므로 Git 반영·private history 전달을 진행하지 않는다. 권장 조치는 개발 저장소 비공개 전환과 재검증이다. 두 문서의 로컬 작성·읽기 전용 조사는 계속한다.

### 2026-10-29 — SSH 서버 실제 경로 확인

- GitHub CLI 로그인은 `cyhuh428-sinsan`이다. 공식 저장소 404는 해당 owner 계정으로 조회한 결과다.
- WSL `/home/daon/deploy/ieon-gateway` 존재, Oracle `/home/ubuntu/deploy/ieon-gateway` 부재를 확인했다. path 부재를 수정하거나 staging 자원을 생성하지 않는다.
- 개발 저장소 비공개 전환을 위한 사용자 조치를 요청했으며, Git 작업은 보류하고 독립 환경 조사를 계속한다.

### 2026-10-29 — 서버 runtime·Docker 조사

- WSL 빈 폴더·Git/manifest/Compose/`.env` 부재를 확인했다. 두 서버의 `ieon` 이름 자원과 Compose project는 0개다.
- 설치 도구 버전과 WSL x86_64 / Oracle aarch64 차이를 기록했다. Oracle pnpm 버전 실행 OSError는 미해결 참고 사항이며 제품 dependency·실행 장애로 단정하지 않는다.
- 공개 저장소의 열람·복제 위험을 설명했으며, 공개 개발 허용을 받은 것은 아니다. `DEVELOPMENT_PRIVATE` 계약은 유지한다.

### 2026-10-29 13:15 KST — 비공개 전환·최종 조사 결과

- 신산님이 개발 저장소 비공개 전환 완료를 통보했다. 비인증 API 404, 현재 CLI API 404, 소유자 SSH 읽기 exit 0·전체 refs 0개를 확인했다. 최초 public 불일치는 사용자 조치로 해소된 것으로 기록하며 `private:true` 필드 직접 조회 불가 한계는 보존한다.
- SSH 실제 identity는 개발 `sinsan-develop`, 공식 `cyhuh428-sinsan`이다. 공식 owner API 404·SSH Repository not found가 함께 확인되어 URL/저장소 준비 상태의 사용자 확인이 필요하다.
- 개발 원격은 전체 refs 0개이며 로컬·WSL도 Git 미구성이므로 branch/main/commit을 추측하지 않는다. 최초 Git 구성을 임의 실행하지 않았다.
- 사용자 URL은 DNS 이름 해석 실패로 HTTP/TLS/health 미검증이다. Docker·DB·설정·staging 배포 변경은 없다.
- 확인된 로컬 runtime 버전과 미확정 항목별 책임·확인 방법·시점을 보완했다. 본 문서는 환경 조사 결과이며 실행 가능한 환경·제품 검증 완료 증거가 아니다.

### 2026-10-29 — 공식 저장소 미생성 사용자 확인·문서 대조

- 신산님이 공식 저장소는 아직 생성하지 않았다고 답했다. owner·공식 URL 지정은 유지하며 미생성 상태로 기록한다. 현재 생성·push·공식 RC 전환은 수행하지 않는다.
- 필수 항목 대조 누락 0, 요청 문서 외 파일 0, 문서 연결 정상, 알려진 Secret 원문 패턴 0을 확인했다. 환경 준비·제품 테스트·보안 감사 완료를 뜻하지 않는다.

### 2026-10-29 13:26 KST — Git·DNS 확인과 설계 인터뷰 전환

- private main 최초 기준선·로컬/WSL exact commit·clean 상태와 origin URL을 확인했다. 공식 main은 독립 root·README 한 파일이므로 private history를 포함하지 않는다. 기존 404·빈 원격 상태는 현재 확인으로 대체한다.
- WSL 원격 주소 출력 오류 1회는 PowerShell 파이프 말미 CRLF(검사 hex 말미 `0d0a`)로 원인을 확인했다. 입력 파이프 없이 read-only 조회로 정상화했으며 clone을 반복하지 않았다.
- DNS 로컬/1.1.1.1 모두 `161.33.20.13`을 확인했다. DNS 설정은 신산님이 수행했다. proxy/TLS/배포 변경은 없다.
- 서비스 목적과 상세 요구사항은 작업현황에 기록하고 설계 인터뷰를 시작했다. Codex 기존 대화 재사용과 API 새 지속 대화를 임의 혼용하지 않는다. port·DB·환경변수·실행 명령·최종 allowlist는 설계 선택에 맞춰 확정한다.
- 설계 확인 전 운영 배포·유료 모델 호출·키 등록·보안 설정 변경은 금지한다. 이번 Git bootstrap에서 추가 key·credential을 만들거나 복사하지 않았으며 유료 호출·제품 실행은 없다.

## 11. 설계 산출물 작성 중 실제 확인·승인 경계

- 문서 작업 branch: docs/existing-codex-design. 기준 private main/WSL main은 e0b21c47cc126bfeeeaede1d2ac0248a24ab0422다. 설계 초안은 branch에 보존하고 main 통합·배포·WSL 제품 실행은 하지 않는다.
- SINSAN Windows: Codex 데스크톱 OpenAI.Codex 26.1023.6123.0, 앱 동봉 엔진 0.165.0-alpha.1.2, npm CLI 0.161.0. 데스크톱 동봉 경로는 설치 메타데이터에서 확인했으며 기존 auth 원문은 읽지 않았다. 버전·도움말 조사만 했고 thread/turn을 실행하지 않았다.
- 현재 사용 인증은 신산님 직접 확인한 ChatGPT 구독 로그인이다. API 키는 별도 경로로 설계하며 실제 키 등록·전환·API 과금 호출은 하지 않았다. 구독 한도 도달 시 유료 API 자동 전환을 금지한다.
- Oracle snapshot: CPU aarch64/4개, RAM 23972 MiB·조회 시 available 17869 MiB, root 197316 MiB 중 available 26055 MiB·87% 사용. proxy는 nginx-proxy-manager(jc21/nginx-proxy-manager:latest), host 80·81·443 게시다. source/DB/proxy/firewall/TLS는 변경하지 않았다.
- (당시 기록, 현재 로컬 port는 28760) 서비스 port 후보 18760은 Windows listen 0개, WSL·Oracle ss listen 결과 없음으로 확인했다. 후보 조사이며 port 예약·bind·공개·설정이 아니다. 실제 서비스·Compose·DB·환경변수·build/test/deploy/rollback은 제품 source가 없으므로 미구성/미확정 상태를 유지한다.
- 첫 실증은 기존 thread의 데스크톱→이어온→데스크톱 연속성과 busy·중복 방지를 먼저 확인한다. 나머지 제품 구성은 실증 결과·한계를 본 뒤 확정한다. WORK_PLAN의 src/tests/DB/실행 명령은 예정 변경이며 실제 파일·실행 결과가 아니다.
- 시안 경로: docs/design/assets/continuity-v1.html 및 상태별 HTML/CSS. continuity-viewport.js는 모바일 입력 영역 가시성만 보조하며 API·model·보관 기능이 없다. 연결·프로젝트·thread 값은 모두 예시다.
- 브라우저: ego-browser 검토 공간 1개에서 로컬 file URL만 사용했다. 프리뷰 서버·process·port를 만들지 않았다. 실제 글꼴은 Noto Sans KR fallback으로 확인했다.
- 모바일 QA: 430×844에서 40단락 마지막 줄 y474.8~500.7, composer 시작 y551.7로 겹침 없음. 430×500 viewport 축소에서 입력 하단366.5·전송 하단425.3이 가시 하단500 안에 있었다. 이는 키보드 높이 시뮬레이션이며 실제 휴대전화 OS IME/물리기기는 UNVERIFIED다.
- 최초 정적 검사 exit2 warning은 개선 항목을 낸 것이며 제품/화면 전체 PASS가 아니다. 사용자 지정 3항목 외 글자크기·기타 터치·삭제 식별자 안내·모바일 로그아웃은 EXCLUDED 미해결로 보존한다.
- 공식 배포 allowlist에는 내부 문서·설계 시안·.impeccable·검증 증거를 포함하지 않는다. 실제 배포 파일 목록은 실증 후 별도 확정하며 이번 작업에서 공식 repository에 추가 push하지 않는다.
### 공식 경로에서의 설계 산출물 검토

- 현재 공식 로컬 checkout은 docs/existing-codex-design이다. 설계 checkpoint는 78416a7a65a3a61957f0f6b1cdbd50b5b984932f이고 origin의 같은 branch에 보존돼 있다. 이번 후속 기록 commit 이후 HEAD는 git rev-parse HEAD로 확인한다.
- private main/WSL main e0b21c47cc126bfeeeaede1d2ac0248a24ab0422, 공식 README 기준선 f07db77a1138601625b88fb58928e729cdb209ce와 분리한다. 실제 제품·Oracle·Secret·보안/DB 설정은 변경하지 않았다.
- 시안·설계 파일은 공식 root의 docs/design, 첫 실증 계획은 docs/WORK_PLAN.md다. 정적 예시 표시와 모바일 검증 receipt를 포함한다. 실제 휴대전화 키보드·실제 기존 Codex 대화 이어쓰기는 UNVERIFIED다.
- 검토용 임시 스크립트와 내부 임시 작업공간은 정리·부재 확인했다. 프리뷰 서버·port·container·DB는 생성하지 않았다. 브라우저 결과 탭은 공식 경로 시안 하나만 남겼다.
## 2026-10-29 S0 실제 로컬 연결 조사

- 현재 Git 단계 DEVELOPMENT_PRIVATE. 작업 branch는 docs/existing-codex-design, 조사 시작 HEAD 6f0091d1f62f9b6c0f57f51b3155d3a7894821ae. private main/WSL main·공식 README main은 변경하지 않았다.
- 설치 동봉 엔진 0.165.0-alpha.1.2의 proxy 도움말과 버전 일치 JSON schema 생성만 사용했다. 제품 의존성 설치·업데이트·설정 변경은 없다.
- 기존 control socket 엔트리 C:\Users\cyhuh\.codex\app-server-control\app-server-control.sock 접속은 OS 10061(connection refused). 기록 daemon PID 21016은 생존하지 않으며 socket 존재가 현재 Desktop 연결 가능성을 뜻하지 않는다.
- 현재 엔진 PID 21356(app-server, 명시 --listen 없음)·34344는 조회 전후 유지. 기본 stdio 경로라는 문서 근거와 별개로 해당 Desktop runtime의 외부 연결 endpoint는 미확인이다. 데스크톱/daemon을 재시작하지 않았다.
- 안전 조회 명령: 동봉 codex.exe app-server proxy --sock <기존 local socket>. 조사 스크립트는 initialize → initialized → thread/loaded/list만 구성한다. 연결 거부로 initialize 성공·ID 목록 조회·상태 관찰 모두 미확인이다.
- 실행/재현: 해당 엔진으로 app-server generate-json-schema --out <본 작업 QA 경로> 후 node src/pilot/inspect.mjs <동봉 exe> <기존 socket> <승인 thread UUID> <schema/ServerNotification.json> <안전 receipt 경로>. 새 listener·daemon·환경변수·Secret 주입은 필요하지 않다. 재실행은 원인/연결 조건이 바뀐 경우에만 검토한다.
- 이번에 확인한 환경변수/Secret 추가 이름 없음. 실제 서비스 port·DB·Compose·build/deploy/health/migration/rollback 명령은 기존 문서의 미확정 상태를 유지한다. 이는 조사 script가 제품 실행/배포 명령을 대신한다는 뜻이 아니다.
- 검증 명령: node --test tests/pilot/inspect.test.mjs, node --check src/pilot/app-server-transport.mjs, node --check src/pilot/inspect.mjs. 모델 없는 안전 검사이며 실제 연결 성공은 아니다.
- 상세 판정·본문 미조회 근거·동시성/급종료 미검증: docs/validation/FEASIBILITY.md. auth/config 내용·대화 원문·raw stderr는 기록하지 않았다.
### S0 조사 checkpoint와 정리
- private branch checkpoint 7e9cda74a531f75847414c6ee2b9a03882c34b05, origin exact ref 확인. 공식 로컬 정본에서 같은 branch를 제공한다. main/WSL/공식 이력은 이번 작업에서 변경하지 않았다.
- S0 생성 schema·QA 임시자료와 proxy child는 정리했고 잔류 없음 확인. 보고서·schema fingerprint·정제 receipt·안전 조회 source만 private에 보존한다. 서비스 process·port·DB·환경변수/Secret·배포 변경 없음.

## 2026-10-29 14:49 KST — 현재 Windows Desktop runtime 연결 경로

- 직접 범위: 공식 연결 지원 조사만. 제품 source/test 변경·실제 이어쓰기·새 서버/daemon·Desktop 재시작·설정/인증 변경 없음.
- 실제 앱 부모 PID19212(ChatGPT.exe) → PID21356(app-server, analytics flag)·PID34344(exec-server --remote/--environment-id). 후자는 대화 runtime 공유를 뜻하지 않는다. 명령행 원문·옵션 값은 기록하지 않았다.
- 설치 application-network-startup-DMyt3FBI.js SHA-256 c4497beb1a68f4322acd6ec2fd1a44c06c24025b115b12324aefae5569849e9d. 로컬 shared daemon socket 분기는 Windows를 제외하고, Windows는 child stdio를 사용한다. 현재 프로세스 구성과 일치한다.
- 기존 Unix socket을 현재 Windows Desktop의 endpoint로 채택하지 않는다. 생성 주체는 미확인이다. 소켓·daemon 기록을 삭제하지 않았고 proxy를 재실행하지 않았다. 읽기 전용 daemon version 1회는 exit1(명령 내부 IPC 시도 여부 미확인).
- 별도 App Server/기본 CLI의 저장 이력 접근은 동일 runtime 연결 증거가 아니다. 같은 실행 상태를 주장하려면 실제 Desktop 소유 endpoint·runtime·thread 상태 대조가 필요하다.
- 공식 Desktop Remote Control은 first-party 승인 기기 경로가 문서화됐으나 이어온용 공개 client API는 확인하지 못했다. 비공개 daemon 관련 환경변수를 적용하지 않는다. 신규 환경변수/Secret 등록·port 공개 없음.
- 결과·근거·지원 문의 항목·재시작/설정 변경 영향: docs/validation/WINDOWS_DESKTOP_CONNECTION_PATH.md, 정제 설치 증거 s0-desktop-path-evidence.json. 새로운 배포/실행 명령을 제품 명령으로 확정하지 않았다.
## 2026-10-29 15:05 KST — 전송 형식과 조사 코드의 미확인 계약

- 현재 앱·engine 역할·공급 모듈 hash는 이전과 같다. Desktop child stdio는 JSONL/newline이고 daemon Unix socket 경로는 WebSocket이다. 현재 Windows Desktop의 해당 shared daemon 분기는 제외된다.
- 기존 src/pilot 조사 코드는 proxy stdin/stdout의 JSONL만 구현한다. 자체 HTTP Upgrade/WebSocket frame 처리는 없고 동봉 proxy 도움말은 변환 계약을 명시하지 않는다. 해당 경로의 전송 호환은 미확인이다. 기존 실행/재현 명령을 공식 Desktop 접속 경로로 재사용하지 않는다.
- 버전 일치 schema와 논리 메시지 대역 검사는 실제 transport 검증이 아니다. 이전 OS10061은 handshake 전 연결 실패이며 protocol PASS/FAIL을 뜻하지 않는다.
- 이번 socket/daemon-version/daemon-start/새 App Server/listener/설정 변경/시험질문 0회. 기존 source/tests 변경·실행 없음. proxy --help와 공급 코드 정적 대조만 수행했다.
- Desktop 재시작·listener 추가·설정 변경이 필요하다는 결론은 아직 없다. 필요성이 공식 경로로 확인될 때 대상/중단 영향/수명/인증/원래 상태/사용자 변경 보존/정확한 종료·복원을 먼저 보고한다. 상세는 WINDOWS_DESKTOP_CONNECTION_PATH.md 6절.
## 2026-10-29 15:11 KST — 정확한 공식 버전 proxy 변환 여부 확정

- 공식 tag rust-v0.165.0-alpha.1.2 → tag object3237dd94e20d69fbb5b424baec89833901ff835e → commit720fec862a608ae1e5878d1eecb04fb93192e93c. 이 commit의 소스만 메모리로 읽었다.
- cli/src/main.rs:1486은 codex_stdio_to_uds::run 호출. stdio-to-uds/src/lib.rs:20·26은 tokio::io::copy로 byte relay. JSONL↔WebSocket 변환 없음. 같은 버전 control socket은 WebSocket handshake를 수행한다.
- 기존 조사 코드 JSONL 직결은 이 WebSocket control 경로에 부적합하다. 과거 실행 예시를 재사용하지 않는다. 코드 수정/실제 접속/서버 기동은 이번 범위 밖이다.
- 현재 Desktop runtime의 공식 외부 attach는 여전히 미확인. 전송 코드 결론과 runtime 공유 지원을 구분한다. source 분석이 설치 binary의 재현 build 검증은 아니다.
- 환경변수/Secret/port/listener/daemon/앱 설정 변경 없음. 상세 근거는 WINDOWS_DESKTOP_CONNECTION_PATH.md 7절과 s0-proxy-source-evidence.json. 이전 전송 변환 미확인 기록은 이 확정 판정으로 갱신한다.
## 2026-10-29 15:20 KST — stdio와 같은 프로세스의 Remote Control 경로

- 정확한 official commit720fec...의 stdio 선택은 추가 Unix/WebSocket listener를 시작하지 않는다. 직접 local attach는 검토 source에서 미발견이다.
- 같은 lib.rs는 stdio 선택 뒤 동일 transport_event_tx/state/auth를 Remote Control 보조 transport에 전달한다. RemoteControl peer 이벤트가 같은 App Server 처리 경로로 들어간다. source상 조건부 경로 존재를 확인했으며 실제 현재 Desktop에서의 활성/접속 성공은 미확인이다.
- 이 경로는 별도 Daemon::from_environment/start가 관리하는 서버와 구분한다. daemon을 시작해 기존 Desktop stdio가 전환된다는 근거는 없다.
- Remote Control relay의 ChatGPT 인증/보관 선호/정책/state DB·peer 승인 조건과 ephemeral enable 분기를 확인했다. 실제 설정/계정/인증/활성 상태는 읽거나 변경하지 않았다. 새로운 환경변수/Secret/port/연결 명령은 확정하지 않는다.
- 현재 stdio가 종료되면 해당 Remote Control shutdown도 취소되는 source 경로를 확인했다. 강제 종료/복구는 시험하지 않았다.
- 상세: WINDOWS_DESKTOP_CONNECTION_PATH.md 8절, s0-stdio-runtime-source-evidence.json. 현재 Desktop/이어온 client 공식 지원은 미확인. source/test/daemon/listener/Oracle 변경 없음.
## 2026-10-29 15:28 KST — Remote Control 비활성·보류와 별도 App Server 대안

- 현재 Desktop Remote Control 비활성: 신산님 직접 확인. runtime/config 재조회는 하지 않았다.
- 공식 공개 문서는 first-party 기기 pairing/managed client 흐름이다. 외부 앱용 등록/인증/접속 계약은 미확인으로 Remote Control 보류. 일반 Sign in with ChatGPT 앱 등록을 Remote Control 접속 권한으로 간주하지 않는다.
- 별도 SINSAN App Server/stdin-stdout 대안은 문서 계약 검토만. 실행 주체는 기존 Desktop과 별도이고 credential/state 격리·기존 thread 접근·교대 반영·동시 실행 차단을 먼저 검토한다. Desktop 인증 cache 재사용은 채택하지 않는다.
- 신규 service/process/port/daemon/listener/CODEX_HOME/환경변수/Secret·인증 등록/배포 설정 생성 없음. 실제 실행/기동 명령을 아직 확정하지 않는다. Oracle 운영 인증 허용 범위는 별도 확인하며 local prototype 가능성을 hosted 허용으로 확대하지 않는다.
- 최신 문서 REMOTE_CONTROL_PUBLIC_CLIENT_AND_STANDALONE.md, s0-remote-control-public-client-evidence.json. 내부 protocol 조사/모방·기능 활성화·소켓·질문·모델·source/test 변경 없음.

## 2026-10-29 15:46 KST — 인증/원래 thread/교대 두 조건 source 판정

- 대상은 신산님이 제안서용으로 지정한 어울 전용 작업 지시 세션, thread01a0dadd-739f-74d2-93c5-9c405cc1019b. 실제 metadata/body/active/모델/저장 경로는 조회하지 않았다. 현재 개발 대화의 실제 이어쓰기 허용으로 확대하지 않는다.
- 공식 같은 계정 새 로그인은 auth 원문 추출/복사와 다르다. source상 cli_auth_credentials_store=ephemeral의 메모리 저장·persistent fallback 배제를 확인했다. 기존 CODEX_HOME의 기록/잠금 root를 유지하고 인증만 child 메모리에 격리하는 방안은 제안이며 실제 옵션/env/로그인은 적용하지 않았다.
- source상 CODEX_HOME/thread-writer-locks/thread-id.lock에 OS File.try_lock을 사용하고 충돌은 store Conflict로 변환한다. 실제 두 실행 주체가 같은 physical root/호환 구현을 쓰는지 확인 전에는 Windows runtime PASS로 보고하지 않는다.
- writer 정상 shutdown/반납 후 fresh resume는 저장 revision·최신 history를 로드한다. turn 완료/idle만으로 반납이 아니므로 Desktop 안전 unload가 입증되지 않으면 첫 실증은 정상 종료·재실행 조건을 제안한다. 다른 작업 영향 승인이 필요하다.
- 제안: P0 검증용 모델0·공식 로그인1·이어온 resume최대2, P1은 이후 별도 승인 사용자3turn. 모델/토큰/내부 inference 호출·사용량을 추측하지 않는다. 신규 callback listener/runner/원본 데이터 백업 범위는 제안서 gate에서 확정하며 아직 생성하지 않았다.
- 문서 AUTH_RESUME_AND_ALTERNATION_ASSESSMENT.md, source 증거 s0-auth-resume-handoff-evidence.json. source/test/원본/credential/runtime/기동/설정/port/Oracle 변경 없음.

## 2026-10-29 16:00 KST — P0 승인 전 대상 metadata·종료 영향 확인

- Codex 앱 목록 metadata에서 thread01a0dadd-739f-74d2-93c5-9c405cc1019b의 실제 제목 어울 전용 작업 지시 세션, host local, cwd D:\Project\PMO, status idle을 확인했다. 본문/turn/summary는 사용·저장하지 않았다. live loaded/OS writer/goal·queued/모델/실제 history 경로는 미확인이다.
- 목록 snapshot에 다른 active 최소4개와 현재 조사 대화가 있다. 전체 Desktop 종료는 이 작업들에도 영향을 줄 수 있어 실행하지 않았다. 전체 종료가 꼭 필요한지는 미확인이다. 앱에서 특정 대화만 즉시 안전 unload하는 공개 UI 경로도 확인하지 못했다.
- 설치 공급 main JS의 SHA256는9a4d60010bcceb6310ef6a357cae924db06df1babe3c4dd91310da2b5f39cf1f. 자동 inactive unsubscribe의 TTL10800000ms(3시간)/비활성 owner상한10 조건이 있으나 실제 대상 적용/구독 해제/잠금 반납은 확인하지 않았다. App Server의 유효 thread_unload_delay는 미조회이며 시간 경과만으로 인계를 보장하지 않는다.
- 프로세스 metadata 재확인: Desktop19212→AppServer21356, listener/proxy/daemon 없음, exec-server34344는 별도 역할. 새 process/listener/daemon/로그인/설정/port 변경 없음.
- 대상 한정 원래 이력·필요 종속 파일/metadata·checksum manifest와 일관 백업을 제안했다. 실제 저장 형식·파일 목록은 미조회다. CODEX_HOME/공유 DB 전체·auth.json/keyring/토큰/쿠키/API 키 복사·복원은 채택하지 않는다. 백업 이후 사용자 변경·다른 대화·진행 중 외부 실행은 대상 백업으로 되감지 않는다.
- 로그인/P0/P1 미승인·미실행. 단독 unload/종료 영향·다른 작업 완료·원본 백업 명세·독립 runner/도구 억제 조건을 검토한 뒤 후속 승인 범위를 확정한다. 상세는 AUTH_RESUME_AND_ALTERNATION_ASSESSMENT.md8절과 s0-p0-preflight-evidence.json.

## 2026-10-29 16:20 KST — 앱 유지 P0 사전 검사 실제 결과

- 앱 전체 종료 없는 P0와 P0 통과 시 최대3turn P1이 후속 승인됐다. 공식 로그인은 사용자 직접 수행이다. 대상 lock 충돌 시 즉시 중단/재시도 금지 조건을 적용한다.
- 환경변수 CODEX_HOME 미설정, C:\Users\cyhuh\.codex는 link/junction 아님을 확인했다. 파일 metadata 조회에서 대상 history1개(6398769byte), 기존 lock 및 state_5.sqlite 존재를 확인했다. 이력/DB/auth/config 내용은 미조회다. engine --version은0.165.0-alpha.1.2이며 home arg0 bootstrap access-denied 경고가 있어 반복하지 않았다.
- 기존 C:\Users\cyhuh\.codex\thread-writer-locks\01a0dadd-739f-74d2-93c5-9c405cc1019b.lock에 GENERIC_READ/OPEN_EXISTING·shared nonblocking LockFileEx1회 → ERROR_LOCK_VIOLATION33. 쓰기/생성/삭제 없이 handle 닫힘. 어느 프로세스가 잠금을 보유하는지는 미확인이다.
- P0는 사전 충돌로 중단했고 실제 App Server 기동/로그인/thread resume/모델 turn/P1/재시도는0회다. 앱 종료·다른 작업 중단·원본 덮어쓰기·백업/DB/auth 복사·유료 API·설정/port/daemon 변경 없음. 새 실행 명령/서비스 구성이 확정된 것이 아니다.
- 증거 p0-lock-precheck-20261029.json과 판정서9절. 충돌을 강제로 풀거나 별도 state root/새 thread로 우회하지 않는다. 새 직접 지시 전 자동 재확인하지 않는다.

## 2026-10-29 16:23 KST — 잠금 파일 사용 프로세스 읽기 전용 대조

- 후속 직접 지시로 Restart Manager GetList1회가 lock 파일 사용자로 codex PID21356 하나를 반환했다. 진단 세션 EndSession0, Shutdown/Restart 호출없음. 같은 LockFileEx 검사 반복/lock 파일 삭제 없음.
- CIM 대조:21356 부모19212/ChatGPT.exe, App Server 실행 파일은 기존08d187884f2330d1/codex.exe, listener/proxy/daemon없음. Desktop App Server가 유력한 잠금 owner라는 대조 추론이며 byte-range owner API 직접 응답은 아니다.
- 단독 즉시 정상 unload 공개 UI는 미확인, 전체 종료가 필요하면 사용자 직접 정상 Quit. 종료 전 독립 실행 절차가 필요하고 현재 runner 미구현·미기동이다. 정상 반납 후 기존 승인 P0/P1을 이어가되 원본/credential 복사·동일 잠금 검사 반복·자동 재시도·Agent의 앱/자식 process 종료는 하지 않는다.
- 증거 p0-lock-owner-20261029.json, 정상 반납 방법·한계는 판정서10절. 새 지속 process/port/auth/설정/원본 변경 없음.

## 2026-10-29 16:27 KST — 시험 대상 교체

- 업무 대상01a0dadd-739f-74d2-93c5-9c405cc1019b는 검증에서 제외한다. 새 시험용 세션의 ID/실제 경로는 아직 전달받지 않았다. 기존 lock/프로세스/본문 재조회와 업무 계정 변경을 하지 않는다.
- ‘계정 변경’의 방식은 사용자 확인 대기이며 새 인증/env/Secret/CODEX_HOME/서비스/실행 명령을 추측해 설정하지 않는다. 목록 표시·본문 열기·실제 생성은 판정서11절대로 각각 확인한다. 현재 추가 로그인/기동/모델 호출 없음.

## 2026-10-29 17:31 KST — 공식 별도 계정 클라우드 조회 실증

- 새 대상은 PR-Test 설정/01a186a9-a58d-76d2-bc55-215f5b4a008e, 다른 PC/다른 ChatGPT 계정의 클라우드 세션이라는 사용자 확인이다. 계정 이메일 원문은 기록하지 않는다. 현재 PC의 고정/최근50개 앱 metadata와 이 ID 파일명 조회는 미발견이었으나 계정 전환/클라우드 목록 결과와 별개다.
- Python3.14 표준 라이브러리의 src/pilot/cloud_account_probe.py가 설치 공식 CLI0.165.0-alpha.1.2를 실행한다. 임시 CODEX_HOME=D:\tmp\ieon-cloud-p0-20261029-1720, 프로필 현재 사용자만 FullControl/상속차단을 실제 확인했다. 새 공식 credential은 이 전용 file store에만 발급·사용했고 기존 auth/keyring은 읽거나 복사하지 않았다.
- 공식 browser login1회/callback1455 후 사용자 완료 확인. 기존 Desktop 계정/설정 변경없음. list/status1회씩, cloud 목록0개·지정 ID NOT_FOUND. 로컬 OS 잠금 오류는 새 클라우드 대상의 결과가 아니다. 원문/생성/재개/배포는 미실행이다.
- login child70200 종료 뒤 자체 wrapper64684 I/O 대기만 식별·정지했고 재로그인 없이 원래 계획한 읽기 조회를 완료했다. 신규 credential과 임시 폴더 제거 true, callback listener 없음. cleanup/실제 결과는 cloud-account-access-20261029.json.
- 재실행 명령은 결과서에만 보존하며 자동 재시도하지 않는다. 제품 정식 서버/port/DB/Compose/모델/API 키/Oracle 구성 변경없음. 클라우드의 정확한 대화 유형과 공개 read/continue 경로는 미확인이다.

## 2026-10-29 17:40 KST — 관리 App Server 대안의 환경·인증 경계 검토

- 실제 환경 변경은 없다. 개인PC 전용 구독 경로, Oracle/API키, 등록·허용된SIWC/원격 배치를 제안으로만 비교했다. 실행 위치/port/DB/Compose/Secret/credential/등록 client ID를 새 실제 값으로 기록하지 않는다.
- 공식 App Server 문서는 기존 구독 로그인 인증의 hosted/commercial 사용을 허용하지 않는다고 명시한다. API 키는 별도 API 사용·과금 경로다. SIWC는 client 등록/이용 자격/호스팅 범위를 확인해야 하며 private 이어온에 자동 허용된다고 가정하지 않는다.
- 공식 SIWC 원격VM 가이드의 보호 credential 전송은 open-source용 안내이고 기존 금지/허용 범위를 결정하지 않았으므로 채택하지 않았다. 원래 Desktop credential 복사·로그인·키 등록·전송·서버 기동 없음.
- 이전 기록의 WSL x86_64/Oracle aarch64를 검토 참고로만 사용했다. CPU/메모리/디스크·선정 버전 ARM64 실행·배포 가능성은 새로 확인하지 않았다. 방향 선택 후 로컬/WSL 검증과 별도 Oracle 이전 승인 순서를 지킨다.

## 2026-10-29 17:57 KST — Codex 외부 입력 경로 source 비교

- 공식 tag rust-v0.165.0-alpha.1.2/commit720fec862a608ae1e5878d1eecb04fb93192e93c의 CLI queue·TUI queue/shared-server 선택·SDK ExternalMessage 문서를 읽었다. API는 source에 존재하며 SDK 문서상 CLI 최소0.151.0이다. SDK 설치/실행/실제 binary의 해당 명령 호출은 하지 않았다.
- codex queue는 thread/queue/add를 공유 또는 명시 remote App Server로 보내며 접수 ID를 반환한다. 새 Desktop endpoint/port/daemon/remote 토큰/소켓을 실제 설정하지 않았다. 이 명령을 read-only 상태 조회로 실행하지 않는다.
- 공식 CLI/TUI --remote는 화면 후보로 추가했으나 현재 Desktop의 stdio 외부 attach/동일 runtime 공유는 미확인이다. source 비교를 위해 현재 프로세스/기존 대화/잠금을 다시 조회하지 않았다.
- fingerprint는 codex-external-input-source-evidence.json, 비교/정정은 CLAUDE_CHANNELS_CODEX_INPUT_REVIEW.md. runtime/config/credential/model/source/tests·WSL/Oracle 변경없음.
