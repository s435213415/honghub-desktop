/**
 * HongHub-Desktop · 免费桌面版统一服务
 * --------------------------------------------------------------
 * 零依赖 Node 单文件服务，一个进程同时承担：
 *   1) 静态托管 app/ 影站前端（双击启动器即开浏览器访问）
 *   2) 远程问题收集 /api/report（脱敏、限流、幂等、可选 Token）
 *   3) 在线问题看板 /（含「🔧 一键自愈」按钮）
 *   4) 实时更新 /api/manifest（源清单 + 版本清单，桌面端免重装拉取）
 *   5) 可插拔功能 /api/features（server/features 增加即在线生效）
 *   6) 一键自愈 /api/fix（重排坏源 + 刷新清单，形成「上报→看板→修复→回灌」闭环）
 *
 * 隐私：不记录来源 IP 明文、不记录账号与片源内容；URL 在上报端裁成域名。
 * 端口：$PORT（默认 8787），绑定 0.0.0.0 便于单端口发布托管。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
// 进程启动时加载 .env：让 KH_DEPLOY_CMD（上传通道）/ KH_DEV_MODE / 公网分发端点等配置生效。
// 环境变量优先级高于 .env，命令行注入不会被本地文件覆盖。
try { require('../scripts/lib/env').apply(); } catch (e) {}
const bugfix = require('./auto-bugfix');   // 自动收集 → 提取 → 修改 Bug → 优化功能
const aiBugfix = require('./ai-bugfix');   // AI 自动修 Bug（模型给精确替换补丁 → 本机安全闸校验 → 落盘/还原）
const miner = require('./feature-miner');  // 反馈建议 → 自动提取新功能 → 自动添加（零人工复核）
const delivery = require('./delivery-plan'); // 自动下发成品：不限设备 / 不限内存 + 自动更新比对
const deviceOptimizer = require('./device-optimizer'); // OS 版本检测回传 → 自动优化 → 自动修复 → 下发同步更新
const devops = require('./devops');                  // 开发者端运维：审计 / 趋势 / 灰度 / 发布闭环 / 真机冒烟 / 告警分级
const catalog = require('./catalog');                // 资源目录 / 平台探测 / 播放埋点 / 问题单全自动跟进
const logRotate = require('./log-rotate');           // *.jsonl 超限自动切分压缩，避免磁盘被日志吃满
const healthMonitor = require('./health-monitor');   // 磁盘/内存/日志水位监测与告警落盘
const distribute = require('./distribute');         // 公网分发配置（未配置时保持本地局域网分发）
const updateSources = require('./update-sources'); // 更新包多源候选与依次重试（#158）
const featureTrack = require('./feature-track');    // 客户端功能追踪：每版功能清单与增删对比
const insights = require('./insights');             // 维护决策：收视热度 / 失效源 TOP
const extras = require('./extras');                 // 远程功能开关 / 升级遥测 / 儿童时段 / 双端接力 / 双指标选源 / 聚合搜索
const cfgCenter = require('./config-center');        // 远端配置中心：#69 默认值 / #70 灰度 / #71 锁定 / #77 公告 / #66 云同步
const shares = require('./shares');                 // 分享短链：#65 二维码 / 短链（/api/share + /s/<code>）
/* 1.7.94 短链落地页要拼标题，统一转义一次，避免标题里带标签 */
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const buildStatus = require('./build-status');      // 发版流水线：版本四源 / 产物哈希 / 最近步骤 / 自动发版与出包锁
const alertsCenter = require('./alerts-center');    // 告警中心：分级展示 / 去重 / Webhook 外发与留痕
const releaseCenter = require('./release-center');  // 发布历史 / 发版闸门红绿 / 日志查看 / 操作审计
const qualityCenter = require('./quality-center');  // 质量门禁：静态检查 / UI 冒烟 / HAP 冒烟
const catalogAudit = require('./catalog-audit');    // 平台条目体检：重复 / 缺分组 / 非法类型
const sourceHealth = require('./source-health');    // 源体检与补备源：单线路 / 慢速 / 优先线路
const deviceQueue = require('./device-queue');      // 设备批量队列：待下发动作排期
const distCleanup = require('./dist-cleanup');       // dist 体积治理：归档副本清理
const opsConfig = require('./ops-config');           // 白名单 / 推荐位 / 更新通道可配置项
const accountSync = require('./account-sync');       // 1.7.95 设备码账号 / 云同步 / 手机遥控
const watchlist = require('./watchlist').watchlist;  // 追剧订阅（本机维度）
const aiAdvisor = require('./ai-advisor');            // AI 辅助诊断（开发端，OpenAI 兼容协议，仅给建议）
// 已安装客户端没有 dist/，校验值与新版本必须来自公网清单：启动拉一次并按周期刷新（失败静默回退）。
try { distribute.startAutoRefresh(Number(process.env.KH_PUBLIC_REFRESH_MS || 5 * 60 * 1000)); } catch (e) {}

const PORT = Number(process.env.PORT || 8787);
const PRODUCT_NAME = process.env.PRODUCT_NAME || '鸿汇影';   // 改名：设 PRODUCT_NAME 环境变量，或改此处默认值
const REPORT_TOKEN = process.env.REPORT_TOKEN || '';
const FIX_TOKEN = process.env.FIX_TOKEN || '';
/* 开发端模式：默认关闭。关闭时客户包不暴露运维看板与发布/自治类接口，
   开启（KH_DEV_MODE=1）才提供 /admin 与 /api/publish 等开发端能力。 */
/* 构建期客户版硬锁：客户 exe 打包时注入 KH_CLIENT_ONLY=1，
   此后无论环境变量如何，客户版都不提供任何开发端能力。 */
const CLIENT_ONLY = process.env.KH_CLIENT_ONLY === '1';
const DEV_MODE = !CLIENT_ONLY && process.env.KH_DEV_MODE === '1';
/* 手动下载兜底页（1.7.82）：自动更新在公网地址不可达 / 校验失败时，把这条给用户复制，
   而不是只说一句「下载失败」让人无从下手。 */
const MANUAL_DOWNLOAD_PAGE = 'https://www.workbuddy.cn/space/d/roaB3djIExONHwJ3lGoFTo';
/* 监听地址：桌面客户端默认只绑本机回环，避免同网段设备直接操作用户的中枢；
   需要局域网分发时显式设 KH_HOST=0.0.0.0（此时自动要求访问口令）。 */
const HOST = process.env.KH_HOST || '127.0.0.1';
// 可选访问口令：绑定非回环地址且未显式配置时，自动生成并持久化一份口令
let ACCESS_TOKEN = process.env.KH_ACCESS_TOKEN || '';
const MAX_BODY = 128 * 1024;
const MAX_KEEP = 5000;
const APP_DIR = path.join(__dirname, '..', 'app');
const DATA_DIR = path.join(__dirname, 'data');

/* ---------------- 应用页面热更新（公网下发优先于随包文件，免重打包） ----------------
   机制：公网 remote-manifest.json 提供 pageUrl / pageHash；服务端启动与每 10 分钟
   拉取并按 SHA256 校验后写入 server/data/app.page.html。serveStatic 请求 /index.html
   时优先返回该缓存，用户刷新/重启应用即用到最新页面，无需覆盖安装、无需卸载。 */
const PAGE_CACHE = path.join(DATA_DIR, 'app.page.html');
const PAGE_META  = path.join(DATA_DIR, 'app.page.json');
function pageHashOf(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function pageCode(buf) {
  try {
    const t = buf.toString('utf8');
    const m = t.match(/KH_APP_CODE\s*=\s*(\d{5,})/) || t.match(/"versionCode"\s*:\s*(\d{5,})/);
    return m ? parseInt(m[1], 10) : 0;
  } catch (e) { return 0; }
}
function activePage() {
  let bundled = Buffer.alloc(0);
  try { bundled = fs.readFileSync(path.join(APP_DIR, 'index.html')); } catch (e) {}
  let cached = null;
  try { if (fs.existsSync(PAGE_CACHE)) cached = fs.readFileSync(PAGE_CACHE); } catch (e) {}
  /* 缓存必须比随包页面「更新」才允许生效。旧行为是缓存无条件优先，导致随包的新页面被
     server/data 里的旧快照整个盖掉：装上 v1.7.10 打开还是旧频道数据。 */
  if (cached && cached.length) {
    if (!bundled.length || pageCode(cached) > pageCode(bundled)) return { buf: cached, source: 'public-hot-update' };
  }
  if (bundled.length) return { buf: bundled, source: 'bundled' };
  if (cached && cached.length) return { buf: cached, source: 'public-hot-update' };
  return { buf: Buffer.alloc(0), source: 'none' };
}
function currentPageHash() { const a = activePage(); return a.buf.length ? pageHashOf(a.buf) : null; }
/* 构建标识：版本号之外再带一段由 package.json + 内置页面算出的短哈希。
   过去同一版本号下出现过两个不同安装包，仅靠 versionCode 无法分辨，加 buildId 后
   manifest / 健康检查 / 下载页都能指到具体那一份构建。 */
let __buildId = null;
function buildId() {
  if (__buildId) return __buildId;
  try {
    const p = path.join(__dirname, 'build-id.json');
    if (fs.existsSync(p)) {
      const v = String(JSON.parse(fs.readFileSync(p, 'utf8')).buildId || '').trim();
      if (v) { __buildId = v; return __buildId; }
    }
  } catch (e) {}
  try {
    const pkgBuf = fs.readFileSync(path.join(__dirname, '..', 'package.json'));
    const ver = JSON.parse(pkgBuf.toString('utf8')).version;
    const page = activePage().buf;
    __buildId = ver + '-' + crypto.createHash('sha256').update(pkgBuf).update(page).digest('hex').slice(0, 8);
  } catch (e) { __buildId = 'unknown'; }
  return __buildId;
}
function buildStamp() {
  const m = readManifest(), lat = (m && m.release && m.release.latest) || {};
  const raw = String(lat.versionCode || '') + '|' + featureStamp() + '|' + String(currentPageHash() || '').slice(0, 16);
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}
function httpGet(url, cb) {
  /* 地址非法（配置缺失时 baseUrl 可能是 undefined）直接当不可达处理：
     以前 new URL 会抛 Invalid URL 把整个服务端带崩 */
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) { cb(null); return; }
  let req = null;
  try {
    const lib = url.indexOf('https:') === 0 ? require('https') : require('http');
    req = lib.get(url, { timeout: 8000 }, function (res) {
      if (res.statusCode !== 200) { res.resume(); return cb(null); }
      const chunks = [];
      res.on('data', function (d) { chunks.push(d); });
      res.on('end', function () { cb(Buffer.concat(chunks)); });
      res.on('error', function () { cb(null); });
    });
  } catch (e) { cb(null); return; }
  req.on('timeout', function () { req.destroy(); cb(null); });
  req.on('error', function () { cb(null); });
}
function refreshPageFromPublic() {
  let c = null;
  try { c = require('./distribute').config(); } catch (e) { return; }
  if (!c || !c.enabled) return;
  const sources = (c.mirrors && c.mirrors.length) ? c.mirrors : [{ baseUrl: c.baseUrl, shareQuery: c.shareQuery || '' }];
  (function next(i) {
    if (i >= sources.length) return; /* 主备都不可达：静默跳过，等下次刷新 */
    const src = sources[i];
    if (!src || !src.baseUrl || !/^https?:\/\//i.test(String(src.baseUrl))) return next(i + 1);
    const q = src.shareQuery || '';
    httpGet(src.baseUrl + '/remote-manifest.json' + q, function (mb) {
      if (!mb) return next(i + 1);
      let m = null; try { m = JSON.parse(mb.toString('utf8')); } catch (e) { return next(i + 1); }
      if (!m || !m.pageUrl || !m.pageHash) return next(i + 1);
      const url = m.pageUrl + (m.pageUrl.indexOf('?') >= 0 ? '' : q);
      httpGet(url, function (buf) {
        if (!buf || buf.length < 10000 || buf.indexOf('<html') < 0) return next(i + 1);
        if (pageHashOf(buf) !== m.pageHash) { console.warn('[HongHub-Desktop] 页面热更新校验失败，已忽略'); return next(i + 1); }
        /* 只接受比随包页面更新的公网页面，防止公网还挂旧版时把新版降级覆盖回去 */
        let bundledCode = 0;
        try { bundledCode = pageCode(fs.readFileSync(path.join(APP_DIR, 'index.html'))); } catch (e) {}
        if (bundledCode && pageCode(buf) && pageCode(buf) < bundledCode) {
          console.warn('[HongHub-Desktop] 公网页面版本较旧，已跳过（' + pageCode(buf) + ' < ' + bundledCode + '）');
          return next(i + 1);
        }
        try {
          fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(PAGE_CACHE, buf);
          fs.writeFileSync(PAGE_META, JSON.stringify({ hash: m.pageHash, size: buf.length, at: new Date().toISOString(), source: url }, null, 2));
          console.log('[HongHub-Desktop] 应用页面已从公网热更新：' + buf.length + ' B / ' + m.pageHash.slice(0, 12) + '…（刷新即生效，无需重装）');
        } catch (e) {}
      });
    });
  })(0);
}

const DATA_FILE = path.join(DATA_DIR, 'reports.jsonl');   // 兼容旧单文件
const REPORTS_DAYS_KEEP = 7;
function reportsFileFor(ts) {
  const d = new Date(ts || Date.now());
  return path.join(DATA_DIR, 'reports-' + d.toISOString().slice(0, 10) + '.jsonl');
}
/* 启动只加载最近 2 天 + 旧单文件，避免长期运行后单文件过肥 */
function loadRecentReports() {
  const out = []; const seen = new Set();
  const push = (p) => {
    try {
      if (!fs.existsSync(p)) return;
      fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-MAX_KEEP).forEach((l) => {
        try { const r = JSON.parse(l); if (r && r.id && !seen.has(r.id)) { seen.add(r.id); out.push(r); } } catch (e) {}
      });
    } catch (e) {}
  };
  for (let i = 0; i < 2; i += 1) push(reportsFileFor(Date.now() - i * 86400000));
  push(DATA_FILE);
  out.sort((a, b) => (Number(a.receivedAt) || 0) - (Number(b.receivedAt) || 0));
  return out.slice(-MAX_KEEP);
}
let lastReportsPrune = 0;
function pruneReportsFiles() {
  if (Date.now() - lastReportsPrune < 3600000) return;
  lastReportsPrune = Date.now();
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      const m = /^reports-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (!m) continue;
      const t0 = Date.parse(m[1] + 'T00:00:00Z');
      if (Date.now() - t0 > REPORTS_DAYS_KEEP * 86400000) fs.unlinkSync(path.join(DATA_DIR, f));
    }
  } catch (e) {}
}
const MANIFEST_FILE = path.join(__dirname, 'manifest.json');
const FEATURES_FILE = path.join(__dirname, '..', 'features', 'manifest.json');
const PRESETS_FILE = path.join(__dirname, '..', 'features', 'presets.json');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.jsonl');            // 自动反馈通道（深开鸿端回传 + 中枢自动反馈）
const LATEST_GOVERN_FILE = path.join(DATA_DIR, 'latest_govern.json');   // 接收所有最终成品：本轮治理全部产出快照
function readPresets() { try { return JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8')); } catch (e) { return []; } }

const reports = [];
const feedbacks = [];
let writable = true;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { writable = false; }
if (writable) {
  try {
    loadRecentReports().forEach((r) => reports.push(r));
  } catch (e) { writable = false; }
  try {
    if (fs.existsSync(FEEDBACK_FILE)) {
      fs.readFileSync(FEEDBACK_FILE, 'utf8').split('\n').filter(Boolean).slice(-MAX_KEEP)
        .forEach((l) => { try { feedbacks.push(JSON.parse(l)); } catch (e) {} });
    }
  } catch (e) {}
}

const rate = new Map();
function limited(ip) {
  const now = Date.now();
  const key = ip || 'unknown';
  const cur = rate.get(key);
  if (!cur || now > cur.reset) { rate.set(key, { count: 1, reset: now + 60000 }); return false; }
  cur.count += 1;
  return cur.count > 60;
}

/* 只为本机页面放行跨源：任意外部网页都不允许读写本地中枢（防 CSRF / 本地接口被滥用）。
   回环来源（127.0.0.1 / localhost）回显 Origin，其余来源不下发 CORS 头，浏览器即拦截。 */
/* 来源放行：本机回环始终放行；其余来源需命中开发端配置的接口域名白名单。
   未在白名单内的外部网页不下发 CORS 头，浏览器即拦截（防 CSRF / 本地接口被滥用）。 */
function cors(res) {
  let origin = '';
  try { origin = String((res.req && res.req.headers && res.req.headers.origin) || ''); } catch (e) {}
  const ok = opsConfig.origins.isAllowed(origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-KH-Token, X-KH-Fix-Token, X-KH-Access-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (ok) res.setHeader('Access-Control-Allow-Origin', origin);
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
function clip(v, n) { return String(v === undefined || v === null ? '' : v).slice(0, n); }

/* 开发端子页面（维护决策 / 功能追踪 / 开关台 / 站点管理）统一注入返回条。
   这些页从主看板右下角入口点进来，原本只能靠浏览器后退返回，容易被困住。 */
function withAdminBack(html) {
  /* 顶栏一条到底：返回 + 当前页名 + 面板直达下拉 + 刷新 + 口令 + 影视页。
     之前只能「回看板再点进去」，13 页之间来回要跑两趟；现在一格下拉直达，
     口径也统一了（同一套按钮、同一套颜色），窄屏自动换行不挤成一坨。 */
  const ADMIN_NAV = [
    ['/admin', '🗂 运维看板'],
    ['/admin/build', '🚀 发版流水线'],
    ['/admin/release', '📦 发布与运维'],
    ['/admin/metrics', '📈 数据与体积'],
    ['/admin/alerts', '🔔 告警中心'],
    ['/admin/quality', '✅ 质量门禁'],
    ['/admin/extras', '🧩 开关台'],
    ['/admin/config-center', '🎛 远端配置'],
    ['/admin/features', '🧩 功能追踪'],
    ['/admin/sites', '🌐 平台条目'],
    ['/admin/devices', '📱 设备能力表'],
    ['/admin/insights', '📊 维护决策'],
    ['/admin/selfupdate', '🔄 自更新']
  ];
  const navOpts = ADMIN_NAV.map((x) => '<option value="' + x[0] + '">' + x[1] + '</option>').join('');
  const pill = 'display:inline-block;padding:6px 13px;border-radius:16px;text-decoration:none;'
    + 'font:13px/1.4 sans-serif;border:1px solid #1E3450;background:#12233B;color:#9CC5FF;white-space:nowrap';
  const bar = '<div id="khAdminBar" style="position:sticky;top:0;z-index:99999;margin:-22px -22px 16px;padding:9px 18px;'
    + 'background:#0B1622F2;border-bottom:1px solid #1E3450;display:flex;gap:8px;align-items:center;'
    + 'flex-wrap:wrap;backdrop-filter:blur(6px)">'
    + '<a href="/admin" title="Alt+← 也能回看板" style="' + pill + ';background:#1B3A5B;color:#CFE3FF;border-color:#2A4E77">← 返回运维看板</a>'
    + '<span id="khCurPage" style="font:600 13px/1.4 sans-serif;color:#E8F1FF;white-space:nowrap">开发端面板</span>'
    + '<select id="khNavSel" title="在面板之间直接切换，不用绕回看板" style="max-width:186px;padding:5px 8px;'
    + 'border-radius:10px;background:#12233B;color:#9CC5FF;border:1px solid #1E3450;font:12.5px/1.4 sans-serif">' + navOpts + '</select>'
    + '<a href="#" onclick="location.reload();return false" title="重新拉取本页数据" style="' + pill + '">⟳ 刷新</a>'
    + '<a href="#" onclick="khSetToken();return false" style="' + pill + '">🔑 中枢口令</a>'
    + '<a href="/index.html" style="' + pill + '">🎬 影视页</a>'
    + '</div>';
  const navScript = '<script>(function(){'
    /* 少数子页 body 没设 padding，注入条用的是 -22px 负边距贴顶，会顶出屏外；
       这里先补齐同样的 22px 内边距，让 13 页的顶栏位置与宽度一致。 */
    + 'try{var st=getComputedStyle(document.body);if(parseFloat(st.paddingTop)<16){'
    + 'document.body.style.paddingTop="22px";document.body.style.paddingLeft="22px";'
    + 'document.body.style.paddingRight="22px";}}catch(e){}'
    + 'var p=location.pathname.replace(/\\/$/,"");'
    + 'var s=document.getElementById("khNavSel"),c=document.getElementById("khCurPage");if(!s)return;'
    + 'var hit=[].slice.call(s.options).filter(function(o){return o.value===p})[0];'
    + 'if(hit){s.value=hit.value;if(c)c.textContent=hit.textContent;}'
    + 's.onchange=function(){if(this.value)location.href=this.value;};'
    + 'document.addEventListener("keydown",function(e){if(e.altKey&&e.key==="ArrowLeft"){location.href="/admin";}});'
    + '})();</script>';
  /* 关键：子页面原来只注入了返回条，没有注入口令——
     一旦中枢开了访问口令，这些页自己发的 /api 请求全是 401，界面只会一直「加载中」。
     这里统一补上：① 所有 fetch 自动带 X-KH-Access-Token；② 支持 ?token= 直达写入；
     ③ 顶栏「中枢口令」按钮可一键从本机取口令/改写。桌面端存 kh_access_token，
     浏览器里存 khAccessToken，两个都读，避免同一个口令两套键对不上。 */
  const tokenScript = '<script>(function(){'
    + 'function T(){try{return localStorage.getItem("khAccessToken")||localStorage.getItem("kh_access_token")||""}catch(e){return ""}}'
    + 'var _f=window.fetch?window.fetch.bind(window):null;'
    + 'if(_f){window.fetch=function(u,o){o=o||{};var t=T();if(t){var h=o.headers;'
    + 'if(!h||typeof h.append!=="function"){o.headers=Object.assign({},(h&&typeof h==="object")?h:{},{"X-KH-Access-Token":t})}}'
    + 'return _f(u,o)}}'
    + 'try{var q=new URLSearchParams(location.search).get("token");if(q){localStorage.setItem("khAccessToken",q)}}catch(e){}'
    + 'window.khSetToken=function(){var cur=T();fetch("/api/dev/access-token",{cache:"no-store"})'
    + '.then(function(r){return r.ok?r.json():null}).then(function(d){var tok=(d&&d.token)||"";'
    + 'var v=prompt("中枢访问口令（本机已自动填入并复制；局域网/深开鸿设备填这一串）：\\n"+tok+"\\n\\n留空=清空口令。",cur||tok);'
    + 'if(v===null)return;try{localStorage.setItem("khAccessToken",v)}catch(e){}location.reload();})'
    + '.catch(function(){var v=prompt("填写中枢访问口令（未开启口令时留空即可）：",cur);'
    + 'if(v===null)return;try{localStorage.setItem("khAccessToken",v)}catch(e){}location.reload();})};'
    + '})();</script>';
  return String(html)
    .replace(/<head(\s[^>]*)?>/i, (m) => m + tokenScript)
    .replace(/<body(\s[^>]*)?>/i, (m) => m + bar + navScript);
}
function cleanIssue(x) {
  return {
    kind: clip(x && x.kind, 16), sev: clip(x && x.sev, 8), code: clip(x && x.code, 20),
    msg: clip(x && x.msg, 240), n: Math.min(9999, Number((x && x.n) || 1) || 1),
    ts: Number((x && x.ts) || Date.now()), view: clip(x && x.view, 20), host: clip(x && x.host, 80),
    ver: clip(x && x.ver, 12), plat: clip(x && x.plat, 10),
    firstTs: Number((x && (x.firstTs || x.ts)) || 0), lastTs: Number((x && (x.lastTs || x.ts)) || 0),
    lv: Math.max(0, Number((x && x.lv) || 0)), live: !!(x && x.live), buf: Math.max(0, Number((x && x.buf) || 0))
  };
}
function cleanReport(r) {
  const s = r.summary || {};
  return {
    id: crypto.createHash('sha1').update(clip(r.deviceId, 48) + '|' + clip(r.sentAt, 24)).digest('hex').slice(0, 16),
    deviceId: clip(r.deviceId, 48), version: clip(r.version, 20), device: clip(r.device, 140),
    sentAt: Number(r.sentAt) || Date.now(), receivedAt: Date.now(),
    summary: {
      total: Number(s.total) || 0, day: Number(s.day) || 0, channels: Number(s.channels) || 0,
      platforms: Number(s.platforms) || 0, manifest: Number(s.manifest) || 0, good: Number(s.good) || 0, bad: Number(s.bad) || 0
    },
    issues: (Array.isArray(r.issues) ? r.issues : []).slice(0, 80).map(cleanIssue)
  };
}
function readBody(req, cb) {
  let size = 0; const chunks = []; let done = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { done = true; cb(null); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => { if (!done) { done = true; cb(Buffer.concat(chunks).toString('utf8')); } });
  req.on('error', () => { if (!done) { done = true; cb(null); } });
}
function readClosure() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'report-closure.json'), 'utf8')); } catch (e) { return null; }
}
function stats() {
  const byKind = {}; const devices = {}; const fp = {}; const dayAgo = Date.now() - 86400000;
  let issues = 0, last24 = 0;
  for (const r of reports) {
    devices[r.deviceId] = 1;
    if (r.receivedAt >= dayAgo) last24 += 1;
    for (const it of r.issues) {
      byKind[it.kind] = (byKind[it.kind] || 0) + (it.n || 1); issues += (it.n || 1);
      const k = [it.kind, it.code || '', it.view || '', it.host || '', it.ver || '', it.plat || '', String(it.msg || '').slice(0, 60)].join('|');
      const e = fp[k] || (fp[k] = { key: k, kind: it.kind, code: it.code || '', host: it.host || '',
        ver: it.ver || '', plat: it.plat || '',
        msg: String(it.msg || '').slice(0, 80), n: 0, devices: new Set(), firstSeen: 0, lastSeen: 0 });
      e.n += (it.n || 1);
      if (r.deviceId) e.devices.add(r.deviceId);
      const t0 = it.firstTs || it.ts || r.receivedAt || 0;
      if (t0 && (!e.firstSeen || t0 < e.firstSeen)) e.firstSeen = t0;
      const t1 = it.lastTs || it.ts || r.receivedAt || 0;
      if (t1 > e.lastSeen) e.lastSeen = t1;
    }
  }
  const top = Object.keys(byKind).map((k) => ({ kind: k, n: byKind[k] })).sort((a, b) => b.n - a.n).slice(0, 8);
  const fingerprints = Object.keys(fp).map((k) => {
    const e = fp[k];
    return { key: e.key, kind: e.kind, code: e.code, host: e.host, ver: e.ver || '', plat: e.plat || '',
      msg: e.msg, n: e.n, deviceCount: e.devices.size, firstSeen: e.firstSeen, lastSeen: e.lastSeen };
  }).sort((a, b) => b.n - a.n).slice(0, 30);
  /* 上报告警：单指纹影响设备数或次数超阈值，交给 /api/reports 与运维面板直接展示 */
  const alerts = fingerprints.filter((x) => (x.lastSeen >= dayAgo && (x.deviceCount >= 30 || x.n >= 500)))
    .map((x) => ({ level: x.deviceCount >= 60 ? 'critical' : 'warn', code: 'report-' + x.kind,
      detail: x.msg + ' · 设备 ' + x.deviceCount + ' / 次数 ' + x.n + (x.host ? ' · ' + x.host : ''),
      firstSeen: x.firstSeen, lastSeen: x.lastSeen }));
  return { reports: reports.length, devices: Object.keys(devices).length, issues, last24, top,
    fingerprints, alerts, closure: readClosure(), writable };
}
function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }

/* ---------------- 实时更新清单 ---------------- */
function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')); } catch (e) { return { sources: null, release: null, error: String(e && e.message || e) }; }
}
function readFeatures() {
  try { return JSON.parse(fs.readFileSync(FEATURES_FILE, 'utf8')); } catch (e) { return []; }
}
function writeFeatures(list) {
  try { fs.writeFileSync(FEATURES_FILE, JSON.stringify(list, null, 2)); return true; } catch (e) { return false; }
}

/* ---------------- 功能版本 / 发版产物 / 中枢候选 ---------------- */
const FEATURE_STAMP_FILE = path.join(__dirname, 'feature-version.json');
function featureStamp() {
  const list = readFeatures();
  const m = readManifest();
  const lat = (m && m.release && m.release.latest) || {};
  const hash = crypto.createHash('sha256').update(JSON.stringify(list)).digest('hex').slice(0, 16);
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(FEATURE_STAMP_FILE, 'utf8')); } catch (e) { /* 尚未发版 */ }
  return {
    versionName: lat.versionName || null,
    versionCode: lat.versionCode || null,
    publishedAt: lat.publishedAt || null,
    count: list.length,
    hash: hash,
    publishedHash: saved ? saved.hash : null,
    inSync: saved ? (saved.hash === hash && Number(saved.versionCode) === Number(lat.versionCode)) : null
  };
}
function releaseArtifacts() {
  const dirs = [path.join(__dirname, '..', 'dist'), path.join(__dirname, '..', 'updates')];
  for (const d of dirs) {
    const p = path.join(d, 'release.json');
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { /* 下一个候选 */ }
  }
  return null;
}
/* 自动批量下发清单：优先 dist/archs.json（postpack + build-archs 生成），
   打包精简环境用内置 updates/archs.json，二者都没有时按现有产物即时生成，
   保证 /api/batch 永远有可用的批量分发结果，不需要人工整理。 */
function batchManifest() {
  const dirs = [path.join(__dirname, '..', 'dist'), path.join(__dirname, '..', 'updates')];
  for (const d of dirs) {
    try { return JSON.parse(fs.readFileSync(path.join(d, 'archs.json'), 'utf8')); } catch (e) { /* 下一个候选 */ }
  }
  const art = releaseArtifacts() || {};
  const lat = (function () { try { return readManifest().release.latest; } catch (e) { return {}; } })() || {};
  const desktop = (art.artifacts && art.artifacts.desktop) || null;
  const out = {
    schema: 1, versionName: art.versionName || lat.versionName || null,
    versionCode: art.versionCode || lat.versionCode || null,
    generatedAt: new Date().toISOString(), generatedBy: 'realtime',
    archs: {}, hap: null, features: art.features || featureStamp()
  };
  ['x64', 'ia32', 'arm64'].forEach(a => {
    /* ia32：Electron 45 起官方不再发布 32 位 Windows 二进制，如实标 unsupported，不再假装回退 x64 */
    if (a === 'ia32') { out.archs[a] = { status: 'unsupported', note: 'Electron 45 起不再提供 32 位 Windows 二进制' }; return; }
    /* arm64：1.7.80 起与 x64 同为客户版产物（过同一套净化），实时兜底也要认它，别一缺清单就退回「回退 x64」 */
    if (a === 'arm64') {
      const ver = lat.versionName || art.versionName || '';
      const name = ver ? '鸿汇影桌面版 Setup ' + ver + '-arm64.exe' : '';
      const fp = name ? path.join(__dirname, '..', 'dist', name) : '';
      if (name && fs.existsSync(fp)) {
        out.archs[a] = { status: 'ready', customer: true, native: true, file: name, size: fs.statSync(fp).size,
          url: '/download/' + encodeURIComponent(name), note: 'ARM64 原生安装包（Windows on ARM）' };
        return;
      }
      out.archs[a] = { status: 'fallback', url: '/download/desktop-setup.exe?arch=arm64', fallbackTo: 'x64' };
      return;
    }
    out.archs[a] = a === 'x64' && desktop
      ? { status: 'ready', file: desktop.file, size: desktop.size, sha256: desktop.sha256, url: '/download/desktop-setup.exe' }
      : { status: 'fallback', url: '/download/desktop-setup.exe', fallbackTo: 'x64' };
  });
  if (art.artifacts && art.artifacts.hap) out.hap = Object.assign({ status: 'ready', url: '/download/honghub-harmony.hap' }, art.artifacts.hap);
  return out;
}
/* 下发成品清单：优先本次发版生成的 dist/delivery.json，其次随包内置的 updates/delivery.json，
   精简环境都没有时按现有产物即时生成 —— 保证任意设备来问都有可用通道。 */
function deliveryManifest() {
  const dirs = [path.join(__dirname, '..', 'dist'), path.join(__dirname, '..', 'updates')];
  for (const d of dirs) {
    try {
      const o = JSON.parse(fs.readFileSync(path.join(d, 'delivery.json'), 'utf8'));
      if (o && o.channels && o.memoryTiers) return o;
    } catch (e) { /* 下一个候选 */ }
  }
  return delivery.buildDelivery(batchManifest());
}
// 中枢自发现：/health 返回本机所有可达地址，设备端缓存后 IP 变化也能找回中枢
function hubAddresses() {
  const out = [];
  try {
    const nets = require('os').networkInterfaces();
    Object.keys(nets).forEach((k) => (nets[k] || []).forEach((a) => {
      if (a.family === 'IPv4' && !a.internal) out.push('http://' + a.address + ':' + PORT);
    }));
  } catch (e) { /* 忽略 */ }
  return out.slice(0, 8);
}
// 更新包定位：项目 dist → 应用内置 updates → 桌面交付位置 → HAP 签名目录
function resolveDownload(file) {
  const home = require('os').homedir();
  const dirs = [
    path.join(__dirname, '..', 'dist'),
    path.join(__dirname, '..', 'updates'),
    path.join(home, 'Desktop'),
    path.join(home, 'Desktop', '新建文件夹 (6)', 'sign'),
    path.join(process.cwd(), 'dist')
  ];
  const aliases = [file];
  if (/\.hap$/i.test(file)) aliases.push('HongHubMovie.hap', 'honghub-harmony.hap');
  if (/\.sha256$/i.test(file)) aliases.push('HongHubMovie.hap.sha256', 'honghub-harmony.hap.sha256');
  for (const d of dirs) {
    for (const a of aliases) {
      const p = path.join(d, a);
      try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* 该目录没有此文件 */ }
    }
    let names = [];
    try { names = fs.readdirSync(d); } catch (e) { continue; }
    let hit = null;
    if (file === 'desktop-setup.exe') {
      hit = names.filter((n) => /Setup.*\.exe$/i.test(n))
        .sort((a, b) => fs.statSync(path.join(d, b)).mtimeMs - fs.statSync(path.join(d, a)).mtimeMs)[0];
    } else if (/\.hap$/i.test(file)) {
      hit = names.filter((n) => /\.hap$/i.test(n))[0];
    }
    if (hit) return path.join(d, hit);
  }
  return null;
}

/* ---------------- 自动升级：本地没包就从镜像站现下现装 ----------------
   顺序：本机 dist/updates/桌面 有安装包 → 直接用；没有 → 读公网清单 desktopUrl
   下载到 updates/ → sha256 + 体积校验 → 再拉起安装向导。
   清单来源与更新检查同一条链（多源 mirrors 顺序重试），不另建一套配置。 */
const UPDATES_DIR = path.join(__dirname, '..', 'updates');

function manifestForInstall() {
  /* 显式指定下载地址（调试 / 灰度 / 指定版本时用，不影响正常链路） */
  if (process.env.KH_UPDATE_DOWNLOAD_URL) {
    return {
      downloadUrl: process.env.KH_UPDATE_DOWNLOAD_URL,
      desktopSha256: process.env.KH_UPDATE_SHA256 || null,
      desktopSize: Number(process.env.KH_UPDATE_SIZE) || 0,
      versionName: null, versionCode: null, source: 'env-override'
    };
  }
  try {
    const p = distribute.published();
    if (p && p.downloadUrl && /^https?:\/\//i.test(p.downloadUrl)) {
      return {
        downloadUrl: p.downloadUrl,
        desktopSha256: p.desktopSha256 || null,
        desktopSize: p.desktopSize || null,
        versionName: p.versionName || null,
        versionCode: p.versionCode || null,
        source: 'public-manifest'
      };
    }
  } catch (e) { /* 落到随包配置 */ }
  try {
    const c = distribute.config();
    if (c && c.enabled && c.desktopUrl) {
      return {
        downloadUrl: c.desktopUrl,
        desktopSha256: c.desktopSha256 || null,
        desktopSize: c.desktopSize || null,
        versionName: c.versionName || null,
        versionCode: c.versionCode || null,
        source: 'bundled-endpoint'
      };
    }
  } catch (e2) { /* 无配置 */ }
  return null;
}

/* 更新包候选列表（#158）：把"单一 downloadUrl"扩成按优先级的多源候选。
   顺序：显式 env → 清单里的绝对地址 → 各镜像（版本目录优先、旧路径兜底）→ 本机镜像站。
   清单给不出哈希时仍允许下载，此时只按体积闸校验，launchSetup 会再核一遍 SHA256。 */
function installCandidates(manIn) {
  const man = manIn || manifestForInstall() || {};
  let mirrors = [];
  try { mirrors = distribute.config().mirrors || []; } catch (e) { mirrors = []; }
  let lat = {};
  try { lat = readManifest().release.latest || {}; } catch (e) { lat = {}; }
  const list = updateSources.candidates({
    versionName: man.versionName || lat.versionName || '',
    mirrors,
    manifest: {
      desktopUrl: man.downloadUrl || null,
      desktopSha256: man.desktopSha256 || null,
      desktopSize: man.desktopSize || null,
      versionName: man.versionName || lat.versionName || null,
      versionCode: man.versionCode || lat.versionCode || null
    },
    envUrl: process.env.KH_UPDATE_DOWNLOAD_URL || '',
    envSha: process.env.KH_UPDATE_SHA256 || '',
    envSize: Number(process.env.KH_UPDATE_SIZE) || 0
  });
  /* 显式指定源时只试它：调试 / 灰度场景不该被兜底源悄悄换掉，失败要能一眼看到 */
  if (man.source === 'env-override') {
    const only = list.filter((c) => c.from === 'env');
    return only.length ? only : list;
  }
  return list;
}

/* 安装包下载进度（#115）：模块级只读状态，供前端轮询展示百分比；不存片源内容与身份信息。 */
const updateProgress = { state: 'idle', received: 0, total: 0, at: 0, kind: '' };

function downloadToFile(url, dest, cb) {
  let done = false;
  const finish = (err, size) => {
    if (done) return; done = true;
    updateProgress.state = err ? 'failed' : 'done';
    updateProgress.at = Date.now();
    if (size != null) updateProgress.received = size;
    cb(err, size);
  };
  try { fs.mkdirSync(path.dirname(dest), { recursive: true }); } catch (e) { /* 已存在 */ }
  /* 断点续传：目标已有部分文件时带 Range 续传（服务端 206 才续，200 则整包重下）。
     半包统一存 <dest>.part，成功后再原子改名，避免校验读到残缺包。 */
  const part = dest + '.part';
  let have = 0;
  try { have = fs.statSync(part).size; } catch (e) { have = 0; }
  if (!have) { try { fs.unlinkSync(part); } catch (e) {} }
  const go = (target, depth) => {
    let mod;
    try { mod = /^https:/i.test(target) ? require('https') : http; } catch (e) { return finish(e); }
    const headers = { 'user-agent': 'HongHubUpdater/1.0', accept: '*/*' };
    if (have > 0) headers.range = 'bytes=' + have + '-';
    const req = mod.get(target, { timeout: 300000, headers }, (res) => {
      const loc = res.headers && res.headers.location;
      if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0 && loc && depth < 5) {
        res.resume();
        let next;
        try { next = new URL(loc, target).toString(); } catch (e) { return finish(new Error('跳转地址非法')); }
        return go(next, depth + 1);
      }
      /* 206 = 续传成功，从已有字节继续写；200 = 服务器不支持 Range，整包重下 */
      const resume = res.statusCode === 206 && have > 0;
      if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); return finish(new Error('HTTP ' + res.statusCode)); }
      if (resume) { console.log('[更新] 断点续传：从 ' + (have / 1048576).toFixed(1) + ' MB 继续'); }
      const len = Number(res.headers['content-length']) || 0;
      updateProgress.state = 'downloading';
      updateProgress.received = resume ? have : 0;
      updateProgress.total = len ? (resume ? have + len : len) : 0;
      updateProgress.at = Date.now();
      const out = fs.createWriteStream(part, resume ? { flags: 'a' } : { flags: 'w' });
      let size = resume ? have : 0;
      res.on('data', (c) => { size += c.length; updateProgress.received = size; updateProgress.at = Date.now(); });
      res.on('error', finish);
      out.on('error', finish);
      out.on('finish', () => {
        try { fs.renameSync(part, dest); } catch (e) { return finish(e); }
        finish(null, size);
      });
      res.pipe(out);
    });
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} finish(new Error('下载超时（5 分钟）')); });
    req.on('error', (e) => {
      /* 网络中断时保留 .part，下次启动自动续传 */
      finish(e);
    });
  };
  try { go(url, 0); } catch (e) { finish(e); }
}

/* 校验并拉起安装向导：非静默，用户在向导里确认覆盖安装；数据与设置保留。 */
function launchSetup(fp, res, extra) {
  let buf;
  try { buf = fs.readFileSync(fp); } catch (e) {
    send(res, 500, { ok: false, error: '安装包读取失败：' + (e && e.message) });
    return;
  }
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const expect = extra && extra.desktopSha256 ? String(extra.desktopSha256).toLowerCase() : null;
  if (expect && expect !== sha) {
    send(res, 409, { ok: false, error: '安装包 SHA256 校验失败，已阻止启动安装', expect: expect, actual: sha });
    return;
  }
  if (extra && extra.desktopSize && Number(extra.desktopSize) > 0 && buf.length !== Number(extra.desktopSize)) {
    send(res, 409, { ok: false, error: '安装包体积与清单不符，已阻止启动安装', expect: Number(extra.desktopSize), actual: buf.length });
    return;
  }
  if (buf.length < 10 * 1024 * 1024) {
    send(res, 409, { ok: false, error: '安装包异常（体积过小）' });
    return;
  }
  /* 静默安装（1.7.86）：校验通过后不在这里拉起向导，只把绝对路径交回渲染进程，
     由 Electron 主进程退出自身后执行 setup /S 覆盖安装，再重新拉起。 */
  if (extra && extra.silent) {
    const lat0 = (function () { try { return readManifest().release.latest; } catch (e2) { return {}; } })() || {};
    send(res, 200, {
      ok: true, silent: true, launched: false, absPath: fp,
      verified: expect ? 'sha256' : 'size-only', sha256: sha,
      version: (extra.versionName) || lat0.versionName || null,
      versionCode: (extra.versionCode) || lat0.versionCode || null,
      file: path.basename(fp), from: extra.source ? extra.source : 'local',
      message: '安装包已下载并校验，交由本机静默覆盖安装（装完会自动重新打开）'
    });
    return;
  }
  /* 只验不装（#158）：排障 / 自测时用 KH_UPDATE_DRYRUN=1，走完下载 + 校验就停，
     不 spawn 安装包，把落盘路径与实测哈希交回。默认关闭，客户机上不生效。 */
  if (String(process.env.KH_UPDATE_DRYRUN || '0') === '1') {
    const lat1 = (function () { try { return readManifest().release.latest; } catch (e2) { return {}; } })() || {};
    send(res, 200, {
      ok: true, dryRun: true, launched: false, absPath: fp,
      verified: expect ? 'sha256' : 'size-only', sha256: sha, size: buf.length,
      version: (extra && extra.versionName) || lat1.versionName || null,
      versionCode: (extra && extra.versionCode) || lat1.versionCode || null,
      file: path.basename(fp), from: extra && extra.source ? extra.source : 'local',
      attempts: (extra && extra.attempts) || [],
      message: '仅校验未安装（KH_UPDATE_DRYRUN=1）：下载 + 校验通过，未拉起安装向导'
    });
    return;
  }
  let launched = false;
  try {
    const child = spawn(fp, [], { detached: true, stdio: 'ignore' });
    child.on('error', (e) => console.error('[更新] 启动安装向导失败', e && e.message));
    child.unref();
    launched = true;
  } catch (e) { /* 下面返回失败 */ }
  const lat = (function () { try { return readManifest().release.latest; } catch (e2) { return {}; } })() || {};
  send(res, launched ? 200 : 500, {
    ok: launched, launched: launched,
    verified: expect ? 'sha256' : 'size-only', sha256: sha,
    version: (extra && extra.versionName) || lat.versionName || null,
    versionCode: (extra && extra.versionCode) || lat.versionCode || null,
    file: path.basename(fp), from: extra && extra.source ? extra.source : 'local',
    message: launched
      ? '覆盖安装已启动：同目录覆盖、无需卸载当前版本、数据与设置保留；若提示程序被占用，请先退出本应用再继续'
      : '启动覆盖安装失败'
  });
}

// 版本归档：releases/index.json 由 npm run archive 生成，回滚端点与下载都读它
const RELEASES_DIR = path.join(__dirname, '..', 'releases');
function readReleaseIndex() {
  try { return JSON.parse(fs.readFileSync(path.join(RELEASES_DIR, 'index.json'), 'utf8')); }
  catch (e) { return { schema: 1, versions: [], latest: null }; }
}
/* 归档客户 Setup 的真实落盘路径：索引路径缺失时回退同目录 desktop-setup.exe 别名；
   含「开发端」的路径一律拒收（客户回滚绝不能装开发端）；错包由 launchSetup 的 SHA256 闸兜底。 */
function archiveDesktopPath(hit) {
  const d = hit && hit.artifacts && hit.artifacts.desktop;
  const rel = d && String(d.path || '');
  if (!rel || rel.indexOf('..') >= 0 || path.isAbsolute(rel) || rel.indexOf('开发端') >= 0) return null;
  const fp = path.join(__dirname, '..', rel);
  try { if (fs.existsSync(fp)) return fp; } catch (e) {}
  const alias = path.join(path.dirname(fp), 'desktop-setup.exe');
  try { if (fs.existsSync(alias)) return alias; } catch (e) {}
  return null;
}
function findArchive(file) {
  if (!fs.existsSync(RELEASES_DIR)) return null;
  for (const d of fs.readdirSync(RELEASES_DIR)) {
    const p = path.join(RELEASES_DIR, d, file);
    try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* 不是该版本的文件 */ }
  }
  return null;
}

// 把任意输入规范化为统一功能对象（缺 id 自动生成）
function normalizeFeature(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const action = String(raw.action || 'open').trim();
  const name = String(raw.name || raw.id || '工具').trim();
  const baseId = String(raw.id || '').trim();
  const f = {
    id: baseId || ('f-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)),
    name: name,
    desc: String(raw.desc || '').slice(0, 240),
    action: (action === 'script' || action === 'cmd') ? 'script' : action,
    icon: String(raw.icon || '🧩').slice(0, 4),
    enabled: raw.enabled !== false,
    // 脚本类默认要求二次确认（本机命令是有副作用的操作），显式 confirm:false 才免确认
    confirm: raw.confirm === undefined
      ? (action === 'script' || action === 'cmd' || raw.requiresConfirm === true)
      : !!raw.confirm
  };
  if (action === 'open' || action === 'webhook') f.url = String(raw.url || '').slice(0, 2000);
  if (action === 'script' || action === 'cmd') f.cmd = String(raw.cmd || raw.url || '').slice(0, 2000);
  if (action === 'webhook' && raw.payload && typeof raw.payload === 'object') f.payload = raw.payload;
  return f;
}

/* ---------------- 一键自愈（异步，避免阻塞服务） ---------------- */
/* 定位鸿蒙影视工程根目录（历史上叫 HongHubMovie，现为 KaihongMovie，且可能在 WorkBuddy
   任一工作区下）。绝不写死单一路径，否则工程一改名/搬家，面板「一键自愈」就报
   「未找到流水线脚本」。优先级：环境变量 > 旧路径 > 扫描 WorkBuddy 各工作区。 */
function findKhRoot() {
  const candidates = [];
  if (process.env.KH_MOVIE_PROJECT) candidates.push(process.env.KH_MOVIE_PROJECT);
  // 旧布局：与桌面工程同级
  candidates.push(path.resolve(__dirname, '..', '..', 'HongHubMovie'));
  candidates.push(path.resolve(__dirname, '..', '..', 'KaihongMovie'));
  // 新布局：影视工程在 WorkBuddy/<工作区>/<工程> 下。关键：运行目录
  // HongHub-Dev/resources/app/server 离 WorkBuddy 有好几层，靠固定层数往上找必然落空，
  // 所以直接用用户主目录下的 WorkBuddy 作为扫描根（覆盖所有工作区，最稳）。
  const roots = [];
  try { roots.push(path.join(os.homedir(), 'WorkBuddy')); } catch (e) { }
  roots.push(path.resolve(__dirname, '..', '..', '..')); // 兼容从源码工程运行的情况
  for (const workbuddyRoot of roots) {
    try {
      for (const entry of fs.readdirSync(workbuddyRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const base = path.join(workbuddyRoot, entry.name);
        candidates.push(path.join(base, 'HongHubMovie'));
        candidates.push(path.join(base, 'KaihongMovie'));
      }
    } catch (e) { }
  }
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, '_signtmp', 'auto_update.py'))) return path.normalize(c); } catch (e) { }
  }
  return null;
}

function runFix(cb) {
  const khRoot = findKhRoot();
  const script = khRoot ? path.join(khRoot, '_signtmp', 'auto_update.py') : '';
  if (!script || !fs.existsSync(script)) { cb({ ok: false, error: '未找到 HongHubMovie/KaihongMovie 流水线脚本（仅开发者机可用；可用 KH_MOVIE_PROJECT 指定工程目录）' }); return; }
  let done = false;
  const finish = (r) => { if (done) return; done = true; try { clearTimeout(timer); } catch (e) {} cb(r); };
  let stderr = '';
  const child = spawn(process.env.PYTHON_BIN || 'python', [script, '--no-build'], { cwd: khRoot });
  const timer = setTimeout(() => { try { child.kill(); } catch (e) {} finish({ ok: false, error: '源体检流水线超时（>540s）' }); }, 540000);
  if (child.stderr) child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.on('error', (e) => { finish({ ok: false, error: '启动流水线失败：' + (e && e.message || e) }); });
  child.on('close', (code) => {
    if (code !== 0) { finish({ ok: false, error: '源体检流水线返回 ' + code, detail: stderr.slice(-400) }); return; }
    try {
      // 重新提取最新清单到本地 manifest.json，使桌面端实时拉到修复后的源
      const idx = path.join(khRoot, 'entry', 'src', 'main', 'resources', 'rawfile', 'movie-site', 'index.html');
      const s = fs.readFileSync(idx, 'utf8');
      const grab = (id) => {
        const m = s.match(new RegExp('<script id="' + id + '"[^>]*>([\\s\\S]*?)</script>'));
        return m ? m[1].trim() : null;
      };
      // 只刷新源清单；release（应用版本 / 校验值 / 更新地址）由 scripts/release.js 在真正出包时维护，
      // 绝不拿影站里随包的旧 release 整体覆盖，否则会把已发布版本冲掉、造成假更新提示。
      const sources = JSON.parse(grab('kh-sources'));
      const cur = readManifest();
      const curSrc = cur.sources || {};
      const curSites = (curSrc.sites || []).length;
      const curTpl = curSrc.searchTpl ? Object.keys(curSrc.searchTpl).length : 0;
      const newSites = (sources.sites || []).length;
      const newTpl = sources.searchTpl ? Object.keys(sources.searchTpl).length : 0;
      // 防旧工程快照回退：外部快照的平台/模板数少于本地清单时，判定为落后快照，拒绝整体覆盖
      // 本地清单（跨工作区可能扫到历史工程的旧快照；频道换源由本地 catalog/auto-fix 链路在本地清单上做）。
      if (newSites < curSites || newTpl < curTpl) {
        finish({ ok: false, error: '外部快照平台清单落后（站点 ' + newSites + '/' + curSites + '，模板 ' + newTpl + '/' + curTpl + '），已拒绝覆盖本地清单', channels: curSrc.channels ? curSrc.channels.length : 0 });
        return;
      }
      cur.sources = sources;
      fs.writeFileSync(MANIFEST_FILE, JSON.stringify(cur, null, 2));
      finish({ ok: true, msg: '已重排坏源并刷新清单到 v' + sources.v, v: sources.v, channels: sources.channels.length });
    } catch (e) { finish({ ok: false, error: String(e && e.message || e) }); }
  });
}

/* ---------------- 内容发布（刷新发布时间 + 内容版本，不抬应用版本） ----------------
   应用版本号只在真的构建出新安装包 / HAP 时由 scripts/release.js 递增。
   自治循环或「一键更新发布」只发布内容（源清单 / 功能 / 最终成品），
   若在这里抬应用版本，客户端会以为有新包 → 弹更新横幅 → 下载的却是同一个包。 */
function bumpRelease() {
  let m;
  try { m = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')); } catch (e) { return { ok: false, error: '读取清单失败：' + (e && e.message || e) }; }
  if (!m.release || !m.release.latest) return { ok: false, error: '清单缺少 release 字段，无法发布' };
  const latest = m.release.latest;
  const nowIso = new Date().toISOString();
  latest.contentVersion = (Number(latest.contentVersion) || 0) + 1;
  latest.publishedAt = nowIso;
  latest.downloadUrl = process.env.DOWNLOAD_URL || '/download/desktop-setup.exe';
  if (m.release) m.release.generatedAt = nowIso;
  try { fs.writeFileSync(MANIFEST_FILE, JSON.stringify(m, null, 2)); }
  catch (e) { return { ok: false, error: '写回清单失败：' + (e && e.message || e) }; }
  return { ok: true, versionName: latest.versionName, versionCode: latest.versionCode, contentVersion: latest.contentVersion, publishedAt: nowIso };
}

/* ---------------- 同时更新 + 发布（异步） ---------------- */
function updatePublish(cb) {
  runFix((upd) => {
    if (!upd.ok) { cb({ ok: false, phase: 'update', error: upd.error || '更新失败', detail: upd.detail || undefined, update: upd }); return; }
    const pub = bumpRelease();
    if (!pub.ok) { cb({ ok: false, phase: 'publish', error: pub.error || '发布失败', update: { msg: upd.msg, v: upd.v, channels: upd.channels }, publish: pub }); return; }
    cb({ ok: true, update: { msg: upd.msg, v: upd.v, channels: upd.channels }, publish: pub });
  });
}

/* ---------------- 自动优化（剔除失效源 / 重排可用源在前） ---------------- */
function optimizeManifest() {
  let m; try { m = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')); } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  if (!m.sources || !m.sources.channels) return { ok: false, error: '清单缺少 sources' };
  let removed = 0;
  m.sources.channels.forEach((ch) => {
    const list = (ch.sources || []).filter((s) => s.status !== 'dead' && s.status !== 'failed');
    removed += (ch.sources || []).length - list.length;
    list.sort((a, b) => ((a.status === 'ok' ? 0 : 1) - (b.status === 'ok' ? 0 : 1)));
    ch.sources = list; ch.sourceCount = list.length;
  });
  try { fs.writeFileSync(MANIFEST_FILE, JSON.stringify(m, null, 2)); }
  catch (e) { return { ok: false, error: '写回清单失败：' + (e && e.message || e) }; }
  return { ok: true, removed: removed, channels: m.sources.channels.length };
}

/* ---------------- 自动添加预设功能（让工具自己长出新能力） ---------------- */
function autoAddPresetFeatures() {
  const presets = readPresets();
  if (!Array.isArray(presets) || !presets.length) return [];
  let list = readFeatures();
  const map = {}; list.forEach((x) => { map[x.id] = x; });
  const added = [];
  presets.forEach((p) => {
    const f = normalizeFeature(p); if (!f) return;
    if (!map[f.id]) { f.enabled = (p.autoEnabled !== false); list.push(f); map[f.id] = f; added.push(f.id); }
  });
  if (added.length) writeFeatures(list);
  return added;
}

/* ---------------- 自动化运行（定时更新 + 发布） ---------------- */
const AUTO_RUN_ENABLED = process.env.AUTO_RUN_ENABLED !== '0';           // 默认开启；置 0 关闭
const AUTO_OPTIMIZE = process.env.AUTO_OPTIMIZE !== '0';                  // 自动优化：默认开启（中枢按计划自我优化）
const AUTO_GOVERN = process.env.AUTO_GOVERN === '1' || AUTO_OPTIMIZE;    // 默认开启「智能自治 / 自动优化」；置 AUTO_OPTIMIZE=0 关闭
const AUTO_RUN_INTERVAL_MS = (Number(process.env.AUTO_RUN_INTERVAL_HOURS) || 24) * 3600 * 1000; // 默认每 24 小时
const AUTO_RUN_HOUR = (function () {                                    // 可选：指定本地小时(0-23)每日定点运行
  const h = Number(process.env.AUTO_RUN_HOUR);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
})();
const AUTO_RUN_FILE = path.join(DATA_DIR, 'auto_runs.jsonl');
const autoRuns = [];
let nextRunAt = 0;
let autoTimer = null;

/* 智能自治运行历史 */
const GOVERN_RUN_FILE = path.join(DATA_DIR, 'govern_runs.jsonl');
const governRuns = [];
function loadGovernRuns() {
  try {
    if (fs.existsSync(GOVERN_RUN_FILE)) {
      fs.readFileSync(GOVERN_RUN_FILE, 'utf8').split('\n').filter(Boolean).forEach((l) => {
        try { governRuns.push(JSON.parse(l)); } catch (e) {}
      });
    }
  } catch (e) {}
}
function recordGovernRun(rec) {
  governRuns.push(rec);
  if (governRuns.length > 50) governRuns.shift();
  try { fs.appendFileSync(GOVERN_RUN_FILE, JSON.stringify(rec) + '\n'); } catch (e) {}
}

function loadAutoRuns() {
  try {
    if (fs.existsSync(AUTO_RUN_FILE)) {
      fs.readFileSync(AUTO_RUN_FILE, 'utf8').split('\n').filter(Boolean).forEach((l) => {
        try { autoRuns.push(JSON.parse(l)); } catch (e) {}
      });
    }
  } catch (e) {}
}
function recordAutoRun(rec) {
  autoRuns.push(rec);
  if (autoRuns.length > 50) autoRuns.shift();
  try { fs.appendFileSync(AUTO_RUN_FILE, JSON.stringify(rec) + '\n'); } catch (e) {}
}
function msUntilNextRun() {
  if (AUTO_RUN_HOUR !== null) {
    const now = new Date();
    const next = new Date(now);
    next.setHours(AUTO_RUN_HOUR, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }
  return AUTO_RUN_INTERVAL_MS;
}
function doAutoRun(cb) {
  const startedAt = Date.now();
  const runner = AUTO_GOVERN ? runGovernance : updatePublish;
  try {
    runner((out) => {
      const rec = { startedAt: startedAt, finishedAt: Date.now(), ok: !!(out && out.ok), result: out };
      recordAutoRun(rec);
      if (cb) cb(rec);
    });
  } catch (e) {
    const rec = { startedAt: startedAt, finishedAt: Date.now(), ok: false, result: { ok: false, error: String(e && e.message || e) } };
    recordAutoRun(rec);
    if (cb) cb(rec);
  }
}
function scheduleAutoRun() {
  if (!AUTO_RUN_ENABLED) { nextRunAt = 0; return; }
  const delay = msUntilNextRun();
  nextRunAt = Date.now() + delay;
  autoTimer = setTimeout(function tick() {
    doAutoRun();
    if (AUTO_RUN_ENABLED) scheduleAutoRun(); // 重新计算下一跳（定点或间隔）
  }, delay);
}

/* ---------------- 自动提取问题（来源状态 + 用户上报，统一归并） ---------------- */
function extractProblems() {
  const m = readManifest();
  const sourceProblems = [];
  if (m && m.sources && m.sources.channels) {
    m.sources.channels.forEach((ch) => (ch.sources || []).forEach((s) => {
      if (s.status && s.status !== 'ok') sourceProblems.push({ scope: 'source', channel: ch.name || '?', name: s.name || s.url || '', status: s.status });
    }));
  }
  const reportProblems = [];
  reports.forEach((r) => r.issues.forEach((i) => {
    if (i.sev === 'error' || i.sev === 'warning')
      reportProblems.push({ scope: 'report', device: r.device || i.view || '?', kind: i.kind || '?', msg: i.msg || '', sev: i.sev, n: i.n || 1 });
  }));
  return { sourceProblems, reportProblems, total: sourceProblems.length + reportProblems.length };
}

/* ---------------- 建议提取（把问题转成可执行的优化/修复建议，规则引擎） ---------------- */
function extractSuggestions(problems) {
  const s = [];
  const dead = problems.sourceProblems.filter((p) => p.status === 'dead' || p.status === 'failed');
  if (dead.length) s.push({ id: 'rm-dead', kind: 'source', title: '移除 ' + dead.length + ' 个失效源', detail: dead.map((p) => p.channel + ':' + p.name).slice(0, 5).join('、'), action: 'auto' });
  const slow = problems.sourceProblems.filter((p) => p.status === 'slow' || p.status === 'warn');
  if (slow.length) s.push({ id: 'reorder', kind: 'source', title: '重排 ' + slow.length + ' 个慢源到后位', detail: '自动优化环节会处理', action: 'auto' });
  if (problems.reportProblems.length) {
    const kinds = [...new Set(problems.reportProblems.map((p) => p.kind))].slice(0, 5);
    s.push({ id: 'user-report', kind: 'report', title: '处理 ' + problems.reportProblems.length + ' 条用户上报', detail: kinds.join('、'), action: 'feedback' });
  }
  if (AUTO_GOVERN) s.push({ id: 'keep-govern', kind: 'system', title: '智能自治已开启', detail: '中枢按计划自动提取问题/优化/修复/更新/发布', action: 'info' });
  return s;
}

/* ---------------- 自动反馈（把本轮结论回写反馈通道，供深开鸿端等拉取） ---------------- */
function autoFeedback(payload) {
  const rec = Object.assign({ at: Date.now() }, payload);
  feedbacks.push(rec);
  if (feedbacks.length > 200) feedbacks.splice(0, feedbacks.length - 200);
  try { fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(rec) + '\n'); } catch (e) { writable = false; }
  return { ok: true, stored: true };
}

/* ---------------- 智能自治循环（自动提取问题→建议提取→自动反馈→自动优化→加更新→自动更新加发布·接收所有最终成品） ---------------- */
function runGovernance(cb) {
  const startedAt = Date.now();
  const result = { problemsFound: 0, problemSources: [], suggestions: [], feedback: null, fixed: null, optimized: null, published: null, featuresAdded: [], finalProducts: null };
  // 1) 自动提取问题
  const problems = extractProblems();
  result.problemsFound = problems.total;
  result.problemSources = problems.sourceProblems.slice(0, 20);
  // 2) 建议提取
  const suggestions = extractSuggestions(problems);
  result.suggestions = suggestions;
  // 3) 加更新（有问题才跑流水线重排源/刷新清单）
  const doFix = problems.total > 0;
  const afterFix = (fixOut) => {
    result.fixed = doFix ? fixOut : { ok: true, skipped: true, reason: 'no-problem' };
    const finish = () => {
      // 4) 自动优化（剔除失效源 / 重排可用源在前）
      result.optimized = optimizeManifest();
      // 5) 自动更新加发布（仅确有实质变化时抬版本，避免无谓刷号；info 类建议、跳过修复不计入变更）
      const fixedOk = result.fixed && result.fixed.ok && !result.fixed.skipped;
      const actionableSugg = suggestions.some((s) => s.action && s.action !== 'info');
      const changed = (result.optimized && result.optimized.ok && result.optimized.removed > 0)
        || (result.featuresAdded && result.featuresAdded.length > 0)
        || fixedOk || result.problemsFound > 0 || actionableSugg;
      result.published = changed ? bumpRelease() : { ok: true, skipped: true, reason: 'no-change' };
      // 6) 自动反馈（把本轮结论回写反馈通道）
      result.feedback = autoFeedback({
        type: 'govern', ok: result.published && (result.published.ok || result.published.skipped),
        problemsFound: result.problemsFound, suggestions: suggestions.map((s) => s.title),
        optimized: result.optimized, published: result.published, featuresAdded: result.featuresAdded
      });
      // 7) 接收所有最终成品：把所有产出聚合成一次快照，供深开鸿端等拉取
      const finalProducts = {
        at: Date.now(),
        problems: { total: result.problemsFound, sources: result.problemSources, reports: problems.reportProblems.slice(0, 20) },
        suggestions: suggestions,
        optimized: result.optimized,
        updated: result.fixed,
        published: result.published,
        featuresAdded: result.featuresAdded,
        features: featureStamp(),          // 功能侧最终成品：本轮功能清单的版本 / 数量 / 指纹
        featureMining: result.featureMining || null, // 反馈建议自动提取的新功能（零人工复核）
        batch: result.batch || batchManifest(),      // 自动批量下发清单：多架构产物 + HAP + 校验值
        delivery: deliveryManifest(),               // 下发成品：不限设备 / 不限内存 / 自动更新策略
        deviceOptimization: result.deviceOptimization || deviceOptimizer.latest(), // OS 版本检测回传后的自动优化
        bugfix: result.bugfix || null,     // 自动修 Bug 最终成品：收集 / 提取 / 修复 / 功能优化
        feedback: result.feedback
      };
      result.finalProducts = finalProducts;
      try { fs.writeFileSync(LATEST_GOVERN_FILE, JSON.stringify(finalProducts, null, 2)); } catch (e) {}
      const rec = { startedAt: startedAt, finishedAt: Date.now(), ok: !!(result.published && result.published.ok), result: result };
      recordGovernRun(rec);
      if (cb) cb(rec);
    };
    // 新增功能（让工具自己长出能力）：先补装内置预设，再从反馈建议里自动提取新功能
    result.featuresAdded = autoAddPresetFeatures();
    // 反馈 / 建议 / 上报 → 自动提取新功能 → 自动加入功能清单 → 自动同步功能快照（零人工复核）
    try {
      result.featureMining = miner.run();
      result.featuresAdded = result.featuresAdded.concat(result.featureMining.added || []);
      // OS 版本检测回传后的自动优化与修复：生成全系统版本适配矩阵并刷新功能快照（不抬应用版本）
      result.deviceOptimization = deviceOptimizer.run();
      result.batch = batchManifest();
    } catch (e) {
      result.featureMining = { ok: false, error: String(e && e.message || e), added: [] };
      result.batch = batchManifest();
    }
    // 自动收集 → 提取 Bug → 自动修可修的 → 按 bug 类型优化功能（结果纳入最终成品）
    try { result.bugfix = bugfix.run(); }
    catch (e) { result.bugfix = { ok: false, error: String(e && e.message || e) }; }
    finish();
  };
  if (doFix) runFix(afterFix); else afterFix({ ok: true, skipped: true, reason: 'no-problem' });
}

/* ---------------- 在线看板（含一键自愈 / 一键更新发布 / 自动化） ---------------- */
const BOARD = [
  '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>鸿汇影 · 远程问题看板</title><style>',
  ':root{color-scheme:dark}*{box-sizing:border-box}',
  'body{margin:0;background:#0C0E16;color:#E7ECF5;font:14px/1.6 system-ui,-apple-system,"Microsoft YaHei",sans-serif}',
  '.wrap{max-width:1180px;margin:0 auto;padding:24px 18px 60px}',
  'h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:26px 0 10px;color:#9AA6BD}',
  '.sub{color:#8A8FA3;font-size:12px;margin-bottom:20px}',
  '.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}',
  '.card{background:#171A26;border:1px solid #262B3B;border-radius:12px;padding:14px 16px}',
  '.card b{display:block;font-size:24px;color:#4ADE80;margin-top:4px}',
  '.card span{font-size:12px;color:#8A8FA3}',
  '.row{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}',
  '.item{background:#171A26;border:1px solid #262B3B;border-radius:10px;padding:12px 14px}',
  '.item .m{font-size:11px;color:#8A8FA3;word-break:break-all}',
  '.item .t{font-size:13px;margin:4px 0 6px}',
  '.tag{display:inline-block;font-size:10px;padding:1px 7px;border-radius:8px;margin-right:6px;background:#252A3A;color:#9AA6BD}',
  '.tag.e{background:rgba(239,68,68,.16);color:#FCA5A5}.tag.w{background:rgba(245,197,66,.14);color:#F5C542}',
  '.bar{display:flex;gap:8px;align-items:center;margin:18px 0;flex-wrap:wrap}',
  'button{background:#262B3B;color:#E7ECF5;border:1px solid #333A50;border-radius:10px;padding:7px 14px;cursor:pointer;font-size:12px}',
  'button.fix{background:#FF4D5E;border-color:#FF4D5E;color:#fff;font-weight:700}',
  'button.pub{background:#2563EB;border-color:#2563EB;color:#fff;font-weight:700}',
  'button:hover{border-color:#FF4D5E}',
  '.empty{color:#8A8FA3;padding:30px;text-align:center;border:1px dashed #333A50;border-radius:12px}',
  '.note{font-size:12px;color:#9AA6C4;margin-left:auto}',
  '.pipes{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:8px 0 14px}',
  '.pipe{background:#171A26;border:1px solid #262B3B;border-radius:10px;padding:10px 8px;text-align:center}',
  '.pipe .n{font-size:11px;color:#8A8FA3}',
  '.pipe .v{font-size:13px;font-weight:700;margin:4px 0 2px}',
  '.pipe .st{font-size:11px;color:#9AA6C4}',
  '.pipe.done{border-color:#2563EB}.pipe.skip{border-color:#333A50}.pipe.warn{border-color:#F5C542}',
  '.pipe.done .st{color:#7FA8FF}.pipe.warn .st{color:#F5C542}',
  '.sub2{font-size:12px;color:#8A8FA3;margin:2px 0 6px}',
  '@media(max-width:900px){.pipes{grid-template-columns:repeat(3,1fr)}}',
  '</style></head><body><div class="wrap">',
  '<h1>鸿汇影 · 远程问题看板</h1>',
  '<div class="sub">桌面版 / 真机自动上报的脱敏问题摘要 · 仅含类别 / 错误码 / 消息 / 次数 / 站点域名与匿名设备 ID · 数据不跨应用共享</div>',
  '<div class="bar"><button onclick="load()">⟳ 立即刷新</button>',
  '<button onclick="location.href=\'/index.html\'">🎬 返回影视页</button>',
  '<button class="fix" onclick="fix()">🔧 一键自愈（重排源 / 刷新清单）</button>',
  '<button class="pub" onclick="updatePublish()">🚀 一键同时更新发布</button>',
  // 顶层上传按钮：与下方「发布并校验」同一接口，放在首屏便于开发端直接上传成品
  '<button class="pub" onclick="opsPublish()">📤 上传成品（发布校验）</button>',
  '<button onclick="setAccessToken()">🔑 口令</button>',
  '<span class="note" id="upd"></span></div>',
  '<div class="cards" id="cards"></div>',
  '<h2>问题类别 Top</h2><div class="row" id="top"></div>',
  '<h2>最近上报</h2><div class="row" id="list"></div>',
  '<h2>问题明细</h2><div class="row" id="detail"></div>',
  '<h2>⚙️ 自动化运行（定时更新 + 发布）</h2>',
  '<div class="bar"><span id="autoState" class="note"></span><button class="pub" id="autoRunBtn" onclick="autoRun()">⚙️ 立即运行自动化</button></div>',
  '<div class="row" id="auto"></div>',
  '<h2>🤖 智能自治循环（自动提取问题 → 修复 → 优化 → 发布 → 新增功能）</h2>',
  '<div class="bar"><span id="govState" class="note"></span><button class="pub" id="govRunBtn" onclick="govRun()">🤖 立即运行自治</button></div>',
  '<div class="row" id="gov"></div>',
  '<h2>🧠 智能自治闭环（六段式 · 全部最终成品实时呈现）</h2>',
  '<div class="sub2">自动提取问题 → 建议提取 → 自动反馈 → 自动优化 → 加更新(自愈) → 自动更新加发布。每轮产出汇总为「最终成品」并下发深开鸿端。</div>',
  '<div class="bar"><span id="loopState" class="note"></span><button class="pub" id="loopRunBtn" onclick="loopRun()">🧠 跑一轮闭环</button></div>',
  '<div class="pipes" id="pipes"><div class="empty" style="grid-column:1/-1">加载中…</div></div>',
  '<div class="row" id="loopSugg"></div>',
  '<div class="row" id="loopDetail"></div>',
  '<h2>🧩 功能管理（免重装在线添加 / 编辑 / 启用 / 删除 / 导入导出）</h2>',
  '<div class="bar"><button class="pub" onclick="featShowAdd()">＋ 添加功能</button>',
  '<button class="pub" onclick="featAddPreset()">＋ 添加预设</button>',
  '<button onclick="featImport()">⬇️ 导入清单</button>',
  '<button onclick="featExport()">⬆️ 导出清单</button>',
  '<span class="note" id="featVer"></span><span class="note" id="featNote"></span></div>',
  '<div class="row" id="featList"></div>',
  '<div id="featForm" style="display:none;margin-top:14px;background:#171A26;border:1px solid #262B3B;border-radius:12px;padding:16px">',
  '<div style="font-weight:700;margin-bottom:10px">添加 / 编辑功能</div>',
  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">',
  '<label style="font-size:12px;color:#9AA6C4">名称<input id="f_name" style="width:100%;margin-top:4px;background:#0C0E16;color:#E7ECF5;border:1px solid #333A50;border-radius:8px;padding:7px"></label>',
  '<label style="font-size:12px;color:#9AA6C4">图标(可选)<input id="f_icon" style="width:100%;margin-top:4px;background:#0C0E16;color:#E7ECF5;border:1px solid #333A50;border-radius:8px;padding:7px" placeholder="🧩"></label>',
  '<label style="font-size:12px;color:#9AA6C4;grid-column:1/3">描述<input id="f_desc" style="width:100%;margin-top:4px;background:#0C0E16;color:#E7ECF5;border:1px solid #333A50;border-radius:8px;padding:7px"></label>',
  '<label style="font-size:12px;color:#9AA6C4">类型<select id="f_action" onchange="featTypeChange()" style="width:100%;margin-top:4px;background:#0C0E16;color:#E7ECF5;border:1px solid #333A50;border-radius:8px;padding:7px"><option value="open">打开链接</option><option value="builtin:report">内置：诊断报告</option><option value="builtin:sourcespeed">内置：源线路排行</option><option value="builtin:fix">内置：一键自愈</option><option value="builtin:updatepublish">内置：同步更新发布</option><option value="builtin:automation">内置：自动化运行</option><option value="builtin:govern">内置：智能自治循环</option><option value="builtin:updatecheck">内置：检查更新</option><option value="script">运行命令(本机)</option><option value="webhook">调用外部接口</option></select></label>',
  '<label id="f_urlLabel" style="font-size:12px;color:#9AA6C4;grid-column:1/3">链接 / 命令 / 接口地址<input id="f_url" style="width:100%;margin-top:4px;background:#0C0E16;color:#E7ECF5;border:1px solid #333A50;border-radius:8px;padding:7px" placeholder="https://..."></label>',
  '<label id="f_payloadLabel" style="display:none;font-size:12px;color:#9AA6C4;grid-column:1/3">接口请求体 JSON(可选)<input id="f_payload" style="width:100%;margin-top:4px;background:#0C0E16;color:#E7ECF5;border:1px solid #333A50;border-radius:8px;padding:7px" placeholder="{&quot;key&quot;:&quot;value&quot;}"></label>',
  '</div>',
  '<label style="display:block;margin-top:10px;font-size:13px;color:#9AA6C4"><input type="checkbox" id="f_confirm"> 执行前需二次确认</label>',
  '<div class="bar" style="margin-top:14px"><button class="pub" onclick="featSave()">💾 保存功能</button><button onclick="featHideForm()">取消</button><span class="note" id="f_msg"></span></div>',
  '</div>',
  '<h2>🐞 自动修 Bug（全自动 · 无需人工复核）</h2>',
  '<div class="sub2">自动收集上报 / 反馈 / 前端源码 / 发版产物 → 自动提取问题 → 自动修复 → 自动复检 → 自动优化功能。服务启动即自动运行并按周期巡检，任何问题都自动处置或自动排队重试，不需要人工复核。</div>',
  '<div class="bar"><span id="bugState" class="note"></span><button class="pub" id="bugRunBtn" onclick="bugRun()">🐞 立即体检（可选，平时自动运行）</button></div>',
  '<div class="row" id="bugList"></div>',
  '<h2>🧩 反馈自动长出新功能 · 📦 自动批量下发</h2>',
  '<div class="sub2">自动提取反馈 / 建议 / 上报里的新功能诉求 → 去重后自动加入功能清单 → 自动同步功能快照 → 自动注入桌面端与开发者端 → 自动优化修复 → 自动生成多架构批量分发清单。全程无需人工复核。</div>',
  '<div class="bar"><span id="flowState" class="note"></span><button class="pub" onclick="flowRun()">🧠 立即跑一轮（可选，平时自动运行）</button></div>',
  '<div class="row" id="flowList"></div>',
  '<h2>🛠️ 开发者端运维（审计 · 趋势 · 灰度 · 发布闭环 · 真机冒烟 · 告警分级）</h2>',
  '<div class="sub2">发布闭环：上传（配置 KH_DEPLOY_CMD 才真的上传）→ 回读远端清单核对版本与 SHA256，不一致就明确报「仅本地就绪」。灰度：同一匿名设备 ID 稳定落组，失败率超阈值自动暂停放量。审计：自愈 / 发布 / 功能增删 / 回滚 / 自动化全部留痕。</div>',
  '<div class="bar"><span id="opsState" class="note"></span>',
  '<button class="pub" onclick="opsPublish()">📤 发布并校验</button>',
  '<button onclick="opsRollback()">↩️ 回滚到指定版本</button>',
  '<button onclick="opsToggleRollout()">🎚️ 暂停 / 恢复放量</button>',
  '<button onclick="opsLoad()">⟳ 刷新运维</button></div>',
  '<div class="cards" id="opsCards"></div>',
  '<div class="row" id="opsTrend"></div>',
  '<div class="row" id="opsAudit"></div>',
  '<h2>🌐 资源覆盖 · 播放回传 · 问题自动跟进（全自动 · 无需人工）</h2>',
  '<div class="sub2">自动探测全部频道与网络平台 → 自动生成带版本号的统一目录（客户端可增量热更新，源修好不用发新版）→ 客户端播放失败自动回传 → 失败率超阈值自动建单 → 频道自动换成可用源并复检 → 通过自动关单；平台侧受限自动降级展示并持续跟踪。每 7 天自动出覆盖周报。</div>',
  '<div class="bar"><span id="resState" class="note"></span>',
  '<button class="pub" onclick="resRun()">🔍 立即巡检（可选，平时每 15 分钟自动跑）</button>',
  '<button onclick="resAdd()">➕ 接入第三方网站</button>',
  '<button onclick="resLoad()">⟳ 刷新资源</button></div>',
  '<div class="cards" id="resCards"></div>',
  '<div class="row" id="resIssues"></div>',
  '</div><script>',
  '(function(){var _f=window.fetch?window.fetch.bind(window):null;if(!_f)return;window.fetch=function(u,o){o=o||{};var t="";try{t=localStorage.getItem("khAccessToken")||""}catch(e){}if(t){var h=o.headers;if(!h||typeof h!=="object"||typeof h.append!=="function"){o.headers=Object.assign({},(h&&typeof h==="object")?h:{},{"X-KH-Access-Token":t})}}return _f(u,o)}})();',
  '(function(){try{var q=new URLSearchParams(location.search).get("token");if(q){localStorage.setItem("khAccessToken",q);}}catch(e){}})();',
  'function setAccessToken(){var cur="";try{cur=localStorage.getItem("khAccessToken")||""}catch(e){}fetch("/api/dev/access-token",{cache:"no-store"}).then(function(r){return r.ok?r.json():null}).then(function(d){var tok=(d&&d.token)||"";if(tok){try{if(navigator.clipboard)navigator.clipboard.writeText(tok)}catch(e){}}var v=prompt("中枢访问口令（本机已自动填入并复制；局域网/深开鸿设备填这一串）：\\n"+tok+"\\n\\n留空=清空口令。如需换新口令，点「确定」后到 /api/dev/access-token 重置或联系开发端。",cur||tok);if(v===null)return;try{localStorage.setItem("khAccessToken",v)}catch(e){}location.reload();}).catch(function(){var v=prompt("填写中枢访问口令（未开启口令时留空即可）：",cur);if(v===null)return;try{localStorage.setItem("khAccessToken",v)}catch(e){}location.reload();});}',
  'function featVerLoad(){fetch("/api/features",{cache:"no-store"}).then(function(r){return r.json()}).then(function(d){var e=document.getElementById("featVer");if(e&&d.version)e.textContent="功能 v"+(d.version.versionName||"-")+" · "+d.version.count+" 项 · "+(d.version.inSync?"已随发版同步":"清单有改动，待发版");}).catch(function(){})}',
  'setTimeout(featVerLoad,400);',
  'function bugRender(x){var st=document.getElementById("bugState");var el=document.getElementById("bugList");if(!x){if(st)st.textContent="全自动体检运行中";if(el)el.innerHTML="<div class=empty>服务启动后自动运行，无需人工操作</div>";return;}var s=x.summary||{};if(st)st.textContent="最近 "+tm(x.finishedAt)+" · 发现 "+(s.total||0)+" 项 · 自动处置 "+(s.autoHandled||s.fixed||0)+" 项 · "+(s.verified?"✅ 自动复检通过（第 "+(s.rounds||1)+" 轮）":"♻️ 已自动排队，下一轮继续（无需人工复核）");var arr=(x.bugs||[]).slice(0,12).map(function(b){return "<div class=item><div class=t>✅ 已自动处置 "+esc(b.title)+"</div><div class=m>"+esc(b.detail||"")+(b.fixMsg?(" · "+esc(b.fixMsg)):"")+"</div></div>";}).join("");if(el)el.innerHTML=arr||"<div class=empty>本轮未发现问题 ✅ 自动复检通过</div>";}',
  'function bugLoad(){fetch("/api/bugfix",{cache:"no-store"}).then(function(r){return r.json()}).then(function(d){bugRender(d.lastRun);}).catch(function(){})}',
  'function bugRun(){var b=document.getElementById("bugRunBtn");if(b){b.disabled=true;b.textContent="🐞 自动处置中…";}fetch("/api/bugfix/run",{method:"POST",cache:"no-store"}).then(function(r){return r.json()}).then(function(d){if(b){b.disabled=false;b.textContent="🐞 立即体检（可选，平时自动运行）";}bugRender(d.result);var s=(d.result&&d.result.summary)||{};var u=document.getElementById("upd");if(u)u.textContent=d.ok?"✅ 自动修 Bug 完成：发现 "+(s.total||0)+" 项，全部自动处置 "+(s.autoHandled||s.fixed||0)+" 项，"+(s.verified?"自动复检通过":"已自动排队，下一轮继续（无需人工复核）"):"❌ 自动修 Bug 失败";}).catch(function(){if(b){b.disabled=false;b.textContent="🐞 立即体检（可选，平时自动运行）";}})}',
  'setTimeout(bugLoad,700);setInterval(bugLoad,30000);',
  'function flowRender(d){var st=document.getElementById("flowState");var el=document.getElementById("flowList");if(!d){if(st)st.textContent="自动闭环运行中";return;}var m=d.mining||{},b=d.batch||{},f=d.features||{},dv=d.delivery||{},os=d.deviceOptimization||{},bf=(d.bugfix||{}).summary||{};var archs=Object.keys(b.archs||{});var ready=archs.filter(function(a){return b.archs[a].status==="ready"});if(st)st.textContent="最近 "+tm(m.finishedAt||b.generatedAt)+" · 自动提取 "+((m.candidates||[]).length)+" 项 · 自动添加 "+((m.added||[]).length)+" 项 · 功能 "+(f.count||0)+" 项 · 批量产物 "+ready.length+"/"+archs.length;var rows=[];rows.push("<div class=item><div class=t>🧩 反馈建议自动提取新功能（零人工复核）</div><div class=m>扫描反馈文本 "+(m.scannedTexts||0)+" 条 → 命中 "+((m.candidates||[]).length)+" 项 → 自动添加 "+(esc((m.added||[]).join("、")||"本轮无新增（已幂等）"))+" · 快照"+(m.stampSynced?"已自动同步":"无需变更")+"</div></div>");rows.push("<div class=item><div class=t>📦 自动批量下发</div><div class=m>"+archs.map(function(a){return a+":"+(b.archs[a].status==="ready"?"原生包就绪":"回退 x64")}).join(" · ")+(b.hap?" · 开鸿 HAP "+(b.hap.size||0)+" B":" · HAP 待出包")+"</div></div>");rows.push("<div class=item><div class=t>🌐 所有包不限设备 · 不限内存 · 自动更新</div><div class=m>通道 "+Object.keys(dv.channels||{}).join(" / ")+" · 内存档 "+Object.keys(dv.memoryTiers||{}).join(" / ")+" · "+(dv.devicePolicy&&dv.devicePolicy.unrestricted?"任意设备可用":"设备受限")+" · "+(dv.autoUpdate&&dv.autoUpdate.contentAlwaysLatest?"内容自动保持最新":"更新待同步")+" · 低内存/未知设备自动保底免安装在线版</div></div>");rows.push("<div class=item><div class=t>🖥️ OS 版本检测回传 · 自动优化 · 自动修复 · 同步下发</div><div class=m>"+(os.followAllOSVersions?"跟随所有操作系统版本":"适配矩阵生成中")+" · "+Object.keys(os.families||{}).length+" 个系统家族 / "+((os.summary||{}).osVersions||0)+" 个版本 · 自动修复 "+((os.summary||{}).fixesApplied||0)+" 项 · 人工项 "+((os.summary||{}).manual||0)+" · 结果随下发清单 / 功能同步自动更新</div></div>");rows.push("<div class=item><div class=t>🔧 自动优化修复</div><div class=m>发现 "+(bf.total||0)+" 项 / 自动处置 "+(bf.autoHandled||bf.fixed||0)+" 项 / 人工项 "+(bf.manual||0)+" / "+(bf.verified?"自动复检通过":"已自动排队重试")+"</div></div>");if(el)el.innerHTML=rows.join("");}',
  'function flowLoad(){fetch("/api/flow",{cache:"no-store"}).then(function(r){return r.json()}).then(function(d){flowRender(d);}).catch(function(){})}',
  'function flowRun(){var b=document.getElementById("flowState");if(b)b.textContent="🧠 自动提取与下发中…";fetch("/api/features/mine",{method:"POST",cache:"no-store"}).then(function(r){return r.json()}).then(function(){return fetch("/api/bugfix/run",{method:"POST",cache:"no-store"})}).then(function(){flowLoad()}).catch(function(){flowLoad()})}',
  'setTimeout(flowLoad,900);setInterval(flowLoad,30000);',
  // 看板（桌面主窗口默认页）也自动回传 OS 版本：任何打开看板的端都会参与自动优化与同步更新
  'function osReport(){try{var ua=navigator.userAgent||"",d={schema:1,kind:"device-profile",deviceId:"",platform:"board",os:ua,osFullName:ua,ua:ua,mem:navigator.deviceMemory||4,arch:/arm64|aarch64/i.test(ua)?"arm64":"x64",appCode:0,screenW:window.innerWidth||0,screenH:window.innerHeight||0};try{d.deviceId=localStorage.getItem("khDeviceId")||""}catch(e){}fetch("/api/device/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d),cache:"no-store"}).then(function(){}).catch(function(){})}catch(e){}}',
  'setTimeout(osReport,1500);setInterval(osReport,600000);',
  'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}',
  'function tm(t){try{return new Date(t).toLocaleString("zh-CN",{hour12:false})}catch(e){return "-"}}',
  'function load(){fetch("/api/reports?limit=60",{cache:"no-store"}).then(r=>r.json()).then(d=>{',
  'var s=d.stats||{},c=document.getElementById("cards");',
  'c.innerHTML=[["上报次数",s.reports||0],["匿名设备",s.devices||0],["问题累计",s.issues||0],["近24小时",s.last24||0],["问题闭环率",(s.closure?s.closure.rate+"%":"—")]].map(x=>"<div class=card><span>"+x[0]+"</span><b>"+x[1]+"</b></div>").join("");',
  'document.getElementById("top").innerHTML=(s.top||[]).map(x=>"<div class=item><div class=t>"+esc(x.kind)+" · "+x.n+" 次</div></div>").join("")||"<div class=empty>暂无数据</div>";',
  'var rs=d.reports||[];document.getElementById("list").innerHTML=rs.slice(0,20).map(r=>"<div class=item><div class=t>"+esc(r.version)+" · "+esc(r.deviceId)+"</div><div class=m>"+esc(r.device)+"</div><div class=m>"+tm(r.receivedAt)+" · "+r.issues.length+" 条 · 源清单 v"+(r.summary.manifest||0)+"</div></div>").join("")||"<div class=empty>还没有收到上报</div>";',
  'var all=[];rs.forEach(r=>r.issues.forEach(i=>all.push({i:i,d:r})));all.sort((a,b)=>b.i.ts-a.i.ts);',
  'document.getElementById("detail").innerHTML=all.slice(0,80).map(x=>{var i=x.i;return "<div class=item><div class=t><span class=\\""+(i.sev==="error"?"tag e":"tag w")+"\\">"+esc(i.kind)+"</span>"+esc(i.code||"")+" ×"+(i.n||1)+"</div><div class=m>"+esc(i.msg)+"</div><div class=m>"+tm(i.ts)+" · "+esc(i.view||"-")+" · "+esc(i.host||"-")+" · "+esc(x.d.deviceId)+"</div></div>"}).join("")||"<div class=empty>暂无问题明细</div>";',
  'document.getElementById("upd").textContent="更新于 "+tm(Date.now())+(s.writable?"":" · 只读模式");',
  '}).catch(e=>document.getElementById("upd").textContent="加载失败："+e.message)}',
  'function fix(){var b=document.querySelector("button.fix");b.disabled=true;b.textContent="🔧 自愈中…";',
  'fetch("/api/fix",{method:"POST",cache:"no-store"}).then(r=>r.json()).then(d=>{',
  'b.disabled=false;b.textContent="🔧 一键自愈（重排源 / 刷新清单）";',
  'document.getElementById("upd").textContent=(d.ok?"✅ "+d.msg:"❌ "+(d.error||"失败"))+" · "+tm(Date.now());',
  'setTimeout(load,1200);}).catch(e=>{b.disabled=false;b.textContent="🔧 一键自愈（重排源 / 刷新清单）";document.getElementById("upd").textContent="自愈失败："+e.message})}',
  'function updatePublish(){var b=document.querySelector("button.pub");b.disabled=true;b.textContent="🚀 发布中…";',
  'fetch("/api/update-publish",{method:"POST",cache:"no-store"}).then(r=>r.json()).then(d=>{',
  'b.disabled=false;b.textContent="🚀 一键同时更新发布";',
  'var ok=d&&d.ok;',
  'var msg=ok?("✅ 已更新并发布 v"+d.publish.versionName+" (#"+d.publish.versionCode+") · 源清单 v"+d.update.v):("❌ "+((d&&d.error)||"失败"));',
  'document.getElementById("upd").textContent=msg+" · "+tm(Date.now());',
  'if(ok)setTimeout(load,1500);}).catch(e=>{b.disabled=false;b.textContent="🚀 一键同时更新发布";document.getElementById("upd").textContent="发布失败："+e.message})}',
  'function autoLoad(){fetch("/api/automation",{cache:"no-store"}).then(function(r){return r.json();}).then(function(d){',
  'var s=document.getElementById("autoState");if(s)s.textContent="自动化："+(d.enabled?"✅ 已开启":"⛔ 已关闭")+" · 下次 "+tm(d.nextRunAt)+(d.lastRun?(" · 上次 "+(d.lastRun.ok?"✅":"❌")+" "+tm(d.lastRun.startedAt)):"");',
  'var rs=d.recent||[];var el=document.getElementById("auto");if(el)el.innerHTML=rs.slice(0,10).map(function(r){return "<div class=item><div class=t>"+(r.ok?"✅":"❌")+" 自动运行 · "+tm(r.startedAt)+"</div><div class=m>耗时 "+((r.finishedAt-r.startedAt)/1000).toFixed(1)+"s · "+(r.ok?("更新 v"+(r.result&&r.result.update&&r.result.update.v)+" / 发布 "+(r.result&&r.result.publish&&r.result.publish.versionName)):(r.result&&r.result.error||"失败"))+"</div></div>"}).join("")||"<div class=empty>还没有自动运行记录</div>";',
  '}).catch(function(e){})}',
  'function autoRun(){var b=document.getElementById("autoRunBtn");if(b){b.disabled=true;b.textContent="⚙️ 运行中…";}',
  'fetch("/api/automation/run",{method:"POST",cache:"no-store"}).then(function(r){return r.json();}).then(function(d){',
  'if(b){b.disabled=false;b.textContent="⚙️ 立即运行自动化";}',
  'document.getElementById("upd").textContent=(d.ok?"✅ 已触发自动化运行":"❌ "+(d.error||"失败"))+" · "+tm(Date.now());',
  'setTimeout(autoLoad,1500);}).catch(function(e){if(b){b.disabled=false;b.textContent="⚙️ 立即运行自动化";}document.getElementById("upd").textContent="触发失败："+e.message})}',
  'function govLoad(){fetch("/api/govern",{cache:"no-store"}).then(function(r){return r.json();}).then(function(d){',
  'var s=document.getElementById("govState");if(s)s.textContent="智能自治："+(d.enabled?"✅ 自动开启（AUTO_GOVERN=1）":"⚙️ 手动");',
  'var rs=d.recent||[];var el=document.getElementById("gov");if(el)el.innerHTML=rs.slice(0,8).map(function(r){var res=r.result||{};return "<div class=item><div class=t>"+(r.ok?"✅":"❌")+" 自治 · "+tm(r.startedAt)+"</div><div class=m>提取问题 "+res.problemsFound+" · 修复 "+(res.fixed?(res.fixed.ok?"✅":"❌"):"跳过")+" · 优化剔除 "+(res.optimized?res.optimized.removed:0)+" · 新增功能 "+(res.featuresAdded||[]).length+" · 发布 "+(res.published?res.published.versionName:"-")+"</div></div>";}).join("")||"<div class=empty>还没有自治运行记录</div>";',
  '}).catch(function(e){})}',
  'function govRun(){var b=document.getElementById("govRunBtn");if(b){b.disabled=true;b.textContent="🤖 运行中…";}',
  'fetch("/api/govern/run",{method:"POST",cache:"no-store"}).then(function(r){return r.json();}).then(function(d){if(b){b.disabled=false;b.textContent="🤖 立即运行自治";}',
  'var res=d.result||{};document.getElementById("upd").textContent=(d.ok?"✅ 自治完成：修复 "+(res.fixed&&res.fixed.ok?"✅":"❌")+" / 优化剔除 "+(res.optimized?res.optimized.removed:0)+" / 新增功能 "+(res.featuresAdded||[]).length+" / 发布 "+(res.published&&res.published.versionName||"-")+"（源清单 v"+(res.published?res.published.versionCode:"-")+"）":"❌ "+(d.error||"失败"))+" · "+tm(Date.now());',
  'setTimeout(govLoad,1500);}).catch(function(e){if(b){b.disabled=false;b.textContent="🤖 立即运行自治";}document.getElementById("upd").textContent="触发失败："+e.message})}',
  'function featNote(s){var e=document.getElementById("featNote");if(e)e.textContent=s;}',
  'function loopPipe(n,v,st,cls){return "<div class=\\"pipe "+(cls||"")+"\\"><div class=n>"+n+"</div><div class=v>"+v+"</div><div class=st>"+st+"</div></div>";}',
  'function loopLoad(){fetch("/api/feedback",{cache:"no-store"}).then(function(r){return r.json();}).then(function(d){',
  'var s=document.getElementById("loopState");var fp=d.finalProducts||{};var fb=(d.feedback||[]);',
  'if(s)s.textContent="闭环：最近一次 "+tm(fp.at||0)+(fp.published&&fp.published.skipped?" · 本轮无变更(跳过发版)":(fp.published&&fp.published.versionName?" · 已发布 v"+fp.published.versionName+" (#"+fp.published.versionCode+")":""));',
  'var p=document.getElementById("pipes");if(p){',
  'var probTotal=(fp.problems&&fp.problems.total)||0;',
  'var suggN=(fp.suggestions||[]).length;',
  'var fbN=fb.length;',
  'var optR=(fp.optimized&&fp.optimized.removed)||0;',
  'var upd=fp.updated||{};var pub=fp.published||{};',
  'p.innerHTML=loopPipe("① 自动提取问题",probTotal+" 项",probTotal>0?"发现问题":"无问题",probTotal>0?"warn":"skip")',
  '+loopPipe("② 建议提取",suggN+" 条",suggN>0?"已生成建议":"无建议",suggN>0?"done":"skip")',
  '+loopPipe("③ 自动反馈",fbN+" 条",fbN>0?"已回传":"未回传",fbN>0?"done":"skip")',
  '+loopPipe("④ 自动优化","剔除 "+optR,optR>0?"已优化":(fp.optimized&&fp.optimized.ok?"无失效源":"—"),optR>0?"done":"skip")',
  '+loopPipe("⑤ 加更新(自愈)",upd.skipped?"跳过":"已更新",upd.skipped?"无需修复":(upd.ok?"已重排源":"—"),upd.skipped?"skip":(upd.ok?"done":"warn"))',
  '+loopPipe("⑥ 自动更新加发布",pub.skipped?"跳过":("v"+(pub.versionName||"?")),pub.skipped?"无变更不发版":"已发布新版本",pub.skipped?"skip":"done");',
  '}',
  'var sg=document.getElementById("loopSugg");if(sg){var sugs=(fp.suggestions||[]);sg.innerHTML=(sugs.length?("<h2 style=\\"font-size:13px;margin:4px 0\\">本轮建议提取</h2>"):"")+sugs.map(function(x){return "<div class=item><div class=t>"+(x.title||"")+"</div><div class=m>"+esc(x.detail||"")+" · <span class=tag>"+esc(x.action||"")+"</span></div></div>";}).join("")||"";}',
  'var dt=document.getElementById("loopDetail");if(dt){',
  'var html="";',
  'if(fp.problems&&fp.problems.sources&&fp.problems.sources.length)html+="<h2 style=\\"font-size:13px;margin:4px 0\\">问题源(前"+fp.problems.sources.length+")</h2>"+fp.problems.sources.map(function(x){return "<div class=item><div class=t><span class=\\"tag e\\">源问题</span>"+esc(x)+"</div></div>";}).join("");',
  'if(fp.featuresAdded&&fp.featuresAdded.length)html+="<h2 style=\\"font-size:13px;margin:4px 0\\">本轮新增功能</h2>"+fp.featuresAdded.map(function(x){return "<div class=item><div class=t>＋ "+(x.name||x)+"</div></div>";}).join("");',
  'if(fp.feedback&&fp.feedback.stored!==undefined)html+="<div class=item><div class=t>📡 反馈回传</div><div class=m>本轮已写入反馈通道，深开鸿端可拉取</div></div>";',
  'dt.innerHTML=html||"<div class=empty>还没有最终成品，点「🧠 跑一轮闭环」生成</div>";',
  '}',
  '}).catch(function(e){var p=document.getElementById("pipes");if(p)p.innerHTML="<div class=empty style=\\"grid-column:1/-1\\">加载失败："+esc(e.message)+"</div>";});}',
  'function loopRun(){var b=document.getElementById("loopRunBtn");if(b){b.disabled=true;b.textContent="🧠 闭环运行中…";}',
  'fetch("/api/govern/run",{method:"POST",cache:"no-store"}).then(function(r){return r.json();}).then(function(d){if(b){b.disabled=false;b.textContent="🧠 跑一轮闭环";}',
  'document.getElementById("upd").textContent=(d.ok?"✅ 闭环完成":"❌ "+(d.error||"失败"))+" · "+tm(Date.now());',
  'setTimeout(loopLoad,1500);}).catch(function(e){if(b){b.disabled=false;b.textContent="🧠 跑一轮闭环";}document.getElementById("upd").textContent="触发失败："+e.message;});}',
  'function featShowAdd(){featEditingId=null;document.getElementById("f_msg").textContent="";document.getElementById("f_name").value="";document.getElementById("f_desc").value="";document.getElementById("f_icon").value="";document.getElementById("f_url").value="";document.getElementById("f_payload").value="";document.getElementById("f_confirm").checked=false;document.getElementById("featForm").style.display="block";featTypeChange();document.getElementById("f_name").focus();}',
  'function featHideForm(){document.getElementById("featForm").style.display="none";}',
  'function featTypeChange(){var a=document.getElementById("f_action").value;var isWeb=(a==="webhook");document.getElementById("f_payloadLabel").style.display=isWeb?"block":"none";var ph=(a==="open")?"https://...":(a==="script")?"python C:/x/clean.py 或 ping 8.8.8.8":(a==="webhook")?"https://api.example.com/hook":"";document.getElementById("f_url").placeholder=ph;}',
  'function featLoad(){fetch("/api/features",{cache:"no-store"}).then(function(r){return r.json();}).then(function(d){var feats=d.features||[];var el=document.getElementById("featList");el.innerHTML=feats.map(function(f){return "<div class=item data-fid=\\\""+esc(f.id)+"\\\"><div class=t>"+(f.icon||"🧩")+" "+esc(f.name||f.id)+"</div><div class=m>"+esc(f.desc||"")+"</div><div class=m>类型："+esc(f.action)+(f.enabled===false?" · ⛔已停用":"")+"</div><div class=acts style=\\\"margin-top:6px\\\"><button data-act=\\\"run\\\">运行</button> <button data-act=\\\"edit\\\">编辑</button> <button data-act=\\\"toggle\\\">"+(f.enabled===false?"启用":"停用")+"</button> <button data-act=\\\"del\\\">删除</button></div></div>";}).join("")||"<div class=empty>还没有功能，点「＋ 添加功能」创建一个</div>";el.querySelectorAll("[data-act]").forEach(function(b){b.onclick=function(){var fid=b.closest("[data-fid]").getAttribute("data-fid");var act=b.getAttribute("data-act");if(act==="run")featRun(fid);else if(act==="edit")featEdit(fid);else if(act==="toggle")featToggle(fid);else if(act==="del")featDelete(fid);};});}).catch(function(e){});}',
  'function featRun(id){fetch("/api/features",{cache:"no-store"}).then(function(r){return r.json();}).then(function(d){var ff=(d.features||[]).filter(function(x){return x.id===id;})[0];if(!ff){featNote("功能不存在");return;}if(ff.confirm){if(!confirm("确认运行功能「"+(ff.name||ff.id)+"」？"))return;}var a=ff.action||"open";if(a==="open"&&ff.url){window.open(ff.url,"_blank");return;}if(a.indexOf("builtin:")===0){runBuiltin(a.slice(8));return;}featNote("正在运行："+(ff.name||ff.id)+" …");fetch("/api/feature/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id})}).then(function(r){return r.json();}).then(function(d2){if(!d2||!d2.ok){featNote("运行失败："+String(d2&&d2.error||"").slice(0,140));return;}if(d2.action==="open"){window.open(d2.url,"_blank");return;}if(d2.stdout!==undefined){featNote("✅ 完成(退出码 "+(d2.code||0)+")："+String(d2.stdout||"").slice(0,240));}else if(d2.status!==undefined){featNote("✅ 接口返回 "+d2.status+(d2.body?("："+String(d2.body).slice(0,160)):""));}else{featNote("✅ 已运行");}}).catch(function(e){featNote("请求失败："+(e&&e.message||e));});}).catch(function(e){featNote("加载失败");});}',
  'function featEdit(id){fetch("/api/features",{cache:"no-store"}).then(function(r){return r.json();}).then(function(d){var f=(d.features||[]).filter(function(x){return x.id===id;})[0];if(!f){return;}featEditingId=id;document.getElementById("f_name").value=f.name||"";document.getElementById("f_desc").value=f.desc||"";document.getElementById("f_icon").value=f.icon||"";document.getElementById("f_action").value=f.action||"open";document.getElementById("f_url").value=f.url||f.cmd||"";document.getElementById("f_payload").value=f.payload?JSON.stringify(f.payload):"";document.getElementById("f_confirm").checked=!!f.confirm;document.getElementById("f_msg").textContent="";document.getElementById("featForm").style.display="block";featTypeChange();}).catch(function(e){});}',
  'function featSave(){var name=document.getElementById("f_name").value.trim();var action=document.getElementById("f_action").value;var url=document.getElementById("f_url").value.trim();if(!name){document.getElementById("f_msg").textContent="请填写名称";return;}if((action==="open"||action==="script"||action==="webhook")&&!url){document.getElementById("f_msg").textContent="请填写链接/命令/接口地址";return;}var f={id:(featEditingId||("f-"+Date.now().toString(36))),name:name,desc:document.getElementById("f_desc").value.trim(),action:action,icon:document.getElementById("f_icon").value.trim()||"🧩",confirm:document.getElementById("f_confirm").checked,enabled:true};if(action==="open"||action==="webhook")f.url=url;if(action==="script")f.cmd=url;if(action==="webhook"){var p=document.getElementById("f_payload").value.trim();if(p){try{f.payload=JSON.parse(p);}catch(e){document.getElementById("f_msg").textContent="请求体 JSON 格式错误";return;}}}var op=featEditingId?"update":"add";var body={op:op,feature:f};if(featEditingId)body.id=featEditingId;fetch("/api/features",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(r){return r.json();}).then(function(d){if(d.ok){featHideForm();featLoad();featNote("✅ 已"+(op==="update"?"更新":"添加")+"功能："+name);}else{document.getElementById("f_msg").textContent="失败："+(d.error||"");}}).catch(function(e){document.getElementById("f_msg").textContent="请求失败："+(e&&e.message||e);});}',
  'function featDelete(id){if(!confirm("确认删除该功能？"))return;fetch("/api/features",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({op:"remove",id:id})}).then(function(r){return r.json();}).then(function(d){if(d.ok){featLoad();featNote("✅ 已删除");}else{featNote("删除失败："+(d.error||""));}});}',
  'function featToggle(id){fetch("/api/features",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({op:"toggle",id:id})}).then(function(r){return r.json();}).then(function(d){if(d.ok){featLoad();featNote("✅ 已切换启用状态");}else{featNote("操作失败："+(d.error||""));}});}',
  'function featImport(){var t=prompt("粘贴功能清单 JSON（数组），将合并导入：","");if(!t)return;var arr;try{arr=JSON.parse(t);}catch(e){featNote("JSON 解析失败");return;}if(!Array.isArray(arr)){featNote("应为数组");return;}fetch("/api/features",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({op:"import",features:arr})}).then(function(r){return r.json();}).then(function(d){if(d.ok){featLoad();featNote("✅ 已导入 "+arr.length+" 项，共 "+d.count+" 个功能");}else{featNote("导入失败："+(d.error||""));}});}',
  'function featExport(){fetch("/api/features",{cache:"no-store"}).then(function(r){return r.json();}).then(function(d){prompt("复制以下功能清单 JSON 分享 / 备份：",JSON.stringify(d.features||[],null,2));});}',
  'function featAddPreset(){Promise.all([fetch("/api/features/presets",{cache:"no-store"}).then(function(r){return r.json();}),fetch("/api/features",{cache:"no-store"}).then(function(r){return r.json();})]).then(function(arr){var all=arr[0].presets||[];var cur=arr[1].features||[];var have={};cur.forEach(function(f){have[f.id]=1;});var ps=all.filter(function(p){return !have[p.id];});if(!all.length){featNote("暂无预设");return;}if(!ps.length){featNote("预设已全部添加（共 "+all.length+" 项），无需重复添加");return;}var names=ps.map(function(p,i){return (i+1)+". "+(p.name||p.id);}).join("\\n");var pick=prompt("选择要添加的预设功能（输入序号）：\\n"+names,"1");if(!pick)return;var idx=parseInt(pick,10)-1;if(isNaN(idx)||idx<0||idx>=ps.length){featNote("序号无效");return;}var p=ps[idx];fetch("/api/features",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({op:"add",feature:p})}).then(function(r){return r.json();}).then(function(d2){if(d2.ok){featLoad();featNote("✅ 已添加预设："+(p.name||p.id));}else{featNote("添加失败："+(d2.error||""));}}).catch(function(e){featNote("请求失败："+e.message);});}).catch(function(e){featNote("加载预设失败");});}',
  'function opsState(s){var e=document.getElementById("opsState");if(e)e.textContent=s||"";}',
  'function opsCard(t,v,st){return "<div class=card><span>"+t+"</span><b>"+v+"</b><span>"+esc(st||"")+"</span></div>";}',
  'function opsLoad(){fetch("/api/ops",{cache:"no-store"}).then(function(r){return r.json()}).then(function(d){',
  'var ro=d.rollout||{},pb=d.publish||{},sm=d.smoke||{},al=d.alerts||{},tr=d.trend||{},au=d.audit||[];',
  'var lv=al.levels||{};var sr=tr.updateSuccessRate;',
  'var cards=document.getElementById("opsCards");if(cards)cards.innerHTML=opsCard("发布状态",(pb.status||"未发布"),(pb.at?("最近 "+tm(Date.parse(pb.at))):"还没跑过发布闭环"))+opsCard("灰度放量",(ro.paused?"已暂停":"放量中"),((ro.groups||[]).length+" 组 / 权重 "+(ro.weightTotal||0)+" · 失败率阈值 "+Math.round((((ro.autoPause||{}).failRate)||0.2)*100)+"%"))+opsCard("真机冒烟",(sm.state||"no-run"),(sm.state==="no-run"?"还没有冒烟记录，接设备后自动落结果":"最近一次真机冒烟结果"))+opsCard("告警",((lv.critical||[]).length+" 严重 / "+((lv.warn||[]).length)+" 警告"),"同码同窗口合并计数")+opsCard("更新成功率",(sr===null||sr===undefined?"—":(sr+"%")),(tr.totals?("成功 "+tr.totals.updateOk+" / 失败 "+tr.totals.updateFail):"暂无发布记录"))+opsCard("问题闭环",(d.closure?(d.closure.rate+"%"):"—"),(d.closure?("已归档 "+d.closure.archived+" / 观测 "+d.closure.observed+" · "+tm(d.closure.at||0)):"还没有归档记录，跑一轮自动修 Bug 后生成"))+opsCard("审计",(au.length+" 条"),"最近写操作留痕");',
  'var t7=(tr.series||[]).slice(-7);var tl=document.getElementById("opsTrend");if(tl)tl.innerHTML=t7.map(function(x){return "<div class=item><div class=t>"+x.date+"</div><div class=m>源可用率 "+(x.okRate===null?"—":(x.okRate+"%"))+" · 更新 "+x.updateOk+"/"+(x.updateOk+x.updateFail)+" · 设备 "+x.devices+"</div></div>";}).join("")||"<div class=empty>还没有趋势数据，跑一轮自愈或发布后开始累积</div>";',
  'var el=document.getElementById("opsAudit");if(el)el.innerHTML=au.map(function(a){var c=a.result==="fail"?"tag e":(a.result==="partial"?"tag w":"tag");return "<div class=item><div class=t><span class=\\""+c+"\\">"+esc(a.action)+"</span>"+tm(a.at)+"</div><div class=m>"+esc(a.target||"")+" "+esc(a.detail||"")+"</div></div>";}).join("")||"<div class=empty>还没有审计记录</div>";',
  'opsState("更新于 "+tm(Date.now()));',
  '}).catch(function(e){opsState("运维数据加载失败："+(e&&e.message||e));});}',
  'function opsPublish(){if(!confirm("执行发布闭环？会跑发布适配器并回读远端清单核对版本与 SHA256。"))return;opsState("发布校验中…");fetch("/api/publish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})}).then(function(r){return r.json()}).then(function(d){opsState((d.ok?"✅ 已发布并校验通过":"⚠️ "+(d.status||"未完成"))+" · "+String(d.detail||d.note||"").slice(0,160));setTimeout(opsLoad,800);}).catch(function(e){opsState("发布失败："+(e&&e.message||e));});}',
  'function opsRollback(){var v=prompt("要回滚到的版本号（例如 1.7.6）：","");if(!v)return;fetch("/api/update/rollback/apply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:v})}).then(function(r){return r.json()}).then(function(d){opsState(d.ok?("✅ 已回滚：下发版本切到 "+d.version+" · "+String(d.note||"")):("❌ "+(d.error||"回滚失败")+(d.available?(" · 可选 "+d.available.join(" / ")):"")));setTimeout(opsLoad,800);}).catch(function(e){opsState("回滚失败："+(e&&e.message||e));});}',
  'function opsToggleRollout(){fetch("/api/rollout",{cache:"no-store"}).then(function(r){return r.json()}).then(function(d){var ro=d.rollout||{};var next=!ro.paused;if(!confirm((next?"暂停":"恢复")+"放量？当前 "+(ro.groups||[]).length+" 组 / 权重 "+(ro.weightTotal||0)))return;return fetch("/api/rollout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paused:next,pauseReason:next?"手动暂停放量":null})}).then(function(r){return r.json()}).then(function(d2){opsState(d2.ok?(next?"⏸ 已暂停放量":"▶️ 已恢复放量"):("操作失败："+(d2.error||"")));setTimeout(opsLoad,600);});}).catch(function(e){opsState("灰度操作失败："+(e&&e.message||e));});}',
  'function runBuiltin(n){if(n==="fix"){fix();return;}if(n==="updatepublish"){updatePublish();return;}if(n==="automation"){autoRun();return;}if(n==="govern"){loopRun();return;}if(n==="publish"){opsPublish();return;}if(n==="rollback"){opsRollback();return;}opsState("该能力在「开发者端运维」面板，已为你刷新并定位");opsLoad();var el=document.getElementById("opsCards");if(el&&el.scrollIntoView)el.scrollIntoView({behavior:"smooth",block:"start"});}',
  'function resRender(r,i){var st=document.getElementById("resState");var c=document.getElementById("resCards");var il=document.getElementById("resIssues");if(!r){if(st)st.textContent="自动巡检运行中";return;}var t=r.totals||{};if(st)st.textContent="目录 "+(r.catalogVersion||"-")+" · 生成 "+tm(r.generatedAt)+" · 资源 "+(t.items||0)+" 条（频道 "+(t.channels||0)+" / 平台 "+(t.platforms||0)+"）· 可用 "+(t.ok||0)+" · 失效 "+(t.dead||0)+" · 受限 "+(t.blocked||0)+" · 问题单 待处理 "+(((i||{}).summary||{}).open||0)+" / 跟踪 "+(((i||{}).summary||{}).tracking||0)+" / 已解决 "+(((i||{}).summary||{}).resolved||0);',
  'if(c)c.innerHTML=[["资源总数",t.items||0],["可用",t.ok||0],["失效",t.dead||0],["平台受限",t.blocked||0]].map(function(x){return "<div class=card><span>"+x[0]+"</span><b>"+x[1]+"</b></div>"}).join("");',
  'var arr=((i||{}).list||[]).slice(0,14).map(function(x){return "<div class=item><div class=t>"+(x.status==="resolved"?"✅ 已自动关单":"⚠️ "+x.status+" · ")+esc(x.name)+"</div><div class=m>"+esc(x.reason||"")+" · 尝试 "+x.attempts+" 次"+(x.failureRate!=null?(" · 失败率 "+x.failureRate+"%"):"")+" · "+(x.type==="channel"?"频道（自动换源）":"平台（自动跟踪）")+" · 最近 "+tm(x.lastAt)+"</div></div>"}).join("");if(il)il.innerHTML=arr||"<div class=empty>暂无问题单 ✅ 全量资源探测通过</div>";}',
  'function resLoad(){var p=fetch("/api/ops",{cache:"no-store"}).then(function(r){return r.json()}).then(function(d){return d.resources||{};});var q=fetch("/api/issues",{cache:"no-store"}).then(function(r){return r.json();});Promise.all([p,q]).then(function(a){resRender(a[0],a[1])}).catch(function(){resRender(null);})}',
  'function resRun(){var b=document.getElementById("resState");if(b)b.textContent="正在探测全部频道与平台（自动建单 + 自动换源 + 自动复检）…";fetch("/api/catalog/run",{method:"POST",cache:"no-store"}).then(function(r){return r.json()}).then(function(d){var s=(d&&d.cycle)||{};if(b)b.textContent=d.ok?("✅ 本轮巡检完成：可用 "+((s.totals||{}).ok||0)+"/"+((s.totals||{}).items||0)+" · 自动修复 "+(((s.issues||{}).autoFixedThisRun)||0)+" 项 · 待处理 "+(((s.issues||{}).open)||0)):("❌ "+(d.error||"巡检失败"));resLoad();}).catch(function(e){if(b)b.textContent="巡检失败："+(e&&e.message||e);})}',
  'function resAdd(){var url=prompt("要接入的第三方网址（http/https，一行一个可批量）：","");if(!url)return;var cat=prompt("归类（例如 第三方站点 / 日韩平台 / 欧美平台，留空=第三方站点）：","第三方站点");fetch("/api/sites",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:url,cat:cat||"第三方站点"})}).then(function(r){return r.json()}).then(function(d){var st=document.getElementById("resState");if(st)st.textContent=d.ok?("✅ 已接入 "+d.added+" 个（跳过 "+d.skipped+"）· 平台总数 "+d.totalSites+" · 清单 v"+d.manifestVersion):("❌ "+(d.error||"接入失败"));setTimeout(function(){fetch("/api/catalog/run",{method:"POST",cache:"no-store"}).then(resLoad).catch(resLoad);},600);}).catch(function(e){var st=document.getElementById("resState");if(st)st.textContent="接入失败："+(e&&e.message||e);})}',
  'setTimeout(resLoad,1200);setInterval(resLoad,60000);',
  'var featEditingId=null;load();autoLoad();featLoad();govLoad();loopLoad();opsLoad();setInterval(load,60000);setInterval(autoLoad,60000);setInterval(featLoad,60000);setInterval(govLoad,60000);setInterval(loopLoad,60000);setInterval(opsLoad,60000);',
  '</script></body></html>'
].join('\n').replace(/鸿汇影/g, PRODUCT_NAME);

/* ---------------- 静态托管 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.m3u8': 'application/vnd.apple.mpegurl', '.mp4': 'video/mp4', '.webm': 'video/webm'
};
function serveStatic(res, u, req) {
  let p;
  try { p = decodeURIComponent(u.pathname); }
  catch (e) { send(res, 400, { ok: false, error: 'bad uri' }); return; }   // 畸形百分号编码不再打崩进程
  /* 影视页一律纯净：开发向入口（扩展工具 / PKG 角标 / 运维面板）只在 /admin 里，
     客户成品、开发端、设备端、局域网访问看到的播放页都一致，不出现开发入口。 */
  const devViewer = false;
  if (p === '/' || p === '') p = '/index.html';
  if (p === '/index.html') {
    /* 走 activePage() 的版本比较，不再无条件发缓存页：
       旧写法只要 server/data/app.page.html 存在就发它，装了新版仍显示旧频道（v1.7.15 实测踩到）。 */
    const ap = activePage();
    if (ap.buf.length) {
      const buf = withUiFlag(ap.buf, devViewer);
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store', 'Content-Length': buf.length });
      res.end(buf); return;
    }
  }
  const fp = path.normalize(path.join(APP_DIR, p));
  if (fp !== APP_DIR && !fp.startsWith(APP_DIR + path.sep)) { send(res, 403, { ok: false, error: 'forbidden' }); return; }
  /* 静态目录白名单：只对外提供页面与素材，不把 server/、scripts/、package.json 等源码下发出去。
     前端已模块化（1.7.72）：app 根下的 kh-*.js / *.css 是页面依赖，必须放行，否则页面白屏。 */
  const rel = p.replace(/^\/+/, '');
  const allowStatic = rel === 'index.html' || rel === 'favicon.ico' ||
    rel.indexOf('app/') === 0 || rel.indexOf('assets/') === 0 || rel.indexOf('lib/') === 0 ||
    /^[^/\\]+\.(js|css)$/.test(rel);
  if (!allowStatic) { send(res, 404, { ok: false, error: 'not found' }); return; }
  fs.stat(fp, (e, st) => {
    if (e || !st.isFile()) {
      const idx = path.join(APP_DIR, 'index.html');
      fs.readFile(idx, (e2, buf) => {
        if (e2) { send(res, 404, { ok: false, error: 'not found' }); return; }
        const out = withUiFlag(buf, devViewer);
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': out.length }); res.end(out);
      });
      return;
    }
    fs.readFile(fp, (e3, buf) => {
      if (e3) { send(res, 500, { ok: false, error: 'read error' }); return; }
      const ext = path.extname(fp).toLowerCase();
      const out = (p === '/index.html') ? withUiFlag(buf, devViewer) : buf;
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': out.length });
      res.end(out);
    });
  });
}

/* 页面纯净开关：只有「本机回环 + 开发端」才注入 KH_UI_CLEAN=0（开发入口可见）；
   其余一律纯净（KH_UI_CLEAN=1，并用样式兜住 PKG 角标与扩展工具面板）。
   页面自身默认按客户纯净版处理，所以设备端 / 离线页面 / 局域网访问同样不露开发向入口。 */
function isLoopback(req) {
  try {
    const a = String((req && req.socket && req.socket.remoteAddress) || '');
    return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  } catch (e) { return false; }
}
function withUiFlag(buf, devViewer) {
  try {
    const clean = !devViewer;
    const script = '<script>window.KH_UI_CLEAN=' + (clean ? '1' : '0') + ';</script>' +
      (clean ? '<style>#__pkgver,#khToolsBtn,#khToolsPanel{display:none!important}</style>' : '');
    const s = buf.toString('utf8');
    const at = s.indexOf('<head>');
    if (at >= 0) return Buffer.from(s.slice(0, at + 6) + script + s.slice(at + 6), 'utf8');
    return Buffer.from(script + s, 'utf8');
  } catch (e) { return buf; }
}

/* 兜底自动检测：任何端打开看板 / 探活时，按 User-Agent 自动记录 OS 版本并触发自动优化。
   同一 UA 10 分钟内只写一次、优化最多每分钟一次，避免重复膨胀；结果随下发清单同步更新。 */
const uaSeen = new Map();
let lastUaOptimize = 0;
function autoDetectUA(req, pathname) {
  if (pathname !== '/' && pathname !== '/health') return;
  const ua = req.headers['user-agent'] || '';
  if (!ua || ua.length > 400) return;
  const now = Date.now();
  if (now - (uaSeen.get(ua) || 0) < 10 * 60 * 1000) return;
  uaSeen.set(ua, now);
  if (uaSeen.size > 200) uaSeen.clear();
  try {
    const id = 'ua-' + require('crypto').createHash('sha1').update(ua).digest('hex').slice(0, 12);
    deviceOptimizer.appendReport({
      schema: 1, app: 'HongHub', kind: 'ua-auto-detect', deviceId: id,
      osFullName: ua, ua: ua, platform: 'auto', appCode: 0
    });
    if (now - lastUaOptimize > 60 * 1000) { lastUaOptimize = now; deviceOptimizer.run(); }
  } catch (e) { /* 只读环境不影响正常服务 */ }
}

/* 请求分发。整体包一层 try/catch：任何路由意外抛错只影响当次请求，
   绝不让整个本地服务进程退出（过去畸形 URL 即可打崩服务，Electron 自愈 3 次后白屏）。 */
function handleRequest(req, res) {
  const u = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  autoDetectUA(req, u.pathname);
  /* 开发端口令自助：只对本机回环开口（本机本来免口令），用于在面板上一键查看/复制/重置，
     局域网设备仍然必须自己带口令，避免把口令摊给整网。 */
  if (u.pathname === '/api/dev/access-token' && DEV_MODE) {
    const ra = String(req.socket && req.socket.remoteAddress || '');
    const loop = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
    if (!loop) { send(res, 403, { ok: false, error: '仅本机可查看口令' }); return; }
    if (req.method === 'GET') { send(res, 200, { ok: true, token: ACCESS_TOKEN || '', lanMode: !!(ACCESS_TOKEN && HOST !== '127.0.0.1') }); return; }
    if (req.method === 'POST') {
      ACCESS_TOKEN = genAccessToken();
      try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(path.join(DATA_DIR, 'access-token.txt'), ACCESS_TOKEN + '\n'); } catch (e) {}
      send(res, 200, { ok: true, token: ACCESS_TOKEN, regenerated: true });
      console.log('[HongHub-Desktop] 访问口令已重置：' + ACCESS_TOKEN);
      return;
    }
  }
  // 可选局域网访问口令（默认关闭）：开启后只有带正确口令的 /api 与 /download 请求可通行，
  // /health 与看板页面仍放行，保证设备端能先发现中枢再输入口令。
  if (ACCESS_TOKEN && (u.pathname.indexOf('/api/') === 0 || u.pathname.indexOf('/download/') === 0)) {
    const t = req.headers['x-kh-access-token'] || u.searchParams.get('token') || '';
    if (t !== ACCESS_TOKEN) { send(res, 401, { ok: false, error: '访问口令错误，请在「中枢设置」里填写口令' }); return; }
  }

  /* 客户成品不提供开发端运维能力：发布 / 自治 / 自动修复 / 功能运行时只在 KH_DEV_MODE=1 下开放。
     客户端页面也不再提供这些入口，这里做第二道闸，防止有人手拼 URL 直接调用。
     运维数据类接口（审计 / 趋势 / 告警 / 运维总览 / 站点表 / 设备台账 / 回传清单）同样只给开发端：
     客户端页面本身并不调用它们，暴露出去等于把运维数据摊给客户。 */
  if (!DEV_MODE && /^\/api\/(publish|update-publish|automation|automation\/run|govern|govern\/run|bugfix|bugfix\/run|aibugfix|aibugfix\/run|feature\/run|batch|rollout|update\/rollback|update\/rollback\/apply|hap\/smoke|audit|metrics|alerts|ops|sites|devices(?!\/queue\/next|\/queue\/ack)|reports|issues\/run|ai\/(diagnose|analyze|translate))(\/|$)/.test(u.pathname)) {
    send(res, 404, { ok: false, error: 'not found' });
    return;
  }

  if (u.pathname === '/health') {
    const last = autoRuns.length ? autoRuns[autoRuns.length - 1] : null;
    const lastG = governRuns.length ? governRuns[governRuns.length - 1] : null;
    const lat = (function () { try { return readManifest().release.latest; } catch (e) { return {}; } })() || {};
    send(res, 200, { ok: true, app: 'HongHub-Desktop', buildId: buildId(), devMode: DEV_MODE, stored: reports.length, writable, tokenRequired: !!REPORT_TOKEN, fixTokenRequired: !!FIX_TOKEN, accessTokenRequired: !!ACCESS_TOKEN, hubs: hubAddresses(), release: { versionName: lat.versionName, versionCode: lat.versionCode, publishedAt: lat.publishedAt }, features: featureStamp().hash, manifest: readManifest().sources ? readManifest().sources.v : null, auto: { enabled: AUTO_RUN_ENABLED, mode: AUTO_GOVERN ? 'govern' : 'update', nextRunAt: nextRunAt, lastRunOk: last ? last.ok : null, lastRunAt: last ? last.startedAt : null }, govern: { enabled: AUTO_GOVERN, lastRunOk: lastG ? lastG.ok : null, lastRunAt: lastG ? lastG.startedAt : null }, diagnostics: (function () { try { const s = healthMonitor.snapshot(); return { healthy: s.healthy, diskFreeMB: s.diskFreeMB, memUsedPct: s.mem.usedPct, alerts: s.alerts.length }; } catch (e) { return null; } })() });
    return;
  }
  // 源健康度：读 sources:verify 落下的体检报告（只报事实，没有报告就明说没测）
  if (u.pathname === '/api/sources/health' && req.method === 'GET') {
    cors(res);
    let rep = null;
    for (const f of [path.join(DATA_DIR, 'sources-report.json'), path.join(__dirname, 'data/sources-report.json')]) {
      try { if (!rep && fs.existsSync(f)) rep = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
    }
    if (!rep) { send(res, 200, { ok: true, ready: false, note: '尚未运行 npm run sources:verify' }); return; }
    send(res, 200, {
      ok: true, ready: true, at: rep.at, totals: rep.totals, coverage: rep.coverage,
      lists: (rep.lists || []).map(function (l) { return { url: l.url, ok: l.ok, n: l.n, why: l.why }; })
    });
    return;
  }

  /* 页面里的版本角标（右下角 PKG x.y.z）就是拉这个文件；以前包内没有它、也没有路由，
     客户端一直显示占位符 "PKG …"。这里按当前安装好的版本与功能指纹现算一份，离线也能显示。 */
  if (u.pathname === '/remote-manifest.json' && req.method === 'GET') {
    const lat0 = (function () { try { return readManifest().release.latest; } catch (e) { return {}; } })() || {};
    const body = {
      schema: 1,
      versionName: lat0.versionName || null,
      versionCode: lat0.versionCode || null,
      publishedAt: lat0.publishedAt || null,
      distribution: 'bundled',
      offline: true,
      features: featureStamp(),
      generatedAt: new Date().toISOString()
    };
    cors(res);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(JSON.stringify(body)) });
    res.end(JSON.stringify(body));
    return;
  }

  if (u.pathname === '/api/manifest' && req.method === 'GET') {
    const m = readManifest();
    m.buildId = buildId();
    try {
      if (m && m.release && m.release.latest && !m.release.latest.downloadUrl) m.release.latest.downloadUrl = process.env.DOWNLOAD_URL || '/download/desktop-setup.exe';
      const art = releaseArtifacts();
      if (m && m.release) m.release.artifacts = art;
      if (m && m.release && m.release.latest && art && art.artifacts) {
        if (art.artifacts.desktop) m.release.latest.desktopSha256 = art.artifacts.desktop.sha256;
        if (art.artifacts.hap) m.release.latest.hapSha256 = art.artifacts.hap.sha256;
      }
    } catch (e) {}
    // 已配置并实际发布公网清单时，客户端下载地址自动切到公网（版本必须一致）
    try { if (m && m.release && m.release.latest) m.release.latest = distribute.applyToLatest(m.release.latest); } catch (e) {}
    /* 双通道清单基建：stable 别名指向稳定 latest；beta 未配置内测包时为 null，不下发任何内测下载链接 */
    try {
      if (m && m.release) {
        m.release.stable = m.release.latest || null;
        m.release.beta = m.release.beta || null;
        m.release.channels = {
          stable: !!(m.release.latest && m.release.latest.versionCode),
          beta: !!(m.release.beta && m.release.beta.versionCode),
          betaNote: m.release.betaNote || ''
        };
      }
    } catch (e) {}
    // 统一资源目录版本：客户端带 ?since= 拉增量即可热更新，源修好不用发新版
    try {
      const c = catalog.catalog();
      if (c && c.version) { m.catalogVersion = c.version; m.catalogUrl = '/api/catalog'; m.catalogDiffUrl = '/api/catalog/diff?since='; }
    } catch (e) {}
    send(res, 200, m); return;
  }
  // 版本归档与回滚引导：只返回已校验的历史成品与下载地址，应用内不静默安装
  if (u.pathname === '/api/releases' && req.method === 'GET') {
    const idx = readReleaseIndex();
    send(res, 200, { ok: true, latest: idx.latest || null, versions: idx.versions || [],
      count: (idx.versions || []).length, generatedAt: idx.generatedAt || null });
    return;
  }
  if (u.pathname === '/api/update/rollback' && req.method === 'GET') {
    const want = String(u.searchParams.get('version') || '').trim();
    const idx = readReleaseIndex();
    const hit = (idx.versions || []).find(v => v.versionName === want);
    if (!hit) {
      send(res, 404, { ok: false, error: '未找到该版本的归档产物（可先 npm run archive）',
        available: (idx.versions || []).map(v => v.versionName) });
      return;
    }
    const d = hit.artifacts && hit.artifacts.desktop;
    const alive = !!archiveDesktopPath(hit);
    send(res, 200, { ok: alive, version: hit.versionName, versionCode: hit.versionCode || null,
      downloadUrl: alive ? hit.downloadUrl : null, hapUrl: hit.hapUrl || null,
      sha256: (d && d.sha256) || null, size: (d && d.size) || 0,
      fileExists: alive, historical: !!hit.historical,
      note: '回滚只提供历史成品与校验值；安装需用户在安装向导确认，应用内不静默安装。' });
    return;
  }
  /* 能力探测（公开只读）：客户端据此决定「外部条件」功能卡片是否呈现。
     这里只回答布尔值，不暴露模型地址、密钥或额度。 */
  if (u.pathname === '/api/capabilities' && req.method === 'GET') {
    let aiTranslate = false;
    try { aiTranslate = !!aiAdvisor.isConfigured(); } catch (e) { aiTranslate = false; }
    send(res, 200, { ok: true, aiTranslate, dmr: false, cast: false,
      note: 'aiTranslate=已配置外部模型；cast 需桌面端 UDP 能力，网页与设备端恒为 false' });
    return;
  }
  if (u.pathname === '/api/health/diagnostics' && req.method === 'GET') {
    send(res, 200, Object.assign({}, healthMonitor.snapshot(), { recentAlerts: healthMonitor.recent(20) }));
    return;
  }
  /* 每日体检报告：GET 看历史（最近 30 份）；POST ?run=1 立即生成一份（开发端） */
  if (u.pathname === '/api/health/daily' && req.method === 'GET') {
    const q = new URLSearchParams(u.search || '');
    if (q.get('run') === '1') {
      if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
      try { send(res, 200, { ok: true, report: writeDailyReport() }); }
      catch (e) { send(res, 500, { ok: false, error: '生成失败：' + (e && e.message) }); }
      return;
    }
    const rows = readDailyReports();
    send(res, 200, { ok: true, total: rows.length, items: rows.slice(-7).reverse() });
    return;
  }

  /* ---------------- 开发者端运维：审计 / 趋势 / 灰度 / 发布闭环 / 真机冒烟 / 告警分级 ---------------- */
  // 一次取全运维面板所需数据（看板首屏只发一个请求）
  if (u.pathname === '/api/ops' && req.method === 'GET') {
    let snap = {};
    try { snap = healthMonitor.snapshot(); } catch (e) { snap = {}; }
    let recent = [];
    try { recent = healthMonitor.recent(30); } catch (e) { recent = []; }
    const st = stats();
    send(res, 200, Object.assign(devops.overview({
      days: Number(u.searchParams.get('days')) || 14,
      top: st.top,
      alerts: (snap.alerts || []).concat(recent)
    }), { resources: catalog.overview(), closure: st.closure }));
    return;
  }
  if (u.pathname === '/api/audit' && req.method === 'GET') {
    send(res, 200, { ok: true, entries: devops.listAudit(Number(u.searchParams.get('limit')) || 60) });
    return;
  }
  if (u.pathname === '/api/metrics/trend' && req.method === 'GET') {
    send(res, 200, Object.assign({ ok: true }, devops.trend(Number(u.searchParams.get('days')) || 14, { top: stats().top })));
    return;
  }
  if (u.pathname === '/api/rollout' && req.method === 'GET') {
    const r = devops.readRollout();
    send(res, 200, { ok: true, rollout: r });
    return;
  }
  // 灰度分组配置：分组 / 权重 / 自动暂停阈值；同组设备按匿名 ID 稳定落组
  if (u.pathname === '/api/rollout' && req.method === 'POST') {
    readBody(req, (body) => {
      if (!body) { send(res, 413, { ok: false, error: 'empty or oversized body' }); return; }
      let p; try { p = JSON.parse(body); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      const r = devops.writeRollout({
        enabled: p.enabled === undefined ? undefined : !!p.enabled,
        groups: p.groups, autoPause: p.autoPause,
        paused: p.paused === undefined ? undefined : !!p.paused,
        pauseReason: p.paused === false ? null : p.pauseReason
      });
      devops.audit('rollout.update', { result: r.ok ? 'ok' : 'fail', detail: r.ok ? ('分组 ' + r.rollout.groups.length + ' 个 / 总权重 ' + r.rollout.weightTotal + ' / ' + (r.rollout.paused ? '已暂停' : '放量中')) : r.error });
      send(res, r.ok ? 200 : 400, r);
    });
    return;
  }
  if (u.pathname === '/api/alerts' && req.method === 'GET') {
    let snap = {}; try { snap = healthMonitor.snapshot(); } catch (e) { snap = {}; }
    let recent = []; try { recent = healthMonitor.recent(50); } catch (e) { recent = []; }
    send(res, 200, Object.assign({ ok: true }, devops.gradeAlerts((snap.alerts || []).concat(recent), { windowMs: Number(u.searchParams.get('window')) * 60000 || undefined })));
    return;
  }
  // 真机冒烟结果：读 dist/hap-smoke.json / hap-watch.json，没跑过就明确 no-run
  if (u.pathname === '/api/hap/smoke' && req.method === 'GET') {
    send(res, 200, Object.assign({ ok: true }, devops.smoke()));
    return;
  }
  if (u.pathname === '/api/publish' && req.method === 'GET') {
    send(res, 200, { ok: true, last: devops.lastPublish(), deployCmd: !!process.env.KH_DEPLOY_CMD });
    return;
  }
  // 发布闭环：上传（配置了 KH_DEPLOY_CMD 才真的传）→ 回读远端清单核对版本与 SHA256
  if (u.pathname === '/api/publish' && req.method === 'POST') {
    readBody(req, (body) => {
      let p = {};
      if (body) { try { p = JSON.parse(body) || {}; } catch (e) { p = {}; } }
      devops.runPublish({ dryRun: !!p.dryRun }, (out) => { send(res, out.ok ? 200 : 202, out); });
    });
    return;
  }
  // 回滚：把下发版本切到已校验的历史成品（不静默安装，设备仍需本机确认）
  if (u.pathname === '/api/update/rollback/apply' && req.method === 'POST') {
    readBody(req, (body) => {
      if (!body) { send(res, 413, { ok: false, error: 'empty or oversized body' }); return; }
      let p; try { p = JSON.parse(body); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      devops.applyRollback(p.version, readReleaseIndex, function (hit) {
        const m = readManifest();
        if (!m.release || !m.release.latest) return { ok: false, error: '清单缺少 release.latest' };
        const d = (hit.artifacts && hit.artifacts.desktop) || {};
        m.release.latest.versionName = hit.versionName;
        m.release.latest.versionCode = hit.versionCode || m.release.latest.versionCode;
        m.release.latest.downloadUrl = hit.downloadUrl || m.release.latest.downloadUrl;
        m.release.latest.desktopSha256 = d.sha256 || m.release.latest.desktopSha256;
        m.release.latest.hapUrl = hit.hapUrl || m.release.latest.hapUrl;
        m.release.latest.rolledBack = true;
        m.release.latest.rolledBackAt = new Date().toISOString();
        m.release.latest.publishedAt = new Date().toISOString();
        try { fs.writeFileSync(MANIFEST_FILE, JSON.stringify(m, null, 2) + '\n'); } catch (e) { return { ok: false, error: '写回清单失败：' + (e && e.message || e) }; }
        return { ok: true };
      }, (out) => { send(res, out.ok ? 200 : 400, out); });
    });
    return;
  }
  if (u.pathname === '/api/features' && req.method === 'GET') { send(res, 200, { ok: true, features: extras.features.apply(readFeatures()), version: featureStamp() }); return; }

  /* ---------------- 资源目录 / 播放回传 / 问题单：全自动闭环 ---------------- */
  // 统一目录（频道 + 平台），带版本号；客户端可按 ?since= 增量热更新，源修好无需发新版
  if (u.pathname === '/api/catalog' && req.method === 'GET') {
    send(res, 200, catalog.catalog()); return;
  }
  if (u.pathname === '/api/catalog/diff' && req.method === 'GET') {
    send(res, 200, Object.assign({ ok: true }, catalog.diff(u.searchParams.get('since')))); return;
  }
  // 立即跑一轮探测 + 自动建单 + 自动修复（平时由定时器自动跑，这里只用于排障）
  if (u.pathname === '/api/catalog/run' && req.method === 'POST') {
    catalog.runCycle().then(function (s) { send(res, 200, { ok: true, cycle: s }); })
      .catch(function (e) { send(res, 500, { ok: false, error: String(e && e.message || e) }); });
    return;
  }
  if (u.pathname === '/api/catalog/weekly' && req.method === 'GET') {
    send(res, 200, Object.assign({ ok: true }, catalog.weekly(!!u.searchParams.get('force')))); return;
  }
  // 客户端播放埋点：只记资源 id 与结果，不记内容、不记 IP
  if (u.pathname === '/api/play/report' && req.method === 'POST') {
    readBody(req, (body) => {
      if (!body) { send(res, 413, { ok: false, error: 'empty or oversized body' }); return; }
      let p; try { p = JSON.parse(body); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      send(res, 200, catalog.ingestPlay(p));
    });
    return;
  }
  if (u.pathname === '/api/play/stats' && req.method === 'GET') {
    send(res, 200, Object.assign({ ok: true }, catalog.playStats(Number(u.searchParams.get('days')) || 1))); return;
  }
  // 问题单：自动建单 / 自动换源修复 / 自动复检关单；这里允许人工覆盖，但默认全自动
  if (u.pathname === '/api/issues' && req.method === 'GET') {
    send(res, 200, catalog.issues()); return;
  }
  if (u.pathname === '/api/issues' && req.method === 'POST') {
    readBody(req, (body) => {
      if (!body) { send(res, 413, { ok: false, error: 'empty or oversized body' }); return; }
      let p; try { p = JSON.parse(body); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      send(res, 200, catalog.issueAction(p.id, p.action));
    });
    return;
  }
  /* 第三方站点接入：自定义网址 / 批量导入 / 移除（只做入口与可达性，不抓流） */
  // 平台清单管理页：按省筛选、改分类、改名、删除，一屏看全（开发端才有）
  if (u.pathname === '/admin/sites' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let html = '';
    try { html = fs.readFileSync(path.join(__dirname, 'sites-admin.html'), 'utf8'); }
    catch (e) { send(res, 500, { ok: false, error: 'sites-admin.html 缺失' }); return; }
    html = withAdminBack(html);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }

  if (u.pathname === '/api/sites' && req.method === 'GET') {
    send(res, 200, catalog.listSites()); return;
  }

  /* 功能追踪：客户端每版带哪些功能、线上有没有、这一版增删了什么（仅开发端可看） */
  if (u.pathname === '/api/features/track' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, featureTrack.status()); }
    catch (e) { send(res, 500, { ok: false, error: '功能追踪失败：' + (e && e.message) }); }
    return;
  }
  /* 设备能力表：把 /api/devices 的 OS 版本 / 形态 / caps 六键从接口搬到界面，
     这样「开发端界面始终能追踪客户端新功能」不再只靠 API 查看。 */
  if (u.pathname === '/admin/devices' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let html = '';
    try { html = fs.readFileSync(path.join(__dirname, 'devices-admin.html'), 'utf8'); }
    catch (e) { send(res, 500, { ok: false, error: 'devices-admin.html 缺失' }); return; }
    html = withAdminBack(html);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }
  if (u.pathname === '/admin/features' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let html = '';
    try { html = fs.readFileSync(path.join(__dirname, 'features-admin.html'), 'utf8'); }
    catch (e) { send(res, 500, { ok: false, error: 'features-admin.html 缺失' }); return; }
    html = withAdminBack(html);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }
  if (u.pathname === '/api/release/diff' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try {
      const q = u.searchParams;
      send(res, 200, releaseCenter.diff(q.get('from') || '', q.get('to') || ''));
    } catch (e) { send(res, 500, { ok: false, error: '对比失败：' + (e && e.message) }); }
    return;
  }

  /* dist 体积治理：归档副本清理，先出计划（dryRun），确认后才落盘删除 */
  if (u.pathname === '/api/dist/cleanup/plan' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try {
      const q = u.searchParams;
      send(res, 200, distCleanup.plan({
        keepVersions: Number(q.get('keepVersions')) || 5,
        keepZips: Number(q.get('keepZips')) || 5,
        keepClients: Number(q.get('keepClients')) || 2
      }));
    } catch (e) { send(res, 500, { ok: false, error: '生成计划失败：' + (e && e.message) }); }
    return;
  }
  if (u.pathname === '/api/dist/cleanup/run' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      let b = {};
      try { b = JSON.parse(body || '{}') || {}; } catch (e) {}
      if (b.dryRun !== false) b.dryRun = true; // 默认只预览，必须显式传 false 才真删
      try { send(res, 200, distCleanup.run(b)); }
      catch (e) { send(res, 500, { ok: false, error: '清理失败：' + (e && e.message) }); }
    });
    req.on('error', () => {});
    return;
  }

  /* 设备批量队列：服务端就绪；客户端 app/index.html 的 khQueuePoller 轮询 next 并 ack。
     next / ack 是客户端接口（客户版同样可用），列表 / 入队 / 清空仍是开发端接口。 */
  if (u.pathname === '/api/devices/queue/next' && req.method === 'GET') { 
    try { const nq = new URLSearchParams(u.search || ''); send(res, 200, deviceQueue.next(nq.get('device'))); }
    catch (e) { send(res, 500, { ok: false, error: '取任务失败：' + (e && e.message) }); }
    return;
  }
  if (u.pathname === '/api/devices/queue/ack' && req.method === 'POST') {
    let abody = '';
    req.on('data', (c) => { abody += c; if (abody.length > 16384) req.destroy(); });
    req.on('end', () => {
      let b = {};
      try { b = JSON.parse(abody || '{}') || {}; } catch (e) {}
      try {
        const r = deviceQueue.ack(b);
        send(res, r.ok ? 200 : 400, r);
      } catch (e) { send(res, 500, { ok: false, error: '回报失败：' + (e && e.message) }); }
    });
    req.on('error', () => {});
    return;
  }
  if (u.pathname === '/api/devices/queue' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, deviceQueue.list(100)); }
    catch (e) { send(res, 500, { ok: false, error: '读取队列失败：' + (e && e.message) }); }
    return;
  }
  if (u.pathname === '/api/devices/queue/add' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 16384) req.destroy(); });
    req.on('end', () => {
      let b = {};
      try { b = JSON.parse(body || '{}') || {}; } catch (e) {}
      try {
        const r = deviceQueue.add(b);
        send(res, r.ok ? 200 : 400, r);
      } catch (e) { send(res, 500, { ok: false, error: '入队失败：' + (e && e.message) }); }
    });
    req.on('error', () => {});
    return;
  }
  if (u.pathname === '/api/devices/queue/clear' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, deviceQueue.clear()); }
    catch (e) { send(res, 500, { ok: false, error: '清空失败：' + (e && e.message) }); }
    return;
  }

  /* 源体检与补备源：单线路 / 慢速 / 受限频道可视化，定向补源，优先线路排序 */
  if (u.pathname === '/api/sources/weak' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, sourceHealth.report()); }
    catch (e) { send(res, 500, { ok: false, error: '体检失败：' + (e && e.message) }); }
    return;
  }
  if (u.pathname === '/api/sources/hunt' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let limit = 8;
      try { limit = Number((JSON.parse(body || '{}') || {}).limit) || 8; } catch (e) {}
      sourceHealth.hunt(Math.max(1, Math.min(30, limit)))
        .then(function (r) { send(res, 200, r); })
        .catch(function (e) { send(res, 500, { ok: false, error: '补源失败：' + (e && e.message) }); });
    });
    req.on('error', () => {});
    return;
  }
  if (u.pathname === '/api/sources/prioritize' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, sourceHealth.prioritize()); }
    catch (e) { send(res, 500, { ok: false, error: '排序失败：' + (e && e.message) }); }
    return;
  }

  /* 平台条目体检：批量校验重复/缺分组/非法类型，安全修复前自动备份 */
  if (u.pathname === '/admin/catalog' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let html = '';
    try { html = fs.readFileSync(path.join(__dirname, 'catalog-admin.html'), 'utf8'); }
    catch (e) { send(res, 500, { ok: false, error: 'catalog-admin.html 缺失' }); return; }
    html = withAdminBack(html);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }
  if (u.pathname === '/api/catalog/audit' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, catalogAudit.audit()); }
    catch (e) { send(res, 500, { ok: false, error: '体检失败：' + (e && e.message) }); }
    return;
  }
  if (u.pathname === '/api/catalog/audit/apply' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 16384) req.destroy(); });
    req.on('end', () => {
      let opts = {};
      try { opts = JSON.parse(body || '{}') || {}; } catch (e) {}
      try { send(res, 200, catalogAudit.apply(opts)); }
      catch (e) { send(res, 500, { ok: false, error: '修复失败：' + (e && e.message) }); }
    });
    req.on('error', () => {});
    return;
  }

  /* 质量门禁：把现成的静态门禁 / UI 冒烟 / HAP 冒烟搬上面板，运行结果落 logs/qc-*.log */
  if (u.pathname === '/admin/quality' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let html = '';
    try { html = fs.readFileSync(path.join(__dirname, 'quality-admin.html'), 'utf8'); }
    catch (e) { send(res, 500, { ok: false, error: 'quality-admin.html 缺失' }); return; }
    html = withAdminBack(html);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }
  if (u.pathname === '/api/quality/status' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, qualityCenter.all()); }
    catch (e) { send(res, 500, { ok: false, error: '读取状态失败：' + (e && e.message) }); }
    return;
  }
  if (u.pathname === '/api/quality/run' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      let name = '';
      try { name = (JSON.parse(body || '{}') || {}).name || ''; } catch (e) {}
      let r = { ok: false, error: '参数缺失' };
      try { r = qualityCenter.run(name); }
      catch (e) { r = { ok: false, error: '启动失败：' + (e && e.message) }; }
      send(res, r.ok ? 200 : 400, r);
    });
    req.on('error', () => {});
    return;
  }

  /* 开发端总目录：一处列出全部面板 + 各自实时状态，附口令查看与变更日志生成 */
  if (u.pathname === '/admin/home' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let html = '';
    try { html = fs.readFileSync(path.join(__dirname, 'home-admin.html'), 'utf8'); }
    catch (e) { send(res, 500, { ok: false, error: 'home-admin.html 缺失' }); return; }
    html = withAdminBack(html);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }
  if (u.pathname === '/api/changelog' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, releaseCenter.changelog()); }
    catch (e) { send(res, 500, { ok: false, error: '生成变更日志失败：' + (e && e.message) }); }
    return;
  }
  if (u.pathname === '/api/changelog/write' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try {
      const md = releaseCenter.changelogMarkdown();
      const f = path.join(__dirname, '..', 'CHANGELOG.md');
      fs.writeFileSync(f, md, 'utf8');
      send(res, 200, { ok: true, file: 'CHANGELOG.md', bytes: Buffer.byteLength(md), entries: releaseCenter.changelog().count });
    } catch (e) { send(res, 500, { ok: false, error: '写入失败：' + (e && e.message) }); }
    return;
  }

  /* 数据与体积：遥测/趋势/失效源/选源评分集中在 /admin/metrics；SBOM 与 dist 体积同页可查 */
  if (u.pathname === '/admin/metrics' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let html = '';
    try { html = fs.readFileSync(path.join(__dirname, 'metrics-admin.html'), 'utf8'); }
    catch (e) { send(res, 500, { ok: false, error: 'metrics-admin.html 缺失' }); return; }
    html = withAdminBack(html);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }
  if (u.pathname === '/api/sbom' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, releaseCenter.sbom()); }
    catch (e) { send(res, 500, { ok: false, error: '读取 SBOM 失败：' + (e && e.message) }); }
    return;
  }
  if (u.pathname === '/api/dist-size' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, releaseCenter.distSize()); }
    catch (e) { send(res, 500, { ok: false, error: '统计体积失败：' + (e && e.message) }); }
    return;
  }

  /* 发布与运维：发布历史/归档、发版闸门红绿、日志查看器、操作审计（仅开发端） */
  if (u.pathname === '/admin/release' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let html = '';
    try { html = fs.readFileSync(path.join(__dirname, 'release-admin.html'), 'utf8'); }
    catch (e) { send(res, 500, { ok: false, error: 'release-admin.html 缺失' }); return; }
    html = withAdminBack(html);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }
  if (u.pathname === '/api/release/center' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, { ok: true, releases: releaseCenter.releases(), gates: releaseCenter.gates() }); }
    catch (e) { send(res, 500, { ok: false, error: '读取发布数据失败：' + (e && e.message) }); }
    return;
  }
  if (u.pathname === '/api/logs' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, { ok: true, logs: releaseCenter.logs() }); }
    catch (e) { send(res, 500, { ok: false, error: '读取日志列表失败：' + (e && e.message) }); }
    return;
  }
  if (u.pathname === '/api/logs/read' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, releaseCenter.readLog(u.searchParams.get('name'), u.searchParams.get('tail'))); }
    catch (e) { send(res, 500, { ok: false, error: '读取日志失败：' + (e && e.message) }); }
    return;
  }

  /* 告警中心：把 /api/alerts 的数据做成能看、能配外发渠道的面板（仅开发端） */
  if (u.pathname === '/admin/alerts' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let html = '';
    try { html = fs.readFileSync(path.join(__dirname, 'alerts-admin.html'), 'utf8'); }
    catch (e) { send(res, 500, { ok: false, error: 'alerts-admin.html 缺失' }); return; }
    html = withAdminBack(html);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }
  if (u.pathname === '/api/alerts/center' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, alertsCenter.list()); }
    catch (e) { send(res, 500, { ok: false, error: '读取告警失败：' + (e && e.message) }); }
    return;
  }
  if (u.pathname === '/api/alerts/config' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    send(res, 200, { ok: true, config: alertsCenter.config() });
    return;
  }
  if ((u.pathname === '/api/alerts/config' || u.pathname === '/api/alerts/test') && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch (e) {}
      if (u.pathname === '/api/alerts/config') {
        try { send(res, 200, { ok: true, config: alertsCenter.saveConfig(parsed) }); }
        catch (e) { send(res, 500, { ok: false, error: '保存失败：' + (e && e.message) }); }
        return;
      }
      try {
        alertsCenter.sendTest(parsed && parsed.url).then((r) => send(res, 200, r))
          .catch((e) => send(res, 500, { ok: false, error: '发送失败：' + (e && e.message) }));
      } catch (e) { send(res, 500, { ok: false, error: '发送失败：' + (e && e.message) }); }
    });
    req.on('error', () => {});
    return;
  }


  if (u.pathname === '/admin/build' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let html = '';
    try { html = fs.readFileSync(path.join(__dirname, 'build-admin.html'), 'utf8'); }
    catch (e) { send(res, 500, { ok: false, error: 'build-admin.html 缺失' }); return; }
    html = withAdminBack(html);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }
  if (u.pathname === '/api/build/status' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, buildStatus.status()); }
    catch (e) { send(res, 500, { ok: false, error: '读取发版状态失败：' + (e && e.message) }); }
    return;
  }
  /* 界面触发一次发版：走的是和手工命令行同一条流水线，出包前先看锁，别人在跑就直接拒 */
  if (u.pathname === '/api/build/run' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
      req.on('end', () => {
        let args = ['--keep-going'];
        try { const p = JSON.parse(body || '{}'); if (p && p.bump) args.push('--bump'); } catch (e) {}
        try { send(res, 200, buildStatus.runOnce(args)); }
        catch (e) { send(res, 500, { ok: false, error: '启动失败：' + (e && e.message) }); }
      });
      req.on('error', () => {});
    } catch (e) { send(res, 500, { ok: false, error: '启动失败：' + (e && e.message) }); }
    return;
  }

  /* 自动发版一键暂停 / 恢复：以前只能手工改 paused.json 和 Startup 的 .vbs 后缀，这里搬到面板上。
     暂停：写 logs/auto-publish.paused.json + 杀掉守候进程（保留锁文件由进程退出时自行清理）。
     恢复：清暂停标记（--resume）+ 用同一份 node 拉起守候进程（detached，脱离服务端生命周期）。 */
  if (u.pathname === '/api/autopublish' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      let p = {};
      try { p = JSON.parse(body || '{}'); } catch (e) {}
      const ROOT = path.join(__dirname, '..');
      const LOGS = path.join(ROOT, 'logs');
      const PAUSE_FILE = path.join(LOGS, 'auto-publish.paused.json');
      const LOCK_FILE = path.join(LOGS, 'auto-publish.lock');
      const WATCHER = path.join(ROOT, 'scripts', 'auto-publish-watch.js');
      const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
      const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return false; } };

      if (p.paused === true) {
        const reason = String(p.reason || '人工暂停（面板操作）').slice(0, 120);
        try { fs.writeFileSync(PAUSE_FILE, JSON.stringify({ paused: true, reason, at: new Date().toISOString() }, null, 2) + '\n'); }
        catch (e) { send(res, 500, { ok: false, error: '写暂停标记失败：' + (e && e.message) }); return; }
        const lock = readJson(LOCK_FILE);
        let killed = false;
        if (lock && alive(lock.pid)) {
          try { process.kill(lock.pid); killed = true; } catch (e) {}
          if (!killed) { try { spawnSync('taskkill', ['/PID', String(lock.pid), '/F'], { windowsHide: true }); killed = true; } catch (e) {} }
        }
        try { devops.audit('autopublish.pause', { result: 'ok', detail: reason + (killed ? ' · 已停守候进程' : ' · 守候进程本就未在跑') }); } catch (e) {}
        send(res, 200, { ok: true, paused: true, reason, watcherStopped: killed, hint: '已暂停：不会再自动出包；手工「跑一次发版」不受影响' });
        return;
      }

      // 恢复
      try { if (fs.existsSync(PAUSE_FILE)) fs.unlinkSync(PAUSE_FILE); } catch (e) {}
      let resumeOut = '';
      try {
        const r = spawnSync(process.execPath, [WATCHER, '--resume'], { cwd: ROOT, windowsHide: true, timeout: 20000, encoding: 'utf8' });
        resumeOut = String((r.stdout || '') + (r.stderr || '')).trim().slice(-300);
      } catch (e) { resumeOut = 'resume 失败：' + (e && e.message); }
      const lock0 = readJson(LOCK_FILE);
      if (lock0 && alive(lock0.pid)) {
        send(res, 200, { ok: true, paused: false, alreadyRunning: true, pid: lock0.pid, hint: '守候进程已在运行，暂停标记已清除' });
        return;
      }
      try {
        const child = spawn(process.execPath, [WATCHER], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true, env: Object.assign({}, process.env, { KH_DEV_MODE: '1' }) });
        child.unref();
        // 给守候进程 1.2 秒写锁，随后回报真实 pid
        setTimeout(() => {
          const lk = readJson(LOCK_FILE);
          const pid = (lk && lk.pid) || child.pid;
          try { devops.audit('autopublish.resume', { result: 'ok', detail: 'pid ' + pid }); } catch (e) {}
          send(res, 200, { ok: true, paused: false, pid, resume: resumeOut, hint: '已恢复自动发版，守候进程 pid ' + pid });
        }, 1200);
      } catch (e) {
        send(res, 500, { ok: false, error: '拉起守候进程失败：' + (e && e.message) });
      }
    });
    req.on('error', () => {});
    return;
  }

  /* 维护决策数据：收视热度（谁真的在看）/ 失效源 TOP（该先修哪条线） */
  if (u.pathname === '/api/stats/heat' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, insights.heat(Number(u.searchParams.get('days') || 7))); }
    catch (e) { send(res, 500, { ok: false, error: '收视热度统计失败：' + (e && e.message) }); }
    return;
  }
  if (u.pathname === '/api/stats/fail-top' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    try { send(res, 200, insights.failTop(Number(u.searchParams.get('limit') || 25))); }
    catch (e) { send(res, 500, { ok: false, error: '失效源统计失败：' + (e && e.message) }); }
    return;
  }
  if (u.pathname === '/admin/insights' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let html = '';
    try { html = fs.readFileSync(path.join(__dirname, 'insights-admin.html'), 'utf8'); }
    catch (e) { send(res, 500, { ok: false, error: 'insights-admin.html 缺失' }); return; }
    html = withAdminBack(html);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }
  /* ------------- 剩余六项能力：开关 / 遥测 / 儿童时段 / 接力 / 选源 / 聚合搜索 ------------- */
  if (u.pathname === '/api/features/flags' && req.method === 'GET') {
    send(res, 200, Object.assign({ ok: true }, extras.features.all()));
    return;
  }
  if (u.pathname === '/api/features/flags' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 403, { ok: false, error: '仅开发端可改功能开关' }); return; }
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      if (p && p.flags && typeof p.flags === 'object') {
        Object.keys(p.flags).forEach((k) => extras.features.set(k, p.flags[k]));
        send(res, 200, { ok: true, flags: extras.features.all() });
        return;
      }
      send(res, 200, extras.features.set(p.id, p.enabled === undefined ? null : p.enabled));
    });
    return;
  }
  if (u.pathname === '/api/telemetry/update' && req.method === 'POST') {
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      send(res, 200, extras.telemetry.append(p));
    });
    return;
  }
  if (u.pathname === '/api/telemetry/update' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    send(res, 200, extras.telemetry.summary());
    return;
  }
  /* AI 辅助诊断（#98，仅开发端）：服务端代理调用兼容 OpenAI 协议的模型，只回建议文本；
     密钥不下发前端。未配置 KH_AI_BASE_URL / KH_AI_API_KEY / KH_AI_MODEL 时如实返回 not-configured。 */
  if (u.pathname === '/api/ai/diagnose' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    send(res, 200, { ok: true, configured: aiAdvisor.isConfigured() });
    return;
  }
  if (u.pathname === '/api/ai/diagnose' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let health = null;
    try { const s = healthMonitor.snapshot(); health = { healthy: s.healthy, diskFreeMB: s.diskFreeMB, memUsedPct: s.mem && s.mem.usedPct, alerts: (s.alerts || []).length }; } catch (e) {}
    const ctx = {
      stats: typeof stats === 'function' ? stats() : null,
      reports: reports.slice(-10).map((r) => ({ version: r.version, device: r.device, at: r.receivedAt, issues: (r.issues || []).slice(0, 10) })),
      health
    };
    aiAdvisor.diagnose(ctx).then((out) => send(res, 200, Object.assign({ ok: !!out.ok }, out)));
    return;
  }
  /* AI 结构化分析（#111）：自动提取问题 / 根因 / 处理动作 / 建议补丁片段 / 新功能建议；
     仅开发端，未配 Key 返回 not-configured；补丁为建议，需人工审核后应用。 */
  if (u.pathname === '/api/ai/analyze' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let health = null;
    try { const s = healthMonitor.snapshot(); health = { healthy: s.healthy, diskFreeMB: s.diskFreeMB, memUsedPct: s.mem && s.mem.usedPct, alerts: (s.alerts || []).length }; } catch (e) {}
    const ctx = {
      stats: typeof stats === 'function' ? stats() : null,
      reports: reports.slice(-10).map((r) => ({ version: r.version, device: r.device, at: r.receivedAt, issues: (r.issues || []).slice(0, 10) })),
      health
    };
    aiAdvisor.analyze(ctx).then((out) => send(res, 200, Object.assign({ ok: !!out.ok }, out)));
    return;
  }
  /* AI 翻译（#111）：文本 / 字幕翻译代理，复用同一模型通道；仅开发端，未配 Key 返回 not-configured。 */
  if (u.pathname === '/api/ai/translate' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      aiAdvisor.translate(p && p.text, p && p.targetLang).then((out) => send(res, 200, Object.assign({ ok: !!out.ok }, out)));
    });
    return;
  }
  /* ---------- 远端配置中心（#69 / #70 / #71 / #77 / #66）：客户端只读，开发端可写 ---------- */
  if (u.pathname === '/api/config/center' && req.method === 'GET') {
    const q = u.searchParams;
    send(res, 200, cfgCenter.view({ device: q.get('device') || '', version: q.get('ver') || '' }));
    return;
  }
  if (u.pathname === '/api/config/center' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 403, { ok: false, error: '仅开发端可改远端配置' }); return; }
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      const r = cfgCenter.patch(p || {});
      send(res, r.ok ? 200 : 500, r);
    });
    return;
  }
  if (u.pathname === '/api/config/schema' && req.method === 'GET') {
    send(res, 200, cfgCenter.schemaInfo());
    return;
  }
  if (u.pathname === '/api/sync/push' && req.method === 'POST') {
    const cfg = cfgCenter.get();
    if (cfg.sync && cfg.sync.enabled === false) { send(res, 403, { ok: false, error: '云同步已被关闭' }); return; }
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      const r = cfgCenter.syncPush(p.device, p.payload || p.settings || {});
      send(res, r.ok ? 200 : 400, r);
    });
    return;
  }
  if (u.pathname === '/api/sync/pull' && req.method === 'GET') {
    const cfg = cfgCenter.get();
    if (cfg.sync && cfg.sync.enabled === false) { send(res, 403, { ok: false, error: '云同步已被关闭' }); return; }
    send(res, 200, cfgCenter.syncPull(u.searchParams.get('device') || ''));
    return;
  }
  if (u.pathname === '/api/sync/peers' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    send(res, 200, cfgCenter.syncAll());
    return;
  }
  if (u.pathname === '/admin/config-center' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let html = '';
    try { html = fs.readFileSync(path.join(__dirname, 'config-center-admin.html'), 'utf8'); }
    catch (e) { send(res, 500, { ok: false, error: 'config-center-admin.html 缺失' }); return; }
    html = withAdminBack(html);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }
  /* ---------- 分享短链（1.7.94 · 清单 #65）：客户端发目标换短码，扫码走 /s/<code> ---------- */
  if (u.pathname === '/api/share' && req.method === 'POST') {
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      const r = shares.create(p && p.url, p && p.title);
      if (!r.ok) { send(res, 400, r); return; }
      const base = (p && typeof p.base === 'string' && /^https?:\/\//i.test(p.base)) ? p.base.replace(/\/+$/, '') : '';
      send(res, 200, Object.assign({ ok: true }, r, { short: base ? base + '/s/' + r.code : '/s/' + r.code }));
    });
    return;
  }
  if (u.pathname === '/api/share/info' && req.method === 'GET') {
    send(res, 200, Object.assign({ ok: true }, shares.info()));
    return;
  }
  if (u.pathname === '/api/share/list' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    send(res, 200, { ok: true, items: shares.list(u.searchParams.get('limit')) });
    return;
  }
  if (/^\/s\/[a-z0-9]{5,12}$/.test(u.pathname) && req.method === 'GET') {
    const hit = shares.resolve(u.pathname.slice(3));
    if (!hit) {
      cors(res);
      const html = '<!doctype html><meta charset="utf-8"><title>分享链接失效</title>' +
        '<div style="font-family:system-ui;padding:40px;color:#E8EDF7;background:#0B0D16">' +
        '<h2>分享链接不存在或已过期</h2><p style="color:#8F98B5">短链保留 180 天，过期后自动清理。</p></div>';
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    cors(res);
    if (hit.target[0] === '#') {
      /* 应用内路由：给出一个跳回应用的落地页，不自动跳外链 */
      const html = '<!doctype html><meta charset="utf-8"><title>' + escapeHtml(hit.title || '鸿汇影分享') + '</title>' +
        '<div style="font-family:system-ui;padding:40px;color:#E8EDF7;background:#0B0D16">' +
        '<h2>' + escapeHtml(hit.title || '鸿汇影分享') + '</h2><p style="color:#8F98B5">这是应用内分享，请在鸿汇影客户端里打开。</p></div>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    res.writeHead(302, { Location: hit.target, 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  if (u.pathname === '/api/config/kid' && req.method === 'GET') {
    send(res, 200, Object.assign({ ok: true, config: extras.kid.get() }, extras.kid.stateAt()));
    return;
  }
  if (u.pathname === '/api/config/kid' && req.method === 'POST') {
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      const r = extras.kid.set(p || {});
      send(res, r.ok ? 200 : 500, r);
    });
    return;
  }

  /* ---- 接口来源白名单（写操作仅开发端） ---- */
  if (u.pathname === '/api/config/origins' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    send(res, 200, opsConfig.origins.list());
    return;
  }
  if (u.pathname === '/api/config/origins/add' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      const r = opsConfig.origins.add(p.origin || p.host || '');
      send(res, r.ok ? 200 : 400, r);
    });
    return;
  }
  if (u.pathname === '/api/config/origins/remove' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      send(res, 200, opsConfig.origins.remove(p.origin || p.host || ''));
    });
    return;
  }

  /* ---- 首页推荐位：客户端只读，写操作仅开发端 ---- */
  if (u.pathname === '/api/promo' && req.method === 'GET') {
    send(res, 200, opsConfig.promo.get());
    return;
  }
  if (u.pathname === '/api/promo' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      const r = opsConfig.promo.set(p || {});
      send(res, r.ok ? 200 : 500, r);
    });
    return;
  }

  /* ---- 1.7.95 设备码账号 / 云同步 / 手机遥控（P1-01/02/03 · P2-B09/B10）
     口径：设备码就是账号本身（8 位，无密码、无找回）；只收收藏/历史/片单/续播点，
     不收链接与路径；遥控指令只进内存队列、20 秒过期。 */
  if (u.pathname === '/api/account/create' && req.method === 'POST') {
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      const r = accountSync.create(p && p.code);
      send(res, r.ok ? 200 : 500, r);
    });
    return;
  }
  if (u.pathname === '/api/account/data' && req.method === 'GET') {
    const r = accountSync.get(u.searchParams.get('code') || '');
    if (!r) { send(res, 404, { ok: false, error: '没有这枚设备码' }); return; }
    send(res, 200, { ok: true, account: r });
    return;
  }
  if (u.pathname === '/api/account/sync' && req.method === 'POST') {
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      if (!p || !p.code) { send(res, 400, { ok: false, error: '缺设备码' }); return; }
      const r = accountSync.sync(p.code, p.profile, p.nick);
      send(res, r.ok ? 200 : (r.missing ? 404 : 400), r);
    });
    return;
  }
  if (u.pathname === '/api/account/rename' && req.method === 'POST') {
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      const r = accountSync.rename(p && p.code, p && p.nick);
      send(res, r.ok ? 200 : 400, r);
    });
    return;
  }
  if (u.pathname === '/api/account/stats' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    send(res, 200, { ok: true, stats: accountSync.stats(), queues: accountSync.queueStats() });
    return;
  }
  if (u.pathname === '/api/remote/cmd' && req.method === 'POST') {
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      const r = accountSync.pushCmd(p && p.code, p && p.cmd);
      send(res, r.ok ? 200 : 400, r);
    });
    return;
  }
  if (u.pathname === '/api/remote/poll' && req.method === 'GET') {
    const r = accountSync.pollCmd(u.searchParams.get('code') || '', u.searchParams.get('since') || 0);
    send(res, r.ok ? 200 : 400, r);
    return;
  }
  if (u.pathname === '/remote' && req.method === 'GET') {
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const host = String(req.headers.host || ('127.0.0.1:' + (PORT || 8787)));
    const base = proto + '://' + host;
    const html = accountSync.remotePage(base, u.searchParams.get('code') || '');
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }

  /* ---- 更新通道：客户端只读当前通道，写操作仅开发端 ---- */
  if (u.pathname === '/api/channel' && req.method === 'GET') {
    send(res, 200, opsConfig.channel.get());
    return;
  }
  if (u.pathname === '/api/channel' && req.method === 'POST') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      const r = opsConfig.channel.set(p || {});
      send(res, r.ok ? 200 : 500, r);
    });
    return;
  }

  /* ---- 追剧订阅（本机维度，客户端自用；不接账号、不跨端） ---- */
  if (u.pathname === '/api/watchlist' && req.method === 'GET') {
    send(res, 200, watchlist.list(u.searchParams.get('deviceId') || ''));
    return;
  }
  if (u.pathname === '/api/watchlist/add' && req.method === 'POST') {
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      const r = watchlist.add(p.deviceId || '', p || {});
      send(res, r.ok ? 200 : 400, r);
    });
    return;
  }
  if (u.pathname === '/api/watchlist/remove' && req.method === 'POST') {
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      send(res, 200, watchlist.remove(p.deviceId || '', p.id || ''));
    });
    return;
  }
  if (u.pathname === '/api/watchlist/read' && req.method === 'POST') {
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      send(res, 200, watchlist.markRead(p.deviceId || '', p.id || ''));
    });
    return;
  }
  if (u.pathname === '/api/watchlist/check' && req.method === 'POST') {
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      send(res, 200, watchlist.check(p.deviceId || '', p.current || []));
    });
    return;
  }

  if (u.pathname === '/api/handoff' && req.method === 'POST') {
    readBody(req, (body) => {
      let p; try { p = JSON.parse(body || '{}'); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      send(res, 200, extras.handoff.put(p.payload || p));
    });
    return;
  }
  if (u.pathname === '/api/handoff/get' && req.method === 'GET') {
    send(res, 200, extras.handoff.take(u.searchParams.get('code')));
    return;
  }
  if (u.pathname === '/api/stats/source-rank' && req.method === 'GET') {
    try { send(res, 200, extras.score.rank(Number(u.searchParams.get('limit') || 40))); }
    catch (e) { send(res, 500, { ok: false, error: '选源评分失败：' + (e && e.message) }); }
    return;
  }
  if (u.pathname === '/api/search' && req.method === 'GET') {
    try { send(res, 200, extras.search.run(u.searchParams.get('q'), Number(u.searchParams.get('limit') || 50))); }
    catch (e) { send(res, 500, { ok: false, error: '搜索失败：' + (e && e.message) }); }
    return;
  }
  if (u.pathname === '/admin/extras' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let html = '';
    try { html = fs.readFileSync(path.join(__dirname, 'extras-admin.html'), 'utf8'); }
    catch (e) { send(res, 500, { ok: false, error: 'extras-admin.html 缺失' }); return; }
    html = withAdminBack(html);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }

  if (u.pathname === '/api/sites' && req.method === 'POST') {
    readBody(req, (body) => {
      if (!body) { send(res, 413, { ok: false, error: 'empty or oversized body' }); return; }
      let p; try { p = JSON.parse(body); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      const input = Array.isArray(p) ? p : (Array.isArray(p.sites) ? p.sites : (p.text ? String(p.text).split(/[\r\n,]+/).filter(Boolean) : [p]));
      send(res, 200, catalog.addSites(input));
    });
    return;
  }
  if (u.pathname === '/api/sites/remove' && req.method === 'POST') {
    readBody(req, (body) => {
      if (!body) { send(res, 413, { ok: false, error: 'empty or oversized body' }); return; }
      let p; try { p = JSON.parse(body); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      send(res, 200, catalog.removeSite(p.id || p.name || p.url));
    });
    return;
  }
  if (u.pathname === '/api/sites/update' && req.method === 'POST') {
    readBody(req, (body) => {
      if (!body) { send(res, 413, { ok: false, error: 'empty or oversized body' }); return; }
      let p; try { p = JSON.parse(body); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      send(res, 200, catalog.updateSite(p.id || p.name || p.url, p.patch || p));
    });
    return;
  }
  if (u.pathname === '/api/features/presets' && req.method === 'GET') { send(res, 200, { ok: true, presets: readPresets() }); return; }
  // 功能模板：一类工作流的开箱模板（发布校验 / 回滚 / 审计 / 趋势 / 灰度 / 冒烟），一键加进功能清单
  if (u.pathname === '/api/features/templates' && req.method === 'GET') {
    let tpl = [];
    try { tpl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'features', 'templates.json'), 'utf8')); } catch (e) { tpl = []; }
    send(res, 200, { ok: true, templates: Array.isArray(tpl) ? tpl : [], note: '模板可直接用于 /api/features 的 add / import' });
    return;
  }
  // 功能随发版同步：一次返回版本、快照与完整功能清单，两端可据此判断功能是否有更新
  if (u.pathname === '/api/features/sync' && req.method === 'GET') {
    const m = readManifest();
    send(res, 200, { ok: true, version: featureStamp(), features: readFeatures(), release: (m && m.release && m.release.latest) || null,
      pageHash: currentPageHash(), buildStamp: buildStamp() });
    return;
  }
  if (u.pathname === '/api/page/sync' && req.method === 'GET') {
    const a = activePage();
    send(res, 200, { ok: true, source: a.source, pageHash: a.buf.length ? pageHashOf(a.buf) : null,
      size: a.buf.length, buildStamp: buildStamp(), note: '公网页面优先；刷新应用即生效，无需卸载重装' });
    return;
  }
  // 反馈建议 → 自动提取新功能 → 自动添加（服务启动与自治循环都会自动跑，此接口只是可选的立即触发）
  if (u.pathname === '/api/features/mine' && req.method === 'POST') {
    if (FIX_TOKEN && req.headers['x-kh-fix-token'] !== FIX_TOKEN) { send(res, 401, { ok: false, error: 'invalid fix token' }); return; }
    let out;
    try { out = miner.run(); } catch (e) { out = { ok: false, error: String(e && e.message || e), added: [] }; }
    send(res, out.ok ? 200 : 500, { ok: out.ok, result: out, features: featureStamp() });
    return;
  }
  // 自动批量下发清单：一次给出全部架构产物、HAP 与校验值，供多端批量取包
  if (u.pathname === '/api/batch' && req.method === 'GET') {
    const b = batchManifest();
    send(res, 200, { ok: true, batch: b, delivery: deliveryManifest(), auto: true, noReview: true });
    return;
  }
  // 下发成品清单（所有包不限设备 / 不限内存）：三条通道 + 内存档 + 自动更新策略
  if (u.pathname === '/api/delivery' && req.method === 'GET') {
    send(res, 200, { ok: true, delivery: deliveryManifest(), auto: true, noReview: true });
    return;
  }
  // 单台设备自动选路 + 自动更新比对：客户端带 arch / mem / os / code，服务端直接给可用成品
  if (u.pathname === '/api/delivery/plan' && req.method === 'GET') {
    const q = {};
    u.searchParams.forEach((v, k) => { q[k] = v; });
    q.archs = batchManifest();
    const p = delivery.plan(q);
    // 灰度分批：同一匿名设备 ID 稳定落同一组；暂停放量时不提示升级，避免把问题版本推给全量设备
    try {
      p.rollout = devops.resolveGroup(q.deviceId || q.device);
      if (p.rollout && p.rollout.paused && p.update) {
        p.update.needUpdate = false;
        p.update.note = '灰度已暂停放量：' + (p.rollout.pausedReason || '等待人工恢复') + '；内容仍自动同步';
      }
    } catch (e) { p.rollout = null; }
    // 附带该设备的 OS 版本适配与自动优化结果（跟随所有操作系统版本）
    try {
      p.osProfile = deviceOptimizer.forDevice(q);
      p.optimization = {
        auto: true, noReview: true, verified: true,
        endpoint: '/api/device/report', syncEndpoint: '/api/device/optimization',
        note: '检测 OS 版本 → 回传 → 自动优化 → 自动修复 → 自动下发同步更新'
      };
    } catch (e) { p.osProfile = null; }
    send(res, 200, p);
    return;
  }
  // OS 版本检测回传 → 自动优化 → 自动修复 → 下发同步更新（零人工复核）
  if (u.pathname === '/api/device/report' && req.method === 'POST') {
    const ip = (req.socket && req.socket.remoteAddress) || '';
    if (limited(ip)) { send(res, 429, { ok: false, error: 'rate limited' }); return; }
    readBody(req, (body) => {
      if (!body) { send(res, 413, { ok: false, error: 'empty or oversized body' }); return; }
      let r; try { r = JSON.parse(body); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      if (!r || typeof r !== 'object') { send(res, 400, { ok: false, error: 'bad payload' }); return; }
      const stored = deviceOptimizer.appendReport(r);
      try { devops.deviceMetric(r.family || r.platform || r.os || r.osFullName || 'unknown'); } catch (e) {}
      let opt = null;
      try { opt = deviceOptimizer.run(); } catch (e) { opt = { ok: false, error: String(e && e.message || e), summary: null }; }
      const single = deviceOptimizer.forDevice(Object.assign({}, r, { ua: r.ua || r.userAgent, os: r.os || r.osFullName }));
      send(res, 200, {
        ok: true, mode: 'auto-no-review', stored: stored, auto: true, noReview: true, verified: true,
        optimization: single, summary: opt && opt.summary || null,
        features: featureStamp(),
        note: 'OS 版本已检测并回传，自动优化与修复完成；结果随 /api/delivery/plan 与 /api/features/sync 下发同步更新'
      });
    });
    return;
  }
  if (u.pathname === '/api/device/optimization' && req.method === 'GET') {
    send(res, 200, { ok: true, optimization: deviceOptimizer.latest(), osProfiles: deviceOptimizer.osProfiles(), auto: true, noReview: true });
    return;
  }
  if (u.pathname === '/api/devices' && req.method === 'GET') {
    const l = deviceOptimizer.latest() || {};
    send(res, 200, { ok: true, devices: l.profiles || {}, summary: l.summary || null, followAllOSVersions: true, auto: true });
    return;
  }
  // 看板聚合：自动提取新功能 / 自动修 Bug / 批量下发 / 下发成品 / 功能快照
  if (u.pathname === '/api/flow' && req.method === 'GET') {
    let mining = null, bug = null;
    try { const h = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mined_features.json'), 'utf8')); if (Array.isArray(h)) mining = h[h.length - 1] || null; } catch (e) {}
    try { bug = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'latest_bugfix.json'), 'utf8')); } catch (e) {}
    send(res, 200, { ok: true, mining: mining, batch: batchManifest(), delivery: deliveryManifest(),
      deviceOptimization: deviceOptimizer.latest(), bugfix: bug, features: featureStamp() });
    return;
  }

  if (u.pathname === '/api/features' && req.method === 'POST') {
    if (FIX_TOKEN && req.headers['x-kh-fix-token'] !== FIX_TOKEN) { send(res, 401, { ok: false, error: 'invalid fix token' }); return; }
    readBody(req, (body) => {
      if (!body) { send(res, 413, { ok: false, error: 'empty or oversized body' }); return; }
      let p; try { p = JSON.parse(body); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      const op = p.op || 'add';
      let list = readFeatures();
      try {
        if (op === 'add') {
          const f = normalizeFeature(p.feature);
          if (!f) { send(res, 400, { ok: false, error: 'feature 字段缺失' }); return; }
          if (list.some((x) => x.id === f.id)) { send(res, 409, { ok: false, error: 'id 已存在：' + f.id }); return; }
          list.push(f);
        } else if (op === 'update') {
          const f = normalizeFeature(p.feature); const id = p.id || (f && f.id);
          const i = list.findIndex((x) => x.id === id);
          if (i < 0) { send(res, 404, { ok: false, error: '功能不存在：' + id }); return; }
          list[i] = Object.assign({}, list[i], f, { id: id });
        } else if (op === 'remove') {
          const i = list.findIndex((x) => x.id === p.id);
          if (i < 0) { send(res, 404, { ok: false, error: '功能不存在：' + p.id }); return; }
          list.splice(i, 1);
        } else if (op === 'toggle') {
          const i = list.findIndex((x) => x.id === p.id);
          if (i < 0) { send(res, 404, { ok: false, error: '功能不存在：' + p.id }); return; }
          list[i].enabled = !(list[i].enabled === true);
        } else if (op === 'import') {
          if (!Array.isArray(p.features)) { send(res, 400, { ok: false, error: 'features 需为数组' }); return; }
          const arr = p.features.map(normalizeFeature).filter(Boolean);
          const map = {}; list.forEach((x) => { map[x.id] = x; });
          arr.forEach((x) => { map[x.id] = map[x.id] ? Object.assign({}, map[x.id], x) : x; });
          list = Object.keys(map).map((k) => map[k]);
        } else { send(res, 400, { ok: false, error: '未知 op：' + op }); return; }
        if (!writeFeatures(list)) { send(res, 500, { ok: false, error: '写入功能清单失败（磁盘只读？）' }); return; }
        devops.audit('features.' + op, { target: clip(p.id || (p.feature && p.feature.id) || '', 80), detail: '共 ' + list.length + ' 项' });
        send(res, 200, { ok: true, count: list.length, features: list });
      } catch (e) { send(res, 500, { ok: false, error: String(e && e.message || e) }); }
    });
    return;
  }

  if (u.pathname === '/api/feature/run' && req.method === 'POST') {
    if (FIX_TOKEN && req.headers['x-kh-fix-token'] !== FIX_TOKEN) { send(res, 401, { ok: false, error: 'invalid fix token' }); return; }
    readBody(req, (body) => {
      if (!body) { send(res, 413, { ok: false, error: 'empty or oversized body' }); return; }
      let p; try { p = JSON.parse(body); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      const feats = readFeatures();
      const f = feats.find((x) => x.id === String(p.id || ''));
      if (!f) { send(res, 404, { ok: false, error: '功能不存在' }); return; }
      if (f.enabled === false) { send(res, 400, { ok: false, error: '功能已停用' }); return; }
      const a = f.action || 'open';
      if (a === 'open') { send(res, 200, { ok: true, action: 'open', url: f.url }); return; }
      if (a.indexOf('builtin:') === 0) { send(res, 200, { ok: true, action: 'builtin', name: a }); return; }
      if (a === 'script') {
        const cmd = f.cmd || '';
        if (!cmd) { send(res, 400, { ok: false, error: '未配置命令' }); return; }
        let out = '', err = '', done = false;
        const child = spawn(cmd, { shell: true, cwd: process.cwd() });
        const timer = setTimeout(() => { try { child.kill(); } catch (e) {} finish({ ok: false, error: '命令超时（>60s）' }); }, 60000);
        const finish = (r) => { if (done) return; done = true; try { clearTimeout(timer); } catch (e) {} devops.audit('feature.run', { target: f.id, result: r.ok ? 'ok' : 'fail', detail: 'script / 退出码 ' + r.code }); send(res, r.ok ? 200 : 500, r); };
        if (child.stdout) child.stdout.on('data', (d) => { out += d.toString(); });
        if (child.stderr) child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('error', (e) => finish({ ok: false, error: '启动失败：' + (e && e.message || e) }));
        child.on('close', (code) => finish({ ok: code === 0, code: code, stdout: out.slice(0, 4000), stderr: err.slice(0, 2000) }));
        return;
      }
      if (a === 'webhook') {
        const url = f.url || '';
        if (!url) { send(res, 400, { ok: false, error: '未配置接口地址' }); return; }
        let uu; try { uu = new URL(url); } catch (e) { send(res, 400, { ok: false, error: '接口地址非法' }); return; }
        const payload = f.payload ? JSON.stringify(f.payload) : '{}';
        const lib = uu.protocol === 'https:' ? require('https') : require('http');
        const req2 = lib.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (resp) => {
          let d = ''; resp.on('data', (c) => { d += c.toString(); });
          resp.on('end', () => { devops.audit('feature.run', { target: f.id, result: resp.statusCode < 400 ? 'ok' : 'fail', detail: 'webhook HTTP ' + resp.statusCode }); send(res, 200, { ok: true, status: resp.statusCode, body: d.slice(0, 2000) }); });
        });
        req2.on('error', (e) => send(res, 500, { ok: false, error: '请求失败：' + (e && e.message || e) }));
        req2.write(payload); req2.end();
        return;
      }
      send(res, 400, { ok: false, error: '未知动作：' + a });
    });
    return;
  }

  if (u.pathname === '/api/reports' && req.method === 'GET') {
    const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') || 60)));
    send(res, 200, { ok: true, stats: stats(), reports: reports.slice(-limit).reverse() });
    return;
  }

  if (u.pathname === '/api/report' && req.method === 'POST') {
    const ip = (req.socket && req.socket.remoteAddress) || '';
    if (limited(ip)) { send(res, 429, { ok: false, error: 'rate limited' }); return; }
    if (REPORT_TOKEN && req.headers['x-kh-token'] !== REPORT_TOKEN) { send(res, 401, { ok: false, error: 'invalid token' }); return; }
    readBody(req, (body) => {
      if (!body) { send(res, 413, { ok: false, error: 'empty or oversized body' }); return; }
      let r; try { r = JSON.parse(body); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      if (!r || r.schema !== 1 || r.app !== 'HongHubMovie' || !Array.isArray(r.issues)) { send(res, 400, { ok: false, error: 'bad payload' }); return; }
      const rec = cleanReport(r);
      if (reports.some((x) => x.id === rec.id)) { send(res, 200, { ok: true, duplicate: true, id: rec.id }); return; }
      reports.push(rec);
      if (reports.length > MAX_KEEP) reports.splice(0, reports.length - MAX_KEEP);
      if (writable) fs.appendFile(reportsFileFor(rec.receivedAt), JSON.stringify(rec) + '\n', (e) => { if (e) writable = false; });
      pruneReportsFiles();
      /* 上报即入告警中心：同一指纹跨设备超阈值（设备≥30 或次数≥500）时，Webhook 才会真的响 */
      try {
        const as = (stats().alerts || []);
        if (as.length) require('./alerts-center').push(as.map((a) => ({
          level: a.level, code: a.code, detail: a.detail, lastAt: a.lastSeen, source: 'report'
        })));
      } catch (e) {}
      send(res, 200, { ok: true, id: rec.id, stored: reports.length });
    });
    return;
  }

  if (u.pathname === '/api/fix' && req.method === 'POST') {
    if (FIX_TOKEN && req.headers['x-kh-fix-token'] !== FIX_TOKEN) { send(res, 401, { ok: false, error: 'invalid fix token' }); return; }
    const t0 = Date.now();
    runFix((out) => {
      out.elapsedMs = Date.now() - t0;
      devops.audit('selfheal.run', { result: out.ok ? 'ok' : 'fail', detail: out.ok ? ('源清单 v' + out.v + ' / 通道 ' + out.channels) : String(out.error || '') });
      if (out.ok && out.v) { try { devops.snapshotSources(readManifest()); } catch (e) {} }
      send(res, out.ok ? 200 : 500, out);
    });
    return;
  }

  if (u.pathname === '/api/update-publish' && req.method === 'POST') {
    if (FIX_TOKEN && req.headers['x-kh-fix-token'] !== FIX_TOKEN) { send(res, 401, { ok: false, error: 'invalid fix token' }); return; }
    const t0 = Date.now();
    updatePublish((out) => {
      out.elapsedMs = Date.now() - t0;
      devops.audit('update.publish', { result: out.ok ? 'ok' : 'fail', detail: out.ok ? ('v' + out.publish.versionName + ' / #' + out.publish.versionCode + ' / 源清单 v' + (out.update && out.update.v)) : String(out.error || '') });
      send(res, out.ok ? 200 : 500, out);
      /* 开发端专用：发布成功后把本机回装成新版（KH_AUTO_REINSTALL=1 才启用）。
         客户端不带这个开关，发布→自装闭环只在开发机上跑。 */
      if (out.ok && DEV_MODE && String(process.env.KH_AUTO_REINSTALL || '0') === '1') {
        const fp = resolveDownload('desktop-setup.exe');
        if (fp) {
          try {
            const child = spawn(fp, [], { detached: true, stdio: 'ignore' });
            child.on('error', (e) => console.error('[更新] 发布后自动回装失败', e && e.message));
            child.unref();
            console.log('[更新] 发布成功，已拉起本机回装：' + path.basename(fp));
          } catch (e) { console.error('[更新] 发布后自动回装异常', e && e.message); }
        } else {
          console.warn('[更新] 发布成功，但本机没有安装包，跳过回装（先 npm run pack）');
        }
      }
    });
    return;
  }

  // 自动更新落地：本地没有安装包时先从镜像站下载，校验通过再拉起安装向导
  // （非静默，仍需用户在向导里确认覆盖安装）
  if (u.pathname === '/api/update/install' && req.method === 'POST') {
    const ip = (req.socket && req.socket.remoteAddress) || '';
    if (!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ip)) {
      send(res, 403, { ok: false, error: '仅允许本机触发安装（安全限制）' });
      return;
    }
    readBody(req, (body) => {
      let p = {}; try { p = JSON.parse(body || '{}'); } catch (e) {}
      /* 指定版本 = 回滚安装：从归档取该版本成品，SHA256 校验后启动覆盖安装向导。
         归档文件在本机就直接用；不在本机但有下载地址则先下载再校验。 */
      const wantVer = String(p.version || '').trim();
      if (wantVer) {
        const idx = readReleaseIndex();
        const hit = (idx.versions || []).find(v => v.versionName === wantVer);
        if (!hit) {
          send(res, 404, { ok: false, error: '未找到该版本的归档产物（先 npm run archive）',
            available: (idx.versions || []).map(v => v.versionName) });
          return;
        }
        const d = hit.artifacts && hit.artifacts.desktop;
        const fp = archiveDesktopPath(hit);
        const extra = { source: 'archive', desktopSha256: (d && d.sha256) || null,
          desktopSize: (d && d.size) || 0, versionName: hit.versionName, versionCode: hit.versionCode || null,
          silent: !!p.silent };
        if (fp) { launchSetup(fp, res, extra); return; }
        if (hit.downloadUrl && /^https?:\/\//i.test(hit.downloadUrl)) {
          const dest = path.join(UPDATES_DIR, 'desktop-setup-' + wantVer.replace(/[^\w.\-]/g, '') + '.exe');
          console.log('[更新] 回滚：归档不在本机，下载 ' + hit.downloadUrl);
          downloadToFile(hit.downloadUrl, dest, (err) => {
            if (err) { send(res, 502, { ok: false, error: '下载归档包失败：' + (err.message || err) }); return; }
            extra.source = 'archive-download';
            launchSetup(dest, res, extra);
          });
          return;
        }
        send(res, 404, { ok: false, error: '该版本归档文件缺失，且清单里没有可用下载地址' });
        return;
      }
      const local = (String(process.env.KH_UPDATE_FORCE_REMOTE || '0') === '1') ? null : resolveDownload('desktop-setup.exe');
      if (local) {
        let localSha = null;
        try {
          const sf = local + '.sha256';
          if (fs.existsSync(sf)) localSha = String(fs.readFileSync(sf, 'utf8')).trim().split(/\s+/)[0] || null;
        } catch (e) { /* 无校验文件则按体积闸 */ }
        launchSetup(local, res, { source: 'local', desktopSha256: localSha, silent: !!p.silent });
        return;
      }
      if (String(process.env.KH_UPDATE_ALLOW_DOWNLOAD || '1') === '0') {
        send(res, 404, { ok: false, error: '本机没有安装包，且已禁用联网下载（KH_UPDATE_ALLOW_DOWNLOAD=0）' });
        return;
      }
      const man = manifestForInstall();
      const cands = installCandidates(man);
      if (!cands.length) {
        send(res, 404, { ok: false, error: '本机没有安装包，公网清单也没有可用的下载地址（未配置镜像站？可先从下载页手动更新：' + MANUAL_DOWNLOAD_PAGE + '）' });
        return;
      }
      console.log('[更新] 本机无安装包，按 ' + cands.length + ' 个候选源依次尝试，首个：' + cands[0].url);
      updateSources.tryDownloadAll(cands, {
        dir: UPDATES_DIR,
        download: (u2, dest, cb2) => downloadToFile(u2, dest, cb2)
      }, (err, hit) => {
        if (err) {
          console.error('[更新] 全部源失败：' + err.message + ' / ' + (err.attempts || []).map(a => a.label + ':' + a.error).join(' | '));
          send(res, 502, {
            ok: false,
            error: '所有更新源都没拿到可用安装包（已试 ' + cands.length + ' 个源，可先从下载页手动更新：' + MANUAL_DOWNLOAD_PAGE + '）',
            attempts: err.attempts || [],
            candidates: cands.map(c => ({ label: c.label, url: c.url }))
          });
          return;
        }
        console.log('[更新] 下载完成 ' + hit.size + ' B，来源 ' + hit.from
          + (hit.attempts.length ? '（前 ' + hit.attempts.length + ' 个源失败）' : ''));
        launchSetup(hit.file, res, Object.assign({}, man || {}, {
          source: 'download:' + hit.from,
          desktopSha256: hit.sha256,          // 以实际落盘内容为准，清单缺失也能校验
          desktopSize: hit.size,
          attempts: hit.attempts,
          downloadFrom: hit.from,
          silent: !!p.silent
        }));
      });
    });
    return;
  }

  /* 安装包下载进度（#115）：只读，供前端轮询展示百分比；不回传片源内容与身份信息。 */
  if (u.pathname === '/api/update/progress' && req.method === 'GET') {
    const p = updateProgress;
    const percent = (p.total > 0 && p.received > 0) ? Math.min(99, Math.round(p.received / p.total * 100)) : 0;
    send(res, 200, { ok: true, state: p.state, received: p.received, total: p.total, percent, at: p.at });
    return;
  }

  if (u.pathname === '/api/automation' && req.method === 'GET') {
    const last = autoRuns.length ? autoRuns[autoRuns.length - 1] : null;
    send(res, 200, {
      ok: true, enabled: AUTO_RUN_ENABLED, mode: AUTO_GOVERN ? 'govern' : 'update',
      intervalHours: AUTO_RUN_HOUR === null ? (AUTO_RUN_INTERVAL_MS / 3600000) : null,
      hour: AUTO_RUN_HOUR, nextRunAt: nextRunAt,
      lastRun: last ? { startedAt: last.startedAt, finishedAt: last.finishedAt, ok: last.ok, result: last.result } : null,
      recent: autoRuns.slice(-12).reverse()
    });
    return;
  }

  if (u.pathname === '/api/automation/run' && req.method === 'POST') {
    if (FIX_TOKEN && req.headers['x-kh-fix-token'] !== FIX_TOKEN) { send(res, 401, { ok: false, error: 'invalid fix token' }); return; }
    doAutoRun((rec) => {
      devops.audit('automation.run', { result: rec.ok ? 'ok' : 'fail', detail: '耗时 ' + Math.round((rec.finishedAt - rec.startedAt) / 1000) + 's' });
      send(res, rec.ok ? 200 : 500, { ok: rec.ok, startedAt: rec.startedAt, finishedAt: rec.finishedAt, result: rec.result });
    });
    return;
  }

  if (u.pathname === '/api/govern' && req.method === 'GET') {
    const last = governRuns.length ? governRuns[governRuns.length - 1] : null;
    let latest = null;
    try { if (fs.existsSync(LATEST_GOVERN_FILE)) latest = JSON.parse(fs.readFileSync(LATEST_GOVERN_FILE, 'utf8')); } catch (e) {}
    send(res, 200, {
      ok: true, enabled: AUTO_GOVERN,
      recent: governRuns.slice(-12).reverse(),
      lastRun: last ? { startedAt: last.startedAt, finishedAt: last.finishedAt, ok: last.ok, result: last.result } : null,
      finalProducts: latest,                                  // 接收所有最终成品：最近一次治理全部产出
      bugfix: latest ? (latest.bugfix || null) : null,        // 其中「自动修 Bug」一轮的完整结果
      suggestions: latest ? latest.suggestions : extractSuggestions(extractProblems()),
      feedback: feedbacks.slice(-12).reverse()               // 自动反馈通道（含深开鸿端回传）
    });
    return;
  }
  if (u.pathname === '/api/govern/run' && req.method === 'POST') {
    if (FIX_TOKEN && req.headers['x-kh-fix-token'] !== FIX_TOKEN) { send(res, 401, { ok: false, error: 'invalid fix token' }); return; }
    runGovernance((rec) => {
      const r = rec.result || {};
      devops.audit('govern.run', { result: rec.ok ? 'ok' : 'fail', detail: '问题 ' + (r.problemsFound || 0) + ' / 优化剔除 ' + ((r.optimized && r.optimized.removed) || 0) + ' / 发布 ' + ((r.published && r.published.versionName) || '-') });
      try { devops.snapshotSources(readManifest()); } catch (e) {}
      try { devops.evaluateRollout(devops.trend(1, { top: stats().top }).totals); } catch (e) {}
      send(res, rec.ok ? 200 : 500, { ok: rec.ok, startedAt: rec.startedAt, finishedAt: rec.finishedAt, result: rec.result });
    });
    return;
  }

  // 自动修 Bug：查看最近一轮结果 / 立即体检（服务启动与定时巡检全自动运行，无需人工复核）
  if (u.pathname === '/api/bugfix' && req.method === 'GET') {
    let last = null;
    try { if (fs.existsSync(path.join(DATA_DIR, 'latest_bugfix.json'))) last = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'latest_bugfix.json'), 'utf8')); } catch (e) {}
    send(res, 200, { ok: true, lastRun: last });
    return;
  }
  if (u.pathname === '/api/bugfix/run' && req.method === 'POST') {
    if (FIX_TOKEN && req.headers['x-kh-fix-token'] !== FIX_TOKEN) { send(res, 401, { ok: false, error: 'invalid fix token' }); return; }
    let out;
    try { out = bugfix.run(); } catch (e) { out = { ok: false, error: String(e && e.message || e), summary: { total: 0, fixed: 0, manual: 0, autoHandled: 0, unresolved: 1, verified: false, rounds: 0 } }; }
    devops.audit('bugfix.run', { result: out.ok ? 'ok' : 'fail', detail: '处置 ' + ((out.summary && out.summary.autoHandled) || 0) + ' / 人工 ' + ((out.summary && out.summary.manual) || 0) });
    send(res, out.ok ? 200 : 500, { ok: out.ok, startedAt: out.startedAt, finishedAt: out.finishedAt, result: out });
    return;
  }

  /* AI 自动修 Bug（开发端）：GET 看状态与上一轮明细；POST 真跑一轮（模型出补丁 → 安全闸 → 校验/还原）。 */
  if (u.pathname === '/api/aibugfix' && req.method === 'GET') {
    let st = { configured: aiBugfix.isConfigured(), last: null };
    try { st = aiBugfix.status(); } catch (e) {}
    send(res, 200, Object.assign({ ok: true }, st));
    return;
  }
  if (u.pathname === '/api/aibugfix/run' && req.method === 'POST') {
    if (FIX_TOKEN && req.headers['x-kh-fix-token'] !== FIX_TOKEN) { send(res, 401, { ok: false, error: 'invalid fix token' }); return; }
    aiBugfix.run({}).then((out) => {
      devops.audit('aibugfix.run', {
        result: out.ok ? 'ok' : 'fail',
        detail: '修 ' + ((out.summary && out.summary.fixed) || 0) + ' / 失败 ' + ((out.summary && out.summary.failed) || 0) + (out.configured ? '' : '（未配置模型）')
      });
      send(res, (out.ok || !out.configured) ? 200 : 500, { ok: out.ok, result: out });
    }).catch((e) => {
      send(res, 500, { ok: false, error: String(e && e.message || e) });
    });
    return;
  }

  if (u.pathname === '/api/feedback' && req.method === 'GET') {
    send(res, 200, { ok: true, feedback: feedbacks.slice(-30).reverse(), finalProducts: (function () { try { return fs.existsSync(LATEST_GOVERN_FILE) ? JSON.parse(fs.readFileSync(LATEST_GOVERN_FILE, 'utf8')) : null; } catch (e) { return null; } })() });
    return;
  }
  if (u.pathname === '/api/feedback' && req.method === 'POST') {
    readBody(req, (body) => {
      if (!body) { send(res, 413, { ok: false, error: 'empty or oversized body' }); return; }
      let r; try { r = JSON.parse(body); } catch (e) { send(res, 400, { ok: false, error: 'bad json' }); return; }
      // 接收所有最终成品：深开鸿端回传其本机诊断/产物，中枢存为一条反馈并纳入治理
      const rec = autoFeedback(Object.assign({ type: 'device', device: clip(r.device, 140), at: Date.now() }, r.payload && typeof r.payload === 'object' ? r.payload : {}));
      send(res, 200, { ok: true, stored: feedbacks.length, id: rec ? (rec.at || Date.now()) : Date.now() });
    });
    return;
  }
  if (u.pathname.indexOf('/download/') === 0) {
    const isArchive = u.pathname.indexOf('/download/archive/') === 0;
    let file;
    try { file = decodeURIComponent(path.basename(u.pathname)); }
    catch (e) { file = path.basename(u.pathname); }
    // 自动按架构选包：?arch=arm64 / ia32 优先取原生包，缺包时自动落到 x64 通用包
    const arch = String(u.searchParams.get('arch') || '').toLowerCase();
    if (!isArchive && /^(x64|ia32|arm64)$/.test(arch) && arch !== 'x64' && /setup.*\.exe$/i.test(file)) {
      let v = ''; try { v = readManifest().release.latest.versionName || ''; } catch (e) {}
      const cands = ['desktop-setup-' + arch + '.exe']
        .concat(v ? ['鸿汇影桌面版 Setup ' + v + '-' + arch + '.exe'] : []);
      const D = path.join(__dirname, '..', 'dist');
      const hit = cands.find(n => { try { return fs.statSync(path.join(D, n)).isFile(); } catch (e) { return false; } });
      if (hit) file = hit;
    }
    const fp = isArchive ? (function(){
      /* 支持 /download/archive/v<版本>/<文件> 精确取历史归档（同名 desktop-setup.exe 在多版本目录里不歧义） */
      let rest = '';
      try { rest = decodeURIComponent(u.pathname.slice('/download/archive/'.length)); } catch (e) { rest = ''; }
      if (rest.indexOf('..') >= 0 || path.isAbsolute(rest) || rest.indexOf('开发端') >= 0) return null;
      if (/^v\d+\.\d+\.\d+\//.test(rest)) {
        const p = path.join(__dirname, '..', 'dist', '_archive_public_versions', rest);
        try { if (fs.statSync(p).isFile()) return p; } catch (e) {}
        return null;
      }
      return findArchive(file);
    })() : resolveDownload(file);
    if (!fp) { send(res, 404, { ok: false, error: '安装包未生成（请先 npm run pack，或把安装包放到桌面）' }); return; }
    // 流式下发 + Range 断点续传：不把 77MB 安装包整包读进内存（低内存机器也能取包）
    const st = fs.statSync(fp);
    const headers = { 'Content-Type': 'application/octet-stream',
      /* 中文文件名不能直接进 HTTP 头：ASCII 回退名 + RFC 5987 filename* */
      'Content-Disposition': 'attachment; filename="' + file.replace(/[^\x20-\x7E]/g, '_').replace(/["\r\n]/g, '') + '"; filename*=UTF-8\'\'' + encodeURIComponent(file),
      'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' };
    const rm = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (rm) {
      let start = rm[1] ? Number(rm[1]) : 0;
      let end = rm[2] ? Math.min(Number(rm[2]), st.size - 1) : st.size - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= st.size) {
        headers['Content-Range'] = 'bytes */' + st.size;
        res.writeHead(416, headers); res.end(); return;
      }
      headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + st.size;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      fs.createReadStream(fp, { start, end }).pipe(res);
      return;
    }
    headers['Content-Length'] = st.size;
    // HEAD 只用于验收探测，直接回响应头，不创建 77MB 读取流
    if (req.method === 'HEAD') { res.writeHead(200, headers); res.end(); return; }
    res.writeHead(200, headers);
    fs.createReadStream(fp).pipe(res);
    return;
  }

  /* 开发端自更新（1.7.83）：状态展示 + 触发检查。自更新模块在 electron 主进程里，
     server 不反向调用它，只读状态文件、写触发文件（模块 20 秒轮询一次）。 */
  if (u.pathname === '/admin/selfupdate' && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    let html = '';
    try { html = fs.readFileSync(path.join(__dirname, 'selfupdate-admin.html'), 'utf8'); }
    catch (e) { send(res, 500, { ok: false, error: 'selfupdate-admin.html 缺失' }); return; }
    html = withAdminBack(html);
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }
  if (u.pathname === '/api/dev/selfupdate' && DEV_MODE) {
    const dataDir = path.join(__dirname, 'data');
    const statusFile = path.join(dataDir, 'dev-auto-update-status.json');
    const logFile = path.join(dataDir, 'dev-auto-update.log');
    const triggerFile = path.join(dataDir, 'dev-update.trigger');
    if (req.method === 'GET') {
      let status = {};
      try { status = JSON.parse(fs.readFileSync(statusFile, 'utf8')); }
      catch (e) { status = { current: '', lastMsg: '自更新状态文件还没生成（首次检查在启动 45 秒后）', searched: [] }; }
      status.root = path.dirname(__dirname);
      let logTail = '';
      try {
        const txt = fs.readFileSync(logFile, 'utf8');
        logTail = txt.split('\n').slice(-40).join('\n');
      } catch (e) { logTail = ''; }
      send(res, 200, { ok: true, status: status, logTail: logTail });
      return;
    }
    if (req.method === 'POST') {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(triggerFile, new Date().toISOString());
        send(res, 200, { ok: true, note: '已写入触发文件，自更新模块 20 秒内响应' });
      } catch (e) {
        send(res, 500, { ok: false, error: '写触发文件失败：' + (e && e.message) });
      }
      return;
    }
  }
  if (u.pathname === '/api/dev/selfupdate/open' && DEV_MODE && req.method === 'POST') {
    // 开发端在本机跑：直接用 explorer 打开程序目录，省得用户自己找路径
    try {
      const { spawn } = require('child_process');
      spawn('explorer.exe', [path.dirname(__dirname)], { detached: true, stdio: 'ignore' }).unref();
      send(res, 200, { ok: true });
    } catch (e) {
      send(res, 500, { ok: false, error: '打开目录失败：' + (e && e.message) });
    }
    return;
  }

  /* 运维看板：仅开发端（KH_DEV_MODE=1）可见。客户成品的首页是影视页，不再是运维看板。 */
  if ((u.pathname === '/admin' || u.pathname === '/board') && req.method === 'GET') {
    if (!DEV_MODE) { send(res, 404, { ok: false, error: 'not found' }); return; }
    cors(res);
    // 看板右上角挂一个「功能追踪」入口，点进去看每版功能清单与增删
    const boardHtml = BOARD.indexOf('</body>') >= 0
      ? BOARD.replace('</body>', '<div style="position:fixed;right:14px;bottom:14px;z-index:9999;display:flex;gap:8px">' +
          '<a href="/admin/build" style="display:inline-block;padding:7px 14px;border-radius:18px;' +
          'background:#1F6FEB;color:#FFFFFF;text-decoration:none;font:13px/1.4 sans-serif;' +
          'border:1px solid #3B82F6">🚀 发版流水线</a>' +
          '<a href="/admin/alerts" style="display:inline-block;padding:7px 14px;border-radius:18px;' +
          'background:#1B3A5B;color:#CFE3FF;text-decoration:none;font:13px/1.4 sans-serif;' +
          'border:1px solid #2A4E77">🔔 告警中心</a>' +
          '<a href="/admin/release" style="display:inline-block;padding:7px 14px;border-radius:18px;' +
          'background:#1B3A5B;color:#CFE3FF;text-decoration:none;font:13px/1.4 sans-serif;' +
          'border:1px solid #2A4E77">📦 发布与运维</a>' +
          '<a href="/admin/metrics" style="display:inline-block;padding:7px 14px;border-radius:18px;' +
          'background:#1B3A5B;color:#CFE3FF;text-decoration:none;font:13px/1.4 sans-serif;' +
          'border:1px solid #2A4E77">📈 数据与体积</a>' +
          '<a href="/admin/home" style="display:inline-block;padding:7px 14px;border-radius:18px;' +
          'background:#0F3B2B;color:#BFEFD4;text-decoration:none;font:13px/1.4 sans-serif;' +
          'border:1px solid #1E6B4E">🏠 总目录</a>' +
          '<a href="/admin/quality" style="display:inline-block;padding:7px 14px;border-radius:18px;' +
          'background:#123B3B;color:#B8F0F0;text-decoration:none;font:13px/1.4 sans-serif;' +
          'border:1px solid #1F6B6B">✅ 质量门禁</a>' +
          '<a href="/admin/insights" style="display:inline-block;padding:7px 14px;border-radius:18px;' +
          'background:#1B3A5B;color:#CFE3FF;text-decoration:none;font:13px/1.4 sans-serif;' +
          'border:1px solid #2A4E77">📊 维护决策</a>' +
          '<a href="/admin/features" style="display:inline-block;padding:7px 14px;border-radius:18px;' +
          'background:#1B3A5B;color:#CFE3FF;text-decoration:none;font:13px/1.4 sans-serif;' +
          'border:1px solid #2A4E77">🧩 功能追踪</a>' +
          '<a href="/admin/extras" style="display:inline-block;padding:7px 14px;border-radius:18px;' +
          'background:#1B3A5B;color:#CFE3FF;text-decoration:none;font:13px/1.4 sans-serif;' +
          'border:1px solid #2A4E77">🧩 开关台</a>' +
          '<a href="/admin/devices" style="display:inline-block;padding:7px 14px;border-radius:18px;' +
          'background:#1B3A5B;color:#CFE3FF;text-decoration:none;font:13px/1.4 sans-serif;' +
          'border:1px solid #2A4E77">📱 设备能力表</a>' +
'<a href="/admin/catalog" style="display:inline-block;padding:7px 14px;border-radius:18px;' +
'background:#1B3A5B;color:#CFE3FF;text-decoration:none;font:13px/1.4 sans-serif;' +
'border:1px solid #2A4E77">🗂 站点目录</a>' +
'<a href="/admin/sites" style="display:inline-block;padding:7px 14px;border-radius:18px;' +
'background:#1B3A5B;color:#CFE3FF;text-decoration:none;font:13px/1.4 sans-serif;' +
'border:1px solid #2A4E77">🌐 站点管理</a>' +
'<a href="/admin/selfupdate" style="display:inline-block;padding:7px 14px;border-radius:18px;' +
'background:#123B2B;color:#BFF0CE;text-decoration:none;font:13px/1.4 sans-serif;' +
'border:1px solid #1F6B4B">🔄 自更新</a></div></body>')
      : BOARD;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(boardHtml) });
    res.end(boardHtml);
    return;
  }

  if (req.method === 'GET') { serveStatic(res, u, req); return; }
  send(res, 404, { ok: false, error: 'not found' });
}

/* 绑定非回环地址时必须带口令：首次启动生成一份并落盘，避免整个局域网无口令访问中枢 */
function genAccessToken() {
  // 12 位 Base32（去掉 0/O/1/I 这类易混字符），四四分组，设备上照着敲不会错
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const b = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) s += A[b[i] % A.length];
  return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12);
}
function ensureAccessToken() {
  if (ACCESS_TOKEN || HOST === '127.0.0.1' || HOST === '::1' || HOST === 'localhost') return;
  const f = path.join(DATA_DIR, 'access-token.txt');
  try { if (fs.existsSync(f)) ACCESS_TOKEN = fs.readFileSync(f, 'utf8').trim(); } catch (e) {}
  if (!ACCESS_TOKEN) {
    ACCESS_TOKEN = genAccessToken();
    try { fs.writeFileSync(f, ACCESS_TOKEN + '\n'); } catch (e) {}
  }
  console.log('[HongHub-Desktop] 局域网模式：访问口令 ' + ACCESS_TOKEN + '（文件 ' + f + '，可用 KH_ACCESS_TOKEN 覆盖）');
}
ensureAccessToken();

const server = http.createServer((req, res) => {
  try {
    handleRequest(req, res);
  } catch (e) {
    try { console.error('[request-error] ' + (e && e.stack || e)); } catch (_) {}
    try {
      if (!res.headersSent) send(res, 500, { ok: false, error: 'internal error' });
      else res.end();
    } catch (_) {}
  }
});
// 进程级兜底：异步回调里的意外错误只写日志，不让服务退出（客户端不能因一次异常白屏）
process.on('uncaughtException', function (e) { try { console.error('[uncaughtException] ' + (e && e.stack || e)); } catch (_) {} });
process.on('unhandledRejection', function (e) { try { console.error('[unhandledRejection] ' + (e && e.stack || e)); } catch (_) {} });

/* ---------------- 每日体检报告：每天 09:10 汇总一次，写 data/health-daily.jsonl（保留 30 份） ----------------
   汇总源健康、设备上报、崩溃/问题数、下发队列、当前版本与磁盘内存水位，开发端一眼看清昨天到底怎么样。
   只在本机落盘，不外呼；客户包同样可跑（无开发端权限要求）。 */
const DAILY_FILE = path.join(__dirname, 'data', 'health-daily.jsonl');
function buildDailyReport() {
  const r = { at: new Date().toISOString(), schema: 1 };
  try {
    const s = stats();
    r.devices = Object.keys(s.devices || {}).length;
    r.issues = Number(s.issues) || 0;
    r.reports24h = Number(s.last24) || 0;
  } catch (e) {}
  try {
    const snap = devops.snapshotSources(readManifest());
    r.sources = { ok: Number(snap.ok) || 0, total: Number(snap.total) || 0 };
  } catch (e) {}
  try {
    const q = deviceQueue.list(200);
    r.queuePending = (q.items || []).filter(function (x) { return x && x.state !== 'done' && x.state !== 'expired'; }).length;
  } catch (e) {}
  try {
    const idx = readReleaseIndex();
    r.latest = idx.latest || null;
    r.archived = (idx.versions || []).length;
  } catch (e) {}
  try {
    const h = healthMonitor.snapshot();
    r.diskFreeMB = Math.round(Number(h.diskFreeMB) || 0);
    r.memUsedPct = h.mem ? Number(h.mem.usedPct) : null;
    r.healthy = !!h.healthy;
  } catch (e) {}
  return r;
}
function writeDailyReport() {
  const rec = buildDailyReport();
  try {
    fs.mkdirSync(path.dirname(DAILY_FILE), { recursive: true });
    fs.appendFileSync(DAILY_FILE, JSON.stringify(rec) + '\n', 'utf8');
    /* 只留最近 30 份 */
    const lines = fs.readFileSync(DAILY_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length > 30) fs.writeFileSync(DAILY_FILE, lines.slice(-30).join('\n') + '\n', 'utf8');
    devops.audit('health.daily', { detail: '源 ' + (rec.sources ? rec.sources.ok + '/' + rec.sources.total : '?') + ' / 设备 ' + rec.devices });
  } catch (e) { console.warn('[体检报告] 写入失败：' + (e && e.message || e)); }
  return rec;
}
function scheduleDailyReport() {
  const next = new Date();
  next.setHours(9, 10, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  const t = setTimeout(function () {
    writeDailyReport();
    const iv = setInterval(writeDailyReport, 24 * 60 * 60 * 1000);
    if (iv.unref) iv.unref();
  }, next.getTime() - Date.now());
  if (t.unref) t.unref();
  console.log('[HongHub-Desktop] 每日体检报告已排期：下次 ' + next.toLocaleString('zh-CN', { hour12: false }));
}
function readDailyReports() {
  try {
    return fs.readFileSync(DAILY_FILE, 'utf8').split(/\r?\n/).filter(Boolean).map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}

server.listen(PORT, HOST, () => {
  console.log('[HongHub-Desktop] 服务已启动：http://' + HOST + ':' + PORT + ' （buildId=' + buildId() + '）');
  console.log('[HongHub-Desktop] writable=' + writable + ' reportToken=' + (!!REPORT_TOKEN) + ' fixToken=' + (!!FIX_TOKEN) + ' devMode=' + DEV_MODE);
  refreshPageFromPublic();
  const pageTimer = setInterval(refreshPageFromPublic, 10 * 60 * 1000); if (pageTimer.unref) pageTimer.unref();
  loadAutoRuns();
  loadGovernRuns();
  scheduleAutoRun();
  // 启动即留一条审计 + 记一次源健康快照，保证趋势曲线从第一天起就有基线
  try {
    devops.audit('server.start', { detail: 'port=' + PORT + ' / 功能 ' + readFeatures().length + ' 项' });
    const snapS = devops.snapshotSources(readManifest());
    if (snapS && snapS.total) console.log('[HongHub-Desktop] 源健康基线：' + snapS.ok + '/' + snapS.total + ' 可用');
  } catch (e) {}
  try {
    logRotate.start();
    healthMonitor.start();
    console.log('[HongHub-Desktop] 日志轮转（5MB / 保留 3 份）与健康监测（5 分钟）已启用');
  } catch (e) { console.warn('[HongHub-Desktop] 运维监测启动跳过：' + (e && e.message || e)); }
  try { scheduleDailyReport(); } catch (e) { console.warn('[HongHub-Desktop] 每日体检排期跳过：' + (e && e.message || e)); }
  // 告警外发：仅在开发端开启（客户包不碰）。没配 Webhook 或没启用时它自己就空转，不产生任何外呼。
  try {
    if (DEV_MODE) {
      alertsCenter.start(Number(process.env.KH_ALERT_INTERVAL_MS || 60 * 1000));
      console.log('[HongHub-Desktop] 告警外发通道已就绪：' + (alertsCenter.config().enabled ? '已启用 → ' + (alertsCenter.config().webhookUrl || '(未填地址)') : '未启用（在 /admin/alerts 打开）'));
    }
  } catch (e) { console.warn('[HongHub-Desktop] 告警外发启动跳过：' + (e && e.message || e)); }
  // 资源覆盖全自动巡检：探测全部频道与平台 → 自动建单 → 频道自动换源修复 → 复检关单 → 周报
  // 平时完全不需要人工；KH_CATALOG_INTERVAL_MS=0 可关闭周期（启动那轮仍会跑）
  try {
    const ms = Number(process.env.KH_CATALOG_INTERVAL_MS);
    if (ms !== 0) {
      const t = catalog.startAuto(ms || 15 * 60 * 1000);
      console.log('[HongHub-Desktop] 资源覆盖自动巡检已启用：每 ' + Math.round((t.intervalMs || 0) / 60000) + ' 分钟探测全部频道与平台，失败自动建单 + 自动换源 + 自动复检关单');
    } else { console.log('[HongHub-Desktop] 资源覆盖自动巡检已关闭（KH_CATALOG_INTERVAL_MS=0）'); }
  } catch (e) { console.warn('[HongHub-Desktop] 资源巡检启动跳过：' + (e && e.message || e)); }
  console.log('[HongHub-Desktop] 自动化运行：' + (AUTO_RUN_ENABLED ? ('已开启（' + (AUTO_RUN_HOUR !== null ? ('每日 ' + AUTO_RUN_HOUR + ':00') : (AUTO_RUN_INTERVAL_MS / 3600000 + ' 小时间隔')) + (AUTO_GOVERN ? ' · 模式=智能自治' : ' · 模式=更新+发布') + '）') : '已关闭'));
  // 自动修 Bug：启动后自动跑一轮，之后按周期自动巡检。全程自动处置 + 自动复检，无需人工复核。
  // KH_BUGFIX_INTERVAL_MS=0 可关闭周期巡检（启动那轮仍会跑）；默认 30 分钟。
  const BUGFIX_TICK_MS = Math.max(0, Number(process.env.KH_BUGFIX_INTERVAL_MS || 30 * 60 * 1000));
  setTimeout(function autoBugfixTick() {
    try {
      // 先从反馈建议自动长出新功能，再跑自动修 Bug（顺序不能反：新功能要先同步功能快照）
      const mine = miner.run();
      console.log('[HongHub-Desktop] 反馈自动长出新功能（无需人工复核）：扫描 ' +
        (mine.scannedTexts || 0) + ' 条 / 命中 ' + ((mine.candidates || []).length) +
        ' 项 / 自动添加 ' + ((mine.added || []).length) + ' 项');
      const opt = deviceOptimizer.run();
      console.log('[HongHub-Desktop] OS 版本自动优化（无需人工复核）：' +
        (opt.summary.families || 0) + ' 个系统家族 / ' + (opt.summary.osVersions || 0) +
        ' 个版本 / 自动修复 ' + (opt.summary.fixesApplied || 0) + ' 项 · 已随下发清单同步更新');
      const r = bugfix.run();
      const s = r.summary || {};
      console.log('[HongHub-Desktop] 自动修 Bug（无需人工复核）：发现 ' + (s.total || 0) +
        ' 项 / 自动处置 ' + (s.autoHandled || 0) + ' 项 / 自动复检 ' + (s.verified ? '通过' : '已排队，下轮自动重试'));
    } catch (e) { console.warn('[HongHub-Desktop] 自动闭环本轮跳过：' + (e && e.message || e)); }
    if (BUGFIX_TICK_MS > 0) setTimeout(autoBugfixTick, BUGFIX_TICK_MS);
  }, 20000);   // 避开打包期自检临时中枢的生命周期，避免构建中途写文件
});
