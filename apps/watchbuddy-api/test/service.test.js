import assert from "node:assert/strict";
import test from "node:test";

import { WatchBuddyService } from "../src/service.js";

const NOW = Date.parse("2026-07-18T03:00:00.000Z");
const TOKEN = "test_device_token_123456789012345678901234567890";

function createService() {
  let id = 0;
  let timestamp = NOW;
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
  assert.equal(state.nudge.actions.length, 3);
  assert.equal(state.nextCheckAt, NOW + 5 * 60_000);
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
