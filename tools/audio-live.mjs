/**
 * 检查「正在直播的那个窗口」里音频到底什么状态。
 * 前提：直播窗口用 --remote-debugging-port=9222 启动（见 tools/live-debug.cmd）。
 * 用法：node tools/audio-live.mjs
 */
const PORT = Number(process.argv[2] || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error(`连不上 CDP ${PORT}（直播窗是不是没带 --remote-debugging-port？）`);
}

const list = await targets();
const page = list.find((t) => t.type === 'page' && /127\.0\.0\.1:8787/.test(t.url)) || list.find((t) => t.type === 'page');
if (!page) throw new Error('没找到直播页 target');
console.log('target:', page.url, '|', page.title);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });

const expr = `(() => {
  const p = document.getElementById('player');
  const v = document.getElementById('voicePlayer');
  const st = (el) => el ? {
    src: (el.getAttribute('src') || '').slice(0, 90),
    currentSrc: (el.currentSrc || '').slice(0, 90),
    paused: el.paused,
    muted: el.muted,
    volume: Number(el.volume.toFixed(2)),
    readyState: el.readyState,
    networkState: el.networkState,
    currentTime: Number(el.currentTime.toFixed(2)),
    duration: Number((el.duration || 0).toFixed(2)),
    error: el.error ? { code: el.error.code, message: el.error.message } : null,
  } : null;
  return {
    title: document.title,
    visibility: document.visibilityState,
    bgm: st(p),
    voice: st(v),
    hasDfy: typeof window.__dfy === 'object',
    song: window.__dfy?.state?.song?.currentSong || null,
    musicVolume: window.__dfy?.state?.musicVolume ?? null,
    unlockHidden: document.getElementById('soundUnlock')?.hidden ?? null,
  };
})()`;

const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 2));
ws.close();
