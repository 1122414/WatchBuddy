import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';

const LOG_DOMAIN = 0x0000;

export default class EntryAbility extends UIAbility {
  onWindowStageCreate(windowStage: window.WindowStage): void {
    try {
      windowStage.loadContent('pages/Index');
    } catch (error) {
      hilog.error(
        LOG_DOMAIN,
        'WatchBuddy',
        'Failed to load main page: %{public}s',
        JSON.stringify(error)
      );
    }
  }
}
