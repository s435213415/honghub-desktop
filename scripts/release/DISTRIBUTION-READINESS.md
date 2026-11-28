# 分发前必须过的 6 项 · 准备手册

对应产品方向 B（小圈子分发）。技术侧已经能做掉的都做完了；剩下的是买证书、放行成品、外网实测。

## 1. 内容来源与分发口径（已做，代码侧）

- 首启声明的隐私 / 协议 / 免责摘要已补：问题与崩溃记录默认只存本机，外发需显式开启且有每日上限。
- 新增「侵权投诉与下线」段（关于页 + 首启声明两处），承诺可核实投诉后 72 小时内下线对应入口或片源条目。
- 常量位置：`app/kh-admin.js` 顶部 `KH_ABUSE_MAIL` / `KH_ABUSE_SLA_HOURS`。
  **空值时界面会明确显示「尚未配置」**，不会用假邮箱冒充投诉通道。分发前必须填真实可达邮箱。
- 仓库违规词扫描（破解 / 去广告 / 绕过 / VIP / 免费看 / 盗版）已跑：仅命中「不破解」「禁止绕过付费墙」这类正面表述，无违规引导文案。
- 随包内置片源仍是 6 部 CC 授权样本，不内置任何第三方影片文件。

**你要做的**：给我一个可达的投诉邮箱（或填进 `KH_ABUSE_MAIL`）。

## 2. 商业代码签名（未做，要买证书）

现状：`WIN_CSC_FILE` 未配，出包 4.5/6 恒 SKIPPED，安装时 SmartScreen 提示未知发布者。

采购要点：
- 选择 OV（组织验证）代码签名证书，约 ¥2000–4000/年；EV 更贵，但能更快积累 SmartScreen 信誉。
- 2023 年后主流 CA 要求私钥存硬件令牌 / 云 HSM，纯 `.pfx` 文件签发会越来越难；购买时确认「是否支持 signtool + 云签名」。
- 需要能证明组织真实存在的材料（营业执照）；个人身份只能买个别 CA 的个人版，信誉积累慢。

配置与验证：
```
# .env
WIN_CSC_FILE=D:\certs\honghub.pfx
WIN_CSC_PASS=***
WIN_CSC_TIMESTAMP=http://timestamp.digicert.com
```
```
node scripts\sign-windows.js            # 已存在，会按 WIN_CSC_TARGETS 签多个目标
powershell -c "Get-AuthenticodeSignature 'dist\鸿汇影桌面版 Setup 1.7.96.exe' | Format-List"
```
判定：4.5/6 不再输出 SKIPPED；安装包属性里有发布者名；`Status: Valid`。

## 3. 正式站点成品可达（未做，要在面板放行）

现状：5.8/6 是 PREPARED-LOCAL —— `remote-manifest.json` 200，`desktop-setup.exe` / `HongHubMovie.hap` 404。
7.1/8 那个 206 是临时 cloudflare 隧道，不能算正式分发。

要点：
- 把 `dist/public/` 整个目录（含 `honghub/v<ver>/`）同步到正式站点根目录；exe 与 hap 体积大，别只同步清单与页面。
- 站点要允许 `Range`（断点续传）与正确的 `Content-Length`；多数静态托管默认支持，CDN 需要确认不会忽略 Range。
- exe 的 MIME 用 `application/octet-stream`，避免被浏览器当 HTML 预览。

验证（新写、可直接跑）：
```
node scripts\release\verify-public-dist.js --base https://your.site
node scripts\release\verify-public-dist.js --base https://your.site --full
```
判定：全部 OK；从一台**外网机器**下载并本地比对 sha256 一致。

## 4. 公网自动升级端到端（链路已写，待站点放行后实测）

现状：`client-auto-update.js` 四档 mode、强制 https + 同源 .exe、sha256 校验、0/1h/6h/24h 退避、
「装完没变就停手」都在；但清单没发布时这条链等于是断的。

实测步骤：
1. 装 1.7.95（或更早）客户包。
2. 设置页把「自动升级」设成 `download`，先确认能拉到清单并显示「有新版本」。
3. 切到 `install`，观察：下载 → sha256 校验 → 静默安装 → 重启后版本变化。
4. 故意把清单里的 sha256 改错一个字符，重跑：必须**不安装**、`attempts+1`、按退避等待，不能循环。
5. 免安装版目录（无 `Uninstall*.exe`）必须自动降级为「只下载提示」，不尝试安装。

判定：两条日志 —— 成功一条、故意失败一条。

## 5. 问题回执闭环（已做，代码侧）

- 服务端：`/api/report`（脱敏 / 限流 / 幂等 / 可选 Token）与 `/api/issues`（GET/POST）都在。
- 客户端：默认只存本机，外发需显式开启，有每日上限。
- 交付说明里已写清这条口径（见 `客户下载说明.txt` 第七节「数据与投诉」）。

**你要做的**：分发版对外说明统一口径「外发默认关，首启不弹窗，需要的用户在设置页自己开」。
运维面板里给上报加处理状态（待看 / 已修 / 不复现）——目前只有列表，没有状态流转。

## 6. 装机与卸载干净度（已在本机实测通过，2026-11-23）

本机（Windows 11 / 当前用户 admin）用 1.7.97 x64 Setup 真装、真开、真卸了一遍，结论与证据如下。

**实测事实**

| 环节 | 结果 |
|---|---|
| 静默安装 `/S` | 10.1s，ExitCode 0，per-user 装到 `%LOCALAPPDATA%\Programs\honghub-desktop`（98 文件 / 314.6 MB） |
| 注册表 | `HKCU\...\Uninstall\8c2b91a9-7b58-5874-a60d-5abc0e610458`，DisplayName「鸿汇影桌面版 1.7.97」、Publisher「HongHub」、DisplayVersion「1.7.97」 |
| 快捷方式 | 开始菜单 `鸿汇影桌面版.lnk` + 桌面 `鸿汇影桌面版.lnk` |
| 启动（模拟双击） | 5 个进程，监听 `127.0.0.1:8787`，`GET /` 返回 200 / 70,040 B |
| 卸载 | `/currentuser /S`，2.7s，ExitCode 0 |
| 卸后复查 | 安装目录已删、两个快捷方式已删、注册表项已删、无进程残留；仅 `%APPDATA%\鸿汇影桌面版` 设置目录保留（设计如此） |

**三条命令（三快照，别再只用两条）**

```
node scripts\release\check-install-clean.js --snapshot before      # 装之前
node scripts\release\check-install-clean.js --snapshot installed   # 装完、用完，还没卸
node scripts\release\check-install-clean.js --snapshot after       # 卸之后
node scripts\release\check-install-clean.js --residue installed after  # 主判据：装后痕迹卸后是否全清
node scripts\release\check-install-clean.js --diff before after        # 副判据：原有东西没被误删
```

`--diff before after` 只能回答「原来就在的东西有没有被误删」，回答不了「装的时候写下的痕迹有没有清干净」——后者才是第 6 项要的结论，所以有了 `--residue`。本机两条都是退出码 0：装后 7 项本产品痕迹，卸后清掉 4 项（安装目录 1 + 注册表 1 + 快捷方式 2），该清没清 0 项，预期保留 3 项（`%APPDATA%\鸿汇影桌面版`、`%APPDATA%\HongHub-Desktop-Dev`、`%LOCALAPPDATA%\honghub-desktop-updater`）。

**这次实测修掉的两个口径漏洞（都会造成假通过）**

1. 脚本原来直接调 `reg`，本机 PATH 里没有 `reg.exe`，ENOENT 被 catch 吞掉 → 注册表永远显示 0 项，注册表残留永远查不出来。改成绝对路径 `%SystemRoot%\System32\reg.exe`，起不来才报错。
2. 判定「预期保留的用户数据」时只看路径前缀，而安装器是 per-user 装在 `%LOCALAPPDATA%\Programs\honghub-desktop` 下，会被误判成用户设置 → 安装目录残留拿到豁免。改成按分组判：只有 AppData 这一组可能是用户设置，安装目录 / 快捷方式 / 注册表一律算残留。

**证据文件**：`logs/install-snapshot-before.json`、`-installed.json`、`-after.json`（本机 2026-11-23 一轮）。

**仍然没验的**：arm64 包（本机是 x64）、别人的机器（尤其 Win10 与无管理员权限的账号）；第一次到熟人机器上装，建议顺手跑一遍这三条命令，把结论补进台账。


## 元规则

这 6 项没全过之前：包只走私发（网盘 / 微信），标题写「测试版 · 未签名」，不挂公开下载链接。
