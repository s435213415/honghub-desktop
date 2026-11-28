/* HongHub 前端模块：自建片源 CRUD/网站管理
   由 app/index.html 单文件版拆分（1.7.72 模块化），按 <script> 顺序加载，顶层函数/常量共享全局作用域。 */
/* 1.7.96 分发口径：侵权投诉入口。分发前必须填真实可达的邮箱；空着时界面如实提示「未配置」，
   不做假地址，也不假装有投诉通道。只用于内容/入口下架请求，不收集其他信息。 */
var KH_ABUSE_MAIL = '';
var KH_ABUSE_SLA_HOURS = 72;
function khAbuseLine(){
  if (KH_ABUSE_MAIL) {
    return '侵权投诉：' + KH_ABUSE_MAIL + '。收到可核实的投诉后，' + KH_ABUSE_SLA_HOURS + ' 小时内下线对应入口或片源条目。';
  }
  return '侵权投诉渠道：<b>尚未配置</b>（分发版必须在 kh-admin.js 的 KH_ABUSE_MAIL 填入真实可达邮箱，否则不应对外分发）。';
}
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
  /* ---- 备份与恢复（台账 #160） ---- */
  else if(act === 'bak-export') khExportUserData();
  else if(act === 'bak-export-enc'){
    khBakPromptPass('导出加密备份', '给备份设一个密码（至少 6 位）。PBKDF2-SHA256 20 万次派生 + AES-256-GCM 加密，密码不写进文件，丢了没法找回。', '加密导出', function(pass){
      khExportUserData({ encrypt: true, pass: pass });
    });
  }
  else if(act === 'bak-import') khImportUserData();
  else if(act === 'bak-auto-save'){
    var onEl = document.getElementById('bakAutoOn'), evEl = document.getElementById('bakAutoEvery'), kpEl = document.getElementById('bakAutoKeep');
    var cfg = khBakAutoSaveCfg({
      on: !!(onEl && onEl.value === '1'),
      every: (evEl && evEl.value) || 'daily',
      keep: Number((kpEl && kpEl.value) || 3)
    });
    toast(cfg.on ? '自动备份已开启：' + (cfg.every === 'launch' ? '每次启动' : cfg.every === 'weekly' ? '每周一次' : '每天一次') + '，保留最近 ' + cfg.keep + ' 份' : '自动备份已关闭');
    KH_BAK_AUTO_SESSION = false;
    render();
  }
  else if(act === 'bak-dir-pick'){
    if(window.khBackupFile && typeof window.khBackupFile.pickDir === 'function'){
      window.khBackupFile.pickDir().then(function(r){
        if(r && r.ok && r.dir){
          khBakAutoSaveCfg({ dir: r.dir });
          toast('自动备份目录已设为：' + r.dir);
          render();
        } else if(r && r.canceled){ toast('已取消选择'); }
        else { toast('选目录失败：' + ((r && r.reason) || '未知原因')); }
      });
    } else {
      toast('当前环境不支持选目录（仅桌面版可指定；设备端与网页版走系统默认位置）');
    }
  }
  else if(act === 'bak-dir-open'){
    if(window.khBackupFile && typeof window.khBackupFile.openDir === 'function'){
      window.khBackupFile.openDir({ dir: khBakAutoCfg().dir || '' }).then(function(r){
        if(!r || !r.ok) toast('打开目录失败：' + ((r && r.reason) || '未知原因'));
      });
    } else {
      toast('当前环境无法打开目录；备份默认保存在文档目录下的「鸿汇影·备份」');
    }
  }
  else if(act === 'bak-snap-restore'){
    var idx = Number(node && node.getAttribute ? node.getAttribute('data-i') : -1);
    khSnapRestore(idx);
    render();
  }
  else if(act === 'bak-snap-clear'){
    khSnapSave([]);
    toast('已清空配置快照');
    render();
  }
  else if(act === 'fav-clear-yes') clearFav(true);
  else if(act === 'fav-clear-no'){ state.favConfirmClear = false; render(); }
  else if(act === 'hist-clear') clearHist(false);
  else if(act === 'hist-clear-yes') clearHist(true);
  else if(act === 'hist-clear-no'){ state.histConfirmClear = false; render(); }
  /* ---- P2 性能 / 无障碍 / 安全（台账 #161） ---- */
  else if(act === 'p2-save'){
    var grp = String((node && node.getAttribute && node.getAttribute('data-grp')) || '');
    var pv = function(id){ var el = document.getElementById(id); return el ? el.value : null; };
    var patch = {};
    if(grp === 'net'){
      patch.netConc = Number(pv('p2NetConc'));
      patch.netTimeout = Number(pv('p2NetTimeout'));
      patch.netRetry = Number(pv('p2NetRetry'));
      patch.liveQuality = pv('p2LiveQuality');
      patch.liveAutoStart = Number(pv('p2LiveAuto'));
      patch.cardDensity = pv('p2CardDensity');
    } else if(grp === 'a11y'){
      patch.focusRing = pv('p2Focus');
      patch.volKeys = pv('p2Vol');
      patch.subFont = pv('p2SubFont');
      patch.subStroke = pv('p2SubStroke');
      patch.subPos = Number(pv('p2SubPos'));
    } else if(grp === 'sec'){
      patch.storeHarden = Number(pv('p2Harden'));
      var ta = document.getElementById('p2HookHosts');
      if(ta){
        var lines = String(ta.value || '').split(/[\r\n,，;；]+/);
        var hosts = [];
        for(var hi = 0; hi < lines.length; hi++){
          var h1 = String(lines[hi] || '').trim().toLowerCase();
          if(h1 && hosts.indexOf(h1) < 0 && hosts.length < 32) hosts.push(h1.slice(0, 80));
        }
        patch.webhookHosts = hosts;
      }
    }
    var pc = khP2CfgSave(patch);
    khP2Apply(true);
    if (grp === 'a11y') { try { khApplySubStyle(); } catch (e) {} }
    if(grp === 'net'){
      toast('网络与显示已保存：并发 ' + pc.netConc + ' · 超时 ' + pc.netTimeout + ' 秒 · 重试 ' + pc.netRetry + ' 次');
    } else if(grp === 'a11y'){
      toast('无障碍设置已保存：焦点框 / 音量键 / 字幕字体描边位置已即时生效');
    } else {
      toast('安全设置已保存：白名单 ' + pc.webhookHosts.length + ' 条 · 配置封条' + (pc.storeHarden ? '开' : '关'));
      /* 白名单同时下发到本机中枢：服务端外发（告警 Webhook）按同一份名单执行，
         避免「界面写了白名单、服务端照旧往任意地址发」的两套口径。 */
      try{
        khFetch('/api/alerts/config', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowHosts: pc.webhookHosts })
        }).then(function(r){ return r.json(); }).then(function(d){
          if(!d || !d.ok) return;
          var cfgSrv = d.config || {};
          if(pc.webhookHosts.length && !cfgSrv.allowHosts){
            toast('注意：中枢未接受白名单，请检查是否运行在开发端中枢');
          }
        }).catch(function(){ /* 无中枢（设备端 / 纯网页）时静默，不影响本机设置 */ });
      }catch(e){}
    }
    render();
  }
  else if(act === 'pref-save'){
    /* 1.7.90 偏好与行为（清单 #27 #28 #29 #43 #50 #51）：写键 + 立即生效 */
    var pv2 = function(id){ var el = document.getElementById(id); return el ? el.value : null; };
    var cap = Number(pv2('prefHistCap')); if(!isFinite(cap) || cap < 10) cap = 30;
    var days = Number(pv2('prefHistDays')); if(!isFinite(days) || days < 0) days = 0;
    setStore('kh_hist_cap', cap);
    setStore('kh_hist_days', days);
    setStore('kh_resume', String(pv2('prefResume') || 'ask'));
    setStore('kh_autonext', String(pv2('prefAutoNext')) === '1' ? 1 : 0);
    setStore('kh_open_mode', String(pv2('prefOpen') || 'play'));
    setStore('kh_search_scope', String(pv2('prefScope') || 'builtin'));
    setStore('kh_wh_join', String(pv2('prefWhJoin')) === '0' ? 0 : 1);
    setStore('kh_motion', String(pv2('prefMotion')) === '0' ? 0 : 1);
    var stall = Number(pv2('prefStall')); if(!isFinite(stall) || stall < 1 || stall > 10) stall = 3;
    var watch = Number(pv2('prefWatch')); if(!isFinite(watch) || watch < 0) watch = 0;
    setStore('kh_stall_limit', stall);
    setStore('kh_watchdog_ms', watch);
    khPrefApply();
    /* 立即按新上限裁一遍历史，避免「设置里写着 10 条、历史页还有 40 条」 */
    try{
      var _h = khTrimHist(strArray('kh_hist'));
      setStore('kh_hist', _h);
    }catch(e){}
    toast('偏好已保存：历史 ' + cap + ' 条 / ' + (days ? days + ' 天' : '不限天') + ' · 续播 ' +
      ({ ask: '先问', always: '直接跳', never: '从头' }[khPref().resume] || '先问') +
      ' · 自动下一部 ' + (khPref().autoNext ? '开' : '关'));
    render();
  }
  else if(act === 'b8-save'){
    /* 1.7.91 高级与本地能力（台账 #167）：写键 + 立即应用 + 推给主进程（快捷键 / 外部播放器 / 通知 / 置顶） */
    var bv = function(id){ var el = document.getElementById(id); return el ? el.value : ''; };
    var K = window.KHPREF || null;
    var nhk = function(s){ return (K && typeof K.normHotkey === 'function') ? K.normHotkey(s) : String(s || '').trim(); };
    /* 儿童模式开关要过 PIN（1.7.91 #53 / 1.7.111 E）：
       开启必须设 4 位；已开启时要「关掉」或「换 PIN」都必须先验原 PIN（原 PIN 填「现有 PIN」框，
       或直接把原 PIN 填进 PIN 框）；连错 5 次锁 10 分钟，防止孩子自己改 PIN 或关掉。 */
    var curKid = khPref().kid ? 1 : 0;
    var wantKid = String(bv('prefKid')) === '1' ? 1 : 0;
    var curPin = String(khPref().kidPin || '');
    var inPin = String(bv('prefKidPin') || '').replace(/\D/g, '').slice(0, 4);
    var inOld = String(bv('prefKidPinOld') || '').replace(/\D/g, '').slice(0, 4);
    var changing = curKid && !!curPin && (!wantKid || inPin !== curPin);
    if(changing){
      var _chk = (typeof khKidPinCheck === 'function') ? khKidPinCheck(inOld || (!wantKid ? inPin : '')) : { ok: true };
      if(!_chk.ok){
        toast(_chk.locked ? ('PIN 连错太多次，已锁 ' + _chk.mins + ' 分钟')
                         : ('原 PIN 不正确，儿童模式保持不变（还可试 ' + _chk.left + ' 次）'));
        render(); return;
      }
    }
    if(wantKid && inPin.length !== 4){ toast('开启儿童模式前请先设 4 位数字 PIN'); render(); return; }
    setStore('kh_audio_lang', String(bv('prefAudio') || 'auto'));
    setStore('kh_sub_auto', String(bv('prefSubAuto')) === '0' ? 0 : 1);
    setStore('kh_sub_dir', String(bv('prefSubDir') || '').trim());
    setStore('kh_notify', String(bv('prefNotify') || 'all'));
    setStore('kh_notify_sound', String(bv('prefNotifySound')) === '0' ? 0 : 1);
    setStore('kh_top', String(bv('prefTop')) === '1' ? 1 : 0);
    setStore('kh_close_act', (function(v){
      return ['tray', 'quit', 'min'].indexOf(String(v)) >= 0 ? String(v) : 'tray';
    })(bv('prefClose')));
    setStore('kh_player_exe', String(bv('prefPlayerExe') || '').trim());
    setStore('kh_player_args', String(bv('prefPlayerArgs') || '').trim().slice(0, 200));
    setStore('kh_kid', wantKid);
    setStore('kh_kid_pin', wantKid ? inPin : (inPin || curPin));
    var kmin = String(bv('prefKidMin') || '').replace(/\D/g, '');
    setStore('kh_kid_min', Math.max(0, Math.min(240, kmin ? parseInt(kmin, 10) : 0)));
    setStore('kh_hotkeys', {
      toggle: nhk(bv('prefHkToggle')),
      next: nhk(bv('prefHkNext')),
      prev: nhk(bv('prefHkPrev')),
      mute: nhk(bv('prefHkMute')),
      top: nhk(bv('prefHkTop'))
    });
    khPrefApply();
    var _np = khPref();
    setStore('kh_top', _np.top);
    try{ setStore('kh_hotkeys', _np.hotkeys); }catch(e0){}
    khB8Sync().then(function(r){
      var reg = r && r.hotkeys;
      if(reg && reg.conflicts && reg.conflicts.length){
        toast('已保存，但 ' + reg.conflicts.length + ' 个快捷键被占用：' + reg.conflicts.map(function(x){ return x.accel; }).join('、'));
      }else if(r && r.ok === false){
        toast('已保存（本机能力未接通：' + (r.reason || '不支持') + '）');
      }else{
        toast('高级设置已保存：音轨 ' + ({ auto: '跟随', zh: '中文', en: '英文', ja: '日语', ko: '韩语' }[_np.audioLang] || '跟随') +
          ' · 通知 ' + ({ all: '全开', download: '只留下载', off: '全关' }[_np.notify] || '全开') +
          ' · 儿童模式 ' + (_np.kid ? ('开（PIN ' + (_np.kidPin || '未设') + '）') : '关') +
          ' · 关窗口 ' + ({ tray: '收进托盘', min: '最小化', quit: '直接退出' }[_np.closeAct] || '收进托盘') +
          ' · 快捷键已生效');
      }
    });
    render();
  }
  else if(act === 'b8-pick-dir'){
    if(!window.khB8 || typeof window.khB8.pick !== 'function'){ toast('当前环境不支持选择目录'); return; }
    window.khB8.pick('dir').then(function(r){
      if(!r || !r.ok){ if(!(r && r.canceled)) toast('选择目录失败：' + ((r && r.reason) || '未知')); return; }
      setStore('kh_sub_dir', String(r.path || ''));
      var el = document.getElementById('prefSubDir'); if(el) el.value = String(r.path || '');
      toast('字幕目录已设为：' + r.path);
    }).catch(function(e){ toast('选择目录失败：' + String(e && e.message || e)); });
  }
  else if(act === 'b8-pick-exe'){
    if(!window.khB8 || typeof window.khB8.pick !== 'function'){ toast('当前环境不支持选择程序'); return; }
    window.khB8.pick('exe').then(function(r){
      if(!r || !r.ok){ if(!(r && r.canceled)) toast('选择播放器失败：' + ((r && r.reason) || '未知')); return; }
      setStore('kh_player_exe', String(r.path || ''));
      var el = document.getElementById('prefPlayerExe'); if(el) el.value = String(r.path || '');
      khB8Sync();
      toast('外部播放器已设为：' + r.path);
    }).catch(function(e){ toast('选择播放器失败：' + String(e && e.message || e)); });
  }
  /* ---- 1.7.94 远端配置与云端（#69 #70 #71 #77 #66） ---- */
  else if(act === 'r-save'){
    var rvv = function(id){ var el = document.getElementById(id); return el ? el.value : ''; };
    setStore('kh_remote_notice', String(rvv('rNotice')) === '0' ? 0 : 1);
    setStore('kh_sync_on', String(rvv('rSync')) === '0' ? 0 : 1);
    khRemotePaint();
    toast('远端开关已保存：公告 ' + (Number(getStore('kh_remote_notice', 1)) ? '显示' : '不显示') +
      ' · 云同步 ' + (Number(getStore('kh_sync_on', 1)) ? '允许推拉' : '关闭'));
    render();
  }
  else if(act === 'r-refresh'){
    khRemoteLoad(true).then(function(v){
      toast('远端配置已刷新：rev ' + ((v && v.rev) || 0) + ' · 锁定 ' + (((v && v.locks) || []).length) + ' 项');
      render();
    }).catch(function(e){
      toast('刷新失败：' + String((e && e.message) || e) + '（检查中枢是否可达）');
    });
  }
  else if(act === 'r-push'){
    khSyncPush().then(function(r){
      if(r && r.ok) toast('已推送 ' + (r.keys || 0) + ' 个偏好键到云端');
      else toast('推送失败：' + ((r && r.error) || '云端拒绝'));
      render();
    }).catch(function(e){ toast('推送失败：' + String((e && e.message) || e)); });
  }
  else if(act === 'r-pull'){
    khSyncPull().then(function(r){
      if(!r || !r.ok){ toast('拉取失败'); return; }
      if(r.empty){ toast('云端还没有别的设备的偏好'); return; }
      toast('已从 ' + (r.from || '云端') + ' 拉回 ' + r.applied + ' 个偏好键，界面已刷新');
      try{ if(typeof khPrefApply === 'function') khPrefApply(); }catch(e){}
      try{ if(typeof khApplyDisplay === 'function') khApplyDisplay(); }catch(e){}
      try{ if(typeof khApplySubStyle === 'function') khApplySubStyle(); }catch(e){}
      render();
    }).catch(function(e){ toast('拉取失败：' + String((e && e.message) || e)); });
  }
  else if(act === 'r-notice-off'){
    var nid = String((node && node.getAttribute && node.getAttribute('data-nid')) || '');
    khRemoteDismiss(nid);
    toast('这条公告已关闭（换一条公告会重新出现）');
  }
  else if(act === 'r-notice-link'){
    var lk = String((node && node.getAttribute && node.getAttribute('data-link')) || '');
    if(/^#/.test(lk)){
      try{ window.location.hash = lk.slice(1); }catch(e){}
      return;
    }
    var done = function(){ toast('链接已复制：' + lk); };
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(lk).then(done).catch(function(){ toast('公告链接：' + lk); });
      }else toast('公告链接：' + lk);
    }catch(e){ toast('公告链接：' + lk); }
  }
  /* ---- 1.7.94 统一配置中心（#63）：单键存 / 单键恢复 / 分组恢复 / 全部恢复 ---- */
  else if(act === 'cfg-save'){
    var ck = String(node.getAttribute('data-k') || '');
    var cel = document.getElementById('cfg_' + ck);
    var crow = khCfgFind(ck);
    try{
      var cv = khCfgSave(ck, cel ? cel.value : '');
      try{ if(typeof khPrefApply === 'function') khPrefApply(); }catch(e){}
      try{ if(typeof khApplyDisplay === 'function') khApplyDisplay(); }catch(e){}
      try{ if(typeof khApplySubStyle === 'function') khApplySubStyle(); }catch(e){}
      toast('已保存「' + (crow ? crow.n : ck) + '」= ' + cv);
      render();
    }catch(e){ toast('保存失败：' + String((e && e.message) || e)); }
  }
  else if(act === 'cfg-one-reset'){
    var ck2 = String(node.getAttribute('data-k') || ''), cr2 = khCfgFind(ck2);
    if(cr2){
      setStore(cr2.k, cr2.d);
      toast('「' + cr2.n + '」已恢复默认（' + String(cr2.d) + '）');
      try{ if(typeof khPrefApply === 'function') khPrefApply(); }catch(e){}
      try{ if(typeof khApplyDisplay === 'function') khApplyDisplay(); }catch(e){}
      render();
    }
  }
  else if(act === 'cfg-reset'){
    var cg = String(node.getAttribute('data-g') || '');
    var cn = khCfgResetGroup(cg);
    toast('「' + cg + '」' + cn + ' 项已恢复默认');
    try{ if(typeof khPrefApply === 'function') khPrefApply(); }catch(e){}
    try{ if(typeof khApplyDisplay === 'function') khApplyDisplay(); }catch(e){}
    try{ if(typeof khApplySubStyle === 'function') khApplySubStyle(); }catch(e){}
    render();
  }
  else if(act === 'cfg-reset-all'){
    var can = khCfgResetAll();
    toast('全部 ' + can + ' 项已恢复默认（收藏 / 历史 / 片单未动）');
    try{ if(typeof khPrefApply === 'function') khPrefApply(); }catch(e){}
    try{ if(typeof khApplyDisplay === 'function') khApplyDisplay(); }catch(e){}
    render();
  }
  else if(act === 'cfg-clear'){
    state.cfgQ = '';
    render();
  }
  /* ---- 1.7.94 皮肤包（#78）：应用 / 删除 / 粘贴导入 / 远端下载 / 主题目录 ---- */
  else if(act === 'theme-apply'){
    var tid = String(node.getAttribute('data-id') || '');
    var tp = khThemeFind(tid);
    var tok = khThemeApply(tid);
    toast(tok ? ('已应用皮肤包「' + (tp ? tp.name : tid) + '」') : '应用失败：这个包的配色不完整');
    render();
  }
  else if(act === 'theme-del'){
    var tid2 = String(node.getAttribute('data-id') || '');
    try{ khThemeRemove(tid2); toast('皮肤包已删除'); render(); }
    catch(e){ toast('删除失败：' + String((e && e.message) || e)); }
  }
  else if(act === 'theme-clear'){
    khThemeApply('');
    toast('已回到内置皮肤（' + getStore('kh_theme', 'dark') + '）');
    render();
  }
  else if(act === 'theme-paste'){
    var tjson = document.getElementById('themeJson');
    try{
      var tps = khThemeImport(tjson ? tjson.value : '', 'paste');
      khThemeApply(tps[0].id);
      toast('已导入 ' + tps.length + ' 个皮肤包，已应用「' + tps[0].name + '」');
      render();
    }catch(e){ toast('导入失败：' + String((e && e.message) || e)); }
  }
  else if(act === 'theme-sample'){
    var tje = document.getElementById('themeJson');
    if(tje){
      tje.value = JSON.stringify({ name: '夜航示例', vars: { bg: '#02030A', card: '#0C1220', card2: '#121A2A', line: '#22304A', text: '#E8EDF7', muted: '#9AA6BF', brand: '#5AC8FA', brand2: '#8FE3FF' } }, null, 2);
    }
    toast('示例已填入，点「粘贴导入」即可装上');
  }
  else if(act === 'theme-url'){
    var turl = (document.getElementById('themeUrl') || {}).value || '';
    turl = String(turl).trim();
    if(!/^https?:\/\//i.test(turl)){ toast('请填 http(s) 开头的 themes.json 地址'); return; }
    toast('正在下载主题文件…');
    khRemoteReq(turl, { cache: 'no-store' }).then(function(resp){
      if(resp && resp.ok === false) throw new Error('HTTP ' + resp.status);
      return resp.text();
    }).then(function(txt){
      var ps = khThemeImport(txt, 'url');
      khThemeApply(ps[0].id);
      toast('已从远端导入 ' + ps.length + ' 个皮肤包，已应用「' + ps[0].name + '」');
      render();
    }).catch(function(e){ toast('下载失败：' + String((e && e.message) || e)); });
  }
  else if(act === 'theme-dir'){
    if(!window.khB8 || typeof window.khB8.themes !== 'function'){ toast('当前环境读不了本机目录（需要桌面版）'); return; }
    window.khB8.pick('dir').then(function(r){
      if(!r || !r.ok){ toast(r && r.canceled ? '已取消' : ('选择目录失败：' + ((r && r.reason) || '未知'))); return; }
      toast('正在读取主题目录…');
      return window.khB8.themes(r.path).then(function(t){
        if(!t || !t.ok){ toast('读取目录失败：' + ((t && t.reason) || '未知')); return; }
        if(!t.files || !t.files.length){ toast('目录里没有 *.json 主题文件'); return; }
        var got = 0, bad = 0, firstId = '';
        (t.files || []).forEach(function(f){
          try{
            var ps = khThemeImport(f.text, 'file');
            got += ps.length;
            if(!firstId && ps.length) firstId = ps[0].id;
          }catch(e){ bad++; }
        });
        if(firstId) khThemeApply(firstId);
        toast('从主题目录导入 ' + got + ' 个皮肤包' + (bad ? ('，' + bad + ' 个文件格式不对') : ''));
        render();
      });
    }).catch(function(e){ toast('主题目录导入失败：' + String((e && e.message) || e)); });
  }
  /* ---- 1.7.94 二维码 / 短链分享（#65） ---- */
  else if(act === 'share-make'){
    var st = document.getElementById('shareTitle'), su = document.getElementById('shareUrl');
    var shrTitle = String((st && st.value) || '').trim();
    var shrUrl = String((su && su.value) || '').trim();
    if(!shrTitle) shrTitle = state.movie ? ('鸿汇影 · ' + state.movie.title) : '鸿汇影 · 分享';
    toast('正在生成分享码…');
    khShareMake(shrTitle, shrUrl).then(function(rec){
      var qr = khQrCanvas(rec.short || rec.url, 240);
      if(!qr || !qr.ok){
        state.shareQr = '<p class="platnote">二维码生成失败：' + esc((qr && qr.error) || '内容过长（超过 213 字节）') + '</p>';
        render(); toast('二维码生成失败'); return;
      }
      state.shareQr = '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
        '<img alt="分享二维码" src="' + qr.dataUrl + '" width="200" height="200" style="border-radius:10px;background:#fff;padding:6px">' +
        '<div style="min-width:0;flex:1 1 240px"><div class="platnote">二维码 版本 ' + qr.version + ' · ' + qr.size + '×' + qr.size +
          ' 模块 · 纠错 M</div><div class="platnote"><b>' + esc(rec.title) + '</b><br>' + esc(rec.short || rec.url) + '</div>' +
          '<div class="siteform" style="margin-top:8px"><button class="mini" data-act="share-copy" data-text="' + esc(rec.short || rec.url) + '">复制链接</button></div>' +
          (rec.note ? '<div class="platnote">' + esc(rec.note) + '</div>' : '') + '</div></div>';
      render();
      toast(rec.code ? ('分享码已生成（短链 /s/' + rec.code + '）') : '分享码已生成（应用内分享）');
    }).catch(function(e){ toast('生成失败：' + String((e && e.message) || e)); });
  }
  else if(act === 'share-copy'){
    var sct = String(node.getAttribute('data-text') || '');
    if(!sct){ toast('没有可复制的链接'); return; }
    try{ copyIssueText(sct, '分享链接'); }catch(e){ toast('分享链接：' + sct); }
  }
  else if(act === 'share-qr'){
    var sqt = String(node.getAttribute('data-text') || '');
    var sqti = String(node.getAttribute('data-title') || '分享');
    if(!sqt){ toast('这条分享没有链接'); return; }
    var sq = khQrCanvas(sqt, 220);
    if(!sq || !sq.ok){ toast('二维码生成失败：' + ((sq && sq.error) || '内容过长')); return; }
    state.shareQr = '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
      '<img alt="分享二维码" src="' + sq.dataUrl + '" width="180" height="180" style="border-radius:10px;background:#fff;padding:6px">' +
      '<div><div class="platnote"><b>' + esc(sqti) + '</b></div><div class="platnote">' + esc(sqt) + '</div>' +
      '<div class="siteform" style="margin-top:8px"><button class="mini" data-act="share-copy" data-text="' + esc(sqt) + '">复制链接</button></div></div></div>';
    render();
    toast('二维码已生成');
  }
  /* ---- 1.7.94 家庭多档案（#58） ---- */
  else if(act === 'prof-switch'){
    var pid = String(node.getAttribute('data-id') || '');
    try{
      var psr = khProfSwitch(pid);
      toast(psr && psr.name ? ('已切到「' + psr.name + '」档案，收藏 / 历史 / 进度 / 儿童设置已换成它的') : '已切换档案');
      try{ if(typeof khPrefApply === 'function') khPrefApply(); }catch(e){}
      try{ if(typeof khApplyDisplay === 'function') khApplyDisplay(); }catch(e){}
      render();
    }catch(e){ toast('切换失败：' + String((e && e.message) || e)); }
  }
  else if(act === 'prof-add'){
    var pnm = (document.getElementById('profName') || {}).value || '';
    var pcl = (document.getElementById('profColor') || {}).value || '';
    try{
      var np = khProfAdd(pnm, pcl);
      var el = document.getElementById('profName'); if(el) el.value = '';
      toast('新档案「' + np.name + '」已建好并切过去（现在是空的收藏 / 历史 / 进度）');
      render();
    }catch(e){ toast('新建失败：' + String((e && e.message) || e)); }
  }
  else if(act === 'prof-rename'){
    var rid = String(node.getAttribute('data-id') || '');
    var rin = document.getElementById('profName_' + rid);
    try{
      khProfRename(rid, rin ? rin.value : '');
      toast('档案名已更新');
      render();
    }catch(e){ toast('改名失败：' + String((e && e.message) || e)); }
  }
  else if(act === 'prof-del'){
    var did = String(node.getAttribute('data-id') || '');
    var dl = khProfList();
    var dn = (dl.filter(function(x){ return x.id === did; })[0] || {}).name || '这个档案';
    try{
      khProfDel(did);
      toast('已删除档案「' + dn + '」（那份收藏 / 历史随之删除，未合并到别的档案）');
      try{ if(typeof khPrefApply === 'function') khPrefApply(); }catch(e){}
      render();
    }catch(e){ toast('删除失败：' + String((e && e.message) || e)); }
  }
  /* ---- 1.7.94 元数据来源（#59）/ 字幕站与 AI Key（#60）/ 网络族与 DNS（#37） ---- */
  else if(act === 'meta-save'){
    var msv = String((document.getElementById('metaSrc') || {}).value || 'builtin');
    var mkey = String((document.getElementById('metaKey') || {}).value || '').trim();
    var mtpl = String((document.getElementById('metaTpl') || {}).value || '').trim();
    setStore('kh_meta_src', window.KHMETA ? window.KHMETA.normSrc(msv) : msv);
    if(mkey) setStore('kh_tmdb_key', mkey);
    if(mtpl){
      var mt = window.KHMETA ? window.KHMETA.tplOk(mtpl) : { ok: false, error: '元数据模块未加载' };
      if(!mt.ok){ toast('刮削模板不对：' + mt.error); return; }
      setStore('kh_meta_custom', mt.url);
    }
    toast('元数据来源已保存：' + (window.KHMETA ? window.KHMETA.srcLabel(msv) : msv) +
      (msv === 'tmdb' && !mkey ? '（还没填 Key，刮削时会提示）' : ''));
    render();
  }
  else if(act === 'meta-scrape'){
    var mv = state.movie;
    if(!mv){ toast('先在片单里点开一部片，再回来刮削（只刮当前这一部）'); return; }
    var mid = String(mv.id || mv.title || '');
    var myear = String(mv.year || (String(mv.desc || '').match(/(19|20)\d{2}/) || [''])[0] || '');
    toast('正在刮削「' + String(mv.title || '当前片') + '」…');
    khMetaScrape(mid, mv.title, myear).then(function(r){
      toast('已拿到元数据：' + (r.meta && r.meta.title ? r.meta.title : '') + (r.meta && r.meta.rating ? (' · ' + r.meta.rating + ' 分') : ''));
      render();
    }).catch(function(e){ toast('刮削失败：' + String((e && e.message) || e)); });
  }
  else if(act === 'meta-clear'){
    setStore('kh_meta_cache', {});
    toast('刮削缓存已清空');
    render();
  }
  else if(act === 'sub-sites-save'){
    var sst = String((document.getElementById('subSites') || {}).value || '');
    var ssl = window.KHMETA ? window.KHMETA.subSites(sst) : [];
    if(!ssl.length && sst.trim()){ toast('没解析出合法地址：只收 http(s) 开头的，一行一个'); return; }
    setStore('kh_sub_src', ssl.join('\n'));
    toast('字幕站已保存 ' + ssl.length + ' 个');
    render();
  }
  else if(act === 'ai-save'){
    var aikey = String((document.getElementById('aiKey') || {}).value || '').trim();
    var aibase = String((document.getElementById('aiBase') || {}).value || '').trim();
    var ab = window.KHMETA ? window.KHMETA.aiBase(aibase) : { ok: false, error: '模块未加载' };
    if(!ab.ok){ toast('接口地址不对：' + ab.error); return; }
    if(aikey){
      var ak = window.KHMETA ? window.KHMETA.keyOk(aikey) : { ok: false, error: '模块未加载' };
      if(!ak.ok){ toast('Key 不合规：' + ak.error); return; }
      setStore('kh_ai_key', ak.key);
    }
    setStore('kh_ai_base', ab.base);
    var ael = document.getElementById('aiKey'); if(ael) ael.value = '';
    toast(aikey ? ('Key 已保存在本机（' + (window.KHMETA ? window.KHMETA.keyMask(String(getStore('kh_ai_key','')||'')) : '***') + '）') : '接口地址已保存');
    render();
  }
  else if(act === 'ai-clear'){
    setStore('kh_ai_key', '');
    var cel2 = document.getElementById('aiKey'); if(cel2) cel2.value = '';
    toast('已清除本机 AI Key（备份里本来就没有它）');
    render();
  }
  else if(act === 'net-save'){
    var nmode = String((document.getElementById('netMode') || {}).value || 'auto');
    var ndns = String((document.getElementById('netDns') || {}).value || '');
    var nlist = window.KHMETA ? window.KHMETA.dnsList(ndns) : [];
    if(ndns.trim() && !nlist.length){ toast('DNS 填得不对：只要 IP 或域名，最多 3 个'); return; }
    setStore('kh_net_family', window.KHMETA ? window.KHMETA.normIpMode(nmode) : nmode);
    setStore('kh_dns', nlist.join(','));
    khNetPush().then(function(r){
      var box = document.getElementById('netOut');
      var txt = (window.KHMETA ? window.KHMETA.netNote(nmode, nlist) : '') +
        (r && r.ok ? (r.restart ? ' 已写入主进程，下次启动生效。' : ' 已写入主进程。') : (' 主进程未接受：' + ((r && r.reason) || '无主进程') + '（已记录在本机）'));
      if(box) box.textContent = txt;
      toast(r && r.ok ? (r.restart ? '网络族设置已保存，重启应用后生效' : '网络设置已保存') : '已保存到本机（主进程未接受）');
      render();
    }).catch(function(e){ toast('保存失败：' + String((e && e.message) || e)); });
  }
  else if(act === 'au-save'){
    /* 1.7.95 自动升级策略（P1-07）：四档只写主进程状态，界面读回后重绘 */
    if(!window.khAutoUpdate || typeof window.khAutoUpdate.setMode !== 'function'){ toast('当前环境不支持自动升级'); return; }
    var auMode = String((document.getElementById('auMode') || {}).value || 'download');
    window.khAutoUpdate.setMode({ mode: auMode }).then(function(r){
      toast(r && r.ok ? ('升级策略已保存：' + auMode) : ('保存失败：' + ((r && r.reason) || '未知')));
      return khAuRefresh();
    }).then(function(){ render(); }).catch(function(e){ toast('保存失败：' + String((e && e.message) || e)); });
  }
  else if(act === 'au-run'){
    if(!window.khAutoUpdate || typeof window.khAutoUpdate.run !== 'function'){ toast('当前环境不支持自动升级'); return; }
    var abox = document.getElementById('auOut');
    if(abox) abox.textContent = '正在检查云端清单…';
    window.khAutoUpdate.run().then(function(r){
      var txt;
      if(r && r.ok && r.plan){
        var pl = r.plan;
        if(pl.action === 'uptodate') txt = '已是最新 v' + (pl.current || '');
        else if(pl.action === 'notice') txt = '发现新版 v' + pl.remote + '（策略为「只检查」，没有下载）';
        else if(pl.action === 'download') txt = '新版 v' + pl.remote + ' 已下载并通过 SHA256 校验，重启应用后手动安装';
        else if(pl.action === 'install') txt = '新版 v' + pl.remote + ' 已下载并通过 SHA256 校验';
        else txt = '未动作：' + (pl.reason || pl.action);
      } else if(r && r.ready){ txt = '新版已下载并校验通过 v' + ((r.plan && r.plan.remote) || ''); }
      else txt = '检查失败：' + ((r && r.reason) || '未知原因');
      if(abox) abox.textContent = txt;
      toast(txt);
      return khAuRefresh();
    }).then(function(){ render(); }).catch(function(e){ toast('检查失败：' + String((e && e.message) || e)); });
  }
  else if(act === 'tv-save'){
    /* 1.7.95 电视形态开关（P0-03）：只写 kh_tv 并立刻 apply，不重启 */
    if(!window.KHTV){ toast('当前环境没有电视层'); return; }
    var tvMode = String((document.getElementById('tvMode') || {}).value || 'auto');
    var tvOn = window.KHTV.setMode(tvMode);
    toast(tvOn ? '已切到电视形态' : '已切到桌面形态');
    render();
  }
  else if(act === 'acct-auto-save'){
    /* 1.7.95 自动同步开关（P1-02） */
    var acAuto = String((document.getElementById('acctAuto') || {}).value || '1');
    setStore('kh_acct_auto', acAuto === '0' ? 0 : 1);
    toast(acAuto === '0' ? '自动同步已关闭' : '自动同步已开启');
    render();
  }
  else if(act === 'acct-sync' || act === 'acct-pull' || act === 'acct-save'){
    /* 1.7.95 设备码账号（P1-01/02/03）：注册 / 同步 / 拉回 / 换码，结果写回 #acctOut */
    if(!window.KHACCT){ toast('当前环境没有账号模块'); return; }
    var acNick = String((document.getElementById('acctNick') || {}).value || '');
    var acCodeIn = String((document.getElementById('acctCodeIn') || {}).value || '');
    window.KHACCT.setNick(acNick);
    function acDone(txt){
      toast(txt);
      try{ render(); }catch(e0){}
      var b2 = document.getElementById('acctOut');
      if(b2) b2.textContent = txt;
    }
    var acTask;
    if(act === 'acct-pull'){
      acTask = window.KHACCT.pull(window.KHACCT.hub()).then(function(m){
        acDone('已从云拉回：收藏 ' + m.counts.fav + ' · 历史 ' + m.counts.hist + ' · 续播 ' + m.counts.prog);
      });
    } else if(act === 'acct-sync'){
      acTask = window.KHACCT.sync(window.KHACCT.hub()).then(function(r){
        acDone('已同步到云（rev ' + r.rev + '，设备码 ' + r.code + '）');
      });
    } else if(acCodeIn){
      acTask = window.KHACCT.adopt(acCodeIn, window.KHACCT.hub()).then(function(r){
        acDone('已切换到设备码 ' + r.code + '，两边数据已合并（rev ' + r.rev + '）');
      });
    } else {
      acTask = window.KHACCT.register(window.KHACCT.hub())
        .then(function(){ return window.KHACCT.sync(window.KHACCT.hub()); })
        .then(function(r){ acDone('已注册设备码 ' + r.code + ' 并同步（rev ' + r.rev + '）'); });
    }
    acTask.catch(function(e){ acDone('失败：' + String((e && e.message) || e)); });
  }
  else if(act === 'b8-pip'){
    if(!window.khB8 || typeof window.khB8.win !== 'function'){ toast('当前环境不支持画中画'); return; }
    window.khB8.win({ pip: true }).then(function(r){
      toast(r && r.ok ? '已切到画中画小窗（480×270，常在最前）' : ('画中画失败：' + ((r && r.reason) || '未知')));
    }).catch(function(e){ toast('画中画失败：' + String(e && e.message || e)); });
  }
  else if(act === 'b8-audit'){
    var ad = khConfigAudit();
    var box = document.getElementById('b8AuditOut');
    var htm = '<b>体检 ' + ad.score + ' 分</b> · ' + (ad.ok ? '没有发现问题' : (ad.items.length + ' 项待处理'));
    if(ad.items.length){
      htm += '<br>' + ad.items.map(function(x){
        var tag = x.level === 'err' ? '❌' : (x.level === 'warn' ? '⚠' : '·');
        return tag + ' ' + esc(x.text) + (x.fix ? '（可一键修复）' : '');
      }).join('<br>');
    }
    if(box) box.innerHTML = htm;
    toast('配置体检：' + ad.score + ' 分');
  }
  else if(act === 'b8-fix'){
    var fixed = [];
    try{
      var dmRaw = localStorage.getItem('kh_store_damaged');
      var dmArr = dmRaw ? JSON.parse(dmRaw) : [];
      if(Array.isArray(dmArr) && dmArr.length){ setStore('kh_store_damaged', []); fixed.push('清损坏名单 ' + dmArr.length + ' 条'); }
    }catch(e1){}
    try{
      var h9 = strArray('kh_hist');
      if(h9.length > khPref().histCap){ setStore('kh_hist', khTrimHist(h9)); fixed.push('历史裁剪'); }
    }catch(e2){}
    try{
      var need = { kh_hist: [], kh_fav: [], kh_prog: {}, kh_theme: 'dark', kh_font_scale: 1 };
      var n2 = 0;
      for(var kk in need){ if(localStorage.getItem(kk) === null){ setStore(kk, need[kk]); n2++; } }
      if(n2) fixed.push('补默认键 ' + n2 + ' 个');
    }catch(e3){}
    khPrefApply();
    toast(fixed.length ? ('已修复：' + fixed.join(' · ')) : '没有需要修复的项');
    resAction('b8-audit', node);
  }
  else if(act === 'p2-dir-pick'){
    if(window.khBackupFile && typeof window.khBackupFile.pickDir === 'function'){
      window.khBackupFile.pickDir().then(function(r){
        if(r && r.ok && r.dir){
          var c1 = khP2Cfg();
          var dirs1 = (c1.localDirs || []).slice();
          var np = window.KHP2 ? KHP2.normPath(r.dir) : r.dir;
          var dup = false;
          for(var di = 0; di < dirs1.length; di++){
            var same = window.KHP2 ? KHP2.normPath(dirs1[di]).toLowerCase() === np.toLowerCase() : dirs1[di] === np;
            if(same){ dup = true; break; }
          }
          if(dup){ toast('这个目录已经授权过了'); return; }
          dirs1.push(np);
          khP2CfgSave({ localDirs: dirs1 });
          toast('已授权本地目录：' + np);
          render();
        } else if(r && r.canceled){ toast('已取消选择'); }
        else { toast('选目录失败：' + ((r && r.reason) || '未知原因')); }
      });
    } else {
      toast('当前环境不支持选目录（仅桌面 Electron 版；设备端 / 网页版无法授权本地目录）');
    }
  }
  else if(act === 'p2-dir-del'){
    var di2 = parseInt(node && node.getAttribute ? node.getAttribute('data-i') : '-1', 10);
    var c2 = khP2Cfg();
    var dirs2 = (c2.localDirs || []).slice();
    if(!isNaN(di2) && di2 >= 0 && di2 < dirs2.length){
      var gone = dirs2.splice(di2, 1)[0];
      khP2CfgSave({ localDirs: dirs2 });
      toast('已撤销授权：' + gone);
      render();
    }
  }
  else if(act === 'p2-dmg-clear'){
    setStore('kh_store_damaged', []);
    toast('损坏记录已清空');
    render();
  }
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
  if(window.KH_STORE) return;   /* 商店版用专属隐私闸（khStorePrivacyGate），避免双重弹窗与内置片源措辞 */
  try{ if(getStore('kh_consent', null)) return; }catch(e){ return; }
  var ov = document.createElement('div');
  ov.id = 'khConsentOverlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(4,9,18,.94);display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto';
  ov.innerHTML =
    '<div style="max-width:600px;width:100%;background:#0E1B2B;border:1px solid #24405F;border-radius:14px;padding:22px 24px;color:#E8F1FF;font-size:14px;line-height:1.7">' +
    '<h2 style="margin:0 0 10px;font-size:18px">欢迎使用鸿汇影 · 首次运行声明</h2>' +
    '<p style="margin:0 0 10px">继续使用前，请阅读并同意以下条款（完整文本在「关于」页可随时查看）：</p>' +
    '<details style="margin:6px 0"><summary style="cursor:pointer;font-weight:700">隐私政策（摘要）</summary>' +
    '<p style="margin:6px 0;color:#9aa6bd">收藏、历史、自建站点与设置仅保存在本机；播放统计只上报资源 ID 与成功/失败结果，不含个人信息、不含观看内容、不含 IP。问题与崩溃记录默认也只存本机，外发必须在设置页显式开启，并受每日条数上限约束。可在设置页一键清空本机数据。</p></details>' +
    '<details style="margin:6px 0"><summary style="cursor:pointer;font-weight:700">用户协议（摘要）</summary>' +
    '<p style="margin:6px 0;color:#9aa6bd">本应用是播放与导航工具：内置片源为公开授权样本，平台入口跳转各平台官方页面。你添加的片源与站点须自有版权或已获授权，责任由添加者承担。</p></details>' +
    '<details style="margin:6px 0"><summary style="cursor:pointer;font-weight:700">免责声明（摘要）</summary>' +
    '<p style="margin:6px 0;color:#9aa6bd">第三方线路与平台的可用性、内容合法性由其运营方负责；本应用不聚合、不缓存、不破解任何第三方片源，不对第三方内容作担保。</p></details>' +
    '<details style="margin:6px 0"><summary style="cursor:pointer;font-weight:700">侵权投诉与下线</summary>' +
    '<p style="margin:6px 0;color:#9aa6bd" id="khConsentAbuse">' + khAbuseLine() + '</p></details>' +
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
  inp.type = 'file'; inp.accept = '.json,.khbak,application/json';
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
  'kh_proxy', 'kh_hub_url', 'kh_issue_cfg_v1', 'kh_issue_remote_v1',
  /* 1.7.105 补：设备端（HAP 变体）读的是 khHub 这个键，漏了换机/换网后中枢地址还得手动重填 */
  'khHub',
  /* 1.7.89 补：性能/无障碍/安全三面板（#161）全部落在 kh_p2 一个键上，漏了换机就全回默认 */
  'kh_p2',
  /* 1.7.90 补：偏好与行为面板（#27 #28 #29 #43 #50 #51）七个键 + 仓站点治理（#56 #57），换机必须跟着走 */
  'kh_hist_cap', 'kh_hist_days', 'kh_resume', 'kh_autonext', 'kh_open_mode', 'kh_search_scope',
  'kh_wh_join', 'kh_wh_hide', 'kh_wh_pin',
  /* 1.7.90 补：平台入口显隐与置顶（#26）+ 直播切源阈值（#33） */
  'kh_plat_pref', 'kh_stall_limit', 'kh_watchdog_ms',
  /* 1.7.91 补：高级与本地能力（#30 #31 #40 #48 #52 #53）—— 音轨/字幕/通知/置顶/儿童/快捷键/外部播放器，换机跟着走 */
  'kh_audio_lang', 'kh_sub_auto', 'kh_sub_dir', 'kh_notify', 'kh_top', 'kh_kid', 'kh_kid_pin',
  'kh_hotkeys', 'kh_player_exe', 'kh_player_args', 'kh_notify_sound', 'kh_kid_min',
  /* 1.7.93 补：关闭窗口行为（#54）+ 字幕上下位置（#32，落在 kh_p2.subPos 里，随 kh_p2 一起走） */
  'kh_close_act',
  /* 1.7.97 补：按片倍速、片头秒数、本地短评 —— 都是用户自己攒的数据，换机必须跟着走
     （CSP 违规日志 kh_csp_log 刻意不进备份：它只描述这台机器的运行状况，换机没意义） */
  'kh_rate_map', 'kh_intro_map', 'kh_rev'
];
function khBakSettings(){
  var out = {};
  for(var i = 0; i < KH_BAK_SETTINGS.length; i++){
    var k = KH_BAK_SETTINGS[i], v = getStore(k, null);
    if(v !== null && v !== undefined) out[k] = v;
  }
  return out;
}
/* ---------------- 备份与恢复（1.7.88 · 台账 #160） ----------------
   这一版把备份从「点一下导出一个 json」扩成四件事：
     1) 加密包导出（PBKDF2-SHA256 20 万次 + AES-256-GCM，密码不落盘、只在本机内存里过一遍）
     2) 自动备份（每次启动 / 每天 / 每周，落到指定目录，保留最近 N 份）
     3) 配置快照与回滚（导出 / 导入 / 重置前自动留点，最多 5 版）
     4) 导入前差异预览（本机多少、备份多少、会新增多少、会重复多少）
   纯逻辑都在 app/kh-backup.js，这里只负责取数据、弹窗与落盘。 */
var KH_SNAP_KEY = 'kh_snapshots';
var KH_SNAP_MAX = 5;
var KH_SNAP_MAX_BYTES = 120 * 1024;   /* 单条快照上限：超了就不存，提示改走自动备份文件 */
var KH_BAK_AUTO_KEY = 'kh_backup_auto';
var KH_BAK_LAST_KEY = 'kh_backup_last';
var KH_BAK_AUTO_SESSION = false;      /* 同一次会话只跑一次自动备份 */

function khBakVersion(){
  try{ return String(KH_APP_CODE || ''); }catch(e){ return ''; }
}

function khCollectUserData(){
  return {
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
}
function khBakSummary(data){
  var nWh = 0;
  try { nWh = ((data.warehouses && data.warehouses.list) || []).length; } catch(e) {}
  var nWs = 0, nLv = 0, nPs = 0;
  try { Object.keys(data.warehouseSites || {}).forEach(function(k){ nWs += ((data.warehouseSites[k] || []).length); }); } catch(e) {}
  try { Object.keys(data.warehouseLives || {}).forEach(function(k){ nLv += ((data.warehouseLives[k] || []).length); }); } catch(e) {}
  try { Object.keys(data.warehouseParses || {}).forEach(function(k){ nPs += ((data.warehouseParses[k] || []).length); }); } catch(e) {}
  return '收藏 ' + (data.fav || []).length + ' / 稍后看 ' + (data.watchlater || []).length +
    ' / 历史 ' + (data.history || []).length + ' / 进度 ' + Object.keys(data.progress || {}).length +
    ' · 自建站点 ' + (data.sites || []).length +
    ' · 影视仓 ' + nWh + '（站点 ' + nWs + ' · 直播源 ' + nLv + ' · 解析 ' + nPs + '）' +
    ' · 自建直播 ' + (data.live || []).length + ' / 直播收藏 ' + (data.livefav || []).length +
    ' · 场景 ' + (data.scene ? '1' : '0') + ' · 设置 ' + Object.keys(data.settings || {}).length;
}
function khBakFileName(enc, auto){
  var ts = (window.KHBak ? KHBak.stamp() : new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'));
  return (auto ? '自动备份 ' : '鸿汇影备份 ') + ts + (enc ? '.khbak' : '.json');
}
/* 明文导出（老入口）：khExportUserData() 不带参数就是它 */
/* 加密导出：khExportUserData({encrypt:true, pass:'...'}) */
/* 自动备份：khExportUserData({auto:true, dir:'...', keep:3})，返回 Promise<{ok,path?,reason?}> */
function khExportUserData(opt){
  opt = opt || {};
  var data = khCollectUserData();
  var enc = !!opt.encrypt;
  var auto = !!opt.auto;
  /* 非自动备份（用户手点）：导出前先留点，方便导出后发现数据丢了也能回滚 */
  if(!auto){ try{ khSnapPush('export'); }catch(e){} }

  function finish(text, name){
    if(auto){
      /* 自动备份：只走「真写盘」的路径，网页预览环境不具备条件就静默跳过 */
      if(window.khBackupFile && typeof window.khBackupFile.save === 'function'){
        return window.khBackupFile.save({ text: text, name: name, dir: opt.dir || '', keep: Number(opt.keep) || 0, keepPrefix: '自动备份' })
          .then(function(r){
            if(r && r.ok){ try{ setStore(KH_BAK_LAST_KEY, new Date().toISOString()); }catch(e){} }
            return r || { ok: false, reason: '主进程未返回结果' };
          });
      }
      if(khIsDeviceWeb() && window.khFile && typeof window.khFile.saveText === 'function'){
        return window.khFile.saveText(name, text).then(function(r){
          if(r && r.ok){ try{ setStore(KH_BAK_LAST_KEY, new Date().toISOString()); }catch(e){} }
          return r || { ok: false, reason: '未返回结果' };
        }).catch(function(e){ return { ok: false, reason: String((e && e.message) || e) }; });
      }
      return Promise.resolve({ ok: false, reason: '当前环境没有写盘能力，自动备份已跳过' });
    }
    if(khIsDeviceWeb()){
      /* 第十一轮：设备端有原生文件桥时先选路径真正落盘（备份 JSON 常见上百 KB，
         剪贴板方案容易粘不全）；保存失败或被取消再退回剪贴板面板。 */
      if(window.khFile && typeof window.khFile.saveText === 'function'){
        window.khFile.saveText(name, text).then(function(r){
          if(r && r.ok){ toast('已保存备份文件：' + (r.path || name)); return; }
          if(r && r.reason === '已取消') return;
          toast('保存文件失败，改为复制到剪贴板：' + ((r && r.reason) || '未知原因'));
          khExportFallback(text);
        }).catch(function(){ khExportFallback(text); });
        return;
      }
      khExportFallback(text); return;
    }
    /* 桌面：优先用主进程写盘（落在文档 · 鸿汇影·备份，避免下载目录里堆一堆同名文件） */
    if(window.khBackupFile && typeof window.khBackupFile.save === 'function'){
      window.khBackupFile.save({ text: text, name: name, dir: opt.dir || '' }).then(function(r){
        if(r && r.ok){ toast('已导出：' + khBakSummary(data) + '\n文件：' + (r.path || name)); return; }
        toast('写盘失败（' + ((r && r.reason) || '未知原因') + '），改用下载方式');
        khBakBrowserDownload(text, name);
      }).catch(function(){ khBakBrowserDownload(text, name); });
      return;
    }
    khBakBrowserDownload(text, name);
  }

  if(enc){
    if(!window.KHBak) { toast('加密模块未加载，无法加密导出'); return; }
    if(!opt.pass) { toast('未提供密码'); return; }
    toast('正在加密打包…');
    window.KHBak.encrypt(data, String(opt.pass), { version: khBakVersion() }).then(function(env){
      var text = JSON.stringify(env, null, 2);
      finish(text, khBakFileName(true, auto));
      if(!auto) toast('已导出加密备份（' + window.KHBak.fmtBytes(text.length) + '）：' + khBakSummary(data) + '\n密码不保存在文件里，请自己记住。');
    }).catch(function(e){
      toast('加密导出失败：' + ((e && e.message) || e));
    });
    return;
  }
  var pack = window.KHBak ? window.KHBak.pack(data, { version: khBakVersion() }) : data;
  var text = JSON.stringify(pack, null, 2);
  finish(text, khBakFileName(false, auto));
  if(!auto) toast('已导出：' + khBakSummary(data));
}
function khBakBrowserDownload(text, name){
  var blob = new Blob([text], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 3000);
}

/* ---------------- 配置快照与回滚（保留 5 版） ----------------
   快照存 localStorage，所以有体积上限：单条超过 120KB 就不存（大库用户改走自动备份文件），
   localStorage 满（QuotaExceeded）时丢最旧一条再试，绝不因为「留点」把主流程搞挂。 */
function khSnapList(){
  try{
    var v = getStore(KH_SNAP_KEY, []);
    return Array.isArray(v) ? v : [];
  }catch(e){ return []; }
}
function khSnapSave(list){
  try{ setStore(KH_SNAP_KEY, list); return true; }
  catch(e){
    /* 存储满：从最旧往后丢，直到写进去或只剩 1 条 */
    var l = Array.isArray(list) ? list.slice() : [];
    while(l.length > 1){
      l.shift();
      try{ setStore(KH_SNAP_KEY, l); return true; }catch(e2){}
    }
    return false;
  }
}
function khSnapPush(reason){
  try{
    var data = khCollectUserData();
    var text = JSON.stringify(data);
    if(text.length > KH_SNAP_MAX_BYTES) return false;
    var entry = {
      at: new Date().toISOString(),
      reason: String(reason || 'manual'),
      version: khBakVersion(),
      bytes: text.length,
      data: data
    };
    var list = khSnapList();
    var out = window.KHBak ? KHBak.snapPush(list, entry, KH_SNAP_MAX) : list.concat([entry]).slice(-KH_SNAP_MAX);
    return khSnapSave(out);
  }catch(e){ return false; }
}
function khSnapRestore(idx){
  var list = khSnapList();
  var it = list[idx];
  if(!it || !it.data){ toast('快照不存在'); return; }
  khApplyUserData(it.data, 'overwrite');
  toast('已回滚到 ' + String(it.at || '').slice(0, 19).replace('T', ' ') + ' 的快照（' + (it.reason === 'import' ? '导入前' : it.reason === 'reset' ? '重置前' : '导出前') + '）');
}
function khSnapReasonName(r){
  return r === 'import' ? '导入前' : (r === 'reset' ? '重置前' : (r === 'auto' ? '自动备份前' : '导出前'));
}

/* ---------------- 自动备份（周期 / 目录 / 保留份数） ---------------- */
var KH_BAK_AUTO_DEF = { on: true, every: 'daily', dir: '', keep: 3 };
function khBakAutoCfg(){
  var raw = null;
  try{ raw = getStore(KH_BAK_AUTO_KEY, null); }catch(e){}
  var cfg = {};
  for(var k in KH_BAK_AUTO_DEF){ cfg[k] = KH_BAK_AUTO_DEF[k]; }
  if(raw && typeof raw === 'object'){
    if(raw.on !== undefined) cfg.on = !!raw.on;
    if(raw.every) cfg.every = raw.every === 'weekly' || raw.every === 'launch' ? raw.every : 'daily';
    if(typeof raw.dir === 'string') cfg.dir = raw.dir;
    if(raw.keep) cfg.keep = Math.max(1, Math.min(10, Number(raw.keep) || 3));
  }
  return cfg;
}
function khBakAutoSaveCfg(patch){
  var cfg = khBakAutoCfg();
  if(patch && typeof patch === 'object'){
    for(var k in patch){ if(k in KH_BAK_AUTO_DEF) cfg[k] = patch[k]; }
  }
  setStore(KH_BAK_AUTO_KEY, cfg);
  return cfg;
}
function khBakAutoLast(){
  try{ return String(getStore(KH_BAK_LAST_KEY, '') || ''); }catch(e){ return ''; }
}
/* 启动后调用一次：到期就静默导出到备份目录，失败只落一条本机提示，不打断使用 */
function khBakAutoTick(){
  if(KH_BAK_AUTO_SESSION) return;
  KH_BAK_AUTO_SESSION = true;
  try{
    var cfg = khBakAutoCfg();
    if(!cfg.on) return;
    if(!window.KHBak) return;
    if(!window.KHBak.autoDue(cfg, khBakAutoLast(), Date.now())) return;
    khExportUserData({ auto: true, dir: cfg.dir, keep: cfg.keep });
  }catch(e){ /* 自动备份失败不影响主流程 */ }
}

/* 密码浮层：加密导出 / 解密导入共用。cb(pass) 返回 false 表示不关窗（校验失败重输） */
function khBakPromptPass(title, hint, okText, cb){
  var old = document.getElementById('khBakPass');
  if(old) old.remove();
  var wrap = document.createElement('div');
  wrap.id = 'khBakPass';
  wrap.className = 'kh-ask-mask';
  wrap.innerHTML =
    '<div class="kh-ask" role="dialog" aria-modal="true" aria-labelledby="khBakPassTitle">' +
      '<h3 id="khBakPassTitle">' + esc(title) + '</h3>' +
      '<p class="kh-ask-sub">' + esc(hint) + '</p>' +
      '<input id="khBakPassInput" class="u" type="password" autocomplete="new-password" style="width:100%;margin:6px 0 10px" aria-label="备份密码">' +
      '<button type="button" class="kh-ask-btn" id="khBakPassOk"><b>' + esc(okText || '确定') + '</b><span>密码只在本机内存里用一次，不会写进备份文件</span></button>' +
      '<button type="button" class="kh-ask-btn kh-ask-cancel" id="khBakPassCancel">取消</button>' +
    '</div>';
  document.body.appendChild(wrap);
  var inp = wrap.querySelector('#khBakPassInput');
  function close(){ if(wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap); }
  wrap.querySelector('#khBakPassCancel').onclick = close;
  function submit(){
    var p = String((inp && inp.value) || '');
    if(p.length < 6){ toast('密码至少 6 位'); try{ inp.focus(); }catch(e){} return; }
    close();
    cb(p);
  }
  wrap.querySelector('#khBakPassOk').onclick = submit;
  inp.addEventListener('keydown', function(ev){ if(ev.key === 'Enter') submit(); if(ev.key === 'Escape') close(); });
  setTimeout(function(){ try{ inp.focus(); }catch(e){} }, 30);
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
  /* 加密包（台账 #160）：先要密码，解开后按同一套流程走 */
  if(window.KHBak && window.KHBak.isEncrypted(data)){
    khBakPromptPass('备份已加密', '文件「' + (fname || '备份.khbak') + '」是加密备份包，输入导出时设置的密码。', '解锁并继续', function(pass){
      window.KHBak.decrypt(data, pass).then(function(plain){
        toast('密码正确，已解开加密备份');
        khAskImportMode(JSON.stringify(plain), fname, fsize);
      }).catch(function(e){
        toast('解密失败：' + ((e && e.message) || e));
      });
    });
    return;
  }
  var when = data.exportedAt ? String(data.exportedAt).slice(0, 19).replace(/T/, ' ') : '时间未知';
  /* 差异预览（台账 #160）：把「本机多少 / 备份多少 / 会新增多少 / 会重复多少」摊开给用户看 */
  var diff = window.KHBak ? window.KHBak.diff(data, khCollectUserData()) : null;
  var diffHtml = '';
  if(diff && diff.rows){
    var rows = diff.rows.filter(function(r){ return r.inc > 0 || r.cur > 0; }).map(function(r){
      return '<tr><td style="padding:2px 8px 2px 0">' + esc(r.label) + '</td>' +
        '<td style="padding:2px 8px;text-align:right;color:#96a1b8">' + r.cur + '</td>' +
        '<td style="padding:2px 8px;text-align:right;color:#96a1b8">' + r.inc + '</td>' +
        '<td style="padding:2px 8px;text-align:right;color:#7dd3a0">' + (r.add ? '+' + r.add : '—') + '</td>' +
        '<td style="padding:2px 0;text-align:right;color:#ffd98a">' + (r.same ? r.same : '—') + '</td></tr>';
    }).join('');
    diffHtml = '<table style="width:100%;font-size:11px;margin:4px 0 8px;border-collapse:collapse">' +
      '<thead><tr><th style="text-align:left;font-weight:600;padding-bottom:2px">项目</th>' +
      '<th style="text-align:right;font-weight:600">本机</th><th style="text-align:right;font-weight:600">备份</th>' +
      '<th style="text-align:right;font-weight:600">将新增</th><th style="text-align:right;font-weight:600">重复</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div style="font-size:11px;color:#96a1b8;margin-bottom:6px">合计：本机 ' + diff.totals.cur + ' 条 / 备份 ' + diff.totals.inc +
      ' 条，合并可新增 ' + diff.totals.add + ' 条，' + diff.totals.over + ' 条两边都有。</div>';
  }
  var old = document.getElementById('khImportAsk');
  if(old) old.remove();
  var wrap = document.createElement('div');
  wrap.id = 'khImportAsk';
  wrap.className = 'kh-ask-mask';
  wrap.innerHTML =
    '<div class="kh-ask" role="dialog" aria-modal="true" aria-labelledby="khAskTitle">' +
      '<h3 id="khAskTitle">导入备份：先看一眼差异，再选冲突策略</h3>' +
      '<p class="kh-ask-sub">文件「' + esc(fname || '备份.json') + '」· 导出于 ' + esc(when) + '</p>' +
      diffHtml +
      '<button type="button" class="kh-ask-btn" data-mode="merge"><b>合并（推荐）</b><span>两边取并集去重；同一部片的续播进度以备份为准</span></button>' +
      '<button type="button" class="kh-ask-btn" data-mode="skip"><b>只补缺</b><span>只导入本机没有的条目，本机已有进度保持不变</span></button>' +
      '<button type="button" class="kh-ask-btn" data-mode="overwrite"><b>覆盖</b><span>本机收藏 / 稍后看 / 历史 / 追剧 / 进度全部替换为备份内容</span></button>' +
      '<button type="button" class="kh-ask-btn kh-ask-cancel" data-mode="cancel">取消导入</button>' +
      '<p class="kh-ask-sub" style="margin-top:8px;font-size:11px">导入前会自动留一份当前配置快照（最多留 5 版），在「设置 · 备份与恢复」里可一键回滚。</p>' +
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
  /* 覆盖前留点：导入这种不可逆操作，先存一份当前状态（失败不阻断导入） */
  try{ khSnapPush('import'); }catch(e){}
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

