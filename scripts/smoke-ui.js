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
        /* 1.7.105：首页自 1.7.102 删掉预置样片后是「空态三卡」，data-act 天然少（12 个左右）。
           这里单独记空态卡数量，好把「空态正常」和「白屏/视图没渲染」区分开，别用同一个阈值误伤。 */
        emptyCards: document.querySelectorAll('[data-view="sites"], [data-view="resources"], [data-view="live"]').length,
        video: !!document.querySelector('video'),
        main: !!document.getElementById('main'),
        asyncScript: !!document.querySelector('script[data-kh-main], #khBoot'),
        hasRelease: /<script id="kh-release"/.test(html),
        appCode: Number(code || 0),
        text: (document.body && document.body.textContent || '').replace(/\s+/g, '').length
      };
    });
    out.dom = dom;
    /* 判定口径：空态三卡齐全 + 正文够长 = 首页空态正常，不再按 data-act 数量判死；
       其余视图（有片源）仍按 ≥15 个控件要求。 */
    const emptyHome = dom.emptyCards >= 2 && dom.text >= 800;
    if (dom.acts < 15 && !emptyHome) out.errors.push('控件数量异常：运行时 data-act 只有 ' + dom.acts + ' 个（疑似白屏或视图未渲染）');
    if (!dom.main) out.errors.push('缺少主内容容器 #main');
    if (!dom.video) out.errors.push('播放器元素缺失（<video> 未渲染）');
    if (!dom.hasRelease) out.errors.push('内嵌发版清单 kh-release 缺失（版本比对会失效）');
    if (dom.text < 300) out.errors.push('页面正文过短（' + dom.text + ' 字，疑似渲染失败）');
    out.checks = ['data-act ' + dom.acts + ' 个' + (emptyHome ? '（空态三卡 ' + dom.emptyCards + ' 张，正常）' : ''), '#main ' + (dom.main ? '有' : '无'), '<video> ' + (dom.video ? '有' : '无'),
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


    /* 1.7.88（台账 #160）：备份与恢复面板也要真点，不能只数控件 */
    await probe('备份与恢复面板', async () => {
      const g = await gotoView('settings');
      if (g !== 'ok') return '切到设置视图失败 ' + g;
      await page.waitForTimeout(250);
      /* 先留一条快照，让「回滚」按钮渲染出来（没快照时这块是提示文案） */
      await page.evaluate(() => {
        try { window.khSnapPush('export'); window.render(); } catch (e) {}
      });
      await page.waitForTimeout(250);
      const n = await page.evaluate(() => ({
        plain: !!document.querySelector('[data-act="bak-export"]'),
        enc: !!document.querySelector('[data-act="bak-export-enc"]'),
        imp: !!document.querySelector('[data-act="bak-import"]'),
        save: !!document.querySelector('[data-act="bak-auto-save"]'),
        pick: !!document.querySelector('[data-act="bak-dir-pick"]'),
        open: !!document.querySelector('[data-act="bak-dir-open"]'),
        on: !!document.getElementById('bakAutoOn'),
        every: !!document.getElementById('bakAutoEvery'),
        keep: !!document.getElementById('bakAutoKeep'),
        restore: document.querySelectorAll('[data-act="bak-snap-restore"]').length,
        clear: !!document.querySelector('[data-act="bak-snap-clear"]')
      }));
      const miss = Object.keys(n).filter((k) => k !== 'restore' && k !== 'clear' && !n[k]);
      if (miss.length) return '缺 ' + miss.join('/');
      if (n.restore < 1) return '有快照却没渲染回滚按钮';
      if (!n.clear) return '缺清空快照按钮';
      return '';
    });

    await probe('自动备份设置真点', async () => {
      await page.evaluate(() => { window.state.view = 'settings'; window.render(); });
      await page.waitForTimeout(200);
      await page.selectOption('#bakAutoOn', '1').catch(() => {});
      await page.selectOption('#bakAutoEvery', 'weekly').catch(() => {});
      await page.selectOption('#bakAutoKeep', '5').catch(() => {});
      try { await page.click('[data-act="bak-auto-save"]', { timeout: 3000 }); }
      catch (e) { return '点保存失败 ' + e.message; }
      await page.waitForTimeout(300);
      const cfg = await page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('kh_backup_auto') || 'null'); } catch (e) { return null; }
      });
      if (!cfg) return 'kh_backup_auto 没落盘';
      if (cfg.on !== true) return '开关没保存为开启';
      if (cfg.every !== 'weekly') return '周期没保存为每周（当前 ' + cfg.every + '）';
      if (Number(cfg.keep) !== 5) return '保留份数没保存为 5（当前 ' + cfg.keep + '）';
      return '';
    });

    await probe('快照回滚真点', async () => {
      const seeded = await page.evaluate(() => {
        try {
          /* 1.7.89 起设置类键带封条（#161）：必须走 setStore，裸 setItem 会被判成被改坏而复默认 */
          window.setStore('kh_font_scale', 130);
          const okPush = window.khSnapPush('export');
          window.setStore('kh_font_scale', 100);
          window.render();
          return okPush;
        } catch (e) { return false; }
      });
      if (!seeded) return '留快照失败（khSnapPush 返回 false）';
      await page.waitForTimeout(250);
      try { await page.click('[data-act="bak-snap-restore"]', { timeout: 3000 }); }
      catch (e) { return '点回滚失败 ' + e.message; }
      await page.waitForTimeout(400);
      const v = await page.evaluate(() => {
        try { return window.getStore('kh_font_scale', null); } catch (e) { return null; }
      });
      if (Number(v) !== 130) return '回滚后字号没有回到 130（当前 ' + v + '）';
      return '';
    });

    await probe('加密导出要密码', async () => {
      await page.evaluate(() => { window.state.view = 'settings'; window.render(); });
      await page.waitForTimeout(200);
      try { await page.click('[data-act="bak-export-enc"]', { timeout: 3000 }); }
      catch (e) { return '点加密导出失败 ' + e.message; }
      await page.waitForTimeout(250);
      const n = await page.evaluate(() => ({
        mask: !!document.getElementById('khBakPass'),
        input: !!document.getElementById('khBakPassInput'),
        aria: (document.getElementById('khBakPassInput') || {}).getAttribute
          ? (document.getElementById('khBakPassInput').getAttribute('aria-label') || '') : '',
        dialog: !!(document.querySelector('#khBakPass [role="dialog"]') || {}).id
      }));
      if (!n.mask || !n.input) return '没有弹出密码框';
      if (!n.aria) return '密码框缺 aria-label';
      try { await page.click('#khBakPassCancel', { timeout: 3000 }); } catch (e) { return '取消按钮点不动 ' + e.message; }
      await page.waitForTimeout(200);
      const gone = await page.evaluate(() => !document.getElementById('khBakPass'));
      return gone ? '' : '点取消后浮层没关掉';
    });

    /* 1.7.89（台账 #161）：性能 / 无障碍 / 安全三块面板必须存在且真点生效 */
    await probe('P2 三面板存在', async () => {
      await page.evaluate(() => { window.state.view = 'settings'; window.render(); });
      await page.waitForTimeout(250);
      const n = await page.evaluate(() => ({
        saveNet: !!document.querySelector('[data-act="p2-save"][data-grp="net"]'),
        saveA11y: !!document.querySelector('[data-act="p2-save"][data-grp="a11y"]'),
        saveSec: !!document.querySelector('[data-act="p2-save"][data-grp="sec"]'),
        conc: !!document.getElementById('p2NetConc'),
        timeout: !!document.getElementById('p2NetTimeout'),
        retry: !!document.getElementById('p2NetRetry'),
        liveQ: !!document.getElementById('p2LiveQuality'),
        liveAuto: !!document.getElementById('p2LiveAuto'),
        card: !!document.getElementById('p2CardDensity'),
        focus: !!document.getElementById('p2Focus'),
        vol: !!document.getElementById('p2Vol'),
        subFont: !!document.getElementById('p2SubFont'),
        subStroke: !!document.getElementById('p2SubStroke'),
        hook: !!document.getElementById('p2HookHosts'),
        harden: !!document.getElementById('p2Harden'),
        dirPick: !!document.querySelector('[data-act="p2-dir-pick"]'),
        dmgClear: !!document.querySelector('[data-act="p2-dmg-clear"]'),
        aria: (document.getElementById('p2HookHosts') || {}).getAttribute
          ? (document.getElementById('p2HookHosts').getAttribute('aria-label') || '') : ''
      }));
      const miss = Object.keys(n).filter((k) => k !== 'aria' && !n[k]);
      if (miss.length) return '缺 ' + miss.join('/');
      if (!n.aria) return '白名单输入框缺 aria-label';
      return '';
    });

    await probe('P2 设置真点生效', async () => {
      await page.evaluate(() => { window.state.view = 'settings'; window.render(); });
      await page.waitForTimeout(200);
      await page.selectOption('#p2NetConc', '4').catch(() => {});
      await page.selectOption('#p2NetRetry', '1').catch(() => {});
      await page.selectOption('#p2CardDensity', 'compact').catch(() => {});
      try { await page.click('[data-act="p2-save"][data-grp="net"]', { timeout: 3000 }); }
      catch (e) { return '点性能保存失败 ' + e.message; }
      await page.waitForTimeout(300);
      await page.selectOption('#p2Focus', 'contrast').catch(() => {});
      await page.selectOption('#p2SubFont', 'song').catch(() => {});
      try { await page.click('[data-act="p2-save"][data-grp="a11y"]', { timeout: 3000 }); }
      catch (e) { return '点无障碍保存失败 ' + e.message; }
      await page.waitForTimeout(350);
      const n = await page.evaluate(() => {
        var out = { cfg: null, focus: '', grid: '', subFont: '', seal: null };
        try { out.cfg = JSON.parse(localStorage.getItem('kh_p2') || 'null'); } catch (e) {}
        var cs = getComputedStyle(document.documentElement);
        out.focus = String(cs.getPropertyValue('--focus-ring') || '').trim();
        out.grid = String(cs.getPropertyValue('--grid-min') || '').trim();
        out.subFont = String(cs.getPropertyValue('--sub-font') || '').trim();
        try { out.seal = JSON.parse(localStorage.getItem('kh_store_seal') || 'null'); } catch (e) {}
        return out;
      });
      if (!n.cfg) return 'kh_p2 没落盘';
      if (Number(n.cfg.netConc) !== 4) return '并发没保存为 4（当前 ' + n.cfg.netConc + '）';
      if (Number(n.cfg.netRetry) !== 1) return '重试没保存为 1（当前 ' + n.cfg.netRetry + '）';
      if (n.cfg.cardDensity !== 'compact') return '卡片密度没保存为紧凑（当前 ' + n.cfg.cardDensity + '）';
      if (n.cfg.focusRing !== 'contrast') return '焦点框没保存为高对比（当前 ' + n.cfg.focusRing + '）';
      if (n.cfg.subFont !== 'song') return '字幕字体没保存为宋体（当前 ' + n.cfg.subFont + '）';
      if (n.focus.indexOf('#ffd400') < 0) return '--focus-ring 没有生效（当前 ' + n.focus + '）';
      if (n.grid.indexOf('132') < 0) return '--grid-min 没有生效（当前 ' + n.grid + '）';
      if (n.subFont.indexOf('SimSun') < 0) return '--sub-font 没有生效（当前 ' + n.subFont + '）';
      if (!n.seal || !n.seal.kh_p2) return 'kh_p2 没写封条';
      return '';
    });

    await probe('P2 安全白名单与封条真点', async () => {
      await page.evaluate(() => { window.state.view = 'settings'; window.render(); });
      await page.waitForTimeout(200);
      await page.fill('#p2HookHosts', 'hooks.example.com\n*.corp.example.com').catch(() => {});
      try { await page.click('[data-act="p2-save"][data-grp="sec"]', { timeout: 3000 }); }
      catch (e) { return '点安全保存失败 ' + e.message; }
      await page.waitForTimeout(300);
      const n = await page.evaluate(() => {
        var cfg = null, gate = null, gateOk = null;
        try { cfg = JSON.parse(localStorage.getItem('kh_p2') || 'null'); } catch (e) {}
        try {
          gate = window.KHP2.hostAllowed('https://evil.example.net/x', (cfg || {}).webhookHosts || []);
          gateOk = window.KHP2.hostAllowed('https://hooks.example.com/x', (cfg || {}).webhookHosts || []);
        } catch (e) {}
        return { hosts: (cfg || {}).webhookHosts || [], gate: gate && gate.ok, gateOk: gateOk && gateOk.ok };
      });
      if (!Array.isArray(n.hosts) || n.hosts.length !== 2) return '白名单没保存成 2 条（当前 ' + JSON.stringify(n.hosts) + '）';
      if (n.hosts[0] !== 'hooks.example.com') return '第一条域名没落盘（当前 ' + n.hosts[0] + '）';
      if (n.gate !== false) return '不在白名单的域名居然放行了';
      if (n.gateOk !== true) return '白名单内域名却被拒';
      return '';
    });

    await probe('偏好面板存在', async () => {
      await page.evaluate(() => { window.state.view = 'settings'; window.render(); });
      await page.waitForTimeout(220);
      const n = await page.evaluate(() => {
        const ids = ['prefHistCap', 'prefHistDays', 'prefResume', 'prefAutoNext', 'prefOpen', 'prefScope', 'prefWhJoin', 'prefMotion', 'prefStall', 'prefWatch'];
        const miss = ids.filter((id) => !document.getElementById(id));
        const aria = ids.filter((id) => {
          const el = document.getElementById(id);
          return !el || !(el.getAttribute('aria-label') || '').trim();
        });
        return { miss, aria, save: !!document.querySelector('[data-act="pref-save"]'),
          head: Array.from(document.querySelectorAll('h3')).some((h) => (h.textContent || '').indexOf('偏好与行为') >= 0) };
      });
      if (!n.head) return '设置页没有「偏好与行为」面板';
      if (n.miss.length) return '缺控件 ' + n.miss.join('/');
      if (n.aria.length) return '缺 aria-label ' + n.aria.join('/');
      if (!n.save) return '缺保存按钮 data-act="pref-save"';
      return '';
    });

    await probe('偏好设置真点生效', async () => {
      await page.evaluate(() => { window.state.view = 'settings'; window.render(); });
      await page.waitForTimeout(200);
      await page.selectOption('#prefHistCap', '10').catch(() => {});
      await page.selectOption('#prefHistDays', '7').catch(() => {});
      await page.selectOption('#prefResume', 'always').catch(() => {});
      await page.selectOption('#prefAutoNext', '1').catch(() => {});
      await page.selectOption('#prefOpen', 'detail').catch(() => {});
      await page.selectOption('#prefScope', 'warehouse').catch(() => {});
      await page.selectOption('#prefMotion', '0').catch(() => {});
      await page.selectOption('#prefWhJoin', '0').catch(() => {});
      await page.selectOption('#prefStall', '5').catch(() => {});
      await page.selectOption('#prefWatch', '9000').catch(() => {});
      try { await page.click('[data-act="pref-save"]', { timeout: 3000 }); }
      catch (e) { return '点偏好保存失败 ' + e.message; }
      await page.waitForTimeout(320);
      const n = await page.evaluate(() => {
        const keys = ['kh_hist_cap', 'kh_hist_days', 'kh_resume', 'kh_autonext', 'kh_open_mode', 'kh_search_scope', 'kh_motion', 'kh_wh_join', 'kh_stall_limit', 'kh_watchdog_ms'];
        const raw = {};
        keys.forEach((k) => { try { raw[k] = localStorage.getItem(k); } catch (e) { raw[k] = null; } });
        return {
          raw,
          prefs: window.khPref(),
          noMotion: document.documentElement.classList.contains('kh-no-motion'),
          histCapAttr: document.documentElement.getAttribute('data-kh-hist-cap')
        };
      });
      const missing = Object.keys(n.raw).filter((k) => n.raw[k] === null);
      if (missing.length) return '没落盘的键 ' + missing.join('/');
      if (n.prefs.histCap !== 10 || n.prefs.histDays !== 7) return '条数/天数没生效 ' + n.prefs.histCap + '/' + n.prefs.histDays;
      if (n.prefs.resume !== 'always') return '续播策略没生效 ' + n.prefs.resume;
      if (n.prefs.autoNext !== 1) return '自动下一部没生效 ' + n.prefs.autoNext;
      if (n.prefs.openMode !== 'detail') return '点击行为没生效 ' + n.prefs.openMode;
      if (n.prefs.searchScope !== 'warehouse') return '搜索范围没生效 ' + n.prefs.searchScope;
      if (!n.noMotion) return '动效关了但 html 没挂 kh-no-motion';
      if (String(n.histCapAttr) !== '10') return 'data-kh-hist-cap 没写（当前 ' + n.histCapAttr + '）';
      if (String(n.raw.kh_wh_join) !== '0') return '仓站点并入没保存为 0（当前 ' + n.raw.kh_wh_join + '）';
      if (String(n.raw.kh_stall_limit) !== '5') return '卡顿切源阈值没保存为 5（当前 ' + n.raw.kh_stall_limit + '）';
      if (String(n.raw.kh_watchdog_ms) !== '9000') return '起播超时没保存为 9000（当前 ' + n.raw.kh_watchdog_ms + '）';
      return '';
    });

    await probe('历史裁剪与搜索范围真生效', async () => {
      const n = await page.evaluate(() => {
        /* 造 40 条历史：前 20 条 8 天前、后 20 条 1 小时内，上限 10 条 + 7 天 */
        const ids = [], at = {}, now = Date.now();
        for (let i = 0; i < 40; i++) {
          const id = 'hist' + i;
          ids.push(id);
          at[id] = i < 20 ? now - 8 * 86400000 : now - 3600000;
        }
        window.setStore('kh_hist', ids);
        window.setStore('kh_hist_at', at);
        const kept = window.getHistory();
        const liveOk = window.KHPREF.scopeHas(window.khPref().searchScope, 'live');
        const whOk = window.KHPREF.scopeHas(window.khPref().searchScope, 'warehouse');
        const builtinAlways = window.KHPREF.scopeHas(window.khPref().searchScope, 'builtin');
        const next = window.KHPREF.pickNext({ id: 'x', title: '测试片', category: '电影' },
          [{ id: 'n1', title: '测试片 2', category: '电影', year: 2020 }, { id: 'n2', title: '别的', category: '电影', year: 2010 }]);
        return { kept, liveOk, whOk, builtinAlways, nextId: next && next.id };
      });
      if (!Array.isArray(n.kept) || n.kept.length !== 10) return '历史没按 10 条裁剪（当前 ' + (n.kept || []).length + ' 条）';
      if (n.kept.indexOf('hist0') >= 0) return '8 天前的记录没被天数淘汰';
      /* 老记录淘汰后剩下 hist20..hist39（20 条），按上限 10 截断 → hist20..hist29 */
      if (n.kept[0] !== 'hist20') return '保留顺序不对（首条 ' + n.kept[0] + '，应为 hist20）';
      if (n.kept.indexOf('hist30') >= 0) return '超出 10 条的记录没被截断';
      if (n.liveOk !== true) return '仓站范围应含直播';
      if (n.whOk !== true) return '仓站范围应含仓站';
      if (n.builtinAlways !== true) return '任何范围都该含内置片单';
      if (n.nextId !== 'n1') return '自动下一部候选不对（当前 ' + n.nextId + '）';
      return '';
    });

    await probe('高级与本地能力面板存在', async () => {
      await page.evaluate(() => { window.state.view = 'settings'; window.render(); });
      await page.waitForTimeout(220);
      const n = await page.evaluate(() => {
        const ids = ['prefAudio', 'prefSubAuto', 'prefSubDir', 'prefNotify', 'prefNotifySound', 'prefTop', 'prefClose', 'prefPlayerExe', 'prefPlayerArgs',
          'prefKid', 'prefKidPin', 'prefKidMin', 'prefHkToggle', 'prefHkNext', 'prefHkPrev', 'prefHkMute', 'prefHkTop'];
        const miss = ids.filter((id) => !document.getElementById(id));
        const aria = ids.filter((id) => {
          const el = document.getElementById(id);
          return !el || !(el.getAttribute('aria-label') || '').trim();
        });
        const acts = ['b8-save', 'b8-pip', 'b8-audit', 'b8-fix', 'b8-pick-dir', 'b8-pick-exe'].filter((a) => !document.querySelector('[data-act="' + a + '"]'));
        return { miss, aria, acts, box: !!document.getElementById('b8AuditOut'),
          head: Array.from(document.querySelectorAll('h3')).some((h) => (h.textContent || '').indexOf('高级与本地能力') >= 0) };
      });
      if (!n.head) return '设置页没有「高级与本地能力」面板';
      if (n.miss.length) return '缺控件 ' + n.miss.join('/');
      if (n.aria.length) return '缺 aria-label ' + n.aria.join('/');
      if (n.acts.length) return '缺按钮 ' + n.acts.join('/');
      if (!n.box) return '缺体检结果区 #b8AuditOut';
      return '';
    });

    await probe('高级设置真点生效', async () => {
      await page.evaluate(() => { window.state.view = 'settings'; window.render(); });
      await page.waitForTimeout(200);
      await page.selectOption('#prefAudio', 'zh').catch(() => {});
      await page.selectOption('#prefSubAuto', '0').catch(() => {});
      await page.selectOption('#prefNotify', 'download').catch(() => {});
      await page.selectOption('#prefTop', '1').catch(() => {});
      await page.selectOption('#prefClose', 'min').catch(() => {});
      await page.selectOption('#prefKid', '0').catch(() => {});
      try { await page.click('[data-act="b8-save"]', { timeout: 3000 }); }
      catch (e) { return '点高级设置保存失败 ' + e.message; }
      await page.waitForTimeout(320);
      const n = await page.evaluate(() => {
        const raw = {};
        ['kh_audio_lang', 'kh_sub_auto', 'kh_notify', 'kh_top', 'kh_kid', 'kh_hotkeys'].forEach((k) => {
          try { raw[k] = localStorage.getItem(k); } catch (e) { raw[k] = null; }
        });
        return { raw, prefs: window.khPref(), kidAttr: document.documentElement.getAttribute('data-kh-kid') };
      });
      if (n.raw.kh_audio_lang === null) return '音轨语言没落盘';
      if (n.prefs.audioLang !== 'zh') return '音轨语言没生效（当前 ' + n.prefs.audioLang + '）';
      if (String(n.raw.kh_sub_auto) !== '0') return '字幕自动没保存为 0（当前 ' + n.raw.kh_sub_auto + '）';
      if (n.prefs.notify !== 'download') return '通知策略没生效（当前 ' + n.prefs.notify + '）';
      if (n.prefs.top !== 1) return '置顶没生效（当前 ' + n.prefs.top + '）';
      if (n.prefs.closeAct !== 'min') return '关窗口行为没生效（当前 ' + n.prefs.closeAct + '）';
      if (String(n.kidAttr) !== '0') return 'data-kh-kid 没写（当前 ' + n.kidAttr + '）';
      return '';
    });

    await probe('字幕位置真点生效', async () => {
      await page.evaluate(() => { window.state.view = 'settings'; window.render(); });
      await page.waitForTimeout(220);
      const has = await page.evaluate(() => !!document.getElementById('p2SubPos'));
      if (!has) return '缺控件 #p2SubPos';
      await page.selectOption('#p2SubPos', '18').catch(() => {});
      try { await page.click('[data-act="p2-save"][data-grp="a11y"]', { timeout: 3000 }); }
      catch (e) { return '点字幕保存失败 ' + e.message; }
      await page.waitForTimeout(300);
      const n = await page.evaluate(() => {
        let sub = null;
        try { sub = JSON.parse(localStorage.getItem('kh_p2') || '{}').subPos; } catch (e) {}
        return { sub, bottom: getComputedStyle(document.documentElement).getPropertyValue('--sub-bottom').trim() };
      });
      if (Number(n.sub) !== 18) return 'subPos 没落盘（' + n.sub + '）';
      if (n.bottom !== '18%') return '--sub-bottom 没同步（' + n.bottom + '）';
      return '';
    });

    await probe('1.7.94 六个新面板真点生效', async () => {
      await page.evaluate(() => { window.state.view = 'settings'; window.render(); });
      await page.waitForTimeout(240);
      const blocks = await page.evaluate(() => ({
        cfg: !!document.getElementById('cfgQ'),
        theme: !!document.getElementById('themeUrl'),
        share: !!document.getElementById('shareUrl'),
        prof: !!document.getElementById('profName'),
        meta: !!document.getElementById('metaSrc'),
        net: !!document.getElementById('netMode')
      }));
      const miss = Object.keys(blocks).filter(k => !blocks[k]);
      if (miss.length) return '缺面板控件：' + miss.join(',');

      // ① 配置总览：搜索应筛行，清空回 38 行
      const before = await page.evaluate(() => document.querySelectorAll('[data-act="cfg-save"]').length);
      if (before !== 38) return '配置总览初始应有 38 行，实际 ' + before;
      await page.fill('#cfgQ', '音量').catch(() => {});
      await page.waitForTimeout(420);
      const filtered = await page.evaluate(() => document.querySelectorAll('[data-act="cfg-save"]').length);
      if (filtered < 1 || filtered >= 38) return '搜索「音量」后行数不对：' + filtered;
      const dbg = await page.evaluate(() => {
        const b = document.querySelector('[data-act="cfg-clear"]');
        if (!b) return { err: 'no-btn' };
        b.click();
        let st = 'undef';
        try { st = String(window.state && window.state.cfgQ); } catch (e) { st = 'throw:' + e.message; }
        const q = document.getElementById('cfgQ');
        return {
          rows: document.querySelectorAll('[data-act="cfg-save"]').length,
          inputVal: q ? q.value : 'no-input',
          stateCfgQ: st,
          actCount: document.querySelectorAll('[data-act="cfg-clear"]').length
        };
      });
      await page.waitForTimeout(320);
      const after = await page.evaluate(() => document.querySelectorAll('[data-act="cfg-save"]').length);
      if (after !== 38) return '清空后行数 ' + after + ' / 点击后即时 ' + JSON.stringify(dbg);

      // ② 皮肤包：应用第一个包 → body.kh-pack，再回内置
      await page.click('[data-act="theme-apply"]', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(320);
      const packOn = await page.evaluate(() => ({
        body: document.body.classList.contains('kh-pack'),
        cur: (function () { try { return localStorage.getItem('kh_theme_pack'); } catch (e) { return null; } })(),
        style: !!document.getElementById('khThemePackStyle')
      }));
      if (!packOn.body) return '应用皮肤包后 body 没有 kh-pack 类';
      if (!packOn.style) return '没注入 #khThemePackStyle';
      if (!packOn.cur) return 'kh_theme_pack 没落盘';
      await page.click('[data-act="theme-clear"]', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(320);
      const packOff = await page.evaluate(() => document.body.classList.contains('kh-pack'));
      if (packOff) return '回内置后 kh-pack 没摘掉';

      // ③ 家庭档案：新建 → 切回 → 删除（逻辑档案数走 khProfList，缺省 1 档不落盘）
      const p0 = await page.evaluate(() => { try { return khProfList().length; } catch (e) { return -1; } });
      if (p0 < 1) return 'khProfList 取不到档案（' + p0 + '）';
      await page.fill('#profName', '冒烟档').catch(() => {});
      await page.click('[data-act="prof-add"]', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(320);
      const p1 = await page.evaluate(() => {
        let list = [], cur = null;
        try { list = khProfList(); } catch (e) {}
        try { cur = khProfCur(); } catch (e) {}
        return { n: list.length, cur, name: (list.filter(x => x.id === cur)[0] || {}).name || '' };
      });
      if (p1.n !== p0 + 1) return '新建档案后数量没 +1（' + p0 + '→' + p1.n + '）';
      if (p1.name !== '冒烟档') return '新档案没切过去（当前 ' + p1.name + '）';
      const firstId = await page.evaluate(() => {
        const b = document.querySelector('[data-act="prof-switch"]:not([disabled])');
        return b ? b.getAttribute('data-id') : '';
      });
      if (firstId) {
        await page.click('[data-act="prof-switch"][data-id="' + firstId + '"]', { timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(300);
      }
      await page.click('[data-act="prof-del"][data-id="' + (p1.cur || '') + '"]', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(320);
      const p2 = await page.evaluate(() => { try { return khProfList().length; } catch (e) { return -1; } });
      if (p2 !== p0) return '删除档案后数量没回到 ' + p0 + '（' + p2 + '）';

      // ④ 网络族：选 IPv4-only 保存落盘
      await page.selectOption('#netMode', 'ipv4').catch(() => {});
      await page.click('[data-act="net-save"]', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(360);
      const netv = await page.evaluate(() => {
        try {
          if (typeof getStore === 'function') return String(getStore('kh_net_family', ''));
          const raw = localStorage.getItem('kh_net_family');
          return raw ? String(JSON.parse(raw)) : null;
        } catch (e) { return 'err:' + e.message; }
      });
      if (netv !== 'ipv4') return '网络族没落盘（当前 ' + netv + '）';

      // ⑤ 分享：应用内地址应能出二维码
      await page.fill('#shareUrl', '#/settings').catch(() => {});
      await page.click('[data-act="share-make"]', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(520);
      const qr = await page.evaluate(() => {
        const box = document.getElementById('qrBox');
        return box ? box.querySelectorAll('img,canvas').length : 0;
      });
      if (!qr) return '二维码没画出来（#qrBox 空）';
      return '';
    });

    await probe('配置体检真点出结果', async () => {
      await page.evaluate(() => { window.state.view = 'settings'; window.render(); });
      await page.waitForTimeout(200);
      try { await page.click('[data-act="b8-audit"]', { timeout: 3000 }); }
      catch (e) { return '点配置体检失败 ' + e.message; }
      await page.waitForTimeout(260);
      const txt = await page.evaluate(() => {
        const box = document.getElementById('b8AuditOut');
        return box ? (box.textContent || '') : '';
      });
      if (!/体检/.test(txt) || !/\d+\s*分/.test(txt)) return '体检结果区没有分数：' + txt.slice(0, 60);
      return '';
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
  /* 1.7.95：原来写死 slice(0,12)。新增 kh-guard/kh-hant/kh-tv/kh-account 后外链脚本变成 19 个，
     kh-core.js（200 个 data-act 模板）被挤出统计，控件数掉成 0 → 8/8 验收假失败。
     这里不截断，全部抓；真要防爆也只按脚本数量兜底。 */
  for (const s of Array.from(html.matchAll(/<script[^>]+src="([^"]+)"[^>]*>\s*<\/script>/g)).map(m => m[1]).slice(0, 40)) {
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
