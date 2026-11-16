/**
 * HongHub · 资源目录与自动跟进引擎（catalog / probe / play / issues）
 * --------------------------------------------------------------
 * 目标：客户端「看得见所有频道与平台」，播不了自动回传，开发者端自动跟进到解决。
 *
 * 全自动闭环（默认开启，无需人工）：
 *   探测全量资源 → 生成统一目录（带版本号，客户端可增量热更新）
 *   → 吃客户端播放埋点 → 失败率超阈值自动建单
 *   → 频道类自动换可用源并回写清单 → 复探测验证 → 自动关单
 *   → 平台类不可修复则自动标记限流展示并继续跟踪
 *   → 每 7 天自动出覆盖度周报
 *
 * 零依赖；所有落盘在 server/data/。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const SERVER_DIR = __dirname;
const DATA_DIR = path.join(SERVER_DIR, 'data');
const MANIFEST_FILE = path.join(SERVER_DIR, 'manifest.json');
const CATALOG_FILE = path.join(DATA_DIR, 'catalog.json');
const PLAY_FILE = path.join(DATA_DIR, 'play.jsonl');
const ISSUE_FILE = path.join(DATA_DIR, 'issues.json');
const ISSUE_LOG = path.join(DATA_DIR, 'issues-log.jsonl');
const WEEKLY_FILE = path.join(DATA_DIR, 'weekly.json');
const LAST_CYCLE = path.join(DATA_DIR, 'catalog-cycle.json');
const KEEP_PLAY = 20000;

let devops = null;
try { devops = require('./devops'); } catch (e) { devops = null; }

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* 只读环境 */ }

function now() { return Date.now(); }
function iso(t) { return new Date(t || now()).toISOString(); }
function clip(s, n) { return String(s == null ? '' : s).slice(0, n); }
function readJson(file, def) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return def; } }
function writeJson(file, obj) {
  try { fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n'); return true; } catch (e) { return false; }
}
function append(file, obj) {
  try { fs.appendFileSync(file, JSON.stringify(obj) + '\n'); return true; } catch (e) { return false; }
}
function tail(file, n) {
  try {
    const all = fs.readFileSync(file, 'utf8').trim().split('\n');
    return all.slice(-n).filter(Boolean).map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}
function auditOk(a) { try { if (devops) devops.audit('catalog.' + a); } catch (e) {} }
function metric(type, fields) { try { if (devops) devops.metric(type, fields); } catch (e) {} }

/* ---------------- 目录构建 ---------------- */
function readManifest() { return readJson(MANIFEST_FILE, { sources: { channels: [], sites: [] }, release: {} }); }
function siteId(name) { return 'site:' + crypto.createHash('sha1').update(String(name)).digest('hex').slice(0, 8); }

function normalize(manifest) {
  const chs = (manifest.sources && manifest.sources.channels) || [];
  const sites = (manifest.sources && manifest.sources.sites) || [];
  const items = [];
  chs.forEach(function (ch) {
    items.push({
      id: 'ch:' + (ch.id || ch.name),
      type: 'channel',
      name: ch.name,
      group: ch.group || '其他',
      region: 'cn',
      sourceCount: (ch.sources || []).length,
      sources: (ch.sources || []).map(function (s, i) { return { label: s.label || ('源' + (i + 1)), url: s.url, status: s.status || 'unknown' }; })
    });
  });
  sites.forEach(function (s) {
    const reg = s.region || (s.mode === 'oversea' ? 'oversea' : 'cn');
    items.push({
      id: siteId(s.name),
      type: 'platform',
      name: s.name,
      group: s.cat || '其他平台',
      region: reg,
      url: s.url,
      mode: s.mode || 'pc',
      entryOnly: s.entryOnly !== false,   // 官方入口默认只跳转播放，不抓流
      official: s.official !== false,
      note: s.note || ''
    });
  });
  return items;
}
function catalogVersion(items) { return 'c' + crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 10); }

/* ---------------- 可达性探测 ---------------- */
function probe(url, timeout) {
  return new Promise(function (resolve) {
    let done = false, started = now();
    const finish = function (r) { if (done) return; done = true; resolve(r); };
    let req;
    try {
      const mod = String(url).indexOf('https:') === 0 ? https : http;
      req = mod.get(url, { timeout: timeout || 4000, headers: { 'User-Agent': 'HongHub-Probe/1.0', Range: 'bytes=0-0', Accept: '*/*' } }, function (res) {
        const code = res.statusCode || 0;
        res.destroy();
        finish({ code: code, ms: now() - started, err: null });
      });
      req.on('timeout', function () { req.destroy(); finish({ code: 0, ms: now() - started, err: 'timeout' }); });
      req.on('error', function (e) { finish({ code: 0, ms: now() - started, err: clip(e && e.code || e && e.message || 'error', 40) }); });
    } catch (e) {
      finish({ code: 0, ms: now() - started, err: clip(e && e.message || 'bad-url', 40) });
    }
  });
}
function statusOf(r) {
  if (r.err === 'timeout') return 'slow';
  if (!r.code) return 'dead';
  if (r.code >= 200 && r.code < 400) return 'ok';
  if (r.code === 403 || r.code === 451 || r.code === 401) return 'blocked';
  if (r.code >= 500 || r.code === 404 || r.code === 410) return 'dead';
  return 'degraded';
}
async function mapLimit(list, limit, fn) {
  const out = [];
  let i = 0;
  const workers = new Array(Math.min(limit, list.length || 1)).fill(0).map(async function () {
    while (i < list.length) {
      const idx = i++;
      out[idx] = await fn(list[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

async function probeAll(items, timeout) {
  const jobs = [];
  items.forEach(function (it) {
    if (it.type === 'channel') {
      (it.sources || []).forEach(function (s, i) { jobs.push({ it: it, s: s, i: i }); });
    } else if (it.url) {
      jobs.push({ it: it, s: { url: it.url, label: '主页' }, i: 0 });
    }
  });
  const res = await mapLimit(jobs, 10, async function (j) {
    const r = await probe(j.s.url, timeout);
    return { j: j, r: r };
  });
  items.forEach(function (it) { if (it.type === 'channel') { it.sources.forEach(function (s) { s.status = 'never'; s.ms = 0; }); } });
  res.forEach(function (x) {
    const it = x.j.it;
    if (it.type === 'channel') {
      const s = it.sources[x.j.i];
      s.status = statusOf(x.r);
      s.ms = x.r.ms;
      s.code = x.r.code;
      s.error = x.r.err;
      s.checkedAt = iso();
    } else {
      it.status = statusOf(x.r);
      it.ms = x.r.ms;
      it.code = x.r.code;
      it.error = x.r.err;
      it.checkedAt = iso();
    }
  });
  items.forEach(function (it) {
    if (it.type === 'channel') {
      const ss = it.sources || [];
      const best = ss.find(function (s) { return s.status === 'ok'; }) || ss.find(function (s) { return s.status === 'slow'; }) || ss[0];
      it.status = best ? best.status : 'dead';
      it.ms = best ? best.ms || 0 : 0;
      it.checkedAt = iso();
      it.preferred = ss.indexOf(best);
    }
  });
  items.forEach(function (it) { if (it.type === 'platform') it.sourceCount = 1; });
  return items;
}

/* ---------------- 播放埋点 ---------------- */
const ERROR_CODES = ['timeout', '404', '403', 'decode', 'dns', 'no-player', 'region', 'other'];
function ingestPlay(raw) {
  const id = clip(raw && raw.catalogId, 64);
  if (!id) return { ok: false, error: '缺少 catalogId' };
  const action = clip(raw.action, 16) || 'open';
  if (!['open', 'start', 'firstFrame', 'fail', 'exit'].includes(action)) return { ok: false, error: 'action 非法' };
  const rec = {
    at: now(), catalogId: id, type: clip(raw.type, 16) || (id.indexOf('ch:') === 0 ? 'channel' : 'platform'),
    action: action, errorCode: action === 'fail' ? (ERROR_CODES.includes(raw.errorCode) ? raw.errorCode : 'other') : null,
    latencyMs: Math.max(0, Math.min(600000, Number(raw.latencyMs) || 0)),
    region: clip(raw.region, 24) || 'cn', device: clip(raw.deviceId, 40), app: clip(raw.appVersion, 24)
  };
  append(PLAY_FILE, rec);
  return { ok: true, recorded: true, id: id };
}
function aggregatePlay(days) {
  const since = now() - (Number(days) || 1) * 86400000;
  const recs = tail(PLAY_FILE, KEEP_PLAY).filter(function (r) { return r.at >= since; });
  const map = {};
  recs.forEach(function (r) {
    const m = map[r.catalogId] || (map[r.catalogId] = { catalogId: r.catalogId, type: r.type, samples: 0, opens: 0, starts: 0, fails: 0, errors: {}, regions: {}, latency: [], last: 0 });
    m.samples += 1;
    if (r.action === 'open') m.opens += 1;
    if (r.action === 'start' || r.action === 'firstFrame') m.starts += 1;
    if (r.action === 'fail') { m.fails += 1; m.errors[r.errorCode || 'other'] = (m.errors[r.errorCode || 'other'] || 0) + 1; }
    m.regions[r.region || 'cn'] = (m.regions[r.region || 'cn'] || 0) + 1;
    if (r.latencyMs) m.latency.push(r.latencyMs);
    m.last = Math.max(m.last, r.at);
  });
  Object.keys(map).forEach(function (k) {
    const m = map[k];
    m.failRate = m.samples ? Math.round((m.fails / m.samples) * 1000) / 10 : 0;
    m.avgLatency = m.latency.length ? Math.round(m.latency.reduce(function (a, b) { return a + b; }, 0) / m.latency.length) : 0;
    delete m.latency;
  });
  const tops = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.fails - a.fails; }).slice(0, 10);
  return { days: Number(days) || 1, total: recs.length, items: Object.keys(map).length, byId: map, topFailing: tops };
}

/* ---------------- 问题单（全自动状态机） ---------------- */
function loadIssues() { const d = readJson(ISSUE_FILE, { list: [] }); return Array.isArray(d.list) ? d : { list: [] }; }
function saveIssues(d) { writeJson(ISSUE_FILE, d); }
function findIssue(d, catalogId) { return (d.list || []).find(function (i) { return i.catalogId === catalogId && i.status !== 'resolved'; }); }

function openIssue(d, item, reason, extra) {
  let is = findIssue(d, item.id);
  if (is) {
    is.lastAt = now(); is.reason = reason;
    is.samples += extra && extra.samples || 0;
    is.failureRate = extra && extra.failureRate != null ? extra.failureRate : is.failureRate;
    is.errors = Object.assign(is.errors || {}, extra && extra.errors || {});
    is.regions = Object.assign(is.regions || {}, extra && extra.regions || {});
    return is;
  }
  is = {
    id: 'iss-' + crypto.createHash('sha1').update(item.id + ':' + now()).digest('hex').slice(0, 10),
    catalogId: item.id, type: item.type, name: item.name, group: item.group,
    status: 'open', auto: true, reason: reason,
    samples: extra && extra.samples || 0, failureRate: extra && extra.failureRate != null ? extra.failureRate : null,
    errors: (extra && extra.errors) || {}, regions: (extra && extra.regions) || {},
    firstAt: now(), lastAt: now(), attempts: 0, fixes: []
  };
  d.list.unshift(is);
  append(ISSUE_LOG, { at: now(), act: 'open', id: is.id, catalogId: is.catalogId, reason: reason });
  metric('issue', { act: 'open', type: item.type, id: is.catalogId });
  return is;
}
function resolveIssue(d, is, how) {
  is.status = 'resolved'; is.resolvedAt = now(); is.lastAt = now(); is.resolvedBy = how || 'auto-probe-ok';
  append(ISSUE_LOG, { at: now(), act: 'resolve', id: is.id, catalogId: is.catalogId, how: is.resolvedBy });
  metric('issue', { act: 'resolve', type: is.type, id: is.catalogId });
}

/* ---------------- 自动修复：频道换源 ---------------- */
function fixChannelSource(item) {
  const m = readManifest();
  const chs = (m.sources && m.sources.channels) || [];
  const hit = chs.find(function (c) { return ('ch:' + (c.id || c.name)) === item.id; });
  if (!hit) return { ok: false, action: 'none', detail: '清单中未找到该频道' };
  const okIdx = (item.sources || []).findIndex(function (s) { return s.status === 'ok'; });
  if (okIdx < 0) return { ok: false, action: 'none', detail: '暂无可用源（全部不可达）' };
  if (okIdx === 0) return { ok: false, action: 'none', detail: '首选源已可用，无需切换' };
  const list = (hit.sources || []).slice();
  const pick = list.splice(okIdx, 1)[0];
  pick.label = pick.label || '直播主源';
  const reordered = [pick].concat(list);
  reordered.forEach(function (s, i) {
    s.label = i === 0 ? '直播主源' : ('备用源 ' + (i + 1));
    if (i > 0) s.status = 'dead';
  });
  hit.sources = reordered;
  hit.sourceCount = reordered.length;
  try { fs.copyFileSync(MANIFEST_FILE, path.join(DATA_DIR, 'manifest.before-auto-fix.json')); } catch (e) {}
  const src = m.sources;
  src.v = (Number(src.v) || 0) + 1;
  src.updatedAt = iso();
  m.sources = src;
  writeJson(MANIFEST_FILE, m);
  return { ok: true, action: 'switch-source', detail: '已把可用源提到首位（' + (pick.label || '可用源') + '），清单版本升到 ' + src.v, from: list.length + 1 + '源' };
}
async function verifyChannel(item) {
  const m = readManifest();
  const chs = (m.sources && m.sources.channels) || [];
  const hit = chs.find(function (c) { return ('ch:' + (c.id || c.name)) === item.id; });
  if (!hit || !(hit.sources || [])[0]) return false;
  const r = await probe(hit.sources[0].url, 4000);
  return statusOf(r) === 'ok';
}

/* ---------------- 一轮自动巡检 ---------------- */
async function runCycle(opts) {
  opts = opts || {};
  const timeout = Number(opts.timeout) || 4000;
  const doProbe = opts.probe !== false;
  const started = now();
  const manifest = readManifest();
  const items = normalize(manifest);
  if (doProbe) await probeAll(items, timeout);
  const version = catalogVersion(items);
  const totals = { items: items.length, channels: 0, platforms: 0, ok: 0, slow: 0, dead: 0, blocked: 0, degraded: 0 };
  const groups = {};
  items.forEach(function (it) {
    totals[it.type === 'channel' ? 'channels' : 'platforms'] += 1;
    const st = it.status || 'dead';
    totals[st === 'unknown' ? 'dead' : st] = (totals[st === 'unknown' ? 'dead' : st] || 0) + 1;
    groups[it.group] = (groups[it.group] || 0) + 1;
  });
  const play = aggregatePlay(1);
  const d = loadIssues();

  // 1) 自动建单：探测失败或近 24h 失败率 ≥ 30% 且样本 ≥ 5
  items.forEach(function (it) {
    const p = play.byId[it.id];
    const badProbe = it.status === 'dead' || it.status === 'blocked';
    const badPlay = p && p.samples >= 5 && p.failRate >= 30;
    if (badProbe || badPlay) {
      openIssue(d, it, badProbe ? ('探测' + it.status) : ('播放失败率 ' + p.failRate + '%'), p ? { samples: p.samples, failureRate: p.failRate, errors: p.errors, regions: p.regions } : {});
    } else if (d.list.some(function (i) { return i.catalogId === it.id && i.status !== 'resolved'; }) && it.status === 'ok') {
      const is = d.list.find(function (i) { return i.catalogId === it.id && i.status !== 'resolved'; });
      resolveIssue(d, is, 'probe-ok');
    }
  });

  // 2) 自动修复：仅对频道类，换源后立即复探测验证
  const fixActions = [];
  if (opts.fix !== false) {
    for (const is of d.list.filter(function (i) { return i.status === 'open' && i.type === 'channel'; })) {
      const it = items.find(function (x) { return x.id === is.catalogId; });
      if (!it || it.status === 'ok') continue;
      is.attempts += 1;
      const fx = fixChannelSource(it);
      is.fixes.push({ at: now(), action: fx.action, detail: fx.detail, ok: !!fx.ok });
      if (fx.ok) {
        const okVerify = await verifyChannel(it);
        is.fixes[is.fixes.length - 1].verified = okVerify;
        if (okVerify) { resolveIssue(d, is, 'auto-switch-source'); }
        fixActions.push({ id: is.id, catalogId: is.catalogId, action: fx.action, verified: okVerify });
      } else {
        is.status = is.attempts >= 3 ? 'tracking' : 'open';
        is.lastAt = now();
      }
    }
    for (const is of d.list.filter(function (i) { return i.status === 'open' && i.type === 'platform'; })) {
      is.attempts += 1;
      is.lastAt = now();
      is.status = is.attempts >= 3 ? 'tracking' : 'open';
      if (is.attempts >= 3) is.note = '平台侧限制（地区/防盗链），已自动降级展示并持续跟踪；不涉及绕过';
    }
  }

  const summary = {
    at: now(), startedAt: started, tookMs: now() - started, version: version,
    totals: totals, groups: groups,
    play: { total: play.total, items: play.items, topFailing: play.topFailing.map(function (x) { return { catalogId: x.catalogId, fails: x.fails, failRate: x.failRate }; }) },
    issues: {
      open: d.list.filter(function (i) { return i.status === 'open'; }).length,
      tracking: d.list.filter(function (i) { return i.status === 'tracking'; }).length,
      resolved: d.list.filter(function (i) { return i.status === 'resolved'; }).length,
      autoFixedThisRun: fixActions.filter(function (f) { return f.verified; }).length
    },
    fixes: fixActions, auto: true, manual: 0
  };
  const catalog = {
    schema: 2, version: version, generatedAt: iso(), sourceManifestVersion: manifest.sources ? manifest.sources.v : null,
    totals: totals, groups: Object.keys(groups).map(function (k) { return { name: k, count: groups[k] }; }),
    items: items.map(function (it) { return Object.assign({}, it, { failRate: (play.byId[it.id] || {}).failRate || 0, samples: (play.byId[it.id] || {}).samples || 0 }); })
  };
  writeJson(CATALOG_FILE, catalog);
  writeJson(path.join(DATA_DIR, 'catalog-snapshot-' + String(version).slice(0, 24) + '.json'), catalog);
  saveIssues(d);
  writeJson(LAST_CYCLE, summary);
  metric('catalog', { items: totals.items, ok: totals.ok, dead: totals.dead, open: summary.issues.open, fixed: summary.issues.autoFixedThisRun });
  auditOk('cycle ' + version + ' · ok=' + totals.ok + '/' + totals.items + ' · fixed=' + summary.issues.autoFixedThisRun);
  weekly(false);
  return summary;
}

/* ---------------- 周报 ---------------- */
function weekly(force) {
  const old = readJson(WEEKLY_FILE, null);
  if (!force && old && now() - (old.at || 0) < 7 * 86400000) return old;
  const items = (readJson(CATALOG_FILE, { items: [] }).items || []);
  const d = loadIssues();
  const play = aggregatePlay(7);
  const byGroup = {};
  items.forEach(function (it) {
    const g = byGroup[it.group] || (byGroup[it.group] = { total: 0, ok: 0 });
    g.total += 1; if (it.status === 'ok') g.ok += 1;
  });
  const rep = {
    at: now(), windowDays: 7,
    coverage: {
      items: items.length,
      channels: items.filter(function (i) { return i.type === 'channel'; }).length,
      platforms: items.filter(function (i) { return i.type === 'platform'; }).length,
      available: items.filter(function (i) { return i.status === 'ok'; }).length,
      unavailable: items.filter(function (i) { return i.status !== 'ok'; }).length
    },
    byGroup: Object.keys(byGroup).map(function (k) { return { group: k, total: byGroup[k].total, ok: byGroup[k].ok }; }),
    deadTop: items.filter(function (i) { return i.status === 'dead' || i.status === 'blocked'; })
      .slice(0, 20).map(function (i) { return { name: i.name, type: i.type, status: i.status }; }),
    play: { total: play.total, items: play.items, top: play.topFailing.slice(0, 10) },
    issues: { open: d.list.filter(function (i) { return i.status === 'open'; }).length, tracking: d.list.filter(function (i) { return i.status === 'tracking'; }).length, resolved: d.list.filter(function (i) { return i.status === 'resolved'; }).length },
    auto: true
  };
  writeJson(WEEKLY_FILE, rep);
  try {
    const md = ['# 鸿汇影资源覆盖周报', '', '生成：' + iso(rep.at), '',
      '- 资源总数：' + rep.coverage.items + '（频道 ' + rep.coverage.channels + ' / 平台 ' + rep.coverage.platforms + '）',
      '- 可用：' + rep.coverage.available + ' · 不可用：' + rep.coverage.unavailable, '',
      '## 分组覆盖'].concat(rep.byGroup.map(function (g) { return '- ' + g.group + '：' + g.ok + '/' + g.total; }))
      .concat(['', '## 失效 Top 20'].concat(rep.deadTop.map(function (x) { return '- ' + x.name + '（' + x.type + '，' + x.status + '）'; })))
      .concat(['', '## 播放失败 Top', ''].concat(rep.play.top.map(function (x) { return '- ' + x.catalogId + '：失败 ' + x.fails + ' 次，失败率 ' + x.failRate + '%'; })))
      .join('\n') + '\n';
    fs.writeFileSync(path.join(DATA_DIR, 'weekly.md'), md);
  } catch (e) {}
  return rep;
}

/* ---------------- 第三方站点接入（自定义网址 / 批量导入 / 移除） ---------------- */
function normUrl(u) {
  const s = String(u || '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(s)) return null;
  try { const x = new URL(s); return x.toString(); } catch (e) { return null; }
}
function addSites(list) {
  const m = readManifest();
  m.sources = m.sources || {};
  m.sources.sites = m.sources.sites || [];
  const have = new Set(m.sources.sites.map(function (s) { return String(s.url || '').replace(/\/+$/, '').toLowerCase(); }));
  const names = new Set(m.sources.sites.map(function (s) { return String(s.name || '').toLowerCase(); }));
  const added = [], skipped = [];
  (Array.isArray(list) ? list : [list]).forEach(function (raw) {
    const item = typeof raw === 'string' ? { url: raw } : (raw || {});
    const url = normUrl(item.url);
    if (!url) { skipped.push({ url: item.url || '', reason: '只接受 http/https 网址' }); return; }
    const key = url.replace(/\/+$/, '').toLowerCase();
    if (have.has(key)) { skipped.push({ url: url, reason: '已存在' }); return; }
    let name = clip(item.name, 40);
    if (!name) { try { name = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { name = '第三方站点'; } }
    if (names.has(name.toLowerCase())) name = name + ' · ' + new URL(url).hostname;
    const rec = {
      name: name, url: url, color: clip(item.color, 12) || '#3B456B',
      cat: clip(item.cat, 24) || '第三方站点',
      region: clip(item.region, 16) || 'cn',
      mode: clip(item.mode, 10) || 'pc',
      entryOnly: item.entryOnly !== false,
      official: item.official !== false,
      note: clip(item.note, 80) || '第三方站点：仅跳转官方页面，不做抓流与绕过',
      addedBy: 'api', addedAt: iso()
    };
    m.sources.sites.push(rec);
    have.add(key); names.add(String(name).toLowerCase());
    added.push({ id: siteId(name), name: name, url: url, cat: rec.cat });
  });
  if (added.length) {
    try { fs.copyFileSync(MANIFEST_FILE, path.join(DATA_DIR, 'manifest.before-site-add.json')); } catch (e) {}
    m.sources.v = (Number(m.sources.v) || 0) + 1;
    m.sources.updatedAt = iso();
    m.sources.siteCount = m.sources.sites.length;
    writeJson(MANIFEST_FILE, m);
    auditOk('site.add ' + added.length + ' → v' + m.sources.v);
    metric('site', { act: 'add', n: added.length });
  }
  return { ok: true, added: added.length, skipped: skipped.length, items: added, skipDetail: skipped, manifestVersion: m.sources.v, totalSites: m.sources.sites.length };
}
function removeSite(key) {
  const m = readManifest();
  const sites = (m.sources && m.sources.sites) || [];
  const k = String(key || '').trim();
  const idx = sites.findIndex(function (s) { return siteId(s.name) === k || String(s.name) === k || String(s.url) === k; });
  if (idx < 0) return { ok: false, error: '未找到该站点' };
  const gone = sites.splice(idx, 1)[0];
  try { fs.copyFileSync(MANIFEST_FILE, path.join(DATA_DIR, 'manifest.before-site-remove.json')); } catch (e) {}
  m.sources.v = (Number(m.sources.v) || 0) + 1;
  m.sources.updatedAt = iso();
  m.sources.siteCount = sites.length;
  writeJson(MANIFEST_FILE, m);
  auditOk('site.remove ' + gone.name);
  metric('site', { act: 'remove', n: 1 });
  return { ok: true, removed: gone.name, totalSites: sites.length, manifestVersion: m.sources.v };
}
function listSites() {
  const m = readManifest();
  const sites = (m.sources && m.sources.sites) || [];
  return {
    ok: true, total: sites.length, manifestVersion: m.sources && m.sources.v,
    sites: sites.map(function (s) {
      return { id: siteId(s.name), name: s.name, url: s.url, cat: s.cat, region: s.region || (s.mode === 'oversea' ? 'oversea' : 'cn'), mode: s.mode, entryOnly: s.entryOnly !== false, addedBy: s.addedBy || 'builtin' };
    })
  };
}

/* ---------------- 运行时自动调度 ---------------- */
let timer = null;
let lastRun = null;
function startAuto(intervalMs) {
  const ms = Math.max(60000, Number(intervalMs) || 15 * 60000);
  if (timer) return timer;
  const tick = function () { runCycle().catch(function (e) { auditOk('cycle-error ' + clip(e && e.message, 60)); }); };
  setTimeout(tick, 2000);
  timer = setInterval(tick, ms);
  if (timer.unref) timer.unref();
  return { intervalMs: ms };
}

module.exports = {
  normalize, probe, probeAll, runCycle, startAuto, ingestPlay, aggregatePlay,
  addSites, removeSite, listSites,
  catalog: function () { return readJson(CATALOG_FILE, { schema: 2, items: [], totals: {}, version: null }); },
  diff: function (since) {
    const cur = readJson(CATALOG_FILE, { items: [] });
    if (!since) return { version: cur.version, since: null, added: [], removed: [], changed: [] };
    const old = readJson(path.join(DATA_DIR, 'catalog-snapshot-' + String(since).slice(0, 24) + '.json'), null);
    if (!old) return { version: cur.version, since: since, added: [], removed: [], changed: [], note: '无该版本快照，请全量拉取' };
    const o = {}; (old.items || []).forEach(function (i) { o[i.id] = i; });
    const n = {}; (cur.items || []).forEach(function (i) { n[i.id] = i; });
    return {
      version: cur.version, since: since,
      added: Object.keys(n).filter(function (k) { return !o[k]; }),
      removed: Object.keys(o).filter(function (k) { return !n[k]; }),
      changed: Object.keys(n).filter(function (k) { return o[k] && (o[k].status !== n[k].status); }).map(function (k) { return { id: k, status: n[k].status, prev: o[k].status }; })
    };
  },
  snapshot: function (ver) {
    const cur = readJson(CATALOG_FILE, null);
    if (cur && ver) writeJson(path.join(DATA_DIR, 'catalog-snapshot-' + String(ver).slice(0, 24) + '.json'), cur);
    return true;
  },
  playStats: aggregatePlay,
  issues: function () {
    const d = loadIssues();
    return {
      ok: true,
      summary: {
        open: d.list.filter(function (i) { return i.status === 'open'; }).length,
        tracking: d.list.filter(function (i) { return i.status === 'tracking'; }).length,
        resolved: d.list.filter(function (i) { return i.status === 'resolved'; }).length,
        total: d.list.length, auto: d.list.filter(function (i) { return i.auto; }).length
      },
      list: d.list.slice(0, 200)
    };
  },
  issueAction: function (id, action) {
    const d = loadIssues();
    const is = (d.list || []).find(function (i) { return i.id === id; });
    if (!is) return { ok: false, error: '未找到该问题单' };
    if (action === 'resolve') { resolveIssue(d, is, 'manual-override'); }
    else if (action === 'reprobe') { is.lastAt = now(); is.note = '已排入下一轮自动探测'; }
    saveIssues(d);
    return { ok: true, id: id, status: is.status };
  },
  weekly: weekly,
  lastCycle: function () { return readJson(LAST_CYCLE, null); },
  overview: function () {
    const c = readJson(CATALOG_FILE, null);
    const d = loadIssues();
    const lc = readJson(LAST_CYCLE, null);
    return {
      catalogVersion: c && c.version || null,
      generatedAt: c && c.generatedAt || null,
      totals: c && c.totals || { items: 0, channels: 0, platforms: 0, ok: 0, dead: 0 },
      issues: {
        open: d.list.filter(function (i) { return i.status === 'open'; }).length,
        tracking: d.list.filter(function (i) { return i.status === 'tracking'; }).length,
        resolved: d.list.filter(function (i) { return i.status === 'resolved'; }).length
      },
      lastCycle: lc
    };
  },
  ERROR_CODES: ERROR_CODES
};
