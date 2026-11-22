/**
 * 鸿汇影桌面版 · 预加载桥（P2-B16 开机自启）
 * --------------------------------------------------------------
 * contextIsolation 开启，渲染进程不能直接碰 Electron / Node。
 * 这里只暴露「开机自启」这一项本机能力：读/写系统登录项设置。
 * 纯网页 / HAP 环境下本文件不存在，window.khAutostart 为 undefined，
 * 前端据此隐藏开关并如实标注「当前环境不支持」。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('khAutostart', {
  /** 读取系统当前是否随登录启动，返回 Promise<boolean> */
  get: () => ipcRenderer.invoke('kh:autostart-get'),
  /** 写入随登录启动开关，open 为布尔值，返回 Promise<{ok:boolean, open:boolean}> */
  set: (open) => ipcRenderer.invoke('kh:autostart-set', !!open)
});

/* 环境兜底信息（#62）：只读，供前端诊断报告标注 GPU 兼容模式 / 数据目录可写性 / 端口状态。
   纯网页 / HAP 环境下 window.khEnvInfo 为 undefined，前端按"非桌面环境"如实呈现。 */
contextBridge.exposeInMainWorld('khEnvInfo', {
  get: () => ipcRenderer.invoke('kh:env-info')
});

/* DLNA 投屏（#66/#125）：能力探测 + 主进程 SSDP 发现 + SOAP 推送接口位（当前返回未实现）。 */
contextBridge.exposeInMainWorld('khCast', {
  detect: () => ipcRenderer.invoke('kh:cast-detect'),
  discover: (opts) => ipcRenderer.invoke('kh:dlna-discover', opts || {}),
  cast: (arg) => ipcRenderer.invoke('kh:dlna-cast', arg || {})
});

/* 页面匿名 ID（1.7.85）：主进程崩溃上报复用同一 ID，崩溃与页面错误才能按设备串起来。
   纯网页 / HAP 环境没有这个桥，前端跳过。 */
contextBridge.exposeInMainWorld('khDeviceId', {
  set: (id) => ipcRenderer.invoke('kh:device-id-set', id)
});

/* 本机崩溃 / 异常日志（#95）：只读，供诊断报告并入；纯网页 / HAP 环境下 window.khCrashLog 为 undefined。 */
contextBridge.exposeInMainWorld('khCrashLog', {
  get: () => ipcRenderer.invoke('kh:crash-log')
});

/* 启动状态（#96）：只读，返回上次是否非正常退出；纯网页 / HAP 环境下 window.khStartupState 为 undefined。 */
contextBridge.exposeInMainWorld('khStartupState', {
  get: () => ipcRenderer.invoke('kh:startup-state')
});

/* 外部播放器（#109）：用本机 VLC / mpv 或系统默认播放器打开片源直链。
   纯网页 / HAP 环境下 window.khExternal 为 undefined，前端隐藏入口。 */
contextBridge.exposeInMainWorld('khExternal', {
  /** @returns Promise<{ok:boolean, via?:string, reason?:string}> */
  open: (url) => ipcRenderer.invoke('kh:open-external', url)
});

/* 系统通知（#109）：前端触发一条本机通知；不支持时桥返回 {ok:false}。 */
contextBridge.exposeInMainWorld('khNotify', {
  /** @returns Promise<{ok:boolean, reason?:string}> */
  send: (title, body) => ipcRenderer.invoke('kh:notify', title, body)
});

/* 下载进度（#109）：订阅会话内文件下载进度；返回取消订阅函数。 */
contextBridge.exposeInMainWorld('khDownload', {
  /** @param {(state:{state:string,filename?:string,received?:number,total?:number})=>void} cb */
  on: (cb) => {
    const handler = (e, state) => { try { cb(state); } catch (err) { /* 回调异常不影响桥 */ } };
    ipcRenderer.on('kh:download-progress', handler);
    return () => { try { ipcRenderer.removeListener('kh:download-progress', handler); } catch (e) {} };
  }
});

/* 下载队列（1.7.79）：并发 / 续传 / 限速 / 重试都放主进程，前端只管排队与看进度。
   纯网页 / HAP 环境没有这个桥，前端据此隐藏整块入口。 */
contextBridge.exposeInMainWorld('khDl', {
  list: () => ipcRenderer.invoke('kh:dl-list'),
  add: (arg) => ipcRenderer.invoke('kh:dl-add', arg || {}),
  pause: (id) => ipcRenderer.invoke('kh:dl-pause', id),
  resume: (id) => ipcRenderer.invoke('kh:dl-resume', id),
  remove: (id) => ipcRenderer.invoke('kh:dl-remove', id),
  clear: (which) => ipcRenderer.invoke('kh:dl-clear', which || 'finished'),
  opt: (arg) => ipcRenderer.invoke('kh:dl-opt', arg || {}),
  reveal: () => ipcRenderer.invoke('kh:dl-reveal'),
  /** @param {(view:object)=>void} cb */
  on: (cb) => {
    const handler = (e, view) => { try { cb(view); } catch (err) { /* 回调异常不影响桥 */ } };
    ipcRenderer.on('kh:dl-queue', handler);
    return () => { try { ipcRenderer.removeListener('kh:dl-queue', handler); } catch (e) {} };
  }
});

/* 影视仓解析器取数（parses 适配层）：主进程代发请求，绕开跨域。
   纯网页 / HAP 环境下 window.khHttp 为 undefined，前端退化为直接 fetch（可能被 CORS 拦）。 */
contextBridge.exposeInMainWorld('khHttp', {
  /** @param {{url:string,timeout?:number,headers?:object}} arg
   *  @returns Promise<{ok:boolean,status?:number,text?:string,reason?:string}> */
  get: (arg) => ipcRenderer.invoke('kh:http-get', arg || {})
});

/* 全局快捷键（#116）：订阅主进程转发的媒体快捷键动作；返回取消订阅函数。 */
contextBridge.exposeInMainWorld('khShortcut', {
  /** @param {(action:'playpause')=>void} cb */
  on: (cb) => {
    const handler = (e, action) => { try { cb(action); } catch (err) {} };
    ipcRenderer.on('kh:shortcut', handler);
    return () => { try { ipcRenderer.removeListener('kh:shortcut', handler); } catch (e) {} };
  }
});

/* 播放层请求头（1.7.82）：影视仓的防盗链站要求 Referer / 自定义 UA，
   由主进程在 webRequest 出口统一补，原生 <video> 与 hls 分片都能生效。
   纯网页 / HAP 环境没有这个桥，前端不调用、按不支持处理。 */
contextBridge.exposeInMainWorld('khPlayHdr', {
  /** @param {{host:string,referer?:string,ua?:string,headers?:object}} arg */
  set: (arg) => ipcRenderer.invoke('kh:play-hdr-set', arg || {}),
  clear: () => ipcRenderer.invoke('kh:play-hdr-clear'),
  list: () => ipcRenderer.invoke('kh:play-hdr-list')
});

/* 本机视频（1.7.82）：打开文件对话框 + 路径转 file:// 地址；不做系统文件关联。 */
contextBridge.exposeInMainWorld('khLocalFile', {
  pick: () => ipcRenderer.invoke('kh:pick-video'),
  toUrl: (p) => ipcRenderer.invoke('kh:file-path-to-url', p)
});

/* 一键加载影视仓配置（1.7.85）：选本机 .json/.txt 配置文件读回文本，内容由用户确认导入。 */
contextBridge.exposeInMainWorld('khConfigFile', {
  pick: () => ipcRenderer.invoke('kh:pick-config')
});

/* 网络代理（1.7.82）：跟随系统 / 直连 / 手动 host:port。 */
contextBridge.exposeInMainWorld('khProxy', {
  get: () => ipcRenderer.invoke('kh:proxy-get'),
  set: (arg) => ipcRenderer.invoke('kh:proxy-set', arg || {})
});
