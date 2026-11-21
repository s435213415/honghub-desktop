/**
 * 鸿汇影 · 影视仓解析器适配层（parses）
 * --------------------------------------------------------------
 * 目的：把影视仓里 type≥1 的接口站点（TVBox / CatVod 的 api.php 那类）真正用起来，
 * 不再只是「打开网站」——能取分类、列表、详情、播放地址。
 *
 * 协议（TVBox 事实标准，两种返回都要吃）：
 *   搜索   api?ac=videolist&wd=<kw>[&pg=1]
 *   分类   api?ac=videolist&t=<分类id>[&pg=1]
 *   详情   api?ac=detail&ids=<id>  （部分站点回退 ac=videolist&ids=）
 *   返回   JSON: {list:[{vod_id,vod_name,vod_pic,vod_remarks,vod_play_url,vod_play_from}]}
 *          XML : <rss><list><video><vod_id>…</vod_id>…</video></list></rss>
 *
 * 纪律：不带任何内置地址、不缓存片源、不代抓第三方内容；地址与内容全由用户填的仓提供。
 * 请求优先走主进程桥 window.khHttp（无跨域）；网页环境退化为 fetch，被 CORS 拦时如实报错。
 */
var KH_SRC = (function () {
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
  var TIMEOUT = 12000;

  function trimSlash(s) { return String(s || '').replace(/^[\s'"]+|[\s'"]+$/g, '').replace(/\/+$/, ''); }
  /* 站点是否属于「接口型」：有 api 且能拼出 ac= 参数；纯官网入口不算 */
  function isApiSite(site) {
    if (!site) return false;
    var api = trimSlash(site.api || '');
    if (api && /^https?:\/\//i.test(api)) return true;
    var t = Number(site.type || 0);
    var u = String(site.url || '');
    if (t >= 1 && /^https?:\/\//i.test(u) && /api|provide/i.test(u)) return true;
    return false;
  }
  /* 接口基址：优先 api；没有 api 时用站点地址，并剔除常见的页面尾巴 */
  function apiBase(site) {
    var api = trimSlash((site && site.api) || '');
    if (api && /^https?:\/\//i.test(api)) return api;
    var u = trimSlash((site && site.url) || '');
    return u.replace(/\/index\.(html?|php)$/i, '');
  }
  function buildUrl(site, params) {
    var base = apiBase(site);
    if (!base) return '';
    var qs = [];
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      if (params[k] === undefined || params[k] === null || params[k] === '') continue;
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])));
    }
    /* TVBox 事实标准：站点带 ext 时作为 extend 参数下发，很多资源站靠它区分线路/资源库。
       没有它接口会回空列表 —— 这是「仓里有站却拉不出片」的头号原因。 */
    var ext = (site && site.ext != null) ? String(site.ext).trim() : '';
    if (ext) qs.push('extend=' + encodeURIComponent(ext.slice(0, 2000)));
    if (!qs.length) return base;
    return base + (base.indexOf('?') >= 0 ? '&' : '?') + qs.join('&');
  }

  /* 站点自带请求头：TVBox 的 site.header（可能是对象，也可能是 JSON 字符串）。
     不带 Referer/UA 时不少站点直接 403，表现为「站点在但取不到数据」。 */
  function siteHeaders(site) {
    var h = {};
    var raw = site && site.header;
    if (typeof raw === 'string' && raw.trim()) {
      try { raw = JSON.parse(raw); } catch (e) { raw = null; }
    }
    if (raw && typeof raw === 'object') {
      for (var k in raw) {
        if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
        if (typeof raw[k] !== 'string' || !raw[k].trim()) continue;
        h[k] = raw[k].trim().slice(0, 300);
      }
    }
    return h;
  }

  /* 取文本：主进程桥优先，其次直连 fetch */
  function getText(url, headers) {
    var h = headers || {};
    if (!h['User-Agent']) h['User-Agent'] = UA;
    if (!h['Accept']) h['Accept'] = 'application/json,text/xml,*/*';
    if (typeof window !== 'undefined' && window.khHttp && typeof window.khHttp.get === 'function') {
      return window.khHttp.get({ url: url, timeout: TIMEOUT, headers: h })
        .then(function (r) {
          if (r && r.ok && typeof r.text === 'string') return r.text;
          throw new Error((r && (r.reason || ('HTTP ' + r.status))) || '请求失败');
        });
    }
    if (typeof fetch !== 'function') return Promise.reject(new Error('当前环境不支持网络请求'));
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);
    return fetch(url, { headers: h, cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      }, function (e) { clearTimeout(timer); throw e; });
  }

  /* 去 CDATA 壳：不用正则，避免特殊字符在正则里出岔子 */
  var CD_OPEN = '<!' + '[CDATA[';
  var CD_CLOSE = ']' + ']' + '>';
  function cdata(s) {
    var t = String(s || '');
    var a = t.indexOf(CD_OPEN);
    if (a >= 0) {
      var b = t.indexOf(CD_CLOSE, a + CD_OPEN.length);
      if (b > a) t = t.slice(a + CD_OPEN.length, b);
    }
    return t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
  }
  function jsonVods(data) {
    var list = (data && (data.list || (Array.isArray(data) ? data : null))) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (!v || typeof v !== 'object') continue;
      var id = String(v.vod_id != null ? v.vod_id : (v.id != null ? v.id : '')).trim();
      var name = String(v.vod_name || v.name || v.title || '').trim();
      if (!name) continue;
      out.push({
        id: id, name: name,
        pic: String(v.vod_pic || v.pic || '').trim(),
        remarks: String(v.vod_remarks || v.remarks || v.note || '').trim(),
        playUrl: String(v.vod_play_url || '').trim(),
        playFrom: String(v.vod_play_from || '').trim(),
        raw: v
      });
    }
    return out;
  }
  function xmlVods(text) {
    var out = [];
    var re = /<video\b[\s\S]*?<\/video>/gi, m;
    while ((m = re.exec(text))) {
      var b = m[0];
      function tag(t) {
        var r = new RegExp('<' + t + '\\b[^>]*>([\\s\\S]*?)</' + t + '>', 'i');
        var x = b.match(r);
        return x ? cdata(x[1]) : '';
      }
      var name = tag('vod_name');
      if (!name) continue;
      out.push({
        id: tag('vod_id'), name: name, pic: tag('vod_pic'), remarks: tag('vod_remarks'),
        playUrl: tag('vod_play_url'), playFrom: tag('vod_play_from'), raw: null
      });
    }
    return out;
  }
  /* 统一入口：先按 JSON 解，失败按 XML 解，再失败按 JSONP 去壳重试 */
  function parseBody(text) {
    var t = String(text || '').trim();
    if (!t) throw new Error('返回内容为空');
    try {
      var j = JSON.parse(t);
      return jsonVods(j);
    } catch (e) { /* 继续 */ }
    var js = t.replace(/^\s*[a-zA-Z_$][\w$.]*\s*\(/, '').replace(/\)\s*;\s*$/, '');
    try { return jsonVods(JSON.parse(js)); } catch (e2) { /* 继续 */ }
    var x = xmlVods(t);
    if (x.length) return x;
    throw new Error('返回格式不是 JSON / XML / JSONP');
  }

  /* 播放列表：vod_play_url 形如 "第1集$http://...#第2集$http://..."，from 用 $$$ 分隔多套 */
  function parsePlayUrls(playUrl, playFrom) {
    var out = [];
    var froms = String(playFrom || '').split('$$$');
    var groups = String(playUrl || '').split('$$$');
    for (var g = 0; g < groups.length; g++) {
      var lines = groups[g].split('#');
      var src = froms[g] || ('线路' + (g + 1));
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        var idx = line.indexOf('$');
        var title = idx >= 0 ? line.slice(0, idx).trim() : ('第 ' + (i + 1) + ' 集');
        var url = idx >= 0 ? line.slice(idx + 1).trim() : line;
        if (!/^http(s)?:\/\//i.test(url)) continue;
        out.push({ from: src, title: title, url: url });
      }
    }
    return out;
  }

  function call(site, params) {
    var url = buildUrl(site, params);
    if (!url) return Promise.reject(new Error('这个站点没有可用的接口地址'));
    return getText(url, siteHeaders(site)).then(parseBody).then(function (items) {
      return { ok: true, url: url, items: items };
    });
  }

  function search(site, kw) {
    return call(site, { ac: 'videolist', wd: kw, pg: 1 });
  }
  function category(site, tid, title) {
    return call(site, { ac: 'videolist', t: tid, pg: 1 });
  }
  /* 详情：先 ac=detail，失败再退回 ac=videolist&ids */
  function detail(site, id) {
    return call(site, { ac: 'detail', ids: id }).catch(function () {
      return call(site, { ac: 'videolist', ids: id });
    });
  }

  /* 聚合搜索：对一批接口型站点并发查，逐站回调结果，最后汇总。
     opt.offset 支持分批：这一批查完把 offset 推给调用方，下一批接着搜，避免一次打满。
     单站结果里带上该站自己的 header/ext，后续取详情/线路时能原样复用。 */
  function aggSearch(sites, kw, onEach, opt) {
    var o = opt || {};
    var conc = Math.min(Math.max(Number(o.conc) || 4, 1), 8);
    var list = (sites || []).filter(isApiSite);
    var st0 = Math.max(0, Number(o.offset) || 0);
    var capN = Math.max(1, Number(o.limit) || list.length);
    list = list.slice(st0, st0 + capN);
    var stats = { total: list.length, offset: st0, nextOffset: st0 + list.length, hasMore: st0 + list.length < ((sites || []).filter(isApiSite).length),
      ok: 0, fail: 0, items: [], errors: [] };
    var cursor = 0;
    function next() {
      if (cursor >= list.length) return Promise.resolve(stats);
      var site = list[cursor++];
      return search(site, kw).then(function (r) {
        stats.ok++;
        for (var i = 0; i < r.items.length; i++) {
          r.items[i].siteName = site.name;
          r.items[i].siteUrl = site.url;
          r.items[i].siteApi = site.api;
          stats.items.push(r.items[i]);
        }
        if (typeof onEach === 'function') { try { onEach(site, r.items, null); } catch (e) { } }
      }, function (e) {
        stats.fail++;
        stats.errors.push({ site: site.name, reason: String((e && e.message) || e).slice(0, 60) });
        if (typeof onEach === 'function') { try { onEach(site, [], e); } catch (e2) { } }
      }).then(next);
    }
    var workers = [];
    for (var w = 0; w < conc; w++) workers.push(next());
    return Promise.all(workers).then(function () { return stats; });
  }

  return {
    isApiSite: isApiSite, apiBase: apiBase, buildUrl: buildUrl, getText: getText,
    parseBody: parseBody, parsePlayUrls: parsePlayUrls,
    search: search, category: category, detail: detail, aggSearch: aggSearch
  };
})();
