import { useLayoutEffect } from "react";

import { isXNhanPath } from "../shared/xnhan.js";
import { waitForWebMcpState } from "./webmcp.js";
import { createXNhanSearchStatus } from "./xnhan-search-status.js";
import { registerXNhanWebMcpTools } from "./xnhan-webmcp.js";

export {
  createXNhanSearchStatus as createXNhanWebMcpSearchStatus,
} from "./xnhan-search-status.js";

const EMPTY_WEBMCP_HISTORY = Object.freeze([]);

export function createCompletedXNhanWebMcpSearchStatus(response) {
  return createXNhanSearchStatus(
    response.posts.length > 0 ? "complete" : "empty",
    null,
    {
      searchId: response.requestId,
      provider: response.retrieval.provider,
      total: response.posts.length,
    },
  );
}

function requireCurrentAction(reference, code) {
  const action = reference?.current;
  if (typeof action !== "function") throw new Error(code);
  return action;
}

export function resolveXNhanWebMcpHistory(contextMode, snapshot) {
  if (contextMode === "standalone") return EMPTY_WEBMCP_HISTORY;
  if (
    contextMode === "visible_conversation" &&
    Array.isArray(snapshot?.visibleConversationHistory)
  ) {
    return snapshot.visibleConversationHistory;
  }
  throw new Error("xnhan_visible_conversation_unavailable");
}

function sameStringArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameAnswerProvenance(visibleResults, response) {
  const responseAnswerSourceIds = Array.isArray(response?.answerSourceIds)
    ? response.answerSourceIds
    : [];
  const visibleAnswerSourceIds = Array.isArray(visibleResults?.answerSourceIds)
    ? visibleResults.answerSourceIds
    : [];
  if (!sameStringArray(visibleAnswerSourceIds, responseAnswerSourceIds)) {
    return false;
  }

  const responseBlocks = Array.isArray(response?.answerBlocks)
    ? response.answerBlocks
    : [];
  const visibleBlocks = Array.isArray(visibleResults?.answerBlocks)
    ? visibleResults.answerBlocks
    : [];
  return (
    visibleBlocks.length === responseBlocks.length &&
    visibleBlocks.every((block, index) =>
      sameStringArray(block?.sourceIds, responseBlocks[index]?.sourceIds))
  );
}

export function isXNhanSearchCompletionVisible(
  snapshot,
  response,
  documentObject = globalThis.document,
) {
  const visibleResults = snapshot?.visibleResults;
  const resultCount = Array.isArray(response?.posts) ? response.posts.length : -1;
  const expectedPhase = resultCount > 0 ? "complete" : "empty";
  const responseResultIds = Array.isArray(response?.posts)
    ? response.posts.map(({ id }) => id)
    : [];
  const visibleResultIds = Array.isArray(visibleResults?.results)
    ? visibleResults.results.map(({ resultId }) => resultId)
    : [];
  if (
    snapshot?.phase !== expectedPhase ||
    visibleResults?.searchId !== response?.requestId ||
    visibleResults?.provider !== response?.retrieval?.provider ||
    visibleResults?.model !== response?.retrieval?.model ||
    visibleResults?.observedAt !== response?.observedAt ||
    !Number.isSafeInteger(visibleResults?.revision) ||
    visibleResults.revision < 1 ||
    visibleResults?.total !== resultCount ||
    !sameStringArray(visibleResultIds, responseResultIds) ||
    !sameAnswerProvenance(visibleResults, response)
  ) {
    return false;
  }

  const titleId = resultCount > 0
    ? `xnhan-answer-title-${response.requestId}`
    : `xnhan-empty-title-${response.requestId}`;
  const title = documentObject?.getElementById?.(titleId);
  return Boolean(title && title.isConnected !== false);
}

export function publishCompletedXNhanWebMcpSearchStatus(
  statusRef,
  pendingCompletionRef,
  snapshot,
  documentObject = globalThis.document,
) {
  const response = pendingCompletionRef?.current;
  if (
    !response ||
    !isXNhanSearchCompletionVisible(snapshot, response, documentObject)
  ) {
    return false;
  }
  statusRef.current = createCompletedXNhanWebMcpSearchStatus(response);
  pendingCompletionRef.current = null;
  return true;
}

export function createXNhanWebMcpLifecycle() {
  let active = true;
  return Object.freeze({
    close() {
      active = false;
    },
    requireActive() {
      if (!active) throw new Error("xnhan_webmcp_lifecycle_inactive");
    },
  });
}

function createCommittedAction(action, lifecycle, code) {
  if (typeof action !== "function") throw new TypeError(code);
  return async (...args) => {
    lifecycle.requireActive();
    const result = await action(...args);
    lifecycle.requireActive();
    return result;
  };
}

export function commitXNhanWebMcpBridge({
  lifecycle,
  localeAction,
  localeActionRef,
  newChatAction,
  newChatActionRef,
  openPostAction,
  openPostActionRef,
  searchAction,
  searchActionRef,
  snapshot,
  snapshotRef,
  stopSearchAction,
  stopSearchActionRef,
}) {
  if (typeof lifecycle?.requireActive !== "function") {
    throw new TypeError("Invalid X Nhân committed bridge lifecycle.");
  }
  const actions = Object.freeze({
    locale: createCommittedAction(
      localeAction,
      lifecycle,
      "Invalid X Nhân locale bridge action.",
    ),
    newChat: createCommittedAction(
      newChatAction,
      lifecycle,
      "Invalid X Nhân new-chat bridge action.",
    ),
    openPost: createCommittedAction(
      openPostAction,
      lifecycle,
      "Invalid X Nhân open-post bridge action.",
    ),
    search: createCommittedAction(
      searchAction,
      lifecycle,
      "Invalid X Nhân search bridge action.",
    ),
    stopSearch: createCommittedAction(
      stopSearchAction,
      lifecycle,
      "Invalid X Nhân stop-search bridge action.",
    ),
  });

  localeActionRef.current = actions.locale;
  newChatActionRef.current = actions.newChat;
  openPostActionRef.current = actions.openPost;
  searchActionRef.current = actions.search;
  stopSearchActionRef.current = actions.stopSearch;
  snapshotRef.current = snapshot;

  return Object.freeze({
    actions,
    cleanup() {
      if (localeActionRef.current === actions.locale) {
        localeActionRef.current = null;
      }
      if (newChatActionRef.current === actions.newChat) {
        newChatActionRef.current = null;
      }
      if (openPostActionRef.current === actions.openPost) {
        openPostActionRef.current = null;
      }
      if (searchActionRef.current === actions.search) {
        searchActionRef.current = null;
      }
      if (stopSearchActionRef.current === actions.stopSearch) {
        stopSearchActionRef.current = null;
      }
      if (snapshotRef.current === snapshot) snapshotRef.current = null;
    },
  });
}

export function createXNhanWebMcpActions({
  lifecycle,
  localeActionRef,
  newChatActionRef,
  openPostActionRef,
  searchActionRef,
  searchStatusRef,
  snapshotRef,
  stopSearchActionRef,
  documentObject = globalThis.document,
  windowObject = globalThis.window,
}) {
  if (typeof lifecycle?.requireActive !== "function") {
    throw new TypeError("Invalid X Nhân WebMCP lifecycle.");
  }
  const requireActive = () => lifecycle.requireActive();

  return Object.freeze({
    captureXNhanSearchHistory(contextMode) {
      requireActive();
      return resolveXNhanWebMcpHistory(contextMode, snapshotRef.current);
    },

    async searchXPosts(question, provider, historySnapshot, { signal } = {}) {
      requireActive();
      const search = requireCurrentAction(
        searchActionRef,
        "xnhan_search_action_unavailable",
      );
      requireActive();
      const response = await search(question, {
        provider,
        historySnapshot,
        signal,
      });
      requireActive();
      if (!response) throw new Error("xnhan_search_not_completed");

      await waitForWebMcpState(
        () => {
          requireActive();
          return isXNhanSearchCompletionVisible(
            snapshotRef.current,
            response,
            documentObject,
          );
        },
        { signal },
      );
      requireActive();

      return {
        status: "complete",
        searchId: response.requestId,
        resultCount: response.posts.length,
        provider: response.retrieval.provider,
        model: response.retrieval.model,
      };
    },

    async getCurrentXResults({ signal } = {}) {
      requireActive();
      if (signal?.aborted) {
        const error = new Error("X Nhân visible-result read was aborted.");
        error.name = "AbortError";
        throw error;
      }
      const snapshot = snapshotRef.current;
      if (!snapshot) throw new Error("xnhan_snapshot_unavailable");
      requireActive();
      return snapshot.visibleResults;
    },

    async getCurrentXResultIndex({ signal } = {}) {
      requireActive();
      if (signal?.aborted) {
        const error = new Error("X Nhân result-index read was aborted.");
        error.name = "AbortError";
        throw error;
      }
      const snapshot = snapshotRef.current;
      if (!snapshot) throw new Error("xnhan_snapshot_unavailable");
      requireActive();
      return snapshot.visibleResults;
    },

    async getXNhanSearchStatus({ signal } = {}) {
      requireActive();
      if (signal?.aborted) {
        const error = new Error("X Nhân search-status read was aborted.");
        error.name = "AbortError";
        throw error;
      }
      const searchStatus = searchStatusRef?.current;
      if (!searchStatus) throw new Error("xnhan_search_status_unavailable");
      requireActive();
      return searchStatus;
    },

    async openXPost(resultId, { signal } = {}) {
      requireActive();
      const openPost = requireCurrentAction(
        openPostActionRef,
        "xnhan_open_post_action_unavailable",
      );
      requireActive();
      const result = await openPost(resultId, { signal });
      requireActive();
      if (!result) throw new Error("xnhan_post_not_opened");
      return result;
    },

    async setXNhanLocale(nextLocale, { signal } = {}) {
      requireActive();
      const setLocale = requireCurrentAction(
        localeActionRef,
        "xnhan_locale_action_unavailable",
      );
      requireActive();
      const transition = await setLocale(nextLocale, { signal });
      requireActive();
      if (!transition) throw new Error("xnhan_locale_not_changed");

      await waitForWebMcpState(
        () => {
          requireActive();
          return (
            snapshotRef.current?.locale === nextLocale &&
            documentObject.documentElement.lang === nextLocale
          );
        },
        { signal },
      );
      requireActive();

      return {
        status: transition.status,
        locale: nextLocale,
        path: windowObject.location.pathname,
      };
    },

    async stopXNhanSearch({ signal } = {}) {
      requireActive();
      const stopSearch = requireCurrentAction(
        stopSearchActionRef,
        "xnhan_stop_search_action_unavailable",
      );
      requireActive();
      const transition = await stopSearch({ signal });
      requireActive();
      if (!transition) throw new Error("xnhan_stop_search_not_completed");
      if (transition.status === "already_idle") {
        return { status: "already_idle" };
      }
      if (transition.status !== "cancel_requested") {
        throw new Error("xnhan_stop_search_not_completed");
      }

      await waitForWebMcpState(
        () => {
          requireActive();
          return snapshotRef.current?.phase === "cancelled";
        },
        { signal },
      );
      requireActive();
      return { status: "cancelled" };
    },

    async startNewXNhanChat({ signal } = {}) {
      requireActive();
      const startNewChat = requireCurrentAction(
        newChatActionRef,
        "xnhan_new_chat_action_unavailable",
      );
      requireActive();
      const transition = await startNewChat({ signal });
      requireActive();
      if (transition?.status !== "reset_requested") {
        throw new Error("xnhan_new_chat_not_completed");
      }

      await waitForWebMcpState(
        () => {
          requireActive();
          return (
            snapshotRef.current?.phase === "idle" &&
            snapshotRef.current?.searchId === null &&
            snapshotRef.current?.visibleResults?.total === 0 &&
            documentObject.activeElement ===
              documentObject.getElementById("xnhan-query")
          );
        },
        { signal },
      );
      requireActive();
      return {
        status: "ready",
        locale: snapshotRef.current.locale,
        path: windowObject.location.pathname,
        focused: true,
      };
    },
  });
}

export function useXNhanWebMcp({
  localeActionRef,
  newChatActionRef,
  openPostActionRef,
  searchActionRef,
  searchStatusRef,
  snapshotRef,
  stopSearchActionRef,
}) {
  useLayoutEffect(() => {
    if (!isXNhanPath(window.location.pathname)) return undefined;

    const lifecycle = createXNhanWebMcpLifecycle();
    const registration = registerXNhanWebMcpTools({
      actions: createXNhanWebMcpActions({
        lifecycle,
        localeActionRef,
        newChatActionRef,
        openPostActionRef,
        searchActionRef,
        searchStatusRef,
        snapshotRef,
        stopSearchActionRef,
      }),
    });

    return () => {
      lifecycle.close();
      registration.cleanup();
    };
  }, [
    localeActionRef,
    newChatActionRef,
    openPostActionRef,
    searchActionRef,
    searchStatusRef,
    snapshotRef,
    stopSearchActionRef,
  ]);
}
