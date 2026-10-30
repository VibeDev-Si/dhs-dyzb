// 找几个正在直播的房间号，用来验证直连弹幕
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

const home = await fetch('https://live.douyin.com/', { headers: { 'User-Agent': UA } });
const cookie = (home.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
const html = await (await fetch('https://live.douyin.com/', { headers: { 'User-Agent': UA, Cookie: cookie } })).text();
console.log('homepage length', html.length);

const ids = new Set();
const patterns = [/live\.douyin\.com\/(\d{6,})/g, /"web_rid":"(\d+)"/g, /\\"web_rid\\":\\"(\d+)\\"/g, /web_rid=(\d{6,})/g];
for (const re of patterns) {
  let m;
  while ((m = re.exec(html))) ids.add(m[1]);
}
console.log('web_rid', [...ids].slice(0, 20));

for (const rid of [...ids].slice(0, 4)) {
  try {
    const u = new URL('https://live.douyin.com/webcast/room/web/enter/');
    Object.entries({ aid: '6383', app_name: 'douyin_web', live_id: '1', device_platform: 'web', enter_from: 'web_live', web_rid: rid }).forEach(
      ([k, v]) => u.searchParams.set(k, v),
    );
    const r = await fetch(u, { headers: { 'User-Agent': UA, Cookie: cookie, Referer: `https://live.douyin.com/${rid}` } });
    const j = await r.json().catch(() => ({}));
    const room = j?.data?.data?.[0];
    console.log(rid, '→', room?.id_str, 'status', room?.status, 'title', String(room?.title || '').slice(0, 24));
  } catch (e) {
    console.log(rid, 'err', e.message);
  }
}
