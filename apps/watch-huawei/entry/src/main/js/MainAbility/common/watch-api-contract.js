export const MAX_FETCH_HEADER_BYTES = 2 * 1024;
export const MAX_FETCH_PACKET_BYTES = 7 * 1024;

const MAX_HEALTH_PAYLOAD_CHARACTERS = 4 * 1024;

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
  return {
    url: `${normalizeApiBaseUrl(baseUrl)}/health`,
    method: 'GET',
    responseType: 'json',
    header: {
      Accept: 'application/json'
    }
  };
}

export function inspectHealthResponse(response) {
  if (!response || response.code !== 200) {
    return {
      ok: false,
      reason: `http_${response && response.code !== undefined ? response.code : 'unknown'}`
    };
  }

  let payload = response.data;
  if (typeof payload === 'string') {
    if (payload.length > MAX_HEALTH_PAYLOAD_CHARACTERS) {
      return {
        ok: false,
        reason: 'response_too_large'
      };
    }
    try {
      payload = JSON.parse(payload);
    } catch (error) {
      return {
        ok: false,
        reason: 'invalid_json'
      };
    }
  }

  if (!payload || payload.ok !== true || payload.service !== 'watchbuddy-api') {
    return {
      ok: false,
      reason: 'invalid_response'
    };
  }
  if (typeof payload.version !== 'string' || payload.version.length > 32) {
    return {
      ok: false,
      reason: 'invalid_version'
    };
  }
  if (typeof payload.time !== 'string' || payload.time.length > 64) {
    return {
      ok: false,
      reason: 'invalid_time'
    };
  }

  return {
    ok: true,
    version: payload.version,
    time: payload.time
  };
}
