// 설치된 부품이 package-lock.json과 같은지 본다(설치·업데이트 때 install.ps1이 쓴다). 표준 기능만 쓴다: 처음 설치에는 부품이 아직 없다.
// 결과: ok(그대로 씀) | install(부품 없음) | stale(버전·목록이 다름)
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packages = (path) => JSON.parse(readFileSync(path, 'utf8')).packages ?? {};

export function depsState(root) {
  const installedPath = join(root, 'node_modules', '.package-lock.json');
  if (!existsSync(installedPath)) return 'install';
  const wanted = Object.entries(packages(join(root, 'package-lock.json'))).filter(([name]) => name);
  const installed = packages(installedPath);
  // 선택 부품은 다른 OS용일 수 있어 없어도 된다. 설치돼 있으면 아래에서 버전을 본다.
  for (const [name, info] of wanted) {
    if (info.optional) continue;
    if (installed[name]?.version !== info.version || !existsSync(join(root, name))) return 'stale';
  }
  const lock = new Map(wanted);
  for (const [name, info] of Object.entries(installed)) {
    if (lock.get(name)?.version !== info.version) return 'stale';
  }
  return 'ok';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(depsState(process.argv[2] ?? process.cwd()));
}