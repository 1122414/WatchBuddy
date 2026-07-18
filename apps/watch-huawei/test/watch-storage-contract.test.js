import assert from "node:assert/strict";
import test from "node:test";

import {
  deserializePetSelection,
  deserializeIdentity,
  deserializeNudge,
  ensureStorageValue,
  MAX_STORAGE_VALUE_BYTES,
  serializeIdentity,
  serializeNudge,
  serializePetSelection
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

test("宠物选择只持久化低于 128 字节的原子版本指针", () => {
  const selection = {
    petId: "watchbuddy-sprout",
    version: "sha256-cb50b78fdd5b15b4"
  };
  const serialized = serializePetSelection(selection);

  assert.equal(Buffer.byteLength(serialized) <= MAX_STORAGE_VALUE_BYTES, true);
  assert.deepEqual(deserializePetSelection(serialized), selection);
  assert.throws(
    () => deserializePetSelection('{"i":"../pet","v":"latest"}'),
    /指针/
  );
});
