// recovery.test.mjs가 띄우는 실제 별도 프로세스. 지정 지점에서 즉시 종료한다.
import { openStore } from '../../src/pilot/store.mjs';

const [path, requestId, point] = process.argv.slice(2);
const store = openStore(path);
const adapter = {
  async run() {
    if (point === 'after_send') process.exit(86);
    return { receipt: 'turn-1', answer: 'ok' };
  },
};
await store.execute(requestId, adapter, {
  hook(stage) { if (stage === point) process.exit(86); },
});
process.exit(0);
