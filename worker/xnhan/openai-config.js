import {
  isXNhanOpenAiModelId,
  supportsXNhanOpenAiExplicitPromptCache,
} from "./config.js";

export const XNHAN_OPENAI_RESPONSES_URL =
  "https://api.openai.com/v1/responses";
export const XNHAN_OPENAI_MAX_API_KEY_LENGTH = 8_192;
export const XNHAN_OPENAI_MAX_RESPONSE_BYTES = 2 * 1_024 * 1_024;
export const XNHAN_OPENAI_MAX_OUTPUT_TOKENS = 16_000;
// Discovery now runs two complementary hosted-search passes under one shared
// deadline. Keep enough network wait budget for the later correction pass while
// the outer pipeline still owns the end-to-end ceiling and client cancellation.
export const XNHAN_OPENAI_TIMEOUT_MS = 240_000;
export const XNHAN_WEB_SEARCH_MAX_TOOL_CALLS = 6;
export const XNHAN_OPENAI_PROMPT_CACHE_TTL = "30m";

const XNHAN_PROVIDER_USAGE = Symbol("xnhan_provider_usage");
const XNHAN_PROVIDER_USAGES = Symbol("xnhan_provider_usages");

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function nonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function normalizedProviderUsage(usage) {
  if (!usage || Array.isArray(usage) || typeof usage !== "object") return null;
  return Object.freeze({
    inputTokens: nonNegativeInteger(usage.inputTokens),
    outputTokens: nonNegativeInteger(usage.outputTokens),
    cachedInputTokens: nonNegativeInteger(usage.cachedInputTokens),
    cacheWriteTokens: nonNegativeInteger(usage.cacheWriteTokens),
    cost: nonNegativeNumber(usage.cost),
    webSearchRequests: nonNegativeInteger(usage.webSearchRequests),
  });
}

export function attachXNhanProviderUsage(error, usage) {
  const normalized = normalizedProviderUsage(usage);
  if (
    !normalized ||
    (!error || (typeof error !== "object" && typeof error !== "function"))
  ) {
    return error;
  }
  Object.defineProperty(error, XNHAN_PROVIDER_USAGE, {
    configurable: false,
    enumerable: false,
    value: normalized,
    writable: false,
  });
  return error;
}

export function readXNhanProviderUsage(error) {
  const usage = error?.[XNHAN_PROVIDER_USAGE];
  if (usage) return usage;
  const usages = error?.[XNHAN_PROVIDER_USAGES];
  return Array.isArray(usages) && usages.length > 0
    ? usages[usages.length - 1]
    : null;
}

export function attachXNhanProviderUsages(error, usages) {
  if (
    !Array.isArray(usages) ||
    !error ||
    (typeof error !== "object" && typeof error !== "function")
  ) {
    return error;
  }
  const normalized = usages.map(normalizedProviderUsage).filter(Boolean);
  if (normalized.length < 1) return error;
  Object.defineProperty(error, XNHAN_PROVIDER_USAGES, {
    configurable: false,
    enumerable: false,
    value: Object.freeze(normalized),
    writable: false,
  });
  return error;
}

export function readXNhanProviderUsages(error) {
  const usages = error?.[XNHAN_PROVIDER_USAGES];
  if (Array.isArray(usages)) return usages;
  const usage = readXNhanProviderUsage(error);
  return usage ? Object.freeze([usage]) : Object.freeze([]);
}

export function normalizeXNhanOpenAiUsage(usage) {
  if (!usage || Array.isArray(usage) || typeof usage !== "object") return null;
  const inputDetails = usage.input_tokens_details;
  return {
    inputTokens: nonNegativeInteger(usage.input_tokens),
    outputTokens: nonNegativeInteger(usage.output_tokens),
    cachedInputTokens: nonNegativeInteger(inputDetails?.cached_tokens),
    cacheWriteTokens: nonNegativeInteger(inputDetails?.cache_write_tokens),
    cost: null,
    webSearchRequests: null,
  };
}

export function buildXNhanExplicitCachedInput(instructions, input) {
  if (typeof instructions !== "string" || typeof input !== "string") {
    throw new TypeError("invalid_xnhan_cached_input");
  }
  return [
    {
      role: "developer",
      content: [
        {
          type: "input_text",
          text: instructions,
          prompt_cache_breakpoint: { mode: "explicit" },
        },
      ],
    },
    {
      role: "user",
      content: [{ type: "input_text", text: input }],
    },
  ];
}

export function buildXNhanWebSearchTool({
  country,
  searchContextSize = "medium",
  returnTokenBudget,
} = {}) {
  if (country !== undefined && !/^[A-Z]{2}$/u.test(country)) {
    throw new TypeError("invalid_xnhan_search_country");
  }
  if (!["low", "medium", "high"].includes(searchContextSize)) {
    throw new TypeError("invalid_xnhan_search_context_size");
  }
  if (
    returnTokenBudget !== undefined &&
    !["default", "unlimited"].includes(returnTokenBudget)
  ) {
    throw new TypeError("invalid_xnhan_search_token_budget");
  }

  return {
    type: "web_search",
    external_web_access: true,
    filters: {
      allowed_domains: ["x.com"],
    },
    search_context_size: searchContextSize,
    ...(returnTokenBudget !== undefined && {
      return_token_budget: returnTokenBudget,
    }),
    ...(country
      ? {
          user_location: {
            type: "approximate",
            country,
          },
        }
      : {}),
  };
}

export function buildXNhanOpenAiRequest({
  include,
  input,
  instructions,
  maxOutputTokens = XNHAN_OPENAI_MAX_OUTPUT_TOKENS,
  maxToolCalls,
  metadata,
  model,
  promptCacheKey,
  safetyIdentifier,
  schema,
  schemaName,
  reasoningEffort = "medium",
  reasoningMode,
  stream = false,
  textVerbosity = "medium",
  toolChoice,
  tools,
}) {
  if (!isXNhanOpenAiModelId(model)) {
    throw new TypeError("invalid_xnhan_openai_model");
  }
  if (
    promptCacheKey !== undefined &&
    !/^[A-Za-z0-9_-]{1,64}$/u.test(promptCacheKey)
  ) {
    throw new TypeError("invalid_xnhan_prompt_cache_key");
  }
  const useExplicitPromptCache =
    promptCacheKey !== undefined &&
    supportsXNhanOpenAiExplicitPromptCache(model);
  const body = {
    model,
    ...(useExplicitPromptCache
      ? { input: buildXNhanExplicitCachedInput(instructions, input) }
      : { instructions, input }),
    reasoning: {
      effort: reasoningEffort,
      ...(reasoningMode !== undefined && { mode: reasoningMode }),
      context: "current_turn",
      summary: "auto",
    },
    max_output_tokens: maxOutputTokens,
    text: {
      verbosity: textVerbosity,
      format: {
        type: "json_schema",
        name: schemaName,
        strict: true,
        schema,
      },
    },
    tools,
    tool_choice: toolChoice,
    parallel_tool_calls: false,
    background: false,
    stream,
    truncation: "disabled",
    store: true,
    ...(promptCacheKey !== undefined && {
      service_tier: "default",
      prompt_cache_key: promptCacheKey,
      ...(useExplicitPromptCache && {
        prompt_cache_options: {
          mode: "explicit",
          ttl: XNHAN_OPENAI_PROMPT_CACHE_TTL,
        },
      }),
    }),
    safety_identifier: safetyIdentifier,
    metadata,
  };

  if (maxToolCalls !== undefined) body.max_tool_calls = maxToolCalls;
  if (include !== undefined) body.include = include;
  return body;
}
