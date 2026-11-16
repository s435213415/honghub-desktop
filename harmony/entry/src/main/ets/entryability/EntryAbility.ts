import AbilityConstant from '@ohos.app.ability.AbilityConstant';
import UIAbility from '@ohos.app.ability.UIAbility';
import Want from '@ohos.app.ability.Want';
import window from '@ohos.window';
import hilog from '@ohos.hilog';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0x0000, 'HongHub', '%{public}s', 'HongHub-Harmony onCreate');
  }

  onDestroy(): void {
    hilog.info(0x0000, 'HongHub', '%{public}s', 'HongHub-Harmony onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    hilog.info(0x0000, 'HongHub', '%{public}s', 'onWindowStageCreate');
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(0x0000, 'HongHub', 'Failed to load content. Cause: %{public}s', JSON.stringify(err));
        return;
      }
    });
  }

  onWindowStageDestroy(): void {}

  onForeground(): void {}

  onBackground(): void {}
}
