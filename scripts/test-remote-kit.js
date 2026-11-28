#!/usr/bin/env node
/* 远端配置与云同步自测（台账 #170 · 1.7.94 · 清单 #69 #70 #71 #77 #66 #75）
   只测 app/kh-remote.js 的纯逻辑：视图归一与容错、公告有效期与关闭记录、锁定命中、
   远端默认值只补没设过的键、离线灰度求值（与服务端同算法）、云同步客户端侧过滤、
   三个请求包装（用假 fetch 验 URL / body / 错误传播）。
   不碰真实产物、不写仓库文件，全部在内存里跑。
   用法：node scripts/test-remote-kit.js  → 末行给出通过/失败计数，退出码即结果。 */
'use strict';

const path = require('path');
const R = require(path.join(__dirname, '..', 'app', 'kh-remote.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \u2714 ' + name); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  \u2716 ' + name + (detail ? ' — ' + detail : '')); }
}

async function main() {
  console.log('\n[1] 视图归一');
  const v0 = R.normView(null);
  ok('空输入回落默认', v0.rev === 0 && v0.notice === null && v0.locks.length === 0 && v0.from === 'none', JSON.stringify(v0));
  const v1 = R.normView({
    rev: '12', updatedAt: '2026-11-23T10:00:00Z',
    notice: { id: 'a1', title: '  维护通知 ', text: '今晚 23:00 起维护', level: 'warn', link: '/#help' },
    locks: [' kh_audio_lang ', 'kh_audio_lang', '', null, 'kh_top'],
    defaults: { kh_kid_min: 60, kh_note: 'hi', kh_weird: { a: 1 }, kh_null: null },
    flags: { f1: true, f2: 'yes', f3: 0 },
    sync: { enabled: false },
    flagsRaw: { f1: true }
  });
  ok('rev 转数字', v1.rev === 12, v1.rev);
  ok('at 取 updatedAt', v1.at === '2026-11-23T10:00:00Z', v1.at);
  ok('公告字段归一', v1.notice.id === 'a1' && v1.notice.title === '维护通知' && v1.notice.level === 'warn', JSON.stringify(v1.notice));
  ok('非法级别回落 info', R.normView({ notice: { title: 'x', level: 'leak' } }).notice.level === 'info');
  ok('无标题无正文的公告判空', R.normView({ notice: { id: 'z' } }).notice === null);
  ok('锁定项去空白去重', v1.locks.length === 2 && v1.locks[0] === 'kh_audio_lang', JSON.stringify(v1.locks));
  ok('默认值只留简单值', Object.keys(v1.defaults).length === 2 && v1.defaults.kh_note === 'hi', JSON.stringify(v1.defaults));
  ok('灰度只留布尔', v1.flags.f1 === true && v1.flags.f2 === false && v1.flags.f3 === false, JSON.stringify(v1.flags));
  ok('同步开关可关', v1.sync.enabled === false);
  ok('flagsRaw 原样保留', v1.flagsRaw && v1.flagsRaw.f1 === true);
  ok('来源标记 remote', v1.from === 'remote');
  ok('默认视图不被污染', R.DEF.rev === 0 && R.DEF.locks.length === 0);

  console.log('\n[2] 公告有效期与关闭记录');
  const n = { id: 'a1', title: 't', text: 'x', from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' };
  ok('区间内展示', R.noticeActive(n, '2026-11-23T00:00:00Z') !== null);
  ok('未到生效时间不展示', R.noticeActive(n, '2026-10-20T00:00:00Z') === null);
  ok('已过失效时间不展示', R.noticeActive(n, '2026-12-05T00:00:00Z') === null);
  ok('空公告不展示', R.noticeActive(null) === null);
  ok('坏时间串不卡住', R.noticeActive({ id: 'b', title: 't', from: 'bad-date' }, '2026-11-23T00:00:00Z') !== null);
  ok('关过的 id 不再展示', R.noticeShowable({ notice: n }, ['a1'], '2026-11-23T00:00:00Z') === null);
  ok('换 id 重新出现', R.noticeShowable({ notice: { id: 'a2', title: 't2' } }, ['a1'], '2026-11-23T00:00:00Z') !== null);

  console.log('\n[3] 锁定与灰度开关');
  ok('锁定命中', R.lockHit(['kh_top', 'kh_kid'], 'kh_kid') === true);
  ok('锁定未命中', R.lockHit(['kh_top'], 'kh_kid') === false);
  ok('空锁定列表不命中', R.lockHit(null, 'kh_top') === false && R.lockHit([], 'kh_top') === false);
  ok('未声明默认开', R.flagOn({}, 'x') === true);
  ok('未声明可指定默认', R.flagOn({}, 'x', false) === false);
  ok('显式关', R.flagOn({ x: false }, 'x') === false);

  console.log('\n[4] 远端默认值只补没设过的键');
  const plan = R.defaultsPlan({ kh_a: 1, kh_b: 2, kh_c: 3 }, (k) => k === 'kh_b');
  ok('只补缺失的键', plan.apply.length === 2 && plan.skip.length === 1 && plan.skip[0] === 'kh_b', JSON.stringify(plan));
  const plan2 = R.defaultsPlan(null, () => false);
  ok('无默认值返回空计划', plan2.apply.length === 0);

  console.log('\n[5] 离线灰度求值（与服务端同算法）');
  ok('版本号加权', R.verNum('1.7.94') === 10794 && R.verNum('v1.7.94-beta') === 10794, R.verNum('1.7.94'));
  ok('版本号非法为 null', R.verNum('') === null && R.verNum('x') === null);
  const b1 = R.bucket('dev-1', 'f1'), b2 = R.bucket('dev-1', 'f1');
  ok('哈希稳定且落在 0-99', b1 === b2 && b1 >= 0 && b1 < 100, b1);
  ok('不同设备可能不同桶', typeof R.bucket('dev-2', 'f1') === 'number');
  const ef = R.evalFlags({
    always: true,
    never: false,
    obj_on: {},
    obj_off: { on: false },
    half: { roll: 100 },
    zero: { roll: 0 },
    newonly: { minVer: '1.7.94' },
    oldonly: { maxVer: '1.7.90' }
  }, { device: 'dev-1', version: '1.7.94' });
  ok('布尔直传', ef.always === true && ef.never === false);
  ok('空对象视为开', ef.obj_on === true);
  ok('on:false 关', ef.obj_off === false);
  ok('roll:100 全开', ef.half === true);
  ok('roll:0 全关', ef.zero === false);
  ok('最低版本满足', ef.newonly === true);
  ok('最高版本不满足', ef.oldonly === false);
  const ef2 = R.evalFlags({ newonly: { minVer: '1.8.0' } }, { device: 'd', version: '1.7.94' });
  ok('低于最低版本关', ef2.newonly === false);
  const ef3 = R.evalFlags({ newonly: { minVer: '1.7.94' } }, { device: 'd', version: '' });
  ok('版本不明不卡灰度', ef3.newonly === true);
  ok('非对象灰度参数不炸', JSON.stringify(R.evalFlags(null)) === '{}' && R.evalFlags({ x: null }).x === true);

  console.log('\n[6] 云同步客户端侧过滤');
  const sf = R.syncFilter({
    kh_audio_lang: 'zh', kh_sub_auto: 1, kh_kid: 1,
    kh_site_url: 'x', kh_player_exe: 'C:\\a.exe', kh_hub_url: 'http://a',
    kh_kid_pin: '1234', kh_x_token: 't',
    kh_note: 'https://a.com', kh_big: { t: ('x'.repeat(4200)) },
    kh_obj: { a: 1 }, kh_arr: [1, 2], kh_nul: null,
    hotkeys: 'kh_hotkeys', kh__bad: 1, kh_OK_upper: 1
  });
  ok('保留普通偏好', sf.kh_audio_lang === 'zh' && sf.kh_sub_auto === 1 && sf.kh_kid === 1, JSON.stringify(Object.keys(sf)));
  ok('拦非 kh_ 前缀', !('hotkeys' in sf), JSON.stringify(Object.keys(sf)));
  ok('拦大写键名', sf.kh_OK_upper === undefined);
  ok('拦含 site 的键', sf.kh_site_url === undefined);
  ok('拦含 exe 的键', sf.kh_player_exe === undefined);
  ok('拦含 url 的键', sf.kh_hub_url === undefined);
  ok('拦含 pin 的键', sf.kh_kid_pin === undefined);
  ok('拦含 token 的键', sf.kh_x_token === undefined);
  ok('拦 http 值', sf.kh_note === undefined);
  ok('拦超大对象', sf.kh_big === undefined);
  ok('小对象可同步', sf.kh_obj && sf.kh_obj.a === 1);
  ok('数组不同步', sf.kh_arr === undefined);
  ok('null 值保留（简单值）', 'kh_nul' in sf);
  ok('空输入返回空对象', JSON.stringify(R.syncFilter(null)) === '{}');

  console.log('\n[7] 请求包装');
  const calls = [];
  const fakeFetch = (url, opt) => { calls.push({ url: String(url), opt: opt || {} }); return Promise.resolve({ json: () => Promise.resolve({ ok: true, rev: 5, locks: ['kh_top'] }) }); };
  ok('apiBase 去尾斜杠', R.apiBase('http://h:8080/') === 'http://h:8080' && R.apiBase('') === '');
  const lv = await R.load('http://h:8080/', 'dev 1', '1.7.94', fakeFetch);
  ok('load 带 device/ver 且编码', calls[0].url.indexOf('/api/config/center?device=dev%201&ver=1.7.94') > 0, calls[0].url);
  ok('load 归一视图', lv.rev === 5 && lv.locks[0] === 'kh_top' && lv.from === 'remote', JSON.stringify(lv));
  let rej = 0;
  await R.load('http://h', 'd', '1.0.0', () => Promise.resolve({ json: () => Promise.resolve({ ok: false, error: '停用' }) })).catch(() => { rej++; });
  ok('load 业务失败抛错', rej === 1);
  let netErr = 0;
  await R.load('http://h', 'd', '1.0.0', () => Promise.reject(new Error('ECONNREFUSED'))).catch(() => { netErr++; });
  ok('load 网络失败抛错', netErr === 1);
  calls.length = 0;
  await R.push('http://h', 'd1', { kh_top: 1, kh_player_exe: 'x' }, fakeFetch);
  const body = JSON.parse(calls[0].opt.body);
  ok('push 用 POST + JSON', calls[0].opt.method === 'POST' && /application\/json/.test(calls[0].opt.headers['Content-Type']));
  ok('push 体内不含禁键', body.payload.kh_top === 1 && body.payload.kh_player_exe === undefined, JSON.stringify(body));
  calls.length = 0;
  await R.pull('http://h', 'd 1', fakeFetch);
  ok('pull 带 device 且编码', calls[0].url === 'http://h/api/sync/pull?device=d%201', calls[0].url);
  const noFetch = await R.load('http://h', 'd', '1', null).catch((e) => String(e && e.message));
  ok('无 fetch 时给出可读错误', /没有可用的 fetch|fetch is not/i.test(String(noFetch)) || typeof noFetch === 'string', String(noFetch));

  console.log('\n' + (fail ? '\u2716 ' : '\u2714 ') + '通过 ' + pass + ' / 失败 ' + fail);
  if (fail) { console.log('失败项：\n - ' + fails.join('\n - ')); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
