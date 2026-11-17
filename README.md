# 鸿汇影 · 桌面中枢（HongHub-Desktop）

一个**免费**、**双击即跑**的影视聚合工具，同时提供 Windows 桌面端与深开鸿 KaihongOS / OpenHarmony 端（HAP），两端共享同一份源清单、功能清单与下发策略。

**当前基线**：`v1.7.42` / `versionCode 1000156`。版本号以 `server/manifest.json` 的 `release.latest` 为单一真相源，改动后跑 `npm run version:check` 校验全仓字段是否一致。

---

## 一、双端彻底隔离（v1.7.42 核心）

| 端 | 打开看到什么 | 判定依据 |
|---|---|---|
| **开发端** | `/admin` 运维面板（运维五项、功能管理、诊断、发布状态） | `KH_DEV_MODE=1` / 启动参数 `--dev` / 程序目录存在 `dev-mode.flag` |
| **客户端** | `/index.html` 影视页，仅成品 | 构建期把 `CLIENT_ONLY` 硬写成 `true`，客户包不再认任何开发开关 |

- 开发端使用独立 userData 目录 `HongHub-Desktop-Dev`，不与客户端抢单实例锁，可同时开。
- 客户端包内**不得出现**：`/admin` 入口、诊断面板、`*.dev-backup`、`dev-auto-update.js`、签名材料。
- 构建脚本对客户端页面做强制断言：剥离后仍命中 `/admin` 即**抛错中止**，不生成包。

## 二、客户端纯净版如何保证

1. `app/index.html` 用 `/* KH_DEVUI_START */ … /* KH_DEVUI_END */` 包住两处开发端专属 UI（功能管理入口、运维五项 `builtin:audit|trend|rollout|smoke|alerts`）。
2. `scripts/build-client-exe.js` 构建时整段剥离 → 兜底替换 → 断言 `/admin` 出现 0 次才继续；备份目录改到 `%TEMP%`，不再落进 `win-unpacked`。
3. 打包时临时删除 `dev-auto-update.js`，`finally` 恢复，客户包不带开发端自更新模块。
4. `harmony/build_hap.py` 正式 HAP 同样剥离 `KH_DEVUI` 段，`feature_snapshot()` 过滤 `url` 以 `/admin` 开头的功能项。
5. 验收实测：客户 Setup / 免安装 zip / HAP 内 `/admin`、`dev-backup`、`开发者诊断` 全部 0 命中。

## 三、目录结构

```
HongHub-Desktop/
├─ app/                影站前端（index.html，含 KH_DEVUI 标记段）
├─ server/             本地中枢服务（manifest / features / delivery / bugfix / device / download …）
├─ features/           功能清单与预设包（加一条即免重装长出工具）
├─ scripts/            出包、发版、验收、自动化脚本
│  ├─ oneclick-release.js     11 步一键换版
│  ├─ build-client-exe.js     客户纯净包（剥离 + 断言）
│  ├─ build-exe.js            开发端安装包（自动建交付夹）
│  ├─ build-dev-package.js    开发端免安装包 + 签名材料同步
│  ├─ auto-publish-watch.js   改动自动打版（防抖 + 冷却）
│  ├─ verify-release.js       交付验收
│  └─ auto-release.js         下发清单与桌面同步
├─ harmony/            深开鸿 HAP 工程（ArkWeb + 构建签名）
│  └─ signing/         签名脚本与密钥位（密钥本身不进仓库）
├─ electron-main.js    Electron 入口（双端判定、单实例、服务自愈）+ 开发端自更新钩子
├─ dev-auto-update.js  开发端自更新（只认“开发端”安装包）
├─ assets/             图标
└─ package.json        脚本与打包配置
```

## 四、快速开始

需要本机 Node.js 18+。

```bash
# Windows：双击 start.bat
# macOS / Linux：chmod +x start.sh && ./start.sh
```

浏览器自动打开 `http://localhost:8787/`，关闭窗口即停止服务。

## 五、一键换版（免人工）

```bash
node scripts/oneclick-release.js --bump --keep-going   # 正式换版
node scripts/auto-publish-watch.js --once              # 立即打一版
node scripts/auto-publish-watch.js --dry               # 演练，不落包
node scripts/verify-release.js                         # 验收，末行须“交付验收全部通过”
```

`oneclick-release.js` 固定 11 步：`doctor → version → repair-page-sources → rebuild-builtin-sites → build_hap → hap-sign → build-exe --no-bump --skip-zip → build-client-exe → auto-release → verify`。

### 改动即发版（常驻监听）

`scripts/auto-publish-watch.js` 监听 `app / server / features / assets / harmony / electron-main.js / dev-auto-update.js / package.json`，忽略 `server\data`、`logs`、`dist`、`node_modules`、`*.log/.tmp/.bak/.dev-backup`、`access-token.txt`；90 秒防抖 + 20 分钟冷却，触发 `oneclick-release.js --bump --keep-going`，日志 `logs/auto-publish.log`。

常驻方式：`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\鸿汇影自动发版.vbs`（隐藏窗口运行，开机自启）。

### 开发端自更新

`dev-auto-update.js` 只认本机 `dist` 中文件名含「开发端」的安装包（`^鸿汇影桌面版 开发端 (\d+\.\d+\.\d+)\.exe$`，小于 50MB 忽略），semver 比较后静默安装并以 `--dev` 重新拉起；间隔默认 360 分钟，`KH_AUTO_UPDATE=0` 可关；日志 `server/data/dev-auto-update.log`。开发端菜单「维护决策」后有「立即检查更新」。

## 六、桌面交付结构（三夹）

```
Desktop\
├─ 鸿汇影·客户成品_v<版本>\     Setup / 免安装 zip / HAP / 客户下载说明.txt
├─ 鸿汇影·开发端_v<版本>\       开发端 exe / HAP / 签名密钥 / 密钥与口令清单 / 启动器 / lnk / 维护文档
├─ 鸿汇影·历史归档\             旧版本与旧工作台备份
├─ 启动鸿汇影开发端.cmd
├─ 鸿汇影·开发端（免安装）.lnk
└─ 鸿汇影·文件导航.txt
```

出包脚本（`build-exe.js deliver()`、`build-client-exe.js`）自动建夹，版本变化时自动生成对应新目录，无需人工改名或搬文件。

## 七、签名材料与密钥纪律

- 签名链固定在 `harmony/signing/`：`sign-keys/app-key.p12`、`profile-key.p12`、`ca.p12`、`app-chain.pem`、`app.p7b`、`profile-chain.pem`、`outprofile.p7b`、`outCertChain.cer`。
- 口令**只从环境变量**读取：`.env` 的 `OH_KEY_PWD`，源码内无明文。
- 每次出开发端包，`build-dev-package.js` 自动把整棵 `keys/` 复制到 `鸿汇影·开发端_v<版本>\签名密钥\`，并生成 `说明.txt`、`签名口令.txt`、`密钥与口令清单_v<版本>.txt`。
- 签名工具链：`C:\Users\admin\Desktop\软件开发工具\command-line-tools`（`sdk\26.0.1\toolchains\lib\hap-sign-tool.jar` + `tool\jre\bin\java.exe`）；`harmony/signing/resign_hap.py` 已按该布局搜索 JRE / jar。
- **纪律**：私钥 / 证书 / profile / 口令**只留在本地开发端交付夹**，绝不进客户成品、不进下发通道、不进任何代码仓库；重签 HAP 使用环境变量传口令。

## 八、下发通道（只发客户成品）

| 通道 | 文件 | 说明 |
|---|---|---|
| Windows 安装版 | `鸿汇影桌面版 Setup <版本>.exe` | 双击安装，覆盖升级不卸载、保留收藏与登录态 |
| Windows 免安装 | `鸿汇影免安装 <版本>.zip`（站点用 `.bin` 别名） | 解压即用，不写注册表 |
| 深开鸿 | `HongHubMovie.hap`（已重签） | 系统安装器 / `hdc` 安装 |

镜像站：`C:\Users\admin\HongHubServer\site`（`serve.py` 监听 `127.0.0.1:8099`），`remote-manifest.json` 与桌面客户成品夹保持同版本、同哈希；公网站点走 `KH_DEPLOY_CMD` + `KH_PUBLIC_BASE_URL`。

**下发只允许客户成品**：开发端 exe、签名私钥、运维口令一律不上传。

## 九、深开鸿 / KaihongOS 端

```bash
cd harmony && python build_hap.py        # 自动探测本机 IP，注入多候选中枢地址
```

- 包名 `com.honghub.harmony`，vendor `kaihong`，`EntryAbility`，ArkWeb `Web` 组件加载本地前端。
- 构建后自动注入候选地址（`KH_HUB_CANDIDATES`），设备端并行探测 `/health` 并缓存可用中枢，IP 变化可「🔄 重连」自愈。
- 正式包会剥离开发端 UI、过滤 `/admin` 功能项，并重签；`mysign` 需要设备开启开发者模式。
- 真机冒烟：`npm run smoke:hap`（无 `hdc` 或无设备时明确输出 `status=skipped`，不假装通过）。

## 十、验收与自检

| 命令 | 作用 |
|---|---|
| `npm run verify` | 交付验收：版本基线、包内版本、产物 SHA256、桌面交付一致性、全部接口与下载端点、自动修 Bug、设备选路、自动更新不制造假更新 |
| `npm run doctor` | 只读体检：Node / Python / Java / hdc、签名工作台、产物哈希、HAP 新鲜度、端口、分发配置 |
| `npm run check` | 静态门禁：`node --check` 全部 JS、`py_compile` 全部 Python |
| `npm run test:bugfix` | 自动修 Bug 回归自检（注入 4 类故障 → 自动处置 → 复检归零） |
| `npm run test:feature` | 反馈 → 新功能 → 下发 → 不限设备 / 内存 → 自动更新回归自检 |
| `npm run smoke:ui` | 在线看板按钮冒烟（真实浏览器优先） |
| `npm run archive` | 归档当前版本到 `releases/v<版本>/` 并刷新回滚索引 |
| `npm run sbom` | 依赖审计与 SBOM |

判据：`verify-release.js` 末行输出「交付验收全部通过」才算全部通过。

## 十一、版本证据（v1.7.42）

| 文件 | 大小 | SHA256 前缀 |
|---|---|---|
| 客户 Setup 1.7.42.exe | 79,603,132 B | `2ae3d372c674…` |
| 客户免安装 1.7.42.zip | 109,323,818 B | `95c96a61a8e6…` |
| HongHubMovie.hap | 959,159 B | `078b50eeeccc…` |
| 开发端 1.7.42.exe | 79,604,737 B | `a6108d30…` |

完整变更见 [`鸿汇影桌面中枢·v1.7.42更新说明.md`](鸿汇影桌面中枢·v1.7.42更新说明.md)。

## 十二、已知限制

- 深开鸿真机尚未接入：`hdc list targets` 为空，HAP 只能做包内静态核验。
- Windows 代码签名使用自签副本，SmartScreen 可能提示。
- WorkBuddy 云端资料库暂无写入通道，资料以本仓库为准。
- 旧版工作台备份已归入桌面「鸿汇影·历史归档」，不参与构建。

## 仓库说明（源码归档）

本仓库只放**源码、脚本与文档**；客户交付物与敏感材料一律不进仓库。

**不包含（`.gitignore` 强制排除）**

- 成品二进制：`*.exe` / `*.zip` / `*.hap` / `*.blockmap`、`dist/`
- **签名材料**：`harmony/signing/keys/`、`sign-keys/`、`*.p12` / `*.pem` / `*.p7b` / `*.cer` / `*.jks` / `*.keystore`
- 密钥口令与运行时口令：`.env`、`.env.*`（仅放行 `.env.example`）
- 运行期数据：`server/data/*.json(l)`、页面热更新缓存
- 依赖与临时文件：`node_modules/`、`__pycache__/`、`*.log`、`*.tmp`

> ⚠️ 签名私钥、证书与口令**绝不提交**，也绝不上传到任何站点或下发目录以外的位置。
