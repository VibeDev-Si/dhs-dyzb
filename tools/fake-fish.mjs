/* 本地假 Fish 流式服务，自测 lib/fish-stream.mjs 用：
 *   node tools/fake-fish.mjs 8898
 *   $env:FISH_WS_URL='ws://127.0.0.1:8898'; $env:FISH_API_KEY='test'; node server.mjs
 * 收到 start/text/stop 后，每 300ms 回一块 4KB 的「音频」（静音 mp3 帧），最后 finish。
 * Key 写 bad 时模拟 401。
 */
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { encode, decode } from '@msgpack/msgpack';

const port = Number(process.argv[2] || 8898);
// 第二个参数给一个真实 mp3 时，就把它切块回放（能在浏览器里真的听到）；否则回静音帧
const SAMPLE = process.argv[3] ? readFileSync(process.argv[3]) : null;
const FRAME = Buffer.alloc(417);
FRAME.set([0xff, 0xfb, 0x90, 0x64]);
const SILENT = Buffer.concat(Array(10).fill(FRAME));
const CHUNK_SIZE = 16 * 1024;

const wss = new WebSocketServer({
  port,
  verifyClient: (info, cb) => {
    const auth = info.req.headers.authorization || '';
    if (auth === 'Bearer bad') return cb(false, 401, 'Unauthorized');
    console.log(`[fake-fish] 连接 model=${info.req.headers.model}`);
    cb(true);
  },
});

wss.on('connection', (ws) => {
  let chars = 0;
  ws.on('message', (raw) => {
    const msg = decode(raw);
    if (msg.event === 'start') console.log('[fake-fish] start', JSON.stringify(msg.request));
    if (msg.event === 'text') chars += msg.text.length;
    if (msg.event === 'stop') {
      const n = SAMPLE ? Math.ceil(SAMPLE.length / CHUNK_SIZE) : Math.max(3, Math.ceil(chars / 20));
      console.log(`[fake-fish] ${chars} 字 → 回 ${n} 块`);
      let i = 0;
      const t = setInterval(() => {
        const piece = SAMPLE ? SAMPLE.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) : SILENT;
        if (i++ < n) return ws.send(encode({ event: 'audio', audio: piece }));
        clearInterval(t);
        ws.send(encode({ event: 'finish', reason: 'stop' }));
        ws.close();
      }, 300);
    }
  });
});
console.log(`[fake-fish] ws://127.0.0.1:${port}`);
