#!/usr/bin/env node
'use strict';
/* 版本归档 + 可回滚索引。每次发版把当前产物收进 releases/vX/，
   并把 dist 里遗留的历史安装包登记为可下载地址（只算 hash，不重复复制大文件）。
   刻意不用硬链接：postpack 会覆盖 dist 内文件，硬链接会写穿已归档的旧版本。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const REL = path.join(ROOT, 'releases');

function sha(file) {
  const h = crypto.createHash('sha256'), fd = fs.openSync(file, 'r'), buf = Buffer.allocUnsafe(1 << 20);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return h.digest('hex');
}
function verKey(v) { return String(v).split('.').map(x => parseInt(x, 10) || 0); }
function cmp(a, b) {
  const x = verKey(a), y = verKey(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i];
  return 0;
}

function main() {
  const relFile = path.join(DIST, 'release.json');
  if (!fs.existsSync(relFile)) { console.error('缺少 dist/release.json，请先 npm run pack'); process.exit(1); }
  const release = JSON.parse(fs.readFileSync(relFile, 'utf8'));
  const v = String(release.versionName || '');
  const code = Number(release.versionCode || 0);
  if (!v || !code) { console.error('release.json 版本字段非法'); process.exit(1); }

  fs.mkdirSync(REL, { recursive: true });
  const dir = path.join(REL, 'v' + v);
  fs.mkdirSync(dir, { recursive: true });
  const copies = [
    ['desktop-setup.exe', '鸿汇影桌面版 Setup ' + v + '.exe'],
    ['honghub-harmony.hap', 'HongHubMovie.hap'],
    ['release.json', 'release.json'],
    ['delivery.json', 'delivery.json'],
    ['archs.json', 'archs.json'],
    ['os-profiles.json', 'os-profiles.json'],
    ['.hap-build.json', '.hap-build.json']
  ];
  let n = 0;
  for (const [from, to] of copies) {
    const s = path.join(DIST, from);
    if (fs.existsSync(s)) { fs.copyFileSync(s, path.join(dir, to)); n++; }
  }

  const cur = {
    versionName: v, versionCode: code,
    publishedAt: release.publishedAt || null,
    features: release.features || null,
    dir: 'releases/v' + v,
    artifacts: {
      desktop: { path: 'releases/v' + v + '/鸿汇影桌面版 Setup ' + v + '.exe',
        size: (release.artifacts && release.artifacts.desktop && release.artifacts.desktop.size) || 0,
        sha256: (release.artifacts && release.artifacts.desktop && release.artifacts.desktop.sha256) || null },
      hap: { path: 'releases/v' + v + '/HongHubMovie.hap',
        size: (release.artifacts && release.artifacts.hap && release.artifacts.hap.size) || 0,
        sha256: (release.artifacts && release.artifacts.hap && release.artifacts.hap.sha256) || null }
    },
    downloadUrl: '/download/archive/' + encodeURIComponent('鸿汇影桌面版 Setup ' + v + '.exe'),
    hapUrl: '/download/archive/HongHubMovie.hap',
    rollbackUrl: '/api/update/rollback?version=' + encodeURIComponent(v)
  };

  // 历史安装包：只登记 dist 内已有文件并算 hash，不再复制一份占用磁盘
  const versions = [cur];
  const seen = new Set([v]);
  for (const name of fs.readdirSync(DIST)) {
    const m = /^鸿汇影桌面版 Setup (\d+\.\d+\.\d+)\.exe$/.exec(name);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const p = path.join(DIST, name);
    versions.push({
      versionName: m[1], versionCode: null,
      dir: 'dist', historical: true,
      artifacts: { desktop: { path: 'dist/' + name, size: fs.statSync(p).size, sha256: sha(p) }, hap: null },
      downloadUrl: '/download/' + encodeURIComponent(name),
      rollbackUrl: '/api/update/rollback?version=' + encodeURIComponent(m[1])
    });
  }
  versions.sort((a, b) => cmp(a.versionName, b.versionName));

  const index = { schema: 1, generatedAt: new Date().toISOString(),
    latest: { versionName: v, versionCode: code }, versions };
  fs.writeFileSync(path.join(REL, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  console.log('归档 v' + v + '：复制 ' + n + ' 个产物到 releases/v' + v + '/');
  console.log('回滚索引：' + versions.length + ' 个版本（最新 v' + v + ' / #' + code + '）');
  console.log('dist 内历史 exe 仍保留原处，未删除任何文件。');
}

main();
