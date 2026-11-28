/* HongHub 前端模块：家庭多档案（1.7.94 · 清单 #58「各档案独立收藏 / 历史 / 儿童设置」）
   做法：不改任何既有代码的存储键，切换档案时把「当前档案」的那几个键快照进档案槽，
   再把目标档案的快照写回去。这样收藏、历史、进度、儿童设置天然独立，所有旧逻辑零改动，
   也不会因为前缀改造把用户已有数据读丢。
   纯逻辑：快照读写用注入的回调，单测里用内存对象代替 localStorage。 */
(function(root, factory){
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KHFAMILY = api;
})(typeof window !== 'undefined' ? window : this, function(){
  'use strict';

  var CAP = 4;
  var NAME_CAP = 12;
  /* 档案之间独立的键：收藏 / 稍后看 / 历史 / 进度 / 自建片单 / 直播收藏 / 儿童设置 */
  var SNAP_KEYS = ['kh_fav', 'kh_watchlater', 'kh_hist', 'kh_prog', 'kh_watchlist', 'kh_watchlist_meta', 'kh_livefav', 'kh_kid', 'kh_kid_pin', 'kh_kid_min'];
  var COLORS = ['#5AC8FA', '#FF7AB6', '#8CE99A', '#FFC46B'];
  var DEF = [{ id: 'p1', name: '家庭', color: COLORS[0], createdAt: '' }];

  function isObj(o){ return o && typeof o === 'object' && !Array.isArray(o); }
  function name(v){
    return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NAME_CAP);
  }
  function normProfile(raw, i){
    if (!isObj(raw)) return null;
    var n = name(raw.name);
    if (!n) return null;
    return {
      id: String(raw.id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || ('p' + (i + 1)),
      name: n,
      color: /^#[0-9a-fA-F]{6}$/.test(String(raw.color || '')) ? raw.color : COLORS[i % COLORS.length],
      createdAt: String(raw.createdAt || '').slice(0, 24)
    };
  }
  function normList(raw){
    var list = [];
    if (Array.isArray(raw)) {
      raw.forEach(function (r, i) { var p = normProfile(r, i); if (p && !list.some(function (x) { return x.id === p.id; })) list.push(p); });
    }
    if (!list.length) return DEF.map(function (p) { return Object.assign({}, p); });
    return list.slice(0, CAP);
  }
  function normCurrent(list, raw){
    var ids = list.map(function (p) { return p.id; });
    return ids.indexOf(String(raw || '')) >= 0 ? String(raw) : ids[0];
  }
  function create(list, n, color){
    var arr = Array.isArray(list) ? list.slice() : [];
    if (arr.length >= CAP) return { ok: false, list: arr, error: '最多 ' + CAP + ' 个档案，先删一个再加' };
    var nm = name(n);
    if (!nm) return { ok: false, list: arr, error: '档案名不能为空' };
    if (arr.some(function (p) { return p.name === nm; })) return { ok: false, list: arr, error: '已经有同名档案' };
    var id = 'p' + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 4);
    var p = { id: id, name: nm, color: /^#[0-9a-fA-F]{6}$/.test(String(color || '')) ? color : COLORS[arr.length % COLORS.length], createdAt: new Date().toISOString() };
    arr.push(p);
    return { ok: true, list: arr, profile: p };
  }
  function rename(list, id, n){
    var nm = name(n);
    if (!nm) return { ok: false, list: list, error: '档案名不能为空' };
    var arr = (Array.isArray(list) ? list : []).map(function (p) { return p.id === id ? Object.assign({}, p, { name: nm }) : p; });
    return { ok: true, list: arr };
  }
  function remove(list, id){
    var arr = Array.isArray(list) ? list.filter(function (p) { return p.id !== id; }) : [];
    if (!arr.length) return { ok: false, list: list, error: '至少要留一个档案' };
    return { ok: true, list: arr };
  }
  /* 快照：只抓 SNAP_KEYS 里「有值」的键，null 表示没设过（还原时清除） */
  function snapshot(read){
    var out = {};
    SNAP_KEYS.forEach(function (k) {
      var v = null;
      try { v = read ? read(k) : null; } catch (e) { v = null; }
      if (v !== null && v !== undefined) out[k] = v;
    });
    return out;
  }
  function restore(snap, write){
    var n = 0;
    SNAP_KEYS.forEach(function (k) {
      if (snap && Object.prototype.hasOwnProperty.call(snap, k)) { write(k, snap[k]); n++; }
      else write(k, null);
    });
    return n;
  }
  function summary(p, snap){
    var s = snap || {};
    return {
      fav: Array.isArray(s.kh_fav) ? s.kh_fav.length : 0,
      hist: Array.isArray(s.kh_hist) ? s.kh_hist.length : 0,
      prog: s.kh_prog && typeof s.kh_prog === 'object' ? Object.keys(s.kh_prog).length : 0,
      kid: Number(s.kh_kid || 0) === 1
    };
  }
  return {
    CAP: CAP, SNAP_KEYS: SNAP_KEYS, COLORS: COLORS, DEF: DEF,
    normProfile: normProfile, normList: normList, normCurrent: normCurrent,
    create: create, rename: rename, remove: remove,
    snapshot: snapshot, restore: restore, summary: summary
  };
});
