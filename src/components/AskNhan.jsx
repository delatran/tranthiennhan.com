import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { ChatCircleDots } from "@phosphor-icons/react/dist/csr/ChatCircleDots";
import { Copy } from "@phosphor-icons/react/dist/csr/Copy";
import { PaperPlaneRight } from "@phosphor-icons/react/dist/csr/PaperPlaneRight";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { resolveAnswerLocale } from "../answer-language.js";
import { content } from "../content.js";
import {
  askNhanModalBackgroundElements,
  focusAskDialogIfNeeded,
  setElementsTemporarilyInert,
} from "./modal-inertness.js";
import { navigateToTarget } from "./navigation.js";

const ASK_REQUEST_TIMEOUT_MS = 120_000;

function normalizeIntentText(message) {
  return message.normalize("NFKC").toLocaleLowerCase();
}

function isContactIntent(message) {
  const normalized = normalizeIntentText(message);
  return /(?:\b(?:contact|email|linkedin|reach)\b|liên hệ|kết nối|\b(?:x|twitter)\s+(?:profile|account|handle)\b|\b(?:hồ sơ|tài khoản)\s+x\b|@?tran_thien_nhan\b)/u.test(
    normalized,
  );
}

function chooseReply(message, copy) {
  const normalized = normalizeIntentText(message);

  if (isContactIntent(normalized)) {
    return copy.contact.body;
  }

  if (/(what can|answer|trả lời|có thể|help|giúp)/u.test(normalized)) {
    return copy.chat.replies.capability;
  }
  if (/(production|call|speech|customer service|chấm điểm|cuộc gọi|cskh|tổng đài)/u.test(normalized)) {
    return copy.chat.replies.production;
  }
  if (/(document|pdf|multimodal|tài liệu|đa phương thức)/u.test(normalized)) {
    return copy.chat.replies.document;
  }
  if (/(lora|backdoor|adapter|model security|an toàn mô hình|kiểm toán)/u.test(normalized)) {
    return copy.chat.replies.research;
  }
  if (/(resume|cv|profile|experience|career|current role|work|job|employer|company|education|degree|credential|language|hồ sơ|kinh nghiệm|vai trò|làm việc|công việc|công ty|học vấn|bằng cấp|chứng chỉ|ngôn ngữ|đầy đủ|thiếu)/u.test(normalized)) {
    return copy.chat.replies.profile;
  }
  if (/(build|built|stack|react|vite|cloudflare|xây|công nghệ|kiến trúc)/u.test(normalized)) {
    return copy.chat.replies.build;
  }
  if (/(\bai\b|model|chatbot|live|thật|trực tiếp)/u.test(normalized)) {
    return copy.chat.replies.ai;
  }
  return copy.chat.replies.fallback;
}

function chooseRelatedSection(message) {
  const normalized = normalizeIntentText(message);

  if (isContactIntent(normalized)) {
    return "contact";
  }
  if (
    /(production|call|speech|document|pdf|multimodal|lora|backdoor|project|dự án|cuộc gọi|tài liệu|đa phương thức|kiểm toán)/u.test(
      normalized,
    )
  ) {
    return "work";
  }
  if (
    /(experience|career|company|kienlong|mercedes|education|degree|kinh nghiệm|công ty|học vấn|cao học)/u.test(
      normalized,
    )
  ) {
    return "experience";
  }
  if (/(build|stack|react|vite|cloudflare|website|approach|xây|công nghệ|kiến trúc)/u.test(normalized)) {
    return "about";
  }

  return null;
}

function localRelatedLinks(message, copy) {
  const section = chooseRelatedSection(message);
  return section ? [{ href: `#${section}`, label: copy.nav[section] }] : [];
}

function validatedRelatedLinks(value, copy, message) {
  if (!Array.isArray(value)) return localRelatedLinks(message, copy);

  const allowedLinks = new Map(
    ["work", "experience", "about", "contact"].map((section) => [
      `#${section}`,
      copy.nav[section],
    ]),
  );
  const links = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const expectedLabel = allowedLinks.get(item.href);
    if (!expectedLabel || item.label !== expectedLabel) continue;
    if (links.some(({ href }) => href === item.href)) continue;
    links.push({ href: item.href, label: expectedLabel });
    if (links.length === 2) break;
  }

  return links.length ? links : localRelatedLinks(message, copy);
}

export function AskNhan({
  copy,
  isOpen,
  onOpen,
  onClose,
  onPrivacyStateChange,
  locale,
  suppressed,
}) {
  const [messages, setMessages] = useState(() => [
    { id: 1, role: "assistant", text: copy.chat.introduction, language: locale },
  ]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [serviceMode, setServiceMode] = useState("ready");
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const inputRef = useRef(null);
  const launcherRef = useRef(null);
  const panelRef = useRef(null);
  const endRef = useRef(null);
  const requestRef = useRef(null);
  const inFlightRef = useRef(false);
  const copyTimerRef = useRef(null);
  const nextMessageIdRef = useRef(2);
  const previousLocaleRef = useRef(locale);
  const [modalMode, setModalMode] = useState(() =>
    window.matchMedia("(max-width: 37.5rem)").matches,
  );

  useLayoutEffect(() => {
    onPrivacyStateChange?.(
      messages.length > 1 || draft.length > 0 || typing,
    );
  }, [draft.length, messages.length, onPrivacyStateChange, typing]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 37.5rem)");
    const handleChange = (event) => setModalMode(event.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!isOpen || !modalMode) return undefined;
    const previousOverflow = document.body.style.overflow;
    const restoreBackgroundAccessibility = setElementsTemporarilyInert(
      askNhanModalBackgroundElements(document),
    );

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      restoreBackgroundAccessibility();
    };
  }, [isOpen, modalMode]);

  useEffect(() => {
    if (previousLocaleRef.current !== locale) {
      requestRef.current?.abort();
      requestRef.current = null;
      inFlightRef.current = false;
      window.clearTimeout(copyTimerRef.current);
      previousLocaleRef.current = locale;
      setMessages([
        {
          id: nextMessageIdRef.current++,
          role: "assistant",
          text: copy.chat.introduction,
          language: locale,
        },
      ]);
      setTyping(false);
      setServiceMode("ready");
      setDraft("");
      setCopiedMessageId(null);
    }
  }, [copy.chat.introduction, locale]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const animationFrame = window.requestAnimationFrame(() => {
      focusAskDialogIfNeeded(
        panelRef.current,
        inputRef.current,
        document.activeElement,
      );
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [isOpen, modalMode]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, typing]);

  useEffect(() => {
    if (!typing) {
      setElapsedSeconds(0);
      return undefined;
    }

    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    }, 1_000);

    return () => window.clearInterval(intervalId);
  }, [typing]);

  useEffect(
    () => () => {
      requestRef.current?.abort();
      requestRef.current = null;
      inFlightRef.current = false;
      window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const closeAndRestoreFocus = () => {
    onClose();
    window.requestAnimationFrame(() => launcherRef.current?.focus());
  };

  const stopWaiting = () => {
    if (!requestRef.current) return;
    setServiceMode("cancelled");
    requestRef.current.abort();
  };

  const handlePanelKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }

    if (!modalMode || event.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const resetConversation = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    inFlightRef.current = false;
    window.clearTimeout(copyTimerRef.current);
    setMessages([
      {
        id: nextMessageIdRef.current++,
        role: "assistant",
        text: copy.chat.introduction,
        language: locale,
      },
    ]);
    setDraft("");
    setTyping(false);
    setServiceMode("ready");
    setCopiedMessageId(null);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const copyAnswer = async (message) => {
    if (!navigator.clipboard?.writeText) return;

    try {
      await navigator.clipboard.writeText(message.text);
      window.clearTimeout(copyTimerRef.current);
      setCopiedMessageId(message.id);
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedMessageId(null);
      }, 2200);
    } catch {
      // Clipboard access can be blocked by the browser or embedding context.
    }
  };

  const openRelatedSection = (event, section) => {
    navigateToTarget(event, section, onClose);
  };

  const sendMessage = async (
    text,
    {
      answerLocale: requestedAnswerLocale,
      appendUser = true,
      replaceMessageId = null,
    } = {},
  ) => {
    const clean = text.trim();
    if (!clean || typing || inFlightRef.current) return;
    const answerLocale =
      requestedAnswerLocale === "en" || requestedAnswerLocale === "vi"
        ? requestedAnswerLocale
        : resolveAnswerLocale(clean, locale);
    const answerCopy = content[answerLocale];

    inFlightRef.current = true;

    setMessages((items) => {
      const retainedItems = replaceMessageId
        ? items.filter((item) => item.id !== replaceMessageId)
        : items;
      return appendUser
        ? [
            ...retainedItems,
            {
              id: nextMessageIdRef.current++,
              role: "user",
              text: clean,
              language: answerLocale,
            },
          ]
        : retainedItems;
    });
    setDraft("");
    setTyping(true);
    setServiceMode("thinking");
    setCopiedMessageId(null);

    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    let requestTimedOut = false;
    const requestTimeoutId = window.setTimeout(() => {
      if (requestRef.current !== controller) return;
      requestTimedOut = true;
      controller.abort();
    }, ASK_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: clean,
          locale,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        let errorCode = "";
        try {
          const errorPayload = await response.json();
          errorCode = typeof errorPayload.error === "string" ? errorPayload.error : "";
        } catch {
          // A bounded local fallback handles non-JSON upstream failures.
        }

        const serviceFailure =
          errorCode === "rate_limited"
            ? { mode: "rateLimited", text: answerCopy.chat.rateLimited }
            : null;

        if (serviceFailure) {
          setMessages((items) => [
            ...items,
            {
              id: nextMessageIdRef.current++,
              role: "assistant",
              text: serviceFailure.text,
              language: answerLocale,
              copyable: true,
              retryText: clean,
            },
          ]);
          setServiceMode(serviceFailure.mode);
          return;
        }

        throw new Error(`Ask Nhân returned ${response.status}`);
      }

      const payload = await response.json();
      if (typeof payload.answer !== "string" || !payload.answer.trim()) {
        throw new Error("Ask Nhân returned an empty answer");
      }
      const usedFallback = payload.mode === "fallback";

      setMessages((items) => [
        ...items,
        {
          id: nextMessageIdRef.current++,
          role: "assistant",
          text: payload.answer.trim(),
          language: answerLocale,
          copyable: true,
          relatedLinks: validatedRelatedLinks(payload.related, copy, clean),
          retryText: usedFallback ? clean : undefined,
        },
      ]);
      setServiceMode(
        payload.mode === "ai"
          ? "ai"
          : usedFallback
            ? "fallback"
            : "guardrail",
      );
    } catch (error) {
      const requestWasAborted =
        error instanceof DOMException && error.name === "AbortError";
      if (requestWasAborted && !requestTimedOut) return;
      setMessages((items) => [
        ...items,
        {
          id: nextMessageIdRef.current++,
          role: "assistant",
          text: chooseReply(clean, answerCopy),
          language: answerLocale,
          copyable: true,
          relatedLinks: localRelatedLinks(clean, copy),
          retryText: clean,
        },
      ]);
      setServiceMode("fallback");
    } finally {
      window.clearTimeout(requestTimeoutId);
      if (requestRef.current === controller) {
        requestRef.current = null;
        inFlightRef.current = false;
        setTyping(false);
      }
    }
  };

  const headerStatus = typing ? "thinking" : serviceMode;

  return (
    <div
      className={`ask-nhan ${isOpen ? "is-open" : ""} ${suppressed ? "is-suppressed" : ""}`}
    >
      {isOpen ? (
        <section
          id="ask-nhan-dialog"
          className="chat-panel"
          role="dialog"
          aria-modal={modalMode}
          aria-labelledby="chat-title"
          aria-describedby="ask-nhan-disclosure"
          ref={panelRef}
          onKeyDown={handlePanelKeyDown}
        >
          <header className="chat-header">
            <div className="chat-heading">
              <h2 id="chat-title">{copy.chat.title}</h2>
              <span role="status" aria-live="polite">
                {copy.chat.status[headerStatus]}
              </span>
            </div>
            <div className="chat-header-actions">
              <button
                type="button"
                aria-label={copy.chat.newChat}
                title={copy.chat.newChat}
                onClick={resetConversation}
                disabled={messages.length === 1 && !draft && !typing}
              >
                <ArrowCounterClockwise size={20} aria-hidden="true" />
              </button>
              <button type="button" aria-label={copy.chat.close} onClick={closeAndRestoreFocus}>
                <X size={21} aria-hidden="true" />
              </button>
            </div>
          </header>

          <div
            className="chat-transcript"
            role="log"
            aria-label={copy.chat.transcriptLabel}
            aria-live="polite"
            aria-relevant="additions text"
            aria-busy={typing}
          >
            {messages.map((message) => (
              <div
                className={`message is-${message.role}`}
                key={message.id}
              >
                {message.role === "assistant" ? (
                  <span className="message-mark" aria-hidden="true">
                    <ChatCircleDots size={17} weight="fill" />
                  </span>
                ) : null}
                <div className="message-body">
                  <p lang={message.language ?? locale}>{message.text}</p>
                  {message.copyable ? (
                    <div className="message-actions">
                      <button type="button" onClick={() => copyAnswer(message)}>
                        {copiedMessageId === message.id ? (
                          <Check size={16} weight="bold" aria-hidden="true" />
                        ) : (
                          <Copy size={16} aria-hidden="true" />
                        )}
                        <span>
                          {copiedMessageId === message.id
                            ? copy.chat.copied
                            : copy.chat.copyAnswer}
                        </span>
                      </button>
                      {message.retryText ? (
                        <button
                          type="button"
                          disabled={typing}
                          onClick={() =>
                            sendMessage(message.retryText, {
                              answerLocale: message.language,
                              appendUser: false,
                              replaceMessageId: message.id,
                            })
                          }
                        >
                          <ArrowCounterClockwise size={16} aria-hidden="true" />
                          <span>{copy.chat.retry}</span>
                        </button>
                      ) : null}
                      {message.relatedLinks?.map((relatedLink) => {
                        const section = relatedLink.href.slice(1);
                        return (
                          <a
                            href={relatedLink.href}
                            key={relatedLink.href}
                            onClick={(event) => openRelatedSection(event, section)}
                          >
                            {copy.chat.viewSection.replace(
                              "{section}",
                              relatedLink.label,
                            )}
                            <ArrowUpRight size={16} aria-hidden="true" />
                          </a>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {typing ? (
              <div className="message is-assistant is-typing">
                <span className="message-mark" aria-hidden="true">
                  <ChatCircleDots size={17} weight="fill" />
                </span>
                <div className="message-waiting">
                  <span role="status">{copy.chat.typing}</span>
                  <span aria-hidden="true">
                    {copy.chat.waiting.replace("{seconds}", String(elapsedSeconds))}
                  </span>
                  <button type="button" onClick={stopWaiting}>
                    {copy.chat.stopWaiting}
                  </button>
                </div>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          {messages.length === 1 ? (
            <div className="chat-suggestions" aria-label={copy.chat.suggestionsLabel}>
              {copy.chat.suggestions.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion}
                  disabled={typing}
                  onClick={() => sendMessage(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}

          <form
            className="chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage(draft);
            }}
          >
            <label className="sr-only" htmlFor="ask-nhan-input">
              {copy.chat.placeholder}
            </label>
            <input
              id="ask-nhan-input"
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={copy.chat.placeholder}
              autoComplete="off"
              aria-describedby="ask-nhan-disclosure"
              maxLength={400}
            />
            <button
              type="submit"
              aria-label={copy.chat.send}
              disabled={!draft.trim() || typing}
            >
              <PaperPlaneRight size={20} weight="fill" aria-hidden="true" />
            </button>
          </form>
          <p className="chat-disclosure" id="ask-nhan-disclosure">
            {copy.chat.disclosure}
          </p>
        </section>
      ) : null}

      <button
        className="chat-launcher"
        type="button"
        aria-label={isOpen ? copy.chat.close : copy.chat.open}
        aria-expanded={isOpen}
        aria-controls={isOpen ? "ask-nhan-dialog" : undefined}
        onClick={isOpen ? closeAndRestoreFocus : onOpen}
        ref={launcherRef}
      >
        <span className="launcher-icon">
          <ChatCircleDots size={27} weight="fill" aria-hidden="true" />
        </span>
        <span>{copy.chat.title}</span>
      </button>
    </div>
  );
}
