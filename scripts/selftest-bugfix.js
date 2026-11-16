#!/usr/bin/env node
'use strict';
/* 自动修 Bug 回归自检（scripts/selftest-bugfix.js）
   注入 4 类真实故障 → 跑一轮全自动闭环 → 断言「全部自动处置 + 自动复检归零 + 无需人工复核」
   → 无条件还原所有文件。用于验证 auto-bugfix 没有退化成「只报告不修」。
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const bugfix = require(path.join(ROOT, 'server', 'auto-bugfix.js'));

const APP = path.join(ROOT, 'app', 'index.html');
const STAMP = path.join(ROOT, 'server', 'feature-version.json');
const SHA = path.join(ROOT, 'dist', 'desktop-setup.exe.sha256');
const DATA = path.join(ROOT, 'server', 'data');
const RESULT = path.join(DATA, 'latest_bugfix.json');
const TARGETS = [APP, STAMP, SHA, RESULT,
  path.join(ROOT, 'dist', 'release.json'),
  path.join(ROOT, 'features', 'manifest.json'),
  path.join(DATA, 'snapshots', 'app.html'),
  path.join(DATA, 'snapshots', 'harmony.html'),
  path.join(DATA, 'bugfix_queue.jsonl'),
  path.join(DATA, 'bugfix_handled_errors.jsonl'),
  path.join(DATA, 'bugfix_error_watermark.json')];
const backup = new Map();
const errs = [];
function ok(s) { console.log('  ✅ ' + s); }
function bad(s) { errs.push(s); console.log('  ❌ ' + s); }
function scriptsBad(html) {
  let n = 0;
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/application\/json/.test(m[1]) || !m[2].trim()) continue;
    try { new vm.Script(m[2]); } catch (e) { n += 1; }
  }
  return n;
}
function restore() {
  for (const p of TARGETS) {
    if (!backup.has(p)) continue;
    const v = backup.get(p);
    try { if (v === null) { fs.unlinkSync(p); } else { fs.writeFileSync(p, v); } } catch (e) {}
  }
}

console.log('自动修 Bug 回归自检（全自动 · 无需人工复核）');
let ran = false;
try {
  for (const p of TARGETS) backup.set(p, fs.existsSync(p) ? fs.readFileSync(p) : null);
  if (!fs.existsSync(APP) || !fs.existsSync(STAMP) || !fs.existsSync(SHA)) {
    throw new Error('缺少待注入文件，请先 npm run pack');
  }
  // 先跑一轮干净体检，确保 last-known-good 快照存在（模拟真实运行）
  bugfix.run();

  /* 1) 前端脚本语法错误：复刻「看板所有按钮失效」那类事故 */
  const html = fs.readFileSync(APP, 'utf8');
  const blocks = Array.from(html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g));
  const m = blocks.find((x) => !/application\/json/.test(x[1]) && x[2].trim());
  if (!m) throw new Error('未找到可注入的前端脚本段');
  const at = m.index + m[0].indexOf(m[2]);
  let broken = html.slice(0, at) + '\n(function(){ /* __KH_SELFTEST_BROKEN__ */\n' + html.slice(at);
  /* 2) 页面版本基线漂移 */
  broken = broken.replace(/var KH_APP_CODE\s*=\s*\d+\s*;/, 'var KH_APP_CODE = 1;');
  fs.writeFileSync(APP, broken);
  /* 3) 功能快照过期 */
  const stamp = JSON.parse(fs.readFileSync(STAMP, 'utf8'));
  stamp.hash = 'deadbeefdeadbeef';
  fs.writeFileSync(STAMP, JSON.stringify(stamp, null, 2) + '\n');
  /* 4) 更新包校验值损坏 */
  fs.writeFileSync(SHA, '0000000000000000000000000000000000000000000000000000000000000000  desktop-setup.exe\n');

  if (scriptsBad(broken) < 1) bad('故障注入失败：脚本语法仍是正常的');
  else ok('已注入 4 类故障：脚本语法 / 页面版本 / 功能快照 / 产物校验值');

  const r = bugfix.run();
  ran = true;
  const s = r.summary || {};
  console.log('  本轮结果：' + JSON.stringify(s));
  if (s.total < 3) bad('自动提取漏报（total=' + s.total + '，预期 >=3）');
  else ok('自动提取到 ' + s.total + ' 项问题');
  if (s.fixed !== s.total) bad('仍有未自动处置项（fixed=' + s.fixed + '/' + s.total + '）');
  else ok('全部问题均已自动处置（fixed=' + s.fixed + '/' + s.total + '）');
  if (s.manual !== 0) bad('仍存在需人工复核项（manual=' + s.manual + '）');
  else ok('无需人工复核项（manual=0）');
  if (!s.verified || s.unresolved !== 0) bad('自动复检未归零（verified=' + s.verified + ' unresolved=' + s.unresolved + '）');
  else ok('自动复检归零（第 ' + s.rounds + ' 轮通过）');

  const fixedHtml = fs.readFileSync(APP, 'utf8');
  if (scriptsBad(fixedHtml) !== 0) bad('修复后前端脚本仍有语法错误');
  else ok('修复后前端整页脚本语法复检通过');
  if (fixedHtml.indexOf('__KH_SELFTEST_BROKEN__') >= 0) bad('仍残留注入的破损代码（未走同版本良好副本恢复）');
  else ok('已从同版本良好副本恢复，破损代码未残留');
  if (fixedHtml.indexOf('function khInstallUpdate') < 0 || fixedHtml.indexOf('function toast(') < 0) bad('关键业务函数丢失（语法通过但逻辑被包裹/隔离）');
  else ok('关键业务函数完整保留（无语义级破坏）');
  const code = Number((fixedHtml.match(/var KH_APP_CODE\s*=\s*(\d+)/) || [])[1] || 0);
  const stampAfter = JSON.parse(fs.readFileSync(STAMP, 'utf8'));
  if (code !== Number(stampAfter.versionCode)) bad('页面版本未自动同步回 #' + stampAfter.versionCode + '（当前 ' + code + '）');
  else ok('页面版本已自动同步回 #' + code);
  if (stampAfter.hash === 'deadbeefdeadbeef') bad('功能快照未自动重算');
  else ok('功能快照已自动重算（' + stampAfter.hash + '）');
  const shaAfter = fs.readFileSync(SHA, 'utf8').trim().split(/\s+/)[0];
  if (/^0{64}$/.test(shaAfter)) bad('产物校验值未自动重算');
  else ok('产物 SHA256 已自动重算（' + shaAfter.slice(0, 12) + '…）');
} catch (e) {
  bad('自检异常：' + (e && e.stack || e));
} finally {
  restore();
  // 还原后再跑一轮，让看板 / latest_bugfix.json 回到干净状态
  try { bugfix.run(); } catch (e) {}
  console.log('\n' + (errs.length ? '自检未通过（' + errs.length + ' 项）' : '自检全部通过：自动修 Bug 确实全自动闭环，无需人工复核'));
  process.exit(errs.length ? 1 : 0);
}
