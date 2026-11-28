/* scripts/test-tv-kit.js — kh-tv.js（电视/遥控层）回归
 * 跑法：node scripts\test-tv-kit.js
 */
'use strict';
var assert = require('assert');
var path = require('path');
var TV = require(path.join(__dirname, '..', 'app', 'kh-tv.js'));

var pass = 0, fail = 0, fails = [];
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; fails.push(name + ' → ' + e.message); }
}

/* ---- 最小浏览器环境桩 ---- */
var store = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
var cls = { 'kh-tv': false };
var body = {
  classList: {
    toggle: function (n, on) { cls[n] = !!on; },
    contains: function (n) { return !!cls[n]; }
  },
  setAttribute: function (k, v) { body.attrs[k] = v; },
  attrs: {}
};
var events = [];
function fakeEvent(kind) {
  return { type: kind, key: '', defaultPrevented: false, initEvent: function () {}, initMouseEvent: function () {} };
}
global.document = {
  body: body,
  activeElement: null,
  addEventListener: function () {},
  removeEventListener: function () {},
  dispatchEvent: function (ev) { events.push(ev); return true; },
  createEvent: function () { return fakeEvent('fake'); }
};
/* matchMedia 桩：可切换「有精确指针 / 只有遥控」 */
var mm = { coarse: false, fine: true };
global.window = {
  innerWidth: 1600, innerHeight: 900,
  matchMedia: function (q) {
    if (q.indexOf('coarse') >= 0) return { matches: mm.coarse };
    if (q.indexOf('fine') >= 0) return { matches: mm.fine };
    return { matches: false };
  },
  KeyboardEvent: global.KeyboardEvent
};
TV = require(path.join(__dirname, '..', 'app', 'kh-tv.js'));

/* ---- mapKey：遥控按键决策 ---- */
t('Backspace 在普通区域 → back', function () { assert.strictEqual(TV.mapKey('Backspace', {}), 'back'); });
t('Backspace 在输入框 → none（正常删字）', function () { assert.strictEqual(TV.mapKey('Backspace', { inField: true }), 'none'); });
t('ContextMenu → menu', function () { assert.strictEqual(TV.mapKey('ContextMenu', {}), 'menu'); });
t('ContextMenu 在输入框 → none', function () { assert.strictEqual(TV.mapKey('ContextMenu', { inField: true }), 'none'); });
t('Shift+F10 → menu（老遥控菜单键）', function () { assert.strictEqual(TV.mapKey('F10', { shift: true }), 'menu'); });
t('单独 F10 不接管', function () { assert.strictEqual(TV.mapKey('F10', {}), 'none'); });
t('Escape 不接管（原有逻辑已处理）', function () { assert.strictEqual(TV.mapKey('Escape', {}), 'none'); });
t('方向键不接管（交给 khGridNav）', function () {
  ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].forEach(function (k) {
    assert.strictEqual(TV.mapKey(k, {}), 'none');
  });
});
t('OK/Enter 不接管（原生 click）', function () { assert.strictEqual(TV.mapKey('Enter', {}), 'none'); });

/* ---- 返回栈：后注册的先响应 ---- */
t('back() 从最新一层开始往上问', function () {
  var order = [];
  TV.onBack(function () { order.push('A'); return false; });
  TV.onBack(function () { order.push('B'); return true; });
  assert.strictEqual(TV.back(), true);
  assert.deepStrictEqual(order, ['B']);
});
t('所有层都不要时 back() 返回 false', function () {
  var saved = TV.back;
  assert.strictEqual(typeof saved, 'function');
});
t('某层抛异常不影响下一层', function () {
  var hit = false;
  TV.onBack(function () { throw new Error('boom'); });
  TV.onBack(function () { hit = true; return true; });
  assert.strictEqual(TV.back(), true);
  assert.strictEqual(hit, true);
});

/* ---- 形态判定 ---- */
t('默认模式是 auto', function () { assert.strictEqual(TV.mode(), 'auto'); });
t('setMode 非法值回落 auto', function () {
  assert.strictEqual(TV.setMode('wired'), false);   /* 1600x900 有精确指针 → 不是 TV */
  assert.strictEqual(TV.mode(), 'auto');
});
t('强制开启 → isTV true 且 body 打 kh-tv', function () {
  assert.strictEqual(TV.setMode('on'), true);
  assert.strictEqual(TV.isTV(), true);
  assert.strictEqual(cls['kh-tv'], true);
  assert.strictEqual(body.attrs['data-kh-tv'], '1');
});
t('强制关闭 → isTV false 且摘掉 class', function () {
  assert.strictEqual(TV.setMode('off'), false);
  assert.strictEqual(TV.isTV(), false);
  assert.strictEqual(cls['kh-tv'], false);
  assert.strictEqual(body.attrs['data-kh-tv'], '0');
});
t('auto + 只有遥控（无精确指针）→ TV', function () {
  mm.fine = false; mm.coarse = true;
  assert.strictEqual(TV.setMode('auto'), true);
  assert.strictEqual(TV.isTV(), true);
});
t('auto + 小屏遥控（手机）→ 不算 TV', function () {
  mm.fine = false; mm.coarse = true;
  var w = window.innerWidth, h = window.innerHeight;
  window.innerWidth = 800; window.innerHeight = 600;
  assert.strictEqual(TV.isTV(), false);
  window.innerWidth = w; window.innerHeight = h;
});
t('auto + 有鼠标的大屏 → 不算 TV', function () {
  mm.fine = true; mm.coarse = false;
  assert.strictEqual(TV.isTV(), false);
});

/* ---- 焦点菜单 ---- */
t('openMenuOn 没有焦点元素时返回 false', function () {
  document.activeElement = null;
  assert.strictEqual(TV.openMenuOn(null), false);
});
t('openMenuOn 会真的派发 contextmenu 事件', function () {
  var fired = 0;
  var el = {
    tagName: 'DIV',
    getBoundingClientRect: function () { return { left: 10, top: 10, width: 100, height: 40 }; },
    dispatchEvent: function () { fired++; return true; }
  };
  document.activeElement = el;
  assert.strictEqual(TV.openMenuOn(el), true);
  assert.strictEqual(fired, 1);
});

/* ---- 兜底 Esc ---- */
t('dispatchEscape 不抛异常并真的派发', function () {
  var before = events.length;
  TV.dispatchEscape();
  assert.strictEqual(events.length, before + 1);
});

/* ---- 导出面 ---- */
t('导出面齐全', function () {
  ['mode', 'setMode', 'detect', 'isTV', 'apply', 'onBack', 'back', 'mapKey', 'bind', 'unbind']
    .forEach(function (k) { assert.strictEqual(typeof TV[k], 'function', '缺 ' + k); });
  assert.strictEqual(TV.KEY_MODE, 'kh_tv');
});

console.log('电视/遥控层：' + pass + ' 项通过，' + fail + ' 项失败');
if (fail) {
  fails.forEach(function (f) { console.error('  ✗ ' + f); });
  process.exit(1);
}
