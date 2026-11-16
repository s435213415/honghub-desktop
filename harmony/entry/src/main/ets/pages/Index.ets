import webview from '@ohos.web.webview';
import { AlertDialog } from '@kit.ArkUI';
import deviceInfo from '@ohos.deviceInfo';

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();

  /* 把系统版本交给前端，前端据此自动切换适配策略（深开鸿 6.x / 旧系统同一套包） */
  injectOsInfo() {
    let info: Record<string, string> = {
      'osFullName': String(deviceInfo.osFullName || ''),
      'distributionOSName': String(deviceInfo.distributionOSName || ''),
      'osVersion': String(deviceInfo.osVersion || ''),
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
        .onPageEnd(() => {
          this.injectOsInfo();
        })
        // 接管前端 JS 的弹窗，让「一键自愈 / 自治 / 播报」等需 confirm/prompt 的功能在深开鸿端可用
        .onAlert((event) => {
          AlertDialog.show({
            message: event.message,
            confirm: { value: '确定', action: () => {} }
          });
          return true;
        })
        .onConfirm((event) => {
          AlertDialog.show({
            message: event.message,
            primaryButton: { value: '取消', action: () => { event.cancel(); } },
            secondaryButton: { value: '确定', action: () => { event.confirm(); } }
          });
          return true;
        })
        .onPrompt((event) => {
          AlertDialog.show({
            message: event.message,
            primaryButton: { value: '取消', action: () => { event.cancel(); } },
            secondaryButton: {
              value: '确定',
              action: () => { event.confirm(event.value); }
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
