/**
 * 抖音直播弹幕直连（移植自 cortico-world-douyin-live 的 vendor/douyin-danma）。
 *
 * 原理：先拿 ttwid，再解析出内部 roomId，然后连抖音网页直播的 WSS，
 * 逐帧 gunzip + protobuf 解包，把 chat / gift / member / like / social 变成事件。
 * 只读，不往抖音发任何东西。
 */
import { EventEmitter } from 'node:events';

import DouYinDanmaClient from '../vendor/douyin-danma/index.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

const ROOM_API = 'https://live.douyin.com/webcast/room/web/enter/';

/** 从「直播间号 / 完整链接 / 内部 id」里抠出 web_rid */
export function parseRid(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const byUrl = s.match(/live\.douyin\.com\/(\d{5,})/);
  if (byUrl) return byUrl[1];
  const bare = s.match(/^(\d{5,})$/);
  return bare ? bare[1] : '';
}

async function homeCookie() {
  try {
    const res = await fetch('https://live.douyin.com/', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    });
    const list = res.headers.getSetCookie?.() ?? [];
    return list.map((c) => c.split(';')[0]).join('; ');
  } catch {
    return '';
  }
}

/** 拿内部 roomId + 是否在播 */
export async function resolveRoom(input) {
  const webRid = parseRid(input);
  if (!webRid) throw new Error('房间号看不懂：填 857365080423 或 https://live.douyin.com/857365080423 都行');

  // 直接给内部 roomId（19 位）时跳过网页解析，方便自测
  if (webRid.length >= 15) {
    return { webRid, roomId: webRid, status: 2, title: '', cookie: await homeCookie() };
  }

  const cookie = await homeCookie();
  const url = new URL(ROOM_API);
  const params = {
    aid: '6383',
    app_name: 'douyin_web',
    live_id: '1',
    device_platform: 'web',
    language: 'zh-CN',
    enter_from: 'web_live',
    cookie_enabled: 'true',
    screen_width: '1920',
    screen_height: '1080',
    browser_language: 'zh-CN',
    browser_platform: 'Win32',
    browser_name: 'Chrome',
    browser_version: '134.0.0.0',
    web_rid: webRid,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Cookie: cookie, Referer: `https://live.douyin.com/${webRid}` },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  const room = body?.data?.data?.[0] ?? body?.data?.room ?? null;
  const roomId = room?.id_str || room?.idStr || '';
  if (!roomId) {
    throw new Error(`拿不到这个房间（status_code ${body?.status_code ?? '?'}），可能没开播`);
  }
  return {
    webRid,
    roomId: String(roomId),
    status: Number(room?.status ?? 0),
    title: String(room?.title || ''),
    cookie,
  };
}

const nick = (m) => String(m?.user?.nickName || m?.user?.nickname || m?.user?.displayId || '').trim();

/** 把抖音的原始消息映射成我们的事件（抽出来方便单测） */
export const mapChat = (m) => {
  const text = String(m?.content ?? m?.chatContent ?? '').trim();
  return text ? { kind: 'chat', username: nick(m), text } : null;
};

export const mapGift = (m) => {
  const giftName = String(m?.gift?.name || m?.giftName || m?.gift?.describe || '').trim();
  if (!giftName) return null;
  const count = Math.max(1, Number(m?.totalCount ?? m?.repeatCount ?? m?.gift?.count ?? 1));
  return { kind: 'gift', username: nick(m), giftName, count, diamond: Number(m?.gift?.diamondCount ?? 0) };
};

export const mapMember = (m) => ({ kind: 'enter', username: nick(m) });

export const mapLike = (m) => ({ kind: 'like', username: nick(m), count: Number(m?.count ?? 1) });

export const mapSocial = (m) => ({ kind: 'follow', username: nick(m) });

/**
 * 常驻连接：开播就抓、下播就等、换场次自动重连。
 * 事件：onEvent({kind, username, text, giftName, count, price})
 */
export class DanmakuBridge extends EventEmitter {
  constructor() {
    super();
    this.state = 'off';
    this.input = '';
    this.webRid = '';
    this.roomId = '';
    this.title = '';
    this.messages = 0;
    this.lastError = '';
    this.lastEventAt = 0;
    this.client = null;
    this.stopped = true;
    this.attempts = 0;
    this.nextTryAt = 0;
    this.since = 0;
  }

  status() {
    return {
      state: this.state,
      input: this.input,
      webRid: this.webRid,
      roomId: this.roomId,
      title: this.title,
      messages: this.messages,
      lastError: this.lastError,
      lastEventAt: this.lastEventAt,
      since: this.since,
      attempts: this.attempts,
      nextTryAt: this.stopped ? 0 : this.nextTryAt,
    };
  }

  async start(input) {
    const rid = parseRid(input);
    if (!rid) throw new Error('房间号看不懂：填 857365080423 或直播间链接都行');
    this.stop();
    this.stopped = false;
    this.input = rid;
    this.state = 'connecting';
    this.lastError = '';
    this.attempts = 0;
    this.since = Date.now();
    await this.loop();
    return this.status();
  }

  stop() {
    this.stopped = true;
    this.state = 'off';
    this.nextTryAt = 0;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.teardown();
  }

  teardown() {
    const c = this.client;
    this.client = null;
    if (!c) return;
    try {
      c.removeAllListeners?.();
      c.close?.();
    } catch {
      /* 忽略 */
    }
  }

  wait(ms) {
    if (this.timer) clearTimeout(this.timer);
    this.nextTryAt = Date.now() + ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.loop();
    }, ms);
  }

  async loop() {
    if (this.stopped) return;
    this.attempts += 1;
    let info;
    try {
      info = await resolveRoom(this.input);
    } catch (err) {
      this.state = 'error';
      this.lastError = String(err?.message || err);
      this.wait(20000);
      return;
    }
    if (this.stopped) return;

    this.webRid = info.webRid;
    this.title = info.title;
    if (info.status !== 2) {
      this.state = 'waiting';
      this.lastError = '还没开播，等开了自动连';
      this.wait(15000);
      return;
    }

    this.roomId = info.roomId;
    this.state = 'live';
    this.lastError = '';
    this.connect(info);
  }

  connect(info) {
    this.teardown();
    const client = new DouYinDanmaClient(info.roomId, {
      autoReconnect: 20,
      heartbeatInterval: 8000,
      timeoutInterval: 300000,
      reconnectInterval: 3000,
      cookie: info.cookie,
    });
    this.client = client;

    client.on('open', () => {
      this.state = 'live';
      this.lastError = '';
      this.emit('status', this.status());
    });
    client.on('close', () => {
      if (!this.stopped) this.state = 'reconnecting';
    });
    client.on('error', (err) => {
      const msg = String(err?.message || err || '');
      if (/invalid|decode|protobuf|gzip|incorrect header/i.test(msg)) return; // 单帧解析告警，连接还活着
      this.lastError = msg || '连接出错';
      this.state = 'reconnecting';
    });
    client.on('chat', (m) => {
      const ev = mapChat(m);
      if (ev) this.push(ev);
    });
    client.on('gift', (m) => {
      const ev = mapGift(m);
      if (ev) this.push(ev);
    });
    client.on('member', (m) => this.push(mapMember(m)));
    client.on('like', (m) => this.push(mapLike(m)));
    client.on('social', (m) => this.push(mapSocial(m)));

    Promise.resolve(client.connect()).catch((err) => {
      this.lastError = String(err?.message || err);
      this.state = 'reconnecting';
    });

    // 场次看护：每 45 秒重新解析一次，下播就收起，换场次就重连
    this.watch = setInterval(async () => {
      if (this.stopped) return;
      try {
        const now = await resolveRoom(this.input);
        if (this.stopped) return;
        if (now.status !== 2) {
          this.teardown();
          this.state = 'waiting';
          this.lastError = '下播了，等下次开播';
          clearInterval(this.watch);
          this.watch = null;
          this.wait(15000);
          return;
        }
        if (now.roomId !== this.roomId) {
          this.roomId = now.roomId;
          clearInterval(this.watch);
          this.watch = null;
          this.connect(now);
        }
      } catch {
        /* 网络抖动，下一轮再说 */
      }
    }, 45000);
    this.watch.unref?.();
  }

  push(ev) {
    this.messages += 1;
    this.lastEventAt = Date.now();
    this.emit('event', ev);
    if (this.messages === 1 || this.messages % 25 === 0) this.emit('status', this.status());
  }
}
