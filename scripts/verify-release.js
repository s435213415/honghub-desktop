#!/usr/bin/env node
'use strict';
/* 交付验收：npm run pack 之后跑一次，确认「源码版本 / 发版清单 / 安装包 / HAP / 桌面交付 / 下载端点」完全一致。
   纯 Node 零依赖；只做只读检查与本机临时服务探测，不会启动安装向导、不会删除任何文件。
   任一硬伤 exit(1)。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DESKTOP = path.join(os.homedir(), 'Desktop');
const errs = [];
const ok = (m) => console.log('  [通过] ' + m);
const bad = (m) => { errs.push(m); console.error('  [失败] ' + m); };
const note = (m) => console.log('  [提示] ' + m);
const at = (...p) => path.join(ROOT, ...p);
const j = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const size = (p) => fs.statSync(p).size;

console.log('=== 交付验收 ===');

// 1) 版本基线：package.json / manifest / 功能快照 / 发版清单 / 两端页面
const pkg = j(at('package.json'), {});
const mf = j(at('server', 'manifest.json'), {});
const stamp = j(at('server', 'feature-version.json'), {});
const rel = j(path.join(DIST, 'release.json'), null);
const latest = (mf.release && mf.release.latest) || {};
const V = latest.versionName;
const C = Number(latest.versionCode);
if (!V || !Number.isFinite(C)) bad('中枢清单缺少有效版本号');
else {
  const chain = [
    ['package.json.version', pkg.version],
    ['功能快照 versionName', stamp.versionName],
    ['发版清单 versionName', rel && rel.versionName]
  ];
  for (const [k, v] of chain) {
    if (v !== V) bad(k + ' = ' + v + '，与中枢 ' + V + ' 不一致');
  }
  if (Number(stamp.versionCode) !== C || Number(rel && rel.versionCode) !== C) bad('versionCode 不一致');
  if (chain.every(([, v]) => v === V)) ok('版本基线一致：v' + V + ' #' + C + '（安装包 / 中枢 / 功能快照 / 产物清单）');
}
const packedPkg = j(path.join(DIST, 'win-unpacked', 'resources', 'app', 'package.json'), null);
if (!packedPkg) bad('包内 package.json 缺失（应用目录未生成）');
else if (packedPkg.version !== V) bad('包内 package.json.version = ' + packedPkg.version + ' ≠ ' + V);
else ok('包内应用版本与发版一致（v' + V + '）');
for (const p of ['app/index.html', 'harmony/entry/src/main/resources/rawfile/www/index.html']) {
  const s = fs.readFileSync(at(p), 'utf8');
  const code = Number((s.match(/var KH_APP_CODE\s*=\s*(\d+)/) || [])[1] || 0);
  if (code !== C) bad(p + ' KH_APP_CODE=' + code + ' ≠ ' + C + '（新装用户会误报更新）');
  else ok(p + ' 版本基线一致');
}

// 2) 产物与 SHA256
if (!rel || !rel.artifacts) bad('dist/release.json 缺失或缺少 artifacts');
else {
  for (const key of ['desktop', 'hap']) {
    const a = rel.artifacts[key];
    if (!a) { bad('release.json 缺少 ' + key + ' 产物'); continue; }
    const p = path.join(DIST, a.file);
    if (!fs.existsSync(p)) { bad('产物缺失：' + a.file); continue; }
    const real = sha(p);
    if (real !== a.sha256) bad(a.file + ' 实际 SHA256 与清单不符');
    else if (size(p) !== a.size) bad(a.file + ' 体积与清单不符');
    const sf = p + '.sha256';
    const sfOk = fs.existsSync(sf) && fs.readFileSync(sf, 'utf8').trim().split(/\s+/)[0].toLowerCase() === real;
    if (!sfOk) bad(a.file + '.sha256 缺失或不一致');
    if (real === a.sha256 && sfOk) ok(a.file + ' · ' + size(p) + ' B · sha256 ' + real.slice(0, 16) + '… 校验通过');
  }
}

// 3) 桌面交付物与 dist 产物逐字节一致
const setupName = '鸿汇影桌面版 Setup ' + V + '.exe';
for (const [src, dst] of [
  [path.join(DIST, 'desktop-setup.exe'), path.join(DESKTOP, setupName)],
  [path.join(DIST, 'honghub-harmony.hap'), path.join(DESKTOP, 'HongHubMovie.hap')]
]) {
  if (!fs.existsSync(dst)) { bad('桌面交付物缺失：' + dst); continue; }
  if (!fs.existsSync(src)) { bad('dist 产物缺失：' + src); continue; }
  if (sha(src) !== sha(dst)) bad('桌面与 dist 哈希不一致：' + path.basename(dst));
  else ok('桌面交付 ' + path.basename(dst) + ' (' + size(dst) + ' B) 与分发产物一致');
}
// 旧版本安装包只提示，绝不自动删除个人目录里的文件
for (const n of fs.existsSync(DESKTOP) ? fs.readdirSync(DESKTOP) : []) {
  if (/^鸿汇影桌面版 Setup .*\.exe$/i.test(n) && n !== setupName) note('桌面存在旧版安装包「' + n + '」，以 ' + setupName + ' 为准（未自动删除）');
}

// 3.5) 工程保障工具：自包含签名链 / HAP 新鲜度 / 版本归档 / SBOM
const zipRead = require('./lib/zip-read');
const SIGN_DIR = at('harmony', 'signing');
const hapStamp = j(path.join(DIST, '.hap-build.json'), null);
let signOk = true;
for (const f of ['_inject_honghub.py', 'sign-hap.py', 'entry-default-unsigned.hap',
  'sign-keys/app-key.p12', 'sign-keys/ca.p12', 'sign-keys/profile-key.p12']) {
  if (!fs.existsSync(path.join(SIGN_DIR, f))) { bad('项目内签名工作台缺 ' + f); signOk = false; }
}
if (signOk) ok('签名链已自包含（不再依赖桌面临时工作台）');
if (!hapStamp || Number(hapStamp.versionCode) !== C) bad('dist/.hap-build.json 缺失或版本不符');
else {
  const hp = path.join(DIST, 'honghub-harmony.hap');
  if (!fs.existsSync(hp) || sha(hp) !== hapStamp.sha256) bad('HAP 与本次构建指纹不一致（疑似旧包混入）');
  else {
    try {
      const html = zipRead.readText(hp, 'resources/rawfile/movie-site/index.html');
      const m = html.match(/var KH_APP_CODE\s*=\s*(\d+)/);
      if (!m || Number(m[1]) !== C) bad('HAP 包内前端版本与发版不一致');
      else ok('HAP 新鲜度通过：包内前端 #' + C + ' 与本次构建指纹一致');
    } catch (e) { bad('HAP 包内读取失败：' + e.message); }
  }
}
const rIdx = j(at('releases', 'index.json'), null);
if (!rIdx || !Array.isArray(rIdx.versions) || !rIdx.versions.length) bad('版本归档索引缺失（npm run archive）');
else if (Number((rIdx.latest || {}).versionCode) !== C) bad('归档索引最新版本与发版不一致');
else ok('版本归档 ' + rIdx.versions.length + ' 个版本可回滚（最新 v' + V + '）');
const bom = j(path.join(DIST, 'sbom.json'), null);
if (!bom || !Array.isArray(bom.components) || !bom.components.length) note('SBOM 未生成（npm run sbom）');
else ok('SBOM 已生成：' + bom.components.length + ' 个依赖组件');

// 4) 起临时中枢，验证接口与两个下载端点（HEAD，避免把 77MB 读进内存）
const PORT = 9500 + Math.floor(Math.random() * 300);
const srv = spawn(process.execPath, [at('server', 'server.js')], {
  cwd: ROOT,
  env: Object.assign({}, process.env, {
    PORT: String(PORT), AUTO_RUN_ENABLED: '0', AUTO_OPTIMIZE: '0', AUTO_GOVERN: '0', KH_ACCESS_TOKEN: ''
  }),
  stdio: 'ignore'
});
function req(pathname, method, body, extraHeaders) {
  return new Promise((resolve) => {
    const base = body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {};
    const headers = Object.assign(base, extraHeaders || {});
    const r = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: method || 'GET', timeout: 4000, headers }, (res) => {
      let b = '';
      res.on('data', (d) => { if (b.length < 2 * 1024 * 1024) b += d; });
      res.on('end', () => resolve({ code: res.statusCode, body: b, len: res.headers['content-length'], headers: res.headers }));
      if (method === 'HEAD') res.resume();
    });
    r.on('timeout', () => { r.destroy(); resolve({ code: 0, body: '' }); });
    r.on('error', () => resolve({ code: 0, body: '' }));
    if (body) r.write(body);
    r.end();
  });
}
(async () => {
  let healthy = false;
  for (let i = 0; i < 30 && !healthy; i++) {
    const r = await req('/health');
    healthy = r.code === 200 && /"ok":true/.test(r.body);
    if (!healthy) await new Promise((r) => setTimeout(r, 200));
  }
  if (!healthy) bad('临时中枢未能启动');
  else {
    const h = JSON.parse((await req('/health')).body);
    if (!Array.isArray(h.hubs) || !h.hubs.length) bad('/health 未返回中枢候选地址');
    else ok('临时中枢正常，/health 返回 ' + h.hubs.length + ' 个候选地址');
    const checks = [
      ['/', 200, '在线看板'],
      ['/api/manifest', 200, '发布清单'],
      ['/api/features', 200, '功能接口'],
      ['/api/features/sync', 200, '功能同步接口'],
      ['/api/bugfix', 200, '自动修 Bug 状态'],
      ['/api/batch', 200, '自动批量下发清单'],
      ['/api/flow', 200, '自治闭环聚合'],
      ['/api/delivery', 200, '不限设备下发清单'],
      ['/api/delivery/plan?arch=x64&mem=512MB&os=Windows&code=1', 200, '设备自动选路与更新比对'],
      ['/api/device/optimization', 200, 'OS 版本自动优化结果'],
      ['/api/devices', 200, '设备与系统版本清单'],
      ['/api/releases', 200, '版本归档清单'],
      ['/api/update/rollback?version=' + encodeURIComponent(V), 200, '历史版本回滚引导'],
      ['/api/health/diagnostics', 200, '运行健康诊断'],
      ['/download/desktop-setup.exe', 200, '桌面更新包下载'],
      ['/download/honghub-harmony.hap', 200, 'HAP 更新包下载'],
      ['/download/archive/HongHubMovie.hap', 200, '归档 HAP 下载']
    ];
    for (const [p, code, label] of checks) {
      const r = await req(p, p.indexOf('/download/') === 0 ? 'HEAD' : 'GET');
      if (r.code !== code) bad(label + '（' + p + '）HTTP ' + r.code);
      else ok(label + ' HTTP 200');
    }
    const ranged = await req('/download/desktop-setup.exe', 'GET', null, { Range: 'bytes=0-99' });
    if (ranged.code !== 206 || String(ranged.len) !== '100' ||
      !/^bytes 0-99\/\d+$/.test(String((ranged.headers || {})['content-range'] || ''))) {
      bad('Range 断点续传未生效（HTTP ' + ranged.code + '）');
    } else ok('Range 断点续传正常（206 · 100B · Content-Range 正确）');
    const man = JSON.parse((await req('/api/manifest')).body);
    if (!man.release || !man.release.artifacts) bad('/api/manifest 未附带产物校验信息');
    else ok('/api/manifest 已附带 desktopSha256 / hapSha256');
    const fsy = JSON.parse((await req('/api/features/sync')).body);
    if (!fsy.ok || !fsy.version || Number(fsy.version.versionCode) !== C) bad('/api/features/sync 版本不同步');
    else ok('功能接口版本 #' + C + ' 与发版一致（' + (fsy.features || []).length + ' 项）');
    const bf = await req('/api/bugfix/run', 'POST');
    let s = null;
    try { s = (JSON.parse(bf.body).result || {}).summary; } catch (e) { /* 下方报错 */ }
    if (bf.code !== 200 || !s) bad('/api/bugfix/run 返回异常（HTTP ' + bf.code + '）');
    else if (s.manual > 0 || s.unresolved > 0 || !s.verified) {
      bad('自动修 Bug 未形成全自动闭环：manual=' + s.manual + ' unresolved=' + s.unresolved + ' verified=' + s.verified);
    } else if (s.autoHandled !== s.total) {
      bad('自动修 Bug 存在未自动处置项：' + s.autoHandled + '/' + s.total);
    } else ok('自动修 Bug 全自动闭环通过：total=' + s.total + ' 自动处置=' + s.autoHandled +
      ' 第 ' + s.rounds + ' 轮复检归零 · 无需人工复核');
    // 治理循环不得制造假更新
    const before = C;
    const gov = await req('/api/govern/run', 'POST');
    await new Promise((r) => setTimeout(r, 600));
    const after = Number(((j(at('server', 'manifest.json'), {}).release || {}).latest || {}).versionCode);
    if (gov.code !== 200) bad('/api/govern/run HTTP ' + gov.code);
    else if (after !== before) bad('治理循环抬高了应用版本（' + before + ' → ' + after + '），会造成假更新');
    else ok('治理循环未抬高应用版本（#' + after + ' 保持不变）');

    // 自动下发成品：所有包不限设备 / 不限内存 + 自动更新比对
    try {
      const dvFile = j(path.join(DIST, 'delivery.json'), null);
      if (!dvFile) bad('dist/delivery.json 缺失（自动批量下发清单未生成）');
      else if (Object.keys(dvFile.memoryTiers || {}).length !== 4 || Object.keys(dvFile.channels || {}).length !== 3 ||
        !dvFile.devicePolicy || !dvFile.devicePolicy.unrestricted || !dvFile.autoUpdate ||
        !dvFile.autoUpdate.contentAlwaysLatest || Number(dvFile.versionCode) !== C) bad('dist/delivery.json 结构或版本异常');
      else if (!dvFile.osProfiles || !dvFile.osProfiles.followAllOSVersions) bad('dist/delivery.json 缺 OS 版本适配矩阵');
      else ok('下发清单 v' + V + ' · 4 内存档 / 3 通道 / 不限设备 / 自动更新 / OS 版本适配齐备');
      const dv = JSON.parse((await req('/api/delivery')).body);
      if (!dv.ok || !dv.delivery || !dv.delivery.channels) bad('/api/delivery 未返回下发清单');
      else ok('/api/delivery 下发清单接口正常');
      const combos = [
        ['小内存 Windows', '/api/delivery/plan?arch=arm64&mem=512MB&os=Windows&code=' + (C - 1), 'lite'],
        ['大内存 Windows', '/api/delivery/plan?arch=x64&mem=16&os=Windows&code=' + (C - 1), 'full'],
        ['macOS', '/api/delivery/plan?arch=x64&mem=16&os=Macintosh&code=' + (C - 1), 'lite'],
        ['深开鸿', '/api/delivery/plan?arch=arm64&mem=512MB&os=KaihongOS&platform=harmony&code=' + (C - 1), 'hap'],
        ['未知设备', '/api/delivery/plan?mem=0.5&code=' + (C - 1), 'lite']
      ];
      let good = true;
      for (const [label, url, want] of combos) {
        const r = JSON.parse((await req(url)).body);
        if (!r.ok || r.channel !== want || !r.device || !r.device.unrestricted || !r.update || !r.update.autoContentUpdate) {
          bad('设备组合「' + label + '」选路异常：channel=' + r.channel + ' 期望=' + want); good = false;
        }
      }
      if (good) ok('5 类设备 / 内存组合均有可用成品（所有包不限设备、不限内存）');
      const pTiny = JSON.parse((await req(combos[0][1])).body);
      if (pTiny.install !== false || pTiny.playback.maxBufferSize > 6 * 1000 * 1000 || pTiny.playback.maxBufferLength > 4)
        bad('低内存播放参数未设硬上限');
      else ok('512MB 设备自动走免安装版：缓冲硬上限 ' + (pTiny.playback.maxBufferSize / 1000000) +
        'MB / ' + pTiny.playback.maxBufferLength + 's · 最低码率');
      const pOld = JSON.parse((await req(combos[1][1])).body);
      const pCur = JSON.parse((await req('/api/delivery/plan?arch=x64&mem=16&os=Windows&code=' + C)).body);
      if (!pOld.update.needUpdate || Number(pOld.update.latest.versionCode) !== C || pCur.update.needUpdate)
        bad('自动更新版本比对异常（旧版未提示 / 新版误提示）');
      else ok('自动更新比对正确：旧版 #' + (C - 1) + ' 提示新版，当前 #' + C + ' 不误报');

      // OS 版本检测 → 回传 → 自动优化 → 自动修复 → 下发同步更新（且不制造假更新）
      const reportBody = JSON.stringify({
        schema: 1, app: 'HongHub', kind: 'device-profile', deviceId: 'verify-win7',
        osFullName: 'Windows NT 6.1', osVersion: '6.1', ua: 'Windows NT 6.1',
        arch: 'x64', mem: '1GB', appCode: C - 1, platform: 'desktop'
      });
      const rep = JSON.parse((await req('/api/device/report', 'POST', reportBody)).body);
      if (!rep || !rep.ok) bad('/api/device/report 设备回传失败');
      else if (!rep.optimization || rep.optimization.family !== 'windows' || rep.optimization.compat.worker !== false)
        bad('旧版 Windows 未自动优化为保守兼容策略');
      else if (!rep.summary || rep.summary.manual !== 0 || rep.summary.families < 7)
        bad('OS 自动优化未覆盖所有系统家族或存在人工项');
      else ok('OS 版本检测回传 → 自动优化修复 → 同步下发通过（' + rep.summary.families +
        ' 家族 / ' + rep.summary.osVersions + ' 版本 / 人工项 0）');
      const afterReport = Number(((j(at('server', 'manifest.json'), {}).release || {}).latest || {}).versionCode);
      if (afterReport !== C) bad('设备回传 / 自动优化抬高了应用版本（假更新）');
      else ok('设备回传与自动优化未抬高应用版本（#' + C + '）');
      const opt = JSON.parse((await req('/api/delivery/plan?arch=arm64&mem=512MB&os=KaihongOS&platform=harmony&code=' + C)).body);
      if (!opt.osProfile || opt.osProfile.family !== 'kaihongos' || !opt.optimization || !opt.optimization.auto)
        bad('/api/delivery/plan 未附带 OS 版本自动优化结果');
      else ok('下发计划已附带深开鸿 OS 版本适配与自动优化结果');
    } catch (e) { bad('下发 / 自动更新验收异常：' + e.message); }
  }
  try { srv.kill(); } catch (e) { /* 已退出 */ }
  console.log('\n' + (errs.length ? '交付验收未通过（' + errs.length + ' 项）' : '交付验收全部通过'));
  process.exit(errs.length ? 1 : 0);
})();
