import webview from '@ohos.web.webview';
import deviceInfo from '@ohos.deviceInfo';
import common from '@ohos.app.ability.common';
import router from '@ohos.router';
import Want from '@ohos.app.ability.Want';
import request from '@ohos.request';
import fs from '@ohos.file.fs';
import notificationManager from '@ohos.notificationManager';
import picker from '@ohos.file.picker';
import util from '@ohos.util';
import { KhBridgeStore } from '../common/KhBridgeStore';

/* 原生 → JS 的窗口能力桥：
   1) 全屏 + 安全区（刘海 / 状态栏 / 手势条）实时注入，网页据此避让
   2) 屏幕方向由网页调 KHNative.setOrientation 决定（观影锁横屏 / 列表竖屏）
   3) 返回键：网页用 KHNative.setBackHandle(true) 声明"还能退一层"，原生才拦下返回键
   4) JS → 原生代理 KHNative：getDeviceInfo / setOrientation / setBackHandle */

class KHNativeBridge {
  private emitOrientation: (mode: string) => void;

  constructor(emitOrientation: (mode: string) => void) {
    this.emitOrientation = emitOrientation;
  }

  setBackHandle(can: boolean): void {
    KhBridgeStore.canBack = can === true;
  }

  getDeviceInfo(): string {
    let info: Record<string, string> = {
      'osFullName': String(deviceInfo.osFullName || ''),
      'distributionOSName': String(deviceInfo.distributionOSName || ''),
      'distributionOSVersion': String(deviceInfo.distributionOSVersion || ''),
      'sdkApiVersion': String(deviceInfo.sdkApiVersion || 0),
      'deviceType': String(deviceInfo.deviceType || '')
    };
    return JSON.stringify(info);
  }

  /* mode: landscape / portrait / auto */
  setOrientation(mode: string): void {
    let m: string = String(mode || 'auto');
    KhBridgeStore.orientation = m;
    try {
      this.emitOrientation(m);
    } catch (e) {
    }
  }
}

/* 升级 / 更新下载桥 + 平台浏览桥（JS → 原生代理 KaihongBridge）
   - openUpdatePage(url)：打开中枢下发的更新下载页
   - openSiteMode(url, mode)：平台官网在应用内「平台浏览」页打开（带返回工具栏）
   - openExternal(url)：海外 / 项目站交给系统浏览器，返回 true 表示已发起
   - retryUpgrade()：重试安装。本体安装需 bundleManager 安装接口 + 包体落盘 + 签名授权，
     当前无真机联调，先回写降级状态，引导到中枢下载 HAP 后由系统安装器手动安装；
     安装器接通后在此代理内补齐落盘校验与拉起安装即可，前端契约不变。 */
class KaihongBridge {
  private controller: webview.WebviewController;
  private uiCtx: common.UIAbilityContext | null = null;

  constructor(controller: webview.WebviewController, uiCtx: common.UIAbilityContext | null) {
    this.controller = controller;
    this.uiCtx = uiCtx;
  }

  /* 平台官网：新开应用内浏览页（BrowserPage），顶部自带「← 返回 / 前进 / 刷新 / 回平台列表」 */
  openSiteMode(url: string, mode: string): void {
    if (!url || !/^https?:\/\//i.test(url)) {
      return;
    }
    try {
      router.pushUrl({
        url: 'pages/BrowserPage',
        params: { url: url, mode: String(mode || 'pc') }
      });
    } catch (e) {
      try {
        this.controller.loadUrl(url);
      } catch (x) {
      }
    }
  }

  /* 海外 / 项目站：优先交给系统浏览器；失败返回 false，前端会回退到应用内浏览 */
  openExternal(url: string): boolean {
    if (!url || !/^https?:\/\//i.test(url)) {
      return false;
    }
    if (!this.uiCtx) {
      return false;
    }
    try {
      let want: Want = {
        action: 'ohos.want.action.viewData',
        entities: ['entity.system.browsable'],
        uri: url
      };
      this.uiCtx.startAbility(want);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* 本机视频播放器（1.7.86）：ArkWeb 自身解码不了的片源（专用编码 / DRM / 部分 mkv）交给系统里的视频应用。
     want 带 video/* 类型，系统会弹「用哪个应用打开」；没有可用应用时 startAbility 抛错，返回 false 由前端如实提示。 */
  openVideo(url: string, mime: string): boolean {
    if (!url) {
      return false;
    }
    if (!this.uiCtx) {
      return false;
    }
    let t: string = 'video/*';
    if (mime && mime.length > 0) {
      t = mime;
    }
    try {
      let want: Want = {
        action: 'ohos.want.action.viewData',
        entities: ['entity.system.browsable'],
        uri: url,
        type: t
      };
      this.uiCtx.startAbility(want);
      return true;
    } catch (e) {
      return false;
    }
  }

  openUpdatePage(url: string): void {
    try {
      if (url && /^https?:\/\//i.test(url)) {
        // 在当前 WebView 内打开下载页；拉起系统浏览器需 want/URI 授权，留待真机联调
        this.controller.loadUrl(url);
        this.reportState('opened', '已打开更新下载页');
      } else {
        this.reportState('failed', '更新地址无效');
      }
    } catch (e) {
      this.reportState('failed', '打开更新页失败：' + this.errText(e));
    }
  }

  retryUpgrade(): void {
    this.reportState('failed', '设备端暂未接入包体安装器，请在中枢下载 HAP 后手动安装');
  }

  private reportState(stage: string, message: string): void {
    try {
      const payload: string = JSON.stringify({ stage: stage, message: message });
      this.controller.runJavaScript(
        "try{if(window.__khUpgradeState)window.__khUpgradeState(" + JSON.stringify(payload) + ");}catch(e){}"
      );
    } catch (e) {
    }
  }

  private errText(e: Error): string {
    try {
      return String((e && e.message) || e);
    } catch (x) {
      return '';
    }
  }
}

/* 设备端补齐的功能桥（JS → 原生，注册名 KHHap）
   桌面端有 11 类本机能力桥，设备端此前只有方向 / 返回 / 设备信息，
   下载队列、系统通知、环境信息在 HAP 上点了没反应。这里补上三项设备侧能真正落地的能力：
     - getEnv()：设备 / 系统 / 版本信息，供诊断报告与设置页使用
     - notify(title, body)：本地通知（下载完成、更新提醒）
     - 下载：dlAdd / dlList / dlPause / dlResume / dlRemove / dlClear / dlReveal
       文件落在应用沙箱 filesDir/downloads，进度通过 __KH_DL_EVT 推给网页
   受系统限制暂无法闭环的（DLNA 组播、开机自启、全局媒体键、本机文件直读、HAP 静默安装）
   不在本代理里假装实现，前端继续走「当前环境不支持」的既有降级文案。 */
class HapDlItem {
  id: number = 0;
  name: string = '';
  url: string = '';
  path: string = '';
  state: string = 'queued';
  size: number = 0;
  received: number = 0;
  speed: number = 0;
  tries: number = 0;
  header: Record<string, string> | null = null;
  lastRecv: number = 0;
  lastMs: number = 0;
}

class HapBridge {
  private controller: webview.WebviewController;
  private ctx: common.UIAbilityContext | null = null;
  private items: Array<HapDlItem> = [];
  private seq: number = 0;
  private fileSeq: number = 0;
  private dirCache: string = '';

  constructor(controller: webview.WebviewController, ctx: common.UIAbilityContext | null) {
    this.controller = controller;
    this.ctx = ctx;
  }

  /* 环境信息：桌面端 khEnvInfo 的同名能力 */
  getEnv(): string {
    let osName: string = String(deviceInfo.distributionOSName || deviceInfo.osFullName || '');
    let osVer: string = String(deviceInfo.distributionOSVersion || '');
    let out: Record<string, Object | null> = {
      'platform': 'harmony',
      /* 与桌面 kh:env-info 同名键对齐，诊断报告两端能用同一套读取逻辑 */
      'sysVersion': (osName + ' ' + osVer).trim(),
      'deviceType': String(deviceInfo.deviceType || ''),
      'writeOk': true,
      'writeDir': this.dlDir(),
      'writeMsg': '',
      'portsExhausted': false,
      'dev': false,
      'diskFreeBytes': null,
      'diskOk': null,
      'osFullName': String(deviceInfo.osFullName || ''),
      'distributionOSName': osName,
      'distributionOSVersion': osVer,
      'sdkApiVersion': String(deviceInfo.sdkApiVersion || 0)
    };
    return JSON.stringify(out);
  }

  /* 本地通知：桌面端 khNotify.send 的同名能力 */
  notify(title: string, body: string): string {
    let ok: boolean = false;
    let reason: string = '';
    try {
      let t: string = title ? String(title) : '鸿汇影';
      let b: string = body ? String(body) : '';
      let req: notificationManager.NotificationRequest = {
        id: 1001,
        content: {
          notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: { title: t, text: b }
        }
      };
      notificationManager.publish(req);
      ok = true;
    } catch (e) {
      reason = String((e && (e as Error).message) || e);
    }
    let out: Record<string, Object> = { 'ok': ok, 'reason': reason };
    return JSON.stringify(out);
  }

  /* 文件导出 / 导入（第十一轮）：
     设备端此前导出备份、诊断报告只能「复制到剪贴板」，导入只能用粘贴文本框（#130 降级版）。
     这里接系统文件选择器，让设备端也能真正落盘 / 读盘：
       - saveText(name, text)：选保存位置，写 UTF-8 文本 → 回推 { ok, path }
       - openText(accept)：选文件，读回文本 → 回推 { ok, text, name }
     同步只返回受理结果 { ok, id }，异步结果经 __KH_FILE_EVT 回推，前端 Promise 收口。 */
  saveText(name: string, text: string): string {
    let id: number = this.fileSeq + 1;
    this.fileSeq = id;
    try {
      if (!this.ctx) {
        return JSON.stringify({ 'ok': false, 'reason': '缺少应用上下文' });
      }
      let fileName: string = String(name || 'honghub.txt').slice(0, 120);
      let opt: picker.DocumentSaveOptions = new picker.DocumentSaveOptions();
      opt.newFileNames = [fileName];
      let dp: picker.DocumentViewPicker = new picker.DocumentViewPicker(this.ctx);
      dp.save(opt).then((uris: Array<string>) => {
        if (!uris || uris.length === 0) {
          this.fileEvent(id, false, '已取消', '', '', '');
          return;
        }
        let uri: string = uris[0];
        try {
          let f = fs.openSync(uri, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
          fs.writeSync(f.fd, String(text || ''));
          fs.closeSync(f);
          this.fileEvent(id, true, '', uri, '', '');
        } catch (e) {
          this.fileEvent(id, false, String((e as Error).message || e), '', '', '');
        }
      }).catch((e: Error) => {
        this.fileEvent(id, false, String((e && e.message) || e), '', '', '');
      });
      return JSON.stringify({ 'ok': true, 'id': id });
    } catch (e) {
      return JSON.stringify({ 'ok': false, 'reason': String((e as Error).message || e) });
    }
  }

  openText(accept: string): string {
    let id: number = this.fileSeq + 1;
    this.fileSeq = id;
    try {
      if (!this.ctx) {
        return JSON.stringify({ 'ok': false, 'reason': '缺少应用上下文' });
      }
      let opt: picker.DocumentSelectOptions = new picker.DocumentSelectOptions();
      opt.maxSelectNumber = 1;
      let suffix: string = String(accept || '').replace(/[^0-9a-zA-Z,.]/g, '');
      if (suffix) {
        opt.fileSuffixFilters = suffix.split(',');
      }
      let dp: picker.DocumentViewPicker = new picker.DocumentViewPicker(this.ctx);
      dp.select(opt).then((uris: Array<string>) => {
        if (!uris || uris.length === 0) {
          this.fileEvent(id, false, '已取消', '', '', '');
          return;
        }
        let uri: string = uris[0];
        try {
          let st = fs.statSync(uri);
          let size: number = Number(st.size) || 0;
          if (size <= 0) {
            this.fileEvent(id, false, '文件为空', uri, '', '');
            return;
          }
          if (size > 64 * 1024 * 1024) {
            this.fileEvent(id, false, '文件超过 64 MB，已拒绝读取', uri, '', '');
            return;
          }
          let buf: ArrayBuffer = new ArrayBuffer(size);
          let f = fs.openSync(uri, fs.OpenMode.READ_ONLY);
          fs.readSync(f.fd, buf);
          fs.closeSync(f);
          let dec: util.TextDecoder = util.TextDecoder.create('utf-8', { ignoreBOM: true });
          let text: string = dec.decodeToString(new Uint8Array(buf));
          let name: string = uri.slice(uri.lastIndexOf('/') + 1);
          this.fileEvent(id, true, '', uri, text, name);
        } catch (e) {
          this.fileEvent(id, false, String((e as Error).message || e), uri, '', '');
        }
      }).catch((e: Error) => {
        this.fileEvent(id, false, String((e && e.message) || e), '', '', '');
      });
      return JSON.stringify({ 'ok': true, 'id': id });
    } catch (e) {
      return JSON.stringify({ 'ok': false, 'reason': String((e as Error).message || e) });
    }
  }

  /* 商店版设备端：本机视频直选 / 批量入片库。
     前端 khOpenLocalVideo 与 khScanLibrary 依赖 window.khLocalFile.pick / scanDir，
     设备端此前没实现这两个方法，商店首页两个主按钮只能提示「仅桌面版可用」。
     这里用系统文件选择器补上：
       - pickVideo()：选 1 个视频 → { ok, path, url, name }
       - pickVideos()：多选视频（≤200）→ { ok, items:[{name,path,url,group}] }
     ArkWeb 已开 fileAccess，前端拿到 uri 可直接交给 <video> 播放。 */
  pickVideo(): string {
    return this.pickVideoFiles(1, 'file');
  }

  pickVideos(): string {
    return this.pickVideoFiles(200, 'list');
  }

  private pickVideoFiles(max: number, kind: string): string {
    let id: number = this.fileSeq + 1;
    this.fileSeq = id;
    try {
      if (!this.ctx) {
        return JSON.stringify({ 'ok': false, 'reason': '缺少应用上下文' });
      }
      let opt: picker.DocumentSelectOptions = new picker.DocumentSelectOptions();
      opt.maxSelectNumber = max;
      opt.fileSuffixFilters = ['视频|.mp4,.mkv,.m3u8,.ts,.mov,.avi,.flv,.webm,.m4v,.rmvb'];
      let dp: picker.DocumentViewPicker = new picker.DocumentViewPicker(this.ctx);
      dp.select(opt).then((uris: Array<string>) => {
        if (!uris || uris.length === 0) {
          this.localEvent(id, kind, false, '已取消', '', '', '', '');
          return;
        }
        if (kind === 'file') {
          let uri: string = uris[0];
          let nm: string = uri.slice(uri.lastIndexOf('/') + 1);
          this.localEvent(id, kind, true, '', uri, uri, nm, '');
          return;
        }
        let items: string = '[';
        for (let i = 0; i < uris.length; i++) {
          let uri: string = uris[i];
          let nm: string = uri.slice(uri.lastIndexOf('/') + 1);
          let grp: string = '本机';
          let cut: number = uri.lastIndexOf('/');
          if (cut > 0) {
            let parent: string = uri.substring(0, cut);
            let p2: number = parent.lastIndexOf('/');
            grp = p2 > 0 ? parent.substring(p2 + 1) : parent;
          }
          if (i > 0) {
            items += ',';
          }
          items += '{"name":' + JSON.stringify(nm) + ',"path":' + JSON.stringify(uri) +
            ',"url":' + JSON.stringify(uri) + ',"group":' + JSON.stringify(grp) + '}';
        }
        items += ']';
        this.localEvent(id, kind, true, '', '', '', '', items);
      }).catch((e: Error) => {
        this.localEvent(id, kind, false, String((e && e.message) || e), '', '', '', '');
      });
      return JSON.stringify({ 'ok': true, 'id': id, 'kind': kind });
    } catch (e) {
      return JSON.stringify({ 'ok': false, 'reason': String((e as Error).message || e) });
    }
  }

  /* 结果经 __KH_LOCAL_EVT 回推；payload 手拼 JSON，避免 Record<string, Object> 塞数组的类型约束 */
  private localEvent(id: number, kind: string, ok: boolean, reason: string, path: string, url: string,
                     name: string, itemsJson: string): void {
    let payload: string = '{"id":' + String(id) + ',"kind":' + JSON.stringify(kind) +
      ',"ok":' + (ok ? 'true' : 'false') + ',"reason":' + JSON.stringify(reason) +
      ',"path":' + JSON.stringify(path) + ',"url":' + JSON.stringify(url) +
      ',"name":' + JSON.stringify(name);
    if (itemsJson && itemsJson.length > 0) {
      payload += ',"items":' + itemsJson;
    }
    payload += '}';
    try {
      this.controller.runJavaScript(
        'try{if(window.__KH_LOCAL_EVT)window.__KH_LOCAL_EVT(' + payload + ');}catch(e){}'
      );
    } catch (e) {
    }
  }

  private fileEvent(id: number, ok: boolean, reason: string, path: string, text: string, name: string): void {
    let payload: Record<string, Object> = {
      'id': id, 'ok': ok, 'reason': reason, 'path': path, 'text': text, 'name': name
    };
    try {
      this.controller.runJavaScript(
        'try{if(window.__KH_FILE_EVT)window.__KH_FILE_EVT(' + JSON.stringify(payload) + ');}catch(e){}'
      );
    } catch (e) {
    }
  }

  private dlDir(): string {
    if (this.dirCache) {
      return this.dirCache;
    }
    let base: string = '';
    try {
      base = this.ctx ? this.ctx.filesDir : '';
    } catch (e) {
      base = '';
    }
    this.dirCache = base + '/downloads';
    try {
      if (base && !fs.accessSync(this.dirCache)) {
        fs.mkdirSync(this.dirCache);
      }
    } catch (e) {
    }
    return this.dirCache;
  }

  private push(evtJson: string): void {
    try {
      this.controller.runJavaScript(
        'try{if(window.__KH_DL_EVT)window.__KH_DL_EVT(' + evtJson + ');}catch(e){}'
      );
    } catch (e) {
    }
  }

  private view(): string {
    let list: Array<Record<string, Object>> = [];
    for (let i = 0; i < this.items.length; i++) {
      let it: HapDlItem = this.items[i];
      list.push({
        'id': it.id, 'name': it.name, 'url': it.url, 'state': it.state,
        'size': it.size, 'received': it.received, 'speed': it.speed,
        'tries': it.tries, 'path': it.path
      });
    }
    let out: Record<string, Object> = { 'items': list };
    return JSON.stringify(out);
  }

  dlList(): string {
    return this.view();
  }

  /* 只接受 http(s) 直链；m3u8 是切片清单，设备端不做合并，先明确拒绝而不是假装能下 */
  dlAdd(argJson: string): string {
    let url: string = '';
    let name: string = '';
    let header: Record<string, string> | null = null;
    try {
      let arg: Record<string, Object> = JSON.parse(argJson || '{}') as Record<string, Object>;
      url = String(arg['url'] || '').trim();
      name = String(arg['name'] || '').trim();
      /* 防盗链 / Referer：前端 khDl.add 会带 headers，设备端同样透传给下载任务 */
      let hs: Object | undefined = arg['headers'];
      if (hs) {
        header = hs as Record<string, string>;
      }
    } catch (e) {
      url = '';
    }
    if (!/^https?:\/\//i.test(url)) {
      return JSON.stringify({ 'ok': false, 'reason': '只接受 http / https 直链' });
    }
    if (/\.m3u8(\?|$)/i.test(url)) {
      return JSON.stringify({ 'ok': false, 'reason': '设备端暂不支持合并 m3u8 切片，请用桌面端下载' });
    }
    let it: HapDlItem = new HapDlItem();
    this.seq += 1;
    it.id = this.seq;
    it.url = url.slice(0, 2048);
    let base: string = '';
    try {
      base = url.split('?')[0].split('#')[0];
      base = base.substring(base.lastIndexOf('/') + 1);
      base = decodeURIComponent(base);
    } catch (e) {
      base = '';
    }
    it.name = (name || base || ('download-' + String(it.id))).slice(0, 100);
    it.path = this.dlDir() + '/' + String(it.id) + '-' + it.name;
    it.state = 'queued';
    it.header = header;
    this.items.push(it);
    this.start(it);
    let addEvt: Record<string, Object> = { 'type': 'add', 'id': it.id, 'name': it.name };
    this.push(JSON.stringify(addEvt));
    return JSON.stringify({ 'ok': true, 'id': it.id });
  }

  private start(it: HapDlItem): void {
    if (!this.ctx) {
      it.state = 'failed';
      return;
    }
    let cfg: request.DownloadConfig = {
      url: it.url,
      filePath: it.path,
      enableRoaming: true,
      background: true
    };
    if (it.header) {
      cfg.header = it.header;
    }
    it.lastMs = Date.now();
    it.lastRecv = 0;
    request.downloadFile(this.ctx, cfg).then((task: request.DownloadTask) => {
      it.state = 'downloading';
      task.on('progress', (received: number, total: number) => {
        let now: number = Date.now();
        let recv: number = Number(received) || 0;
        let dt: number = now - it.lastMs;
        /* 速度自己算：DownloadTask 的 progress 只给累计字节，没有瞬时速率 */
        if (dt >= 500) {
          it.speed = Math.max(0, Math.round((recv - it.lastRecv) * 1000 / dt));
          it.lastRecv = recv;
          it.lastMs = now;
        }
        it.received = recv;
        it.size = Number(total) || 0;
        this.push(JSON.stringify({
          'type': 'progress', 'id': it.id, 'received': it.received, 'total': it.size,
          'speed': it.speed
        }));
      });
      task.on('complete', () => {
        it.state = 'done';
        this.push(JSON.stringify({ 'type': 'done', 'id': it.id, 'path': it.path }));
        this.notify('下载完成', it.name);
      });
      task.on('fail', () => {
        it.state = 'failed';
        it.tries += 1;
        this.push(JSON.stringify({ 'type': 'failed', 'id': it.id }));
      });
    }).catch((e: Error) => {
      it.state = 'failed';
      it.tries += 1;
      this.push(JSON.stringify({ 'type': 'failed', 'id': it.id, 'reason': String((e && e.message) || e) }));
    });
  }

  dlRemove(idStr: string): string {
    let id: number = Number(idStr) || 0;
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].id === id) {
        let it: HapDlItem = this.items[i];
        this.items.splice(i, 1);
        try {
          if (it.path && fs.accessSync(it.path)) {
            fs.unlinkSync(it.path);
          }
        } catch (e) {
        }
        return JSON.stringify({ 'ok': true });
      }
    }
    return JSON.stringify({ 'ok': false, 'reason': '队列里没有这条' });
  }

  dlClear(which: string): string {
    let keep: Array<HapDlItem> = [];
    let removed: number = 0;
    for (let i = 0; i < this.items.length; i++) {
      let it: HapDlItem = this.items[i];
      let drop: boolean = false;
      if (which === 'all') {
        drop = true;
      } else if (which === 'failed') {
        drop = it.state === 'failed';
      } else {
        drop = it.state === 'done';
      }
      if (drop) {
        removed += 1;
        try {
          if (it.path && fs.accessSync(it.path)) {
            fs.unlinkSync(it.path);
          }
        } catch (e) {
        }
      } else {
        keep.push(it);
      }
    }
    this.items = keep;
    return JSON.stringify({ 'ok': true, 'removed': removed });
  }

  /* 打开下载目录在设备端不可行（沙箱目录对外不可见），
     改为把落盘位置与文件名交回前端，用户能在文件管理器里按名字找 */
  dlReveal(): string {
    return JSON.stringify({ 'ok': false, 'reason': '设备端下载在应用沙箱内：' + this.dlDir() });
  }
}


@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  private bridge: KHNativeBridge | null = null;
  private kaihongBridge: KaihongBridge | null = null;
  private hapBridge: HapBridge | null = null;
  private uiCtx: common.UIAbilityContext | null = null;
  private proxiesReady: boolean = false;

  aboutToAppear(): void {
    try {
      this.uiCtx = getContext(this) as common.UIAbilityContext;
      if (this.uiCtx) {
        this.bridge = new KHNativeBridge((mode: string) => {
          if (this.uiCtx) {
            this.uiCtx.eventHub.emit('khSetOrientation', mode);
          }
        });
        this.kaihongBridge = new KaihongBridge(this.controller, this.uiCtx);
        this.hapBridge = new HapBridge(this.controller, this.uiCtx);
        this.uiCtx.eventHub.on('khAvoidArea', (data: string) => {
          this.injectAvoidArea(String(data));
        });
        this.uiCtx.eventHub.on('khCaps', (data: string) => {
          this.injectCaps(String(data));
        });
        this.uiCtx.eventHub.on('khBack', () => {
          try {
            this.controller.runJavaScript('try{if(window.__KH_BACK)window.__KH_BACK();}catch(e){}');
          } catch (e) {
          }
        });
      }
    } catch (e) {
    }
  }

  aboutToDisappear(): void {
    try {
      if (this.uiCtx) {
        this.uiCtx.eventHub.off('khAvoidArea');
        this.uiCtx.eventHub.off('khBack');
      }
    } catch (e) {
    }
  }

  /* 把系统版本交给前端，前端据此自动切换适配策略（深开鸿 6.x / 旧系统同一套包） */
  injectOsInfo() {
    let info: Record<string, string> = {
      'osFullName': String(deviceInfo.osFullName || ''),
      'distributionOSName': String(deviceInfo.distributionOSName || ''),
      'distributionOSVersion': String(deviceInfo.distributionOSVersion || ''),
      'sdkApiVersion': String(deviceInfo.sdkApiVersion || 0),
      'deviceType': String(deviceInfo.deviceType || '')
    };
    try {
      this.controller.runJavaScript(
        'window.__KH_OS=' + JSON.stringify(info) + ';' +
        'try{if(window.applyOsAdapt)applyOsAdapt();}catch(e){}'
      );
    } catch (e) {
    }
  }

  /* 安全区：top/bottom/left/right（vp），网页写进 CSS 变量避让 */
  injectAvoidArea(areaJson: string) {
    try {
      this.controller.runJavaScript(
        'window.__KH_AVOID=' + areaJson + ';' +
        'try{if(window.applySafeArea)applySafeArea(window.__KH_AVOID);}catch(e){}'
      );
    } catch (e) {
    }
  }

  /* 能力表：这台机器实际支持哪些窗口能力（旧系统少哪个，网页就降级哪个） */
  injectCaps(capsJson: string) {
    try {
      this.controller.runJavaScript(
        'window.__KH_CAPS=' + capsJson + ';' +
        'try{if(window.applyOsAdapt)applyOsAdapt(window.__KH_CAPS);}catch(e){}'
      );
    } catch (e) {
    }
  }

  /* 原生 → JS 代理只注册一次。旧实现在 onPageEnd 里注册后立刻 refresh()，
     新内核（深开鸿 5.0.2 / API14 ArkWeb）会每次加载完成都再刷一遍页面，
     形成「加载 → refresh → 再加载」的闪烁循环，代理也会重复注册。
     改为页控制器挂载时注册（onControllerAttached），onPageEnd 只做信息注入。 */
  private registerProxies() {
    if (this.proxiesReady) {
      return;
    }
    try {
      if (this.bridge) {
        this.controller.registerJavaScriptProxy(this.bridge, 'KHNative',
          ['setBackHandle', 'getDeviceInfo', 'setOrientation']);
      }
      if (this.kaihongBridge) {
        this.controller.registerJavaScriptProxy(this.kaihongBridge, 'KaihongBridge',
          ['openUpdatePage', 'retryUpgrade', 'openSiteMode', 'openExternal', 'openVideo']);
      }
      if (this.hapBridge) {
        this.controller.registerJavaScriptProxy(this.hapBridge, 'KHHap',
          ['getEnv', 'notify', 'dlAdd', 'dlList', 'dlRemove', 'dlClear', 'dlReveal', 'saveText', 'openText', 'pickVideo', 'pickVideos']);
      }
      this.proxiesReady = true;
    } catch (e) {
    }
  }

  build() {
    Column() {
      Web({ src: $rawfile('www/index.html'), controller: this.controller })
        // 允许混合内容，便于 HAP 内前端跨域访问桌面中枢（http）的 /api
        .mixedMode(MixedMode.All)
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(true)
        .imageAccess(true)
        .cacheMode(CacheMode.Default)
        // 深开鸿 5.x / 6.x 系统默认可能开启网页智能反色：本应用自带深色主题，
        // 强制关掉反色，避免颜色被反转成浅底、图标发灰
        .darkMode(WebDarkMode.Off)
        .forceDarkAccess(false)
        .onControllerAttached(() => {
          this.registerProxies();
        })
        .onPageEnd(() => {
          this.registerProxies();
          this.injectOsInfo();
          try {
            if (this.uiCtx) {
              this.uiCtx.eventHub.emit('khRequestAvoidArea', '');
              this.uiCtx.eventHub.emit('khRequestCaps', '');
            }
          } catch (e) {
          }
        })
        // 接管前端 JS 的弹窗，让「一键自愈 / 自治 / 播报」等需 confirm/prompt 的功能在深开鸿端可用
        .onAlert((event) => {
          this.getUIContext().showAlertDialog({
            message: event.message,
            confirm: { value: '确定', action: () => {} }
          });
          return true;
        })
        .onConfirm((event) => {
          this.getUIContext().showAlertDialog({
            message: event.message,
            primaryButton: {
              value: '取消',
              action: () => { event.result.handleCancel(); }
            },
            secondaryButton: {
              value: '确定',
              action: () => { event.result.handleConfirm(); }
            }
          });
          return true;
        })
        .onPrompt((event) => {
          this.getUIContext().showAlertDialog({
            message: event.message,
            primaryButton: {
              value: '取消',
              action: () => { event.result.handleCancel(); }
            },
            secondaryButton: {
              value: '确定',
              action: () => { event.result.handlePromptConfirm(event.value); }
            }
          });
          return true;
        })
        /* 网页里 <input type="file"> 在 ArkWeb 不会自己弹系统选择器（需把选中的 file:// uri
           交回内核），设备端「从文件导入备份」以前点了完全没反应。这里接上系统文件选择器。 */
        .onShowFileSelector((event) => {
          try {
            let ctx2: common.UIAbilityContext | null = this.uiCtx;
            if (!ctx2) {
              return false;
            }
            let opt: picker.DocumentSelectOptions = new picker.DocumentSelectOptions();
            opt.maxSelectNumber = 1;
            let dp: picker.DocumentViewPicker = new picker.DocumentViewPicker(ctx2);
            dp.select(opt).then((uris: Array<string>) => {
              try {
                event.result.handleFileList(uris && uris.length > 0 ? uris : []);
              } catch (e2) {
              }
            }).catch(() => {
              try {
                event.result.handleFileList([]);
              } catch (e3) {
              }
            });
            return true;
          } catch (e) {
            return false;
          }
        })
        /* 网页内的下载链接（第三方页的「下载」按钮、资源直链）ArkWeb 不会自己落盘，
           以前点了完全没反应。这里接管成应用内下载队列，进度/完成走 khDl 那套。 */
        .onDownloadStart((event) => {
          try {
            let url: string = String(event.url || '');
            if (!url || !this.hapBridge) {
              return;
            }
            let cd: string = String(event.contentDisposition || '');
            let idx: number = cd.indexOf('filename=');
            let nm: string = idx >= 0 ? cd.slice(idx + 9).replace(/["']/g, '').trim() : '';
            if (!nm) {
              nm = url.slice(url.lastIndexOf('/') + 1);
            }
            let req: Record<string, Object> = {
              'url': url,
              'name': nm,
              'mimetype': String(event.mimetype || '')
            };
            this.hapBridge.dlAdd(JSON.stringify(req));
          } catch (e) {
          }
        })
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}
