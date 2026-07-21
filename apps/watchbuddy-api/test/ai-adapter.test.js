import assert from "node:assert/strict";
import test from "node:test";

import {
  createCompanionResponder,
  createDeepSeekCompanionResponder,
  createOpenAiCompanionResponder,
  DEFAULT_COMPANION_MODEL,
  DEFAULT_DEEPSEEK_COMPANION_MODEL,
  FALLBACK_COMPANION_TEXT
} from "../src/ai-adapter.js";

const DEVICE_ID = "gt6pro_ai_test_01";

function completedResponse(text) {
  return new Response(JSON.stringify({
    output: [{
      content: [{
        text,
        type: "output_text"
      }],
      role: "assistant",
      type: "message"
    }],
    status: "completed"
  }), {
    headers: {
      "content-type": "application/json"
    },
    status: 200
  });
}

function deepSeekResponse(text, finishReason = "stop") {
  return new Response(JSON.stringify({
    choices: [{
      finish_reason: finishReason,
      index: 0,
      message: {
        content: text,
        role: "assistant"
      }
    }]
  }), {
    headers: {
      "content-type": "application/json"
    },
    status: 200
  });
}

test("Responses API 请求不暴露设备标识并限制模型输出", async () => {
  let captured;
  const responder = createOpenAiCompanionResponder({
    apiKey: "test-openai-key",
    fetcher: async (url, options) => {
      captured = { options, url };
      return completedResponse("听起来你今天做成了一件重要的事。");
    }
  });

  const result = await responder.respond({
    deviceId: DEVICE_ID,
    text: "今天把手表应用跑起来了"
  });
  const request = JSON.parse(captured.options.body);

  assert.deepEqual(result, {
    fallback: false,
    text: "听起来你今天做成了一件重要的事。"
  });
  assert.equal(captured.url, "https://api.openai.com/v1/responses");
  assert.equal(captured.options.headers.authorization, "Bearer test-openai-key");
  assert.equal(request.model, DEFAULT_COMPANION_MODEL);
  assert.equal(request.input, "今天把手表应用跑起来了");
  assert.equal(request.reasoning.effort, "low");
  assert.equal(request.store, false);
  assert.match(request.safety_identifier, /^[a-f0-9]{64}$/);
  assert.equal(request.safety_identifier.includes(DEVICE_ID), false);
  assert.equal(captured.options.body.includes("test-openai-key"), false);
});

test("未配置密钥时不请求外部服务并返回固定模板", async () => {
  let callCount = 0;
  const responder = createOpenAiCompanionResponder({
    fetcher: async () => {
      callCount += 1;
      return completedResponse("不应调用");
    }
  });

  const result = await responder.respond({
    deviceId: DEVICE_ID,
    text: "你好"
  });

  assert.equal(callCount, 0);
  assert.deepEqual(result, {
    fallback: true,
    text: FALLBACK_COMPANION_TEXT
  });
});

test("DeepSeek 请求使用 V4 Flash 且不暴露设备标识", async () => {
  let captured;
  const responder = createDeepSeekCompanionResponder({
    apiKey: "test-deepseek-key",
    fetcher: async (url, options) => {
      captured = { options, url };
      return deepSeekResponse("我听见了，今天先陪你轻轻歇一会。 ");
    }
  });

  const result = await responder.respond({
    deviceId: DEVICE_ID,
    text: "今天有点累"
  });
  const request = JSON.parse(captured.options.body);

  assert.deepEqual(result, {
    fallback: false,
    text: "我听见了，今天先陪你轻轻歇一会。"
  });
  assert.equal(
    captured.url,
    "https://api.deepseek.com/chat/completions"
  );
  assert.equal(
    captured.options.headers.authorization,
    "Bearer test-deepseek-key"
  );
  assert.equal(request.model, DEFAULT_DEEPSEEK_COMPANION_MODEL);
  assert.equal(request.messages[0].role, "system");
  assert.deepEqual(request.messages[1], {
    content: "今天有点累",
    role: "user"
  });
  assert.deepEqual(request.thinking, { type: "disabled" });
  assert.equal(request.stream, false);
  assert.match(request.user_id, /^[a-f0-9]{64}$/);
  assert.equal(request.user_id.includes(DEVICE_ID), false);
  assert.equal(captured.options.body.includes("test-deepseek-key"), false);
});

test("DeepSeek 截断响应和未知提供商被安全拒绝", async () => {
  const responder = createCompanionResponder({
    apiKey: "test-deepseek-key",
    fetcher: async () => deepSeekResponse("这段回复被截断", "length"),
    provider: "deepseek"
  });

  assert.deepEqual(await responder.respond({
    deviceId: DEVICE_ID,
    text: "测试截断"
  }), {
    fallback: true,
    text: FALLBACK_COMPANION_TEXT
  });
  assert.throws(
    () => createCompanionResponder({ provider: "unknown" }),
    /只支持 openai 或 deepseek/
  );
  assert.throws(
    () => createDeepSeekCompanionResponder({ model: "deepseek-chat" }),
    /只支持 deepseek-v4-flash 或 deepseek-v4-pro/
  );
});

test("超时、内部错误和非法响应只返回固定模板", async (t) => {
  const cases = [
    {
      fetcher: async () => {
        throw new Error("secret-upstream-detail");
      },
      name: "上游异常"
    },
    {
      fetcher: async () => new Response("not-json", {
        headers: { "content-type": "text/plain" },
        status: 500
      }),
      name: "错误状态"
    },
    {
      fetcher: async () => completedResponse("太长".repeat(20)),
      name: "超长输出"
    },
    {
      fetcher: async () => new Response(JSON.stringify({
        output: [],
        status: "incomplete"
      }), {
        headers: { "content-type": "application/json" },
        status: 200
      }),
      name: "未完成响应"
    }
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const responder = createOpenAiCompanionResponder({
        apiKey: "test-openai-key",
        fetcher: testCase.fetcher
      });
      const result = await responder.respond({
        deviceId: DEVICE_ID,
        text: "测试"
      });
      assert.deepEqual(result, {
        fallback: true,
        text: FALLBACK_COMPANION_TEXT
      });
      assert.equal(JSON.stringify(result).includes("secret-upstream-detail"), false);
    });
  }
});

test("达到超时上限会中止请求并安全降级", async () => {
  let aborted = false;
  const responder = createOpenAiCompanionResponder({
    apiKey: "test-openai-key",
    fetcher: async (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      }, { once: true });
    }),
    timeoutMs: 5
  });

  const result = await responder.respond({
    deviceId: DEVICE_ID,
    text: "测试超时"
  });

  assert.equal(aborted, true);
  assert.deepEqual(result, {
    fallback: true,
    text: FALLBACK_COMPANION_TEXT
  });
});
