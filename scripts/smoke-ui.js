#!/usr/bin/env node
'use strict';
/* 在线看板 UI 冒烟：优先用真实浏览器渲染页面并逐个点击所有按钮、捕获未捕获异常；
   未安装 Playwright/Puppeteer 或浏览器启动失败时降级为 vm + DOM stub，报告里明确标注。

   安全约束：真浏览器模式下拦截所有写操作 / 下载 / 安装类请求，只放行只读 GET。
   UI 冒烟验证的是「页面能渲染、脚本不报错、按钮点得动」，绝不真的触发
   /api/update/install（会拉起安装向导）等副作用。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const vm = require('vm');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 9600 + Math.floor(Math.random() * 200);
const REPORT = path.join(ROOT, 'dist', 'ui-smoke.json');
const TOTAL_TIMEOUT = 90000;

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
function scriptsOf(html) {
  return Array.from(html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g))
    .filter(m => !/application\/json/.test(m[1]) && m[2].trim()).map(m => m[2]);
}

async function runInBrowser(lib, calls, out) {
  const exe = findBrowser();
  const opts = {
    headless: true, timeout: 25000,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--disable-extensions']
  };
  if (exe) opts.executablePath = exe; // playwright-core 不自带浏览器，必须显式指定
  let browser;
  try {
    if (lib.name === 'puppeteer') {
      browser = await lib.mod.launch(Object.assign({}, opts, { args: opts.args }));
    } else {
      browser = await (lib.mod.chromium || lib.mod).launch(opts);
    }
    out.browser = exe || 'bundled chromium';
    const page = await browser.newPage();
    page.on('pageerror', e => out.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') (out.consoleErrors || (out.consoleErrors = [])).push(m.text().slice(0, 200)); });
    // 副作用隔离：只读 GET 放行，任何写操作 / 下载 / 安装端点一律 stub
    if (page.route) {
      await page.route('**/*', route => {
        const r = route.request();
        const url = r.url(), method = r.method();
        const risky = method !== 'GET' || /\/api\/update\/install|\/api\/govern\/run|\/api\/bugfix\/run|\/download\//i.test(url);
        if (risky) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"blockedBySmoke":true}' });
        return route.continue();
      });
    }
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    for (const fn of calls) {
      let via = null;
      try {
        // 优先真实 DOM 点击，找不到元素时退回直接调用函数
        const el = await page.$('[onclick^="' + fn + '("]');
        if (el) { await el.click({ timeout: 2500 }); via = 'dom'; }
      } catch (e) { /* 元素被遮挡/隐藏，退回 evaluate */ }
      if (!via) {
        try { await page.evaluate(n => { if (typeof window[n] === 'function') window[n](); }, fn); via = 'eval'; }
        catch (e) { out.errors.push(fn + ': ' + e.message); continue; }
      }
      out.clicked.push(fn + (via === 'eval' ? '(eval)' : ''));
    }
  } finally {
    if (browser) try { await browser.close(); } catch (e) {}
  }
}

function runFallback(html, calls, out) {
  out.mode = 'fallback';
  out.note = '未安装 Playwright / Puppeteer，或浏览器启动失败；已降级为 vm + DOM stub：只验证脚本可加载与函数可调用，未做真实渲染点击';
  const js = scriptsOf(html).pop() || '';
  try {
    const mkEl = () => ({ innerHTML: '', textContent: '', value: '', style: {}, disabled: false, checked: false,
      placeholder: '', querySelectorAll: () => [], focus() {}, closest() { return null; }, getAttribute() { return ''; } });
    const els = {};
    const ctx = {
      document: { getElementById: id => els[id] || (els[id] = mkEl()), querySelector: mkEl },
      window: { open() {}, location: {} },
      location: { reload() {}, href: '' },
      navigator: { userAgent: 'ui-smoke' }, localStorage: { getItem() { return null; }, setItem() {} },
      fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
      setInterval: () => 0, setTimeout: () => 0, clearInterval: () => {},
      confirm: () => true, prompt: () => '', alert: () => {},
      console, Date, JSON, Math, String, Array, Object, Number, parseInt, isNaN, RegExp
    };
    vm.createContext(ctx);
    new vm.Script(js).runInContext(ctx, { timeout: 3000 });
    for (const fn of calls) {
      if (typeof ctx[fn] !== 'function') { out.errors.push(fn + ' 未定义'); continue; }
      try { ctx[fn](); out.clicked.push(fn); } catch (e) { out.errors.push(fn + ': ' + e.message); }
    }
  } catch (e) { out.errors.push('脚本执行失败：' + e.message); }
}

(async () => {
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), AUTO_RUN_ENABLED: '0', AUTO_OPTIMIZE: '0', AUTO_GOVERN: '0' })
  });
  const killer = setTimeout(() => {
    console.error('  UI 冒烟超时，按失败处理');
    try { srv.kill(); } catch (e) {}
    process.exit(1);
  }, TOTAL_TIMEOUT);
  let html = '';
  for (let i = 0; i < 25 && !html; i++) {
    try { html = await get('/'); } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  const calls = Array.from(new Set(Array.from(html.matchAll(/onclick="([A-Za-z_$][\w$]*)\s*\(/g)).map(m => m[1])));
  const out = { ok: false, mode: null, buttons: calls.length, clicked: [], errors: [], at: new Date().toISOString() };

  const lib = probe();
  if (lib) {
    out.mode = 'browser';
    try {
      await runInBrowser(lib, calls, out);
      out.requestPolicy = '只读 GET 放行；POST / 下载 / 安装类请求已 stub（避免冒烟触发安装向导）';
    } catch (e) {
      out.browserError = e.message.slice(0, 200);
      out.errors.length = 0;   // 浏览器环境问题不算页面缺陷，交由 fallback 重新判定
      out.clicked.length = 0;
      runFallback(html, calls, out);
    }
  } else {
    runFallback(html, calls, out);
  }

  out.ok = out.errors.length === 0 && out.clicked.length === calls.length;
  try { fs.writeFileSync(REPORT, JSON.stringify(out, null, 2) + '\n'); } catch (e) {}
  try { srv.kill(); } catch (e) {}
  clearTimeout(killer);
  console.log('  UI 冒烟：' + out.mode + ' · 按钮 ' + out.clicked.length + '/' + out.buttons + ' · 错误 ' + out.errors.length +
    (out.browser ? ' · ' + path.basename(out.browser) : ''));
  if (out.mode === 'fallback') console.log('  ' + out.note);
  if (out.browserError) console.error('  浏览器启动失败：' + out.browserError);
  out.errors.slice(0, 5).forEach(e => console.error('  - ' + e));
  process.exit(out.ok ? 0 : 1);
})();
