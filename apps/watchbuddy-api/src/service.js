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
  stateForLocalTime
} from "../../../packages/companion-core/src/index.js";

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_REPLY_CHARACTERS = 64;
const TOKEN_BYTES = 32;

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

function candidateForLocalHour(hour, date) {
  const isEvening = hour >= 14;
  return {
    message: isEvening
      ? "今天到现在，哪一小段最值得留下？"
      : "早上好，今天最想先照顾好哪件事？",
    source: "daily_routine",
    topic: `daily_routine_${date}_${isEvening ? "evening" : "morning"}`
  };
}

export class WatchBuddyService {
  #devicesById = new Map();
  #devicesByTokenHash = new Map();
  #idFactory;
  #now;
  #tokenFactory;

  constructor({
    idFactory = () => randomUUID(),
    now = () => Date.now(),
    tokenFactory = () => randomBytes(TOKEN_BYTES).toString("base64url")
  } = {}) {
    this.#idFactory = idFactory;
    this.#now = now;
    this.#tokenFactory = tokenFactory;
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

    return {
      deviceId: device.deviceId,
      deviceToken: token,
      registeredAt: device.registeredAt
    };
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
      const candidate = candidateForLocalHour(hour, date);
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

    return {
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

    return {
      accepted: true,
      characterState: device.state.activity,
      memory,
      nextCheckAt: timestamp + 5 * 60_000,
      reply: acceptedReply
    };
  }

  listMemories(device) {
    return device.memories.list({ now: this.#now() });
  }

  deleteMemory(device, memoryId) {
    return device.memories.delete(memoryId);
  }

  clearMemories(device) {
    return device.memories.clear();
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
