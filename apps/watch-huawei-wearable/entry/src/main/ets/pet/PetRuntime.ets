import {
  PetAnimationDefinition,
  PetDetail
} from '../network/ApiModels';

const PET_ROOT: string = 'pets/watchbuddy-sprout';

export const DEFAULT_PET_ID: string = 'watchbuddy-sprout';
export const TAP_DEBOUNCE_MS: number = 800;

export class PetAnimation {
  frames: Array<string>;
  durationsMs: Array<number>;
  loop: boolean;

  constructor(frames: Array<string>, durationsMs: Array<number>, loop: boolean) {
    this.frames = frames;
    this.durationsMs = durationsMs;
    this.loop = loop;
  }
}

export class PetPlayback {
  animationName: string;
  frameIndex: number;
  framePath: string;
  delayMs: number;
  done: boolean;

  constructor(
    animationName: string,
    frameIndex: number,
    framePath: string,
    delayMs: number,
    done: boolean
  ) {
    this.animationName = animationName;
    this.frameIndex = frameIndex;
    this.framePath = framePath;
    this.delayMs = delayMs;
    this.done = done;
  }
}

export class PetRuntimeDefinition {
  id: string;
  displayName: string;
  downloaded: boolean;
  private pet: PetDetail | null;
  private directory: string;

  constructor(
    id: string,
    displayName: string,
    downloaded: boolean,
    pet: PetDetail | null,
    directory: string
  ) {
    this.id = id;
    this.displayName = displayName;
    this.downloaded = downloaded;
    this.pet = pet;
    this.directory = directory;
  }

  animation(name: string): PetAnimation {
    if (this.pet === null || !this.downloaded) {
      return builtInPetAnimation(name);
    }
    const definition: PetAnimationDefinition =
      this.pet.animations.get(name);
    const frames: Array<string> = [];
    for (let index: number = 0;
      index < definition.frames.length;
      index += 1) {
      frames.push(
        `file://${this.directory}/${definition.frames[index]}.png`
      );
    }
    return new PetAnimation(
      frames,
      definition.durationsMs,
      definition.loop
    );
  }

  animationForState(state: string): string {
    if (this.pet === null || !this.downloaded) {
      return builtInAnimationForState(state);
    }
    if (state === 'offline') {
      return this.pet.stateMap.get('daydreaming');
    }
    return this.pet.stateMap.get(state);
  }

  animationForInteraction(interaction: string): string {
    if (this.pet === null || !this.downloaded) {
      return builtInInteractionAnimation(interaction);
    }
    return this.pet.interactionMap.get(interaction);
  }
}

function framePaths(directory: string, count: number): Array<string> {
  const frames: Array<string> = [];
  for (let index: number = 0; index < count; index += 1) {
    const paddedIndex: string = index < 10 ? `00${index}` : `0${index}`;
    frames.push(`${PET_ROOT}/${directory}/${paddedIndex}.png`);
  }
  return frames;
}

function idleAnimation(): PetAnimation {
  return new PetAnimation(
    framePaths('idle', 6),
    [280, 110, 110, 140, 140, 320],
    true
  );
}

export const DEFAULT_PET_FRAME: string = idleAnimation().frames[0];
export const DEFAULT_PET_RUNTIME: PetRuntimeDefinition =
  new PetRuntimeDefinition(
    DEFAULT_PET_ID,
    '芽芽',
    false,
    null,
    ''
  );

export function createDownloadedPetRuntime(
  pet: PetDetail,
  directory: string
): PetRuntimeDefinition {
  return new PetRuntimeDefinition(
    pet.id,
    pet.displayName,
    true,
    pet,
    directory
  );
}

export function getPetAnimation(
  name: string,
  runtime: PetRuntimeDefinition = DEFAULT_PET_RUNTIME
): PetAnimation {
  return runtime.animation(name);
}

function builtInPetAnimation(name: string): PetAnimation {
  switch (name) {
    case 'runningRight':
      return new PetAnimation(
        framePaths('running-right', 8),
        [120, 120, 120, 120, 120, 120, 120, 220],
        true
      );
    case 'runningLeft':
      return new PetAnimation(
        framePaths('running-left', 8),
        [120, 120, 120, 120, 120, 120, 120, 220],
        true
      );
    case 'waving':
      return new PetAnimation(
        framePaths('waving', 4),
        [140, 140, 140, 280],
        false
      );
    case 'jumping':
      return new PetAnimation(
        framePaths('jumping', 5),
        [140, 140, 140, 140, 280],
        false
      );
    case 'failed':
      return new PetAnimation(
        framePaths('failed', 8),
        [140, 140, 140, 140, 140, 140, 140, 240],
        false
      );
    case 'waiting':
      return new PetAnimation(
        framePaths('waiting', 6),
        [150, 150, 150, 150, 150, 260],
        true
      );
    case 'running':
      return new PetAnimation(
        framePaths('running', 6),
        [120, 120, 120, 120, 120, 220],
        true
      );
    case 'review':
      return new PetAnimation(
        framePaths('review', 6),
        [150, 150, 150, 150, 150, 280],
        true
      );
    default:
      return idleAnimation();
  }
}

export function petAnimationForState(state: string): string {
  return DEFAULT_PET_RUNTIME.animationForState(state);
}

export function petAnimationForRuntimeState(
  state: string,
  runtime: PetRuntimeDefinition
): string {
  return runtime.animationForState(state);
}

function builtInAnimationForState(state: string): string {
  switch (state) {
    case 'daydreaming':
    case 'concerned':
      return 'waiting';
    case 'watching':
      return 'review';
    case 'curious':
      return 'jumping';
    case 'chatting':
      return 'waving';
    case 'offline':
      return 'waiting';
    case 'sleeping':
    case 'idle':
    case 'giving_space':
      return 'idle';
    default:
      return 'idle';
  }
}

export function petSteadyAnimationForState(
  state: string,
  runtime: PetRuntimeDefinition = DEFAULT_PET_RUNTIME
): string {
  const name: string = runtime.animationForState(state);
  return getPetAnimation(name, runtime).loop ? name : 'idle';
}

export function petInteractionAnimation(interaction: string): string {
  return DEFAULT_PET_RUNTIME.animationForInteraction(interaction);
}

export function petInteractionAnimationForRuntime(
  interaction: string,
  runtime: PetRuntimeDefinition
): string {
  return runtime.animationForInteraction(interaction);
}

function builtInInteractionAnimation(interaction: string): string {
  switch (interaction) {
    case 'tap':
      return 'jumping';
    case 'message':
      return 'waving';
    case 'loading':
      return 'running';
    case 'failure':
      return 'failed';
    default:
      return 'idle';
  }
}

export function createPetPlayback(
  name: string,
  runtime: PetRuntimeDefinition = DEFAULT_PET_RUNTIME
): PetPlayback {
  const animation: PetAnimation = getPetAnimation(name, runtime);
  const animationName: string = name === 'idle'
    || name === 'runningRight'
    || name === 'runningLeft'
    || name === 'waving'
    || name === 'jumping'
    || name === 'failed'
    || name === 'waiting'
    || name === 'running'
    || name === 'review'
    ? name
    : 'idle';
  return new PetPlayback(
    animationName,
    0,
    animation.frames[0],
    animation.durationsMs[0],
    false
  );
}

export function advancePetPlayback(
  playback: PetPlayback,
  runtime: PetRuntimeDefinition = DEFAULT_PET_RUNTIME
): PetPlayback {
  const animation: PetAnimation =
    getPetAnimation(playback.animationName, runtime);
  const nextIndex: number = playback.frameIndex + 1;
  if (nextIndex >= animation.frames.length) {
    if (!animation.loop) {
      return new PetPlayback(
        playback.animationName,
        playback.frameIndex,
        playback.framePath,
        0,
        true
      );
    }
    return new PetPlayback(
      playback.animationName,
      0,
      animation.frames[0],
      animation.durationsMs[0],
      false
    );
  }
  return new PetPlayback(
    playback.animationName,
    nextIndex,
    animation.frames[nextIndex],
    animation.durationsMs[nextIndex],
    false
  );
}

export function canTriggerPetTap(lastTapAt: number, now: number): boolean {
  return Number.isFinite(now)
    && Number.isFinite(lastTapAt)
    && now >= lastTapAt
    && now - lastTapAt >= TAP_DEBOUNCE_MS;
}
