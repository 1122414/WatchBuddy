import test from "node:test";
import assert from "node:assert/strict";

import {
  createHealthRequest,
  inspectHealthResponse,
  MAX_FETCH_HEADER_BYTES,
  MAX_FETCH_PACKET_BYTES,
  normalizeApiBaseUrl
} from "../entry/src/main/js/MainAbility/common/watch-api-contract.js";

test("健康检查只允许 HTTPS 基础地址", () => {
  assert.throws(
    () => normalizeApiBaseUrl("http://api.example.com"),
    /HTTPS/
  );
  assert.throws(
    () => normalizeApiBaseUrl(""),
    /未配置/
  );
  assert.equal(
    normalizeApiBaseUrl("https://api.example.com/"),
    "https://api.example.com"
  );
});

test("创建轻量级穿戴可用的最小健康检查请求", () => {
  assert.deepEqual(createHealthRequest("https://api.example.com"), {
    url: "https://api.example.com/health",
    method: "GET",
    responseType: "json",
    header: {
      Accept: "application/json"
    }
  });
  assert.equal(MAX_FETCH_HEADER_BYTES, 2048);
  assert.equal(MAX_FETCH_PACKET_BYTES, 7168);
});

test("接受 WatchBuddy API 的合法健康响应", () => {
  assert.deepEqual(inspectHealthResponse({
    code: 200,
    data: JSON.stringify({
      ok: true,
      service: "watchbuddy-api",
      version: "0.1.0",
      time: "2026-07-17T08:00:00.000Z"
    })
  }), {
    ok: true,
    version: "0.1.0",
    time: "2026-07-17T08:00:00.000Z"
  });
});

test("拒绝错误状态码、伪造服务和过大响应", () => {
  assert.deepEqual(inspectHealthResponse({
    code: 503,
    data: {}
  }), {
    ok: false,
    reason: "http_503"
  });
  assert.deepEqual(inspectHealthResponse({
    code: 200,
    data: {
      ok: true,
      service: "other-api",
      version: "0.1.0",
      time: "2026-07-17T08:00:00.000Z"
    }
  }), {
    ok: false,
    reason: "invalid_response"
  });
  assert.deepEqual(inspectHealthResponse({
    code: 200,
    data: "x".repeat(4097)
  }), {
    ok: false,
    reason: "response_too_large"
  });
});
