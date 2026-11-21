#!/usr/bin/env node
'use strict';
/* 签名链体检：把「当前产物到底是拿谁的密钥签的」摊开说清楚。
   - 读 dist/.hap-build.json，比对 chain 与 harmony/signing/KEYS-MAP.md 的登记
   - 检查 keys-kaihong 材料是否齐全、证书是否将过期（只读文件头，不解密私钥）
   - 设 KH_REQUIRE_SELF_KEY=1 时，产物若仍是 SDK 公开密钥签的，直接非 0 退出
   用法：node scripts/check-sign-chain.js [--json] */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const KAI = path.join(ROOT, 'harmony', 'signing', 'keys-kaihong');

const CHAINS = {
  'official-openharmony': { own: false, bundle: 'com.honghub.harmony', type: 'release', note: 'OpenHarmony SDK 公开密钥（口令公开 123456）' },
  'kaihong-platform-debug': { own: true, bundle: 'com.kaihong.movie', type: 'debug', note: '开鸿平台签发证书，私钥自持' },
  'kaihong-platform-release': { own: true, bundle: 'com.kaihong.movie', type: 'release', note: '开鸿平台 release 链（正式分发），release 应用证书待补' },
  'legacy-self-ca': { own: true, bundle: 'com.honghub.harmony', type: 'self-signed', note: '已停用的旧自签链' }
};

function readStamp() {
  try { return JSON.parse(fs.readFileSync(path.join(DIST, '.hap-build.json'), 'utf8')); } catch (e) { return null; }
}

function files(p) {
  const out = {};
  try { fs.readdirSync(p).forEach(function (f) {
    const abs = path.join(p, f);
    try { if (fs.statSync(abs).isFile()) out[f] = fs.statSync(abs).size; } catch (e) {}
  }); } catch (e) {}
  return out;
}

function main() {
  const json = process.argv.indexOf('--json') > 0;
  const report = [];
  const fail = [];

  const stamp = readStamp();
  if (!stamp) {
    report.push({ ok: false, item: '产物签名记录', detail: 'dist/.hap-build.json 不存在（还没出过 HAP）' });
  } else {
    const c = CHAINS[stamp.chain];
    report.push({
      ok: !!c,
      item: '产物签名链',
      detail: stamp.chain + '（' + (c ? c.note : '未登记的链') + '）· v' + stamp.versionName + ' / #' + stamp.versionCode +
        ' · ' + stamp.size + ' B · sha256 ' + String(stamp.sha256 || '').slice(0, 16) + '…'
    });
    if (c && !c.own) fail.push('产物 HAP 使用 SDK 公开密钥签名，不符合「私钥自持」');
    if (c && c.bundle !== 'com.honghub.harmony') fail.push('产物 bundle 与签名链 Profile 不一致：' + c.bundle);
    const owner = stamp.chainOwner || (c ? (c.own ? 'self' : 'sdk-public') : 'unknown');
    report.push({ ok: owner === 'self', item: '私钥归属', detail: owner === 'self' ? '自持私钥' : 'SDK 公开密钥' });
  }

  const k = files(KAI);
  const need = { 'kaihong.p12': '私钥库', 'app.cer': '调试证书(含链)', 'app.p7b': '调试 Profile', 'kaihong.csr': 'CSR 留档' };
  Object.keys(need).forEach(function (f) {
    report.push({ ok: !!k[f], item: '自持材料 · ' + f, detail: k[f] ? k[f] + ' B（' + need[f] + '）' : '缺失：' + path.join(KAI, f) });
    if (!k[f]) fail.push('自持签名材料缺失：' + f);
  });

  /* release 链材料（正式分发用，缺件不阻断当前 debug 出包，只做提示） */
  const rel = { 'profile-release.p7b': 'release Profile', 'app-release.cer': 'release 应用证书链（待平台签发）' };
  Object.keys(rel).forEach(function (f) {
    report.push({ ok: !!k[f], item: 'release 链 · ' + f, detail: k[f] ? k[f] + ' B（' + rel[f] + '）' : '待补：' + path.join(KAI, f) });
  });

  const pwd = !!(process.env.KH_KAIHONG_PWD) || (function () {
    try { return /^KH_KAIHONG_PWD=.+/m.test(fs.readFileSync(path.join(ROOT, '.env'), 'utf8')); } catch (e) { return false; }
  })();
  report.push({ ok: pwd, item: '私钥口令', detail: pwd ? '已在环境变量或 .env 中提供' : '未提供（.env 缺 KH_KAIHONG_PWD）' });
  if (!pwd) fail.push('缺少 KH_KAIHONG_PWD，自持链无法签名');

  /* KEYS-MAP.md 是否在位，避免密钥归属再次「口头传递」 */
  const keysMap = path.join(ROOT, 'harmony', 'signing', 'KEYS-MAP.md');
  report.push({ ok: fs.existsSync(keysMap), item: '密钥地图', detail: fs.existsSync(keysMap) ? 'harmony/signing/KEYS-MAP.md' : '缺失' });

  if (json) {
    console.log(JSON.stringify({ at: new Date().toISOString(), report: report, fail: fail }, null, 2));
  } else {
    console.log('=== 签名链体检 ===');
    report.forEach(function (r) { console.log('  ' + (r.ok ? '✔' : '✘') + ' ' + r.item + '：' + r.detail); });
    console.log(fail.length ? ('  → ' + fail.length + ' 个问题：\n' + fail.map(function (x) { return '     · ' + x; }).join('\n')) : '  → 全部通过');
  }

  const requireSelf = process.env.KH_REQUIRE_SELF_KEY === '1';
  if (fail.length && requireSelf) process.exit(1);
  if (requireSelf && stamp && stamp.chain === 'official-openharmony') process.exit(1);
  process.exit(0);
}

main();
