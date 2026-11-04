/**
 * 时段感知：按北京时间把一天分成几段，每段有自己的称呼、语气和话题方向。
 * 电台用它来：换话题时选合适的题、问候语说对时间（不在早上说"今晚"）、
 * 跨时段时主动打个招呼换话题、页面副标题和色调跟着变。
 */
export const SLOTS = [
  { key: 'dawn', from: 5, to: 8, label: '清晨', subtitle: '早安电台 · 陪你醒来', greet: '早上好',
    tone: '声音轻一点、清爽，帮刚醒的人慢慢开机，别太亢奋。',
    themes: '早餐吃什么、起床困难、今天的小目标、通勤路上、天气和穿衣' },
  { key: 'morning', from: 8, to: 11, label: '上午', subtitle: '上午电台 · 陪你上班上课', greet: '上午好',
    tone: '利落、有精神，像同事间的闲聊，轻松不打扰人干活。',
    themes: '上班上课的日常、摸鱼小技巧、效率和拖延、今天的第一杯咖啡或茶' },
  { key: 'noon', from: 11, to: 14, label: '中午', subtitle: '午间电台 · 吃饭午休', greet: '中午好',
    tone: '放松、带点烟火气，聊吃的，提醒午休。',
    themes: '午饭吃什么、外卖和食堂、午睡、一个人吃饭、家乡的味道' },
  { key: 'afternoon', from: 14, to: 17, label: '下午', subtitle: '下午茶电台 · 犯困来听', greet: '下午好',
    tone: '慵懒、俏皮，帮大家对抗下午犯困，多一点冷知识和小游戏感。',
    themes: '下午犯困、下午茶、冷知识、"你会选哪个"的选择题、周末计划' },
  { key: 'evening', from: 17, to: 20, label: '傍晚', subtitle: '下班电台 · 回家路上', greet: '傍晚好',
    tone: '温暖、松弛，像下班路上有人陪你说话，聊今天过得怎么样。',
    themes: '下班路上、今天最累和最开心的事、晚饭、通勤、给自己的小奖励' },
  { key: 'prime', from: 20, to: 23, label: '晚上', subtitle: '晚间电台 · 一起聊聊', greet: '晚上好',
    tone: '最热闹的时段，有态度、偶尔毒舌，多抛观点让大家站队讨论。',
    themes: '有争议但无害的生活话题、感情和友情、追剧和音乐、成长经历、"如果……你会怎么做"' },
  { key: 'late', from: 23, to: 26, label: '深夜', subtitle: '深夜电台 · 树洞', greet: '夜深了',
    tone: '低一点、慢一点，适合倾诉和心事，多倾听少说教。',
    themes: '没说出口的话、睡不着在想什么、孤独和陪伴、过去的人和事、给自己的一句话' },
  { key: 'small', from: 2, to: 5, label: '凌晨', subtitle: '凌晨电台 · 失眠陪伴', greet: '这么晚还没睡呀',
    tone: '非常轻、非常温柔，陪失眠的人，适时劝大家早点休息。',
    themes: '失眠、凌晨还醒着的原因、夜班和熬夜的人、安静的小事、睡前放松' },
];

/** 当前北京时间对应的时段；weekend 表示周末（周五 20 点以后也算） */
export function currentSlot(at = Date.now()) {
  const d = new Date(at + 8 * 3600_000);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const day = d.getUTCDay();
  const slot = SLOTS.find((s) => (h >= s.from && h < s.to) || (h + 24 >= s.from && h + 24 < s.to)) || SLOTS[6];
  const weekend = day === 0 || day === 6 || (day === 5 && h >= 20);
  return { ...slot, weekend };
}

/** 给模型的一段时段说明 */
export function slotPrompt(slot) {
  return (
    `现在是${slot.weekend ? '周末的' : ''}${slot.label}时段（${slot.subtitle}）。` +
    `这个时段的语气：${slot.tone} 适合聊的方向：${slot.themes}。` +
    '说到时间要和现在的时段一致，比如白天别说"今晚""深夜"，深夜别说"早上好"。'
  );
}
