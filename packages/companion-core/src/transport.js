import { MESSAGE_TYPES, SCHEMA_VERSION } from "./contracts.js";

const DEFAULT_RETRY_DELAYS_MS = Object.freeze([0, 5_000, 20_000]);
const ACK_STATUSES = new Set([
  "received",
  "displayed",
  "responded",
  "expired",
  "duplicate",
  "invalid"
]);

export class IncomingMessageRegistry {
  #items = new Map();

  constructor({ maxEntries = 128 } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("maxEntries 必须是正整数");
    }
    this.maxEntries = maxEntries;
  }

  accept({ messageId, expiresAt }, now = Date.now()) {
    validateMessageIdentity(messageId, expiresAt);
    this.purge(now);

    if (expiresAt <= now) {
      return Object.freeze({ accepted: false, status: "expired" });
    }
    if (this.#items.has(messageId)) {
      return Object.freeze({ accepted: false, status: "duplicate" });
    }

    this.#items.set(messageId, expiresAt);
    while (this.#items.size > this.maxEntries) {
      this.#items.delete(this.#items.keys().next().value);
    }
    return Object.freeze({ accepted: true, status: "received" });
  }

  purge(now = Date.now()) {
    let deleted = 0;
    for (const [messageId, expiresAt] of this.#items) {
      if (expiresAt <= now) {
        this.#items.delete(messageId);
        deleted += 1;
      }
    }
    return deleted;
  }

  snapshot() {
    return [...this.#items].map(([messageId, expiresAt]) => ({ messageId, expiresAt }));
  }
}

export class ReliableOutbox {
  #items = new Map();

  constructor({ retryDelaysMs = DEFAULT_RETRY_DELAYS_MS } = {}) {
    if (!Array.isArray(retryDelaysMs)
        || retryDelaysMs.length === 0
        || retryDelaysMs.some((delay) => !Number.isSafeInteger(delay) || delay < 0)) {
      throw new TypeError("retryDelaysMs 必须是非负毫秒数组");
    }
    this.retryDelaysMs = Object.freeze([...retryDelaysMs]);
  }

  enqueue({ messageId, payload, expiresAt }, now = Date.now()) {
    validateMessageIdentity(messageId, expiresAt);
    if (expiresAt <= now) {
      throw new RangeError("不能发送已过期消息");
    }
    if (this.#items.has(messageId)) {
      return false;
    }

    this.#items.set(messageId, {
      messageId,
      payload,
      expiresAt,
      attempts: 0,
      nextAttemptAt: now + this.retryDelaysMs[0]
    });
    return true;
  }

  takeDue(now = Date.now()) {
    this.purgeExpired(now);
    const due = [...this.#items.values()]
      .filter((item) => item.attempts < this.retryDelaysMs.length)
      .filter((item) => item.nextAttemptAt <= now)
      .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt);

    return due.map((item) => {
      const attemptNumber = item.attempts + 1;
      const nextDelay = this.retryDelaysMs[attemptNumber];
      item.attempts = attemptNumber;
      item.nextAttemptAt = nextDelay == null ? null : now + nextDelay;
      return Object.freeze({
        messageId: item.messageId,
        payload: item.payload,
        attemptNumber,
        finalAttempt: attemptNumber === this.retryDelaysMs.length
      });
    });
  }

  acknowledge(messageId) {
    return this.#items.delete(messageId);
  }

  purgeExpired(now = Date.now()) {
    let deleted = 0;
    for (const [messageId, item] of this.#items) {
      if (item.expiresAt <= now) {
        this.#items.delete(messageId);
        deleted += 1;
      }
    }
    return deleted;
  }

  snapshot() {
    return [...this.#items.values()].map((item) => Object.freeze({ ...item }));
  }
}

export function createDeliveryAck({ messageId, status, acknowledgedAt }) {
  if (typeof messageId !== "string" || messageId.length < 8) {
    throw new TypeError("messageId 无效");
  }
  if (!ACK_STATUSES.has(status)) {
    throw new TypeError("ACK status 无效");
  }
  if (!Number.isSafeInteger(acknowledgedAt) || acknowledgedAt <= 0) {
    throw new TypeError("acknowledgedAt 必须是毫秒时间戳");
  }

  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.ACK,
    messageId,
    status,
    acknowledgedAt
  });
}

function validateMessageIdentity(messageId, expiresAt) {
  if (typeof messageId !== "string" || messageId.length < 8) {
    throw new TypeError("messageId 无效");
  }
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new TypeError("expiresAt 必须是毫秒时间戳");
  }
}
