import { utf8ByteLength } from './watch-api-contract.js';

export const MAX_STORAGE_VALUE_BYTES = 127;

export function ensureStorageValue(value) {
  if (typeof value !== 'string'
    || utf8ByteLength(value) > MAX_STORAGE_VALUE_BYTES) {
    throw new TypeError('本地存储值超过 127 字节限制');
  }
  return value;
}

export function serializeIdentity(identity) {
  if (!identity
    || typeof identity.deviceId !== 'string'
    || typeof identity.deviceToken !== 'string'
    || typeof identity.registrationKey !== 'string') {
    throw new TypeError('设备身份无效');
  }
  return ensureStorageValue(JSON.stringify({
    d: identity.deviceId,
    r: identity.registrationKey,
    t: identity.deviceToken
  }));
}

export function deserializeIdentity(value) {
  const parsed = parseJson(value, '设备身份存储无效');
  if (typeof parsed.d !== 'string'
    || typeof parsed.r !== 'string'
    || typeof parsed.t !== 'string') {
    throw new TypeError('设备身份存储无效');
  }
  return {
    deviceId: parsed.d,
    deviceToken: parsed.t,
    registrationKey: parsed.r
  };
}

export function serializeNudge(nudge) {
  if (!nudge
    || typeof nudge.nudgeId !== 'string'
    || typeof nudge.characterState !== 'string'
    || typeof nudge.message !== 'string'
    || !Number.isSafeInteger(nudge.createdAt)
    || !Number.isSafeInteger(nudge.expiresAt)
    || !Array.isArray(nudge.actions)
    || nudge.actions.length < 2
    || nudge.actions.length > 4) {
    throw new TypeError('缓存消息无效');
  }
  return {
    actions: nudge.actions.map((action) => ensureStorageValue(
      JSON.stringify({
        i: action.id,
        l: action.label
      })
    )),
    message: ensureStorageValue(nudge.message),
    meta: ensureStorageValue(JSON.stringify({
      c: nudge.characterState,
      e: nudge.expiresAt,
      i: nudge.nudgeId,
      s: nudge.createdAt
    }))
  };
}

export function deserializeNudge(metaValue, message, actionValues) {
  const meta = parseJson(metaValue, '缓存消息存储无效');
  if (typeof meta.c !== 'string'
    || !Number.isSafeInteger(meta.e)
    || typeof meta.i !== 'string'
    || !Number.isSafeInteger(meta.s)
    || typeof message !== 'string'
    || !Array.isArray(actionValues)) {
    throw new TypeError('缓存消息存储无效');
  }
  const actions = actionValues
    .filter((value) => typeof value === 'string' && value)
    .map((value) => {
      const action = parseJson(value, '缓存动作存储无效');
      if (typeof action.i !== 'string' || typeof action.l !== 'string') {
        throw new TypeError('缓存动作存储无效');
      }
      return {
        id: action.i,
        label: action.l
      };
    });
  if (actions.length < 2 || actions.length > 4) {
    throw new TypeError('缓存动作存储无效');
  }
  return {
    actions,
    characterState: meta.c,
    createdAt: meta.s,
    expiresAt: meta.e,
    message,
    nudgeId: meta.i
  };
}

function parseJson(value, message) {
  if (typeof value !== 'string' || !value) {
    throw new TypeError(message);
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new TypeError(message);
  }
}
