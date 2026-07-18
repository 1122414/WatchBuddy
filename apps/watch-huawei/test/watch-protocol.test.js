import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDeliveryAck,
  createResponseMessage,
  inspectIncomingMessage
} from '../entry/src/main/js/MainAbility/common/watch-protocol.js';

const NOW = 1_750_000_000_000;

function nudge(overrides = {}) {
  return {
    schemaVersion: 1,
    type: 'COMPANION_NUDGE',
    nudgeId: 'nudge_12345678',
    source: 'relationship_follow_up',
    intensity: 2,
    characterState: 'curious',
    message: '昨天那个汇报后来怎么样了？',
    actions: [
      { id: 'good', label: '挺顺利的' },
      { id: 'later', label: '晚点告诉你' }
    ],
    createdAt: NOW - 1_000,
    expiresAt: NOW + 60_000,
    ...overrides
  };
}

test('有效消息进入展示并登记幂等标识', () => {
  const result = inspectIncomingMessage(JSON.stringify(nudge()), [], NOW);

  assert.equal(result.kind, 'display');
  assert.equal(result.message.nudgeId, 'nudge_12345678');
  assert.deepEqual(result.recentNudgeIds, ['nudge_12345678']);
});

test('重复和过期消息只返回 ACK，不重复展示', () => {
  const duplicate = inspectIncomingMessage(
    JSON.stringify(nudge()),
    ['nudge_12345678'],
    NOW
  );
  const expired = inspectIncomingMessage(
    JSON.stringify(nudge({ nudgeId: 'nudge_expired1', expiresAt: NOW })),
    [],
    NOW
  );

  assert.deepEqual(duplicate, {
    kind: 'acknowledge',
    messageId: 'nudge_12345678',
    status: 'duplicate'
  });
  assert.deepEqual(expired, {
    kind: 'acknowledge',
    messageId: 'nudge_expired1',
    status: 'expired'
  });
});

test('无效 JSON 和缺少动作字段的消息被拒绝', () => {
  assert.equal(inspectIncomingMessage('{', [], NOW).reason, 'malformed_json');
  assert.equal(
    inspectIncomingMessage(JSON.stringify(nudge({ actions: [{ id: 'one' }] })), [], NOW).reason,
    'invalid_nudge'
  );
});

test('超长消息和重复动作不会进入表端 UI', () => {
  const tooLong = nudge({ message: '这是一条明显超过手表消息长度限制的文字，需要在服务端被拒绝并且不能进入表端界面' });
  const duplicateActions = nudge({
    actions: [
      { id: 'same', label: '第一项' },
      { id: 'same', label: '第二项' }
    ]
  });

  assert.equal(inspectIncomingMessage(JSON.stringify(tooLong), [], NOW).reason, 'invalid_nudge');
  assert.equal(
    inspectIncomingMessage(JSON.stringify(duplicateActions), [], NOW).reason,
    'invalid_nudge'
  );
});

test('超长消息 ID、动作 ID 和动作标签不会进入表端 UI', () => {
  const longNudgeId = nudge({ nudgeId: `nudge_${'x'.repeat(65)}` });
  const longActionId = nudge({
    actions: [
      { id: 'x'.repeat(25), label: '第一项' },
      { id: 'later', label: '第二项' }
    ]
  });
  const longActionLabel = nudge({
    actions: [
      { id: 'one', label: '很'.repeat(13) },
      { id: 'later', label: '第二项' }
    ]
  });

  assert.equal(
    inspectIncomingMessage(JSON.stringify(longNudgeId), [], NOW).reason,
    'invalid_nudge'
  );
  assert.equal(
    inspectIncomingMessage(JSON.stringify(longActionId), [], NOW).reason,
    'invalid_nudge'
  );
  assert.equal(
    inspectIncomingMessage(JSON.stringify(longActionLabel), [], NOW).reason,
    'invalid_nudge'
  );
});

test('服务端 ACK 会终止对应回复的重试', () => {
  const ack = createDeliveryAck('nudge_12345678', 'responded', NOW);
  const result = inspectIncomingMessage(JSON.stringify(ack), [], NOW);

  assert.deepEqual(result, {
    kind: 'delivery_ack',
    messageId: 'nudge_12345678',
    status: 'responded'
  });
});

test('快捷回复包含可测延迟', () => {
  const response = createResponseMessage('nudge_12345678', 'good', NOW - 2_500, NOW);

  assert.equal(response.type, 'COMPANION_RESPONSE');
  assert.equal(response.responseLatencyMs, 2_500);
});
