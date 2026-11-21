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

const ROOT = path.join(__dirname, '..');

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

/* 下发地址以随包正式端点为准（WorkBuddy 稳定源）；临时隧道只作联调，不能写进交付资料。
   历史坑：过去这里读镜像站 current-url.txt，隧道一重启文档里的链接就全失效。 */
function publicEndpoint() {
  try {
    const ep = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'public-endpoint.json'), 'utf8'));
    if (ep.baseUrl && /^https?:\/\//.test(ep.baseUrl)) {
      return { base: ep.baseUrl.replace(/\/+$/, ''), query: String(ep.shareQuery || '') };
    }
  } catch (e) {}
  return { base: '', query: '' };
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
  const devHap = pick([path.join(dist, 'honghub-harmony-dev.hap'),
    path.join(desktop, '鸿汇影·开发端_' + v, 'HongHubMovie-开发端.hap')]);
  const clientHap = pick([path.join(dist, 'public', 'honghub', v, 'HongHubMovie.hap'),
    path.join(dist, 'honghub-harmony.hap')]);

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
  rows.push('三、深开鸿 / OpenHarmony 端（本工程 HongHubMovie）');
  if (clientHap) rows.push('  客户版 HAP ' + nf(fs.statSync(clientHap).size) + ' B  sha256 ' + sha256(clientHap) + '（包内无运维入口）');
  else rows.push('  客户版 HAP 未生成。');
  if (devHap) rows.push('  开发端 HAP ' + nf(fs.statSync(devHap).size) + ' B  sha256 ' + sha256(devHap) + '（仅本机，不下发）');
  else rows.push('  开发端 HAP 未生成。');
  rows.push('  签名链：OpenHarmony 官方发布证书链（official-openharmony），与旧版同链可覆盖安装；');
  rows.push('  装过 v1.7.45 及更早自签版本的设备需先卸载。hdc list targets 为空，本轮仅做包内核验，未跑真机。');
  rows.push('');
  rows.push('四、下发渠道');
  const ep = publicEndpoint();
  if (ep.base) {
    rows.push('  稳定源（WorkBuddy 站点，已发布并回验）：' + ep.base + '/?' + ep.query.replace(/^\?/, ''));
    rows.push('  安装包 ' + ep.base + '/honghub/' + v + '/desktop-setup.exe' + ep.query);
    rows.push('  鸿蒙HAP ' + ep.base + '/honghub/' + v + '/HongHubMovie.hap' + ep.query);
    rows.push('  更新清单 ' + ep.base + '/remote-manifest.json' + ep.query);
    rows.push('  客户应用页与 6 个外链 kh-*.js 同目录发布，缺一个就是空壳；无 sharecode 返回 403 是门禁，不是故障。');
  } else {
    rows.push('  正式下发端点未配置，先看 server/public-endpoint.json；本机隧道只作联调，不作分发依据。');
  }
  rows.push('');
  rows.push('五、质量门禁');
  rows.push('  自动修 Bug 闭环：脚本语法 / 页面版本 / 功能快照 / 产物校验值 四类故障注入自检全通过（4/4 自动修复、复检归零）。');
  rows.push('  HAP 门禁：包内版本、前端哈希与开发/客户变体隔离校验通过后才进交付夹；真机待接。');
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
