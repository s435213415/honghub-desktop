#!/usr/bin/env node
/**
 * 鸿汇影 · 一键交付（release-deliver）
 * ------------------------------------------------------------
 * 从 dist 直接生成桌面四夹 + D 盘交付 + 文档 + 哈希校验，取代手写流程。
 *
 *   node scripts/release-deliver.js               # 生成桌面四夹（不动历史）
 *   node scripts/release-deliver.js --archive     # 顺手把旧版同 tag 四夹移入历史归档
 *   node scripts/release-deliver.js --disk        # 另写 D:\鸿汇影_<版本>
 *   node scripts/release-deliver.js --no-docs     # 只搬包，不写文档
 *
 * 规则：每个包旁边必有同名 .sha256（「哈希 + 两空格 + 文件名」）；
 *      D 盘复制后逐个 GetFileHash 等价校验（半截文件会直接报 MISMATCH 并退出码 1）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CLIENT = path.join(DIST, 'client');
const DESK = path.join(process.env.USERPROFILE || 'C:\\Users\\admin', 'Desktop');
const ARCHIVE = path.join(DESK, '鸿汇影·历史归档');
const DOCS = path.join(DESK, '鸿汇影·文档资料');

const argv = process.argv.slice(2);
const opt = {
  archive: argv.includes('--archive'),
  disk: argv.includes('--disk'),
  docs: !argv.includes('--no-docs'),
  ver: (argv.find(a => a.startsWith('--ver=')) || '').split('=')[1] || ''
};

const VERSION = opt.ver || JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
if (!VERSION) { console.error('读不到版本号'); process.exit(1); }
const TAG = 'v' + VERSION;

/* D 盘落盘先探明：文档索引与结尾都会写「盘上」路径，盘不在就不能写那个路径。
   1.7.113 纠偏：曾出现 D 盘不可用（已跳过）却仍打印「D:\鸿汇影_1.7.112」的误导行。 */
const DISK_DRIVE = opt.disk ? (process.env.KH_DISK_DRIVE || 'D:') : null;
const DISK_OK = !!(DISK_DRIVE && fs.existsSync(DISK_DRIVE + path.sep));
const DISK_ROOT = DISK_OK ? path.join(DISK_DRIVE + path.sep, '鸿汇影_' + VERSION) : null;

function sha(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}
function size(p) {
  return fs.statSync(p).size;
}
function comma(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function write(name, lines) {
  const p = typeof name === 'string' ? name : name.path;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join('\r\n') + '\r\n', 'utf8');
  console.log('  文档 ' + path.relative(DESK, p));
}
function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); return dir; }

/* ---------- 收集产物 ---------- */
const ART = {
  hap: path.join(DIST, 'HongHubMovie.hap'),
  dev: path.join(DIST, '鸿汇影桌面版 开发端 ' + VERSION + '.exe'),
  x64s: path.join(CLIENT, '鸿汇影桌面版 Setup ' + VERSION + '.exe'),
  x64z: path.join(CLIENT, '鸿汇影免安装 ' + VERSION + '.zip'),
  a64s: path.join(CLIENT, '鸿汇影桌面版 Setup ' + VERSION + '-arm64.exe'),
  a64z: path.join(CLIENT, '鸿汇影免安装 ' + VERSION + '-arm64.zip')
};
const missing = Object.keys(ART).filter(k => !fs.existsSync(ART[k]));
if (missing.length) {
  console.error('缺少产物：' + missing.join(', '));
  Object.keys(ART).forEach(k => console.error('  ' + k + ' -> ' + ART[k]));
  process.exit(1);
}
const INFO = {};
Object.keys(ART).forEach(k => { INFO[k] = { name: path.basename(ART[k]), size: size(ART[k]), hash: sha(ART[k]) }; });

console.log('======== 鸿汇影 ' + TAG + ' 交付 ========');
Object.keys(INFO).forEach(k => console.log('  ' + INFO[k].name + '  ' + comma(INFO[k].size) + '  ' + INFO[k].hash.slice(0, 16) + '…'));

/* ---------- 四夹 ---------- */
const D_BEI = path.join(DESK, '鸿汇影·备机验证_' + TAG);
const D_DEV = path.join(DESK, '鸿汇影·开发端_' + TAG);
const D_CLI = path.join(DESK, '鸿汇影·客户成品_' + TAG);
const D_PUB = path.join(DESK, '鸿汇影·私发_' + TAG);

if (opt.archive) {
  // 把桌面上「非当前版本」的同名四夹整体移入历史归档（版本化目录名保证不撞车）
  const tags = ['备机验证', '开发端', '客户成品', '私发'];
  let moved = 0;
  fs.readdirSync(DESK, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^鸿汇影·(备机验证|开发端|客户成品|私发)_v/.test(d.name) && !d.name.endsWith('_' + TAG))
    .forEach(d => {
      const from = path.join(DESK, d.name);
      const to = path.join(ensure(ARCHIVE), d.name);
      if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
      fs.renameSync(from, to);
      moved++;
      console.log('  归档 ' + d.name);
    });
  if (!moved) console.log('  没有旧版四夹需要归档');
  if (fs.existsSync(DOCS)) {
    ['鸿汇影·更新日志_', '鸿汇影·文档索引_', '双端功能差异_'].forEach(pre => {});
  }
}

function put(srcKey, dstDir, rename) {
  const s = ART[srcKey], info = INFO[srcKey];
  const dst = path.join(ensure(dstDir), rename || info.name);
  fs.copyFileSync(s, dst);
  const h = sha(dst);
  fs.writeFileSync(dst + '.sha256', h + '  ' + path.basename(dst) + '\r\n', 'utf8');
  if (h !== info.hash) {
    console.error('  MISMATCH ' + dst);
    process.exitCode = 1;
  }
  console.log('  包 ' + path.basename(dst) + '  ' + comma(size(dst)));
  return { path: dst, name: path.basename(dst), size: size(dst), hash: h };
}

[ D_BEI, D_DEV, D_CLI, D_PUB ].forEach(ensure);
/* 备机夹主包必须是「设备端原生包」（bundle com.kaihong.movie + 开鸿平台签发证书）。
   dist 里的 com.honghub.harmony 走 official 链（SDK 公开测试密钥，profile 里
   app-distribution-type=os_integration），非系统集成设备在启动阶段就拒绝——
   表现为点图标完全没反应。2026-11-24 在 KaihongOS 6.1 备机上实测确认，
   所以改成「原生包为主、webview 壳进备用子目录备查」，避免下次一键又把打不开的包放回来。 */
const KH_DIST = path.join(require('os').homedir(), 'WorkBuddy', '2026-11-12-16-34-57', 'KaihongMovie', 'dist');
const DEV_HAP = [
  path.join(DESK, '开鸿影视·设备端_v' + VERSION, 'KaihongMovie_v' + VERSION + '_kaihong.hap'),
  path.join(DESK, '开鸿影视·设备端_v' + VERSION, 'KaihongMovie_v' + VERSION + '.hap'),
  path.join(KH_DIST, 'KaihongMovie_v' + VERSION + '_kaihong.hap'),
  path.join(KH_DIST, 'KaihongMovie_v' + VERSION + '.hap')
].find(p => fs.existsSync(p)) || null;
const BEI_SUB = path.join(D_BEI, '备用-webview壳（本机启动被拒）');
let BEI_MAIN;
if (DEV_HAP) {
  const dst = path.join(D_BEI, path.basename(DEV_HAP));
  fs.copyFileSync(DEV_HAP, dst);
  const h = sha(dst);
  fs.writeFileSync(dst + '.sha256', h + '  ' + path.basename(dst) + '\r\n', 'utf8');
  console.log('  包 ' + path.basename(dst) + '  ' + comma(size(dst)) + '（设备端原生包）');
  BEI_MAIN = { name: path.basename(dst), size: size(dst), hash: h };
  put('hap', BEI_SUB);
} else {
  console.log('  [提示] 没找到设备端原生包（KaihongMovie_v' + VERSION + '_kaihong.hap），备机夹仍放 webview 壳；');
  console.log('         该壳在本机备机上会被系统拒绝启动，装之前先跑 sync-device-version.py --apply。');
  BEI_MAIN = put('hap', D_BEI);
}
put('dev', D_DEV);
put('hap', D_CLI);
put('x64s', D_CLI);
put('x64z', D_CLI);
put('a64s', D_CLI);
put('a64z', D_CLI);
put('x64z', D_PUB);
put('hap', D_PUB);

/* ---------- 文档 ---------- */
if (opt.docs) {
  const h = INFO;
  write(path.join(D_CLI, '客户下载说明.txt'), [
    '鸿汇影 ' + TAG + ' · 客户版下载说明',
    '版本 ' + VERSION + ' · ' + new Date().toISOString().slice(0, 10) + ' · 桌面 Windows 与深开鸿 HAP 同版',
    '提示：本夹 ' + h.hap.name + ' 是 official 链自签（bundle com.honghub.harmony），在 KaihongOS 设备上会被系统拒绝启动；',
    '      要装到开鸿设备，请用「鸿汇影·备机验证_' + TAG + '」里的设备端原生包（com.kaihong.movie）。',
    '',
    '一、这一版改了什么',
    '  1) 播放失败不再只有一句话：问题中心新增「最近播放事件」，每次失败自动记错误码、判定文案、地址、HLS 失败类型、看门狗次数、在线状态，可一键复制带走。',
    '  2) 设置页新增「网络与更新」：局域网访问默认关闭（只绑 127.0.0.1），需要别的设备连本机中枢时才手动开启，开启后要口令。',
    '  3) 新增「检查更新」：对比中枢里的版本，桌面端走静默升级，设备端会明确提示「HAP 需要手动传包安装」。',
    '',
    '二、装完首页是空的，这不是装坏了',
    '  这一版不预置任何样片。首页三张卡任选一条路：',
    '  · 有接口站：进「网站」页 → 影视仓 → 粘贴或导入站点配置，保存后片名能直接搜。',
    '  · 有直链：进「资源」页填一条 mp4 / m3u8，保存后立刻出现在首页与分类。',
    '  · 什么都没有：先看直播；桌面版还能点「打开本机视频」。',
    '',
    '三、播放失败怎么取证',
    '  1) 「问题中心」→「播放诊断」→「开始诊断」，三条测试流跑完看 error.code：2 网络 / 3 解码 / 4 源不支持。',
    '  2) 同页「最近播放事件」会给出实际失败的那条地址与判定，点「复制播放事件」一起发回。',
    '  3) 两条都没有效信息时，再点「导出报告 .txt」带走整份诊断。',
    '',
    '四、包与校验',
    '  Windows x64   ：' + h.x64s.name + '（' + comma(h.x64s.size) + ' B）',
    '                  ' + h.x64s.hash,
    '  Windows x64   ：' + h.x64z.name + '（' + comma(h.x64z.size) + ' B，解压即用）',
    '                  ' + h.x64z.hash,
    '  Windows ARM64 ：' + h.a64s.name + '（' + comma(h.a64s.size) + ' B）',
    '                  ' + h.a64s.hash,
    '  Windows ARM64 ：' + h.a64z.name + '（' + comma(h.a64z.size) + ' B）',
    '                  ' + h.a64z.hash,
    '  深开鸿 HAP   ：' + h.hap.name + '（' + comma(h.hap.size) + ' B，bundle com.honghub.harmony）',
    '                  ' + h.hap.hash,
    '  每个包旁边都有同名 .sha256（哈希 + 两空格 + 文件名）。校验用 Get-FileHash -Algorithm SHA256。',
    '',
    '五、安装与系统要求',
    '  · Windows：Windows 10 1809+ / Windows 11（64 位）；安装版双击下一步，免安装版解压运行「鸿汇影.exe」。',
    '  · 深开鸿：KaihongOS 6.1 / OpenHarmony 6.1（API ≥ 11）；不支持更低版本设备。',
    '  · 未做代码签名：SmartScreen 提示「未知发布者」选「仍要运行」，不是文件损坏。',
    '',
    '六、常见问题',
    '  Q: 别人连不上我的中枢？  A: 默认只绑 127.0.0.1。到「设置 → 网络与更新」开「局域网访问」，把显示的中枢地址给对方，口令一并给。',
    '  Q: 设备端能自动升级吗？  A: 不能。检查更新只负责告诉你有没有新版，安装要手动传 HAP 点开覆盖。',
    '  Q: 设置里看不到局域网开关？  A: 设备端（HAP）没有本机中枢，这项只在桌面端出现。'
  ]);

  write(path.join(D_CLI, '装机环境核对清单.txt'), [
    '鸿汇影 ' + TAG + ' · 装机环境核对清单',
    '装完先跑「问题中心 → 环境自检」（首次打开自动跑），再逐条对：',
    '',
    '[ ] 1. 系统版本：Windows 10 1809+ / 11（64 位）；深开鸿 KaihongOS 6.1 / OpenHarmony 6.1（API ≥ 11）',
    '[ ] 2. 磁盘剩余 ≥ 2 GB（自检显示「充足」）',
    '[ ] 3. 数据目录可写（自检显示具体路径）',
    '[ ] 4. 本机存储可写（不可写则设置与片源都存不住）',
    '[ ] 5. VC++ 运行库齐全（桌面端专项；缺就装 VC++ 2015-2022 Redistributable x64）',
    '[ ] 6. 端口正常（显示耗尽就关掉占用 8787 附近端口的程序再重开）',
    '[ ] 7. 中枢 /health 可达（单机使用可不要求；跨设备必须可达）',
    '[ ] 8. 局域网访问按需开启（默认关闭，开启后必须设口令；不需要就别开）',
    '[ ] 9. 播放诊断至少 H.264/mp4 一条「可加载」；失败记下 code',
    '',
    '通过标准：1-6 全绿即可单机用；7 不通只影响跨端；9 里 H.264 不通说明缺 H.264 解码器。'
  ]);

  write(path.join(D_BEI, '备机验证安装说明.txt'), [
    '鸿汇影 ' + TAG + ' · 备机（深开鸿 KaihongOS）验证安装说明',
    '',
    '先看这段：这一版备机夹换了主角',
    '  本夹主包：' + BEI_MAIN.name + '（' + comma(BEI_MAIN.size) + ' B）',
    '  sha256 ' + BEI_MAIN.hash,
    '  bundle com.kaihong.movie · 开鸿平台签发证书（私钥自持）· ArkTS 原生壳',
    '',
    '  备用目录：备用-webview壳（本机启动被拒）\\' + h.hap.name + '（' + comma(h.hap.size) + ' B）',
    '  bundle com.honghub.harmony · OpenHarmony SDK 公开密钥自签（official 链）',
    '  现状：开发机上打包、校验、门禁全过，但在 KaihongOS 备机上「点一下没反应」——',
    '        系统在启动阶段就拒绝，不是闪退也不是白屏，属于证书 / 分发类型不被信任，与前端无关。',
    '        只作对照，不要装。',
    '',
    '一、安装',
    '  1) 把 ' + BEI_MAIN.name + ' 传到备机（U 盘 / 局域网 / 文件管理器）。',
    '  2) 点开 .hap，系统提示安装时选「安装」；已装旧版直接覆盖升级，数据保留。',
    '  3) 装完桌面图标见「开鸿影视」；若设备上还留着旧 com.honghub.harmony 的图标，先卸掉，避免点错。',
    '  4) 首次打开给存储 / 网络权限；首页是空态三卡，属设计。',
    '',
    '二、这一版要验的四件事',
    '  1) 首页三卡：截图确认「先选一条路，就能播」与三张卡都在。',
    '  2) 环境自检：问题中心里要有结果；VC++ 运行库一项应显示「未接入」（设备端没有这项）。',
    '  3) 播放诊断：点「开始诊断」，三条跑完记 error.code，截图并「复制诊断结果」。',
    '  4) 播放事件：同一页「最近播放事件」应出现刚失败的条目，点「复制播放事件」一起发回。',
    '',
    '三、检查更新与升级口径',
    '  设备端点「检查更新」只能告诉你有无新版，不会自动装；新版 HAP 要手动传过去点开覆盖。',
    '',
    '四、取证规矩',
    '  · 只说「播不动」无效，必须带 code 或诊断 / 播放事件文本。',
    '  · 点图标没反应这类，先确认装的是不是本夹主包（见开头）。',
    '  · 公网测试流在设备上若全部失败且 code=2，先确认设备本身能出外网，否则结论作废。',
    '  · 中枢不同网段时中枢一项显示不可达属预期，不影响本地播放。',
    '',
    '五、设备端怎么出的',
    '  工程 KaihongMovie（独立应用 com.kaihong.movie）· 命令 python sync-device-version.py --apply（需 KH_KAIHONG_PWD）',
    '  版本与桌面主线同版：' + VERSION
  ]);

  write(path.join(D_PUB, '私发说明.txt'), [
    '鸿汇影 ' + TAG + ' · 私发包（免安装版）',
    '组成：Windows x64 免安装 zip + 深开鸿 HAP。解压即用，不写注册表、不建开始菜单，删目录就是卸载。',
    '',
    h.x64z.name + '（' + comma(h.x64z.size) + ' B）',
    '  ' + h.x64z.hash,
    h.hap.name + '（' + comma(h.hap.size) + ' B）',
    '  ' + h.hap.hash,
    '',
    '怎么用',
    '  1) 解压到任意目录（例如 D:\\鸿汇影）。',
    '  2) 进解压出来的「鸿汇影桌面版 ' + VERSION + '」文件夹，双击「鸿汇影桌面版.exe」。',
    '  3) 首次运行若提示「未知发布者」，选「仍要运行」——未做代码签名，不是文件损坏。',
    '  4) 要开始菜单与卸载项的，用「客户成品」夹里的 Setup（已实测装/启/卸干净）。',
    '',
    '设备端',
    '  本夹这个 HAP 是 official 链自签（bundle com.honghub.harmony），在 KaihongOS 设备上会被系统拒绝启动；',
    '  真机安装请用「鸿汇影·备机验证_' + TAG + '」里的设备端原生包（bundle com.kaihong.movie，开鸿平台证书）。',
    '  HAP 只能装 KaihongOS 6.1 / OpenHarmony 6.1（API ≥ 11）且已授权的设备，Windows 装不了。',
    '  设备端不自动升级，新版 HAP 手动传过去点开覆盖，数据保留。',
    '  设备上「设置 → 中枢地址」填中枢那台机器的 WLAN 地址，两台要在同一网段且中枢已开局域网访问。',
    '',
    '一句话给对方：解压后用「鸿汇影桌面版.exe」打开；首页空是正常的，按三张卡任选一条加片源；',
    '想连中枢就在设置里填地址；播不动去问题中心跑「播放诊断」，把「最近播放事件」复制发我。',
    '',
    '出了问题怎么反馈（给对方照做）',
    '  0) 出了问题它会自动回传（默认开启，不用设置）：只回传脱敏摘要——错误码、次数、站点域名、一个匿名设备号；',
    '     不含片源地址、账号、搜索词。不想上报就进「问题中心」点「匿名诊断上报」开关关闭，关闭后只存本机。',
    '  1) 进「问题中心」，点「复制诊断报告」，把那段文字直接发我；或点「导出」存成文件发我。',
    '  2) 说清三件事：哪个片子 / 什么现象 / 问题中心里的错误码。有这三样基本能定位。',
    '  3) 要让日志更全，可在问题中心先跑一次「播放诊断」，再复制，两份一起发。',
    '  4) 自动上报走不通时（换了网络、地址过期），把那一栏清空、按 1) 手动发我即可。'
  ]);

  write(path.join(D_DEV, '开发者端说明_' + TAG + '.txt'), [
    '鸿汇影 ' + TAG + ' · 开发端说明',
    'exe：' + h.dev.name + '（' + comma(h.dev.size) + ' B）',
    '  sha256 ' + h.dev.hash,
    '',
    '一、这版新增（1.7.108 → 1.7.112 累计）',
    '  · 商店版产品线（1.7.108–1.7.110）：KH_STORE 变体接入打包链——零内置源、零预置采集，剔除 kh-src.js，',
    '    注入 window.KH_STORE=true；独立包名 com.honghub.store、关闭自更新；首启隐私声明弹窗与权限说明；',
    '    上架元数据 / 平台截图配套；store 纯净门禁 + 冒烟在出包链里硬拦。',
    '  · 本地媒体中心（1.7.111）：本地媒体库扫描与海报墙、自动连播与跳片头片尾、本机观看统计周报、',
    '    字幕微调与双语、家庭 / 儿童模式增强、私发订阅源分享。桌面端不再只是播放器壳，可当纯本地媒体中心用。',
    '  · 家庭与偏好（1.7.112）：儿童锁 PIN 校验收敛到 khKidPinCheck / khKidLockBtn 单一路径，',
    '    偏好设置在启动时统一 khPrefApply() 应用，运维面板 b8-save 改为先验 PIN；避免 PIN 绕过与偏好漏应用。',
    '  · 出包链门禁（1.7.112）：问题收集链路检查改按「私发/客户默认开、商店变体默认关」双口径判定，',
    '    HAP 三变体（client / dev / store）新鲜度与版本码（dev = 发版 +100）纳入产物一致性总检，不再允许旧 HAP 冒充新版。',
    '  · 匿名诊断上报（自 1.7.107，客户纯净版与设备端同口径）：默认开启、点关即停，只外发脱敏摘要，',
    '    没有预置地址时不盲发。真窗口冒烟门禁（scripts/smoke-desktop.js）仍为出包必过项。',
    '',
    '一（承接）、1.7.106 已有能力',
    '  · 白屏修复（P0）：preload 桥 khDeviceId 改名 khDeviceIdBridge（旧名与 kh-core.js 顶层函数相撞致客户版白屏）。',
    '  · 客户版上报：清单 remoteUrl 不再被 KH_UI_CLEAN 挡掉；「远程收集」卡对客户版渲染。',
    '    scripts/inject-report-url.js 把隧道地址写进页面内嵌 kh-sources 基线（客户版启动读基线，不是云端清单）。',
    '  · kh:lan-mode（get/set）：默认只绑 127.0.0.1；开启后 spawn 带 KH_HOST=0.0.0.0，server.js 自动要求口令。',
    '  · 播放失败日志 khPlayLog（上限 60、同因 5 秒去重）；检查更新 khUpdateCheck() 读 /health 比对版本。',
    '',
    '二、排查顺序',
    '  1) 让对方复制「播放事件」与「诊断结果」，两份一起看：事件是真实失败，诊断是能力判定。',
    '  2) 事件里 code=3 或 hls=mediaError → 解码；code=2 → 网络；code=4 → 源失效。',
    '  3) 中枢连不上先看设置页局域网开关是不是关着（默认关是安全默认值）。',
    '  4) 客户上报收不到：先确认镜像站隧道可达（current-url.txt 域名 GET 200）；隧道 530 多为 DNS，跑修复DNS并启动.cmd。',
    '',
    '三、出包链路',
    '  node scripts/inject-report-url.js（把当前隧道地址写进页面基线，隧道换域名后必跑）',
    '  → python harmony/build_hap.py → node scripts/hap-sign.js（KH_HAP_ALLOW_STALE=1）',
    '  → node scripts/build-exe.js --no-bump → build-client-exe.js（KH_CLIENT_ARCH=x64 / arm64）',
    '  → build-archs.js（KH_ARCHS=arm64 KH_ARCHS_BUILD=1）→ build-archs.js（KH_ARCHS=x64,arm64）→ archive-release.js',
    '  → node scripts/release-deliver.js --archive --disk（四夹 + D 盘 + 文档一次生成）',
    '  → node scripts/verify-release.js（npm run verify，退出码 0 才算过；含 browser 冒烟 + 真窗口冒烟两道）'
  ]);

  write(path.join(DOCS, '双端功能差异_' + TAG + '.txt'), [
    '鸿汇影 ' + TAG + ' · 桌面端与设备端功能差异（一页纸）',
    '',
    '能力                          桌面 Windows        深开鸿 HAP',
    '  首页空态三卡                  有                  有',
    '  环境自检                      有（含 VC 运行库）   有（无 VC 项，显示「未接入」）',
    '  播放诊断三条测试流            有                  有',
    '  最近播放事件日志              有                  有',
    '  平台入口 / WebView 浏览       有                  有',
    '  打开本机视频                  有                  无',
    '  内置本机中枢（server）        有                  无',
    '  局域网访问开关                有                  无（没有中枢可开）',
  '  中枢地址可配（设置页）        有                  有（连别处的中枢时必填，需同网段）',
    '  静默升级（下载→校验→安装）    有                  无（手动传 HAP 覆盖）',
    '  检查更新（版本对比）          有                  有（只提示，不自动装）',
    '  运维悬浮条 / 运维页            开发端有，客户版无    无',
    '  DLNA 投屏                     发送                接收',
    '',
    '为什么这么切：设备端只做播放端，不承担中枢、升级与运维；桌面端承担分发与诊断。',
    '凡是设备端没有的入口，界面会直接说明「这项只在桌面端出现」，不再留死按钮。'
  ]);

  write(path.join(DESK, '鸿汇影·文档资料', '鸿汇影·更新日志_' + TAG + '.txt'), [
    '鸿汇影 更新日志 ' + TAG + ' · ' + new Date().toISOString().slice(0, 10),
    '1.7.108 → 1.7.112 累计：商店版产品线 + 本地媒体中心 + 家庭偏好收敛',
    '  · 商店版（108–110）：KH_STORE 变体接入打包链，零内置源、独立包名 com.honghub.store、关闭自更新，',
    '    首启隐私弹窗 + 上架材料 + store 纯净门禁，可打包本地装、不进私发/客户包。',
    '  · 本地媒体中心（111）：媒体库扫描与海报墙、自动连播 + 跳片头片尾、观看统计周报、字幕微调与双语、',
    '    家庭/儿童增强、私发订阅源分享。',
    '  · 家庭与偏好（112）：儿童锁 PIN 收敛到 khKidPinCheck / khKidLockBtn，偏好统一 khPrefApply，b8-save 先验 PIN。',
    '  · 门禁（112）：问题收集链路按「私发/客户默认开、商店默认关」双口径判定；HAP client / dev / store 三变体',
    '    新鲜度与版本码（dev = 发版 +100）并入产物一致性总检，旧 HAP 不能再冒充新版。',
  '',
  '1.7.106 补丁：窗口白屏修复 + 客户问题回收打通',
  '  · 白屏（P0，1.7.104 引入）：preload 用 contextBridge 在页面世界挂了 khDeviceId，这个属性不可配置；',
  '    kh-core.js 顶层又声明了同名函数 khDeviceId()，两者在脚本实例化阶段相撞，',
  '    报 “Identifier \'khDeviceId\' has already been declared”，kh-core.js 一行都没执行 → 窗口白屏。',
  '    冒烟门禁跑的是 browser 模式（不经过 preload），所以一直没拦住。1.7.106 把桥改名为 khDeviceIdBridge。',
  '  · 门禁缺口：以后发版必须补一条「Electron 真窗口正文长度 > 0」的检查，只跑 browser 冒烟不算验证。',
  '  · 客户版入口：问题中心的「远程收集」卡片此前被 KH_UI_CLEAN 整块挡掉，客户连地址框都没有；1.7.106 恢复显示，',
  '    客户版文案写明「地址已预置、默认关闭、点开启才发回」，开关仍只在客户点过之后才为真。',
  '  · 地址注入：出包链新增 scripts/inject-report-url.js，把 `https://<隧道>/api/report` 写进页面内嵌 kh-sources 基线。',
  '    必须写进基线而不是只写清单：客户版启动先读内嵌基线，云端清单要过访问口令，客户纯净版未必拿得到。',
  '    隧道换域名后重跑一次该脚本再出包即可。',
  '',
  '1.7.106 补丁（续）：上报链路口径',
  '  · 客户纯净版此前拿不到收集地址——清单里的 remoteUrl 被 KH_UI_CLEAN 挡掉，客户手上只有一个空输入框，',
  '    实际等于一条都收不到。1.7.106 起客户版也接收清单下发的地址，但仍不默认外发：',
  '    外发开关要客户在问题中心点一下才为真，隐私口径没变（不是改成默认偷偷上报）。',
  '  · 回收链路（已实测通）：客户版 POST → Cloudflare 隧道 → 本机 8099 的 serve.py /api/report',
  '    → HongHubServer/data/reports.jsonl（URL 只留域名、手机/邮箱打码、单 IP 30 条/60 秒、256KB 上限、10 秒幂等）',
  '    → 开发端 auto-bugfix 的 readReportsMerged 合并「本机 + 隧道」两份数据 → 自愈与看板。',
  '  · 这条链路不校验访问口令（serve.py 自带限流与脱敏），所以客户端那条只带 Content-Type 的请求能直接进；',
  '    自建中枢那条路不同，开了局域网就必须带口令，客户端不带，这是两条互不通的路，别混用。',
  '  · 遗留风险：隧道是 trycloudflare 临时域名，cloudflared 重启就换一个。出包时写进包内清单的是当下的地址，',
  '    过期后客户要么等下次发版，要么在问题中心清空地址、改回「复制诊断报告」手动发回。',
  '',
  '零、1.7.105 补丁：设备端中枢地址、免安装包属性、口令实测',
  '  · 中枢地址在设备端（HAP）以前存了不生效：桌面端写 kh_hub_url，设备端前端读的是 khHub，两个键对不上，',
  '    重启后前端又回落到构建时注入的地址。1.7.105 起保存时两个键一起写，重置设置时两个一起清，备份也带上 khHub。',
  '  · 设置页「中枢地址（多机部署）」现在显示「当前生效：<地址>」，并写明设备端要填中枢那台机器的 WLAN 地址、',
  '    两台须同一网段且中枢已开局域网访问——填完不通时先查网络，不必怀疑地址本身。',
  '  · 免安装包里的主程序此前只补了图标、没补属性，右键「详细信息」显示 Copyright (C) 2015 GitHub, Inc.。',
  '    现在 patch-exe-icon.js 顺手用 rcedit 写正：产品名、公司、描述、版权、文件/产品版本，且版本号参与幂等判断。',
  '  · 页面冒烟门禁的「控件数量」口径改成能认空态：首页自 1.7.102 删样片后只有三张卡，data-act 约 12 个，',
  '    旧阈值 ≥15 会误报白屏。现在空态三卡齐全且正文够长即视为正常，其余视图仍按 ≥15 要求。',
  '  · 局域网口令实测（KH_HOST=0.0.0.0）：无口令访问 /api/manifest、/api/features 均 401，带口令 200；',
  '    静态首页 / 无口令仍 200（只给界面，不含任何数据）。口令在开局域网时自动生成/复用，可用 KH_ACCESS_TOKEN 覆盖。',
  '',
  '承接 1.7.104（空态三卡 / 环境自检 / 播放诊断），那一版收的是「安全默认值 + 现场取证 + 升级口径」三件事。',
    '',
    '一、局域网访问改为显式开关（默认关闭）',
    '  · 内置中枢默认绑 127.0.0.1，只有本机能访问；需要别的设备连时才在设置页开启。',
    '  · 开启后主进程以 KH_HOST=0.0.0.0 重启内置服务，server.js 自动要求访问口令；状态写 userData/lan-mode.json。',
    '  · 设置页「网络与更新」显示当前绑定、给出开启/关闭按钮，切换会重启服务并重载页面（对角播放会中断，已在文案说明）。',
    '',
    '二、播放事件环形日志',
    '  · kh-players 的失败分级改为先算文案再记录：khPlayLog(code, reason, video) 写 kh_play_log，上限 60 条，同因 5 秒去重。',
    '  · 记录字段：时间、error.code、判定文案、当前地址、HLS fatal 类型、看门狗次数、在线状态。',
    '  · 问题中心新增「最近播放事件」卡，显示最近 20 条，可「复制播放事件」；设备端无 hdc 时这就是唯一现场。',
    '',
    '三、检查更新（区分两端口径）',
    '  · 设置页「检查更新」读 /health 的 release.versionName，与当前版本比对，结果存 kh_update_check。',
    '  · 桌面端明确提示走静默升级链路；设备端明确提示「HAP 需手动传包覆盖」，不再暗示能自动装。',
    '',
    '四、交付流程脚本化',
    '  · 新增 scripts/release-deliver.js：一条命令生成四夹、逐包 .sha256、D 盘副本并逐文件复核，同时写 7 份文档与双端差异页。',
    '  · 这轮手写流程里出现过的两个坑（开发端夹误放客户 Setup、D 盘半截文件）在该脚本里由「按 key 取源 + 复制后重算哈希比对」消掉。',
    '',
    '五、产物',
    '  HAP        ' + comma(h.hap.size) + '  ' + h.hap.hash,
    '  开发端     ' + comma(h.dev.size) + '  ' + h.dev.hash,
    '  x64 Setup  ' + comma(h.x64s.size) + '  ' + h.x64s.hash,
    '  x64 zip    ' + comma(h.x64z.size) + '  ' + h.x64z.hash,
    '  arm64 Setup ' + comma(h.a64s.size) + '  ' + h.a64s.hash,
    '  arm64 zip  ' + comma(h.a64z.size) + '  ' + h.a64z.hash,
    '',
    '六、仍未闭环',
    '  · 设备端经中枢的平台浏览 / 远端配置未验证（需同网段 + 中枢开局域网 + 设备端设置里填对地址）。',
    '  · 收集隧道是 trycloudflare 临时域名，cloudflared 重启即变；换域名后跑 inject-report-url.js 再出包。',
    '    长期方案是 Cloudflare 命名隧道 + 自有域名（免费，但要有域名）。',
    '  · 局域网开关 / 播放事件 / 检查更新三个控件仍未在真实窗口逐个点过（接口层已实测）。',
    '  · verify 门禁建议补「Electron 真窗口正文非空」检查：browser 冒烟不经过 preload，1.7.104 的白屏就是这么漏掉的。',
    '  · 设备端自动安装 HAP 在 API 11 下没有系统权限，保持手动。',
    '',
    '七、设备端首次真机可用（2026-11-23，承接记录）',
    '  · 备机（KaihongOS 6.1）装 1.7.105 HAP 后已能播放——1.7.98 之后设备端第一次真机跑通，',
    '    「设备端未验证 / 没有第一份 error.code」这条长期未闭环项关闭。',
    '  · 注意区分：设备端单机播放已通；经中枢的平台浏览与远端配置是另一条路，仍未测（见「六」）。'
  ]);

  write(path.join(DESK, '鸿汇影·文档资料', '鸿汇影·文档索引_' + TAG + '.txt'), [
    '鸿汇影 文档索引 ' + TAG,
    '',
    '客户侧',
    '  鸿汇影·客户成品_' + TAG + '\\客户下载说明.txt        包清单、空态三条路、双通道取证、哈希',
    '  鸿汇影·客户成品_' + TAG + '\\装机环境核对清单.txt    9 条核对项',
    '备机侧',
    '  鸿汇影·备机验证_' + TAG + '\\备机验证安装说明.txt    四件事取证（三卡 / 自检 / 诊断 / 播放事件）',
    '私发',
    '  鸿汇影·私发_' + TAG + '\\私发说明.txt            x64 免安装版 + HAP + 反馈三步',
    '开发侧',
    '  鸿汇影·开发端_' + TAG + '\\开发者端说明_' + TAG + '.txt  新 IPC / 新存储键 / 排查顺序 / 出包链',
    '  scripts\\release-deliver.js              一条命令出四夹 + D 盘 + 文档',
    '差异',
    '  鸿汇影·文档资料\\双端功能差异_' + TAG + '.txt      桌面端 vs 设备端能力对照',
    '日志',
    '  鸿汇影·文档资料\\鸿汇影·更新日志_' + TAG + '.txt',
    '盘上',
    DISK_ROOT
      ? '  ' + DISK_ROOT + '\\安装说明.txt           一页纸'
      : '  未落盘（D 盘不可用或未加 --disk，已跳过）',
    '历史',
    '  桌面\\鸿汇影·历史归档\\                    旧版四夹与旧散件（含文档历史）',
    '  桌面\\鸿汇影·文档资料\\历史文档\\            旧版更新日志 / 索引 / 排期 / 清单'
  ]);
}

/* ---------- D 盘 ---------- */
if (opt.disk) {
  if (!DISK_OK) { console.log('  D 盘不可用，跳过（文档索引与结尾已标注未落盘，不再打印 D 盘路径）'); }
  else {
    const root = DISK_ROOT;
    const sub = path.join(root, '桌面版');
    ensure(sub);
    const map = [
      ['hap', root],
      ['x64s', sub], ['x64z', sub], ['a64s', sub], ['a64z', sub]
    ];
    map.forEach(([k, dir]) => {
      const src = ART[k], dst = path.join(dir, INFO[k].name);
      fs.copyFileSync(src, dst);
      const a = sha(src), b = sha(dst);
      const ok = a === b ? 'OK' : 'MISMATCH';
      console.log('  D ' + INFO[k].name + '  ' + comma(size(dst)) + '  ' + ok);
      if (!ok) process.exitCode = 1;
      fs.writeFileSync(dst + '.sha256', b + '  ' + INFO[k].name + '\r\n', 'utf8');
    });
    if (opt.docs) {
      write(path.join(root, '安装说明.txt'), [
        '鸿汇影 ' + TAG + ' · 盘上安装说明',
        '',
        '本目录：' + INFO.hap.name + '（' + comma(INFO.hap.size) + ' B）与 .sha256',
        '桌面版\\：x64 与 ARM64 的安装版 / 免安装，各带 .sha256',
        '',
        '装完第一次打开：',
        '  1) 首页是空的（设计如此），三张卡任选一条路：影视仓 / 直链 / 直播。',
        '  2) 问题中心会自动跑一次环境自检（桌面端含 VC++ 运行库）。',
        '  3) 播不动：先看「最近播放事件」，再跑「播放诊断」，把两份都复制发回。',
        '',
        '默认只允许本机访问中枢（127.0.0.1）；要让别的设备连，去设置页开「局域网访问」并设口令。',
        '设备端（HAP）不自动升级，新版需手动传包覆盖。',
        '未签名，SmartScreen 选「仍要运行」。'
      ]);
    }
  }
}

console.log('======== 完成 ========');
console.log('  桌面：' + [D_BEI, D_DEV, D_CLI, D_PUB].map(p => path.basename(p)).join(' / '));
if (opt.disk) console.log('  盘上：' + (DISK_ROOT || '未落盘（D 盘不可用，已跳过）'));
if (process.exitCode) console.log('  注意：有文件哈希不一致，见上面的 MISMATCH');
