const MAX_RECENT_NUDGES = 16;
const ACK_STATUSES = ['received', 'displayed', 'responded', 'expired', 'duplicate', 'invalid'];
const INITIATIVE_SOURCES = [
  'daily_routine',
  'random_social',
  'relationship_follow_up',
  'user_state',
  'companion_internal'
];
const CHARACTER_STATES = [
  'sleeping',
  'idle',
  'daydreaming',
  'watching',
  'curious',
  'concerned',
  'chatting',
  'giving_space'
];

export function inspectIncomingMessage(data, recentNudgeIds, now = Date.now()) {
  if (typeof data !== 'string') {
    return { kind: 'reject', reason: 'payload_not_string' };
  }

  let message;
  try {
    message = JSON.parse(data);
  } catch (error) {
    return { kind: 'reject', reason: 'malformed_json' };
  }

  if (isDeliveryAck(message)) {
    return {
      kind: 'delivery_ack',
      messageId: message.messageId,
      status: message.status
    };
  }

  if (!isValidNudge(message)) {
    return { kind: 'reject', reason: 'invalid_nudge' };
  }
  if (message.expiresAt <= now) {
    return {
      kind: 'acknowledge',
      messageId: message.nudgeId,
      status: 'expired'
    };
  }

  const recent = Array.isArray(recentNudgeIds) ? recentNudgeIds : [];
  if (recent.indexOf(message.nudgeId) >= 0) {
    return {
      kind: 'acknowledge',
      messageId: message.nudgeId,
      status: 'duplicate'
    };
  }

  return {
    kind: 'display',
    message,
    recentNudgeIds: [message.nudgeId]
      .concat(recent.filter((id) => id !== message.nudgeId))
      .slice(0, MAX_RECENT_NUDGES)
  };
}

export function createResponseMessage(nudgeId, actionId, createdAt, respondedAt = Date.now()) {
  return {
    schemaVersion: 1,
    type: 'COMPANION_RESPONSE',
    nudgeId,
    actionId,
    respondedAt,
    responseLatencyMs: Math.max(0, respondedAt - createdAt)
  };
}

export function createDeliveryAck(messageId, status, acknowledgedAt = Date.now()) {
  return {
    schemaVersion: 1,
    type: 'DELIVERY_ACK',
    messageId,
    status,
    acknowledgedAt
  };
}

function isDeliveryAck(message) {
  return message
    && message.schemaVersion === 1
    && message.type === 'DELIVERY_ACK'
    && typeof message.messageId === 'string'
    && message.messageId.length >= 8
    && ACK_STATUSES.indexOf(message.status) >= 0
    && Number.isSafeInteger(message.acknowledgedAt)
    && message.acknowledgedAt > 0;
}

function isValidNudge(message) {
  const actions = message && message.actions;
  return message
    && message.schemaVersion === 1
    && message.type === 'COMPANION_NUDGE'
    && typeof message.nudgeId === 'string'
    && message.nudgeId.length >= 8
    && INITIATIVE_SOURCES.indexOf(message.source) >= 0
    && Number.isInteger(message.intensity)
    && message.intensity >= 0
    && message.intensity <= 4
    && CHARACTER_STATES.indexOf(message.characterState) >= 0
    && typeof message.message === 'string'
    && message.message.length > 0
    && Array.from(message.message).length <= 38
    && Number.isSafeInteger(message.createdAt)
    && Number.isSafeInteger(message.expiresAt)
    && message.expiresAt > message.createdAt
    && Array.isArray(actions)
    && actions.length >= 2
    && actions.length <= 4
    && actions.every(isValidAction)
    && new Set(actions.map((action) => action.id)).size === actions.length;
}

function isValidAction(action) {
  return action
    && typeof action === 'object'
    && typeof action.id === 'string'
    && action.id.length > 0
    && typeof action.label === 'string'
    && action.label.length > 0;
}
