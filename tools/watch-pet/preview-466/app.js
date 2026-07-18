const PET_ROOT = '../../../apps/watch-huawei/entry/src/main/js/MainAbility/common/images/pets/watchbuddy-sprout';

function framePaths(directory, count) {
  return Array.from(
    { length: count },
    (_, index) => `${PET_ROOT}/${directory}/00${index}.png`
  );
}

const animations = {
  idle: {
    frames: framePaths('idle', 6),
    durations: [280, 110, 110, 140, 140, 320],
    loop: true
  },
  waving: {
    frames: framePaths('waving', 4),
    durations: [140, 140, 140, 280],
    loop: false
  },
  jumping: {
    frames: framePaths('jumping', 5),
    durations: [140, 140, 140, 140, 280],
    loop: false
  },
  failed: {
    frames: framePaths('failed', 8),
    durations: [140, 140, 140, 140, 140, 140, 140, 240],
    loop: false
  },
  waiting: {
    frames: framePaths('waiting', 6),
    durations: [150, 150, 150, 150, 150, 260],
    loop: true
  },
  running: {
    frames: framePaths('running', 6),
    durations: [120, 120, 120, 120, 120, 220],
    loop: true
  },
  review: {
    frames: framePaths('review', 6),
    durations: [150, 150, 150, 150, 150, 280],
    loop: true
  }
};

const states = {
  sleeping: { label: '睡觉', animation: 'idle', steady: 'idle' },
  idle: { label: '空闲', animation: 'idle', steady: 'idle' },
  daydreaming: { label: '发呆', animation: 'waiting', steady: 'waiting' },
  watching: { label: '观察', animation: 'review', steady: 'review' },
  curious: { label: '好奇', animation: 'jumping', steady: 'idle' },
  concerned: { label: '关心', animation: 'waiting', steady: 'waiting' },
  chatting: { label: '聊天', animation: 'waving', steady: 'idle' },
  giving_space: { label: '安静陪伴', animation: 'idle', steady: 'idle' }
};

const interactions = {
  tap: 'jumping',
  message: 'waving',
  loading: 'running',
  failure: 'failed'
};

const elements = {
  watch: document.querySelector('#watch-screen'),
  stateSelect: document.querySelector('#state-select'),
  stateLabel: document.querySelector('#state-label'),
  scaleRange: document.querySelector('#scale-range'),
  scaleOutput: document.querySelector('#scale-output'),
  touchToggle: document.querySelector('#touch-toggle'),
  touchOutline: document.querySelector('#touch-outline'),
  messageToggle: document.querySelector('#message-toggle'),
  catalogToggle: document.querySelector('#catalog-toggle'),
  catalogScreen: document.querySelector('#pet-catalog-screen'),
  statusRow: document.querySelector('#status-row'),
  messageBubble: document.querySelector('#message-bubble'),
  replyRow: document.querySelector('#reply-row'),
  petHitArea: document.querySelector('#pet-hit-area'),
  petFrame: document.querySelector('#pet-frame'),
  metrics: document.querySelector('#metrics')
};

let state = 'idle';
let animationName = 'idle';
let frameIndex = 0;
let timer = null;
let actionActive = false;

function cancelTimer() {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

function renderFrame() {
  const animation = animations[animationName];
  elements.petFrame.src = animation.frames[frameIndex];
  elements.metrics.textContent =
    `466 × 466 · ${animationName} · frame ${frameIndex + 1}/${animation.frames.length}`;
}

function scheduleFrame() {
  cancelTimer();
  if (document.hidden) {
    return;
  }
  const animation = animations[animationName];
  timer = window.setTimeout(() => {
    timer = null;
    const nextIndex = frameIndex + 1;
    if (nextIndex >= animation.frames.length) {
      if (animation.loop) {
        frameIndex = 0;
      } else {
        actionActive = false;
        playAnimation(states[state].steady, false);
        return;
      }
    } else {
      frameIndex = nextIndex;
    }
    renderFrame();
    scheduleFrame();
  }, animation.durations[frameIndex]);
}

function playAnimation(nextAnimation, isAction) {
  animationName = animations[nextAnimation] ? nextAnimation : 'idle';
  frameIndex = 0;
  actionActive = isAction;
  renderFrame();
  scheduleFrame();
}

function applyState(nextState) {
  state = states[nextState] ? nextState : 'idle';
  const stateConfig = states[state];
  elements.stateLabel.textContent = stateConfig.label;
  elements.watch.className = `watch-screen ${state}`;
  playAnimation(
    stateConfig.animation,
    !animations[stateConfig.animation].loop
  );
}

function applyScale(value) {
  const size = Number(value);
  elements.petFrame.style.width = `${size}px`;
  elements.petFrame.style.height = `${size}px`;
  elements.scaleOutput.textContent = `${size} px`;
}

elements.stateSelect.addEventListener('change', (event) => {
  applyState(event.target.value);
});

elements.scaleRange.addEventListener('input', (event) => {
  applyScale(event.target.value);
});

elements.touchToggle.addEventListener('change', (event) => {
  elements.touchOutline.hidden = !event.target.checked;
});

elements.messageToggle.addEventListener('change', (event) => {
  const hidden = !event.target.checked;
  elements.messageBubble.hidden = hidden;
  elements.replyRow.hidden = hidden;
});

elements.catalogToggle.addEventListener('change', (event) => {
  const catalogVisible = event.target.checked;
  elements.catalogScreen.hidden = !catalogVisible;
  elements.statusRow.hidden = catalogVisible;
  elements.petHitArea.hidden = catalogVisible;
  elements.messageBubble.hidden = catalogVisible
    || !elements.messageToggle.checked;
  elements.replyRow.hidden = catalogVisible
    || !elements.messageToggle.checked;
  elements.touchOutline.hidden = catalogVisible
    || !elements.touchToggle.checked;
});

elements.petHitArea.addEventListener('click', () => {
  playAnimation(interactions.tap, true);
});

for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', () => {
    const nextAnimation = interactions[button.dataset.action];
    playAnimation(nextAnimation, true);
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelTimer();
    return;
  }
  if (actionActive) {
    scheduleFrame();
  } else {
    playAnimation(states[state].steady, false);
  }
});

window.addEventListener('beforeunload', cancelTimer);

applyScale(elements.scaleRange.value);
applyState(state);
