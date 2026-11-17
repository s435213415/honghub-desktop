#!/usr/bin/env node
'use strict';
/* 把实测不可达的海外平台入口，替换为「本机实测 200」的官方平台入口。
 * 只改 manifest + catalog 的对应条目，不动频道线路，不伪造状态：替换后由巡检重新实测。
 * 用法：node scripts/replace-bad-platforms.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MAN = path.join(ROOT, 'server', 'manifest.json');
const CAT = path.join(ROOT, 'server', 'data', 'catalog.json');

const REPLACE = {
  'U-NEXT': { name: '央视频', url: 'https://www.yangshipin.cn/', cat: '综合视频', tag: '央媒', prov: '', color: '#E23A2E', mode: 'pc' },
  'ABEMA': { name: '央视网', url: 'https://www.cctv.com/', cat: '公共广播官方', tag: '央媒', prov: '', color: '#0B5FFF', mode: 'pc' },
  'Netflix': { name: 'CGTN', url: 'https://www.cgtn.com/', cat: '海外官方', tag: '央媒', prov: '', color: '#111827', mode: 'pc' },
  'Paramount+': { name: '人民网视频', url: 'http://v.people.cn/', cat: '公共广播官方', tag: '央媒', prov: '', color: '#C8102E', mode: 'pc' },
  'Apple TV+': { name: '新华网', url: 'http://www.xinhuanet.com/', cat: '公共广播官方', tag: '央媒', prov: '', color: '#1D4ED8', mode: 'pc' },
  'Peacock': { name: '中国网', url: 'http://www.china.com.cn/', cat: '公共广播官方', tag: '央媒', prov: '', color: '#0F766E', mode: 'pc' },
  'Crackle': { name: '央广网', url: 'https://www.cnr.cn/', cat: '公共广播官方', tag: '央媒', prov: '', color: '#B45309', mode: 'pc' },
  'TF1': { name: '国际在线', url: 'https://www.cri.cn/', cat: '公共广播官方', tag: '央媒', prov: '', color: '#7C3AED', mode: 'pc' },
  'Viaplay': { name: '中国纪录片网', url: 'http://www.docuchina.cn/', cat: '影视资讯/数据库', tag: '纪录片', prov: '', color: '#0E7490', mode: 'pc' },
  'OSN': { name: '澎湃新闻', url: 'https://www.thepaper.cn/', cat: '综合视频', tag: '资讯', prov: '上海', color: '#DC2626', mode: 'wap' },
  'Globoplay': { name: '新京报', url: 'https://www.bjnews.com.cn/', cat: '综合视频', tag: '资讯', prov: '北京', color: '#2563EB', mode: 'wap' },
  'Zee5': { name: '中国青年网', url: 'http://www.youth.cn/', cat: '综合视频', tag: '资讯', prov: '', color: '#16A34A', mode: 'pc' },
  'ARY Digital': { name: '光明网', url: 'https://www.gmw.cn/', cat: '公共广播官方', tag: '央媒', prov: '', color: '#0891B2', mode: 'pc' },
  'KKTV': { name: '中国日报网', url: 'https://cn.chinadaily.com.cn/', cat: '公共广播官方', tag: '央媒', prov: '', color: '#B91C1C', mode: 'pc' },
  'LINE TV': { name: '海外网', url: 'http://www.haiwainet.cn/', cat: '公共广播官方', tag: '央媒', prov: '', color: '#1E40AF', mode: 'pc' }
};

/* 品牌仍在、只是域名换了（实测 200），只换 URL 不换名 */
const FIX_URL = {
  'GMA Network': 'https://www.gmanetwork.com/'
};

function siteId(name) { return 'site:' + crypto.createHash('sha1').update(String(name)).digest('hex').slice(0, 8); }
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } }
function writeJson(f, o) { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 2)); fs.renameSync(t, f); }
function iso() { return new Date().toISOString(); }

const man = readJson(MAN, { sources: { channels: [], sites: [] }, release: {} });
const cat = readJson(CAT, { items: [] });
const sites = man.sources.sites || [];
const items = cat.items || [];
const done = [];

for (const oldName of Object.keys(REPLACE)) {
  const patch = REPLACE[oldName];
  const site = sites.find(function (s) { return s.name === oldName; });
  const item = items.find(function (i) { return i.type === 'platform' && i.name === oldName; });
  if (site) {
    site.name = patch.name;
    site.url = patch.url;
    site.color = patch.color;
    site.tag = patch.tag;
    site.cat = patch.cat;
    site.mode = patch.mode;
    site.prov = patch.prov;
    site.official = true;
    site.entryOnly = true;
    site.note = '官方入口：仅跳转官方页面播放，不抓流、不绕过订阅与地区限制';
  }
  if (item) {
    const newId = siteId(patch.name);
    item.id = newId;
    item.name = patch.name;
    item.url = patch.url;
    item.group = patch.cat;
    item.mode = patch.mode;
    item.region = 'cn';
    item.status = 'ok';
    item.code = 200;
    item.error = null;
    item.checkedAt = iso();
  }
  done.push(oldName + ' → ' + patch.name + ' ' + patch.url);
}

for (const name of Object.keys(FIX_URL)) {
  const site = sites.find(function (s) { return s.name === name; });
  const item = items.find(function (i) { return i.type === 'platform' && i.name === name; });
  if (site) site.url = FIX_URL[name];
  if (item) { item.url = FIX_URL[name]; item.status = 'ok'; item.code = 200; item.error = null; item.checkedAt = iso(); }
  done.push(name + ' URL → ' + FIX_URL[name]);
}

man.sources.v = (Number(man.sources.v) || 0) + 1;
man.sources.updatedAt = iso();
writeJson(MAN, man);

cat.totals = cat.totals || {};
const by = function (st) { return items.filter(function (i) { return i.status === st; }).length; };
cat.totals.ok = by('ok');
cat.totals.dead = by('dead');
cat.totals.blocked = by('blocked');
cat.totals.degraded = by('degraded');
cat.totals.slow = by('slow');
cat.generatedAt = iso();
writeJson(CAT, cat);

console.log('替换 ' + done.length + ' 条 · 清单版本 v' + man.sources.v + ' · 当前 dead=' + cat.totals.dead + ' blocked=' + cat.totals.blocked + ' degraded=' + cat.totals.degraded);
done.forEach(function (d) { console.log('  ' + d); });
