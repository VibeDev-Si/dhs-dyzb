/**
 * DeepSeek 联网搜索（POST https://api.deepseek.com/v1/tools/search，按成功次数计费）。
 * 同一个问题 10 分钟内复用结果；每小时次数有上限，超了就让模型凭常识回答。
 */
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // query -> { at, results }
const hits = []; // 每次真正发出的搜索时间
let today = { day: '', count: 0 };

function dayKey() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); // 北京时间
}

export function searchStats(perHour) {
  if (today.day !== dayKey()) today = { day: dayKey(), count: 0 };
  const hourAgo = Date.now() - 3600_000;
  while (hits.length && hits[0] < hourAgo) hits.shift();
  return { today: today.count, lastHour: hits.length, perHour };
}

/** 给模型看的工具定义 */
export const SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      '联网搜索最新信息。只在观众问到你不确定、需要查证或有时效性的事实时用：天气、节日、演出和上映时间、' +
      '歌曲和电影的背景、冷知识、生活常识、游戏攻略等。闲聊、安慰、聊感受不要搜。时政、新闻争议、医疗诊断、投资建议不要搜。',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '搜索关键词，简短，中文' } },
      required: ['query'],
    },
  },
};

export async function webSearch({ apiKey, baseUrl, query, question, perHour = 30 }) {
  const q = String(query || '').trim().slice(0, 120);
  if (!q) return { ok: false, error: '没有搜索词' };
  const c = cache.get(q);
  if (c && Date.now() - c.at < CACHE_MS) return { ok: true, cached: true, results: c.results };
  const st = searchStats(perHour);
  if (st.lastHour >= perHour) return { ok: false, error: '这个小时的搜索次数用完了' };

  const url = `${String(baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')}/v1/tools/search`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query: q, count: 5, ...(question ? { ori_question: String(question).slice(0, 120) } : {}) }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new Error(`搜索 ${res.status}: ${raw.slice(0, 160)}`);
  }
  const data = await res.json();
  hits.push(Date.now());
  today.count += 1;
  const results = (data.results || []).slice(0, 5).map((r) => ({
    title: r.title,
    site: r.site_name || '',
    date: r.date ? String(r.date).slice(0, 10) : '',
    summary: String(r.summary || r.snippet || '').slice(0, 400),
  }));
  cache.set(q, { at: Date.now(), results });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return { ok: true, results };
}
