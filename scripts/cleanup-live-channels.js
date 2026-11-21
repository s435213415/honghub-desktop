/* 直播清单治理（一次性，可复跑）：
   - 下线「一源多名」凑数台与重复镜像（无独立可信源，避免台名与画面不符）；
   - 下线内置表不存在、且本机实测整台不可达的死条目；
   - 回写 manifest.sources.channels，同步 count/sourceCount，重建页面 kh-sources 基线。
   规则用明确 id 黑名单，不做 URL 模糊匹配，避免误删。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MAN = path.join(ROOT, 'server/manifest.json');
const PAGE = path.join(ROOT, 'app/index.html');

/* 凑数台：与主台共用同一条流，无独立源 */
const DUP = new Set([
  'cn066', 'cn067',           // 与 cn064 五星体育共用 aspor
  'cn073', 'cn077',           // 与 cn023/cn102 东方卫视共用 bestv 148/3
  'cn093', 'cn094',           // 与 cn091 MTV 共用 akamai 7XPunjabi
  'cn097', 'cn099',           // 旅游/美食，与 cn096/cn100 交叉共用
  'cn098', 'cn100',           // 时尚生活/汽车，无独立源
  'net001', 'net004', 'net005' // 与 cn028/cn004/cn010 重复镜像
]);
/* 死条目坏台：内置表无对应 id，本机实测整台不可达（域名失败/403/超时） */
const DEAD = new Set([
  'cn007',
  'cn022', 'cn023', 'cn024', 'cn025', 'cn026', 'cn027', 'cn029', 'cn030',
  'cn031', 'cn032', 'cn033', 'cn034', 'cn035', 'cn036', 'cn038', 'cn039',
  'cn041', 'cn042', 'cn043', 'cn047', 'cn048', 'cn049', 'net002'
]);
const DROP = new Set([...DUP, ...DEAD]);

const man = JSON.parse(fs.readFileSync(MAN, 'utf8'));
const before = man.sources.channels.length;
const kept = [];
const dropped = [];
for (const c of man.sources.channels) {
  if (DROP.has(c.id)) { dropped.push(c.id + ' ' + c.name); continue; }
  kept.push(c);
}
man.sources.channels = kept;
man.sources.count = kept.length;
man.sources.channelCount = kept.length;
kept.forEach(c => { c.sourceCount = (c.sources || []).length; });
fs.writeFileSync(MAN, JSON.stringify(man, null, 2));

// 重建 kh-sources 基线（保留 sites/searchTpl/quick/remoteUrl/note）
let html = fs.readFileSync(PAGE, 'utf8');
const oldMatch = html.match(/<script id="kh-sources" type="application\/json">([\s\S]*?)<\/script>/);
if (!oldMatch) throw new Error('页面缺少 kh-sources 块');
const old = JSON.parse(oldMatch[1]);
const block = {
  v: (man.sources.v || 23),
  updatedAt: new Date().toISOString(),
  count: kept.length,
  channels: kept.map(c => ({ id: c.id, name: c.name, group: c.group, sources: c.sources })),
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

console.log('下线 ' + dropped.length + ' 条：');
dropped.forEach(d => console.log('  - ' + d));
console.log('\nmanifest 频道 ' + before + ' → ' + kept.length + ' · kh-sources 基线已重建 v' + block.v);
