/**
 * 御姐大肥鱼电台：节目编排 + 边写边说。
 * 同一时间只有一个「say」在生成；上一段快念完时（speakingUntil - LEAD_MS）才开始下一段，
 * 这段时间攒下的弹幕一次交给 AI，弹幕多时自然就变成"汇总着回"。
 * 依赖由 server.mjs 注入（init），这里不直接碰 HTTP 和存储。
 */
import { randomBytes } from 'node:crypto';
import { checkText, safeName } from './guard.mjs';
import { radioSystemPrompt, radioContext, TASKS, LINES } from './radio-persona.mjs';
import { streamChat } from './llm-stream.mjs';
import { SEARCH_TOOL, webSearch, searchStats } from './search.mjs';
import { synthesize, openLiveVoice, speechText } from './voice.mjs';
import { currentSlot } from './timeslot.mjs';
import { slotChangeTask } from './radio-persona.mjs';

const LEAD_MS = 1500; // 提前多久开始准备下一段（Fish 首块音频约 1 秒）
const CHARS_PER_SEC = 4.4; // 实测中文朗读速度，用来估算一段话要念多久
const WELCOME_GAP_MS = 30_000;
const TOPIC_ACK_GAP_MS = 20_000;
const BATCH_WAIT_MS = 1200; // 第一条弹幕进来后再等一下，把紧跟着的几条一起回

let deps = null; // { getConfig, saveConfig, updateConfig, broadcast, voiceOpts, recordAi, log }
const st = {
  topic: null, // { text, hook, since, source }
  pastTopics: [],
  wall: new Map(), // key -> { text, count, users:Set }
  recap: '',
  alerts: [],
  busy: false,
  speakingUntil: 0,
  current: null, // { id, abort }
  chats: [], // 待回复弹幕 { username, text, at }
  fixed: [], // 固定台词队列 { text, kind, to, priority }
  gifts: new Map(), // username -> Map(giftName -> count)
  welcomeNames: [],
  lastWelcomeAt: 0,
  lastTopicAckAt: 0,
  lastChatAt: 0,
  lastActivityAt: 0,
  nextNewcomerAt: 0,
  recentSays: [],
  lastFiller: '',
  crisisSeen: new Map(), // username -> ts
  lastError: '',
  warmKey: '',
};

const cfgR = () => deps.getConfig().radio || {};
const now = () => Date.now();
const newId = () => randomBytes(6).toString('hex');
const pick = (arr) => {
  const pool = arr.filter((x) => x !== st.lastFiller);
  const x = pool[Math.floor(Math.random() * pool.length)] || arr[0];
  st.lastFiller = x;
  return x;
};
const blockWords = () => cfgR().blockWords || [];
const estMs = (text) => Math.round((String(text).length / CHARS_PER_SEC) * 1000) + 600;

let lastGift = [];
/** 礼物道谢的话随机挑一句，最近说过的两句不重复 */
function pickGiftLine() {
  const pool = LINES.gift.map((f, i) => i).filter((i) => !lastGift.includes(i));
  const idx = pool[Math.floor(Math.random() * pool.length)] ?? 0;
  lastGift = [idx, ...lastGift].slice(0, Math.min(2, LINES.gift.length - 1));
  return LINES.gift[idx];
}

export function radioView() {
  const c = cfgR();
  const wall = [...st.wall.values()]
    .sort((a, b) => b.count - a.count || a.at - b.at)
    .slice(0, 8)
    .map((w) => ({ text: w.text, count: w.count, users: [...w.users].slice(0, 4) }));
  const s = currentSlot();
  return {
    mode: deps?.getConfig().mode || 'radio',
    slot: { key: s.key, label: s.label, subtitle: s.subtitle, greet: s.greet, weekend: s.weekend },
    topic: st.topic,
    recap: st.recap,
    wall,
    paused: Boolean(c.paused),
    speaking: now() < st.speakingUntil,
    busy: st.busy,
    search: { enabled: c.search !== false, ...searchStats(Number(c.searchPerHour) || 30) },
    alerts: st.alerts,
    lastError: st.lastError,
  };
}

let viewTimer = null;
function pushView() {
  clearTimeout(viewTimer); // 合并同一瞬间的多次变化
  viewTimer = setTimeout(() => deps.broadcast({ type: 'radio', radio: radioView() }), 50);
}

/** 时间轴：这段音频排在上一段后面播，算出大概什么时候念完 */
function scheduleAudio(ms) {
  const start = Math.max(now(), st.speakingUntil);
  st.speakingUntil = start + ms;
  pushView();
  return start;
}

function emit(type, data) {
  deps.broadcast({ type, ...data });
}

function remember(text) {
  st.recentSays.push(String(text).slice(0, 60));
  if (st.recentSays.length > 8) st.recentSays.shift();
}

function setError(msg) {
  st.lastError = msg ? String(msg).slice(0, 200) : '';
  if (msg) deps.log(`[radio] ${msg}`);
  pushView();
}

/** 固定台词：过词库 → 合成（Fish 下是流式，缓存命中则秒出）→ 推给页面 */
async function sayFixed({ text, kind = 'command', to = [] }) {
  const check = checkText(text, blockWords());
  if (!check.ok && kind !== 'crisis') return setError(`固定台词被词库拦下（${check.category}）`);
  const id = newId();
  emit('say-start', { say: { id, kind, to } });
  emit('say-delta', { id, text });
  try {
    const out = await synthesize(text, deps.voiceOpts({ maxChars: 600 }));
    emit('say-audio', { id, url: out.url, seq: 0 });
    scheduleAudio(estMs(text));
    out.finished?.then((r) => r?.error && setError(`语音中断：${r.error}`));
  } catch (err) {
    setError(`语音合成失败：${err.message}`);
  }
  emit('say-end', { id, text, ok: true });
  deps.recordAi(text, kind);
  remember(text);
}

/** 句子切分：遇到句末标点就出一句；太长时在逗号处也切，保证第一句尽快出声 */
function makeSplitter(onSentence) {
  let buf = '';
  const flushAt = (i) => {
    const s = buf.slice(0, i);
    buf = buf.slice(i);
    if (s.trim()) onSentence(s);
  };
  return {
    push(delta) {
      buf += delta;
      for (;;) {
        const m = /[。！？!?；;…~～\n]+/.exec(buf);
        if (m && m.index + m[0].length >= 6) {
          flushAt(m.index + m[0].length);
          continue;
        }
        if (buf.length > 28) {
          const c = Math.max(buf.lastIndexOf('，'), buf.lastIndexOf('、'), buf.lastIndexOf(','));
          if (c >= 8) {
            flushAt(c + 1);
            continue;
          }
        }
        break;
      }
    },
    end() {
      if (buf.trim()) onSentence(buf);
      buf = '';
    },
  };
}

/**
 * 一段 say 的输出端。Fish 下每一「节」是一条双向流会话；搜索前后用 cut() 切成两节，
 * 这样垫话能插在中间。其他引擎逐句合成。所有 say-audio 都经过 order 串行发出，
 * 保证页面收到的顺序就是说话的顺序；文字推给 Fish 是立刻的，不排队。
 */
function makeVoiceOut(id) {
  const opts = deps.voiceOpts({ maxChars: 600 });
  const fish = opts.engine === 'fish';
  let seq = 0;
  let order = Promise.resolve();
  const queue = (fn) => (order = order.then(fn).catch((err) => setError(`语音合成失败：${err.message}`)));
  let session = null;
  let announced = false;
  const sessions = [];
  const open = () => {
    try {
      session = openLiveVoice(opts);
      announced = false;
      sessions.push(session);
    } catch (err) {
      session = null;
      setError(`语音会话没开起来：${err.message}`);
    }
  };
  const close = () => {
    if (!session) return;
    if (announced) session.end();
    else session.abort('没有要说的话');
    session = null;
  };
  if (fish) open(); // 提前握手，第一句出来时连接已经就绪

  return {
    sentence(text) {
      if (fish) {
        if (!session) open();
        if (!session) return;
        session.push(text);
        if (!announced) {
          announced = true;
          const url = session.url;
          queue(() => emit('say-audio', { id, url, seq: seq++ }));
        }
        return;
      }
      queue(async () => {
        const out = await synthesize(text, opts);
        emit('say-audio', { id, url: out.url, seq: seq++ });
      });
    },
    /** 插一段预先缓存的垫话（搜索前后）：先把当前这节收尾 */
    clip(text) {
      close();
      return queue(async () => {
        const out = await synthesize(text, opts);
        emit('say-audio', { id, url: out.url, seq: seq++ });
      });
    },
    cut: close,
    async finish(spokenText) {
      close();
      await order;
      const start = scheduleAudio(estMs(spokenText));
      const last = sessions.at(-1);
      last?.finished.then((r) => {
        if (r?.error && r.error !== '没有要说的话') setError(`语音中断：${r.error}`);
        else if (r?.ms && sessions.length === 1) st.speakingUntil = Math.max(st.speakingUntil, start + r.ms);
      });
    },
    abort() {
      for (const s of sessions) s.abort('已静音');
    },
  };
}

/** 让 AI 边写边说一段。task：给模型的指令；chats：要回应的弹幕 */
async function sayLLM({ kind, task, chats = [], to = [], tools = false, maxTokens = 320 }) {
  const cfg = deps.getConfig();
  if (!cfg.ai?.apiKey) return setError('还没填 DeepSeek Key，电台没法自己说话');
  const id = newId();
  const ctrl = new AbortController();
  const out = makeVoiceOut(id);
  st.current = { id, abort: () => (ctrl.abort(), out.abort()) };
  // 正在回复谁、对方说了什么（已过词库），页面上显示成引用卡片
  const quotes = chats.slice(-3).map((c) => ({ name: c.name, text: c.text.slice(0, 60) }));
  emit('say-start', { say: { id, kind, to, quotes } });

  let spoken = ''; // 已经通过词库、推去合成的文字（含垫话）
  let blocked = false;
  const speak = (raw) => {
    if (blocked) return;
    const clean = speechText(raw, 400);
    if (!clean) return;
    const check = checkText(clean, blockWords());
    if (!check.ok) {
      blocked = true; // 后面的也不念了，宁可少说
      setError(`AI 的一句话被词库拦下（${check.category}），这段提前结束`);
      return;
    }
    spoken += clean;
    emit('say-delta', { id, text: clean });
    out.sentence(clean);
  };
  const splitter = makeSplitter(speak);
  const clip = async (line) => {
    spoken += line;
    emit('say-delta', { id, text: line });
    await out.clip(line);
  };

  const messages = [
    { role: 'system', content: radioSystemPrompt(cfg) },
    {
      role: 'system',
      content: radioContext({ now: bjNow(), slot: currentSlot(), topic: st.topic, recentSays: st.recentSays, wall: radioView().wall }),
    },
  ];
  if (chats.length) {
    messages.push({ role: 'user', content: chats.map((c) => `[${c.name}] ${c.text}`).join('\n') });
  }
  messages.push({ role: 'user', content: task });

  const c = cfgR();
  const useSearch = tools && c.search !== false;
  let res = null;
  try {
    res = await streamChat({
      baseUrl: cfg.ai.baseUrl,
      apiKey: cfg.ai.apiKey,
      model: cfg.ai.model,
      messages,
      temperature: Math.min(1, Number(cfg.ai.temperature ?? 0.9)),
      maxTokens,
      tools: useSearch ? [SEARCH_TOOL] : undefined,
      signal: ctrl.signal,
      onText: (d) => splitter.push(d),
      onToolStart: () => {
        splitter.end(); // 工具调用前已经说了半句：先念完
        out.cut(); // 搜完的回答另起一节，"我好像找到了"才能插在中间
        emit('say-status', { id, status: 'searching' }); // 页面上换成"查资料"的动作
        if (!spoken) clip(pick(LINES.searchStart));
      },
      runTool: async (call) => {
        const r = await runSearch(call, chats, clip);
        emit('say-status', { id, status: 'found' });
        return r;
      },
    });
    splitter.end();
  } catch (err) {
    if (!ctrl.signal.aborted) setError(`AI 没接上：${err.message}`);
  }

  const aborted = ctrl.signal.aborted;
  if (aborted) out.abort();
  else await out.finish(spoken);
  emit('say-end', { id, text: spoken, ok: Boolean(spoken) && !aborted && !blocked });
  if (st.current?.id === id) st.current = null;
  if (spoken && !aborted) {
    remember(spoken);
    deps.recordAi(spoken, kind, res?.usage);
    if (!st.lastError.startsWith('AI 的一句话')) setError('');
  }
  return spoken;
}

async function runSearch(call, chats, clip) {
  let args = {};
  try {
    args = JSON.parse(call.function?.arguments || '{}');
  } catch {
    /* 参数坏了就当没搜到 */
  }
  const query = String(args.query || '').trim();
  if (!query || !checkText(query, blockWords()).ok) {
    return JSON.stringify({ ok: false, note: '这个不适合在直播间搜，换个话题' });
  }
  const cfg = deps.getConfig();
  try {
    const r = await webSearch({
      apiKey: cfg.ai.apiKey,
      baseUrl: cfg.ai.baseUrl,
      query,
      question: chats.map((c) => c.text).join(' ').slice(0, 120),
      perHour: Number(cfgR().searchPerHour) || 30,
    });
    deps.log(`[radio] 搜索「${query}」${r.ok ? `${r.results.length} 条${r.cached ? '（缓存）' : ''}` : r.error}`);
    if (r.ok && r.results.length) await clip(pick(LINES.searchFound));
    pushView();
    return JSON.stringify(r.ok ? { results: r.results } : { ok: false, note: r.error });
  } catch (err) {
    deps.log(`[radio] 搜索失败：${err.message}`);
    return JSON.stringify({ ok: false, note: '没搜到，凭常识简单说两句，并说明没查到' });
  }
}

function bjNow() {
  const d = new Date(Date.now() + 8 * 3600_000);
  const wd = '日一二三四五六'[d.getUTCDay()];
  return `${d.toISOString().slice(0, 16).replace('T', ' ')}（星期${wd}）`;
}

const FALLBACK_TOPICS = [
  { topic: '最近让你开心的一件小事', hook: '今天有没有哪一刻让你笑了？' },
  { topic: '你睡前会想些什么', hook: '关灯以后，脑子里最常冒出来的是什么？' },
  { topic: '一首能代表你今年的歌', hook: '如果今年有主题曲，你选哪首？' },
  { topic: '那些没说出口的话', hook: '有没有一句话，你一直想说却没说？' },
  { topic: '小时候最怕的东西', hook: '你小时候怕过什么，现在想想很好笑？' },
];

/** 不出声地问模型要一个 JSON（选话题、写引子） */
async function askJson(prompt) {
  const cfg = deps.getConfig();
  if (!cfg.ai?.apiKey) return null;
  try {
    const r = await streamChat({
      baseUrl: cfg.ai.baseUrl, apiKey: cfg.ai.apiKey, model: cfg.ai.model,
      messages: [{ role: 'system', content: radioSystemPrompt(cfg) }, { role: 'user', content: prompt }],
      temperature: 1, maxTokens: 120,
    });
    deps.recordUsage(r.usage);
    const m = /\{[\s\S]*\}/.exec(r.text || '');
    return m ? JSON.parse(m[0]) : null;
  } catch (err) {
    deps.log(`[radio] 选话题失败：${err.message}`);
    return null;
  }
}

function setTopicState(text, hook, source) {
  st.topic = { text: String(text).slice(0, 24), hook: String(hook || '').slice(0, 40), since: now(), source };
  // 新话题刚开、还没轮到"刚进来的朋友"那句时，前情条先给一句固定的
  st.recap = `刚进来的朋友，我们正在聊「${st.topic.text}」，发弹幕一起说说。`;
  st.slotKey = currentSlot().key; // 刚按新时段选过话题，不再重复触发"跨时段"
  st.pastTopics.push(st.topic.text);
  if (st.pastTopics.length > 30) st.pastTopics.shift();
  pushView();
}

async function rotateTopic({ announce = true, text = '', source = '', slotChange = false } = {}) {
  let next = null;
  let fromWall = false;
  if (text) {
    next = (await askJson(TASKS.hookFor(text))) || { topic: text, hook: '' };
    next.topic = text;
  } else {
    const top = [...st.wall.values()].sort((a, b) => b.count - a.count || a.at - b.at)[0];
    if (top) {
      st.wall.delete(top.key);
      fromWall = true;
      next = (await askJson(TASKS.hookFor(top.text))) || { topic: top.text, hook: '' };
      next.topic = top.text;
    } else {
      next = await askJson(TASKS.pickTopic(st.pastTopics, currentSlot()));
      if (!next?.topic || !checkText(`${next.topic}${next.hook || ''}`, blockWords()).ok) {
        next = FALLBACK_TOPICS.filter((t) => !st.pastTopics.includes(t.topic))[0] || FALLBACK_TOPICS[0];
      }
    }
  }
  setTopicState(next.topic, next.hook, source || (fromWall ? 'wall' : 'ai'));
  if (announce) {
    const task = slotChange
      ? slotChangeTask(currentSlot(), st.topic.text, st.topic.hook)
      : TASKS.announce(st.topic.text, st.topic.hook, fromWall);
    await sayLLM({ kind: 'topic', task, maxTokens: 220 });
  }
}

function audiencePresent() {
  return now() - st.lastActivityAt < 15 * 60_000 || cfgR().idleWhenEmpty === true;
}

const minutes = (v, d) => Math.max(1, Number(v) || d) * 60_000;
function planNewcomer() {
  const c = cfgR();
  const lo = minutes(c.newcomerMinMin, 5);
  const hi = Math.max(lo, minutes(c.newcomerMaxMin, 8));
  st.nextNewcomerAt = now() + lo + Math.random() * (hi - lo);
}

/** 这一拍该做什么：按优先级挑一件，返回一个 async 函数；没事做返回 null */
function nextJob() {
  const c = cfgR();
  const t = now();
  if (st.fixed.length) {
    st.fixed.sort((a, b) => b.priority - a.priority);
    if (c.paused && st.fixed[0].priority < 1) return null; // 真人接管时只说真人/危机台词
    const item = st.fixed.shift();
    return () => sayFixed(item);
  }
  if (c.paused) return null;
  if (st.pendingTopic) {
    const p = st.pendingTopic;
    st.pendingTopic = null;
    return () => rotateTopic(p);
  }
  if (st.gifts.size) {
    const [name, items] = st.gifts.entries().next().value;
    st.gifts.delete(name);
    const list = [...items].map(([g, n]) => (n > 1 ? `${g}×${n}` : g)).join('、');
    const line = pickGiftLine();
    return () => sayFixed({ text: line(name, list), kind: 'gift', to: [name] });
  }
  if (st.welcomeNames.length && t - st.lastWelcomeAt >= WELCOME_GAP_MS) {
    const names = st.welcomeNames.splice(0);
    st.lastWelcomeAt = t;
    const who = names.length > 2 ? `${names.slice(0, 2).join('、')}等几位朋友` : names.join('、');
    const greet = currentSlot().greet;
    return () => sayFixed({ text: LINES.welcome(who, st.topic?.text, greet), kind: 'welcome', to: names.slice(0, 2) });
  }
  if (st.chats.length && t - st.chats[0].at >= BATCH_WAIT_MS) {
    const chats = st.chats.splice(0).slice(-10);
    const names = [...new Set(chats.map((x) => x.name))];
    const single = chats.length === 1;
    return () =>
      sayLLM({
        kind: single ? 'reply' : 'batch',
        task: single ? TASKS.single(chats[0].name) : TASKS.batch(),
        chats, to: names.slice(0, 3), tools: true, maxTokens: single ? 260 : 360,
      });
  }
  // 跨时段（比如 17 点进入"下班路上"）：打个招呼，换一个适合新时段的话题
  const slot = currentSlot();
  if (st.slotKey && slot.key !== st.slotKey && !st.wall.size) {
    st.slotKey = slot.key;
    pushView();
    return () => rotateTopic({ announce: audiencePresent(), slotChange: true });
  }
  st.slotKey = slot.key;
  if (!st.topic || (audiencePresent() && t - st.topic.since >= minutes(c.topicMin, 10))) {
    return () => rotateTopic({ announce: audiencePresent() });
  }
  if (t >= st.nextNewcomerAt && audiencePresent()) {
    planNewcomer();
    return async () => {
      const text = await sayLLM({ kind: 'newcomer', task: TASKS.newcomer(), maxTokens: 120 });
      if (text) {
        st.recap = text;
        pushView();
      }
    };
  }
  const idleMs = Math.max(15, Number(c.idleSec) || 45) * 1000;
  if (audiencePresent() && t - st.lastChatAt > idleMs && t - st.speakingUntil > idleMs / 2) {
    st.lastChatAt = t; // 独白之后重新计时
    return () => sayLLM({ kind: 'idle', task: TASKS.idle(), maxTokens: 300 });
  }
  return null;
}

async function tick() {
  if (!deps || st.busy || deps.getConfig().mode !== 'radio') return;
  warmFillers();
  if (now() < st.speakingUntil - LEAD_MS) return;
  const job = nextJob();
  if (!job) return;
  st.busy = true;
  pushView();
  try {
    await job();
  } catch (err) {
    setError(`出错了：${err.message}`);
  } finally {
    st.busy = false;
    pushView();
  }
}

/** 垫话提前合成好，用的时候零延迟（音色/语速一改就重新缓存） */
let warming = false;
async function warmFillers() {
  const opts = deps.voiceOpts({ maxChars: 200 });
  const key = JSON.stringify([opts.engine, opts.preset, opts.fishVoice, opts.fishModel, opts.rate, opts.voice]);
  if (warming || key === st.warmKey) return;
  warming = true;
  st.warmKey = key;
  try {
    for (const line of [...LINES.searchStart, ...LINES.searchFound]) {
      const out = await synthesize(line, opts).catch(() => null);
      await out?.finished;
    }
    deps.log('[radio] 口语垫话已缓存');
  } finally {
    warming = false;
  }
}

const TOPIC_RE = /^(?:话题|聊聊|想聊|选题|提议)[\s:：]*(.{2,30})$/u;

/** 弹幕进来（server.mjs 已经处理过点歌、切歌） */
export function onChat({ username, text }) {
  st.lastActivityAt = st.lastChatAt = now();
  const words = blockWords();
  const name = safeName(username, words);
  const check = checkText(text, words);
  if (check.crisis) return raiseCrisis(username, name, text);
  if (!check.ok) return deps.log(`[radio] 弹幕被词库拦下（${check.category}）：${String(text).slice(0, 20)}`);
  const m = TOPIC_RE.exec(String(text).trim());
  if (m) return proposeTopic(name, m[1].trim());
  st.chats.push({ name, text: String(text).slice(0, 120), at: now() });
  if (st.chats.length > 20) st.chats.splice(0, st.chats.length - 20);
}

function raiseCrisis(username, name, text) {
  const last = st.crisisSeen.get(username) || 0;
  st.alerts.push({ id: newId(), username, text: String(text).slice(0, 200), at: now() });
  if (st.alerts.length > 20) st.alerts.shift();
  deps.log(`[radio] ⚠ 危机提醒：${username}：${String(text).slice(0, 40)}`);
  pushView();
  if (now() - last < 5 * 60_000) return; // 同一个人 5 分钟内只安抚一次，后面交给真人
  st.crisisSeen.set(username, now());
  const hotline = String(cfgR().crisisHotline || '12356');
  st.fixed.push({ text: LINES.crisis(name, hotline), kind: 'crisis', to: [name], priority: 3 });
}

function proposeTopic(name, topic) {
  if (!checkText(topic, blockWords()).ok) return;
  const key = topic.replace(/\s+/g, '').toLowerCase();
  const w = st.wall.get(key) || { key, text: topic, count: 0, users: new Set(), at: now() };
  if (!w.users.has(name)) {
    w.users.add(name);
    w.count += 1;
  }
  st.wall.set(key, w);
  pushView();
  if (now() - st.lastTopicAckAt >= TOPIC_ACK_GAP_MS) {
    st.lastTopicAckAt = now();
    st.fixed.push({ text: LINES.topicAck(name, w.text, w.count), kind: 'command', to: [name], priority: 0 });
  }
}

export function onEnter(username) {
  st.lastActivityAt = now();
  const name = safeName(username, blockWords());
  if (name === '这位朋友' || st.welcomeNames.includes(name)) return;
  st.welcomeNames.push(name);
  if (st.welcomeNames.length > 6) st.welcomeNames.shift();
}

export function onGift(username, gift) {
  st.lastActivityAt = now();
  const name = safeName(username, blockWords());
  const m = st.gifts.get(name) || new Map();
  m.set(gift.name, (m.get(gift.name) || 0) + Math.max(1, Number(gift.count) || 1));
  st.gifts.set(name, m);
}

export function onActivity() {
  st.lastActivityAt = now();
}

/** server 里的固定回复（点歌、切歌）走这里 */
export function enqueueFixed(text, kind = 'command') {
  if (text) st.fixed.push({ text, kind, to: [], priority: 0 });
}

// ---------- 操作台 ----------
export function setTopic(text) {
  const t = String(text || '').trim().slice(0, 24);
  if (!t) return { ok: false, error: '话题是空的' };
  if (!checkText(t, blockWords()).ok) return { ok: false, error: '这个话题被词库拦下了' };
  st.pendingTopic = { text: t, source: 'admin', announce: true };
  return { ok: true };
}

export function nextTopic() {
  st.pendingTopic = { announce: true };
  return { ok: true };
}

export async function setPaused(paused) {
  deps.updateConfig({ radio: { paused: Boolean(paused) } });
  await deps.saveConfig();
  if (paused) mute();
  pushView();
  return { ok: true };
}

export function mute() {
  st.current?.abort();
  st.current = null;
  st.fixed = st.fixed.filter((f) => f.priority >= 3); // 危机安抚不丢
  st.speakingUntil = now();
  emit('mute', {});
  pushView();
  return { ok: true };
}

export function hostSay(text) {
  const t = String(text || '').trim().slice(0, 300);
  if (!t) return { ok: false, error: '没有要说的话' };
  const check = checkText(t, blockWords());
  if (!check.ok) return { ok: false, error: `这句话被词库拦下了（${check.category}）` };
  st.fixed.push({ text: t, kind: 'host', to: [], priority: 2 });
  return { ok: true };
}

export function clearAlert(id) {
  st.alerts = st.alerts.filter((a) => a.id !== id);
  pushView();
  return { ok: true };
}

export function initRadio(d) {
  deps = d;
  planNewcomer();
  setInterval(() => tick().catch((err) => deps.log(`[radio] ${err.message}`)), 400).unref?.();
  return radioView;
}
