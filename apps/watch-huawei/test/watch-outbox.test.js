import assert from "node:assert/strict";
import test from "node:test";

import {
  canRetryReply,
  createPendingReply,
  deserializePendingReply,
  MAX_REPLY_ATTEMPTS,
  normalizePendingReply,
  recordReplyFailure,
  serializePendingReply
} from "../entry/src/main/js/MainAbility/common/watch-outbox.js";

const NOW = 1_750_000_000_000;

function reply() {
  return createPendingReply({
    actionId: "share",
    nudgeId: "nudge_12345678"
  }, "reply-pending-01", NOW);
}

test("创建可持久化的待发送快捷回复", () => {
  assert.deepEqual(reply(), {
    attempts: 0,
    idempotencyKey: "reply-pending-01",
    nextAttemptAt: NOW,
    payload: {
      actionId: "share",
      nudgeId: "nudge_12345678"
    }
  });
});

test("失败后按上限进行指数退避", () => {
  const first = recordReplyFailure(reply(), NOW);
  const second = recordReplyFailure(first, first.nextAttemptAt);
  const third = recordReplyFailure(second, second.nextAttemptAt);

  assert.equal(first.nextAttemptAt, NOW + 2_000);
  assert.equal(second.nextAttemptAt, NOW + 6_000);
  assert.equal(canRetryReply(first, first.nextAttemptAt - 1), false);
  assert.equal(canRetryReply(first, first.nextAttemptAt), true);
  assert.equal(third.attempts, MAX_REPLY_ATTEMPTS);
  assert.equal(canRetryReply(third, third.nextAttemptAt), false);
});

test("拒绝损坏的本地待发送记录", () => {
  assert.throws(
    () => normalizePendingReply({
      attempts: 99
    }),
    /无效/
  );
});

test("待发送回复拆分后每个存储值都低于 128 字节", () => {
  const serialized = serializePendingReply(reply());

  assert.equal(Buffer.byteLength(serialized.meta) < 128, true);
  assert.equal(Buffer.byteLength(serialized.payload) < 128, true);
  assert.deepEqual(
    deserializePendingReply(serialized.meta, serialized.payload),
    reply()
  );
});
