import fetch from '@system.fetch';

import { WATCHBUDDY_API_BASE_URL } from './api-config.js';
import {
  createHealthRequest,
  inspectHealthResponse
} from './watch-api-contract.js';

const DEFAULT_TIMEOUT_MS = 8000;

export function checkWatchBuddyHealth(options) {
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
    request = createHealthRequest(WATCHBUDDY_API_BASE_URL);
  } catch (error) {
    finish(onFailure, 'service_not_configured');
    return {
      cancel() {}
    };
  }

  timer = setTimeout(() => finish(onFailure, 'timeout'), timeoutMs);

  try {
    fetch.fetch({
      url: request.url,
      method: request.method,
      responseType: request.responseType,
      header: request.header,
      success(response) {
        const result = inspectHealthResponse(response);
        if (result.ok) {
          finish(onSuccess, result);
          return;
        }
        finish(onFailure, result.reason);
      },
      fail(data, code) {
        console.error(`[WatchBuddy] health request failed: ${code}`);
        finish(onFailure, 'network_error');
      }
    });
  } catch (error) {
    console.error(`[WatchBuddy] health request error: ${error}`);
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
