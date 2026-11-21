#!/usr/bin/env node
'use strict';
/* 1.7.80 性能基线：真浏览器（Edge / Chrome）量首屏与运行时开销，落 dist/perf-baseline.json。
   量四样东西：
   1) 首屏：FCP、DOMContentLoaded、首个控件出现的时间（相对 navigationStart）；
   2) JS 堆：Chromium 的真实堆用量（CDP Performance.getMetrics 的 JSHeapUsedSize）；
   3) DOM 规模：节点数、层级深度（大列表卡顿的第一嫌疑）；
   4) 帧率：连续 3 秒 rAF 采样的平均 FPS、p95 帧间隔、>25ms 的卡顿帧数。
   跑 3 轮取中位数，并与上一次基线比较：劣化超过阈值（默认 20%/30%）按失败退出。

   用法：
     node scripts/perf-baseline.js            # 量一次，更新 dist/perf-baseline.json
     KH_PERF_ROUNDS=5 node scripts/perf-baseline.js
     KH_PERF_REG=0.5 node ...                 # 放宽劣化阈值
     KH_PERF_NO_COMPARE=1 node ...            # 只记录不比较 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 9900 + Math.floor(Math.random() * 90);
const OUT = path.join(ROOT, 'dist', 'perf-baseline.json');
const ROUNDS = Math.max(1, Number(process.env.KH_PERF_ROUNDS || 3));
const REG = Number(process.env.KH_PERF_REG || 0.2);
const NO_CMP = process.env.KH_PERF_NO_COMPARE === '1';
const SAMPLE_MS = 3000;

function probe() {
  for (const name of ['playwright', 'playwright-core', 'puppeteer']) {
    try { return { name, mod: require(name) }; } catch (e) { /* 未安装 */ }
  }
  return null;
}
function findBrowser() {
  const cands = [
    process.env.KH_BROWSER_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);
  return cands.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
}
function get(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: pathname, timeout: 2000 }, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => resolve(b));
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}
const median = a => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round(((s[s.length / 2 - 1] + s[s.length / 2]) / 2) * 10) / 10;
};
const round1 = v => Math.round(Number(v) * 10) / 10;

async function oneRound(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (page.route) {
    await page.route('**/*', route => {
      const r = route.request();
      if (r.method() !== 'GET' || /\/api\/update\/install|\/api\/govern\/run|\/api\/bugfix\/run|\/download\//i.test(r.url()))
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"blockedPerf":true}' });
      return route.continue();
    });
  }
  const t0 = Date.now();
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  /* 首个控件出现时刻（相对 navigationStart），作为「界面可用」的代理指标 */
  let readyAt = 0;
  for (let i = 0; i < 60 && !readyAt; i++) {
    readyAt = await page.evaluate(() => {
      const n = document.querySelectorAll('[data-act]').length;
      return n > 0 ? Math.round(performance.now()) : 0;
    });
    if (!readyAt) await page.waitForTimeout(50);
  }
  await page.waitForTimeout(250);
  const stat = await page.evaluate(async ms => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paints = performance.getEntriesByType('paint') || [];
    const fcp = (paints.find(p => p.name === 'first-contentful-paint') || {}).startTime || 0;
    const nodes = document.querySelectorAll('*').length;
    let depth = 0;
    (function walk(el, d) { if (d > depth) depth = d; for (const c of el.children) walk(c, d + 1); })(document.documentElement, 0);
    const gaps = [];
    let last = performance.now();
    const start = last;
    await new Promise(res => {
      const tick = now => {
        gaps.push(now - last); last = now;
        if (now - start < ms) requestAnimationFrame(tick); else res();
      };
      requestAnimationFrame(tick);
    });
    const g = gaps.slice(1);
    const avg = g.reduce((a, b) => a + b, 0) / Math.max(1, g.length);
    const sorted = g.slice().sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    return {
      dcl: Math.round(nav.domContentLoadedEventEnd || 0),
      load: Math.round(nav.loadEventEnd || 0),
      fcp: Math.round(fcp),
      nodes, depth,
      fps: avg ? Math.round(1000 / avg * 10) / 10 : 0,
      p95: Math.round(p95 * 10) / 10,
      jank: g.filter(x => x > 25).length,
      frames: g.length,
      memJS: (performance.memory && performance.memory.usedJSHeapSize) ? performance.memory.usedJSHeapSize : 0
    };
  }, SAMPLE_MS);
  /* 真实 JS 堆（CDP），比 performance.memory 准 */
  let heap = 0;
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const m = await cdp.send('Performance.getMetrics');
    const find = k => (m.metrics.find(x => x.name === k) || {}).value || 0;
    heap = find('JSHeapUsedSize') || find('JSHeapTotalSize') || 0;
    await cdp.detach();
  } catch (e) { /* 非 Chromium 内核时退回 performance.memory */ }
  /* 视图切换耗时：设置页与网站页各渲染一次 */
  const switchMs = await page.evaluate(() => {
    const out = {};
    for (const v of ['settings', 'sites', 'home']) {
      try {
        const t = performance.now();
        window.state.view = v; window.render();
        out[v] = Math.round(performance.now() - t);
      } catch (e) { out[v] = -1; }
    }
    try { window.state.view = 'home'; window.render(); } catch (e) {}
    return out;
  });
  await ctx.close();
  return {
    readyAt, dcl: stat.dcl, load: stat.load, fcp: stat.fcp,
    nodes: stat.nodes, depth: stat.depth,
    heapKB: Math.round((heap || stat.memJS) / 1024),
    fps: stat.fps, p95: stat.p95, jank: stat.jank, frames: stat.frames,
    switchMs, wallMs: Date.now() - t0, errors
  };
}

(async () => {
  const lib = probe();
  if (!lib) { console.error('  未找到 playwright / playwright-core / puppeteer，无法度量性能基线'); process.exit(2); }
  const exe = findBrowser();
  if (!exe) { console.error('  未找到 Edge / Chrome 可执行文件，可用 KH_BROWSER_PATH 指定'); process.exit(2); }
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), AUTO_RUN_ENABLED: '0', AUTO_OPTIMIZE: '0', AUTO_GOVERN: '0' })
  });
  const cleanup = () => { try { srv.kill(); } catch (e) {} };
  process.on('exit', cleanup);
  let ok = false;
  for (let i = 0; i < 25 && !ok; i++) {
    try { await get('/'); ok = true; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  if (!ok) { console.error('  本地站点未起来（server.js 启动失败）'); cleanup(); process.exit(2); }

  const launchOpts = {
    headless: true, executablePath: exe,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--disable-extensions',
      '--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
  };
  let browser;
  try { browser = await (lib.mod.chromium || lib.mod).launch(launchOpts); }
  catch (e) { console.error('  浏览器启动失败：' + e.message); cleanup(); process.exit(2); }

  const rounds = [];
  for (let i = 0; i < ROUNDS; i++) {
    try {
      const r = await oneRound(browser);
      rounds.push(r);
      console.log('  第 ' + (i + 1) + ' 轮：首屏 ' + r.fcp + 'ms · 可用 ' + r.readyAt + 'ms · 堆 ' + r.heapKB + 'KB · DOM ' + r.nodes +
        ' 节点/' + r.depth + ' 层 · FPS ' + r.fps + '（p95 ' + r.p95 + 'ms，卡顿 ' + r.jank + ' 帧）· 切换 ' +
        (r.switchMs.settings === undefined ? '-' : 'settings ' + r.switchMs.settings + 'ms / sites ' + r.switchMs.sites + 'ms'));
      if (r.errors.length) console.log('  ⚠ 本轮页面异常：' + r.errors.slice(0, 3).join(' | '));
    } catch (e) { console.log('  第 ' + (i + 1) + ' 轮失败：' + e.message); }
  }
  try { await browser.close(); } catch (e) {}
  cleanup();
  if (!rounds.length) { console.error('  所有轮次都失败，未能形成基线'); process.exit(1); }

  const med = {};
  for (const k of ['readyAt', 'dcl', 'load', 'fcp', 'nodes', 'depth', 'heapKB', 'fps', 'p95', 'jank']) {
    med[k] = k === 'fps' || k === 'p95' ? median(rounds.map(r => r[k])) : Math.round(median(rounds.map(r => r[k])));
  }
  med.switchSettings = median(rounds.map(r => r.switchMs.settings));
  med.switchSites = median(rounds.map(r => r.switchMs.sites));

  let prev = null, deltas = null, regressed = [];
  try {
    const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    prev = old && old.median ? { version: old.version, median: old.median, at: old.at } : null;
  } catch (e) { /* 首次运行没有旧基线 */ }
  if (prev && !NO_CMP) {
    const rules = [
      ['fps', 'frames/sec', -REG * 100, '%'],
      ['fcp', '首屏 ms', REG * 1.5 * 100, '%'],
      ['readyAt', '可用 ms', REG * 1.5 * 100, '%'],
      ['heapKB', '堆 KB', REG * 1.5 * 100, '%'],
      ['nodes', 'DOM 节点', REG * 100, '%'],
      ['switchSettings', '设置页渲染 ms', REG * 1.5 * 100, '%']
    ];
    deltas = {};
    for (const [k, label, limit, unit] of rules) {
      const a = prev.median[k], b = med[k];
      if (a === undefined || b === undefined || !a) continue;
      const pct = Math.round((b - a) * 1000 / a) / 10;
      deltas[k] = { prev: a, now: b, pct };
      const bad = limit > 0 ? pct > limit : pct < limit;
      if (bad) regressed.push(label + ' 由 ' + a + ' 变 ' + b + '（' + (pct > 0 ? '+' : '') + pct + unit + '，阈值 ' + limit + unit + '）');
    }
  }

  const rec = {
    version: (() => { try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); } catch (e) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch (e2) { return ''; } } })(),
    at: new Date().toISOString(),
    browser: path.basename(exe), lib: lib.name, rounds: rounds.length,
    sampleMs: SAMPLE_MS,
    median: med,
    perRound: rounds.map(r => ({ fcp: r.fcp, readyAt: r.readyAt, heapKB: r.heapKB, nodes: r.nodes, fps: r.fps, p95: r.p95, jank: r.jank })),
    prev: prev ? { version: prev.version, at: prev.at, median: prev.median } : null,
    deltas, regressed
  };
  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (e) {}
  fs.writeFileSync(OUT, JSON.stringify(rec, null, 2), 'utf8');
  console.log('\n  性能基线（中位数）：首屏 ' + med.fcp + 'ms · 可用 ' + med.readyAt + 'ms · 堆 ' + med.heapKB +
    'KB · DOM ' + med.nodes + ' 节点 · 平均 FPS ' + med.fps + ' · p95 ' + med.p95 + 'ms');
  console.log('  设置页渲染 ' + med.switchSettings + 'ms · 网站页渲染 ' + med.switchSites + 'ms · 结果写入 ' + path.relative(ROOT, OUT));
  if (prev) {
    if (!regressed.length) console.log('  与上一版（' + prev.version + '）比：无劣化超阈值项目');
    else { console.log('  ⚠ 劣化：' + regressed.join('；')); process.exit(1); }
  } else {
    console.log('  首次形成基线，后续版本将据此比较劣化');
  }
})().catch(e => { console.error('  性能基线脚本异常：' + (e && e.message)); process.exit(1); });
