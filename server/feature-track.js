'use strict';
/* 客户端功能追踪：把「客户端包里到底有哪些功能」变成可追溯的记录。
   - 每版功能清单（id 列表 + 数量 + 指纹）落一份到 server/data/features-history.jsonl
   - 与公网清单（线上版本）比对，得出新增 / 移除
   - 与上一版比对，得出这一版加/减了什么
   目的：后期维护时不用翻代码就知道「这个功能是哪一版上的、现在线上有没有」。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const HIST = path.join(DATA_DIR, 'features-history.jsonl');
const MAX_KEEP = 200;

let distribute = null;
try { distribute = require('./distribute'); } catch (e) { distribute = null; }

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function normalize(f) {
  if (!f) return null;
  const ids = Array.isArray(f.ids) ? f.ids.map(String) : [];
  return {
    versionName: f.versionName || null,
    versionCode: Number(f.versionCode) || null,
    count: Number(f.count) || ids.length,
    hash: String(f.hash || ''),
    ids: ids
  };
}

/* 本机包内功能：优先读 dist/remote-manifest.json（出包时写好的快照），
   没有就退回随包的 server/manifest.json。 */
function localFeatures() {
  const d = readJson(path.join(ROOT, 'dist', 'remote-manifest.json'));
  if (d && d.features) return Object.assign({ source: 'dist' }, normalize(d.features));
  const m = readJson(path.join(__dirname, 'manifest.json'));
  const lf = m && m.release && m.release.latest && m.release.latest.features;
  if (lf) return Object.assign({ source: 'manifest' }, normalize(lf));
  return null;
}

function remoteFeatures() {
  if (!distribute) return null;
  try {
    const p = distribute.published();
    if (p && p.features) return Object.assign({ source: 'public-manifest', baseUrl: p.baseUrl || null }, normalize(p.features));
    if (p && p.desktopUrl) {
      // 线上清单没带 features 时，退化为「版本已知、功能未知」，不编造
      return {
        source: 'public-manifest',
        versionName: p.versionName || null,
        versionCode: Number(p.versionCode) || null,
        count: 0, hash: '', ids: [], noFeatures: true,
        baseUrl: p.baseUrl || null
      };
    }
  } catch (e) { /* 无公网配置 */ }
  return null;
}

function diffIds(a, b) {
  const sa = new Set((a && a.ids) || []);
  const sb = new Set((b && b.ids) || []);
  const added = Array.from(sb).filter((x) => !sa.has(x));
  const removed = Array.from(sa).filter((x) => !sb.has(x));
  return { added, removed };
}

function readHistory() {
  const out = [];
  try {
    for (const line of fs.readFileSync(HIST, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch (e) { /* 跳过坏行 */ }
    }
  } catch (e) { /* 还没记录 */ }
  return out;
}

/* 版本/功能指纹变化时落一条历史；同版重复调用不重复写。 */
function record(snap) {
  if (!snap) return null;
  const hist = readHistory();
  const last = hist.length ? hist[hist.length - 1] : null;
  const same = last && Number(last.versionCode) === Number(snap.versionCode) && String(last.hash) === String(snap.hash);
  if (same) {
    return { changed: false, entry: last, prev: hist.length > 1 ? hist[hist.length - 2] : null };
  }
  const entry = {
    at: new Date().toISOString(),
    versionName: snap.versionName,
    versionCode: snap.versionCode,
    count: snap.count,
    hash: snap.hash,
    ids: snap.ids
  };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(HIST, JSON.stringify(entry) + '\n');
    const all = hist.concat([entry]);
    if (all.length > MAX_KEEP) {
      const keep = all.slice(-MAX_KEEP);
      fs.writeFileSync(HIST, keep.map((x) => JSON.stringify(x)).join('\n') + '\n');
    }
  } catch (e) { /* 落盘失败不影响接口返回 */ }
  return { changed: true, entry, prev: last };
}

function status() {
  const local = localFeatures();
  const remote = remoteFeatures();
  const rec = record(local);
  const hist = readHistory();
  const vsRemote = (local && remote && !remote.noFeatures)
    ? diffIds(local, remote)
    : { added: [], removed: [] };
  const vsPrev = (rec && rec.prev) ? diffIds(rec.prev, rec.entry) : { added: [], removed: [] };
  return {
    ok: true,
    local,
    remote,
    vsRemote,
    vsPrev,
    changed: rec ? rec.changed : null,
    trackedSince: hist.length ? hist[0].at : null,
    versions: hist.slice(-12).reverse().map((h) => ({
      at: h.at, versionName: h.versionName, versionCode: h.versionCode, count: h.count, hash: h.hash
    }))
  };
}

module.exports = { status, localFeatures, remoteFeatures, diffIds, readHistory };
