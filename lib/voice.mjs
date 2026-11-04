// 大肥鱼的声音：把一段中文台词合成成音频，缓存起来给页面 <audio> 播
// 两条路线：
//   sapi = Windows 自带 System.Speech（离线、免 Key，Huihui 备用）
//   edge = edge-tts 在线音色（微软神经网络音色，能调音高/语速，御姐音就靠它）
//   minimax = MiniMax Speech 2.8 HD 在线音色（需要 MINIMAX_API_KEY）
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const VOICE_DIR = join(ROOT, 'data', 'voice');

/** 御姐音预设：同一个神经网络音色，压低音高、放慢一点，就是「成熟、稳」的质感 */
export const EDGE_PRESETS = {
  natural: {
    label: '自然 · 晓晓',
    voice: 'zh-CN-XiaoxiaoNeural',
    pitch: '-4Hz',
    rate: '-4%',
    note: '不做重手处理，最自然的一种；先听这个',
  },
  warm: {
    label: '温柔 · 晓晓',
    voice: 'zh-CN-XiaoxiaoNeural',
    pitch: '-10Hz',
    rate: '-8%',
    note: '音高略低、语速略慢，适合睡前和温柔段落',
  },
  leng: {
    label: '御姐 · 冷',
    voice: 'zh-CN-XiaoxiaoNeural',
    pitch: '-24Hz',
    rate: '-8%',
    note: '压低 24Hz，最像「淡淡开口」的御姐',
  },
  diyin: {
    label: '御姐 · 低',
    voice: 'zh-CN-XiaoyiNeural',
    pitch: '-18Hz',
    rate: '-6%',
    note: '换晓伊再压低，颗粒感更强',
  },
  xiaoxiao: {
    label: '原味 · 晓晓',
    voice: 'zh-CN-XiaoxiaoNeural',
    pitch: '+0Hz',
    rate: '+0%',
    note: '不做任何处理，用来对比',
  },
};

/** 本地神经网络音色（Kokoro-82M · ONNX · CPU）：不联网、不走机械音，四个中文女声 */
export const KOKORO_PRESETS = {
  xiaobei: { label: '本地 · 小北', voice: 'zf_xiaobei', speed: 0.95, note: 'Kokoro 本地合成，清亮' },
  xiaoni: { label: '本地 · 小妮', voice: 'zf_xiaoni', speed: 0.95, note: 'Kokoro 本地合成，偏软' },
  xiaoxiao: { label: '本地 · 晓晓', voice: 'zf_xiaoxiao', speed: 0.95, note: 'Kokoro 本地合成，偏稳' },
  xiaoyi: { label: '本地 · 晓伊', voice: 'zf_xiaoyi', speed: 0.95, note: 'Kokoro 本地合成，偏甜' },
};

/** MiniMax Speech 2.8 HD 系统音色，音色 ID 来自官方系统音色列表 */
export const MINIMAX_PRESETS = {
  cuteGirl: {
    label: 'MiniMax · 软萌少女',
    voiceId: 'cute_girl',
    voice: 'cute_girl',
    model: 'speech-2.8-hd',
    speed: 1,
    pitch: 1,
    emotion: 'happy',
    sampleRate: 32000,
    bitrate: 128000,
    format: 'mp3',
    note: '软萌、轻快的少女音；需要 MINIMAX_API_KEY',
  },
  lyrical: {
    label: 'MiniMax · 中文抒情旁白',
    voiceId: 'Chinese (Mandarin)_Lyrical_Voice',
    // voice 保留为前端展示和旧配置兼容别名；请求使用 voiceId。
    voice: 'Chinese (Mandarin)_Lyrical_Voice',
    model: 'speech-2.8-hd',
    speed: 1,
    pitch: 0,
    emotion: 'calm',
    sampleRate: 32000,
    bitrate: 128000,
    format: 'mp3',
    note: '适合故事朗读，语气舒展；需要 MINIMAX_API_KEY',
  },
};

const MINIMAX_DEFAULT_BASE_URL = 'https://api.minimaxi.com/v1/t2a_v2';


/** edge-tts 走的是 Python 包，找一个能用的解释器 */
const PY_CANDIDATES = [
  process.env.VOICE_PYTHON,
  'C:\\Anaconda3\\python.exe',
  'python',
  'python3',
].filter(Boolean);

let pyPath = null;
function pythonCmd() {
  if (pyPath) return pyPath;
  for (const p of PY_CANDIDATES) {
    try {
      if (p.includes('\\') && !existsSync(p)) continue;
      pyPath = p;
      return p;
    } catch {
      /* 换下一个 */
    }
  }
  pyPath = 'python';
  return pyPath;
}

/** SAPI 语速是 -10..10，配置里用 0.6–1.6 的倍率，这里换算 */
function sapiRate(mult) {
  const m = Number(mult) || 1;
  return Math.max(-10, Math.min(10, Math.round((m - 1) * 10)));
}

/** 念之前把不该念出来的东西去掉：舞台提示、markdown、表情、多余空白 */
export function speechText(raw, maxChars = 3000) {
  let t = String(raw || '');
  // 字面量转义（\n、\t、\" 之类）先还原，否则 TTS 会念成「反斜杠 n」
  t = t
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
  t = t.replace(/\\(?=[^\n])/g, '');
  t = t.replace(/（[^）]{0,40}）/g, ''); // （她翻了一页）这种提示不念
  t = t.replace(/\([^)]{0,40}\)/g, '');
  t = t.replace(/[*_`#>]/g, '');
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t.slice(0, Math.max(50, Number(maxChars) || 3000));
}

function prune() {
  try {
    const files = readdirSync(VOICE_DIR)
      .filter((f) => f.endsWith('.wav') || f.endsWith('.mp3'))
      .map((f) => ({ f, m: statSync(join(VOICE_DIR, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const { f } of files.slice(300)) unlinkSync(join(VOICE_DIR, f));
  } catch {
    /* 清缓存失败不影响合成 */
  }
}

function runPs(script, env, timeoutMs = 25000) {
  return new Promise((ok, fail) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let err = '';
    ps.stderr.on('data', (d) => (err += d.toString('utf8')));
    const timer = setTimeout(() => {
      ps.kill();
      fail(new Error('语音合成超时'));
    }, timeoutMs);
    ps.on('error', (e) => {
      clearTimeout(timer);
      fail(e);
    });
    ps.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) ok();
      else fail(new Error(`语音合成失败（${code}）${err.slice(0, 200)}`));
    });
  });
}

const PS = `
Add-Type -AssemblyName System.Speech | Out-Null
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TTS_TEXT))
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { if ($env:TTS_VOICE) { $s.SelectVoice($env:TTS_VOICE) } } catch {}
try { $s.Rate = [int]$env:TTS_RATE } catch {}
$s.SetOutputToWaveFile($env:TTS_OUT)
$s.Speak($text)
$s.Dispose()
`;

/** 合成一段话，返回 { url, file, cached, ms, engine } */
export async function synthesize(text, opts = {}) {
  const say = speechText(text, opts.maxChars);
  if (!say) throw new Error('没有可念的内容');
  mkdirSync(VOICE_DIR, { recursive: true });
  const engine = ['edge', 'kokoro', 'minimax'].includes(opts.engine) ? opts.engine : 'sapi';
  if (engine === 'edge') return synthesizeEdge(say, opts);
  if (engine === 'kokoro') return synthesizeKokoro(say, opts);
  if (engine === 'minimax') return synthesizeMinimax(say, opts);
  return synthesizeSapi(say, opts);
}

/** 本地神经网络音色：Kokoro-82M（ONNX，CPU），四个中文女声，不联网 */
async function synthesizeKokoro(say, opts) {
  const preset = KOKORO_PRESETS[opts.preset] || KOKORO_PRESETS.xiaobei;
  const voice = opts.kokoroVoice || preset.voice;
  const speed = Number(opts.speed || preset.speed || 0.95);
  const hash = createHash('sha1').update(`kokoro|${voice}|${speed}|${say}`).digest('hex').slice(0, 20);
  const file = join(VOICE_DIR, `${hash}.wav`);
  if (existsSync(file) && statSync(file).size > 4096) {
    return { url: `/api/voice/${hash}.wav`, file, cached: true, ms: 0, text: say, engine: 'kokoro', preset: opts.preset || 'xiaobei' };
  }
  const script = join(ROOT, 'tts-kokoro', 'say.py');
  if (!existsSync(script)) throw new Error('没找到 tts-kokoro/say.py，本地音色要先装好');
  const txt = join(VOICE_DIR, `${hash}.txt`);
  writeFileSync(txt, say, 'utf8');
  const started = Date.now();
  try {
    await runPy([script, txt, file, voice, String(speed)], 600000);
  } finally {
    try {
      unlinkSync(txt);
    } catch {
      /* 临时文本删不掉无所谓 */
    }
  }
  if (!existsSync(file) || statSync(file).size < 4096) throw new Error('本地合成失败（没生成音频）');
  prune();
  return {
    url: `/api/voice/${hash}.wav`,
    file,
    cached: false,
    ms: Date.now() - started,
    text: say,
    engine: 'kokoro',
    preset: opts.preset || 'xiaobei',
    voice,
    speed,
  };
}

function sapiVoiceOf(opts) {
  const rate = sapiRate(opts.rate ?? 1);
  const voice = String(opts.voice || 'Microsoft Huihui Desktop');
  return { rate, voice };
}

async function synthesizeSapi(say, opts) {
  const { rate, voice } = sapiVoiceOf(opts);
  const hash = createHash('sha1').update(`sapi|${voice}|${rate}|${say}`).digest('hex').slice(0, 20);
  const file = join(VOICE_DIR, `${hash}.wav`);
  if (existsSync(file) && statSync(file).size > 1024) {
    return { url: `/api/voice/${hash}.wav`, file, cached: true, ms: 0, text: say, engine: 'sapi' };
  }
  const started = Date.now();
  await runPs(PS, {
    TTS_TEXT: Buffer.from(say, 'utf8').toString('base64'),
    TTS_OUT: file,
    TTS_RATE: String(rate),
    TTS_VOICE: voice,
  });
  if (!existsSync(file) || statSync(file).size < 1024) throw new Error('合成出来是空文件');
  prune();
  return { url: `/api/voice/${hash}.wav`, file, cached: false, ms: Date.now() - started, text: say, engine: 'sapi' };
}

/** 在线御姐音：edge-tts 支持 pitch/rate 微调，直接出 mp3 */
async function synthesizeEdge(say, opts) {
  const preset = EDGE_PRESETS[opts.preset] || EDGE_PRESETS.leng;
  const edge = {
    voice: opts.edgeVoice || preset.voice,
    pitch: opts.pitch || preset.pitch,
    rate: opts.pitch ? opts.edgeRate || preset.rate : preset.rate,
  };
  const hash = createHash('sha1')
    .update(`edge|${edge.voice}|${edge.pitch}|${edge.rate}|${say}`)
    .digest('hex')
    .slice(0, 20);
  const file = join(VOICE_DIR, `${hash}.mp3`);
  if (existsSync(file) && statSync(file).size > 2048) {
    return { url: `/api/voice/${hash}.mp3`, file, cached: true, ms: 0, text: say, engine: 'edge', preset: opts.preset || 'leng' };
  }
  const txt = join(VOICE_DIR, `${hash}.txt`);
  writeFileSync(txt, say, 'utf8');
  const started = Date.now();
  await runPy(
    [
      '-m',
      'edge_tts',
      '--voice',
      edge.voice,
      `--pitch=${edge.pitch}`,
      `--rate=${edge.rate}`,
      '--file',
      txt,
      '--write-media',
      file,
    ],
    // 一整章几千字要慢慢合成，按字数给足时间
    Math.max(60000, say.length * 120),
  );
  try {
    unlinkSync(txt);
  } catch {
    /* 文本临时文件删不掉也没关系 */
  }
  if (!existsSync(file) || statSync(file).size < 2048) throw new Error('在线合成失败（音源返回空文件）');
  prune();
  return {
    url: `/api/voice/${hash}.mp3`,
    file,
    cached: false,
    ms: Date.now() - started,
    text: say,
    engine: 'edge',
    preset: opts.preset || 'leng',
    voice: edge.voice,
    pitch: edge.pitch,
    rate: edge.rate,
  };
}

/** MiniMax Speech 2.8 HD：中文系统音色，返回 MP3 并写入本地缓存 */
async function synthesizeMinimax(say, opts) {
  const preset = MINIMAX_PRESETS[opts.preset] || MINIMAX_PRESETS.lyrical;
  const model = String(opts.minimaxModel || preset.model || 'speech-2.8-hd');
  const voice = String(opts.minimaxVoice || preset.voiceId || preset.voice);
  const speed = clampNumber(opts.speed ?? opts.rate ?? preset.speed ?? 1, 0.5, 2, 1);
  const pitch = clampNumber(opts.minimaxPitch ?? preset.pitch ?? 0, -12, 12, 0);
  const emotion = String(opts.minimaxEmotion || preset.emotion || 'calm');
  const sampleRateValue = opts.minimaxSampleRate ?? preset.sampleRate ?? 32000;
  const sampleRate = [8000, 16000, 22050, 24000, 32000, 44100].includes(Number(sampleRateValue))
    ? Number(sampleRateValue)
    : 32000;
  const bitrateValue = opts.minimaxBitrate ?? preset.bitrate ?? 128000;
  const bitrate = [32000, 64000, 128000, 256000].includes(Number(bitrateValue))
    ? Number(bitrateValue)
    : 128000;
  const format = String(opts.minimaxFormat || preset.format || 'mp3').toLowerCase() === 'wav' ? 'wav' : 'mp3';
  const hash = createHash('sha1')
    .update(`minimax|${model}|${voice}|${speed}|${pitch}|${emotion}|${sampleRate}|${bitrate}|${format}|${say}`)
    .digest('hex')
    .slice(0, 20);
  const file = join(VOICE_DIR, `${hash}.${format}`);
  const minSize = format === 'wav' ? 4096 : 2048;
  if (existsSync(file) && statSync(file).size > minSize) {
    return {
      url: `/api/voice/${hash}.${format}`,
      file,
      cached: true,
      ms: 0,
      text: say,
      engine: 'minimax',
      preset: opts.preset || 'lyrical',
      model,
      voice,
      emotion,
      speed,
      pitch,
    };
  }

  // 环境变量优先；配置文件字段只作为兼容性兜底，且不会通过 publicConfig 下发。
  const apiKey = String(process.env.MINIMAX_API_KEY || opts.minimaxApiKey || '').trim();
  if (!apiKey) throw new Error('未配置 MINIMAX_API_KEY');
  const baseUrl = String(opts.minimaxBaseUrl || process.env.MINIMAX_BASE_URL || MINIMAX_DEFAULT_BASE_URL).trim();
  const started = Date.now();
  let response;
  try {
    response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        text: say,
        stream: false,
        voice_setting: { voice_id: voice, speed, vol: 1, pitch, emotion },
        audio_setting: { sample_rate: sampleRate, bitrate, format, channel: 1 },
      }),
      signal: AbortSignal.timeout(Math.max(60000, say.length * 120)),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new Error('MiniMax 语音合成超时');
    throw new Error(`MiniMax 请求失败：${err.message}`);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`MiniMax 返回了无法解析的响应（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    const code = payload?.base_resp?.status_code ?? payload?.status_code ?? response.status;
    const message = payload?.base_resp?.status_msg || payload?.message || '请求失败';
    throw new Error(`MiniMax 请求失败（${code}）：${String(message).slice(0, 180)}`);
  }
  const statusCode = payload?.base_resp?.status_code ?? payload?.status_code ?? 0;
  if (Number(statusCode) !== 0) {
    throw new Error(`MiniMax 合成失败（${statusCode}）：${String(payload?.base_resp?.status_msg || payload?.message || '未知错误').slice(0, 180)}`);
  }
  const audio = payload?.data?.audio || payload?.audio;
  if (typeof audio !== 'string' || !audio.trim()) throw new Error('MiniMax 返回了空音频');
  let audioBuffer;
  try {
    audioBuffer = /^[0-9a-f]+$/i.test(audio) ? Buffer.from(audio, 'hex') : Buffer.from(audio, 'base64');
  } catch {
    throw new Error('MiniMax 音频数据格式无效');
  }
  if (!audioBuffer.length) throw new Error('MiniMax 返回了空音频');
  writeFileSync(file, audioBuffer);
  if (!existsSync(file) || statSync(file).size <= minSize) throw new Error('MiniMax 返回的音频文件过小');
  prune();
  return {
    url: `/api/voice/${hash}.${format}`,
    file,
    cached: false,
    ms: Date.now() - started,
    text: say,
    engine: 'minimax',
    preset: opts.preset || 'lyrical',
    model,
    voice,
    emotion,
    speed,
    pitch,
  };
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function runPy(args, timeoutMs = 45000) {
  return new Promise((ok, fail) => {
    const py = spawn(pythonCmd(), args, { windowsHide: true });
    let err = '';
    py.stderr.on('data', (d) => (err += d.toString('utf8')));
    const timer = setTimeout(() => {
      py.kill();
      fail(new Error('在线语音合成超时'));
    }, timeoutMs);
    py.on('error', (e) => {
      clearTimeout(timer);
      fail(new Error(`找不到 Python（${e.message}），御姐音需要 python -m edge_tts`));
    });
    py.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) ok();
      else fail(new Error(`在线语音合成失败（${code}）${err.slice(0, 200)}`));
    });
  });
}

export function voiceDir() {
  return VOICE_DIR;
}

export function voiceWavPath(name) {
  return voiceMediaPath(name);
}

/** 允许 wav 和 mp3（御姐音走在线 mp3） */
export function voiceMediaPath(name) {
  const raw = String(name || '').trim();
  if (!/^[a-f0-9]{20}\.(wav|mp3)$/i.test(raw)) return null;
  const file = join(VOICE_DIR, raw);
  return existsSync(file) ? file : null;
}

/** 有哪些中文声音可用（给操作台提示） */
export async function listVoices() {
  const script = `Add-Type -AssemblyName System.Speech | Out-Null
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Culture.Name + "|" + $_.VoiceInfo.Name }
$s.Dispose()`;
  let out = '';
  await new Promise((ok) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    ps.stdout.on('data', (d) => (out += d.toString('utf8')));
    ps.on('close', ok);
    ps.on('error', ok);
  });
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [culture, name] = l.split('|');
      return { culture, name };
    });
}
