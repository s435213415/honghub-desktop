/* HongHub 前端模块：播放器/自适应/看门狗/右键菜单/追剧/更新通道
   由 app/index.html 单文件版拆分（1.7.72 模块化），按 <script> 顺序加载，顶层函数/常量共享全局作用域。 */
/* ---------------- 播放器：点击即播 + 多源自动回退 ---------------- */
function currentSources(m){
  // 片源全部来自网络：直播频道 3 路、点播影片 3 路、自定义网址 1 路；多源自动回退逻辑保持不变
  if(m && m.live){
    var larr = m.sources.slice();
    var bkm = getStore('kh_live_backup', {}) || {};
    var extra = (m.id && bkm[m.id]) ? bkm[m.id] : [];
    for(var bi=0;bi<extra.length;bi++) larr.push({label:'我的备用线路' + (extra.length > 1 ? ' ' + (bi+1) : ''), url:extra[bi]});
    return larr;
  }
  var arr = [];
  var srcs = m && m.sources ? m.sources : [];
  for(var i=0;i<srcs.length;i++) arr.push(srcs[i]);
  return arr;
}
function customMovie(url){
  return {
    id:'custom_' + hashId(url), custom:true,
    title:'自定义视频网址', subtitle:esc(url.slice(0, 42)),
    year:new Date().getFullYear(), rating:0, category:'网址', tags:['自定义'],
    desc:'正在播放你填入的视频直链。若地址不可达，会提示检查网络或换一个直链。',
    cast:'—', color:'#2A3550', accent:'#5B7BC4',
    sources:[{label:'自定义网址', url:url}]
  };
}
function openPlayer(m, startIndex){
  clearWatchdog();
  state.movie = m;
  state.srcIndex = 0;
  state.lastSave = 0;
  state.failKey = '';
  state.failedSrc = {};
  state.lastHlsErr = '';
  state.lastVideoErr = 0;
  state.playStats = { startMs: Date.now(), firstFrameMs: 0, buffering: 0, downgrades: 0, sourceSwitches: 0 };
  state.seekDragging = false;
  var isLive = !!m.live;
  els.player.classList.add('show');
  els.player.classList.toggle('live-mode', isLive);
  /* 播放器面板强调色跟随影片封面主色（仅本容器局部变量，不改全局主题；非法色值回退默认） */
  try{
    if(m.color && /^#[0-9a-fA-F]{6}$/.test(m.color)){
      els.player.style.setProperty('--brand', m.color);
      els.player.style.setProperty('--brand2', (m.accent && /^#[0-9a-fA-F]{6}$/.test(m.accent)) ? m.accent : m.color);
    }
  }catch(e){}
  els.liveBar.classList.toggle('show', isLive);
  els.title.textContent = isLive
    ? ('● LIVE　CH ' + String(m.channel.no).padStart(2,'0') + '　·　' + m.title + '　｜　' + m.channel.group)
    : (m.title + '　·　' + m.year + (m.rating > 0 ? '　★ ' + m.rating.toFixed(1) : ''));
  els.info.textContent = isLive
    ? (m.desc + '　｜　直播不记录观看进度')
    : (m.desc + '　｜　主演：' + m.cast + '　｜　' + m.tags.join(' / '));
  els.favBtn.style.display = (m.custom || isLive) ? 'none' : '';
  try{
    var bwl = document.getElementById('btnWatchLater');
    if(bwl){
      bwl.style.display = isLive ? 'none' : '';
      bwl.textContent = getWatchLater().indexOf(m.id) >= 0 ? '⏰ 已加入' : '⏰ 稍后看';
    }
    var bws = document.getElementById('btnWatchSub');
    if(bws){
      bws.style.display = isLive ? 'none' : '';
      bws.textContent = isSubbed(m.id) ? '⭐ 已订阅' : '⭐ 追剧';
    }
    var bq0 = document.getElementById('btnQuality');
    if(bq0) bq0.textContent = '🎚 自动';
  }catch(e){}
  if(isLive) updateLiveBar(m.channel);
  updateFavBtn();
  renderSrcBar();
  renderPlayerAside(m);
  // 允许指定起始片源：备用线路自检直接指定源序号，不产生换源竞态
  loadSource(startIndex === undefined ? 0 : startIndex);
  // 自定义网址与直播频道都不写入影片历史，避免污染「观看历史」与进度存储
  if(!m.custom && !m.live){
    var hist = getHistory().filter(function(id){
      if(id === m.id) return false; // 同一条目去重
      var om = findMovie(id);
      if(om && om.title && om.title === m.title) return false; // 同片名聚合：跨 id 的重复条目只留最新
      return true;
    });
    hist.unshift(m.id);
    setStore('kh_hist', hist.slice(0, KH_HIST_CAP));
  }
}
function updateFavBtn(){
  if(!state.movie) return;
  var fav = getFav().indexOf(state.movie.id) >= 0;
  els.favBtn.textContent = fav ? '★ 已收藏' : '☆ 收藏';
}
/* 播放页右栏「相关推荐」：同分类优先，点卡片直接换片（直播与自定义网址不展示）。 */
function renderPlayerAside(m){
  if(!els.asideWrap) return;
  if(!m || m.live || m.custom){
    els.asideWrap.style.display = 'none';
    return;
  }
  var pool = allMovies().filter(function(x){ return x.id !== m.id && !x.live; });
  var same = pool.filter(function(x){ return x.category === m.category; });
  var rest = pool.filter(function(x){ return x.category !== m.category; });
  var list = same.concat(rest).slice(0, 8);
  if(!list.length){
    els.asideWrap.style.display = 'none';
    return;
  }
  els.asideWrap.style.display = '';
  var html = '';
  for(var i=0;i<list.length;i++){
    var x = list[i];
    var xc1 = (x.color && /^#[0-9a-fA-F]{6}$/.test(x.color)) ? x.color : '#3B456B';
    var xc2 = (x.accent && /^#[0-9a-fA-F]{6}$/.test(x.accent)) ? x.accent : '#5B7BC4';
    var bg = 'linear-gradient(155deg,' + xc1 + ' 0%,' + xc2 + ' 130%)';
    html += '<div class="aside-item" data-id="' + esc(x.id) + '" role="button" tabindex="0" aria-label="播放 ' + esc(x.title) + '">' +
      '<div class="aside-poster" style="background:' + bg + '">' + esc(x.title) + '</div>' +
      '<div class="aside-meta">' + x.year + ' · ' + esc(x.category) + '</div></div>';
  }
  els.asideList.innerHTML = html;
}
function renderSrcBar(){
  if(!state.movie) return;
  var srcs = currentSources(state.movie);
  var html = '<span class="src-label" id="srcLabel">片源加载中…</span>';
  for(var i=0;i<srcs.length;i++){
    html += '<button class="src-btn ' + (i===state.srcIndex?'on':'') + (state.failedSrc[i]?' failed':'') +
            '" data-act="src" data-index="' + i + '">' + esc(srcs[i].label) +
            (srcs[i].local ? ' · 备用' : '') + '</button>';
  }
  els.srcBar.innerHTML = html;
}
function loadSource(index){
  if(!state.movie) return;
  var srcs = currentSources(state.movie);
  if(index < 0 || index >= srcs.length){
    showAllFailed();
    return;
  }
  state.srcIndex = index;
  state.failKey = '';
  var s = srcs[index];
  renderSrcBar();
  setSrcLabel('正在加载 · ' + s.label);
  els.msg.textContent = '';
  setDiag('source', s.url);
  setDiag('state','loading');
  khShowBuffering('正在加载 · ' + s.label);
  destroyHls();
  state.hlsToken = (state.hlsToken || 0) + 1;   // 切台/换源后作废上一个 HLS 加载回调
  var v = els.video;
  v.removeAttribute('src');
  v.load();
  // 静音起播绕过浏览器自动播放限制；进入 playing 后按用户意图恢复音量
  v.muted = true;
  els.tap.classList.remove('show');
  els.seek.value = '0';
  els.timeText.textContent = '00:00 / 00:00';
  /* 1.7.82：把当前片源的请求头按 host 下发给主进程，播放时统一补 Referer / UA。
     影视仓的防盗链站「接口通、播放 403」就是缺这一步；HAP / 网页环境没有该桥，忽略即可。 */
  khApplySrcHeaders(s);
  armWatchdog(s);
  if(/\.m3u8(\?|$)/i.test(s.url)){
    setupHls(s.url);
  } else {
    v.src = s.url;
    v.load();
    playVideo();
  }
}
function setSrcLabel(t){
  var el = document.getElementById('srcLabel');
  if(el) el.textContent = t;
}
/* 1.7.82 播放层请求头：按片源 URL 的 host 记录 Referer / UA / 其他头。
   默认取同源 Referer（绝大多数防盗链站只要求「来源像是自己站里点的」）。
   片源对象显式带 headers / referer 时以显式为准。 */
function khApplySrcHeaders(s){
  try{
    if(!window.khPlayHdr || !s || !s.url) return;
    if(/^(file|blob|resource|data):/i.test(s.url)) return;
    var u;
    try{ u = new URL(s.url, location.href); }catch(e){ return; }
    var host = u.host;
    if(!host) return;
    var hd = (s.headers && typeof s.headers === 'object') ? s.headers : {};
    var referer = s.referer || hd.Referer || hd.referer || (u.origin + '/');
    var ua = hd['User-Agent'] || hd['user-agent'] || '';
    var rest = {};
    for(var k in hd){
      if(!Object.prototype.hasOwnProperty.call(hd, k)) continue;
      if(/^referer$/i.test(k) || /^user-agent$/i.test(k)) continue;
      rest[k] = hd[k];
    }
    window.khPlayHdr.set({ host: host, referer: referer, ua: ua, headers: Object.keys(rest).length ? rest : null });
  }catch(e){}
}
function playVideo(){
  try{
    if(state.loudnessEq && !state.audioGraph){
      var g0 = khEnsureAudioGraph();
      if(g0 && g0.ctx && g0.ctx.state === 'suspended') g0.ctx.resume();
    } else if(state.audioGraph && state.audioGraph.ctx.state === 'suspended'){
      state.audioGraph.ctx.resume();
    }
  }catch(e){}
  els.tap.classList.remove('show');
  var p = els.video.play();
  if(p && p.catch) p.catch(function(){
    els.tap.classList.add('show');
    els.msg.textContent = '点一下画面中的播放按钮即可开始';
  });
  syncPlayBtn();
}
function togglePlay(){
  var v = els.video;
  if(v.paused) playVideo(); else v.pause();
  syncPlayBtn();
}
function syncPlayBtn(){
  var paused = els.video.paused;
  els.btnPlay.textContent = paused ? '▶' : '❚❚';
  els.btnPlay.classList.toggle('on', !paused);
}
function destroyHls(){
  if(state.hlsStallHandler){ try{ els.video.removeEventListener('waiting',state.hlsStallHandler); els.video.removeEventListener('stalled',state.hlsStallHandler); }catch(e){} state.hlsStallHandler=null; }
  if(state.hls){ try{ state.hls.destroy(); }catch(e){} state.hls = null; }
  if(window.__khGuardTimer){ try{ clearInterval(window.__khGuardTimer); }catch(e){} window.__khGuardTimer = 0; }
}
/* HLS 播放器组件加载器：本地 lib/hls.min.js 优先（不依赖外网 CDN），CDN 兜底；这是播放器组件，不是影视资源。
   抽成独立函数便于自检直接调用，也保证「原生不支持 HLS」的设备上组件一定可用。 */
var HLS_LIB_URLS = ['lib/hls.min.js', 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js'];
var hlsLibLoading = false;
var hlsLibWaiters = [];
function ensureHlsLib(cb){
  if(window.Hls && window.Hls.isSupported()){ cb(true, 'cached'); return; }
  hlsLibWaiters.push(cb);
  if(hlsLibLoading) return;
  hlsLibLoading = true;
  var li = 0;
  var finish = function(ok, from){
    hlsLibLoading = false;
    var ws = hlsLibWaiters; hlsLibWaiters = [];
    for(var i=0;i<ws.length;i++){ try{ ws[i](ok, from); }catch(e){} }
  };
  var tryNext = function(){
    if(window.Hls && window.Hls.isSupported()){ finish(true, 'cached'); return; }
    if(li >= HLS_LIB_URLS.length){ finish(false, 'unavailable'); return; }
    var src = HLS_LIB_URLS[li++];
    var sc = document.createElement('script');
    sc.src = src;
    sc.onload = function(){
      if(window.Hls && window.Hls.isSupported()){
        setDiag('hls', src.indexOf('lib/') === 0 ? 'hlsjs-local' : 'hlsjs-cdn');
        finish(true, src.indexOf('lib/') === 0 ? 'local' : 'cdn');
      } else { tryNext(); }
    };
    sc.onerror = function(){ tryNext(); };
    document.head.appendChild(sc);
  };
  tryNext();
}
/* 供自检验证随包组件可用（不依赖当前播放路径） */
window.KaihongHls = {
  ensure: ensureHlsLib,
  supported: function(){ return !!(window.Hls && window.Hls.isSupported()); }
};
function setupHls(url){
  var v = els.video;
  var token = ++state.hlsToken;
  var alive = function(){ return !!state.movie && token === state.hlsToken; };
  var useHlsJs = function(){
    if(!alive()) return;
    ensureHlsLib(function(ok){
      if(!alive()) return;
      if(ok && window.Hls && window.Hls.isSupported()) startHls(url);
      else { els.msg.textContent = 'HLS 组件不可用，已切换其他片源'; nextSource(); }
    });
  };
  // 三层策略：1) 原生 HLS（对 resource://rawfile 本地分片最稳）
  //          2) 原生超时未起播 → 随包 hls.js（MSE，覆盖宣称支持但播不了的设备）
  //          3) hls.js 也不可用 → nextSource 回退到下一片源（最终落到本地 MP4）
  if(v.canPlayType('application/vnd.apple.mpegurl')){
    setDiag('hls', 'native');
    v.src = url; v.load(); playVideo();
    setTimeout(function(){
      if(!alive()) return;
      if(els.video.readyState < 2 || els.video.error){   // 原生宣称支持却没出画面
        destroyHls();
        v.removeAttribute('src'); v.load();
        useHlsJs();
      }
    }, 2600);
    return;
  }
  useHlsJs();
}
/* ---- 自适应流畅播放（适配所有架构电脑 / 开发板）----
   按 CPU 核数、内存、是否 ARM、屏幕尺寸自动分档：弱机用短缓冲、低起始码率、禁止后台 Worker；
   强机用长缓冲与高码率。卡顿时自动降一级码率，连续卡顿自动切备用源。
   hls.js 不认识的配置项会被忽略，因此同一份配置可兼容不同版本组件。 */
var KH_PLAYER_OVERRIDE = null;   // 由 /api/delivery/plan 自动下发并随发版更新
/* 兼容播放模式（#64）：弱机 / 老显卡 / 集显出现花屏、卡顿、解码崩溃时开启。
   说明：纯网页 / WebView 无法强制切换系统的硬解 / 软解后端，本开关能做的是——
   关闭 hls.js 解码 Worker、从最低码率起步、收紧缓冲并优先走 MSE 播放路径，
   以降低高码率硬解压力；若仍崩溃，属于系统解码后端问题，需在桌面端用 soft-gpu 退路。 */
function khCompatMode(){
  try{ return Number(getStore('kh_compat_mode', 0)) === 1; }catch(e){ return false; }
}
var KH_MEM_TIERS = {
  tiny:   { maxBufferLength:4,  maxMaxBufferLength:8,  maxBufferSize:6*1000*1000,  backBufferLength:5,  startLevel:0,  enableWorker:false, capLevel:0,  estimate:300000,  guardMs:30000 },
  low:    { maxBufferLength:6,  maxMaxBufferLength:12, maxBufferSize:10*1000*1000, backBufferLength:10, startLevel:0,  enableWorker:false, capLevel:1,  estimate:450000,  guardMs:25000 },
  medium: { maxBufferLength:12, maxMaxBufferLength:24, maxBufferSize:24*1000*1000, backBufferLength:20, startLevel:-1, enableWorker:true,  capLevel:-1, estimate:800000,  guardMs:20000 },
  high:   { maxBufferLength:30, maxMaxBufferLength:60, maxBufferSize:60*1000*1000, backBufferLength:30, startLevel:-1, enableWorker:true,  capLevel:-1, estimate:1200000, guardMs:20000 }
};
/* 内存来源优先级：下发链接 ?mem= > 本地档位覆盖 > 浏览器 deviceMemory。
   拿不到 deviceMemory 的设备按 4GB 常规档处理，绝不因探测失败就按高内存放开缓冲。 */
function khMemGB(){
  try{
    var q = /(?:^|[?&])mem=([^&]+)/.exec(location.search || '');
    if(q){
      var v = decodeURIComponent(q[1]);
      if(KH_MEM_TIERS[v]) return v === 'tiny' ? 0.5 : (v === 'low' ? 1.5 : (v === 'medium' ? 3 : 8));
      var n = parseFloat(v);
      if(isFinite(n)) return (/mb/i.test(v) || n > 32) ? n/1024 : n;
    }
    var s = localStorage.getItem('khMemTier');
    if(s && KH_MEM_TIERS[s]) return s === 'tiny' ? 0.5 : (s === 'low' ? 1.5 : (s === 'medium' ? 3 : 8));
  }catch(e){}
  try{ return navigator.deviceMemory || 4; }catch(e2){ return 4; }
}
function khPlayerProfile(){
  try{
    var cores = navigator.hardwareConcurrency || 4;
    var mem = khMemGB();
    var ua = navigator.userAgent || '';
    var arm = /arm64|aarch64|ARM64|Windows ARM/i.test(ua);
    var small = Math.min(window.innerWidth || 1280, window.innerHeight || 720) < 600;
    var memTier = mem <= 1 ? 'tiny' : (mem <= 2 ? 'low' : (mem <= 4 ? 'medium' : 'high'));
    var tier = (cores <= 2 || mem <= 1 || small) ? 'low' : ((cores <= 4 || mem <= 4 || arm) ? 'medium' : 'high');
    return { arch: arm ? 'arm64' : (/\bWin64|x64|x86_64|WOW64/i.test(ua) ? 'x64' : 'ia32-or-unknown'),
      cores: cores, mem: mem, memTier: memTier, tier: tier, weak: memTier !== 'high', os: ua };
  }catch(e){ return { arch:'unknown', cores:4, mem:4, memTier:'medium', tier:'medium', weak:true, os:'' }; }
}
function khHlsConfig(p){
  var t = KH_MEM_TIERS[(p && p.memTier) || 'medium'] || KH_MEM_TIERS.medium;
  var c = {
    enableWorker: t.enableWorker, lowLatencyMode: false,
    backBufferLength: t.backBufferLength,
    maxBufferLength: t.maxBufferLength,
    maxMaxBufferLength: t.maxMaxBufferLength,
    maxBufferSize: t.maxBufferSize,
    capLevelToPlayerSize: true,
    startLevel: t.startLevel,
    autoLevelCapping: t.capLevel,
    abrEwmaDefaultEstimate: t.estimate,
    abrBandWidthFactor: t.capLevel === 0 ? 0.7 : 0.95,
    abrBandWidthUpFactor: t.capLevel === 0 ? 0.5 : 0.7,
    maxLoadingDelay: t.maxBufferLength / 2,
    fragLoadingMaxRetry: 3, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 3,
    fragLoadingTimeOut: t.guardMs > 25000 ? 10000 : 20000,
    manifestLoadingTimeOut: 8000, levelLoadingTimeOut: 10000
  };
  // 兼容模式：关 Worker、最低码率起步、限制最高码率、收紧缓冲，减轻弱机解码压力
  if(khCompatMode()){
    c.enableWorker = false;
    c.startLevel = 0;
    c.autoLevelCapping = 0;
    c.maxBufferLength = Math.min(c.maxBufferLength, 6);
    c.maxMaxBufferLength = Math.min(c.maxMaxBufferLength, 12);
    c.maxBufferSize = Math.min(c.maxBufferSize, 10 * 1000 * 1000);
  }
  if(KH_PLAYER_OVERRIDE){
    for(var k in KH_PLAYER_OVERRIDE) if(Object.prototype.hasOwnProperty.call(KH_PLAYER_OVERRIDE,k) && KH_PLAYER_OVERRIDE[k] !== null) c[k] = KH_PLAYER_OVERRIDE[k];
  }
  return c;
}
window.KHPlayer = {
  profile: khPlayerProfile,
  config: function(){ return khHlsConfig(khPlayerProfile()); },
  current: function(){ return state.hls || null; },
  override: function(o){ KH_PLAYER_OVERRIDE = o || null; return khHlsConfig(khPlayerProfile()); }
};
/* 内存看门狗：堆吃紧或页面进后台时立刻降到最低码率、收紧缓冲上限，必要时暂停分片加载。
   小内存设备因此不会因无限缓冲而卡死；恢复后自动重新加载。 */
function khMemoryGuard(hls, p){
  var cfg = khHlsConfig(p);
  var t = KH_MEM_TIERS[(p && p.memTier) || 'medium'] || KH_MEM_TIERS.medium;
  if(window.__khGuardTimer){ try{ clearInterval(window.__khGuardTimer); }catch(e){} }
  window.__khGuardTimer = setInterval(function(){
    if(state.hls !== hls){ try{ clearInterval(window.__khGuardTimer); }catch(e){} window.__khGuardTimer = 0; return; }
    var press = 0, hidden = false;
    try{ var pm = performance.memory; if(pm && pm.jsHeapSizeLimit) press = pm.usedJSHeapSize / pm.jsHeapSizeLimit; }catch(e){}
    try{ hidden = document.hidden; }catch(e){}
    window.KH_MEM_PRESSURE = press;
    if(press > 0.78 || hidden){
      try{
        if(hls.levels && hls.levels.length) hls.autoLevelCapping = 0;
        if(hls.config) hls.config.maxBufferSize = Math.min(hls.config.maxBufferSize || Infinity, cfg.maxBufferSize);
        if(press > 0.9) hls.stopLoad();
      }catch(e){}
    }else if(press < 0.62){ try{ hls.startLoad(); }catch(e){} }
  }, t.guardMs);
  window.KH_MEMORY_GUARD = { running:true, tier:(p && p.memTier) || 'medium', intervalMs:t.guardMs, maxBufferSize:cfg.maxBufferSize };
}
function startHls(url){
  var p = khPlayerProfile();
  var cfg = khHlsConfig(p);
  var hls;
  try { hls = new window.Hls(cfg); } catch(e){ hls = new window.Hls(); }
  state.hls = hls;
  state.stalls = 0;
  state.qIdx = -1;
  setDiag('hls', 'hlsjs-active');
  hls.loadSource(url);
  hls.attachMedia(els.video);
  hls.on(window.Hls.Events.MANIFEST_PARSED, function(){
    try { if(isFinite(cfg.autoLevelCapping) && cfg.autoLevelCapping >= 0) hls.autoLevelCapping = cfg.autoLevelCapping; } catch(e){}
    try { khRestoreQuality(hls); } catch(e){}
    playVideo();
  });
  hls.on(window.Hls.Events.ERROR, function(_, data){
    if(state.hls !== hls) return;
    if(!data || !data.fatal) return;
    try{ state.lastHlsErr = String(data.type || ''); }catch(e){}
    // 网络 / 解码错误先自动降档恢复，不立刻换台；连续失败才切备用源
    if(state.stalls < 2 && (data.type === window.Hls.ErrorTypes.NETWORK_ERROR || data.type === window.Hls.ErrorTypes.MEDIA_ERROR)){
      state.stalls++;
      try {
        if(data.type === window.Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError(); else hls.startLoad();
        var lv = hls.levels || [];
        var cap = (typeof hls.autoLevelCapping === 'number' && hls.autoLevelCapping >= 0) ? hls.autoLevelCapping : Math.max(0, lv.length - 1);
        hls.autoLevelCapping = Math.max(0, cap - 1);
        if(state.playStats) state.playStats.downgrades++;
        khNotifyAutoDown();
        return;
      }catch(e){}
    }
    destroyHls(); nextSource();
  });
  // 卡顿自适应：降一级码率；累计 3 次仍卡则自动切下一路片源
  var onStall = function(){
    if(state.hls !== hls) return;
    state.stalls++;
    khShowBuffering('缓冲中…');
    try {
      var lv = hls.levels || [];
      if(lv.length > 1){
        var cap = (typeof hls.autoLevelCapping === 'number' && hls.autoLevelCapping >= 0) ? hls.autoLevelCapping : lv.length - 1;
        hls.autoLevelCapping = Math.max(0, cap - 1);
        if(state.playStats) state.playStats.downgrades++;
        khNotifyAutoDown();
      }
    }catch(e){}
    if(state.stalls >= 3){ destroyHls(); nextSource(); }
  };
  state.hlsStallHandler = onStall;
  try { els.video.addEventListener('waiting', onStall); els.video.addEventListener('stalled', onStall); }catch(e){}
  khMemoryGuard(hls, p);
}
/* ---- 片源卡住看门狗 ----
   在线源「连得上但既不报错也不出画面」时，原生 HLS 超时分支与 hls.js 的 fatal ERROR
   都可能不触发，播放器会永久转圈（这正是「点开看不了」的根因）。
   给每次 loadSource 挂一个带 token 的超时器：在线源 6.5s / 本地备用源 4s 内
   若 readyState<2 或 videoWidth=0，就强制 nextSource 切下一路直播源。
   起播(playing)、切台(openPlayer)、关播放器(closePlayer)都会作废计时器，避免误切。 */
function clearWatchdog(){
  if(state.watchdogTimer){ clearTimeout(state.watchdogTimer); state.watchdogTimer = 0; }
  state.watchdogToken++;
}
function armWatchdog(s){
  clearWatchdog();
  var token = ++state.watchdogToken;
  var limit = s && s.local ? 4000 : khTune().watchdogMs;
  state.watchdogTimer = setTimeout(function(){
    if(!state.movie || token !== state.watchdogToken) return;
    var v = els.video;
    if(v.readyState >= 2 && v.videoWidth > 0) return;   // 已有画面，无需回退
    state.watchdogFired++;
    setDiag('watchdog', state.watchdogFired);
    khShowBuffering('重连中…（超时第 ' + state.watchdogFired + ' 次）');
    toast('片源加载超时，已自动切换下一路');
    nextSource();
  }, limit);
}
/* 失败原因分级：把「全部片源暂不可用」拆成可行动的错误码提示。
   依据：MediaError.code / navigator.onLine / 看门狗超时次数 / 最近一次 HLS fatal 类型 */
function failReasonText(){
  var v = els.video;
  var code = state.lastVideoErr || (v && v.error ? v.error.code : 0);
  if(typeof navigator !== 'undefined' && navigator.onLine === false) return 'E-OFFLINE · 本机已断网：先恢复网络连接，再点重试';
  if(code === 1) return 'E-ABORT · 播放被中断（页面切换或线路中止）：点重试继续播放';
  if(code === 2) return 'E-NET · 网络错误（线路连不上或被中断）：点重试，或换一条线路 / 换个频道';
  if(code === 3) return 'E-DECODE · 解码失败（本机不支持该编码）：点重试会自动尝试其他线路；低配设备建议看标清源';
  if(code === 4) return 'E-SRC · 片源无效或格式不支持（404 / 非视频内容）：这条线路大概率已失效，建议换台并等中枢换源';
  if(state.lastHlsErr === 'networkError') return 'E-HLS-NET · 直播分片拉取失败：源站不稳定，点重试或换台';
  if(state.lastHlsErr === 'mediaError') return 'E-HLS-MEDIA · 分片解码异常：点重试自动降档恢复';
  if(state.watchdogFired > 0) return 'E-TIMEOUT · 全部线路加载超时：网络慢或源站限速，点重试，或稍后再看';
  return 'E-UNKNOWN · 全部线路失败：点重试；反复失败请换台，中枢会自动收到失败上报并换源';
}
/* 续播二选一：有历史进度时先问继续还是从头，不直接跳进度 */
function showResumePrompt(saved){
  if(!els.msg) return;
  els.msg.innerHTML = '上次看到 ' + fmtTime(saved) +
    ' <button class="cbtn" data-resume="continue" style="margin-left:8px">▶ 继续观看</button>' +
    ' <button class="cbtn" data-resume="restart">⏮ 从头播放</button>';
  els.msg.classList.add('show');
}
function khResumePlay(choice){
  if(els.msg){ els.msg.classList.remove('show'); els.msg.innerHTML = ''; }
  if(choice === 'continue' && state.resumePos > 0){
    try{ els.video.currentTime = state.resumePos; }catch(e){}
    toast('已从 ' + fmtTime(state.resumePos) + ' 继续');
  }else{
    try{ els.video.currentTime = 0; }catch(e){}
  }
  state.resumePos = 0;
}
function showAllFailed(){
  els.msg.innerHTML = esc(failReasonText()) +
    ' <button class="cbtn" data-retry="1" style="margin-left:8px">↻ 重试全部线路</button>';
  setDiag('state','error');
  setSrcLabel('片源不可用');
  khHideBuffering();
}
function retryAllSources(){
  if(!state.movie) return;
  state.failedSrc = {};
  state.failKey = '';
  state.lastHlsErr = '';
  state.lastVideoErr = 0;
  state.watchdogFired = 0;
  toast('重新尝试全部线路…');
  loadSource(0);
}
function nextSource(){
  if(!state.movie) return;
  // 每个片源只允许触发一次回退，避免 video error 与 HLS fatal 双重触发跳级
  var key = state.movie.id + '|' + state.srcIndex;
  if(state.failKey === key) return;
  state.failKey = key;
  state.failedSrc[state.srcIndex] = true;
  var srcs = currentSources(state.movie);
  if(state.movie.live && srcs[state.srcIndex] && srcs[state.srcIndex].url) markSrc(srcs[state.srcIndex].url, false);
  if(state.srcIndex + 1 < srcs.length){
    if(state.playStats) state.playStats.sourceSwitches++;
    khShowBuffering('正在切换线路 ' + (state.srcIndex + 2) + '/' + srcs.length + '…');
    toast('片源不可用，自动切换 ' + srcs[state.srcIndex+1].label);
    loadSource(state.srcIndex + 1);
  } else {
    showAllFailed();
    khPlayReport(khVideoCatalogId(state.movie), 'fail', 'all-sources-failed');   // 回传中枢自动建单换源
  }
}
function closePlayer(){
  clearWatchdog();
  /* 关闭播放器时卸掉字幕：清定时器、清层、复位按钮，避免字幕串到下一部片 */
  try{
    if(KH_SUB.timer){ clearInterval(KH_SUB.timer); KH_SUB.timer = null; }
    KH_SUB.cues = [];
    var _sl = document.getElementById('subLayer'); if(_sl) _sl.innerHTML = '';
    var _sb = document.getElementById('btnSubtitle'); if(_sb) _sb.textContent = '📝 字幕';
  }catch(e){}
  saveProgress(true);
  destroyHls();
  els.video.pause();
  els.video.removeAttribute('src');
  els.video.load();
  els.player.classList.remove('show');
  els.player.classList.remove('live-mode');
  try{ els.player.style.setProperty('--brand', ''); els.player.style.setProperty('--brand2', ''); }catch(e){}
  els.liveBar.classList.remove('show');
  els.tap.classList.remove('show');
  khHideBuffering();
  try{ if(document.fullscreenElement) document.exitFullscreen(); }catch(e){}
  state.movie = null;
  render();
}
function saveProgress(force){
  if(!state.movie || state.movie.custom || state.movie.live) return;
  var t = els.video.currentTime;
  if(!isFinite(t) || t <= 0) return;
  var now = Date.now();
  if(!force && now - state.lastSave < 4000) return;
  state.lastSave = now;
  var p = getProgress();
  p[state.movie.id] = Math.floor(t);
  khTrimProgress(p, KH_PROG_CAP);
  setStore('kh_prog', p);
}
function seekBy(delta){
  var v = els.video;
  if(!isFinite(v.duration) || v.duration <= 0) return;
  v.currentTime = Math.max(0, Math.min(v.duration - 0.2, v.currentTime + delta));
  syncSeek();
}
function seekToPct(pct){
  var v = els.video;
  if(!isFinite(v.duration) || v.duration <= 0) return;
  v.currentTime = Math.max(0, Math.min(v.duration - 0.2, v.duration * pct));
  syncSeek();
}
function syncSeek(){
  var v = els.video;
  var d = isFinite(v.duration) ? v.duration : 0;
  if(!state.seekDragging){
    els.seek.value = String(d > 0 ? (v.currentTime / d) * 100 : 0);
  }
  els.timeText.textContent = fmtTime(v.currentTime) + ' / ' + fmtTime(d);
  if(d > 0 && isFinite(d) && v.buffered && v.buffered.length){
    var bufEnd = v.buffered.end(v.buffered.length - 1);
    var bufPct = Math.min(100, Math.round(bufEnd / d * 100));
    els.timeText.textContent += ' · 缓冲 ' + bufPct + '%';
  }
}
/* 缓冲遮罩：统一文案与显隐；text 为空时保留现有文案 */
function khShowBuffering(text){
  if(!els.buffering) return;
  if(text) els.buffering.textContent = text;
  els.buffering.classList.add('show');
}
function khHideBuffering(){
  if(els.buffering) els.buffering.classList.remove('show');
}
/* 响度均衡（#65）：WebAudio 压缩器把不同片源的高峰压下来、低响度抬上去，拉平音量差距。
   风险：跨源且无 CORS 的片源接入 MediaElementSource 后会被浏览器静音——
   因此建图失败或运行期探测到静音时，自动断开回退到 video.volume 直挂，绝不强行静音。 */
function khLoudnessEq(){
  try{ return Number(getStore('kh_loudness_eq', 0)) === 1; }catch(e){ return false; }
}
function khAudioCtx(){ var AC = window.AudioContext || window.webkitAudioContext; return AC || null; }
function khEnsureAudioGraph(){
  if(state.audioGraph) return state.audioGraph;
  var AC = khAudioCtx();
  if(!AC || !els.video) return null;
  try{
    var ctx = new AC();
    var source = ctx.createMediaElementSource(els.video);
    var gain = ctx.createGain();
    var comp = ctx.createDynamicsCompressor();
    var analyser = ctx.createAnalyser();
    comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.24;
    source.connect(gain); gain.connect(comp); comp.connect(analyser); analyser.connect(ctx.destination);
    state.audioGraph = { ctx: ctx, source: source, gain: gain, comp: comp, analyser: analyser, degraded:false };
    khApplyAudioVolume();
    khScheduleSilenceProbe();
    return state.audioGraph;
  }catch(e){
    state.audioGraph = null;
    return null;
  }
}
/* 静音探测：接 WebAudio 后采样短时电平，若视频未静音却几乎无输出，判定跨源被静音，自动回退直挂 */
function khScheduleSilenceProbe(){
  var g = state.audioGraph; if(!g) return;
  var t0 = Date.now();
  var timer = setInterval(function(){
    try{
      if(state.audioGraph !== g){ clearInterval(timer); return; }
      if(els.video.paused || els.video.readyState < 2){ if(Date.now() - t0 < 6000) return; clearInterval(timer); return; }
      var buf = new Uint8Array(g.analyser.fftSize);
      g.analyser.getByteTimeDomainData(buf);
      var sum = 0;
      for(var i=0;i<buf.length;i++){ var v=(buf[i]-128)/128; sum += v*v; }
      var rms = Math.sqrt(sum/buf.length);
      if(!els.video.muted && state.userVolume > 0 && rms < 0.01){
        clearInterval(timer);
        khSetLoudnessEq(false);
        toast('当前片源跨源受限，响度均衡已自动回退为原音量');
        return;
      }
      clearInterval(timer);
    }catch(e){ clearInterval(timer); }
  }, 1200);
}
function khApplyAudioVolume(){
  var g = state.audioGraph;
  if(g){
    var eff = state.userMuted ? 0 : state.userVolume;
    try{ g.gain.gain.setTargetAtTime(eff, g.ctx.currentTime, 0.02); }catch(e){ g.gain.gain.value = eff; }
    // MediaElementSource 接管后由 gain 决定输出，video.volume 置 1 避免双重衰减
    els.video.volume = 1; els.video.muted = false;
  }else{
    els.video.volume = state.userVolume;
    els.video.muted = state.userMuted;
  }
}
function khSetLoudnessEq(on){
  state.loudnessEq = on;
  if(on){
    var g = khEnsureAudioGraph();
    if(!g){
      state.loudnessEq = false;
      try{ setStore('kh_loudness_eq', 0); }catch(e){}
      toast('当前环境不支持响度均衡，已保持原音量');
      return;
    }
    try{ setStore('kh_loudness_eq', 1); }catch(e){}
    toast('已开启响度均衡：自动拉平不同片源音量');
  }else{
    try{
      if(state.audioGraph){
        state.audioGraph.source.disconnect(); state.audioGraph.gain.disconnect();
        state.audioGraph.comp.disconnect(); state.audioGraph.analyser.disconnect();
      }
    }catch(e){}
    try{ if(state.audioGraph && state.audioGraph.ctx && state.audioGraph.ctx.state === 'running') state.audioGraph.ctx.suspend(); }catch(e){}
    state.audioGraph = null;
    try{ setStore('kh_loudness_eq', 0); }catch(e){}
    toast('已关闭响度均衡');
  }
  khApplyAudioVolume();
}
function applyVolume(val, fromUser){
  val = Math.max(0, Math.min(1, val));
  if(fromUser){
    state.userVolume = val;
    if(val > 0){ state.userMuted = false; }
    try{ setStore('kh_vol', val); if(val > 0) setStore('kh_mute', 0); }catch(e){}
  }
  khApplyAudioVolume();
  els.vol.value = String(val);
  els.btnMute.textContent = state.userMuted || val === 0 ? '🔇' : '🔊';
  els.btnMute.classList.toggle('on', state.userMuted);
  setDiag('volume', val.toFixed(2));
  setDiag('muted', state.userMuted ? 1 : 0);
}
function toggleMute(){
  state.userMuted = !state.userMuted;
  try{ setStore('kh_mute', state.userMuted ? 1 : 0); }catch(e){}
  applyVolume(state.userVolume, false);
  toast(state.userMuted ? '已静音' : '已恢复声音');
}
function cycleRate(){
  var i = RATES.indexOf(state.rate);
  state.rate = RATES[(i + 1) % RATES.length];
  els.video.playbackRate = state.rate;
  els.btnRate.textContent = state.rate.toFixed(2).replace(/0$/, '') + '×';
  els.btnRate.classList.toggle('on', state.rate !== 1);
  setDiag('rate', state.rate);
  try{ setStore('kh_rate', state.rate); }catch(e){}   // 记住上次倍速
  toast('倍速 ' + state.rate + '×');
}
/* 稍后再看：本地片单（kh_watchlater，最多 50 部），收藏页顶部展示，不依赖账号 */
function getWatchLater(){ return strArray('kh_watchlater'); }
function toggleWatchLater(){
  if(!state.movie || state.movie.live){ toast('直播频道不支持稍后再看'); return; }
  var id = state.movie.id;
  var list = getWatchLater();
  var i = list.indexOf(id);
  if(i >= 0){ list.splice(i, 1); toast('已从稍后再看移除'); }
  else { list.unshift(id); list = list.slice(0, 50); toast('已加入稍后再看（收藏页可见）'); }
  setStore('kh_watchlater', list);
  var b = document.getElementById('btnWatchLater');
  if(b) b.textContent = (list.indexOf(id) >= 0 ? '⏰ 已加入' : '⏰ 稍后看');
}

/* ---- 卡片 / 频道级通用操作（右键菜单与快捷入口共用，按 id 不依赖当前播放项） ---- */
function khMovieFirstUrl(m){
  if(!m) return '';
  if(m.sources && m.sources[0]) return m.sources[0].url || '';
  return m.url || '';
}
function khLiveById(id){
  var all = allLiveChannels();
  for(var i=0;i<all.length;i++){ if(all[i].id === id) return all[i]; }
  return null;
}
function khToggleFavId(id){
  var m = findMovie(id); if(!m) return;
  var fav = getFav(), i = fav.indexOf(id);
  if(i >= 0){ fav.splice(i,1); toast('已取消收藏'); } else { fav.unshift(id); fav = fav.slice(0, KH_FAV_CAP); toast('已加入收藏'); }
  setStore('kh_fav', fav);
  posterCache = {}; render();
}
function khToggleWatchLaterId(id){
  var m = findMovie(id); if(!m) return;
  if(m.live){ toast('直播频道不支持稍后再看'); return; }
  var list = getWatchLater(), i = list.indexOf(id);
  if(i >= 0){ list.splice(i,1); toast('已从稍后再看移除'); } else { list.unshift(id); list = list.slice(0, KH_WL_CAP); toast('已加入稍后再看（收藏页可见）'); }
  setStore('kh_watchlater', list);
  posterCache = {}; render();
}
function khCopyText(text, label){
  var ok = false;
  try{ if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(text).catch(function(){}); ok = true; } }catch(e){}
  toast(ok ? '已复制' + (label || '链接') : '复制失败，请长按条目手动复制');
}
/* ---- 右键上下文菜单 ---- */
var khCtxData = null, khCtxIdx = -1;
function khCloseCtxMenu(){
  var box = document.getElementById('khCtxMenu');
  if(box) box.classList.remove('show');
  khCtxData = null; khCtxIdx = -1;
}
function khCtxEnabledIdxes(){
  var out = [];
  (khCtxData || []).forEach(function(it, i){ if(it && !it.sep && !it.disabled) out.push(i); });
  return out;
}
function khCtxRun(it){
  if(!it || it.disabled) return;
  if(it.act === 'open'){ if(it.__m) openPlayer(it.__m); else if(it.__lv) openLiveChannel(it.__lv); }
  else if(it.act === 'fav'){ if(it.__m) khToggleFavId(it.__m.id); else if(it.__lv) toggleLiveFav(it.__lv.id); }
  else if(it.act === 'watchlater'){ if(it.__m) khToggleWatchLaterId(it.__m.id); }
  else if(it.act === 'copy'){ khCopyText(it.__m ? khMovieFirstUrl(it.__m) : ((it.__lv && it.__lv.sources && it.__lv.sources[0]) ? it.__lv.sources[0].url : ''), '链接'); }
}
function khCtxHighlight(idx){
  khCtxIdx = idx;
  var box = document.getElementById('khCtxMenu');
  if(!box) return;
  box.querySelectorAll('[data-cm]').forEach(function(r){ r.classList.toggle('cm-on', parseInt(r.getAttribute('data-cm'), 10) === idx); });
}
function khOpenCtxMenu(x, y, items){
  var box = document.getElementById('khCtxMenu');
  if(!box) return;
  khCtxData = items;
  var en = khCtxEnabledIdxes();
  khCtxIdx = en.length ? en[0] : -1;
  box.innerHTML = items.map(function(it, idx){
    if(it.sep) return '<div class="cm-sep"></div>';
    var dis = it.disabled ? ' cm-off' : '';
    var on = idx === khCtxIdx ? ' cm-on' : '';
    return '<div class="cm-item' + dis + on + '" data-cm="' + idx + '">' + it.icon + ' ' + esc(it.label) + '</div>';
  }).join('');
  box.classList.add('show');
  var w = box.offsetWidth, h = box.offsetHeight;
  var left = Math.min(x, window.innerWidth - w - 8);
  var top = Math.min(y, window.innerHeight - h - 8);
  box.style.left = Math.max(8, left) + 'px';
  box.style.top = Math.max(8, top) + 'px';
}
document.addEventListener('contextmenu', function(e){
  var card = e.target.closest && e.target.closest('.card[data-id]');
  var ch = e.target.closest && e.target.closest('.ch-card[data-id]');
  if(card){
    var m = findMovie(card.getAttribute('data-id'));
    if(!m){ khCloseCtxMenu(); return; }
    e.preventDefault();
    var fav = getFav().indexOf(m.id) >= 0;
    var wl = getWatchLater().indexOf(m.id) >= 0;
    var url = khMovieFirstUrl(m);
    khCtxData = [{icon:'▶', label:'打开播放', act:'open', __m:m},
      {sep:true},
      {icon: fav ? '★' : '☆', label: fav ? '取消收藏' : '收藏', act:'fav', __m:m},
      {icon:'⏰', label: wl ? '从稍后看移除' : '加入稍后看', act:'watchlater', __m:m},
      {sep:true},
      {icon:'⧉', label:'复制链接', act:'copy', disabled: !url, __m:m}];
    khOpenCtxMenu(e.clientX, e.clientY, khCtxData);
  } else if(ch){
    var lv = khLiveById(ch.getAttribute('data-id'));
    if(!lv){ khCloseCtxMenu(); return; }
    e.preventDefault();
    var lf = getLiveFav().indexOf(lv.id) >= 0;
    var lur = (lv.sources && lv.sources[0]) ? lv.sources[0].url : '';
    khCtxData = [{icon:'▶', label:'打开频道', act:'open', __lv:lv},
      {sep:true},
      {icon: lf ? '★' : '☆', label: lf ? '取消收藏频道' : '收藏频道', act:'fav', __lv:lv},
      {sep:true},
      {icon:'⧉', label:'复制频道链接', act:'copy', disabled: !lur, __lv:lv}];
    khOpenCtxMenu(e.clientX, e.clientY, khCtxData);
  } else {
    khCloseCtxMenu();
  }
});
document.addEventListener('click', function(e){
  var box = document.getElementById('khCtxMenu');
  if(!box || !box.classList.contains('show')) return;
  var row = e.target.closest && e.target.closest('[data-cm]');
  if(row){
    e.stopPropagation();
    var it = khCtxData ? khCtxData[parseInt(row.getAttribute('data-cm'), 10)] : null;
    if(!it || it.disabled){ khCloseCtxMenu(); return; }
    khCtxRun(it);
    khCloseCtxMenu();
    return;
  }
  khCloseCtxMenu();
});
document.addEventListener('keydown', function(e){
  var box = document.getElementById('khCtxMenu');
  if(!box || !box.classList.contains('show')) return;
  if(e.key === 'Escape'){ khCloseCtxMenu(); return; }
  var en = khCtxEnabledIdxes();
  if(!en.length) return;
  var pos = en.indexOf(khCtxIdx);
  if(e.key === 'ArrowDown'){ e.preventDefault(); khCtxHighlight(en[(pos + 1) % en.length]); }
  else if(e.key === 'ArrowUp'){ e.preventDefault(); khCtxHighlight(en[(pos - 1 + en.length) % en.length]); }
  else if(e.key === 'Enter'){ e.preventDefault(); khCtxRun(khCtxData[khCtxIdx]); khCloseCtxMenu(); }
});
window.addEventListener('scroll', function(){ khCloseCtxMenu(); }, true);

/* ---------------- 追剧订阅（本机维度；不接账号、不跨端续播） ---------------- */
/* 本机缓存 id 列表 + 服务端本机记录；片单快照变化时标「有更新」，不代表官方新集上线。 */
function getWatchSub(){ return strArray('kh_watchlist'); }
function isSubbed(id){ return getWatchSub().indexOf(id) >= 0; }
function watchSubMeta(){ return plainObject('kh_watchlist_meta'); }
function subSnapshot(m){
  return { id: m.id, title: m.title, category: m.category || '',
    episodes: String(m.year || ''), status: m.rating ? String(m.rating) : '' };
}
function syncWatchSub(action, m){
  var dev = issueDeviceId();
  var body = action === 'add' ? Object.assign({ deviceId: dev }, subSnapshot(m)) : { deviceId: dev, id: m.id };
  khFetch('/api/watchlist/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store' }).catch(function(){});
}
function toggleWatchSub(){
  if(!state.movie || state.movie.live){ toast('直播频道不支持追剧订阅'); return; }
  var m = state.movie, id = m.id;
  var list = getWatchSub(), i = list.indexOf(id);
  if(i >= 0){
    list.splice(i, 1); setStore('kh_watchlist', list); syncWatchSub('remove', m);
    var meta = watchSubMeta(); delete meta[id]; setStore('kh_watchlist_meta', meta);
    toast('已取消追剧订阅');
  } else {
    list.unshift(id); list = list.slice(0, 200); setStore('kh_watchlist', list); syncWatchSub('add', m);
    var meta2 = watchSubMeta(); meta2[id] = { updated: false, title: m.title }; setStore('kh_watchlist_meta', meta2);
    toast('已加入追剧订阅（本机记录）');
  }
  var b = document.getElementById('btnWatchSub');
  if(b) b.textContent = (list.indexOf(id) >= 0 ? '⭐ 已订阅' : '⭐ 追剧');
}
/* 从服务端拉回本机订阅记录（合并本机缓存；读取失败保留本机缓存） */
function refreshWatchSubFromServer(){
  khFetch('/api/watchlist?deviceId=' + encodeURIComponent(issueDeviceId()), { cache: 'no-store' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(!d || !Array.isArray(d.items)) return;
      var local = getWatchSub(), meta = watchSubMeta();
      d.items.forEach(function(x){
        if(!x || !x.id) return;
        if(local.indexOf(x.id) < 0) local.push(x.id);
        meta[x.id] = { updated: !!x.updated, title: x.title || (meta[x.id] && meta[x.id].title) || '' };
      });
      setStore('kh_watchlist', local); setStore('kh_watchlist_meta', meta);
    }).catch(function(){});
}
/* 进入收藏页 / 定时比对：把当前片单快照上报服务端，由其标记快照变化 */
function checkWatchSub(){
  var cur = allMovies().map(function(m){ return { id: m.id, episodes: String(m.year || ''), status: m.rating ? String(m.rating) : '' }; });
  khFetch('/api/watchlist/check', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: issueDeviceId(), current: cur }), cache: 'no-store' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(!d || !Array.isArray(d.items)) return;
      var meta = watchSubMeta();
      d.items.forEach(function(x){ if(x && x.id) meta[x.id] = { updated: !!x.updated, title: x.title || '' }; });
      setStore('kh_watchlist_meta', meta);
    }).catch(function(){});
}

/* ---------------- 更新通道（稳定 / 内测；内测未配版本时如实回退稳定） ---------------- */
function getChannelCfg(){ return plainObject('kh_channel'); }
function refreshChannel(){
  khFetch('/api/channel', { cache: 'no-store' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(!d || !d.ok) return;
      var cur = getChannelCfg();
      cur.active = d.active || 'stable'; cur.betaVersion = d.betaVersion || null;
      cur.note = d.note || ''; cur.channels = d.channels || null;
      setStore('kh_channel', cur);
    }).catch(function(){});
}
/* 本机所选通道优先；未选则用服务端下发默认。beta 无内测版本时按稳定清单比对。 */
function effectiveChannel(){
  var cur = getChannelCfg();
  var local = ''; try { local = String(localStorage.getItem('kh_channel_pick') || ''); } catch(e) {}
  var active = local || cur.active || 'stable';
  if(active === 'beta' && !cur.betaVersion) return { active: 'stable', betaFallback: true, note: cur.note || '内测版本未配置，当前回退稳定通道' };
  return { active: active, betaFallback: false, note: cur.note || '' };
}

/* 按有效通道选取版本清单：内测通道且存在真实 beta 清单才用 beta，否则回退稳定 latest。
   beta 未配置时不编造内测包，比对目标仍为稳定清单。 */
function khReleaseTarget(release, ch){
  release = release || {};
  if(ch && ch.active === 'beta' && release.beta && Number(release.beta.versionCode)){
    return { rel: release.beta, channel: 'beta' };
  }
  return { rel: release.latest || release.stable || null, channel: 'stable' };
}

/* ---------------- 云端推荐位拉取（未配置则客户端回退内置片单） ---------------- */
function refreshPromo(){
  khFetch('/api/promo', { cache: 'no-store' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(!d || !d.ok || !d.enabled || !Array.isArray(d.items) || !d.items.length){ setStore('kh_promo', null); return; }
      setStore('kh_promo', { enabled: true, title: d.title, subtitle: d.subtitle, items: d.items });
    }).catch(function(){ setStore('kh_promo', null); });
}
/* HLS 清晰度：手动切换档位（-1 = 自动）；单码率或原生 HLS 时如实提示；选择持久化到本机 */
function cycleQuality(){
  var h = state.hls;
  if(!h || !h.levels || h.levels.length <= 1){ toast('当前片源只有一档清晰度（或非 HLS），无法切换'); return; }
  var n = h.levels.length;
  state.qIdx = (state.qIdx + 2) % (n + 1) - 1;   // -1(自动) → 0 → 1 → … → n-1 → -1
  try{ h.currentLevel = state.qIdx; }catch(e){}
  var label = state.qIdx < 0 ? '自动' : ((h.levels[state.qIdx].height || (state.qIdx + 1)) + (h.levels[state.qIdx].height ? 'p' : ' 档') + khLevelBitrate(h.levels[state.qIdx]));
  if(els.btnQuality) els.btnQuality.textContent = '🎚 ' + label;
  try{ setStore('kh_quality', state.qIdx); }catch(e){}   // 记住上次清晰度档位（-1 = 自动）
  toast('清晰度：' + label + '（共 ' + n + ' 档）');
}
/* 档位码率文案：Mbps / kbps */
function khLevelBitrate(lv){
  if(!lv || !lv.bitrate) return '';
  var mb = lv.bitrate / 1000000;
  return ' · ' + (mb >= 1 ? mb.toFixed(1) + 'Mbps' : Math.round(lv.bitrate / 1000) + 'kbps');
}
/* 手动降一档：弱网/卡顿时主动往低码率切；自动档时从当前播放档起步 */
function khDowngradeLevel(){
  var h = state.hls;
  if(!h || !h.levels || h.levels.length <= 1){ toast('当前只有一档清晰度（或非 HLS），无法降档'); return; }
  var n = h.levels.length;
  var cur = (typeof h.currentLevel === 'number' && h.currentLevel >= 0) ? h.currentLevel : state.qIdx;
  if(cur < 0) cur = 0;
  var next = Math.min(cur + 1, n - 1);
  state.qIdx = next;
  try{ h.currentLevel = next; }catch(e){}
  if(state.playStats) state.playStats.downgrades++;
  var lv = h.levels[next] || {};
  var label = (lv.height || (next + 1)) + (lv.height ? 'p' : ' 档') + khLevelBitrate(lv);
  if(els.btnQuality) els.btnQuality.textContent = '🎚 ' + label;
  try{ setStore('kh_quality', next); }catch(e){}
  toast('已降到 ' + label + '（' + (next + 1) + '/' + n + '）');
}
/* 自动降档可见提示：3 秒内不重复刷屏 */
function khNotifyAutoDown(){
  var now = Date.now();
  if(state.autoDownAt && now - state.autoDownAt < 3000) return;
  state.autoDownAt = now;
  toast('网络波动，已自动降低一档清晰度');
}
/* 清晰度档位恢复：按本机保存的档位落到当前 manifest 上；越界或无多档则回自动 */
function khRestoreQuality(hls){
  var n = (hls && hls.levels || []).length;
  var q = Number(getStore('kh_quality', -1));
  if(!isFinite(q)) q = -1;
  if(q >= n) q = -1;
  state.qIdx = q;
  try{ hls.currentLevel = q; }catch(e){}
  var bq = els.btnQuality || document.getElementById('btnQuality');
  if(bq){
    var label = q < 0 ? '自动' : ((hls.levels[q].height || (q + 1)) + (hls.levels[q].height ? 'p' : ' 档'));
    bq.textContent = '🎚 ' + label + (n > 1 ? '（' + n + ' 档）' : '');
  }
}
function toggleFullscreen(){
  var wrap = els.videoWrap;
  try{
    if(document.fullscreenElement){ document.exitFullscreen(); }
    else if(wrap.requestFullscreen){ wrap.requestFullscreen(); }
    else if(els.video.webkitEnterFullscreen){ els.video.webkitEnterFullscreen(); }
    else toast('当前环境不支持全屏');
  }catch(e){ toast('全屏不可用'); }
}
/* 画中画：桌面 Electron 的 Chromium 原生支持；开鸿 ArkWeb 若不支持则如实提示 */
function togglePip(){
  var v = els.video;
  try{
    if(document.pictureInPictureElement){ document.exitPictureInPicture(); return; }
    if(v && typeof v.requestPictureInPicture === 'function'){
      v.requestPictureInPicture().then(function(){ toast('已切到画中画'); })
        .catch(function(err){ toast('画中画不可用：' + ((err && err.message) || '当前环境不支持')); });
    } else {
      toast('当前环境不支持画中画');
    }
  }catch(e){ toast('画中画不可用：' + ((e && e.message) || e)); }
}

/* 画面比例：contain 自适应留边 / cover 铺满裁剪 / fill 拉伸铺满；记住上次选择 */
var KH_FIT_MODES = ['contain', 'cover', 'fill'];
var KH_FIT_LABEL = { contain: '自适应', cover: '铺满', fill: '拉伸' };
function khApplyFit(mode){
  if(KH_FIT_MODES.indexOf(mode) < 0) mode = 'contain';
  state.fit = mode;
  try{ els.video.style.objectFit = mode; }catch(e){}
  var b = els.btnFit || document.getElementById('btnFit');
  if(b) b.textContent = '🖍 ' + KH_FIT_LABEL[mode];
}
function cycleFit(){
  var i = KH_FIT_MODES.indexOf(state.fit);
  var next = KH_FIT_MODES[(i + 1 + KH_FIT_MODES.length) % KH_FIT_MODES.length];
  khApplyFit(next);
  try{ setStore('kh_fit', next); }catch(e){}
  toast('画面比例：' + KH_FIT_LABEL[next]);
}
