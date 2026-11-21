import webview from '@ohos.web.webview';
import deviceInfo from '@ohos.deviceInfo';
import common from '@ohos.app.ability.common';
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

/* 升级 / 更新下载桥（JS → 原生代理 KaihongBridge）
   - openUpdatePage(url)：打开中枢下发的更新下载页
   - retryUpgrade()：重试安装。本体安装需 bundleManager 安装接口 + 包体落盘 + 签名授权，
     当前无真机联调，先回写降级状态，引导到中枢下载 HAP 后由系统安装器手动安装；
     安装器接通后在此代理内补齐落盘校验与拉起安装即可，前端契约不变。 */
class KaihongBridge {
  private controller: webview.WebviewController;

  constructor(controller: webview.WebviewController) {
    this.controller = controller;
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

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  private bridge: KHNativeBridge | null = null;
  private kaihongBridge: KaihongBridge | null = null;
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
        this.kaihongBridge = new KaihongBridge(this.controller);
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
          ['openUpdatePage', 'retryUpgrade']);
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
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}
