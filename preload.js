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
/* 局域网访问开关（1.7.104）：默认关闭，只绑本机；纯网页 / HAP 环境下为 undefined。 */
contextBridge.exposeInMainWorld('khLanMode', {
  get: () => ipcRenderer.invoke('kh:lan-mode'),
  set: (open) => ipcRenderer.invoke('kh:lan-mode', { set: !!open })
});

/* 注意：这里不能叫 khDeviceId。页面脚本 kh-core.js 有一层同名函数 khDeviceId()，
   contextBridge 暴露的属性在页面世界是不可配置的，两者相撞会让 kh-core.js 整个脚本
   在实例化阶段报 "Identifier 'khDeviceId' has already been declared" 而一行都不执行，
   结果就是窗口白屏（1.7.104 引入，1.7.106 才发现）。故改名为 khDeviceIdBridge。 */
contextBridge.exposeInMainWorld('khDeviceIdBridge', {
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
  toUrl: (p) => ipcRenderer.invoke('kh:file-path-to-url', p),
  scanDir: () => ipcRenderer.invoke('kh:scan-media-dir')
});

/* 一键加载影视仓配置（1.7.85）：选本机 .json/.txt 配置文件读回文本，内容由用户确认导入。 */
contextBridge.exposeInMainWorld('khConfigFile', {
  pick: () => ipcRenderer.invoke('kh:pick-config')
});

/* 备份落盘（1.7.88 · 台账 #160）：自动备份要真写盘，而不是每次弹下载框。
   save 传 {text,name,dir,keep,keepPrefix}，返回 {ok,path,dir,size}；纯网页 / HAP 环境没有这个桥。 */
contextBridge.exposeInMainWorld('khBackupFile', {
  save: (arg) => ipcRenderer.invoke('kh:backup-save', arg || {}),
  pickDir: () => ipcRenderer.invoke('kh:backup-dir-pick'),
  openDir: (arg) => ipcRenderer.invoke('kh:backup-open-dir', arg || {}),
  defaultDir: () => ipcRenderer.invoke('kh:backup-default-dir')
});

/* 网络代理（1.7.82）：跟随系统 / 直连 / 手动 host:port。 */
contextBridge.exposeInMainWorld('khProxy', {
  get: () => ipcRenderer.invoke('kh:proxy-get'),
  set: (arg) => ipcRenderer.invoke('kh:proxy-set', arg || {})
});

/* 客户版静默升级（1.7.95 · P1-07 / P1-08）：只暴露状态、模式与手动检查三件事，
   真正的下载 / 校验 / 静默安装在主进程，前端拿不到也不该拿安装包路径以外的能力。 */
contextBridge.exposeInMainWorld('khAutoUpdate', {
  /** @returns Promise<{ok:boolean, state?:object, current?:string, devBuild?:boolean}> */
  get: () => ipcRenderer.invoke('kh:auto-update-get'),
  /** @param {{mode:'off'|'check'|'download'|'install'}} arg */
  setMode: (arg) => ipcRenderer.invoke('kh:auto-update-mode', arg || {}),
  /** 手动检查一次：只下载不安装 @returns Promise<{ok:boolean, plan?:object, reason?:string}> */
  run: () => ipcRenderer.invoke('kh:auto-update-run'),
  /** 下载就绪事件（kh:auto-update），返回取消订阅函数 */
  onEvent: (cb) => {
    if (typeof cb !== 'function') return function () {};
    const h = (ev, payload) => { try { cb(payload || {}); } catch (e) {} };
    ipcRenderer.on('kh:auto-update', h);
    return function () { try { ipcRenderer.removeListener('kh:auto-update', h); } catch (e) {} };
  }
});

/* 静默覆盖安装（1.7.86）：安装包先由服务端下载并校验 SHA256，拿到绝对路径后交给主进程。
   主进程会退出自身 → setup /S 覆盖装到当前目录 → 重新拉起。免安装 zip 目录会拒绝并说明原因。 */
contextBridge.exposeInMainWorld('khUpdater', {
  /** @param {{file:string}} arg @returns Promise<{ok:boolean, dir?:string, reason?:string}> */
  installSilent: (arg) => ipcRenderer.invoke('kh:install-silent', arg || {})
});

/* B 档本机能力（1.7.91 · 台账 #167）：音轨/字幕/通知策略/快捷键/外部播放器/置顶画中画。
   纯网页 / HAP 环境下 window.khB8 为 undefined，前端据此隐藏「高级与本地能力」并标注不支持。 */
contextBridge.exposeInMainWorld('khB8', {
  /** @returns Promise<{ok:boolean, b8:{hotkeys,player,notify,top}, platform?:string}> */
  get: () => ipcRenderer.invoke('kh:b8-get'),
  /** @param {{hotkeys?:object, player?:{exe:string,args:string}, notify?:string, top?:boolean}} arg */
  set: (arg) => ipcRenderer.invoke('kh:b8-set', arg || {}),
  /** kind: 'exe' | 'dir' @returns Promise<{ok:boolean, path?:string, canceled?:boolean}> */
  pick: (kind) => ipcRenderer.invoke('kh:b8-pick', { kind: kind || 'exe' }),
  /** @returns Promise<{ok:boolean, dir?:string, files?:[{name,path,size}]}> */
  subs: (dir) => ipcRenderer.invoke('kh:b8-subs', { dir: dir || '' }),
  /** @returns Promise<{ok:boolean, text?:string, name?:string}> */
  subRead: (p) => ipcRenderer.invoke('kh:b8-sub-read', { path: p }),
  /** 1.7.94 #78 读外部主题目录里的 *.json @returns Promise<{ok:boolean, dir?:string, files?:[{name,text}]}> */
  themes: (dir) => ipcRenderer.invoke('kh:b8-themes', { dir: dir || '' }),
  /** 1.7.94 #37 网络族与 DNS @returns Promise<{ok:boolean, net:{mode,dns}, applied:{disableIpv6}}> */
  netGet: () => ipcRenderer.invoke('kh:b8-net-get'),
  /** @param {{mode:string, dns:string[]}} a @returns Promise<{ok:boolean, net:object, restart:boolean}> */
  netSet: (a) => ipcRenderer.invoke('kh:b8-net-set', a || {}),
  /** @param {{top?:boolean, pip?:boolean}} arg @returns Promise<{ok:boolean, top?:boolean, pip?:boolean}> */
  win: (arg) => ipcRenderer.invoke('kh:b8-win', arg || {}),
  /* 1.7.94 #75 跨进程一致：主进程配置（b8）被另一处改动（另一个窗口 / 托盘 / 主进程自己）后广播，
     前端只重读并套用到界面，不再回推，避免两侧互相覆盖成死循环。返回取消订阅函数。 */
  onChanged: (cb) => {
    if (typeof cb !== 'function') return function () {};
    const h = (ev, payload) => { try { cb(payload || {}); } catch (e) {} };
    ipcRenderer.on('kh:b8-changed', h);
    return function () { try { ipcRenderer.removeListener('kh:b8-changed', h); } catch (e) {} };
  }
});
