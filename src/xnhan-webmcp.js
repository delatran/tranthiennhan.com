import { registerImperativeWebMcpCatalog } from "./webmcp-registration.js";
import {
  XNHAN_WEBMCP_CONTEXT_MODES,
  XNHAN_WEBMCP_EMPTY_INPUT_SCHEMA,
  XNHAN_WEBMCP_LOCALE_INPUT_SCHEMA,
  XNHAN_WEBMCP_LOCALES,
  XNHAN_WEBMCP_OPEN_POST_INPUT_SCHEMA,
  XNHAN_WEBMCP_PROVIDERS,
  XNHAN_WEBMCP_SEARCH_INPUT_SCHEMA,
  XNHAN_WEBMCP_TOOL_NAMES,
  captureSearchHistory,
  requireAction,
  validateExactInput,
  validateLocale,
  validateResultId,
  validateSearchInput,
} from "./xnhan-webmcp-input.js";
import {
  XNHAN_WEBMCP_MAX_INDEX_OUTPUT_CHARS,
  XNHAN_WEBMCP_MAX_OUTPUT_CHARS,
  normalizeLocaleResult,
  normalizeNewChatResult,
  normalizeOpenResult,
  normalizeResultIndex,
  normalizeSearchResult,
  normalizeSearchStatus,
  normalizeStopResult,
  normalizeVisibleResults,
} from "./xnhan-webmcp-results.js";
import {
  createActionRunners,
  createDetachedSignal,
} from "./xnhan-webmcp-scheduler.js";

export {
  XNHAN_WEBMCP_CONTEXT_MODES,
  XNHAN_WEBMCP_LOCALES,
  XNHAN_WEBMCP_MAX_INDEX_OUTPUT_CHARS,
  XNHAN_WEBMCP_MAX_OUTPUT_CHARS,
  XNHAN_WEBMCP_PROVIDERS,
  XNHAN_WEBMCP_TOOL_NAMES,
};

const XNHAN_WEBMCP_CATALOG = Object.freeze({ name: "xnhan" });

const MUTATING_EXTERNAL_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  untrustedContentHint: true,
});
const READ_ONLY_EXTERNAL_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  untrustedContentHint: true,
});
const MUTATING_LOCAL_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  untrustedContentHint: false,
});
const READ_ONLY_LOCAL_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  untrustedContentHint: false,
});

export function createXNhanWebMcpTools(actions, options = {}) {
  const captureXNhanSearchHistory = requireAction(
    actions,
    "captureXNhanSearchHistory",
  );
  const searchXPosts = requireAction(actions, "searchXPosts");
  const getCurrentXResults = requireAction(actions, "getCurrentXResults");
  const getCurrentXResultIndex = requireAction(actions, "getCurrentXResultIndex");
  const getXNhanSearchStatus = requireAction(actions, "getXNhanSearchStatus");
  const openXPost = requireAction(actions, "openXPost");
  const setXNhanLocale = requireAction(actions, "setXNhanLocale");
  const stopXNhanSearch = requireAction(actions, "stopXNhanSearch");
  const startNewXNhanChat = requireAction(actions, "startNewXNhanChat");
  const lifecycleSignal = options.signal ?? createDetachedSignal();
  const { runControl, runMutation, runRead, runSearch } =
    createActionRunners(lifecycleSignal);

  return Object.freeze([
    Object.freeze({
      name: XNHAN_WEBMCP_TOOL_NAMES.searchXPosts,
      title: "Search X posts",
      description:
        "Complete a live public X search through the explicitly selected OpenAI or OpenRouter provider. Each call uses one request from the site's search allowance and is subject to server-enforced search and inference rate limits. X Nhân returns the selected provider and server-configured model and never falls back to the other provider. contextMode standalone sends no prior turns; visible_conversation deliberately transfers the bounded completed conversation visible in this tab to the selected provider, which can include turns produced by another provider.",
      inputSchema: XNHAN_WEBMCP_SEARCH_INPUT_SCHEMA,
      annotations: MUTATING_EXTERNAL_ANNOTATIONS,
      async execute(input, { signal: executionSignal } = {}) {
        const { contextMode, provider, question } = validateSearchInput(input);
        const historySnapshot = captureSearchHistory(
          captureXNhanSearchHistory,
          contextMode,
        );
        return await runSearch(
          searchXPosts,
          [question, provider, historySnapshot],
          executionSignal,
          normalizeSearchResult,
        );
      },
    }),
    Object.freeze({
      name: XNHAN_WEBMCP_TOOL_NAMES.getCurrentXResults,
      title: "Get current X results",
      description:
        "Read the compact current completed X result set and visible answer-language snapshot in X Nhân without starting or changing a search. Natural-answer answerSourceIds and each answer block's sourceIds are bounded and validated against the complete current result catalog; use get_current_x_result_index to resolve IDs omitted from this compact excerpt. Machine translations and retrieved source-language excerpts or synopses are returned as untrusted text with explicit locale and translation status; results remain available when their on-page source disclosure is closed.",
      inputSchema: XNHAN_WEBMCP_EMPTY_INPUT_SCHEMA,
      annotations: READ_ONLY_EXTERNAL_ANNOTATIONS,
      async execute(input, { signal: executionSignal } = {}) {
        validateExactInput(input, []);
        return await runRead(
          getCurrentXResults,
          [],
          executionSignal,
          normalizeVisibleResults,
        );
      },
    }),
    Object.freeze({
      name: XNHAN_WEBMCP_TOOL_NAMES.requestOpenXPost,
      title: "Request opening X post",
      description:
        "Request a new browser context for the canonical x.com status page of a result in the current X Nhân result set, including results enumerated by get_current_x_result_index; the result confirms the validated navigation request, not that x.com finished loading.",
      inputSchema: XNHAN_WEBMCP_OPEN_POST_INPUT_SCHEMA,
      annotations: MUTATING_EXTERNAL_ANNOTATIONS,
      async execute(input, { signal: executionSignal } = {}) {
        const resultId = validateResultId(input);
        return await runMutation(
          openXPost,
          [resultId],
          executionSignal,
          (result) => normalizeOpenResult(result, resultId),
        );
      },
    }),
    Object.freeze({
      name: XNHAN_WEBMCP_TOOL_NAMES.setXNhanLocale,
      title: "Set X Nhân locale",
      description:
        "Switch the visible X Nhân interface between Vietnamese and English without starting a search. A confidently English or Vietnamese question determines its own answer language; this locale is only the fallback for genuinely ambiguous or balanced mixed-language questions. Locale changes are unavailable while a search is in progress.",
      inputSchema: XNHAN_WEBMCP_LOCALE_INPUT_SCHEMA,
      annotations: MUTATING_LOCAL_ANNOTATIONS,
      async execute(input, { signal: executionSignal } = {}) {
        const locale = validateLocale(input);
        return await runMutation(
          setXNhanLocale,
          [locale],
          executionSignal,
          (result) => normalizeLocaleResult(result, locale),
        );
      },
    }),
    Object.freeze({
      name: XNHAN_WEBMCP_TOOL_NAMES.stopXNhanSearch,
      title: "Stop X Nhân search",
      description:
        "Cancel the X Nhân search currently visible in this tab, wait for its cancelled state, and leave completed earlier turns intact; return already_idle when no search is active.",
      inputSchema: XNHAN_WEBMCP_EMPTY_INPUT_SCHEMA,
      annotations: MUTATING_LOCAL_ANNOTATIONS,
      async execute(input, { signal: executionSignal } = {}) {
        validateExactInput(input, []);
        return await runControl(
          stopXNhanSearch,
          [],
          executionSignal,
          normalizeStopResult,
        );
      },
    }),
    Object.freeze({
      name: XNHAN_WEBMCP_TOOL_NAMES.startNewXNhanChat,
      title: "Start new X Nhân chat",
      description:
        "Cancel any active X Nhân search, clear the visible in-memory transcript and draft in this tab, restore ordinary on-page searches to the OpenRouter default, and focus the empty question input; this does not delete provider-retained responses.",
      inputSchema: XNHAN_WEBMCP_EMPTY_INPUT_SCHEMA,
      annotations: MUTATING_LOCAL_ANNOTATIONS,
      async execute(input, { signal: executionSignal } = {}) {
        validateExactInput(input, []);
        return await runControl(
          startNewXNhanChat,
          [],
          executionSignal,
          normalizeNewChatResult,
        );
      },
    }),
    Object.freeze({
      name: XNHAN_WEBMCP_TOOL_NAMES.getCurrentXResultIndex,
      title: "Get current X result index",
      description:
        "Read a compact index of every result in the current completed X Nhân result set, up to the product's current result limit, without returning post or answer text. Use each resultId with request_open_x_post. Author handles and canonical X URLs are external untrusted data.",
      inputSchema: XNHAN_WEBMCP_EMPTY_INPUT_SCHEMA,
      annotations: READ_ONLY_EXTERNAL_ANNOTATIONS,
      async execute(input, { signal: executionSignal } = {}) {
        validateExactInput(input, []);
        return await runRead(
          getCurrentXResultIndex,
          [],
          executionSignal,
          normalizeResultIndex,
        );
      },
    }),
    Object.freeze({
      name: XNHAN_WEBMCP_TOOL_NAMES.getXNhanSearchStatus,
      title: "Get X Nhân search status",
      description:
        "Read only the safe current X Nhân search phase, whether a search is active, the active provider when applicable, and the identifier, provider, and count of any completed result set still visible. Active-request and visible-result provenance are separate. This tool never returns the question, transcript, answer, source text, provider prompts, tool activity, or internal reasoning.",
      inputSchema: XNHAN_WEBMCP_EMPTY_INPUT_SCHEMA,
      annotations: READ_ONLY_LOCAL_ANNOTATIONS,
      async execute(input, { signal: executionSignal } = {}) {
        validateExactInput(input, []);
        return await runRead(
          getXNhanSearchStatus,
          [],
          executionSignal,
          normalizeSearchStatus,
        );
      },
    }),
  ]);
}

export function registerXNhanWebMcpTools({
  actions,
  documentObject = globalThis.document,
  onRegistrationError,
} = {}) {
  return registerImperativeWebMcpCatalog({
    catalogKey: XNHAN_WEBMCP_CATALOG,
    createTools: (signal) => createXNhanWebMcpTools(actions, { signal }),
    documentObject,
    onRegistrationError,
  });
}
