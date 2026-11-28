/* kh-tv.js — 1.7.95 设备端 TV / 遥控焦点导航（台账 P0-03）
 *
 * 桌面端已经有方向键网格（kh-app.js 的 khGridNav）与播放器按键，缺的是「电视形态」这一层：
 *   1) 电视上没有鼠标，界面必须放大、焦点必须看得见；
 *   2) 遥控器发出的返回键不是 Esc，而是 Backspace（Android/Harmony 的 KEYCODE_BACK 会落到键盘事件）；
 *   3) 遥控器的「菜单键」要能唤出卡片右键菜单，而不是让用户去找鼠标。
 *
 * 本模块只做这三件事，不重复实现已有的方向键逻辑，也不碰播放器内部按键。
 */
(function (root) {
  var api = {};

  var KEY_MODE = 'kh_tv';        /* auto | on | off */
  var backStack = [];
  var bound = false;

  /* ---------- 形态判定 ---------- */

  function readMode() {
    try {
      var v = String(localStorage.getItem(KEY_MODE) || 'auto');
      return (v === 'on' || v === 'off' || v === 'auto') ? v : 'auto';
    } catch (e) { return 'auto'; }
  }

  /* 自动判定：没有精确指针（遥控 / 触屏）且屏幕够大 → 电视。
     浏览器给不了「这是电视」的可靠信号，所以只做保守推断，另外留手动开关。 */
  function detect() {
    var coarse = false, fine = true;
    try {
      coarse = !!window.matchMedia('(pointer: coarse)').matches;
      fine = !!window.matchMedia('(any-pointer: fine)').matches;
    } catch (e) {}
    var big = (window.innerWidth >= 1280 && window.innerHeight >= 640);
    if (!fine && big) return true;
    if (coarse && !fine && big) return true;
    return false;
  }

  function isTV() {
    var m = readMode();
    if (m === 'on') return true;
    if (m === 'off') return false;
    return detect();
  }

  function apply() {
    var on = isTV();
    var b = doc().body;
    if (b) {
      b.classList.toggle('kh-tv', !!on);
      try { b.setAttribute('data-kh-tv', on ? '1' : '0'); } catch (e) {}
    }
    return on;
  }

  function setMode(m) {
    if (m !== 'on' && m !== 'off' && m !== 'auto') m = 'auto';
    try { localStorage.setItem(KEY_MODE, m); } catch (e) {}
    return apply();
  }

  function doc() { return (typeof document !== 'undefined') ? document : null; }

  /* ---------- 返回键栈 ---------- */

  function onBack(fn) {
    if (typeof fn === 'function') backStack.push(fn);
    return api;
  }

  /* 依次问各层要不要「返回」，任意一层吃掉就停。返回 true 表示有人处理了。 */
  function back() {
    for (var i = backStack.length - 1; i >= 0; i--) {
      try { if (backStack[i]() === true) return true; } catch (e) {}
    }
    return false;
  }

  /* 把「返回」翻译成既有 Escape 语义，让各面板/弹层自己的 Esc 逻辑复用一遍 */
  function dispatchEscape() {
    var d = doc();
    if (!d) return false;
    var ev;
    try {
      ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
    } catch (e) {
      ev = d.createEvent('Event');
      ev.initEvent('keydown', true, true);
      ev.key = 'Escape';
    }
    d.dispatchEvent(ev);
    return !!(ev && ev.defaultPrevented);
  }

  /* ---------- 按键决策（纯函数，便于单测） ---------- */

  /* mapKey(key, { inField, menuOpen }) →
     'none' 不接管 | 'back' 返回上一级 | 'menu' 唤出右键菜单 | 'esc' 只派发 Esc */
  function mapKey(key, opt) {
    opt = opt || {};
    var inField = !!opt.inField;
    switch (key) {
      case 'Backspace':
        return inField ? 'none' : 'back';
      case 'Escape':
        return 'none';                    /* Esc 原本就有人处理，不重复接管 */
      case 'ContextMenu':
        return inField ? 'none' : 'menu';
      case 'F10':
        return (opt.shift && !inField) ? 'menu' : 'none';
      default:
        return 'none';
    }
  }

  function isField(el) {
    if (!el) return false;
    var tag = String(el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return !!el.isContentEditable;
  }

  /* 唤出当前焦点元素的右键菜单：复用 kh-app 已有的 contextmenu 处理 */
  function openMenuOn(el) {
    var d = doc();
    if (!d) return false;
    var t = el || d.activeElement;
    if (!t || t === d.body) return false;
    var r;
    try { r = t.getBoundingClientRect(); } catch (e) { return false; }
    if (!r || r.width < 2) return false;
    var ev;
    try {
      ev = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
      });
    } catch (e2) {
      ev = d.createEvent('MouseEvent');
      ev.initMouseEvent('contextmenu', true, true, window, 0, r.left, r.top, 0, 0, false, false, false, false, 2, null);
    }
    t.dispatchEvent(ev);
    return true;
  }

  function onKeydown(e) {
    if (!e || e.defaultPrevented) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var act = mapKey(e.key, { inField: isField(e.target), shift: e.shiftKey });
    if (act === 'none') return;
    if (act === 'back') {
      e.preventDefault();
      /* 先让页面自己返回；没人接手才退回「派发 Esc」兜底 */
      if (back()) return;
      dispatchEscape();
      return;
    }
    if (act === 'menu') {
      if (openMenuOn(e.target && e.target.closest ? e.target : null)) e.preventDefault();
    }
  }

  function bind() {
    var d = doc();
    if (!d || bound) return api;
    d.addEventListener('keydown', onKeydown, true);
    bound = true;
    return api;
  }

  function unbind() {
    var d = doc();
    if (!d || !bound) return api;
    d.removeEventListener('keydown', onKeydown, true);
    bound = false;
    return api;
  }

  api.mode = readMode;
  api.setMode = setMode;
  api.detect = detect;
  api.isTV = isTV;
  api.apply = apply;
  api.onBack = onBack;
  api.back = back;
  api.mapKey = mapKey;
  api.openMenuOn = openMenuOn;
  api.dispatchEscape = dispatchEscape;
  api.bind = bind;
  api.unbind = unbind;
  api.KEY_MODE = KEY_MODE;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KHTV = api;
})(typeof window !== 'undefined' ? window : globalThis);
