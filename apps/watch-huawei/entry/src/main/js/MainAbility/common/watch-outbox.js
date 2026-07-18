export const MAX_REPLY_ATTEMPTS = 3;

export function createPendingReply(payload, idempotencyKey, now = Date.now()) {
  if (!payload
    || typeof payload.actionId !== 'string'
    || payload.actionId.length < 1
    || payload.actionId.length > 24
    || typeof payload.nudgeId !== 'string'
    || payload.nudgeId.length < 8
    || payload.nudgeId.length > 64) {
    throw new TypeError('快捷回复无效');
  }
  if (typeof idempotencyKey !== 'string'
    || idempotencyKey.length < 8
    || idempotencyKey.length > 48) {
    throw new TypeError('幂等键无效');
  }
  return {
    attempts: 0,
    idempotencyKey,
    nextAttemptAt: now,
    payload
  };
}

export function recordReplyFailure(pendingReply, now = Date.now()) {
  const pending = normalizePendingReply(pendingReply);
  const attempts = pending.attempts + 1;
  return {
    attempts,
    idempotencyKey: pending.idempotencyKey,
    nextAttemptAt: now + Math.min(30000, Math.pow(2, attempts) * 1000),
    payload: pending.payload
  };
}

export function canRetryReply(pendingReply, now = Date.now()) {
  const pending = normalizePendingReply(pendingReply);
  return pending.attempts < MAX_REPLY_ATTEMPTS
    && pending.nextAttemptAt <= now;
}

export function normalizePendingReply(value) {
  if (!value
    || !Number.isInteger(value.attempts)
    || value.attempts < 0
    || value.attempts > MAX_REPLY_ATTEMPTS
    || !Number.isSafeInteger(value.nextAttemptAt)
    || typeof value.idempotencyKey !== 'string'
    || value.idempotencyKey.length < 8
    || value.idempotencyKey.length > 48
    || !value.payload
    || typeof value.payload.actionId !== 'string'
    || value.payload.actionId.length < 1
    || value.payload.actionId.length > 24
    || typeof value.payload.nudgeId !== 'string'
    || value.payload.nudgeId.length < 8
    || value.payload.nudgeId.length > 64) {
    throw new TypeError('待发送回复无效');
  }
  return {
    attempts: value.attempts,
    idempotencyKey: value.idempotencyKey,
    nextAttemptAt: value.nextAttemptAt,
    payload: {
      actionId: value.payload.actionId,
      nudgeId: value.payload.nudgeId
    }
  };
}

export function serializePendingReply(value) {
  const pending = normalizePendingReply(value);
  return {
    meta: JSON.stringify({
      k: pending.idempotencyKey,
      t: pending.nextAttemptAt,
      x: pending.attempts
    }),
    payload: JSON.stringify({
      a: pending.payload.actionId,
      n: pending.payload.nudgeId
    })
  };
}

export function deserializePendingReply(metaValue, payloadValue) {
  if (typeof metaValue !== 'string' || typeof payloadValue !== 'string') {
    throw new TypeError('待发送回复存储无效');
  }
  let meta;
  let payload;
  try {
    meta = JSON.parse(metaValue);
    payload = JSON.parse(payloadValue);
  } catch (error) {
    throw new TypeError('待发送回复存储无效');
  }
  return normalizePendingReply({
    attempts: meta.x,
    idempotencyKey: meta.k,
    nextAttemptAt: meta.t,
    payload: {
      actionId: payload.a,
      nudgeId: payload.n
    }
  });
}
