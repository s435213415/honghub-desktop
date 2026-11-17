#!/usr/bin/env node
'use strict';
/* 补「实测可打开」的海外/港台官网入口。只加入本机 curl 实测 200 的站点，
 * 打不开的一律不加（加了只会让客户点到错误页）。
 * 这些条目是 entryOnly：只跳官网，不抓流、不绕订阅/地区限制。
 * 用法：node scripts/add-overseas-sites.js
 */
const fs = require('fs');
const path = require('path');
const MAN = path.join(__dirname, '..', 'server', 'manifest.json');

const ADD = [
  { name: 'TVB 无线', url: 'https://www.tvb.com/', color: '#E4002B', tag: 'TVB', cat: '港澳台平台', prov: '香港', mode: 'pc' },
  { name: '台湾公视', url: 'https://www.pts.org.tw/', color: '#1B7A4B', tag: '公视', cat: '港澳台平台', prov: '台湾', mode: 'pc' },
  { name: 'Netflix', url: 'https://www.netflix.com/', color: '#E50914', tag: 'N', cat: '欧美平台', mode: 'pc' }
];
const NOTE = '官方入口：仅跳转官方页面播放，不抓流、不绕过订阅与地区限制';

const man = JSON.parse(fs.readFileSync(MAN, 'utf8'));
man.sources = man.sources || {};
const sites = (man.sources.sites = man.sources.sites || []);
let added = 0;
for (const s of ADD) {
  if (sites.some(function (x) { return x.name === s.name || x.url === s.url; })) continue;
  sites.push(Object.assign({}, s, { entryOnly: true, official: true, note: NOTE }));
  added += 1;
}
if (added) {
  man.sources.v = (man.sources.v || 0) + 1;
  man.sources.updatedAt = new Date().toISOString();
  fs.writeFileSync(MAN, JSON.stringify(man, null, 2) + '\n', 'utf8');
}
console.log('海外/港台官网入口：新增 ' + added + ' 条 · 平台合计 ' + sites.length + ' · 清单 v' + man.sources.v);
