# -*- coding: utf-8 -*-
"""1.7.94 可配置项清单：复制 1.7.93 → 更新 14 项（#37 #58 #59 #60 #63 #65 #66 #69 #70 #71 #72 #75 #77 #78）→ 加「v1.7.94 重算说明」sheet
   目标口径：81 已实现 / 0 部分已有 / 0 待做"""
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

SRC = r'C:\Users\admin\Desktop\鸿汇影·文档资料\鸿汇影·客户端可配置项清单_v1.7.93.xlsx'
DST = r'C:\Users\admin\Desktop\鸿汇影·文档资料\鸿汇影·客户端可配置项清单_v1.7.94.xlsx'

UPD = {
    37: ('已实现', 'kh_net_family / kh_dns', 'auto / 空',
         '设置 · 网络族与自定义 DNS › 网络族（自动 / 仅 IPv4 / 仅 IPv6）+ 自定义 DNS（最多 3 条）',
         'net-save ／ khNetPush → kh:b8-net-set（主进程 userData/kh-net.json）',
         'DONE',
         'KHMETA.normIpMode 白名单 auto/ipv4/ipv6，非法回落 auto；dnsList 同时校验 IPv4 与域名、上限 3 条；'
         'mode=ipv4 时主进程启动 appendSwitch("disable-ipv6")，下次启动生效；自定义 DNS 只做记录 + 启动参数，'
         '不替代系统解析器（笔记与面板文案照实写明，不做假实现）。'),
    58: ('已实现', 'kh_profiles / kh_profile_cur / kh_profiles_data', '1 档「家庭」/ p1 / {}',
         '设置 · 家庭多档案 › 每档行内改名 + 切换 + 删除，当前档「切换」置灰',
         'prof-add / prof-rename / prof-switch / prof-del ／ KHFAMILY.snapshot + khProf* 十函数',
         'DONE',
         '上限 4 档；切档时把 10 个键（kh_fav / kh_watchlater / kh_hist / kh_prog / kh_watchlist / '
         'kh_watchlist_meta / kh_livefav / kh_kid / kh_kid_pin / kh_kid_min）dump→restore 换挡，'
         '不改任何既有存储键，旧逻辑零改动；缺键写回默认值而不是 removeItem（避免被判定为存储损坏）。'
         '改名走行内输入框（Electron 渲染进程没有 window.prompt）。'),
    59: ('已实现', 'kh_meta_src / kh_meta_custom / kh_meta_cache / kh_tmdb_key', 'builtin / {} / [] / 空',
         '设置 · 元数据与海报来源 › 来源单选（内置 / TMDB / 自定义模板）+ 模板 + Key + 测试刮削 + 清缓存',
         'meta-save / meta-scrape / meta-clear ／ KHMETA 校验 + poster() 接入刮削结果',
         'DONE',
         '四种来源 builtin / tmdb / douban / custom，自定义模板必须含 {title}；海报只认 http(s)；'
         '评分限 0–10；缓存按 at 淘汰、上限 50；刮到的海报 / 评分 / 简介直接进卡片，卡片底部标注来源。'
         '豆瓣刮削明确不实现（无公开 API + 抓网页违反条款），UI 文案已写明；TMDB 需用户自备 Key，'
         '不填只报原因、不假装成功。'),
    60: ('已实现', 'kh_sub_src / kh_ai_key / kh_ai_base', '[] / 空 / 空',
         '设置 · 字幕站与 AI Key › 字幕站最多 10 个地址（应用内打开）+ AI Key（只露后 4 位）+ 自定义接口地址',
         'sub-sites-save / ai-save / ai-clear ／ KHMETA.subSites + maskKey',
         'DONE',
         '字幕站只留 http(s)、上限 10，走应用内 WebView，不跳系统浏览器；AI Key 至少 8 位、界面只显示后 4 位、'
         '备份包里不含该键；接口地址只接受 http(s)。'),
    63: ('已实现', '38 个既有键的统一视图（KH_CFG_REG）', '按各自默认值',
         '设置 · 配置总览（38 项）› #cfgQ 搜索 + 单键改 + 单键 ↺ + 按组恢复 + 全部恢复',
         'cfg-save / cfg-one-reset / cfg-reset / cfg-reset-all / cfg-clear ／ khCfgRows / khCfgGroups',
         'DONE',
         '38 键分 7 组（播放 11 / 界面 10 / 通知与启动 7 / 儿童 3 / 网络 3 / 数据 2 / 远端与云端 2）；'
         '搜索按名称、键名、分组匹配；恢复默认是「写回默认值」而不是删键，保住封条口径；'
         '锁定项只置灰提示，不阻止写入。'),
    65: ('已实现', 'kh_share（≤20 条记录）', '[]',
         '设置 · 二维码 / 短链分享 › 地址输入 + 生成 + 扫码/复制 + 历史记录',
         'share-make / share-qr / share-copy ／ kh-qr.js 本地编码 + POST /api/share、GET /s/<code>',
         'DONE',
         '本地二维码编码器（版本 1–10 / 纠错 M / UTF-8 字节模式 / 8 掩码择优），无第三方依赖；'
         '短码 7 位、TTL 180 天、容量 500；只收公网 http(s) 或 # 应用内路由，拦内网与本地地址；'
         '建短链失败自动退回原链接，并说明是哪种情况；只做扫码 / 复制，不跳系统浏览器。'),
    66: ('已实现', 'kh_sync_on / kh_dev_id / kh_sync_meta', '1 / 随机设备号 / {}',
         '设置 · 远端配置与云端 › 云同步开关 + 推送 / 拉取 + 结果行 #rOut',
         'r-toggle / r-push / r-pull ／ KHREMOTE.syncPush + syncPull',
         'DONE',
         '只收 kh_ 前缀设置键；禁用词（url/site/src/link/addr/host/exe/path/dir/file/args/token/pass/pwd/pin/'
         'secret/key 等）与 http(s) 值直接拒收，对象串超 4096 字符拒收；pull 只取「不是自己那台」且最近更新的一条，'
         '不给自己的槽。无账号体系，按设备槽实现（现状已标注）。'),
    69: ('已实现', '远端 defaults（服务端 config-center.json）', '{}',
         '开发端 · /admin/config-center 四卡表单 › 默认值下发卡',
         'PUT /api/config/defaults ／ khRemoteApply → KHREMOTE.defaultsPlan',
         'DONE',
         '只补「本机没有这个键」的情况；本机有值（含显式 0、空串）一律不动；远端 rev 比本机旧时整份视图不覆盖。'),
    70: ('已实现', '远端 flags + kh_dev_id 分桶', '{}',
         '开发端 · /admin/config-center › 灰度卡；客户端在远端面板显示灰度数',
         'PUT /api/config/flags ／ KHREMOTE.flagOn（离线同算法求值）',
         'DONE',
         'FNV-1a 哈希 device|id 取模 100 分桶，版本区间按 10000/100/1 加权比较；同一设备同一开关结果稳定，'
         '离线也能算，不依赖中枢可达。'),
    71: ('已实现', 'kh_remote_locks', '[]',
         '开发端 · /admin/config-center › 锁定卡；客户端控件置灰 + 🔒 标记',
         'PUT /api/config/locks ／ KHREMOTE.lockHit + khRemoteLockPaint',
         'DONE',
         '锁定按「键名 + 原因」下发，界面置灰并带 🔒，但不阻止写入（避免锁死用户自己的机器），面板有说明。'),
    72: ('已实现', 'kh_store_seal（封条）+ userData 配置文件', '{}',
         '客户端 · 所有设置写入 ；主进程 userData/kh-b8.json、userData/kh-net.json',
         'getStore / setStore 封条校验 ／ b8Write + kh:b8-set、kh:b8-net-set',
         'DONE',
         '渲染进程 localStorage 打封条、损坏回退并记 kh_store_damaged（≤20）；需要主进程参与的两类设置'
         '（高级与本地能力、网络族）落 userData 配置文件，跨窗口 / 重启都一致；写入后广播 kh:b8-changed 让其它窗口跟上。'),
    75: ('已实现', 'kh-b8-changed 广播（无新增存储键）', '—',
         '客户端 · 同时开两个窗口时改高级设置，另一窗立即跟上',
         'b8Broadcast() + preload khB8.onChanged + kh-core khB8Watch()',
         'DONE',
         'b8Write 末尾向所有窗口广播；收到的一方写回本机存储并重绘，不回推（避免两窗口互相触发死循环）；'
         'HAP 端为单窗口，走同一份 localStorage，天然一致。'),
    77: ('已实现', '远端 notice（含起止时间 / 优先级）', '{}',
         '客户端 · 顶部公告条 #khNoticeBar（可「不再提示」，链接只提供复制）',
         'PUT /api/config/notice ／ khRemotePaint + kh_remote_notice / kh_remote_closed',
         'DONE',
         '公告带起止时间与优先级，过期不显示；同一条只显示一次，点「不再提示」记入 kh_remote_closed（≤50）；'
         '公告里的链接只做「复制链接」，不跳系统浏览器（沿用既有否决项）。'),
    78: ('已实现', 'kh_theme_packs / kh_theme_pack', '[] / 空',
         '设置 · 皮肤包（外部主题）› 应用 / 删除 / 粘贴导入 / 从地址下载 / 打开主题目录 / 回内置配色',
         'theme-apply / theme-del / theme-paste / theme-url / theme-dir / theme-sample / theme-clear ／ kh-theme.js',
         'DONE',
         '只认 8 个白名单 CSS 变量，值只接受 #hex / rgb()，禁 url() / expression() / var() / 分号拼接；'
         '上限 8 包；内置 built-neon / built-jade / built-ember 三个样例；注入到 #khThemePackStyle，随时回内置。'),
}

wb = openpyxl.load_workbook(SRC)
ws = wb['可配置项清单']

changed = []
for r in range(2, ws.max_row + 1):
    no = ws.cell(r, 1).value
    if no in UPD:
        vals = UPD[no]
        ws.cell(r, 4).value = vals[0]
        ws.cell(r, 5).value = vals[1]
        ws.cell(r, 6).value = vals[2]
        ws.cell(r, 11).value = vals[3]
        ws.cell(r, 12).value = vals[4]
        ws.cell(r, 13).value = vals[5]
        ws.cell(r, 14).value = vals[6]
        changed.append(no)

ws.cell(1, 14).value = '判定依据与代码位置（1.7.86 全量实查 + 1.7.87 / 1.7.92 / 1.7.93 / 1.7.94 增量）'

st = {}
for r in range(2, ws.max_row + 1):
    no = ws.cell(r, 1).value
    s = ws.cell(r, 4).value
    if no is None:
        continue
    st[s] = st.get(s, 0) + 1
total = sum(st.values())

name = 'v1.7.94 重算说明'
if name in wb.sheetnames:
    del wb[name]
sh = wb.create_sheet(name, 1)

thin = Side(style='thin', color='D0D5DD')
bd = Border(left=thin, right=thin, top=thin, bottom=thin)
hdr_fill = PatternFill('solid', fgColor='1F2937')
hdr_font = Font(bold=True, color='FFFFFF', size=10)
body = Font(size=10)

sh['A1'] = '鸿汇影 · 客户端可配置项清单 v1.7.94 重算说明'
sh['A1'].font = Font(bold=True, size=13)
sh['A2'] = ('本版把清单里剩下的 14 项一次补完：11 项「待做」+ 3 项「部分已有」全部转为「已实现」。'
            '重算口径：%d 项 · 已实现 %d / 部分已有 %d / 待做 %d。'
            % (total, st.get('已实现', 0), st.get('部分已有', 0), st.get('待做', 0)))
sh['A2'].font = body

cols = ['编号', '名称', '改动前', '改动后', '这一版落成的键 / 入口', '代码位置']
widths = [8, 30, 12, 12, 42, 70]
for i, (c, w) in enumerate(zip(cols, widths), start=1):
    cell = sh.cell(4, i, c)
    cell.font = hdr_font
    cell.fill = hdr_fill
    cell.border = bd
    cell.alignment = Alignment(vertical='center', horizontal='center', wrap_text=True)
    sh.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w

before = {37: '待做', 58: '待做', 59: '待做', 60: '部分已有', 63: '待做', 65: '待做', 66: '待做',
          69: '待做', 70: '部分已有', 71: '待做', 72: '部分已有', 75: '待做', 77: '待做', 78: '待做'}
names = {}
for r in range(2, ws.max_row + 1):
    no = ws.cell(r, 1).value
    if no is not None:
        names[no] = ws.cell(r, 3).value

r = 5
for no in sorted(changed):
    vals = UPD[no]
    sh.cell(r, 1, no).font = body
    sh.cell(r, 2, names.get(no, '')).font = body
    sh.cell(r, 3, before.get(no, '')).font = body
    sh.cell(r, 4, vals[0]).font = Font(size=10, bold=True, color='047857')
    sh.cell(r, 5, vals[1]).font = body
    sh.cell(r, 6, vals[6]).font = body
    for i in range(1, 7):
        sh.cell(r, i).border = bd
        sh.cell(r, i).alignment = Alignment(vertical='top', wrap_text=True)
    r += 1

r += 1
sh.cell(r, 1, '口径变化').font = Font(bold=True, size=11)
r += 1
sh.cell(r, 1, 'v1.7.93：67 已实现 / 3 部分已有 / 11 待做（共 81）').font = body
r += 1
sh.cell(r, 1, 'v1.7.94：81 已实现 / 0 部分已有 / 0 待做（共 81）').font = body
r += 2
sh.cell(r, 1, '明确不实现的边界（已写进界面文案，不算「待做」）').font = Font(bold=True, size=11)
r += 1
for line in [
    '豆瓣刮削：没有公开 API，抓网页违反其条款 → 面板明确写「不支持」，自定义模板可指向别的来源。',
    'TMDB：保留入口，但需用户自备 API Key；不填只报原因，不假装刮到。',
    '自定义 DNS：只记录 + 启动参数，不替代系统解析器（面板照实说明）。',
    '云同步：无账号体系，按「设备槽 + 最近更新」实现，不承诺跨账号。',
    'HAP 设备端版本跟进：缺 KH_KAIHONG_PWD 时恒告警，不阻断主线（1.7.94 仍为告警）。',
]:
    sh.cell(r, 1, '· ' + line).font = body
    r += 1

for col in range(1, 7):
    sh.column_dimensions[openpyxl.utils.get_column_letter(col)].width = widths[col - 1]

wb.save(DST)
print('OK ->', DST)
print('状态统计：', st, '总数', total, '本次更新', len(changed), '项')
