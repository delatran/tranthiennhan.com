import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  XNHAN_WEBMCP_CONTEXT_MODES,
  XNHAN_WEBMCP_MAX_INDEX_OUTPUT_CHARS,
  XNHAN_WEBMCP_LOCALES,
  XNHAN_WEBMCP_MAX_OUTPUT_CHARS,
  XNHAN_WEBMCP_PROVIDERS,
  XNHAN_WEBMCP_TOOL_NAMES,
  createXNhanWebMcpTools,
  registerXNhanWebMcpTools,
} from "../src/xnhan-webmcp.js";
import {
  commitXNhanWebMcpBridge,
  createXNhanWebMcpActions,
  createXNhanWebMcpLifecycle,
  createXNhanWebMcpSearchStatus,
  isXNhanSearchCompletionVisible,
  publishCompletedXNhanWebMcpSearchStatus,
  resolveXNhanWebMcpHistory,
} from "../src/use-xnhan-webmcp.js";
import { createXNhanSearchStatus } from "../src/xnhan-search-status.js";
import { registerXNhanAboutWebMcpTools } from "../src/xnhan-about-webmcp.js";

const sourcePaths = [
  "../src/xnhan-webmcp.js",
  "../src/xnhan-webmcp-input.js",
  "../src/xnhan-webmcp-results.js",
  "../src/xnhan-webmcp-scheduler.js",
].map((relativePath) => fileURLToPath(new URL(relativePath, import.meta.url)));

function resultItem(overrides = {}) {
  return {
    resultId: "123456789",
    kind: "post",
    authorHandle: "example_user",
    text: "A compact public X post.",
    url: "https://x.com/example_user/status/123456789",
    postedAt: "2026-08-26T07:30:00Z",
    postedAtProvenance: "status_id",
    metrics: {
      replyCount: 2,
      repostCount: 3,
      likeCount: 4,
      viewCount: 5,
    },
    ...overrides,
  };
}

function visibleSnapshot(overrides = {}) {
  return {
    searchId: "search_1",
    revision: 1,
    total: 1,
    observedAt: "2026-08-26T07:31:00Z",
    provider: "openai",
    model: "gpt-5.6-luna",
    answerLocale: "en",
    answerBlocks: [],
    results: [resultItem()],
    ...overrides,
  };
}

function createActions(overrides = {}) {
  return {
    captureXNhanSearchHistory() {
      return [];
    },
    async searchXPosts() {
      return {
        status: "complete",
        searchId: "search_1",
        resultCount: 1,
        provider: "openai",
        model: "gpt-5.6-luna",
      };
    },
    async getCurrentXResults() {
      return visibleSnapshot();
    },
    async getCurrentXResultIndex() {
      return visibleSnapshot();
    },
    async getXNhanSearchStatus() {
      return {
        phase: "complete",
        active: false,
        activeProvider: null,
        visibleSearchId: "search_1",
        visibleResultProvider: "openai",
        visibleResultCount: 1,
      };
    },
    async openXPost(resultId) {
      return {
        status: "navigation_requested",
        resultId,
        url: "https://x.com/example_user/status/123456789",
      };
    },
    async setXNhanLocale(locale) {
      return { status: "changed", locale, path: "/xnhan" };
    },
    async stopXNhanSearch() {
      return { status: "cancelled" };
    },
    async startNewXNhanChat() {
      return { status: "ready", locale: "en", path: "/xnhan", focused: true };
    },
    ...overrides,
  };
}

async function settleWithin(promise, milliseconds = 500) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("WebMCP operation did not settle in time.")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

test("binds WebMCP search completion to immutable result provenance after provider changes", () => {
  const response = {
    requestId: "search_openrouter",
    observedAt: "2026-08-26T07:31:00Z",
    posts: [{ ...resultItem(), id: "123456789" }],
    answerBlocks: [],
    retrieval: {
      provider: "openrouter",
      model: "research-lab/Model.family+fast:beta",
    },
  };
  const snapshot = {
    searchId: null,
    provider: "openai",
    phase: "complete",
    visibleResults: visibleSnapshot({
      searchId: response.requestId,
      provider: response.retrieval.provider,
      model: response.retrieval.model,
    }),
  };
  const expectedTitleId = `xnhan-answer-title-${response.requestId}`;
  const documentObject = {
    getElementById(id) {
      return id === expectedTitleId ? { id, isConnected: true } : null;
    },
  };

  assert.equal(
    isXNhanSearchCompletionVisible(snapshot, response, documentObject),
    true,
  );
  assert.equal(
    isXNhanSearchCompletionVisible(
      { ...snapshot, phase: "loading" },
      response,
      documentObject,
    ),
    false,
  );
  assert.equal(
    isXNhanSearchCompletionVisible(
      {
        ...snapshot,
        visibleResults: {
          ...snapshot.visibleResults,
          results: [{ ...snapshot.visibleResults.results[0], resultId: "987654321" }],
        },
      },
      response,
      documentObject,
    ),
    false,
  );
  assert.equal(
    isXNhanSearchCompletionVisible(snapshot, response, {
      getElementById(id) {
        return id === expectedTitleId ? { id, isConnected: false } : null;
      },
    }),
    false,
  );
});

test("does not complete a prior WebMCP search after New search clears its visible result", () => {
  const response = {
    requestId: "search_before_reset",
    observedAt: "2026-08-26T07:31:00Z",
    posts: [],
    answerBlocks: [],
    retrieval: {
      provider: "openai",
      model: "gpt-5.6-luna",
    },
  };
  const resetSnapshot = {
    searchId: null,
    provider: "openai",
    phase: "idle",
    visibleResults: {
      searchId: null,
      revision: 0,
      total: 0,
      observedAt: null,
      provider: null,
      model: null,
      answerLocale: null,
      answerBlocks: [],
      results: [],
    },
  };
  const staleEmptyTitle = {
    getElementById(id) {
      return id === `xnhan-empty-title-${response.requestId}` ? { id } : null;
    },
  };

  assert.equal(
    isXNhanSearchCompletionVisible(resetSnapshot, response, staleEmptyTitle),
    false,
  );
});

test("publishes completed search status only after its exact result is visible", () => {
  const response = {
    requestId: "search_openrouter",
    observedAt: "2026-08-26T07:31:00Z",
    posts: [{ ...resultItem(), id: "123456789" }],
    answerBlocks: [],
    retrieval: {
      provider: "openrouter",
      model: "research-lab/Model.family+fast:beta",
    },
  };
  const priorResults = visibleSnapshot({ searchId: "search_openai" });
  const statusRef = {
    current: createXNhanWebMcpSearchStatus(
      "searching",
      "openrouter",
      priorResults,
    ),
  };
  const pendingCompletionRef = { current: response };
  const documentObject = {
    getElementById(id) {
      return id === `xnhan-answer-title-${response.requestId}`
        ? { id, isConnected: true }
        : null;
    },
  };

  assert.equal(
    publishCompletedXNhanWebMcpSearchStatus(
      statusRef,
      pendingCompletionRef,
      { phase: "searching", visibleResults: priorResults },
      documentObject,
    ),
    false,
  );
  assert.equal(statusRef.current.phase, "searching");
  assert.equal(pendingCompletionRef.current, response);

  const committedResults = visibleSnapshot({
    searchId: response.requestId,
    provider: response.retrieval.provider,
    model: response.retrieval.model,
  });
  assert.equal(
    publishCompletedXNhanWebMcpSearchStatus(
      statusRef,
      pendingCompletionRef,
      { phase: "complete", visibleResults: committedResults },
      documentObject,
    ),
    true,
  );
  assert.deepEqual(statusRef.current, {
    phase: "complete",
    active: false,
    activeProvider: null,
    visibleSearchId: response.requestId,
    visibleResultProvider: "openrouter",
    visibleResultCount: 1,
  });
  assert.equal(pendingCompletionRef.current, null);
});

test("keeps the WebMCP status export compatible while the domain factory stays neutral", () => {
  assert.equal(createXNhanWebMcpSearchStatus, createXNhanSearchStatus);
  const visibleResults = {
    searchId: "search_openai",
    provider: "openai",
    total: 2,
  };
  const status = createXNhanSearchStatus(
    "searching",
    "openrouter",
    visibleResults,
  );

  assert.deepEqual(status, {
    phase: "searching",
    active: true,
    activeProvider: "openrouter",
    visibleSearchId: "search_openai",
    visibleResultProvider: "openai",
    visibleResultCount: 2,
  });
  assert.equal(Object.isFrozen(status), true);
});

test("invalidates the committed X Nhân bridge before stale tools can start work", async () => {
  const calls = {
    dom: 0,
    locale: 0,
    newChat: 0,
    openPost: 0,
    provider: 0,
    stop: 0,
  };
  const localeActionRef = { current: null };
  const newChatActionRef = { current: null };
  const openPostActionRef = { current: null };
  const searchActionRef = { current: null };
  const stopSearchActionRef = { current: null };
  const snapshotRef = {
    current: {
      locale: "en",
      phase: "idle",
      searchId: null,
      visibleConversationHistory: [],
      visibleResults: visibleSnapshot(),
    },
  };
  const searchStatusRef = {
    current: createXNhanSearchStatus("idle"),
  };
  const bridgeLifecycle = createXNhanWebMcpLifecycle();
  const bridge = commitXNhanWebMcpBridge({
    lifecycle: bridgeLifecycle,
    localeAction: async () => {
      calls.locale += 1;
      return { status: "changed", locale: "vi" };
    },
    localeActionRef,
    newChatAction: async () => {
      calls.newChat += 1;
      return { status: "reset_requested" };
    },
    newChatActionRef,
    openPostAction: async () => {
      calls.openPost += 1;
      return { status: "navigation_requested" };
    },
    openPostActionRef,
    searchAction: async () => {
      calls.provider += 1;
      return null;
    },
    searchActionRef,
    snapshot: snapshotRef.current,
    snapshotRef,
    stopSearchAction: async () => {
      calls.stop += 1;
      return { status: "already_idle" };
    },
    stopSearchActionRef,
  });
  const adapterLifecycle = createXNhanWebMcpLifecycle();
  const actions = createXNhanWebMcpActions({
    lifecycle: adapterLifecycle,
    localeActionRef,
    newChatActionRef,
    openPostActionRef,
    searchActionRef,
    searchStatusRef,
    snapshotRef,
    stopSearchActionRef,
    documentObject: {
      get activeElement() {
        calls.dom += 1;
        return null;
      },
      documentElement: {
        get lang() {
          calls.dom += 1;
          return "en";
        },
      },
      getElementById() {
        calls.dom += 1;
        return null;
      },
    },
    windowObject: { location: { pathname: "/xnhan" } },
  });
  const staleSearch = bridge.actions.search;

  bridgeLifecycle.close();
  bridge.cleanup();
  adapterLifecycle.close();

  assert.equal(localeActionRef.current, null);
  assert.equal(newChatActionRef.current, null);
  assert.equal(openPostActionRef.current, null);
  assert.equal(searchActionRef.current, null);
  assert.equal(stopSearchActionRef.current, null);
  assert.equal(snapshotRef.current, null);
  assert.throws(
    () => actions.captureXNhanSearchHistory("standalone"),
    /xnhan_webmcp_lifecycle_inactive/u,
  );
  for (const invoke of [
    () => actions.searchXPosts("question", "openai", []),
    () => actions.getCurrentXResults({}),
    () => actions.getCurrentXResultIndex({}),
    () => actions.getXNhanSearchStatus({}),
    () => actions.openXPost("123456789", {}),
    () => actions.setXNhanLocale("vi", {}),
    () => actions.stopXNhanSearch({}),
    () => actions.startNewXNhanChat({}),
    () => staleSearch("question", { provider: "openai" }),
  ]) {
    await assert.rejects(invoke(), /xnhan_webmcp_lifecycle_inactive/u);
  }
  assert.deepEqual(calls, {
    dom: 0,
    locale: 0,
    newChat: 0,
    openPost: 0,
    provider: 0,
    stop: 0,
  });
});

test("aborts an in-flight tool on unmount without late state or DOM mutation", async () => {
  const registrations = [];
  const counts = {
    dom: 0,
    providerStarts: 0,
    providerSettles: 0,
    stateMutations: 0,
  };
  let resolveProvider;
  let markProviderStarted;
  let observedSignal = null;
  const providerStarted = new Promise((resolve) => {
    markProviderStarted = resolve;
  });
  const providerResult = new Promise((resolve) => {
    resolveProvider = resolve;
  });
  const response = {
    requestId: "search_1",
    posts: [{ id: "123456789" }],
    retrieval: { provider: "openai", model: "gpt-5.6-luna" },
  };
  const localeActionRef = { current: null };
  const newChatActionRef = { current: null };
  const openPostActionRef = { current: null };
  const searchActionRef = { current: null };
  const stopSearchActionRef = { current: null };
  const snapshotRef = {
    current: {
      locale: "en",
      phase: "searching",
      searchId: null,
      visibleConversationHistory: [],
      visibleResults: visibleSnapshot(),
    },
  };
  const searchStatusRef = {
    current: createXNhanSearchStatus("searching", "openai"),
  };
  const bridgeLifecycle = createXNhanWebMcpLifecycle();
  const bridge = commitXNhanWebMcpBridge({
    lifecycle: bridgeLifecycle,
    localeAction: async () => ({ status: "unchanged", locale: "en" }),
    localeActionRef,
    newChatAction: async () => ({ status: "reset_requested" }),
    newChatActionRef,
    openPostAction: async () => ({ status: "navigation_requested" }),
    openPostActionRef,
    searchAction: async (_question, { signal }) => {
      counts.providerStarts += 1;
      observedSignal = signal;
      markProviderStarted();
      const result = await providerResult;
      counts.providerSettles += 1;
      if (!signal.aborted) counts.stateMutations += 1;
      return result;
    },
    searchActionRef,
    snapshot: snapshotRef.current,
    snapshotRef,
    stopSearchAction: async () => ({ status: "cancel_requested" }),
    stopSearchActionRef,
  });
  const adapterLifecycle = createXNhanWebMcpLifecycle();
  const documentObject = {
    modelContext: {
      registerTool(tool, options) {
        registrations.push({ options, tool });
      },
    },
    get activeElement() {
      counts.dom += 1;
      return null;
    },
    documentElement: { lang: "en" },
    getElementById() {
      counts.dom += 1;
      return null;
    },
  };
  const registration = registerXNhanWebMcpTools({
    actions: createXNhanWebMcpActions({
      lifecycle: adapterLifecycle,
      localeActionRef,
      newChatActionRef,
      openPostActionRef,
      searchActionRef,
      searchStatusRef,
      snapshotRef,
      stopSearchActionRef,
      documentObject,
      windowObject: { location: { pathname: "/xnhan" } },
    }),
    documentObject,
  });
  assert.equal(await registration.ready, true);
  const searchTool = registrations.find(
    ({ tool }) => tool.name === "search_x_posts",
  ).tool;
  const input = {
    question: "What is happening?",
    provider: "openai",
    contextMode: "standalone",
  };
  const pending = searchTool.execute(input);
  await providerStarted;
  assert.equal(counts.providerStarts, 1);

  bridgeLifecycle.close();
  bridge.cleanup();
  adapterLifecycle.close();
  registration.cleanup();
  await assert.rejects(settleWithin(pending), { name: "AbortError" });
  assert.equal(observedSignal.aborted, true);
  assert.equal(counts.stateMutations, 0);
  assert.equal(counts.dom, 0);

  await assert.rejects(searchTool.execute(input));
  assert.equal(counts.providerStarts, 1);
  resolveProvider(response);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(counts.providerSettles, 1);
  assert.equal(counts.stateMutations, 0);
  assert.equal(counts.dom, 0);
});

test("makes WebMCP conversation transfer explicit and standalone-safe", () => {
  const visibleConversationHistory = Object.freeze([
    Object.freeze({
      user: "Prior question handled by OpenRouter",
      assistant: "Bounded prior answer memory",
    }),
  ]);
  const snapshot = { visibleConversationHistory };

  const standalone = resolveXNhanWebMcpHistory("standalone", snapshot);
  assert.deepEqual(standalone, []);
  assert.equal(Object.isFrozen(standalone), true);
  assert.equal(standalone === visibleConversationHistory, false);
  assert.equal(
    resolveXNhanWebMcpHistory("visible_conversation", snapshot),
    visibleConversationHistory,
  );
  assert.throws(
    () => resolveXNhanWebMcpHistory("visible_conversation", {}),
    /visible_conversation_unavailable/u,
  );
});

test("captures visible conversation at tool invocation before queued searches run", async () => {
  let currentHistory = [
    { user: "Initial visible turn", assistant: "Initial bounded memory" },
  ];
  let releaseFirstSearch;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });
  const received = [];
  const tools = createXNhanWebMcpTools(createActions({
    captureXNhanSearchHistory() {
      return currentHistory;
    },
    async searchXPosts(question, provider, historySnapshot) {
      received.push({ question, provider, historySnapshot });
      if (question === "First queued search") {
        markFirstStarted();
        await new Promise((resolve) => {
          releaseFirstSearch = resolve;
        });
      }
      return {
        status: "complete",
        searchId: provider === "openai" ? "search_first" : "search_second",
        resultCount: 0,
        provider,
        model:
          provider === "openai"
            ? "gpt-5.6-luna"
            : "research-lab/Model.family+fast:beta",
      };
    },
  }));

  const first = tools[0].execute({
    question: "First queued search",
    provider: "openai",
    contextMode: "visible_conversation",
  });
  await firstStarted;
  currentHistory = [
    { user: "Visible when second was called", assistant: "Second-call memory" },
  ];
  const second = tools[0].execute({
    question: "Second queued search",
    provider: "openrouter",
    contextMode: "visible_conversation",
  });
  currentHistory = [
    { user: "Later first-search output", assistant: "Must not cross providers" },
  ];
  releaseFirstSearch();
  await Promise.all([first, second]);

  assert.equal(received.length, 2);
  assert.deepEqual(received[1].historySnapshot, [
    { user: "Visible when second was called", assistant: "Second-call memory" },
  ]);
  assert.equal(Object.isFrozen(received[1].historySnapshot), true);
  assert.doesNotMatch(
    JSON.stringify(received[1].historySnapshot),
    /Later first-search output|Must not cross providers/u,
  );
});

test("publishes exactly eight X Nhân tools with strict schemas and bounded annotations", () => {
  assert.deepEqual(XNHAN_WEBMCP_TOOL_NAMES, {
    searchXPosts: "search_x_posts",
    getCurrentXResults: "get_current_x_results",
    requestOpenXPost: "request_open_x_post",
    setXNhanLocale: "set_xnhan_locale",
    stopXNhanSearch: "stop_xnhan_search",
    startNewXNhanChat: "start_new_xnhan_chat",
    getCurrentXResultIndex: "get_current_x_result_index",
    getXNhanSearchStatus: "get_xnhan_search_status",
  });
  assert.deepEqual(XNHAN_WEBMCP_LOCALES, ["en", "vi"]);
  assert.deepEqual(XNHAN_WEBMCP_PROVIDERS, ["openai", "openrouter"]);
  assert.deepEqual(XNHAN_WEBMCP_CONTEXT_MODES, [
    "standalone",
    "visible_conversation",
  ]);
  const tools = createXNhanWebMcpTools(createActions());

  assert.deepEqual(tools.map(({ name }) => name), [
    "search_x_posts",
    "get_current_x_results",
    "request_open_x_post",
    "set_xnhan_locale",
    "stop_xnhan_search",
    "start_new_xnhan_chat",
    "get_current_x_result_index",
    "get_xnhan_search_status",
  ]);
  assert.equal(new Set(tools.map(({ name }) => name)).size, 8);
  const localeTool = tools.find(({ name }) => name === "set_xnhan_locale");
  const searchTool = tools.find(({ name }) => name === "search_x_posts");
  assert.match(localeTool.description, /visible X Nhân interface/u);
  assert.match(localeTool.description, /fallback for genuinely ambiguous/u);
  assert.doesNotMatch(localeTool.description, /subsequent search responses/u);
  assert.match(searchTool.description, /one request from the site's search allowance/u);
  assert.match(searchTool.description, /server-enforced search and inference rate limits/u);
  assert.match(searchTool.description, /never falls back to the other provider/u);
  assert.match(searchTool.description, /include turns produced by another provider/u);
  assert.deepEqual(tools[0].inputSchema, {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "Natural-language question used to find relevant public X posts.",
        minLength: 2,
        maxLength: 400,
      },
      provider: {
        type: "string",
        description: "Provider for this search: OpenAI or OpenRouter.",
        enum: ["openai", "openrouter"],
      },
      contextMode: {
        type: "string",
        description:
          "Context transfer for this call. standalone sends no prior turns. visible_conversation sends the bounded completed conversation currently visible in this tab to the selected provider, including turns produced by another provider when present.",
        enum: ["standalone", "visible_conversation"],
      },
    },
    required: ["question", "provider", "contextMode"],
    additionalProperties: false,
  });
  assert.deepEqual(tools[1].inputSchema, {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  });
  assert.deepEqual(tools[2].inputSchema, {
    type: "object",
    properties: {
      resultId: {
        type: "string",
        description: "Identifier of a currently visible X result to open.",
        minLength: 1,
        maxLength: 30,
        pattern: "^[1-9][0-9]{0,29}$",
      },
    },
    required: ["resultId"],
    additionalProperties: false,
  });
  assert.deepEqual(tools[3].inputSchema, {
    type: "object",
    properties: {
      locale: {
        type: "string",
        description: "Visible interface language: English or Vietnamese.",
        enum: ["en", "vi"],
      },
    },
    required: ["locale"],
    additionalProperties: false,
  });
  for (const tool of tools.slice(4)) {
    assert.deepEqual(tool.inputSchema, {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  }
  assert.deepEqual(tools.map(({ annotations }) => annotations), [
    { readOnlyHint: false, untrustedContentHint: true },
    { readOnlyHint: true, untrustedContentHint: true },
    { readOnlyHint: false, untrustedContentHint: true },
    { readOnlyHint: false, untrustedContentHint: false },
    { readOnlyHint: false, untrustedContentHint: false },
    { readOnlyHint: false, untrustedContentHint: false },
    { readOnlyHint: true, untrustedContentHint: true },
    { readOnlyHint: true, untrustedContentHint: false },
  ]);
  assert.equal(Object.isFrozen(tools), true);
  assert.equal(tools.every(Object.isFrozen), true);
});

test("canonicalizes bounded questions and normalizes action results without leaking private fields", async () => {
  let receivedQuestion;
  let receivedSignal;
  const privateState = { rawHtml: "<script>private</script>" };
  privateState.self = privateState;
  const tools = createXNhanWebMcpTools(createActions({
    async searchXPosts(question, provider, historySnapshot, { signal }) {
      receivedQuestion = question;
      assert.equal(provider, "openrouter");
      assert.deepEqual(historySnapshot, []);
      assert.equal(Object.isFrozen(historySnapshot), true);
      receivedSignal = signal;
      return {
        status: "complete",
        searchId: "search_trimmed",
        resultCount: 0,
        provider,
        model: "research-lab/Model.family+fast:beta",
        privateState,
        availability: "must-not-escape",
      };
    },
  }));

  const output = await tools[0].execute({
    question: "  ＡＩ   na\u0301y\nagents on X?  ",
    provider: "openrouter",
    contextMode: "standalone",
  });
  assert.equal(receivedQuestion, "AI náy agents on X?");
  assert.equal(receivedSignal instanceof AbortSignal, true);
  assert.deepEqual(output, {
    status: "complete",
    searchId: "search_trimmed",
    resultCount: 0,
    provider: "openrouter",
    model: "research-lab/Model.family+fast:beta",
  });
  assert.equal(Object.isFrozen(output), true);
  assert.doesNotMatch(JSON.stringify(output), /private|availability|script/iu);

  const incompleteTools = createXNhanWebMcpTools(createActions({
    async searchXPosts() {
      return {
        status: "started",
        searchId: "search_incomplete",
        resultCount: 0,
        provider: "openai",
        model: "gpt-5.6-luna",
      };
    },
  }));
  await assert.rejects(
    incompleteTools[0].execute({
      question: "Do not report early completion",
      provider: "openai",
      contextMode: "standalone",
    }),
    TypeError,
  );

  const oversizedCountTools = createXNhanWebMcpTools(createActions({
    async searchXPosts() {
      return {
        status: "complete",
        searchId: "search_oversized_count",
        resultCount: 21,
        provider: "openai",
        model: "gpt-5.6-luna",
      };
    },
  }));
  await assert.rejects(
    oversizedCountTools[0].execute({
      question: "Reject an oversized result count",
      provider: "openai",
      contextMode: "standalone",
    }),
    TypeError,
  );

  for (const [provider, model] of [
    ["openai", "author/model"],
    ["openrouter", "glm-only"],
    ["openrouter", "Uppercase-author/model"],
    ["openrouter", "author+suffix/model"],
    ["openrouter", "author/nested/model"],
  ]) {
    const invalidModelTools = createXNhanWebMcpTools(createActions({
      async searchXPosts() {
        return {
          status: "complete",
          searchId: "search_invalid_model",
          resultCount: 0,
          provider,
          model,
        };
      },
    }));
    await assert.rejects(
      invalidModelTools[0].execute({
        question: "Reject an invalid model identifier",
        provider,
        contextMode: "standalone",
      }),
      TypeError,
    );
  }
});

test("enforces the WebMCP question boundary in Unicode code points", async () => {
  const receivedQuestions = [];
  const tools = createXNhanWebMcpTools(createActions({
    async searchXPosts(question, provider) {
      receivedQuestions.push(question);
      return {
        status: "complete",
        searchId: `search_${receivedQuestions.length}`,
        resultCount: 0,
        provider,
        model: "gpt-5.6-luna",
      };
    },
  }));
  const searchTool = tools.find(({ name }) => name === "search_x_posts");
  const input = {
    provider: "openai",
    contextMode: "standalone",
  };
  const fourHundredAstral = "🧠".repeat(400);

  await searchTool.execute({ ...input, question: fourHundredAstral });
  await searchTool.execute({ ...input, question: "a".repeat(400) });
  for (const question of [`${fourHundredAstral}🧠`, "a".repeat(401)]) {
    await assert.rejects(
      searchTool.execute({ ...input, question }),
      TypeError,
    );
  }
  assert.deepEqual(receivedQuestions, [
    fourHundredAstral,
    "a".repeat(400),
  ]);
});

test("normalizes locale transitions and accepts only exact supported X Nhân routes", async () => {
  let receivedLocale;
  const tools = createXNhanWebMcpTools(createActions({
    async setXNhanLocale(locale) {
      receivedLocale = locale;
      return {
        status: "changed",
        locale,
        path: "/xnhan.html",
        privateState: "must-not-escape",
      };
    },
  }));

  const output = await tools[3].execute({ locale: "en" });
  assert.equal(receivedLocale, "en");
  assert.deepEqual(output, {
    status: "changed",
    locale: "en",
    path: "/xnhan.html",
  });
  assert.equal(Object.isFrozen(output), true);
  assert.doesNotMatch(JSON.stringify(output), /private/iu);

  for (const invalidResult of [
    { status: "changed", locale: "vi", path: "/xnhan" },
    { status: "complete", locale: "en", path: "/xnhan" },
    { status: "changed", locale: "en", path: "/xnhan/about" },
    { status: "changed", locale: "en", path: "/xnhan?private_token=LEAK" },
    { status: "changed", locale: "en", path: "/xnhan#draft-secret" },
    { status: "changed", locale: "en", path: "/xnhan?token=LEAK#draft" },
    { status: "changed", locale: "en", path: "/xnhan/" },
    { status: "changed", locale: "en", path: "/xnhan.html?mode=private" },
    { status: "changed", locale: "en", path: "/XNhan" },
  ]) {
    const invalidTools = createXNhanWebMcpTools(createActions({
      async setXNhanLocale() {
        return invalidResult;
      },
    }));
    await assert.rejects(
      invalidTools[3].execute({ locale: "en" }),
      TypeError,
    );
  }
});

test("rejects non-exact, accessor, control-only, and canonical out-of-range inputs before actions", async () => {
  const calls = {
    search: 0,
    visible: 0,
    index: 0,
    status: 0,
    open: 0,
    locale: 0,
    stop: 0,
    reset: 0,
  };
  const [search, visible, open, setLocale, stop, reset] = createXNhanWebMcpTools({
    captureXNhanSearchHistory() {
      return [];
    },
    async searchXPosts() {
      calls.search += 1;
    },
    async getCurrentXResults() {
      calls.visible += 1;
    },
    async getCurrentXResultIndex() {
      calls.index += 1;
    },
    async getXNhanSearchStatus() {
      calls.status += 1;
    },
    async openXPost() {
      calls.open += 1;
    },
    async setXNhanLocale() {
      calls.locale += 1;
    },
    async stopXNhanSearch() {
      calls.stop += 1;
    },
    async startNewXNhanChat() {
      calls.reset += 1;
    },
  });
  const secret = "PRIVATE_INPUT_MUST_NOT_BE_ECHOED";
  const accessorQuestion = {};
  Object.defineProperty(accessorQuestion, "question", {
    enumerable: true,
    get() {
      throw new Error(secret);
    },
  });
  Object.defineProperties(accessorQuestion, {
    provider: { enumerable: true, value: "openai" },
    contextMode: { enumerable: true, value: "standalone" },
  });
  const throwingProxy = new Proxy(
    {
      question: "valid question",
      provider: "openai",
      contextMode: "standalone",
    },
    {
    ownKeys() {
      throw new Error(secret);
    },
    },
  );

  const badQuestions = [
    null,
    [],
    "hello",
    {},
    { question: "x", provider: "openai", contextMode: "standalone" },
    {
      question: "ok",
      provider: "openai",
      contextMode: "standalone",
      extra: true,
    },
    {
      question: "\u0000\u200B",
      provider: "openai",
      contextMode: "standalone",
    },
    {
      question: "x".repeat(401),
      provider: "openai",
      contextMode: "standalone",
    },
    {
      question: "ﬃ".repeat(150),
      provider: "openai",
      contextMode: "standalone",
    },
    {
      question: "valid question",
      provider: "unsupported",
      contextMode: "standalone",
    },
    {
      question: "valid question",
      provider: "openai",
      contextMode: "implicit",
    },
    { question: "valid question" },
    { [Symbol("question")]: "valid question" },
    accessorQuestion,
    throwingProxy,
  ];
  for (const input of badQuestions) {
    await assert.rejects(
      search.execute(input),
      (error) => error instanceof TypeError && !error.message.includes(secret),
    );
  }

  for (const input of [null, [], { extra: true }, { [Symbol("extra")]: true }]) {
    await assert.rejects(visible.execute(input), TypeError);
    await assert.rejects(stop.execute(input), TypeError);
    await assert.rejects(reset.execute(input), TypeError);
  }
  for (const input of [
    null,
    [],
    {},
    { resultId: "" },
    { resultId: "0" },
    { resultId: "0123" },
    { resultId: "result_1" },
    { resultId: "unsafe/id" },
    { resultId: "unsafe.id" },
    { resultId: "9".repeat(31) },
    { resultId: "123456789", extra: true },
  ]) {
    await assert.rejects(open.execute(input), TypeError);
  }
  for (const input of [
    null,
    [],
    {},
    { locale: "fr" },
    { locale: "en", extra: true },
    { [Symbol("locale")]: "en" },
  ]) {
    await assert.rejects(setLocale.execute(input), TypeError);
  }

  assert.deepEqual(calls, {
    search: 0,
    visible: 0,
    open: 0,
    locale: 0,
    stop: 0,
    reset: 0,
    index: 0,
    status: 0,
  });
});

test("preserves numeric zero versus null metrics and emits only compact bounded visible fields", async () => {
  const rawResults = [
    resultItem({
      resultId: "123456789",
      text: "  Zero metrics   remain numeric zero.  ",
      postedAt: "2026-08-26T07:30:00Z",
      metrics: {
        replyCount: 0,
        repostCount: 0,
        likeCount: 0,
        viewCount: 0,
        internalScore: 999,
      },
      claim: "must-not-escape",
    }),
    resultItem({
      resultId: "987654321",
      kind: "unknown",
      authorHandle: "other_user",
      text: "Missing public metrics remain null.",
      url: "https://x.com/other_user/status/987654321",
      postedAt: null,
      postedAtProvenance: "unavailable",
      metrics: {
        replyCount: null,
        repostCount: null,
        likeCount: null,
        viewCount: null,
      },
      status: "must-not-escape",
    }),
  ];
  const tools = createXNhanWebMcpTools(createActions({
    async getCurrentXResults() {
      return visibleSnapshot({
        revision: 8,
        total: 2,
        results: rawResults,
        debug: "must-not-escape",
      });
    },
  }));

  const output = await tools[1].execute({});
  assert.deepEqual(output, {
    searchId: "search_1",
    revision: 8,
    total: 2,
    observedAt: "2026-08-26T07:31:00.000Z",
    provider: "openai",
    model: "gpt-5.6-luna",
    results: [
      {
        resultId: "123456789",
        kind: "post",
        authorHandle: "example_user",
        textExcerpt: "Zero metrics remain numeric zero.",
        textTruncated: false,
        sourceCharacterCount: 33,
        url: "https://x.com/example_user/status/123456789",
        postedAt: "2026-08-26T07:30:00.000Z",
        postedAtProvenance: "status_id",
        metrics: {
          replyCount: 0,
          repostCount: 0,
          likeCount: 0,
          viewCount: 0,
        },
      },
      {
        resultId: "987654321",
        kind: "unknown",
        authorHandle: "other_user",
        textExcerpt: "Missing public metrics remain null.",
        textTruncated: false,
        sourceCharacterCount: 35,
        url: "https://x.com/other_user/status/987654321",
      },
    ],
  });
  assert.ok(JSON.stringify(output).length <= XNHAN_WEBMCP_MAX_OUTPUT_CHARS);
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.results), true);
  assert.equal(Object.isFrozen(output.results[0].metrics), true);
  assert.equal(Object.hasOwn(output, "debug"), false);
  assert.equal(Object.hasOwn(output.results[0], "claim"), false);
  assert.equal(Object.hasOwn(output.results[1], "status"), false);
  assert.equal(Object.hasOwn(output.results[0].metrics, "internalScore"), false);

  for (const invalidResult of [
    resultItem({ postedAt: null, postedAtProvenance: "status_id" }),
    resultItem({ postedAtProvenance: "unavailable" }),
  ]) {
    const invalidTools = createXNhanWebMcpTools(createActions({
      async getCurrentXResults() {
        return visibleSnapshot({ results: [invalidResult] });
      },
    }));
    await assert.rejects(invalidTools[1].execute({}), TypeError);
  }

  const emptyTools = createXNhanWebMcpTools(createActions({
    async getCurrentXResults() {
      return {
        searchId: null,
        revision: 0,
        total: 0,
        observedAt: null,
        provider: null,
        model: null,
        results: [],
      };
    },
  }));
  assert.deepEqual(await emptyTools[1].execute({}), {
    searchId: null,
    revision: 0,
    total: 0,
    observedAt: null,
    provider: null,
    model: null,
    results: [],
  });

  const emptyCompletedTools = createXNhanWebMcpTools(createActions({
    async getCurrentXResults() {
      return visibleSnapshot({
        searchId: "search_empty",
        revision: 9,
        total: 0,
        provider: "openrouter",
        model: "research-lab/Model.family+fast:beta",
        results: [],
      });
    },
  }));
  assert.deepEqual(await emptyCompletedTools[1].execute({}), {
    searchId: "search_empty",
    revision: 9,
    total: 0,
    observedAt: "2026-08-26T07:31:00.000Z",
    provider: "openrouter",
    model: "research-lab/Model.family+fast:beta",
    results: [],
  });

  for (const invalidProvenance of [
    visibleSnapshot({ provider: "unsupported" }),
    visibleSnapshot({ provider: "openrouter", model: "gpt-5.6-luna" }),
    {
      searchId: null,
      revision: 0,
      total: 0,
      observedAt: null,
      provider: "openai",
      model: "gpt-5.6-luna",
      results: [],
    },
  ]) {
    const invalidProvenanceTools = createXNhanWebMcpTools(createActions({
      async getCurrentXResults() {
        return invalidProvenance;
      },
    }));
    await assert.rejects(invalidProvenanceTools[1].execute({}), TypeError);
  }

  const mismatchedTotalTools = createXNhanWebMcpTools(createActions({
    async getCurrentXResults() {
      return visibleSnapshot({ total: 2, results: [resultItem()] });
    },
  }));
  await assert.rejects(mismatchedTotalTools[1].execute({}), TypeError);
});

test("preserves bounded closed natural-answer and answer-block source arrays", async () => {
  const second = resultItem({
    resultId: "987654321",
    authorHandle: "other_user",
    text: "A second corroborating public X post.",
    url: "https://x.com/other_user/status/987654321",
  });
  const provenanceSnapshot = visibleSnapshot({
    total: 2,
    results: [resultItem(), second],
    answer: "Both current X sources support this compact answer.",
    answerSourceIds: ["123456789", "987654321"],
    answerBlocks: [
      {
        resultId: "123456789",
        sourceIds: ["123456789", "987654321"],
        translationStatus: "not_needed",
        mainText: "The sources agree on the reported point.",
        mainLocale: "en",
        retrievedSourceText: "The sources agree on the reported point.",
        retrievedSourceLocale: "en",
      },
    ],
  });
  const tools = createXNhanWebMcpTools(createActions({
    async getCurrentXResults() {
      return provenanceSnapshot;
    },
  }));

  const output = await tools[1].execute({});
  assert.deepEqual(output.answerSourceIds, ["123456789", "987654321"]);
  assert.deepEqual(output.answerBlocks[0].sourceIds, [
    "123456789",
    "987654321",
  ]);
  assert.equal(output.answerBlocks[0].resultId, output.answerBlocks[0].sourceIds[0]);
  assert.equal(Object.isFrozen(output.answerSourceIds), true);
  assert.equal(Object.isFrozen(output.answerBlocks[0].sourceIds), true);
  assert.ok(JSON.stringify(output).length <= XNHAN_WEBMCP_MAX_OUTPUT_CHARS);

  const invalidSnapshots = [
    { ...provenanceSnapshot, answerSourceIds: ["999999999"] },
    {
      ...provenanceSnapshot,
      answerSourceIds: ["123456789", "123456789"],
    },
    {
      ...provenanceSnapshot,
      answerSourceIds: ["987654321", "123456789"],
    },
    {
      ...provenanceSnapshot,
      answerBlocks: [
        { ...provenanceSnapshot.answerBlocks[0], sourceIds: ["999999999"] },
      ],
    },
    {
      ...provenanceSnapshot,
      answerBlocks: [
        {
          ...provenanceSnapshot.answerBlocks[0],
          resultId: "987654321",
        },
      ],
    },
  ];
  for (const invalidSnapshot of invalidSnapshots) {
    const invalidTools = createXNhanWebMcpTools(createActions({
      async getCurrentXResults() {
        return invalidSnapshot;
      },
    }));
    await assert.rejects(invalidTools[1].execute({}), TypeError);
  }
});

test("indexes every current result without full text and exposes only safe search status", async () => {
  const results = Array.from({ length: 20 }, (_, index) => resultItem({
    resultId: String(123456789 + index),
    authorHandle: `author_${index}`,
    text: `Private-to-index full post text ${index}`,
    url: `https://x.com/author_${index}/status/${123456789 + index}`,
  }));
  const snapshot = visibleSnapshot({
    revision: 12,
    total: results.length,
    results,
    answer: "This natural answer must not enter the result index.",
    answerSourceIds: [results[0].resultId],
    answerBlocks: [],
  });
  const tools = createXNhanWebMcpTools(createActions({
    async getCurrentXResultIndex() {
      return snapshot;
    },
    async getXNhanSearchStatus() {
      return {
        phase: "searching",
        active: true,
        activeProvider: "openrouter",
        visibleSearchId: "search_1",
        visibleResultProvider: "openai",
        visibleResultCount: 20,
        question: "must-not-escape",
        reasoning: "must-not-escape",
      };
    },
  }));

  const index = await tools[6].execute({});
  assert.equal(index.results.length, 20);
  assert.deepEqual(
    index.results.map(({ resultId }) => resultId),
    results.map(({ resultId }) => resultId),
  );
  assert.equal(
    index.results.every(
      (item) =>
        !Object.hasOwn(item, "text") &&
        !Object.hasOwn(item, "textExcerpt") &&
        !Object.hasOwn(item, "metrics"),
    ),
    true,
  );
  assert.doesNotMatch(JSON.stringify(index), /Private-to-index|natural answer/iu);
  assert.ok(JSON.stringify(index).length <= XNHAN_WEBMCP_MAX_INDEX_OUTPUT_CHARS);
  assert.equal(Object.isFrozen(index), true);
  assert.equal(Object.isFrozen(index.results), true);

  const status = await tools[7].execute({});
  assert.deepEqual(status, {
    phase: "searching",
    active: true,
    activeProvider: "openrouter",
    visibleSearchId: "search_1",
    visibleResultProvider: "openai",
    visibleResultCount: 20,
  });
  assert.doesNotMatch(JSON.stringify(status), /question|reasoning|must-not-escape/iu);
  assert.equal(Object.isFrozen(status), true);

  const tooManyResults = [...results, resultItem({
    resultId: "999999999",
    authorHandle: "overflow",
    url: "https://x.com/overflow/status/999999999",
  })];
  const oversizedIndexTools = createXNhanWebMcpTools(createActions({
    async getCurrentXResultIndex() {
      return visibleSnapshot({
        total: tooManyResults.length,
        results: tooManyResults,
      });
    },
  }));
  await assert.rejects(oversizedIndexTools[6].execute({}), TypeError);

  for (const invalidStatus of [
    {
      phase: "searching",
      active: false,
      activeProvider: "openai",
      visibleSearchId: null,
      visibleResultProvider: null,
      visibleResultCount: 0,
    },
    {
      phase: "idle",
      active: false,
      activeProvider: null,
      visibleSearchId: null,
      visibleResultProvider: null,
      visibleResultCount: 1,
    },
    {
      phase: "complete",
      active: false,
      activeProvider: null,
      visibleSearchId: "search_1",
      visibleResultProvider: "openai",
      visibleResultCount: 21,
    },
  ]) {
    const invalidStatusTools = createXNhanWebMcpTools(createActions({
      async getXNhanSearchStatus() {
        return invalidStatus;
      },
    }));
    await assert.rejects(invalidStatusTools[7].execute({}), TypeError);
  }
});

test("returns model-controlled markup only as bounded literal untrusted text", async () => {
  const literal =
    '<img src=x onerror="globalThis.compromised=true"><script>unsafe()</script>';
  const tools = createXNhanWebMcpTools(createActions({
    async getCurrentXResults() {
      return visibleSnapshot({
        results: [resultItem({ text: literal })],
      });
    },
  }));

  const output = await tools[1].execute({});
  assert.equal(output.results[0].textExcerpt, literal);
  assert.equal(output.results[0].textTruncated, false);
  assert.equal(output.results[0].sourceCharacterCount, Array.from(literal).length);
  assert.deepEqual(tools[1].annotations, {
    readOnlyHint: true,
    untrustedContentHint: true,
  });
});

test("caps visible output under the WebMCP character budget and limits it to three items", async () => {
  const results = Array.from({ length: 7 }, (_, index) => resultItem({
    resultId: String(123456789 + index),
    text: `\"\\`.repeat(200),
    url: `https://x.com/example_user/status/${123456789 + index}`,
    metrics: {
      replyCount: Number.MAX_SAFE_INTEGER,
      repostCount: Number.MAX_SAFE_INTEGER,
      likeCount: Number.MAX_SAFE_INTEGER,
      viewCount: Number.MAX_SAFE_INTEGER,
    },
  }));
  const tools = createXNhanWebMcpTools(createActions({
    async getCurrentXResults() {
      return visibleSnapshot({ total: results.length, results });
    },
  }));

  const output = await tools[1].execute({});
  assert.equal(output.results.length, 3);
  assert.ok(JSON.stringify(output).length <= XNHAN_WEBMCP_MAX_OUTPUT_CHARS);
  assert.deepEqual(output.results.map(({ resultId }) => resultId), [
    "123456789",
    "123456790",
    "123456791",
  ]);
  assert.equal(
    output.results.every(
      ({ textExcerpt, textTruncated, sourceCharacterCount }) =>
        textExcerpt.length >= 24 &&
        textTruncated === true &&
        sourceCharacterCount === 400,
    ),
    true,
  );
  assert.deepEqual(output.truncation, {
    omittedResults: 4,
    resultReason: "result",
  });
  assert.equal(Object.isFrozen(output.truncation), true);
});

test("reports every text truncation and budget-driven result omission without empty excerpts", async () => {
  const results = Array.from({ length: 3 }, (_, index) => resultItem({
    resultId: String(index + 1).repeat(30),
    authorHandle: "abcdefghijklmno",
    text: `Long external excerpt ${index} `.repeat(80),
    url: `https://x.com/abcdefghijklmno/status/${String(index + 1).repeat(30)}`,
    metrics: {
      replyCount: Number.MAX_SAFE_INTEGER,
      repostCount: Number.MAX_SAFE_INTEGER,
      likeCount: Number.MAX_SAFE_INTEGER,
      viewCount: Number.MAX_SAFE_INTEGER,
    },
  }));
  const tools = createXNhanWebMcpTools(createActions({
    async getCurrentXResults() {
      return visibleSnapshot({
        total: results.length,
        results,
        answer: "A compact synthesis supported by every current source.",
        answerSourceIds: results.map(({ resultId }) => resultId),
        answerBlocks: results.slice(0, 2).map(() => ({
          resultId: results[0].resultId,
          sourceIds: results.map(({ resultId }) => resultId),
          translationStatus: "not_needed",
          mainText: `\"\\`.repeat(200),
          mainLocale: "en",
          retrievedSourceText: `\"\\`.repeat(200),
          retrievedSourceLocale: "en",
        })),
      });
    },
  }));

  const output = await tools[1].execute({});
  assert.ok(JSON.stringify(output).length <= XNHAN_WEBMCP_MAX_OUTPUT_CHARS);
  assert.ok(output.results.length >= 1 && output.results.length < 3);
  assert.equal(
    output.results.every(({ textExcerpt }) => textExcerpt.length >= 24),
    true,
  );
  assert.equal(output.truncation.omittedResults, 3 - output.results.length);
  assert.equal(output.truncation.resultReason, "output");
  assert.equal(
    output.results.every(
      ({ sourceCharacterCount, textExcerpt, textTruncated }) =>
        sourceCharacterCount > Array.from(textExcerpt).length &&
        textExcerpt.length > 0 &&
        textTruncated === true,
    ),
    true,
  );
});

test("labels an excerpt when the omitted suffix reverses the visible statement", async () => {
  const sourceText = `${"A".repeat(80)} NOT TRUE`;
  const tools = createXNhanWebMcpTools(createActions({
    async getCurrentXResults() {
      return visibleSnapshot({
        results: [resultItem({ text: sourceText })],
      });
    },
  }));

  const output = await tools[1].execute({});
  assert.equal(output.results[0].textExcerpt, "A".repeat(80));
  assert.equal(output.results[0].textExcerpt.includes("NOT TRUE"), false);
  assert.equal(output.results[0].textTruncated, true);
  assert.equal(
    output.results[0].sourceCharacterCount,
    Array.from(sourceText).length,
  );
  assert.equal(Object.hasOwn(output, "truncation"), false);
});

test("requires canonical x.com post URLs for visible and opened results", async () => {
  const invalidUrls = [
    "http://x.com/example_user/status/123",
    "https://www.x.com/example_user/status/123",
    "https://x.com.evil.test/example_user/status/123",
    "https://x.com/example_user/status/not-digits",
    "https://x.com/example_user/status/0",
    "https://x.com/example_user/status/123/",
    "https://x.com/example_user/status/123?source=test",
    "https://x.com/example_user/status/123#fragment",
    "javascript:alert(1)",
    "data:text/html,unsafe",
  ];

  for (const url of invalidUrls) {
    const tools = createXNhanWebMcpTools(createActions({
      async openXPost(resultId) {
        return { status: "navigation_requested", resultId, url };
      },
    }));
    await assert.rejects(tools[2].execute({ resultId: "123456789" }), TypeError);
  }

  const mismatchTools = createXNhanWebMcpTools(createActions({
    async getCurrentXResults() {
      return visibleSnapshot({
        results: [resultItem({
          authorHandle: "different_user",
          url: "https://x.com/example_user/status/123456789",
        })],
      });
    },
  }));
  await assert.rejects(mismatchTools[1].execute({}), TypeError);

  const statusMismatchTools = createXNhanWebMcpTools(createActions({
    async getCurrentXResults() {
      return visibleSnapshot({
        results: [resultItem({
          resultId: "123456789",
          url: "https://x.com/example_user/status/987654321",
        })],
      });
    },
    async openXPost(resultId) {
      return {
        status: "navigation_requested",
        resultId,
        url: "https://x.com/example_user/status/987654321",
      };
    },
  }));
  await assert.rejects(statusMismatchTools[1].execute({}), TypeError);
  await assert.rejects(
    statusMismatchTools[2].execute({ resultId: "123456789" }),
    TypeError,
  );

  const validTools = createXNhanWebMcpTools(createActions());
  assert.deepEqual(await validTools[2].execute({ resultId: "123456789" }), {
    status: "navigation_requested",
    resultId: "123456789",
    url: "https://x.com/example_user/status/123456789",
  });

  const longPostId = "9".repeat(30);
  const longIdTools = createXNhanWebMcpTools(createActions({
    async openXPost(resultId) {
      return {
        status: "navigation_requested",
        resultId,
        url: `https://x.com/example_user/status/${longPostId}`,
      };
    },
  }));
  assert.equal(
    (await longIdTools[2].execute({ resultId: longPostId })).url,
    `https://x.com/example_user/status/${longPostId}`,
  );
});

test("serializes mutating tools while the read-only snapshot remains independently callable", async () => {
  const events = [];
  let releaseSearch;
  const searchPending = new Promise((resolve) => {
    releaseSearch = resolve;
  });
  const tools = createXNhanWebMcpTools(createActions({
    async searchXPosts() {
      events.push("search:start");
      await searchPending;
      events.push("search:end");
      return {
        status: "complete",
        searchId: "search_1",
        resultCount: 1,
        provider: "openai",
        model: "gpt-5.6-luna",
      };
    },
    async getCurrentXResults() {
      events.push("visible");
      return visibleSnapshot();
    },
    async openXPost(resultId) {
      events.push("open");
      return {
        status: "navigation_requested",
        resultId,
        url: "https://x.com/example_user/status/123456789",
      };
    },
    async setXNhanLocale(locale) {
      events.push("locale");
      return { status: "changed", locale, path: "/xnhan" };
    },
  }));

  const search = tools[0].execute({
    question: "What is happening?",
    provider: "openai",
    contextMode: "standalone",
  });
  const locale = tools[3].execute({ locale: "en" });
  const open = tools[2].execute({ resultId: "123456789" });
  const visible = tools[1].execute({});
  await Promise.resolve();
  await visible;
  assert.equal(events.includes("search:start"), true);
  assert.equal(events.includes("visible"), true);
  assert.equal(events.includes("locale"), false);
  assert.equal(events.includes("open"), false);

  releaseSearch();
  await search;
  await locale;
  await open;
  assert.ok(events.indexOf("search:start") < events.indexOf("search:end"));
  assert.ok(events.indexOf("search:end") < events.indexOf("locale"));
  assert.ok(events.indexOf("locale") < events.indexOf("open"));
});

test("keeps stop and new-chat controls immediately callable during a long search", async () => {
  let releaseSearch;
  const events = [];
  const searchGate = new Promise((resolve) => {
    releaseSearch = resolve;
  });
  const tools = createXNhanWebMcpTools(createActions({
    async searchXPosts() {
      events.push("search:start");
      await searchGate;
      events.push("search:end");
      return {
        status: "complete",
        searchId: "search_1",
        resultCount: 1,
        provider: "openai",
        model: "gpt-5.6-luna",
      };
    },
    async stopXNhanSearch() {
      events.push("stop");
      return { status: "cancelled", privateState: "must-not-escape" };
    },
    async startNewXNhanChat() {
      events.push("reset");
      return {
        status: "ready",
        locale: "en",
        path: "/xnhan",
        focused: true,
        transcript: "must-not-escape",
      };
    },
  }));

  const search = tools[0].execute({
    question: "Keep this request pending",
    provider: "openai",
    contextMode: "standalone",
  });
  await Promise.resolve();
  assert.deepEqual(await tools[4].execute({}), { status: "cancelled" });
  assert.deepEqual(await tools[5].execute({}), {
    status: "ready",
    locale: "en",
    path: "/xnhan",
    focused: true,
  });
  assert.deepEqual(events, ["search:start", "stop", "reset"]);

  releaseSearch();
  await assert.rejects(search, { name: "AbortError" });
  assert.deepEqual(events, ["search:start", "stop", "reset", "search:end"]);

  for (const invalidStop of [
    { status: "cancel_requested" },
    { status: "complete" },
  ]) {
    const invalidTools = createXNhanWebMcpTools(createActions({
      async stopXNhanSearch() {
        return invalidStop;
      },
    }));
    await assert.rejects(invalidTools[4].execute({}), TypeError);
  }
});

test("supersedes a same-tick queued search before it can start and never reports already idle", async () => {
  let releaseOpen;
  let searchCalls = 0;
  const openGate = new Promise((resolve) => {
    releaseOpen = resolve;
  });
  const tools = createXNhanWebMcpTools(createActions({
    async openXPost(resultId) {
      await openGate;
      return {
        status: "navigation_requested",
        resultId,
        url: "https://x.com/example_user/status/123456789",
      };
    },
    async searchXPosts() {
      searchCalls += 1;
      return {
        status: "complete",
        searchId: "too_late",
        resultCount: 0,
        provider: "openai",
        model: "gpt-5.6-luna",
      };
    },
    async stopXNhanSearch() {
      return { status: "already_idle" };
    },
  }));

  const open = tools[2].execute({ resultId: "123456789" });
  const search = tools[0].execute({
    question: "Do not start after stop",
    provider: "openai",
    contextMode: "standalone",
  });
  const stop = tools[4].execute({});

  assert.deepEqual(await settleWithin(stop), { status: "cancelled" });
  await assert.rejects(settleWithin(search), { name: "AbortError" });
  assert.equal(searchCalls, 0);

  releaseOpen();
  await open;
  await Promise.resolve();
  assert.equal(searchCalls, 0);
});

test("leaves a started search untouched when a control is aborted before execution", async () => {
  let releaseSearch;
  let searchSignal;
  let stopCalls = 0;
  const searchGate = new Promise((resolve) => {
    releaseSearch = resolve;
  });
  const tools = createXNhanWebMcpTools(createActions({
    async searchXPosts(_question, _provider, _historySnapshot, { signal }) {
      searchSignal = signal;
      await searchGate;
      return {
        status: "complete",
        searchId: "search_1",
        resultCount: 1,
        provider: "openai",
        model: "gpt-5.6-luna",
      };
    },
    async stopXNhanSearch() {
      stopCalls += 1;
      return { status: "cancelled" };
    },
  }));

  const search = tools[0].execute({
    question: "Keep this search running",
    provider: "openai",
    contextMode: "standalone",
  });
  await Promise.resolve();
  assert.equal(searchSignal.aborted, false);

  const firstControl = new AbortController();
  const abortedStop = tools[4].execute(
    {},
    { signal: firstControl.signal },
  );
  firstControl.abort();

  await assert.rejects(settleWithin(abortedStop), { name: "AbortError" });
  assert.equal(stopCalls, 0);
  assert.equal(searchSignal.aborted, false);

  releaseSearch();
  assert.deepEqual(await settleWithin(search), {
    status: "complete",
    searchId: "search_1",
    resultCount: 1,
    provider: "openai",
    model: "gpt-5.6-luna",
  });
  assert.equal(searchSignal.aborted, false);
});

test("leaves a scheduled search untouched when a control is aborted before execution", async () => {
  let releaseOpen;
  let searchCalls = 0;
  let stopCalls = 0;
  const openGate = new Promise((resolve) => {
    releaseOpen = resolve;
  });
  const tools = createXNhanWebMcpTools(createActions({
    async openXPost(resultId) {
      await openGate;
      return {
        status: "navigation_requested",
        resultId,
        url: "https://x.com/example_user/status/123456789",
      };
    },
    async searchXPosts() {
      searchCalls += 1;
      return {
        status: "complete",
        searchId: "search_1",
        resultCount: 1,
        provider: "openai",
        model: "gpt-5.6-luna",
      };
    },
    async stopXNhanSearch() {
      stopCalls += 1;
      return { status: "cancelled" };
    },
  }));

  const open = tools[2].execute({ resultId: "123456789" });
  const search = tools[0].execute({
    question: "Run after the queued open",
    provider: "openai",
    contextMode: "standalone",
  });
  const execution = new AbortController();
  const stop = tools[4].execute({}, { signal: execution.signal });
  execution.abort();

  await assert.rejects(settleWithin(stop), { name: "AbortError" });
  assert.equal(stopCalls, 0);
  assert.equal(searchCalls, 0);

  releaseOpen();
  await open;
  assert.deepEqual(await settleWithin(search), {
    status: "complete",
    searchId: "search_1",
    resultCount: 1,
    provider: "openai",
    model: "gpt-5.6-luna",
  });
  assert.equal(searchCalls, 1);
  assert.equal(stopCalls, 0);
});

test("commits cancellation when a control aborts after its action starts", async () => {
  for (const searchState of ["started", "scheduled"]) {
    let releaseOpen;
    let searchSignal;
    let searchCalls = 0;
    let stopCalls = 0;
    const openGate = new Promise((resolve) => {
      releaseOpen = resolve;
    });
    const tools = createXNhanWebMcpTools(createActions({
      async openXPost(resultId) {
        await openGate;
        return {
          status: "navigation_requested",
          resultId,
          url: "https://x.com/example_user/status/123456789",
        };
      },
      async searchXPosts(_question, _provider, _historySnapshot, { signal }) {
        searchCalls += 1;
        searchSignal = signal;
        return await new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            const error = new Error("cancelled");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      },
      async stopXNhanSearch() {
        stopCalls += 1;
        return { status: "cancelled" };
      },
    }));

    const open =
      searchState === "scheduled"
        ? tools[2].execute({ resultId: "123456789" })
        : null;
    const search = tools[0].execute({
      question: `Cancel the ${searchState} search`,
      provider: "openai",
      contextMode: "standalone",
    });
    if (searchState === "started") {
      await Promise.resolve();
      assert.equal(searchCalls, 1);
      assert.equal(searchSignal.aborted, false);
    } else {
      assert.equal(searchCalls, 0);
    }

    const execution = new AbortController();
    const stop = tools[4].execute({}, { signal: execution.signal });
    queueMicrotask(() => execution.abort());

    await assert.rejects(settleWithin(stop), { name: "AbortError" });
    assert.equal(stopCalls, 1);
    if (searchState === "started") {
      assert.equal(searchSignal.aborted, true);
    } else {
      assert.equal(searchCalls, 0);
    }

    if (open) {
      releaseOpen();
      await open;
    }
    await assert.rejects(settleWithin(search), { name: "AbortError" });
    assert.equal(
      searchCalls,
      searchState === "started" ? 1 : 0,
    );
  }
});

test("serializes concurrent stop and new-chat controls without waiting behind search", async () => {
  const events = [];
  let releaseStop;
  let signalStopStarted;
  const stopGate = new Promise((resolve) => {
    releaseStop = resolve;
  });
  const stopStarted = new Promise((resolve) => {
    signalStopStarted = resolve;
  });
  const tools = createXNhanWebMcpTools(createActions({
    async searchXPosts(_question, _provider, _historySnapshot, { signal }) {
      events.push("search:start");
      return await new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          events.push("search:aborted");
          const error = new Error("cancelled");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
    async stopXNhanSearch() {
      events.push("stop:start");
      signalStopStarted();
      await stopGate;
      events.push("stop:end");
      return { status: "cancelled" };
    },
    async startNewXNhanChat() {
      events.push("reset");
      return { status: "ready", locale: "en", path: "/xnhan", focused: true };
    },
  }));

  const search = tools[0].execute({
    question: "Keep search active",
    provider: "openai",
    contextMode: "standalone",
  });
  await Promise.resolve();
  const stop = tools[4].execute({});
  const reset = tools[5].execute({});
  await settleWithin(stopStarted);
  assert.deepEqual(events, ["search:start", "stop:start"]);

  releaseStop();
  const [stopResult, resetResult] = await settleWithin(Promise.all([stop, reset]));
  assert.deepEqual(stopResult, { status: "cancelled" });
  assert.deepEqual(resetResult, {
    status: "ready",
    locale: "en",
    path: "/xnhan",
    focused: true,
  });
  await assert.rejects(settleWithin(search), { name: "AbortError" });
  assert.deepEqual(events, [
    "search:start",
    "stop:start",
    "stop:end",
    "search:aborted",
    "reset",
  ]);

  const reverseEvents = [];
  const reverseTools = createXNhanWebMcpTools(createActions({
    async searchXPosts(_question, _provider, _historySnapshot, { signal }) {
      reverseEvents.push("search:start");
      return await new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          reverseEvents.push("search:aborted");
          const error = new Error("cancelled");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
    async startNewXNhanChat() {
      reverseEvents.push("reset");
      return { status: "ready", locale: "en", path: "/xnhan", focused: true };
    },
    async stopXNhanSearch() {
      reverseEvents.push("stop:idle");
      return { status: "already_idle" };
    },
  }));
  const reverseSearch = reverseTools[0].execute({
    question: "Reset this search",
    provider: "openai",
    contextMode: "standalone",
  });
  await Promise.resolve();
  const resetFirst = reverseTools[5].execute({});
  const stopSecond = reverseTools[4].execute({});
  const [resetFirstResult, stopSecondResult] = await settleWithin(
    Promise.all([resetFirst, stopSecond]),
  );
  assert.deepEqual(resetFirstResult, {
    status: "ready",
    locale: "en",
    path: "/xnhan",
    focused: true,
  });
  assert.deepEqual(stopSecondResult, { status: "already_idle" });
  await assert.rejects(settleWithin(reverseSearch), { name: "AbortError" });
  assert.deepEqual(reverseEvents, [
    "search:start",
    "reset",
    "search:aborted",
    "stop:idle",
  ]);
});

test("starts searches invoked after a control only after that control settles", async () => {
  const events = [];
  let releaseStop;
  let signalStopStarted;
  const stopGate = new Promise((resolve) => {
    releaseStop = resolve;
  });
  const stopStarted = new Promise((resolve) => {
    signalStopStarted = resolve;
  });
  const tools = createXNhanWebMcpTools(createActions({
    async stopXNhanSearch() {
      events.push("stop:start");
      signalStopStarted();
      await stopGate;
      events.push("stop:end");
      return { status: "already_idle" };
    },
    async searchXPosts() {
      events.push("search");
      return {
        status: "complete",
        searchId: "search_after_stop",
        resultCount: 0,
        provider: "openai",
        model: "gpt-5.6-luna",
      };
    },
  }));

  const stop = tools[4].execute({});
  const search = tools[0].execute({
    question: "Run after the stop",
    provider: "openai",
    contextMode: "standalone",
  });
  await settleWithin(stopStarted);
  assert.deepEqual(events, ["stop:start"]);

  releaseStop();
  assert.deepEqual(await settleWithin(stop), { status: "already_idle" });
  assert.deepEqual(await settleWithin(search), {
    status: "complete",
    searchId: "search_after_stop",
    resultCount: 0,
    provider: "openai",
    model: "gpt-5.6-luna",
  });
  assert.deepEqual(events, ["stop:start", "stop:end", "search"]);
});

test("combines per-execution cancellation and lifecycle cleanup with action signals", async () => {
  let directSignal;
  const directTools = createXNhanWebMcpTools(createActions({
    async searchXPosts(_question, _provider, _historySnapshot, { signal }) {
      directSignal = signal;
      return await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("cancelled");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
  }));
  const execution = new AbortController();
  const pendingDirect = directTools[0].execute(
    {
      question: "Cancel this search",
      provider: "openai",
      contextMode: "standalone",
    },
    { signal: execution.signal },
  );
  await Promise.resolve();
  execution.abort();
  await assert.rejects(pendingDirect, { name: "AbortError" });
  assert.equal(directSignal.aborted, true);

  let releaseQueuedSearch;
  let queuedOpenCalls = 0;
  const queuedSearchGate = new Promise((resolve) => {
    releaseQueuedSearch = resolve;
  });
  const queuedTools = createXNhanWebMcpTools(createActions({
    async searchXPosts() {
      await queuedSearchGate;
      return {
        status: "complete",
        searchId: "search_1",
        resultCount: 1,
        provider: "openai",
        model: "gpt-5.6-luna",
      };
    },
    async openXPost(resultId) {
      queuedOpenCalls += 1;
      return {
        status: "navigation_requested",
        resultId,
        url: "https://x.com/example_user/status/123456789",
      };
    },
  }));
  const queuedSearch = queuedTools[0].execute({
    question: "Hold the queue",
    provider: "openai",
    contextMode: "standalone",
  });
  const queuedExecution = new AbortController();
  const queuedOpen = queuedTools[2].execute(
    { resultId: "123456789" },
    { signal: queuedExecution.signal },
  );
  queuedExecution.abort();
  await assert.rejects(queuedOpen, { name: "AbortError" });
  assert.equal(queuedOpenCalls, 0);
  releaseQueuedSearch();
  await queuedSearch;
  await Promise.resolve();
  assert.equal(queuedOpenCalls, 0);

  const registrations = [];
  let registeredSignal;
  const registration = registerXNhanWebMcpTools({
    actions: createActions({
      async searchXPosts(_question, _provider, _historySnapshot, { signal }) {
        registeredSignal = signal;
        return await new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => {
            const error = new Error("cancelled");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      },
    }),
    documentObject: {
      modelContext: {
        registerTool(tool, options) {
          registrations.push({ tool, options });
        },
      },
    },
  });
  assert.equal(await registration.ready, true);
  assert.equal(registrations.length, 8);
  assert.equal(new Set(registrations.map(({ options }) => options.signal)).size, 1);

  const pendingRegistered = registrations[0].tool.execute({
    question: "Cancel on cleanup",
    provider: "openai",
    contextMode: "standalone",
  });
  await Promise.resolve();
  registration.cleanup();
  registration.cleanup();
  await assert.rejects(pendingRegistered, { name: "AbortError" });
  assert.equal(registeredSignal.aborted, true);
  assert.equal(registrations[0].options.signal.aborted, true);
});

test("reference-counts concurrent X Nhân catalog consumers without duplicate tools", async () => {
  const registrations = [];
  const documentObject = {
    modelContext: {
      registerTool(tool, options) {
        registrations.push({ tool, options });
      },
    },
  };
  const first = registerXNhanWebMcpTools({
    actions: createActions(),
    documentObject,
  });
  const second = registerXNhanWebMcpTools({
    actions: createActions(),
    documentObject,
  });

  assert.equal(first.ready, second.ready);
  assert.equal(await first.ready, true);
  assert.equal(registrations.length, 8);
  const lifecycleSignal = registrations[0].options.signal;
  assert.equal(lifecycleSignal.aborted, false);

  first.cleanup();
  first.cleanup();
  assert.equal(lifecycleSignal.aborted, false);
  second.cleanup();
  assert.equal(lifecycleSignal.aborted, true);

  const retry = registerXNhanWebMcpTools({
    actions: createActions(),
    documentObject,
  });
  assert.equal(await retry.ready, true);
  assert.equal(registrations.length, 16);
  retry.cleanup();
});

test("isolates X Nhân and About catalogs that share one model context", async () => {
  const registrations = [];
  const documentObject = {
    modelContext: {
      registerTool(tool, options) {
        registrations.push({ tool, options });
      },
    },
  };
  const xNhan = registerXNhanWebMcpTools({
    actions: createActions(),
    documentObject,
  });
  const about = registerXNhanAboutWebMcpTools({
    actions: {
      async readXNhanAboutOverview() {
        return {
          status: "read",
          locale: "en",
          path: "/xnhan/about",
          title: "About X Nhân",
          hero: {
            eyebrow: "Product note",
            titleLines: ["Why X Nhân", "exists"],
            lede: "A public explanation of the product.",
            thesis: "Original content remains on X.",
          },
          sections: [
            { id: "origin", title: "Origin", highlights: ["A personal need."] },
            {
              id: "principles",
              title: "Principles",
              highlights: ["Useful", "Grounded", "Inspectible"],
            },
            {
              id: "how",
              title: "How it works",
              highlights: ["Ask", "Retrieve", "Synthesize"],
            },
            {
              id: "boundary",
              title: "Boundary",
              highlights: ["A research interface.", "Not the official X API."],
            },
          ],
          routes: { product: "/xnhan?lang=en", portfolio: "/en" },
        };
      },
      async setXNhanAboutLocale(locale) {
        return { status: "changed", locale, path: "/xnhan/about" };
      },
    },
    documentObject,
  });
  assert.equal(await xNhan.ready, true);
  assert.equal(await about.ready, true);
  assert.equal(registrations.length, 10);
  assert.equal(
    new Set(registrations.map(({ tool }) => tool.name)).size,
    10,
  );

  const xNhanSignal = registrations.find(
    ({ tool }) => tool.name === "search_x_posts",
  ).options.signal;
  const aboutSignal = registrations.find(
    ({ tool }) => tool.name === "set_xnhan_about_locale",
  ).options.signal;
  assert.notEqual(xNhanSignal, aboutSignal);
  xNhan.cleanup();
  assert.equal(xNhanSignal.aborted, true);
  assert.equal(aboutSignal.aborted, false);
  about.cleanup();
  assert.equal(aboutSignal.aborted, true);
});

test("keeps a stalled X Nhân registration alive until its final consumer cleans up", async () => {
  const registrations = [];
  const documentObject = {
    modelContext: {
      registerTool(tool, options) {
        registrations.push({ tool, options });
        return new Promise(() => {});
      },
    },
  };
  const first = registerXNhanWebMcpTools({
    actions: createActions(),
    documentObject,
  });
  const second = registerXNhanWebMcpTools({
    actions: createActions(),
    documentObject,
  });
  assert.equal(registrations.length, 1);
  assert.equal(first.ready, second.ready);

  let settled = false;
  void first.ready.then(() => {
    settled = true;
  });
  first.cleanup();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(registrations[0].options.signal.aborted, false);

  second.cleanup();
  assert.equal(await first.ready, false);
  assert.equal(registrations[0].options.signal.aborted, true);
});

test("shares partial X Nhân registration failure and unregisters the partial catalog", async () => {
  const failure = new Error("partial-registration-failure");
  const registrations = [];
  const firstReported = [];
  const secondReported = [];
  let rejectSecondTool;
  let signalSecondTool;
  const secondToolStarted = new Promise((resolve) => {
    signalSecondTool = resolve;
  });
  const documentObject = {
    modelContext: {
      registerTool(tool, options) {
        registrations.push({ tool, options });
        if (registrations.length === 2) {
          return new Promise((_resolve, reject) => {
            rejectSecondTool = reject;
            signalSecondTool();
          });
        }
        return undefined;
      },
    },
  };
  const first = registerXNhanWebMcpTools({
    actions: createActions(),
    documentObject,
    onRegistrationError: (error) => firstReported.push(error),
  });
  const second = registerXNhanWebMcpTools({
    actions: createActions(),
    documentObject,
    onRegistrationError: (error) => secondReported.push(error),
  });
  await settleWithin(secondToolStarted);
  assert.equal(registrations.length, 2);
  rejectSecondTool(failure);

  assert.equal(await first.ready, false);
  assert.equal(await second.ready, false);
  assert.equal(registrations[0].options.signal.aborted, true);
  assert.deepEqual(firstReported, [failure]);
  assert.deepEqual(secondReported, [failure]);
  first.cleanup();
  second.cleanup();
});

test("contains unsupported browsers and synchronous or asynchronous registration failures", async () => {
  for (const documentObject of [
    undefined,
    {},
    { modelContext: {} },
    { modelContext: { registerTool: "not-a-function" } },
  ]) {
    const registration = registerXNhanWebMcpTools({
      actions: createActions(),
      documentObject,
    });
    assert.equal(registration.supported, false);
    assert.equal(await registration.ready, false);
    assert.doesNotThrow(() => {
      registration.cleanup();
      registration.cleanup();
    });
  }

  for (const asynchronous of [false, true]) {
    const failure = new Error(asynchronous ? "async-failure" : "sync-failure");
    const registrations = [];
    const reported = [];
    const registration = registerXNhanWebMcpTools({
      actions: createActions(),
      documentObject: {
        modelContext: {
          registerTool(tool, options) {
            registrations.push({ tool, options });
            if (registrations.length !== 2) return undefined;
            if (asynchronous) return Promise.reject(failure);
            throw failure;
          },
        },
      },
      onRegistrationError: (error) => reported.push(error),
    });

    assert.equal(await registration.ready, false);
    assert.equal(registrations.length, 2);
    assert.equal(registrations[0].options.signal, registrations[1].options.signal);
    assert.equal(registrations[0].options.signal.aborted, true);
    assert.deepEqual(reported, [failure]);
    assert.doesNotThrow(() => registration.cleanup());
  }

  const featureFailure = new Error("feature-failure");
  const reported = [];
  const registration = registerXNhanWebMcpTools({
    actions: createActions(),
    documentObject: Object.defineProperty({}, "modelContext", {
      get() {
        throw featureFailure;
      },
    }),
    onRegistrationError: (error) => reported.push(error),
  });
  assert.equal(registration.supported, false);
  assert.equal(await registration.ready, false);
  assert.deepEqual(reported, [featureFailure]);
});

test("rejects malformed visible results without echoing external payloads", async () => {
  const secret = "EXTERNAL_SECRET_MUST_NOT_BE_ECHOED";
  const malformedMetrics = Object.defineProperty({}, "viewCount", {
    enumerable: true,
    get() {
      throw new Error(secret);
    },
  });
  Object.assign(malformedMetrics, {
    replyCount: 0,
    repostCount: 0,
    likeCount: 0,
  });
  const tools = createXNhanWebMcpTools(createActions({
    async getCurrentXResults() {
      return visibleSnapshot({
        results: [resultItem({ metrics: malformedMetrics })],
      });
    },
  }));
  await assert.rejects(
    tools[1].execute({}),
    (error) => error instanceof TypeError && !error.message.includes(secret),
  );

  const invalidNumbers = [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1];
  for (const metric of invalidNumbers) {
    const invalidTools = createXNhanWebMcpTools(createActions({
      async getCurrentXResults() {
        return visibleSnapshot({
          results: [resultItem({
            metrics: {
              replyCount: metric,
              repostCount: 0,
              likeCount: 0,
              viewCount: 0,
            },
          })],
        });
      },
    }));
    await assert.rejects(invalidTools[1].execute({}), TypeError);
  }
});

test("keeps the pure WebMCP catalog isolated from network, storage, analytics, and Ask Nhân", async () => {
  const source = (
    await Promise.all(sourcePaths.map((sourcePath) => readFile(sourcePath, "utf8")))
  ).join("\n");
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /\bXMLHttpRequest\b/u);
  assert.doesNotMatch(source, /\bsendBeacon\s*\(/u);
  assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB)\b/u);
  assert.doesNotMatch(source, /\bdocument\s*\.\s*cookie\b/u);
  assert.doesNotMatch(source, /\banalytics\b/iu);
  assert.doesNotMatch(source, /\/api\/ask/iu);
  assert.doesNotMatch(source, /claim(?:s|_status)?/iu);
});
