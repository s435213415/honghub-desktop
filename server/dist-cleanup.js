'use strict';
/* dist 体积治理：只清「归档副本」，不碰正在用的产物、不碰站点内部根目录。
   规则：
     - dist/_archive_public_versions/v1.7.x  按版本号保留最近 N 个，其余清理
     - dist/_历史版本_1.7.36前/*.zip        按文件名里的版本号保留最近 M 个
     - dist/_public_internal                 这是站点内部根目录，永不自动清理
   执行前先写清单（logs/dist-cleanup-<ts>.csv，逐文件大小），再删；dryRun 只出计划不动盘。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const LOGS = path.join(ROOT, 'logs');

const ARCHIVE_DIR = path.join(DIST, '_archive_public_versions');
const OLD_ZIP_DIR = path.join(DIST, '_历史版本_1.7.36前');
const CLIENT_DIR = path.join(DIST, 'client');
const CLIENT_OLD_DIR = path.join(CLIENT_DIR, '_旧版本');
const PROTECTED = ['_public_internal'];

function sizeOf(p) {
  let total = 0;
  let st = null;
  try { st = fs.statSync(p); } catch (e) { return 0; }
  if (st.isFile()) return st.size;
  (function walk(d) {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    list.forEach(function (ent) {
      const abs = path.join(d, ent.name);
      try {
        if (ent.isDirectory()) walk(abs);
        else if (ent.isFile()) total += fs.statSync(abs).size;
      } catch (e) {}
    });
  })(p);
  return total;
}

function mb(n) { return Math.round(n / 1024 / 1024 * 10) / 10; }

/* 从名字里抠版本号：v1.7.30 / 1.7.30 / 鸿汇影·开发端免安装_v1.7.8.zip */
function versionOf(name) {
  const m = String(name).match(/1\.7\.(\d+)/);
  return m ? Number(m[1]) : -1;
}

function classify(dir) {
  const items = [];
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return items; }
  list.forEach(function (ent) {
    if (!ent.isDirectory()) return;
    const abs = path.join(dir, ent.name);
    items.push({ name: ent.name, version: versionOf(ent.name), bytes: sizeOf(abs), dirs: 1 });
  });
  items.sort(function (a, b) { return b.version - a.version; });
  return items;
}

function plan(opts) {
  opts = opts || {};
  const keepVersions = Number(opts.keepVersions) > 0 ? Number(opts.keepVersions) : 5;
  const keepLegacy = Number(opts.keepZips) > 0 ? Number(opts.keepZips) : 3;

  const versions = classify(ARCHIVE_DIR);
  const keepV = versions.slice(0, keepVersions);
  const dropV = versions.slice(keepVersions);

  /* 旧安装包目录：平铺的 exe / blockmap / zip，按文件名里的版本号分组，整组保留最近 M 个版本 */
  const groups = {};
  let files = [];
  try { files = fs.readdirSync(OLD_ZIP_DIR).filter(function (f) { return /\.(zip|exe|blockmap)$/i.test(f); }); } catch (e) {}
  files.forEach(function (f) {
    const v = versionOf(f);
    const key = v >= 0 ? String(v) : 'unknown';
    if (!groups[key]) groups[key] = { version: v, files: [], bytes: 0 };
    let bytes = 0;
    try { bytes = fs.statSync(path.join(OLD_ZIP_DIR, f)).size; } catch (e) {}
    groups[key].files.push({ name: f, bytes: bytes, version: v });
    groups[key].bytes += bytes;
  });
  const knownGroups = Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) { return g.version >= 0; })
    .sort(function (a, b) { return b.version - a.version; });
  const keepG = knownGroups.slice(0, keepLegacy);
  const dropG = knownGroups.slice(keepLegacy);

  /* 客户版安装包：dist/client 本体 + dist/client/_旧版本，exe/zip 按版本整组保留最近 M 个 */
  const keepClients = Number(opts.keepClients) > 0 ? Number(opts.keepClients) : 2;
  let cFiles = [];
  [[CLIENT_DIR, ''], [CLIENT_OLD_DIR, '_旧版本']].forEach(function (pair) {
    const dir = pair[0], sub = pair[1];
    let list = [];
    try { list = fs.readdirSync(dir).filter(function (f) { return /\.(exe|zip)$/i.test(f); }); } catch (e) {}
    list.forEach(function (f) { cFiles.push({ name: f, sub: sub, dir: dir }); });
  });
  const cGroups = {};
  cFiles.forEach(function (f) {
    const v = versionOf(f.name);
    const key = v >= 0 ? String(v) : 'unknown';
    if (!cGroups[key]) cGroups[key] = { version: v, files: [], bytes: 0 };
    let bytes = 0;
    try { bytes = fs.statSync(path.join(f.dir, f.name)).size; } catch (e) {}
    cGroups[key].files.push({ name: f.name, bytes: bytes, version: v, dir: f.dir, sub: f.sub });
    cGroups[key].bytes += bytes;
  });
  const cKnown = Object.keys(cGroups).map(function (k) { return cGroups[k]; }).filter(function (g) { return g.version >= 0; })
    .sort(function (a, b) { return b.version - a.version; });
  const keepC = cKnown.slice(0, keepClients);
  const dropC = cKnown.slice(keepClients);

  const dropBytes = dropV.reduce(function (s, x) { return s + x.bytes; }, 0) +
    dropG.reduce(function (s, x) { return s + x.bytes; }, 0) +
    dropC.reduce(function (s, x) { return s + x.bytes; }, 0);
  const keptBytes = keepV.reduce(function (s, x) { return s + x.bytes; }, 0) +
    keepG.reduce(function (s, x) { return s + x.bytes; }, 0) +
    keepC.reduce(function (s, x) { return s + x.bytes; }, 0);

  return {
    ok: true, at: new Date().toISOString(),
    rules: { keepVersions: keepVersions, keepLegacy: keepLegacy, keepClients: keepClients, protectedDirs: PROTECTED },
    versionArchives: {
      total: versions.length, keep: keepV.map(function (x) { return x.name; }),
      drop: dropV.map(function (x) { return { name: x.name, mb: mb(x.bytes) }; }),
      dropMB: mb(dropV.reduce(function (s, x) { return s + x.bytes; }, 0))
    },
    legacyInstalls: {
      totalVersions: knownGroups.length, totalFiles: files.length,
      keep: keepG.map(function (g) { return 'v1.7.' + g.version + '（' + g.files.length + ' 个文件）'; }),
      drop: dropG.map(function (g) { return { name: 'v1.7.' + g.version, files: g.files.length, mb: mb(g.bytes), raw: g.files }; }),
      dropMB: mb(dropG.reduce(function (s, x) { return s + x.bytes; }, 0)),
      dropFiles: dropG.reduce(function (s, x) { return s + x.files.length; }, 0)
    },
    clientPackages: {
      totalVersions: cKnown.length, totalFiles: cFiles.length,
      keep: keepC.map(function (g) { return 'v1.7.' + g.version + '（' + g.files.length + ' 个文件）'; }),
      drop: dropC.map(function (g) { return { name: 'v1.7.' + g.version, files: g.files.length, mb: mb(g.bytes), raw: g.files }; }),
      dropMB: mb(dropC.reduce(function (s, x) { return s + x.bytes; }, 0)),
      dropFiles: dropC.reduce(function (s, x) { return s + x.files.length; }, 0)
    },
    reclaimMB: mb(dropBytes),
    keepMB: mb(keptBytes),
    willDropCount: dropV.length + dropG.reduce(function (s, x) { return s + x.files.length; }, 0) +
      dropC.reduce(function (s, x) { return s + x.files.length; }, 0)
  };
}

function run(opts) {
  opts = opts || {};
  const dryRun = opts.dryRun !== false;
  const p = plan(opts);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const manifest = [];
  const dropped = [];

  p.versionArchives.drop.forEach(function (x) {
    const abs = path.join(ARCHIVE_DIR, x.name);
    manifest.push({ kind: 'version-archive', name: x.name, path: abs, mb: x.mb });
    dropped.push(abs);
  });
  p.legacyInstalls.drop.forEach(function (g) {
    (g.raw || []).forEach(function (f) {
      const abs = path.join(OLD_ZIP_DIR, f.name);
      manifest.push({ kind: 'legacy-install', name: f.name, path: abs, mb: mb(f.bytes) });
      dropped.push(abs);
    });
  });
  p.clientPackages.drop.forEach(function (g) {
    (g.raw || []).forEach(function (f) {
      const abs = path.join(f.dir || CLIENT_DIR, f.name);
      manifest.push({ kind: 'client-package', name: (f.sub ? f.sub + '\\' : '') + f.name, path: abs, mb: mb(f.bytes) });
      dropped.push(abs);
    });
  });

  try {
    fs.mkdirSync(LOGS, { recursive: true });
    const csv = ['kind,name,path,mb'].concat(manifest.map(function (m) {
      return [m.kind, '"' + m.name.replace(/"/g, '""') + '"', '"' + m.path.replace(/"/g, '""') + '"', m.mb].join(',');
    })).join('\n');
    fs.writeFileSync(path.join(LOGS, 'dist-cleanup-' + stamp + (dryRun ? '.dryrun' : '') + '.csv'), csv + '\n', 'utf8');
  } catch (e) {}

  if (dryRun) {
    return { ok: true, dryRun: true, reclaimMB: p.reclaimMB, count: dropped.length, plan: p, manifestCSV: 'logs/dist-cleanup-' + stamp + '.dryrun.csv' };
  }

  let freed = 0, failed = [];
  dropped.forEach(function (abs) {
    let bytes = 0;
    try { bytes = sizeOf(abs); } catch (e) {}
    try {
      fs.rmSync(abs, { recursive: true, force: true });
      freed += bytes;
    } catch (e) {
      failed.push({ path: abs, error: e && e.message });
    }
  });
  return {
    ok: failed.length === 0, dryRun: false, freedMB: mb(freed), freedCount: dropped.length - failed.length,
    failed: failed, manifestCSV: 'logs/dist-cleanup-' + stamp + '.csv', after: plan(opts)
  };
}

module.exports = { plan, run };
