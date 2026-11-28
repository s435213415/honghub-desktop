/**
 * 鸿汇影 · 站点域名守卫（台账 P0-04 平台入口劫持防护）
 * ------------------------------------------------------------------
 * 平台入口的真正风险不是「能不能打开」，而是「打开的是不是那家」：
 * 仓配置 / 云端推荐位 / 用户导入的站点里，只要有一条把 host 换成仿冒域名，
 * 用户看到的是官方图标和名字，实际进了别人家页面。
 *
 * 这里的口径（诚实优先）：
 *   · 官方域清单 = 内置平台入口 BUILTIN_SITES 的 host + 本文件内置兜底表
 *   · 命中官方域 → 直接放行，不打扰
 *   · 未命中 → 第一次点不打开，提示真实 host；用户 3 秒内再点一次才放行，并记进信任表
 *   · 信任表只记 host（不记整串 URL），上限 30，可在设置里清空
 * 不做的事：不拦用户主动添加的自建站点（那是用户自己的地址），不伪造「已核验」标记。
 */
(function (root) {
  'use strict';

  /* 兜底官方域：内置平台入口里出现过的官方站点域（BUILTIN_SITES 未加载时用） */
  var FALLBACK = [
    'www.bilibili.com', 'bilibili.com', 'www.iqiyi.com', 'iqiyi.com',
    'v.qq.com', 'www.youku.com', 'youku.com', 'www.mgtv.com', 'mgtv.com',
    'www.1905.com', '1905.com', 'tv.cctv.com', 'www.cctv.com',
    'www.hongguo.com', 'hongguo.com', 'www.douyin.com', 'douyin.com',
    'www.kuaishou.com', 'kuaishou.com', 'www.migu.cn', 'migu.cn'
  ];

  var KEY_TRUST = 'kh_trust_hosts';
  var MAX_TRUST = 30;

  function domainOf(url) {
    try {
      var u = new URL(String(url || ''));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.hostname.toLowerCase();
    } catch (e) { return ''; }
  }

  /* 从内置站点清单现算官方域（含站点自带的 host 字段与 url 解析） */
  function officialHosts() {
    var list = [];
    try {
      var sites = root.BUILTIN_SITES || [];
      for (var i = 0; i < sites.length; i++) {
        var s = sites[i] || {};
        if (s.host) list.push(String(s.host).toLowerCase().replace(/^www\./, ''));
        var h = domainOf(s.url);
        if (h) { list.push(h); list.push(h.replace(/^www\./, '')); }
      }
    } catch (e) {}
    if (!list.length) list = FALLBACK.slice();
    var seen = {}, out = [];
    for (var k = 0; k < list.length; k++) {
      if (list[k] && !seen[list[k]]) { seen[list[k]] = 1; out.push(list[k]); }
    }
    return out;
  }

  function normHost(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); }

  function isOfficial(host) {
    var h = normHost(host);
    if (!h) return false;
    var off = officialHosts();
    for (var i = 0; i < off.length; i++) {
      if (normHost(off[i]) === h) return true;
    }
    return false;
  }

  function trustList() {
    try {
      var v = (root.getStore ? root.getStore(KEY_TRUST, []) : []);
      return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x; }).slice(0, MAX_TRUST) : [];
    } catch (e) { return []; }
  }

  function isTrusted(host) {
    var h = normHost(host);
    return trustList().some(function (x) { return normHost(x) === h; });
  }

  function trust(host) {
    var h = normHost(host);
    if (!h) return trustList();
    var cur = trustList();
    if (cur.some(function (x) { return normHost(x) === h; })) return cur;
    cur.push(h);
    while (cur.length > MAX_TRUST) cur.shift();
    try { if (root.setStore) root.setStore(KEY_TRUST, cur); } catch (e) {}
    return cur;
  }

  function clearTrust() {
    try { if (root.setStore) root.setStore(KEY_TRUST, []); } catch (e) {}
    return [];
  }

  /* 判定结果：
     ok      → 可以打开
     ask     → 未登记域名，需要二次确认
     bad     → 协议不合法 / 解析不出 host，直接拦 */
  function check(url) {
    var raw = String(url || '');
    if (!/^https?:\/\//i.test(raw)) {
      return { ok: false, ask: false, bad: true, host: '', reason: '链接协议不合法（只放行 http / https）' };
    }
    var host = domainOf(raw);
    if (!host) {
      return { ok: false, ask: false, bad: true, host: '', reason: '地址解析不出域名' };
    }
    if (isOfficial(host) || isTrusted(host)) {
      return { ok: true, ask: false, bad: false, host: host, official: isOfficial(host), reason: '' };
    }
    return {
      ok: false, ask: true, bad: false, host: host, official: false,
      reason: '域名 ' + host + ' 不在平台官方清单里'
    };
  }

  var api = {
    domainOf: domainOf, officialHosts: officialHosts, isOfficial: isOfficial,
    trustList: trustList, isTrusted: isTrusted, trust: trust, clearTrust: clearTrust,
    check: check, KEY_TRUST: KEY_TRUST, MAX_TRUST: MAX_TRUST
  };

  root.KHGUARD = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
