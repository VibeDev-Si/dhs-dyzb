#!/usr/bin/env node
/* 电台竖屏页的假后端（只给 public/radio.* 做测试用，不碰真服务）。
 * 用法：node tools/mock-radio.mjs [--port 8790] [--feed] [--no-music]
 * 打开：http://127.0.0.1:8790/?auto=1
 * 合约见 docs/radio-design.md。每个 SSE 连接各自循环播一段约 25 秒的演示脚本。 */
import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const VOICE_DIR = path.join(ROOT, 'data', 'voice');
const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const PORT = Number(argOf('--port', 8790));
const SHOW_FEED = argv.includes('--feed');
const WITH_MUSIC = !argv.includes('--no-music');
const CYCLE_MS = 30000;
/* --rig-dir <目录>：用别处的素材顶替 public/assets/radio/rig/（测试分层角色用） */
const RIG_DIR = argOf('--rig-dir', '') ? path.resolve(argOf('--rig-dir', '')) : '';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.gif': 'image/gif',
};

/* 运行时挑 data/voice 里真实存在的 mp3：小的当语音片段，大的当「点歌」 */
async function pickVoices() {
  let files = [];
  try {
    files = (await readdir(VOICE_DIR)).filter((f) => f.toLowerCase().endsWith('.mp3'));
  } catch {
    /* 没有目录就只能无声演示 */
  }
  const sized = [];
  for (const f of files) {
    try {
      sized.push({ f, size: (await stat(path.join(VOICE_DIR, f))).size });
    } catch {}
  }
  sized.sort((a, b) => a.size - b.size);
  const clips = sized.filter((x) => x.size > 20000 && x.size < 200000).map((x) => x.f);
  const big = sized.filter((x) => x.size >= 200000).map((x) => x.f);
  return { clips: clips.length ? clips : sized.map((x) => x.f), songs: big.length ? big : sized.map((x) => x.f) };
}
const voices = await pickVoices();
const voiceUrl = (i) => (voices.clips.length ? `/api/voice/${voices.clips[i % voices.clips.length]}` : '/api/voice/missing.mp3');

/* ---------- 假状态 ---------- */
const TOPICS = [
  { text: '那些没说出口的话', hook: '你有一句一直没说的话吗？' },
  { text: '深夜最想吃的一口', hook: '凌晨两点，你会为了什么下楼？' },
];
/* 每轮换一个时段，方便截图对比（按反差大的顺序排） */
const SLOTS = [
  { key: 'afternoon', label: '下午', subtitle: '午后电台 · 树洞', greet: '下午好', weekend: false },
  { key: 'late', label: '深夜', subtitle: '深夜电台 · 树洞', greet: '夜深了', weekend: false },
  { key: 'morning', label: '上午', subtitle: '早安电台 · 树洞', greet: '早上好', weekend: true },
  { key: 'evening', label: '傍晚', subtitle: '傍晚电台 · 树洞', greet: '傍晚好', weekend: false },
  { key: 'small', label: '凌晨', subtitle: '凌晨电台 · 树洞', greet: '还没睡呀', weekend: false },
  { key: 'dawn', label: '清晨', subtitle: '清晨电台 · 树洞', greet: '早', weekend: true },
  { key: 'noon', label: '中午', subtitle: '午间电台 · 树洞', greet: '中午好', weekend: false },
  { key: 'prime', label: '晚上', subtitle: '晚间电台 · 树洞', greet: '晚上好', weekend: false },
];
let cycle = 0;
let songIdx = 0;
const config = {
  mode: 'radio',
  voice: { enabled: true, volume: 0.85 },
  music: { volume: 0.2 },
  radio: { topicMin: 10, paused: false, showFeed: SHOW_FEED },
};
const events = [
  { id: 1, ts: Date.now() - 60000, kind: 'chat', username: '晚风', text: '大肥鱼晚上好～', gift: null },
  { id: 2, ts: Date.now() - 50000, kind: 'chat', username: '七月', text: '今天加班到现在，刚到家', gift: null },
];
let eventSeq = 10;

function currentSong() {
  if (!WITH_MUSIC || !voices.songs.length) return null;
  const f = voices.songs[songIdx % voices.songs.length];
  return { title: ['夜空中最亮的星', '后来', '晴天'][songIdx % 3], by: ['逃跑计划', '刘若英', '周杰伦'][songIdx % 3], url: `/api/voice/${f}`, kind: 'local' };
}
const songView = () => ({ currentSong: currentSong(), playlist: [], queueMax: 3, music: { volume: config.music.volume } });

function radioView(extra = {}) {
  const t = TOPICS[cycle % TOPICS.length];
  return {
    mode: 'radio',
    topic: { text: t.text, hook: t.hook, since: Date.now(), source: 'ai' },
    recap: '',
    slot: SLOTS[cycle % SLOTS.length],
    wall: [
      { text: '猫和狗谁更粘人', count: 3, users: ['七月', '晚风'] },
      { text: '第一份工作学到了什么', count: 5, users: ['阿杰'] },
      { text: '一个人住的第一晚', count: 2, users: ['小满'] },
      { text: '最近单曲循环的歌', count: 1, users: ['路人甲'] },
    ],
    paused: false,
    speaking: false,
    busy: false,
    search: { enabled: true, today: 4, perHour: 30 },
    alerts: [],
    lastError: '',
    ...extra,
  };
}
let radio = radioView();
/* ---------- SSE ---------- */
const clients = new Set();
const send = (res, obj) => {
  try {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  } catch {}
};
const broadcast = (obj) => {
  for (const c of clients) send(c, obj);
};
const ev = (kind, username, extra = {}) => {
  const item = { id: eventSeq++, ts: Date.now(), kind, username, text: '', gift: null, source: 'mock', ...extra };
  if (kind === 'chat') events.push(item);
  return { type: 'event', item };
};

/* 一轮演示脚本：[毫秒, 生成事件的函数]；n 是轮次，用来给 say id 编号 */
function script(n) {
  const a = `r${n}a`;
  const b = `r${n}b`;
  const A = ['七月，先把包放下，鞋子踢掉。', '加班到这个点，累是正常的，不用硬撑着说没事。', '今晚就在这儿坐一会儿，听我随便说两句，困了就睡。'];
  const B = ['我帮你看了一下，北京今天是阴转小雨，', '晚上出门记得带伞，别淋着了。'];
  return [
    [300, () => { radio = radioView({ recap: n === 0 ? '' : radio.recap }); return { type: 'radio', radio }; }],
    [900, () => ev('enter', '晚风')],
    [1200, () => ev('enter', '路过的鲸')], // 4 秒内第二个进场：页面应只弹第一个
    [1500, () => ev('chat', '七月', { text: '今天加班到现在，好累，想听你说说话' })],
    /* 文字比声音快：say-start 后 0.3–1.5 秒推完全部句子，音频 1.2 秒后才到 */
    [2000, () => ({ type: 'say-start', say: { id: a, kind: 'batch', to: ['七月', '晚风'], quotes: [{ name: '七月', text: '今天加班到现在，好累，想听你说说话' }, { name: '晚风', text: '姐姐今天上班好累啊，老板又改需求了，改了一整天' }] } })],
    [2600, () => ({ type: 'say-delta', id: a, text: A[0] })],
    [2900, () => ({ type: 'say-delta', id: a, text: A[1] })],
    [3200, () => ({ type: 'say-audio', id: a, url: voiceUrl(n * 3), seq: 1 })],
    [3400, () => ({ type: 'say-delta', id: a, text: A[2] })],
    [3600, () => ({ type: 'say-audio', id: a, url: voiceUrl(n * 3 + 1), seq: 2 })],
    [3800, () => ({ type: 'say-end', id: a, ok: true, text: A.join('') })],
    [7000, () => ev('gift', '阿杰', { gift: { name: '小心心', count: 3, emoji: '💗', price: 0.1 } })],
    [9000, () => { radio = { ...radio, recap: '刚进来的朋友，我们在聊「那些没说出口的话」，你也可以发弹幕说说你的。' }; return { type: 'radio', radio }; }],
    [10500, () => ev('chat', '小满', { text: '话题 一个人住的第一晚' })],
    [16000, () => ({ type: 'say-start', say: { id: b, kind: 'reply', to: ['小满'], quotes: [{ name: '小满', text: '今天北京下雨了吗？' }] } })],
    [16600, () => ({ type: 'say-status', id: b, status: 'searching' })],
    [19600, () => ({ type: 'say-status', id: b, status: 'found' })],
    [20000, () => ({ type: 'say-delta', id: b, text: B[0] })],
    [20300, () => ({ type: 'say-delta', id: b, text: B[1] })],
    [21200, () => ({ type: 'say-audio', id: b, url: voiceUrl(n * 3 + 2), seq: 1 })],
    [21400, () => ({ type: 'say-end', id: b, ok: true, text: '' })],
    [23500, () => ev('enter', '凌晨四点的猫')],
    [24500, () => ev('chat', '路人甲', { text: '点歌 后来' })],
    [28000, () => { cycle += 1; return null; }],
  ];
}
/* 第一个连接进来才开始播，没人看时停；这样截图时间点和脚本对得上 */
let loopTimers = [];
let round = 0;
function startLoop() {
  if (loopTimers.length) return;
  const runRound = () => {
    const n = round++;
    for (const [at, make] of script(n)) {
      loopTimers.push(setTimeout(() => {
        const msg = make();
        if (msg) broadcast(msg);
      }, at));
    }
    loopTimers.push(setTimeout(runRound, CYCLE_MS));
    if (loopTimers.length > 200) loopTimers = loopTimers.slice(-60);
  };
  runRound();
}
function stopLoop() {
  for (const t of loopTimers) clearTimeout(t);
  loopTimers = [];
}

/* ---------- HTTP ---------- */
const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};

async function serveFile(res, file, req) {
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not file');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range && type.startsWith('audio/')) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      const buf = (await readFile(file)).subarray(start, end + 1);
      res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': buf.length });
      return res.end(buf);
    }
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': type, 'content-length': buf.length, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const p = decodeURIComponent(url.pathname);
  if (p === '/api/events' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    send(res, { type: 'init', config, song: songView(), events: events.slice(-50), serverTime: Date.now() });
    startLoop();
    const hb = setInterval(() => res.write(': hb\n\n'), 15000);
    req.on('close', () => {
      clearInterval(hb);
      clients.delete(res);
      if (!clients.size) stopLoop();
    });
    return;
  }
  if (p === '/api/state' && req.method === 'GET') return json(res, 200, { ok: true, config, song: songView(), events: events.slice(-50) });
  if (p === '/api/radio' && req.method === 'GET') return json(res, 200, { ok: true, radio });
  if (p === '/api/music/ended' && req.method === 'POST') {
    songIdx += 1;
    console.log('[mock] 一首歌播完，换下一首');
    json(res, 200, { ok: true });
    return broadcast({ type: 'song', ...songView() });
  }
  if (p === '/api/mock/mute' && req.method === 'POST') { // 手动测 mute：curl -X POST .../api/mock/mute
    broadcast({ type: 'mute' });
    return json(res, 200, { ok: true });
  }
  if (p.startsWith('/api/voice/')) {
    const name = path.basename(p); // 只取文件名，防目录穿越
    if (!/^[\w.-]+\.mp3$/i.test(name)) return json(res, 400, { ok: false });
    return serveFile(res, path.join(VOICE_DIR, name), req);
  }
  if (RIG_DIR && p.startsWith('/assets/radio/rig/')) {
    const name = path.basename(p);
    return serveFile(res, path.join(RIG_DIR, name), req);
  }
  if (p.startsWith('/api/')) return json(res, 404, { ok: false, error: 'mock: not implemented' });
  const rel = p === '/' ? 'radio.html' : p.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { ok: false });
  return serveFile(res, file, req);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-radio] http://127.0.0.1:${PORT}/?auto=1  （语音片段 ${voices.clips.length} 个，feed=${SHOW_FEED}）`);
});
const bye = () => {
  stopLoop();
  for (const c of clients) c.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
