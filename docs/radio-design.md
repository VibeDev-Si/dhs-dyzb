# 御姐大肥鱼电台 · 第一版设计

## 定位

深夜电台 + 树洞陪聊。大肥鱼是「鲸鱼邮局」的夜班主播：成熟、温柔、清醒、偶尔毒舌，
朋友式陪伴，不走暧昧路线。心事就是普通弹幕，AI 自动回复；开播时须有真人在操作台值守。

## 这一版做什么

1. AI 回弹幕边写边说：DeepSeek 流式输出 → 每句过词库 → 推进同一条 Fish 双向流。
2. 节拍式回复：上一段快说完时，把这段时间攒下的弹幕一次交给 AI。
   只有 1 条就单独回；多条就挑 1–3 条一段话回完（"好多人说……也有朋友觉得……"）。
3. 话题：顶部常驻「今晚在聊：XXX」。来源：观众「话题 XXX」上墙投票 / AI 自己抛 / 操作台手动设。
   每 `topicMin` 分钟换一个（优先取票最多的）。
4. 进场欢迎（模板，不花 token，最多每 30 秒一次，最多点 2 个名字）。
5. 新人提醒：每 5–8 分钟一句"刚进来的朋友，我们在聊……"，这句话同时作为顶部第二行的前情。
6. 冷场：`idleSec` 秒没弹幕、也没在说话，AI 围绕当前话题说一小段独白。
7. 联网搜索：DeepSeek Search API，作为工具交给模型。模型决定调用时立刻播口语垫话
   （"嗯……我帮你查一查"），搜到后播"我好像找到了"，再播回答。垫话预先合成缓存。
8. 安全：敏感词三道闸（弹幕进来 / 搜索词 / 每句合成前）；危机内容走固定安抚话术并提醒值守。
9. 操作台：真人接管（暂停 AI）、一键静音、以大肥鱼的声音说一句、词库、搜索开关与限额。
10. 竖屏主页（1080×1920），新形象 `public/assets/radio/host.png`，常驻 AI 生成标识。

11. 时段感知（lib/timeslot.mjs）：清晨 5–8 / 上午 8–11 / 中午 11–14 / 下午 14–17 / 傍晚 17–20 /
    晚上 20–23 / 深夜 23–2 / 凌晨 2–5（北京时间），每段有自己的语气和话题方向；跨时段时主动打招呼并换话题；
    问候语、选话题、页面副标题和色调都跟着时段变。周五 20 点后和周末标记为 weekend。
12. 主播画面是 HTML 分层角色（public/assets/radio/rig/），口型按语音音量实时变化，会眨眼、呼吸、
    说话时点头，搜索时有"查一查"的动作；字幕上方显示正在回复的弹幕原文。

## Fish Audio 的网络代理

Fish 在海外，部分网络直连会 `ETIMEDOUT`。操作台「声音 · 大肥鱼 → Fish 代理」三选一：

| fishProxyMode | 行为 |
|---|---|
| `system`（默认） | 依次看环境变量 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`（每 60 秒重读），再看 Windows 系统代理；都没有就直连 |
| `custom` | 用 `fishProxy`：`http://`、`https://`、`socks5://`、`socks5h://`、`socks4://`，可带 `用户名:密码@`；不写协议按 http 处理 |
| `none` | 直连（本机能直接访问 Fish 时用） |

- 保存前会校验格式，`/api/voice/fish-proxy-test` 可以带未保存的设置先试一次（只请求公开音色列表，不花额度）。
- 页面上看到的地址里密码显示为 `***`；原样提交会换回已保存的密码，改密码要整条重填。
- 连接失败时错误信息会附带一句可执行的建议（去设置代理 / 检查代理端口 / 补用户名密码）。

点歌、礼物、弹幕直连、Fish 语音、旧的小说模式都保留；`mode: "novel"` 可切回旧页面。

## 配置（config.json → radio）

```json
"mode": "radio",
"radio": {
  "topicMin": 10, "newcomerMinMin": 5, "newcomerMaxMin": 8, "idleSec": 45,
  "search": true, "searchPerHour": 30,
  "paused": false,
  "blockWords": [], "crisisHotline": "12356",
  "showFeed": false
}
```

## 一次「说话」（say）

同一时间只有一个 say 在生成。一个 say 可以带多段音频，页面按收到顺序依次播放。

| 字段 | 说明 |
|---|---|
| `id` | 字符串，唯一 |
| `kind` | `reply` / `batch` / `welcome` / `newcomer` / `topic` / `idle` / `command` / `gift` / `host` / `crisis` |
| `to` | 被点名的昵称数组，可空 |
| `text` | 已经通过词库检查的全文（say-end 时给） |

## SSE（GET /api/events）新增事件

所有事件都是 `data: {...}`，`type` 字段区分：

| type | 字段 | 页面怎么处理 |
|---|---|---|
| `radio` | `radio`：见下方 RadioView | 刷新话题条、前情、话题墙、状态 |
| `say-start` | `say`：{id, kind, to, quotes:[{name,text}]} | 新开一条字幕；quotes 是被回复的弹幕原文，显示成引用卡片 |
| `say-status` | `id`, `status`：searching / found | 角色换成"查资料"动作和气泡 |
| `say-delta` | `id`, `text`（追加的一句） | 追加到这条字幕的待显示文字 |
| `say-audio` | `id`, `url`, `seq` | 推进音频队列，按收到顺序播放 |
| `say-end` | `id`, `text`, `ok` | 标记这条结束（ok=false 表示中途被拦/出错） |
| `mute` | — | 立刻停止正在播的语音并清空队列和字幕 |

已有事件照旧：`init`、`event`（弹幕/礼物/进场，kind=chat/gift/enter/follow/like/ai/system）、
`stats`、`song`（{currentSong:{title,by,url}, playlist, music:{volume}}）、`config`。

## RadioView（GET /api/radio 的 `radio` 字段，也随 SSE 推送）

```json
{
  "mode": "radio",
  "slot": { "key": "late", "label": "深夜", "subtitle": "深夜电台 · 树洞", "greet": "夜深了", "weekend": false },
  "topic": { "text": "那些没说出口的话", "hook": "你有一句一直没说的话吗？", "since": 1730000000000, "source": "ai" },
  "recap": "刚进来的朋友，我们在聊……（最近一次新人提醒的原话）",
  "wall": [ { "text": "猫和狗谁更粘人", "count": 3, "users": ["七月", "晚风"] } ],
  "paused": false,
  "speaking": true,
  "busy": false,
  "search": { "enabled": true, "today": 4, "perHour": 30 },
  "alerts": [ { "id": "a1", "username": "某某", "text": "原话", "at": 1730000000000 } ],
  "lastError": ""
}
```

## HTTP

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/radio` | `{ ok, radio }` |
| POST | `/api/radio/topic` | `{ text }` 设当前话题；`{ next: true }` 立刻换下一个 |
| POST | `/api/radio/pause` | `{ paused: true/false }` 真人接管 / 交还 AI |
| POST | `/api/radio/mute` | 停掉当前这句（中止生成 + 页面静音） |
| POST | `/api/radio/say` | `{ text }` 用大肥鱼的声音说这句（过词库） |
| POST | `/api/radio/alerts/clear` | `{ id }` 处理掉一条危机提醒 |
| POST | `/api/config` | 已有；`{ patch: { radio: {...}, mode } }` 改配置 |
