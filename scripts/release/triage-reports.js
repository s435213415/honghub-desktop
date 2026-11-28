#!/usr/bin/env node
/* 问题回执台账（分发后「坏了我能知道」的最小落地）
   读本机中枢收到的客户端上报（server\data\reports-*.jsonl），按指纹汇总，
   再叠加本地处理状态（logs\report-triage.json），输出「还欠着谁」的清单。
   不改服务端、不发网络请求，纯本地文件；状态只存在这台机器上。

   用法：
     node scripts\release\triage-reports.js                 # 看待处理清单
     node scripts\release\triage-reports.js --all           # 连已处理的一起看
     node scripts\release\triage-reports.js --md            # 同时写一份 Markdown 到 logs\
     node scripts\release\triage-reports.js --set a1b2c3 --status fixed --note "1.7.98 修掉了"
   状态值：new（收到未看）/ triaged（看过，暂不改）/ fixed（已修）/ wontfix（不修，附原因）
   --set 的 key 可只给前 6 位，脚本会做唯一前缀匹配；匹配到多条会拒绝，避免标错。*/
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'server', 'data');
const LOGS = path.join(ROOT, 'logs');
const TRIAGE = path.join(LOGS, 'report-triage.json');
const DAYS = 4;                     /* 回溯天数，与服务端保留窗口对齐即可 */

const STATUS = { new: '待看', triaged: '看过·暂不改', fixed: '已修', wontfix: '不修' };

function clip(v, n) { const s = String(v == null ? '' : v); return s.length > n ? s.slice(0, n) : s; }
function keyOf(it) {
  /* 必须与服务端 stats() 的指纹口径一致，否则和历史闭环率对不上 */
  return [it.kind, it.code || '', it.view || '', it.host || '', it.ver || '', it.plat || '', String(it.msg || '').slice(0, 60)].join('|');
}
function readReports() {
  const out = [];
  if (!fs.existsSync(DATA)) return out;
  const files = fs.readdirSync(DATA).filter((f) => /^reports(-\d{4}-\d{2}-\d{2})?\.jsonl$/.test(f));
  files.sort();
  for (const f of files.slice(-DAYS * 2)) {
    let lines = [];
    try { lines = fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean); } catch (e) { continue; }
    for (const l of lines) { try { const r = JSON.parse(l); if (r && Array.isArray(r.issues)) out.push(r); } catch (e) {} }
  }
  return out;
}
function loadTriage() {
  try { const m = JSON.parse(fs.readFileSync(TRIAGE, 'utf8')); return (m && typeof m === 'object') ? m : {}; } catch (e) { return {}; }
}
function saveTriage(m) {
  if (!fs.existsSync(LOGS)) fs.mkdirSync(LOGS, { recursive: true });
  fs.writeFileSync(TRIAGE, JSON.stringify(m, null, 2), 'utf8');
}

function aggregate() {
  const fp = new Map();
  for (const r of readReports()) {
    for (const it of (r.issues || [])) {
      const k = keyOf(it);
      const e = fp.get(k) || { key: k, kind: it.kind, code: it.code || '', host: it.host || '', plat: it.plat || '',
        msg: String(it.msg || ''), n: 0, devices: new Set(), first: 0, last: 0, ver: it.ver || '' };
      e.n += (Number(it.n) || 1);
      if (r.deviceId) e.devices.add(r.deviceId);
      const t1 = Number(it.lastTs || it.ts || r.receivedAt) || 0;
      if (t1 > e.last) { e.last = t1; e.ver = it.ver || e.ver; }
      const t0 = Number(it.firstTs || it.ts || r.receivedAt) || 0;
      if (!e.first || (t0 && t0 < e.first)) e.first = t0;
      fp.set(k, e);
    }
  }
  return Array.from(fp.values()).sort((a, b) => b.last - a.last);
}

function fmtTs(t) { try { return new Date(t).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return '-'; } }

const argv = process.argv.slice(2);
const triage = loadTriage();

if (argv[0] === '--set') {
  const pfx = String(argv[1] || '');
  const st = (argv[argv.indexOf('--status') + 1] || '').trim();
  const note = (argv[argv.indexOf('--note') + 1] || '').trim();
  if (!pfx || !STATUS[st]) { console.error('用法：--set <key或前6位> --status new|triaged|fixed|wontfix [--note "说明"]'); process.exit(2); }
  const rows = aggregate();
  const hit = rows.filter((r) => r.key.indexOf(pfx) === 0);
  if (hit.length === 0) { console.error('没有匹配的指纹：' + pfx); process.exit(2); }
  if (hit.length > 1) { console.error('前缀匹配到 ' + hit.length + ' 条，请给更长的 key：'); for (const h of hit) console.error('  ' + h.key.slice(0, 48) + '  · ' + h.kind + ' · ' + h.msg.slice(0, 40)); process.exit(2); }
  const k = hit[0].key;
  triage[k] = { status: st, note: note.slice(0, 200), at: Date.now(), kind: hit[0].kind, msg: hit[0].msg.slice(0, 80) };
  saveTriage(triage);
  console.log('已标记：' + STATUS[st] + (note ? ' · ' + note : ''));
  console.log('  ' + k.slice(0, 60));
  process.exit(0);
}

const rows = aggregate();
const showAll = argv.indexOf('--all') >= 0;
const list = rows.filter((r) => showAll || !(triage[r.key] && (triage[r.key].status === 'fixed' || triage[r.key].status === 'wontfix')));

console.log('问题回执台账 · ' + fmtTs(Date.now()));
console.log('上报文件 ' + (fs.existsSync(DATA) ? fs.readdirSync(DATA).filter((f) => /^reports/.test(f)).length : 0) + ' 个 · 指纹 ' + rows.length + ' 条 · 本次显示 ' + list.length + ' 条' + (showAll ? '（含已处理）' : '（只显示未收口）'));
if (!list.length) {
  console.log(rows.length ? '\n没有未收口的问题。' : '\n还没有收到客户端上报。客户端在设置里开启「远程收集」后才会回传。');
  process.exit(0);
}
console.log('');
for (const r of list) {
  const t = triage[r.key] || { status: 'new', note: '' };
  console.log('[' + (STATUS[t.status] || t.status) + '] ' + r.kind + (r.code ? ' / ' + r.code : '') + ' ×' + r.n + ' · 设备 ' + r.devices.size + ' · 最后 ' + fmtTs(r.last) + (r.ver ? ' · v' + r.ver : ''));
  console.log('    key ' + r.key.slice(0, 16) + '…  ' + (r.host ? r.host + ' · ' : '') + (r.plat ? r.plat + ' · ' : '') + r.msg.slice(0, 90));
  if (t.note) console.log('    备注：' + t.note);
}
console.log('\n标记示例：node scripts\\release\\triage-reports.js --set <key前6位> --status fixed --note "1.7.98 修掉了"');

if (argv.indexOf('--md') >= 0) {
  const d = new Date(); const p2 = (n) => String(n).padStart(2, '0');
  const name = 'report-triage-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '.md';
  const md = ['# 问题回执台账 ' + fmtTs(Date.now()), '', '| 状态 | 类型 | 次数 | 设备 | 最后出现 | 说明 |', '|---|---|---|---|---|---|']
    .concat(list.map((r) => {
      const t = triage[r.key] || { status: 'new', note: '' };
      return '| ' + (STATUS[t.status] || t.status) + ' | ' + r.kind + (r.code ? '/' + r.code : '') + ' | ' + r.n + ' | ' + r.devices.size + ' | ' + fmtTs(r.last) + ' | ' + String(r.msg || '').replace(/\|/g, '/').slice(0, 80) + (t.note ? '（' + t.note + '）' : '') + ' |';
    })).join('\n');
  fs.writeFileSync(path.join(LOGS, name), md + '\n', 'utf8');
  console.log('已写：logs\\' + name);
}
