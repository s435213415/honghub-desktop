/**
 * HongHub-Desktop · 开发者端运维能力（零依赖）
 * --------------------------------------------------------------
 * 1) 审计：所有写操作落 audit.jsonl，可查最近 N 条（谁在什么时候做了什么、结果如何）
 * 2) 指标：源健康 / 更新结果 / 设备回传按天落 metrics.jsonl，按天出趋势
 * 3) 灰度：分组 + 权重 + 自动暂停，设备按匿名 ID 稳定分到同一组
 * 4) 发布闭环：执行发布适配器 → 回读远端清单核对版本与 SHA256 → 落审计与指标
 * 5) 真机冒烟：读取 dist/hap-smoke.json / hap-watch.json，无记录时明确 no-run
 * 6) 告警分级：critical / warn / info 归并去重，同一码不在窗口内重复播报
 *
 * 原则：任何一步拿不到真实结果就如实报 no-run / prepared-local / failed，绝不谎报成功。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(__dirname, 'data');
const AUDIT_FILE = path.join(DATA, 'audit.jsonl');
const METRIC_FILE = path.join(DATA, 'metrics.jsonl');
const ROLLOUT_FILE = path.join(DATA, 'rollout.json');
const PUBLISH_FILE = path.join(DATA, 'last_publish.json');
const KEEP = 5000;

function ensureData() { try { fs.mkdirSync(DATA, { recursive: true }); return true; } catch (e) { return false; } }
function appendLine(file, rec) {
  if (!ensureData()) return false;
  try { fs.appendFileSync(file, JSON.stringify(rec) + '\n'); return true; } catch (e) { return false; }
}
function tailLines(file, limit) {
  const n = Math.max(1, Number(limit) || 50);
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-n).map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}
function dayKey(ts) {
  const d = new Date(ts || Date.now());
  const p = function (x) { return (x < 10 ? '0' : '') + x; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function clip(v, n) { return String(v === undefined || v === null ? '' : v).slice(0, n); }

/* ---------------- 审计 ---------------- */
const audits = [];
function audit(action, fields) {
  const rec = Object.assign({
    at: Date.now(), atIso: new Date().toISOString(),
    action: clip(action, 48), actor: 'local', result: 'ok'
  }, fields || {});
  rec.action = clip(rec.action, 48);
  if (rec.target !== undefined) rec.target = clip(rec.target, 120);
  if (rec.detail !== undefined) rec.detail = clip(rec.detail, 400);
  audits.push(rec);
  if (audits.length > 300) audits.shift();
  appendLine(AUDIT_FILE, rec);
  return rec;
}
function listAudit(limit) {
  const file = tailLines(AUDIT_FILE, Math.max(Number(limit) || 60, 200));
  const merged = file.length ? file : audits.slice();
  return merged.slice(-(Number(limit) || 60)).reverse();
}

/* ---------------- 指标与趋势 ---------------- */
function metric(type, fields) {
  const rec = Object.assign({ at: Date.now(), date: dayKey(), type: clip(type, 24) }, fields || {});
  appendLine(METRIC_FILE, rec);
  return rec;
}
function deviceMetric(family) { return metric('device', { family: clip(family || 'unknown', 24) }); }
function updateMetric(ok, fields) {
  return metric('update', Object.assign({ ok: !!ok }, fields || {}));
}
/* 源健康快照：由中枢在启动与每轮治理后调用，形成按天曲线 */
function snapshotSources(manifest) {
  const chs = (manifest && manifest.sources && manifest.sources.channels) || [];
  let total = 0, ok = 0, dead = 0, slow = 0;
  chs.forEach(function (ch) {
    (ch.sources || []).forEach(function (s) {
      total += 1;
      if (s.status === 'ok') ok += 1;
      else if (s.status === 'dead' || s.status === 'failed') dead += 1;
      else if (s.status === 'slow' || s.status === 'warn') slow += 1;
    });
  });
  return metric('source', { total: total, ok: ok, dead: dead, slow: slow, channels: chs.length });
}
/* 按天聚合最近 N 天：源可用率、更新成功/失败、设备回传、失败 Top */
function trend(days, ctx) {
  const n = Math.min(90, Math.max(1, Number(days) || 14));
  const recs = tailLines(METRIC_FILE, Math.min(KEEP, n * 400));
  const map = {};
  const today = Date.now();
  for (let i = n - 1; i >= 0; i -= 1) {
    const k = dayKey(today - i * 86400000);
    map[k] = { date: k, source: null, updateOk: 0, updateFail: 0, devices: 0, families: {} };
  }
  recs.forEach(function (r) {
    const row = map[r.date];
    if (!row) return;
    if (r.type === 'source') row.source = { total: r.total, ok: r.ok, dead: r.dead, slow: r.slow, channels: r.channels };
    else if (r.type === 'update') { if (r.ok) row.updateOk += 1; else row.updateFail += 1; }
    else if (r.type === 'device') { row.devices += 1; row.families[r.family] = (row.families[r.family] || 0) + 1; }
  });
  const series = Object.keys(map).sort().map(function (k) {
    const row = map[k];
    const s = row.source;
    row.okRate = s && s.total ? Math.round((s.ok / s.total) * 1000) / 10 : null;
    return row;
  });
  const latest = series.filter(function (r) { return r.source || r.updateOk || r.updateFail || r.devices; }).slice(-1)[0] || null;
  const totals = series.reduce(function (a, r) {
    a.updateOk += r.updateOk; a.updateFail += r.updateFail; a.devices += r.devices; return a;
  }, { updateOk: 0, updateFail: 0, devices: 0 });
  return {
    days: n,
    series: series,
    latest: latest,
    totals: totals,
    updateSuccessRate: (totals.updateOk + totals.updateFail)
      ? Math.round((totals.updateOk / (totals.updateOk + totals.updateFail)) * 1000) / 10 : null,
    topFailures: (ctx && ctx.top) || [],
    note: '指标按天累积（metrics.jsonl）；源可用率来自每轮源体检快照，更新成功率来自发布与回滚结果'
  };
}

/* ---------------- 灰度分批 ---------------- */
const DEFAULT_ROLLOUT = {
  enabled: true,
  groups: [
    { id: 'canary', name: '灰度内测', weight: 5, channels: ['full', 'hap', 'lite'], note: '先放 5% 设备，观察失败率再放量' },
    { id: 'stable', name: '全量稳定', weight: 95, channels: ['full', 'hap', 'lite'], note: '默认组，其余设备全部落这里' }
  ],
  autoPause: { failRate: 0.2, minSamples: 5, windowHours: 24 },
  paused: false,
  pausedAt: null,
  pauseReason: null,
  updatedAt: null
};
function readRollout() {
  let o = null;
  try { o = JSON.parse(fs.readFileSync(ROLLOUT_FILE, 'utf8')); } catch (e) { o = null; }
  if (!o || !Array.isArray(o.groups) || !o.groups.length) return JSON.parse(JSON.stringify(DEFAULT_ROLLOUT));
  return Object.assign(JSON.parse(JSON.stringify(DEFAULT_ROLLOUT)), o);
}
function writeRollout(next) {
  const cur = readRollout();
  const o = Object.assign(cur, next || {});
  if (!Array.isArray(o.groups) || !o.groups.length) return { ok: false, error: 'groups 需为非空数组' };
  o.groups = o.groups.map(function (g) {
    const w = Math.max(1, Number(g.weight) || 1);
    return { id: clip(g.id || 'group', 32), name: clip(g.name || g.id || '分组', 40), weight: w, channels: Array.isArray(g.channels) ? g.channels.slice(0, 4) : ['full', 'hap', 'lite'], note: clip(g.note || '', 200) };
  });
  o.weightTotal = o.groups.reduce(function (a, g) { return a + g.weight; }, 0);
  o.updatedAt = new Date().toISOString();
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(ROLLOUT_FILE, JSON.stringify(o, null, 2) + '\n'); }
  catch (e) { return { ok: false, error: '写入灰度配置失败：' + (e && e.message || e) }; }
  return { ok: true, rollout: o };
}
/* 设备落组：同一匿名 ID 永远落同一组（按权重切片的稳定哈希） */
function resolveGroup(deviceId) {
  const o = readRollout();
  const key = String(deviceId || '');
  const groups = o.groups;
  if (!o.enabled) return { group: 'all', name: '未启用分组', weight: 100, paused: false, note: '灰度分组已关闭，全部设备同组下发' };
  if (!key) {
    const g0 = groups[0];
    return { group: g0.id, name: g0.name, weight: g0.weight, paused: !!o.paused, note: '设备未提供匿名 ID，按首组保守下发' };
  }
  const total = groups.reduce(function (a, g) { return a + g.weight; }, 0) || 1;
  const h = parseInt(crypto.createHash('sha1').update(key).digest('hex').slice(0, 8), 16) % total;
  let acc = 0, hit = groups[groups.length - 1];
  for (let i = 0; i < groups.length; i += 1) {
    acc += groups[i].weight;
    if (h < acc) { hit = groups[i]; break; }
  }
  return {
    group: hit.id, name: hit.name, weight: hit.weight,
    paused: !!o.paused, pausedReason: o.pauseReason || null,
    note: hit.note || null, totalGroups: groups.length
  };
}
/* 自动暂停：窗口内失败率超阈值即暂停放量，需人工恢复 */
function evaluateRollout(updateStats) {
  const o = readRollout();
  const s = updateStats || {};
  const samples = (Number(s.updateOk) || 0) + (Number(s.updateFail) || 0);
  const failRate = samples ? (Number(s.updateFail) || 0) / samples : 0;
  const limit = Number((o.autoPause && o.autoPause.failRate) || 0.2);
  const minSamples = Number((o.autoPause && o.autoPause.minSamples) || 5);
  if (o.paused) return { paused: true, changed: false, failRate: failRate, reason: o.pauseReason || null };
  if (samples >= minSamples && failRate > limit) {
    const reason = '近 ' + ((o.autoPause && o.autoPause.windowHours) || 24) + ' 小时更新失败率 ' +
      (Math.round(failRate * 1000) / 10) + '% 超过阈值 ' + (Math.round(limit * 1000) / 10) + '%，已自动暂停放量';
    const w = writeRollout({ paused: true, pausedAt: new Date().toISOString(), pauseReason: reason });
    audit('rollout.autoPause', { result: 'warn', detail: reason, target: 'rollout' });
    return { paused: true, changed: !!w.ok, failRate: failRate, reason: reason, samples: samples };
  }
  return { paused: false, changed: false, failRate: failRate, samples: samples };
}

/* ---------------- 发布闭环 ---------------- */
function lastPublish() {
  try { return JSON.parse(fs.readFileSync(PUBLISH_FILE, 'utf8')); } catch (e) { return null; }
}
function runCmd(cmd, args, timeoutMs, cb) {
  let out = '', err = '', done = false;
  const finish = function (r) { if (done) return; done = true; try { clearTimeout(timer); } catch (e) {} cb(r); };
  let child;
  try { child = cmd === null ? spawn(args.join(' '), { shell: true, cwd: ROOT, windowsHide: true }) : spawn(cmd, args, { cwd: ROOT, windowsHide: true }); }
  catch (e) { finish({ ok: false, code: -1, out: '', err: String(e && e.message || e) }); return; }
  const timer = setTimeout(function () { try { child.kill(); } catch (e) {} finish({ ok: false, code: -2, out: out, err: 'timeout' }); }, timeoutMs || 300000);
  if (child.stdout) child.stdout.on('data', function (d) { out += d.toString(); });
  if (child.stderr) child.stderr.on('data', function (d) { err += d.toString(); });
  child.on('error', function (e) { finish({ ok: false, code: -1, out: out, err: String(e && e.message || e) }); });
  child.on('close', function (code) { finish({ ok: code === 0, code: code, out: out, err: err }); });
}
/* 一键发布：可选自定义上传通道（KH_DEPLOY_CMD）→ 发布适配器 → 回读远端清单核对版本与哈希 */
function runPublish(opts, cb) {
  const o = opts || {};
  const relFile = path.join(ROOT, 'dist', 'release.json');
  const exists = function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
  if (!exists(relFile)) {
    const out = { ok: false, status: 'skipped', error: '缺少 dist/release.json（先出包再发布）', at: new Date().toISOString() };
    try { fs.writeFileSync(PUBLISH_FILE, JSON.stringify(out, null, 2) + '\n'); } catch (e) {}
    audit('publish.skipped', { result: 'fail', detail: out.error });
    if (cb) cb(out);
    return;
  }
  const deployCmd = String(process.env.KH_DEPLOY_CMD || '').trim();
  const step = function (stage, cb2) {
    if (stage === 'upload') {
      if (!deployCmd || o.dryRun) {
        cb2({ skipped: true, note: o.dryRun ? '演练模式：跳过上传' : '未配置 KH_DEPLOY_CMD（自定义上传命令），只做发布包准备与校验' });
        return;
      }
      runCmd(null, [deployCmd], 600000, function (r) { cb2({ skipped: false, ok: r.ok, code: r.code, out: r.out.slice(-800), err: r.err.slice(-400) }); });
      return;
    }
    runCmd(process.execPath, [path.join(ROOT, 'scripts', 'publish-remote.js')], 600000, function (r) {
      const m = /\[公网分发\]\s+([A-Z\-]+)/i.exec(r.out || '');
      cb2({ ok: r.ok, code: r.code, out: (r.out || '').trim().slice(-1200), err: r.err.slice(-400), status: m ? m[1].toLowerCase() : 'unknown' });
    });
  };
  step('upload', function (up) {
    if (up && up.ok === false && !up.skipped) {
      const out = { ok: false, status: 'failed', phase: 'upload', detail: clip(up.err || up.out || '上传失败', 400), at: new Date().toISOString() };
      finishPublish(out, cb);
      return;
    }
    step('publish', function (pub) {
      const status = pub.status || 'unknown';
      const out = {
        ok: status === 'published', status: status,
        upload: up, phase: 'publish',
        detail: clip(pub.out || pub.err || '', 1200),
        at: new Date().toISOString(),
        note: status === 'prepared-local'
          ? '发布包已就绪，但远端站点仍是上一版或不可达：需要把 dist/public/ 上传到站点后再跑一次'
          : (status === 'published' ? '远端清单版本与 SHA256 均与本地一致' : '未完成，见 detail')
      };
      finishPublish(out, cb);
    });
  });
}
function finishPublish(out, cb) {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(PUBLISH_FILE, JSON.stringify(out, null, 2) + '\n'); } catch (e) {}
  audit('publish.run', { result: out.ok ? 'ok' : (out.status === 'prepared-local' ? 'partial' : 'fail'), detail: out.status + ' · ' + clip(out.detail, 260) });
  updateMetric(out.ok, { action: 'publish', status: out.status });
  // 发布结果计入灰度自动暂停评估：失败率超阈值即停止放量，避免把坏版本推给全量设备
  try { evaluateRollout(trend(1, {}).totals); } catch (e) {}
  if (cb) cb(out);
}

/* ---------------- 回滚（应用内：切换下发版本 + 记录审计，不静默安装） ---------------- */
function applyRollback(version, readIndex, writeManifest, cb) {
  const want = String(version || '').trim();
  const idx = readIndex();
  const hit = (idx.versions || []).find(function (v) { return v.versionName === want; });
  if (!hit) { if (cb) cb({ ok: false, error: '未找到该版本归档：' + (want || '空'), available: (idx.versions || []).map(function (v) { return v.versionName; }) }); return; }
  const d = hit.artifacts && hit.artifacts.desktop;
  const rel = d && String(d.path || '');
  const safe = rel && rel.indexOf('..') < 0 && !path.isAbsolute(rel);
  if (!safe || !fs.existsSync(path.join(ROOT, rel))) {
    if (cb) cb({ ok: false, error: '归档产物文件缺失，拒绝回滚（避免把客户端指向不存在的包）', version: hit.versionName });
    return;
  }
  const w = writeManifest(hit);
  if (!w || w.ok === false) { if (cb) cb({ ok: false, error: '写回清单失败：' + ((w && w.error) || '未知') }); return; }
  audit('update.rollback', { target: hit.versionName, result: 'ok', detail: '下发版本切到 ' + hit.versionName + '（' + (d.size || 0) + ' B）' });
  updateMetric(true, { action: 'rollback', versionName: hit.versionName });
  if (cb) cb({ ok: true, version: hit.versionName, versionCode: hit.versionCode || null, downloadUrl: hit.downloadUrl || null, sha256: (d && d.sha256) || null, note: '下发改到该历史版本；设备端会看到更新提示，安装仍需用户在本机向导确认' });
}

/* ---------------- 真机冒烟 ---------------- */
function smoke() {
  const read = function (p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
  const smokeRun = read(path.join(ROOT, 'dist', 'hap-smoke.json'));
  const watch = read(path.join(ROOT, 'dist', 'hap-watch.json'));
  const state = smokeRun ? String(smokeRun.status || (smokeRun.ok ? 'passed' : 'failed'))
    : (watch ? String(watch.state || 'unknown') : 'no-run');
  return {
    state: state,
    ok: !!smokeRun && smokeRun.status !== 'failed',
    smoke: smokeRun,
    watch: watch,
    note: smokeRun ? null : '还没有冒烟记录：接上深开鸿设备后跑 npm run hap:watch（或 scripts/smoke-hap.js）即自动落结果',
    endpoint: '/api/hap/smoke'
  };
}

/* ---------------- 告警分级与去重 ---------------- */
const LEVEL_ORDER = { critical: 0, warn: 1, info: 2 };
function gradeAlerts(raw, opts) {
  const windowMs = Number((opts && opts.windowMs) || 30 * 60 * 1000);
  const now = Date.now();
  const map = {};
  (raw || []).forEach(function (a) {
    if (!a || !a.code) return;
    const lv = LEVEL_ORDER[a.level] !== undefined ? a.level : 'info';
    if (!map[a.code]) map[a.code] = { code: a.code, level: lv, count: 0, firstAt: a.at || now, lastAt: a.at || now, detail: '', suppressed: 0 };
    const g = map[a.code];
    g.count += 1;
    g.lastAt = Math.max(g.lastAt, a.at || now);
    if (!g.detail) g.detail = clip(a.detail, 240);
    if (LEVEL_ORDER[lv] < LEVEL_ORDER[g.level]) g.level = lv;
    if ((a.at || now) < now - windowMs) g.suppressed += 1;
  });
  const list = Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) || (b.lastAt - a.lastAt); });
  return {
    levels: {
      critical: list.filter(function (x) { return x.level === 'critical'; }),
      warn: list.filter(function (x) { return x.level === 'warn'; }),
      info: list.filter(function (x) { return x.level === 'info'; })
    },
    total: list.length, deduped: list,
    healthy: list.filter(function (x) { return x.level === 'critical'; }).length === 0,
    windowMs: windowMs,
    note: '同级同码在窗口内合并计数，不再重复播报；critical 需立即处理'
  };
}

/* ---------------- 统一汇总（看板一次取全） ---------------- */
function overview(ctx) {
  const c = ctx || {};
  return {
    ok: true,
    audit: listAudit(20),
    trend: trend(c.days || 14, { top: c.top }),
    rollout: readRollout(),
    publish: lastPublish(),
    smoke: smoke(),
    alerts: gradeAlerts(c.alerts || [], { windowMs: c.windowMs }),
    at: new Date().toISOString()
  };
}

module.exports = {
  audit: audit, listAudit: listAudit,
  metric: metric, deviceMetric: deviceMetric, updateMetric: updateMetric, snapshotSources: snapshotSources, trend: trend,
  readRollout: readRollout, writeRollout: writeRollout, resolveGroup: resolveGroup, evaluateRollout: evaluateRollout,
  runPublish: runPublish, lastPublish: lastPublish, applyRollback: applyRollback,
  smoke: smoke, gradeAlerts: gradeAlerts, overview: overview,
  dayKey: dayKey
};
