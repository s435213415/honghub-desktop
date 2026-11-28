/* scripts/test-account-kit.js — 设备码账号 + 云同步 + 遥控队列（server/account-sync.js）
 * 跑法：node scripts\test-account-kit.js
 * 数据写到临时目录，绝不碰 server\data。
 */
'use strict';
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-acct-'));
process.env.KH_DATA_DIR = TMP;
var A = require(path.join(__dirname, '..', 'server', 'account-sync.js'));

var pass = 0, fail = 0, fails = [];
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; fails.push(name + ' → ' + e.message); } }

/* ---- 设备码 ---- */
t('字符集不含易混字符 0/O/1/I', function () {
  assert.strictEqual(A.ALPHABET.indexOf('0'), -1);
  assert.strictEqual(A.ALPHABET.indexOf('O'), -1);
  assert.strictEqual(A.ALPHABET.indexOf('1'), -1);
  assert.strictEqual(A.ALPHABET.indexOf('I'), -1);
  assert.strictEqual(A.ALPHABET.length, 32);
});
t('新码是 4+4 格式且只含合法字符', function () {
  for (var i = 0; i < 20; i++) {
    var c = A.newCode();
    assert.ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c), '格式不对：' + c);
    c.replace('-', '').split('').forEach(function (ch) { assert.ok(A.ALPHABET.indexOf(ch) >= 0, '非法字符 ' + ch); });
  }
});
t('normCode 接受小写/空格/无连字符', function () {
  assert.strictEqual(A.normCode('ab cd ef gh'), 'ABCD-EFGH');
  assert.strictEqual(A.normCode('abcdefgh'), 'ABCD-EFGH');
});
t('normCode 拒绝 0/O/1/I', function () {
  assert.strictEqual(A.normCode('ABCD-EF0H'), '');
  assert.strictEqual(A.normCode('ABCD-EFIH'), '');
  assert.strictEqual(A.normCode('ABCD-EF1H'), '');
});
t('normCode 拒绝长度不对', function () {
  assert.strictEqual(A.normCode('ABC'), '');
  assert.strictEqual(A.normCode('ABCD-EFGHJ'), '');
  assert.strictEqual(A.normCode(''), '');
});

/* ---- 数据规范化 ---- */
t('cleanItem 丢掉链接型字段', function () {
  var it = A.cleanItem({ id: 7, title: '片子', kind: 'http://evil.example/x', cat: '电影' });
  assert.strictEqual(it.id, 7);
  assert.strictEqual(it.kind, undefined);
  assert.strictEqual(it.title, '片子');
});
t('cleanItem 没有 id 的对象返回 null，标量 id 原样收下', function () {
  assert.strictEqual(A.cleanItem({ title: 'x' }), null);
  assert.deepStrictEqual(A.cleanItem('str'), { id: 'str' });
  assert.deepStrictEqual(A.cleanItem(12), { id: 12 });
  assert.deepStrictEqual(A.cleanItem({ id: 12, title: 'A' }), { id: 12, title: 'A' });
});
t('cleanProg 接受本机的「id → 秒数」形态', function () {
  var p = A.cleanProg({ 3: 120.4, 4: -1 });
  assert.deepStrictEqual(Object.keys(p), ['3']);
  assert.strictEqual(p[3].pos, 120);
  assert.strictEqual(p[3].at, 0);
});
t('cleanList 去重且保留先到的', function () {
  var l = A.cleanList([{ id: 1, title: 'A' }, { id: 1, title: 'B' }, { id: 2, title: 'C' }], 10);
  assert.strictEqual(l.length, 2);
  assert.strictEqual(l[0].title, 'A');
});
t('cleanList 按上限截断', function () {
  var arr = [];
  for (var i = 0; i < 400; i++) arr.push({ id: i, title: 't' + i });
  assert.strictEqual(A.cleanList(arr, A.CAP.fav).length, A.CAP.fav);
});
t('cleanProg 丢掉坏的进度', function () {
  var p = A.cleanProg({ a: { pos: 12, dur: 100, at: 1 }, b: { pos: -1 }, c: { pos: 'x' }, d: 'nope' });
  assert.deepStrictEqual(Object.keys(p), ['a']);
  assert.strictEqual(p.a.pos, 12);
});
t('sanitize 空输入给空结构', function () {
  var s = A.sanitize(null);
  assert.deepStrictEqual(s.fav, []);
  assert.deepStrictEqual(s.prog, {});
  assert.deepStrictEqual(Object.keys(s).sort(), ['fav', 'hist', 'livefav', 'prog', 'watchlist']);
});

/* ---- 合并 ---- */
t('mergeProfile 收藏取并集且远端在前', function () {
  var r = { fav: [{ id: 1 }, { id: 2 }] };
  var m = A.mergeProfile(r, { fav: [{ id: 3 }, { id: 2 }] });
  assert.deepStrictEqual(m.fav.map(function (x) { return x.id; }), [1, 2, 3]);
});
t('mergeProfile 续播点取时间更新的那份', function () {
  var r = { prog: { '9': { pos: 10, dur: 100, at: 1000 } } };
  var m = A.mergeProfile(r, { prog: { '9': { pos: 50, dur: 100, at: 2000 } } });
  assert.strictEqual(m.prog['9'].pos, 50);
});
t('mergeProfile 旧的续播点不覆盖新的', function () {
  var r = { prog: { '9': { pos: 50, dur: 100, at: 2000 } } };
  var m = A.mergeProfile(r, { prog: { '9': { pos: 10, dur: 100, at: 1000 } } });
  assert.strictEqual(m.prog['9'].pos, 50);
});

/* ---- 账号生命周期（真落盘） ---- */
t('create 生成新账号并落盘', function () {
  var r = A.create('');
  assert.strictEqual(r.ok, true);
  assert.ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.code));
  assert.ok(fs.existsSync(path.join(TMP, 'accounts.json')), '没写出 accounts.json');
  var g = A.get(r.code);
  assert.strictEqual(g.code, r.code);
  assert.strictEqual(g.rev, 0);
});
t('create 用指定码可新建，重复码返回 existing', function () {
  var r1 = A.create('ZZZZ-2222');
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.existing, false);
  var r2 = A.create('ZZZZ-2222');
  assert.strictEqual(r2.existing, true);
});
t('get 不存在的码返回 null', function () {
  assert.strictEqual(A.get('AAAA-2222'), null);
});
t('sync 合并并递增 rev', function () {
  var r0 = A.create('QQQQ-3333');
  var r1 = A.sync('QQQQ-3333', { fav: [{ id: 11, title: '片一' }], prog: { '11': { pos: 30, dur: 600, at: 5 } } });
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.rev, 1);
  var r2 = A.sync('QQQQ-3333', { fav: [{ id: 12, title: '片二' }], prog: { '11': { pos: 200, dur: 600, at: 9 } } });
  assert.strictEqual(r2.rev, 2);
  assert.deepStrictEqual(r2.data.fav.map(function (x) { return x.id; }), [11, 12]);
  assert.strictEqual(r2.data.prog['11'].pos, 200);
});
t('sync 到不存在的码返回 missing', function () {
  var r = A.sync('BBBB-4444', { fav: [] });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.missing, true);
});
t('sync 坏码给出可读原因', function () {
  var r = A.sync('abc', {});
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.indexOf('格式') >= 0);
});
t('rename 只改昵称不动数据', function () {
  A.create('WWWW-5555');
  A.sync('WWWW-5555', { fav: [{ id: 21, title: 'x' }] });
  var r = A.rename('WWWW-5555', '客厅电视');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.nick, '客厅电视');
  assert.strictEqual(A.get('WWWW-5555').data.fav.length, 1);
});
t('stats 能数出账号数', function () {
  var s = A.stats();
  assert.ok(s.accounts >= 4, '账号数不对：' + s.accounts);
});

/* ---- 遥控队列 ---- */
t('遥控只认白名单指令', function () {
  A.create('RRRR-6666');
  assert.strictEqual(A.pushCmd('RRRR-6666', 'rm -rf').ok, false);
  assert.strictEqual(A.pushCmd('RRRR-6666', 'playpause').ok, true);
});
t('遥控指令按 id 递增可取走', function () {
  A.pushCmd('RRRR-6666', 'volup');
  var p = A.pollCmd('RRRR-6666', 0);
  assert.strictEqual(p.ok, true);
  assert.ok(p.cmds.length >= 1);
  assert.strictEqual(p.cmds[p.cmds.length - 1].cmd, 'volup');
  var p2 = A.pollCmd('RRRR-6666', p.lastId);
  assert.strictEqual(p2.cmds.length, 0);
});
t('遥控坏码被拒', function () {
  assert.strictEqual(A.pushCmd('xx', 'next').ok, false);
  assert.strictEqual(A.pollCmd('', 0).ok, false);
});
t('遥控队列有上限', function () {
  for (var i = 0; i < 100; i++) A.pushCmd('TTTT-7777', 'next');
  var p = A.pollCmd('TTTT-7777', 0);
  assert.ok(p.cmds.length <= 60, '队列没截断：' + p.cmds.length);
});

/* ---- 遥控页面 ---- */
t('遥控页带上设备码且无外链依赖', function () {
  var html = A.remotePage('http://192.168.1.10:8787', 'ABCD-EFGH');
  assert.ok(html.indexOf('ABCD-EFGH') >= 0);
  assert.ok(html.indexOf('api/remote/cmd') >= 0);
  assert.ok(html.indexOf('http://192.168.1.10:8787') >= 0);
  assert.ok(!/src=["']http/i.test(html), '不该有外部脚本');
});
t('遥控页对非法码不注入脚本', function () {
  var html = A.remotePage('http://x', '<script>alert(1)</script>');
  assert.ok(html.indexOf('<script>alert(1)') < 0, '设备码被原样写进页面');
});

console.log('账号/同步/遥控：' + pass + ' 项通过，' + fail + ' 项失败');
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
if (fail) { fails.forEach(function (f) { console.error('  ✗ ' + f); }); process.exit(1); }
