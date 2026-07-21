import {
  createHash,
  randomBytes,
  randomUUID
} from "node:crypto";

import {
  createInitiativeState,
  decideInitiative,
  DEFAULT_POLICY,
  MemoryStore,
  applyInteraction,
  createNudge,
  createResponse,
  initialCompanionState,
  recordOutcome,
  recordSent,
  stateForLocalTime,
  validateNudge
} from "../../../packages/companion-core/src/index.js";
import {
  FALLBACK_COMPANION_TEXT,
  MAX_COMPANION_REPLY_CHARACTERS
} from "./ai-adapter.js";

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_REPLY_CHARACTERS = 64;
const TOKEN_BYTES = 32;
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const FOLLOW_UP_DELAY_MS = 24 * 60 * 60_000;
const RANDOM_SOCIAL_MESSAGES = Object.freeze([
  "路过来看看，此刻要不要一起喘口气？",
  "今天有没有一个小瞬间，让你想停一下？",
  "来打个轻轻的招呼，你现在感觉还好吗？"
]);

const ACTION_OUTCOMES = Object.freeze({
  share: "engaged",
  later: "busy",
  busy: "busy",
  space: "space"
});

function codePointLength(value) {
  return [...value].length;
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function validateRegistration(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("注册信息必须是对象");
  }
  if (typeof input.deviceId !== "string"
    || !DEVICE_ID_PATTERN.test(input.deviceId)) {
    throw new TypeError("deviceId 必须是 8 到 64 位字母、数字、下划线或连字符");
  }
  if (!Number.isInteger(input.timezoneOffsetMinutes)
    || input.timezoneOffsetMinutes < -840
    || input.timezoneOffsetMinutes > 840) {
    throw new TypeError("timezoneOffsetMinutes 无效");
  }
  if (input.locale !== undefined
    && (typeof input.locale !== "string" || input.locale.length > 16)) {
    throw new TypeError("locale 无效");
  }
}

function localHour(timestamp, timezoneOffsetMinutes) {
  const localTimestamp = timestamp + timezoneOffsetMinutes * 60_000;
  return new Date(localTimestamp).getUTCHours();
}

function localDate(timestamp, timezoneOffsetMinutes) {
  const localTimestamp = timestamp + timezoneOffsetMinutes * 60_000;
  return new Date(localTimestamp).toISOString().slice(0, 10);
}

function nextLocalHourAt(timestamp, timezoneOffsetMinutes, targetHour) {
  const offsetMilliseconds = timezoneOffsetMinutes * 60_000;
  const localTimestamp = timestamp + offsetMilliseconds;
  const target = new Date(localTimestamp);
  target.setUTCHours(targetHour, 0, 0, 0);
  if (target.getTime() <= localTimestamp) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - offsetMilliseconds;
}

function stableMessageIndex(deviceId, date) {
  return createHash("sha256")
    .update(`${deviceId}:${date}`)
    .digest()[0] % RANDOM_SOCIAL_MESSAGES.length;
}

function followUpCandidate(device, timestamp) {
  const memory = device.memories.list({
    now: timestamp,
    type: "unfinished_topic"
  }).find((candidate) => (
    candidate.sensitivity !== "sensitive"
    && timestamp - candidate.updatedAt >= FOLLOW_UP_DELAY_MS
  ));
  if (!memory) {
    return null;
  }
  return {
    message: "上次没聊完的事，现在要继续吗？",
    source: "relationship_follow_up",
    topic: `memory_follow_up_${memory.id}`
  };
}

function candidateForDevice(device, hour, date, timestamp) {
  const followUp = followUpCandidate(device, timestamp);
  if (followUp) {
    return followUp;
  }
  if (hour >= 14 && hour < 18) {
    return {
      message: RANDOM_SOCIAL_MESSAGES[
        stableMessageIndex(device.deviceId, date)
      ],
      source: "random_social",
      topic: `random_social_${date}`
    };
  }
  const isEvening = hour >= 14;
  return {
    message: isEvening
      ? "今天到现在，哪一小段最值得留下？"
      : "早上好，今天最想先照顾好哪件事？",
    source: "daily_routine",
    topic: `daily_routine_${date}_${isEvening ? "evening" : "morning"}`
  };
}

function restoreDevice(record, now) {
  validateRegistration(record);
  if (typeof record.locale !== "string"
    || record.locale.length < 1
    || !TOKEN_HASH_PATTERN.test(record.tokenHash ?? "")
    || !Number.isSafeInteger(record.registeredAt)
    || record.registeredAt <= 0
    || (record.revokedAt !== null && (
      !Number.isSafeInteger(record.revokedAt)
      || record.revokedAt < record.registeredAt
    ))
    || !record.settings
    || typeof record.settings.quietMode !== "boolean"
    || !Array.isArray(record.memories)
    || record.memories.length > 1000
    || !isValidInitiativeState(record.initiativeState)
    || !isValidCompanionState(record.state)) {
    throw new TypeError("持久化设备状态无效");
  }
  let pendingNudge = record.pendingNudge ?? null;
  if (pendingNudge) {
    const errors = validateNudge(pendingNudge, pendingNudge.createdAt);
    if (errors.length > 0) {
      throw new TypeError("持久化主动消息无效");
    }
    if (pendingNudge.expiresAt <= now) {
      pendingNudge = null;
    }
  }
  const memories = new MemoryStore(record.memories);
  memories.purgeExpired(now);
  return {
    deviceId: record.deviceId,
    initiativeState: createInitiativeState(record.initiativeState),
    locale: record.locale,
    memories,
    pendingNudge,
    registeredAt: record.registeredAt,
    revokedAt: record.revokedAt,
    settings: {
      quietMode: record.settings.quietMode
    },
    state: initialCompanionState(record.state),
    timezoneOffsetMinutes: record.timezoneOffsetMinutes,
    tokenHash: record.tokenHash
  };
}

function isNullableTimestamp(value) {
  return value === null
    || (Number.isSafeInteger(value) && value > 0);
}

function isValidCompanionState(value) {
  return value
    && typeof value === "object"
    && typeof value.activity === "string"
    && Number.isFinite(value.energy)
    && value.energy >= 0
    && value.energy <= 1
    && Number.isFinite(value.curiosity)
    && value.curiosity >= 0
    && value.curiosity <= 1
    && Number.isFinite(value.socialNeed)
    && value.socialNeed >= 0
    && value.socialNeed <= 1
    && isNullableTimestamp(value.lastInteractionAt)
    && isNullableTimestamp(value.lastInitiativeAt);
}

function isValidInitiativeState(value) {
  return value
    && (value.localDate === null
      || (typeof value.localDate === "string"
        && /^\d{4}-\d{2}-\d{2}$/.test(value.localDate)))
    && Number.isInteger(value.sentCount)
    && value.sentCount >= 0
    && value.sentCount <= 100
    && isNullableTimestamp(value.lastNudgeAt)
    && isNullableTimestamp(value.blockedUntil)
    && Array.isArray(value.recentTopics)
    && value.recentTopics.length <= 8
    && value.recentTopics.every(
      (topic) => typeof topic === "string" && topic.length <= 160
    );
}

function snapshotDevice(device) {
  return {
    deviceId: device.deviceId,
    initiativeState: device.initiativeState,
    locale: device.locale,
    memories: device.memories.list({ now: 0 }),
    pendingNudge: device.pendingNudge,
    registeredAt: device.registeredAt,
    revokedAt: device.revokedAt,
    settings: device.settings,
    state: device.state,
    timezoneOffsetMinutes: device.timezoneOffsetMinutes,
    tokenHash: device.tokenHash
  };
}

export class WatchBuddyService {
  #companionResponder;
  #devicesById = new Map();
  #devicesByTokenHash = new Map();
  #idFactory;
  #now;
  #stateStore;
  #tokenFactory;

  constructor({
    companionResponder = null,
    idFactory = () => randomUUID(),
    now = () => Date.now(),
    stateStore = null,
    tokenFactory = () => randomBytes(TOKEN_BYTES).toString("base64url")
  } = {}) {
    if (companionResponder !== null
      && typeof companionResponder?.respond !== "function") {
      throw new TypeError("companionResponder 必须实现 respond");
    }
    this.#companionResponder = companionResponder;
    this.#idFactory = idFactory;
    this.#now = now;
    this.#stateStore = stateStore;
    this.#tokenFactory = tokenFactory;
    this.#restore();
  }

  #restore() {
    if (!this.#stateStore) {
      return;
    }
    if (typeof this.#stateStore.load !== "function"
      || typeof this.#stateStore.save !== "function") {
      throw new TypeError("stateStore 必须实现 load/save");
    }
    const records = this.#stateStore.load();
    if (!Array.isArray(records)) {
      throw new TypeError("持久化设备集合无效");
    }
    const devicesById = new Map();
    const devicesByTokenHash = new Map();
    for (const record of records) {
      const device = restoreDevice(record, this.#now());
      if (devicesById.has(device.deviceId)
        || (!device.revokedAt
          && devicesByTokenHash.has(device.tokenHash))) {
        throw new TypeError("持久化设备 ID 或令牌摘要重复");
      }
      devicesById.set(device.deviceId, device);
      if (!device.revokedAt) {
        devicesByTokenHash.set(device.tokenHash, device);
      }
    }
    this.#devicesById = devicesById;
    this.#devicesByTokenHash = devicesByTokenHash;
  }

  #persist() {
    if (!this.#stateStore) {
      return;
    }
    try {
      this.#stateStore.save(
        [...this.#devicesById.values()].map(snapshotDevice)
      );
    } catch (error) {
      this.#restore();
      throw error;
    }
  }

  registerDevice(input, currentDeviceToken = "") {
    validateRegistration(input);

    const timestamp = this.#now();
    const token = this.#tokenFactory();
    if (typeof token !== "string" || token.length < 32) {
      throw new TypeError("tokenFactory 必须生成至少 32 位令牌");
    }

    const existing = this.#devicesById.get(input.deviceId);
    if (existing) {
      if (!existing.revokedAt
        && this.authenticate(currentDeviceToken) !== existing) {
        throw new TypeError(
          "deviceId 已注册，轮换令牌必须提供当前设备令牌"
        );
      }
      this.#devicesByTokenHash.delete(existing.tokenHash);
    }

    const device = existing ?? {
      deviceId: input.deviceId,
      initiativeState: createInitiativeState(),
      memories: new MemoryStore(),
      pendingNudge: null,
      settings: {
        quietMode: false
      },
      state: initialCompanionState()
    };

    device.locale = input.locale || "zh-CN";
    device.registeredAt = existing?.registeredAt ?? timestamp;
    device.revokedAt = null;
    device.settings ??= {
      quietMode: false
    };
    device.timezoneOffsetMinutes = input.timezoneOffsetMinutes;
    device.tokenHash = tokenHash(token);
    this.#devicesById.set(device.deviceId, device);
    this.#devicesByTokenHash.set(device.tokenHash, device);

    const registration = {
      deviceId: device.deviceId,
      deviceToken: token,
      registeredAt: device.registeredAt
    };
    this.#persist();
    return registration;
  }

  authenticate(deviceToken) {
    if (typeof deviceToken !== "string" || deviceToken.length < 32) {
      return null;
    }
    return this.#devicesByTokenHash.get(tokenHash(deviceToken)) ?? null;
  }

  revokeDevice(device) {
    if (!device || device.revokedAt) {
      return false;
    }
    device.revokedAt = this.#now();
    this.#devicesByTokenHash.delete(device.tokenHash);
    this.#persist();
    return true;
  }

  getCompanionState(device) {
    const timestamp = this.#now();
    if (device.state.activity === "giving_space"
      && Number.isSafeInteger(device.state.lastInteractionAt)
      && timestamp - device.state.lastInteractionAt
        >= DEFAULT_POLICY.cooldownAfterBusyMs) {
      device.state = initialCompanionState({
        ...device.state,
        activity: "idle"
      });
    }
    const hour = localHour(timestamp, device.timezoneOffsetMinutes);
    const date = localDate(timestamp, device.timezoneOffsetMinutes);
    device.state = stateForLocalTime(
      device.state,
      hour
    );

    if (device.pendingNudge && device.pendingNudge.expiresAt <= timestamp) {
      device.pendingNudge = null;
      device.initiativeState = recordOutcome(
        device.initiativeState,
        "ignored",
        timestamp
      );
    }

    let initiative = {
      blockedBy: null,
      decision: "pending",
      reasons: []
    };
    if (!device.pendingNudge) {
      const candidate = candidateForDevice(
        device,
        hour,
        date,
        timestamp
      );
      initiative = decideInitiative({
        candidate,
        context: {
          interruptible: true,
          quietMode: device.settings.quietMode,
          sleeping: device.state.activity === "sleeping",
          userRequestedSpace: device.state.activity === "giving_space"
        },
        initiativeState: device.initiativeState,
        localDate: date,
        now: timestamp
      });
      device.initiativeState = initiative.state;

      if (initiative.decision === "send") {
        device.pendingNudge = createNudge({
          actions: [
            { id: "share", label: "跟你说说" },
            { id: "later", label: "晚点" },
            { id: "busy", label: "我在忙" }
          ],
          characterState: device.state.activity,
          createdAt: timestamp,
          expiresAt: timestamp + 15 * 60_000,
          intensity: 1,
          message: candidate.message,
          nudgeId: `nudge_${this.#idFactory()}`,
          source: candidate.source
        });
        device.initiativeState = recordSent(
          device.initiativeState,
          candidate,
          timestamp,
          date
        );
      }
    }

    const result = {
      characterState: device.state.activity,
      companionState: device.state,
      initiative: {
        blockedBy: initiative.blockedBy,
        decision: initiative.decision,
        reasons: initiative.reasons
      },
      nextCheckAt: this.#nextCheckAt(device, initiative, timestamp),
      nudge: device.pendingNudge,
      settings: this.getSettings(device),
      serverTime: timestamp
    };
    this.#persist();
    return result;
  }

  getSettings(device) {
    return {
      quietMode: device.settings.quietMode
    };
  }

  updateSettings(device, input) {
    if (!input
      || typeof input !== "object"
      || Array.isArray(input)
      || Object.keys(input).length !== 1
      || typeof input.quietMode !== "boolean") {
      throw new TypeError("设置必须且只能包含布尔值 quietMode");
    }

    device.settings = {
      quietMode: input.quietMode
    };
    if (input.quietMode) {
      device.pendingNudge = null;
    }
    this.#persist();
    return this.getSettings(device);
  }

  reply(device, input) {
    if (!input || typeof input !== "object") {
      throw new TypeError("回复必须是对象");
    }

    const hasText = typeof input.text === "string";
    const hasQuickReply = typeof input.nudgeId === "string"
      || typeof input.actionId === "string";
    if (hasText === hasQuickReply) {
      throw new TypeError("必须且只能提交文字回复或快捷回复");
    }

    const timestamp = this.#now();
    let outcome = "engaged";
    let acceptedReply;
    let memory = null;

    if (hasText) {
      const text = input.text.trim();
      if (!text || codePointLength(text) > MAX_REPLY_CHARACTERS) {
        throw new TypeError(`文字回复必须为 1 到 ${MAX_REPLY_CHARACTERS} 个字符`);
      }
      acceptedReply = {
        respondedAt: timestamp,
        text
      };

      if (input.remember === true) {
        memory = device.memories.save({
          expiresAt: null,
          id: `memory_${this.#idFactory()}`,
          sensitivity: input.sensitivity ?? "normal",
          source: "watch_reply",
          summary: text,
          type: input.memoryType ?? "event",
          updatedAt: timestamp
        });
      }
    } else {
      if (!device.pendingNudge) {
        throw new TypeError("当前没有可回复的消息");
      }
      const response = createResponse({
        actionId: input.actionId,
        nudgeId: input.nudgeId,
        respondedAt: timestamp,
        responseLatencyMs: Math.max(
          0,
          timestamp - device.pendingNudge.createdAt
        )
      }, device.pendingNudge, timestamp);
      acceptedReply = response;
      outcome = ACTION_OUTCOMES[input.actionId] ?? "engaged";
    }

    device.state = applyInteraction(device.state, outcome, timestamp);
    device.initiativeState = recordOutcome(
      device.initiativeState,
      outcome,
      timestamp
    );
    device.pendingNudge = null;

    const result = {
      accepted: true,
      characterState: device.state.activity,
      memory,
      nextCheckAt: timestamp + 5 * 60_000,
      reply: acceptedReply
    };
    this.#persist();
    return result;
  }

  async replyWithCompanion(device, input) {
    const result = this.reply(device, input);
    if (typeof input.text !== "string") {
      return result;
    }

    let companionReply = {
      fallback: true,
      text: FALLBACK_COMPANION_TEXT
    };
    if (this.#companionResponder) {
      try {
        const generated = await this.#companionResponder.respond({
          deviceId: device.deviceId,
          locale: device.locale,
          text: result.reply.text
        });
        if (generated
          && typeof generated.fallback === "boolean"
          && typeof generated.text === "string"
          && generated.text.trim() === generated.text
          && generated.text.length > 0
          && codePointLength(generated.text)
            <= MAX_COMPANION_REPLY_CHARACTERS) {
          companionReply = {
            fallback: generated.fallback,
            text: generated.text
          };
        }
      } catch (error) {
        companionReply = {
          fallback: true,
          text: FALLBACK_COMPANION_TEXT
        };
      }
    }

    return {
      ...result,
      companionReply
    };
  }

  listMemories(device) {
    return device.memories.list({ now: this.#now() });
  }

  deleteMemory(device, memoryId) {
    const deleted = device.memories.delete(memoryId);
    if (deleted) {
      this.#persist();
    }
    return deleted;
  }

  clearMemories(device) {
    const deleted = device.memories.clear();
    if (deleted > 0) {
      this.#persist();
    }
    return deleted;
  }

  #nextCheckAt(device, initiative, timestamp) {
    if (device.pendingNudge) {
      return Math.min(
        device.pendingNudge.expiresAt,
        timestamp + 5 * 60_000
      );
    }
    if (Number.isSafeInteger(device.initiativeState.blockedUntil)
      && device.initiativeState.blockedUntil > timestamp) {
      return device.initiativeState.blockedUntil;
    }
    if (initiative.blockedBy === "quiet_mode") {
      return timestamp + 6 * 60 * 60_000;
    }
    if (Number.isSafeInteger(device.initiativeState.lastNudgeAt)) {
      const cooldownUntil = device.initiativeState.lastNudgeAt
        + DEFAULT_POLICY.cooldownAfterNudgeMs;
      if (cooldownUntil > timestamp) {
        return cooldownUntil;
      }
    }
    if (initiative.blockedBy === "sleeping"
      || initiative.blockedBy === "daily_budget"
      || initiative.blockedBy === "repeated_topic") {
      return nextLocalHourAt(
        timestamp,
        device.timezoneOffsetMinutes,
        7
      );
    }
    return timestamp + 30 * 60_000;
  }
}
