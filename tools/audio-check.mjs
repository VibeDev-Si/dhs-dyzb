// 用无头 Chrome + CDP 打开直播页，检查 <audio> 是否真的把歌载进来了
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] || 'http://127.0.0.1:8787/';
const waitMs = Number(process.argv[3] || 6000);
const port = 9411 + Math.floor(Math.random() * 200);

const profile = mkdtempSync(join(tmpdir(), 'chk-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--window-size=1600,900',
    url,
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('连不上 CDP');
}

const ws = new WebSocket(await wsUrl());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
function send(method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((r) => pending.set(mid, r));
}

await sleep(waitMs);
const expr = `(() => {
  const p = document.getElementById('player');
  const v = document.getElementById('voicePlayer');
  const now = document.getElementById('nowText');
  const tag = document.getElementById('srcTag');
  return JSON.stringify({
    now: now?.textContent,
    tag: tag?.textContent,
    src: (p?.src || '').slice(0, 120),
    paused: p?.paused,
    readyState: p?.readyState,
    currentTime: Number(p?.currentTime || 0).toFixed(2),
    duration: p?.duration,
    error: p?.error ? { code: p.error.code, message: p.error.message } : null,
    volume: p?.volume,
    voice: {
      src: (v?.src || '').slice(-40),
      paused: v?.paused,
      readyState: v?.readyState,
      currentTime: Number(v?.currentTime || 0).toFixed(2),
      duration: v?.duration,
      volume: v?.volume,
      error: v?.error ? { code: v.error.code, message: v.error.message } : null,
    },
  });
})()`;
const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log(res.result?.result?.value ?? JSON.stringify(res));

ws.close();
chrome.kill();
