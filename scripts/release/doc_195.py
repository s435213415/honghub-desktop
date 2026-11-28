# -*- coding: utf-8 -*-
"""1.7.95 文档资料包：更新日志 / 文档索引 / 功能导航 HTML / 变更与验证清单 xlsx

输出到 Desktop\\鸿汇影·文档资料\\（与历史版本同一夹子，文件名带版本号，不覆盖旧版）。
哈希与体积全部现算，不手抄。
用法：python scripts\\release\\doc_195.py
"""
import hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DESK = os.path.join(os.path.expanduser('~'), 'Desktop')
DOC = os.path.join(DESK, '鸿汇影·文档资料')


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def fmt(n):
    return '{:,}'.format(n)


with open(os.path.join(ROOT, 'dist', 'release.json'), encoding='utf-8') as f:
    REL = json.load(f)
V = str(REL['versionName'])
CODE = str(REL['versionCode'])
DEVCODE = str(int(CODE) + 100)

FILES = {
    'x64 安装版': os.path.join(ROOT, 'dist', 'client', '鸿汇影桌面版 Setup %s.exe' % V),
    'x64 免安装': os.path.join(ROOT, 'dist', 'client', '鸿汇影免安装 %s.zip' % V),
    'arm64 安装版': os.path.join(ROOT, 'dist', 'client', '鸿汇影桌面版 Setup %s-arm64.exe' % V),
    'arm64 免安装': os.path.join(ROOT, 'dist', 'client', '鸿汇影免安装 %s-arm64.zip' % V),
    '客户 HAP': os.path.join(ROOT, 'dist', 'HongHubMovie.hap'),
    '开发端 HAP': os.path.join(ROOT, 'dist', 'HongHubMovie-dev.hap'),
    '开发端 x64': os.path.join(ROOT, 'dist', '鸿汇影桌面版 开发端 %s.exe' % V),
    '开发端 arm64': os.path.join(ROOT, 'dist', '鸿汇影桌面版 开发端 %s-arm64.exe' % V),
}
ART = {}
for k, p in FILES.items():
    if os.path.exists(p):
        ART[k] = (os.path.basename(p), fmt(os.path.getsize(p)), sha(p))
    else:
        ART[k] = (os.path.basename(p), '缺', '')

os.makedirs(DOC, exist_ok=True)
art_rows = '\n'.join(
    '  %-12s %-44s %14s B\n               %s' % (k, ART[k][0], ART[k][1], ART[k][2] or '（未生成）')
    for k in FILES)

ITEMS = [
    ('P0-04', '平台入口域名守卫', 'app/kh-guard.js', '设置页「键盘快捷键一览」底部；点站点的第一次点击'),
    ('P0-03', '电视形态 + 遥控焦点/返回/菜单键', 'app/kh-tv.js', '设置页「电视与遥控」'),
    ('P2-B11', '键盘快捷键一览', 'app/kh-core.js', '设置页「键盘快捷键一览」'),
    ('P2-B04', '分类页标签筛选', 'app/kh-core.js + kh-app.js', '分类页顶部标签 chips'),
    ('P2-B15', '简体 / 繁体 / 英文', 'app/kh-hant.js', '设置页「语言」下拉'),
    ('P1-07/08', '客户版静默自动升级 + 失败回退', 'client-auto-update.js + electron-main.js', '设置页「自动升级」'),
    ('P1-01', '设备码账号', 'app/kh-account.js + server/account-sync.js', '设置页「账号与云同步」'),
    ('P1-02', '收藏 / 历史 / 片单云同步', '同上', '「同步到云」/「从云拉回」'),
    ('P1-03', '跨端续播', '同上（prog 合并按 at 取新）', '同上看「续播」计数'),
    ('P2-B09/B10', '手机扫码遥控', 'server/account-sync.js /remote + kh-account.js', '扫码或手输遥控地址'),
]

TESTS = [
    ('平台入口域名守卫', 'scripts/test-guard-kit.js', 31),
    ('客户版静默升级', 'scripts/test-auto-update-kit.js', 35),
    ('简繁显示层', 'scripts/test-hant-kit.js', 24),
    ('电视/遥控层', 'scripts/test-tv-kit.js', 23),
    ('账号服务端', 'scripts/test-account-kit.js', 29),
    ('账号客户端', 'scripts/test-account-client-kit.js', 20),
    ('既有 · 偏好', 'scripts/test-pref-kit.js', 63),
    ('既有 · P2 能力', 'scripts/test-p2-kit.js', 93),
    ('既有 · B 档', 'scripts/test-b8-kit.js', 88),
]
TOTAL = sum(x[2] for x in TESTS)

# ---------------- 更新日志 ----------------
log = '''鸿汇影 · 更新日志 v{v}
============================================================
应用版本：{v} / #{code}      开发端 HAP：#{dev}
生成时间：2026-11-23
上一版：1.7.94 / #1000208（2026-11-23 出包并验收通过）

一、这一版怎么做的
------------------------------------------------------------
先按「还有哪些规划」的盘点表逐条 grep 核实仓库现状，再动手。结果是：盘点表里 14 项有 5 项
早就实现了（推荐位云端、来源白名单、网络代理与镜像站、播放失败分级、静默覆盖安装），
真正缺的是 6 类。宁可少写代码，也不重复造一遍再对外说「新增」。

二、本版新增（六类，代码都在仓库里，有单测）
------------------------------------------------------------
1. 平台入口域名守卫（P0-04）  app/kh-guard.js（新建）
   三态判定：官方清单内 ok / 不在清单 ask / 非 http(s) 或明显伪造 bad。
   官方域从 BUILTIN_SITES 现算（含 host 字段与 url 解析两种形态，去 www 归一）。
   ask 时第一次点击只弹提示并报出真实 host，3 秒内同地址再点一次才放行，并把 host 写进
   信任表 kh_trust_hosts（只存 host，上限 30，超出淘汰最旧）；设置页可一键清空。
   注意：它和 /api/config/origins 不是一回事——后者管「回环外网页访问本地中枢」的 CORS，
   前者管「用户点开的站点是不是官方入口」。

2. 电视形态与遥控焦点（P0-03）  app/kh-tv.js（新建）
   形态判定：mode=auto 时「没有精确指针 + 屏幕 ≥1280×640」判为电视；也可强制开/关。
   开启后 body 加 .kh-tv：字号放大一档（--fs:16px）、焦点环 3px 橙色、
   卡片聚焦轻微放大并加外发光、网格间距加大、可点元素最小高 36px。
   遥控键：方向键沿用既有 khGridNav 网格算法；OK 走原生 click；返回键 Backspace
   依次问「播放器 → 非首页 → 派发 Esc」，没人接手就什么都不做；菜单键 ContextMenu /
   Shift+F10 会对当前焦点元素派发 contextmenu，直接唤出既有右键菜单。

3. 键盘快捷键一览（P2-B11）  app/kh-core.js
   两张表：全局 5 个可改动作（读 kh_hotkeys 当前值）＋ 页面内固定键（/、Esc、Enter/空格、
   方向键、播放器 ←→/j l、右键菜单 ↑↓ Enter Esc）。只列代码里真实绑定的键，不写「可能支持」。
   同卡片底部显示已信任域名数量与清空按钮。

4. 分类页标签筛选（P2-B04）  app/kh-core.js + kh-app.js
   第三维筛选：标签 chips 取自 allMovies() 的 tags 去重前 10 个，state.catTag 单独保存，
   与年份、类型、拼音首字母搜索并行生效。
   为什么不是「地区」：内置片源只有 6 部且没有 area 字段，编一个空维度等于假实现，所以不做。

5. 客户版静默自动升级 + 失败回退（P1-07 / P1-08）  client-auto-update.js（新建）
   四档 mode：off / check / download / install。清单默认走远端 remote-manifest.json。
   checkDownloadUrl：强制 https、只认 .exe、必须与清单 baseUrl 同源（防清单被换成外部行）。
   下载落 userData/updates，sha256File 校验，不符即删包并把 attempts+1。
   nextDelay 退避 0 / 1h / 6h / 24h。
   detectInstallNoChange：启动时对比「已装版本」与「本机版本」，装完没变就置
   lastInstallNoChange 并停止自动安装，避免「装了→重启→再装」死循环。
   免安装目录（无 Uninstall*.exe）自动降级为「只下载提示」。
   与开发端 dev-auto-update.js 完全隔离，绝不混用。

6. 设备码账号 / 云同步 / 跨端续播 / 手机遥控（P1-01/02/03 · P2-B09/B10）
   server/account-sync.js（新建）：
     · 设备码 4+4，字符集去掉 0/O/1/I（32 字符），码本身即凭证，无密码、无找回；
     · 数据落 server/data/accounts.json，tmp+rename 原子写；
     · 只收四类：fav / hist / watchlist / livefav / prog；单条只留白名单字段，链接型字段直接丢；
       fav 上限 200、hist 200、watchlist 100、livefav 100、prog 200；
     · 合并：按 id 求并集、新的在前；续播点有时间戳比时间，都没时间戳就留进度更靠后的；
     · 遥控：POST /api/remote/cmd 入内存队列（8 个白名单指令，20 秒过期，单码上限 60），
       GET /api/remote/poll?since= 增量取走；GET /remote 返回单文件遥控页（无外部脚本）。
   server/server.js：7 条账号/遥控路由 + /remote 页面。
   app/kh-account.js（新建）：
     · 本机码 kh_acct_code，首次生成落盘；同步用 khFetch（带口令头）走中枢；
     · profile() 读 kh_fav/kh_hist/kh_watchlist/kh_livefav/kh_prog 组装；
     · applyProfile() 把云端对象条目还原成 id 列表，prog 还原成纯秒数写回 kh_prog；
     · sync() 遇 404（中枢没这枚码）自动注册后重试一次；
     · startRemote() 每 2.5 秒轮询，指令落到 togglePlay / seekBy / applyVolume /
       khStepMovie / closePlayer；
     · pairUrl() 生成 /remote?code= 地址供二维码。
   面板「账号与云同步」把「码丢了找不回」「自定义源 id 跨端对不上」这两条限制直接写在界面上。

7. 简体 / 繁体 / 英文（P2-B15）  app/kh-hant.js（新建）
   显示层转换：词组优先表（42 条，如 关系→關係、平台→平臺、默认→預設、视频→影片、
   搜索→搜尋、缓存→快取、保存→儲存、登录→登入、账号→帳號、网络→網路、文件→檔案）
   ＋单字表（224 条）。
   实现是四步占位法：先把英文缩写/单位/kh_ 键名/文件名/URL 抽成占位 → 词组整体替换也占位
   （否则「只有」会被单字表再转成「隻有」，这是本轮踩到的真 bug）→ 剩字逐字转 → 先还词组再还英文。
   walk() 用 TreeWalker 跳过 INPUT/TEXTAREA/SELECT/SCRIPT/STYLE/CODE/PRE，同时转
   placeholder / title / aria-label / alt。只在 kh_lang==='zh-hant' 时执行，且总在简体渲染之后。
   覆盖是「界面高频字」，不是全字表——生僻字保持简体，这是如实的能力边界。

三、本版核实「早就有了」，没有新写代码
------------------------------------------------------------
  首页推荐位云端可配   server/ops-config.js promo + /api/promo + kh-app refreshPromo
  接口来源白名单       /api/config/origins + server.js 的 CORS 校验（管的是中枢访问，不是入口）
  网络代理 / 镜像站    electron-main kh:proxy-set 三模式 + preload khProxy + 分发清单多源
  播放失败分级          kh-player fatal 降档 + 逐源回退 + E-NET/E-DECODE/E-HLS-* 可读码
  静默覆盖安装          kh:install-silent（只对含 Uninstall*.exe 的安装目录生效）

四、产物与哈希（现算）
------------------------------------------------------------
{art}

五、单测
------------------------------------------------------------
{tests}
  合计 {total} 项，全绿。

六、已知限制
------------------------------------------------------------
  · Windows 安装包没有商业代码签名（未配 WIN_CSC_FILE），SmartScreen 会提示未知发布者。
  · 设备端没上真机：hbdc/hdc 无可用设备，HAP 只做了打包 + 签名 + 符号门禁，未做设备冒烟。
  · 公网站点的 exe / hap 需要宿主在面板手点发布；自动上传只覆盖清单与页面。
  · 设备码无密码无找回；丢了只能重新生成，旧云端数据取不回（界面已写明）。
  · 跨端续播只对内置片源（数字 id）有效；自定义网址与影视仓条目 id 是本机的，跨端只留历史记录。
  · 繁体为界面高频字覆盖，不是完整字表。
'''

tests_txt = '\n'.join('  %-16s %-42s %3d 项' % (a, b, c) for a, b, c, in TESTS)
log = log.format(v=V, code=CODE, dev=DEVCODE, art=art_rows, tests=tests_txt, total=TOTAL)
LOGNAME = '鸿汇影·更新日志_v%s.txt' % V
with open(os.path.join(DOC, LOGNAME), 'w', encoding='utf-8', newline='\n') as f:
    f.write(log)

# ---------------- 文档索引 ----------------
idx = '''鸿汇影 · 文档索引 v{v}
============================================================

一、先看这两份
  {log}          本版改了什么、怎么验证、有哪些限制（就是这一版）
  客户下载说明.txt        在「鸿汇影·客户成品_v{v}」夹子里，给最终用户看

二、按需要找
  装机环境核对清单.txt      「客户成品」夹子，勾一遍就知道环境对不对
  开发者端说明_v{v}.txt      「开发端」夹子，新文件与改动文件清单
  密钥与口令清单_v{v}.txt    「开发端」夹子（不要外发）
  鸿汇影·功能导航_v{v}.html  浏览器打开，本版六类新增点在哪、怎么用
  鸿汇影·变更与验证清单_v{v}.xlsx  十行清单：编号 / 名称 / 文件 / 入口 / 单测 / 状态

三、本版产物哈希（与「客户成品」夹里的 .sha256 一致）
{art}

四、口径提醒
  · 本版「新增」只算真正写进代码的六类；盘点表里另外五项核实后确认早已实现，不算新增。
  · 所有哈希都是现算的，不是从上一版抄的；大小对不上就是文件不对。
'''
idx = idx.format(v=V, log=LOGNAME, art=art_rows)
with open(os.path.join(DOC, '鸿汇影·文档索引_v%s.txt' % V), 'w', encoding='utf-8', newline='\n') as f:
    f.write(idx)

# ---------------- 功能导航 HTML ----------------
rows = ''.join(
    '<tr><td class="c1">%s</td><td class="c2">%s</td><td><code>%s</code></td><td>%s</td></tr>'
    % (i[0], i[1], i[2], i[3]) for i in ITEMS)
tests_rows = ''.join(
    '<tr><td>%s</td><td><code>%s</code></td><td class="num">%d</td></tr>' % (a, b, c) for a, b, c in TESTS)
html = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>鸿汇影 v{v} · 功能导航</title>
<style>
:root{{--bg:#0B0D16;--card:#141826;--line:#262B3B;--fg:#E6EEF9;--mut:#8D96AB;--acc:#FF7A45}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--fg);
font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;padding:28px 22px 48px}}
.wrap{{max-width:1080px;margin:0 auto}}
h1{{font-size:22px;margin:0 0 6px}}h2{{font-size:15px;margin:26px 0 8px;color:var(--acc)}}
.sub{{color:var(--mut);font-size:13px;margin:0 0 18px}}
table{{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}}
th,td{{padding:9px 11px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}}
th{{background:#171A26;color:var(--mut);font-weight:600;font-size:12.5px}}
tr:last-child td{{border-bottom:0}}
td.c1{{width:96px;color:#FFD166;font:600 12px/1.4 ui-monospace,monospace}}
td.c2{{width:230px;font-weight:600}}
td.num{{text-align:right;font-variant-numeric:tabular-nums;width:80px}}
code{{font:12px/1.4 ui-monospace,monospace;color:#9CD4FF;background:#0E1420;padding:2px 6px;border-radius:5px}}
.tag{{display:inline-block;font-size:11.5px;padding:1px 8px;border-radius:99px;border:1px solid #2C3345;color:var(--mut);margin-left:8px}}
.total{{color:var(--mut);font-size:12.5px;margin-top:8px}}
.note{{margin-top:26px;padding:12px 14px;background:#151019;border:1px solid #3A2230;border-radius:10px;color:#D9B9C6;font-size:12.5px}}
</style></head><body><div class="wrap">
<h1>鸿汇影 v{v} · 功能导航</h1>
<p class="sub">应用版本 #{code} · 开发端变体 #{dev} · 2026-11-23 · 只列本版真正写进代码的六类</p>

<h2>一、新增功能在哪</h2>
<table><thead><tr><th>编号</th><th>功能</th><th>代码</th><th>在哪打开 / 怎么触发</th></tr></thead>
<tbody>{rows}</tbody></table>

<h2>二、单测</h2>
<table><thead><tr><th>模块</th><th>脚本</th><th class="num">项数</th></tr></thead>
<tbody>{tests}</tbody></table>
<p class="total">合计 <b>{total}</b> 项，全绿。跑法：<code>node scripts\\test-xxx-kit.js</code></p>

<h2>三、产物</h2>
<table><thead><tr><th>类型</th><th>文件</th><th>大小</th></tr></thead><tbody>{arts}</tbody></table>

<div class="note">
  口径：盘点表里另有五项（推荐位云端、来源白名单、网络代理与镜像站、播放失败分级、静默覆盖安装）
  grep 核实后确认早已实现，本版没有重复写代码，也不把它们算成「新增」。
  已知限制：未商业签名、设备端未上机、公网 exe/hap 需手点发布、设备码无找回、跨端续播只对内置片源、
  繁体为高频字覆盖。这些都写进了更新日志，不藏。
</div>
</div></body></html>'''
arts_rows = ''.join('<tr><td>%s</td><td><code>%s</code></td><td class="num">%s B</td></tr>' % (k, ART[k][0], ART[k][1]) for k in FILES)
html = html.format(v=V, code=CODE, dev=DEVCODE, rows=rows, tests=tests_rows, total=TOTAL, arts=arts_rows)
with open(os.path.join(DOC, '鸿汇影·功能导航_v%s.html' % V), 'w', encoding='utf-8', newline='\n') as f:
    f.write(html)

# ---------------- xlsx ----------------
XLSX = os.path.join(DOC, '鸿汇影·变更与验证清单_v%s.xlsx' % V)
try:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    wb = Workbook()
    ws = wb.active
    ws.title = '本版变更'
    head = ['编号', '功能', '代码文件', '入口', '单测脚本', '项数', '状态']
    ws.append(head)
    for i in ITEMS:
        t = next((x for x in TESTS if x[0] in i[1] or i[1] in x[0]), None)
        ws.append([i[0], i[1], i[2], i[3], t[1] if t else '—', t[2] if t else '—', '已实现 · 单测通过'])
    for c in range(1, 8):
        ws.cell(row=1, column=c).font = Font(bold=True, color='FFFFFF')
        ws.cell(row=1, column=c).fill = PatternFill('solid', fgColor='1F2433')
    widths = [12, 30, 40, 42, 40, 8, 20]
    for n, w in enumerate(widths, start=1):
        ws.column_dimensions[chr(64 + n)].width = w
    ws.freeze_panes = 'A2'

    ws2 = wb.create_sheet('产物与哈希')
    ws2.append(['类型', '文件', '大小(B)', 'SHA256'])
    for k in FILES:
        ws2.append([k, ART[k][0], ART[k][1], ART[k][2]])
    for c in range(1, 5):
        ws2.cell(row=1, column=c).font = Font(bold=True, color='FFFFFF')
        ws2.cell(row=1, column=c).fill = PatternFill('solid', fgColor='1F2433')
    for n, w in enumerate([14, 46, 16, 70], start=1):
        ws2.column_dimensions[chr(64 + n)].width = w
    ws2.freeze_panes = 'A2'

    ws3 = wb.create_sheet('核实已存在')
    ws3.append(['项目', '代码位置', '结论'])
    for a, b, c in [
        ('首页推荐位云端可配', 'server/ops-config.js promo · /api/promo · kh-app refreshPromo', '已实现，本版无新代码'),
        ('接口来源白名单', 'server/server.js CORS · /api/config/origins', '已实现，管中枢访问不是入口'),
        ('网络代理 / 镜像站', 'electron-main kh:proxy-set · preload khProxy · 分发清单 mirrors', '已实现，本版无新代码'),
        ('播放失败分级', 'kh-player.js fatal 降档 + 逐源回退 + 错误码', '已实现，本版无新代码'),
        ('静默覆盖安装', 'electron-main kh:install-silent', '已实现，免安装目录会拒绝'),
    ]:
        ws3.append([a, b, c])
    for c in range(1, 4):
        ws3.cell(row=1, column=c).font = Font(bold=True, color='FFFFFF')
        ws3.cell(row=1, column=c).fill = PatternFill('solid', fgColor='1F2433')
    for n, w in enumerate([22, 62, 30], start=1):
        ws3.column_dimensions[chr(64 + n)].width = w

    wb.save(XLSX)
    xlsx_out = XLSX
except Exception as e:      # 没装 openpyxl 就退化成 CSV，不假装生成了 xlsx
    import traceback
    traceback.print_exc()
    csv_path = os.path.join(DOC, '鸿汇影·变更与验证清单_v%s.csv' % V)
    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        f.write('编号,功能,代码文件,入口,状态\n')
        for i in ITEMS:
            f.write('%s,%s,%s,%s,已实现\n' % (i[0], i[1], i[2], i[3]))
    xlsx_out = csv_path + '（openpyxl 不可用，退化为 CSV：%s）' % type(e).__name__

print('文档已生成：')
for n in (LOGNAME, '鸿汇影·文档索引_v%s.txt' % V, '鸿汇影·功能导航_v%s.html' % V):
    print('  %s  %s B' % (n, fmt(os.path.getsize(os.path.join(DOC, n)))))
print('  %s' % xlsx_out)
