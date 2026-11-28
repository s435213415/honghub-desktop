import webview from '@ohos.web.webview';
import router from '@ohos.router';
import common from '@ohos.app.ability.common';
import Want from '@ohos.app.ability.Want';
import pasteboard from '@ohos.pasteboard';
import promptAction from '@ohos.promptAction';
import { KhBridgeStore } from '../common/KhBridgeStore';

/* 应用内「平台浏览」页（HAP 端）：
   与桌面端 browse.html 对齐——平台官网在应用内打开，顶部工具栏
   「← 返回 / 刷新 / 复制 / 浏览器 / 回列表」，返回按当前页历史，关闭回平台列表。
   平台普遍禁止 iframe，所以用原生 Web 组件承载。

   这里补了四件此前缺的事：
   1) 安全区：非桌面形态是布局全屏，不避让会被状态栏/刘海压住工具栏、被手势条压住内容；
   2) 返回键：进场把 browserActive 置 true，避免首页残留的 canBack 把返回键吞掉；
   3) UA：默认 ArkWeb/OpenHarmony 标识会被部分平台判成非常规浏览器（优酷类站点会跳验证码）；
   4) 失败可恢复：加载失败不再是标题里一行小字，而是带原因和重试的面板。 */
@Entry
@Component
struct BrowserPage {
  controller: webview.WebviewController = new webview.WebviewController();
  private uiCtx: common.UIAbilityContext | null = null;
  @State title: string = '加载中…';
  @State startUrl: string = '';
  @State curUrl: string = '';
  @State canBack: boolean = false;
  @State canForward: boolean = false;
  @State progress: number = 0;
  @State errText: string = '';
  @State safeTop: number = 0;
  /* 站点限流（401/403/429/503）自动重试计数与定时器句柄 */
  private retryCount: number = 0;
  private retryTimer: number = -1;
  @State safeBottom: number = 0;
  @State safeLeft: number = 0;
  @State safeRight: number = 0;

  aboutToAppear(): void {
    try {
      const params = router.getParams() as Record<string, string>;
      if (params && params.url) {
        this.startUrl = String(params.url);
        this.curUrl = this.startUrl;
      }
    } catch (e) {
    }
    /* 浏览页在场：返回键归本页处理，首页不要把按键拦走 */
    KhBridgeStore.browserActive = true;
    KhBridgeStore.canBack = false;
    this.bindAvoidArea();
    /* 浏览页统一横屏：平台官网是 PC 版，竖屏只剩一条窄缝；退出时恢复跟随系统 */
    try {
      const ctx = getContext(this) as common.UIAbilityContext;
      ctx.eventHub.emit('khSetOrientation', 'landscape');
    } catch (e) {
    }
  }

  aboutToDisappear(): void {
    KhBridgeStore.browserActive = false;
    if (this.retryTimer !== -1) {
      clearTimeout(this.retryTimer);
      this.retryTimer = -1;
    }
    const ctx = this.uiCtx;
    if (ctx) {
      try {
        ctx.eventHub.off('khAvoidArea');
      } catch (e) {
      }
      try {
        ctx.eventHub.emit('khSetOrientation', 'auto');
      } catch (e) {
      }
    }
  }

  /* 安全区（状态栏 / 刘海 / 手势条）实时避开：px2vp 后转成 vp 做 padding */
  private bindAvoidArea(): void {
    try {
      const ctx = getContext(this) as common.UIAbilityContext;
      this.uiCtx = ctx;
      ctx.eventHub.on('khAvoidArea', (data: string) => {
        try {
          const o = JSON.parse(data) as Record<string, number>;
          this.safeTop = px2vp(Number(o['top'] || 0));
          this.safeBottom = px2vp(Number(o['bottom'] || 0));
          this.safeLeft = px2vp(Number(o['left'] || 0));
          this.safeRight = px2vp(Number(o['right'] || 0));
        } catch (e) {
        }
      });
      ctx.eventHub.emit('khRequestAvoidArea', '');
    } catch (e) {
    }
  }

  /* 系统返回键：页内还有历史就先回退，否则退出浏览页回平台列表 */
  onBackPress(): boolean {
    try {
      if (this.controller.accessBackward()) {
        this.controller.backward();
        return true;
      }
    } catch (e) {
    }
    return false;
  }

  private syncNav(): void {
    try {
      this.canBack = this.controller.accessBackward();
      this.canForward = this.controller.accessForward();
    } catch (e) {
      this.canBack = false;
      this.canForward = false;
    }
  }

  private cur(): string {
    try {
      const u = this.controller.getUrl();
      if (u && u.length > 0) {
        return u;
      }
    } catch (e) {
    }
    return this.curUrl || this.startUrl;
  }

  /* 与桌面端同一套桌面 UA：去掉 ArkWeb / OpenHarmony 标识，站点按普通 Chrome 处理 */
  private uaString(): string {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }

  private copyUrl(): void {
    const u = this.cur();
    if (!u) {
      return;
    }
    try {
      const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, u);
      pasteboard.getSystemPasteboard().setData(data).then(() => {
        try {
          promptAction.showToast({ message: '链接已复制', duration: 1600 });
        } catch (e) {
        }
      }).catch((e: Error) => {
      });
    } catch (e) {
    }
  }

  private openExternal(): void {
    const u = this.cur();
    if (!u || !/^https?:\/\//i.test(u)) {
      return;
    }
    try {
      let want: Want = {
        action: 'ohos.want.action.viewData',
        entities: ['entity.system.browsable'],
        uri: u
      };
      let ctx = this.uiCtx;
      if (!ctx) {
        ctx = getContext(this) as common.UIAbilityContext;
        this.uiCtx = ctx;
      }
      ctx.startAbility(want).catch((e: Error) => {
        try {
          promptAction.showToast({ message: '没有可用的浏览器', duration: 1600 });
        } catch (x) {
        }
      });
    } catch (e) {
      try {
        promptAction.showToast({ message: '没有可用的浏览器', duration: 1600 });
      } catch (x) {
      }
    }
  }

  /** Web 内核能自己处理的协议；其余（xxx:// 私有协议）必须拦下，否则内核弹 ERR_UNKNOWN_URL_SCHEME 白页。
   *  照搬 KaihongMovie/WebSitePage.ets 的实现（1.7.113 F30）。 */
  private isWebScheme(url: string): boolean {
    const u: string = url.toLowerCase();
    return u.startsWith('http://') || u.startsWith('https://') || u.startsWith('about:') ||
      u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('file:') ||
      u.startsWith('resource:') || u.startsWith('chrome:') || u.startsWith('javascript:');
  }

  /** 私有协议先交给系统拉起对应 App；没有承接就给明确结论，不留白页。 */
  private handleDeepLink(url: string): void {
    const sep: number = url.indexOf('://');
    const scheme: string = sep > 0 ? url.substring(0, sep) : 'app';
    try {
      let want: Want = {
        action: 'ohos.want.action.viewData',
        entities: ['entity.system.default'],
        uri: url
      };
      let ctx = this.uiCtx;
      if (!ctx) {
        ctx = getContext(this) as common.UIAbilityContext;
        this.uiCtx = ctx;
      }
      ctx.startAbility(want).then(() => {
        try {
          promptAction.showToast({ message: '已交给系统应用打开', duration: 1600 });
        } catch (x) {
        }
      }).catch(() => {
        this.errText = '这个链接要在对应的官方 App 里才能打开（' + scheme + '://），本机没有安装对应应用。\n' +
          '可以把页面上的地址复制到手机上用官方 App 打开。';
        this.title = '需要在官方 App 中打开';
      });
    } catch (e) {
      this.errText = '这个链接要在对应的官方 App 里才能打开（' + scheme + '://），本机没有安装对应应用。';
      this.title = '需要在官方 App 中打开';
    }
  }

  private reloadNow(): void {
    this.errText = '';
    this.retryCount = 0;
    try {
      const u = this.cur();
      if (u) {
        this.controller.loadUrl(u);
      } else {
        this.controller.refresh();
      }
    } catch (e) {
    }
  }

  /* 站点临时限流（401/403/429/503）不立刻给失败页：先自动重试两轮。
     第一轮原地重载（实测「刷新就好了」正是这一步）；
     第二轮改为先载站点首页拿会话，再跳回目标页——很多站是搜索页要 cookie 才放行。 */
  private autoRetry(code: number): boolean {
    if (this.retryCount >= 2) {
      return false;
    }
    const target: string = this.cur() || this.startUrl;
    if (!target || !/^https?:\/\//i.test(target)) {
      return false;
    }
    this.retryCount += 1;
    const n: number = this.retryCount;
    try {
      promptAction.showToast({
        message: '站点临时限流（HTTP ' + String(code) + '），自动重试 ' + String(n) + '/2',
        duration: 1800
      });
    } catch (e) {
    }
    this.errText = '';
    if (this.retryTimer !== -1) {
      clearTimeout(this.retryTimer);
      this.retryTimer = -1;
    }
    const wait: number = n === 1 ? 1200 : 4000;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = -1;
      try {
        if (n >= 2) {
          this.controller.loadUrl(this.originOf(target));
          setTimeout(() => {
            try {
              this.controller.loadUrl(target);
            } catch (e) {
            }
          }, 900);
        } else {
          this.controller.loadUrl(target);
        }
      } catch (e) {
      }
    }, wait);
    return true;
  }

  private originOf(u: string): string {
    const m = /^https?:\/\/[^\/]+/.exec(u);
    if (m && m.length > 0) {
      return m[0] + '/';
    }
    return this.startUrl;
  }

  build() {
    Column() {
      Row({ space: 8 }) {
        Button('← 返回')
          .fontSize(14)
          .fontColor('#ffffff')
          .backgroundColor('#2E86C1')
          .height(40)
          .enabled(this.canBack)
          .onClick(() => {
            try {
              if (this.controller.accessBackward()) {
                this.controller.backward();
              }
            } catch (e) {
            }
          })
        Button('刷新')
          .fontSize(14)
          .fontColor('#dfe4ea')
          .backgroundColor('#2b313a')
          .height(40)
          .onClick(() => {
            this.errText = '';
            try {
              this.controller.refresh();
            } catch (e) {
            }
          })
        Button('复制')
          .fontSize(14)
          .fontColor('#dfe4ea')
          .backgroundColor('#2b313a')
          .height(40)
          .onClick(() => {
            this.copyUrl();
          })
        Button('浏览器')
          .fontSize(14)
          .fontColor('#dfe4ea')
          .backgroundColor('#2b313a')
          .height(40)
          .onClick(() => {
            this.openExternal();
          })
        Text(this.title)
          .fontSize(13)
          .fontColor('#9aa4b2')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
          .margin({ left: 4, right: 4 })
        Button('回列表')
          .fontSize(14)
          .fontColor('#ffffff')
          .backgroundColor('#8e2f2f')
          .height(40)
          .onClick(() => {
            try {
              router.back();
            } catch (e) {
            }
          })
      }
      .width('100%')
      .height(50 + this.safeTop)
      .padding({ top: this.safeTop, bottom: 0, left: 10 + this.safeLeft, right: 10 + this.safeRight })
      .backgroundColor('#1e2228')
      .alignItems(VerticalAlign.Center)

      /* 加载进度：细条，加载完自动收起 */
      if (this.progress > 0 && this.progress < 100) {
        Row()
          .width(String(this.progress) + '%')
          .height(2)
          .backgroundColor('#2E86C1')
          .alignSelf(ItemAlign.Start)
      }

      Stack() {
        Web({ src: this.startUrl, controller: this.controller })
          .userAgent(this.uaString())
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .fileAccess(false)
          .imageAccess(true)
          .mixedMode(MixedMode.All)
          .cacheMode(CacheMode.Default)
          .darkMode(WebDarkMode.Off)
          .forceDarkAccess(false)
          // 私有协议（「在 App 中播放」跳 xxx://）必须在此拦下，放过去内核只能渲染白页
          .onLoadIntercept((event) => {
            const url: string = event.data.getRequestUrl();
            if (this.isWebScheme(url)) {
              return false;
            }
            this.handleDeepLink(url);
            return true;
          })
          .onPageBegin(() => {
            this.errText = '';
          })
          .onProgressChange((event) => {
            this.progress = Number(event.newProgress) || 0;
          })
          .onTitleReceive((event) => {
            this.title = String(event.title || this.startUrl || '平台浏览');
          })
          .onPageEnd(() => {
            this.progress = 100;
            this.syncNav();
            this.curUrl = this.cur();
            try {
              if (this.title === '加载中…') {
                this.title = this.controller.getTitle() || this.startUrl;
              }
            } catch (e) {
            }
          })
          .onErrorReceive((event) => {
            if (event && event.error) {
              let info: string = '';
              let code: number = 0;
              try {
                info = String(event.error.getErrorInfo() || '');
                code = Number(event.error.getErrorCode()) || 0;
              } catch (e) {
              }
              this.errText = info.length > 0 ? info : ('错误码 ' + String(code));
              this.title = '这个平台没打开';
            }
          })
          .onHttpErrorReceive((event) => {
            if (event && event.response) {
              const code = Number(event.response.getResponseCode()) || 0;
              if (code >= 400) {
                let main: boolean = true;
                try {
                  main = event.request.isMainFrame();
                } catch (e) {
                }
                /* 只对主文档的限流类状态码自动重试，子资源 401（图/接口）不折腾整页 */
                if (main && (code === 401 || code === 403 || code === 429 || code === 503) && this.autoRetry(code)) {
                  return;
                }
                this.errText = '站点返回 HTTP ' + String(code) + '（多为临时限流或需登录），点「重试」通常能进。';
                this.title = '这个平台没打开';
              }
            }
          })
          .width('100%')
          .height('100%')

        /* 失败面板：给原因、给重试、给出口，而不是让用户对着一片白 */
        if (this.errText !== '') {
          Column() {
            Text('这个平台没打开')
              .fontSize(18)
              .fontWeight(FontWeight.Bold)
              .fontColor('#dfe4ea')
              .margin({ bottom: 10 })
            Text(this.errText)
              .fontSize(13)
              .fontColor('#9aa4b2')
              .textAlign(TextAlign.Center)
              .maxLines(3)
              .margin({ bottom: 6 })
            Text(this.cur())
              .fontSize(12)
              .fontColor('#6b7684')
              .maxLines(2)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .textAlign(TextAlign.Center)
              .margin({ bottom: 18 })
            Row({ space: 12 }) {
              Button('重试')
                .fontSize(14)
                .fontColor('#ffffff')
                .backgroundColor('#2E86C1')
                .height(40)
                .onClick(() => {
                  this.reloadNow();
                })
              Button('浏览器打开')
                .fontSize(14)
                .fontColor('#dfe4ea')
                .backgroundColor('#2b313a')
                .height(40)
                .onClick(() => {
                  this.openExternal();
                })
              Button('回列表')
                .fontSize(14)
                .fontColor('#ffffff')
                .backgroundColor('#8e2f2f')
                .height(40)
                .onClick(() => {
                  try {
                    router.back();
                  } catch (e) {
                  }
                })
            }
          }
          .width('100%')
          .height('100%')
          .justifyContent(FlexAlign.Center)
          .padding({ left: 24, right: 24 })
          .backgroundColor('#14161a')
        }
      }
      .width('100%')
      .layoutWeight(1)
      .padding({ bottom: this.safeBottom })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#14161a')
  }
}
