/**
 * 用 CDP 打开页面并执行一段表达式，打印结果（调试布局用）
 * 用法：node tools/probe.mjs <url> "<js expression>"
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] || 'http://127.0.0.1:8787/';
const expr = process.argv[3] || 'document.title';
const waitMs = Number(process.argv[4] || 3500);

const profile = mkdtempSync(path.join(tmpdir(), 'probe-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1920,1080',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
chrome.stderr.on('data', (b) => {
  const m = String(b).match(/DevTools listening on (ws:\/\/\S+)/);
  if (m) wsUrl = m[1];
});

for (let i = 0; i < 100 && !wsUrl; i += 1) await sleep(100);
if (!wsUrl) {
  console.error('没有拿到 DevTools 地址');
  process.exit(1);
}
const port = new URL(wsUrl).port;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === 'page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
function send(method, params = {}) {
  seq += 1;
  ws.send(JSON.stringify({ id: seq, method, params }));
  return new Promise((r) => pending.set(seq, r));
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await sleep(waitMs);
const out = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
console.log(JSON.stringify(out.result?.result?.value ?? out, null, 2));
ws.close();
chrome.kill();
