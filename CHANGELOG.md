# 鸿汇影 · 变更日志

版本号与 #code 以 `server/manifest.json` 的 `release.latest` 为唯一真相源，`scripts/version.js --check` 核对 13 处一致性。

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
