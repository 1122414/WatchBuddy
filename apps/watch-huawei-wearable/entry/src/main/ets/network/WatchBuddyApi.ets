import { http } from '@kit.NetworkKit';

import {
  CompanionSnapshot,
  DeviceRegistration,
  HealthResult,
  isValidDeviceId,
  isValidDeviceToken,
  isValidPetAssetId,
  isValidPetId,
  isValidPetVersion,
  MemoryPage,
  parseClearMemoriesPayload,
  parseCompanionStatePayload,
  parseDeleteMemoryPayload,
  parseHealthPayload,
  parseMemoryPagePayload,
  parsePetAssetPagePayload,
  parsePetAssetPayload,
  parsePetCatalogPayload,
  parsePetDetailPayload,
  parseRegistrationPayload,
  parseReplyPayload,
  parseSettingsPayload,
  PetAssetDescriptor,
  PetAssetDownload,
  PetAssetPage,
  PetCatalog,
  PetDetail,
  ReplyResult,
  SettingsResult
} from './ApiModels';

const MAX_RESPONSE_BYTES: number = 7 * 1024;
const REQUEST_TIMEOUT_MS: number = 8000;

interface RequestHeaders {
  Accept: string;
  Authorization?: string;
  'Content-Type'?: string;
  'Idempotency-Key'?: string;
}

interface RegistrationBody {
  deviceId: string;
  locale: string;
  timezoneOffsetMinutes: number;
}

interface SettingsBody {
  quietMode: boolean;
}

interface QuickReplyBody {
  nudgeId: string;
  actionId: string;
}

interface TextReplyBody {
  text: string;
}

class JsonResponse {
  statusCode: number;
  body: string;

  constructor(statusCode: number, body: string) {
    this.statusCode = statusCode;
    this.body = body;
  }
}

export class WatchBuddyApi {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  isConfigured(): boolean {
    return this.baseUrl.length > 0;
  }

  async health(): Promise<HealthResult> {
    const response: JsonResponse = await this.requestJson(
      '/health',
      http.RequestMethod.GET,
      '',
      '',
      ''
    );
    requireStatus(response, 200);
    return parseHealthPayload(response.body);
  }

  async register(
    deviceId: string,
    timezoneOffsetMinutes: number,
    idempotencyKey: string,
    currentDeviceToken: string
  ): Promise<DeviceRegistration> {
    if (!isValidDeviceId(deviceId)
      || !Number.isInteger(timezoneOffsetMinutes)
      || timezoneOffsetMinutes < -840
      || timezoneOffsetMinutes > 840
      || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)
      || (currentDeviceToken.length > 0
        && !isValidDeviceToken(currentDeviceToken))) {
      throw new Error('invalid_request');
    }
    const body: RegistrationBody = {
      deviceId,
      locale: 'zh-CN',
      timezoneOffsetMinutes
    };
    const response: JsonResponse = await this.requestJson(
      '/v1/device/register',
      http.RequestMethod.POST,
      JSON.stringify(body),
      currentDeviceToken,
      idempotencyKey
    );
    requireStatus(response, 201);
    const registration: DeviceRegistration =
      parseRegistrationPayload(response.body);
    if (registration.deviceId !== deviceId) {
      throw new Error('invalid_response');
    }
    return registration;
  }

  async companionState(deviceToken: string): Promise<CompanionSnapshot> {
    if (!isValidDeviceToken(deviceToken)) {
      throw new Error('invalid_request');
    }
    const response: JsonResponse = await this.requestJson(
      '/v1/companion/state',
      http.RequestMethod.GET,
      '',
      deviceToken,
      ''
    );
    requireStatus(response, 200);
    return parseCompanionStatePayload(response.body);
  }

  async updateSettings(
    deviceToken: string,
    quietMode: boolean
  ): Promise<SettingsResult> {
    requireDeviceToken(deviceToken);
    const body: SettingsBody = { quietMode };
    const response: JsonResponse = await this.requestJson(
      '/v1/settings',
      http.RequestMethod.PUT,
      JSON.stringify(body),
      deviceToken,
      ''
    );
    requireStatus(response, 200);
    return parseSettingsPayload(response.body);
  }

  async quickReply(
    deviceToken: string,
    nudgeId: string,
    actionId: string,
    idempotencyKey: string
  ): Promise<ReplyResult> {
    requireDeviceToken(deviceToken);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(nudgeId)
      || !/^[A-Za-z0-9_-]{1,24}$/.test(actionId)
      || !isValidIdempotencyKey(idempotencyKey)) {
      throw new Error('invalid_request');
    }
    const body: QuickReplyBody = { nudgeId, actionId };
    const response: JsonResponse = await this.requestJson(
      '/v1/companion/reply',
      http.RequestMethod.POST,
      JSON.stringify(body),
      deviceToken,
      idempotencyKey
    );
    requireStatus(response, 200);
    return parseReplyPayload(response.body);
  }

  async textReply(
    deviceToken: string,
    text: string,
    idempotencyKey: string
  ): Promise<ReplyResult> {
    requireDeviceToken(deviceToken);
    const normalized: string = text.trim();
    if (normalized.length < 1
      || normalized.length > 128
      || !isValidIdempotencyKey(idempotencyKey)) {
      throw new Error('invalid_request');
    }
    const body: TextReplyBody = { text: normalized };
    const response: JsonResponse = await this.requestJson(
      '/v1/companion/reply',
      http.RequestMethod.POST,
      JSON.stringify(body),
      deviceToken,
      idempotencyKey
    );
    requireStatus(response, 200);
    return parseReplyPayload(response.body);
  }

  async memories(
    deviceToken: string,
    limit: number,
    offset: number
  ): Promise<MemoryPage> {
    requireDeviceToken(deviceToken);
    if (!Number.isInteger(limit)
      || limit < 1
      || limit > 20
      || !Number.isInteger(offset)
      || offset < 0
      || offset > 100000) {
      throw new Error('invalid_request');
    }
    const response: JsonResponse = await this.requestJson(
      `/v1/memories?limit=${limit}&offset=${offset}`,
      http.RequestMethod.GET,
      '',
      deviceToken,
      ''
    );
    requireStatus(response, 200);
    return parseMemoryPagePayload(response.body, offset);
  }

  async deleteMemory(
    deviceToken: string,
    memoryId: string
  ): Promise<boolean> {
    requireDeviceToken(deviceToken);
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(memoryId)) {
      throw new Error('invalid_request');
    }
    const response: JsonResponse = await this.requestJson(
      `/v1/memories/${memoryId}`,
      http.RequestMethod.DELETE,
      '',
      deviceToken,
      ''
    );
    requireStatus(response, 200);
    return parseDeleteMemoryPayload(response.body, memoryId);
  }

  async clearMemories(deviceToken: string): Promise<number> {
    requireDeviceToken(deviceToken);
    const response: JsonResponse = await this.requestJson(
      '/v1/memories',
      http.RequestMethod.DELETE,
      '',
      deviceToken,
      ''
    );
    requireStatus(response, 200);
    return parseClearMemoriesPayload(response.body);
  }

  async petCatalog(deviceToken: string): Promise<PetCatalog> {
    requireDeviceToken(deviceToken);
    const response: JsonResponse = await this.requestJson(
      '/v1/pets',
      http.RequestMethod.GET,
      '',
      deviceToken,
      ''
    );
    requireStatus(response, 200);
    return parsePetCatalogPayload(response.body);
  }

  async petDetail(
    deviceToken: string,
    petId: string
  ): Promise<PetDetail> {
    requireDeviceToken(deviceToken);
    if (!isValidPetId(petId)) {
      throw new Error('invalid_request');
    }
    const response: JsonResponse = await this.requestJson(
      `/v1/pets/${petId}`,
      http.RequestMethod.GET,
      '',
      deviceToken,
      ''
    );
    requireStatus(response, 200);
    return parsePetDetailPayload(response.body, petId);
  }

  async petAssets(
    deviceToken: string,
    petId: string,
    version: string,
    limit: number,
    offset: number
  ): Promise<PetAssetPage> {
    requireDeviceToken(deviceToken);
    if (!isValidPetId(petId)
      || !isValidPetVersion(version)
      || !Number.isInteger(limit)
      || limit < 1
      || limit > 20
      || !Number.isInteger(offset)
      || offset < 0
      || offset > 100000) {
      throw new Error('invalid_request');
    }
    const response: JsonResponse = await this.requestJson(
      `/v1/pets/${petId}/assets?limit=${limit}&offset=${offset}`,
      http.RequestMethod.GET,
      '',
      deviceToken,
      ''
    );
    requireStatus(response, 200);
    return parsePetAssetPagePayload(
      response.body,
      petId,
      version,
      offset
    );
  }

  async petAsset(
    deviceToken: string,
    petId: string,
    descriptor: PetAssetDescriptor
  ): Promise<PetAssetDownload> {
    requireDeviceToken(deviceToken);
    if (!isValidPetId(petId)
      || !descriptor
      || !isValidPetAssetId(descriptor.id)) {
      throw new Error('invalid_request');
    }
    const response: JsonResponse = await this.requestJson(
      `/v1/pets/${petId}/assets/${descriptor.id}?encoding=base64`,
      http.RequestMethod.GET,
      '',
      deviceToken,
      ''
    );
    requireStatus(response, 200);
    return parsePetAssetPayload(response.body, descriptor);
  }

  private async requestJson(
    path: string,
    method: http.RequestMethod,
    body: string,
    deviceToken: string,
    idempotencyKey: string
  ): Promise<JsonResponse> {
    if (!this.isConfigured()) {
      throw new Error('service_not_configured');
    }
    const headers: RequestHeaders = createHeaders(
      deviceToken,
      body.length > 0,
      idempotencyKey
    );

    const request: http.HttpRequest = http.createHttp();
    try {
      const options: http.HttpRequestOptions = {
        connectTimeout: REQUEST_TIMEOUT_MS,
        expectDataType: http.HttpDataType.STRING,
        header: headers,
        maxLimit: MAX_RESPONSE_BYTES,
        method,
        readTimeout: REQUEST_TIMEOUT_MS,
        usingCache: false
      };
      if (body.length > 0) {
        options.extraData = body;
      }
      const response: http.HttpResponse =
        await request.request(`${this.baseUrl}${path}`, options);
      if (typeof response.result !== 'string'
        || response.result.length > MAX_RESPONSE_BYTES) {
        throw new Error('response_too_large');
      }
      return new JsonResponse(Number(response.responseCode), response.result);
    } catch (error) {
      if (error instanceof Error
        && error.message === 'response_too_large') {
        throw error;
      }
      throw new Error('network_error');
    } finally {
      request.destroy();
    }
  }
}

function normalizeBaseUrl(value: string): string {
  const baseUrl: string = value.trim();
  if (baseUrl.length === 0) {
    return '';
  }
  if (!baseUrl.startsWith('https://')
    || baseUrl.includes('?')
    || baseUrl.includes('#')) {
    throw new Error('invalid_service_url');
  }
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function requireStatus(response: JsonResponse, expected: number): void {
  if (response.statusCode !== expected) {
    throw new Error(`http_${response.statusCode}`);
  }
}

function requireDeviceToken(deviceToken: string): void {
  if (!isValidDeviceToken(deviceToken)) {
    throw new Error('invalid_request');
  }
}

function isValidIdempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

function createHeaders(
  deviceToken: string,
  hasBody: boolean,
  idempotencyKey: string
): RequestHeaders {
  if (hasBody && idempotencyKey.length > 0 && deviceToken.length > 0) {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${deviceToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    };
  }
  if (hasBody && idempotencyKey.length > 0) {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    };
  }
  if (hasBody && deviceToken.length > 0) {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${deviceToken}`,
      'Content-Type': 'application/json'
    };
  }
  if (hasBody) {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };
  }
  if (deviceToken.length > 0) {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${deviceToken}`
    };
  }
  return {
    Accept: 'application/json'
  };
}
