#!/usr/bin/env node
'use strict';
/* 鸿汇影 · 自动抓源补源（开发端执行，客户端只吃清单）
 *
 * 目的：把「频道没有可用线路」这类问题自动化到底 ——
 *   1) 从公开的 iptv-org 频道清单里抓候选 m3u8（中国大陆 / 港澳台 / 中文 / 新闻 / 体育 / 影视 / 纪录）
 *   2) 按频道名做归一化匹配（去 HD / 1080p / 频道 / 备用 等噪声）
 *   3) 逐条实测（m3u8 解析 + 首切片可达），只把「实测可用」的线路写回 server/manifest.json
 *   4) 清单版本 +1 → 客户端启动/每 10 分钟热更新时自然拿到新线路，不需要发新版 exe/HAP
 *
 * 不做的事：不抓流、不绕地区/订阅限制；平台（网站入口）只做降级跟踪，不伪造可达。
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const MANIFEST = path.join(__dirname, 'manifest.json');
const CATALOG = path.join(DATA_DIR, 'catalog.json');
const POOL_CACHE = path.join(DATA_DIR, 'source-pool.json');
const REPORT = path.join(DATA_DIR, 'source-hunt-report.json');

const POOL_LISTS = [
  'https://iptv-org.github.io/iptv/countries/cn.m3u',
  'https://iptv-org.github.io/iptv/countries/hk.m3u',
  'https://iptv-org.github.io/iptv/countries/tw.m3u',
  'https://iptv-org.github.io/iptv/countries/mo.m3u',
  'https://iptv-org.github.io/iptv/languages/zho.m3u',
  'https://iptv-org.github.io/iptv/categories/news.m3u',
  'https://iptv-org.github.io/iptv/categories/sports.m3u',
  'https://iptv-org.github.io/iptv/categories/movies.m3u',
  'https://iptv-org.github.io/iptv/categories/documentary.m3u'
];

function readJson(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return def; }
}
function writeJson(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}
function iso(t) { return new Date(t || Date.now()).toISOString(); }

async function fetchText(url, ms) {
  const budget = ms || 15000;
  // 优先内置 fetch；打包后的 Electron 里 fetch 偶尔被代理/证书挡掉，退回系统 curl（Windows 10+ 自带）
  try {
    const ctl = new AbortController();
    const timer = setTimeout(function () { ctl.abort(); }, budget);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 HongHub-SourceHunter/1.0' } });
      if (r.ok) {
        const txt = await r.text();
        if (txt && txt.indexOf('#EXTINF') >= 0) return txt;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {}
  try {
    const cp = require('child_process');
    const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const r = cp.spawnSync(curl, ['-sL', '--max-time', String(Math.ceil(budget / 1000)), '-A', 'Mozilla/5.0 HongHub-SourceHunter/1.0', url], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    const txt = (r && r.stdout) || '';
    return txt.indexOf('#EXTINF') >= 0 ? txt : null;
  } catch (e) {
    return null;
  }
}

function parseM3U(txt) {
  const out = [];
  if (!txt) return out;
  const lines = txt.split(/\r?\n/);
  let name = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const i = line.lastIndexOf(',');
      name = i >= 0 ? line.slice(i + 1).trim() : '';
    } else if (line.startsWith('#')) {
      continue;
    } else if (/^https?:\/\//i.test(line) || line.startsWith('rtmp')) {
      if (name) out.push({ name: name, url: line });
      name = '';
    }
  }
  return out;
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\((\d{3,4}p)\)/g, '')
    .replace(/（(\d{3,4}p)）/g, '')
    .replace(/\b(hd|sd|uhd|fhd|4k|8k)\b/g, '')
    .replace(/高清|超清|蓝光|备用|直播|频道|台|tv/g, '')
    .replace(/[\s\-_·:：|（）()\[\]【】]/g, '');
}

/* 中文台名 → 公开清单里常见的英文台名（iptv-org 用英文）
   没有这层，中文名频道永远匹配不上，自动抓源等于白跑。 */
const ALIAS = {
  'CCTV-1 综合': ['CCTV-1', 'CCTV 1'], 'CCTV-2 财经': ['CCTV-2'], 'CCTV-3 综艺': ['CCTV-3'],
  'CCTV-4 中文国际': ['CCTV-4'], 'CCTV-5 体育': ['CCTV-5'], 'CCTV-5+ 体育赛事': ['CCTV-5+'],
  'CCTV-6 电影': ['CCTV-6'], 'CCTV-7 军事农业': ['CCTV-7'], 'CCTV-8 电视剧': ['CCTV-8'],
  'CCTV-9 纪录': ['CCTV-9'], 'CCTV-10 科教': ['CCTV-10'], 'CCTV-11 戏曲': ['CCTV-11'],
  'CCTV-12 社会与法': ['CCTV-12'], 'CCTV-13 新闻': ['CCTV-13'], 'CCTV-14 少儿': ['CCTV-14'],
  'CCTV-15 音乐': ['CCTV-15'], 'CCTV-17 农业农村': ['CCTV-17'],
  '湖南卫视': ['Hunan TV', 'Hunan Satellite'], '浙江卫视': ['Zhejiang TV'], '江苏卫视': ['Jiangsu TV'],
  '东方卫视': ['Dragon TV', 'Shanghai TV'], '北京卫视': ['Beijing TV'], '广东卫视': ['Guangdong TV'],
  '深圳卫视': ['Shenzhen TV'], '安徽卫视': ['Anhui TV'], '山东卫视': ['Shandong TV'],
  '天津卫视': ['Tianjin TV'], '湖北卫视': ['Hubei TV'], '四川卫视': ['Sichuan TV'],
  '河南卫视': ['Henan TV'], '东南卫视': ['Southeast TV'], '江西卫视': ['Jiangxi TV'],
  '辽宁卫视': ['Liaoning TV'], '黑龙江卫视': ['Heilongjiang TV'], '吉林卫视': ['Jilin TV'],
  '河北卫视': ['Hebei TV'], '山西卫视': ['Shanxi TV'], '陕西卫视': ['Shaanxi TV'],
  '甘肃卫视': ['Gansu TV'], '宁夏卫视': ['Ningxia TV'], '青海卫视': ['Qinghai TV'],
  '云南卫视': ['Yunnan TV'], '贵州卫视': ['Guizhou TV'], '广西卫视': ['Guangxi TV'],
  '新疆卫视': ['Xinjiang TV'], '西藏卫视': ['Tibet TV'], '内蒙古卫视': ['Inner Mongolia TV'],
  '海南卫视': ['Hainan TV'], '重庆卫视': ['Chongqing TV'], '凤凰卫视中文台': ['Phoenix Chinese'],
  '凤凰卫视资讯台': ['Phoenix InfoNews']
};

/* 频道名 ↔ 候选名 匹配分：3=完全相同，2=互相包含，1=前 3 字命中 */
function score(chName, candName) {
  const a = norm(chName);
  const b = norm(candName);
  if (!a || !b) return 0;
  if (a === b) return 3;
  if (b.indexOf(a) >= 0 || a.indexOf(b) >= 0) return 2;
  if (a.length >= 3 && b.indexOf(a.slice(0, 3)) === 0) return 1;
  return 0;
}

/* 带上英文别名后的最高分 */
function scoreWithAlias(chName, candName) {
  let best = score(chName, candName);
  const alts = ALIAS[chName] || [];
  for (const alt of alts) {
    const s = score(alt, candName);
    if (s > best) best = s;
  }
  return best;
}

async function loadPool(ttlMs) {
  const cache = readJson(POOL_CACHE, null);
  const ttl = ttlMs || 6 * 3600 * 1000;
  if (cache && cache.at && (Date.now() - Date.parse(cache.at)) < ttl && Array.isArray(cache.items) && cache.items.length) {
    return { pool: cache.items, cached: true, at: cache.at, lists: cache.lists || [] };
  }
  const lists = [];
  const map = {};
  for (const url of POOL_LISTS) {
    const txt = await fetchText(url);
    const items = parseM3U(txt);
    lists.push({ url: url, ok: !!items.length, n: items.length });
    for (const it of items) map[it.url] = { name: it.name, url: it.url, list: url };
  }
  const pool = Object.keys(map).map(function (k) { return map[k]; });
  writeJson(POOL_CACHE, { at: iso(), lists: lists, items: pool });
  return { pool: pool, cached: false, at: iso(), lists: lists };
}

function catalogProbe() {
  // 延迟 require：catalog.js 反向 require 本模块时不会形成加载环
  return require('./catalog').probe;
}

async function testUrl(probe, url, ms) {
  try {
    const r = await probe(url, ms || 5000);
    return r && (r.ok || r.code === 200 || r.code === 206 || r.m3u8 === true);
  } catch (e) {
    return false;
  }
}

async function hunt(opts) {
  opts = opts || {};
  const max = Number(opts.max) || 12;
  const probeMs = Number(opts.probeMs) || 5000;
  const perChannel = Number(opts.perChannel) || 3;
  const man = readJson(MANIFEST, { sources: { channels: [], sites: [] }, release: {} });
  const chs = (man.sources && man.sources.channels) || [];
  const cat = readJson(CATALOG, { items: [] });
  const catItems = cat.items || [];

  const includeWeak = opts.includeWeak !== false;
  const bad = catItems.filter(function (it) {
    if (it.type !== 'channel') return false;
    const st = String(it.status || '');
    if (st === 'dead' || st === 'blocked' || st === 'degraded') return true;
    if (!includeWeak) return false;
    // 单线路 / 慢速 / 受限的频道也纳入补源：它们一旦掉线就没有备胎
    const n = Number(it.sourceCount || (Array.isArray(it.sources) ? it.sources.length : 0));
    return n <= 1 || st === 'slow' || st === 'limited';
  }).slice(0, max);

  const { pool, cached, lists } = await loadPool();
  const probe = catalogProbe();
  const added = [];
  const missed = [];
  const tried = {};

  for (const it of bad) {
    const hit = chs.find(function (c) { return ('ch:' + (c.id || c.name)) === it.id; });
    if (!hit) continue;
    const existing = new Set(((hit.sources || []).map(function (s) { return s.url; })));
    const ranked = pool
      .map(function (c) { return { c: c, s: scoreWithAlias(it.name, c.name) }; })
      .filter(function (x) { return x.s > 0 && !existing.has(x.c.url) && !tried[x.c.url]; })
      .sort(function (a, b) { return b.s - a.s; })
      .slice(0, perChannel * 3);
    let picked = null;
    let checks = 0;
    for (const r of ranked) {
      if (checks >= perChannel) break;
      checks += 1;
      tried[r.c.url] = true;
      if (await testUrl(probe, r.c.url, probeMs)) { picked = r.c; break; }
    }
    if (!picked) {
      missed.push({
        id: it.id, name: it.name,
        reason: ranked.length ? ('候选 ' + ranked.length + ' 条全部探测不通') : '源池里没有同名候选'
      });
      continue;
    }
    hit.sources = (hit.sources || []).concat([{
      label: '自动补源 ' + iso().slice(0, 10),
      url: picked.url,
      status: 'ok'
    }]);
    hit.sourceCount = hit.sources.length;

    const ci = catItems.find(function (x) { return x.id === it.id; });
    if (ci) {
      ci.sources = (ci.sources || []).concat([{ label: '自动补源', url: picked.url, status: 'ok', ms: null, code: 200, error: null, checkedAt: iso() }]);
      ci.sourceCount = ci.sources.length;
      ci.status = 'ok';
      ci.error = null;
      ci.checkedAt = iso();
    }
    added.push({ id: it.id, name: it.name, url: picked.url, from: picked.name });
  }

  if (added.length) {
    man.sources.v = (Number(man.sources.v) || 0) + 1;
    man.sources.updatedAt = iso();
    try { fs.copyFileSync(MANIFEST, path.join(DATA_DIR, 'manifest.before-hunt.json')); } catch (e) {}
    writeJson(MANIFEST, man);
    if (cat.items) {
      cat.totals = cat.totals || {};
      cat.totals.dead = catItems.filter(function (x) { return x.status === 'dead'; }).length;
      cat.totals.blocked = catItems.filter(function (x) { return x.status === 'blocked'; }).length;
      cat.totals.degraded = catItems.filter(function (x) { return x.status === 'degraded'; }).length;
      cat.totals.ok = catItems.filter(function (x) { return x.status === 'ok'; }).length;
      writeJson(CATALOG, cat);
    }
  }

  const report = {
    at: iso(),
    pool: { cached: cached, total: pool.length, lists: lists },
    checkedChannels: bad.length,
    added: added,
    missed: missed,
    note: added.length ? '已把实测可用的线路写回清单，客户端热更新后即生效' : (missed.length ? ('本轮 ' + missed.length + ' 个频道没补上：' + missed.slice(0, 3).map(function (m) { return m.name + '（' + m.reason + '）'; }).join('；')) : '本轮没有需要补源的频道')
  };
  writeJson(REPORT, report);
  return report;
}

module.exports = { hunt, loadPool, parseM3U, norm, scoreWithAlias };

/* 直接命令行运行：node server/source-hunter.js [--max=12] */
if (require.main === module) {
  const argMax = (process.argv.find(function (a) { return a.indexOf('--max=') === 0; }) || '').split('=')[1];
  hunt({ max: Number(argMax) || 12 }).then(function (r) {
    console.log('[抓源] 候选池 ' + r.pool.total + ' 条（缓存=' + r.pool.cached + '）· 检查频道 ' + r.checkedChannels + ' 个 · 补入 ' + r.added.length + ' 条');
    r.added.forEach(function (a) { console.log('  + ' + a.name + ' ← ' + a.url); });
    if (!r.added.length) console.log('  ' + r.note);
  }).catch(function (e) {
    console.error('[抓源] 失败：' + (e && e.message));
    process.exitCode = 1;
  });
}
