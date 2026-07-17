const MEMORY_TYPES = new Set(["event", "preference", "unfinished_topic", "ritual"]);

export class MemoryStore {
  #items = new Map();

  constructor(items = []) {
    for (const item of items) {
      this.save(item);
    }
  }

  save(memory) {
    validateMemory(memory);
    this.#items.set(memory.id, Object.freeze({ ...memory }));
    return this.#items.get(memory.id);
  }

  get(id) {
    return this.#items.get(id) ?? null;
  }

  list({ type, now = Date.now() } = {}) {
    return [...this.#items.values()]
      .filter((item) => !type || item.type === type)
      .filter((item) => !item.expiresAt || item.expiresAt > now)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  delete(id) {
    return this.#items.delete(id);
  }

  clear() {
    const count = this.#items.size;
    this.#items.clear();
    return count;
  }

  purgeExpired(now = Date.now()) {
    let deleted = 0;
    for (const [id, item] of this.#items) {
      if (item.expiresAt && item.expiresAt <= now) {
        this.#items.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }
}

export function validateMemory(memory) {
  if (!memory || typeof memory !== "object") {
    throw new TypeError("memory 必须是对象");
  }
  if (typeof memory.id !== "string" || memory.id.length < 8) {
    throw new TypeError("memory.id 无效");
  }
  if (!MEMORY_TYPES.has(memory.type)) {
    throw new TypeError("memory.type 无效");
  }
  if (typeof memory.summary !== "string" || memory.summary.trim().length === 0) {
    throw new TypeError("memory.summary 不能为空");
  }
  if (!["normal", "private", "sensitive"].includes(memory.sensitivity)) {
    throw new TypeError("memory.sensitivity 无效");
  }
  if (!Number.isSafeInteger(memory.updatedAt)) {
    throw new TypeError("memory.updatedAt 必须是毫秒时间戳");
  }
  if (memory.expiresAt != null && !Number.isSafeInteger(memory.expiresAt)) {
    throw new TypeError("memory.expiresAt 必须是毫秒时间戳");
  }
}
