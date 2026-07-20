const DEVICE_ID_PATTERN: RegExp = /^[A-Za-z0-9_-]{8,64}$/;
const TOKEN_PATTERN: RegExp = /^[A-Za-z0-9_-]{32,64}$/;

interface HealthPayload {
  ok: boolean;
  service: string;
  version: string;
  time: string;
}

interface RegistrationPayload {
  deviceId: string;
  deviceToken: string;
  registeredAt: number;
}

interface CompanionStatePayload {
  characterState: string;
  serverTime: number;
  nextCheckAt: number;
}

export class HealthResult {
  version: string;
  time: string;

  constructor(version: string, time: string) {
    this.version = version;
    this.time = time;
  }
}

export class DeviceRegistration {
  deviceId: string;
  deviceToken: string;
  registeredAt: number;

  constructor(deviceId: string, deviceToken: string, registeredAt: number) {
    this.deviceId = deviceId;
    this.deviceToken = deviceToken;
    this.registeredAt = registeredAt;
  }
}

export class CompanionSnapshot {
  characterState: string;
  serverTime: number;
  nextCheckAt: number;

  constructor(characterState: string, serverTime: number, nextCheckAt: number) {
    this.characterState = characterState;
    this.serverTime = serverTime;
    this.nextCheckAt = nextCheckAt;
  }
}

export function parseHealthPayload(value: string): HealthResult {
  const payload: HealthPayload = JSON.parse(value) as HealthPayload;
  if (!payload
    || payload.ok !== true
    || payload.service !== 'watchbuddy-api'
    || typeof payload.version !== 'string'
    || payload.version.length < 1
    || payload.version.length > 32
    || typeof payload.time !== 'string'
    || payload.time.length < 1
    || payload.time.length > 64) {
    throw new Error('invalid_response');
  }
  return new HealthResult(payload.version, payload.time);
}

export function parseRegistrationPayload(value: string): DeviceRegistration {
  const payload: RegistrationPayload =
    JSON.parse(value) as RegistrationPayload;
  if (!payload
    || !DEVICE_ID_PATTERN.test(payload.deviceId)
    || !TOKEN_PATTERN.test(payload.deviceToken)
    || !Number.isSafeInteger(payload.registeredAt)) {
    throw new Error('invalid_response');
  }
  return new DeviceRegistration(
    payload.deviceId,
    payload.deviceToken,
    payload.registeredAt
  );
}

export function parseCompanionStatePayload(value: string): CompanionSnapshot {
  const payload: CompanionStatePayload =
    JSON.parse(value) as CompanionStatePayload;
  if (!payload
    || !isCharacterState(payload.characterState)
    || !Number.isSafeInteger(payload.serverTime)
    || !Number.isSafeInteger(payload.nextCheckAt)
    || payload.nextCheckAt <= payload.serverTime) {
    throw new Error('invalid_response');
  }
  return new CompanionSnapshot(
    payload.characterState,
    payload.serverTime,
    payload.nextCheckAt
  );
}

export function isCharacterState(value: string): boolean {
  switch (value) {
    case 'sleeping':
    case 'idle':
    case 'daydreaming':
    case 'watching':
    case 'curious':
    case 'concerned':
    case 'chatting':
    case 'giving_space':
      return true;
    default:
      return false;
  }
}

export function isValidDeviceId(value: string): boolean {
  return DEVICE_ID_PATTERN.test(value);
}

export function isValidDeviceToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}
