import { http } from '@kit.NetworkKit';

import {
  CompanionSnapshot,
  DeviceRegistration,
  HealthResult,
  isValidDeviceId,
  isValidDeviceToken,
  parseCompanionStatePayload,
  parseHealthPayload,
  parseRegistrationPayload
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
      if (error instanceof Error) {
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
