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
const { app, BrowserWindow, Menu } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const APP_TITLE = '鸿汇影桌面版';
const HUB_ID = 'HongHub-Desktop';
const BASE_PORT = 8787;
const MAX_RESTARTS = 3;
let HUB_PORT = BASE_PORT;
/* 开发端构建（KH_DEV_MODE=1）：额外开放「运维看板」入口与发布/自治类接口。
   客户成品不带这个开关，首页固定是影视页，运维看板不存在。
   免安装版没有环境变量可设，因此额外认两种本机开关：启动参数 --dev、程序目录下的 dev-mode.flag。 */
/* 构建期客户版硬开关：默认 false（开发端）。打包客户 exe 时由 scripts/build-client-exe.js
   改为 true——客户版从此不再认 dev-mode.flag / --dev，物理上无法切到运维面板。 */
const CLIENT_ONLY = false; // KH_BUILD_CLIENT_ONLY
const DEV_BUILD = !CLIENT_ONLY && (
  process.env.KH_DEV_MODE === '1'
  || process.argv.indexOf('--dev') >= 0
  || (() => {
    try {
      return fs.existsSync(path.join(path.dirname(process.execPath), 'dev-mode.flag'));
    } catch (e) { return false; }
  })()
);
/* 客户成品加载的页面：明确指向影视页 /index.html，而不是服务根路径
   （根路径过去返回运维看板，客户点开看到的是运维界面，属于入口错位）。
   开发端反过来：打开就是运维面板 /admin，影视页留在菜单里随时切。 */
const PAGE_PATH = DEV_BUILD ? '/admin' : '/index.html';
const PAGE_MOVIE = '/index.html';

// 应用名（影响窗口/任务栏默认名称）设为中文
app.setName(APP_TITLE);

let serverProc = null;
let mainWin = null;
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
async function pickPort() {
  for (let p = BASE_PORT; p < BASE_PORT + 10; p++) {
    const s = await health(p);
    if (s.tag === 'ours' && s.dev === DEV_BUILD) { HUB_PORT = p; reusing = true; return; }
    if (s.tag === 'free') { HUB_PORT = p; reusing = false; return; }
    if (s.tag === 'ours' && s.dev !== DEV_BUILD) {
      console.log('[服务] ' + p + ' 上已有另一模式的中枢（devMode=' + s.dev + '），不复用，换端口');
    }
  }
  HUB_PORT = BASE_PORT;
  reusing = false; // 全被占用：仍尝试启动，由错误页给出提示
}

function startServer() {
  if (reusing) { console.log('[服务] 复用已运行的中枢：' + HUB_PORT); return; }
  // 关键：打包后 process.execPath 是 Electron 的 exe，必须用 ELECTRON_RUN_AS_NODE=1
  // 才能把它当纯 Node 运行 server.js；否则服务起不来，窗口加载 localhost 就会白屏。
  serverProc = spawn(process.execPath, [path.join(__dirname, 'server', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(HUB_PORT), ELECTRON_RUN_AS_NODE: '1', KH_DEV_MODE: DEV_BUILD ? '1' : '0', KH_CLIENT_ONLY: CLIENT_ONLY ? '1' : '0' }),
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

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    title: APP_TITLE,
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  // 窗口标题固定为中文，不被网页 <title> 覆盖
  mainWin.on('page-title-updated', (e) => { e.preventDefault(); mainWin.setTitle(APP_TITLE); });
  mainWin.setMenuBarVisibility(false);

  let failed = 0;
  waitForServer(() => {
    if (mainWin) mainWin.loadURL('http://127.0.0.1:' + HUB_PORT + PAGE_PATH);
  });
  // 加载失败不立刻定版在错误页：先重试几次（服务可能还在起），仍失败才给可读提示 + 重载按钮
  mainWin.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    if (failed < 5) {
      failed += 1;
      setTimeout(() => {
        if (mainWin && !mainWin.isDestroyed()) mainWin.loadURL('http://127.0.0.1:' + HUB_PORT + PAGE_PATH);
      }, 1200 * failed);
      return;
    }
    if (mainWin) mainWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<body style="font-family:system-ui;padding:40px;color:#333;background:#fff">' +
      '<h2>本地服务未就绪</h2>' +
      '<p>端口 ' + HUB_PORT + ' · 错误：' + desc + ' (' + code + ')</p>' +
      '<p style="color:#888">可点下面的按钮重试；若仍失败，请关闭后重新打开应用。</p>' +
      '<button onclick="location.href=\'http://127.0.0.1:' + HUB_PORT + PAGE_PATH + '\'" ' +
      'style="margin-top:12px;padding:8px 18px;border-radius:8px;border:0;background:#2E86C1;color:#fff;font-size:14px;cursor:pointer">重新载入</button></body>'));
  });
  // 加载成功后复位失败计数，后续偶发失败仍能重试
  mainWin.webContents.on('did-finish-load', () => { failed = 0; });
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
  // 默认不随系统自启，避免“关了又自动起来”
  try { app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: [] }); } catch (e) {}
  await pickPort();
  startServer();
  createWindow();
  // 开发端自更新：启动后检查本机镜像站新包，下载校验后静默安装并重启（客户版不会加载这段）
  if (DEV_BUILD) { try { require('./dev-auto-update').start(); } catch (e) {} }
});

app.on('window-all-closed', () => {
  // 无托盘：窗口关完即彻底退出，并停止本地服务
  quitting = true;
  if (serverProc) { try { serverProc.kill(); } catch (e) {} }
  app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  if (serverProc) { try { serverProc.kill(); } catch (e) {} }
});

// 仅 macOS：点击 Dock 图标重新打开窗口
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
