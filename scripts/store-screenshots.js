#!/usr/bin/env node
'use strict';
/* 1.7.110 商店版上架截图：真启 store 免安装包 → CDP 切视图 → Page.captureScreenshot。
   产出 3 张代表图（本地库首页 / 我的资源 / 隐私声明弹窗）到桌面商店版夹 screenshots/。
   纯 Node 零依赖（Node 22 内置 WebSocket）。全新 user-data-dir，不碰用户配置。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const VER = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const SEVEN = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const ZIP = path.join(ROOT, 'dist', 'client', '鸿汇影免安装 ' + VER + '-store.zip');
const OUTDIR = path.join(os.homedir(), 'Desktop', '鸿汇影·商店版_v' + VER, 'screenshots');
const PORT = 9600 + Math.floor(Math.random() * 200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUTDIR, { recursive: true });

function largestExe(dir) {
  let best = null;
  const walk = (d, depth) => {
    if (depth > 3) return;
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.exe$/i.test(e.name)) { try { const s = fs.statSync(p).size; if (s > 50 * 1024 * 1024 && (!best || s > best.size)) best = { p, size: s }; } catch (e2) {} }
    }
  };
  walk(dir, 0); return best && best.p;
}
function getJson(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve([]); } }); })
      .on('error', () => resolve(null)).on('timeout', function () { this.destroy(); resolve(null); });
  });
}
function shot(wsUrl, setupExpr, file) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
    const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
    const timer = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('CDP 超时')); }, 30000);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || {}); pending.delete(m.id); } };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('WS 失败')); };
    ws.onopen = async () => {
      try {
        await send('Page.enable'); await send('Runtime.enable');
        await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
        await sleep(2500);
        await send('Runtime.evaluate', { expression: setupExpr, returnByValue: true });
        await sleep(900);
        const r = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        clearTimeout(timer); try { ws.close(); } catch (e) {}
        console.log('  截图 ' + path.basename(file) + ' · ' + fs.statSync(file).size + ' B');
        resolve();
      } catch (e) { clearTimeout(timer); try { ws.close(); } catch (e2) {} reject(e); }
    };
  });
}
const consent = "try{localStorage.setItem('kh_store_privacy_v1',JSON.stringify({agreed:true,at:new Date().toISOString(),ver:'1.7.109'}));}catch(e){} var o=document.getElementById('__kh_privacy'); if(o)o.parentNode.removeChild(o);";
const shots = [
  { name: '01-本地库首页.png', expr: consent + " try{state.view='home';render();}catch(e){}" },
  { name: '02-我的资源.png', expr: consent + " try{state.view='resources';render();}catch(e){}" },
  { name: '03-隐私声明弹窗.png', expr: "try{khStorePrivacyShow(true);}catch(e){}" },
];
(async () => {
  if (!fs.existsSync(ZIP)) { console.error('store zip 不存在：' + ZIP); process.exit(1); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-shot-'));
  const r = spawnSync(SEVEN, ['x', '-y', '-o' + tmp, ZIP], { stdio: 'ignore' });
  if (r.status !== 0) { console.error('解压失败'); process.exit(1); }
  const exe = largestExe(tmp);
  if (!exe) { console.error('未找到 exe'); process.exit(1); }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-shot-prof-'));
  const pidFile = path.join(os.tmpdir(), 'kh-shot-pid-' + PORT + '.txt');
  const launcher = path.join(os.tmpdir(), 'kh-shot-launch-' + PORT + '.ps1');
  const psExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = "$ErrorActionPreference='Stop'\r\n$p = Start-Process -FilePath '" + exe + "' -ArgumentList '--remote-debugging-port=" + PORT + "','--user-data-dir=" + profile + "','--no-first-run','--disable-gpu' -PassThru\r\n[System.IO.File]::WriteAllText('" + pidFile + "', [string]$p.Id)\r\n";
  fs.writeFileSync(launcher, '\uFEFF' + script, 'utf8');
  spawnSync(psExe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const list = await getJson('http://127.0.0.1:' + PORT + '/json/list');
    if (list && list.length) { const pg = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (pg) { wsUrl = pg.webSocketDebuggerUrl; break; } }
  }
  if (!wsUrl) { console.error('CDP 未就绪'); cleanup(); process.exit(1); }
  let fail = 0;
  for (const s of shots) { try { await shot(wsUrl, s.expr, path.join(OUTDIR, s.name)); } catch (e) { console.error('  失败 ' + s.name + ': ' + e.message); fail++; } }
  cleanup();
  function cleanup() {
    try { const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10); if (pid) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  console.log(fail === 0 ? '截图全部完成 → ' + OUTDIR : '部分失败 ' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();