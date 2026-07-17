import test from "node:test";
import assert from "node:assert/strict";

import {
  createNudge,
  SCHEMA_VERSION,
  validateNudge,
  validateResponse
} from "../src/index.js";

const now = 1_800_000_000_000;

function validNudge() {
  return createNudge({
    nudgeId: "nudge_0001",
    source: "relationship_follow_up",
    intensity: 2,
    characterState: "curious",
    message: "昨天那个汇报后来怎么样了？我还记着。",
    actions: [
      { id: "good", label: "挺顺利的" },
      { id: "later", label: "晚点告诉你" },
      { id: "busy", label: "我在忙" }
    ],
    createdAt: now,
    expiresAt: now + 60_000
  });
}

test("创建并验证合法主动消息", () => {
  const nudge = validNudge();
  assert.deepEqual(validateNudge(nudge, now), []);
  assert.equal(Object.isFrozen(nudge), true);
});

test("拒绝超过手表长度限制的消息", () => {
  const nudge = { ...validNudge(), message: "这是一条明显超过三十八个字符限制的手表消息，因此必须在发送到设备之前被协议验证器拒绝。" };
  assert.match(validateNudge(nudge, now).join(" "), /38/);
});

test("拒绝过期消息的回复", () => {
  const nudge = validNudge();
  const response = {
    schemaVersion: SCHEMA_VERSION,
    nudgeId: nudge.nudgeId,
    actionId: "good",
    respondedAt: now + 120_000
  };
  assert.match(validateResponse(response, nudge, response.respondedAt).join(" "), /过期/);
});
