/**
 * 端到端自测（不需要装扩展）：把 content.js 注入模拟直播间页面，
 * 用假的 chrome.storage 顶住扩展 API，验证「抓到弹幕 → 上报服务 → 大肥鱼回话 → 打字进输入框」。
 * 用法：node tools/ext-test.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SERVER = process.env.SERVER || 'http://127.0.0.1:8787';
const contentSrc = readFileSync(path.resolve('extension/content.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await fetch(`${SERVER}/api/reset`, { method: 'POST' }).catch(() => {});

const profile = mkdtempSync(path.join(tmpdir(), 'ext-prof-'));
const chrome = spawn(
  CHROME,
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--window-size=1280,900', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
let wsUrl = null;
chrome.stderr.on('data', (b) => {
  const m = String(b).match(/DevTools listening on (ws:\/\/\S+)/);
  if (m) wsUrl = m[1];
});
for (let i = 0; i < 100 && !wsUrl; i += 1) await sleep(100);
if (!wsUrl) {
  console.error('Chrome 没起来');
  process.exit(1);
}
const port = new URL(wsUrl).port;
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) => {
  seq += 1;
  ws.send(JSON.stringify({ id: seq, method, params }));
  return new Promise((r) => pending.set(seq, r));
};
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `${SERVER}/__mock__/live.html` });
await sleep(1500);

// 注入：先垫一个假的 chrome.storage，再跑 content.js
const stub = `window.chrome = { storage: { local: { get: (d, cb) => cb(d), set: () => {} }, onChanged: { addListener: () => {} } } };`;
await send('Runtime.evaluate', { expression: stub });
const injected = await send('Runtime.evaluate', { expression: contentSrc, awaitPromise: true });
if (injected.result?.exceptionDetails) {
  console.error('content.js 注入报错：', JSON.stringify(injected.result.exceptionDetails).slice(0, 500));
}

await sleep(20000);

const state = await (await fetch(`${SERVER}/api/state`)).json();
const outbox = await (await fetch(`${SERVER}/api/outbox`)).json();
const viaExt = (state.events || []).filter((e) => e.source === 'extension');
const probe = await send('Runtime.evaluate', {
  expression: 'JSON.stringify({ sent: window.__sent || [], items: document.querySelectorAll(".webcast-chatroom___item").length })',
  returnByValue: true,
});
const pageInfo = JSON.parse(probe.result?.result?.value || '{}');

console.log('--- 抓到的弹幕（最近 8 条）---');
for (const e of viaExt.slice(-8)) {
  console.log(` ${e.kind}\t${e.username}\t${e.text || (e.gift ? e.gift.name + '×' + e.gift.count : '')}`);
}
console.log('--- 发回直播间的回复 ---');
for (const s of pageInfo.sent || []) console.log(' →', s);
console.log('--- 发送箱剩余 ---');
console.log(JSON.stringify(outbox.items || []));
console.log(`合计：抓到 ${viaExt.length} 条，回写 ${(pageInfo.sent || []).length} 条`);

ws.close();
chrome.kill();
