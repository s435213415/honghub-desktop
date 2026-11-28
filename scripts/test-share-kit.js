#!/usr/bin/env node
/* 分享短链自测（台账 #171 · 1.7.94 · 清单 #65）
   验：目标地址白名单（公网 http(s) / # 应用内路由通过，内网、回环、file:、相对路径、空值拦截）、
   标题清洗、建链（长度、复用同目标、记录命中数）、解析（存在 / 不存在 / 大小写与杂质字符）、
   列表排序、过期清理与上限淘汰、信息汇总。数据目录用 KH_SHARE_DATA 指到临时目录，不污染真数据。
   用法：node scripts/test-share-kit.js  → 末行给出通过/失败计数，退出码即结果。 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-share-'));
process.env.KH_SHARE_DATA = TMP;
const S = require(path.join(__dirname, '..', 'server', 'shares.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \u2714 ' + name); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  \u2716 ' + name + (detail ? ' — ' + detail : '')); }
}

function main() {
  console.log('\n[1] 目标地址白名单');
  ok('公网 https 通过', !!S.safeTarget('https://honghub.example/s/abc'));
  ok('公网 http 通过', !!S.safeTarget('http://example.com/a?b=1'));
  ok('应用内路由通过', S.safeTarget('#/movie/123') === '#/movie/123');
  ok('localhost 拦截', S.safeTarget('http://localhost:8080/x') === null);
  ok('127.0.0.1 拦截', S.safeTarget('http://127.0.0.1/x') === null);
  ok('10.x 拦截', S.safeTarget('http://10.1.2.3/x') === null);
  ok('192.168.x 拦截', S.safeTarget('http://192.168.1.5:8080/') === null);
  ok('172.16-31 拦截', S.safeTarget('http://172.20.1.1/') === null);
  ok('169.254 拦截', S.safeTarget('http://169.254.169.254/latest') === null);
  ok('file: 拦截', S.safeTarget('file:///C:/x.mp4') === null);
  ok('盘符路径拦截', S.safeTarget('D:\\Media\\a.mp4') === null);
  ok('相对路径拦截', S.safeTarget('/movie/1') === null);
  ok('空值拦截', S.safeTarget('') === null && S.safeTarget(null) === null);
  ok('超长截断 2000', String(S.safeTarget('https://a.example/' + 'x'.repeat(3000))).length <= 2000);
  ok('标题去控制字符与尖括号', S.safeTitle('  <b>测试</b>\u0000片名  ') === 'b测试/b片名', JSON.stringify(S.safeTitle('  <b>测试</b>\u0000片名  ')));
  ok('标题截断 60', S.safeTitle('x'.repeat(100)).length === 60);

  console.log('\n[2] 建链');
  const a = S.create('https://honghub.example/s/one', '片名一');
  ok('建链成功', a.ok === true && typeof a.code === 'string', JSON.stringify(a));
  ok('短码长度合规', a.code.length >= 5 && a.code.length <= 12 && /^[a-z0-9]+$/.test(a.code), a.code);
  ok('返回规范目标', a.target === 'https://honghub.example/s/one', a.target);
  const a2 = S.create('https://honghub.example/s/one', '片名一（改名）');
  ok('同目标复用短码', a2.ok && a2.reused === true && a2.code === a.code, JSON.stringify(a2));
  ok('复用不新增条数', S.info().count === 1, S.info().count);
  ok('非法目标拒绝', S.create('http://127.0.0.1/x').ok === false);
  const route = S.create('#/movie/42', '应用内片');
  ok('应用内路由可建链', route.ok === true);

  console.log('\n[3] 解析');
  const r = S.resolve(a.code);
  ok('解析命中', r && r.target === 'https://honghub.example/s/one', JSON.stringify(r));
  ok('解析大小写不敏感', S.resolve(a.code.toUpperCase()) !== null);
  ok('解析允许杂质字符', S.resolve(' ' + a.code + '/') !== null);
  ok('解析不存在返回 null', S.resolve('zzzzzzz') === null);
  ok('空码返回 null', S.resolve('') === null && S.resolve(null) === null);
  const hits = S.list(10).find((x) => x.code === a.code);
  ok('命中计数被累加', hits && hits.hits >= 2, hits && hits.hits);
  ok('解析记最近访问时间', hits && hits.last > 0);

  console.log('\n[4] 列表与容量');
  const l0 = S.list(5);
  ok('列表按时间倒序', l0.length >= 1 && (l0.length < 2 || l0[0].at >= l0[1].at), JSON.stringify(l0.map((x) => x.code)));
  ok('列表带 code 字段', l0.every((x) => typeof x.code === 'string'));
  ok('limit 生效', S.list(1).length === 1);
  for (let i = 0; i < 12; i++) S.create('https://honghub.example/bulk/' + i, '批量' + i);
  ok('批量建链不互相覆盖', S.info().count === 14, S.info().count);

  console.log('\n[5] 上限淘汰与过期清理');
  /* 直接改数据文件，灌到上限以上，验证 CAP 与 TTL */
  const fp = path.join(TMP, 'shares.json');
  const db = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const oldTs = Date.now() - 200 * 86400000;
  db.items['oldone'] = { target: 'https://honghub.example/old', title: '过期', at: oldTs, hits: 0 };
  for (let i = 0; i < S.CAP + 5; i++) db.items['k' + i] = { target: 'https://honghub.example/k' + i, title: 'k' + i, at: Date.now() + i, hits: 0 };
  fs.writeFileSync(fp, JSON.stringify(db));
  const res = S.create('https://honghub.example/newest', '最新');
  const after = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const count = Object.keys(after.items).length;
  ok('建链后条数不超过上限', count <= S.CAP + 1, count);
  ok('过期条目被清理', !after.items['oldone']);
  ok('最新那条在库里', !!after.items[res.code]);
  ok('信息汇总字段齐全', S.info().cap === S.CAP && S.info().ttlDays === 180, JSON.stringify(S.info()));

  console.log('\n' + (fail ? '\u2716 ' : '\u2714 ') + '通过 ' + pass + ' / 失败 ' + fail);
  if (fail) { console.log('失败项：\n - ' + fails.join('\n - ')); process.exitCode = 1; }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

main();
