/* 发布与运维控制台的数据层：
   1) releases() —— 发布历史：releases/index.json 的版本、发布时间、功能数，加每版归档体积与文件
   2) gates()    —— 发版闸门红绿：verify 日志的 [通过]/[失败] 逐条 + 最近一次流水线里的 doctor 预检 [OK]/[WARN]/[ERR]
   3) logs()     —— 日志清单与尾部读取（按 mtime 排序，单次最多读 400KB）
   全部只读磁盘，不做任何写操作。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const RELEASES = path.join(ROOT, 'releases');
const LOGS = path.join(ROOT, 'logs');
const DIST = path.join(ROOT, 'dist');

function jread(p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } }
function sizeMB(n) { return Math.round((Number(n) || 0) / 1048576 * 10) / 10; }

function dirStat(dir) {
  let files = 0, bytes = 0, names = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try {
        const st = fs.statSync(p);
        if (!st.isFile()) continue;
        files += 1; bytes += st.size;
        if (/\.(exe|hap|zip|bin)$/i.test(f)) names.push({ name: f, mb: sizeMB(st.size) });
      } catch (e) {}
    }
  } catch (e) {}
  return { files: files, mb: sizeMB(bytes), artifacts: names };
}

function releases() {
  const idx = jread(path.join(RELEASES, 'index.json'), { versions: [], latest: null });
  const cur = jread(path.join(DIST, 'release.json'), {});
  const list = (idx.versions || []).map(function (v) {
    const d = dirStat(path.join(RELEASES, 'v' + v.versionName));
    return {
      versionName: v.versionName,
      versionCode: v.versionCode || null,
      publishedAt: v.publishedAt || null,
      features: (v.features && v.features.count) || 0,
      stats: d,
      isLatest: !!(idx.latest && idx.latest.versionName === v.versionName),
      isRollbackTarget: false,
      onDisk: fs.existsSync(path.join(RELEASES, 'v' + v.versionName))
    };
  }).sort(function (a, b) { return String(b.versionName).localeCompare(String(a.versionName), undefined, { numeric: true }); });
  // 当前下发给设备端的版本可能不是最新（回滚过），单独标出来
  const delivery = cur.versionName || '';
  list.forEach(function (v) { if (v.versionName === delivery) v.isRollbackTarget = true; });
  return {
    latest: idx.latest || null,
    deliveryVersion: delivery,
    generatedAt: idx.generatedAt || null,
    count: list.length,
    totalMB: Math.round(list.reduce(function (s, v) { return s + (v.stats.mb || 0); }, 0) * 10) / 10,
    versions: list
  };
}

/* 闸门：verify 日志每条 [通过]/[失败] 都变成一行红绿；doctor 预检的 [OK]/[WARN]/[ERR] 同理 */
function gates() {
  let verifyFile = '', verifyItems = [], verifyCounts = { ok: 0, bad: 0 };
  let doctorFile = '', doctorItems = [], doctorCounts = { ok: 0, warn: 0, err: 0 }, doctorSummary = '';
  let logs = [];
  try { logs = fs.readdirSync(LOGS).map(function (f) { return { name: f, mtime: fs.statSync(path.join(LOGS, f)).mtimeMs }; }); } catch (e) {}
  const newest = function (re) { return logs.filter(function (x) { return re.test(x.name); }).sort(function (a, b) { return b.mtime - a.mtime; })[0]; };

  const vf = newest(/^verify-[0-9.]+\.log$/);
  if (vf) {
    verifyFile = vf.name;
    let text = '';
    try { text = fs.readFileSync(path.join(LOGS, vf.name), 'utf8'); } catch (e) {}
    const re = /\s*\[(通过|失败)\]\s*(.+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const ok = m[1] === '通过';
      verifyItems.push({ ok: ok, text: m[2].trim() });
      if (ok) verifyCounts.ok += 1; else verifyCounts.bad += 1;
    }
  }

  // 预检行不一定出现在最新那份流水线（有的轮次跳过 doctor），往前找最近一份真正含 [OK]/[WARN]/[ERR] 的
  const pipeFiles = logs.filter(function (x) { return /^(oneclick|manual|panel)-.*\.log$/.test(x.name); })
    .sort(function (a, b) { return b.mtime - a.mtime; });
  for (const pf of pipeFiles.slice(0, 20)) {
    let text = '';
    try { text = fs.readFileSync(path.join(LOGS, pf.name), 'utf8'); } catch (e) { continue; }
    const re = /^\s*\[(OK|WARN|ERR)\s*\]\s*(.+)$/gm;
    const items = [];
    let m;
    while ((m = re.exec(text)) !== null) items.push({ level: m[1], text: m[2].trim() });
    if (!items.length) continue;
    doctorFile = pf.name;
    doctorItems = items;
    items.forEach(function (x) { if (x.level === 'OK') doctorCounts.ok += 1; else if (x.level === 'WARN') doctorCounts.warn += 1; else doctorCounts.err += 1; });
    const sm = text.match(/(汇总：OK \d+ · WARN \d+ · ERR \d+)/);
    doctorSummary = sm ? sm[1] : '';
    break;
  }

  return {
    verify: { file: verifyFile, items: verifyItems.slice(0, 60), counts: verifyCounts, allPassed: verifyCounts.bad === 0 && verifyCounts.ok > 0 },
    doctor: { file: doctorFile, items: doctorItems.slice(0, 40), counts: doctorCounts, summary: doctorSummary, clean: doctorCounts.err === 0 },
    healthy: (verifyCounts.bad === 0 && verifyCounts.ok > 0) && doctorCounts.err === 0
  };
}

function logs() {
  let items = [];
  try {
    items = fs.readdirSync(LOGS).filter(function (f) { return /\.log$/.test(f); }).map(function (f) {
      const p = path.join(LOGS, f);
      const st = fs.statSync(p);
      return { name: f, kb: Math.round(st.size / 1024), mtime: st.mtimeMs };
    }).sort(function (a, b) { return b.mtime - a.mtime; });
  } catch (e) { return []; }
  return items;
}

function readLog(name, tailLines) {
  const safe = String(name || '').replace(/[^A-Za-z0-9._-]/g, '');
  if (!safe) return { ok: false, error: '文件名不合法' };
  const p = path.join(LOGS, safe);
  if (!fs.existsSync(p)) return { ok: false, error: '日志不存在' };
  const maxBytes = 400 * 1024;
  let text = '';
  try {
    const size = fs.statSync(p).size;
    const fd = fs.openSync(p, 'r');
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch (e) { return { ok: false, error: '读取失败：' + e.message }; }
  const lines = text.split(/\r?\n/);
  const keep = Math.max(20, Math.min(2000, Number(tailLines) || 300));
  const truncated = lines.length > keep || text.length >= maxBytes;
  return {
    ok: true, name: safe,
    kb: Math.round(fs.statSync(p).size / 1024),
    mtime: fs.statSync(p).mtimeMs,
    totalLines: lines.length,
    truncated: truncated,
    text: lines.slice(Math.max(0, lines.length - keep)).join('\n')
  };
}

function audit(limit) {
  try { return require('./devops').listAudit(Number(limit) || 60); }
  catch (e) { return []; }
}

/* SBOM：依赖清单可查，而不是只躺在 dist/sbom.json 里 */
function sbom() {
  const j = jread(path.join(DIST, 'sbom.json'), null);
  if (!j || !j.components) return { ok: false, error: 'dist/sbom.json 不存在（跑一次发版会生成）' };
  const byType = {}, byScope = {}, list = [];
  (j.components || []).forEach(function (c) {
    const t = c.type || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
    const s = c.scope || 'default';
    byScope[s] = (byScope[s] || 0) + 1;
    list.push({ type: c.type, name: c.name, version: c.version, scope: c.scope, purl: c.purl });
  });
  return {
    ok: true, count: j.components.length,
    meta: { tool: (j.metadata && j.metadata.tool && j.metadata.tool.name) || '', serial: j.serialNumber || '', at: (j.metadata && j.metadata.timestamp) || '' },
    byType: byType, byScope: byScope,
    sample: list.slice(0, 60)
  };
}

/* dist 体积：按一级目录聚合，5 分钟缓存（全量 stat 一次要几秒） */
let sizeCache = { at: 0, data: null };
function distSize() {
  if (sizeCache.data && Date.now() - sizeCache.at < 5 * 60 * 1000) return sizeCache.data;
  const top = [];
  let total = 0;
  try {
    for (const name of fs.readdirSync(DIST)) {
      const p = path.join(DIST, name);
      let st;
      try { st = fs.statSync(p); } catch (e) { continue; }
      if (st.isFile()) { total += st.size; top.push({ name: name, mb: sizeMB(st.size), kind: 'file' }); continue; }
      let bytes = 0;
      try {
        const walk = function (dir) {
          for (const f of fs.readdirSync(dir)) {
            const q = path.join(dir, f);
            let s2;
            try { s2 = fs.statSync(q); } catch (e) { continue; }
            if (s2.isDirectory()) walk(q); else bytes += s2.size;
          }
        };
        walk(p);
      } catch (e) {}
      total += bytes;
      top.push({ name: name, mb: sizeMB(bytes), kind: 'dir' });
    }
  } catch (e) { return { ok: false, error: '读不到 dist：' + e.message }; }
  top.sort(function (a, b) { return b.mb - a.mb; });
  // 归档目录（以 _ 开头）单独统计：它们才是体积大头，治理从这里下手
  const archiveMB = Math.round(top.filter(function (x) { return /^_/.test(x.name); }).reduce(function (s, x) { return s + x.mb; }, 0) * 10) / 10;
  const data = {
    ok: true, totalMB: sizeMB(total), at: new Date().toISOString(),
    top: top.slice(0, 12),
    archiveMB: archiveMB,
    cacheAge: '5 分钟内缓存'
  };
  sizeCache = { at: Date.now(), data: data };
  return data;
}

/* 变更日志：用归档索引里每版的功能 id 做前后对比，生成可读的「新增/移除」条目；
   索引里缺 ids 的旧版本只记功能数量，不臆造明细。 */
function changelog() {
  const idx = jread(path.join(RELEASES, 'index.json'), { versions: [] });
  const vs = (idx.versions || []).slice().sort(function (a, b) {
    return String(a.versionName).localeCompare(String(b.versionName), undefined, { numeric: true });
  });
  const entries = [];
  let prev = null;
  vs.forEach(function (v) {
    const ids = (v.features && v.features.ids) || [];
    const added = [], removed = [];
    if (prev && prev.ids.length && ids.length) {
      ids.forEach(function (id) { if (prev.ids.indexOf(id) < 0) added.push(id); });
      prev.ids.forEach(function (id) { if (ids.indexOf(id) < 0) removed.push(id); });
    }
    entries.push({
      versionName: v.versionName,
      versionCode: v.versionCode || null,
      publishedAt: v.publishedAt || null,
      count: (v.features && v.features.count) || ids.length || 0,
      compared: !!(prev && prev.ids.length && ids.length),
      reason: !ids.length ? '本版未记录功能 id' : (!prev ? '最早一版，无上一版可比' : (!prev.ids.length ? '上一版未记录功能 id' : '')),
      added: added,
      removed: removed
    });
    prev = { ids: ids, versionName: v.versionName };
  });
  return { ok: true, count: entries.length, entries: entries.reverse().slice(0, 24) };
}

function changelogMarkdown() {
  const d = changelog();
  const lines = ['# 鸿汇影 · 变更日志', '', '由发版归档索引自动生成，时间：' + new Date().toISOString().slice(0, 10), ''];
  d.entries.forEach(function (e) {
    lines.push('## v' + e.versionName + (e.versionCode ? ' / #' + e.versionCode : '') + (e.publishedAt ? ' · ' + e.publishedAt.slice(0, 10) : ''));
    if (!e.compared) {
      lines.push('- 功能总数 ' + e.count + '（' + (e.reason || '无法逐项对比') + '）');
    } else {
      if (e.added.length) lines.push('- 新增：' + e.added.join('、'));
      if (e.removed.length) lines.push('- 移除：' + e.removed.join('、'));
      if (!e.added.length && !e.removed.length) lines.push('- 功能无增删（' + e.count + ' 项）');
    }
    lines.push('');
  });
  return lines.join('\n');
}

/* 文件级 diff：对比两版归档目录里的文件（大小 + sha256），给出新增/删除/大小变化。
   大文件也真算哈希，但按 (路径, 大小, mtime) 缓存，重复对比不会反复读盘。 */
const hashCache = new Map();

function fileHash(abs, st) {
  const key = abs + '|' + st.size + '|' + st.mtimeMs;
  if (hashCache.has(key)) return hashCache.get(key);
  let h = '';
  try {
    h = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  } catch (e) { h = ''; }
  hashCache.set(key, h);
  return h;
}

function dirFiles(dir) {
  const out = [];
  (function walk(d) {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    list.forEach(function (ent) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) { walk(abs); return; }
      const rel = path.relative(dir, abs).split(path.sep).join('/');
      const st = fs.statSync(abs);
      out.push({ name: rel, bytes: st.size, mb: Math.round(st.size / 1024 / 1024 * 100) / 100, hash: fileHash(abs, st) });
    });
  })(dir);
  return out;
}

function versionDir(v) {
  return path.join(RELEASES, 'v' + String(v).replace(/^v/, ''));
}

function diff(from, to) {
  const idx = jread(path.join(RELEASES, 'index.json'), { versions: [] });
  const names = (idx.versions || []).map(function (x) { return x.versionName; })
    .sort(function (a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true }); });
  const toV = to || names[names.length - 1];
  const fromV = from || names[names.length - 2];
  if (!fromV || !toV) return { ok: false, error: '归档里不足两版，无法对比' };
  const a = dirFiles(versionDir(fromV));
  const b = dirFiles(versionDir(toV));
  if (!a.length || !b.length) return { ok: false, error: '缺少归档目录：v' + (!a.length ? fromV : toV) };
  const mapA = {}, mapB = {};
  a.forEach(function (f) { mapA[f.name] = f; });
  b.forEach(function (f) { mapB[f.name] = f; });
  const added = [], removed = [], changed = [], same = [];
  b.forEach(function (f) {
    const old = mapA[f.name];
    if (!old) { added.push(f); return; }
    if (old.hash && f.hash) {
      if (old.hash !== f.hash) changed.push({ name: f.name, fromMB: old.mb, toMB: f.mb, deltaMB: Math.round((f.mb - old.mb) * 100) / 100, fromHash: old.hash.slice(0, 12), toHash: f.hash.slice(0, 12) });
      else same.push({ name: f.name, mb: f.mb });
    } else if (old.bytes !== f.bytes) {
      changed.push({ name: f.name, fromMB: old.mb, toMB: f.mb, deltaMB: Math.round((f.mb - old.mb) * 100) / 100 });
    } else { same.push({ name: f.name, mb: f.mb }); }
  });
  a.forEach(function (f) { if (!mapB[f.name]) removed.push(f); });
  return {
    ok: true, from: fromV, to: toV,
    versions: names,
    added: added, removed: removed, changed: changed, same: same,
    totals: { fromFiles: a.length, toFiles: b.length, added: added.length, removed: removed.length, changed: changed.length, same: same.length }
  };
}

module.exports = { releases, gates, logs, readLog, audit, sbom, distSize, changelog, changelogMarkdown, diff };

