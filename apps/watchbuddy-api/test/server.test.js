import test from "node:test";
import assert from "node:assert/strict";

import {
  createWatchBuddyServer,
  startWatchBuddyServer
} from "../src/server.js";

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

test("GET /health 返回可供手表探测的服务状态", async (t) => {
  const server = createWatchBuddyServer({
    now: () => new Date("2026-07-17T08:00:00.000Z"),
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
    error: "method_not_allowed"
  });
});

test("未知路径返回结构化 404", async (t) => {
  const server = createWatchBuddyServer();
  t.after(() => close(server));
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/missing`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "not_found"
  });
});

test("启动入口校验端口范围", async () => {
  await assert.rejects(
    startWatchBuddyServer({ port: 70_000 }),
    /PORT 必须/
  );
});
