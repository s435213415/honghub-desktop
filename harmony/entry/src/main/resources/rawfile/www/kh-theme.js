/* HongHub 前端模块：皮肤包（1.7.94 · 清单 #78「皮肤包：外部主题目录 + 下载安装配色」）
   内置皮肤（kh-light/ocean/forest/…）是代码里写死的；皮肤包是同一套调色板变量的外部数据，
   可以从「主题目录」里的 JSON 文件、远端地址下载、或直接粘贴文本装进来，装好后注入一段
   <style> 覆盖变量，不新增任何结构，也不改字号间距。
   安全：只认 8 个白名单变量，颜色只认 #hex / rgb() / rgba()，其它键与值一律丢弃，
   避免有人把 URL/表达式写进主题文件变成注入。
   纯逻辑，不碰 DOM 与存储，便于单测。 */
(function(root, factory){
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KHTHEME = api;
})(typeof window !== 'undefined' ? window : this, function(){
  'use strict';

  var VAR_KEYS = ['bg', 'card', 'card2', 'line', 'text', 'muted', 'brand', 'brand2'];
  var PACK_CAP = 8;
  var NAME_CAP = 24;
  var COLOR_RE = /^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d{1,3})\s*\))$/;

  function isObj(o){ return o && typeof o === 'object' && !Array.isArray(o); }
  function str(v, n){ return String(v == null ? '' : v).trim().slice(0, n); }
  function colorOk(v){
    if (typeof v !== 'string') return false;
    var s = v.trim();
    if (!COLOR_RE.test(s)) return false;
    if (/rgb/i.test(s)) {
      var nums = s.replace(/^rgba?\(|\)$/gi, '').split(',');
      for (var i = 0; i < 3; i++) { var n = parseInt(nums[i], 10); if (!(n >= 0 && n <= 255)) return false; }
    }
    return true;
  }
  /* 只保留白名单键里的合法颜色；返回 {vars, dropped} */
  function cleanVars(raw){
    var out = {}, dropped = [];
    if (!isObj(raw)) return { vars: out, dropped: dropped };
    Object.keys(raw).forEach(function(k){
      if (VAR_KEYS.indexOf(k) < 0) { dropped.push(k); return; }
      if (!colorOk(raw[k])) { dropped.push(k); return; }
      out[k] = String(raw[k]).trim();
    });
    return { vars: out, dropped: dropped };
  }
  /* 包必须有底色 + 主色，否则应用了也看不出变化，直接拒 */
  function normPack(raw, from){
    if (!isObj(raw)) return null;
    var name = str(raw.name, NAME_CAP);
    if (!name) return null;
    var cl = cleanVars(raw.vars || raw.colors || raw);
    var v = cl.vars;
    if (!v.bg || !v.text) return null;
    var id = str(raw.id, 40) || ('t' + hash(name + JSON.stringify(v)));
    return {
      id: id, name: name, vars: v, from: from || str(raw.from, 12) || 'paste',
      at: str(raw.at, 24), dropped: cl.dropped
    };
  }
  function hash(s){
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h.toString(36);
  }
  /* 把一段可能的 JSON 文本解析成包；也接受 {themes:[...]} 批量 */
  function parse(text, from){
    var d;
    try { d = JSON.parse(String(text || '')); } catch (e) { return { ok: false, error: '不是合法 JSON' }; }
    var list = [];
    var src = Array.isArray(d) ? d : (isObj(d) && Array.isArray(d.themes) ? d.themes : [d]);
    for (var i = 0; i < src.length; i++) {
      var p = normPack(src[i], from);
      if (p) list.push(p);
    }
    if (!list.length) return { ok: false, error: '没有可用的配色（需要 name + vars.bg + vars.text）' };
    return { ok: true, packs: list, rejected: src.length - list.length };
  }
  /* 加入包列表：同 id 覆盖，超上限淘汰最旧的 */
  function packsAdd(list, pack){
    var arr = Array.isArray(list) ? list.slice() : [];
    if (!pack || !pack.id || !pack.vars || !pack.vars.bg) return { ok: false, list: arr, error: '包不完整' };
    var hit = -1;
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === pack.id) { hit = i; break; }
    if (hit >= 0) arr[hit] = pack; else arr.push(pack);
    while (arr.length > PACK_CAP) arr.shift();
    return { ok: true, list: arr, replaced: hit >= 0 };
  }
  function packsRemove(list, id){
    var arr = (Array.isArray(list) ? list : []).filter(function(p){ return p && p.id !== id; });
    return arr;
  }
  function packFind(list, id){
    if (!Array.isArray(list) || !id) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }
  /* 生成覆盖样式：只覆盖变量，且只在 body 带 kh-pack 时生效 */
  function packCss(pack){
    if (!pack || !isObj(pack.vars)) return '';
    var parts = [];
    VAR_KEYS.forEach(function(k){
      if (colorOk(pack.vars[k])) parts.push('--' + k + ':' + pack.vars[k] + ';');
    });
    if (!parts.length) return '';
    return 'body.kh-pack{' + parts.join('') + '}\n' +
      'body.kh-pack .topbar{background:var(--card);border-bottom-color:var(--line);}\n' +
      'body.kh-pack .siteform input,body.kh-pack .siteform select,body.kh-pack .backupbox textarea{background:var(--bg);color:var(--text);border-color:var(--line);}\n';
  }
  /* 内置三个包作为「下载安装」的样例与模板（也可直接从远端 themes.json 拉同名包覆盖） */
  var BUILTIN = [
    { id: 'built-neon', name: '赛博霓虹', from: 'built', vars: { bg: '#0B0A1A', card: '#151331', card2: '#1E1B42', line: '#2E2A5C', text: '#EAF0FF', muted: '#9AA3C8', brand: '#FF4FD8', brand2: '#7C6BFF' } },
    { id: 'built-jade', name: '墨玉青', from: 'built', vars: { bg: '#08110F', card: '#10201C', card2: '#162B25', line: '#21403A', text: '#E6F5F0', muted: '#8FB3A9', brand: '#3ECFA0', brand2: '#79E6C6' } },
    { id: 'built-ember', name: '暖砂夜', from: 'built', vars: { bg: '#15100B', card: '#221913', card2: '#2E2118', line: '#443023', text: '#F7EEE3', muted: '#B9A08A', brand: '#F08A48', brand2: '#FFB27C' } }
  ];
  function builtins(){ return BUILTIN.map(function(p){ return normPack(p, 'built'); }); }

  return {
    VAR_KEYS: VAR_KEYS, PACK_CAP: PACK_CAP, BUILTIN: BUILTIN,
    colorOk: colorOk, cleanVars: cleanVars, normPack: normPack, parse: parse,
    packsAdd: packsAdd, packsRemove: packsRemove, packFind: packFind, packCss: packCss,
    builtins: builtins, hash: hash
  };
});
