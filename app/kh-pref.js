/* 鸿汇影 · 偏好与行为纯逻辑（1.7.90 / 台账 #165 · 清单 #27 #28 #29 #43 #50 #51）
   这一层只做「给定输入算出结果」，不碰 DOM、不写存储，浏览器与 Node 同一份代码：
   - 默认值与非法值回落（界面读到的一定是合法值）
   - 历史按「条数 + 天数」双重裁剪
   - 续播策略三档：ask / always / never
   - 自动下一部的候选挑选（同系列优先，其次同分类）
   - 搜索范围：builtin / live / warehouse
   - 界面动效开关
   浏览器挂 window.KHPREF；Node 通过 module.exports 给 scripts/test-pref-kit.js 用。 */
(function(root, factory){
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KHPREF = api;
})(typeof window !== 'undefined' ? window : globalThis, function(){
  var DEF = {
    histCap: 30,
    histDays: 0,
    motion: 1,
    resume: 'ask',
    autoNext: 0,
    openMode: 'play',
    searchScope: 'builtin',
    whJoin: 1,
    /* 1.7.91（B 档）：音轨 / 字幕 / 通知 / 快捷键 / 外部播放器 / 置顶 / 儿童模式 */
    audioLang: 'auto',
    subAuto: 1,
    subDir: '',
    notify: 'all',
    notifySound: 1,
    playerExe: '',
    playerArgs: '',
    top: 0,
    kid: 0,
    kidPin: '',
    kidMin: 0,
    /* 1.7.93 #54：关闭窗口的行为 */
    closeAct: 'tray',
    hotkeys: { toggle: '', next: '', prev: '', mute: '', top: '' }
  };
  var RESUME_MODES = ['ask', 'always', 'never'];
  var OPEN_MODES = ['play', 'detail'];
  var SCOPES = ['builtin', 'live', 'warehouse'];
  var CAP_CHOICES = [10, 20, 30, 50, 100, 200];
  var DAYS_CHOICES = [0, 7, 30, 90, 365];
  var AUDIO_LANGS = ['auto', 'zh', 'en', 'ja', 'ko'];
  var NOTIFY_MODES = ['all', 'download', 'off'];
  var CLOSE_ACTS = ['tray', 'quit', 'min'];
  var HOTKEY_ACTIONS = ['toggle', 'next', 'prev', 'mute', 'top'];
  var LANG_ALIAS = {
    zh: ['zh', 'chi', 'zho', 'cmn', '中文', '国语', '普通话', '汉语'],
    en: ['en', 'eng', 'english', '英文', '英语'],
    ja: ['ja', 'jpn', 'japanese', '日语', '日本語'],
    ko: ['ko', 'kor', 'korean', '韩语', '한국']
  };

  function pickNum(v, d){
    var n = Number(v);
    return isFinite(n) ? n : d;
  }
  function pickEnum(v, list, d){
    var s = String(v === undefined || v === null ? '' : v);
    return list.indexOf(s) >= 0 ? s : d;
  }
  /* 规范化：界面/日志读到的永远是合法值，坏数据一律回默认，不抛异常 */
  function norm(raw){
    var r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    var hk = (r.hotkeys && typeof r.hotkeys === 'object') ? r.hotkeys : {};
    var out = {
      histCap: pickNum(r.histCap, DEF.histCap),
      histDays: pickNum(r.histDays, DEF.histDays),
      motion: (pickNum(r.motion, DEF.motion) ? 1 : 0),
      resume: pickEnum(r.resume, RESUME_MODES, DEF.resume),
      autoNext: (pickNum(r.autoNext, DEF.autoNext) ? 1 : 0),
      openMode: pickEnum(r.openMode, OPEN_MODES, DEF.openMode),
      searchScope: pickEnum(r.searchScope, SCOPES, DEF.searchScope),
      whJoin: (pickNum(r.whJoin, DEF.whJoin) ? 1 : 0),
      audioLang: pickEnum(r.audioLang, AUDIO_LANGS, DEF.audioLang),
      subAuto: (pickNum(r.subAuto, DEF.subAuto) ? 1 : 0),
      subDir: clampStr(r.subDir, 400),
      notify: pickEnum(r.notify, NOTIFY_MODES, DEF.notify),
      notifySound: (pickNum(r.notifySound, DEF.notifySound) ? 1 : 0),
      playerExe: clampStr(r.playerExe, 400),
      playerArgs: clampStr(r.playerArgs, 200),
      top: (pickNum(r.top, DEF.top) ? 1 : 0),
      kid: (pickNum(r.kid, DEF.kid) ? 1 : 0),
      kidPin: clampPin(r.kidPin),
      kidMin: Math.max(0, Math.min(240, pickNum(r.kidMin, DEF.kidMin))),
      closeAct: pickEnum(r.closeAct, CLOSE_ACTS, DEF.closeAct),
      hotkeys: {
        toggle: normHotkey(hk.toggle),
        next: normHotkey(hk.next),
        prev: normHotkey(hk.prev),
        mute: normHotkey(hk.mute),
        top: normHotkey(hk.top)
      }
    };
    if (out.histCap < 10) out.histCap = 10;
    if (out.histCap > 500) out.histCap = 500;
    if (out.histDays < 0) out.histDays = 0;
    if (out.histDays > 365) out.histDays = 365;
    return out;
  }
  function clampStr(v, max){
    var s = (v === undefined || v === null) ? '' : String(v);
    s = s.replace(/[\r\n\t]/g, ' ').trim();
    return s.length > max ? s.slice(0, max) : s;
  }
  function clampPin(v){
    var s = String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
    return s.slice(0, 4);
  }
  /* 历史裁剪：条数与天数任一超出即淘汰；没有时间戳的老记录按「未知」保留，不误删 */
  function trimHist(ids, atMap, cfg, now){
    var p = norm(cfg);
    var a = (atMap && typeof atMap === 'object') ? atMap : {};
    var t0 = isFinite(Number(now)) ? Number(now) : Date.now();
    var out = [];
    var list = Array.isArray(ids) ? ids : [];
    for (var i = 0; i < list.length; i++) {
      var id = list[i];
      if (typeof id !== 'string' || !id) continue;
      if (out.indexOf(id) >= 0) continue;
      if (p.histDays > 0) {
        var ts = Number(a[id] || 0);
        if (ts > 0 && t0 - ts > p.histDays * 86400000) continue;
      }
      out.push(id);
      if (out.length >= p.histCap) break;
    }
    return out;
  }
  /* 续播决策：
     never  → 不提示、不跳
     always → 直接跳（跳不动时由调用方退回先问）
     ask    → 先问
     另：进度太靠头（<5 秒）或离结尾 <3 秒都不值得提示；时长未知（Infinity/NaN）时按 ask 处理 */
  function resumePlan(saved, duration, mode){
    var m = pickEnum(mode, RESUME_MODES, DEF.resume);
    var s = Number(saved), d = Number(duration);
    if (m === 'never') return { show: false, seek: false, reason: 'mode-never' };
    if (!(s > 0) || s < 5) return { show: false, seek: false, reason: 'no-progress' };
    if (isFinite(d) && d > 0 && s > d - 3) return { show: false, seek: false, reason: 'near-end' };
    if (m === 'always') return { show: false, seek: true, reason: 'mode-always' };
    return { show: true, seek: false, reason: 'mode-ask' };
  }
  /* 自动下一部：同系列（片名主前缀相同）优先，年头早的在前；否则同分类第一部；不碰直播/自定义网址 */
  function pickNext(cur, pool){
    if (!cur || cur.live || cur.custom) return null;
    var list = (Array.isArray(pool) ? pool : []).filter(function(x){
      return x && !x.live && !x.custom && x.id !== cur.id;
    });
    var base = String(cur.title || '').replace(/[\s·\-—_（(].*$/, '').slice(0, 6);
    if (base.length >= 2) {
      var same = list.filter(function(x){ return String(x.title || '').indexOf(base) === 0; })
        .sort(function(a, b){ return (Number(a.year) || 0) - (Number(b.year) || 0); });
      if (same.length) return same[0];
    }
    var byCat = list.filter(function(x){ return x.category === cur.category; });
    return byCat.length ? byCat[0] : null;
  }
  /* 搜索范围：是否把该来源并进搜索结果 */
  function scopeHas(scope, kind){
    var s = pickEnum(scope, SCOPES, DEF.searchScope);
    if (kind === 'builtin') return true;                       // 内置片单永远搜
    if (kind === 'live') return s === 'live' || s === 'warehouse';
    if (kind === 'warehouse') return s === 'warehouse';
    return false;
  }
  /* 点击行为：第一次点击要不要先展开简介 */
  function needsArm(openMode, alreadyArmed){
    return pickEnum(openMode, OPEN_MODES, DEF.openMode) === 'detail' && !alreadyArmed;
  }
  function motionClass(on){
    return on ? '' : 'kh-no-motion';
  }
  function choices(){
    return { caps: CAP_CHOICES.slice(), days: DAYS_CHOICES.slice() };
  }

  /* ---------------- 1.7.91 B 档 ---------------- */

  /* 快捷键规范化：'ctrl+shift+p' → 'Ctrl+Shift+P'；只认 Electron accelerator 允许的组合。
     合法：修饰键 Ctrl/Alt/Shift/Meta 任意组合 + 主键（A-Z / 0-9 / F1-F12 / Space / Escape / MediaPlayPause 等）；
     非法（含中文、单修饰键无主键、未知键）一律返回 ''，让上层按"未设置"处理，绝不注册出错的加速键。 */
  var MOD_ALIAS = { ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift', meta: 'Meta', cmd: 'Meta', command: 'Meta', win: 'Meta', super: 'Meta' };
  function normHotkey(s){
    var raw = String(s === undefined || s === null ? '' : s).trim();
    if (!raw) return '';
    var parts = raw.split('+').map(function(x){ return x.trim(); }).filter(Boolean);
    if (!parts.length) return '';
    var mods = [], main = '';
    for (var i = 0; i < parts.length; i++) {
      var low = parts[i].toLowerCase();
      if (MOD_ALIAS[low]) { if (mods.indexOf(MOD_ALIAS[low]) < 0) mods.push(MOD_ALIAS[low]); }
      else main = parts[i];
    }
    if (!main) return '';
    var key = main;
    if (/^[a-z]$/.test(main.toLowerCase()) && main.length === 1) key = main.toUpperCase();
    else if (/^[0-9]$/.test(main)) key = main;
    else if (/^f[1-9]|^f1[0-2]/i.test(main) && /^f\d{1,2}$/i.test(main)) key = 'F' + main.slice(1);
    else {
      var named = { space: 'Space', escape: 'Escape', esc: 'Escape', enter: 'Return', tab: 'Tab', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
        home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', delete: 'Delete', backspace: 'Backspace',
        mediaplaypause: 'MediaPlayPause', medianext: 'MediaNextTrack', mediaprev: 'MediaPreviousTrack', volumeup: 'AudioVolumeUp', volumedown: 'AudioVolumeDown', mute: 'AudioVolumeMute' };
      var k2 = named[main.toLowerCase()];
      if (!k2) return '';
      key = k2;
    }
    return (mods.length ? mods.join('+') + '+' : '') + key;
  }
  /* 注册计划：过滤空值、去重（同一个键不能绑两个动作，先到先得），返回 [{action, accel}] */
  function hotkeyPlan(hk){
    var n = norm(hk || {}).hotkeys;
    var out = [], seen = {};
    for (var i = 0; i < HOTKEY_ACTIONS.length; i++) {
      var a = HOTKEY_ACTIONS[i], acc = n[a];
      if (!acc || seen[acc]) continue;
      seen[acc] = 1;
      out.push({ action: a, accel: acc });
    }
    return out;
  }

  /* 音轨选择：auto 不改（-1）；指定语言按 language 字段或名称别名匹配，命中返回数组下标，未命中 -1。
     tracks 兼容两种形态：[{lang,name}] 或 ['中文','English']。 */
  function pickAudioTrack(tracks, lang){
    var want = pickEnum(lang, AUDIO_LANGS, 'auto');
    if (want === 'auto') return -1;
    var list = Array.isArray(tracks) ? tracks : [];
    var aliases = LANG_ALIAS[want] || [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      var lg = String((t && typeof t === 'object') ? (t.lang || '') : t || '').toLowerCase();
      var nm = String((t && typeof t === 'object') ? (t.name || '') : '').toLowerCase();
      for (var j = 0; j < aliases.length; j++) {
        var a = aliases[j];
        if (lg === a || lg.indexOf(a) === 0 || nm.indexOf(a) >= 0) return i;
      }
    }
    return -1;
  }

  /* 字幕文件名规范化：取 basename、去扩展名、去常见语言后缀、小写、去空格与标点 */
  function subKey(name){
    var s = String(name === undefined || name === null ? '' : name).split(/[\\/]/).pop();
    s = s.replace(/\.(srt|ass|ssa|vtt|sub)$/i, '');
    s = s.replace(/\.(zh|chs|cht|chi|eng|en|ja|jp|ko|kor|sc|tc)$/i, '');
    return s.toLowerCase().replace(/[\s._\-—·()[\]【】]/g, '');
  }
  /* 字幕匹配：按影片标题找同名字幕；完全同名优先，其次包含关系，中文语言后缀优先。
     files 兼容 ['a.zh.srt'] 或 [{name:'a.zh.srt'}]，返回原始文件名（无匹配返回 ''）。 */
  function pickSubtitle(files, title){
    var t = subKey(title);
    if (!t) return '';
    var list = Array.isArray(files) ? files : [];
    var best = '', bestRank = 99;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var name = String((f && typeof f === 'object') ? (f.name || f.file || '') : f || '');
      if (!name) continue;
      var k = subKey(name);
      if (!k) continue;
      var rank = 99;
      if (k === t) rank = 0;
      else if (k.indexOf(t) === 0) rank = 1;
      else if (k.indexOf(t) >= 0) rank = 2;
      if (rank === 99) continue;
      var stem = name.replace(/\.(srt|ass|ssa|vtt|sub)$/i, '');
      var zh = /\.(zh|chs|cht|chi|sc|tc)$/i.test(stem) ? 0 : (/\.(en|eng)$/i.test(stem) ? 2 : 1);
      var score = rank * 10 + zh;
      if (score < bestRank) { best = name; bestRank = score; }
    }
    return best;
  }

  /* SRT → WebVTT：把 00:00:01,000 的逗号换成点，补 WEBVTT 头；已是 vtt 原样返回 */
  function srtToVtt(text){
    var t = String(text === undefined || text === null ? '' : text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (/^WEBVTT/.test(t)) return t;
    t = t.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return 'WEBVTT\n\n' + t.trim() + '\n';
  }

  /* 通知策略：all 全放；download 只放下载与更新；off 全关 */
  function notifyAllow(policy, kind){
    var p = pickEnum(policy, NOTIFY_MODES, DEF.notify);
    if (p === 'off') return false;
    if (p === 'all') return true;
    return kind === 'download' || kind === 'update';
  }

  /* 儿童模式：关着就全放；开着只放命中儿童关键词的分类或标签 */
  var KID_WORDS = ['儿童', '少儿', '动画', '亲子', '动漫', 'family', 'kids', 'cartoon'];
  function kidAllows(kidOn, item){
    if (!pickNum(kidOn, 0)) return true;
    if (!item || typeof item !== 'object') return false;
    var hay = String(item.category || '') + ' ' + String(item.group || '') + ' ' + ((item.tags && item.tags.length) ? item.tags.join(' ') : '');
    hay = hay.toLowerCase();
    for (var i = 0; i < KID_WORDS.length; i++) { if (hay.indexOf(KID_WORDS[i]) >= 0) return true; }
    return false;
  }

  /* 外部播放器参数：模板里 {url} 替换成直链；支持成对引号包住的参数。空模板返回空数组。 */
  function argsBuild(tpl, url){
    var s = String(tpl === undefined || tpl === null ? '' : tpl).trim();
    if (!s) return [];
    var toks = s.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    var out = [];
    for (var i = 0; i < toks.length; i++) {
      var x = toks[i].replace(/^["']|["']$/g, '');
      out.push(x.split('{url}').join(String(url || '')));
    }
    return out;
  }

  /* 配置体检：给定现状统计，输出分值与可执行的修复建议（不做修复动作，只出结论） */
  function audit(stats){
    var s = (stats && typeof stats === 'object') ? stats : {};
    var items = [], score = 100;
    function add(level, code, text, fix) {
      items.push({ level: level, code: code, text: text, fix: fix || '' });
      score -= (level === 'err' ? 20 : level === 'warn' ? 8 : 2);
    }
    var damaged = Number(s.damaged || 0);
    var histLen = Number(s.histLen || 0);
    var cap = Number(s.cap || DEF.histCap);
    var missing = Array.isArray(s.missing) ? s.missing : [];
    var unknown = Number(s.unknown || 0);
    var bytes = Number(s.bytes || 0);
    if (damaged > 0) add('err', 'seal', '有 ' + damaged + ' 个设置被判定损坏（封条与内容不符）', 'dmg-clear');
    if (missing.length) add('warn', 'missing', '缺 ' + missing.length + ' 个设置键：' + missing.slice(0, 6).join('、'), 'defaults');
    if (histLen > cap) add('warn', 'hist', '观看历史 ' + histLen + ' 条，超出上限 ' + cap + ' 条', 'trim');
    if (unknown > 0) add('info', 'unknown', '有 ' + unknown + ' 个无法识别的 kh_ 键（可能是旧版本残留）', 'drop');
    if (bytes > 3 * 1024 * 1024) add('warn', 'quota', '本机设置占用 ' + (bytes / 1048576).toFixed(2) + ' MB，接近常见 5 MB 上限', '');
    if (score < 0) score = 0;
    return { score: score, items: items, ok: items.length === 0 };
  }

  return {
    DEF: DEF, RESUME_MODES: RESUME_MODES, OPEN_MODES: OPEN_MODES, SCOPES: SCOPES,
    CAP_CHOICES: CAP_CHOICES, DAYS_CHOICES: DAYS_CHOICES,
    AUDIO_LANGS: AUDIO_LANGS, NOTIFY_MODES: NOTIFY_MODES, HOTKEY_ACTIONS: HOTKEY_ACTIONS,
    CLOSE_ACTS: CLOSE_ACTS,
    norm: norm, trimHist: trimHist, resumePlan: resumePlan, pickNext: pickNext,
    scopeHas: scopeHas, needsArm: needsArm, motionClass: motionClass, choices: choices,
    normHotkey: normHotkey, hotkeyPlan: hotkeyPlan, pickAudioTrack: pickAudioTrack,
    subKey: subKey, pickSubtitle: pickSubtitle, srtToVtt: srtToVtt,
    notifyAllow: notifyAllow, kidAllows: kidAllows, argsBuild: argsBuild, audit: audit
  };
});
