import prompt from '@system.prompt';
import storage from '@system.storage';
import vibrator from '@system.vibrator';

import {
  clearMemories,
  deleteMemory,
  fetchCompanionState,
  fetchMemories,
  fetchPetCatalog,
  fetchPetDetail,
  registerWatchBuddy,
  replyToCompanion,
  updateSettings
} from '../../common/watch-api-client.js';
import {
  canRetryReply,
  createPendingReply,
  deserializePendingReply,
  MAX_REPLY_ATTEMPTS,
  recordReplyFailure,
  serializePendingReply
} from '../../common/watch-outbox.js';
import {
  deserializeIdentity,
  deserializeNudge,
  deserializePetSelection,
  ensureStorageValue,
  serializeIdentity,
  serializeNudge,
  serializePetSelection
} from '../../common/watch-storage-contract.js';
import {
  advancePetPlayback,
  canTriggerPetTap,
  createDownloadedPetRuntime,
  createPetPlayback,
  DEFAULT_PET_FRAME,
  getPetAnimation,
  petAnimationForState,
  petInteractionAnimation,
  petSteadyAnimationForState
} from '../../common/watch-pet-runtime.js';
import {
  installPetBundle,
  loadInstalledPet
} from '../../common/watch-pet-installer.js';
import { watchPetFiles } from '../../common/watch-pet-files.js';
import {
  createWatchPetTransport
} from '../../common/watch-pet-transport.js';

const IDENTITY_STORAGE_KEY = 'wb_identity';
const PENDING_META_STORAGE_KEY = 'wb_pending_meta';
const PENDING_PAYLOAD_STORAGE_KEY = 'wb_pending_payload';
const NUDGE_META_STORAGE_KEY = 'wb_nudge_meta';
const NUDGE_MESSAGE_STORAGE_KEY = 'wb_nudge_message';
const PET_SELECTION_STORAGE_KEY = 'wb_pet_selection';
const NUDGE_ACTION_STORAGE_KEYS = [
  'wb_nudge_action_1',
  'wb_nudge_action_2',
  'wb_nudge_action_3',
  'wb_nudge_action_4'
];

const STATE_LABELS = {
  sleeping: '睡觉',
  idle: '空闲',
  daydreaming: '发呆',
  watching: '观察',
  curious: '好奇',
  concerned: '关心',
  chatting: '聊天',
  giving_space: '安静陪伴'
};

export default {
  data: {
    state: 'idle',
    stateLabel: '空闲',
    characterClass: 'idle',
    petFramePath: DEFAULT_PET_FRAME,
    messageVisible: false,
    message: '',
    actionOne: '',
    actionTwo: '',
    actionThree: '',
    actionFour: '',
    actionOneId: '',
    actionTwoId: '',
    actionThreeId: '',
    actionFourId: '',
    currentNudgeId: '',
    currentNudgeCreatedAt: 0,
    connectionLabel: '正在连接',
    quietMode: false,
    quietModeLabel: '安静：关',
    mainScreen: true,
    memoryScreen: false,
    memoryStatus: '正在读取',
    memoryOneVisible: false,
    memoryTwoVisible: false,
    memoryThreeVisible: false,
    memoryOne: '',
    memoryTwo: '',
    memoryThree: '',
    memoryOneId: '',
    memoryTwoId: '',
    memoryThreeId: '',
    petScreen: false,
    petCatalogName: '宠物目录',
    petCatalogDescription: '正在读取可用宠物',
    petCatalogPosition: '',
    petCatalogStatus: '尚未读取',
    petCatalogAction: '下载并使用'
  },

  onInit() {
    this.visible = false;
    this.identityReady = false;
    this.deviceId = '';
    this.deviceToken = '';
    this.registrationKey = '';
    this.pendingReply = null;
    this.pendingReplyReady = false;
    this.cachedNudge = null;
    this.cachedNudgeReady = false;
    this.activeRequest = null;
    this.retryTimer = null;
    this.petTimer = null;
    this.petPlayback = null;
    this.petActionActive = false;
    this.petRuntime = null;
    this.downloadedPet = null;
    this.petCatalog = [];
    this.petCatalogIndex = 0;
    this.petInstaller = null;
    this.lastPetTapAt = 0;
    this.restoreState();
    this.restoreCachedNudge();
    this.restorePendingReply();
    this.restorePetSelection();
    this.restoreIdentity();
  },

  onShow() {
    this.visible = true;
    if (!this.memoryScreen && !this.petScreen) {
      if (this.messageVisible) {
        this.startPetInteraction(
          petInteractionAnimation('message', this.petRuntime)
        );
      } else {
        this.playPetStateEntry();
      }
      this.ensureConnected();
    }
  },

  onHide() {
    this.visible = false;
    this.cancelActiveWork();
  },

  onDestroy() {
    this.visible = false;
    this.cancelActiveWork();
  },

  restoreState() {
    storage.get({
      key: 'watchbuddy_state',
      success: (value) => {
        if (value && STATE_LABELS[value]) {
          this.setState(value);
          return;
        }
        this.applyTimeState();
      },
      fail: () => this.applyTimeState()
    });
  },

  restoreCachedNudge() {
    this.readValue(NUDGE_META_STORAGE_KEY, (meta) => {
      this.readValue(NUDGE_MESSAGE_STORAGE_KEY, (message) => {
        this.readCachedActions(0, [], (actions) => {
          try {
            const nudge = deserializeNudge(meta, message, actions);
            if (nudge.expiresAt > Date.now()) {
              this.cachedNudge = nudge;
            }
          } catch (error) {
            this.cachedNudge = null;
          }
          this.cachedNudgeReady = true;
          this.applyRestoredNudge();
        });
      });
    });
  },

  restorePendingReply() {
    this.readValue(PENDING_META_STORAGE_KEY, (meta) => {
      this.readValue(PENDING_PAYLOAD_STORAGE_KEY, (payload) => {
        try {
          this.pendingReply = deserializePendingReply(meta, payload);
          this.messageVisible = false;
          this.schedulePendingReply();
        } catch (error) {
          this.pendingReply = null;
          this.deletePendingReply();
        }
        this.pendingReplyReady = true;
        this.applyRestoredNudge();
      });
    });
  },

  restoreIdentity() {
    this.readValue(IDENTITY_STORAGE_KEY, (value) => {
      try {
        const identity = deserializeIdentity(value);
        this.deviceId = identity.deviceId;
        this.deviceToken = identity.deviceToken;
        this.registrationKey = identity.registrationKey;
      } catch (error) {
        this.deviceId = '';
        this.deviceToken = '';
        this.registrationKey = '';
      }

      if (!this.deviceId) {
        this.deviceId = this.createLocalId('gt6pro');
      }
      if (!this.deviceToken && !this.registrationKey) {
        this.registrationKey = this.createLocalId('register');
      }

      this.identityReady = true;
      this.persistIdentity();
      if (this.visible) {
        this.ensureConnected();
      }
    });
  },

  restorePetSelection() {
    this.readValue(PET_SELECTION_STORAGE_KEY, (value) => {
      let selection;
      try {
        selection = deserializePetSelection(value);
      } catch (error) {
        this.deleteStored(PET_SELECTION_STORAGE_KEY);
        return;
      }
      loadInstalledPet(selection, watchPetFiles, {
        onFailure: function() {
          this.downloadedPet = null;
          this.petRuntime = null;
          this.deleteStored(PET_SELECTION_STORAGE_KEY);
        }.bind(this),
        onSuccess: function(pet) {
          this.applyDownloadedPet(pet);
        }.bind(this)
      });
    });
  },

  applyDownloadedPet(pet) {
    try {
      this.petRuntime = createDownloadedPetRuntime(pet);
      this.downloadedPet = pet;
    } catch (error) {
      this.petRuntime = null;
      this.downloadedPet = null;
      this.deleteStored(PET_SELECTION_STORAGE_KEY);
      return;
    }
    if (this.visible && !this.memoryScreen && !this.petScreen) {
      this.playPetStateEntry();
    }
  },

  ensureConnected() {
    if (!this.visible || !this.identityReady) {
      return;
    }
    if (!this.deviceToken) {
      this.registerDevice();
      return;
    }
    this.syncCompanionState();
  },

  registerDevice() {
    this.cancelRequest();
    this.connectionLabel = '正在注册';
    this.startPetInteraction(
      petInteractionAnimation('loading', this.petRuntime)
    );
    this.activeRequest = registerWatchBuddy({
      deviceId: this.deviceId,
      locale: 'zh-CN',
      timezoneOffsetMinutes: -new Date().getTimezoneOffset()
    }, this.registrationKey, {
      onSuccess: function(result) {
        this.activeRequest = null;
        this.deviceToken = result.data.deviceToken;
        this.registrationKey = '';
        this.persistIdentity();
        this.connectionLabel = '服务在线';
        this.syncCompanionState();
      }.bind(this),
      onFailure: function(reason) {
        this.activeRequest = null;
        this.connectionLabel = this.connectionLabelForFailure(reason);
        this.startPetInteraction(
          petInteractionAnimation('failure', this.petRuntime)
        );
      }.bind(this)
    });
  },

  syncCompanionState(preservePetAction = false) {
    this.cancelRequest();
    this.connectionLabel = '正在连接';
    if (!preservePetAction) {
      this.startPetInteraction(
        petInteractionAnimation('loading', this.petRuntime)
      );
    }
    this.activeRequest = fetchCompanionState(this.deviceToken, {
      onSuccess: function(result) {
        this.activeRequest = null;
        const state = result.data;
        this.connectionLabel = '服务在线';
        this.quietMode = state.settings.quietMode;
        this.quietModeLabel = this.quietMode ? '安静：开' : '安静：关';
        this.setState(state.characterState);
        if (state.nudge) {
          this.persistNudge(state.nudge);
          if (!this.pendingReply
            || this.pendingReply.payload.nudgeId !== state.nudge.nudgeId) {
            this.presentMessage(state.nudge);
          } else {
            this.messageVisible = false;
          }
        } else {
          this.deleteCachedNudge();
          this.messageVisible = false;
          this.currentNudgeId = '';
        }
        if (!this.messageVisible && !preservePetAction) {
          this.finishPetInteraction();
        }
        this.schedulePendingReply();
      }.bind(this),
      onFailure: function(reason) {
        this.activeRequest = null;
        this.connectionLabel = this.connectionLabelForFailure(reason);
        this.startPetInteraction(
          petInteractionAnimation('failure', this.petRuntime)
        );
        this.schedulePendingReply();
      }.bind(this)
    });
  },

  checkServer() {
    if (this.pendingReply
      && this.pendingReply.attempts >= MAX_REPLY_ATTEMPTS) {
      this.pendingReply.attempts = 0;
      this.pendingReply.nextAttemptAt = Date.now();
      this.persistPendingReply();
    }
    this.ensureConnected();
  },

  toggleQuietMode() {
    if (!this.deviceToken) {
      this.connectionLabel = '尚未注册';
      return;
    }
    const nextQuietMode = !this.quietMode;
    this.cancelRequest();
    this.quietModeLabel = '设置中';
    this.activeRequest = updateSettings(
      this.deviceToken,
      nextQuietMode,
      {
        onSuccess: function(result) {
          this.activeRequest = null;
          this.quietMode = result.data.quietMode;
          this.quietModeLabel = this.quietMode ? '安静：开' : '安静：关';
          this.connectionLabel = this.quietMode
            ? '安静模式已开启'
            : '安静模式已关闭';
          this.syncCompanionState();
        }.bind(this),
        onFailure: function(reason) {
          this.activeRequest = null;
          this.quietModeLabel = this.quietMode ? '安静：开' : '安静：关';
          this.connectionLabel = this.connectionLabelForFailure(reason);
        }.bind(this)
      }
    );
  },

  applyTimeState() {
    const hour = new Date().getHours();
    if (hour >= 23 || hour < 7) {
      this.setState('sleeping');
    } else if (hour < 9) {
      this.setState('watching');
    } else {
      this.setState('idle');
    }
  },

  setState(nextState) {
    if (!STATE_LABELS[nextState]) {
      return;
    }
    const stateChanged = this.state !== nextState;
    this.state = nextState;
    this.stateLabel = STATE_LABELS[nextState];
    this.characterClass = nextState === 'giving_space'
      ? 'giving-space'
      : nextState;
    storage.set({
      key: 'watchbuddy_state',
      value: nextState
    });
    if (stateChanged
      && this.visible
      && !this.memoryScreen
      && !this.petScreen
      && !this.petActionActive) {
      this.playPetStateEntry();
    }
  },

  onCharacterTap() {
    const now = Date.now();
    if (!canTriggerPetTap(this.lastPetTapAt, now)) {
      return;
    }
    this.lastPetTapAt = now;
    this.startPetInteraction(
      petInteractionAnimation('tap', this.petRuntime)
    );
    this.syncCompanionState(true);
    this.vibrate();
  },

  presentMessage(nudge) {
    if (!nudge || !Array.isArray(nudge.actions)) {
      return;
    }
    this.setState(nudge.characterState);
    this.message = nudge.message;
    this.actionOne = this.actionLabel(nudge.actions[0]);
    this.actionTwo = this.actionLabel(nudge.actions[1]);
    this.actionThree = this.actionLabel(nudge.actions[2]);
    this.actionFour = this.actionLabel(nudge.actions[3]);
    this.actionOneId = this.actionId(nudge.actions[0]);
    this.actionTwoId = this.actionId(nudge.actions[1]);
    this.actionThreeId = this.actionId(nudge.actions[2]);
    this.actionFourId = this.actionId(nudge.actions[3]);
    this.currentNudgeId = nudge.nudgeId;
    this.currentNudgeCreatedAt = nudge.createdAt;
    this.messageVisible = true;
    this.startPetInteraction(
      petInteractionAnimation('message', this.petRuntime)
    );
  },

  replyOne() {
    this.finishReply(this.actionOneId);
  },

  replyTwo() {
    this.finishReply(this.actionTwoId);
  },

  replyThree() {
    this.finishReply(this.actionThreeId);
  },

  replyFour() {
    this.finishReply(this.actionFourId);
  },

  finishReply(actionId) {
    if (this.pendingReply || !actionId || !this.currentNudgeId) {
      return;
    }
    this.pendingReply = createPendingReply({
      actionId,
      nudgeId: this.currentNudgeId
    }, this.createLocalId('reply'));
    this.messageVisible = false;
    this.connectionLabel = '正在发送';
    this.startPetInteraction(
      petInteractionAnimation('loading', this.petRuntime)
    );
    this.persistPendingReply();
    this.sendPendingReply();
  },

  sendPendingReply() {
    if (!this.deviceToken
      || !this.pendingReply
      || !canRetryReply(this.pendingReply)) {
      return;
    }

    this.cancelRequest();
    const pending = this.pendingReply;
    this.startPetInteraction(
      petInteractionAnimation('loading', this.petRuntime)
    );
    this.activeRequest = replyToCompanion(
      this.deviceToken,
      pending.payload,
      pending.idempotencyKey,
      {
        onSuccess: function(result) {
          this.activeRequest = null;
          this.pendingReply = null;
          this.deletePendingReply();
          this.connectionLabel = '回复已送达';
          this.setState(result.data.characterState);
          this.finishPetInteraction();
        }.bind(this),
        onFailure: function(reason) {
          this.activeRequest = null;
          if (reason === 'service_not_configured'
            || reason === 'invalid_request'
            || reason === 'http_400'
            || reason === 'http_401') {
            this.pendingReply = {
              attempts: MAX_REPLY_ATTEMPTS,
              idempotencyKey: pending.idempotencyKey,
              nextAttemptAt: Date.now(),
              payload: pending.payload
            };
          } else {
            this.pendingReply = recordReplyFailure(pending);
          }
          this.persistPendingReply();
          this.connectionLabel = reason === 'http_401'
            ? '令牌已失效'
            : '回复待重试';
          this.startPetInteraction(
            petInteractionAnimation('failure', this.petRuntime)
          );
          this.schedulePendingReply();
        }.bind(this)
      }
    );
  },

  schedulePendingReply() {
    this.cancelRetryTimer();
    if (!this.visible || !this.pendingReply) {
      return;
    }
    if (this.pendingReply.attempts >= MAX_REPLY_ATTEMPTS) {
      this.connectionLabel = '回复未送达 · 点状态重试';
      return;
    }
    const delay = Math.max(
      0,
      this.pendingReply.nextAttemptAt - Date.now()
    );
    this.retryTimer = setTimeout(function() {
      this.retryTimer = null;
      this.sendPendingReply();
    }.bind(this), delay);
  },

  showMemories() {
    this.mainScreen = false;
    this.petScreen = false;
    this.memoryScreen = true;
    this.stopPetAnimation();
    this.loadMemories();
  },

  hideMemories() {
    this.memoryScreen = false;
    this.mainScreen = true;
    this.playPetStateEntry();
    this.ensureConnected();
  },

  showPets() {
    this.mainScreen = false;
    this.memoryScreen = false;
    this.petScreen = true;
    this.stopPetAnimation();
    this.loadPetCatalog();
  },

  hidePets() {
    this.cancelPetInstall();
    this.cancelRequest();
    this.petScreen = false;
    this.mainScreen = true;
    this.playPetStateEntry();
    this.ensureConnected();
  },

  loadPetCatalog() {
    if (!this.deviceToken) {
      this.petCatalogStatus = '尚未注册';
      this.petCatalogDescription = '返回主页完成服务注册后再试';
      return;
    }
    this.cancelRequest();
    this.petCatalogStatus = '正在读取';
    this.petCatalogDescription = '读取经过审核的宠物目录';
    this.activeRequest = fetchPetCatalog(this.deviceToken, {
      onFailure: function(reason) {
        this.activeRequest = null;
        this.petCatalog = [];
        this.petCatalogStatus = this.connectionLabelForFailure(reason);
        this.petCatalogDescription = '目录暂时不可用';
      }.bind(this),
      onSuccess: function(result) {
        this.activeRequest = null;
        this.petCatalog = result.data.pets;
        this.petCatalogIndex = 0;
        this.applyCatalogPet();
      }.bind(this)
    });
  },

  applyCatalogPet() {
    const summary = this.petCatalog[this.petCatalogIndex];
    if (!summary) {
      this.petCatalogName = '暂无宠物';
      this.petCatalogDescription = '目录中没有可用宠物';
      this.petCatalogPosition = '';
      this.petCatalogStatus = '请稍后再试';
      this.petCatalogAction = '不可用';
      return;
    }
    this.petCatalogName = summary.displayName;
    this.petCatalogDescription = summary.description;
    this.petCatalogPosition = `${this.petCatalogIndex + 1}/`
      + `${this.petCatalog.length} · `
      + `${Math.ceil(summary.budget.totalBytes / 1024)} KiB`;
    if (this.downloadedPet
      && this.downloadedPet.version === summary.version) {
      this.petCatalogStatus = '当前正在使用';
      this.petCatalogAction = '正在使用';
    } else {
      this.petCatalogStatus = '已审核 · 点下方安装';
      this.petCatalogAction = '下载并使用';
    }
  },

  previousCatalogPet() {
    if (this.petInstaller || this.petCatalogIndex <= 0) {
      return;
    }
    this.petCatalogIndex -= 1;
    this.applyCatalogPet();
  },

  nextCatalogPet() {
    if (this.petInstaller
      || this.petCatalogIndex >= this.petCatalog.length - 1) {
      return;
    }
    this.petCatalogIndex += 1;
    this.applyCatalogPet();
  },

  selectCatalogPet() {
    if (this.petInstaller || !this.deviceToken) {
      return;
    }
    const summary = this.petCatalog[this.petCatalogIndex];
    if (!summary) {
      return;
    }
    if (this.downloadedPet
      && this.downloadedPet.version === summary.version) {
      this.petCatalogStatus = '当前正在使用';
      return;
    }
    this.cancelRequest();
    this.petCatalogStatus = '正在核对运行清单';
    this.petCatalogAction = '请稍候';
    this.activeRequest = fetchPetDetail(
      this.deviceToken,
      summary.id,
      {
        onFailure: function(reason) {
          this.activeRequest = null;
          this.petCatalogStatus = this.connectionLabelForFailure(reason);
          this.petCatalogAction = '重试安装';
        }.bind(this),
        onSuccess: function(result) {
          this.activeRequest = null;
          if (result.data.version !== summary.version) {
            this.petCatalogStatus = '目录版本已变化 · 请刷新';
            this.petCatalogAction = '重试安装';
            return;
          }
          this.installCatalogPet(result.data);
        }.bind(this)
      }
    );
  },

  installCatalogPet(pet) {
    this.petCatalogAction = '正在安装';
    this.petCatalogStatus = `正在准备 0/${pet.assetCount}`;
    this.petInstaller = installPetBundle({
      commit: function(selection, onSuccess, onFailure) {
        let value;
        try {
          value = serializePetSelection(selection);
        } catch (error) {
          onFailure();
          return;
        }
        storage.set({
          fail: onFailure,
          key: PET_SELECTION_STORAGE_KEY,
          success: onSuccess,
          value
        });
      },
      files: watchPetFiles,
      onFailure: function(reason) {
        this.petInstaller = null;
        this.petCatalogStatus = this.petInstallFailureLabel(reason);
        this.petCatalogAction = reason === 'cancelled'
          ? '下载并使用'
          : '重试安装';
      }.bind(this),
      onProgress: function(completed, total) {
        this.petCatalogStatus = `正在校验 ${completed}/${total}`;
      }.bind(this),
      onSuccess: function(result) {
        this.petInstaller = null;
        this.applyDownloadedPet(result.pet);
        this.petCatalogStatus = '安装完成 · 当前正在使用';
        this.petCatalogAction = '正在使用';
      }.bind(this),
      pet,
      previousPet: this.downloadedPet,
      transport: createWatchPetTransport(this.deviceToken)
    });
  },

  cancelPetInstall() {
    if (!this.petInstaller) {
      return;
    }
    const installer = this.petInstaller;
    this.petInstaller = null;
    installer.cancel();
  },

  petInstallFailureLabel(reason) {
    if (reason === 'cancelled') {
      return '安装已取消，旧宠物保持不变';
    }
    if (reason === 'asset_integrity_failed'
      || reason === 'stored_asset_integrity_failed'
      || reason === 'manifest_integrity_failed') {
      return '完整性校验失败，已回滚';
    }
    if (reason === 'selection_commit_failed') {
      return '切换失败，已保留旧宠物';
    }
    return '安装失败，已保留旧宠物';
  },

  loadMemories() {
    if (!this.deviceToken) {
      this.memoryStatus = '尚未注册';
      return;
    }
    this.cancelRequest();
    this.memoryStatus = '正在读取';
    this.activeRequest = fetchMemories(this.deviceToken, 3, 0, {
      onSuccess: function(result) {
        this.activeRequest = null;
        this.applyMemories(result.data.memories);
      }.bind(this),
      onFailure: function(reason) {
        this.activeRequest = null;
        this.memoryStatus = this.connectionLabelForFailure(reason);
      }.bind(this)
    });
  },

  applyMemories(memories) {
    const first = memories[0];
    const second = memories[1];
    const third = memories[2];
    this.memoryOneVisible = !!first;
    this.memoryTwoVisible = !!second;
    this.memoryThreeVisible = !!third;
    this.memoryOne = this.memorySummary(first);
    this.memoryTwo = this.memorySummary(second);
    this.memoryThree = this.memorySummary(third);
    this.memoryOneId = first ? first.id : '';
    this.memoryTwoId = second ? second.id : '';
    this.memoryThreeId = third ? third.id : '';
    this.memoryStatus = memories.length > 0 ? '最近记忆' : '还没有记忆';
  },

  deleteMemoryOne() {
    this.deleteOneMemory(this.memoryOneId);
  },

  deleteMemoryTwo() {
    this.deleteOneMemory(this.memoryTwoId);
  },

  deleteMemoryThree() {
    this.deleteOneMemory(this.memoryThreeId);
  },

  deleteOneMemory(memoryId) {
    if (!memoryId) {
      return;
    }
    this.cancelRequest();
    this.memoryStatus = '正在删除';
    this.activeRequest = deleteMemory(this.deviceToken, memoryId, {
      onSuccess: function() {
        this.activeRequest = null;
        this.loadMemories();
      }.bind(this),
      onFailure: function(reason) {
        this.activeRequest = null;
        this.memoryStatus = this.connectionLabelForFailure(reason);
      }.bind(this)
    });
  },

  clearAllMemories() {
    if (!this.deviceToken) {
      return;
    }
    prompt.showDialog({
      title: '清空全部记忆？',
      message: '此操作无法撤销。',
      buttons: [
        {
          text: '取消',
          color: '#aab4c5'
        },
        {
          text: '清空',
          color: '#f4b7c4'
        }
      ],
      success: function(result) {
        if (result.index === 1) {
          this.performClearMemories();
        }
      }.bind(this)
    });
  },

  performClearMemories() {
    this.cancelRequest();
    this.memoryStatus = '正在清空';
    this.activeRequest = clearMemories(this.deviceToken, {
      onSuccess: function() {
        this.activeRequest = null;
        this.applyMemories([]);
      }.bind(this),
      onFailure: function(reason) {
        this.activeRequest = null;
        this.memoryStatus = this.connectionLabelForFailure(reason);
      }.bind(this)
    });
  },

  cancelActiveWork() {
    this.cancelRequest();
    this.cancelPetInstall();
    this.cancelRetryTimer();
    this.stopPetAnimation();
  },

  cancelRequest() {
    if (this.activeRequest) {
      this.activeRequest.cancel();
      this.activeRequest = null;
    }
  },

  cancelRetryTimer() {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  },

  playPetStateEntry() {
    const animationName = petAnimationForState(this.state, this.petRuntime);
    const oneShot = !getPetAnimation(
      animationName,
      this.petRuntime
    ).loop;
    this.startPetAnimation(animationName, oneShot);
  },

  startPetSteadyAnimation() {
    this.startPetAnimation(
      petSteadyAnimationForState(this.state, this.petRuntime),
      false
    );
  },

  startPetInteraction(animationName) {
    this.startPetAnimation(animationName, true);
  },

  finishPetInteraction() {
    if (!this.petActionActive) {
      return;
    }
    this.petActionActive = false;
    if (this.visible && !this.memoryScreen && !this.petScreen) {
      this.startPetSteadyAnimation();
    }
  },

  startPetAnimation(animationName, isAction) {
    this.cancelPetTimer();
    this.petPlayback = createPetPlayback(animationName, this.petRuntime);
    this.petActionActive = isAction;
    this.petFramePath = this.petPlayback.framePath;
    if (this.visible && !this.memoryScreen && !this.petScreen) {
      this.schedulePetFrame();
    }
  },

  schedulePetFrame() {
    if (!this.petPlayback
      || !this.visible
      || this.memoryScreen
      || this.petScreen) {
      return;
    }
    const delay = this.petPlayback.delayMs;
    this.petTimer = setTimeout(function() {
      this.petTimer = null;
      if (!this.petPlayback
        || !this.visible
        || this.memoryScreen
        || this.petScreen) {
        return;
      }
      const next = advancePetPlayback(
        this.petPlayback,
        this.petRuntime
      );
      if (next.done) {
        this.petPlayback = null;
        this.petActionActive = false;
        this.startPetSteadyAnimation();
        return;
      }
      this.petPlayback = next;
      this.petFramePath = next.framePath;
      this.schedulePetFrame();
    }.bind(this), delay);
  },

  stopPetAnimation() {
    this.cancelPetTimer();
    this.petPlayback = null;
    this.petActionActive = false;
  },

  cancelPetTimer() {
    if (this.petTimer !== null) {
      clearTimeout(this.petTimer);
      this.petTimer = null;
    }
  },

  connectionLabelForFailure(reason) {
    if (reason === 'service_not_configured') {
      return '待配置服务';
    }
    if (reason === 'timeout') {
      return '服务超时';
    }
    if (reason === 'http_401') {
      return '令牌已失效';
    }
    if (reason === 'http_400' || reason === 'http_409') {
      return '注册信息冲突';
    }
    if (reason === 'invalid_response'
      || reason === 'invalid_json'
      || reason === 'invalid_nudge'
      || reason === 'response_too_large') {
      return '响应异常';
    }
    return '服务离线';
  },

  persistIdentity() {
    this.saveValue(IDENTITY_STORAGE_KEY, serializeIdentity({
      deviceId: this.deviceId,
      deviceToken: this.deviceToken,
      registrationKey: this.registrationKey
    }));
  },

  persistPendingReply() {
    if (!this.pendingReply) {
      this.deletePendingReply();
      return;
    }
    const serialized = serializePendingReply(this.pendingReply);
    this.saveValue(PENDING_META_STORAGE_KEY, serialized.meta);
    this.saveValue(PENDING_PAYLOAD_STORAGE_KEY, serialized.payload);
  },

  deletePendingReply() {
    this.deleteStored(PENDING_META_STORAGE_KEY);
    this.deleteStored(PENDING_PAYLOAD_STORAGE_KEY);
  },

  persistNudge(nudge) {
    const serialized = serializeNudge(nudge);
    this.saveValue(NUDGE_META_STORAGE_KEY, serialized.meta);
    this.saveValue(NUDGE_MESSAGE_STORAGE_KEY, serialized.message);
    for (let index = 0; index < NUDGE_ACTION_STORAGE_KEYS.length; index += 1) {
      const action = serialized.actions[index];
      if (action) {
        this.saveValue(NUDGE_ACTION_STORAGE_KEYS[index], action);
      } else {
        this.deleteStored(NUDGE_ACTION_STORAGE_KEYS[index]);
      }
    }
  },

  deleteCachedNudge() {
    this.cachedNudge = null;
    this.deleteStored(NUDGE_META_STORAGE_KEY);
    this.deleteStored(NUDGE_MESSAGE_STORAGE_KEY);
    for (let index = 0; index < NUDGE_ACTION_STORAGE_KEYS.length; index += 1) {
      this.deleteStored(NUDGE_ACTION_STORAGE_KEYS[index]);
    }
  },

  applyRestoredNudge() {
    if (!this.cachedNudgeReady || !this.pendingReplyReady) {
      return;
    }
    if (this.cachedNudge
      && (!this.pendingReply
        || this.pendingReply.payload.nudgeId !== this.cachedNudge.nudgeId)) {
      this.presentMessage(this.cachedNudge);
    }
  },

  readCachedActions(index, actions, callback) {
    if (index >= NUDGE_ACTION_STORAGE_KEYS.length) {
      callback(actions);
      return;
    }
    this.readValue(NUDGE_ACTION_STORAGE_KEYS[index], (action) => {
      actions.push(action);
      this.readCachedActions(index + 1, actions, callback);
    });
  },

  saveJson(key, value) {
    this.saveValue(key, JSON.stringify(value));
  },

  saveValue(key, value) {
    try {
      ensureStorageValue(value);
    } catch (error) {
      console.error(`[WatchBuddy] local value too large: ${key}`);
      return;
    }
    storage.set({
      key,
      value
    });
  },

  readJson(key, callback) {
    this.readValue(key, (value) => {
      if (typeof value !== 'string' || !value) {
        callback(null);
        return;
      }
      try {
        callback(JSON.parse(value));
      } catch (error) {
        callback(null);
      }
    });
  },

  readValue(key, callback) {
    storage.get({
      key,
      success(value) {
        callback(typeof value === 'string' ? value : null);
      },
      fail() {
        callback(null);
      }
    });
  },

  deleteStored(key) {
    storage.delete({
      key,
      fail() {
        console.info(`[WatchBuddy] failed to delete local key: ${key}`);
      }
    });
  },

  createLocalId(prefix) {
    const time = Date.now().toString(36);
    let random = Math.floor(Math.random() * 0x100000000).toString(36);
    while (random.length < 7) {
      random = `0${random}`;
    }
    return `${prefix}-${time}-${random}`;
  },

  memorySummary(memory) {
    if (!memory || typeof memory.summary !== 'string') {
      return '';
    }
    const characters = Array.from(memory.summary);
    return characters.length > 18
      ? `${characters.slice(0, 18).join('')}…`
      : memory.summary;
  },

  vibrate() {
    vibrator.vibrate({
      mode: 'short',
      fail() {
        console.info('[WatchBuddy] vibration unavailable');
      }
    });
  },

  actionLabel(action) {
    return action && action.label ? action.label : '';
  },

  actionId(action) {
    return action && action.id ? action.id : '';
  }
};
