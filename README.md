# 鸿汇影 · 免费桌面版（HongHub-Desktop）

一个**免费**、**桌面双击即跑**的影视聚合工具，内建：

- 🛰️ **自动远程收集问题**：影站自身捕获脚本 / 资源 / 播放 / 平台 / 清单等异常，脱敏后自动上报到本地收集服务（默认开启，可在「问题」中心暂停）。
- 🔧 **一键自愈**：收集服务收到问题后，可在看板点「🔧 一键自愈」，自动重排坏源、降级失效线路并刷新清单，桌面端**实时更新**拉到修复后的源。
- 🧩 **可扩展功能**：服务端 `features/manifest.json` 增加一条即可**免重装**在线新增工具入口（示例含：远程看板、诊断报告、源线路排行、一键自愈）。
- 🚀 **同时更新发布**：在看板或桌面端「🧩 扩展工具」点「🚀 同步更新发布」，一次调用**同时**完成「重排坏源 / 刷新清单（更新）」与「内容发布（刷新 `contentVersion` 与发布时间）」，所有桌面端通过实时更新轮询立即拉到新清单，无需逐台重装。**内容发布不会抬高应用版本**，避免「提示有新版本却下载到同一个安装包」的假更新。
- ⚡ **实时更新**：源清单 / 平台 / 版本信息由本地收集服务通过 `/api/manifest` 下发，桌面端启动时自动拉取，无需重装。
- 🤖 **智能自治循环**：一次运行自动完成「提取问题 → 修复坏源 → 优化清单 → 内容发布 → 自动补装缺失功能 → 自动修 Bug → 功能清单同步」，也可设为自动化调度的默认模式，全程无需逐项点按钮。
- 🐞 **自动修 Bug（全自动，无需人工复核）**：自动收集上报 / 反馈 / 两端前端源码 / 发版产物 / 功能清单 → 自动提取脚本语法、版本自洽、功能快照、产物 SHA256、下载可用性等问题 → **每一类都自动处置** → 自动复检到归零；服务启动即自动运行并按周期巡检，剩余问题自动排队重试，看板不再出现「待人工」项。
- 📦 **功能预设包**：内置一批开箱即用的功能（钉钉 / 企业微信 / 飞书通知、每日备份清单、定时播报），看板「＋ 添加预设」点一下即加好，非技术用户免配置。
- 🔔 **真·自动更新**：`npm run pack` 出包即发新版（应用版本、安装包名、`package.json.version` 一起随真实产物递增）→ 旧客户端弹「🆕 发现新版本」→「⚡ 校验并安装」自动核对 SHA256 并拉起安装向导；开鸿端下载 HAP 更新包并显示校验值，由系统安装器 / hdc 完成安装（应用内不静默安装）。
- 🌐 **所有包不限设备 · 不限内存**：一次发版同时产出「免安装在线影站 / 深开鸿 HAP / 桌面完整安装包」三条通道；Windows x64·ia32·arm64、深开鸿、macOS / Linux / 手机 / 未识别设备都自动选到能用的成品，小内存与未知设备自动保底免安装在线版，绝不下发装不了的包。
- 🧠 **内存自适应流畅播放**：按内存分 4 档（≤1GB / ≤2GB / ≤4GB / >4GB）设缓冲字节与秒数硬上限（最低 6MB / 4s）并锁定最低码率；内存看门狗在堆吃紧 / 页面进后台时自动降档与恢复，弱机与 ARM 开发板也能流畅播放。
- 🔄 **成品自动更新（内容永远最新）**：两端启动与每 10 分钟自动比对 `versionCode`，自动同步最新功能清单 / 源清单 / 播放档位；免安装通道天然永远最新，完整包与 HAP 仅提示并核对 SHA256（安装仍需用户确认），治理循环不制造假更新。
- 🧬 **反馈建议自动长出新功能**：自动从反馈 / 上报里提取「新功能 / 批量下发 / 全架构 / 流畅播放 / 不限内存 / 自动更新 / OS 版本跟随」等诉求，去重后自动写入功能清单、同步快照、注入两端前端并随发版下发，零人工复核。
- 🖥️ **跟随所有操作系统版本**：两端自动检测并回传 OS 版本 / API / 架构 / 内存，中枢按系统家族与版本自动优化兼容策略（旧版 Windows 禁用 Worker、深开鸿优先原生 HLS、低内存收紧并发）、自动修复漂移、刷新功能快照后随下发清单同步更新；即使某系统从未回传也有基线适配。
- 🧭 **中枢自动发现 + 可选访问口令**：`/health` 下发多个候选中枢地址，深开鸿端并行探测并缓存可用地址，路由器重新分配 IP 后可自愈；需要限制局域网访问时设 `KH_ACCESS_TOKEN` 即可（默认关闭，仍「不限网络」）。
- 📌 **无托盘 · 可随时退出 · 全中文**：点窗口 X 即彻底退出（连本地服务一起关），单实例锁避免重复双击堆积进程；窗口标题、菜单、安装向导全中文，另提供 Ctrl+Q 随时退出。

> 影站前端与开鸿（KaihongOS）版「鸿汇影」同源（清单 v10 · 68 频道 / 109 源 / 29 平台），桌面版额外提供远程收集与自愈闭环。

---

## 一、最快上手（无需安装任何依赖）

需要本机有 **Node.js 18+**（[nodejs.org](https://nodejs.org) 一键安装）。

```bash
# Windows：双击 start.bat
# macOS / Linux：
chmod +x start.sh && ./start.sh
```

浏览器会自动打开 `http://localhost:8787/`。关闭启动窗口即停止服务。

或手动：

```bash
node server/server.js
# 然后浏览器打开 http://localhost:8787/
# 看板（问题汇总）： http://localhost:8787/
```

---

## 二、远程收集「上线」到公网（多人 / 跨设备）

桌面版默认把脱敏问题上报到**本机** `http://localhost:8787/api/report`，数据不离开你的电脑。

要把它变成真正的**远程**收集（多个用户的桌面端 / 真机都上报到一个中心），把 `server/` 部署到任意免费 Node 托管即可：

1. 把本目录（含 `app/ server/ features/`）上传到 [Railway](https://railway.app) / [Render](https://render.com) / [Fly.io](https://fly.io) / [Glitch](https://glitch.com) 等免费平台，启动命令填 `node server/server.js`，端口用环境变量 `PORT`。
2. 部署成功后得到公网地址，例如 `https://kh-cinema.yourhost.app`。
3. 在各桌面端 / 真机的「问题」中心，把远程收集地址改成该公网地址（或让发版流水线写入），即可跨设备汇总问题。
4. 打开该公网地址即是在线看板，可查看上报、点「一键自愈」。

> 隐私：收集服务**不记录来源 IP 明文、不记录账号与任何片源内容**；上报体里的 URL 已在客户端裁成域名，仅含类别 / 错误码 / 消息 / 次数 / 站点域名 / 匿名设备 ID。可选 `REPORT_TOKEN`、`FIX_TOKEN` 环境变量开启写入 / 修复校验；`KH_ACCESS_TOKEN` 用于限制局域网内的读取与下载（默认关闭，详见第十八节）。

---

## 三、打包成真正的安装包（exe / dmg / AppImage）

本目录已附带 Electron 配置，可在**你自己的电脑**上打包成跨平台安装程序：

```bash
npm install        # 安装 electron / electron-builder（仅打包时需要）
npm run pack       # 一键构建：发版 → 两端前端/HAP → 自检 → 出包 → 更新产物 → 桌面
npm run verify       # 交付验收：版本 / SHA256 / 桌面交付 / 下载端点 / 自动修 Bug / 不限设备选路 / 自动更新 / 无假更新
npm run test:bugfix  # 自动修 Bug 回归自检：注入 4 类故障，验证「自动处置 + 自动复检归零」后完整还原
npm run test:feature # 反馈→新功能→自动修复→批量下发→不限设备/内存→自动更新 回归自检
npm run batch        # 单独刷新 dist/archs.json 与 dist/delivery.json 下发清单
KH_RELEASE_BUMP=0 npm run pack   # 沿用当前版本重打包（调试用，不跳版本号）
```

`npm run pack` 实际执行 `scripts/build-exe.js`，全流程自动：

| 步骤 | 脚本 | 作用 |
|---|---|---|
| 0 发版 | `scripts/release.js` | 应用版本随真实产物递增；同步两端页面 `KH_APP_CODE` / 内嵌清单、功能快照与更新地址（**一次构建 = 一次真实发版**） |
| 0.1 挖掘 | `server/feature-miner.js`（由 `release.js` 调用） | 从反馈 / 上报自动提取新功能诉求 → 自动加入功能清单 → 同步功能快照（零人工复核，本次长出的能力随包下发） |
| 0.5 / 0.8 | `harmony/build_hap.py` + 本地 HAP 工程 | 重生成开鸿端前端、注入适配并自签，保证两端版本一致 |
| 0.9 快照 | `stageSnapshots()` | 把本次发版的两端页面刷成「良好页面快照」，自动修 Bug 恢复时不会把页面回退到上一版 |
| 1 自检 | `scripts/prebuild-check.js` | 抓真实看板/影站/开鸿端页面，检查脚本语法、按钮函数、页面元素、版本基线、功能快照、接口版本；**任一失败即阻断打包** |
| 2–4 出包 | `electron-builder --dir` → `rcedit` → `--prepackaged` | 绕开构建期 exe 句柄冲突，稳定写入主程序自定义图标与版本信息 |
| 3.5 内置 | `stageUpdates()` | 把已签名 HAP、发版清单、下发清单与 OS 版本适配矩阵放进应用 `resources/app/updates/` |
| 5 同步 | `scripts/postpack.js` | 生成 `dist/desktop-setup.exe`（硬链接，不重复占 77MB）、HAP、sha256 与 `dist/release.json` |
| 5.5 下发 | `scripts/build-archs.js` + `server/device-optimizer.js` | 生成 `dist/archs.json`、`dist/delivery.json`、`dist/os-profiles.json`：3 条通道 / 4 个内存档 / 全 OS 版本适配矩阵 / 多架构产物 / SHA256 / 自动更新策略（分块哈希，不把 77MB 整包读进内存） |
| 6 交付 | `deliver()` | 安装包 + `HongHubMovie.hap` 一起复制到桌面 |
| 验收 | `scripts/verify-release.js` | `npm run verify`：版本基线、包内版本、产物 SHA256、桌面交付一致性、全部接口与下载端点、自动修 Bug **全自动闭环**、5 类设备 / 内存组合选路、自动更新版本比对、治理循环不制造假更新 |

打包后双击安装包即是一个独立桌面应用：自动拉起本地收集服务并用内置窗口加载影站，无需手动开浏览器、无需联网（远程收集默认指向本地，不上传任何第三方）。

---

## 四、目录结构

```
HongHub-Desktop/
├─ app/                影站前端（由 build_desktop.py 从 HongHubMovie 同步并注入桌面适配）
│  └─ index.html       含问题中心、远程收集默认开启、扩展工具入口
├─ server/
│  ├─ server.js        统一服务：看板 + /health(hubs) + /api/manifest + /api/features(+/sync) + /api/fix
│  │                  + /api/update-publish + /api/automation(+/run) + /api/govern(+/run)
│  │                  + /api/bugfix(+/run) + /api/update/install + /api/batch + /api/flow
│  │                  + /api/delivery(+/plan) + /download/ + 可选访问口令
│  ├─ auto-bugfix.js   自动修 Bug：收集 → 提取 → 自动处置 → 自动复检 → 优化功能（全自动，零依赖）
│  ├─ feature-miner.js 反馈建议 → 自动提取新功能 → 自动添加（零人工复核）
│  ├─ delivery-plan.js 下发计划：不限设备 / 不限内存 + 自动更新比对（/api/delivery/plan 的数据源）
│  ├─ device-optimizer.js OS 版本检测回传 → 自动优化 → 自动修复 → 下发同步更新（跟随所有系统版本）
│  ├─ feature-version.json  功能清单随发版打下的快照（/api/features 的版本来源）
│  └─ manifest.json    实时更新源（自动由 build / 自愈 / 自动化 / 治理刷新）
├─ features/
│  ├─ manifest.json    可插拔功能清单（增加条目即在线新增工具）
│  └─ presets.json    功能预设包（钉钉/企微/飞书通知、备份、播报等，看板「＋ 添加预设」一键加）
├─ scripts/
│  ├─ release.js       发版：一次构建 = 一次真实版本（同步两端页面、功能快照、package.json.version）
│  ├─ prebuild-check.js 打包前自检（语法/按钮/元素/版本/功能快照/接口），任一失败即阻断
│  ├─ build-exe.js     一键出包主流程
│  ├─ postpack.js      生成 dist/desktop-setup.exe、HAP、sha256 与 dist/release.json
│  ├─ build-archs.js   生成 dist/archs.json + dist/delivery.json（自动批量下发清单，npm run batch）
│  ├─ verify-release.js 交付验收（npm run verify）：版本/哈希/端点/选路/自动更新/假更新检查
│  ├─ selftest-bugfix.js 自动修 Bug 回归自检（npm run test:bugfix）：故障注入 → 自动修复 → 复检 → 还原
│  └─ selftest-feature-flow.js 反馈→新功能→下发→不限设备/内存→自动更新 回归自检
├─ assets/            icon.png / icon.ico（安装包与主程序图标）
├─ server/data/        运行时生成：reports.jsonl（上报）、feedback.jsonl（反馈）、
│                     auto_runs.jsonl / govern_runs.jsonl（运行历史）、latest_bugfix.json（最近一次体检），可删
├─ build_desktop.py    从 HongHubMovie 复用影站、提取最新清单、注入桌面适配（含 KH_APP_CODE / KH_PRODUCT）
├─ gen_assets.py      生成 assets 图标（仅改图标时需要）
├─ electron-main.js    Electron 入口（无托盘、X 即退出、单实例锁、端口识别与服务自愈）
├─ start.bat / start.sh 零依赖一键启动器
└─ package.json        scripts + 打包配置（version 由发版脚本跟随更新）
```

---

## 五、开发者：同步最新影站与清单

前端来自鸿汇影工程 `HongHubMovie`，改动影站后重新生成桌面版：

```bash
python build_desktop.py
```

它会：复制影站资源、注入桌面适配（默认开启远程收集、实时拉取 manifest/features）、并导出 `server/manifest.json`。

### 一键「同时更新发布」

当你既要修源、又要让所有桌面端拿到新版本时，不必分两步：

```bash
# 方式 A：在本地看板 http://localhost:8787/ 点「🚀 一键同时更新发布」
# 方式 B：桌面端「🧩 扩展工具」→「同步更新发布」
# 方式 C：直接调接口
curl -X POST http://localhost:8787/api/update-publish
```

该接口内部依次执行：

1. **更新**：等同 `/api/fix` —— 重排坏源、刷新 `server/manifest.json` 的 `sources`。
2. **内容发布**：`release.latest.contentVersion +1`、`publishedAt` 置为当前时间，并写回清单；`runFix()` 只刷新 `sources`，**不会**用影站随包的旧 release 覆盖中枢清单。

桌面端每 ~9 秒轮询 `/api/manifest`，立即拿到刷新后的源清单与发布时间——这就是「内容发布」落到终端的效果。

> **应用版本与内容版本是两回事**：`versionCode` / `versionName` 只在 `npm run pack` 真的产出新安装包 / HAP 时由 `scripts/release.js` 递增，客户端据此弹「🆕 发现新版本」并校验 SHA256 后安装。运行期的「同步更新发布」和自治循环都**不抬应用版本**，因此不会再出现「提示升级但下载到同一个包」的假更新。
>
> 注意：`python build_desktop.py` 会从上游 `HongHubMovie` 重新导出清单，可能把 `release` 重置回上游基线；正式发版请统一走 `npm run pack`，它会把 `manifest.json`、两端页面、功能快照和 `package.json.version` 一次性对齐。

---

## 六、免代码加功能（可视化功能管理）

不会写代码也能加工具：**打开看板 `http://localhost:8787/` → 拉到底部「🧩 功能管理」**，即可在线添加 / 编辑 / 启用停用 / 删除功能，并支持导入导出清单，全部**免改 JSON、免重装**。

- **添加**：点「＋ 添加功能」，填名称 + 选类型即可：
  - `打开链接`：打开一个网址（如帮助页、官网）。
  - `内置动作`：诊断报告 / 源线路排行 / 一键自愈 / 同步更新发布 / 自动化运行。
  - `运行命令(本机)`：在运行本工具的电脑上执行一条命令（如 `python C:/x/clean.py`、`ping 8.8.8.8`），结果回显到看板。
  - `调用外部接口`：向指定 URL 发 POST（可带 JSON 请求体），用来对接你自己的通知 / 自动化平台。
- **运行 / 编辑 / 停用 / 删除**：每条功能卡片上都有对应按钮；「执行前需二次确认」可避免误触。
- **导入 / 导出**：导出当前清单为 JSON（分享 / 备份），导入一段功能清单 JSON 即批量合并（同名 id 自动覆盖更新）。
- 桌面端里点「🧩 扩展工具 → 功能管理」也能直达看板同一页面。

> 说明：自定义 `运行命令` 会在本机执行命令，仅建议你自己在本机 / 受信任环境使用；若对外公开部署，请设置 `FIX_TOKEN` 环境变量开启写操作校验。

接口对应：`GET /api/features`（列表）、`POST /api/features`（op=`add|update|remove|toggle|import`）、`POST /api/feature/run`（按 id 运行脚本 / 调接口）。

---

## 七、自动化运行（定时执行，全程无需人工操作）

工具自带调度器，**服务一启动就按设定周期自动运行「更新 + 内容发布」**，你什么都不用做；用绿色启动器常开服务、或自行配置计划任务即可无人值守（打包版桌面应用本身不自启、不常驻）。

- 默认每 **24 小时**自动跑一次（重排坏源 + 刷新清单 + 内容发布），运行在后台、**不卡界面**；不会抬高应用版本，应用版本只由 `npm run pack` 真实出包时递增。
- 看板「⚙️ 自动化运行」区块实时显示：是否开启、下次运行时间、上次结果、历史记录；也可点「⚙️ 立即运行自动化」手动触发一次（可选，不强制）。
- 桌面端「🧩 扩展工具 → 自动化运行」同样可查看状态并一键触发。
- 打包后的桌面应用**不自启、不常驻**：关闭窗口即彻底退出，不会在后台留下进程。

配置项（均为可选，默认值即可用）：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AUTO_RUN_ENABLED` | `1`（开启） | 置 `0` 关闭自动化 |
| `AUTO_RUN_INTERVAL_HOURS` | `24` | 每隔多少小时跑一次 |
| `AUTO_RUN_HOUR` | 空 | 若设为 `0–23`，则每天该整点运行一次（优先级高于间隔） |

> 说明：自动化里的「更新」依赖同机 `HongHubMovie` 工程的体检流水线（仅开发者机有）。若你是纯使用端、没有该工程，把 `AUTO_RUN_ENABLED=0` 关掉即可，工具其余功能不受影响；或仅在「有 HongHubMovie 的开发机」上开启自动化。

## 八、本机桌面端部署（免代码，双击即用）

两种**零代码**方式，任选其一：

1. **安装包（推荐，最像普通软件）**
   在本机执行一次 `npm install`，再 `npm run pack`，会在 `dist/` 生成安装程序（Windows=`*.exe` 安装包 / macOS=`*.dmg` / Linux=`*.AppImage`）。双击安装后，桌面出现「鸿汇影桌面版」图标，**双击即用、点 X 即退出**，全程无需任何命令。
2. **绿色启动器（无需安装）**
   只要本机装了 Node.js（https://nodejs.org 选 LTS），**双击 `start.bat`**（Windows）或 `start.sh`（macOS/Linux）即可：自动起服务 + 自动开浏览器，关闭窗口即停止。

## 十、智能自治循环（自动提取问题 → 修复 → 优化 → 发布 → 加功能）

把零散的运维动作串成一个闭环，**一次运行全做完**，无需逐项点按钮；也可设为自动化调度的默认模式，实现完全无人值守。

- **怎么用**
  - 看板「🤖 智能自治循环」区块 → 点「🤖 立即运行自治」；
  - 桌面端「🧩 扩展工具 → 智能自治」；
  - 接口：`GET /api/govern`（状态/历史）、`POST /api/govern/run`（立即运行）。
- **循环步骤**
  1. **提取问题**：扫描清单里 `status` 非 `ok` 的失效源，并汇总上报中 `error` 级问题。
  2. **修复**：若发现问题，自动跑「一键自愈」重排坏源、刷新清单。
  3. **优化**：剔除 `dead/failed` 源、把可用源排到前面、写回清单。
  4. **内容发布**：只刷新 `contentVersion` 与 `publishedAt`，让各桌面端拉到新清单；**不抬高应用版本**（应用版本只由 `npm run pack` 真实出包递增，避免假更新）。
  5. **加功能**：自动补装 `features/presets.json` 里尚未存在的功能。
  6. **自动修 Bug + OS 版本自动优化 + 功能同步 + 成品下发**：跑一遍 `server/auto-bugfix.js`（自动处置 + 自动复检）、`server/feature-miner.js`（反馈自动长出新功能）与 `server/device-optimizer.js`（OS 版本检测回传后的自动优化 / 修复），把功能快照、下发清单、OS 适配矩阵与结果一并写进 `finalProducts`（含 `features`、`featureMining`、`batch`、`delivery`、`deviceOptimization`、`bugfix`），看板「🧩 反馈自动长出新功能 · 📦 自动批量下发」实时可见。
- **接入自动化调度**：设环境变量 `AUTO_GOVERN=1`，则定时自动化改为跑「治理循环」而非单独的更新+发布。

> 说明：第 2 步依赖同机 `HongHubMovie` 工程的体检流水线（开发者机才有）；纯使用端没有该工程时，节点 2 会跳过、其余步骤照常。第 4 步前后 `versionCode` 保持不变，是刻意设计，不是发布失败。

## 十一、功能预设包（开箱即用，免配置）

内置一批实用功能，非技术用户点一下即加好：

- 打开看板 `http://localhost:8787/` → 「🧩 功能管理」→ **「＋ 添加预设」** → 选一项即添加。
- 预设清单（定义在 `features/presets.json`）：
  - 📨 **钉钉通知** / 💬 **企业微信通知** / 📲 **飞书通知**：向对应群机器人推送「自治完成」消息，编辑时把地址里的「在此粘贴」换成你的 Webhook 即可用。
  - 💾 **每日自动备份清单**：把当前 manifest 源清单备份到 `server/backup/`（可接自动化）。
  - 📣 **定时播报可看内容**：生成本次可播放频道/线路数摘要。
  - 📊 **打开在线看板**：一键打开问题看板（免记地址）。
- 治理循环也会自动把这些预设补装（默认停用，启用即生效），随工具「自我生长」。

## 十二、真·自动更新（一次构建 = 一次真实发版）

不会再出现「弹了新版本却下载到同一个安装包」或「下载 404」。整条链路只由 `npm run pack` 驱动：

1. **发版**：`scripts/release.js` 递增 `server/manifest.json` 的 `versionCode / versionName`，同时同步两端页面的 `KH_APP_CODE` / 内嵌 `kh-release` / `appVersion`、生成 `server/feature-version.json`、写入 `package.json.version`（安装包名与版本信息一起跟随）。`KH_RELEASE_BUMP=0` 可沿用当前版本重打包。
2. **出包与产物**：`postpack.js` 生成 `dist/desktop-setup.exe`（同卷硬链接，不重复占 77MB）、`dist/honghub-harmony.hap`、各自的 `*.sha256`，以及 `dist/release.json`（版本 + 产物大小 + SHA256 + 功能快照）。HAP 与基础清单还会内置进应用 `resources/app/updates/`。
3. **下发**：`/api/manifest` 附带 `release.artifacts` 与 `desktopSha256 / hapSha256`；`/download/desktop-setup.exe`、`/download/honghub-harmony.hap` 立即分发真实产物。也可自行托管到对象存储并用 `DOWNLOAD_URL` 改写地址。
4. **终端提示**：桌面端每约 9 秒轮询 `/api/manifest`，`versionCode` 高于本地 `KH_APP_CODE` 时弹「🆕 发现新版本」横幅，显示版本号与 SHA256 前缀，提供两个按钮：
   - **⬇️ 下载安装包**：直接打开 `/download/desktop-setup.exe`；
   - **⚡ 校验并安装**：调 `/api/update/install`，服务端**仅允许本机来源**（其它 IP 返回 403），核对 SHA256 后拉起安装向导，由用户确认安装。应用内不做静默安装。
5. **深开鸿端**：横幅说明「下载 HAP → 核对 SHA256 → 由系统安装器 / `hdc` 安装」，并显示校验值；`hapAutoInstall` 已明确置为 `false`，不宣称应用内自动安装。

- 桌面端「🧩 扩展工具 → 检查新版本」可手动立即触发一次检查。
- 运行期的「同步更新发布」/ 自治循环只做**内容发布**，不动应用版本；因此客户端不会因看板操作而误报升级。

## 十三、无托盘 · 可随时退出 · 全中文

按使用反馈调整后的桌面端行为：

- **点 X 即彻底退出**：不再缩到托盘、不再留后台进程，内置本地服务随窗口一起关闭；`Ctrl+Q` 或中文菜单「退出」也可随时结束。
- **单实例锁**：重复双击只聚焦已有窗口，不会越点越多进程。
- **全中文**：窗口标题、应用菜单、安装向导、桌面快捷方式均为中文。
- **服务韧性**：打包后用 `ELECTRON_RUN_AS_NODE=1` 拉起 `server/server.js`，等 `/health` 校验通过才加载页面（避免白屏）；8787 被占用时顺延 8788，若已有本应用的中枢则直接复用；服务意外退出会自动重启。
- 图标依赖 `assets/icon.ico / icon.png`，由 `gen_assets.py` 生成；主程序图标与版本信息在 `--dir` 之后由 `rcedit` 写入，绕开构建期 exe 句柄冲突。

---

## 十四、说明

- 本工具不内置、不抓取任何未授权影视资源；片源由使用者自行确保其播放权限。
- 远程收集默认**仅本机**；上线公网需你自行部署并承担相应运营责任。
- 实时更新只更新「源 / 平台 / 版本信息」；桌面客户端**自身**的升级走 `npm run pack` 真实出包，客户端按 `versionCode` 比对并校验 SHA256 后由用户确认安装。运行期的「发布」只是内容发布，不会抬高应用版本、不会制造假更新。
- 自动化运行在后台异步执行，运行期间界面与其它请求照常响应，不会卡顿。
- **改名（HAP / 产品名）**：看板标题与窗口标题由单一变量控制——改 `server/server.js` 顶部的 `PRODUCT_NAME`（或启动时设环境变量 `PRODUCT_NAME=你的名字`），以及 `build_desktop.py` 顶部的 `PRODUCT_NAME`；安装包名再改 `package.json` 的 `productName` / `appId` 即可，全站统一跟随。

## 十五、深开鸿 / KaihongOS 端（HAP）

同一套前端也能打包成 **HAP**，装到深开鸿（KaihongOS / OpenHarmony）设备运行，与桌面端共享同一份源清单与功能清单。

- 工程位于 `harmony/`（OpenHarmony Stage 模型），用 ArkTS `Web` 组件加载本地前端。
- 构建（**自动带上桌面中枢网络地址**，深开鸿端开箱即连）：

  ```bash
  cd harmony && python build_hap.py
  ```

  脚本自动探测本机所有局域网 IP，把**多个候选中枢地址**（`KH_HUB_CANDIDATES`）注入前端；深开鸿端并行探测 `/health`、校验是本应用的中枢后缓存可用地址，路由器重新分配 IP 也能自愈。也可用 `KH_HUB=http://地址:8787 python build_hap.py` 显式指定。
- 用 **DevEco Studio** 打开 `harmony/` → 勾选「自动生成签名」→ 运行到 KaihongOS 设备即可（详见 `harmony/README.md`）。
- **不限网络**：Web 组件已放行混合内容（`mixedMode(All)`）并申请 `INTERNET` 权限；桌面服务端 CORS 已全开（`*`）；中枢同步为非阻塞，连不上中枢时看片照常。因此深开鸿端既能连中枢联动（看板 / 触发自愈·自治），也能脱离中枢独立看片。
- 改名同样单点：`harmony/build_hap.py` 顶部 `PRODUCT_NAME`（默认「鸿汇影」）。

## 十六、自动修 Bug（全自动 · 无需人工复核）

对应 `server/auto-bugfix.js`，零依赖、纯同步。**服务启动约 20 秒后自动跑一轮，之后默认每 30 分钟自动巡检**（`KH_BUGFIX_INTERVAL_MS` 可改周期，设为 `0` 关闭周期巡检）。看板按钮只是「可选的立即体检」——不点也会自动跑，跑完不需要任何人确认、复核或点「下一步」。

- **入口**：看板「🐞 自动修 Bug」区块；`GET /api/bugfix`（最近一次结果）、`POST /api/bugfix/run`（立即体检）。智能自治循环也会自动跑一遍，结果进入 `finalProducts.bugfix`。
- **自动收集**（5 类来源）：`server/data/reports.jsonl`（`/api/report` 上报）、`feedback.jsonl`（自动反馈通道）、桌面端与开鸿端前端源码、`release.json`（项目 `dist/` 或应用内置 `updates/`）、`features/manifest.json` + `presets.json`。
- **自动提取**（确定性检查器）：前端脚本语法（`vm.Script`）、页面 `KH_APP_CODE` 与内嵌 `kh-release` 自洽、功能快照 hash / 版本、产物文件与 SHA256 / `.sha256`、下载端点可用性、开鸿适配标记、近 24 小时高频 `error` 级上报。
- **自动处置：每一类问题都有处置器，不存在「需人工 / 待人工」状态**
  - 脚本语法错误 → 优先用 last-known-good 快照 / 打包副本整段恢复（语义完全不变）；无副本时才做「通过 `vm.Script` 验证才写回」的闭合符补全；仍失败则自动重建开鸿页面、隔离异常脚本段并备份原文。
  - 页面缺失 / 版本漂移 → 自动重建开鸿页面、从快照 / 打包副本恢复，自动补齐 `KH_APP_CODE` 或内嵌清单。
  - 功能快照过期 → 自动重算 `server/feature-version.json`。
  - 产物缺失 / 校验值不符 / 下载 404 → 自动从 `dist` / 内置 `updates` / 桌面 / HAP 签名目录定位源，硬链接补回别名，重算 SHA256 与 `release.json`。
  - 开鸿适配标记缺失 → 自动执行 `harmony/build_hap.py` 重生成适配页面。
  - 高频错误上报 → 自动归档并写入水位线，后续只报新增，不重复刷屏。
- **自动复检**：每轮修完立刻重新扫描，最多 3 轮直到归零。未清零的自动写入 `server/data/bugfix_queue.jsonl`，由下一轮 / 下次出包继续自动处理，**不需要人工介入**。
- **自动优化功能**：按 bug 类型自动启用 / 补装 `fix` / `updatecheck` / `report` / `automation`，并重算功能快照，避免下一轮重复报同一问题。
- **安全约束**：写回前一律做整页语法验证；破损页面自动备份到 `server/data/snapshots/broken-*.html`，良好快照保存在同目录并在每次发版 / 每轮体检时按版本自动刷新（旧版快照会被拒绝使用）；精简打包环境没有 `harmony/` 与 `dist/` 时相关检查自动跳过，不制造误报。
- **结果落盘**：`server/data/latest_bugfix.json`。`summary.manual` **恒为 0**，`autoHandled = total`，`verified=true` 表示自动复检归零；`verification.perRound` 记录每轮发现 / 残留数。
- **回归自检**：`npm run test:bugfix` 注入脚本语法错误、页面版本漂移、功能快照过期、产物校验值损坏 4 类故障，跑一轮闭环并断言「全部自动处置 + 自动复检归零 + 零人工项」，最后无条件还原所有文件。实测 `total=4 / fixed=4 / manual=0 / unresolved=0 / verified=true（第 1 轮）`。

## 十七、功能清单随发版同步

- 每次 `npm run pack` 由 `scripts/release.js` 重算 `server/feature-version.json`（`versionName / versionCode / count / ids / hash / fullHash`），功能清单与版本一起成为发版快照。
- `GET /api/features` 返回 `version`；`GET /api/features/sync` 返回版本 + 完整功能清单 + 当前 release，供桌面端与深开鸿端拉取最新功能。
- 看板与两端「🧩 扩展工具」显示「功能 v1.7.1 · 14 项 · 已随发版同步」；`inSync` 为 false 时一眼可见。
- 打包前自检会核对快照 hash 与当前清单、发版版本一致，不一致直接阻断出包，避免「新装用户拿到旧功能清单」。

## 十八、中枢自动发现与可选访问口令

- `/health` 始终免鉴权，返回 `hubs`（本机所有局域网 IP 对应的候选地址）、`release`、`features`、`accessTokenRequired`，专门用于设备端发现中枢。
- 深开鸿端由 `harmony/build_hap.py` 注入 `KH_HUB_CANDIDATES`，`khDiscoverHub()` 并行探测各候选的 `/health`、校验 `app === HongHub-Desktop`，缓存可用地址；中枢 IP 变化后可点工具条「🔄 重连」自愈。
- `KH_ACCESS_TOKEN`：默认空，即「不限网络」。设置后 `/api/*` 与 `/download/*` 需要 `X-KH-Access-Token` 请求头（或 `?token=`），桌面端 `fetch` wrapper 与 HAP 的 `khHeaders()` 自动带上；看板「中枢设置」和 HAP 工具条「🔑 口令」可填写。
- 安全分层：`REPORT_TOKEN`（上报写入）/ `FIX_TOKEN`（修复类写操作）/ `KH_ACCESS_TOKEN`（局域网读取），互不替代。`/api/update/install` 额外限制为仅本机来源可调用。

---

## 十九、自动下发成品（所有包不限设备 · 不限内存 · 自动更新）

对应 `server/delivery-plan.js`（零依赖）+ `scripts/build-archs.js`。`npm run pack` 自动生成 `dist/archs.json` 与 `dist/delivery.json`，服务端 `/api/delivery`、`/api/delivery/plan` 实时下发；看板「🌐 所有包不限设备 · 不限内存 · 自动更新」区块实时展示。

### 三条通道（一次发版同时产出）

| 通道 | 成品 | 安装 | 适用设备 | 内存要求 |
| --- | --- | --- | --- | --- |
| `lite` | 在线影站 `/?mem=<档位>&arch=<架构>&os=<系统>` | 免安装 | 任意系统 / 任意浏览器 / 未识别设备 | 无下限 |
| `hap` | `HongHubMovie.hap`（约 363KB，已签名） | 系统安装器 / `hdc` 确认 | 深开鸿 KaihongOS / OpenHarmony 设备 | 无下限 |
| `full` | `鸿汇影桌面版 Setup <版本>.exe`（x64 / ia32 / arm64） | 安装向导确认 | Windows 各架构 | ≥2GB（低于自动改走 `lite`） |

`GET /api/delivery/plan?arch=&mem=&os=&code=&platform=` 按设备自动选路，返回 `channel / artifact / liteUrl / playback / update / device`，不需要人工挑包：

- Windows + 内存充足 → `full`（无该架构原生包自动回退 x64 通用包，ARM64 Windows 可经系统模拟运行）；
- 深开鸿 / OpenHarmony → `hap`；
- 低内存、macOS / Linux / 手机 / 未知设备 → `lite` 保底，**绝不下发装不了的包**。

### 四个内存档（播放不会撑爆小内存机器）

| 档位 | 内存 | 缓冲字节上限 | 缓冲秒数 | 起始码率 | Worker |
| --- | --- | --- | --- | --- | --- |
| `tiny` | ≤1GB | 6MB | 4s | 最低档（锁定） | 关 |
| `low` | ≤2GB | 10MB | 6s | 最低档 | 关 |
| `medium` | ≤4GB | 24MB | 12s | 自动 | 开 |
| `high` | >4GB | 60MB | 30s | 自动 | 开 |

内存来源：`navigator.deviceMemory` → 下发链接 `?mem=` → `localStorage.khMemTier`；取不到按 4GB 常规档（绝不默认按高内存放开缓冲）。档位参数由 `/api/delivery/plan` 覆盖前端 `khHlsConfig()`，因此**播放策略也能随发版自动更新**。播放中 `khMemoryGuard()` 监控 JS 堆占用：>78% 或页面进后台 → 自动降到最低码率并收紧缓冲；>90% 暂停分片加载，恢复后自动续播。卡顿仍逐级降码率、必要时切换备用源。

### 成品自动更新（内容永远最新，无需人工）

- 两端**启动约 1.5 秒**自动调用 `/api/delivery/plan`（带本地 `KH_APP_CODE`、架构、内存、系统），之后每 **10 分钟**及页面重新可见时自动比对。
- 返回 `update.latest`（版本名 / 版本码 / 两个下载地址 / `desktopSha256` / `hapSha256`）与 `autoContentUpdate=true`；功能清单 `/api/features/sync`、源清单 `/api/manifest`、播放档位**自动同步**，无需重装、无需点「检查更新」。
- `lite` 是在线页面，**天然永远最新**，`needUpdate` 恒为 false、不弹安装横幅。
- `full` / `hap` 在 `code < versionCode` 时自动提示新版并核对 SHA256；**安装仍需用户在安装向导 / 系统安装器确认**（应用内不静默安装）。
- 内容发布只刷新 `contentVersion / publishedAt`，治理循环不抬高应用版本 —— 不会制造「提示升级却下载同一个包」的假更新。

### 反馈建议自动长出新功能 → 自动下发

`server/feature-miner.js` 每次发版（以及服务启动、治理循环、周期巡检）扫描 `feedback.jsonl` / `reports.jsonl`，用白名单关键词提取「新功能 / 批量下发 / 全架构 / 流畅播放 / 不限内存 / 自动更新」等诉求，去重后自动写入 `features/manifest.json`、刷新功能快照，随两端前端与 HAP 一起下发。`action` 只能是已实现的 `builtin:*`，不执行反馈文本里的任何代码，幂等不膨胀；本次三条诉求就是这样自动进入功能清单的。

### 接口与自检

- `GET /api/batch`：多架构产物 + HAP + SHA256 + 下发清单。
- `GET /api/delivery`：完整下发清单（3 通道 / 4 内存档 / `devicePolicy` / `autoUpdate` / 版本）。
- `GET /api/delivery/plan?...`：单台设备自动选路与更新比对。
- `GET /api/flow`：功能挖掘 / 自动修 Bug / 批量下发 / 下发清单聚合。
- `npm run test:feature`：注入反馈 → 断言 6 类新功能自动添加 → 自动修 Bug → 5 类设备组合选路 → 自动更新比对，全程在临时目录完成。
- `npm run verify`：额外断言 `dist/delivery.json` 结构、5 类设备 / 内存组合、512MB 缓冲硬上限、旧版提示新版 / 当前版不误报、治理循环不抬高版本。

---

## 二十、OS 版本检测回传 → 自动优化 → 自动修复 → 下发同步更新

对应 `server/device-optimizer.js`（零依赖、纯同步）。六段全自动，不需要人工复核：

| 段 | 动作 | 落点 |
| --- | --- | --- |
| 1 检测 | 两端读取 OS 版本 / API / 架构 / 内存 / 设备画像（桌面 UA + 深开鸿 ArkWeb UA 动态解析，不写死版本） | `khDevicePayload()` |
| 2 回传 | 启动 3 秒、之后每 10 分钟 `POST /api/device/report` | `server/data/devices.jsonl` |
| 3 自动优化 | 按 OS 家族 + 版本 + 内存档生成兼容策略：HLS 方式、Worker、预加载、超时、并发、缓冲与码率 | `optimize()` |
| 4 自动修复 | 版本缺失从 UA 补齐、通道与系统不匹配改保底、内存未知按常规档兜底、档位漂移重算、旧客户端标记同步更新 | `autoFix()`，全部 `applied:true` |
| 5 下发 | 写 `dist/os-profiles.json` + `server/data/latest_device_optimization.json`，合并进 `dist/delivery.json` 的 `osProfiles` | `/api/delivery`、`/api/delivery/plan` |
| 6 同步更新 | 刷新功能快照，两端经 `/api/features/sync`、`/api/delivery/plan` 自动拉取最新功能与策略 | 不抬高应用版本 |

### 跟随所有操作系统版本

不写死单一版本：`FAMILIES` 覆盖 Windows（6.1 → 11.0）、深开鸿 KaihongOS / OpenHarmony（4.x → 6.x、API12 / 20 / 26）、macOS、Linux、Android、iOS、未识别系统，按语义版本解析主次版本。**即使某系统从未回传，也会为该家族生成基线适配项**，所以任何 OS 版本来问都有可用策略。

| 系统 | 自动优化策略 |
| --- | --- |
| 旧版 Windows（NT 6.x / 8.x） | 禁用 Worker / 预加载，优先原生 HLS，缩短超时，降低并发 |
| Windows 10 / 11 | 标准 HLS 自适应，按内存档调缓冲 |
| 深开鸿 / OpenHarmony | ArkWeb 优先原生 HLS、禁用 Worker、快速切源；`apiVersion` 随 UA 动态跟随 |
| Android / iOS | 原生 HLS 优先，省电省内存 |
| macOS / Linux | 标准浏览器策略 |
| 未识别系统 | 保守档（保底能看）+ 免安装在线通道 |

低内存档（`tiny` / `low`）在任何系统上都会再次收紧：禁用 Worker / 预加载、超时 ≤10s、并发 2。

### 接口与自动下发

- `POST /api/device/report`：回传设备画像 → 立即自动优化 + 修复，返回 `optimization`（含 `compat` / `playback` / `channel` / `fixes`）与全量 `summary`。
- `GET /api/device/optimization`：最近一次全量优化（家族 / 版本 / 修复项 / 功能快照）。
- `GET /api/devices`：按「系统-版本」聚合的设备清单。
- `GET /api/delivery/plan?...`：附带 `osProfile` 与 `optimization`，两端 `khApplyDeliveryPlan()` / `khReportDevice()` 自动应用。
- `GET /api/flow`、`finalProducts.deviceOptimization`、看板「🖥️ OS 版本检测回传 · 自动优化 · 自动修复 · 同步下发」实时展示。

服务启动约 20 秒自动跑一轮全量优化，之后随自动巡检周期复核；治理循环也会跑一遍。全过程只刷新内容指纹与适配矩阵，`versionCode` 不变，**不制造假更新**。

**两端都不会漏**：影站页面由 `khReportDevice()` 回传，桌面主窗口默认打开的在线看板由 `osReport()` 回传，服务端还会在 `/` 与 `/health` 按 `User-Agent` 兜底自动检测（同一 UA 10 分钟去重、优化最多每分钟一次），因此即使某个端没有执行前端脚本，也能被自动识别并纳入适配矩阵。

### 自检

- `npm run test:feature`：注入 7 类反馈（含 OS 版本跟随）→ 断言 7 项功能自动添加 → 5 类设备组合 / 5 类 OS 回传自动优化 → 自动修复项生效 → 全系统版本矩阵 ≥7 家族、人工项 0。
- `npm run verify`：POST 一台旧版 Windows 回传，断言自动优化为保守策略、全家族覆盖、人工项 0、应用版本未抬高；并断言下发计划附带深开鸿 OS 适配结果。

## 二十一、工程保障工具链（签名链自包含 / 提交门禁 / 环境体检）

此前 HAP 签名依赖桌面上的临时目录「新建文件夹 (6)」，目录改名或换机后 `pack` 只会警告并**沿用旧 HAP**：版本号升了、包内前端却还是上一版，而 `release.json` 按旧文件重算 sha256 会让验收误判通过。现已彻底堵住：

- 工作台整体纳管到 `harmony/signing/`：`_inject_honghub.py`、`sign-hap.py`、未签名基础包、`sign-keys/*.p12`。两个 Python 脚本改为相对项目根推导路径（不再写死盘符），SDK / JDK 沿用原有自适应探测。密钥口令只从 `.env` / 环境变量读，源码里没有明文；`.env` 已被 `.gitignore` 排除，模板是 `.env.example`。
- `npm run hap:sign`：注入 → 自签 → **从包内读 `KH_APP_CODE` 并与本次发版比对** → 产出 `dist/*.hap` 与 `dist/.hap-build.json` 构建指纹。任何一步失败 `exit(1)`。
- `build-exe.js` 在签名失败时**中止发版**（`KH_ALLOW_STALE_HAP=1` 才可显式放行，不推荐）；`postpack.js` 只认与 `.hap-build.json` 指纹一致的包，桌面旧包不再参与；`prebuild-check.js` 增加「HAP 新鲜度」阻断项，从包内读真实版本。
- `npm run check`（静态门禁）：`node --check` 全部 JS、`py_compile` 全部 Python、打包前自检静态模式、自动修 Bug 与功能流两套故障注入自检。不打包、不改文件，CI 与提交前都能跑。
- `.githooks/pre-commit` + `npm run hooks:install`（设置本仓库 `core.hooksPath`）；`.github/workflows/ci.yml` 在 push / PR 上跑同一套门禁。
- `npm run doctor`：只读体检，输出 Node / Python / Java / hdc、签名工作台与 SDK、产物 sha256、HAP 新鲜度、日志水位、版本归档、端口占用、代码签名与公网分发配置缺项；`--json` 可给脚本消费，有 ERR 时退出码 1。

## 二十二、版本归档与回滚

`npm run archive` 把当前发版产物收进 `releases/v<版本>/`（安装包、HAP、`release.json`、下发清单、OS 适配矩阵、构建指纹），并生成 `releases/index.json`：当前版本为完整归档，`dist/` 里遗留的历史安装包只登记路径并计算 sha256，不重复复制、不删除任何文件。

- `GET /api/releases`：全部可回滚版本与校验值。
- `GET /api/update/rollback?version=1.7.4`：返回该版本的下载地址、sha256、体积与文件是否仍存在；**只给引导，不在应用内静默安装**（与既有安全策略一致）。
- `GET /download/archive/<文件名>`：从 `releases/` 取已归档产物。
- `pack` 已把归档挂为 `5.6/6`，每次发版自动执行。

## 二十三、真机冒烟、运行健康与断点续传

- `npm run smoke:hap`：`scripts/lib/env.js` 的 `findHdc()` 自动定位 `hdc`（`KH_HDC` > PATH > 已安装 SDK 的 `sdk/*/toolchains/hdc.exe`，深开鸿 SDK 默认不加入 PATH 也能找到），接入设备后执行「`hdc list targets` → `install -r` → `aa start` → `hilog` 断言」，报告写 `dist/hap-smoke.json`。**无 hdc 或无设备时输出 `status=skipped` 并说明原因，绝不假装通过**；`KH_HDC` / `KH_HAP_BUNDLE` / `KH_HAP_ABILITY` 可覆盖，`--dry-run` 只查环境。
- `server/log-rotate.js`：`*.jsonl` 超过 5MB 自动切分为 gzip（保留 3 份），服务启动即生效、每 10 分钟巡检；`KH_LOG_MAX_BYTES` / `KH_LOG_KEEP` 可调。
- `server/health-monitor.js`：磁盘 / 内存 / 进程 / 日志水位，越线写 `server/data/alerts.jsonl`；`GET /api/health/diagnostics` 查全量与最近告警，`/health.diagnostics` 给设备端摘要。只读监测，不自动删文件、不自动重启。
- `/download/*` 改为流式下发并支持 `Range`：请求 `bytes=0-99` 返回 206 + `Content-Range` + `Accept-Ranges`；不再把 77MB 安装包整包读进内存，低内存机器取包也安全。`HEAD` 直接回响应头，验收探测不会触发全量读取。
- `npm run smoke:ui`：装 `playwright-core` 后自动复用系统 Edge / Chrome（`KH_BROWSER_PATH` 可覆盖），真实渲染在线看板、逐个点击全部按钮并捕获 `pageerror`，报告写 `dist/ui-smoke.json` 且 `mode=browser`。**副作用隔离**：只读 GET 放行，POST / 下载 / 安装类请求一律 stub，避免冒烟时误触发 `/api/update/install` 拉起安装向导；元素被遮挡时退回直接调用函数并在报告标注 `(eval)`。浏览器启动失败才降级为 vm + DOM stub 并明确标 `mode=fallback`，不冒充真浏览器通过。

## 二十四、对外分发：代码签名、公网发布与依赖审计

这三项是**可插拔**的：不配置凭证时不阻断构建、不假装已发布，`npm run doctor` 会明确列出缺项。

- **Windows 代码签名**：在 `.env` 配 `WIN_CSC_FILE`（.pfx）与 `WIN_CSC_KEY_PASSWORD`，`npm run sign:win` 优先用 `signtool`（SHA256 + 时间戳），无 Windows SDK 时走 PowerShell `Set-AuthenticodeSignature`。`pack` 在生成安装包之后、`postpack` 重算 sha256 之前自动执行；无证书则输出 `SKIPPED`，结果写 `dist/codesign.json`。
- **公网分发**：默认走站点模式（`server/public-endpoint.json` 随包携带公网域名与 sharecode，仅公开信息、无密钥），`npm run publish:remote` 生成 `dist/remote-manifest.json` 与静态目录 `dist/public/`，由站点发布能力托管；`server/distribute.js` 让 `/api/manifest` 把 `downloadUrl` / `hapUrl` 自动切到公网地址，已安装客户端没有 `dist/` 也能在运行时从公网拉清单拿校验值与新版本。也可在 `.env` 用 `KH_PUBLIC_BASE_URL` / `KH_PUBLIC_SHARE_QUERY` 覆盖，或配 `KH_PUBLISH_BUCKET` + `aws` CLI 走 S3。脚本会逐个探测远端清单与成品可达、**比对 SHA256**，只有版本与哈希都一致才报 `published`，否则如实报 `prepared-local`。
- **依赖审计**：`npm run sbom`（同 `npm run audit`）从 `package-lock.json` 生成 CycloneDX-lite `dist/sbom.json`，并跑 `npm audit --omit=dev` 写 `dist/audit.json`。只读报告，不自动升级依赖；离线可设 `KH_SKIP_AUDIT=1`。

### 新增命令速查

| 命令 | 作用 |
| --- | --- |
| `npm run doctor` | 只读环境 / 产物 / 配置体检 |
| `npm run check` | 提交前与 CI 的静态门禁 |
| `npm run signing:setup` | 从外部工作台导入签名材料到项目内 |
| `npm run hap:sign` | 注入 + 自签 + HAP 新鲜度校验 |
| `npm run archive` | 归档当前版本并刷新回滚索引 |
| `npm run smoke:hap` / `npm run smoke:ui` | 真机冒烟 / 看板按钮冒烟 |
| `npm run sign:win` / `npm run publish:remote` | 代码签名 / 公网发布（可插拔） |
| `npm run sbom` | 依赖审计与 SBOM |
| `npm run hooks:install` | 启用提交前门禁 |
| `npm run ship` | 一键出包发布（门禁→出包→归档→清单→站点→回下→桌面同步） |
| `npm run ship:patch` | 补丁重出包：版本与 HAP 不变，只重建安装器并同步下游哈希 |
| `npm run ship:verify` | 站点发布后收口：远端验收、公网全量回下、桌面同步、全量回归 |
| `npm run ship:deliver` | 仅重生成桌面全量交付与备份 zip |

**已知限制**：商业 CA Authenticode 证书仍属外部依赖（当前用副本自检证书，SmartScreen 可能提示；`doctor` 明确列为 WARN）；自签 HAP 仍需设备开启开发者模式，`hdc.exe` 已在 SDK 中自动找到但 `list targets` 为 `[Empty]`，接入真实开发板后 `npm run hap:watch` 会自动跑真机冒烟；CI 工作流需推送到 GitHub 远端才会触发（GitHub App 目前无建仓权），本地 `pre-commit` 已生效。公网分发已通过站点模式接通并验证，无需对象存储凭证。

## 二十五、开发者端一键出包发布（`ship`）

`scripts/ship.js` 把过去需要手工串起来的九步收成一条命令，报告写在 `dist/ship.json`：

```
门禁(check/doctor) → 出包 → 归档 → 公网清单 → 站点发布 → 二次校验
                  → 公网全量回下逐字节比对 → 桌面全量交付同步 → 全量回归
```

| 模式 | 用途 |
| --- | --- |
| `npm run ship` | 正式发版：版本号 +1、HAP 重建签名、全链路发布 |
| `npm run ship:patch` | 补丁重出包：版本与 HAP 不变，只重建 NSIS 安装器并重算下游哈希 |
| `npm run ship:verify` | 站点已发布后的收口验收 |
| `npm run ship:deliver` | 只重生成桌面全量交付目录与备份 zip |

常用开关：`--dry-run`（纯预演，不写任何构建产物）、`--no-deploy`、`--skip-gates`。站点发布有两种方式：在 `.env` 配 `KH_DEPLOY_CMD`（如 `aws s3 sync dist/public s3://…`）即真正一键全自动；未配置时脚本写出 `dist/deploy-request.json` 并如实报 `deploy-pending`，由站点发布能力执行后再跑 `npm run ship:verify` 收口——**绝不在未发布时报告 `published`**。

两个容易踩的坑，脚本已内置处理：

1. **自引用哈希**：随包配置是 exe 的一部分，若在 `public-endpoint.json` 里写死「安装包自身 SHA256」，重打包后哈希必然再变，永远对不上。因此随包配置只给端点，真实校验值由 `server/distribute.js` 运行时从公网 `remote-manifest.json` 拉取并周期刷新；`ship:patch` 还会把包内 `updates/release.json` 的自引用哈希去掉。
2. **回归顺序**：`verify-release.js` 会断言「桌面 exe/HAP 与 `dist/` 一致」，所以必须先同步桌面成品再跑回归，否则补丁重出包后会撞上尚未刷新的旧桌面包而误报失败。

验收口径以「从公网全量回下 exe 与 HAP、与本地逐字节 `SAME`」为准，而不是只看 HTTP 200。发新版时记得同步更新 `server/public-endpoint.json` 里含版本号的 `desktopUrl` / `hapUrl` 并重新出包。
