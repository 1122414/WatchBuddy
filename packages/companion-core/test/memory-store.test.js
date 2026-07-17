import test from "node:test";
import assert from "node:assert/strict";

import { MemoryStore } from "../src/index.js";

const now = 1_800_000_000_000;

function memory(overrides = {}) {
  return {
    id: "memory_0001",
    type: "event",
    summary: "用户明天下午要做项目汇报",
    sensitivity: "private",
    source: "conversation",
    updatedAt: now,
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    ...overrides
  };
}

test("记忆可以保存、查看和删除", () => {
  const store = new MemoryStore();
  store.save(memory());

  assert.equal(store.list().length, 1);
  assert.equal(store.get("memory_0001").summary, memory().summary);
  assert.equal(store.delete("memory_0001"), true);
  assert.equal(store.get("memory_0001"), null);
});

test("过期记忆不会被检索并可清理", () => {
  const store = new MemoryStore([
    memory({ expiresAt: now - 1 })
  ]);

  assert.deepEqual(store.list({ now }), []);
  assert.equal(store.purgeExpired(now), 1);
});

test("清空操作返回删除数量", () => {
  const store = new MemoryStore([
    memory(),
    memory({ id: "memory_0002", type: "preference", summary: "用户不喜欢说教" })
  ]);

  assert.equal(store.clear(), 2);
  assert.deepEqual(store.list(), []);
});
