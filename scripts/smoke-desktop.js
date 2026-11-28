#!/usr/bin/env node
'use strict';
/* 真窗口冒烟（1.7.107 新增）：定位免安装客户包 → 真启 Electron（走完整 preload 链）→ CDP 断言。
   与 smoke-ui.js 的浏览器模式互补：浏览器模式把页面当普通网页渲染，不经 preload.js，
   挡不住 contextBridge 暴露名与页面世界顶层声明同名这类白屏（1.7.104 khDeviceId 事故，
   1.7.104/105 客户版一直白屏而 browser 冒烟全绿）。本脚本真启 packaged exe，preload 必经过。

   硬断言：正文非空 / 有 #main / 核心函数已加载 / 无 Uncaught 异常 / 上报地址已预置。
   纯 Node 零依赖（Node 22 内置 WebSocket）。任一硬伤 exit(1)，报告写 dist/desktop-smoke.json。
   安全：全新 user-data-dir，不碰用户真实配置；不点任何写操作控件，只读断言。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const REPORT = path.join(DIST, 'desktop-smoke.json');
const PORT = 9400 + Math.floor(Math.random() * 200);
const TOTAL_TIMEOUT = 150000;
const out = { mode: 'electron-real-window', ok: false, errors: [], checks: [], exe: null, port: PORT, dom: null };
const tmpDirs = [];

function largestExe(dir) {
  let best = null;
  const walk = (d, depth) => {
    if (depth > 3) return;
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.exe$/i.test(e.name)) {
        try { const s = fs.statSync(p).size; if (s > 50 * 1024 * 1024 && (!best || s > best.size)) best = { p, size: s }; } catch (e2) { /* ignore */ }
      }
    }
  };
  walk(dir, 0);
  return best && best.p;
}

function findExe() {
  const desk = path.join(os.homedir(), 'Desktop');
  // 1) 已解压的客户免安装夹（桌面「鸿汇影桌面版 VERSION」或 dist/client/win-unpacked）
  const extracted = [path.join(DIST, 'client', 'win-unpacked')];
  try {
    for (const d of fs.readdirSync(desk, { withFileTypes: true })) {
      if (d.isDirectory() && /^鸿汇影桌面版\s/i.test(d.name)) extracted.push(path.join(desk, d.name));
    }
  } catch (e) { /* 无桌面访问 */ }
  for (const dir of extracted) { const e = largestExe(dir); if (e) return { exe: e, from: 'extracted:' + dir }; }

  // 2) 客户免安装 zip：私发夹 / dist/client，取版本号最高者，解压到临时目录再取主程序。
  //    必须测客户版（加载影视页 index.html + kh-core.js）：开发端 win-unpacked 加载 /admin 看板，
  //    不经 kh-core，挡不住客户版白屏（1.7.104 khDeviceId 事故正是客户版独有）。
  const zips = [];
  const collect = (dir, re) => {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!/\.zip$/i.test(f) || !re.test(f)) continue;
        const m = f.match(/(\d+\.\d+\.\d+)/);
        zips.push({ p: path.join(dir, f), ver: m ? m[1] : '0', name: f });
      }
    } catch (e) { /* 目录不存在 */ }
  };
  try {
    for (const d of fs.readdirSync(desk, { withFileTypes: true })) {
      if (d.isDirectory() && /^鸿汇影·私发_v/i.test(d.name)) collect(path.join(desk, d.name), /鸿汇影免安装.*\.zip$/i);
    }
  } catch (e) { /* ignore */ }
  collect(path.join(DIST, 'client'), /鸿汇影免安装.*\.zip$/i);
  // 本机是 x64：arm64 包无法启动（spawn UNKNOWN / Start-Process 无 pid），必须排除
  // 1.7.108：KH_SMOKE_VARIANT=store 时只测 -store 包；默认私发冒烟排除 -store，互不串味
  const WANT_STORE = process.env.KH_SMOKE_VARIANT === 'store';
  const x64 = zips.filter((z) => !/-arm64/i.test(z.name) && (WANT_STORE ? /-store/i.test(z.name) : !/-store/i.test(z.name)));
  const pool = x64.length ? x64 : zips;
  if (!pool.length) return null;
  const verNum = (v) => v.split('.').reduce((a, b) => a * 1000 + Number(b), 0);
  pool.sort((a, b) => verNum(b.ver) - verNum(a.ver));
  const zip = pool[0];
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-smoke-zip-'));
  tmpDirs.push(dest);
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const r = spawnSync(tar, ['-xf', zip.p, '-C', dest], { timeout: 120000, windowsHide: true });
  if (r.status !== 0) return { error: '解压客户包失败（' + zip.name + '）：' + String(r.stderr || '').slice(0, 120) };
  const exe = largestExe(dest);
  if (!exe) return { error: '客户包内未找到主程序 exe（' + zip.name + '）' };
  return { exe, from: 'zip:' + zip.name };
}

function listTargets() {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/json/list', timeout: 2000 }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve([]); } });
    }).on('error', () => resolve(null)).on('timeout', function () { this.destroy(); resolve(null); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cdpEval(wsUrl, expression, waitLoadMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const exceptions = [];
    const consoleErrors = [];
    const send = (method, params) => new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
    const timer = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('CDP 超时')); }, waitLoadMs + 20000);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || {}); pending.delete(msg.id); return; }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        exceptions.push(String((d.exception && d.exception.description) || d.text || '').slice(0, 300));
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 200));
      }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP WebSocket 连接失败')); };
    ws.onopen = async () => {
      try {
        await send('Runtime.enable');
        await send('Log.enable');
        await sleep(waitLoadMs); // 等首屏渲染 + 脚本执行
        const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        clearTimeout(timer);
        let value = null, evalErr = null;
        if (r.exceptionDetails) evalErr = String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 300);
        else value = r.result && r.result.value;
        try { ws.close(); } catch (e) {}
        resolve({ value, evalErr, exceptions, consoleErrors });
      } catch (e) { clearTimeout(timer); try { ws.close(); } catch (e2) {} reject(e); }
    };
  });
}

const ASSERT_EXPR = `(function(){
  var body = document.body ? (document.body.textContent||'').replace(/\\s+/g,'').length : 0;
  var hasMain = !!document.getElementById('main');
  var need = ['issueRemoteCfg','issueRemoteSend','applySiteData'];
  var fns = need.filter(function(n){ return typeof window[n]==='function'; });
  var url='', enabled=null, cfgErr='';
  try { if (typeof window.issueRemoteCfg==='function'){ var c=window.issueRemoteCfg(); if(c){ url=c.url||''; enabled=c.enabled; } } }
  catch(e){ cfgErr=String(e.message||e); }
  return {
    body: body, hasMain: hasMain, fns: fns, missing: need.filter(function(n){return fns.indexOf(n)<0;}),
    url: url, enabled: enabled, cfgErr: cfgErr,
    bridge: typeof window.khDeviceIdBridge,
    clean: (typeof window.KH_UI_CLEAN==='undefined')?null:!!window.KH_UI_CLEAN,
    store: !!window.KH_STORE,
    navLiveHidden: (function(){var b=document.querySelector('#nav button[data-view="live"]');return b?(b.style.display==='none'):null;})(),
    acts: document.querySelectorAll('[data-act]').length,
    emptyCards: document.querySelectorAll('[data-view="sites"],[data-view="resources"],[data-view="live"]').length,
    title: document.title || ''
  };
})()`;

(async () => {
  const found = findExe();
  if (!found) { out.errors.push('找不到客户免安装包（桌面私发夹 / dist/client 的 zip，或已解压免安装夹）'); return finish(); }
  if (found.error) { out.errors.push(found.error); return finish(); }
  const exe = found.exe;
  out.exe = exe; out.from = found.from;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-smoke-'));
  tmpDirs.push(profile);
  out.profile = profile;
  // 经 PowerShell Start-Process 启动（ShellExecute）：Node 直接 spawn 新构建的客户 exe 会报
  // spawn UNKNOWN（libuv CreateProcess 对该 GUI exe 返回未映射错误），Start-Process 实测稳定。
  const pidFile = path.join(os.tmpdir(), 'kh-smoke-pid-' + PORT + '.txt');
  const launcher = path.join(os.tmpdir(), 'kh-smoke-launch-' + PORT + '.ps1');
  const psExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = "$ErrorActionPreference='Stop'\r\n" +
    "$p = Start-Process -FilePath '" + exe + "' -ArgumentList '--remote-debugging-port=" + PORT + "','--user-data-dir=" + profile + "','--no-first-run','--disable-gpu' -PassThru\r\n" +
    "[System.IO.File]::WriteAllText('" + pidFile + "', [string]$p.Id)\r\n";
  fs.writeFileSync(launcher, '\uFEFF' + script, 'utf8'); // BOM：PS5.1 正确读中文路径
  let appPid = 0;
  try {
    const lp = spawn(psExe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher], { stdio: 'ignore', windowsHide: true });
    lp.on('error', (e) => { out.spawnErr = String(e.message || e); });
    for (let i = 0; i < 40 && !appPid; i++) {
      await sleep(500);
      try { appPid = Number(fs.readFileSync(pidFile, 'utf8').trim()) || 0; } catch (e) { /* 尚未写出 */ }
    }
  } catch (e) { out.spawnErr = String(e.message || e); }
  try { fs.unlinkSync(launcher); } catch (e) {}
  if (!appPid) { out.errors.push('客户版主程序启动失败（' + (out.spawnErr || 'Start-Process 未返回 pid') + '）'); return finish(); }
  out.pid = appPid;
  const child = { pid: appPid, kill: () => { try { spawn(psExe, ['-NoProfile', '-Command', 'Stop-Process -Id ' + appPid + ' -Force -ErrorAction SilentlyContinue'], { stdio: 'ignore', windowsHide: true }); } catch (e) {} } };

  const deadline = Date.now() + TOTAL_TIMEOUT;
  let target = null;
  try {
    // 等 CDP 端口起来并拿到页面 target
    while (Date.now() < deadline && !target) {
      await sleep(700);
      const tabs = await listTargets();
      if (tabs && tabs.length) target = tabs.find((t) => t.type === 'page' && /index\.html|app\.html|^file:/.test(t.url || '')) || tabs.find((t) => t.type === 'page') || tabs[0];
    }
    if (!target) { out.errors.push('CDP 未在超时内拿到页面 target（窗口可能没起来）'); return finish(); }
    out.targetUrl = target.url;

    const r = await cdpEval(target.webSocketDebuggerUrl, ASSERT_EXPR, 9000);
    if (r.evalErr) out.errors.push('断言表达式执行异常：' + r.evalErr);
    const d = r.value || {};
    out.dom = d;
    // 白屏 / 脚本崩：核心函数缺失或正文过短
    if (d.missing && d.missing.length) out.errors.push('核心函数未加载：' + d.missing.join(',') + '（疑似脚本崩溃/白屏，preload 与页面世界冲突这类问题会在此暴露）');
    if (!d.hasMain) out.errors.push('缺少主内容容器 #main');
    if ((d.body || 0) < 300) out.errors.push('页面正文过短（' + (d.body || 0) + ' 字，疑似白屏）');
    if (d.cfgErr) out.errors.push('issueRemoteCfg() 抛异常：' + d.cfgErr);
    if (d.store) {
      /* 商店变体：上报默认关、地址空、直播入口隐藏 */
      if (d.enabled !== false) out.errors.push('商店变体上报应默认关（enabled=' + d.enabled + '）');
      if (d.url) out.errors.push('商店变体不应预置上报地址（url=' + d.url + '）');
      if (d.navLiveHidden !== true) out.errors.push('商店变体直播导航应隐藏');
    } else {
      if (!d.url) out.errors.push('上报地址未预置（issueRemoteCfg().url 为空，客户版回收链路断）');
    }
    // 真窗口必须无未捕获异常（browser 模式漏掉的正是这类）
    for (const e of r.exceptions) out.errors.push('Uncaught: ' + e);
    out.checks = ['正文 ' + (d.body || 0) + ' 字', '#main ' + (d.hasMain ? '有' : '无'),
      '核心函数 ' + (d.fns || []).length + '/3', '上报地址 ' + (d.url ? '已预置' : '空'),
      'enabled=' + d.enabled, 'khDeviceIdBridge=' + d.bridge, 'KH_UI_CLEAN=' + d.clean,
      'data-act ' + (d.acts || 0) + '（空态卡 ' + (d.emptyCards || 0) + '）', 'Uncaught ' + r.exceptions.length + ' 个'];
    out.consoleErrors = r.consoleErrors.slice(0, 10);
  } catch (e) {
    out.errors.push('冒烟执行异常：' + e.message);
  } finally {
    try { child.kill(); } catch (e) { /* 已退出 */ }
    await sleep(1500); // 等进程释放文件句柄再清理
    for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 占用中可忽略 */ } }
  }
  finish();

  function finish() {
    for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 占用中可忽略 */ } }
    out.ok = out.errors.length === 0;
    try { fs.mkdirSync(DIST, { recursive: true }); fs.writeFileSync(REPORT, JSON.stringify(out, null, 2)); } catch (e) { /* 写报告失败不影响判定 */ }
    console.log('=== 真窗口冒烟（' + out.mode + '）===');
    for (const c of out.checks) console.log('  [检查] ' + c);
    for (const e of out.errors) console.error('  [失败] ' + e);
    console.log(out.ok ? '真窗口冒烟通过' : '真窗口冒烟未通过（' + out.errors.length + ' 项）');
    process.exit(out.ok ? 0 : 1);
  }
})();