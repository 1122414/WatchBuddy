import storage from '@system.storage';

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
    demoIndex: 0
  },

  onInit() {
    this.restoreState();
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
  },

  presentMessage(nudge) {
    this.setState(nudge.state);
    this.message = nudge.message;
    this.actionOne = nudge.actions[0];
    this.actionTwo = nudge.actions[1];
    this.actionThree = nudge.actions[2];
    this.messageVisible = true;
  },

  replyOne() {
    this.finishReply('engaged');
  },

  replyTwo() {
    this.finishReply('later');
  },

  replyThree() {
    this.finishReply('busy');
  },

  finishReply(outcome) {
    const nextState = outcome === 'busy' ? 'giving_space' : 'idle';
    this.messageVisible = false;
    this.setState(nextState);
    storage.set({
      key: 'watchbuddy_last_outcome',
      value: outcome
    });
    console.info(`[WatchBuddy] local response: ${outcome}`);
  }
};
