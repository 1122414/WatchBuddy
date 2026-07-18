import { inspectIncomingMessage } from './watch-protocol.js';

export const MAX_FETCH_HEADER_BYTES = 2 * 1024;
export const MAX_FETCH_PACKET_BYTES = 7 * 1024;

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
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

export function utf8ByteLength(value) {
  const text = String(value);
  let bytes = 0;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff
      && index + 1 < text.length
      && text.charCodeAt(index + 1) >= 0xdc00
      && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

export function normalizeApiBaseUrl(value) {
  const baseUrl = typeof value === 'string' ? value.trim() : '';

  if (!baseUrl) {
    throw new TypeError('WatchBuddy API 地址未配置');
  }
  if (!baseUrl.startsWith('https://')) {
    throw new TypeError('WatchBuddy API 必须使用 HTTPS');
  }
  if (baseUrl.includes('?') || baseUrl.includes('#')) {
    throw new TypeError('WatchBuddy API 基础地址不能包含查询参数或片段');
  }

  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

export function createHealthRequest(baseUrl) {
  return createRequest(baseUrl, '/health', 'GET');
}

export function createRegistrationRequest(
  baseUrl,
  input,
  idempotencyKey,
  currentDeviceToken
) {
  if (!input || !DEVICE_ID_PATTERN.test(input.deviceId || '')) {
    throw new TypeError('deviceId 无效');
  }
  if (!Number.isInteger(input.timezoneOffsetMinutes)
    || input.timezoneOffsetMinutes < -840
    || input.timezoneOffsetMinutes > 840) {
    throw new TypeError('timezoneOffsetMinutes 无效');
  }
  return createRequest(
    baseUrl,
    '/v1/device/register',
    'POST',
    input,
    currentDeviceToken,
    idempotencyKey
  );
}

export function createCompanionStateRequest(baseUrl, deviceToken) {
  return createRequest(
    baseUrl,
    '/v1/companion/state',
    'GET',
    null,
    deviceToken
  );
}

export function createReplyRequest(
  baseUrl,
  deviceToken,
  input,
  idempotencyKey
) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('回复内容无效');
  }
  return createRequest(
    baseUrl,
    '/v1/companion/reply',
    'POST',
    input,
    deviceToken,
    idempotencyKey
  );
}

export function createMemoriesRequest(
  baseUrl,
  deviceToken,
  limit,
  offset
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new TypeError('记忆分页 limit 无效');
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) {
    throw new TypeError('记忆分页 offset 无效');
  }
  return createRequest(
    baseUrl,
    `/v1/memories?limit=${limit}&offset=${offset}`,
    'GET',
    null,
    deviceToken
  );
}

export function createDeleteMemoryRequest(baseUrl, deviceToken, memoryId) {
  if (typeof memoryId !== 'string' || memoryId.length < 8) {
    throw new TypeError('memoryId 无效');
  }
  return createRequest(
    baseUrl,
    `/v1/memories/${encodeURIComponent(memoryId)}`,
    'DELETE',
    null,
    deviceToken
  );
}

export function createClearMemoriesRequest(baseUrl, deviceToken) {
  return createRequest(
    baseUrl,
    '/v1/memories',
    'DELETE',
    null,
    deviceToken
  );
}

export function inspectHealthResponse(response) {
  const result = inspectJsonResponse(response, 200);
  if (!result.ok) {
    return result;
  }
  const payload = result.data;
  if (!payload || payload.ok !== true || payload.service !== 'watchbuddy-api') {
    return invalid('invalid_response');
  }
  if (typeof payload.version !== 'string' || payload.version.length > 32) {
    return invalid('invalid_version');
  }
  if (typeof payload.time !== 'string' || payload.time.length > 64) {
    return invalid('invalid_time');
  }

  return {
    ok: true,
    version: payload.version,
    time: payload.time
  };
}

export function inspectRegistrationResponse(response) {
  const result = inspectJsonResponse(response, 201);
  if (!result.ok) {
    return result;
  }
  const payload = result.data;
  if (!payload
    || !DEVICE_ID_PATTERN.test(payload.deviceId || '')
    || !TOKEN_PATTERN.test(payload.deviceToken || '')
    || !Number.isSafeInteger(payload.registeredAt)) {
    return invalid('invalid_response');
  }
  return {
    ok: true,
    data: payload
  };
}

export function inspectCompanionStateResponse(response) {
  const result = inspectJsonResponse(response, 200);
  if (!result.ok) {
    return result;
  }
  const payload = result.data;
  if (!payload
    || CHARACTER_STATES.indexOf(payload.characterState) < 0
    || !Number.isSafeInteger(payload.serverTime)
    || !Number.isSafeInteger(payload.nextCheckAt)) {
    return invalid('invalid_response');
  }
  const inspected = inspectIncomingMessage(
    JSON.stringify(payload.nudge),
    [],
    payload.serverTime
  );
  if (inspected.kind !== 'display') {
    return invalid('invalid_nudge');
  }
  return {
    ok: true,
    data: payload
  };
}

export function inspectReplyResponse(response) {
  const result = inspectJsonResponse(response, 200);
  if (!result.ok) {
    return result;
  }
  const payload = result.data;
  if (!payload
    || payload.accepted !== true
    || CHARACTER_STATES.indexOf(payload.characterState) < 0
    || !Number.isSafeInteger(payload.nextCheckAt)
    || !payload.reply
    || typeof payload.reply !== 'object') {
    return invalid('invalid_response');
  }
  return {
    ok: true,
    data: payload
  };
}

export function inspectMemoriesResponse(response) {
  const result = inspectJsonResponse(response, 200);
  if (!result.ok) {
    return result;
  }
  const payload = result.data;
  if (!payload
    || !Array.isArray(payload.memories)
    || payload.memories.length > 20
    || typeof payload.hasMore !== 'boolean'
    || !Number.isInteger(payload.nextOffset)
    || payload.nextOffset < 0
    || !payload.memories.every(isValidMemory)) {
    return invalid('invalid_response');
  }
  return {
    ok: true,
    data: payload
  };
}

export function inspectDeleteMemoryResponse(response) {
  const result = inspectJsonResponse(response, 200);
  if (!result.ok) {
    return result;
  }
  if (!result.data
    || result.data.deleted !== true
    || typeof result.data.memoryId !== 'string') {
    return invalid('invalid_response');
  }
  return {
    ok: true,
    data: result.data
  };
}

export function inspectClearMemoriesResponse(response) {
  const result = inspectJsonResponse(response, 200);
  if (!result.ok) {
    return result;
  }
  if (!result.data
    || !Number.isInteger(result.data.deleted)
    || result.data.deleted < 0) {
    return invalid('invalid_response');
  }
  return {
    ok: true,
    data: result.data
  };
}

function createRequest(
  baseUrl,
  path,
  method,
  body,
  deviceToken,
  idempotencyKey
) {
  const header = {
    Accept: 'application/json'
  };

  if (deviceToken) {
    if (!TOKEN_PATTERN.test(deviceToken)) {
      throw new TypeError('设备令牌无效');
    }
    header.Authorization = `Bearer ${deviceToken}`;
  }
  if (idempotencyKey) {
    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new TypeError('Idempotency-Key 无效');
    }
    header['Idempotency-Key'] = idempotencyKey;
  }

  const request = {
    url: `${normalizeApiBaseUrl(baseUrl)}${path}`,
    method,
    responseType: 'json',
    header
  };

  if (body !== undefined && body !== null) {
    const data = JSON.stringify(body);
    if (utf8ByteLength(data) > MAX_FETCH_PACKET_BYTES) {
      throw new TypeError('请求体超过 Lite Wearable 单包限制');
    }
    header['Content-Type'] = 'application/json';
    request.data = data;
  }

  if (utf8ByteLength(JSON.stringify(header)) > MAX_FETCH_HEADER_BYTES) {
    throw new TypeError('请求头超过 Lite Wearable 限制');
  }
  return request;
}

function inspectJsonResponse(response, expectedCode) {
  if (!response || response.code !== expectedCode) {
    return invalid(
      `http_${response && response.code !== undefined ? response.code : 'unknown'}`
    );
  }

  let payload = response.data;
  const serialized = typeof payload === 'string'
    ? payload
    : JSON.stringify(payload);
  if (typeof serialized !== 'string'
    || utf8ByteLength(serialized) > MAX_FETCH_PACKET_BYTES) {
    return invalid('response_too_large');
  }
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (error) {
      return invalid('invalid_json');
    }
  }
  if (!payload || typeof payload !== 'object') {
    return invalid('invalid_response');
  }

  return {
    ok: true,
    data: payload
  };
}

function isValidMemory(memory) {
  return memory
    && typeof memory.id === 'string'
    && memory.id.length >= 8
    && ['event', 'preference', 'unfinished_topic', 'ritual']
      .indexOf(memory.type) >= 0
    && typeof memory.summary === 'string'
    && memory.summary.length > 0
    && Array.from(memory.summary).length <= 64
    && ['normal', 'private', 'sensitive'].indexOf(memory.sensitivity) >= 0
    && Number.isSafeInteger(memory.updatedAt);
}

function invalid(reason) {
  return {
    ok: false,
    reason
  };
}
