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

  /* 客户 Setup 选源：绝不盲信 desktop-setup.exe 别名——开发端构建会短暂覆盖它，
     且流水线后段（签名/重出包/交付）还会改写 exe 字节。权威哈希优先取
     dist/desktop-setup.exe.sha256（postpack/ship 最后重算），其次 release.json。
     候选里只收哈希与权威值一致的文件；含「开发端」的文件名一律拒收。 */
  let expectSha = '';
  try {
    const sf = path.join(DIST, 'desktop-setup.exe.sha256');
    if (fs.existsSync(sf)) expectSha = String(fs.readFileSync(sf, 'utf8')).trim().split(/\s+/)[0].toLowerCase();
  } catch (e) {}
  if (!expectSha) expectSha = String((release.artifacts && release.artifacts.desktop && release.artifacts.desktop.sha256) || '').toLowerCase();
  const setupName = '鸿汇影桌面版 Setup ' + v + '.exe';
  const candidates = [
    path.join(DIST, 'client', setupName),
    path.join(DIST, setupName),
    path.join(DIST, 'desktop-setup.exe')
  ];
  let setupSrc = null;
  for (const c of candidates) {
    if (c.indexOf('开发端') >= 0 || !fs.existsSync(c)) continue;
    if (expectSha && sha(c) !== expectSha) continue;   /* 与权威哈希不符的候选（中间产物/开发端覆盖）一律跳过 */
    setupSrc = c; break;
  }
  if (!setupSrc) { console.error('✗ 找不到与权威哈希一致的客户版 Setup（期望 ' + (expectSha || '未知').slice(0, 12) + '…），拒绝归档'); process.exit(1); }
  const setupDest = path.join(dir, setupName);
  fs.copyFileSync(setupSrc, setupDest);
  const setupSha = sha(setupDest), setupSize = fs.statSync(setupDest).size;
  if (expectSha && setupSha !== expectSha) {
    console.error('✗ 归档副本哈希与权威值不符，拒绝写入索引：' + setupSha + ' ≠ ' + expectSha);
    process.exit(1);
  }
  console.log('客户 Setup 归档源：' + path.relative(ROOT, setupSrc) + '（sha256 ' + setupSha.slice(0, 12) + '…）');

  const copies = [
    ['honghub-harmony.hap', 'HongHubMovie.hap'],
    ['release.json', 'release.json'],
    ['delivery.json', 'delivery.json'],
    ['archs.json', 'archs.json'],
    ['os-profiles.json', 'os-profiles.json'],
    ['.hap-build.json', '.hap-build.json']
  ];
  let n = 1;
  for (const [from, to] of copies) {
    const s = path.join(DIST, from);
    if (fs.existsSync(s)) { fs.copyFileSync(s, path.join(dir, to)); n++; }
  }

  /* 1.7.80：arm64 与 x64 同为客户版产物，归档一并留档，避免 ARM 设备回滚时无原生包可下 */
  const armName = '鸿汇影桌面版 Setup ' + v + '-arm64.exe';
  let armArt = null;
  for (const c of [path.join(DIST, 'client', armName), path.join(DIST, armName)]) {
    if (!fs.existsSync(c)) continue;
    const destArm = path.join(dir, armName);
    fs.copyFileSync(c, destArm);
    armArt = { path: 'releases/v' + v + '/' + armName, size: fs.statSync(destArm).size, sha256: sha(destArm) };
    console.log('arm64 安装包归档：' + path.relative(ROOT, c) + '（' + armArt.size + ' B · sha256 ' + armArt.sha256.slice(0, 12) + '…）');
    n++;
    break;
  }

  const cur = {
    versionName: v, versionCode: code,
    publishedAt: release.publishedAt || null,
    features: release.features || null,
    dir: 'releases/v' + v,
    artifacts: {
      desktop: { path: 'releases/v' + v + '/' + setupName, size: setupSize, sha256: setupSha },
      hap: { path: 'releases/v' + v + '/HongHubMovie.hap',
        size: (release.artifacts && release.artifacts.hap && release.artifacts.hap.size) || 0,
        sha256: (release.artifacts && release.artifacts.hap && release.artifacts.hap.sha256) || null }
    },
    downloadUrl: '/download/archive/' + encodeURIComponent(setupName),
    hapUrl: '/download/archive/HongHubMovie.hap',
    rollbackUrl: '/api/update/rollback?version=' + encodeURIComponent(v)
  };
  if (armArt) { cur.artifacts.arm64 = armArt; cur.arm64Url = '/download/archive/' + encodeURIComponent(armName); }

  // 历史安装包：登记 dist 根与 _archive_public_versions 里已有文件并算 hash，不复制大文件
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
  // 已归档历史版：_archive_public_versions/v<ver>/ 里的 Setup 或 desktop-setup.exe（别名也认，按真实文件名登记）
  const ARCH = path.join(DIST, '_archive_public_versions');
  if (fs.existsSync(ARCH)) {
    for (const vd of fs.readdirSync(ARCH)) {
      const vm = /^v(\d+\.\d+\.\d+)$/.exec(vd);
      if (!vm || seen.has(vm[1])) continue;
      const sub = path.join(ARCH, vd);
      let file = null;
      try {
        const names = fs.readdirSync(sub);
        file = names.find(x => /^鸿汇影桌面版 Setup \d+\.\d+\.\d+\.exe$/.test(x)) ||
               names.find(x => x === 'desktop-setup.exe') || null;
      } catch (e) { continue; }
      if (!file) continue;
      seen.add(vm[1]);
      const p = path.join(sub, file);
      const rel = 'dist/_archive_public_versions/' + vd + '/' + file;
      versions.push({
        versionName: vm[1], versionCode: null,
        dir: 'dist/_archive_public_versions/' + vd, historical: true,
        artifacts: { desktop: { path: rel, size: fs.statSync(p).size, sha256: sha(p) }, hap: null },
        downloadUrl: '/download/archive/v' + vm[1] + '/' + encodeURIComponent(file),
        rollbackUrl: '/api/update/rollback?version=' + encodeURIComponent(vm[1])
      });
    }
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
