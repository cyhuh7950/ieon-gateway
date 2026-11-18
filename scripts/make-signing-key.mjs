// 이어온 안드로이드 정식 서명 키 만들기(한 번만). 결과: .local/app-signing/ieon-release.jks + keystore.properties(git 제외).
// 비밀번호는 무작위로 만들어 파일에만 둔다(화면·로그에 출력하지 않음). 이미 있으면 아무것도 하지 않는다(키를 바꾸면 업데이트가 끊김).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIR = join(ROOT, '.local', 'app-signing');
const JKS = join(DIR, 'ieon-release.jks');
const PROPS = join(DIR, 'keystore.properties');
if (existsSync(JKS)) { console.log('서명 키가 이미 있어요 — 그대로 둡니다'); process.exit(0); }
mkdirSync(DIR, { recursive: true });
const keytool = [process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin', 'keytool.exe'), 'C:/Program Files/Android/Android Studio/jbr/bin/keytool.exe'].find((p) => p && existsSync(p));
if (!keytool) { console.error('keytool을 찾을 수 없어요(Android Studio 필요)'); process.exit(1); }
const pass = randomBytes(18).toString('base64url');
const r = spawnSync(keytool, ['-genkeypair', '-keystore', JKS, '-storetype', 'PKCS12', '-alias', 'ieon', '-keyalg', 'RSA', '-keysize', '4096', '-validity', '18250',
  '-storepass', pass, '-keypass', pass, '-dname', 'CN=ieon, O=ieon, C=KR'], { stdio: ['ignore', 'ignore', 'pipe'] });
if (r.status !== 0) { console.error('서명 키를 만들지 못했어요: ' + String(r.stderr).slice(0, 200).replace(pass, '…')); process.exit(1); }
writeFileSync(PROPS, `storeFile=${JKS.replaceAll('\\', '/')}\nstorePassword=${pass}\nkeyAlias=ieon\nkeyPassword=${pass}\n`);
console.log('서명 키를 만들었어요: .local/app-signing/ (비밀번호는 keystore.properties에만)');
