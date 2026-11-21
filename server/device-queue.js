'use strict';
/* 设备批量队列：把「给这批设备下发什么」排进队列，客户端轮询消费。
   服务端 device-queue 负责入队 / 下发 / 回报；客户端 app/index.html 的 khQueuePoller
   每 60 秒取一次 next 并 ack，两边都不需要开发端权限（客户版同样可用）。
   广播：ids 里写 'all' 或 '*' 即对全部轮询客户端生效。 */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const FILE = path.join(DATA, 'device-queue.jsonl');
const BROADCAST = ['all', '*'];

const ACTIONS = {
  update: { label: '检查更新', desc: '让客户端立即拉一次更新清单' },
  rollback: { label: '切回指定版本', desc: '把该设备的更新目标切到指定版本（需带 version）' },
  reload: { label: '重载页面', desc: '让客户端重新加载影视页' },
  report: { label: '立即回传', desc: '让客户端立刻上报一次设备能力与状态' },
  diagnose: { label: '生成诊断包', desc: '让客户端打包一次诊断报告并回传' }
};

function ensure() {
  try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) {}
}

function append(obj) {
  ensure();
  fs.appendFileSync(FILE, JSON.stringify(obj) + '\n', 'utf8');
}

/* 超过 7 天还没被执行完的条目自动作废（广播条目没有固定名单，必须有人收尾才停），
   避免队列越攒越长、也让「一直没回报」这件事在页面上看得见。 */
const EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;
function sweep(entries) {
  const now = Date.now();
  let changed = false;
  entries.forEach(function (e) {
    if (!e || e.state !== 'queued') return;
    const t = Date.parse(e.at || '');
    if (!isFinite(t)) return;
    if (now - t > EXPIRE_MS) { e.state = 'expired'; changed = true; }
  });
  if (changed) writeAll(entries);
  return entries;
}

function listInner(limit) {
  const entries = sweep(readAll());
  if (!entries.length) return { ok: true, total: 0, items: [], actions: ACTIONS };
  const items = entries.slice(-(limit || 100)).map(function (e) { return e; }).reverse();
  return { ok: true, total: entries.length, items: items, actions: ACTIONS };
}

function addInner(body) {
  const ids = Array.isArray(body && body.ids) ? body.ids.filter(Boolean) : [];
  const action = String((body && body.action) || '');
  if (!ids.length) return { ok: false, error: '没有选中设备' };
  if (!ACTIONS[action]) return { ok: false, error: '不支持的动作：' + action };
  if (action === 'rollback' && !body.version) return { ok: false, error: '切版本需要给 version' };
  /* 灰度分批：percent 1–100，按 deviceId + 入队时间做确定性哈希分流；
     未命中灰度的设备不会领到这条，命中比例≈percent%（同一设备结果稳定，不会忽领忽不领） */
  let percent = Number(body && body.percent);
  if (!isFinite(percent) || percent <= 0 || percent > 100) percent = 100;
  const entry = {
    at: new Date().toISOString(),
    ids: ids,
    action: action,
    version: body.version || null,
    note: String((body && body.note) || '').slice(0, 120),
    percent: percent,
    state: 'queued',
    consumedBy: []
  };
  append(entry);
  return { ok: true, queued: ids.length, percent: percent, entry: entry };
}

/* 确定性灰度分桶：同一 deviceId 对同一条目永远落在同一个桶，避免设备反复进出灰度 */
function kbucket(deviceId, salt) {
  const s = String(deviceId || '') + '|' + String(salt || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return h % 100;
}

function readAll() {
  let lines = [];
  try { lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/).filter(Boolean); } catch (e) { return []; }
  return lines.map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
}

function writeAll(entries) {
  ensure();
  /* 原子写：先落临时文件再改名，避免两个进程同时写时读到半截文件 */
  const tmp = FILE + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, entries.map(function (e) { return JSON.stringify(e); }).join('\n') + (entries.length ? '\n' : ''), 'utf8');
  fs.renameSync(tmp, FILE);
}

/* 跨进程写锁：同一 data 目录被多个实例（开发端 + 客户版）共用时，
   读-改-写必须串行，否则后写的会把先写的覆盖掉。锁文件超 5 秒视为陈旧锁自动清掉。 */
const LOCK = FILE + '.lock';
function sleepSync(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) {} }
function withLock(fn) {
  let fd = null, waited = 0;
  while (fd === null) {
    try { fd = fs.openSync(LOCK, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(LOCK).mtimeMs > 5000) { fs.unlinkSync(LOCK); continue; }
      } catch (_) { continue; }
      if (waited >= 3000) { try { fs.unlinkSync(LOCK); } catch (_) {} continue; }
      sleepSync(15); waited += 15;
    }
  }
  try { return fn(); }
  finally {
    try { fs.closeSync(fd); } catch (e) {}
    try { fs.unlinkSync(LOCK); } catch (e) {}
  }
}

/* 客户端取任务：按入队顺序返回第一条「发给本设备且本设备还没消费过」的条目。
   取出即记 deliveredBy（10 分钟窗口内不重复下发，客户端崩了超时后会自动重投）。 */
function nextInner(deviceId) {
  const device = String(deviceId || '').trim();
  if (!device) return { ok: false, error: '缺少 device 参数' };
  const now = Date.now();
  const TTL = 10 * 60 * 1000;
  const entries = sweep(readAll());
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || e.state === 'done' || e.state === 'cancelled' || e.state === 'expired') continue;
    const targets = Array.isArray(e.ids) ? e.ids : [];
    const hit = targets.some(function (t) { return t === device || BROADCAST.indexOf(t) >= 0; });
    if (!hit) continue;
    /* 灰度：percent<100 时只放行落在桶内的设备；桶内结果稳定，未命中的设备永远不领这条 */
    const pct = Number(e.percent);
    if (isFinite(pct) && pct > 0 && pct < 100 && kbucket(device, e.at) >= pct) continue;
    const consumed = Array.isArray(e.consumedBy) ? e.consumedBy : [];
    if (consumed.some(function (c) { return c && c.deviceId === device; })) continue;
    const delivered = Array.isArray(e.deliveredBy) ? e.deliveredBy : [];
    const recent = delivered.filter(function (d) { return d && d.deviceId === device && (now - Number(d.at || 0)) < TTL; })[0];
    if (recent) continue;
    e.deliveredBy = delivered.filter(function (d) { return d && (now - Number(d.at || 0)) < TTL; });
    e.deliveredBy.push({ deviceId: device, at: now });
    writeAll(entries);
    return { ok: true, item: { at: e.at, action: e.action, version: e.version || null, note: e.note || '', label: (ACTIONS[e.action] || {}).label || e.action }, pending: entries.filter(function (x) { return x && x.state !== 'done'; }).length };
  }
  return { ok: true, item: null, pending: entries.filter(function (x) { return x && x.state !== 'done'; }).length };
}

/* 客户端回报执行结果：落 consumedBy，全部目标消费完成后整条标记 done。 */
function ackInner(body) {
  const at = String((body && body.at) || '');
  const device = String((body && body.deviceId) || '').trim();
  if (!at || !device) return { ok: false, error: 'ack 需要 at 与 deviceId' };
  const entries = readAll();
  const e = entries.filter(function (x) { return x && x.at === at; })[0];
  if (!e) return { ok: false, error: '找不到对应队列条目' };
  e.consumedBy = Array.isArray(e.consumedBy) ? e.consumedBy : [];
  if (!e.consumedBy.some(function (c) { return c && c.deviceId === device; })) {
    e.consumedBy.push({ deviceId: device, at: new Date().toISOString(), result: String((body && body.result) || 'done').slice(0, 20), note: String((body && body.note) || '').slice(0, 200) });
  }
  const targets = Array.isArray(e.ids) ? e.ids : [];
  const isBroadcast = targets.some(function (t) { return BROADCAST.indexOf(t) >= 0; });
  /* 广播条目没有固定设备名单，永远保持 queued（同设备靠 consumedBy 去重不会再领），
     要停就清空队列；指定设备的条目在全部目标回报后落 done。 */
  if (!isBroadcast) {
    const done = targets.every(function (t) {
      return e.consumedBy.some(function (c) { return c && c.deviceId === t; });
    });
    if (done) e.state = 'done';
  }
  writeAll(entries);
  return { ok: true, state: e.state, consumed: e.consumedBy.length, broadcast: isBroadcast };
}

function clearInner() {
  ensure();
  try { fs.writeFileSync(FILE, '', 'utf8'); } catch (e) { return { ok: false, error: '清空失败：' + (e && e.message) }; }
  return { ok: true, cleared: true };
}

/* 对外入口统一过锁：读-改-写串行，多实例共用一个 data 目录也不会互相覆盖。 */
function list(limit) { return withLock(function () { return listInner(limit); }); }
function add(body) { return withLock(function () { return addInner(body); }); }
function next(deviceId) { return withLock(function () { return nextInner(deviceId); }); }
function ack(body) { return withLock(function () { return ackInner(body); }); }
function clear() { return withLock(function () { return clearInner(); }); }

module.exports = { list, add, clear, next, ack, ACTIONS };
