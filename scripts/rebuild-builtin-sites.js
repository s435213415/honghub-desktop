#!/usr/bin/env node
'use strict';
/* 用 server/manifest.json 的 sites 重写前端 BUILTIN_SITES 数组。
 * 背景：kh-sources 内嵌 JSON 只是给旧逻辑读的兜底，页面真正渲染平台格子用的是 BUILTIN_SITES，
 * 只重建 JSON 不重建数组，换源/换平台在界面上看不到（U-NEXT 之类旧条目会一直留着）。
 * 位置变更（1.7.72 模块化）：数组已从 app/index.html 迁到 app/kh-config.js，这里按「先找壳页、
 * 找不到再找模块」定位，避免布局再变时又要改脚本。
 * 用法：node scripts/rebuild-builtin-sites.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CANDIDATES = [path.join(ROOT, 'app', 'index.html'), path.join(ROOT, 'app', 'kh-config.js')];
const MAN = path.join(ROOT, 'server', 'manifest.json');

const man = JSON.parse(fs.readFileSync(MAN, 'utf8'));
const sites = ((man.sources && man.sources.sites) || []).filter(function (s) { return s && s.name && s.url; });

function q(v) { return JSON.stringify(String(v == null ? '' : v)); }
function tagOf(s) {
  if (s.tag) return s.tag;
  const n = String(s.name).replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
  return n.slice(0, 1) || '站';
}
function colorOf(s, i) {
  if (s.color) return s.color;
  const palette = ['#2563EB', '#DC2626', '#059669', '#7C3AED', '#D97706', '#0891B2', '#DB2777', '#4F46E5'];
  return palette[i % palette.length];
}

const lines = sites.map(function (s, i) {
  const parts = [
    'name:' + q(s.name),
    'url:' + q(s.url),
    'color:' + q(colorOf(s, i)),
    'tag:' + q(tagOf(s)),
    'cat:' + q(s.cat || '综合视频'),
    'mode:' + q(s.mode || 'pc')
  ];
  if (s.prov) parts.push('prov:' + q(s.prov));
  if (s.mobile) parts.push('mobile:' + q(s.mobile));
  return '  {' + parts.join(',') + '}';
});

const PAGE = CANDIDATES.find(function (p) {
  try { return fs.readFileSync(p, 'utf8').indexOf('var BUILTIN_SITES = [') >= 0; } catch (e) { return false; }
});
if (!PAGE) { console.error('没找到 BUILTIN_SITES（已检查：' + CANDIDATES.map(function (p) { return path.relative(ROOT, p); }).join('、') + '）'); process.exit(1); }

let html = fs.readFileSync(PAGE, 'utf8');
const startTag = 'var BUILTIN_SITES = [';
const start = html.indexOf(startTag);
if (start < 0) { console.error('没找到 BUILTIN_SITES'); process.exit(1); }
const end = html.indexOf('\n];', start);
if (end < 0) { console.error('没找到 BUILTIN_SITES 结尾'); process.exit(1); }
const replacement = startTag + '\n' + lines.join(',\n') + '\n];';
html = html.slice(0, start) + replacement + html.slice(end + ('\n];').length);
fs.writeFileSync(PAGE, html);
console.log('BUILTIN_SITES 已重建：' + sites.length + ' 条平台（来自 manifest v' + (man.sources.v || '?') + '）');
