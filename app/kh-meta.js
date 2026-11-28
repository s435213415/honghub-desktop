/* HongHub 前端模块：外部数据源与网络偏好（1.7.94 · 清单 #59 #60 #37）
   #59 元数据与海报来源：内置 / TMDB / 豆瓣 / 自定义刮削（模板地址 + {title}{year}）
   #60 字幕站与 AI Key：字幕站地址白名单、AI Key 长度与掩码（Key 只存本机，不上云、不写日志）
   #37 IPv4/IPv6 与自定义 DNS：模式归一 + DNS 地址校验 + 诚实标注「哪些能生效」
   纯逻辑，不发请求、不碰 DOM。 */
(function(root, factory){
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KHMETA = api;
})(typeof window !== 'undefined' ? window : this, function(){
  'use strict';

  var SRC_LIST = ['builtin', 'tmdb', 'douban', 'custom'];
  var SRC_LABEL = { builtin: '内置片单（不联网刮削）', tmdb: 'TMDB', douban: '豆瓣', custom: '自定义刮削地址' };
  var IP_MODES = ['auto', 'ipv4', 'ipv6'];
  var IP_LABEL = { auto: '自动（系统默认，优先 IPv6）', ipv4: '只用 IPv4（重启后生效）', ipv6: '优先 IPv6（重启后生效）' };

  function isObj(o){ return o && typeof o === 'object' && !Array.isArray(o); }
  function str(v, n){ return String(v == null ? '' : v).trim().slice(0, n || 200); }

  /* ---------- #59 元数据源 ---------- */
  function normSrc(v){ return SRC_LIST.indexOf(v) >= 0 ? v : 'builtin'; }
  function srcLabel(v){ return SRC_LABEL[normSrc(v)]; }
  /* 模板地址：必须 http(s)，至少含 {title}；{year} 可选 */
  function tplOk(tpl){
    var s = str(tpl, 300);
    if (!/^https?:\/\//i.test(s)) return { ok: false, error: '刮削地址要 http(s) 开头' };
    if (s.indexOf('{title}') < 0) return { ok: false, error: '刮削地址里要带 {title} 占位符' };
    if (/[\s<>"']/.test(s)) return { ok: false, error: '刮削地址里不能有空格或引号' };
    return { ok: true, url: s };
  }
  function buildUrl(tpl, info){
    var t = tplOk(tpl);
    if (!t.ok) return t;
    var title = encodeURIComponent(str(info && info.title, 80));
    var year = encodeURIComponent(str(info && info.year, 8));
    return { ok: true, url: t.url.replace(/\{title\}/g, title).replace(/\{year\}/g, year) };
  }
  /* 刮削结果归一：海报只认 http(s)，简介截断，评分 0–10 */
  function normResult(raw){
    if (!isObj(raw)) return null;
    var poster = str(raw.poster || raw.cover || raw.poster_path, 400);
    if (poster && !/^https?:\/\//i.test(poster)) poster = '';
    var rating = Number(raw.rating != null ? raw.rating : raw.vote_average);
    if (!isFinite(rating)) rating = 0;
    if (rating > 10) rating = rating > 100 ? 0 : rating / 10;
    if (rating < 0) rating = 0;
    var title = str(raw.title || raw.name, 80);
    var overview = str(raw.overview || raw.desc || raw.summary, 600);
    if (!title && !poster && !overview) return null;
    return {
      title: title, year: str(raw.year || raw.release_date || raw.first_air_date, 10).slice(0, 4),
      poster: poster, overview: overview, rating: Math.round(rating * 10) / 10
    };
  }
  /* 缓存按条目 id 存，最多 cap 条，重复覆盖；超量淘汰最旧的 */
  function cachePut(cache, id, meta, cap){
    var c = isObj(cache) ? Object.assign({}, cache) : {};
    if (!id || !meta) return c;
    c[String(id)] = meta;
    var keys = Object.keys(c).sort(function (a, b) { return (c[a].at || 0) - (c[b].at || 0); });
    var limit = cap || 50;
    while (keys.length > limit) { delete c[keys.shift()]; }
    return c;
  }
  function cacheGet(cache, id){ return isObj(cache) && id ? (cache[String(id)] || null) : null; }

  /* ---------- #60 字幕站与 AI Key ---------- */
  function subSites(text, cap){
    var out = [];
    str(text, 2000).split(/[\s,，;；]+/).forEach(function (s) {
      if (!s) return;
      if (!/^https?:\/\//i.test(s)) return;
      if (out.indexOf(s) < 0) out.push(s);
    });
    return out.slice(0, cap || 10);
  }
  /* Key：只存本机；校验长度与字符，展示时只留后 4 位 */
  function keyOk(k){
    var s = String(k == null ? '' : k).trim();
    if (s.length < 8) return { ok: false, error: 'Key 至少 8 位' };
    if (/\s/.test(s)) return { ok: false, error: 'Key 里不能有空格' };
    if (s.length > 200) return { ok: false, error: 'Key 太长（超过 200 位）' };
    return { ok: true, key: s };
  }
  function keyMask(k){
    var s = String(k == null ? '' : k);
    if (!s) return '';
    if (s.length <= 8) return '••••' + s.slice(-2);
    return s.slice(0, 2) + '••••••' + s.slice(-4) + '（' + s.length + ' 位）';
  }
  function aiBase(v){
    var s = str(v, 200).replace(/\/+$/, '');
    if (!s) return { ok: true, base: '' };
    if (!/^https?:\/\//i.test(s)) return { ok: false, error: '接口地址要 http(s) 开头' };
    return { ok: true, base: s };
  }

  /* ---------- #37 网络族与 DNS ---------- */
  function normIpMode(v){ return IP_MODES.indexOf(v) >= 0 ? v : 'auto'; }
  function ipLabel(v){ return IP_LABEL[normIpMode(v)]; }
  function dnsOk(v){
    var s = String(v == null ? '' : v).trim();
    if (!s) return true;
    var ip4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
    /* 四段全数字却没通过 IPv4 校验的（如 300.1.1.1）不是域名，直接拒 */
    if (/^\d+(\.\d+){1,3}$/.test(s)) return ip4.test(s);
    var host = /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    return host.test(s);
  }
  function dnsList(text, cap){
    var out = [];
    str(text, 300).split(/[\s,，;；]+/).forEach(function (s) {
      if (s && dnsOk(s) && out.indexOf(s) < 0) out.push(s);
    });
    return out.slice(0, cap || 3);
  }
  /* 诚实说明：哪些真能生效、哪些只是记录 */
  function netNote(mode, dns){
    var m = normIpMode(mode), d = Array.isArray(dns) ? dns : [];
    var lines = [];
    if (m === 'ipv4') lines.push('只用 IPv4：桌面端下次启动会带 --disable-ipv6，纯网页 / 设备端跟随系统。');
    else if (m === 'ipv6') lines.push('优先 IPv6：客户端不强行改写协议栈，按系统与站点解析结果走，仅影响内置测速的排序偏好。');
    else lines.push('自动：跟随系统协议栈，不做额外限制。');
    if (d.length) lines.push('自定义 DNS：' + d.join('、') + ' 已记录；Windows 下解析器由系统控制，客户端不骗你说「已切换」——'
      + '要在系统网络设置或路由器里改才真正生效，这里只用于诊断时标注期望值。');
    else lines.push('未设自定义 DNS，使用系统解析器。');
    return lines.join('');
  }

  return {
    SRC_LIST: SRC_LIST, SRC_LABEL: SRC_LABEL, IP_MODES: IP_MODES, IP_LABEL: IP_LABEL,
    normSrc: normSrc, srcLabel: srcLabel, tplOk: tplOk, buildUrl: buildUrl, normResult: normResult,
    cachePut: cachePut, cacheGet: cacheGet,
    subSites: subSites, keyOk: keyOk, keyMask: keyMask, aiBase: aiBase,
    normIpMode: normIpMode, ipLabel: ipLabel, dnsOk: dnsOk, dnsList: dnsList, netNote: netNote
  };
});
