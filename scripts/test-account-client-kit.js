/* scripts/test-account-client-kit.js — 客户端 kh-account.js 回归
 * 跑法：node scripts\test-account-client-kit.js
 */
'use strict';
var assert = require('assert');
var path = require('path');

/* ---- 浏览器环境桩：localStorage + fetch ---- */
var mem = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem: function (k, v) { mem[k] = String(v); },
  removeItem: function (k) { delete mem[k]; }
};
var calls = [];
var routes = [];
function route(match, reply) { routes.push({ match: match, reply: reply }); }
global.fetch = function (url, opt) {
  calls.push({ url: String(url), opt: opt || {} });
  for (var i = 0; i < routes.length; i++) {
    if (String(url).indexOf(routes[i].match) >= 0) {
      var body = routes[i].reply(url, opt);
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
    }
  }
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: false, error: 'no route' }); } });
};

var ACC = require(path.join(__dirname, '..', 'app', 'kh-account.js'));
var SRV = require(path.join(__dirname, '..', 'server', 'account-sync.js'));

var pass = 0, fail = 0, fails = [];
var queue = [];
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; fails.push(name + ' → ' + e.message); } }
function ta(name, fn) { queue.push([name, fn]); }

/* ---- 设备码：与服务器同一套规则 ---- */
t('normCode 与服务器实现一致', function () {
  ['abcd efgh', 'ABCD-EFGH', 'abcdefgh', 'abc', 'ABCD-EF0H', ''].forEach(function (x) {
    assert.strictEqual(ACC.normCode(x), SRV.normCode(x), '不一致：' + x);
  });
});
t('genCode 是 4+4 且只用合法字符', function () {
  for (var i = 0; i < 10; i++) {
    var c = ACC.genCode();
    assert.strictEqual(ACC.normCode(c), c);
    assert.strictEqual(c.length, 9);
  }
});
t('localCode 首次生成并落盘，二次不变', function () {
  mem = {};
  var a = ACC.localCode();
  assert.ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}/.test(a));
  assert.strictEqual(mem['kh_acct_code'], JSON.stringify(a));
  assert.strictEqual(ACC.localCode(), a);
});
t('setCode 拒绝坏码，好码写回', function () {
  assert.strictEqual(ACC.setCode('zz'), '');
  assert.strictEqual(ACC.setCode('abcd-efgh'), 'ABCD-EFGH');
  assert.strictEqual(ACC.localCode(), 'ABCD-EFGH');
});

/* ---- 本机数据组装 ---- */
t('profile 只带四类数据且 prog 是对象', function () {
  mem['kh_fav'] = JSON.stringify([1, '2', { id: 3 }]);
  mem['kh_hist'] = JSON.stringify([5]);
  mem['kh_watchlist'] = JSON.stringify([9]);
  mem['kh_livefav'] = JSON.stringify([]);
  mem['kh_prog'] = JSON.stringify({ 7: 320 });
  var p = ACC.profile();
  assert.deepStrictEqual(p.fav, [1, '2', { id: 3 }]);
  assert.deepStrictEqual(p.hist, [5]);
  assert.deepStrictEqual(p.watchlist, [9]);
  assert.deepStrictEqual(p.livefav, []);
  assert.strictEqual(p.prog['7'], 320);
});
t('profile 对脏值给空数组', function () {
  mem['kh_fav'] = '"oops"';
  mem['kh_prog'] = '[1,2]';
  var p = ACC.profile();
  assert.deepStrictEqual(p.fav, []);
  assert.deepStrictEqual(p.prog, {});
});

/* ---- 云端数据写回 ---- */
t('applyProfile 把对象条目还原成 id 并去重', function () {
  var m = ACC.applyProfile({
    fav: [{ id: 11 }, { id: 11 }, 'tag2'], hist: [21],
    watchlist: [], livefav: [{ id: 'live1' }],
    prog: { 11: { pos: 96.4, dur: 600, at: 5 }, 21: 30 }
  });
  assert.deepStrictEqual(JSON.parse(mem['kh_fav']), [11, 'tag2']);
  assert.deepStrictEqual(JSON.parse(mem['kh_hist']), [21]);
  assert.deepStrictEqual(JSON.parse(mem['kh_livefav']), ['live1']);
  var p = JSON.parse(mem['kh_prog']);
  assert.strictEqual(p['11'], 96);
  assert.strictEqual(p['21'], 30);
  assert.strictEqual(m.counts.fav, 2);
  assert.strictEqual(m.counts.prog, 2);
});
t('applyProfile 空输入不炸且清空计数', function () {
  var m = ACC.applyProfile(null);
  assert.deepStrictEqual(JSON.parse(mem['kh_fav']), []);
  assert.strictEqual(m.counts.prog, 0);
});

/* ---- 网络：注册 / 同步 / 拉取 ---- */
ta('register 保存中枢返回的码', function () {
  route('/api/account/create', function () { return { ok: true, code: 'ABCD-EFGH', existing: false }; });
  return ACC.register('', 'ABCD-EFGH').then(function (r) {
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.code, 'ABCD-EFGH');
    assert.strictEqual(ACC.localCode(), 'ABCD-EFGH');
    var c = calls[calls.length - 1];
    assert.ok(c.url.indexOf('/api/account/create') >= 0);
    assert.strictEqual(JSON.parse(c.opt.body).code, 'ABCD-EFGH');
  });
});
ta('sync 成功时把合并结果写回本机', function () {
  route('/api/account/sync', function () {
    return { ok: true, code: 'ABCD-EFGH', rev: 3, data: { fav: [{ id: 1 }, { id: 2 }], hist: [], watchlist: [], livefav: [], prog: { 1: { pos: 55, dur: 0, at: 0 } } } };
  });
  return ACC.sync('').then(function (r) {
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.rev, 3);
    assert.deepStrictEqual(JSON.parse(mem['kh_fav']), [1, 2]);
    assert.strictEqual(JSON.parse(mem['kh_prog'])['1'], 55);
  });
});
ta('pull 拿到账号数据并写回', function () {
  route('/api/account/data', function () {
    return { ok: true, account: { code: 'ABCD-EFGH', data: { fav: [{ id: 8 }], hist: [], watchlist: [], livefav: [], prog: {} } } };
  });
  return ACC.pull('').then(function (m) {
    assert.strictEqual(m.counts.fav, 1);
    assert.deepStrictEqual(JSON.parse(mem['kh_fav']), [8]);
  });
});
ta('pull 中枢没有这枚码时给出可读错误', function () {
  routes.length = 0;
  route('/api/account/data', function () { return { ok: false, error: '没有这枚设备码' }; });
  return ACC.pull('').then(function () { throw new Error('不该成功'); }, function (e) {
    assert.ok(e.message.indexOf('设备码') >= 0, e.message);
  });
});
ta('adopt 换码后立即拉回并回推', function () {
  routes.length = 0;
  route('/api/account/data', function () { return { ok: true, account: { data: { fav: [{ id: 42 }], hist: [], watchlist: [], livefav: [], prog: {} } } }; });
  route('/api/account/sync', function () { return { ok: true, code: 'ZZZZ-2222', rev: 1, data: { fav: [{ id: 42 }], hist: [], watchlist: [], livefav: [], prog: {} } }; });
  return ACC.adopt('ZZZZ-2222', '').then(function (r) {
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.code, 'ZZZZ-2222');
    assert.strictEqual(ACC.localCode(), 'ZZZZ-2222');
    assert.strictEqual(r.rev, 1);
  });
});
ta('adopt 坏码直接拒绝', function () {
  return ACC.adopt('abc', '').then(function () { throw new Error('不该成功'); }, function (e) {
    assert.ok(e.message.indexOf('格式') >= 0);
  });
});

/* ---- 手机遥控 ---- */
t('pairUrl 指向 /remote 并带上码', function () {
  var u = ACC.pairUrl('http://192.168.1.10:8787/', 'ABCD-EFGH');
  assert.strictEqual(u, 'http://192.168.1.10:8787/remote?code=ABCD-EFGH');
});
t('pairUrl 无中枢地址时返回空串而不是假地址', function () {
  assert.strictEqual(ACC.pairUrl('', 'ABCD-EFGH'), '');
});
ta('tickOnce 只把白名单指令交出去', function () {
  routes.length = 0;
  route('/api/remote/poll', function () {
    return { ok: true, lastId: 12, cmds: [{ id: 11, cmd: 'playpause' }, { id: 12, cmd: 'rm -rf' }] };
  });
  return ACC.tickOnce(10, '').then(function (r) {
    assert.strictEqual(r.since, 12);
    assert.strictEqual(r.cmds.length, 2);
    assert.ok(r.cmds.some(function (c) { return c.cmd === 'playpause'; }));
  });
});
ta('tickOnce 中枢不可达时保持 since 不变', function () {
  routes.length = 0;
  route('/api/remote/poll', function () { return { ok: false, error: 'bad code' }; });
  return ACC.tickOnce(7, '').then(function (r) {
    assert.strictEqual(r.since, 7);
    assert.strictEqual(r.cmds.length, 0);
  });
});
ta('sendCmd 拒绝白名单外指令', function () {
  return ACC.sendCmd('rm -rf', '').then(function () { throw new Error('不该成功'); }, function (e) {
    assert.ok(e.message.indexOf('不支持') >= 0);
  });
});
ta('startRemote 会按周期取指令且 stop 后不再发请求', function () {
  routes.length = 0;
  var got = [];
  route('/api/remote/poll', function () { return { ok: true, lastId: 20, cmds: [{ id: 20, cmd: 'next' }] }; });
  var before = calls.length;
  var stop = ACC.startRemote(function (cmd) { got.push(cmd); }, { period: 1000, base: '' });
  return new Promise(function (res) { setTimeout(res, 1400); }).then(function () {
    assert.deepStrictEqual(got, ['next']);
    stop();
    var mid = calls.length;
    return new Promise(function (res) { setTimeout(res, 2500); }).then(function () {
      assert.strictEqual(calls.length, mid, 'stop 之后还在轮询');
      assert.ok(calls.length > before);
    });
  });
});

(async function main() {
  for (var i = 0; i < queue.length; i++) {
    try { await queue[i][1](); pass++; }
    catch (e) { fail++; fails.push(queue[i][0] + ' → ' + e.message); }
  }
  console.log('账号客户端：' + pass + ' 项通过，' + fail + ' 项失败');
  if (fail) { fails.forEach(function (f) { console.error('  ✗ ' + f); }); process.exit(1); }
})();
