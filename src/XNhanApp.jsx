import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { PaperPlaneRight } from "@phosphor-icons/react/dist/csr/PaperPlaneRight";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import {
  buildXNhanConversationHistory,
  readXNhanSearchQuery,
  XNHAN_QUERY_INPUT_MAX_UTF16_LENGTH,
  XNHAN_QUERY_MAX_LENGTH,
} from "../shared/xnhan.js";
import {
  commitXNhanWebMcpBridge,
  createXNhanWebMcpLifecycle,
  publishCompletedXNhanWebMcpSearchStatus,
  useXNhanWebMcp,
} from "./use-xnhan-webmcp.js";
import { useAutosizeTextarea } from "./use-autosize-textarea.js";
import { useXNhanSearchSession } from "./use-xnhan-search-session.js";
import { XNhanLogo } from "./XNhanLogo.jsx";
import { XNhanTurn } from "./XNhanTurn.jsx";
import {
  XNHAN_DEFAULT_PROVIDER,
  XNHAN_LOCALES,
  xnhanContent,
} from "./xnhan-content.js";
import {
  readInitialXNhanLocale,
  replaceXNhanLocaleInUrl,
  writeStoredXNhanLocale,
  xNhanHref,
} from "./xnhan-locale.js";
import { createXNhanWebMcpSnapshot } from "./xnhan-webmcp-snapshot.js";
import "./xnhan.css";

const XNHAN_CANONICAL_URL = "https://tranthiennhan.com/xnhan";

function setMetaContent(selector, content) {
  const element = document.querySelector(selector);
  if (element) element.setAttribute("content", content);
}

function setLinkHref(selector, href) {
  const element = document.querySelector(selector);
  if (element) element.setAttribute("href", href);
}

function useXNhanMetadata(locale, copy) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = copy.meta.title;
    setLinkHref('link[rel="canonical"]', XNHAN_CANONICAL_URL);
    setMetaContent('meta[name="description"]', copy.meta.description);
    setMetaContent('meta[property="og:url"]', XNHAN_CANONICAL_URL);
    setMetaContent('meta[property="og:title"]', copy.meta.title);
    setMetaContent('meta[property="og:description"]', copy.meta.description);
    setMetaContent('meta[property="og:locale"]', locale === "vi" ? "vi_VN" : "en_US");
    setMetaContent(
      'meta[property="og:locale:alternate"]',
      locale === "vi" ? "en_US" : "vi_VN",
    );
    setMetaContent('meta[name="twitter:title"]', copy.meta.title);
    setMetaContent('meta[name="twitter:description"]', copy.meta.description);
  }, [copy, locale]);
}

export function XNhanApp() {
  const [locale, setLocale] = useState(readInitialXNhanLocale);
  const [showLatestUpdate, setShowLatestUpdate] = useState(false);
  const copy = useMemo(() => xnhanContent[locale], [locale]);
  const suggestions = copy.suggestions;

  const inputRef = useRef(null);
  const transcriptRef = useRef(null);
  const transcriptEndRef = useRef(null);
  const followLatestRef = useRef(true);

  // Stable integration seams for the route-scoped WebMCP adapter.
  const searchActionRef = useRef(null);
  const openPostActionRef = useRef(null);
  const localeActionRef = useRef(null);
  const stopSearchActionRef = useRef(null);
  const newChatActionRef = useRef(null);
  const xnhanStateRef = useRef(null);
  const webMcpBridgeLifecycleRef = useRef(null);
  const webMcpBridgeCleanupRef = useRef(null);
  const handleSearchStarted = useCallback(() => {
    followLatestRef.current = true;
    setShowLatestUpdate(false);
  }, []);
  const {
    busy,
    isSearchInFlight,
    latestTurn,
    openXPost,
    query,
    setQuery,
    startNewChat,
    startSearch,
    stopSearch,
    turns,
    webMcpPendingCompletionRef,
    webMcpRevision,
    webMcpSearchStatusRef,
  } = useXNhanSearchSession({
    inputRef,
    locale,
    onSearchStarted: handleSearchStarted,
    snapshotRef: xnhanStateRef,
  });
  const { queryLength, queryTooLong, valid: queryIsValid } =
    useMemo(() => readXNhanSearchQuery(query), [query]);

  useXNhanMetadata(locale, copy);

  useEffect(() => {
    if (!latestTurn) return undefined;
    if (!followLatestRef.current) {
      setShowLatestUpdate(true);
      return undefined;
    }
    const animationFrame = window.requestAnimationFrame(() => {
      transcriptEndRef.current?.scrollIntoView({
        block: "end",
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
          ? "auto"
          : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [
    latestTurn?.id,
    latestTurn?.phase,
    latestTurn?.activities?.length,
    latestTurn?.consultedSources?.length,
  ]);

  const handleTranscriptScroll = () => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const distanceFromEnd =
      transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    followLatestRef.current = distanceFromEnd <= 96;
    if (followLatestRef.current) setShowLatestUpdate(false);
  };

  const jumpToLatest = () => {
    followLatestRef.current = true;
    setShowLatestUpdate(false);
    transcriptEndRef.current?.scrollIntoView({
      block: "end",
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
        ? "auto"
        : "smooth",
    });
  };

  useAutosizeTextarea(inputRef, query);

  const changeLocale = useCallback(
    (nextLocale) => {
      if (
        !XNHAN_LOCALES.includes(nextLocale) ||
        nextLocale === locale ||
        isSearchInFlight()
      ) {
        return false;
      }
      writeStoredXNhanLocale(nextLocale);
      replaceXNhanLocaleInUrl(nextLocale);
      setLocale(nextLocale);
      return true;
    },
    [isSearchInFlight, locale],
  );

  const activeResultTurn = useMemo(
    () => [...turns].reverse().find((turn) => turn.response !== null),
    [turns],
  );
  const activeResponse = activeResultTurn?.response ?? null;
  const webMcpVisibleConversationHistory = useMemo(
    () => buildXNhanConversationHistory(turns),
    [turns],
  );
  const webMcpSnapshot = useMemo(
    () =>
      createXNhanWebMcpSnapshot({
        activeResponse,
        defaultProvider: XNHAN_DEFAULT_PROVIDER,
        latestTurn,
        locale,
        query,
        revision: webMcpRevision,
        visibleConversationHistory: webMcpVisibleConversationHistory,
      }),
    [
      activeResponse,
      latestTurn,
      locale,
      query,
      webMcpRevision,
      webMcpVisibleConversationHistory,
    ],
  );

  useLayoutEffect(() => {
    const lifecycle = createXNhanWebMcpLifecycle();
    webMcpBridgeLifecycleRef.current = lifecycle;
    return () => {
      lifecycle.close();
      webMcpBridgeCleanupRef.current?.();
      webMcpBridgeCleanupRef.current = null;
      if (webMcpBridgeLifecycleRef.current === lifecycle) {
        webMcpBridgeLifecycleRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    const lifecycle = webMcpBridgeLifecycleRef.current;
    if (!lifecycle) return;
    const bridge = commitXNhanWebMcpBridge({
      lifecycle,
      localeAction: async (nextLocale, { signal } = {}) => {
        if (signal?.aborted) {
          const error = new Error("X Nhân locale change was aborted.");
          error.name = "AbortError";
          throw error;
        }

        const previousLocale = xnhanStateRef.current?.locale ?? locale;
        if (nextLocale === previousLocale) {
          return { status: "unchanged", locale: nextLocale };
        }
        if (!changeLocale(nextLocale)) {
          throw new Error("xnhan_locale_change_unavailable");
        }
        return { status: "changed", locale: nextLocale };
      },
      localeActionRef,
      newChatAction: startNewChat,
      newChatActionRef,
      openPostAction: openXPost,
      openPostActionRef,
      searchAction: startSearch,
      searchActionRef,
      snapshot: webMcpSnapshot,
      snapshotRef: xnhanStateRef,
      stopSearchAction: stopSearch,
      stopSearchActionRef,
    });
    webMcpBridgeCleanupRef.current = bridge.cleanup;
    publishCompletedXNhanWebMcpSearchStatus(
      webMcpSearchStatusRef,
      webMcpPendingCompletionRef,
      webMcpSnapshot,
    );
  }, [
    changeLocale,
    locale,
    openXPost,
    startNewChat,
    startSearch,
    stopSearch,
    webMcpSnapshot,
  ]);

  useXNhanWebMcp({
    localeActionRef,
    newChatActionRef,
    openPostActionRef,
    searchActionRef,
    searchStatusRef: webMcpSearchStatusRef,
    snapshotRef: xnhanStateRef,
    stopSearchActionRef,
  });

  const handleSubmit = (event) => {
    event.preventDefault();
    void startSearch();
  };

  const handleQueryKeyDown = (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const handleSuggestion = (suggestion) => {
    setQuery(suggestion);
    if (!isSearchInFlight()) {
      void startSearch(suggestion, { provider: XNHAN_DEFAULT_PROVIDER });
    } else {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const handleStopSearch = () => {
    void stopSearch();
  };

  const handleNewChat = () => {
    void startNewChat();
  };

  return (
    <div className="xnhan-app">
      <a className="skip-link xnhan-skip-link" href="#xnhan-main">
        {copy.skip}
      </a>

      <header className="xnhan-header">
        <div className="xnhan-header-inner">
          <div className="xnhan-header-start">
            <div
              className="xnhan-brand-lockup"
              role="img"
              aria-label="X Nhân"
            >
              <XNhanLogo />
            </div>
            <button
              className="xnhan-new-chat"
              type="button"
              aria-label={copy.newChat}
              onClick={handleNewChat}
            >
              <Plus size={18} weight="bold" aria-hidden="true" />
              <span>{copy.newChat}</span>
            </button>
          </div>
          <div className="xnhan-header-actions">
            <a
              className="xnhan-about-link"
              href={xNhanHref("/xnhan/about", locale)}
            >
              {copy.aboutLink}
            </a>
            <nav className="xnhan-locale-switch" aria-label={copy.language}>
              {XNHAN_LOCALES.map((item) => (
                <button
                  type="button"
                  key={item}
                  lang={item}
                  aria-pressed={locale === item}
                  disabled={busy}
                  onClick={() => changeLocale(item)}
                >
                  {item.toUpperCase()}
                </button>
              ))}
            </nav>
            <a
              className="xnhan-owner-link"
              href={`/${locale}`}
              aria-label={copy.ownerLink}
            >
              <span className="xnhan-owner-full">{copy.owner}</span>
              <span className="xnhan-owner-short" aria-hidden="true">
                Nhân
              </span>
            </a>
          </div>
        </div>
      </header>

      <main className="xnhan-main" id="xnhan-main" tabIndex="-1">
        <section
          className={`xnhan-chat-shell ${turns.length ? "has-turns" : "is-empty"}`}
          aria-labelledby="xnhan-title"
          aria-busy={busy}
        >
          <div
            className="xnhan-transcript"
            ref={transcriptRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            onScroll={handleTranscriptScroll}
          >
            <div className="xnhan-transcript-inner">
              <h1
                className={turns.length ? "sr-only" : "xnhan-chat-title"}
                id="xnhan-title"
              >
                {copy.initialTitle}
              </h1>

              {turns.length === 0 ? (
                <div className="xnhan-initial-state">
                  <p>{copy.initialText}</p>
                  <div className="xnhan-suggestions" aria-label={copy.suggestionsLabel}>
                    {suggestions.map((suggestion, index) => (
                      <button
                        type="button"
                        key={`xnhan-suggestion-${index + 1}`}
                        disabled={busy}
                        onClick={() => handleSuggestion(suggestion)}
                      >
                        <span className="xnhan-suggestion-index" aria-hidden="true">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span
                          className="xnhan-suggestion-copy"
                        >
                          {suggestion}
                        </span>
                        <ArrowUpRight size={17} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {turns.map((turn) => (
                <XNhanTurn
                  busy={busy}
                  copy={copy}
                  key={turn.id}
                  locale={locale}
                  onRetry={startSearch}
                  onStop={handleStopSearch}
                  turn={turn}
                />
              ))}
              <div
                className="xnhan-transcript-end"
                ref={transcriptEndRef}
                aria-hidden="true"
              />
            </div>
          </div>

          <div className="xnhan-composer-dock">
            {showLatestUpdate ? (
              <button
                className="xnhan-jump-latest"
                type="button"
                onClick={jumpToLatest}
              >
                {copy.latestUpdate}
              </button>
            ) : null}
            <form className="xnhan-composer" onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="xnhan-query">{copy.form.label}</label>
              <div className="xnhan-composer-control">
                <textarea
                  id="xnhan-query"
                  ref={inputRef}
                  value={query}
                  rows="1"
                  maxLength={XNHAN_QUERY_INPUT_MAX_UTF16_LENGTH}
                  placeholder={copy.form.placeholder}
                  aria-describedby={`xnhan-query-hint${
                    queryTooLong ? " xnhan-query-error" : ""
                  }`}
                  aria-invalid={queryTooLong || undefined}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={handleQueryKeyDown}
                />
                <button
                  className="xnhan-submit"
                  type="submit"
                  aria-label={busy ? copy.form.searching : copy.form.submit}
                  disabled={!queryIsValid || busy}
                >
                  {busy ? (
                    <span className="xnhan-submit-spinner" aria-hidden="true" />
                  ) : (
                    <PaperPlaneRight size={21} weight="fill" aria-hidden="true" />
                  )}
                </button>
              </div>
              <div className="xnhan-composer-meta">
                <p id="xnhan-query-hint">{copy.form.hint}</p>
                <p className={queryTooLong ? "is-invalid" : undefined}>
                  {queryLength} / {XNHAN_QUERY_MAX_LENGTH}
                </p>
              </div>
              {queryTooLong ? (
                <p className="xnhan-query-error" id="xnhan-query-error" role="alert">
                  {copy.form.tooLong}
                </p>
              ) : null}

            </form>
          </div>
        </section>
      </main>
    </div>
  );
}
