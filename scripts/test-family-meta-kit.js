#!/usr/bin/env node
/* 家庭多档案 + 外部数据源 / 网络偏好自测（台账 #172 · 1.7.94 · 清单 #58 #59 #60 #37）
   [1–3] app/kh-family.js：档案归一 / 上限 4 / 同名拒收 / 改名 / 删除保底 /
          快照只收有值的键 / 还原时缺失键要清空（不串档案）/ 概览计数
   [4–7] app/kh-meta.js：元数据源与模板地址、结果归一与缓存淘汰、
          字幕站白名单、AI Key 校验与掩码、IP 模式与 DNS 校验、诚实说明
   纯内存，不写仓库文件、不发网络请求。
   用法：node scripts/test-family-meta-kit.js  → 末行给出通过/失败计数，退出码即结果。 */
'use strict';

const path = require('path');
const F = require(path.join(__dirname, '..', 'app', 'kh-family.js'));
const M = require(path.join(__dirname, '..', 'app', 'kh-meta.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \u2714 ' + name); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  \u2716 ' + name + (detail ? ' — ' + detail : '')); }
}

function main() {
  console.log('\n[1] 档案归一');
  const d = F.normList(null);
  ok('空输入给默认档案', d.length === 1 && d[0].id === 'p1' && d[0].name === '家庭', JSON.stringify(d));
  const n1 = F.normList([{ id: 'a', name: '  爸爸 ' }, { id: 'a', name: '重复' }, { name: '' }, { id: 'b', name: '妈妈', color: '#8CE99A' }]);
  ok('去重同 id', n1.length === 2 && n1[0].name === '爸爸', JSON.stringify(n1));
  ok('空名拒收', !n1.some((p) => !p.name));
  ok('非法颜色回落调色板', n1[1].color === '#8CE99A' && n1[0].color === F.COLORS[0], n1.map((p) => p.color).join(','));
  ok('名称截断 12 字', F.normProfile({ id: 'x', name: 'x'.repeat(20) }, 0).name.length === 12);
  ok('列表上限 4', F.normList([1, 2, 3, 4, 5, 6].map((i) => ({ id: 'p' + i, name: '档' + i }))).length === 4);
  ok('当前档案落在表内', F.normCurrent(n1, 'b') === 'b' && F.normCurrent(n1, 'zzz') === 'a');

  console.log('\n[2] 增删改');
  let l = F.normList([{ id: 'a', name: '爸爸' }]);
  const c1 = F.create(l, '妈妈', '#FF7AB6');
  ok('新建成功', c1.ok && c1.list.length === 2 && c1.profile.name === '妈妈', JSON.stringify(c1.profile));
  ok('同名拒收', F.create(c1.list, '妈妈').ok === false);
  ok('空名拒收', F.create(c1.list, '   ').ok === false);
  let c3 = c1.list;
  c3 = F.create(c3, '孩子').list;
  c3 = F.create(c3, '客人').list;
  ok('第四个还能加', c3.length === 4);
  const c5 = F.create(c3, '第五个');
  ok('第五个被拒（上限 4）', c5.ok === false && /最多/.test(c5.error), c5.error);
  const rn = F.rename(c3, c1.profile.id, '妈妈(改)');
  ok('改名生效', rn.ok && rn.list.find((p) => p.id === c1.profile.id).name === '妈妈(改)');
  ok('改名空值拒收', F.rename(c3, 'a', '').ok === false);
  const rm = F.remove(c3, 'a');
  ok('删除生效', rm.ok && rm.list.length === 3 && !rm.list.some((p) => p.id === 'a'));
  const rmAll = F.remove([{ id: 'only', name: '唯一' }], 'only');
  ok('删到空会被拦住', rmAll.ok === false && /至少/.test(rmAll.error), rmAll.error);

  console.log('\n[3] 快照与还原（核心：不能串档案）');
  const store = { kh_fav: ['m1'], kh_hist: ['h1', 'h2'], kh_kid: 1, kh_kid_pin: '1234', kh_prog: { m1: 30 }, kh_unrelated: 'x' };
  const read = (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null);
  const write = (k, v) => { if (v === null) delete store[k]; else store[k] = v; };
  const snapDad = F.snapshot(read);
  ok('快照只收登记的键', Object.keys(snapDad).length === 5 && !('kh_unrelated' in snapDad), Object.keys(snapDad).join(','));
  const sumDad = F.summary(null, snapDad);
  ok('概览计数正确', sumDad.fav === 1 && sumDad.hist === 2 && sumDad.prog === 1 && sumDad.kid === true, JSON.stringify(sumDad));
  /* 模拟切到「妈妈」：先清空，再换成另一份 */
  F.restore({}, write);
  ok('切走时清空当前档案键', store.kh_fav === undefined && store.kh_hist === undefined && store.kh_kid === undefined);
  ok('无关键不受影响', store.kh_unrelated === 'x');
  write('kh_fav', ['x1']);
  write('kh_kid', 0);
  F.restore(snapDad, write);
  ok('切回来恢复爸爸的收藏', Array.isArray(store.kh_fav) && store.kh_fav[0] === 'm1', JSON.stringify(store.kh_fav));
  ok('切回来恢复儿童设置', Number(store.kh_kid) === 1 && store.kh_kid_pin === '1234');
  ok('切回来进度也在', store.kh_prog && store.kh_prog.m1 === 30);
  ok('快照覆盖全部独立键', F.SNAP_KEYS.length === 10, F.SNAP_KEYS.join(','));
  ok('还原条数等于快照里的键数', F.restore(snapDad, write) === Object.keys(snapDad).length, String(F.restore(snapDad, write)) + ' / ' + Object.keys(snapDad).length);

  console.log('\n[4] 元数据源与模板');
  ok('默认内置', M.normSrc('') === 'builtin' && M.normSrc('tmdb') === 'tmdb' && M.normSrc('豆瓣') === 'builtin');
  ok('豆瓣可选', M.normSrc('douban') === 'douban');
  ok('中文标签', M.srcLabel('tmdb') === 'TMDB' && /内置/.test(M.srcLabel('builtin')));
  ok('模板缺 {title} 拒收', M.tplOk('https://api.example/search?q=').ok === false);
  ok('模板非 http 拒收', M.tplOk('ftp://a/{title}').ok === false);
  ok('模板带空格拒收', M.tplOk('https://a/{title} x').ok === false);
  const t = M.tplOk('https://meta.example/api?q={title}&y={year}');
  ok('合法模板通过', t.ok === true);
  const bu = M.buildUrl('https://meta.example/api?q={title}&y={year}', { title: '流浪地球 2', year: 2023 });
  ok('占位符替换并编码', bu.ok && decodeURIComponent(bu.url).indexOf('q=流浪地球 2') > 0 && /y=2023/.test(bu.url), bu.url);
  ok('缺年份也能拼', M.buildUrl('https://a/{title}', { title: 'x' }).ok === true);

  console.log('\n[5] 刮削结果与缓存');
  const nr = M.normResult({ title: '片名', release_date: '2023-01-20', poster_path: 'https://img.example/p.jpg', vote_average: 82, overview: '简介'.repeat(400) });
  ok('结果字段归一', nr.title === '片名' && nr.year === '2023' && nr.rating === 8.2, JSON.stringify(nr));
  ok('简介截断 600', nr.overview.length === 600);
  ok('相对海报丢弃', M.normResult({ title: 'x', poster: '/local/a.jpg' }).poster === '');
  ok('全空结果返回 null', M.normResult({}) === null && M.normResult(null) === null);
  let cache = {};
  for (let i = 0; i < 60; i++) { const m = M.normResult({ title: 't' + i }); m.at = i; cache = M.cachePut(cache, 'id' + i, m, 50); }
  ok('缓存上限 50', Object.keys(cache).length === 50, Object.keys(cache).length);
  ok('淘汰最旧的', !cache.id0 && !!cache.id59);
  cache = M.cachePut(cache, 'id59', Object.assign({}, cache.id59, { title: '改过' }));
  ok('同 id 覆盖', cache.id59.title === '改过');
  ok('取缓存', M.cacheGet(cache, 'id59').title === '改过' && M.cacheGet(cache, 'nope') === null);

  console.log('\n[6] 字幕站与 Key');
  ok('字幕站只留 http(s) 并去重', M.subSites('https://a.example/x, https://a.example/x\nhttps://b.example 不是网址 ftp://c').length === 2);
  ok('字幕站上限 10', M.subSites('https://' + Array.from({ length: 20 }, (_, i) => i + '.example').join(' https://')).length === 10);
  ok('空输入空数组', M.subSites('').length === 0);
  ok('Key 太短拒收', M.keyOk('abc').ok === false);
  ok('Key 带空格拒收', M.keyOk('abcd 1234').ok === false);
  ok('Key 超长拒收', M.keyOk('k'.repeat(201)).ok === false);
  const kk = M.keyOk('  sk-abcdef1234567890  ');
  ok('合法 Key 去空白', kk.ok && kk.key === 'sk-abcdef1234567890', kk.key);
  ok('掩码只留后 4 位', M.keyMask('sk-abcdef1234567890').indexOf('7890') > 0 && M.keyMask('sk-abcdef1234567890').indexOf('cdef') < 0, M.keyMask('sk-abcdef1234567890'));
  ok('短 Key 掩码不露全文', M.keyMask('12345678') === '••••78', M.keyMask('12345678'));
  ok('空 Key 掩码空串', M.keyMask('') === '');
  ok('接口地址去尾斜杠', M.aiBase('https://ai.example/v1/').base === 'https://ai.example/v1');
  ok('接口地址非 http 拒收', M.aiBase('ai.example').ok === false);
  ok('空接口地址允许', M.aiBase('').ok === true);

  console.log('\n[7] IP 族与 DNS');
  ok('模式归一', M.normIpMode('ipv4') === 'ipv4' && M.normIpMode('IPv6') === 'auto' && M.normIpMode('') === 'auto');
  ok('中文说明', /IPv4/.test(M.ipLabel('ipv4')) && /自动/.test(M.ipLabel('auto')));
  ok('IPv4 地址合法', M.dnsOk('8.8.8.8') && M.dnsOk('223.5.5.5'));
  ok('IPv4 越界不合法', M.dnsOk('300.1.1.1') === false);
  ok('域名合法', M.dnsOk('dns.google') === true);
  ok('单标签域名不合法', M.dnsOk('localhost') === false);
  ok('空 DNS 视为合法（不设）', M.dnsOk('') === true);
  ok('DNS 列表去重限 3', M.dnsList('8.8.8.8, 8.8.8.8\n1.1.1.1 223.5.5.5 dns.google 坏值').length === 3, JSON.stringify(M.dnsList('8.8.8.8, 8.8.8.8\n1.1.1.1 223.5.5.5 dns.google 坏值')));
  const note1 = M.netNote('ipv4', ['8.8.8.8']);
  ok('说明提到重启生效', /下次启动/.test(note1));
  ok('说明不假装切换系统 DNS', /不骗你|系统网络设置|路由器/.test(note1), note1);
  ok('自动模式说明跟随系统', /跟随系统/.test(M.netNote('auto', [])));

  console.log('\n' + (fail ? '\u2716 ' : '\u2714 ') + '通过 ' + pass + ' / 失败 ' + fail);
  if (fail) { console.log('失败项：\n - ' + fails.join('\n - ')); process.exitCode = 1; }
}

main();
