import storage from '@system.storage';
import vibrator from '@system.vibrator';

import { checkWatchBuddyHealth } from '../../common/watch-api-client.js';

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

const DEMO_MESSAGES = [
  {
    state: 'curious',
    message: '今天到现在，哪一小段最值得留下？',
    actions: ['跟你说说', '晚点', '我在忙']
  },
  {
    state: 'concerned',
    message: '你今天像是一直没真正松下来。我不一定猜得准。',
    actions: ['你猜对了', '只是有点忙', '猜错了']
  },
  {
    state: 'chatting',
    message: '昨天那个汇报后来怎么样了？我还记着。',
    actions: ['挺顺利的', '一言难尽', '晚点告诉你']
  }
];

export default {
  data: {
    state: 'idle',
    stateLabel: '空闲',
    characterClass: 'idle',
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
    demoIndex: 0
  },

  onInit() {
    this.restoreState();
  },

  onShow() {
    this.checkServer();
  },

  onHide() {
    this.cancelHealthCheck();
  },

  onDestroy() {
    this.cancelHealthCheck();
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
    this.state = nextState;
    this.stateLabel = STATE_LABELS[nextState];
    this.characterClass = nextState === 'giving_space' ? 'giving-space' : nextState;
    storage.set({
      key: 'watchbuddy_state',
      value: nextState
    });
  },

  onCharacterTap() {
    const demo = DEMO_MESSAGES[this.demoIndex % DEMO_MESSAGES.length];
    this.demoIndex += 1;
    this.presentMessage(demo);
    this.vibrate();
  },

  presentMessage(nudge) {
    this.setState(nudge.characterState || nudge.state);
    this.message = nudge.message;
    this.actionOne = this.actionLabel(nudge.actions[0]);
    this.actionTwo = this.actionLabel(nudge.actions[1]);
    this.actionThree = this.actionLabel(nudge.actions[2]);
    this.actionFour = this.actionLabel(nudge.actions[3]);
    this.actionOneId = this.actionId(nudge.actions[0], 'answer');
    this.actionTwoId = this.actionId(nudge.actions[1], 'later');
    this.actionThreeId = this.actionId(nudge.actions[2], 'busy');
    this.actionFourId = this.actionId(nudge.actions[3], 'space');
    this.currentNudgeId = nudge.nudgeId || '';
    this.currentNudgeCreatedAt = nudge.createdAt || Date.now();
    this.messageVisible = true;
  },

  replyOne() {
    this.finishReply(this.actionOneId, 'engaged');
  },

  replyTwo() {
    this.finishReply(this.actionTwoId, 'later');
  },

  replyThree() {
    this.finishReply(this.actionThreeId, 'busy');
  },

  replyFour() {
    this.finishReply(this.actionFourId, 'busy');
  },

  finishReply(actionId, outcome) {
    const nextState = outcome === 'busy' ? 'giving_space' : 'idle';
    this.messageVisible = false;
    this.setState(nextState);
    storage.set({
      key: 'watchbuddy_last_outcome',
      value: outcome
    });
    console.info(`[WatchBuddy] local response: ${outcome}`);
  },

  checkServer() {
    this.cancelHealthCheck();
    this.connectionLabel = '正在连接';
    this.healthCheck = checkWatchBuddyHealth({
      onSuccess: function(result) {
        this.connectionLabel = `服务在线 ${result.version}`;
      }.bind(this),
      onFailure: function(reason) {
        this.connectionLabel = this.connectionLabelForFailure(reason);
      }.bind(this)
    });
  },

  cancelHealthCheck() {
    if (this.healthCheck) {
      this.healthCheck.cancel();
      this.healthCheck = null;
    }
  },

  connectionLabelForFailure(reason) {
    if (reason === 'service_not_configured') {
      return '待配置服务';
    }
    if (reason === 'timeout') {
      return '服务超时';
    }
    if (reason === 'invalid_response' || reason === 'invalid_json') {
      return '响应异常';
    }
    return '服务离线';
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
    return typeof action === 'string' ? action : action && action.label ? action.label : '';
  },

  actionId(action, fallback) {
    return action && typeof action === 'object' && action.id ? action.id : fallback;
  }
};
