import AbilityConstant from '@ohos.app.ability.AbilityConstant';
import UIAbility from '@ohos.app.ability.UIAbility';
import Want from '@ohos.app.ability.Want';
import window from '@ohos.window';
import hilog from '@ohos.hilog';
import deviceInfo from '@ohos.deviceInfo';
import { KhBridgeStore } from '../common/KhBridgeStore';

/* 窗口管理桥（原生侧）
   1) 全屏：布局铺满 + 隐藏状态栏/导航栏，安全区由 avoidAreaChange 实时推给网页
   2) 方向：默认横屏观影；网页可通过 KHNative.setOrientation 切 portrait / landscape / auto
   3) 返回键：网页声明"还能退一层"（KHNative.setBackHandle(true)）时拦下返回键转交网页，
      否则按系统默认退出，不会被网页误吞 */
export default class EntryAbility extends UIAbility {
  private win: window.Window | null = null;
  private capsJson: string = '';

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0x0000, 'HongHub', '%{public}s', 'HongHub-Harmony onCreate');
  }

  onDestroy(): void {
    hilog.info(0x0000, 'HongHub', '%{public}s', 'HongHub-Harmony onDestroy');
  }

  /* 自动适配操作系统：不假设某个 API 一定存在，逐个探测，把"这台机器实际支持什么"
     编成能力表推给网页。旧系统（API 11/12）少哪个能力就少用哪个，页面按表降级。 */
  onWindowStageCreate(windowStage: window.WindowStage): void {
    hilog.info(0x0000, 'HongHub', '%{public}s', 'onWindowStageCreate');
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(0x0000, 'HongHub', 'Failed to load content. Cause: %{public}s', JSON.stringify(err));
        return;
      }
    });
    let caps: Record<string, string> = {
      'sdk': String(deviceInfo.sdkApiVersion || 0),
      'osVersion': String(deviceInfo.distributionOSVersion || ''),
      'osName': String(deviceInfo.distributionOSName || deviceInfo.osFullName || ''),
      'deviceType': String(deviceInfo.deviceType || ''),
      'fullscreen': '0',
      'hideBars': '0',
      'avoidArea': '0',
      'orientation': '0',
      'backKey': '1'
    };
    try {
      let w: window.Window = windowStage.getMainWindowSync();
      this.win = w;
      // 1) 全屏布局：没有这个方法就保持系统默认布局，不阻断启动
      try {
        w.setWindowLayoutFullScreen(true);
        caps['fullscreen'] = '1';
      } catch (e) {
        hilog.warn(0x0000, 'HongHub', 'setWindowLayoutFullScreen unavailable: %{public}s', JSON.stringify(e));
      }
      // 2) 隐藏系统栏：部分旧系统不支持空数组，失败就退回只隐藏导航栏
      try {
        w.setWindowSystemBarEnable([]);
        caps['hideBars'] = '1';
      } catch (e) {
        try {
          w.setWindowSystemBarEnable(['navigation']);
          caps['hideBars'] = '1';
        } catch (e2) {
          hilog.warn(0x0000, 'HongHub', 'setWindowSystemBarEnable unavailable');
        }
      }
      // 3) 安全区监听：拿得到就实时推，拿不到由网页用 CSS env() 兜底
      try {
        let sys: window.AvoidArea = w.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
        caps['avoidArea'] = '1';
        this.emitAvoidArea(w, sys);
        w.on('avoidAreaChange', () => {
          this.emitAvoidArea(w, null);
        });
      } catch (e) {
        hilog.warn(0x0000, 'HongHub', 'avoidArea unavailable, 网页将用 env(safe-area-inset) 兜底');
      }
      // 4) 方向：能设才设，设不了就跟随系统
      try {
        w.setPreferredOrientation(window.Orientation.LANDSCAPE);
        caps['orientation'] = '1';
      } catch (e) {
        hilog.warn(0x0000, 'HongHub', 'setPreferredOrientation unavailable');
      }
      this.context.eventHub.on('khSetOrientation', (mode: string) => {
        this.applyOrientation(String(mode));
      });
      this.context.eventHub.on('khRequestAvoidArea', () => {
        if (this.win) {
          this.emitAvoidArea(this.win, null);
        }
      });
    } catch (e) {
      hilog.warn(0x0000, 'HongHub', 'window bridge init failed: %{public}s', JSON.stringify(e));
    }
    // 能力表最后推：页面无论早晚打开都能拿到同一份
    this.capsJson = JSON.stringify(caps);
    try {
      this.context.eventHub.emit('khCaps', this.capsJson);
      this.context.eventHub.on('khRequestCaps', () => {
        try {
          this.context.eventHub.emit('khCaps', this.capsJson);
        } catch (e) {
        }
      });
    } catch (e) {
    }
  }

  onWindowStageDestroy(): void {
    this.win = null;
  }

  onForeground(): void {}

  onBackground(): void {}

  private applyOrientation(mode: string): void {
    if (!this.win) {
      return;
    }
    let target: window.Orientation = window.Orientation.UNSPECIFIED;
    if (mode === 'portrait') {
      target = window.Orientation.PORTRAIT;
    } else if (mode === 'landscape') {
      target = window.Orientation.LANDSCAPE;
    }
    try {
      this.win.setPreferredOrientation(target);
    } catch (e) {
      hilog.warn(0x0000, 'HongHub', 'setPreferredOrientation failed: %{public}s', JSON.stringify(e));
    }
  }

  /* 安全区（vp）：状态栏/刘海/手势条，网页按这个值做 padding，避免内容被压住。
     sys0 传已取到的值可省一次系统调用；取不到刘海（旧系统无 TYPE_CUTOUT）时按 0 处理。 */
  private emitAvoidArea(w: window.Window, sys0: window.AvoidArea | null): void {
    try {
      let sys: window.AvoidArea = sys0 !== null ? sys0 : w.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
      let cutTop: number = 0;
      let cutBottom: number = 0;
      let cutLeft: number = 0;
      let cutRight: number = 0;
      try {
        let cut: window.AvoidArea = w.getWindowAvoidArea(window.AvoidAreaType.TYPE_CUTOUT);
        cutTop = cut.topRect.height;
        cutBottom = cut.bottomRect.height;
        cutLeft = cut.leftRect.width;
        cutRight = cut.rightRect.width;
      } catch (e) {
        // 旧系统没有挖孔区，忽略
      }
      let top: number = Math.max(sys.topRect.height, cutTop);
      let bottom: number = Math.max(sys.bottomRect.height, cutBottom);
      let left: number = Math.max(sys.leftRect.width, cutLeft);
      let right: number = Math.max(sys.rightRect.width, cutRight);
      let obj: Record<string, number> = {
        'top': top,
        'bottom': bottom,
        'left': left,
        'right': right
      };
      this.context.eventHub.emit('khAvoidArea', JSON.stringify(obj));
    } catch (e) {
      hilog.warn(0x0000, 'HongHub', 'emitAvoidArea failed: %{public}s', JSON.stringify(e));
    }
  }

  onBackPressed(): boolean {
    if (KhBridgeStore.canBack) {
      try {
        this.context.eventHub.emit('khBack', '');
      } catch (e) {
      }
      return true;
    }
    return false;
  }
}
