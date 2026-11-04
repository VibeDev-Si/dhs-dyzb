/**
 * 访问海外接口（Fish Audio）用的代理。Node 不会自动走 Windows「系统代理」，所以这里自己找：
 *   mode = system  按顺序看环境变量 HTTPS_PROXY / HTTP_PROXY / ALL_PROXY，再看 Windows 系统代理；都没有就直连
 *   mode = custom  用操作台里填的地址：http:// https:// socks5:// socks5h:// socks4://，可带 用户名:密码@
 *   mode = none    直连（国内能直接访问时用）
 */
import { execFileSync } from 'node:child_process';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

const SCHEMES = new Set(['http:', 'https:', 'socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:']);
export const PROXY_MODES = ['system', 'custom', 'none'];

/** 校验并规范化代理地址；只写 127.0.0.1:7890 时按 http 处理。返回 { url } 或 { error } */
export function parseProxy(raw) {
  let s = String(raw || '').trim();
  if (!s) return { error: '代理地址是空的' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return { error: '代理地址格式不对，例：socks5://127.0.0.1:1080 或 http://127.0.0.1:7890' };
  }
  if (!SCHEMES.has(u.protocol)) return { error: `不支持 ${u.protocol.replace(':', '')} 代理，只支持 http / https / socks5 / socks5h / socks4` };
  if (!u.hostname) return { error: '代理地址缺少主机名' };
  if (!u.port) return { error: '代理地址缺少端口号' };
  // socks5:// 这类非特殊协议解析出来 pathname 是空串，http:// 是 "/"，两种都算"没带路径"
  if ((u.pathname && u.pathname !== '/') || u.search || u.hash) return { error: '代理地址只写 协议://主机:端口，不要带路径' };
  return { url: `${u.protocol}//${u.username ? `${u.username}${u.password ? `:${u.password}` : ''}@` : ''}${u.host}` };
}

/** 显示/日志用：把密码换成 *** */
export function maskProxy(url) {
  return String(url || '').replace(/\/\/([^:@/]+):([^@/]*)@/, '//$1:***@');
}

/** Windows 系统代理（「设置 → 网络 → 代理」或代理软件写进去的） */
function fromRegistry() {
  if (process.platform !== 'win32') return '';
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const out = execFileSync('reg', ['query', key], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/.test(out)) return '';
    const server = /ProxyServer\s+REG_SZ\s+(\S+)/.exec(out)?.[1] || '';
    if (!server) return '';
    // 可能是 "127.0.0.1:10820"，也可能是 "http=1.2.3.4:80;https=1.2.3.4:443;socks=1.2.3.4:1080"
    const parts = Object.fromEntries(server.split(';').map((p) => (p.includes('=') ? p.split('=') : ['all', p])));
    if (parts.https || parts.http || parts.all) return `http://${(parts.https || parts.http || parts.all).replace(/^https?:\/\//, '')}`;
    if (parts.socks) return `socks5://${parts.socks}`;
    return '';
  } catch {
    return '';
  }
}

let sysCache = { at: 0, url: '', source: '' };
/** 系统代理：环境变量优先，其次 Windows 设置；缓存 60 秒，代理软件开关后不用重启服务 */
function systemProxy() {
  if (Date.now() - sysCache.at < 60_000) return sysCache;
  const env = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']
    .map((k) => [k, process.env[k]])
    .find(([, v]) => v && !parseProxy(v).error);
  const url = env ? parseProxy(env[1]).url : fromRegistry();
  sysCache = { at: Date.now(), url, source: env ? `环境变量 ${env[0]}` : url ? 'Windows 系统代理' : '' };
  return sysCache;
}

/** 按设置算出实际要用的代理：{ mode, url, source, error } ；url 为空表示直连 */
export function resolveProxy({ mode = 'system', url = '' } = {}) {
  const m = PROXY_MODES.includes(mode) ? mode : 'system';
  if (m === 'none') return { mode: m, url: '', source: '直连' };
  if (m === 'custom') {
    const p = parseProxy(url);
    return p.error ? { mode: m, url: '', source: '直连', error: p.error } : { mode: m, url: p.url, source: '自定义代理' };
  }
  const s = systemProxy();
  return { mode: m, url: s.url, source: s.url ? s.source : '直连（没找到系统代理）' };
}

const agents = new Map(); // 同一个代理地址复用一个 agent（连接池）
const logged = new Set();
/** 给 ws / https 用的 agent；直连返回 undefined */
export function proxyAgent(setting) {
  const r = resolveProxy(setting);
  if (!r.url) return undefined;
  if (!agents.has(r.url)) {
    agents.set(r.url, /^socks/i.test(r.url) ? new SocksProxyAgent(r.url) : new HttpsProxyAgent(r.url));
    if (agents.size > 8) agents.delete(agents.keys().next().value);
  }
  if (!logged.has(r.url)) {
    logged.add(r.url);
    console.log(`[proxy] Fish Audio 走代理：${maskProxy(r.url)}（${r.source}）`);
  }
  return agents.get(r.url);
}

/** 网络类错误给一句能照着做的提示 */
export function netHint(err) {
  const code = err?.code || err?.cause?.code || '';
  const msg = String(err?.message || '');
  if (/ETIMEDOUT|ECONNRESET|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|socket hang up|timed out|超时/i.test(`${code} ${msg}`)) {
    return '连不上 Fish Audio，多半是网络到不了海外：在操作台「声音」里给 Fish 设置代理（http 或 socks5），再点「测试连接」。';
  }
  if (/ECONNREFUSED/.test(`${code} ${msg}`)) return '代理拒绝连接：检查代理软件是否开着、地址和端口对不对。';
  if (/407|auth/i.test(msg)) return '代理要求登录：在地址里写上 用户名:密码@。';
  return '';
}
