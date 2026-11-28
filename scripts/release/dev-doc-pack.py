# -*- coding: utf-8 -*-
"""开发端文件更新说明：插入真实的 1.7.94 增量段，把原「本版增量 v1.7.94」改回 v1.7.93"""
P = r'C:\Users\admin\Desktop\鸿汇影·文档资料\鸿汇影·开发端文件更新说明.txt'
old = open(P, encoding='utf-8').read()

old_head = '本版增量（v1.7.94 / #1000208，2026-11-23 · #54 关闭行为 + #32 字幕上下位置）'
assert old_head in old, '找不到原段标题'

new_sec = '''本版增量（v1.7.94 / #1000208，2026-11-23 · 清单 14 项一次补完：3 部分已有 + 11 待做 → 81/0/0）
  新增存储键（12 个，全部走 getStore/setStore，打封条）
    kh_remote（远端视图缓存）/ kh_remote_locks / kh_remote_closed（≤50）/ kh_remote_notice（默认 1）
    kh_sync_on（默认 1）/ kh_dev_id（随机设备号）/ kh_sync_meta
    kh_theme_packs（≤8）/ kh_theme_pack（当前包 id）
    kh_share（≤20 条分享记录）
    kh_profiles（≤4 档）/ kh_profile_cur / kh_profiles_data
    kh_meta_src / kh_meta_custom / kh_meta_cache（≤50）/ kh_tmdb_key
    kh_sub_src（≤10）/ kh_ai_key / kh_ai_base
    kh_net_family / kh_dns
  服务端新增文件与数据
    server/config-center.js（新建）：公告 / 锁定 / 默认值 / 灰度 / 云同步五件事，config-center.json 落盘，每次写入 rev++；
      灰度 FNV-1a(device|id)%100 分桶，版本区间 10000/100/1 加权比较；
      syncPush/syncPull 只收 kh_ 前缀键；禁用词（url/site/src/link/addr/host/exe/path/dir/file/args/token/pass/pwd/pin/secret/key 等）
      与 http(s) 值拒收；对象串 >4096 字符拒收；pull 只取「不是自己那台」且最近更新的一条。
    server/config-center-admin.html（新建）：暗色四卡表单（公告 / 锁定 / 默认值 / 灰度 + 云同步）。
    server/shares.js（新建）：7 位短码、TTL 180 天、CAP 500；只收公网 http(s) 或 # 应用内路由，拦内网 / 本地地址。
    server/server.js：require cfgCenter + shares；escapeHtml()；7 条 config/sync 路由；4 条 share 路由（POST /api/share、
      GET /s/<code> 302）；/admin/config-center 页与 ADMIN_NAV「🎛 远端配置」。
  客户端新增文件
    app/kh-remote.js（UMD，window.KHREMOTE）：视图归一 / 公告有效期 / 锁定命中 / 离线灰度求值（与服务端同算法）。
    app/kh-qr.js：本地二维码编码器（版本 1–10、纠错 M、UTF-8 字节模式、8 掩码择优），无第三方依赖。
      关键修复：格式信息第二副本 bit0–6 沿第 8 列自下而上（7 格）、bit7–14 沿第 8 行自右向左（8 格），
      原写法与 dark module 冲突会丢 bit7，扫码必失；已改对并有单测。
    app/kh-theme.js：皮肤包，8 个白名单 CSS 变量，值只接受 #hex / rgb()，禁 url()/expression()/var()/分号拼接；上限 8 包，
      内置 built-neon / built-jade / built-ember。
    app/kh-family.js：家庭多档案纯逻辑（normList / normCurrent / snapshot），上限 4 档。
    app/kh-meta.js：元数据来源与服务校验（模板含 {title}、海报 http(s)、评分 0–10、缓存 50、字幕站 10、AI Key ≥8 位及掩码、
      IPv4/域名两套 DNS 校验、netNote 文案）。
  改动文件
    app/kh-core.js
      远端块（khRemoteView/Apply/Load/Paint/LockPaint、公告条 #khNoticeBar、锁定置灰、云同步推拉、存储载体信息）
      KH_CFG_REG 38 键 7 组 + khCfgRows / khCfgGroups / khCfgVal / 单键与分组恢复
      KH_PROF_DEF + khProf* 十函数（List/Cur/Data/Save/Dump/Switch/Add/Rename/Del）
      khTheme* / khShare* / khMeta* / khNetPush 等函数
      六个新面板（配置总览 / 皮肤包 / 二维码分享 / 家庭多档案 / 元数据与海报来源 / 字幕站与 AI Key / 网络族与 DNS）
      poster() 接入刮削结果（海报优先、评分与简介以刮削为准、卡片标注来源、posterCache key 追加海报 URL 尾 12 字符）
      khSafeRender()（新增）：设置页有输入控件聚焦时只标记待绘，等下一次正常重绘顺带生效
      render() 尾部 hook khRemotePaint / khRemoteLockPaint
    app/kh-admin.js
      新增 31 个动作：r-pull / r-push / r-save / r-refresh / r-notice-link / r-notice-off、
      cfg-save / cfg-one-reset / cfg-reset / cfg-reset-all / cfg-clear、
      theme-apply / theme-del / theme-paste / theme-url / theme-dir / theme-sample / theme-clear、
      share-make / share-qr / share-copy、prof-add / prof-rename / prof-switch / prof-del、
      meta-save / meta-scrape / meta-clear、sub-sites-save、ai-save / ai-clear、net-save
    app/kh-app.js
      khB8Watch()（订阅 kh:b8-changed，写回 + 重绘，不回推）
      khRemoteLoad 启动 8 秒后拉一次 + 每 6 小时轮询；khThemePaint()；khNetPush()
      cfgQ 搜索防抖 220ms（重绘后回填焦点与光标位置）
      启动后台刷新改用 khSafeRender()
      点击分发新增九组前缀（cfg- / theme- / share- / prof- / meta- / ai- / net- / r- / sub-sites-save）→ resAction
    app/index.html：引入 5 个新 js（kh-remote / kh-qr / kh-theme / kh-family / kh-meta）
    electron-main.js：b8Write 末尾 b8Broadcast() 广播 kh:b8-changed；kh:b8-themes；NET_FILE=userData/kh-net.json；
      mode==='ipv4' 时 appendSwitch('disable-ipv6')；kh:b8-net-get / set
    preload.js：khB8.onChanged / themes / netGet / netSet

  本轮修掉的两个真问题（都必须记住，别再犯）
    1) 九组新动作只写了处理函数、没接点击分发 → 界面上按钮点了没反应。冒烟真点探针逼出来的：
       「清空搜索」后行数仍是 1，顺线查到 kh-app 的 if/else 链缺前缀分支。修法：统一并入 resAction。
    2) 启动后并入仓自带直播源的后台重绘会在用户填设置表单时重建 #main、抢焦点、输入丢失。
       修法：新增 khSafeRender()；冒烟从「每次失败点漂移」变成连跑三次 21/21、错误 0。

  自测（全绿才出包，合计 590 项）
    test-pref-kit 63 / test-p2-kit 93 / test-b8-kit 88（回归）
    test-config-center 57 / test-remote-kit 65 / test-qr-kit 41 / test-theme-kit 48 /
    test-cfg-kit 31 / test-share-kit 38 / test-family-meta-kit 66（本轮新增 7 套）
    smoke-ui 21 探针 / 176 个 data-act 控件真点 / 错误 0（新增「1.7.94 六个新面板真点生效」）

  出包链（顺序不能乱）
    1. node scripts\\version.js --bump                 → v1.7.94 / #1000208，16 处对齐
    2. python harmony\\build_hap.py                    → HAP 前端（新增 js 靠 index.html 引入即可进包）
    3. KH_HAP_ALLOW_STALE=1 node scripts\\hap-sign.js  → 客户 HAP（仅改前端，ets 未改才允许跳过新鲜度）
       KH_HAP_ALLOW_STALE=1 KH_HAP_VARIANT=dev node scripts\\hap-sign.js → 开发端 HAP
    4. node %TEMP%\\kh_rel_hap_sync.js                → 同步 release.json 的 hap size/sha
    5. node scripts\\build-client-exe.js（arm64 加 KH_CLIENT_ARCH=arm64）
    6. node scripts\\oneclick-release.js --skip-hap    → 11 成功 / 1 告警（8.2 缺 KH_KAIHONG_PWD，不阻断）
    7. 四道门禁：check-static 138/0 · check-client-purity 违规 0 · check-artifacts 16/0/0 · verify-release 全通过
  本次流水线的实测差异（认包须知）
    手工 x64 Setup 110,345,085 B → oneclick 二次封装后 110,389,787 B（+44,702 B）；
    手工客户 HAP sha d7a4e0cc… → oneclick 内重建后 04801a4e…（同尺寸 2,402,506 B）；
    出现这种差异必须重跑 release.json 同步，否则下一轮 0/8 会 SHA 不一致 ERR。以 sha256 认包，别看大小。

'''

old = old.replace(old_head, new_sec + '上一版增量（v1.7.93 / #1000207，2026-11-23 · #54 关闭行为 + #32 字幕上下位置）', 1)
open(P, 'w', encoding='utf-8', newline='\r\n').write(old)
print('OK 开发端文件更新说明已补 1.7.94 段，总字节', len(old.encode('utf-8')))
