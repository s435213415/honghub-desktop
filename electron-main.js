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

const APP_TITLE = '鸿汇影桌面版';
const HUB_ID = 'HongHub-Desktop';
const BASE_PORT = 8787;
const MAX_RESTARTS = 3;
let HUB_PORT = BASE_PORT;

// 应用名（影响窗口/任务栏默认名称）设为中文
app.setName(APP_TITLE);

let serverProc = null;
let mainWin = null;
let quitting = false;
let reusing = false;   // 复用已有中枢：不再 spawn，也不做自愈
let restarts = 0;

// 单实例锁：重复双击只唤回已开窗口，绝不多开（避免实例堆积、抢端口、卡死）
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
function health(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: port, path: '/health', timeout: 700 }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        let tag = 'other';
        try {
          const j = JSON.parse(b);
          tag = (j.ok === true && j.app === HUB_ID) ? 'ours' : 'other';
        } catch (e) { /* 非本应用响应 */ }
        resolve(tag);
      });
    });
    req.on('timeout', () => { req.destroy(); resolve('other'); });
    req.on('error', () => resolve('free'));
  });
}

// 选端口：优先 8787；被其它程序占用则顺延到空闲端口；遇到本应用中枢直接复用
async function pickPort() {
  for (let p = BASE_PORT; p < BASE_PORT + 10; p++) {
    const state = await health(p);
    if (state === 'ours') { HUB_PORT = p; reusing = true; return; }
    if (state === 'free') { HUB_PORT = p; reusing = false; return; }
  }
  HUB_PORT = BASE_PORT;
  reusing = false; // 全被占用：仍尝试启动，由错误页给出提示
}

function startServer() {
  if (reusing) { console.log('[服务] 复用已运行的中枢：' + HUB_PORT); return; }
  // 关键：打包后 process.execPath 是 Electron 的 exe，必须用 ELECTRON_RUN_AS_NODE=1
  // 才能把它当纯 Node 运行 server.js；否则服务起不来，窗口加载 localhost 就会白屏。
  serverProc = spawn(process.execPath, [path.join(__dirname, 'server', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(HUB_PORT), ELECTRON_RUN_AS_NODE: '1' }),
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

  waitForServer(() => {
    if (mainWin) mainWin.loadURL('http://127.0.0.1:' + HUB_PORT + '/');
  });
  // 加载失败时给出可读提示（而非白屏）
  mainWin.webContents.on('did-fail-load', (e, code, desc) => {
    if (mainWin) mainWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<body style="font-family:system-ui;padding:40px;color:#333;background:#fff">' +
      '<h2>本地服务启动中…</h2>' +
      '<p>端口 ' + HUB_PORT + ' · 若长时间停留此页，请关闭后重新打开应用。</p>' +
      '<p style="color:#888">错误：' + desc + ' (' + code + ')</p></body>'));
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
