/**
 * DeepSeek 流式对话 + 工具调用（OpenAI 兼容的 SSE）。
 * 用法：await streamChat({ ..., onText, onToolStart, runTool })
 *   onText(delta)      模型吐出的正文增量
 *   onToolStart(name)  模型决定调用工具的那一刻（用来立刻播「我帮你查一查」）
 *   runTool(call)      执行工具，返回给模型的字符串
 * 关掉思考模式：直播回话要快，deepseek-flash 默认会先思考。
 */
const RETRY = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openStream({ baseUrl, apiKey, body, signal }) {
  const url = `${String(baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')}/chat/completions`;
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(800 * 2 ** attempt);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      last = new Error(`DeepSeek 连不上：${err.message}`);
      continue;
    }
    if (res.ok) return res;
    const raw = await res.text().catch(() => '');
    last = new Error(`DeepSeek ${res.status}: ${raw.slice(0, 200)}`);
    last.status = res.status;
    if (!RETRY.has(res.status)) break;
  }
  throw last;
}

/** 读一轮 SSE：累计正文和工具调用 */
async function readRound(res, { onText, onToolStart }) {
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let usage = null;
  let finish = '';
  const calls = [];
  let toolAnnounced = false;
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let j;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.usage) usage = j.usage;
      const ch = j.choices?.[0];
      if (!ch) continue;
      if (ch.finish_reason) finish = ch.finish_reason;
      const d = ch.delta || {};
      if (d.content) {
        text += d.content;
        onText?.(d.content);
      }
      for (const tc of d.tool_calls || []) {
        const i = tc.index ?? 0;
        calls[i] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) calls[i].id = tc.id;
        if (tc.function?.name) calls[i].function.name += tc.function.name;
        if (tc.function?.arguments) calls[i].function.arguments += tc.function.arguments;
        if (!toolAnnounced && calls[i].function.name) {
          toolAnnounced = true;
          onToolStart?.(calls[i].function.name, text);
        }
      }
    }
  }
  return { text, usage, finish, calls: calls.filter(Boolean) };
}

function addUsage(a, b) {
  if (!b) return a;
  if (!a) return { ...b };
  const out = { ...a };
  for (const k of ['prompt_tokens', 'completion_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens', 'total_tokens']) {
    out[k] = Number(a[k] || 0) + Number(b[k] || 0);
  }
  return out;
}

/**
 * 跑完一次回话（可能含 1–2 轮工具调用）。返回 { text, usage, toolRounds }。
 * signal 用于静音时中止。
 */
export async function streamChat({
  baseUrl, apiKey, model, messages, tools, temperature = 1, maxTokens = 400,
  onText, onToolStart, runTool, signal, maxToolRounds = 2,
}) {
  if (!apiKey) throw new Error('还没填 DeepSeek API Key');
  const convo = [...messages];
  let usage = null;
  let all = '';
  for (let round = 0; round <= maxToolRounds; round++) {
    const useTools = tools?.length && round < maxToolRounds;
    const body = {
      model,
      messages: convo,
      temperature,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      thinking: { type: 'disabled' },
      ...(useTools ? { tools } : {}),
    };
    const res = await openStream({ baseUrl, apiKey, body, signal });
    const r = await readRound(res, { onText, onToolStart });
    usage = addUsage(usage, r.usage);
    all += r.text;
    if (!r.calls.length || !runTool) return { text: all, usage, toolRounds: round };
    convo.push({ role: 'assistant', content: r.text || '', tool_calls: r.calls });
    for (const call of r.calls) {
      let result;
      try {
        result = await runTool(call);
      } catch (err) {
        result = JSON.stringify({ error: String(err.message || err).slice(0, 200) });
      }
      convo.push({ role: 'tool', tool_call_id: call.id, content: String(result).slice(0, 6000) });
    }
  }
  return { text: all, usage, toolRounds: maxToolRounds };
}
