'use strict';
/* 平台条目体检：对 server/data/catalog.json 做批量校验（重复、缺分组、空名、非法类型、异常状态），
   给出可执行的修复建议；apply 只做「安全修复」并先备份原文件。 */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const FILE = path.join(DATA, 'catalog.json');
const BACKUP_DIR = path.join(DATA, 'catalog-backups');

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return null; }
}

const KNOWN_TYPES = ['channel', 'platform', 'vod', 'movie', 'live', 'site'];

function normName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/* 按名称/地区猜分组：只用于「分组为空」的条目，不去改已有分组 */
function guessGroup(it) {
  const n = String(it.name || '');
  const region = String(it.region || '').toLowerCase();
  if (/CCTV|中央电视台/i.test(n)) return '央视频道';
  if (/卫视/.test(n)) return '卫视频道';
  if (/香港|澳门|台湾|翡翠|明珠|TVB|凤凰/.test(n) || region === 'hk' || region === 'mo' || region === 'tw') return '中国港澳台地区';
  if (it.type === 'platform' || /平台/.test(n)) return '平台入口';
  if (it.type === 'vod' || /点播|电影|剧/.test(n)) return '点播片单';
  return '';
}

function audit() {
  const c = read();
  if (!c || !Array.isArray(c.items)) return { ok: false, error: '读取 catalog.json 失败' };
  const groups = (c.groups || []).map(function (g) { return g.name; });
  const byName = new Map(), byId = new Map();
  const dupNames = [], dupIds = [], badType = [], emptyName = [], noGroup = [], pendingRemove = [], badStatus = [];
  const emptySources = [], badUrl = [], badChars = [], dupWithin = [];
  const urlOwners = new Map();

  c.items.forEach(function (it) {
    const id = String(it.id || '');
    const name = normName(it.name);
    if (!name) emptyName.push({ id: id });
    if (KNOWN_TYPES.indexOf(String(it.type)) < 0) badType.push({ id: id, name: name, type: it.type });
    if (!String(it.group || '').trim()) {
      const g = guessGroup(it);
      noGroup.push({ id: id, name: name, type: it.type, suggest: g || '（需人工指定）' });
    }
    const key = String(it.type) + '|' + name + '|' + String(it.group || '');
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(it);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(it);
    if (['dead', 'blocked'].indexOf(String(it.status)) >= 0) badStatus.push({ id: id, name: name, status: it.status, ms: it.ms });

    // 线路层校验（sources 是 {label,url,status,ms...} 对象，也兼容纯字符串）
    const srcs = Array.isArray(it.sources) ? it.sources : [];
    const urls = srcs.map(function (s) { return typeof s === 'string' ? s.trim() : String((s && s.url) || '').trim(); })
      .filter(function (u) { return u !== ''; });
    // 平台条目本来就只存入口、不带线路清单，不算「空线路」
    if (urls.length === 0 && Number(it.sourceCount || 0) > 0 && String(it.type) !== 'platform') {
      emptySources.push({ id: id, name: name, sourceCount: it.sourceCount });
    }
    // 同一条目内重复线路
    const seen = {};
    let insideDup = 0;
    srcs.forEach(function (s) {
      const u = typeof s === 'string' ? s.trim() : String((s && s.url) || '').trim();
      if (!u) return;
      if (seen[u]) insideDup++; else seen[u] = 1;
    });
    if (insideDup) dupWithin.push({ id: id, name: name, count: insideDup });
    urls.forEach(function (s) {
      if (!/^(http|https|rtmp|rtsp):/i.test(s) && !/\.m3u8/i.test(s)) {
        badUrl.push({ id: id, name: name, url: s.slice(0, 90) });
      }
      if (!urlOwners.has(s)) urlOwners.set(s, []);
      urlOwners.get(s).push(id);
    });
    if (/[\u3000\t\u00a0]/.test(String(it.name || ''))) {
      badChars.push({ id: id, name: it.name });
    }
  });

  byName.forEach(function (arr) {
    if (arr.length > 1) {
      dupNames.push({
        name: arr[0].name, type: arr[0].type, group: arr[0].group || '', count: arr.length,
        ids: arr.map(function (x) { return x.id; }),
        keep: arr[0].id,
        mergeSources: arr.reduce(function (s, x) { return s + (Array.isArray(x.sources) ? x.sources.length : 0); }, 0)
      });
      arr.slice(1).forEach(function (x) { pendingRemove.push(x.id); });
    }
  });
  byId.forEach(function (arr, id) {
    if (arr.length > 1) dupIds.push({ id: id, count: arr.length, names: arr.map(function (x) { return x.name; }) });
  });

  const statusCount = {};
  c.items.forEach(function (it) { const s = String(it.status || 'unknown'); statusCount[s] = (statusCount[s] || 0) + 1; });

  const dupUrls = [];
  urlOwners.forEach(function (owners, url) {
    const uniq = Array.from(new Set(owners));
    if (uniq.length > 1) dupUrls.push({ url: url.slice(0, 110), count: owners.length, ids: uniq });
  });

  return {
    ok: true, at: new Date().toISOString(),
    file: 'server/data/catalog.json',
    totals: {
      items: c.items.length, groups: groups.length,
      dupNames: dupNames.length, dupIds: dupIds.length, badType: badType.length,
      emptyName: emptyName.length, noGroup: noGroup.length,
      pendingRemove: pendingRemove.length, badStatus: badStatus.length,
      emptySources: emptySources.length, badUrl: badUrl.length, dupUrls: dupUrls.length, badChars: badChars.length,
      dupWithin: dupWithin.length
    },
    statusCount: statusCount,
    dupNames: dupNames.slice(0, 40),
    dupUrls: dupUrls.slice(0, 40),
    dupWithin: dupWithin.slice(0, 40),
    emptySources: emptySources.slice(0, 40),
    badUrl: badUrl.slice(0, 40),
    badChars: badChars.slice(0, 40),
    dupIds: dupIds,
    badType: badType.slice(0, 40),
    emptyName: emptyName.slice(0, 40),
    noGroup: noGroup.slice(0, 60),
    badStatus: badStatus.slice(0, 40),
    groups: groups,
    canAutoFix: {
      noGroup: noGroup.filter(function (x) { return x.suggest && x.suggest.indexOf('人工') < 0; }).length,
      removeDup: pendingRemove.length,
      trimNames: c.items.filter(function (it) { return String(it.name || '') !== normName(it.name); }).length
    }
  };
}

function apply(opts) {
  const c = read();
  if (!c || !Array.isArray(c.items)) return { ok: false, error: '读取 catalog.json 失败' };
  const doRemoveDup = opts && opts.removeDup !== false;
  const doGroup = opts && opts.fillGroup !== false;
  const doTrim = opts && opts.trimNames !== false;
  const doDedupe = opts && opts.dedupeSources !== false;
  const a = audit();
  const removedIds = new Set(a.pendingRemove);
  let merged = 0, grouped = 0, trimmed = 0;

  const keepMap = {};
  c.items.forEach(function (it) {
    const key = String(it.type) + '|' + normName(it.name) + '|' + String(it.group || '');
    if (!keepMap[key]) keepMap[key] = it;
  });

  let dedupedLines = 0;
  c.items.forEach(function (it) {
    if (doTrim) {
      const n = normName(it.name);
      if (n !== it.name) { it.name = n; trimmed++; it._fixed = 'name'; }
    }
    if (doGroup && !String(it.group || '').trim()) {
      const g = guessGroup(it);
      if (g) { it.group = g; grouped++; }
    }
    if (doDedupe && Array.isArray(it.sources)) {
      const seen = {};
      it.sources = it.sources.filter(function (s) {
        const u = typeof s === 'string' ? s.trim() : String((s && s.url) || '').trim();
        if (!u) { dedupedLines++; return false; }
        if (seen[u]) { dedupedLines++; return false; }
        seen[u] = 1;
        return true;
      });
      it.sourceCount = it.sources.length;
    }
  });

  let items = c.items;
  if (doRemoveDup && removedIds.size) {
    // 被判定重复的条目：把它的线路并入保留项，再从清单里移除
    removedIds.forEach(function (id) {
      const dup = items.find(function (x) { return x.id === id; });
      if (!dup) return;
      const key = String(dup.type) + '|' + normName(dup.name) + '|' + String(dup.group || '');
      const keep = keepMap[key];
      if (keep && keep !== dup && Array.isArray(dup.sources)) {
        keep.sources = (Array.isArray(keep.sources) ? keep.sources : []).concat(dup.sources);
        keep.sourceCount = keep.sources.length;
        merged += dup.sources.length;
      }
    });
    items = items.filter(function (x) { return !removedIds.has(x.id); });
  }
  c.items = items;

  if (c.totals) {
    c.totals.items = items.length;
    const cnt = {};
    items.forEach(function (x) { const s = String(x.status || 'unknown'); cnt[s] = (cnt[s] || 0) + 1; });
    ['ok', 'slow', 'dead', 'blocked', 'degraded', 'limited'].forEach(function (k) {
      if (cnt[k] !== undefined) c.totals[k] = cnt[k];
    });
  }
  c.generatedAt = new Date().toISOString();
  c.auditedAt = c.generatedAt;

  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(FILE, path.join(BACKUP_DIR, 'catalog-' + stamp + '.json'));
    fs.writeFileSync(FILE, JSON.stringify(c, null, 2), 'utf8');
  } catch (e) {
    return { ok: false, error: '写回失败：' + (e && e.message) };
  }
  return { ok: true, removed: removedIds.size, mergedSources: merged, grouped: grouped, trimmed: trimmed, dedupedLines: dedupedLines, items: items.length, backupDir: 'server/data/catalog-backups' };
}

module.exports = { audit, apply };
