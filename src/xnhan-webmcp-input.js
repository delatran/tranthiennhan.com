import {
  normalizeXNhanConversationHistory,
  normalizeXNhanQuery,
  xNhanQueryLength,
  XNHAN_QUERY_MAX_LENGTH,
} from "../shared/xnhan.js";

export const XNHAN_WEBMCP_TOOL_NAMES = Object.freeze({
  searchXPosts: "search_x_posts",
  getCurrentXResults: "get_current_x_results",
  requestOpenXPost: "request_open_x_post",
  setXNhanLocale: "set_xnhan_locale",
  stopXNhanSearch: "stop_xnhan_search",
  startNewXNhanChat: "start_new_xnhan_chat",
  getCurrentXResultIndex: "get_current_x_result_index",
  getXNhanSearchStatus: "get_xnhan_search_status",
});

export const XNHAN_WEBMCP_LOCALES = Object.freeze(["en", "vi"]);
export const XNHAN_WEBMCP_PROVIDERS = Object.freeze(["openai", "openrouter"]);
export const XNHAN_WEBMCP_CONTEXT_MODES = Object.freeze([
  "standalone",
  "visible_conversation",
]);

const QUESTION_MIN_LENGTH = 2;
const RESULT_ID_MAX_LENGTH = 30;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const X_STATUS_ID_PATTERN = /^[1-9]\d{0,29}$/u;

export const XNHAN_WEBMCP_SEARCH_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    question: Object.freeze({
      type: "string",
      description: "Natural-language question used to find relevant public X posts.",
      minLength: QUESTION_MIN_LENGTH,
      maxLength: XNHAN_QUERY_MAX_LENGTH,
    }),
    provider: Object.freeze({
      type: "string",
      description: "Provider for this search: OpenAI or OpenRouter.",
      enum: XNHAN_WEBMCP_PROVIDERS,
    }),
    contextMode: Object.freeze({
      type: "string",
      description:
        "Context transfer for this call. standalone sends no prior turns. visible_conversation sends the bounded completed conversation currently visible in this tab to the selected provider, including turns produced by another provider when present.",
      enum: XNHAN_WEBMCP_CONTEXT_MODES,
    }),
  }),
  required: Object.freeze(["question", "provider", "contextMode"]),
  additionalProperties: false,
});

export const XNHAN_WEBMCP_EMPTY_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({}),
  required: Object.freeze([]),
  additionalProperties: false,
});

export const XNHAN_WEBMCP_OPEN_POST_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    resultId: Object.freeze({
      type: "string",
      description: "Identifier of a currently visible X result to open.",
      minLength: 1,
      maxLength: RESULT_ID_MAX_LENGTH,
      pattern: "^[1-9][0-9]{0,29}$",
    }),
  }),
  required: Object.freeze(["resultId"]),
  additionalProperties: false,
});

export const XNHAN_WEBMCP_LOCALE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    locale: Object.freeze({
      type: "string",
      description: "Visible interface language: English or Vietnamese.",
      enum: XNHAN_WEBMCP_LOCALES,
    }),
  }),
  required: Object.freeze(["locale"]),
  additionalProperties: false,
});

export function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function readOwnDataProperty(value, property, message) {
  let plainObject;
  let descriptor;
  try {
    plainObject = isPlainObject(value);
    descriptor = plainObject
      ? Object.getOwnPropertyDescriptor(value, property)
      : undefined;
  } catch {
    throw new TypeError(message);
  }

  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError(message);
  }

  return descriptor.value;
}

export function validateExactInput(input, expectedKeys) {
  let plainObject;
  let keys;
  try {
    plainObject = isPlainObject(input);
    keys = plainObject ? Reflect.ownKeys(input) : [];
  } catch {
    throw new TypeError("X Nhân WebMCP input must be a plain object.");
  }

  if (!plainObject) {
    throw new TypeError("X Nhân WebMCP input must be a plain object.");
  }
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  ) {
    throw new TypeError("X Nhân WebMCP input contains unsupported fields.");
  }

  const values = Object.create(null);
  for (const key of expectedKeys) {
    values[key] = readOwnDataProperty(
      input,
      key,
      "X Nhân WebMCP input contains an unsupported value.",
    );
  }
  return values;
}

export function validateSearchInput(input) {
  const { contextMode, provider, question } = validateExactInput(input, [
    "question",
    "provider",
    "contextMode",
  ]);
  if (typeof question !== "string") {
    throw new TypeError("X Nhân search question must be a string.");
  }

  const normalized = normalizeXNhanQuery(question);
  const normalizedLength = xNhanQueryLength(normalized);
  if (
    normalizedLength < QUESTION_MIN_LENGTH ||
    normalizedLength > XNHAN_QUERY_MAX_LENGTH
  ) {
    throw new TypeError("X Nhân search question is outside the supported range.");
  }
  if (
    typeof provider !== "string" ||
    !XNHAN_WEBMCP_PROVIDERS.includes(provider)
  ) {
    throw new TypeError("X Nhân provider is unsupported.");
  }
  if (
    typeof contextMode !== "string" ||
    !XNHAN_WEBMCP_CONTEXT_MODES.includes(contextMode)
  ) {
    throw new TypeError("X Nhân context mode is unsupported.");
  }
  return Object.freeze({ question: normalized, provider, contextMode });
}

export function validateSafeId(value, maximumLength, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    !SAFE_ID_PATTERN.test(value)
  ) {
    throw new TypeError(`X Nhân WebMCP ${label} is unsupported.`);
  }
  return value;
}

export function validateXStatusId(value, label) {
  if (typeof value !== "string" || !X_STATUS_ID_PATTERN.test(value)) {
    throw new TypeError(`X Nhân WebMCP ${label} is unsupported.`);
  }
  return value;
}

export function validateResultId(input) {
  const { resultId } = validateExactInput(input, ["resultId"]);
  return validateXStatusId(resultId, "result identifier");
}

export function validateLocale(input) {
  const { locale } = validateExactInput(input, ["locale"]);
  if (typeof locale !== "string" || !XNHAN_WEBMCP_LOCALES.includes(locale)) {
    throw new TypeError("X Nhân locale is unsupported.");
  }
  return locale;
}

export function requireAction(actions, name) {
  if (actions === null || (typeof actions !== "object" && typeof actions !== "function")) {
    throw new TypeError("X Nhân WebMCP actions must be provided.");
  }

  let action;
  try {
    action = actions[name];
  } catch {
    throw new TypeError("A required X Nhân WebMCP action is unavailable.");
  }
  if (typeof action !== "function") {
    throw new TypeError("A required X Nhân WebMCP action is unavailable.");
  }
  return action.bind(actions);
}

export function captureSearchHistory(action, contextMode) {
  const captured = action(contextMode);
  const normalized = normalizeXNhanConversationHistory(captured);
  if (
    normalized === null ||
    (contextMode === "standalone" && normalized.length !== 0)
  ) {
    throw new TypeError("X Nhân WebMCP search context is unsupported.");
  }
  return normalized;
}
