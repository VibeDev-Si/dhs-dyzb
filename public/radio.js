/* 御姐大肥鱼电台 · 竖屏主页脚本
 * 合约见 docs/radio-design.md：SSE 事件 radio / say-* / mute / song / event / config。 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const AUTO = params.has('auto') && params.get('auto') !== '0';
  const REVEAL_CPS = 4.5; // 每秒显示的字数
  const CATCHUP_CPS = 16; // 声音已播完、字幕还没追上时加速
  const NO_AUDIO_MS = 4000; // 这么久还没开口就先出字
  const AUDIO_GRACE_MS = 8000; // 音频已经到了但还在缓冲，最多等到这里
  const NEXT_SAY_HOLD_MS = 1200; // 一段说完，最后一句至少停留这么久再换下一段
  const FADE_AFTER_MS = 8000;
  const ENTER_THROTTLE_MS = 4000;
  const STALL_MS = 25000; // 一段语音这么久没有进度就跳过
  const DEFAULT_TOPIC = '今晚随便聊聊';
  const DEFAULT_HOOK = '有什么心事，发弹幕告诉我';

  const el = {
    heroImg: $('heroImg'),
    hero: $('hero'),
    heroDrift: $('heroDrift'),
    backdropImg: $('backdropImg'),
    think: $('think'),
    quotes: $('quotes'),
    pausedPill: $('pausedPill'),
    topicText: $('topicText'),
    topicHook: $('topicHook'),
    recap: $('recap'),
    wall: $('wall'),
    wallList: $('wallList'),
    feed: $('feed'),
    toasts: $('toasts'),
    nowPlaying: $('nowPlaying'),
    bubble: $('bubble'),
    bubbleWho: $('bubbleWho'),
    caption: $('caption'),
    captionText: $('captionText'),
    spoken: $('spoken'),
    ghost: $('ghost'),
    mark: $('mark'),
    caret: $('caret'),
    thinking: $('thinking'),
    thinkingLabel: $('thinkingLabel'),
    subtitle: $('subtitle'),
    unlock: $('soundUnlock'),
    voice: $('voice'),
    music: $('music'),
  };

  const state = {
    config: {},
    radio: null,
    song: null,
    voiceVolume: 0.85,
    musicVolume: 0.2,
    showFeed: false,
    feedItems: [],
    lastEnterToast: 0,
    musicUserPaused: false,
    blocked: false,
  };
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const chars = (s) => Array.from(String(s || '')); // 按码点切，emoji 不会被劈开
  const absUrl = (u) => new URL(u, location.href).href;

  /* ---------- 配置 ---------- */
  function applyConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    state.config = cfg;
    state.voiceVolume = clamp01(num(cfg.voice?.volume, 0.85));
    state.musicVolume = clamp01(num(cfg.music?.volume, state.musicVolume));
    el.voice.volume = state.voiceVolume;
    el.music.volume = state.musicVolume;
    state.showFeed = cfg.radio?.showFeed === true;
    renderFeed();
    if (!state.radio && cfg.radio) el.pausedPill.hidden = cfg.radio.paused !== true;
  }

  /* ---------- 话题条 / 前情 / 话题墙 ---------- */
  let recapShown = null;
  let recapFlip = false;
  function setRecap(text) {
    const t = String(text || '').trim();
    if (t === recapShown) return;
    recapShown = t;
    const spans = el.recap.querySelectorAll('span');
    const cur = spans[recapFlip ? 1 : 0];
    const next = spans[recapFlip ? 0 : 1];
    recapFlip = !recapFlip;
    cur.classList.remove('on');
    next.textContent = t;
    next.title = t;
    if (t) next.classList.add('on');
    else next.classList.remove('on');
    el.recap.hidden = !t; // 还没有前情时不留一条空玻璃条
  }

  function renderRadio(radio) {
    if (!radio || typeof radio !== 'object') return;
    state.radio = radio;
    const topic = radio.topic || {};
    el.topicText.textContent = String(topic.text || '').trim() || DEFAULT_TOPIC;
    const hook = String(topic.hook || '').trim();
    el.topicHook.textContent = hook || DEFAULT_HOOK;
    setRecap(radio.recap);
    renderWall(radio.wall);
    el.pausedPill.hidden = radio.paused !== true;
    renderSlot(radio.slot);
    document.body.dataset.mode = String(radio.mode || 'radio');
  }
  /* 时段：副标题 + body.slot-<key> 色调 */
  const SLOT_KEYS = ['dawn', 'morning', 'noon', 'afternoon', 'evening', 'prime', 'late', 'small'];
  const DEFAULT_SUBTITLE = '深夜电台 · 树洞';
  function renderSlot(slot) {
    const key = slot && SLOT_KEYS.includes(slot.key) ? slot.key : '';
    for (const k of SLOT_KEYS) document.body.classList.toggle(`slot-${k}`, k === key);
    const sub = String(slot?.subtitle || '').trim() || DEFAULT_SUBTITLE;
    el.subtitle.textContent = slot?.weekend === true ? `${sub} · 周末` : sub;
  }

  function renderWall(wall) {
    const items = (Array.isArray(wall) ? wall : [])
      .filter((w) => w && String(w.text || '').trim())
      .slice()
      .sort((a, b) => num(b.count, 0) - num(a.count, 0))
      .slice(0, 3);
    el.wall.hidden = !items.length;
    el.wallList.textContent = '';
    for (const w of items) {
      const li = document.createElement('li');
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = String(w.text).trim();
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = `${num(w.count, 1)} 票`;
      li.append(t, n);
      el.wallList.appendChild(li);
    }
  }

  /* ---------- 声音解锁 ---------- */
  const isBlockedErr = (err) => err && err.name === 'NotAllowedError';

  function markBlocked() {
    state.blocked = true;
    if (!AUTO) el.unlock.hidden = false;
  }
  function markUnblocked() {
    state.blocked = false;
    el.unlock.hidden = true;
  }
  function unlockAudio() {
    markUnblocked();
    resumeAudioCtx();
    if (curVoice && el.voice.paused) el.voice.play().catch(() => {});
    else pumpVoice();
    const cur = state.song?.currentSong;
    if (cur?.url && el.music.paused && !el.music.ended) {
      state.musicUserPaused = false;
      el.music.play().catch(() => {});
    }
  }
  el.unlock.addEventListener('click', (e) => {
    e.stopPropagation();
    unlockAudio();
  });
  /* 页面上任意一次点击/按键都算解锁（OBS 里「交互」也行） */
  document.addEventListener('pointerdown', () => state.blocked && unlockAudio());
  document.addEventListener('keydown', () => state.blocked && unlockAudio());
  /* ---------- 语音队列：先进先出，一个 <audio>，播完/出错就下一段 ---------- */
  const voiceQueue = []; // {sayId, url, seq}
  let curVoice = null; // {sayId, url, started, lastT, lastChange}

  function enqueueVoice(sayId, url, seq) {
    if (!url) return;
    voiceQueue.push({ sayId, url: absUrl(url), seq });
    const say = says.get(sayId);
    if (say) say.clipsQueued += 1;
    pumpVoice();
  }

  function pumpVoice() {
    if (curVoice || !voiceQueue.length) return;
    const item = voiceQueue.shift();
    curVoice = { ...item, started: false, lastT: -1, lastChange: Date.now() };
    el.voice.src = item.url;
    el.voice.volume = state.voiceVolume;
    const p = el.voice.play();
    if (p && p.catch) {
      p.then(markUnblocked).catch((err) => {
        if (curVoice?.url !== item.url) return;
        if (isBlockedErr(err)) {
          console.warn('[voice] 浏览器拦了自动播放，等一次点击');
          curVoice.lastChange = Date.now();
          markBlocked();
        } else if (err?.name !== 'AbortError') {
          console.warn('[voice] 播放失败，跳过：', item.url, err?.message || err);
          finishVoice();
        }
      });
    }
  }

  function finishVoice() {
    const done = curVoice;
    curVoice = null;
    if (done) {
      const say = says.get(done.sayId);
      if (say) say.clipsDone += 1;
    }
    updateSpeaking();
    pumpVoice();
    tick();
  }
  el.voice.addEventListener('playing', () => {
    resumeAudioCtx();
    if (!curVoice) return;
    markUnblocked();
    if (!curVoice.started) {
      curVoice.started = true;
      onClipStart(curVoice.sayId);
    }
    curVoice.lastChange = Date.now();
    updateSpeaking();
  });
  el.voice.addEventListener('timeupdate', () => {
    if (!curVoice) return;
    if (el.voice.currentTime !== curVoice.lastT) {
      curVoice.lastT = el.voice.currentTime;
      curVoice.lastChange = Date.now();
    }
  });
  el.voice.addEventListener('pause', updateSpeaking);
  el.voice.addEventListener('waiting', updateSpeaking);
  el.voice.addEventListener('ended', () => {
    if (curVoice) finishVoice();
  });
  el.voice.addEventListener('error', () => {
    if (!curVoice || !el.voice.getAttribute('src')) return;
    const code = el.voice.error?.code;
    console.warn('[voice] 音频出错，跳过：', curVoice.url, code ? `code=${code}` : '');
    finishVoice();
  });

  /* 卡死保护：直播流断在半路时既没有 ended 也没有 error */
  setInterval(() => {
    if (!curVoice || state.blocked) return;
    if (Date.now() - curVoice.lastChange > STALL_MS) {
      console.warn('[voice] 长时间没有进度，跳过：', curVoice.url);
      el.voice.pause();
      finishVoice();
    }
  }, 2000);

  function voicePlaying() {
    return Boolean(curVoice) && !el.voice.paused && !el.voice.ended;
  }
  function updateSpeaking() {
    document.body.classList.toggle('speaking', voicePlaying());
  }
  /* ---------- 字幕：一个 say 一条，打字机速度跟着开口时间走 ---------- */
  const says = new Map(); // id -> say
  const pending = []; // 等着上屏的 say（按 say-start 顺序）
  const muted = new Set(); // 被 mute 掉的 id：之后迟到的 delta/audio 一律丢弃
  let shown = null; // 正在气泡里的 say
  let fadeTimer = 0;

  function getSay(id, create = true) {
    const key = String(id ?? '');
    if (!key || muted.has(key)) return null;
    let say = says.get(key);
    if (!say && create) {
      say = {
        id: key, kind: '', to: [], text: '', cs: [], final: false, ok: true,
        revealing: false, revealed: 0, shownAt: 0, revealAt: 0, lastTick: 0, doneAt: 0,
        clipsQueued: 0, clipsDone: 0, clipStarted: false,
      };
      says.set(key, say);
      pending.push(say);
      if (says.size > 60) {
        for (const [k, s] of says) {
          if (s !== shown && !pending.includes(s)) says.delete(k);
          if (says.size <= 40) break;
        }
      }
    }
    return say;
  }
  function setText(say, text) {
    say.text = String(text || '');
    say.cs = chars(say.text);
    if (say.revealed > say.cs.length) say.revealed = say.cs.length;
  }
  const audioPending = (say) => say.clipsDone < say.clipsQueued;
  const fullyRevealed = (say) => say.revealed >= say.cs.length;

  function onClipStart(sayId) {
    const say = says.get(String(sayId));
    if (!say) return;
    say.clipStarted = true;
    if (say !== shown) showSay(say); // 下一段已经开口了，立刻换上
    if (!say.revealing) startReveal(say);
    tick();
  }
  function startReveal(say) {
    say.revealing = true;
    say.revealAt = say.lastTick = performance.now();
  }

  function showSay(say) {
    const i = pending.indexOf(say);
    if (i >= 0) pending.splice(i, 1);
    shown = say;
    say.shownAt = performance.now();
    clearTimeout(fadeTimer);
    clearTimeout(quotesTimer);
    renderQuotes(say);
    el.spoken.textContent = '';
    el.ghost.textContent = '';
    cap.spoken = cap.ghost = '';
    cap.offset = 0;
    el.captionText.classList.add('jump');
    el.captionText.style.transform = 'translateY(0)';
    void el.captionText.offsetWidth;
    el.captionText.classList.remove('jump');
    el.caption.classList.remove('more-up');
    el.bubble.classList.remove('show');
  }

  /* 引用卡片：被回复的弹幕原文。卡片里已有的名字，头部不再重复 @ */
  let quotesTimer = 0;
  function renderQuotes(say) {
    const quotes = (Array.isArray(say.quotes) ? say.quotes : [])
      .map((q) => ({ name: String(q?.name || '').trim(), text: String(q?.text || '').trim() }))
      .filter((q) => q.text)
      .slice(0, 3);
    el.quotes.textContent = '';
    for (const q of quotes) {
      const div = document.createElement('div');
      div.className = 'quote';
      if (q.name) {
        const n = document.createElement('span');
        n.className = 'qn';
        n.textContent = `${q.name}：`;
        div.appendChild(n);
      }
      div.appendChild(document.createTextNode(q.text));
      div.title = `${q.name}：${q.text}`;
      el.quotes.appendChild(div);
    }
    el.quotes.hidden = !quotes.length;
    if (quotes.length) document.body.dataset.quotes = String(quotes.length);
    else delete document.body.dataset.quotes;
    const quoted = new Set(quotes.map((q) => q.name));
    const names = (Array.isArray(say.to) ? say.to : [])
      .map((n) => String(n || '').trim())
      .filter((n) => n && !quoted.has(n))
      .slice(0, 3);
    el.bubbleWho.textContent = names.length ? `回复 ${names.map((n) => '@' + n).join(' ')}` : '大肥鱼';
  }
  function clearQuotes(delay) {
    clearTimeout(quotesTimer);
    const done = () => {
      el.quotes.hidden = true;
      el.quotes.textContent = '';
      delete document.body.dataset.quotes;
    };
    if (delay) quotesTimer = setTimeout(done, delay);
    else done();
  }

  function hideBubble(instant) {
    clearTimeout(fadeTimer);
    clearQuotes(instant ? 0 : 900); // 和气泡一起淡出，淡完再收起占位
    if (instant) {
      el.bubble.style.transition = 'none';
      el.bubble.classList.remove('show');
      void el.bubble.offsetWidth;
      el.bubble.style.transition = '';
    } else {
      el.bubble.classList.remove('show');
    }
  }

  /* 两层字幕：spoken = 已念到（高亮），ghost = 已写好、还没念到（幽灵字） */
  const cap = { spoken: '', ghost: '', offset: 0 };
  function renderCaption() {
    if (!shown) return;
    const n = Math.floor(shown.revealed);
    const spoken = shown.cs.slice(0, n).join('');
    const ghost = shown.cs.slice(n).join('');
    const thinking = !shown.cs.length && !shown.final;
    el.thinking.hidden = !thinking;
    if (thinking) el.thinkingLabel.textContent = shown.status === 'searching' ? '大肥鱼正在查' : '大肥鱼正在想';
    el.caption.hidden = thinking;
    if (spoken !== cap.spoken || ghost !== cap.ghost) {
      cap.spoken = spoken;
      cap.ghost = ghost;
      el.spoken.textContent = spoken;
      el.ghost.textContent = ghost;
      scrollCaption();
    }
    el.caret.hidden = shown.final; // say-end 之后不再「正在写」
    if ((shown.cs.length || thinking) && !shown.faded) el.bubble.classList.add('show');
  }

  /* 让「正在念的那一行」停在可视区倒数第二行，下面露出一行幽灵字 */
  function scrollCaption() {
    const lh = parseFloat(getComputedStyle(el.captionText).lineHeight) || el.mark.offsetHeight || 1;
    const rows = Math.max(1, Math.round(el.captionText.scrollHeight / lh));
    const visRows = Math.max(1, Math.round(el.caption.clientHeight / lh) || 4);
    const markRow = Math.floor((el.mark.offsetTop + 1) / lh);
    const maxOff = Math.max(0, rows - visRows);
    let off = Math.min(maxOff, Math.max(0, markRow - (visRows - 2)));
    if (shown && shown.final && !audioPending(shown) && fullyRevealed(shown)) off = maxOff; // 念完了：露出最后几行
    off = Math.max(off, Math.min(cap.offset, maxOff)); // 同一段里只往上滚，不来回跳
    cap.offset = off;
    el.captionText.style.transform = `translateY(${-off * lh}px)`;
    el.caption.classList.toggle('more-up', off > 0);
  }
  function tick() {
    const now = performance.now();
    if (!shown && pending.length) showSay(pending[0]);
    const say = shown;
    if (!say) return;

    if (!say.revealing) {
      const waited = now - say.shownAt;
      const queuedOk = audioPending(say) && !state.blocked;
      if (waited >= (queuedOk ? AUDIO_GRACE_MS : NO_AUDIO_MS)) startReveal(say);
    }
    if (say.revealing) {
      const dt = Math.max(0, now - say.lastTick) / 1000;
      say.lastTick = now;
      const audioDone = say.final && !audioPending(say) && say.clipsQueued > 0;
      const rate = audioDone ? CATCHUP_CPS : REVEAL_CPS;
      say.revealed = Math.min(say.cs.length, say.revealed + dt * rate);
    }
    renderCaption();

    const next = pending[0];
    const idle = say.revealing && fullyRevealed(say) && !audioPending(say);
    /* 后端漏了 say-end：后面已经有新的一段、这段又早就说完，就当它结束了 */
    if (idle && !say.final && next) say.lostEndAt = say.lostEndAt || now;
    else say.lostEndAt = 0;
    const finished = idle && (say.final || (say.lostEndAt && now - say.lostEndAt > 4000));
    if (!finished) {
      say.doneAt = 0;
      return;
    }
    if (!say.doneAt) say.doneAt = now;
    if (!say.cs.length) {
      shown = null; // 空的一段（被拦/出错）：收起「正在想」，直接让给下一段
      el.thinking.hidden = true;
      if (!pending.length) hideBubble(false);
      return;
    }
    if (next && now - say.doneAt >= NEXT_SAY_HOLD_MS) {
      showSay(next);
      return;
    }
    if (!next && !say.fadeArmed) {
      say.fadeArmed = true;
      fadeTimer = setTimeout(() => {
        if (shown !== say) return;
        if (!pending.length && !curVoice && !voiceQueue.length) {
          say.faded = true;
          hideBubble(false);
        } else {
          say.fadeArmed = false; // 还有声音在排队：下一轮再判断
        }
      }, FADE_AFTER_MS);
    }
  }
  setInterval(tick, 60);
  /* ---------- say 事件 ---------- */
  function onSayStart(p) {
    const info = p.say || p;
    const say = getSay(info.id);
    if (!say) return;
    say.kind = String(info.kind || '');
    say.quotes = Array.isArray(info.quotes) ? info.quotes : [];
    say.startedAt = performance.now();
    lastSay = say;
    say.to = Array.isArray(info.to) ? info.to : info.to ? [info.to] : [];
    if (shown === say) showSay(say); // 头部（回复 @谁）以 say-start 为准
    tick();
  }
  function onSayDelta(p) {
    const say = getSay(p.id);
    if (!say || say.final) return;
    setText(say, say.text + String(p.text || ''));
    tick();
  }
  function onSayAudio(p) {
    const say = getSay(p.id);
    if (!say) return;
    enqueueVoice(say.id, p.url, p.seq);
  }
  function onSayEnd(p) {
    const say = getSay(p.id);
    if (!say) return;
    say.final = true;
    say.ok = p.ok !== false;
    /* say-end 的 text 是过了词库的全文，以它为准；没给就保留已收到的 */
    if (typeof p.text === 'string' && p.text.length) setText(say, p.text);
    tick();
  }

  /* say-status：searching（模型在联网查） / found（查到了） */
  function onSayStatus(p) {
    const say = getSay(p.id, false) || (lastSay && String(lastSay.id) === String(p.id) ? lastSay : null);
    if (!say) return;
    say.status = String(p.status || '');
    say.statusAt = performance.now();
  }

  function onMute() {
    lastSay = null;
    voiceQueue.length = 0;
    curVoice = null;
    el.voice.pause();
    el.voice.removeAttribute('src');
    el.voice.load();
    for (const k of says.keys()) muted.add(k);
    while (muted.size > 200) muted.delete(muted.values().next().value);
    says.clear();
    pending.length = 0;
    shown = null;
    el.spoken.textContent = '';
    el.ghost.textContent = '';
    el.caret.hidden = true;
    el.thinking.hidden = true;
    cap.spoken = cap.ghost = '';
    hideBubble(true);
    updateSpeaking();
  }
  /* ---------- 点歌音乐：独立的 <audio id="music">，和语音同时出声 ---------- */
  function playMusic() {
    el.music.volume = state.musicVolume;
    const p = el.music.play();
    if (p && p.catch) {
      p.then(markUnblocked).catch((err) => {
        if (isBlockedErr(err)) markBlocked();
        else if (err?.name !== 'AbortError') console.warn('[music] 播放失败：', err?.message || err);
      });
    }
  }

  function renderSong(song) {
    if (!song || typeof song !== 'object') return;
    state.song = song;
    if (song.music?.volume != null) {
      state.musicVolume = clamp01(num(song.music.volume, state.musicVolume));
      el.music.volume = state.musicVolume;
    }
    const cur = song.currentSong;
    if (cur && String(cur.title || '').trim()) {
      el.nowPlaying.textContent = `🎵 ${String(cur.title).trim()}${cur.by ? ' · ' + cur.by : ''}`;
      el.nowPlaying.hidden = false;
    } else {
      el.nowPlaying.hidden = true;
    }
    if (cur?.url) {
      const src = absUrl(cur.url);
      if (el.music.src !== src) {
        el.music.src = src;
        state.musicUserPaused = false;
        playMusic();
      }
    } else if (el.music.getAttribute('src')) {
      el.music.pause();
      el.music.removeAttribute('src');
      el.music.load();
    }
  }

  el.music.addEventListener('ended', () => {
    fetch('/api/music/ended', { method: 'POST' }).catch(() => {});
  });
  el.music.addEventListener('error', () => {
    if (el.music.getAttribute('src')) console.warn('[music] 音频出错：', el.music.src, el.music.error?.code);
  });
  /* 自愈：有歌、被暂停了、又不是用户按的暂停 → 再 play 一次 */
  setInterval(() => {
    const cur = state.song?.currentSong;
    if (!cur?.url || state.musicUserPaused || el.music.ended || !el.music.paused) return;
    if (el.music.error) return;
    playMusic();
  }, 4000);
  /* ---------- 礼物 / 进场提示 ---------- */
  function toast(text, cls, ms) {
    const div = document.createElement('div');
    div.className = `toast ${cls}`;
    div.textContent = text;
    el.toasts.appendChild(div);
    while (el.toasts.children.length > 3) el.toasts.firstElementChild.remove();
    setTimeout(() => {
      div.classList.add('out');
      setTimeout(() => div.remove(), 700);
    }, ms);
  }

  const nameOf = (item) => String(item?.username || item?.nickname || '神秘观众').trim().slice(0, 16) || '神秘观众';

  function onEventItem(item, { live = true } = {}) {
    if (!item || typeof item !== 'object') return;
    if (item.kind === 'chat') addFeed(item);
    if (!live) return;
    if (item.kind === 'gift') {
      const g = item.gift || {};
      const gname = String(g.name || item.giftName || '礼物');
      const count = Math.max(1, num(g.count ?? item.count, 1));
      const emoji = g.emoji ? `${g.emoji} ` : '🎁 ';
      toast(`${emoji}谢谢 ${nameOf(item)} 的 ${gname}×${count}`, 'gift', 5000);
    } else if (item.kind === 'enter') {
      const now = Date.now();
      if (now - state.lastEnterToast < ENTER_THROTTLE_MS) return;
      state.lastEnterToast = now;
      toast(`${nameOf(item)} 来了`, 'enter', 3500);
    }
  }

  /* ---------- 弹幕（config.radio.showFeed === true 才显示） ---------- */
  function addFeed(item) {
    const text = String(item.text || '').trim();
    if (!text) return;
    state.feedItems.push({ u: nameOf(item), t: text });
    if (state.feedItems.length > 6) state.feedItems.splice(0, state.feedItems.length - 6);
    renderFeed();
  }
  function renderFeed() {
    el.feed.hidden = !state.showFeed || !state.feedItems.length;
    if (el.feed.hidden) return;
    el.feed.textContent = '';
    for (const it of state.feedItems) {
      const li = document.createElement('li');
      const u = document.createElement('span');
      u.className = 'u';
      u.textContent = it.u;
      li.append(u, document.createTextNode(it.t));
      el.feed.appendChild(li);
    }
  }
  /* ---------- 数据 ---------- */
  async function getJson(path) {
    try {
      const r = await fetch(path, { cache: 'no-store' });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }
  async function refreshRadio() {
    const d = await getJson('/api/radio');
    if (d?.radio) renderRadio(d.radio);
  }

  function applyInit(p) {
    applyConfig(p.config);
    if (p.song) renderSong(p.song);
    if (p.radio) renderRadio(p.radio);
    if (Array.isArray(p.events)) {
      state.feedItems = [];
      for (const item of p.events.slice(-30)) onEventItem(item, { live: false });
      renderFeed();
    }
  }

  function handle(p) {
    switch (p.type) {
      case 'init': applyInit(p); break;
      case 'radio': renderRadio(p.radio); break;
      case 'say-start': onSayStart(p); break;
      case 'say-delta': onSayDelta(p); break;
      case 'say-audio': onSayAudio(p); break;
      case 'say-end': onSayEnd(p); break;
      case 'say-status': onSayStatus(p); break;
      case 'mute': onMute(); break;
      /* 服务端是 {type:'song', ...songView()}；也兼容 {type:'song', song:{...}} */
      case 'song': renderSong('currentSong' in p ? p : p.song || p); break;
      case 'event': onEventItem(p.item); break;
      case 'config': applyConfig(p.config); renderFeed(); break;
      case 'boot':
        state.feedItems = [];
        renderFeed();
        if (p.song) renderSong(p.song);
        break;
      default: break;
    }
  }
  /* ---------- SSE：EventSource 自己会重连；断了太久就手动重建 ---------- */
  let es = null;
  let retryTimer = 0;
  function connect() {
    clearTimeout(retryTimer);
    try {
      es = new EventSource('/api/events');
    } catch {
      retryTimer = setTimeout(connect, 3000);
      return;
    }
    es.onopen = () => refreshRadio(); // 每次（重新）连上都补一次话题状态
    es.onmessage = (evt) => {
      let p;
      try {
        p = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (!p || typeof p.type !== 'string') return;
      try {
        handle(p);
      } catch (err) {
        console.error('[radio] 处理事件出错：', p.type, err);
      }
    };
    es.onerror = () => {
      /* CONNECTING：浏览器在自动重连；CLOSED：被放弃了，我们自己重来 */
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        retryTimer = setTimeout(connect, 3000);
      }
    };
  }

  /* ================= 分层角色（rig）：口型 / 眨眼 / 呼吸 / 点头 / 状态 =================
   * 素材在 /assets/radio/rig/rig.json；拿不到就保留静态 host.png。 */
  const RIG_BASE = '/assets/radio/rig/';
  let lastSay = null; // 最近一次 say-start 的那段（决定 thinking / searching）
  const rig = {
    ready: false, w: 1086, h: 1448, pivot: { x: 543, y: 1300 },
    root: null, char: null, mouth: {}, eyes: {},
    mouthState: 'closed', mouthSince: 0, lastVoiced: 0, level: 0, nod: 0, tilt: 0, look: 0,
    blinkSeq: [], nextBlink: 0,
  };
  const MOUTHS = ['closed', 'small', 'mid', 'open'];
  const EYES = ['open', 'half', 'closed'];

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`加载失败：${src}`));
      img.src = src;
    });
  }

  /* 帧图可能是整张图大小，也可能只裁了 box 那块：按实际尺寸摆 */
  function placeFrame(img, box) {
    const full = img.naturalWidth >= rig.w * 0.95 && img.naturalHeight >= rig.h * 0.95;
    if (full || !box) Object.assign(img.style, { left: '0px', top: '0px', width: `${rig.w}px`, height: `${rig.h}px` });
    else Object.assign(img.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    img.className = 'frame';
  }

  async function loadFrames(group, order, target) {
    const frames = (group && group.frames) || {};
    await Promise.all(order.map(async (name) => {
      target[name] = null; // null = 用底图本身的样子
      if (!frames[name]) return;
      try {
        const img = await loadImg(RIG_BASE + frames[name]);
        placeFrame(img, group.box);
        target[name] = img;
      } catch (err) {
        console.warn('[rig]', err.message);
      }
    }));
  }
  async function initRig() {
    let def;
    try {
      const r = await fetch(RIG_BASE + 'rig.json', { cache: 'no-store' });
      if (!r.ok) return console.info('[rig] 没有 rig.json，用静态图');
      def = await r.json();
    } catch {
      return console.info('[rig] rig.json 读不到，用静态图');
    }
    try {
      rig.w = num(def.width, 1086);
      rig.h = num(def.height, 1448);
      rig.pivot = { x: num(def.pivot?.x, rig.w / 2), y: num(def.pivot?.y, rig.h * 0.9) };
      const L = def.layers || {};
      const load = (file) => (file ? loadImg(RIG_BASE + file) : Promise.resolve(null));
      const [bg, ch, fg] = await Promise.all([load(L.background), load(L.character), load(L.foreground)]);
      if (!ch) throw new Error('缺 character 层');
      await Promise.all([loadFrames(def.mouth, MOUTHS, rig.mouth), loadFrames(def.eyes, EYES, rig.eyes)]);

      const root = document.createElement('div');
      root.className = 'rig';
      Object.assign(root.style, { width: `${rig.w}px`, height: `${rig.h}px` });
      const layer = (img) => { img.className = 'layer'; return img; };
      if (bg) root.appendChild(layer(bg));
      const char = document.createElement('div');
      char.className = 'char';
      char.style.transformOrigin = `${rig.pivot.x}px ${rig.pivot.y}px`;
      char.appendChild(layer(ch));
      for (const img of [...Object.values(rig.mouth), ...Object.values(rig.eyes)]) if (img) char.appendChild(img);
      root.appendChild(char);
      if (fg) root.appendChild(layer(fg));

      rig.root = root;
      rig.char = char;
      el.heroDrift.appendChild(root);
      el.heroImg.hidden = true;
      if (bg) el.backdropImg.src = bg.src;
      rig.ready = true;
      fitRig();
      window.addEventListener('resize', fitRig);
      console.info('[rig] 分层角色已启用');
    } catch (err) {
      console.warn('[rig] 素材不全，退回静态图：', err.message);
    }
  }

  /* 和静态图一样：宽高 cover、水平居中、顶部对齐 */
  function fitRig() {
    if (!rig.root) return;
    const W = el.hero.offsetWidth;
    const H = el.hero.offsetHeight;
    const s = Math.max(W / rig.w, H / rig.h);
    rig.root.style.transform = `translate(${(W - rig.w * s) / 2}px, 0px) scale(${s})`;
  }
  /* ---------- Web Audio：voice → analyser → destination ----------
   * 只有 AudioContext 真的 running 了才接线：一旦 createMediaElementSource，声音只从这条路出去，
   * 挂起状态下接线会把语音变哑。接不上就用「正在播放」做假口型。 */
  const audio = { ctx: null, src: null, analyser: null, buf: null, failed: false, peak: 0.08 };
  function resumeAudioCtx() {
    if (!rig.ready || audio.failed || audio.src) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return void (audio.failed = true);
    try {
      if (!audio.ctx) {
        audio.ctx = new AC();
        audio.ctx.addEventListener('statechange', () => audio.ctx.state === 'running' && wireAudio());
      }
      if (audio.ctx.state === 'running') wireAudio();
      else audio.ctx.resume().then(wireAudio, () => {});
    } catch (err) {
      audio.failed = true;
      console.warn('[rig] AudioContext 不可用，口型改用模拟：', err.message);
    }
  }
  function wireAudio() {
    if (audio.src || audio.failed || !audio.ctx || audio.ctx.state !== 'running') return;
    try {
      audio.src = audio.ctx.createMediaElementSource(el.voice); // 一个元素只能调一次
      audio.analyser = audio.ctx.createAnalyser();
      audio.analyser.fftSize = 1024;
      audio.analyser.smoothingTimeConstant = 0.2;
      audio.buf = new Float32Array(audio.analyser.fftSize);
      audio.src.connect(audio.analyser);
      audio.analyser.connect(audio.ctx.destination); // 一定要接，否则没声音
      console.info('[rig] 口型已接到 Web Audio');
    } catch (err) {
      audio.failed = true;
      console.warn('[rig] 接 Web Audio 失败，口型改用模拟：', err.message);
    }
  }
  /* 跑起来之后如果又被挂起（系统切音频设备等），再 resume 一次 */
  setInterval(() => {
    if (audio.ctx && audio.src && audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
    else if (!audio.src && voicePlaying()) resumeAudioCtx();
  }, 3000);

  /* 0..1 的「说话响度」：RMS 按最近的峰值自适应归一（不依赖 voice.volume 是否计入） */
  function voiceLevel(now) {
    if (!voicePlaying()) return 0;
    if (audio.analyser) {
      audio.analyser.getFloatTimeDomainData(audio.buf);
      let sum = 0;
      for (let i = 0; i < audio.buf.length; i++) sum += audio.buf[i] * audio.buf[i];
      const rms = Math.sqrt(sum / audio.buf.length);
      audio.peak = Math.max(rms, audio.peak * 0.9993, 0.02);
      return rms < 0.006 ? 0 : Math.min(1, rms / audio.peak);
    }
    /* 模拟：几个不同频率叠起来，像说话的起伏 */
    const t = now / 1000;
    const v = 0.55 + 0.3 * Math.sin(t * 9.1) + 0.2 * Math.sin(t * 15.7 + 1.3) - 0.15 * Math.sin(t * 3.3);
    return Math.max(0, Math.min(1, v));
  }
  /* 口型四档，带迟滞：往上要越过 up，往下要低于 down；每档至少停 70ms，避免在两档间抖 */
  const MOUTH_UP = { small: 0.14, mid: 0.38, open: 0.62 };
  const MOUTH_DOWN = { small: 0.08, mid: 0.28, open: 0.5 };
  const MOUTH_HOLD_MS = 70;
  const SILENCE_CLOSE_MS = 120;
  function stepMouth(now, raw) {
    rig.level += (raw - rig.level) * (raw > rig.level ? 0.55 : 0.25); // 张嘴快、合嘴稍慢
    if (raw > 0.04) rig.lastVoiced = now;
    const lv = rig.level;
    const idx = MOUTHS.indexOf(rig.mouthState);
    let want = idx;
    if (now - rig.lastVoiced > SILENCE_CLOSE_MS) want = 0;
    else {
      while (want < 3 && lv >= MOUTH_UP[MOUTHS[want + 1]]) want++;
      while (want > 0 && lv < MOUTH_DOWN[MOUTHS[want]]) want--;
    }
    if (want !== idx && (want === 0 || now - rig.mouthSince >= MOUTH_HOLD_MS)) {
      rig.mouthState = MOUTHS[want];
      rig.mouthSince = now;
      showFrame(rig.mouth, rig.mouthState);
    }
  }
  function showFrame(set, name) {
    for (const [k, img] of Object.entries(set)) if (img) img.classList.toggle('on', k === name);
  }

  /* 眨眼：2.5–6 秒一次，open→half→closed→half→open 约 160ms，偶尔连眨两下 */
  function scheduleBlink(now) {
    const seq = (t0) => [[t0, 'half'], [t0 + 40, 'closed'], [t0 + 100, 'half'], [t0 + 160, 'open']];
    rig.blinkSeq = seq(now);
    if (Math.random() < 0.18) rig.blinkSeq.push(...seq(now + 260));
    rig.nextBlink = now + 2500 + Math.random() * 3500;
  }
  function stepBlink(now) {
    if (!rig.nextBlink) rig.nextBlink = now + 1500;
    if (now >= rig.nextBlink && !rig.blinkSeq.length) scheduleBlink(now);
    while (rig.blinkSeq.length && now >= rig.blinkSeq[0][0]) showFrame(rig.eyes, rig.blinkSeq.shift()[1]);
  }

  /* 当前状态：searching / found / speaking / thinking / idle */
  function currentMood(now) {
    const s = lastSay;
    // 上一段还在播、这一段的字幕还没轮到：先继续播口型，别跳到"查一查"气泡上
    const waitingTurn = s && !s.clipStarted && s.startedAt && shown && shown !== s;
    if (voicePlaying() && waitingTurn) return 'speaking';
    if (s && s.status === 'searching' && now - s.statusAt < 30000) return 'searching';
    if (s && s.status === 'found' && now - s.statusAt < 1300) return 'found';
    if (voicePlaying()) return 'speaking';
    if (s && !s.clipStarted && !(s.final && !audioPending(s)) && now - (s.startedAt || 0) < 20000) return 'thinking';
    return 'idle';
  }
  /* 统一的 rAF：只改 transform / opacity，不动 DOM 结构 */
  let lastMood = '';
  let lastFrameAt = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - (lastFrameAt || now)) / 1000));
    lastFrameAt = now;
    const mood = currentMood(now);
    if (mood !== lastMood) {
      lastMood = mood;
      el.think.dataset.state = mood === 'thinking' || mood === 'searching' || mood === 'found' ? mood : '';
      document.body.dataset.mood = mood;
    }
    if (!rig.ready) return;
    const raw = voiceLevel(now);
    stepMouth(now, raw);
    stepBlink(now);

    const k = 1 - Math.exp(-dt * 6); // 平滑系数（与帧率无关）
    const speaking = mood === 'speaking';
    rig.nod += ((speaking ? rig.level : 0) - rig.nod) * k;
    const tiltTarget = mood === 'thinking' ? -1.5 : 0;
    rig.tilt += (tiltTarget - rig.tilt) * (1 - Math.exp(-dt * 3));
    const lookTarget = mood === 'searching' ? 1 : 0;
    rig.look += (lookTarget - rig.look) * (1 - Math.exp(-dt * 3));

    const t = now / 1000;
    const breath = (1 - Math.cos((t * 2 * Math.PI) / 4.5)) / 2; // 0..1，4.5 秒一个周期
    const scale = 1 + 0.006 * breath;
    let ty = -2 * breath + 4 * rig.nod;
    let rot = 0.6 * Math.sin((t * 2 * Math.PI) / 9) + 0.8 * rig.nod * Math.sin(t * 7.3) + rig.tilt;
    let tx = 0;
    if (rig.look > 0.01) {
      const glance = Math.sin((t * 2 * Math.PI) / 2.2);
      rot += 1.2 * rig.look * glance;
      tx = 6 * rig.look * glance;
    }
    rig.char.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
  }
  requestAnimationFrame(frame);

  /* 调试 / 验证用（CDP 里读）：window.__radioRig() */
  window.__radioRig = () => ({
    ready: rig.ready, mouth: rig.mouthState, level: +rig.level.toFixed(3), mood: lastMood,
    audio: audio.src ? 'webaudio' : audio.failed ? 'failed' : audio.ctx ? audio.ctx.state : 'none',
    transform: rig.char ? rig.char.style.transform : '',
  });
  /* ---------- 启动 ---------- */
  el.heroImg.addEventListener('error', () => el.heroImg.classList.add('broken'));
  el.voice.volume = state.voiceVolume;
  el.music.volume = state.musicVolume;

  async function boot() {
    initRig().then(() => {
      if (rig.ready) resumeAudioCtx(); // 挂起时不接线，不会把声音弄哑
    });
    const [st, rd] = await Promise.all([getJson('/api/state'), getJson('/api/radio')]);
    if (st) applyInit(st);
    if (rd?.radio) renderRadio(rd.radio);
    connect();
  }
  boot();
})();
