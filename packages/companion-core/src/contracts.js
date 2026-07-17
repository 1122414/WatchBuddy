export const SCHEMA_VERSION = 1;

export const INITIATIVE_SOURCES = Object.freeze([
  "daily_routine",
  "random_social",
  "relationship_follow_up",
  "user_state",
  "companion_internal"
]);

export const CHARACTER_STATES = Object.freeze([
  "sleeping",
  "idle",
  "daydreaming",
  "watching",
  "curious",
  "concerned",
  "chatting",
  "giving_space"
]);

const MAX_WATCH_MESSAGE_CHARACTERS = 38;

function codePointLength(value) {
  return [...value].length;
}

function isTimestamp(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function validateNudge(nudge, now = Date.now()) {
  const errors = [];

  if (!nudge || typeof nudge !== "object") {
    return ["nudge 必须是对象"];
  }

  if (nudge.schemaVersion !== SCHEMA_VERSION) {
    errors.push("schemaVersion 不受支持");
  }
  if (typeof nudge.nudgeId !== "string" || nudge.nudgeId.length < 8) {
    errors.push("nudgeId 无效");
  }
  if (!INITIATIVE_SOURCES.includes(nudge.source)) {
    errors.push("source 无效");
  }
  if (!Number.isInteger(nudge.intensity) || nudge.intensity < 0 || nudge.intensity > 4) {
    errors.push("intensity 必须在 0 到 4 之间");
  }
  if (!CHARACTER_STATES.includes(nudge.characterState)) {
    errors.push("characterState 无效");
  }
  if (typeof nudge.message !== "string" || codePointLength(nudge.message) === 0) {
    errors.push("message 不能为空");
  } else if (codePointLength(nudge.message) > MAX_WATCH_MESSAGE_CHARACTERS) {
    errors.push(`message 不能超过 ${MAX_WATCH_MESSAGE_CHARACTERS} 个字符`);
  }
  if (!isTimestamp(nudge.createdAt) || !isTimestamp(nudge.expiresAt)) {
    errors.push("createdAt 和 expiresAt 必须是毫秒时间戳");
  } else if (nudge.expiresAt <= nudge.createdAt) {
    errors.push("expiresAt 必须晚于 createdAt");
  } else if (nudge.expiresAt <= now) {
    errors.push("消息已过期");
  }
  if (!Array.isArray(nudge.actions) || nudge.actions.length < 2 || nudge.actions.length > 4) {
    errors.push("actions 数量必须为 2 到 4");
  } else {
    const ids = new Set();
    for (const action of nudge.actions) {
      if (!action || typeof action.id !== "string" || typeof action.label !== "string") {
        errors.push("action 必须包含字符串 id 和 label");
        continue;
      }
      if (ids.has(action.id)) {
        errors.push("action id 不能重复");
      }
      ids.add(action.id);
    }
  }

  return errors;
}

export function validateResponse(response, nudge, now = Date.now()) {
  const errors = [];

  if (!response || typeof response !== "object") {
    return ["response 必须是对象"];
  }
  if (response.schemaVersion !== SCHEMA_VERSION) {
    errors.push("schemaVersion 不受支持");
  }
  if (!nudge || response.nudgeId !== nudge.nudgeId) {
    errors.push("nudgeId 不匹配");
  }
  if (!isTimestamp(response.respondedAt)) {
    errors.push("respondedAt 必须是毫秒时间戳");
  }
  if (nudge && now > nudge.expiresAt) {
    errors.push("不能回复已过期消息");
  }
  const actionIds = new Set(nudge?.actions?.map((action) => action.id) ?? []);
  if (!actionIds.has(response.actionId)) {
    errors.push("actionId 不属于原消息");
  }

  return errors;
}

export function createNudge(input) {
  const nudge = {
    schemaVersion: SCHEMA_VERSION,
    nudgeId: input.nudgeId,
    source: input.source,
    intensity: input.intensity,
    characterState: input.characterState,
    message: input.message,
    haptic: input.haptic ?? "soft_single",
    actions: input.actions,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt
  };

  const errors = validateNudge(nudge, input.createdAt);
  if (errors.length > 0) {
    throw new TypeError(errors.join("; "));
  }

  return Object.freeze(nudge);
}
