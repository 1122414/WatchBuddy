import fetch from '@system.fetch';

import { WATCHBUDDY_API_BASE_URL } from './api-config.js';
import {
  createClearMemoriesRequest,
  createCompanionStateRequest,
  createDeleteMemoryRequest,
  createHealthRequest,
  createMemoriesRequest,
  createPetAssetRequest,
  createPetAssetsRequest,
  createPetCatalogRequest,
  createPetDetailRequest,
  createRegistrationRequest,
  createReplyRequest,
  createSettingsRequest,
  createUpdateSettingsRequest,
  inspectClearMemoriesResponse,
  inspectCompanionStateResponse,
  inspectDeleteMemoryResponse,
  inspectHealthResponse,
  inspectMemoriesResponse,
  inspectPetAssetResponse,
  inspectPetAssetsResponse,
  inspectPetCatalogResponse,
  inspectPetDetailResponse,
  inspectRegistrationResponse,
  inspectReplyResponse,
  inspectSettingsResponse
} from './watch-api-contract.js';

const DEFAULT_TIMEOUT_MS = 8000;

export function checkWatchBuddyHealth(options) {
  return executeRequest(
    () => createHealthRequest(WATCHBUDDY_API_BASE_URL),
    inspectHealthResponse,
    options
  );
}

export function registerWatchBuddy(input, idempotencyKey, options) {
  const callbacks = options || {};
  return executeRequest(
    () => createRegistrationRequest(
      WATCHBUDDY_API_BASE_URL,
      input,
      idempotencyKey,
      callbacks.currentDeviceToken
    ),
    inspectRegistrationResponse,
    callbacks
  );
}

export function fetchCompanionState(deviceToken, options) {
  return executeRequest(
    () => createCompanionStateRequest(
      WATCHBUDDY_API_BASE_URL,
      deviceToken
    ),
    inspectCompanionStateResponse,
    options
  );
}

export function fetchSettings(deviceToken, options) {
  return executeRequest(
    () => createSettingsRequest(
      WATCHBUDDY_API_BASE_URL,
      deviceToken
    ),
    inspectSettingsResponse,
    options
  );
}

export function updateSettings(deviceToken, quietMode, options) {
  return executeRequest(
    () => createUpdateSettingsRequest(
      WATCHBUDDY_API_BASE_URL,
      deviceToken,
      quietMode
    ),
    inspectSettingsResponse,
    options
  );
}

export function fetchPetCatalog(deviceToken, options) {
  return executeRequest(
    () => createPetCatalogRequest(
      WATCHBUDDY_API_BASE_URL,
      deviceToken
    ),
    inspectPetCatalogResponse,
    options
  );
}

export function fetchPetDetail(deviceToken, petId, options) {
  return executeRequest(
    () => createPetDetailRequest(
      WATCHBUDDY_API_BASE_URL,
      deviceToken,
      petId
    ),
    (response) => inspectPetDetailResponse(response, petId),
    options
  );
}

export function fetchPetAssets(
  deviceToken,
  petId,
  version,
  limit,
  offset,
  options
) {
  return executeRequest(
    () => createPetAssetsRequest(
      WATCHBUDDY_API_BASE_URL,
      deviceToken,
      petId,
      version,
      limit,
      offset
    ),
    (response) => inspectPetAssetsResponse(response, petId, version),
    options
  );
}

export function fetchPetAsset(
  deviceToken,
  petId,
  descriptor,
  options
) {
  return executeRequest(
    () => createPetAssetRequest(
      WATCHBUDDY_API_BASE_URL,
      deviceToken,
      petId,
      descriptor && descriptor.id
    ),
    (response) => inspectPetAssetResponse(response, descriptor),
    options
  );
}

export function replyToCompanion(
  deviceToken,
  input,
  idempotencyKey,
  options
) {
  return executeRequest(
    () => createReplyRequest(
      WATCHBUDDY_API_BASE_URL,
      deviceToken,
      input,
      idempotencyKey
    ),
    inspectReplyResponse,
    options
  );
}

export function fetchMemories(deviceToken, limit, offset, options) {
  return executeRequest(
    () => createMemoriesRequest(
      WATCHBUDDY_API_BASE_URL,
      deviceToken,
      limit,
      offset
    ),
    inspectMemoriesResponse,
    options
  );
}

export function deleteMemory(deviceToken, memoryId, options) {
  return executeRequest(
    () => createDeleteMemoryRequest(
      WATCHBUDDY_API_BASE_URL,
      deviceToken,
      memoryId
    ),
    inspectDeleteMemoryResponse,
    options
  );
}

export function clearMemories(deviceToken, options) {
  return executeRequest(
    () => createClearMemoriesRequest(
      WATCHBUDDY_API_BASE_URL,
      deviceToken
    ),
    inspectClearMemoriesResponse,
    options
  );
}

function executeRequest(createRequest, inspectResponse, options) {
  const callbacks = options || {};
  const onSuccess = callbacks.onSuccess || function() {};
  const onFailure = callbacks.onFailure || function() {};
  const timeoutMs = callbacks.timeoutMs || DEFAULT_TIMEOUT_MS;
  let settled = false;
  let timer = null;

  function finish(callback, value) {
    if (settled) {
      return;
    }
    settled = true;
    if (timer !== null) {
      clearTimeout(timer);
    }
    callback(value);
  }

  let request;
  try {
    request = createRequest();
  } catch (error) {
    finish(
      onFailure,
      WATCHBUDDY_API_BASE_URL ? 'invalid_request' : 'service_not_configured'
    );
    return {
      cancel() {}
    };
  }

  timer = setTimeout(() => finish(onFailure, 'timeout'), timeoutMs);

  const fetchOptions = {
    url: request.url,
    method: request.method,
    responseType: request.responseType,
    header: request.header,
    success(response) {
      const result = inspectResponse(response);
      if (result.ok) {
        finish(onSuccess, result);
        return;
      }
      finish(onFailure, result.reason);
    },
    fail(data, code) {
      console.error(`[WatchBuddy] request failed: ${code}`);
      finish(onFailure, 'network_error');
    }
  };
  if (request.data !== undefined) {
    fetchOptions.data = request.data;
  }

  try {
    fetch.fetch(fetchOptions);
  } catch (error) {
    console.error(`[WatchBuddy] request error: ${error}`);
    finish(onFailure, 'network_error');
  }

  return {
    cancel() {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
  };
}
