/**
 * 造一批演示数据（不连抖音也能看效果）
 * 用法：node tools/demo.mjs [server] [--gifts]
 */
const base = (process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seq = [
  { kind: 'enter', username: '鲸鱼小饼干' },
  { kind: 'chat', username: '七月', text: '大肥鱼今天也在写字呀' },
  { kind: 'gift', username: '白桃汽水', giftName: '嘉年华', count: 1 },
  { kind: 'chat', username: '晚风', text: '点歌 平凡之路' },
  { kind: 'chat', username: '小行星', text: '你是真人吗' },
  { kind: 'gift', username: '阿离', giftName: '小心心', count: 3 },
  { kind: 'enter', username: 'Rin' },
  { kind: 'chat', username: '白桃汽水', text: '主播好可爱，今天播到几点呀' },
  { kind: 'gift', username: '不睡觉的猫', giftName: '比心', count: 2 },
  { kind: 'chat', username: '七月', text: '点歌 晴天' },
];

for (const item of seq) {
  const res = await fetch(`${base}/api/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ ...item, source: 'demo' }),
  });
  console.log(res.status, item.kind, item.username, item.text || item.giftName || '');
  await sleep(600);
}
