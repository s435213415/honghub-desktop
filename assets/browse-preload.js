'use strict';
/* 平台浏览窗口的最小桥：只给工具栏用，不给 webview 里的第三方页面任何能力
   （preload 只作用于 browse.html 这个宿主页，webview guest 不继承）。 */
const { contextBridge, ipcRenderer, clipboard } = require('electron');

/* 桌面 UA：用本机真实 Chromium 版本，剥掉 Electron 标识。
   优酷等站点见到 Electron 会直接跳验证码页（实测 1.4KB 的 captcha 跳转）。 */
const CHROME_VERSION = (process.versions && process.versions.chrome ? String(process.versions.chrome).split('.')[0] : '131');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' +
  CHROME_VERSION + '.0.0.0 Safari/537.36';

contextBridge.exposeInMainWorld('khBrowse', {
  ua: UA,
  close: () => ipcRenderer.send('kh:browse-close'),
  openExternal: (url) => ipcRenderer.send('kh:browse-external', String(url || '')),
  /* 走主进程剪贴板：file:// 宿主页里 navigator.clipboard 不可靠 */
  copy: (text) => {
    const s = String(text || '');
    if (s) { ipcRenderer.send('kh:browse-copy', s); }
  },
  onCrash: (cb) => {
    if (typeof cb === 'function') {
      ipcRenderer.on('kh:browse-crashed', (e, reason) => { try { cb(String(reason || '')); } catch (err) {} });
    }
  }
});
