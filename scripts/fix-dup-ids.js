/* 修复历史遗留的重复频道 id：同一 id 出现多次时，除第一条外全部改成新 id（x 段递增）。
   同步：页面 LIVE_CHANNELS → LIVE_STATUS 重建 → manifest.sources.channels → kh-sources 重建。
   命名按「同 id 内的出现顺序」对应，改完校验 id 唯一。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'app/index.html');
const MAN = path.join(ROOT, 'server/manifest.json');

let html = fs.readFileSync(PAGE, 'utf8');
const man = JSON.parse(fs.readFileSync(MAN, 'utf8'));

// ① 页面逐行改 id
const lines = html.split('\n');
const seen = {};
let maxX = 0;
for (const l of lines) {
  const m = l.match(/\{id:"(x\d+)"/);
  if (m) maxX = Math.max(maxX, Number(m[1].slice(1)));
}
let nextX = maxX + 1;
const renameLog = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/\{id:"([^"]+)"/);
  if (!m) continue;
  const id = m[1];
  if (!/^(x|cn)\d+$/.test(id)) continue;
  seen[id] = (seen[id] || 0) + 1;
  if (seen[id] === 1) continue;
  const newId = 'x' + String(nextX++).padStart(3, '0');
  lines[i] = lines[i].replace('{id:"' + id + '"', '{id:"' + newId + '"');
  renameLog.push([id, newId, lines[i].match(/name:"([^"]+)"/)[1]]);
}
html = lines.join('\n');

// ② 同步 manifest（按出现顺序逐条改）
const seenM = {};
let mi = 0;
for (const c of man.sources.channels) {
  seenM[c.id] = (seenM[c.id] || 0) + 1;
  if (seenM[c.id] === 1) continue;
  const hit = renameLog.find((r, idx) => r[0] === c.id && r[2] === c.name);
  if (hit) c.id = hit[1];
  mi++;
}

// ③ 重建 LIVE_STATUS：只保留页面上真实存在的 id，实测均可用 → 全 true
const chMatch = html.match(/var LIVE_CHANNELS = \[[\s\S]*?\n\];/);
const arr = new Function('var EPG_NEWS=[];var EPG_DOC=[];var EPG_KIDS=[];' + chMatch[0] + '; return LIVE_CHANNELS;')();
const st = {};
for (const c of arr) st[c.id] = true;
html = html.replace(/var LIVE_STATUS = \{[\s\S]*?\};/, 'var LIVE_STATUS = ' + JSON.stringify(st) + ';');

// ④ 重建 kh-sources
const oldMatch = html.match(/<script id="kh-sources" type="application\/json">([\s\S]*?)<\/script>/);
const old = JSON.parse(oldMatch[1]);
const block = {
  v: 23,
  updatedAt: new Date().toISOString(),
  count: man.sources.channels.length,
  channels: man.sources.channels.map((c) => ({ id: c.id, name: c.name, group: c.group, sources: c.sources })),
  sites: man.sources.sites,
  searchTpl: old.searchTpl || {},
  quick: old.quick || {},
  remoteUrl: old.remoteUrl || '',
  siteCount: man.sources.sites.length,
  verifiedAt: new Date().toISOString().slice(0, 10),
  missing: man.sources.missing || [],
  note: old.note || ''
};
html = html.slice(0, oldMatch.index) + '<script id="kh-sources" type="application/json">' +
  JSON.stringify(block) + '</script>' + html.slice(oldMatch.index + oldMatch[0].length);

fs.writeFileSync(PAGE, html);
man.sources.count = man.sources.channels.length;
man.sources.channelCount = man.sources.channels.length;
fs.writeFileSync(MAN, JSON.stringify(man, null, 2) + '\n');

// ⑤ 校验
const h2 = fs.readFileSync(PAGE, 'utf8');
const a2 = new Function('var EPG_NEWS=[];var EPG_DOC=[];var EPG_KIDS=[];' +
  h2.match(/var LIVE_CHANNELS = \[[\s\S]*?\n\];/)[0] + '; return LIVE_CHANNELS;')();
const uniq = new Set(a2.map((c) => c.id));
console.log('改名 ' + renameLog.length + ' 条：' + renameLog.map((r) => r[0] + '→' + r[1]).join(' '));
console.log('页面条目 ' + a2.length + ' · id 唯一 ' + uniq.size + ' · ' + (a2.length === uniq.size ? '无重复' : '仍有重复！'));
const idsMan = new Set(man.sources.channels.map((c) => c.id));
console.log('清单条目 ' + man.sources.channels.length + ' · id 唯一 ' + idsMan.size);
console.log('状态键 ' + Object.keys(JSON.parse(h2.match(/var LIVE_STATUS = (\{[\s\S]*?\});/)[1])).length);
