import test from "node:test";
import assert from "node:assert/strict";

import {
  createDeliveryAck,
  IncomingMessageRegistry,
  ReliableOutbox
} from "../src/index.js";

const now = 1_800_000_000_000;

test("接收端拒绝重复和过期消息", () => {
  const registry = new IncomingMessageRegistry();
  const message = { messageId: "nudge_0001", expiresAt: now + 60_000 };

  assert.equal(registry.accept(message, now).status, "received");
  assert.equal(registry.accept(message, now + 1).status, "duplicate");
  assert.equal(registry.accept({
    messageId: "nudge_0002",
    expiresAt: now - 1
  }, now).status, "expired");
});

test("发件箱按计划重试并在 ACK 后停止", () => {
  const outbox = new ReliableOutbox({ retryDelaysMs: [0, 5_000, 20_000] });
  outbox.enqueue({
    messageId: "nudge_0001",
    payload: "{}",
    expiresAt: now + 60_000
  }, now);

  assert.equal(outbox.takeDue(now)[0].attemptNumber, 1);
  assert.deepEqual(outbox.takeDue(now + 4_999), []);
  assert.equal(outbox.takeDue(now + 5_000)[0].attemptNumber, 2);
  assert.equal(outbox.acknowledge("nudge_0001"), true);
  assert.deepEqual(outbox.takeDue(now + 30_000), []);
});

test("消息过期后不会继续重试", () => {
  const outbox = new ReliableOutbox({ retryDelaysMs: [0, 5_000] });
  outbox.enqueue({
    messageId: "nudge_0001",
    payload: "{}",
    expiresAt: now + 1_000
  }, now);

  assert.equal(outbox.takeDue(now).length, 1);
  assert.deepEqual(outbox.takeDue(now + 5_000), []);
  assert.deepEqual(outbox.snapshot(), []);
});

test("ACK 使用显式状态和协议版本", () => {
  const ack = createDeliveryAck({
    messageId: "nudge_0001",
    status: "displayed",
    acknowledgedAt: now
  });

  assert.deepEqual(ack, {
    schemaVersion: 1,
    type: "DELIVERY_ACK",
    messageId: "nudge_0001",
    status: "displayed",
    acknowledgedAt: now
  });
});
