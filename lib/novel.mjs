/**
 * 小说朗读引擎：从「短篇」目录取当天的小说，一章一章念下去，
 * 每章念完休息几分钟（这段时间用语音和弹幕聊剧情、但不剧透），
 * 整本念完展示作品档案 + 和观众聊优点缺点，并收集第二天的选题投票。
 *
 * 状态落盘：data/novel.json（文件、第几章、阶段、休息截止时间、各章小结、档案、选题票）
 */
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname, basename, dirname, relative, sep } from 'node:path';
import { ROOT } from './config.mjs';

const DATA_DIR = join(ROOT, 'data');
const STATE_PATH = join(DATA_DIR, 'novel.json');

const PHASE_LABEL = {
  idle: '待开播',
  preparing: '准备中',
  reading: '朗读中',
  break: '休息 · 聊天',
  afterword: '作品讨论',
  done: '读完了',
};

const MOOD_OF = {
  idle: 'idle',
  preparing: 'type',
  reading: 'type',
  break: 'wave',
  afterword: 'wave',
  done: 'idle',
};

let state = null;
let chapters = []; // [{ title, text }]
let filePath = '';

const now = () => Date.now();

export function novelDir(cfg) {
  return join(ROOT, cfg?.novel?.dir || '短篇');
}

/** 目录里的小说（按修改时间倒序，递归两层，跳过设定/说明类文件） */
const META_NAMES =
  /(说明|readme|index|目录|选题|设定|角色|人物|章节规划|大纲|交付|工艺约束|审查|review|作品信息|status)/i;
const META_EXT = /^(json|jsonl|csv)$/i;

export function listNovels(cfg) {
  const dir = novelDir(cfg);
  if (!existsSync(dir)) return [];
  const out = [];
  const seen = new Set();
  const walk = (d, depth) => {
    if (depth > 2) return;
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('_') || e.name.startsWith('#')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) {
        walk(p, depth + 1);
        continue;
      }
      if (!/\.(txt|md)$/i.test(e.name)) continue;
      if (META_NAMES.test(e.name) || META_EXT.test(extname(e.name).slice(1))) continue;
      try {
        const st = statSync(p);
        if (!st.isFile() || st.size < 500) continue;
        // 同一个作品文件夹里同时有「正文.md」和「书名.txt」时，只留正文.md
        const folder = dirname(p);
        const key = folder + '|' + basename(folder);
        if (/^正文\.(txt|md)$/i.test(e.name) && seen.has(key)) continue;
        if (!/^正文\.(txt|md)$/i.test(e.name)) seen.add(key);
        out.push({
          name: relative(dir, p).split(sep).join('/'),
          path: p,
          file: e.name,
          folder,
          size: st.size,
          mtime: st.mtimeMs,
          day: dayKey(st.mtimeMs),
          title: basename(e.name, extname(e.name)),
        });
      } catch {
        /* 读不到就跳过 */
      }
    }
  };
  walk(dir, 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/** 同一本书旁边的设定/角色/大纲（给「读完讨论」用） */
export function readMeta(novel) {
  if (!novel?.folder) return {};
  const want = ['设定.md', '角色.md', '人物.md', '章节规划.md', '大纲.md', '交付说明.md'];
  const got = {};
  for (const name of want) {
    const p = join(novel.folder, name);
    if (!existsSync(p)) continue;
    try {
      const st = statSync(p);
      if (st.size > 40000) continue;
      got[name.replace(/\.md$/, '')] = readFileSync(p, 'utf8').trim().slice(0, 12000);
    } catch {
      /* 跳过 */
    }
  }
  const info = join(novel.folder, '作品信息', '作品信息.md');
  if (existsSync(info)) {
    try {
      got['作品信息'] = readFileSync(info, 'utf8').trim().slice(0, 4000);
    } catch {
      /* 跳过 */
    }
  }
  return got;
}

function dayKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const CHAPTER_RE = /^[ \t]*(?:#{1,6}[ \t]*)?(第[零〇一二三四五六七八九十百千两0-9]{1,7}[章回节卷篇][^\n]{0,40})[ \t]*$/m;

/** 把一本小说切成一章一章 */
export function parseNovel(raw, name = '') {
  let text = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  const marks = [];
  for (const m of text.matchAll(new RegExp(CHAPTER_RE.source, 'gm'))) {
    marks.push({ at: m.index, title: m[1].trim() });
  }

  let title = basename(name, extname(name)).trim();
  let body = text;
  if (marks.length === 0) {
    // 没有章节标记：按空行切成 ~2000 字的段
    body = text.replace(/\n+/g, '\n').trim();
    const firstLine = body.split('\n')[0]?.trim() || '';
    if (firstLine && firstLine.length <= 40) {
      title = firstLine.replace(/^#+\s*/, '');
      body = body.slice(firstLine.length).trim();
    }
    const chunks = [];
    let buf = '';
    for (const para of body.split(/\n/)) {
      if ((buf + para).length > 2000) {
        if (buf.trim()) chunks.push(buf.trim());
        buf = '';
      }
      buf += para + '\n';
    }
    if (buf.trim()) chunks.push(buf.trim());
    const list = chunks.length ? chunks : [body];
    return {
      title,
      chapters: list.map((t, i) => ({ title: `第 ${i + 1} 段`, text: t })),
      settings: '',
    };
  }

  // 第一章之前的内容当「作品设定」保留下来
  const head = text.slice(0, marks[0].at).trim();
  const firstLine = head.split('\n')[0]?.trim() || '';
  if (firstLine && firstLine.length <= 40) title = firstLine.replace(/^#+\s*/, '');
  const settings = head.length > 20 ? head.slice(0, 4000) : '';

  const list = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].at;
    const end = i + 1 < marks.length ? marks[i + 1].at : text.length;
    const seg = text.slice(start, end).trim();
    const [t0, ...rest] = seg.split('\n');
    const bodyText = rest.join('\n').trim();
    if (bodyText) list.push({ title: t0.trim().replace(/^#{1,6}\s*/, ''), text: bodyText });
  }

  return { title, chapters: list, settings };
}

/** 读文件并解析（不碰状态） */
export function loadNovelFile(cfg, name) {
  const list = listNovels(cfg);
  let pick = null;
  if (name) pick = list.find((n) => n.name === name) || null;
  if (!pick) {
    const today = dayKey(now());
    pick = list.find((n) => n.day === today) || list[0] || null;
  }
  if (!pick) return null;
  const raw = readFileSync(pick.path, 'utf8');
  const parsed = parseNovel(raw, pick.file || pick.name);
  filePath = pick.path;
  const meta = readMeta(pick);
  const title = parsed.title && parsed.title !== basename(pick.file || pick.name, extname(pick.file || pick.name))
    ? parsed.title
    : pick.title;
  return {
    file: pick.name,
    path: pick.path,
    mtime: pick.mtime,
    day: pick.day,
    ...parsed,
    title,
    meta,
  };
}

/* ---------------- 状态 ---------------- */

function blankState() {
  return {
    file: '',
    title: '',
    settings: '',
    idx: 0,
    phase: 'idle',
    displayMode: 'story',
    auto: true,
    startedAt: 0,
    chapterStartedAt: 0,
    breakEndsAt: 0,
    audioUrl: '',
    audioMs: 0,
    summaries: [],
    /* 每章的「线索卡」：{ summary, people, clues, puzzles } */
    cards: [],
    /* 定时开讲：这一次的提醒是给哪个开讲时间发的，防止重复提醒 */
    remindedFor: 0,
    archive: null,
    topics: [],
    history: [],
    seq: 0,
  };
}

export async function initNovel(cfg) {
  mkdirSync(DATA_DIR, { recursive: true });
  try {
    if (existsSync(STATE_PATH)) state = { ...blankState(), ...JSON.parse(readFileSync(STATE_PATH, 'utf8')) };
  } catch {
    /* 坏了就当新开 */
  }
  if (!state) state = blankState();

  // 重启后把正在读的那本的章节重新装回来（章节正文不落盘）
  if (state.file) {
    try {
      const loaded = loadNovelFile(cfg, state.file);
      if (loaded) chapters = loaded.chapters;
    } catch {
      /* 文件没了就当空的 */
    }
  }
}

export function saveNovel() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch {
    /* 落盘失败不影响播放 */
  }
}

export function getNovel() {
  return state;
}

export function resetNovel() {
  const keep = { topics: state?.topics || [], archive: null };
  state = { ...blankState(), topics: keep.topics };
  chapters = [];
  filePath = '';
  return state;
}

/** 开一场：装文件、从第一章开始 */
export function startNovel(cfg, { file } = {}) {
  const loaded = loadNovelFile(cfg, file || state?.file);
  if (!loaded) return { ok: false, error: '「短篇」目录里还没有小说' };
  state = {
    ...blankState(),
    file: loaded.file,
    title: loaded.title,
    settings: loaded.settings,
    meta: loaded.meta || {},
    phase: 'preparing',
    displayMode: 'story',
    auto: state?.auto !== false,
    startedAt: now(),
    topics: state?.topics || [],
    seq: (state?.seq || 0) + 1,
  };
  chapters = loaded.chapters;
  state.idx = 0;
  saveNovel();
  return { ok: true, file: loaded.file, title: loaded.title, chapters: chapters.length };
}

export function chapterAt(i) {
  return chapters[i] || null;
}

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function cnNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 0 || num > 99) return String(n);
  if (num < 10) return CN_NUM[num];
  if (num < 20) return '十' + (num % 10 ? CN_NUM[num % 10] : '');
  return CN_NUM[Math.floor(num / 10)] + '十' + (num % 10 ? CN_NUM[num % 10] : '');
}

/** 念出来的章节名：把「第1章：白布」变成「第一章，白布」 */
export function spokenTitle(title) {
  return String(title || '')
    .replace(/^#+\s*/, '')
    .replace(/第\s*(\d{1,2})\s*([章回节卷篇])/g, (_, d, u) => `第${cnNumber(d)}${u}`)
    .replace(/[：:]/g, '，')
    .trim();
}

/** 正文转成「念出来的文本」：去掉单独的数字场景标记、多余空行 */
export function speechOf(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => !/^[ \t]*\d{1,3}[ \t]*$/.test(line))
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function chapterCount() {
  return chapters.length;
}

export function chaptersOf() {
  return chapters;
}

export function novelInfo() {
  const s = state || blankState();
  return {
    file: s.file,
    title: s.title,
    settings: s.settings,
    meta: s.meta || {},
    summaries: (s.summaries || []).filter(Boolean),
  };
}

export function currentChapter() {
  return chapters[state?.idx ?? 0] || null;
}

/** 一章念完 → 进入休息 */
export function endChapter(cfg) {
  const sec = Math.max(30, Number(cfg?.novel?.breakSec || 300));
  state.phase = 'break';
  state.displayMode = 'story';
  state.breakEndsAt = now() + sec * 1000;
  saveNovel();
  return state;
}

/** 音频准备好了 → 正式开始念这一章 */
export function beginReading() {
  state.phase = 'reading';
  state.displayMode = 'story';
  state.chapterStartedAt = now();
  saveNovel();
  return state;
}

export function setBreakSeconds(sec) {
  state.breakEndsAt = now() + Math.max(10, Number(sec) || 300) * 1000;
  saveNovel();
}

/** 休息结束 → 下一章；最后一章念完 → 作品讨论 */
export function nextChapter() {
  if (state.idx + 1 < chapters.length) {
    state.idx += 1;
    state.phase = 'preparing';
    state.displayMode = 'story';
    state.chapterStartedAt = now();
    state.breakEndsAt = 0;
    state.audioUrl = '';
    saveNovel();
    return { ok: true, more: true, idx: state.idx };
  }
  state.phase = 'afterword';
  state.displayMode = 'story';
  state.breakEndsAt = 0;
  saveNovel();
  return { ok: true, more: false };
}

export function finishNovel() {
  state.phase = 'done';
  saveNovel();
}

/** 暂停：停在当前章，等下次继续（不清进度） */
export function stopNovel() {
  state.phase = 'idle';
  state.displayMode = 'story';
  state.breakEndsAt = 0;
  saveNovel();
  return state;
}

export function setAudio(url, ms) {
  state.audioUrl = url || '';
  state.audioMs = ms || 0;
  saveNovel();
}

/** 中间纸面显示：story / characters / settings。
 *  角色和设定是「临时看一眼」：seconds 秒后（默认 90）自动回到正文，
 *  回到正文时按音频进度定位到当前读到的位置。 */
export function setDisplayMode(mode, { seconds = 90 } = {}) {
  const value = ['story', 'characters', 'settings'].includes(String(mode)) ? String(mode) : 'story';
  state.displayMode = value;
  state.viewUntil = value === 'story' ? 0 : now() + Math.max(15, Number(seconds) || 90) * 1000;
  saveNovel();
  return value;
}

/** 到点就自动切回正文（返回当前真正该显示的模式） */
export function activeDisplayMode() {
  const m = ['story', 'characters', 'settings'].includes(state.displayMode) ? state.displayMode : 'story';
  if (m !== 'story' && state.viewUntil && now() > state.viewUntil) {
    state.displayMode = 'story';
    state.viewUntil = 0;
    saveNovel();
    return 'story';
  }
  return m;
}

/** 页面读到音频真实时长后回填（看门狗用） */
export function setAudioMs(ms) {
  const v = Math.round(Number(ms) || 0);
  if (v > 0) state.audioMs = v;
  saveNovel();
  return state.audioMs;
}

export function setSummary(i, text) {
  state.summaries[i] = String(text || '').slice(0, 200);
  saveNovel();
}

/** 存这一章的线索卡（人物动向 / 新线索 / 未解谜团） */
export function setCard(i, card) {
  if (!card) return;
  if (!Array.isArray(state.cards)) state.cards = [];
  state.cards[i] = {
    summary: cleanLine(card.summary).slice(0, 120),
    people: cleanLine(card.people).slice(0, 90),
    clues: cleanLine(card.clues).slice(0, 90),
    puzzles: cleanLine(card.puzzles).slice(0, 90),
  };
  saveNovel();
}

function cleanLine(v) {
  return String(v || '')
    .replace(/^["“「]|["”」]$/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
}

/** 让模型读这一章，产出「小结 + 人物动向 + 新线索 + 未解谜团」四行 */
export function buildCardMessages({ title, text, cast }) {
  return [
    {
      role: 'system',
      content:
        '你是一个小说直播的场记。读完这一章，用四行中文概括给观众看，不要评价文笔、不要剧透后面还没念的内容。\n' +
        '只输出一个 JSON 对象，不要 markdown、不要解释，字段如下：\n' +
        '{"summary":"这一章发生了什么，40～60 字","people":"这一章里人物有什么变化或暴露了什么，不超过 40 字","clues":"这一章出现的新线索/新证据，不超过 40 字","puzzles":"这一章留下的疑问，不超过 40 字"}\n' +
        '四行都要写，写不出来就写「本章没有」；不要出现「本章」以外的代词指代错误。',
    },
    {
      role: 'user',
      content: `章节名：${title || '未命名'}\n${cast ? `主要人物：${cast}\n` : ''}正文：\n${String(text || '').slice(0, 6000)}`,
    },
  ];
}

/** 从模型输出里抠出四行；抠不出来返回 null */
export function parseCard(raw) {
  const s = String(raw || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(s.slice(start, end + 1));
    const out = {
      summary: cleanLine(obj.summary || obj['小结'] || ''),
      people: cleanLine(obj.people || obj['人物'] || ''),
      clues: cleanLine(obj.clues || obj['线索'] || ''),
      puzzles: cleanLine(obj.puzzles || obj['疑问'] || ''),
    };
    return out.summary || out.people || out.clues || out.puzzles ? out : null;
  } catch {
    return null;
  }
}

/** 没 Key / 模型抽风时的规则兜底：从正文里抠句子 */
export function fallbackCard({ text, cast }) {
  const plain = String(text || '').replace(/\s+/g, ' ').trim();
  const sentences = plain
    .split(/[。！？!?；;\n]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 6);

  const pick = (re, n = 2) =>
    sentences
      .filter((x) => re.test(x))
      .slice(0, n)
      .map((x) => (x.length > 34 ? x.slice(0, 34) + '…' : x))
      .join('；');

  const names = (cast || []).filter((n) => plain.includes(n)).slice(0, 4);
  return {
    summary: plain.slice(0, 46) + (plain.length > 46 ? '…' : ''),
    people: names.length ? `${names.join('、')} 在这一章里露面` : '本章没有新人物',
    clues: pick(/发现|看见|听到|刻着|写着|照片|疤|痕|钥匙|红鞋|信|门牌|监控/) || '本章没有明显新线索',
    puzzles: pick(/为什么|谁|到底|怎么会|难道|是不是/) || '这一章留下的疑问还不清楚',
  };
}

/** 从元数据里抠人物名，给兜底和提示词用 */
export function castNames(novel) {
  const raw = `${novel?.meta?.['角色'] || ''}\n${novel?.meta?.['人物'] || ''}`;
  const out = [];
  for (const seg of raw.split(/[\n\r。；;！!？?]+/)) {
    const m = seg.trim().match(/^([\u4e00-\u9fa5A-Za-z·]{2,6})\s*(?:[（(][^）)]{0,20}[）)])?\s*[：:]/);
    if (!m) continue;
    const name = m[1];
    if (/^(主角|姐姐|母亲|父亲|角色|人物|说明|备注)$/.test(name)) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out.slice(0, 10);
}

export function setArchive(obj) {
  state.archive = obj || null;
  saveNovel();
}

/** 收一句选题票 */
export function addTopic(text, user) {
  const t = String(text || '').trim().slice(0, 80);
  if (!t) return null;
  let item = state.topics.find((x) => x.text === t);
  if (!item) {
    item = { text: t, count: 0, users: [] };
    state.topics.push(item);
  }
  item.count += 1;
  if (user && !item.users.includes(user)) item.users.push(user);
  if (state.topics.length > 50) state.topics = state.topics.slice(-50);
  saveNovel();
  return item;
}

/* ---------------- 定时开讲 ---------------- */

/** "20:30" → 今天 20:30 的时间戳；解析不出来返回 0 */
export function todayStartMs(startAt, base = Date.now()) {
  const m = String(startAt || '').trim().match(/^(\d{1,2})[:：](\d{2})$/);
  if (!m) return 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!(h >= 0 && h < 24 && min >= 0 && min < 60)) return 0;
  const d = new Date(base);
  d.setHours(h, min, 0, 0);
  return d.getTime();
}

/** 页面上显示的开讲时间：没设置就默认晚上 17:00 */
export const DEFAULT_START_AT = '17:00';
export function effectiveStartAt(cfg) {
  const v = String(cfg?.novel?.startAt || '').trim();
  return v || DEFAULT_START_AT;
}

/** 下一次开讲时间：今天还没到就是今天，过了就到明天；没设时间就按默认 17:00 */
export function nextStartMs(cfg, base = Date.now()) {
  const at = effectiveStartAt(cfg);
  const t = todayStartMs(at, base);
  if (!t) return 0;
  /* 开讲后 3 分钟内还算「今天这场」，再往后就顺延到明天 */
  return base <= t + 3 * 60_000 ? t : t + 24 * 3600_000;
}

export function markReminded(ts) {
  state.remindedFor = Number(ts) || 0;
  saveNovel();
}

export function topTopics(n = 8) {
  return [...(state?.topics || [])].sort((a, b) => b.count - a.count).slice(0, n);
}

/* ---------------- 给前端的视图 ---------------- */

export function novelView(cfg) {
  const s = state || blankState();
  const ch = chapters[s.idx] || null;
  const breakSec = Number(cfg?.novel?.breakSec || 300);
  const leftSec = s.phase === 'break' && s.breakEndsAt ? Math.max(0, Math.round((s.breakEndsAt - now()) / 1000)) : 0;
  const total = chapters.length;
  const phaseLabel =
    s.phase === 'break' ? `休息 ${fmt(leftSec)}` : PHASE_LABEL[s.phase] || s.phase;

  return {
    mode: 'novel',
    enabled: cfg?.novel?.enabled !== false,
    auto: s.auto !== false,
    running: s.phase === 'reading' || s.phase === 'preparing' || s.phase === 'break',
    phase: s.phase,
    phaseLabel,
    mood: MOOD_OF[s.phase] || 'idle',
    title: s.title || (ch ? '未命名' : '等一本新的小说'),
    file: s.file,
    chapter: ch ? ch.title : '',
    chapterIndex: s.idx,
    chapterCount: total,
    chapterTitle: ch?.title || '',
    displayMode: activeDisplayMode(),
    viewUntil: s.viewUntil || 0,
    text: ch?.text || '',
    summary: s.summaries[s.idx] || '',
    summaries: s.summaries,
    /* 这一章的线索卡（休息时才在页面上露出来） */
    card: (Array.isArray(s.cards) && s.cards[s.idx]) || null,
    audioUrl: s.audioUrl || '',
    audioMs: s.audioMs || 0,
    preparing: s.phase === 'preparing',
    countdown: leftSec,
    breakSec,
    progress: total ? Math.round(((s.idx + (s.phase === 'break' ? 1 : 0)) / total) * 100) : 0,
    archive: s.archive,
    topics: topTopics(6),
    settings: s.settings || '',
    meta: s.meta || {},
    /* 目录：给页面显示「还剩几章、这章叫什么」，只带标题和状态，不带正文 */
    chapters: chapters.map((c, i) => ({
      title: c.title,
      /* 读到最后一章 / 作品讨论时，别把整本都划掉，留最后一章当「正在看」 */
      done: i < s.idx && s.phase !== 'afterword',
      current: i === s.idx || (s.phase === 'afterword' && i === total - 1),
      chars: (c.text || '').length,
    })),
    next: { inSec: s.phase === 'break' ? leftSec : 0 },
    finished: s.phase === 'done',
    /* 定时开讲：给页面显示「几点开讲 / 还有多久」；没设置就默认 17:00 */
    startAt: effectiveStartAt(cfg),
    startAtCustom: Boolean(String(cfg?.novel?.startAt || '').trim()),
    autoStart: cfg?.novel?.autoStart !== false,
    nextStartAt: nextStartMs(cfg),
  };
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s2 = sec % 60;
  return `${m}:${String(s2).padStart(2, '0')}`;
}

/* ---------------- 给模型的话术 ---------------- */

/**
 * 休息/讨论阶段的系统提示：聊剧情、不剧透、收选题。
 * 只给「已经念过的部分」的摘要，未来章节一个字都不给，避免剧透。
 */
export function buildBreakMessages(cfg, { username, text, gift, chapterTitle, summary, pastSummaries, topics }) {
  const sys = [
    '你是直播间的 AI 主播「大肥鱼」，一只蓝发鲸鱼女仆。现在是小说朗读的休息时间。',
    '观众刚听完一章，你在和弹幕聊天。',
    '规矩：',
    '1. 只聊已经念过的内容，绝对不能透露后面会发生什么，也不要猜得太具体（可以聊感受、人物、伏笔）。',
    '2. 可以问观众「你觉得他为什么会那样做」「接下来你希望看到谁出场」这类开放问题，把气氛带起来。',
    '3. 一次只说 1～3 句、60 字以内，像真人说话，不要念稿子。',
    '4. 只输出要念出来的中文，不要出现括号动作、markdown、表情符号、token 之类的字眼。',
    '5. 有人送礼物就道谢；有人报歌名就记下来。',
    chapterTitle ? `刚才念的是：${chapterTitle}` : '',
    summary ? `这一章讲了：${summary}` : '',
    pastSummaries?.length ? `前面几章：${pastSummaries.slice(-4).join('；')}` : '',
    topics?.length ? `观众提过的选题：${topics.map((t) => t.text).join('、')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const user = gift
    ? `${username} 送了礼物「${gift}」。用一句话道谢，再顺势聊两句剧情。`
    : `${username} 说：${text || '（没说话）'}`;

  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

/** 念完一整本之后的作品档案（设定 / 角色 / 优点 / 短板） */
export function buildArchiveMessages(novelInfo) {
  const sys = [
    '你在帮直播间整理一本刚读完的小说的「作品档案」，用于直播里和观众讨论。',
    '只输出 JSON，不要任何解释，格式：',
    '{"world":"一句话世界观","characters":[{"name":"","role":"","note":""}],"themes":["主题1"],"highlights":["写得好的地方1"],"flaws":["不足1"],"questions":["可以问观众的问题1"]}',
    'characters 最多 6 个，themes/highlights/flaws/questions 各 2～4 条，每条 30 字以内，中文。',
    '不要编造原文没有的人物或情节。',
  ].join('\n');
  const user = [
    `小说标题：${novelInfo.title}`,
    novelInfo.settings ? `开头设定：${novelInfo.settings.slice(0, 1200)}` : '',
    metaBrief(novelInfo.meta, 3000),
    `各章小结：${(novelInfo.summaries || []).filter(Boolean).join('；').slice(0, 1600)}`,
    '请输出这份档案的 JSON。',
  ]
    .filter(Boolean)
    .join('\n');
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

/** 解析模型给的档案 JSON（容错：截取第一个 { 到最后一个 }） */
export function parseArchive(raw) {
  const t = String(raw || '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const o = JSON.parse(t.slice(a, b + 1));
    return {
      world: String(o.world || '').slice(0, 120),
      characters: Array.isArray(o.characters)
        ? o.characters.slice(0, 6).map((c) => ({
            name: String(c.name || '').slice(0, 20),
            role: String(c.role || '').slice(0, 20),
            note: String(c.note || '').slice(0, 60),
          }))
        : [],
      themes: arr(o.themes),
      highlights: arr(o.highlights),
      flaws: arr(o.flaws),
      questions: arr(o.questions),
    };
  } catch {
    return null;
  }
}

function arr(v) {
  return Array.isArray(v) ? v.slice(0, 4).map((x) => String(x).slice(0, 60)) : [];
}

/** 把同目录的设定/角色/大纲拼成一段参考文本（给档案生成用） */
function metaBrief(meta, budget = 3000) {
  if (!meta) return '';
  const order = ['作品信息', '设定', '角色', '人物', '章节规划', '大纲'];
  const parts = [];
  let left = budget;
  for (const k of order) {
    const v = meta[k];
    if (!v || left <= 0) continue;
    const piece = v.slice(0, Math.min(left, 1400));
    parts.push(`【${k}】\n${piece}`);
    left -= piece.length;
  }
  return parts.join('\n');
}

/** 没有 Key 时的备选：直接从正文里凑档案 */
export function fallbackArchive(novelInfo, chapterList) {
  const names = new Map();
  for (const ch of chapterList || []) {
    for (const m of String(ch.text).matchAll(/[\u4e00-\u9fa5]{2,4}(?=说|问|笑|喊|点头|抬头|转身)/g)) {
      names.set(m[0], (names.get(m[0]) || 0) + 1);
    }
  }
  const top = [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
  const meta = novelInfo.meta || {};
  const metaChars = [];
  const roleText = meta['角色'] || meta['人物'] || '';
  // 先切成句子片段：元数据文件可能没有换行，直接按行匹配会切出半句话
  const fragments = roleText
    .split(/[\n\r。；;！!？?]+/)
    .map((s) => s.replace(/^[*#>\-\s]+/, '').trim())
    .filter(Boolean);
  for (const frag of fragments) {
    const m = frag.match(/^([\u4e00-\u9fa5A-Za-z·]{2,6})\s*[：:]\s*(.{0,60})$/);
    if (!m) continue;
    const name = m[1].trim();
    if (!name || /[的了是在和与也都就]/.test(name)) continue;
    if (metaChars.some((c) => c.name === name)) continue;
    metaChars.push({ name, role: '', note: m[2].trim().slice(0, 40) });
  }
  const characters = (metaChars.length ? metaChars : top.map((n) => ({ name: n, role: '', note: '' }))).slice(0, 6);
  return {
    world:
      (meta['作品信息'] || meta['设定'] || novelInfo.settings || '')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)[0]
        ?.replace(/^#+\s*/, '')
        .slice(0, 80) || '',
    characters,
    themes: [],
    highlights: (novelInfo.summaries || []).filter(Boolean).slice(0, 3),
    flaws: [],
    questions: ['你最喜欢哪一章？', '你觉得哪个人物最可惜？'],
  };
}
