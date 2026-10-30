// 音乐播放源：本地曲库（music/ 目录）+ 在线解析（网易云外链 / 自定义 API）
// 只做「解析出可播放地址」，不下载、不缓存音频；文件流由 server 直接吐给浏览器。
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename, relative } from 'node:path';

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.wav', '.flac', '.webm', '.opus']);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const MIN_AUDIO_BYTES = 300 * 1024; // 小于这个多半是「无版权/试听」占位

let cache = new Map(); // 解析结果缓存：query -> { at, value }
const CACHE_MS = 10 * 60 * 1000;

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[·・,，。!！?？'"“”‘’\-—_/\\|:：;；]+/g, '');
}

/* ---------------- 本地曲库 ---------------- */

let library = { at: 0, dir: '', tracks: [] };

export function musicDir(cfg) {
  return join(process.cwd(), cfg?.music?.dir || 'music');
}

export function listLocal(cfg, { force = false } = {}) {
  const dir = musicDir(cfg);
  if (!force && library.dir === dir && Date.now() - library.at < 60_000) return library.tracks;
  const tracks = [];
  if (existsSync(dir)) {
    const walk = (d) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        let st;
        try {
          st = statSync(p);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (!name.startsWith('.')) walk(p);
          continue;
        }
        const ext = extname(name).toLowerCase();
        if (!AUDIO_EXT.has(ext)) continue;
        const stem = basename(name, extname(name)).trim();
        let title = stem;
        let by = '';
        const m = stem.match(/^(.{1,40}?)\s*[-–—]\s*(.{1,40})$/);
        if (m) {
          by = m[1].trim();
          title = m[2].trim();
        }
        tracks.push({
          id: Buffer.from(relative(dir, p)).toString('base64url'),
          file: relative(dir, p),
          path: p,
          title,
          by,
          size: st.size,
          mtime: st.mtimeMs,
          ext,
          kind: 'local',
        });
      }
    };
    try {
      walk(dir);
    } catch {
      /* 目录读不了就当空 */
    }
  }
  tracks.sort((a, b) => a.file.localeCompare(b.file, 'zh'));
  library = { at: Date.now(), dir, tracks };
  return tracks;
}

export function findLocal(cfg, query) {  const q = norm(query);
  if (!q) return null;
  const tracks = listLocal(cfg);
  let best = null;
  for (const t of tracks) {
    const title = norm(t.title);
    const full = norm(`${t.by}${t.title}`);
    let score = 0;
    if (title === q || full === q) score = 100;
    else if (title.includes(q) || q.includes(title)) score = 80 - Math.abs(title.length - q.length);
    else if (full.includes(q) || q.includes(full)) score = 60 - Math.abs(full.length - q.length);
    if (score > (best?.score ?? 0)) best = { ...t, score };
  }
  return best && best.score > 0 ? best : null;
}

export function findById(cfg, id) {
  const tracks = listLocal(cfg);
  const hit = tracks.find((t) => t.id === id);
  if (hit) return hit;
  // 兼容旧 id（截断过的）
  return tracks.find((t) => t.id.startsWith(id) && id.length >= 8) || null;
}

export function trackPath(cfg, track) {
  const dir = musicDir(cfg);
  const p = join(dir, track.file);
  const rel = relative(dir, p);
  if (rel.startsWith('..') || rel.includes('..')) return null;
  return p;
}

/* ---------------- 在线解析 ---------------- */

async function probeAudio(url, { referer = '' } = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Range: 'bytes=0-1023',
        ...(referer ? { Referer: referer } : {}),
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    const type = res.headers.get('content-type') || '';
    const len = Number(res.headers.get('content-range')?.split('/')?.[1] || res.headers.get('content-length') || 0);
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    if (!/audio|octet-stream|mpeg/i.test(type)) return { ok: false, reason: `content-type ${type || '空'}` };
    if (len && len < MIN_AUDIO_BYTES) return { ok: false, reason: `文件只有 ${Math.round(len / 1024)}KB，像是试听占位` };
    return { ok: true, size: len, finalUrl: res.url || url };
  } catch (e) {
    return { ok: false, reason: e.name === 'TimeoutError' ? '请求超时' : e.message };
  }
}

async function neteaseSearch(query) {
  const u = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=1&limit=6&offset=0`;
  const res = await fetch(u, {
    headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`网易云搜索 ${res.status}`);
  const data = await res.json();
  const songs = data?.result?.songs || [];
  return songs.map((s) => ({
    provider: 'netease',
    id: String(s.id),
    title: String(s.name || '').trim(),
    by: (s.artists || []).map((a) => a.name).join(' / '),
    durationSec: s.duration ? Math.round(s.duration / 1000) : null,
    url: `https://music.163.com/song/media/outer/url?id=${s.id}.mp3`,
  }));
}

async function customSearch(cfg, query) {
  const base = String(cfg?.music?.apiBase || '').replace(/\/$/, '');
  if (!base) throw new Error('还没配置 music.apiBase（自建 NeteaseCloudMusicApi 的地址）');
  const res = await fetch(`${base}/search?keywords=${encodeURIComponent(query)}&limit=6`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`自定义音源搜索 ${res.status}`);
  const data = await res.json();
  const songs = data?.result?.songs || [];
  const out = [];
  for (const s of songs.slice(0, 6)) {
    out.push({
      provider: 'custom',
      id: String(s.id),
      title: String(s.name || '').trim(),
      by: (s.ar || s.artists || []).map((a) => a.name).join(' / '),
      durationSec: s.dt ? Math.round(s.dt / 1000) : null,
      url: `${base}/song/url?id=${s.id}`,
      needResolve: true,
    });
  }
  return out;
}

async function customResolve(cfg, candidate) {
  const base = String(cfg?.music?.apiBase || '').replace(/\/$/, '');
  const res = await fetch(`${base}/song/url?id=${candidate.id}&br=128000`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`自定义音源取链 ${res.status}`);
  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error('自定义音源没有返回可播放地址（可能要登录/会员）');
  return url;
}

export function providers(cfg) {
  const p = cfg?.music?.provider || 'auto';
  return p;
}

/**
 * 把「点歌 X」解析成可播放的东西。
 * 返回 { title, by, url, kind, provider, id, durationSec } 或 null（真的没有源）
 */
export async function resolveTrack(cfg, query, { title, by } = {}) {
  const q = String(query || title || '').trim();
  if (!q) return null;

  const key = norm(q);
  const hitCache = cache.get(key);
  if (hitCache && Date.now() - hitCache.at < CACHE_MS) return hitCache.value;

  const provider = providers(cfg);
  const result = async () => {
    if (provider !== 'netease' && provider !== 'custom') {
      const local = findLocal(cfg, q);
      if (local) {
        return {
          title: local.title,
          by: local.by,
          id: local.id,
          kind: 'local',
          provider: 'local',
          url: `/api/music/stream/${encodeURIComponent(local.id)}`,
          durationSec: null,
        };
      }
      if (provider === 'local') return null;
    }

    if (provider === 'netease' || provider === 'auto') {
      try {
        const cands = await neteaseSearch(q);
        for (const c of cands) {
          const probe = await probeAudio(c.url, { referer: 'https://music.163.com/' });
          if (probe.ok) return { ...c, kind: 'remote', durationSec: c.durationSec || null };
        }
      } catch {
        /* 搜索失败就当没源，继续下面的 */
      }
    }

    if ((provider === 'custom' || provider === 'auto') && cfg?.music?.apiBase) {
      try {
        const cands = await customSearch(cfg, q);
        for (const c of cands) {
          const url = await customResolve(cfg, c);
          const probe = await probeAudio(url);
          if (probe.ok) return { ...c, url, kind: 'remote' };
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  };

  const value = await result();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}

export async function search(cfg, q) {
  const local = listLocal(cfg)
    .filter((t) => norm(`${t.by}${t.title}`).includes(norm(q)))
    .slice(0, 6)
    .map((t) => ({ provider: 'local', id: t.id, title: t.title, by: t.by, url: `/api/music/stream/${encodeURIComponent(t.id)}` }));
  let online = [];
  try {
    if ((cfg?.music?.provider || 'auto') !== 'local') online = await neteaseSearch(q);
  } catch {
    online = [];
  }
  return [...local, ...online];
}

export function clearCache() {
  cache = new Map();
}
