/* HongHub 前端模块：自建片源 CRUD/网站管理
   由 app/index.html 单文件版拆分（1.7.72 模块化），按 <script> 顺序加载，顶层函数/常量共享全局作用域。 */
/* ---------------- 影视资源配置：自建片源 CRUD + 备份 ---------------- */
function normalizeResUrl(raw){
  var u = String(raw || '').trim();
  if(!u || !/^https?:\/\//i.test(u)) return '';
  return u;
}
function makeRes(title, sub, cat, urls, id){
  var labels = ['在线主源','在线备源','备用线路'];
  var srcs = [];
  for(var i=0;i<urls.length;i++) srcs.push({label:labels[i] || ('备用线路 ' + (i+1)), url:urls[i]});
  return {
    id:id || ('res_' + hashId(title + '|' + urls[0])),
    title:String(title).slice(0,24), subtitle:String(sub || '自建影视资源').slice(0,40),
    year:new Date().getFullYear(), rating:0,
    category:(cat && RES_CATEGORIES.indexOf(cat) >= 0) ? cat : '电影',
    tags:['自建'], desc:'你在「资源配置」里添加的片源，共 ' + urls.length + ' 路，可自动切换。',
    cast:'自建资源', color:'#2A3550', accent:'#5B7BC4', own:true, sources:srcs
  };
}
function addRes(){
  var t = document.getElementById('resTitle'), sub = document.getElementById('resSub'), cat = document.getElementById('resCat');
  var u1 = document.getElementById('resUrl1'), u2 = document.getElementById('resUrl2'), u3 = document.getElementById('resUrl3');
  var title = t ? t.value.trim() : '';
  if(!title){ toast('请填片名'); return; }
  var urls = [], raw = [u1 && u1.value, u2 && u2.value, u3 && u3.value];
  for(var i=0;i<raw.length;i++){
    var u = normalizeResUrl(raw[i]);
    if(u && urls.indexOf(u) < 0) urls.push(u);
  }
  if(!urls.length){ toast('请填至少 1 路 http(s) 视频直链'); return; }
  var list = getRes();
  var item = makeRes(title, sub && sub.value.trim(), cat && cat.value, urls);
  if(state.resEdit >= 0 && state.resEdit < list.length){
    item.id = list[state.resEdit].id;
    list[state.resEdit] = item;
    toast('已保存修改');
  } else {
    list.unshift(item);
    toast('已添加：' + title);
  }
  setStore('kh_vod_res', list.slice(0,50));
  state.resEdit = -1;
  render();
}
function startEditRes(index){
  var list = getRes();
  if(index < 0 || index >= list.length) return;
  var r = list[index];
  state.resEdit = index;
  render();
  var f = {resTitle:r.title, resSub:r.subtitle, resUrl1:'', resUrl2:'', resUrl3:''};
  for(var i=0;i<r.sources.length;i++) f['resUrl' + (i+1)] = r.sources[i].url;
  for(var k in f){ var el = document.getElementById(k); if(el) el.value = f[k]; }
  var c = document.getElementById('resCat'); if(c) c.value = r.category;
  var t = document.getElementById('resTitle'); if(t) t.focus();
  els.main.scrollTop = 0;
}
function moveUpRes(index){
  var list = getRes();
  if(index <= 0 || index >= list.length) return;
  var t = list[index]; list[index] = list[index-1]; list[index-1] = t;
  setStore('kh_vod_res', list);
  if(state.resEdit === index) state.resEdit = index - 1;
  else if(state.resEdit === index - 1) state.resEdit = index;
  render();
}
function delRes(index){
  var list = getRes();
  if(index < 0 || index >= list.length) return;
  var removed = list.splice(index, 1)[0];
  setStore('kh_vod_res', list);
  state.resEdit = -1;
  toast('已删除：' + removed.title, '撤销', function(){ list.splice(index, 0, removed); setStore('kh_vod_res', list); render(); });
  render();
}
function exportRes(){
  var ta = document.getElementById('resBackup');
  if(!ta) return;
  var text = JSON.stringify(getRes());
  ta.value = text; ta.focus(); ta.select();
  try{ if(navigator.clipboard) navigator.clipboard.writeText(text).catch(function(){}); }catch(e){}
  toast('已导出 ' + getRes().length + ' 个自建资源，可复制备份');
}
function importRes(){
  var ta = document.getElementById('resBackup');
  if(!ta || !ta.value.trim()){ toast('请先粘贴备份 JSON'); return; }
  var incoming;
  try{ incoming = JSON.parse(ta.value.trim()); }catch(e){ toast('备份格式不是合法 JSON'); return; }
  if(!Array.isArray(incoming)){ toast('备份应为资源数组'); return; }
  var list = getRes(), added = 0, seen = {};
  for(var i=0;i<list.length;i++) seen[list[i].id] = true;
  for(var k=0;k<incoming.length && list.length < 50;k++){
    var r = incoming[k];
    if(!r || typeof r.title !== 'string') continue;
    var urls = [], ss = Array.isArray(r.sources) ? r.sources : [];
    for(var j=0;j<ss.length;j++){
      var u = normalizeResUrl(ss[j] && ss[j].url ? ss[j].url : ss[j]);
      if(u && urls.indexOf(u) < 0) urls.push(u);
    }
    if(!urls.length) continue;
    var id = (r.id && typeof r.id === 'string' && /^res_[a-z0-9]+$/.test(r.id))
      ? r.id : ('res_' + hashId(r.title + '|' + urls[0]));
    if(seen[id]) continue;
    seen[id] = true;
    list.push(makeRes(r.title, r.subtitle, r.category, urls, id));
    added++;
  }
  setStore('kh_vod_res', list);
  toast('导入完成，新增 ' + added + ' 个资源');
  render();
}
function clearRes(yes){
  if(!yes){ state.resConfirmClear = true; render(); return; }
  setStore('kh_vod_res', []);
  state.resConfirmClear = false;
  state.resEdit = -1;
  toast('已清空全部自建影视资源');
  render();
}
function clearFav(yes){
  if(!yes){ state.favConfirmClear = true; render(); return; }
  setStore('kh_fav', []);
  state.favConfirmClear = false;
  toast('已清空全部收藏');
  render();
}
function clearHist(yes){
  if(!yes){ state.histConfirmClear = true; render(); return; }
  setStore('kh_hist', []);
  state.histConfirmClear = false;
  toast('已清空观看历史（续播进度已保留）');
  render();
}
function resItem(r, index){
  return '<div class="siteitem">' +
    '<div class="siteico" style="background:' + esc(r.color || '#3B456B') + '">' + esc((r.title || 'R').slice(0,1)) + '</div>' +
    '<div class="sitemeta"><div class="n">' + esc(r.title) + '</div>' +
    '<div class="u">' + esc(r.category) + ' · ' + r.sources.length + ' 路源 · ' + esc(String(r.sources[0].url).slice(0,32)) + '</div></div>' +
    '<button class="siteopen" data-act="res-play" data-id="' + esc(r.id) + '">播放</button>' +
    '<button class="mini" data-act="res-sync" data-index="' + index + '" title="同步到各大平台">⇄</button>' +
    '<button class="mini" data-act="res-up" data-index="' + index + '" title="上移">↑</button>' +
    '<button class="mini" data-act="res-edit" data-index="' + index + '" title="编辑">✎</button>' +
    '<button class="sitedel" data-act="res-del" data-index="' + index + '" title="删除">✕</button>' +
  '</div>';
}
function resAction(act, node){
  if(act === 'res-add') addRes();
  else if(act === 'res-cancel'){ state.resEdit = -1; render(); }
  else if(act === 'res-edit') startEditRes(parseInt(node.getAttribute('data-index'), 10));
  else if(act === 'res-up') moveUpRes(parseInt(node.getAttribute('data-index'), 10));
  else if(act === 'res-del') delRes(parseInt(node.getAttribute('data-index'), 10));
  else if(act === 'res-play'){ var m = findMovie(node.getAttribute('data-id')); if(m) openPlayer(m); }
  else if(act === 'res-sync'){
    var rl = getRes();
    var ri0 = parseInt(node.getAttribute('data-index'), 10);
    if(!isNaN(ri0) && ri0 >= 0 && ri0 < rl.length){
      state.syncTitle = String(rl[ri0].title || '').trim().slice(0, 40);
      toast('已把「' + state.syncTitle + '」填入平台同步');
      render();
      var st0 = document.getElementById('syncTitle');
      if(st0) st0.focus();
    }
  }
  else if(act === 'res-fill'){
    var t = document.getElementById('resTitle'), sb = document.getElementById('resSub'), u = document.getElementById('resUrl1');
    if(t) t.value = '我的短剧'; if(sb) sb.value = '自建示例片源';
    if(u) u.value = 'https://你的视频直链.mp4';
    toast('已填入占位示例，替换成你自己的网址即可');
  }
  else if(act === 'res-export') exportRes();
  else if(act === 'res-import') importRes();
  else if(act === 'res-clear') clearRes(false);
  else if(act === 'res-clear-yes') clearRes(true);
  else if(act === 'res-clear-no'){ state.resConfirmClear = false; render(); }
  else if(act === 'fav-clear') clearFav(false);
  else if(act === 'fav-backup') khExportUserData();
  else if(act === 'fav-restore') khImportUserData();
  else if(act === 'fav-clear-yes') clearFav(true);
  else if(act === 'fav-clear-no'){ state.favConfirmClear = false; render(); }
  else if(act === 'hist-clear') clearHist(false);
  else if(act === 'hist-clear-yes') clearHist(true);
  else if(act === 'hist-clear-no'){ state.histConfirmClear = false; render(); }
}

/* ---------------- 网站管理 ---------------- */
function addSite(){
  var nEl = document.getElementById('siteName');
  var uEl = document.getElementById('siteUrl');
  if(!nEl || !uEl) return;
  var name = nEl.value.trim();
  var url = normalizeSiteUrl(uEl.value);
  if(!name){ toast('请填网站名称'); return; }
  if(!url){ toast('请填合法的 http(s) 网址'); return; }
  var list = getSites();
  for(var i=0;i<list.length;i++){
    if(i !== state.editIndex && list[i].url === url){ toast('这个网址已经在列表里了'); return; }
  }
  for(var j=0;j<BUILTIN_SITES.length;j++){ if(BUILTIN_SITES[j].url === url){ toast('这个网址已在预置列表里'); return; } }
  var gEl = document.getElementById('siteGroup');
  var group = gEl ? gEl.value.trim().slice(0, 10) : '';
  var prev = (state.editIndex >= 0 && list[state.editIndex]) ? list[state.editIndex] : null;
  var item = {name:name.slice(0,20), url:url, color:'#3B456B', tag:name.slice(0,1), group: group || (prev && prev.group) || ''};
  if(prev){
    if(prev.lastAt) item.lastAt = prev.lastAt;
    if(prev.dead) item.dead = prev.dead;
  }
  if(state.editIndex >= 0 && state.editIndex < list.length){
    list[state.editIndex] = item;
    toast('已保存修改');
  } else {
    list.unshift(item);
    toast('已添加：' + name);
  }
  setStore('kh_sites', list.slice(0,50));
  state.editIndex = -1;
  render();
}
/* 批量导入网址：每行一条，自动用域名当名称，重复的跳过 */
function batchAddSites(){
  var ta = document.getElementById('siteBatch');
  var txt = ta ? ta.value : '';
  var gEl = document.getElementById('siteGroup');
  var group = gEl ? gEl.value.trim().slice(0, 10) : '';
  var lines = String(txt || '').split(/\r?\n/).map(function(x){ return x.trim(); }).filter(Boolean);
  if(!lines.length){ toast('请先粘贴网址，每行一条'); return; }
  var list = getSites();
  var have = {};
  list.forEach(function(s){ have[s.url] = 1; });
  BUILTIN_SITES.forEach(function(s){ have[s.url] = 1; });
  var added = 0, skipped = 0;
  for(var i=0;i<lines.length && list.length<50;i++){
    var u = normalizeSiteUrl(lines[i]);
    if(!u){ skipped++; continue; }
    if(have[u]){ skipped++; continue; }
    have[u] = 1;
    var host = hostOf(u);
    list.unshift({name:host.slice(0,20), url:u, color:'#3B456B', tag:host.slice(0,1), group:group || '批量导入'});
    added++;
  }
  setStore('kh_sites', list.slice(0,50));
  toast('已导入 ' + added + ' 个网址' + (skipped ? '，跳过 ' + skipped + ' 个（重复或格式不对）' : ''));
  render();
}
/* 记录「最近打开」：只对自建站点生效 */
function markSiteOpen(url){
  var list = getSites(), changed = false;
  for(var i=0;i<list.length;i++){
    if(list[i].url === url){ list[i].lastAt = Date.now(); changed = true; break; }
  }
  if(changed) setStore('kh_sites', list);
}
/* 自建站点可达性探测：no-cors 只判「能不能连上」，不读内容，结果本机缓存 10 分钟 */
var SITE_PROBE_KEY = 'kh_site_probe';
function probeCustomSites(force){
  var list = getSites();
  if(!list.length) return;
  var cache = getStore(SITE_PROBE_KEY, {}) || {};
  if(!force && cache.at && (Date.now() - cache.at) < 600000) return;
  cache = {at: Date.now(), items: {}};
  setStore(SITE_PROBE_KEY, cache);
  var i = 0;
  function one(){
    if(i >= list.length){ render(); return; }
    var s = list[i++];
    var done = false;
    var ac = null;
    try { ac = (typeof AbortController !== 'undefined') ? new AbortController() : null; } catch(e) {}
    var to = setTimeout(function(){
      if(done) return; done = true;
      if(ac) { try { ac.abort(); } catch(e) {} }
      cache.items[s.url] = 0;
      var cur = getStore(SITE_PROBE_KEY, {}) || {};
      cur.items = cache.items; setStore(SITE_PROBE_KEY, cur);
      one();
    }, 6000);
    try {
      fetch(s.url, { mode: 'no-cors', cache: 'no-store', signal: ac ? ac.signal : undefined })
        .then(function(){
          if(done) return; done = true; clearTimeout(to);
          cache.items[s.url] = 1;
          var cur = getStore(SITE_PROBE_KEY, {}) || {};
          cur.items = cache.items; setStore(SITE_PROBE_KEY, cur);
          one();
        })
        .catch(function(){
          if(done) return; done = true; clearTimeout(to);
          cache.items[s.url] = 0;
          var cur = getStore(SITE_PROBE_KEY, {}) || {};
          cur.items = cache.items; setStore(SITE_PROBE_KEY, cur);
          one();
        });
    } catch(e) { done = true; clearTimeout(to); cache.items[s.url] = 0; one(); }
  }
  one();
}
function siteDead(url){
  var cache = getStore(SITE_PROBE_KEY, {}) || {};
  return (cache.items && cache.items[url] === 0) ? true : false;
}
/* 点播/内置片源可达性探测：只判能否连上，不读内容；结果本机缓存 10 分钟 */
var MOVIE_PROBE_KEY = 'kh_movie_probe';
function probeMovieSources(force){
  var list = allMovies();
  if(!list.length) { toast('没有可探测的片源'); return; }
  var cache = getStore(MOVIE_PROBE_KEY, {}) || {};
  if(!force && cache.at && (Date.now() - cache.at) < 600000) return;
  cache = {at: Date.now(), items: {}};
  setStore(MOVIE_PROBE_KEY, cache);
  var urls = [];
  list.forEach(function(m){ (m.sources || []).forEach(function(s){ if(s && s.url && urls.indexOf(s.url) < 0) urls.push(s.url); }); });
  var i = 0, dead = 0;
  function one(){
    if(i >= urls.length){
      toast('片源巡检完成：' + urls.length + ' 条线路，' + dead + ' 条本机连不上');
      render();
      return;
    }
    var u = urls[i++];
    var done = false;
    var to = setTimeout(function(){ if(done) return; done = true; cache.items[u] = 0; dead++; save(); }, 5000);
    function save(){
      var cur = getStore(MOVIE_PROBE_KEY, {}) || {};
      cur.at = cache.at; cur.items = cache.items; setStore(MOVIE_PROBE_KEY, cur);
      one();
    }
    try {
      fetch(u, { mode: 'no-cors', cache: 'no-store' })
        .then(function(){ if(done) return; done = true; clearTimeout(to); cache.items[u] = 1; save(); })
        .catch(function(){ if(done) return; done = true; clearTimeout(to); cache.items[u] = 0; dead++; save(); });
    } catch(e) { done = true; clearTimeout(to); cache.items[u] = 0; dead++; save(); }
  }
  one();
}
function movieAllDead(m){
  var cache = getStore(MOVIE_PROBE_KEY, {}) || {};
  var items = cache.items || {};
  var srcs = (m && m.sources) || [];
  if(!srcs.length) return false;
  for(var i=0;i<srcs.length;i++){ if(items[srcs[i].url] !== 0) return false; }
  return true;
}
/* 首启声明：第一次运行必须同意条款才能使用；同意时间只存本机（kh_consent）。
   完整条款在「关于」页，这里给可展开摘要，不引用外部链接。 */
function khFirstRunConsent(){
  try{ if(getStore('kh_consent', null)) return; }catch(e){ return; }
  var ov = document.createElement('div');
  ov.id = 'khConsentOverlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(4,9,18,.94);display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto';
  ov.innerHTML =
    '<div style="max-width:600px;width:100%;background:#0E1B2B;border:1px solid #24405F;border-radius:14px;padding:22px 24px;color:#E8F1FF;font-size:14px;line-height:1.7">' +
    '<h2 style="margin:0 0 10px;font-size:18px">欢迎使用鸿汇影 · 首次运行声明</h2>' +
    '<p style="margin:0 0 10px">继续使用前，请阅读并同意以下条款（完整文本在「关于」页可随时查看）：</p>' +
    '<details style="margin:6px 0"><summary style="cursor:pointer;font-weight:700">隐私政策（摘要）</summary>' +
    '<p style="margin:6px 0;color:#9aa6bd">收藏、历史、自建站点与设置仅保存在本机；播放统计只上报资源 ID 与成功/失败结果，不含个人信息、不含观看内容、不含 IP。可在设置页一键清空本机数据。</p></details>' +
    '<details style="margin:6px 0"><summary style="cursor:pointer;font-weight:700">用户协议（摘要）</summary>' +
    '<p style="margin:6px 0;color:#9aa6bd">本应用是播放与导航工具：内置片源为公开授权样本，平台入口跳转各平台官方页面。你添加的片源与站点须自有版权或已获授权，责任由添加者承担。</p></details>' +
    '<details style="margin:6px 0"><summary style="cursor:pointer;font-weight:700">免责声明（摘要）</summary>' +
    '<p style="margin:6px 0;color:#9aa6bd">第三方线路与平台的可用性、内容合法性由其运营方负责；本应用不聚合、不缓存、不破解任何第三方片源，不对第三方内容作担保。</p></details>' +
    '<div style="display:flex;gap:10px;margin-top:16px">' +
    '<button id="khConsentOk" style="flex:1;background:#E23B4E;color:#fff;border:0;border-radius:9px;padding:10px;font-size:14px;cursor:pointer">同意并开始使用</button>' +
    '<button id="khConsentNo" style="background:#1B2C44;color:#9aa6bd;border:1px solid #24405F;border-radius:9px;padding:10px 16px;font-size:14px;cursor:pointer">不同意</button>' +
    '</div><p id="khConsentTip" style="margin:10px 0 0;color:#E7A94C;font-size:13px;display:none">不同意条款将无法使用本应用；你可以关闭页面退出。</p></div>';
  document.body.appendChild(ov);
  document.getElementById('khConsentOk').onclick = function(){
    try{ setStore('kh_consent', { at: new Date().toISOString(), versionCode: (typeof KH_APP_CODE !== 'undefined' ? KH_APP_CODE : 0) }); }catch(e){}
    ov.parentNode.removeChild(ov);
    toast('已记录同意时间（仅存本机），欢迎使用');
  };
  document.getElementById('khConsentNo').onclick = function(){
    document.getElementById('khConsentTip').style.display = 'block';
  };
}
/* 定时关闭：分钟数存在本机，播放开始即计时 */
function armSleepTimer(){
  var min = Number(getStore('kh_sleep_min', 0)) || 0;
  if(state.sleepTimer){ try { clearTimeout(state.sleepTimer); } catch(e) {} state.sleepTimer = null; }
  if(!min) return;
  state.sleepTimer = setTimeout(function(){
    try { els.video.pause(); } catch(e) {}
    toast('定时关闭：已停止播放（' + min + ' 分钟到）');
  }, min * 60000);
}
function delSite(index){
  var list = getSites();
  if(isNaN(index) || index < 0 || index >= list.length) return;
  var removed = list[index];
  var at = index;
  list.splice(index,1);
  setStore('kh_sites', list);
  if(state.editIndex === at) state.editIndex = -1;
  toast('已删除「' + removed.name + '」', '撤销', function(){
    var cur = getSites();
    cur.splice(Math.min(at, cur.length), 0, removed);
    setStore('kh_sites', cur.slice(0,50));
    toast('已恢复「' + removed.name + '」');
    render();
  });
  render();
}
function startEdit(index){
  var list = getSites();
  if(index < 0 || index >= list.length) return;
  state.editIndex = index;
  render();
  var s = list[index];
  var nEl = document.getElementById('siteName'), uEl = document.getElementById('siteUrl');
  var gEl = document.getElementById('siteGroup');
  if(nEl) nEl.value = s.name;
  if(uEl) uEl.value = s.url;
  if(gEl) gEl.value = s.group || '';
  if(nEl) nEl.focus();
  els.main.scrollTop = 0;
}
function moveUp(index){
  var list = getSites();
  if(index <= 0 || index >= list.length) return;
  var t = list[index]; list[index] = list[index-1]; list[index-1] = t;
  setStore('kh_sites', list);
  if(state.editIndex === index) state.editIndex = index - 1;
  else if(state.editIndex === index - 1) state.editIndex = index;
  render();
}
function exportSites(){
  var ta = document.getElementById('siteBackup');
  if(!ta) return;
  var text = JSON.stringify(getSites());
  ta.value = text;
  ta.focus(); ta.select();
  try{ if(navigator.clipboard) navigator.clipboard.writeText(text).catch(function(){}); }catch(e){}
  toast('已导出 ' + getSites().length + ' 个网站，可复制备份');
}
/* 收藏 / 稍后看 / 历史 / 续播进度 / 追剧订阅 汇总备份为 JSON 文件下载；Web 端保存位置由浏览器下载目录决定 */
/* 设备端（深开鸿 HAP / ArkWeb）没有可靠的下载目录与文件选择器：
   导出改「复制剪贴板 + 浮层展示文本」，导入改「粘贴文本」，不依赖文件系统也能搬数据（#130）。
   桌面端仍走文件下载 / 文件选择，两条路径的落地逻辑共用 khApplyUserData 与策略浮层。 */
function khIsDeviceWeb(){
  if(window.KH_HARMONY) return true;
  return /ArkWeb|OpenHarmony|Kaihong/i.test(navigator.userAgent || '');
}
function khCopyByExec(text){
  try{
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    var ok = document.execCommand && document.execCommand('copy');
    ta.remove();
    return !!ok;
  }catch(e){ return false; }
}
function khCopyText(text){
  return new Promise(function(resolve){
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(function(){ resolve(true); }).catch(function(){ resolve(khCopyByExec(text)); });
        return;
      }
    }catch(e){}
    resolve(khCopyByExec(text));
  });
}
function khExportFallback(text){
  var old = document.getElementById('khExportText');
  if(old) old.remove();
  var wrap = document.createElement('div');
  wrap.id = 'khExportText';
  wrap.className = 'kh-ask-mask';
  wrap.innerHTML =
    '<div class="kh-ask" role="dialog" aria-modal="true" aria-labelledby="khExpTitle">' +
      '<h3 id="khExpTitle">备份内容（' + Math.round(text.length / 1024) + ' KB）</h3>' +
      '<p class="kh-ask-sub">设备端没有下载目录，已尝试复制到系统剪贴板。若复制没成功，可长按下面文本全选手动复制。</p>' +
      '<textarea id="khExpArea" class="kh-exp-area" readonly aria-label="备份 JSON"></textarea>' +
      '<div class="kh-exp-btns">' +
        '<button type="button" class="qbtn" data-exp="copy">再次复制</button>' +
        '<button type="button" class="qbtn" data-exp="close">关闭</button>' +
      '</div></div>';
  document.body.appendChild(wrap);
  var area = wrap.querySelector('#khExpArea');
  if(area) area.value = text;
  khCopyText(text).then(function(ok){
    toast(ok ? '备份已复制到剪贴板（' + Math.round(text.length / 1024) + ' KB），可粘贴到备忘录保存' : '自动复制失败，请长按文本框全选复制');
  });
  wrap.addEventListener('click', function(ev){
    var t = ev.target;
    if(t === wrap){ wrap.remove(); return; }
    var b = t && t.closest ? t.closest('[data-exp]') : null;
    if(!b) return;
    var k = b.getAttribute('data-exp');
    if(k === 'close'){ wrap.remove(); return; }
    if(k === 'copy'){
      khCopyText(text).then(function(ok){ toast(ok ? '已复制' : '复制失败，请手动全选'); });
    }
  });
  var esc0 = function(){ document.addEventListener('keydown', function h(e){ if(e.key === 'Escape'){ wrap.remove(); document.removeEventListener('keydown', h); } }); };
  esc0();
}
function khImportPaste(){
  var old = document.getElementById('khImportPaste');
  if(old) old.remove();
  var wrap = document.createElement('div');
  wrap.id = 'khImportPaste';
  wrap.className = 'kh-ask-mask';
  wrap.innerHTML =
    '<div class="kh-ask" role="dialog" aria-modal="true" aria-labelledby="khPstTitle">' +
      '<h3 id="khPstTitle">粘贴备份内容</h3>' +
      '<p class="kh-ask-sub">把另一台设备导出的备份 JSON 粘贴进来，点「导入」后仍会让你选合并 / 只补缺 / 覆盖。</p>' +
      '<textarea id="khPstArea" class="kh-exp-area" placeholder="在此粘贴备份 JSON…" aria-label="粘贴备份"></textarea>' +
      '<div class="kh-exp-btns">' +
        '<button type="button" class="qbtn" data-pst="do">导入</button>' +
        '<button type="button" class="qbtn" data-pst="file">改用文件选择</button>' +
        '<button type="button" class="qbtn" data-pst="close">关闭</button>' +
      '</div></div>';
  document.body.appendChild(wrap);
  var area = wrap.querySelector('#khPstArea');
  setTimeout(function(){
    if(area){
      area.focus();
      try{
        if(navigator.clipboard && navigator.clipboard.readText){
          navigator.clipboard.readText().then(function(t){ if(t && !area.value) area.value = t; }).catch(function(){});
        }
      }catch(e){}
    }
  }, 60);
  wrap.addEventListener('click', function(ev){
    var t = ev.target;
    if(t === wrap){ wrap.remove(); return; }
    var b = t && t.closest ? t.closest('[data-pst]') : null;
    if(!b) return;
    var k = b.getAttribute('data-pst');
    if(k === 'close'){ wrap.remove(); return; }
    if(k === 'file'){ wrap.remove(); khPickBackupFile(); return; }
    if(k === 'do'){
      var text = area ? String(area.value || '') : '';
      if(!text.trim()){ toast('还没有粘贴内容'); return; }
      wrap.remove();
      khAskImportMode(text, '粘贴内容', text.length);
    }
  });
}
function khPickBackupFile(){
  /* 第十一轮：设备端接上原生文件选择器（KHHap.openText）后优先走它。
     ArkWeb 里 <input type="file"> 要点下去由内核 onShowFileSelector 回调给 uri 才会弹盘，
     历史版本在设备上表现为「点了没反应」；原生选择器不依赖内核回调，更稳。 */
  if(khIsDeviceWeb() && window.khFile && typeof window.khFile.openText === 'function'){
    window.khFile.openText('.json').then(function(r){
      if(!r || !r.ok){
        if(r && r.reason === '已取消') return;
        toast('读取备份失败：' + ((r && r.reason) || '未知原因'));
        return;
      }
      var text = String(r.text || '');
      if(text.length > 64 * 1024 * 1024){ toast('备份文件超过 64 MB，不是本软件的备份，已拒绝读取'); return; }
      khAskImportMode(text, r.name || '', text.length);
    }).catch(function(e){ toast('读取备份失败：' + ((e && e.message) || e)); });
    return;
  }
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = function(){
    var f = inp.files && inp.files[0];
    if(!f) return;
    /* 1.7.85：备份是纯文本 JSON，正常几十 KB；超过 64 MB 直接拒绝，避免误选大文件把界面拖死 */
    if(f.size > 64 * 1024 * 1024){ toast('备份文件超过 64 MB，不是本软件的备份，已拒绝读取'); return; }
    var rd = new FileReader();
    rd.onload = function(){ khAskImportMode(String(rd.result || ''), f.name || '', f.size || 0); };
    rd.onerror = function(){ toast('备份文件读取失败'); };
    rd.readAsText(f);
  };
  inp.click();
}
/* 1.7.80：备份从「只看片单」扩到「能换机」——影视仓、自建站点、场景预设、远程配置、
   以及一份明确的偏好设置白名单。设备相关的键（中枢地址、设备号、升级计数、窗口状态）故意不导出，
   换机后这些应该由新设备自己决定。 */
var KH_BAK_SETTINGS = [
  'kh_theme', 'kh_motion', 'kh_font_scale', 'kh_senior', 'kh_kid', 'kh_night', 'kh_sleep_min',
  'kh_loudness_eq', 'kh_lang', 'kh_sub_style', 'kh_compat_mode', 'kh_fit', 'kh_rate', 'kh_vod_res',
  'kh_brightness', 'kh_auto_update', 'kh_autostart',
  /* 1.7.83 补：设置页里「会改本机行为」的四项以前没进备份，换机得重填 —— 代理、中枢地址、反馈上报地址/开关 */
  'kh_proxy', 'kh_hub_url', 'kh_issue_cfg_v1', 'kh_issue_remote_v1'
];
function khBakSettings(){
  var out = {};
  for(var i = 0; i < KH_BAK_SETTINGS.length; i++){
    var k = KH_BAK_SETTINGS[i], v = getStore(k, null);
    if(v !== null && v !== undefined) out[k] = v;
  }
  return out;
}
function khExportUserData(){
  var data = {
    exportedAt: new Date().toISOString(),
    fav: getFav(),
    watchlater: getWatchLater(),
    history: getHistory(),
    progress: getProgress(),
    watchsub: getStore('kh_watchlist', []),
    /* 以下为 1.7.80 新增：配置类，换机后不用重填 */
    sites: getStore('kh_sites', []),
    warehouses: getStore('kh_wh', null),
    warehouseSites: getStore('kh_wh_sites', null),
    /* 1.7.82 补：仓自带直播源与解析接口。1.7.81 新增的两个键以前没进备份，换机就丢。 */
    warehouseLives: getStore('kh_wh_lives', null),
    warehouseParses: getStore('kh_wh_parses', null),
    /* 1.7.83 补：自建直播频道与直播收藏。以前这两项不在备份里，换机后自加频道和收藏的台全丢。 */
    live: getStore('kh_live', []),
    livefav: getStore('kh_livefav', []),
    scene: getStore('kh_scene', null),
    remote: getStore('kh_remote', null),
    settings: khBakSettings()
  };
  var text = JSON.stringify(data, null, 2);
  if(khIsDeviceWeb()){
    /* 第十一轮：设备端有原生文件桥时先选路径真正落盘（备份 JSON 常见上百 KB，
       剪贴板方案容易粘不全）；保存失败或被取消再退回剪贴板面板。 */
    if(window.khFile && typeof window.khFile.saveText === 'function'){
      var ts0 = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      var fn = '鸿汇影备份 ' + ts0 + '.json';
      window.khFile.saveText(fn, text).then(function(r){
        if(r && r.ok){ toast('已保存备份文件：' + (r.path || fn)); return; }
        if(r && r.reason === '已取消') return;
        toast('保存文件失败，改为复制到剪贴板：' + ((r && r.reason) || '未知原因'));
        khExportFallback(text);
      }).catch(function(){ khExportFallback(text); });
      return;
    }
    khExportFallback(text); return;
  }
  var blob = new Blob([text], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  var ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url; a.download = '鸿汇影备份 ' + ts + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 3000);
  var nWh = 0;
  try { nWh = ((data.warehouses && data.warehouses.list) || []).length; } catch(e) {}
  var nWs = 0, nLv = 0, nPs = 0;
  try { Object.keys(data.warehouseSites || {}).forEach(function(k){ nWs += ((data.warehouseSites[k] || []).length); }); } catch(e) {}
  try { Object.keys(data.warehouseLives || {}).forEach(function(k){ nLv += ((data.warehouseLives[k] || []).length); }); } catch(e) {}
  try { Object.keys(data.warehouseParses || {}).forEach(function(k){ nPs += ((data.warehouseParses[k] || []).length); }); } catch(e) {}
  toast('已导出：收藏 / 稍后看 / 历史 / 进度 + 自建站点 ' + (data.sites || []).length +
    ' · 影视仓 ' + nWh + '（站点 ' + nWs + ' · 直播源 ' + nLv + ' · 解析 ' + nPs + '）' +
    ' · 自建直播 ' + ((data.live || []).length) + ' / 直播收藏 ' + ((data.livefav || []).length) +
    ' · 场景 ' + (data.scene ? '1' : '0') + ' · 设置 ' + Object.keys(data.settings || {}).length);
}
/* 用户数据导入还原（#110/#121）：读取备份 JSON 后先选冲突策略，再按策略落地
   merge = 合并（并集去重，同片进度以备份为准）/ skip = 只补缺（本机已有进度保留）/ overwrite = 覆盖（以备份为准） */
function khImportUserData(){
  if(khIsDeviceWeb()){
    /* 第十一轮：设备端接上原生文件选择器后先用文件导入；没有文件桥才落到粘贴面板 */
    if(window.khFile && typeof window.khFile.openText === 'function'){ khPickBackupFile(); return; }
    khImportPaste(); return;
  }
  khPickBackupFile();
}
function khImportModeName(m){
  return m === 'overwrite' ? '覆盖' : (m === 'skip' ? '只补缺' : '合并');
}
function khAskImportMode(text, fname, fsize){
  var data;
  try{ data = JSON.parse(String(text || '').trim()); }catch(e){ toast('备份不是合法 JSON'); return; }
  if(!data || typeof data !== 'object' || Array.isArray(data)){ toast('备份格式不正确'); return; }
  var n = function(v){ return Array.isArray(v) ? v.length : 0; };
  var progN = (data.progress && typeof data.progress === 'object' && !Array.isArray(data.progress)) ? Object.keys(data.progress).length : 0;
  var whN = 0;
  try { whN = ((data.warehouses && data.warehouses.list) || []).length; } catch(e) {}
  var cnt = '收藏 ' + n(data.fav) + ' · 稍后看 ' + n(data.watchlater) + ' · 历史 ' + n(data.history) +
            ' · 追剧 ' + n(data.watchsub) + ' · 进度 ' + progN + ' 部' +
            ' ｜ 自建站点 ' + n(data.sites) + ' · 影视仓 ' + whN + ' · 场景 ' + (data.scene ? '有' : '无') +
            ' · 设置 ' + (data.settings ? Object.keys(data.settings).length : 0) + ' 项';
  var when = data.exportedAt ? String(data.exportedAt).slice(0, 19).replace(/T/, ' ') : '时间未知';
  var old = document.getElementById('khImportAsk');
  if(old) old.remove();
  var wrap = document.createElement('div');
  wrap.id = 'khImportAsk';
  wrap.className = 'kh-ask-mask';
  wrap.innerHTML =
    '<div class="kh-ask" role="dialog" aria-modal="true" aria-labelledby="khAskTitle">' +
      '<h3 id="khAskTitle">导入备份：冲突怎么处理</h3>' +
      '<p class="kh-ask-sub">文件「' + esc(fname || '备份.json') + '」· 导出于 ' + esc(when) + '<br>备份内容：' + esc(cnt) +
        '<br>当前设备：收藏 ' + getFav().length + ' · 稍后看 ' + getWatchLater().length +
        ' · 历史 ' + getHistory().length + ' · 追剧 ' + getWatchSub().length + '</p>' +
      '<button type="button" class="kh-ask-btn" data-mode="merge"><b>合并（推荐）</b><span>两边取并集去重；同一部片的续播进度以备份为准</span></button>' +
      '<button type="button" class="kh-ask-btn" data-mode="skip"><b>只补缺</b><span>只导入本机没有的条目，本机已有进度保持不变</span></button>' +
      '<button type="button" class="kh-ask-btn" data-mode="overwrite"><b>覆盖</b><span>本机收藏 / 稍后看 / 历史 / 追剧 / 进度全部替换为备份内容</span></button>' +
      '<button type="button" class="kh-ask-btn kh-ask-cancel" data-mode="cancel">取消导入</button>' +
    '</div>';
  document.body.appendChild(wrap);
  function close(){
    if(wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(ev){ if(ev.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', function(ev){
    var t = ev.target;
    var btn = (t && t.closest) ? t.closest('[data-mode]') : null;
    var m = btn ? btn.getAttribute('data-mode') : '';
    if(!m){ if(t === wrap) close(); return; }
    close();
    if(m === 'cancel'){ toast('已取消导入'); return; }
    khApplyUserData(data, m);
  });
  try{ wrap.querySelector('[data-mode="merge"]').focus(); }catch(e){}
}
function khApplyUserData(input, mode){
  mode = (mode === 'overwrite' || mode === 'skip') ? mode : 'merge';
  var data = input;
  if(typeof input === 'string'){
    try{ data = JSON.parse(String(input || '').trim()); }catch(e){ toast('备份不是合法 JSON'); return; }
  }
  if(!data || typeof data !== 'object' || Array.isArray(data)){ toast('备份格式不正确'); return; }
  function strings(v){ return Array.isArray(v) ? v.filter(function(x){ return typeof x === 'string'; }) : []; }
  function mergeArr(cur, inc){
    if(!Array.isArray(inc)) return { list: cur, added: 0, missing: true };
    var seen = {}, out = cur.slice(), added = 0;
    for(var i = 0; i < out.length; i++) seen[out[i]] = true;
    for(var j = 0; j < inc.length; j++){
      if(typeof inc[j] !== 'string') continue;
      if(!seen[inc[j]]){ seen[inc[j]] = true; out.push(inc[j]); added++; }
    }
    return { list: out, added: added };
  }
  var stats = [];
  function apply(key, label, cur, inc){
    if(mode === 'overwrite'){
      if(!Array.isArray(inc)){ stats.push(label + ' 未提供，保留'); return; }
      var list = strings(inc);
      setStore(key, list.slice(0, KH_CAP_BY_KEY[key] || 200));
      stats.push(label + ' 覆盖为 ' + list.length);
      return;
    }
    var r = mergeArr(cur, inc);
    if(r.missing){ stats.push(label + ' 未提供，保留'); return; }
    var capped = r.list.slice(0, KH_CAP_BY_KEY[key] || 200);
    setStore(key, capped);
    stats.push(label + ' +' + r.added);
  }
  apply('kh_fav', '收藏', getFav(), data.fav);
  apply('kh_watchlater', '稍后看', getWatchLater(), data.watchlater);
  apply('kh_hist', '历史', getHistory(), data.history);
  apply('kh_watchlist', '追剧', getWatchSub(), data.watchsub);
  var prog = getProgress(), pNew = 0, pKeep = 0;
  var incProg = (data.progress && typeof data.progress === 'object' && !Array.isArray(data.progress)) ? data.progress : null;
  if(incProg){
    if(mode === 'overwrite'){
      prog = {};
      Object.keys(incProg).forEach(function(k){ prog[k] = incProg[k]; });
      stats.push('进度 覆盖为 ' + Object.keys(prog).length);
    } else {
      Object.keys(incProg).forEach(function(k){
        if(prog[k] === undefined){ prog[k] = incProg[k]; pNew++; }
        else if(mode === 'merge'){ prog[k] = incProg[k]; pKeep++; }
      });
      stats.push('进度 +' + pNew + (mode === 'merge' && pKeep ? '（覆盖同键 ' + pKeep + '）' : ''));
    }
    khTrimProgress(prog, KH_PROG_CAP);
    setStore('kh_prog', prog);
  } else {
    stats.push('进度 未提供，保留');
  }
  if(data.watchsubMeta && typeof data.watchsubMeta === 'object' && !Array.isArray(data.watchsubMeta)){
    var meta = mode === 'overwrite' ? {} : watchSubMeta();
    Object.keys(data.watchsubMeta).forEach(function(k){
      if(mode !== 'skip' || meta[k] === undefined) meta[k] = data.watchsubMeta[k];
    });
    setStore('kh_watchlist_meta', meta);
  }
  /* ---- 配置类导入（1.7.80）：影视仓 / 仓站点 / 场景 / 远程配置 / 自建站点 / 设置项 ---- */
  function isEmptyCfg(v){
    if(v === null || v === undefined) return true;
    if(Array.isArray(v)) return !v.length;
    if(typeof v === 'object') return !Object.keys(v).length;
    return false;
  }
  function applyCfg(key, label, inc, valid){
    if(inc === undefined || inc === null){ stats.push(label + ' 未提供，保留'); return; }
    if(!valid(inc)){ stats.push(label + ' 格式不对，跳过'); return; }
    if(mode === 'overwrite'){ setStore(key, inc); stats.push(label + ' 覆盖'); return; }
    if(isEmptyCfg(getStore(key, null))){ setStore(key, inc); stats.push(label + ' 补入'); return; }
    stats.push(label + ' 本机已有，保留');
  }
  applyCfg('kh_wh', '影视仓', data.warehouses, function(v){ return !!v && typeof v === 'object' && Array.isArray(v.list); });
  applyCfg('kh_wh_sites', '仓站点', data.warehouseSites, function(v){ return !!v && typeof v === 'object' && !Array.isArray(v); });
  applyCfg('kh_wh_lives', '仓直播源', data.warehouseLives, function(v){ return !!v && typeof v === 'object' && !Array.isArray(v); });
  applyCfg('kh_wh_parses', '仓解析接口', data.warehouseParses, function(v){ return !!v && typeof v === 'object' && !Array.isArray(v); });
  applyCfg('kh_scene', '场景预设', data.scene, function(v){ return !!v && typeof v === 'object' && !Array.isArray(v); });
  applyCfg('kh_remote', '远程配置', data.remote, function(v){ return !!v && typeof v === 'object' && !Array.isArray(v); });
  /* 1.7.83 新增：自建直播频道（数组，上限 50）与直播收藏（台 id 字符串数组，上限 50） */
  var incLive = Array.isArray(data.live)
    ? data.live.filter(function(x){ return x && typeof x === 'object' && /^https?:\/\//i.test(String(x.url || '')); })
    : null;
  if(incLive){
    var curLive = getStore('kh_live', []) || [];
    if(mode === 'overwrite'){
      setStore('kh_live', incLive.slice(0, 50));
      stats.push('自建直播 覆盖为 ' + Math.min(incLive.length, 50));
    } else {
      var seenL = {}, outLive = curLive.slice(), addedL = 0;
      for(var cl = 0; cl < outLive.length; cl++) seenL[String((outLive[cl] || {}).url || '')] = true;
      for(var nl = 0; nl < incLive.length && outLive.length < 50; nl++){
        var lu = String(incLive[nl].url || '');
        if(seenL[lu]) continue;
        seenL[lu] = true; outLive.push(incLive[nl]); addedL++;
      }
      setStore('kh_live', outLive);
      stats.push('自建直播 +' + addedL + (outLive.length >= 50 ? '（已满 50）' : ''));
    }
  } else {
    stats.push('自建直播 未提供，保留');
  }
  if(Array.isArray(data.livefav)){
    var incFav = data.livefav.filter(function(x){ return typeof x === 'string' && x; }).slice(0, 50);
    if(mode === 'overwrite'){
      setStore('kh_livefav', incFav);
      stats.push('直播收藏 覆盖为 ' + incFav.length);
    } else {
      var curFav = getStore('kh_livefav', []) || [], seenF = {}, outFav = curFav.slice(), addedF = 0;
      for(var cf = 0; cf < outFav.length; cf++) seenF[outFav[cf]] = true;
      for(var nf = 0; nf < incFav.length && outFav.length < 50; nf++){
        if(seenF[incFav[nf]]) continue;
        seenF[incFav[nf]] = true; outFav.push(incFav[nf]); addedF++;
      }
      setStore('kh_livefav', outFav);
      stats.push('直播收藏 +' + addedF);
    }
  } else {
    stats.push('直播收藏 未提供，保留');
  }
  /* 自建站点：数组并集，上限 50，与站点页的增删规则保持一致 */
  var incSites = Array.isArray(data.sites)
    ? data.sites.filter(function(s){ return s && typeof s === 'object' && /^https?:\/\//i.test(String(s.url || '')); })
    : null;
  if(incSites){
    var curSites = getStore('kh_sites', []) || [];
    if(mode === 'overwrite'){
      setStore('kh_sites', incSites.slice(0, 50));
      stats.push('自建站点 覆盖为 ' + Math.min(incSites.length, 50));
    } else {
      var seenUrl = {}, outSites = curSites.slice(), addedS = 0;
      for(var cs = 0; cs < outSites.length; cs++) seenUrl[String(outSites[cs].url || '')] = true;
      for(var ns = 0; ns < incSites.length && outSites.length < 50; ns++){
        var su = String(incSites[ns].url || '');
        if(seenUrl[su]) continue;
        seenUrl[su] = true;
        outSites.push(incSites[ns]);
        addedS++;
      }
      setStore('kh_sites', outSites);
      stats.push('自建站点 +' + addedS + (outSites.length >= 50 ? '（已满 50）' : ''));
    }
  } else {
    stats.push('自建站点 未提供，保留');
  }
  /* 设置项：覆盖模式整体换；合并模式只补本机没设过的键；只补缺同合并 */
  var incSet = (data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) ? data.settings : null;
  if(incSet){
    var setN = 0, setK = 0;
    for(var si = 0; si < KH_BAK_SETTINGS.length; si++){
      var sk = KH_BAK_SETTINGS[si];
      if(!(sk in incSet)) continue;
      if(mode === 'overwrite' || getStore(sk, null) === null){ setStore(sk, incSet[sk]); setN++; }
      else setK++;
    }
    stats.push('设置 +' + setN + (setK ? '（本机已有 ' + setK + ' 项保留）' : ''));
  } else {
    stats.push('设置 未提供，保留');
  }
  try{ applyMotionPref(); }catch(e){}
  /* 1.7.83：代理是「改行为」的设置，导入后立刻下发给主进程，不必等下次启动；
     中枢地址改的是服务端指向，需要重开窗口才切过去，这里如实提示一句。 */
  try{
    var _px = getStore('kh_proxy', null);
    if(_px && window.khProxy) window.khProxy.set({ mode: _px.mode || 'system', server: _px.server || '' });
  }catch(e){}
  try{ if(getStore('kh_hub_url', '')) stats.push('中枢地址已恢复，重开窗口后生效'); }catch(e){}
  try{ render(); }catch(e){}
  toast('已按「' + khImportModeName(mode) + '」导入：' + stats.join('，'));
}
function importSites(){
  var ta = document.getElementById('siteBackup');
  if(!ta || !ta.value.trim()){ toast('请先粘贴备份 JSON'); return; }
  var incoming;
  try{ incoming = JSON.parse(ta.value.trim()); }catch(e){ toast('备份格式不是合法 JSON'); return; }
  if(!Array.isArray(incoming)){ toast('备份应为网站数组'); return; }
  var list = getSites(), added = 0;
  var seen = {};
  for(var i=0;i<list.length;i++) seen[list[i].url] = true;
  for(var j=0;j<BUILTIN_SITES.length;j++) seen[BUILTIN_SITES[j].url] = true;
  for(var k=0;k<incoming.length && list.length < 50;k++){
    var s = incoming[k];
    if(!s || typeof s.name !== 'string') continue;
    var u = normalizeSiteUrl(s.url);
    if(!u || seen[u]) continue;
    seen[u] = true;
    var nm = s.name.trim().slice(0,20) || '未命名';
    list.push({name:nm, url:u, color:'#3B456B', tag:nm.slice(0,1)});
    added++;
  }
  setStore('kh_sites', list);
  toast('导入完成，新增 ' + added + ' 个网站');
  render();
}
function clearSites(yes){
  if(!yes){ state.confirmClear = true; render(); return; }
  setStore('kh_sites', []);
  state.confirmClear = false;
  state.editIndex = -1;
  toast('已清空全部自建网站');
  render();
}
/* HAP 内由 ArkWeb 注入 window.KaihongBridge.openSite，走原生网页页；
   普通浏览器预览时降级为新窗口打开。第三方站点普遍禁止 iframe 嵌入，故不用 iframe。
   海外站(project 同理)直接走系统浏览器：应用内 ArkWeb 在国内网络必然白屏超时，
   交给用户设备的浏览器与其网络环境处理，体验更好。 */
function openSite(url, mode){
  if(!url) return;
  var m = mode || 'pc';
  if((m === 'oversea' || m === 'project') &&
     window.KaihongBridge && typeof window.KaihongBridge.openExternal === 'function'){
    try{
      var opened = window.KaihongBridge.openExternal(url);
      if(opened){
        toast(m === 'oversea'
          ? '已交给系统浏览器打开（海外站受网络环境影响，如打不开请检查网络）'
          : '已交给系统浏览器打开');
        return;
      }
    }catch(e){}
  }
  if(window.KaihongBridge && typeof window.KaihongBridge.openSiteMode === 'function'){
    window.KaihongBridge.openSiteMode(url, m);
    return;
  }
  if(window.KaihongBridge && typeof window.KaihongBridge.openSite === 'function'){
    window.KaihongBridge.openSite(url);   // 旧版原生桥接：仍用桌面 UA
  } else {
    var w = null;
    try{ w = window.open(url, '_blank'); }catch(e){}
    if(w){ toast('浏览器预览：已在新窗口打开'); }
    else { toast('弹窗被拦截，网址：' + url.slice(0, 46) + '…'); }
  }
}

