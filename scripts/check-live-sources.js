#!/usr/bin/env node
'use strict';
/* 直播清单静态自检（只读，不改文件）：
   - ERR（阻断）：非法协议 / 含空白或分号 / 内嵌第二段地址 / 空 URL / 同频道主备完全重复；
   - WARN（仅提示，不阻断）：跨频道共用同一 URL（可能镜像或一源多名，需人工核对画面归属）。
   扫描三处：server/manifest.json、页面内嵌 kh-sources 基线、内置 LIVE_CHANNELS。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app', 'index.html');
/* 前端模块化（1.7.72）：频道清单在 app/kh-config.js，只扫壳页会漏检 → 一律用聚合视图 */
const fe = require('./frontend-source');
const errs = [];
const warns = [];

function validUrl(u) {
  if (typeof u !== 'string' || !u.trim()) return '空 URL';
  if (/\s/.test(u)) return 'URL 含空白';
  if (u.includes(';')) return 'URL 含分号（疑似拼接污染）';
  if (/^https?:\/\//i.test(u) && u.indexOf('http', 8) >= 0) return 'URL 内嵌第二段地址';
  if (!/^https?:\/\//i.test(u)) return '非 http(s) 协议';
  return null;
}

function scanChannels(chans, source) {
  const byUrl = {};
  chans.forEach(c => {
    if (!c || typeof c.id !== 'string') return;
    const urls = [];
    (c.sources || []).forEach(s => {
      if (!s || typeof s.url !== 'string') return;
      const bad = validUrl(s.url);
      if (bad) errs.push(`[${source}] ${c.id} ${c.name || ''}：${bad} :: ${s.url}`);
      urls.push(s.url);
      (byUrl[s.url] = byUrl[s.url] || []).push(c.id + ' ' + (c.name || ''));
    });
    const seen = {};
    urls.forEach(u => {
      if (seen[u]) errs.push(`[${source}] ${c.id} ${c.name || ''}：主备线路 URL 完全重复 :: ${u}`);
      seen[u] = 1;
    });
  });
  Object.entries(byUrl).forEach(([u, names]) => {
    if (names.length > 1) warns.push(`[${source}] 跨频道共用同一 URL：${u}\n        ${names.join('、')}`);
  });
}

// 1) manifest.json
try {
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/manifest.json'), 'utf8'));
  scanChannels((man.sources && man.sources.channels) || [], 'manifest');
} catch (e) { errs.push('manifest.json 解析失败：' + e.message); }

// 2) 内嵌 kh-sources 基线
try {
  const html = fe.merged(APP);
  const m = html.match(/<script id="kh-sources"[^>]*>([\s\S]*?)<\/script>/);
  if (m) {
    const kb = JSON.parse(m[1]);
    scanChannels(kb.channels || [], 'kh-sources');
  }
} catch (e) { errs.push('kh-sources 基线解析失败：' + e.message); }

// 3) 内置 LIVE_CHANNELS（JS 字面量，正则提取）
try {
  const html = fe.merged(APP);
  const seg = html.match(/var LIVE_CHANNELS = \[([\s\S]*?)\];/);
  if (seg) {
    const chans = [];
    const blocks = seg[1].match(/\{id:"[^"]*"[\s\S]*?\}/g) || [];
    blocks.forEach(b => {
      const id = (b.match(/id:"([^"]*)"/) || [])[1];
      const name = (b.match(/name:"([^"]*)"/) || [])[1];
      const urls = [...b.matchAll(/url:"([^"]*)"/g)].map(x => ({ url: x[1] }));
      chans.push({ id, name, sources: urls });
    });
    scanChannels(chans, 'LIVE_CHANNELS');
  }
} catch (e) { errs.push('内置 LIVE_CHANNELS 解析失败：' + e.message); }

console.log('=== 直播清单静态自检 ===');
if (warns.length) {
  console.log('\nWARN 跨频道同址（需人工核对画面归属，不阻断）：');
  warns.forEach(w => console.log('  - ' + w));
}
if (errs.length) {
  console.log('\nERR 坏链 / 重复：');
  errs.forEach(e => console.log('  - ' + e));
  console.log('\n自检未通过：' + errs.length + ' 项错误，' + warns.length + ' 项告警');
  process.exit(1);
}
console.log('\n自检通过：坏链 0 · 主备重复 0 · 跨频道同址告警 ' + warns.length + ' 项');
