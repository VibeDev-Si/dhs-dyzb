/* 大肥鱼 · 抖音弹幕桥
 * 1) 监听直播间 DOM，把 弹幕 / 礼物 / 进场 / 关注 / 点赞 上报给本地服务
 * 2) 轮询服务的发送箱，把大肥鱼的回复打进直播间输入框
 */
(() => {
  const DEFAULTS = { server: 'http://127.0.0.1:8787', enabled: true };
  const POLL_MS = 2500;
  const BATCH_MS = 350;
  const SENT_GUARD_MS = 90_000;

  let conf = { ...DEFAULTS };
  let ready = false;
  const seenNodes = new WeakSet();
  const recentText = new Map();
  const sentTexts = new Map();
  const queue = [];
  const stats = { caught: 0, sent: 0, failed: 0, lastError: '', lastAt: 0 };

  // ---------- 存储 ----------
  function loadConf() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(DEFAULTS, (v) => {
          conf = { ...DEFAULTS, ...v };
          resolve(conf);
        });
      } catch {
        resolve(conf);
      }
    });
  }
  function saveStats() {
    try {
      chrome.storage.local.set({ stats: { ...stats, server: conf.server, enabled: conf.enabled, at: Date.now() } });
    } catch {}
  }
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.server) conf.server = changes.server.newValue || DEFAULTS.server;
    if (changes.enabled) conf.enabled = changes.enabled.newValue !== false;
  });

  // ---------- 文本解析 ----------
  const GIFT_RE = /^(.{1,24}?)\s*(?:送给主播|送出|赠送|投喂)\s*(.{1,16}?)(?:\s*[×xX*]\s*(\d+))?\s*$/;
  const ENTER_RE = /^(.{1,24}?)\s*(?:来了|进入了直播间|来啦)$/;
  const FOLLOW_RE = /^(.{1,24}?)\s*关注了主播/;
  const LIKE_RE = /^(.{1,24}?)\s*(?:为主播)?(?:点赞了?|点了赞)/;

  function cleanName(s) {
    return String(s)
      .replace(/^[\s\d·•Lv.级粉丝团灯牌]+/u, '')
      .replace(/[:：\s]+$/u, '')
      .trim()
      .slice(0, 24);
  }

  function parseLine(raw) {
    const line = String(raw).replace(/\s+/g, ' ').trim();
    if (!line || line.length > 180) return null;

    // 「昵称：内容」形式（最常见）
    const colon = line.match(/^(.{1,24}?)[：:]\s*(.+)$/s);
    if (colon) {
      const username = cleanName(colon[1]);
      const body = colon[2].trim();
      if (!username || !body) return null;
      const g = body.match(/^(?:送出|赠送|送给主播|投喂)\s*(.{1,16}?)(?:\s*[×xX*]\s*(\d+))?\s*$/);
      if (g) {
        return { kind: 'gift', username, giftName: g[1].trim(), count: Number(g[2] || 1) };
      }
      if (/^(?:来了|来啦|进入直播间|进入了直播间|刚来|来咯)$/.test(body)) return { kind: 'enter', username };
      if (/^关注了主播$/.test(body)) return { kind: 'follow', username };
      if (/^(?:为主播)?(?:点赞了?|点了赞)$/.test(body)) return { kind: 'like', username };
      return { kind: 'chat', username, text: body };
    }

    const gift = line.match(GIFT_RE);
    if (gift) {
      return { kind: 'gift', username: cleanName(gift[1]), giftName: gift[2].trim(), count: Number(gift[3] || 1) };
    }
    const enter = line.match(ENTER_RE);
    if (enter) return { kind: 'enter', username: cleanName(enter[1]) };
    const follow = line.match(FOLLOW_RE);
    if (follow) return { kind: 'follow', username: cleanName(follow[1]) };
    const like = line.match(LIKE_RE);
    if (like) return { kind: 'like', username: cleanName(like[1]) };
    return null;
  }

  // ---------- 上报 ----------
  function enqueue(item) {
    const key = `${item.kind}|${item.username}|${item.text ?? item.giftName ?? ''}`;
    const now = Date.now();
    const last = recentText.get(key) || 0;
    if (now - last < 5000) return;
    recentText.set(key, now);
    if (recentText.size > 400) {
      for (const [k, v] of recentText) if (now - v > 120_000) recentText.delete(k);
    }
    if (item.kind === 'chat') {
      for (const [t, ts] of sentTexts) if (now - ts < SENT_GUARD_MS && t === item.text) return; // 自己发的，不回流
    }
    queue.push(item);
  }

  let flushing = false;
  async function flush() {
    if (flushing || !ready || !conf.enabled) return;
    flushing = true;
    try {
      while (queue.length) {
        const item = queue.shift();
        try {
          const res = await fetch(`${conf.server}/api/event`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...item, source: 'extension', ts: Date.now(), url: location.href }),
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          stats.caught += 1;
          stats.lastAt = Date.now();
          saveStats();
        } catch (err) {
          stats.lastError = err.message;
          saveStats();
        }
      }
    } finally {
      flushing = false;
    }
  }
  setInterval(flush, BATCH_MS);

  // ---------- DOM 采集 ----------
  function inChatArea(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    for (let i = 0; i < 9 && el; i += 1) {
      const cls = `${el.className || ''} ${el.id || ''} ${el.getAttribute?.('data-e2e') || ''}`;
      if (/chat|danmaku|comment|message|interaction|barrage/i.test(cls)) return true;
      el = el.parentElement;
    }
    return false;
  }

  const pendingNodes = new Set();
  let scanTimer = null;

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      const nodes = [...pendingNodes];
      pendingNodes.clear();
      for (const node of nodes) {
        if (!node.isConnected) continue;
        if (seenNodes.has(node)) continue;
        seenNodes.add(node);
        const text = (node.innerText || node.textContent || '').trim();
        if (!text || text.length > 180) continue;
        if (!inChatArea(node)) continue;
        if (node.querySelector && node.querySelector('textarea, input, [contenteditable="true"]')) continue;
        const parsed = parseLine(text);
        if (parsed) enqueue(parsed);
      }
    }, 120);
  }

  const observer = new MutationObserver((records) => {
    for (const rec of records) {
      if (rec.type !== 'childList') continue;
      for (const node of rec.addedNodes) {
        if (node.nodeType !== 1) continue;
        pendingNodes.add(node);
      }
    }
    scheduleScan();
  });

  // 只挂载在直播间脚本上
  function startObserve() {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ---------- 回写回复 ----------
  function findInput() {
    const selectors = [
      'textarea[placeholder*="说点"]',
      'textarea[placeholder*="发送"]',
      'textarea[placeholder*="弹幕"]',
      '.webcast-chatroom___bottom textarea',
      '[class*="chatroom"] textarea',
      '[class*="chat-input"] [contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder]',
      'textarea',
      'div[contenteditable="true"]',
    ];
    for (const sel of selectors) {
      const nodes = document.querySelectorAll(sel);
      for (const el of nodes) {
        const r = el.getBoundingClientRect();
        if (r.width > 40 && r.height > 10) return el;
      }
    }
    return null;
  }

  function setInputValue(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    document.execCommand('selectAll', false, null);
    const ok = document.execCommand('insertText', false, text);
    if (!ok) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }
    return true;
  }

  function findSendButton(input) {
    let root = input.parentElement;
    for (let i = 0; i < 6 && root; i += 1) {
      const btns = [...root.querySelectorAll('button, [role="button"], span, div')];
      for (const b of btns) {
        const t = (b.textContent || '').trim();
        if (t !== '发送' && t !== '发送弹幕' && t !== 'Send') continue;
        const r = b.getBoundingClientRect();
        if (r.width > 10 && r.height > 10) return b;
      }
      root = root.parentElement;
    }
    return null;
  }

  function pressEnter(el) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, opts));
    }
  }

  async function sendComment(text) {
    const input = findInput();
    if (!input) {
      stats.lastError = '找不到直播间输入框（页面还没加载好？）';
      saveStats();
      return false;
    }
    // 先登记，免得自己的弹幕在「发送后清空输入框」判定完成前被 MutationObserver 抓回去
    sentTexts.set(text, Date.now());
    try {
      setInputValue(input, text);
      await new Promise((r) => setTimeout(r, 220));
      const btn = findSendButton(input);
      if (btn) {
        btn.click();
      } else {
        pressEnter(input);
      }
      await new Promise((r) => setTimeout(r, 420));
      const left = (input.value ?? input.textContent ?? '').trim();
      if (left === text && left.length > 0) {
        // 没发出去：再试一次 Enter
        pressEnter(input);
        await new Promise((r) => setTimeout(r, 300));
      }
      const after = (input.value ?? input.textContent ?? '').trim();
      const ok = after !== text;
      if (ok) {
        sentTexts.set(text, Date.now());
        stats.sent += 1;
      } else {
        sentTexts.delete(text);
        stats.failed += 1;
        stats.lastError = '发送后输入框没清空，可能被限制';
      }
      saveStats();
      return ok;
    } catch (err) {
      sentTexts.delete(text);
      stats.lastError = err.message;
      stats.failed += 1;
      saveStats();
      return false;
    }
  }

  async function pollOutbox() {
    if (!ready || !conf.enabled) return;
    try {
      const res = await fetch(`${conf.server}/api/outbox`);
      if (!res.ok) return;
      const data = await res.json();
      for (const it of data.items || []) {
        const ok = await sendComment(it.text);
        await fetch(`${conf.server}/api/outbox/ack`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: [it.id], ok, error: ok ? null : stats.lastError }),
        }).catch(() => {});
        await new Promise((r) => setTimeout(r, 900));
      }
    } catch (err) {
      stats.lastError = err.message;
      saveStats();
    }
  }

  // ---------- 启动 ----------
  loadConf().then(() => {
    ready = true;
    startObserve();
    setInterval(pollOutbox, POLL_MS);
    pollOutbox();
    saveStats();
    console.log('[大肥鱼弹幕桥] 已启动 →', conf.server);
  });
})();
