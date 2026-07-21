import { createHash } from "node:crypto";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_OPENAI_RESPONSE_BYTES = 64 * 1024;
const MODEL_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export const DEFAULT_COMPANION_MODEL = "gpt-5.6-terra";
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

function extractOutputText(payload) {
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
  return parts.join(" ").replace(/\s+/gu, " ").trim();
}

function validReplyText(text) {
  return Boolean(text)
    && codePointLength(text) <= MAX_COMPANION_REPLY_CHARACTERS;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1 || value > 60_000) {
    throw new TypeError(`${name} 必须是 1 到 60000 之间的整数`);
  }
}

export function createOpenAiCompanionResponder({
  apiKey = "",
  fetcher = globalThis.fetch,
  model = DEFAULT_COMPANION_MODEL,
  timeoutMs = DEFAULT_COMPANION_TIMEOUT_MS
} = {}) {
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

  const normalizedApiKey = apiKey.trim();

  return {
    async respond({ deviceId, text }) {
      if (!normalizedApiKey
        || typeof deviceId !== "string"
        || typeof text !== "string") {
        return fallbackReply();
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetcher(OPENAI_RESPONSES_URL, {
          body: JSON.stringify({
            input: text,
            instructions: COMPANION_INSTRUCTIONS,
            max_output_tokens: 96,
            model,
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
            && declaredLength > MAX_OPENAI_RESPONSE_BYTES)
          || !(response.headers?.get?.("content-type") ?? "")
            .toLowerCase()
            .startsWith("application/json")) {
          return fallbackReply();
        }

        const rawBody = await response.text();
        if (Buffer.byteLength(rawBody) > MAX_OPENAI_RESPONSE_BYTES) {
          return fallbackReply();
        }

        const replyText = extractOutputText(JSON.parse(rawBody));
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
