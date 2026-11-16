#!/usr/bin/env node
'use strict';
/* 反馈建议 → 新功能自动提取 → 自动添加（零人工复核）。
 *
 * 设计约束：
 *  1) 绝不从反馈文本里凭空生成可执行代码。能力池 CAPABILITIES 是白名单，
 *     提取只是「把用户意图映射到已实现的能力」，action 只能是内置 builtin:。
 *  2) 幂等：同一能力只在功能清单里出现一次；重复运行不会膨胀清单。
 *  3) 自动同步功能快照：清单变化后立刻刷新 hash / count / ids，
 *     保证打包前自检、/api/features 的 inSync 与验收不会因为热更新而漂移。
 *     应用包版本（versionCode / versionName）仍只由真实出包递增。
 *  4) 可被服务、治理循环、发版脚本、回归自检独立调用（纯同步、零依赖）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

/* 能力池：id 稳定，关键词覆盖中文常见反馈句式。action 必须已在两端前端实现。 */
const CAPABILITIES = [
  {
    id: 'feature-mine', name: '反馈建议自动提取新功能',
    desc: '自动从反馈 / 建议 / 上报里提取新功能诉求，去重后自动加入功能清单并随发版同步',
    action: 'builtin:mine',
    keywords: ['新功能', '建议', '希望', '能不能加', '增加', '新增', '添加功能', '自动提取', '自动添加', '功能自动']
  },
  {
    id: 'auto-batch', name: '自动批量下发',
    desc: '自动生成本次发版的批量分发清单（多架构安装包 / 开鸿 HAP / 校验值），两端自动按架构取包',
    action: 'builtin:batch',
    keywords: ['批量', '多台', '所有设备', '一起下发', '批量更新', '批量安装', '自动批量', '下发', '推送', '部署']
  },
  {
    id: 'arch-adaptive', name: '全架构自适应',
    desc: '自动识别 x64 / ia32 / arm64 并选择对应安装包；无原生包时回退通用包，弱机自动降档播放',
    action: 'builtin:arch',
    keywords: ['架构', 'x86', 'arm', '32位', '64位', '所有电脑', '不同电脑', '适配所有', '兼容', '所有架构']
  },
  {
    id: 'play-smooth', name: '自适应流畅播放',
    desc: '按 CPU / 内存 / 架构自动调整缓冲与码率上限，卡顿自动降档与切换备用源',
    action: 'builtin:playback',
    keywords: ['流畅', '卡顿', '播放', '缓冲', '清晰度', '码率', '不卡', '转圈', '秒开']
  },
  {
    id: 'mem-adaptive', name: '不限内存大小都能看',
    desc: '自动下发按内存档选免安装轻量版或完整安装包；播放缓冲字节数与码率按内存设硬上限，小内存机器也能流畅看',
    action: 'builtin:memory',
    keywords: ['内存', '不限内存', '小内存', '低内存', '低配', '任意内存', '都能看', '老电脑', '配置低', '内存小']
  },
  {
    id: 'auto-update', name: '成品自动更新',
    desc: '两端启动自动比对版本，自动拉取最新功能 / 播放档位 / 成品校验值；低内存免安装通道永远最新，不制造假更新',
    action: 'builtin:update',
    keywords: ['自动更新', '更新', '升级', '新版', '最新版本', '跟随版本', '自动升级', '同步最新']
  },
  {
    id: 'os-follow', name: '跟随所有操作系统版本',
    desc: '自动检测并回传 OS 版本 / API / 架构 / 内存，按系统版本自动优化兼容策略、自动修复漂移后下发同步更新',
    action: 'builtin:os',
    keywords: ['操作系统', '系统版本', 'OS版本', '跟随', '检测回传', '回传', '自动优化', '自动检测', '所有系统', '版本检测', '同步更新']
  }
];

const DEFAULT_PATHS = {
  feedbackFile: path.join(ROOT, 'server', 'data', 'feedback.jsonl'),
  reportsFile: path.join(ROOT, 'server', 'data', 'reports.jsonl'),
  featuresFile: path.join(ROOT, 'features', 'manifest.json'),
  stampFile: path.join(ROOT, 'server', 'feature-version.json'),
  minedFile: path.join(ROOT, 'server', 'data', 'mined_features.json'),
  manifestFile: path.join(ROOT, 'server', 'manifest.json')
};

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}
function tailLines(p, max) {
  try {
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-max);
  } catch (e) { return []; }
}
/* 递归收集短文本字段，跳过 URL / 时间戳 / 长 JSON 字符串 */
function textsOf(v, out, depth) {
  if (depth > 4 || out.length > 600) return;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s && s.length <= 300 && !/^https?:\/\//i.test(s)) out.push(s);
    return;
  }
  if (Array.isArray(v)) { v.forEach(x => textsOf(x, out, depth + 1)); return; }
  if (v && typeof v === 'object') {
    Object.keys(v).forEach(k => {
      if (/^(at|ts|time|sentAt|receivedAt|sha256|hash|url|host|versionCode)$/i.test(k)) return;
      textsOf(v[k], out, depth + 1);
    });
  }
}
function collectTexts(opts) {
  const out = [];
  for (const p of [opts.feedbackFile, opts.reportsFile]) {
    for (const line of tailLines(p, 400)) {
      let obj; try { obj = JSON.parse(line); } catch (e) { obj = line; }
      textsOf(obj, out, 0);
    }
  }
  return out;
}
function hashOf(list) {
  return crypto.createHash('sha256').update(JSON.stringify(list)).digest('hex');
}
/* 功能清单热更新后同步快照：只刷内容指纹，不动应用版本 */
function syncStamp(opts) {
  const list = readJson(opts.featuresFile, []);
  if (!Array.isArray(list)) return false;
  const saved = readJson(opts.stampFile, {});
  const m = readJson(opts.manifestFile, {});
  const lat = (m && m.release && m.release.latest) || {};
  const full = hashOf(list);
  const next = {
    versionName: saved.versionName || lat.versionName || null,
    versionCode: saved.versionCode || lat.versionCode || null,
    publishedAt: saved.publishedAt || lat.publishedAt || null,
    updatedAt: new Date().toISOString(),
    count: list.length,
    ids: list.map(f => String((f && f.id) || '')),
    hash: full.slice(0, 16),
    fullHash: full
  };
  try { fs.writeFileSync(opts.stampFile, JSON.stringify(next, null, 2) + '\n'); return true; }
  catch (e) { return false; }
}

function run(input) {
  const opts = Object.assign({}, DEFAULT_PATHS, input || {});
  const startedAt = Date.now();
  const texts = collectTexts(opts);
  const joined = texts.join('\n');
  const hits = [];
  CAPABILITIES.forEach(c => {
    const matched = c.keywords.filter(k => joined.indexOf(k) >= 0);
    if (matched.length) hits.push({ id: c.id, matched: matched, from: texts.filter(t => c.keywords.some(k => t.indexOf(k) >= 0)).slice(0, 3) });
  });

  const list = readJson(opts.featuresFile, []);
  const features = Array.isArray(list) ? list : [];
  const map = {}; features.forEach(f => { map[f && f.id] = f; });
  const maxAdd = Number(opts.maxAdd || 16);   // 能力池会随反馈增长，不能把新能力截断在旧上限里
  const added = [], skipped = [];
  hits.slice(0, maxAdd).forEach(h => {
    if (map[h.id]) { skipped.push(h.id); return; }
    const c = CAPABILITIES.find(x => x.id === h.id);
    features.push({
      id: c.id, name: c.name, desc: c.desc, action: c.action,
      enabled: true, origin: 'feedback-auto', minedAt: new Date().toISOString()
    });
    map[c.id] = true;
    added.push(c.id);
  });

  let written = false;
  if (added.length && !opts.dryRun) {
    try { fs.writeFileSync(opts.featuresFile, JSON.stringify(features, null, 2) + '\n'); written = true; }
    catch (e) { /* 只读环境：仍返回候选，不抛错阻断治理 */ }
  }
  const stampSynced = (added.length && written && !opts.dryRun) ? syncStamp(opts) : false;

  const result = {
    ok: true, mode: 'auto-no-review', startedAt: startedAt, finishedAt: Date.now(),
    scannedTexts: texts.length, candidates: hits, added: added, skipped: skipped,
    featureCount: features.length, written: written, stampSynced: stampSynced,
    dryRun: !!opts.dryRun
  };
  if (!opts.dryRun && !opts.noLog) {
    try {
      const dir = path.dirname(opts.minedFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let history = readJson(opts.minedFile, []);
      if (!Array.isArray(history)) history = [];
      history.push(result);
      fs.writeFileSync(opts.minedFile, JSON.stringify(history.slice(-40), null, 2) + '\n');
    } catch (e) { /* 历史写失败不影响主流程 */ }
  }
  return result;
}

module.exports = { run: run, syncStamp: syncStamp, CAPABILITIES: CAPABILITIES, DEFAULT_PATHS: DEFAULT_PATHS };
