#!/usr/bin/env node
/**
 * 远端配置中心自测（#69 / #70 / #71 / #77 / #66）
 * 纯逻辑 + 临时目录，绝不碰真配置：KH_CFG_DATA 指向 %TEMP% 下的一次性目录。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), 'kh_cfg_test_' + Date.now());
fs.mkdirSync(TMP, { recursive: true });
process.env.KH_CFG_DATA = TMP;

const C = require(path.join(__dirname, '..', 'server', 'config-center.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, got) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; fails.push(name + ' → ' + JSON.stringify(got)); console.log('  ✘ ' + name + ' → ' + JSON.stringify(got)); }
}

console.log('\n远端配置中心自测');

/* ---- 灰度求值 ---- */
ok('on=false 直接关', C.evalFlags({ a: { on: false } }, { device: 'd1', version: '1.7.94' }).a === false);
ok('on=true 直接开', C.evalFlags({ a: { on: true } }, { device: 'd1', version: '1.7.94' }).a === true);
ok('无 on 默认开', C.evalFlags({ a: {} }, { device: 'd1', version: '1.7.94' }).a === true);
ok('roll=0 关闭', C.evalFlags({ a: { on: true, roll: 0 } }, { device: 'd1' }).a === false);
ok('roll=100 全开', C.evalFlags({ a: { on: true, roll: 100 } }, { device: 'd1' }).a === true);
const b1 = C.bucket('devA', 'flagx');
ok('同设备同 id 哈希稳定', b1 === C.bucket('devA', 'flagx'), b1);
ok('哈希落在 0~99', b1 >= 0 && b1 <= 99, b1);
ok('不同 id 哈希可不同', C.bucket('devA', 'flagx') !== C.bucket('devA', 'flagy') || C.bucket('devA', 'flagx') === C.bucket('devA', 'flagy'));
const rollHit = C.evalFlags({ a: { on: true, roll: C.bucket('devA', 'a') + 1 } }, { device: 'devA' }).a;
ok('roll = bucket+1 命中（小于等于边界）', rollHit === true, rollHit);
const rollMiss = C.evalFlags({ a: { on: true, roll: C.bucket('devA', 'a') } }, { device: 'devA' }).a;
ok('roll = bucket 不命中（严格小于）', rollMiss === false, rollMiss);
ok('minVer 拦低版本', C.evalFlags({ a: { on: true, minVer: '1.7.90' } }, { device: 'd', version: '1.7.80' }).a === false);
ok('minVer 放行高版本', C.evalFlags({ a: { on: true, minVer: '1.7.90' } }, { device: 'd', version: '1.7.94' }).a === true);
ok('maxVer 拦高版本', C.evalFlags({ a: { on: true, maxVer: '1.7.90' } }, { device: 'd', version: '1.7.94' }).a === false);
ok('版本不明不卡版本', C.evalFlags({ a: { on: true, minVer: '1.7.90' } }, { device: 'd', version: '' }).a === true);
ok('版本区间内放行', C.evalFlags({ a: { on: true, minVer: '1.7.90', maxVer: '1.7.99' } }, { device: 'd', version: '1.7.94' }).a === true);
ok('inVerRange 同版本算命中', C.inVerRange('1.7.94', '1.7.94', '1.7.94') === true);
ok('inVerRange 低出下界', C.inVerRange('1.7.89', '1.7.90', '') === false);

/* ---- 公告 ---- */
const now = new Date('2026-11-23T10:00:00Z');
ok('公告未启用 → null', C.activeNotice({ enabled: false, title: 'x' }, now) === null);
ok('公告空标题正文 → null', C.activeNotice({ enabled: true, title: '', text: '' }, now) === null);
ok('公告生效中 → 有值', !!C.activeNotice({ enabled: true, title: '新版', text: '说明' }, now));
ok('公告未到生效时间 → null', C.activeNotice({ enabled: true, title: 'x', from: '2026-12-01T00:00:00Z' }, now) === null);
ok('公告已过失效时间 → null', C.activeNotice({ enabled: true, title: 'x', to: '2026-11-01T00:00:00Z' }, now) === null);
ok('公告级别非法回落 info', C.activeNotice({ enabled: true, title: 'x', level: 'bad' }, now).level === 'info');
ok('公告级别 warn 保留', C.activeNotice({ enabled: true, title: 'x', level: 'warn' }, now).level === 'warn');
ok('公告 onboard=false 保留', C.activeNotice({ enabled: true, title: 'x', onboard: false }, now).onboard === false);
ok('公告正文截断 400', C.activeNotice({ enabled: true, title: 'x', text: 'a'.repeat(500) }, now).text.length === 400);

/* ---- 云同步过滤 ---- */
const clean = C.sanitizePayload({
  kh_audio_lang: 'zh', kh_notify: 'download', kh_kid: 0,
  site_url: 'http://x', kh_site_url: 'http://x', kh_player_exe: 'C:/vlc.exe',
  bad_key: 1, kh_token: 'abc', kh_sub_dir: 'D:/subs',
  kh_custom: { a: 1, url: 'http://x' }, kh_big: { s: 'x'.repeat(5000) }
});
ok('保留 kh_audio_lang', clean.kh_audio_lang === 'zh');
ok('拦非 kh_ 前缀', !('bad_key' in clean));
ok('拦 site_url', !('kh_site_url' in clean) && !('site_url' in clean));
ok('拦 token', !('kh_token' in clean));
ok('拦 exe 路径键', !('kh_player_exe' in clean));
ok('拦 http 字符串值', !('kh_sub_dir' in clean) || !/^http/i.test(String(clean.kh_sub_dir)));
ok('拦含 url 的对象', !('kh_custom' in clean));
ok('拦超大对象', !('kh_big' in clean));

/* ---- 写入 / rev / 视图 ---- */
const r1 = C.patch({ notice: { enabled: true, title: '新版已发布', text: '1.7.94', level: 'event' } });
ok('首次 patch 成功', r1.ok === true, r1);
ok('rev 从 1 涨到 2', r1.rev === 2, r1.rev);
const r2 = C.patch({ locks: ['kh_audio_lang', 'kh_notify', ''], defaults: { kh_audio_lang: 'zh' }, flags: { 'x-flag': { on: true, roll: 30 } } });
ok('二次 patch 成功且 rev 再涨', r2.ok === true && r2.rev === 3, r2);
const g = C.get();
ok('锁定向去空', g.locks.length === 2, g.locks);
ok('默认值落库', g.defaults.kh_audio_lang === 'zh');
ok('灰度落库', g.flags['x-flag'].roll === 30);
const v = C.view({ device: 'dev1', version: '1.7.94' });
ok('视图带 rev', v.rev === 3, v.rev);
ok('视图带锁定项', Array.isArray(v.locks) && v.locks.length === 2);
ok('视图带求值后的 flags', typeof v.flags['x-flag'] === 'boolean', v.flags);
ok('视图带公告', !!v.notice && v.notice.title === '新版已发布');
ok('视图带同步开关', v.sync.enabled === true);
const badFlag = C.patch({ flags: { 'x-flag': { on: 'yes', roll: 500 } } });
ok('patch 后 roll 夹到 100', C.get().flags['x-flag'].roll === 100, C.get().flags['x-flag']);
ok('patch 后 on 归一为 true', C.get().flags['x-flag'].on === true);

/* ---- 云同步 push / pull ---- */
const s1 = C.syncPush('deviceA', { kh_audio_lang: 'zh', kh_top: 1, kh_site_url: 'http://x' });
ok('push 成功', s1.ok === true, s1);
ok('push 只收合规键（2 个）', s1.keys === 2, s1.keys);
const p1 = C.syncPull('deviceB');
ok('另一台设备能拉到自己没有的槽', p1.ok === true && p1.empty === false, p1);
ok('拉回来的值正确', p1.payload.kh_audio_lang === 'zh' && p1.payload.kh_top === 1);
const p2 = C.syncPull('deviceA');
ok('自己拉不返回自己的槽', p2.empty === true, p2);
const s2 = C.syncPush('deviceB', { kh_notify: 'off' });
const p3 = C.syncPull('deviceA');
ok('两台都有时拉最近更新的那台', p3.from === 'deviceB', p3.from);
ok('空 payload 拒收', C.syncPush('deviceC', { kh_site_url: 'http://x' }).ok === false);
const peers = C.syncAll();
ok('peers 列出两个槽', peers.peers.length === 2, peers.peers.length);

/* ---- 存储载体信息 ---- */
const sc = C.schemaInfo();
ok('载体信息带 rev / digest', sc.ok === true && sc.rev > 0 && /^[0-9a-f]{16}$/.test(sc.digest), sc.digest);
ok('载体信息明示非加密', sc.note.indexOf('非加密') >= 0);

/* ---- 清场 ---- */
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}

console.log('\n远端配置中心自测：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log('失败项：'); fails.forEach((x) => console.log('  - ' + x)); process.exit(1); }
