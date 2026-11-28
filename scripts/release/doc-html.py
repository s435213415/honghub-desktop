# -*- coding: utf-8 -*-
"""更新可配置项看板到 v1.7.94：改 14 项状态、重算 meta、追加批次"""
import json

P = r'C:\Users\admin\Desktop\鸿汇影·文档资料\鸿汇影·可配置项看板.html'
html = open(P, encoding='utf-8').read()

key = 'var DATA = '
i = html.index(key) + len(key)
data, end = json.JSONDecoder().raw_decode(html[i:])
print('旧 meta:', {k: data['meta'][k] for k in ('version', 'total', 'done', 'todo', 'review', 'partial')})


def u(ui, evt, note):
    return dict(batch='1.7.94', status='已有', stage='已实现', cov='OK', ui=ui, evt=evt, note=note)


UPD = {
 37: u('设置 · 网络族与自定义 DNS（自动 / 仅 IPv4 / 仅 IPv6 + DNS 最多 3 条）',
       'net-save ／ khNetPush → kh:b8-net-set（userData/kh-net.json）',
       'mode=ipv4 启动 appendSwitch("disable-ipv6")，下次启动生效；DNS 只记录 + 启动参数，不改系统解析器（面板照实写明）'),
 58: u('设置 · 家庭多档案（行内改名 / 切换 / 删除，当前档切换置灰）',
       'prof-add / prof-rename / prof-switch / prof-del ／ KHFAMILY.snapshot + khProf*',
       '上限 4 档；10 键快照换挡（收藏/稍后/历史/进度/片单/片单元数据/直播收藏/儿童开关/PIN/时长），不改既有键'),
 59: u('设置 · 元数据与海报来源（内置 / TMDB / 自定义模板 + 测试刮削 + 清缓存）',
       'meta-save / meta-scrape / meta-clear ／ KHMETA + poster() 接刮削',
       '模板须含 {title}；海报只认 http(s)；评分 0–10；缓存上限 50；豆瓣明确不实现（无公开 API + 条款）'),
 60: u('设置 · 字幕站（≤10，应用内打开）+ AI Key（只露后 4 位）+ 自定义接口地址',
       'sub-sites-save / ai-save / ai-clear ／ KHMETA.subSites + maskKey',
       '字幕站只收 http(s) 走应用内 WebView；Key ≥8 位、备份包不含'),
 63: u('设置 · 配置总览（38 项）：#cfgQ 搜索 + 单键改 + 单键 ↺ + 按组恢复 + 全部恢复',
       'cfg-save / cfg-one-reset / cfg-reset / cfg-reset-all / cfg-clear ／ KH_CFG_REG 38 键 7 组',
       '恢复默认写回值不删键，保封条口径；锁定项只置灰不阻断'),
 65: u('设置 · 二维码 / 短链分享（生成 / 扫码 / 复制 / 历史）',
       'share-make / share-qr / share-copy ／ kh-qr.js 本地编码 + POST /api/share、GET /s/<code>',
       '本地编码器无第三方依赖；短码 7 位 / 180 天 / 容量 500；拦内网与本地地址；失败退回原链接'),
 66: u('设置 · 远端配置与云端（云同步开关 + 推送 / 拉取 + 结果行 #rOut）',
       'r-toggle / r-push / r-pull ／ KHREMOTE.syncPush + syncPull',
       '只收 kh_ 前缀；禁用词与 http 值拒收；pull 取「不是自己且最近更新」的一条'),
 69: u('开发端 · /admin/config-center › 默认值下发卡',
       'PUT /api/config/defaults ／ khRemoteApply + KHREMOTE.defaultsPlan',
       '只补本机没有的键；有值（含显式 0 / 空串）一律不动'),
 70: u('开发端 · /admin/config-center › 灰度卡；客户端远端面板显示灰度数',
       'PUT /api/config/flags ／ KHREMOTE.flagOn（离线同算法）',
       'FNV-1a(device|id)%100 分桶，版本区间 10000/100/1 加权，同设备结果稳定'),
 71: u('开发端 · /admin/config-center › 锁定卡；客户端控件置灰 + 🔒',
       'PUT /api/config/locks ／ KHREMOTE.lockHit + khRemoteLockPaint',
       '按「键名 + 原因」下发；置灰提示但不阻止写入'),
 72: u('客户端全部设置写入；主进程 userData/kh-b8.json 与 userData/kh-net.json',
       'getStore / setStore 封条 ／ b8Write + kh:b8-set、kh:b8-net-set',
       'localStorage 打封条 + 损坏回退（kh_store_damaged ≤20）；主进程型设置落配置文件，重启一致'),
 75: u('客户端 · 双窗口同时改高级设置，另一窗立即跟上',
       'b8Broadcast() + preload khB8.onChanged + kh-core khB8Watch()',
       '写后广播 kh:b8-changed；收到写回并重绘，不回推防互相触发'),
 77: u('客户端 · 顶部公告条 #khNoticeBar（不再提示 / 链接只复制）',
       'PUT /api/config/notice ／ khRemotePaint + kh_remote_notice / kh_remote_closed',
       '带起止时间与优先级；同条只显示一次，关闭记 kh_remote_closed（≤50）'),
 78: u('设置 · 皮肤包（应用 / 删除 / 粘贴 / 地址下载 / 打开目录 / 回内置）',
       'theme-apply / theme-del / theme-paste / theme-url / theme-dir / theme-sample / theme-clear ／ kh-theme.js',
       '8 个白名单 CSS 变量；只认 #hex / rgb()；禁 url()/expression()/var()/分号；上限 8 包 + 3 内置样例'),
}

hit = 0
for r in data['rows']:
    n = int(r['no'])
    if n in UPD:
        r.update(UPD[n])
        hit += 1
print('命中行:', hit)

m = data['meta']
m['version'] = '1.7.94'
m['generated'] = '2026-11-23'
if '1.7.94' not in m['batches']:
    m['batches'].append('1.7.94')

done = sum(1 for r in data['rows'] if r.get('stage') == '已实现')
todo = sum(1 for r in data['rows'] if r.get('stage') in ('待做', '未做'))
review = sum(1 for r in data['rows'] if r.get('stage') in ('部分已有', '部分'))
m['done'], m['todo'], m['review'] = done, todo, review
m['partial'] = review
m['total'] = len(data['rows'])
print('新 meta:', {k: m[k] for k in ('version', 'total', 'done', 'todo', 'review', 'partial')})

new = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
html2 = html[:i] + new + html[end + i:]
open(P, 'w', encoding='utf-8', newline='\n').write(html2)
print('已写回，长度', len(html2))
