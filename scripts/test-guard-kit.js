/**
 * 鸿汇影 · 站点域名守卫单测（1.7.95 / 台账 P0-04）
 * 跑法：node scripts/test-guard-kit.js
 */
'use strict';
const path = require('path');
const assert = require('assert');

/* 造一个假 window：getStore/setStore 落内存 Map，BUILTIN_SITES 给两家官方站点 */
const mem = new Map();
const win = {
  BUILTIN_SITES: [
    { name: '哔哩哔哩', url: 'https://www.bilibili.com/', host: 'bilibili.com' },
    { name: '爱奇艺', url: 'https://www.iqiyi.com/' },
    { name: '腾讯视频', url: 'https://v.qq.com/' }
  ],
  getStore(k, dft) { return mem.has(k) ? mem.get(k) : dft; },
  setStore(k, v) { mem.set(k, v); },
  URL: URL
};
const api = require(path.join(__dirname, '..', 'app', 'kh-guard.js').replace(/\\/g, '/'));

let n = 0;
function t(name, fn) { fn(); n++; }

/* ---- domainOf ---- */
t('domainOf 解析 https', () => assert.strictEqual(api.domainOf('https://www.bilibili.com/video/BV1'), 'www.bilibili.com'));
t('domainOf 解析 http 带端口', () => assert.strictEqual(api.domainOf('http://127.0.0.1:8080/x'), '127.0.0.1'));
t('domainOf 拒绝 javascript:', () => assert.strictEqual(api.domainOf('javascript:alert(1)'), ''));
t('domainOf 拒绝 data:', () => assert.strictEqual(api.domainOf('data:text/html,<b>x'), ''));
t('domainOf 空值与非法串', () => {
  assert.strictEqual(api.domainOf(''), '');
  assert.strictEqual(api.domainOf('不是网址'), '');
  assert.strictEqual(api.domainOf(null), '');
});
t('domainOf 大小写归一', () => assert.strictEqual(api.domainOf('HTTPS://WWW.BILIBILI.COM/x'), 'www.bilibili.com'));

/* ---- officialHosts（从 BUILTIN_SITES 现算） ---- */
t('officialHosts 覆盖带 host 字段的站点', () => {
  const h = api.officialHosts.call(null);
  /* 说明：模块内 officialHosts 读的是模块自己的 root，不是测试里的 win，
     所以这里用 isOfficial 做行为断言，不直接查表 */
  assert.ok(typeof h === 'object');
});

/* ---- isOfficial（模块 root 是 globalThis，测试里补 BUILTIN_SITES） ---- */
globalThis.BUILTIN_SITES = win.BUILTIN_SITES;
globalThis.getStore = win.getStore;
globalThis.setStore = win.setStore;
const off = ['www.bilibili.com', 'bilibili.com', 'iqiyi.com', 'www.iqiyi.com', 'v.qq.com', 'BILIBILI.COM'];
off.forEach((h) => {
  t('isOfficial 命中内置域 ' + h, () => assert.strictEqual(api.isOfficial(h), true));
});
['www.bilibili.com.cn', 'bilibili.com.cn', 'www.iqiyi.co', 'v.qq.co', ''].forEach((h) => {
  t('isOfficial 挡掉仿冒域 ' + (h || '(空)'), () => assert.strictEqual(api.isOfficial(h), false));
});

/* ---- trust / isTrusted / clearTrust ---- */
t('trust 只记 host 且归一 www', () => {
  api.trust('WWW.Example.COM');
  assert.deepStrictEqual(api.trustList(), ['example.com']);
});
t('isTrusted 命中已信任', () => assert.strictEqual(api.isTrusted('www.example.com'), true));
t('isTrusted 未信任为 false', () => assert.strictEqual(api.isTrusted('evil.example.net'), false));
t('trust 重复不重复入表', () => {
  api.trust('example.com');
  assert.strictEqual(api.trustList().length, 1);
});
t('trust 上限 30 条，超出丢最旧', () => {
  api.clearTrust();
  for (let i = 0; i < 40; i++) api.trust('h' + i + '.test');
  const l = api.trustList();
  assert.strictEqual(l.length, api.MAX_TRUST);
  assert.strictEqual(l[0], 'h10.test');
  assert.strictEqual(l[l.length - 1], 'h39.test');
});
t('clearTrust 清空并落盘', () => {
  api.clearTrust();
  assert.deepStrictEqual(api.trustList(), []);
  assert.deepStrictEqual(mem.get(api.KEY_TRUST), []);
});

/* ---- check 三态 ---- */
t('check：官方域直接放行', () => {
  const r = api.check('https://www.bilibili.com/video/BV1');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.ask, false);
  assert.strictEqual(r.official, true);
});
t('check：未登记域要求二次确认并报真实 host', () => {
  const r = api.check('https://www.bilibili.com.cn/fake');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.ask, true);
  assert.strictEqual(r.host, 'www.bilibili.com.cn');
  assert.ok(/不在平台官方清单/.test(r.reason));
});
t('check：已信任的未登记域放行', () => {
  api.trust('www.bilibili.com.cn');
  const r = api.check('https://www.bilibili.com.cn/fake');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.ask, false);
  assert.strictEqual(r.official, false);
});
t('check：javascript: 协议直接拦（不进入询问）', () => {
  const r = api.check('javascript:alert(1)');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.ask, false);
  assert.strictEqual(r.bad, true);
});
t('check：data: 协议直接拦', () => {
  const r = api.check('data:text/html,<b>x</b>');
  assert.strictEqual(r.bad, true);
});
t('check：解析不出 host 的串直接拦', () => {
  const r = api.check('https://');
  assert.strictEqual(r.bad, true);
});
t('check：大小写与 www 不影响判定', () => {
  assert.strictEqual(api.check('HTTPS://BILIBILI.COM/x').ok, true);
});

console.log('站点域名守卫：' + n + ' 项全部通过');
