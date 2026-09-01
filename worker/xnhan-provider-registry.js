import {
  resolveXNhanOpenAiModel,
} from "./config.js";
import {
  resolveXNhanModelDisplayName,
} from "../shared/xnhan-model-display-name.js";
import {
  resolveOpenAiApiKey,
  runXNhanSummary,
  runXNhanTranslation,
} from "./xnhan-openai.js";
import { searchXPosts } from "./xnhan-provider.js";
import {
  resolveOpenRouterApiKey,
  isOpenRouterLogicalModel,
  isOpenRouterReasoningEffort,
  isOpenRouterSearchTransport,
  runXNhanOpenRouterSummary,
  runXNhanOpenRouterTranslation,
  searchXPostsOpenRouter,
} from "./xnhan-openrouter.js";

export const XNHAN_PROVIDER_IDS = Object.freeze(["openai", "openrouter"]);
export const XNHAN_PROVIDER_SET = new Set(XNHAN_PROVIDER_IDS);

// These are release invariants rather than Runtime variables. Provider model
// IDs and their UI-only display names are operator-editable at runtime.
// The OpenRouter web plugin is deprecated, but the currently documented server
// tool does not establish parity for this product's X-only, exact-author, and
// temporal-scope behavior. Keep the release on the provenance-gated plugin and
// orchestrate two complementary successful discovery passes. The server tool
// remains an explicit adapter profile until those boundaries have production
// evidence.
export const XNHAN_OPENROUTER_RELEASE_SEARCH_TRANSPORT = "web_plugin";
// `omit` disables any operator-supplied fixed effort. The request adapter then
// derives a portable per-model effort from the current OpenRouter model and
// all-endpoint metadata; it omits reasoning when that intersection is unknown.
export const XNHAN_OPENROUTER_RELEASE_REASONING_EFFORT = "omit";
export const XNHAN_TRANSLATION_TIMEOUT_MS = 15_000;

// A discovery pass is a successfully completed, provenance-validated Chat
// Completions request. The adapter can issue additional attempts only to
// recover from an explicit reasoning-parameter or search-transport
// compatibility rejection on the first pass. These bounds deliberately exclude
// the separately cached capability-metadata lookups. Keep compatibility
// attempts separate from web-search counts: a rejected attempt is not claimed
// as a search unless the provider reports one in usage telemetry.
export const XNHAN_OPENROUTER_CAPABILITY_PROFILES = Object.freeze({
  adaptive: Object.freeze({
    endpoint: "chat_completions",
    searchTransport: "adaptive",
    structuredOutput: "capability_intersection",
    webSearch: "openrouter:web_search_with_plugin_fallback",
    webSearchEngine: "parallel",
    providerRequestBounds: Object.freeze({
      scope: "discovery_chat_completions",
      successfulPassRequests: 2,
      maximumCompatibilityRetries: 3,
      maximumAttempts: 5,
    }),
    webSearchRequestBounds: Object.freeze({
      scope: "successful_discovery_passes",
      minimumPerSuccessfulPassRequest: 0,
      maximumPerSuccessfulPassRequest: 2,
      minimumAcrossSuccessfulPassRequests: 0,
      maximumAcrossSuccessfulPassRequests: 4,
      compatibilityAttemptAccounting: "provider_reported_only",
    }),
    provenance: "url_citation_intersection",
  }),
  web_plugin: Object.freeze({
    endpoint: "chat_completions",
    searchTransport: "web_plugin",
    structuredOutput: "adaptive",
    webSearch: "web_plugin",
    webSearchEngine: "parallel",
    providerRequestBounds: Object.freeze({
      scope: "discovery_chat_completions",
      successfulPassRequests: 2,
      maximumCompatibilityRetries: 1,
      maximumAttempts: 3,
    }),
    webSearchRequestBounds: Object.freeze({
      scope: "successful_discovery_passes",
      minimumPerSuccessfulPassRequest: 1,
      maximumPerSuccessfulPassRequest: 1,
      minimumAcrossSuccessfulPassRequests: 2,
      maximumAcrossSuccessfulPassRequests: 2,
      compatibilityAttemptAccounting: "provider_reported_only",
    }),
    maximumRawResults: 20,
    discoveryStrategy: "breadth_then_confirmation_correction",
    provenance: "url_citation_intersection",
  }),
  server_tool: Object.freeze({
    endpoint: "chat_completions",
    searchTransport: "server_tool",
    structuredOutput: "adaptive",
    webSearch: "openrouter:web_search",
    webSearchEngine: "parallel",
    providerRequestBounds: Object.freeze({
      scope: "discovery_chat_completions",
      successfulPassRequests: 2,
      maximumCompatibilityRetries: 1,
      maximumAttempts: 3,
    }),
    webSearchRequestBounds: Object.freeze({
      scope: "successful_discovery_passes",
      minimumPerSuccessfulPassRequest: 0,
      maximumPerSuccessfulPassRequest: 2,
      minimumAcrossSuccessfulPassRequests: 0,
      maximumAcrossSuccessfulPassRequests: 4,
      compatibilityAttemptAccounting: "provider_reported_only",
    }),
    provenance: "url_citation_intersection",
  }),
});

export function normalizeXNhanProvider(value) {
  return typeof value === "string" && XNHAN_PROVIDER_SET.has(value)
    ? value
    : null;
}

export function resolveOpenRouterModel(value) {
  return isOpenRouterLogicalModel(value) ? value : null;
}

// Kept as pure validators for adapter/unit-test callers. They do not read
// deployment configuration; the production registry uses the release
// constants above.
export function resolveOpenRouterSearchTransport(value) {
  return isOpenRouterSearchTransport(value) ? value : null;
}

export function resolveOpenRouterReasoningEffort(value) {
  return isOpenRouterReasoningEffort(value) ? value : null;
}

export function resolveOpenAiModel(value) {
  return resolveXNhanOpenAiModel(value);
}

/**
 * Resolve the requested provider from the current invocation environment.
 * Keep this lookup request-scoped: Cloudflare can reuse an isolate after a
 * Dashboard Runtime Variable deployment, so a module-level provider/model
 * snapshot would make a model change stale until that isolate is recycled.
 */
export function getXNhanProvider(providerId, env) {
  const provider = normalizeXNhanProvider(providerId);
  if (provider === "openai") {
    const model = resolveOpenAiModel(env.XNHAN_OPENAI_MODEL);
    if (!model) return null;
    return Object.freeze({
      id: "openai",
      model,
      modelDisplayName: resolveXNhanModelDisplayName(
        env.XNHAN_OPENAI_MODEL_DISPLAY_NAME,
      ),
      discoveryPromptVersion: "xnhan-discovery",
      synthesisPromptVersion: "xnhan-synthesis",
      translationPromptVersion: "xnhan-translation",
      apiKeyBinding: env.OPENAI_API_KEY,
      resolveApiKey: resolveOpenAiApiKey,
      search(apiKey, query, options) {
        return searchXPosts(apiKey, query, { ...options, model });
      },
      summarize(apiKey, options) {
        return runXNhanSummary(apiKey, { ...options, model });
      },
      translate(apiKey, options) {
        return runXNhanTranslation(apiKey, {
          ...options,
          model,
          timeoutMs: XNHAN_TRANSLATION_TIMEOUT_MS,
        });
      },
    });
  }

  if (provider === "openrouter") {
    const model = resolveOpenRouterModel(env.XNHAN_OPENROUTER_MODEL);
    const searchTransport = XNHAN_OPENROUTER_RELEASE_SEARCH_TRANSPORT;
    const reasoningEffort = XNHAN_OPENROUTER_RELEASE_REASONING_EFFORT;
    if (!model) return null;
    return Object.freeze({
      id: "openrouter",
      model,
      modelDisplayName: resolveXNhanModelDisplayName(
        env.XNHAN_OPENROUTER_MODEL_DISPLAY_NAME,
      ),
      discoveryPromptVersion: "xnhan-openrouter-discovery",
      synthesisPromptVersion: "xnhan-openrouter-synthesis",
      translationPromptVersion: "xnhan-openrouter-translation",
      capabilityProfile: Object.freeze({
        ...XNHAN_OPENROUTER_CAPABILITY_PROFILES[searchTransport],
        reasoningEffort,
        reasoningPolicy: "model_metadata_intersection",
        structuredOutput: "adaptive",
      }),
      apiKeyBinding: env.OPENROUTER_API_KEY,
      resolveApiKey: resolveOpenRouterApiKey,
      search(apiKey, query, options) {
        return searchXPostsOpenRouter(apiKey, model, query, {
          ...options,
          reasoningEffort,
          searchTransport,
          structuredOutputMode: "auto",
        });
      },
      summarize(apiKey, options) {
        return runXNhanOpenRouterSummary(apiKey, model, {
          ...options,
          reasoningEffort,
          structuredOutputMode: "auto",
        });
      },
      translate(apiKey, options) {
        return runXNhanOpenRouterTranslation(apiKey, model, {
          ...options,
          reasoningEffort,
          structuredOutputMode: "auto",
          timeoutMs: XNHAN_TRANSLATION_TIMEOUT_MS,
        });
      },
    });
  }

  return null;
}
