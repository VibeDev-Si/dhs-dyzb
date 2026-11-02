import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { ROOT, loadConfig, getConfig, updateConfig, saveConfig, publicConfig, assertPatch } from './lib/config.mjs';
import { initStore, getState, getLifetime, recordEvent, addAiUsage, addAiEvent, addUsageOnly, pushPlaylist, nextSong, setCurrentSong, patchCurrentSong, addEventOnly, resetDay, flush, scheduleSave } from './lib/store.mjs';
import { beijing, isPeak, ratesFor, costOf } from './lib/pricing.mjs';
import { chatCompletion, fetchBalance } from './lib/ai.mjs';
import { buildMessages, commandReply } from './lib/persona.mjs';
import { DanmakuBridge } from './lib/cortico.mjs';
import { resolveTrack, listLocal, findById, trackPath, musicDir, search as musicSearch, clearCache as clearMusicCache } from './lib/music.mjs';
import { synthesize, listVoices, voiceMediaPath, EDGE_PRESETS, KOKORO_PRESETS } from './lib/voice.mjs';
import {
  initStory,
  saveStory,
  storyView,
  nextDue,
  itemAt,
  markItem,
  startSession,
  stopSession,
  resetStory,
  addSuggestion,
  parseRadioReply,
  fallbackSummary,
  buildRadioMessages,
  fallbackSay,
} from './lib/story.mjs';

const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);

await loadConfig();
await initStore();
await initStory();
const cfg0 = getConfig();
const PORT_FINAL = Number(process.env.PORT || cfg0.port || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ---------- SSE ----------
const clients = new Set();

function sseSend(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(payload) {
  for (const res of clients) {
    try {
      sseSend(res, payload);
    } catch {
      clients.delete(res);
    }
  }
}

// ---------- 余额 ----------
let balance = null;
let balanceAt = 0;

async function refreshBalance(force = false) {
  const cfg = getConfig();
  if (!cfg.ai.apiKey) {
    balance = null;
    return balance;
  }
  if (!force && Date.now() - balanceAt < 60_000) return balance;
  try {
    balance = await fetchBalance({ baseUrl: cfg.ai.baseUrl, apiKey: cfg.ai.apiKey });
    balanceAt = Date.now();
    broadcast({ type: 'balance', balance });
  } catch (err) {
    console.warn('[balance]', err.message);
    balance = { ...(balance || {}), error: err.message, at: Date.now() };
    broadcast({ type: 'balance', balance });
  }
  return balance;
}

// ---------- 统计视图 ----------
function statsView() {
  const s = getState();
  const cfg = getConfig();
  const unlocked = cfg.gifts.filter((g) => s.giftBook[g.name]).length;
  const tokensToday = s.tokensIn + s.tokensOut;
  const life = getLifetime();
  return {
    date: s.date,
    startedAt: s.startedAt,
    income: Number(s.income.toFixed(2)),
    spent: Number(s.spent.toFixed(4)),
    tokensIn: s.tokensIn,
    tokensOut: s.tokensOut,
    tokensToday,
    tokensLifetime: life.tokens,
    costLifetime: life.cost,
    replies: s.replies,
    entries: s.entries,
    follows: s.follows,
    likes: s.likes,
    gifts: s.gifts,
    giftBook: s.giftBook,
    unlocked,
    giftTotal: cfg.gifts.length,
    rice: Number((cfg.riceBase + s.income * 0.1).toFixed(2)),
    salaryTarget: cfg.salaryTarget,
    focusMin: s.startedAt ? Math.max(0, Math.floor((Date.now() - s.startedAt) / 60000)) : 0,
    peak: isPeak(),
  };
}

function songView() {
  const s = getState();
  return { currentSong: s.currentSong, playlist: s.playlist, music: musicView() };
}

function musicView() {
  const cfg = getConfig();
  const tracks = listLocal(cfg);
  return {
    provider: cfg.music?.provider || 'auto',
    dir: cfg.music?.dir || 'music',
    apiBase: cfg.music?.apiBase || '',
    volume: cfg.music?.volume ?? 0.75,
    tracks: tracks.map((t) => ({ id: t.id, title: t.title, by: t.by, size: t.size, file: t.file })),
    count: tracks.length,
  };
}

/** 把当前这首歌解析成可播放地址（点歌、切歌、页面初次加载都会走） */
let resolvingSong = null;
let voiceError = null;

/** 合成用的参数：系统语音看 voice/rate，御姐音看 preset */
function voiceOptsOf(cfg) {
  const v = cfg.voice || {};
  const engine = ['edge', 'kokoro'].includes(v.engine) ? v.engine : 'sapi';
  return {
    engine,
    rate: v.rate ?? 1,
    voice: v.voice || undefined,
    preset: v.preset || (engine === 'kokoro' ? 'xiaobei' : 'natural'),
    speed: v.speed ?? undefined,
  };
}
async function resolveCurrent({ force = false } = {}) {
  const cur = getState().currentSong;
  if (!cur) return null;
  if (!force && cur.url) return cur;
  if (resolvingSong) return resolvingSong;
  resolvingSong = (async () => {
    const cfg = getConfig();
    let hit = null;
    try {
      hit = await resolveTrack(cfg, cur.title, { by: cur.by });
    } catch {
      hit = null;
    }
    const merged = hit
      ? {
          ...cur,
          url: hit.url,
          kind: hit.kind,
          provider: hit.provider,
          providerId: hit.id || '',
          durationSec: hit.durationSec || null,
          resolvedTitle: hit.title || '',
          resolvedBy: hit.by || '',
          resolvedAt: Date.now(),
        }
      : { ...cur, url: '', kind: 'none', provider: '', lastError: '没有可用播放源', resolvedAt: Date.now() };
    setCurrentSong(merged);
    broadcast({ type: 'song', ...songView() });
    return merged;
  })().finally(() => {
    resolvingSong = null;
  });
  return resolvingSong;
}

function songReplyText(title, ok) {
  const s = getState();
  const playing = s.currentSong && s.currentSong.title !== title;
  if (ok && playing) {
    const pos = s.playlist.findIndex((x) => x.title === title) + 1;
    return `收到你的点歌：《${title}》，排在队列第 ${pos || 1} 位，等《${s.currentSong.title}》放完就到它。`;
  }
  return ok
    ? `收到你的点歌：《${title}》，这就放给你听。`
    : `收到你的点歌：《${title}》，已经加入点歌队列。这首歌暂时没有可用播放源，本鲸先记下歌名，稍后再帮你确认。`;
}

function eventView(item) {
  const cfg = getConfig();
  const giftInfo = item.gift ? cfg.gifts.find((g) => g.name === item.gift.name) : null;
  return {
    ...item,
    gift: item.gift
      ? {
          ...item.gift,
          emoji: item.gift.emoji || giftInfo?.emoji || '🎁',
          price: item.gift.price ?? giftInfo?.price ?? 0,
        }
      : null,
  };
}

function pushEvent(item) {
  const view = eventView(item);
  broadcast({ type: 'event', item: view });
  broadcast({ type: 'stats', stats: statsView() });
  return view;
}

// ---------- 发送箱（扩展轮询） ----------
const outbox = [];
let outboxSeq = 1;

function enqueueReply(text) {
  const item = { id: outboxSeq++, text, createdAt: Date.now(), status: 'pending' };
  outbox.push(item);
  if (outbox.length > 30) outbox.splice(0, outbox.length - 30);
  return item;
}

// ---------- AI 回复流水线 ----------
const replyQueue = [];
let pumping = false;
const replyTimes = [];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function scheduleReply(job) {
  const cfg = getConfig();
  // 同一用户短时间内的连续发言只回最后一条
  const idx = replyQueue.findIndex((j) => j.username === job.username);
  if (idx >= 0) replyQueue.splice(idx, 1);
  if (replyQueue.length >= 12) replyQueue.shift();
  replyQueue.push(job);
  pump();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (replyQueue.length) {
      const job = replyQueue.shift();
      const cfg = getConfig();
      const now = Date.now();
      while (replyTimes.length && now - replyTimes[0] > 60_000) replyTimes.shift();
      if (replyTimes.length >= (cfg.ai.maxRepliesPerMinute || 8)) {
        console.log('[reply] 每分钟回复上限，跳过一条');
        continue;
      }
      const wait = Math.max(0, (lastReplyAt || 0) + (cfg.ai.minReplyGapMs || 0) - Date.now());
      if (wait > 0) await sleep(wait);
      lastReplyAt = Date.now();
      replyTimes.push(lastReplyAt);
      try {
        await doReply(job);
      } catch (err) {
        console.warn('[reply] 失败：', err.message);
        pushEvent({ kind: 'system', username: '系统', text: `大肥鱼噎住了：${err.message}`.slice(0, 120) });
      }
    }
  } finally {
    pumping = false;
  }
}

let lastReplyAt = 0;
let lastReplyText = '';

const FALLBACK_REPLIES = [
  '嘿嘿，本鲸听到啦～',
  '这句本鲸记在小本本上了！',
  '呜呜被夸到了，本鲸再写两笔字。',
  '好耶，一起看直播呀～',
  '本鲸正在努力写字，别急别急。',
];

/**
 * 调 AI：主模型（带退避重试）→ 备用模型 → 备用接口。
 * DeepSeek 偶尔会 503「服务太忙」，直接降级成兜底稿太亏，先多试几条路。
 */
let aiLastError = '';
let aiRetry = 0;
async function aiComplete(cfg, messages, opts = {}) {
  const retries = Number.isFinite(Number(cfg.ai.retryAttempts)) ? Number(cfg.ai.retryAttempts) : 3;
  const tries = [];
  const primary = {
    label: '主模型',
    baseUrl: cfg.ai.baseUrl,
    apiKey: cfg.ai.apiKey,
    model: cfg.ai.model,
  };
  tries.push(primary);
  const fbModel = String(cfg.ai.fallbackModel || '').trim();
  if (fbModel && fbModel !== cfg.ai.model) tries.push({ ...primary, label: '备用模型', model: fbModel });
  const backup = cfg.ai.backup || {};
  if (backup.apiKey && backup.baseUrl) {
    tries.push({
      label: '备用接口',
      baseUrl: backup.baseUrl,
      apiKey: backup.apiKey,
      model: backup.model || cfg.ai.model,
    });
  }

  let lastErr = null;
  const errs = [];
  for (const t of tries) {
    if (!t.apiKey) continue;
    try {
      const res = await chatCompletion({
        baseUrl: t.baseUrl,
        apiKey: t.apiKey,
        model: t.model,
        messages,
        temperature: opts.temperature ?? cfg.ai.temperature,
        maxTokens: opts.maxTokens ?? cfg.ai.maxTokens,
        timeoutMs: opts.timeoutMs ?? 45000,
        retries,
      });
      aiLastError = '';
      return { ...res, usedModel: t.model, provider: t.label };
    } catch (err) {
      lastErr = err;
      errs.push(`${t.label} ${t.model}：${String(err.message).slice(0, 120)}`);
      console.warn(`[ai] ${t.label} ${t.model} 没接上：`, err.message);
    }
  }
  // 报错以第一条（主模型）为主，后面附上还试过谁
  aiLastError = errs.join('；');
  throw lastErr || new Error('没有可用的 AI 接口（Key 是空的）');
}

async function doReply(job) {
  const cfg = getConfig();
  const s = getState();

  if (job.kind === 'command') {
    const text = job.text || commandReply(job.command, job.payload || {});
    if (!text) return;
    lastReplyText = text;
    pushEvent(addAiEvent({ text, source: 'command' }));
    enqueueReply(text);
    return;
  }

  const question = job.text;
  if (!question && !job.gift) return;

  // 没 Key：用固定语气兜底，token 记为 0（不假装花了钱）
  if (!cfg.ai.apiKey) {
    const lastAi = [...s.events].reverse().find((e) => e.kind === 'ai')?.text || lastReplyText;
    let text = job.gift
      ? `谢谢${job.username}的${job.gift.name}，本鲸收下了，放在小书桌上。`
      : FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
    if (text === lastAi) {
      const pool = FALLBACK_REPLIES.filter((t) => t !== lastAi);
      text = pool[Math.floor(Math.random() * pool.length)] || text;
    }
    lastReplyText = text;
    pushEvent(addAiEvent({ text, source: 'fallback' }));
    enqueueReply(text);
    return;
  }

  const radio = cfg.story?.enabled;
  const messages = radio
    ? buildRadioMessages(cfg, s, { type: 'reply', gift: job.gift || null, user: job.username, text: question })
    : buildMessages(cfg, s, {
        username: job.username,
        text: job.gift ? `送出了${job.gift.name}×${job.gift.count}` : question,
        recent: s.events.filter((e) => e.kind === 'chat' || e.kind === 'ai').slice(-8),
      });
  const started = Date.now();
  const raw = await aiComplete(cfg, messages, {
    temperature: cfg.ai.temperature,
    maxTokens: radio ? 320 : cfg.ai.maxTokens,
  });
  const text = radio ? parseRadioReply(raw.text).say : raw.text;
  if (!text) return;
  const usage = raw.usage;
  const cost = costOf(usage, ratesFor(cfg.pricing, raw.usedModel || cfg.ai.model));
  const ev = addAiUsage({ usage, cost, replyText: text });
  ev.ms = Date.now() - started;
  lastReplyText = text;
  console.log(
    `[ai] ${job.username} → ${text.slice(0, 30)}… in=${usage?.prompt_tokens ?? 0} out=${usage?.completion_tokens ?? 0} ¥${cost}`,
  );
  pushEvent(ev);
  enqueueReply(text);
}

// ---------- 指令解析 ----------
function parseIdeaCommand(text) {
  const t = String(text || '').trim();
  const m = t.match(/^期待后续[\s:：]*(.+)$/u);
  if (!m) return null;
  const idea = m[1].trim().slice(0, 60);
  return idea || null;
}

function parseSongCommand(text) {
  const t = String(text || '').trim();
  const m = t.match(/^(?:点歌|我想听|来一首|放一首|唱一首)[\s:：]*(.+)$/);
  if (!m) return null;
  let title = m[1]
    .replace(/[（(].*?[)）]/g, '')
    .replace(/(吧|呀|啊|哦|噢|啦|嘛)[。！!~～\s]*$/u, '')
    .trim();
  if (!title) return null;
  return title.slice(0, 40);
}

const CUT_RE = /^(?:切歌|下一首|跳过这首|换一首|跳过)\s*[。！!~～]*$/;

// ---------- 事件入口 ----------
const dedupe = new Map();

function isDuplicate(item) {
  const key = `${item.kind}|${item.username}|${item.text}`;
  const last = dedupe.get(key) || 0;
  const now = Date.now();
  if (now - last < 4000) return true;
  dedupe.set(key, now);
  if (dedupe.size > 500) {
    for (const [k, v] of dedupe) if (now - v > 60_000) dedupe.delete(k);
  }
  return false;
}

function handleIncoming(body) {
  const cfg = getConfig();
  const kind = body.kind || body.type || 'chat';
  const username = String(body.username || body.nickname || body.user || '').trim();
  const text = String(body.text ?? body.content ?? body.msg ?? '').trim();

  let gift = null;
  if (kind === 'gift') {
    const name = String(body.giftName || body.gift?.name || body.gift || '').trim();
    if (!name) return { ok: false, error: '礼物缺少名称' };
    const info = cfg.gifts.find((g) => g.name === name) || null;
    const count = Math.max(1, Number(body.count || body.gift?.count || 1));
    gift = {
      name,
      count,
      emoji: info?.emoji || body.emoji || '🎁',
      price: Number(body.price ?? info?.price ?? 0),
    };
  }

  if (!['chat', 'gift', 'enter', 'follow', 'like'].includes(kind)) {
    return { ok: false, error: '未知事件类型' };
  }
  if (kind === 'chat' && !text) return { ok: false, error: '弹幕内容为空' };

  const item = { kind, username: username || '神秘观众', text, gift, source: body.source || 'extension' };
  if (isDuplicate(item)) return { ok: true, duplicate: true };

  const ev = recordEvent({ ...item, ts: body.ts });
  pushEvent(ev);

  if (ev.kind === 'chat') {
    const idea = parseIdeaCommand(ev.text);
    const title = parseSongCommand(ev.text);
    if (title) {
      const song = pushPlaylist(title, ev.username);
      broadcast({ type: 'song', ...songView() });
      if (song.dup) {
        scheduleReply({
          kind: 'command',
          username: ev.username,
          text: `《${song.title}》已经在队列里啦，本鲸记着呢，等前面那几首放完就到。`,
        });
      } else {
        // 先看这首有没有源，再看它是直接播还是排队
        (async () => {
          const cfgNow = getConfig();
          const target = await resolveTrack(cfgNow, song.title, { title: song.title }).catch(() => null);
          if (!target?.url) {
            scheduleReply({
              kind: 'command',
              username: ev.username,
              text: `收到你的点歌：《${song.title}》，已经加入点歌队列。这首歌暂时没有可用播放源，本鲸先记下歌名，稍后再帮你确认。`,
            });
            return;
          }
          if (song.playing) await resolveCurrent();
          scheduleReply({ kind: 'command', username: ev.username, text: songReplyText(song.title, true) });
        })();
      }
    } else if (idea) {
      addSuggestion({ user: ev.username, text: idea });
      broadcast({ type: 'story', story: storyView(getConfig()) });
      scheduleReply({
        kind: 'command',
        username: ev.username,
        text: '收到你的后续想法，我会把它和其他观众的建议一起分析。',
      });
    } else if (CUT_RE.test(ev.text)) {
      (async () => {
        const cur = nextSong();
        if (cur) await resolveCurrent({ force: true });
        broadcast({ type: 'song', ...songView() });
        scheduleReply({ kind: 'command', command: 'next', payload: { title: cur?.title }, username: ev.username });
      })();
    } else if (cfg.reply.auto && cfg.ai.enabled) {
      scheduleReply({ kind: 'chat', username: ev.username, text: ev.text });
    }
  } else if (ev.kind === 'gift' && cfg.reply.auto && cfg.ai.enabled && cfg.ai.replyToGifts) {
    scheduleReply({ kind: 'chat', username: ev.username, text: '', gift: ev.gift });
  }
  return { ok: true, item: eventView(ev) };
}

// ---------- 演示模式 ----------
const DEMO_USERS = ['鲸鱼小饼干', '不睡觉的猫', '七月', '晚风', '小行星', 'Rin', '白桃汽水', '阿离'];
const DEMO_TEXTS = ['大肥鱼你好呀', '今天也要加油写字！', '主播好可爱', '点歌 晴天', '点歌 平凡之路', '你是真人吗', '晚点还播吗', '本鲸辛苦了'];
const DEMO_GIFTS = ['小心心', '玫瑰', '鲜花', '比心', '棒棒糖'];
// ---- 抖音弹幕直连（cortico 移植版，不用浏览器） ----
const bridge = new DanmakuBridge();

function danmakuView() {
  const cfg = getConfig();
  const s = bridge.status();
  return { ...s, mode: cfg.danmaku?.mode || 'auto', savedRoomId: cfg.danmaku?.roomId || cfg.roomId || '' };
}

bridge.on('event', (ev) => {
  const info = ev.kind === 'gift' ? getConfig().gifts.find((g) => g.name === ev.giftName) : null;
  // 配置里没这个礼物时，按「钻石 ÷ 10 = 元」估一个价（抖音 1 抖币 ≈ 0.1 元）
  const diamond = Number(ev.diamond || 0);
  const estimate = diamond >= 10 ? Math.round((diamond / 10) * 100) / 100 : 0;
  handleIncoming({
    kind: ev.kind,
    username: ev.username,
    text: ev.text,
    giftName: ev.giftName,
    count: ev.count,
    price: info ? info.price : estimate,
    source: 'cortico',
  });
});

bridge.on('status', () => {
  broadcast({ type: 'danmaku', danmaku: danmakuView() });
});

async function startDanmaku(roomId) {
  const rid = String(roomId || '').trim();
  if (!rid) throw new Error('先填直播间号');
  updateConfig({ roomId: rid, danmaku: { ...(getConfig().danmaku || {}), roomId: rid } });
  await saveConfig();
  await bridge.start(rid);
  broadcast({ type: 'danmaku', danmaku: danmakuView() });
  broadcast({ type: 'config', config: publicConfig() });
  console.log(`  📡 弹幕直连 -> ${rid} (${bridge.state})`);
  return danmakuView();
}

function stopDanmaku() {
  bridge.stop();
  broadcast({ type: 'danmaku', danmaku: danmakuView() });
  return danmakuView();
}

let demoTimer = null;

function stopDemo() {
  if (demoTimer) clearInterval(demoTimer);
  demoTimer = null;
}

function startDemo() {
  stopDemo();
  demoTimer = setInterval(() => {
    const r = Math.random();
    if (r < 0.15) {
      handleIncoming({ kind: 'enter', username: DEMO_USERS[Math.floor(Math.random() * DEMO_USERS.length)] });
    } else if (r < 0.3) {
      const g = DEMO_GIFTS[Math.floor(Math.random() * DEMO_GIFTS.length)];
      handleIncoming({
        kind: 'gift',
        username: DEMO_USERS[Math.floor(Math.random() * DEMO_USERS.length)],
        giftName: g,
        count: 1 + Math.floor(Math.random() * 3),
      });
    } else {
      handleIncoming({
        kind: 'chat',
        username: DEMO_USERS[Math.floor(Math.random() * DEMO_USERS.length)],
        text: DEMO_TEXTS[Math.floor(Math.random() * DEMO_TEXTS.length)],
      });
    }
  }, 9000);
}

// ---------- 讲故事（60 分钟电台） ----------
let storyBusy = false;
let storyTimer = null;

function nextWaitMs(cfg) {
  const v = storyView(cfg);
  if (!v.running) return 1200;
  if (!v.next) return 25 * 60_000;
  return Math.max(900, v.next.inSec * 1000 + 1500);
}

function scheduleStory(delay) {
  clearTimeout(storyTimer);
  storyTimer = null;
  const cfg = getConfig();
  if (!cfg.story?.enabled || !cfg.story?.auto || storyBusy) return;
  const v = storyView(cfg);
  if (!v.running && v.finished) return; // 这一场已经收束，等手动「开始这一场」
  storyTimer = setTimeout(() => {
    storyStep().catch((err) => console.warn('[story]', err.message));
  }, Math.min(Math.max(5000, delay ?? nextWaitMs(cfg)), 20 * 60_000));
}

function broadcastStory(story, mood) {
  broadcast({ type: 'story', story, mood: mood || null });
  broadcast({ type: 'stats', stats: statsView() });
}

async function storyStep() {
  const cfg = getConfig();
  if (!cfg.story?.enabled) return { ok: false, error: '故事模式关着' };
  if (storyBusy) return { ok: false, error: '上一段还在讲' };

  const v0 = storyView(cfg);
  if (!v0.running) {
    if (v0.finished) return { ok: false, error: '这一场已经讲完收束了，点「开始这一场」再讲一次' };
    startSession();
  }

  const item = nextDue(getConfig());
  if (!item) {
    const v = storyView(getConfig());
    if (v.running && !v.next) {
      stopSession();
      await saveStory();
      broadcastStory(storyView(getConfig()));
      return { ok: true, finished: true, story: storyView(getConfig()) };
    }
    scheduleStory();
    return { ok: true, waiting: true, story: v };
  }

  storyBusy = true;
  clearTimeout(storyTimer);
  storyTimer = null;

  try {
    let say = '';
    let summary = '';
    let mood = null;

    if (cfg.ai.enabled && cfg.ai.apiKey) {
      const started = Date.now();
      try {
        const res = await aiComplete(cfg, buildRadioMessages(cfg, getState(), item), {
          temperature: Math.max(1.05, Number(cfg.ai.temperature) || 1.1),
          maxTokens: item.type === 'story' ? 3200 : 700,
          timeoutMs: item.type === 'story' ? 240000 : 45000,
        });
        const cost = costOf(res.usage, ratesFor(cfg.pricing, res.usedModel || cfg.ai.model));
        addUsageOnly({ usage: res.usage, cost });
        const parsed = parseRadioReply(res.text);
        say = parsed.say;
        summary = parsed.summary;
        mood = parsed.mood;
        console.log(
          `[story] ${item.type}${item.round >= 0 ? ` r${item.round + 1}` : ''}${Number.isInteger(item.beat) ? ` b${item.beat + 1}` : ''} in=${res.usage?.prompt_tokens ?? 0} out=${res.usage?.completion_tokens ?? 0} ¥${cost} ${Date.now() - started}ms`,
        );
        aiRetry = 0;
      } catch (err) {
        aiRetry += 1;
        console.warn(`[story] AI 没接上（第 ${aiRetry} 次）：`, err.message);
        pushEvent({
          kind: 'system',
          username: '系统',
          text: `故事 AI 暂时没接上：${err.message}`.slice(0, 120),
        });
        // 长篇（开场 / 讲述）别拿兜底稿糊过去：等几秒重来同一条，最多两次
        if (aiRetry <= 2 && (item.type === 'story' || item.type === 'opener')) {
          pushEvent({
            kind: 'system',
            username: '系统',
            text: `这一段先等 ${5 * aiRetry} 秒，自动重来一次（AI 太忙）。`,
          });
          return { ok: false, retrying: true, error: err.message, story: storyView(getConfig()) };
        }
      }
    }

    if (!say) say = fallbackSay(cfg, item);
    if (item.type === 'summary' && !summary) summary = fallbackSummary();
    markItem(getConfig(), item, { say, summary });
    const story = storyView(getConfig());
    await saveStory();
    broadcastStory(story, mood);
    return { ok: true, story, item: { type: item.type, round: item.round ?? -1, beat: item.beat ?? -1 } };
  } catch (err) {
    console.warn('[story] 讲失败了：', err.message);
    return { ok: false, error: err.message };
  } finally {
    storyBusy = false;
    const now = getConfig();
    if (now.story?.enabled && now.story?.auto) scheduleStory();
  }
}

// ---------- 工具 ----------
function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('不是合法 JSON');
  }
}

const AUDIO_MIME = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
};

/** 带 Range 的文件流（<audio> 拖动进度条要它） */
async function streamFile(req, res, file) {
  const info = await stat(file);
  const type = AUDIO_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  const base = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=3600',
    'access-control-allow-origin': '*',
  };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m?.[1] ? Number(m[1]) : 0;
    let end = m?.[2] ? Number(m[2]) : info.size - 1;
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= info.size) end = info.size - 1;
    if (start > end) {
      res.writeHead(416, { ...base, 'content-range': `bytes */${info.size}` });
      return res.end();
    }
    res.writeHead(206, { ...base, 'content-range': `bytes ${start}-${end}/${info.size}`, 'content-length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...base, 'content-length': info.size });
  createReadStream(file).pipe(res);
}

async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not file');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
      'access-control-allow-origin': '*',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}

// ---------- 启动 ----------
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const p = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    });
    return res.end();
  }

  try {
    if (!p.startsWith('/api/')) return await serveStatic(req, res, p);

    // ---- SSE ----
    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'access-control-allow-origin': '*',
        'x-accel-buffering': 'no',
      });
      res.write(': connected\n\n');
      clients.add(res);
      sseSend(res, {
        type: 'init',
        config: publicConfig(),
        stats: statsView(),
        balance,
        song: songView(),
        gifts: getConfig().gifts,
        events: getState().events.slice(-50).map(eventView),
        story: storyView(getConfig()),
        danmaku: danmakuView(),
        aiError: aiLastError,
        serverTime: Date.now(),
      });
      const hb = setInterval(() => {
        try {
          res.write(': hb\n\n');
        } catch {
          clearInterval(hb);
        }
      }, 20000);
      req.on('close', () => {
        clearInterval(hb);
        clients.delete(res);
      });
      return;
    }

    // ---- 打开直播窗时清场：音乐队列、消息队列、弹幕（最多留 50 条）----
    if (p === '/api/session/boot' && req.method === 'POST') {
      const s = getState();
      const clearedPlaylist = s.playlist.length + (s.currentSong ? 1 : 0);
      const clearedEvents = s.events.length;
      s.playlist = [];
      s.currentSong = null;
      s.events = [];
      const clearedOutbox = outbox.length;
      outbox.length = 0;
      outboxSeq = 1;
      const clearedReplies = replyQueue.length;
      replyQueue.length = 0;
      scheduleSave();
      broadcast({ type: 'boot', song: songView(), stats: statsView(), events: [] });
      console.log(
        `[boot] 直播窗打开，清场：音乐 ${clearedPlaylist} 首、消息 ${clearedEvents} 条、发送箱 ${clearedOutbox} 条、待回复 ${clearedReplies} 条`,
      );
      return json(res, 200, {
        ok: true,
        cleared: { song: clearedPlaylist, events: clearedEvents, outbox: clearedOutbox, replies: clearedReplies },
      });
    }

    if (p === '/api/state' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        config: publicConfig(),
        stats: statsView(),
        balance,
        song: songView(),
        gifts: getConfig().gifts,
        events: getState().events.slice(-50).map(eventView),
        story: storyView(getConfig()),
        danmaku: danmakuView(),
        aiError: aiLastError,
        serverTime: Date.now(),
      });
    }

    // ---- 弹幕直连 ----
    if (p === '/api/danmaku' && req.method === 'GET') {
      return json(res, 200, { ok: true, danmaku: danmakuView() });
    }
    if (p === '/api/danmaku/connect' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const danmaku = await startDanmaku(body.roomId || body.rid || '');
        return json(res, 200, { ok: true, danmaku });
      } catch (err) {
        return json(res, 400, { ok: false, error: err.message, danmaku: danmakuView() });
      }
    }
    if (p === '/api/danmaku/disconnect' && req.method === 'POST') {
      return json(res, 200, { ok: true, danmaku: stopDanmaku() });
    }

    // ---- 事件上报（扩展 / 测试） ----
    if (p === '/api/event' && req.method === 'POST') {
      const body = await readBody(req);
      const out = handleIncoming(body);
      return json(res, out.ok ? 200 : 400, out);
    }

    // ---- 发送箱 ----
    if (p === '/api/outbox' && req.method === 'GET') {
      const now = Date.now();
      for (const it of outbox) {
        if (it.status === 'pending' && now - it.createdAt > 90_000) it.status = 'expired';
      }
      return json(res, 200, {
        ok: true,
        items: outbox.filter((it) => it.status === 'pending'),
        all: outbox.slice(-10).reverse(),
      });
    }

    if (p === '/api/outbox/ack' && req.method === 'POST') {
      const body = await readBody(req);
      const ids = new Set((body.ids || [body.id]).map(Number).filter(Boolean));
      for (const it of outbox) {
        if (ids.has(it.id)) {
          it.status = body.ok === false ? 'failed' : 'sent';
          it.error = body.error || null;
        }
      }
      return json(res, 200, { ok: true });
    }

    // ---- 手动说话（操作台） ----
    if (p === '/api/say' && req.method === 'POST') {
      const body = await readBody(req);
      const text = String(body.text || '').trim();
      if (!text) return json(res, 400, { ok: false, error: '内容为空' });
      const ev = addEventOnly({ id: Date.now(), ts: Date.now(), kind: 'host', username: body.username || '主播', text, source: 'operator' });
      pushEvent(ev);
      const out = enqueueReply(text);
      return json(res, 200, { ok: true, item: eventView(ev), outboxId: out.id });
    }

    // ---- 直接让大肥鱼回一句（测试 / 手动触发） ----
    if (p === '/api/ai/reply' && req.method === 'POST') {
      const body = await readBody(req);
      const text = String(body.text || '').trim();
      if (!text) return json(res, 400, { ok: false, error: '内容为空' });
      await doReply({ kind: 'chat', username: body.username || '测试观众', text });
      return json(res, 200, { ok: true, latest: getState().events.at(-1) });
    }

    if (p === '/api/ai/test' && req.method === 'POST') {
      const cfg = getConfig();
      const started = Date.now();
      const raw = await aiComplete(
        cfg,
        buildMessages(cfg, getState(), { username: '测试观众', text: '在吗？用一句话打个招呼' }),
        { temperature: cfg.ai.temperature, maxTokens: 120, timeoutMs: 30000 },
      );
      const cost = costOf(raw.usage, ratesFor(cfg.pricing, raw.usedModel || cfg.ai.model));
      return json(res, 200, {
        ok: true,
        text: raw.text,
        usage: raw.usage,
        cost,
        provider: raw.provider,
        model: raw.usedModel,
        ms: Date.now() - started,
        peak: isPeak(),
      });
    }

    // ---- 配置 ----
    if (p === '/api/config' && req.method === 'GET') {
      return json(res, 200, { ok: true, config: publicConfig() });
    }

    if (p === '/api/config' && req.method === 'POST') {
      const body = await readBody(req);
      // 两种写法都收：直接 {ai:{...}}，或者包一层 {patch:{ai:{...}}}
      const patch = body && body.patch && typeof body.patch === 'object' ? body.patch : body;
      assertPatch(patch);
      updateConfig(patch);
      await saveConfig();
      if (patch.ai?.apiKey) balanceAt = 0;
      if (patch.demo !== undefined) {
        patch.demo ? startDemo() : stopDemo();
      }
      broadcast({ type: 'config', config: publicConfig() });
      await refreshBalance(true);
      return json(res, 200, { ok: true, config: publicConfig() });
    }

    // ---- 余额 ----
    if (p === '/api/balance' && req.method === 'GET') {
      const b = await refreshBalance(url.searchParams.get('force') === '1');
      return json(res, 200, { ok: Boolean(b && !b.error), balance: b });
    }

    // ---- 切歌 / 重置 ----
    if (p === '/api/song/next' && req.method === 'POST') {
      const cur = nextSong();
      if (cur) await resolveCurrent({ force: true });
      broadcast({ type: 'song', ...songView() });
      return json(res, 200, { ok: true, song: cur });
    }

    // ---- 音乐播放源 ----
    if (p === '/api/music' && req.method === 'GET') {
      return json(res, 200, { ok: true, music: musicView() });
    }

    if (p === '/api/music/reindex' && req.method === 'POST') {
      clearMusicCache();
      listLocal(getConfig(), { force: true });
      broadcast({ type: 'song', ...songView() });
      return json(res, 200, { ok: true, music: musicView() });
    }

    if (p === '/api/music/resolve' && req.method === 'POST') {
      const cur = await resolveCurrent({ force: true });
      return json(res, 200, { ok: true, currentSong: cur, music: musicView() });
    }

    // 前端 <audio> 播完一首 → 自动下一首
    if (p === '/api/music/ended' && req.method === 'POST') {
      const cur = nextSong();
      if (cur) await resolveCurrent({ force: true });
      broadcast({ type: 'song', ...songView() });
      return json(res, 200, { ok: true, currentSong: cur, song: songView() });
    }

    if (p === '/api/music/search' && req.method === 'GET') {
      const q = url.searchParams.get('q') || '';
      const list = await musicSearch(getConfig(), q).catch(() => []);
      return json(res, 200, { ok: true, q, list });
    }

    // 操作台手动指定一首（不经过弹幕点歌）
    if (p === '/api/music/play' && req.method === 'POST') {
      const body = await readBody(req);
      const title = String(body.title || '').trim();
      if (!title) return json(res, 400, { ok: false, error: '歌名不能为空' });
      setCurrentSong({ title, by: String(body.by || '点歌') });
      clearMusicCache();
      await resolveCurrent({ force: true });
      return json(res, 200, { ok: true, song: songView() });
    }

    if (p.startsWith('/api/music/stream/') && req.method === 'GET') {
      const id = decodeURIComponent(p.slice('/api/music/stream/'.length));
      const track = findById(getConfig(), id);
      const file = track && trackPath(getConfig(), track);
      if (!file || !existsSync(file)) return json(res, 404, { ok: false, error: '没有这个文件' });
      return streamFile(req, res, file);
    }

    // ---- 大肥鱼的声音（系统离线 / edge-tts 御姐音）----
    if (p === '/api/voice' && req.method === 'GET') {
      const cfg = getConfig();
      return json(res, 200, {
        ok: true,
        voice: {
          enabled: cfg.voice?.enabled !== false,
          volume: cfg.voice?.volume ?? 0.9,
          rate: cfg.voice?.rate ?? 1,
          engine: cfg.voice?.engine || 'edge',
          preset: cfg.voice?.preset || 'natural',
          name: cfg.voice?.voice || '',
          voices: await listVoices().catch(() => []),
          presets: EDGE_PRESETS,
          kokoro: KOKORO_PRESETS,
          lastError: voiceError,
        },
      });
    }

    if (p === '/api/voice/test' && req.method === 'POST') {
      const cfg = getConfig();
      try {
        const r = await synthesize('晚上好呀，我是大肥鱼，今天也来讲故事给你听。', voiceOptsOf(cfg));
        return json(res, 200, { ok: true, ...r });
      } catch (e) {
        voiceError = e.message;
        return json(res, 500, { ok: false, error: e.message });
      }
    }

    if (p === '/api/voice/say' && req.method === 'POST') {
      const body = await readBody(req);
      const text = String(body.text || '').slice(0, 3000);
      if (!text.trim()) return json(res, 400, { ok: false, error: '没有可念的文字' });
      const cfg = getConfig();
      try {
        const r = await synthesize(text, voiceOptsOf(cfg));
        voiceError = null;
        return json(res, 200, { ok: true, ...r });
      } catch (e) {
        voiceError = e.message;
        return json(res, 500, { ok: false, error: e.message });
      }
    }

    if (p.startsWith('/api/voice/') && req.method === 'GET') {
      const file = voiceMediaPath(p.slice('/api/voice/'.length));
      if (!file) return json(res, 404, { ok: false, error: '没有这段语音' });
      return streamFile(req, res, file);
    }

    if (p === '/api/reset' && req.method === 'POST') {
      resetDay();
      // 顺手清掉不在礼物表里的历史键（比如手滑造出来的假名字）
      const gs = getState();
      const names = new Set(getConfig().gifts.map((g) => g.name));
      for (const k of Object.keys(gs.giftBook)) if (!names.has(k)) delete gs.giftBook[k];
      broadcast({ type: 'init', config: publicConfig(), stats: statsView(), balance, song: songView(), gifts: getConfig().gifts, events: [], story: storyView(getConfig()) });
      return json(res, 200, { ok: true, stats: statsView() });
    }

    // ---- 讲故事 ----
    if (p === '/api/story' && req.method === 'GET') {
      return json(res, 200, { ok: true, story: storyView(getConfig()), tokens: statsView() });
    }

    if (p === '/api/story/start' && req.method === 'POST') {
      startSession();
      await saveStory();
      scheduleStory(400);
      const story = storyView(getConfig());
      broadcast({ type: 'story', story });
      return json(res, 200, { ok: true, story });
    }

    if (p === '/api/story/stop' && req.method === 'POST') {
      stopSession();
      await saveStory();
      clearTimeout(storyTimer);
      storyTimer = null;
      const story = storyView(getConfig());
      broadcast({ type: 'story', story });
      return json(res, 200, { ok: true, story });
    }

    if (p === '/api/story/next' && req.method === 'POST') {
      const out = await storyStep();
      return json(res, out.ok ? 200 : 400, out);
    }

    if (p === '/api/story/auto' && req.method === 'POST') {
      const body = await readBody(req);
      const on = body.auto !== false;
      updateConfig({ story: { auto: on } });
      await saveConfig();
      broadcast({ type: 'config', config: publicConfig() });
      if (on) scheduleStory(500);
      else {
        clearTimeout(storyTimer);
        storyTimer = null;
      }
      return json(res, 200, { ok: true, story: storyView(getConfig()) });
    }

    if (p === '/api/story/reset' && req.method === 'POST') {
      resetStory();
      startSession();
      await saveStory();
      const story = storyView(getConfig());
      broadcast({ type: 'story', story });
      scheduleStory(800);
      return json(res, 200, { ok: true, story });
    }

    if (p === '/api/story/config' && req.method === 'POST') {
      const body = await readBody(req);
      const patch = {};
      const textKeys = ['title', 'genre', 'world', 'hero', 'cast', 'conflict', 'mystery', 'ending'];
      for (const k of textKeys) {
        if (typeof body[k] === 'string') patch[k] = body[k].trim().slice(0, 1200);
      }
      for (const k of ['openerMin', 'storyMin', 'interactMin', 'totalMin']) {
        if (body[k] !== undefined && body[k] !== '') patch[k] = Math.max(1, Math.min(180, Math.round(Number(body[k]) || 0)));
      }
      if (Array.isArray(body.opener)) {
        patch.opener = body.opener.map((x) => String(x).trim().slice(0, 260)).filter(Boolean).slice(0, 16);
      }
      for (const k of ['immutable', 'changeable']) {
        if (Array.isArray(body[k])) {
          patch[k] = body[k].map((x) => String(x).trim().slice(0, 160)).filter(Boolean).slice(0, 12);
        }
      }
      if (Array.isArray(body.rounds)) {
        patch.rounds = body.rounds
          .map((r, i) => ({
            chapter: String(r?.chapter || '').trim().slice(0, 40) || `第 ${i + 1} 段`,
            beats: Array.isArray(r?.beats)
              ? r.beats.map((b) => String(b).trim().slice(0, 260)).filter(Boolean).slice(0, 10)
              : [],
            defaultNext: String(r?.defaultNext || '').trim().slice(0, 160),
            choices: Array.isArray(r?.choices)
              ? r.choices.map((c) => String(c).trim().slice(0, 120)).filter(Boolean).slice(0, 4)
              : [],
          }))
          .filter((r) => r.beats.length)
          .slice(0, 8);
      }
      updateConfig({ story: patch });
      await saveConfig();
      resetStory();
      startSession();
      await saveStory();
      const story = storyView(getConfig());
      broadcast({ type: 'story', story });
      broadcast({ type: 'config', config: publicConfig() });
      if (getConfig().story?.auto) scheduleStory(1200);
      return json(res, 200, { ok: true, story });
    }

    if (p === '/api/health' && req.method === 'GET') {
      return json(res, 200, { ok: true, up: process.uptime(), clients: clients.size, peak: isPeak(), time: beijing() });
    }

    return json(res, 404, { ok: false, error: '没有这个接口' });
  } catch (err) {
    console.warn('[http]', p, err.message);
    return json(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT_FINAL, '127.0.0.1', () => {
  const cfg = getConfig();
  console.log('');
  console.log('  🐋 大肥鱼直播间已启动');
  console.log(`     直播画面  http://127.0.0.1:${PORT_FINAL}/`);
  console.log(`     操作台    http://127.0.0.1:${PORT_FINAL}/admin`);
  console.log(`     API Key   ${cfg.ai.apiKey ? '已配置' : '未配置（可在 /admin 里填）'}`);
  console.log(`     音乐源    ${cfg.music?.provider || 'auto'} · 本地 ${listLocal(cfg).length} 首`);
  console.log('');
  if (getState().currentSong && !getState().currentSong.url) resolveCurrent({ force: true });
  if (cfg.demo) startDemo();
  if (cfg.story?.enabled && cfg.story?.auto) {
    const v = storyView(cfg);
    if (!v.running) console.log('  📖 故事电台：没有在播，点操作台「开始这一场」或等自动开始');
    scheduleStory(2200);
  }
  if (cfg.danmaku?.mode !== 'off') {
    const rid = cfg.danmaku?.roomId || cfg.roomId || '';
    if (rid) {
      startDanmaku(rid).catch(() => {});
    } else {
      console.log('  📡 弹幕直连：还没填房间号（操作台「弹幕接入」里填，或等开播后填）');
    }
  }
});

process.on('SIGINT', async () => {
  stopDemo();
  bridge.stop();
  await flush();
  process.exit(0);
});
