/* HongHub 前端模块：本地存储/DOM 引用/通用 UI/视图渲染/能力开关
   由 app/index.html 单文件版拆分（1.7.72 模块化），按 <script> 顺序加载，顶层函数/常量共享全局作用域。 */
/* ---------------- 本地存储：带类型守卫，损坏数据自动自愈 ---------------- */
var mem = {};
var BOOT_AT = Date.now();
function getStore(k, d){
  var raw;
  try{ raw = localStorage.getItem(k); }
  catch(e){ return mem[k] === undefined ? d : mem[k]; }  // localStorage 不可用：降级内存
  if(raw === null) return d;
  try{ return JSON.parse(raw); }
  catch(e){
    // 数据损坏：删除坏键并写回默认值，真正自愈而不是每次都走异常分支
    try{ localStorage.removeItem(k); }catch(e2){}
    mem[k] = d;
    return d;
  }
}
function setStore(k, v){
  mem[k] = v;
  try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){}
}
/* 中枢地址：多机部署时把 /api/ 请求整体转到远端中枢（本机模式留空即不生效） */
(function(){
  var hub = '';
  try { hub = String(getStore('kh_hub_url', '') || '').replace(/\/$/, ''); } catch(e) { return; }
  if(!hub || !/^https?:\/\//i.test(hub) || !window.fetch) return;
  var orig = window.fetch.bind(window);
  window.fetch = function(u, o){
    if(typeof u === 'string' && u.indexOf('/api/') === 0) u = hub + u;
    return orig(u, o);
  };
})();
function strArray(k){
  var v = getStore(k, []);
  if(!Array.isArray(v)){ setStore(k, []); return []; }
  var out = [];
  for(var i=0;i<v.length;i++){ if(typeof v[i] === 'string') out.push(v[i]); }
  return out;
}
function plainObject(k){
  var v = getStore(k, {});
  if(!v || typeof v !== 'object' || Array.isArray(v)){ setStore(k, {}); return {}; }
  return v;
}
/* #120 本地数据容量上限：超出后按插入序淘汰最旧条目，避免本地存储无限膨胀 */
var KH_HIST_CAP = 30, KH_FAV_CAP = 100, KH_WL_CAP = 50, KH_PROG_CAP = 200;
/* 存储键 → 上限，导入 / 合并时统一裁剪，避免备份里的超量条目撑爆本地存储 */
var KH_CAP_BY_KEY = { kh_fav: KH_FAV_CAP, kh_watchlater: KH_WL_CAP, kh_hist: KH_HIST_CAP, kh_watchlist: 50 };
function getFav(){ return strArray('kh_fav'); }
function getHistory(){ return strArray('kh_hist'); }
function getProgress(){ return plainObject('kh_prog'); }
/* 进度对象容量治理：按插入序淘汰最旧，避免本地存储无限膨胀 */
function khTrimProgress(p, cap){
  if(!p || typeof p !== 'object') return;
  var keys = Object.keys(p);
  while(keys.length > cap){ delete p[keys.shift()]; }
}
function getSites(){
  var v = getStore('kh_sites', []);
  if(!Array.isArray(v)){ setStore('kh_sites', []); return []; }
  var out = [];
  for(var i=0;i<v.length;i++){
    var s = v[i];
    if(s && typeof s.name === 'string' && typeof s.url === 'string' && /^https?:\/\//i.test(s.url)) out.push(s);
  }
  return out;
}
function normalizeSiteUrl(raw){
  var u = String(raw || '').trim();
  if(!u) return '';
  /* 协议白名单 + 反钓鱼校验：只放行 http(s)；拒绝内嵌账号密码（user:pass@host 伪装）、
     控制字符与反斜杠混淆（浏览器会把 \ 当 / 解析，常用于伪装域名） */
  if(/[\u0000-\u001f\u007f\\\s]/.test(u)) return '';
  if(!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try{
    var p = new URL(u);
    if(p.protocol !== 'http:' && p.protocol !== 'https:') return '';
    if(!p.hostname) return '';
    if(p.username || p.password) return '';
    return p.href;
  }catch(e){ return ''; }
}
function esc(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function reEsc(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
/* 拼音首字母：用 zh 拼音排序边界字比对（Chromium Intl 内置，无需词典）。
   「大雄兔」→ dxt；非汉字原样保留小写。结果按字符串缓存，避免重复比对。 */
var PY_BOUNDS = [['a','阿'],['b','八'],['c','嚓'],['d','哒'],['e','妸'],['f','发'],['g','旮'],['h','哈'],['j','讥'],['k','咔'],['l','垃'],['m','妈'],['n','拿'],['o','噢'],['p','啪'],['q','期'],['r','然'],['s','撒'],['t','塌'],['w','挖'],['x','昔'],['y','压'],['z','匝']];
var pyCache = {};
function pyInitials(str){
  str = String(str || '');
  if(pyCache[str] !== undefined) return pyCache[str];
  var out = '';
  try{
    var col = new Intl.Collator('zh-Hans-CN-u-co-pinyin');
    for(var i=0;i<str.length;i++){
      var ch = str[i];
      if(/[a-z0-9]/i.test(ch)){ out += ch.toLowerCase(); continue; }
      if(!/[\u4e00-\u9fa5]/.test(ch)) continue;
      var letter = '';
      for(var b=PY_BOUNDS.length-1;b>=0;b--){
        if(col.compare(ch, PY_BOUNDS[b][1]) >= 0){ letter = PY_BOUNDS[b][0]; break; }
      }
      out += letter;
    }
  }catch(e){ out = str.toLowerCase(); }
  pyCache[str] = out;
  return out;
}
function highlight(escaped, kw){
  if(!kw) return escaped;
  try{ return escaped.replace(new RegExp('(' + reEsc(esc(kw)) + ')', 'ig'), '<mark>$1</mark>'); }
  catch(e){ return escaped; }
}
function hashId(s){
  var h = 0;
  for(var i=0;i<s.length;i++){ h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}

/* ---------------- DOM 引用与状态 ---------------- */
var els = {
  main: document.getElementById('main'),
  nav: document.getElementById('nav'),
  search: document.getElementById('searchInput'),
  searchClear: document.getElementById('searchClear'),
  player: document.getElementById('playerLayer'),
  videoWrap: document.getElementById('videoWrap'),
  video: document.getElementById('video'),
  title: document.getElementById('playerTitle'),
  info: document.getElementById('playerInfo'),
  msg: document.getElementById('playerMsg'),
  srcBar: document.getElementById('srcBar'),
  asideWrap: document.getElementById('playerAside'),
  asideList: document.getElementById('asideList'),
  tap: document.getElementById('tapPlay'),
  buffering: document.getElementById('buffering'),
  favBtn: document.getElementById('favBtn'),
  toast: document.getElementById('toast'),
  toastText: document.getElementById('toastText'),
  toastAction: document.getElementById('toastAction'),
  diag: document.getElementById('diag'),
  status: document.getElementById('statusText'),
  statusWrap: document.getElementById('statusWrap'),
  seek: document.getElementById('seek'),
  vol: document.getElementById('vol'),
  timeText: document.getElementById('timeText'),
  btnPlay: document.getElementById('btnPlay'),
  btnMute: document.getElementById('btnMute'),
  btnRate: document.getElementById('btnRate'),
  btnQuality: document.getElementById('btnQuality'),
  btnFit: document.getElementById('btnFit'),
  toTop: document.getElementById('toTop'),
  liveBar: document.getElementById('liveBar'),
  lbCh: document.getElementById('lbCh'),
  lbEpg: document.getElementById('lbEpg'),
  lbClock: document.getElementById('lbClock'),
  lbFav: document.getElementById('lbFav')
};
var state = {
  view:'home', category:'全部', keyword:'', searchCat:'', movie:null, srcIndex:0, hls:null, qIdx:-1, sgIndex:-1, scrollPos:{}, brightness:1, khSuppressTap:false,
  lastSave:0, userVolume:1, userMuted:false, rate:1, seekDragging:false,
  compatMode:false, loudnessEq:false, audioGraph:null, fit:'contain', resumePos:0, autoDownAt:0,
  failKey:'', failedSrc:{}, editIndex:-1, confirmClear:false,
  renderCount:0, searchTimer:0, undo:null, toastTimer:0, undoCallback:null,
  liveGroup:'全部', liveList:[], liveIndex:-1, liveEdit:-1, liveConfirmClear:false, hlsToken:0,
  liveFast:true, watchdogToken:0, watchdogTimer:0, watchdogFired:0,
  liveKeyword:'', liveSearchFocus:false, liveSearchTimer:0,
  resEdit:-1, resConfirmClear:false,
  favConfirmClear:false, histConfirmClear:false,
  platCat:'电影', platFilter:'direct', syncTitle:'',  /* 默认只显示可直接打开的平台，海外站不干扰日常；点“显示全部”可展开 */
  issueConfirm:false, issueReportText:'', issuePaintTimer:0,
  playStats:{startMs:0, firstFrameMs:0, buffering:0, downgrades:0, sourceSwitches:0}
};
/* 视图恢复必须早于 boot 的第一次 render()。
   boot 期间 applySourceData / applySiteData / readEmbeddedSources 都会调用 render()，
   如果把恢复放在文件末尾，这些 render() 会先把默认的 home 写回 kh_view_state，
   把「打开网页前所在页面」覆盖掉 —— 这正是返回后直接落回首站的根因。
   普通冷启动也回到上次所在页面，符合影视应用的续看习惯。 */
(function(){
  var vs = null;
  try{ vs = getStore('kh_view_state', null); }catch(e){}
  if(vs && typeof vs.view === 'string' && vs.view && vs.view.length <= 24){
    state.view = vs.view;
    if(typeof vs.cat === 'string' && vs.cat) state.platCat = vs.cat;
    if(typeof vs.filter === 'string' && vs.filter) state.platFilter = vs.filter;
    state.lastViewKey = state.view + '|' + state.platCat + '|' + state.platFilter;
  }
})();
/* 直播起播模式：fast=全部频道默认离线秒开（默认，任何网络/设备都能出画面）；
   online=优先在线真流（需外网）。持久化到 localStorage，用户可在直播页一键切换。 */
/* 恒为直播直连模式：不再提供离线模式切换 */
var diagMode = document.getElementById('diag');
if(diagMode) diagMode.setAttribute('data-livemode', state.liveFast ? 'live' : 'fast');
var posterCache = {};

/* ---------------- 通用 UI ---------------- */
function toast(text, actionLabel, actionFn){
  els.toastText.textContent = text;
  if(actionLabel && actionFn){
    els.toastAction.textContent = actionLabel;
    els.toastAction.style.display = 'block';
    state.undoCallback = actionFn;
  } else {
    els.toastAction.style.display = 'none';
    state.undoCallback = null;
  }
  els.toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(function(){ els.toast.classList.remove('show'); }, actionLabel ? 5200 : 1800);
}
function setDiag(k, v){ els.diag.setAttribute('data-' + k, String(v)); }
function fmtTime(s){
  if(!isFinite(s) || s < 0) s = 0;
  var m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
}

/* ---------------- 视图渲染 ---------------- */
function findMovie(id){
  var all = allMovies();
  for(var i=0;i<all.length;i++){ if(all[i].id === id) return all[i]; }
  return null;
}
function byIds(ids){
  var out = [];
  for(var i=0;i<ids.length;i++){ var m = findMovie(ids[i]); if(m) out.push(m); }
  return out;
}
function poster(m, kw){
  var fav = getFav().indexOf(m.id) >= 0;
  var prog = getProgress()[m.id] || 0;
  var key = m.id + '|' + (kw || '') + '|' + (fav ? 1 : 0) + '|' + prog;
  if(posterCache[key]) return posterCache[key];
  var c1 = (m.color && /^#[0-9a-fA-F]{6}$/.test(m.color)) ? m.color : '#3B456B';
  var c2 = (m.accent && /^#[0-9a-fA-F]{6}$/.test(m.accent)) ? m.accent : '#5B7BC4';
  var bg = 'linear-gradient(155deg,' + c1 + ' 0%,' + c2 + ' 130%)';
  var cover = m.cover ? '<img class="poster-img" src="' + esc(m.cover) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
  var html = '<div class="card" data-act="play" data-id="' + m.id + '" tabindex="0" role="button" aria-label="播放 ' + esc(m.title) + '">' +
    '<div class="poster' + (m.cover ? ' has-cover' : '') + '" style="background:' + bg + '">' +
      cover +
      '<div class="badge">★ ' + m.rating.toFixed(1) + '</div>' +
      (fav ? '<div class="badge badge-fav" title="已收藏">★ 收藏</div>' : '') +
  (movieAllDead(m) ? '<div class="badge" style="left:auto;right:8px;background:#7A2323" title="本机探测：全部线路连不上">⚠ 线路不可用</div>' : '') +
      '<div class="play-badge">▶</div>' +
      '<div class="ptitle">' + highlight(esc(m.title), kw) + '</div>' +
      '<div class="psub">' + esc(m.subtitle) + '</div>' +
      (m.desc ? '<div class="card-tip"><div class="ct-desc">' + esc(m.desc) + '</div>' + (m.cast ? '<div class="ct-cast">' + esc(m.cast) + '</div>' : '') + '</div>' : '') +
    '</div>' +
    '<div class="card-meta"><div class="t">' + highlight(esc(m.title), kw) + '</div>' +
    '<div class="s">' + m.year + ' · ' + esc(m.category) + ' · ' + esc(m.tags.join(' / ')) + (m.own ? ' · 自建' : '') + (prog > 0 ? ' · ⏱ ' + fmtTime(prog) : '') + '</div></div>' +
  '</div>';
  posterCache[key] = html;
  return html;
}
function cardsHtml(list, grid, kw){
  if(!list.length) return '<div class="empty"><span class="ico">🎬</span>这里还没有内容，去首页挑一部吧</div>';
  var body = '';
  for(var i=0;i<list.length;i++) body += poster(list[i], kw);
  return grid ? '<div class="grid">' + body + '</div>' : '<div class="row">' + body + '</div>';
}
function siteItem(s, index, builtin){
  var target = builtin ? platOpenUrl(s) : s.url;
  var url = esc(target);
  var mode = builtin ? platEntryMode(s) : 'pc';
  var tag = esc((s.tag || s.name || 'W').slice(0,1));
  var dead = builtin ? false : siteDead(s.url);
  var recent = builtin ? false : (s.lastAt && (Date.now() - Number(s.lastAt)) < 7 * 24 * 3600 * 1000);
  return '<div class="siteitem"' + (dead ? ' style="opacity:.55"' : '') + ' title="' + esc(PLAT_MODE[platMode(s)].hint) + '">' +
    '<div class="siteico" style="background:' + esc(s.color || '#3B456B') + '">' + tag + '</div>' +
    '<div class="sitemeta"><div class="n">' + (builtin ? platHealthDot(s.name) : '') + esc(s.name) +
      (builtin ? platBadge(s) :
        (dead ? '<span class="builtin" style="color:#E5534B">本机打不开</span>' : '') +
        (s.group ? '<span class="builtin">' + esc(s.group) + '</span>' : '') +
        (recent ? '<span class="builtin">最近</span>' : '')) + '</div>' +
    '<div class="u">' + url + '</div></div>' +
    (builtin ? '' : '<button class="mini" data-act="site-up" data-index="' + index + '" title="上移">↑</button>' +
                    '<button class="mini" data-act="site-edit" data-index="' + index + '" title="编辑">✎</button>') +
    '<button class="mini" data-act="plat-copy" data-url="' + url + '" title="复制网址（可粘到有网络条件的浏览器）">⧉</button>' +
    '<button class="siteopen" data-act="site-open" data-mode="' + mode + '" data-url="' + url + '">打开</button>' +
    (builtin ? '' : '<button class="sitedel" data-act="site-del" data-index="' + index + '" title="删除">✕</button>') +
  '</div>';
}
/* ---------------- 客户成品能力开关 ----------------
   桌面客户包与开发端共用同一份页面代码。客户包不展示、也不调用开发端运维动作
   （一键自愈 / 同时更新并发布 / 自治 / 功能管理 / 批量与架构清单）；
   服务端对同一批接口也返回 404，页面隐藏只是第一道闸。 */
var KH_CLIENT_ONLY = false;
/* 客户纯净版开关：服务端下发 index.html 时按运行模式注入 window.KH_UI_CLEAN
   （客户成品 = 1，开发端 = 0）。没有注入时一律按客户纯净版处理，
   设备端 / 离线页面同样不会出现扩展工具入口与 PKG 角标。 */
var KH_UI_CLEAN = false;
/* 客户纯净版：连右下角的 PKG 版本角标也收掉，客户看不到内部构建标记 */
try { if (KH_UI_CLEAN) { var _pkg = document.getElementById('__pkgver'); if (_pkg) _pkg.style.display = 'none'; } } catch (e) {}
/* AI 字幕翻译按钮：外部模型属于「外部条件」，没配置就不该出现这颗按钮。
   客户版直接不显示（服务端在非开发模式下也拒绝该接口）；开发端向公开能力端点确认配置后再定。 */
try {
  (function () {
    function hideTrans() {
      try { var b = document.getElementById('btnSubTrans'); if (b) b.style.display = 'none'; } catch (e) {}
    }
    function decide() {
      if (KH_UI_CLEAN) { hideTrans(); return; }
      try {
        fetch('/api/capabilities').then(function (r) { return r.json(); })
          .then(function (d) { if (!d || d.aiTranslate !== true) hideTrans(); })
          .catch(hideTrans);
      } catch (e) { hideTrans(); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decide);
    else decide();
  })();
} catch (e) {}
var KH_DEV_ACTION = /^(builtin:(fix|updatepublish|automation|govern|mine|batch|arch|audit|trend|rollout|smoke|alerts|publish|catalog|play|issues))$|^(script|webhook)$/;
function khIsDevFeature(f){ return !!(f && KH_CLIENT_ONLY && KH_DEV_ACTION.test(String((f && f.action) || ''))); }
function khClientFeatures(list){ return (list || []).filter(function(f){ return !khIsDevFeature(f); }); }

/* 局域网模式下服务端要求带口令；本机回环模式为空，不影响使用 */
function khAccessToken(){ try{ return localStorage.getItem('kh_access_token') || ''; }catch(e){ return ''; } }
function khFetch(url, opt){
  opt = opt || {};
  var h = {}, src = opt.headers || {};
  for(var k in src){ if(Object.prototype.hasOwnProperty.call(src, k)) h[k] = src[k]; }
  var t = khAccessToken();
  if(t) h['X-KH-Access-Token'] = t;
  opt.headers = h;
  var _host = ''; try{ _host = new URL(url, location.href).hostname; }catch(e){}
  return fetch(url, opt).then(function(resp){
    if(resp && !resp.ok){
      try{ issuePush('网络', '请求失败 HTTP ' + resp.status + (_host ? ' · ' + _host : ''), {code:String(resp.status)}); }catch(e){}
    }
    return resp;
  }).catch(function(err){
    try{ issuePush('网络', '请求异常 ' + (err && err.message ? err.message : 'network') + (_host ? ' · ' + _host : ''), {}); }catch(e){}
    throw err;
  });
}
/* 播放埋点回传：只报资源 id 与结果（首帧 / 失败），不报片名、链接与设备身份。
   服务端据此自动建问题单并换源，客户端不需要重装就能拿到修好的源。 */
var _khPlaySent = {};
function khPlayReport(catalogId, action, errorCode, latencyMs){
  try{
    if(!window.fetch || !catalogId) return;
    if(action !== 'fail'){ var g = catalogId + '|' + action; if(_khPlaySent[g]) return; _khPlaySent[g] = 1; }
    khFetch('/api/play/report', { method:'POST', headers:{'Content-Type':'application/json'}, cache:'no-store',
      body: JSON.stringify({ catalogId:String(catalogId), action:String(action || 'open'),
        errorCode: errorCode ? String(errorCode).slice(0,32) : undefined,
        latencyMs: Number(latencyMs) || 0 }) });
  }catch(e){}
}
function khVideoCatalogId(m){
  if(!m || !m.id) return '';
  return (m.live ? 'ch:' : 'movie:') + String(m.id);
}

function render(){
  state.renderCount++;
  /* 记住当前所在视图 + 分类 / 筛选：从原生网页页返回时 WebView 可能被系统回收重建，
     有了这份状态就能回到原来的平台页，而不是被重置回首站首页。 */
  var vkey = state.view + '|' + state.platCat + '|' + state.platFilter;
  if(vkey !== state.lastViewKey){
    state.lastViewKey = vkey;
    try{ setStore('kh_view_state', {view:state.view, cat:state.platCat, filter:state.platFilter}); }catch(e){}
  }
  var html = '';
  html += bootBannerHtml();
  var kw = state.keyword.trim().toLowerCase();
            if(state.view === 'home'){
    var allM = allMovies();
    if(allM.length){
      var hero = allM[0];
      html += '<div class="hero"><div class="hero-inner">' +
        '<div class="hero-tag">今日推荐 · 点击即播</div>' +
        '<h1>' + esc(hero.title) + '</h1>' +
        '<p>' + esc(hero.desc) + '</p>' +
        '<button class="btn-primary" data-act="play" data-id="' + hero.id + '">▶ 立即播放</button>' +
        '<button class="btn-ghost" style="margin-left:10px" data-act="view" data-view="category">浏览全部片单</button>' +
        '<button class="btn-ghost" style="margin-left:10px" data-act="open-file" title="从本机选一个视频文件直接播（仅桌面版）">📂 打开本机视频</button>' +
      '</div></div>';
    } else {
      html += '<div class="hero"><div class="hero-inner">' +
        '<div class="hero-tag">欢迎使用</div>' +
        '<h1>影视资源</h1>' +
        '<p>内置 ' + LIVE_CHANNELS.length + ' 个已实测可播的电视频道、' + allMovies().length + ' 部公开授权片源，' + BUILTIN_SITES.length + ' 个平台官方入口；也可以自行添加直链或影视网站。</p>' +
        '<button class="btn-primary" data-act="view" data-view="live">📺 看卫视直播</button>' +
        '<button class="btn-ghost" style="margin-left:10px" data-act="view" data-view="custom">➕ 添加网址</button>' +
        '<button class="btn-ghost" style="margin-left:10px" data-act="open-file" title="从本机选一个视频文件直接播（仅桌面版）">📂 打开本机视频</button>' +
      '</div></div>';
    }
    html += '<div class="section-head"><h2>内容直达</h2><span>点播 · 直播 · 平台，一键切换</span></div>';     html += '<div class="chips"><button class="chip" data-act="view" data-view="category">🎬 点播片单</button><button class="chip" data-act="view" data-view="live">📺 电视直播</button><button class="chip" data-act="view" data-view="sites">🌐 平台入口</button><button class="chip" data-act="view" data-view="resources">📦 全部资源</button></div>';
    /* 红果短剧「打开即看」：应用内 WebView 直达官方网页版，无需外部浏览器 */
    var _q = khQuick();
    html += '<div class="section-head"><h2>红果短剧 · 打开即看</h2><span>应用内直接播放 · 无需跳转外部浏览器</span></div>' +
      '<div class="sitebox"><h3>点开就能看，官方网页版一键直达</h3>' +
      '<p>红果短剧（抖音集团旗下）官方网页版在应用内 WebView 打开，已配置标准桌面 UA 与 Cookie；点下面按钮直达今日热播剧播放页或热播榜，进站点「播放正片」即可观看。找剧AI 用于 AI 全网搜剧。应用仅提供官方入口导航，不聚合、不缓存、不破解任何第三方片源。</p>' +
      '<div class="chips">' +
      '<button class="chip" data-act="site-open" data-url="' + esc(_q.hgDetail) + '">▶ 今日推荐 · 直接看</button>' +
      '<button class="chip" data-act="site-open" data-url="' + esc(_q.hgRank) + '">🔥 热播短剧榜</button>' +
      '<button class="chip" data-act="site-open" data-url="' + esc(_q.hgHome) + '">🏠 红果首页</button>' +
      '<button class="chip" data-act="site-open" data-url="' + esc(_q.zjSearch) + '">🔎 找剧AI · AI 全网搜</button>' +
      '</div>' +
      '<div class="tip">首次打开若要求登录或出现空白，用页面顶部「刷新」重试即可；播放需设备已联网。<b>hongguo-player</b> 是 Windows / macOS 的第三方开源桌面播放器（Electron），无法安装在开鸿设备上，本站仅在「平台入口」提供其项目页供电脑端参考；其 CENC 解密拉流方案不在本应用内实现。</div>' +
      '</div>';
    var _sections = getSections();
    for(var s=0;s<_sections.length;s++){
      var sec = _sections[s];
      html += '<div class="section-head"><h2>' + esc(sec.title) + '</h2><span>' + esc(sec.sub) + '</span></div>' +
              cardsHtml(byIds(sec.ids), false);
    }
    /* 本地榜单：内置评分 × 本机观看次数排序，如实标注口径，不伪造全网热度 */
    var rankList = allMovies().slice().sort(function(a, b){
      var ha = getHistory().indexOf(a.id) >= 0 ? 1 : 0, hb = getHistory().indexOf(b.id) >= 0 ? 1 : 0;
      return (b.rating + hb * 0.3) - (a.rating + ha * 0.3);
    }).slice(0, 8);
    if(rankList.length){
      html += '<div class="section-head"><h2>🏆 高分榜单</h2><span>口径：内置评分 + 本机看过加权 · 非全网热度</span></div>' +
        cardsHtml(rankList, false);
    }
    html += '<div class="tip">电脑端小贴士：按 <kbd>/</kbd> 快速搜索　播放器内 <kbd>空格</kbd> 播放/暂停　<kbd>←</kbd><kbd>→</kbd> 快退 / 快进　<kbd>Esc</kbd> 返回；' +
      '在影片行上滚动鼠标滚轮可横向翻页。</div>';

  } else if(state.view === 'category'){
    html += '<div class="section-head"><h2>分类片单</h2><span>共 ' + allMovies().length + ' 部，点击海报直接播放</span></div><div class="chips">';
    html += '<button class="chip ' + (state.category==='全部'?'on':'') + '" data-act="cat" data-cat="全部">全部</button>';
    for(var c=0;c<CATEGORIES.length;c++){
      var cat = CATEGORIES[c];
      html += '<button class="chip ' + (state.category===cat?'on':'') + '" data-act="cat" data-cat="' + esc(cat) + '">' + esc(cat) + '</button>';
    }
    html += '</div>';
    /* 年份筛选：全部 / 2020 及以后 / 2010–2019 / 2010 以前 */
    var yr = state.catYear || '全部';
    html += '<div class="chips" style="margin-top:6px">' +
      ['全部', '2020 及以后', '2010–2019', '2010 以前'].map(function(y){
        return '<button class="chip ' + (yr === y ? 'on' : '') + '" data-act="cat-year" data-y="' + esc(y) + '">' + (y === '全部' ? '全部年份' : y) + '</button>';
      }).join('') + '</div>';
    var list = state.category === '全部' ? allMovies() : allMovies().filter(function(m){ return m.category === state.category; });
    if(yr !== '全部'){
      list = list.filter(function(m){
        var y = Number(m.year) || 0;
        if(yr === '2020 及以后') return y >= 2020;
        if(yr === '2010–2019') return y >= 2010 && y <= 2019;
        return y > 0 && y < 2010;
      });
    }
    list = khRecentFirst(list);
    if(!list.length){
      html += '<div class="empty"><span class="ico">🎬</span>「' + esc(state.category) + '」暂无内置直链片源<br>' +
        '这个分类走平台官方入口观看，或把你自己的直链加到「资源」页</div>' +
        '<div class="chips"><button class="chip" data-act="view" data-view="sites">🌐 平台入口看「' + esc(state.category) + '」</button>' +
        '<button class="chip" data-act="view" data-view="resources">📦 添加自己的片源</button></div>';
    } else html += cardsHtml(list, true);
  } else if(state.view === 'search'){
    var res = kw ? allMovies().filter(function(m){
      var hay = (m.title+m.subtitle+m.cast+m.tags.join('')+m.category).toLowerCase();
      if(hay.indexOf(kw) >= 0) return true;
      /* 拼音首字母：纯字母关键词（如 dxt）匹配片名首字母 */
      if(/^[a-z]{2,}$/.test(kw) && pyInitials(m.title).indexOf(kw) >= 0) return true;
      return false;
    }) : [];
    /* #119 结果分类筛选：从命中集聚合出现过的分类，叠加 searchCat 过滤 */
    var _searchCats = [];
    res.forEach(function(m){ if(m.category && _searchCats.indexOf(m.category) < 0) _searchCats.push(m.category); });
    if(state.searchCat && _searchCats.indexOf(state.searchCat) < 0) state.searchCat = '';
    var resCat = state.searchCat ? res.filter(function(m){ return m.category === state.searchCat; }) : res;
    var offlineNow = (typeof navigator !== 'undefined' && navigator.onLine === false);
    var _searchChips = _searchCats.length > 1 ? '<div class="chips">' +
      '<button class="chip ' + (!state.searchCat ? 'on' : '') + '" data-act="search-cat" data-cat="">全部</button>' +
      _searchCats.map(function(c){ return '<button class="chip ' + (state.searchCat === c ? 'on' : '') + '" data-act="search-cat" data-cat="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') +
      '</div>' : '';
    html += '<div class="section-head"><h2>搜索结果</h2><span>关键词「' + esc(state.keyword) + '」· ' + resCat.length + ' 部</span></div>' + _searchChips +
            (kw ? (resCat.length ? cardsHtml(resCat, true, state.keyword.trim()) :
              (offlineNow
                ? '<div class="empty"><span class="ico">📡</span>本机当前离线：只能搜到内置片单<br>恢复网络后可同步更多资源再搜</div>'
                : '<div class="empty"><span class="ico">🔎</span>没有找到「' + esc(state.keyword) + '」相关的影片<br>' + (state.searchCat ? '该分类下暂无结果，可切换上方分类看看<br>' : '') + '换个片名、演员或标签试试</div>'))
                : '<div class="empty"><span class="ico">🔎</span>输入片名、演员或标签即可搜索<br>也支持拼音首字母，如「dxt」搜大雄兔</div>');
    if(kw){
      html += '<div class="sitebox"><h3>站内没有？去这些平台官方搜索页查「' + esc(state.keyword) + '」</h3>' +
        '<div class="sitetools">' +
        (function(){
          var names = ['哔哩哔哩','腾讯视频','爱奇艺','优酷','芒果TV','西瓜视频','咪咕视频','AcFun','乐视视频','PPTV 聚力','豆瓣电影','猫眼电影'];
          var out = '';
          for(var i=0;i<names.length;i++){
            out += '<button class="qbtn" data-act="site-open" data-url="' + esc(platformUrl(names[i], state.keyword)) + '">' + esc(names[i]) + '</button>';
          }
          return out;
        })() +
        '</div><p class="platnote">点开的是各平台官方搜索页，片源留在原平台，本站不聚合、不缓存、不转发任何第三方内容。</p></div>';
    }
  } else if(state.view === 'favorites'){
    var wl = byIds(getWatchLater());
    if(wl.length){
      html += '<div class="section-head"><h2>⏰ 稍后再看</h2><span>' + wl.length + ' 部 · 播放器里点「稍后看」加入</span></div>' +
        '<div class="sitelist">';
      for(var wi=0;wi<wl.length;wi++){
        html += '<div class="siteitem"><div class="siteico" style="background:' + esc(wl[wi].color || '#3B456B') + '">' + esc(String(wl[wi].title).slice(0,1)) + '</div>' +
          '<div class="sitemeta"><div class="n">' + esc(wl[wi].title) + '</div><div class="u">' + esc(wl[wi].subtitle || '') + '</div></div>' +
          '<button class="mini" data-act="watchlater-del" data-id="' + esc(wl[wi].id) + '" title="移除">✕</button>' +
          '<button class="siteopen" data-act="play" data-id="' + esc(wl[wi].id) + '">▶ 播放</button></div>';
      }
      html += '</div>';
    }
    /* 追剧订阅（本机维度）：服务端快照变化标「有更新」，不代表官方新集上线 */
    var subIds = getWatchSub();
    if(subIds.length){
      var subMeta = watchSubMeta();
      html += '<div class="section-head"><h2>⭐ 追剧订阅</h2><span>' + subIds.length + ' 部 · 本机记录，片单快照变化时提醒</span></div>' +
        '<div class="sitelist">';
      for(var si=0; si<subIds.length; si++){
        var sid2 = subIds[si], sm2 = findMovie(sid2);
        var stitle = sm2 ? sm2.title : (subMeta[sid2] && subMeta[sid2].title) || sid2;
        var ssub = sm2 ? (sm2.subtitle || '') : '本机订阅条目（不在当前片单）';
        var supd = subMeta[sid2] && subMeta[sid2].updated;
        html += '<div class="siteitem"><div class="siteico" style="background:' + esc((sm2 && sm2.color) || '#3B456B') + '">' + esc(String(stitle).slice(0,1)) + '</div>' +
          '<div class="sitemeta"><div class="n">' + esc(stitle) + (supd ? ' <span style="color:#FFD166;font-size:11px">· 快照有更新</span>' : '') + '</div><div class="u">' + esc(ssub) + '</div></div>' +
          '<button class="mini" data-act="watchsub-del" data-id="' + esc(sid2) + '" title="取消订阅">✕</button>' +
          (sm2 ? '<button class="siteopen" data-act="play" data-id="' + esc(sid2) + '">▶ 播放</button>' : '') + '</div>';
      }
      html += '</div>';
    }
    var favs = byIds(getFav());
    html += '<div class="section-head"><h2>我的收藏</h2><span>' + favs.length + ' 部　<button class="qbtn" data-act="fav-backup">📥 导出备份</button><button class="qbtn" data-act="fav-restore">📤 导入备份</button>' + (favs.length ? '<button class="qbtn" data-act="fav-clear">🗑 清空</button>' : '') + '</span></div>';
    if(state.favConfirmClear){
      html += '<div class="confirmbar">确定清空全部 ' + favs.length + ' 个收藏？此操作不可撤销。' +
        '<button class="btn-primary" data-act="fav-clear-yes">确定清空</button>' +
        '<button class="btn-ghost" data-act="fav-clear-no">再想想</button></div>';
    }
    html += cardsHtml(favs, true);
  } else if(state.view === 'history'){
    var hist = byIds(getHistory());
    var _histRaw = getHistory();
    var _histHint = _histRaw.length >= KH_HIST_CAP ? '　已达 ' + KH_HIST_CAP + ' 条上限，最早记录将被新记录自动替换' : '';
    html += '<div class="section-head"><h2>观看历史</h2><span>自动记录最近播放的 ' + hist.length + ' 部' + _histHint + (hist.length ? '　<button class="qbtn" data-act="hist-clear">🗑 清空</button>' : '') + '</span></div>';
    if(state.histConfirmClear){
      html += '<div class="confirmbar">确定清空全部 ' + hist.length + ' 条观看历史？续播进度将保留，此操作不可撤销。' +
        '<button class="btn-primary" data-act="hist-clear-yes">确定清空</button>' +
        '<button class="btn-ghost" data-act="hist-clear-no">再想想</button></div>';
    }
    html += cardsHtml(hist, true);
  } else if(state.view === 'live'){
    html += renderLiveView();
            } else if(state.view === 'custom'){
    html += '<div class="section-head"><h2>网址播放</h2><span>粘贴视频直链或影视网站，直接加载</span></div>' +
      '<div class="urlcard"><h3>播放任意视频网址 / 打开任意影视网站</h3>' +
      '<p>① 视频直链：粘贴 <b>mp4 / webm / m3u8</b> 直链，点「▶ 播放视频」直接在应用内播放（直播 m3u8 也能播）。<br>② 影视网站：粘贴任意站点网址，点「🌐 打开网站」在应用内直接加载观看（取决于该站 H5 兼容性）。<br>你也可在「直播」页添加自己的 m3u8 频道、在「网站」页保存常用站点，全部本地保存、直接可用。</p>' +
      '<div class="urlrow">' +
        '<input id="urlInput" type="text" placeholder="https://example.com/movie.mp4 或 https://某影视网站/" autocomplete="off" aria-label="视频或网站网址">' +
        '<button class="btn-primary" data-act="url-play">▶ 播放视频</button>' +
        '<button class="btn-ghost" data-act="url-open-site">🌐 打开网站</button>' +
      '</div>' +
      '<div class="keytip">播放器快捷键：<kbd>空格</kbd>/<kbd>K</kbd>播放暂停　<kbd>←</kbd>/<kbd>J</kbd>快退 10 秒　<kbd>→</kbd>/<kbd>L</kbd>快进 10 秒　<kbd>↑</kbd><kbd>↓</kbd>直播切台 / 点播音量　<kbd>M</kbd>静音　<kbd>F</kbd>全屏　<kbd>0</kbd>-<kbd>9</kbd>跳转进度　<kbd>Esc</kbd>关闭　列表页 <kbd>/</kbd> 聚焦搜索</div>' +
      '</div>';

  } else if(state.view === 'sites'){
    var custom = getSites();
    /* 进入网站页自动探测自建站点可达性（结果缓存 10 分钟），打不开的标灰 */
    try { probeCustomSites(false); } catch(e) {}
    /* 进入网站页自动巡检平台入口（结果缓存 5 分钟），完成后回到本页才刷新 */
    probePlatforms(false);
    var rmc = getRemoteCfg();
    /* 平台影视资源 · 分类同步：站内内置 + 自建资源按分类与各大平台官方入口联动 */
    var pkw = platformKw(state.platCat);
    var catMovies = allMovies().filter(function(mm){ return mm.category === state.platCat; });
    html += '<div class="section-head"><h2>平台影视资源 · 分类同步</h2><span>' + BUILTIN_SITES.length + ' 个平台 × ' + PLATFORM_CATS.length + ' 类 · 站内 ' + allMovies().length + ' 部已同步</span></div>' +
      '<div class="sitebox"><h3>按分类同步更新各大网站平台的影视资源</h3>' +
      '<p>入口为各平台官方检索 / 频道页，已按电影 / 动画 / 短剧 / 剧集 / 纪录片 / 综艺同步更新并逐条实测可达（' + platformSearchCount() + '/' + BUILTIN_SITES.length + ' 个平台提供实测分类直达，共 ' + (platformSearchCount()*PLATFORM_CATS.length) + ' 个分类入口）。点「打开」直达该平台对应分类的最新影视资源，⧉ 可复制链接，站内同分类资源可在下方直接播放。平台正片受版权、登录与会员限制，应用仅提供官方入口导航，不聚合、不缓存、不破解任何第三方片源。</p>' +
      '<div class="chips">';
    for(var pc=0;pc<PLATFORM_CATS.length;pc++){
      html += '<button class="chip ' + (PLATFORM_CATS[pc].cat === state.platCat ? 'on' : '') + '" data-act="plat-cat" data-cat="' + esc(PLATFORM_CATS[pc].cat) + '">' + esc(PLATFORM_CATS[pc].cat) + '</button>';
    }
    html += '</div>' +
      '<div class="sitetools"><button class="qbtn" data-act="plat-probe">⟳ 实时巡检平台入口</button>' +
      '<button class="qbtn" data-act="plat-sort" data-sort="' + (state.platSort === 'rate' ? 'default' : 'rate') + '">' +
      (state.platSort === 'rate' ? '↩ 恢复默认排序' : '📊 按 7 天可播率排序') + '</button>' +
      '<span class="syncstat">' + platHealthSummary() + '</span></div></div>';
    html += '<div class="section-head"><h2>站内「' + esc(state.platCat) + '」资源</h2><span>' + catMovies.length + ' 部 · 含自建资源，点击即播</span></div>';
    if(catMovies.length){
      html += '<div class="sitelist">';
      for(var cm=0;cm<catMovies.length;cm++){
        var cmm = catMovies[cm];
        html += '<div class="siteitem"><div class="siteico" style="background:' + esc(cmm.color || '#3B456B') + '">' + esc(String(cmm.title).slice(0,1)) + '</div>' +
          '<div class="sitemeta"><div class="n">' + esc(cmm.title) + '</div><div class="u">' + esc(cmm.subtitle || '公开资源') + '</div></div>' +
          '<button class="siteopen" data-act="play" data-id="' + esc(cmm.id) + '">▶ 播放</button></div>';
      }
      html += '</div>';
    } else {
      html += '<div class="empty"><span class="ico">🎬</span>该分类暂无站内资源，可在「资源」页添加</div>';
    }
    var _filter = state.platFilter || 'all';
    var _plats = BUILTIN_SITES.filter(function(x){
      if(_filter === 'direct') return platDirect(x);
      if(_filter === 'limited') return !platDirect(x);
      return true;
    });
    _plats = platSorted(_plats);
    html += '<div class="section-head"><h2>各大平台「' + esc(state.platCat) + '」资源入口</h2><span>' +
      _plats.length + '/' + BUILTIN_SITES.length + ' 个平台 · 检索词「' + esc(pkw) + '」</span></div>' +
      '<div class="chips">' +
      '<button class="chip ' + (_filter === 'all' ? 'on' : '') + '" data-act="plat-filter" data-f="all">全部</button>' +
      '<button class="chip ' + (_filter === 'direct' ? 'on' : '') + '" data-act="plat-filter" data-f="direct">✓ 可直接打开</button>' +
      '<button class="chip ' + (_filter === 'limited' ? 'on' : '') + '" data-act="plat-filter" data-f="limited">⚠ 需浏览器 / 海外</button>' +
      '</div>' +
      '<p class="platnote">按 2026-11-14 双 UA 实测结果排序：<b>H5 可看</b> 走移动网页版（原生页自动设移动 UA），' +
      '<b>网页版</b> 走官方桌面页；桌面 UA 被 403 / 436 拦截的 1905、猫眼、YY 已改走移动 H5，' +
      '淘票票 8 跳重定向循环已换新落地域名。加载不出来的页面，可在网页页顶部一键切换「手机版 / 电脑版」，或用系统浏览器打开。</p>' +
      '<div class="sitelist">';
    for(var pi=0;pi<_plats.length;pi++){
      var ps = _plats[pi];
      var purl = platformUrl(ps.name, pkw);
      var pmode = platSearchMode(ps.name, purl);
      html += '<div class="siteitem" title="' + esc(purl) + '"><div class="siteico" style="background:' + esc(ps.color) + '">' + esc(ps.tag) + '</div>' +
        '<div class="sitemeta"><div class="n">' + platHealthDot(ps.name) + esc(ps.name) +
        (SEARCH_TPL[ps.name] ? '<span class="builtin">分类直达</span>' : '<span class="builtin">官方首页</span>') + platBadge(ps) +
        (state.platSort === 'rate' ? khPlatRateLabel(ps.name) : '') + '</div>' +
        '<div class="u">' + esc(platformSub(ps.name, purl, pkw)) + '</div></div>' +
        '<button class="mini" data-act="plat-copy" data-url="' + esc(purl) + '" title="复制链接">⧉</button>' +
        '<button class="siteopen" data-act="site-open" data-mode="' + pmode + '" data-url="' + esc(purl) + '">打开</button></div>';
    }
    html += '</div>';
    /* 设备适配 · 版本状态：真机指纹、开鸿系统兼容与自动更新状态 */
    html += '<div class="section-head"><h2>设备适配 · 版本状态</h2><span>自动识别机型 · 针对性优化</span></div>' +
      '<div class="sitebox"><h3>当前设备与开鸿系统兼容性</h3>' + khDeviceCardHtml() + '</div>';
    /* 影视仓 · 多仓管理：用户自己填仓地址，拉取 sites 清单并在下方列出 */
    var _whList = getWhList(), _whOn = 0;
    for (var _wi = 0; _wi < _whList.length; _wi++) if (_whList[_wi].enabled) _whOn++;
    html += '<div class="section-head"><h2>影视仓 · 多仓管理</h2><span>启用 ' + _whOn + ' / ' + _whList.length + ' 个仓 · 共 ' + whTotalSites() + ' 个站点</span></div>' +
      '<div class="sitebox"><h3>添加影视仓</h3>' +
      '<p>影视仓就是你自己持有的那份配置地址：填进去，应用拉取其中的站点清单并在下方按仓列出。<strong>兼容 TVBox / CatVod 标准格式 sites[{key,name,api,type}]、本应用简化格式 sites[{name,url}]，以及 base64 编码的整份配置</strong>。拉取失败或格式不对只报在对应仓上，不影响其它仓。各仓的站点单独存放，不占用「我的网站」50 条自建额度；删除仓会连同它导入的站点一起清掉。应用不内置任何仓地址、不代抓第三方片源，站点能否播放取决于该站自身。</p>' +
      '<div class="siteform">' +
        '<input id="whName" class="n" type="text" placeholder="仓名称，如：影视仓A" maxlength="12" autocomplete="off">' +
        '<input id="whUrl" class="u" type="text" placeholder="https://example.com/config.json" autocomplete="off">' +
        '<button class="btn-primary" data-act="wh-add">＋ 添加仓</button>' +
      '</div>' +
      '<div class="sitetools">' +
        '<button class="qbtn" data-act="wh-refresh-all">⟳ 刷新全部启用仓</button>' +
        '<button class="qbtn" data-act="wh-probe">🩺 探测上面的地址</button>' +
        '<span class="syncstat">最多存 ' + (typeof WH_MAX !== 'undefined' ? WH_MAX : 30) + ' 个仓 · 同时启用 ' + (typeof WH_MAX_ON !== 'undefined' ? WH_MAX_ON : 12) + ' 个 · 启用中的仓每 30 分钟自动刷新</span>' +
      '</div>';
    if (_whList.length) {
      html += '<div class="sitelist" style="margin-top:10px">';
      for (var _wj = 0; _wj < _whList.length; _wj++) {
        var _w = _whList[_wj], _wnum = whSiteCount(_w.id);
        var _kindTag = _w.kind === 'multi' ? '多仓索引'
          : _w.kind === 'jar' ? 'jar 爬虫仓（不支持）'
          : _w.kind === 'lives' ? '直播仓' : '';
        html += '<div class="whrow" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.10);border-radius:10px;margin-bottom:8px">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-weight:700;font-size:14px">' + esc(_w.name) +
              ' <span style="font-size:11px;font-weight:400;color:' + (_w.enabled ? '#5BD28A' : '#8b94a7') + '">' + (_w.enabled ? '● 启用中' : '○ 已停用') + '</span>' +
              (_kindTag ? ' <span style="font-size:11px;font-weight:400;color:' + (_w.kind === 'jar' ? '#FF7A7A' : '#7FB6FF') + '">' + esc(_kindTag) + '</span>' : '') +
            '</div>' +
            '<div style="font-size:12px;color:#9aa6bd;word-break:break-all;line-height:1.5">' +
              esc(_w.url ? hostOf(_w.url) : '未设地址（仅粘贴导入）') + ' · ' + _wnum + ' 个站点' +
              (_w.subs ? ' · 子仓 ' + _w.subs : '') + (_w.lives ? ' · 直播 ' + _w.lives : '') + ' · ' +
              (_w.err ? '<span style="color:#FF7A7A">' + esc(_w.err) + '</span>'
                     : (_w.lastOk ? '最近 ' + esc(new Date(_w.lastOk).toLocaleString('zh-CN', { hour12: false })) : '尚未拉取')) +
            '</div>' +
          '</div>' +
          (_w.url ? '<button class="mini" data-act="wh-refresh" data-id="' + esc(_w.id) + '" title="立即刷新" aria-label="立即刷新「' + esc(_w.name) + '」">⟳</button>' : '') +
          '<button class="mini" data-act="wh-toggle" data-id="' + esc(_w.id) + '" aria-label="' + (_w.enabled ? '停用' : '启用') + '「' + esc(_w.name) + '」">' + (_w.enabled ? '停用' : '启用') + '</button>' +
          '<button class="mini" data-act="wh-del" data-id="' + esc(_w.id) + '" title="删除仓，并清掉它导入的站点" aria-label="删除「' + esc(_w.name) + '」及其站点">✕</button>' +
        '</div>';
      }
      html += '</div>';
      var _lives = 0;
      try {
        var _lm = getStore('kh_wh_lives', null);
        if (_lm && typeof _lm === 'object') for (var _lk in _lm) if (Object.prototype.hasOwnProperty.call(_lm, _lk)) _lives += (_lm[_lk] || []).length;
      } catch (e) {}
      html += '<div class="sitetools" style="margin-top:6px"><span class="syncstat">仓自带直播源共 ' + _lives + ' 条' +
        (_lives ? '（在直播页「仓直播」分组里可直接播）' : '') + '</span></div>';
    } else {
      html += '<div class="empty"><span class="ico">📦</span>还没有影视仓，在上面填个地址试试，或直接把仓内容粘贴导入</div>';
    }
    html += '<div class="pastebox" style="margin-top:12px;border-top:1px dashed rgba(255,255,255,.18);padding-top:10px">' +
      '<p style="margin:0 0 6px;font-size:13px;line-height:1.5">或<strong>从本机配置文件一键导入</strong>（选 .json / .txt，自动识别 GBK/UTF-8；桌面版可用）：</p>' +
      '<div class="sitetools" style="margin-bottom:8px">' +
        '<button class="qbtn" data-act="wh-pick-file">📂 选择本机配置文件</button>' +
      '</div>' +
      '<p style="margin:8px 0 6px;font-size:13px;line-height:1.5">或<strong>粘贴仓配置内容直接导入</strong>（免跨域，立即可用；支持明文 JSON 与 base64 串）：</p>' +
      '<textarea id="whPaste" style="width:100%;min-height:90px;box-sizing:border-box;background:#0f1422;color:#e7ecf5;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:8px 10px;font:13px/1.5 monospace" placeholder="在此粘贴仓内容，例如：{&quot;sites&quot;:[{&quot;key&quot;:&quot;demo&quot;,&quot;name&quot;:&quot;示例站&quot;,&quot;api&quot;:&quot;https://example.com/api.php/provide/vod/&quot;,&quot;type&quot;:1}]}" aria-label="仓配置内容"></textarea>' +
      '<div class="sitetools" style="margin-top:8px">' +
        '<select id="whPasteTarget" aria-label="导入目标仓">' +
          '<option value="">＋ 新建「粘贴导入」仓</option>' +
          (function () {
            var o = '';
            for (var _wm = 0; _wm < _whList.length; _wm++) o += '<option value="' + esc(_whList[_wm].id) + '">覆盖 ' + esc(_whList[_wm].name) + '</option>';
            return o;
          })() +
        '</select>' +
        '<button class="btn-ghost" data-act="wh-paste">📥 导入到影视仓</button>' +
      '</div>' +
      '</div>' +
      '</div>';
    /* 远程配置 · 实时同步：从一个 JSON 数据源自动更新网站 / 资源 / 频道 */
    html += '<div class="section-head"><h2>远程配置 · 实时同步</h2><span>' + (rmc.auto ? '自动同步中 · 每 10 分钟' : '手动同步') + '</span></div>' +
      '<div class="sitebox"><h3>从一个 JSON 数据源实时同步影视资源</h3>' +
      '<p>填入你自己的配置接口地址，点「立即同步」即可拉取最新的<strong>网站</strong>、<strong>影视资源</strong>（mp4 / m3u8 直链片源）与<strong>直播频道</strong>清单，自动合并进本地（幂等，重复同步不会产生重复条目）；开启自动同步后每 10 分钟静默刷新，远程一更新、应用内即时生效。接口需允许跨域（CORS），或直接在下方<strong>粘贴第三方 JSON 免跨域导入</strong>。支持字段：sites[{name,url}]、resources[{title,subtitle,category,urls[]}]、channels[{name,url,group}]。</p>' +
      '<div class="siteform">' +
        '<input id="remoteUrl" class="u" type="text" placeholder="https://example.com/config.json" autocomplete="off" value="' + esc(rmc.url) + '">' +
        '<button class="btn-primary" data-act="remote-sync">⟳ 立即同步</button>' +
      '</div>' +
      '<div class="sitetools">' +
        '<button class="qbtn" data-act="remote-auto">' + (rmc.auto ? '◉ 已开启自动同步' : '○ 开启自动同步（每 10 分钟）') + '</button>' +
        remoteStatusLine(rmc) +
      '</div>' +
      '<div class="pastebox" style="margin-top:12px;border-top:1px dashed rgba(255,255,255,.18);padding-top:10px">' +
        '<p style="margin:0 0 6px;font-size:13px;line-height:1.5">或<strong>粘贴第三方配置 JSON 直接导入</strong>（免跨域，立即可用）：</p>' +
        '<textarea id="remotePaste" style="width:100%;min-height:80px;box-sizing:border-box;background:#0f1422;color:#e7ecf5;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:8px 10px;font:13px/1.5 monospace" placeholder="在此粘贴：{&quot;sites&quot;:[{&quot;name&quot;:&quot;示例站点&quot;,&quot;url&quot;:&quot;https://example.com&quot;}]}"></textarea>' +
        '<button class="btn-ghost" data-act="remote-paste" style="margin-top:8px">📥 粘贴导入第三方源</button>' +
      '</div>' +
      '</div>';
    html += '<div class="section-head"><h2>我的网站</h2><span>预置 ' + BUILTIN_SITES.length + ' 个 · 自建 ' + custom.length + ' / 50</span></div>' +
      '<div class="sitebox"><h3>' + (state.editIndex >= 0 ? '编辑网站' : '添加自己的网站') + '</h3>' +
      '<p>填入名称和网址即可保存，点「打开」就在应用内浏览。HAP 内由原生 ArkWeb 页面承载（第三方站点普遍禁止 iframe 嵌入，因此不走 iframe）；普通浏览器预览时降级为新窗口打开。网站能否播放正片，取决于该站自身的 H5 兼容性、登录与版权限制。</p>' +
      '<div class="siteform">' +
        '<input id="siteName" class="n" type="text" placeholder="网站名称，如：我的影院" autocomplete="off" maxlength="20">' +
        '<input id="siteUrl" class="u" type="text" placeholder="https://example.com" autocomplete="off">' +
        '<input id="siteGroup" class="n" type="text" placeholder="分组（可选），如：影视 / 工具" autocomplete="off" maxlength="10">' +
        '<button class="btn-primary" data-act="site-add">' + (state.editIndex >= 0 ? '✓ 保存' : '＋ 添加') + '</button>' +
        (state.editIndex >= 0 ? '<button class="btn-ghost" data-act="site-cancel">取消</button>' : '') +
      '</div>' +
      '<div class="sitetools">' +
        '<button class="qbtn" data-act="site-fill">填入示例</button>' +
        '<button class="qbtn" data-act="site-export">导出备份</button>' +
        '<button class="qbtn" data-act="site-import">导入备份</button>' +
        '<button class="qbtn" data-act="site-clear">清空自建</button>' +
      '</div>' +
      '<div class="backupbox"><textarea id="siteBackup" placeholder="备份数据会显示在这里；也可粘贴网站列表 JSON 后点「导入备份」" aria-label="网站备份数据"></textarea></div>' +
      '<div class="pastebox" style="margin-top:12px;border-top:1px dashed rgba(255,255,255,.18);padding-top:10px">' +
        '<p style="margin:0 0 6px;font-size:13px;line-height:1.5"><strong>批量导入网址</strong>（每行一条，自动用域名当名称；重复或格式不对的会跳过）：</p>' +
        '<textarea id="siteBatch" style="width:100%;min-height:90px;box-sizing:border-box;background:#0f1422;color:#e7ecf5;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:8px 10px;font:13px/1.5 monospace" placeholder="https://www.example.com&#10;https://another.example.org" aria-label="批量导入网址"></textarea>' +
        '<button class="btn-primary" data-act="site-batch" style="margin-top:8px">📥 批量导入</button>' +
        '<button class="btn-ghost" data-act="site-probe" style="margin-top:8px">⟳ 探测自建站点是否可打开</button>' +
      '</div>' +
      (state.confirmClear ? '<div class="confirmbar">确定清空全部 ' + custom.length + ' 个自建网站？此操作不可撤销。' +
        '<button class="btn-primary" data-act="site-clear-yes">确定清空</button>' +
        '<button class="btn-ghost" data-act="site-clear-no">再想想</button></div>' : '') +
      '</div>';
        var _showAll = state.platFilter === 'all';
    var _groupSites = platSorted(BUILTIN_SITES.filter(function(x){ return _showAll || platDirect(x); }));
    html += '<div class="section-head"><h2>第三方平台官网入口</h2><span>' +
      _groupSites.length + '/' + BUILTIN_SITES.length + ' 个站点 · 默认打开实测可用的移动 H5 / 网页版</span></div>';
    if(!_showAll){
      html += '<div class="sitetools"><button class="qbtn" data-act="plat-filter" data-f="all">显示全部（含海外 / 只读项目页）</button></div>';
    }
    var _cats = [];
    for(var _si=0;_si<_groupSites.length;_si++){ var _c = _groupSites[_si].cat || '其他'; if(_cats.indexOf(_c) < 0) _cats.push(_c); }
    for(var _ci=0;_ci<_cats.length;_ci++){
      html += '<div class="subhead" style="margin:14px 2px 6px;font-size:13px;letter-spacing:.5px;color:#9aa6bd;font-weight:700">' + esc(_cats[_ci]) + '</div><div class="sitelist">';
      for(var _si=0;_si<_groupSites.length;_si++){ if((_groupSites[_si].cat||'其他') === _cats[_ci]) html += siteItem(_groupSites[_si], -1, true); }
      html += '</div>';
    }
    html += '<div class="section-head"><h2>我添加的</h2><span>' + custom.length + ' 个 · 可编辑 / 排序 / 删除</span></div>';
    if(custom.length){
      /* 分组筛选：按自建站点 group 字段生成 chips，点选只看该组 */
      var _grp = state.siteGrp || '全部';
      var _grps = [];
      for(var gi=0;gi<custom.length;gi++){ var gv = custom[gi].group || '未分组'; if(_grps.indexOf(gv) < 0) _grps.push(gv); }
      if(_grps.length > 1){
        html += '<div class="chips"><button class="chip ' + (_grp === '全部' ? 'on' : '') + '" data-act="site-group-filter" data-g="全部">全部</button>';
        for(var gi2=0;gi2<_grps.length;gi2++){
          html += '<button class="chip ' + (_grp === _grps[gi2] ? 'on' : '') + '" data-act="site-group-filter" data-g="' + esc(_grps[gi2]) + '">' + esc(_grps[gi2]) + '</button>';
        }
        html += '</div>';
      }
      html += '<div class="sitelist">';
      for(var ci=0;ci<custom.length;ci++){
        if(_grp !== '全部' && (custom[ci].group || '未分组') !== _grp) continue;
        html += siteItem(custom[ci], ci, false);
      }
      html += '</div>';
    } else {
      html += '<div class="empty"><span class="ico">🌐</span>还没有添加网站，在上面填个名称和网址试试</div>';
    }
    /* 影视仓站点：启用仓收录的站点，按仓分组列出（只提供打开 / 复制，
       不带编辑与删除按钮——仓站点归仓管，删仓即整体清掉，避免误删自建站点） */
    var _whSites = whAllSites();
    if(_whSites.length){
      html += '<div class="section-head"><h2>影视仓站点</h2><span>' + _whSites.length + ' 个 · 来自 ' + _whOn + ' 个启用中的仓</span></div>';
      var _whNames = [];
      for(var _wq = 0; _wq < _whSites.length; _wq++){
        var _nm = _whSites[_wq].whName || '影视仓';
        if(_whNames.indexOf(_nm) < 0) _whNames.push(_nm);
      }
      for(var _wc = 0; _wc < _whNames.length; _wc++){
        var _one = _whNames[_wc], _sub = [];
        for(var _wr = 0; _wr < _whSites.length; _wr++) if((_whSites[_wr].whName || '影视仓') === _one) _sub.push(_whSites[_wr]);
        html += '<div class="subhead" style="margin:14px 2px 6px;font-size:13px;letter-spacing:.5px;color:#9aa6bd;font-weight:700">' + esc(_one) + ' · ' + _sub.length + ' 个站点</div>' +
          '<div class="sitetools" style="margin:0 0 6px">' +
            '<input id="whSiteKw" class="u" type="text" placeholder="在这个仓里搜站点名 / 分组" aria-label="仓内搜索站点" oninput="khWhSiteFilter(this.value)">' +
            (_sub.length > 40 ? '<button class="qbtn" data-act="wh-show-all">显示全部 ' + _sub.length + ' 个</button>' : '') +
          '</div><div class="sitelist">';
        var _cap = Math.min(_sub.length, 40);
        for(var _wz = 0; _wz < _sub.length; _wz++){
          var _ws = _sub[_wz];
          var _jar = _ws.jar ? '<span class="builtin" style="color:#FF7A7A">jar（不支持）</span>' : '';
          html += '<div class="siteitem" data-name="' + esc(String(_ws.name + ' ' + (_ws.cat || '') + ' ' + (_ws.whName || '')).toLowerCase()) + '"' +
            (_wz >= _cap ? ' style="display:none" data-rest="1"' : '') + '>' +
            '<div class="siteico" style="background:' + esc(_ws.color || '#3B456B') + '">' + esc((_ws.tag || _ws.name || 'W').slice(0,1)) + '</div>' +
            '<div class="sitemeta"><div class="n">' + esc(_ws.name) + '<span class="builtin">' + esc(_ws.cat || '影视仓') + '</span>' + _jar + '</div>' +
            '<div class="u">' + esc(_ws.url) + '</div></div>' +
            '<button class="mini" data-act="plat-copy" data-url="' + esc(_ws.url) + '" title="复制网址" aria-label="复制「' + esc(_ws.name) + '」的网址">⧉</button>' +
            '<button class="siteopen" data-act="site-open" data-mode="pc" data-url="' + esc(_ws.url) + '" aria-label="打开「' + esc(_ws.name) + '」">打开</button>' +
          '</div>';
        }
        html += '</div>';
        if(_sub.length > _cap) html += '<p class="platnote">默认先显示前 ' + _cap + ' 个，点「显示全部」可展开；用上面的框能直接搜到后面的站点。</p>';
      }
    }
    /* 跨仓搜片（parses 适配层）：只打带 api 的接口站；官网入口类没有 api，不参与 */
    var _apiCnt = 0;
    if(typeof KH_SRC !== 'undefined'){
      for(var _wa = 0; _wa < _whSites.length; _wa++) if(KH_SRC.isApiSite(_whSites[_wa])) _apiCnt++;
    }
    html += '<div class="section-head"><h2>跨仓搜片</h2><span>可用接口站 ' + _apiCnt + ' 个</span></div>' +
      '<div class="sitebox"><h3>跨仓搜片</h3>' +
      '<p>向启用仓里带 <strong>api</strong> 的站点同时搜索片名，结果按站点汇总；点「线路」拉取该片可直接播放的地址。' +
      '<strong>官网入口类站点没有 api，不参与搜索</strong>。搜索结果与播放地址都来自第三方站点，能否播放取决于站点自身。</p>' +
      (_apiCnt ? '' : '<p class="platnote">当前启用仓里没有带 api 的接口站。导入仓时请填站点配置接口地址（通常形如 .../api.php/provide/vod/），而不是站点首页网址。</p>') +
      '<div class="siteform">' +
        '<input id="whSrcKw" class="n" type="search" placeholder="片名，如：庆余年" maxlength="30" autocomplete="off" aria-label="搜片关键词">' +
        '<button class="btn-ghost" data-act="wh-src-go"' + (_apiCnt ? '' : ' disabled') + '>🔍 跨仓搜片</button>' +
      '</div>' +
      '<div id="whSrcOut" style="margin-top:12px"></div></div>';
  } else if(state.view === 'resources'){
    var own = getRes();
    html += '<div class="section-head"><h2>影视资源配置</h2><span>内置 ' + MOVIES.length + ' 部 · 自建 ' + own.length + ' / 50</span></div>' +
      '<div class="sitebox"><h3>' + (state.resEdit >= 0 ? '编辑影视资源' : '添加影视资源') + '</h3>' +
      '<p>按电影 / 动画 / 短剧等分类配置自有片源，填 1~3 路视频直链（mp4 / m3u8），保存后立即出现在首页、分类、搜索与收藏。' +
      '应用不内置任何本地视频文件；内置资源为公开片段 / 预告 / 样本，商用请替换为自有授权媒资。</p>' +
      '<div class="siteform">' +
        '<input id="resTitle" class="n" type="text" placeholder="片名" maxlength="24" aria-label="片名">' +
        '<input id="resSub" class="u" type="text" placeholder="副标题 / 简介（可选）" maxlength="40" aria-label="副标题">' +
        '<select id="resCat" aria-label="分类">';
    for(var ci=0;ci<RES_CATEGORIES.length;ci++){
      html += '<option value="' + RES_CATEGORIES[ci] + '">' + RES_CATEGORIES[ci] + '</option>';
    }
    html += '</select>' +
        '<input id="resUrl1" class="w" type="text" placeholder="主源直链 https://example.com/movie.mp4（必填）" aria-label="主源直链">' +
        '<input id="resUrl2" class="w" type="text" placeholder="备源直链（可选）" aria-label="备源直链">' +
        '<input id="resUrl3" class="w" type="text" placeholder="备用线路（可选）" aria-label="备用线路">' +
        '<button class="btn-primary" data-act="res-add">' + (state.resEdit >= 0 ? '✓ 保存' : '＋ 添加') + '</button>' +
        (state.resEdit >= 0 ? '<button class="btn-ghost" data-act="res-cancel">取消</button>' : '') +
      '</div>' +
      '<div class="sitetools">' +
        '<button class="qbtn" data-act="res-fill">填入示例</button>' +
        '<button class="qbtn" data-act="res-export">导出备份</button>' +
        '<button class="qbtn" data-act="res-import">导入备份</button>' +
        '<button class="qbtn" data-act="res-clear">清空自建</button>' +
        '<button class="qbtn" data-act="res-probe">⟳ 巡检片源（本机连通性）</button>' +
      '</div>' +
      '<div class="backupbox"><textarea id="resBackup" placeholder="备份 JSON 会显示在这里；也可粘贴后点「导入备份」" aria-label="资源备份"></textarea></div>' +
      (state.resConfirmClear ? '<div class="confirmbar">确定清空全部 ' + own.length + ' 个自建资源？此操作不可撤销。' +
        '<button class="btn-primary" data-act="res-clear-yes">确定清空</button>' +
        '<button class="btn-ghost" data-act="res-clear-no">再想想</button></div>' : '') +
      '</div>';
    html += '<div class="section-head"><h2>内置资源分布</h2><span>共 ' + MOVIES.length + ' 部 · 每部 1~3 路公开网络源（实测可达）</span></div><div class="sitelist">';
    for(var gc=0;gc<RES_CATEGORIES.length;gc++){
      var catName = RES_CATEGORIES[gc];
      var cnt = MOVIES.filter(function(mm){ return mm.category === catName; }).length;
      html += '<div class="siteitem"><div class="siteico" style="background:#3B456B">' + esc(catName.slice(0,1)) + '</div>' +
        '<div class="sitemeta"><div class="n">' + esc(catName) + '</div><div class="u">' + cnt + ' 部 · ' + (cnt*3) + ' 路源</div></div></div>';
    }
    html += '</div>';
    html += '<div class="section-head"><h2>我配置的资源</h2><span>' + own.length + ' 个 · 可播放 / 同步 / 编辑 / 排序 / 删除</span></div>';
    if(own.length){
      html += '<div class="sitelist">';
      for(var ri=0;ri<own.length;ri++) html += resItem(own[ri], ri);
      html += '</div>';
    } else {
      html += '<div class="empty"><span class="ico">🎬</span>还没有自建资源，在上面填片名和直链即可添加</div>';
    }
    /* 片名同步：把站内影视资源（含自建）一键映射到各大平台官方检索 */
    html += '<div class="section-head"><h2>把影视资源同步到各大平台</h2><span>输入片名，一键检索各平台同款资源</span></div>' +
      '<div class="sitebox"><h3>片名同步检索</h3>' +
      '<p>填入片名（内置或自建资源均可），回车或点按钮即生成 ' + BUILTIN_SITES.length + ' 个平台的官方检索入口（⧉ 可复制链接），点开即查该片在各平台的最新影视资源；也可在下方资源列表点 ⇄ 一键填入片名。仅跳转官方页面，不抓取或缓存第三方内容。</p>' +
      '<div class="siteform">' +
        '<input id="syncTitle" class="u" type="text" placeholder="输入片名，如：Sintel 辛特尔" value="' + esc(state.syncTitle) + '" maxlength="40" aria-label="同步片名">' +
        '<button class="btn-primary" data-act="sync-go">同步到平台</button>' +
      '</div>';
    if(state.syncTitle){
      html += '<div class="sitetools"><span style="font-size:11px;color:var(--muted)">「' + esc(state.syncTitle) + '」在各大平台的影视资源入口：</span></div><div class="sitelist">';
      for(var sy=0;sy<BUILTIN_SITES.length;sy++){
        var ss = BUILTIN_SITES[sy];
        var surl = platformUrl(ss.name, state.syncTitle);
        html += '<div class="siteitem" title="' + esc(surl) + '"><div class="siteico" style="background:' + esc(ss.color) + '">' + esc(ss.tag) + '</div>' +
          '<div class="sitemeta"><div class="n">' + esc(ss.name) + '</div><div class="u">' + esc(platformSub(ss.name, surl, state.syncTitle)) + '</div></div>' +
          '<button class="mini" data-act="plat-copy" data-url="' + esc(surl) + '" title="复制链接">⧉</button>' +
          '<button class="siteopen" data-act="site-open" data-mode="' + platSearchMode(ss.name, surl) + '" data-url="' + esc(surl) + '">打开</button></div>';
      }
      html += '</div>';
    }
    html += '</div>';
  html += '<div class="tip">影视资源配置：内置 ' + MOVIES.length + ' 部公开资源按电影 / 动画 / 短剧 / 剧集 / 纪录片 / 综艺分类，' +
          '每部 1~3 路实测可播网络源；在「资源」页可自行添加、编辑与备份自有片源，并把片名同步检索到 ' + BUILTIN_SITES.length + ' 个平台。' +
          '「网站」页已按同一套分类同步更新各大平台的官方影视资源入口。应用不内置任何本地视频文件，' +
          '公开片段 / 预告 / 样本非完整院线正片，商用请替换为自有授权媒资。</div>';
  } else if(state.view === 'settings'){
    var _sv = window.KH_SERVICE || {}, _rel = (_sv.release && _sv.release.versionName) || '';
    var _iss = window.KH_ISSUES && window.KH_ISSUES.summary;
    html += '<div class="section-head"><h2>设置 · 本机中枢</h2><span>版本 / 更新 / 口令 / 缓存 / 诊断</span></div>' +
      '<div class="sitebox"><h3>场景预设 · 一键切换</h3>' +
      '<p>四档常用组合一键生效：只写该档列出的项，其它设置不动。手动改过其中某项后，卡片会显示「已微调」，再点同档会重新对齐。</p>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:4px">' +
        (function () {
          var cur = getScene(), out = '';
          for (var _si = 0; _si < SCENES.length; _si++) {
            var _s = SCENES[_si], _on = cur.id === _s.id;
            var _tuned = _on ? sceneTuned(_s.id).length : 0;
            out += '<div data-act="scene-apply" data-id="' + _s.id + '" role="button" tabindex="0" aria-pressed="' + (_on ? 'true' : 'false') + '" ' +
              'aria-label="应用「' + esc(_s.name) + '」场景：' + esc(_s.hint) + '" style="cursor:pointer;border:1px solid ' +
              (_on ? 'rgba(255,95,109,.65)' : 'rgba(255,255,255,.10)') + ';background:' +
              (_on ? 'linear-gradient(180deg,rgba(255,95,109,.14),rgba(255,154,102,.06))' : '#101728') +
              ';border-radius:12px;padding:12px 10px;text-align:center">' +
              '<div style="font-size:22px;line-height:1.2">' + _s.icon + '</div>' +
              '<div style="font-weight:700;font-size:14px;margin-top:4px">' + esc(_s.name) +
                (_on ? ' <span style="font-size:10px;color:#ffb0a6">当前</span>' : '') + '</div>' +
              '<div style="font-size:11px;color:#96a1b8;margin-top:2px;line-height:1.4">' + esc(_s.hint) + '</div>' +
              (_on && _tuned ? '<div style="font-size:11px;color:#ffd98a;margin-top:4px">已微调 ' + _tuned + ' 项</div>' : '') +
            '</div>';
          }
          return out;
        })() +
      '</div>' +
      '<div class="sitetools" style="margin-top:10px"><button class="qbtn" data-act="scene-reset">↺ 重新应用当前档</button>' +
      '<span class="syncstat">' + (getScene().id ? '当前档位：' + esc((sceneById(getScene().id) || {}).name || '') : '尚未选择档位（下方各设置项独立生效）') + '</span></div></div>' +
      '<div class="sitebox"><h3>版本与服务状态</h3>' +
      '<p>客户端版本号 <b>#' + esc(String(KH_APP_CODE)) + '</b> · 服务构建 <b>' + esc(_sv.buildId || '读取中…') + '</b>' +
      (_rel ? ' · 下发版本 v' + esc(_rel) : '') + '</p>' +
      '<p class="platnote">频道 ' + ((window.LIVE_CHANNELS || []).length) + ' 个 · 平台 ' + (BUILTIN_SITES || []).length +
      ' 个 · 源清单 v' + esc(String(_sv.sourcesV == null ? '?' : _sv.sourcesV)) +
      ' · 云端问题单 待处理 ' + (_iss ? _iss.open : '-') + ' / 跟踪 ' + (_iss ? _iss.tracking : '-') + '</p>' +
      '<div class="sitetools">' +
      '<button class="qbtn" id="khSetRefresh">⟳ 刷新状态</button>' +
      '<button class="qbtn" id="khSetCheck">🔄 检查更新</button>' +
      '<button class="qbtn" id="khSetDiag">📋 复制诊断报告</button>' +
      '</div></div>' +
      '<div class="sitebox"><h3>本次会话截图</h3>' +
      '<p>截图记录只留在内存里（片名 / 播放点 / 截图时刻），不写磁盘、不进备份导出，重启应用即清空；图片本身在截图时就已保存到你选的下载目录。</p>' +
      '<div class="sitetools"><button class="qbtn" data-act="shot-log">🖼 查看记录（' + KH_SHOT_LOG.length + '）</button></div></div>' +
      '<div class="sitebox"><h3>局域网访问口令</h3>' +
      (KH_UI_CLEAN
        ? '<p>一般留空即可；只有中枢跑在另一台设备（局域网模式）时才需要填写地址与口令。口令只存在本机，不会外发。</p>'
        : '<p>只有开发端以局域网模式启动中枢（KH_HOST=0.0.0.0）时才需要填写；桌面本机模式留空即可。口令只存在本机，不会外发。</p>') +
      '<div class="siteform">' +
      '<input id="khSetToken" class="u" type="text" placeholder="留空＝本机模式" autocomplete="off" value="' + esc(khAccessToken()) + '">' +
      '<button class="btn-primary" id="khSetTokenSave">保存口令</button>' +
      '<button class="btn-ghost" id="khSetTokenClear">清除</button>' +
      '</div></div>' +
      '<div class="sitebox"><h3>中枢地址（多机部署）</h3>' +
      '<p>桌面本机模式留空即可。一台机器起中枢、其他机器看片时，填那台机器的地址（如 http://192.168.1.10:8890）；保存后需重启页面生效。</p>' +
      '<div class="siteform">' +
        '<input id="hubUrl" class="u" type="text" placeholder="http://192.168.1.10:8890" autocomplete="off" value="' + esc(getStore('kh_hub_url', '') || '') + '">' +
        '<button class="btn-primary" data-act="hub-save">保存</button>' +
        '<button class="btn-ghost" data-act="hub-test">测试连接</button>' +
      '</div></div>' +
    '<div class="sitebox"><h3>定时关闭</h3>' +
      '<p>从开始播放起计时，到点自动暂停，适合睡前看直播。</p>' +
      '<div class="siteform"><select id="khSleepSel" aria-label="定时关闭">' +
        [0, 30, 60, 90, 120].map(function(n){
          var cur = Number(getStore('kh_sleep_min', 0)) || 0;
          return '<option value="' + n + '"' + (cur === n ? ' selected' : '') + '>' + (n ? n + ' 分钟后自动停止' : '不自动停止') + '</option>';
        }).join('') +
      '</select><button class="btn-primary" data-act="sleep-save">保存</button></div></div>' +
    '<div class="sitebox"><h3>字号调节</h3>' +
      '<p>整体放大界面文字与控件，适合长辈或远距离观看；保存立即生效并记住。</p>' +
      '<div class="siteform"><select id="khFontSel" aria-label="字号">' +
        [100, 115, 130, 150].map(function(n){
          var cur = Number(getStore('kh_font_scale', 100)) || 100;
          return '<option value="' + n + '"' + (cur === n ? ' selected' : '') + '>' + (n === 100 ? '标准（100%）' : '放大 ' + n + '%') + '</option>';
        }).join('') +
      '</select><button class="btn-primary" data-act="font-save">保存</button></div></div>' +
    '<div class="sitebox"><h3>兼容播放模式</h3>' +
      '<p>弱机 / 老显卡 / 集显出现花屏、卡顿、解码崩溃时开启：关闭解码 Worker、从最低码率起步并收紧缓冲。<b>说明：</b>网页端无法强制切换系统硬解 / 软解后端；若仍崩溃，桌面端可在程序目录放 <code>soft-gpu.flag</code> 重启走软渲染。</p>' +
      '<div class="siteform"><select id="khCompatSel" aria-label="兼容播放模式">' +
        [0, 1].map(function(n){
          var cur = Number(getStore('kh_compat_mode', 0)) || 0;
          return '<option value="' + n + '"' + (cur === n ? ' selected' : '') + '>' + (n === 0 ? '标准播放（按设备自动）' : '兼容模式（弱机优先）') + '</option>';
        }).join('') +
      '</select><button class="btn-primary" data-act="compat-save">保存</button></div></div>' +
    '<div class="sitebox"><h3>响度均衡</h3>' +
      '<p>用压缩器自动拉平不同片源的音量，避免这部很响、那部很轻。跨源且无 CORS 的片源接入后会被浏览器静音，此时会自动回退为原音量并提示。</p>' +
      '<div class="siteform"><select id="khEqSel" aria-label="响度均衡">' +
        [0, 1].map(function(n){
          var cur = Number(getStore('kh_loudness_eq', 0)) || 0;
          return '<option value="' + n + '"' + (cur === n ? ' selected' : '') + '>' + (n === 0 ? '响度均衡：关' : '响度均衡：开') + '</option>';
        }).join('') +
      '</select><button class="btn-primary" data-act="eq-save">保存</button></div></div>' +
    (window.khCast
      ? '<div class="sitebox"><h3>投屏（DLNA）</h3>' +
        '<p>桌面版由本机主进程做 SSDP 组播发现，能列出同网段的电视 / 投屏盒子，并把当前片源经本机局域网转发成设备可直连地址后真实推送（AVTransport SetAVTransportURI + Play）。设备不接受 AVTransport 时会如实给出拒绝原因。</p>' +
        '<div class="siteform"><button class="btn-ghost" data-act="cast-discover">🔍 发现投屏设备</button>' +
        '<button class="btn-ghost" data-act="cast-probe">检测投屏能力</button></div></div>'
      : '') +
    '<div class="sitebox"><h3>版本与升级</h3>' +
      '<p>自动升级：发现新版后自动下载并校验（SHA256），随后启动安装向导——<b>安装仍需你在向导里确认</b>；同一版本失败不自动重试。回滚：从开发端归档取历史版本覆盖安装，同样先校验再进向导。</p>' +
      '<div class="siteform"><select id="khAutoUpd" aria-label="自动升级">' +
      '<option value="0">自动升级：关（手动点横幅）</option><option value="1">自动升级：开（下载+校验+进向导）</option></select>' +
      '<button class="btn-primary" data-act="autoupd-save">保存</button></div>' +
      '<div class="siteform" style="margin-top:8px"><select id="khRollbackSel" aria-label="回滚版本"><option value="">归档列表加载中…</option></select>' +
      '<button class="btn-primary" data-act="rollback-go">↩ 覆盖安装该版本</button>' +
      '<button class="btn-ghost" data-act="pin-clear">解除固定</button></div>' +
      '<p class="platnote">固定状态：<span id="khPinState">…</span> · 上次启动耗时：<span id="khBootMs">…</span> · ' +
      (KH_UI_CLEAN ? '可选版本来自发布归档' : '归档列表来自开发端 releases 索引') + '，缺失版本会如实提示。</p></div>' +
    '<div class="sitebox"><h3>开机自启</h3>' +
      (window.khAutostart
        ? '<p>登录系统后自动启动本应用；开关真实状态以系统登录项为准，本机仅记一次界面偏好。</p>' +
          '<div class="siteform"><select id="khAutostartSel" aria-label="开机自启">' +
            '<option value="0">开机自启：关（默认）</option><option value="1">开机自启：开</option></select>' +
          '<button class="btn-primary" data-act="autostart-save">保存</button></div>' +
          '<p class="platnote">仅桌面 Electron 版生效；深开鸿设备端 / 浏览器打开时此项不可用。</p>'
        : '<p class="platnote">当前环境不支持开机自启（仅桌面 Electron 版可用；浏览器 / 设备端无系统登录项接口）。</p>') +
    '</div>' +
    '<div class="sitebox"><h3>网络代理</h3>' +
      (window.khProxy
        ? '<p>取数据走哪条路：<b>跟随系统</b>（默认）/ <b>直连</b>（无视系统代理）/ <b>手动</b>（host:port）。保存后立即生效，下次启动按保存项自动应用。</p>' +
          '<div class="siteform"><select id="khProxyModeSel" aria-label="代理模式">' +
          (function(){
            var pm = String((getStore('kh_proxy', null) || {}).mode || 'system');
            return [['system', '跟随系统（默认）'], ['none', '直连（不走代理）'], ['manual', '手动代理']].map(function(o){
              return '<option value="' + o[0] + '"' + (pm === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
            }).join('');
          })() +
          '</select>' +
          '<input id="khProxyServer" class="u" type="text" placeholder="代理地址，如 127.0.0.1:7890" autocomplete="off" maxlength="60" aria-label="代理地址">' +
          '<button class="btn-primary" data-act="proxy-save">保存并测试</button></div>' +
          '<p class="platnote">当前实际生效：<span id="khProxyNow">读取中…</span>　·　企业网 / 校园网取不到片源时先看这里；代理只影响本应用，不改系统设置。</p>'
        : '<p class="platnote">当前环境不支持设置代理（仅桌面 Electron 版可用；浏览器 / 设备端跟随系统网络设置）。</p>') +
    '</div>' +
    '<div class="sitebox"><h3>显示与辅助</h3>' +
      '<div class="siteform"><select id="khThemeSel" aria-label="界面主题">' +
      (function(){
        var th = String(getStore('kh_theme', '') || 'dark');
        return ['dark|深色（默认）', 'night|夜间（暖色减亮）', 'light|浅色', 'ocean|深海蓝', 'forest|墨绿', 'violet|暗夜紫', 'mono|炭灰', 'sand|暖棕', 'rose|玫红', 'slate|青灰'].map(function(o){
          var v = o.split('|');
          return '<option value="' + v[0] + '"' + (th === v[0] ? ' selected' : '') + '>' + v[1] + '</option>';
        }).join('');
      })() +
      '</select>' +
      '<select id="khLangSel" aria-label="界面语言">' +
      (function(){
        var lg = String(getStore('kh_lang', 'zh') || 'zh');
        return [['zh', '中文'], ['en', 'English（主要界面）']].map(function(o){
          return '<option value="' + o[0] + '"' + (lg === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('');
      })() +
      '</select>' +
      '<select id="khSeniorSel" aria-label="长辈模式"><option value="0">长辈模式（大字大按钮）：关</option><option value="1">长辈模式：开</option></select>' +
      (function(){
        var ss = khSubStyle();
        return '<select id="khSubSizeSel" aria-label="字幕字号">' +
          [['s','字幕字号：小'],['m','字幕字号：中（默认）'],['l','字幕字号：大']].map(function(o){
            return '<option value="' + o[0] + '"' + (ss.size === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('') + '</select>' +
          '<select id="khSubPosSel" aria-label="字幕位置">' +
          [['low','字幕位置：靠下'],['mid','字幕位置：居中（默认）'],['high','字幕位置：抬高']].map(function(o){
            return '<option value="' + o[0] + '"' + (ss.pos === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('') + '</select>';
      })() +
      '<button class="btn-primary" data-act="display-save">保存</button></div>' +
      '<p class="platnote">主题三选：深色 / 浅色 / 夜间（暖色遮罩，含视频整体生效）。语言覆盖导航、播放器控制与设置页标题，其余中文兜底（未做全量翻译，避免半吊子）。字幕字号与位置即时生效，只影响本机渲染的字幕层。响度均衡：通过本机音频压缩器拉平不同片源音量；若片源跨源受限导致被静音，会自动探测并回退为原音量，不强行接管。长辈模式自动放大到 130%。</p></div>' +
    '<div class="sitebox">' + (KH_UI_CLEAN
      ? '<h3>远程通知记录</h3><p>最近 20 条远程发来的通知与执行结果，只存本机。</p>'
      : '<h3>开发端下发记录</h3><p>最近 20 条由开发端下发的动作与执行结果，只存本机。</p>') +
      (function(){
        var ql = getStore('khQueueLog', []) || [];
        if(!ql.length) return '<p class="platnote">还没有收到过下发。新版客户端启动 5 秒后开始轮询，之后每 60 秒一次。</p>';
        var out = '<div class="sitelist">';
        ql.slice(0, 20).forEach(function(r, i){
          var okr = r.result === 'done';
          out += '<div class="siteitem"><div class="siteico" style="background:' + (okr ? '#1F5B3A' : '#5B2323') + '">' + (okr ? '✓' : '!') + '</div>' +
            '<div class="sitemeta"><div class="n">' + esc(r.label || r.action) + '<span class="builtin">' + (okr ? '已完成' : '失败') + '</span></div>' +
            '<div class="u">' + esc(String(r.ts || '').replace('T', ' ').slice(0, 16)) + ' · ' + esc(r.note || '无备注') + '</div></div>' +
            (okr ? '' : '<button class="mini" data-act="queue-retry" data-index="' + i + '" title="重试">↻</button>') + '</div>';
        });
        return out + '</div>';
      })() +
      '</div>' +
    '<div class="sitebox"><h3>本机缓存与数据</h3>' +
      '<p>播放进度、清单缓存只存本机；清理后云端清单会在下次同步时重新拉取。</p>' +
      '<div class="sitetools">' +
      '<button class="qbtn" id="khSetClearProg">清空播放记录</button>' +
      '<button class="qbtn" id="khSetClearCache">清理清单缓存</button>' +
      '<button class="qbtn" id="khSetReload">重启页面</button>' +
      '<button class="qbtn" data-act="settings-reset" title="还原设置项，不动收藏/历史/片单">恢复默认设置</button>' +
      '</div>' +
      '<p class="platnote">' + (KH_UI_CLEAN
        ? '源修复与问题闭环由中枢自动完成，客户端只读展示结果。'
        : '客户成品不含「一键自愈 / 同时更新并发布 / 自治 / 功能管理」等开发端操作，这些能力只在开发者端开放；源修复与问题闭环由中枢自动完成，客户端只读展示结果。') + '</p></div>' +
      '<div class="sitebox"><h3>快捷键与操作</h3>' +
      '<p>应用自带菜单默认隐藏，按 <b>Alt</b> 可唤出；常用操作如下：</p>' +
      '<p class="platnote"><b>F5</b> 或 <b>Ctrl+R</b> 重新加载页面 · <b>F11</b> 切换全屏 · ' +
      '<b>Ctrl+Q</b> 退出应用 · <b>Ctrl+Shift+I</b> 打开开发者工具（反馈问题时可用来抓错误）</p>' +
      '<p class="platnote">播放区：<b>空格</b>/<b>K</b> 播放暂停 · <b>←</b><b>J</b> 快退 · <b>→</b><b>L</b> 快进 · <b>↑</b><b>↓</b> 直播切台 / 点播音量 · <b>F</b> 全屏 · <b>M</b> 静音 · <b>0</b>-<b>9</b> 跳转进度 · <b>Esc</b> 退出播放器</p>' +
      '<p class="platnote">列表页：<b>/</b> 聚焦搜索 · <b>方向键</b> 在卡片/按钮间移动焦点 · <b>Enter</b> 打开（TV 遥控方向键同此逻辑）</p></div>' +
    /* 下载队列（1.7.79）：只有桌面主进程桥存在时才给出入口，纯网页 / HAP 如实说明不支持 */
    '<div class="sitebox"><h3>下载队列</h3>' +
    (window.khDl
      ? '<p>把视频直链（mp4 / mkv / ts 等文件）排进队列离线下载：<b>并发 1–4 路</b>、<b>断点续传</b>（未完成部分留在 .part，中断后可接着下）、<b>限速</b>、<b>失败自动重试 2 次</b>，完成后弹系统通知。文件保存到系统下载目录下的「鸿汇影下载」文件夹。<strong>m3u8 是切片清单，必须合并才能得到视频，这里明确不支持</strong>。</p>' +
        '<div class="siteform">' +
          '<input id="dlUrl" class="n" type="text" placeholder="视频直链 https://…/xxx.mp4" maxlength="2048" autocomplete="off" aria-label="下载地址">' +
          '<input id="dlName" class="u" type="text" placeholder="文件名（可选）" maxlength="100" aria-label="下载文件名">' +
          '<button class="btn-ghost" data-act="dl-add" aria-label="把填写的地址加入下载队列">＋ 加入队列</button>' +
        '</div>' +
        '<div class="sitetools" style="margin-top:10px">' +
          '<label class="platnote" style="display:inline-flex;align-items:center;gap:6px">并发 ' +
            '<select id="dlConc" aria-label="下载并发数"><option value="1">1 路</option><option value="2">2 路</option><option value="3">3 路</option><option value="4">4 路</option></select></label>' +
          '<label class="platnote" style="display:inline-flex;align-items:center;gap:6px">限速 ' +
            '<select id="dlLimit" aria-label="下载限速"><option value="0">不限速</option><option value="512">512 KB/s</option><option value="1024">1 MB/s</option><option value="2048">2 MB/s</option><option value="5120">5 MB/s</option></select></label>' +
          '<button class="qbtn" data-act="dl-opt-apply">应用</button>' +
          '<button class="qbtn" data-act="dl-reveal">打开下载文件夹</button>' +
          '<button class="qbtn" data-act="dl-clear">清掉已结束</button>' +
        '</div>' +
        '<div id="dlList" style="margin-top:10px"><p class="platnote">正在读取队列…</p></div>'
      : '<p class="platnote">当前环境没有主进程下载桥，离线下载只在桌面版可用；网页版 / 鸿蒙版不做本地文件落盘。</p>') +
    '</div>';
  } else if(state.view === 'about'){
    html += '<div style="padding:20px 18px;line-height:1.95;font-size:14px;max-width:780px">';    html += '<h2 style="margin:0 0 10px">关于「影视资源」</h2>';    html += '<p>本应用为本地自签名应用，内容由你自行提供，内置能力如下：</p>';    html += '<ul style="padding-left:20px;margin:8px 0">';    html += '<li><b>电视直播</b>：内置各大卫视与央视频道等公开 IPTV 直播源（m3u8），可直接观看；</li>';    html += '<li><b>自定义网址</b>：在「网址」页粘贴视频直链播放，或粘贴影视网站在应用内直接打开；</li>';    html += '<li><b>自建资源</b>：在「资源」页添加你自己的影视直链，「直播」页可添加 m3u8 频道或导入 M3U；</li>';    html += '<li><b>平台入口</b>：各视频平台官方网站，点击在应用内打开，内容版权归平台所有。</li>';    html += '</ul>';    html += '<p style="color:#FFB74D;margin-top:12px">所有内容版权归原作者 / 平台所有。本应用不托管、不破解、不聚合任何未授权片源；请仅使用你拥有合法授权的资源。</p>';    html += '<p style="opacity:.7;margin-top:6px">签名类型：本地自签名（release，无设备绑定），仅供学习与个人使用。</p>';
    html += '<h2 style="margin:22px 0 8px">隐私政策 · 用户协议 · 免责声明</h2>' +
      '<details style="margin:10px 0"><summary style="cursor:pointer;color:#4FA3E3">隐私政策（摘要）</summary>' +
      '<p>本应用是本机软件，不收集你的账号、身份或观看内容。播放记录、收藏、片源与问题记录只存本机，不上传；' +
      (KH_UI_CLEAN ? '' : '「问题中心 → 远程收集」默认关闭，只有你自己填写收集地址并手动开启后，才会把脱敏的错误摘要（类别、错误码、次数、站点域名）随随机匿名设备 ID 上报，不含账号、片源内容与完整 URL 参数，可随时关闭并清空。') +
      '软件更新时只访问你配置的更新服务地址与本机镜像站，不向第三方广告或统计服务发送数据。</p></details>' +
      '<details style="margin:10px 0"><summary style="cursor:pointer;color:#4FA3E3">用户协议（摘要）</summary>' +
      '<p>本应用仅提供播放能力与公开可访问资源的整理，不托管、不上传、不破解、不聚合任何未授权影视内容。' +
      '你应确保所添加的片源、直链、平台入口与直播源具备合法授权，并对自己的使用行为负责；' +
      '应用内任何内置条目均为可公开访问的样本或官方入口，商用前请替换为你已获授权的媒资。' +
      '禁止将本应用用于传播违法信息、绕过付费墙、批量抓取或任何侵犯他人权利的行为。</p></details>' +
      '<details style="margin:10px 0"><summary style="cursor:pointer;color:#4FA3E3">免责声明</summary>' +
      '<p>资源可用性取决于第三方服务，随时可能失效；本应用不保证任何片源长期可播，也不对第三方内容承担责任。' +
      '因网络环境、地区限制或平台策略导致的不可播，属正常现象，可通过「问题」页反馈并等待中枢自动换源。' +
      '本应用按「现状」提供，不对由此产生的间接损失负责。若你不同意上述条款，请停止使用并卸载。</p></details>';
    html += '</div>';
  } else if(state.view === 'issues'){
    var _is = issueStats(), _ic = issueCfg(), _il = issueList(),
        _ist = srcHealthStat(), _im = srcMeta();
    html += '<div class="section-head"><h2>问题中心 · 自动收集</h2><span>本机记录 ' +
      _is.total + ' 条 / 近 24 小时 ' + _is.day + ' 次</span></div>' +
      '<div class="sitebox"><h3>运行期问题自动汇总</h3>' +
      '<p>自动收集脚本异常、媒体资源失败、片源 / 平台不可达、云端清单与升级异常、系统兼容，' +
      '以及原生网页页的加载错误码（如 -310 / 403）。同类问题 60 秒内合并计数，最多保留 ' + ISSUE_MAX +
      ' 条，<b>只存本机、不上传</b>，不含账号与片源内容。点「复制诊断报告」即可把设备、版本、' +
      '源健康与问题明细粘贴给开发者；从网页页返回时会自动拉取那边的加载错误。</p>' +
      '<div class="sitetools">' +
      '<button class="qbtn" data-act="issue-toggle">' + (_ic.auto ? '◉ 自动收集已开启' : '○ 自动收集已暂停') + '</button>' +
      (KH_UI_CLEAN ? '' : '<button class="qbtn" data-act="issue-check">⟳ 立即自检并拉取网页错误</button>') +
      '<button class="qbtn" data-act="issue-copy">📋 复制诊断报告</button>' +
      '<button class="qbtn" data-act="issue-export-txt">📄 导出报告 .txt</button>' +
      '<button class="qbtn" data-act="issue-export">📥 导出 JSON</button>' +
      '<button class="qbtn" data-act="issue-clear">🗑 清空记录</button>' +
      '</div>' +
      (state.issueConfirm ? '<div class="confirmbar">确定清空全部 ' + _is.total + ' 条问题记录？' +
        '<button class="btn-primary" data-act="issue-clear-yes">确定清空</button>' +
        '<button class="btn-ghost" data-act="issue-clear-no">再想想</button></div>' : '') +
      '<p class="platnote">设备：<b>' + esc(issueDevice()) + '</b> · 源清单 v' + (_im.v || 0) +
      ' · 可用线路 ' + _ist.good + ' / 降权 ' + _ist.bad + ' · 平台 ' + BUILTIN_SITES.length + ' 个</p>' +
      '</div>';
    /* 远程收集是开发端诊断通道：只给开发端；客户成品不出现这块入口 */
    if (!KH_UI_CLEAN) {
    var _rc = issueRemoteCfg();
    html += '<div class="section-head"><h2>远程收集</h2><span>' +
      (_rc.enabled ? '已开启' : '未启用 · 仅本地') + ' · 累计上报 ' + (_rc.sent || 0) + ' 条</span></div>' +
      '<div class="sitebox"><h3>问题摘要自动上报</h3>' +
      '<p><b>当前默认关闭，不向任何外部地址发送数据</b>；本地自动收集、体检与导出照常工作。' +
      '需要远程汇总时，填入你自己的收集地址、点「开启」后，应用才会把<b>脱敏后的错误摘要</b>' +
      '（类别、错误码、消息、次数、发生页面、站点域名）随随机匿名设备 ID 定时上报；' +
      '不含账号、片源内容或完整 URL 参数，可随时关闭或清空。真机走原生 HTTP，浏览器预览走网页通道。</p>' +
      '<div class="siteform">' +
      '<input id="issueRemoteUrl" class="u" type="text" placeholder="https://你的收集服务/api/report" ' +
      'autocomplete="off" value="' + esc(_rc.url) + '">' +
      '<button class="btn-primary" data-act="issue-remote-save">保存地址</button>' +
      '</div><div class="sitetools">' +
      '<button class="qbtn" data-act="issue-remote-toggle">' +
        (_rc.enabled ? '◉ 远程收集已开启' : '○ 远程收集已暂停') + '</button>' +
      '<button class="qbtn" data-act="issue-remote-send">↑ 立即上报</button>' +
      (_rc.url ? '<button class="qbtn" data-act="issue-remote-open">🌐 打开在线问题看板</button>' : '') +
      '</div><p class="platnote">状态：' +
      (_rc.lastAt ? '最近成功 ' + esc(new Date(_rc.lastAt).toLocaleString('zh-CN', {hour12:false})) : '尚未上报') +
      (window.KH_REMOTE_STATE && window.KH_REMOTE_STATE.via ? ' · 通道 ' + (window.KH_REMOTE_STATE.via === 'native' ? '原生' : '网页') + (window.KH_REMOTE_STATE.n ? ' · 本次 ' + window.KH_REMOTE_STATE.n + ' 条' : '') : '') +
      (_rc.err ? ' · <b style="color:#F5C542">上次失败：' + esc(_rc.err) + '（' + _rc.fails + ' 次）</b>' : '') +
      ' · 匿名 ID ' + esc(issueDeviceId().slice(0, 18)) + '…</p></div>';
    }
    /* 中枢侧问题单：由中枢按播放回传 + 定时探测自动建单 / 换源 / 复检，客户端只读展示 */
    var _khIss = window.KH_ISSUES;
    if(_khIss && _khIss.summary){
      var _khOpen = (_khIss.list || []).filter(function(x){ return x.status !== 'resolved'; }).slice(0, 12);
      html += '<div class="section-head"><h2>云端问题单 · 中枢自动处理</h2><span>待处理 ' +
        _khIss.summary.open + ' · 跟踪 ' + _khIss.summary.tracking + ' · 已闭环 ' + _khIss.summary.resolved + '</span></div>';
      if(_khOpen.length){
        html += '<div class="sitelist">';
        for(var _ko = 0; _ko < _khOpen.length; _ko++){
          var _ki = _khOpen[_ko];
          html += '<div class="siteitem"><div class="siteico" style="background:' +
            (_ki.status === 'tracking' ? '#B8860B' : '#C0392B') + '">' + (_ki.status === 'tracking' ? '跟' : '待') + '</div>' +
            '<div class="sitemeta"><div class="n">' + esc(String(_ki.title || _ki.name || _ki.catalogId || '未命名资源')) + '</div>' +
            '<div class="u">' + esc(String(_ki.reason || '') + (_ki.failureRate != null ? ' · 失败率 ' + _ki.failureRate + '%' : '')) + '</div></div></div>';
        }
        html += '</div>';
      } else {
        html += '<div class="empty"><span class="ico">✅</span>中枢侧当前没有待处理问题，源探测由中枢定时自动执行</div>';
      }
      html += '<p class="platnote">这些条目由中枢自动建单并自动换源复检；修复结果随清单热更新下发，客户端无需重装即可恢复。</p>';
    }
    if(window.KH_CRASH_LOG && window.KH_CRASH_LOG.length){
      html += '<div class="section-head"><h2>本机崩溃 / 异常</h2><span>主进程与渲染进程记录 · 最近 ' +
        Math.min(window.KH_CRASH_LOG.length, 10) + ' 条</span></div><div class="sitelist">';
      for(var ci=0; ci<window.KH_CRASH_LOG.length && ci<10; ci++){
        var cr = window.KH_CRASH_LOG[ci];
        html += '<div class="siteitem"><div class="siteico" style="background:#C0392B">崩</div>' +
          '<div class="sitemeta"><div class="n">' + esc(String(cr.kind)) + ' ×' + (cr.n || 1) + '</div>' +
          '<div class="u">' + esc(new Date(cr.ts).toLocaleString('zh-CN', {hour12:false})) +
          ' · ' + esc(String(cr.reason || '').slice(0, 90)) + '</div></div></div>';
      }
      html += '</div>';
    }
    html += '<div class="section-head"><h2>高频问题</h2><span>按出现次数排序 · 共 ' + _is.top.length + ' 类</span></div>';
    if(_is.top.length){
      html += '<div class="sitelist">';
      for(var _ti=0;_ti<_is.top.length;_ti++){
        var _kp = _is.top[_ti].key.split('|'), _tk = _kp[0] || '其他';
        html += '<div class="siteitem"><div class="siteico" style="background:' +
          (issueSev(_tk) === 'error' ? '#C0392B' : (issueSev(_tk) === 'warn' ? '#B8860B' : '#2E86C1')) + '">!</div>' +
          '<div class="sitemeta"><div class="n">' + esc(_tk) + ' ×' + _is.top[_ti].n + '</div>' +
          '<div class="u">' + esc(_kp.slice(1).join('|').slice(0, 110)) + '</div></div></div>';
      }
      html += '</div>';
    } else {
      html += '<div class="empty"><span class="ico">✅</span>暂未收集到问题，运行正常</div>';
    }
    html += '<div class="section-head"><h2>问题时间线</h2><span>显示最近 ' +
      Math.min(_il.length, 60) + ' 条 · 去重后共 ' + _is.total + ' 条</span></div>';
    if(_il.length){
      html += '<div class="sitelist">';
      for(var _ii=0;_ii<_il.length && _ii<60;_ii++){
        var _it = _il[_ii];
        html += '<div class="siteitem"><div class="siteico" style="background:' +
          (_it.sev === 'error' ? '#C0392B' : (_it.sev === 'warn' ? '#B8860B' : '#2E86C1')) + '">' +
          esc(String(_it.kind).slice(0, 1)) + '</div>' +
          '<div class="sitemeta"><div class="n">' + esc(_it.kind) +
          (_it.code ? ' · ' + esc(_it.code) : '') + ' ×' + (_it.n || 1) + '</div>' +
          '<div class="u">' + esc(new Date(_it.ts).toLocaleString('zh-CN', {hour12:false})) +
          ' · ' + esc(String(_it.msg).slice(0, 90)) + '</div></div></div>';
      }
      html += '</div>';
    } else {
      html += '<div class="empty"><span class="ico">🩺</span>' +
        (KH_UI_CLEAN ? '暂无记录，出现异常时会自动收集' : '暂无记录，可点「立即自检」生成一次体检') + '</div>';
    }
    if(state.issueReportText){
      html += '<div class="section-head"><h2>诊断报告 / 导出内容（可长按复制）</h2></div>' +
        '<div class="backupbox"><textarea id="issueReport" style="min-height:220px">' +
        esc(state.issueReportText) + '</textarea></div>';
    }
  }
  /* 视图切换前保存旧视图滚动位置；同视图原地重绘不记录、不回顶 */
  var viewChanged = state.lastView && state.lastView !== state.view;
  if(viewChanged){ state.scrollPos[state.lastView] = els.main.scrollTop; }
  els.main.innerHTML = html;
  try{ khApplyLang(); }catch(e){}
  if(state.view === 'settings'){ try{ khBindSettings(); }catch(e){} try{ khDlRender(); }catch(e2){} try{ if(typeof khProxyShow === 'function') khProxyShow(); }catch(e3){} }
  /* 视图切换淡入（仅切换时触发，输入防抖等原地重绘不打扰） */
  if(state.lastView !== state.view){
    state.lastView = state.view;
    els.main.classList.remove('main-fade');
    void els.main.offsetWidth;
    els.main.classList.add('main-fade');
  }
  var ls = document.getElementById('liveSearch');
  if(ls){
    ls.value = state.liveKeyword || '';
    if(state.liveSearchFocus){
      ls.focus();
      try{ ls.setSelectionRange(ls.value.length, ls.value.length); }catch(e){}
    }
  }
  setDiag('cards', els.main.querySelectorAll('.card').length);
  setDiag('sites', getSites().length);
  setDiag('live', allLiveChannels().length);
  setDiag('render', state.renderCount);
  els.searchClear.classList.toggle('show', state.keyword.length > 0);
  var btns = els.nav.querySelectorAll('button');
  for(var b=0;b<btns.length;b++){
    btns[b].classList.toggle('on', btns[b].getAttribute('data-view') === state.view);
  }
  /* 视图切换恢复上次滚动位置；同视图原地重绘保持当前位置 */
  if(viewChanged){ els.main.scrollTop = state.scrollPos[state.view] || 0; }
  els.toTop.classList.remove('show');
}

