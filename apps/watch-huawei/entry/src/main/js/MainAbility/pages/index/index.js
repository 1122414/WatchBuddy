import storage from '@system.storage';
import vibrator from '@system.vibrator';

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

const STATE_STORAGE_KEY = 'watchbuddy_offline_state';

const STATE_LABELS = {
  sleeping: '安静休息',
  idle: '陪着你',
  watching: '看着你',
  curious: '开心跳跃',
  chatting: '向你挥手'
};

export default {
  data: {
    petName: '我的 Codex Pet',
    stateLabel: '陪着你',
    petFramePath: DEFAULT_PET_FRAME,
    hint: '轻点宠物，它会回应你'
  },

  onInit() {
    this.visible = false;
    this.state = 'idle';
    this.petTimer = null;
    this.petPlayback = null;
    this.petActionActive = false;
    this.lastPetTapAt = 0;
    this.restoreState();
  },

  onShow() {
    this.visible = true;
    this.playPetStateEntry();
  },

  onHide() {
    this.visible = false;
    this.stopPetAnimation();
  },

  onDestroy() {
    this.visible = false;
    this.stopPetAnimation();
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
    this.runLocalAction('curious', petInteractionAnimation('tap'));
  },

  playWave() {
    this.runLocalAction('chatting', petInteractionAnimation('message'));
  },

  playJump() {
    this.runLocalAction('curious', petInteractionAnimation('tap'));
  },

  restPet() {
    this.applyState('sleeping');
    this.startPetAnimation(petSteadyAnimationForState('sleeping'), false);
    this.vibrate();
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

  vibrate() {
    vibrator.vibrate({
      mode: 'short',
      fail() {
        console.info('[WatchBuddy] vibration unavailable');
      }
    });
  }
};
