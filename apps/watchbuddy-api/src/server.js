import {
  createHash,
  randomUUID
} from "node:crypto";
import http from "node:http";
import { pathToFileURL } from "node:url";

import { defaultPetCatalog } from "./pet-catalog.js";
import { JsonStateStore } from "./json-state-store.js";
import { WatchBuddyService } from "./service.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 120;
const MAX_REQUEST_BYTES = 7 * 1024;
const MAX_RESPONSE_BYTES = 7 * 1024;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const PET_ID_PATTERN = "[a-z0-9][a-z0-9-]{0,47}";
const ASSET_ID_PATTERN = "[a-z0-9][a-z0-9-]{0,63}";
const PET_DETAIL_PATH_PATTERN = new RegExp(
  `^/v1/pets/(${PET_ID_PATTERN})$`
);
const PET_ASSETS_PATH_PATTERN = new RegExp(
  `^/v1/pets/(${PET_ID_PATTERN})/assets$`
);
const PET_ASSET_PATH_PATTERN = new RegExp(
  `^/v1/pets/(${PET_ID_PATTERN})/assets/(${ASSET_ID_PATTERN})$`
);

class HttpError extends Error {
  constructor(statusCode, code, message, headers = {}) {
    super(message);
    this.code = code;
    this.headers = headers;
    this.statusCode = statusCode;
  }
}

class IdempotencyStore {
  #entries = new Map();
  #maxEntries;

  constructor(maxEntries = 256) {
    this.#maxEntries = maxEntries;
  }

  run(scope, key, input, operation) {
    const cacheKey = `${scope}:${key}`;
    const inputHash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const cached = this.#entries.get(cacheKey);

    if (cached) {
      if (cached.inputHash !== inputHash) {
        throw new HttpError(
          409,
          "idempotency_conflict",
          "同一个 Idempotency-Key 不能用于不同请求"
        );
      }
      return cached.result;
    }

    const result = operation();
    this.#entries.set(cacheKey, {
      inputHash,
      result
    });
    if (this.#entries.size > this.#maxEntries) {
      this.#entries.delete(this.#entries.keys().next().value);
    }
    return result;
  }
}

class FixedWindowRateLimiter {
  #entries = new Map();
  #limit;
  #now;
  #windowMs;

  constructor({
    limit,
    now,
    windowMs
  }) {
    this.#limit = limit;
    this.#now = now;
    this.#windowMs = windowMs;
  }

  consume(key) {
    const timestamp = this.#now();
    let entry = this.#entries.get(key);
    if (!entry || timestamp - entry.startedAt >= this.#windowMs) {
      entry = {
        count: 0,
        startedAt: timestamp
      };
      this.#entries.set(key, entry);
    }

    entry.count += 1;
    return {
      allowed: entry.count <= this.#limit,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((entry.startedAt + this.#windowMs - timestamp) / 1000)
      )
    };
  }
}

function sendJson(response, statusCode, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  if (Buffer.byteLength(payload) > MAX_RESPONSE_BYTES) {
    throw new HttpError(
      500,
      "response_too_large",
      `响应体不能超过 ${MAX_RESPONSE_BYTES} 字节`
    );
  }

  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  response.end(payload);
}

function sendAsset(request, response, asset, extraHeaders = {}) {
  if (asset.length > MAX_RESPONSE_BYTES) {
    throw new HttpError(
      500,
      "response_too_large",
      `宠物资源不能超过 ${MAX_RESPONSE_BYTES} 字节`
    );
  }
  const etag = `"${asset.sha256}"`;
  const headers = {
    "cache-control": "private, max-age=31536000, immutable",
    "content-type": asset.contentType,
    etag,
    "x-content-sha256": asset.sha256,
    ...extraHeaders
  };

  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, headers);
    response.end();
    return 304;
  }

  response.writeHead(200, {
    ...headers,
    "content-length": asset.length
  });
  response.end(asset.bytes);
  return 200;
}

async function readJson(request) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(
      415,
      "unsupported_media_type",
      "请求必须使用 application/json"
    );
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new HttpError(
        413,
        "payload_too_large",
        `请求体不能超过 ${MAX_REQUEST_BYTES} 字节`
      );
    }
    chunks.push(chunk);
  }

  if (totalBytes === 0) {
    throw new HttpError(400, "invalid_json", "请求体不能为空");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new HttpError(400, "invalid_json", "请求体不是合法 JSON");
  }
}

function requireIdempotencyKey(request) {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new HttpError(
      400,
      "invalid_idempotency_key",
      "Idempotency-Key 必须为 8 到 128 位安全字符"
    );
  }
  return key;
}

function bearerToken(request) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string") {
    return "";
  }
  const match = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(authorization);
  return match ? match[1] : "";
}

function integerQueryParameter(
  url,
  name,
  {
    defaultValue,
    maximum,
    minimum
  }
) {
  const rawValue = url.searchParams.get(name);
  if (rawValue === null) {
    return defaultValue;
  }
  if (!/^(0|[1-9]\d*)$/.test(rawValue)) {
    throw new HttpError(400, "invalid_query", `${name} 必须是整数`);
  }
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new HttpError(
      400,
      "invalid_query",
      `${name} 必须在 ${minimum} 到 ${maximum} 之间`
    );
  }
  return value;
}

function memoryIdFromPath(pathname) {
  try {
    const memoryId = decodeURIComponent(
      pathname.slice("/v1/memories/".length)
    );
    if (!memoryId || memoryId.includes("/")) {
      throw new HttpError(400, "invalid_memory_id", "memoryId 无效");
    }
    return memoryId;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, "invalid_memory_id", "memoryId 无效");
  }
}

function methodForPath(pathname) {
  if (pathname === "/health") {
    return "GET";
  }
  if (pathname === "/v1/device/register") {
    return "POST";
  }
  if (pathname === "/v1/device") {
    return "DELETE";
  }
  if (pathname === "/v1/companion/state") {
    return "GET";
  }
  if (pathname === "/v1/companion/reply") {
    return "POST";
  }
  if (pathname === "/v1/settings") {
    return "GET, PUT";
  }
  if (pathname === "/v1/pets"
    || PET_DETAIL_PATH_PATTERN.test(pathname)
    || PET_ASSETS_PATH_PATTERN.test(pathname)
    || PET_ASSET_PATH_PATTERN.test(pathname)) {
    return "GET";
  }
  if (pathname === "/v1/memories") {
    return "GET, DELETE";
  }
  if (pathname.startsWith("/v1/memories/")) {
    return "DELETE";
  }
  return "";
}

function createJsonLogger(output = console) {
  return {
    error(event) {
      output.error(JSON.stringify(event));
    },
    info(event) {
      output.info(JSON.stringify(event));
    }
  };
}

export function createWatchBuddyServer({
  idempotencyStore = new IdempotencyStore(),
  logger = null,
  now = () => Date.now(),
  petCatalog = defaultPetCatalog,
  rateLimitPerMinute = DEFAULT_RATE_LIMIT_PER_MINUTE,
  service = new WatchBuddyService({ now }),
  serviceVersion = "0.1.0"
} = {}) {
  const rateLimiter = new FixedWindowRateLimiter({
    limit: rateLimitPerMinute,
    now,
    windowMs: 60_000
  });

  async function handleRequest(request, response) {
    const startedAt = now();
    const requestId = randomUUID();
    const url = new URL(request.url ?? "/", "http://watchbuddy.local");
    const responseHeaders = {
      "x-request-id": requestId
    };
    let statusCode = 500;

    try {
      const allowedMethods = methodForPath(url.pathname);
      if (!allowedMethods) {
        throw new HttpError(404, "not_found", "接口不存在");
      }
      if (!allowedMethods.split(", ").includes(request.method)) {
        throw new HttpError(
          405,
          "method_not_allowed",
          "请求方法不允许",
          { allow: allowedMethods }
        );
      }

      if (url.pathname === "/health") {
        statusCode = 200;
        sendJson(response, statusCode, {
          ok: true,
          service: "watchbuddy-api",
          time: new Date(now()).toISOString(),
          version: serviceVersion
        }, responseHeaders);
        return;
      }

      if (url.pathname === "/v1/device/register") {
        const rate = rateLimiter.consume(
          `register:${request.socket.remoteAddress ?? "unknown"}`
        );
        if (!rate.allowed) {
          throw new HttpError(
            429,
            "rate_limited",
            "请求过于频繁",
            { "retry-after": `${rate.retryAfterSeconds}` }
          );
        }

        const input = await readJson(request);
        const idempotencyKey = requireIdempotencyKey(request);
        const result = idempotencyStore.run(
          "register",
          idempotencyKey,
          input,
          () => service.registerDevice(input, bearerToken(request))
        );
        statusCode = 201;
        sendJson(response, statusCode, result, responseHeaders);
        return;
      }

      const device = service.authenticate(bearerToken(request));
      if (!device) {
        throw new HttpError(
          401,
          "unauthorized",
          "设备令牌无效或已撤销",
          { "www-authenticate": "Bearer" }
        );
      }

      const rate = rateLimiter.consume(`device:${device.deviceId}`);
      if (!rate.allowed) {
        throw new HttpError(
          429,
          "rate_limited",
          "请求过于频繁",
          { "retry-after": `${rate.retryAfterSeconds}` }
        );
      }

      if (url.pathname === "/v1/device") {
        service.revokeDevice(device);
        statusCode = 200;
        sendJson(response, statusCode, {
          revoked: true
        }, responseHeaders);
        return;
      }

      if (url.pathname === "/v1/companion/state") {
        statusCode = 200;
        sendJson(
          response,
          statusCode,
          service.getCompanionState(device),
          responseHeaders
        );
        return;
      }

      if (url.pathname === "/v1/companion/reply") {
        const input = await readJson(request);
        const idempotencyKey = requireIdempotencyKey(request);
        const result = idempotencyStore.run(
          `reply:${device.deviceId}`,
          idempotencyKey,
          input,
          () => service.reply(device, input)
        );
        statusCode = 200;
        sendJson(response, statusCode, result, responseHeaders);
        return;
      }

      if (url.pathname === "/v1/settings") {
        statusCode = 200;
        sendJson(
          response,
          statusCode,
          request.method === "GET"
            ? service.getSettings(device)
            : service.updateSettings(device, await readJson(request)),
          responseHeaders
        );
        return;
      }

      if (url.pathname === "/v1/pets") {
        statusCode = 200;
        sendJson(response, statusCode, {
          catalogSchemaVersion: 1,
          pets: petCatalog.listPets()
        }, responseHeaders);
        return;
      }

      const petAssetMatch = PET_ASSET_PATH_PATTERN.exec(url.pathname);
      if (petAssetMatch) {
        const encodings = url.searchParams.getAll("encoding");
        if (
          url.searchParams.size > encodings.length
          || encodings.length > 1
          || (encodings.length === 1 && encodings[0] !== "base64")
        ) {
          throw new HttpError(
            400,
            "invalid_query",
            "宠物资源 encoding 只支持 base64"
          );
        }
        if (encodings.length === 1) {
          const payload = petCatalog.getBase64Asset(
            petAssetMatch[1],
            petAssetMatch[2]
          );
          if (!payload) {
            throw new HttpError(
              404,
              "pet_asset_not_found",
              "宠物资源不存在"
            );
          }
          statusCode = 200;
          sendJson(response, statusCode, payload, responseHeaders);
          return;
        }
        const asset = petCatalog.getAsset(
          petAssetMatch[1],
          petAssetMatch[2]
        );
        if (!asset) {
          throw new HttpError(404, "pet_asset_not_found", "宠物资源不存在");
        }
        statusCode = sendAsset(
          request,
          response,
          asset,
          responseHeaders
        );
        return;
      }

      const petAssetsMatch = PET_ASSETS_PATH_PATTERN.exec(url.pathname);
      if (petAssetsMatch) {
        const limit = integerQueryParameter(url, "limit", {
          defaultValue: 16,
          maximum: 20,
          minimum: 1
        });
        const offset = integerQueryParameter(url, "offset", {
          defaultValue: 0,
          maximum: 100_000,
          minimum: 0
        });
        const page = petCatalog.listAssets(petAssetsMatch[1], {
          limit,
          offset
        });
        if (!page) {
          throw new HttpError(404, "pet_not_found", "宠物不存在");
        }
        statusCode = 200;
        sendJson(response, statusCode, {
          catalogSchemaVersion: 1,
          ...page
        }, responseHeaders);
        return;
      }

      const petDetailMatch = PET_DETAIL_PATH_PATTERN.exec(url.pathname);
      if (petDetailMatch) {
        const pet = petCatalog.getPet(petDetailMatch[1]);
        if (!pet) {
          throw new HttpError(404, "pet_not_found", "宠物不存在");
        }
        statusCode = 200;
        sendJson(response, statusCode, {
          catalogSchemaVersion: 1,
          pet
        }, responseHeaders);
        return;
      }

      if (url.pathname === "/v1/memories") {
        if (request.method === "GET") {
          const limit = integerQueryParameter(url, "limit", {
            defaultValue: 10,
            maximum: 20,
            minimum: 1
          });
          const offset = integerQueryParameter(url, "offset", {
            defaultValue: 0,
            maximum: 100_000,
            minimum: 0
          });
          const allMemories = service.listMemories(device);
          const memories = allMemories.slice(offset, offset + limit);
          statusCode = 200;
          sendJson(response, statusCode, {
            hasMore: offset + memories.length < allMemories.length,
            memories,
            nextOffset: offset + memories.length
          }, responseHeaders);
          return;
        }

        statusCode = 200;
        sendJson(response, statusCode, {
          deleted: service.clearMemories(device)
        }, responseHeaders);
        return;
      }

      const memoryId = memoryIdFromPath(url.pathname);
      const deleted = service.deleteMemory(device, memoryId);
      if (!deleted) {
        throw new HttpError(404, "memory_not_found", "记忆不存在");
      }
      statusCode = 200;
      sendJson(response, statusCode, {
        deleted: true,
        memoryId
      }, responseHeaders);
    } catch (error) {
      const normalized = error instanceof HttpError
        ? error
        : error instanceof TypeError
          ? new HttpError(400, "invalid_request", error.message)
          : new HttpError(500, "internal_error", "服务暂时不可用");
      statusCode = normalized.statusCode;
      if (!response.headersSent) {
        sendJson(response, statusCode, {
          error: normalized.code,
          message: normalized.message
        }, {
          ...responseHeaders,
          ...normalized.headers
        });
      }
      if (statusCode >= 500) {
        logger?.error({
          error: normalized.code,
          method: request.method,
          path: url.pathname,
          requestId
        });
      }
    } finally {
      logger?.info({
        durationMs: Math.max(0, now() - startedAt),
        method: request.method,
        path: url.pathname,
        requestId,
        statusCode
      });
    }
  }

  return http.createServer((request, response) => {
    void handleRequest(request, response);
  });
}

export async function startWatchBuddyServer({
  host = process.env.HOST ?? DEFAULT_HOST,
  logger = createJsonLogger(),
  port = Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10),
  stateFile = process.env.WATCHBUDDY_STATE_FILE ?? ""
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError("PORT 必须是 0 到 65535 之间的整数");
  }

  const service = stateFile
    ? new WatchBuddyService({
      stateStore: new JsonStateStore(stateFile)
    })
    : new WatchBuddyService();
  const server = createWatchBuddyServer({ logger, service });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  return server;
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const server = await startWatchBuddyServer();
  const address = server.address();
  const displayHost = typeof address === "object" && address
    ? address.address
    : DEFAULT_HOST;
  const displayPort = typeof address === "object" && address
    ? address.port
    : DEFAULT_PORT;

  console.log(`WatchBuddy API listening on http://${displayHost}:${displayPort}`);
}
