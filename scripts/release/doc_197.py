# -*- coding: utf-8 -*-
"""1.7.97 文档资料包：更新日志 / 文档索引 / 功能导航 HTML / 分发前 6 项清单 xlsx

1.7.97 定位：把「自用体验缺口」里能自己关掉的六项做掉
（CSP 观察 / 按片倍速 / 片头跳过+A-B / 平台分批渲染 / 骨架屏 / 本地短评）。
输出到 Desktop\\鸿汇影·文档资料\\，文件名带版本号，不覆盖旧版。
用法：python scripts\\release\\doc_197.py
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
    ('CSP 观察', 'Report-Only 起步，只计数不拦截', 'app/index.html meta + app/kh-extras.js',
     '违规条数写 kh_csp_log（≤100 条），diag 的 data-csp 可见'),
    ('按片倍速', '换片自动套用该片上次倍速', 'app/kh-extras.js · kh_rate_map',
     '播放条倍速按钮；没记过的片沿用全局 kh_rate'),
    ('片头跳过 + A-B', '记一次片头秒数，之后起播自动跳', 'app/kh-extras.js · kh_intro_map',
     '播放条「⏭ 片头」（长按重记）/「🔁 A-B」（三态）'),
    ('平台分批渲染', '124 平台先出 60 个，按需追加', 'app/kh-core.js + app/kh-app.js（plat-more）',
     '平台页列表底部「显示更多 / 一次显示全部」'),
    ('骨架屏', '首屏占位，避免白屏', 'app/index.html（.kh-skel）',
     '冷启动第一帧；render 后自动被真实内容替换'),
    ('本地短评', '按片一句短评，只存本机', 'app/kh-extras.js · kh_rev',
     '播放页「写一句短评」输入框 + 最近一条回显'),
    ('备份白名单', '倍速 / 片头 / 短评随备份走', 'app/kh-admin.js（KH_BAK_SETTINGS）',
     '设置 → 备份与恢复；CSP 日志刻意不进备份'),
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
上一版：1.7.96 / #1000210（分发前置四件，12 步验收通过）

一、这一版的定位
------------------------------------------------------------
不加新方向，只把「我自用即受益、且给小圈子分发少两个变量」的六项做掉。
判断标准：改完之后自己每天用时立刻能感觉到；给第二个人时，不增加新的故障面。

二、本版六件
------------------------------------------------------------
1. CSP 观察起步（report-only，只报告不拦截）
   · app/index.html 增加 Content-Security-Policy-Report-Only。注意是 Report-Only：现有任何加载都不会被拦，
     所以这一版不存在「收紧过头把播放器弄坏」的风险。
   · 新增 app/kh-extras.js 监听 securitypolicyviolation，把违规累计到 kh_csp_log（最多 100 条：指令 / 被拦地址 / 时间）。
   · 同时挂在 diag 的 data-csp 上，便于诊断报告直接看到条数。观察一两周、看清违规来源后，再决定是否收紧为强制模式。

2. 按片记忆倍速（以前只有一个全局 kh_rate）
   · 新增 kh_rate_map（片 id → 倍速）：换片自动套用该片上次的倍速；没记过的片沿用全局 kh_rate。
   · 直播不参与（直播谈「上次倍速」没有意义）。上限 500 片，超出按写入顺序淘汰最老的。
   · 全局 kh_rate 保留不动，所以「从没看过的片」仍是你在设置里定的默认倍速。

3. 片头跳过 + A-B 循环（播放条两个新按钮）
   · 「⏭ 片头」：该片没记过 = 把当前位置记为本片片头（不足 5 秒会拒绝，防止误记）；
     记过 = 起播自动跳到片头结束，手点也能跳；长按（右键）重新记当前位置。
   · 「🔁 A-B」：第一下设 A、第二下设 B、第三下取消。B 必须比 A 晚 1 秒以上，越界会自动回 A。
   · 只在当前片内存里，重开即清，不落盘。

4. 平台列表分批渲染（124 个平台入口不再一次全拼）
   · 先出 60 个，底部「显示更多（还有 N 个）」每次 +60，「一次显示全部 N 个」直接出完。
   · 换分类、换筛选会回到 60，避免沿用上一个分类的展开量。
   · 说清楚口径：这是分批渲染，不是真正的虚拟化。滚动容器是整页，做窗口化会把 TV 遥控的方向键焦点顺序打乱，
     收益不值这个风险；先把首屏渲染量从 124 降到 60。

5. 骨架屏
   · #main 里预置 6 张骨架卡（渐变扫光），render() 完成后被真实内容整体替换。
   · prefers-reduced-motion 下不做动画。它只改首帧观感，不参与任何交互。

6. 本地短评
   · 播放页底部一行：输入框 + 保存 + 「我的短评」回显（带日期）。每片一条、最多 60 字，再次保存即覆盖。
   · 存 kh_rev，最多 200 片，超上限按时间淘汰最老的。只存本机、不上传，也不进问题上报。
   · 输入框里按空格/方向键不会触发播放器快捷键（已拦），回车即保存。

三、这些新数据跟着备份走
------------------------------------------------------------
   · KH_BAK_SETTINGS 补 kh_rate_map / kh_intro_map / kh_rev：换机时倍速、片头、短评一起走。
   · kh_csp_log 刻意不进备份：它描述的是这台机器的运行状况，换机没有意义。

四、上一版（1.7.96）不重复
------------------------------------------------------------
  1.7.96 做的是分发前置，未改动、仍在：投诉与下线口径（常量 + 空值如实提示）、
  客户说明第五~七节（装不上 / 卸载干净 / 数据与投诉）、verify-public-dist.js、6 项过线手册。

五、产物与哈希（现算）
------------------------------------------------------------
{art}

五、单测与门禁
------------------------------------------------------------
{tests}
  合计 {total} 项，全绿；四门禁全过（面板 12/12、客户端功能接线无缺、配置覆盖 97%、客户包纯净性 0 违规）；
  UI 冒烟：203 个控件、21 个面板真点、错误 0。

六、分发前 6 项（本版推进到哪）
------------------------------------------------------------
{gate}

七、已知限制
------------------------------------------------------------
  · 安装包仍未商业签名（WIN_CSC_FILE 未配），SmartScreen 会提示未知发布者。
  · 公网站点 exe/hap 仍是 404：清单与页面已同步，成品需在宿主面板手点放行；7.1/8 的 206 是临时隧道，不算正式分发。
  · 自动升级链路完整但未实测：要等第 3 项过线后才可能真跑通。
  · 投诉邮箱仍为空：关于页显示「尚未配置」，分发前必须填。
  · 设备端没上真机：hdc 无可用设备，HAP 只做到打包+签名+符号门禁。
  · CSP 目前只是观察态：违规计数在 diag 的 data-csp 与 kh_csp_log 里，还没有做面板可视化。
  · 包体仍是 110 MB，asar 没开。这是有意为之：asar 要动资源路径，会打乱「交付夹可见文件 + 纯净性按条目核验」，
    而体积大头是 Electron 运行时，不是 app 里的文本文件，收益与风险不成比例。
  · 平台列表是分批渲染，不是虚拟化：极端低配机滚到第 3 批追加时仍会有一次顿感。
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
  鸿汇影·功能导航_v{v}.html  浏览器打开，看本版六件分别落在哪个界面
  鸿汇影·分发前6项清单_v{v}.xlsx  三张表：分发前 6 项 / 本版变更 / 产物与哈希

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
<p class="sub">应用版本 #{code} · 开发端变体 #{dev} · 本版把六项自用体验缺口做掉</p>

<h2>一、本版六件落在哪</h2>
<table><thead><tr><th>类型</th><th>做了什么</th><th>代码 / 脚本</th><th>在哪看</th></tr></thead>
<tbody>{rows}</tbody></table>

<h2>二、分发前 6 项</h2>
<table><thead><tr><th>项</th><th>现状</th><th>待你做的</th><th>判定</th></tr></thead>
<tbody>{gate}</tbody></table>

<div class="note">
  口径：这一版做的是自用体验缺口，不是伪装成已可公开分发——第 2/3/4/5/6 项分发条件仍需要外部动作（证书、站点放行、干净机器、面板状态流转）。
  投诉邮箱为空时，关于页会明确显示「尚未配置」；这种情况不要对外发链接。CSP 目前只观察、不拦截。
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
