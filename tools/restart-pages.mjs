/**
 * 改完代码之后，把「直播窗 + 操作台」都重启到最新版本。
 *
 *   node tools/restart-pages.mjs            只刷新两个页面
 *   node tools/restart-pages.mjs --server   先重启 node server.mjs，再刷新页面
 *   node tools/restart-pages.mjs --fresh    直播窗按「刚开播」处理（清空队列/弹幕）
 *
 * 直播窗默认带 keep=1，刷新时不清空点歌队列和弹幕；想清场就加 --fresh。
 * 直播窗 CDP 端口 9222、操作台 9223（脚本自己会带 --remote-debugging-port 起窗口）。
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const ROOT = process.cwd();
const CHROME =
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].find((p) => existsSync(p)) || 'chrome.exe';

const LIVE = 'http://127.0.0.1:8787/?auto=1';
const ADMIN = 'http://127.0.0.1:8787/admin';
const args = new Set(process.argv.slice(2));
const fresh = args.has('--fresh');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets(port) {
  try {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
    return list.filter((t) => t.type === 'page');
  } catch {
    return null;
  }
}

async function cdp(port, wsUrl, method, params = {}) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const id = 1;
  const out = await new Promise((resolve) => {
    const onMsg = (e) => {
      const d = JSON.parse(e.data);
      if (d.id === id) {
        ws.removeEventListener('message', onMsg);
        resolve(d);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.close();
  return out;
}

function chromeProcs(match) {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${match}*' } | Select-Object -ExpandProperty ProcessId`,
      ],
      { encoding: 'utf8' },
    );
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function killChrome(match) {
  for (const pid of chromeProcs(match)) {
    try {
      execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* 已经退了 */
    }
  }
}

function launch(url, { profile, port, size, pos }) {
  const child = spawn(
    CHROME,
    [
      '--autoplay-policy=no-user-gesture-required',
      `--app=${url}`,
      `--window-size=${size}`,
      `--window-position=${pos}`,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${ROOT}\\data\\${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
}

async function reloadTarget(port, url, { name }) {
  const list = await targets(port);
  if (!list) return { name, ok: false, why: `CDP ${port} 没开` };
  const page = list.find((t) => /8787/.test(t.url)) || list[0];
  if (!page) return { name, ok: false, why: '没有页面 target' };
  await cdp(port, page.webSocketDebuggerUrl, 'Page.navigate', { url });
  return { name, ok: true, url };
}

async function main() {
  if (args.has('--server')) {
    // 杀掉占用 8787 的 node，再起一个新的
    try {
      const pids = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`,
        ],
        { encoding: 'utf8' },
      ).trim();
      if (pids) execFileSync('taskkill', ['/PID', pids, '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* 没在跑也无所谓 */
    }
    await sleep(600);
    const child = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, detached: true, stdio: 'ignore' });
    child.unref();
    await sleep(2200);
    console.log('  · server.mjs 已重启');
  }

  // 直播窗：先试 CDP 直连刷新；起不来就重开一个窗口
  let live = await reloadTarget(9222, fresh ? LIVE : `${LIVE}&keep=1`, { name: '直播窗' });
  if (!live.ok) {
    killChrome('chrome-live');
    await sleep(400);
    launch(fresh ? LIVE : `${LIVE}&keep=1`, {
      profile: 'chrome-live',
      port: 9222,
      size: '1920,1080',
      pos: '0,0',
    });
    live = { name: '直播窗', ok: true, url: fresh ? LIVE : `${LIVE}&keep=1`, relaunched: true };
  }

  // 操作台：CDP 在就刷新，不在就重开
  let admin = await reloadTarget(9223, ADMIN, { name: '操作台' });
  if (!admin.ok) {
    killChrome('chrome-admin');
    await sleep(400);
    launch(ADMIN, { profile: 'chrome-admin', port: 9223, size: '1500,940', pos: '210,70' });
    admin = { name: '操作台', ok: true, url: ADMIN, relaunched: true };
  }

  for (const r of [live, admin]) {
    console.log(`  · ${r.name}：${r.ok ? `已刷新 ${r.url}${r.relaunched ? '（重开窗口）' : ''}` : `失败（${r.why}）`}`);
  }
}

await main();
