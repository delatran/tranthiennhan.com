import { useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  buildXNhanConversationHistory,
  normalizeXNhanConversationHistory,
  readXNhanSearchQuery,
  XNHAN_CONVERSATION_MAX_TURNS,
} from "../shared/xnhan.js";
import { resolveAnswerLocale } from "./answer-language.js";
import {
  XNHAN_DEFAULT_PROVIDER,
  XNHAN_LOCALES,
  XNHAN_PROVIDERS,
  xnhanContent,
} from "./xnhan-content.js";
import {
  createXNhanChatTurn,
  reduceXNhanTurns,
} from "./xnhan-session-state.js";
import {
  createXNhanSearchError,
  executeXNhanSearchRequest,
} from "./xnhan-search-request.js";
import {
  classifyXNhanSearchFailure,
  isCurrentXNhanSearchRequest,
  scheduleXNhanSearchTimeout,
  XNHAN_REQUEST_TIMEOUT_MS,
} from "./xnhan-search-lifecycle.js";
import { createXNhanSearchStatus } from "./xnhan-search-status.js";

export { XNHAN_REQUEST_TIMEOUT_MS };
const XNHAN_MAX_CHAT_TURNS = XNHAN_CONVERSATION_MAX_TURNS + 1;

function localizedError(error, copy, provider) {
  const providerName = copy.providers[provider].name;
  const message =
    error?.code === "timeout"
      ? copy.errors.timeout
      : error?.code === "rateLimited"
        ? copy.errors.rateLimited
        : error?.code === "invalidResponse"
          ? copy.errors.invalidResponse
          : copy.errors.generic[provider];
  return `${message} ${copy.errors.noFallback(providerName)}`;
}

export function useXNhanSearchSession({
  inputRef,
  locale,
  onSearchStarted,
  snapshotRef,
}) {
  const [query, setQuery] = useState("");
  const [turns, setTurns] = useState([]);
  const requestRef = useRef(null);
  const requestTimeoutRef = useRef(null);
  const userCancelledRequestRef = useRef(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(false);
  const turnsRef = useRef([]);
  const webMcpSearchStatusRef = useRef(createXNhanSearchStatus("idle"));
  const webMcpPendingCompletionRef = useRef(null);
  const webMcpRevisionRef = useRef(0);

  const commitTurns = useCallback((event) => {
    const nextTurns = reduceXNhanTurns(turnsRef.current, event);
    turnsRef.current = nextTurns;
    setTurns(nextTurns);
    return nextTurns;
  }, []);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
      requestRef.current = null;
      userCancelledRequestRef.current = null;
      inFlightRef.current = false;
      window.clearTimeout(requestTimeoutRef.current);
    };
  }, []);

  const startSearch = useCallback(
    async (
      requestedQuery = query,
      {
        answerLocale: requestedAnswerLocale,
        historySnapshot,
        signal,
        provider: requestedProvider = XNHAN_DEFAULT_PROVIDER,
      } = {},
    ) => {
      if (!mountedRef.current) return false;
      const { normalizedQuery: clean, valid: queryIsValid } =
        readXNhanSearchQuery(requestedQuery);
      if (signal?.aborted) {
        const error = new Error("X Nhân search was aborted.");
        error.name = "AbortError";
        throw error;
      }
      if (
        !queryIsValid ||
        !XNHAN_PROVIDERS.includes(requestedProvider) ||
        inFlightRef.current
      ) {
        return false;
      }

      const turnProvider = requestedProvider;
      const turnAnswerLocale = XNHAN_LOCALES.includes(requestedAnswerLocale)
        ? requestedAnswerLocale
        : resolveAnswerLocale(clean, locale);
      const history = Array.isArray(historySnapshot)
        ? normalizeXNhanConversationHistory(historySnapshot)
        : buildXNhanConversationHistory(turnsRef.current);
      webMcpPendingCompletionRef.current = null;
      webMcpSearchStatusRef.current = createXNhanSearchStatus(
        "searching",
        turnProvider,
        snapshotRef.current?.visibleResults,
      );
      inFlightRef.current = true;
      onSearchStarted?.();
      setQuery("");
      const chatTurn = createXNhanChatTurn(
        clean,
        turnProvider,
        turnAnswerLocale,
        history,
      );
      commitTurns({
        type: "append",
        turn: chatTurn,
        maximumTurns: XNHAN_MAX_CHAT_TURNS,
      });

      const controller = new AbortController();
      const abortFromCaller = () => controller.abort();
      signal?.addEventListener("abort", abortFromCaller, { once: true });
      requestRef.current?.abort();
      requestRef.current = controller;
      let requestTimedOut = false;
      const requestTimeoutId = scheduleXNhanSearchTimeout({
        controller,
        getActiveRequest: () => requestRef.current,
        onTimeout: () => {
          requestTimedOut = true;
        },
        scheduleTimeout: (callback, delay) =>
          window.setTimeout(callback, delay),
      });
      requestTimeoutRef.current = requestTimeoutId;
      const ownsRequest = () =>
        isCurrentXNhanSearchRequest(
          requestRef.current,
          controller,
          mountedRef.current,
        );
      const dispatchTurn = (event) => {
        if (!ownsRequest()) return turnsRef.current;
        return commitTurns({ ...event, turnId: chatTurn.id });
      };

      try {
        if (!ownsRequest() || controller.signal.aborted) {
          const error = new Error("X Nhân search was aborted.");
          error.name = "AbortError";
          throw error;
        }
        const normalized = await executeXNhanSearchRequest({
          answerLocale: turnAnswerLocale,
          history,
          onAccepted: (accepted) => {
            if (!controller.signal.aborted) {
              dispatchTurn({ type: "accepted", accepted });
            }
          },
          onActivity: (activity) => {
            if (!controller.signal.aborted) {
              dispatchTurn({ type: "activity", activity });
            }
          },
          onSource: (source) => {
            if (!controller.signal.aborted) {
              dispatchTurn({ type: "source", source });
            }
          },
          provider: turnProvider,
          query: clean,
          signal: controller.signal,
        });

        if (!ownsRequest()) return null;
        if (controller.signal.aborted) {
          const error = new Error("X Nhân search was aborted.");
          error.name = "AbortError";
          throw error;
        }
        webMcpPendingCompletionRef.current = normalized;
        dispatchTurn({ type: "completed", response: normalized });
        webMcpRevisionRef.current += 1;
        return normalized;
      } catch (error) {
        if (!ownsRequest()) return null;
        webMcpPendingCompletionRef.current = null;
        const failure = classifyXNhanSearchFailure({
          callerSignal: signal,
          error,
          requestSignal: controller.signal,
          requestTimedOut,
          userCancelled: userCancelledRequestRef.current === controller,
        });
        if (failure === "cancelled") {
          webMcpSearchStatusRef.current = createXNhanSearchStatus(
            "cancelled",
            null,
            snapshotRef.current?.visibleResults,
          );
          if (mountedRef.current) dispatchTurn({ type: "cancelled" });
          return null;
        }
        const boundedError = failure === "timeout"
          ? createXNhanSearchError("timeout")
          : error;
        webMcpSearchStatusRef.current = createXNhanSearchStatus(
          "error",
          null,
          snapshotRef.current?.visibleResults,
        );
        if (mountedRef.current) {
          dispatchTurn({
            type: "failed",
            error: localizedError(
              boundedError,
              xnhanContent[turnAnswerLocale],
              turnProvider,
            ),
          });
        }
        return null;
      } finally {
        signal?.removeEventListener("abort", abortFromCaller);
        window.clearTimeout(requestTimeoutId);
        if (userCancelledRequestRef.current === controller) {
          userCancelledRequestRef.current = null;
        }
        if (requestRef.current === controller) {
          requestTimeoutRef.current = null;
          requestRef.current = null;
          inFlightRef.current = false;
        }
      }
    },
    [commitTurns, locale, onSearchStarted, query, snapshotRef],
  );

  const openXPost = useCallback(
    async (resultId, { signal } = {}) => {
      if (!mountedRef.current) {
        throw new Error("xnhan_session_unavailable");
      }
      if (signal?.aborted) {
        const error = new Error("X Nhân post navigation was aborted.");
        error.name = "AbortError";
        throw error;
      }

      const activeSearchId = snapshotRef.current?.searchId;
      const post = snapshotRef.current?.posts.find(
        (candidate) => candidate.id === resultId,
      );
      const link = activeSearchId
        ? document.getElementById(`xnhan-post-link-${activeSearchId}-${resultId}`)
        : null;
      const sourceDisclosure = activeSearchId
        ? document.getElementById(`xnhan-sources-details-${activeSearchId}`)
        : null;
      if (!post || !(link instanceof HTMLAnchorElement) || link.href !== post.url) {
        throw new Error("xnhan_post_unavailable");
      }

      if (sourceDisclosure instanceof HTMLDetailsElement) {
        sourceDisclosure.open = true;
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
      }
      if (!mountedRef.current) {
        throw new Error("xnhan_session_unavailable");
      }
      link.focus({ preventScroll: true });
      if (document.activeElement !== link || signal?.aborted) {
        if (signal?.aborted) {
          const error = new Error("X Nhân post navigation was aborted.");
          error.name = "AbortError";
          throw error;
        }
        throw new Error("xnhan_post_focus_unavailable");
      }
      link.click();
      return { status: "navigation_requested", resultId, url: post.url };
    },
    [snapshotRef],
  );

  const stopSearch = useCallback(async ({ signal } = {}) => {
    if (!mountedRef.current) {
      throw new Error("xnhan_session_unavailable");
    }
    if (signal?.aborted) {
      const error = new Error("X Nhân search cancellation was aborted.");
      error.name = "AbortError";
      throw error;
    }
    const controller = requestRef.current;
    if (!controller) return { status: "already_idle" };
    userCancelledRequestRef.current = controller;
    controller.abort();
    return { status: "cancel_requested" };
  }, []);

  const startNewChat = useCallback(
    async ({ signal } = {}) => {
      if (!mountedRef.current) {
        throw new Error("xnhan_session_unavailable");
      }
      if (signal?.aborted) {
        const error = new Error("X Nhân new-chat action was aborted.");
        error.name = "AbortError";
        throw error;
      }
      requestRef.current?.abort();
      requestRef.current = null;
      userCancelledRequestRef.current = null;
      inFlightRef.current = false;
      window.clearTimeout(requestTimeoutRef.current);
      requestTimeoutRef.current = null;
      setQuery("");
      commitTurns({ type: "reset" });
      webMcpPendingCompletionRef.current = null;
      webMcpSearchStatusRef.current = createXNhanSearchStatus("idle");
      window.requestAnimationFrame(() => {
        if (mountedRef.current) inputRef.current?.focus();
      });
      return { status: "reset_requested" };
    },
    [commitTurns, inputRef],
  );

  const isSearchInFlight = useCallback(
    () => mountedRef.current && inFlightRef.current,
    [],
  );
  const latestTurn = turns.at(-1) ?? null;

  return {
    busy: latestTurn?.phase === "loading",
    isSearchInFlight,
    latestTurn,
    openXPost,
    query,
    setQuery,
    startNewChat,
    startSearch,
    stopSearch,
    turns,
    turnsRef,
    webMcpPendingCompletionRef,
    webMcpRevision: webMcpRevisionRef.current,
    webMcpSearchStatusRef,
  };
}
