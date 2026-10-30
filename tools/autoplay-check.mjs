// 验证「打开就有声音 + 音乐与讲述同时出声」
// 用和 打开直播间.cmd 相同的 autoplay 放行参数启动 headless Chrome
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_ = 'http://127.0.0.1:8787/?auto=1';
const PORT = 9341;

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--no-first-run',
    '--user-data-dir=' + process.env.TEMP + '\\dfy-autoplay-probe',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const getJson = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();

let ws;
let id = 0;
const pending = new Map();
const send = (method, params = {}) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res) => pending.set(mid, res));
};
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r?.result?.result?.value;
};

const READ = `(() => {
  const a = document.getElementById('player');
  const v = document.getElementById('voicePlayer');
  const btn = document.getElementById('soundUnlock');
  return JSON.stringify({
    autoplay: window.__dfy?.state?.audioUnlocked ?? 'n/a',
    bgm: a.src ? a.src.split('/').pop() : '',
    bgmPaused: a.paused, bgmMuted: a.muted, bgmVol: Math.round(a.volume * 100) / 100,
    voicePaused: v.paused, voiceVol: Math.round(v.volume * 100) / 100,
    btn: btn ? (btn.hidden ? 'hidden' : 'visible') : 'removed',
    song: window.__dfy?.state?.song?.currentSong?.title || '',
  });
})()`;

(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await getJson('/json/list');
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.onopen = res;
          ws.onerror = rej;
        });
        break;
      }
    } catch {}
    await sleep(250);
  }
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_ });

  for (let i = 1; i <= 4; i++) {
    await sleep(3000);
    console.log(`+${i * 3}s`, await evaluate(READ));
  }

  // 边放歌边让它说话，看两个音量是否都还在
  await evaluate(`window.__dfy.speak('我先把灯拨亮一点，这样你们就能看清桌上这些信了。潮汐湾的傍晚是深蓝色的。')`);
  for (let i = 1; i <= 5; i++) {
    await sleep(3000);
    console.log(`说话中 +${i * 3}s`, await evaluate(READ));
  }

  ws.close();
  chrome.kill();
})().catch((e) => {
  console.error('probe failed', e.message);
  chrome.kill();
  process.exit(1);
});
