import test from "node:test";
import assert from "node:assert/strict";

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
  MAX_FETCH_HEADER_BYTES,
  MAX_FETCH_PACKET_BYTES,
  normalizeApiBaseUrl,
  utf8ByteLength
} from "../entry/src/main/js/MainAbility/common/watch-api-contract.js";
import {
  defaultPetCatalog
} from "../../watchbuddy-api/src/pet-catalog.js";

const BASE_URL = "https://api.example.com";
const DEVICE_TOKEN = "device_token_123456789012345678901234567890";
const NOW = 1_750_000_000_000;

function nudge() {
  return {
    schemaVersion: 1,
    type: "COMPANION_NUDGE",
    nudgeId: "nudge_12345678",
    source: "daily_routine",
    intensity: 1,
    characterState: "curious",
    message: "今天哪一小段最值得留下？",
    actions: [
      { id: "share", label: "跟你说说" },
      { id: "later", label: "晚点" }
    ],
    createdAt: NOW,
    expiresAt: NOW + 60_000
  };
}

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
  assert.deepEqual(createHealthRequest(BASE_URL), {
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

test("创建注册、状态、回复和记忆请求", () => {
  assert.deepEqual(createRegistrationRequest(
    BASE_URL,
    {
      deviceId: "gt6pro_test_01",
      locale: "zh-CN",
      timezoneOffsetMinutes: 480
    },
    "register-test-01"
  ), {
    url: "https://api.example.com/v1/device/register",
    method: "POST",
    responseType: "json",
    header: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": "register-test-01"
    },
    data: JSON.stringify({
      deviceId: "gt6pro_test_01",
      locale: "zh-CN",
      timezoneOffsetMinutes: 480
    })
  });

  assert.equal(
    createCompanionStateRequest(BASE_URL, DEVICE_TOKEN).url,
    "https://api.example.com/v1/companion/state"
  );
  assert.equal(
    createReplyRequest(
      BASE_URL,
      DEVICE_TOKEN,
      {
        actionId: "share",
        nudgeId: "nudge_12345678"
      },
      "reply-test-01"
    ).method,
    "POST"
  );
  assert.equal(
    createMemoriesRequest(BASE_URL, DEVICE_TOKEN, 10, 20).url,
    "https://api.example.com/v1/memories?limit=10&offset=20"
  );
  assert.equal(
    createDeleteMemoryRequest(
      BASE_URL,
      DEVICE_TOKEN,
      "memory/12345678"
    ).url,
    "https://api.example.com/v1/memories/memory%2F12345678"
  );
  assert.equal(
    createClearMemoriesRequest(BASE_URL, DEVICE_TOKEN).method,
    "DELETE"
  );
});

test("创建受控宠物目录、清单、分页和 Base64 资源请求", () => {
  const pet = defaultPetCatalog.listPets()[0];
  const descriptor = defaultPetCatalog.listAssets(pet.id, {
    limit: 1,
    offset: 0
  }).assets[0];

  assert.equal(
    createPetCatalogRequest(BASE_URL, DEVICE_TOKEN).url,
    "https://api.example.com/v1/pets"
  );
  assert.equal(
    createPetDetailRequest(BASE_URL, DEVICE_TOKEN, pet.id).url,
    `https://api.example.com/v1/pets/${pet.id}`
  );
  assert.equal(
    createPetAssetsRequest(
      BASE_URL,
      DEVICE_TOKEN,
      pet.id,
      pet.version,
      20,
      40
    ).url,
    `https://api.example.com/v1/pets/${pet.id}/assets?limit=20&offset=40`
  );
  assert.equal(
    createPetAssetRequest(
      BASE_URL,
      DEVICE_TOKEN,
      pet.id,
      descriptor.id
    ).url,
    `https://api.example.com/v1/pets/${pet.id}/assets/`
      + `${descriptor.id}?encoding=base64`
  );
  assert.throws(
    () => createPetAssetRequest(
      BASE_URL,
      DEVICE_TOKEN,
      pet.id,
      "../manifest"
    ),
    /资源 ID/
  );
});

test("请求构造拒绝无效令牌、分页和超大正文", () => {
  assert.throws(
    () => createCompanionStateRequest(BASE_URL, "short"),
    /令牌/
  );
  assert.throws(
    () => createMemoriesRequest(BASE_URL, DEVICE_TOKEN, 21, 0),
    /limit/
  );
  assert.throws(
    () => createReplyRequest(
      BASE_URL,
      DEVICE_TOKEN,
      { text: "中".repeat(3000) },
      "reply-large-01"
    ),
    /单包/
  );
  assert.equal(utf8ByteLength("WatchBuddy中🙂"), 17);
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

test("校验注册、状态与回复响应", () => {
  assert.equal(inspectRegistrationResponse({
    code: 201,
    data: {
      deviceId: "gt6pro_test_01",
      deviceToken: DEVICE_TOKEN,
      registeredAt: NOW
    }
  }).ok, true);

  const state = inspectCompanionStateResponse({
    code: 200,
    data: {
      characterState: "curious",
      companionState: {
        activity: "curious"
      },
      initiative: {
        blockedBy: null,
        decision: "send",
        reasons: ["处于日常互动窗口"]
      },
      nextCheckAt: NOW + 300_000,
      nudge: nudge(),
      serverTime: NOW
    }
  });
  assert.equal(state.ok, true);
  assert.equal(state.data.nudge.nudgeId, "nudge_12345678");

  assert.equal(inspectReplyResponse({
    code: 200,
    data: {
      accepted: true,
      characterState: "chatting",
      memory: null,
      nextCheckAt: NOW + 300_000,
      reply: {
        actionId: "share"
      }
    }
  }).ok, true);
});

test("接受主动策略阻断后的空消息状态", () => {
  const state = inspectCompanionStateResponse({
    code: 200,
    data: {
      characterState: "sleeping",
      companionState: {
        activity: "sleeping"
      },
      initiative: {
        blockedBy: "sleeping",
        decision: "block",
        reasons: []
      },
      nextCheckAt: NOW + 30 * 60_000,
      nudge: null,
      serverTime: NOW
    }
  });

  assert.equal(state.ok, true);
  assert.equal(state.data.nudge, null);
});

test("校验记忆列表和删除响应", () => {
  const memory = {
    id: "memory_12345678",
    type: "event",
    summary: "今天完成了表端 API",
    sensitivity: "normal",
    source: "watch_reply",
    updatedAt: NOW,
    expiresAt: null
  };
  assert.equal(inspectMemoriesResponse({
    code: 200,
    data: {
      hasMore: false,
      memories: [memory],
      nextOffset: 1
    }
  }).ok, true);
  assert.equal(inspectDeleteMemoryResponse({
    code: 200,
    data: {
      deleted: true,
      memoryId: memory.id
    }
  }).ok, true);
  assert.equal(inspectClearMemoriesResponse({
    code: 200,
    data: {
      deleted: 1
    }
  }).ok, true);
});

test("校验受控宠物目录、清单、分页和 Base64 资源响应", () => {
  const summary = defaultPetCatalog.listPets()[0];
  const pet = defaultPetCatalog.getPet(summary.id);
  const page = defaultPetCatalog.listAssets(summary.id, {
    limit: 20,
    offset: 0
  });
  const descriptor = page.assets[0];
  const encoded = defaultPetCatalog.getBase64Asset(
    summary.id,
    descriptor.id
  );

  assert.equal(inspectPetCatalogResponse({
    code: 200,
    data: {
      catalogSchemaVersion: 1,
      pets: [summary]
    }
  }).ok, true);
  assert.equal(inspectPetDetailResponse({
    code: 200,
    data: {
      catalogSchemaVersion: 1,
      pet
    }
  }, summary.id).data.version, summary.version);
  assert.equal(inspectPetAssetsResponse({
    code: 200,
    data: {
      catalogSchemaVersion: 1,
      ...page
    }
  }, summary.id, summary.version).data.assets.length, 20);
  assert.equal(inspectPetAssetResponse({
    code: 200,
    data: encoded
  }, descriptor).data.sha256, descriptor.sha256);

  assert.equal(inspectPetAssetsResponse({
    code: 200,
    data: {
      catalogSchemaVersion: 1,
      ...page,
      version: "sha256-0000000000000000"
    }
  }, summary.id, summary.version).reason, "invalid_response");
});

test("拒绝过大、过期或错误状态码的业务响应", () => {
  assert.equal(inspectCompanionStateResponse({
    code: 200,
    data: {
      characterState: "curious",
      initiative: {
        blockedBy: null,
        decision: "send",
        reasons: []
      },
      nextCheckAt: NOW + 300_000,
      nudge: {
        ...nudge(),
        expiresAt: NOW
      },
      serverTime: NOW
    }
  }).reason, "invalid_nudge");
  assert.equal(inspectRegistrationResponse({
    code: 401,
    data: {
      error: "unauthorized"
    }
  }).reason, "http_401");
  assert.equal(inspectReplyResponse({
    code: 200,
    data: "中".repeat(3000)
  }).reason, "response_too_large");
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
    data: "x".repeat(MAX_FETCH_PACKET_BYTES + 1)
  }), {
    ok: false,
    reason: "response_too_large"
  });
});
