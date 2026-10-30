// 直连测试：node tools/danma-test.mjs <web_rid 或内部 roomId>
import { DanmakuBridge } from '../lib/cortico.mjs';

const input = process.argv[2];
if (!input) {
  console.error('用法：node tools/danma-test.mjs <房间号或 live.douyin.com 链接>');
  process.exit(1);
}

const bridge = new DanmakuBridge();
bridge.on('status', (s) => {
  console.log('[status]', s.state, s.webRid, s.roomId, 'msgs=' + s.messages, s.lastError || '');
});
bridge.on('event', (ev) => {
  const who = ev.username || '匿名';
  if (ev.kind === 'chat') console.log(`[弹幕] ${who}: ${ev.text}`);
  else if (ev.kind === 'gift') console.log(`[礼物] ${who} 送出 ${ev.giftName} ×${ev.count}`);
  else console.log(`[${ev.kind}] ${who}`);
});

await bridge.start(input);
console.log('已启动，观察 40 秒…');
setTimeout(() => {
  console.log('[final]', JSON.stringify(bridge.status()));
  bridge.stop();
  process.exit(0);
}, 40000);
