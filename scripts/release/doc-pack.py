# -*- coding: utf-8 -*-
"""写 1.7.94 更新日志与文档索引（哈希现算，不手抄）"""
import hashlib, os

ROOT = r'C:\Users\admin\WorkBuddy\2026-11-15-18-33-52\HongHub-Desktop'
DOC = r'C:\Users\admin\Desktop\鸿汇影·文档资料'
V = '1.7.94'
CODE = '1000208'
DEVCODE = '1000308'


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def fmt(n):
    return '{:,}'.format(n)


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
art = {k: (fmt(os.path.getsize(p)), sha(p)) for k, p in FILES.items()}

rows = '\n'.join(
    '  %-14s %-42s %14s B\n                 %s' % (k, os.path.basename(FILES[k]), art[k][0], art[k][1])
    for k in FILES)

log = '''鸿汇影 · 更新日志 v1.7.94
============================================================
应用版本：1.7.94 / {code}      开发端 HAP：{devcode}
生成时间：2026-11-23
上一版：1.7.93 / #1000207（2026-11-23 出包并验收通过）

一、本轮做了什么（清单 14 项一次补完：3 项部分已有 + 11 项待做）
------------------------------------------------------------
分四批，从服务端到客户端，最后是数据与档案这种要动存储的。

批 1 服务端远端配置中心（#69 #70 #71 #77 #66）
  server/config-center.js（新建）
    一份 server/data/config-center.json 统管五件事：公告位、锁定项、默认值下发、灰度开关、云同步。
    每次写入 rev+1，客户端按 rev 判定新旧。
    灰度：FNV-1a(device|id) % 100 分桶，版本区间按 10000/100/1 加权比较；同一设备同一开关结果稳定。
    云同步 syncPush/syncPull：只收 kh_ 前缀键；禁用词（url/site/src/link/addr/host/exe/path/dir/file/
      args/token/pass/pwd/pin/secret/key 等）与 http(s) 值直接拒收；对象串超 4096 字符拒收；
      pull 只取「不是自己那台」且最近更新的一条，不给自己的槽。
  server/server.js：7 条 config/sync 路由 + /admin/config-center 页与导航「🎛 远端配置」。
  server/config-center-admin.html（新建）：暗色四卡表单，改完即生效。

批 2 客户端远端配置 + 跨进程一致（#72 #75）
  app/kh-remote.js（新建，UMD）
    远端视图容错归一、公告有效期判定、锁定命中、离线灰度求值（与服务端同算法，中枢不可达也能算）。
  app/kh-core.js 远端块
    拉取 / 应用 / 顶部公告条 #khNoticeBar / 锁定置灰 🔒 / 存储载体信息 / 云同步推拉；
    远端 rev 比本机旧时整份不覆盖；启动 8 秒后拉一次，之后每 6 小时轮询；失败保持本机缓存、不弹错。
  #75 跨进程一致
    electron-main.js 的 b8Write() 写完向所有窗口广播 kh:b8-changed；preload.js 暴露 khB8.onChanged；
    kh-core.js 的 khB8Watch() 收到后写回本机存储并重绘，不回推（否则两个窗口互相触发）。

批 3 配置总览 / 二维码 / 皮肤包（#63 #65 #78）
  #63 统一配置中心
    KH_CFG_REG 38 键分 7 组（播放 11 / 界面 10 / 通知与启动 7 / 儿童 3 / 网络 3 / 数据 2 / 远端与云端 2）；
    设置页「配置总览（38 项）」：搜索 #cfgQ、单键改、单键 ↺、按组恢复、全部恢复；
    恢复默认是「写回默认值」而不是删键，避免被判定为存储损坏。
  #65 二维码 / 短链分享
    app/kh-qr.js（新建）：本地二维码编码器（版本 1–10 / 纠错 M / UTF-8 字节模式 / 8 掩码择优），无第三方依赖。
    之前修过一处真 bug：格式信息第二副本 bit0–6 沿第 8 列自下而上（7 格）、bit7–14 沿第 8 行自右向左（8 格），
    原写法与 dark module 冲突会丢 bit7，扫码必失；已改对并有单测覆盖。
    server/shares.js（新建）：7 位短码、TTL 180 天、容量 500；只收公网 http(s) 或 # 应用内路由，拦内网 / 本地地址；
    POST /api/share 建链，GET /s/<code> 302 跳转。客户端建链失败自动退回原链接并说明原因。
  #78 皮肤包
    app/kh-theme.js（新建）：只认 8 个白名单 CSS 变量，值只接受 #hex / rgb()，
    禁 url() / expression() / var() 与分号拼接；上限 8 包；内置 built-neon / built-jade / built-ember 三个样例。

批 4 家庭档案 / 元数据 / 字幕站与 Key / 网络族（#58 #59 #60 #37）
  #58 家庭多档案
    app/kh-family.js + khProf* 十函数：最多 4 档；切档把 10 个键（收藏 / 稍后 / 历史 / 进度 / 片单 /
    片单元数据 / 直播收藏 / 儿童开关 / 儿童 PIN / 儿童时长）dump→restore 换挡；不新增不改任何既有存储键，
    旧逻辑零改动；缺键写回默认值而不是 removeItem。
    改名用行内输入框——Electron 渲染进程没有 window.prompt，这是踩出来的。
  #59 元数据与海报来源
    app/kh-meta.js（新建）：四种来源 builtin/tmdb/douban/custom；自定义模板必须含 {{title}}；海报只认 http(s)；
    评分 0–10；缓存按时间淘汰、上限 50。
    刮削结果直接进卡片：有海报优先显示，评分与简介同步以刮削为准，卡片底部标注「海报与简介来自刮削来源」。
    豆瓣刮削明确不做：没有公开 API，抓网页违反其条款，UI 文案已写明；TMDB 需用户自备 Key，不填只报原因。
  #60 字幕站与 AI Key
    字幕站只留 http(s)、上限 10，走应用内 WebView，不跳系统浏览器；
    AI Key 至少 8 位、界面只露后 4 位、备份包里不含。
  #37 网络族与自定义 DNS
    electron-main.js 落 userData/kh-net.json；mode=ipv4 时启动 appendSwitch('disable-ipv6')，下次启动生效；
    自定义 DNS 只做记录 + 启动参数，不替代系统解析器——面板文案照实说明，不做假实现。

本轮顺手修掉的两个真问题（都不是"打磨"，是功能真不工作）
  1. 九组新动作（cfg- / theme- / share- / prof- / meta- / ai- / net- / r- / sub-sites-save）只写了处理函数，
     没接进 kh-app 的点击分发链，界面上按钮点了完全没反应。现在统一并入 resAction 分发。
     这是冒烟真点探针逼出来的：探针点「清空搜索」后行数仍是 1，才顺线查到分发缺口。
  2. 启动后并入仓自带直播源的后台重绘，会在用户正填设置表单时把整个 #main 重建、抢走焦点、输入丢失。
     新增 khSafeRender()：设置页有输入控件聚焦时只标记待绘，等下一次正常重绘顺带生效。
     修完冒烟从不稳定（每次失败点漂移）变成连跑三次 21/21、错误 0。

二、验证（全部实跑，数字照抄）
------------------------------------------------------------
  node scripts\\test-pref-kit.js         63 项通过 / 0 失败
  node scripts\\test-p2-kit.js           93 项通过 / 0 失败
  node scripts\\test-b8-kit.js           88 项通过 / 0 失败
  node scripts\\test-config-center.js    57 项通过 / 0 失败   （新增）
  node scripts\\test-remote-kit.js       65 项通过 / 0 失败   （新增）
  node scripts\\test-qr-kit.js           41 项通过 / 0 失败   （新增）
  node scripts\\test-theme-kit.js        48 项通过 / 0 失败   （新增）
  node scripts\\test-cfg-kit.js          31 项通过 / 0 失败   （新增）
  node scripts\\test-share-kit.js        38 项通过 / 0 失败   （新增）
  node scripts\\test-family-meta-kit.js  66 项通过 / 0 失败   （新增）
  合计 590 项 0 失败

  node scripts\\smoke-ui.js  面板真点 21/21 · 错误 0 · 控件 176(data-act) · 正文 4288 字 · msedge 真浏览器
                            连跑三次全绿（新增「1.7.94 六个新面板真点生效」一条，覆盖搜索清空 / 皮肤包应用回退 /
                            档案新建切回删除 / 网络族落盘 / 分享出二维码）

  node scripts\\version.js --check   真相源 v1.7.94 / #{code} · 16 处一致

  门禁（在 1.7.94 产物上跑）：
  check-static.js         138 项 / 失败 0
  check-client-purity.js  违规 0（1.7.94 zip 101 / 92 条目，无运维面板与凭证残留）
  check-artifacts.js      16 项通过 / 0 警告 / 0 失败（含 v1.7.94 发布目录与 dist 一致）
  verify-release.js       oneclick 8/8 末段「交付验收全部通过」（含更新比对 #1000207 → #1000208 不误报）
  check-config-coverage.js  覆盖率 97%，2 项为检查器口径问题（KH_CFG_REG 与 KH_UPDATE_DOWNLOAD_URL 实际都在代码里，
                            前者在 app/kh-core.js、后者在 server/server.js，检查器未命中这两个符号的扫描集合）

三、1.7.94 产物与哈希（八件，桌面交付夹与 dist 同源）
------------------------------------------------------------
{rows}

四、出包流水线的真话
------------------------------------------------------------
  1. 手工 build-client-exe.js 双架构先跑（x64 110,345,085 B / arm64 108,503,785 B），
     再 oneclick-release.js --skip-hap → 11 步成功 / 1 步告警。
  2. 那 1 步是 8.2「开鸿设备端版本跟进」：材料齐全但拿不到 KH_KAIHONG_PWD、hdc 无设备，
     按既定口径记为告警、不阻断主线（设备端 HAP 仍停在 v1.7.87）。
  3. oneclick 内部会重打桌面包与 HAP，所以最终尺寸比手工包大（Setup +44,702 B、zip +45,817 B），
     客户 HAP 也从手工签的 2,402,506 B（sha d7a4e0cc…）变成同名同尺寸但不同内容（sha 04801a4e…）。
     这不是异常，是流水线二次封装；release.json 的 hap size/sha 已被流水线同步（本轮核对一致）。
  4. 认包一律以 sha256 为准，不要拿文件大小当指纹。

五、清单口径（81 项）
------------------------------------------------------------
  1.7.93 口径：已实现 67 / 部分已有 3 / 待做 11
  1.7.94 口径：已实现 81 / 部分已有 0 / 待做 0
    · 本轮转已实现（14）：#37 #58 #59 #60 #63 #65 #66 #69 #70 #71 #72 #75 #77 #78
  详见 鸿汇影·客户端可配置项清单_v1.7.94.xlsx（12 张表，第 2 张「v1.7.94 重算说明」列 14 项前后对照）
  与 鸿汇影·可配置项看板.html（同源 81 项，meta 1.7.94 / 81 / 0 / 0）。
  另：scripts/config-items.json 已按清单重建为 81 项全「已有」，check-config-coverage 不再报「清单标空白」note。

六、遗留与阻塞（如实登记，没藏）
------------------------------------------------------------
  · 8.2 开鸿设备端：缺 KH_KAIHONG_PWD + 无 hdc 设备，设备端 HAP 仍停在 v1.7.87，属外部条件。
  · Windows 安装包未做商业 CA 签名（未配 WIN_CSC_FILE），SmartScreen 仍提示未知发布者。
  · 公网站点 exe / hap / bin 仍 404（manifest 与 index 200），需宿主在面板手点发布。
  · check-panels.js 6 通过 / 6 失败（/admin 运维页缺区块）与 check-feature-wiring.js 两端不同步，
    都是既有失败，不在本链路，未反复重试。
  · 豆瓣刮削不实现（无公开 API + 条款）；TMDB 需用户自备 Key；自定义 DNS 不替代系统解析器；
    云同步无账号体系（按设备槽）。这四条都写进了界面文案，属明确边界，不列为待做。
  · #59 的 douban 来源在 UI 里保留为「不支持」说明项，点它会给出原因，不会静默失败。

七、下一步（清单已清空，转为维护与观察）
------------------------------------------------------------
  1. 观察项：远端配置中心上线后，先让公告与默认值在真机跑一轮，确认 rev 递增与公告有效期判定符合预期。
  2. 待外部条件：KH_KAIHONG_PWD 与 hdc 到位后重出设备端 HAP；WIN_CSC_FILE 配好后签 Windows 包。
  3. 可选打磨：check-panels 的 /admin 区块补齐、HAP 端配置总览的触屏适配（当前按桌面宽度排版）。
'''

log = log.format(code=CODE, devcode=DEVCODE, rows=rows)

with open(os.path.join(DOC, '鸿汇影·更新日志_v%s.txt' % V), 'w', encoding='utf-8', newline='\r\n') as f:
    f.write(log)

idx = '''

鸿汇影 · 文档索引 v1.7.94
============================================================
应用版本 1.7.94 / {code} · 开发端 {devcode} · 生成 2026-11-23
先读这份，按需要再点开对应文件。所有文件均在 桌面\\鸿汇影·文档资料\\。

一、本版必读（三件）
------------------------------------------------------------
1. 鸿汇影·更新日志_v1.7.94.txt
   14 项做了什么（分四批）、实跑验证数字（590 项单测 + 冒烟 21/21）、八件产物哈希、
   流水线真话（11 成功 / 1 告警 + HAP sha 变化）、清单口径 67/3/11 → 81/0/0、遗留与下一步。
2. 鸿汇影·客户端可配置项清单_v1.7.94.xlsx
   81 项全量台账，12 张表。第 2 张「v1.7.94 重算说明」只列本轮 14 项的前后对照与代码位置。
   列位：A 编号 · B 分组 · D 现状 · E 存储键 · F 默认值 · K 界面落点 · L 事件名/实现函数 · M 覆盖度 · N 判定依据。
3. 鸿汇影·文件导航.txt
   桌面根、交付夹、文档夹、仓库脚本的逐件说明，含字节数与哈希前缀，认包先看它。

二、清单与看板（同源同口径）
------------------------------------------------------------
  鸿汇影·客户端可配置项清单_v1.7.94.xlsx   81 项：已实现 81 / 部分已有 0 / 待做 0
  鸿汇影·可配置项看板.html                 同源看板，meta 1.7.94 / 67→81 / 11→0 / 3→0，浏览器双击即开
  鸿汇影·客户端可配置项清单_v1.7.93 / _v1.7.92 / _v1.7.90 / _v1.7.89 / _v1.7.88 / _v1.7.87 / _v1.7.86 / _v1.7.79.xlsx   旧清单留档

三、更新日志（按版本留档）
------------------------------------------------------------
  最新：鸿汇影·更新日志_v1.7.94.txt
  历史：_v1.7.93（#54 关闭行为 + #32 字幕位置）· _v1.7.92（覆盖 1.7.91 + 1.7.92 两轮）·
        _v1.7.90 · _v1.7.89 · _v1.7.88 · _v1.7.87 · _v1.7.86 · _v1.7.85
  说明：1.7.91 未单独出日志，已并入 1.7.92 文件。

四、改码与发版指引（两件，改代码前必看）
------------------------------------------------------------
  鸿汇影·开发端文件更新说明.txt   改哪类代码要同步哪些文件、过哪些门禁、哪些步骤不能跳（已补 1.7.94 段）
  鸿汇影·上传发布操作手册.txt     发布 / 上传 / 站点刷新步骤（顶部自动块随发版更新）

五、排期与其他
------------------------------------------------------------
  开发端开发排期.txt / 开发端开发排期_v1.7.68 / _v1.7.69 / _v1.7.70.txt
  客户端开发排期.txt / 客户端开发排期_v1.7.67 / _v1.7.68 / _v1.7.69 / _v1.7.70.txt
  鸿汇影·文档索引_v1.7.93 及更早各版           旧索引留档

六、快速查表（本轮 14 项一览）
------------------------------------------------------------
  #69 #70 #71 #77 #66  远端配置中心五件事：公告 / 灰度 / 锁定 / 默认值 / 云同步
                       服务端 server/config-center.js + /admin/config-center；客户端 kh-remote.js
  #72 存储载体          localStorage 封条 + userData/kh-b8.json + userData/kh-net.json 三类载体分工
  #75 跨进程一致        kh:b8-changed 广播 + khB8.onChanged + khB8Watch()（不回推）
  #63 统一配置中心      KH_CFG_REG 38 键 7 组，设置页「配置总览」搜索 / 单键 / 按组恢复
  #65 二维码分享        app/kh-qr.js 本地编码 + server/shares.js 短链（7 位 / 180 天 / 拦内网）
  #78 皮肤包            app/kh-theme.js，8 个白名单变量 + 值域校验 + 3 个内置样例
  #58 家庭多档案        app/kh-family.js，4 档上限，10 键快照换挡，不动既有存储键
  #59 元数据来源        app/kh-meta.js，内置 / TMDB / 自定义；豆瓣明确不实现
  #60 字幕站与 AI Key   上限 10 站走应用内 WebView；Key ≥8 位只露后 4 位
  #37 网络族与 DNS      IPv4-only 走启动开关；DNS 只记录 + 重启生效，不改系统解析器
'''

idx = idx.format(code=CODE, devcode=DEVCODE)
with open(os.path.join(DOC, '鸿汇影·文档索引_v%s.txt' % V), 'w', encoding='utf-8', newline='\r\n') as f:
    f.write(idx.lstrip('\n'))

print('OK: 更新日志 / 文档索引')
print(rows)
