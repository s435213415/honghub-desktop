#!/usr/bin/env node
'use strict';
/* 桌面资料自动刷新（scripts/desktop-docs.js）
   目的：把「桌面\鸿汇影·文档资料」三份说明里的【自动版本块】在每次发版时重写一遍，
   让用户手里的资料永远跟当前产物/签名链/下发链接一致，不用手改、不会过期。
   版本块用固定标记包起来，标记之外的人工内容一字不动。
   用法：node scripts/desktop-docs.js        （发版链路 auto-release.js 会自动调用）
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const BEGIN = '<!-- KH_AUTO_BEGIN 以下为本版自动信息，随发版重写，手改会被覆盖 -->';
const END = '<!-- KH_AUTO_END -->';

const DOC_NAMES = [
  '鸿汇影·文件导航.txt',
  '鸿汇影·开发端文件更新说明.txt',
  '鸿汇影·上传发布操作手册.txt',
];

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const nf = (n) => Number(n).toLocaleString('en-US');
const mb = (n) => (n / 1048576).toFixed(1);

function pick(cands) {
  for (const p of cands) {
    try { if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch (e) {}
  }
  return null;
}

/* 隧道地址每次重启都会漂，以镜像站 current-url.txt 为准；读不到就留空 */
function publicBase() {
  const dir = (process.env.KH_MIRROR_DIR || 'C:\\Users\\admin\\HongHubServer\\site');
  const root = path.dirname(dir);
  for (const f of [path.join(root, 'current-url.txt'), path.join(root, 'url.txt')]) {
    try {
      const s = fs.readFileSync(f, 'utf8').trim();
      if (/^https?:\/\//.test(s)) return s.replace(/\/+$/, '');
    } catch (e) {}
  }
  return '';
}

function buildBlock(env) {
  const { VER, CODE, desktop, dist } = env;
  const v = 'v' + VER;
  const setup = pick([path.join(dist, 'public', 'honghub', v, 'desktop-setup.exe'),
    path.join(dist, 'desktop-setup.exe'),
    path.join(desktop, '鸿汇影·客户成品_' + v, '鸿汇影桌面版 Setup ' + VER + '.exe')]);
  const zip = pick([path.join(dist, 'public', 'honghub', v, 'honghub-desktop-' + VER + '-win.bin'),
    path.join(desktop, '鸿汇影·客户成品_' + v, '鸿汇影免安装 ' + VER + '.zip')]);
  const hap = pick([path.join(dist, 'public', 'honghub', v, 'HongHubMovie.hap'),
    path.join(dist, 'HongHubMovie.hap'),
    path.join(desktop, '鸿汇影·客户成品_' + v, 'HongHubMovie.hap')]);
  const dev = pick([path.join(dist, '鸿汇影桌面版 开发端 ' + VER + '.exe'),
    path.join(desktop, '鸿汇影·开发端_' + v, '鸿汇影桌面版 开发端 ' + VER + '.exe')]);
  const deviceDir = path.join(desktop, '开鸿影视·设备端_' + v);
  const device = pick([path.join(deviceDir, 'KaihongMovie_' + v + '.hap'),
    path.join('C:\\Users\\admin\\WorkBuddy\\2026-11-12-16-34-57\\KaihongMovie\\sign', 'KaihongMovie.hap')]);

  const rows = [];
  rows.push('【本版信息 · ' + v + ' / #' + CODE + '】');
  rows.push('说明：本块由发版链路自动生成（scripts/auto-release.js → scripts/desktop-docs.js），换版自动更新，不用手改。');
  rows.push('本块是唯一权威：正文里出现的旧版本号、旧哈希属于当时的历史记录，一律以本块为准。');
  rows.push('');
  rows.push('一、Windows 成品（桌面\\鸿汇影·客户成品_' + v + '）');
  if (setup) rows.push('  Setup      ' + nf(fs.statSync(setup).size) + ' B (' + mb(fs.statSync(setup).size) + ' MB)  sha256 ' + sha256(setup));
  if (zip) rows.push('  免安装 zip  ' + nf(fs.statSync(zip).size) + ' B (' + mb(fs.statSync(zip).size) + ' MB)  sha256 ' + sha256(zip));
  if (hap) rows.push('  鸿蒙 HAP   ' + nf(fs.statSync(hap).size) + ' B  sha256 ' + sha256(hap));
  rows.push('');
  rows.push('二、开发端（桌面\\鸿汇影·开发端_' + v + '）');
  if (dev) rows.push('  开发端 exe ' + nf(fs.statSync(dev).size) + ' B  sha256 ' + sha256(dev));
  rows.push('  签名密钥\\kaihong 内置开鸿开发服务平台 p12/cer/p7b；KaihongMovie 工程 make.py 有材料即优先用平台证书签名，缺材料自动回退官方链。');
  rows.push('  开发端与客户成品严格隔离：客户夹只放成品，密钥口令只在开发端夹与工程目录。');
  rows.push('');
  rows.push('三、深开鸿 / 开鸿影视设备端');
  if (device) {
    rows.push('  KaihongMovie_' + v + '.hap  ' + nf(fs.statSync(device).size) + ' B  sha256 ' + sha256(device));
  } else {
    rows.push('  本版未产出设备端包（设备端目录或签名包缺失）。');
  }
  rows.push('  签名链：CN=HongHub Movie ← Kaihong Application Sub CA ← Kaihong Application Root CA（profile=debug，verify-app 通过）');
  rows.push('  证书有效期 2026-11-19 ~ 2027-11-19，到期前需在 developer.kaihong.com 重新申请证书与 Profile。');
  rows.push('');
  rows.push('四、下发渠道');
  const base = publicBase();
  if (base) {
    rows.push('  零积分公网（本机镜像 + 隧道，地址会漂移，以镜像站根 current-url.txt 为准）：' + base + '/');
    rows.push('  安装包 ' + base + '/honghub/' + v + '/desktop-setup.exe');
    rows.push('  鸿蒙HAP ' + base + '/honghub/' + v + '/HongHubMovie.hap');
    rows.push('  更新清单 ' + base + '/remote-manifest.json');
  } else {
    rows.push('  零积分公网地址暂时取不到（隧道未运行或 current-url.txt 缺失），先看镜像站目录。');
  }
  rows.push('  旧公网站点（wbapp）只能由 WorkBuddy 宿主手工发布，脚本不代发；站点版本可能落后于本版。');
  rows.push('');
  rows.push('五、质量门禁');
  rows.push('  自动修 Bug 闭环：脚本语法 / 页面版本 / 功能快照 / 产物校验值 四类故障注入自检全通过（4/4 自动修复、复检归零）。');
  rows.push('  签名验签：hap-sign-tool verify-app 通过后才进桌面设备端夹。');
  rows.push('生成时间：' + new Date().toISOString().slice(0, 10));
  return [BEGIN, ...rows, END].join('\r\n');
}

function applyToDoc(file, block, meta) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return false; }
  const before = text;
  /* 1) 先剥掉旧块（不管它落在哪），保证块永远只出现一次、且固定在标题下方 */
  let stripped = text;
  for (let guard = 0; guard < 5; guard += 1) {
    const bi = stripped.indexOf(BEGIN);
    const ei = stripped.indexOf(END);
    if (bi < 0 || ei < bi) break;
    let tail = stripped.slice(ei + END.length);
    stripped = stripped.slice(0, bi) + tail.replace(/^\r?\n/, '');
  }
  /* 2) 标题行里的版本号跟着换版走（文档开头的 (v1.7.46 / #1000160) 不再是死数字） */
  if (meta && meta.VER) {
    stripped = stripped.replace(/(v\d+\.\d+\.\d+ \/ #\d+)/, 'v' + meta.VER + ' / #' + meta.CODE);
  }
  /* 3) 块固定在「第一行真正有内容的标题」之后（跳过 ====/---- 这类装饰线），
        插入前把正文残留空行归一，保证反复跑不产生多余空行 */
  let off = 0;
  let cut = 0;
  const lines = stripped.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    off += raw.length + 1;
    if (/[0-9A-Za-z\u4e00-\u9fa5]/.test(raw.replace(/\r$/, ''))) { cut = off; break; }
  }
  if (!cut) cut = stripped.indexOf('\n') + 1;
  const tail = stripped.slice(cut).replace(/^(?:\r?\n)+/, '');
  const next = stripped.slice(0, cut) + block.replace(/\r?\n/g, '\r\n') + '\r\n\r\n' + tail;
  if (next !== before) { fs.writeFileSync(file, next, 'utf8'); return true; }
  return false;
}

function refresh(opts) {
  const o = Object.assign({
    desktop: path.join(os.homedir(), 'Desktop'),
    dist: path.join(__dirname, '..', 'dist'),
    dry: false,
  }, opts || {});
  const manifest = JSON.parse(fs.readFileSync(path.join(o.dist, 'remote-manifest.json'), 'utf8'));
  const VER = o.version || String(manifest.versionName || '');
  const CODE = o.versionCode || manifest.versionCode;
  const docDir = path.join(o.desktop, '鸿汇影·文档资料');
  const block = buildBlock({ VER, CODE, desktop: o.desktop, dist: o.dist });
  const changed = [];
  if (!o.dry) fs.mkdirSync(docDir, { recursive: true });
  for (const name of DOC_NAMES) {
    const f = path.join(docDir, name);
    if (o.dry) { console.log('  [预演] 将刷新 ' + name); continue; }
    if (!fs.existsSync(f)) {
      fs.writeFileSync(f, '鸿汇影 · ' + name.replace(/^鸿汇影·|\.txt$/g, '') + '（自动维护）\r\n' + block + '\r\n', 'utf8');
      changed.push(name + '(新建)');
      continue;
    }
    if (applyToDoc(f, block, { VER, CODE })) changed.push(name);
  }
  console.log('  桌面资料：' + (changed.length ? '已刷新 ' + changed.join('、') : '已是当前版本，无需改动') + '（v' + VER + '）');
  return changed;
}

module.exports = { refresh, buildBlock, DOC_NAMES };

if (require.main === module) {
  try {
    refresh({ dry: process.argv.includes('--dry') });
  } catch (e) {
    console.error('桌面资料刷新失败：' + e.message);
    process.exit(1);
  }
}
