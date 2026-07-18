import { isValidPetDetail } from './watch-api-contract.js';
import { petAssetUri } from './watch-pet-integrity.js';

const PET_ROOT = 'common/images/pets/watchbuddy-sprout';
const TAP_DEBOUNCE_MS = 800;

function framePath(directory, index) {
  return `${PET_ROOT}/${directory}/00${index}.png`;
}

function framePaths(directory, count) {
  const frames = [];
  for (let index = 0; index < count; index += 1) {
    frames.push(framePath(directory, index));
  }
  return frames;
}

const PET_ANIMATIONS = {
  idle: {
    frames: framePaths('idle', 6),
    durationsMs: [280, 110, 110, 140, 140, 320],
    loop: true
  },
  runningRight: {
    frames: framePaths('running-right', 8),
    durationsMs: [120, 120, 120, 120, 120, 120, 120, 220],
    loop: true
  },
  runningLeft: {
    frames: framePaths('running-left', 8),
    durationsMs: [120, 120, 120, 120, 120, 120, 120, 220],
    loop: true
  },
  waving: {
    frames: framePaths('waving', 4),
    durationsMs: [140, 140, 140, 280],
    loop: false
  },
  jumping: {
    frames: framePaths('jumping', 5),
    durationsMs: [140, 140, 140, 140, 280],
    loop: false
  },
  failed: {
    frames: framePaths('failed', 8),
    durationsMs: [140, 140, 140, 140, 140, 140, 140, 240],
    loop: false
  },
  waiting: {
    frames: framePaths('waiting', 6),
    durationsMs: [150, 150, 150, 150, 150, 260],
    loop: true
  },
  running: {
    frames: framePaths('running', 6),
    durationsMs: [120, 120, 120, 120, 120, 220],
    loop: true
  },
  review: {
    frames: framePaths('review', 6),
    durationsMs: [150, 150, 150, 150, 150, 280],
    loop: true
  }
};

const STATE_ANIMATIONS = {
  sleeping: 'idle',
  idle: 'idle',
  daydreaming: 'waiting',
  watching: 'review',
  curious: 'jumping',
  concerned: 'waiting',
  chatting: 'waving',
  giving_space: 'idle'
};

const INTERACTION_ANIMATIONS = {
  tap: 'jumping',
  message: 'waving',
  loading: 'running',
  failure: 'failed'
};

const DEFAULT_PET_RUNTIME = {
  animations: PET_ANIMATIONS,
  id: 'watchbuddy-sprout',
  interactionAnimations: INTERACTION_ANIMATIONS,
  stateAnimations: STATE_ANIMATIONS,
  version: 'builtin'
};

export const DEFAULT_PET_ID = 'watchbuddy-sprout';
export const DEFAULT_PET_FRAME = PET_ANIMATIONS.idle.frames[0];

export function createDownloadedPetRuntime(pet) {
  if (!isValidPetDetail(pet)) {
    throw new TypeError('下载宠物运行清单无效');
  }
  const animations = {};
  Object.keys(pet.animations).forEach((name) => {
    const animation = pet.animations[name];
    animations[name] = {
      durationsMs: animation.durationsMs.slice(),
      frames: animation.frames.map(
        (assetId) => petAssetUri(pet.version, assetId)
      ),
      loop: animation.loop
    };
  });
  return {
    animations,
    id: pet.id,
    interactionAnimations: copyMap(pet.interactionMap),
    stateAnimations: copyMap(pet.stateMap),
    version: pet.version
  };
}

export function getPetAnimation(name, runtime) {
  const selected = runtime || DEFAULT_PET_RUNTIME;
  return selected.animations[name] || selected.animations.idle;
}

export function petAnimationForState(state, runtime) {
  const selected = runtime || DEFAULT_PET_RUNTIME;
  return selected.stateAnimations[state] || 'idle';
}

export function petSteadyAnimationForState(state, runtime) {
  const name = petAnimationForState(state, runtime);
  return getPetAnimation(name, runtime).loop ? name : 'idle';
}

export function petInteractionAnimation(interaction, runtime) {
  const selected = runtime || DEFAULT_PET_RUNTIME;
  return selected.interactionAnimations[interaction] || 'idle';
}

export function createPetPlayback(name, runtime) {
  const selected = runtime || DEFAULT_PET_RUNTIME;
  const animation = getPetAnimation(name, selected);
  const animationName = selected.animations[name] ? name : 'idle';
  return {
    animationName,
    frameIndex: 0,
    framePath: animation.frames[0],
    delayMs: animation.durationsMs[0],
    done: false
  };
}

export function advancePetPlayback(playback, runtime) {
  const animation = getPetAnimation(playback.animationName, runtime);
  const nextIndex = playback.frameIndex + 1;
  if (nextIndex >= animation.frames.length) {
    if (!animation.loop) {
      return {
        animationName: playback.animationName,
        frameIndex: playback.frameIndex,
        framePath: playback.framePath,
        delayMs: 0,
        done: true
      };
    }
    return {
      animationName: playback.animationName,
      frameIndex: 0,
      framePath: animation.frames[0],
      delayMs: animation.durationsMs[0],
      done: false
    };
  }
  return {
    animationName: playback.animationName,
    frameIndex: nextIndex,
    framePath: animation.frames[nextIndex],
    delayMs: animation.durationsMs[nextIndex],
    done: false
  };
}

export function canTriggerPetTap(lastTapAt, now, debounceMs = TAP_DEBOUNCE_MS) {
  return Number.isFinite(now)
    && Number.isFinite(lastTapAt)
    && now >= lastTapAt
    && now - lastTapAt >= debounceMs;
}

function copyMap(source) {
  const target = {};
  Object.keys(source).forEach((key) => {
    target[key] = source[key];
  });
  return target;
}
