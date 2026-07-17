import test from "node:test";
import assert from "node:assert/strict";

import {
  createInitiativeState,
  decideInitiative,
  recordOutcome,
  recordSent
} from "../src/index.js";

const now = 1_800_000_000_000;
const localDate = "2027-01-15";
const candidate = {
  source: "relationship_follow_up",
  topic: "project_presentation"
};
const context = {
  quietMode: false,
  userRequestedSpace: false,
  sleeping: false,
  interruptible: true
};

test("关系跟进候选在可打扰且有预算时发送", () => {
  const result = decideInitiative({
    candidate,
    context,
    initiativeState: createInitiativeState(),
    now,
    localDate
  });

  assert.equal(result.decision, "send");
  assert.match(result.reasons.join(" "), /跟进时间/);
});

test("用户忙碌后六小时内阻止主动消息", () => {
  const state = recordOutcome(createInitiativeState(), "busy", now);
  const result = decideInitiative({
    candidate,
    context,
    initiativeState: state,
    now: now + 5 * 60 * 60 * 1000,
    localDate
  });

  assert.equal(result.decision, "block");
  assert.equal(result.blockedBy, "cooldown");
});

test("达到每日预算后不再发送", () => {
  let state = createInitiativeState();
  state = recordSent(state, { ...candidate, topic: "topic_one" }, now, localDate);
  state = recordSent(state, { ...candidate, topic: "topic_two" }, now + 4 * 60 * 60 * 1000, localDate);

  const result = decideInitiative({
    candidate: { ...candidate, topic: "topic_three" },
    context,
    initiativeState: state,
    now: now + 8 * 60 * 60 * 1000,
    localDate
  });

  assert.equal(result.decision, "block");
  assert.equal(result.blockedBy, "daily_budget");
});

test("安静模式始终硬阻止", () => {
  const result = decideInitiative({
    candidate,
    context: { ...context, quietMode: true },
    initiativeState: createInitiativeState(),
    now,
    localDate
  });

  assert.equal(result.blockedBy, "quiet_mode");
});
