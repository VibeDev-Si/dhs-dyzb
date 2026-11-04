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
  storyAudio: document.getElementById('storyAudio'),
  voiceHint: document.getElementById('voiceHint'),
  musicBar: document.getElementById('musicBar'),
  queueList: document.getElementById('queueList'),
  title: document.getElementById('storyTitle'),
  chapter: document.getElementById('storyChapter'),
  beat: document.getElementById('storyBeat'),
  storyStart: document.getElementById('storyStart'),
  storyStartSep: document.getElementById('storyStartSep'),
  bar: document.getElementById('storyBar'),
  liveText: document.getElementById('liveText'),
  danmakuN: document.getElementById('danmakuN'),
  phaseChip: document.getElementById('phaseChip'),
  clock: document.getElementById('clock'),
  summaryText: document.getElementById('summaryText'),
  summaryChapter: document.getElementById('summaryChapter'),
  summaryCard: document.getElementById('summaryCard'),
  clueGrid: document.getElementById('clueGrid'),
  cluePeople: document.getElementById('cluePeople'),
  clueClues: document.getElementById('clueClues'),
  cluePuzzles: document.getElementById('cluePuzzles'),
  giftThanks: document.getElementById('giftThanks'),
  thanksText: document.getElementById('thanksText'),
  toc: document.getElementById('toc'),
  tocN: document.getElementById('tocN'),
  tocWrap: document.getElementById('tocWrap'),
  tocTopics: document.getElementById('tocTopics'),
  topicList: document.getElementById('topicList'),
  feed: document.getElementById('feed'),
};

const state = {
  story: null,
  stats: null,
  song: null,
  musicVolume: 0.2,
  voiceVolume: 0.8,
  voiceEnabled: true,
  voiceDuck: 1,
  voicePlaying: null,
  audioUnlocked: false,
  events: [],
  typing: null,
  lastStorySeq: -1,
  lastStoryContentKey: '',
  storyDisplayMode: 'story',
  storyProgressRatio: 0,
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
  greet: 'assets/pet/wave.webm',
  rice: 'assets/pet/rice.webm',
  fun: 'assets/pet/bubble.webm',
  code: 'assets/pet/code.webm',
  happy: 'assets/pet/happy.webm',
  shy: 'assets/pet/shy.webm',
  angry: 'assets/pet/angry.webm',
  laugh: 'assets/pet/laugh.webm',
  think: 'assets/pet/think.webm',
  busy: 'assets/pet/busy.webm',
  cheer: 'assets/pet/cheer.webm',
  pace: 'assets/pet/pace.webm',
  sigh: 'assets/pet/sigh.webm',
  stretch: 'assets/pet/stretch.webm',
  doze: 'assets/pet/doze.webm',
  surprise: 'assets/pet/surprise.webm',
  dance: 'assets/pet/dance.webm',
  sing: 'assets/pet/sing.webm',
  tail: 'assets/pet/tail.webm',
  spin: 'assets/pet/spin.webm',
  unwrap: 'assets/pet/unwrap.webm',
  cat: 'assets/pet/cat.webm',
  tea: 'assets/pet/tea.webm',
};

/* 各阶段各自的「常态动作」 */
const PHASE_MOOD = {
  idle: 'idle',
  preparing: 'busy',
  reading: 'talk',
  break: 'sing',
  afterword: 'think',
  done: 'idle',
};

/* 闲着的时候随机轮播的小动作（大肥鱼自己找事做） */
const IDLE_POOL = ['sing', 'stretch', 'cat', 'tea', 'spin', 'tail', 'pace', 'laugh', 'dance', 'shy', 'doze', 'surprise'];
const GIFT_POOL = ['happy', 'cheer', 'unwrap', 'dance', 'spin'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

let moodTimer = null;
let currentMood = 'idle';

function phaseMood(phase) {
  return PHASE_MOOD[phase] || 'idle';
}

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
    /* 小动作演完，回到当前阶段的常态动作（不是一律回 idle） */
    moodTimer = setTimeout(() => setMood(phaseMood(state.story?.phase || 'idle')), holdMs);
  }
}

/* 哪个动作文件坏了就退回待机动画；待机也放不出来，才收起来换成 🐋 */
pet.addEventListener('error', () => {
  const idleSrc = MOODS.idle;
  if (pet.dataset.fellBack !== '1' && pet.getAttribute('src') !== idleSrc) {
    pet.dataset.fellBack = '1';
    currentMood = 'idle';
    pet.src = idleSrc;
    el.pet.play?.()?.catch?.(() => {});
    return;
  }
  pet.style.display = 'none';
  fallback.hidden = false;
});

/* 空闲时自己玩一下：每 16–22 秒换一个小动作 */
setInterval(() => {
  if (state.typing || !state.audioUnlocked) return;
  const quiet = phaseMood(state.story?.phase || 'idle');
  if (currentMood !== quiet && currentMood !== 'idle') return;
  if (Math.random() < 0.7) setMood(pick(IDLE_POOL), 4200 + Math.random() * 2400);
}, 18000);

/* ---------- 礼物提示 ---------- */
let toastTimer = null;
function showToast(gift, username) {
  toast.innerHTML = '';
  const emoji = document.createElement('span');
  emoji.className = 'emoji';
  emoji.textContent = gift.emoji || '🎁';
  const text = document.createElement('span');
  text.textContent = username
    ? `谢谢 ${username} 的 ${gift.name} ×${gift.count}`
    : `谢谢 ${gift.name} ×${gift.count}`;
  toast.append(emoji, text);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3600);
}

/* ---------- 弹幕 ---------- */
/* 语音回复：优先播服务端合成好的那一句，没给就前端自己合成 */
function playReplyAudio(item) {
  const text = String(item.text || '').trim();
  if (!text) return;
  const showHint = () => {
    if (!el.voiceHint) return;
    el.voiceHint.hidden = false;
    el.voiceHint.textContent = `🔊 ${text.length > 34 ? `${text.slice(0, 34)}…` : text}`;
    clearTimeout(playReplyAudio.timer);
    playReplyAudio.timer = setTimeout(() => {
      el.voiceHint.hidden = true;
    }, Math.max(5000, text.length * 260));
  };
  if (!state.voiceEnabled) return;
  showHint();
  if (item.voice) {
    const url = new URL(item.voice, location.origin).href;
    speakToken += 1; /* 打断上一句 */
    el.voicePlayer.pause();
    el.voicePlayer.src = url;
    el.voicePlayer.volume = Number(state.voiceVolume ?? 0.8);
    const restore = () => {
      el.voicePlayer.onended = null;
      el.voicePlayer.onerror = null;
      restoreStoryDisplay();
    };
    el.voicePlayer.onended = restore;
    el.voicePlayer.onerror = restore;
    el.voicePlayer.play().catch(() => {});
    setMood(Math.random() < 0.5 ? 'talk' : 'happy', 5200);
    return;
  }
  speak(text);
  setMood(Math.random() < 0.5 ? 'talk' : 'happy', 5200);
}

function addMessage(item, { animate = true } = {}) {
  /* 休息 / 作品讨论时的回复只出声音，不占弹幕框 */
  if (item.voiceOnly) {
    /* 刷新页面回放历史时不要重播旧语音，只播「刚发生的」 */
    if (animate) playReplyAudio(item);
    return;
  }
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
    showToast(item.gift, item.username);
    renderThanks();
    setMood(pick(GIFT_POOL), 5600);
  } else if (item.kind === 'enter' || item.kind === 'follow') {
    setMood('greet', 3400);
  } else if (item.kind === 'ai') {
    setMood(Math.random() < 0.5 ? 'laugh' : 'shy', 3600);
  } else if (item.kind === 'chat') {
    setMood('talk', 2600);
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
    el.voicePlayer.volume = Number(state.voiceVolume ?? 0.8);
    /* 音乐和讲述各走各的音轨，同时出声；想临时压低 BGM 就把 voice.duck 调到 0.3 */
    const duck = Number(state.voiceDuck ?? 1);
    if (duck < 1) el.player.volume = Number(state.musicVolume ?? 0.2) * duck;
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
      el.player.volume = Number(state.musicVolume ?? 0.2);
    }
  });
}

/* ---------- 念小说 ---------- */
/* 一章就是一段音频：播完告诉服务端「这章念完了」，服务端开始 5 分钟休息。 */
let storyAudioSrc = '';
let storyAudioDone = '';
const STORY_SCROLL_DELAY_SEC = 30;

function storyInfoText(story, mode) {
  if (mode === 'characters') {
    return String(story.meta?.角色 || story.meta?.人物 || '暂时没有单独的角色资料。').trim();
  }
  const parts = [story.settings, story.meta?.设定, story.meta?.作品信息].filter((v) => String(v || '').trim());
  return parts.length ? parts.join('\n\n') : '暂时没有单独的设定资料。';
}

/* 角色/设定原文是 markdown：把 # 标题、**加粗** 变成看得下去的排版 */
function infoNode(text) {
  const box = document.createDocumentFragment();
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      const gap = document.createElement('div');
      gap.className = 'info-gap';
      box.appendChild(gap);
      continue;
    }
    const head = line.match(/^(#{1,6})\s*(.+)$/);
    if (head) {
      const h = document.createElement('div');
      h.className = `info-h lv${head[1].length}`;
      h.textContent = head[2].replace(/\*\*/g, '');
      box.appendChild(h);
      continue;
    }
    const p = document.createElement('div');
    p.className = 'info-p';
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('**') && part.endsWith('**')) {
        const b = document.createElement('b');
        b.textContent = part.slice(2, -2);
        p.appendChild(b);
      } else {
        p.appendChild(document.createTextNode(part));
      }
    }
    box.appendChild(p);
  }
  return box;
}

function renderStoryContent(story) {
  if (!story || !bubble) return;
  const mode = state.storyDisplayMode || 'story';
  const idleNow = ['idle', 'done'].includes(story.phase);
  const chapterKey = `${story.file || ''}:${story.chapterIndex ?? 0}`;
  const key = idleNow ? `idle:${story.startAt || ''}` : mode === 'story' ? `story:${chapterKey}` : `${mode}:${chapterKey}`;
  if (state.lastStoryContentKey === key) return;
  state.lastStoryContentKey = key;
  if (!idleNow && mode !== 'story') {
    bubble.classList.add('story-info');
    bubble.replaceChildren(infoNode(storyInfoText(story, mode)));
    bubble.scrollTop = 0;
    return;
  }
  bubble.classList.remove('story-info');
  if (idleNow) {
    /* 还没开讲：纸面别空着，给观众一句能接话的 */
    const at = /^\d{1,2}:\d{2}$/.test(String(story.startAt || ''))
      ? `${story.startAt} 开讲`
      : '等本鲸开口';
    bubble.textContent = `灯还亮着，书还没翻。${at}——这会儿先陪你们聊聊天，点歌、说话都行，本鲸都听着呢。`;
    bubble.scrollTop = 0;
    return;
  }
  bubble.textContent = cleanEscapes(story.text || '');
  const ratio = Math.max(0, Math.min(1, Number(state.storyProgressRatio) || 0));
  requestAnimationFrame(() => {
    const max = bubble.scrollHeight - bubble.clientHeight;
    if (max > 0) bubble.scrollTop = max * ratio;
  });
}

function setStoryDisplayMode(mode, { sync = true } = {}) {
  const next = ['story', 'characters', 'settings'].includes(mode) ? mode : 'story';
  state.storyDisplayMode = next;
  renderStoryContent(state.story);
  if (sync) {
    fetch(`${SERVER}/api/novel/display`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    }).catch(() => {});
  }
}

function restoreStoryDisplay() {
  if (state.storyDisplayMode === 'story') return;
  setStoryDisplayMode('story');
}

function storyAdvance() {
  const key = storyAudioSrc;
  if (!key || storyAudioDone === key) return;
  restoreStoryDisplay();
  storyAudioDone = key;
  fetch(`${SERVER}/api/novel/advance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ at: Date.now() }),
  }).catch(() => {
    storyAudioDone = ''; /* 失败就放开，让看门狗兜底 */
  });
}

if (el.storyAudio) {
  el.storyAudio.addEventListener('ended', storyAdvance);
/* 页面读到真实时长后回填，服务端看门狗按真实时长兜底 */
el.storyAudio.addEventListener('loadedmetadata', () => {
  const d = Number(el.storyAudio.duration);
  if (!Number.isFinite(d) || d <= 0) return;
  if (el.storyAudio.currentSrc && el.storyAudio.currentSrc.includes('api/voice/')) {
    fetch('/api/novel/audio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ duration: Math.round(d * 1000) }),
    }).catch(() => {});
  }
});
  el.storyAudio.addEventListener('error', () => {
    if (el.storyAudio.src) console.warn('[novel] 章节音频加载失败', el.storyAudio.error?.code);
  });
  /* 念到哪儿，纸面就滚到哪儿；开头先留 30 秒，让观众读完开场。 */
  el.storyAudio.addEventListener('timeupdate', () => {
    const story = state.story;
    if (!story || story.phase !== 'reading') return;
    const a = el.storyAudio;
    /* 流式音频还在合成时 duration 是 Infinity，先用服务端估的时长顶上 */
    const total = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : Number(story.audioMs || 0) / 1000;
    if (!total || !bubble) return;
    state.storyProgressRatio = Math.max(0, Math.min(1, a.currentTime / total));
    if (state.storyDisplayMode !== 'story' || a.currentTime < STORY_SCROLL_DELAY_SEC) return;
    const max = bubble.scrollHeight - bubble.clientHeight;
    if (max <= 0) return;
    const denominator = Math.max(1, total - STORY_SCROLL_DELAY_SEC);
    const ratio = Math.max(0, Math.min(1, (a.currentTime - STORY_SCROLL_DELAY_SEC) / denominator));
    bubble.scrollTop = ratio * max;
  });
}

function syncStoryAudio(story) {
  if (!el.storyAudio) return;
  const url = story.phase === 'reading' && story.audioUrl ? new URL(story.audioUrl, location.origin).href : '';
  if (!url) {
    if (!el.storyAudio.paused) el.storyAudio.pause();
    return;
  }
  if (url === storyAudioSrc) {
    if (el.storyAudio.paused && !el.storyAudio.ended && el.storyAudio.currentTime === 0) {
      el.storyAudio.play().catch(() => {});
    }
    return;
  }
  storyAudioSrc = url;
  storyAudioDone = '';
  el.storyAudio.src = url;
  el.storyAudio.volume = Number(state.voiceVolume ?? 0.8);
  el.storyAudio.play().catch(() => {
    if (el.voiceHint) {
      el.voiceHint.hidden = false;
      el.voiceHint.textContent = '🔊 点一下，开始念这一章';
      el.voiceHint.onclick = () => {
        el.storyAudio.play().catch(() => {});
        el.voiceHint.hidden = true;
      };
    }
  });
}

function archiveNode(a) {
  const box = document.createElement('div');
  box.className = 'archive';
  const add = (title, lines) => {
    if (!lines || !lines.length) return;
    const h = document.createElement('div');
    h.className = 'archive-h';
    h.textContent = title;
    box.append(h);
    for (const t of lines) {
      const p = document.createElement('p');
      p.className = 'archive-p';
      p.textContent = t;
      box.append(p);
    }
  };
  if (a.world) add('世界观', [a.world]);
  if (a.characters?.length) {
    add(
      '人物',
      a.characters.map((c) => `${c.name}${c.role ? `（${c.role}）` : ''}${c.note ? `：${c.note}` : ''}`),
    );
  }
  add('主题', a.themes);
  add('写得好的地方', a.highlights);
  add('可以更好的地方', a.flaws);
  add('想问问你们', a.questions);
  return box;
}

function renderStory(story, { silent = false, mood = null } = {}) {
  if (!story) return;
  state.story = story;
  state.storyDisplayMode = ['story', 'characters', 'settings'].includes(story.displayMode) ? story.displayMode : 'story';
  el.title.textContent = story.title || '今晚念什么';
  const idleNow = ['idle', 'done'].includes(story.phase);
  const startAt = /^\d{1,2}:\d{2}$/.test(String(story.startAt || '')) ? story.startAt : '';
  el.phaseChip.textContent = idleNow
    ? startAt
      ? `${startAt} 开讲`
      : '还没开讲 · 自由聊天'
    : story.phaseLabel || '待开播';
  if (el.storyStart) {
    el.storyStart.textContent = startAt ? `每晚 ${startAt} 开讲` : '不定时开讲';
    el.storyStart.hidden = false;
    if (el.storyStartSep) el.storyStartSep.hidden = false;
  }
  el.chapter.textContent = idleNow
    ? '还没开讲，先聊会儿'
    : story.chapter || (story.phase === 'reading' ? '正在念' : story.phase === 'afterword' ? '整本读完了' : '');
  el.beat.textContent = idleNow ? '' : story.chapterCount ? `第 ${(story.chapterIndex || 0) + 1} / ${story.chapterCount} 章` : '';
  el.bar.style.width = `${Math.round(story.progress || 0)}%`;
  el.liveText.textContent =
    { reading: '朗读中', preparing: '准备中', break: '休息 · 聊天', afterword: '作品讨论', idle: '待开播', done: '读完了' }[
      story.phase
    ] || '待开播';
  el.danmakuN.textContent = state.events.length ? `${state.events.length} 条` : '';

  state.clockBase =
    story.phase === 'break' && story.countdown ? { remaining: story.countdown, at: Date.now() } : null;
  clockTick();
  syncStoryAudio(story);
  renderToc(story);

  /* 阶段换了就换成这个阶段的常态动作（准备中=忙、朗读=敲桌子、休息=哼歌、讨论=思考） */
  const ph = story.phase || 'idle';
  if (state.lastPhase !== ph) {
    state.lastPhase = ph;
    if (!state.typing) setMood(phaseMood(ph), 0);
  }

  /* 本章线索卡只在「休息」时露脸：朗读中看正文、作品讨论看档案 */
  if (story.summary && story.phase === 'break') {
    el.summaryCard.hidden = false;
    el.summaryText.textContent = story.summary;
    el.summaryChapter.textContent = story.chapterTitle || story.chapter || '';
    const card = story.card;
    const hasGrid = Boolean(card && (card.people || card.clues || card.puzzles));
    if (el.clueGrid) el.clueGrid.hidden = !hasGrid;
    if (hasGrid) {
      el.cluePeople.textContent = card.people || '本章没有';
      el.clueClues.textContent = card.clues || '本章没有';
      el.cluePuzzles.textContent = card.puzzles || '本章没有';
    }
  } else {
    el.summaryCard.hidden = true;
  }

  if (story.phase === 'afterword' && story.archive) {
    bubble.classList.remove('typing');
    if (state.typing) clearInterval(state.typing);
    state.typing = null;
    bubble.textContent = '';
    bubble.append(archiveNode(story.archive));
    state.lastStorySeq = story.seq;
    if (mood && MOODS[mood]) setMood(mood, 6500);
    return;
  }

  if (state.storyDisplayMode === 'story' && story.phase !== 'reading' && story.phase !== 'preparing') {
    state.storyProgressRatio = 0;
  }
  renderStoryContent(story);
  state.lastStorySeq = story.seq;
  if (mood && MOODS[mood]) setMood(mood, 6500);
}

/** 新的一段开口之前，先把上一段的声音收掉 */
function stopSpeaking() {
  if (!el.voicePlayer) return;
  speakToken += 1; /* 让上一段台词的所有分段排队作废 */
  if (!el.voicePlayer.paused) el.voicePlayer.pause();
  el.voicePlayer.currentTime = 0;
  state.voicePlaying = null;
  if (el.player) el.player.volume = Number(state.musicVolume ?? 0.2);
}

function clockTick() {
  /* 角色/设定 看过一阵子自动回到故事（服务端也会过期，这里兜一层客户端） */
  if (state.story && state.story.viewUntil && Date.now() > state.story.viewUntil && state.storyDisplayMode !== 'story') {
    state.story.viewUntil = 0;
    restoreStoryDisplay();
  }
  /* 还没开讲：显示「距离开讲还有多久」 */
  if (!state.clockBase && state.story && state.story.nextStartAt && ['idle', 'done'].includes(state.story.phase)) {
    const left = Math.round((state.story.nextStartAt - Date.now()) / 1000);
    if (left > 0) {
      const h = Math.floor(left / 3600);
      const m = Math.floor((left % 3600) / 60);
      const s = left % 60;
      el.clock.textContent = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
      return;
    }
  }
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
    : '还没有礼物 · 送个小心心试试';
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
  text.textContent = cur ? `${cur.title}${cur.by ? ' · ' + cur.by : ''}` : '还没有点歌 · 发「点歌 歌名」';
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
      /* 别把「静音开播」的临时状态带过来：换歌一律先解除静音、音量回到设置值 */
      el.player.muted = false;
      el.player.volume = Number(state.musicVolume ?? 0.2);
      state.userPaused = false;
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
  const queueMax = Number(song?.queueMax ?? state.queueMax ?? 3);
  state.queueMax = queueMax;
  el.queueN.textContent = list.length
    ? `排队 ${list.length}/${queueMax} 首`
    : song?.currentSong
      ? `队列空着 · 还能排 ${queueMax} 首`
      : '还没有人点';
  el.queueList.innerHTML = '';
  list.slice(0, 5).forEach((item, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="idx">${i + 1}</span><span class="title">${escapeHtml(item.title)}</span><span class="by">${escapeHtml(item.by || '')}</span>`;
    el.queueList.appendChild(li);
  });
}

/* 左栏目录：第几章、叫什么、念到哪儿 */
function renderToc(story) {
  if (!el.toc) return;
  const chapters = (story && story.chapters) || [];
  if (el.tocWrap) el.tocWrap.hidden = !chapters.length;
  el.tocN.textContent = chapters.length ? `${chapters.length} 章` : '';
  el.toc.innerHTML = '';
  chapters.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = c.current ? 'current' : c.done ? 'done' : '';
    const idx = document.createElement('span');
    idx.className = 'toc-idx';
    idx.textContent = String(i + 1).padStart(2, '0');
    const title = document.createElement('span');
    title.className = 'toc-title';
    title.textContent = c.title || `第 ${i + 1} 章`;
    li.append(idx, title);
    el.toc.appendChild(li);
  });

  /* 观众给明天投的题：有就露出来，没有就整块收起来 */
  const topics = (story && story.topics) || [];
  if (el.tocTopics) el.tocTopics.hidden = !topics.length;
  if (el.topicList) {
    el.topicList.innerHTML = '';
    topics.slice(0, 2).forEach((t) => {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = `${t.count} 票`;
      const span = document.createElement('span');
      span.textContent = t.text;
      li.append(b, span);
      el.topicList.appendChild(li);
    });
  }
}

/* 清场之后把空态提示补回来 */
function ensureFeedHint() {
  if (!el.feed || el.feed.querySelector('.msg')) return;
  if (document.getElementById('danmakuEmpty')) return;
  const node = document.createElement('div');
  node.className = 'danmaku-empty';
  node.id = 'danmakuEmpty';
   node.innerHTML = '<b>弹幕会从这儿滚过去</b><span>发「查看角色」或「查看设定」切换中间内容 · 发「点歌 歌名」点歌</span>';
  el.feed.appendChild(node);
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
    if (el.player.paused) {
      state.userPaused = false;
      el.player.play().catch(() => {});
    } else {
      state.userPaused = true;
      el.player.pause();
    }
  });
  el.player.addEventListener('play', () => {
    state.userPaused = false;
    el.player.muted = false;
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
  renderStats(payload.stats);
  renderBalance(payload.balance);
  if (payload.config?.music?.volume != null) state.musicVolume = Number(payload.config.music.volume);
  if (payload.config?.voice) {
    state.voiceVolume = Number(payload.config.voice.volume ?? 0.8);
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
  ensureFeedHint();
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
        ensureFeedHint();
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
          if (payload.config.music?.volume != null) {
            state.musicVolume = Number(payload.config.music.volume);
            if (el.voicePlayer.paused) el.player.volume = state.musicVolume;
          }
          if (payload.config.voice) {
            state.voiceVolume = Number(payload.config.voice.volume ?? 0.8);
            state.voiceEnabled = payload.config.voice.enabled !== false;
            state.voiceDuck = Number(payload.config.voice.duck ?? 1);
            el.voicePlayer.volume = state.voiceVolume;
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

/* 先试不静音直接播；被拦就静音开播，开起来立刻把静音和音量还回去（不留静音窗口） */
async function bootAudio() {
  const start = async () => {
    if (el.player.src && el.player.paused) await el.player.play().catch(() => {});
  };
  const restore = () => {
    el.player.muted = false;
    el.player.volume = Number(state.musicVolume ?? 0.2);
  };
  el.player.muted = false;
  await start();
  if (!state.song?.currentSong?.url) initPlayer();
  if (soundReady()) {
    restore();
    return true;
  }
  /* 兜底：静音起播，_同一拍_里就解除静音 —— 绝不让元素停在 muted=true 上 */
  el.player.muted = true;
  await start();
  restore();
  if (el.player.paused) return false;
  /* 有的机型静音起播后立刻解除会被重新静音，隔一拍再确认一次 */
  setTimeout(restore, 300);
  setTimeout(restore, 1500);
  return true;
}

/* 自愈：静音态/被暂停时，只要队列里还有歌就继续响（用户手动按过暂停就不动） */
function ensureMusicPlaying() {
  const cur = state.song?.currentSong;
  if (!cur?.url) return;
  if (el.player.muted) {
    el.player.muted = false;
    el.player.volume = Number(state.musicVolume ?? 0.2);
  }
  if (state.userPaused) return;
  if (el.player.paused && el.player.currentSrc && !el.player.ended) el.player.play().catch(() => {});
}
setInterval(ensureMusicPlaying, 4000);

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

