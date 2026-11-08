// W6: 서버가 띄운 연결부·메신저는 부모(서버)가 사라지면 스스로 끝난다. Windows는 부모를 강제로 끄면 자식이 남기 때문이다.
// 부모가 IEON_PARENT_PID로 자기 PID를 넘긴 경우에만 동작한다(사람이 직접 띄운 연결부·메신저에는 영향 없음).
export function watchParent({ env = process.env, intervalMs = 5000, exit = () => process.exit(0), alive } = {}) {
  const pid = Number(env.IEON_PARENT_PID);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const isAlive = alive ?? ((p) => { try { process.kill(p, 0); return true; } catch (e) { return e.code === 'EPERM'; } });
  const t = setInterval(() => { if (!isAlive(pid)) { clearInterval(t); exit(); } }, intervalMs);
  t.unref?.();
  return t;
}
export const childEnv = () => ({ ...process.env, IEON_PARENT_PID: String(process.pid) });
