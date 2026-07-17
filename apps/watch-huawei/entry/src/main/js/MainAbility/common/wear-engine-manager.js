import { Builder, Message, P2pClient } from './sdk/litewearable/wearengine.js';
import { PHONE_CERT_FINGERPRINT, PHONE_PACKAGE_NAME } from './peer-config.js';

const PLACEHOLDER_FINGERPRINT = 'REPLACE_WITH_ANDROID_SHA256';
const RESPONSE_RETRY_DELAYS_MS = [5000, 20000];

let p2pClient = null;
let registeredReceiver = null;
const pendingResponses = {};

export function isPeerConfigured() {
  return PHONE_CERT_FINGERPRINT !== PLACEHOLDER_FINGERPRINT
    && PHONE_CERT_FINGERPRINT.length === 64;
}

export function initializeWearEngine(receiver) {
  if (!isPeerConfigured()) {
    receiver.onFailure('peer_not_configured');
    return;
  }

  p2pClient = new P2pClient();
  p2pClient.setPeerPkgName(PHONE_PACKAGE_NAME);
  p2pClient.setPeerFingerPrint(PHONE_CERT_FINGERPRINT);
  registeredReceiver = receiver;
  p2pClient.registerReceiver(receiver);
}

export function sendJson(payload, callback) {
  if (!p2pClient) {
    callback.onFailure();
    return;
  }

  const builder = new Builder();
  builder.setDescription(JSON.stringify(payload));
  const message = new Message();
  message.builder = builder;
  p2pClient.send(message, callback);
}

export function sendReliableResponse(payload, callback) {
  const messageId = payload && payload.nudgeId;
  if (!messageId) {
    callback.onFailure();
    return;
  }

  clearPendingResponse(messageId);
  pendingResponses[messageId] = {
    payload,
    callback,
    attempt: 0,
    timer: null
  };
  sendResponseAttempt(messageId);
}

export function acknowledgeResponse(messageId) {
  return clearPendingResponse(messageId);
}

export function unregisterWearEngine() {
  Object.keys(pendingResponses).forEach(clearPendingResponse);
  if (!p2pClient || !registeredReceiver) {
    return;
  }

  p2pClient.unregisterReceiver({
    onSuccess() {
      console.info('[WatchBuddy] Wear Engine receiver unregistered');
    }
  });
  registeredReceiver = null;
  p2pClient = null;
}

function sendResponseAttempt(messageId) {
  const pending = pendingResponses[messageId];
  if (!pending) {
    return;
  }

  pending.attempt += 1;
  sendJson(pending.payload, pending.callback);

  const nextDelay = RESPONSE_RETRY_DELAYS_MS[pending.attempt - 1];
  if (nextDelay == null) {
    return;
  }
  pending.timer = setTimeout(() => sendResponseAttempt(messageId), nextDelay);
}

function clearPendingResponse(messageId) {
  const pending = pendingResponses[messageId];
  if (!pending) {
    return false;
  }
  if (pending.timer) {
    clearTimeout(pending.timer);
  }
  delete pendingResponses[messageId];
  return true;
}
