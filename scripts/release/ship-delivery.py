# -*- coding: utf-8 -*-
"""1.7.94 桌面交付夹补齐：客户成品 12 件 / 开发端 14 项（幂等，可重复跑）"""
import hashlib, os, shutil

ROOT = r'C:\Users\admin\WorkBuddy\2026-11-15-18-33-52\HongHub-Desktop'
DESK = os.path.join(os.path.expanduser('~'), 'Desktop')
CLI = os.path.join(DESK, '鸿汇影·客户成品_v1.7.94')
DEV = os.path.join(DESK, '鸿汇影·开发端_v1.7.94')
PREV_DEV = os.path.join(DESK, '鸿汇影·开发端_v1.7.93')
V = '1.7.94'
CODE = '1000208'
DEVCODE = '1000308'


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def size(p):
    return os.path.getsize(p)


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


def fmt(n):
    return '{:,}'.format(n)


x64_setup = os.path.join(ROOT, 'dist', 'client', '鸿汇影桌面版 Setup %s.exe' % V)
x64_zip = os.path.join(ROOT, 'dist', 'client', '鸿汇影免安装 %s.zip' % V)
a64_setup = os.path.join(ROOT, 'dist', 'client', '鸿汇影桌面版 Setup %s-arm64.exe' % V)
a64_zip = os.path.join(ROOT, 'dist', 'client', '鸿汇影免安装 %s-arm64.zip' % V)
hap = os.path.join(ROOT, 'dist', 'HongHubMovie.hap')
dev_hap = os.path.join(ROOT, 'dist', 'HongHubMovie-dev.hap')
dev_exe = os.path.join(ROOT, 'dist', '鸿汇影桌面版 开发端 %s.exe' % V)
dev_exe_a64 = os.path.join(ROOT, 'dist', '鸿汇影桌面版 开发端 %s-arm64.exe' % V)

for p in (x64_setup, x64_zip, a64_setup, a64_zip, hap, dev_hap, dev_exe, dev_exe_a64):
    assert os.path.exists(p), p

# ---------- 客户成品夹 ----------
os.makedirs(CLI, exist_ok=True)
c_setup = put(x64_setup, CLI)
c_zip = put(x64_zip, CLI)
c_a64s = put(a64_setup, CLI)
c_a64z = put(a64_zip, CLI)
c_hap = put(hap, CLI)

h_setup, h_zip = sidecar(c_setup), sidecar(c_zip)
h_a64s, h_a64z = sidecar(c_a64s), sidecar(c_a64z)
h_hap = sidecar(c_hap)

# ---------- 开发端夹 ----------
os.makedirs(DEV, exist_ok=True)
d_exe = put(dev_exe, DEV)
d_exe_a = put(dev_exe_a64, DEV)
d_hap = put(dev_hap, DEV, 'HongHubMovie-开发端.hap')
d_chap = put(hap, DEV)
h_dexe, h_deexa = sidecar(d_exe), sidecar(d_exe_a)
h_dhap, h_dchap = sidecar(d_hap), sidecar(d_chap)

# 运维脚本与密钥夹：与版本号无关，从上一版开发端夹原样带过来（夹里已有就不覆盖）
for name in ('启动开发者端.cmd', '安装后转开发端.cmd', '创建桌面快捷方式.vbs'):
    dst = os.path.join(DEV, name)
    src = os.path.join(PREV_DEV, name)
    if not os.path.exists(dst) and os.path.exists(src):
        shutil.copy2(src, dst)
KEYDIR = os.path.join(DEV, '签名密钥')
if not os.path.isdir(KEYDIR) and os.path.isdir(os.path.join(PREV_DEV, '签名密钥')):
    shutil.copytree(os.path.join(PREV_DEV, '签名密钥'), KEYDIR)

KEYLIST = '密钥与口令清单_v%s.txt' % V
if not os.path.exists(os.path.join(DEV, KEYLIST)):
    for cand in ('密钥与口令清单_v1.7.94.txt', '密钥与口令清单_v1.7.93.txt'):
        src = os.path.join(DEV, cand)
        if not os.path.exists(src):
            src = os.path.join(PREV_DEV, cand)
        if os.path.exists(src):
            put(src, DEV, KEYLIST)
            break

# ---------- 客户下载说明 ----------
readme = '''鸿汇影桌面版 {v}（应用版本 #{code}）

一、本版装什么
  {v} 把清单里挂着的 14 项一次补完。一句话：以前只有开发和运维能改的东西，现在你自己在设置页就能改，
  改完立刻生效；该放本机的放本机，该走中枢的走中枢，两端的说法是同一次改动的结果。

  1. 顶部公告条
     中枢可以下发一条公告（带起止时间），启动后 8 秒内拉取，同一条只会显示一次，点「不再提示」就收起；
     公告里的链接只提供「复制链接」，不会跳系统浏览器。
  2. 远端锁与默认值
     中枢可以把某几项配置标成锁定，界面上对应控件置灰并带 🔒 标记；本机没设过的项会用中枢的默认值补上，
     你自己设过的（包括显式填 0、填空）一律不动。远端版本号比本机旧时不会覆盖本机较新的设置。
  3. 云端偏好同步
     设置页「远端配置与云端」面板里可开可关，开着时把你本机的偏好（只限 kh_ 前缀的设置键）推到中枢、
     也能从别的机器拉回来。片源地址、账号、口令、密钥这类内容不参与同步，填进去会被中枢直接拒收。
  4. 配置总览（38 项）
     设置页新增一张表，把 38 个可配置项按 7 组摊开：播放 / 界面 / 通知与启动 / 儿童 / 网络 / 数据 / 远端与云端。
     顶部搜索框按名称、键名、分组都能搜；每一项能单独改、单独恢复默认，也能按组恢复或全部恢复默认。
     恢复默认是「写回默认值」，不会删键，所以不会出现「配置被判定损坏」。
  5. 二维码与短链分享
     输入一个地址或应用内页面，生成短链 + 二维码；扫一下就能在手机上打开，链接可复制。
     只支持公网 http(s) 地址或应用内路由，内网与本机地址会被拒；短链 180 天后失效。
     建短链失败（比如中枢没开）会自动退回原链接，界面会说清是哪种情况。
  6. 皮肤包
     设置页「皮肤包」可以粘贴一个配色包导入，或从地址下载；只认 8 个颜色变量，值只接受 #hex 与 rgb()，
     不含任何脚本或外部图片引用，最多存 8 个。内置三个样例（霓虹 / 青玉 / 余烬）可直接套，随时一键回内置配色。
  7. 家庭多档案
     最多 4 个档案（比如爸爸 / 妈妈 / 孩子 / 客用）。切换时收藏、稍后看、历史、播放进度、片单、直播收藏、
     儿童开关与 PIN、儿童时长各自独立，互不串。档案改名直接在行内输入框里改，旧的存储结构没有改动，
     升级不会丢任何数据。
  8. 元数据与海报来源
     卡片的海报、评分、简介可以来自内置信息、TMDB、或你自定义的接口模板（模板里必须带 {{title}}）。
     自定义海报只认 http(s) 地址，评分限 0–10，缓存最多 50 条、按时间淘汰。
     豆瓣刮削不做：它没有公开 API，抓网页违反其条款，所以面板里明确写着不支持，别在这里等。
     TMDB 需要你自己填 API Key，不填就只提示原因，不会假装刮到。
  9. 字幕站
     最多 10 个字幕站地址，只收 http(s)，在应用内打开，不跳系统浏览器。
 10. AI 翻译 Key
     填自己的 Key（至少 8 位），可以填自定义接口地址；界面上只显示后 4 位，备份包里不含这个 Key。
 11. 网络族与自定义 DNS
     「自动 / 仅 IPv4 / 仅 IPv6」三档，选仅 IPv4 时下次启动不再走 IPv6；自定义 DNS 最多填 3 个 IP 或域名，
     保存后重启生效。这里只做记录与启动参数，不替系统改 DNS 解析器——面板文案也是这么写的。
 12. 双窗口一致
     同时开两个窗口时，在一边改了高级设置（音轨 / 字幕 / 通知 / 快捷键 / 关闭行为等），另一边立刻跟上，不用重启。

  上一版的能力照旧：关窗口行为（托盘 / 最小化 / 退出）与字幕五档位置，以及音轨语言、本地字幕目录、
  通知与提示音、窗口置顶、画中画、五个全局快捷键、外部播放器、儿童模式与每日时长、配置体检与一键修复。

二、四个包，按机器选
  x64（绝大多数 Intel / AMD 电脑）
    安装版  鸿汇影桌面版 Setup {v}.exe          {s1} B   sha256 {h1}
    免安装  鸿汇影免安装 {v}.zip                {s2} B   sha256 {h2}
  arm64（骁龙 X / 鲲鹏等 ARM 笔记本、部分平板）
    安装版  鸿汇影桌面版 Setup {v}-arm64.exe    {s3} B   sha256 {h3}
    免安装  鸿汇影免安装 {v}-arm64.zip          {s4} B   sha256 {h4}
  深开鸿 / OpenHarmony 设备
    鸿蒙包  HongHubMovie.hap                    {s5} B   sha256 {h5}

三、怎么装
  1. 安装版：双击 Setup，选目录，装完桌面会有图标；首次启动会自动建库。
  2. 免安装版：解压到任意目录（路径别含特殊符号），双击「鸿汇影桌面版.exe」。
  3. 鸿蒙：用 DevEco Studio 或 hdc install 装 HAP；装过 v1.7.45 及更早自签版的设备请先卸载再装。
  4. 覆盖升级：直接装新版即可，播放记录、收藏、影视仓配置、设置、档案全部保留。

四、装完怎么确认没装错
  1. 右下角版本号应为 {v}（应用版本 #{code}）。
  2. 设置页往下拉，应能看到这六块新面板：配置总览（38 项）、皮肤包、二维码 / 短链分享、
     家庭多档案、元数据与海报来源 / 字幕站 / AI Key、网络族与自定义 DNS；再往下是远端配置与云端。
  3. 配置总览顶部应显示「当前筛选出 38 项」；搜「音量」会只剩音量相关几项，点「清空搜索」回到 38 项。
  4. 打开「诊断」，产物校验值一栏与上面 sha256 对得上。
  5. 校验值核验：Windows 下执行
       certutil -hashfile "鸿汇影桌面版 Setup {v}.exe" SHA256
     与本说明或同名 .sha256 文件里的值逐位比对。

五、环境要求
  Windows 10 1809 及以上 / Windows 11；内存 4 GB 起（1080p 建议 8 GB）；
  磁盘留 300 MB 以上空闲；装完首次启动需可访问中枢地址（局域网或公网均可）。

六、常见问题
  · SmartScreen 提示「未知发布者」：安装包未做商业代码签名，点「更多信息 → 仍要运行」。
  · 公告条没出现：中枢没配公告、公告不在有效期、或你之前点过「不再提示」，三种都在面板的公告状态里能看到。
  · 云端同步按钮点了没反应：先确认中枢地址能打开、面板里「云同步」是开的；失败原因会写在面板的结果行里。
  · 短链生成失败：中枢没开或没配公网地址时会退回原链接，复制原链接一样能用。
  · 皮肤包导不进去：只认 8 个颜色变量和 #hex / rgb() 值，带 url()、expression()、分号的包会被拒。
  · 切换档案后收藏不见了：收藏是按档案分开存的，切回原档案就回来；这是设计，不是丢数据。
  · 元数据刮不到：内置只保证基础信息；TMDB 要在面板里填自己的 Key；豆瓣本版不支持。
  · 网络族设了「仅 IPv4」感觉没变化：它下次启动才生效；自定义 DNS 同理，且不替代系统解析器。
  · 装了打不开：先看托盘是否已在运行（重复启动会切到已开窗口）；仍不行用「诊断」导出报告。
  · ARM 机器装了 x64 包会走转译，能用但更耗电：请改装 -arm64 包。
'''

with open(os.path.join(CLI, '客户下载说明.txt'), 'w', encoding='utf-8', newline='\r\n') as f:
    f.write(readme.format(v=V, code=CODE, s1=fmt(size(c_setup)), h1=h_setup,
                          s2=fmt(size(c_zip)), h2=h_zip,
                          s3=fmt(size(c_a64s)), h3=h_a64s,
                          s4=fmt(size(c_a64z)), h4=h_a64z,
                          s5=fmt(size(c_hap)), h5=h_hap))

# ---------- 装机环境核对清单 ----------
check = '''鸿汇影桌面版 {v} · 装机环境核对清单

一、装前六项核对（缺一项就先补，别装完再排查）
  1. 系统版本：Win10 1809+ 或 Win11；ARM 机器必须用 -arm64 包，不要装 x64 转译。
  2. 位数与架构：设置 → 系统 → 关于，看「系统类型」是 64 位 x64 还是 ARM64。
  3. 磁盘：安装盘至少 300 MB 空闲（安装版解压后约 260 MB）。
  4. 内存：4 GB 起；1080p 长时间看建议 8 GB。
  5. 网络：能打开中枢地址（本机 8787 或部署的公网地址）；公司网需放行 8787 / 443。
     公告、远端锁、默认值下发、云端偏好、短链，这五项都要中枢可达才生效；不可达时客户端照常能用，
     只是这几项停在本机状态，不会卡启动。
  6. 杀软：如装了第三方安全软件，先允许安装目录与 honghub 进程，避免实时扫描拖慢启动。

二、包身份校验（五个包各算一次，逐位比对 .sha256）
  Setup {v}.exe            {s1} B   {h1}
  Setup {v}-arm64.exe      {s2} B   {h2}
  免安装 {v}.zip           {s3} B   {h3}
  免安装 {v}-arm64.zip     {s4} B   {h4}
  HongHubMovie.hap         {s5} B   {h5}
  命令：certutil -hashfile "<文件名>" SHA256
  认包要点：同名同版本号但尺寸不同（客户版 {s1} 与开发端 {dev}），以 sha256 为准，别拿开发端包发给客户。

三、装完七步自检
  1. 版本：右下角显示 {v} / #{code}。
  2. 配置总览：设置页「配置总览（38 项）」显示 38 行；搜「音量」行数变少，清空搜索回到 38 行；
     改一项后重启仍是新值（证明写进本机并打上封条）。
  3. 皮肤包：套一个内置样例（霓虹 / 青玉 / 余烬）应当整页换色；点「回内置配色」恢复原样。
  4. 家庭档案：新建一个档并改名，切回原档后收藏与历史应各自独立；删掉测试档不留残渣。
  5. 网络族：选「仅 IPv4」保存 → 面板提示已写入、重启后生效；重启后「诊断」里能看到当前网络族。
  6. 分享：输入一个 http(s) 地址生成二维码，手机上能扫开；输入内网地址应被拒并说明原因。
  7. 诊断：导出报告，产物校验值与第二节一致；无 ERROR 分区。

四、覆盖升级须知
  直接装新版，播放记录、收藏、影视仓配置、偏好与高级设置全部保留。
  旧版字幕位置三档（低 / 中 / 高）升级后自动折算为 4% / 8% / 18%，无需重设。
  档案是新增结构，升级后默认只有一个「家庭」档，原有收藏与历史都在这个档里。

五、常见问题
  · 「改成收进托盘后每次启动都要自己开窗口」：正常，关闭只收不杀；想彻底退出就走托盘「退出」。
  · 「公告看不到」：中枢没配、过了有效期、或本机点过「不再提示」，面板里能看到三种状态。
  · 「云端同步把设置改乱了」：远端版本比本机旧时不会覆盖；真改乱了可在配置总览里按组恢复默认。
  · 「自定义 DNS 为什么不生效」：它只记录并作为启动参数，不替代系统解析器；要改系统 DNS 得在系统设置里改。
  · 「元数据刮不到豆瓣」：本版明确不做豆瓣刮削（无公开 API + 条款限制），自定义模板可以指向别的来源。
  · 「选字幕目录后没自动挂」：确认片名与字幕文件主名一致（语言后缀如 .zh 会被忽略）。
'''

with open(os.path.join(CLI, '装机环境核对清单.txt'), 'w', encoding='utf-8', newline='\r\n') as f:
    f.write(check.format(v=V, code=CODE, s1=fmt(size(c_setup)), h1=h_setup,
                         s2=fmt(size(c_a64s)), h2=h_a64s,
                         s3=fmt(size(c_zip)), h3=h_zip,
                         s4=fmt(size(c_a64z)), h4=h_a64z,
                         s5=fmt(size(c_hap)), h5=h_hap,
                         dev=fmt(size(d_exe))))

# ---------- 开发者端说明 ----------
devdoc = '''鸿汇影·开发端 {v} 说明（本机专用，绝不下发）

一、这个夹子是干什么的
  只给本机维护用：带运维面板、调试入口、远端配置中心页、开鸿签名物料。客户拿到的成品夹里没有这些，
  下发通道也会拦下任何混进开发端文件的客户目录。

二、夹内文件
  鸿汇影桌面版 开发端 {v}.exe          {s1} B   sha256 {h1}
  鸿汇影桌面版 开发端 {v}-arm64.exe    {s2} B   sha256 {h2}
  HongHubMovie-开发端.hap              {s3} B   sha256 {h3}   （bundle com.honghub.harmony.dev / #{devcode}）
  HongHubMovie.hap                     {s4} B   sha256 {h4}   （客户版，供对照）
  密钥与口令清单_v{V}.txt           开鸿签名与中枢口令的存放位置索引
  启动开发者端.cmd                     以开发模式起服务，带 /admin
  安装后转开发端.cmd                   装完官方包后把它切成开发端
  创建桌面快捷方式.vbs                 建带 /admin 参数的桌面入口
  签名密钥\\                            开鸿平台 p12 / cer / p7b，绝不外发

三、认包要点
  同名同版本号尺寸不同：客户版 {s5} B，开发端 {s1} B。发错就是把运维入口给了客户。
  一律先比 sha256；带 .sha256 文件逐个核。

四、本版改动（1.7.94：清单 14 项一次补完，67/3/11 → 81/0/0）

  批 1 服务端远端配置中心（#69 #70 #71 #77 #66）
    server/config-center.js（新建）：config-center.json 统管公告 / 锁定 / 默认值 / 灰度 / 云同步，每次写入 rev++；
      灰度按 FNV-1a(device|id)%100 分桶，版本区间按 10000/100/1 加权；syncPush/syncPull 只收 kh_ 前缀键，
      禁用词与 http 值拒收、对象串≤4096；pull 取「不是自己且最近更新」的一条。
    server/server.js：加 7 条 config/sync 路由 + /admin/config-center 页与导航「🎛 远端配置」。
    server/config-center-admin.html（新建）：暗色四卡表单。

  批 2 客户端远端配置 + 跨进程一致（#72 #75）
    app/kh-remote.js（新建）：视图归一 / 公告有效期 / 锁定命中 / 离线灰度求值（与服务端同算法）。
    app/kh-core.js：远端块（拉取 / 应用 / #khNoticeBar / 🔒 置灰 / 存储载体 / 云同步推拉）、
      设置页「远端配置与云端」面板、rev 回滚不覆盖本机较新视图；启动 8 秒后拉一次 + 每 6 小时轮询。
    electron-main.js：b8Write 末尾 b8Broadcast() 广播 kh:b8-changed；preload.js 暴露 khB8.onChanged；
    kh-core.js 的 khB8Watch() 收到后写回本机并重绘（不回推，防两窗口互触发）。

  批 3 配置总览 / 二维码 / 皮肤包（#63 #65 #78）
    app/kh-core.js：KH_CFG_REG 38 键（播放 11 / 界面 10 / 通知与启动 7 / 儿童 3 / 网络 3 / 数据 2 / 远端与云端 2）
      + 「配置总览」面板（#cfgQ 搜索、单键改、单键 ↺、按组恢复、全部恢复；恢复默认写回值不删键）。
    app/kh-qr.js（新建）：本地二维码编码器（版本 1–10 / 纠错 M / UTF-8 字节模式 / 8 掩码择优），无第三方依赖。
    app/kh-theme.js（新建）：皮肤包（8 个白名单 CSS 变量、只认 #hex / rgb()、上限 8 包、3 个内置样例）。
    server/shares.js（新建）：7 位短码 / TTL 180 天 / CAP 500 / 只收公网 http(s) 或 # 路由 / 拦内网。
    server/server.js：POST /api/share + GET /s/<code> 302。

  批 4 家庭档案 / 元数据 / 字幕站与 Key / 网络族（#58 #59 #60 #37）
    app/kh-family.js（新建）：4 档上限，切档时 dump→restore 换挡 10 个键，不改任何既有存储键。
    app/kh-core.js：KH_PROF_DEF + khProf* 十函数（缺键写默认而非 removeItem）；档案改名走行内输入框
      （Electron 渲染进程没有 window.prompt）；poster() 接入刮削结果（海报 / 评分 / 简介，卡片标注来源）。
    app/kh-meta.js（新建）：元数据来源 builtin/tmdb/douban/custom、模板必须含 {{title}}、海报只认 http(s)、
      评分 0–10、缓存上限 50、字幕站上限 10、AI Key ≥8 位且只露后 4 位、DNS 双套校验。
      豆瓣明确不实现（无公开 API + 条款），UI 已写明。
    electron-main.js：NET_FILE=userData/kh-net.json，mode==='ipv4' 时 appendSwitch('disable-ipv6')，
      kh:b8-net-get / set 桥。
    app/kh-admin.js：新增 31 个动作（r-* 6、cfg-* 5、theme-* 7、share-* 3、prof-* 4、meta-* 3、
      sub-sites-save、ai-* 2、net-save）。

  本轮修掉的两个真问题
    1) 九组新动作只写了处理函数、没接点击分发（按钮点了没反应）；已并入 kh-app 的 resAction 分发链。
    2) 启动后并入仓自带直播源的后台重绘会在用户填设置表单时抢焦点；新增 khSafeRender()：
       设置页有输入控件聚焦时只标记待绘，等下一次正常重绘顺带生效。

五、自测（必须全绿才出包）
  1. node scripts\\test-pref-kit.js          63 项 / 0 失败
  2. node scripts\\test-p2-kit.js            93 项 / 0 失败
  3. node scripts\\test-b8-kit.js            88 项 / 0 失败
  4. node scripts\\test-config-center.js     57 项 / 0 失败
  5. node scripts\\test-remote-kit.js        65 项 / 0 失败
  6. node scripts\\test-qr-kit.js            41 项 / 0 失败
  7. node scripts\\test-theme-kit.js         48 项 / 0 失败
  8. node scripts\\test-cfg-kit.js           31 项 / 0 失败
  9. node scripts\\test-share-kit.js         38 项 / 0 失败
 10. node scripts\\test-family-meta-kit.js   66 项 / 0 失败
     合计 590 项 0 失败。
 11. node scripts\\smoke-ui.js               面板真点 21/21、错误 0、176 个 data-act 控件全都点过
     （新增「1.7.94 六个新面板真点生效」一条，覆盖搜索清空 / 皮肤包应用回退 / 档案增删切 / 网络族落盘 / 出二维码）。

  前端或主进程改完还要：python harmony\\build_hap.py → node scripts\\hap-sign.js
  （不重跑 HAP 里就是旧前端；重签后同步 dist/release.json 的 hap size/sha）

六、运维入口（本机）
  开发端 exe 启动后访问 /admin；远端配置中心在 /admin/config-center，可改公告 / 锁定 / 默认值 / 灰度 / 云同步。
'''

with open(os.path.join(DEV, '开发者端说明_v%s.txt' % V), 'w', encoding='utf-8', newline='\r\n') as f:
    f.write(devdoc.format(v=V, V=V, s1=fmt(size(d_exe)), h1=h_dexe,
                          s2=fmt(size(d_exe_a)), h2=h_deexa,
                          s3=fmt(size(d_hap)), h3=h_dhap,
                          s4=fmt(size(d_chap)), h4=h_dchap,
                          s5=fmt(size(c_setup)), devcode=DEVCODE))

print('客户成品夹：')
for n in sorted(os.listdir(CLI)):
    print('  ', n, fmt(size(os.path.join(CLI, n))))
print('开发端夹：')
for n in sorted(os.listdir(DEV)):
    p = os.path.join(DEV, n)
    print('  ', n, '-' if os.path.isdir(p) else fmt(size(p)))
print('OK')
