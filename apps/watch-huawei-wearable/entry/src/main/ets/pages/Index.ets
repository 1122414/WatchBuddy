import { common } from '@kit.AbilityKit';
import { vibrator } from '@kit.SensorServiceKit';
import {
  advancePetPlayback,
  canTriggerPetTap,
  createPetPlayback,
  DEFAULT_PET_FRAME,
  PetPlayback,
  petAnimationForState,
  petInteractionAnimation,
  petSteadyAnimationForState
} from '../pet/PetRuntime';
import {
  SessionSyncResult,
  WatchBuddySession
} from '../runtime/WatchBuddySession';

@Entry
@Component
struct Index {
  @State private companionState: string = 'idle';
  @State private stateLabel: string = '空闲陪伴';
  @State private petFramePath: string = DEFAULT_PET_FRAME;
  @State private petHint: string = '轻触芽芽';

  private playback: PetPlayback = createPetPlayback('idle');
  private petTimer: number = -1;
  private lastPetTapAt: number = 0;
  private actionActive: boolean = false;
  private demoStateIndex: number = 0;
  private session: WatchBuddySession | null = null;
  private syncing: boolean = false;

  aboutToAppear(): void {
    this.startAnimation(petSteadyAnimationForState(this.companionState), false);
    const context: common.UIAbilityContext =
      this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.session = new WatchBuddySession(context);
    this.restoreSession();
  }

  aboutToDisappear(): void {
    this.cancelPetTimer();
  }

  private cancelPetTimer(): void {
    if (this.petTimer >= 0) {
      clearTimeout(this.petTimer);
      this.petTimer = -1;
    }
  }

  private startAnimation(name: string, actionActive: boolean): void {
    this.cancelPetTimer();
    this.actionActive = actionActive;
    this.playback = createPetPlayback(name);
    this.petFramePath = this.playback.framePath;
    this.scheduleNextFrame();
  }

  private scheduleNextFrame(): void {
    if (this.playback.done) {
      return;
    }
    this.petTimer = setTimeout(() => {
      this.playback = advancePetPlayback(this.playback);
      this.petFramePath = this.playback.framePath;
      if (this.playback.done && this.actionActive) {
        this.petHint = '轻触芽芽';
        this.startAnimation(
          petSteadyAnimationForState(this.companionState),
          false
        );
        return;
      }
      this.scheduleNextFrame();
    }, this.playback.delayMs);
  }

  private triggerTap(): void {
    const now: number = Date.now();
    if (!canTriggerPetTap(this.lastPetTapAt, now)) {
      return;
    }
    this.lastPetTapAt = now;
    this.petHint = '芽芽跳起来了';
    this.startAnimation(petInteractionAnimation('tap'), true);
    this.giveTapFeedback();
  }

  private giveTapFeedback(): void {
    try {
      vibrator.startVibration(
        {
          type: 'time',
          duration: 35
        },
        {
          id: 0,
          usage: 'touch'
        },
        () => {
        }
      );
    } catch (error) {
      // 部分手表可能禁用触感；动画互动不依赖振动成功。
    }
  }

  private cycleDemoState(): void {
    const states: Array<string> = [
      'idle',
      'daydreaming',
      'watching',
      'curious',
      'concerned',
      'chatting',
      'giving_space',
      'offline'
    ];
    const labels: Array<string> = [
      '空闲陪伴',
      '安静等待',
      '认真观察',
      '好奇',
      '关心你',
      '回复反馈',
      '给你空间',
      '离线陪伴'
    ];
    this.demoStateIndex = (this.demoStateIndex + 1) % states.length;
    this.companionState = states[this.demoStateIndex];
    this.stateLabel = labels[this.demoStateIndex];
    this.petHint = '状态已切换';
    const entryAnimation: string = petAnimationForState(this.companionState);
    const steadyAnimation: string =
      petSteadyAnimationForState(this.companionState);
    this.startAnimation(entryAnimation, entryAnimation !== steadyAnimation);
  }

  private async restoreSession(): Promise<void> {
    if (this.session === null) {
      return;
    }
    try {
      const restoredState: string = await this.session.restore();
      this.applyCompanionState(restoredState);
      this.petHint = this.session.isConfigured()
        ? '点同步连接服务'
        : '待配置 HTTPS 服务';
    } catch (error) {
      this.petHint = '本地状态恢复失败';
    }
  }

  private async syncNow(): Promise<void> {
    if (this.session === null || this.syncing) {
      return;
    }
    this.syncing = true;
    this.petHint = '正在连接服务';
    this.startAnimation(petInteractionAnimation('loading'), true);
    try {
      const result: SessionSyncResult = await this.session.sync();
      this.applyCompanionState(result.characterState);
      this.petHint = '服务在线';
      const entryAnimation: string =
        petAnimationForState(result.characterState);
      const steadyAnimation: string =
        petSteadyAnimationForState(result.characterState);
      this.startAnimation(entryAnimation, entryAnimation !== steadyAnimation);
    } catch (error) {
      this.companionState = 'offline';
      this.stateLabel = '离线陪伴';
      this.petHint = this.connectionFailureLabel(error);
      this.startAnimation(petInteractionAnimation('failure'), true);
    } finally {
      this.syncing = false;
    }
  }

  private applyCompanionState(state: string): void {
    this.companionState = state;
    switch (state) {
      case 'sleeping':
        this.stateLabel = '睡眠中';
        break;
      case 'daydreaming':
        this.stateLabel = '安静等待';
        break;
      case 'watching':
        this.stateLabel = '认真观察';
        break;
      case 'curious':
        this.stateLabel = '好奇';
        break;
      case 'concerned':
        this.stateLabel = '关心你';
        break;
      case 'chatting':
        this.stateLabel = '回复反馈';
        break;
      case 'giving_space':
        this.stateLabel = '给你空间';
        break;
      default:
        this.stateLabel = '空闲陪伴';
        break;
    }
  }

  private connectionFailureLabel(error: Object): string {
    if (error instanceof Error) {
      if (error.message === 'service_not_configured') {
        return '待配置 HTTPS 服务';
      }
      if (error.message === 'http_401') {
        return '身份已失效 · 请重试';
      }
      if (error.message === 'secure_store_unavailable'
        || error.message === 'secure_store_verify_failed') {
        return '安全存储不可用';
      }
    }
    return '服务离线 · 芽芽仍可互动';
  }

  build() {
    Stack() {
      Column() {
        Text('WatchBuddy')
          .fontSize(25)
          .fontWeight(FontWeight.Bold)
          .fontColor('#F4F7FB')
          .margin({ top: 40 })

        Row({ space: 7 }) {
          Circle()
            .width(8)
            .height(8)
            .fill('#7BF2BF')

          Text(this.stateLabel)
            .fontSize(15)
            .fontColor('#C7D2E3')
        }
        .margin({ top: 6 })

        Stack() {
          Circle()
            .width(224)
            .height(224)
            .fill('#151C29')
            .stroke('#26354A')
            .strokeWidth(2)

          Image($rawfile(this.petFramePath))
            .width(184)
            .height(200)
            .objectFit(ImageFit.Contain)
        }
        .width(230)
        .height(230)
        .margin({ top: 4 })
        .onClick(() => {
          this.triggerTap();
        })

        Text(this.petHint)
          .fontSize(15)
          .fontColor('#7BF2BF')
          .height(24)

        Row({ space: 8 }) {
          Button('同步')
            .type(ButtonType.Capsule)
            .fontSize(15)
            .fontColor('#0C1018')
            .backgroundColor('#7BF2BF')
            .height(42)
            .width(126)
            .onClick(() => {
              this.syncNow();
            })

          Button('状态演示')
            .type(ButtonType.Capsule)
            .fontSize(15)
            .fontColor('#F4F7FB')
            .backgroundColor('#25344A')
            .height(42)
            .width(126)
            .onClick(() => {
              this.cycleDemoState();
            })
        }
        .margin({ top: 4 })
      }
      .alignItems(HorizontalAlign.Center)
      .width('100%')
      .height('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#0C1018')
  }
}
