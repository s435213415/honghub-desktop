# 鸿汇影 · 深开鸿（KaihongOS / OpenHarmony）端

把同一套纯前端影站打包成 **HAP**，安装到深开鸿 / OpenHarmony 设备上运行。
桌面端（Windows / macOS / Linux）是「中枢」：负责自动收集问题、一键自愈、实时更新、发布、自治；
深开鸿端是「随身客户端」：看片 + 远程看板 + 触发中枢的自治/自愈，联网即用。

> 本目录是 **OpenHarmony Stage 模型 HAP 工程**，需用 DevEco Studio 打开并编译（HarmonyOS/OpenHarmony 的标准方式，无法在命令行无 SDK 环境直接产出 `.hap` 二进制）。

---

## 1. 目录结构

```
harmony/
├── AppScope/                      # 应用级配置（包名 / 图标 / 名称）
├── entry/                        # 入口模块
│   ├── src/main/ets/
│   │   ├── entryability/EntryAbility.ts
│   │   └── pages/Index.ets       # 用 Web 组件加载本地前端
│   ├── src/main/resources/
│   │   ├── base/                 # 字符串 / 颜色 / 图标 / 页面路由
│   │   └── rawfile/www/          # ★ 由 build_hap.py 注入生成的影站前端
│   ├── build-profile.json5
│   ├── module.json5
│   ├── oh-package.json5
│   └── hvigorfile.ts
├── build-profile.json5
├── oh-package.json5
├── hvigor-config.json5
├── hvigorfile.ts
├── gen_assets.py                 # 生成工程图标
├── build_hap.py                  # 注入 HAP 适配、写入中枢地址、生成 rawfile/www
└── README.md
```

---

## 2. 一键生成前端（自动带上中枢网络地址）

在 **桌面端那台电脑**上（即运行 `server/server.js` 的主机）执行：

```bash
cd HongHub-Desktop/harmony
python build_hap.py
```

脚本会：
1. 把桌面版前端 (`../app/`) 整体拷入 `entry/.../rawfile/www/`；
2. 中和桌面专属开关、注入 HAP 适配（`KH_HARMONY`）；
3. **自动探测本机局域网 IP**，把默认中枢地址写成 `http://<本机IP>:8787`，
   这样 HAP 装到深开鸿设备后 **默认就能连上桌面端**，无需手动填地址。

> 想指定固定地址：`KH_HUB=http://192.168.1.50:8787 python build_hap.py`
> 之后若桌面端 IP 变化，可在深开鸿端的「🛰️ 中枢：设置」面板里改，无需重新打包。

---

## 3. 用 DevEco Studio 编译并运行到深开鸿设备

### 准备
- 安装 **DevEco Studio**（OpenHarmony 版，匹配 API 11 / 4.1）。
- 深开鸿设备开启 **USB 调试 / “开发者选项”**，用 USB 一连（或用 hdc 通过网络连）。

### 打开工程
1. DevEco Studio → Open → 选择本 `harmony/` 目录。
2. 等待 `ohpm install` / 索引完成（首次会下载 SDK 与依赖）。

### 签名（必需，但可“自动”）
- **File → Project Structure → Signing Configs** → 勾选 **Automatically generate signature**（OpenHarmony 本地调试证书，无需华为账号）→ Apply。
- 这时 `build-profile.json5` 里的 `signingConfigs.default.material` 会被自动填好。

### 运行
- 设备识别到后，点工具栏 **Run ▶**（或 `Shift+F10`）。
- DevEco 会编译出 `entry-default-signed.hap` 并自动安装、启动。
- 首次进入若提示“中枢未连接可忽略”，直接看片即可；联网的远程源由前端自带，无需中枢也能播。

### 命令行安装（可选，用 hdc）
```bash
# 设备连上后
hdc list targets
# 安装（路径以 DevEco 实际产出为准）
hdc install entry/build/default/outputs/default/entry-default-signed.hap
# 启动
hdc shell aa start -b com.honghub.harmony -a EntryAbility
```

---

## 4. 深开鸿端能做什么

| 能力 | 是否可用 | 说明 |
|------|----------|------|
| 看片 / 搜片 / 换源 | ✅ 开箱即用 | 前端自带远程源，联网即看 |
| 远程问题收集 | ✅ 自动 | 默认上报到桌面中枢 `/api/report` |
| 实时拉取源/版本/功能 | ✅ 自动 | 每 15s 与中枢同步，免重装更新 |
| 一键自愈 / 更新发布 / 自治 | ✅ 触发 | 前端按钮调用中枢接口，由桌面端执行 |
| 免代码加功能 / 预设 | ✅ | 在桌面看板增删，深开鸿端自动出现 |
| 自动更新提示 | ✅ | 每 15s 比对中枢发布版本，发现更高版本弹出「🆕 发现新版本」并可下载 HAP 更新包 |
| **始终跟随操作系统版本** | ✅ | 本机版本基线在首次同步时自动锁定为中枢当前版本，之后只有中枢发布「更高」版本才提示更新；重装后基线随 OS 版本自动对齐（不再写死版本号） |
| **自动优化（中枢侧）** | ✅ 默认开 | 桌面中枢按调度自动跑「智能自治」：提取问题→自愈→优化→发布→补装功能；无实质变化时不发新版（不刷版本号） |
| **🤖 一键优化（设备侧）** | ✅ | 左上「🛰️ 中枢」面板里的「🤖 优化」按钮，可直接驱动中枢立刻做一次优化/修复/发布 |
| **📡 反馈并优化** | ✅ | 左上「📡 反馈」按钮：把本机诊断回传中枢 `/api/report`，并把本机「最终成品」回传 `/api/feedback`，立即驱动中枢 自动提取问题→建议提取→自动反馈→自动优化→加更新→自动更新加发布 |
| **📋 全部最终成品（设备侧可见）** | ✅ | 左上「📋 成品」按钮展开面板：实时呈现中枢治理产出的「建议提取 / 自动优化 / 加更新（自愈）/ 自动更新加发布」结果与「自动反馈」通道记录（含深开鸿端回传的成品） |
| **自动提取问题 / 建议提取** | ✅ 中枢侧 | 中枢每次治理自动从「源状态 + 用户上报」提取问题，并规则引擎生成可执行建议（如移除失效源、重排慢源、处理上报） |
| **自动反馈** | ✅ 中枢侧 | 每轮治理把结论回写反馈通道（`/api/feedback`），深开鸿端可随时拉取；设备侧「📡 反馈」也会把产物回传，形成双向反馈 |
| 自动优化开关 | ✅ | 面板里的「开」勾选框可随时关闭/开启设备侧的自动优化触发 |

左上为「🛰️ 中枢」小面板：显示当前中枢地址（点「设置」可改，支持任意地址：局域网 IP / 公网 IP / DDNS，即「不限网络地址」）；下方实时显示中枢最近一次自动优化的时间与结果，并提供「🤖 优化」「📡 反馈」「📋 成品」三个按钮与「自动优化」开关。点「📋 成品」可展开「接收所有最终成品」面板。

### 关于深开鸿端的自动更新与始终跟随版本
- HAP 每 15 秒比对中枢 `/api/manifest` 里的发布版本号；当中枢经「🚀 同时更新发布」或智能自治抬高 `versionCode` 后，深开鸿端会自动弹出「🆕 发现新版本」横幅。
- **始终跟随操作系统版本**：深开鸿端不再写死版本号。首次成功同步时，本机版本基线自动设为中枢当前版本（即「已是最新」），之后只有中枢发布更高版本才提示更新；因 OpenHarmony 应用存储会跨重装保留，重装后基线仍随 OS 版本自动对齐。
- 点「下载更新」会打开 `<中枢>/download/honghub-harmony.hap`。要真正生效，维护者需把**重新构建并用 DevEco 签名后的 HAP** 放到桌面中枢的 `dist/honghub-harmony.hap`（桌面端 `/download/*` 会自动分发）。
- 在 KaihongOS 上通过系统安装器 / `bm install` 装上该 HAP 即完成更新（OpenHarmony 应用更新走签名安装，不支持 Windows 那种静默替换 exe）。

### 关于「自动提取问题→建议提取→自动反馈→自动优化→加更新→自动更新加发布·接收所有最终成品」闭环
1. 深开鸿端看片 / 使用中产生的诊断，会**自动**上报到桌面中枢 `/api/report`（默认开启，脱敏、限流、幂等）。
2. 中枢**默认按调度自动治理**（无人值守）：每轮自动完成
   **① 自动提取问题**（源状态 + 用户上报归并）→ **② 建议提取**（规则引擎生成可执行建议，如移除失效源/重排慢源/处理上报）→ **③ 自动反馈**（结论回写 `/api/feedback` 反馈通道）→ **④ 自动优化**（剔除失效源）→ **⑤ 加更新**（有问题时跑 `runFix` 自愈重排源）→ **⑥ 自动更新加发布**（确有实质变化才抬版本，`bumpRelease`）。
   全部产出聚合成「最终成品快照」存盘，供深开鸿端拉取。
3. 点左上「📡 反馈」按钮可**主动**把本机诊断与「最终成品」分别回传中枢 `/api/report` 与 `/api/feedback`，并立刻请求中枢跑一次上述完整治理；点「📋 成品」可查看本轮全部最终成品（建议 / 优化 / 更新 / 发布 / 反馈）。
4. **接收所有最终成品**：深开鸿端通过 `/api/feedback` 实时呈现中枢治理产出与双向反馈记录，实现「中枢自我进化、设备可见可控」。

---

## 5. 兼容性说明
- 工程目标 `compatibleSdkVersion: 4.1.0(11)`、`runtimeOS: OpenHarmony`，适配深开鸿（KaihongOS 多基于 OpenHarmony 4.x）。
- 若你的 DevEco / 设备是 API 12（5.0），把 `build-profile.json5` 的 `compatibleSdkVersion` 改成 `5.0.0(12)` 即可（向后兼容编译）。
- 若 `Index.ets` 里 `import { AlertDialog } from '@kit.ArkUI';` 在你的版本报错，
  直接删掉该行即可——`AlertDialog` 在 ArkTS 页面内通常已全局可用。

---

## 6. 与桌面端的关系（一张图）

```
  桌面端（中枢，常驻运行 server/server.js）
   ├─ 自动收集问题 / 自愈 / 实时更新 / 发布 / 自治
   └─ 暴露 /api/*  (已开启 CORS，允许跨设备调用)
            ▲ 深开鸿端通过 http 调用（默认已填本机局域网地址）
  深开鸿端（HAP，随身）
   ├─ 看片、换源（前端自带，离线也能播）
   └─ 触发中枢的 自愈 / 自治 / 看板
```

打包一次，桌面与深开鸿两端共享同一套源与功能清单。
