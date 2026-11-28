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

  /* 客户 Setup 选源（1.7.87 返工固化）：只认 build-client-exe 写下的客户版指纹，
     不再拿 dist/desktop-setup.exe 或某个"权威哈希"去猜——那种猜法在 build-exe 阶段会读到
     开发端值，结果把开发端包归档进回滚索引（客户回滚就装到带 /admin 的包）。
     指纹缺失 / 版本不符 / 哈希不符，一律 exit 1。 */
  const clientStamp = require('./lib/client-stamp');
  const setupName = '鸿汇影桌面版 Setup ' + v + '.exe';
  const clientSetup = path.join(DIST, 'client', setupName);
  let setupSrc = clientSetup;
  let expectSha = '';
  let stamp = clientStamp.read(DIST, 'x64');
  if (!stamp) {
    if (!fs.existsSync(clientSetup)) {
      console.error('✗ 缺少客户版指纹，且 dist/client 下没有「' + setupName + '」。');
      console.error('  请先跑 node scripts/build-client-exe.js（归档只接受客户纯净包，不接受开发端产物）。');
      process.exit(1);
    }
    stamp = clientStamp.write(DIST, 'x64', v, clientSetup, null);
    console.log('  已补写客户版指纹（旧环境兼容）：dist/client/.client-build-x64.json');
  }
  if (String(stamp.version) !== v) {
    console.error('✗ 客户版指纹记录的版本是 ' + stamp.version + '，与当前 ' + v + ' 不一致（客户包是上一版残留）。');
    console.error('  请重跑 node scripts/build-client-exe.js 再归档。');
    process.exit(1);
  }
  const alias = path.join(DIST, 'desktop-setup.exe');
  const vr = clientStamp.verify(stamp, clientSetup);
  let devMode = false;
  if (!vr.ok) {
    if (process.env.KH_ARCHIVE_ALLOW_DEV !== '1') {
      console.error('✗ dist/client/' + setupName + ' 与客户版指纹不符：' + vr.reason);
      console.error('  拒绝归档：不确定是不是客户版，就绝不写进回滚索引。');
      process.exit(1);
    }
    /* 仅调试历史留档：显式放行，改用 dist 根产物，并在索引里标 channel=dev */
    const devSrc = [path.join(DIST, setupName), alias].find(p => fs.existsSync(p));
    if (!devSrc) { console.error('✗ 允许开发端归档，但 dist 根也找不到 ' + setupName); process.exit(1); }
    setupSrc = devSrc; expectSha = clientStamp.sha256File(devSrc); devMode = true;
    console.log('  [调试] KH_ARCHIVE_ALLOW_DEV=1：按开发端产物归档 ' + path.relative(ROOT, devSrc) + '（索引标 channel=dev）');
  } else {
    expectSha = vr.sha256;
    if (fs.existsSync(alias) && clientStamp.sha256File(alias) !== expectSha) {
      console.log('  提示：dist/desktop-setup.exe 与客户版不一致（多半是开发端中间产物），归档以 dist/client 为准。');
    }
  }
  if (!fs.existsSync(setupSrc)) { console.error('✗ 归档源消失：' + setupSrc); process.exit(1); }
  /* 显式放行开发端归档（仅调试历史留档）：KH_ARCHIVE_ALLOW_DEV=1 时才回退，且索引标 channel=dev */
  if (process.env.KH_ARCHIVE_ALLOW_DEV === '1' && vr.ok === false) {
    const devSrc = [path.join(DIST, setupName), alias].find(p => fs.existsSync(p));
    if (devSrc) { setupSrc = devSrc; expectSha = clientStamp.sha256File(devSrc); console.log('  [调试] 按 KH_ARCHIVE_ALLOW_DEV=1 归档开发端产物：' + path.relative(ROOT, devSrc)); }
  }
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

  /* 1.7.80：arm64 与 x64 同为客户版产物，归档一并留档，避免 ARM 设备回滚时无原生包可下。
     1.7.87 起同样走客户版指纹：指纹校验失败就跳过（arm64 缺失不阻断主线，但绝不写错包）。 */
  const armName = '鸿汇影桌面版 Setup ' + v + '-arm64.exe';
  const armClient = path.join(DIST, 'client', armName);
  let armCandidate = null;
  let armVerified = false;
  const armStamp = clientStamp.read(DIST, 'arm64');
  if (fs.existsSync(armClient) && armStamp) {
    const ar = clientStamp.verify(armStamp, armClient);
    if (ar.ok) { armCandidate = armClient; armVerified = true; }
    else console.log('  ⚠ arm64 客户包与指纹不符，跳过归档：' + ar.reason);
  } else if (fs.existsSync(armClient) && !armStamp) {
    try {
      clientStamp.write(DIST, 'arm64', v, armClient, null);
      armCandidate = armClient; armVerified = true;
      console.log('  已补写 arm64 客户版指纹（旧环境兼容）');
    } catch (e) { console.log('  ⚠ arm64 指纹补写失败：' + e.message); }
  } else {
    const armRoot = path.join(DIST, armName);
    if (fs.existsSync(armRoot)) {
      armCandidate = armRoot;
      console.log('  ⚠ arm64 没有客户版产物，退回 dist 根 ' + armName + '（归档标 unverified，回滚前请人工核对）');
    }
  }
  let armArt = null;
  if (armCandidate) {
    const destArm = path.join(dir, armName);
    fs.copyFileSync(armCandidate, destArm);
    armArt = { path: 'releases/v' + v + '/' + armName, size: fs.statSync(destArm).size,
               sha256: sha(destArm), verified: armVerified };
    console.log('arm64 安装包归档：' + path.relative(ROOT, armCandidate) + '（' + armArt.size + ' B · sha256 ' + armArt.sha256.slice(0, 12) + '…' + (armVerified ? '' : ' · 未校验') + '）');
    n++;
  }

  const cur = {
    versionName: v, versionCode: code,
    publishedAt: release.publishedAt || null,
    features: release.features || null,
    channel: devMode ? 'dev' : 'client',
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
