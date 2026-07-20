import { common } from '@kit.AbilityKit';
import { vibrator } from '@kit.SensorServiceKit';
import {
  PetCatalog,
  PetSummary
} from '../network/ApiModels';
import { InstalledPetBundle } from '../pet/PetInstaller';
import {
  advancePetPlayback,
  canTriggerPetTap,
  createDownloadedPetRuntime,
  createPetPlayback,
  DEFAULT_PET_FRAME,
  DEFAULT_PET_RUNTIME,
  PetPlayback,
  PetRuntimeDefinition,
  petAnimationForRuntimeState,
  petInteractionAnimationForRuntime,
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
  @State private usingDownloadedPet: boolean = false;
  @State private petName: string = '芽芽';
  @State private catalogVisible: boolean = false;
  @State private catalogName: string = '宠物目录';
  @State private catalogDescription: string = '加载受控宠物目录';
  @State private catalogStatus: string = '尚未连接';
  @State private catalogPosition: string = '0 / 0';
  @State private installingPet: boolean = false;

  private playback: PetPlayback = createPetPlayback('idle');
  private petRuntime: PetRuntimeDefinition = DEFAULT_PET_RUNTIME;
  private petTimer: number = -1;
  private lastPetTapAt: number = 0;
  private actionActive: boolean = false;
  private demoStateIndex: number = 0;
  private session: WatchBuddySession | null = null;
  private syncing: boolean = false;
  private catalogPets: Array<PetSummary> = [];
  private catalogIndex: number = 0;

  aboutToAppear(): void {
    this.startAnimation(
      petSteadyAnimationForState(this.companionState, this.petRuntime),
      false
    );
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
    this.playback = createPetPlayback(name, this.petRuntime);
    this.petFramePath = this.playback.framePath;
    this.scheduleNextFrame();
  }

  private scheduleNextFrame(): void {
    if (this.playback.done) {
      return;
    }
    this.petTimer = setTimeout(() => {
      this.playback = advancePetPlayback(this.playback, this.petRuntime);
      this.petFramePath = this.playback.framePath;
      if (this.playback.done && this.actionActive) {
        this.petHint = '轻触芽芽';
        this.startAnimation(
          petSteadyAnimationForState(
            this.companionState,
            this.petRuntime
          ),
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
    this.petHint = `${this.petName}跳起来了`;
    this.startAnimation(
      petInteractionAnimationForRuntime('tap', this.petRuntime),
      true
    );
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
    const entryAnimation: string = petAnimationForRuntimeState(
      this.companionState,
      this.petRuntime
    );
    const steadyAnimation: string =
      petSteadyAnimationForState(this.companionState, this.petRuntime);
    this.startAnimation(entryAnimation, entryAnimation !== steadyAnimation);
  }

  private async restoreSession(): Promise<void> {
    if (this.session === null) {
      return;
    }
    try {
      const installed: InstalledPetBundle | null =
        await this.session.loadInstalledPet();
      if (installed !== null) {
        this.activateInstalledPet(installed);
      }
    } catch (error) {
      this.petHint = '已使用内置宠物';
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
    this.startAnimation(
      petInteractionAnimationForRuntime('loading', this.petRuntime),
      true
    );
    try {
      const result: SessionSyncResult = await this.session.sync();
      this.applyCompanionState(result.characterState);
      this.petHint = '服务在线';
      const entryAnimation: string =
        petAnimationForRuntimeState(result.characterState, this.petRuntime);
      const steadyAnimation: string =
        petSteadyAnimationForState(result.characterState, this.petRuntime);
      this.startAnimation(entryAnimation, entryAnimation !== steadyAnimation);
    } catch (error) {
      this.companionState = 'offline';
      this.stateLabel = '离线陪伴';
      this.petHint = this.connectionFailureLabel(error);
      this.startAnimation(
        petInteractionAnimationForRuntime('failure', this.petRuntime),
        true
      );
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
    return `服务离线 · ${this.petName}仍可互动`;
  }

  private async openPetCatalog(): Promise<void> {
    this.catalogVisible = true;
    this.catalogStatus = '正在加载受控目录';
    if (this.session === null) {
      this.catalogStatus = '会话尚未就绪';
      return;
    }
    try {
      const catalog: PetCatalog = await this.session.loadPetCatalog();
      this.catalogPets = catalog.pets;
      this.catalogIndex = 0;
      this.updateCatalogCard();
      this.catalogStatus = '仅显示已转换并校验的宠物';
    } catch (error) {
      this.catalogStatus = this.catalogFailureLabel(error);
    }
  }

  private updateCatalogCard(): void {
    if (this.catalogPets.length < 1) {
      this.catalogName = '宠物目录';
      this.catalogDescription = '暂时没有可安装宠物';
      this.catalogPosition = '0 / 0';
      return;
    }
    const pet: PetSummary = this.catalogPets[this.catalogIndex];
    this.catalogName = pet.displayName;
    this.catalogDescription = pet.description;
    this.catalogPosition =
      `${this.catalogIndex + 1} / ${this.catalogPets.length}`;
  }

  private moveCatalog(offset: number): void {
    if (this.catalogPets.length < 2 || this.installingPet) {
      return;
    }
    this.catalogIndex =
      (this.catalogIndex + offset + this.catalogPets.length)
        % this.catalogPets.length;
    this.updateCatalogCard();
  }

  private async installCatalogPet(): Promise<void> {
    if (this.session === null
      || this.installingPet
      || this.catalogPets.length < 1) {
      return;
    }
    this.installingPet = true;
    const pet: PetSummary = this.catalogPets[this.catalogIndex];
    this.catalogStatus = `准备安装 ${pet.displayName}`;
    try {
      const installed: InstalledPetBundle = await this.session.installPet(
        pet,
        (completed: number, total: number) => {
          this.catalogStatus = `校验并安装 ${completed} / ${total}`;
        }
      );
      this.activateInstalledPet(installed);
      this.catalogStatus = `${installed.pet.displayName} 已安装`;
    } catch (error) {
      this.catalogStatus = this.catalogFailureLabel(error);
    } finally {
      this.installingPet = false;
    }
  }

  private activateInstalledPet(installed: InstalledPetBundle): void {
    this.petRuntime = createDownloadedPetRuntime(
      installed.pet,
      installed.directory
    );
    this.usingDownloadedPet = true;
    this.petName = installed.pet.displayName;
    this.petHint = `轻触${this.petName}`;
    this.startAnimation(
      petSteadyAnimationForState(this.companionState, this.petRuntime),
      false
    );
  }

  private catalogFailureLabel(error: Object): string {
    if (error instanceof Error) {
      if (error.message === 'service_not_configured') {
        return '待配置 HTTPS 服务';
      }
      if (error.message === 'http_401') {
        return '身份已失效 · 请重试';
      }
      if (error.message === 'asset_hash_mismatch'
        || error.message === 'asset_not_png') {
        return '资源校验失败 · 已保留当前宠物';
      }
    }
    return '下载失败 · 已保留当前宠物';
  }

  build() {
    Stack() {
      if (this.catalogVisible) {
        Column() {
          Text('宠物库')
            .fontSize(25)
            .fontWeight(FontWeight.Bold)
            .fontColor('#F4F7FB')
            .margin({ top: 46 })

          Text(this.catalogPosition)
            .fontSize(13)
            .fontColor('#7BF2BF')
            .margin({ top: 8 })

          Text(this.catalogName)
            .fontSize(24)
            .fontWeight(FontWeight.Medium)
            .fontColor('#F4F7FB')
            .margin({ top: 16 })

          Text(this.catalogDescription)
            .fontSize(15)
            .fontColor('#C7D2E3')
            .textAlign(TextAlign.Center)
            .maxLines(3)
            .width(320)
            .height(72)
            .margin({ top: 8 })

          Text(this.catalogStatus)
            .fontSize(14)
            .fontColor('#7BF2BF')
            .textAlign(TextAlign.Center)
            .maxLines(2)
            .width(330)
            .height(48)
            .margin({ top: 8 })

          Row({ space: 12 }) {
            Button('上一个')
              .type(ButtonType.Capsule)
              .fontSize(14)
              .backgroundColor('#25344A')
              .width(104)
              .height(40)
              .onClick(() => {
                this.moveCatalog(-1);
              })

            Button(this.installingPet ? '安装中' : '安装')
              .type(ButtonType.Capsule)
              .fontSize(14)
              .fontColor('#0C1018')
              .backgroundColor('#7BF2BF')
              .width(104)
              .height(40)
              .onClick(() => {
                this.installCatalogPet();
              })

            Button('下一个')
              .type(ButtonType.Capsule)
              .fontSize(14)
              .backgroundColor('#25344A')
              .width(104)
              .height(40)
              .onClick(() => {
                this.moveCatalog(1);
              })
          }
          .margin({ top: 12 })

          Button('返回')
            .type(ButtonType.Capsule)
            .fontSize(14)
            .fontColor('#F4F7FB')
            .backgroundColor('#1A2535')
            .width(156)
            .height(40)
            .margin({ top: 14 })
            .onClick(() => {
              if (!this.installingPet) {
                this.catalogVisible = false;
              }
            })
        }
        .alignItems(HorizontalAlign.Center)
        .width('100%')
        .height('100%')
      } else {
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

            if (this.usingDownloadedPet) {
              Image(this.petFramePath)
                .width(184)
                .height(200)
                .objectFit(ImageFit.Contain)
            } else {
              Image($rawfile(this.petFramePath))
                .width(184)
                .height(200)
                .objectFit(ImageFit.Contain)
            }
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

            Button('宠物库')
              .type(ButtonType.Capsule)
              .fontSize(15)
              .fontColor('#F4F7FB')
              .backgroundColor('#25344A')
              .height(42)
              .width(126)
              .onClick(() => {
                this.openPetCatalog();
              })
          }
          .margin({ top: 4 })
        }
        .alignItems(HorizontalAlign.Center)
        .width('100%')
        .height('100%')
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#0C1018')
  }
}
