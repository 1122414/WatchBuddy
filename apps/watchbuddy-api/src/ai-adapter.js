import { createHash } from "node:crypto";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEEPSEEK_CHAT_COMPLETIONS_URL =
  "https://api.deepseek.com/chat/completions";
const MAX_AI_RESPONSE_BYTES = 64 * 1024;
const MAX_USER_TEXT_CHARACTERS = 64;
const MODEL_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const DEEPSEEK_MODEL_PATTERN = /^deepseek-v4-(flash|pro)$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export const DEFAULT_COMPANION_PROVIDER = "openai";
export const DEFAULT_COMPANION_MODEL = "gpt-5.6-terra";
export const DEFAULT_DEEPSEEK_COMPANION_MODEL = "deepseek-v4-flash";
export const DEFAULT_COMPANION_TIMEOUT_MS = 8_000;
export const FALLBACK_COMPANION_TEXT = "我暂时没听清，但会安静陪着你。";
export const MAX_COMPANION_REPLY_CHARACTERS = 38;

const COMPANION_INSTRUCTIONS = [
  "你是 WatchBuddy，一只住在手表里的温柔虚拟宠物。",
  "直接回应用户当下的话，不编造现实中的行动、经历或已完成事项。",
  `只输出一句不超过 ${MAX_COMPANION_REPLY_CHARACTERS} 个字符的简体中文纯文本。`,
  "不要使用 Markdown、列表、标题、引号或表情符号。"
].join("\n");

function codePointLength(value) {
  return [...value].length;
}

function fallbackReply() {
  return {
    fallback: true,
    text: FALLBACK_COMPANION_TEXT
  };
}

function safetyIdentifier(deviceId) {
  return createHash("sha256")
    .update(`watchbuddy:${deviceId}`)
    .digest("hex");
}

function normalizeReplyText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/gu, " ").trim();
}

function extractOpenAiOutputText(payload) {
  if (!payload
    || typeof payload !== "object"
    || payload.status !== "completed"
    || !Array.isArray(payload.output)) {
    return "";
  }

  const parts = [];
  for (const item of payload.output) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return normalizeReplyText(parts.join(" "));
}

function extractDeepSeekOutputText(payload) {
  if (!payload
    || typeof payload !== "object"
    || !Array.isArray(payload.choices)
    || payload.choices.length !== 1) {
    return "";
  }
  const choice = payload.choices[0];
  if (!choice
    || choice.finish_reason !== "stop"
    || choice.message?.role !== "assistant") {
    return "";
  }
  return normalizeReplyText(choice.message.content);
}

function validReplyText(text) {
  return Boolean(text)
    && codePointLength(text) <= MAX_COMPANION_REPLY_CHARACTERS;
}

function validRequestInput(deviceId, text) {
  return typeof deviceId === "string"
    && DEVICE_ID_PATTERN.test(deviceId)
    && typeof text === "string"
    && text.trim() === text
    && codePointLength(text) >= 1
    && codePointLength(text) <= MAX_USER_TEXT_CHARACTERS;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1 || value > 60_000) {
    throw new TypeError(`${name} 必须是 1 到 60000 之间的整数`);
  }
}

function validateResponderOptions({ apiKey, fetcher, model, timeoutMs }) {
  if (typeof apiKey !== "string") {
    throw new TypeError("apiKey 必须是字符串");
  }
  if (typeof fetcher !== "function") {
    throw new TypeError("fetcher 必须是函数");
  }
  if (typeof model !== "string" || !MODEL_PATTERN.test(model)) {
    throw new TypeError("model 格式无效");
  }
  positiveInteger(timeoutMs, "timeoutMs");
}

function createHttpCompanionResponder({
  apiKey,
  buildRequestBody,
  endpoint,
  extractReplyText,
  fetcher,
  model,
  timeoutMs
}) {
  validateResponderOptions({ apiKey, fetcher, model, timeoutMs });
  const normalizedApiKey = apiKey.trim();

  return {
    async respond({ deviceId, text }) {
      if (!normalizedApiKey || !validRequestInput(deviceId, text)) {
        return fallbackReply();
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetcher(endpoint, {
          body: JSON.stringify(buildRequestBody({
            deviceId,
            model,
            text
          })),
          headers: {
            authorization: `Bearer ${normalizedApiKey}`,
            "content-type": "application/json"
          },
          method: "POST",
          signal: controller.signal
        });

        const declaredLength = Number.parseInt(
          response.headers?.get?.("content-length") ?? "0",
          10
        );
        if (!response.ok
          || (Number.isFinite(declaredLength)
            && declaredLength > MAX_AI_RESPONSE_BYTES)
          || !(response.headers?.get?.("content-type") ?? "")
            .toLowerCase()
            .startsWith("application/json")) {
          return fallbackReply();
        }

        const rawBody = await response.text();
        if (Buffer.byteLength(rawBody) > MAX_AI_RESPONSE_BYTES) {
          return fallbackReply();
        }

        const replyText = extractReplyText(JSON.parse(rawBody));
        if (!validReplyText(replyText)) {
          return fallbackReply();
        }
        return {
          fallback: false,
          text: replyText
        };
      } catch (error) {
        return fallbackReply();
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

export function createOpenAiCompanionResponder({
  apiKey = "",
  fetcher = globalThis.fetch,
  model = DEFAULT_COMPANION_MODEL,
  timeoutMs = DEFAULT_COMPANION_TIMEOUT_MS
} = {}) {
  return createHttpCompanionResponder({
    apiKey,
    buildRequestBody: ({ deviceId, model: selectedModel, text }) => ({
      input: text,
      instructions: COMPANION_INSTRUCTIONS,
      max_output_tokens: 96,
      model: selectedModel,
      reasoning: {
        effort: "low"
      },
      safety_identifier: safetyIdentifier(deviceId),
      store: false,
      text: {
        format: {
          type: "text"
        },
        verbosity: "low"
      }
    }),
    endpoint: OPENAI_RESPONSES_URL,
    extractReplyText: extractOpenAiOutputText,
    fetcher,
    model,
    timeoutMs
  });
}

export function createDeepSeekCompanionResponder({
  apiKey = "",
  fetcher = globalThis.fetch,
  model = DEFAULT_DEEPSEEK_COMPANION_MODEL,
  timeoutMs = DEFAULT_COMPANION_TIMEOUT_MS
} = {}) {
  if (typeof model !== "string" || !DEEPSEEK_MODEL_PATTERN.test(model)) {
    throw new TypeError(
      "DeepSeek model 只支持 deepseek-v4-flash 或 deepseek-v4-pro"
    );
  }
  return createHttpCompanionResponder({
    apiKey,
    buildRequestBody: ({ deviceId, model: selectedModel, text }) => ({
      max_tokens: 96,
      messages: [
        {
          content: COMPANION_INSTRUCTIONS,
          role: "system"
        },
        {
          content: text,
          role: "user"
        }
      ],
      model: selectedModel,
      response_format: {
        type: "text"
      },
      stream: false,
      thinking: {
        type: "disabled"
      },
      user_id: safetyIdentifier(deviceId)
    }),
    endpoint: DEEPSEEK_CHAT_COMPLETIONS_URL,
    extractReplyText: extractDeepSeekOutputText,
    fetcher,
    model,
    timeoutMs
  });
}

export function createCompanionResponder({
  apiKey = "",
  fetcher = globalThis.fetch,
  model,
  provider = DEFAULT_COMPANION_PROVIDER,
  timeoutMs = DEFAULT_COMPANION_TIMEOUT_MS
} = {}) {
  if (provider === "openai") {
    return createOpenAiCompanionResponder({
      apiKey,
      fetcher,
      model: model ?? DEFAULT_COMPANION_MODEL,
      timeoutMs
    });
  }
  if (provider === "deepseek") {
    return createDeepSeekCompanionResponder({
      apiKey,
      fetcher,
      model: model ?? DEFAULT_DEEPSEEK_COMPANION_MODEL,
      timeoutMs
    });
  }
  throw new TypeError("WATCHBUDDY_AI_PROVIDER 只支持 openai 或 deepseek");
}
