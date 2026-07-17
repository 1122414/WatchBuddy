import { CHARACTER_STATES } from "./contracts.js";

const DEFAULT_STATE = Object.freeze({
  activity: "idle",
  energy: 0.65,
  curiosity: 0.5,
  socialNeed: 0.35,
  lastInteractionAt: null,
  lastInitiativeAt: null
});

export function initialCompanionState(overrides = {}) {
  return normalizeState({ ...DEFAULT_STATE, ...overrides });
}

export function normalizeState(state) {
  if (!CHARACTER_STATES.includes(state.activity)) {
    throw new TypeError(`未知角色状态: ${state.activity}`);
  }

  return Object.freeze({
    activity: state.activity,
    energy: clamp01(state.energy),
    curiosity: clamp01(state.curiosity),
    socialNeed: clamp01(state.socialNeed),
    lastInteractionAt: state.lastInteractionAt ?? null,
    lastInitiativeAt: state.lastInitiativeAt ?? null
  });
}

export function stateForLocalTime(state, hour) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError("hour 必须是 0 到 23 的整数");
  }

  if (hour >= 23 || hour < 7) {
    return normalizeState({
      ...state,
      activity: "sleeping",
      energy: Math.min(state.energy, 0.25)
    });
  }

  if (state.activity === "giving_space") {
    return state;
  }

  if (hour < 9) {
    return normalizeState({ ...state, activity: "watching", energy: 0.5 });
  }
  if (hour >= 14 && hour < 17 && state.curiosity > 0.6) {
    return normalizeState({ ...state, activity: "curious" });
  }
  return normalizeState({ ...state, activity: "idle" });
}

export function applyInteraction(state, outcome, at) {
  const base = { ...state, lastInteractionAt: at };

  switch (outcome) {
    case "busy":
    case "space":
      return normalizeState({
        ...base,
        activity: "giving_space",
        socialNeed: Math.max(0, state.socialNeed - 0.35)
      });
    case "engaged":
      return normalizeState({
        ...base,
        activity: "chatting",
        curiosity: Math.min(1, state.curiosity + 0.1),
        socialNeed: Math.max(0, state.socialNeed - 0.2)
      });
    case "wrong_guess":
      return normalizeState({
        ...base,
        activity: "idle",
        curiosity: Math.max(0, state.curiosity - 0.15)
      });
    default:
      return normalizeState(base);
  }
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
