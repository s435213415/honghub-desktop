# -*- coding: utf-8 -*-
"""重写 文件导航.txt 正文为 1.7.94 现状，保留顶部自动块"""
import hashlib, os

DESK = os.path.join(os.path.expanduser('~'), 'Desktop')
DOC = os.path.join(DESK, '鸿汇影·文档资料')
NAV = os.path.join(DOC, '鸿汇影·文件导航.txt')
ROOT = r'C:\Users\admin\WorkBuddy\2026-11-15-18-33-52\HongHub-Desktop'
n_docs = len([f for f in os.listdir(DOC) if os.path.isfile(os.path.join(DOC, f))])


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def sz(p):
    return '{:,}'.format(os.path.getsize(p))


def info(p):
    return sz(p), sha(p)


CLI = os.path.join(DESK, '鸿汇影·客户成品_v1.7.94')
DEV = os.path.join(DESK, '鸿汇影·开发端_v1.7.94')
s1, h1 = info(os.path.join(CLI, '鸿汇影桌面版 Setup 1.7.94.exe'))
s2, h2 = info(os.path.join(CLI, '鸿汇影免安装 1.7.94.zip'))
s3, h3 = info(os.path.join(CLI, '鸿汇影桌面版 Setup 1.7.94-arm64.exe'))
s4, h4 = info(os.path.join(CLI, '鸿汇影免安装 1.7.94-arm64.zip'))
s5, h5 = info(os.path.join(CLI, 'HongHubMovie.hap'))
d1, hd1 = info(os.path.join(DEV, '鸿汇影桌面版 开发端 1.7.94.exe'))
d2, hd2 = info(os.path.join(DEV, '鸿汇影桌面版 开发端 1.7.94-arm64.exe'))
d3, hd3 = info(os.path.join(DEV, 'HongHubMovie-开发端.hap'))
rd = os.path.join(CLI, '客户下载说明.txt')
chk = os.path.join(CLI, '装机环境核对清单.txt')
devdoc = os.path.join(DEV, '开发者端说明_v1.7.94.txt')

old = open(NAV, encoding='utf-8').read()
marker = '<!-- KH_AUTO_END -->'
head = old[:old.index(marker) + len(marker)]

body = '''
整理时间：2026-11-23（正文按 1.7.94 现状重写；顶部自动块由发版链生成，两处不一致以自动块为准）

一、桌面根（当前版 + 历史归档）
  鸿汇影·客户成品_v1.7.94\\     给客户直接用，只放成品，无任何开发端 / 运维界面（12 件）
  鸿汇影·开发端_v1.7.94\\       自己维护调试用，绝不下发（13 个文件 + 签名密钥\\ 目录，共 14 项）
  鸿汇影·文档资料\\             更新日志、索引、导航、手册、清单与看板（{n} 件）
  开鸿影视·设备端_v1.7.87\\     KaihongMovie 设备端 HAP 与安装验证说明（3 件；1.7.94 仍未重出，缺 hdc 与 KH_KAIHONG_PWD）
  鸿汇影·开鸿签名资料\\         p12 / cer / p7b / CSR 与重签脚本
  鸿汇影·历史归档\\             1.7.15 ~ 1.7.93 全部旧交付 + _旧文档 + _零散旧件（1.7.93 两夹与桌面三件已归档）
  鸿汇影桌面版 Setup 1.7.94.exe        当前版 x64 安装包（{s1} B / {h1}）
  鸿汇影桌面版 Setup 1.7.94-arm64.exe  当前版 arm64 安装包（{s3} B / {h3}）
  HongHubMovie.hap                     当前版客户 HAP（{s5} B / {h5}）
  鸿汇影-网站导入备份.txt / 鸿汇影-影视仓配置-合并.json  内置资源来源素材，非交付件
  说明：桌面根只留当前版散件；1.7.93 三件在 鸿汇影·历史归档\\桌面旧散件_v1.7.93_20261123\\。

二、客户成品夹 v1.7.94（12 件：5 包 + 5 个 .sha256 + 2 份说明）
  鸿汇影桌面版 Setup 1.7.94.exe             {s1} B  {h1}（附 .sha256）
  鸿汇影桌面版 Setup 1.7.94-arm64.exe       {s3} B  {h3}（附 .sha256）
  鸿汇影免安装 1.7.94.zip                   {s2} B  {h2}（附 .sha256）
  鸿汇影免安装 1.7.94-arm64.zip             {s4} B  {h4}（附 .sha256）
  HongHubMovie.hap                          {s5} B  {h5}（附 .sha256）
  客户下载说明.txt                          {rs} B（1.7.94 重写：14 项逐条「在哪 / 怎么用 / 边界在哪」+ 四包一 HAP 哈希 + 常见问题）
  装机环境核对清单.txt                      {cs} B（装前六项核对 + 五包身份校验 + 装完七步自检，含配置总览 / 皮肤包 / 档案 / 网络族 / 分享五步）
  说明：免安装 zip 直接按架构命名，不再造「Setup 别名 zip」，避免同名两份。

三、开发端夹 v1.7.94（本机专用，13 个文件 + 签名密钥\\ 目录，共 14 项）
  鸿汇影桌面版 开发端 1.7.94.exe           {d1} B  {hd1}（附 .sha256）
  鸿汇影桌面版 开发端 1.7.94-arm64.exe     {d2} B  {hd2}（附 .sha256）
  HongHubMovie-开发端.hap                {d3} B  {hd3}（com.honghub.harmony.dev / #1000308，附 .sha256）
  HongHubMovie.hap（客户版，供对照）        {s5} B  {h5}…（附 .sha256）
  开发者端说明_v1.7.94.txt（{ds} B，含 14 项实现文件与 11 条自测要求）/ 密钥与口令清单_v1.7.94.txt（1,661 B）
  启动开发者端.cmd / 安装后转开发端.cmd / 创建桌面快捷方式.vbs
  签名密钥\\                                 开鸿平台签名物料，绝不外发
  开发端与客户成品严格隔离：客户夹只放成品，密钥口令只在开发端夹与工程目录。
  认包要点：同名同版本号但尺寸不同（{s1} vs {d1}），装机前先比 SHA256。

四、设备端夹 v1.7.87（3 件，1.7.94 未重出）
  KaihongMovie_v1.7.87.hap   1,041,939 B   a6773fee8f9120a0b55f683d9367de07b99019329039c8dded745b49d086dc02（#1000201 / com.kaihong.movie）
  安装与验证说明.txt          4,144 B，含三包身份对照、单独装不互顶、更新横幅不跨包、本版三条限制
  原因：oneclick 8.2 步要求 KH_KAIHONG_PWD 与 hdc list targets 非空，本机两者都不满足；
        告警不阻断主线，本轮产物链其余 11 步全部通过。

五、开鸿签名资料夹
  材料说明.txt / 开鸿证书获取与重签指南.txt / 一键重签.cmd
  鸿汇影 (1).p7b / 鸿汇影调试证书_含链.cer / 开鸿影视调试Profile.p7b
  开鸿私钥_kaihong.p12 / CSR留档_kaihong.csr / CSR留档_release_kaihong.csr

六、文档资料夹（{n} 件）
  鸿汇影·更新日志_v1.7.94.txt       本版：清单 14 项一次补完，含 590 项单测数字、冒烟 21/21、八件哈希、流水线真话、口径 81/0/0
  鸿汇影·更新日志_v1.7.93.txt       上一版：关窗口行为（#54）+ 字幕上下位置（#32）
  鸿汇影·更新日志_v1.7.92 / _v1.7.90 / _v1.7.89 / _v1.7.88 / _v1.7.87 / _v1.7.86 / _v1.7.85.txt   更早留档（1.7.91 未单独出日志，已并入 1.7.92）
  鸿汇影·文档索引_v1.7.94.txt       所有文档的索引（本版，第一阅读入口）
  鸿汇影·文档索引_v1.7.93 / _v1.7.92 / _v1.7.90 / _v1.7.89 / … / _v1.7.85.txt   旧索引留档
  鸿汇影·文件导航.txt               本文件
  鸿汇影·上传发布操作手册.txt       发布 / 上传步骤（顶部自动块随发版更新）
  鸿汇影·开发端文件更新说明.txt     改码后必须同步哪些文件、过哪些门禁（已补 1.7.94 段）
  鸿汇影·客户端可配置项清单_v1.7.94.xlsx   81 项：已实现 81 / 部分已有 0 / 待做 0；12 张表，含「v1.7.94 重算说明」
                                         本轮转「已实现」14 项：37 / 58 / 59 / 60 / 63 / 65 / 66 / 69 / 70 / 71 / 72 / 75 / 77 / 78
  鸿汇影·可配置项看板.html          同源同口径 81 项看板（v1.7.94 / 81 / 0 / 0）
  鸿汇影·客户端可配置项清单_v1.7.93 / _v1.7.92 / _v1.7.90 / _v1.7.89 / _v1.7.88 / _v1.7.87 / _v1.7.86 / _v1.7.79.xlsx   旧清单留档
  开发端开发排期 / 客户端开发排期（v1.7.67 ~ v1.7.70 与现行）   里程碑与排期留档

七、仓库内关键脚本（改码必看）
  scripts\\version.js --bump / --check     版本号 16 处一次对齐与核对（现为 1.7.94 / #1000208）
  scripts\\test-pref-kit.js                偏好纯逻辑 63 项
  scripts\\test-p2-kit.js                  P2 纯逻辑 93 项
  scripts\\test-b8-kit.js                  B 档纯逻辑 88 项
  scripts\\test-config-center.js           远端配置中心 57 项（本版新增）
  scripts\\test-remote-kit.js              远端配置客户端 65 项（本版新增）
  scripts\\test-qr-kit.js                  二维码编码器 41 项（本版新增）
  scripts\\test-theme-kit.js               皮肤包 48 项（本版新增）
  scripts\\test-cfg-kit.js                 配置总览 31 项（本版新增）
  scripts\\test-share-kit.js               短链分享服务端 38 项（本版新增）
  scripts\\test-family-meta-kit.js         家庭档案 + 元数据 66 项（本版新增）
  scripts\\smoke-ui.js                     21 个面板探针（新增「1.7.94 六个新面板真点生效」，真浏览器点 176 个 data-act 控件）
  scripts\\build_hap.py（harmony\\）         app → HAP 前端生成（改 app 必跑）
  scripts\\hap-sign.js                      HAP 签名（客户 / dev 变体），签完同步 release.json 的 hap
  scripts\\oneclick-release.js             一键流水线（--skip-hap 只重出桌面端）
  scripts\\doctor.js / check-artifacts.js / verify-release.js / check-client-purity.js   四道验收门禁
'''.format(n=n_docs, s1=s1, s2=s2, s3=s3, s4=s4, s5=s5, h1=h1, h2=h2, h3=h3, h4=h4, h5=h5,
           d1=d1, d2=d2, d3=d3, hd1=hd1, hd2=hd2, hd3=hd3, rs=sz(rd), cs=sz(chk), ds=sz(devdoc))

open(NAV, 'w', encoding='utf-8', newline='\r\n').write(head + body)
print('OK 文件导航已重写，文档夹', n_docs, '件')
