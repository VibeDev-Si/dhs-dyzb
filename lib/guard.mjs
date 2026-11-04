/**
 * 敏感内容闸：弹幕进来、搜索之前、每句合成之前各查一次。
 * 内置词表只是基础兜底，操作台「电台 → 安全」里可以追加词（config.radio.blockWords）。
 * 返回 { ok, category, crisis }：
 *   crisis=true 表示流露出伤害自己的念头，不拦截沉默，而是走固定安抚话术并提醒真人值守。
 */
const RULES = [
  // "笑死/困得想死"这类口头禅不算；明确表达想结束生命才算
  { category: 'crisis', re: /自杀|轻生|不想活|活不下去|(?<![笑困累热饿馋烦])想死|割腕|跳楼|结束(自己的)?生命|活着没(意思|意义)|安眠药.*(吃|吞)/ },
  { category: 'contact', re: /(加|\+|➕)\s*(我|v|vx|微信|wx|qq|扣扣|威信)|微信号|vx号|qq号|手机号|电话号|私聊我|私信我|线下见/i },
  { category: 'contact', re: /\d[\d\s-]{9,}\d/ }, // 一长串数字：手机号、QQ 号
  { category: 'sexual', re: /约炮|裸聊|裸照|色情|黄片|黄网|开房|性爱|做爱|援交|一夜情|成人视频|av女优|擦边|胸多大|三围/i },
  { category: 'gambling', re: /赌博|博彩|网赌|下注|菠菜|赌场|百家乐|彩票内幕/ },
  { category: 'drugs', re: /毒品|冰毒|大麻|海洛因|摇头丸|k粉/i },
  { category: 'fraud', re: /刷单|返利群|代刷|兼职日结|网贷|套现|传销|拉人头|带你投资|稳赚不赔/ },
  { category: 'violence', re: /怎么(杀|砍|捅|炸)|制作炸弹|做炸药|弄死他|报复社会/ },
  // 只放明显的；更细的交给人设提示 + 操作台自定义词。词太宽会误伤"学生会主席"这类正常话
  { category: 'politics', re: /政治|共产党|国家领导人|台独|港独|藏独|疆独|六四|示威游行|民主运动|翻墙/ },
  { category: 'abuse', re: /傻[逼比b]|sb\b|操你|草泥马|尼玛|你妈|死全家|脑残|nmsl/i },
];

function normalize(text) {
  return String(text || '')
    .replace(/[\s\u200b-\u200d\ufeff·•_*.\-|]/g, '') // 去掉插在字中间的空格和符号（"微 信" "约.炮"）
    .toLowerCase();
}

export function checkText(text, extraWords = []) {
  const raw = String(text || '');
  if (!raw.trim()) return { ok: true };
  const flat = normalize(raw);
  for (const r of RULES) {
    if (r.re.test(raw) || r.re.test(flat)) {
      return { ok: false, category: r.category, crisis: r.category === 'crisis' };
    }
  }
  for (const w of extraWords || []) {
    const word = normalize(w);
    if (word && flat.includes(word)) return { ok: false, category: 'custom', crisis: false };
  }
  return { ok: true };
}

/** 读弹幕时用：把昵称里的违规字眼换掉，避免被大肥鱼念出来 */
export function safeName(name, extraWords = []) {
  const n = String(name || '').trim().slice(0, 12);
  return checkText(n, extraWords).ok ? n || '朋友' : '这位朋友';
}
