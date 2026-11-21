/* 修两件事：
   ① 合并新增卫视时，数组最后一个元素后面少了逗号（JS 语法错误）→ 补上；
   ② 页面里的 kh-sources 内嵌数据块还停在 v21 / 76 频道 / 144 平台 → 按 manifest 重建成
      v23 / 94 频道 / 204 平台（这是运行时真正读的数据，不重建等于白加）。
   保留原有 searchTpl / quick / remoteUrl / note 字段不动。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'app/index.html');
const MAN = path.join(ROOT, 'server/manifest.json');

let html = fs.readFileSync(PAGE, 'utf8');
const man = JSON.parse(fs.readFileSync(MAN, 'utf8'));

// ① 补逗号：只在"上一条没有逗号却紧跟新条目"时动手（页面是 CRLF，两个换行符都要考虑）
html = html.replace(/\}(\r?\n  \{id:"cn1\d\d")/g, '},$1');

// ② 重建 kh-sources
const oldMatch = html.match(/<script id="kh-sources" type="application\/json">([\s\S]*?)<\/script>/);
if (!oldMatch) throw new Error('页面缺少 kh-sources 块');
const old = JSON.parse(oldMatch[1]);
const block = {
  // 历史脚本固定写 23；现网源清单已到 v41，硬写会把客户端源版本倒退，
  // 导致「自动更新」误判为旧清单。保留已发布版本，必要时再往上走。
  v: Math.max(Number(old.v) || 0, 23),
  updatedAt: new Date().toISOString(),
  count: man.sources.channels.length,
  channels: man.sources.channels.map((c) => ({ id: c.id, name: c.name, group: c.group, sources: c.sources })),
  sites: man.sources.sites,
  searchTpl: (man.sources.searchTpl && Object.keys(man.sources.searchTpl).length) ? man.sources.searchTpl : (old.searchTpl || {}),
  quick: old.quick || {},
  remoteUrl: old.remoteUrl || '',
  siteCount: man.sources.sites.length,
  verifiedAt: new Date().toISOString().slice(0, 10),
  missing: man.sources.missing || [],
  note: old.note || ''
};
html = html.slice(0, oldMatch.index) +
  '<script id="kh-sources" type="application/json">' + JSON.stringify(block) + '</script>' +
  html.slice(oldMatch.index + oldMatch[0].length);
fs.writeFileSync(PAGE, html);

// ③ 自检：两段都能解析才算修好
// 页面已拆成外链版：LIVE_CHANNELS / LIVE_STATUS 迁到 kh-config.js，
// 不能再假设它们还内嵌在 index.html 里（2026-11-21 发版流水线在此崩过）。
const h2 = fs.readFileSync(PAGE, 'utf8');
const cfgPath = path.join(ROOT, 'app/kh-config.js');
const h3 = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : '';
function findDecl(re) {
  const inPage = h2.match(re);
  if (inPage) return inPage[0];
  const inCfg = h3.match(re);
  if (inCfg) return inCfg[0];
  throw new Error('找不到直播变量声明：' + re);
}
const ch = findDecl(/var LIVE_CHANNELS = \[[\s\S]*?\n\];/);
const st = findDecl(/var LIVE_STATUS = [\s\S]*?;/);
try {
  const arr = new Function('var EPG_NEWS=[];var EPG_DOC=[];' + ch + '; return LIVE_CHANNELS;')();
  console.log('LIVE_CHANNELS 可解析 · ' + arr.length + ' 个频道');
} catch (e) {
  console.log('LIVE_CHANNELS 仍有语法错误：' + e.message);
  process.exit(1);
}
try {
  const obj = new Function(st + '; return LIVE_STATUS;')();
  console.log('LIVE_STATUS 可解析 · ' + Object.keys(obj).length + ' 个键');
} catch (e) {
  console.log('LIVE_STATUS 语法错误：' + e.message);
  process.exit(1);
}
console.log('kh-sources 重建：v' + block.v + ' · ' + block.count + ' 频道 · ' + block.siteCount + ' 平台');
