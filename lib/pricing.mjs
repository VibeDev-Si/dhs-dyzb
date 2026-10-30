/**
 * DeepSeek 官方价格 + 高峰时段判断。
 * 高峰：北京时间 周一至周五 9:00-12:00、14:00-18:00（法定节假日降为平价，这里不内置节假日表，
 * 需要精确时可在 config.json 里改 pricing 单价，或把某天当作平价）。
 */

const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

export function beijing(date = new Date()) {
  const t = new Date(date.getTime() + BEIJING_OFFSET_MS);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    hh: t.getUTCHours(),
    mm: t.getUTCMinutes(),
    dow: t.getUTCDay(), // 0=周日
    dateKey: `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`,
    hhmm: `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`,
  };
}

export function isPeak(date = new Date()) {
  const { dow, hh } = beijing(date);
  if (dow === 0 || dow === 6) return false;
  return (hh >= 9 && hh < 12) || (hh >= 14 && hh < 18);
}

export function ratesFor(pricing, model, date = new Date()) {
  const table = pricing?.[model] || pricing?.['deepseek-flash'] || {};
  return isPeak(date) ? table.peak : table.idle;
}

/** usage: DeepSeek 返回的 usage 对象（含 prompt_cache_hit_tokens 等） */
export function costOf(usage, rates) {
  if (!usage || !rates) return 0;
  const hit = Number(usage.prompt_cache_hit_tokens ?? 0);
  const miss = Number(usage.prompt_cache_miss_tokens ?? Math.max(0, (usage.prompt_tokens ?? 0) - hit));
  const out = Number(usage.completion_tokens ?? 0);
  const cny =
    (hit / 1e6) * rates.hit + (miss / 1e6) * rates.miss + (out / 1e6) * rates.out;
  return Number(cny.toFixed(6));
}
