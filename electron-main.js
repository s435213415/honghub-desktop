/**
 * 鸿汇影桌面版 · Electron 入口
 * --------------------------------------------------------------
 * 双击 .exe 后：自动拉起本地服务，再用内置窗口加载本地中枢。
 * 纯零依赖服务，无需联网即可运行；默认只指向本机服务，不向任何第三方发送数据。
 *
 * 无托盘：关闭窗口即彻底退出（连本地服务一起关），不留后台。
 * 全中文：窗口标题、应用菜单均为中文。
 * 端口自愈：8787 被别的程序占用时自动顺延；已有本应用中枢则直接复用；
 *           内置服务意外退出时自动重启（封顶 3 次）并重载页面。
 *
 * 本地打包：npm install 后 npm run pack。
 */
const { app, BrowserWindow, Menu, ipcMain, screen, shell, Notification, Tray, nativeImage, globalShortcut, session, dialog, clipboard } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const os = require('os');
const dgram = require('dgram');
const path = require('path');
const fs = require('fs');

const APP_TITLE = '鸿汇影桌面版';
const HUB_ID = 'HongHub-Desktop';
const BASE_PORT = 8787;
const MAX_RESTARTS = 3;
/* 可用空间低于该阈值在诊断 / 错误页提示紧张（完整包约 77MB，另需留缓存与历史余量） */
const DISK_MIN_BYTES = 200 * 1024 * 1024;
let HUB_PORT = BASE_PORT;
let pageDeviceId = '';   // 页面匿名 ID（前端 kh_issue_devid），崩溃上报与页面错误共用

/* 兼容兜底（#62/#64）：部分老显卡 / 集显机器上 Chromium 硬件加速会出现花屏、黑屏、
   渲染进程反复崩溃。提供一条不依赖界面的本机退路：环境变量 KH_DISABLE_GPU=1，
   或程序目录 / 数据目录下放一个 soft-gpu.flag 空文件，启动即关闭硬件加速走软渲染。
   注意：disableHardwareAcceleration 必须在 app ready 之前调用才生效。 */
function flagFileExists(name) {
  try {
    const dirs = [path.dirname(process.execPath), __dirname];
    for (const d of dirs) {
      if (fs.existsSync(path.join(d, name))) return true;
    }
  } catch (e) { /* 忽略 */ }
  return false;
}
const KH_DISABLE_GPU = process.env.KH_DISABLE_GPU === '1' || flagFileExists('soft-gpu.flag');
if (KH_DISABLE_GPU) {
  try { app.disableHardwareAcceleration(); } catch (e) { /* 忽略 */ }
  console.log('[兼容] 已按本机开关关闭硬件加速（软渲染模式）');
}

/* Windows 应用身份（AUMID）：必须与 package.json build.appId 一致。
   作用：通知（Toast）归属与图标、任务栏分组、跳转列表、固定到开始菜单后的身份识别，
   全部按 AUMID 去匹配注册的快捷方式。不设置时通知会变成匿名来源、图标可能空白或归错分组。
   必须在 app ready 之前调用。 */
try { app.setAppUserModelId('com.honghub.desktop'); } catch (e) { /* 非 Windows 平台忽略 */ }

/* 数据目录可写探测：安装目录 / userData 不可写时，收藏、历史、设置都无法落盘。
   启动时写一个临时探针文件，结果带进给错误页与诊断，避免用户在使用中才发现存不住。 */
function probeWritable(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.kh-write-probe.tmp');
    fs.writeFileSync(probe, String(Date.now()), 'utf8');
    fs.unlinkSync(probe);
    return { ok: true, dir: dir };
  } catch (e) {
    return { ok: false, dir: dir, msg: String(e && e.message || e).slice(0, 120) };
  }
}
/* 数据目录所在盘可用空间（字节）；拿不到返回 null，不阻断启动 */
function diskFreeBytes(dir) {
  try {
    if (typeof fs.statfsSync !== 'function') return null;
    const s = fs.statfsSync(dir);
    const free = s.bytesFree !== undefined ? s.bytesFree : (Number(s.bavail) * Number(s.bsize));
    return Number(free) > 0 ? Number(free) : null;
  } catch (e) { return null; }
}
/* 崩溃 / 异常本机落盘（#95）：渲染进程退出、页面无响应、主进程未捕获异常 /
   Promise  rejection、子进程（GPU 等）退出，先写本机 crash-log.json，再尝试远端上报。
   离线或中枢未起时记录不丢；只存事件类型与原因摘要，不含堆栈与用户数据。 */
const CRASH_LOG_MAX = 50;
function crashLogPath() { return path.join(app.getPath('userData'), 'crash-log.json'); }
function readCrashLog() {
  try {
    const p = crashLogPath();
    if (!fs.existsSync(p)) return [];
    const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function recordCrash(kind, reason) {
  const rec = { ts: Date.now(), kind: String(kind || 'crash'), reason: String(reason || 'unknown').slice(0, 120), n: 1 };
  try {
    const list = readCrashLog();
    const hit = list.find((x) => x.kind === rec.kind && x.reason === rec.reason);
    if (hit) { hit.n = (hit.n || 1) + 1; hit.ts = rec.ts; } else { list.unshift(rec); }
    if (list.length > CRASH_LOG_MAX) list.length = CRASH_LOG_MAX;
    fs.writeFileSync(crashLogPath(), JSON.stringify(list), 'utf8');
  } catch (e) { /* 目录不可写时静默，不影响崩溃恢复流程 */ }
  try { setCrashFlag(kind, reason); } catch (e) {}
  return rec;
}
/* 主进程未捕获异常 / 未处理 rejection：落本机崩溃日志，避免白屏后无迹可查；
   不在异常态强行发网络请求，交由既有崩溃自恢复与下次启动诊断呈现。 */
process.on('uncaughtException', (err) => {
  console.error('[主进程] 未捕获异常：', err && err.message);
  recordCrash('main-exception', err && err.message ? err.message : String(err));
});
process.on('unhandledRejection', (reason) => {
  console.error('[主进程] 未处理 Promise 拒绝：', reason);
  recordCrash('main-rejection', reason && reason.message ? reason.message : String(reason));
});
/* 窗口位置 / 尺寸记忆（#96）：关闭时存 userData/window-bounds.json，下次启动恢复；
   多显示器拔插后 bounds 可能落在屏外，校验并回收到可用屏幕内。 */
function boundsFile() { return path.join(app.getPath('userData'), 'window-bounds.json'); }
function readSavedBounds() {
  try {
    const p = boundsFile();
    if (!fs.existsSync(p)) return null;
    const b = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!b || typeof b.width !== 'number' || typeof b.height !== 'number') return null;
    return b;
  } catch (e) { return null; }
}
function saveBounds(win) {
  try {
    fs.writeFileSync(boundsFile(), JSON.stringify({ ...win.getBounds(), maximized: win.isMaximized() }), 'utf8');
  } catch (e) { /* 不可写则忽略，不影响退出 */ }
}
function clampToDisplay(b) {
  try {
    const wa = screen.getDisplayMatching(b).workArea;
    const w = Math.min(b.width, wa.width), h = Math.min(b.height, wa.height);
    let x = b.x, y = b.y;
    if (x < wa.x) x = wa.x;
    if (y < wa.y) y = wa.y;
    if (x + w > wa.x + wa.width) x = wa.x + wa.width - w;
    if (y + h > wa.y + wa.height) y = wa.y + wa.height - h;
    return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
  } catch (e) { return b; }
}
/* 异常退出标记（#96）：崩溃 / 未捕获异常时写 flag，下次启动提示「上次非正常退出」；
   正常退出（before-quit / window-all-closed）清除标记。 */
function crashFlagFile() { return path.join(app.getPath('userData'), 'crash-flag.json'); }
function setCrashFlag(kind, reason) {
  try { fs.writeFileSync(crashFlagFile(), JSON.stringify({ ts: Date.now(), kind: String(kind || 'crash'), reason: String(reason || '').slice(0, 120) }), 'utf8'); } catch (e) {}
}
function clearCrashFlag() { try { if (fs.existsSync(crashFlagFile())) fs.unlinkSync(crashFlagFile()); } catch (e) {} }
function readCrashFlag() {
  try { const p = crashFlagFile(); if (!fs.existsSync(p)) return null; return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}
/* 系统版本画像：Electron 30 内核仅支持 Win10 及以上；旧 NT 单独标注，便于诊断与引导在线版 */
function sysProfile() {
  const platform = String(process.platform || '');
  let sysVersion = 'unknown', oldSystem = false;
  try {
    sysVersion = String(process.getSystemVersion ? process.getSystemVersion() : '' || 'unknown');
    if (platform === 'win32') {
      const major = parseInt(String(sysVersion).split('.')[0], 10);
      if (isFinite(major) && major < 10) oldSystem = true;
    }
  } catch (e) { /* 保留默认值 */ }
  return { platform, sysVersion, oldSystem };
}
let writeProbe = null;
let diskFree = null;
const sysProf = sysProfile();
/* 开发端构建（KH_DEV_MODE=1）：额外开放「运维看板」入口与发布/自治类接口。
   客户成品不带这个开关，首页固定是影视页，运维看板不存在。
   免安装版没有环境变量可设，因此额外认两种本机开关：启动参数 --dev、程序目录下的 dev-mode.flag。 */
/* 构建期客户版硬开关：默认 false（开发端）。打包客户 exe 时由 scripts/build-client-exe.js
   改为 true——客户版从此不再认 dev-mode.flag / --dev，物理上无法切到运维面板。 */
const CLIENT_ONLY = false; // KH_BUILD_CLIENT_ONLY
/* 1.7.83：开发端开箱即开发模式。以前开发端装完必须先跑「安装后转开发端.cmd」写
   dev-mode.flag，否则打开是影视页、运维台进不去——这不是开发者想要的默认。
   现在的判定顺序：
     1) KH_DEV_MODE=0 或启动参数 --client → 强制客户界面（开发端自测客户端行为用）
     2) KH_DEV_MODE=1 或启动参数 --dev → 开发模式
     3) 其余（开发端构建）→ 默认开发模式；客户版由 CLIENT_ONLY 物理锁死在 false
   旧的 dev-mode.flag 仍然兼容，删掉它也不会再把开发端打回影视页。 */
const DEV_BUILD = !CLIENT_ONLY && (() => {
  if (process.env.KH_DEV_MODE === '0' || process.argv.indexOf('--client') >= 0) return false;
  if (process.env.KH_DEV_MODE === '1' || process.argv.indexOf('--dev') >= 0) return true;
  return true;
})();
/* 客户成品加载的页面：明确指向影视页 /index.html，而不是服务根路径
   （根路径过去返回运维看板，客户点开看到的是运维界面，属于入口错位）。
   开发端反过来：打开就是运维面板 /admin，影视页留在菜单里随时切。 */
const PAGE_PATH = DEV_BUILD ? '/admin' : '/index.html';
const PAGE_MOVIE = '/index.html';

/* 开发端桌面窗口直接带本机口令打开 /admin，避免首屏弹 prompt 要手点确定。
   页面里的引导脚本会读 URL 的 token 写入 localStorage（server.js 已实现）。
   读不到口令时保持 /admin 原样，页面仍会自动从 /api/dev/access-token 取。 */
function adminPath() {
  if (!DEV_BUILD) return PAGE_PATH;
  try {
    const tokenFile = path.join(__dirname, 'server', 'data', 'access-token.txt');
    const tok = fs.readFileSync(tokenFile, 'utf8').trim();
    return tok ? '/admin?token=' + encodeURIComponent(tok) : PAGE_PATH;
  } catch (e) { return PAGE_PATH; }
}

// 应用名（影响窗口/任务栏默认名称）设为中文
app.setName(APP_TITLE);

let serverProc = null;

/* 1.7.104：局域网访问开关（默认关闭，仅绑 127.0.0.1）。
   开启后内置中枢绑 0.0.0.0，由 server.js 自动要求访问口令；开关状态落在 userData/lan-mode.json。 */
let LAN_MODE = null;
function lanFile(){ try{ return path.join(app.getPath('userData'), 'lan-mode.json'); }catch(e){ return ''; } }
function lanLoad(){
  if (LAN_MODE !== null) return LAN_MODE;
  LAN_MODE = false;
  try{
    const f = lanFile();
    if (f && require('fs').existsSync(f)) {
      const j = JSON.parse(require('fs').readFileSync(f, 'utf8'));
      LAN_MODE = !!j.lan;
    }
  }catch(e){}
  return LAN_MODE;
}
let mainWin = null;
let tray = null;
let quitting = false;
let reusing = false;   // 复用已有中枢：不再 spawn，也不做自愈
let restarts = 0;

// 单实例锁：重复双击只唤回已开窗口，绝不多开（避免实例堆积、抢端口、卡死）
// 开发端用自己的数据目录：单实例锁按用户数据目录区分，否则开发端与客户端会互相顶掉——
// 开发端在跑时双击客户端，客户端实例直接退出、弹出的是运维面板（这就是"客户端看到开发端"）。
if (DEV_BUILD) {
  try { app.setPath('userData', path.join(app.getPath('appData'), 'HongHub-Desktop-Dev')); } catch (e) { /* 不影响启动 */ }
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
    }
  });
}

// 开机自启（P2-B16）：渲染进程经 preload 桥读写系统登录项；只暴露这一项本机能力。
// 非 Electron 环境（纯网页 / HAP）不会有这些 handler，前端隐藏开关。
ipcMain.handle('kh:autostart-get', () => {
  try { return !!app.getLoginItemSettings().openAtLogin; } catch (e) { return false; }
});
ipcMain.handle('kh:autostart-set', (ev, open) => {
  try {
    app.setLoginItemSettings({ openAtLogin: !!open, path: process.execPath, args: [] });
    return { ok: true, open: !!app.getLoginItemSettings().openAtLogin };
  } catch (e) {
    return { ok: false, open: false, msg: String(e && e.message || e).slice(0, 120) };
  }
});

// 影视仓解析器代理：主进程发请求，绕开渲染进程的跨域限制（第三方站点几乎都不给 CORS）
// 只做「按用户给的地址取一份文本」，不缓存、不代抓片源、不带任何内置地址。
ipcMain.handle('kh:http-get', async (event, arg) => {
  const a = (arg && typeof arg === 'object') ? arg : {};
  const url = String(a.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: '地址需以 http(s):// 开头' };
  const timeout = Math.min(Math.max(Number(a.timeout) || 15000, 3000), 30000);
  const headers = (a.headers && typeof a.headers === 'object') ? a.headers : {};
  const ctl = ('AbortController' in globalThis) ? new AbortController() : null;
  const timer = setTimeout(() => { try { if (ctl) ctl.abort(); } catch (e) {} }, timeout);
  try {
    const r = await fetch(url, { signal: ctl ? ctl.signal : undefined, redirect: 'follow', headers });
    /* 1.7.85：仓配置等场景要按 GBK/UTF-8 智能解码，返回二进制 base64 给渲染层；
       普通请求仍走 text()，保持既有调用方不变。 */
    if (a.binary === true) {
      const buf = Buffer.from(await r.arrayBuffer());
      return { ok: r.ok, status: r.status, base64: buf.toString('base64'), via: 'main' };
    }
    const text = await r.text();
    return { ok: r.ok, status: r.status, text: String(text).slice(0, 3000000), via: 'main' };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e || '网络失败').slice(0, 120), via: 'main' };
  } finally {
    clearTimeout(timer);
  }
});

// 环境兜底信息（#62）：关闭硬件加速状态、数据目录可写探测、端口是否耗尽，供诊断报告如实标注
ipcMain.handle('kh:env-info', () => {
  return {
    disableGpu: !!KH_DISABLE_GPU,
    writeOk: writeProbe ? !!writeProbe.ok : null,
    writeDir: writeProbe ? writeProbe.dir : '',
    writeMsg: writeProbe && !writeProbe.ok ? writeProbe.msg : '',
    portsExhausted: !!portsExhausted,
    dev: DEV_BUILD,
    diskFreeBytes: diskFree == null ? null : diskFree,
    diskOk: diskFree == null ? null : diskFree >= DISK_MIN_BYTES,
    platform: sysProf.platform,
    sysVersion: sysProf.sysVersion,
    oldSystem: !!sysProf.oldSystem,
    /* 1.7.103：VC++ 运行库探测（只读 System32 里三个 dll 的存在性，不做任何安装动作） */
    vcRuntime: (function(){
      try{
        const fs2 = require('fs'), path2 = require('path');
        const sys2 = process.env.SystemRoot || 'C:\\Windows';
        const dir2 = path2.join(sys2, 'System32');
        const need = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];
        const missing = need.filter(n => { try { return !fs2.existsSync(path2.join(dir2, n)); } catch(e){ return false; } });
        return { ok: missing.length === 0, missing: missing };
      }catch(e){ return null; }
    })()
  };
});

/* 本机崩溃 / 异常日志（#95）：只读返回最近记录，供诊断报告并入；不含堆栈与用户数据 */
/* 页面匿名 ID（1.7.85）：前端首次生成时同步过来，崩溃上报不再固定 desktop-main */
/* 1.7.104：局域网访问开关（默认关）。开启后重启内置服务让绑定生效，然后重载页面。 */
ipcMain.handle('kh:lan-mode', async (e, arg) => {
  const cur = lanLoad();
  if (!arg || typeof arg.set !== 'boolean') {
    return { ok: true, lan: cur, host: cur ? '0.0.0.0' : '127.0.0.1' };
  }
  const want = !!arg.set;
  if (want === cur) return { ok: true, lan: cur, host: cur ? '0.0.0.0' : '127.0.0.1' };
  LAN_MODE = want;
  try{
    const f = lanFile();
    if (f) require('fs').writeFileSync(f, JSON.stringify({ lan: want }));
  }catch(err){ console.error('[局域网] 写配置失败', err && err.message); }
  try{
    if (serverProc) {
      serverProc.removeAllListeners('exit');
      try { serverProc.kill(); } catch(e2){}
    }
  }catch(e2){}
  serverProc = null; reusing = false; restarts = 0;
  try{
    await pickPort();
    startServer();
    if (mainWin && !mainWin.isDestroyed()) setTimeout(() => { try { mainWin.reload(); } catch(e3){} }, 1400);
  }catch(e3){
    return { ok: false, lan: cur, host: '', msg: '重启内置服务失败：' + ((e3 && e3.message) || e3) };
  }
  return { ok: true, lan: want, host: want ? '0.0.0.0' : '127.0.0.1' };
});

ipcMain.handle('kh:device-id-set', (e, id) => {
  const v = String(id || '').trim().slice(0, 40);
  if (v) pageDeviceId = v;
  return { ok: true, deviceId: pageDeviceId || 'desktop-main' };
});

ipcMain.handle('kh:crash-log', () => {
  try { return readCrashLog().slice(0, 30); } catch (e) { return []; }
});

/* 启动状态（#96）：返回上次是否非正常退出（崩溃标记），前端据此提示并引导诊断报告 */
ipcMain.handle('kh:startup-state', () => {
  try { return { lastCrash: readCrashFlag() }; } catch (e) { return { lastCrash: null }; }
});

/* ---------------- B 档本机能力（1.7.91 · 台账 #167） ----------------
   #31 字幕目录扫描 / #39 通知策略 / #40 自定义快捷键 / #52 外部播放器路径与参数 /
   #53 窗口置顶与画中画，都要主进程参与。配置统一落 userData/kh-b8.json，
   前端保存时整体推送（kh:b8-set），重启仍生效；纯网页 / HAP 无此桥，前端按不支持处理。 */
const B8_FILE = path.join(app.getPath('userData'), 'kh-b8.json');
let b8 = { hotkeys: {}, player: { exe: '', args: '' }, notify: 'all', sound: true, top: false, closeAct: 'tray' };
(function b8Load() {
  try {
    const j = JSON.parse(fs.readFileSync(B8_FILE, 'utf8'));
    if (j && typeof j === 'object') {
      b8.hotkeys = (j.hotkeys && typeof j.hotkeys === 'object') ? j.hotkeys : {};
      b8.player = { exe: String((j.player && j.player.exe) || ''), args: String((j.player && j.player.args) || '') };
      b8.notify = ['all', 'download', 'off'].indexOf(String(j.notify)) >= 0 ? String(j.notify) : 'all';
      b8.sound = j.sound === undefined ? true : !!j.sound;
      b8.top = !!j.top;
      b8.closeAct = ['tray', 'quit', 'min'].indexOf(String(j.closeAct)) >= 0 ? String(j.closeAct) : 'tray';
      b8.trayBalloonShown = !!j.trayBalloonShown;
    }
  } catch (e) { /* 首次启动没有配置文件，用默认值 */ }
})();
function b8Write() {
  try { fs.mkdirSync(path.dirname(B8_FILE), { recursive: true }); fs.writeFileSync(B8_FILE, JSON.stringify(b8, null, 2), 'utf8'); } catch (e) {}
  b8Broadcast();
}
/* 1.7.94 #75 跨进程一致：b8（快捷键 / 外部播放器 / 通知 / 置顶 / 关窗口）有改动就广播给所有窗口，
   另一处（另开的窗口、托盘菜单、主进程自身如托盘置顶切换）改了也立刻反映到界面，不用重启。 */
function b8Broadcast() {
  try {
    const wins = BrowserWindow.getAllWindows();
    for (const w of wins) {
      if (!w || w.isDestroyed()) continue;
      try { w.webContents.send('kh:b8-changed', { b8: b8, at: new Date().toISOString() }); } catch (e) {}
    }
  } catch (e) {}
}
/* 1.7.94 #37 IPv4/IPv6 与自定义 DNS：界面把选择写进 kh-net.json，这里在进程启动早期读，
   mode=ipv4 时追加 --disable-ipv6（重启后生效）。自定义 DNS 只记录：Windows 解析器由系统
   控制，主进程没有正当手段替用户改全局 DNS，界面里也如实写明，不假装已切换。 */
const NET_FILE = path.join(app.getPath('userData'), 'kh-net.json');
let netCfg = { mode: 'auto', dns: [] };
(function () {
  try {
    const j = JSON.parse(fs.readFileSync(NET_FILE, 'utf8'));
    if (j && typeof j === 'object') {
      netCfg.mode = (j.mode === 'ipv4' || j.mode === 'ipv6') ? j.mode : 'auto';
      netCfg.dns = Array.isArray(j.dns) ? j.dns.filter((x) => typeof x === 'string' && x).slice(0, 3) : [];
    }
  } catch (e) { /* 首次启动没有文件 */ }
  if (netCfg.mode === 'ipv4') { try { app.commandLine.appendSwitch('disable-ipv6'); } catch (e) {} }
})();
ipcMain.handle('kh:b8-net-get', () => ({ ok: true, net: netCfg, applied: { disableIpv6: netCfg.mode === 'ipv4' } }));
ipcMain.handle('kh:b8-net-set', (ev, arg) => {
  const a = (arg && typeof arg === 'object') ? arg : {};
  const mode = (a.mode === 'ipv4' || a.mode === 'ipv6') ? a.mode : 'auto';
  const dns = Array.isArray(a.dns) ? a.dns.filter((x) => typeof x === 'string' && x).slice(0, 3) : [];
  netCfg = { mode: mode, dns: dns, at: new Date().toISOString() };
  try {
    fs.mkdirSync(path.dirname(NET_FILE), { recursive: true });
    fs.writeFileSync(NET_FILE, JSON.stringify(netCfg, null, 2), 'utf8');
  } catch (e) { return { ok: false, reason: '写入 kh-net.json 失败：' + String((e && e.message) || e) }; }
  return { ok: true, net: netCfg, restart: mode !== 'auto' };
});
const B8_ACTIONS = ['toggle', 'next', 'prev', 'mute', 'top'];
function b8RegisterHotkeys() {
  const out = { ok: true, registered: [], conflicts: [] };
  try { globalShortcut.unregisterAll(); } catch (e) {}
  const hk = b8.hotkeys || {};
  const plan = [];
  for (const a of B8_ACTIONS) {
    const acc = String(hk[a] || '').trim();
    if (acc) plan.push({ action: a, accel: acc });
  }
  // 用户没自定义播放键时保留媒体键默认，避免"自定义之后媒体键失效"
  if (!plan.some((p) => p.action === 'toggle')) plan.unshift({ action: 'toggle', accel: 'MediaPlayPause' });
  const seen = new Set();
  for (const p of plan) {
    if (seen.has(p.accel)) { out.conflicts.push(p); continue; }
    seen.add(p.accel);
    let okReg = false;
    try {
      okReg = globalShortcut.register(p.accel, () => {
        if (!mainWin || mainWin.isDestroyed()) return;
        if (p.action === 'top') { b8.top = !b8.top; mainWin.setAlwaysOnTop(b8.top, b8.top ? 'floating' : 'normal'); b8Write(); }
        mainWin.webContents.send('kh:shortcut', p.action);
      });
    } catch (e) { okReg = false; }
    if (okReg) out.registered.push(p); else out.conflicts.push(p);
  }
  if (out.conflicts.length) out.ok = false;
  return out;
}
ipcMain.handle('kh:b8-get', () => ({ ok: true, b8: b8, platform: process.platform }));
ipcMain.handle('kh:b8-set', (ev, arg) => {
  const a = (arg && typeof arg === 'object') ? arg : {};
  try {
    if (a.hotkeys && typeof a.hotkeys === 'object') {
      const hk = {};
      for (const k of B8_ACTIONS) hk[k] = String(a.hotkeys[k] || '').trim();
      b8.hotkeys = hk;
    }
    if (a.player && typeof a.player === 'object') {
      b8.player = { exe: String(a.player.exe || ''), args: String(a.player.args || '') };
    }
    if (a.notify) {
      const n = String(a.notify);
      b8.notify = ['all', 'download', 'off'].indexOf(n) >= 0 ? n : 'all';
    }
    if (typeof a.sound === 'boolean') b8.sound = a.sound;
    /* 1.7.93 #54：关闭行为 tray / quit / min */
    if (a.closeAct) {
      const ca = String(a.closeAct);
      b8.closeAct = ['tray', 'quit', 'min'].indexOf(ca) >= 0 ? ca : b8.closeAct;
    }
    if (typeof a.top === 'boolean') {
      b8.top = a.top;
      if (mainWin && !mainWin.isDestroyed()) mainWin.setAlwaysOnTop(a.top, a.top ? 'floating' : 'normal');
    }
    b8Write();
    const reg = b8RegisterHotkeys();
    return { ok: true, hotkeys: reg, player: b8.player, notify: b8.notify, sound: b8.sound, top: b8.top, closeAct: b8.closeAct };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e).slice(0, 120) }; }
});
ipcMain.handle('kh:b8-pick', async (ev, arg) => {
  const kind = String((arg && arg.kind) || 'exe');
  try {
    const r = await dialog.showOpenDialog(mainWin && !mainWin.isDestroyed() ? mainWin : undefined, kind === 'dir'
      ? { title: '选择字幕所在文件夹', properties: ['openDirectory'] }
      : { title: '选择外部播放器', properties: ['openFile'], filters: [{ name: '可执行文件', extensions: ['exe'] }] });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: r.filePaths[0] };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e).slice(0, 120) }; }
});
ipcMain.handle('kh:b8-subs', (ev, arg) => {
  const dir = String((arg && arg.dir) || '');
  if (!dir) return { ok: false, reason: '未设置字幕目录' };
  try {
    if (!fs.existsSync(dir)) return { ok: false, reason: '目录不存在' };
    if (!fs.statSync(dir).isDirectory()) return { ok: false, reason: '不是目录' };
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      if (!/\.(srt|ass|ssa|vtt)$/i.test(name)) continue;
      let sz = 0;
      try { const st = fs.statSync(path.join(dir, name)); if (!st.isFile() || st.size > 8 * 1024 * 1024) continue; sz = st.size; } catch (e) { continue; }
      out.push({ name: name, path: path.join(dir, name), size: sz });
      if (out.length >= 500) break;
    }
    return { ok: true, dir: dir, files: out };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e).slice(0, 120) }; }
});
/* 1.7.94 #78 皮肤包：读取「外部主题目录」里的 *.json（每个 ≤64KB，最多 64 个），
   前端拿到文本自己校验与入库；这里绝不解析样式，只搬文件内容。 */
ipcMain.handle('kh:b8-themes', (ev, arg) => {
  const dir = String((arg && arg.dir) || '');
  if (!dir) return { ok: false, reason: '未选择主题目录' };
  try {
    if (!fs.existsSync(dir)) return { ok: false, reason: '目录不存在' };
    if (!fs.statSync(dir).isDirectory()) return { ok: false, reason: '不是目录' };
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      if (!/\.json$/i.test(name)) continue;
      const fp = path.join(dir, name);
      let okFile = false;
      try { const st = fs.statSync(fp); okFile = st.isFile() && st.size <= 64 * 1024; } catch (e) { okFile = false; }
      if (!okFile) continue;
      try { out.push({ name: name, text: fs.readFileSync(fp, 'utf8') }); } catch (e) { continue; }
      if (out.length >= 64) break;
    }
    return { ok: true, dir: dir, files: out };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e).slice(0, 120) }; }
});
ipcMain.handle('kh:b8-sub-read', (ev, arg) => {
  const p = String((arg && arg.path) || '');
  if (!p || !fs.existsSync(p)) return { ok: false, reason: '文件不存在' };
  try {
    let text = fs.readFileSync(p, 'utf8');
    if (/\uFFFD/.test(text.slice(0, 200))) {
      try { text = new TextDecoder('gb18030').decode(fs.readFileSync(p)); } catch (e) {}
    }
    return { ok: true, text: text.slice(0, 4 * 1024 * 1024), name: path.basename(p) };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e).slice(0, 120) }; }
});
let b8PrevBounds = null;
ipcMain.handle('kh:b8-win', (ev, arg) => {
  if (!mainWin || mainWin.isDestroyed()) return { ok: false, reason: '窗口不在' };
  const a = (arg && typeof arg === 'object') ? arg : {};
  try {
    if (typeof a.top === 'boolean') {
      b8.top = a.top;
      mainWin.setAlwaysOnTop(a.top, a.top ? 'floating' : 'normal');
      b8Write();
    }
    if (typeof a.pip === 'boolean') {
      if (a.pip) {
        if (!b8PrevBounds) b8PrevBounds = mainWin.getBounds();
        const area = screen.getPrimaryDisplay().workArea;
        mainWin.setAlwaysOnTop(true, 'floating');
        mainWin.setSize(480, 270, false);
        mainWin.setPosition(area.x + area.width - 492, area.y + area.height - 282);
      } else {
        if (b8PrevBounds) { mainWin.setBounds(b8PrevBounds); b8PrevBounds = null; }
        mainWin.setAlwaysOnTop(!!b8.top, b8.top ? 'floating' : 'normal');
      }
    }
    return { ok: true, top: b8.top, pip: !!a.pip, bounds: mainWin.getBounds() };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e).slice(0, 120) }; }
});

/* 外部播放器拉起（#109）：优先本机已装 VLC / mpv 打开片源直链；都未安装则交系统默认播放器。
   纯浏览器 / HAP 环境无此桥，前端隐藏入口；失败如实返回，不静默吞错误。 */
function findExternalPlayer() {
  const custom = String((b8.player && b8.player.exe) || '').trim();
  if (custom) { try { if (fs.existsSync(custom)) return custom; } catch (e) {} }
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432].filter(Boolean);
  for (const base of pf) {
    const vlc = path.join(base, 'VideoLAN', 'VLC', 'vlc.exe');
    const mpv = path.join(base, 'mpv', 'mpv.exe');
    try { if (fs.existsSync(vlc)) return vlc; } catch (e) {}
    try { if (fs.existsSync(mpv)) return mpv; } catch (e) {}
  }
  return null;
}
ipcMain.handle('kh:open-external', (ev, url) => {
  const target = String(url || '');
  if (!target) return { ok: false, reason: 'empty url' };
  const exe = findExternalPlayer();
  try {
    if (exe) {
      /* 1.7.91（#52）：参数模板可配，{url} 占位替换；没写占位符时把直链追加在最后，
         避免"填了参数反而打不开片"。 */
      const tpl = String((b8.player && b8.player.args) || '').trim();
      let argv = [target];
      if (tpl) {
        const toks = tpl.match(/"[^"]*"|'[^']*'|\S+/g) || [];
        argv = toks.map((x) => x.replace(/^["']|["']$/g, '').split('{url}').join(target));
        if (argv.join('\u0000').indexOf(target) < 0) argv.push(target);
      }
      spawn(exe, argv, { detached: true, stdio: 'ignore' }).unref();
      const custom = String((b8.player && b8.player.exe) || '').trim();
      const via = (custom && exe === custom) ? 'custom' : (/vlc\.exe$/i.test(exe) ? 'vlc' : 'mpv');
      return { ok: true, via: via, argv: argv };
    }
    return Promise.resolve(shell.openPath(target))
      .then((err) => ({ ok: !err, via: 'system-default', reason: err || undefined }))
      .catch((e) => ({ ok: false, reason: String(e && e.message || e).slice(0, 120) }));
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e).slice(0, 120) };
  }
});

/* 静默覆盖安装（1.7.86）：安装包已由服务端下载并校验 SHA256，这里只负责「退出自身 → /S 覆盖装到当前目录 → 重新拉起」。
   只对 Setup 安装出来的目录生效（目录里有 Uninstall*.exe）；免安装 zip 目录直接拒绝，否则会把 NSIS 解到解压目录里搞乱。
   NSIS 的 /S 是同目录覆盖，/D 必须放在最后且不能带引号。 */
ipcMain.handle('kh:install-silent', (ev, arg) => {
  const fp = String((arg && arg.file) || '');
  if (!fp || !fs.existsSync(fp)) return { ok: false, reason: '安装包不存在（可能已被清理）' };
  if (!/\.exe$/i.test(fp)) return { ok: false, reason: '安装包不是可执行文件' };
  const appDir = path.dirname(process.execPath);
  let isSetupDir = false;
  try {
    isSetupDir = fs.readdirSync(appDir).some((f) => /^Uninstall.*\.exe$/i.test(f));
  } catch (e) { isSetupDir = false; }
  if (!isSetupDir) {
    return { ok: false, reason: '当前是免安装版目录，静默覆盖安装不适用（请继续用免安装包，或改用 Setup 安装一次）' };
  }
  const exe = process.execPath;
  const cmd = 'timeout /t 3 /nobreak >nul & "' + fp + '" /S /D=' + appDir +
    ' & timeout /t 2 /nobreak >nul & start "" "' + exe + '"';
  try {
    spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e).slice(0, 120) };
  }
  setTimeout(() => { quitting = true; try { app.quit(); } catch (e) { process.exit(0); } }, 800);
  return { ok: true, dir: appDir, file: path.basename(fp) };
});

/* 客户版静默升级：状态读取 / 模式切换 / 手动检查（1.7.95 · P1-07 / P1-08）
   模式：off 不检查 · check 只提示 · download 下载并提示 · install 下载校验后静默安装（仅 Setup 目录）
   手动「立即检查」只下载不安装，避免用户只是想知道有没有新版就被重启。 */
ipcMain.handle('kh:auto-update-get', () => {
  try { return { ok: true, state: require('./client-auto-update').readState(), current: app.getVersion(), devBuild: DEV_BUILD }; }
  catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
});
ipcMain.handle('kh:auto-update-mode', (ev, arg) => {
  try {
    const mode = ['off', 'check', 'download', 'install'].indexOf(String((arg && arg.mode) || '')) >= 0
      ? String(arg.mode) : 'download';
    const m = require('./client-auto-update');
    const st = m.readState();
    st.mode = mode;
    st.attempts = 0;
    m.writeState(st);
    return { ok: true, mode: mode };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
});
ipcMain.handle('kh:auto-update-run', () => {
  try {
    return require('./client-auto-update').checkOnce({
      current: app.getVersion(),
      appDir: path.dirname(process.execPath),
      relaunch: process.execPath,
      updateDir: path.join(app.getPath('userData'), 'updates'),
      autoInstall: false
    });
  } catch (e) { return Promise.resolve({ ok: false, reason: String((e && e.message) || e) }); }
});

/* 系统通知（#109）：升级完成 / 追剧提醒等场景由前端经桥触发；不支持时如实返回。
   1.7.91（#39）：前端传第四参 kind（download / update / other），主进程按 b8.notify 策略拦截，
   这样即使前端漏过滤也不会响。 */
ipcMain.handle('kh:notify', (ev, title, body, kind) => {
  const k = String(kind || 'other');
  const pol = String(b8.notify || 'all');
  if (pol === 'off' || (pol === 'download' && !(k === 'download' || k === 'update'))) {
    return { ok: false, skipped: true, reason: 'policy:' + pol };
  }
  try {
    if (typeof Notification === 'undefined' || !Notification.isSupported()) return { ok: false, reason: 'notification unsupported' };
    new Notification({ title: String(title || '鸿汇影'), body: String(body || ''), silent: !b8.sound }).show();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e).slice(0, 120) };
  }
});

/* ---------------- 下载队列（1.7.79）：并发 / 断点续传 / 限速 / 失败重试 ----------------
   只做标准 HTTP(S) 单文件的排队下载：.part 落盘 + Range 续传 + 每文件重试 2 次。
   不解析站点协议（解析在前端 KH_SRC），不接管系统下载目录，不动用户设置。
   m3u8 / 直播流需要切片合并，明确拒绝，不假装下一份文本就是视频。 */
const DLQ_MAX = 60;
const DLQ_DIR_NAME = '鸿汇影下载';
const dlq = { items: [], seq: 0, conc: 2, limitKB: 0, running: 0, failWait: {} };
function dlqDir() {
  const base = (() => { try { return app.getPath('downloads'); } catch (e) { return app.getPath('userData'); } })();
  const d = path.join(base, DLQ_DIR_NAME);
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* 目录已存在或权限不足，后面报错 */ }
  return d;
}
function dlqFile() { return path.join(app.getPath('userData'), 'dl-queue.json'); }
function dlqSave() {
  try {
    const keep = dlq.items.filter((it) => it.state !== 'done' && it.state !== 'canceled').slice(0, DLQ_MAX);
    fs.writeFileSync(dlqFile(), JSON.stringify({ conc: dlq.conc, limitKB: dlq.limitKB, items: keep }, null, 2));
  } catch (e) { /* 落盘失败不影响当前下载 */ }
}
function dlqLoad() {
  try {
    const raw = fs.readFileSync(dlqFile(), 'utf8');
    const j = JSON.parse(raw);
    if (j && Array.isArray(j.items)) {
      dlq_items_restore(j.items);
    }
    if (j && Number(j.conc) >= 1) dlq.conc = Math.min(Math.max(Number(j.conc), 1), 4);
    if (j && Number(j.limitKB) > 0) dlq.limitKB = Number(j.limitKB);
  } catch (e) { /* 首次运行没有队列文件 */ }
}
function dlq_items_restore(items) {
  for (const it of items) {
    if (!it || !it.url) continue;
    dlq.seq = Math.max(dlq.seq, Number(it.id) || 0);
    dlq.items.push({
      id: Number(it.id) || ++dlq.seq, url: String(it.url).slice(0, 2048), name: String(it.name || '').slice(0, 120),
      dir: String(it.dir || ''), size: Number(it.size) || 0, received: Number(it.received) || 0,
      state: it.state === 'downloading' ? 'queued' : (it.state || 'queued'), tries: Number(it.tries) || 0,
      kind: it.kind || (/\.m3u8(\?|$)/i.test(String(it.url)) ? 'hls' : 'file'),
      segs: Number(it.segs) || 0, segsDone: Number(it.segsDone) || 0,
      err: '', speed: 0, addedAt: it.addedAt || Date.now()
    });
  }
}
function dlqView() {
  const items = dlq.items.map((it) => ({
    id: it.id, name: it.name, url: it.url, state: it.state, size: it.size, received: it.received,
    speed: it.speed, tries: it.tries, err: it.err, dir: it.dir,
    kind: it.kind || 'file', segs: Number(it.segs) || 0, segsDone: Number(it.segsDone) || 0
  }));
  let done = 0, failed = 0, totalBytes = 0, gotBytes = 0;
  for (const it of items) {
    if (it.state === 'done') done++;
    if (it.state === 'failed') failed++;
    totalBytes += it.size || 0; gotBytes += it.received || 0;
  }
  return { ok: true, items, conc: dlq.conc, limitKB: dlq.limitKB, dir: dlqDir(), done, failed, totalBytes, gotBytes };
}
function dlqBroadcast() {
  try {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('kh:dl-queue', dlqView());
  } catch (e) { /* 窗口已关则忽略 */ }
}
function dlqNameOf(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent((u.pathname || '').split('/').pop() || '');
    return (last || ('download-' + Date.now())).slice(0, 100);
  } catch (e) { return 'download-' + Date.now(); }
}
function dlqNext() {
  while (dlq.running < dlq.conc) {
    const it = dlq.items.find((x) => x.state === 'queued');
    if (!it) break;
    const wait = dlq.failWait[it.id] || 0;
    if (wait && Date.now() < wait) break;
    dlqStart(it);
  }
  dlqBroadcast();
}
function dlqStart(it) {
  if (it.state !== 'queued') return;
  if (it.kind === 'hls' || /\.m3u8(\?|$)/i.test(it.url)) { dlqStartHls(it); return; }
  dlq.running++;
  it.state = 'downloading'; it.err = ''; it.speed = 0;
  const full = path.join(dlqDir(), it.name);
  const part = full + '.part';
  let start = 0;
  try { if (fs.existsSync(part)) start = fs.statSync(part).size; } catch (e) { start = 0; }
  it.received = start;
  const mod = /^https:/i.test(it.url) ? https : http;
  let ws = Date.now(), wb = 0, closed = false;
  const done = (ok, reason) => {
    if (closed) return;
    closed = true;
    it._abort = null;
    try { req && req.destroy(); } catch (e) {}
    dlq.running = Math.max(0, dlq.running - 1);
    if (ok) {
      it.state = 'done'; it.err = '';
      try { fs.renameSync(part, full); } catch (e) {}
      it.dir = dlqDir();
      try {
        if (typeof Notification !== 'undefined' && Notification.isSupported()) {
          new Notification({ title: '下载完成', body: it.name }).show();
        }
      } catch (e) {}
    } else if (it.state === 'canceled' || it.state === 'paused') {
      /* 用户主动停：状态已置，不再改 */
    } else {
      it.tries = (it.tries || 0) + 1;
      it.err = String(reason || '下载失败').slice(0, 120);
      if (it.tries <= 2) {
        it.state = 'queued';
        dlq.failWait[it.id] = Date.now() + 1500 * it.tries;
      } else {
        it.state = 'failed';
      }
    }
    dlqSave();
    dlqBroadcast();
    setTimeout(dlqNext, 300);
  };
  let req = null;
  try {
    req = mod.get(it.url, {
      headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 Chrome/122' }, start > 0 ? { Range: 'bytes=' + start + '-' } : {}, it.headers || {}),
      timeout: 20000
    }, (res) => {
      if (res.statusCode === 416) { done(true); return; }
      if (res.statusCode && res.statusCode >= 400) { done(false, 'HTTP ' + res.statusCode); return; }
      if (res.statusCode === 200 && start > 0) { /* 服务端不认 Range，从头来 */ start = 0; it.received = 0; try { fs.writeFileSync(part, ''); } catch (e) {} }
      const total = Number(res.headers['content-length'] || 0);
      it.size = total ? total + start : 0;
      const out = fs.createWriteStream(part, { flags: start > 0 ? 'a' : 'w' });
      res.on('data', (chunk) => {
        out.write(chunk);
        it.received += chunk.length;
        wb += chunk.length;
        const now = Date.now();
        if (now - ws >= 700) {
          it.speed = Math.round(wb / ((now - ws) / 1000));
          ws = now; wb = 0;
          dlqBroadcast();
        }
        /* 限速：按 1 秒窗口算，超了先停流，到点再放行 */
        if (dlq.limitKB > 0) {
          const budget = dlq.limitKB * 1024;
          if (wb > budget) {
            try { res.pause(); } catch (e) {}
            setTimeout(() => { try { res.resume(); } catch (e) {} ws = Date.now(); wb = 0; }, 1000);
          }
        }
      });
      res.on('end', () => { out.end(); out.on('finish', () => done(true)); });
      res.on('error', (e) => { try { out.end(); } catch (er) {} done(false, e && e.message); });
    });
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} done(false, '连接超时'); });
    req.on('error', (e) => done(false, (e && e.message) || '网络错误'));
    it._abort = () => { try { req.destroy(); } catch (e) {} };
  } catch (e) {
    done(false, String(e && e.message || e));
  }
}
/* 单次取文本（m3u8 片单用）：失败回调错误，成功回调整段文本 */
function dlqGetText(url, headers, cb) {
  const mod = /^https:/i.test(url) ? https : http;
  let settled = false;
  const fin = (err, txt) => { if (settled) return; settled = true; cb(err, txt); };
  try {
    const req = mod.get(url, {
      headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 Chrome/122' }, headers || {}),
      timeout: 20000
    }, (res) => {
      if (res.statusCode && res.statusCode >= 400) { try { res.resume(); } catch (e) {} return fin(new Error('HTTP ' + res.statusCode)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 6 * 1024 * 1024) body += d; });
      res.on('end', () => fin(null, body));
      res.on('error', (e) => fin(e));
    });
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} fin(new Error('连接超时')); });
    req.on('error', (e) => fin(e));
  } catch (e) { fin(e); }
}
/* 解析 m3u8：取媒体片段序列；主播放列表（含 EXT-X-STREAM-INF）返回子清单地址 */
function dlqParseM3u8(text, baseUrl) {
  const lines = String(text || '').replace(/\r/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.some((l) => /^#EXT-X-KEY:/i.test(l) && /METHOD=(?!NONE)/i.test(l))) {
    return { error: 'encrypted' };
  }
  const variants = [];
  const segs = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#EXT-X-STREAM-INF:/i.test(l)) { const nx = lines[i + 1]; if (nx && !nx.startsWith('#')) variants.push(nx); continue; }
    if (/^#EXTINF:/i.test(l)) { const nx = lines[i + 1]; if (nx && !nx.startsWith('#')) segs.push(nx); }
  }
  if (variants.length) {
    let url = variants[0];
    try { url = new URL(url, baseUrl).toString(); } catch (e) {}
    return { variant: url };
  }
  const out = [];
  for (const s of segs) {
    try { out.push(new URL(s, baseUrl).toString()); } catch (e) { out.push(s); }
  }
  return { segments: out };
}
/* m3u8 下载：拉片单 → 顺序取切片 → 合并成一个 .ts。
   加密片单（AES-128）明确拒绝，不假装下了个视频；进度按「片段数 + 已收字节」双计。 */
function dlqStartHls(it) {
  if (it.state !== 'queued') return;
  dlq.running++;
  it.state = 'downloading'; it.err = ''; it.speed = 0; it.segs = 0; it.segsDone = 0;
  const baseName = it.name.replace(/\.m3u8$/i, '').replace(/[\\/:*?"<>|]/g, '_') || ('hls-' + Date.now());
  const full = path.join(dlqDir(), baseName + '.ts');
  const part = full + '.part';
  let closed = false;
  let ws = Date.now(), wb = 0;
  const aborters = [];
  const finish = (ok, reason) => {
    if (closed) return;
    closed = true;
    it._abort = null;
    for (const a of aborters) { try { a(); } catch (e) {} }
    dlq.running = Math.max(0, dlq.running - 1);
    if (ok) {
      it.state = 'done'; it.err = '';
      try { fs.renameSync(part, full); } catch (e) {}
      it.dir = dlqDir(); it.name = baseName + '.ts';
      try {
        if (typeof Notification !== 'undefined' && Notification.isSupported()) {
          new Notification({ title: '下载完成', body: it.name + '（' + (it.segsDone || 0) + ' 个切片已合并）' }).show();
        }
      } catch (e) {}
    } else if (it.state === 'canceled' || it.state === 'paused') {
      /* 用户主动停：保留 .part 以便重来 */
    } else {
      it.tries = (it.tries || 0) + 1;
      it.err = String(reason || '下载失败').slice(0, 120);
      if (it.tries <= 2) { it.state = 'queued'; dlq.failWait[it.id] = Date.now() + 1500 * it.tries; }
      else { it.state = 'failed'; }
    }
    dlqSave(); dlqBroadcast();
    setTimeout(dlqNext, 300);
  };
  it._abort = () => { for (const a of aborters) { try { a(); } catch (e) {} } };
  const loadList = (url, depth) => {
    dlqGetText(url, it.headers, (err, txt) => {
      if (closed) return;
      if (err) { finish(false, '片单读取失败：' + (err.message || err)); return; }
      const p = dlqParseM3u8(txt, url);
      if (p.error === 'encrypted') { finish(false, '该片单用 AES-128 加密，本期不支持解密下载'); return; }
      if (p.variant && depth < 2) { loadList(p.variant, depth + 1); return; }
      if (!p.segments || !p.segments.length) { finish(false, '片单里没有可用切片（可能是直播流或格式异常）'); return; }
      it.segs = p.segments.length;
      it.size = 0; it.received = 0;
      let out = null;
      try { out = fs.createWriteStream(part, { flags: 'w' }); } catch (e) { finish(false, '无法写入文件：' + (e && e.message)); return; }
      let idx = 0;
      let bytes = 0;
      const nextSeg = () => {
        if (closed) return;
        if (it.state === 'paused' || it.state === 'canceled') { try { out.end(); } catch (e) {} finish(false, '已暂停'); return; }
        if (idx >= p.segments.length) {
          out.end();
          out.on('finish', () => finish(true));
          return;
        }
        const su = p.segments[idx];
        const mod = /^https:/i.test(su) ? https : http;
        let req = null;
        try {
          req = mod.get(su, {
            headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 Chrome/122' }, it.headers || {}),
            timeout: 25000
          }, (res) => {
            if (res.statusCode && res.statusCode >= 400) { try { res.resume(); } catch (e) {} return finish(false, '切片 HTTP ' + res.statusCode + '（第 ' + (idx + 1) + ' 段）'); }
            res.on('data', (chunk) => {
              try { out.write(chunk); } catch (e) {}
              bytes += chunk.length; wb += chunk.length;
              it.received = bytes;
              const now = Date.now();
              if (now - ws >= 700) { it.speed = Math.round(wb / ((now - ws) / 1000)); ws = now; wb = 0; dlqBroadcast(); }
              if (dlq.limitKB > 0) {
                const budget = dlq.limitKB * 1024;
                if (wb > budget) { try { res.pause(); } catch (e) {} setTimeout(() => { try { res.resume(); } catch (e) {} ws = Date.now(); wb = 0; }, 1000); }
              }
            });
            res.on('end', () => { idx++; it.segsDone = idx; try { out.write(Buffer.alloc(0)); } catch (e) {} dlqBroadcast(); setTimeout(nextSeg, 10); });
            res.on('error', (e) => finish(false, (e && e.message) || '切片读取失败'));
          });
          req.on('timeout', () => { try { req.destroy(); } catch (e) {} finish(false, '切片连接超时'); });
          req.on('error', (e) => finish(false, (e && e.message) || '网络错误'));
          aborters.push(() => { try { req.destroy(); } catch (e) {} });
        } catch (e) { finish(false, String((e && e.message) || e)); }
      };
      nextSeg();
    });
  };
  loadList(it.url, 0);
}

ipcMain.handle('kh:dl-list', () => dlqView());
ipcMain.handle('kh:dl-add', (ev, arg) => {
  const url = String((arg && arg.url) || '').trim();
  if (!/^http(s):\/\//i.test(url)) return { ok: false, reason: '只接受 http / https 直链' };
  const isHls = /\.m3u8(\?|$)/i.test(url);
  if (dlq.items.length >= DLQ_MAX) return { ok: false, reason: '队列已满（上限 ' + DLQ_MAX + ' 条），先清掉已完成或失败的条目' };
  const it = {
    id: ++dlq.seq, url: url.slice(0, 2048),
    name: String((arg && arg.name) || '').trim().slice(0, 100) || (isHls ? (dlqNameOf(url).replace(/\.m3u8$/i, '') + '.ts') : dlqNameOf(url)),
    kind: isHls ? 'hls' : 'file',
    dir: '', size: 0, received: 0, state: 'queued', tries: 0, err: '', speed: 0, addedAt: Date.now(), segs: 0, segsDone: 0,
    headers: (arg && arg.headers && typeof arg.headers === 'object') ? arg.headers : null
  };
  dlq.items.push(it);
  dlqSave(); dlqNext();
  return { ok: true, id: it.id };
});
ipcMain.handle('kh:dl-pause', (ev, id) => {
  const it = dlq.items.find((x) => x.id === Number(id));
  if (!it) return { ok: false, reason: '没有这条任务' };
  if (it.state === 'queued') { it.state = 'paused'; dlqSave(); dlqBroadcast(); return { ok: true }; }
  if (it.state === 'downloading') {
    it.state = 'paused';
    if (typeof it._abort === 'function') it._abort();
    dlqSave(); dlqBroadcast();
    return { ok: true, note: '已暂停，已下载部分保留，可续传' };
  }
  return { ok: false, reason: '当前状态不能暂停' };
});
ipcMain.handle('kh:dl-resume', (ev, id) => {
  const it = dlq.items.find((x) => x.id === Number(id));
  if (!it) return { ok: false, reason: '没有这条任务' };
  if (it.state === 'paused' || it.state === 'failed') {
    it.state = 'queued'; it.tries = 0; it.err = ''; delete dlq.failWait[it.id];
    dlqSave(); dlqNext(); return { ok: true };
  }
  return { ok: false, reason: '当前状态不需要重试' };
});
ipcMain.handle('kh:dl-remove', (ev, id) => {
  const idx = dlq.items.findIndex((x) => x.id === Number(id));
  if (idx < 0) return { ok: false, reason: '没有这条任务' };
  const it = dlq.items[idx];
  if (it.state === 'downloading') { it.state = 'canceled'; if (typeof it._abort === 'function') it._abort(); }
  else dlq.items.splice(idx, 1);
  try { fs.unlinkSync(path.join(dlqDir(), it.name + '.part')); } catch (e) {}
  delete dlq.failWait[it.id];
  dlqSave(); dlqBroadcast(); setTimeout(dlqNext, 200);
  return { ok: true };
});
ipcMain.handle('kh:dl-clear', (ev, which) => {
  const w = String(which || 'finished');
  dlq.items = dlq.items.filter((it) => {
    if (it.state === 'downloading') return true;
    if (w === 'all') { try { fs.unlinkSync(path.join(dlqDir(), it.name + '.part')); } catch (e) {} return false; }
    return !(it.state === 'done' || it.state === 'failed' || it.state === 'canceled');
  });
  dlqSave(); dlqBroadcast();
  return { ok: true };
});
ipcMain.handle('kh:dl-opt', (ev, arg) => {
  const a = arg || {};
  if (a.conc != null) dlq.conc = Math.min(Math.max(Number(a.conc) || 1, 1), 4);
  if (a.limitKB != null) dlq.limitKB = Math.max(0, Math.min(Number(a.limitKB) || 0, 1024 * 1024));
  dlqSave(); dlqBroadcast(); dlqNext();
  return { ok: true, conc: dlq.conc, limitKB: dlq.limitKB };
});
ipcMain.handle('kh:dl-reveal', () => {
  try { return shell.openPath(dlqDir()).then(() => ({ ok: true })).catch((e) => ({ ok: false, reason: String(e) })); }
  catch (e) { return { ok: false, reason: String(e) }; }
});
dlqLoad();

/* ---------------- 播放层请求头注入（1.7.82） ----------------
   影视仓里大量站点要求 Referer / 自定义 UA 才肯吐流：数据接口带了头，播放器却拿不到，
   表现就是「仓里搜得到、点播放 403」。渲染层把当前片源的请求头按 host 下发给主进程，
   由 webRequest 在出口统一补上，原生 <video> 与 hls.js 分片请求都能生效。 */
const playHdrRules = new Map();   /* host -> { referer, ua, headers } */
function playHdrFor(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return playHdrRules.get(u.host.toLowerCase()) || playHdrRules.get('*') || null;
  } catch (e) { return null; }
}
function playHdrPatch(details) {
  const rule = playHdrFor(details.url);
  if (!rule) return null;
  const out = Object.assign({}, details.requestHeaders || {});
  if (rule.referer && !out.Referer && !out.referer) out.Referer = rule.referer;
  if (rule.ua) { out['User-Agent'] = rule.ua; delete out['user-agent']; }
  if (rule.headers) {
    for (const k of Object.keys(rule.headers)) {
      const v = rule.headers[k];
      if (!k || v == null || v === '') continue;
      out[k] = String(v);
    }
  }
  return { requestHeaders: out };
}
function registerPlayHeaders() {
  try {
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ['http://*/*', 'https://*/*'] },
      (details, cb) => {
        let r = null;
        try { r = playHdrPatch(details); } catch (e) { r = null; }
        cb(r || { requestHeaders: details.requestHeaders });
      }
    );
    console.log('[播放头] 已注册请求头注入');
  } catch (e) { console.error('[播放头] 注册失败：', e && e.message); }
}
ipcMain.handle('kh:play-hdr-set', (ev, arg) => {
  const a = arg || {};
  const host = String(a.host || '').trim().toLowerCase();
  if (!host) return { ok: false, reason: '缺少 host' };
  const referer = String(a.referer || '').slice(0, 512);
  const ua = String(a.ua || '').slice(0, 300);
  const headers = (a.headers && typeof a.headers === 'object') ? a.headers : null;
  if (!referer && !ua && !headers) {
    playHdrRules.delete(host);
    return { ok: true, removed: true, count: playHdrRules.size };
  }
  playHdrRules.set(host, { referer: referer, ua: ua, headers: headers });
  return { ok: true, count: playHdrRules.size };
});
ipcMain.handle('kh:play-hdr-clear', () => { playHdrRules.clear(); return { ok: true }; });
ipcMain.handle('kh:play-hdr-list', () => ({ ok: true, hosts: Array.from(playHdrRules.keys()) }));

/* ---------------- 本机视频打开（1.7.82） ----------------
   客户提得最多的用法是「把我硬盘里的片子丢进来播」。这里只做选择文件与转 file:// 地址，
   解码仍走内置播放器；不做文件关联注册，避免改动用户系统默认程序。 */
const VIDEO_EXT = ['mp4', 'mkv', 'ts', 'm4v', 'avi', 'mov', 'webm', 'flv', 'wmv', 'mpg', 'mpeg', 'rmvb', '3gp', 'ogv'];
ipcMain.handle('kh:pick-video', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWin && !mainWin.isDestroyed() ? mainWin : undefined, {
      title: '打开本机视频',
      properties: ['openFile'],
      filters: [{ name: '视频文件', extensions: VIDEO_EXT }, { name: '全部文件', extensions: ['*'] }]
    });
    if (!r || r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
    const fp = r.filePaths[0];
    let size = 0;
    try { size = fs.statSync(fp).size; } catch (e) { size = 0; }
    const url = 'file:///' + fp.replace(/\\/g, '/').split('/').map((seg, i) => i === 0 ? seg : encodeURIComponent(seg)).join('/');
    return { ok: true, path: fp, name: path.basename(fp), size: size, url: url };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
});
/* ---------------- 本地媒体库扫描（1.7.111-A） ----------------
   选一个文件夹，递归扫出视频（含子目录），按相对目录分组，顺带找本地封面与 nfo 标题。
   只读枚举，不写盘、不改系统；上限 2000 条 / 深度 5，避免超大目录卡死。 */
function mediaFileUrl(fp) {
  return 'file:///' + fp.replace(/\\/g, '/').split('/').map((seg, i) => i === 0 ? seg : encodeURIComponent(seg)).join('/');
}
function findCover(dir, base) {
  const cand = [base + '.jpg', base + '.png', base + '.jpeg', 'poster.jpg', 'folder.jpg', 'cover.jpg', 'fanart.jpg'];
  for (const c of cand) { try { const p = path.join(dir, c); if (fs.statSync(p).isFile()) return mediaFileUrl(p); } catch (e) {} }
  return '';
}
ipcMain.handle('kh:scan-media-dir', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWin && !mainWin.isDestroyed() ? mainWin : undefined, {
      title: '选择媒体库文件夹', properties: ['openDirectory']
    });
    if (!r || r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
    const root = r.filePaths[0];
    const items = [];
    const walk = (dir, depth) => {
      if (depth > 5 || items.length >= 2000) return;
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        if (items.length >= 2000) return;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p, depth + 1); continue; }
        const ext = path.extname(e.name).slice(1).toLowerCase();
        if (VIDEO_EXT.indexOf(ext) < 0) continue;
        let size = 0; try { size = fs.statSync(p).size; } catch (e2) {}
        const base = path.basename(e.name, path.extname(e.name));
        const rel = path.relative(root, dir).replace(/\\/g, '/');
        items.push({ name: base, file: e.name, path: p, url: mediaFileUrl(p), size: size, ext: ext,
          group: rel || '根目录', cover: findCover(dir, base) });
      }
    };
    walk(root, 0);
    items.sort((a, b) => (a.group + a.name).localeCompare(b.group + b.name, 'zh'));
    return { ok: true, dir: root, count: items.length, items: items };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
});
/* 1.7.85：一键加载影视仓配置——选本机 .json/.txt 配置文件，按 GBK/UTF-8 智能解码读回文本。
   只读文本文件，不改文件系统、不注册文件关联，内容交由用户在影视仓里确认导入。 */
ipcMain.handle('kh:pick-config', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWin && !mainWin.isDestroyed() ? mainWin : undefined, {
      title: '选择影视仓配置文件',
      properties: ['openFile'],
      filters: [{ name: '配置文件', extensions: ['json', 'txt'] }, { name: '全部文件', extensions: ['*'] }]
    });
    if (!r || r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
    const fp = r.filePaths[0];
    let buf;
    try { buf = fs.readFileSync(fp); } catch (e) { return { ok: false, reason: '读取失败：' + ((e && e.message) || e) }; }
    if (buf.length > 5 * 1024 * 1024) return { ok: false, reason: '文件超过 5MB，不是配置文件' };
    let text = '';
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { try { text = new TextDecoder('gb18030').decode(buf); } catch (e2) { text = buf.toString('utf8'); } }
    return { ok: true, name: path.basename(fp), text: text, size: buf.length };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
});
/* ---------------- 备份落盘（1.7.88 · 台账 #160） ----------------
   自动备份要真正写到磁盘（而不是让浏览器弹下载框），所以主进程提供三个能力：
   选目录 / 写文件 / 打开目录。写入前先做路径与体积校验，只允许 .json / .khbak。 */
const BAK_EXT = ['.json', '.khbak', '.txt'];
function bakSanitizeName(name) {
  let n = String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!n) n = '鸿汇影备份';
  /* 去掉以点开头的隐藏名与保留名 */
  n = n.replace(/^\.+/, '_');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(n)) n = '_' + n;
  return n.slice(0, 160);
}
function bakDefaultDir() {
  try {
    const d = path.join(app.getPath('documents'), '鸿汇影·备份');
    fs.mkdirSync(d, { recursive: true });
    return d;
  } catch (e) {
    return app.getPath('userData');
  }
}
ipcMain.handle('kh:backup-dir-pick', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWin && !mainWin.isDestroyed() ? mainWin : undefined, {
      title: '选择自动备份目录',
      defaultPath: bakDefaultDir(),
      properties: ['openDirectory', 'createDirectory']
    });
    if (!r || r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true, dir: bakDefaultDir() };
    const d = r.filePaths[0];
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
    return { ok: true, dir: d };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
});
ipcMain.handle('kh:backup-save', async (ev, arg) => {
  try {
    const a = arg || {};
    const text = String(a.text || '');
    if (!text) return { ok: false, reason: '内容为空' };
    if (text.length > 64 * 1024 * 1024) return { ok: false, reason: '备份超过 64MB，已拒绝写入' };
    let name = bakSanitizeName(a.name || ('鸿汇影备份 ' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json'));
    const ext = path.extname(name).toLowerCase();
    if (BAK_EXT.indexOf(ext) < 0) name += '.json';
    let dir = String(a.dir || '').trim();
    if (!dir) dir = bakDefaultDir();
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    let fp = path.join(dir, name);
    /* 同名不覆盖：加 -2、-3…，避免自动备份把手工导出顶掉 */
    if (fs.existsSync(fp)) {
      const base = name.slice(0, name.length - ext.length), e2 = path.extname(name) || '.json';
      for (let i = 2; i < 60; i++) {
        const cand = path.join(dir, base + '-' + i + e2);
        if (!fs.existsSync(cand)) { fp = cand; break; }
      }
    }
    fs.writeFileSync(fp, text, 'utf8');
    let size = 0;
    try { size = fs.statSync(fp).size; } catch (e) {}
    /* 自动备份保留份数：由渲染层传 keep，主进程只删自己命名的同前缀旧文件 */
    const keep = Number(a.keep) || 0;
    if (keep > 0) {
      try {
        const prefix = bakSanitizeName(a.keepPrefix || '自动备份');
        const files = fs.readdirSync(dir)
          .filter((f) => f.indexOf(prefix) === 0 && /\.(json|khbak)$/i.test(f))
          .map((f) => ({ f: f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
          .sort((x, y) => y.t - x.t);
        files.slice(keep).forEach((it) => { try { fs.unlinkSync(path.join(dir, it.f)); } catch (e) {} });
      } catch (e) { /* 清理失败不影响本次备份 */ }
    }
    return { ok: true, path: fp, dir: dir, size: size };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
});
ipcMain.handle('kh:backup-open-dir', async (ev, arg) => {
  try {
    const d = String((arg && arg.dir) || '').trim() || bakDefaultDir();
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    const r = await shell.openPath(d);
    if (r) return { ok: false, reason: String(r) };
    return { ok: true, dir: d };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
});
ipcMain.handle('kh:backup-default-dir', () => ({ ok: true, dir: bakDefaultDir() }));

/* 落盘地址 → file:// 地址（拖放走渲染层的 File.path，同样需要转换） */
ipcMain.handle('kh:file-path-to-url', (ev, p) => {
  const fp = String(p || '');
  if (!fp) return { ok: false, reason: '空路径' };
  try {
    if (!fs.existsSync(fp)) return { ok: false, reason: '文件不存在' };
    const url = 'file:///' + fp.replace(/\\/g, '/').split('/').map((seg, i) => i === 0 ? seg : encodeURIComponent(seg)).join('/');
    return { ok: true, url: url, name: path.basename(fp), size: fs.statSync(fp).size };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
});

/* ---------------- 网络代理（1.7.82） ----------------
   只有系统代理一条路时，企业网/校园网用户整站取不到数据。这里给三条明确选项：
   跟随系统（默认）/ 直连（绕过系统代理）/ 手动（host:port）。设置落盘由渲染层负责。 */
ipcMain.handle('kh:proxy-get', async () => {
  try {
    const cur = await session.defaultSession.resolveProxy('http://www.example.com');
    return { ok: true, proxy: String(cur || '') };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
});
ipcMain.handle('kh:proxy-set', async (ev, arg) => {
  const a = arg || {};
  const mode = String(a.mode || 'system');
  try {
    if (mode === 'none') { await session.defaultSession.setProxy({ mode: 'direct' }); return { ok: true, mode: 'none' }; }
    if (mode === 'manual') {
      const s = String(a.server || '').trim();
      if (!/^([a-z0-9.\-]+|\*):\d{1,5}$/i.test(s) && !/^(http|https|socks)=/i.test(s)) {
        return { ok: false, reason: '格式应为 host:port，例如 127.0.0.1:7890' };
      }
      await session.defaultSession.setProxy({ proxyRules: s, proxyBypassRules: '<local>' });
      return { ok: true, mode: 'manual', server: s };
    }
    await session.defaultSession.setProxy({ mode: 'system' });
    return { ok: true, mode: 'system' };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
});


/* DLNA 投屏（#125）：发现放在主进程做（渲染层 / ArkWeb 没有 UDP 权限）。
   SSDP M-SEARCH 组播 → 收 200 OK → 按 LOCATION 去重 → 抓设备描述取 friendlyName。
   SOAP 推送（AVTransport SetAVTransportURI）只留接口位：片源多半是外网直链，
   电视端能否拉流取决于片源与局域网可达性，未验证前不假装能投。 */
/* ==== DLNA 投屏（#131）：SSDP 发现 → 读设备描述拿 AVTransport 控制地址 →
   本机起一个局域网只读转发端口，把片源变成「电视能直连的地址」（电视常拉不动外网直链或跨域 302）→
   SOAP SetAVTransportURI + Play。转发只读、不缓存、不写盘，只认 http/https，token 不匹配直接 403。 */

function avTransportControlUrl(descXml, baseUrl) {
  try {
    const services = descXml.match(/<service>[\s\S]*?<\/service>/gi) || [];
    for (const s of services) {
      if (!/urn:schemas-upnp-org:service:AVTransport:1/i.test(s)) continue;
      const c = /<controlURL[^>]*>([^<]+)<\/controlURL>/i.exec(s);
      if (!c || !c[1].trim()) continue;
      return new URL(c[1].trim(), baseUrl).toString();
    }
  } catch (e) {}
  return '';
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function lanIpv4() {
  try {
    const ifs = os.networkInterfaces();
    for (const k of Object.keys(ifs)) {
      for (const a of (ifs[k] || [])) {
        if (a && !a.internal && (a.family === 'IPv4' || a.family === 4)) return a.address;
      }
    }
  } catch (e) {}
  return '';
}

let lanProxySrv = null;
let lanProxyPort = 0;
const LAN_PROXY_TOKEN = require('crypto').randomBytes(8).toString('hex');

function ensureLanProxy() {
  return new Promise((resolve) => {
    if (lanProxySrv && lanProxyPort) { resolve({ ok: true, port: lanProxyPort }); return; }
    const srv = http.createServer((req, res) => {
      const m = /^\/s\/([a-f0-9]+)\/([A-Za-z0-9_-]+)/.exec(req.url || '');
      if (!m || m[1] !== LAN_PROXY_TOKEN) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('forbidden'); return; }
      let target = '';
      try { target = Buffer.from(m[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (e) {}
      if (!/^https?:\/\//i.test(target)) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('only http(s)'); return; }
      const go = (t, depth) => {
        let mod;
        try { mod = /^https:/i.test(t) ? https : http; } catch (e) { return; }
        const hdr = { 'User-Agent': 'HongHub-Cast/1.0' };
        if (req.headers.range) hdr.Range = String(req.headers.range);
        const up = mod.get(t, { headers: hdr, rejectUnauthorized: false }, (r) => {
          if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && depth < 2) {
            let next = '';
            try { next = new URL(r.headers.location, t).toString(); } catch (e) {}
            try { r.resume(); } catch (e) {}
            if (next) { go(next, depth + 1); return; }
          }
          const h = { 'Content-Type': r.headers['content-type'] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
          if (r.headers['content-length']) h['Content-Length'] = r.headers['content-length'];
          if (r.headers['content-range']) h['Content-Range'] = r.headers['content-range'];
          try { res.writeHead(r.statusCode || 200, h); } catch (e) {}
          r.pipe(res);
        });
        up.on('error', () => { try { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('upstream error'); } catch (e) {} });
      };
      go(target, 0);
    });
    srv.on('error', () => resolve({ ok: false, reason: '局域网转发端口启动失败（端口占用或权限不足）' }));
    srv.listen(0, '0.0.0.0', () => {
      lanProxySrv = srv;
      lanProxyPort = (srv.address() && srv.address().port) || 0;
      resolve({ ok: lanProxyPort > 0, port: lanProxyPort });
    });
  });
}

function soapAvTransport(controlUrl, action, innerXml) {
  return new Promise((resolve) => {
    if (!/^https?:\/\//i.test(controlUrl)) { resolve({ ok: false, reason: '设备控制地址不可用' }); return; }
    const body = '<?xml version="1.0" encoding="utf-8"?>' +
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
      '<s:Body><u:' + action + ' xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">' + innerXml +
      '</u:' + action + '></s:Body></s:Envelope>';
    let mod;
    try { mod = /^https:/i.test(controlUrl) ? https : http; } catch (e) { resolve({ ok: false, reason: '控制地址非法' }); return; }
    const req = mod.request(controlUrl, {
      method: 'POST', timeout: 6000, rejectUnauthorized: false,
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPACTION': '"urn:schemas-upnp-org:service:AVTransport:1#' + action + '"',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (r) => {
      let out = '';
      r.setEncoding('utf8');
      r.on('data', (d) => { out += d; if (out.length > 32768) { try { req.destroy(); } catch (e) {} } });
      r.on('end', () => resolve({ ok: r.statusCode === 200, status: r.statusCode, body: out.slice(0, 2000) }));
    });
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve({ ok: false, reason: '设备响应超时（6s）' }); });
    req.on('error', (e) => resolve({ ok: false, reason: '设备连接失败：' + ((e && e.message) || e) }));
    req.end(body);
  });
}

async function castDlna(location, mediaUrl) {
  if (!location) return { ok: false, reason: '没有选择投屏设备' };
  const url = String(mediaUrl || '');
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, reason: '当前没有可投的片源：请先在播放器里播一个 http/https 流再投屏' };
  }
  const info = await fetchDeviceDesc(location);
  const controlUrl = (info && info.controlUrl) || '';
  if (!controlUrl) {
    return { ok: false, reason: '该设备未暴露 AVTransport 控制地址，可能不支持远程投播（只能作为普通播放器）' };
  }
  const lan = lanIpv4();
  if (!lan) return { ok: false, reason: '没能读到本机局域网 IPv4，投屏需要电脑与设备处于同一局域网' };
  const proxy = await ensureLanProxy();
  if (!proxy.ok) return { ok: false, reason: proxy.reason || '局域网转发端口不可用' };
  const b64 = Buffer.from(url, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const direct = 'http://' + lan + ':' + proxy.port + '/s/' + LAN_PROXY_TOKEN + '/' + b64;
  const title = (info && info.friendlyName) || '鸿汇影';
  const didl = '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
    '<item id="0" parentID="-1" restricted="1"><dc:title>' + escapeXml(title) + '</dc:title>' +
    '<upnp:class>object.item.videoItem</upnp:class>' +
    '<res protocolInfo="http-get:*:video/mp4:*">' + escapeXml(direct) + '</res></item></DIDL-Lite>';
  const r1 = await soapAvTransport(controlUrl, 'SetAVTransportURI',
    '<InstanceID>0</InstanceID><CurrentURI>' + escapeXml(direct) + '</CurrentURI>' +
    '<CurrentURIMetaData>' + escapeXml(didl) + '</CurrentURIMetaData>');
  if (!r1.ok) {
    const brief = String(r1.body || r1.reason || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').slice(0, 120);
    return { ok: false, device: title, url: direct, reason: '设备拒绝接收片源（' + (r1.status ? 'HTTP ' + r1.status : r1.reason) + '）' + (brief ? '：' + brief : '') };
  }
  const r2 = await soapAvTransport(controlUrl, 'Play', '<InstanceID>0</InstanceID><Speed>1</Speed>');
  if (!r2.ok) return { ok: false, device: title, url: direct, reason: '片源已送达，但播放指令被拒（' + (r2.status ? 'HTTP ' + r2.status : r2.reason) + '）' };
  return { ok: true, device: title, url: direct, via: 'lan-proxy' };
}

function fetchDeviceDesc(url) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const mod = /^https:/i.test(url) ? require('https') : http;
      const req = mod.get(url, { timeout: 1500, rejectUnauthorized: false }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => {
          body += d;
          if (body.length > 65536) { try { req.destroy(); } catch (e) {} finish(null); }
        });
        res.on('end', () => {
          const name = /<friendlyName[^>]*>([^<]*)<\/friendlyName>/i.exec(body);
          const model = /<modelName[^>]*>([^<]*)<\/modelName>/i.exec(body);
          const udn = /<UDN[^>]*>([^<]*)<\/UDN>/i.exec(body);
          /* AVTransport 控制地址：设备描述里 service 列表按 serviceType 分块，
             只有带 AVTransport:1 的那块给出可下发的 controlURL（相对或绝对，统一解析成绝对）。 */
          finish({
            friendlyName: name ? name[1].trim() : '',
            modelName: model ? model[1].trim() : '',
            udn: udn ? udn[1].trim() : '',
            controlUrl: avTransportControlUrl(body, url)
          });
        });
      });
      req.on('timeout', () => { try { req.destroy(); } catch (e) {} finish(null); });
      req.on('error', () => finish(null));
    } catch (e) {
      finish(null);
    }
  });
}

function discoverDlna(timeoutMs) {
  return new Promise((resolve) => {
    const dur = Math.max(1000, Math.min(6000, Number(timeoutMs) || 3000));
    const found = new Map();
    let sock = null;
    let settled = false;
    const done = (extra) => {
      if (settled) return;
      settled = true;
      try { if (sock) sock.close(); } catch (e) {}
      resolve(Object.assign({ ok: true, supported: true, devices: Array.from(found.values()) }, extra || {}));
    };
    try {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch (e) {
      resolve({ ok: false, supported: false, reason: 'UDP 套接字创建失败：' + ((e && e.message) || e) });
      return;
    }
    sock.on('error', (e) => {
      done({ ok: false, reason: 'SSDP 收发失败：' + ((e && e.message) || e) + '（检查防火墙是否放行 1900/UDP）' });
    });
    sock.on('message', (buf) => {
      const text = buf.toString('utf8');
      if (!/HTTP\/1\.1\s*200/i.test(text)) return;
      const loc = /LOCATION:\s*(\S+)/i.exec(text);
      if (!loc || !loc[1]) return;
      const key = loc[1].trim();
      if (found.has(key)) return;
      const st = /ST:\s*(\S+)/i.exec(text);
      const usn = /USN:\s*(\S+)/i.exec(text);
      const srv = /SERVER:\s*(.+)/i.exec(text);
      found.set(key, {
        location: key,
        st: st ? st[1].trim() : '',
        usn: usn ? usn[1].trim() : '',
        server: srv ? srv[1].trim() : '',
        name: '',
        model: ''
      });
      fetchDeviceDesc(key).then((info) => {
        const d = found.get(key);
        if (d && info) {
          if (info.friendlyName) d.name = info.friendlyName;
          if (info.modelName) d.model = info.modelName;
          if (info.udn) d.usn = d.usn || info.udn;
        }
      }).catch(() => {});
    });
    const searchMsg = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: 239.255.255.250:1900\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 2\r\n' +
      'ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n', 'utf8');
    const blast = () => {
      if (!sock || settled) return;
      try { sock.send(searchMsg, 1900, '239.255.255.250', () => {}); } catch (e) {}
    };
    try {
      sock.bind(() => {
        try { sock.setMulticastTTL(2); } catch (e) {}
        blast();
        setTimeout(blast, 420);
        setTimeout(blast, 1250);
      });
    } catch (e) {
      done({ ok: false, reason: 'UDP 绑定失败：' + ((e && e.message) || e) });
      return;
    }
    setTimeout(() => done(), dur);
  });
}

ipcMain.handle('kh:dlna-discover', (e, opts) => discoverDlna(opts && opts.timeout));

/* SOAP 推送：本机转发片源 → SetAVTransportURI → Play，结果如实回传（设备拒绝/超时都带原因） */
ipcMain.handle('kh:dlna-cast', (e, arg) => castDlna(arg && arg.location, arg && arg.url));

/* 能力探测：桌面主进程具备 UDP/SSDP 即为可用；设备端仍为不支持 */
ipcMain.handle('kh:cast-detect', () => {
  try {
    const probe = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    probe.close();
    return {
      supported: true,
      via: 'ssdp',
      reason: '桌面主进程可做 SSDP 发现并真实推送：片源经本机局域网转发成设备可直连地址，再发 AVTransport。'
    };
  } catch (e) {
    return { supported: false, reason: 'UDP 不可用：' + ((e && e.message) || e) };
  }
});

// 探测端口状态：'ours' 本应用中枢 / 'other' 别的程序 / 'free' 空闲
// 同时带回中枢的 devMode：客户版与开发版共用同一端口会串台
// （客户版在跑时，开发端若"复用"它，就会看到客户的影视页；反之客户会看到运维面板）。
function health(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: port, path: '/health', timeout: 700 }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        let tag = 'other';
        let dev = null;
        try {
          const j = JSON.parse(b);
          tag = (j.ok === true && j.app === HUB_ID) ? 'ours' : 'other';
          if (typeof j.devMode === 'boolean') dev = j.devMode;
        } catch (e) { /* 非本应用响应 */ }
        resolve({ tag: tag, dev: dev });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ tag: 'other', dev: null }); });
    req.on('error', () => resolve({ tag: 'free', dev: null }));
  });
}

// 选端口：优先 8787；只复用"同为开发端/客户端"的中枢，模式不一致就换下一个端口
let portsExhausted = false;
async function pickPort() {
  portsExhausted = false;
  for (let p = BASE_PORT; p < BASE_PORT + 10; p++) {
    const s = await health(p);
    if (s.tag === 'ours' && s.dev === DEV_BUILD) { HUB_PORT = p; reusing = true; return; }
    if (s.tag === 'free') { HUB_PORT = p; reusing = false; return; }
    if (s.tag === 'ours' && s.dev !== DEV_BUILD) {
      console.log('[服务] ' + p + ' 上已有另一模式的中枢（devMode=' + s.dev + '），不复用，换端口');
    }
  }
  portsExhausted = true;
  HUB_PORT = BASE_PORT;
  reusing = false; // 全被占用：仍尝试启动，由错误页给出提示
}

function startServer() {
  if (reusing) { console.log('[服务] 复用已运行的中枢：' + HUB_PORT); return; }
  // 关键：打包后 process.execPath 是 Electron 的 exe，必须用 ELECTRON_RUN_AS_NODE=1
  // 才能把它当纯 Node 运行 server.js；否则服务起不来，窗口加载 localhost 就会白屏。
  serverProc = spawn(process.execPath, [path.join(__dirname, 'server', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(HUB_PORT), ELECTRON_RUN_AS_NODE: '1', KH_DEV_MODE: DEV_BUILD ? '1' : '0', KH_CLIENT_ONLY: CLIENT_ONLY ? '1' : '0', KH_HOST: (lanLoad() ? '0.0.0.0' : '127.0.0.1') }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (serverProc.stdout) serverProc.stdout.on('data', (d) => console.log('[服务]', d.toString().trim()));
  if (serverProc.stderr) serverProc.stderr.on('data', (d) => console.error('[服务]', d.toString().trim()));
  serverProc.on('error', (e) => console.error('[服务] 启动失败', e && e.message));
  serverProc.on('exit', (code) => {
    console.log('[服务] 已退出 code=', code);
    if (quitting || reusing) return;
    if (restarts < MAX_RESTARTS) {
      restarts += 1;
      const delay = 1200 * restarts;
      console.log('[服务] 意外退出，' + delay + 'ms 后自动重启（第 ' + restarts + ' 次）');
      setTimeout(() => {
        if (quitting) return;
        startServer();
        if (mainWin && !mainWin.isDestroyed()) setTimeout(() => mainWin.reload(), 1500);
      }, delay);
    } else {
      console.error('[服务] 连续退出，已停止自动重启，请重新打开应用');
    }
  });
}

// 轮询等待「本应用的中枢」就绪，就绪后再 loadURL，避免连到别人的服务或竞态白屏
function waitForServer(onReady, tries) {
  tries = tries == null ? 60 : tries;
  health(HUB_PORT).then((tag) => {
    if (tag === 'ours') onReady();
    else if (tries > 0) setTimeout(() => waitForServer(onReady, tries - 1), 300);
    else onReady(); // 兜底：即便没探到也加载，由失败页给出提示
  });
}

/* 托盘（#116 / 1.7.93 #54）：常驻入口 + 右键「显示主窗口 / 退出」。
   关闭行为由设置里的 kh_close_act 决定（tray 收进托盘 / min 最小化 / quit 直接退出），
   托盘这里只负责唤回与退出，不参与判定。 */
function createTray() {
  try {
    let img;
    try {
      // 优先 .ico：Windows 由系统在多尺寸档位里挑原生一张（16/20/24/32…），
      // 125%/150% 缩放下比单张 PNG 缩放更清晰；PNG 仅作兜底。
      img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.ico'));
      if (!img || img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
      if (!img || img.isEmpty()) img = nativeImage.createEmpty();
    } catch (e) { img = nativeImage.createEmpty(); }
    tray = new Tray(img);
    tray.setToolTip(APP_TITLE);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => { if (mainWin) { mainWin.show(); mainWin.focus(); } } },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } }
    ]));
    tray.on('click', () => { if (mainWin) { if (mainWin.isVisible()) mainWin.focus(); else mainWin.show(); } });
  } catch (e) { tray = null; }
}

/* 全局快捷键（#116 / 1.7.91 #40）：默认媒体播放/暂停键转发到渲染进程；
   用户在设置里自定义后改走 b8.hotkeys（kh:b8-set 里重新注册），音量键始终交系统默认不劫持。 */
function registerShortcuts() { return b8RegisterHotkeys(); }

/* 应用内浏览窗口：按平台多开（同一域名复用，最多 4 个），每个窗口各带返回工具栏。
   平台页普遍禁止 iframe，所以用 webview 载入；站内 _blank 链接在当前窗口继续走，
   工具栏的「← 返回」走各自 webview 的历史，「回平台列表」只关自己这一个窗口。
   多开是为了对照：以前单例时点第二个平台会把第一个的站内历史和正在播的视频一起顶掉。 */
const BROWSE_PAGE = path.join(__dirname, 'assets', 'browse.html');
const BROWSE_MAX = 4;
const browseWins = new Map();   // 序号 -> BrowserWindow
const browseKeys = new Map();   // 平台域名 -> 序号（同平台再点复用同一个窗口）
const browseSeen = new Map();   // 序号 -> 最近聚焦时间（超出上限时按最久未用淘汰）
let browseSeq = 0;

function browseKeyOf(url) {
  try { return new URL(String(url)).hostname || String(url); } catch (e) { return String(url); }
}
function liveBrowseEntries() {
  const out = [];
  for (const [id, w] of browseWins) { if (w && !w.isDestroyed()) out.push({ id: id, win: w }); }
  return out;
}
function browseSenderWin(sender) {
  for (const w of browseWins.values()) {
    if (w && !w.isDestroyed() && w.webContents === sender) return w;
  }
  return null;
}
function focusBrowseOrMain() {
  try {
    const entries = liveBrowseEntries();
    if (entries.length) {
      const last = entries[entries.length - 1].win;
      if (last.isMinimized()) last.restore();
      last.show();
      last.focus();
      return;
    }
    if (mainWin && !mainWin.isDestroyed()) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
    }
  } catch (e) {}
}
/* 浏览窗口自己的位置/尺寸记忆：主窗口有 window-bounds.json，这里单独一份，
   避免两个窗口互相覆盖；恢复前做屏内校验（拔掉副屏后不会跑到看不见的地方）。 */
function browseBoundsFile() { return path.join(app.getPath('userData'), 'browse-bounds.json'); }
function readBrowseBounds() {
  try {
    const p = browseBoundsFile();
    if (!fs.existsSync(p)) return null;
    const b = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!b || typeof b.width !== 'number' || typeof b.height !== 'number') return null;
    if (b.width < 720 || b.height < 480) return null;
    return clampToDisplay({ x: b.x, y: b.y, width: b.width, height: b.height });
  } catch (e) { return null; }
}
function saveBrowseBounds(win) {
  try {
    const b = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(browseBoundsFile(), JSON.stringify(b), 'utf8');
  } catch (e) { /* 不可写就忽略 */ }
}
function openInAppBrowser(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) return;
  const key = browseKeyOf(url);
  const existingId = browseKeys.get(key);
  if (existingId !== undefined) {
    const w = browseWins.get(existingId);
    if (w && !w.isDestroyed()) {
      try { w.loadFile(BROWSE_PAGE, { query: { u: String(url) } }); } catch (e) {}
      if (w.isMinimized()) { try { w.restore(); } catch (e) {} }
      browseSeen.set(existingId, Date.now());
      w.show();
      w.focus();
      return;
    }
    browseWins.delete(existingId);
    browseKeys.delete(key);
  }
  /* 超出上限时淘汰最久没被聚焦的那个，用户不会一直开第 5 个还看不出哪个被顶掉 */
  const entries = liveBrowseEntries();
  if (entries.length >= BROWSE_MAX) {
    let oldest = entries[0];
    for (const e of entries) {
      if ((browseSeen.get(e.id) || 0) < (browseSeen.get(oldest.id) || 0)) oldest = e;
    }
    try { oldest.win.close(); } catch (e) {}
  }
  const saved = readBrowseBounds();
  const anchor = entries.length ? entries[entries.length - 1].win.getBounds() : saved;
  const opts = {
    width: anchor ? anchor.width : 1200,
    height: anchor ? anchor.height : 820,
    minWidth: 720, minHeight: 480,
    title: '鸿汇影 · 平台浏览',
    backgroundColor: '#14161a',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { webviewTag: true, nodeIntegration: false, contextIsolation: true,
                      preload: path.join(__dirname, 'assets', 'browse-preload.js') }
  };
  /* 级联错位：新窗口相对上一个窗口右下偏移 24px，避免完全叠在一起看不出开了两个 */
  if (anchor) {
    const b = clampToDisplay({ x: (typeof anchor.x === 'number' ? anchor.x : 0) + 24,
                               y: (typeof anchor.y === 'number' ? anchor.y : 0) + 24,
                               width: anchor.width, height: anchor.height });
    opts.x = b.x; opts.y = b.y;
  }
  const win = new BrowserWindow(opts);
  const id = ++browseSeq;
  browseWins.set(id, win);
  browseKeys.set(key, id);
  browseSeen.set(id, Date.now());
  win.on('focus', () => browseSeen.set(id, Date.now()));
  win.setMenuBarVisibility(false);
  /* 只允许 http(s) 挂 webview；webview 里再开新窗口时改为当前窗口内导航，避免又冒无工具栏窗口 */
  win.webContents.on('will-attach-webview', (e, wp, params) => {
    if (!/^https?:\/\//i.test(String(params.src || ''))) { e.preventDefault(); return; }
    try { wp.nodeIntegration = false; wp.contextIsolation = true; } catch (err) {}
  });
  win.webContents.on('did-attach-webview', (e, guest) => {
    try {
      guest.setWindowOpenHandler(({ url: u2 }) => {
        try { if (/^https?:\/\//i.test(String(u2 || ''))) guest.loadURL(u2); } catch (err) {}
        return { action: 'deny' };
      });
      /* 第三方页只允许 http(s) 站内跳转，file: / javascript: / data: 一律拦下 */
      guest.on('will-navigate', (ev, u3) => {
        if (!/^https?:\/\//i.test(String(u3 || ''))) { ev.preventDefault(); }
      });
      /* 子进程崩溃（内存不足等）不能让窗口变白屏：回传给宿主页显示重试面板 */
      guest.on('render-process-gone', (ev, d) => {
        try {
          if (!win.isDestroyed()) {
            win.webContents.send('kh:browse-crashed', String((d && d.reason) || 'unknown'));
          }
        } catch (err) {}
      });
    } catch (err) {}
  });
  win.loadFile(BROWSE_PAGE, { query: { u: String(url) } });
  win.on('close', () => saveBrowseBounds(win));
  /* 关掉一个浏览窗口后：还有别的就聚焦最近那个，没有了才回主窗口，用户不用去任务栏翻 */
  win.on('closed', () => {
    browseWins.delete(id);
    browseSeen.delete(id);
    if (browseKeys.get(key) === id) browseKeys.delete(key);
    focusBrowseOrMain();
  });
}
/* 浏览窗口工具栏的三个动作：关闭（只关当前这一个）、复制地址、把当前地址交给系统浏览器 */
ipcMain.on('kh:browse-close', (e) => {
  const w = browseSenderWin(e.sender);
  if (w) w.close();
});
ipcMain.on('kh:browse-copy', (e, text) => {
  if (!browseSenderWin(e.sender)) return;
  try { clipboard.writeText(String(text || '')); } catch (err) {}
});
ipcMain.on('kh:browse-external', (e, u) => {
  if (!browseSenderWin(e.sender)) return;
  if (/^https?:\/\//i.test(String(u || ''))) { try { shell.openExternal(String(u)); } catch (err) {} }
});

function createWindow() {
  const savedBounds = readSavedBounds();
  const winOpts = {
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    title: APP_TITLE,
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
  };
  if (savedBounds) {
    const cb = clampToDisplay(savedBounds);
    winOpts.x = cb.x; winOpts.y = cb.y; winOpts.width = cb.width; winOpts.height = cb.height;
  }
  mainWin = new BrowserWindow(winOpts);
  if (savedBounds && savedBounds.maximized) { try { mainWin.maximize(); } catch (e) {} }
  // 窗口标题固定为中文，不被网页 <title> 覆盖
  mainWin.on('page-title-updated', (e) => { e.preventDefault(); mainWin.setTitle(APP_TITLE); });
  mainWin.setMenuBarVisibility(false);
  /* 平台 / 第三方外链走应用内浏览窗口（assets/browse.html）：
     以前 window.open 会新开一个没有工具栏的应用内窗口，用户进去后找不到"返回"，
     只能关窗口回列表。现在统一收进一个带「← 返回 / 前进 / 刷新 / 回平台列表」工具栏的浏览窗口，
     站内跳转与 _blank 也在同一窗口里走，返回键可用，随时能回列表换别的平台。 */
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    openInAppBrowser(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e, url) => {
    let local = false;
    try {
      const u = new URL(url);
      local = (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && u.port === String(HUB_PORT);
    } catch (err) {}
    if (local || !/^https?:\/\//i.test(url)) return;
    e.preventDefault();
    openInAppBrowser(url);
  });

  let failed = 0;
  waitForServer(() => {
    if (mainWin) mainWin.loadURL('http://127.0.0.1:' + HUB_PORT + adminPath());
  });
  // 加载失败不立刻定版在错误页：先重试几次（服务可能还在起），仍失败才给可读提示 + 重载按钮
  mainWin.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    if (failed < 5) {
      failed += 1;
      setTimeout(() => {
        if (mainWin && !mainWin.isDestroyed()) mainWin.loadURL('http://127.0.0.1:' + HUB_PORT + adminPath());
      }, 1200 * failed);
      return;
    }
    const portHint = portsExhausted
      ? '<p style="color:#B03A2E">端口 ' + BASE_PORT + '–' + (BASE_PORT + 9) + ' 已被其它程序全部占用：请关闭占用这些端口的程序后重新打开应用。</p>'
      : '<p style="color:#888">可点下面的按钮重试；若仍失败，请关闭后重新打开应用。</p>';
    const writeHint = (writeProbe && !writeProbe.ok)
      ? '<p style="color:#B03A2E">数据目录不可写（' + String(writeProbe.dir || '').slice(0, 60) + '）：收藏、历史与设置可能无法保存，请检查目录权限或以正确身份运行。</p>'
      : '';
    const sysHint = sysProf.oldSystem
      ? '<p style="color:#B03A2E">当前系统版本较低（Windows ' + sysProf.sysVersion + '）：桌面内核可能不兼容；若画面或播放异常，建议改用免安装在线影站。</p>'
      : '';
    const diskHint = (diskFree != null && diskFree < DISK_MIN_BYTES)
      ? '<p style="color:#B03A2E">磁盘可用空间不足（约 ' + Math.round(diskFree / 1024 / 1024) + ' MB）：收藏、历史与缓存可能写不下，请清理磁盘后重试。</p>'
      : '';
    if (mainWin) mainWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<body style="font-family:system-ui;padding:40px;color:#333;background:#fff">' +
      '<h2>本地服务未就绪</h2>' +
      '<p>端口 ' + HUB_PORT + ' · 错误：' + desc + ' (' + code + ')</p>' +
      writeHint + sysHint + diskHint + portHint +
      '<button onclick="location.href=\'http://127.0.0.1:' + HUB_PORT + adminPath() + '\'" ' +
      'style="margin-top:12px;padding:8px 18px;border-radius:8px;border:0;background:#2E86C1;color:#fff;font-size:14px;cursor:pointer">重新载入</button></body>'));
  });
  // 加载成功后复位失败计数与崩溃计数，后续偶发失败仍能重试
  mainWin.webContents.on('did-finish-load', () => { failed = 0; crashReloads = 0; });
  /* 崩溃自恢复：渲染进程崩掉或页面无响应时，以前只剩白屏、用户只能自己结束进程重开。
     这里自动重载，最多连试 3 次；仍不行就给出可读提示，不再无限抖动。 */
  /* 崩溃上报：复用中枢 /api/report 脱敏通道，只报事件类型与原因，不含用户数据；
     上报失败静默忽略（本机服务可能正好没起），绝不影响恢复流程。 */
  const reportCrash = (kind, reason) => {
    recordCrash(kind, reason); // 先落本机，离线/中枢未起也不丢
    try {
      const now = Date.now();
      const payload = JSON.stringify({
        schema: 1, app: 'HongHubMovie',
        deviceId: pageDeviceId || 'desktop-main', version: String(app.getVersion ? app.getVersion() : ''),
        device: 'electron-main', sentAt: now,
        summary: { total: 1 },
        issues: [{ kind: 'crash', sev: 'error', code: kind, msg: String(reason || 'unknown').slice(0, 120),
                   n: 1, ts: now, view: 'main', plat: 'desktop',
                   ver: String(app.getVersion ? app.getVersion() : '') }]
      });
      const req = require('http').request({
        hostname: '127.0.0.1', port: HUB_PORT, path: '/api/report', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 3000
      }, (res) => { res.resume(); });
      req.on('error', () => {});
      req.on('timeout', () => { try { req.destroy(); } catch (e) {} });
      req.end(payload);
    } catch (e) {}
  };
  mainWin.webContents.on('render-process-gone', (e, details) => {
    console.error('[窗口] 渲染进程退出：', details && details.reason);
    reportCrash('render-process-gone', details && details.reason);
    if (quitting) return;
    if (crashReloads >= 3) {
      console.error('[窗口] 连续崩溃 ' + crashReloads + ' 次，已停止自动恢复');
      try {
        mainWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
          '<body style="font-family:system-ui;padding:40px;color:#333;background:#fff">' +
          '<h2>页面连续崩溃，已停止自动恢复</h2>' +
          '<p>请关闭应用后重新打开；若反复出现，点「设置 → 复制诊断报告」把信息发给开发者。</p></body>'));
      } catch (err) {}
      return;
    }
    crashReloads += 1;
    setTimeout(() => { if (mainWin && !mainWin.isDestroyed()) mainWin.reload(); }, 800);
  });
  mainWin.webContents.on('child-process-gone', (e, details) => {
    const kind = details && details.type ? String(details.type) : 'child-process';
    console.error('[窗口] 子进程退出：', kind, details && details.reason);
    reportCrash('child-process-gone', kind + ' · ' + (details && details.reason || 'unknown'));
  });
  mainWin.on('unresponsive', () => {
    console.error('[窗口] 页面无响应，尝试重载恢复');
    reportCrash('unresponsive', 'page-hang');
    if (quitting || crashReloads >= 3) return;
    crashReloads += 1;
    setTimeout(() => { if (mainWin && !mainWin.isDestroyed()) mainWin.reload(); }, 800);
  });
  /* 下载接管（#109）：捕获会话内文件下载，把进度 / 完成状态经 IPC 推给前端状态条；
     保存目录沿用 Electron 默认下载目录，不改用户系统设置。 */
  try {
    mainWin.webContents.session.on('will-download', (ev, item) => {
      const push = (state) => {
        try {
          if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('kh:download-progress', state);
        } catch (e) { /* 窗口已关则忽略 */ }
      };
      push({ state: 'start', filename: item.getFilename(), total: item.getTotalBytes() });
      item.on('updated', () => push({ state: 'progress', filename: item.getFilename(), received: item.getReceivedBytes(), total: item.getTotalBytes() }));
      item.once('done', (e, state) => push({ state: state, filename: item.getFilename(), received: item.getReceivedBytes(), total: item.getTotalBytes(), path: item.getSavePath() }));
    });
  } catch (e) { /* 旧内核无 session 事件时不阻断启动 */ }
  /* 1.7.93 #54 关闭行为：tray=收进托盘继续跑（点托盘图标或菜单“显示主窗口”唤回）；
     min=最小化到任务栏；quit=直接退出（旧口径，仍可选）。退出走托盘菜单 / Ctrl+Q / 系统关机，
     这些路径都先置 quitting=true，所以不会被下面的拦截吞掉。 */
  mainWin.on('close', (e) => {
    saveBounds(mainWin);
    if (quitting) return;
    try {
      if (b8.closeAct === 'tray') {
        e.preventDefault();
        mainWin.hide();
        // 首次收进托盘给一次气泡提示，之后只静默收纳，避免每次关窗都弹
        if (!b8.trayBalloonShown && tray && typeof tray.displayBalloon === 'function') {
          try { tray.displayBalloon({ title: APP_TITLE, content: '已收进托盘，右键托盘图标可退出' }); } catch (err) {}
          b8.trayBalloonShown = true;
          b8Write();
        }
      } else if (b8.closeAct === 'min') {
        e.preventDefault();
        mainWin.minimize();
      }
    } catch (err) { /* 托盘不可用等异常时按旧口径退出，不留半死状态 */ }
  });
  mainWin.on('closed', () => { mainWin = null; });
}

app.whenReady().then(async () => {
  if (!gotLock) { return; } // 已有实例在跑，本次直接退出
  // 中文菜单（默认隐藏，Alt 可唤出）：提供「文件 → 退出 / Ctrl+Q」，任何状态都能随时退出
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '刷新', accelerator: 'CmdOrCtrl+R', click: () => { if (mainWin) mainWin.reload(); } },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } }
      ]
    },
    ...(DEV_BUILD ? [{
      label: '开发端',
      submenu: [
        { label: '运维面板', accelerator: 'CmdOrCtrl+1', click: () => { if (mainWin) mainWin.loadURL('http://127.0.0.1:' + HUB_PORT + '/admin'); } },
        { label: '开关台', accelerator: 'CmdOrCtrl+2', click: () => { if (mainWin) mainWin.loadURL('http://127.0.0.1:' + HUB_PORT + '/admin/extras'); } },
        { label: '功能追踪', accelerator: 'CmdOrCtrl+3', click: () => { if (mainWin) mainWin.loadURL('http://127.0.0.1:' + HUB_PORT + '/admin/features'); } },
        { label: '维护决策', accelerator: 'CmdOrCtrl+5', click: () => { if (mainWin) mainWin.loadURL('http://127.0.0.1:' + HUB_PORT + '/admin/insights'); } },
        { type: 'separator' },
        { label: '立即检查更新', click: () => { try { require('./dev-auto-update').checkOnce(); } catch (e) {} } },
        { label: '影视页', accelerator: 'CmdOrCtrl+4', click: () => { if (mainWin) mainWin.loadURL('http://127.0.0.1:' + HUB_PORT + PAGE_MOVIE); } }
      ]
    }] : []),
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'F5', click: () => { if (mainWin) mainWin.reload(); } },
        { label: '全屏', accelerator: 'F11', click: () => { if (mainWin) mainWin.setFullScreen(!mainWin.isFullScreen()); } },
        { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', click: () => { if (mainWin) mainWin.webContents.toggleDevTools(); } }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  // 开机自启状态由设置页经 IPC（kh:autostart-get/set）读写系统登录项；
  // 启动时不强制覆写——否则用户刚开启自启，下次启动又被这里关回 false。未注册即默认不开。
  await pickPort();
  // 数据目录可写探测：不可写则在错误页/诊断里如实提示（收藏、历史、设置会存不住）
  try { writeProbe = probeWritable(app.getPath('userData')); } catch (e) { writeProbe = { ok: false, msg: String(e && e.message || e) }; }
  if (writeProbe && !writeProbe.ok) console.error('[存储] 数据目录不可写：', writeProbe.msg, writeProbe.dir);
  try { diskFree = diskFreeBytes(writeProbe && writeProbe.dir ? writeProbe.dir : app.getPath('userData')); } catch (e) { diskFree = null; }
  if (sysProf.oldSystem) console.warn('[兼容] 系统版本低于 Win10（' + sysProf.sysVersion + '）：桌面内核可能不兼容，建议引导在线影站');
  if (diskFree != null && diskFree < DISK_MIN_BYTES) console.warn('[存储] 可用空间不足：' + Math.round(diskFree / 1024 / 1024) + 'MB');
  registerPlayHeaders();
  startServer();
  createWindow();
  createTray();
  registerShortcuts();
  // 开发端自更新：启动后检查本机镜像站新包，下载校验后静默安装并重启（客户版不会加载这段）
  if (DEV_BUILD) { try { require('./dev-auto-update').start(); } catch (e) {} }
  // 客户版静默升级（1.7.95 P1-07/08）：只认云端清单 + SHA256，默认「下载并提示」；
  // 只有 Setup 安装目录才允许自动静默安装，免安装版自动降级为提示（避免 NSIS 解到解压目录）。
  if (!DEV_BUILD) {
    try {
      require('./client-auto-update').start({
        app: app, spawn: spawn, version: app.getVersion(),
        appDir: path.dirname(process.execPath), relaunch: process.execPath,
        updateDir: path.join(app.getPath('userData'), 'updates'),
        notify: (type, payload) => {
          try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('kh:auto-update', { type: type, payload: payload || {} }); } catch (e) {}
          if (type === 'ready' && Notification.isSupported()) {
            try {
              new Notification({ title: '鸿汇影 · 新版本已就绪', body: 'v' + ((payload && payload.version) || '') + ' 已下载并通过校验，重启后安装' }).show();
            } catch (e) {}
          }
        }
      });
    } catch (e) { console.error('[自动升级] 启动失败：', e && e.message); }
  }
});

app.on('window-all-closed', () => {
  // 无托盘：窗口关完即彻底退出，并停止本地服务
  quitting = true;
  clearCrashFlag();
  if (serverProc) { try { serverProc.kill(); } catch (e) {} }
  app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  try { globalShortcut.unregisterAll(); } catch (e) {}
  try { if (tray) { tray.destroy(); tray = null; } } catch (e) {}
  clearCrashFlag();
  if (serverProc) { try { serverProc.kill(); } catch (e) {} }
});

// 仅 macOS：点击 Dock 图标重新打开窗口
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
