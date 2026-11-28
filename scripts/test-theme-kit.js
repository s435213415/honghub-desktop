#!/usr/bin/env node
/* 皮肤包自测（台账 #171 · 1.7.94 · 清单 #78）
   验：颜色校验（合法 #hex / rgb / rgba，拦 url()/expression/坏通道值）、变量白名单过滤、
   包完整性（必须 bg+text）、JSON 解析（单个 / 数组 / {themes:[]} / 坏 JSON）、
   加入与去重、上限淘汰、删除、查找、CSS 生成只含白名单变量、内置包自洽。
   不碰真实产物、不写仓库文件。
   用法：node scripts/test-theme-kit.js  → 末行给出通过/失败计数，退出码即结果。 */
'use strict';

const path = require('path');
const T = require(path.join(__dirname, '..', 'app', 'kh-theme.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \u2714 ' + name); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  \u2716 ' + name + (detail ? ' — ' + detail : '')); }
}

function main() {
  console.log('\n[1] 颜色校验');
  ok('三位 hex', T.colorOk('#0af') === true);
  ok('六位 hex', T.colorOk('#0A0F1C') === true);
  ok('rgb()', T.colorOk('rgb(12, 20, 40)') === true);
  ok('rgba()', T.colorOk('rgba(12,20,40,0.6)') === true);
  ok('空串不合法', T.colorOk('') === false);
  ok('缺 # 不合法', T.colorOk('fff') === false);
  ok('通道超 255 不合法', T.colorOk('rgb(300,20,40)') === false);
  ok('url() 注入不合法', T.colorOk('url(https://x/a.png)') === false);
  ok('expression 注入不合法', T.colorOk('expression(alert(1))') === false);
  ok('分号拼接不合法', T.colorOk('#fff;background:url(x)') === false);
  ok('var() 不合法', T.colorOk('var(--bg)') === false);
  ok('非字符串不合法', T.colorOk(null) === false && T.colorOk(123) === false);

  console.log('\n[2] 变量白名单');
  const cl = T.cleanVars({ bg: '#000', text: '#fff', brand: 'rgb(255,79,216)', evil: '#fff', card: 'url(x)', position: 'fixed' });
  ok('只留白名单键', Object.keys(cl.vars).sort().join(',') === 'bg,brand,text', Object.keys(cl.vars).join(','));
  ok('非法颜色被丢弃', cl.vars.card === undefined);
  ok('记录被丢键名', cl.dropped.indexOf('evil') >= 0 && cl.dropped.indexOf('position') >= 0, JSON.stringify(cl.dropped));
  ok('非对象输入返回空', Object.keys(T.cleanVars(null).vars).length === 0);

  console.log('\n[3] 包完整性');
  ok('缺 name 拒收', T.normPack({ vars: { bg: '#000', text: '#fff' } }) === null);
  ok('缺 bg 拒收', T.normPack({ name: 'x', vars: { text: '#fff' } }) === null);
  ok('缺 text 拒收', T.normPack({ name: 'x', vars: { bg: '#000' } }) === null);
  const p = T.normPack({ name: '  夜航  ', vars: { bg: '#02030A', text: '#E8EDF7', brand: '#5AC8FA', junk: '#fff' }, from: 'file' });
  ok('合法包归一', p && p.name === '夜航' && p.vars.bg === '#02030A' && p.from === 'file', JSON.stringify(p));
  ok('id 自动生成', p && /^t[a-z0-9]+$/.test(p.id), p && p.id);
  ok('同名同色得同 id', T.normPack({ name: '夜航', vars: { bg: '#02030A', text: '#E8EDF7', brand: '#5AC8FA' } }).id === p.id);
  ok('name 截断 24 字', T.normPack({ name: 'x'.repeat(40), vars: { bg: '#000', text: '#fff' } }).name.length === 24);
  ok('带 id 的包保留 id', T.normPack({ id: 'custom-1', name: 'x', vars: { bg: '#000', text: '#fff' } }).id === 'custom-1');

  console.log('\n[4] JSON 解析');
  const one = T.parse('{"name":"沙丘","vars":{"bg":"#1A1208","text":"#F2E6D2","brand":"#D9A066"}}', 'paste');
  ok('单包解析成功', one.ok && one.packs.length === 1, one.error);
  const batch = T.parse('{"themes":[{"name":"A","vars":{"bg":"#000","text":"#fff"}},{"name":"B","vars":{"bg":"#111","text":"#eee"}}]}', 'url');
  ok('{themes:[]} 批量解析', batch.ok && batch.packs.length === 2 && batch.packs[0].from === 'url');
  const arr = T.parse('[{"name":"A","vars":{"bg":"#000","text":"#fff"}}]', 'file');
  ok('数组批量解析', arr.ok && arr.packs.length === 1);
  const mixed = T.parse('{"themes":[{"name":"好","vars":{"bg":"#000","text":"#fff"}},{"name":"坏","vars":{"bg":"url(x)","text":"#fff"}}]}');
  ok('部分坏包只留好的并计数', mixed.ok && mixed.packs.length === 1 && mixed.rejected === 1, JSON.stringify(mixed.rejected));
  const bad = T.parse('{not json');
  ok('坏 JSON 报错', bad.ok === false && /JSON/.test(bad.error), bad.error);
  const empty = T.parse('{"name":"","vars":{}}');
  ok('全不合法时整体报错', empty.ok === false, empty.error);
  ok('空文本报错', T.parse('').ok === false);

  console.log('\n[5] 列表增删与上限');
  let list = [];
  const r1 = T.packsAdd(list, p);
  ok('首个加入成功', r1.ok && r1.list.length === 1);
  const r2 = T.packsAdd(r1.list, T.normPack({ id: p.id, name: '夜航2', vars: { bg: '#000', text: '#fff' } }));
  ok('同 id 覆盖不重复', r2.list.length === 1 && r2.list[0].name === '夜航2' && r2.replaced === true);
  ok('不完整包拒收', T.packsAdd(r2.list, { id: 'x', name: 'y' }).ok === false);
  let l3 = r2.list;
  for (let i = 0; i < 10; i++) l3 = T.packsAdd(l3, { id: 'k' + i, name: '包' + i, vars: { bg: '#000', text: '#fff' } }).list;
  ok('超上限淘汰最旧', l3.length === T.PACK_CAP && l3[l3.length - 1].id === 'k9', l3.map((x) => x.id).join(','));
  ok('删除指定包', T.packsRemove(l3, 'k9').length === T.PACK_CAP - 1);
  ok('删除不存在 id 不变', T.packsRemove(l3, 'nope').length === T.PACK_CAP);
  ok('查找命中', T.packFind(l3, 'k8') && T.packFind(l3, 'k8').name === '包8');
  ok('查找未命中为 null', T.packFind(l3, 'nope') === null && T.packFind(null, 'x') === null);
  ok('非数组输入容错', T.packsAdd(null, p).list.length === 1 && T.packsRemove(null, 'x').length === 0);

  console.log('\n[6] CSS 生成');
  const css = T.packCss(p);
  ok('覆盖样式带变量', /body\.kh-pack\{/.test(css) && /--bg:#02030A;/.test(css) && /--brand:#5AC8FA;/.test(css), css.slice(0, 80));
  ok('只含白名单变量', !/--junk/.test(css) && T.VAR_KEYS.every((k) => new RegExp('--' + k + ':').test(css) || true));
  ok('带暖底/表单跟随', /\.topbar\{background:var\(--card\)/.test(css) && /\.siteform input/.test(css));
  ok('空包生成空串', T.packCss(null) === '' && T.packCss({ vars: {} }) === '');
  ok('非法色不进 CSS', !/url\(/.test(T.packCss({ vars: { bg: '#000', text: '#fff', brand: 'url(x)' } })));

  console.log('\n[7] 内置包');
  const bi = T.builtins();
  ok('内置三包', bi.length === 3 && bi.every((x) => x && x.id && x.vars.bg && x.vars.text), bi.map((x) => x.name).join(','));
  ok('内置包来源 built', bi.every((x) => x.from === 'built'));
  ok('内置包都能生成 CSS', bi.every((x) => T.packCss(x).length > 100));

  console.log('\n' + (fail ? '\u2716 ' : '\u2714 ') + '通过 ' + pass + ' / 失败 ' + fail);
  if (fail) { console.log('失败项：\n - ' + fails.join('\n - ')); process.exitCode = 1; }
}

main();
