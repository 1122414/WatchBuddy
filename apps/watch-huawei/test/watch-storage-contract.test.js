import assert from "node:assert/strict";
import test from "node:test";

import {
  deserializeIdentity,
  deserializeNudge,
  ensureStorageValue,
  MAX_STORAGE_VALUE_BYTES,
  serializeIdentity,
  serializeNudge
} from "../entry/src/main/js/MainAbility/common/watch-storage-contract.js";

const NOW = 1_750_000_000_000;

test("设备身份使用低于 128 字节的紧凑格式", () => {
  const identity = {
    deviceId: "gt6pro-mdy4jt6g-0000000",
    deviceToken: "device_token_123456789012345678901234567890",
    registrationKey: ""
  };
  const serialized = serializeIdentity(identity);

  assert.equal(Buffer.byteLength(serialized) <= MAX_STORAGE_VALUE_BYTES, true);
  assert.deepEqual(deserializeIdentity(serialized), identity);
});

test("消息缓存拆分后每个值都符合轻量存储限制", () => {
  const nudge = {
    actions: [
      { id: "share", label: "跟你说说" },
      { id: "later", label: "晚点" },
      { id: "busy", label: "我在忙" }
    ],
    characterState: "curious",
    createdAt: NOW,
    expiresAt: NOW + 60_000,
    message: "今天到现在，哪一小段最值得留下？",
    nudgeId: "nudge_12345678-1234-1234-1234-123456789012"
  };
  const serialized = serializeNudge(nudge);
  const values = [
    serialized.meta,
    serialized.message,
    ...serialized.actions
  ];

  assert.equal(values.every(
    (value) => Buffer.byteLength(value) <= MAX_STORAGE_VALUE_BYTES
  ), true);
  assert.deepEqual(
    deserializeNudge(
      serialized.meta,
      serialized.message,
      serialized.actions
    ),
    nudge
  );
});

test("拒绝超过 127 字节的单个存储值", () => {
  assert.throws(
    () => ensureStorageValue("中".repeat(43)),
    /127/
  );
});
