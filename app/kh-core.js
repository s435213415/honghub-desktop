/* HongHub 前端模块：本地存储/DOM 引用/通用 UI/视图渲染/能力开关
   由 app/index.html 单文件版拆分（1.7.72 模块化），按 <script> 顺序加载，顶层函数/常量共享全局作用域。 */
/* ---------------- 本地存储：带类型守卫，损坏数据自动自愈 ----------------
   1.7.89 配置存储硬化（台账 #161 / 清单 72）：设置类键（kh_ 前缀）写入时附一条封条
   （长度 + 双滚动校验和，见 app/kh-p2.js），读取时校验；被截断 / 手改 / 乱码即回退默认
   并把损坏记录写进 kh_store_damaged（最多 20 条），不抛异常、不静默丢全部设置。
   封条只是「发现损坏并回退」，不是加密也不是防对抗强度 —— 本机文件谁都能改，诚实标注。 */
var mem = {};
var BOOT_AT = Date.now();
var KH_SEAL_KEY = 'kh_store_seal';
function khSealOn(){
  /* 注意：这里必须绕过 getStore —— getStore 会校验封条，而 setStore 在「刚写完新值、
     封条还是旧值」的瞬间调本函数；走 getStore 会把刚写的数据判成损坏并删掉，
     表现为「设置点了保存但读回来还是空」。所以这里直接读原始值、不做校验。 */
  try {
    if (!window.KHP2) return false;
    var raw = null;
    try { raw = localStorage.getItem('kh_p2'); } catch (e0) { raw = null; }
    if (raw === null) {
      var mv = mem['kh_p2'];
      return !(mv && Number(mv.storeHarden) === 0);
    }
    var p = null;
    try { p = JSON.parse(raw); } catch (e1) { p = null; }
    return !(p && Number(p.storeHarden) === 0);
  } catch (e) { return false; }
}
function khSealMap(){
  try { var m = getStore(KH_SEAL_KEY, null); return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {}; }
  catch (e) { return {}; }
}
function khSealNote(key, reason){
  try {
    var list = getStore('kh_store_damaged', null);
    if (!Array.isArray(list)) list = [];
    list.unshift({ k: key, at: new Date().toISOString(), reason: String(reason || '') });
    setStore('kh_store_damaged', list.slice(0, 20));
  } catch (e) {}
}
function getStore(k, d){
  var raw;
  try{ raw = localStorage.getItem(k); }
  catch(e){ return mem[k] === undefined ? d : mem[k]; }  // localStorage 不可用：降级内存
  if(raw === null) return d;
  /* 设置类键先过封条：不符即视为损坏，回退默认（内存值优先，避免同一会话里读回坏数据） */
  if (k !== KH_SEAL_KEY && k.indexOf('kh_') === 0 && window.KHP2) {
    try {
      var seal = khSealMap()[k];
      if (seal) {
        var v = window.KHP2.verify(seal, raw);
        if (!v.ok) {
          try { localStorage.removeItem(k); } catch(e2){}
          var sm = khSealMap(); delete sm[k]; setStore(KH_SEAL_KEY, sm);
          khSealNote(k, v.reason);
          mem[k] = d;
          return d;
        }
      }
    } catch(e3){}
  }
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
  var raw = null;
  try{ raw = JSON.stringify(v); }catch(e0){}
  try{ if (raw !== null) localStorage.setItem(k, raw); else localStorage.removeItem(k); }catch(e){}
  /* 封条同步：只给设置类键写，且封条本身不封条（否则递归） */
  if (raw !== null && k !== KH_SEAL_KEY && k.indexOf('kh_') === 0 && khSealOn()) {
    try {
      var sm = khSealMap();
      sm[k] = window.KHP2.seal(raw);
      var smRaw = JSON.stringify(sm);
      localStorage.setItem(KH_SEAL_KEY, smRaw);
    } catch(e){}
  }
}
/* P2 配置读写：一处集中，设置页与生效逻辑都用它 */
function khP2Cfg(){
  var raw = null;
  try { raw = getStore('kh_p2', null); } catch(e){ raw = null; }
  if (window.KHP2) return window.KHP2.norm(raw);
  return Object.assign({}, raw || {});
}
function khP2CfgSave(patch){
  var next = Object.assign(khP2Cfg(), patch || {});
  if (window.KHP2) next = window.KHP2.norm(next);
  setStore('kh_p2', next);
  return next;
}
/* ---------------- 1.7.94 远端配置（#69 #70 #71 #77）与云同步（#66） ----------------
   一份远端视图（kh_remote）落在本机，断网也能用上次的结论：
     · 公告位：首页顶部横幅，关掉记 id（换 id 重新出现）
     · 锁定项：命中的控件只读并打 🔒，防误配
     · 远端默认值：只在「本机没设过」时补，本机覆盖优先
     · 灰度开关：服务端已求值，本机再按同一算法离线求值兜底
   推送/拉取只同步 kh_ 前缀的偏好，源地址 / 本机路径 / 凭证一律不过（两端各滤一遍）。 */
var KH_REMOTE_KEY = 'kh_remote';
var KH_REMOTE_SKIP = ['kh_remote', 'kh_store_seal', 'kh_store_damaged', 'kh_dev_id', 'kh_sync_meta', 'kh_remote_closed'];
var KH_LOCK_UI = {
  kh_audio_lang: 'prefAudio', kh_sub_auto: 'prefSubAuto', kh_sub_dir: 'prefSubDir',
  kh_notify: 'prefNotify', kh_notify_sound: 'prefNotifySound', kh_top: 'prefTop',
  kh_close_act: 'prefClose', kh_player_exe: 'prefPlayerExe', kh_player_args: 'prefPlayerArgs',
  kh_kid: 'prefKid', kh_kid_pin: 'prefKidPin', kh_kid_min: 'prefKidMin'
};
function khDeviceId(){
  var id = getStore('kh_dev_id', '');
  if (!id) {
    id = 'dev-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36).slice(-4);
    setStore('kh_dev_id', id);
  }
  return id;
}
function khRemoteView(){
  var raw = getStore(KH_REMOTE_KEY, null);
  if (window.KHREMOTE) return window.KHREMOTE.normView(raw);
  return { rev: 0, notice: null, locks: [], defaults: {}, flags: {}, sync: { enabled: true }, at: '', from: 'none' };
}
function khRemoteReq(path, opt){
  try { if (typeof khFetch === 'function') return khFetch(path, opt || { cache: 'no-store' }); } catch (e) {}
  return fetch(path, opt || { cache: 'no-store' });
}
function khRemoteApply(view){
  var res = { applied: [], skipped: [] };
  if (!view) view = khRemoteView();
  /* 远端默认值：本机没这个键才补；有值（含显式 0 / 空串）一律不动 */
  if (window.KHREMOTE && view.defaults) {
    var plan = window.KHREMOTE.defaultsPlan(view.defaults, function (k) {
      try { return localStorage.getItem(k) !== null; } catch (e) { return mem[k] !== undefined; }
    });
    plan.apply.forEach(function (it) {
      try { setStore(it.key, it.value); res.applied.push(it.key); } catch (e) {}
    });
    res.skipped = plan.skip;
  }
  setStore('kh_remote_locks', view.locks || []);
  res.locks = (view.locks || []).length;
  res.rev = view.rev;
  return res;
}
function khRemoteLoad(force){
  if (!window.KHREMOTE) return Promise.resolve(khRemoteView());
  var dev = khDeviceId();
  var ver = (typeof KH_APP_CODE !== 'undefined' && KH_APP_CODE) ? KH_APP_CODE : '';
  return window.KHREMOTE.load(window.KH_HUB || '', dev, ver, function (u, o) { return khRemoteReq(u, o); })
    .then(function (v) {
      var prev = khRemoteView();
      if (!force && prev.rev && v.rev && v.rev < prev.rev) return prev;   // 远端回滚不覆盖本机较新视图
      setStore(KH_REMOTE_KEY, v);
      khRemoteApply(v);
      khRemotePaint();
      khRemoteLockPaint();
      return v;
    });
}
function khRemoteFlags(){ return khRemoteView().flags || {}; }
function khRemoteFlag(id, dft){
  if (window.KHREMOTE) return window.KHREMOTE.flagOn(khRemoteFlags(), id, dft);
  var f = khRemoteFlags();
  return (id in f) ? !!f[id] : (dft === undefined ? true : !!dft);
}
function khRemoteClosed(){
  var l = getStore('kh_remote_closed', []);
  return Array.isArray(l) ? l : [];
}
function khRemoteNotice(){
  if (!window.KHREMOTE) return null;
  if (Number(getStore('kh_remote_notice', 1)) === 0) return null;
  return window.KHREMOTE.noticeShowable(khRemoteView(), khRemoteClosed(), new Date());
}
function khRemoteDismiss(id){
  var l = khRemoteClosed();
  if (l.indexOf(id) < 0) l.push(id);
  setStore('kh_remote_closed', l.slice(-50));
  khRemotePaint();
}
function khRemotePaint(){
  var main = document.getElementById('main');
  if (!main) return;
  var old = document.getElementById('khNoticeBar');
  var n = khRemoteNotice();
  if (!n || n.onboard === false || !n.title && !n.text) { if (old) old.parentNode.removeChild(old); return; }
  var color = n.level === 'warn' ? '#5B2323' : (n.level === 'event' ? '#4A3A12' : '#17324F');
  var edge = n.level === 'warn' ? '#8A3B3B' : (n.level === 'event' ? '#8A6A1E' : '#2A4E77');
  var box = old;
  if (!box) {
    box = document.createElement('div');
    box.id = 'khNoticeBar';
    box.setAttribute('role', 'status');
    main.parentNode.insertBefore(box, main);
  }
  var linkBtn = n.link
    ? '<button class="mini" data-act="r-notice-link" data-link="' + esc(n.link) + '" title="复制公告里的链接">🔗 链接</button>'
    : '';
  box.style.cssText = 'margin:10px 14px 0;padding:10px 14px;border-radius:10px;background:' + color +
    ';border:1px solid ' + edge + ';display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px';
  box.innerHTML = '<b style="color:#FFD166;white-space:nowrap">📢 ' + esc(n.title || '公告') + '</b>' +
    '<span style="flex:1 1 240px;min-width:0;color:#E6EEF9">' + esc(n.text) + '</span>' + linkBtn +
    '<button class="mini" data-act="r-notice-off" data-nid="' + esc(n.id) + '" aria-label="关闭这条公告">×</button>';
}
function khRemoteLockIds(){
  var l = getStore('kh_remote_locks', []);
  return Array.isArray(l) ? l : [];
}
function khRemoteLockPaint(){
  var locks = khRemoteLockIds();
  var ui = [];
  locks.forEach(function (k) {
    if (k === 'kh_hotkeys') ui = ui.concat(['prefHkToggle', 'prefHkNext', 'prefHkPrev', 'prefHkMute', 'prefHkTop']);
    else if (KH_LOCK_UI[k]) ui.push(KH_LOCK_UI[k]);
    else if (k.indexOf('kh_p2') === 0) ui = ui.concat(['p2SubPos', 'p2SubSize', 'p2SubStroke', 'p2SubFont', 'khSubPosSel']);
  });
  ui.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.disabled = true;
    try { el.setAttribute('aria-disabled', 'true'); } catch (e) {}
    el.title = '🔒 该项已被管理中心锁定，客户端不可改';
  });
}
/* #72 存储载体：一处出「载体 / 封条 / 损坏 / 字节数」的真实情况，诊断与设置页共用 */
function khStoreCarrierInfo(){
  var info = { carrier: 'localStorage', keys: 0, bytes: 0, sealed: 0, damaged: 0, usable: true, note: '非加密强度：封条只防手改与半截写入' };
  try {
    var n = 0, b = 0;
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('kh_') === 0) { n++; b += (localStorage.getItem(k) || '').length; }
    }
    info.keys = n; info.bytes = b;
    info.sealed = Object.keys(khSealMap()).length;
    var dmg = getStore('kh_store_damaged', []);
    info.damaged = Array.isArray(dmg) ? dmg.length : 0;
    info.harden = khSealOn();
  } catch (e) { info.usable = false; }
  return info;
}
/* 1.7.95 自动升级状态缓存（P1-07/08）：面板只读 getStore('kh_au_view')，
   这里从主进程拉一次真状态落盘，避免每次重绘都跨进程调一次 */
function khAuRefresh(){
  if(!window.khAutoUpdate || typeof window.khAutoUpdate.get !== 'function') return Promise.resolve(null);
  return window.khAutoUpdate.get().then(function(r){
    if(r && r.ok){
      setStore('kh_au_view', { current: r.current || '', state: r.state || {}, at: new Date().toISOString() });
    }
    return r;
  }).catch(function(){ return null; });
}
/* #66 云同步：收集本机 kh_ 偏好 → 过滤 → 推；拉回来逐键覆盖本机（源地址/凭证已被两端滤掉） */
function khSyncPayload(){
  var out = {};
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k.indexOf('kh_') !== 0 || KH_REMOTE_SKIP.indexOf(k) >= 0) continue;
      var v = getStore(k, null);
      if (v === null) continue;
      out[k] = v;
    }
  } catch (e) {}
  return window.KHREMOTE ? window.KHREMOTE.syncFilter(out) : out;
}
function khSyncPush(){
  if (!window.KHREMOTE) return Promise.reject(new Error('远端模块未加载'));
  if (Number(getStore('kh_sync_on', 1)) === 0) return Promise.reject(new Error('云同步开关已关'));
  var p = khSyncPayload();
  return window.KHREMOTE.push(window.KH_HUB || '', khDeviceId(), p, function (u, o) { return khRemoteReq(u, o); })
    .then(function (r) {
      setStore('kh_sync_meta', { at: new Date().toISOString(), dir: 'push', keys: (r && r.keys) || 0, ok: !!(r && r.ok) });
      return r;
    });
}
function khSyncPull(){
  if (!window.KHREMOTE) return Promise.reject(new Error('远端模块未加载'));
  if (Number(getStore('kh_sync_on', 1)) === 0) return Promise.reject(new Error('云同步开关已关'));
  return window.KHREMOTE.pull(window.KH_HUB || '', khDeviceId(), function (u, o) { return khRemoteReq(u, o); })
    .then(function (r) {
      var n = 0;
      if (r && r.ok && r.payload && typeof r.payload === 'object') {
        Object.keys(r.payload).forEach(function (k) {
          if (KH_REMOTE_SKIP.indexOf(k) >= 0) return;
          try { setStore(k, r.payload[k]); n++; } catch (e) {}
        });
      }
      setStore('kh_sync_meta', { at: new Date().toISOString(), dir: 'pull', keys: n, ok: !!(r && r.ok), from: (r && r.from) || '' });
      return { ok: !!(r && r.ok), applied: n, from: (r && r.from) || '', empty: !!(r && r.empty) };
    });
}
/* ---- 1.7.94 统一配置中心（清单 #63）：38 个用户可配置项集中成一张表，一处搜索、单组重置 ----
   这些键原本散在设置页五个面板里，值域与默认值都以注册表为准；这里只做「读当前值 / 改一个键 /
   把一组键恢复默认」，不改动各面板自身逻辑，避免两套口径打架。 */
var KH_CFG_REG = [
  { g: '播放', k: 'kh_quality', n: '画质', t: 'text', d: 'auto', h: 'auto / 1080 / 720 / 480' },
  { g: '播放', k: 'kh_fit', n: '画面比例', t: 'text', d: 'contain', h: 'contain / cover / fill' },
  { g: '播放', k: 'kh_rate', n: '默认倍速', t: 'num', d: 1, min: 0.5, max: 3 },
  { g: '播放', k: 'kh_vol', n: '默认音量', t: 'num', d: 1, min: 0, max: 1 },
  { g: '播放', k: 'kh_mute', n: '启动静音', t: 'bool', d: 0 },
  { g: '播放', k: 'kh_loudness_eq', n: '响度均衡', t: 'bool', d: 0 },
  { g: '播放', k: 'kh_resume', n: '续播策略', t: 'text', d: 'ask', h: 'ask / always / never' },
  { g: '播放', k: 'kh_autonext', n: '自动下一部', t: 'bool', d: 0 },
  { g: '播放', k: 'kh_audio_lang', n: '首选音轨', t: 'text', d: 'auto', h: 'auto / zh / en / ja / ko' },
  { g: '播放', k: 'kh_sub_auto', n: '自动挂字幕', t: 'bool', d: 1 },
  { g: '播放', k: 'kh_sub_dir', n: '字幕目录', t: 'text', d: '', max: 260 },
  { g: '界面', k: 'kh_theme', n: '内置皮肤', t: 'text', d: 'dark', h: 'dark / light / ocean / forest / violet / mono / sand / rose / slate' },
  { g: '界面', k: 'kh_font_scale', n: '界面字号(%)', t: 'num', d: 100, min: 80, max: 160 },
  { g: '界面', k: 'kh_lang', n: '界面语言', t: 'text', d: 'zh', h: 'zh / en' },
  { g: '界面', k: 'kh_senior', n: '长辈模式', t: 'bool', d: 0 },
  { g: '界面', k: 'kh_night', n: '夜间护眼', t: 'bool', d: 0 },
  { g: '界面', k: 'kh_motion', n: '界面动效', t: 'bool', d: 1 },
  { g: '界面', k: 'kh_brightness', n: '画面亮度', t: 'num', d: 1, min: 0.3, max: 1.5 },
  { g: '界面', k: 'kh_compat_mode', n: '兼容模式', t: 'text', d: '', h: '留空自动 / 填 低配 可降低重绘' },
  { g: '界面', k: 'kh_scene', n: '场景预设', t: 'text', d: '', h: '留空默认 / tv / phone / projector' },
  { g: '界面', k: 'kh_open_mode', n: '打开方式', t: 'text', d: 'play', h: 'play / site' },
  { g: '通知与启动', k: 'kh_notify', n: '系统通知', t: 'text', d: 'all', h: 'all / download / off' },
  { g: '通知与启动', k: 'kh_notify_sound', n: '通知提示音', t: 'bool', d: 1 },
  { g: '通知与启动', k: 'kh_top', n: '窗口置顶', t: 'bool', d: 0 },
  { g: '通知与启动', k: 'kh_close_act', n: '关窗口行为', t: 'text', d: 'tray', h: 'tray / min / quit' },
  { g: '通知与启动', k: 'kh_autostart', n: '开机自启', t: 'bool', d: 0 },
  { g: '通知与启动', k: 'kh_auto_update', n: '自动更新', t: 'bool', d: 1 },
  { g: '通知与启动', k: 'kh_silent_install', n: '静默安装', t: 'bool', d: 0 },
  { g: '儿童', k: 'kh_kid', n: '儿童模式', t: 'bool', d: 0 },
  { g: '儿童', k: 'kh_kid_pin', n: '家长 PIN', t: 'text', d: '', max: 4 },
  { g: '儿童', k: 'kh_kid_min', n: '时长上限(分)', t: 'num', d: 0, min: 0, max: 720 },
  { g: '网络', k: 'kh_hub_url', n: '中枢地址', t: 'text', d: '', max: 200 },
  { g: '网络', k: 'kh_search_scope', n: '搜索范围', t: 'text', d: 'builtin', h: 'builtin / all' },
  { g: '网络', k: 'kh_sleep_min', n: '自动休眠(分)', t: 'num', d: 0, min: 0, max: 240 },
  { g: '数据', k: 'kh_hist_cap', n: '历史上限(条)', t: 'num', d: 30, min: 5, max: 200 },
  { g: '数据', k: 'kh_hist_days', n: '历史保留(天)', t: 'num', d: 0, min: 0, max: 365 },
  { g: '远端与云端', k: 'kh_remote_notice', n: '公告横幅', t: 'bool', d: 1 },
  { g: '远端与云端', k: 'kh_sync_on', n: '云同步', t: 'bool', d: 1 }
];
function khCfgFind(k){
  for (var i = 0; i < KH_CFG_REG.length; i++) if (KH_CFG_REG[i].k === k) return KH_CFG_REG[i];
  return null;
}
function khCfgVal(row){
  var v = getStore(row.k, row.d);
  return v == null ? row.d : v;
}
function khCfgShow(row){
  var v = khCfgVal(row);
  if (row.t === 'bool') return Number(v) ? '1（开）' : '0（关）';
  return String(v);
}
function khCfgRows(q){
  var s = String(q || '').trim().toLowerCase();
  if (!s) return KH_CFG_REG.slice();
  return KH_CFG_REG.filter(function (r) {
    return r.n.toLowerCase().indexOf(s) >= 0 || r.k.indexOf(s) >= 0 || r.g.indexOf(s) >= 0;
  });
}
function khCfgGroups(rows){
  var g = [], seen = {};
  rows.forEach(function (r) { if (!seen[r.g]) { seen[r.g] = 1; g.push(r.g); } });
  return g;
}
/* 写一个键：按注册表类型转换，数字夹到 min/max，文本截断，布尔只认 1/0 */
function khCfgSave(k, raw){
  var row = khCfgFind(k);
  if (!row) throw new Error('未登记的配置键 ' + k);
  var v;
  if (row.t === 'bool') v = (String(raw) === '1' || raw === true) ? 1 : 0;
  else if (row.t === 'num') {
    v = Number(raw);
    if (!isFinite(v)) throw new Error('「' + row.n + '」需要一个数字');
    if (row.min != null && v < row.min) v = row.min;
    if (row.max != null && v > row.max) v = row.max;
  } else v = String(raw == null ? '' : raw).slice(0, row.max || 200);
  setStore(row.k, v);
  return v;
}
/* 整组恢复默认：写回默认值而不是删除键，保证封条与备份口径一致 */
function khCfgResetGroup(g){
  var n = 0;
  KH_CFG_REG.forEach(function (r) { if (r.g === g) { setStore(r.k, r.d); n++; } });
  return n;
}
function khCfgResetAll(){
  var n = 0;
  KH_CFG_REG.forEach(function (r) { setStore(r.k, r.d); n++; });
  return n;
}
/* ---- 1.7.94 皮肤包（清单 #78）：外部主题目录 / 远端下载 / 粘贴导入三路，应用只改调色板变量 ---- */
var KH_THEME_PACK_KEY = 'kh_theme_packs', KH_THEME_CUR_KEY = 'kh_theme_pack';
function khThemePacks(){
  var l = getStore(KH_THEME_PACK_KEY, null);
  if (!Array.isArray(l) || !l.length) {
    l = (window.KHTHEME ? window.KHTHEME.builtins() : []);
    try { setStore(KH_THEME_PACK_KEY, l); } catch (e) {}
  }
  return Array.isArray(l) ? l : [];
}
function khThemeSave(l){ setStore(KH_THEME_PACK_KEY, l); return l; }
function khThemeCur(){ return String(getStore(KH_THEME_CUR_KEY, '') || ''); }
function khThemeFind(id){ return window.KHTHEME ? window.KHTHEME.packFind(khThemePacks(), id) : null; }
/* 注入覆盖样式：只在 body 带 kh-pack 时生效；没有包就把样式与类一起撤掉 */
function khThemePaint(){
  var head = document.head || document.getElementsByTagName('head')[0];
  var st = document.getElementById('khThemePackStyle');
  var cur = khThemeCur();
  var pack = cur ? khThemeFind(cur) : null;
  if (!pack) {
    if (st && st.parentNode) st.parentNode.removeChild(st);
    document.body.classList.remove('kh-pack');
    return false;
  }
  var css = window.KHTHEME ? window.KHTHEME.packCss(pack) : '';
  if (!css) { if (st && st.parentNode) st.parentNode.removeChild(st); document.body.classList.remove('kh-pack'); return false; }
  if (!st) { st = document.createElement('style'); st.id = 'khThemePackStyle'; head.appendChild(st); }
  st.textContent = css;
  document.body.classList.add('kh-pack');
  return true;
}
function khThemeApply(id){
  var pack = id ? khThemeFind(id) : null;
  setStore(KH_THEME_CUR_KEY, pack ? pack.id : '');
  /* 皮肤包与内置皮肤互斥：装了包就把内置皮肤类撤掉，换回内置皮肤时再恢复 */
  if (pack) {
    ['kh-light', 'kh-ocean', 'kh-forest', 'kh-violet', 'kh-mono', 'kh-sand', 'kh-rose', 'kh-slate'].forEach(function (c) { document.body.classList.remove(c); });
  } else {
    var th = String(getStore('kh_theme', 'dark') || 'dark');
    ['kh-light', 'kh-ocean', 'kh-forest', 'kh-violet', 'kh-mono', 'kh-sand', 'kh-rose', 'kh-slate'].forEach(function (c) { document.body.classList.remove(c); });
    if (th !== 'dark') document.body.classList.add('kh-' + th);
  }
  return khThemePaint();
}
function khThemeImport(text, from){
  if (!window.KHTHEME) throw new Error('皮肤模块未加载');
  var r = window.KHTHEME.parse(text, from || 'paste');
  if (!r.ok) throw new Error(r.error);
  var l = khThemePacks();
  r.packs.forEach(function (p) { l = window.KHTHEME.packsAdd(l, p).list; });
  khThemeSave(l);
  return r.packs;
}
function khThemeRemove(id){
  var pack = khThemeFind(id);
  if (pack && pack.from === 'built') throw new Error('内置样例包不能删，可以覆盖它或换用别的包');
  var l = window.KHTHEME ? window.KHTHEME.packsRemove(khThemePacks(), id) : [];
  khThemeSave(l);
  if (khThemeCur() === id) khThemeApply('');
  return l;
}
/* ---- 1.7.94 分享（清单 #65）：本地二维码 + 中枢短链；链接不合规时退回应用内分享文本 ---- */
var KH_SHARE_KEY = 'kh_share';
function khShareList(){
  var l = getStore(KH_SHARE_KEY, []);
  return Array.isArray(l) ? l : [];
}
function khShareCode(){
  var s = '';
  try { s = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 8) : ''; } catch (e) {}
  if (!s) s = Math.random().toString(36).slice(2, 10);
  return s;
}
/* 生成一条分享：http(s) 目标优先换中枢短链（失败退回原链接直编二维码），应用内路由只走本地 */
function khShareMake(title, target){
  var t = String(target == null ? '' : target).trim();
  var tt = String(title == null ? '' : title).trim().slice(0, 60);
  var isHttp = /^https?:\/\//i.test(t);
  var local = { id: khShareCode(), title: tt || '鸿汇影分享', url: t, code: '', short: '', at: new Date().toISOString(), kind: isHttp ? 'link' : 'app' };
  function remember(rec) {
    var l = khShareList();
    l.unshift(rec);
    setStore(KH_SHARE_KEY, l.slice(0, 20));
    return rec;
  }
  if (!isHttp) {
    local.url = t || '#/home';
    local.short = local.url;
    return Promise.resolve(remember(local));
  }
  return khRemoteReq('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: t, title: tt, base: (location && location.origin) || '' })
  }).then(function (resp) {
    return resp && resp.json ? resp.json() : resp;
  }).then(function (r) {
    if (r && r.ok && r.code) {
      local.code = r.code;
      local.short = r.short || ('/s/' + r.code);
      return remember(local);
    }
    local.short = t;
    local.note = (r && r.error) || '中枢不可用，用原链接生成二维码';
    return remember(local);
  }).catch(function () {
    local.short = t;
    local.note = '中枢不可达，用原链接生成二维码';
    return remember(local);
  });
}
/* 二维码画到 canvas 再转 dataURL：不依赖任何第三方，导出/复制都能用 */
function khQrCanvas(text, px){
  if (!window.KHQR) return null;
  var r = window.KHQR.encode(text);
  if (!r.ok) return r;
  var canvas = document.createElement('canvas');
  var n = r.size, quiet = 4, side = n + quiet * 2;
  var cell = Math.max(2, Math.floor((px || 240) / side));
  canvas.width = canvas.height = side * cell;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0B0D16';
  for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (r.modules[y][x]) ctx.fillRect((x + quiet) * cell, (y + quiet) * cell, cell, cell);
  return { ok: true, canvas: canvas, dataUrl: canvas.toDataURL('image/png'), version: r.version, mask: r.mask, size: n };
}
/* ---- 1.7.94 家庭多档案（清单 #58）：切换时把 10 个独立键快照换挡，既有代码零改动 ---- */
var KH_PROF_DEF = { kh_fav: [], kh_watchlater: [], kh_hist: [], kh_prog: {}, kh_watchlist: [], kh_watchlist_meta: {}, kh_livefav: [], kh_kid: 0, kh_kid_pin: '', kh_kid_min: 0 };
function khProfList(){
  return window.KHFAMILY ? window.KHFAMILY.normList(getStore('kh_profiles', null)) : [{ id: 'p1', name: '家庭', color: '#5AC8FA', createdAt: '' }];
}
function khProfCur(){
  var l = khProfList();
  return window.KHFAMILY ? window.KHFAMILY.normCurrent(l, getStore('kh_profile_cur', '')) : 'p1';
}
function khProfData(){
  var d = getStore('kh_profiles_data', {});
  return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
}
function khProfSave(list){ setStore('kh_profiles', list); return list; }
/* 把当前档案的 10 个键存进档案槽 */
function khProfDump(){
  var cur = khProfCur(), d = khProfData();
  d[cur] = window.KHFAMILY.snapshot(function (k) {
    try { return getStore(k, null); } catch (e) { return null; }
  });
  setStore('kh_profiles_data', d);
  return d[cur];
}
/* 换档：dump 当前 → 写入目标快照（缺的键写回各自默认值，避免串档案） */
function khProfSwitch(id){
  var l = khProfList();
  if (!l.some(function (p) { return p.id === id; })) throw new Error('没有这个档案');
  var cur = khProfCur();
  if (cur === id) return { ok: true, same: true, id: id };
  khProfDump();
  var snap = khProfData()[id] || {};
  window.KHFAMILY.restore(snap, function (k, v) {
    var dv = KH_PROF_DEF[k];
    setStore(k, v === null ? dv : v);
  });
  setStore('kh_profile_cur', id);
  return { ok: true, id: id, name: (l.filter(function (p) { return p.id === id; })[0] || {}).name || '' };
}
function khProfAdd(nm, color){
  khProfDump();
  var r = window.KHFAMILY.create(khProfList(), nm, color);
  if (!r.ok) throw new Error(r.error);
  khProfSave(r.list);
  var d = khProfData();
  d[r.profile.id] = {};
  setStore('kh_profiles_data', d);
  khProfSwitch(r.profile.id);
  return r.profile;
}
function khProfRename(id, nm){
  var r = window.KHFAMILY.rename(khProfList(), id, nm);
  if (!r.ok) throw new Error(r.error);
  khProfSave(r.list);
  return r.list;
}
function khProfDel(id){
  var r = window.KHFAMILY.remove(khProfList(), id);
  if (!r.ok) throw new Error(r.error);
  var wasCur = khProfCur() === id;
  khProfSave(r.list);
  var d = khProfData();
  delete d[id];
  setStore('kh_profiles_data', d);
  if (wasCur) khProfSwitch(r.list[0].id);
  return r.list;
}
/* ---- 1.7.94 元数据与海报来源（清单 #59）：内置不刮削；TMDB 要 Key；豆瓣不实现（说明原因）；自定义走模板 ---- */
function khMetaSrc(){ return window.KHMETA ? window.KHMETA.normSrc(getStore('kh_meta_src', 'builtin')) : 'builtin'; }
function khMetaCache(){ var c = getStore('kh_meta_cache', {}); return (c && typeof c === 'object' && !Array.isArray(c)) ? c : {}; }
function khMetaCached(id){ return window.KHMETA ? window.KHMETA.cacheGet(khMetaCache(), id) : null; }
/* 刮削一部片：返回 Promise<{ok, meta?, error?}>；所有请求都带超时，失败只报原因不静默 */
function khMetaScrape(id, title, year){
  if (!window.KHMETA) return Promise.reject(new Error('元数据模块未加载'));
  var src = khMetaSrc();
  var t = String(title || '').trim(), y = String(year || '').trim();
  if (!t) return Promise.reject(new Error('这部片没有可用的片名'));
  if (src === 'builtin') return Promise.reject(new Error('当前是内置片单模式，不联网刮削；需要海报 / 简介请在设置里换成自定义刮削或 TMDB'));
  if (src === 'douban') return Promise.reject(new Error('豆瓣没有公开 API，抓网页违反其条款，本应用不实现；请用自定义刮削地址（如自建聚合接口）'));
  var url = '';
  if (src === 'tmdb') {
    var key = String(getStore('kh_tmdb_key', '') || '').trim();
    if (!key) return Promise.reject(new Error('TMDB 需要 API Key：先在本面板填入 Key（只存本机，不上云）'));
    url = 'https://api.themoviedb.org/3/search/movie?api_key=' + encodeURIComponent(key) +
      '&query=' + encodeURIComponent(t) + (y ? ('&year=' + encodeURIComponent(y)) : '') + '&language=zh-CN';
  } else {
    var tpl = String(getStore('kh_meta_custom', '') || '');
    var bu = window.KHMETA.buildUrl(tpl, { title: t, year: y });
    if (!bu.ok) return Promise.reject(new Error(bu.error));
    url = bu.url;
  }
  return khRemoteReq(url, { cache: 'no-store' }).then(function (resp) {
    if (resp && resp.ok === false) throw new Error('刮削接口 HTTP ' + resp.status);
    return resp.json();
  }).then(function (json) {
    var raw = json;
    if (src === 'tmdb') {
      var r0 = (json && json.results && json.results[0]) || null;
      if (!r0) throw new Error('TMDB 没搜到「' + t + '」');
      raw = { title: r0.title, release_date: r0.release_date, overview: r0.overview, vote_average: r0.vote_average, poster_path: r0.poster_path ? ('https://image.tmdb.org/t/p/w500' + r0.poster_path) : '' };
    }
    var meta = window.KHMETA.normResult(raw);
    if (!meta) throw new Error('刮削结果里没有可用字段（需要 title / poster / overview 至少一项）');
    meta.at = Date.now();
    var c = typeof khMetaCache === 'function' ? khMetaCache() : {};
    setStore('kh_meta_cache', window.KHMETA.cachePut(c, id, meta, 50));
    return { ok: true, meta: meta, src: src };
  });
}
/* ---- 1.7.94 字幕站与 AI Key（清单 #60）---- */
function khSubSites(){ return window.KHMETA ? window.KHMETA.subSites(getStore('kh_sub_src', '')) : []; }
function khAiKey(){ return String(getStore('kh_ai_key', '') || ''); }
function khAiBase(){ return String(getStore('kh_ai_base', '') || ''); }
/* ---- 1.7.94 网络族与 DNS（清单 #37）：模式写进本机并推给主进程，重启后生效 ---- */
function khIpMode(){ return window.KHMETA ? window.KHMETA.normIpMode(getStore('kh_net_family', 'auto')) : 'auto'; }
function khDnsList(){ return window.KHMETA ? window.KHMETA.dnsList(getStore('kh_dns', '')) : []; }
function khNetPush(){
  var mode = khIpMode(), dns = khDnsList();
  if (window.khB8 && typeof window.khB8.netSet === 'function') {
    return window.khB8.netSet({ mode: mode, dns: dns }).catch(function (e) { return { ok: false, reason: String(e && e.message || e) }; });
  }
  return Promise.resolve({ ok: false, reason: '当前环境没有主进程，网络族设置只记录本机' });
}
/* ---- 1.7.90 偏好与行为（清单 #27 #28 #29 #43 #50 #51）：一处读写，默认值等于旧行为 ---- */
function khPref(){
  var raw = {
    histCap: getStore('kh_hist_cap', 30),
    histDays: getStore('kh_hist_days', 0),
    motion: getStore('kh_motion', 1),
    resume: getStore('kh_resume', 'ask'),
    autoNext: getStore('kh_autonext', 0),
    openMode: getStore('kh_open_mode', 'play'),
    searchScope: getStore('kh_search_scope', 'builtin'),
    whJoin: getStore('kh_wh_join', 1),
    /* 1.7.91 B 档（台账 #167） */
    audioLang: getStore('kh_audio_lang', 'auto'),
    subAuto: getStore('kh_sub_auto', 1),
    subDir: getStore('kh_sub_dir', ''),
    notify: getStore('kh_notify', 'all'),
    notifySound: getStore('kh_notify_sound', 1),
    playerExe: getStore('kh_player_exe', ''),
    playerArgs: getStore('kh_player_args', ''),
    top: getStore('kh_top', 0),
    kid: getStore('kh_kid', 0),
    kidPin: getStore('kh_kid_pin', ''),
    kidMin: getStore('kh_kid_min', 0),
    closeAct: getStore('kh_close_act', 'tray'),
    hotkeys: getStore('kh_hotkeys', {})
  };
  if(window.KHPREF && typeof window.KHPREF.norm === 'function') return window.KHPREF.norm(raw);
  return raw;
}
/* 观看历史连带时间戳：只有时间戳才能按「保留天数」淘汰；老数据没有时间戳，按「未知」保留到下次重写 */
function khHistAt(){
  var v = getStore('kh_hist_at', {});
  if(!v || typeof v !== 'object' || Array.isArray(v)){ setStore('kh_hist_at', {}); return {}; }
  return v;
}
function khHistTouch(id){
  if(!id) return;
  var a = khHistAt();
  a[id] = Date.now();
  var ks = Object.keys(a);
  if(ks.length > 600){
    ks.sort(function(x, y){ return a[x] - a[y]; });
    for(var i = 0; i < ks.length - 600; i++){ delete a[ks[i]]; }
  }
  setStore('kh_hist_at', a);
}
/* 条数 + 天数双重裁剪（顺序保留，超出即截断）；纯逻辑在 KHPREF，这里只负责取存储 */
function khTrimHist(ids){
  if(window.KHPREF && typeof window.KHPREF.trimHist === 'function'){
    return window.KHPREF.trimHist(ids, khHistAt(), khPref(), Date.now());
  }
  var p = khPref(), a = khHistAt(), now = Date.now(), out = [];
  var list = Array.isArray(ids) ? ids : [];
  for(var i = 0; i < list.length; i++){
    var id = list[i];
    if(p.histDays > 0){
      var t = Number(a[id] || 0);
      if(t > 0 && now - t > p.histDays * 86400000) continue;
    }
    out.push(id);
    if(out.length >= p.histCap) break;
  }
  return out;
}
/* 平台入口显隐与置顶（1.7.90 / 清单 #26）：只存名字，内置清单本身不动，恢复默认即清表 */
function khPlatPref(){
  var v = getStore('kh_plat_pref', {});
  if(!v || typeof v !== 'object' || Array.isArray(v)) return { hide: [], pin: [] };
  return {
    hide: Array.isArray(v.hide) ? v.hide.filter(function(x){ return typeof x === 'string'; }) : [],
    pin: Array.isArray(v.pin) ? v.pin.filter(function(x){ return typeof x === 'string'; }) : []
  };
}
/* 仓站点单条治理（1.7.90 / 清单 #57）：隐藏表与置顶表都按站点 url 存，换仓不影响其它仓 */
function khWhHide(){
  var v = getStore('kh_wh_hide', {});
  if(!v || typeof v !== 'object' || Array.isArray(v)){ setStore('kh_wh_hide', {}); return {}; }
  return v;
}
function khWhPin(){ return strArray('kh_wh_pin'); }
/* 动效开关：关掉就只禁过渡/动画，不禁功能；不影响视频本身 */
function khPrefApply(){
  try{
    var p = khPref();
    document.documentElement.classList.toggle('kh-no-motion', !p.motion);
    document.documentElement.setAttribute('data-kh-hist-cap', String(p.histCap));
    /* 1.7.91：儿童模式挂到根节点，页面据此隐藏搜索历史与运维入口 */
    document.documentElement.setAttribute('data-kh-kid', p.kid ? '1' : '0');
    document.documentElement.classList.toggle('kh-kid', !!p.kid);
    /* 1.7.111 E：儿童模式开关同步「家长解锁」按钮的显隐 */
    if(typeof khKidLockBtn === 'function') khKidLockBtn();
  }catch(e){}
}
/* ---- 1.7.91 B 档（台账 #167）---- */
/* 通知统一出口：前端所有通知走这里，策略在两层同时拦（前端先拦，主进程 kh:notify 再拦一次） */
function khNotifyShow(title, body, kind){
  var p = khPref();
  var k = kind || 'other';
  var allow = window.KHPREF ? window.KHPREF.notifyAllow(p.notify, k) : true;
  if(!allow) return false;
  try{ if(window.khNotify && typeof window.khNotify.send === 'function') window.khNotify.send(title, body, k); }catch(e){}
  return true;
}
function khKidOn(){ return !!khPref().kid; }
/* 儿童模式过滤：分类/标签命中儿童词才放行；关着的时候恒 true */
function khKidAllows(m){
  if(!khKidOn()) return true;
  if(!m) return false;
  return window.KHPREF ? window.KHPREF.kidAllows(1, m) : true;
}
/* 家长 PIN 校验（1.7.111 E）：连续错 5 次锁 10 分钟，挡住 4 位穷举；输对即清零。
   返回 { ok, locked?, mins?, left?, nopin? }：没设 PIN 时视为放行（nopin=1）。 */
function khKidPinCheck(input){
  var pin = String(khPref().kidPin || '');
  var st = getStore('kh_kid_pin_fail', { n: 0, until: 0 }) || {};
  var now = Date.now();
  if(st.until && now < st.until){
    return { ok: false, locked: true, mins: Math.max(1, Math.ceil((st.until - now) / 60000)) };
  }
  if(!pin) return { ok: true, nopin: true };
  var inp = String(input == null ? '' : input).replace(/\D/g, '').slice(0, 4);
  if(inp === pin){ if(st.n || st.until) setStore('kh_kid_pin_fail', { n: 0, until: 0 }); return { ok: true }; }
  var n = (Number(st.n) || 0) + 1;
  if(n >= 5){ setStore('kh_kid_pin_fail', { n: 0, until: now + 10 * 60000 }); return { ok: false, locked: true, mins: 10 }; }
  setStore('kh_kid_pin_fail', { n: n, until: 0 });
  return { ok: false, left: 5 - n };
}
/* 儿童模式下常驻「家长解锁」按钮（1.7.111 E）：输对 PIN 才退出，孩子找不到别的出口。 */
function khKidLockBtn(){
  var id = 'khKidUnlockBtn';
  var old = document.getElementById(id);
  if(!khKidOn()){
    if(old && old.parentNode) old.parentNode.removeChild(old);
    return;
  }
  if(old) return;
  var btn = document.createElement('button');
  btn.id = id;
  btn.type = 'button';
  btn.textContent = '🔒 家长解锁';
  btn.setAttribute('aria-label', '输入家长 PIN 退出儿童模式');
  btn.setAttribute('style', 'position:fixed;right:14px;bottom:14px;z-index:9996;border:0;border-radius:14px;' +
    'padding:8px 14px;background:#7A2E3A;color:#FFE6EA;font:13px/1.4 sans-serif;' +
    'box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer');
  btn.onclick = function(){
    var inp = '';
    try{ inp = prompt('输入 4 位家长 PIN 退出儿童模式：') || ''; }catch(e){ inp = ''; }
    var chk = khKidPinCheck(inp);
    if(!chk.ok){
      var msg = chk.locked ? ('PIN 连错太多次，已锁 ' + chk.mins + ' 分钟') : ('PIN 不正确，还可试 ' + chk.left + ' 次');
      try{ if(typeof toast === 'function') toast(msg); else alert(msg); }catch(e){}
      return;
    }
    setStore('kh_kid', 0);
    khPrefApply();
    try{ if(typeof render === 'function') render(); }catch(e){}
    try{ if(typeof toast === 'function') toast('已退出儿童模式'); }catch(e){}
  };
  document.body.appendChild(btn);
}
/* 配置体检（#68）：只统计与给建议，「一键修复」由调用方按 fix 字段执行 */
function khConfigAudit(){
  var out = { damaged: 0, histLen: 0, cap: khPref().histCap, missing: [], unknown: 0, bytes: 0 };
  try{
    var raw = localStorage.getItem('kh_store_damaged');
    var dm = raw ? JSON.parse(raw) : [];
    out.damaged = Array.isArray(dm) ? dm.length : 0;
  }catch(e){}
  try{ out.histLen = strArray('kh_hist').length; }catch(e){}
  try{
    var expect = ['kh_hist','kh_fav','kh_prog','kh_theme','kh_font_scale','kh_hist_cap','kh_hist_days','kh_resume','kh_autonext',
      'kh_open_mode','kh_search_scope','kh_motion','kh_wh_join','kh_stall_limit','kh_watchdog_ms','kh_audio_lang','kh_sub_auto',
      'kh_sub_dir','kh_notify','kh_player_exe','kh_player_args','kh_top','kh_kid','kh_kid_pin','kh_hotkeys','kh_wh_sites',
      'kh_notify_sound','kh_kid_min','kh_close_act'];
    for(var i = 0; i < expect.length; i++){
      if(localStorage.getItem(expect[i]) === null) out.missing.push(expect[i]);
    }
    var known = {}; for(var j = 0; j < expect.length; j++) known[expect[j]] = 1;
    var bytes = 0, unknown = 0;
    for(var n = 0; n < localStorage.length; n++){
      var key = localStorage.key(n);
      var val = localStorage.getItem(key) || '';
      bytes += (key.length + val.length) * 2;
      if(key.indexOf('kh_') === 0 && !known[key]) unknown++;
    }
    out.bytes = bytes; out.unknown = unknown;
  }catch(e){}
  return window.KHPREF ? window.KHPREF.audit(out) : { score: 100, items: [], ok: true };
}
/* 把需要主进程参与的项推过去（快捷键 / 外部播放器 / 通知策略 / 置顶） */
function khB8Sync(){
  if(!window.khB8 || typeof window.khB8.set !== 'function') return Promise.resolve({ ok: false, reason: 'unsupported' });
  var p = khPref();
  return window.khB8.set({
    hotkeys: p.hotkeys,
    player: { exe: p.playerExe, args: p.playerArgs },
    notify: p.notify,
    sound: !!p.notifySound,
    top: !!p.top,
    closeAct: p.closeAct
  }).catch(function(e){ return { ok: false, reason: String(e && e.message || e) }; });
}
/* 1.7.94 #75 跨进程一致：主进程里 b8 被另一处改动（另开窗口保存 / 托盘置顶 / 托盘关窗口）后，
   这里只把值套回本地存储并刷新界面，不再往回推，避免两侧互相覆盖。 */
function khB8Watch(){
  if(!window.khB8 || typeof window.khB8.onChanged !== 'function') return false;
  if(window.__khB8Off) return true;
  window.__khB8Off = window.khB8.onChanged(function(p){
    var b = p && p.b8;
    if(!b) return;
    try{
      if(b.hotkeys && typeof b.hotkeys === 'object') setStore('kh_hotkeys', b.hotkeys);
      if(b.player && typeof b.player === 'object'){
        setStore('kh_player_exe', String(b.player.exe || ''));
        setStore('kh_player_args', String(b.player.args || ''));
      }
      if(b.notify) setStore('kh_notify', b.notify);
      if(typeof b.sound === 'boolean') setStore('kh_notify_sound', b.sound ? 1 : 0);
      if(typeof b.top === 'boolean') setStore('kh_top', b.top ? 1 : 0);
      if(b.closeAct) setStore('kh_close_act', b.closeAct);
      if(typeof khPrefApply === 'function') khPrefApply();
    }catch(e){}
    try{ if(state && state.view === 'settings') render(); }catch(e){}
  });
  return true;
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
function getHistory(){ return khTrimHist(strArray('kh_hist')); }
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
   「庆余年」→ qyn；非汉字原样保留小写。结果按字符串缓存，避免重复比对。 */
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
  cfgQ:'', cfgPaintTimer:0, shareQr:'',
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
  /* 1.7.94 #59 刮削结果：有海报就先显示刮削海报，评分与简介也以刮削为准（没有就完全走原样） */
  var meta = (typeof khMetaCached === 'function') ? khMetaCached(m.id) : null;
  var mposter = meta && meta.poster ? String(meta.poster) : '';
  var coverSrc = mposter || m.cover || '';
  var rating = (meta && meta.rating > 0) ? meta.rating : m.rating;
  var desc = (meta && meta.overview) ? meta.overview : m.desc;
  var key = m.id + '|' + (kw || '') + '|' + (fav ? 1 : 0) + '|' + prog + '|' + (mposter ? mposter.slice(-12) : '');
  if(posterCache[key]) return posterCache[key];
  var c1 = (m.color && /^#[0-9a-fA-F]{6}$/.test(m.color)) ? m.color : '#3B456B';
  var c2 = (m.accent && /^#[0-9a-fA-F]{6}$/.test(m.accent)) ? m.accent : '#5B7BC4';
  var bg = 'linear-gradient(155deg,' + c1 + ' 0%,' + c2 + ' 130%)';
  var cover = coverSrc ? '<img class="poster-img" src="' + esc(coverSrc) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
  var html = '<div class="card" data-act="play" data-id="' + m.id + '" tabindex="0" role="button" aria-label="播放 ' + esc(m.title) + '">' +
    '<div class="poster' + (coverSrc ? ' has-cover' : '') + '" style="background:' + bg + '">' +
      cover +
      '<div class="badge">★ ' + Number(rating || 0).toFixed(1) + '</div>' +
      (fav ? '<div class="badge badge-fav" title="已收藏">★ 收藏</div>' : '') +
  (movieAllDead(m) ? '<div class="badge" style="left:auto;right:8px;background:#7A2323" title="本机探测：全部线路连不上">⚠ 线路不可用</div>' : '') +
      '<div class="play-badge">▶</div>' +
      '<div class="ptitle">' + highlight(esc(m.title), kw) + '</div>' +
      '<div class="psub">' + esc(m.subtitle) + '</div>' +
      (desc ? '<div class="card-tip"><div class="ct-desc">' + esc(desc) + '</div>' + (m.cast ? '<div class="ct-cast">' + esc(m.cast) + '</div>' : '') + (mposter ? '<div class="ct-cast">海报与简介来自刮削来源</div>' : '') + '</div>' : '') +
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
    (builtin ? (function(){
      /* 1.7.90 平台入口显隐与置顶（清单 #26）：本机偏好，不动内置清单 */
      var pp = khPlatPref(), pinned = pp.pin.indexOf(s.name) >= 0;
      return '<button class="mini" data-act="plat-pin" data-name="' + esc(s.name) + '" title="' + (pinned ? '取消置顶' : '置顶这个入口') + '" aria-label="' + (pinned ? '取消置顶' : '置顶') + '「' + esc(s.name) + '」">' + (pinned ? '★' : '☆') + '</button>' +
        '<button class="mini" data-act="plat-hide" data-name="' + esc(s.name) + '" title="隐藏这个入口（可在顶部恢复）" aria-label="隐藏「' + esc(s.name) + '」">✕</button>';
    })() : '<button class="mini" data-act="site-up" data-index="' + index + '" title="上移">↑</button>' +
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
var KH_CLIENT_ONLY = true;
/* 客户纯净版开关：服务端下发 index.html 时按运行模式注入 window.KH_UI_CLEAN
   （客户成品 = 1，开发端 = 0）。没有注入时一律按客户纯净版处理，
   设备端 / 离线页面同样不会出现扩展工具入口与 PKG 角标。 */
var KH_UI_CLEAN = (typeof window.KH_UI_CLEAN === 'undefined') ? true : !!window.KH_UI_CLEAN;
/* 商店纯净变体（1.7.108）：出包时注入 window.KH_STORE=true。
   与 KH_UI_CLEAN 的区别：CLEAN 只收运维入口，STORE 连内容入口一起收——
   不预置任何平台/直播/影视仓/采集源，首页只引导本机与局域网媒体，
   上报默认关闭（用户主动开才发）。私发版不注入此旗标，行为完全不变。 */
var KH_STORE = !!window.KH_STORE;
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

/* 1.7.94 后台刷新（直播源并入、跨进程变更等）触发的整体重绘：
   用户正在设置页的输入框 / 下拉框里操作时不抢占焦点，标记待绘，
   等用户下一次操作或下一次正常重绘时顺带生效。 */
function khSafeRender(){
  try{
    var ae = document.activeElement;
    var tag = String((ae && ae.tagName) || '').toUpperCase();
    if(state.view === 'settings' && (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA')){
      state.renderPending = 1;
      return false;
    }
  }catch(e){}
  render();
  return true;
}
/* 商店变体首页：只有本机 / 局域网媒体引导，不出现任何在线内容入口 */
function khStoreHomeHtml(){
  var allM = allMovies();
  var h = '<div class="hero"><div class="hero-inner">' +
    '<div class="hero-tag">家庭媒体中心 · 本地播放</div>' +
    '<h1>' + (allM.length ? '继续看你的片子' : '把你的片子放进来') + '</h1>' +
    '<p>本应用不预置任何在线内容。打开本机视频、添加你自己持有的直链，或通过局域网投屏到大屏；收藏、历史与续播都会留在本机。</p>' +
    '<button class="btn-primary" data-act="open-file" title="从本机选一个视频文件直接播（仅桌面版）">📂 打开本机视频</button>' +
    '<button class="btn-ghost" style="margin-left:10px" data-act="scan-library" title="选一个文件夹，递归扫出视频按目录分组（仅桌面版）">🗂 扫描媒体库</button>' +
    '<button class="btn-ghost" style="margin-left:10px" data-act="view" data-view="resources">📦 我的资源</button>' +
    '<button class="btn-ghost" style="margin-left:10px" data-act="view" data-view="favorites">⭐ 我的收藏</button>' +
    '<button class="btn-ghost" style="margin-left:10px" data-act="store-privacy">🔒 隐私与权限</button>' +
    '<button class="btn-ghost" style="margin-left:10px" data-act="view" data-view="about" title="版本、包名、开源许可、隐私全文与意见反馈">ℹ️ 关于</button>' +
    '<button class="btn-ghost" style="margin-left:10px" data-act="show-stats">📊 观看周报</button>' +
  '</div></div>';
  if(allM.length){
    h += '<div class="section-head"><h2>我的片库</h2><span>' + allM.length + ' 部 · 全部来自本机</span></div>' + cardsHtml(allM.slice(0, 24), false);
  } else {
    h += '<div class="section-head"><h2>第一次用？两步就能播</h2><span>不需要任何账号</span></div>' +
      '<div class="sitebox"><p>' +
      '<b>1. 本机文件</b>：点「打开本机视频」，选一个 mp4 / mkv / m3u8 立刻播放（桌面版）。<br>' +
      '<b>2. 自有直链</b>：到「我的资源」添加你自己持有的播放地址，保存后出现在首页、搜索与收藏。<br>' +
      '投屏：播放页点「投屏」可把画面送到局域网内的电视 / 大屏（DLNA）。' +
      '</p></div>';
  }
  if(typeof khLibraryHtml === 'function'){ var lib = khLibraryHtml(); if(lib && lib.indexOf('还没有扫描') < 0) h += lib; }
  return h;
}
/* 商店变体首启隐私同意 + 权限最小化声明（1.7.109，审核常见件）。
   仅 KH_STORE 生效；私发版不注入旗标，完全不受影响。
   同意结果持久化在本机 localStorage，不上传；选「仅本地使用」也放行主界面（只关掉上报），
   避免「不同意就不能用」这类强制同意写法。 */
var KH_PRIVACY_KEY = 'kh_store_privacy_v1';
function khStorePrivacyConsented(){ try{ return !!localStorage.getItem(KH_PRIVACY_KEY); }catch(e){ return false; } }
function khStorePrivacyBody(){
  return '<div style="max-height:46vh;overflow:auto;text-align:left;font-size:13px;line-height:1.7;color:#cfd6e4">' +
    '<p><b>鸿汇影 · 商店版</b> 是一款本地媒体播放与投屏工具。我们遵循最小必要原则：</p>' +
    '<p><b>不收集</b>：不预置任何在线内容源；不采集片名、播放链接、设备身份；问题上报默认关闭，仅在你主动开启后才发送匿名错误码。</p>' +
    '<p><b>本机留存</b>：收藏、历史、续播、自建直链与设置仅保存在本机，不上传云端。</p>' +
    '<p><b>权限声明（最小化）</b>：<br>' +
    '· 文件访问：通过系统文件选择器打开你主动选择的本机视频与导入备份，不申请存储权限；<br>' +
    '· 网络：仅用于播放你自行添加的直链、局域网投屏（DLNA）与你主动开启的上报；<br>' +
    '· 局域网发现：仅用于搜索同一 Wi‑Fi 下的投屏设备；<br>' +
    '· 不申请通讯录、位置、相机、麦克风、短信等无关权限。</p>' +
    '<p><b>你的选择</b>：<br>' +
    '· <b>同意</b>：进入主界面；诊断上报默认关闭，只有你主动开启后才发送匿名错误码。<br>' +
    '· <b>仅本地使用</b>：同样进入主界面并能正常播放，只是诊断上报永久关闭、不做任何在线校验。<br>' +
    '两种选择都不影响本地播放、投屏与字幕。当前模式：<b>' + khStorePrivacyModeText() + '</b>。可随时在「设置 → 隐私与权限」复查本声明。</p>' +
    '<p style="text-align:center;margin:4px 0 0"><a href="javascript:void 0" data-act="store-privacy-full" style="color:#4FA3E3;text-decoration:underline">查看隐私政策全文</a></p>' +
    '</div>';
}
function khStorePrivacyShow(force){
  if(!KH_STORE) return;
  if(!force && khStorePrivacyConsented()) return;
  try{
    var old = document.getElementById('__kh_privacy'); if(old) old.parentNode.removeChild(old);
    var ov = document.createElement('div');
    ov.id = '__kh_privacy';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(6,9,16,.86);display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML = '<div style="width:min(560px,94vw);background:#141a28;border:1px solid #2a3348;border-radius:14px;padding:22px 22px 18px;box-shadow:0 18px 60px rgba(0,0,0,.5)">' +
      '<div style="font-size:17px;font-weight:700;color:#fff;margin-bottom:12px">隐私声明与权限说明</div>' +
      khStorePrivacyBody() +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">' +
      '<button id="__kh_priv_no" style="padding:9px 18px;border-radius:9px;border:1px solid #3a4358;background:transparent;color:#aeb6c8;cursor:pointer">仅本地使用（不上报）</button>' +
      '<button id="__kh_priv_yes" style="padding:9px 22px;border-radius:9px;border:0;background:#e8542f;color:#fff;font-weight:600;cursor:pointer">同意并继续</button>' +
      '</div></div>';
    document.body.appendChild(ov);
    /* 弹窗挂在 body 上，不在 els.main 的委托范围内：全文链接单独绑 */
    try{ var pl = ov.querySelector('[data-act="store-privacy-full"]'); if(pl) pl.onclick = function(e){ e.preventDefault(); if(ov.parentNode) ov.parentNode.removeChild(ov); khStorePrivacyFullShow(); }; }catch(e){}
    document.getElementById('__kh_priv_yes').onclick = function(){
      try{ localStorage.setItem(KH_PRIVACY_KEY, JSON.stringify({ agreed:true, at:new Date().toISOString(), ver:'1.7.113' })); }catch(e){}
      if(ov.parentNode) ov.parentNode.removeChild(ov);
      try{ render(); }catch(e){}
    };
    /* 仅本地使用：本机播放不依赖任何个人信息，所以照样放行主界面，只把诊断上报永久关掉。
       「不同意就不能用」是审核会打回的写法，这里不留这条路径。 */
    document.getElementById('__kh_priv_no').onclick = function(){
      window.KH_LIMITED = true;
      try{ localStorage.setItem(KH_PRIVACY_KEY, JSON.stringify({ agreed:false, limited:true, at:new Date().toISOString(), ver:'1.7.113' })); }catch(e){}
      try{ khP2CfgSave({ enabled:false }); }catch(e){}
      if(ov.parentNode) ov.parentNode.removeChild(ov);
      try{ render(); }catch(e){}
      try{ toast('已切换为仅本地使用：诊断上报已关闭，本地播放照常可用'); }catch(e){}
    };
  }catch(e){}
}
function khStorePrivacyGate(){ if(KH_STORE && !khStorePrivacyConsented()) khStorePrivacyShow(false); }
/* ---------------- 商店版审核件（1.7.113 批次 A：F04 关于页 / F05 隐私全文 / F06 反馈入口） ----------------
   审核三问：关于页在哪、隐私全文在哪、怎么联系开发者。全部只 KH_STORE 生效，纯前端、无网络请求。 */
var KH_STORE_META = {
  name: '鸿汇影（商店版）', bundle: 'com.honghub.store', ver: '1.7.113', code: 1000227,
  vendor: '个人开发者', contact: (typeof KH_ABUSE_MAIL !== 'undefined' && KH_ABUSE_MAIL) ? KH_ABUSE_MAIL : '',
  oss: [
    ['hls.js', 'Apache-2.0', 'HTTPS/HLS 播放'],
    ['Electron（仅桌面版同源，HAP 不含）', 'MIT', '—'],
    ['OpenHarmony / KaihongOS 系统 API', 'Apache-2.0', '文件选择器、播放器、DLNA']
  ]
};
function khStorePrivacyFullText(){
  var L = [];
  L.push('鸿汇影（商店版）隐私政策');
  L.push('更新日期：2026-11-27　生效日期：2026-11-27　版本：1.1　包名：com.honghub.store');
  L.push('');
  L.push('一、我们收集什么');
  L.push('本应用不预置任何在线内容源，不采集你的姓名、手机号、通讯录、位置、相机、麦克风、短信、通话记录、设备身份标识，也不采集你播放的片名与播放链接。');
  L.push('仅在以下情形处理少量数据，且全部留在本机：');
  L.push('1. 你通过系统文件选择器主动选择的本机视频路径（仅用于当次播放，不上传）；');
  L.push('2. 你自行添加的播放直链、收藏、历史、续播进度、界面设置（仅存本机存储）；');
  L.push('3. 问题上报：默认关闭。只有你在设置中主动开启后，才会发送匿名错误码与播放结果（首帧/失败），不含片名、链接与设备身份。选择「仅本地使用」的用户上报永久关闭。');
  L.push('');
  L.push('二、权限说明（最小化）');
  L.push('· 网络（ohos.permission.INTERNET）：播放你自行添加的直链、局域网投屏、你主动开启的上报。必需。');
  L.push('· 文件访问：通过系统文件选择器（DocumentViewPicker）由你主动选择文件，应用不申请存储权限、不扫描你未授权的目录。');
  L.push('· 不申请通讯录、位置、相机、麦克风、短信、通话记录等任何无关权限。');
  L.push('');
  L.push('三、数据存储与共享');
  L.push('上述数据仅保存在你的设备本机，不上传云端，不出售、不共享给第三方。');
  L.push('局域网投屏仅在你主动发起时，向同一局域网内你选择的设备发送播放指令。');
  L.push('本应用不含广告 SDK、不含第三方统计 SDK。');
  L.push('');
  L.push('四、你的选择与权利');
  L.push('首次启动提供两种并列选择：「同意」或「仅本地使用」。两种选择都可正常使用全部本地播放、投屏与字幕功能；区别仅在于诊断上报是否允许被开启。');
  L.push('你可随时在首页「隐私与权限」复查本政策全文并切换模式；可随时清除收藏、历史与自建直链；卸载应用即删除本机数据。');
  L.push('');
  L.push('五、未成年人保护');
  L.push('本应用为通用媒体工具，不面向未成年人定向收集信息。若你是未成年人，请在监护人指导下使用。');
  L.push('');
  L.push('六、政策更新与联系');
  L.push('本政策更新后会在应用内提示。意见反馈请通过「关于 → 意见反馈」生成诊断摘要后发送给开发者' + (KH_STORE_META.contact ? '（' + KH_STORE_META.contact + '）' : '') + '。');
  return L.join('\n');
}
function khStorePrivacyModeText(){
  try{
    var rec = JSON.parse(localStorage.getItem(KH_PRIVACY_KEY) || 'null');
    if(!rec) return '尚未选择';
    return rec.limited ? '仅本地使用（上报永久关闭）' : '已同意（上报默认关闭，可自行开启）';
  }catch(e){ return '未知'; }
}
function khStoreClipboard(text){
  try{
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }catch(e){ return false; }
}
function khStoreModal(title, bodyHtml, buttons){
  var ov = document.createElement('div');
  ov.className = '__kh_store_modal';
  ov.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(6,9,16,.86);display:flex;align-items:center;justify-content:center;padding:20px';
  var bh = buttons.map(function(b, i){ return '<button data-mi="' + i + '" style="padding:9px 18px;border-radius:9px;border:' + (i === 0 ? '0;background:#e8542f;color:#fff;font-weight:600' : '1px solid #3a4358;background:transparent;color:#aeb6c8') + ';cursor:pointer">' + b.label + '</button>'; }).join('');
  ov.innerHTML = '<div style="width:min(640px,94vw);max-height:90vh;display:flex;flex-direction:column;background:#141a28;border:1px solid #2a3348;border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.5)">' +
    '<div style="font-size:17px;font-weight:700;color:#fff;padding:18px 22px 8px">' + title + '</div>' +
    '<div style="padding:4px 22px;overflow:auto;flex:1;max-height:66vh">' + bodyHtml + '</div>' +
    '<div style="display:flex;gap:10px;justify-content:flex-end;padding:14px 22px 18px">' + bh + '</div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', function(e){
    var b = e.target.closest('[data-mi]'); if(!b) return;
    var fn = buttons[Number(b.getAttribute('data-mi'))].fn;
    if(ov.parentNode) ov.parentNode.removeChild(ov);
    if(fn) fn();
  });
  return ov;
}
/* F05 隐私全文：可滚动、可复制 */
function khStorePrivacyFullShow(){
  if(!KH_STORE) return;
  var txt = khStorePrivacyFullText();
  khStoreModal('隐私政策全文', '<pre style="white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.75;color:#cfd6e4;margin:0;user-select:text">' + txt.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>', [
    { label:'复制全文', fn:function(){ toast(khStoreClipboard(txt) ? '隐私政策全文已复制' : '复制失败：请手动选中文字'); } },
    { label:'关闭', fn:null }
  ]);
}
/* F06 反馈入口：无服务端，生成脱敏诊断摘要并复制；邮箱如实显示，未配置就说未配置 */
function khStoreDiagSummary(){
  var ls = { fav:0, hist:0, res:0, keys:0 };
  try{
    for(var i=0;i<localStorage.length;i++){
      var k = localStorage.key(i); if(!k || k.indexOf('kh_') !== 0) continue; ls.keys++;
      if(/fav/i.test(k)) ls.fav = (JSON.parse(localStorage.getItem(k) || '[]').length) || ls.fav;
      else if(/hist|progress/i.test(k)) ls.hist = ls.hist + 1;
      else if(/res|source/i.test(k)) ls.res = ls.res + 1;
    }
  }catch(e){}
  var L = [];
  L.push('鸿汇影（商店版）意见反馈 · 诊断摘要');
  L.push('应用：' + KH_STORE_META.ver + ' (' + KH_STORE_META.code + ')  包名：' + KH_STORE_META.bundle);
  L.push('隐私模式：' + khStorePrivacyModeText());
  L.push('运行环境：' + (navigator.userAgent || '').slice(0, 120));
  L.push('语言：' + (navigator.language || '-') + '  屏幕：' + screen.width + 'x' + screen.height);
  L.push('本机数据：收藏条目 ' + ls.fav + ' · 历史/进度类键 ' + ls.hist + ' · 资源类键 ' + ls.res + '（不含内容，只计数）');
  L.push('时间：' + new Date().toISOString());
  L.push('');
  L.push('问题描述（请填写）：');
  L.push('1. 你做了什么：');
  L.push('2. 期望发生什么：');
  L.push('3. 实际发生什么：');
  return L.join('\n');
}
function khStoreFeedback(){
  if(!KH_STORE) return;
  var s = khStoreDiagSummary();
  var mailLine = KH_STORE_META.contact
    ? '反馈邮箱：<b>' + KH_STORE_META.contact + '</b>'
    : '反馈邮箱：<b>尚未配置</b>（分发前须在 kh-admin.js 的 KH_ABUSE_MAIL 填入真实可达邮箱）';
  khStoreModal('意见反馈', '<div style="font-size:13px;line-height:1.8;color:#cfd6e4"><p>本应用没有服务端，不会自动上传任何内容。请把下面的诊断摘要复制后发给我们；摘要不含片名、链接与设备身份。</p><p>' + mailLine + '</p><pre style="white-space:pre-wrap;font-size:12px;line-height:1.7;background:#0f1420;border:1px solid #252d40;border-radius:8px;padding:10px;user-select:text">' + s.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre></div>', [
    { label:'复制诊断摘要', fn:function(){ toast(khStoreClipboard(s) ? '已复制，粘贴到邮件里发给开发者即可' : '复制失败：请手动选中文字'); } },
    { label:'关闭', fn:null }
  ]);
}
/* F04 关于页正文 */
function khStoreAboutHtml(){
  var m = KH_STORE_META;
  var h = '<div style="padding:20px 18px;line-height:1.9;font-size:14px;max-width:780px">';
  h += '<h2 style="margin:0 0 6px">关于「' + m.name + '」</h2>';
  h += '<p style="opacity:.75;margin:0 0 12px">一款不预置任何在线内容的本地媒体播放与局域网投屏工具。</p>';
  h += '<table style="border-collapse:collapse;font-size:13px;margin:6px 0 14px">';
  var rows = [['应用名称', m.name], ['版本', m.ver + '（版本码 ' + m.code + '）'], ['包名', m.bundle], ['开发者', m.vendor], ['隐私模式', khStorePrivacyModeText()], ['联系与投诉', m.contact || '尚未配置']];
  for(var i=0;i<rows.length;i++) h += '<tr><td style="padding:4px 14px 4px 0;color:#8a93a8;white-space:nowrap">' + rows[i][0] + '</td><td style="padding:4px 0;user-select:text">' + rows[i][1] + '</td></tr>';
  h += '</table>';
  h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 16px">' +
    '<button class="qbtn" data-act="store-privacy-full">查看隐私政策全文</button>' +
    '<button class="qbtn" data-act="store-feedback">意见反馈</button>' +
    '<button class="qbtn" data-act="store-privacy">隐私与权限</button></div>';
  h += '<h3 style="margin:14px 0 6px;font-size:15px">开源许可</h3><ul style="padding-left:20px;margin:4px 0;font-size:13px;opacity:.9">';
  for(var j=0;j<m.oss.length;j++) h += '<li><b>' + m.oss[j][0] + '</b> — ' + m.oss[j][1] + '（' + m.oss[j][2] + '）</li>';
  h += '</ul>';
  h += '<h3 style="margin:14px 0 6px;font-size:15px">免责声明</h3><p style="font-size:13px;opacity:.85">本应用仅提供播放、媒体库管理与局域网投屏能力，不托管、不上传、不破解、不聚合任何在线影视内容。你所播放的本机文件与自行添加的直链应由你自行确保合法授权。资源可用性取决于第三方服务，本应用不对第三方内容承担责任。</p>';
  h += '</div>';
  return h;
}
function render(){
  state.renderCount++;
  state.renderPending = 0;
  /* 记住当前所在视图 + 分类 / 筛选：从原生网页页返回时 WebView 可能被系统回收重建，
     有了这份状态就能回到原来的平台页，而不是被重置回首站首页。 */
  var vkey = state.view + '|' + state.platCat + '|' + state.platFilter;
  if(vkey !== state.lastViewKey){
    state.lastViewKey = vkey;
    try{ setStore('kh_view_state', {view:state.view, cat:state.platCat, filter:state.platFilter}); }catch(e){}
  }
  var html = '';
  html += bootBannerHtml();
  html += selfCheckBanner();
  var kw = state.keyword.trim().toLowerCase();
            if(state.view === 'home' && KH_STORE){
    html += khStoreHomeHtml();
  } else if(state.view === 'home'){
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
        '<div class="hero-tag">还没有片源 · 三条路任选一条</div>' +
        '<h1>先选一条路，就能播</h1>' +
        '<p>这一版不预置任何片源。三个入口任选：导入影视仓配置（一次拿一批接口站）、添加一条直链、或直接看直播；桌面版还能直接打开本机视频。</p>' +
        '<button class="btn-primary" data-act="view" data-view="sites">① 平台入口 / 影视仓</button>' +
        '<button class="btn-ghost" style="margin-left:10px" data-act="view" data-view="resources">② 添加一条直链</button>' +
        '<button class="btn-ghost" style="margin-left:10px" data-act="view" data-view="live">③ 看直播（' + LIVE_CHANNELS.length + ' 个）</button>' +
        '<button class="btn-ghost" style="margin-left:10px" data-act="open-file" title="从本机选一个视频文件直接播（仅桌面版）">📂 打开本机视频</button>' +
      '</div></div>' +
      '<div class="section-head"><h2>第一次用？按这个顺序</h2><span>不连中枢也能做完</span></div>' +
      '<div class="sitebox"><p>' +
      '<b>1. 有接口站</b>：到「网站」页 → 影视仓，粘贴或导入站点配置（形如 https://…/api.php/provide/vod/），保存后片名能直接搜到。<br>' +
      '<b>2. 有直链</b>：到「资源」页填一条 mp4 / m3u8，保存后立刻出现在首页、分类、搜索与收藏。<br>' +
      '<b>3. 什么都没有</b>：先看直播（' + LIVE_CHANNELS.length + ' 个频道实测可播），桌面端点「打开本机视频」选本地文件。' +
      '</p></div>';
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
    /* 1.7.95 标签筛选（台账 P2-B04）：内置片源没有「地区」字段，不编造地区维度，
       改用真实存在的标签（开源授权 / 动画 / 科幻 / 剧情 …）做第三维筛选。 */
    var _tagAll = [];
    allMovies().forEach(function(m){ (m.tags || []).forEach(function(t){ if(t && _tagAll.indexOf(t) < 0) _tagAll.push(t); }); });
    var _tagTop = _tagAll.slice(0, 10);
    var tg = state.catTag || '';
    if(tg && tg !== '全部' && _tagTop.indexOf(tg) < 0) { tg = ''; state.catTag = ''; }
    if(_tagTop.length){
      html += '<div class="chips" style="margin-top:6px">' +
        '<button class="chip ' + (!tg || tg === '全部' ? 'on' : '') + '" data-act="cat-tag" data-t="全部">全部标签</button>' +
        _tagTop.map(function(t){
          return '<button class="chip ' + (tg === t ? 'on' : '') + '" data-act="cat-tag" data-t="' + esc(t) + '">' + esc(t) + '</button>';
        }).join('') + '</div>';
    }
    var list = state.category === '全部' ? allMovies() : allMovies().filter(function(m){ return m.category === state.category; });
    if(tg && tg !== '全部') list = list.filter(function(m){ return (m.tags || []).indexOf(tg) >= 0; });
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
      html += '<div class="empty"><span class="ico">🎬</span>「' + esc(state.category) + '」暂无片源<br>' +
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
    /* 1.7.90 搜索范围（清单 #27）：内置片单始终在内；直播频道与影视仓站点按设置追加 */
    var _scope = khPref().searchScope, liveHits = [], whHits = [];
    var _scLive = (window.KHPREF && window.KHPREF.scopeHas) ? window.KHPREF.scopeHas(_scope, 'live') : (_scope === 'live' || _scope === 'warehouse');
    var _scWh = (window.KHPREF && window.KHPREF.scopeHas) ? window.KHPREF.scopeHas(_scope, 'warehouse') : (_scope === 'warehouse');
    /* #56：仓站点只有开了「并入分组与搜索」才进搜索结果 */
    if(_scWh && !khPref().whJoin) _scWh = false;
    if(kw && _scLive){
      try{
        liveHits = (window.LIVE_CHANNELS || []).filter(function(ch){
          return String((ch.name || '') + ' ' + (ch.group || '')).toLowerCase().indexOf(kw) >= 0;
        }).slice(0, 12);
      }catch(e0){}
    }
    if(kw && _scWh){
      try{
        var _wlist = getWhList(), _wmap = whSitesMap();
        for(var _wi = 0; _wi < _wlist.length && whHits.length < 12; _wi++){
          var _ws = _wmap[_wlist[_wi].id] || [];
          for(var _wj = 0; _wj < _ws.length && whHits.length < 12; _wj++){
            var _s1 = _ws[_wj];
            if(String((_s1.name || '') + ' ' + (_s1.cat || '') + ' ' + (_s1.whName || '')).toLowerCase().indexOf(kw) >= 0){
              whHits.push({ name: _s1.name || _s1.url, url: _s1.url, cat: _s1.cat || '', host: _s1.whName || '' });
            }
          }
        }
      }catch(e1){}
    }
    var offlineNow = (typeof navigator !== 'undefined' && navigator.onLine === false);
    var _searchChips = _searchCats.length > 1 ? '<div class="chips">' +
      '<button class="chip ' + (!state.searchCat ? 'on' : '') + '" data-act="search-cat" data-cat="">全部</button>' +
      _searchCats.map(function(c){ return '<button class="chip ' + (state.searchCat === c ? 'on' : '') + '" data-act="search-cat" data-cat="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') +
      '</div>' : '';
    html += '<div class="section-head"><h2>搜索结果</h2><span>关键词「' + esc(state.keyword) + '」· ' + resCat.length + ' 部' +
      (liveHits.length ? ' · 直播 ' + liveHits.length : '') + (whHits.length ? ' · 仓站 ' + whHits.length : '') + '</span></div>' + _searchChips +
            (kw ? (resCat.length ? cardsHtml(resCat, true, state.keyword.trim()) :
              (offlineNow
                ? '<div class="empty"><span class="ico">📡</span>本机当前离线：只能搜到内置片单<br>恢复网络后可同步更多资源再搜</div>'
                : '<div class="empty"><span class="ico">🔎</span>没有找到「' + esc(state.keyword) + '」相关的影片<br>' + (state.searchCat ? '该分类下暂无结果，可切换上方分类看看<br>' : '') + '换个片名、演员或标签试试</div>'))
                : '<div class="empty"><span class="ico">🔎</span>输入片名、演员或标签即可搜索<br>也支持拼音首字母，如「qyn」搜庆余年</div>');
    if(kw && liveHits.length){
      html += '<div class="sitebox" style="margin-top:14px"><h3>直播频道命中 ' + liveHits.length + ' 个</h3><div class="sitelist">' +
        liveHits.map(function(ch){
          return '<div class="siteitem"><div class="siteico" style="background:#2B4B6F">📺</div>' +
            '<div class="sitemeta"><div class="n">' + esc(ch.name) + '</div><div class="u">' + esc(ch.group || '直播') + '</div></div>' +
            '<button class="siteopen" data-act="live-go" data-name="' + esc(ch.name) + '">▶ 看直播</button></div>';
        }).join('') + '</div><p class="platnote">只匹配已内置的频道名与分组，不联网请求第三方源。</p></div>';
    }
    if(kw && whHits.length){
      html += '<div class="sitebox" style="margin-top:14px"><h3>影视仓站点命中 ' + whHits.length + ' 个</h3><div class="sitelist">' +
        whHits.map(function(s){
          return '<div class="siteitem"><div class="siteico" style="background:#3B456B">' + esc(String(s.name).slice(0, 1)) + '</div>' +
            '<div class="sitemeta"><div class="n">' + esc(s.name) + '</div><div class="u">' + esc((s.cat ? s.cat + ' · ' : '') + (s.host || '')) + '</div></div>' +
            '<button class="siteopen" data-act="site-open" data-url="' + esc(s.url) + '">打开</button></div>';
        }).join('') + '</div><p class="platnote">只匹配仓里已导入的站点名 / 分类；片名检索请走「跨仓搜片」。</p></div>';
    }
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
  } else if(state.view === 'live' && !KH_STORE){
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

  } else if(state.view === 'sites' && !KH_STORE){
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
    /* 1.7.97 分批加载：124 个平台入口一次全量铺开会拖低配机首屏，先出 60 个，按需追加 */
    var _shown = Number(state.platShown) || 60;
    var _limit = Math.min(_plats.length, _shown);
    for(var pi=0;pi<_limit;pi++){
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
    if(_plats.length > _limit){
      html += '<div class="sitetools" style="justify-content:center;margin-top:12px">' +
        '<button class="qbtn" data-act="plat-more">显示更多（还有 ' + (_plats.length - _limit) + ' 个）</button>' +
        '<button class="qbtn" data-act="plat-more" data-all="1">一次显示全部 ' + _plats.length + ' 个</button>' +
        '<span class="syncstat">已显示 ' + _limit + '/' + _plats.length + '：分批渲染是为了低配机首屏不卡</span></div>';
    }
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
    var _platP = khPlatPref();
    var _groupSites = platSorted(BUILTIN_SITES.filter(function(x){
      if(!(_showAll || platDirect(x))) return false;
      return _platP.hide.indexOf(x.name) < 0;
    }));
    if(_platP.pin.length){
      _groupSites = _groupSites.map(function(x, i){ return { x: x, i: i, top: _platP.pin.indexOf(x.name) >= 0 ? 0 : 1 }; })
        .sort(function(a, b){ return a.top - b.top || a.i - b.i; }).map(function(o){ return o.x; });
    }
    html += '<div class="section-head"><h2>第三方平台官网入口</h2><span>' +
      _groupSites.length + '/' + BUILTIN_SITES.length + ' 个站点 · 默认打开实测可用的移动 H5 / 网页版</span></div>';
    if(_platP.hide.length){
      html += '<div class="sitetools"><span class="syncstat">已隐藏 ' + _platP.hide.length + ' 个入口</span>' +
        '<button class="qbtn" data-act="plat-hide-reset">全部恢复</button></div>';
    }
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
      /* 分组筛选：按自建站点 group 字段生成 chips，点选只看该组；
         1.7.90（清单 #56）：仓站点开关打开时，把仓站点的分类也并进分组 chips，选中后下方仓站区块同步过滤 */
      var _grp = state.siteGrp || '全部';
      var _whJoins = khPref().whJoin ? 1 : 0;
      var _whSites = whAllSites();
      var _grps = [];
      for(var gi=0;gi<custom.length;gi++){ var gv = custom[gi].group || '未分组'; if(_grps.indexOf(gv) < 0) _grps.push(gv); }
      if(_whJoins){
        for(var _gj = 0; _gj < _whSites.length; _gj++){
          var _gc = _whSites[_gj].cat || '影视仓';
          if(_grps.indexOf(_gc) < 0) _grps.push(_gc);
        }
      }
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
    /* 影视仓站点：启用仓收录的站点，按仓分组列出（站点归仓管，删仓即整体清掉）；
       1.7.90 起支持本机「隐藏单条 / 置顶」（清单 #57），以及按分组筛选时同步过滤（#56） */
    if(_whSites.length){
      html += '<div class="section-head"><h2>影视仓站点</h2><span>' + _whSites.length + ' 个 · 来自 ' + _whOn + ' 个启用中的仓</span></div>';
      var _whNames = [];
      for(var _wq = 0; _wq < _whSites.length; _wq++){
        var _nm = _whSites[_wq].whName || '影视仓';
        if(_whNames.indexOf(_nm) < 0) _whNames.push(_nm);
      }
      var _hideMap = khWhHide(), _pinList = khWhPin(), _hiddenCnt = 0;
      for(var _wc = 0; _wc < _whNames.length; _wc++){
        var _one = _whNames[_wc], _sub = [];
        for(var _wr = 0; _wr < _whSites.length; _wr++){
          var _cand = _whSites[_wr];
          if((_cand.whName || '影视仓') !== _one) continue;
          /* #56：开了「并入分组」且当前选了某个分组时，仓站点按自己的分类跟着筛 */
          if(_whJoins && _grp !== '全部' && String(_cand.cat || '影视仓') !== _grp) continue;
          if(_hideMap[String(_cand.url || '')]){ _hiddenCnt++; continue; }
          _sub.push(_cand);
        }
        if(!_sub.length) continue;
        /* 置顶的排前面，其余保持仓里的原顺序（数组 sort 在旧浏览器不一定稳定，用下标兜底） */
        _sub = _sub.map(function(x, i){
          return { x: x, i: i, top: _pinList.indexOf(String(x.url || '')) >= 0 ? 0 : 1 };
        }).sort(function(a, b){ return a.top - b.top || a.i - b.i; }).map(function(o){ return o.x; });
        html += '<div class="subhead" style="margin:14px 2px 6px;font-size:13px;letter-spacing:.5px;color:#9aa6bd;font-weight:700">' + esc(_one) + ' · ' + _sub.length + ' 个站点</div>' +
          '<div class="sitetools" style="margin:0 0 6px">' +
            '<input id="whSiteKw" class="u" type="text" placeholder="在这个仓里搜站点名 / 分组" aria-label="仓内搜索站点" oninput="khWhSiteFilter(this.value)">' +
            (_sub.length > 40 ? '<button class="qbtn" data-act="wh-show-all">显示全部 ' + _sub.length + ' 个</button>' : '') +
          '</div><div class="sitelist">';
        var _cap = Math.min(_sub.length, 40);
        for(var _wz = 0; _wz < _sub.length; _wz++){
          var _ws = _sub[_wz];
          var _jar = _ws.jar ? '<span class="builtin" style="color:#FF7A7A">jar（不支持）</span>' : '';
          var _pinned = _pinList.indexOf(String(_ws.url || '')) >= 0;
          html += '<div class="siteitem" data-name="' + esc(String(_ws.name + ' ' + (_ws.cat || '') + ' ' + (_ws.whName || '')).toLowerCase()) + '"' +
            (_wz >= _cap ? ' style="display:none" data-rest="1"' : '') + '>' +
            '<div class="siteico" style="background:' + esc(_ws.color || '#3B456B') + '">' + esc((_ws.tag || _ws.name || 'W').slice(0,1)) + '</div>' +
            '<div class="sitemeta"><div class="n">' + esc(_ws.name) + (_pinned ? '<span class="builtin">置顶</span>' : '') + '<span class="builtin">' + esc(_ws.cat || '影视仓') + '</span>' + _jar + '</div>' +
            '<div class="u">' + esc(_ws.url) + '</div></div>' +
            '<button class="mini" data-act="wh-site-pin" data-url="' + esc(_ws.url) + '" title="' + (_pinned ? '取消置顶' : '置顶这个站点') + '" aria-label="' + (_pinned ? '取消置顶' : '置顶') + '「' + esc(_ws.name) + '」">' + (_pinned ? '★' : '☆') + '</button>' +
            '<button class="mini" data-act="wh-site-hide" data-url="' + esc(_ws.url) + '" title="在这个仓里隐藏这条（不动仓本身）" aria-label="隐藏「' + esc(_ws.name) + '」">✕</button>' +
            '<button class="mini" data-act="plat-copy" data-url="' + esc(_ws.url) + '" title="复制网址" aria-label="复制「' + esc(_ws.name) + '」的网址">⧉</button>' +
            '<button class="siteopen" data-act="site-open" data-mode="pc" data-url="' + esc(_ws.url) + '" aria-label="打开「' + esc(_ws.name) + '」">打开</button>' +
          '</div>';
        }
        html += '</div>';
        if(_sub.length > _cap) html += '<p class="platnote">默认先显示前 ' + _cap + ' 个，点「显示全部」可展开；用上面的框能直接搜到后面的站点。</p>';
      }
      if(_hiddenCnt){
        html += '<p class="platnote">已在本机隐藏 ' + _hiddenCnt + ' 个仓站点（只影响这台设备的列表与搜索，仓本身不动）' +
          ' <button class="qbtn" data-act="wh-hide-reset">全部恢复</button></p>';
      }
      html += '<p class="platnote">这里的隐藏与置顶是本机偏好；清空影视仓或删仓后对应记录自动失效。</p>';
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
    html += '<div class="section-head"><h2>影视资源配置</h2><span>自建 ' + own.length + ' / 50</span></div>' +
      '<div class="sitebox"><h3>' + (state.resEdit >= 0 ? '编辑影视资源' : '添加影视资源') + '</h3>' +
      '<p>按电影 / 动画 / 短剧等分类配置自有片源，填 1~3 路视频直链（mp4 / m3u8），保存后立即出现在首页、分类、搜索与收藏。' +
      '应用不内置任何本地视频文件，也不预置样片；片源全部由你自己添加，商用请使用已获授权的媒资。</p>' +
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
        (KH_STORE ? '' : '<button class="qbtn" data-act="share-export">📤 分享订阅源</button><button class="qbtn" data-act="share-import">📥 导入分享</button>') +
      '</div>' +
      '<div class="backupbox"><textarea id="resBackup" placeholder="备份 JSON 会显示在这里；也可粘贴后点「导入备份」" aria-label="资源备份"></textarea></div>' +
      (state.resConfirmClear ? '<div class="confirmbar">确定清空全部 ' + own.length + ' 个自建资源？此操作不可撤销。' +
        '<button class="btn-primary" data-act="res-clear-yes">确定清空</button>' +
        '<button class="btn-ghost" data-act="res-clear-no">再想想</button></div>' : '') +
      '</div>';
if(MOVIES.length){
    html += '<div class="section-head"><h2>内置资源分布</h2><span>共 ' + MOVIES.length + ' 部 · 每部 1~3 路公开网络源（实测可达）</span></div><div class="sitelist">';
    for(var gc=0;gc<RES_CATEGORIES.length;gc++){
      var catName = RES_CATEGORIES[gc];
      var cnt = MOVIES.filter(function(mm){ return mm.category === catName; }).length;
      html += '<div class="siteitem"><div class="siteico" style="background:#3B456B">' + esc(catName.slice(0,1)) + '</div>' +
        '<div class="sitemeta"><div class="n">' + esc(catName) + '</div><div class="u">' + cnt + ' 部 · ' + (cnt*3) + ' 路源</div></div></div>';
    }
    html += '</div>';
}
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
  html += '<div class="tip">影视资源配置：自建片源按电影 / 动画 / 短剧 / 剧集 / 纪录片 / 综艺分类管理，' +
          '可添加、编辑与备份自有片源，并把片名同步检索到 ' + BUILTIN_SITES.length + ' 个平台。' +
          '「网站」页已按同一套分类同步更新各大平台的官方影视资源入口。应用不内置任何本地视频文件，也不预置样片；' +
          '商用请使用你已获授权的媒资。</div>';
  } else if(state.view === 'settings'){
    var _sv = window.KH_SERVICE || {}, _rel = (_sv.release && _sv.release.versionName) || '';
    var _iss = window.KH_ISSUES && window.KH_ISSUES.summary;
    /* 1.7.104：局域网访问开关 + 检查更新（默认只对本机开放） */
    html += '<div class="section-head"><h2>设置 · 网络与更新</h2><span>默认只对本机开放</span></div>' +
      '<div class="sitebox"><h3>局域网访问（默认关闭）</h3>' +
      (typeof khLanHtml === 'function' ? khLanHtml() : '<p class="platnote">开关只在桌面端可用</p>') +
      '<div class="sitetools">' +
      '<button class="qbtn" data-act="lan-toggle">' + (getStore('kh_lan_on', false) ? '关闭局域网访问' : '开启局域网访问') + '</button>' +
      '<button class="qbtn" data-act="update-check">⟳ 检查更新</button>' +
      '</div>' +
      (typeof khUpdateHtml === 'function' ? khUpdateHtml() : '<p class="platnote">更新检查未加载</p>') +
      '</div>';
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
      '<div class="sitebox"><h3>备份与恢复</h3>' +
      '<p>备份包含收藏 / 稍后看 / 历史 / 进度 / 追剧 / 自建站点 / 影视仓 / 自建直播 / 场景 / 远程配置 / 设置项。' +
      '加密包（.khbak）用 PBKDF2-SHA256 + AES-256-GCM 保护，密码只在本机内存里用，不写进文件，忘了无法找回。</p>' +
      '<div class="sitetools">' +
        '<button class="qbtn" data-act="bak-export">📥 导出备份</button>' +
        '<button class="qbtn" data-act="bak-export-enc">🔐 导出加密备份</button>' +
        '<button class="qbtn" data-act="bak-import">📤 导入备份</button>' +
      '</div>' +
      (function(){
        var cfg = (typeof khBakAutoCfg === 'function') ? khBakAutoCfg() : { on: false, every: 'daily', dir: '', keep: 3 };
        var last = (typeof khBakAutoLast === 'function') ? khBakAutoLast() : '';
        var dirText = cfg.dir ? cfg.dir : '默认：文档 · 鸿汇影·备份（首次写入时自动创建）';
        return '<div style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--line)">' +
          '<div style="font-weight:600;font-size:13px;margin-bottom:6px">自动备份</div>' +
          '<div class="siteform">' +
            '<select id="bakAutoOn" aria-label="自动备份开关">' +
              '<option value="1"' + (cfg.on ? ' selected' : '') + '>开启自动备份</option>' +
              '<option value="0"' + (!cfg.on ? ' selected' : '') + '>关闭</option>' +
            '</select>' +
            '<select id="bakAutoEvery" aria-label="备份周期">' +
              [['launch', '每次启动'], ['daily', '每天一次'], ['weekly', '每周一次']].map(function(p){
                return '<option value="' + p[0] + '"' + (cfg.every === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
              }).join('') +
            '</select>' +
            '<select id="bakAutoKeep" aria-label="保留份数">' +
              [1, 3, 5, 10].map(function(k){
                return '<option value="' + k + '"' + (cfg.keep === k ? ' selected' : '') + '>保留 ' + k + ' 份</option>';
              }).join('') +
            '</select>' +
            '<button class="btn-primary" data-act="bak-auto-save">保存</button>' +
          '</div>' +
          '<div class="sitetools" style="margin-top:8px">' +
            '<button class="qbtn" data-act="bak-dir-pick">选择目录</button>' +
            '<button class="qbtn" data-act="bak-dir-open">打开目录</button>' +
            '<span class="syncstat" style="word-break:break-all">' + esc(dirText) + '</span>' +
          '</div>' +
          '<p class="platnote">上次自动备份：' + esc(last ? String(last).slice(0, 19).replace('T', ' ') : '还没有') +
          ' · 自动备份只写本机目录，不上传任何服务器。' +
          (cfg.on ? '' : ' · 当前为关闭状态，到期也不会写盘。') + '</p>' +
        '</div>';
      })() +
      (function(){
        var snaps = (typeof khSnapList === 'function') ? khSnapList() : [];
        if(!snaps.length){
          return '<p class="platnote" style="margin-top:10px">配置快照：还没有留点。导出 / 导入 / 重置前会自动留一份，最多 5 版。</p>';
        }
        var rows = snaps.map(function(s, i){ return { s: s, i: i }; }).reverse().map(function(it){
          var s = it.s || {};
          return '<div class="sitetools" style="justify-content:space-between">' +
            '<span style="font-size:12px;color:var(--text)">' + esc(String(s.at || '').slice(0, 19).replace('T', ' ')) +
              ' · ' + esc(khSnapReasonName(s.reason)) + ' · ' + esc(KHBak ? KHBak.fmtBytes(s.bytes || 0) : '') +
              ' · v' + esc(String(s.version || '?')) + '</span>' +
            '<button class="qbtn" data-act="bak-snap-restore" data-i="' + it.i + '">↺ 回滚到这一版</button>' +
          '</div>';
        }).join('');
        return '<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)">' +
          '<div style="font-weight:600;font-size:13px;margin-bottom:6px">配置快照（' + snaps.length + ' / 5）</div>' +
          rows +
          '<div class="sitetools"><button class="qbtn" data-act="bak-snap-clear">清空快照</button></div></div>';
      })() +
      '<p class="platnote">卸载说明：在 Windows「应用和功能」里卸载时，会先把个人数据备份到「文档 · 鸿汇影·卸载备份」再询问是否删除；' +
      '收藏 / 历史 / 设置本身存在安装目录之外，覆盖安装与换版本都不会丢。</p></div>' +
      '<div class="sitebox"><h3>本次会话截图</h3>' +
      '<p>截图记录只留在内存里（片名 / 播放点 / 截图时刻），不写磁盘、不进备份导出，重启应用即清空；图片本身在截图时就已保存到你选的下载目录。</p>' +
      '<div class="sitetools"><button class="qbtn" data-act="shot-log">🖼 查看记录（' + (typeof KH_SHOT_LOG !== 'undefined' && KH_SHOT_LOG ? KH_SHOT_LOG.length : 0) + '）</button></div></div>' +
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
      '<p class="platnote">设备端（深开鸿 / HAP）这一栏填中枢那台机器的 <b>WLAN 地址</b>，并且两台要在同一网段、中枢已开启局域网访问；填完仍不通，先查网段和入站放行，再回头查地址。</p>' +
      '<div class="siteform">' +
        '<input id="hubUrl" class="u" type="text" placeholder="http://192.168.1.10:8890" autocomplete="off" value="' + esc((function(){ var _h = ''; try { _h = getStore('kh_hub_url', '') || localStorage.getItem('khHub') || ''; } catch (e) {} return _h || (window.KH_HUB || ''); })()) + '">' +
        '<button class="btn-primary" data-act="hub-save">保存</button>' +
        '<button class="btn-ghost" data-act="hub-test">测试连接</button>' +
      '</div>' +
      '<p class="platnote">当前生效：' + (window.KH_HUB ? esc(String(window.KH_HUB)) : '本机（同源）') + '</p></div>' +
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
      (window.khUpdater
        ? '<div class="siteform" style="margin-top:8px"><select id="khSilentIns" aria-label="安装方式">' +
          '<option value="0">安装方式：弹向导（默认，自己点下一步）</option>' +
          '<option value="1">安装方式：静默装（不弹向导，装完自动重开）</option></select>' +
          '<button class="btn-primary" data-act="silentins-save">保存</button></div>' +
          '<p class="platnote">静默安装只在 Setup 装出来的目录生效（目录里有卸载程序）；免安装 zip 目录会自动拒绝并改回弹向导。</p>'
        : '') +
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
        return [['zh', '中文'], ['zh-hant', '繁體中文（介面）'], ['en', 'English（主要界面）']].map(function(o){
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
          [[4,'字幕位置：贴底（4%）'],[8,'字幕位置：标准（8%，默认）'],[12,'字幕位置：略高（12%）'],[18,'字幕位置：偏高（18%）'],[26,'字幕位置：很高（26%）']].map(function(o){
            return '<option value="' + o[0] + '"' + (String(ss.pos) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('') + '</select>';
      })() +
      '<button class="btn-primary" data-act="display-save">保存</button></div>' +
      '<p class="platnote">主题三选：深色 / 浅色 / 夜间（暖色遮罩，含视频整体生效）。语言覆盖导航、播放器控制与设置页标题，其余中文兜底（未做全量翻译，避免半吊子）。字幕字号与位置即时生效，只影响本机渲染的字幕层。响度均衡：通过本机音频压缩器拉平不同片源音量；若片源跨源受限导致被静音，会自动探测并回退为原音量，不强行接管。长辈模式自动放大到 130%。</p></div>' +
    (function(){
      /* 1.7.89 P2 面板：性能 / 无障碍 / 安全（台账 #161）。全部保存即生效，不需要重启。 */
      var c = khP2Cfg();
      function sel(id, label, opts, cur){
        return '<select id="' + id + '" aria-label="' + label + '">' + opts.map(function(o){
          return '<option value="' + o[0] + '"' + (String(cur) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select>';
      }
      var html = '<div class="sitebox"><h3>性能与网络</h3>' +
        '<p>并发与超时直接影响「多源同时探测」「海报批量加载」「接口轮询」的手感：并发越高越快，也越容易被源的限流盯上；超时过短会把慢源当成坏源。</p>' +
        '<div class="siteform">' +
          sel('p2NetConc', '并发请求数', [[2,'并发：2 路（省流）'],[4,'并发：4 路'],[6,'并发：6 路（默认）'],[8,'并发：8 路'],[12,'并发：12 路（激进）']], c.netConc) +
          sel('p2NetTimeout', '网络超时', [[10,'超时：10 秒'],[15,'超时：15 秒（默认）'],[20,'超时：20 秒'],[30,'超时：30 秒'],[60,'超时：60 秒（弱网）']], c.netTimeout) +
          sel('p2NetRetry', '失败重试', [[0,'不重试'],[1,'重试 1 次'],[2,'重试 2 次（默认）'],[3,'重试 3 次']], c.netRetry) +
        '</div>' +
        '<p class="platnote">只对 GET 与探测类请求重试；报错时会把每次尝试的原因一起给出（与更新换源同一套口径）。</p>' +
        '<div class="siteform" style="margin-top:10px">' +
          sel('p2LiveQuality', '直播默认清晰度', [['auto','直播清晰度：自动（默认）'],['hd','直播清晰度：优先高清'],['sd','直播清晰度：优先流畅（省流量）']], c.liveQuality) +
          sel('p2LiveAuto', '启动进直播', [[0,'启动：进首页（默认）'],[1,'启动：进上次看的直播']], c.liveAutoStart) +
          sel('p2CardDensity', '卡片密度', [['compact','卡片：紧凑（一屏更多）'],['std','卡片：标准（默认）'],['loose','卡片：宽松（大字/触屏）']], c.cardDensity) +
          '<button class="btn-primary" data-act="p2-save" data-grp="net">保存</button>' +
        '</div></div>' +
        '<div class="sitebox"><h3>无障碍 · 焦点与按键</h3>' +
        '<p>遥控 / 键盘操作时的可见性与按键归属：焦点框要够显眼，音量键要按你的意思落到应用或系统。</p>' +
        '<div class="siteform">' +
          sel('p2Focus', '焦点框颜色', [['theme','焦点框：跟随主题色（默认）'],['contrast','焦点框：高对比黄'],['white','焦点框：纯白'],['blue','焦点框：亮蓝']], c.focusRing) +
          sel('p2Vol', '音量键归属', [['app','音量键：调应用音量（默认）'],['system','音量键：交给系统（不接管）']], c.volKeys) +
        '</div>' +
        '<p class="platnote">焦点框即时生效；音量键归属对键盘 / 遥控的媒体键与 +/- 键生效，播放页内的滑杆始终调应用音量。</p>' +
        '<div class="siteform" style="margin-top:10px">' +
          sel('p2SubFont', '字幕字体', [['system','字幕字体：系统黑体（默认）'],['hei','字幕字体：雅黑'],['song','字幕字体：宋体'],['round','字幕字体：圆体']], c.subFont) +
          sel('p2SubStroke', '字幕描边', [['none','字幕描边：无'],['thin','字幕描边：细（默认）'],['thick','字幕描边：粗（亮背景）']], c.subStroke) +
          sel('p2SubPos', '字幕位置', [[4,'字幕位置：贴底（4%）'],[8,'字幕位置：标准（8%，默认）'],[12,'字幕位置：略高（12%）'],[18,'字幕位置：偏高（18%，避开控制条）'],[26,'字幕位置：很高（26%，看竖屏）']], c.subPos) +
          '<button class="btn-primary" data-act="p2-save" data-grp="a11y">保存</button>' +
        '</div>' +
        '<p class="platnote">字幕字体、描边、上下位置三者叠加即时生效；位置按画面高度百分比计算，窗口缩放后不会跑偏。</p></div>' +
        '<div class="sitebox"><h3>安全与权限</h3>' +
        '<p>三项默认口径：本机文件只在授权目录内可播；外发回调只允许 https 且域名必须在白名单里；配置写入带封条，被手改会回退默认而不是带着坏配置启动。</p>' +
        '<div style="margin-top:6px"><div style="font-weight:600;font-size:13px;margin-bottom:6px">已授权的本地目录（' + (c.localDirs || []).length + '）</div>' +
        ((c.localDirs || []).length
          ? (c.localDirs.map(function(d, i){
              return '<div class="sitetools" style="justify-content:space-between;gap:8px">' +
                '<span style="font-size:12px;word-break:break-all">' + esc(d) + '</span>' +
                '<button class="mini" data-act="p2-dir-del" data-i="' + i + '" title="移除授权">✕</button></div>';
            }).join(''))
          : '<p class="platnote">还没有授权目录，本机文件播放会被拒绝（这是安全默认）。点下面按钮选一个目录，只授权该目录及其子目录。</p>') +
        '<div class="sitetools"><button class="qbtn" data-act="p2-dir-pick">＋ 授权本地目录</button>' +
        '<span class="syncstat">仅桌面 Electron 版可选目录；设备端 / 浏览器不可用。</span></div></div>' +
        '<div style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--line)">' +
          '<div style="font-weight:600;font-size:13px;margin-bottom:6px">外发域名白名单（Webhook / 回调）</div>' +
          '<div class="siteform"><textarea id="p2HookHosts" class="u" rows="3" placeholder="一行一个，如 hooks.example.com 或 *.corp.example.com" aria-label="外发域名白名单">' +
            esc((c.webhookHosts || []).join('\n')) + '</textarea></div>' +
          '<p class="platnote">留空 = 全拒（安全默认）；本机回环（127.0.0.1 / localhost）始终允许。只允许 https，明文 http 需域名也在白名单里且非本机时才拒绝。</p>' +
        '</div>' +
        '<div class="siteform" style="margin-top:10px">' +
          '<select id="p2Harden" aria-label="配置存储硬化">' +
            '<option value="1"' + (c.storeHarden ? ' selected' : '') + '>配置封条：开（默认，被改即回退）</option>' +
            '<option value="0"' + (!c.storeHarden ? ' selected' : '') + '>配置封条：关（排障用，不推荐）</option>' +
          '</select>' +
          '<button class="btn-primary" data-act="p2-save" data-grp="sec">保存</button>' +
          '<button class="qbtn" data-act="p2-dmg-clear">清空损坏记录</button>' +
        '</div>' +
        (function(){
          var list = getStore('kh_store_damaged', []) || [];
          if (!list.length) return '<p class="platnote">配置完整性：未发现损坏记录。</p>';
          return '<p class="platnote">最近损坏（已自动回退默认）：' + list.slice(0, 3).map(function(r){
            return esc(String(r.k || '?')) + ' · ' + esc(String(r.at || '').replace('T', ' ').slice(0, 16)) + ' · ' + esc(String(r.reason || ''));
          }).join('；') + '</p>';
        })() +
        '</div>';
      return html;
    })() +
    (function(){
      /* 1.7.90 偏好面板：历史保留 / 续播 / 自动下一部 / 点击行为 / 搜索范围 / 动效（清单 #27 #28 #29 #43 #50 #51） */
      var p = khPref();
      function psel(id, label, opts, cur){
        return '<select id="' + id + '" aria-label="' + label + '">' + opts.map(function(o){
          return '<option value="' + o[0] + '"' + (String(cur) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select>';
      }
      return '<div class="sitebox"><h3>偏好与行为</h3>' +
        '<p>这一组决定「点下去之后发生什么」：历史留多久、播到一半进来续不续、放完接不接下一部、点卡片先看简介还是直接播。</p>' +
        '<div class="siteform">' +
          psel('prefHistCap', '历史保留条数', [[10,'历史：保留 10 条'],['20','历史：保留 20 条'],['30','历史：保留 30 条（默认）'],['50','历史：保留 50 条'],['100','历史：保留 100 条'],['200','历史：保留 200 条']], String(p.histCap)) +
          psel('prefHistDays', '历史保留天数', [[0,'天数：不按天清理（默认）'],[7,'天数：只留 7 天'],[30,'天数：只留 30 天'],[90,'天数：只留 90 天'],[365,'天数：只留 1 年']], String(p.histDays)) +
          psel('prefResume', '续播策略', [['ask','续播：进来先问（默认）'],['always','续播：直接跳到上次位置'],['never','续播：一律从头播']], p.resume) +
          psel('prefAutoNext', '自动下一部', [['0','放完就停（默认）'],['1','放完 5 秒后播同分类下一部']], String(p.autoNext)) +
          psel('prefOpen', '卡片点击行为', [['play','点卡片：直接播放（默认）'],['detail','点卡片：先展开简介，再点播放']], p.openMode) +
          psel('prefScope', '搜索范围', [['builtin','搜索：只搜内置片单（默认）'],['live','搜索：内置片单 + 直播频道'],['warehouse','搜索：内置片单 + 直播 + 影视仓站点']], p.searchScope) +
          psel('prefWhJoin', '仓站点并入', [['1','仓站点：并入分组与搜索（默认）'],['0','仓站点：只在「网站 · 影视仓站点」里看']], String(p.whJoin)) +
          psel('prefMotion', '界面动效', [['1','动效：开（默认）'],['0','动效：关（省电 / 少干扰）']], String(p.motion)) +
          psel('prefStall', '直播卡顿切源', [['2','卡顿 2 次就切下一路'],['3','卡顿 3 次切下一路（默认）'],['5','卡顿 5 次切下一路（弱网）']], String(Number(getStore('kh_stall_limit', 3)) || 3)) +
          psel('prefWatch', '起播超时', [['0','超时：跟设备档位（默认）'],['5000','起播 5 秒算超时'],['6500','起播 6.5 秒算超时'],['9000','起播 9 秒算超时（慢速源）']], String(Number(getStore('kh_watchdog_ms', 0)) || 0)) +
          '<button class="btn-primary" data-act="pref-save">保存</button>' +
        '</div>' +
        '<p class="platnote">历史按条数和天数双重清理：超出任一条就淘汰，删除只删本机记录，不影响收藏与进度。'
          + '「自动下一部」只在内置片单内找同分类下一部，跨仓片源不自动接。搜索范围里的「影视仓」只匹配仓内站点名/分类，不发远程片名请求。</p></div>';
    })() +
    (function(){
      /* 1.7.91 高级与本地能力（台账 #167 · 清单 #30 #31 #39 #40 #48 #52 #53 #68）
         需要主进程配合的项集中在这里；khB8 缺失（纯网页 / HAP）时相关控件标灰并注明不支持。 */
      var b8p = khPref();
      var hasB8 = !!(window.khB8 && typeof window.khB8.set === 'function');
      var dis = hasB8 ? '' : ' disabled aria-disabled="true"';
      var hkk = b8p.hotkeys || {};
      function psel(id, label, opts, cur){
        return '<select id="' + id + '" aria-label="' + label + '">' + opts.map(function(o){
          return '<option value="' + o[0] + '"' + (String(cur) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select>';
      }
      return '<div class="sitebox"><h3>高级与本地能力</h3>' +
        '<p>音轨语言、本机字幕、通知、快捷键、外部播放器、置顶与画中画、儿童模式。这里有几项要主进程配合，' +
        (hasB8 ? '当前桌面端全部可用。' : '<b>当前环境不支持本机能力</b>，只能改纯前端的项。') + '</p>' +
        '<div class="siteform">' +
          psel('prefAudio', '首选音轨语言', [['auto','音轨：跟随片源（默认）'],['zh','音轨：优先中文'],['en','音轨：优先英文'],['ja','音轨：优先日语'],['ko','音轨：优先韩语']], b8p.audioLang) +
          psel('prefSubAuto', '字幕自动加载', [['1','字幕：按片名自动挂同名字幕（默认）'],['0','字幕：不自动挂']], String(b8p.subAuto)) +
          '<input id="prefSubDir" class="u" type="text" placeholder="字幕文件夹，如 D:\\Subs" value="' + esc(b8p.subDir) + '" aria-label="字幕目录"' + dis + '>' +
          '<button class="mini" data-act="b8-pick-dir"' + dis + '>选字幕目录</button>' +
          psel('prefNotify', '系统通知', [['all','通知：全部开（默认）'],['download','通知：只留下载与更新'],['off','通知：全部关']], b8p.notify) +
          psel('prefNotifySound', '通知提示音', [['1','通知：带提示音（默认）'],['0','通知：静音弹窗']], String(b8p.notifySound)) +
          psel('prefTop', '窗口置顶', [['0','置顶：不置顶（默认）'],['1','置顶：窗口总在最前']], String(b8p.top)) +
          psel('prefClose', '关闭窗口行为', [['tray','关窗口：收进托盘继续跑（默认）'],['min','关窗口：最小化到任务栏'],['quit','关窗口：直接退出']], b8p.closeAct) +
          '<button class="mini" data-act="b8-pip"' + dis + '>画中画小窗</button>' +
          '<input id="prefPlayerExe" class="u" type="text" placeholder="外部播放器 exe，留空自动找 VLC / mpv" value="' + esc(b8p.playerExe) + '" aria-label="外部播放器路径"' + dis + '>' +
          '<button class="mini" data-act="b8-pick-exe"' + dis + '>选播放器</button>' +
          '<input id="prefPlayerArgs" class="u" type="text" placeholder="参数，用 {url} 代表片源，如 --fullscreen {url}" value="' + esc(b8p.playerArgs) + '" aria-label="外部播放器参数"' + dis + '>' +
          psel('prefKid', '儿童模式', [['0','儿童模式：关（默认）'],['1','儿童模式：只显示儿童 / 动画类']], String(b8p.kid)) +
          '<input id="prefKidPin" class="n" type="text" inputmode="numeric" maxlength="4" placeholder="PIN 4 位" value="' + esc(b8p.kidPin) + '" aria-label="儿童模式 PIN">' +
          '<input id="prefKidPinOld" class="n" type="text" inputmode="numeric" maxlength="4" placeholder="现有 PIN（关掉 / 换 PIN 必填）" value="" aria-label="现有家长 PIN">' +
          '<input id="prefKidMin" class="n" type="text" inputmode="numeric" maxlength="3" placeholder="时长上限（分钟，0 不限）" value="' + esc(String(b8p.kidMin || 0)) + '" aria-label="儿童模式时长上限">' +
          '<input id="prefHkToggle" class="n" type="text" placeholder="播放/暂停键，如 Ctrl+Alt+P" value="' + esc(hkk.toggle || '') + '" aria-label="快捷键 播放暂停"' + dis + '>' +
          '<input id="prefHkNext" class="n" type="text" placeholder="下一部键" value="' + esc(hkk.next || '') + '" aria-label="快捷键 下一部"' + dis + '>' +
          '<input id="prefHkPrev" class="n" type="text" placeholder="上一部键" value="' + esc(hkk.prev || '') + '" aria-label="快捷键 上一部"' + dis + '>' +
          '<input id="prefHkMute" class="n" type="text" placeholder="静音键" value="' + esc(hkk.mute || '') + '" aria-label="快捷键 静音"' + dis + '>' +
          '<input id="prefHkTop" class="n" type="text" placeholder="置顶切换键" value="' + esc(hkk.top || '') + '" aria-label="快捷键 置顶"' + dis + '>' +
          '<button class="btn-primary" data-act="b8-save">保存高级设置</button>' +
          '<button class="mini" data-act="b8-audit">配置体检</button>' +
          '<button class="mini" data-act="b8-fix">一键修复</button>' +
        '</div>' +
        '<div id="b8AuditOut" class="platnote">配置体检会检查：设置封条是否损坏、有哪些键缺失、历史是否超限、本机设置占用多少空间。</div>' +
        '<p class="platnote">快捷键留空就用默认媒体键；写法如 Ctrl+Alt+P，只认 Ctrl / Alt / Shift / Meta + 字母数字或 F1~F12。'
          + '儿童模式开启后首页只留儿童 / 动画类，搜索历史与运维入口隐藏；右下角常驻「家长解锁」，关掉或换 PIN 必须验原 PIN，连错 5 次锁 10 分钟。'
          + '字幕按片名匹配（忽略空格标点与 .zh / .en 语言后缀），SRT 会现场转成浏览器可读的 VTT。'
          + '关窗口行为只对桌面 Electron 版生效（收托盘 / 最小化 / 直接退出），纯网页与设备端不接管系统关窗。</p></div>';
    })() +
    (function(){
      /* 1.7.95 键盘快捷键一览 + 页面内固定键（台账 P2-B11）
         只列代码里真实绑定的键，不写「可能支持」；可改的那五个全局键在上一张卡片的输入框里改。 */
      var hk = getStore('kh_hotkeys', {});
      var acts = [
        ['toggle', '播放 / 暂停', '默认媒体键 ⏯（不填就是它）'],
        ['next', '下一部 / 下一个频道', '留空不注册'],
        ['prev', '上一部 / 上一个频道', '留空不注册'],
        ['mute', '静音切换', '留空不注册'],
        ['top', '窗口置顶切换', '留空不注册']
      ];
      var rows = acts.map(function(a){
        var v = String((hk && hk[a[0]]) || '');
        return '<tr><td>' + esc(a[1]) + '</td><td><b>' + (v ? esc(v) : esc(a[2])) + '</b></td></tr>';
      }).join('');
      var fixed = [
        ['/ ', '打开搜索（输入框外按下才生效）'],
        ['Esc', '关闭播放器 / 关闭弹层 / 取消确认'],
        ['Enter 或 空格', '打开当前聚焦的卡片（列表与推荐位通用）'],
        ['↑ ↓ ← →', '在卡片网格间移动焦点（TV / 遥控同一套逻辑）'],
        ['← 或 j / → 或 l', '播放器内快退 / 快进 10 秒'],
        ['播放器右键菜单', '↑ ↓ 选择 · Enter 执行 · Esc 关闭']
      ].map(function(f){ return '<tr><td><b>' + esc(f[0]) + '</b></td><td>' + esc(f[1]) + '</td></tr>'; }).join('');
      var trusted = (window.KHGUARD ? window.KHGUARD.trustList() : []);
      return '<div class="sitebox"><h3>键盘快捷键一览</h3>' +
        '<p>全局快捷键可改（上一张卡片的输入框，写法如 <b>Ctrl+Alt+P</b>，只认 Ctrl / Alt / Shift / Meta + 字母数字或 F1~F12）；' +
        '页面内固定键不可改，列在这里是为了不用猜。</p>' +
        '<table class="kbt"><tbody><tr><th style="width:40%">全局快捷键</th><th>当前设置</th></tr>' + rows + '</tbody></table>' +
        '<table class="kbt" style="margin-top:8px"><tbody><tr><th style="width:40%">页面内固定键</th><th>作用</th></tr>' + fixed + '</tbody></table>' +
        '<p class="platnote">被系统或别的软件占用时，保存后会提示「N 个快捷键被占用」，那些键不会生效，换一个即可。' +
        '托盘菜单里也有同一组动作，鼠标可替代键盘。</p>' +
        '<div class="platnote">平台入口域名守卫：不在官方清单的域名第一次点不会打开，会先报出真实 host，3 秒内再点一次才放行。' +
        '已信任的域名 <b>' + trusted.length + '</b> 个' + (trusted.length ? '（' + esc(trusted.join('、')) + '）' : '') +
        '<br><button class="mini" data-act="guard-clear">清空已信任域名</button></div></div>';
    })() +
    (function(){
      /* 1.7.95 电视与遥控（台账 P0-03）
         形态判定、焦点环、遥控返回/菜单键都在 kh-tv.js；这里只给手动开关与当前生效结果，避免两处逻辑打架。 */
      var api = window.KHTV || null;
      var m = api ? api.mode() : 'off';
      var on = api ? api.isTV() : false;
      var auto = api ? api.detect() : false;
      return '<div class="sitebox"><h3>电视与遥控</h3>' +
        '<p>电视上没有鼠标，只有方向键、OK 与返回。切到电视形态后界面字号放大一档，焦点环加粗，' +
        '遥控方向键在卡片网格间移动、OK 打开当前项、<b>返回键（Backspace）</b>逐层退回、' +
        '<b>菜单键（ContextMenu / Shift+F10）</b>唤出当前项右键菜单。</p>' +
        '<div class="siteform"><select id="tvMode" aria-label="电视形态">' +
          '<option value="auto"' + (m === 'auto' ? ' selected' : '') + '>自动判定（默认，无鼠标的大屏才开）</option>' +
          '<option value="on"' + (m === 'on' ? ' selected' : '') + '>强制开启（电脑上也能预览电视效果）</option>' +
          '<option value="off"' + (m === 'off' ? ' selected' : '') + '>关闭（始终按电脑桌面显示）</option>' +
        '</select><button class="btn-primary" data-act="tv-save">保存并立即生效</button></div>' +
        '<div id="tvOut" class="platnote">当前：<b>' + (on ? '电视形态' : '桌面形态') + '</b>' +
          ' · 模式 ' + esc(m) + ' · 自动判定结果 ' + (auto ? '像电视' : '像电脑') +
          '<br>方向键网格导航一直可用（电脑上也能用），只是电视形态下焦点更醒目。' +
          '设备端 HAP 与外接遥控同样走这套逻辑，不需要单独配置。</div></div>';
    })() +
    (function(){
      /* 1.7.95 设备码账号 / 云同步 / 跨端续播 / 手机遥控（台账 P1-01 P1-02 P1-03 P2-B09 P2-B10）
         诚实边界写进面板：没有密码也没有找回；只同步四类数据；自定义源 id 跨端对不上就是点不开。 */
      var acc = window.KHACCT || null;
      if (!acc) {
        return '<div class="sitebox"><h3>账号与云同步</h3>' +
          '<p>当前环境没有账号模块，同步与手机遥控都不可用。</p></div>';
      }
      var code = acc.localCode();
      var m = acc.meta();
      var hubU = acc.hub() || (typeof location !== 'undefined' ? String(location.origin || '') : '');
      var autoOn = Number(getStore('kh_acct_auto', 1)) === 1;
      var nk = acc.nick();
      var pair = acc.pairUrl('', code);
      var qr = '';
      if (pair && typeof khQrCanvas === 'function') {
        var qrR = khQrCanvas(pair, 220);
        if (qrR && qrR.ok) qr = '<img src="' + qrR.dataUrl + '" width="150" height="150" alt="手机遥控二维码" style="background:#fff;border-radius:8px;padding:6px">';
      }
      var counts = m && m.counts ? m.counts : { fav: 0, hist: 0, prog: 0 };
      return '<div class="sitebox"><h3>账号与云同步</h3>' +
        '<p>这里没有手机号、没有密码：<b>设备码就是账号</b>。换设备时把这枚码输进去，收藏 / 历史 / 片单 / 续播点就会合并过来。' +
        '码丢了就是丢了，找不回来——请自己抄一份。</p>' +
        '<div class="platnote">本机设备码 <b style="font:600 16px/1.4 ui-monospace,monospace;letter-spacing:1px;color:#FFD166">' +
          esc(code) + '</b>' +
          (m && m.at ? ' · 上次同步 ' + esc(String(m.at).replace('T', ' ').slice(0, 16)) : ' · 还没同步过') +
          ' · 云端应有 收藏 <b>' + counts.fav + '</b> / 历史 <b>' + counts.hist + '</b> / 续播 <b>' + counts.prog + '</b>' +
          '<br>中枢地址 <b>' + esc(hubU || '未配置（纯网页模式走同源）') + '</b> · 只同步四类数据，链接与本机路径不上云</div>' +
        '<div class="siteform">' +
          '<input id="acctNick" placeholder="昵称（可空，仅自己看）" value="' + esc(nk) + '" aria-label="账号昵称" style="max-width:200px">' +
          '<input id="acctCodeIn" placeholder="别人的设备码（可选，如 ABCD-EFGH）" aria-label="切换设备码" style="max-width:240px">' +
          '<button class="btn-primary" data-act="acct-save">保存昵称 / 换码登录</button>' +
          '<button class="mini" data-act="acct-sync">同步到云</button>' +
          '<button class="mini" data-act="acct-pull">从云拉回</button>' +
          '<select id="acctAuto" aria-label="自动同步">' +
            '<option value="1"' + (autoOn ? ' selected' : '') + '>自动同步：开（启动后静默同步一次）</option>' +
            '<option value="0"' + (!autoOn ? ' selected' : '') + '>自动同步：关</option>' +
          '</select>' +
          '<button class="mini" data-act="acct-auto-save">保存自动同步</button>' +
        '</div>' +
        '<div id="acctOut" class="platnote">' +
          '换码登录会先把对方的云端数据拉下来合并到本机，再把本机多的推上去——两边都不会被覆盖丢数据。' +
          '自定义网址与影视仓条目的 id 是各设备本地的，跨端只在「观看历史」里留个记录，点不开属于正常，不做假映射。</div>' +
        '<div class="sitebox" style="margin-top:12px;border-style:dashed"><h3 style="font-size:13px">手机遥控</h3>' +
          (qr ? '<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">' + qr +
            '<div class="platnote" style="flex:1;min-width:200px;margin:0">用手机相机扫这个码，打开遥控页；' +
            '也可以手输地址 <b>' + esc(pair) + '</b><br>' +
            '遥控页有：上一个 / 播放暂停 / 下一个 / 快退 10 秒 / 快进 10 秒 / 音量 ± / 返回。' +
            '<br>指令走中枢队列，<b>20 秒内有效</b>；桌面端每 2.5 秒取一次。中枢不可达时这里也不会有反应。</div></div>'
            : '<div class="platnote">中枢地址没配置（或二维码库没加载），暂时生成不了遥控二维码。' +
              '纯网页模式下请用同源地址访问 <b>/remote</b>。</div>') +
        '</div></div>';
    })() +
    (function(){
      /* 1.7.94 远端配置与云端（#69 默认值 / #70 灰度 / #71 锁定 / #77 公告 / #66 云同步 / #72 载体 / #75 跨进程）
         客户端只读：远端下发的东西在这里展示与手动刷新，改只在开发端「远端配置」。 */
      var rv = khRemoteView();
      var locks = khRemoteLockIds();
      var car = khStoreCarrierInfo();
      var sm = getStore('kh_sync_meta', null);
      var dev = khDeviceId();
      var nOn = Number(getStore('kh_remote_notice', 1)) === 1;
      var sOn = Number(getStore('kh_sync_on', 1)) === 1;
      var nShow = khRemoteNotice();
      var flagN = Object.keys(rv.flags || {}).length;
      var onN = Object.keys(rv.flags || {}).filter(function(k){ return rv.flags[k]; }).length;
      function psel2(id, label, opts, cur){
        return '<select id="' + id + '" aria-label="' + label + '">' + opts.map(function(o){
          return '<option value="' + o[0] + '"' + (String(cur) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select>';
      }
      return '<div class="sitebox"><h3>远端配置与云端</h3>' +
        '<p>公告位、锁定项、远端默认值、灰度开关由开发端「远端配置」统一下发；这里只读展示，改不了。' +
        '云同步只同步偏好（音轨 / 字幕 / 通知 / 置顶 / 儿童等），<b>片源地址、本机路径与口令一律不上云</b>。</p>' +
        '<div class="platnote">远端配置 rev <b>' + (rv.rev || 0) + '</b>'
          + (rv.at ? ' · ' + esc(String(rv.at).replace('T', ' ').slice(0, 16)) : ' · 还没拉到过（首次启动 10 秒后自动拉）')
          + ' · 锁定 <b>' + locks.length + '</b> 项 · 灰度开关 <b>' + onN + '/' + flagN + '</b> 开'
          + ' · 公告 ' + (nShow ? '<b style="color:#FFD166">正在展示</b>' : '无 / 已关') + '</div>' +
        '<div class="siteform">' +
          psel2('rNotice', '公告横幅', [['1','公告横幅：显示（默认）'],['0','公告横幅：不显示']], nOn ? '1' : '0') +
          psel2('rSync', '云同步', [['1','云同步：允许推拉偏好（默认）'],['0','云同步：完全关闭']], sOn ? '1' : '0') +
          '<button class="btn-primary" data-act="r-save">保存开关</button>' +
          '<button class="mini" data-act="r-refresh">刷新远端配置</button>' +
          '<button class="mini" data-act="r-push">偏好推上云</button>' +
          '<button class="mini" data-act="r-pull">从云拉回来</button>' +
        '</div>' +
        '<div id="rOut" class="platnote">' +
          (locks.length
            ? '已锁定：' + locks.map(function(k){ return '<b>' + esc(k) + '</b>'; }).join('、') + '（对应控件已置灰并打 🔒）'
            : '没有锁定项。') +
          '<br>本机设备 ID <b>' + esc(dev) + '</b>（开发端按设备做灰度时用这个号）' +
          (sm ? '<br>上次同步：' + esc(String(sm.at || '').replace('T', ' ').slice(0, 16)) + ' · '
            + (sm.dir === 'push' ? '推送' : '拉取') + ' ' + (sm.keys || 0) + ' 键 · ' + (sm.ok ? '成功' : '失败')
            + (sm.from ? ' · 来源 ' + esc(sm.from) : '') : '') +
        '</div>' +
        '<div class="platnote">存储载体：<b>' + esc(car.carrier) + '</b> · 设置键 <b>' + car.keys + '</b> 个 · 约 <b>'
          + Math.round(car.bytes / 1024) + '</b> KB · 封条 <b>' + car.sealed + '</b> 条 · 损坏记录 <b>' + car.damaged + '</b> 条'
          + (car.harden ? ' · 硬化开' : ' · 硬化关') + '。' + esc(car.note) + '。' +
          (window.khB8 ? ' 主进程配置（快捷键 / 播放器 / 关窗口）走 <b>userData/kh-b8.json</b>，与界面双写并在改动后互相刷新（跨进程一致）。'
            : ' 当前环境没有主进程，本机能力项不适用。') + '</div></div>';
    })() +
    (function(){
      /* 1.7.95 客户版自动升级（台账 P1-07 / P1-08）
         只认云端清单 + SHA256；四档策略；手动「立即检查」只下载不安装。
         纯网页 / HAP 没有主进程桥，这里如实显示不支持，不假装能升级。 */
      var hasAU = !!(window.khAutoUpdate && typeof window.khAutoUpdate.get === 'function');
      var modes = [['off', '关闭：不检查也不联网'], ['check', '只检查：发现新版只提示'],
                   ['download', '下载并提示：后台下好、校验完等你重启装（默认）'],
                   ['install', '自动安装：下好校验后静默覆盖并重启（仅 Setup 安装目录）']];
      if (!hasAU) {
        return '<div class="sitebox"><h3>自动升级</h3>' +
          '<p>当前环境没有主进程，无法自动升级。<b>纯网页与开鸿设备端</b>请用发布页手动更新。</p></div>';
      }
      var st = null;
      try { st = getStore('kh_au_view', null); } catch(e) { st = null; }
      var cur = (st && st.current) || (window.KH_VERSION_NAME || '') || '—';
      var mode = (st && st.state && st.state.mode) || 'download';
      var lastResult = (st && st.state && st.state.lastResult) || '';
      var lastCheck = (st && st.state && st.state.lastCheck) || '';
      var attempts = (st && st.state && Number(st.state.attempts)) || 0;
      return '<div class="sitebox"><h3>自动升级</h3>' +
        '<p>客户版只认云端清单（<b>remote-manifest.json</b>）与 <b>SHA256</b>：版本号高于本机才下载，' +
        '校验不符立即删包，<b>绝不装一个对不上的包</b>。免安装版目录只下载并提示，不执行静默覆盖。</p>' +
        '<div class="siteform">' +
          '<select id="auMode" aria-label="自动升级策略">' + modes.map(function(m){
            return '<option value="' + m[0] + '"' + (mode === m[0] ? ' selected' : '') + '>' + m[1] + '</option>';
          }).join('') + '</select>' +
          '<button class="btn-primary" data-act="au-save">保存升级策略</button>' +
          '<button class="mini" data-act="au-run">立即检查（只下载不安装）</button>' +
        '</div>' +
        '<div id="auOut" class="platnote">当前版本 <b>' + esc(cur) + '</b> · 策略 <b>' + esc(mode) + '</b>'
          + (lastCheck ? ' · 上次检查 ' + esc(String(lastCheck).replace('T', ' ').slice(0, 16)) : ' · 还没检查过（启动 3 分钟后自动检查）')
          + (lastResult ? '<br>上次结果：' + esc(lastResult) : '')
          + (attempts ? ' · 连续失败 <b>' + attempts + '</b> 次（按 1h / 6h / 24h 退避）' : '')
          + '<br>安装未生效时会自动停止静默安装，只保留提示，避免反复重启。</div></div>';
    })() +
    (function(){
      /* 1.7.94 统一配置中心（清单 #63）：38 个可配置项一张表，搜索 / 单键改 / 单组恢复默认。
         值域以 KH_CFG_REG 为准，行内控件只做「按类型写一个键」，具体生效仍由各自面板逻辑负责。 */
      var rows = khCfgRows(state.cfgQ);
      var groups = khCfgGroups(rows);
      var total = KH_CFG_REG.length;
      var html = '<div class="sitebox"><h3>配置总览（' + total + ' 项）</h3>' +
        '<p>所有可配置项集中在一处，按名称 / 键名 / 分组搜索。每个键只改自己那一行，' +
        '「恢复本组」把这一组的键写回默认值，不影响收藏、历史与片单。片源地址与凭证不在表内。</p>' +
        '<div class="siteform"><input id="cfgQ" class="w" type="text" placeholder="搜索：片名不对，搜「字幕 / 音量 / 儿童 / 通知 / kh_theme」试试" value="' + esc(state.cfgQ) + '" aria-label="搜索配置项">' +
        '<button class="mini" data-act="cfg-clear">清空搜索</button>' +
        '<button class="mini" data-act="cfg-reset-all">全部恢复默认</button></div>' +
        '<div class="platnote">当前筛选出 <b>' + rows.length + '</b> 项' + (state.cfgQ ? '（关键词「' + esc(state.cfgQ) + '」）' : '') +
          '；改动即时写本机并打封条，锁定项会提示已锁但不会阻止你写（锁定只在界面上置灰）。</div>';
      if (!rows.length) html += '<p class="platnote">没有匹配的配置项，换个词试试。</p>';
      groups.forEach(function(g){
        html += '<div style="margin-top:12px"><div class="section-head" style="margin:0 0 6px"><h2 style="font-size:14px">' + esc(g) + '</h2>' +
          '<button class="mini" data-act="cfg-reset" data-g="' + esc(g) + '">恢复本组默认</button></div>';
        rows.filter(function(r){ return r.g === g; }).forEach(function(r){
          var id = 'cfg_' + r.k;
          var ctl;
          if (r.t === 'bool') {
            ctl = '<select id="' + id + '" aria-label="' + esc(r.n) + '"><option value="1"' + (Number(khCfgVal(r)) ? ' selected' : '') + '>开</option>' +
              '<option value="0"' + (Number(khCfgVal(r)) ? '' : ' selected') + '>关</option></select>';
          } else if (r.t === 'num') {
            ctl = '<input id="' + id + '" class="n" type="number" step="any" value="' + esc(String(khCfgVal(r))) + '"' +
              (r.min != null ? ' min="' + r.min + '"' : '') + (r.max != null ? ' max="' + r.max + '"' : '') + ' aria-label="' + esc(r.n) + '">';
          } else {
            ctl = '<input id="' + id + '" class="u" type="text" value="' + esc(String(khCfgVal(r))) + '" aria-label="' + esc(r.n) + '">';
          }
          html += '<div class="siteitem"><div class="sitemeta" style="min-width:120px">' +
            '<div class="n">' + esc(r.n) + '<span class="builtin">' + esc(r.g) + '</span></div>' +
            '<div class="u"><code>' + esc(r.k) + '</code>' + (r.h ? ' · ' + esc(r.h) : '') + '</div></div>' +
            ctl + '<button class="mini" data-act="cfg-save" data-k="' + esc(r.k) + '">存</button>' +
            '<button class="mini" data-act="cfg-one-reset" data-k="' + esc(r.k) + '" title="该键恢复默认">↺</button></div>';
        });
        html += '</div>';
      });
      return html + '<div class="platnote">提示：这些键与各面板是同一份存储，改完回面板会看到同步后的值；' +
        '「年龄 / 音量 / 字幕位置」这类出现在两处的项，以最后一次写入为准。</div></div>';
    })() +
    (function(){
      /* 1.7.94 皮肤包（清单 #78）：外部主题目录 / 远端下载 / 粘贴导入，应用只覆盖调色板变量。 */
      var packs = khThemePacks();
      var cur = khThemeCur();
      var curPack = cur ? khThemeFind(cur) : null;
      var hasB8 = !!(window.khB8 && typeof window.khB8.themes === 'function');
      var rows = packs.map(function(p){
        var on = curPack && curPack.id === p.id;
        return '<div class="siteitem"><div class="siteico" style="background:' + esc(p.vars.bg || '#151331') + ';border:2px solid ' + esc(p.vars.brand || '#7C6BFF') + '"></div>' +
          '<div class="sitemeta"><div class="n">' + esc(p.name) + '<span class="builtin">' + (on ? '使用中' : esc(p.from || 'pack')) + '</span></div>' +
          '<div class="u">底色 ' + esc(p.vars.bg) + ' · 主色 ' + esc(p.vars.brand || p.vars.brand2 || '同文字色') + ' · 文字 ' + esc(p.vars.text) + '</div></div>' +
          '<button class="mini" data-act="theme-apply" data-id="' + esc(p.id) + '">' + (on ? '重新应用' : '应用') + '</button>' +
          (p.from === 'built' ? '' : '<button class="mini" data-act="theme-del" data-id="' + esc(p.id) + '" title="删除这个包">🗑</button>') +
          '</div>';
      }).join('');
      return '<div class="sitebox"><h3>皮肤包（外部主题）</h3>' +
        '<p>皮肤包只覆盖 8 个调色板变量（底 / 卡片 / 卡片次层 / 线 / 正文 / 次文字 / 主色 / 副主色），不改字号与布局。' +
        '可以从<b>主题目录</b>里的 JSON 文件、<b>远端地址</b>下载、或直接<b>粘贴</b> JSON 导入；颜色只认 #hex 与 rgb()/rgba()，' +
        '其它键与写法会被丢弃，防止主题文件塞进 URL 或表达式。</p>' +
        '<div class="platnote">当前：' + (curPack ? '<b>' + esc(curPack.name) + '</b>（' + esc(curPack.vars.bg) + '）' : '未使用皮肤包，跟随内置皮肤') +
          ' · 已装 <b>' + packs.length + '/' + (window.KHTHEME ? window.KHTHEME.PACK_CAP : 8) + '</b> 个</div>' +
        '<div class="sitelist" style="margin-top:10px">' + (rows || '<p class="platnote">还没有皮肤包。</p>') + '</div>' +
        '<div class="siteform" style="margin-top:10px">' +
          '<input id="themeUrl" class="w" type="text" placeholder="远端 themes.json 地址（https://…/themes.json）" aria-label="皮肤包下载地址">' +
          '<button class="mini" data-act="theme-url">下载并安装</button>' +
          '<button class="mini" data-act="theme-dir"' + (hasB8 ? '' : ' disabled aria-disabled="true" title="当前环境没有主进程，读不了本机目录"') + '>从主题目录导入</button>' +
          '<button class="mini" data-act="theme-clear">回到内置皮肤</button>' +
        '</div>' +
        '<textarea id="themeJson" class="w" rows="4" style="margin-top:10px;width:100%;background:#0F111B;color:#E8EDF7;border:1px solid var(--line);border-radius:8px;padding:8px" ' +
          'placeholder="粘贴配色 JSON：{&quot;name&quot;:&quot;夜航&quot;,&quot;vars&quot;:{&quot;bg&quot;:&quot;#02030A&quot;,&quot;text&quot;:&quot;#E8EDF7&quot;,&quot;brand&quot;:&quot;#5AC8FA&quot;}}（也支持 {&quot;themes&quot;:[…]} 批量）" aria-label="粘贴皮肤包 JSON"></textarea>' +
        '<div class="siteform" style="margin-top:8px"><button class="btn-primary" data-act="theme-paste">粘贴导入</button>' +
        '<button class="mini" data-act="theme-sample">填入示例</button></div>' +
        '<div id="themeOut" class="platnote">主题目录导入只读目录里的 *.json（每个 ≤64KB）；装进来的包可随时删除，内置三个样例不可删。</div></div>';
    })() +
    (function(){
      /* 1.7.94 二维码 / 短链分享（清单 #65）：本地编码二维码，中枢可用时同时换短链。 */
      var list = khShareList();
      var rows = list.slice(0, 6).map(function(s){
        return '<div class="siteitem"><div class="siteico" style="background:#17324F">🔗</div>' +
          '<div class="sitemeta"><div class="n">' + esc(s.title || '分享') + '<span class="builtin">' + (s.code ? '短链 ' + esc(s.code) : '应用内') + '</span></div>' +
          '<div class="u">' + esc(String(s.short || s.url || '').slice(0, 120)) + '</div></div>' +
          '<button class="mini" data-act="share-copy" data-text="' + esc(s.short || s.url || '') + '">复制</button>' +
          '<button class="mini" data-act="share-qr" data-text="' + esc(s.short || s.url || '') + '" data-title="' + esc(s.title || '') + '">二维码</button></div>';
      }).join('');
      return '<div class="sitebox"><h3>二维码 / 短链分享</h3>' +
        '<p>把片名或站点发给别人：填 http(s) 链接时优先换成<b>中枢短链</b>（/s/短码，180 天有效），再画成本机二维码；' +
        '中枢不可达就退回原链接直编二维码，不依赖任何第三方在线接口。应用内分享（# 开头的路由）只在本机生成，不外跳。</p>' +
        '<div class="siteform">' +
          '<input id="shareTitle" class="n" type="text" placeholder="分享标题（可空）" maxlength="60" aria-label="分享标题">' +
          '<input id="shareUrl" class="w" type="url" placeholder="https://… 或留空分享应用首页（#/home）" maxlength="2000" aria-label="分享链接">' +
          '<button class="btn-primary" data-act="share-make">生成二维码</button>' +
        '</div>' +
        '<div id="qrBox" style="margin-top:10px">' + (state.shareQr ? state.shareQr : '<p class="platnote">还没有生成过分享码。</p>') + '</div>' +
        '<div class="sitelist" style="margin-top:10px">' + (rows || '<p class="platnote">最近分享会出现在这里（最多 20 条，只存本机）。</p>') + '</div></div>';
    })() +
    (function(){
      /* 1.7.94 家庭多档案（清单 #58）：各档案独立收藏 / 历史 / 进度 / 儿童设置 */
      var list = khProfList(), cur = khProfCur(), data = khProfData();
      var rows = list.map(function(p){
        var on = p.id === cur;
        var sm = (window.KHFAMILY ? window.KHFAMILY.summary(p, data[p.id] || {}) : {fav:0,hist:0,prog:0,kid:false});
        return '<div class="siteitem"><div class="siteico" style="background:' + esc(p.color) + '">' + esc(String(p.name).slice(0, 1)) + '</div>' +
          '<input id="profName_' + esc(p.id) + '" class="n" type="text" value="' + esc(p.name) + '" maxlength="12" aria-label="档案名">' +
          '<div class="sitemeta"><div class="n">' + (on ? '<span class="builtin">使用中</span>' : '<span class="builtin">待切换</span>') + '</div>' +
          '<div class="u">收藏 ' + sm.fav + ' · 历史 ' + sm.hist + ' · 进度 ' + sm.prog + ' 部 · 儿童 ' + (sm.kid ? '开' : '关') + '</div></div>' +
          '<button class="mini" data-act="prof-switch" data-id="' + esc(p.id) + '"' + (on ? ' disabled aria-disabled="true"' : '') + '>切换</button>' +
          '<button class="mini" data-act="prof-rename" data-id="' + esc(p.id) + '" title="把左边输入框里的名字存下来">改名</button>' +
          '<button class="mini" data-act="prof-del" data-id="' + esc(p.id) + '" title="删除（内容不合并）">🗑</button></div>';
      }).join('');
      var colors = (window.KHFAMILY ? window.KHFAMILY.COLORS : ['#5AC8FA']).map(function(c){
        return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
      }).join('');
      return '<div class="sitebox"><h3>家庭多档案（' + list.length + '/' + (window.KHFAMILY ? window.KHFAMILY.CAP : 4) + '）</h3>' +
        '<p>每个档案有<b>独立的收藏、稍后看、历史、播放进度、自建片单、直播收藏和儿童设置</b>；切档时当前档案的这些内容先存档，再换上新档案的，互不串台。' +
        '片源、平台入口、界面皮肤等公共设置所有档案共用。</p>' +
        '<div class="sitelist">' + rows + '</div>' +
        '<div class="siteform" style="margin-top:10px">' +
          '<input id="profName" class="n" type="text" placeholder="新档案名（最多 12 字）" maxlength="12" aria-label="新档案名">' +
          '<select id="profColor" aria-label="档案颜色">' + colors + '</select>' +
          '<button class="btn-primary" data-act="prof-add"' + (list.length >= (window.KHFAMILY ? window.KHFAMILY.CAP : 4) ? ' disabled aria-disabled="true"' : '') + '>新建并存档</button>' +
        '</div>' +
        '<div class="platnote">删除档案只删它那份内容，不会合并到别的档案；至少保留一个。改档案名点 ✎ 会就地弹窗输入。</div></div>';
    })() +
    (function(){
      /* 1.7.94 元数据与海报来源（清单 #59）+ 字幕站与 AI Key（清单 #60） */
      var src = khMetaSrc();
      var cache = khMetaCache();
      var cacheN = Object.keys(cache).length;
      var key = String(getStore('kh_tmdb_key', '') || '');
      var aiK = khAiKey(), aiB = khAiBase();
      var sites = khSubSites();
      var hasB8 = !!window.khB8;
      var op = [['builtin', '内置片单（不联网刮削，默认）'], ['tmdb', 'TMDB（需要 API Key）'], ['douban', '豆瓣（本应用不实现，见说明）'], ['custom', '自定义刮削地址（模板）']];
      return '<div class="sitebox"><h3>元数据与海报来源</h3>' +
        '<p>内置片单自带封面与简介，不需要刮削。要更全的海报 / 简介 / 评分，可以自己接一个来源：' +
        'TMDB 需要你申请 API Key；<b>豆瓣没有公开 API，抓网页违反其条款，本应用不实现</b>，请用自定义刮削地址（自建聚合接口）。' +
        '刮削只对你在设置里手动点的那一部发请求，不批量抓取、不后台扫库。</p>' +
        '<div class="siteform">' +
          '<select id="metaSrc" aria-label="元数据来源">' + op.map(function(o){ return '<option value="' + o[0] + '"' + (src === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
          '<input id="metaKey" class="u" type="text" placeholder="TMDB API Key（只存本机，不上云）" value="' + esc(key) + '" aria-label="TMDB Key">' +
          '<input id="metaTpl" class="w" type="text" placeholder="自定义刮削模板，如 https://你的接口/api?q={title}&y={year}" value="' + esc(String(getStore('kh_meta_custom','')||'')) + '" aria-label="自定义刮削地址">' +
          '<button class="btn-primary" data-act="meta-save">保存来源</button>' +
          '<button class="mini" data-act="meta-scrape">刮削当前选中的片</button>' +
          '<button class="mini" data-act="meta-clear">清空刮削缓存（' + cacheN + '）</button>' +
        '</div>' +
        '<div class="platnote">模板里的 <b>{title}</b> 会被片名替换、<b>{year}</b> 会替换成年份（都做了 URL 编码）；接口需要返回 JSON，' +
        '字段认 title / poster / overview / rating（TMDB 的 poster_path 会自动补成图片地址）。当前来源：<b>' +
        esc(window.KHMETA ? window.KHMETA.srcLabel(src) : src) + '</b>，已缓存 <b>' + cacheN + '</b> 部（上限 50）。</div>' +
        '<h3 style="margin-top:16px">字幕站</h3>' +
        '<p>自己常用字幕站（一次一行，只收 http(s)）：打开时走应用内 WebView，<b>不跳系统浏览器</b>。' +
        '字幕文件仍按片名在本机字幕目录里自动匹配，网站只用于手动下载。</p>' +
        '<textarea id="subSites" class="w" rows="3" style="width:100%;background:#0F111B;color:#E8EDF7;border:1px solid var(--line);border-radius:8px;padding:8px" ' +
          'placeholder="https://www.opensubtitles.org/zh/search/sublanguageid-chi/moviename-&#123;片名&#125;&#10;https://assrt.net/" aria-label="字幕站地址">' + esc(String(getStore('kh_sub_src','')||'')) + '</textarea>' +
        '<div class="siteform" style="margin-top:8px"><button class="mini" data-act="sub-sites-save">保存字幕站</button>' +
          sites.map(function(u, i){ return '<button class="mini" data-act="site-open" data-url="' + esc(u) + '">打开站点 ' + (i + 1) + '</button>'; }).join('') +
        '</div>' +
        (sites.length ? '<div class="platnote">已保存 ' + sites.length + ' 个：' + sites.map(function(u){ return esc(u); }).join('、') + '</div>'
          : '<div class="platnote">还没有保存字幕站。</div>') +
        '<h3 style="margin-top:16px">AI Key（字幕翻译 / 智能助手）</h3>' +
        '<p>填自己的模型服务 Key 与接口地址，用于字幕翻译与辅助诊断；<b>Key 只存本机</b>，不写进备份、不上云、不进日志，界面里只显示后 4 位。</p>' +
        '<div class="siteform">' +
          '<input id="aiKey" class="u" type="password" placeholder="API Key（' + (aiK ? esc(window.KHMETA ? window.KHMETA.keyMask(aiK) : '已保存') : '未设置') + '）" autocomplete="off" aria-label="AI Key">' +
          '<input id="aiBase" class="u" type="text" placeholder="接口地址，如 https://api.openai.com/v1" value="' + esc(aiB) + '" aria-label="AI 接口地址">' +
          '<button class="btn-primary" data-act="ai-save">保存 Key</button>' +
          '<button class="mini" data-act="ai-clear">清除 Key</button>' +
        '</div>' +
        '<div class="platnote">保存后「字幕翻译」入口会用它调你自己的服务；调用失败会在播放页给出原因（不静默退回原文）。' +
        '当前：' + (aiK ? '已配置 <b>' + esc(window.KHMETA ? window.KHMETA.keyMask(aiK) : '***') + '</b>' : '未配置（翻译入口不可用）') +
        (aiB ? ' · 接口 ' + esc(aiB) : '') + '</div>' +
        '<h3 style="margin-top:16px">网络族与自定义 DNS</h3>' +
        '<p>IPv4 / IPv6 与 DNS 偏好。桌面端会在下次启动时按这里的设置生效（IPv4-only 会带 --disable-ipv6），' +
        '自定义 DNS <b>只做记录与诊断</b>——Windows 的解析器由系统控制，客户端不会假称已经替你切换。</p>' +
        '<div class="siteform">' +
          '<select id="netMode" aria-label="网络族">' +
            [['auto','自动（跟随系统）'],['ipv4','只用 IPv4（重启生效）'],['ipv6','优先 IPv6']].map(function(o){ return '<option value="' + o[0] + '"' + (khIpMode() === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
          '</select>' +
          '<input id="netDns" class="u" type="text" placeholder="自定义 DNS（最多 3 个，如 8.8.8.8, dns.google）" value="' + esc(String(getStore('kh_dns','')||'')) + '" aria-label="自定义 DNS">' +
          '<button class="btn-primary" data-act="net-save">保存并推给主进程</button>' +
        '</div>' +
        '<div id="netOut" class="platnote">' + esc(window.KHMETA ? window.KHMETA.netNote(khIpMode(), khDnsList()) : '') +
          (hasB8 ? '' : '<br>当前环境没有主进程，网络族设置只记录在本机。') + '</div></div>';
    })() +
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
    if(KH_STORE){ html += khStoreAboutHtml(); } else {
    html += '<div style="padding:20px 18px;line-height:1.95;font-size:14px;max-width:780px">';    html += '<h2 style="margin:0 0 10px">关于「影视资源」</h2>';    html += '<p>本应用为本地自签名应用，内容由你自行提供，内置能力如下：</p>';    html += '<ul style="padding-left:20px;margin:8px 0">';    html += '<li><b>电视直播</b>：内置各大卫视与央视频道等公开 IPTV 直播源（m3u8），可直接观看；</li>';    html += '<li><b>自定义网址</b>：在「网址」页粘贴视频直链播放，或粘贴影视网站在应用内直接打开；</li>';    html += '<li><b>自建资源</b>：在「资源」页添加你自己的影视直链，「直播」页可添加 m3u8 频道或导入 M3U；</li>';    html += '<li><b>平台入口</b>：各视频平台官方网站，点击在应用内打开，内容版权归平台所有。</li>';    html += '</ul>';    html += '<p style="color:#FFB74D;margin-top:12px">所有内容版权归原作者 / 平台所有。本应用不托管、不破解、不聚合任何未授权片源；请仅使用你拥有合法授权的资源。</p>';    html += '<p style="opacity:.7;margin-top:6px">签名类型：本地自签名（release，无设备绑定），仅供学习与个人使用。</p>';
    html += '<h2 style="margin:22px 0 8px">隐私政策 · 用户协议 · 免责声明</h2>' +
      '<details style="margin:10px 0"><summary style="cursor:pointer;color:#4FA3E3">隐私政策（摘要）</summary>' +
      '<p>本应用是本机软件，不收集你的账号、身份或观看内容。播放记录、收藏、片源与问题记录只存本机，不上传；' +
      (KH_UI_CLEAN ? '' : '「问题中心 → 远程收集」默认开启：把脱敏的错误摘要（类别、错误码、次数、站点域名）随随机匿名设备 ID 上报到预置地址，不含账号、片源内容与完整 URL 参数，可随时关闭并清空。') +
      '软件更新时只访问你配置的更新服务地址与本机镜像站，不向第三方广告或统计服务发送数据。</p></details>' +
      '<details style="margin:10px 0"><summary style="cursor:pointer;color:#4FA3E3">用户协议（摘要）</summary>' +
      '<p>本应用仅提供播放能力与公开可访问资源的整理，不托管、不上传、不破解、不聚合任何未授权影视内容。' +
      '你应确保所添加的片源、直链、平台入口与直播源具备合法授权，并对自己的使用行为负责；' +
      '应用不预置任何样片；平台入口均指向第三方官方站点，商用前请替换为你已获授权的媒资。' +
      '禁止将本应用用于传播违法信息、绕过付费墙、批量抓取或任何侵犯他人权利的行为。</p></details>' +
      '<details style="margin:10px 0"><summary style="cursor:pointer;color:#4FA3E3">免责声明</summary>' +
      '<p>资源可用性取决于第三方服务，随时可能失效；本应用不保证任何片源长期可播，也不对第三方内容承担责任。' +
      '因网络环境、地区限制或平台策略导致的不可播，属正常现象，可通过「问题」页反馈并等待中枢自动换源。' +
      '本应用按「现状」提供，不对由此产生的间接损失负责。若你不同意上述条款，请停止使用并卸载。</p></details>' +
      '<details style="margin:10px 0"><summary style="cursor:pointer;color:#4FA3E3">侵权投诉与下线</summary>' +
      '<p>' + (typeof khAbuseLine === 'function' ? khAbuseLine() : '侵权投诉渠道：尚未配置（分发版必须填入真实可达邮箱）。') + '</p></details>';
    html += '</div>';
    }
  } else if(state.view === 'issues'){
    var _is = issueStats(), _ic = issueCfg(), _il = issueList(),
        _ist = srcHealthStat(), _im = srcMeta();
    html += '<div class="section-head"><h2>问题中心 · 自动收集</h2><span>本机记录 ' +
      _is.total + ' 条 / 近 24 小时 ' + _is.day + ' 次</span></div>' +
      '<div class="sitebox"><h3>运行期问题自动汇总</h3>' +
      '<p>' + (KH_UI_CLEAN
        ? '自动收集脚本异常、媒体资源失败、片源 / 平台不可达与网页加载错误码。同类问题 60 秒合并计数，最多保留 ' + ISSUE_MAX +
          ' 条。<b>匿名诊断上报默认开启</b>：只把脱敏摘要（类别、错误码、次数、站点域名）随随机匿名 ID 发回开发方用于修问题，' +
          '不含账号、片源内容与完整链接；点下方开关即可关闭，关闭后只存本机。'
        : '自动收集脚本异常、媒体资源失败、片源 / 平台不可达、云端清单与升级异常、系统兼容，' +
          '以及原生网页页的加载错误码（如 -310 / 403）。同类问题 60 秒内合并计数，最多保留 ' + ISSUE_MAX +
          ' 条，<b>只存本机、不上传</b>，不含账号与片源内容。点「复制诊断报告」即可把设备、版本、' +
          '源健康与问题明细粘贴给开发者；从网页页返回时会自动拉取那边的加载错误。') + '</p>' +
      '<div class="sitetools">' +
      '<button class="qbtn" data-act="issue-toggle">' + (_ic.auto ? '◉ 自动收集已开启' : '○ 自动收集已暂停') + '</button>' +
      (KH_UI_CLEAN ? '' : '<button class="qbtn" data-act="issue-check">⟳ 立即自检并拉取网页错误</button>') +
      (KH_UI_CLEAN ? '<button class="qbtn" data-act="issue-remote-toggle">' + (issueRemoteCfg().enabled ? '◉ 匿名诊断上报已开启（点按关闭）' : '○ 匿名诊断上报已关闭') + '</button>' : '') +
      '<button class="qbtn" data-act="issue-copy">📋 复制诊断报告</button>' +
      '<button class="qbtn" data-act="issue-export-txt">📄 导出报告 .txt</button>' +
      '<button class="qbtn" data-act="issue-export">📥 导出 JSON</button>' +
      '<button class="qbtn" data-act="issue-clear">🗑 清空记录</button>' +
      '</div>' +
      (state.issueConfirm ? '<div class="confirmbar">确定清空全部 ' + _is.total + ' 条问题记录？' +
        '<button class="btn-primary" data-act="issue-clear-yes">确定清空</button>' +
        '<button class="btn-ghost" data-act="issue-clear-no">再想想</button></div>' : '') +
      (KH_UI_CLEAN ? (function(){
        var _r = issueRemoteCfg(), _d = (typeof issueDaily === 'function' ? issueDaily() : {n:0});
        return '<p class="platnote">匿名上报：' +
          (_r.enabled ? '<b>已开启</b>' : '已关闭') +
          ' · 最近 ' + (_r.lastAt ? esc(new Date(_r.lastAt).toLocaleString('zh-CN', {hour12:false})) + ( _r.fails ? ' · <b style="color:#F5C542">失败（' + esc(_r.err) + '，第 ' + _r.fails + ' 次）</b>' : ' · 成功') : '尚未上报') +
          ' · 累计 ' + (_r.sent || 0) + ' 条 · 今日 ' + (_d.n || 0) + '/' + ISSUE_DAILY_MAX + '</p>';
      })() : '') +
      '<p class="platnote">设备：<b>' + esc(issueDevice()) + '</b> · 源清单 v' + (_im.v || 0) +
      ' · 可用线路 ' + _ist.good + ' / 降权 ' + _ist.bad + ' · 平台 ' + BUILTIN_SITES.length + ' 个</p>' +
      '</div>';
    /* 1.7.103：环境自检 + 播放诊断（两条都属于诊断工具，不进片单） */
/* 1.7.104：播放事件环形日志（设备端抓不到 hdc，这里是唯一带得走的现场） */
html += '<div class="section-head"><h2>最近播放事件</h2><span>近 60 条，含错误码与地址</span></div>' +
'<div class="sitebox"><h3>播不动时先看这里</h3>' +
'<p>每次播放失败会记一条：错误码、判定文案、当时地址、HLS 失败类型、看门狗次数、在线状态。同一原因 5 秒内只记一条。</p>' +
(typeof khPlayLogHtml === 'function' ? khPlayLogHtml() : '<p class="platnote">日志模块未加载</p>') +
'<div class="sitetools"><button class="qbtn" data-act="playlog-copy">📋 复制播放事件</button></div></div>';
html += '<div class="section-head"><h2>环境自检</h2><span>首次启动自动跑一次，也可以随时重跑</span></div>' +
'<div class="sitebox"><h3>本机能不能正常跑</h3>' +
'<p>检查本机存储能否写入、中枢 /health 是否可达；桌面端还会检查磁盘剩余、数据目录可写、端口是否耗尽、系统版本与 VC++ 运行库。</p>' +
(typeof khSelfCheckHtml === 'function' ? khSelfCheckHtml() : '<p class="platnote">自检模块未加载</p>') +
'<div class="sitetools"><button class="qbtn" data-act="selfcheck-run">⟳ 重新自检</button></div></div>';
html += '<div class="section-head"><h2>播放诊断 · 一键三条测试流</h2><span>不改片单，只在这里跑</span></div>' +
'<div class="sitebox"><h3>那个数字决定后面怎么修</h3>' +
'<p>依次试播三条公开测试流：H.264/mp4、HLS/m3u8、VP9/webm。每条只取元数据、不下载全片，最长等 12 秒。' +
'关键看 <b>video.error.code</b>：2 网络 / 3 解码 / 4 源不支持。若 VP9 能播而 H.264 不能，说明缺的是 H.264 解码器。</p>' +
'<div class="sitetools">' +
'<button class="qbtn" data-act="diag-run">▶ 开始诊断</button>' +
'<button class="qbtn" data-act="diag-copy">📋 复制诊断结果</button>' +
'</div>' +
(typeof khDiagHtml === 'function' ? khDiagHtml() : '<p class="platnote">诊断模块未加载</p>') + '</div>';
/* 远程收集：1.7.106 起客户版也渲染这块入口（此前 `if(!KH_UI_CLEAN)` 把整块挡掉，
   客户手上既没有地址也没有开关，实际上一条反馈都收不回来）。
   1.7.107 口径：地址预置 + 默认开启，点开关即停发（enabled=false 持久化）；
   没有预置地址时 url 为空、不会盲发。 */
{
 var _rc = issueRemoteCfg();
 var _cust = !!KH_UI_CLEAN;
 html += '<div class="section-head"><h2>远程收集</h2><span>' +
   (_rc.enabled ? '已开启' : '未启用 · 仅本地') + ' · 累计上报 ' + (_rc.sent || 0) + ' 条</span></div>' +
   '<div class="sitebox"><h3>问题摘要自动上报</h3>' +
   '<p>' + (_cust
     ? '<b>默认开启</b>：应用会把<b>脱敏后的错误摘要</b>（类别、错误码、消息、次数、发生页面、站点域名）' +
       '随随机匿名设备 ID 定时发回开发方，用于定位和修问题；不含账号、片源内容或完整 URL 参数。' +
       '不想上报就点上方「匿名诊断上报」开关关闭，关闭后只存本机。下面地址已预置，正常不用填。'
     : '<b>默认开启</b>：把<b>脱敏后的错误摘要</b>（类别、错误码、消息、次数、发生页面、站点域名）' +
       '随随机匿名设备 ID 定时上报到下面地址；不含账号、片源内容或完整 URL 参数，可随时关闭或清空。' +
       '可改成你自己的收集地址。真机走原生 HTTP，浏览器预览走网页通道。') + '</p>' +
   '<div class="siteform">' +
   '<input id="issueRemoteUrl" class="u" type="text" placeholder="https://你的收集服务/api/report" ' +
   'autocomplete="off" value="' + esc(_rc.url) + '">' +
   '<button class="btn-primary" data-act="issue-remote-save">保存地址</button>' +
   '</div><div class="sitetools">' +
   (_cust ? '' : '<button class="qbtn" data-act="issue-remote-toggle">' +
     (_rc.enabled ? '◉ 远程收集已开启' : '○ 远程收集已暂停') + '</button>') +
   '<button class="qbtn" data-act="issue-remote-send">↑ 立即上报</button>' +
   (_rc.url ? '<button class="qbtn" data-act="issue-remote-open">🌐 打开在线问题看板</button>' : '') +
   '</div><p class="platnote">状态：' +
   (_rc.lastAt ? '最近成功 ' + esc(new Date(_rc.lastAt).toLocaleString('zh-CN', {hour12:false})) : '尚未上报') +
   (window.KH_REMOTE_STATE && window.KH_REMOTE_STATE.via ? ' · 通道 ' + (window.KH_REMOTE_STATE.via === 'native' ? '原生' : '网页') + (window.KH_REMOTE_STATE.n ? ' · 本次 ' + window.KH_REMOTE_STATE.n + ' 条' : '') : '') +
   (_rc.err ? ' · <b style="color:#F5C542">上次失败：' + esc(_rc.err) + '（' + _rc.fails + ' 次）</b>' : '') +
   ' · 今日 ' + (issueDaily().n || 0) + '/' + ISSUE_DAILY_MAX +
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
  /* 1.7.95 繁体（P2-B15 简繁一档）：中文原文渲染完再统一转繁，只动文本与可读属性，不动输入值 */
  try{ if(window.KHHANT) window.KHHANT.apply(els.main); }catch(e){}
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
  /* 1.7.94：每次重绘后同步公告横幅与锁定项（远端配置可能在别处已刷新） */
  try{ khRemotePaint(); khRemoteLockPaint(); }catch(e){}
}



/* ---------------- 1.7.103 自检摘要（读 kh_selfcheck，不强依赖 kh-app 是否已加载） ---------------- */
function selfCheckBanner(){
  var r = getStore('kh_selfcheck', null);
  if(!r) return '';
  var probs = [];
  if(r.storage && r.storage.ok === false) probs.push('本机存储不可写（设置与片源都存不住）');
  var env = r.env || null;
  if(env){
    if(env.diskOk === false) probs.push('磁盘剩余不足');
    if(env.writeOk === false) probs.push('数据目录不可写');
    if(env.oldSystem) probs.push('系统版本偏旧');
    if(env.vcRuntime && env.vcRuntime.ok === false) probs.push('缺 VC++ 运行库：' + ((env.vcRuntime.missing || []).join(' / ') || '未列出'));
  }
  if(!probs.length) return '';
  return '<div class="confirmbar" style="margin:0 0 12px">环境自检发现 ' + probs.length + ' 项：' + esc(probs.join('；')) +
    ' <button class="btn-ghost" data-act="view" data-view="issues">查看详情</button></div>';
}
