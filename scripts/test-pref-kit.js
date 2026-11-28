#!/usr/bin/env node
/* 偏好与行为纯逻辑自测（1.7.90 · 台账 #165 · 清单 #27 #28 #29 #43 #50 #51）
   只测 app/kh-pref.js：默认值与非法回落、历史条数/天数裁剪、续播三档、
   自动下一部候选、搜索范围、点击行为、动效开关。不碰 DOM、不写仓库。
   用法：node scripts/test-pref-kit.js */
'use strict';
const path = require('path');
const P = require(path.join(__dirname, '..', 'app', 'kh-pref.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \u2714 ' + name); }
  else { fail++; fails.push(name + (detail !== undefined ? ' — ' + detail : '')); console.log('  \u2716 ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + ' vs ' + JSON.stringify(b)); }

console.log('\n[1] 默认值与非法回落');
eq('空输入全部默认', P.norm({}), P.DEF);
eq('null 也回落默认', P.norm(null), P.DEF);
eq('数组输入当脏数据', P.norm([1, 2]), P.DEF);
ok('histCap 默认 30', P.norm({}).histCap === 30);
ok('histCap 下限 10', P.norm({ histCap: 2 }).histCap === 10);
ok('histCap 上限 500', P.norm({ histCap: 9999 }).histCap === 500);
ok('histCap 非数字回落 30', P.norm({ histCap: 'abc' }).histCap === 30);
ok('histDays 负数归 0', P.norm({ histDays: -5 }).histDays === 0);
ok('histDays 上限 365', P.norm({ histDays: 999 }).histDays === 365);
ok('resume 非法回落 ask', P.norm({ resume: 'sometimes' }).resume === 'ask');
ok('resume always 保留', P.norm({ resume: 'always' }).resume === 'always');
ok('openMode 非法回落 play', P.norm({ openMode: 'zoom' }).openMode === 'play');
ok('searchScope 非法回落 builtin', P.norm({ searchScope: 'web' }).searchScope === 'builtin');
ok('motion 0 保留', P.norm({ motion: 0 }).motion === 0);
ok('motion "0" 也当关', P.norm({ motion: '0' }).motion === 0);
ok('autoNext 1 保留', P.norm({ autoNext: 1 }).autoNext === 1);

console.log('\n[2] 历史裁剪（条数 + 天数）');
const now = 1763000000000;
eq('默认 30 条截断', P.trimHist(Array.from({ length: 40 }, (_, i) => 'm' + i), {}, {}, now).length, 30);
eq('10 条上限', P.trimHist(Array.from({ length: 20 }, (_, i) => 'm' + i), {}, { histCap: 10 }, now).length, 10);
eq('保持传入顺序', P.trimHist(['b', 'a', 'c'], {}, { histCap: 3 }, now), ['b', 'a', 'c']);
eq('重复 id 去重', P.trimHist(['a', 'a', 'b'], {}, {}, now), ['a', 'b']);
eq('空输入返回空', P.trimHist(null, {}, {}, now), []);
ok('超过 7 天的被淘汰', P.trimHist(['old', 'new'], { old: now - 8 * 86400000, new: now - 3600000 }, { histDays: 7 }, now).length === 1);
ok('7 天内的保留', P.trimHist(['ok1'], { ok1: now - 6 * 86400000 }, { histDays: 7 }, now).length === 1);
ok('没有时间戳的老记录保留', P.trimHist(['legacy'], {}, { histDays: 7 }, now).length === 1);
ok('天数关（0）不按时间淘汰', P.trimHist(['x'], { x: now - 400 * 86400000 }, { histDays: 0 }, now).length === 1);

console.log('\n[3] 续播策略');
const rp = P.resumePlan;
eq('never 不提示不跳', rp(120, 3600, 'never'), { show: false, seek: false, reason: 'mode-never' });
eq('ask 进度足够先问', rp(120, 3600, 'ask'), { show: true, seek: false, reason: 'mode-ask' });
eq('always 直接跳', rp(120, 3600, 'always'), { show: false, seek: true, reason: 'mode-always' });
eq('进度 <5 秒不提示', rp(2, 3600, 'ask'), { show: false, seek: false, reason: 'no-progress' });
eq('进度为 0 不提示', rp(0, 3600, 'always'), { show: false, seek: false, reason: 'no-progress' });
eq('离结尾 <3 秒不提示', rp(3598, 3600, 'ask'), { show: false, seek: false, reason: 'near-end' });
ok('时长未知（NaN）按先问', rp(120, NaN, 'ask').show === true);
ok('时长 Infinity 按先问', rp(120, Infinity, 'ask').show === true);
ok('非法模式回落 ask', rp(120, 3600, 'wat').show === true);

console.log('\n[4] 自动下一部候选');
const pool = [
  { id: 'a1', title: '名侦探柯南 剧场版 2001', category: '动画', year: 2001 },
  { id: 'a2', title: '名侦探柯南 剧场版 1999', category: '动画', year: 1999 },
  { id: 'b1', title: '另一部动画', category: '动画', year: 2020 },
  { id: 'l1', title: '某频道', category: '直播', live: true },
  { id: 'c1', title: '自定义网址', category: '动画', custom: true }
];
ok('同系列优先且年头早', P.pickNext({ id: 'x', title: '名侦探柯南 剧场版 2010', category: '动作' }, pool.concat([{ id: 'a1', title: '名侦探柯南 剧场版 2001', category: '动画', year: 2001 }, { id: 'a2', title: '名侦探柯南 剧场版 1999', category: '动画', year: 1999 }])).id === 'a2');
ok('没有同系列取同分类', P.pickNext({ id: 'z', title: '无关片名', category: '动画' }, pool).id === 'a1');
ok('排除直播条目', P.pickNext({ id: 'z', title: '无关', category: '直播' }, [{ id: 'l1', title: '频道', category: '直播', live: true }]) === null);
ok('排除自定义网址', P.pickNext({ id: 'z', title: '无关', category: '动画' }, [{ id: 'c1', title: '自定义', category: '动画', custom: true }]) === null);
ok('不选自己', P.pickNext({ id: 'a1', title: '名侦探柯南 剧场版 2001', category: '动画', year: 2001 }, pool).id !== 'a1');
ok('空池返回 null', P.pickNext({ id: 'z', title: 'x', category: '动画' }, []) === null);
ok('直播片不接（cur.live）', P.pickNext({ id: 'l1', title: 'x', live: true }, pool) === null);

console.log('\n[5] 搜索范围');
ok('builtin 含片单', P.scopeHas('builtin', 'builtin') === true);
ok('builtin 不含直播', P.scopeHas('builtin', 'live') === false);
ok('builtin 不含仓站', P.scopeHas('builtin', 'warehouse') === false);
ok('live 含片单', P.scopeHas('live', 'builtin') === true);
ok('live 含直播', P.scopeHas('live', 'live') === true);
ok('live 不含仓站', P.scopeHas('live', 'warehouse') === false);
ok('warehouse 含直播', P.scopeHas('warehouse', 'live') === true);
ok('warehouse 含仓站', P.scopeHas('warehouse', 'warehouse') === true);
ok('未知 kind 返回 false', P.scopeHas('warehouse', 'vod') === false);

console.log('\n[6] 点击行为与动效');
ok('play 模式不拦截', P.needsArm('play', false) === false);
ok('detail 首次要展开简介', P.needsArm('detail', false) === true);
ok('detail 第二次直接播', P.needsArm('detail', true) === false);
ok('动效关挂类名', P.motionClass(0) === 'kh-no-motion');
ok('动效开不挂类', P.motionClass(1) === '');
eq('选项表与清单口径一致', P.choices(), { caps: [10, 20, 30, 50, 100, 200], days: [0, 7, 30, 90, 365] });

console.log('\n[7] 关闭窗口行为（1.7.93 #54）');
ok('默认收进托盘', P.norm({}).closeAct === 'tray');
ok('quit 保留', P.norm({ closeAct: 'quit' }).closeAct === 'quit');
ok('min 保留', P.norm({ closeAct: 'min' }).closeAct === 'min');
ok('非法值回落 tray', P.norm({ closeAct: 'hide' }).closeAct === 'tray');
ok('大写不接受', P.norm({ closeAct: 'TRAY' }).closeAct === 'tray');
ok('数字当非法', P.norm({ closeAct: 1 }).closeAct === 'tray');
eq('三档枚举对外可见', P.CLOSE_ACTS, ['tray', 'quit', 'min']);

console.log('\n结果：' + pass + ' 项通过 / ' + fail + ' 项失败');
if (fail) {
  console.log('失败项：' + fails.join(' | '));
  process.exit(1);
}
