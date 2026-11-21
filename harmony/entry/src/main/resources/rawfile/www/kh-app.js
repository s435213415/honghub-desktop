/* HongHub 前端模块：事件委托/手势/启动/桌面适配/字幕/中英/搜索/设置/同步
   由 app/index.html 单文件版拆分（1.7.72 模块化），按 <script> 顺序加载，顶层函数/常量共享全局作用域。 */
/* ---------------- 事件绑定（统一委托） ---------------- */
/* 仓内站点搜索：直接过滤已渲染的 .siteitem，不重绘、不丢焦点 */
function khWhSiteFilter(q){
  q = String(q || '').trim().toLowerCase();
  var items = document.querySelectorAll('.siteitem[data-name]');
  for(var i = 0; i < items.length; i++){
    var hit = !q || (items[i].getAttribute('data-name') || '').indexOf(q) >= 0;
    items[i].style.display = hit ? '' : 'none';
  }
}
els.main.addEventListener('input', function(e){
  if(e.target && e.target.id === 'liveSearch'){
    state.liveKeyword = e.target.value;
    state.liveSearchFocus = true;
    clearTimeout(state.liveSearchTimer);
    state.liveSearchTimer = setTimeout(function(){ render(); }, 180);
  }
});
/* 电脑端：在卡片行上滚动鼠标滚轮即横向滚动 */
els.main.addEventListener('wheel', function(e){
  var row = e.target && e.target.closest ? e.target.closest('.row') : null;
  if(!row) return;
  if(Math.abs(e.deltaY) > Math.abs(e.deltaX)){
    var max = row.scrollWidth - row.clientWidth;
    if(max > 2){ e.preventDefault(); row.scrollLeft += e.deltaY; }
  }
}, {passive:false});
els.main.addEventListener('click', function(e){  var node = e.target.closest('[data-act]');
  if(!node) return;
  var act = node.getAttribute('data-act');
  var idx;
  /* 场次卡一类「div 充当按钮」的控件补键盘可达：Enter / 空格触发同一动作（1.7.80） */
els.main.addEventListener('keydown', function(e){
  if(e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  var n = e.target.closest('[data-act]');
  if(!n) return;
  var tg = String(n.tagName || '').toUpperCase();
  if(tg === 'BUTTON' || tg === 'A' || tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
  e.preventDefault();
  n.click();
});
  if(act === 'boot-retry'){
    toast('正在重新同步云端内容…');
    khBootSync(true);
  } else if(act === 'play'){
    var m = findMovie(node.getAttribute('data-id'));
    if(m) openPlayer(m);
  } else if(act === 'view'){
    state.view = node.getAttribute('data-view'); render();
  } else if(act === 'cat'){
    state.category = node.getAttribute('data-cat'); render();
  } else if(act === 'search-cat'){
    state.searchCat = node.getAttribute('data-cat') || ''; render();
  } else if(act === 'shot-log'){
    khShotLogShow();
  } else if(act === 'site-add'){
    addSite();
  } else if(act === 'site-cancel'){
    state.editIndex = -1; render();
  } else if(act === 'site-edit'){
    startEdit(parseInt(node.getAttribute('data-index'), 10));
  } else if(act === 'site-up'){
    moveUp(parseInt(node.getAttribute('data-index'), 10));
  } else if(act === 'site-open'){
    /* 打开前再校验一次：只放行 http(s)，挡掉被篡改的 data-url（javascript:/data: 等） */
    var ou = node.getAttribute('data-url') || '';
    if(!/^https?:\/\//i.test(ou)){ toast('链接协议不合法，已拦截'); return; }
    try { markSiteOpen(ou); } catch(e) {}
    openSite(ou, node.getAttribute('data-mode') || 'pc');
  } else if(act === 'plat-copy'){
    var cu = node.getAttribute('data-url') || '';
    var okCopy = false;
    try{ if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(cu); okCopy = true; } }catch(e){}
    if(!okCopy){
      var cta = document.createElement('textarea');
      cta.value = cu; cta.style.position = 'fixed'; cta.style.opacity = '0';
      document.body.appendChild(cta); cta.select();
      try{ okCopy = document.execCommand('copy'); }catch(e2){}
      document.body.removeChild(cta);
    }
    toast(okCopy ? '链接已复制：' + hostOf(cu) : '复制失败，请长按条目手动复制');
  } else if(act === 'plat-probe'){
    toast('正在巡检 ' + BUILTIN_SITES.length + ' 个平台入口…');
    probePlatforms(true);
  } else if(act === 'plat-sort'){
    state.platSort = node.getAttribute('data-sort') === 'rate' ? 'rate' : 'default';
    toast(state.platSort === 'rate' ? '已按本机 7 天实测可播率排序（无数据的平台不伪造百分比）' : '已恢复默认排序');
    render();
  } else if(act === 'site-batch'){
    batchAddSites();
  } else if(act === 'site-probe'){
    toast('正在探测自建站点…');
    probeCustomSites(true);
  } else if(act === 'live-backup-add'){
    var chEl = document.getElementById('liveBackupCh');
    var uEl2 = document.getElementById('liveBackupUrl');
    var cid = chEl ? chEl.value : '';
    var bu = uEl2 ? normalizeSiteUrl(uEl2.value) : '';
    if(!cid){ toast('请选择频道'); return; }
    if(!bu || !/\.(m3u8|mp4)(\?|$)/i.test(bu)){ toast('请填 m3u8 / mp4 直链'); return; }
    var bkm = getStore('kh_live_backup', {}) || {};
    bkm[cid] = (bkm[cid] || []).concat([bu]).slice(0, 3);
    setStore('kh_live_backup', bkm);
    toast('已给该频道加了一条备用线路');
    render();
  } else if(act === 'cat-year'){
    state.catYear = node.getAttribute('data-y') || '全部';
    render();
  } else if(act === 'watchlater-del'){
    var wid = node.getAttribute('data-id');
    var wlist = getWatchLater().filter(function(x){ return x !== wid; });
    setStore('kh_watchlater', wlist);
    toast('已移除');
    render();
  } else if(act === 'watchsub-del'){
    var sid = node.getAttribute('data-id');
    var sm = watchSubMeta(); delete sm[sid]; setStore('kh_watchlist_meta', sm);
    var slist = getWatchSub().filter(function(x){ return x !== sid; });
    setStore('kh_watchlist', slist);
    var smovie = findMovie(sid);
    if(smovie) syncWatchSub('remove', smovie);
    toast('已取消追剧订阅');
    render();
  } else if(act === 'site-group-filter'){
    state.siteGrp = node.getAttribute('data-g') || '全部';
    render();
  } else if(act === 'font-save'){
    var fEl = document.getElementById('khFontSel');
    var fv = Number(fEl ? fEl.value : 100) || 100;
    setStore('kh_font_scale', fv);
    try{ document.body.style.zoom = fv === 100 ? '' : String(fv / 100); }catch(e){}
    toast(fv === 100 ? '已恢复标准字号' : '界面已放大到 ' + fv + '%');
  } else if(act === 'compat-save'){
    var cpEl = document.getElementById('khCompatSel');
    var cp = Number(cpEl ? cpEl.value : 0) === 1 ? 1 : 0;
    setStore('kh_compat_mode', cp);
    state.compatMode = cp === 1;
    toast(cp ? '兼容模式已开启：对接下来播放的片源生效（低码率起步、关闭解码 Worker）' : '已恢复标准播放');
  } else if(act === 'eq-save'){
    var eqEl = document.getElementById('khEqSel');
    var eqOn = Number(eqEl ? eqEl.value : 0) === 1;
    khSetLoudnessEq(eqOn);
  } else if(act === 'cast-probe'){
    if(window.khCast){
      window.khCast.detect().then(function(r){
        toast(r && r.supported
          ? ('本机可做 SSDP 发现' + (r.via === 'ssdp' ? '，点「🔍 发现投屏设备」列设备' : '') + '；片源经本机局域网转发后真实推送')
          : ((r && r.reason) || '当前环境不支持投屏'));
      }).catch(function(){ toast('投屏能力检测失败：当前环境不可用'); });
    }else{
      toast('当前环境（浏览器 / 设备端 WebView）不支持局域网投屏');
    }
  } else if(act === 'cast-discover'){
    khDlnaDiscover();
  } else if(act === 'autoupd-save'){
    var auEl = document.getElementById('khAutoUpd');
    var au = Number(auEl ? auEl.value : 0) === 1 ? 1 : 0;
    setStore('kh_auto_update', au);
    toast(au ? '自动升级已开启：发现新版自动下载+校验+进安装向导（安装仍需你确认，失败不重试）' : '自动升级已关闭（手动点更新横幅）');
  } else if(act === 'autostart-save'){
    var asEl = document.getElementById('khAutostartSel');
    var want = Number(asEl ? asEl.value : 0) === 1;
    if(!window.khAutostart){ toast('当前环境不支持开机自启'); return; }
    window.khAutostart.set(want).then(function(r){
      if(r && r.ok){
        setStore('kh_autostart', r.open ? 1 : 0);
        toast(r.open ? '已开启开机自启：下次登录系统后自动启动' : '已关闭开机自启');
      } else {
        toast('开机自启设置失败：' + (r && r.msg || '系统拒绝'));
      }
    }).catch(function(){ toast('开机自启设置失败：当前环境不可用'); });
  } else if(act === 'rollback-go'){
    var rbEl = document.getElementById('khRollbackSel');
    var rv = rbEl ? String(rbEl.value || '') : '';
    if(!rv){ toast('先在列表里选一个归档版本'); return; }
    khDoRollback(rv, function(){});
  } else if(act === 'pin-clear'){
    try{ localStorage.removeItem('kh_pinned_version'); }catch(e){}
    toast('已解除版本固定，恢复跟随最新版');
    render();
  } else if(act === 'display-save'){
    var thEl = document.getElementById('khThemeSel'), lgEl = document.getElementById('khLangSel'), seEl = document.getElementById('khSeniorSel');
    var th = thEl ? String(thEl.value) : 'dark';
    setStore('kh_theme', th);
    setStore('kh_night', th === 'night' ? 1 : 0);   /* 旧开关同步，兼容其它读取点 */
    setStore('kh_lang', lgEl ? String(lgEl.value) : 'zh');
    setStore('kh_senior', Number(seEl ? seEl.value : 0) === 1 ? 1 : 0);
    var szEl = document.getElementById('khSubSizeSel'), poEl = document.getElementById('khSubPosSel');
    setStore('kh_sub_style', { size: (szEl && KH_SUB_SIZES[szEl.value]) ? szEl.value : 'm',
      pos: (poEl && KH_SUB_POS[poEl.value]) ? poEl.value : 'mid' });
    khApplyDisplay();
    khApplyLang();
    khApplySubStyle();
    toast('显示设置已保存并生效');
  } else if(act === 'settings-reset'){
    if(!confirm('恢复默认设置？\n还原：中枢地址、定时关闭、字号、倍速、自动升级、夜间/长辈模式、固定版本。\n不动：收藏、历史、稍后再看、自添加片源与平台、访问口令。')) return;
    khResetSettings();
    toast('已恢复默认设置（收藏/历史/片单未动）');
    render();
  } else if(act === 'sleep-save'){
    var sEl = document.getElementById('khSleepSel');
    var sm = Number(sEl ? sEl.value : 0) || 0;
    setStore('kh_sleep_min', sm);
    armSleepTimer();
    toast(sm ? ('已设置：播放 ' + sm + ' 分钟后自动停止') : '已关闭定时停止');
  } else if(act === 'hub-save'){
    var hEl = document.getElementById('hubUrl');
    var hu = hEl ? normalizeSiteUrl(hEl.value) : '';
    if(!hu){ setStore('kh_hub_url', ''); toast('已清空中枢地址（改回本机模式）'); render(); return; }
    setStore('kh_hub_url', hu.replace(/\/$/, ''));
    toast('中枢地址已保存，重启页面后生效');
    render();
  } else if(act === 'hub-test'){
    var hEl2 = document.getElementById('hubUrl');
    var hu2 = hEl2 ? normalizeSiteUrl(hEl2.value) : '';
    if(!hu2){ toast('先填中枢地址，如 http://192.168.1.10:8890'); return; }
    toast('正在测试 ' + hu2 + ' …');
    fetch(hu2.replace(/\/$/, '') + '/api/manifest', { cache: 'no-store' })
      .then(function(r){ return r.json(); })
      .then(function(d){ toast('连上了：版本 ' + ((d && d.release && d.release.latest && d.release.latest.versionName) || '未知')); })
      .catch(function(e){ toast('连不上：' + (e && e.message || e) + '（检查地址、端口与口令）'); });
  } else if(act === 'queue-retry'){
    var qr = getStore('khQueueLog', []) || [];
    var idx = parseInt(node.getAttribute('data-index'), 10);
    if(isNaN(idx) || !qr[idx]) { toast('记录不存在'); return; }
    toast('已重新请求执行：' + (qr[idx].label || qr[idx].action));
    setTimeout(khQueuePoller, 300);
  } else if(act === 'res-probe'){
    probeMovieSources(true);
  } else if(act === 'kh-upgrade-install'){
    khUpgradeInstall(window.KH_RELEASE && window.KH_RELEASE.latest);
  } else if(act === 'kh-check-update'){
    requestSourceUpdate();
    toast('正在检查云端版本与源清单…');
  } else if(act === 'src-update'){
    requestSourceUpdate();
    toast('正在检查云端源清单…');
  } else if(act === 'src-health-reset'){
    setStore(SRC_HEALTH_KEY, {});
    toast('已重置健康记录，下次起播将重新检测线路');
    render();
  } else if(act === 'scene-apply'){
    var _scId = node.getAttribute('data-id');
    if(applyScene(_scId)){ render(); }
  } else if(act === 'scene-reset'){
    var _scCur = getScene();
    if(!_scCur.id){ toast('还没有选择档位，先点上面四个卡片之一'); return; }
    if(applyScene(_scCur.id)){
      var _scObj = sceneById(_scCur.id) || {};
      toast('已重新对齐「' + (_scObj.name || _scCur.id) + '」档');
      render();
    }
  } else if(act === 'wh-add'){
    var _whN = document.getElementById('whName'), _whU = document.getElementById('whUrl');
    var _whName = _whN ? _whN.value.trim() : '';
    var _whAddr = _whU ? _whU.value.trim() : '';
    if(!_whAddr){ toast('请先填写影视仓地址'); return; }
    if(!/^https?:\/\//i.test(_whAddr)){
      _whAddr = 'https://' + _whAddr.replace(/^\/+/, '');
      if(_whU) _whU.value = _whAddr;
    }
    if(whAdd(_whName, _whAddr)){
      if(_whN) _whN.value = '';
      if(_whU) _whU.value = '';
      render();
    }
  } else if(act === 'wh-refresh'){
    var _whId = node.getAttribute('data-id'), _whObj = getWh(_whId);
    if(_whObj) whFetchApply(_whObj, false);
  } else if(act === 'wh-refresh-all'){
    var _whL = getWhList(), _whN2 = 0;
    for(var _whI = 0; _whI < _whL.length; _whI++){
      var _wi2 = _whL[_whI];
      if(!_wi2.enabled || !_wi2.url) continue;
      _whN2++;
      whFetchApply(_wi2, true);
    }
    toast(_whN2 ? '正在刷新 ' + _whN2 + ' 个仓…' : '没有启用中且填了地址的仓');
    if(_whN2) setTimeout(function(){ render(); }, 800);
  } else if(act === 'wh-probe'){
    var _prU = document.getElementById('whUrl');
    var _prV = _prU ? String(_prU.value || '').trim() : '';
    if(!_prV){ toast('先在上面的地址框填一个仓地址再探测'); return; }
    toast('正在探测这个地址…');
    whProbe(_prV, function(r){
      if(!r || !r.ok){ toast('探测失败：' + ((r && r.reason) || '不可达') + '（' + ((r && r.ms) || 0) + 'ms）'); return; }
      var kt = r.kind === 'multi' ? '多仓索引' : r.kind === 'sites' ? '站点仓' : r.kind === 'jar' ? 'jar 爬虫仓（不支持）' : String(r.kind || '未知');
      toast('可达 · ' + kt + ' · ' + r.sites + ' 站点（带接口 ' + r.api + '）' +
        (r.subs ? ' · 子仓 ' + r.subs : '') + (r.lives ? ' · 直播 ' + r.lives : '') +
        (r.parses ? ' · 解析 ' + r.parses : '') + ' · ' + r.ms + 'ms');
    });
  } else if(act === 'wh-show-all'){
    var _whRest = document.querySelectorAll('.siteitem[data-rest="1"]');
    for(var _wr3 = 0; _wr3 < _whRest.length; _wr3++){
      _whRest[_wr3].style.display = '';
      _whRest[_wr3].removeAttribute('data-rest');
    }
    node.style.display = 'none';
    toast('已展开该仓全部站点');
  } else if(act === 'wh-toggle'){
    var _whT = getWh(node.getAttribute('data-id'));
    if(!_whT){ toast('这个仓已经不存在了'); return; }
    var _whAll = getWhList();
    _whT.enabled = !_whT.enabled;
    saveWhList(replaceWhIn(_whAll, _whT));
    toast(_whT.enabled ? '已启用「' + _whT.name + '」' : '已停用「' + _whT.name + '」，它的站点暂不列出');
    render();
  } else if(act === 'wh-del'){
    var _whDId = node.getAttribute('data-id'), _whD = getWh(_whDId);
    if(!_whD){ toast('这个仓已经不存在了'); render(); return; }
    if(window.__whDelConfirm !== _whDId){
      window.__whDelConfirm = _whDId;
      toast('确实要删除「' + _whD.name + '」？再点一次 ✕ 确认（会清掉它导入的 ' + whSiteCount(_whDId) + ' 个站点）');
      return;
    }
    window.__whDelConfirm = '';
    whRemove(_whDId);
    toast('已删除仓「' + _whD.name + '」及其站点');
    render();
  } else if(act === 'wh-pick-file'){
    /* 1.7.85：一键加载本机配置文件，读回后填入文本框并直接导入（合并进选中/新建仓） */
    if(!window.khConfigFile || typeof window.khConfigFile.pick !== 'function'){
      toast('当前环境不支持读取本机文件（仅桌面版可用），请用粘贴方式'); return;
    }
    window.khConfigFile.pick().then(function(r){
      if(!r || !r.ok){ if(r && r.canceled) return; toast('读取失败：' + ((r && r.reason) || '未知原因')); return; }
      var txt = String(r.text || '').trim();
      if(!txt){ toast('文件是空的'); return; }
      var ta = document.getElementById('whPaste');
      var sel = document.getElementById('whPasteTarget');
      if(ta) ta.value = txt;
      whImportText(sel ? sel.value : '', txt);
      toast('已从「' + (r.name || '文件') + '」导入配置');
      render();
    }).catch(function(e){ toast('读取失败：' + ((e && e.message) || e)); });
  } else if(act === 'wh-paste'){
    var _whTa = document.getElementById('whPaste');
    var _whSel = document.getElementById('whPasteTarget');
    var _whTxt = _whTa ? _whTa.value.trim() : '';
    if(!_whTxt){ toast('请先把仓配置内容粘贴到文本框'); return; }
    whImportText(_whSel ? _whSel.value : '', _whTxt);
    if(_whTa) _whTa.value = '';
    render();
  } else if(act === 'wh-src-go'){
    var _kwEl = document.getElementById('whSrcKw');
    var _kwTxt = _kwEl ? _kwEl.value.trim() : '';
    if(!_kwTxt){ toast('请先输入片名'); return; }
    whSrcSearch(_kwTxt);
  } else if(act === 'wh-src-more'){
    whSrcMore();
  } else if(act === 'wh-src-open'){
    whSrcOpen(node);
  } else if(act === 'wh-src-play'){
    var _spU = node.getAttribute('data-url') || '';
    var _spTitle = node.getAttribute('data-title') || '仓内线路';
    var _spHdr = null;
    try{ var _hs = node.getAttribute('data-hdr'); if(_hs) _spHdr = JSON.parse(_hs); }catch(e){ _spHdr = null; }
    if(!_spU){ toast('这条线路没有可用地址'); return; }
    /* 1.7.82：以前点线路直接甩给外部播放器/浏览器，内置播放器根本播不了仓片。
       现在先进内置播放器；只有内置不支持（比如需要专用解码）时再用外部播放器。 */
    khPlayUrlInApp(_spU, _spTitle, _spHdr);
  } else if(act === 'wh-src-ext'){
    var _eu = node.getAttribute('data-url') || '';
    if(!_eu){ toast('这条线路没有可用地址'); return; }
    if(window.khExternal && window.khExternal.open){
      window.khExternal.open(_eu).then(function(r){
        toast(r && r.ok ? '已用外部播放器打开' : '拉起失败：' + ((r && r.reason) || '未找到可用播放器'));
      }).catch(function(){ toast('拉起失败'); });
    } else {
      whSrcCopy(_eu);
      try { window.open(_eu, '_blank'); } catch(e){}
    }
  } else if(act === 'wh-src-copy'){
    whSrcCopy(node.getAttribute('data-url') || '');
  } else if(act === 'open-file'){
    khOpenLocalVideo();
  } else if(act === 'proxy-save'){
    khSaveProxy();
  } else if(act === 'dl-add'){
    if(!window.khDl){ toast('当前环境没有下载桥'); return; }
    var _du = document.getElementById('dlUrl'), _dn = document.getElementById('dlName');
    var _ua = _du ? _du.value.trim() : '';
    if(!_ua){ toast('先填下载地址'); return; }
    window.khDl.add({ url: _ua, name: _dn ? _dn.value.trim() : '' }).then(function(r){
      if(r && r.ok){ toast('已加入下载队列'); if(_du) _du.value = ''; if(_dn) _dn.value = ''; khDlRender(); }
      else { toast('加入失败：' + ((r && r.reason) || '未知原因')); }
    }).catch(function(){ toast('加入失败'); });
  } else if(act === 'dl-opt-apply'){
    if(!window.khDl){ toast('当前环境没有下载桥'); return; }
    var _cEl = document.getElementById('dlConc'), _lEl = document.getElementById('dlLimit');
    window.khDl.opt({ conc: _cEl ? Number(_cEl.value) : 2, limitKB: _lEl ? Number(_lEl.value) : 0 }).then(function(r){
      toast(r && r.ok ? '已应用：并发 ' + r.conc + ' 路' + (r.limitKB ? '，限速 ' + r.limitKB + ' KB/s' : '，不限速') : '应用失败');
      khDlRender();
    }).catch(function(){ toast('应用失败'); });
  } else if(act === 'dl-reveal'){
    if(!window.khDl){ toast('当前环境没有下载桥'); return; }
    window.khDl.reveal().then(function(r){ if(!r || !r.ok) toast('打开文件夹失败：' + ((r && r.reason) || '')); });
  } else if(act === 'dl-clear'){
    if(!window.khDl){ toast('当前环境没有下载桥'); return; }
    window.khDl.clear('finished').then(function(){ toast('已清掉已完成 / 失败条目'); khDlRender(); });
  } else if(act === 'dl-pause'){
    window.khDl.pause(Number(node.getAttribute('data-id'))).then(function(r){
      toast(r && r.ok ? ('已暂停' + (r.note ? '，' + r.note : '')) : ('暂停失败：' + ((r && r.reason) || '')));
      khDlRender();
    });
  } else if(act === 'dl-resume'){
    window.khDl.resume(Number(node.getAttribute('data-id'))).then(function(r){
      toast(r && r.ok ? '已重新排队' : ('继续失败：' + ((r && r.reason) || '')));
      khDlRender();
    });
  } else if(act === 'dl-remove'){
    window.khDl.remove(Number(node.getAttribute('data-id'))).then(function(r){
      if(!r || !r.ok) toast('移除失败：' + ((r && r.reason) || ''));
      khDlRender();
    });
  } else if(act === 'remote-sync'){
    syncRemoteNow();
  } else if(act === 'remote-paste'){
    var _ta = document.getElementById('remotePaste');
    var _txt = _ta ? _ta.value.trim() : '';
    if(!_txt){ toast('请先粘贴第三方配置 JSON'); return; }
    var _parsed;
    try { _parsed = JSON.parse(_txt); } catch(_e){ toast('JSON 解析失败：' + (_e && _e.message ? _e.message : '格式错误')); return; }
    var _rc = getRemoteCfg(); _rc.err = ''; applyRemoteData(_parsed, _rc, false);
  } else if(act === 'remote-auto'){
    var rc = getRemoteCfg();
    rc.auto = !rc.auto;
    if(rc.auto && !rc.url){
      var rEl = document.getElementById('remoteUrl');
      if(rEl) rc.url = rEl.value.trim();
    }
    saveRemoteCfg(rc);
    toast(rc.auto ? '已开启自动同步：每 10 分钟拉取一次' : '已关闭自动同步');
    render();
  } else if(act === 'plat-cat'){
    state.platCat = node.getAttribute('data-cat') || '电影';
    render();
  } else if(act === 'plat-filter'){
    state.platFilter = node.getAttribute('data-f') || 'all';
    render();
  } else if(act === 'issue-toggle'){
    var _cfg = issueCfg(); _cfg.auto = !_cfg.auto; saveIssueCfg(_cfg);
    toast(_cfg.auto ? '已开启自动收集问题' : '已暂停自动收集问题'); render();
  } else if(act === 'issue-remote-toggle'){
    var _r1 = issueRemoteCfg(); _r1.enabled = !_r1.enabled;
    setStore(ISSUE_REMOTE_KEY, _r1);
    toast(_r1.enabled ? '已开启远程收集' : '已暂停远程收集'); render();
  } else if(act === 'issue-remote-save'){
    var _r2 = issueRemoteCfg(), _ri = document.getElementById('issueRemoteUrl');
    var _ru = _ri ? _ri.value.trim() : '';
    if(_ru && !/^https?:\/\//i.test(_ru)){ toast('地址需以 http(s):// 开头'); return; }
    _r2.url = _ru.slice(0, 300); _r2.err = ''; _r2.fails = 0;
    setStore(ISSUE_REMOTE_KEY, _r2);
    toast(_ru ? '地址已保存；如要外发请再点「开启远程收集」' : '已清空远程收集地址'); render();
  } else if(act === 'issue-remote-send'){
    ISSUE_REMOTE_LAST_TRY = 0; issueRemoteSend(true);
  } else if(act === 'issue-remote-open'){
    var _r3 = issueRemoteCfg();
    if(!_r3.url){ toast('请先填写远程收集地址'); return; }
    var _board = _r3.url;
    try{ _board = new URL(_r3.url).origin + '/'; }catch(e){}
    openSite(_board, 'pc');
  } else if(act === 'issue-check'){
    runIssueSelfCheck(true);
  } else if(act === 'issue-copy'){
    state.issueReportText = issueReport();
    copyIssueText(state.issueReportText, '诊断报告'); render();
  } else if(act === 'issue-export'){
    state.issueReportText = JSON.stringify({device:issueDevice(), report:issueReport(),
      issues:issueList(), crashes:window.KH_CRASH_LOG || []}, null, 2);
    var _okJson = downloadTextFile(issueFileName('json'), state.issueReportText, 'application/json');
    if(!_okJson) copyIssueText(state.issueReportText, '问题 JSON'); else toast('诊断 JSON 已导出');
    render();
  } else if(act === 'issue-export-txt'){
    state.issueReportText = issueReport();
    var _okTxt = downloadTextFile(issueFileName('txt'), state.issueReportText, 'text/plain');
    if(!_okTxt) copyIssueText(state.issueReportText, '诊断报告'); else toast('诊断报告已导出为文本文件');
    render();
  } else if(act === 'issue-clear'){
    state.issueConfirm = true; render();
  } else if(act === 'issue-clear-yes'){
    setStore(ISSUE_KEY, []); state.issueConfirm = false; state.issueReportText = '';
    toast('已清空问题记录'); render();
  } else if(act === 'issue-clear-no'){
    state.issueConfirm = false; render();
  } else if(act === 'sync-go'){
    var st = document.getElementById('syncTitle');
    var stv = st ? st.value.trim().slice(0,40) : '';
    if(!stv){ toast('请先填片名再同步'); return; }
    state.syncTitle = stv;
    toast('已同步生成 ' + BUILTIN_SITES.length + ' 个平台的资源入口');
    render();
  } else if(act === 'site-del'){
    delSite(parseInt(node.getAttribute('data-index'), 10));
  } else if(act === 'site-fill'){
    var n = document.getElementById('siteName'), u = document.getElementById('siteUrl');
    if(n) n.value = '我的影视站';
    if(u) u.value = 'https://你的影视网站/';
    toast('已填入占位示例，替换成你自己的网址即可');
  } else if(act === 'site-export'){
    exportSites();
  } else if(act === 'site-import'){
    importSites();
  } else if(act === 'site-clear'){
    clearSites(false);
  } else if(act === 'site-clear-yes'){
    clearSites(true);
  } else if(act === 'site-clear-no'){
    state.confirmClear = false; render();
  } else if(act.indexOf('res-') === 0){
    resAction(act, node);
  } else if(act.indexOf('live-') === 0){
    liveAction(act, node);
  } else if(act === 'url-play'){
    var input = document.getElementById('urlInput');
    var url = input ? input.value.trim() : '';
    if(!url){ toast('请先填入视频直链或影视网站网址'); return; }
    if(!/^https?:\/\//i.test(url) && !/^media\//.test(url) && !/^blob:/.test(url)){
      toast('请填入 http(s) 开头的网址'); return;
    }
    openPlayer(customMovie(url));
  } else if(act === 'url-open-site'){
    var sinput = document.getElementById('urlInput');
    var surl = sinput ? sinput.value.trim() : '';
    if(!surl){ toast('请先填入要打开的影视网站网址'); return; }
    if(!/^https?:\/\//i.test(surl)){ toast('请填入 http(s) 开头的网站网址'); return; }
    openSite(surl);
  }
});
els.nav.addEventListener('click', function(e){
  var b = e.target.closest('button[data-view]');
  if(!b) return;
  state.view = b.getAttribute('data-view');
  state.editIndex = -1;
  state.confirmClear = false;
  state.resEdit = -1;
  state.resConfirmClear = false;
  if(state.view !== 'search'){ state.keyword = ''; state.searchCat = ''; els.search.value = ''; }
  render();
});
/* 搜索防抖：连续输入只在停顿后重绘一次，避免每敲一个字都全量重建 DOM */
els.search.addEventListener('input', function(){
  state.keyword = els.search.value;
  els.searchClear.classList.toggle('show', state.keyword.length > 0);
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(function(){
    state.view = state.keyword.trim() ? 'search' : 'home';
    if(state.keyword.trim().length >= 2) khSearchHistPush(state.keyword.trim());
    render();
  }, 180);
});
els.searchClear.addEventListener('click', function(){
  els.search.value = '';
  state.keyword = '';
  state.searchCat = '';
  state.view = 'home';
  clearTimeout(state.searchTimer);
  render();
  els.search.focus();
});
els.srcBar.addEventListener('click', function(e){
  var b = e.target.closest('[data-act="src"]');
  if(b) loadSource(parseInt(b.getAttribute('data-index'), 10));
});
/* 右栏推荐卡片：点击 / 回车直接换片 */
function asidePlay(node){
  if(!node) return;
  var m = findMovie(node.getAttribute('data-id'));
  if(m) openPlayer(m);
}
els.asideList.addEventListener('click', function(e){
  asidePlay(e.target.closest('.aside-item'));
});
els.asideList.addEventListener('keydown', function(e){
  if(e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  asidePlay(e.target.closest('.aside-item'));
});
els.toastAction.addEventListener('click', function(){
  els.toast.classList.remove('show');
  if(state.undoCallback){ var f = state.undoCallback; state.undoCallback = null; f(); }
});
document.getElementById('closeBtn').addEventListener('click', closePlayer);
els.tap.addEventListener('click', function(){ playVideo(); });
els.favBtn.addEventListener('click', function(){
  if(!state.movie || state.movie.custom) return;
  var fav = getFav();
  var i = fav.indexOf(state.movie.id);
  if(i >= 0){ fav.splice(i,1); toast('已取消收藏'); } else { fav.unshift(state.movie.id); toast('已加入收藏'); }
  setStore('kh_fav', fav);
  updateFavBtn();
});
/* 控制条 */
/* ---------------- 触屏手势（#122）：左半屏上下滑=亮度，右半屏上下滑=音量，长按 0.6s=2 倍速 ------------- */
(function khTouchGestures(){
  var wrap = els.videoWrap;
  if(!wrap || !('ontouchstart' in window) || !window.matchMedia || !window.matchMedia('(pointer:coarse)').matches) return;
  var hud = document.createElement('div');
  hud.id = 'khGestureHud';
  hud.className = 'kh-gesture-hud';
  document.body.appendChild(hud);
  var hudTimer = 0;
  function hudShow(text){
    hud.textContent = text;
    hud.classList.add('show');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(function(){ hud.classList.remove('show'); }, 900);
  }
  function clampBright(v){ return Math.max(0.2, Math.min(1.5, v)); }
  function curBright(){ return isFinite(state.brightness) ? state.brightness : 1; }
  function applyBrightness(v){
    state.brightness = clampBright(v);
    try{ els.video.style.filter = 'brightness(' + state.brightness.toFixed(2) + ')'; }catch(e){}
    try{ setStore('kh_brightness', state.brightness); }catch(e){}
    hudShow('亮度 ' + Math.round(((state.brightness - 0.2) / 1.3) * 100) + '%');
  }
  var g = { on:false, x0:0, y0:0, base:1, axis:'', boost:false, moved:false, long:null };
  function startBoost(){
    if(!g.on || g.moved) return;
    var v = els.video;
    if(!v || v.paused) return;   // 暂停时不做倍速，避免误解
    try{ v.playbackRate = 2; }catch(e){}
    g.boost = true;
    hudShow('2 倍速播放中');
  }
  function endBoost(){
    if(!g.boost) return;
    try{ els.video.playbackRate = state.rate || 1; }catch(e){}
    g.boost = false;
    hudShow('已恢复 ' + (state.rate || 1) + ' 倍速');
  }
  function finish(kept){
    if(!g.on) return;
    clearTimeout(g.long);
    endBoost();
    if(g.moved) state.khSuppressTap = true;   // 滑动后不再触发单击暂停/双击全屏
    if(kept) state.khSuppressTap = true;
    g.on = false; g.axis = ''; g.moved = false;
  }
  wrap.addEventListener('touchstart', function(e){
    if(!state.movie) return;   // 只有播放器打开时才接管手势
    if(e.touches.length !== 1) return;
    var tg = e.target;
    if(tg && tg.closest && tg.closest('.player-ctrl, [data-ctrl], .kh-ask-mask, .ctx-menu, input, textarea, button')) return;
    var t = e.touches[0];
    g.on = true;
    g.x0 = t.clientX; g.y0 = t.clientY;
    g.base = (t.clientX < window.innerWidth / 2) ? curBright() : (isFinite(state.userVolume) ? state.userVolume : els.video.volume);
    g.axis = ''; g.moved = false;
    clearTimeout(g.long);
    g.long = setTimeout(startBoost, 620);
  }, { passive: true });
  wrap.addEventListener('touchmove', function(e){
    if(!g.on || e.touches.length !== 1) return;
    var t = e.touches[0];
    var dx = t.clientX - g.x0, dy = t.clientY - g.y0;
    if(!g.axis){
      if(Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
      g.axis = Math.abs(dy) >= Math.abs(dx) ? 'v' : 'h';
      g.moved = true;
      clearTimeout(g.long);
      endBoost();
      if(g.axis === 'h') return;   // 横滑不接管，交给系统返回手势
    }
    if(g.axis !== 'v') return;
    if(e.cancelable) e.preventDefault();
    var d = -dy / Math.max(200, window.innerHeight * 0.45);   // 上滑增大
    if(g.x0 < window.innerWidth / 2) applyBrightness(g.base + d * 1.3);
    else applyVolume(g.base + d, true);
  }, { passive: false });
  wrap.addEventListener('touchend', function(){ finish(g.boost); }, { passive: true });
  wrap.addEventListener('touchcancel', function(){ finish(true); }, { passive: true });
  /* 记住上次亮度：只在本会话与下次启动间保持，不写进备份导出 */
  try{
    var sb = Number(getStore('kh_brightness', 1));
    if(isFinite(sb) && sb > 0) state.brightness = clampBright(sb);
    if(state.brightness !== 1) els.video.style.filter = 'brightness(' + state.brightness.toFixed(2) + ')';
  }catch(e){}
})();
els.videoWrap.addEventListener('click', function(e){
  if(state.khSuppressTap){ state.khSuppressTap = false; return; }
  if(e.target === els.video && state.movie) togglePlay();
});
/* 失败提示里的「重试全部线路」按钮（playerMsg 不在 main 委托范围内，单独挂） */
els.msg.addEventListener('click', function(e){
  if(e.target && e.target.closest && e.target.closest('[data-retry]')) retryAllSources();
  var rs = e.target.closest && e.target.closest('[data-resume]');
  if(rs) khResumePlay(rs.getAttribute('data-resume'));
});
els.videoWrap.addEventListener('dblclick', function(e){
  if(state.khSuppressTap){ state.khSuppressTap = false; return; }
  if(e.target === els.video) toggleFullscreen();
});
document.querySelector('.player-ctrl').addEventListener('click', function(e){
  var b = e.target.closest('[data-ctrl]');
  if(!b) return;
  var c = b.getAttribute('data-ctrl');
  if(c === 'play') togglePlay();
  else if(c === 'back10') seekBy(-10);
  else if(c === 'fwd10') seekBy(10);
  else if(c === 'mute') toggleMute();
  else if(c === 'rate') cycleRate();
  else if(c === 'fullscreen') toggleFullscreen();
  else if(c === 'fit') cycleFit();
  else if(c === 'pip') togglePip();
  else if(c === 'quality') cycleQuality();
  else if(c === 'downgrade') khDowngradeLevel();
  else if(c === 'subtitle') khSubtitleOn();
  else if(c === 'sub-translate') khTranslateSub();
  else if(c === 'audiotrack') khCycleAudioTrack();
  else if(c === 'shot') khCaptureShot();
  else if(c === 'watchlater') toggleWatchLater();
  else if(c === 'watchsub') toggleWatchSub();
  else if(c === 'external') khOpenExternal();
  else if(c === 'cast') khDlnaDiscover();
  else if(c === 'dl-current') khDownloadCurrent();
  else if(c === 'openfile') khOpenLocalVideo();
  else if(c === 'live-prev') switchLive(-1);
  else if(c === 'live-next') switchLive(1);
  else if(c === 'live-fav') toggleLiveFav(state.movie && state.movie.live ? state.movie.channel.id : '');
  else if(c === 'live-list') closePlayer();
});
els.seek.addEventListener('input', function(){
  state.seekDragging = true;
  var d = isFinite(els.video.duration) ? els.video.duration : 0;
  els.timeText.textContent = fmtTime(d * parseFloat(els.seek.value) / 100) + ' / ' + fmtTime(d);
});
els.seek.addEventListener('change', function(){
  seekToPct(parseFloat(els.seek.value) / 100);
  state.seekDragging = false;
});
els.vol.addEventListener('input', function(){ applyVolume(parseFloat(els.vol.value), true); });
/* 每次开始播放都重新计时（定时关闭） */
try{ els.video.addEventListener('play', function(){ try{ armSleepTimer(); }catch(e){} }); }catch(e){}
els.toTop.addEventListener('click', function(){ els.main.scrollTop = 0; });
els.main.addEventListener('scroll', function(){
  els.toTop.classList.toggle('show', els.main.scrollTop > 320);
});
/* TV / 遥控方向键网格导航：在卡片、频道卡、推荐项、分组按钮与普通控件间按行列移动焦点。
   播放器、右键菜单、搜索联想下拉打开时不接管（各自已有方向键处理）；输入框内不拦截。
   返回 true 表示方向键已被本函数消费。 */
function khGridNav(e){
  var dir = e.key;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].indexOf(dir) < 0) return false;
  var menu = document.getElementById('khCtxMenu');
  if(menu && menu.classList.contains('show')) return false;
  var sg = document.getElementById('khSuggest');
  if(sg && sg.style.display !== 'none') return false;
  var sel = '.card[data-act="play"],.ch-card[data-act="live-play"],.aside-item,.chip[data-act],[data-act],button,a[href]';
  var items = Array.prototype.slice.call(document.querySelectorAll(sel)).filter(function(el){
    if(el.disabled) return false;
    if(el.closest('#playerLayer,#khCtxMenu,#khSuggest')) return false;
    var r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  });
  if(!items.length) return false;
  function center(el){ var r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; }
  var cur = document.activeElement;
  var curIdx = items.indexOf(cur);
  var target = null;
  if(curIdx < 0){
    target = items[0];
  } else {
    var c = center(items[curIdx]);
    var rest = [];
    for(var i=0;i<items.length;i++){ if(i !== curIdx) rest.push({ el: items[i], c: center(items[i]) }); }
    var pool;
    if(dir === 'ArrowLeft' || dir === 'ArrowRight'){
      var dx = dir === 'ArrowLeft' ? -1 : 1;
      var row = rest.filter(function(o){ return Math.abs(o.c.y - c.y) < 28; });
      pool = row.length ? row : rest;
      pool.sort(function(a,b){ return dx * (a.c.x - b.c.x); });
    } else {
      var dy = dir === 'ArrowUp' ? -1 : 1;
      var col = rest.filter(function(o){ return Math.abs(o.c.x - c.x) < 60; });
      pool = col.length ? col : rest;
      pool.sort(function(a,b){ return dy * (a.c.y - b.c.y); });
    }
    target = pool[0] ? pool[0].el : null;
  }
  if(target){
    target.focus();
    try{ target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }catch(_){}
    e.preventDefault();
    return true;
  }
  return false;
}
/* 键盘：播放器打开时优先作为播放快捷键；卡片支持 Enter / 空格访问 */
document.addEventListener('keydown', function(e){
  var inPlayer = els.player.classList.contains('show');
  var tag = e.target && e.target.tagName ? e.target.tagName : '';
  var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if(inPlayer){
    if(e.key === 'Escape'){ e.preventDefault(); closePlayer(); return; }
    if(typing) return;
    var k = e.key;
    if(k === ' ' || k === 'k' || k === 'K'){ e.preventDefault(); togglePlay(); }
    else if(k === 'ArrowLeft' || k === 'j' || k === 'J'){ e.preventDefault(); seekBy(-10); }
    else if(k === 'ArrowRight' || k === 'l' || k === 'L'){ e.preventDefault(); seekBy(10); }
    else if(k === 'ArrowUp'){
      e.preventDefault();
      if(state.movie && state.movie.live) switchLive(-1); else applyVolume(state.userVolume + 0.1, true);
    }
    else if(k === 'ArrowDown'){
      e.preventDefault();
      if(state.movie && state.movie.live) switchLive(1); else applyVolume(state.userVolume - 0.1, true);
    }
    else if(k === 'm' || k === 'M'){ e.preventDefault(); toggleMute(); }
    else if(k === 'f' || k === 'F'){ e.preventDefault(); toggleFullscreen(); }
    else if(/^[0-9]$/.test(k)){ e.preventDefault(); seekToPct(parseInt(k, 10) / 10); }
    return;
  }
  if(!typing && khGridNav(e)) return;
  if(e.key === 'Escape'){ state.confirmClear = false; state.favConfirmClear = false; state.histConfirmClear = false; render(); return; }
  /* 电脑端：按 / 快速聚焦搜索框（播放器外、未在输入时） */
  if(e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey){
    var tg = e.target && e.target.tagName ? e.target.tagName : '';
    if(tg !== 'INPUT' && tg !== 'TEXTAREA' && tg !== 'SELECT'){
      e.preventDefault();
      if(els.search){ els.search.focus(); els.search.select && els.search.select(); }
      return;
    }
  }
  if(e.key === 'Enter' && (e.target.id === 'siteName' || e.target.id === 'siteUrl')){ addSite(); return; }
  if(e.key === 'Enter' && e.target.id === 'remoteUrl'){ syncRemoteNow(); return; }
  if(e.key === 'Enter' && e.target.id === 'syncTitle'){
    var sbtn = document.querySelector('[data-act="sync-go"]');
    if(sbtn) sbtn.click();
    return;
  }
  if(e.key === 'Enter' && (e.target.id === 'liveName' || e.target.id === 'liveUrl' || e.target.id === 'liveGroupInput')){ addLive(); return; }
  if(e.key === 'Enter' && e.target.id === 'urlInput'){
    var btn = document.querySelector('[data-act="url-play"]');
    if(btn) btn.click();
    return;
  }
  var card = e.target.closest ? e.target.closest('.card[data-act="play"]') : null;
  if(card && (e.key === 'Enter' || e.key === ' ')){
    e.preventDefault();
    var m = findMovie(card.getAttribute('data-id'));
    if(m) openPlayer(m);
  }
  // 频道卡等带 data-act 的非原生控件：方向键聚焦后用 Enter / 空格触发点击（点播卡、推荐项已有独立键盘处理，不重复）
  var actEl = document.activeElement;
  if(actEl && actEl.getAttribute && actEl.getAttribute('data-act') &&
     !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(actEl.tagName) &&
     !actEl.classList.contains('card') && !actEl.classList.contains('aside-item') &&
     (e.key === 'Enter' || e.key === ' ')){
    e.preventDefault();
    actEl.click();
  }
});
/* 视频事件 */
els.video.addEventListener('loadedmetadata', function(){
  if(!state.movie){ return; }
  if(state.playStats && state.playStats.startMs && !state.playStats.firstFrameMs){
    state.playStats.firstFrameMs = Date.now() - state.playStats.startMs;
  }
  setDiag('ready', els.video.readyState);
  setSrcLabel('正在播放 · ' + currentSources(state.movie)[state.srcIndex].label);
  els.video.playbackRate = state.rate;
  applyVolume(state.userVolume, false);
  syncSeek();
  var p = getProgress();
  var saved = p[state.movie.id] || 0;
  state.resumePos = 0;
  if(saved > 0 && isFinite(els.video.duration) && saved < els.video.duration - 3){
    state.resumePos = saved;
    showResumePrompt(saved);
  }
});
els.video.addEventListener('playing', function(){
  clearWatchdog();
  els.video.muted = state.userMuted;
  els.tap.classList.remove('show');
  khHideBuffering();
  setDiag('state','playing');
  if(state.movie && state.movie.live){
    var _ps = currentSources(state.movie)[state.srcIndex];
    if(_ps && _ps.url) markSrc(_ps.url, true);
    khPlayReport(khVideoCatalogId(state.movie), 'firstFrame', null, Date.now() - (state.playStartAt || Date.now()));
  }
  setDiag('ready', els.video.readyState);
  /* 续播二选一提示（data-resume）必须留到用户点选：首帧 playing 事件不能清空它，
     否则「上次看到 X · 继续观看 / 从头播放」一闪而过，进度记忆形同虚设。 */
  if(!(state.resumePos > 0 && els.msg.querySelector && els.msg.querySelector('[data-resume]'))){
    els.msg.textContent = '';
  }
  syncPlayBtn();
});
els.video.addEventListener('pause', syncPlayBtn);
els.video.addEventListener('waiting', function(){ if(state.playStats) state.playStats.buffering++; khShowBuffering('缓冲中…'); });
els.video.addEventListener('stalled', function(){ khShowBuffering('缓冲中…'); });
els.video.addEventListener('canplay', function(){ khHideBuffering(); });
els.video.addEventListener('error', function(){
  if(!state.movie) return;
  // 切换片源后，旧地址残留的异步 error 不应把当前播放重置掉
  var srcs = currentSources(state.movie);
  var expect = srcs[state.srcIndex] ? srcs[state.srcIndex].url : '';
  var tail = expect.split('/').pop().split('?')[0];
  var cur = els.video.currentSrc || '';
  if(tail && cur && cur.toLowerCase().indexOf(tail.toLowerCase()) < 0) return;
  state.lastVideoErr = els.video.error ? els.video.error.code : 0;
  setDiag('state','error');
  nextSource();
});
els.video.addEventListener('timeupdate', function(){ syncSeek(); saveProgress(false); });
els.video.addEventListener('ended', function(){
  if(!state.movie) return;
  if(state.movie.live){   // 直播流到尾自动从头续播，模拟 24h 轮播
    try{ els.video.currentTime = 0; playVideo(); }catch(e){}
    return;
  }
  var p = getProgress(); delete p[state.movie.id]; setStore('kh_prog', p);
  els.msg.textContent = '播放结束';
  syncPlayBtn();
});
window.addEventListener('error', function(ev){
  setDiag('error', String(ev && ev.message ? ev.message : 'unknown').slice(0, 120));
});

/* ---------------- 启动 ---------------- */
/* 内置种子（客户首次打开自动导入网站 + 影视仓接口；幂等、用户删除后不灌回） */
try{ khSeedBuiltin(); }catch(e){}
applyVolume(1, false);
render();
setDiag('boot', Date.now() - BOOT_AT);
/* 打开即与中枢对齐：源清单 / 平台清单 / 功能清单 / 问题单；之后每 10 分钟再对一次 */
setTimeout(function(){ try{ khBootSync(); }catch(e){} }, 700);
setInterval(function(){ try{ khBootSync(); }catch(e){} }, 10 * 60 * 1000);
if(/[?&]selftest=sites/.test(location.search)){
  state.view = 'sites'; render();
}
els.status.textContent = allMovies().length + ' 影视资源 · ' + LIVE_CHANNELS.length + ' 直播频道';
/* 源清单自动更新：本地覆盖 → 随包基线 → 原生桥云端最新；启动 1.2s 后拉取，之后每 10 分钟静默刷新 */
try{
  var _ov = getStore(SRC_OVERRIDE_KEY, null);
  if(_ov && _ov.channels) applySourceData({v:_ov.v, updatedAt:_ov.updatedAt, channels:_ov.channels}, 'local');
  var _sc = getStore(SITES_CLOUD_KEY, null);
  if(_sc && _sc.sites) applySiteData({v:_sc.v, sites:_sc.sites, searchTpl:_sc.searchTpl, quick:_sc.quick}, 'local');
  readEmbeddedSources();
}catch(e){}
setTimeout(requestSourceUpdate, 1200);
/* 问题中心：消费早期诊断缓存 → 拉取原生网页页错误 → 启动自检 → 每 10 分钟复检 */
(function(){
  var q = window.__KH_EARLY_ISSUES || [];
  for(var i=0;i<q.length && i<40;i++) issuePush(q[i].tag || '脚本', q[i].msg || '', {});
  window.__KH_EARLY_ISSUES = [];
})();
pullNativeIssues();
document.addEventListener('visibilitychange', function(){
  if(document.hidden){ try{ if(state.movie && els.video && !els.video.paused) els.video.pause(); }catch(e){} }
  else { pullNativeIssues(); }
});
setTimeout(function(){ runIssueSelfCheck(false); }, 3500);
setInterval(function(){ requestSourceUpdate(); runIssueSelfCheck(false); }, 600000);
els.statusWrap.classList.remove('busy');
setDiag('state','ready');

/* ===================== 窗口管理桥（网页侧，对接原生 KHNative） =====================
   原生 EntryAbility 负责：全屏布局、隐藏系统栏、监听安全区、方向、返回键。
   这里负责：接收安全区写进 CSS 变量、把"还能不能退一层"回报原生、处理原生转来的返回键。 */
(function () {
  if (!window.KH_HARMONY) return;
  var root = document.documentElement;
  function px(v) {
    if (typeof v === 'string') return v;            /* 允许直接传 env(...) 这类 CSS 值 */
    return (Number(v) || 0) + 'px';
  }

  /* 安全区：原生推过来 top/bottom/left/right（vp），写进 CSS 变量，页面按需避让 */
  window.applySafeArea = function (a) {
    try {
      a = a || {};
      root.style.setProperty('--kh-safe-top', px(a.top));
      root.style.setProperty('--kh-safe-bottom', px(a.bottom));
      root.style.setProperty('--kh-safe-left', px(a.left));
      root.style.setProperty('--kh-safe-right', px(a.right));
      root.style.setProperty('--kh-safe-h', px((Number(a.top) || 0) + (Number(a.bottom) || 0)));
      if (window.__KH_OS) { document.body && document.body.classList.add('kh-harmony'); }
      if (typeof applyOsAdapt === 'function') applyOsAdapt();
    } catch (e) {}
  };
  /* 默认值：还没收到原生推送时，先按系统 env() 安全区兜底（旧系统无桥也能避让） */
  window.applySafeArea({
    top: 'env(safe-area-inset-top, 0px)',
    bottom: 'env(safe-area-inset-bottom, 0px)',
    left: 'env(safe-area-inset-left, 0px)',
    right: 'env(safe-area-inset-right, 0px)'
  });

  /* 返回键：网页判断当前是否"还能退一层"（播放器打开 / 有页面历史） */
  function khCanGoBack() {
    try {
      var pl = document.getElementById('playerLayer');
      if (pl && pl.classList && pl.classList.contains('show')) return true;
      if (location.hash && location.hash !== '#' && location.hash !== '') return true;
    } catch (e) {}
    return false;
  }
  window.__KH_BACK = function () {
    try {
      var pl = document.getElementById('playerLayer');
      if (pl && pl.classList && pl.classList.contains('show') && typeof closePlayer === 'function') {
        closePlayer(); return;
      }
      if (location.hash && location.hash !== '#' && location.hash !== '') { history.back(); return; }
    } catch (e) {}
  };
  /* 把可返回状态同步给原生：只有 true 时原生才拦返回键，否则按系统默认退出 */
  var khLastBack = null;
  function khSyncBack() {
    try {
      var can = khCanGoBack();
      if (can === khLastBack) return;
      khLastBack = can;
      if (window.KHNative && typeof KHNative.setBackHandle === 'function') KHNative.setBackHandle(can);
    } catch (e) {}
  }
  setInterval(khSyncBack, 1200);
  try { window.addEventListener('hashchange', khSyncBack); } catch (e) {}
  try { document.addEventListener('click', function () { setTimeout(khSyncBack, 60); }, true); } catch (e) {}

  /* 方向：观影时锁横屏，列表页跟随系统；原生侧据此设置窗口方向 */
  window.khSetOrientation = function (mode) {
    try {
      if (window.KHNative && typeof KHNative.setOrientation === 'function') KHNative.setOrientation(String(mode || 'auto'));
    } catch (e) {}
  };

  /* 能力表：原生探测结果。旧系统缺哪个能力就跳过哪个，不靠版本号硬猜。 */
  window.khApplyCaps = function (caps) {
    try {
      if (caps && typeof caps === 'object') window.__KH_CAPS = caps;
      if (typeof applyOsAdapt === 'function') applyOsAdapt(window.__KH_CAPS || {});
    } catch (e) {}
  };
  function khCaps() {
    return (window.__KH_CAPS && typeof window.__KH_CAPS === 'object') ? window.__KH_CAPS : {};
  }

  /* 设备画像上报：让开发端能看到设备端 OS 版本、能力表、桥接是否生效。
     口径与问题上报一致——只有用户自己填过中枢地址才报，6 小时一次，不带内容数据。 */
  function khReportDevice() {
    try {
      var hub = '';
      try { hub = localStorage.getItem('khHub') || ''; } catch (e) {}
      if (!hub) return;
      var last = 0;
      try { last = Number(localStorage.getItem('khDeviceReportAt') || 0); } catch (e) { last = 0; }
      if (Date.now() - last < 6 * 3600 * 1000) return;
      var os = window.__KH_OS || {};
      var d = {
        schema: 1, app: 'HongHub', kind: 'device-profile', platform: 'kaihongos',
        deviceId: 'harmony-' + (os.deviceType || 'dev'),
        osVersion: os.distributionOSVersion || '',
        osName: os.distributionOSName || os.osFullName || '',
        apiVersion: String(os.sdkApiVersion || ''),
        deviceType: os.deviceType || '',
        caps: window.__KH_CAPS || {},
        version: String(window.__KH_APP_CODE || window.KH_APP_CODE || ''),
        ua: (navigator.userAgent || '').slice(0, 160)
      };
      fetch('/api/device/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d)
      }).then(function () {
        try { localStorage.setItem('khDeviceReportAt', String(Date.now())); } catch (e) {}
      }).catch(function () {});
    } catch (e) {}
  }
  setTimeout(khReportDevice, 3000);

  

  /* 观影自动横屏：播放器打开锁横屏，关闭回跟随系统；只在原生支持方向设置时才包 */
  (function khWrapPlayerOrientation() {
    function ready() {
      var c = khCaps();
      if (String(c.orientation) !== '1') return;
      try {
        if (typeof window.openPlayer === 'function' && !window.openPlayer.__khWrapped) {
          var o = window.openPlayer;
          window.openPlayer = function () {
            var r = o.apply(this, arguments);
            window.khSetOrientation('landscape');
            return r;
          };
          window.openPlayer.__khWrapped = true;
        }
        if (typeof window.closePlayer === 'function' && !window.closePlayer.__khWrapped) {
          var cl = window.closePlayer;
          window.closePlayer = function () {
            var r = cl.apply(this, arguments);
            window.khSetOrientation('auto');
            return r;
          };
          window.closePlayer.__khWrapped = true;
        }
      } catch (e) {}
    }
    ready();
    setTimeout(ready, 1500);
    setTimeout(ready, 4000);
  })();
})();


/* ===================== 深开鸿 KaihongOS / OpenHarmony 端适配 ===================== */
(function () {
  if (!window.KH_HARMONY) return;
  var KH_HUB_DEFAULT = 'http://192.168.1.5:8787';
  var KH_HUB_CANDIDATES = ["http://192.168.1.5:8787", "http://192.168.1.5:8788", "http://192.168.1.5:8890", "http://172.26.192.1:8787", "http://172.26.192.1:8788", "http://172.26.192.1:8890"];   // 构建时写入的本机所有可达地址
  var KH_HUB = (function () {
    try { return (localStorage.getItem('khHub') || KH_HUB_DEFAULT || '').replace(/\/+$/, ''); }
    catch (e) { return (KH_HUB_DEFAULT || ''); }
  })();
  window.KH_HUB = KH_HUB;   // 暴露当前中枢绝对地址，供 dev 变体拼接 /admin 等面板链接
  // 始终跟随操作系统（桌面中枢）版本：本机版本基线在首次成功同步时锁定为中枢当前版本，
  // 之后只有中枢发布「更高」版本才提示更新；重装后基线随 OS 版本自动对齐。
  var khSynced = false;
  window.KH_APP_CODE = 0;

  function khAccessToken() { try { return localStorage.getItem('khHubToken') || ''; } catch (e) { return ''; } }
  function khHeaders(o) {
    o = o || {}; var t = khAccessToken();
    if (t) {
      var h = o.headers;
      if (!h || typeof h !== 'object' || typeof h.append !== 'function') {
        o.headers = Object.assign({}, (h && typeof h === 'object') ? h : {}, { 'X-KH-Access-Token': t });
      }
    }
    return o;
  }
  // 让 /api/* 请求自动路由到桌面中枢（hub）；可选口令随请求自动带上
  try {
    var _f = window.fetch ? window.fetch.bind(window) : null;
    if (_f) {
      window.fetch = function (u, o) {
        o = khHeaders(o);
        if (typeof u === 'string' && u.indexOf('/api/') === 0 && KH_HUB) {
          u = KH_HUB + u; o = o || {}; o.mode = 'cors';
        }
        return _f(u, o);
      };
    }
  } catch (e) {}

  /* 中枢自动发现：IP 变了也能自己找回来。
     候选 = 上次成功地址 + 构建注入的本机所有 IP + 中枢 /health 下发的地址缓存 + 回环，
     并行探测 /health 且校验应用标识，命中即切换并记住；全部失败则保留原地址、不阻塞页面。 */
  function khHubList() {
    var out = [], seen = {};
    function add(u) {
      if (!u) return; u = String(u).replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(u) || seen[u]) return;
      seen[u] = 1; out.push(u);
    }
    try { add(localStorage.getItem('khHub')); } catch (e) {}
    add(KH_HUB_DEFAULT);
    (KH_HUB_CANDIDATES || []).forEach(add);
    try { JSON.parse(localStorage.getItem('khHubKnown') || '[]').forEach(add); } catch (e) {}
    add('http://127.0.0.1:8787');
    return out.slice(0, 14);
  }
  function khProbe(base) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 1400);
      function fin(v) { if (done) return; done = true; try { clearTimeout(timer); } catch (e) {} resolve(v); }
      try {
        window.fetch(base + '/health', { cache: 'no-store' })
          .then(function (r) { return r.json(); })
          .then(function (d) { fin(d && d.ok && d.app === 'HongHub-Desktop' ? d : null); })
          .catch(function () { fin(null); });
      } catch (e) { fin(null); }
    });
  }
  function khRememberHubs(d) {
    if (!d || !Array.isArray(d.hubs)) return;
    try {
      var known = [];
      try { known = JSON.parse(localStorage.getItem('khHubKnown') || '[]'); } catch (e) {}
      d.hubs.forEach(function (u) { if (known.indexOf(u) < 0) known.push(u); });
      localStorage.setItem('khHubKnown', JSON.stringify(known.slice(-20)));
    } catch (e) {}
  }
  function khDiscoverHub(cb) {
    var list = khHubList();
    if (!list.length) { cb(false); return; }
    var idx = 0, active = 0, finished = false, found = false;
    function next() {
      if (finished) return;
      if (idx >= list.length) { if (active === 0 && !finished) { finished = true; cb(found); } return; }
      var base = list[idx++]; active++;
      khProbe(base).then(function (d) {
        active--;
        if (!finished && d) {
          found = true; finished = true; khRememberHubs(d);
          if (KH_HUB !== base) {
            KH_HUB = base; window.KH_HUB = base;
            try { localStorage.setItem('khHub', base); } catch (e) {}
            try { khShowToast('🛰️ 中枢已自动切换：' + base); } catch (e) {}
          }
          cb(true); return;
        }
        next();
      });
    }
    for (var i = 0; i < Math.min(6, list.length); i++) next();
    setTimeout(function () { if (!finished) { finished = true; cb(found); } }, 6000);
  }

  // 设备画像（深开鸿端）：版本始终跟随中枢 / OS，不写死
  var khRel = (function () {
    try { var s = document.getElementById('kh-release'); return JSON.parse(s.textContent || s.innerHTML || '{}'); }
    catch (e) { return {}; }
  })();
  var khLocalVer = (khRel.latest && khRel.latest.versionName) || '1.7.0';
  var khLocalCode = Number(khRel.latest && khRel.latest.versionCode) || 0;
  // OS 版本跟随：从 ArkWeb UA 动态解析系统版本与 API 等级，不写死单一版本；
  // 回传中枢后由 device-optimizer 生成对应版本的兼容策略并自动下发同步更新。
  var khOsVer = (function(){
    var ua = navigator.userAgent || '';
    var m = /(?:KaihongOS|OpenHarmony|HarmonyOS)[\/\s]*([\d.]+)/i.exec(ua) ||
            /(?:Windows NT|Android|Mac OS X|iPhone OS)[\/\s]*([\d.]+)/i.exec(ua);
    return m ? m[1] : 'unknown';
  })();
  var khApi = (function(){ var m = /API\s*(\d+)/i.exec(navigator.userAgent || ''); return m ? Number(m[1]) : 11; })();
  var khDeviceProfile = {
    marketName: '深开鸿 KaihongOS', deviceType: 'tablet', model: 'HongHub-Harmony',
    abi: 'harmony', osFullName: 'KaihongOS ' + khOsVer, osVersion: khOsVer,
    ua: navigator.userAgent || '', apiVersion: khApi, minApi: 9, targetApi: khApi,
    tier: 'high', screenW: window.innerWidth || 1280, screenH: window.innerHeight || 720,
    densityDPI: 240, appVersion: khLocalVer + '-harmony', appCode: khLocalCode
  };
  try { window.__khSetDeviceProfile(khDeviceProfile); } catch (e) {}

  // 与桌面中枢保持同步（源清单 / 版本 / 扩展功能 / 自治状态 / 最终成品 / 反馈），无需重装
  var khLastGovern = null;
  var khLastFinal = null;      // 接收所有最终成品：中枢最近一次治理的全部产出
  var khFeedbacks = [];        // 自动反馈通道（含深开鸿端回传的成品）
  function sync() {
    if (!KH_HUB || !window.fetch) return;
    // 只要连上一次，就缓存中枢当前所有可达地址；日后 IP 变化可据此自动找回
    window.fetch(KH_HUB + '/health', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) { khRememberHubs(d); }).catch(function () {});
    window.fetch(KH_HUB + '/api/manifest', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.sources) window.__khApplySources(JSON.stringify(d.sources));
        if (d && d.release) window.__khSetRelease(JSON.stringify(d.release));
        var lat = d && d.release && d.release.latest;
        if (lat) {
          var hubCode = Number(lat.versionCode);
          // 始终跟随操作系统版本：以最近一次同步到的中枢版本作为本机基线
          var base = 0; try { base = Number(localStorage.getItem('khFollowedCode') || 0); } catch (e) {}
          if (!base) { try { localStorage.setItem('khFollowedCode', String(hubCode)); } catch (e) {} base = hubCode; }
          window.KH_APP_CODE = base;
          khSynced = true;
          if (hubCode > base) khShowHarmonyUpdateBanner(lat);
        }
      }).catch(function () {});
    // 功能随发版同步：一次拿到版本快照 + 完整功能清单，面板显示「功能 vX · N 项」
    window.fetch(KH_HUB + '/api/features/sync', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) { if (d && Array.isArray(d.features)) window.__khLoadFeatures(d.features, d.version); }).catch(function () {});
    // 拉取中枢「自动优化 / 自治」状态，深开鸿端实时呈现
    window.fetch(KH_HUB + '/api/govern', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.lastRun) { khLastGovern = d.lastRun; khRenderHub(); } }).catch(function () {});
    // 接收所有最终成品：拉取中枢治理产出 + 自动反馈通道
    window.fetch(KH_HUB + '/api/feedback', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.finalProducts) { khLastFinal = d.finalProducts; khRenderFinal(); }
        if (d && Array.isArray(d.feedback)) { khFeedbacks = d.feedback; khRenderFinal(); }
      }).catch(function () {});
  }
  khDiscoverHub(function () { sync(); });
  setInterval(sync, 15000);
  setInterval(function () { khDiscoverHub(function () {}); }, 120000);  // 每 2 分钟复核一次中枢可达性

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function khFmtTime(ts) {
    if (!ts) return '暂无';
    try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return String(ts); }
  }

  // 轻量提示条（优化结果反馈）
  function khShowToast(msg) {
    try {
      var t = document.getElementById('khHarmonyToast');
      if (!t) {
        t = document.createElement('div'); t.id = 'khHarmonyToast';
        t.setAttribute('style', 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9997;background:#1B2233;color:#E7ECF5;border:1px solid #3A4256;border-radius:10px;padding:8px 12px;font:12px/1.4 sans-serif;box-shadow:0 6px 22px rgba(0,0,0,.5);max-width:92vw');
        document.body.appendChild(t);
      }
      t.textContent = msg; t.style.display = 'block';
      clearTimeout(t._t); t._t = setTimeout(function () { t.style.display = 'none'; }, 5200);
    } catch (e) {}
  }

  // 自动更新检查：发现中枢发布的新版本即提示（深开鸿端也能自动更新）
  function khHarmonyUpdateCheck() {
    if (!KH_HUB || !window.fetch || !khSynced) return;   // 先完成首次同步建立基线，避免误报
    window.fetch(KH_HUB + '/api/manifest', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) {
        var lat = d && d.release && d.release.latest;
        if (!lat) return;
        if (Number(lat.versionCode) > Number(window.KH_APP_CODE || 0)) khShowHarmonyUpdateBanner(lat);
      }).catch(function () {});
  }
  function khShowHarmonyUpdateBanner(lat) {
    try {
      if (document.getElementById('khHarmonyUpdateBanner')) return;
      try { if (localStorage.getItem('khHarmonyDismissed') === String(lat.versionCode)) return; } catch (e) {}
      var url = KH_HUB + (lat.hapUrl || '/download/honghub-harmony.hap');
      var shaTip = lat.hapSha256 ? '<div style="color:#9AA6C4;font-size:11px;margin-top:4px">SHA256 ' + esc(String(lat.hapSha256).slice(0, 16)) + '… · 下载后请核对</div>' : '';
      var b = document.createElement('div'); b.id = 'khHarmonyUpdateBanner';
      b.setAttribute('style', 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:9996;background:#1B2233;color:#E7ECF5;border:1px solid #3A4256;border-radius:12px;padding:10px 14px;font:13px/1.4 sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);max-width:92vw');
      b.innerHTML = '🆕 发现新版本 v' + esc(lat.versionName) + '（#' + esc(lat.versionCode) + '） <button id="khUpdBtn" style="border:0;border-radius:8px;padding:4px 10px;background:#2563EB;color:#fff;cursor:pointer;margin-left:6px">⬇️ 下载更新包</button> <span id="khUpdClose" style="cursor:pointer;margin-left:6px;color:#9AA6C4">✕</span>' + shaTip +
        '<div style="color:#9AA6C4;font-size:11px;margin-top:4px">下载后由系统安装器 / hdc 完成安装（应用内不静默安装）</div>';
      document.body.appendChild(b);
      document.getElementById('khUpdBtn').onclick = function () {
        try {
          if (window.KaihongBridge && typeof window.KaihongBridge.openUpdatePage === 'function') {
            window.KaihongBridge.openUpdatePage(url);
          } else { window.open(url, '_blank'); }
        } catch (e) { window.open(url, '_blank'); }
        khShowToast('📦 更新包开始下载，请核对 SHA256 后在系统安装器中安装');
      };
      document.getElementById('khUpdClose').onclick = function () { try { localStorage.setItem('khHarmonyDismissed', String(lat.versionCode)); } catch (e) {} b.style.display = 'none'; };
    } catch (e) {}
  }
  khHarmonyUpdateCheck();
  setInterval(khHarmonyUpdateCheck, 15000);

  // 设备端触发「自动优化」：驱动桌面中枢执行 提取问题→自愈→优化→发布→补装功能
  var khOptBtn = null;
  function khHarmonyOptimize() {
    if (!KH_HUB || !window.fetch) { khShowToast('⚠️ 未连接中枢，无法优化'); return; }
    if (khOptBtn) { khOptBtn.disabled = true; khOptBtn.textContent = '🤖 优化中…'; }
    window.fetch(KH_HUB + '/api/govern/run', { method: 'POST', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var res = d && d.result && d.result.result;
        if (d && d.ok && res) {
          if (res.published && res.published.skipped) {
            khShowToast('✅ 已优化：无实质变化，无需发新版（移除坏源 ' + (res.optimized && res.optimized.removed) + ' 条，新增功能 ' + ((res.featuresAdded) || []).length + ' 个）');
          } else {
            khShowToast('✅ 已优化并发布：移除坏源 ' + (res.optimized && res.optimized.removed) + ' 条，新增功能 ' + ((res.featuresAdded) || []).length + ' 个，版本升至 ' + ((res.published && res.published.versionName) || '') + '（深开鸿端将自动提示更新）');
          }
        } else {
          khShowToast('⚠️ 优化失败：' + ((d && d.result && d.result.error) || '未知错误'));
        }
        sync();
      })
      .catch(function (e) { khShowToast('⚠️ 优化请求失败：' + e); })
      .then(function () { if (khOptBtn) { khOptBtn.disabled = false; khOptBtn.textContent = '🤖 优化'; } });
  }
  // 自动优化：默认开启；每小时评估，距上次请求 > 6 小时且中枢可达才触发，避免频繁
  function khAutoOptimizeTick() {
    try { if (localStorage.getItem('khAutoOptimize') === '0') return; } catch (e) {}
    if (!KH_HUB || !window.fetch) return;
    var last = 0; try { last = Number(localStorage.getItem('khOptReqAt') || 0); } catch (e) {}
    if (Date.now() - last < 6 * 3600 * 1000) return;
    try { localStorage.setItem('khOptReqAt', String(Date.now())); } catch (e) {}
    khHarmonyOptimize();
  }
  setInterval(khAutoOptimizeTick, 60 * 60 * 1000);

  // 反馈回来：把本机诊断与「最终成品」回传中枢，并驱动中枢执行 自动优化/自动修复/自动更新 闭环
  function khHarmonyFeedback() {
    if (!KH_HUB || !window.fetch) { khShowToast('⚠️ 未连接中枢，无法反馈'); return; }
    khShowToast('📡 正在回传本机诊断与最终成品到中枢…');
    // 1) 走原有上报通道（兼容看板统计）
    var payload = {
      schema: 1, app: 'HongHubMovie',
      deviceId: 'harmony-' + (KH_HUB || 'local'), version: khLocalVer + '-harmony', device: 'KaihongOS', sentAt: Date.now(),
      issues: [{
        kind: 'harmony-heartbeat', sev: 'info',
        msg: '深开鸿端请求：自动优化 / 自动修复 / 自动更新', n: 1,
        ts: Date.now(), view: 'harmony', host: KH_HUB
      }]
    };
    try {
      window.fetch(KH_HUB + '/api/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function () {});
    } catch (e) {}
    // 2) 接收所有最终成品：把本机产物回传中枢 /api/feedback（中枢纳入治理与反馈通道）
    try {
      var finalProducts = khLastFinal || {};
      window.fetch(KH_HUB + '/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device: 'KaihongOS', payload: {
            kind: 'harmony-final-products', sev: 'info',
            msg: '深开鸿端回传最终成品', n: 1, ts: Date.now(), view: 'harmony', host: KH_HUB,
            finalProducts: finalProducts, followedCode: window.KH_APP_CODE || 0
          }
        })
      }).catch(function () {});
    } catch (e) {}
    // 3) 驱动中枢执行 提取问题→建议提取→自动反馈→自动优化→加更新→自动更新加发布
    khHarmonyOptimize();
  }

  khHarmonyHubUI();
  khRenderHub();

  function khRenderHub() {
    try {
      var st = document.getElementById('khGovTime'); if (st) st.textContent = khFmtTime(khLastGovern && khLastGovern.finishedAt);
      var ok = document.getElementById('khGovOk'); if (ok) ok.textContent = (khLastGovern && khLastGovern.ok) ? '成功' : '未成功';
    } catch (e) {}
  }

  // 接收所有最终成品：把中枢治理产出的「建议 / 优化 / 更新 / 发布 / 反馈」在深开鸿端呈现
  function khRenderFinal() {
    try {
      var panel = document.getElementById('khFinalPanel');
      if (!panel) return;
      if (panel.style.display === 'none') return; // 用户收起时不刷新 DOM
      var h = '';
      if (khLastFinal) {
        var f = khLastFinal;
        var sugg = (f.suggestions || []).map(function (s) {
          return '<li>💡 ' + esc(s.title) + (s.detail ? ' <span style="color:#8A8FA3">（' + esc(s.detail) + '）</span>' : '') + '</li>';
        }).join('');
        var upd = f.updated || {};
        var pub = f.published || {};
        h += '<div style="font-weight:700;margin:6px 0 2px">🧠 建议提取（' + ((f.suggestions || []).length) + '）</div><ul style="margin:2px 0;padding-left:18px">' + (sugg || '<li style="color:#8A8FA3">暂无</li>') + '</ul>';
        h += '<div style="margin:4px 0;line-height:1.6">🔧 自动优化：<b style="color:#4ADE80">' + ((f.optimized && f.optimized.removed) || 0) + '</b> 条失效源已处理 · ' + ((f.optimized && f.optimized.channels) || 0) + ' 个频道<br>'
          + '🛠️ 加更新（自愈）：' + (upd.ok ? '✅ 成功' : '—') + (upd.skipped ? '（跳过：无问题）' : '') + '<br>'
          + '🚀 自动更新加发布：' + (pub.skipped ? '跳过（无实质变更，不发新版）' : (pub.ok ? ('已发布 v' + esc(pub.versionName) + ' #' + esc(pub.versionCode)) : '—')) + '</div>';
      } else {
        h += '<div style="color:#8A8FA3">尚未收到中枢产出，请先连接中枢或点击「🤖 优化」。</div>';
      }
      // 自动反馈通道（含深开鸿端回传）
      var fb = (khFeedbacks || []).slice(0, 8).map(function (x) {
        var t = khFmtTime(x.at || x.startedAt);
        var s = x.suggestions ? ('建议 ' + ((x.suggestions || []).length) + ' 条') : '';
        var ok = x.ok ? '✅' : '⚠️';
        return '<li>' + ok + ' ' + esc(t) + ' ' + esc((x.type || 'govern')) + (s ? ' · ' + esc(s) : '') + '</li>';
      }).join('');
      h += '<div style="font-weight:700;margin:6px 0 2px">📡 自动反馈（' + (khFeedbacks || []).length + '）</div><ul style="margin:2px 0;padding-left:18px">' + (fb || '<li style="color:#8A8FA3">暂无</li>') + '</ul>';
      panel.innerHTML = h;
    } catch (e) {}
  }

  function khHarmonyHubUI() {
    try {
      var bar = document.createElement('div'); bar.id = 'khHubBar';
      bar.setAttribute('style', 'position:fixed;left:8px;top:8px;z-index:9998;background:#1B2233;color:#E7ECF5;' +
        'border:1px solid #3A4256;border-radius:10px;padding:6px 8px;font:12px/1.3 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);max-width:94vw');
      var autoOn = true; try { autoOn = localStorage.getItem('khAutoOptimize') !== '0'; } catch (e) {}
      bar.innerHTML =
        '🛰️ 中枢：<span id="khHubState" style="color:#9AA6C4">' + (KH_HUB || '未连接') + '</span> ' +
        '<span id="khHubSet" style="color:#7FA8FF;cursor:pointer;margin-left:4px">设置</span><br>' +
        '🤖 自动优化：<span id="khGovTime" style="color:#9AA6C4">—</span> (<span id="khGovOk" style="color:#9AA6C4">—</span>) ' +
        '<label style="color:#9AA6C4;cursor:pointer;margin-left:4px"><input type="checkbox" id="khAutoChk"' + (autoOn ? ' checked' : '') + '>开</label> ' +
        '<button id="khOptBtn" style="border:0;border-radius:8px;padding:2px 8px;background:#2563EB;color:#fff;cursor:pointer;margin-left:4px;font-size:11px">🤖 优化</button> ' +
        '<button id="khFbBtn" style="border:0;border-radius:8px;padding:2px 8px;background:#16A34A;color:#fff;cursor:pointer;margin-left:4px;font-size:11px">📡 反馈</button> ' +
        '<button id="khFinalBtn" style="border:0;border-radius:8px;padding:2px 8px;background:#7C3AED;color:#fff;cursor:pointer;margin-left:4px;font-size:11px">📋 成品</button> ' +
        '<button id="khHubDiscover" style="border:0;border-radius:8px;padding:2px 8px;background:#334155;color:#fff;cursor:pointer;margin-left:4px;font-size:11px">🔄 重连</button> ' +
        '<button id="khHubToken" style="border:0;border-radius:8px;padding:2px 8px;background:#B45309;color:#fff;cursor:pointer;margin-left:4px;font-size:11px">🔑 口令</button>';
      document.body.appendChild(bar);
      // 全部最终成品面板（默认收起，点 📋 成品 展开）
      var panel = document.createElement('div'); panel.id = 'khFinalPanel';
      panel.setAttribute('style', 'display:none;position:fixed;left:8px;top:64px;z-index:9997;background:#12141e;color:#E7ECF5;border:1px solid #3A4256;border-radius:12px;padding:12px 14px;font:12px/1.5 sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.55);max-width:min(92vw,420px);max-height:78vh;overflow:auto');
      document.body.appendChild(panel);
      var setBtn = document.getElementById('khHubSet');
      if (setBtn) setBtn.onclick = function () {
        var v = prompt('填写桌面中枢地址（支持局域网IP / 公网IP / DDNS）：', KH_HUB || 'http://');
        if (v) { try { localStorage.setItem('khHub', v.replace(/\/+$/, '')); } catch (e) {} location.reload(); }
      };
      var disco = document.getElementById('khHubDiscover');
      if (disco) disco.onclick = function () {
        khShowToast('🛰️ 正在重新发现中枢…');
        khDiscoverHub(function (ok) {
          khShowToast(ok ? ('✅ 已连接中枢：' + KH_HUB) : '⚠️ 未发现中枢，可在「设置」里填写地址');
          var st = document.getElementById('khHubState'); if (st) st.textContent = KH_HUB || '未连接';
          sync();
        });
      };
      var tokBtn = document.getElementById('khHubToken');
      if (tokBtn) tokBtn.onclick = function () {
        var v = prompt('填写中枢访问口令（中枢未开启口令时留空即可）：', khAccessToken());
        if (v === null) return;
        try { localStorage.setItem('khHubToken', v); } catch (e) {}
        khShowToast(v ? '🔑 口令已保存' : '🔑 已清除口令');
        sync();
      };
      khOptBtn = document.getElementById('khOptBtn');
      if (khOptBtn) khOptBtn.onclick = function () { khHarmonyOptimize(); };
      var fbBtn = document.getElementById('khFbBtn');
      if (fbBtn) fbBtn.onclick = function () { khHarmonyFeedback(); };
      var finalBtn = document.getElementById('khFinalBtn');
      if (finalBtn) finalBtn.onclick = function () {
        var p = document.getElementById('khFinalPanel');
        if (!p) return;
        if (p.style.display === 'none') { p.style.display = 'block'; khRenderFinal(); }
        else { p.style.display = 'none'; }
      };
      var chk = document.getElementById('khAutoChk');
      if (chk) chk.onchange = function () { try { localStorage.setItem('khAutoOptimize', chk.checked ? '1' : '0'); } catch (e) {} khShowToast(chk.checked ? '✅ 已开启自动优化' : '⏸️ 已关闭自动优化'); };
    } catch (e) {}
  }

  /* ===== TV / 遥控器空间焦点导航（无触摸屏设备可用方向键选条目，Enter 打开）===== */
  (function khTvSpatialNav() {
    var CLS = 'kh-focus-ring';
    try {
      var st = document.createElement('style');
      st.textContent = '.' + CLS + '{outline:3px solid #ffd84d !important;outline-offset:2px !important;' +
        'box-shadow:0 0 0 4px rgba(255,216,77,.22) !important;border-radius:8px}' +
        '.' + CLS + ':focus{outline:3px solid #ffd84d !important}';
      document.head.appendChild(st);
    } catch (e) {}

    function focusables() {
      var all = document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
      return Array.prototype.filter.call(all, function (el) {
        if (el.disabled) return false;
        if (el.offsetParent === null) return false;
        var r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return false;
        if (r.bottom < 0 || r.top > (window.innerHeight + 8)) return false;
        return true;
      });
    }
    function middle(el) {
      var r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    function move(dir) {
      var list = focusables();
      if (!list.length) return false;
      var cur = document.activeElement;
      if (!cur || list.indexOf(cur) < 0) { list[0].focus(); cur = list[0]; if (document.activeElement !== cur) return false; }
      var c = middle(cur), best = null, score = Infinity;
      list.forEach(function (el) {
        if (el === cur) return;
        var p = middle(el), dx = p.x - c.x, dy = p.y - c.y, ok = false, d = 0;
        if (dir === 'left') { ok = dx < -6; d = Math.abs(dx) + Math.abs(dy) * 2.2; }
        else if (dir === 'right') { ok = dx > 6; d = Math.abs(dx) + Math.abs(dy) * 2.2; }
        else if (dir === 'up') { ok = dy < -6; d = Math.abs(dy) + Math.abs(dx) * 2.2; }
        else if (dir === 'down') { ok = dy > 6; d = Math.abs(dy) + Math.abs(dx) * 2.2; }
        if (ok && d < score) { score = d; best = el; }
      });
      if (!best) {
        /* 同方向找不到：跳到行列边缘（类似遥控"一直按到底"的重回环） */
        if (dir === 'down' || dir === 'right') best = list[0];
        else best = list[list.length - 1];
        if (best === cur) return false;
      }
      try { best.classList.add(CLS); best.focus(); } catch (e) { return false; }
      try {
        var t = best.getBoundingClientRect();
        if (t.top < 60 || t.bottom > window.innerHeight - 40) best.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch (e) {}
      return true;
    }
    function playerVisible() {
      var v = document.querySelector('video');
      if (!v) return false;
      return v.offsetParent !== null;
    }
    document.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'Enter') return;
      if (playerVisible() && k !== 'Enter') return;               /* 播放器里方向键交给原有快进/切台逻辑 */
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (k === 'Enter') {
        var a = document.activeElement;
        if (!a || a === document.body) { if (move('down')) e.preventDefault(); }
        return;                                                    /* Enter 交给浏览器原生点击 */
      }
      if (move(k)) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    window.khTvNavMove = move;
  })();
})();


/* ===================== 桌面版 HongHub-Desktop 适配 ===================== */
/* 说明：window.KH_DESKTOP 已置 true；ISSUE_REMOTE_DEFAULT 已指向 /api/report，
   远程收集默认开启（用户可在「问题」中心暂停）。以下实现：实时拉取清单/功能 + 扩展工具入口。 */

/* 可选访问口令：中枢开启 KH_ACCESS_TOKEN 后，所有 /api 请求自动带上口令 */
(function () {
  try {
    var _f = window.fetch ? window.fetch.bind(window) : null;
    if (!_f) return;
    window.fetch = function (u, o) {
      o = o || {};
      var t = ''; try { t = localStorage.getItem('khAccessToken') || localStorage.getItem('kh_access_token') || ''; } catch (e) {}
      if (t && typeof u === 'string' && u.indexOf('/api/') >= 0) {
        var h = o.headers;
        if (!h || typeof h !== 'object' || typeof h.append !== 'function') {
          o.headers = Object.assign({}, (h && typeof h === 'object') ? h : {}, { 'X-KH-Access-Token': t });
        }
      }
      return _f(u, o);
    };
  } catch (e) {}
})();

var KH_APP_CODE = 1000199;   // 当前客户端版本号（构建/发版时注入），用于自动更新比对
window.KH_APP_VERSION = window.KH_APP_VERSION || '1.7.70';   // 版本名（发版时同样会被注入覆盖），升级失败横幅按名字比较归档
var KH_PRODUCT = '鸿汇影';   // 产品名（单点配置，改名只需改 build_desktop.py 顶部 PRODUCT_NAME）

/* 自动更新落地：校验安装包 SHA256 → 拉起安装向导（用户仍需在向导里确认） */
function khInstallUpdate() {
  var latest = window.KH_RELEASE && window.KH_RELEASE.latest;
  var pre;
  try { pre = khUpgradePrecheck(latest, {}); } catch (e) { pre = {ok:true}; }
  if (!pre.ok) { khUpgradeSetStage('failed', pre.reason, {failKind: pre.kind}); toast('⚠️ ' + pre.reason); return; }
  if (!confirm('将校验最新安装包并以「覆盖安装」方式更新：\n· 无需先卸载当前版本，也无需手动删除任何文件；\n· 同目录覆盖安装，你的数据与设置都会保留；\n· 若提示程序被占用，请先退出本应用再继续。\n继续吗？')) { khUpgradeSetStage('failed', '用户在确认框取消安装', {failKind:'cancel'}); return; }
  try { khMarkUpgradeAttempt('install'); } catch (e) {}
  khUpgradeSetStage('verify', '正在校验安装包 SHA256…');
  var fallbackUrl = latest && (latest.downloadPage || latest.downloadUrl || latest.hapUrl);
  fetch('/api/update/install', { method: 'POST', cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.ok) {
        khUpgradeSetStage('done', '安装向导已启动（v' + (d.version || '') + ' · ' + (d.verified === 'sha256' ? 'SHA256 校验通过' : '体积校验通过') + '）');
        try { toast('✅ 安装向导已启动（v' + (d.version || '') + ' · ' + (d.verified === 'sha256' ? 'SHA256 校验通过' : '体积校验通过') + '）'); } catch (e) {}
      } else {
        var reason = (d && d.error) || '未知错误';
        var kind = khUpgradeFailKind(reason);
        khUpgradeSetStage('failed', reason, {failKind: kind});
        try { toast('⚠️ 未能启动安装：' + reason + '，已为你打开下载页'); } catch (e) {}
        khOpenUpdate(fallbackUrl);
      }
    })
    .catch(function (e) {
      var reason = e && e.message || String(e);
      var kind = khUpgradeFailKind(reason);
      khUpgradeSetStage('failed', '安装请求失败：' + reason, {failKind: kind});
      try { toast('⚠️ 安装请求失败：' + reason + '，已为你打开下载页'); } catch (e2) {}
      khOpenUpdate(fallbackUrl);
    });
}

function khShowUpdateBanner(lat) {
  try {
    if (document.getElementById('khUpdateBanner')) return;
    try { if (localStorage.getItem('khDismissedVer') === String(lat.versionCode)) return; } catch (e) {}
    var b = document.createElement('div'); b.id = 'khUpdateBanner';
    b.setAttribute('style', 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:9995;background:#1B2233;color:#E7ECF5;border:1px solid #3A4256;border-radius:12px;padding:10px 14px;font:13px/1.4 sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);max-width:92vw');
    var shaTip = lat.desktopSha256 ? ' <span style="color:#9AA6C4;font-size:11px">SHA256 ' + esc(String(lat.desktopSha256).slice(0, 12)) + '…</span>' : '';
    b.innerHTML = '🆕 发现新版本 v' + esc(lat.versionName) + '（#' + esc(lat.versionCode) + '）' + shaTip +
      ' <span style="color:#9CC5FF;font-size:11px;margin-left:6px">内容已自动更新；本体覆盖安装无需卸载</span>' +
      ' <button id="khUpdBtn" style="border:0;border-radius:8px;padding:4px 10px;background:#2563EB;color:#fff;cursor:pointer;margin-left:6px">⬇️ 下载安装包</button>' +
      ' <button id="khUpdInstall" style="border:0;border-radius:8px;padding:4px 10px;background:#16A34A;color:#fff;cursor:pointer;margin-left:6px">⚡ 覆盖安装（免卸载）</button>' +
      ' <span id="khUpdClose" style="cursor:pointer;margin-left:6px;color:#9AA6C4">✕</span>';
    document.body.appendChild(b);
    document.getElementById('khUpdBtn').onclick = function () {
      var pick = khUpgradePickUrl(lat);
      khUpgradeSetStage('download', pick.kind === 'delta' ? '优先使用增量包下载…' : '正在下载整包安装包…', {channel: pick.kind});
      khOpenUpdate(pick.url || lat.downloadPage || '');
    };
    var ib = document.getElementById('khUpdInstall');
    if (ib) ib.onclick = function () { khInstallUpdate(); };
    document.getElementById('khUpdClose').onclick = function () { try { localStorage.setItem('khDismissedVer', String(lat.versionCode)); } catch (e) {} b.style.display = 'none'; };
  } catch (e) {}
}

/* 功能快照：发版时由 harmony/build_hap.py 注入真实功能清单，
   开发者端 / 深开鸿设备端即使中枢离线也能看到自动添加的新功能；在线清单随后覆盖。 */
var KH_FEATURE_SNAPSHOT = [{"id": "board", "name": "远程问题看板", "desc": "查看所有用户自动上报的脱敏问题摘要与高频类别 Top", "action": "open", "url": "/"}, {"id": "report", "name": "生成诊断报告", "desc": "汇总设备 / 源清单 / 问题明细并复制到剪贴板，便于反馈", "action": "builtin:report"}, {"id": "sourcespeed", "name": "源线路排行", "desc": "按可用线路数对所有直播频道排序，快速定位弱信号频道", "action": "builtin:sourcespeed"}, {"id": "fix", "name": "一键自愈", "desc": "触发源体检重排并刷新线上清单（修复坏源 / 降级失效线路）", "action": "builtin:fix"}, {"id": "updatepublish", "name": "同步更新发布", "desc": "一键同时重排源（更新）+ 升级版本号（发布），所有桌面端实时拉取新版本", "action": "builtin:updatepublish"}, {"id": "automation", "name": "自动化运行", "desc": "查看定时更新+发布状态、运行历史，并立即触发一次自动化（与看板「⚙️ 自动化运行」一致）", "action": "builtin:automation"}, {"id": "updatecheck", "name": "检查新版本", "desc": "立即向服务查询是否有新版本，若有则弹出「下载并安装」横幅（自动更新）", "action": "builtin:updatecheck"}, {"id": "govern", "name": "智能自治", "desc": "一键运行自治循环：提取问题→修复坏源→优化清单→发布新版本→自动补装缺失的预设功能", "action": "builtin:govern"}, {"id": "preset-open-dashboard", "name": "打开在线看板", "desc": "一键打开远程问题看板（收集 / 自愈 / 自动化 / 功能管理），免记地址", "action": "open", "icon": "📊", "enabled": false, "confirm": false, "url": "/"}, {"id": "preset-dingtalk", "name": "钉钉通知", "desc": "向钉钉群机器人推送「自治完成 / 问题告警」消息。点「编辑」把机器人地址里的“在此粘贴”换成你的 Webhook 即可用。", "action": "webhook", "icon": "📨", "enabled": false, "confirm": false, "url": "https://oapi.dingtalk.com/robot/send?access_token=在此粘贴", "payload": {"msgtype": "text", "text": {"content": "HongHub 自治已完成，源清单已刷新"}}}, {"id": "preset-wecom", "name": "企业微信通知", "desc": "向企业微信群机器人推送通知。编辑时把地址里的“在此粘贴”换成你的 key。", "action": "webhook", "icon": "💬", "enabled": false, "confirm": false, "url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=在此粘贴", "payload": {"msgtype": "text", "content": {"content": "HongHub 自治已完成，源清单已刷新"}}}, {"id": "preset-feishu", "name": "飞书通知", "desc": "向飞书群机器人推送通知。编辑时把地址里的“在此粘贴”换成你的 Webhook。", "action": "webhook", "icon": "📲", "enabled": false, "confirm": false, "url": "https://open.feishu.cn/open-apis/bot/v2/hook/在此粘贴", "payload": {"msg_type": "text", "content": {"text": "HongHub 自治已完成，源清单已刷新"}}}, {"id": "preset-backup", "name": "每日自动备份清单", "desc": "运行一条命令把当前 manifest 源清单备份到 server/backup/（建议配合「自动化运行」一起用）。", "action": "script", "icon": "💾", "enabled": false, "confirm": true, "cmd": "node -e \"const fs=require('fs');fs.mkdirSync('server/backup',{recursive:true});fs.copyFileSync('server/manifest.json','server/backup/manifest.'+Date.now()+'.json');console.log('已备份清单到 server/backup')\""}, {"id": "preset-broadcast", "name": "定时播报可看内容", "desc": "运行命令生成本次可播放频道数摘要（可接自动化，或改成推到你自己的通知渠道）。", "action": "script", "icon": "📣", "enabled": false, "confirm": true, "cmd": "node -e \"const m=require('./server/manifest.json');const c=m.sources.channels.length;const s=m.sources.channels.reduce((a,b)=>a+(b.sources?b.sources.length:0),0);console.log('可播放：'+c+' 频道 / '+s+' 条线路')\""}, {"id": "feature-mine", "name": "反馈建议自动提取新功能", "desc": "自动从反馈 / 建议 / 上报里提取新功能诉求，去重后自动加入功能清单并随发版同步", "action": "builtin:mine", "enabled": true, "origin": "feedback-auto", "minedAt": "2026-11-14T12:04:11.574Z"}, {"id": "auto-batch", "name": "自动批量下发", "desc": "自动生成本次发版的批量分发清单（多架构安装包 / 开鸿 HAP / 校验值），两端自动按架构取包", "action": "builtin:batch", "enabled": true, "origin": "feedback-auto", "minedAt": "2026-11-14T12:04:11.576Z"}, {"id": "arch-adaptive", "name": "全架构自适应", "desc": "自动识别 x64 / ia32 / arm64 并选择对应安装包；无原生包时回退通用包，弱机自动降档播放", "action": "builtin:arch", "enabled": true, "origin": "feedback-auto", "minedAt": "2026-11-14T12:04:11.576Z"}, {"id": "play-smooth", "name": "自适应流畅播放", "desc": "按 CPU / 内存 / 架构自动调整缓冲与码率上限，卡顿自动降档与切换备用源", "action": "builtin:playback", "enabled": true, "origin": "feedback-auto", "minedAt": "2026-11-14T12:04:11.576Z"}, {"id": "mem-adaptive", "name": "不限内存大小都能看", "desc": "自动下发按内存档选免安装轻量版或完整安装包；播放缓冲字节数与码率按内存设硬上限，小内存机器也能流畅看", "action": "builtin:memory", "enabled": true, "origin": "feedback-auto", "minedAt": "2026-11-14T12:04:11.576Z"}, {"id": "auto-update", "name": "成品自动更新", "desc": "两端启动自动比对版本，自动拉取最新功能 / 播放档位 / 成品校验值；低内存免安装通道永远最新，不制造假更新", "action": "builtin:update", "enabled": true, "origin": "feedback-auto", "minedAt": "2026-11-14T12:04:11.576Z"}, {"id": "os-follow", "name": "跟随所有操作系统版本", "desc": "自动检测并回传 OS 版本 / API / 架构 / 内存，按系统版本自动优化兼容策略、自动修复漂移后下发同步更新", "action": "builtin:os", "enabled": true, "origin": "feedback-auto", "minedAt": "2026-11-14T12:19:13.749Z"}, {"id": "ops-audit", "name": "开发者端审计日志", "desc": "自愈 / 发布 / 功能增删 / 回滚 / 自动化全部留痕，可按条数与结果查询", "action": "builtin:audit", "enabled": true}, {"id": "ops-trend", "name": "数据趋势报表", "desc": "按天累积源可用率、更新成功率、设备回传与失败 Top，趋势面板直读", "action": "builtin:trend", "enabled": true}, {"id": "ops-rollout", "name": "灰度分批放量", "desc": "按匿名设备 ID 稳定落组（权重切片），失败率超阈值自动暂停，人工确认后恢复", "action": "builtin:rollout", "enabled": true}, {"id": "ops-publish", "name": "发布并校验闭环", "desc": "上传（配置上传命令才真传）→ 回读远端清单核对版本与 SHA256，不一致明确报「仅本地就绪」", "action": "builtin:publish", "enabled": true}, {"id": "ops-smoke", "name": "真机冒烟结果", "desc": "读取真机冒烟与热插拔巡检结果；没跑过就明确报 no-run，绝不假装通过", "action": "builtin:smoke", "enabled": true}, {"id": "ops-alerts", "name": "告警分级", "desc": "critical / warn / info 归并去重，同码同窗口合并计数，不再重复播报", "action": "builtin:alerts", "enabled": true}, {"id": "ops-catalog", "name": "全量资源目录与自动探测", "desc": "频道 + 网络平台统一成带版本号的目录，定时探测可达性；客户端按增量热更新，源修好不用发新版", "action": "builtin:catalog", "enabled": true}, {"id": "ops-play", "name": "播放回传与失败聚合", "desc": "客户端播放失败自动回传（只记资源与结果，不记内容与 IP），按资源聚合失败率与错误码", "action": "builtin:play", "enabled": true}, {"id": "ops-issues", "name": "问题自动建单与自动修复", "desc": "探测失败或失败率超阈值自动建单 → 频道自动换可用源 → 复检通过自动关单，全程无人工", "action": "builtin:issues", "enabled": true}, {"id": "kid-mode", "name": "儿童时段模式", "desc": "按时段屏蔽成人分组，带 4 位解锁码，家长可随时关闭", "action": "builtin:kidmode"}, {"id": "handoff", "name": "双端接力·推送", "desc": "把桌面端收藏打包成 6 位接力码，开鸿设备输码即可取回", "action": "builtin:handoff"}, {"id": "handoff-take", "name": "双端接力·接收", "desc": "输入接力码取回另一台设备推送的收藏，一次性 10 分钟有效", "action": "builtin:handofftake"}, {"id": "search-all", "name": "全网聚合搜索", "desc": "一个框搜遍 300+ 条目与 200+ 平台的远端全目录，可直开线路", "action": "builtin:searchall"}, {"id": "rank-sources", "name": "智能选源", "desc": "按成功率 60% + 时延 40% 给每条线路评分，首选线路自动置顶", "action": "builtin:rank"}, {"id": "upgrade-telemetry", "name": "升级状态上报", "desc": "检查/安装升级的结果自动上报，后台可看谁升成功谁卡住", "action": "builtin:updatecheck"}];
var KH_FEATURE_SNAPSHOT_VERSION = {"versionName": "1.7.85", "versionCode": 1000199, "count": 36, "hash": "78c545d7ffe9ce9c", "inSync": true};

window.__khLoadFeatures = function (list, ver) {
  if (KH_UI_CLEAN) return;   /* 客户纯净版：不建扩展工具入口，功能只随发版静默下发 */
  try {
    window.KH_FEATURES = list || [];
    window.KH_FEATURE_VERSION = ver || null;   // 功能清单随发版同步的版本 / 数量 / 指纹
    var btn = document.getElementById('khToolsBtn');
    if (!btn) {
      btn = document.createElement('button'); btn.id = 'khToolsBtn'; btn.textContent = '🧩 扩展工具';
      btn.setAttribute('style', 'position:fixed;right:14px;bottom:14px;z-index:9990;border:0;border-radius:20px;' +
        'padding:10px 16px;background:#FF4D5E;color:#fff;font:13px/1 sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.4)');
      document.body.appendChild(btn);
      btn.onclick = function () {
        var p = document.getElementById('khToolsPanel');
        if (p) { p.style.display = (p.style.display === 'none' ? 'block' : 'none'); return; }
        khRenderTools();
      };
    }
    if (document.getElementById('khToolsPanel')) khRenderTools();
  } catch (e) {}
};

function khRenderTools() {
  if (KH_UI_CLEAN) return;   /* 客户纯净版：不渲染扩展工具面板 */
  try {
    var p = document.getElementById('khToolsPanel');
    if (!p) { p = document.createElement('div'); p.id = 'khToolsPanel'; document.body.appendChild(p); }
    p.setAttribute('style', 'position:fixed;right:14px;bottom:64px;z-index:9991;width:330px;max-height:72vh;overflow:auto;' +
      'background:#12151F;color:#E7ECF5;border:1px solid #2A2F40;border-radius:14px;padding:14px;' +
      'font:13px/1.5 sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)');
    var items = khClientFeatures(window.KH_FEATURES).map(function (f) {
      return '<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08)">' +
        '<div style="font-weight:700">' + esc(f.name || f.id || '工具') + '</div>' +
        '<div style="color:#9AA6C4;font-size:12px;margin:4px 0 8px">' + esc(f.desc || '') + '</div>' +
        '<button data-fid="' + esc(f.id || '') + '" style="border:0;border-radius:10px;padding:6px 12px;' +
        'background:#262B3B;color:#E7ECF5;cursor:pointer">打开</button></div>';
    }).join('') || '<div style="color:#9AA6C4">暂无扩展功能（在 server/features 增加即可在线生效）</div>';
    var fv = window.KH_FEATURE_VERSION;
    var vTip = fv ? '<div style="color:#8A8FA3;font-size:11px;margin:-4px 0 8px">功能 v' + esc(fv.versionName || '-') +
      ' · ' + esc(fv.count) + ' 项' + (fv.inSync ? ' · 已随发版同步' : ' · 清单有改动，待发版') + '</div>' : '';
    var dp = window.KH_DELIVERY_PLAN;
    var dTip = dp ? '<div style="color:#7FD1A6;font-size:11px;margin:-2px 0 8px">🌐 所有包不限设备 · ' +
      esc(dp.memoryTier) + ' 内存档 · ' + esc(dp.channel) + ' 通道 · 内容自动最新 v' +
      esc((dp.update && dp.update.latest && dp.update.latest.versionName) || '-') + '</div>'
      : '<div style="color:#7FD1A6;font-size:11px;margin:-2px 0 8px">🌐 免安装在线版：任意设备 / 任意内存即开即看</div>';
    var os = window.KH_OS_OPTIMIZATION || {}, osS = window.KH_OS_SUMMARY || {};
    var osTip = '<div style="color:#9AC1FF;font-size:11px;margin:-2px 0 8px">🖥️ ' +
      esc(os.familyLabel || 'OS 版本检测中') + ' ' + esc(os.osVersion || '') +
      (osS.families ? ' · 跟随 ' + esc(osS.families) + ' 个系统家族 / ' + esc(osS.osVersions) + ' 个版本' : '') +
      ' · 自动优化修复后同步更新</div>';
    p.innerHTML = '<div style="font-weight:700;margin-bottom:6px">🧩 扩展工具（免重装在线新增）</div>' + vTip + dTip + osTip + items +
      '<div style="text-align:right;margin-top:6px"><span id="khToolsManage" style="color:#7FA8FF;cursor:pointer;margin-right:10px">功能管理</span><span id="khToolsClose" style="color:#9AA6C4;cursor:pointer">收起</span></div>';
    var mgr = document.getElementById('khToolsManage');
    if (mgr) {
      if (KH_CLIENT_ONLY) mgr.style.display = 'none';   // 客户成品不提供开发端功能管理入口
      
    }
    var close = document.getElementById('khToolsClose');
    if (close) close.onclick = function () { p.style.display = 'none'; };
    Array.prototype.forEach.call(p.querySelectorAll('button[data-fid]'), function (b) {
      b.onclick = function () {
        var f = (window.KH_FEATURES || []).filter(function (x) { return x.id === b.getAttribute('data-fid'); })[0];
        if (f) khRunFeature(f);
      };
    });
  } catch (e) {}
}

function khRunFeature(f) {
  try {
    if (KH_CLIENT_ONLY && KH_DEV_ACTION.test(String((f && f.action) || ''))) {
      toast('「' + ((f && (f.name || f.id)) || '该功能') + '」仅在开发者端可用');
      return;
    }
    var a = f.action || '';
    if (a === 'open' && f.url) {
      if (f.url.indexOf('http') === 0) window.open(f.url, '_blank'); else location.href = f.url;
      return;
    }
    if (a.indexOf('builtin:') === 0) {
      if (a === 'builtin:report') { copyIssueText(issueReport(), '诊断报告'); return; }
      if (a === 'builtin:sourcespeed') { khFeatureSourceSpeed(); return; }
      if (a === 'builtin:fix') { khFeatureFix(); return; }
      if (a === 'builtin:updatepublish') { khFeatureUpdatePublish(); return; }
      if (a === 'builtin:mine') { khFeatureMine(); return; }
      if (a === 'builtin:batch' || a === 'builtin:arch') { khFeatureBatch(a); return; }
      if (a === 'builtin:playback') { khFeaturePlayback(); return; }
      if (a === 'builtin:memory') { khFeatureMemory(); return; }
      if (a === 'builtin:update') { khFeatureAutoUpdate(); return; }
      if (a === 'builtin:os') { khFeatureOS(); return; }
    if (a === 'builtin:automation') { khFeatureAutomation(); return; }
    if (a === 'builtin:govern') { khFeatureGovern(); return; }
    if (a === 'builtin:updatecheck') { khFeatureUpdateCheck(); return; }
    
    toast('未识别的内置功能：' + a); return;
    }
    if (a === 'script' || a === 'webhook') {
      if (f.confirm) { try { if (!confirm('确认运行功能「' + (f.name || f.id) + '」？')) return; } catch (e) {} }
      toast('正在运行：' + (f.name || f.id) + ' …');
      fetch('/api/feature/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: f.id }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok) { toast('运行失败：' + String(d && d.error || '').slice(0, 120)); return; }
          if (d.action === 'open') { window.open(d.url, '_blank'); return; }
          if (d.stdout !== undefined) toast('✅ 完成（退出码 ' + (d.code || 0) + '）：\n' + String(d.stdout || '').slice(0, 300));
          else if (d.status !== undefined) toast('✅ 接口返回 ' + d.status + (d.body ? ('：' + String(d.body).slice(0, 200)) : ''));
          else toast('✅ 已运行');
        }).catch(function (e) { toast('请求失败：' + (e && e.message || e)); });
      return;
    }
    toast('未识别的功能动作：' + a);
  } catch (e) { toast('功能执行失败：' + (e && e.message || e)); }
}

function khFeatureSourceSpeed() {
  try {
    var chs = window.LIVE_CHANNELS || [], rows = [];
    for (var i = 0; i < chs.length; i++) {
      rows.push({ n: chs[i].name, n_src: (chs[i].sources || []).length, group: chs[i].group || '' });
    }
    rows.sort(function (a, b) { return b.n_src - a.n_src; });
    var txt = '源线路排行（按可用线路数，共 ' + chs.length + ' 频道）：\n' +
      rows.slice(0, 30).map(function (r, i) {
        return (i + 1) + '. [' + r.group + '] ' + r.n + '：' + r.n_src + ' 条线路';
      }).join('\n');
    alert(txt);
  } catch (e) { toast('排行失败：' + (e && e.message || e)); }
}

function khFeatureFix() {
  toast('正在向收集服务请求一键自愈（重排源 / 刷新清单）…');
  fetch('/api/fix', { method: 'POST', cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (d) {
      toast(d.ok ? ('自愈完成：' + String(d.msg || '').slice(0, 80)) : ('自愈失败：' + String(d.error || '').slice(0, 80)));
      setTimeout(function () {
        fetch('/api/manifest', { cache: 'no-store' }).then(function (r) { return r.json(); })
          .then(function (m) { if (m && m.sources) window.__khApplySources(JSON.stringify(m.sources)); });
      }, 1500);
    }).catch(function (e) { toast('自愈请求失败：' + (e && e.message || e)); });
}

function khFeatureUpdatePublish() {
  try { if (!confirm('确认同时执行「更新（重排源 / 刷新清单）+ 发布（升级版本号）」？\n所有桌面端将实时拉取新版本。')) return; } catch (e) {}
  toast('正在向收集服务请求：更新 + 发布…');
  fetch('/api/update-publish', { method: 'POST', cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.ok) {
        toast('已更新并发布 v' + d.publish.versionName + ' (#' + d.publish.versionCode + ') · 源清单 v' + d.update.v);
        setTimeout(function () {
          fetch('/api/manifest', { cache: 'no-store' }).then(function (r) { return r.json(); })
            .then(function (m) {
              if (m && m.sources) window.__khApplySources(JSON.stringify(m.sources));
              if (m && m.release) window.__khSetRelease(JSON.stringify(m.release));
            });
        }, 1500);
      } else {
        toast('更新发布失败：' + String(d && d.error || '').slice(0, 100));
      }
    }).catch(function (e) { toast('请求失败：' + (e && e.message || e)); });
}

function khFeatureAutomation() {
  fetch('/api/automation', { cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (d) {
      var s = (d.enabled ? '✅ 自动化已开启' : '⛔ 自动化已关闭') + '\n';
      s += '下次运行：' + new Date(d.nextRunAt || 0).toLocaleString('zh-CN', { hour12: false }) + '\n';
      var lr = d.lastRun;
      s += '上次运行：' + (lr ? (new Date(lr.startedAt).toLocaleString('zh-CN', { hour12: false }) + ' ' + (lr.ok ? '成功' : '失败')) : '无') + '\n';
      s += '运行次数：' + (d.recent ? d.recent.length : 0);
      if (!confirm(s + '\n\n是否立即触发一次自动化（更新+发布）？')) return;
      toast('正在触发自动化运行…');
      fetch('/api/automation/run', { method: 'POST', cache: 'no-store' }).then(function (r) { return r.json(); })
        .then(function (o) { toast(o.ok ? '自动化运行完成（更新 v' + (o.result && o.result.update && o.result.update.v) + ' / 发布 ' + (o.result && o.result.publish && o.result.publish.versionName) + '）' : ('自动化失败：' + String(o.error || '').slice(0, 100))); })
        .catch(function (e) { toast('触发失败：' + (e && e.message || e)); });
    }).catch(function (e) { toast('读取自动化状态失败：' + (e && e.message || e)); });
}

function khFeatureGovern() {
  try { if (!confirm('确认运行「智能自治循环」（自动提取问题→修复→优化→发布→新增功能）？')) return; } catch (e) {}
  toast('正在运行智能自治循环…');
  fetch('/api/govern/run', { method: 'POST', cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (d) {
      var res = d.result || {};
      toast(d.ok ? ('自治完成：修复 ' + (res.fixed && res.fixed.ok ? '✅' : '❌') + ' / 优化剔除 ' + (res.optimized ? res.optimized.removed : 0) + ' / 新增功能 ' + (res.featuresAdded || []).length + ' / 发布 ' + (res.published && res.published.versionName || '-')) : ('自治失败：' + String(d.error || '').slice(0, 100)));
    }).catch(function (e) { toast('请求失败：' + (e && e.message || e)); });
}

function khFeatureUpdateCheck() {
  fetch('/api/manifest', { cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (d) {
      var rel = (d && d.release) || null;
      var ch = effectiveChannel();
      var tgt = khReleaseTarget(rel, ch);
      var lat = tgt.rel;
      if (!lat) { toast('未获取到版本信息'); return; }
      if (ch.betaFallback || (ch.active === 'beta' && tgt.channel === 'stable')) {
        toast(ch.note || (rel && rel.channels && !rel.channels.beta ? '内测通道尚未配置内测包，本次按稳定清单比对' : '内测版本未配置，本次按稳定清单比对'));
      }
      /* 固定版本（开发端回滚下发）：不再提示升最新，如实说明当前固定目标 */
      var pin = '';
      try { pin = String(localStorage.getItem('kh_pinned_version') || ''); } catch (e) {}
      if (pin && pin !== String(lat.versionName)) {
        toast('已固定目标 v' + pin + '（' + (typeof KH_CLIENT_ONLY !== 'undefined' && KH_CLIENT_ONLY ? '远程固定' : '开发端下发') + '），不提示升级最新 v' + lat.versionName + '；可在设置页「版本与升级」解除');
        return;
      }
      if (pin && pin === String(lat.versionName)) { try { localStorage.removeItem('kh_pinned_version'); } catch (e) {} }
      if (Number(lat.versionCode) > Number(KH_APP_CODE)) {
        khShowUpdateBanner(lat);
        /* 自动升级（设置页开启后）：静默下载 + SHA256 校验 + 启动安装向导；
           同一版本只试一次，失败不重试（kh_update_tried 记录），安装本身仍需在向导里确认 */
        var auto = false, tried = '';
        try { auto = getStore('kh_auto_update', 0) === 1; tried = String(localStorage.getItem('kh_update_tried') || ''); } catch (e) {}
        if (auto && tried !== String(lat.versionCode)) {
          try { localStorage.setItem('kh_update_tried', String(lat.versionCode)); } catch (e) {}
          try { khMarkUpgradeAttempt('auto'); } catch (e) {}
          var autoPre;
          try { autoPre = khUpgradePrecheck(lat, {}); } catch (e) { autoPre = {ok:true}; }
          if (!autoPre.ok) {
            khUpgradeSetStage('failed', autoPre.reason, {failKind: autoPre.kind, channel:'auto'});
            toast('⚠️ 自动升级跳过：' + autoPre.reason + '（本版本不再自动重试，可手动点更新横幅）');
          } else {
            toast('自动升级：正在下载 v' + lat.versionName + ' 并校验（失败不重试）…');
            khUpgradeSetStage('verify', '自动升级：正在下载并校验 v' + lat.versionName + '…', {channel:'auto'});
            var autoFallback = lat && (lat.downloadPage || lat.downloadUrl || lat.hapUrl);
            fetch('/api/update/install', { method: 'POST', cache: 'no-store' })
              .then(function (r) { return r.json(); })
              .then(function (x) {
                if (x && x.ok) {
                  khUpgradeSetStage('done', '安装向导已启动（v' + (x.version || '') + ' · ' + (x.verified === 'sha256' ? 'SHA256 校验通过' : '体积校验通过') + '）', {channel:'auto'});
                  toast('✅ 安装向导已启动（v' + (x.version || '') + ' · ' + (x.verified === 'sha256' ? 'SHA256 校验通过' : '体积校验通过') + '），请在向导里确认');
                } else {
                  var areason = (x && x.error) || '未知错误';
                  var akind = khUpgradeFailKind(areason);
                  khUpgradeSetStage('failed', areason, {failKind: akind, channel:'auto'});
                  toast('⚠️ 自动升级未启动：' + areason + '（本版本不再自动重试，可手动点更新横幅）');
                  khOpenUpdate(autoFallback);
                }
              })
              .catch(function (e) {
                var areason = e && e.message || String(e);
                var akind = khUpgradeFailKind(areason);
                khUpgradeSetStage('failed', '自动升级请求失败：' + areason, {failKind: akind, channel:'auto'});
                toast('⚠️ 自动升级请求失败：' + areason + '（本版本不再自动重试）');
                khOpenUpdate(autoFallback);
              });
          }
        } else {
          toast('发现新版本 v' + lat.versionName + '，可点击顶部横幅下载');
        }
      }
      else toast('已是最新 v' + lat.versionName + '（#' + lat.versionCode + '）');
    }).catch(function (e) {
      var reason = e && e.message || String(e);
      khUpgradeSetStage('failed', '检查更新失败：' + reason, {failKind: khUpgradeFailKind(reason), channel:'check'});
      toast('检查失败：' + reason);
    });
}
/* 回滚真执行：查归档 → 覆盖安装（服务端 SHA256 校验）；每一步失败都如实回报 */
function khDoRollback(v, cb){
  cb = cb || function(){};
  if(!v){ toast('未指定回滚版本'); cb(false, '未指定版本'); return; }
  fetch('/api/update/rollback?version=' + encodeURIComponent(v), { cache: 'no-store' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(!d || !d.ok){
        var av = (d && d.available && d.available.length) ? '（可用归档：' + d.available.join('、') + '）' : '';
        var rerr = ((d && d.error) || '归档缺失') + av;
        khUpgradeSetStage('failed', '回滚：' + rerr, {failKind:'version', channel:'rollback'});
        toast('回滚失败：' + rerr);
        cb(false, rerr);
        return;
      }
      if(!confirm('将覆盖安装历史版本 v' + v + '：\n· SHA256 校验通过才会启动安装向导；\n· 同目录覆盖，数据与设置保留；\n· 若提示程序被占用，请先退出本应用。\n继续？')){
        khUpgradeSetStage('failed', '用户在回滚确认框取消', {failKind:'cancel', channel:'rollback'});
        cb(false, '用户在确认框取消');
        return;
      }
      try { khMarkUpgradeAttempt('rollback'); } catch (e) {}
      khUpgradeSetStage('verify', '回滚：正在校验 v' + v + ' 归档安装包…', {channel:'rollback'});
      return fetch('/api/update/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: v }), cache: 'no-store' })
        .then(function(r){ return r.json(); })
        .then(function(x){
          if(x && x.ok){
            khUpgradeSetStage('done', '已启动 v' + v + ' 安装向导（' + (x.verified === 'sha256' ? 'SHA256 校验通过' : '体积校验通过') + '）', {channel:'rollback'});
            toast('✅ 已启动 v' + v + ' 安装向导（' + (x.verified === 'sha256' ? 'SHA256 校验通过' : '体积校验通过') + '）'); cb(true, '安装向导已启动（' + (x.verified || '') + '）');
          }
          else {
            var rerr2 = (x && x.error) || '未知错误';
            khUpgradeSetStage('failed', '回滚安装未启动：' + rerr2, {failKind:khUpgradeFailKind(rerr2), channel:'rollback'});
            toast('⚠️ 回滚安装未启动：' + rerr2); cb(false, rerr2);
          }
        });
    })
    .catch(function(e){
      var rerr3 = e && e.message || String(e);
      khUpgradeSetStage('failed', '回滚请求失败：' + rerr3, {failKind:khUpgradeFailKind(rerr3), channel:'rollback'});
      toast('回滚请求失败：' + rerr3); cb(false, rerr3);
    });
}
/* 显示与辅助：主题（深色 / 浅色 / 夜间暖色遮罩）+ 长辈模式（大字大按钮） */
function khApplyDisplay(){
  try{
    var theme = String(getStore('kh_theme', '') || '');
    if(!theme){ theme = getStore('kh_night', 0) === 1 ? 'night' : 'dark'; }   /* 兼容旧开关 */
    var senior = getStore('kh_senior', 0) === 1;
    var veil = document.getElementById('khNightVeil');
    ['kh-light','kh-ocean','kh-forest','kh-violet','kh-mono','kh-sand','kh-rose','kh-slate'].forEach(function(c){ document.body.classList.remove(c); });
    if(theme === 'light'){ document.body.classList.add('kh-light'); }
    else if(['ocean','forest','violet','mono','sand','rose','slate'].indexOf(theme) >= 0){ document.body.classList.add('kh-' + theme); }
    if(theme === 'night' && !veil){
      veil = document.createElement('div'); veil.id = 'khNightVeil';
      veil.setAttribute('style', 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;background:#FFB870;mix-blend-mode:multiply;opacity:.3;');
      document.body.appendChild(veil);
    } else if(theme !== 'night' && veil){ veil.parentNode.removeChild(veil); }
    document.body.classList.toggle('kh-senior', senior);
    if(senior && (Number(getStore('kh_font_scale', 100)) || 100) < 130){
      setStore('kh_font_scale', 130);
      document.body.style.zoom = '1.3';
    }
  }catch(e){}
}
/* 恢复默认设置：只还原设置项；收藏/历史/稍后再看/自添加片源/口令/自建直播不动
   1.7.83：补上代理（此前「恢复默认」不会清掉手动代理，表现为重置了却还是走代理） */
function khResetSettings(){
  ['kh_hub_url','kh_sleep_min','kh_font_scale','kh_rate','kh_vol','kh_mute','kh_quality','kh_auto_update','kh_theme','kh_night','kh_senior','kh_update_tried','khDismissedVer','kh_pinned_version','kh_sub_style','kh_upgrade_attempt','kh_channel','kh_channel_pick','kh_promo','kh_autostart','kh_compat_mode','kh_loudness_eq','kh_fit','kh_proxy'].forEach(function(k){
    try{ localStorage.removeItem(k); }catch(e){}
  });
  /* 代理回「跟随系统」：只删偏好不够，主进程里的会话代理还在，必须重新下发 */
  try{ if(window.khProxy) window.khProxy.set({ mode: 'system', server: '' }).catch(function(){}); }catch(e){}
  /* 重置默认关自启：Electron 环境同步写回系统登录项；非 Electron 无此接口，仅清本机偏好 */
  try{ if(window.khAutostart) window.khAutostart.set(false).catch(function(){}); }catch(e){}
  try{ document.body.style.zoom = ''; }catch(e){}
  khApplyDisplay();
  try{ khApplySubStyle(); }catch(e){}
  try{ armSleepTimer(); }catch(e){}
}
/* 升级尝试跟踪：记下发起升级时的版本；下次启动若版本没变（安装没生效/失败），
   如实提示并提供「回滚到上一归档版」——不静默重装，也不假装成功 */
function khMarkUpgradeAttempt(kind){
  try{ setStore('kh_upgrade_attempt', { from: Number(KH_APP_CODE) || 0, at: Date.now(), kind: kind || 'install' }); }catch(e){}
}
function khCheckUpgradePending(){
  try{
    var a = getStore('kh_upgrade_attempt', null);
    if(!a || !a.at) return;
    if(Date.now() - Number(a.at) > 7 * 24 * 3600 * 1000){ localStorage.removeItem('kh_upgrade_attempt'); return; }
    if(Number(a.from) !== Number(KH_APP_CODE)){ localStorage.removeItem('kh_upgrade_attempt'); return; }  /* 版本变了 = 装成功 */
    if(Date.now() - Number(a.at) < 5 * 60 * 1000) return;   /* 刚发起，向导可能还在跑 */
    if(document.getElementById('khUpdFailBanner')) return;
    /* 启动后判定上次升级未生效：写入状态机供诊断报告读取（不重复推问题队列，横幅本身已是提示） */
    try{ window.KH_UPGRADE = {stage:'failed', message:'上次升级未生效（版本仍是 #' + a.from + '），可能被取消或失败', at:Date.now(), failKind:'unknown', channel:a.kind || 'install'}; khUpgradePaint(); }catch(e){}
    var b = document.createElement('div'); b.id = 'khUpdFailBanner';
    b.setAttribute('style', 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9996;background:#5B2323;' +
      'border:1px solid #8E3A3A;color:#FFE8E8;padding:10px 14px;border-radius:10px;font-size:13px;display:flex;align-items:center;gap:10px;max-width:88vw');
    b.innerHTML = '<span>⚠ 上次升级未生效（版本仍是 v' + esc(String(a.from)).slice(0, 12) + '），安装可能被取消或失败。</span>' +
      '<button id="khUpdFailRollback" style="border:0;border-radius:8px;padding:5px 10px;background:#C2410C;color:#fff;cursor:pointer">回滚到上一归档版</button>' +
      '<button id="khUpdFailClose" style="border:0;background:transparent;color:#FFB4B4;cursor:pointer">稍后</button>';
    document.body.appendChild(b);
    document.getElementById('khUpdFailClose').onclick = function(){ b.style.display = 'none'; };
    document.getElementById('khUpdFailRollback').onclick = function(){
      b.style.display = 'none';
      fetch('/api/releases', { cache: 'no-store' }).then(function(r){ return r.json(); }).then(function(d){
        var vs = (d && d.versions) || [];
        /* 找比当前版本小、且归档可用的最近一版。老归档条目没有 versionCode，
           这里统一按 versionName 解析成可比较的整数组，两种都能排。 */
        function vkey(x){
          var m = /(\d+)\.(\d+)\.(\d+)/.exec(String((x && x.versionName) || ''));
          return m ? (Number(m[1]) * 1000000 + Number(m[2]) * 1000 + Number(m[3])) : 0;
        }
        var curName = String(window.KH_APP_VERSION || '');
        var curKey = vkey({ versionName: curName });
        var cand = null;
        for(var i = 0; i < vs.length; i++){
          var k = vkey(vs[i]);
          if(k && curKey && k < curKey){ cand = vs[i]; break; }
        }
        if(!cand){ toast('归档里没有比当前更早的版本可回滚'); return; }
        khDoRollback(cand.versionName, function(ok2, msg2){
          try{
            var ql = getStore('khQueueLog', []) || [];
            ql.unshift({ ts:new Date().toISOString(), action:'rollback', label:'升级失败后人工回滚 v' + cand.versionName,
              version: cand.versionName, result: ok2 ? 'done' : 'failed', note: String(msg2 || '').slice(0,140) });
            setStore('khQueueLog', ql.slice(0,20));
          }catch(e){}
        });
      }).catch(function(e){ toast('读取归档列表失败：' + (e && e.message || e)); });
    };
  }catch(e){}
}
function khLoadRollbackOptions(){
  var pinEl = document.getElementById('khPinState');
  var bootEl = document.getElementById('khBootMs');
  if(pinEl){
    var pv = ''; try{ pv = String(localStorage.getItem('kh_pinned_version') || ''); }catch(e){}
    pinEl.textContent = pv ? ('已固定 v' + pv + '（' + (typeof KH_CLIENT_ONLY !== 'undefined' && KH_CLIENT_ONLY ? '远程固定' : '开发端下发') + '）') : '未固定（跟随最新）';
  }
  if(bootEl){
    var bm = Number(getStore('kh_boot_ms', 0)) || 0;
    bootEl.textContent = bm ? (bm + ' ms（脚本就绪到首屏渲染完成）') : '暂无记录';
  }
  var sel = document.getElementById('khRollbackSel');
  if(!sel) return;
  fetch('/api/releases', { cache: 'no-store' }).then(function(r){ return r.json(); }).then(function(d){
    var vs = (d && d.versions) || [];
    if(!vs.length){ sel.innerHTML = '<option value="">暂无可用归档版本</option>'; return; }
    sel.innerHTML = '<option value="">选择历史版本…</option>' + vs.map(function(v){
      return '<option value="' + esc(v.versionName) + '">v' + esc(v.versionName) + '（#' + esc(v.versionCode || '?') + '）</option>';
    }).join('');
  }).catch(function(){ sel.innerHTML = '<option value="">归档列表读取失败（中枢离线？）</option>'; });
}
/* TV / 键盘方向键导航：播放器关闭且不在输入框时，方向键在可聚焦元素间按几何最近移动；
   Enter/空格打开卡片由既有键盘处理负责，这里只管焦点移动 */
function khTvNavInstall(){
  document.addEventListener('keydown', function(e){
    try{
      var k = e.key;
      if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].indexOf(k) < 0) return;
      var pl = document.getElementById('playerLayer');
      if(pl && pl.classList.contains('show')) return;               /* 播放器有自己的按键逻辑 */
      var t = e.target, tag = (t && t.tagName || '').toLowerCase();
      if(tag === 'input' || tag === 'textarea' || tag === 'select') return;
      var main = document.getElementById('main') || document.body;
      var items = [].slice.call(main.querySelectorAll('button, [tabindex="0"], a[href], select')).filter(function(el){
        var r = el.getBoundingClientRect();
        return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < (window.innerHeight || 800);
      });
      if(!items.length) return;
      var cur = (items.indexOf(t) >= 0) ? t : null;
      e.preventDefault();
      if(!cur){ items[0].focus(); try{ items[0].scrollIntoView({block:'nearest'}); }catch(e2){} return; }
      var cr = cur.getBoundingClientRect(), cx = cr.left + cr.width/2, cy = cr.top + cr.height/2;
      var best = null, bestScore = Infinity;
      items.forEach(function(el){
        if(el === cur) return;
        var r = el.getBoundingClientRect(), x = r.left + r.width/2, y = r.top + r.height/2;
        var dx = x - cx, dy = y - cy, ok = false, primary = 0, secondary = 0;
        if(k === 'ArrowRight'){ ok = dx > 8; primary = dx; secondary = Math.abs(dy); }
        else if(k === 'ArrowLeft'){ ok = dx < -8; primary = -dx; secondary = Math.abs(dy); }
        else if(k === 'ArrowDown'){ ok = dy > 8; primary = dy; secondary = Math.abs(dx); }
        else { ok = dy < -8; primary = -dy; secondary = Math.abs(dx); }
        if(!ok) return;
        var score = primary + secondary * 2.2;   /* 优先同排/同列，斜向惩罚 */
        if(score < bestScore){ bestScore = score; best = el; }
      });
      if(best){ best.focus(); try{ best.scrollIntoView({block:'nearest'}); }catch(e3){} }
    }catch(err){}
  });
}
/* ---------------- 字幕：本机解析 srt / vtt / ass 并渲染，不依赖片源 CORS ---------------- */
var KH_SUB = { cues: [], name: '', timer: null, translation: null, translating: false };
function khParseSub(text){
  var raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '\n');
  var cues = [];
  /* ASS / SSA：取 Dialogue 行里的 Start/End/Text，清理 {\...} 样式标签 */
  if(/\[Script Info\]|\[V4\+? Styles\]|^Dialogue:/m.test(raw)){
    raw.split('\n').forEach(function(line){
      var m = /^Dialogue:[^,]*,([\d:.]+),([\d:.]+),(?:[^,]*,){7,}(.*)$/.exec(line);
      if(!m) return;
      var toSec = function(t){
        var p = String(t).split(':').map(Number);
        return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0);
      };
      var txt = String(m[3] || '').replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').trim();
      if(txt) cues.push({ s: toSec(m[1]), e: toSec(m[2]), t: txt });
    });
  } else {
    raw.split(/\n{2,}/).forEach(function(block){
      var lines = block.split('\n').filter(function(x){ return x.trim(); });
      var ti = -1;
      for(var i = 0; i < lines.length; i++){ if(lines[i].indexOf('-->') >= 0){ ti = i; break; } }
      if(ti < 0) return;
      var m = lines[ti].match(/(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/);
      if(!m) return;
      var s = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
      var e = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
      var txt2 = lines.slice(ti + 1).join('\n').replace(/<[^>]+>/g, '').trim();
      if(txt2) cues.push({ s: s, e: e, t: txt2 });
    });
  }
  cues.sort(function(a, b){ return a.s - b.s; });
  return cues;
}
/* 字幕样式：字号三档 + 抬高避让控制条；纯本机 CSS 变量，不改字幕内容 */
var KH_SUB_SIZES = { s: 16, m: 20, l: 26 };
var KH_SUB_POS = { low: '6%', mid: '12%', high: '19%' };
function khSubStyle(){
  var d = { size: 'm', pos: 'mid' };
  try{ var v = getStore('kh_sub_style', null); if(v && typeof v === 'object'){ d.size = KH_SUB_SIZES[v.size] ? v.size : 'm'; d.pos = KH_SUB_POS[v.pos] ? v.pos : 'mid'; } }catch(e){}
  return d;
}
function khApplySubStyle(){
  var s = khSubStyle();
  try{
    document.documentElement.style.setProperty('--sub-fs', KH_SUB_SIZES[s.size] + 'px');
    document.documentElement.style.setProperty('--sub-bottom', KH_SUB_POS[s.pos]);
  }catch(e){}
  var sz = document.getElementById('khSubSizeSel'); if(sz) sz.value = s.size;
  var po = document.getElementById('khSubPosSel'); if(po) po.value = s.pos;
}
function khSetSubStyle(kind, val){
  var s = khSubStyle();
  if(kind === 'size' && KH_SUB_SIZES[val]) s.size = val;
  if(kind === 'pos' && KH_SUB_POS[val]) s.pos = val;
  setStore('kh_sub_style', s);
  khApplySubStyle();
  toast('字幕样式已保存：' + (s.size === 's' ? '小' : s.size === 'l' ? '大' : '中') + ' · ' +
    (s.pos === 'low' ? '靠下' : s.pos === 'high' ? '抬高' : '居中'));
}

function khCurrentCue(){
  if(!KH_SUB.cues.length) return null;
  var t = els.video ? (els.video.currentTime || 0) : 0;
  var lo = 0, hi = KH_SUB.cues.length - 1, at = -1;
  while(lo <= hi){
    var mid = (lo + hi) >> 1;
    if(KH_SUB.cues[mid].s <= t){ at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  for(var i = Math.max(0, at - 2); i <= Math.min(KH_SUB.cues.length - 1, at + 1); i++){
    var c = KH_SUB.cues[i];
    if(t >= c.s && t <= c.e) return c;
  }
  return null;
}
function khSubTick(){
  var layer = document.getElementById('subLayer');
  if(!layer) return;
  if(!KH_SUB.cues.length){ layer.innerHTML = ''; return; }
  var hit = khCurrentCue();
  var html = hit ? '<span>' + esc(hit.t) + '</span>' : '';
  if(hit && KH_SUB.translation && KH_SUB.translation.cue === hit && KH_SUB.translation.text){
    html += '<span class="kh-sub-tr">' + esc(KH_SUB.translation.text) + '</span>';
  }
  if(layer.innerHTML !== html) layer.innerHTML = html;
}
/* HLS 内嵌字幕轨：hls.subtitleTracks 列出轨道，subtitleTrack=-1 关闭；无轨返回 false 交回本地上传 */
function khCycleHlsSubtitle(){
  var h = state.hls;
  var tracks = (h && h.subtitleTracks) || [];
  if(!tracks.length) return false;
  var cur = (typeof h.subtitleTrack === 'number') ? h.subtitleTrack : -1;
  var next = cur + 1;
  if(next >= tracks.length) next = -1;
  try{ h.subtitleTrack = next; h.subtitleDisplay = next >= 0; }catch(e){}
  var btn = document.getElementById('btnSubtitle');
  if(next < 0){
    if(btn) btn.textContent = '📝 字幕';
    toast('内嵌字幕：关闭');
  }else{
    var t = tracks[next] || {};
    var lbl = t.name || t.lang || ('轨 ' + (next + 1));
    if(btn) btn.textContent = '📝 ' + lbl;
    toast('内嵌字幕：' + lbl);
  }
  return true;
}
function khSubtitleOn(){
  /* 已有本地上传字幕：再点一次关闭本地字幕 */
  if(KH_SUB.cues.length){
    if(KH_SUB.timer){ clearInterval(KH_SUB.timer); KH_SUB.timer = null; }
    KH_SUB.cues = []; KH_SUB.translation = null; KH_SUB.translating = false;
    var lay0 = document.getElementById('subLayer'); if(lay0) lay0.innerHTML = '';
    var btn0 = document.getElementById('btnSubtitle'); if(btn0) btn0.textContent = '📝 字幕';
    toast('字幕已关闭');
    return;
  }
  /* 有 HLS 内嵌字幕轨则循环切换；没有再打开本地上传 */
  if(khCycleHlsSubtitle()) return;
  if(!KH_SUB.cues.length){
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.srt,.vtt,.ass,.ssa,text/plain';
    inp.onchange = function(){
      var f = inp.files && inp.files[0];
      if(!f) return;
      var rd = new FileReader();
      rd.onload = function(){
        try{
          var txt = khDecodeSubText(rd.result);
          var cues = khParseSub(txt);
          if(!cues.length){ toast('字幕解析失败：没识别到时间轴（支持 srt / vtt / ass）'); return; }
          KH_SUB.cues = cues; KH_SUB.name = f.name;
          var b = document.getElementById('btnSubtitle');
          if(b) b.textContent = '📝 ' + cues.length + ' 条';
          if(KH_SUB.timer) clearInterval(KH_SUB.timer);
          KH_SUB.timer = setInterval(khSubTick, 200);
          khSubTick();
          toast('字幕已加载：' + f.name + '（' + cues.length + ' 条，本机渲染）');
        }catch(e){ toast('字幕加载失败：' + (e && e.message || e)); }
      };
      rd.readAsArrayBuffer(f);
    };
    inp.click();
    return;
  }
}
/* 字幕文本解码（1.7.82）：国内大量 SRT 是 GBK / GB18030，以前一律按 UTF-8 读，
   结果满屏方块。这里先按 UTF-8 严格解，失败再按 GB18030 解，最后退回宽松 UTF-8。 */
function khDecodeSubText(buf){
  try{
    if(!buf) return '';
    var dec = new TextDecoder('utf-8', { fatal: true });
    return dec.decode(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf);
  }catch(e){ /* 不是合法 UTF-8，继续试 GB18030 */ }
  try{ return new TextDecoder('gb18030', { fatal: false }).decode(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf); }catch(e){}
  try{ return new TextDecoder('utf-8').decode(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf); }catch(e){ return ''; }
}
/* 音轨切换：HLS 多音轨用 hls.audioTracks；单音轨/不支持时如实提示 */
/* AI 字幕翻译（#114）：把当前命中的本地字幕条翻译成中文，追加在原文下方；
   走服务端 /api/ai/translate（开发端 DEV 门控，未配 Key 返回 not-configured）。
   仅翻译当前一条，不批量翻译整条字幕流，避免频繁请求。 */
function khTranslateSub(){
  var cue = khCurrentCue();
  if(!cue){ toast('当前没有可翻译的本地字幕（先加载 srt / vtt / ass 字幕）'); return; }
  if(KH_SUB.translating){ toast('翻译中…'); return; }
  KH_SUB.translating = true;
  khFetch('/api/ai/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: cue.t, targetLang: '中文' }) })
    .then(function(r){ return r.json(); })
    .then(function(d){
      KH_SUB.translating = false;
      if(d && d.ok && d.reply){ KH_SUB.translation = { cue: cue, text: d.reply }; khSubTick(); toast('当前字幕已翻译成中文'); }
      else {
        var reason = (d && d.reason) || 'unknown';
        toast(reason === 'not-configured' ? '未配置模型：AI 翻译不可用' : '翻译失败：' + reason);
      }
    })
    .catch(function(){ KH_SUB.translating = false; toast('翻译请求失败（当前环境可能不支持 AI）'); });
}
function khCycleAudioTrack(){
  var h = state.hls;
  if(!h){ toast('当前不是 HLS 流，音轨随片源固定（浏览器不支持切换 MP4 内嵌音轨）'); return; }
  var tracks = [];
  try{ tracks = h.audioTracks || []; }catch(e){}
  if(!tracks.length){ toast('该片源只有一条音轨，无需切换'); return; }
  var cur = (typeof h.audioTrack === 'number') ? h.audioTrack : 0;
  var next = (cur + 1) % tracks.length;
  try{
    h.audioTrack = next;
    var nm = (tracks[next] && (tracks[next].name || tracks[next].lang)) || ('音轨 ' + (next + 1));
    var b = document.getElementById('btnAudioTrack');
    if(b) b.textContent = '🎵 ' + String(nm).slice(0, 8);
    toast('已切到音轨：' + nm + '（' + (next + 1) + '/' + tracks.length + '）');
  }catch(e){ toast('音轨切换失败：' + (e && e.message || e)); }
}
/* 截图：canvas 取当前帧；跨域片源会被画布保护拒绝，如实提示不假装成功 */
/* 截图会话记录（#123）：只在本进程内存里留痕（片名 / 播放点 / 截图时刻），不落盘、不进备份、重启即清空 */
var KH_SHOT_LOG = [];
function khShotLogPush(title, atSec, fileName){
  var d = new Date();
  var hh = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
  KH_SHOT_LOG.unshift({
    title: String(title || '未命名'),
    at: fmtTime(isFinite(atSec) ? atSec : 0),
    wall: hh,
    name: String(fileName || '')
  });
  if(KH_SHOT_LOG.length > 20) KH_SHOT_LOG.length = 20;
}
function khShotLogShow(){
  var old = document.getElementById('khShotLog');
  if(old) old.remove();
  var wrap = document.createElement('div');
  wrap.id = 'khShotLog';
  wrap.className = 'kh-ask-mask';
  var rows = KH_SHOT_LOG.map(function(r, i){
    return '<div class="kh-shot-row"><b>' + (i + 1) + '. ' + esc(r.title) + '</b><span>播放点 ' + esc(r.at) + ' · 截于 ' + esc(r.wall) + '</span></div>';
  }).join('');
  wrap.innerHTML = '<div class="kh-ask" role="dialog" aria-modal="true">' +
    '<h3>本次会话截图 · ' + KH_SHOT_LOG.length + ' 张</h3>' +
    '<p class="kh-ask-sub">只记在本机内存里，不写磁盘、不进备份导出；重启应用即清空。图片已按「片名 + 时间」保存到你选的下载目录。</p>' +
    (rows || '<p class="kh-ask-sub">还没有截图。播放时点控制栏「📷 截图」即可。</p>') +
    (KH_SHOT_LOG.length ? '<button class="kh-ask-btn" data-shotclear="1">🗑 清空本次记录</button>' : '') +
    '<button class="kh-ask-btn kh-ask-cancel" data-shotclose="1">关闭</button></div>';
  document.body.appendChild(wrap);
  function close(){ if(wrap.parentNode) wrap.parentNode.removeChild(wrap); document.removeEventListener('keydown', onKey); }
  function onKey(ev){ if(ev.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', function(ev){
    var t = ev.target;
    if(t && t.closest && t.closest('[data-shotclose]')){ close(); return; }
    if(t && t.closest && t.closest('[data-shotclear]')){ KH_SHOT_LOG.length = 0; close(); toast('已清空本次截图记录'); return; }
    if(t === wrap) close();
  });
}
function khCaptureShot(){
  var v = els.video;
  if(!v || !v.videoWidth){ toast('画面还没出图，稍等再截'); return; }
  try{
    var cv = document.createElement('canvas');
    cv.width = v.videoWidth; cv.height = v.videoHeight;
    cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
    cv.toBlob(function(blob){
      if(!blob){ toast('截图失败：画布被片源跨域保护拒绝'); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var title = (state.movie && state.movie.title || '截图').replace(/[\\/:*?"<>|]/g, ' ');
      var ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.href = url; a.download = title + ' ' + ts + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 3000);
      khShotLogPush(state.movie && state.movie.title, v.currentTime, a.download);
      toast('已截图：' + a.download + '（本次 ' + KH_SHOT_LOG.length + ' 张）', '查看记录', khShotLogShow);
    }, 'image/png');
  }catch(e){
    toast('该片源不允许截图（跨域画布保护），这是浏览器的安全限制，不是应用故障');
  }
}
/* 当前片源的「原始直链」：优先取 sources[] 里的真实 m3u8/mp4 地址，绝不返回 hls.js 的 blob:。
   投屏 / 外播 / 下载都必须用它——video.currentSrc 在 MSE 播放时是 blob:，设备与外部进程无法访问。 */
function khCurrentPlayUrl(){
  try{
    if(state.movie){
      var srcs = currentSources(state.movie);
      var cur = srcs && srcs[state.srcIndex];
      if(cur && cur.url && !/^blob:/i.test(String(cur.url))) return String(cur.url);
    }
  }catch(e){}
  var cs = '';
  try{ cs = (els.video && els.video.currentSrc) || ''; }catch(e){}
  return (cs && !/^blob:/i.test(cs)) ? cs : '';
}
/* 当前片源自带的防盗链头（sources[].headers），投屏代理 / 下载复用，避免 403。 */
function khCurrentPlayHeaders(){
  try{
    if(state.movie){
      var srcs = currentSources(state.movie);
      var cur = srcs && srcs[state.srcIndex];
      if(cur && cur.headers && typeof cur.headers === 'object') return cur.headers;
    }
  }catch(e){}
  return null;
}
/* 下载当前片：加入队列时把站点防盗链头一起交给主进程（kh:dl-add 已支持 arg.headers），
   m3u8 是切片清单不能当文件下，明确提示。 */
function khDownloadCurrent(){
  if(!window.khDl){ toast('当前环境没有下载桥（仅桌面版可离线下载）'); return; }
  var url = khCurrentPlayUrl();
  if(!url){ toast('当前片源没有可下载的直链（hls 内存播放）'); return; }
  if(/\.m3u8(\?|$)/i.test(url)){ toast('m3u8 是切片清单，下载队列不支持；请用「外播」或在线观看'); return; }
  var title = (state.movie && state.movie.title) || '鸿汇影下载';
  var ext = (url.split('?')[0].match(/\.(mp4|mkv|ts|avi|mov|flv|webm)$/i) || [null, 'mp4'])[1];
  window.khDl.add({ url: url, name: title + '.' + ext, headers: khCurrentPlayHeaders() || undefined }).then(function(r){
    if(r && r.ok){ toast('已加入下载队列（含站点请求头）'); khDlRender(); }
    else { toast('加入失败：' + ((r && r.reason) || '未知原因')); }
  }).catch(function(){ toast('加入下载队列失败'); });
}
/* DLNA 投屏（#125/#131）：桌面主进程做 SSDP 发现 → 列设备 → 选中后经本机局域网代理转发片源，再发 AVTransport 真实推送。
   设备端 HAP / 纯网页没有 khCast，按钮虽在但会如实提示「当前环境不支持」。 */
function khDlnaDiscover(){
  if(!window.khCast || !window.khCast.discover){ toast('当前环境不支持局域网发现：只有桌面版能发 SSDP'); return; }
  toast('正在搜索同网段的投屏设备…');
  window.khCast.discover({ timeout: 3200 }).then(function(r){
    if(!r || r.ok === false){ toast('发现失败：' + ((r && r.reason) || '未知原因')); return; }
    khDlnaShow(r.devices || []);
  }).catch(function(){ toast('发现失败：主进程没有响应'); });
}
function khDlnaShow(list){
  var old = document.getElementById('khDlna');
  if(old) old.remove();
  var wrap = document.createElement('div');
  wrap.id = 'khDlna';
  wrap.className = 'kh-ask-mask';
  if(!list.length){
    wrap.innerHTML = '<div class="kh-ask" role="dialog" aria-modal="true">' +
      '<h3>没有发现投屏设备</h3>' +
      '<p class="kh-ask-sub">确认电视 / 盒子与本机在同一网段并已开启 DLNA（无线投屏）；' +
      'Windows 防火墙需放行 1900/UDP 与「专用网络发现」。有些设备只响应 SSDP 广播，换个网络或在路由器上关掉「AP 隔离」再试。</p>' +
      '<button class="kh-ask-btn kh-ask-cancel" data-dlna-close="1">关闭</button></div>';
  } else {
    wrap.innerHTML = '<div class="kh-ask" role="dialog" aria-modal="true">' +
      '<h3>发现 ' + list.length + ' 台设备</h3>' +
      '<p class="kh-ask-sub">选中后把当前片源经本机局域网转发成设备可直连地址，再发 AVTransport（SetAVTransportURI + Play）真实推送；' +
      '片源需为 http/https 流，设备不支持 AVTransport 时会如实提示原因。</p>' +
      list.map(function(d){
        return '<button type="button" class="kh-ask-btn" data-dlna-cast="' + esc(d.location) + '">' +
          '<b>' + esc(d.name || '未命名设备') + '</b>' +
          '<span>' + esc((d.model ? d.model + ' · ' : '') + (d.location || '')) + '</span></button>';
      }).join('') +
      '<button class="kh-ask-btn kh-ask-cancel" data-dlna-close="1">关闭</button></div>';
  }
  document.body.appendChild(wrap);
  function close(){ if(wrap.parentNode) wrap.parentNode.removeChild(wrap); document.removeEventListener('keydown', onKey); }
  function onKey(ev){ if(ev.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', function(ev){
    var t = ev.target;
    if(t && t.closest && t.closest('[data-dlna-close]')){ close(); return; }
    var castBtn = t && t.closest ? t.closest('[data-dlna-cast]') : null;
    if(castBtn){
      var loc = castBtn.getAttribute('data-dlna-cast');
      close();
      /* 推原始 m3u8/mp4 直链：MSE 播放时 currentSrc 是 blob:，电视访问不到。 */
      var castUrl = khCurrentPlayUrl();
      if(!castUrl){ toast('当前片源没有可投放的直链（hls 内存播放），换一条线路试试'); return; }
      window.khCast.cast({ location: loc, url: castUrl, headers: khCurrentPlayHeaders() || undefined }).then(function(r){
        if(r && r.ok){ toast('已推送：' + ((r && r.device) || '设备')); }
        else { toast((r && r.reason) || '推送未接通'); }
      }).catch(function(){ toast('推送失败：主进程没有响应'); });
      return;
    }
    if(t === wrap) close();
  });
  try{ wrap.querySelector('[data-dlna-cast]').focus(); }catch(e){}
}
/* 系统通知封装（#117）：桌面桥存在才推送；纯网页 / HAP 静默忽略，不报错。 */
function khNotifyPush(title, body){
  try{ if(window.khNotify) window.khNotify.send(title, body); }catch(e){}
}
/* 外部播放器（#109）：仅桌面 Electron 桥存在时可用；纯网页 / HAP 环境隐藏入口。
   取当前播放源直链交本机 VLC / mpv / 系统默认播放器打开。 */
function khOpenExternal(){
  if(!window.khExternal){ toast('当前环境不支持外部播放器'); return; }
  var url = khCurrentPlayUrl();
  if(!url){ toast('当前没有可打开的片源（hls 内存播放无直链）'); return; }
  window.khExternal.open(url).then(function(r){
    if(r && r.ok){ toast('已用外部播放器打开' + (r.via ? '（' + r.via + '）' : '')); }
    else { toast('外部播放器拉起失败：' + ((r && r.reason) || '未找到可用播放器')); }
  }).catch(function(){ toast('外部播放器拉起失败'); });
}
/* ---------------- 跨仓搜片（parses 适配层）：搜索 → 线路 → 播放 ---------------- */
var whSrcSeq = 0;
function whSrcEsc(s){
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function whSrcSites(){
  if(typeof KH_SRC === 'undefined' || typeof whAllSites !== 'function') return [];
  var all = whAllSites() || [], out = [];
  for(var i = 0; i < all.length; i++) if(KH_SRC.isApiSite(all[i])) out.push(all[i]);
  return out;
}
function whSrcOutBox(){ return document.getElementById('whSrcOut'); }
function whSrcCopy(u){
  var ok = false;
  try{ if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(u); ok = true; } }catch(e){}
  if(!ok){
    var ta = document.createElement('textarea');
    ta.value = u; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try{ ok = document.execCommand('copy'); }catch(e2){}
    document.body.removeChild(ta);
  }
  toast(ok ? '播放地址已复制' : '复制失败，请手动选择地址');
}
function whSrcErrLine(st){
  if(!st || !st.errors || !st.errors.length) return '';
  var h = '<p class="platnote">失败站点：';
  for(var i = 0; i < st.errors.length && i < 6; i++) h += (i ? '　' : '') + whSrcEsc(st.errors[i].site) + '（' + whSrcEsc(st.errors[i].reason) + '）';
  return h + '</p>';
}
/* 跨仓搜片：按批 24 个站点依次查，可点「继续搜索」把剩下的站点查完 */
var whSrcState = { kw: '', all: [], off: 0, items: [], ok: 0, total: 0, fail: 0, errors: [], running: false };
function whSrcSearch(kw){
  whSrcState = { kw: kw, all: whSrcSites(), off: 0, items: [], ok: 0, total: 0, fail: 0, errors: [], running: false };
  whSrcRun(false);
}
function whSrcMore(){
  if(!whSrcState.kw || whSrcState.running) return;
  whSrcRun(true);
}
function whSrcRun(more){
  var box = whSrcOutBox();
  if(!box) return;
  if(typeof KH_SRC === 'undefined'){ box.innerHTML = '<p class="platnote">解析器脚本没有加载，无法跨仓搜片</p>'; return; }
  var s = whSrcState, all = s.all || [], total = all.length;
  if(!total){ box.innerHTML = '<p class="platnote">当前启用仓里没有带 api 的接口站</p>'; return; }
  if(s.off >= total){ toast('已经搜完全部 ' + total + ' 个接口站'); return; }
  var from = s.off, to = Math.min(total, from + 24), batch = all.slice(from, to);
  var seq = ++whSrcSeq;
  s.running = true;
  if(!more){
    box.innerHTML = '<p class="platnote">正在向第 1–' + to + ' 个（共 ' + total + ' 个）接口站搜索「' + whSrcEsc(s.kw) + '」…</p>';
  } else {
    var tip = document.getElementById('whSrcMoreTip');
    if(tip) tip.textContent = '正在搜第 ' + (from + 1) + '–' + to + ' 个站点…';
  }
  KH_SRC.aggSearch(batch, s.kw, null, { conc: 6 }).then(function(st){
    if(seq !== whSrcSeq) return;
    s.running = false;
    s.off = to;
    s.items = s.items.concat(st.items || []);
    s.ok += st.ok || 0;
    s.total += st.total || 0;
    s.fail += st.fail || 0;
    if(st.errors) s.errors = s.errors.concat(st.errors);
    whSrcPaint();
  }, function(e){
    if(seq !== whSrcSeq) return;
    s.running = false;
    box.innerHTML = '<p class="platnote">搜索出错：' + whSrcEsc(String((e && e.message) || e)) + '</p>';
  });
}
function whSrcPaint(){
  var box = whSrcOutBox();
  if(!box) return;
  var s = whSrcState, left = (s.all.length || 0) - s.off;
  if(!s.items.length){
    box.innerHTML = '<div class="empty"><span class="ico">🔍</span>没有搜到「' + whSrcEsc(s.kw) + '」' +
      (s.fail ? '（' + s.fail + ' 个站点请求失败）' : '') +
      (left > 0 ? '，还有 ' + left + ' 个站点没查，可以点下面的按钮继续' : '，换个片名或换个仓试试') +
      '</div>' + whSrcErrLine(s);
  } else {
    var h = '<p class="platnote">共 ' + s.items.length + ' 条，来自 ' + s.ok + ' / ' + s.total + ' 个站点' +
      (s.fail ? '（' + s.fail + ' 个失败）' : '') + (left > 0 ? '；已查 ' + s.off + ' / ' + s.all.length + ' 个接口站' : '') + '</p>';
    var n = Math.min(s.items.length, 60);
    for(var i = 0; i < n; i++){
      var it = s.items[i];
      h += '<div class="whsrc-card" style="display:flex;gap:12px;align-items:center;padding:10px 12px;margin-bottom:8px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06)">' +
        '<div style="width:44px;height:62px;border-radius:6px;overflow:hidden;flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:#222a3d;color:#8f9bb3;font-size:16px">' +
        (it.pic ? '<img src="' + whSrcEsc(it.pic) + '" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\'">' : whSrcEsc((it.name || '片').slice(0, 1))) +
        '</div>' +
        '<div style="flex:1 1 auto;min-width:0"><div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + whSrcEsc(it.name) + '</div>' +
        '<div style="font-size:12px;color:#8f9bb3;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + whSrcEsc(it.siteName) +
        (it.remarks ? ' · ' + whSrcEsc(it.remarks) : '') + '</div>' +
        '<div class="whsrc-lines" hidden style="margin-top:8px"></div></div>' +
        '<button class="siteopen" data-act="wh-src-open" data-api="' + whSrcEsc(it.siteApi) + '" data-id="' + whSrcEsc(it.id) + '">线路</button>' +
        '</div>';
    }
    if(s.items.length > n) h += '<p class="platnote">共 ' + s.items.length + ' 条，先列前 ' + n + ' 条</p>';
    box.innerHTML = h + whSrcErrLine(s);
  }
  if(left > 0){
    box.insertAdjacentHTML('beforeend', '<div id="whSrcMoreWrap" style="margin:10px 0"><p id="whSrcMoreTip" class="platnote">还剩 ' + left + ' 个接口站没查</p>' +
      '<button class="mini" data-act="wh-src-more">继续搜索下一批（' + left + ' 个站点）</button></div>');
  }
}
function whSrcOpen(node){
  if(typeof KH_SRC === 'undefined'){ toast('解析器没有加载'); return; }
  var api = node.getAttribute('data-api') || '';
  var vid = node.getAttribute('data-id') || '';
  if(!api || !vid){ toast('这条结果缺少接口信息，无法拉线路'); return; }
  var card = node.closest ? node.closest('.whsrc-card') : node.parentNode;
  var box = card ? card.querySelector('.whsrc-lines') : null;
  if(!box) return;
  if(box.getAttribute('data-loaded') === '1'){ box.hidden = !box.hidden; return; }
  box.hidden = false;
  box.innerHTML = '<p class="platnote">正在拉取线路…</p>';
  /* 1.7.82：线路拉取必须带上该站点自己的 header（以前只传 api/type，
     需要 UA/Referer 的站连详情都拉不回来），并记住站点信息供播放层补头。 */
  var _site = null;
  var _all = whSrcState.all || [];
  for(var _si = 0; _si < _all.length; _si++){
    if(String(_all[_si].api || '') === api){ _site = _all[_si]; break; }
  }
  KH_SRC.detail(_site || { name: '仓站', url: '', api: api, type: 1 }, vid).then(function(r){
    var v = r && r.items && r.items[0];
    if(!v){ box.innerHTML = '<p class="platnote">该站点没有返回这条片的详情</p>'; return; }
    var plays = KH_SRC.parsePlayUrls(v.playUrl, v.playFrom);
    if(!plays.length){ box.innerHTML = '<p class="platnote">该站点详情里没有可直接播放的地址（可能只提供网页播放）</p>'; return; }
    var _hd = (_site && _site.header) ? _site.header : '';
    var _hdObj = null;
    if(_hd){
      try{ _hdObj = (typeof _hd === 'string') ? JSON.parse(_hd) : _hd; }catch(e){ _hdObj = null; }
    }
    var _hdAttr = (_hdObj && Object.keys(_hdObj).length) ? whSrcEsc(JSON.stringify(_hdObj)) : '';
    var h = '<div style="display:flex;flex-wrap:wrap;gap:6px">';
    var n = Math.min(plays.length, 60);
    for(var i = 0; i < n; i++){
      h += '<span style="display:inline-flex;align-items:center;gap:2px">' +
        '<button class="mini" data-act="wh-src-play" data-url="' + whSrcEsc(plays[i].url) +
        '" data-title="' + whSrcEsc(plays[i].title + (plays[i].from ? ' · ' + plays[i].from : '')) +
        '"' + (_hdAttr ? ' data-hdr="' + _hdAttr + '"' : '') + ' title="' +
        whSrcEsc(plays[i].from + ' · ' + plays[i].title + '（用内置播放器打开）') + '">▶ ' + whSrcEsc(plays[i].title) + '</button>' +
        '<button class="mini" data-act="wh-src-ext" data-url="' + whSrcEsc(plays[i].url) + '" title="用外部播放器打开">🖥</button>' +
        '<button class="mini" data-act="wh-src-copy" data-url="' + whSrcEsc(plays[i].url) + '" title="复制播放地址">⧉</button>' +
        '</span>';
    }
    h += '</div>';
    if(plays.length > n) h += '<p class="platnote">共 ' + plays.length + ' 集，先列前 ' + n + ' 集</p>';
    box.innerHTML = h;
    box.setAttribute('data-loaded', '1');
  }, function(e){
    box.innerHTML = '<p class="platnote">线路拉取失败：' + whSrcEsc(String((e && e.message) || e)) + '</p>';
  });
}
/* 搜片框回车直接搜 */
document.addEventListener('keydown', function(ev){
  if(!ev || ev.key !== 'Enter') return;
  var t = ev.target;
  if(t && t.id === 'whSrcKw'){
    ev.preventDefault();
    var b = document.querySelector('[data-act="wh-src-go"]');
    if(b) b.click();
  }
});
/* ---------------- 网络代理（1.7.82） ---------------- */
function khProxyShow(){
  var el = document.getElementById('khProxyNow');
  if(!el || !window.khProxy) return;
  window.khProxy.get().then(function(r){
    el.textContent = (r && r.ok && r.proxy) ? r.proxy : '（没读到系统代理设置）';
  }).catch(function(){ el.textContent = '（读取失败）'; });
}
function khSaveProxy(){
  if(!window.khProxy){ toast('当前环境不支持设置代理'); return; }
  var mEl = document.getElementById('khProxyModeSel');
  var sEl = document.getElementById('khProxyServer');
  var mode = mEl ? String(mEl.value || 'system') : 'system';
  var server = sEl ? String(sEl.value || '').trim() : '';
  if(mode === 'manual' && !server){ toast('选「手动代理」时要填地址，例如 127.0.0.1:7890'); try{ sEl && sEl.focus(); }catch(e){} return; }
  window.khProxy.set({ mode: mode, server: server }).then(function(r){
    if(!r || !r.ok){ toast('保存失败：' + ((r && r.reason) || '未知原因')); return; }
    setStore('kh_proxy', { mode: mode, server: server });
    toast(mode === 'manual' ? ('已切到手动代理：' + server) : (mode === 'none' ? '已切到直连（不走系统代理）' : '已跟随系统代理'));
    setTimeout(khProxyShow, 200);
  }).catch(function(e){ toast('保存失败：' + ((e && e.message) || e)); });
}

/* 影视仓线路 → 内置播放器（1.7.82 / 1.7.85 强化）。
   1.7.85：过去只把 hdr 塞进 sources[].headers，但原生 <video>/hls 分片不会带这些头，
   导致防盗链站 403。现在把请求头按 host 下发到主进程 webRequest 出口统一注入，
   m3u8 主清单与分片都能带上 Referer/UA。 */
function khApplyPlayHeaders(url, hdr){
  try{
    if(!window.khPlayHdr || typeof window.khPlayHdr.set !== 'function') return; /* 网页/HAP 无此桥 */
    var u = new URL(url);
    var host = u.host.toLowerCase();
    var referer = (u.protocol + '//' + u.host + '/');
    var ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
    var extra = null;
    if(hdr && typeof hdr === 'object'){
      for(var k in hdr){
        if(!Object.prototype.hasOwnProperty.call(hdr, k)) continue;
        var v = String(hdr[k] || '').trim();
        if(!v) continue;
        var lk = k.toLowerCase();
        if(lk === 'referer') referer = v;
        else if(lk === 'user-agent') ua = v;
        else { extra = extra || {}; extra[k] = v.slice(0, 300); }
      }
    }
    window.khPlayHdr.set({ host: host, referer: referer, ua: ua, headers: extra });
  }catch(e){ /* 下发失败不影响播放流程 */ }
}
function khPlayUrlInApp(url, title, hdr){
  try{
    khApplyPlayHeaders(url, hdr);
    var m = {
      id: 'whsrc_' + Date.now(), custom: true,
      title: title || '仓内线路', subtitle: String(url).slice(0, 42),
      year: (new Date()).getFullYear(), rating: 0, category: '仓内', tags: ['影视仓'],
      desc: '正在播放影视仓里的线路；若提示 403 / 无法播放，多为该站要求 Referer 或 UA，播放层已按站点配置自动补。',
      cast: '—', color: '#2A3550', accent: '#5B7BC4',
      sources: [{ label: '仓内线路', url: url, headers: hdr || null }]
    };
    if(typeof openPlayer === 'function') openPlayer(m);
    else whSrcCopy(url);
  }catch(e){ toast('打开失败：' + ((e && e.message) || e)); }
}
/* ---------------- 本机视频（1.7.82）：选择文件后直接进内置播放器 ----------------
   以前只能播网络地址，客户最常见的抱怨是「我硬盘里的片子放不进来看」。
   只做选文件 + file:// 地址，不注册系统文件关联（不改用户默认程序）。 */
function khOpenLocalVideo(){
  if(!window.khLocalFile || typeof window.khLocalFile.pick !== 'function'){
    toast('当前环境不支持打开本机文件（仅桌面 Electron 版可用）');
    return;
  }
  window.khLocalFile.pick().then(function(r){
    if(!r || !r.ok){
      if(r && r.canceled) return;
      toast('打开失败：' + ((r && r.reason) || '未知原因'));
      return;
    }
    khPlayLocalFile(r);
  }).catch(function(e){ toast('打开失败：' + ((e && e.message) || e)); });
}
function khPlayLocalFile(f){
  try{
    var m = {
      id: 'local_' + String(f.name || Date.now()), custom: true,
      title: f.name || '本机视频', subtitle: '', year: (new Date()).getFullYear(), rating: 0,
      category: '本机', tags: ['本机文件'],
      desc: '正在播放本机文件：' + String(f.path || ''),
      cast: '—', color: '#2A3550', accent: '#5B7BC4',
      sources: [{ label: '本机文件', url: f.url, local: true }]
    };
    if(typeof openPlayer === 'function') openPlayer(m);
    toast('已打开本机文件：' + (f.name || ''));
  }catch(e){ toast('播放失败：' + ((e && e.message) || e)); }
}
/* ---------------- 下载队列：设置页列表渲染 + 状态推送 ---------------- */
function khDlFmt(n){
  n = Number(n) || 0;
  if(n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
  if(n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if(n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}
function khDlStateText(s){
  var m = { queued: '排队中', downloading: '下载中', paused: '已暂停', done: '已完成', failed: '失败', canceled: '已取消' };
  return m[s] || s;
}
function khDlRender(view){
  var box = document.getElementById('dlList');
  if(!box || !window.khDl) return;
  if(!view){ window.khDl.list().then(function(v){ khDlRender(v); }).catch(function(){}); return; }
  var its = (view && view.items) || [];
  if(!its.length){ box.innerHTML = '<p class="platnote">队列是空的。粘贴直链点「加入队列」即可。</p>'; return; }
  var h = '';
  for(var i = 0; i < its.length; i++){
    var it = its[i];
    var pct = (it.size && it.received) ? Math.min(100, Math.round(it.received * 100 / it.size)) : 0;
    var col = it.state === 'done' ? '#2E9E5B' : it.state === 'failed' ? '#C0392B' : it.state === 'downloading' ? '#FF8A4C' : '#6C7893';
    h += '<div style="padding:10px 12px;margin-bottom:8px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06)">' +
      '<div style="display:flex;gap:8px;align-items:center">' +
        '<div style="flex:1 1 auto;min-width:0">' +
          '<div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + whSrcEsc(it.name) + '</div>' +
          '<div style="font-size:12px;color:#8f9bb3;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + khDlStateText(it.state) +
            (it.state === 'downloading' ? ' · ' + khDlFmt(it.speed) + '/s' : '') +
            ' · ' + khDlFmt(it.received) + (it.size ? ' / ' + khDlFmt(it.size) : '') +
            (it.tries ? ' · 已重试 ' + it.tries + ' 次' : '') +
            (it.err ? ' · ' + whSrcEsc(it.err) : '') + '</div>' +
        '</div>' +
        (it.state === 'downloading' || it.state === 'queued'
          ? '<button class="mini" data-act="dl-pause" data-id="' + it.id + '" title="暂停" aria-label="暂停「' + whSrcEsc(it.name) + '」">⏸</button>'
          : ((it.state === 'paused' || it.state === 'failed') ? '<button class="mini" data-act="dl-resume" data-id="' + it.id + '" title="继续 / 重试" aria-label="继续「' + whSrcEsc(it.name) + '」">▶</button>' : '')) +
        '<button class="mini" data-act="dl-remove" data-id="' + it.id + '" title="移除" aria-label="移除「' + whSrcEsc(it.name) + '」">✕</button>' +
      '</div>' +
      '<div style="height:4px;border-radius:2px;background:rgba(255,255,255,.08);margin-top:8px;overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;background:' + col + ';transition:width .3s"></div></div>' +
      '</div>';
  }
  box.innerHTML = h + '<p class="platnote">共 ' + its.length + ' 条 · 保存目录：' + whSrcEsc(view.dir || '') +
    (view.limitKB ? ' · 限速 ' + view.limitKB + ' KB/s' : ' · 不限速') + ' · 并发 ' + view.conc + ' 路</p>';
  var cSel = document.getElementById('dlConc'), lSel = document.getElementById('dlLimit');
  if(cSel && view.conc) cSel.value = String(view.conc);
  if(lSel) lSel.value = String(view.limitKB || 0);
}
if(window.khDl && window.khDl.on){
  window.khDl.on(function(v){ try { if(state.view === 'settings') khDlRender(v); } catch(e){} });
}
/* ---------------- 中英切换：覆盖顶栏导航、播放器控制、设置页标题（其余中文兜底） ---------------- */
var KH_L10N = {
  en: {
    nav: { home:'Home', live:'Live', category:'Categories', fav:'Favorites', history:'History', url:'URL', sites:'Sites', resources:'Library', issues:'Issues', settings:'Settings', about:'About' },
    ctrl: {
      'live-prev':'Prev', 'live-next':'Next', 'live-fav':'Favorite', 'live-list':'Channels',
      back10:'«10s', fwd10:'10s»', rate:'Speed', fullscreen:'Fullscreen', pip:'PiP',
      quality:'Quality', subtitle:'Subtitles', audiotrack:'Audio', shot:'Snapshot', watchlater:'Watch later',
      'sub-translate':'Translate', downgrade:'Lower', fit:'Fit', watchsub:'Subscribe', external:'External'
    },
    h3: {
      '中枢地址':'Hub address', '定时关闭':'Sleep timer', '字号调节':'Font size',
      '版本与升级':'Version & updates', '显示与辅助':'Display & accessibility',
      '开发端下发记录':'Delivery log', '本机缓存与数据':'Local cache & data',
      '快捷键与操作':'Shortcuts', '恢复默认设置':'Reset settings',
      '这些频道需要可用线路才能恢复':'Channels need working streams',
      '编辑直播源':'Edit live source', '自己添加直播源':'Add live source',
      '点开就能看，官方网页版一键直达':'Open instantly via official web pages',
      '播放任意视频网址 / 打开任意影视网站':'Play any video URL / open any site',
      '按分类同步更新各大网站平台的影视资源':'Platform resources by category',
      '当前设备与开鸿系统兼容性':'Device & KaihongOS compatibility',
      '从一个 JSON 数据源实时同步影视资源':'Sync resources from a JSON source',
      '编辑网站':'Edit site', '添加自己的网站':'Add your own site',
      '编辑影视资源':'Edit resource', '添加影视资源':'Add resource',
      '片名同步检索':'Look up on platforms',
      '版本与服务状态':'Version & service status',
      '局域网访问口令':'LAN access passcode',
      '中枢地址（多机部署）':'Hub address (multi-device)',
      '开机自启':'Start on login',
      '兼容播放模式':'Compatibility mode', '响度均衡':'Loudness leveling', '投屏（DLNA）':'Cast (DLNA)',
      '运行期问题自动汇总':'Runtime issues auto-collected',
      '问题摘要自动上报':'Issue summaries auto-reported',
      '本次会话截图':'Session snapshots'
    },
    h2: {
      '内容直达':'Quick access', '红果短剧 · 打开即看':'Short dramas · open & play',
      '🏆 高分榜单':'Top rated', '分类片单':'By category', '⏰ 稍后再看':'Watch later',
      '⭐ 追剧订阅':'Subscriptions', '我的收藏':'Favorites', '观看历史':'History',
      '网址播放':'URL player', '我的网站':'My sites', '影视资源配置':'Resource settings',
      '内置资源分布':'Built-in resources', '我配置的资源':'My resources',
      '把影视资源同步到各大平台':'Look up title on platforms',
      '设置 · 本机中枢':'Settings · local hub', '关于「影视资源」':'About "Library"',
      '隐私政策 · 用户协议 · 免责声明':'Privacy · Terms · Disclaimer',
      '高频问题':'Top issues', '问题时间线':'Issue timeline',
      '搜索结果':'Search results',
      '诊断报告 / 导出内容（可长按复制）':'Diagnostics / export (long-press to copy)',
      '欢迎使用鸿汇影 · 首次运行声明':'Welcome to HongHub · first-run notice'
    },
    btn: {
      '▶ 立即播放':'▶ Play now', '浏览全部片单':'Browse all',
      '📺 看卫视直播':'📺 Live TV', '➕ 添加网址':'➕ Add URL',
      '🎬 点播片单':'🎬 Movies', '📺 电视直播':'📺 Live TV',
      '🌐 平台入口':'🌐 Platforms', '📦 全部资源':'📦 Library',
      '▶ 今日推荐 · 直接看':'▶ Top pick', '🔥 热播短剧榜':'🔥 Drama chart',
      '🏠 红果首页':'🏠 Home', '🔎 找剧AI · AI 全网搜':'🔎 AI search',
      '📦 添加自己的片源':'📦 Add your source', '▶ 播放视频':'▶ Play',
      '🌐 打开网站':'🌐 Open site', '⟳ 立即同步':'⟳ Sync now',
      '📥 粘贴导入第三方源':'📥 Paste import', '📥 批量导入':'📥 Batch import',
      '⟳ 探测自建站点是否可打开':'⟳ Probe sites', '同步到平台':'Search on platforms',
      '保存口令':'Save passcode', '清除':'Clear', '保存':'Save',
      '测试连接':'Test connection', '↩ 覆盖安装该版本':'↩ Reinstall version',
      '解除固定':'Unpin', '确定清空':'Confirm clear', '再想想':'Cancel',
      '取消':'Cancel', '✓ 保存':'✓ Save', '＋ 添加':'＋ Add', '＋ 加备用':'＋ Add backup',
      '📥 导出备份':'📥 Export backup', '📤 导入备份':'📤 Import backup', '🗑 清空':'🗑 Clear'
    },
    /* 1.7.80：主界面标题 / 按钮 / 空态 / 分类名 / 直播分组 / 面板文案，
       按「整段精确匹配」替换；含片名、计数、错误码的动态文案一律不翻，保持中文兜底。 */
    txt: {
      /* 面板标题 */
      '场景预设 · 一键切换':'Scene presets · one tap', '跨仓搜片':'Cross-warehouse search',
      '添加影视仓':'Add warehouse', '下载队列':'Download queue', '远程通知记录':'Remote notifications',
      '影视仓 · 多仓管理':'Warehouses · multi-source', '影视仓站点':'Warehouse sites',
      '远程配置 · 实时同步':'Remote config · live sync', '第三方平台官网入口':'Platform official sites',
      '问题中心 · 自动收集':'Issues · auto-collected', '云端问题单 · 中枢自动处理':'Cloud tickets · handled by hub',
      '远程收集':'Remote collection', '本机崩溃 / 异常':'Local crashes / errors',
      '平台影视资源 · 分类同步':'Platform resources · by category', '设备适配 · 版本状态':'Device & version status',
      '待补源频道':'Channels awaiting sources', '频道列表':'Channel list', '今日推荐':"Today's picks",
      '开源动画':'Open-source animation', '添加直播频道':'Add live channel',
      '内容直达':'Quick access', '红果短剧 · 打开即看':'Short dramas · open & play',
      '把影视资源同步到各大平台':'Look up titles on platforms', '内置资源分布':'Built-in resources',
      '我配置的资源':'My resources', '我添加的':'My additions', '我的收藏':'Favorites',
      '观看历史':'History', '我的网站':'My sites', '影视资源配置':'Resource settings',
      '网址播放':'URL player', '问题时间线':'Issue timeline', '高频问题':'Top issues',
      '分类片单':'By category', '🏆 高分榜单':'Top rated', '⏰ 稍后再看':'Watch later', '⭐ 追剧订阅':'Subscriptions',
      /* 分类 / 年份 */
      '全部':'All', '全部年份':'All years', '2010 以前':'Before 2010', '2020 及以后':'2020 & later',
      '电影':'Movies', '剧集':'Series', '综艺':'Variety', '动画':'Animation', '纪录片':'Documentaries', '短剧':'Short dramas',
      /* 直播分组 */
      '央视频道':'CCTV', '卫视频道':'Satellite', '影视剧场':'Movie channels', '新闻资讯':'News',
      '体育竞技':'Sports', '少儿动画':'Kids', '音乐娱乐':'Music', '纪录科教':'Docs & science',
      '财经生活':'Business & life', '中国港澳台地区':'HK / Macau / Taiwan', '网络直播':'Web live',
      /* 按钮 */
      '＋ 添加仓':'＋ Add warehouse', '⟳ 刷新全部启用仓':'⟳ Refresh all', '📥 导入到影视仓':'📥 Import to warehouse',
      '📂 选择本机配置文件':'📂 Pick local config file',
      '🔍 跨仓搜片':'🔍 Search all', '↺ 重新应用当前档':'↺ Re-apply preset', '⟳ 立即同步':'⟳ Sync now',
      '⟳ 实时巡检平台入口':'⟳ Probe platforms', '⟳ 巡检片源（本机连通性）':'⟳ Probe sources',
      '⟳ 探测自建站点是否可打开':'⟳ Probe sites', '⟳ 立即检查更新':'⟳ Check for updates',
      '⟳ 立即更新源清单':'⟳ Update source list', '⚡ 立即安装 / 重试':'⚡ Install / retry',
      '↩ 覆盖安装该版本':'↩ Reinstall version', '📋 复制诊断报告':'📋 Copy diagnostics',
      '📄 导出报告 .txt':'📄 Export report .txt', '📥 导出 JSON':'📥 Export JSON', '🗑 清空记录':'🗑 Clear log',
      '◉ 自动收集已开启':'◉ Auto-collect on', '○ 开启自动同步（每 10 分钟）':'○ Auto-sync (every 10 min)',
      '⚠ 需浏览器 / 海外':'⚠ Browser / overseas', '✓ 可直接打开':'✓ Opens directly',
      '📊 按 7 天可播率排序':'📊 Sort by 7-day uptime', '显示全部（含海外 / 只读项目页）':'Show all (overseas / read-only)',
      '重置健康记录':'Reset health log', '填入示例':'Fill example', '清空自建':'Clear custom',
      '恢复默认设置':'Reset settings', '导出备份':'Export backup', '导入备份':'Import backup',
      '导出 M3U':'Export M3U', '导入 M3U':'Import M3U', '测试连接':'Test connection',
      '保存':'Save', '打开':'Open', '浏览全部片单':'Browse all', '＋ 添加':'＋ Add', '＋ 加备用':'＋ Add backup',
      '＋ 加入队列':'＋ Add to queue', '▶ 播放':'▶ Play', '▶ 立即播放':'▶ Play now',
      '🌐 平台入口':'🌐 Platforms', '🎬 点播片单':'🎬 Movies', '📺 电视直播':'📺 Live TV',
      '📦 全部资源':'📦 Library', '🏠 红果首页':'🏠 Home', '🔥 热播短剧榜':'🔥 Drama chart',
      '🔎 找剧AI · AI 全网搜':'🔎 AI search', '📥 批量导入':'📥 Batch import',
      '📥 粘贴导入第三方源':'📥 Paste import', '📥 导出备份':'📥 Export backup', '📤 导入备份':'📤 Import backup',
      '同步到平台':'Look up on platforms', '解除固定':'Unpin',
      /* 空态 / 说明 */
      '队列是空的。粘贴直链点「加入队列」即可。':'The queue is empty. Paste a direct link and hit "Add to queue".',
      '正在读取队列…':'Reading queue…',
      '当前环境没有主进程下载桥，离线下载只在桌面版可用；网页版 / 鸿蒙版不做本地文件落盘。':'No download bridge in this environment; offline downloads exist only in the desktop build.',
      '还没有收到过下发。新版客户端启动 5 秒后开始轮询，之后每 60 秒一次。':'No delivery yet. The client polls 5s after launch, then every 60s.',
      '播放进度、清单缓存只存本机；清理后云端清单会在下次同步时重新拉取。':'Progress and list cache stay local; the cloud list is refetched on the next sync after cleanup.',
      '最近 20 条远程发来的通知与执行结果，只存本机。':'The last 20 remote notifications and results, stored locally only.',
      '整体放大界面文字与控件，适合长辈或远距离观看；保存立即生效并记住。':'Scales UI text and controls for elders or viewing from a distance; saves immediately.',
      '从开始播放起计时，到点自动暂停，适合睡前看直播。':'Counts from playback start and auto-pauses on time — handy for bedtime live TV.',
      '批量导入网址（每行一条，自动用域名当名称；重复或格式不对的会跳过）：':'Batch import URLs (one per line, domain used as name; duplicates or bad formats are skipped):',
      '或粘贴第三方配置 JSON 直接导入（免跨域，立即可用）：':'Or paste a third-party JSON config to import directly (no CORS, ready to use):',
      '给内置频道加一条备用线路（仅本机保存；主源挂了会自动切到它）：':'Add a backup line to a built-in channel (local only; auto-switches when the main source fails):',
      '本应用为本地自签名应用，内容由你自行提供，内置能力如下：':'This app is locally self-signed; you supply the content. Built-in capabilities:',
      '签名类型：本地自签名（release，无设备绑定），仅供学习与个人使用。':'Signing: local self-signed (release, no device binding), for study and personal use only.',
      '应用自带菜单默认隐藏，按 Alt 可唤出；常用操作如下：':'The app menu is hidden by default — press Alt. Common actions:',
      '源修复与问题闭环由中枢自动完成，客户端只读展示结果。':'Source repair and issue closure are handled by the hub; the client only displays results.',
      /* 设置页的下拉选项与状态行（option 文本也走文本节点） */
      '30 分钟后自动停止':'Auto-stop after 30 min', '60 分钟后自动停止':'Auto-stop after 60 min',
      '90 分钟后自动停止':'Auto-stop after 90 min', '120 分钟后自动停止':'Auto-stop after 120 min',
      '标准播放（按设备自动）':'Standard (auto by device)', '响度均衡：关':'Loudness leveling: Off', '响度均衡：开':'Loudness leveling: On',
      '自动升级：关（手动点横幅）':'Auto-update: Off (use the banner)', '自动升级：开（下载+校验+进向导）':'Auto-update: On (download, verify, wizard)',
      '长辈模式（大字大按钮）：关':'Senior mode (big text & buttons): Off', '长辈模式：开':'Senior mode: On',
      '字幕字号：小':'Subtitle size: Small', '字幕字号：中（默认）':'Subtitle size: Medium (default)', '字幕字号：大':'Subtitle size: Large',
      '字幕位置：靠下':'Subtitle position: Low', '字幕位置：居中（默认）':'Subtitle position: Center (default)', '字幕位置：抬高':'Subtitle position: Raised',
      '＋ 新建「粘贴导入」仓':'＋ New "Paste import" warehouse',
      '给内置频道加一条备用线路':'Add a backup line to a built-in channel',
      '（仅本机保存；主源挂了会自动切到它）：':'(saved on this device only; auto-switches when the main source fails):',
      '批量导入网址':'Bulk import URLs',
      '（每行一条，自动用域名当名称；重复或格式不对的会跳过）：':'(one per line, the domain is used as the name; duplicates and malformed lines are skipped):',
      '这些条目由中枢自动建单并自动换源复检；修复结果随清单热更新下发，客户端无需重装即可恢复。':'The hub opens tickets and re-checks swaps automatically; fixes arrive via hot list updates — no reinstall needed.'
    },
    placeholder: 'Search title / cast / tag'
  },
  zh: {
    nav: { home:'首页', live:'直播', category:'分类', fav:'收藏', history:'历史', url:'网址', sites:'网站', resources:'资源', issues:'🩺 问题', settings:'⚙ 设置', about:'关于' },
    ctrl: {
      'live-prev':'▲ 上一台', 'live-next':'▼ 下一台', 'live-fav':'☆ 收藏', 'live-list':'▦ 频道',
      back10:'«10s', fwd10:'10s»', rate:'倍速', fullscreen:'⛶ 全屏', pip:'🖼 画中画',
      quality:'🎚 自动', subtitle:'📝 字幕', audiotrack:'🎵 音轨', shot:'📷 截图', watchlater:'⏰ 稍后看',
      'sub-translate':'🌐 译', downgrade:'⬇ 降档', fit:'🖍 自适应', watchsub:'⭐ 追剧', external:'🖥 外播'
    },
    h3: {
      '中枢地址':'中枢地址', '定时关闭':'定时关闭', '字号调节':'字号调节',
      '版本与升级':'版本与升级', '显示与辅助':'显示与辅助',
      '开发端下发记录':'开发端下发记录', '本机缓存与数据':'本机缓存与数据',
      '快捷键与操作':'快捷键与操作', '恢复默认设置':'恢复默认设置',
      '这些频道需要可用线路才能恢复':'这些频道需要可用线路才能恢复',
      '编辑直播源':'编辑直播源', '自己添加直播源':'自己添加直播源',
      '点开就能看，官方网页版一键直达':'点开就能看，官方网页版一键直达',
      '播放任意视频网址 / 打开任意影视网站':'播放任意视频网址 / 打开任意影视网站',
      '按分类同步更新各大网站平台的影视资源':'按分类同步更新各大网站平台的影视资源',
      '当前设备与开鸿系统兼容性':'当前设备与开鸿系统兼容性',
      '从一个 JSON 数据源实时同步影视资源':'从一个 JSON 数据源实时同步影视资源',
      '编辑网站':'编辑网站', '添加自己的网站':'添加自己的网站',
      '编辑影视资源':'编辑影视资源', '添加影视资源':'添加影视资源',
      '片名同步检索':'片名同步检索',
      '版本与服务状态':'版本与服务状态',
      '局域网访问口令':'局域网访问口令',
      '中枢地址（多机部署）':'中枢地址（多机部署）',
      '开机自启':'开机自启',
      '兼容播放模式':'兼容播放模式', '响度均衡':'响度均衡', '投屏（DLNA）':'投屏（DLNA）',
      '运行期问题自动汇总':'运行期问题自动汇总',
      '问题摘要自动上报':'问题摘要自动上报',
      '本次会话截图':'本次会话截图'
    },
    h2: {
      '内容直达':'内容直达', '红果短剧 · 打开即看':'红果短剧 · 打开即看',
      '🏆 高分榜单':'🏆 高分榜单', '分类片单':'分类片单', '⏰ 稍后再看':'⏰ 稍后再看',
      '⭐ 追剧订阅':'⭐ 追剧订阅', '我的收藏':'我的收藏', '观看历史':'观看历史',
      '网址播放':'网址播放', '我的网站':'我的网站', '影视资源配置':'影视资源配置',
      '内置资源分布':'内置资源分布', '我配置的资源':'我配置的资源',
      '把影视资源同步到各大平台':'把影视资源同步到各大平台', '搜索结果':'搜索结果',
      '设置 · 本机中枢':'设置 · 本机中枢', '关于「影视资源」':'关于「影视资源」',
      '隐私政策 · 用户协议 · 免责声明':'隐私政策 · 用户协议 · 免责声明',
      '高频问题':'高频问题', '问题时间线':'问题时间线',
      '诊断报告 / 导出内容（可长按复制）':'诊断报告 / 导出内容（可长按复制）',
      '欢迎使用鸿汇影 · 首次运行声明':'欢迎使用鸿汇影 · 首次运行声明'
    },
    btn: {
      '▶ 立即播放':'▶ 立即播放', '浏览全部片单':'浏览全部片单',
      '📺 看卫视直播':'📺 看卫视直播', '➕ 添加网址':'➕ 添加网址',
      '🎬 点播片单':'🎬 点播片单', '📺 电视直播':'📺 电视直播',
      '🌐 平台入口':'🌐 平台入口', '📦 全部资源':'📦 全部资源',
      '▶ 今日推荐 · 直接看':'▶ 今日推荐 · 直接看', '🔥 热播短剧榜':'🔥 热播短剧榜',
      '🏠 红果首页':'🏠 红果首页', '🔎 找剧AI · AI 全网搜':'🔎 找剧AI · AI 全网搜',
      '📦 添加自己的片源':'📦 添加自己的片源', '▶ 播放视频':'▶ 播放视频',
      '🌐 打开网站':'🌐 打开网站', '⟳ 立即同步':'⟳ 立即同步',
      '📥 粘贴导入第三方源':'📥 粘贴导入第三方源', '📥 批量导入':'📥 批量导入',
      '⟳ 探测自建站点是否可打开':'⟳ 探测自建站点是否可打开', '同步到平台':'同步到平台',
      '保存口令':'保存口令', '清除':'清除', '保存':'保存',
      '测试连接':'测试连接', '↩ 覆盖安装该版本':'↩ 覆盖安装该版本',
      '解除固定':'解除固定', '确定清空':'确定清空', '再想想':'再想想',
      '取消':'取消', '✓ 保存':'✓ 保存', '＋ 添加':'＋ 添加', '＋ 加备用':'＋ 加备用',
      '📥 导出备份':'📥 导出备份', '📤 导入备份':'📤 导入备份', '🗑 清空':'🗑 清空'
    },
    /* 中文侧不放原文表：由英文表的译文反推（见 KH_L10N 定义后的反向构建） */
    txt: {},
    placeholder: '搜片名 / 演员 / 标签，输入即搜'
  }
};
/* 反向表：英文译文 → 中文原文。切回中文时把 txt 层换回中文，
   避免维护两份字典（同一译文撞车时取第一条）。 */
(function(){
  var en = KH_L10N.en.txt || {}, zh = KH_L10N.zh.txt || (KH_L10N.zh.txt = {});
  for(var k in en){
    if(!Object.prototype.hasOwnProperty.call(en, k)) continue;
    var v = en[k];
    if(!Object.prototype.hasOwnProperty.call(zh, v)) zh[v] = k;
  }
})();
function khApplyLang(){
  var lg = String(getStore('kh_lang', 'zh') || 'zh');
  var D = KH_L10N[lg] || KH_L10N.zh;
  /* 顶栏导航 */
  try{
    var navs = document.querySelectorAll('#nav button[data-view]');
    for(var i=0;i<navs.length;i++){
      var key = navs[i].getAttribute('data-view');
      if(D.nav[key]) navs[i].textContent = D.nav[key];
    }
  }catch(e){}
  /* 播放器控制条（保留原有图标语义） */
  try{
    var ctrls = document.querySelectorAll('.player-ctrl [data-ctrl]');
    for(var j=0;j<ctrls.length;j++){
      var ck = ctrls[j].getAttribute('data-ctrl');
      var cid = ctrls[j].id;
      /* 有运行态文案的按钮（清晰度档数 / 字幕条数 / 音轨名 / 倍速 / 画面比例 / 降档 / 追剧状态）不覆盖，
         避免把状态冲掉；英文模式保持中文兜底，比显示一句错误状态更安全 */
      if(cid === 'btnQuality' || cid === 'btnSubtitle' || cid === 'btnAudioTrack' ||
         cid === 'btnRate' || cid === 'btnFit' || cid === 'btnDown' || cid === 'btnWatchLater' || cid === 'btnWatchSub') {
        if(lg === 'en'){ if(cid === 'btnQuality' && /自动/.test(ctrls[j].textContent)) ctrls[j].textContent = '🎚 Auto'; }
        continue;
      }
      if(D.ctrl[ck]) ctrls[j].textContent = D.ctrl[ck];
    }
  }catch(e){}
  /* 设置页盒子标题（按中文原文映射，未覆盖的保持中文） */
  try{
    var hs = document.querySelectorAll('#main h3');
    for(var k=0;k<hs.length;k++){
      var zh = hs[k].getAttribute('data-zh');
      if(!zh){ zh = hs[k].textContent.trim(); hs[k].setAttribute('data-zh', zh); }
      if(D.h3[zh]) hs[k].textContent = D.h3[zh];
    }
  }catch(e){}
  /* 分区标题（按中文原文映射；含动态计数 / 关键词插值的标题未命中，保持中文兜底） */
  try{
    var h2s = document.querySelectorAll('#main h2');
    for(var q=0;q<h2s.length;q++){
      var zh2 = h2s[q].getAttribute('data-zh');
      if(!zh2){ zh2 = h2s[q].textContent.trim(); h2s[q].setAttribute('data-zh', zh2); }
      if(D.h2 && D.h2[zh2]) h2s[q].textContent = D.h2[zh2];
    }
  }catch(e){}
  /* 固定按钮 / chip / 小工具按钮（精确命中才替换；运行态与含动态内容的按钮保持原样） */
  try{
    var btns = document.querySelectorAll('#main .chip, #main .btn-primary, #main .btn-ghost, #main .qbtn');
    for(var b=0;b<btns.length;b++){
      var zb = btns[b].getAttribute('data-zh');
      if(!zb){ zb = btns[b].textContent.trim(); btns[b].setAttribute('data-zh', zb); }
      if(D.btn && D.btn[zb]) btns[b].textContent = D.btn[zb];
    }
  }catch(e){}
  /* 搜索框占位 */
  try{ if(els.search) els.search.setAttribute('placeholder', D.placeholder); }catch(e){}
  /* 全文案层（1.7.80）：主界面标题 / 按钮 / 空态 / 分类名 / option 选项，
     按整段精确匹配替换。这里走文本节点而不是选择器，所以动态渲染出来的区块
     （影视仓、跨仓搜片、下载队列、场景预设）只要文案在字典里就一并覆盖；
     含片名 / 计数 / 错误码的句子不命中字典，保持中文兜底，不会翻出半截。 */
  try{
    var dic = D.txt || {};
    var skip = /^(SCRIPT|STYLE|INPUT|TEXTAREA)$/;
    var walkTxt = function(node){
      for(var n = 0; n < node.childNodes.length; n++){
        var c = node.childNodes[n];
        if(c.nodeType === 3){
          var raw = c.nodeValue;
          var key = String(raw || '').replace(/\s+/g, ' ').trim();
          if(key && Object.prototype.hasOwnProperty.call(dic, key)) c.nodeValue = raw.replace(key, dic[key]);
        } else if(c.nodeType === 1 && !skip.test(c.tagName)){
          walkTxt(c);
        }
      }
    };
    var mainEl = (typeof els !== 'undefined' && els.main) || document.getElementById('main');
    if(mainEl) walkTxt(mainEl);
  }catch(e){}
}
/* ---------------- 搜索联想 + 搜索历史（本机，最多 8 条） ---------------- */
function khSearchHistGet(){ try{ return strArray('kh_search_hist'); }catch(e){ return []; } }
function khSearchHistPush(kw){
  kw = String(kw || '').trim();
  if(kw.length < 1) return;
  var h = khSearchHistGet().filter(function(x){ return x !== kw; });
  h.unshift(kw);
  setStore('kh_search_hist', h.slice(0, 8));
}
function khSuggestPanel(){
  var box = document.getElementById('khSuggest');
  if(!box){
    box = document.createElement('div'); box.id = 'khSuggest';
    box.setAttribute('style', 'position:fixed;z-index:4000;background:#1E2230;border:1px solid #2E3448;border-radius:10px;' +
      'box-shadow:0 12px 30px rgba(0,0,0,.45);max-height:320px;overflow:auto;display:none;min-width:280px;');
    document.body.appendChild(box);
  }
  return box;
}
function khSuggestRender(){
  var box = khSuggestPanel();
  var q = String(els.search && els.search.value || '').trim().toLowerCase();
  var items = [];
  if(!q){
    var hist = khSearchHistGet();
    if(!hist.length){ box.style.display = 'none'; return; }
    items = hist.slice(0, 8).map(function(h){ return { label: h, kw: h, kind: 'hist' }; });
  } else {
    var all = allMovies();
    var cands = [];
    for(var i=0;i<all.length && cands.length<8;i++){
      var m = all[i];
      var hay = (m.title + ' ' + m.subtitle + ' ' + m.cast + ' ' + m.tags.join(' ')).toLowerCase();
      if(hay.indexOf(q) >= 0 || (/^[a-z]{1,}$/.test(q) && pyInitials(m.title).indexOf(q) === 0)){
        cands.push({ label: m.title, kw: m.title, kind: 'movie', id: m.id, meta: m.year + ' · ' + m.category });
      }
    }
    items = cands;
  }
  if(!items.length){ state.sgItems = []; box.style.display = 'none'; return; }
  state.sgItems = items;
  if(state.sgIndex < 0 || state.sgIndex >= items.length) state.sgIndex = 0;
  var head = (!q && items.length) ? '<div class="sg-clear" data-kh-clearhist>🗑 清空搜索历史</div>' : '';
  box.innerHTML = head + items.map(function(it, i){
    return '<div class="sg-row' + (i === state.sgIndex ? ' sg-on' : '') + '" data-kh-sg="' + esc(it.kw) + '"' + (it.id ? ' data-kh-id="' + esc(it.id) + '"' : '') +
      '><span>' + (it.kind === 'hist' ? '🕘 ' : '🎬 ') + esc(it.label) + '</span>' +
      '<span style="color:var(--muted);font-size:12px">' + esc(it.meta || '') + '</span></div>';
  }).join('');
  var r = els.search.getBoundingClientRect();
  box.style.left = Math.round(r.left) + 'px';
  box.style.top = Math.round(r.bottom + 6) + 'px';
  box.style.width = Math.round(r.width) + 'px';
  box.style.display = 'block';
}
/* 选中联想项：与鼠标点选同一套逻辑 */
function khSuggestPick(row){
  var kw = row.getAttribute('data-kh-sg');
  var id = row.getAttribute('data-kh-id');
  var box = khSuggestPanel();
  box.style.display = 'none';
  state.sgIndex = -1; state.sgItems = [];
  if(id){
    var m = findMovie(id);
    khSearchHistPush(kw);
    if(m){ els.search.value = m.title; state.keyword = m.title; openPlayer(m); return; }
  }
  els.search.value = kw;
  state.keyword = kw;
  state.view = 'search';
  khSearchHistPush(kw);
  render();
}
function khSuggestMove(dir){
  var items = state.sgItems || [];
  if(!items.length) return;
  state.sgIndex = (state.sgIndex + dir + items.length) % items.length;
  var box = khSuggestPanel();
  var rows = box.querySelectorAll('[data-kh-sg]');
  rows.forEach(function(r, i){ r.classList.toggle('sg-on', i === state.sgIndex); });
}
function khSuggestBind(){
  var box = khSuggestPanel();
  box.addEventListener('mousedown', function(e){
    var clear = e.target.closest && e.target.closest('[data-kh-clearhist]');
    if(clear){
      e.preventDefault();
      setStore('kh_search_hist', []);
      state.sgIndex = -1; state.sgItems = [];
      khSuggestRender();
      return;
    }
    var row = e.target.closest && e.target.closest('[data-kh-sg]');
    if(!row) return;
    e.preventDefault();
    khSuggestPick(row);
  });
  box.addEventListener('mousemove', function(e){
    var row = e.target.closest && e.target.closest('[data-kh-sg]');
    if(!row) return;
    var rows = box.querySelectorAll('[data-kh-sg]');
    var idx = Array.prototype.indexOf.call(rows, row);
    if(idx >= 0){ state.sgIndex = idx; rows.forEach(function(r, i){ r.classList.toggle('sg-on', i === idx); }); }
  });
  if(els.search){
    els.search.addEventListener('focus', function(){ setTimeout(khSuggestRender, 60); });
    els.search.addEventListener('blur', function(){ setTimeout(function(){ box.style.display = 'none'; }, 180); });
    els.search.addEventListener('input', function(){ state.sgIndex = -1; setTimeout(khSuggestRender, 30); });
    els.search.addEventListener('keydown', function(e){
      var visible = box.style.display === 'block' && (state.sgItems || []).length;
      if(e.key === 'ArrowDown' && visible){ e.preventDefault(); khSuggestMove(1); return; }
      if(e.key === 'ArrowUp' && visible){ e.preventDefault(); khSuggestMove(-1); return; }
      if(e.key === 'Escape'){ box.style.display = 'none'; state.sgIndex = -1; return; }
      if(e.key === 'Enter'){
        var row = visible && state.sgIndex >= 0 ? box.querySelectorAll('[data-kh-sg]')[state.sgIndex] : null;
        if(row){ e.preventDefault(); khSuggestPick(row); return; }
        box.style.display = 'none';
        if(state.keyword && state.keyword.trim()) khSearchHistPush(state.keyword.trim());
      }
    });
  }
}

/* 自动提取反馈建议里新功能 → 立即刷新工具面板（平时由服务自动跑，这里只是可选手动触发） */
function khFeatureMine(){
  toast('🧠 正在自动提取反馈建议里的新功能…');
  fetch('/api/features/mine', { method: 'POST', cache: 'no-store' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      var r = d.result || {};
      toast('✅ 自动添加 ' + ((r.added || []).length) + ' 项新功能（扫描 ' + (r.scannedTexts || 0) + ' 条反馈，无需人工复核）');
      return fetch('/api/features', { cache: 'no-store' });
    })
    .then(function(r){ return r.json(); })
    .then(function(d){ if(d && Array.isArray(d.features)) window.__khLoadFeatures(d.features, d.version); })
    .catch(function(e){ toast('自动提取失败：' + (e && e.message || e)); });
}
function khFeatureBatch(which){
  fetch('/api/batch', { cache: 'no-store' }).then(function(r){ return r.json(); })
    .then(function(d){
      var b = d.batch || {}, keys = Object.keys(b.archs || {});
      var parts = keys.map(function(a){
        var st = b.archs[a].status;
        return a + ':' + (st === 'ready' ? '原生包就绪' : st === 'unsupported' ? '已停支持' : '回退 x64');
      });
      toast((which === 'builtin:arch' ? '🖥️ 架构自适应：' : '📦 自动批量下发：') + parts.join(' · ') +
        ' · 开鸿 HAP ' + (b.hap ? ((b.hap.size || 0) + ' B') : '待出包') + ' · 功能 ' + ((b.features || {}).count || 0) + ' 项');
    })
    .catch(function(e){ toast('批量清单读取失败：' + (e && e.message || e)); });
}
function khFeaturePlayback(){
  var p = khPlayerProfile(), c = khHlsConfig(p);
  toast('▶️ 自适应播放：' + p.memTier + ' 内存档 / ' + p.arch + ' / ' + p.cores + ' 核 · 缓冲上限 ' +
    Math.round(c.maxBufferSize/1000000) + 'MB / ' + c.maxBufferLength + 's · 卡顿自动降码率与换源');
}
/* 自动下发 + 自动更新：启动与定时轮询自动比对版本、拉取最新功能 / 源清单 / 播放档位。
   任意设备 / 任意内存都拿到可用成品；低内存或未知设备自动保底免安装在线版。 */
/* ---------------- 设置页交互 ---------------- */
function khBindSettings(){
  function byId(id){ return document.getElementById(id); }
  /* 版本与升级 / 显示与辅助：回填当前值并拉归档列表 */
  var au = byId('khAutoUpd'); if(au) au.value = String(getStore('kh_auto_update', 0));
  var ns = byId('khNightSel'); if(ns) ns.value = String(getStore('kh_night', 0));
  var ss = byId('khSeniorSel'); if(ss) ss.value = String(getStore('kh_senior', 0));
  var asSel = byId('khAutostartSel');
  if(asSel){
    asSel.value = String(getStore('kh_autostart', 0));
    if(window.khAutostart){
      window.khAutostart.get().then(function(on){
        var el = byId('khAutostartSel'); if(el) el.value = on ? '1' : '0';
        setStore('kh_autostart', on ? 1 : 0);
      }).catch(function(){});
    }
  }
  try{ khLoadRollbackOptions(); }catch(e){}
  var rf = byId('khSetRefresh');
  if(rf) rf.onclick = function(){ khBootSync(true); toast('正在刷新中枢状态…'); };
  var ck = byId('khSetCheck');
  if(ck) ck.onclick = function(){
    toast('正在比对云端版本…');
    khFetch('/api/manifest', { cache:'no-store' }).then(function(r){ return r.json(); }).then(function(m){
      var tgt = khReleaseTarget((m && m.release) || null, effectiveChannel());
      var rel = tgt.rel;
      var need = !!(rel && Number(rel.versionCode) > Number(KH_APP_CODE));
      if(need && typeof khShowUpdateBanner === 'function') khShowUpdateBanner(rel);
      toast(need ? ('发现新版 v' + rel.versionName + ' (#' + rel.versionCode + ')，已在页面上方提示安装')
                 : '当前已是最新版本');
    }).catch(function(e){ toast('检查更新失败：' + (e && e.message || e)); });
  };
  var dg = byId('khSetDiag');
  if(dg) dg.onclick = function(){
    try{ copyIssueText(issueReport(), '诊断报告'); }catch(e){ toast('诊断报告生成失败：' + (e && e.message || e)); }
  };
  var sv = byId('khSetTokenSave');
  if(sv) sv.onclick = function(){
    var el = byId('khSetToken'), v = (el && el.value || '').trim();
    try{ if(v) localStorage.setItem('kh_access_token', v); else localStorage.removeItem('kh_access_token'); }catch(e){}
    toast(v ? '口令已保存在本机' : '已清除口令（本机模式）');
    khBootSync(true);
  };
  var sc = byId('khSetTokenClear');
  if(sc) sc.onclick = function(){
    try{ localStorage.removeItem('kh_access_token'); }catch(e){}
    var el = byId('khSetToken'); if(el) el.value = '';
    toast('已清除口令（本机模式）');
  };
  var cp = byId('khSetClearProg');
  if(cp) cp.onclick = function(){
    try{
      var ks = [];
      for(var i = 0; i < localStorage.length; i++){ ks.push(localStorage.key(i)); }
      ks.forEach(function(k){ if(k === 'kh_prog' || k === 'kh_hist' || k === 'kh_fav') localStorage.removeItem(k); });
    }catch(e){}
    toast('已清空本机播放记录 / 收藏 / 历史');
    render();
  };
  var cc = byId('khSetClearCache');
  if(cc) cc.onclick = function(){
    try{ localStorage.removeItem(SITES_CLOUD_KEY); }catch(e){}
    toast('清单缓存已清理，正在重新同步…');
    khBootSync(true);
  };
  var rl = byId('khSetReload');
  if(rl) rl.onclick = function(){ location.reload(); };
}

/* ---------------- 启动即同步：源清单 / 平台清单 / 功能清单 / 问题单 ----------------
   客户装完包后不需要等任何“运维动作”，打开就是云端最新；
   定时再同步一次，源修好后下一次打开即生效。 */
window.KH_SERVICE = window.KH_SERVICE || {};
window.KH_ISSUES = window.KH_ISSUES || null;
/* 启动云端拉取失败态（P2-B05）：按来源记录失败，页面顶部给独立失败条 + 重试按钮；
   失败时回退本机/内置基线，不编造假在线数据。成功后对应失败项自动消除。 */
window.KH_BOOT = window.KH_BOOT || { errors: {} };
var BOOT_ERR_LABEL = { sources:'源/平台清单', issues:'问题记录', features:'功能清单', health:'中枢状态' };
function bootErr(key, msg){
  window.KH_BOOT.errors[key] = { msg: String(msg || '').slice(0, 80), at: Date.now() };
  if(state && !state.movie) render();
}
function bootOk(key){
  if(window.KH_BOOT.errors[key]){ delete window.KH_BOOT.errors[key]; if(state && !state.movie) render(); }
}
function bootBannerHtml(){
  var errs = (window.KH_BOOT && window.KH_BOOT.errors) || {};
  var keys = Object.keys(errs);
  if(!keys.length) return '';
  var names = keys.map(function(k){ return BOOT_ERR_LABEL[k] || k; }).join('、');
  return '<div style="margin:0 0 16px;padding:12px 14px;border:1px solid #5A3A3A;border-radius:12px;background:rgba(120,40,40,.18);color:#E7ECF5;font:13px/1.7 sans-serif">' +
    '⚠️ 部分云端内容未能同步（' + esc(names) + '），当前显示本机 / 内置基线；请检查网络后点重试。' +
    ' <button class="qbtn" data-act="boot-retry" style="margin-left:8px">⟳ 重试同步</button></div>';
}
function khBootSync(force){
  if(!window.fetch) return;
  try{
    khFetch('/health', { cache:'no-store' }).then(function(r){ return r.json(); }).then(function(h){
      if(!h || !h.ok) return;
      window.KH_SERVICE = Object.assign(window.KH_SERVICE || {}, {
        buildId: h.buildId || '', devMode: !!h.devMode, sourcesV: h.manifest,
        release: h.release || (window.KH_SERVICE || {}).release
      });
      bootOk('health');
      if(state.view === 'settings') render();
    }).catch(function(e){ bootErr('health', e && e.message || e); });
  }catch(e){ bootErr('health', e && e.message || e); }
  try{
    khFetch('/api/manifest', { cache:'no-store' }).then(function(r){ return r.json(); }).then(function(m){
      if(!m) return;
      window.KH_SERVICE = window.KH_SERVICE || {};
      if(m.buildId) window.KH_SERVICE.buildId = m.buildId;
      if(m.release && typeof window.__khSetRelease === 'function'){ try{ window.__khSetRelease(JSON.stringify(m.release)); }catch(e){} }
      if(m.sources){
        window.__khApplySources(JSON.stringify(m.sources));
        window.KH_SERVICE.sourcesV = m.sources.v;
        window.KH_SERVICE.channels = (m.sources.channels || []).length;
        window.KH_SERVICE.platforms = (m.sources.sites || []).length;
      }
      bootOk('sources');
      if(state.view === 'settings') render();
    }).catch(function(e){ bootErr('sources', e && e.message || e); });
  }catch(e){ bootErr('sources', e && e.message || e); }
  try{
    khFetch('/api/issues', { cache:'no-store' }).then(function(r){ return r.json(); }).then(function(d){
      if(d && d.ok){ window.KH_ISSUES = d; bootOk('issues'); if(state.view === 'issues') render(); }
    }).catch(function(e){ bootErr('issues', e && e.message || e); });
  }catch(e){ bootErr('issues', e && e.message || e); }
  try{
    khFetch('/api/features/sync', { cache:'no-store' }).then(function(r){ return r.json(); }).then(function(f){
      if(f && Array.isArray(f.features)){ window.__khLoadFeatures(f.features, f.version); bootOk('features'); }
    }).catch(function(e){ bootErr('features', e && e.message || e); });
  }catch(e){ bootErr('features', e && e.message || e); }
}
function khApplyDeliveryPlan(){
  if(!window.fetch) return;
  var p = khPlayerProfile();
  var q = '/api/delivery/plan?arch=' + encodeURIComponent(p.arch) +
    '&mem=' + encodeURIComponent(p.mem) + '&os=' + encodeURIComponent(p.os || '') +
    '&code=' + encodeURIComponent(KH_APP_CODE) +
    (window.KH_HARMONY ? '&platform=harmony' : '&platform=desktop');
  fetch(q, { cache:'no-store' }).then(function(r){ return r.json(); }).then(function(d){
    if(!d || !d.ok) return;
    window.KH_DELIVERY_PLAN = d;
    // 播放档位随下发计划自动更新（下一次起播生效；正在播放的实例立即收紧码率上限）
    if(d.playback && window.KHPlayer && window.KHPlayer.override){
      window.KHPlayer.override(d.playback);
      var h = window.KHPlayer.current();
      if(h){ try{ if(isFinite(d.playback.autoLevelCapping) && d.playback.autoLevelCapping >= 0) h.autoLevelCapping = d.playback.autoLevelCapping; }catch(e){} }
    }
    // 内容永远自动最新：功能清单 / 源清单 / 播放档位，不需要重装
    if(d.update && d.update.autoContentUpdate){
      fetch('/api/features/sync', {cache:'no-store'}).then(function(r){ return r.json(); })
        .then(function(f){ if(f && Array.isArray(f.features)) window.__khLoadFeatures(f.features, f.version); }).catch(function(){});
      fetch('/api/manifest', {cache:'no-store'}).then(function(r){ return r.json(); })
        .then(function(m){ if(m && m.sources) window.__khApplySources(JSON.stringify(m.sources)); }).catch(function(){});
    }
    // 仅完整包 / HAP 通道提示安装更新（安装仍需用户确认）；免安装通道天然永远最新
    if(d.update && d.update.needUpdate && d.channel !== 'lite' && !window.KH_HARMONY) khShowUpdateBanner(d.update.latest);
    try{ khRenderTools(); }catch(e){}
  }).catch(function(){});
}
function khFeatureMemory(){
  var d = window.KH_DELIVERY_PLAN, p = khPlayerProfile(), c = khHlsConfig(p);
  toast('🧠 不限内存 / 不限设备：' + (d ? d.memoryTier : p.memTier) + ' 档 · 通道 ' +
    (d ? d.channel : 'lite（离线默认）') + ' · 缓冲上限 ' + Math.round(c.maxBufferSize/1000000) + 'MB / ' +
    c.maxBufferLength + 's · 码率上限 ' + (c.autoLevelCapping >= 0 ? ('第 ' + c.autoLevelCapping + ' 档') : '自动') +
    (d && d.device && d.device.unrestricted ? ' · 任意设备可用' : ''));
}
function khFeatureAutoUpdate(){
  var d = window.KH_DELIVERY_PLAN, u = d && d.update;
  if(!u){ khApplyDeliveryPlan(); toast('🔄 正在自动比对版本与下发通道…'); return; }
  toast('🔄 自动更新：v' + (u.latest.versionName || '-') + ' #' + (u.latest.versionCode || '-') +
    ' · ' + (u.needUpdate ? '发现新版，已提示下载（安装需确认）' : '已是最新') +
    ' · 功能 / 源 / 播放档位自动同步 · ' + (d.channel === 'lite' ? '免安装通道永远最新' : 'SHA256 校验值已下发'));
  khApplyDeliveryPlan();
}
/* OS 版本检测回传：把系统版本 / API / 架构 / 内存 / 客户端版本自动回传中枢，
   中枢自动优化兼容策略、自动修复漂移、刷新功能快照，随后随下发清单同步更新。
   两端共用（HAP 端的 fetch 包装会把 /api/ 指向桌面中枢）。 */
function khDevicePayload(){
  var d = window.KH_DEVICE || {}, p = khPlayerProfile();
  var id = 'dev-anon';
  try{
    id = localStorage.getItem('khDeviceId');
    if(!id){ id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8); localStorage.setItem('khDeviceId', id); }
  }catch(e){}
  return {
    schema: 1, app: 'HongHub', kind: 'device-profile', deviceId: id,
    platform: window.KH_HARMONY ? 'harmony' : 'desktop',
    os: d.osFullName || p.os || '', osFullName: d.osFullName || '',
    osVersion: d.osVersion || '', apiVersion: d.apiVersion || null,
    ua: navigator.userAgent || '', marketName: d.marketName || '', abi: d.abi || '',
    tier: d.tier || '', arch: p.arch, mem: p.mem, memTier: p.memTier,
    appCode: KH_APP_CODE, screenW: window.innerWidth || 0, screenH: window.innerHeight || 0
  };
}
function khReportDevice(){
  if(!window.fetch) return;
  var payload = khDevicePayload();
  fetch('/api/device/report', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload), cache:'no-store' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(!d || !d.ok) return;
      window.KH_OS_OPTIMIZATION = d.optimization || null;
      window.KH_OS_SUMMARY = d.summary || null;
      // 自动应用优化后的兼容策略（跟随本机 OS 版本，影响下一次起播）
      var o = d.optimization || {}, c = o.compat;
      if(c){
        window.KH_COMPAT = c;
        var ov = { enableWorker: c.worker !== false,
          fragLoadingTimeOut: c.timeoutMs || 20000,
          manifestLoadingTimeOut: Math.max(6000, (c.timeoutMs || 20000) - 2000) };
        if(o.playback && isFinite(o.playback.autoLevelCapping)) ov.autoLevelCapping = o.playback.autoLevelCapping;
        if(window.KHPlayer && window.KHPlayer.override) window.KHPlayer.override(ov);
      }
      // 同步更新：优化后功能快照可能刷新，立即拉一次最新功能清单
      if(d.features){
        fetch('/api/features/sync', {cache:'no-store'}).then(function(r){ return r.json(); })
          .then(function(f){ if(f && Array.isArray(f.features)) window.__khLoadFeatures(f.features, f.version); }).catch(function(){});
      }
      try{ khRenderTools(); }catch(e){}
    }).catch(function(){});
}
function khFeatureOS(){
  var o = window.KH_OS_OPTIMIZATION || {}, s = window.KH_OS_SUMMARY || {};
  toast('🖥️ OS 版本检测回传：' + (o.familyLabel || '检测中') + ' ' + (o.osVersion || '') +
    ' · ' + (o.memTier || '') + ' 内存档 · 自动修复 ' + ((o.fixes || []).length) + ' 项' +
    ' · 跟随 ' + (s.families || 0) + ' 个系统家族 / ' + (s.osVersions || 0) + ' 个版本 · 已自动下发同步更新');
}
/* 内嵌功能快照先渲染：开发者端 / 深开鸿端离线也能看到自动添加的新功能，在线清单随后覆盖 */
(function(){
  try{
    if(Array.isArray(window.KH_FEATURE_SNAPSHOT) && window.KH_FEATURE_SNAPSHOT.length){
      window.__khLoadFeatures(window.KH_FEATURE_SNAPSHOT, window.KH_FEATURE_SNAPSHOT_VERSION || null);
    }
  }catch(e){}
})();

(function () {
  if (!window.KH_DESKTOP) return;
  try {
    window.__khSetDeviceProfile({
      marketName: '桌面版 Desktop', deviceType: 'desktop', model: 'HongHub-Desktop',
      abi: 'web', osFullName: navigator.userAgent, apiVersion: 26, minApi: 12, targetApi: 26,
      tier: 'high', screenW: window.innerWidth || 1280, screenH: window.innerHeight || 720,
      densityDPI: 96, appVersion: '1.7.85-desktop', appCode: 1000199
    });
  } catch (e) {}
  function deskUpdate() {
    fetch('/api/manifest', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.sources) window.__khApplySources(JSON.stringify(d.sources));
        if (d && d.release) window.__khSetRelease(JSON.stringify(d.release));
      }).catch(function () {});
  }
  deskUpdate();
  setTimeout(deskUpdate, 9000);
  fetch('/api/features', { cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (d) { if (d && Array.isArray(d.features)) window.__khLoadFeatures(d.features, d.version); })
    .catch(function () {});
})();

/* 开发端下发队列消费：开发端设备页勾选设备入队后，客户端每 60 秒取一条执行并回报。
   客户版与开发端共用（只依赖 /api/devices/queue/next|ack，不触碰任何运维面板路由）。 */
function khQueuePoller(){
  if (!window.fetch) return;
  var id = '';
  try { id = localStorage.getItem('khDeviceId') || ''; } catch (e) {}
  if (!id) return;
  fetch('/api/devices/queue/next?device=' + encodeURIComponent(id), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.ok || !d.item) return;
      var it = d.item, result = 'done', note = '';
      function ackNow() {
        fetch('/api/devices/queue/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ at: it.at, deviceId: id, result: result, note: String(note || '').slice(0, 200) }), cache: 'no-store' })
          .catch(function () {});
      }
      try {
        if (it.action === 'update') { khFeatureUpdateCheck(); note = '已拉取更新清单'; }
        else if (it.action === 'report') { khReportDevice(); note = '已回传设备能力与状态'; }
        else if (it.action === 'reload') { note = '1.2 秒后重载页面'; }
        else if (it.action === 'diagnose') {
          var txt = '';
          try { txt = (typeof issueReport === 'function') ? issueReport() : ''; } catch (e) {}
          note = '诊断摘要：' + String(txt || '').replace(/\s+/g, ' ').slice(0, 150);
          try { copyIssueText(txt || '无内容', '诊断报告'); } catch (e) {}
        }
        else if (it.action === 'rollback') {
          var v = String(it.version || '');
          try { localStorage.setItem('kh_pinned_version', v); } catch (e) {}
          note = '已固定目标 v' + v + '，正在取归档包并请求覆盖安装（结果追加到下发记录）';
          /* 真执行：归档包 → SHA256 校验 → 覆盖安装向导；结果回写下发记录，不再只记不装 */
          khDoRollback(v, function(ok2, msg2){
            try {
              var ql2 = getStore('khQueueLog', []) || [];
              ql2.unshift({ ts: new Date().toISOString(), at: it.at, action: 'rollback', label: '回滚执行结果 v' + v, version: v, result: ok2 ? 'done' : 'failed', note: String(msg2 || '').slice(0, 140) });
              setStore('khQueueLog', ql2.slice(0, 20));
            } catch (e3) {}
          });
        }
        toast('📡 开发端下发：' + (it.label || it.action) + (it.note ? '｜' + it.note : ''));
      } catch (e) { result = 'failed'; note = '执行出错：' + (e && e.message || e); }
      try {
        var qlog = getStore('khQueueLog', []) || [];
        qlog.unshift({ ts: new Date().toISOString(), at: it.at, action: it.action, label: it.label || it.action, version: it.version || '', result: result, note: String(note || '').slice(0, 140) });
        setStore('khQueueLog', qlog.slice(0, 20));
      } catch (e2) {}
      ackNow();
      if (it.action === 'reload' && result === 'done') setTimeout(function () { location.reload(); }, 1200);
    }).catch(function () {});
}

/* 自动下发 + 自动更新：启动即自动跑一轮，之后每 10 分钟自动比对版本与播放档位。
   桌面端与深开鸿端共用（HAP 端的 fetch 包装会自动把 /api/ 指向桌面中枢），全程无需人工。 */
try {
  setTimeout(khApplyDeliveryPlan, 1500);
  setInterval(khApplyDeliveryPlan, 600000);
  // OS 版本检测回传：启动 3 秒后自动跑一轮，之后每 10 分钟自动回传并同步优化结果
  setTimeout(khReportDevice, 3000);
  setInterval(khReportDevice, 600000);
  // 开发端下发队列：启动 5 秒后先取一次，之后每 60 秒一次
  setTimeout(khQueuePoller, 5000);
  setInterval(khQueuePoller, 60000);
  // 记住上次倍速：启动即恢复，播放按钮上直接显示
  try {
    var savedRate = Number(getStore('kh_rate', 1)) || 1;
    if(RATES.indexOf(savedRate) >= 0 && savedRate !== 1){
      state.rate = savedRate;
      els.video.playbackRate = savedRate;
      els.btnRate.textContent = savedRate.toFixed(2).replace(/0$/, '') + '×';
      els.btnRate.classList.add('on');
    }
  } catch(e){}
  // 记住上次音量与静音：启动即恢复（非用户操作，不回写存储）
  try {
    var savedVol = Number(getStore('kh_vol', 1));
    if(isFinite(savedVol) && savedVol >= 0 && savedVol <= 1) state.userVolume = savedVol;
    state.userMuted = Number(getStore('kh_mute', 0)) === 1;
    applyVolume(state.userVolume, false);
  } catch(e){}
  // 兼容模式 / 响度均衡：恢复本机偏好（音频图在首次播放时再建，避开自动播放限制）
  try {
    state.compatMode = Number(getStore('kh_compat_mode', 0)) === 1;
    state.loudnessEq = Number(getStore('kh_loudness_eq', 0)) === 1;
    var _fit = String(getStore('kh_fit', 'contain'));
    if(KH_FIT_MODES.indexOf(_fit) >= 0) khApplyFit(_fit);
  } catch(e){}
  // 低配设备建议：内存 ≤2GB 或 CPU ≤2 线程且未开兼容模式时，提示可开启兼容播放模式
  try{
    var _mem = navigator.deviceMemory || 4, _cores = navigator.hardwareConcurrency || 4;
    if((_mem <= 2 || _cores <= 2) && !state.compatMode){
      setTimeout(function(){ toast('本机配置偏低：若播放卡顿，可在设置里开启「兼容播放模式」'); }, 1800);
    }
  }catch(e){}
  // 桌面环境兜底信息（GPU 兼容模式 / 数据目录可写 / 端口状态）：只读缓存进诊断报告
  try{ if(window.khEnvInfo) window.khEnvInfo.get().then(function(e){ window.KH_ENV_INFO = e; }).catch(function(){}); }catch(e){}
  // 本机崩溃 / 异常日志（#95）：主进程落盘，只读缓存进诊断报告
  try{ if(window.khCrashLog) window.khCrashLog.get().then(function(l){ window.KH_CRASH_LOG = Array.isArray(l) ? l : []; }).catch(function(){}); }catch(e){}
  // 上次非正常退出标记（#96）：读到后提示并引导查看诊断报告
  try{ if(window.khStartupState) window.khStartupState.get().then(function(s){
    var lc = s && s.lastCrash;
    if(lc){ window.KH_LAST_CRASH = lc; setTimeout(function(){ toast('检测到上次非正常退出（' + (lc.kind || '崩溃') + '）：可到「问题」页复制诊断报告反馈'); }, 1200); }
  }).catch(function(){}); }catch(e){}
  // 桌面桥专属按钮：无对应桥（纯网页 / HAP）时隐藏，避免点了只报「不支持」
  try{
    var extBtn = byId('btnExternal');
    if(extBtn && !window.khExternal) extBtn.style.display = 'none';
    var castBtn = byId('btnCast');
    if(castBtn && !(window.khCast && window.khCast.discover)) castBtn.style.display = 'none';
    var dlCurBtn = byId('btnDlCurrent');
    if(dlCurBtn && !window.khDl) dlCurBtn.style.display = 'none';
  }catch(e){}
  try{
    if(window.khDownload) window.khDownload.on(function(st){
      if(!st) return;
      if(st.state === 'done'){
        toast('下载完成：' + (st.filename || ''));
        khNotifyPush('下载完成', st.filename || '文件已下载到本机');
      }
      else if(st.state === 'start'){ toast('开始下载：' + (st.filename || '')); }
    });
  }catch(e){}
  // 全局媒体快捷键（#116）：播放/暂停转发；无桌面桥时不绑定
  try{
    if(window.khShortcut) window.khShortcut.on(function(action){
      if(action === 'playpause' && typeof togglePlay === 'function'){ togglePlay(); }
    });
  }catch(e){}
  // 首启声明：未同意过条款则弹层，同意时间存本机
  try { khFirstRunConsent(); } catch(e){}
  // 字号调节：恢复上次设置（zoom 缩放整页，Chromium/ArkWeb 均支持）
  try { applyFontScale(); } catch(e){}
  // 网络代理：按上次保存的模式应用（跟随系统 / 直连 / 手动），失败不影响启动
  try {
    var _px = getStore('kh_proxy', null);
    if(_px && window.khProxy) window.khProxy.set({ mode: _px.mode || 'system', server: _px.server || '' });
  } catch(e){}
  // 仓自带直播源：先用上次解析结果并入直播频道，再后台拉取刷新（不阻塞首屏）
  try { khSyncWhLives(function(n){ if(n) setTimeout(function(){ try { render(); } catch(e){} }, 80); }); } catch(e){}
  // 夜间/长辈模式：恢复上次设置
  try { khApplyDisplay(); } catch(e){}
  // 界面语言 + 搜索联想
  try { khApplyLang(); } catch(e){}
  try { khSuggestBind(); } catch(e){}
  // 启动埋点：脚本就绪到首屏渲染完成的耗时，存本机并在设置页「版本与升级」展示，
  // 同时写进诊断报告（不混入问题列表，避免每次启动刷屏）
  try {
    var _bootMs = Math.round(performance.now());
    setStore('kh_boot_ms', _bootMs);
  } catch(e){}
  // TV / 方向键焦点导航
  try { khTvNavInstall(); } catch(e){}
  // 升级失败检测：上次升级版本没变则提示并提供回滚入口
  try { khCheckUpgradePending(); } catch(e){}
  // 字幕字号 / 位置
  try { khApplySubStyle(); } catch(e){}
  // 开机静默巡检：启动 20 秒后探测片源与自建站点可达性（复用 10 分钟缓存，不打扰用户；
  // 全部线路失效的片子会带「⚠ 线路不可用」角标，进入对应页面时可见）
  setTimeout(function(){
    try { probeMovieSources(false); } catch(e){}
    try { probeCustomSites(false); } catch(e){}
  }, 20000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { khApplyDeliveryPlan(); khReportDevice(); khQueuePoller(); }
  });
} catch (e) {}


/* 自检入口：便于无头浏览器验证「点击即播」链路。
   ?selftest=1     自动播放第一部（在线主源，验证多源回退）
   ?selftest=local 自动播放第一部的备用线路（验证换源链路）
   ?selftest=sites 落在网站管理视图 */
if(/[?&]selftest=1/.test(location.search)){
  setTimeout(function(){ openPlayer(allMovies()[0]); }, 60);
}
if(/[?&]selftest=local/.test(location.search)){
  setTimeout(function(){ openPlayer(allMovies()[0], 2); }, 60);
}
/* 预览入口：?view=live 只停在直播频道列表，不自动播放 */
if(/[?&]view=live(?:&|$)/.test(location.search)){
  state.view = 'live'; render();
}
/* 直播自检：三条独立播放路径，不依赖频道库具体数量。
   live       = 第一个频道，从网络主源起播（验证点开直接播真实直播）
   livehls    = 直接加载网络 HLS 直播流（验证原生 / hls.js 引擎分层）
   liveonline = 带真实网络源的频道，从在线源起播（验证网络直播 + 看门狗） */
var liveSelfTest = /[?&]selftest=(live|livehls|liveonline)(?:&|$)/.exec(location.search);
if(liveSelfTest){
  state.view = 'live'; render();
  var liveMode = liveSelfTest[1];
  setTimeout(function(){
    if(liveMode === 'livehls'){
      var ch = {id:'selftest_hls', no:1, name:'网络 HLS 自检', group:'自检', logo:'H',
                color:'#2E86C1', epg:EPG_NEWS, net:true,
                sources:[{label:'网络 HLS 源', url:'http://124.165.251.82:85/tsfile/live/0001_1.m3u8?key=txiptv&playlive=1&authid=0'}]};
      openPlayer(liveMovieObj(ch), 0);
    } else if(liveMode === 'liveonline'){
      var netCh = LIVE_CHANNELS.filter(function(c){ return c.net; })[0];
      openLiveChannel(netCh, 0);
    } else {
      openLiveChannel(LIVE_CHANNELS[0], 0);
    }
  }, 80);
}
/* 直播页时钟（仅改文本，不触发 render） */
setInterval(function(){
  var hc = document.getElementById('heroClock');
  var lc = document.getElementById('lbClock');
  if(!hc && !lc) return;
  var d = new Date(), p = function(n){ return (n < 10 ? '0' : '') + n; };
  var t = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  if(hc) hc.textContent = t;
  if(lc) lc.textContent = t;
}, 1000);

/* ================= 剩余六项能力（客户端侧） =================
   远程功能开关由服务端 /api/features 过滤后下发；此处实现：
   儿童时段模式 / 双端接力 / 聚合搜索 / 双指标选源 / 升级遥测
   ============================================================ */
(function(){
  var X = window.KH_EXTRAS = window.KH_EXTRAS || {};

  function j(u){
    try{ return fetch(u,{cache:'no-store'}).then(function(r){ return r.json(); }); }
    catch(e){ return Promise.resolve(null); }
  }
  function jp(u,b){
    try{ return fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})}).then(function(r){ return r.json(); }); }
    catch(e){ return Promise.resolve(null); }
  }
  function say(s){ try{ if(typeof toast==='function') toast(s); else alert(s); }catch(e){} }

  /* ---- 1) 儿童时段模式 ---- */
  function kidBanner(d, off){
    var bar = document.getElementById('khKidBar');
    if(!bar && !off){
      bar = document.createElement('div'); bar.id = 'khKidBar';
      bar.setAttribute('style','position:fixed;left:0;right:0;top:0;z-index:9995;background:#7A2E3A;color:#FFE6EA;' +
        'font:13px/1.4 sans-serif;padding:9px 14px;display:flex;justify-content:space-between;align-items:center');
      bar.innerHTML = '<span>🔒 儿童时段（' + (d.window && d.window.start) + '–' + (d.window && d.window.end) +
        '）已屏蔽：' + ((d.blockGroups || []).join('、') || '敏感分组') + '</span>';
      var btn = document.createElement('button');
      btn.textContent = '解锁'; btn.setAttribute('style','border:0;border-radius:12px;padding:5px 12px;background:#FFE6EA;color:#7A2E3A;cursor:pointer');
      btn.onclick = function(){
        var cfg = X.kidCfg || {};
        var pin = cfg.pin || '';
        var input = '';
        try{ input = prompt('输入 4 位解锁码：') || ''; }catch(e){ input = ''; }
        if(pin && input.trim() !== pin){ say('解锁码不对'); return; }
        if(!pin){ say('未设置解锁码，正在关闭儿童时段'); }
        jp('/api/config/kid',{enabled:false}).then(function(r){
          if(r && r.ok){ applyKid({ok:true, inside:false, blockGroups:[], window:{}}); say('已关闭儿童时段'); }
          else say('取消失败');
        });
      };
      bar.appendChild(btn);
      document.body.appendChild(bar);
    }
    if(off && bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }
  function applyKid(d){
    if(!d || !d.ok) return;
    X.kidCfg = d.config || X.kidCfg || {};
    if(!window.__KID_ALL_LIVE) window.__KID_ALL_LIVE = (window.LIVE_CHANNELS || []).slice();
    var block = (d.blockGroups || []).map(function(x){ return String(x).trim().toLowerCase(); }).filter(Boolean);
    if(d.inside && block.length){
      window.LIVE_CHANNELS = window.__KID_ALL_LIVE.filter(function(c){
        return block.indexOf(String((c && c.group) || '').toLowerCase()) < 0;
      });
      kidBanner(d, false);
    } else {
      window.LIVE_CHANNELS = window.__KID_ALL_LIVE;
      kidBanner(d, true);
    }
    try{ if(typeof render === 'function') render(); }catch(e){}
  }
  function loadKid(){
    j('/api/config/kid').then(function(d){
      if(!d || !d.ok) return;
      X.kidCfg = d.config || {};
      if(d.enabled){
        try{ console.log('[儿童时段] 启用 · 窗口 ' + (d.window && d.window.start) + '–' + (d.window && d.window.end) +
          ' · 当前' + (d.inside ? '在时段内' : '不在时段内') + ' · 本机 ' + d.local); }catch(e){}
      }
      applyKid(d);
    });
  }
  X.kidUI = function(){
    var cur = X.kidCfg || {};
    var on = !cur.enabled;
    var start = prompt('时段开始（HH:MM），留空保持 ' + ((cur.window && cur.window.start) || '21:00'), (cur.window && cur.window.start) || '21:00');
    var end = prompt('时段结束（HH:MM），留空保持 ' + ((cur.window && cur.window.end) || '06:00'), (cur.window && cur.window.end) || '06:00');
    var gs = prompt('要屏蔽的分组（逗号分隔），留空保持 ' + ((cur.blockGroups || []).join('、') || '成人,福利,午夜'), (cur.blockGroups || []).join(','));
    jp('/api/config/kid',{
      enabled: on,
      window:{ start:(start || (cur.window && cur.window.start) || '21:00').trim(), end:(end || (cur.window && cur.window.end) || '06:00').trim() },
      blockGroups:(gs || '').split(/[,，]/).map(function(s){ return s.trim(); }).filter(Boolean)
    }).then(function(r){
      if(r && r.ok){ say(on ? '儿童时段已开启' : '儿童时段已关闭'); loadKid(); }
      else say('保存失败：' + ((r && r.error) || ''));
    });
  };

  /* ---- 2) 双端接力 ---- */
  function favList(){
    var out = [];
    try{ out = (typeof getFav === 'function') ? getFav() : JSON.parse(localStorage.getItem('kh_fav') || '[]'); }catch(e){ out = []; }
    return Array.isArray(out) ? out : [];
  }
  X.handoffMake = function(){
    var favs = favList();
    jp('/api/handoff',{ payload:{ kind:'favorites', product:'鸿汇影桌面版', favorites:favs,
      at:new Date().toISOString() } }).then(function(d){
      if(!d || !d.ok){ say('生成失败：' + ((d && d.error) || '')); return; }
      X.handoffCode = d.code;
      try{ localStorage.setItem('kh_handoff_code', d.code); }catch(e){}
      alert('接力码：' + d.code + '\n约 ' + Math.round((d.expiresIn || 600) / 60) + ' 分钟有效，一次性。\n' +
        '在开鸿设备的「双端接力」里输码即可取回 ' + favs.length + ' 个收藏。');
    });
  };
  X.handoffTake = function(){
    var code = '';
    try{ code = prompt('输入桌面端生成的 6 位接力码：') || ''; }catch(e){ code = ''; }
    if(!code.trim()) return;
    j('/api/handoff/get?code=' + encodeURIComponent(code.trim())).then(function(d){
      if(!d || !d.ok){ say('接力失败：' + ((d && d.error) || '')); return; }
      var favs = (d.payload && d.payload.favorites) || [];
      if(!favs.length){ say('接力内容里没有收藏'); return; }
      try{
        if(typeof setStore === 'function') setStore('kh_fav', favs); else localStorage.setItem('kh_fav', JSON.stringify(favs));
      }catch(e){}
      say('已取回 ' + favs.length + ' 个收藏');
      setTimeout(function(){ location.reload(); }, 900);
    });
  };

  /* ---- 3) 聚合搜索（一个框搜遍远端全目录） ---- */
  X.searchAll = function(q){
    var kw = q || '';
    if(!kw){ try{ kw = prompt('关键词（频道 / 平台 / 地区 / 电视台名）：') || ''; }catch(e){ kw = ''; } }
    if(!kw.trim()) return;
    j('/api/search?q=' + encodeURIComponent(kw.trim()) + '&limit=40').then(function(d){
      var p = document.getElementById('khSearchAllPanel');
      if(!p){ p = document.createElement('div'); p.id = 'khSearchAllPanel'; document.body.appendChild(p); }
      p.setAttribute('style','position:fixed;left:50%;top:8%;transform:translateX(-50%);z-index:9996;width:min(680px,92vw);' +
        'max-height:76vh;overflow:auto;background:#12151F;color:#E7ECF5;border:1px solid #2A2F40;border-radius:14px;' +
        'padding:16px;font:13px/1.5 sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.55)');
      if(!d || !d.ok){
        p.innerHTML = '<div style="font-weight:700;margin-bottom:8px">🌐 聚合搜索</div><div style="color:#9AA6C4">' +
          ((d && d.error) || '没有结果') + '</div><div style="text-align:right;margin-top:10px"><span id="khSaClose" style="color:#9AA6C4;cursor:pointer">关闭</span></div>';
      } else {
        var rows = (d.rows || []).map(function(r, i){
          return '<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08)">' +
            '<div style="font-weight:700">' + (r.name || '') + ' <span style="color:#8A8FA3;font-weight:400">' +
            (r.group ? '· ' + r.group : '') + (r.region ? ' · ' + r.region : '') + '</span></div>' +
            '<div style="color:#9AA6C4;font-size:12px;margin:2px 0 6px">' + r.usable + ' / ' + r.sources + ' 路可用' +
            (r.bestLabel ? ' · 推荐 ' + r.bestLabel : '') + '</div>' +
            (r.bestUrl ? '<button data-url="' + String(r.bestUrl).replace(/"/g, '&quot;') + '" data-name="' +
              String(r.name || '').replace(/"/g, '&quot;') + '" style="border:0;border-radius:9px;' +
              'padding:5px 11px;background:#262B3B;color:#E7ECF5;cursor:pointer;margin-right:6px">站内播放</button>' +
              '<button data-copy="' + i + '" style="border:0;border-radius:9px;padding:5px 11px;background:#262B3B;' +
              'color:#E7ECF5;cursor:pointer">复制链接</button>' : '') + '</div>';
        }).join('');
        p.innerHTML = '<div style="font-weight:700;margin-bottom:6px">🌐 聚合搜索 · 「' + kw.trim() + '」命中 ' +
          d.total + ' 条' + (d.truncated ? '（显示前 40）' : '') + '</div>' + (rows || '<div style="color:#9AA6C4">没有匹配</div>') +
          '<div style="text-align:right;margin-top:10px"><span id="khSaClose" style="color:#9AA6C4;cursor:pointer">关闭</span></div>';
        Array.prototype.forEach.call(p.querySelectorAll('button[data-url]'), function(b){
          b.onclick = function(){
            var name = b.getAttribute('data-name') || '';
            var url = b.getAttribute('data-url') || '';
            var local = (window.LIVE_CHANNELS || []).filter(function(c){ return String(c.name || '') === name; })[0];
            if(local && typeof openLiveChannel === 'function'){
              p.style.display = 'none';
              openLiveChannel(local, 0);
              return;
            }
            /* 本地没有这个条目：走内置播放器直接放，不再跳系统浏览器 */
            if(typeof openPlayer === 'function' && typeof customMovie === 'function'){
              p.style.display = 'none';
              try{
                var mo = customMovie(url);
                if(mo && name) mo.title = name;
                openPlayer(mo);
                return;
              }catch(e){}
            }
            window.open(url, '_blank');
          };
        });
        Array.prototype.forEach.call(p.querySelectorAll('button[data-copy]'), function(b){
          b.onclick = function(){
            var r = d.rows[Number(b.getAttribute('data-copy'))];
            try{ if(typeof copyText === 'function'){ copyText(r.bestUrl, '线路链接'); return; } }catch(e){}
            try{ localStorage.setItem('kh_last_url', r.bestUrl); }catch(e2){}
            alert(r.bestUrl);
          };
        });
      }
      var cl = document.getElementById('khSaClose');
      if(cl) cl.onclick = function(){ p.style.display = 'none'; };
    });
  };

  /* ---- 4) 双指标选源（成功率 60% + 时延 40%） ---- */
  X.rankSources = function(){
    say('正在按「成功率 + 时延」重排线路 …');
    j('/api/stats/source-rank?limit=300').then(function(d){
      if(!d || !d.ok){ say('评分失败：' + ((d && d.error) || '')); return; }
      var byName = {};
      (d.rows || []).forEach(function(r){ byName[String(r.name).trim()] = r; });
      var changed = 0;
      (window.LIVE_CHANNELS || []).forEach(function(c){
        var r = byName[String(c.name || '').trim()];
        if(!r || !r.ranked || !r.ranked.length) return;
        var order = {};
        r.ranked.forEach(function(x, i){ order[x.url] = i; });
        var s = (c.sources || []).slice();
        if(s.length < 2) return;
        s.sort(function(a, b){
          var ia = order[a.url], ib = order[b.url];
          if(ia === undefined && ib === undefined) return 0;
          if(ia === undefined) return 1;
          if(ib === undefined) return -1;
          return ia - ib;
        });
        if(JSON.stringify(s) !== JSON.stringify(c.sources)){ c.sources = s; changed++; }
      });
      X.rankApplied = changed;
      say(changed ? ('已按评分重排 ' + changed + ' 个频道的线路（首选线路置顶）') : '线路顺序已是最优');
    });
  };

  /* ---- 5) 升级遥测 ---- */
  function tel(stage, extra){
    var v = window.KH_FEATURE_VERSION || {};
    var body = {
      stage: stage,
      versionName: v.versionName || '',
      versionCode: v.versionCode || v.count || 0,
      platform: 'windows',
      deviceId: (function(){ try{ return localStorage.getItem('kh_device_id') || ''; }catch(e){ return ''; } })()
    };
    if(extra) Object.keys(extra).forEach(function(k){ body[k] = extra[k]; });
    return jp('/api/telemetry/update', body);
  }
  X.tel = tel;
  function wrapTelemetry(fnName, stage){
    var orig = window[fnName];
    if(typeof orig !== 'function') return;
    window[fnName] = function(){
      try{
        var r = orig.apply(this, arguments);
        tel(stage, {ok:true});
        return r;
      }catch(e){
        tel(stage, {ok:false, error:String((e && e.message) || e)});
        throw e;
      }
    };
  }
  wrapTelemetry('khFeatureUpdateCheck', 'check');
  wrapTelemetry('khFeatureAutoUpdate', 'install');
  wrapTelemetry('khFeatureUpdatePublish', 'publish');

  /* ==== 系统版本自动适配：旧系统 / 深开鸿 5.x(API14) / 6.x 共用同一套代码 ==== */
  function osEnv(){
    var info = window.__KH_OS || null;
    var ua = (navigator && navigator.userAgent) || '';
    var m = /OpenHarmony\s*([\d.]+)/i.exec(ua) || /HarmonyOS[-\s]*([\d.]+)/i.exec(ua) || /ArkWeb\/([\d.]+)/i.exec(ua);
    var api = info && Number(info.sdkApiVersion) || 0;
    var ver = (info && (info.osFullName || info.osVersion || info.api)) || (m && m[1]) || '';
    var dev = String((info && info.deviceType) || '').toLowerCase();
    var name = String((info && (info.distributionOSName || info.osFullName)) || '') + ' ' + ua;
    return {
      ver: String(ver || ''),
      api: api,
      device: dev,
      kaihong: /Kaihong|开鸿/i.test(name),
      desktop: dev === '2in1' || dev === 'pc' || dev === 'default',
      harmony: !!(info || /OpenHarmony|HarmonyOS|ArkWeb|Kaihong/i.test(ua))
    };
  }
  function applyOsAdapt(){
    var os = osEnv();
    var de = document.documentElement;
    de.setAttribute('data-os', os.harmony ? 'harmony' : 'desktop');
    de.setAttribute('data-os-ver', os.ver);
    de.setAttribute('data-os-api', String(os.api || 0));
    de.setAttribute('data-os-form', os.desktop ? 'desktop' : (os.device || 'default'));
    if(os.kaihong) de.setAttribute('data-os-brand', 'kaihong');
    /* 新系统判定：深开鸿 5.0.2(API14) 起与 6.x 同等按新版处理（ArkWeb 新内核 + 桌面窗口化） */
    var major = Number((os.ver || '0').split('.')[0]) || 0;
    var newOs = os.harmony && (os.api >= 14 || major >= 6);
    de.setAttribute('data-os-gen', newOs ? 'new' : 'old');
    var st = document.getElementById('kh-os-style');
    if(!st){
      st = document.createElement('style');
      st.id = 'kh-os-style';
      (document.head || de).appendChild(st);
    }
    st.textContent =
      'html,body{min-height:100%;}body{overscroll-behavior:none;' +
      '-webkit-overflow-scrolling:touch;}' +
      'body{padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);}' +
      (newOs && !os.desktop ? 'body{padding-bottom:env(safe-area-inset-bottom);}' : '') +
      (newOs ? '.kh-player video,.player video{object-fit:contain;}html{-webkit-text-size-adjust:100%;}' : '');
    window.KH_OS = os;
    try{ window.KH_OS_ADAPT = newOs ? 'new' : 'old'; }catch(e){}
  }
  try{ applyOsAdapt(); }catch(e){}
  window.applyOsAdapt = applyOsAdapt;   /* 供 HAP 壳在系统信息就绪后重算 */
  /* 上报一次系统版本，客户端不再靠猜；同一会话只发一次 */
  try{
    if(!sessionStorage.getItem('kh_os_sent')){
      var o = osEnv();
      tel('os', {os: o.ver, api: o.api, harmony: o.harmony ? 1 : 0});
      sessionStorage.setItem('kh_os_sent', '1');
    }
  }catch(e){}

  /* ---- 6) 功能分发：把新动作挂到扩展工具面板 ---- */
  var origRun = window.khRunFeature;
  if(typeof origRun === 'function'){
    window.khRunFeature = function(f){
      var a = (f && f.action) || '';
      if(a === 'builtin:kidmode'){ X.kidUI(); return; }
      if(a === 'builtin:handoff'){ X.handoffMake(); return; }
      if(a === 'builtin:handofftake'){ X.handoffTake(); return; }
      if(a === 'builtin:searchall'){ X.searchAll(); return; }
      if(a === 'builtin:rank'){ X.rankSources(); return; }
      return origRun.apply(this, arguments);
    };
  }

  loadKid();
  /* 启动拉取：云端推荐位 / 更新通道 / 本机追剧订阅；失败静默保留本机缓存 */
  try{ refreshPromo(); refreshChannel(); refreshWatchSubFromServer(); checkWatchSub(); }catch(e){}
  /* 每 5 分钟重判一次：进入/离开儿童时段自动生效，不用重启客户端 */
  setInterval(function(){
    j('/api/config/kid').then(function(d){
      if(!d || !d.ok) return;
      var was = !!(X.kid && X.kid.inside);
      X.kid = d;
      if(d.inside !== was || d.enabled !== !!(X.kidCfg && X.kidCfg.enabled)){
        applyKid(d);
      } else if(d.inside){
        kidBanner(d, false);   // 横幅被人关掉也会补回来
      }
    });
  }, 5 * 60 * 1000);
  document.addEventListener('keydown', function(e){
    if(e && e.key === 'Escape'){ var p = document.getElementById('khSearchAllPanel'); if(p) p.style.display = 'none'; }
  });
})();
