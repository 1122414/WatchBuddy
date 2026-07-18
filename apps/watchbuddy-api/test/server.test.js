import test from "node:test";
import assert from "node:assert/strict";

import {
  createWatchBuddyServer,
  startWatchBuddyServer
} from "../src/server.js";
import { WatchBuddyService } from "../src/service.js";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  if (!server.listening) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function registerDevice(baseUrl, {
  deviceId = "gt6pro_server_01",
  idempotencyKey = "register-test-01"
} = {}) {
  const response = await fetch(`${baseUrl}/v1/device/register`, {
    body: JSON.stringify({
      deviceId,
      locale: "zh-CN",
      timezoneOffsetMinutes: 480
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey
    },
    method: "POST"
  });

  return {
    body: await response.json(),
    response
  };
}

test("GET /health 返回可供手表探测的服务状态", async (t) => {
  const server = createWatchBuddyServer({
    now: () => Date.parse("2026-07-17T08:00:00.000Z"),
    serviceVersion: "test-version"
  });
  t.after(() => close(server));
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "watchbuddy-api",
    version: "test-version",
    time: "2026-07-17T08:00:00.000Z"
  });
});

test("health 端点拒绝非 GET 方法", async (t) => {
  const server = createWatchBuddyServer();
  t.after(() => close(server));
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/health`, {
    method: "POST"
  });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.deepEqual(await response.json(), {
    error: "method_not_allowed",
    message: "请求方法不允许"
  });
});

test("未知路径返回结构化 404", async (t) => {
  const server = createWatchBuddyServer();
  t.after(() => close(server));
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/missing`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "not_found",
    message: "接口不存在"
  });
});

test("仅用 HTTP 完成注册、状态、回复、记忆和撤销闭环", async (t) => {
  let timestamp = Date.parse("2026-07-18T03:00:00.000Z");
  const server = createWatchBuddyServer({
    now: () => timestamp
  });
  t.after(() => close(server));
  const baseUrl = await listen(server);

  const registration = await registerDevice(baseUrl);
  assert.equal(registration.response.status, 201);
  assert.equal(registration.body.deviceId, "gt6pro_server_01");
  assert.equal(typeof registration.body.deviceToken, "string");
  const authorization = `Bearer ${registration.body.deviceToken}`;

  const stateResponse = await fetch(`${baseUrl}/v1/companion/state`, {
    headers: { authorization }
  });
  const state = await stateResponse.json();
  assert.equal(stateResponse.status, 200);
  assert.equal(state.characterState, "idle");
  assert.equal(state.nudge.type, "COMPANION_NUDGE");

  timestamp += 2_000;
  const quickReplyResponse = await fetch(`${baseUrl}/v1/companion/reply`, {
    body: JSON.stringify({
      actionId: "share",
      nudgeId: state.nudge.nudgeId
    }),
    headers: {
      authorization,
      "content-type": "application/json",
      "idempotency-key": "reply-quick-01"
    },
    method: "POST"
  });
  const quickReply = await quickReplyResponse.json();
  assert.equal(quickReplyResponse.status, 200);
  assert.equal(quickReply.characterState, "chatting");
  assert.equal(quickReply.reply.responseLatencyMs, 2_000);

  const memoryReplyResponse = await fetch(`${baseUrl}/v1/companion/reply`, {
    body: JSON.stringify({
      memoryType: "event",
      remember: true,
      sensitivity: "private",
      text: "今天完成了手表直连服务"
    }),
    headers: {
      authorization,
      "content-type": "application/json",
      "idempotency-key": "reply-memory-01"
    },
    method: "POST"
  });
  const memoryReply = await memoryReplyResponse.json();
  assert.equal(memoryReplyResponse.status, 200);
  assert.equal(memoryReply.memory.summary, "今天完成了手表直连服务");

  const memoriesResponse = await fetch(`${baseUrl}/v1/memories`, {
    headers: { authorization }
  });
  const memories = await memoriesResponse.json();
  assert.equal(memoriesResponse.status, 200);
  assert.equal(memories.memories.length, 1);
  assert.equal(memories.hasMore, false);
  assert.equal(memories.nextOffset, 1);

  const deleteResponse = await fetch(
    `${baseUrl}/v1/memories/${encodeURIComponent(memoryReply.memory.id)}`,
    {
      headers: { authorization },
      method: "DELETE"
    }
  );
  assert.equal(deleteResponse.status, 200);
  assert.equal((await deleteResponse.json()).deleted, true);

  const clearResponse = await fetch(`${baseUrl}/v1/memories`, {
    headers: { authorization },
    method: "DELETE"
  });
  assert.equal(clearResponse.status, 200);
  assert.equal((await clearResponse.json()).deleted, 0);

  const revokeResponse = await fetch(`${baseUrl}/v1/device`, {
    headers: { authorization },
    method: "DELETE"
  });
  assert.equal(revokeResponse.status, 200);

  const unauthorizedResponse = await fetch(`${baseUrl}/v1/companion/state`, {
    headers: { authorization }
  });
  assert.equal(unauthorizedResponse.status, 401);
});

test("幂等键会重放相同回复并拒绝不同请求复用", async (t) => {
  const server = createWatchBuddyServer();
  t.after(() => close(server));
  const baseUrl = await listen(server);
  const registration = await registerDevice(baseUrl, {
    idempotencyKey: "register-idempotency"
  });
  const authorization = `Bearer ${registration.body.deviceToken}`;

  const input = {
    remember: true,
    text: "同一条回复"
  };
  const request = (body) => fetch(`${baseUrl}/v1/companion/reply`, {
    body: JSON.stringify(body),
    headers: {
      authorization,
      "content-type": "application/json",
      "idempotency-key": "reply-idempotency"
    },
    method: "POST"
  });

  const first = await request(input);
  const second = await request(input);
  assert.equal(first.status, 200);
  assert.deepEqual(await second.json(), await first.json());

  const conflict = await request({
    remember: true,
    text: "另一条回复"
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, "idempotency_conflict");
});

test("已注册设备只有持有当前令牌才能轮换令牌", async (t) => {
  const server = createWatchBuddyServer();
  t.after(() => close(server));
  const baseUrl = await listen(server);
  const first = await registerDevice(baseUrl, {
    idempotencyKey: "register-rotation-01"
  });

  const takeover = await registerDevice(baseUrl, {
    idempotencyKey: "register-rotation-02"
  });
  assert.equal(takeover.response.status, 400);
  assert.equal(takeover.body.error, "invalid_request");

  const rotatedResponse = await fetch(`${baseUrl}/v1/device/register`, {
    body: JSON.stringify({
      deviceId: "gt6pro_server_01",
      locale: "zh-CN",
      timezoneOffsetMinutes: 480
    }),
    headers: {
      authorization: `Bearer ${first.body.deviceToken}`,
      "content-type": "application/json",
      "idempotency-key": "register-rotation-03"
    },
    method: "POST"
  });
  const rotated = await rotatedResponse.json();
  assert.equal(rotatedResponse.status, 201);
  assert.notEqual(rotated.deviceToken, first.body.deviceToken);

  const oldTokenResponse = await fetch(`${baseUrl}/v1/companion/state`, {
    headers: {
      authorization: `Bearer ${first.body.deviceToken}`
    }
  });
  assert.equal(oldTokenResponse.status, 401);
});

test("鉴权、请求大小和速率限制返回结构化错误", async (t) => {
  const server = createWatchBuddyServer({
    rateLimitPerMinute: 2
  });
  t.after(() => close(server));
  const baseUrl = await listen(server);

  const unauthorized = await fetch(`${baseUrl}/v1/memories`);
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");

  const oversized = await fetch(`${baseUrl}/v1/device/register`, {
    body: JSON.stringify({
      deviceId: "gt6pro_oversized",
      padding: "x".repeat(8 * 1024),
      timezoneOffsetMinutes: 480
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": "register-oversized"
    },
    method: "POST"
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error, "payload_too_large");

  const registration = await registerDevice(baseUrl, {
    deviceId: "gt6pro_rate_01",
    idempotencyKey: "register-rate-01"
  });
  const authorization = `Bearer ${registration.body.deviceToken}`;

  assert.equal((await fetch(`${baseUrl}/v1/memories`, {
    headers: { authorization }
  })).status, 200);
  assert.equal((await fetch(`${baseUrl}/v1/memories`, {
    headers: { authorization }
  })).status, 200);
  const limited = await fetch(`${baseUrl}/v1/memories`, {
    headers: { authorization }
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
});

test("记忆列表分页并保持响应低于表端 7KB 限制", async (t) => {
  let id = 0;
  const service = new WatchBuddyService({
    idFactory: () => `page_${String(id += 1).padStart(8, "0")}`
  });
  const registration = service.registerDevice({
    deviceId: "gt6pro_page_01",
    locale: "zh-CN",
    timezoneOffsetMinutes: 480
  });
  const device = service.authenticate(registration.deviceToken);
  for (let index = 0; index < 25; index += 1) {
    service.reply(device, {
      remember: true,
      text: `第 ${String(index + 1).padStart(2, "0")} 条${"记".repeat(52)}`
    });
  }

  const server = createWatchBuddyServer({
    rateLimitPerMinute: 100,
    service
  });
  t.after(() => close(server));
  const baseUrl = await listen(server);
  const authorization = `Bearer ${registration.deviceToken}`;

  const firstResponse = await fetch(
    `${baseUrl}/v1/memories?limit=20&offset=0`,
    { headers: { authorization } }
  );
  const firstPayload = await firstResponse.text();
  const firstPage = JSON.parse(firstPayload);
  assert.equal(firstResponse.status, 200);
  assert.equal(Buffer.byteLength(firstPayload) < 7 * 1024, true);
  assert.equal(firstPage.memories.length, 20);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.nextOffset, 20);

  const secondResponse = await fetch(
    `${baseUrl}/v1/memories?limit=20&offset=${firstPage.nextOffset}`,
    { headers: { authorization } }
  );
  const secondPage = await secondResponse.json();
  assert.equal(secondPage.memories.length, 5);
  assert.equal(secondPage.hasMore, false);
});

test("拒绝非法分页参数和畸形记忆 ID", async (t) => {
  const server = createWatchBuddyServer();
  t.after(() => close(server));
  const baseUrl = await listen(server);
  const registration = await registerDevice(baseUrl, {
    idempotencyKey: "register-invalid-query"
  });
  const authorization = `Bearer ${registration.body.deviceToken}`;

  const invalidLimit = await fetch(`${baseUrl}/v1/memories?limit=21`, {
    headers: { authorization }
  });
  assert.equal(invalidLimit.status, 400);
  assert.equal((await invalidLimit.json()).error, "invalid_query");

  const invalidId = await fetch(`${baseUrl}/v1/memories/%E0%A4%A`, {
    headers: { authorization },
    method: "DELETE"
  });
  assert.equal(invalidId.status, 400);
  assert.equal((await invalidId.json()).error, "invalid_memory_id");
});

test("结构化日志不记录设备令牌和请求正文", async (t) => {
  const events = [];
  const logger = {
    error(event) {
      events.push(event);
    },
    info(event) {
      events.push(event);
    }
  };
  const server = createWatchBuddyServer({ logger });
  t.after(() => close(server));
  const baseUrl = await listen(server);

  const registration = await registerDevice(baseUrl, {
    idempotencyKey: "register-logging-01"
  });
  const serializedEvents = JSON.stringify(events);

  assert.equal(registration.response.status, 201);
  assert.equal(events.length, 1);
  assert.equal(serializedEvents.includes(registration.body.deviceToken), false);
  assert.equal(serializedEvents.includes("timezoneOffsetMinutes"), false);
});

test("启动入口校验端口范围", async () => {
  await assert.rejects(
    startWatchBuddyServer({ port: 70_000 }),
    /PORT 必须/
  );
});
