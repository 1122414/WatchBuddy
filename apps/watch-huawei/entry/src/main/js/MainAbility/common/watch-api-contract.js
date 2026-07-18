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
const PET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
const PET_ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PET_VERSION_PATTERN = /^sha256-[a-f0-9]{16}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
const PET_ANIMATION_NAMES = [
  'idle',
  'runningRight',
  'runningLeft',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review'
];

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

export function createSettingsRequest(baseUrl, deviceToken) {
  return createRequest(
    baseUrl,
    '/v1/settings',
    'GET',
    null,
    deviceToken
  );
}

export function createUpdateSettingsRequest(
  baseUrl,
  deviceToken,
  quietMode
) {
  if (typeof quietMode !== 'boolean') {
    throw new TypeError('quietMode 必须是布尔值');
  }
  return createRequest(
    baseUrl,
    '/v1/settings',
    'PUT',
    { quietMode },
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

export function createPetCatalogRequest(baseUrl, deviceToken) {
  return createRequest(baseUrl, '/v1/pets', 'GET', null, deviceToken);
}

export function createPetDetailRequest(baseUrl, deviceToken, petId) {
  requirePetId(petId);
  return createRequest(
    baseUrl,
    `/v1/pets/${petId}`,
    'GET',
    null,
    deviceToken
  );
}

export function createPetAssetsRequest(
  baseUrl,
  deviceToken,
  petId,
  version,
  limit,
  offset
) {
  requirePetId(petId);
  requirePetVersion(version);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new TypeError('宠物资源分页 limit 无效');
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) {
    throw new TypeError('宠物资源分页 offset 无效');
  }
  return createRequest(
    baseUrl,
    `/v1/pets/${petId}/assets?limit=${limit}&offset=${offset}`,
    'GET',
    null,
    deviceToken
  );
}

export function createPetAssetRequest(
  baseUrl,
  deviceToken,
  petId,
  assetId
) {
  requirePetId(petId);
  if (!PET_ASSET_ID_PATTERN.test(assetId || '')) {
    throw new TypeError('宠物资源 ID 无效');
  }
  return createRequest(
    baseUrl,
    `/v1/pets/${petId}/assets/${assetId}?encoding=base64`,
    'GET',
    null,
    deviceToken
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
    || !Number.isSafeInteger(payload.nextCheckAt)
    || payload.nextCheckAt <= payload.serverTime
    || !isValidSettings(payload.settings)
    || !payload.initiative
    || ['block', 'pending', 'send'].indexOf(payload.initiative.decision) < 0
    || !Array.isArray(payload.initiative.reasons)
    || (payload.initiative.decision === 'block'
      && typeof payload.initiative.blockedBy !== 'string')) {
    return invalid('invalid_response');
  }
  if (payload.nudge === null) {
    if (payload.initiative.decision !== 'block') {
      return invalid('invalid_response');
    }
  } else {
    const inspected = inspectIncomingMessage(
      JSON.stringify(payload.nudge),
      [],
      payload.serverTime
    );
    if (inspected.kind !== 'display') {
      return invalid('invalid_nudge');
    }
  }
  return {
    ok: true,
    data: payload
  };
}

export function inspectSettingsResponse(response) {
  const result = inspectJsonResponse(response, 200);
  if (!result.ok) {
    return result;
  }
  if (!isValidSettings(result.data)) {
    return invalid('invalid_response');
  }
  return {
    ok: true,
    data: result.data
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

export function inspectPetCatalogResponse(response) {
  const result = inspectJsonResponse(response, 200);
  if (!result.ok) {
    return result;
  }
  const payload = result.data;
  if (!payload
    || payload.catalogSchemaVersion !== 1
    || !Array.isArray(payload.pets)
    || payload.pets.length < 1
    || payload.pets.length > 16
    || !payload.pets.every(isValidPetSummary)
    || !hasUniqueStrings(payload.pets.map((pet) => pet.id))) {
    return invalid('invalid_response');
  }
  return {
    ok: true,
    data: payload
  };
}

export function inspectPetDetailResponse(response, expectedPetId) {
  const result = inspectJsonResponse(response, 200);
  if (!result.ok) {
    return result;
  }
  const payload = result.data;
  if (!payload
    || payload.catalogSchemaVersion !== 1
    || !isValidPetDetail(payload.pet)
    || payload.pet.id !== expectedPetId) {
    return invalid('invalid_response');
  }
  return {
    ok: true,
    data: payload.pet
  };
}

export function inspectPetAssetsResponse(
  response,
  expectedPetId,
  expectedVersion
) {
  const result = inspectJsonResponse(response, 200);
  if (!result.ok) {
    return result;
  }
  const payload = result.data;
  if (!payload
    || payload.catalogSchemaVersion !== 1
    || payload.petId !== expectedPetId
    || payload.version !== expectedVersion
    || !Array.isArray(payload.assets)
    || payload.assets.length > 20
    || !payload.assets.every(
      (asset) => isValidPetAssetDescriptor(asset, expectedPetId)
    )
    || !hasUniqueStrings(payload.assets.map((asset) => asset.id))
    || typeof payload.hasMore !== 'boolean'
    || !Number.isInteger(payload.nextOffset)
    || payload.nextOffset < 0
    || !Number.isInteger(payload.total)
    || payload.total < 1
    || payload.total > 88
    || payload.nextOffset > payload.total
    || (payload.hasMore && payload.assets.length === 0)) {
    return invalid('invalid_response');
  }
  return {
    ok: true,
    data: payload
  };
}

export function inspectPetAssetResponse(response, descriptor) {
  const result = inspectJsonResponse(response, 200);
  if (!result.ok) {
    return result;
  }
  const payload = result.data;
  const asset = payload && payload.asset;
  if (!payload
    || payload.catalogSchemaVersion !== 1
    || !descriptor
    || !asset
    || asset.id !== descriptor.id
    || asset.mediaType !== 'image/png'
    || asset.encoding !== 'base64'
    || asset.bytes !== descriptor.bytes
    || asset.sha256 !== descriptor.sha256
    || typeof asset.data !== 'string'
    || asset.data.length < 4) {
    return invalid('invalid_response');
  }
  return {
    ok: true,
    data: asset
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

function requirePetId(petId) {
  if (!PET_ID_PATTERN.test(petId || '')) {
    throw new TypeError('宠物 ID 无效');
  }
}

function requirePetVersion(version) {
  if (!PET_VERSION_PATTERN.test(version || '')) {
    throw new TypeError('宠物版本无效');
  }
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

function isValidPetSummary(pet) {
  if (!pet
    || typeof pet !== 'object'
    || !PET_ID_PATTERN.test(pet.id || '')
    || typeof pet.displayName !== 'string'
    || pet.displayName.length < 1
    || Array.from(pet.displayName).length > 32
    || typeof pet.description !== 'string'
    || pet.description.length < 1
    || Array.from(pet.description).length > 160
    || pet.renderer !== 'frame-sequence-v1'
    || !PET_VERSION_PATTERN.test(pet.version || '')
    || !SHA256_PATTERN.test(pet.manifestSha256 || '')
    || pet.version !== `sha256-${pet.manifestSha256.slice(0, 16)}`
    || !Number.isInteger(pet.assetCount)
    || pet.assetCount < 1
    || pet.assetCount > 88
    || !isValidPetBudget(pet.budget, pet.assetCount)
    || !isValidPetFrame(pet.frame)
    || pet.metadataUrl !== `/v1/pets/${pet.id}`
    || pet.assetsUrl !== `/v1/pets/${pet.id}/assets`
    || !isValidPetAssetDescriptor(pet.preview, pet.id)) {
    return false;
  }
  return pet.preview.assetId === pet.preview.id
    || pet.preview.id === undefined;
}

export function isValidPetDetail(pet) {
  if (!isValidPetSummary(pet)
    || !pet.animations
    || typeof pet.animations !== 'object'
    || !PET_ANIMATION_NAMES.every(
      (name) => isValidPetAnimation(pet.animations[name])
    )
    || Object.keys(pet.animations).length !== PET_ANIMATION_NAMES.length
    || !PET_ASSET_ID_PATTERN.test(pet.fallbackFrame || '')
    || !isValidPetMapping(pet.stateMap, CHARACTER_STATES)
    || !isValidPetMapping(
      pet.interactionMap,
      ['tap', 'message', 'loading', 'failure']
    )
    || !isValidPetSource(pet.source)) {
    return false;
  }
  const animationNames = Object.keys(pet.animations);
  if (!Object.keys(pet.stateMap).every(
    (key) => animationNames.indexOf(pet.stateMap[key]) >= 0
  ) || !Object.keys(pet.interactionMap).every(
    (key) => animationNames.indexOf(pet.interactionMap[key]) >= 0
  )) {
    return false;
  }
  if (pet.lookDirections !== undefined
    && (!pet.lookDirections
      || typeof pet.lookDirections !== 'object'
      || Object.keys(pet.lookDirections).length > 16
      || !Object.keys(pet.lookDirections).every(
        (key) => PET_ASSET_ID_PATTERN.test(pet.lookDirections[key] || '')
      ))) {
    return false;
  }
  return true;
}

function isValidPetBudget(budget, assetCount) {
  return budget
    && Number.isInteger(budget.frameCount)
    && budget.frameCount === assetCount
    && Number.isInteger(budget.totalBytes)
    && budget.totalBytes > 0
    && budget.totalBytes <= 2 * 1024 * 1024
    && Number.isInteger(budget.maxFrameBytes)
    && budget.maxFrameBytes > 0
    && budget.maxFrameBytes <= MAX_FETCH_PACKET_BYTES;
}

function isValidPetFrame(frame) {
  return frame
    && Number.isInteger(frame.width)
    && frame.width >= 32
    && frame.width <= 192
    && Number.isInteger(frame.height)
    && frame.height >= 32
    && frame.height <= 208
    && Number.isInteger(frame.displayWidth)
    && frame.displayWidth >= 64
    && frame.displayWidth <= 200
    && Number.isInteger(frame.displayHeight)
    && frame.displayHeight >= 64
    && frame.displayHeight <= 200;
}

function isValidPetAnimation(animation) {
  return animation
    && Array.isArray(animation.frames)
    && animation.frames.length >= 1
    && animation.frames.length <= 8
    && animation.frames.every(
      (assetId) => PET_ASSET_ID_PATTERN.test(assetId || '')
    )
    && Array.isArray(animation.durationsMs)
    && animation.durationsMs.length === animation.frames.length
    && animation.durationsMs.every(
      (duration) => Number.isInteger(duration)
        && duration >= 60
        && duration <= 1000
    )
    && typeof animation.loop === 'boolean';
}

function isValidPetMapping(mapping, requiredKeys) {
  return mapping
    && typeof mapping === 'object'
    && Object.keys(mapping).length === requiredKeys.length
    && requiredKeys.every(
      (key) => typeof mapping[key] === 'string'
    );
}

function isValidPetSource(source) {
  return source
    && source.format === 'codex-pet-v2'
    && source.spriteVersionNumber === 2
    && typeof source.author === 'string'
    && source.author.length >= 1
    && source.author.length <= 80
    && isHttpsUrl(source.sourceUrl)
    && SHA256_PATTERN.test(source.sha256 || '')
    && source.license
    && typeof source.license.name === 'string'
    && source.license.name.length >= 1
    && isHttpsUrl(source.license.url)
    && source.license.redistributionAllowed === true
    && typeof source.attribution === 'string'
    && source.attribution.length >= 1
    && source.attribution.length <= 240;
}

function isValidPetAssetDescriptor(asset, petId) {
  if (!asset || !PET_ASSET_ID_PATTERN.test(
    asset.id || asset.assetId || ''
  )) {
    return false;
  }
  const assetId = asset.id || asset.assetId;
  return asset.mediaType === 'image/png'
    && Number.isInteger(asset.bytes)
    && asset.bytes > 0
    && asset.bytes <= MAX_FETCH_PACKET_BYTES
    && SHA256_PATTERN.test(asset.sha256 || '')
    && asset.url === `/v1/pets/${petId}/assets/${assetId}`
    && asset.base64Url
      === `/v1/pets/${petId}/assets/${assetId}?encoding=base64`;
}

function isHttpsUrl(value) {
  return typeof value === 'string'
    && value.length <= 512
    && /^https:\/\/[^/?#]+(?:[/?#]|$)/.test(value)
    && value.indexOf('@') < 0;
}

function hasUniqueStrings(values) {
  const seen = Object.create(null);
  for (let index = 0; index < values.length; index += 1) {
    if (seen[values[index]]) {
      return false;
    }
    seen[values[index]] = true;
  }
  return true;
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

function isValidSettings(settings) {
  return settings
    && typeof settings === 'object'
    && !Array.isArray(settings)
    && Object.keys(settings).length === 1
    && typeof settings.quietMode === 'boolean';
}

function invalid(reason) {
  return {
    ok: false,
    reason
  };
}
