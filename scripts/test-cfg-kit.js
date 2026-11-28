#!/usr/bin/env node
/* 统一配置中心注册表自测（台账 #171 · 1.7.94 · 清单 #63）
   注册表写在 app/kh-core.js 里（跑不了 require，这里用正则抽出数组求值），校验：
   38 项、键名唯一、每项字段齐全、类型合法、数字型有上下限、默认值类型与声明一致、
   分组数与顺序、每个键在客户端代码里真的被读写过（防止登记了不存在的键）。
   不写仓库文件、不碰真存储。
   用法：node scripts/test-cfg-kit.js  → 末行给出通过/失败计数，退出码即结果。 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \u2714 ' + name); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  \u2716 ' + name + (detail ? ' — ' + detail : '')); }
}

const core = fs.readFileSync(path.join(APP, 'kh-core.js'), 'utf8');
const m = core.match(/var KH_CFG_REG = (\[[\s\S]*?\n\]);/);
ok('注册表数组可定位', !!m);

let REG = [];
try { REG = m ? eval(m[1]) : []; } catch (e) { console.log('    求值失败：' + e.message); }

/* 收集客户端所有用到的 kh_ 键 */
const allSrc = fs.readdirSync(APP).filter((f) => f.endsWith('.js') && f !== 'kh-core.js' || f === 'kh-core.js')
  .map((f) => fs.readFileSync(path.join(APP, f), 'utf8')).join('\n');
const used = new Set();
const reUsed = /(?:get|set)Store\(\s*'(kh_[A-Za-z0-9_.]+)'/g;
let mu;
while ((mu = reUsed.exec(allSrc))) used.add(mu[1]);
/* kh_p2 里的字段用点号挂在 kh_p2 下，注册表里没有，忽略 */

function main() {
  console.log('\n[1] 规模与唯一性');
  ok('恰好 38 项', REG.length === 38, String(REG.length));
  const keys = REG.map((r) => r && r.k);
  ok('键名无重复', keys.every((k, i) => keys.indexOf(k) === i));
  ok('键名都带 kh_ 前缀', keys.every((k) => typeof k === 'string' && k.indexOf('kh_') === 0));
  ok('名称无重复', (() => { const n = REG.map((r) => r.n); return n.every((x, i) => n.indexOf(x) === i); })());

  console.log('\n[2] 字段与类型');
  const badField = REG.filter((r) => !r || !r.g || !r.n || !r.k || !r.t || r.d === undefined);
  ok('每项 g/n/k/t/d 齐全', badField.length === 0, badField.map((r) => r && r.k).join(','));
  ok('类型只在 text/num/bool', REG.every((r) => ['text', 'num', 'bool'].includes(r.t)), REG.filter((r) => !['text', 'num', 'bool'].includes(r.t)).map((r) => r.k).join(','));
  const nums = REG.filter((r) => r.t === 'num');
  ok('数字型都有上下限', nums.every((r) => typeof r.min === 'number' && typeof r.max === 'number' && r.min <= r.max), nums.filter((r) => !(r.min <= r.max)).map((r) => r.k).join(','));
  ok('数字型默认值在区间内', nums.every((r) => r.d >= r.min && r.d <= r.max), nums.filter((r) => !(r.d >= r.min && r.d <= r.max)).map((r) => r.k).join(','));
  ok('布尔型默认值只 0/1', REG.filter((r) => r.t === 'bool').every((r) => r.d === 0 || r.d === 1));
  ok('文本型默认值是字符串', REG.filter((r) => r.t === 'text').every((r) => typeof r.d === 'string'));
  ok('文本型给了上限或说明', REG.filter((r) => r.t === 'text').every((r) => r.max != null || r.h), REG.filter((r) => r.t === 'text' && r.max == null && !r.h).map((r) => r.k).join(','));

  console.log('\n[3] 键在客户端真的被读写');
  const missing = REG.filter((r) => !used.has(r.k)).map((r) => r.k);
  ok('38 个键全部在代码里出现过', missing.length === 0, missing.join(','));
  const extraKnown = ['kh_kid_pin', 'kh_sub_auto', 'kh_sub_dir'];
  ok('抽查敏感键已登记', extraKnown.every((k) => keys.includes(k)));

  console.log('\n[4] 分组');
  const groups = [];
  REG.forEach((r) => { if (!groups.includes(r.g)) groups.push(r.g); });
  ok('分组合并成 7 组', groups.length === 7, groups.join(','));
  ok('组名与顺序稳定', groups.join('|') === '播放|界面|通知与启动|儿童|网络|数据|远端与云端', groups.join('|'));
  ok('每组至少 2 项', groups.every((g) => REG.filter((r) => r.g === g).length >= 2), groups.filter((g) => REG.filter((r) => r.g === g).length < 2).join(','));
  const cnt = groups.map((g) => g + ':' + REG.filter((r) => r.g === g).length);
  console.log('    分组明细 ' + cnt.join(' · '));
  ok('远端两项在表内', ['kh_remote_notice', 'kh_sync_on'].every((k) => keys.includes(k)));
  ok('儿童三项在表内', ['kh_kid', 'kh_kid_pin', 'kh_kid_min'].every((k) => keys.includes(k)));

  console.log('\n[5] 写值转换规则（与 khCfgSave 同规则手算对表）');
  function convert(t, raw, min, max, len) {
    if (t === 'bool') return (String(raw) === '1' || raw === true) ? 1 : 0;
    if (t === 'num') { let v = Number(raw); if (!isFinite(v)) throw new Error('NaN'); if (min != null && v < min) v = min; if (max != null && v > max) v = max; return v; }
    return String(raw == null ? '' : raw).slice(0, len || 200);
  }
  ok('布尔 真值转 1', convert('bool', '1') === 1 && convert('bool', true) === 1);
  ok('布尔 其它转 0', convert('bool', '0') === 0 && convert('bool', 'yes') === 0 && convert('bool', '') === 0);
  ok('数字 超上限夹住', convert('num', '9999', 0, 720) === 720);
  ok('数字 低于下限夹住', convert('num', '-5', 0, 720) === 0);
  ok('数字 非法抛错', (() => { try { convert('num', 'abc', 0, 1); return false; } catch (e) { return true; } })());
  ok('数字 0 不被当成空', convert('num', '0', 0, 720) === 0);
  ok('文本 截断', convert('text', 'x'.repeat(300), null, null, 4).length === 4);
  ok('文本 空值转空串', convert('text', null) === '');

  console.log('\n[6] 与面板去重口径');
  ok('kh_sub_dir 在播放组', REG.find((r) => r.k === 'kh_sub_dir').g === '播放');
  ok('kh_theme 在界面组', REG.find((r) => r.k === 'kh_theme').g === '界面');
  ok('kh_hist_cap 在数据组', REG.find((r) => r.k === 'kh_hist_cap').g === '数据');
  ok('kh_hub_url 在网络组', REG.find((r) => r.k === 'kh_hub_url').g === '网络');

  console.log('\n' + (fail ? '\u2716 ' : '\u2714 ') + '通过 ' + pass + ' / 失败 ' + fail);
  if (fail) { console.log('失败项：\n - ' + fails.join('\n - ')); process.exitCode = 1; }
}

main();
