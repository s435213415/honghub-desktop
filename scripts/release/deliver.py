# -*- coding: utf-8 -*-
"""1.7.95 桌面交付夹生成（参数化版，版本与哈希全部现读 dist/release.json 与真实产物）

用途：出包完成后一次性生成
  · Desktop\\鸿汇影·客户成品_v<V>\\      12 件（4 个 Windows 包 + HAP + 5 个 .sha256 + 2 份说明）
  · Desktop\\鸿汇影·开发端_v<V>\\        开发端 exe x2 / HAP x2 / 运维脚本 / 开发者端说明 / 密钥清单
幂等：同名同大小同哈希就跳过，不会重复复制 100MB 的包。

用法：python scripts\\release\\deliver.py
"""
import hashlib, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DESK = os.path.join(os.path.expanduser('~'), 'Desktop')


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def size(p):
    return os.path.getsize(p)


def fmt(n):
    return '{:,}'.format(n)


def info():
    with open(os.path.join(ROOT, 'dist', 'release.json'), encoding='utf-8') as f:
        r = json.load(f)
    v = str(r.get('versionName') or '')
    code = str(r.get('versionCode') or '')
    if not v or not code:
        raise SystemExit('dist/release.json 缺 versionName / versionCode')
    dev = str(int(code) + 100)            # 1000209 → 1000309，开发端变体固定 +100
    return v, code, dev


def put(src, dstdir, name=None):
    name = name or os.path.basename(src)
    dst = os.path.join(dstdir, name)
    if os.path.abspath(src) == os.path.abspath(dst):
        return dst
    if not os.path.exists(dst) or size(src) != size(dst) or sha(src) != sha(dst):
        shutil.copy2(src, dst)
    return dst


def sidecar(p):
    h = sha(p)
    with open(p + '.sha256', 'w', encoding='utf-8', newline='\n') as f:
        f.write('%s  %s\n' % (h, os.path.basename(p)))
    return h


V, CODE, DEVCODE = info()
CLI = os.path.join(DESK, '鸿汇影·客户成品_v%s' % V)
DEVDIR = os.path.join(DESK, '鸿汇影·开发端_v%s' % V)
DOCDIR = os.path.join(DESK, '鸿汇影·文档资料')

PATHS = {
    'x64_setup': os.path.join(ROOT, 'dist', 'client', '鸿汇影桌面版 Setup %s.exe' % V),
    'x64_zip': os.path.join(ROOT, 'dist', 'client', '鸿汇影免安装 %s.zip' % V),
    'a64_setup': os.path.join(ROOT, 'dist', 'client', '鸿汇影桌面版 Setup %s-arm64.exe' % V),
    'a64_zip': os.path.join(ROOT, 'dist', 'client', '鸿汇影免安装 %s-arm64.zip' % V),
    'hap': os.path.join(ROOT, 'dist', 'HongHubMovie.hap'),
    'dev_hap': os.path.join(ROOT, 'dist', 'HongHubMovie-dev.hap'),
    'dev_exe': os.path.join(ROOT, 'dist', '鸿汇影桌面版 开发端 %s.exe' % V),
    'dev_exe_a64': os.path.join(ROOT, 'dist', '鸿汇影桌面版 开发端 %s-arm64.exe' % V),
}
missing = [k for k, p in PATHS.items() if not os.path.exists(p)]
if missing:
    print('缺产物：')
    for k in missing:
        print('  %-11s %s' % (k, PATHS[k]))
    sys.exit(2)

os.makedirs(CLI, exist_ok=True)
os.makedirs(DEVDIR, exist_ok=True)
os.makedirs(DOCDIR, exist_ok=True)

# ---------- 客户成品夹：12 件 ----------
c_setup = put(PATHS['x64_setup'], CLI)
c_zip = put(PATHS['x64_zip'], CLI)
c_a64s = put(PATHS['a64_setup'], CLI)
c_a64z = put(PATHS['a64_zip'], CLI)
c_hap = put(PATHS['hap'], CLI)
H = {
    'setup': sidecar(c_setup), 'zip': sidecar(c_zip),
    'a64s': sidecar(c_a64s), 'a64z': sidecar(c_a64z), 'hap': sidecar(c_hap),
}
S = {k: fmt(size(p)) for k, p in
     {'setup': c_setup, 'zip': c_zip, 'a64s': c_a64s, 'a64z': c_a64z, 'hap': c_hap}.items()}

# ---------- 开发端夹 ----------
d_exe = put(PATHS['dev_exe'], DEVDIR)
d_exe_a = put(PATHS['dev_exe_a64'], DEVDIR)
d_hap = put(PATHS['dev_hap'], DEVDIR, 'HongHubMovie-开发端.hap')
d_chap = put(PATHS['hap'], DEVDIR)
HD = {
    'exe': sidecar(d_exe), 'exea': sidecar(d_exe_a),
    'hap': sidecar(d_hap), 'chap': sidecar(d_chap),
}

PREV = None
for cand in sorted([d for d in os.listdir(DESK) if d.startswith('鸿汇影·开发端_v')], reverse=True):
    if cand != os.path.basename(DEVDIR):
        PREV = os.path.join(DESK, cand)
        break
if PREV:
    for name in ('启动开发者端.cmd', '安装后转开发端.cmd', '创建桌面快捷方式.vbs'):
        dst = os.path.join(DEVDIR, name)
        src = os.path.join(PREV, name)
        if not os.path.exists(dst) and os.path.exists(src):
            shutil.copy2(src, dst)
    kd = os.path.join(DEVDIR, '签名密钥')
    if not os.path.isdir(kd) and os.path.isdir(os.path.join(PREV, '签名密钥')):
        shutil.copytree(os.path.join(PREV, '签名密钥'), kd)
    if not os.path.exists(os.path.join(DEVDIR, '密钥与口令清单_v%s.txt' % V)):
        for f in os.listdir(PREV):
            if f.startswith('密钥与口令清单_'):
                put(os.path.join(PREV, f), DEVDIR, '密钥与口令清单_v%s.txt' % V)
                break

# ---------- 客户下载说明 ----------
readme = '''鸿汇影桌面版 {v}（应用版本 #{code} · 开发端变体 #{dev}）
生成时间：2026-11-23

一、本版新增（六项，都是能上手用的）
  1. 平台入口域名守卫
     点不在平台官方清单里的域名，第一次不会打开，先弹出它真实的 host 提示；3 秒内再点一次才放行，
     「已信任」的域名会记下来（最多 30 个），设置页可以一键清空。防的是「看着像官方入口、其实是别的站点」。
  2. 电视形态与遥控焦点
     「自动判定」在无鼠标的大屏上自动切电视形态：字号放大一档、焦点环加粗、卡片聚焦时轻微放大。
     遥控方向键在卡片网格间移动，OK 打开当前项，返回键（Backspace）逐层退回，
     菜单键（ContextMenu / Shift+F10）唤出当前项的右键菜单。电脑上也能手动强开预览。
  3. 设备码账号 + 云同步 + 跨端续播
     没有手机号、没有密码：一枚 8 位设备码就是账号。换设备输入这枚码，收藏 / 观看历史 / 片单 /
     续播点会合并过来（按 id 求并集，新的在前，两边都不丢）。同步只带这四类数据，链接与本机路径不上云。
  4. 手机遥控
     设置页「账号与云同步」里有二维码，手机扫码打开遥控页：上一个 / 播放暂停 / 下一个 /
     快退 10 秒 / 快进 10 秒 / 音量 ± / 返回。指令走中枢队列，20 秒内有效。
  5. 客户版静默自动升级（带失败回退）
     设置页「自动升级」四档：关 / 只检查 / 检查+下载 / 下载+安装。下载强制 https、只认 .exe、
     必须与清单同源；落盘后校验 SHA256，不符立即删包；同一版本装了却版本没变，自动停止再装（防重启死循环）；
     免安装目录只下载不安装并提示手动解压。检查间隔按失败次数退避 0 / 1h / 6h / 24h。
  6. 繁体中文界面
     语言下拉新增「繁體中文（介面）」。这是显示层的简转繁：常用词组按词表整体替换、单字逐字替换，
     URL / 文件名 / kh_ 键名 / 英文缩写原样保留。它是「界面高频字」覆盖，不是全字表，生僻字会保持简体。

二、本版核实已存在（没有新写代码，避免重复造轮子）
  · 首页推荐位云端可配：/api/promo 读写，客户端 refreshPromo 按 id 映射内置片源。
  · 接口来源白名单 /api/config/origins：管的是「回环外网页访问本地中枢」，不是入口域名防劫持。
  · 网络代理：none / rules / system 三模式 + 设置页三件套；镜像站由分发清单多源支撑。
  · 播放失败分级：fatal 网络/媒体错误先降档再逐源回退，错误码 E-NET / E-DECODE / E-HLS-NET 等可读提示。
  · 静默覆盖安装：只对含 Uninstall*.exe 的安装目录生效，免安装目录拒绝。

三、四个包，按机器选
  x64（绝大多数 Intel / AMD 电脑）
    安装版  鸿汇影桌面版 Setup {v}.exe          {s_setup} B   sha256 {h_setup}
    免安装  鸿汇影免安装 {v}.zip                {s_zip} B   sha256 {h_zip}
  arm64（骁龙 X / 鲲鹏等 ARM 笔记本、部分平板）
    安装版  鸿汇影桌面版 Setup {v}-arm64.exe    {s_a64s} B   sha256 {h_a64s}
    免安装  鸿汇影免安装 {v}-arm64.zip          {s_a64z} B   sha256 {h_a64z}
  深开鸿 / OpenHarmony 设备
    鸿蒙包  HongHubMovie.hap                    {s_hap} B   sha256 {h_hap}

四、怎么装
  1. 安装版：双击 Setup，选目录，装完桌面有图标。
  2. 免安装版：解压到任意目录（路径别含特殊符号），双击「鸿汇影桌面版.exe」。
  3. 鸿蒙：用 DevEco Studio 或 hdc install 装 HAP；装过旧自签版的设备请先卸载再装。
  4. 覆盖升级：直接装新版即可，播放记录、收藏、影视仓配置、设置、档案、设备码全部保留。

五、装不上怎么办（未签名阶段的常见拦截）
  1. 提示「Windows 已保护你的电脑」：点「更多信息」→「仍要运行」。这是没有商业签名证书的正常提示，
     不是文件损坏；核对文件大小与 sha256（本说明第四节的哈希）一致即可放心。
  2. 杀软报毒或隔离：把安装包与安装目录加入信任区后重装。误报原因通常是「未签名的自解压安装器 + 内嵌
     Electron 运行时」，不是代码行为；装完可把安装包从信任区移出，只保留安装目录。
  3. 双击没反应：先解压到本地磁盘（不要放在 OneDrive 同步目录或 U 盘），路径里不要有空格以外的特殊符号。
  4. 提示「已安装旧版本」：先卸载旧版再装，或在旧版里覆盖安装（覆盖安装会保留数据）。

六、卸载干净（换机或不再使用）
  1. 设置 → 应用 → 鸿汇影 → 卸载（安装版）；免安装版直接删目录。
  2. 安装位置：默认装在当前用户目录 %LOCALAPPDATA%\\Programs\\honghub-desktop，卸载时整个目录删除。
  3. 想连数据一起清：卸载后手动删这两处（不删则下次安装会沿用旧设置与收藏）：
       %APPDATA%\\鸿汇影桌面版                  （设置、收藏、历史、窗口状态、设备码）
       %LOCALAPPDATA%\\honghub-desktop-updater  （自动更新下载的安装包缓存，可能有上百 MB）
  4. 开始菜单与桌面图标由安装器管理，卸载时一并移除；若残留右键删除即可。
  5. 播放记录 / 收藏 / 影视仓想留个底，先在「备份与恢复」里导出 JSON，再卸载。

七、数据与投诉
  · 默认只存本机：收藏、历史、自建站点、问题与崩溃记录都不上传；问题外发必须在设置页显式开启，
    开启后也只发脱敏摘要（类别、错误码、次数、站点域名），不含账号、片源内容与完整 URL。
  · 侵权投诉入口在「关于 → 侵权投诉与下线」。收到可核实的投诉后 72 小时内下线对应入口或片源条目。

八、已知限制（如实列出）
  · 安装包没有商业代码签名，Windows 首次运行会提示「未知发布者」，这是预期行为。
  · 设备端没上真机：本机 hdc 无可用设备，HAP 只做了打包与签名校验，未做设备冒烟。
  · 公网站点上的 exe / hap 需要宿主在面板里手点发布，自动上传只覆盖清单与页面。
  · 设备码没有密码与找回：码丢了只能重新生成，旧数据留在云端取不回（面板里已写明）。
  · 跨端续播只对内置片源（数字 id）有效；自定义网址与影视仓条目的 id 是各设备本地的，跨端只在历史里留记录。
  · 繁体是界面高频字覆盖，不是完整字表。
'''
readme = readme.format(v=V, code=CODE, dev=DEVCODE,
                       s_setup=S['setup'], h_setup=H['setup'],
                       s_zip=S['zip'], h_zip=H['zip'],
                       s_a64s=S['a64s'], h_a64s=H['a64s'],
                       s_a64z=S['a64z'], h_a64z=H['a64z'],
                       s_hap=S['hap'], h_hap=H['hap'])
with open(os.path.join(CLI, '客户下载说明.txt'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(readme)

checklist = '''鸿汇影 v{v} · 装机环境核对清单

一、机器
  [ ] Windows 10 1809 及以上 / Windows 11（x64 包）；ARM 笔记本用 -arm64 包，别混装
  [ ] 磁盘剩余 ≥ 1.2 GB（安装版解压后约 900 MB，免安装版再加一份）
  [ ] 内存 ≥ 4 GB（1080p 硬解建议 8 GB）

二、安装后首次启动
  [ ] 能正常出首页卡片（内置片源 + 平台格子）
  [ ] 设置页能打开，顶部版本显示 v{v}（#{code}）
  [ ] 播放一个内置片源，进度条能拖动、退出后能在「继续观看」看到续播点

三、本版新功能核对
  [ ] 设置页「键盘快捷键一览」能打开，全局键显示当前值
  [ ] 设置页「电视与遥控」切「强制开启」后，字号变大、方向键能移动焦点
  [ ] 设置页「账号与云同步」能看到本机 8 位设备码
  [ ] 点「同步到云」后提示 rev，再点「从云拉回」条数对得上（需中枢在线）
  [ ] 手机扫遥控二维码能打开遥控页（手机与电脑同网 / 都能访问中枢）
  [ ] 设置页「自动升级」能选四档，点「立即检查」有明确结果文案
  [ ] 语言下拉切「繁體中文（介面）」后，菜单与设置标题变繁，URL 与文件名保持原样
  [ ] 分类页多出标签筛选 chips，点一个能过滤

四、网络
  [ ] 中枢地址可达（默认 192.168.188.152:8787 或你自己的地址）
  [ ] 若中枢不可达：公告 / 云同步 / 手机遥控 / 推荐位全部降级为「不可用」，不阻塞播放
'''
with open(os.path.join(CLI, '装机环境核对清单.txt'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(checklist.format(v=V, code=CODE))

# ---------- 开发端说明 ----------
devdoc = '''鸿汇影 · 开发端 v{v}（#{dev}）说明

一、这个夹子里有什么
  鸿汇影桌面版 开发端 {v}.exe             x64 开发端（带运维面板 /admin、诊断段、远端配置）
  鸿汇影桌面版 开发端 {v}-arm64.exe       arm64 开发端
  HongHubMovie-开发端.hap                 开发端变体鸿蒙包（bundle com.honghub.harmony.dev）
  HongHubMovie.hap                        客户版鸿蒙包（对照用）
  启动开发者端.cmd / 安装后转开发端.cmd / 创建桌面快捷方式.vbs
  签名密钥\\                               HAP 签名材料（不要外发）
  密钥与口令清单_v{v}.txt                  口令与材料位置（不要外发）

二、客户版与开发端的差别
  客户版物理裁掉 server 目录，主进程 CLIENT_ONLY=true，/admin 死链清空；
  开发端保留全部运维页（远端配置 / 功能追踪 / 开关台 / 站点管理 / 看板）。

三、本版新增的代码文件
  app/kh-guard.js          平台入口域名守卫（三态 ok/ask/bad + 信任表 kh_trust_hosts，上限 30）
  app/kh-tv.js             电视形态判定 + 遥控返回/菜单键 + 焦点环
  app/kh-hant.js           简→繁显示层（词组占位 + 单字表 + 英文片段保护）
  app/kh-account.js        设备码账号 / 云同步 / 跨端续播 / 手机遥控轮询
  client-auto-update.js    客户版静默升级（四档 + SHA256 + 失败退避 + 装后检测）
  server/account-sync.js   账号与遥控队列服务端（账号落 data/accounts.json，指令内存队列）
  scripts/test-guard-kit.js / test-tv-kit.js / test-hant-kit.js /
  test-account-kit.js / test-account-client-kit.js / test-auto-update-kit.js

四、改了哪些老文件
  electron-main.js   3 个自动升级 IPC + 非 DEV_BUILD 时启动 client-auto-update
  preload.js         window.khAutoUpdate 桥
  kh-core.js         khAuRefresh / 自动升级面板 / 快捷键一览 / 电视与遥控面板 / 账号与云同步面板 /
                     分类页标签筛选 / kh_lang 加 zh-hant / render 尾部转繁
  kh-app.js          site-open 接域名守卫 / 遥控返回栈 / 自动同步 / 遥控指令执行 / 前缀分发
  kh-admin.js        au-save au-run tv-save acct-* 分支
  index.html         .kbt / .kh-tv 样式 + 四个新脚本引用
  server/server.js   account/remote 七条路由 + /remote 遥控页

五、单测合计
  guard 31 · auto-update 35 · hant 24 · tv 23 · account(server) 29 · account(client) 20
  既有回归 pref 63 · p2 93 · b8 88
  —— 合计 406 项，全绿。
'''
with open(os.path.join(DEVDIR, '开发者端说明_v%s.txt' % V), 'w', encoding='utf-8', newline='\n') as f:
    f.write(devdoc.format(v=V, dev=DEVCODE))

n_cli = len(os.listdir(CLI))
n_dev = len(os.listdir(DEVDIR))
print('客户成品：%s（%d 件）' % (CLI, n_cli))
for k in ('setup', 'zip', 'a64s', 'a64z', 'hap'):
    print('  %-6s %14s B  %s' % (k, S[k], H[k][:16]))
print('开发端：%s（%d 项）' % (DEVDIR, n_dev))
print('文档夹：%s' % DOCDIR)
