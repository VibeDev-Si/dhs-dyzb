/**
 * 在「直播窗口」里放一声 880Hz 的「叮」，用来证明声音通道是通的。
 * 前提：直播窗带 --remote-debugging-port=9222 启动。
 * 用法：node tools/beep.mjs [秒数]
 */
const PORT = 9222;
const secs = Number(process.argv[2] || 1);

const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
const page = list.find((t) => t.type === 'page' && /8787/.test(t.url));
if (!page) throw new Error('没找到直播页 target（窗口是不是没带 --remote-debugging-port=9222？）');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});
let id = 0;
const send = (method, params) =>
  new Promise((resolve) => {
    const mine = ++id;
    const onMsg = (e) => {
      const d = JSON.parse(e.data);
      if (d.id === mine) {
        ws.removeEventListener('message', onMsg);
        resolve(d);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: mine, method, params }));
  });

const expr = `(async () => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') await ctx.resume();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.value = 0.9;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  await new Promise((r) => setTimeout(r, ${Math.round(secs * 1000)}));
  osc.stop();
  await ctx.close();
  return { state: 'done' };
})()`;

const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log('beep ->', JSON.stringify(r.result?.result?.value ?? r.result));
ws.close();
