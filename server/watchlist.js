/**
 * 鸿汇影 · 追剧订阅（本机维度）
 * --------------------------------------------------------------
 *  - 不接账号体系、不做跨端续播；记录按设备标识分组，换设备不互通。
 *  - 订阅 / 取消 / 列表 / 已读标记落 server/data/watchlist.json。
 *  - 更新比对：当前服务端没有可比对的影片剧集目录，仅对照客户端上报的
 *    当前快照（集数 / 更新标记 / 状态）与订阅时快照，发生变化才标记更新。
 *    无云端片单源时不编造「新集上线」提醒，note 如实标注口径。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const FP = path.join(DATA, 'watchlist.json');

function readJson(dft) {
  try { return JSON.parse(fs.readFileSync(FP, 'utf8')); } catch (e) { return dft; }
}
function writeJson(obj) {
  try { fs.mkdirSync(path.dirname(FP), { recursive: true }); fs.writeFileSync(FP, JSON.stringify(obj, null, 2) + '\n'); return true; }
  catch (e) { return false; }
}
function now() { return new Date().toISOString(); }
function clip(s, n) { return String(s === undefined || s === null ? '' : s).slice(0, n); }
function cleanDevice(d) { return clip(d, 60) || 'local'; }

const LIMIT = 200;

function load() {
  const o = readJson({ schema: 1, updatedAt: null, items: [] });
  if (!o || !Array.isArray(o.items)) return { schema: 1, updatedAt: null, items: [] };
  return o;
}
function persist(o) {
  o.updatedAt = now();
  return writeJson(o);
}
function snapshotOf(entry) {
  entry = entry || {};
  return {
    title: clip(entry.title, 80),
    category: clip(entry.category, 20),
    episodes: clip(entry.episodes, 20),
    status: clip(entry.status, 20),
    version: clip(entry.version, 40)
  };
}
function snapshotChanged(a, b) {
  if (!a || !b) return false;
  return a.episodes !== b.episodes || a.status !== b.status || a.version !== b.version;
}

const watchlist = {
  add(deviceId, entry) {
    entry = entry || {};
    const id = clip(entry.id, 60);
    const title = clip(entry.title, 80);
    if (!id || !title) return { ok: false, error: '缺少条目 id 或标题' };
    const dev = cleanDevice(deviceId);
    const o = load();
    let hit = o.items.find(function (x) { return x.deviceId === dev && x.id === id; });
    if (hit) {
      hit.title = title;
      hit.category = clip(entry.category, 20);
      hit.lastCheckedAt = now();
    } else {
      if (o.items.filter(function (x) { return x.deviceId === dev; }).length >= LIMIT) {
        return { ok: false, error: '本机订阅已达上限 ' + LIMIT + ' 条，请先取消部分订阅' };
      }
      hit = {
        deviceId: dev, id: id, title: title,
        category: clip(entry.category, 20),
        subscribedAt: now(), snapshot: snapshotOf(entry),
        updated: false, lastCheckedAt: now()
      };
      o.items.push(hit);
    }
    if (!persist(o)) return { ok: false, error: '写入失败' };
    return { ok: true, item: hit };
  },
  remove(deviceId, id) {
    const dev = cleanDevice(deviceId);
    id = clip(id, 60);
    const o = load();
    o.items = o.items.filter(function (x) { return !(x.deviceId === dev && x.id === id); });
    persist(o);
    return { ok: true };
  },
  list(deviceId) {
    const dev = cleanDevice(deviceId);
    const o = load();
    return {
      ok: true,
      items: o.items.filter(function (x) { return x.deviceId === dev; }),
      note: '订阅仅保存在本机设备；当前无云端剧集目录，更新提示来自片单快照变化，不代表官方新集上线'
    };
  },
  markRead(deviceId, id) {
    const dev = cleanDevice(deviceId);
    id = clip(id, 60);
    const o = load();
    const hit = o.items.find(function (x) { return x.deviceId === dev && x.id === id; });
    if (hit) { hit.updated = false; hit.lastCheckedAt = now(); persist(o); }
    return { ok: true };
  },
  /* current: 客户端上报的当前快照数组 [{id, episodes, status, version}] */
  check(deviceId, current) {
    const dev = cleanDevice(deviceId);
    const o = load();
    const cur = {};
    (Array.isArray(current) ? current : []).forEach(function (c) { if (c && c.id) cur[String(c.id)] = c; });
    let changed = 0;
    o.items.forEach(function (x) {
      if (x.deviceId !== dev) return;
      const c = cur[x.id];
      if (!c) return;
      const snap = snapshotOf(c);
      if (snapshotChanged(x.snapshot, snap)) { x.updated = true; changed += 1; }
      x.snapshot = snap;
      x.lastCheckedAt = now();
    });
    persist(o);
    return {
      ok: true, changed: changed,
      items: o.items.filter(function (x) { return x.deviceId === dev; }),
      note: changed === 0 ? '本轮片单快照无变化' : '有 ' + changed + ' 条订阅快照发生变化（非官方新集通知）'
    };
  }
};

module.exports = { watchlist };
