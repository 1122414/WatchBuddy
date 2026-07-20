import { common } from '@kit.AbilityKit';
import { vibrator } from '@kit.SensorServiceKit';
import {
  CompanionNudge,
  MemoryItem,
  MemoryPage,
  NudgeAction,
  PetCatalog,
  PetSummary,
  ReplyResult
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
  @State private quietMode: boolean = false;
  @State private quietModeLabel: string = '安静：关';
  @State private messageVisible: boolean = false;
  @State private messageText: string = '';
  @State private actionOneLabel: string = '';
  @State private actionTwoLabel: string = '';
  @State private actionThreeLabel: string = '';
  @State private actionFourLabel: string = '';
  @State private replying: boolean = false;
  @State private messageStatus: string = '回复会直接从手表发送';
  @State private memoryVisible: boolean = false;
  @State private memoryStatus: string = '尚未读取';
  @State private memoryOne: string = '';
  @State private memoryTwo: string = '';
  @State private memoryThree: string = '';
  @State private memoryOneVisible: boolean = false;
  @State private memoryTwoVisible: boolean = false;
  @State private memoryThreeVisible: boolean = false;
  @State private confirmClearMemories: boolean = false;

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
  private currentNudgeId: string = '';
  private actionOneId: string = '';
  private actionTwoId: string = '';
  private actionThreeId: string = '';
  private actionFourId: string = '';
  private memoryOneId: string = '';
  private memoryTwoId: string = '';
  private memoryThreeId: string = '';

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
      this.quietMode = result.quietMode;
      this.quietModeLabel = result.quietMode ? '安静：开' : '安静：关';
      if (result.nudge !== null) {
        this.presentNudge(result.nudge);
      } else {
        this.clearNudge();
      }
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

  private presentNudge(nudge: CompanionNudge): void {
    this.currentNudgeId = nudge.nudgeId;
    this.messageText = nudge.message;
    this.assignNudgeAction(nudge.actions, 0);
    this.assignNudgeAction(nudge.actions, 1);
    this.assignNudgeAction(nudge.actions, 2);
    this.assignNudgeAction(nudge.actions, 3);
    this.messageStatus = '回复会直接从手表发送';
    this.messageVisible = true;
  }

  private assignNudgeAction(
    actions: Array<NudgeAction>,
    index: number
  ): void {
    const action: NudgeAction | null =
      index < actions.length ? actions[index] : null;
    const id: string = action === null ? '' : action.id;
    const label: string = action === null ? '' : action.label;
    switch (index) {
      case 0:
        this.actionOneId = id;
        this.actionOneLabel = label;
        break;
      case 1:
        this.actionTwoId = id;
        this.actionTwoLabel = label;
        break;
      case 2:
        this.actionThreeId = id;
        this.actionThreeLabel = label;
        break;
      default:
        this.actionFourId = id;
        this.actionFourLabel = label;
        break;
    }
  }

  private clearNudge(): void {
    this.messageVisible = false;
    this.currentNudgeId = '';
    this.messageText = '';
    this.assignNudgeAction([], 0);
    this.assignNudgeAction([], 1);
    this.assignNudgeAction([], 2);
    this.assignNudgeAction([], 3);
  }

  private async replyWithAction(actionId: string): Promise<void> {
    if (this.session === null
      || this.replying
      || this.currentNudgeId.length === 0
      || actionId.length === 0) {
      return;
    }
    this.replying = true;
    try {
      const result: ReplyResult = await this.session.replyToNudge(
        this.currentNudgeId,
        actionId
      );
      this.clearNudge();
      this.applyCompanionState(result.characterState);
      this.petHint = '回复已送达';
      this.startAnimation(
        petInteractionAnimationForRuntime('message', this.petRuntime),
        true
      );
    } catch (error) {
      this.messageStatus = this.replyFailureLabel(error);
      this.petHint = this.messageStatus;
    } finally {
      this.replying = false;
    }
  }

  private replyFailureLabel(error: Object): string {
    if (error instanceof Error) {
      if (error.message === 'service_not_configured') {
        return '待配置 HTTPS 服务';
      }
      if (error.message === 'reply_retry_exhausted') {
        return '回复待发送 · 点同步重试';
      }
      if (error.message === 'http_400') {
        this.clearNudge();
        return '消息已过期';
      }
    }
    return '回复暂存 · 稍后重试';
  }

  private async toggleQuietMode(): Promise<void> {
    if (this.session === null || this.syncing) {
      return;
    }
    this.syncing = true;
    this.quietModeLabel = '设置中';
    try {
      this.quietMode = await this.session.setQuietMode(!this.quietMode);
      this.quietModeLabel = this.quietMode ? '安静：开' : '安静：关';
      if (this.quietMode) {
        this.clearNudge();
      }
      this.petHint = this.quietMode
        ? '安静模式已开启'
        : '安静模式已关闭';
    } catch (error) {
      this.quietModeLabel = this.quietMode ? '安静：开' : '安静：关';
      this.petHint = this.connectionFailureLabel(error);
    } finally {
      this.syncing = false;
    }
  }

  private async openMemories(): Promise<void> {
    this.memoryVisible = true;
    this.confirmClearMemories = false;
    await this.loadMemories();
  }

  private async loadMemories(): Promise<void> {
    if (this.session === null) {
      this.memoryStatus = '会话尚未就绪';
      return;
    }
    this.memoryStatus = '正在读取';
    try {
      const page: MemoryPage = await this.session.memories(3, 0);
      this.applyMemories(page.memories);
    } catch (error) {
      this.memoryStatus = this.memoryFailureLabel(error);
    }
  }

  private applyMemories(memories: Array<MemoryItem>): void {
    this.applyMemorySlot(memories, 0);
    this.applyMemorySlot(memories, 1);
    this.applyMemorySlot(memories, 2);
    this.memoryStatus = memories.length > 0 ? '最近记忆' : '还没有记忆';
  }

  private applyMemorySlot(
    memories: Array<MemoryItem>,
    index: number
  ): void {
    const memory: MemoryItem | null =
      index < memories.length ? memories[index] : null;
    const id: string = memory === null ? '' : memory.id;
    const summary: string = memory === null ? '' : memory.summary;
    switch (index) {
      case 0:
        this.memoryOneId = id;
        this.memoryOne = summary;
        this.memoryOneVisible = memory !== null;
        break;
      case 1:
        this.memoryTwoId = id;
        this.memoryTwo = summary;
        this.memoryTwoVisible = memory !== null;
        break;
      default:
        this.memoryThreeId = id;
        this.memoryThree = summary;
        this.memoryThreeVisible = memory !== null;
        break;
    }
  }

  private async deleteOneMemory(memoryId: string): Promise<void> {
    if (this.session === null || memoryId.length === 0) {
      return;
    }
    this.memoryStatus = '正在删除';
    try {
      await this.session.deleteMemory(memoryId);
      await this.loadMemories();
    } catch (error) {
      this.memoryStatus = this.memoryFailureLabel(error);
    }
  }

  private async requestClearMemories(): Promise<void> {
    if (!this.confirmClearMemories) {
      this.confirmClearMemories = true;
      this.memoryStatus = '再次点按以清空全部记忆';
      return;
    }
    if (this.session === null) {
      return;
    }
    this.confirmClearMemories = false;
    this.memoryStatus = '正在清空';
    try {
      await this.session.clearMemories();
      this.applyMemories([]);
    } catch (error) {
      this.memoryStatus = this.memoryFailureLabel(error);
    }
  }

  private memoryFailureLabel(error: Object): string {
    if (error instanceof Error
      && error.message === 'service_not_configured') {
      return '待配置 HTTPS 服务';
    }
    return '记忆服务暂不可用';
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
      } else if (this.memoryVisible) {
        Column() {
          Text('记忆')
            .fontSize(25)
            .fontWeight(FontWeight.Bold)
            .fontColor('#F4F7FB')
            .margin({ top: 38 })

          Text(this.memoryStatus)
            .fontSize(14)
            .fontColor('#7BF2BF')
            .height(40)
            .margin({ top: 6 })

          if (this.memoryOneVisible) {
            Row({ space: 8 }) {
              Text(this.memoryOne)
                .fontSize(14)
                .fontColor('#D8E0EC')
                .maxLines(2)
                .width(246)

              Button('删除')
                .type(ButtonType.Capsule)
                .fontSize(13)
                .width(70)
                .height(36)
                .backgroundColor('#3A2934')
                .onClick(() => {
                  this.deleteOneMemory(this.memoryOneId);
                })
            }
            .height(66)
          }

          if (this.memoryTwoVisible) {
            Row({ space: 8 }) {
              Text(this.memoryTwo)
                .fontSize(14)
                .fontColor('#D8E0EC')
                .maxLines(2)
                .width(246)

              Button('删除')
                .type(ButtonType.Capsule)
                .fontSize(13)
                .width(70)
                .height(36)
                .backgroundColor('#3A2934')
                .onClick(() => {
                  this.deleteOneMemory(this.memoryTwoId);
                })
            }
            .height(66)
          }

          if (this.memoryThreeVisible) {
            Row({ space: 8 }) {
              Text(this.memoryThree)
                .fontSize(14)
                .fontColor('#D8E0EC')
                .maxLines(2)
                .width(246)

              Button('删除')
                .type(ButtonType.Capsule)
                .fontSize(13)
                .width(70)
                .height(36)
                .backgroundColor('#3A2934')
                .onClick(() => {
                  this.deleteOneMemory(this.memoryThreeId);
                })
            }
            .height(66)
          }

          Row({ space: 10 }) {
            Button(this.confirmClearMemories ? '确认清空' : '清空全部')
              .type(ButtonType.Capsule)
              .fontSize(14)
              .fontColor('#F4D9DF')
              .backgroundColor('#3A2934')
              .width(136)
              .height(40)
              .onClick(() => {
                this.requestClearMemories();
              })

            Button('返回')
              .type(ButtonType.Capsule)
              .fontSize(14)
              .fontColor('#F4F7FB')
              .backgroundColor('#25344A')
              .width(136)
              .height(40)
              .onClick(() => {
                this.memoryVisible = false;
                this.confirmClearMemories = false;
              })
          }
          .margin({ top: 12 })
        }
        .alignItems(HorizontalAlign.Center)
        .width('100%')
        .height('100%')
      } else if (this.messageVisible) {
        Column() {
          Text(`${this.petName}想问`)
            .fontSize(25)
            .fontWeight(FontWeight.Bold)
            .fontColor('#F4F7FB')
            .margin({ top: 58 })

          Text(this.messageText)
            .fontSize(20)
            .fontColor('#D8E0EC')
            .textAlign(TextAlign.Center)
            .maxLines(4)
            .width(320)
            .height(116)
            .margin({ top: 24 })

          Row({ space: 12 }) {
            Button(this.actionOneLabel)
              .type(ButtonType.Capsule)
              .fontSize(15)
              .fontColor('#0C1018')
              .backgroundColor('#7BF2BF')
              .width(146)
              .height(44)
              .onClick(() => {
                this.replyWithAction(this.actionOneId);
              })

            Button(this.actionTwoLabel)
              .type(ButtonType.Capsule)
              .fontSize(15)
              .fontColor('#F4F7FB')
              .backgroundColor('#25344A')
              .width(146)
              .height(44)
              .onClick(() => {
                this.replyWithAction(this.actionTwoId);
              })
          }

          if (this.actionThreeId.length > 0) {
            Row({ space: 12 }) {
              Button(this.actionThreeLabel)
                .type(ButtonType.Capsule)
                .fontSize(15)
                .fontColor('#F4F7FB')
                .backgroundColor('#25344A')
                .width(146)
                .height(44)
                .onClick(() => {
                  this.replyWithAction(this.actionThreeId);
                })

              if (this.actionFourId.length > 0) {
                Button(this.actionFourLabel)
                  .type(ButtonType.Capsule)
                  .fontSize(15)
                  .fontColor('#F4F7FB')
                  .backgroundColor('#25344A')
                  .width(146)
                  .height(44)
                  .onClick(() => {
                    this.replyWithAction(this.actionFourId);
                  })
              }
            }
            .margin({ top: 12 })
          }

          Text(this.replying ? '正在送达' : this.messageStatus)
            .fontSize(13)
            .fontColor('#7BF2BF')
            .margin({ top: 18 })

          Button('返回主页')
            .type(ButtonType.Capsule)
            .fontSize(13)
            .fontColor('#D8E0EC')
            .backgroundColor('#1A2535')
            .width(132)
            .height(36)
            .margin({ top: 10 })
            .onClick(() => {
              if (!this.replying) {
                this.messageVisible = false;
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

          Row({ space: 8 }) {
            Button(this.quietModeLabel)
              .type(ButtonType.Capsule)
              .fontSize(14)
              .fontColor('#D8E0EC')
              .backgroundColor('#1A2535')
              .height(36)
              .width(126)
              .onClick(() => {
                this.toggleQuietMode();
              })

            Button('记忆')
              .type(ButtonType.Capsule)
              .fontSize(14)
              .fontColor('#D8E0EC')
              .backgroundColor('#1A2535')
              .height(36)
              .width(126)
              .onClick(() => {
                this.openMemories();
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
