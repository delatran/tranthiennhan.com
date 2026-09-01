import { registerImperativeWebMcpCatalog } from "./webmcp-registration.js";
import {
  createSerializedWebMcpActionRunner,
  readExactWebMcpResultArray,
  readExactWebMcpResultObject,
  readWebMcpResultProperty,
  readWebMcpResultString,
  requireBoundedWebMcpString,
  requireWebMcpAction,
  resolveWebMcpLifecycleSignal,
  validateExactWebMcpInput,
} from "./webmcp-runtime.js";

export const PORTFOLIO_WEBMCP_TOOL_NAMES = Object.freeze({
  navigatePortfolioSection: "navigate_portfolio_section",
  setPortfolioLocale: "set_portfolio_locale",
  openAskNhan: "open_ask_nhan",
  closeAskNhan: "close_ask_nhan",
  readPortfolioOverview: "read_portfolio_overview",
});

export const PORTFOLIO_WEBMCP_NAVIGATION_TARGETS = Object.freeze([
  "top",
  "work",
  "work-call-scoring",
  "work-document-ai",
  "work-lora-audit",
  "product",
  "experience",
  "about",
  "contact",
]);

export const PORTFOLIO_WEBMCP_LOCALES = Object.freeze(["en", "vi"]);

export const PORTFOLIO_WEBMCP_OVERVIEW_TARGETS = Object.freeze([
  "top",
  "work",
  "product",
  "experience",
  "about",
  "contact",
]);

const WEBMCP_STATE_TIMEOUT_MS = 2_000;
const WEBMCP_STATE_MAX_TIMEOUT_MS = 10_000;
const MUTATING_LOCAL_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  untrustedContentHint: false,
});
const READ_ONLY_TRUSTED_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  untrustedContentHint: false,
});
const PORTFOLIO_WEBMCP_CATALOG = Object.freeze({ name: "portfolio" });
const NAVIGATION_FOCUS_IDS = Object.freeze({
  top: "hero-title",
  work: "work-title",
  "work-call-scoring": "case-title-call-scoring",
  "work-document-ai": "case-title-document-ai",
  "work-lora-audit": "case-title-lora-audit",
  product: "product-title",
  experience: "experience-title",
  about: "approach-title",
  contact: "contact-title",
});

const NAVIGATION_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    target: Object.freeze({
      type: "string",
      description: "Allowlisted portfolio section to bring into view.",
      enum: PORTFOLIO_WEBMCP_NAVIGATION_TARGETS,
    }),
  }),
  required: Object.freeze(["target"]),
  additionalProperties: false,
});

const LOCALE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    locale: Object.freeze({
      type: "string",
      description: "Visible portfolio language: English or Vietnamese.",
      enum: PORTFOLIO_WEBMCP_LOCALES,
    }),
  }),
  required: Object.freeze(["locale"]),
  additionalProperties: false,
});

const EMPTY_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({}),
  required: Object.freeze([]),
  additionalProperties: false,
});

function normalizeNavigationResult(result, target) {
  const status = readWebMcpResultString(result, "status");
  const resultTarget = readWebMcpResultString(result, "target");
  const focusId = readWebMcpResultString(result, "focusId");
  const focused = readWebMcpResultProperty(result, "focused");
  const locale = readWebMcpResultString(result, "locale");
  const path = readWebMcpResultString(result, "path");
  const hash = readWebMcpResultString(result, "hash");

  if (
    status !== "navigated" ||
    resultTarget !== target ||
    focusId !== NAVIGATION_FOCUS_IDS[target] ||
    focused !== true ||
    !PORTFOLIO_WEBMCP_LOCALES.includes(locale) ||
    path !== `/${locale}` ||
    hash !== `#${target}`
  ) {
    throw new TypeError("WebMCP action returned an unsupported result.");
  }

  return Object.freeze({
    status,
    target: resultTarget,
    focusId,
    focused,
    locale,
    path,
    hash,
  });
}

function normalizeLocaleResult(result, locale) {
  const status = readWebMcpResultString(result, "status");
  const resultLocale = readWebMcpResultString(result, "locale");
  const path = readWebMcpResultString(result, "path");

  if (
    !["changed", "unchanged"].includes(status) ||
    resultLocale !== locale ||
    path !== `/${locale}`
  ) {
    throw new TypeError("WebMCP action returned an unsupported result.");
  }

  return Object.freeze({ status, locale: resultLocale, path });
}

function normalizeOpenAskNhanResult(result) {
  const status = readWebMcpResultString(result, "status");
  const locale = readWebMcpResultString(result, "locale");
  const dialogId = readWebMcpResultString(result, "dialogId");
  const focusId = readWebMcpResultString(result, "focusId");
  const focused = readWebMcpResultProperty(result, "focused");

  if (
    !["opened", "already_open"].includes(status) ||
    !PORTFOLIO_WEBMCP_LOCALES.includes(locale) ||
    dialogId !== "ask-nhan-dialog" ||
    focusId !== "ask-nhan-input" ||
    focused !== true
  ) {
    throw new TypeError("WebMCP action returned an unsupported result.");
  }

  return Object.freeze({ status, locale, dialogId, focusId, focused });
}

function normalizeCloseAskNhanResult(result) {
  const status = readWebMcpResultString(result, "status");
  const locale = readWebMcpResultString(result, "locale");
  const dialogId = readWebMcpResultString(result, "dialogId");
  const open = readWebMcpResultProperty(result, "open");
  const focusRestored = readWebMcpResultProperty(result, "focusRestored");

  if (
    !["closed", "already_closed"].includes(status) ||
    !PORTFOLIO_WEBMCP_LOCALES.includes(locale) ||
    dialogId !== "ask-nhan-dialog" ||
    open !== false ||
    (status === "closed" && focusRestored !== true) ||
    (status === "already_closed" && focusRestored !== false)
  ) {
    throw new TypeError("WebMCP action returned an unsupported result.");
  }

  return Object.freeze({ status, locale, dialogId, open, focusRestored });
}

function normalizeOverviewResult(result) {
  const overview = readExactWebMcpResultObject(result, [
    "status",
    "locale",
    "path",
    "profile",
    "sections",
    "caseStudies",
    "product",
    "contactOptions",
  ]);
  const status = requireBoundedWebMcpString(overview.status, {
    allowedValues: ["read"],
  });
  const locale = requireBoundedWebMcpString(overview.locale, {
    allowedValues: PORTFOLIO_WEBMCP_LOCALES,
  });
  const path = requireBoundedWebMcpString(overview.path, {
    allowedValues: [`/${locale}`],
  });

  const profileInput = readExactWebMcpResultObject(overview.profile, [
    "name",
    "role",
    "location",
  ]);
  const profile = Object.freeze({
    name: requireBoundedWebMcpString(profileInput.name, {
      allowedValues: ["Trần Thiện Nhân"],
    }),
    role: requireBoundedWebMcpString(profileInput.role),
    location: requireBoundedWebMcpString(profileInput.location),
  });

  const sectionInputs = readExactWebMcpResultArray(
    overview.sections,
    PORTFOLIO_WEBMCP_OVERVIEW_TARGETS.length,
  );
  const sections = Object.freeze(
    sectionInputs.map((item, index) => {
      const section = readExactWebMcpResultObject(item, ["target", "label"]);
      return Object.freeze({
        target: requireBoundedWebMcpString(section.target, {
          allowedValues: [PORTFOLIO_WEBMCP_OVERVIEW_TARGETS[index]],
        }),
        label: requireBoundedWebMcpString(section.label),
      });
    }),
  );

  const caseTargets = PORTFOLIO_WEBMCP_NAVIGATION_TARGETS.filter((target) =>
    target.startsWith("work-"),
  );
  const caseStudyInputs = readExactWebMcpResultArray(
    overview.caseStudies,
    caseTargets.length,
  );
  const caseStudies = Object.freeze(
    caseStudyInputs.map((item, index) => {
      const caseStudy = readExactWebMcpResultObject(item, [
        "target",
        "title",
        "status",
        "dates",
      ]);
      return Object.freeze({
        target: requireBoundedWebMcpString(caseStudy.target, {
          allowedValues: [caseTargets[index]],
        }),
        title: requireBoundedWebMcpString(caseStudy.title),
        status: requireBoundedWebMcpString(caseStudy.status),
        dates: requireBoundedWebMcpString(caseStudy.dates),
      });
    }),
  );

  const productInput = readExactWebMcpResultObject(overview.product, [
    "name",
    "route",
    "aboutRoute",
  ]);
  const product = Object.freeze({
    name: requireBoundedWebMcpString(productInput.name, {
      allowedValues: ["X Nhân"],
    }),
    route: requireBoundedWebMcpString(productInput.route, {
      allowedValues: ["/xnhan"],
    }),
    aboutRoute: requireBoundedWebMcpString(productInput.aboutRoute, {
      allowedValues: ["/xnhan/about"],
    }),
  });

  const contactKinds = Object.freeze(["email", "linkedin", "x"]);
  const contactInputs = readExactWebMcpResultArray(
    overview.contactOptions,
    contactKinds.length,
  );
  const contactOptions = Object.freeze(
    contactInputs.map((item, index) => {
      const contact = readExactWebMcpResultObject(item, [
        "kind",
        "label",
        "value",
        "href",
      ]);
      const kind = requireBoundedWebMcpString(contact.kind, {
        allowedValues: [contactKinds[index]],
      });
      const label = requireBoundedWebMcpString(contact.label);
      const value = requireBoundedWebMcpString(contact.value);
      const href = requireBoundedWebMcpString(contact.href);
      if (
        (kind === "email" && href !== `mailto:${value}`) ||
        (kind === "linkedin" && !href.startsWith("https://www.linkedin.com/")) ||
        (kind === "x" && href !== "https://x.com/tran_thien_nhan")
      ) {
        throw new TypeError("WebMCP action returned an unsupported result.");
      }
      return Object.freeze({ kind, label, value, href });
    }),
  );

  return Object.freeze({
    status,
    locale,
    path,
    profile,
    sections,
    caseStudies,
    product,
    contactOptions,
  });
}

export function createPortfolioWebMcpTools(actions, options = {}) {
  const navigatePortfolioSection = requireWebMcpAction(actions, "navigatePortfolioSection");
  const setPortfolioLocale = requireWebMcpAction(actions, "setPortfolioLocale");
  const openAskNhan = requireWebMcpAction(actions, "openAskNhan");
  const closeAskNhan = requireWebMcpAction(actions, "closeAskNhan");
  const readPortfolioOverview = requireWebMcpAction(actions, "readPortfolioOverview");
  const signal = resolveWebMcpLifecycleSignal(options.signal);
  const runSerializedAction = createSerializedWebMcpActionRunner(signal);

  return Object.freeze([
    Object.freeze({
      name: PORTFOLIO_WEBMCP_TOOL_NAMES.navigatePortfolioSection,
      title: "Navigate portfolio section · Điều hướng mục hồ sơ",
      description:
        "Close any open portfolio menu or Ask Nhân popup without clearing its in-memory conversation or draft or cancelling an Ask request, update the URL hash, scroll an allowed section into view, and move focus to its heading after navigation finishes.",
      inputSchema: NAVIGATION_INPUT_SCHEMA,
      annotations: MUTATING_LOCAL_ANNOTATIONS,
      async execute(input, { signal: executionSignal } = {}) {
        const target = validateExactWebMcpInput(
          input,
          "target",
          PORTFOLIO_WEBMCP_NAVIGATION_TARGETS,
        );
        return await runSerializedAction(
          navigatePortfolioSection,
          [target],
          executionSignal,
          (result) => normalizeNavigationResult(result, target),
        );
      },
    }),
    Object.freeze({
      name: PORTFOLIO_WEBMCP_TOOL_NAMES.setPortfolioLocale,
      title: "Set portfolio locale · Đặt ngôn ngữ hồ sơ",
      description:
        "Switch the visible portfolio between English and Vietnamese while preserving the current hash; an actual locale change aborts and resets the in-memory Ask Nhân state and triggers the existing GPC-aware visit tracking.",
      inputSchema: LOCALE_INPUT_SCHEMA,
      annotations: MUTATING_LOCAL_ANNOTATIONS,
      async execute(input, { signal: executionSignal } = {}) {
        const locale = validateExactWebMcpInput(
          input,
          "locale",
          PORTFOLIO_WEBMCP_LOCALES,
        );
        return await runSerializedAction(
          setPortfolioLocale,
          [locale],
          executionSignal,
          (result) => normalizeLocaleResult(result, locale),
        );
      },
    }),
    Object.freeze({
      name: PORTFOLIO_WEBMCP_TOOL_NAMES.openAskNhan,
      title: "Open Ask Nhân · Mở Ask Nhân",
      description:
        "Close the portfolio menu, open the bottom-right Ask Nhân popup only when this tab has no user draft, conversation, or in-flight Ask request, and focus its question input without submitting a question or invoking AI; otherwise fail without opening it.",
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: MUTATING_LOCAL_ANNOTATIONS,
      async execute(input, { signal: executionSignal } = {}) {
        validateExactWebMcpInput(input, null);
        return await runSerializedAction(
          openAskNhan,
          [],
          executionSignal,
          normalizeOpenAskNhanResult,
        );
      },
    }),
    Object.freeze({
      name: PORTFOLIO_WEBMCP_TOOL_NAMES.closeAskNhan,
      title: "Close Ask Nhân · Đóng Ask Nhân",
      description:
        "Hide the open bottom-right Ask Nhân popup and restore focus to its launcher while preserving the in-memory conversation and draft; this does not submit a question, invoke AI, or cancel an Ask request already in progress.",
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: MUTATING_LOCAL_ANNOTATIONS,
      async execute(input, { signal: executionSignal } = {}) {
        validateExactWebMcpInput(input, null);
        return await runSerializedAction(
          closeAskNhan,
          [],
          executionSignal,
          normalizeCloseAskNhanResult,
        );
      },
    }),
    Object.freeze({
      name: PORTFOLIO_WEBMCP_TOOL_NAMES.readPortfolioOverview,
      title: "Read portfolio overview · Đọc tổng quan hồ sơ",
      description:
        "Read one concise, batched snapshot of the public portfolio currently rendered in English or Vietnamese, including profile, section labels, case-study status, X Nhân routes, and contact options; this does not navigate, open another app, submit data, or invoke AI. Đọc một ảnh chụp gọn của hồ sơ công khai đang hiển thị bằng tiếng Anh hoặc tiếng Việt; công cụ không điều hướng, mở ứng dụng khác, gửi dữ liệu hay gọi AI.",
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: READ_ONLY_TRUSTED_ANNOTATIONS,
      async execute(input, { signal: executionSignal } = {}) {
        validateExactWebMcpInput(input, null);
        return await runSerializedAction(
          readPortfolioOverview,
          [],
          executionSignal,
          normalizeOverviewResult,
        );
      },
    }),
  ]);
}

export function registerPortfolioWebMcpTools({
  actions,
  documentObject = globalThis.document,
  onRegistrationError,
} = {}) {
  return registerImperativeWebMcpCatalog({
    catalogKey: PORTFOLIO_WEBMCP_CATALOG,
    createTools: (signal) => createPortfolioWebMcpTools(actions, { signal }),
    documentObject,
    onRegistrationError,
  });
}

function createAbortError() {
  const error = new Error("WebMCP UI state wait was aborted.");
  error.name = "AbortError";
  return error;
}

function createTimeoutError() {
  const error = new Error("Timed out waiting for the WebMCP UI state.");
  error.name = "TimeoutError";
  return error;
}

export function waitForWebMcpState(predicate, options = {}) {
  if (typeof predicate !== "function") {
    return Promise.reject(new TypeError("WebMCP state predicate must be a function."));
  }

  const timeoutMs = options.timeoutMs ?? WEBMCP_STATE_TIMEOUT_MS;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > WEBMCP_STATE_MAX_TIMEOUT_MS
  ) {
    return Promise.reject(new RangeError("WebMCP state timeout is outside the supported range."));
  }

  const signal = options.signal;
  if (
    signal !== undefined &&
    (signal === null ||
      typeof signal.addEventListener !== "function" ||
      typeof signal.removeEventListener !== "function")
  ) {
    return Promise.reject(new TypeError("WebMCP state signal must be an AbortSignal."));
  }

  const setTimer = options.setTimer ?? globalThis.setTimeout.bind(globalThis);
  const clearTimer = options.clearTimer ?? globalThis.clearTimeout.bind(globalThis);
  const scheduleFrame = options.scheduleFrame ?? (
    typeof globalThis.requestAnimationFrame === "function"
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : (callback) => setTimer(() => callback(Date.now()), 16)
  );
  const cancelFrame = options.cancelFrame ?? (
    typeof globalThis.cancelAnimationFrame === "function"
      ? globalThis.cancelAnimationFrame.bind(globalThis)
      : clearTimer
  );

  if (
    typeof setTimer !== "function" ||
    typeof clearTimer !== "function" ||
    typeof scheduleFrame !== "function" ||
    typeof cancelFrame !== "function"
  ) {
    return Promise.reject(new TypeError("WebMCP state scheduling functions are unavailable."));
  }

  if (signal?.aborted) return Promise.reject(createAbortError());

  return new Promise((resolve, reject) => {
    let settled = false;
    let frameId;
    let timerId;

    const cleanup = () => {
      if (frameId !== undefined) cancelFrame(frameId);
      if (timerId !== undefined) clearTimer(timerId);
      signal?.removeEventListener("abort", handleAbort);
    };

    const settle = (handler, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    };

    const handleAbort = () => settle(reject, createAbortError());
    const checkState = () => {
      if (signal?.aborted) {
        handleAbort();
        return;
      }

      let stateIsReady;
      try {
        stateIsReady = Boolean(predicate());
      } catch {
        settle(reject, new Error("WebMCP UI state check failed."));
        return;
      }

      if (stateIsReady) {
        settle(resolve, true);
        return;
      }

      try {
        frameId = scheduleFrame(checkState);
      } catch {
        settle(reject, new Error("WebMCP UI state scheduling failed."));
      }
    };

    signal?.addEventListener("abort", handleAbort, { once: true });
    try {
      timerId = setTimer(
        () => settle(reject, createTimeoutError()),
        timeoutMs,
      );
    } catch {
      settle(reject, new Error("WebMCP UI state timer failed."));
      return;
    }

    checkState();
  });
}
