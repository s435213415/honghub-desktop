# scripts/release —— 发布与交付脚本沉淀

这些脚本原本散在 `%TEMP%` 里，一轮轮手写、下次又要重抄。现在收进仓库，改成一跑就能用；
带硬编码的，都注明了要改哪儿。

## 现代管（无硬编码，直接跑）

| 脚本 | 用途 | 用法 |
|---|---|---|
| `deliver.py` | 生成 `Desktop\鸿汇影·客户成品_v<V>\`（12 件）与 `鸿汇影·开发端_v<V>\`；版本号与哈希全部现读 `dist/release.json` 和真实产物，同名同大小同哈希跳过复制 | `python scripts\release\deliver.py` |
| `doc_195.py` | 生成 `Desktop\鸿汇影·文档资料\`：更新日志 txt、文档索引 txt、功能导航 html、变更与验证清单 xlsx（openpyxl 不可用时退化成 CSV） | `python scripts\release\doc_195.py` |
| `rel-hap-sync.js` | 把 `dist\HongHubMovie.hap` 的真实大小与 sha256 写回 `dist\release.json` 的 `artifacts.hap`。HAP 重签后必须跑，否则 0/8 预检会以「哈希不一致」中止流水线 | `node scripts\release\rel-hap-sync.js` |
| `act-check.js` | 扫 `kh-app.js` / `kh-core.js` / `kh-admin.js` 里 `data-act` 与实际处理分支，报出「有按钮没实现 / 有分支没按钮」 | `node scripts\release\act-check.js` |
| `mv-probe.js` | 探测 `public/movies` 目录与内置片源清单是否对得上（缺文件 / 多文件） | `node scripts\release\mv-probe.js` |
| `read-xlsx.py` | 用 openpyxl 回读任意 xlsx，打印行列与单元格，用于校验生成的清单 | `python scripts\release\read-xlsx.py <file.xlsx>` |

## 旧模板（有 1.7.94 硬编码，用前必须改）

下面这些是从上一轮交付流程里整段抄下来的，逻辑可用，但版本号和文件名写死成了 1.7.94。
用之前把 `V` / `CODE` / `DEVCODE` / `CLI` / `DEV` / `PREV_DEV` / `FILES` 头部常量改成当前版本，
或者对照 `deliver.py` 的写法现读 `dist/release.json`。

| 脚本 | 用途 | 要改什么 |
|---|---|---|
| `ship-delivery.py` | 客户成品夹 + 开发端夹的完整搬运与说明生成（比 `deliver.py` 更细，含旧版目录对照） | 头部 6 个常量；9 处版本串 |
| `doc-pack.py` | 更新日志 + 文档索引（正文是 1.7.94 的九项） | `V/CODE/DEVCODE` + 整段正文 |
| `sheet-pack.py` | 可配置项清单 xlsx（openpyxl 多 sheet） | 7 处版本串 + 正文 |
| `nav-pack.py` | 功能导航 HTML（暗色单文件） | 35 处版本串（最多，基本等于重写） |
| `dev-doc-pack.py` | 开发者端说明 / 密钥清单 | 6 处 |
| `doc-html.py` | 单页文档 HTML | 5 处 |
| `items-sync.py` | 把变更清单同步进 xlsx | 2 处 |
| `items-194.js` | 1.7.94 的十行变更清单数据（纯数据，可直接改版本复用） | 数据本身 |

## 出包顺序（一句话版）

```
node scripts\version.js --check          # 16 处版本必须一致
python harmony\build_hap.py              # HAP 前端 + 打包
$env:KH_HAP_ALLOW_STALE=1; node scripts\hap-sign.js            # 客户 HAP
$env:KH_HAP_ALLOW_STALE=1; $env:KH_HAP_VARIANT=dev; node scripts\hap-sign.js   # 开发端 HAP
node scripts\release\rel-hap-sync.js     # 哈希回写 release.json
node scripts\oneclick-release.js --skip-hap                     # Windows 全链路 4/8–8.2/8
node scripts\release\deliver.py          # 交付夹
python scripts\release\doc_195.py        # 文档包
```

arm64 客户包要先有 `dist\arch-arm64\win-arm64-unpacked`；没有就跑
`node -e "require('./scripts/build-archs.js').buildArch('arm64','<ver>')"`，
再 `$env:KH_CLIENT_ARCH='arm64'; node scripts\build-client-exe.js`。

## 两个坑（记住）

- `oneclick-release.js` 的 5.6/6 归档会校验 `dist\client` 里客户包的指纹版本。如果客户包还是上一版，
  流水线会在 4/8 以「客户版指纹记录的版本是 X，与当前 Y 不一致」中止 —— 先跑 `build-client-exe.js`。
- `dist\release.json` 的 `artifacts.hap` 必须与磁盘上的 HAP 逐字节一致，否则 0/8 预检直接拦。
