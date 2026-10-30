/* 造一点观众动静，方便截图 / 演示：node tools/preview.mjs */
const SERVER = process.env.SERVER || 'http://127.0.0.1:8787';

const post = async (path, body) => {
  const res = await fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const steps = [
  ['/api/event', { kind: 'enter', username: 'Rin' }],
  ['/api/event', { kind: 'chat', username: '七月', text: '大肥鱼今晚讲什么呀' }],
  ['/api/event', { kind: 'chat', username: '不睡觉的猫', text: '蹲一个，我泡好茶了' }],
  ['/api/event', { kind: 'gift', username: '白桃汽水', giftName: '嘉年华', count: 1 }],
  ['/api/event', { kind: 'chat', username: '阿离', text: '这个开头好有画面感' }],
  ['/api/event', { kind: 'gift', username: '小行星', giftName: '小心心', count: 3 }],
  ['/api/event', { kind: 'chat', username: '晚风', text: '点歌 晴天' }],
  ['/api/event', { kind: 'chat', username: '七月', text: '别停别停，后面呢' }],
];

for (const [path, body] of steps) {
  const out = await post(path, body);
  console.log(out.ok ? '✓' : '✗', body.kind, body.username, body.text || body.giftName || '');
  await wait(400);
}
