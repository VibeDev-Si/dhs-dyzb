/* 大肥鱼 · 写故事直播间 前端 */
const SERVER = location.origin;
const bubble = document.getElementById('bubble');
const feed = document.getElementById('feed');
const pet = document.getElementById('pet');
const fallback = document.getElementById('softFallback');
const toast = document.getElementById('toast');

const el = {
  scene: document.getElementById('scene'),
  bglayer: document.getElementById('bglayer'),
  spent: document.getElementById('spentVal'),
  tokenToday: document.getElementById('tokenToday'),
  tokenLife: document.getElementById('tokenLife'),
  peakTag: document.getElementById('peakTag'),
  balVal: document.getElementById('balVal'),
  income: document.getElementById('incomeVal'),
  giftCount: document.getElementById('giftCount'),
  giftList: document.getElementById('giftList'),
  giftFoot: document.getElementById('giftFoot'),
  queueN: document.getElementById('queueN'),
  now: document.getElementById('nowPlaying'),
  nowText: document.getElementById('nowText'),
  srcTag: document.getElementById('srcTag'),
  playBtn: document.getElementById('playBtn'),
  player: document.getElementById('player'),
  voicePlayer: document.getElementById('voicePlayer'),
  musicBar: document.getElementById('musicBar'),
  queueList: document.getElementById('queueList'),
  title: document.getElementById('storyTitle'),
  chapter: document.getElementById('storyChapter'),
  beat: document.getElementById('storyBeat'),
  bar: document.getElementById('storyBar'),
  liveText: document.getElementById('liveText'),
  danmakuN: document.getElementById('danmakuN'),
  phaseChip: document.getElementById('phaseChip'),
  clock: document.getElementById('clock'),
  summaryText: document.getElementById('summaryText'),
  summaryChapter: document.getElementById('summaryChapter'),
  giftThanks: document.getElementById('giftThanks'),
  thanksText: document.getElementById('thanksText'),
};

const state = {
  story: null,
  stats: null,
  song: null,
  musicVolume: 0.75,
  voiceVolume: 0.9,
  voiceEnabled: true,
  voiceDuck: 1,
  voicePlaying: null,
  audioUnlocked: false,
  events: [],
  typing: null,
  lastStorySeq: -1,
  clockBase: null,
};

/* ---------- 画面自适应：铺满浏览器，不做等比缩放 ---------- */
function fit() {
  el.scene.style.removeProperty('--scale');
  el.scene.style.left = '0px';
  el.scene.style.top = '0px';
}
window.addEventListener('resize', fit);
fit();

if (new URLSearchParams(location.search).get('bare') === '1') {
  document.body.classList.add('bare');
}

/* ---------- 数字 ---------- */
const money = (n) => Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n) => Number(n || 0).toLocaleString('zh-CN');

/* ---------- 宠物 ---------- */
const MOODS = {
  idle: 'assets/pet/idle.webm',
  talk: 'assets/pet/type.webm',
  thanks: 'assets/pet/wave.webm',
  rice: 'assets/pet/rice.webm',
  fun: 'assets/pet/bubble.webm',
  code: 'assets/pet/code.webm',
};

let moodTimer = null;
let currentMood = 'idle';

function setMood(name, holdMs = 0) {
  const src = MOODS[name];
  if (!src) return;
  clearTimeout(moodTimer);
  if (name !== currentMood) {
    currentMood = name;
    pet.src = src;
    const p = pet.play();
    if (p && p.catch) p.catch(() => {});
  }
  if (holdMs) {
    moodTimer = setTimeout(() => setMood('idle'), holdMs);
  }
}

pet.addEventListener('error', () => {
  pet.style.display = 'none';
  fallback.hidden = false;
});

/* 空闲时自己玩一下 */
setInterval(() => {
  if (state.typing || currentMood !== 'idle') return;
  if (Math.random() < 0.45) setMood(Math.random() < 0.6 ? 'fun' : 'thanks', 4200);
}, 24000);

/* ---------- 礼物提示 ---------- */
let toastTimer = null;
function showToast(gift) {
  toast.innerHTML = '';
  const emoji = document.createElement('span');
  emoji.className = 'emoji';
  emoji.textContent = gift.emoji || '🎁';
  const text = document.createElement('span');
  text.textContent = `谢谢 ${gift.name} ×${gift.count}`;
  toast.append(emoji, text);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3600);
}

/* ---------- 弹幕 ---------- */
function addMessage(item, { animate = true } = {}) {
  const node = document.createElement('div');
  const empty = document.getElementById('danmakuEmpty');
  if (empty) empty.remove();
  node.className = `msg ${item.kind || 'chat'}`;
  if (!animate) node.style.animation = 'none';

  if (item.kind === 'gift' && item.gift) {
    const nick = document.createElement('span');
    nick.className = 'nick';
    nick.textContent = item.username;
    node.append(
      nick,
      document.createTextNode(`送出 ${item.gift.emoji || '🎁'} ${item.gift.name} ×${item.gift.count} `),
      Object.assign(document.createElement('span'), {
        className: 'amount',
        textContent: `¥${money(item.gift.price * item.gift.count)}`,
      }),
    );
  } else if (item.kind === 'enter') {
    node.textContent = `${item.username} 来了`;
  } else if (item.kind === 'follow') {
    node.textContent = `${item.username} 关注了主播`;
  } else if (item.kind === 'like') {
    node.textContent = `${item.username} 为主播点赞了`;
  } else if (item.kind === 'system') {
    node.textContent = item.text;
  } else {
    const nick = document.createElement('span');
    nick.className = `nick${item.kind === 'ai' ? ' ai' : ''}`;
    nick.textContent = item.kind === 'ai' ? '大肥鱼' : item.username;
    node.append(nick, document.createTextNode(item.text || ''));
    if (item.kind === 'ai') node.classList.add('ai');
  }

  feed.appendChild(node);
  while (feed.children.length > 50) feed.removeChild(feed.firstElementChild);
  scrollFeed();

  if (item.kind === 'gift') {
    showToast(item.gift);
    renderThanks();
    setMood('rice', 4200);
  } else if (item.kind === 'ai') {
    setMood('thanks', 3200);
  }
  return node;
}

function scrollFeed() {
  feed.scrollTop = feed.scrollHeight;
  requestAnimationFrame(() => {
    feed.scrollTop = feed.scrollHeight;
  });
}

/* ---------- 故事打字机 ---------- */
/* 模型偶尔会把换行写成字面量 \n，显示和朗读都要先还原，否则屏幕上、语音里都是「反斜杠 n」 */
function cleanEscapes(raw) {
  return String(raw ?? '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\(?=[^\n])/g, '');
}

function typeStory(text, speed = 34, onDone) {
  text = cleanEscapes(text);
  if (state.typing) clearInterval(state.typing);
  bubble.classList.add('typing');
  bubble.textContent = '';
  if (!text) {
    bubble.classList.remove('typing');
    if (onDone) onDone();
    return;
  }
  setMood('talk');
  let i = 0;
  state.typing = setInterval(() => {
    i += 1;
    bubble.textContent = text.slice(0, i);
    bubble.scrollTop = bubble.scrollHeight;
    if (i >= text.length) {
      clearInterval(state.typing);
      state.typing = null;
      bubble.classList.remove('typing');
      setTimeout(() => {
        if (currentMood === 'talk') setMood('idle');
      }, 1600);
      if (onDone) onDone();
    }
  }, speed);
}

/* ---------- 大肥鱼的声音 ---------- */
/* 一段 5 分钟的台词太长，整段合成要等很久；切成小段、边播边合成下一段，
   第一句 2 秒左右就能出声，后面靠预取把等待藏起来。 */
function splitSpeech(text, max = 78) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const parts = raw.match(/[^。！？!?…\n]+[。！？!?…]?/g) || [raw];
  const out = [];
  let buf = '';
  for (const p of parts) {
    if (buf && (buf + p).length > max) {
      out.push(buf.trim());
      buf = p;
    } else {
      buf += p;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

let speakToken = 0;
let voiceChain = Promise.resolve();

function synthChunk(text) {
  return fetch(`${SERVER}/api/voice/say`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
    .then((r) => r.json())
    .then((d) => (d.ok && d.url ? new URL(d.url, location.origin).href : null))
    .catch(() => null);
}

function playVoiceOnce(url, token) {
  return new Promise((resolve) => {
    if (token !== speakToken) return resolve();
    el.voicePlayer.pause();
    el.voicePlayer.src = url;
    el.voicePlayer.volume = Number(state.voiceVolume ?? 0.9);
    /* 音乐和讲述各走各的音轨，同时出声；想临时压低 BGM 就把 voice.duck 调到 0.3 */
    const duck = Number(state.voiceDuck ?? 1);
    if (duck < 1) el.player.volume = Number(state.musicVolume ?? 0.75) * duck;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      el.voicePlayer.onended = null;
      el.voicePlayer.onerror = null;
      resolve();
    };
    el.voicePlayer.onended = done;
    el.voicePlayer.onerror = done;
    el.voicePlayer.play().catch(() => done());
  });
}

function speak(text) {
  if (!state.voiceEnabled || !text) return;
  const chunks = splitSpeech(text);
  if (!chunks.length) return;
  const token = ++speakToken;
  state.voicePlaying = text;
  // 新的台词来了，旧的那段立刻闭嘴
  el.voicePlayer.pause();
  voiceChain = voiceChain.then(async () => {
    if (token !== speakToken) return;
    let next = synthChunk(chunks[0]);
    for (let i = 0; i < chunks.length; i++) {
      if (token !== speakToken) return;
      const url = await next;
      next = i + 1 < chunks.length ? synthChunk(chunks[i + 1]) : null;
      if (token !== speakToken) return;
      if (url) await playVoiceOnce(url, token);
    }
    if (token === speakToken) {
      state.voicePlaying = null;
      el.player.volume = Number(state.musicVolume ?? 0.75);
    }
  });
}

function renderStory(story, { silent = false, mood = null } = {}) {
  if (!story) return;
  state.story = story;
  el.title.textContent = story.title || '无题';
  el.phaseChip.textContent = story.phaseLabel || '准备开讲';
  el.chapter.textContent =
    story.chapter ||
    (story.phase === 'opener' ? '开场 · 潮汐湾的傍晚' : story.running ? '正在讲' : '准备开讲');
  el.beat.textContent =
    story.round >= 0
      ? `第 ${story.round + 1} / ${story.roundCount} 段`
      : story.openerBeat
        ? `第 ${story.openerBeat} / ${story.openerBeats} 拍`
        : story.running
          ? '开场'
          : '还没开讲';
  el.bar.style.width = `${Math.round((story.progress || 0) * 100)}%`;
  el.liveText.textContent = !story.running ? '待开讲' : story.auto ? '讲述中' : '暂停';
  el.danmakuN.textContent = state.events.length ? `${state.events.length} 条` : '';

  state.clockBase = story.running ? { remaining: story.remainingSec, at: Date.now() } : null;
  clockTick();
  if (!story.running) stopSpeaking();

  if (story.summary) {
    el.summaryText.textContent = story.summary;
    el.summaryChapter.textContent = story.chapter || '';
  }

  if (!silent && story.text && story.seq !== state.lastStorySeq) {
    state.lastStorySeq = story.seq;
    stopSpeaking();
    typeStory(story.text, 32);
    speak(story.text);
    if (mood && MOODS[mood]) setMood(mood, 6500);
  } else if (silent && story.text) {
    bubble.textContent = cleanEscapes(story.text);
    state.lastStorySeq = story.seq;
  }
}

/** 新的一段开口之前，先把上一段的声音收掉 */
function stopSpeaking() {
  if (!el.voicePlayer) return;
  speakToken += 1; /* 让上一段台词的所有分段排队作废 */
  if (!el.voicePlayer.paused) el.voicePlayer.pause();
  el.voicePlayer.currentTime = 0;
  state.voicePlaying = null;
  if (el.player) el.player.volume = Number(state.musicVolume ?? 0.75);
}

function clockTick() {
  if (!state.clockBase) {
    el.clock.textContent = '--:--';
    return;
  }
  const left = Math.max(0, Math.round(state.clockBase.remaining - (Date.now() - state.clockBase.at) / 1000));
  el.clock.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}
setInterval(clockTick, 1000);

/* 右上：礼物感谢（只用真收到的礼物） */
function renderThanks() {
  const ev = [...state.events].reverse().find((e) => e.kind === 'gift' && e.gift);
  if (!ev) {
    el.giftThanks.hidden = true;
    return;
  }
  el.giftThanks.hidden = false;
  el.thanksText.textContent = `谢谢 ${ev.username} 的 ${ev.gift.name} ×${ev.gift.count || 1}，本鲸收下了。`;
}

/* ---------- 统计 / 礼物 / 点歌 ---------- */
function renderStats(s) {
  if (!s) return;
  state.stats = s;
  const giftMap = s.gifts && typeof s.gifts === 'object' ? s.gifts : {};
  const giftN = Object.values(giftMap).reduce((a, b) => a + Number(b || 0), 0);
  el.spent.textContent = money(s.spent);
  el.tokenToday.textContent = num(s.tokensToday);
  el.tokenLife.textContent = num(s.tokensLifetime);
  el.peakTag.hidden = !s.peak;
  el.income.textContent = money(s.income);
  el.giftCount.textContent = giftN
    ? `今天收到 ${giftN} 件礼物 · 图鉴 ${s.unlocked}/${s.giftTotal}`
    : '还没有收到礼物';
  el.giftFoot.textContent = `图鉴 ${s.unlocked}/${s.giftTotal} · 白饭 ${money(s.rice)} 碗`;
  if (el.danmakuN && state.events.length) el.danmakuN.textContent = `${state.events.length} 条`;
}

function renderBalance(b) {
  if (b && !b.error && b.total != null) {
    el.balVal.textContent = `¥${money(b.total)}`;
    el.balVal.classList.remove('dim');
  } else {
    el.balVal.textContent = '未绑定';
    el.balVal.classList.add('dim');
  }
}

function renderGifts(gifts) {
  const list = (gifts || []).slice(0, 3);
  el.giftList.innerHTML = '';
  if (!list.length) {
    el.giftList.innerHTML = '<li class="empty"><span class="gift-emoji">🎁</span><span class="gift-name">等第一份礼物</span><span class="gift-amount">—</span></li>';
    return;
  }
  for (const g of list) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="gift-emoji">${g.emoji || '🎁'}</span><span class="gift-name">${escapeHtml(g.name)}</span><span class="gift-amount">×${g.count || 1}</span>`;
    el.giftList.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderSong(song) {
  const cur = song?.currentSong;
  const text = el.nowText;
  text.textContent = cur ? `${cur.title}${cur.by ? ' · ' + cur.by : ''}` : '还没有点歌';
  el.srcTag.hidden = !cur;
  if (cur) {
    const tag = cur.kind === 'local' ? '本地' : cur.provider === 'netease' ? '网易云' : cur.provider === 'custom' ? '自建源' : '无源';
    el.srcTag.textContent = tag;
    el.srcTag.classList.toggle('err', !cur.url);
    if (cur.provider === 'netease' && cur.resolvedBy) el.srcTag.title = `实际播放：${cur.resolvedTitle || ''} · ${cur.resolvedBy}`;
  }
  el.playBtn.classList.toggle('playing', !el.player.paused && Boolean(cur?.url));
  el.playBtn.textContent = !el.player.paused && cur?.url ? '❚❚' : '▶';

  if (cur?.url) {
    const src = new URL(cur.url, location.origin).href;
    if (el.player.src !== src) {
      el.player.src = src;
      el.player.volume = Number(state.musicVolume ?? 0.75);
      el.player.play().catch(() => {
        /* 浏览器不让自动播放：先把「点一下开启声音」亮出来 */
        el.playBtn.textContent = '▶';
        el.playBtn.classList.remove('playing');
        const b = document.getElementById('soundUnlock');
        if (b) b.hidden = false;
      });
    }
  } else if (!cur) {
    el.player.pause();
    el.player.removeAttribute('src');
    el.player.load();
    el.musicBar.style.width = '0%';
  }

  const list = song?.playlist || [];
  el.queueN.textContent = list.length
    ? `排队 ${list.length} 首`
    : song?.currentSong
      ? '1 首在播'
      : '还没有人点';
  el.queueList.innerHTML = '';
  list.slice(0, 5).forEach((item, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="idx">${i + 1}</span><span class="title">${escapeHtml(item.title)}</span><span class="by">${escapeHtml(item.by || '')}</span>`;
    el.queueList.appendChild(li);
  });
}

/* ---------- 播放器 ---------- */
function initPlayer() {
  el.playBtn.addEventListener('click', () => {
    const cur = state.song?.currentSong;
    if (!cur?.url) {
      // 没有源就重新解析一次
      fetch(`${SERVER}/api/music/resolve`, { method: 'POST' }).catch(() => {});
      return;
    }
    if (el.player.paused) el.player.play().catch(() => {});
    else el.player.pause();
  });
  el.player.addEventListener('play', () => {
    el.playBtn.classList.add('playing');
    el.playBtn.textContent = '❚❚';
  });
  el.player.addEventListener('pause', () => {
    el.playBtn.classList.remove('playing');
    el.playBtn.textContent = '▶';
  });
  el.player.addEventListener('timeupdate', () => {
    const d = el.player.duration;
    if (Number.isFinite(d) && d > 0) el.musicBar.style.width = `${Math.min(100, (el.player.currentTime / d) * 100)}%`;
  });
  el.player.addEventListener('ended', () => {
    fetch(`${SERVER}/api/music/ended`, { method: 'POST' }).catch(() => {});
  });
  el.player.addEventListener('error', () => {
    if (!el.player.getAttribute('src')) return;
    el.srcTag.textContent = '播放失败';
    el.srcTag.classList.add('err');
  });
}

/* ---------- 初始化 ---------- */
function applyInit(payload, { replay = true } = {}) {
  if (payload.config?.story) {
    el.title.textContent = payload.config.story.title || el.title.textContent;
  }
  renderStats(payload.stats);
  renderBalance(payload.balance);
  if (payload.config?.music?.volume != null) state.musicVolume = Number(payload.config.music.volume);
  if (payload.config?.voice) {
    state.voiceVolume = Number(payload.config.voice.volume ?? 0.9);
    state.voiceEnabled = payload.config.voice.enabled !== false;
    state.voiceDuck = Number(payload.config.voice.duck ?? 1);
  }
  state.song = payload.song || state.song;
  renderSong(payload.song);

  const gifts = (payload.events || [])
    .filter((e) => e.kind === 'gift' && e.gift)
    .reduce((acc, e) => {
      const hit = acc.find((x) => x.name === e.gift.name);
      if (hit) hit.count += e.gift.count;
      else acc.push({ ...e.gift, count: e.gift.count });
      return acc;
    }, [])
    .sort((a, b) => b.count - a.count);
  renderGifts(gifts);
  renderThanks();

  feed.innerHTML = '';
  state.events = [];
  if (replay) {
    for (const item of (payload.events || []).slice(-50)) {
      state.events.push(item);
      addMessage(item, { animate: false });
    }
  }
  if (payload.story) {
    renderStory(payload.story, { silent: Boolean(payload.story.text) });
  }
  scrollFeed();
}

/* ---------- SSE ---------- */
function connect() {
  const es = new EventSource(`${SERVER}/api/events`);
  es.onmessage = (evt) => {
    let payload;
    try {
      payload = JSON.parse(evt.data);
    } catch {
      return;
    }
    switch (payload.type) {
      case 'init':
        applyInit(payload);
        break;
      case 'event':
        state.events.push(payload.item);
        if (state.events.length > 50) state.events.splice(0, state.events.length - 50);
        addMessage(payload.item);
        break;
      case 'boot':
        state.events = [];
        feed.innerHTML = '';
        state.song = payload.song || state.song;
        renderSong(payload.song);
        if (payload.stats) renderStats(payload.stats);
        break;
      case 'stats':
        renderStats(payload.stats);
        break;
      case 'song':
        state.song = payload;
        renderSong(payload);
        break;
      case 'story':
        renderStory(payload.story, { mood: payload.mood });
        break;
      case 'balance':
        renderBalance(payload.balance);
        break;
      case 'config':
        if (payload.config) {
          el.title.textContent = payload.config.story?.title || el.title.textContent;
          if (state.story) el.liveText.textContent = payload.config.story?.auto ? '讲述中' : '暂停一下';
          if (payload.config.music?.volume != null) {
            state.musicVolume = Number(payload.config.music.volume);
            if (el.voicePlayer.paused) el.player.volume = state.musicVolume;
          }
          if (payload.config.voice) {
            state.voiceVolume = Number(payload.config.voice.volume ?? 0.9);
            state.voiceEnabled = payload.config.voice.enabled !== false;
            state.voiceDuck = Number(payload.config.voice.duck ?? 1);
            if (!el.voicePlayer.paused) el.voicePlayer.volume = state.voiceVolume;
          }
        }
        break;
      default:
        break;
    }
  };
  es.onerror = () => {
    es.close();
    setTimeout(connect, 2500);
  };
}

/* 从弹幕里认出「点歌」提示一下（真正入队由服务端做） */
initPlayer();

/* 每次打开直播窗先清场：音乐队列、消息队列、弹幕都归零（?keep=1 可跳过，调试用） */
const KEEP_STATE = new URLSearchParams(location.search).has('keep');
async function bootSession() {
  if (KEEP_STATE) return;
  try {
    const r = await fetch(`${SERVER}/api/session/boot`, { method: 'POST' });
    if (r.ok) {
      const d = await r.json();
      const c = d.cleared || {};
      console.log(`[boot] 清场：音乐 ${c.song || 0} 首、消息 ${c.events || 0} 条`);
    }
  } catch {
    /* 服务没起来也要能连 SSE */
  }
}
bootSession().finally(connect);

/* ---------- 声音：默认「打开就有声」，不带 ?auto=1 时留一个兜底按钮 ---------- */
const unlockBtn = document.getElementById('soundUnlock');
const AUTO_BOOT = new URLSearchParams(location.search).has('auto');
const soundReady = () =>
  (!el.player.paused && !el.player.ended) || (!el.voicePlayer.paused && !el.voicePlayer.ended);

/* 先试不静音直接播；被拦就静音开播，开起来再偷偷把音量放回去（多数 Chromium 允许） */
async function bootAudio() {
  const start = async () => {
    if (el.player.src && el.player.paused) await el.player.play().catch(() => {});
  };
  el.player.muted = false;
  await start();
  if (!state.song?.currentSong?.url) initPlayer();
  if (soundReady()) return true;
  el.player.muted = true;
  await start();
  if (!soundReady()) return false;
  await new Promise((r) => setTimeout(r, 600));
  el.player.muted = false;
  el.player.volume = Number(state.musicVolume ?? 0.75);
  return true;
}

if (unlockBtn) {
  unlockBtn.hidden = true;
  if (AUTO_BOOT) {
    /* 用 start-live.cmd 打开（Chrome 带了 autoplay 放行参数）：不需要任何点击 */
    unlockBtn.remove();
    setTimeout(bootAudio, 900);
    setTimeout(() => {
      if (!soundReady()) bootAudio();
    }, 4000);
  } else {
    const nudge = () => {
      if (!soundReady()) unlockBtn.hidden = false;
    };
    setTimeout(nudge, 2600);
    unlockBtn.onclick = async () => {
      unlockBtn.hidden = true;
      await bootAudio();
    };
    el.player.addEventListener('playing', () => {
      unlockBtn.hidden = true;
    });
    el.voicePlayer.addEventListener('playing', () => {
      unlockBtn.hidden = true;
    });
    el.player.addEventListener('ended', nudge);
    /* 观众动一下鼠标/键盘就解锁声音；解锁过一次，之后点歌、切歌都自动往下播 */
    const unlock = () => {
      unlockBtn.hidden = true;
      state.audioUnlocked = true;
      bootAudio();
    };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
  }
}

fetch(`${SERVER}/api/state`)
  .then((r) => r.json())
  .then((s) => {
    if (s.ok && !state.stats) applyInit(s, { replay: true });
  })
  .catch(() => {});

/* 调试用：控制台里能看 state、手动喊一句（不影响直播） */
window.__dfy = { state, el, speak, renderStory, typeStory };

