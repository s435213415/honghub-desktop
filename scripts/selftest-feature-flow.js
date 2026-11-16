#!/usr/bin/env node
'use strict';
/* 回归自检：反馈建议 → 自动提取新功能 → 自动添加 → 快照同步 → 批量分发清单。
 * 全程在临时目录里跑，绝不改动项目真实数据；断言失败也必定还原/清理。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const miner = require(path.join(ROOT, 'server', 'feature-miner.js'));
const archs = require(path.join(ROOT, 'scripts', 'build-archs.js'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-feature-flow-'));
let failed = 0;
function ok(s) { console.log('  OK   ' + s); }
function bad(s) { console.log('  FAIL ' + s); failed++; }
function p(n) { return path.join(TMP, n); }
function w(n, obj) { fs.writeFileSync(p(n), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) + '\n'); }

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}
process.on('exit', cleanup);

console.log('=== 自动新功能闭环回归自检 ===');
w('feedback.jsonl',
  JSON.stringify({ at: Date.now(), type: 'user', suggestions: ['需要自动批量下发'] }) + '\n' +
  JSON.stringify({ at: Date.now(), type: 'user', suggestions: ['希望适配所有架构电脑，播放要流畅、不卡顿'] }) + '\n' +
  JSON.stringify({ at: Date.now(), type: 'user', suggestions: ['自动提取反馈建议里新功能，功能自动添加到开发者端'] }) + '\n' +
  JSON.stringify({ at: Date.now(), type: 'user', suggestions: ['所有包不限设备，小内存老电脑也要能看，不限内存大小'] }) + '\n' +
  JSON.stringify({ at: Date.now(), type: 'user', suggestions: ['成品要自动更新，始终跟随最新版本，不用人工'] }) + '\n' +
  JSON.stringify({ at: Date.now(), type: 'user', suggestions: ['加入自动优化检测，跟随所有操作系统版本检测回传后自动优化修复后下发同步更新功能'] }) + '\n');
w('reports.jsonl', JSON.stringify({ id: 'selftest', issues: [{ msg: '深开鸿端反馈：批量更新、arm 架构、缓冲太久' }] }) + '\n');
w('features.json', []);
w('stamp.json', { versionName: '1.7.2', versionCode: 1000116, publishedAt: new Date().toISOString(), count: 0, ids: [], hash: crypto.createHash('sha256').update('[]').digest('hex').slice(0, 16) });
w('manifest.json', { release: { latest: { versionName: '1.7.2', versionCode: 1000116 } } });

const opts = {
  feedbackFile: p('feedback.jsonl'), reportsFile: p('reports.jsonl'),
  featuresFile: p('features.json'), stampFile: p('stamp.json'),
  minedFile: p('mined.json'), manifestFile: p('manifest.json')
};

let r;
try { r = miner.run(opts); } catch (e) { bad('miner.run 抛异常：' + e.message); process.exit(1); }
console.log('  提取候选：' + r.candidates.map(c => c.id).join(', '));
console.log('  自动添加：' + r.added.join(', '));
if (r.mode === 'auto-no-review') ok('零人工复核模式'); else bad('模式不是自动无复核');
if (r.added.length === 7) ok('7 类新功能全部自动添加（含不限内存 / 不限设备 / 自动更新 / OS 版本跟随）'); else bad('期望添加 7 项，实际 ' + r.added.length);

let feats = [];
try { feats = JSON.parse(fs.readFileSync(opts.featuresFile, 'utf8')); } catch (e) {}
if (feats.length === 7 && feats.every(f => /^builtin:/.test(f.action) && f.enabled === true && f.origin === 'feedback-auto'))
  ok('功能条目结构安全（仅内置 action / 默认启用 / 可追溯来源）');
else bad('功能条目结构异常：' + JSON.stringify(feats));

const stamp = JSON.parse(fs.readFileSync(opts.stampFile, 'utf8'));
const h = crypto.createHash('sha256').update(JSON.stringify(feats)).digest('hex').slice(0, 16);
if (stamp.count === 7 && stamp.hash === h && stamp.ids.length === 7 && Number(stamp.versionCode) === 1000116)
  ok('功能快照自动同步且应用版本未被抬高');
else bad('快照未同步或版本被误改：' + JSON.stringify(stamp));

const r2 = miner.run(Object.assign({}, opts, { noLog: true }));
if (r2.added.length === 0 && r2.skipped.length === 7) ok('重复运行幂等（不重复添加）');
else bad('幂等性失败：added=' + r2.added.length + ' skipped=' + r2.skipped.length);

const snap = archs.collect({ distDir: TMP, version: '1.7.2', stampFile: opts.stampFile });
if (snap.archs.x64 && snap.archs.ia32 && snap.archs.arm64 && snap.features.count === 7)
  ok('批量分发清单自动覆盖 x64 / ia32 / arm64 且带本次功能指纹');
else bad('批量清单结构异常：' + JSON.stringify(snap));
if (snap.archs.arm64.fallbackTo === 'x64') ok('缺原生包时自动回退通用包（不阻断分发）');
else bad('缺少回退策略');

// 不限设备 / 不限内存 + 自动更新：五类设备组合都必须拿到可用成品
const dp = require(path.join(ROOT, 'server', 'delivery-plan.js'));
const cur = Number(JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'manifest.json'), 'utf8')).release.latest.versionCode);
const base = { archs: snap };
const plans = {
  tinyWindows: dp.plan(Object.assign({}, base, { arch: 'arm64', mem: '512MB', os: 'Windows NT 10.0', code: cur })),
  bigWindows: dp.plan(Object.assign({}, base, { arch: 'x64', mem: '16', os: 'Windows NT 10.0', code: cur - 1 })),
  mac: dp.plan(Object.assign({}, base, { arch: 'x64', mem: '16', os: 'Macintosh', code: cur - 1 })),
  harmony: dp.plan(Object.assign({}, base, { arch: 'arm64', mem: '512MB', os: 'KaihongOS', platform: 'harmony', code: cur - 1 })),
  unknown: dp.plan(Object.assign({}, base, { mem: '0.5', code: cur - 1 }))
};
if (plans.tinyWindows.channel === 'lite' && plans.tinyWindows.install === false &&
    plans.tinyWindows.playback.maxBufferSize <= 6 * 1000 * 1000 && plans.tinyWindows.playback.maxBufferLength <= 4)
  ok('512MB 小内存：自动走免安装轻量版，缓冲硬上限 6MB / 4s，最低码率');
else bad('小内存选路或缓冲上限异常：' + JSON.stringify(plans.tinyWindows.playback));
if (plans.bigWindows.channel === 'full' && plans.bigWindows.update.needUpdate === true &&
    Number(plans.bigWindows.update.latest.versionCode) === cur)
  ok('Windows 旧版本：自动发现新版并下发版本 / 校验值（安装仍需确认）');
else bad('自动更新比对失败：' + JSON.stringify(plans.bigWindows.update));
if (plans.mac.channel === 'lite' && plans.harmony.channel === 'hap' && plans.unknown.channel === 'lite')
  ok('所有包不限设备：macOS / 深开鸿 / 未知设备各有可用通道，不下发装不了的包');
else bad('设备选路异常：' + JSON.stringify({ mac: plans.mac.channel, harmony: plans.harmony.channel, unknown: plans.unknown.channel }));
if (Object.keys(plans).every(k => plans[k].device.unrestricted && plans[k].update.autoContentUpdate))
  ok('每台设备自动保持内容最新（功能 / 源 / 播放档位），无需人工');
else bad('自动更新策略缺失');
const dsnap = dp.buildDelivery(snap);
if (Object.keys(dsnap.memoryTiers).length === 4 && Object.keys(dsnap.channels).length === 3 &&
    dsnap.devicePolicy.unrestricted && dsnap.autoUpdate.contentAlwaysLatest)
  ok('下发清单含 4 内存档 / 3 通道 / 不限设备 / 自动更新策略');
else bad('下发清单结构异常');

// OS 版本检测回传 → 自动优化 → 自动修复 → 下发同步更新（纯函数 / dryRun，不写真实数据）
const devOpt = require(path.join(ROOT, 'server', 'device-optimizer.js'));
const osRecs = [
  { deviceId: 't-win7', osFullName: 'Windows NT 6.1', osVersion: '6.1', arch: 'x64', mem: '1GB', appCode: cur - 1, platform: 'desktop' },
  { deviceId: 't-win11', osFullName: 'Windows NT 10.0', osVersion: '10.0', arch: 'x64', mem: '16GB', appCode: cur, platform: 'desktop' },
  { deviceId: 't-kaihong', osFullName: 'KaihongOS 5.0 API20', osVersion: '5.0', apiVersion: 20, arch: 'arm64', mem: '512MB', appCode: cur - 1, platform: 'harmony' },
  { deviceId: 't-mac', osFullName: 'Mac OS X 14.0', osVersion: '14.0', arch: 'x64', mem: '8GB', appCode: cur, platform: 'desktop' },
  { deviceId: 't-unknown', osFullName: '', arch: '', mem: '', appCode: cur - 1 }
];
const osResults = osRecs.map(devOpt.optimize);
if (osResults[0].family === 'windows' && osResults[0].compat.worker === false &&
    osResults[2].family === 'kaihongos' && osResults[2].channel === 'hap' &&
    osResults[3].family === 'macos' && osResults[4].family === 'unknown')
  ok('OS 版本检测：旧版 Windows / 深开鸿 / macOS / 未知系统自动分族并优化兼容策略');
else bad('OS 自动优化结果异常：' + JSON.stringify(osResults.map(r => r.family + ':' + r.compat.worker)));
if (osResults.every(r => r.auto && r.noReview && r.playback && r.update && r.fixes))
  ok('每台设备都得到自动优化 + 自动修复 + 下发同步更新结果（零人工复核）');
else bad('设备优化结果结构缺失');
if (osResults[0].fixes.some(f => f.id === 'stale-client') && osResults[4].fixes.some(f => f.id === 'mem-unknown'))
  ok('自动修复生效：旧客户端标记同步更新 / 内存未知按常规档兜底');
else bad('自动修复项未生成');
const osAll = devOpt.run({ dryRun: true });
if (osAll.followAllOSVersions && Object.keys(osAll.families).length >= 7 &&
    osAll.summary.manual === 0 && osAll.summary.unresolved === 0)
  ok('跟随所有操作系统版本：' + Object.keys(osAll.families).length + ' 个系统家族 / ' +
    osAll.summary.osVersions + ' 个版本，人工项 0');
else bad('全系统版本适配矩阵异常：' + JSON.stringify(osAll.summary));

try {
  const bf = require(path.join(ROOT, 'server', 'auto-bugfix.js')).run();
  const s = bf.summary || {};
  if (s.manual === 0 && s.unresolved === 0 && s.verified) ok('自动修 Bug 复检仍归零：' + JSON.stringify(s));
  else bad('自动修 Bug 结果异常：' + JSON.stringify(s));
} catch (e) { bad('自动修 Bug 调用失败：' + e.message); }

console.log(failed ? '\n自检失败：' + failed + ' 项' : '\n自检通过：反馈自动长出新功能 → 自动修复 → 自动批量下发，全程无需人工');
process.exit(failed ? 1 : 0);
