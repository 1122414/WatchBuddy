import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { JsonStateStore } from "../src/json-state-store.js";
import { FALLBACK_COMPANION_TEXT } from "../src/ai-adapter.js";
import { WatchBuddyService } from "../src/service.js";

const NOW = Date.parse("2026-07-18T03:00:00.000Z");
const TOKEN = "test_device_token_123456789012345678901234567890";

function createService(initialTimestamp = NOW) {
  let id = 0;
  let timestamp = initialTimestamp;
  const service = new WatchBuddyService({
    idFactory: () => `test_${String(id += 1).padStart(8, "0")}`,
    now: () => timestamp,
    tokenFactory: () => TOKEN
  });

  return {
    advance(milliseconds) {
      timestamp += milliseconds;
    },
    service
  };
}

function register(service) {
  return service.registerDevice({
    deviceId: "gt6pro_test_01",
    locale: "zh-CN",
    timezoneOffsetMinutes: 480
  });
}

test("注册生成可验证且可撤销的设备令牌", () => {
  const { service } = createService();

  const registration = register(service);
  const device = service.authenticate(registration.deviceToken);

  assert.equal(registration.deviceToken, TOKEN);
  assert.equal(device.deviceId, "gt6pro_test_01");
  assert.equal(service.revokeDevice(device), true);
  assert.equal(service.authenticate(TOKEN), null);
});

test("重复注册会轮换令牌并保留该设备的状态", () => {
  const tokens = [
    "first_device_token_123456789012345678901234567890",
    "second_device_token_12345678901234567890123456789"
  ];
  let tokenIndex = 0;
  const service = new WatchBuddyService({
    now: () => NOW,
    tokenFactory: () => tokens[tokenIndex++]
  });

  const first = register(service);
  const firstDevice = service.authenticate(first.deviceToken);
  service.reply(firstDevice, {
    remember: true,
    text: "保留这条记忆"
  });

  const second = service.registerDevice({
    deviceId: "gt6pro_test_01",
    locale: "zh-CN",
    timezoneOffsetMinutes: 480
  }, first.deviceToken);
  const secondDevice = service.authenticate(second.deviceToken);

  assert.equal(service.authenticate(first.deviceToken), null);
  assert.equal(secondDevice.deviceId, firstDevice.deviceId);
  assert.equal(service.listMemories(secondDevice).length, 1);
});

test("拒绝未持有当前令牌的设备 ID 覆盖注册", () => {
  const { service } = createService();
  register(service);

  assert.throws(
    () => register(service),
    /必须提供当前设备令牌/
  );
});

test("设备主动撤销后可以重新注册", () => {
  const tokens = [
    "first_device_token_123456789012345678901234567890",
    "second_device_token_12345678901234567890123456789"
  ];
  let tokenIndex = 0;
  const service = new WatchBuddyService({
    now: () => NOW,
    tokenFactory: () => tokens[tokenIndex++]
  });
  const first = register(service);
  const device = service.authenticate(first.deviceToken);
  service.revokeDevice(device);

  const second = register(service);

  assert.equal(second.deviceToken, tokens[1]);
  assert.equal(service.authenticate(second.deviceToken).deviceId, device.deviceId);
});

test("状态接口生成通过 companion-core 校验的表端消息", () => {
  const { service } = createService();
  const registration = register(service);
  const device = service.authenticate(registration.deviceToken);

  const state = service.getCompanionState(device);

  assert.equal(state.characterState, "idle");
  assert.equal(state.nudge.type, "COMPANION_NUDGE");
  assert.equal(state.nudge.source, "daily_routine");
  assert.deepEqual(state.initiative.reasons, [
    "处于日常互动窗口",
    "当前可被打扰",
    "仍有当日主动预算"
  ]);
  assert.equal(state.nudge.actions.length, 3);
  assert.equal(state.nextCheckAt, NOW + 5 * 60_000);
});

test("睡眠时段不生成主动消息", () => {
  const midnightInChina = Date.parse("2026-07-18T16:00:00.000Z");
  const { service } = createService(midnightInChina);
  const registration = register(service);
  const device = service.authenticate(registration.deviceToken);

  const state = service.getCompanionState(device);

  assert.equal(state.characterState, "sleeping");
  assert.equal(state.nudge, null);
  assert.equal(state.initiative.blockedBy, "sleeping");
  assert.equal(state.nextCheckAt, midnightInChina + 7 * 60 * 60 * 1000);
});

test("忙碌回复抑制消息并在六小时后恢复", () => {
  const { advance, service } = createService();
  const registration = register(service);
  const device = service.authenticate(registration.deviceToken);
  const first = service.getCompanionState(device);

  service.reply(device, {
    actionId: "busy",
    nudgeId: first.nudge.nudgeId
  });
  advance(60 * 60 * 1000);
  const blocked = service.getCompanionState(device);
  assert.equal(blocked.nudge, null);
  assert.equal(blocked.initiative.blockedBy, "user_requested_space");
  assert.equal(blocked.nextCheckAt, NOW + 6 * 60 * 60 * 1000);

  advance(5 * 60 * 60 * 1000);
  const resumed = service.getCompanionState(device);
  assert.equal(resumed.nudge.type, "COMPANION_NUDGE");
});

test("每日主动预算达到两次后停止发送", () => {
  const { advance, service } = createService();
  const registration = register(service);
  const device = service.authenticate(registration.deviceToken);
  const morning = service.getCompanionState(device);
  service.reply(device, {
    actionId: "share",
    nudgeId: morning.nudge.nudgeId
  });

  advance(3 * 60 * 60 * 1000);
  const evening = service.getCompanionState(device);
  service.reply(device, {
    actionId: "share",
    nudgeId: evening.nudge.nudgeId
  });

  advance(3 * 60 * 60 * 1000);
  const budgetBlocked = service.getCompanionState(device);
  assert.equal(budgetBlocked.nudge, null);
  assert.equal(budgetBlocked.initiative.blockedBy, "daily_budget");
});

test("下午窗口生成稳定且可解释的随机关心", () => {
  const afternoonInChina = Date.parse("2026-07-18T07:00:00.000Z");
  const { service } = createService(afternoonInChina);
  const registration = register(service);
  const device = service.authenticate(registration.deviceToken);
  const { service: secondService } = createService(afternoonInChina);
  const secondRegistration = register(secondService);
  const secondDevice = secondService.authenticate(
    secondRegistration.deviceToken
  );

  const state = service.getCompanionState(device);
  const repeated = secondService.getCompanionState(secondDevice);

  assert.equal(state.nudge.source, "random_social");
  assert.equal(state.nudge.message, repeated.nudge.message);
  assert.deepEqual(state.initiative.reasons, [
    "进入低频随机关心窗口",
    "当前可被打扰",
    "仍有当日主动预算"
  ]);
});

test("普通未完成话题满一天后优先生成不泄露正文的关系跟进", () => {
  const { advance, service } = createService();
  const registration = register(service);
  const device = service.authenticate(registration.deviceToken);
  service.reply(device, {
    memoryType: "unfinished_topic",
    remember: true,
    sensitivity: "private",
    text: "不应该出现在主动提醒里的私密正文"
  });

  advance(24 * 60 * 60_000);
  const state = service.getCompanionState(device);

  assert.equal(state.nudge.source, "relationship_follow_up");
  assert.equal(state.nudge.message, "上次没聊完的事，现在要继续吗？");
  assert.equal(state.nudge.message.includes("私密正文"), false);
  assert.equal(
    state.initiative.reasons[0],
    "未完成事件已到跟进时间"
  );
});

test("敏感记忆不会进入主动关系跟进", () => {
  const { advance, service } = createService();
  const registration = register(service);
  const device = service.authenticate(registration.deviceToken);
  service.reply(device, {
    memoryType: "unfinished_topic",
    remember: true,
    sensitivity: "sensitive",
    text: "敏感事项"
  });

  advance(24 * 60 * 60_000);
  const state = service.getCompanionState(device);

  assert.equal(state.nudge.source, "daily_routine");
});

test("安静模式立即撤下消息并持续阻止主动互动", () => {
  const { advance, service } = createService();
  const registration = register(service);
  const device = service.authenticate(registration.deviceToken);
  const initial = service.getCompanionState(device);
  assert.equal(initial.nudge.type, "COMPANION_NUDGE");
  assert.deepEqual(initial.settings, { quietMode: false });

  assert.deepEqual(
    service.updateSettings(device, { quietMode: true }),
    { quietMode: true }
  );
  const quiet = service.getCompanionState(device);
  assert.equal(quiet.nudge, null);
  assert.equal(quiet.initiative.blockedBy, "quiet_mode");
  assert.equal(quiet.nextCheckAt, NOW + 6 * 60 * 60_000);
  assert.deepEqual(quiet.settings, { quietMode: true });

  advance(6 * 60 * 60_000);
  assert.equal(
    service.getCompanionState(device).initiative.blockedBy,
    "quiet_mode"
  );

  service.updateSettings(device, { quietMode: false });
  assert.deepEqual(service.getSettings(device), { quietMode: false });
});

test("服务端拒绝不完整或夹带字段的安静模式设置", () => {
  const { service } = createService();
  const registration = register(service);
  const device = service.authenticate(registration.deviceToken);

  assert.throws(
    () => service.updateSettings(device, {}),
    /quietMode/
  );
  assert.throws(
    () => service.updateSettings(device, {
      quietMode: true,
      unknown: true
    }),
    /quietMode/
  );
  assert.throws(
    () => service.updateSettings(device, { quietMode: "true" }),
    /quietMode/
  );
});

test("快捷回复更新角色状态并消费当前消息", () => {
  const { advance, service } = createService();
  const registration = register(service);
  const device = service.authenticate(registration.deviceToken);
  const state = service.getCompanionState(device);
  advance(2_500);

  const result = service.reply(device, {
    actionId: "share",
    nudgeId: state.nudge.nudgeId
  });

  assert.equal(result.accepted, true);
  assert.equal(result.characterState, "chatting");
  assert.equal(result.reply.responseLatencyMs, 2_500);
  assert.throws(
    () => service.reply(device, {
      actionId: "share",
      nudgeId: state.nudge.nudgeId
    }),
    /当前没有/
  );
});

test("文字回复可以创建、列出和删除记忆", () => {
  const { service } = createService();
  const registration = register(service);
  const device = service.authenticate(registration.deviceToken);

  const reply = service.reply(device, {
    memoryType: "event",
    remember: true,
    sensitivity: "private",
    text: "今天完成了 WatchBuddy 的服务端闭环"
  });

  assert.equal(reply.memory.summary, "今天完成了 WatchBuddy 的服务端闭环");
  assert.equal(service.listMemories(device).length, 1);
  assert.equal(service.deleteMemory(device, reply.memory.id), true);
  assert.deepEqual(service.listMemories(device), []);

  service.reply(device, {
    remember: true,
    text: "第一条"
  });
  service.reply(device, {
    remember: true,
    text: "第二条"
  });
  assert.equal(service.clearMemories(device), 2);
});

test("文字回复接入陪伴模型并在异常时安全降级", async () => {
  const responderCalls = [];
  const service = new WatchBuddyService({
    companionResponder: {
      async respond(input) {
        responderCalls.push(input);
        return {
          fallback: false,
          text: "我在这里，继续说给我听吧。"
        };
      }
    },
    now: () => NOW,
    tokenFactory: () => TOKEN
  });
  const registration = register(service);
  const device = service.authenticate(registration.deviceToken);

  const generated = await service.replyWithCompanion(device, {
    text: "今天有点累"
  });

  assert.deepEqual(generated.companionReply, {
    fallback: false,
    text: "我在这里，继续说给我听吧。"
  });
  assert.deepEqual(responderCalls, [{
    deviceId: "gt6pro_test_01",
    locale: "zh-CN",
    text: "今天有点累"
  }]);

  const failingService = new WatchBuddyService({
    companionResponder: {
      async respond() {
        throw new Error("internal-model-error");
      }
    },
    now: () => NOW,
    tokenFactory: () => TOKEN
  });
  const failingRegistration = register(failingService);
  const failingDevice = failingService.authenticate(
    failingRegistration.deviceToken
  );
  const fallback = await failingService.replyWithCompanion(failingDevice, {
    text: "还能听见吗"
  });

  assert.deepEqual(fallback.companionReply, {
    fallback: true,
    text: FALLBACK_COMPANION_TEXT
  });
  assert.equal(JSON.stringify(fallback).includes("internal-model-error"), false);
});

test("拒绝非法注册、超长文字和混合回复", () => {
  const { service } = createService();

  assert.throws(
    () => service.registerDevice({
      deviceId: "short",
      timezoneOffsetMinutes: 480
    }),
    /deviceId/
  );

  const registration = register(service);
  const device = service.authenticate(registration.deviceToken);
  assert.throws(
    () => service.reply(device, {
      text: "超".repeat(65)
    }),
    /64/
  );
  assert.throws(
    () => service.reply(device, {
      actionId: "share",
      nudgeId: "nudge_invalid",
      text: "不能混合"
    }),
    /只能提交/
  );
});

test("重启后恢复令牌摘要、设置、消息状态和记忆", () => {
  const directory = mkdtempSync(join(tmpdir(), "watchbuddy-service-"));
  const statePath = join(directory, "state.json");
  let timestamp = NOW;
  try {
    const stateStore = new JsonStateStore(statePath);
    const firstService = new WatchBuddyService({
      idFactory: () => "persisted_memory_01",
      now: () => timestamp,
      stateStore,
      tokenFactory: () => TOKEN
    });
    const registration = register(firstService);
    const firstDevice = firstService.authenticate(registration.deviceToken);
    const firstState = firstService.getCompanionState(firstDevice);
    const reply = firstService.reply(firstDevice, {
      actionId: "share",
      nudgeId: firstState.nudge.nudgeId
    });
    firstService.reply(firstDevice, {
      memoryType: "unfinished_topic",
      remember: true,
      sensitivity: "private",
      text: "服务重启后还要记得"
    });
    firstService.updateSettings(firstDevice, {
      quietMode: true
    });

    const serialized = readFileSync(statePath, "utf8");
    assert.equal(serialized.includes(TOKEN), false);
    assert.equal(serialized.includes("tokenHash"), true);

    timestamp += 60_000;
    const secondService = new WatchBuddyService({
      now: () => timestamp,
      stateStore
    });
    const restoredDevice = secondService.authenticate(TOKEN);

    assert.equal(restoredDevice.deviceId, registration.deviceId);
    assert.equal(restoredDevice.state.activity, reply.characterState);
    assert.deepEqual(
      secondService.getSettings(restoredDevice),
      { quietMode: true }
    );
    assert.equal(
      secondService.listMemories(restoredDevice)[0].summary,
      "服务重启后还要记得"
    );
    const restoredState = secondService.getCompanionState(restoredDevice);
    assert.equal(restoredState.nudge, null);
    assert.equal(restoredState.initiative.blockedBy, "quiet_mode");
  } finally {
    rmSync(directory, {
      force: true,
      recursive: true
    });
  }
});

test("持久化失败时回滚本次内存状态", () => {
  const records = [];
  let shouldFail = false;
  const stateStore = {
    load() {
      return structuredClone(records);
    },
    save(nextRecords) {
      if (shouldFail) {
        throw new Error("磁盘写入失败");
      }
      records.splice(0, records.length, ...structuredClone(nextRecords));
    }
  };
  const service = new WatchBuddyService({
    now: () => NOW,
    stateStore,
    tokenFactory: () => TOKEN
  });
  const registration = register(service);
  const device = service.authenticate(registration.deviceToken);

  shouldFail = true;
  assert.throws(
    () => service.updateSettings(device, { quietMode: true }),
    /磁盘写入失败/
  );
  const restoredDevice = service.authenticate(registration.deviceToken);
  assert.deepEqual(
    service.getSettings(restoredDevice),
    { quietMode: false }
  );
});
