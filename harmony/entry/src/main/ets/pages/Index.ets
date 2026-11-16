import webview from '@ohos.web.webview';
import { AlertDialog } from '@kit.ArkUI';

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();

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
