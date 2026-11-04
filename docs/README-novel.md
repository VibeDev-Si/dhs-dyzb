# 大肥鱼 · 抖音「读小说」直播间

给 OBS 用的 1920×1080 直播场景：**大肥鱼**（蓝毛鲸鱼女仆）在深蓝色的邮局里，**一章一章地念小说**。小说来自 `短篇/` 目录（每天自动化写作产出），按修改时间取最新的一本，一章合成一段语音照原文念；**一章念完休息 5 分钟**——休息时用**语音**回弹幕、聊刚念过的内容、**不剧透**后面的剧情；整本念完会摆出**作品档案**（世界观、人物、主题、写得好的地方、可以更好的地方、想问问你们），跟观众一起聊优缺点；观众随时能发「选题 XXX」给明天的故事投票。

- 左上：今日 token 消耗 + 账户余额
- 左侧：实时弹幕（抖音抓来的 + 大肥鱼自己的回话）
- 中间上方：章节标题（第 X 章 / 共 N 章）+ 阶段芯片（朗读中 / 休息 · 聊天 / 作品讨论）+ 倒计时
- 中间：小说正文（照原文，一段一段往上推）
- 中间下方：本段总结（这一章发生了什么，40–60 字）
- 右上：点歌队列
- 右中下：大肥鱼的活动区（念、挥手、谢礼物、吐泡泡…），休息时的语音回复在这里以气泡出现

![预览](preview.png)

仓库：<https://github.com/newbeejmc/Dsh_douyin>

---

## 1. 三步跑起来

```bat
:: 1) 装两个小依赖（只有弹幕直连用得到：ws + protobufjs）
npm install

:: 2) 第一次跑，先把示例配置复制一份（里面有 Key、房间号要你自己填）
copy config.example.json config.json

:: 3) 启动（默认 8787 端口）
node server.mjs
```

> 仓库里只有 `config.example.json`（Key 和房间号都是空的）；`config.json` 是你的真实配置，已被 `.gitignore` 排除，不会上传。

2. **双击 `打开直播间.cmd`** —— 打开一个没有地址栏的 1920×1080 窗口，**带声音、不用点任何东西**（内部就是 `chrome --autoplay-policy=no-user-gesture-required --app=http://127.0.0.1:8787/?auto=1`）。
   不想用这个窗口，也可以自己开浏览器访问 <http://127.0.0.1:8787>，但第一次要点一下页面底部的「🔊 点一下，开启声音」。
3. 打开 <http://127.0.0.1:8787/admin> —— 操作台：填 **DeepSeek API Key**、填**直播间号连弹幕**、改故事大纲、造测试弹幕、看发送箱。

> Windows 也可以双击 `start.cmd` 起服务（第一次会自动 `npm install`）。Key 只存本机 `config.json`，除了 `api.deepseek.com` 不外发。

不填 Key 也能跑：故事按大纲原文 + 语气提示兜底念出来，弹幕用固定话术回，页面照常显示礼物和弹幕，token 花费恒为 0。

### 改完代码，让页面立刻生效

```bat
:: 重启服务 + 刷新直播窗 + 刷新操作台（直播窗的队列和弹幕会保留）
npm run pages

:: 想按「刚开播」清场（队列/弹幕/发送箱清空）
node tools\restart-pages.mjs --server --fresh
```

也可以直接双击 `重启页面.cmd`。它做三件事：杀掉 8787 上的旧 node 重新起一个 → 用 CDP 把直播窗刷到 `?auto=1&keep=1`（**keep 保队列**）→ 把操作台刷到最新。窗口没开或没带调试端口时会自动重开一个（直播窗 9222、操作台 9223）。

> 为什么要 `keep`：`?auto=1` 一打开就清场（见 4.6「每次打开直播窗，自动清场」）。改代码时正在放歌，刷新不清会更方便；真要清场就加 `--fresh`。

---

## 2. 一场直播是怎么走的

没有固定时间表，**节奏由小说本身决定**：一章多长，就念多久；念完就休息，休息完自动进下一章。

| 阶段 | 大肥鱼在做什么 | 什么时候结束 |
| --- | --- | --- |
| 准备中 | 把这一章合成为一段语音（edge 音色，2000 多字约 20–40 秒） | 合成完成 |
| 朗读中 | **照原文一字不改地念**（不重写、不即兴加戏），弹幕照常在左侧聊天框里回 | 这一章音频播完（页面 `ended` 或服务端看门狗） |
| 休息 · 聊天 | 念完这一章的 40–60 字小结，然后**只用语音**回弹幕、收礼物、处理点歌；聊刚念过的细节、猜后面会怎样，但**绝不剧透** | 默认 5 分钟（可改） |
| （下一章） | 自动合成、接着念 | 循环 |
| 作品讨论 | 整本念完，展示作品档案，用语音跟观众聊世界观、人物、主题、优点与短板 | 手动停下 / 换下一本 |

- **休息多久**：`config.json → novel.breakSec`（默认 300 秒），操作台「② 小说朗读」里也能改，最小 30 秒。
- **定时开讲**：操作台「② 小说朗读 → 开始时间」填一个时间（如 `20:30`）点「保存时间」，`novel.startAt` 就记下来了。**不填就按默认 17:00（晚上五点）**；想彻底不定时，填 `off`。到点前这段时间频道是「还没开讲 · 自由聊天」——大肥鱼在纸面写一行「灯还亮着，书还没翻」，陪弹幕聊天、点歌都照常，但不会提前讲今晚的剧情。
  - **页面上一直显示开讲时间**：标题下面那行会写「每晚 17:00 开讲」；没开讲时左上角还会显示倒计时。
  - **提前 5 分钟提醒**：到 `开讲时间 − 5 分钟` 会自动说一句「还有五分钟，17:00 准时开讲。今晚念《书名》，一共 N 章」，同时进弹幕流、合成语音、写进抖音公屏。
  - **到点自动开讲**：`novel.autoStart`（默认 true）打开时，到点自动从 `短篇/` 里**最新的一本**开始念，不用手动点；关掉就只在开讲前提醒，等你点「开始念这一本」。
- **重置直播间**：操作台「① 基础设置 → 重置直播间」清空直播画面上的所有弹幕、点歌队列（正在播的也会停）、发送箱和待回复队列；小说进度、今日礼物收益、token 统计都保留。相当于「重新开一场」。
- **休息时为什么不写弹幕框**：休息阶段的回复走 `voiceOnly`，只合成语音、不回写抖音公屏；朗读阶段的回复照旧两条路都走（页面 + 公屏）。
- **语音回复有字幕**：右下角大肥鱼脚下会出现一条语音气泡（前 34 个字），5 秒后自动消失——这是给观众看的字幕，不进弹幕列表。
- **一本念完会记住**：每章都会自动生成一条小结，作品档案会用到它；档案优先调用 AI（会读同目录的 `设定.md / 角色.md / 章节规划.md / 作品信息.md`），AI 不通时用规则兜底。
- **换哪一本**：`listNovels()` 递归扫 `短篇/`，按修改时间取最新；`说明`、`readme`、`_开头`、小于 500 字节的文件会被跳过；同一作品夹里同时有 `正文.md` 和 `书名.txt` 时只念 `正文.md`。
- **章节怎么切**：认 `第一章`/`第1章`/`## 第1章：白布`/`第3回` 这类标题；没有标题就按 2000 字左右自动分段。
- **念出来的开头**：每章先在前面补一句「第X章，标题。」（数字转成汉字读法），正文按原样。
- **左栏一张卡**：上半是弹幕（新消息从底部往上堆，没消息时给两句提示），下半用一条细线隔开——「本视频目录」列出这一本每一章（念过的变灰、正在念的高亮），再下面「明天读什么」是观众用「选题 XXX」投出来的票，票多的排前面。
- **纸面跟着声音走**：正文比纸边长，念到哪儿纸面就滚到哪儿，底部做了一点渐隐，一眼能看出「还在往下念」。
- **本段总结只在休息时出现**：朗读中纸面就是原文，作品讨论时纸面换成作品档案，总结卡自动收起，不抢地方。
- **本章线索卡**：每章念完，纸面下方自动弹出这张卡——第一行是这一章的小结，下面三列「人物动向 / 新线索 / 未解谜团」，休息 5 分钟里一直挂着，下一章开始前收起。内容由 AI 读完这一章生成（会参考同目录的 `角色.md`），AI 不通时用规则从正文里抠句子兜底；同一段话还会**用语音念一遍**，只听不看的人也知道这章记住了什么。
- **中间纸面能切换**：默认是故事正文；观众发「查看角色」或「查看设定」，纸面就换成这一本的 `角色.md` / `设定.md`（去掉 markdown 记号、按小标题排版），90 秒后**或**这一章/这条语音播完，自动切回正文并**停在你刚才读到的位置**（按音频进度算）。发「查看故事 / 返回故事」可以立刻切回来。
- **大肥鱼会动**：`public/assets/pet/` 里有 25 个动作（待机呼吸、敲桌子、挥手、吃白饭、吐泡泡、思考冒泡、雀跃、踱步、叹气、伸懒腰、小憩、被吓一跳、摇摆舞、哼歌、甩尾巴、转圈、拆礼物、撸猫、吃早餐…）。朗读时敲桌子、准备时忙碌点按、休息时哼歌、作品讨论时思考；收到礼物换「开心 / 雀跃 / 拆礼物」、有人进场就挥手、被弹幕逗到会笑；**没人说话的时候它每 16–22 秒自己换个动作**，不会僵在原地。
- **什么时候用语音、什么时候用文字**：朗读中（含准备中）的回复走**聊天框**，同时回写抖音公屏；休息、作品讨论、还没开讲时段的回复**只用语音**（右下角有字幕气泡），不占公屏——这是「全程自动直播」时最舒服的分工。

想看每个按钮干什么，见第 9 节目录里的 `lib/novel.mjs` 与 `/api/novel/*`。

---

## 3. 弹幕怎么进来（四种方式）

### 方式 A：内置直连（推荐，不用浏览器、不用扩展）

内置了开源的抖音弹幕协议（`vendor/douyin-danma`，来自 `cortico-world-douyin-live`，GPL-3.0）：进程里直接连抖音网页直播的长连接，把弹幕 / 礼物 / 进场 / 关注 / 点赞解出来。

1. 打开 <http://127.0.0.1:8787/admin> → **2 · 弹幕接入**。
2. 填你的直播间号（`live.douyin.com/` 后面那串数字，或者整条链接都行），点「连上」。
3. 状态变 `live` 就开始收；没开播是 `waiting`，每 15 秒自动看一眼，开播自动连上；下播后也自己重连下一场。

也可以直接写进 `config.json`：`danmaku: { mode: "auto", roomId: "你的直播间号" }`，`node server.mjs` 启动时自动连。

- 只用得到 Node，**不开 Chrome、不装扩展**，直播间的人看不到你在看；
- 连的是只读通道，**不会往抖音发消息**（要说话得走方式 C 的扩展）；
- 抖音改协议时，换掉 `vendor/douyin-danma` 即可，主程序不用动。

**礼物收不到？** 抖音的礼物消息只推给**有登录态的观众**，匿名连接通常只能收到弹幕 / 进场 / 关注 / 点赞（实测连续换 5 个直播间各听 60 秒，一条 `WebcastGiftMessage` 都没有）。想要礼物进画面：

1. 用电脑浏览器登录 `live.douyin.com`，F12 → Network → 任意一条请求 → 复制整行 `Cookie`；
2. 操作台 **2 · 弹幕接入 → 抖音 Cookie** 粘进去点「保存」；
3. 程序会用这份 Cookie 重连一次（状态行会显示「带登录态」），之后收到的礼物会进右侧礼物条、弹幕流和「谢谢 XXX 的 XX ×N」toast。

Cookie 只写在 `config.json → danmaku.cookie`（`.gitignore` 已排除），`/api/config` 不会把它回传给浏览器。礼物**不走 4 秒去重**：同一个人连送两次小心心是正常行为，两次都会显示。

### 方式 B：抖音网页版直播间 + 扩展（要在公屏回话时用）

直连只读，**回话**得靠扩展把字打进直播间输入框：

1. 用**电脑 Chrome** 打开自己的直播间：`https://live.douyin.com/<你的直播间号>`（直播伴侣照常推流，不冲突）。
2. `chrome://extensions` → 开「开发者模式」→「加载已解压的扩展程序」→ 选本项目的 `extension` 文件夹。
3. 回直播间页面**刷新一次**，页面右侧的弹幕会出现在 <http://127.0.0.1:8787> 上。
4. 点扩展图标可改服务地址（默认 `http://127.0.0.1:8787`），看「已上报 / 已回写」计数。

扩展做的事：

- `MutationObserver` 盯弹幕列表 DOM，拆成 **弹幕 / 礼物 / 进场 / 关注 / 点赞**，POST 到 `/api/event`；
- 每 2.5 秒拉一次 `/api/outbox`，把大肥鱼的话**打进直播间输入框并点「发送」**——观众公屏上看到的是主播亲自回的话；
- 5 秒去重、90 秒防回流（自己发的不再被当成弹幕抓一遍）。

> 扩展只认 `live.douyin.com` / `www.douyin.com`。抖音改版改了 DOM，`extension/content.js` 的 `parseLine` 要跟着调。

### 方式 C：操作台手动造（调试/排练）

`/admin → 3 · 造一条弹幕`：填昵称和内容就能发，还能送礼、造进场、以主播身份手动说话。

### 方式 D：命令行灌数据

```bat
node tools/demo.mjs
node tools/preview.mjs
```

---

## 4. 弹幕指令

| 观众发 | 大肥鱼回什么 | 副作用 |
| --- | --- | --- |
| `点歌 晴天` | 有源：「收到你的点歌：《晴天》，这就放给你听。」/ 排在后面：「…排在队列第 1 位，等《平凡之路》放完就到它。」/ 没源：「…这首歌暂时没有可用播放源，本鲸先记下歌名，稍后再帮你确认。」 | 进点歌队列，右上角显示，**能解析到音源就会出声** |
| `切歌` / `下一首` | 换到下一首 | 队列前进一首，自动解析新歌音源 |
| `选题 一个夜市摊主和走失猫的故事` | 「收到你的选题：《…》，本鲸记进明天的候选里了，现在排第 N 位。」 | 进「明天的故事选题」票池（操作台「② 小说朗读」能看到、能手动加） |
| `查看角色` / `查看设定` | 「好，本鲸把角色表摊桌上。」（朗读中回在弹幕框） | 纸面切到 `角色.md` / `设定.md`，90 秒或本章播完自动切回正文的当前进度 |
| `查看故事` / `返回故事` | 「回来接着念。」 | 立刻切回正文 |
| 普通弹幕 | 朗读中：1–2 句回在弹幕框；休息/作品讨论中：**只用语音回**（弹幕框里不出现） | 自动回复，1 分钟最多 8 条 |
| 送礼物 | 带昵称 + 礼物名的道谢 | 计入今日收、礼物图鉴、右上角感谢 |

只有**真收到**的礼物才会被感谢；没有音源时**不会**假装正在放歌。

---

## 4.5 音乐播放源（点歌真的会唱）

点歌队列是**真播放**：服务端把歌解析成一个能 `<audio>` 直接放的地址，浏览器里放出来，OBS 采这个页面的声音就行。

**三种源，按 `config.json → music.provider` 选**：

1. `local` — 本地曲库（最稳、无版权风险）
   把 mp3/m4a/flac/ogg/wav 放进项目下的 `music/` 目录，文件名写成 `歌手 - 歌名.mp3` 就能认出歌手。
   页面通过 `/api/music/stream/:id` 走 HTTP Range 输出，支持拖动进度条。
2. `netease` — 网易云外链
   用公开搜索接口找歌，再取 `music.163.com/song/media/outer/url?id=…` 的 mp3。
   ⚠️ 这条链是**个人试听**用的：很多歌只能拿到翻唱/免费曲，原唱常常没有；**公开直播请改用自有或无版权音源**，别拿它当商用 BGM。
3. `custom` — 自建解析服务（推荐给要长期播的人）
   GitHub 上 `Binaryify/NeteaseCloudMusicApi`（Node，`npm i && node app.js`，默认 `http://127.0.0.1:3000`）起来后，把 `music.apiBase` 填成这个地址即可。它带登录态，能拿到更全的曲库和更高码率。

**解析顺序**：`auto` = 先本地曲库（同名/包含匹配）→ 再 `netease`；`custom` 则走你自建的 API。
解析时会先用 Range 试拉 1KB 校验 `content-type` 是不是音频、文件是否 ≥300KB，**过不了就不算有源**，不会给观众放个空链接。

**操作台**：`/admin → 4 · 声音（音乐 · 大肥鱼）` 里能改来源/目录/音量、重新扫描本地曲库、搜歌试听、手动解析当前这首。

### 会员歌曲（VIP）怎么办

先说清现在的链路：`music.163.com/song/media/outer/url?id=…` 是**公开外链，不带登录**。实测周杰伦《晴天》（id `186016`）这种会员/版权曲，它会 302 跳到 `music.163.com/404`，音频长度为 0 —— 所以**会员歌用外链是放不出来的**，跟你在浏览器里有没有登录会员没关系（外链这个接口根本不看 cookie）。

要放会员歌，把**你账号的登录态交给服务端**：

1. 浏览器打开 `https://music.163.com` 并登录（会员账号）；
2. F12 → Application（应用）→ Cookies → `https://music.163.com` → 找到 `MUSIC_U`，复制它那一整串值；
3. `/admin → ① 基础设置 → 声音 · 音乐 → 会员登录`，粘贴（`MUSIC_U=xxxx` 或只贴 `xxxx` 都行）→ **保存** → **检查**；
4. 检查通过会显示「已登录：昵称（会员）」，之后点会员歌就能拿到真实播放地址（走 `api/song/enhance/player/url`，带 Cookie 请求，返回 CDN 直链，再交给页面里的 `<audio>` 播）。

> **踩过的坑：取链必须用 `interface.music.163.com`**。同一个接口在 `music.163.com` 上也会返回一个看起来正常的会员直链，但那个链在 CDN 侧一律 `403 Forbidden`（Tengine），浏览器里 `<audio>` 直接 `MEDIA_ERR_SRC_NOT_SUPPORTED`。换成 `https://interface.music.163.com/api/song/enhance/player/url` 后，同样的 cookie 就能拿到 `206 audio/mpeg`、正常播完整首。`lib/music.mjs` 的 `neteaseTrackUrl()` 已按这个走。
>
> 实测：会员曲《演员》（id `32507038`，261 秒）→ 直链 `m801.music.126.net` → 直播窗 `readyState 4`、`currentTime` 正常推进、`error: null`。

**有些原唱搜不到**：搜索接口对部分版权曲（比如周杰伦《晴天》原唱 id `186016`）根本不返回，只回翻唱/伴奏。这时候会拿到同名的完整版翻唱（时长足够、能播完），不会去放 45 秒试听片段。

实现细节：cookie 存在 `config.json → music.neteaseCookie`（该文件已 `.gitignore`，不会进仓库），`publicConfig()` 会把它从任何返回给浏览器的配置里剥掉，只回一个 `hasCookie: true/false`。换账号/过期了就在同一处重新粘一次，保存时会清掉解析缓存并立刻验证。

找不到会员源时的行为：先自动退回**翻唱/免费版本**（搜到能播的就播）；全都不可用才在弹幕里回「这首要网易云会员才能放，本鲸现在没登录会员」。

**试听片段会被跳过**：没登录会员时，VIP 曲的正规接口只回一个 30–60 秒的试听片段（实测《演员》只给 45 秒 / 704KB），放一半就断——所以这类片段一律不用，宁可去选同一首歌的完整版 / Live / 翻唱。

⚠️ 两件事必须自己权衡：① 把会员账号的 cookie 交给本地服务，等价于把账号凭据放在这台机器上（`config.json` 别外发、别提交）；② 在**公开直播**里播放会员曲目属于公开传播，可能违反网易云用户协议和版权，风险在你这边。最稳的还是 `provider: local` + 自己合法持有的音频文件。

**注意**：
- **点歌队列最多排 3 首**（不含正在播的那首）。第 4 个人点的时候大肥鱼会回「队列已经排了 3 首啦，等《…》放完再点吧」，不会静默丢弃。名额用 `config.json → music.queueMax` 调（默认 3）。
- 浏览器默认禁止自动播放，**第一次要在页面上点一下 ▶**（OBS 浏览器源默认允许自动播放）。
- 音量在 `music.volume`（0–1），页面右下播完会自动 `POST /api/music/ended` 切下一首。
- 只支持能直连的音频文件；网易云外链有时效性，过期会显示「播放失败」，点 ▶ 会重新解析。

---

## 4.6 大肥鱼的声音（在线语音，上线朗读）

故事的每一段不只是「写」出来，大肥鱼会**真的念出来**。默认走 **MiniMax Speech 2.8 HD** 中文抒情旁白，听感比纯合成音更适合长篇故事。

**怎么开**：`/admin → ① 基础设置 → 声音 · 大肥鱼`：
- **大肥鱼音量**：台词音量（`voice.volume`，0–1），旁边「试听」念一句固定台词。
- **讲每段时出声**：总开关（`voice.enabled`）。
- **音色**：MiniMax 中文抒情旁白、Edge 在线音色、本地 Kokoro 音色，以及系统离线备用。
- **语速**：0.8 / 1 / 1.15 / 1.3（`voice.rate`）。
- 下方小字会显示当前是哪套参数（比如「温柔 · 晓晓 · zh-CN-XiaoxiaoNeural」）。

**四种引擎**：

| 引擎 | 音色 | 依赖 | 备注 |
| --- | --- | --- | --- |
| `minimax`（默认） | `Chinese (Mandarin)_Lyrical_Voice` | MiniMax API Key | Speech 2.8 HD，适合中文故事旁白；音色和合成在云端完成 |
| `edge` | 五个预设，`natural` 最自然 | 本机 Python + `pip install edge-tts` | 调微软语音接口，一句 2–3 秒，免费 |
| `kokoro`（本地，更好听） | Kokoro-82M 中文音色 4 个 | `tts-kokoro/` 下的模型 + `pip install kokoro-onnx misaki[zh]` | 完全离线，音质比 edge 更厚；CPU 上慢，一句 80 字要十几秒 |
| `sapi`（备用） | `Microsoft Huihui Desktop` | 无（Windows 自带） | 断网时的最后手段 |

### MiniMax Speech 2.8 HD 配置

项目默认使用官方中国区接口、模型 `speech-2.8-hd` 和系统音色
`Chinese (Mandarin)_Lyrical_Voice`。MiniMax 的音色 ID 是云端标识，**不是**本地的
`.bin`、`.pth` 或 Kokoro 音色包；切换音色时只需修改配置中的 ID。

推荐只用环境变量保存 Key（PowerShell 当前窗口示例）：

```powershell
$env:MINIMAX_API_KEY = '在这里粘贴你的 MiniMax API Key'
# 国际站 Key 才需要切换端点；中国区可省略
# $env:MINIMAX_BASE_URL = 'https://api.minimax.io/v1/t2a_v2'
npm start
```

也可以在 `/admin → 声音 · 大肥鱼 → MiniMax Key` 粘贴并保存。后台只显示“已配置”状态，
不会把 Key 回填到输入框；这种方式会保存在本机 `config.json`，环境变量仍然优先。

程序不会把 Key 回显到浏览器响应或日志；`GET /api/voice` 只返回
`minimaxHasKey: true/false`。配置文件中可调整 `voice.minimaxVoice`、
`voice.minimaxModel`、`voice.minimaxEmotion` 和 `voice.minimaxBaseUrl`，但 API Key
仍以 `MINIMAX_API_KEY` 为准。

MiniMax 请求使用 `POST /v1/t2a_v2`，默认输出单声道 MP3（32 kHz、128 kbps），并在
`data/voice/<hash>.mp3` 本地缓存。缓存键包含模型、音色、情绪、语速、音高、音频参数和全文；
同一文本第二次请求会直接命中缓存，改任意参数都会生成新缓存。试听失败时，先在操作台确认
显示了模型/音色，再检查 Key、接口区域和网络；常见错误包括 `未配置 MINIMAX_API_KEY`、401
（Key 无效）、429（额度或频率限制）、超时和空音频响应。没有 Key 时 Edge、Kokoro、SAPI
仍可继续使用。

**机制**：
- 一段 6–7 分钟的台词有 1400–1600 字，整段合成要等太久，所以会**切成 70–80 字的小段，边播边合成下一段**（预取一段），第一句 2–3 秒就能出声，中间不空场。
- 新一段开口前，上一段的声音会被立刻掐掉（`speakToken` 作废排队），不会两条音轨叠着说。
- 说话时 BGM 保持原音量（oice.duck 默认 ；想压低一点就设 0.25）。
- 合成本地缓存：`data/voice/<hash>.mp3|wav`，同一句只合成一次（实测 edge 首次约 2.8 秒，命中缓存直接返回）。

**本地 Kokoro 怎么装**（可选，想要更好音质时）：

```powershell
C:\Anaconda3\python.exe -m pip install kokoro-onnx soundfile espeakng-loader "misaki[zh]"
# 模型和音色已经放在 tts-kokoro/：model_quantized.onnx（92MB）+ voices.npz
# 换/加模型见 .voice-skill 里的说明；模型来自 hf-mirror（huggingface 国内镜像）
```

装好后在操作台把「音色」切到「本地 · 小北」即可，服务端会调用 `tts-kokoro/say.py` 合成。

> 想训练出**属于你自己的**音色（RVC 克隆）？见第 12 节「关于训练御姐音」——那需要一段 10 分钟的干净人声素材和一张 ≥8GB 显存的 N 卡，本机 6GB 目前没上。

> 第一次点「试听」如果没声音，多半是浏览器还没拿到用户手势——页面底部会出现「🔊 点一下，开启声音」，按一下即可；OBS 浏览器源不受这个限制。

### 打开就有声音（不用点任何东西）

浏览器默认会拦自动播放（第一次得点一下）。要「打开就出声」，用 **`打开直播间.cmd`** 双击就行，它带的参数是：

```bat
chrome.exe --autoplay-policy=no-user-gesture-required --app=http://127.0.0.1:8787/?auto=1 ^
           --window-size=1920,1080 --user-data-dir="data\chrome-live"
```

- `--autoplay-policy=no-user-gesture-required`：浏览器放行自动播放，打开即出声；
- `--app=...`：没有标签栏/地址栏的窗口，直接投 OBS 或副屏；
- `?auto=1`：页面走「自动模式」，不再显示「🔊 点一下，开启声音」那个按钮；
- `--user-data-dir`：单独一个浏览器配置，不碰你平时的 Chrome。

> 用普通标签页打开（`http://127.0.0.1:8787/`）时，仍然保留那个兜底按钮——点一下之后同页面就一直有声了。OBS 的浏览器源默认就允许自动播放，不用点。

### 点歌会自动往下播

- 队列里只要有歌，页面就会自己播，不用手动点 ▶（`renderSong` 里直接 `play()`）。
- 一首放完 → 前端 `POST /api/music/ended` → 服务端把下一首设成当前曲、解析音源 → 推 `song` 事件 → 页面自动播下一首。
- 想手动暂停/继续，点队列卡左边的 ▶ / ❚❚。

### 音乐和讲述同时响

两条音轨各走各的：BGM 走 `<audio id="player">`（音量 `music.volume`，默认 0.2），大肥鱼的声音走 `<audio id="voicePlayer">`（音量 `voice.volume`，默认 0.8），互不打断、同时出声。

想让讲述时 BGM 让一让，把 `config.json → voice.duck` 设成 `0.3`（说话时 BGM 压到 30%，说完恢复）；默认 `1` 就是不压。

### 每次打开直播窗，自动清场

窗口一打开（页面加载），前端会先 `POST /api/session/boot`，服务端把这些清空再让页面连 SSE：

- **音乐**：清空点歌队列，当前曲目也置空（不再「上次那首还挂着」）；
- **消息**：清空发送箱里待回写的弹幕、以及还没轮到回复的队列；
- **弹幕**：整条清空，之后最多只保留 **50 条**（服务端 `MAX_EVENTS = 50`，页面同样只留 50 行）。

OBS 刷新浏览器源、每天开播重开窗口，都会从干净状态开始。调试时不想被清，就在地址后面加 `?keep=1`。

### 浏览器没声音？按顺序查

> 最常见的三种：**① 直播窗那个 `<audio>` 被留在静音态**（后台点歌、直播窗有进度条却没声）；**② Windows 系统音量太低**（页面在播、峰值也在动，就是听不见）；**③ Chrome 的媒体服务卡死**（`readyState` 一直是 0）。

1. 直播页底部有没有「🔊 点一下，开启声音」——有就点它（Chrome 的自动播放策略）。
2. `/admin → ① 基础设置 → 声音 · 音乐` 点「测试音」：能听到 880Hz 的「叮」说明浏览器和扬声器都正常，问题在音源；听不到就是系统/浏览器音量或输出设备的问题。
3. 点「试听当前这首歌」：它不看弹幕、直接播当前曲目；如果这里没声，去 `/api/state` 看 `song.currentSong.url` 是否为空（空就是没解析到音源）。
4. 看一眼 Windows 的音量：页面音量是**乘**在系统音量上的（`music.volume` 0.2 × 系统 0.2 ≈ 4%，等于没声）。要拉就直接拖任务栏喇叭，或点「🔊 修系统音量」。
5. 还不行就重启直播窗（`重启页面.cmd`，或整棵杀掉 `chrome-live` 进程再开）：Chrome 的媒体服务偶发卡死，`Page.navigate` 救不回来，只能换进程。

页面这边已经做了自愈：换歌时强制 `muted=false`、音量回到 `music.volume`；`<audio>` 的 `play` 事件里再解一次静音；另有一个 4 秒定时器，只要队列里还有歌、且不是你自己按的暂停，就把它推回播放状态。

服务端**不会**去改你的系统音量——那是你自己的设置。操作台里留了手动按钮「🔊 修系统音量」（调到 60%），以及一个默认关闭的开关「每次开始放歌/念新一章时，自动把系统音量抬到 60%」（`audio.autoVolume`），需要时自己勾上。

想确认「到底有没有声音在往外送」，几个现成脚本（读页面要直播窗带 `--remote-debugging-port=9222` 启动）：

```bash
node tools/audio-live.mjs     # 读 #player / #voicePlayer 的 src、paused、muted、volume、currentTime、error
node tools/beep.mjs 1         # 直接在页面里放一声 880Hz 的「叮」，证明输出通道通不通
powershell -NoProfile -ExecutionPolicy Bypass -File tools\audio-peak.ps1     # 默认扬声器的实时峰值
powershell -NoProfile -ExecutionPolicy Bypass -File tools\audio-sessions.ps1 # 默认设备音量（0–1）与是否静音
powershell -NoProfile -ExecutionPolicy Bypass -File tools\audio-loud.ps1 0.6 # 用音量键把默认设备抬到 60%
```

> 为什么用 `audio-loud.ps1` 而不是 `audio-set.ps1`：这台机器的 USB 声卡（`扬声器 (AB13X USB Audio)`）接受 `SetMasterVolumeLevelScalar(0.6)` 后会被设备/APO 打回去，而音量键（`VK_VOLUME_UP`）走音频策略，实测能稳定停在 0.58。`audio-set.ps1` 保留作备用。

---

## 4.7 AI 撞上 503「服务太忙」怎么办

DeepSeek 高峰期偶尔会甩回来一句：

```
DeepSeek 503: Service is too busy. We advise users to temporarily switch to alternative LLM API service prov
```

这不是配置错了，是它那边排队。程序现在会**三层兜底**，尽量不让你听到「兜底稿」：

1. **退避重试**：同一个模型最多重试 3 次，间隔 1.2 秒 → 2.4 秒 → 4.8 秒（服务端给了 `retry-after` 就按它等）；
2. **换备用模型**：主模型还不行就换 `ai.fallbackModel`（默认 `deepseek-chat`）；
3. **换备用接口**：前两层都挂了，且你填过 `ai.backup`（地址 + Key + 模型名），就用另一家的接口顶上。

三层都失败才算真失败。真失败时：
- 开场 / 讲述这种长段**不会**拿大纲原地糊过去：会推一条「这一段先等 5 秒，自动重来一次」，5 秒后重来同一条（最多重来两次）；
- 两次都不行才用兜底稿把这 ~10 分钟填上，下一段继续照常走，直播不会停；
- 操作台 `① 基础设置` 的 DeepSeek 卡片下面会出现橙色的「上次 AI 没接上：…」，恢复后自动消失。

**在哪儿填**：`/admin → ① 基础设置` 多了三行——「备用模型」「备用接口（地址 + Key）」「备用模型名」；也可以直接改 `config.json`：

```json
"ai": {
  "model": "deepseek-flash",
  "fallbackModel": "deepseek-chat",
  "retryAttempts": 3,
  "backup": { "baseUrl": "", "apiKey": "", "model": "" }
}
```

> 备用接口留空就是「只重试 + 只换模型」，不花钱也不折腾。

**自测**：`node tools/fake-503.mjs 8899 flash-busy` 起一个假接口，把 `ai.baseUrl` 临时指到 `http://127.0.0.1:8899`，再去点「测一句话」——能看到它重试 3 次后自动切到 `deepseek-chat` 成功返回。`fake-503.mjs 8899 all-busy` 则是所有模型都忙，用来验证最终的报错文案。

---

## 5. 关于「我用的是抖音直播伴侣」

**结论：推流照旧用直播伴侣；弹幕不用从伴侣里想办法——本项目在 Node 进程里直连抖音的弹幕长连接。**

原因：直播伴侣是闭源桌面客户端，弹幕走它自己的私有长连接（protobuf + 签名），没有对外接口；开放平台只对报备过的「直播小玩法」开发者开放，个人拿不到。

**所以分工是这样：**

- 画面：直播伴侣照常推流，画面来源加「窗口/浏览器」选本页面；
- 弹幕/礼物：`/admin → 2 · 弹幕接入` 填直播间号，进程里直连抖音（见第 3 节方式 A），**不需要开网页**；
- 回话（可选）：想让大肥鱼的话出现在公屏，就再开一个 Chrome 打开自己的直播间，装 `extension`，它会把话打进输入框（见方式 B）。不回话也可以，弹幕照样能收、礼物照样道谢。

好处：整个链路只有 Node 一个进程，CPU 占用低，直播间里也看不到你在看。

**不推荐的两条路**：① 用 CDP 连直播伴侣的 Electron 内核去读 DOM（版本一更新就可能失效）；② 屏幕 OCR 认弹幕（昵称和礼物容易认错，延迟也大）。

---

## 6. OBS 怎么采

- **窗口采集**：OBS → 来源 → 窗口采集 → 选 Chrome 窗口（`大肥鱼 · 写故事直播间`），裁掉浏览器边框。
- **浏览器源**：URL 填 `http://127.0.0.1:8787/`，宽 1920 高 1080；宠物是 webm 动画，浏览器源能播。
- 页面是**流体布局**：铺满浏览器窗口，两边不留白，字号随窗口缩放（`clamp`）。OBS 画布按 1920×1080 开就行，窗口拉到多大它铺多大。
- **透明底叠加**：给页面加 `?bare=1`（`http://127.0.0.1:8787/?bare=1`），背景层淡出，卡片和字还在，适合叠到自己拍的画面上。

直播伴侣里同理：添加「窗口」或「浏览器」来源。

---

## 7. token 花费和余额怎么算

- 每次调用 DeepSeek 都记 `usage`（缓存命中输入 / 未命中输入 / 输出），按**官方现价 × 当前时段**算钱：
  - `deepseek-flash`：命中 ¥0.02/M、未命中 ¥1/M、输出 ¥4/M（空闲）；高峰 ¥0.04 / ¥2 / ¥8。
  - 高峰 = 周一至周五 9:00–12:00、14:00–18:00（北京时间）。
  - 单价在 `config.json → pricing`，官方调价改这里。
- 余额来自 `GET /user/balance`，进页面查一次，60 秒复用；操作台有「刷新余额」。
- 「今日收」= 礼物单价 × 数量（`config.json → gifts`）。
- 「白饭余额」= `riceBase + 今日收 × 0.1`，纯玩法数值。

---

## 8. 配置（`config.json`）

| 字段 | 说明 |
| --- | --- |
| `port` | 服务端口，默认 `8787` |
| `roomId` | 你的直播间号（只用于提示/日志） |
| `ai.apiKey` | DeepSeek Key（也可用环境变量 `DEEPSEEK_API_KEY`） |
| `ai.model` | `deepseek-flash`（便宜）或 `deepseek-v4-pro`（更会讲） |
| `ai.temperature` / `ai.maxTokens` | 说话风格 / 单句上限 |
| `ai.minReplyGapMs` / `ai.maxRepliesPerMinute` | 回弹幕的最小间隔 / 每分钟上限 |
| `ai.replyToGifts` | 收到礼物是否答谢 |
| `reply.auto` | `false` 时只显示弹幕、不自动回 |
| `novel.enabled` / `novel.auto` | 小说朗读开关 / 自动往下念 |
| `novel.dir` | 小说目录，默认 `短篇`（递归两层，按修改时间取最新） |
| `novel.breakSec` | 每章念完休息多少秒，默认 **300**（最小 30） |
| `novel.startAt` | 定时开讲时间，形如 `"20:30"`；留空 = 默认 **17:00**，填 `off` = 不定时 |
| `novel.autoStart` | 到点自动开讲（默认 `true`）；关掉就只提醒、等你手动开始 |
| `danmaku.mode` | `auto`（填了房间号就直连）/ `off`（只认扩展） |
| `danmaku.roomId` | 直播间号，启动时自动连（也可在 `/admin` 里填） |
| `danmaku.cookie` | 可选：自己抖音登录后的 Cookie，带上才收得到礼物推送（只存本地） |
| `music.provider` | 音源：`auto` / `local` / `netease` / `custom` |
| `music.dir` | 本地曲库目录，默认 `music`（文件名 `歌手 - 歌名.mp3`） |
| `music.volume` | 页面播放音量 0–1，默认 **0.2** |
| `music.queueMax` | 点歌队列最多排几首，默认 3（不含正在播的那首） |
| `music.apiBase` | 自建 NeteaseCloudMusicApi 地址，如 `http://127.0.0.1:3000` |
| `music.neteaseCookie` | 网易云会员 cookie（`MUSIC_U=…`），会员歌才放得出；不会回显到浏览器 |
| `audio.autoVolume` | 默认 `false`：不碰系统音量。勾上后每次放歌/念新章自动抬到 `audio.target` |
| `audio.target` | 自动抬音量时的目标值，默认 `0.6` |
| `voice.enabled` | 每段故事要不要出声朗读 |
| `voice.volume` | 大肥鱼音量 0–1，默认 **0.8** |
| `voice.rate` | 语速倍率 0.6–1.6（1 = 正常） |
| `voice.engine` | `minimax`（默认）/ `edge`（在线）/ `kokoro`（本地）/ `sapi`（系统离线） |
| `voice.preset` | minimax：`lyrical`；edge：`natural` `warm` `leng` `diyin` `xiaoxiao`；kokoro：`xiaobei` `xiaoni` `xiaoxiao` `xiaoyi` |
| `voice.minimaxVoice` | MiniMax 云端音色 ID，默认 `Chinese (Mandarin)_Lyrical_Voice` |
| `voice.minimaxModel` | MiniMax 模型，默认 `speech-2.8-hd` |
| `voice.minimaxEmotion` | MiniMax 情绪，默认 `calm` |
| `voice.minimaxBaseUrl` | MiniMax 接口地址；也可用 `MINIMAX_BASE_URL` 覆盖 |
| `MINIMAX_API_KEY` | MiniMax API Key，环境变量优先；历史 `voice.minimaxApiKey` 只作兼容兜底且不会下发 |
| `voice.duck` | 说话时 BGM 压到多少，`1` = 不压（默认，音乐和讲述同时响） |
| `voice.voice` | sapi 用的音色名，默认 `Microsoft Huihui Desktop` |
| `salaryTarget` / `riceBase` | 工资条分母 / 白饭初始碗数 |
| `gifts` | 礼物表：`name` / `emoji` / `price`（元/个），顺序即图鉴顺序 |

`/admin` 里的「② 小说朗读」：选目录、改休息秒数、挑一本、开始/下一章/停下/从头再来；下面还有「观众选题」票池和自动生成的「作品档案」。

---

## 9. 目录

```
server.mjs            HTTP + SSE、回复队列、计费、点歌、小说朗读调度
start.cmd             起服务（第一次自动 npm install）
打开直播间.cmd        打开带声音的直播窗口（app 模式 + 放行自动播放）
重启页面.cmd          改完代码后一键：重启服务 + 刷新直播窗（保队列）+ 刷新操作台
lib/config.mjs        配置读写（隐藏 apiKey 再下发）
lib/story.mjs         60 分钟排期、分阶段提示词、本段总结、观众建议
lib/cortico.mjs       弹幕直连：房间解析 + 长连接桥（进程内，不用浏览器）
lib/music.mjs         点歌音源：本地曲库 + 网易云外链 + 自建源解析、Range 流
lib/voice.mjs         大肥鱼的声音：edge-tts / 本地 Kokoro / System.Speech 离线，本地缓存
tts-kokoro/           本地音色：ONNX 模型 + 中文音色（say.py 调用）
vendor/douyin-danma/  抖音弹幕协议实现（来自 cortico-world-douyin-live，GPL-3.0）
voice-src/            想训练 RVC 音色时，把 10 分钟人声素材放这里
.voice-skill/         音色训练参考文档（README / AI执行手册 / SKILL.md）
lib/store.mjs         今日统计、礼物图鉴、点歌队列、累计 token、落盘
lib/pricing.mjs       峰谷价 + 按 usage 算钱
lib/ai.mjs            DeepSeek chat/completions、/user/balance
lib/persona.mjs       大肥鱼人设、上下文拼装、点歌/切歌话术
public/index.html     直播画面（七区流体布局）
public/app.css        透明蓝玻璃样式（铺满窗口，字号 clamp）
public/app.js         SSE 渲染、打字机、宠物动作、分段语音、礼物 toast
public/admin.html     操作台（基础设置 / 故事电台 / 数据看板三块）
public/assets/pet/    宠物动画（VP9 alpha webm，来自 dsh-pet，MIT）
extension/            Chrome MV3 弹幕桥（抓取 + 回写）
tools/shot.mjs        CDP 截图
tools/restart-pages.mjs 重启服务并刷新直播窗/操作台（--server / --fresh）
tools/demo.mjs        灌演示数据
tools/preview.mjs     造一组「像真直播」的弹幕和礼物
tools/danma-test.mjs  命令行直连测试（node tools/danma-test.mjs <房间号>）
tools/audio-check.mjs 无头 Chrome 里检查 <audio> 有没有真的在放
tools/autoplay-check.mjs 检查「打开就出声」和「音乐讲解同时响」
tools/ext-test.mjs    扩展链路自测（不需要真直播间）
music/                本地曲库（自己往里放 mp3，文件名「歌手 - 歌名.mp3」）
短篇/                 小说放这里（每天自动化写作产出的 .txt/.md）
data/                 每日统计 + 故事进度 / 语音缓存（自动生成）
```

---

## 10. 接口（想接别的脚本时用）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/state` | 全量：配置摘要、今日统计、余额、弹幕、礼物、队列、故事 |
| GET | `/api/events` | SSE：`event` / `stats` / `balance` / `song` / `story` / `config` |
| POST | `/api/event` | `{kind:'chat'\|'gift'\|'enter'\|'follow'\|'like', username, text?, giftName?, count?}` |
| GET | `/api/outbox` | 待发回直播间的回复 |
| POST | `/api/outbox/ack` | `{ids:[...], ok:true}` 标记已发 |
| POST | `/api/say` | 以主播身份手动说一句（进 outbox） |
| POST | `/api/ai/reply` | `{text}` 让 AI 回一句 |
| POST | `/api/ai/test` | 测 Key |
| GET/POST | `/api/config` | 读 / 改配置（白名单字段） |
| GET | `/api/balance?force=1` | 查余额 |
| POST | `/api/song/next` | 切歌 |
| GET | `/api/story` | 这一场到哪儿了（阶段/倒计时/正文/总结/建议） |
| POST | `/api/story/start` | 开始这一场 |
| POST | `/api/story/next` | 立刻讲下一条（到点的那条） |
- `/api/novel`、`/api/novel/list|start|stop|advance|next|auto|reset|config|audio|archive|topics`
| POST | `/api/story/stop` | 停下 |
| POST | `/api/story/auto` | `{auto:true\|false}` 自动往下讲 |
| POST | `/api/story/reset` | 从头再来 |
| GET | `/api/danmaku` | 弹幕直连状态（state/房间号/标题/已收条数/错误） |
| POST | `/api/danmaku/connect` | `{roomId}` 连上直播间（链接或数字都行） |
| POST | `/api/danmaku/disconnect` | 断开直连 |
| GET | `/api/music` | 音源状态 + 本地曲库列表 |
| POST | `/api/music/reindex` | 重新扫描本地曲库 |
| POST | `/api/music/resolve` | 重新解析当前这首的音源 |
| POST | `/api/music/play` | `{title, by}` 手动切一首 |
| POST | `/api/music/ended` | 播完回调（页面自动调用） |
| GET | `/api/music/search?q=` | 搜音源（本地 + 网易云） |
| GET | `/api/music/stream/:id` | 本地音频流（支持 Range） |
| GET | `/api/voice` | 声音设置：开关 / 音量 / 语速 / 音色 / 可用音色列表 |
| POST | `/api/voice/say` | `{text}` 合成一段台词，返回 `/api/voice/<hash>.mp3` 或 `.wav` |
| POST | `/api/voice/test` | 合成一句固定试听台词 |
| GET | `/api/voice/:file` | 台词 mp3/wav（支持 Range，带缓存） |
| POST | `/api/story/config` | 保存故事设定（标题/大纲/时间/五段）并重讲 |
| POST | `/api/reset` | 清空今日数据 |

---

## 11. 常见问题

**故事不动**：`/admin` 顶部看「服务已连接」；故事面板里看阶段和「下一条」；`story.auto` 关掉时要手动「讲下一段」。

**讲完这一场就停了**：正常——收束后不会自动重播，点「开始这一场」再讲一次。

**页面显示「未绑定」余额**：没填 Key 或 Key 无效，去 `/admin` 保存后点「刷新余额」。

**扩展装了但一条弹幕都没有**：①直播间页面要**刷新**一次；②地址要是 `live.douyin.com/...` 具体直播间；③点扩展图标看「已上报」是否在涨；④确认 `http://127.0.0.1:8787/api/health` 能打开。

**直连一直 `waiting`**：说明这个房间号当前没开播（或者号填错了）。开播后半分钟内会自己连上；`/admin → 2 · 弹幕接入` 会显示「没开播，15 秒后再看」。

**直连报错 `invalid/decode/gzip`**：通常只是个别帧解不开，程序会自动忽略；如果一直 `error`，多半是抖音改了协议——换 `vendor/douyin-danma` 目录（来自 cortico-world-douyin-live 的最新版）即可。

**大肥鱼回复了但公屏没出现**：`/admin` 的「发送箱」会显示 `pending`，说明扩展没在直播间页面跑，或找不到输入框（`lastError` 写原因）。

**宠物不动**：浏览器禁了自动播放，点一下页面即可。

**点了歌但没声音**：①点一下 ▶（浏览器自动播放限制）；②看歌名右边标签：`无源` = 没解析到，去 `/admin → 4 · 声音（音乐 · 大肥鱼）` 搜一首；`播放失败` = 外链过期，点 ▶ 会重新解析；③本机放 `music/` 里的 mp3 最稳，外链随时可能失效。

**大肥鱼的嘴在动但没声音**：①`/admin → 4 · 声音` 看「讲每段时出声」有没有勾上、音量是不是 0；②点「试听」验证系统 TTS（没装中文语音包会失败，见 4.6 里的 PowerShell 列表）；③浏览器自动播放限制——页面上点一下 ▶。

**第二天数据清零了**：按北京时间 0 点换天，礼物图鉴和累计 token 保留。

**换电脑**：整个文件夹拷过去，`node server.mjs` 即可。

---

## 12. 关于训练「御姐音」（RVC 克隆）

现在用的御姐音是 **edge-tts 调音**（降音高 + 放慢），不需要训练、不占显存，开箱就是御姐味。如果你想要**克隆某个具体的人声**（比如你自己的声音、或某个买了授权的配音），那才需要 RVC 训练。

**参考项目**：[`zabuxie/vc-voice-train-skill`](https://github.com/zabuxie/vc-voice-train-skill)（方法+脚本，不含模型和素材）。它的两条路线：

| 路线 | 最低显存 | 环境 | 素材 |
| --- | --- | --- | --- |
| RVC 训练（克隆音色） | 32k ≥8GB / 40k ≥12GB | 捆绑 Python 3.9 + 约 10GB 包 | 5–10 分钟干净人声 |
| IndexTTS 零样本 | ≥6GB | Python 3.10–3.11 + 约 20GB | 一段 10 秒参考音 |

**本机为什么没直接上**（如实说）：
- 显卡是 RTX 3060 Laptop **6GB**，低于 RVC 32k 的 8GB 门槛；
- 装的是 `torch 2.11.0+cpu`，`torch.cuda.is_available()` 为 `False`，要训练得先换 CUDA 版轮子（约 2.5GB）；
- RVC 包与模型在 huggingface 上（约 10GB），本机当前网络访问 huggingface 超时；
- 手上没有 10 分钟的**授权**人声素材。

**以后要做，按这个顺序**：
1. 准备素材：一段 10 分钟左右、无背景音乐、无混响的人声，切成 3–10 秒的小段，放到 `voice-src/`；
2. 装 CUDA 版 PyTorch（`pip install torch --index-url https://download.pytorch.org/whl/cu121`）；
3. 按 `vc-voice-train-skill` 的 `AI执行手册.md` 装 RVC 包、`batch_size` 调小到 2–4（6GB 显存）；
4. 训练出 `.pth` + `.index`，用 RVC 的推理接口把 edge-tts 的音频转成目标音色，再把 `lib/voice.mjs` 的 `synthesizeEdge` 后面接一层转换即可。

> 参考文档已放在 `.voice-skill/`（README、AI执行手册、SKILL.md）；试听样例在 `.voice-skill/samples/`。

> 现在默认用的是 **edge 的「温柔 · 晓晓」**（见 4.6），音色比系统语音自然一大截；想要更厚的声音就在操作台切「本地 · 小北」（Kokoro）。RVC 克隆是「让声音变成某个具体的人」时才需要的一步。

---

## 致谢

- 宠物动画来自 [dsh-pet](https://github.com/)（MIT，保留署名）。
- 弹幕直连的协议实现来自 [cortico-world-douyin-live](https://github.com/) 的 `vendor/douyin-danma`（GPL-3.0-or-later，按其协议保留原样）。
- DeepSeek 价格以 <https://api-docs.deepseek.com/zh-cn/quick_start/pricing> 为准。
