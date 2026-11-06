# systemd 사용자 유닛 (N5 초안)

**상태:** 초안이다. 어느 서버에도 설치하지 않았고 WSL에서도 아직 실행하지 않았다. WSL 실측 뒤에 이 문서를 갱신한다.

## 유닛

| 유닛 | 하는 일 |
| --- | --- |
| `ieon-server.service` | 이어온 서버(127.0.0.1:28760) |
| `ieon-connector.service` | 연결부. 실제 엔진 실행(live)은 `.local/s2/connector.json`이 정하며 유닛은 바꾸지 않는다 |
| `ieon-messenger.service` | 메신저 봇. 토큰은 유닛에 쓰지 않고 `.local` 아래 env 파일에서 읽는다 |

공유 App Server(동시 사용 모드)는 Codex 실행 파일 경로가 환경마다 달라 유닛을 만들지 않았다. 필요하면 `scripts/ieon.sh start --shared`를 쓴다.

## 설치 순서 (승인 후, 이어온 폴더가 `~/deploy/ieon-gateway`일 때)

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ieon-server ieon-connector     # 메신저는 토큰을 넣은 뒤 따로 켠다
systemctl --user status ieon-server ieon-connector
```

- 로그인하지 않아도 계속 돌리려면 `loginctl enable-linger $USER`가 필요하다.
- WSL은 `/etc/wsl.conf`에 `[boot]` `systemd=true`가 있어야 `systemctl --user`가 동작한다.
- Node를 nvm 등으로 설치했다면 사용자 유닛의 PATH에 없을 수 있다. 유닛마다 `Environment=PATH=<node가 있는 폴더>:/usr/bin:/bin`을 드롭인으로 추가한다.
- 모델을 부르는 실제 실행은 `connector.json`의 `live`가 `true`일 때만 생긴다. 승인 전에는 `false`로 둔다.

## 제거(되돌리기)

```bash
systemctl --user disable --now ieon-messenger ieon-connector ieon-server
rm ~/.config/systemd/user/ieon-*.service
systemctl --user daemon-reload
```
