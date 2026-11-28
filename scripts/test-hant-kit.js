/**
 * 鸿汇影 · 简繁显示层单测（1.7.95 / P2-B15 简繁一档）
 * 跑法：node scripts/test-hant-kit.js
 * 只测纯函数 toHant：不依赖 DOM、不读存储。
 */
'use strict';
const path = require('path');
const assert = require('assert');
const h = require(path.join(__dirname, '..', 'app', 'kh-hant.js'));

let n = 0;
function t(name, fn) { fn(); n++; }

/* ---- 基础 ---- */
t('空值与无中文原样返回', () => {
  assert.strictEqual(h.toHant(''), '');
  assert.strictEqual(h.toHant(null), '');
  assert.strictEqual(h.toHant('Home'), 'Home');
});
t('单字映射：设置 → 設置', () => assert.strictEqual(h.toHant('设置'), '設置'));
t('单字映射：关于 → 關於', () => assert.strictEqual(h.toHant('关于'), '關於'));
t('连续单字：观看历史 → 觀看歷史', () => assert.strictEqual(h.toHant('观看历史'), '觀看歷史'));
t('词组优先：视频 → 影片', () => assert.strictEqual(h.toHant('视频'), '影片'));
t('词组优先：网络 → 網路', () => assert.strictEqual(h.toHant('网络'), '網路'));
t('词组优先：平台 → 平臺', () => assert.strictEqual(h.toHant('平台'), '平臺'));
t('词组优先：默认 → 預設', () => assert.strictEqual(h.toHant('默认'), '預設'));
t('词组保护：只有 不被转成 隻', () => assert.strictEqual(h.toHant('只有'), '只有'));
t('词组保护：只是 不变', () => assert.strictEqual(h.toHant('只是'), '只是'));
t('单独「只」转 隻', () => assert.strictEqual(h.toHant('只'), '隻'));

/* ---- 英文/代码片段保留 ---- */
t('URL 保留原样（地址二字不在表内）', () => assert.strictEqual(h.toHant('URL 地址'), 'URL 地址'));
t('文件扩展名保留', () => assert.strictEqual(h.toHant('打开 file.json'), '打開 file.json'));
t('kh_ 键名保留', () => assert.strictEqual(h.toHant('键 kh_lang'), '鍵 kh_lang'));
t('单位保留', () => assert.strictEqual(h.toHant('大小 100 MB'), '大小 100 MB'));
t('HTTPS 保留', () => assert.strictEqual(h.toHant('仅 HTTPS'), '僅 HTTPS'));

/* ---- 混合与边界 ---- */
t('中英混排只转中文', () => assert.strictEqual(h.toHant('Wi-Fi 设置'), 'Wi-Fi 設置'));
t('标点不动', () => assert.strictEqual(h.toHant('设置 · 关于'), '設置 · 關於'));
t('数字不动', () => assert.strictEqual(h.toHant('第 3 项'), '第 3 項'));
t('长句里多处替换', () => {
  const out = h.toHant('播放失败请检查网络与设备');
  assert.ok(out.indexOf('網路') >= 0);
  assert.ok(out.indexOf('裝置') >= 0);
  assert.ok(out.indexOf('失敗') >= 0 || out.indexOf('播放失敗') >= 0);
});
t('重复调用幂等（已是繁体不再变）', () => {
  const once = h.toHant('设置');
  assert.strictEqual(h.toHant(once), once);
});

/* ---- 表结构 ---- */
t('映射表规模 200+', () => assert.ok(Object.keys(h.MAP).length > 200));
t('词组表规模 30+', () => assert.ok(Object.keys(h.PHRASE).length >= 30));
t('表里没有简繁同值的空转项', () => {
  Object.keys(h.MAP).forEach((k) => { assert.notStrictEqual(h.MAP[k], k, '键 ' + k + ' 值相同，属于空转应删'); });
});

console.log('简繁显示层：' + n + ' 项全部通过');
