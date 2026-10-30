/**
 * 用 CDP 截图（比 chrome --screenshot 可控，能等页面渲染完、能看控制台报错）
 * 用法：node tools/shot.mjs [url] [out.png] [waitMs] [scrollY] [clickSelector|js]
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] || 'http://127.0.0.1:8787/';
const out = process.argv[3] || 'shot.png';
const waitMs = Number(process.argv[4] || 3500);
const scrollY = Number(process.argv[5] || 0);
const action = process.argv[6] || '';
const W = 1920;
const H = 1080;
const PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-shot-'));
const child = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${W},${H}`,
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required',
    '--force-device-scale-factor=1',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function waitCdp() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP 没起来');
}

let ws;
try {
  const targets = await waitCdp();
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let seq = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    } else if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`console.${m.params.type}: ` + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  });
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++seq;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(waitMs);
  if (action) {
    const expr = action.startsWith('#')
      ? `document.querySelector(${JSON.stringify(action)})?.click()`
      : action;
    await send('Runtime.evaluate', { expression: expr });
    await sleep(700);
  }
  if (scrollY) {
    await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${scrollY})` });
    await sleep(600);
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  if (!shot.result?.data) throw new Error('截图失败：' + JSON.stringify(shot).slice(0, 300));
  await writeFile(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out);
  if (logs.length) console.log('--- 页面日志 ---\n' + logs.slice(-30).join('\n'));
} finally {
  try {
    ws?.close();
  } catch {}
  child.kill();
  await sleep(300);
}
