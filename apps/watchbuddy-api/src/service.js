import {
  createHash,
  randomBytes,
  randomUUID
} from "node:crypto";

import {
  MemoryStore,
  applyInteraction,
  createNudge,
  createResponse,
  initialCompanionState,
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
      memories: new MemoryStore(),
      pendingNudge: null,
      state: initialCompanionState()
    };

    device.locale = input.locale || "zh-CN";
    device.registeredAt = existing?.registeredAt ?? timestamp;
    device.revokedAt = null;
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
    device.state = stateForLocalTime(
      device.state,
      localHour(timestamp, device.timezoneOffsetMinutes)
    );

    if (!device.pendingNudge || device.pendingNudge.expiresAt <= timestamp) {
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
        message: "今天到现在，哪一小段最值得留下？",
        nudgeId: `nudge_${this.#idFactory()}`,
        source: "daily_routine"
      });
    }

    return {
      characterState: device.state.activity,
      companionState: device.state,
      nextCheckAt: timestamp + 5 * 60_000,
      nudge: device.pendingNudge,
      serverTime: timestamp
    };
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
}
