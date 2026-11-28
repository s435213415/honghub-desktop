# -*- coding: utf-8 -*-
"""1.7.96 文档资料包：更新日志 / 文档索引 / 功能导航 HTML / 分发前 6 项清单 xlsx

1.7.96 定位：不加功能，只做「可分发」的前置（口径落界面 + 安装说明 + 公网验收脚本 + 过线手册）。
输出到 Desktop\\鸿汇影·文档资料\\，文件名带版本号，不覆盖旧版。
用法：python scripts\\release\\doc_196.py
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
    ART[k] = ((os.path.basename(p), fmt(os.path.getsize(p)), sha(p)) if os.path.exists(p)
              else (os.path.basename(p), '缺', ''))

os.makedirs(DOC, exist_ok=True)
art_rows = '\n'.join(
    '  %-12s %-44s %14s B\n               %s' % (k, ART[k][0], ART[k][1], ART[k][2] or '（未生成）')
    for k in FILES)

ITEMS = [
    ('分发口径', '侵权投诉 + 72h 下线 + 外发默认关', 'app/kh-admin.js · app/kh-core.js',
     '关于页「侵权投诉与下线」/ 首启声明；客户下载说明第七节'),
    ('安装说明', '杀软误报处理 + 干净卸载步骤', 'scripts/release/deliver.py',
     '客户下载说明第五、六节（SmartScreen / 杀软 / 路径 / 数据目录）'),
    ('公网验收', '清单 / 成品 / Range / 哈希 只读验收', 'scripts/release/verify-public-dist.js（新建）',
     '命令行：--base https://… [--full]'),
    ('过线手册', '分发前必须过的 6 项（现状 / 过线 / 判定）', 'scripts/release/DISTRIBUTION-READINESS.md（新建）',
     '文档直接读'),
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

GATE = [
    ('1 内容来源与口径', '代码侧已完成（投诉段 + 外发口径 + 违规词扫描）', '待你：给一个可达投诉邮箱', '关于页显示「尚未配置」时不得对外分发'),
    ('2 商业代码签名', '链路已有（sign-windows.js + 4.5/6 步骤）', '待你：买 OV/EV 证书并配 WIN_CSC_FILE', '4.5/6 不再 SKIPPED，签名属性 Status=Valid'),
    ('3 正式站点成品可达', '脚本已备（verify-public-dist.js）', '待你：把 dist/public 全量同步到站点', '外网机器下载并比对 sha256 一致'),
    ('4 公网自动升级端到端', '四档 mode / 哈希校验 / 退避 / 防循环已在', '待你：站点放行后实测老包升级', '成功与「故意改错 sha」两条日志'),
    ('5 问题回执闭环', '/api/report 与 /api/issues 已在，客户端默认只存本机', '待你：面板加处理状态流转', '造一条问题→面板可见→可标状态'),
    ('6 装机与卸载干净度', '说明已写（第五、六节）', '待你：干净虚拟机走三步', '注册表/开始菜单/AppData 无残留'),
]

# ---------------- 更新日志 ----------------
log = '''鸿汇影 · 更新日志 v{v}
============================================================
应用版本：{v} / #{code}      开发端 HAP：#{dev}
生成时间：2026-11-23
上一版：1.7.95 / #1000209（六类功能落地，12 步流水线 0 失败）

一、这一版的定位
------------------------------------------------------------
不加功能。上一版已经把盘点表清空，这一版只做「小圈子分发」的前置：
把本来只写在文档里的口径，真正落到界面上；把装不上的处理办法写进客户说明；
再补一个能一条命令验收公网站点的脚本，和一份 6 项过线手册。
判断标准很简单——用户拿到包之后，第一个小时里会踩的坑，先在这一版堵掉。

二、本版落地的四件
------------------------------------------------------------
1. 分发口径进界面（不是只写在 README 里）
   · 关于页与首启声明显著位置新增「侵权投诉与下线」：承诺收到可核实投诉后 72 小时内下线对应入口或片源条目。
   · 隐私摘要补一句：问题与崩溃记录默认也只存本机，外发必须在设置页显式开启，并受每日条数上限约束。
   · 常量 KH_ABUSE_MAIL 在 app/kh-admin.js 顶部。**空值时界面会明确显示「尚未配置」，不用假邮箱冒充投诉通道**；
     分发前必须填真实可达邮箱，否则不应对外发链接。

2. 客户下载说明补两节（deliver.py 生成，不是手写附件）
   · 第五节「装不上怎么办」：SmartScreen「仍要运行」怎么点、杀软加信任、别放 OneDrive/U 盘、旧版本先卸。
   · 第六节「卸载干净」：卸载路径 + 两处数据目录（%APPDATA%\\HongHub-Desktop、%LOCALAPPDATA%\\HongHub-Desktop）
     + 先导出备份再卸。
   · 第七节「数据与投诉」：外发默认关、只发脱敏摘要、投诉入口在哪。

3. 新增 scripts/release/verify-public-dist.js（只读验收）
   一条命令检查：清单是否可达、exe/hap 是否 200、是否支持 Range（206）、内容长度是否与清单一致；
   加 --full 还会整包下载比对 sha256。它专门用来抓「清单 200、包 404」这种最容易被漏掉的状态。
   退出码 0/1/2，可直接接进发布流程。

4. 新增 scripts/release/DISTRIBUTION-READINESS.md（6 项过线手册）
   每项写清：现状（我核过代码）、过线标准、判定方式，以及哪些是我做完了、哪些必须你来做（买证书 / 放行成品 / 干净机器实测）。

三、上一版（1.7.95）已完成，本版不重复
------------------------------------------------------------
  六类真新增：平台入口域名守卫、电视与遥控、快捷键一览、分类标签筛选、客户版静默升级+回退、
  设备码账号/云同步/跨端续播/扫码遥控。
  五项经核实早已存在、未重复开发：推荐位云端、接口来源白名单、网络代理与镜像站、播放失败分级、静默覆盖安装。

四、产物与哈希（现算）
------------------------------------------------------------
{art}

五、单测
------------------------------------------------------------
{tests}
  合计 {total} 项，全绿。

六、分发前 6 项（本版推进到哪）
------------------------------------------------------------
{gate}

七、已知限制
------------------------------------------------------------
  · 安装包仍未商业签名（WIN_CSC_FILE 未配），SmartScreen 会提示未知发布者。
  · 公网站点 exe/hap 仍是 404：清单与页面已同步，成品需在宿主面板手点放行；7.1/8 的 206 是临时隧道，不算正式分发。
  · 自动升级链路完整但未实测：要等第 3 项过线后才可能真跑通。
  · 设备端没上真机：hdc 无可用设备，HAP 只做到打包+签名+符号门禁。
  · 设备码无密码无找回；跨端续播只对内置片源；繁体为界面高频字覆盖。
'''

gate_txt = '\n'.join('  %-18s %-44s %-38s %s' % (a, b, c, d) for a, b, c, d in GATE)
tests_txt = '\n'.join('  %-16s %-42s %3d 项' % (a, b, c) for a, b, c in TESTS)
log = log.format(v=V, code=CODE, dev=DEVCODE, art=art_rows, tests=tests_txt, total=TOTAL, gate=gate_txt)
LOGNAME = '鸿汇影·更新日志_v%s.txt' % V
with open(os.path.join(DOC, LOGNAME), 'w', encoding='utf-8', newline='\n') as f:
    f.write(log)

# ---------------- 文档索引 ----------------
idx = '''鸿汇影 · 文档索引 v{v}
============================================================

一、先看这两份
  {log}          本版改了什么、6 项推进到哪、限制（就是这一版）
  客户下载说明.txt        在「鸿汇影·客户成品_v{v}」夹子里，给最终用户看（已补装不上/卸载干净两节）

二、分发给别人之前必读
  DISTRIBUTION-READINESS.md   在仓库 scripts\\release\\ 下：6 项过线手册（现状 / 过线 / 判定）
  鸿汇影·分发前6项清单_v{v}.xlsx  同一份清单的表格版，可在 Excel 里勾

三、按需要找
  装机环境核对清单.txt      「客户成品」夹子
  开发者端说明_v{v}.txt      「开发端」夹子
  密钥与口令清单_v{v}.txt    「开发端」夹子（不要外发）
  鸿汇影·功能导航_v{v}.html  浏览器打开，看本版四件落在哪个界面
  鸿汇影·变更与验证清单_v{v}.xlsx  十行清单：编号 / 名称 / 文件 / 入口 / 单测 / 状态

四、本版产物哈希（与「客户成品」夹里的 .sha256 一致）
{art}
'''
idx = idx.format(v=V, log=LOGNAME, art=art_rows)
with open(os.path.join(DOC, '鸿汇影·文档索引_v%s.txt' % V), 'w', encoding='utf-8', newline='\n') as f:
    f.write(idx)

# ---------------- 功能导航 HTML ----------------
rows = ''.join(
    '<tr><td class="c1">%s</td><td class="c2">%s</td><td><code>%s</code></td><td>%s</td></tr>'
    % (i[0], i[1], i[2], i[3]) for i in ITEMS)
gate_rows = ''.join(
    '<tr><td class="c1">%s</td><td>%s</td><td>%s</td><td>%s</td></tr>' % (a, b, c, d) for a, b, c, d in GATE)
html = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>鸿汇影 v{v} · 分发准备导航</title>
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
td.c1{{width:110px;color:#FFD166;font:600 12px/1.5 ui-monospace,monospace}}
td.c2{{width:220px;font-weight:600}}
code{{font:12px/1.4 ui-monospace,monospace;color:#9CD4FF;background:#0E1420;padding:2px 6px;border-radius:5px}}
.note{{margin-top:26px;padding:12px 14px;background:#151019;border:1px solid #3A2230;border-radius:10px;color:#D9B9C6;font-size:12.5px}}
</style></head><body><div class="wrap">
<h1>鸿汇影 v{v} · 分发准备导航</h1>
<p class="sub">应用版本 #{code} · 开发端变体 #{dev} · 本版不加功能，只做可分发前置</p>

<h2>一、本版四件落在哪</h2>
<table><thead><tr><th>类型</th><th>做了什么</th><th>代码 / 脚本</th><th>在哪看</th></tr></thead>
<tbody>{rows}</tbody></table>

<h2>二、分发前 6 项</h2>
<table><thead><tr><th>项</th><th>现状</th><th>待你做的</th><th>判定</th></tr></thead>
<tbody>{gate}</tbody></table>

<div class="note">
  口径：本版没有新功能，也不假装 6 项已全部过线——第 2/3/4/5/6 项都还需要外部条件（证书、站点放行、干净机器、面板状态流转）。
  投诉邮箱为空时，关于页会明确显示「尚未配置」；这种情况不要对外发链接。
</div>
</div></body></html>'''
html = html.format(v=V, code=CODE, dev=DEVCODE, rows=rows, gate=gate_rows)
with open(os.path.join(DOC, '鸿汇影·功能导航_v%s.html' % V), 'w', encoding='utf-8', newline='\n') as f:
    f.write(html)

# ---------------- xlsx ----------------
XLSX = os.path.join(DOC, '鸿汇影·分发前6项清单_v%s.xlsx' % V)
try:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    wb = Workbook()
    ws = wb.active
    ws.title = '分发前6项'
    ws.append(['项', '现状（已核实）', '待你做的', '过线判定'])
    for g in GATE:
        ws.append(list(g))
    ws2 = wb.create_sheet('本版变更')
    ws2.append(['类型', '做了什么', '代码 / 脚本', '入口'])
    for i in ITEMS:
        ws2.append(list(i))
    ws3 = wb.create_sheet('产物与哈希')
    ws3.append(['类型', '文件', '大小(B)', 'SHA256'])
    for k in FILES:
        ws3.append([k, ART[k][0], ART[k][1], ART[k][2]])
    for sh, widths in ((ws, [18, 52, 44, 44]), (ws2, [12, 40, 46, 50]), (ws3, [14, 46, 16, 70])):
        for c in range(1, len(widths) + 1):
            sh.cell(row=1, column=c).font = Font(bold=True, color='FFFFFF')
            sh.cell(row=1, column=c).fill = PatternFill('solid', fgColor='1F2433')
        for n, w in enumerate(widths, start=1):
            sh.column_dimensions[chr(64 + n)].width = w
        sh.freeze_panes = 'A2'
    wb.save(XLSX)
    xlsx_out = XLSX
except Exception:
    import traceback
    traceback.print_exc()
    csv_path = os.path.join(DOC, '鸿汇影·分发前6项清单_v%s.csv' % V)
    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        f.write('项,现状,待你做,判定\n')
        for g in GATE:
            f.write(','.join(g) + '\n')
    xlsx_out = csv_path

print('文档已生成：')
for n in (LOGNAME, '鸿汇影·文档索引_v%s.txt' % V, '鸿汇影·功能导航_v%s.html' % V):
    print('  %s  %s B' % (n, fmt(os.path.getsize(os.path.join(DOC, n)))))
print('  %s' % xlsx_out)
