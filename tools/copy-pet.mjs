import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'C:\\Users\\季明辰\\.dsh\\profiles\\desktop\\node_modules\\dsh-pet\\assets\\webm';
const DST = join(process.cwd(), 'public', 'assets', 'pet');
mkdirSync(DST, { recursive: true });

/* 目标名 → dsh-pet 里的原始动作 */
const MAP = {
  idle: '待机呼吸休闲.webm',
  type: '原地敲击桌面互动.webm',
  wave: '点击回应-元气挥手.webm',
  rice: '吃白米饭.webm',
  bubble: '鲸鱼吐泡泡特效.webm',
  code: '写代码.webm',
  happy: '点击回应-开心跃动.webm',
  shy: '点击回应-害羞惊讶.webm',
  angry: '点击回应-傲娇生气.webm',
  laugh: '点击回应-挠痒咯咯笑.webm',
  think: '工作状态-思考冒泡.webm',
  busy: '工作状态-忙碌点按.webm',
  cheer: '工作状态-雀跃庆祝.webm',
  pace: '工作状态-原地踱步张望.webm',
  sigh: '工作状态-垂头叹气冒汗.webm',
  stretch: '超大伸懒腰.webm',
  doze: '原地小憩沉眠.webm',
  surprise: '被吓一跳.webm',
  dance: '轻快摇摆舞.webm',
  sing: '悠闲哼歌.webm',
  tail: '用鲸鱼尾巴拍打地面.webm',
  spin: '小幅度原地360度旋转展示.webm',
  unwrap: '拆礼物.webm',
  cat: '撸猫.webm',
  tea: '吃早餐.webm',
};

const alt = {
  rice: ['吃白饭.webm', '吃白米饭.webm', '吃晚餐.webm'],
};

let ok = 0;
for (const [name, file] of Object.entries(MAP)) {
  const candidates = [file, ...(alt[name] || [])];
  const hit = candidates.map((f) => join(SRC, f)).find((p) => existsSync(p));
  if (!hit) {
    console.log('MISS', name, file);
    continue;
  }
  copyFileSync(hit, join(DST, `${name}.webm`));
  ok += 1;
}
console.log('copied', ok);
