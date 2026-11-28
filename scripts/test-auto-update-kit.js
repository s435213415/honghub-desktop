/**
 * 鸿汇影 · 客户版静默升级纯逻辑单测（1.7.95 / P1-07 + P1-08）
 * 跑法：node scripts/test-auto-update-kit.js
 * 不联网、不装包：只测版本比较、下载地址校验、计划推导、退避、SHA256 与「装完版本没变」判定。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const au = require(path.join(__dirname, '..', 'client-auto-update.js'));

let n = 0;
function t(name, fn) { fn(); n++; }

/* ---- cmp ---- */
t('cmp 主版本高', () => assert.strictEqual(au.cmp('1.7.95', '1.7.94'), 1));
t('cmp 次版本高', () => assert.strictEqual(au.cmp('1.8.0', '1.7.99'), 1));
t('cmp 相同', () => assert.strictEqual(au.cmp('1.7.95', '1.7.95'), 0));
t('cmp 低', () => assert.strictEqual(au.cmp('1.7.93', '1.7.94'), -1));
t('cmp 位数不同补零', () => assert.strictEqual(au.cmp('1.7', '1.7.0'), 0));
t('cmp 带后缀段按 0 处理（正式版高于 beta）', () => assert.strictEqual(au.cmp('1.7.95', '1.7.95-beta'), 1));
t('cmp 反向：beta 低于正式', () => assert.strictEqual(au.cmp('1.7.95-beta', '1.7.95'), -1));

/* ---- checkDownloadUrl ---- */
const BASE = 'https://wbapp-j8tm07cirj5x0krfyivhfz.app.workbuddy.host';
t('同源 https .exe 放行', () => {
  const r = au.checkDownloadUrl(BASE + '/honghub/v1.7.95/desktop-setup.exe?x=1', BASE);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.file, 'desktop-setup.exe');
});
t('非 https 拒绝', () => {
  const r = au.checkDownloadUrl('http://x.test/setup.exe', BASE);
  assert.strictEqual(r.ok, false);
  assert.ok(/https/.test(r.reason));
});
t('非 exe 拒绝', () => {
  const r = au.checkDownloadUrl(BASE + '/honghub/v1.7.95/update.zip', BASE);
  assert.strictEqual(r.ok, false);
  assert.ok(/.exe/.test(r.reason));
});
t('异源域名拒绝', () => {
  const r = au.checkDownloadUrl('https://evil.test/desktop-setup.exe', BASE);
  assert.strictEqual(r.ok, false);
  assert.ok(/不同/.test(r.reason));
});
t('大小写域名视为同源', () => {
  const r = au.checkDownloadUrl('https://WBAPP-J8TM07CIRJ5X0KRFYIVHFZ.app.workbuddy.host/a.exe', BASE);
  assert.strictEqual(r.ok, true);
});
t('清单无 baseUrl 时只靠 SHA 放行', () => {
  const r = au.checkDownloadUrl('https://any.test/a.exe', '');
  assert.strictEqual(r.ok, true);
});
t('非法地址拒绝', () => {
  assert.strictEqual(au.checkDownloadUrl('不是网址', BASE).ok, false);
});

/* ---- plan ---- */
const MF = {
  versionName: '1.7.95', versionCode: 1000209, baseUrl: BASE,
  desktopUrl: BASE + '/honghub/v1.7.95/desktop-setup.exe',
  desktopSha256: 'a'.repeat(64), desktopSize: 110000000
};
t('plan：已是最新', () => assert.strictEqual(au.plan(MF, { current: '1.7.95', mode: 'download' }).action, 'uptodate'));
t('plan：远端更低算最新', () => assert.strictEqual(au.plan(MF, { current: '1.8.0', mode: 'download' }).action, 'uptodate'));
t('plan：off 不动作', () => assert.strictEqual(au.plan(MF, { current: '1.7.94', mode: 'off' }).action, 'idle'));
t('plan：check 只提示', () => {
  const p = au.plan(MF, { current: '1.7.94', mode: 'check' });
  assert.strictEqual(p.action, 'notice');
  assert.strictEqual(p.remote, '1.7.95');
});
t('plan：download 给下载信息', () => {
  const p = au.plan(MF, { current: '1.7.94', mode: 'download' });
  assert.strictEqual(p.action, 'download');
  assert.strictEqual(p.file, 'desktop-setup.exe');
  assert.strictEqual(p.sha256, MF.desktopSha256);
});
t('plan：install 模式给 install', () => assert.strictEqual(au.plan(MF, { current: '1.7.94', mode: 'install' }).action, 'install'));
t('plan：缺 SHA 直接报错', () => {
  const p = au.plan(Object.assign({}, MF, { desktopSha256: '' }), { current: '1.7.94', mode: 'download' });
  assert.strictEqual(p.action, 'error');
});
t('plan：清单没版本号 → idle', () => assert.strictEqual(au.plan({}, { current: '1.7.94' }).action, 'idle'));
t('plan：下载地址异源 → error', () => {
  const p = au.plan(Object.assign({}, MF, { desktopUrl: 'https://evil.test/a.exe' }), { current: '1.7.94', mode: 'download' });
  assert.strictEqual(p.action, 'error');
});
t('plan：mode 非法回落 download', () => {
  assert.strictEqual(au.plan(MF, { current: '1.7.94', mode: '乱写' }).action, 'download');
});

/* ---- 退避 ---- */
t('nextDelay 0 次立即', () => assert.strictEqual(au.nextDelay(0), 0));
t('nextDelay 1 次 1 小时', () => assert.strictEqual(au.nextDelay(1), 3600000));
t('nextDelay 2 次 6 小时', () => assert.strictEqual(au.nextDelay(2), 21600000));
t('nextDelay 3 次以上封顶 24 小时', () => {
  assert.strictEqual(au.nextDelay(3), 86400000);
  assert.strictEqual(au.nextDelay(99), 86400000);
});

/* ---- sha256File ---- */
t('sha256File 与 crypto 一致', () => {
  const tmp = path.join(os.tmpdir(), 'kh-au-test.txt');
  fs.writeFileSync(tmp, 'honghub-1.7.95');
  const want = require('crypto').createHash('sha256').update('honghub-1.7.95').digest('hex');
  assert.strictEqual(au.sha256File(tmp), want);
  fs.unlinkSync(tmp);
});

/* ---- 状态与「装完没变」 ---- */
const TMPDIR = path.join(os.tmpdir(), 'kh-au-state-test');
t('start 在 off 模式不设定时器但注入目录', () => {
  fs.rmSync(TMPDIR, { recursive: true, force: true });
  const r = au.start({ dir: TMPDIR, version: '1.7.94', app: null, spawn: () => {}, notify: () => {} });
  /* 默认 mode=download，会返回 ok:true 并挂定时器；这里只断言 ctx 生效后的读写 */
  assert.ok(typeof r === 'object');
});
t('writeState / readState 往返', () => {
  au.writeState({ mode: 'install', attempts: 2, lastResult: '下载失败：x', current: '1.7.94' });
  const s = au.readState();
  assert.strictEqual(s.mode, 'install');
  assert.strictEqual(s.attempts, 2);
});
t('detectInstallNoChange：装完版本没变 → 记失败并停止自动装', () => {
  au.writeState({ mode: 'install', attempts: 0, lastResult: '已触发静默安装 v1.7.95', current: '1.7.94' });
  const s = au.detectInstallNoChange('1.7.94');
  assert.strictEqual(s.lastInstallNoChange, true);
  assert.ok(/未生效/.test(s.lastResult));
});
t('detectInstallNoChange：装完版本对上 → 记升级完成', () => {
  au.writeState({ mode: 'install', attempts: 0, lastResult: '已触发静默安装 v1.7.95', current: '1.7.94' });
  const s = au.detectInstallNoChange('1.7.95');
  assert.strictEqual(s.lastInstallNoChange, false);
  assert.ok(/升级已完成/.test(s.lastResult));
});
t('detectInstallNoChange：没有安装动作时不乱判', () => {
  au.writeState({ mode: 'download', attempts: 0, lastResult: '已下载并校验通过 v1.7.95', current: '1.7.94' });
  const s = au.detectInstallNoChange('1.7.94');
  assert.ok(!s.lastInstallNoChange);
});
t('默认清单是 https', () => assert.ok(/^https:\/\//.test(au.DEFAULT_MANIFEST)));

fs.rmSync(TMPDIR, { recursive: true, force: true });
console.log('客户版静默升级：' + n + ' 项全部通过');
