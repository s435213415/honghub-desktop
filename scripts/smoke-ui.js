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
    /* 首启的条款遮罩会吃掉指针事件，真点验之前先摘掉（只影响本次冒烟页面，不改产品逻辑）。 */
    await page.evaluate(() => {
      const ov = document.getElementById('khConsentOverlay');
      if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    });
    for (const fn of calls) {
      let via = null;
      try {
        const el = await page.$('[onclick^="' + fn + '("]');
        if (el) { await el.click({ timeout: 2500 }); via = 'dom'; }
      } catch (e) { }
      if (!via) {
        try { await page.evaluate(n => { if (typeof window[n] === 'function') window[n](); }, fn); via = 'eval'; }
        catch (e) { out.errors.push(fn + ': ' + e.message); continue; }
      }
      out.clicked.push(fn + (via === 'eval' ? '(eval)' : ''));
    }
    /* 本项目控件全部走 data-act 事件委托，点了会触发真实动作（播放 / 安装 / 删除），
       所以不做盲点：改为断言页面骨架齐全。这一组断言正好能挡住白屏、模板缺失、脚本崩掉。 */
    const dom = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      /* 版本号定义在模块化后的 kh-app.js（var → 挂到 window），不在 innerHTML 里，直接读全局。 */
      const code = Number(window.KH_APP_CODE) || (html.match(/var KH_APP_CODE\s*=\s*(\d+)/) || [])[1];
      return {
        acts: document.querySelectorAll('[data-act]').length,
        video: !!document.querySelector('video'),
        main: !!document.getElementById('main'),
        asyncScript: !!document.querySelector('script[data-kh-main], #khBoot'),
        hasRelease: /<script id="kh-release"/.test(html),
        appCode: Number(code || 0),
        text: (document.body && document.body.textContent || '').replace(/\s+/g, '').length
      };
    });
    out.dom = dom;
    if (dom.acts < 15) out.errors.push('控件数量异常：运行时 data-act 只有 ' + dom.acts + ' 个（疑似白屏或视图未渲染）');
    if (!dom.main) out.errors.push('缺少主内容容器 #main');
    if (!dom.video) out.errors.push('播放器元素缺失（<video> 未渲染）');
    if (!dom.hasRelease) out.errors.push('内嵌发版清单 kh-release 缺失（版本比对会失效）');
    if (dom.text < 300) out.errors.push('页面正文过短（' + dom.text + ' 字，疑似渲染失败）');
    out.checks = ['data-act ' + dom.acts + ' 个', '#main ' + (dom.main ? '有' : '无'), '<video> ' + (dom.video ? '有' : '无'),
      '发版清单 ' + (dom.hasRelease ? '有' : '无'), '正文 ' + dom.text + ' 字', 'appCode #' + dom.appCode];

    /* 1.7.80：四块新面板改为「切视图 + 真点 + 读状态」。
       旧逻辑只数 data-act 数量，加了区块数字照样上涨，等于没验。 */
    const panels = { total: 0, passed: 0, errors: [], detail: {} };
    const probe = async (name, fn) => {
      panels.total++;
      try {
        const r = await fn();
        if (r === '' || r === true) { panels.passed++; panels.detail[name] = 'ok'; }
        else { panels.errors.push(name + '：' + r); panels.detail[name] = String(r); }
      } catch (e) { panels.errors.push(name + ' 抛错：' + e.message); panels.detail[name] = 'error'; }
    };
    const gotoView = v => page.evaluate(x => {
      try { window.state.view = x; window.render(); return 'ok'; } catch (e) { return e.message; }
    }, v);

    await probe('影视仓面板', async () => {
      const g = await gotoView('sites');
      if (g !== 'ok') return '切到网站视图失败 ' + g;
      await page.waitForTimeout(250);
      const n = await page.evaluate(() => ({
        paste: !!document.querySelector('[data-act="wh-paste"]'),
        refresh: !!document.querySelector('[data-act="wh-refresh-all"]'),
        srcGo: !!document.querySelector('[data-act="wh-src-go"]'),
        srcKw: !!document.getElementById('whSrcKw'),
        srcOut: !!document.getElementById('whSrcOut'),
        remoteSync: !!document.querySelector('[data-act="remote-sync"]')
      }));
      const miss = Object.keys(n).filter(k => !n[k]);
      return miss.length ? '缺 ' + miss.join('/') : '';
    });

    await probe('场景预设点击', async () => {
      const g = await gotoView('settings');
      if (g !== 'ok') return '切到设置视图失败 ' + g;
      await page.waitForTimeout(250);
      const cards = await page.evaluate(() => document.querySelectorAll('[data-act="scene-apply"]').length);
      if (cards !== 4) return '场景卡应有 4 张，实际 ' + cards;
      const before = await page.evaluate(() => localStorage.getItem('kh_scene'));
      try { await page.click('[data-act="scene-apply"]', { timeout: 3000 }); }
      catch (e) { return '点击场景卡失败 ' + e.message; }
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => localStorage.getItem('kh_scene'));
      if (!after) return 'kh_scene 未写入本地';
      const pressed = await page.evaluate(() => document.querySelectorAll('[data-act="scene-apply"][aria-pressed="true"]').length);
      if (pressed !== 1) return 'aria-pressed 未更新（当前 ' + pressed + ' 张为选中）';
      return ''; // 切档位会改 kh_scene，值本身变化与否不作硬判
    });

    await probe('下载队列渲染', async () => {
      /* 纯网页里没有主进程下载桥，区块会走「不支持」分支；这里注入一个内存假桥，
         让真实的队列 UI（含动态生成的暂停/移除按钮）也被渲染出来，而不是绕过它。 */
      await page.evaluate(() => {
        const items = [];
        window.__smokeDl = { items, calls: [] };
        window.khDl = {
          list: () => Promise.resolve({ items: items.slice(), dir: 'C:\\Users\\smoke\\鸿汇影下载', conc: 2, limitKB: 0 }),
          opt: o => { window.__smokeDl.calls.push('opt'); return Promise.resolve({ ok: true }); },
          add: a => {
            window.__smokeDl.calls.push('add');
            items.push({ id: items.length + 1, name: a.name || 'smoke.mp4', state: 'queued', received: 0, size: 1048576 });
            return Promise.resolve({ ok: true });
          },
          reveal: () => { window.__smokeDl.calls.push('reveal'); return Promise.resolve({ ok: true }); },
          clear: k => { window.__smokeDl.calls.push('clear:' + k); items.length = 0; return Promise.resolve({ ok: true }); },
          pause: id => { window.__smokeDl.calls.push('pause:' + id); return Promise.resolve({ ok: true }); },
          resume: id => { window.__smokeDl.calls.push('resume:' + id); return Promise.resolve({ ok: true }); },
          remove: id => { window.__smokeDl.calls.push('remove:' + id); return Promise.resolve({ ok: true }); },
          on: () => {}
        };
        try { window.state.view = 'settings'; window.render(); } catch (e) { return e.message; }
      });
      await page.waitForTimeout(300);
      const n = await page.evaluate(() => ({
        box: !!document.getElementById('dlList'),
        add: !!document.querySelector('[data-act="dl-add"]'),
        conc: !!document.getElementById('dlConc'),
        limit: !!document.getElementById('dlLimit'),
        reveal: !!document.querySelector('[data-act="dl-reveal"]'),
        clear: !!document.querySelector('[data-act="dl-clear"]'),
        text: ((document.getElementById('dlList') || {}).textContent || '').replace(/\s+/g, '')
      }));
      if (!n.box) return '队列容器 #dlList 未渲染';
      if (!n.add) return '缺少加入队列按钮';
      if (!n.conc || !n.limit) return '并发 / 限速选择器缺失';
      if (!n.reveal || !n.clear) return '打开文件夹 / 清空已结束 按钮缺失';
      if (!n.text) return '空队列时没有说明文字';
      return '';
    });

    await probe('下载队列真点入队', async () => {
      await page.fill('#dlUrl', 'https://example.com/smoke.mp4');
      await page.fill('#dlName', '冒烟测试片');
      await page.click('[data-act="dl-add"]', { timeout: 3000 });
      await page.waitForTimeout(400);
      const t = await page.evaluate(() => ((document.getElementById('dlList') || {}).textContent || '').replace(/\s+/g, ''));
      const calls = await page.evaluate(() => (window.__smokeDl || {}).calls || []);
      if (!calls.some(c => c === 'add')) return '加入队列没有调到桥';
      if (!/共1条/.test(t)) return '入队后列表没有刷新（当前：' + t.slice(0, 40) + '）';
      if (!/冒烟测试片/.test(t)) return '入队后没看到条目名';
      return '';
    });

    await probe('下载队列暂停按钮', async () => {
      const has = await page.evaluate(() => !!document.querySelector('[data-act="dl-pause"]'));
      if (!has) return '排队中的条目没有暂停按钮';
      await page.click('[data-act="dl-pause"]', { timeout: 3000 });
      await page.waitForTimeout(300);
      const calls = await page.evaluate(() => (window.__smokeDl || {}).calls || []);
      return calls.some(c => c.indexOf('pause:') === 0) ? '' : '暂停没有调到桥';
    });


    await probe('新面板可访问名', async () => {
      const bad = await page.evaluate(() => {
        const miss = [];
        document.querySelectorAll('[data-act="dl-add"],[data-act="dl-pause"],[data-act="dl-remove"],[data-act="scene-apply"],#dlConc,#dlLimit,#dlUrl,#dlName,#whSrcKw')
          .forEach(el => {
            const name = (el.getAttribute('aria-label') || '').trim();
            const txt = (el.textContent || '').trim();
            if (!name && !txt) miss.push(el.id || el.getAttribute('data-act'));
          });
        return miss;
      });
      return bad.length ? '缺可访问名 ' + bad.join('/') : '';
    });

    out.panels = panels;
    panels.errors.forEach(e => out.errors.push('面板 ' + e));
    out.checks.push('面板真点 ' + panels.passed + '/' + panels.total);
  } finally {
    if (browser) try { await browser.close(); } catch (e) {}
  }
}

function runFallback(html, calls, out, extCode) {
  out.mode = 'fallback';
  out.note = '未安装 Playwright / Puppeteer，或浏览器启动失败；已降级为 vm + DOM stub：只验证脚本可加载与函数可调用，未做真实渲染点击';
  const js = (scriptsOf(html).pop() || '') + '\n' + (extCode || '');
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
  /* 页面脚本已模块化：<script src="kh-*.js"> 外链，控件模板与函数体都在外链文件里，
     必须把外链内容一起抓回来再做统计，否则静态口径会退化成「0 个控件」。 */
  let extCode = '', extScripts = [];
  for (const s of Array.from(html.matchAll(/<script[^>]+src="([^"]+)"[^>]*>\s*<\/script>/g)).map(m => m[1]).slice(0, 12)) {
    extScripts.push(s);
    try { extCode += '\n' + await get(s.startsWith('/') ? s : '/' + s); } catch (e) { /* 缺文件由下面的门禁暴露 */ }
  }
  if (extScripts.length && !extCode.trim()) out.errors.push('页面外链脚本全部取不到：' + extScripts.join(', '));
  const merged = html + extCode;
  const calls = Array.from(new Set(Array.from(merged.matchAll(/onclick="([A-Za-z_$][\w$]*)\s*\(/g)).map(m => m[1])));
  /* 页面控件以 data-act 事件委托为主：统计它们才是真实的「界面完整度」，只数 inline onclick 会永远 0/0 假绿。 */
  const dataActs = Array.from(new Set(Array.from(merged.matchAll(/data-act="([^"]+)"/g)).map(m => m[1]).filter(Boolean)));
  const out = { ok: false, mode: null, buttons: calls.length + dataActs.length, inlineCalls: calls.length, dataActs: dataActs.length,
    scripts: extScripts, clicked: [], checks: [], errors: [], at: new Date().toISOString() };

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
      runFallback(html, calls, out, extCode);
    }
  } else {
    runFallback(html, calls, out, extCode);
  }

  /* 判定：脚本无异常 + 页面控件数达标（>=30 个 data-act）+ fallback 模式下 inline 函数全可调用。
     浏览器模式下骨架由 dom 断言负责；fallback 模式没有真实 DOM，只校验脚本能加载、函数能调。 */
  const inlineOk = out.mode === 'fallback' ? (calls.length === 0 || out.clicked.length >= calls.length) : true;
  out.ok = out.errors.length === 0 && out.dataActs >= 30 && inlineOk;
  try { fs.writeFileSync(REPORT, JSON.stringify(out, null, 2) + '\n'); } catch (e) {}
  try { srv.kill(); } catch (e) {}
  clearTimeout(killer);
  console.log('  UI 冒烟：' + out.mode + ' · 控件 ' + out.dataActs + '(data-act) + ' + out.inlineCalls + '(onclick) · 错误 ' + out.errors.length +
    (out.browser ? ' · ' + path.basename(out.browser) : ''));
  (out.checks || []).forEach(c => console.log('    · ' + c));
  if (out.mode === 'fallback') console.log('  ' + out.note);
  if (out.browserError) console.error('  浏览器启动失败：' + out.browserError);
  out.errors.slice(0, 5).forEach(e => console.error('  - ' + e));
  process.exit(out.ok ? 0 : 1);
})();
