/* 把深验通过的 河南卫视 / 重庆卫视 / 福建卫视 并入页面与清单（v1.7.16 前一步）。
   与 merge-satellites.js 的差别：显式处理"上一条缺逗号"、同时重建 kh-sources 运行时块。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'app/index.html');
const MAN = path.join(ROOT, 'server/manifest.json');
const SRC = path.join(ROOT, 'scripts/_sat3_final.json');

const final = JSON.parse(fs.readFileSync(SRC, 'utf8'));
let html = fs.readFileSync(PAGE, 'utf8');
const man = JSON.parse(fs.readFileSync(MAN, 'utf8'));

const META = {
  河南卫视: { logo: '豫', color: '#B45309' },
  重庆卫视: { logo: '渝', color: '#0E7490' },
  福建卫视: { logo: '闽', color: '#1E40AF' }
};

let block = html.match(/var LIVE_CHANNELS = \[[\s\S]*?\n\];/);
if (!block) throw new Error('页面缺少 LIVE_CHANNELS');
block = block[0];
const existNames = new Set([...block.matchAll(/name:"([^"]+)"/g)].map((m) => m[1]));
const maxId = Math.max(...[...block.matchAll(/\{id:"cn(\d+)"/g)].map((m) => Number(m[1])));

// ① 先保证数组末元素有逗号（上次就栽在这）
if (/\}(\r?\n\];)$/.test(block)) block = block.replace(/\}(\r?\n\];)$/, '},$1');

const added = [];
let i = 0;
for (const [name, list] of Object.entries(final)) {
  if (existNames.has(name)) { console.log('  已在册跳过 ' + name); continue; }
  const urls = (Array.isArray(list) ? list : []).map((x) => (typeof x === 'string' ? x : x && x.url)).filter((u) => /^https?:\/\//.test(u)).slice(0, 3);
  if (!urls.length) { console.log('  ' + name + ' 无可用线路，跳过'); continue; }
  const id = 'cn' + String(maxId + 1 + i).padStart(3, '0');
  const no = 1018 + i;
  const m = META[name] || { logo: name.slice(0, 1), color: '#334155' };
  const src = urls.map((u, k) => (k === 0 ? { label: '直播主源', url: u } : { label: '备用线路 ' + k, url: u }));
  const js = '{id:"' + id + '",no:' + no + ',name:"' + name + '",group:"卫视频道",logo:"' + m.logo +
    '",color:"' + m.color + '",epg:EPG_NEWS,net:true,sources:[' +
    src.map((s) => '{label:"' + s.label + '",url:"' + s.url + '"}').join(',') + ']},';
  block = block.replace(/\n\];$/, '\n  ' + js + '\n];');
  man.sources.channels.push({ id, name, group: '卫视频道', sources: src, sourceCount: src.length, addedBy: 'satellite-fill-1.7.16' });
  added.push({ id, name, lines: src.length });
  i++;
}
html = html.replace(/var LIVE_CHANNELS = \[[\s\S]*?\n\];/, block);

// ② LIVE_STATUS 补键
const stMatch = html.match(/var LIVE_STATUS = (\{[\s\S]*?\});/);
if (stMatch) {
  const st = JSON.parse(stMatch[1]);
  for (const a of added) st[a.id] = true;
  html = html.replace(stMatch[0], 'var LIVE_STATUS = ' + JSON.stringify(st).replace(/","/g, '", "').replace(/":/g, '": ').replace(/,/g, ', ') + ';');
}

// ③ 清单计数
man.sources.v = (Number(man.sources.v) || 0) + 1;
man.sources.channelCount = man.sources.channels.length;
man.sources.updatedAt = new Date().toISOString();
man.sources.verifiedAt = new Date().toISOString().slice(0, 10);

// ④ 重建 kh-sources（运行时真正读的块）
const oldMatch = html.match(/<script id="kh-sources" type="application\/json">([\s\S]*?)<\/script>/);
if (!oldMatch) throw new Error('页面缺少 kh-sources');
const old = JSON.parse(oldMatch[1]);
const kb = {
  v: man.sources.v,
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
html = html.slice(0, oldMatch.index) + '<script id="kh-sources" type="application/json">' + JSON.stringify(kb) + '</script>' + html.slice(oldMatch.index + oldMatch[0].length);

fs.writeFileSync(PAGE, html);
fs.writeFileSync(MAN, JSON.stringify(man, null, 2) + '\n');

// ⑤ 自检
const ch = html.match(/var LIVE_CHANNELS = \[[\s\S]*?\n\];/)[0];
const arr = new Function('var EPG_NEWS=[];var EPG_DOC=[];' + ch + '; return LIVE_CHANNELS;')();
const st = new Function(html.match(/var LIVE_STATUS = [\s\S]*?;/)[0] + '; return LIVE_STATUS;')();
console.log('新增 ' + added.length + ' 个频道 · ' + added.reduce((s, a) => s + a.lines, 0) + ' 条线路');
added.forEach((a) => console.log('  ' + a.id + ' ' + a.name + ' · ' + a.lines + ' 条'));
console.log('LIVE_CHANNELS ' + arr.length + ' · LIVE_STATUS ' + Object.keys(st).length + ' · 清单 ' + man.sources.channels.length + ' · v' + man.sources.v + ' · kh-sources ' + kb.count + '/' + kb.siteCount);
