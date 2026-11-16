/* 把实测通过的省级卫视线路并入页面 LIVE_CHANNELS 与 manifest.sources.channels。
   输入 scripts/_sat_final.json（{卫视名: [url,...]}，全部来自实测通过）；
   规则：只新增、不改现有频道；每个卫视最多 3 条线路；group=卫视频道。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'app/index.html');
const MAN = path.join(ROOT, 'server/manifest.json');
const SRC = path.join(ROOT, 'scripts/_sat_final.json');

const final = JSON.parse(fs.readFileSync(SRC, 'utf8'));
let html = fs.readFileSync(PAGE, 'utf8');
const man = JSON.parse(fs.readFileSync(MAN, 'utf8'));

const block = html.match(/var LIVE_CHANNELS = \[[\s\S]*?\n\];/);
if (!block) throw new Error('页面缺少 LIVE_CHANNELS');
const existingNames = new Set([...block[0].matchAll(/name:"([^"]+)"/g)].map((m) => m[1]));
const maxId = Math.max(...[...block[0].matchAll(/\{id:"cn(\d+)"/g)].map((m) => Number(m[1])));

const colors = ['#0F766E', '#1D4ED8', '#7C3AED', '#B91C1C', '#0369A1', '#A16207', '#15803D', '#9D174D'];
const added = [];
let n = 0;
for (const [name, urls] of Object.entries(final)) {
  if (existingNames.has(name)) { console.log('  已在册，跳过 ' + name); continue; }
  const id = 'cn' + String(maxId + 1 + n).padStart(3, '0');
  const use = urls.slice(0, 3).filter((u) => /^https?:\/\//.test(u));
  if (!use.length) continue;
  const sources = use.map((u, i) => (i === 0 ? { label: '直播主源', url: u } : { label: '备用线路 ' + i, url: u }));
  const entry = {
    id, no: 1000 + n, name, group: '卫视频道', logo: name.slice(0, 1),
    color: colors[n % colors.length], epg: null, net: true, sources
  };
  const js = '{id:"' + id + '",no:' + entry.no + ',name:"' + name + '",group:"卫视频道",logo:"' + entry.logo +
    '",color:"' + entry.color + '",epg:EPG_NEWS,net:true,sources:[' +
    sources.map((s) => '{label:"' + s.label + '",url:"' + s.url + '"}').join(',') + ']},';
  block[0] = block[0].replace(/\n\];$/, '\n  ' + js + '\n];');
  man.sources.channels.push({
    id, name, group: '卫视频道',
    sources, sourceCount: sources.length, addedBy: 'satellite-fill-1.7.15'
  });
  added.push({ id, name, lines: sources.length });
  n++;
}
html = html.replace(/var LIVE_CHANNELS = \[[\s\S]*?\n\];/, block[0]);

// LIVE_STATUS 补上新增频道（默认 true，实测已通过）
const stMatch = html.match(/var LIVE_STATUS = (\{[\s\S]*?\});/);
if (stMatch) {
  const st = JSON.parse(stMatch[1]);
  for (const a of added) st[a.id] = true;
  html = html.replace(stMatch[0], 'var LIVE_STATUS = ' + JSON.stringify(st).replace(/","/g, '", "').replace(/":/g, '": ').replace(/,/g, ', ') + ';');
}

man.sources.v = (Number(man.sources.v) || 0) + 1;
man.sources.channelCount = man.sources.channels.length;
man.sources.updatedAt = new Date().toISOString();
man.sources.missing = (man.sources.missing || []).filter((m) => !added.some((a) => String(m).includes(a.name)));

fs.writeFileSync(PAGE, html);
fs.writeFileSync(MAN, JSON.stringify(man, null, 2) + '\n');

console.log('新增频道 ' + added.length + ' 个 · 线路 ' + added.reduce((s, a) => s + a.lines, 0) + ' 条');
added.forEach((a) => console.log('  ' + a.id + ' ' + a.name + ' · ' + a.lines + ' 条'));
console.log('页面频道合计 ' + (html.match(/var LIVE_CHANNELS = \[[\s\S]*?\n\];/)[0].match(/\{id:"/g) || []).length +
  ' · 清单 ' + man.sources.channels.length + ' · 清单 v' + man.sources.v);
