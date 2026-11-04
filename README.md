# 御姐大肥鱼电台

抖音 AI 虚拟主播直播间：**深夜电台 + 树洞陪聊**。观众发弹幕，大肥鱼用语音回，边写边说；
有话题墙、进场欢迎、每 5–8 分钟的新人提醒、冷场时自己说一段；问到时事、天气、冷知识会联网查。
主播是网页里的分层角色，口型跟着声音实时变化。

> 仓库里还留着原来的「读小说直播间」模式（`mode: "novel"`），说明见 [docs/README-novel.md](docs/README-novel.md)。

---

## 1. 三步跑起来

需要 **Node.js 18+**，Windows / macOS / Linux 都行（系统语音、音量脚本这类功能只有 Windows 有）。

```bat
:: 1) 装依赖
npm install

:: 2) 复制一份配置，Key 和房间号后面在操作台里填
copy config.example.json config.json

:: 3) 启动（默认 8787 端口）
node server.mjs
```

然后打开：

| 地址 | 用途 |
| --- | --- |
| <http://127.0.0.1:8787/> | 直播画面（竖屏 1080×1920，给 OBS 采集） |
| <http://127.0.0.1:8787/admin> | 操作台：Key、代理、声音、话题、接管 |

不填任何 Key 也能启动，但大肥鱼不会自己说话（电台要靠 DeepSeek 生成、Fish 合成）。

## 2. 要填的东西

打开操作台，按顺序填三样，每样都有「保存」和可点的验证按钮：

1. **DeepSeek Key**（① 基础设置最上面）——弹幕回复、选话题、章节小结都靠它。
2. **Fish Audio Key**（① 基础设置 → 声音 · 大肥鱼）——语音合成。Key 在 <https://fish.audio/app/api-keys> 生成。
3. **直播间号**（① 基础设置 → 弹幕接入）——填 `live.douyin.com/` 后面那串数字，点「连上」。没填也能用操作台的「造一条弹幕」测试。

填完回「电台」分区，点「让大肥鱼说这句」试一句；能出声、画面有口型就通了。

### Fish 连不上怎么办

Fish 的服务器在海外，部分网络直连会超时（报 `ETIMEDOUT`）。操作台 →「声音 · 大肥鱼 → Fish 代理」三种选法：

| 选项 | 说明 |
| --- | --- |
| 跟随系统代理 / 环境变量（默认） | 读 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`，再读 Windows 系统代理，每 60 秒重读一次 |
| 手动填写 | `http://`、`https://`、`socks5://`、`socks5h://`、`socks4://`，可带 `用户名:密码@`，例如 `socks5://127.0.0.1:1080` |
| 直连 | 本机能直接访问 Fish 时用 |

改完点「测试连接」，它只请求 Fish 的公开音色列表，不花额度。正常会显示「连上了：… · 3200ms · HTTP 200」。

### 想换音色

- **音色下拉框**：四个 Fish 中文女声预设（温柔叙事、嘉岚、温柔动听、活力女声）；
- **自定义音色 ID**：填 <https://fish.audio> 音色页地址里的 32 位编号，可以是你自己克隆的音色；
- **模型**：默认 `s2.1-pro-free`（免费额度），想用付费档换 `s2.1-pro`。

其他引擎（`edge` 微软在线音色、`minimax`、`kokoro` 本地、`sapi` 系统离线）在同一个下拉框里，适合没有 Fish Key 时先跑通流程。注意只有 Fish 支持「边写边说」的双向流。

## 3. 电台怎么运转

同一时间只说一段。上一段快念完时，把这段时间攒下的弹幕一次交给 AI：只有一条就单独回，多条就挑 1–3 条一段话回完。

| 环节 | 触发 | 多久一次 |
| --- | --- | --- |
| 回复弹幕 | 有弹幕 | 上一段念完立刻 |
| 进场欢迎 | 有人进直播间 | 最多 30 秒一次 |
| 新人提醒「刚进来的朋友，我们在聊…」 | 定时 | 5–8 分钟随机 |
| 换话题 | 到点 / 话题墙有人投票 / 跨时段 | 10 分钟（`radio.topicMin`） |
| 冷场独白 | 没人说话 | 45 秒后（`radio.idleSec`），有观众时才说 |
| 礼物道谢 | 收到礼物 | 立刻，只道谢，不给特权 |
| 联网搜索 | 模型判断该查 | 每小时最多 30 次 |

**时段感知**：北京时间八个时段（清晨 5–8 / 上午 8–11 / 中午 11–14 / 下午 14–17 / 傍晚 17–20 / 晚上 20–23 / 深夜 23–2 / 凌晨 2–5），每个时段有各自的语气、话题方向、页面色调；跨时段时会先打个招呼再换话题。代码在 [lib/timeslot.mjs](lib/timeslot.mjs)。

**话题**：观众发「话题 猫和狗谁更粘人」就上墙投票，票最多的下轮就聊；操作台「电台 → 话题」可以手动设，或点「换下一个话题」。

## 4. 操作台「电台」分区

- **危机提醒**：弹幕里出现伤害自己的念头时，红卡会跳出来，带昵称和原话。大肥鱼同时会说一段固定的安抚话术并给热线号码。点「已处理」消掉。
- **真人接管**：暂停 AI 自动说话。抖音要求虚拟人直播由真人驱动，**开播时请一直有人值守**，随时能接管。
- **静音当前这句**：正在念的话立刻停。
- **让大肥鱼说这句**：以她的声音念你写的字（同样过敏感词）。
- **节奏与搜索**：话题间隔、新人提醒间隔、冷场阈值、是否允许联网搜索、每小时搜索上限、页面上要不要显示弹幕列表。
- **安全**：自定义敏感词（一行一个，内置词表在 [lib/guard.mjs](lib/guard.mjs)）、心理援助热线号码。

⚠️ 热线默认 `12356`，**开播前请自己核实**号码在你所在地区是否可用。

## 5. 配置（`config.json`）

顶层的 `mode`：`radio`（默认，竖屏电台页）或 `novel`（旧的小说朗读页）。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `radio.topicMin` | 10 | 每个话题聊多少分钟 |
| `radio.newcomerMinMin` / `newcomerMaxMin` | 5 / 8 | 「刚进来的朋友」提醒的间隔范围（分钟） |
| `radio.idleSec` | 45 | 多少秒没弹幕就说一段独白 |
| `radio.idleWhenEmpty` | false | 没观众时也自言自语（会花 token） |
| `radio.search` | true | 允许联网搜索 |
| `radio.searchPerHour` | 30 | 每小时搜索上限 |
| `radio.paused` | false | 真人接管中 |
| `radio.blockWords` | `[]` | 自己追加的敏感词 |
| `radio.crisisHotline` | `12356` | 危机安抚时报的号码 |
| `radio.showFeed` | false | 竖屏页要不要显示弹幕列表 |
| `voice.engine` | fish | `fish` / `edge` / `minimax` / `kokoro` / `sapi` |
| `voice.fishModel` | `s2.1-pro-free` | Fish 模型 |
| `voice.fishVoice` | 空 | Fish 音色 ID，留空用预设 |
| `voice.fishProxyMode` / `fishProxy` | system / 空 | Fish 的代理设置 |
| `voice.fishStream` | true | 双向流（边合成边播）；关掉就整段合成完再播 |
| `voice.volume` | 0.9 | 大肥鱼音量 |
| `music.provider` | local | 点歌音源：`local` / `netease` / `custom` |

`config.json` 已进 `.gitignore`，Key 只存本机。

## 6. 画面与 OBS

- 画面是竖屏 **1080×1920**，OBS 里新建场景按这个比例，加「浏览器源」填 <http://127.0.0.1:8787/?auto=1>。
- `?auto=1` 会跳过浏览器的自动播放限制，打开就出声。想在桌面上看，双击 `打开直播间.cmd`（需要装 Chrome），它开一个无地址栏的窗口、放行自动播放。
- 抖音手机端会盖住画面顶部约 11%、底部约 30%、右侧约 9%，页面上的关键内容都避开了这些位置。
- 页面上常驻「AI 虚拟主播 · 内容由 AI 生成」标识。

**主播是分层角色**：背景、人物、前景（话筒和桌面）三层，嘴和眼睛是几套帧，按语音音量实时切口型，还会眨眼、呼吸、说话点头、查资料时左右张望。素材在 `public/assets/radio/rig/`，说明见 `rig.json`。想换形象：

```powershell
# 换掉 public/assets/radio/host.png，再重新切图（需要 Python + rembg）
python -m pip install rembg onnxruntime pillow numpy scipy
python tools/rig/build.py
```

素材没有生成好时会自动退回静态图，不会白屏。

## 7. 弹幕与回话

- **收弹幕**：操作台 ① 基础设置 → 弹幕接入，填直播间号，进程内直连抖音（只读，不用开浏览器）。
- **收到礼物**：抖音只把礼物推给登录态观众。想收礼物，把电脑浏览器登录 `live.douyin.com` 后的 Cookie 粘贴到同一个「弹幕接入」里的抖音 Cookie 输入框。
- **往公屏回话**：需要一个 Chrome 扩展把字打进直播间输入框，见 [extension/](extension/) 和 [docs/README-novel.md](docs/README-novel.md) 的方式 B。不回话也行，观众在直播间里照样听得见。
- **点歌**：把 mp3 放进 `music/`（文件名「歌手 - 歌名.mp3」），观众发「点歌 歌名」。只用自己合法持有的音频最稳。

## 8. 花钱的地方

| 项目 | 单价 | 备注 |
| --- | --- | --- |
| DeepSeek 对话 | 按 token | 一次弹幕回复约 1000–3500 输入 token |
| DeepSeek 搜索 | 约 ¥5 / 1000 次成功请求 | 失败和没结果不计费；有 10 分钟缓存和每小时上限 |
| Fish 语音 | `s2.1-pro-free` 免费额度 | 付费档按字节计费；同一句话合成过会走本地缓存 |

操作台「③ 数据看板」能看到今天花了多少、回复了多少条。

## 9. 目录

```
server.mjs              HTTP + SSE，接口和页面
lib/radio.mjs           电台编排：节拍、话题、欢迎、冷场、边写边说
lib/radio-persona.mjs   人设、边界、各环节的指令和固定台词
lib/timeslot.mjs        时段划分（八个时段）
lib/llm-stream.mjs      DeepSeek 流式 + 工具调用
lib/search.mjs          DeepSeek 搜索（带缓存和限流）
lib/fish-stream.mjs     Fish 双向流（WebSocket + MessagePack）
lib/voice.mjs           语音合成：fish / edge / minimax / kokoro / sapi
lib/guard.mjs           敏感词三道闸 + 危机识别
lib/proxy.mjs           http / socks 代理
public/radio.html|css|js  竖屏直播页（分层角色、双色字幕、话题墙）
public/admin.*          操作台
public/assets/radio/    主播形象与 rig 素材
tools/rig/              rig 构建脚本（切图、画嘴和眼）
tools/mock-radio.mjs    不连后端也能看的演示页（假 SSE）
tools/fake-fish.mjs     本地假 Fish 服务，离线自测语音链路
docs/radio-design.md    接口约定（SSE 事件、RadioView、HTTP 路由）
docs/README-novel.md    旧的小说朗读模式说明
```

自己用的时候常开两个窗口：直播画面（OBS 采）和操作台。

## 10. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| `ETIMEDOUT`、`Fish 连接失败` | 网络到不了 Fish，见上面「Fish 连不上怎么办」，填代理后点「测试连接」 |
| 试听没声音、页面上也没声音 | 浏览器拦了自动播放：用 `?auto=1` 或 `打开直播间.cmd`；或点页面上的「🔊 点一下，开启声音」 |
| 有字没声 | 检查「讲每段时出声」有没有开、音量是不是 0；操作台点「让大肥鱼说这句」看报错 |
| 大肥鱼不说话 | 看操作台「电台」状态里的 `lastError`；是不是点了「真人接管」；DeepSeek Key 是否有效 |
| 搜索很慢或没搜到 | 搜索走 DeepSeek 官方接口，问「明天天气」这类预报经常查不到准数；每小时上限也有限 |
| 角色只有静态图、嘴不动 | `public/assets/radio/rig/rig.json` 没加载到（看控制台），或浏览器不支持 Web Audio |
| 换了素材但页面没变 | 页面和脚本带版本号，`radio.html` 里改 `?v=` 再刷新 |
| 到了新时段话题没换 | 跨时段只在没人投票、有观众在场时才自动换；也可以在操作台手动「换下一个话题」 |

## 11. 合规提醒

- 画面上常驻「AI 虚拟主播 · 内容由 AI 生成」标识，别删。
- 抖音要求虚拟人直播**由真人驱动、开播期间有人值守**，并且不能是纯录播/挂机。操作台的接管和静音按钮就是为这个准备的。
- 不诱导打赏：礼物只道谢，不给特权、不按礼物插队。
- 有人流露出想伤害自己时，走固定安抚话术并通知值守的人，必要时建议联系专业帮助。热线号码请自己核实。
- 只用自己有权使用的音乐和文字素材。

## 12. 致谢与许可

- 抖音弹幕协议实现来自 [cortico-world-douyin-live](https://github.com/newbeejmc/Dsh_douyin) 的 `vendor/douyin-danma`（GPL-3.0-or-later，按其协议保留原样）。
- 主播形象由 AI 生成（gpt-image-2.5），口型与眼睛帧由 `tools/rig/` 的 Python 脚本绘制。
- 上游项目：<https://github.com/newbeejmc/Dsh_douyin>
