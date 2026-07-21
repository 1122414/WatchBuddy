import storage from '@system.storage';
import vibrator from '@system.vibrator';

import {
  fetchCompanionState,
  registerWatchBuddy,
  replyToCompanion
} from '../../common/watch-api-client.js';
import {
  deserializeIdentity,
  serializeIdentity
} from '../../common/watch-storage-contract.js';
import {
  advancePetPlayback,
  canTriggerPetTap,
  createPetPlayback,
  DEFAULT_PET_FRAME,
  getPetAnimation,
  petAnimationForState,
  petInteractionAnimation,
  petSteadyAnimationForState
} from '../../common/watch-pet-runtime.js';

const IDENTITY_STORAGE_KEY = 'wb_identity';
const STATE_STORAGE_KEY = 'watchbuddy_offline_state';

const STATE_LABELS = {
  sleeping: '安静休息',
  idle: '陪着你',
  daydreaming: '发呆',
  watching: '看着你',
  curious: '开心跳跃',
  concerned: '关心你',
  chatting: '正在聊天',
  giving_space: '安静陪伴'
};

export default {
  data: {
    petName: '我的 Codex Pet',
    stateLabel: '陪着你',
    connectionLabel: '正在连接',
    petFramePath: DEFAULT_PET_FRAME,
    hint: '正在连接 DeepSeek…'
  },

  onInit() {
    this.visible = false;
    this.state = 'idle';
    this.identityReady = false;
    this.deviceId = '';
    this.deviceToken = '';
    this.registrationKey = '';
    this.activeRequest = null;
    this.aiRequestActive = false;
    this.networkUnavailable = false;
    this.registrationRecoveryAttempted = false;
    this.queuedPrompt = null;
    this.petTimer = null;
    this.petPlayback = null;
    this.petActionActive = false;
    this.lastPetTapAt = 0;
    this.restoreState();
    this.restoreIdentity();
  },

  onShow() {
    this.visible = true;
    this.networkUnavailable = false;
    this.playPetStateEntry();
    this.ensureConnected();
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
      key: STATE_STORAGE_KEY,
      success: function(value) {
        if (typeof value === 'string' && STATE_LABELS[value]) {
          this.applyState(value);
          return;
        }
        this.applyTimeState();
      }.bind(this),
      fail: function() {
        this.applyTimeState();
      }.bind(this)
    });
  },

  restoreIdentity() {
    storage.get({
      key: IDENTITY_STORAGE_KEY,
      success: function(value) {
        try {
          const identity = deserializeIdentity(value);
          this.deviceId = identity.deviceId;
          this.deviceToken = identity.deviceToken;
          this.registrationKey = identity.registrationKey;
        } catch (error) {
          this.resetIdentity();
        }
        this.finishIdentityRestore();
      }.bind(this),
      fail: function() {
        this.resetIdentity();
        this.finishIdentityRestore();
      }.bind(this)
    });
  },

  finishIdentityRestore() {
    this.identityReady = true;
    this.persistIdentity();
    this.ensureConnected();
  },

  resetIdentity() {
    this.deviceId = this.createLocalId('gt6pro');
    this.deviceToken = '';
    this.registrationKey = this.createLocalId('register');
  },

  persistIdentity() {
    let value;
    try {
      value = serializeIdentity({
        deviceId: this.deviceId,
        deviceToken: this.deviceToken,
        registrationKey: this.registrationKey
      });
    } catch (error) {
      console.error('[WatchBuddy] failed to serialize identity');
      return;
    }
    storage.set({
      key: IDENTITY_STORAGE_KEY,
      value,
      fail() {
        console.error('[WatchBuddy] failed to persist identity');
      }
    });
  },

  ensureConnected() {
    if (!this.visible || !this.identityReady || this.activeRequest) {
      return;
    }
    if (!this.deviceToken) {
      this.registerDevice();
      return;
    }
    if (this.queuedPrompt) {
      this.flushQueuedPrompt();
      return;
    }
    this.syncCompanionState();
  },

  registerDevice() {
    if (this.activeRequest || !this.identityReady) {
      return;
    }
    this.connectionLabel = '首次连接';
    if (!this.queuedPrompt) {
      this.hint = '正在安全连接陪伴服务…';
    }
    this.startPetAnimation(petInteractionAnimation('loading'), true);
    this.activeRequest = registerWatchBuddy({
      deviceId: this.deviceId,
      locale: 'zh-CN',
      timezoneOffsetMinutes: -new Date().getTimezoneOffset()
    }, this.registrationKey, {
      onSuccess: function(result) {
        this.activeRequest = null;
        this.networkUnavailable = false;
        this.deviceToken = result.data.deviceToken;
        this.registrationKey = '';
        this.registrationRecoveryAttempted = false;
        this.persistIdentity();
        this.connectionLabel = 'DeepSeek 在线';
        if (this.queuedPrompt) {
          this.flushQueuedPrompt();
          return;
        }
        this.syncCompanionState();
      }.bind(this),
      onFailure: function(reason) {
        this.activeRequest = null;
        if (reason === 'http_409' && !this.registrationRecoveryAttempted) {
          this.registrationRecoveryAttempted = true;
          this.resetIdentity();
          this.persistIdentity();
          this.registerDevice();
          return;
        }
        this.networkUnavailable = true;
        if (this.queuedPrompt) {
          this.completeOfflinePrompt(this.queuedPrompt, reason);
          return;
        }
        this.connectionLabel = this.connectionLabelForFailure(reason);
        this.hint = 'GT 6 当前无网络，按钮仍可离线互动';
        this.startPetAnimation(petInteractionAnimation('failure'), true);
      }.bind(this)
    });
  },

  syncCompanionState() {
    if (!this.deviceToken || this.activeRequest) {
      return;
    }
    this.connectionLabel = '正在同步';
    this.activeRequest = fetchCompanionState(this.deviceToken, {
      onSuccess: function(result) {
        this.activeRequest = null;
        this.networkUnavailable = false;
        this.connectionLabel = 'DeepSeek 在线';
        this.applyState(result.data.characterState);
        this.hint = result.data.nudge
          ? result.data.nudge.message
          : 'AI 已连接，想说点什么？';
        this.startPetSteadyAnimation();
      }.bind(this),
      onFailure: function(reason) {
        this.activeRequest = null;
        if (reason === 'http_401') {
          this.resetIdentity();
          this.persistIdentity();
          this.registerDevice();
          return;
        }
        this.networkUnavailable = true;
        this.connectionLabel = this.connectionLabelForFailure(reason);
        this.hint = 'GT 6 当前无网络，按钮仍可离线互动';
        this.startPetAnimation(petInteractionAnimation('failure'), true);
      }.bind(this)
    });
  },

  applyTimeState() {
    const hour = new Date().getHours();
    this.applyState(hour >= 23 || hour < 7 ? 'sleeping' : 'idle');
  },

  applyState(nextState) {
    if (!STATE_LABELS[nextState]) {
      return;
    }
    this.state = nextState;
    this.stateLabel = STATE_LABELS[nextState];
    storage.set({
      key: STATE_STORAGE_KEY,
      value: nextState
    });
  },

  onCharacterTap() {
    const now = Date.now();
    if (!canTriggerPetTap(this.lastPetTapAt, now)) {
      return;
    }
    this.lastPetTapAt = now;
    this.hint = '我在这里，点“聊聊”让我回应你';
    this.runLocalAction('curious', petInteractionAnimation('tap'));
  },

  playWave() {
    this.requestAiReply(
      '陪我聊一句吧',
      'chatting',
      petInteractionAnimation('message')
    );
  },

  playJump() {
    this.requestAiReply(
      '请给我一句简短鼓励',
      'curious',
      petInteractionAnimation('tap')
    );
  },

  restPet() {
    this.requestAiReply(
      '我准备休息了，和我说句晚安吧',
      'sleeping',
      petInteractionAnimation('message')
    );
  },

  requestAiReply(text, state, animationName) {
    if (this.aiRequestActive) {
      this.hint = '还在想上一句话…';
      return;
    }
    const prompt = {
      animationName,
      state,
      text
    };
    this.applyState(state);
    this.startPetAnimation(animationName, true);
    this.vibrate();
    if (this.networkUnavailable) {
      this.completeOfflinePrompt(prompt, 'network_error');
      return;
    }
    this.hint = '正在等待 DeepSeek 回应…';
    if (!this.identityReady || !this.deviceToken) {
      this.queuedPrompt = prompt;
      this.ensureConnected();
      return;
    }
    this.submitAiPrompt(prompt);
  },

  flushQueuedPrompt() {
    if (!this.deviceToken || !this.queuedPrompt) {
      return;
    }
    const prompt = this.queuedPrompt;
    this.queuedPrompt = null;
    this.submitAiPrompt(prompt);
  },

  submitAiPrompt(prompt) {
    this.cancelRequest();
    this.aiRequestActive = true;
    this.connectionLabel = 'DeepSeek 思考中';
    this.activeRequest = replyToCompanion(
      this.deviceToken,
      { text: prompt.text },
      this.createLocalId('reply'),
      {
        timeoutMs: 12000,
        onSuccess: function(result) {
          this.activeRequest = null;
          this.aiRequestActive = false;
          this.networkUnavailable = false;
          const reply = result.data.companionReply;
          this.connectionLabel = reply.fallback
            ? 'AI 暂时离线'
            : 'DeepSeek 在线';
          this.hint = reply.text;
          this.applyState(result.data.characterState);
          this.startPetAnimation(petInteractionAnimation('message'), true);
        }.bind(this),
        onFailure: function(reason) {
          this.activeRequest = null;
          this.aiRequestActive = false;
          if (reason === 'http_401') {
            this.queuedPrompt = prompt;
            this.resetIdentity();
            this.persistIdentity();
            this.registerDevice();
            return;
          }
          this.networkUnavailable = true;
          this.completeOfflinePrompt(prompt, reason);
        }.bind(this)
      }
    );
  },

  completeOfflinePrompt(prompt, reason) {
    this.queuedPrompt = null;
    this.aiRequestActive = false;
    this.connectionLabel = this.connectionLabelForFailure(reason);
    this.hint = this.offlineReplyFor(prompt.state);
    this.startPetAnimation(prompt.animationName, true);
  },

  offlineReplyFor(state) {
    if (state === 'curious') {
      return '慢一点也没关系，你今天已经在向前走了。';
    }
    if (state === 'sleeping') {
      return '晚安，把今天轻轻放下，我会安静陪着你。';
    }
    return '我在这里。当前是本地回应，网络恢复后再连接 DeepSeek。';
  },

  runLocalAction(state, animationName) {
    this.applyState(state);
    this.startPetAnimation(animationName, true);
    this.vibrate();
  },

  playPetStateEntry() {
    const animationName = petAnimationForState(this.state);
    const oneShot = !getPetAnimation(animationName).loop;
    this.startPetAnimation(animationName, oneShot);
  },

  startPetSteadyAnimation() {
    this.startPetAnimation(
      petSteadyAnimationForState(this.state),
      false
    );
  },

  startPetAnimation(animationName, isAction) {
    this.cancelPetTimer();
    this.petPlayback = createPetPlayback(animationName);
    this.petActionActive = isAction;
    this.petFramePath = this.petPlayback.framePath;
    if (this.visible) {
      this.schedulePetFrame();
    }
  },

  schedulePetFrame() {
    if (!this.petPlayback || !this.visible) {
      return;
    }
    const delay = this.petPlayback.delayMs;
    this.petTimer = setTimeout(function() {
      this.petTimer = null;
      if (!this.petPlayback || !this.visible) {
        return;
      }
      const next = advancePetPlayback(this.petPlayback);
      if (next.done) {
        this.petPlayback = null;
        this.petActionActive = false;
        this.applyState('idle');
        this.startPetSteadyAnimation();
        return;
      }
      this.petPlayback = next;
      this.petFramePath = next.framePath;
      this.schedulePetFrame();
    }.bind(this), delay);
  },

  cancelActiveWork() {
    this.cancelRequest();
    this.aiRequestActive = false;
    this.stopPetAnimation();
  },

  cancelRequest() {
    if (this.activeRequest) {
      this.activeRequest.cancel();
      this.activeRequest = null;
    }
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
    if (typeof reason === 'string'
      && reason.startsWith('network_error_')) {
      return `离线 E${reason.slice('network_error_'.length)}`;
    }
    if (reason === 'timeout') {
      return '服务超时';
    }
    if (reason === 'http_401') {
      return '正在重新连接';
    }
    if (reason === 'invalid_response'
      || reason === 'invalid_json'
      || reason === 'response_too_large') {
      return '响应异常';
    }
    return '服务离线';
  },

  createLocalId(prefix) {
    const time = Date.now().toString(36);
    let random = Math.floor(Math.random() * 0x100000000).toString(36);
    while (random.length < 7) {
      random = `0${random}`;
    }
    return `${prefix}-${time}-${random}`;
  },

  vibrate() {
    vibrator.vibrate({
      mode: 'short',
      fail() {
        console.info('[WatchBuddy] vibration unavailable');
      }
    });
  }
};
