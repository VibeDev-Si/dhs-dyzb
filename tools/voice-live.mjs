/**
 * 在直播窗里直接调 __dfy.speak('…')，验证「大肥鱼的声音」这条链路能不能出声。
 * 前提：直播窗带 --remote-debugging-port=9222 启动。
 * 用法：node tools/voice-live.mjs "你好，我是大肥鱼"
 */
const PORT = 9222;
const text = process.argv[2] || '你好，我是大肥鱼，现在试一下声音。';

const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
const page = list.find((t) => t.type === 'page' && /8787/.test(t.url));
if (!page) throw new Error('没找到直播页 target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener('open', res, { once: true }));
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

const call = await send('Runtime.evaluate', {
  expression: `window.__dfy.speak(${JSON.stringify(text)}); 'called'`,
  returnByValue: true,
});
console.log('speak ->', JSON.stringify(call.result?.result?.value));

for (let i = 0; i < 10; i += 1) {
  await new Promise((r) => setTimeout(r, 3000));
  const st = await send('Runtime.evaluate', {
    expression: `(() => { const v = document.getElementById('voicePlayer'); return JSON.stringify({ src: (v.getAttribute('src')||'').slice(0,60), paused: v.paused, vol: Number(v.volume.toFixed(2)), t: Number(v.currentTime.toFixed(1)), dur: Number((v.duration||0).toFixed(1)), err: v.error ? v.error.code : null }); })()`,
    returnByValue: true,
  });
  console.log(`+${(i + 1) * 3}s`, st.result?.result?.value);
  const v = JSON.parse(st.result?.result?.value || '{}');
  if (!v.paused && v.t > 0.5) break;
}
ws.close();
