import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../src/pilot/store.mjs';

export const owner = { userId: 'u_sinsan', appId: 'app_web' };
export const stranger = { userId: 'u_other', appId: 'app_web' };
export const otherApp = { userId: 'u_sinsan', appId: 'app_other' };

export const codexBinding = {
  conversationId: 'c_codex', ownerUserId: 'u_sinsan', appIds: ['app_web'],
  hostId: 'h_sinsan', engine: 'codex_thread', sessionRef: 'thread-test-1',
};
export const claudeBinding = {
  conversationId: 'c_claude', ownerUserId: 'u_sinsan', appIds: ['app_web'],
  hostId: 'h_sinsan', engine: 'claude_channel', sessionRef: 'channel-session-1',
};

export function tempStore(t, bindings = [codexBinding, claudeBinding]) {
  const dir = mkdtempSync(join(tmpdir(), 'ieon-s1-'));
  const path = join(dir, 'pilot.db');
  let store = openStore(path);
  for (const b of bindings) store.addBinding(b);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return {
    path, dir,
    get store() { return store; },
    reopen() { store.close(); store = openStore(path); return store; },
  };
}
