import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { ROOT, loadConfig, getConfig, updateConfig, saveConfig, publicConfig, assertPatch, resolveProxySubmit } from './lib/config.mjs';
import { initStore, getState, getLifetime, recordEvent, addAiUsage, addAiEvent, addUsageOnly, pushPlaylist, nextSong, setCurrentSong, patchCurrentSong, addEventOnly, resetDay, flush, scheduleSave } from './lib/store.mjs';
import { beijing, isPeak, ratesFor, costOf } from './lib/pricing.mjs';
import { chatCompletion, fetchBalance } from './lib/ai.mjs';
import { buildMessages, commandReply } from './lib/persona.mjs';
import { DanmakuBridge } from './lib/cortico.mjs';
import { resolveTrack, listLocal, findById, trackPath, musicDir, search as musicSearch, clearCache as clearMusicCache, neteaseMember, neteaseCookieOf, takeResolveReason } from './lib/music.mjs';
import { synthesize, listVoices, voiceMediaPath, EDGE_PRESETS, KOKORO_PRESETS, MINIMAX_PRESETS, FISH_PRESETS, FISH_MODELS, getFishStream, pipeFishStream, testFishConnection } from './lib/voice.mjs';
import { resolveProxy, maskProxy } from './lib/proxy.mjs';
import {
  initNovel,
  saveNovel,
  novelView as storyView,
  startNovel,
  currentChapter,
  chaptersOf,
  novelInfo,
  chapterCount,
  endChapter,
  beginReading,
  nextChapter,
  resetNovel as resetStory,
  nextStartMs,
  markReminded,
  setAudio,
  setSummary,
  setCard,
  buildCardMessages,
  parseCard,
  fallbackCard,
  castNames,
  setArchive,
  addTopic,
  topTopics,
  getNovel,
  listNovels,
  loadNovelFile,
  novelDir,
  stopNovel,
  buildBreakMessages,
  buildArchiveMessages,
  parseArchive,
  fallbackArchive,
  spokenTitle,
  speechOf,
  setAudioMs,
  setDisplayMode,
} from './lib/novel.mjs';
import * as radio from './lib/radio.mjs';

const PUBLIC_DIR = path.join(ROOT, 'public');
const isRadio = () => (getConfig().mode || 'radio') === 'radio';
const PORT = Number(process.env.PORT || 8787);

await loadConfig();
await initStore();
await initNovel(getConfig());
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
  return {
    currentSong: s.currentSong,
    playlist: s.playlist,
    queueMax: Number(getConfig().music?.queueMax ?? 3),
    music: musicView(),
  };
}

function musicView() {
  const cfg = getConfig();
  const tracks = listLocal(cfg);
  return {
    provider: cfg.music?.provider || 'auto',
    dir: cfg.music?.dir || 'music',
    apiBase: cfg.music?.apiBase || '',
    volume: cfg.music?.volume ?? 0.2,
    queueMax: cfg.music?.queueMax ?? 3,
    hasCookie: Boolean(neteaseCookieOf(cfg)),
    member: memberCache,
    tracks: tracks.map((t) => ({ id: t.id, title: t.title, by: t.by, size: t.size, file: t.file })),
    count: tracks.length,
  };
}

/* 网易云会员登录态：60 秒缓存，避免每次刷新页面都去打接口 */
let memberCache = null;
let memberAt = 0;
async function refreshMember({ force = false } = {}) {
  const cfg = getConfig();
  if (!neteaseCookieOf(cfg)) {
    memberCache = { loggedIn: false, hasCookie: false };
    memberAt = Date.now();
    return memberCache;
  }
  if (!force && memberCache && Date.now() - memberAt < 60_000) return memberCache;
  memberCache = await neteaseMember(cfg);
  memberAt = Date.now();
  return memberCache;
}

/** 把当前这首歌解析成可播放地址（点歌、切歌、页面初次加载都会走） */
let resolvingSong = null;
let voiceError = null;

/** 合成用的参数：各引擎共用 rate/preset，MiniMax 额外读取专属配置 */
function voiceOptsOf(cfg, extra = {}) {
  const v = cfg.voice || {};
  const engine = ['edge', 'kokoro', 'minimax', 'fish'].includes(v.engine) ? v.engine : 'sapi';
  const defaultPreset = { kokoro: 'xiaobei', minimax: 'lyrical', fish: 'storyteller' }[engine] || 'natural';
  return {
    engine,
    rate: v.rate ?? 1,
    voice: v.voice || undefined,
    preset: v.preset || defaultPreset,
    fishModel: v.fishModel || undefined,
    fishVoice: v.fishVoice || undefined,
    fishTemperature: v.fishTemperature ?? undefined,
    fishProxyMode: v.fishProxyMode || 'system',
    fishProxy: v.fishProxy || '',
    fishStream: v.fishStream !== false,
    fishApiKey: v.fishApiKey || undefined,
    speed: v.speed ?? undefined,
    minimaxVoice: v.minimaxVoice || undefined,
    minimaxModel: v.minimaxModel || undefined,
    minimaxEmotion: v.minimaxEmotion || undefined,
    minimaxBaseUrl: v.minimaxBaseUrl || undefined,
    minimaxPitch: v.minimaxPitch ?? 0,
    minimaxApiKey: v.minimaxApiKey || undefined,
    ...extra,
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
    if (merged.url) ensureSystemVolume().catch(() => {});
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
  // 电台模式：点歌/切歌这类固定回复交给电台按节拍念，普通弹幕在 handleIncoming 里已经交给电台
  if (isRadio()) {
    if (job.kind === 'command') radio.enqueueFixed(job.text || commandReply(job.command, job.payload || {}));
    return;
  }
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

// 休息/讨论阶段用语音回复，不占聊天框；朗读阶段照常回在聊天框里
function replyPhase() {
  const p = getNovel()?.phase || 'idle';
  /* 只要不是在念正文（含准备中），都用语音回观众 */
  return p === 'reading' || p === 'preparing' ? 'chat' : 'voice';
}

async function speakReply(text) {
  const cfg = getConfig();
  try {
    const out = await synthesize(text, voiceOptsOf(cfg, { maxChars: 1500 }));
    return out.url || '';
  } catch (err) {
    console.warn('[voice] 弹幕回复合成失败：', err.message);
    return '';
  }
}

async function doReply(job) {
  const cfg = getConfig();
  const s = getState();
  const mode = replyPhase();

  const deliver = async (text, extra = {}) => {
    if (!text) return;
    lastReplyText = text;
    if (mode === 'voice') {
      const url = await speakReply(text);
      pushEvent(addAiEvent({ text, source: extra.source || 'ai', voiceOnly: true, voice: url }));
      return;
    }
    pushEvent(addAiEvent({ text, source: extra.source || 'ai' }));
    enqueueReply(text);
  };

  if (job.kind === 'command') {
    const text = job.text || commandReply(job.command, job.payload || {});
    await deliver(text, { source: 'command' });
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
    await deliver(text, { source: 'fallback' });
    return;
  }

  const nv = getNovel();
  const phase = nv?.phase || 'idle';
  const discuss = phase === 'break' || phase === 'afterword';
  const messages = discuss
    ? buildBreakMessages(cfg, {
        username: job.username,
        text: question,
        gift: job.gift ? job.gift.name : '',
        chapterTitle: currentChapter()?.title || '',
        summary: nv?.summaries?.[nv.idx] || '',
        pastSummaries: (nv?.summaries || []).filter(Boolean),
        topics: topTopics(5),
      })
    : buildMessages(cfg, s, {
        username: job.username,
        text: job.gift ? `送出了${job.gift.name}×${job.gift.count}` : question,
        recent: s.events.filter((e) => e.kind === 'chat' || e.kind === 'ai').slice(-8),
      });

  /* 还没到开讲时间：陪聊，但别把今晚的剧情说漏 */
  if (!discuss) {
    const pre = idleHint(cfg);
    if (pre) messages.push({ role: 'system', content: pre });
  }

  /* 让回复知道现在念到哪一章（模型不知道就会编成「第二十三章」） */
  if (phase === 'reading' || phase === 'preparing') {
    const c = currentChapter();
    const nv2 = getNovel();
    if (c) {
      messages.push({
        role: 'system',
        content: `现在正在念《${nv2?.title || ''}》的第 ${(nv2?.idx ?? 0) + 1} 章「${c.title || ''}」（共 ${chaptersOf()?.length || 1} 章）。聊到进度就按这个说，不要编章号，也不要提前讲后面的情节。`,
      });
    }
  }

  const started = Date.now();
  const raw = await aiComplete(cfg, messages, {
    temperature: cfg.ai.temperature,
    maxTokens: mode === 'voice' ? 260 : cfg.ai.maxTokens,
  });
  const text = String(raw.text || '')
    .replace(/^["“「]|["”」]$/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
  if (!text) return;
  const usage = raw.usage;
  const cost = costOf(usage, ratesFor(cfg.pricing, raw.usedModel || cfg.ai.model));
  const ev = addAiUsage({ usage, cost, replyText: text });
  ev.ms = Date.now() - started;
  console.log(
    `[ai] ${job.username} → ${text.slice(0, 30)}… in=${usage?.prompt_tokens ?? 0} out=${usage?.completion_tokens ?? 0} ¥${cost}`,
  );
  if (mode === 'voice') {
    // 语音回复：不进聊天框，也不推给扩展
    const url = await speakReply(text);
    ev.voiceOnly = true;
    ev.voice = url;
    pushEvent(ev);
    return;
  }
  pushEvent(ev);
  enqueueReply(text);
}

// ---------- 指令解析 ----------
// 观众提选题：给明天的故事投票（休息和讨论时都能提）
function parseTopicCommand(text) {
  const t = String(text || '').trim();
  const m = t.match(/^(?:选题|投票|提选题|建议选题|我想看|想听)[\s:：]*(.+)$/u);
  if (!m) return null;
  const idea = m[1].trim().slice(0, 80);
  return idea || null;
}

function parseStoryDisplayCommand(text) {
  const t = String(text || '').trim().replace(/[。！？!?~～\s]+$/u, '');
  if (/^查看角色$/u.test(t)) return 'characters';
  if (/^查看设定$/u.test(t)) return 'settings';
  if (/^(?:查看故事|返回故事|继续故事)$/u.test(t)) return 'story';
  return null;
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
  /* 礼物不做 4 秒去重：同一人连送两次同名小礼物是正常行为（重复上报由 giftId 兜底在桥里处理） */
  if (kind !== 'gift' && isDuplicate(item)) return { ok: true, duplicate: true };
  if (kind === 'gift') console.log(`[gift] ${item.username} 送出 ${gift.name} ×${gift.count}（¥${gift.price}）source=${item.source}`);

  const ev = recordEvent({ ...item, ts: body.ts });
  pushEvent(ev);

  if (isRadio()) {
    if (ev.kind === 'enter') radio.onEnter(ev.username);
    else if (ev.kind === 'gift' && cfg.ai.replyToGifts !== false) radio.onGift(ev.username, ev.gift);
    else if (ev.kind === 'like' || ev.kind === 'follow') radio.onActivity();
  }

  if (ev.kind === 'chat') {
    const displayMode = isRadio() ? null : parseStoryDisplayCommand(ev.text);
    const topic = parseTopicCommand(ev.text);
    const title = parseSongCommand(ev.text);
    if (displayMode) {
      if (getNovel()?.file) {
        setDisplayMode(displayMode);
        broadcastNovel('type');
      }
      return { ok: true, item: eventView(ev), displayMode };
    }
    if (title) {
      const queueMax = Number(getConfig().music?.queueMax ?? 3);
      const song = pushPlaylist(title, ev.username, queueMax);
      broadcast({ type: 'song', ...songView() });
      ensureSystemVolume().catch(() => {});
      if (song.full) {
        const cur = getState().currentSong?.title;
        scheduleReply({
          kind: 'command',
          username: ev.username,
          text: `队列已经排了 ${queueMax} 首啦${cur ? `，等《${cur}》放完再点吧` : '，等前面放完再点吧'}，本鲸记不下更多了。`,
        });
      } else if (song.dup) {
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
            const miss = takeResolveReason();
            const why =
              miss.reason === 'vip'
                ? `这首《${miss.title || song.title}》要网易云会员才能放，本鲸现在没登录会员，先记下歌名，等登录了再点一次。`
                : miss.reason === 'vip-expired'
                  ? `这首《${miss.title || song.title}》本鲸这边会员取不到地址，可能是会员过期或者登录失效了，先记下歌名。`
                  : `收到你的点歌：《${song.title}》，已经加入点歌队列。这首歌暂时没有可用播放源，本鲸先记下歌名，稍后再帮你确认。`;
            scheduleReply({ kind: 'command', username: ev.username, text: why });
            return;
          }
          if (song.playing) await resolveCurrent();
          scheduleReply({ kind: 'command', username: ev.username, text: songReplyText(song.title, true) });
        })();
      }
    } else if (isRadio()) {
      // 电台：「话题 XXX」、心事、提问都交给电台（词库检查、危机提醒、话题墙都在 radio.mjs）
      if (cfg.reply.auto && cfg.ai.enabled !== false) radio.onChat({ username: ev.username, text: ev.text });
      else radio.onActivity();
    } else if (topic) {
      const item = addTopic(topic, ev.username);
      broadcastNovel();
      const rank = topTopics(12).findIndex((t) => t.text === item?.text);
      scheduleReply({
        kind: 'command',
        username: ev.username,
        text:
          `收到你的选题：《${item?.text || topic}》，本鲸记进明天的候选里了` +
          (rank >= 0 ? `，现在排第 ${rank + 1} 位。` : '。'),
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
  return {
    ...s,
    mode: cfg.danmaku?.mode || 'auto',
    savedRoomId: cfg.danmaku?.roomId || cfg.roomId || '',
    hasCookie: Boolean(cfg.danmaku?.cookie),
  };
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
  await bridge.start(rid, { cookie: getConfig().danmaku?.cookie || '' });
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

// ---------- 念小说（章节驱动，不用固定排期） ----------
let novelBusy = false;
let novelRetry = 0;
let novelTimer = null;

/* ---------- 系统音量自检 ----------
 * 这台机器的 USB 声卡闲下来会把主音量重置到很低（实测见过 0.02 / 0.06），
 * 页面里怎么调都没用 —— 所以每次开始放歌/念书时，顺手确认一下系统音量，
 * 低于 0.35 就用音量键抬到 0.6。只抬不降；三分钟内最多跑一次。 */
let sysVolAt = 0;
let sysVolBusy = false;
let sysVolLast = '';

function ensureSystemVolume({ force = false } = {}) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const cfg = getConfig();
  /* 默认关：系统音量是使用者自己调的，别自作主张改它 —— 要在操作台勾上才自动抬 */
  if (!force && !cfg.audio?.autoVolume) return Promise.resolve(null);
  const now = Date.now();
  if (!force && (sysVolBusy || now - sysVolAt < 180_000)) return Promise.resolve(null);
  const target = Math.min(1, Math.max(0.1, Number(cfg.audio?.target ?? 0.6) || 0.6));
  const script = path.join(ROOT, 'tools', 'audio-loud.ps1');
  if (!existsSync(script)) return Promise.resolve(null);
  sysVolAt = now;
  sysVolBusy = true;
  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, String(target)],
      { timeout: 90000, windowsHide: true },
      (err, stdout) => {
        sysVolBusy = false;
        const line = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
        sysVolLast = err ? `失败：${err.message}` : line;
        if (!err && line) console.log(`[audio] ${line}`);
        resolve(line || null);
      },
    );
  });
}

function novelDirLabel() {
  return novelDir(getConfig()).replace(ROOT, '.');
}

function broadcastNovel(mood) {
  broadcast({ type: 'story', story: storyView(getConfig()), mood: mood || null });
  broadcast({ type: 'stats', stats: statsView() });
}

function scheduleNovel(delay) {
  clearTimeout(novelTimer);
  novelTimer = null;
  const cfg = getConfig();
  if (isRadio() || !cfg.novel?.enabled || !cfg.novel?.auto || novelBusy) return;
  novelTimer = setTimeout(() => {
    novelStep().catch((err) => console.warn('[novel]', err.message));
  }, Math.min(Math.max(400, delay ?? 600), 60 * 60_000));
}

/* ---------------- 定时开讲 ---------------- */

const REMIND_BEFORE_MS = 5 * 60_000;

function fmtHm(ms) {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 今晚这场要念的书（还没开讲时用来预告，不改变任何状态） */
function upcomingBook(cfg) {
  const top = listNovels(cfg)[0];
  if (!top) return null;
  let chapters = Number(top.chapters) || 0;
  let title = top.title || '';
  if (!chapters) {
    try {
      const f = loadNovelFile(cfg, top.name);
      chapters = f?.chapters?.length || 0;
      title = f?.title || title;
    } catch {
      /* 读不到就算了，预告里就不书说几章 */
    }
  }
  return { title: title || '今晚这本', chapters };
}

/** 还没到开讲时间时给模型的一句提示（陪聊、别剧透） */
function idleHint(cfg) {
  if (!cfg.novel?.enabled) return '';
  const nv = getNovel();
  const phase = nv?.phase || 'idle';
  if (phase !== 'idle' && phase !== 'done') return '';
  const at = nextStartMs(cfg);
  if (!at) return '';
  const book = upcomingBook(cfg);
  const desc = book
    ? `今晚念《${book.title}》${book.chapters ? `，一共 ${book.chapters} 章` : ''}`
    : '今晚这本还没落到书桌上';
  return (
    `现在还没开讲（${fmtHm(at)} 开始，${desc}）。这几分钟就是陪观众聊天：聊日常、聊上一本听了什么、催他们点歌都行。` +
    `绝对不要提前讲今晚的剧情、不要透露结局，被问到就说「等开讲你就知道了」。`
  );
}

/** 开讲前 5 分钟在直播间喊一声（页面 + 语音 + 抖音公屏） */
async function announceSoon(cfg, at) {
  const book = upcomingBook(cfg);
  const text = book
    ? `还有五分钟，${fmtHm(at)} 准时开讲。今晚念《${book.title}》${book.chapters ? `，一共 ${book.chapters} 章` : ''}。先把灯点上，本鲸喝口水就开。`
    : `还有五分钟就开讲了，${fmtHm(at)} 准时开始。今晚这本还没落到书桌上，本鲸先去翻一翻。`;
  let voice = '';
  try {
    const out = await synthesize(text, voiceOptsOf(cfg, { maxChars: 400 }));
    voice = out.url || '';
  } catch (err) {
    console.warn('[voice] 开讲提醒合成失败：', err.message);
  }
  pushEvent(addAiEvent({ text, source: 'schedule', voice }));
  enqueueReply(text);
  broadcastNovel('wave');
  console.log('[schedule] 已发开讲提醒：', fmtHm(at));
}

/** 每分钟看一眼：到点提醒 / 到点开讲 */
async function storyScheduleTick() {
  const cfg = getConfig();
  if (isRadio() || !cfg.novel?.enabled) return;
  /* 没设时间就按默认 17:00（页面也显示这个） */
  const at = nextStartMs(cfg);
  if (!at) return;
  const now = Date.now();
  const nv = getNovel();
  const phase = nv?.phase || 'idle';
  const idle = phase === 'idle' || phase === 'done' || phase === 'afterword';
  if (!idle) return;

  /* 5 分钟提醒：同一场只喊一次 */
  if (now >= at - REMIND_BEFORE_MS && now < at && nv?.remindedFor !== at) {
    markReminded(at);
    await announceSoon(cfg, at);
    return;
  }

  /* 到点自动开讲：每次都从「目录里最新的一本」开始，不接着昨天那本 */
  if (cfg.novel.autoStart !== false && now >= at && now < at + 3 * 60_000) {
    const newest = listNovels(cfg)[0];
    startNovel(cfg, newest ? { file: newest.name } : {});
    pushEvent({
      kind: 'system',
      username: '系统',
      text: `到点了（${fmtHm(at)}），开始念书。`,
    });
    broadcastNovel('type');
    scheduleNovel(600);
    console.log('[schedule] 到点开讲');
  }
}

async function synthChapter(cfg, ch) {
  const say = `${spokenTitle(ch.title)}。\n${speechOf(ch.text)}`;
  const out = await synthesize(say, voiceOptsOf(cfg, { maxChars: 40000 }));
  if (out.streaming) {
    console.log(`[voice] Fish 流式：${out.ms}ms 出第一块音频，边合成边念`);
    // 流结束后按字节数算出真实时长，让看门狗和纸面滚动用准确的数字
    out.finished?.then((r) => {
      if (r?.ms && getNovel()?.audioUrl === out.url) {
        setAudioMs(r.ms);
        if (getNovel()?.phase === 'reading') scheduleNovel(watchdogDelay());
        broadcastNovel();
      }
      if (r?.error) console.warn('[voice] Fish 流式中断：', r.error);
    });
  }
  return out.url || '';
}

/** 看门狗用的时长估算：edge 御姐音大约每秒 4 个字 */
function estChapterMs(text) {
  return Math.round((String(text || '').length / 4) * 1000 * 1.25) + 20000;
}

/** 这一章还要多久（音频在播时按真实时长算，否则按字数估），再加 45 秒缓冲 */
function watchdogDelay() {
  const nv = getNovel() || {};
  const total = Number(nv.audioMs || 0) || estChapterMs(currentChapter()?.text || '');
  const played = nv.chapterStartedAt ? Date.now() - nv.chapterStartedAt : 0;
  const left = Math.max(20000, total - played);
  return left + 45000;
}

/** 一章读完，写「小结 + 本章线索卡」：人物动向 / 新线索 / 未解谜团 */
async function summarizeChapter(cfg, ch) {
  const nv = getNovel();
  const plain = String(ch.text || '').replace(/\s+/g, ' ').trim();
  const cast = castNames(novelInfo());
  let card = null;

  if (cfg.ai.enabled && cfg.ai.apiKey) {
    try {
      const res = await aiComplete(cfg, buildCardMessages({ title: ch.title, text: ch.text, cast: cast.join('、') }), {
        temperature: 0.7,
        maxTokens: 420,
        timeoutMs: 60000,
      });
      const cost = costOf(res.usage, ratesFor(cfg.pricing, res.usedModel || cfg.ai.model));
      addUsageOnly({ usage: res.usage, cost });
      card = parseCard(res.text);
      if (!card) {
        /* 模型偶发不吐 JSON，再要一次「只给 JSON」 */
        const retry = await aiComplete(
          cfg,
          [
            ...buildCardMessages({ title: ch.title, text: ch.text, cast: cast.join('、') }),
            { role: 'assistant', content: String(res.text || '').slice(0, 600) },
            { role: 'user', content: '只输出那段 JSON 本身，不要解释、不要 markdown 代码块。' },
          ],
          { temperature: 0.3, maxTokens: 360, timeoutMs: 60000 },
        );
        const cost2 = costOf(retry.usage, ratesFor(cfg.pricing, retry.usedModel || cfg.ai.model));
        addUsageOnly({ usage: retry.usage, cost: cost2 });
        card = parseCard(retry.text);
      }
    } catch (err) {
      console.warn('[novel] 线索卡生成失败（用规则兜底）：', err.message);
    }
  }
  if (!card) card = fallbackCard({ text: ch.text, cast });

  const text = (card.summary || plain.slice(0, 46)).slice(0, 120);
  setSummary(nv.idx, text);
  setCard(nv.idx, { ...card, summary: text });
  return text;
}

/** 念完一整本之后的作品档案：设定 / 人物 / 优点 / 短板 / 可以问观众的问题 */
async function makeArchive(cfg) {
  const info = novelInfo();
  let obj = null;
  if (cfg.ai.enabled && cfg.ai.apiKey) {
    for (let attempt = 1; attempt <= 2 && !obj; attempt++) {
      try {
        const msgs = buildArchiveMessages({ ...info, summaries: getNovel()?.summaries || [] });
        if (attempt === 2) {
          msgs.push({ role: 'user', content: '只输出那段 JSON 本身，不要解释、不要 markdown 代码块。' });
        }
        const res = await aiComplete(cfg, msgs, {
          temperature: attempt === 1 ? 0.9 : 0.6,
          maxTokens: 900,
          timeoutMs: 90000,
        });
        const cost = costOf(res.usage, ratesFor(cfg.pricing, res.usedModel || cfg.ai.model));
        addUsageOnly({ usage: res.usage, cost });
        obj = parseArchive(res.text);
        if (!obj) console.warn('[novel] 档案 JSON 没解析出来，重试一次');
      } catch (err) {
        console.warn('[novel] 档案生成失败：', err.message);
      }
    }
  }
  if (!obj) obj = fallbackArchive(info, chaptersOf());
  setArchive(obj);
  pushEvent({
    kind: 'system',
    username: '系统',
    text: '整本念完了，作品档案已经整理好，可以和大家聊聊设定、人物和优缺点。',
  });
  return obj;
}

/** 一章结束（音频 ended 或看门狗触发） */
async function chapterDone(source) {
  const cfg = getConfig();
  const v = storyView(cfg);
  if (v.phase !== 'reading') return { ok: true, ignored: true, phase: v.phase };
  const ch = currentChapter();
  // 先切到休息态（此刻起弹幕回复就走语音），再慢慢写小结
  endChapter(cfg);
  const min = Math.round(Number(cfg.novel?.breakSec || 300) / 60);
  pushEvent({
    kind: 'system',
    username: '系统',
    text: `这一章念完了${source === 'audio' ? '' : '（自动）'}，休息 ${min} 分钟，聊聊刚才听到的。`,
  });
  broadcastNovel('wave');
  scheduleNovel((Number(cfg.novel?.breakSec || 300) + 1) * 1000);
  if (ch) {
    summarizeChapter(cfg, ch)
      .then(async () => {
        broadcastNovel();
        /* 线索卡也念一遍：听众不看屏幕也知道这章记住了什么 */
        await speakCard(cfg);
      })
      .catch((err) => console.warn('[novel] 小结失败：', err.message));
  }
  return { ok: true, phase: 'break', breakSec: Number(cfg.novel?.breakSec || 300) };
}

/** 把本章线索卡用语音说一遍（休息期只出声，不进弹幕框） */
async function speakCard(cfg) {
  const nv = getNovel();
  const card = (Array.isArray(nv?.cards) && nv.cards[nv.idx]) || null;
  if (!card) return;
  const parts = [`这一章先说个大概：${card.summary}。`];
  if (card.people) parts.push(`人物动向，${card.people}。`);
  if (card.clues) parts.push(`新线索，${card.clues}。`);
  if (card.puzzles) parts.push(`还没解开的，${card.puzzles}。`);
  const text = parts.join('');
  let voice = '';
  try {
    const out = await synthesize(text, voiceOptsOf(cfg, { maxChars: 800 }));
    voice = out.url || '';
  } catch (err) {
    console.warn('[voice] 线索卡朗读失败：', err.message);
  }
  pushEvent(addAiEvent({ text, source: 'card', voiceOnly: true, voice }));
}

async function novelStep() {
  const cfg = getConfig();
  if (!cfg.novel?.enabled) return { ok: false, error: '小说模式关着' };
  if (novelBusy) return { ok: false, error: '上一章还在准备' };

  let v = storyView(cfg);

  // 还没开 / 已经读完：从头开始下一本
  if (v.phase === 'idle' || v.phase === 'done') {
    const r = startNovel(cfg, {});
    if (!r.ok) {
      pushEvent({ kind: 'system', username: '系统', text: r.error });
      return r;
    }
    pushEvent({ kind: 'system', username: '系统', text: `今晚念《${r.title}》，一共 ${r.chapters} 章。` });
    broadcastNovel('type');
    v = storyView(cfg);
  }

  if (v.phase === 'break') {
    const left = Number(v.countdown || 0);
    if (left > 0) {
      scheduleNovel(left * 1000 + 500);
      return { ok: true, waiting: true, left };
    }
    const r = nextChapter();
    broadcastNovel('type');
    if (!r.more) {
      await makeArchive(cfg);
      broadcastNovel('wave');
      return { ok: true, afterword: true };
    }
    scheduleNovel(600);
    return { ok: true, next: r.idx };
  }

  if (v.phase === 'afterword') {
    if (!getNovel()?.archive) await makeArchive(cfg);
    broadcastNovel('wave');
    return { ok: true, afterword: true };
  }

  const ch = currentChapter();
  if (!ch) {
    pushEvent({ kind: 'system', username: '系统', text: '这一本里没找到可念的章节。' });
    return { ok: false, error: '没有章节' };
  }

  // preparing：把整章合成为一段音频
  if (v.phase === 'preparing' || !v.audioUrl) {
    novelBusy = true;
    try {
      pushEvent({ kind: 'system', username: '系统', text: `正在把「${ch.title}」合成语音（${ch.text.length} 字）…` });
      const url = await synthChapter(cfg, ch);
      if (!url) throw new Error('语音没合成出来');
      setAudio(url, estChapterMs(ch.text));
      beginReading();
      ensureSystemVolume().catch(() => {});
      novelRetry = 0;
      broadcastNovel('type');
      pushEvent({ kind: 'system', username: '系统', text: `开始念「${ch.title}」。` });
      scheduleNovel(watchdogDelay());
      return { ok: true, reading: true, chapter: ch.title };
    } catch (err) {
      console.warn('[novel] 合成失败：', err.message);
      pushEvent({ kind: 'system', username: '系统', text: `这一章语音没合成出来：${err.message}`.slice(0, 120) });
      // 合成失败也要重排，否则会永远停在「准备中」
      novelRetry = (novelRetry || 0) + 1;
      if (novelRetry <= 3) {
        const wait = Math.min(60_000, 8000 * novelRetry);
        pushEvent({ kind: 'system', username: '系统', text: `${Math.round(wait / 1000)} 秒后再试一次（第 ${novelRetry} 次）。` });
        scheduleNovel(wait);
      }
      return { ok: false, error: err.message };
    } finally {
      novelBusy = false;
    }
  }

  // reading：音频在播，等 ended 或看门狗（优先用页面回填的真实时长）
  scheduleNovel(watchdogDelay());
  return { ok: true, reading: true, waiting: true };
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
  if (rel === '/' || rel === '') rel = isRadio() ? '/radio.html' : '/index.html';
  if (rel === '/radio' || rel === '/radio/') rel = '/radio.html';
  if (rel === '/novel' || rel === '/classic') rel = '/index.html';
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
      // 后台脚本包含配置保存逻辑，不能沿用长缓存，否则重启后可能继续运行旧代码。
      'cache-control': ext === '.html' || ext === '.js' ? 'no-store' : 'public, max-age=3600',
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
        radio: radio.radioView(),
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
        radio: radio.radioView(),
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
      if (patch.music && 'neteaseCookie' in patch.music) {
        // 换了会员 cookie：清掉旧解析缓存和登录态缓存
        clearMusicCache();
        memberAt = 0;
        memberCache = null;
        await refreshMember({ force: true });
      }
      if (patch.danmaku && 'cookie' in patch.danmaku && bridge.state === 'live') {
        // 换了抖音 cookie：重连一次，才能收到礼物推送
        const rid = getConfig().danmaku?.roomId || getConfig().roomId;
        if (rid) startDanmaku(rid).catch((err) => console.warn('[danmaku] 重连失败：', err.message));
      }
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
      if (cur) ensureSystemVolume().catch(() => {});
      return json(res, 200, { ok: true, song: cur });
    }

    // ---- 音乐播放源 ----
    if (p === '/api/music' && req.method === 'GET') {
      await refreshMember();
      return json(res, 200, { ok: true, music: musicView() });
    }

    // 网易云会员登录态（粘贴 MUSIC_U 后用它检查）
    if (p === '/api/music/member' && req.method === 'GET') {
      const m = await refreshMember({ force: url.searchParams.get('force') === '1' });
      return json(res, 200, { ok: true, member: m, music: musicView() });
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
      if (cur) ensureSystemVolume().catch(() => {});
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

    // ---- 大肥鱼的声音（MiniMax / edge-tts / Kokoro / 系统离线）----
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
          minimax: MINIMAX_PRESETS,
          minimaxHasKey: Boolean(process.env.MINIMAX_API_KEY || cfg.voice?.minimaxApiKey),
          minimaxModel: cfg.voice?.minimaxModel || 'speech-2.8-hd',
          minimaxVoice: cfg.voice?.minimaxVoice || MINIMAX_PRESETS.lyrical.voiceId,
          fish: FISH_PRESETS,
          fishModels: FISH_MODELS,
          fishHasKey: Boolean(process.env.FISH_API_KEY || cfg.voice?.fishApiKey),
          fishModel: cfg.voice?.fishModel || 's2.1-pro-free',
          fishVoice: cfg.voice?.fishVoice || '',
          fishProxy: (() => {
            const setting = { mode: cfg.voice?.fishProxyMode || 'system', url: cfg.voice?.fishProxy || '' };
            const r = resolveProxy(setting);
            return { mode: setting.mode, url: maskProxy(setting.url), effective: maskProxy(r.url), source: r.source, error: r.error || '' };
          })(),
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

    /* 测 Fish 能不能连上：可以带还没保存的代理设置先试，不传就用已保存的 */
    if (p === '/api/voice/fish-proxy-test' && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const v = getConfig().voice || {};
      const mode = body.mode || v.fishProxyMode || 'system';
      const submitted = resolveProxySubmit(String(body.url ?? v.fishProxy ?? '').trim(), v.fishProxy);
      if (submitted.error && body.url !== undefined) return json(res, 400, { ok: false, error: submitted.error });
      const r = await testFishConnection({ mode, url: submitted.url || '' });
      return json(res, 200, r);
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

    /* 系统音量太低是最常见的「直播间没声音」：一键把默认播放设备调到 60% */
    if (p === '/api/audio/volume' && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const target = Math.min(1, Math.max(0.1, Number(body.target ?? 0.6) || 0.6));
      const script = path.join(ROOT, 'tools', 'audio-loud.ps1');
      if (!existsSync(script)) return json(res, 500, { ok: false, error: '找不到 tools/audio-loud.ps1' });
      return new Promise((resolve) => {
        execFile(
          'powershell',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, String(target)],
          { timeout: 60000, windowsHide: true },
          (err, stdout, stderr) => {
            const out = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
            sysVolLast = out.slice(-1)[0] || sysVolLast;
            if (err) {
              json(res, 500, { ok: false, error: (String(stderr || '').trim() || err.message).slice(0, 400), out });
            } else {
              json(res, 200, { ok: true, out: out.slice(-3), target });
            }
            resolve();
          },
        );
      });
    }

    if (p === '/api/audio/status' && req.method === 'GET') {
      return json(res, 200, { ok: true, last: sysVolLast, at: sysVolAt });
    }

    // ---- 御姐大肥鱼电台 ----
    if (p === '/api/radio' && req.method === 'GET') return json(res, 200, { ok: true, radio: radio.radioView() });
    if (p.startsWith('/api/radio/') && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const action = p.slice('/api/radio/'.length);
      let r;
      if (action === 'topic') r = body.next ? radio.nextTopic() : radio.setTopic(body.text);
      else if (action === 'pause') r = await radio.setPaused(body.paused);
      else if (action === 'mute') r = radio.mute();
      else if (action === 'say') r = radio.hostSay(body.text);
      else if (action === 'alerts/clear') r = radio.clearAlert(String(body.id || ''));
      else return json(res, 404, { ok: false, error: '没有这个操作' });
      return json(res, r.ok ? 200 : 400, { ...r, radio: radio.radioView() });
    }

    /* Fish 流式语音：还在合成就边收边转发，合成完了就当普通缓存文件给 */
    if (p.startsWith('/api/voice/stream/') && req.method === 'GET') {
      const name = p.slice('/api/voice/stream/'.length);
      const m = /^([a-f0-9]{20})\.mp3$/i.exec(name);
      if (!m) return json(res, 404, { ok: false, error: '没有这段语音' });
      const live = getFishStream(m[1]);
      if (live && !live.error) return pipeFishStream(live, res);
      const file = voiceMediaPath(name);
      if (!file) return json(res, 404, { ok: false, error: '没有这段语音' });
      return streamFile(req, res, file);
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

    // ---- 念小说 ----
    if (p === '/api/novel' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        story: storyView(getConfig()),
        novels: listNovels(getConfig()).map((n) => ({ name: n.name, day: n.day, size: n.size })),
        tokens: statsView(),
      });
    }

    if (p === '/api/novel/list' && req.method === 'GET') {
      const cfg = getConfig();
      const novels = listNovels(cfg).map((n) => {
        let chapters = 0;
        let chars = 0;
        try {
          const f = loadNovelFile(cfg, n.name);
          chapters = f.chapters?.length || 0;
          chars = (f.chapters || []).reduce((a, c) => a + c.text.length, 0);
        } catch {
          /* 读坏了就只给基本信息 */
        }
        return { name: n.name, title: n.title || n.name, day: n.day, size: n.size, chapters, chars };
      });
      return json(res, 200, { ok: true, novels, dir: novelDirLabel() });
    }

    if (p === '/api/novel/start' && req.method === 'POST') {
      const body = await readBody(req);
      const r = startNovel(getConfig(), { file: body.file ? String(body.file) : undefined });
      if (!r.ok) return json(res, 400, r);
      broadcastNovel('type');
      scheduleNovel(400);
      return json(res, 200, { ok: true, ...r, story: storyView(getConfig()) });
    }

    if (p === '/api/novel/stop' && req.method === 'POST') {
      clearTimeout(novelTimer);
      novelTimer = null;
      stopNovel();
      broadcastNovel('idle');
      return json(res, 200, { ok: true, story: storyView(getConfig()) });
    }

    // 音频放完（页面调的）/ 手动「下一章」
    if (p === '/api/novel/audio' && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const ms = setAudioMs(body.duration);
      // 时长回填后重排看门狗，避免按字数估的长短偏差
      const v1 = storyView(getConfig());
      if (v1.phase === 'reading' && novelTimer) clearTimeout(novelTimer);
      if (v1.phase === 'reading') scheduleNovel(watchdogDelay());
      return json(res, 200, { ok: true, audioMs: ms });
    }

    if (p === '/api/novel/display' && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const mode = setDisplayMode(body.mode);
      broadcastNovel('type');
      return json(res, 200, { ok: true, mode, story: storyView(getConfig()) });
    }

    if ((p === '/api/novel/advance' || p === '/api/novel/next') && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const src = p.endsWith('advance') ? 'audio' : 'manual';
      const v0 = storyView(getConfig());
      if (src === 'manual' && v0.phase !== 'reading') {
        const r = nextChapter();
        broadcastNovel('type');
        if (!r.more) await makeArchive(getConfig());
        broadcastNovel('wave');
        scheduleNovel(500);
        return json(res, 200, { ok: true, skipped: true, story: storyView(getConfig()) });
      }
      const out = await chapterDone(src);
      return json(res, 200, { ok: true, ...out, story: storyView(getConfig()) });
    }

    if (p === '/api/novel/auto' && req.method === 'POST') {
      const body = await readBody(req);
      const on = body.auto !== false;
      updateConfig({ novel: { auto: on } });
      await saveConfig();
      broadcast({ type: 'config', config: publicConfig() });
      if (on) scheduleNovel(500);
      else {
        clearTimeout(novelTimer);
        novelTimer = null;
      }
      return json(res, 200, { ok: true, story: storyView(getConfig()) });
    }

    if (p === '/api/novel/reset' && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      resetStory();
      const r = startNovel(getConfig(), { file: body.file ? String(body.file) : undefined });
      broadcastNovel('type');
      if (r.ok) scheduleNovel(400);
      return json(res, 200, { ok: r.ok, ...r, story: storyView(getConfig()) });
    }

    if (p === '/api/novel/config' && req.method === 'POST') {
      const body = await readBody(req);
      const patch = {};
      if (typeof body.dir === 'string' && body.dir.trim()) patch.dir = body.dir.trim().slice(0, 80);
      if (body.breakSec !== undefined) patch.breakSec = Math.max(30, Math.min(1800, Math.round(Number(body.breakSec) || 300)));
      if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
      if (body.autoStart !== undefined) patch.autoStart = Boolean(body.autoStart);
      if (typeof body.startAt === 'string') {
        const raw = body.startAt.trim();
        const m = raw.match(/^(\d{1,2})[:：](\d{2})$/);
        /* 空着 = 用默认 17:00；填 off 才是真的不定时 */
        patch.startAt = m ? `${String(Number(m[1])).padStart(2, '0')}:${m[2]}` : raw.toLowerCase() === 'off' ? 'off' : '';
        /* 改了开讲时间，之前那次的提醒记录就作废 */
        markReminded(0);
      }
      updateConfig({ novel: patch });
      await saveConfig();
      broadcast({ type: 'config', config: publicConfig() });
      broadcastNovel();
      if (!String(getConfig().novel?.startAt || '').trim() && getConfig().novel?.enabled && getConfig().novel?.auto) {
        scheduleNovel(800);
      }
      storyScheduleTick().catch(() => {});
      return json(res, 200, { ok: true, story: storyView(getConfig()), novel: getConfig().novel });
    }

    if (p === '/api/novel/archive' && req.method === 'POST') {
      const cfg = getConfig();
      const obj = await makeArchive(cfg);
      broadcastNovel('wave');
      return json(res, 200, { ok: true, archive: obj });
    }

    /* 手动重生成「本章线索卡」（自动流程里由 chapterDone 触发，这个给调试/补生成用） */
    if (p === '/api/novel/card' && req.method === 'POST') {
      const cfg = getConfig();
      const ch = currentChapter();
      if (!ch) return json(res, 400, { ok: false, error: '还没开始念，没有当前章节' });
      const summary = await summarizeChapter(cfg, ch);
      broadcastNovel('wave');
      const nv = getNovel() || {};
      return json(res, 200, { ok: true, summary, card: (nv.cards || [])[nv.idx] || null });
    }

    if (p === '/api/novel/archive' && req.method === 'GET') {
      const nv = getNovel() || {};
      return json(res, 200, {
        ok: true,
        archive: nv.archive || null,
        title: nv.title || '',
        file: nv.file || '',
        settings: nv.settings || '',
        chapters: chaptersOf().map((c) => ({ title: c.title, chars: c.text.length })),
        summaries: nv.summaries || [],
        topics: topTopics(12),
      });
    }

    if (p === '/api/novel/topics' && req.method === 'GET') {
      return json(res, 200, { ok: true, topics: topTopics(12) });
    }

    if (p === '/api/novel/topics' && req.method === 'POST') {
      const body = await readBody(req);
      const item = addTopic(body.text, body.user ? String(body.user) : '');
      if (!item) return json(res, 400, { ok: false, error: '选题是空的' });
      broadcastNovel();
      return json(res, 200, { ok: true, topic: item, topics: topTopics(12) });
    }

    // 旧接口留个壳，免得老页面 404
    if (p === '/api/story' && req.method === 'GET') {
      return json(res, 200, { ok: true, story: storyView(getConfig()), tokens: statsView() });
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

/* 电台：依赖由这里注入（广播、记账、语音参数） */
function costFor(usage) {
  const cfg = getConfig();
  return costOf(usage, ratesFor(cfg.pricing, cfg.ai.model));
}
radio.initRadio({
  getConfig,
  updateConfig,
  saveConfig,
  broadcast,
  log: (m) => console.log(m),
  voiceOpts: (extra) => voiceOptsOf(getConfig(), extra),
  recordUsage: (usage) => usage && addUsageOnly({ usage, cost: costFor(usage) }),
  recordAi: (text, kind, usage) => {
    const ev = usage ? addAiUsage({ usage, cost: costFor(usage), replyText: text }) : addAiEvent({ text, source: kind });
    ev.voiceOnly = true;
    ev.sayKind = kind;
    pushEvent(ev);
    if (usage) console.log(`[radio] ${kind} → ${text.slice(0, 30)}… in=${usage.prompt_tokens ?? 0} out=${usage.completion_tokens ?? 0}`);
  },
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
  if (isRadio()) console.log('  📻 御姐大肥鱼电台：竖屏页 /，操作台「电台」分区可接管、静音、换话题');
  if (!isRadio() && cfg.novel?.enabled && cfg.novel?.auto) {
    const list = listNovels(cfg);
    if (!list.length) {
      console.log(`  📖 小说朗读：「${cfg.novel?.dir || '短篇'}」里还没有小说，放一个 .txt 进去就会自动念`);
    } else {
      const v = storyView(cfg);
      const pick = v.file || list[0].name;
      console.log(`  📖 小说朗读：${pick}（${v.chapterCount || '?'} 章）${v.phase !== 'idle' ? `· 接着上次的进度（${v.phaseLabel}）` : ''}`);
    }
    /* 设了开讲时间：到点再念，之前先陪聊；没设就开窗即念 */
    const at = nextStartMs(cfg);
    if (at && (storyView(cfg).phase === 'idle' || storyView(cfg).phase === 'done')) {
      console.log(`  ⏰ 定时开讲：${fmtHm(at)}（提前 5 分钟会提醒一次）`);
    } else {
      scheduleNovel(2200);
    }
  }
  /* 定时器：每分钟看一次要不要提醒 / 开讲 */
  setInterval(() => {
    storyScheduleTick().catch((err) => console.warn('[schedule]', err.message));
  }, 60_000);
  storyScheduleTick().catch(() => {});
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
