/**
 * Fish Audio 双向流式 TTS（wss://api.fish.audio/v1/tts/live，MessagePack 帧）。
 *
 * 链路：服务端开一条 WebSocket 把文字分句推给 Fish，Fish 边合成边回 audio 帧；
 * 同时把这些 mp3 帧原样转发给浏览器（HTTP chunked，/api/voice/stream/<hash>.mp3），
 * 页面收到第一块就能开口，不用等整章合成完。流结束后整段写进 data/voice/<hash>.mp3，
 * 之后同一段话直接走缓存。
 */
import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';
import { encode, decode } from '@msgpack/msgpack';
import { proxyAgent, netHint } from './proxy.mjs';

const WS_URL = process.env.FISH_WS_URL || 'wss://api.fish.audio/v1/tts/live'; // 环境变量只用于本地自测
const FIRST_AUDIO_TIMEOUT_MS = 30000;

/** hash -> { chunks, bytes, done, error, subs:Set<res>, file, firstAudio:Promise, finished:Promise } */
const streams = new Map();

/** 按句号/问号/换行切成 40–120 字的小块，一块一个 text 事件 */
export function splitForStream(text, max = 120) {
  const parts = String(text).split(/(?<=[。！？!?；;\n])/);
  const out = [];
  let buf = '';
  for (const p of parts) {
    if ((buf + p).length > max && buf) {
      out.push(buf);
      buf = '';
    }
    buf += p;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/** 只有还在合成中的流才走实时转发；合成完的让调用方去读磁盘缓存 */
export function getStream(hash) {
  const s = streams.get(hash);
  return s && !s.done && !s.error ? s : null;
}

/** 按第一帧的码率估 CBR mp3 时长（Fish 回的是恒定码率），读不出就按 128kbps */
const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
export function mp3DurationMs(buf) {
  let kbps = 128;
  let start = 0;
  if (buf.subarray(0, 3).toString('latin1') === 'ID3' && buf.length > 10) {
    start = 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]);
  }
  for (let i = start; i < Math.min(buf.length - 3, start + 4096); i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0 && ((buf[i + 1] >> 1) & 3) === 1) {
      const version = (buf[i + 1] >> 3) & 3; // 3 = MPEG1，其余按 MPEG2/2.5
      const k = BITRATES[version === 3 ? 1 : 2][buf[i + 2] >> 4];
      if (k) kbps = k;
      break;
    }
  }
  return Math.round(((buf.length - start) * 8) / kbps);
}

/**
 * 开一条「边推文字边出声」的会话（双向流）。
 *   session.push(text)  追加一句；flush=true 时让 Fish 立刻合成已收到的文字（直播回话要快）
 *   session.end()       文字推完了（发 stop），Fish 把剩下的合成完就结束
 *   session.abort()     静音/出错：立刻断开，不写缓存
 *   session.firstAudio  收到第一块音频时 resolve，失败 reject
 *   session.finished    结束时 resolve({ bytes, ms, error? })
 * 文字在 WebSocket 打开前推进来会先排队；"30 秒没出声"从第一次 push 开始算。
 */
export function openFishSession({ key, file, apiKey, model, request, flush = true, maxMs = 180000, proxy }) {
  const old = streams.get(key);
  if (old && !old.error && !old.done) return old;
  if (old) streams.delete(key);

  const entry = { key, chunks: [], bytes: 0, done: false, error: null, subs: new Set(), file, startedAt: Date.now(), chars: 0 };
  let gotFirst, failFirst, finish;
  entry.firstAudio = new Promise((ok, fail) => ((gotFirst = ok), (failFirst = fail)));
  entry.finished = new Promise((ok) => (finish = ok));
  entry.firstAudio.catch(() => {});
  streams.set(key, entry);

  const agent = WS_URL.startsWith('wss://') ? proxyAgent(proxy) : undefined; // 本地自测的 ws:// 不走代理
  const ws = new WebSocket(WS_URL, { headers: { Authorization: `Bearer ${apiKey}`, model }, agent });
  const pending = [];
  let opened = false;
  let firstTimer = null;
  const hardTimer = setTimeout(() => fail(new Error('Fish 流式合成超时')), maxMs);

  const send = (obj) => (opened ? ws.send(encode(obj)) : pending.push(obj));
  function closeSubs() {
    for (const res of entry.subs) res.end();
    entry.subs.clear();
  }
  function cleanup() {
    clearTimeout(firstTimer);
    clearTimeout(hardTimer);
    if (streams.get(key) === entry) streams.delete(key); // 合成完就走磁盘缓存，内存里不留
  }
  function fail(err) {
    if (entry.done || entry.error) return;
    entry.error = err;
    failFirst(err);
    closeSubs();
    cleanup();
    try { ws.terminate(); } catch { /* 已经断了 */ }
    finish({ bytes: entry.bytes, ms: entry.bytes ? mp3DurationMs(Buffer.concat(entry.chunks)) : 0, error: err.message });
  }

  entry.push = (text) => {
    const t = String(text || '');
    if (!t.trim() || entry.ended || entry.error) return;
    entry.chars += t.length;
    if (!firstTimer && !entry.chunks.length) {
      firstTimer = setTimeout(() => fail(new Error('Fish 流式合成 30 秒没出声')), FIRST_AUDIO_TIMEOUT_MS);
    }
    send({ event: 'text', text: t });
    if (flush) send({ event: 'flush' });
  };
  entry.end = () => {
    if (entry.ended || entry.error) return;
    entry.ended = true;
    if (!entry.chars) return fail(new Error('没有要说的话'));
    send({ event: 'stop' }); // 注意协议里结束事件叫 stop
  };
  entry.abort = (why = '已静音') => fail(new Error(why));

  ws.on('open', () => {
    opened = true;
    ws.send(encode({ event: 'start', request: { ...request, text: '' } }));
    for (const m of pending.splice(0)) ws.send(encode(m));
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = decode(raw);
    } catch {
      return; // 解不开的帧忽略
    }
    if (msg?.event === 'audio' && msg.audio?.length) {
      const buf = Buffer.from(msg.audio);
      if (!entry.chunks.length) {
        clearTimeout(firstTimer);
        entry.firstAudioMs = Date.now() - entry.startedAt;
        gotFirst(entry);
      }
      entry.chunks.push(buf);
      entry.bytes += buf.length;
      for (const res of entry.subs) res.write(buf);
    } else if (msg?.event === 'finish') {
      if (msg.reason === 'error') return fail(new Error('Fish 流式合成中途出错'));
      if (!entry.bytes) return fail(new Error('Fish 没有返回音频'));
      entry.done = true;
      const all = Buffer.concat(entry.chunks);
      try { writeFileSync(file, all); } catch (e) { console.warn('[fish] 写缓存失败：', e.message); }
      closeSubs();
      cleanup();
      finish({ bytes: entry.bytes, ms: mp3DurationMs(all) });
      try { ws.close(); } catch { /* 无所谓 */ }
    }
    // 其他事件（协议以后加的）一律忽略
  });

  ws.on('unexpected-response', (_req, res) => {
    const hint = { 401: 'Key 无效', 402: '额度不足', 429: '并发超限' }[res.statusCode] || '连接被拒';
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => fail(Object.assign(new Error(`Fish ${res.statusCode}（${hint}）：${body.slice(0, 160)}`), { status: res.statusCode })));
  });
  ws.on('error', (e) => {
    const hint = netHint(e);
    fail(new Error(`Fish 连接失败：${e.message}${hint ? `。${hint}` : ''}`));
  });
  ws.on('close', () => {
    if (!entry.done) fail(new Error('Fish 连接提前断开'));
  });
  return entry;
}

/** 整段文字已知（章节、固定台词）：一次推完再 stop，不逐句 flush，韵律更连贯 */
export function startFishStream({ hash, file, text, apiKey, model, request, proxy }) {
  const s = openFishSession({ key: hash, file, apiKey, model, request, proxy, flush: false, maxMs: Math.max(120000, text.length * 400) });
  if (!s.chars && !s.ended) {
    for (const piece of splitForStream(text)) s.push(piece);
    s.end();
  }
  return s;
}

/** 把一条流接到 HTTP 响应上：先补发已有的块，再跟着实时往下写 */
export function pipeStream(entry, res) {
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  for (const c of entry.chunks) res.write(c);
  if (entry.done || entry.error) return res.end();
  entry.subs.add(res);
  res.on('close', () => entry.subs.delete(res));
}
