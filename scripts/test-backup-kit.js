#!/usr/bin/env node
/* 备份包工具自测（台账 #160 · 1.7.88）
   只测 app/kh-backup.js 的纯逻辑：加密/解密往返、错密码、篡改检测、差异预览、快照轮转、
   自动备份到期判定、base64 往返。不碰真实产物、不写仓库文件，全部在内存里跑。
   用法：node scripts/test-backup-kit.js  → 末行给出通过/失败计数，退出码即结果。 */
'use strict';

const path = require('path');
const cryptoMod = require('crypto');

/* Node 18 起 globalThis.crypto 已存在，但为兼容老运行时统一注入 webcrypto */
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  try { globalThis.crypto = cryptoMod.webcrypto; } catch (e) { /* 老版本没有 webcrypto */ }
}

const KHBak = require(path.join(__dirname, '..', 'app', 'kh-backup.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \u2714 ' + name); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  \u2716 ' + name + (detail ? ' — ' + detail : '')); }
}

function sampleData() {
  return {
    fav: ['tt001', 'tt002', 'tt003'],
    watchlater: ['tt004'],
    history: ['tt001', 'tt005', 'tt006', 'tt007'],
    watchsub: ['tt002'],
    progress: { tt001: { t: 1200, d: 5400 }, tt002: { t: 30, d: 2700 } },
    sites: [{ name: '自建站', url: 'https://example.com/api' }],
    warehouses: { list: [{ key: 'w1' }, { key: 'w2' }] },
    warehouseSites: { w1: [{ key: 's1' }] },
    live: [{ name: '自建台', url: 'https://live.example.com/a.m3u8' }],
    livefav: ['cctv1'],
    scene: { id: 'long' },
    remote: null,
    settings: { kh_theme: 'dark', kh_font_scale: 115, kh_sleep_min: 60 }
  };
}

async function main() {
  console.log('\n[1] 明文包与识别');
  const d = sampleData();
  const plain = KHBak.pack(d, { version: '1.7.88', at: '2026-11-24T02:00:00.000Z' });
  ok('明文包格式标记', plain.format === KHBak.FORMAT && plain.v === 2);
  ok('明文包保留数据', plain.fav.length === 3 && plain.settings.kh_theme === 'dark');
  ok('明文包不是加密包', KHBak.isEncrypted(plain) === false);
  const c1 = KHBak.counts(d);
  ok('计数：收藏 3 / 历史 4 / 进度 2', c1.fav === 3 && c1.history === 4 && c1.progress === 2, JSON.stringify(c1));

  console.log('\n[2] base64 往返（含中文与代理对）');
  const txt = '鸿汇影备份 · 🎬 emoji · "引号" \\反斜杠\n换行';
  const b = KHBak.b64FromBytes(KHBak.utf8Bytes(txt));
  const back = KHBak.utf8Text(KHBak.bytesFromB64(b));
  ok('base64 往返一致', back === txt, back.slice(0, 20));
  ok('base64 与 Node 的实现一致', b === Buffer.from(txt, 'utf8').toString('base64'));

  console.log('\n[3] 加密导出 → 解密还原');
  const enc = await KHBak.encrypt(d, 'honghub-2026', { version: '1.7.88' });
  ok('加密包格式', enc.format === KHBak.ENC_FORMAT && KHBak.isEncrypted(enc) === true);
  ok('KDF 参数可读', enc.kdf.iter === KHBak.ITER && enc.kdf.salt.length > 10 && enc.kdf.name === 'PBKDF2-SHA256');
  ok('加密体不含明文键名', JSON.stringify(enc).indexOf('kh_theme') === -1);
  const dec = await KHBak.decrypt(enc, 'honghub-2026');
  ok('解密还原收藏', JSON.stringify(dec.fav) === JSON.stringify(d.fav));
  ok('解密还原进度与设置', dec.progress.tt002.t === 30 && dec.settings.kh_font_scale === 115);
  ok('解密后是 v2 明文包', dec.format === KHBak.FORMAT && dec.v === 2);

  console.log('\n[4] 错误口令 / 篡改 / 边界');
  let wrong = null;
  try { await KHBak.decrypt(enc, 'wrong-pass'); } catch (e) { wrong = e; }
  ok('错密码被拒绝', !!wrong && /密码不对/.test(wrong.message), wrong && wrong.message);

  const tampered = JSON.parse(JSON.stringify(enc));
  /* 改密文中间一段 → GCM 校验必须失败 */
  const mid = Math.floor(tampered.payload.length / 2);
  const ch = tampered.payload[mid] === 'A' ? 'B' : 'A';
  tampered.payload = tampered.payload.slice(0, mid) + ch + tampered.payload.slice(mid + 1);
  let tam = null;
  try { await KHBak.decrypt(tampered, 'honghub-2026'); } catch (e) { tam = e; }
  ok('篡改密文被识别', !!tam && /密码不对或备份已损坏/.test(tam.message), tam && tam.message);

  let short = null;
  try { await KHBak.encrypt(d, '123'); } catch (e) { short = e; }
  ok('密码过短被拒绝', !!short && /至少 6 位/.test(short.message));

  const salt2 = await KHBak.encrypt(d, 'honghub-2026');
  ok('同一份数据两次导出盐不同', salt2.kdf.salt !== enc.kdf.salt && salt2.payload !== enc.payload);
  const dec2 = await KHBak.decrypt(salt2, 'honghub-2026');
  ok('第二次导出同样能解开', dec2.fav.length === 3);

  console.log('\n[5] 导入差异预览');
  const cur = {
    fav: ['tt001', 'tt002'], watchlater: [], history: ['tt005'], watchsub: [], progress: { tt001: { t: 10 } },
    sites: [], live: [], livefav: [], settings: { kh_theme: 'dark' },
    warehouses: null, warehouseSites: null, live_extra: null
  };
  const diff = KHBak.diff(d, cur);
  const row = (k) => diff.rows.filter((r) => r.key === k)[0] || {};
  ok('收藏：本机 2 / 备份 3 / 新增 1 / 重复 2', row('fav').cur === 2 && row('fav').inc === 3 && row('fav').add === 1 && row('fav').same === 2, JSON.stringify(row('fav')));
  ok('历史：新增 2（tt001/tt006/tt007 中 tt005 已存在）', row('history').add === 3 && row('history').same === 1, JSON.stringify(row('history')));
  ok('进度：新增 1 覆盖 1', row('progress').add === 1 && row('progress').same === 1, JSON.stringify(row('progress')));
  ok('影视仓：本机没有 → 新增', row('warehouses').add === 1 && row('warehouses').cur === 0);
  ok('设置：新增 2（kh_theme 相同算重复）', row('settings').add === 2 && row('settings').same === 1, JSON.stringify(row('settings')));
  ok('差异行覆盖 7 数组 + 进度 + 设置 + 6 配置', diff.rows.length === 15, 'rows=' + diff.rows.length);
  ok('空备份不炸', KHBak.diff({}, {}).rows.length === 15);

  console.log('\n[6] 快照轮转');
  let list = [];
  for (let i = 1; i <= 7; i++) list = KHBak.snapPush(list, { at: '2026-11-2' + i + 'T00:00:00Z', reason: 'export', n: i }, 5);
  ok('只保留最近 5 版', list.length === 5, 'len=' + list.length);
  ok('最旧的两版被挤掉', list[0].n === 3 && list[4].n === 7);
  ok('轮转不改入参', (function () { const src = [{ n: 1 }]; KHBak.snapPush(src, { n: 2 }, 5); return src.length === 1; })());
  ok('keep 非法值回落到默认 5（不丢数据）', KHBak.snapPush([{ n: 1 }], { n: 2 }, 0).length === 2);

  console.log('\n[7] 自动备份到期判定');
  const now = Date.parse('2026-11-24T10:00:00Z');
  ok('关着就不备份', KHBak.autoDue({ on: false, every: 'daily' }, 0, now) === false);
  ok('launch：每次启动都算到期', KHBak.autoDue({ on: true, every: 'launch' }, now - 1000, now) === true);
  ok('daily：1 小时前备份过 → 未到期', KHBak.autoDue({ on: true, every: 'daily' }, new Date(now - 3600000).toISOString(), now) === false);
  ok('daily：25 小时前 → 到期', KHBak.autoDue({ on: true, every: 'daily' }, new Date(now - 25 * 3600000).toISOString(), now) === true);
  ok('daily：23 小时 59 分前备份过 → 未到期（不重复备）', KHBak.autoDue({ on: true, every: 'daily' }, new Date(now - 86340000).toISOString(), now) === false);
  ok('daily：24 小时零 1 分前 → 到期', KHBak.autoDue({ on: true, every: 'daily' }, new Date(now - 86460000).toISOString(), now) === true);
  ok('weekly：6 天前 → 未到期', KHBak.autoDue({ on: true, every: 'weekly' }, new Date(now - 6 * 86400000).toISOString(), now) === false);
  ok('weekly：8 天前 → 到期', KHBak.autoDue({ on: true, every: 'weekly' }, new Date(now - 8 * 86400000).toISOString(), now) === true);
  ok('从未备份过 → 到期', KHBak.autoDue({ on: true, every: 'weekly' }, '', now) === true);
  ok('缺 every 默认按启动', KHBak.autoDue({ on: true }, '', now) === true);

  console.log('\n[8] 展示工具');
  ok('字节格式化', KHBak.fmtBytes(900) === '900 B' && KHBak.fmtBytes(204800).indexOf('KB') > 0 && KHBak.fmtBytes(5 * 1024 * 1024).indexOf('MB') > 0);
  ok('时间戳可读且可排序', /^2026-\d\d-\d\d_\d{6}$/.test(KHBak.stamp('2026-05-06T07:08:09Z')) === true || /^\d{4}-\d\d-\d\d_\d{6}$/.test(KHBak.stamp('2026-05-06T07:08:09Z')), KHBak.stamp('2026-05-06T07:08:09Z'));

  console.log('\n备份工具自测：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) { console.log('失败项：'); fails.forEach((f) => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('自测崩了：' + (e && e.stack || e));
  process.exit(1);
});
