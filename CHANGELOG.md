# 鸿汇影 · 变更日志

版本号与 #code 以 `server/manifest.json` 的 `release.latest` 为唯一真相源，`scripts/version.js --check` 核对 16 处一致性。

## 补记：1.7.95 – 1.7.112（2026-11-27 追溯补录）

本段为事后补录。1.7.95 起发布时未写入本文件，2026-11-27 依据桌面归档（`桌面\鸿汇影·历史归档`）与当前五夹/私发夹的说明文件回溯整理。

三条口径：
1. **不编内容**：归档目录与说明文件都不存在的版本，只记「无留存」，不写功能描述。
2. **构建号**：已由说明文件证实的标注「证实」，其余按 1.7.94 = #1000208 逐版 +1 推算，标「推算」。
3. **日期**取归档目录时间，非发布日原文；无目录者不写日期。

## 1.7.112 / #1000226（推算）— 2026-11-27

- **无逐版变更记录**：本版只在桌面五夹与私发夹留交付说明，未见变更文件。
- 可核实事实：私发免安装 zip 145,969,036 B / `8a44bd93…`；HAP 2,449,138 B / `6fe5aee1…`。该 HAP 为 official 链自签（bundle `com.honghub.harmony`），在 KaihongOS 设备上会被系统拒绝启动；真机安装用备机验证夹的 `com.kaihong.movie` 原生包（开鸿平台证书）。

## 1.7.108 – 1.7.111 / #1000222–#1000225（推算）

- **无留存**：归档目录与说明文件均不存在。无法确认这四版是出过包后被清理，还是未出包，因此不写功能内容。

## 1.7.107 / #1000221（推算）— 2026-11-24

- **匿名诊断上报默认开启**（客户纯净版与设备端）：装机即回收，只外发脱敏摘要（错误码 / 次数 / 站点域名 / 匿名设备号），不含账号、片源与完整 URL；问题中心开关即停发并持久化；没有预置地址时不盲发；隐私文案与预检门禁同步改口径。
- **真窗口冒烟门禁**：新增 `scripts/smoke-desktop.js`，解压客户免安装包 → 经 `Start-Process` 真启 Electron（走完整 preload）→ CDP 断言正文非空 / 核心函数已加载 / 上报地址已预置 / 无 Uncaught，纳入 `verify-release.js` 第 6 步。补上 1.7.104 白屏事故的检测盲区；本机 x64，冒烟只取 x64 包。
- **镜像站守护加固**：`watchdog.ps1` 加单实例锁（两份守护互杀会打出 Cloudflare 429 死循环）+ 429 退避 600s；`修复DNS并启动.cmd` 同时换 IPv6 DNS（路由器 fe80::1 会把 argotunnel.com 解析成 NXDOMAIN 致隧道 530，只改 IPv4 无效）。

## 1.7.106 / #1000220（证实）— 2026-11-23

- **白屏修复（P0）**：preload 桥 `khDeviceId` 改名 `khDeviceIdBridge`。旧名与 `kh-core.js` 顶层函数相撞，contextBridge 属性不可配置 → `kh-core.js` 整脚本不执行 → 1.7.104/105 客户版窗口白屏。
- **客户版上报**：清单 `remoteUrl` 不再被 `KH_UI_CLEAN` 挡掉；「远程收集」卡对客户版渲染（默认关闭）；出包链新增 `scripts/inject-report-url.js`，把隧道地址写进页面内嵌 `kh-sources` 基线（客户版启动读基线，不是云端清单）。
- 设置页 `KH_SHOT_LOG` 裸访问加类型守卫，消掉一条 Uncaught TypeError。

## 1.7.105 / #1000219（推算）— 2026-11-24

- 中枢地址双键（`kh_hub_url` + `khHub`）持久化、设置页显示「当前生效」地址；免安装包 exe 属性补全。
- 本版说明文件与 104 复用同一「这版新增」段，差异以 106 说明的承接段为准。

## 1.7.104 / #1000218（推算）— 2026-11-24

- 主进程 `kh:lan-mode`（get/set）：默认只绑 `127.0.0.1`，开启后 spawn 带 `KH_HOST=0.0.0.0`，`server.js` 自动要求访问口令；开关落 `userData/lan-mode.json`，切换重启服务并重载页面。
- `preload` 暴露 `window.khLanMode { get, set }`（纯网页 / HAP 为 undefined）。
- 播放失败日志 `khPlayLog(code, reason, video)` 写 `kh_play_log`（上限 60、同因 5 秒去重），字段含 at / code / reason / src / hls / watchdog / online，问题中心可查看与复制。
- 检查更新 `khUpdateCheck()` 读 `/health` 的 `release.versionName` 与当前版本比对，结果存 `kh_update_check`。

## 1.7.103 / #1000217（推算）— 2026-11-24

- **无留存变更记录**：说明文件未含「相对上一版」段。

## 1.7.102 / #1000216（推算）— 2026-11-24

- **无留存变更记录**：同上。

## 1.7.101 / #1000215（证实）— 2026-11-24

- **桌面端逻辑代码未改**：`electron-main` / `kh-core` / `kh-app` / `kh-admin` 均为 1.7.97 原样；本版进 exe 的是前端与清单增量。
- `app/index.html` 播放失败红条带 `video.error.code`（1 中断 / 2 网络 / 3 解码 / 4 源不支持），并附 `readyState` / `networkState`；SOURCE 元素回溯到父 video。
- `kh-release` 内联清单 `minApi` 12 → 11，与 HAP 包内 `minAPIVersion` 对齐；`server/manifest.json` 的 minApi / KaihongOS apiMin / OpenHarmony apiMin 三处同步改 11。
- 401 自动重试是 ArkTS 侧（`BrowserPage.ets`）改动，只在 HAP 里，Windows 端没有。
- **客户版裁剪口径纠偏**（以此为准）：剥 14 个运维页 `*-admin.html`（159,532 B）、主进程 `CLIENT_ONLY=true`、`/admin` 死链清空；`server` 业务模块保留（38 个 js）。旧说明里「物理裁掉 server 目录」那句是错的。

## 1.7.98–1.7.100 / #1000212–#1000214（推算）

- **无留存**：归档目录与说明文件均不存在，不写功能内容。

## 1.7.95–1.7.97 / #1000209–#1000211（推算；开发端 #1000309 与 #1000311 证实）— 2026-11-24

- **无逐版变更记录**：三版开发端说明文件是同一模板（同一批新增代码文件、同一份 406 项单测说明），未区分版本差异，故不拆条。
- 可核实事实：该批新增 `kh-guard.js`（平台入口域名守卫，三态 ok/ask/bad + 信任表上限 30）、`kh-tv.js`（电视形态 + 遥控返回/菜单键 + 焦点环）、`kh-hant.js`（简→繁显示层）、`kh-account.js`（设备码账号 / 云同步 / 跨端续播 / 手机遥控轮询）、`client-auto-update.js`（客户版静默升级四档 + SHA256 + 失败退避）、`server/account-sync.js`（账号与遥控队列）。
- 单测：guard 31 · auto-update 35 · hant 24 · tv 23 · account(server) 29 · account(client) 20，加既有回归 pref 63 · p2 93 · b8 88，合计 406 项全绿。

## 1.7.94 / #1000208 — 2026-11-23

本轮把「鸿汇影双端」清单里剩下的 14 项（3 项部分已有 + 11 项待做）一次性做完，清单 67/3/11 → 81/0/0。
分成四批：服务端远端配置中心 → 客户端远端配置与跨进程一致 → 配置总览 / 二维码 / 皮肤包 → 家庭档案 / 元数据 / 字幕站与 Key / 网络族。

### 批 1 服务端远端配置中心（#69 公告位 · #70 锁定项 · #71 默认值下发 · #77 灰度开关 · #66 云同步）

- 新增 `server/config-center.js`：一份 `server/data/config-center.json` 统管五件事，每次写入 `rev++`。
  公告带起止时间与优先级；锁定项按「键名 + 原因」置灰；默认值只在客户端缺该键时下发；
  灰度按 `FNV-1a(device|id) % 100` 分桶，版本区间用 `10000/100/1` 加权比较，同一设备同一开关结果稳定。
- 云同步 `syncPush/syncPull`：只收 `kh_` 前缀键；禁用词（url/site/src/link/addr/host/exe/path/dir/file/args/token/pass/pwd/pin/secret/key 等）
  与 http(s) 值直接拒收，对象串超过 4096 字符拒收；pull 只取「不是自己那台」且最近更新的一条。
- `server/server.js` 新增 7 条 config/sync 路由 + `/admin/config-center` 页面（暗色四卡表单）与导航「🎛 远端配置」。

### 批 2 客户端远端配置 + 存储载体 + 跨进程一致（#72 · #75 · #70 · #77 的客户端侧）

- 新增 `app/kh-remote.js`（UMD）：容错归一远端视图、公告有效期判定、锁定命中、离线灰度求值（与服务端同算法）。
- `kh-core.js` 远端块：拉取 / 应用 / 顶部公告条 `#khNoticeBar` / 锁定置灰 `🔒` / 存储载体信息 / 云同步推拉；
  远端 `rev` 比本机旧时不覆盖本机较新视图；启动 8 秒后拉一次，之后每 6 小时轮询，中枢不可达就保持本机缓存、不弹错。
- 设置页新增「远端配置与云端」面板：rev、锁定数、灰度数、公告状态、云同步开关、推送 / 拉取、结果行 `#rOut`。
- #75 跨进程一致：`electron-main.js` 的 `b8Write()` 写完向所有窗口广播 `kh:b8-changed`，`preload.js` 暴露 `khB8.onChanged`，
  客户端 `khB8Watch()` 收到后写回本机存储并重绘（不回推，避免两个窗口互相触发）。

### 批 3 配置总览 / 二维码短链 / 皮肤包（#63 · #65 · #78）

- `KH_CFG_REG` 38 键分 7 组（播放 11 / 界面 10 / 通知与启动 7 / 儿童 3 / 网络 3 / 数据 2 / 远端与云端 2），
  设置页「配置总览（38 项）」支持搜索 `#cfgQ`、单键改、单键 ↺、单组恢复默认、全部恢复默认（写回默认值而不删键，保住封条口径）。
- 新增 `app/kh-qr.js` 本地二维码编码器（版本 1–10、纠错 M、字节模式 UTF-8、8 掩码择优），不依赖任何第三方包。
- 新增 `app/kh-theme.js` 皮肤包：只认 8 个白名单 CSS 变量、值只接受 `#hex` / `rgb()`，禁 `url()` / `expression()` / `var()` / 分号拼接；
  上限 8 包，内置 `built-neon` / `built-jade` / `built-ember` 三个样例；面板可粘贴导入、从 URL 下载、打开主题目录。
- 新增 `server/shares.js`：7 位短码、TTL 180 天、容量 500，只收 http(s) 公网地址或 `#` 应用内路由，拦内网 / 本地地址；
  `POST /api/share` 建短链，`GET /s/<code>` 302 跳转。客户端分享面板出短链 + 二维码，建链失败退回原链接，只做扫码 / 复制，不跳系统浏览器。

### 批 4 家庭多档案 / 元数据与海报来源 / 字幕站与 AI Key / 网络族（#58 · #59 · #60 · #37）

- `app/kh-family.js` + `khProf*` 十函数：最多 4 个档案，切换时把 10 个键（收藏 / 稍后 / 历史 / 进度 / 片单 / 片单元数据 / 直播收藏 / 儿童开关 / 儿童 PIN / 儿童时长）
  快照换挡，**不新增也不改任何既有存储键**，旧逻辑零改动；缺键写回各自默认值而不是删除，避免被判定为「存储损坏」。
  改名用行内输入框（Electron 渲染进程没有 `window.prompt`）。
- `app/kh-meta.js`：元数据来源 builtin / tmdb / douban / custom，自定义模板必须含 `{title}`，海报只认 http(s)，评分 0–10，
  缓存按时间淘汰上限 50；字幕站只留 http(s) 上限 10 个，走应用内 WebView；AI Key 至少 8 位、界面只露后 4 位；
  自定义 DNS 支持 IPv4 与域名两种写法，最多 3 个。
- 刮削结果直接进卡片：有海报就优先显示，评分与简介同步以刮削为准，卡片底部标注「海报与简介来自刮削来源」。
- **豆瓣刮削不实现**：没有公开 API，抓网页违反其条款，UI 里已写明；TMDB 需用户自备 API Key，不填只报原因、不假装成功。
- #37 网络族：`electron-main.js` 落 `userData/kh-net.json`，IPv4-only 模式启动时 `appendSwitch('disable-ipv6')`；
  自定义 DNS 只做记录 + 重启生效，**不替代系统解析器**，面板文案照实说明。

### 本轮修掉的两个真问题

- 新增的九组动作（`cfg-` / `theme-` / `share-` / `prof-` / `meta-` / `ai-` / `net-` / `r-` / `sub-sites-save`）原先只写了处理函数、
  没接上点击分发，界面上按钮点了没反应；现在统一并进 `resAction` 分发链。
- 后台刷新（启动后并入仓自带直播源）会在用户正填设置表单时整体重绘、抢走焦点。新增 `khSafeRender()`：
  设置页里有输入控件聚焦时只标记待绘，等下一次正常重绘顺带生效。

### 自测

- 新增 7 个自测套件：`test-config-center` 57、`test-remote-kit` 65、`test-qr-kit` 41、`test-theme-kit` 48、
  `test-cfg-kit` 31、`test-share-kit` 38、`test-family-meta-kit` 66；连同既有 `test-pref-kit` 63、`test-p2-kit` 93、`test-b8-kit` 88，
  合计 **590 项 0 失败**。
- `smoke-ui` 20 → 21 探针：新增「1.7.94 六个新面板真点生效」（配置总览搜索与清空、皮肤包应用与回退、档案新建 / 切回 / 删除、
  网络族落盘、分享出二维码），真浏览器点击 176 个 `data-act` 控件，连跑三次 21/21、错误 0。

## 1.7.93 / #1000207 — 2026-11-23

本轮补清单里剩下的两项「便宜但一直没做」：关闭窗口行为（#54）与字幕上下位置（#32）。两项都不碰服务端。

- 关闭行为 `kh_close_act`：`tray`（默认，收进托盘继续跑）/ `min`（最小化到任务栏）/ `quit`（直接退出）。
  主进程 `mainWin.on('close')` 按配置拦截，退出路径（托盘菜单 / Ctrl+Q / 系统关机）先置 `quitting` 所以不被吞。
  收进托盘首次给一次气泡提示（`trayBalloonShown` 持久化，之后静默），托盘右键仍可「退出」。
- 字幕上下位置 `kh_p2.subPos`：4 / 8 / 12 / 18 / 26（画面高度百分比），`KHP2.subPosCss()` 转 CSS，
  落成 `--sub-bottom`。设置页两处可调：显示面板（`khSubPosSel`）与 P2 无障碍面板（`p2SubPos`）。
  旧 `kh_sub_style.pos` 的 low / mid / high 自动折算为 4 / 8 / 18，不丢老设置。
- 面板：高级与本地能力加「关闭窗口行为」，P2 无障碍加「字幕位置」，两处都即时生效。
- 备份白名单 `KH_BAK_SETTINGS` 加 `kh_close_act`（`subPos` 在 `kh_p2` 里随包走）；配置体检期望键同步。
- 自测：`test-pref-kit` 56 → 63（closeAct 七条）、`test-p2-kit` 84 → 93（subPos 九条）、
  `smoke-ui` 19 → 20（新增「字幕位置真点生效」，并把 `prefClose` 纳入面板存在与真点断言）。

## 1.7.92 / #1000206 — 2026-11-23

本轮是 1.7.91 的当场补齐：清单里两项原本只能算「部分已有」（#39 通知声音、#48 儿童时长），一并落地，B 档 8 项才算真正做完。

- 通知提示音：新增 `kh_notify_sound`（默认带提示音），主进程 `kh:notify` 用 `silent: !b8.sound` 生效，配置随 `kh-b8.json` 持久化。
- 儿童模式时长上限：新增 `kh_kid_min`（0=不限，上限 240 分钟），按真实播放秒数累计，到点暂停并弹通知；时长用完的会话里换片也只放行起画面再暂停，避免换片绕过。
- 面板补两个控件（通知提示音、儿童时长），保存与备份白名单、配置体检的期望键清单同步补齐。
- `test-b8-kit.js` 从 80 项扩到 88 项（新增两项的默认值、非法回落、上下夹取），实跑 88/0。

## 1.7.91 / #1000205 — 2026-11-23

本轮主题：把需要主进程配合的八项一次做完 —— 音轨语言、本地字幕、通知策略、置顶与画中画、快捷键、外部播放器参数、儿童模式、配置体检。
对应盘点里的 B 档 8 项（#30 #31 #39 #40 #52 #53 #48 #68），清单 57/9/15 → 65/4/12（8 项全部转已实现，部分已有从 9 项减到 4 项）。

### 纯逻辑层 `app/kh-pref.js`（扩展，仍是 UMD 无 DOM）

- `DEF` 新增 `audioLang auto` / `subAuto 1` / `subDir ''` / `notify all` / `playerExe` / `playerArgs` / `top 0` / `kid 0` / `kidPin ''` / `hotkeys{toggle,next,prev,mute,top}`
- `norm` 同步扩展：字符串 400/200 字符夹取、PIN 只留 4 位数字、快捷键逐键规范化
- 新增 `normHotkey`（Electron accelerator 白名单：Ctrl / Alt / Shift / Meta + 字母数字或 F1–F12，非法返回空串）
- 新增 `hotkeyPlan`（过滤空值、去重、先到先得）、`pickAudioTrack`（auto→-1，按 lang/name 别名匹配）
- 新增 `subKey` / `pickSubtitle`（先剥扩展名再判语言后缀；完全同名优先 → 包含关系 → 中文后缀优先）
- 新增 `srtToVtt`（去 BOM、CRLF 归一、逗号换点、补 WEBVTT 头）、`notifyAllow`（all / download / off）
- 新增 `kidAllows`（分类 / 分组 / 标签命中儿童词才放行）、`argsBuild`（`{url}` 占位、成对引号）、`audit`（五类问题计分）
- 单测 `scripts/test-b8-kit.js`：80 项，实跑 80/0；`test-pref-kit.js` 回归 56/0。

### 主进程与桥 `electron-main.js` / `preload.js`

- 新增本机配置文件 `userData/kh-b8.json`（快捷键 / 外部播放器 / 通知策略 / 置顶），重启仍生效。
- IPC：`kh:b8-get` / `kh:b8-set` / `kh:b8-pick`（exe|dir 对话框）/ `kh:b8-subs`（扫 srt/ass/ssa/vtt，≤500 个、≤8MB）/ `kh:b8-sub-read`（UTF-8 失败转 gb18030，≤4MB）/ `kh:b8-win`（置顶与 480×270 右下落位画中画，退出复原原 bounds）。
- 快捷键统一走 `b8RegisterHotkeys()`：空位回落默认媒体键，被系统占用的登记进 `conflicts` 回报前端，不再静默失败。
- `findExternalPlayer` 优先用户指定的 exe；`kh:open-external` 支持参数模板（无 `{url}` 时追加直链），回报 `via` 与 `argv`。
- `kh:notify` 增加第 4 参 kind，主进程按 `b8.notify` 再拦一次（前端已拦一层）。
- `preload.js` 新增 `window.khB8` 六方法；纯网页 / HAP 下为 undefined。

### 前端 `app/kh-core.js` / `kh-admin.js` / `kh-app.js` / `kh-player.js` / `kh-config.js`

- 设置页新增「高级与本地能力」面板（14 控件 + 6 按钮 + 体检结果区）；桌面端可用，缺桥环境自动标灰并注明不支持。
- `b8-save` / `b8-pick-dir` / `b8-pick-exe` / `b8-pip` / `b8-audit` / `b8-fix` 六个动作接入运维分发链。
- 通知统一出口 `khNotifyShow()`：前端按策略先拦，主进程再拦一次；下载完成走 `download` 类别。
- 儿童模式：`allMovies()` 在数据源头过滤（首页 / 分类 / 搜索 / 推荐 / 自动下一部同一份结果），搜索历史不展示，开启需设 4 位 PIN、关闭需输入原 PIN。
- 播放器：hls.js 多音轨按首选语言自动选轨（`MANIFEST_PARSED` + `AUDIO_TRACKS_UPDATED` 双挂点）；非直播片源自动挂同名字幕，SRT 现场转 VTT 挂 TextTrack，ASS/SSA 如实提示不自动挂。
- 全局快捷键从 1 个扩到 5 个（播放暂停 / 上一部 / 下一部 / 静音 / 置顶切换）。
- 备份设置白名单补 10 个新键，换机后高级设置跟着走。

### 门禁

- `test-b8-kit.js` 80/0、`test-pref-kit.js` 56/0、`smoke-ui.js` 19/19 探针（data-act 161、错误 0）。

## 1.7.90 / #1000204 — 2026-11-23

本轮主题：把写死的行为交给用户定 —— 设置页新增「偏好与行为」面板（10 控件），搜索首次命中直播与影视仓。
对应剩余 34 项盘点里的 A 档；清单从 47/12/22 变为 57/9/15（1.7.90 复算）。

### 新增模块 `app/kh-pref.js`

- UMD 纯逻辑层（浏览器 `window.KHPREF` / Node `module.exports`），不碰 DOM、不读 localStorage。
- `DEF`（histCap 30 / histDays 0 / motion 1 / resume `ask` / autoNext 0 / openMode `play` / searchScope `builtin` / whJoin 1）
- `norm(cfg)` 非法回落 + 范围夹取（条数 10–500、天数 0–365、切源阈值 1–10、看门狗 3000–20000）
- `trimHist(ids, atMap, cfg, now)` 条数 + 天数双裁、去重、无时间戳老记录保留
- `resumePlan(saved, duration, mode)` 三档，<5 秒与距结尾 3 秒内不弹；`duration` 非有限按 `ask`
- `pickNext(cur, pool)` 同系列前缀优先 → 同分类 → 排除 live/custom/自身
- `scopeHas` / `needsArm` / `motionClass` / `choices`
- 单测 `scripts/test-pref-kit.js`：56 项，实跑 56/0。

### 面板与持久化

- 设置页「偏好与行为」10 控件：历史条数、历史天数、续播策略、自动下一部、点卡片行为、搜索范围、仓站点并入分类、动效、直播切源阈值、看门狗超时。
- `data-act="pref-save"` 一次写 10 键并即时 `khPrefApply()`；改条数/天数按新上限重裁 `kh_hist`。
- 新存储键：`kh_hist_cap` `kh_hist_days` `kh_resume` `kh_autonext` `kh_open_mode` `kh_search_scope` `kh_motion` `kh_wh_join` `kh_stall_limit` `kh_watchdog_ms`；`kh_hist_at`（{id:ms}，600 上限）、`kh_wh_hide`、`kh_wh_pin`、`kh_plat_pref`。
- `KH_BAK_SETTINGS` 追加 12 键，备份导入还原全覆盖。

### 行为改动

- 历史写入：`khHistTouch` + `khTrimHist` + 动态 cap（原先固定 30 条，无时间戳）。
- 续播：首帧改走 `KHPREF.resumePlan`；短片与片尾 3 秒内直接从头。
- 自动下一部：`ended` 触发 `khAutoNext`，5 秒倒计时浮层（立即 / 取消），`openPlayer` 取消倒计时。
- 搜索：按 `searchScope` 追加直播频道（`data-act="live-go"`）与仓站点来源，各限 12 条。
- 平台入口：逐个隐藏 / 置顶 + 「已隐藏 N · 全部恢复」。
- 仓站点：单条隐藏 / 置顶 + 一键恢复；`cat` 并入分类 chips（受 `kh_wh_join` 控制）。
- 直播稳定性：`khLiveStallLimit()` / `khLiveWatchMs()` 改读偏好，未设回落档位默认。
- 无障碍：`html.kh-no-motion` 全停动画与过渡；`card-armed` 时悬停提示常显。

### 三个真问题

1. **`pref-save` 点击落空**：分发链只认 `res-`/`bak-`/`p2-`/`live-`，`pref-` 无分支 → toast 成功但零落盘。补 `else if(act.indexOf('pref-')===0) resAction(...)`。
2. **冒烟断言写反**：`trimHist` 保持原序，首条是被保留的第 1 条（hist20），不是 hist39；改断言后全绿。
3. **HAP 签名非确定性**：重签后 size/sha 必变（时间戳进包），`release.json` 立即过期 → `doctor` 0/8 中止。本轮用 `oneclick --skip-hap` 并在跑前同步 hap 条目；根治留待「签名确定性」专项。

### 验证

- `test-pref-kit.js` 56/0；`smoke-ui.js` 16/16 探针 · 错误 0 · data-act 155 · 正文 4288 字。
- `doctor` OK14/WARN4/ERR0；`check-artifacts` 16/16；`verify-release` 交付验收全部通过；`check-client-purity` zip 94 + 87 条目违规 0；`version --check` 16 处一致。
- 出包：`oneclick-release --skip-hap` 11 步成功 / 1 步告警（8.2 设备端缺 `KH_KAIHONG_PWD`）。

### 产物 sha256（1.7.90）

| 产物 | 大小 | sha256 |
| --- | --- | --- |
| 鸿汇影桌面版 Setup 1.7.90.exe | 110,283,397 | `1fc11c4490b8a252b8ffd34c89446af69cb92786c39c06ac22690c42cddf14c5` |
| 鸿汇影免安装 1.7.90.zip | 145,756,430 | `fa8cfce63b403f254c5d2d74fe32a7afc749a1f74f876791180f3eb25ba0c363` |
| 鸿汇影桌面版 Setup 1.7.90-arm64.exe | 108,455,189 | `2af34eeffdcbf92c21bc9ed2ea9c44219100f2ce7f598efa23b676532837e0b4` |
| 鸿汇影免安装 1.7.90-arm64.zip | 141,328,343 | `c81a3af5d07d12a4b82dabf86cd1967844f86d70b4f90dda7ce25684bbfe7f8f` |
| HongHubMovie.hap（客户版 #1000204） | 2,348,865 | `ed55bd7cf054f4f224af419e080d3d7f5f288bc7c077833b0150e130eea18668` |
| HongHubMovie-开发端.hap（#1000304） | 2,348,872 | `15cac093b089f8d9eb1e64d0136a1c847d1af460e09af304fc79dbfda6627546` |
| 鸿汇影桌面版 开发端 1.7.90.exe | 110,336,868 | `4ce9bbb1a98d1a048948335a1c2911de55f1be5e9bb1c22c3ca7d185bed88e24` |
| 鸿汇影桌面版 开发端 1.7.90-arm64.exe | 108,455,190 | `16ae6ef50b08ddc78a1318083e394c09cf6d72f1f60ab43b636e5fffdeeae634` |

## 1.7.89 / #1000203 — 2026-11-23

本轮主题：性能 / 无障碍 / 安全三块落地（台账 #161 P2，清单 10 个编号）。
统计：81 项 = 已实现 47 / 部分已有 12 / 待做 22（1.7.88 实测 39/13/29）。

### 新增模块 kh-p2.js

- `KHP2`：`norm / net / queue / retry / fetch / liveQuality / cardMin / focus / volTarget / subExtra / subFontCss / subStrokeCss / normPath / pathAllowed / hostAllowed / sum / seal / verify`。
- `khP2Seal(raw)` → `{v,len,sum,at}`；`khP2Verify(raw, seal)` → `{ok}` 或 `{ok:false,reason}`（长度+双滚动校验和）。
- `khP2HostAllowed(url, hosts, opt)`：仅 https、回环豁免、`*.` 后缀通配、**空表全拒**。
- 默认值集中在 `DEFAULTS`，读写统一走 `khP2Cfg()` / `khP2CfgSave()`（后者自动重算封条）。

### 性能与网络（清单 36 / 35 / 34 / 49）

- 36 并发数 2/4/6/8 档，`khP2Queue` 调度并统计 peak；`kh-app.js` 31 处裸 `fetch(` 统一换成 `khFetch`（失败回落原生）。
- 35 超时与重试：`khP2Retry` 带 timeout/attempts，**只对 GET/HEAD 幂等重试**，4xx 不重试。
- 34 直播清晰度 + 启动进直播：`khHlsConfig` 直播分支按 `liveQuality` 调档；`openPlayer` 记 `kh_last_live`，启动 900ms 自动起播上次频道（`?view=` / `?selftest=` 优先）。
- 49 卡片密度：`cardDensity` → `--grid-min` / `--live-min`（紧凑 132 / 标准 158 / 宽松 196）。

### 无障碍（清单 42 / 41 / 32 部分）

- 42 焦点框：`--focus-ring` / `--focus-w` / `--focus-off`，四档主题，Tab 一圈可见。
- 41 媒体键归属：`volKeys = app|system`，system 档放行 `MediaPlayPause` / `AudioVolumeUp|Down|Mute`。
- 32 字幕（部分）：`--sub-font` / `--sub-shadow` 生效，字体与描边可配；**上下位置未做，仍记「部分已有」**。

### 安全与权限（清单 61 / 62 / 72 部分）

- 61 Webhook 白名单：`kh_p2.webhookHosts`；`server/alerts-center.js` 增 `allowHosts / allowHttp / hostAllowed`，`sendTest` 与 `dispatchOnce` 同校验，拒绝记 `webhook-blocked`；保存时同步 `POST /api/alerts/config`。
- 62 本地目录授权：`localDirs` 授权 / 撤销；`khEnsureLocalAllowed` 在打开本机视频前校验，空表按文件所在目录一键授权。
- 72 配置载体（部分）：仍 localStorage，`getStore/setStore` 为 `kh_` 前缀键加封条，坏值回退默认并记 `kh_store_damaged`（≤20）。**封条只发现问题，不是加密**。

### 本轮修掉的三个真 bug

1. **配置封条自噬**：`setStore` 写完新 raw 再调 `khSealOn()`，而 `khSealOn` 走 `getStore` 读同键 → 旧封条对新值校验失败 → 新值被 `removeItem` 并回默认（表现「保存成功但读回是空」）。修法：`khSealOn` 直读 localStorage 原始串 + 手写 parse，**完全绕开 getStore 校验**。
2. **P2 面板点击无反应**：`kh-app.js` 分发链只有 `res- / bak- / live-`，补 `p2-` 前缀 → `resAction`。
3. **备份漏新键**：`KH_BAK_SETTINGS` 未含 `kh_p2`，换机后三面板配置全回默认，已补。

### 出包链教训（写进文档以免再犯）

- `hap-sign.js` **不会刷新** `harmony/entry/src/main/resources/rawfile/www`；改完 `app/` 必须先 `python harmony\build_hap.py`，否则旧前端被签进 HAP（本轮第一次签出 2,324,136 B、包内无 kh-p2.js；重跑后客户 2,340,595 B / 开发端 2,340,603 B，符号门禁 14 条）。
- HAP 重签后哈希变化不会回写 `release.json`，`doctor` 会报「HAP SHA256 与 release.json 不一致」，需改条目或重跑 `auto-release`。

### 验证

- `test-p2-kit.js` 84/0；`smoke-ui.js` 13 探针全过 · `data-act` 145 · 错误 0；`test-backup-kit.js` 40/0；
  `test-installer-nsh.js` 41 通过 / 1 失败（唯一失败项是测试前置写自启值未生效 `REWRITE=0`，注册表在子进程被虚拟化，属既有环境限制，非清理逻辑回归）；
  `oneclick-release.js` 14 成功 / 1 告警（8.2 设备端缺 `KH_KAIHONG_PWD` 与 `hdc`）；
  `verify-release.js` 末行「交付验收全部通过」；`check-artifacts.js` 16/16；`check-client-purity` 违规 0；`doctor` OK14 / WARN4 / ERR0。

### 产物

| 产物 | 尺寸（B） | sha256 |
| --- | --- | --- |
| x64 Setup | 110,265,943 | `b02ad91c5f3d9e3db5eb90bbeacff98fc4918446bb9a79ea9e7724cf35dcd009` |
| x64 zip | 145,737,117 | `dfeb8ea555c703497ce77c8b963d44197935179c0822c5beb289109e4a3125a6` |
| arm64 Setup | 108,447,073 | `de49c1d76fe06047e0a78ced854e34bb9f275b9487ad63845065813c70c94833` |
| arm64 zip | 141,318,721 | `0ca43fb58e88c1a755c324322a9807fc9cf27eebf1b5479631266cad1c9e8aea` |
| 客户 HAP | 2,340,595 | `b8d04340362c0498ee2cbe94e604a54f647f5dcf737fd5c09d57fd4790ce503d` |
| 开发端 HAP | 2,340,603 | `9f354bbaa24023ac672a1cbec636791f6998a9b36d6ac815fb06f83d8034312c` |

## 1.7.88 / #1000202 — 2026-11-23

本轮主题：安装卸载与备份打磨（台账 #160 P1）+ 出包链「客户版优先」修复。

### 备份侧（清单 44 / 45 / 64 / 67 / 73）

- 新增 `app/kh-backup.js`（三端共用，自写 base64 不依赖 btoa）：v2 明文包 `honghub-backup` 与加密包 `honghub-backup-enc`（PBKDF2-SHA256 `ITER=200000` 派生密钥 + AES-256-GCM，认证失败明确报「口令错误或包被改」）。
- 导出可整机搬迁：设置 / 影视仓 / 场景 / 自建站点 / 历史 / 搜索历史 / 会话；备份目录可自选（IPC `kh:backup-dir-pick`），文件名按 Windows 规则净化（非法字符与 CON/PRN 等保留名），同名自动 `-2/-3` 不覆盖；只允许 `.json/.khbak/.txt`。
- 导入先差异预览：`khBakDiff` 逐项列出新增 / 覆盖 / 保留（≤15 行 + 总数），确认后才落盘；加密包导入弹密码浮层（`khBakPromptPass`），错口令不破坏现有数据。
- 快照与回滚：`kh_snapshots` 按保留份数滚动；重置前与每次导入前自动留档；设置页「备份与恢复」面板可一键留档 / 回滚 / 打开目录。
- 自动备份：`kh_backup_auto` 支持 launch / daily / weekly，启动后 4.2s 静默判定到期（`khBakAutoTick`），到期才写盘。
- 自测 `scripts/test-backup-kit.js` 40 项全过；`scripts/smoke-ui.js` 新增备份面板 4 探针，真点 10/10 通过（`data-act` 141 个、错误 0）。

### 安装 / 卸载侧

- `build/installer.nsh` 重写四段：① 卸载前备份用户数据与 `server\data` 到「文档\鸿汇影·卸载备份\v<版本>」（同版本循环加后缀，`xcopy` 失败不阻断；`说明.txt` 以 UTF-16LE + BOM 写入）；② 非静默模式弹一次「是否一并删除个人数据」，默认保留，静默卸载不动数据；③ 清 HKCU `...\Run` 四个自启动值名；④ `SetOutPath "$TEMP"` → `RMDir /r "$INSTDIR\server"` → `RMDir "$INSTDIR"`，避免文件占用留空壳。
- 按 `$PROFILE` 定位用户数据而非 `$APPDATA`：提权卸载不会误拷管理员账户数据。四个 `!ifndef` 可覆盖 define；`.nsh` 必须 UTF-8 无 BOM（GBK 会 `Bad text encoding`）。
- 自测 `scripts/test-installer-nsh.js` 42 项全过（静态 16 + 探针）：实装 → 写自启动 → 卸载 → 校验备份目录 / BOM / Run 已清 / server 目录已消失，仅剩运行中的卸载器；`KH_KEEP_BOX=1` 保留现场。注册表断言合并进单个 powershell 脚本（跨进程写入会被虚拟化回滚）。

### 出包链修复（「看着成功、其实错」）

- `scripts/postpack.js`：不再无条件用开发端 exe 做 `desktop-setup.exe` 别名并写 `release.json`；同版本客户版指纹存在时以指纹为准，`verify()` 不符直接 `exit 1`。
- `scripts/ship.js` `refreshArtifacts()`：同样改为客户版优先 + `verify` 阻断。
- `scripts/build-client-exe.js` 新增 `syncManifests(dest)`：客户版一落盘即改写 `release.json`（x64 写 `artifacts.desktop`）与 `archs.json`（按架构写 size/sha256/customer，x64 额外写 `file: desktop-setup.exe`，arm64 绝不碰 x64 别名）。
- 1.7.88 出包实测：`check-artifacts` 16 项通过 / 0 警告 / 0 失败；`verify-release` 20 项通过、末行「交付验收全部通过」；归档 28 个版本。

### 产物（v1.7.88）

- 客户 x64 Setup `110,239,768 B` / `9d0c592b6178…`；x64 zip `145,708,933 B` / `f22d48d26846…`
- 客户 arm64 Setup `108,434,526 B` / `de308187288d…`；arm64 zip `141,304,177 B` / `13b216bde006…`
- 客户 HAP `2,324,135 B` / `8ad87c8e3b4f…` / #1000202；开发端 HAP `2,324,140 B` / `4cee8c8ec66b…` / #1000302
- 开发端 exe x64 `110,239,638 B` / `f446079d1f35…`；arm64 `108,434,432 B` / `b23798772cf6…`

### 已知限制

- 设备端 KaihongMovie 未重出：`scripts/hap-device.js` 需 `hdc` 与 `KH_KAIHONG_PWD`，本机缺 hdc，设备端夹沿用 v1.7.87。
- 公网站点 exe / hap / bin 三件仍 404，需宿主后台点「发布/更新站点」；本机 8099 与 Cloudflare 隧道已验证可下发。
- 无深开鸿真机，HAP 仅编译 / 签名 / 包内符号校验；Windows 仍为本地自签证书。

## 1.7.87 / #1000201 — 2026-11-23

本轮主题：更新源多路（#158）+ 出包链三个真 bug 收口 + HAP 原生编译补链。

### 更新源多路（台账 #158 P0）

- 新增 `server/update-sources.js`：`candidates()` 按优先级拼候选 —— ① 显式 env（`env-override`）② 清单里的绝对地址（`manifest`，带校准哈希）③ 各镜像版本目录 `{base}/honghub/v{ver}/desktop-setup.exe{share}` ④ 各镜像旧路径 `{base}/download/desktop-setup.exe{share}` ⑤ 本机镜像站 `http://127.0.0.1:8099` 同版本目录；按 URL 去重、`shareQuery` 归一化，清单只给一个哈希时其余源共用同一期望值。
- `tryDownloadAll()` 依次重试：任一下载失败 / 体积不符 / SHA256 不符都记一条 `attempts`（label + 原因）换下一个；换源前清 `dest` 与 `dest.part`（跨源续传会拼出必然校验不过的坏包）；全失败返回 `err.attempts` 明细。
- `server.js` 新增 `installCandidates()`：env 模式下只保留 `from === 'env'` 的候选，避免灰度被兜底源悄悄换掉。`/api/update/install` 下载段改为多源尝试，全失败返回 502 + `attempts` + `candidates`；成功时 `launchSetup` 的 extra 带 `source: 'download:'+from`、以实际落盘哈希为 `desktopSha256`、`attempts`、`downloadFrom`。
- 新增 `KH_UPDATE_DRYRUN=1`：走完下载 + 校验就停、不 spawn，返回 `{ok, dryRun, absPath, verified, sha256, size, version, attempts}`。客户机默认不生效。
- `app/kh-app.js`：成功文案「安装向导已启动（v… · SHA256 校验通过 · 来源 local-mirror（自动换源 N 次））」；失败时状态条写「原因（各源错误…）」，遥测只带精简 `[{label, error≤80字}]`。
- 自测 `scripts/test-update-sources.js` 28 项断言全通过；`scripts/test-update-sources-e2e.js` 真实探活：公网两跳 404 后换到本机镜像站拿到 `110,210,804 B`、SHA256 `5db97609c1e7316b…`（与真包逐字一致）。

### 出包链三个真 bug

1. **HAP 原生改动从未进包**：`harmony/build_hap.py` 只做前端注入、不编译 ArkTS；`hap-sign.js` 遇到源码比产物新只告警不拦截。`openVideo`（`Index.ets` 2026-11-22 20:50）在 1.7.86 交付的 HAP 里实测 MISSING。修法：手工 `hvigorw.bat --mode module -p product=default assembleHap --no-daemon`（PATH 必须含 `C:\Windows\System32` + `ComSpec`，否则 `spawn cmd.exe ENOENT`），再走 `build_hap.py` → `hap-sign.js`。1.7.87 客户 HAP 与开发端 HAP 均实测包内含 `openVideo`。
2. **归档把开发端 exe 当客户 Setup**：`dist/desktop-setup.exe.sha256` 只在 `ship.js` 重算，`build-exe.js` 阶段它还是开发端哈希 → `archive-release.js` 按权威哈希选源，把开发端包写进 `releases/v1.7.87` 与回滚索引。修法：`build-client-exe.js` 出 x64 客户版时同步写 `desktop-setup.exe.sha256`，重跑归档；归档件已与 `dist/desktop-setup.exe` 逐字节一致（`e433eef3…`）。
3. **随包端点残留旧 HAP 校验值**：`server/public-endpoint.json` 的 `hapSha256: 69fe5ad2…` / `hapSize: 2215054` 实为 1.7.70 值，经 `distribute.published()` 透传进清单会让 HAP 下载永远校验不过。已按该文件自身注释删掉两字段（本就不该随包写死）。

### 出包链防返工（台账 #159，1.7.87 同版收口）

- **客户版指纹成单一真相**：`build-client-exe.js` 出 x64 / arm64 客户包时写 `dist/client/.client-build-<arch>.json`（arch / 版本 / Setup 与 zip 的尺寸和哈希）；新增 `scripts/lib/client-stamp.js`（write / read / verify，流式哈希）。归档、发版、验收三处都读这一份，不再拿别名猜。
- **归档只认指纹**：`archive-release.js` 不再从 `dist/desktop-setup.exe` 或某个「权威哈希」猜客户版 —— 缺指纹 / 版本不符 / 哈希不符一律 exit 1；调试要归档开发端必须显式 `KH_ARCHIVE_ALLOW_DEV=1`，且回滚索引里标 `channel: dev`。
- **auto-release 硬失败**：归档失败或产物一致性总检失败直接 `process.exit(1)`，整条发版链中止（原来只打印 ⚠ 放过，1.7.87 的归档错包正是这样漏出去的）。
- **新增 `scripts/check-artifacts.js`**：16 项跨产物一致性 —— dist/client · dist 根 · desktop-setup 别名 · 回滚归档 · release.json · archs.json(x64/arm64/hap) · HAP 三副本 · 开发端 HAP 版本码 +100 · HAP 包内原生符号 · 发布目录。只读不修，任一 FAIL 退出码 1。
- **hap-sign 两道硬门禁**：① ArkTS 源码比壳包新 → 拒绝签名，提示先跑 hvigor（纯前端改动可 `KH_HAP_ALLOW_STALE=1`）；② 包内找不到 `harmony/required-symbols.txt` 的符号（默认 `openVideo`）→ 拒绝签名。辅以 `scripts/lib/hap-fresh.js`、`scripts/lib/hap-symbols.js`。
- **oneclick 5.1/8**：`dist/arch-arm64/win-arm64-unpacked` 存在时自动补 arm64 客户包，archs.json 不再误标 fallback；`step()` 支持单步额外环境变量。
- 自测 `scripts/test-release-gates.js`：15 项断言全过；实跑篡改指纹 → archive exit 1、恢复后 exit 0；`check-artifacts` 对 1.7.87 现网产物 **16/16 通过**。
- 老版本补指纹：`scripts/backfill-client-stamp.js`（1.7.87 已补：x64 `e433eef3` / arm64 `1a659eea`）。

### 本版实测

- 客户 x64 Setup `110,216,110` / `e433eef3d47e1f90ec87d2158ee7751f6db60aa6c284249ac1d398c14ba6b09e`；x64 免安装 zip `145,685,144` / `e07886a78fdd7008…`
- 客户 arm64 Setup `108,422,386` / `1a659eea9f203c07…`（补 arm64 原生链后重出）；arm64 zip `141,291,691` / `1da33631cd7be954…`
- 客户 HAP `2,315,863` / `ce5a102164028eb963552161b2af80e046fde8bd7d45324fd8cbc4583a5f144c`（#1000201）；开发端 HAP `2,315,958` / `9c64920b1e39bce2…`（#1000301）
- 开发端 exe x64 `110,269,625` / `69b1d7e2a4b8bb98…`；arm64 `108,422,392` / `13253c83f9f92acb…`
- 设备端 `KaihongMovie_v1.7.87.hap` `1,041,939` / `a6773fee8f9120a0b55f683d9367de07b99019329039c8dded745b49d086dc02`
- 一键流水线 14/14 成功；`ship-client.js` 上传 3/3 成功；`verify-release.js` → 「交付验收全部通过」（含 Range 206、自动修 Bug 闭环、下发清单 3 通道、OS 适配 7 家族 22 版本、页面冒烟 data-act 133）。

### 已知限制

- 公网 `exe / hap / zip` 仍 404：需在 WorkBuddy 站点后台手动点一次「发布/更新站点」，本机 8099 已就绪。
- 无真机：三个 HAP 只做编译与包内符号校验，未实测安装；`openVideo` 能否拉起系统播放器取决于 ROM 是否放行三方 `startAbility`。

## 1.7.86 / #1000200 — 2026-11-23

本轮主题：安装方式可选（静默覆盖）+ 设备端接系统播放器 + 出包链止损。

### 桌面端：静默覆盖安装

- 设置「版本与升级」新增「安装方式」下拉：0 = 弹安装向导（默认，用户确认覆盖）/ 1 = 静默覆盖。仅桌面端渲染（`window.khUpdater` 存在时）。
- 主进程新增 `kh:install-silent`：先校验安装包存在、是 exe、目标目录有 `Uninstall*.exe`，三项缺一即拒绝并说明"免安装版目录不适用"；通过后退出自身，`setup /S /D=<appDir>` 同目录覆盖，再自动重开。
- `launchSetup` 增 `extra.silent` 分支：校验通过后不 spawn，只把绝对路径交回渲染进程；`preload.js` 暴露 `window.khUpdater.installSilent`。
- 静默失败会自动把「安装方式」改回 0 并提示"已改回弹向导，请再点一次安装"，不把用户卡在中间态。

### 深开鸿设备端：接系统播放器

- `KaihongBridge` 新增 `openVideo(url, mime)`：`startAbility` + `ohos.want.action.viewData` / `entity.system.browsable` / `type: video/*`，把设备端拉不动的片源交给系统播放器。
- `kh-hap-bridge.js` 的 `khExternal.play(url, mime)` 返回 `{ok, via:'system-player', reason}`；客户端「用外部播放器打开」在设备端优先走它，桌面端仍走 `open`。能否真正拉起取决于 ROM 是否放行三方 `startAbility`，无真机未实测。

### 出包链止损

- `auto-release.js` 取免安装 zip 时未排除 `-arm64`，导致客户说明 / 文件导航 / 公网 bin 一直印着 arm64 的体积与哈希。本版修掉，并给客户说明生成器补上 ARM64 两组与别名 zip。
- 1.7.86 实测：x64 Setup `110,210,804` / `5db97609c1e7316b…`；x64 zip `145,679,229` / `1654ac82cd02cf48…`；arm64 Setup `110,501,482` / `4e2139845bb895b6…`；arm64 zip `143,393,907` / `925deccf3c62…`；客户 HAP `2,312,384` / `18093f5230171e0e…`；设备端 KaihongMovie HAP `1,037,843` / `014ca56d7b0d56dc…`。

### 原记「待发布」，已在 1.7.87 落地发布

- **更新源多路（台账 #158 P0）**：安装包下载从"只认清单里那一个地址"扩成按优先级的多源候选 —— 显式 env → 清单绝对地址 → 各镜像（版本目录优先、`/download/` 旧路径兜底）→ 本机镜像站；前一个源 404 / 超时 / 体积不符 / SHA256 不符都自动换下一个，坏包与 `.part` 一律清掉，不跨源拼接续传。
- 失败时 `/api/update/install` 返回 502 并附 `attempts`（每个源各自的原因），客户端把"试过哪些源、各报什么错"直接写进升级状态条与遥测，不再只有一句"失败"。
- 新增 `KH_UPDATE_DRYRUN=1`：走完下载 + 校验就停，不拉起安装向导，用于排障与自测。
- 自测：`scripts/test-update-sources.js` 28 项断言全通过（候选优先级/去重/shareQuery 归一化、404 换源、SHA 不符换源、半包按体积拒收、全失败明细齐全）；`scripts/test-update-sources-e2e.js` 按真实配置探活。实跑结论：公网两跳均 404 后自动换到本机镜像站拿到 `110,210,804 B`、SHA256 `5db97609…`（与真包一致），校验通过。
- 顺手修掉 `server/public-endpoint.json` 里遗留的旧 `hapSha256`（`69fe5ad2…` / `2,215,054 B`，实为 1.7.70 的值）。它会经 `distribute.published()` 透传进清单，让 1.7.86 的 HAP 下载永远校验不过；该字段按设计本就不该随包写死，已删除。

## 1.7.85 / #1000199 — 2026-11-22

本轮主题：内置资源 + 影视仓升级 + 播放链路修复 + 发布链止损。这一版先是自动发版出了一轮半成品，收口后才对外。

### 内置资源：换台机器打开就什么都有

- `khSeedBuiltin()` 在启动、render 之前写入 6 个网站（电影天堂、金牌影院、电影天堂2、找剧AI、电影天堂3、茶杯狐；找剧AI 原有，按 url 去重实际新增 5 个自建站）与 22 条影视仓接口（含创享影视 11 个片库源，22/22 全保留）。
- 幂等标记 `kh_seed_v=3`：重复启动不叠加；用户删除后不自动灌回；内置仓 url 留空，远程刷新不会清掉。

### 影视仓与播放

- 影视仓升级：主进程二进制抓取 + 智能解码（GB18030 / base64 / 注释头），容量提到 30 仓 / 12 启用 / 1000 站点。
- `khApplyPlayHeaders()` 下发 Referer / UA 修部分站点 403；续播提示不再被播放状态清空；投屏改用原始直链（排除 blob）；下载当前片携带播放请求头。

### 发布后补丁（11-22 二次重出）

- 客户包剔除 app/lib/sources-schema.md；package.json files 加 !app/lib/*.md，包内 .md 归零。
- 备份导入加 64 MB 上限：khPickBackupFile() 先看 file.size，超限直接提示拒绝。
- 免安装 zip 根注入 先看我-安装说明.txt（按 x64 / ARM64 分版本文案），解压即见。
- 重出后实测：x64 Setup 110,188,301 / 0e4cdbfd…；x64 zip 145,653,985 / 1c6baf29…；arm64 Setup 108,411,807 / 9f42394d…；arm64 zip 141,279,305 / d67a4e0e…；开发端 exe 110,243,304 / 3a95c51c…。
- dist 瘦身 22,481 MB → 15,725 MB（清旧 client 包、x64-build、_历史构建增量_、_历史版本_1.7.70 与 1.7.30/33/34/35 旧件）。
### 发布链止损（本轮实际踩到并修掉）

- `electronLanguages` 被清成空数组，首轮包把 55 个语言包全打进去：x64 Setup 118,703,159 B / zip 157,412,874 B（比 1.7.84 多约 10.6 MB，zip 条目 79 → 130）。恢复 `["zh-CN","en-US"]` 并在两棵树上只留 `zh-CN.pak` / `en-US.pak`，重走 `build-client-exe.js`（13 个 `*-admin.html` 暂存剥离、开发端 server 资产剥离、`CLIENT_ONLY` 硬开关）后包体回落。
- `archs.json` 首轮把 x64 误指向开发端 exe（118,755,792 / c7f23de4…），且 arm64 标 `fallback`（实际原生包就在 dist）。本轮按 `dist/client` 客户包重建，x64 / arm64 均 `ready`。
- `dist/public` 的 `kh-app.js` 原是开发端版（195,824 B，含 dev UI 段），发布目录已换成客户净化版（194,872 B）。

### 上报闭环加固（11-22 第三轮重出）

- 告警外发接入运维中枢：`server/alerts-center.js` 新增 `push(items)` 与 `data/alerts-injected.jsonl` 外部告警入口，`list()` / `dispatchOnce()` 合并注入条目；
  `server/server.js` 的 `/api/report` 每写入一条上报即把 `stats().alerts` 喂入，跨设备超阈值（≥30 台或 ≥500 次）进分级、可经 Webhook 推群。告警开关仍默认关闭，需显式配置。
- 崩溃与页面错误共用设备号：`preload.js` 暴露 `khDeviceId.set`，主进程 `ipcMain.handle('kh:device-id-set')` 存 `pageDeviceId`；
  `reportCrash` 不再固定 `desktop-main`，改真实设备号并补 `view/plat/ver`；前端 `issueDeviceId()` 首次生成时同步一次。
- 问题闭环率上运维面板：`server/server.js` 新增 `readClosure()`，`stats()` 返回 `closure`，`/api/ops` 透传；
  运维面板增「问题闭环」卡（闭环率 % · 已归档/观测 · 生成时间），问题上报看板增「问题闭环率」格，无数据时提示先跑一轮自动修 Bug。
- 安装卸载端到端修两缺陷：新增 `build/installer.nsh`（`customInstall` 写卸载键 `InstallLocation`，`customUnInstall` 先 `SetOutPath "$TEMP"` 再 `RMDir "$INSTDIR"`），
  `package.json` 的 `build.nsis` 挂 `include`。x64 静默安装实测：装 13.3 s / 78 文件 / 监听 8787 / `%APPDATA%` 21 项；卸 13.2 s 后目录不存在、注册表 0 条、快捷方式清空，个人数据保留。

### 验证与产物（本轮实测）

- 客户 x64 Setup 110,188,301 B · `0e4cdbfd37469932bb21303d73021e3e01137d1fefa3d01365ee7613bcb68fbd`；x64 免安装 zip 145,653,985 B · `1c6baf29f2e5802f404da41e6d14983bc25dc8e4e1ab46aa7365cdfa3c2609be`
- 客户 arm64 Setup 108,411,807 B · `9f42394d6f7e53bab6d1b84a21c326a4a29802cf31603b7f9f2cfb2ec13697df`；arm64 免安装 zip 141,279,305 B · `d67a4e0e080baa7e32d4c4beb560bb92f2c683d1bb2ea77fbe6e8e783fbddabe`
- 开发端 exe 110,243,304 B · `3a95c51cba3e70f8e9a50e5003bd5d74e912566db78463aaf26e1ac24f406537`；客户 HAP 2,261,000 B · `283b9c59…`；dev HAP 2,261,003 B · `3148fe4d…`
- `check-client-purity` 全部 zip 违规 0；`verify-release` 全部通过（页面运行时冒烟 data-act 132）；`build-archs` x64 / arm64 双 ready。
- 客户夹 11 件（4 产物 + 2 Setup 别名 zip + HAP + 说明 + 核对清单 + 自检 cmd/ps1）、开发端夹 11 项（补 `exe.sha256` 与「切回客户界面.cmd」）；桌面根 Setup 与 HAP 已换成 1.7.85。
### 浏览窗口体验打磨（11-22 第七轮重出）

- 桌面 webview 改桌面 Chrome UA（去掉 Electron 标识）：实测优酷对 Electron UA 返回 1,441 字节验证码跳转页，改后 1,013,195 字节正常首页。
- 浏览窗口补齐：失败原因面板 + 重试 / 浏览器打开 / 回列表、加载进度条、Alt+←/→ / F5 / Esc / Ctrl+L 快捷键、独立窗口位置尺寸记忆、关闭后回焦主窗、webview 崩溃恢复、复制链接、guest 仅允许 http(s) 导航。
- HAP 浏览页补齐：安全区（khAvoidArea）避让、browserActive 返回键放行、桌面 Chrome UA、失败面板与 HTTP 错误原因、2vp 进度条、按钮 40vp 热区、复制链接与系统浏览器打开。
- 本轮产物：x64 Setup 110,188,301 / 0e4cdbfd…；x64 zip 145,653,985 / 1c6baf29…；arm64 Setup 108,411,807 / 9f42394d…；arm64 zip 141,279,305 / d67a4e0e…；客户 HAP 2,261,000 / 283b9c59…；开发端 HAP 2,261,003 / fe213de8…。

### 浏览窗口多开 / HAP 横屏 / 清单补齐（11-22 第八轮重出）

- 桌面浏览窗口从单例改为按平台多开：同域名复用，上限 4 个，超出按最近聚焦时间淘汰；新窗口级联错位 24px；关闭一个时优先聚焦剩余窗口，全部关闭才回主窗口。
- HAP 浏览页进入切 landscape、退出恢复 auto。
- 客户下载说明补齐 ARM64 两件（108,411,807 / 9f42394d…；141,279,305 / d67a4e0e…）。
- 本轮产物：x64 Setup 110,188,301 / 0e4cdbfd…；x64 zip 145,653,985 / 1c6baf29…；arm64 Setup 108,411,807 / 9f42394d…；arm64 zip 141,279,305 / d67a4e0e…；客户 HAP 2,261,000 / 283b9c59…；开发端 HAP 2,261,003 / fe213de8…。

### 开发端运维面板体验打磨（11-22 第九轮）

- 13 个子页由服务端统一注入顶栏：返回看板 + 当前页名 + 12 项面板直达下拉 + 刷新 + 口令 + 影视页；Alt+← 回看板；对 body 无内边距的 3 页自动补齐 22px，顶栏不再顶出屏幕。
- `/admin/home` 总目录 11 个磁贴状态全部真实化（`/api/ops` 更新成功率与源可用率、`/api/features/flags` 开关数、`/api/features/track` 版本数与增删），新增「刷新全部状态」与状态更新时间/失败计数。
- 告警中心保存 Webhook 覆盖已有地址时二次确认。
- 开发端重出：x64 110,243,304 / `3a95c51c…`；arm64 108,466,807 / `2edbc1f4…`（客户包与 HAP 未变）。

## 1.7.84 / #1000198 — 2026-11-21

本轮主题：客户端备份与重置漏项补齐——这是**第一个带此修补的对外发布版**（1.7.83 只在本地出过包、从未推公网，内容原样并入本版）。

### 备份覆盖：6 个用户配置以前换机必丢

- 扫 58 个持久键，确认 6 个「设置页里会改本机行为、但没进备份」的键：`kh_proxy`（HTTP 代理三档）、`kh_hub_url`（中枢地址）、`kh_issue_cfg_v1` / `kh_issue_remote_v1`（反馈上报地址与开关）、`kh_live`（自建直播频道，上限 50）、`kh_livefav`（直播收藏）。
- `KH_BAK_SETTINGS` 从 17 键补到 21 键；导出补 `live` / `livefav` 两个独立字段与 toast 计数（「自建直播 N / 直播收藏 N」）。
- 导入侧新增 `kh_live` 数组并集：只收合法 `https?://` url、上限 50、按 url 去重，覆盖/合并两模式都走通；`kh_livefav` 按 id 去重、上限 50。
- 导入完成后立刻把 `kh_proxy` 下发主进程（不必重启才生效）；中枢地址恢复时提示「重开窗口后生效」。

### 重置设置：删了 localStorage 但代理还在生效

- 「重置设置」补 `kh_proxy`，并在函数内调用 `window.khProxy.set({mode:'system', server:''})`，把主进程会话代理真正回「跟随系统」。以前只删存储，代理仍挂着，表现为「重置了却还是走代理」。
- `kh_live` / `kh_livefav` 属用户内容而非设置，重置不清，语义保持不变。

### 三项静态审计（查完才敢说没有别的缺口）

- UI 分支完整性：`data-act` 131 个 + `data-ctrl` 22 个全部能在 JS 找到同名分支，缺失 0；33 处「不支持 / 未实现」文案逐条核对，全部是按环境（浏览器 / 设备 WebView / 无 `khCast`）如实降级，不是假按钮。
- 后端路由反向：108 条 `/api` 里客户端未引用的 14 条（`/api/bugfix`、`/api/changelog`、`/api/feedback`、`/api/ops`、`/api/publish` 等）全为运维/设备回传用途；客户端自己的反馈链是另一条（`issueRemoteCfg` / `issueRemoteSend` + 设置页保存地址/开关/立即上报/在线看板），完整存在。
- 缓存类与设备标识（`kh_boot_ms`、`kh_src_health_v1`、`kh_plat_hist`、`kh_issue_devid` 等）按设计不备份；`kh_issue_devid` 故意不备份，换机应重新生成。

### 验证与产物

- `node --check` 两文件均 0；`smoke-ui.js` 131 控件 / 错误 0 / 面板真点 6/6；`version.js --check` 13 处一致（v1.7.84 / #1000198）。
- x64 Setup 108,106,047 B · zip 143,488,792 B；arm64 Setup 108,397,361 B · zip 141,204,108 B；两个 zip 顶层分别为「鸿汇影桌面版 1.7.84」「鸿汇影桌面版 1.7.84-arm64」。
- 开发端 exe 108,159,297 B；客户 HAP 2,215,054 B；dev HAP 2,215,050 B。
- `verify-release` 全部通过、`check-client-purity` 0 违规、`site-publish --ready` 就绪。
- 公网站点发布仍待宿主点一次「发布/更新站点」；本版上传通道已送达清单，静态三件在公网侧待站点同步。

## 1.7.83 / #1000197 — 2026-11-21

本轮主题：开发端（不是客户端）补账——把「开发端装完还得手动切模式」「自更新装了等于没有」「运维台入口缺页」这三处名存实亡的链路修通。

### 开发端开箱即开发模式

- 以前开发端装完打开是影视页，必须先双击「安装后转开发端.cmd」写 `dev-mode.flag` 才进运维台——这不是开发者要的默认。
- `DEV_BUILD` 判定改为：客户版由 `CLIENT_ONLY` 物理锁死；开发端构建**默认开发模式**。
- 需要以客户界面自测时，启动加 `--client` 或设 `KH_DEV_MODE=0`；旧 `dev-mode.flag` 仍兼容（删掉也不会把开发端打回影视页）。
- 客户版行为零变化：`CLIENT_ONLY = true` 时 `DEV_BUILD` 恒为 false，运维台与发布接口依旧不存在。

### 开发端自更新：从「永远跳过」修到真能升级

- 两个根因：① 只扫「程序目录\dist」，但安装后的开发端根本没有 dist 目录；② 只认文件名「鸿汇影桌面版 开发端 X.exe」，而构建产物叫 `dev-setup.X.exe`（交付夹里才改名），两边永远对不上。
- 搜索路径改为有序多根：`KH_DEV_SETUP_DIR` → 程序目录\dist → 程序目录 → `LOCALAPPDATA\Programs\*\dist` → 桌面根与「鸿汇影·开发端_v*」「鸿汇影·客户成品_v*」交付夹。
- 文件名两种命名都认，arm64 变体（`-arm64`）也认；体积仍设 50 MB 下限过滤残包。
- 状态落盘 `server/data/dev-auto-update-status.json`（当前版本 / 找到的包 / 扫描目录 / 架构跳过数 / 结论 / 检查时间），并保留 `dev-auto-update.log`。
- 架构对齐：`-arm64` 的包只给 arm64 主机装，无后缀的只给 x64 主机装，不符的跳过并计入 `archSkips`。以前不分架构，arm64 机器会去装 x64 包，静默安装必失败，表现成「说升级了但版本没变」。
- 静默安装改为 `/S /D=<程序目录>`：不带 `/D` 时 NSIS 会装回默认目录，变成两份并存、重启的还是旧那份，同样是「升级成功但版本没变」。
- 运维台点「立即检查」= 写 `server/data/dev-update.trigger`，主进程模块 20 秒内轮询响应（server 不反向调主进程）。

### 运维台入口补全

- `/admin` 看板右上角入口从 10 个补到 13 个：新增 🗂 站点目录（`/admin/catalog`）、🌐 站点管理（`/admin/sites`）、🔄 自更新（`/admin/selfupdate`）。
- 新增 `/admin/selfupdate` 页：当前版本、上次检查、找到的安装包与结论、已扫描目录、最近 40 行日志，带「立即检查 / 打开程序目录 / 回看板」三个按钮。
- 新接口：`GET /api/dev/selfupdate`（状态+日志尾）、`POST /api/dev/selfupdate`（写触发文件）、`POST /api/dev/selfupdate/open`（explorer 打开程序目录）。全部 `DEV_MODE` 专属，客户包 404。

### 打包：13 个运维页真正进包（历史上一直是 404）

- 根因：`package.json` 的 `build.files` 里有 `"!server/*-admin.html"`，12 个运维子页从未被打进任何开发端安装包。`/admin` 根页能出（BOARD 内嵌在 `server.js`），但右下角入口点进去全部 404。
- 已删除这条排除；客户包需要继续剥离运维页，改由 `build-client-exe.js` 在 `stripDevArtifacts` 前把 13 个 `*-admin.html` 读进内存（`adminBaks`），`finally` 里逐个写回。开发端源目录完整、客户包解包后 0 个。
- 实测：`dist\win-unpacked` 与 `dist\arch-arm64\win-arm64-unpacked` 的 `resources\app\server` 下各有 13 个 `*-admin.html`（alerts / build / catalog / devices / extras / features / home / insights / metrics / quality / release / selfupdate / sites）。

### 出包链两处坑（不改功能，但会毁掉整次出包）

- `server/public-endpoint.json` 被写成 UTF-8 BOM，`JSON.parse` 不容忍，打包末段 `assertBundledEndpoint` 抛「随包端点 JSON 解析失败」。已剥掉 BOM，并在读取侧加 `.replace(/^\uFEFF/, '')` 兜底。
- electron-builder 退出后目录句柄未及时释放，zip 顶层改名偶发 `EPERM`，会让顶层目录退化成 `win-unpacked`。改为重试 5 次（间隔 1.2 s），仍失败才退化并在日志写明。

### 说明与验证

- `鸿汇影开发端说明.txt` 补：默认开发模式、怎么回客户界面、自更新搜索路径、13 个运维页地址、自更新状态页怎么用。
- 实测：`/admin/selfupdate` 200、`/api/dev/selfupdate` GET/POST 200、触发文件生成、`/admin` 含三个新入口、`/admin/catalog` 200。
- 真安装形态实测（直接跑开发端 exe）：默认进 `/admin`（13 个入口链接），13 个运维页全部 200；`--client` 下 `/admin` 与 `/api/dev/selfupdate` 全 404、`/index.html` 200。
- 自更新实测：程序树内 `checkOnce` 从桌面交付夹找到 v1.7.83 并报「已是最新」；造 55 MB `dev-setup.9.9.9-arm64.exe` 假包，x64 主机跳过、`archSkips=1`。
- 运维页接线：13 页 59 个 `/api` 引用，缺后端 0；16 个关键 GET 接口实测全 200。
- 冒烟 131 控件 / 错误 0 / appCode #1000197；版本 13 处一致。

### 客户端：备份与重置漏项补齐

- 静态审计三件：`data-act` 131 个 + `data-ctrl` 22 个全部有 JS 分支，缺失 0；33 处「不支持 / 未实现」文案逐条核对都是按环境如实降级，不是假按钮；后端 108 条 `/api` 里客户端未引用的 14 条全为运维/设备回传用途。
- 扫 58 个持久键，发现 6 个用户配置没进备份：`kh_proxy`（HTTP 代理）、`kh_hub_url`（中枢地址）、`kh_issue_cfg_v1` / `kh_issue_remote_v1`（反馈上报地址与开关）、`kh_live`（自建直播频道）、`kh_livefav`（直播收藏）。
- `KH_BAK_SETTINGS` 从 17 键补到 21 键；导出补 `live` / `livefav` 与 toast 计数；导入侧新增 `kh_live` 数组并集（`https?://` 过滤、上限 50、按 url 去重）与 `kh_livefav` 并集（上限 50、按 id 去重），覆盖/合并两模式都走通。
- 导入后即时下发代理到主进程（不必重启），中枢地址恢复时提示「重开窗口后生效」。
- 重置设置补 `kh_proxy`，并真正把主进程会话代理回「跟随系统」——以前只删 localStorage，代理仍在生效。
- `kh_live` / `kh_livefav` 属内容而非设置，重置不清，语义保持。
- 验证：`node --check` 两文件 0；冒烟 131 控件 / 错误 0 / 面板真点 6/6。

## 1.7.82 / #1000196 — 2026-11-21

本轮主题：把两轮缺口盘点一次性补完——更新通道从「彻底断链」修到能用，播放层补上 Referer/UA，仓内线路能直接在客户端播，本机视频/代理/m3u8 下载三个桌面能力补齐。

### 更新通道：从断链到可用

- 公网 `remote-manifest.json` 长期停留在 1.7.43、`honghub/v1.7.81/*` 全部 404，导致「检查更新」永远报最新。随包 `public-endpoint.json` 已指向 v1.7.82，并**删除写死的 `hapSha256`/`hapSize`**（旧值是 1.7.70 的 959,160 B，会让新版 HAP 校验必败），改为说明字段。
- 客户包 `updates/` 目录为空、`build-client-exe.js` 又剥掉了 `dev-auto-update.js`，客户点更新必失败——这一条不做假修，改为在 `/api/update/install` 的 502/404 失败文案里直接给出**手动下载页**，客户端至少知道去哪里拿新版。
- 公网部署仍需在拿到上传许可后执行 `ship-client` 的 deploy 步骤；未部署前客户端会如实报「没有可用新版本」，不会假装已更新。

### 影视仓线路：能直接播，且带得上站点头

- 仓内线路原来只有「外播」，现在每条线路三个按钮：**▶ 内置播放**（默认）、🖥 外播（原来的外部播放器/浏览器）、⧉ 复制。
- 内置播放走新增的 `khPlayUrlInApp(url,title,hdr)`：把线路地址和站点 header 一起交给播放器，不再先导出去再让人另开。
- `whSrcOpen` 改为按 `api` 反查原站点对象再取详情，站点 `header`（对象或 JSON 串）解析后随播放按钮携带，线路级请求终于带得上 Cookie/Referer。
- 播放层补 `khApplySrcHeaders()`：`loadSource` 前把源上的 `headers` 交给主进程 `kh:play-hdr-set`，由 `session.defaultSession.webRequest.onBeforeSendHeaders` 统一注入——之前只有数据层带 Referer/UA、播放层裸奔，仓片播放必 403 的问题就此闭环。`file/blob/data/resource` 源自动跳过。

### 字幕：GBK 不再乱码

- 本地字幕从 `readAsText(f,'utf-8')` 改为读 `ArrayBuffer` 后解码：先严格 UTF-8，失败退 `gb18030`，再退宽松 UTF-8。老 SRT/ASS（GBK 编码）不再满屏方块。

### 备份：补上 1.7.81 新键

- 导出新增 `warehouseLives`（仓直播源 `kh_wh_lives`）与 `warehouseParses`（仓解析接口 `kh_wh_parses`），导入 `applyCfg` 同步还原这两键；导出提示里加入站点/直播源/解析计数。换机不再丢仓自带直播源。

### 桌面能力三项

- **打开本机视频**：首页两处入口 + 控制条「📂 本机」按钮，主进程 `kh:pick-video` 走系统文件对话框（14 种视频扩展名），返回编码后的 `file:///` 地址直接进播放器；不注册系统文件关联，不动用户的默认程序。
- **HTTP 代理**：设置页「网络代理」三档（跟随系统 / 直连 / 手动），手动填 `host:port` 校验后经 `kh:proxy-set` 应用到 session，本地地址自动绕过；不支持时如实提示。
- **m3u8 下载**：下载器新增 HLS 支持——解析主清单/子清单（最多递归 2 层）、顺序下切片写 `.part`、按段进度、完成后合成 `.ts`；AES 加密清单**如实拒绝**，不假装能下。
- **免安装 zip 顶层目录名**：以前 arm64 那份解压出来是 `win-arm64-unpacked`，现在两份分别是「鸿汇影桌面版 1.7.82」「鸿汇影桌面版 1.7.82-arm64」，解压即见名字。

## 1.7.81 / #1000195 — 2026-11-21

本轮主题：把影视仓从「能导入」做成「能真用」——多仓、分组、健康检查、仓自带直播源，播放与界面小账一起收。

### 影视仓：数据层补齐 TVBox 语义

- 站点适配层支持 `header`（对象或 JSON 串，一并透传给请求）、`ext`（附加参数拼到接口地址）、`type` 数值语义；`search/category/detail` 共用同一套请求构造。
- 仓配置识别三类：站点仓（`sites/list/data`）、多仓索引（`urls[]`，并发 3 拉取并按子仓分别落库）、jar 爬虫仓（识别后**不解析、明确拒绝**，因为需要 JVM 环境，本客户端给不了假的成功）。
- 新增 `lives[]`（仓自带直播源清单）与 `parses[]`（解析接口列表）落库，键为 `kh_wh_lives` / `kh_wh_parses`，仓行显示「子仓 N · 直播 N」计数。
- 仓上限 6 → 12，同时启用仍为 6：超出后新仓存为停用并提示，避免搜索被拖死。
- 新增 `whProbe()` 健康检查：面板「🩺 探测上面的地址」直接报可达性、类型、站点数（带接口数）、子仓 / 直播 / 解析数、耗时。

### 影视仓：面板与交互

- 仓站点区每条带 `data-name`（站名 + 分类 + 仓名），默认只显前 40 个，点「显示全部 N 个」一次性展开（全量已渲染，展开不重绘）。
- 新增仓内搜索框，按站点名 / 分类直接过滤 DOM，不重绘、不丢焦点；后 40 条之外的站点也能搜到。
- jar 站点加红色「jar（不支持）」徽标，与可用站点一眼分开。
- 仓自带直播源（`lives[]`）的 txt 清单会在启动后后台拉取解析，并入直播页，分组为「仓名 · 原分组」，可像内置频道一样直接播放；解析结果缓存本机，下次启动先行合并。

### 跨仓搜片：不再硬截断 24 个站

- 第一次查前 24 个接口站，面板底部给「继续搜索下一批（N 个站点）」，逐批把剩下的站点查完，结果累加展示（最多列 60 条，超出给总数）。
- 搜索过程显示「已查 X / 总 Y 个接口站」，失败站点仍只列前 6 条原因，避免刷屏。

### 播放与界面小账

- 场景切换（省电 / 长片 / 直播 / 长辈）的字号档现在立即生效：新增 `applyFontScale()` 统一消费 `kh_font_scale`，切档后整页 zoom 当场变，不用重开客户端；长辈档 150%。
- 英文化补两条被 `<strong>` 拆开的说明句（内置频道备用线路、批量导入网址），英文模式下疑似 UI 残留归零。

## 1.7.80 / #1000194 — 2026-11-21

本轮主题：把「能跑」补成「可交付」——备份闭环、真实冒烟、可访问性、签名链路、性能基线、中英覆盖、多架构如实登记。

### 用户数据备份：从片单扩到全部本机配置

- 导出对象新增 `sites`（自建站点）、`warehouses`（影视仓）、`warehouseSites`（仓内站点）、`scene`（场景预设）、`remote`（远程配置）、`settings`（17 项偏好）。
- 偏好白名单 `KH_BAK_SETTINGS`：主题、动效、字号、长辈、儿童、夜间、睡眠定时、响度均衡、语言、字幕样式、兼容模式、画面比例、倍速、清晰度、亮度、自动更新、开机自启。
- 故意不导出设备相关键（中枢地址、设备 ID、升级尝试计数、窗口位置、启动耗时、音量、静音、直播源、推广位），换机不带着别人的机器指纹跑。
- 导入支持三档：`merge`（本机为空才补入）、`overwrite`（整体覆盖）、`skip`（只读不写）；格式不对的整类跳过并计数。
- 自建站点走并集：过滤非 http(s)、按 URL 去重、硬上限仍为 50（不套用 200 默认配额）。
- 设置项逐键写入，导入后立即调用 `applyMotionPref()`，动效无需重启生效。
- 导出与导入弹窗都显示真实统计：片单五项条数 + 自建站点数 + 影视仓数 + 场景有无 + 设置项数。

### 新面板可访问性

- 影视仓行内「刷新 / 启用停用 / 删除」三个图标按钮补 `aria-label`（带仓名）；仓站点「复制 / 打开」同样带站名。
- 场景四档改为 `role="button"` + `tabindex="0"` + `aria-pressed`，`aria-label` 含场景名与适用人群；`#main` 上新增 keydown 委托，Enter / 空格可激活 div 型卡片。
- 下载队列的并发数、限速、下载地址、文件名、加入队列按钮全部具名；每行暂停 / 继续 / 移除按钮带片名。

### 冒烟：从「数控件」改为「真点」

- 旧判据只统计 `[data-act]` 数量，新增区块会自动让数字变大，等于没验。
- 现在逐块切视图 + 真点：影视仓面板骨架、跨仓搜片输入与按钮、场景卡点击（校验 `kh_scene` 落盘与 `aria-pressed` 唯一选中）、下载队列（注入内存假桥，真跑「填地址 → 加入 → 列表刷新 → 暂停回调」）、新面板可访问名。
- 结果 6/6 通过；首启条款遮罩在冒烟页面内摘除，避免拦截指针事件。

### 性能基线

- 新增 `scripts/perf-baseline.js`：量 FCP、首个控件出现时刻、DOM 节点数与深度、CDP `JSHeapUsedSize`、连续 3 秒 rAF 的平均 FPS / p95 帧间隔 / 卡顿帧数、设置页与网站页渲染耗时。
- 多轮取中位数写入 `dist/perf-baseline.json`；与上一次基线比较，FPS 跌超 20%、首屏/堆/渲染涨超 30%、DOM 涨超 20% 即非 0 退出。
- 1.7.80 首份基线：首屏 586ms（冷启 1008ms）、首个控件 781ms、堆 2130KB、DOM 319 节点 / 7 层、FPS 60（p95 16.7ms，0 卡顿帧）、设置页 99.5ms / 网站页 260.5ms。

### Windows 代码签名链路

- `scripts/sign-windows.js` 支持多目标（`WIN_CSC_TARGETS` 分号分隔），signtool 优先、PowerShell `Set-AuthenticodeSignature` 兜底，统一写 `dist/codesign.json`（整体状态 + 每文件明细）。
- 修两个环境坑：构建会话 PATH 不含 `System32`（改绝对路径调用 powershell.exe）、`PSModulePath` 被 pwsh7 目录占满导致 5.1 找不到 Security 模块（子进程改用 5.1 自己的模块路径）。
- `--selftest` 用仓库内测试证书签副本，指纹校验通过（自签链 `UnknownError` 属预期，硬判据是签名块存在且指纹匹配）。
- `build-client-exe.js` 接入两处：打免安装 zip 之前签主程序、Setup 定稿后签安装包，保证 zip 里外都是已签 exe。
- 未配置 `WIN_CSC_FILE` 时如实 `skipped` 并写报告，不阻断出包。正式分发仍需购买 OV/EV 证书。

### 中英切换扩到主界面

- 新增「文本节点级」词条层：主界面标题、按钮、空态、分类名、直播分组、下拉选项按整段精确匹配替换，动态渲染的影视仓 / 跨仓搜片 / 下载队列 / 场景预设区块一并覆盖。
- 含片名、计数、错误码的句子不命中字典，保持中文兜底，不会翻出半截句子。
- 切回中文由英文译文反向表自动还原，无需维护两份字典。
- 实测：英文模式下命中 438 处；纯中文残留 112 种，几乎全是频道名与片名，疑似 UI 未覆盖仅 2 处（行内 `<b>` 拆句导致整段匹配失效）。

### 多架构与跨平台（如实登记）

- `ia32` 从「自动回退 x64」改为 `unsupported`：Electron 45 起官方不再发布 32 位 Windows 二进制，此前清单属虚标。
- 架构清单新增 `platforms`：Windows ready / macOS external（dmg 需 macOS 主机）/ Linux external（AppImage / deb 需 Linux 主机或 Docker）。
- 默认架构改为 `x64,arm64`；**arm64 与 x64 同为正式客户版**：走同一套客户净化（`/admin` 剥离、开发端静态面板剥离、入口硬开关），产出 `鸿汇影桌面版 Setup 1.7.80-arm64.exe`（108,383,602 B）与 `鸿汇影免安装 1.7.80-arm64.zip`（141,233,977 B），清单 `status=ready / customer=true` 并带下载地址，归档同步留档（`artifacts.arm64`）。
- 客户版出包脚本支持 `KH_CLIENT_ARCH=arm64`：自动指向 `dist/arch-arm64/win-arm64-unpacked`，产物名加 `-arm64` 后缀，`desktop-setup.exe` 别名只给 x64，两个架构互不覆盖。
- 踩坑记录：`electron-builder --prepackaged` 不带 `--x64/--arm64` 会按默认 x64 出力（arm64 内容被标成 x64 并覆盖 x64 包）；prepackaged 路径必须正斜杠，反斜杠会打成 410 KB 空壳。

### 工程与文档

- 新增脚本：`scripts/perf-baseline.js`（性能基线）、冒烟面板真点断言；工作区另有 UI 文案语料抓取与中英覆盖度核对脚本。
- 新增本文件；文档索引见 `鸿汇影·文档资料/鸿汇影·文档索引_v1.7.80.txt`。

## 1.7.79 / #1000193 — 2026-11-20

- 影视仓多仓管理：`kh_wh` + `kh_wh_sites`，上限 6 仓 / 单仓 300 站点 / 界面每仓展示前 40；兼容 TVBox-CatVod、简化 `sites[]`、base64 整份配置；旧 `kh_remote.url` 自动迁为「我的配置」仓。
- 适配层 `app/kh-src.js`（`KH_SRC`）：isApiSite / buildUrl / getText / parseBody / parsePlayUrls / search / category / detail / aggSearch；主进程新增 `kh:http-get` 代发，绕跨域。
- 跨仓搜片 UI：并发 6、单次最多 24 站，点线路拉详情出剧集，有外部播放器桥则外播否则复制并打开。
- 下载队列：队列上限 60、并发 1–4、`.part` + Range 续传、1 秒窗口限速、失败重试 2 次、完成通知、元数据落盘可重启回队、m3u8 明确拒绝。
- 场景预设四档（省电 / 观影 / 直播 / 长辈）联动动效、字号、夜间、睡眠定时、响度均衡；儿童设置优先。
- 出包链修 `cmd.exe ENOENT`（PATH 缺 System32 → shim 目录前置）。

## 1.7.78 / #1000192 — 2026-11-19

- 图标品牌化：红橙渐变 `#FF4D5E → #FF9A66` + 白色圆角播放键，9 档尺寸 + 鸿蒙图标。
- 安装向导三张位图（header 原生 / 2x、sidebar 164×314）。
- 九条工程补漏落地，双端出包、`verify-release` 全通过。

## 历史批次（归档索引自动记录）

### v1.7.58 / #1000172 · 2026-11-19

- 功能总数 38（上一版未记录功能 id）

### v1.7.57

- 功能总数 0（本版未记录功能 id）

更早批次见 `releases/` 归档与 `鸿汇影·文档资料/开发端开发排期_v1.7.70.txt` 台账（回滚索引共 19 版）。

### 平台改为应用内浏览（11-22 第五轮重出）

- 上一版把平台交给系统浏览器，用户否决；改为应用内「平台浏览」窗口，自带返回按钮。
- `electron-main.js` 新增 `openInAppBrowser()`：单例 BrowserWindow + `assets/browse.html` 工具栏
  （← 返回 / 前进 / 刷新 / 浏览器打开 / 回平台列表），平台页由 webview 承载；
  `will-attach-webview` 只放行 http(s)，`did-attach-webview` 把 guest 的 `_blank` 收在同一窗口内导航。
- `assets/browse-preload.js` 只暴露 `khBrowse.close / openExternal`，第三方页不继承该桥。
- 打包体积修正：`resources/app/dist` 里的上一版安装包缓存使 Setup 膨胀到 222MB，打包前清掉后回到 110MB 级。
- 本轮产物：x64 Setup 110,188,301 / `0e4cdbfd…`、x64 zip 145,653,985 / `1c6baf29…`、
  arm64 Setup 108,411,807 / `9f42394d…`、arm64 zip 141,279,305 / `d67a4e0e…`、客户 HAP 2,261,000 / `283b9c59…`、
  开发端 x64 110,243,304 / `3a95c51c…`、开发端 arm64 108,466,807 / `2edbc1f4…`。
- `verify-release` / `check-client-purity` 通过；公网站点仍为旧包（外部阻塞）。

### HAP 端同步应用内浏览（11-22 第六轮）

- 新增 `harmony/entry/src/main/ets/pages/BrowserPage.ets`：工具栏「← 返回 / 前进 / 刷新 / 回平台列表」，
  平台页用原生 Web 组件承载；`onBackPress` 先退页内历史，无历史才退出浏览页。
- `Index.ets` KaihongBridge 新增 `openSiteMode` / `openExternal`，并注册进 JS 代理；
  `main_pages.json` 增加 `pages/BrowserPage`。
- 剔除 `rawfile/www-dev-v1.7.85-backup`（旧前端副本，含 .md）：不剔则新壳包会把客户 HAP 顶到 3.34MB。
- 新 HAP：客户 2,261,000 / `283b9c59…`、开发端变体 2,261,003 / `de5e8288…`。
- 编译链路：`build_hap.py` → `hvigorw assembleHap`（PATH 必须含 System32，否则 es2abc 报 `spawn cmd.exe ENOENT`）
  → `hap-sign.js`。真机仍无目标，未实机点验。

### 双端「未开发能力」盘点与设备端补齐（11-22 第十轮）

- 盘点结论：桌面端 `preload.js` 的 11 类本机能力桥全部有实现；HAP 端原本只有设备信息 / 返回键 /
  屏幕方向 / 外部打开四项，下载队列、系统通知、环境信息在设备上只能弹「当前环境不支持」。
- HAP 端新增 `HapBridge`（`Index.ets`，注册为 JS 代理 `KHHap`）：`getEnv` / `notify` /
  `dlAdd` / `dlList` / `dlRemove` / `dlClear` / `dlReveal`。
  下载落地 `filesDir/downloads`，`request.downloadFile` 跑任务，进度与瞬时速度经 `__KH_DL_EVT` 回推；
  带 headers（Referer 防盗链）；m3u8 明确拒绝并提示用桌面端。
- 新增前端 shim `app/kh-hap-bridge.js`（HAP 副本同文件）：只在 ArkWeb / OpenHarmony / Kaihong 生效，
  把同步代理包成桌面同形 Promise（`khEnvInfo` / `khExternal` / `khNotify` / `khDl`，含 `khDl.on` 快照订阅），
  业务代码无需平台分支；桌面端加载即返回。
- 明确不做、也不假装能做的五项：DLNA 组播投屏、开机自启、全局媒体键、本机文件直读、HAP 静默安装
  （三方应用无 INSTALL_BUNDLE 权限），前端继续走既有降级文案。
- 编译坑：`arkts-no-untyped-obj-literals` 不接受嵌套对象字面量，事件改扁平 `Record`，
  环境信息用 `Record<string, Object | null>`。
- 产物：客户 HAP 2,297,050 / `f3798cb8…`、开发端 HAP 2,297,058 / `28eb5faa…`；
  x64 Setup 110,200,204 / `46a12e4b…`、x64 zip 145,654,832 / `116ee572…`；
  arm64 Setup 110,490,890 / `e90331eb…`、arm64 zip 143,382,107 / `d6a44151…`；
  开发端 x64 110,253,752 / `d5397a1e…`、开发端 arm64 110,545,546 / `ea297ccc…`。
- 链路：oneclick 14 步全过；arm64 补出（build-archs → 注入内置 HAP → patch 图标 → prepackaged →
  客户净化）；archive 8 件、verify 全过、ship 3/3；公网回读仍为旧包（等宿主发布）。
- 诚实边界：无真机（`hdc list targets` 为空），下载 / 通知 / 外部打开只做编译与包内静态核对。
### 设备端文件能力补齐（11-22 第十一轮）

- **补的缺口**：HAP 端导入备份只能粘贴文本、导出备份/诊断报告只能复制剪贴板。根因是 `<input type="file">` 在 ArkWeb 需要内核 `onShowFileSelector` 回调才弹系统文件框，以及 `Blob + <a download>` 在 ArkWeb 没有下载目录、静默无效。
- **原生**（`harmony/entry/src/main/ets/pages/Index.ets`）：新增 `@ohos.file.picker` / `@ohos.util`；`HapBridge.saveText` / `openText`（DocumentViewPicker 保存/选择 → `fs` 写读，64 MB 上限，UTF-8 忽略 BOM），结果经 `__KH_FILE_EVT` 回推；Web 组件新增 `onShowFileSelector`；`KHHap` 注册 `saveText` / `openText`。
- **前端**：`app/kh-hap-bridge.js` 新增 `__KH_FILE_EVT` 与 `khFile`（3 分钟兜底）；`kh-config.js` 的 `downloadTextFile`、`kh-admin.js` 的备份导出/导入改为「有文件桥先落盘/读盘，失败再退回剪贴板/粘贴」。桌面端无 `khFile`，行为不变。
- **仍不做**：`khDl` 暂停/续传（DownloadTask 无 API）、设备端 m3u8 合并（无 ffmpeg）、网页全屏回调（已窗口级全屏，无额外收益）、HAP 静默安装（无 INSTALL_BUNDLE 权限）、DLNA 组播 / 开机自启 / 全局媒体键 / 本机文件直读 / 设备端画中画。
- **产物**：客户 HAP `2,313,598` / `76449e90…`；开发端 HAP `2,313,604` / `2177d163…`；x64 Setup `110,206,761` / `4ebe27df…`；x64 免安装 `145,661,831` / `0425803e…`；arm64 Setup `110,497,456` / `104df104…`；arm64 免安装 `143,389,107` / `06959b1d…`；开发端 x64 `110,260,318` / `7a682b63…`；开发端 arm64 `110,551,605` / `f45f5a71…`。
- **验收**：`verify-release` 全过（末行「交付验收全部通过」）；`oneclick` OK 14 / WARN 4 / ERR 0；arm64 手工补齐（build-archs → 注入 HAP → patch 图标 → prepackaged → build-client-exe arm64）。真机仍未接入（`hdc list targets` 为空），文件选择器只做编译与包内静态核对。

### 设备端再补两处 + 出包链 zip 取值修复（11-22 第十二轮）

- **影视仓配置文件一键读取**：设备端 `wh-pick-file` 以前只提示「仅桌面版可用」；现在优先 `khConfigFile`，缺则走原生 `khFile.openText`，选好 `.json/.txt/.conf` 读回即导入。
- **网页下载链接接管**：ArkWeb 里点第三方页的下载按钮毫无反应。`Index.ets` 新增 `onDownloadStart`，把 url / contentDisposition 文件名 / mimetype 交给 `HapBridge.dlAdd` 进应用内下载队列（m3u8 仍拒绝）。
- **修出包链 bug**：`auto-release.js` 用 `readdir().find(...)` 取「免安装 zip」，dist 根同版本有 x64 与 `-arm64` 两个 zip，历史上多次取到 arm64，使客户说明、文件导航、公网 `win.bin` 的尺寸与哈希全变成 arm64 的值。现明确排除 arm64；客户说明生成器同时补上 ARM64 两个包与别名说明（生成器改完换版自动生效）。
- **产物**：客户 HAP `2,312,383` / `cca79fdc…`；开发端 HAP `2,312,391` / `78190608…`；x64 Setup `110,207,636` / `f5acfca3…`；x64 免安装 `145,663,060` / `efe610e9…`；arm64 Setup `110,498,322` / `26928f94…`；arm64 免安装 `143,390,324` / `0bc97f8c…`；开发端 x64 `110,261,186` / `805fbb1e…`；开发端 arm64 `110,552,467` / `e184926f…`。
- **验收**：oneclick 8/8 通过；arm64 手工补齐；`auto-release` 重跑后 bin 已是 x64 值；公网仍为旧包待宿主发布。

## v1.7.86（#1000200 · 2026-11-22）

- **客户端静默覆盖安装**：设置 → 版本与升级 新增「安装方式」。选「静默装」后，安装包过 SHA256 校验即自动退出 → `setup /S /D=<当前目录>` 覆盖 → 约 10 秒后自动重开。只对 Setup 目录生效（需有 `Uninstall*.exe`）；免安装 zip 目录由主进程拒绝并自动改回弹向导。前端仍保留原「弹向导」默认，安全闸（SHA256/体积/仅本机）不变。
- **设备端用外部播放器打开**：`KaihongBridge.openVideo(url, mime)` 以 `startAbility` + `video/*` 交给系统视频应用；`khExternal.play` 暴露给前端，无可用应用时如实提示。
- **出包链修正生效**：`auto-release` 取免安装 zip 时排除 `-arm64`，客户说明补 ARM64 两组与别名 zip；本版 bin 已为 x64 值。
- **产物**：客户 HAP `2,312,384` / `18093f52…`；x64 Setup `110,210,804` / `5db97609…`；x64 免安装 `145,679,229`；arm64 Setup `110,501,482` / `4e213984…`；arm64 免安装 `143,393,907`；设备端 KaihongMovie `1,037,843` / `014ca56d…`。
- **验收**：oneclick 13/14（8.2 因口令未注入失败，已补跑成功）；verify「交付验收全部通过」；archive 归档 8 件；ship-client 3/3，公网待宿主发布。
