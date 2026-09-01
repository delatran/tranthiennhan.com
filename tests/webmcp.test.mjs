import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PORTFOLIO_WEBMCP_LOCALES,
  PORTFOLIO_WEBMCP_NAVIGATION_TARGETS,
  PORTFOLIO_WEBMCP_OVERVIEW_TARGETS,
  PORTFOLIO_WEBMCP_TOOL_NAMES,
  createPortfolioWebMcpTools,
  registerPortfolioWebMcpTools,
  waitForWebMcpState,
} from "../src/webmcp.js";
import {
  portfolioOverviewForLocale,
  portfolioOverviewMatchesDocument,
} from "../src/portfolio-webmcp.js";
import { content } from "../src/content.js";
import { TARGET_FOCUS_IDS } from "../src/components/navigation.js";

const webMcpSourcePath = fileURLToPath(new URL("../src/webmcp.js", import.meta.url));
const webMcpRuntimeSourcePath = fileURLToPath(
  new URL("../src/webmcp-runtime.js", import.meta.url),
);
const webMcpAdapterSourcePath = fileURLToPath(
  new URL("../src/portfolio-webmcp.js", import.meta.url),
);

function createActions(overrides = {}) {
  const focusIds = {
    top: "hero-title",
    work: "work-title",
    "work-call-scoring": "case-title-call-scoring",
    "work-document-ai": "case-title-document-ai",
    "work-lora-audit": "case-title-lora-audit",
    product: "product-title",
    experience: "experience-title",
    about: "approach-title",
    contact: "contact-title",
  };
  return {
    async navigatePortfolioSection(target) {
      return {
        status: "navigated",
        target,
        focusId: focusIds[target],
        focused: true,
        locale: "en",
        path: "/en",
        hash: `#${target}`,
      };
    },
    async setPortfolioLocale(locale) {
      return { status: "changed", locale, path: `/${locale}` };
    },
    async openAskNhan() {
      return {
        status: "opened",
        locale: "en",
        dialogId: "ask-nhan-dialog",
        focusId: "ask-nhan-input",
        focused: true,
      };
    },
    async closeAskNhan() {
      return {
        status: "closed",
        locale: "en",
        dialogId: "ask-nhan-dialog",
        open: false,
        focusRestored: true,
      };
    },
    async readPortfolioOverview() {
      return portfolioOverviewForLocale("en");
    },
    ...overrides,
  };
}

function createOverviewDocumentFixture(overview) {
  const element = (textContent = "", attributes = {}) => ({
    textContent,
    getAttribute(name) {
      return Object.hasOwn(attributes, name) ? attributes[name] : null;
    },
  });
  const elements = new Map();
  const headingIds = [
    "hero-title",
    "work-title",
    "product-title",
    "experience-title",
    "approach-title",
    "contact-title",
  ];
  for (const [index, section] of overview.sections.entries()) {
    elements.set(section.target, element());
    elements.set(
      headingIds[index],
      section.target === "top"
        ? element(overview.profile.name, { "aria-label": overview.profile.name })
        : element(section.label),
    );
  }
  for (const caseStudy of overview.caseStudies) {
    elements.set(caseStudy.target, element());
    elements.set(
      `case-title-${caseStudy.target.slice("work-".length)}`,
      element(caseStudy.title),
    );
  }
  const anchors = [
    overview.product.route,
    overview.product.aboutRoute,
    ...overview.contactOptions.map(({ href }) => href),
  ].map((href) => element("", { href }));
  const selectorElements = new Map([
    [".hero-role", element(overview.profile.role)],
    [".hero-location", element(overview.profile.location)],
  ]);

  return {
    anchors,
    documentObject: {
      documentElement: { lang: overview.locale },
      getElementById(id) {
        return elements.get(id) ?? null;
      },
      querySelector(selector) {
        return selectorElements.get(selector) ?? null;
      },
      querySelectorAll(selector) {
        return selector === "a[href]" ? anchors : [];
      },
    },
    elements,
    locationObject: { pathname: overview.path },
  };
}

test("publishes the exact bounded WebMCP catalog, schemas, and mutation annotations", () => {
  assert.deepEqual(PORTFOLIO_WEBMCP_TOOL_NAMES, {
    navigatePortfolioSection: "navigate_portfolio_section",
    setPortfolioLocale: "set_portfolio_locale",
    openAskNhan: "open_ask_nhan",
    closeAskNhan: "close_ask_nhan",
    readPortfolioOverview: "read_portfolio_overview",
  });
  assert.deepEqual(PORTFOLIO_WEBMCP_NAVIGATION_TARGETS, [
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
  assert.deepEqual(PORTFOLIO_WEBMCP_LOCALES, ["en", "vi"]);
  assert.deepEqual(PORTFOLIO_WEBMCP_OVERVIEW_TARGETS, [
    "top",
    "work",
    "product",
    "experience",
    "about",
    "contact",
  ]);

  const tools = createPortfolioWebMcpTools(createActions());
  assert.deepEqual(tools.map(({ name }) => name), [
    "navigate_portfolio_section",
    "set_portfolio_locale",
    "open_ask_nhan",
    "close_ask_nhan",
    "read_portfolio_overview",
  ]);
  assert.equal(new Set(tools.map(({ name }) => name)).size, 5);
  assert.deepEqual(tools.map(({ title }) => title), [
    "Navigate portfolio section · Điều hướng mục hồ sơ",
    "Set portfolio locale · Đặt ngôn ngữ hồ sơ",
    "Open Ask Nhân · Mở Ask Nhân",
    "Close Ask Nhân · Đóng Ask Nhân",
    "Read portfolio overview · Đọc tổng quan hồ sơ",
  ]);

  assert.deepEqual(tools[0].inputSchema, {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: "Allowlisted portfolio section to bring into view.",
        enum: [
          "top",
          "work",
          "work-call-scoring",
          "work-document-ai",
          "work-lora-audit",
          "product",
          "experience",
          "about",
          "contact",
        ],
      },
    },
    required: ["target"],
    additionalProperties: false,
  });
  assert.deepEqual(tools[1].inputSchema, {
    type: "object",
    properties: {
      locale: {
        type: "string",
        description: "Visible portfolio language: English or Vietnamese.",
        enum: ["en", "vi"],
      },
    },
    required: ["locale"],
    additionalProperties: false,
  });
  for (const tool of tools.slice(2)) {
    assert.deepEqual(tool.inputSchema, {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  }

  for (const tool of tools.slice(0, 4)) {
    assert.deepEqual(tool.annotations, {
      readOnlyHint: false,
      untrustedContentHint: false,
    });
  }
  assert.deepEqual(tools[4].annotations, {
    readOnlyHint: true,
    untrustedContentHint: false,
  });

  assert.deepEqual(tools.map(({ description }) => description), [
    "Close any open portfolio menu or Ask Nhân popup without clearing its in-memory conversation or draft or cancelling an Ask request, update the URL hash, scroll an allowed section into view, and move focus to its heading after navigation finishes.",
    "Switch the visible portfolio between English and Vietnamese while preserving the current hash; an actual locale change aborts and resets the in-memory Ask Nhân state and triggers the existing GPC-aware visit tracking.",
    "Close the portfolio menu, open the bottom-right Ask Nhân popup only when this tab has no user draft, conversation, or in-flight Ask request, and focus its question input without submitting a question or invoking AI; otherwise fail without opening it.",
    "Hide the open bottom-right Ask Nhân popup and restore focus to its launcher while preserving the in-memory conversation and draft; this does not submit a question, invoke AI, or cancel an Ask request already in progress.",
    "Read one concise, batched snapshot of the public portfolio currently rendered in English or Vietnamese, including profile, section labels, case-study status, X Nhân routes, and contact options; this does not navigate, open another app, submit data, or invoke AI. Đọc một ảnh chụp gọn của hồ sơ công khai đang hiển thị bằng tiếng Anh hoặc tiếng Việt; công cụ không điều hướng, mở ứng dụng khác, gửi dữ liệu hay gọi AI.",
  ]);
});

test("keeps WebMCP work targets aligned with bilingual content and navigation focus", () => {
  const workTargets = PORTFOLIO_WEBMCP_NAVIGATION_TARGETS.filter((target) =>
    target.startsWith("work-"),
  );
  const expectedWorkTargets = content.en.work.items.map(
    ({ slug }) => `work-${slug}`,
  );

  assert.deepEqual(workTargets, expectedWorkTargets);
  assert.deepEqual(
    content.vi.work.items.map(({ slug }) => `work-${slug}`),
    expectedWorkTargets,
  );
  for (const target of PORTFOLIO_WEBMCP_NAVIGATION_TARGETS) {
    assert.equal(typeof TARGET_FOCUS_IDS[target], "string");
  }
  for (const target of workTargets) {
    assert.equal(
      TARGET_FOCUS_IDS[target],
      `case-title-${target.slice("work-".length)}`,
    );
  }
});

test("reads one exact, trusted, locale-synchronized overview of all public portfolio sections", async () => {
  for (const locale of PORTFOLIO_WEBMCP_LOCALES) {
    const expected = portfolioOverviewForLocale(locale);
    const tools = createPortfolioWebMcpTools(createActions({
      async readPortfolioOverview() {
        return expected;
      },
    }));
    const output = await tools[4].execute({});

    assert.deepEqual(output, expected);
    assert.equal(output.locale, locale);
    assert.equal(output.path, `/${locale}`);
    assert.deepEqual(
      output.sections.map(({ target }) => target),
      PORTFOLIO_WEBMCP_OVERVIEW_TARGETS,
    );
    assert.deepEqual(
      output.caseStudies.map(({ target }) => target),
      content[locale].work.items.map(({ slug }) => `work-${slug}`),
    );
    assert.deepEqual(output.product, {
      name: "X Nhân",
      route: "/xnhan",
      aboutRoute: "/xnhan/about",
    });
    assert.deepEqual(
      output.contactOptions.map(({ kind }) => kind),
      ["email", "linkedin", "x"],
    );
    assert.deepEqual(output.contactOptions.at(-1), {
      kind: "x",
      label: locale === "vi" ? "Xem hồ sơ X" : "View X profile",
      value: "@tran_thien_nhan",
      href: "https://x.com/tran_thien_nhan",
    });
    assert.equal(Object.isFrozen(output), true);
    assert.equal(Object.isFrozen(output.sections), true);
    assert.doesNotThrow(() => JSON.stringify(output));
  }

  assert.throws(() => portfolioOverviewForLocale("fr"), TypeError);
});

test("releases an overview only when its EN or VI route, headings, cases, and links are visible", () => {
  for (const locale of PORTFOLIO_WEBMCP_LOCALES) {
    const overview = portfolioOverviewForLocale(locale);
    const fixture = createOverviewDocumentFixture(overview);
    const options = {
      documentObject: fixture.documentObject,
      locationObject: fixture.locationObject,
    };

    assert.equal(portfolioOverviewMatchesDocument(overview, options), true);

    fixture.locationObject.pathname = locale === "en" ? "/vi" : "/en";
    assert.equal(portfolioOverviewMatchesDocument(overview, options), false);
    fixture.locationObject.pathname = overview.path;

    fixture.documentObject.documentElement.lang = locale === "en" ? "vi" : "en";
    assert.equal(portfolioOverviewMatchesDocument(overview, options), false);
    fixture.documentObject.documentElement.lang = locale;

    const workHeading = fixture.elements.get("work-title");
    const visibleWorkTitle = workHeading.textContent;
    workHeading.textContent = "stale locale";
    assert.equal(portfolioOverviewMatchesDocument(overview, options), false);
    workHeading.textContent = visibleWorkTitle;

    const removedContact = fixture.anchors.pop();
    assert.equal(portfolioOverviewMatchesDocument(overview, options), false);
    fixture.anchors.push(removedContact);
    assert.equal(portfolioOverviewMatchesDocument(overview, options), true);
  }
});

test("rejects malformed overview input and nested accessor, symbol, or prototype output", async () => {
  let readCalls = 0;
  const base = portfolioOverviewForLocale("en");
  const tools = createPortfolioWebMcpTools(createActions({
    async readPortfolioOverview() {
      readCalls += 1;
      return base;
    },
  }));
  const readOverview = tools[4];

  for (const input of [
    null,
    [],
    { locale: "en" },
    Object.assign(Object.create(null), { extra: true }),
    { [Symbol("private")]: true },
    Object.defineProperty({}, "private", { get() { return "secret"; } }),
  ]) {
    await assert.rejects(readOverview.execute(input), TypeError);
  }
  assert.equal(readCalls, 0);

  const invalidOutputs = [
    Object.assign(Object.create(null), base),
    { ...base, profile: Object.create({ name: "Trần Thiện Nhân" }) },
    {
      ...base,
      profile: Object.defineProperty(
        { role: base.profile.role, location: base.profile.location },
        "name",
        { enumerable: true, get() { return "Trần Thiện Nhân"; } },
      ),
    },
    {
      ...base,
      sections: base.sections.map((section, index) =>
        index === 0 ? { ...section, [Symbol("private")]: true } : section,
      ),
    },
    { ...base, contactOptions: new Proxy(base.contactOptions, {
      ownKeys() { throw new Error("private-marker"); },
    }) },
  ];

  for (const result of invalidOutputs) {
    const invalidTools = createPortfolioWebMcpTools(createActions({
      async readPortfolioOverview() {
        return result;
      },
    }));
    await assert.rejects(
      invalidTools[4].execute({}),
      (error) => error instanceof TypeError && !error.message.includes("private-marker"),
    );
  }
});

test("applies the shared runtime's ordinary-record boundary without invoking hostile traps", async () => {
  let navigationCalls = 0;
  const [navigate] = createPortfolioWebMcpTools(createActions({
    async navigatePortfolioSection() {
      navigationCalls += 1;
    },
  }));
  const nullPrototypeInput = Object.assign(Object.create(null), {
    target: "about",
  });
  let accessorCalls = 0;
  const accessorInput = {};
  Object.defineProperty(accessorInput, "target", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return "about";
    },
  });
  const hostileInput = new Proxy({ target: "about" }, {
    ownKeys() {
      throw new Error("PRIVATE_RUNTIME_TRAP");
    },
  });

  for (const input of [nullPrototypeInput, accessorInput, hostileInput]) {
    await assert.rejects(
      navigate.execute(input),
      (error) =>
        error instanceof TypeError &&
        !error.message.includes("PRIVATE_RUNTIME_TRAP"),
    );
  }
  assert.equal(accessorCalls, 0);
  assert.equal(navigationCalls, 0);

  await assert.rejects(
    navigate.execute({ target: "about" }, {
      signal: {
        aborted: false,
        addEventListener() {},
        removeEventListener() {},
      },
    }),
    TypeError,
  );
  assert.equal(navigationCalls, 0);
});

test("awaits each visible UI action and returns only its resolved result", async () => {
  let releaseNavigation;
  let receivedTarget;
  let receivedSignal;
  const result = {
    status: "navigated",
    target: "about",
    focusId: "approach-title",
    focused: true,
    locale: "en",
    path: "/en",
    hash: "#about",
  };
  const actionPending = new Promise((resolve) => {
    releaseNavigation = () => resolve(result);
  });
  const tools = createPortfolioWebMcpTools(createActions({
    async navigatePortfolioSection(target, { signal }) {
      receivedTarget = target;
      receivedSignal = signal;
      return await actionPending;
    },
  }));

  let settled = false;
  const execution = tools[0].execute({ target: "about" }).then((value) => {
    settled = true;
    return value;
  });
  await Promise.resolve();

  assert.equal(settled, false);
  assert.equal(receivedTarget, "about");
  assert.equal(receivedSignal instanceof AbortSignal, true);

  releaseNavigation();
  assert.deepEqual(await execution, result);
});

test("normalizes every action result to an exact JSON-serializable public shape", async () => {
  const cyclicPrivateState = { transcript: "must-not-escape" };
  cyclicPrivateState.self = cyclicPrivateState;
  const tools = createPortfolioWebMcpTools(createActions({
    async navigatePortfolioSection(target) {
      return {
        status: "navigated",
        target,
        focusId: "work-title",
        focused: true,
        locale: "en",
        path: "/en",
        hash: "#work",
        privateState: cyclicPrivateState,
      };
    },
    async setPortfolioLocale(locale) {
      return {
        status: "changed",
        locale,
        path: `/${locale}`,
        hash: "#access_token=PRIVATE_FRAGMENT_MUST_NOT_ESCAPE",
        privateState: cyclicPrivateState,
      };
    },
    async openAskNhan() {
      return {
        status: "already_open",
        locale: "vi",
        dialogId: "ask-nhan-dialog",
        focusId: "ask-nhan-input",
        focused: true,
        privateState: cyclicPrivateState,
      };
    },
    async closeAskNhan() {
      return {
        status: "closed",
        locale: "vi",
        dialogId: "ask-nhan-dialog",
        open: false,
        focusRestored: true,
        privateState: cyclicPrivateState,
      };
    },
  }));

  const results = [
    await tools[0].execute({ target: "work" }),
    await tools[1].execute({ locale: "vi" }),
    await tools[2].execute({}),
    await tools[3].execute({}),
  ];
  assert.deepEqual(results, [
    {
      status: "navigated",
      target: "work",
      focusId: "work-title",
      focused: true,
      locale: "en",
      path: "/en",
      hash: "#work",
    },
    { status: "changed", locale: "vi", path: "/vi" },
    {
      status: "already_open",
      locale: "vi",
      dialogId: "ask-nhan-dialog",
      focusId: "ask-nhan-input",
      focused: true,
    },
    {
      status: "closed",
      locale: "vi",
      dialogId: "ask-nhan-dialog",
      open: false,
      focusRestored: true,
    },
  ]);
  for (const result of results) {
    assert.doesNotThrow(() => JSON.stringify(result));
    assert.equal(Object.hasOwn(result, "privateState"), false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FRAGMENT_MUST_NOT_ESCAPE/u);
  }

  const invalidResultTools = createPortfolioWebMcpTools(createActions({
    async navigatePortfolioSection() {
      return cyclicPrivateState;
    },
  }));
  await assert.rejects(
    invalidResultTools[0].execute({ target: "work" }),
    (error) => error instanceof TypeError && !error.message.includes("must-not-escape"),
  );

  const unfocusedNavigationTools = createPortfolioWebMcpTools(createActions({
    async navigatePortfolioSection(target) {
      return {
        status: "navigated",
        target,
        focusId: "work-title",
        focused: false,
        locale: "en",
        path: "/en",
        hash: "#work",
      };
    },
  }));
  await assert.rejects(
    unfocusedNavigationTools[0].execute({ target: "work" }),
    TypeError,
  );

  const unfocusedOpenTools = createPortfolioWebMcpTools(createActions({
    async openAskNhan() {
      return {
        status: "already_open",
        locale: "en",
        dialogId: "ask-nhan-dialog",
        focusId: "ask-nhan-input",
        focused: false,
      };
    },
  }));
  await assert.rejects(unfocusedOpenTools[2].execute({}), TypeError);

  const invalidCloseTools = createPortfolioWebMcpTools(createActions({
    async closeAskNhan() {
      return {
        status: "closed",
        locale: "en",
        dialogId: "ask-nhan-dialog",
        open: false,
        focusRestored: false,
      };
    },
  }));
  await assert.rejects(invalidCloseTools[3].execute({}), TypeError);
});

test("combines per-execution cancellation with the catalog lifecycle signal", async () => {
  let actionSignal;
  const tools = createPortfolioWebMcpTools(createActions({
    async openAskNhan({ signal }) {
      actionSignal = signal;
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
  const pending = tools[2].execute({}, { signal: execution.signal });
  await Promise.resolve();

  assert.notEqual(actionSignal, execution.signal);
  assert.equal(actionSignal.aborted, false);
  execution.abort();

  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(actionSignal.aborted, true);
});

test("serializes all UI mutations before the next tool begins", async () => {
  const events = [];
  let releaseNavigation;
  const navigationPending = new Promise((resolve) => {
    releaseNavigation = resolve;
  });
  const tools = createPortfolioWebMcpTools(createActions({
    async navigatePortfolioSection(target) {
      events.push(`navigation:start:${target}`);
      await navigationPending;
      events.push(`navigation:end:${target}`);
      return {
        status: "navigated",
        target,
        focusId: "approach-title",
        focused: true,
        locale: "en",
        path: "/en",
        hash: "#about",
      };
    },
    async setPortfolioLocale(locale) {
      events.push(`locale:${locale}`);
      return { status: "changed", locale, path: `/${locale}` };
    },
  }));

  const navigation = tools[0].execute({ target: "about" });
  const locale = tools[1].execute({ locale: "vi" });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ["navigation:start:about"]);

  releaseNavigation();
  assert.equal((await navigation).target, "about");
  assert.deepEqual(await locale, {
    status: "changed",
    locale: "vi",
    path: "/vi",
  });
  assert.deepEqual(events, [
    "navigation:start:about",
    "navigation:end:about",
    "locale:vi",
  ]);
});

test("rejects a queued close cancellation before its UI action can mutate state", async () => {
  let releaseNavigation;
  let closeCalls = 0;
  const navigationPending = new Promise((resolve) => {
    releaseNavigation = resolve;
  });
  const tools = createPortfolioWebMcpTools(createActions({
    async navigatePortfolioSection(target) {
      await navigationPending;
      return {
        status: "navigated",
        target,
        focusId: "approach-title",
        focused: true,
        locale: "en",
        path: "/en",
        hash: "#about",
      };
    },
    async closeAskNhan() {
      closeCalls += 1;
      return {
        status: "already_closed",
        locale: "en",
        dialogId: "ask-nhan-dialog",
        open: false,
        focusRestored: false,
      };
    },
  }));
  const execution = new AbortController();

  const navigation = tools[0].execute({ target: "about" });
  const close = tools[3].execute({}, { signal: execution.signal });
  execution.abort();
  await assert.rejects(close, { name: "AbortError" });
  assert.equal(closeCalls, 0);

  releaseNavigation();
  await navigation;
  await Promise.resolve();
  assert.equal(closeCalls, 0);
});

test("serializes open then close and preserves idempotent close semantics", async () => {
  const events = [];
  let releaseOpen;
  let open = false;
  const openPending = new Promise((resolve) => {
    releaseOpen = resolve;
  });
  const tools = createPortfolioWebMcpTools(createActions({
    async openAskNhan() {
      events.push("open:start");
      await openPending;
      open = true;
      events.push("open:end");
      return {
        status: "opened",
        locale: "en",
        dialogId: "ask-nhan-dialog",
        focusId: "ask-nhan-input",
        focused: true,
      };
    },
    async closeAskNhan(_options) {
      events.push(`close:${open ? "open" : "closed"}`);
      if (!open) {
        return {
          status: "already_closed",
          locale: "en",
          dialogId: "ask-nhan-dialog",
          open: false,
          focusRestored: false,
        };
      }
      open = false;
      return {
        status: "closed",
        locale: "en",
        dialogId: "ask-nhan-dialog",
        open: false,
        focusRestored: true,
      };
    },
  }));

  const opening = tools[2].execute({});
  const closing = tools[3].execute({});
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ["open:start"]);

  releaseOpen();
  assert.equal((await opening).focused, true);
  assert.deepEqual(await closing, {
    status: "closed",
    locale: "en",
    dialogId: "ask-nhan-dialog",
    open: false,
    focusRestored: true,
  });
  assert.deepEqual(await tools[3].execute({}), {
    status: "already_closed",
    locale: "en",
    dialogId: "ask-nhan-dialog",
    open: false,
    focusRestored: false,
  });
  assert.deepEqual(events, ["open:start", "open:end", "close:open", "close:closed"]);
});

test("rejects non-exact inputs before any UI action and never echoes raw values", async () => {
  const calls = { navigate: 0, locale: 0, open: 0, close: 0, read: 0 };
  const [navigate, setLocale, openAsk, closeAsk, readOverview] = createPortfolioWebMcpTools({
    async navigatePortfolioSection() {
      calls.navigate += 1;
    },
    async setPortfolioLocale() {
      calls.locale += 1;
    },
    async openAskNhan() {
      calls.open += 1;
    },
    async closeAskNhan() {
      calls.close += 1;
    },
    async readPortfolioOverview() {
      calls.read += 1;
    },
  });

  const secretMarker = "PRIVATE_INPUT_MUST_NOT_BE_ECHOED";
  const invalidNavigationInputs = [
    null,
    [],
    "about",
    {},
    { target: "main-content" },
    { target: "about", extra: true },
    { target: secretMarker },
    Object.assign(Object.create(null), { target: "about", extra: true }),
    { [Symbol("target")]: "about" },
    new Proxy({ target: "about" }, {
      ownKeys() {
        throw new Error(secretMarker);
      },
    }),
  ];
  const invalidLocaleInputs = [
    undefined,
    1,
    [],
    {},
    { locale: "fr" },
    { locale: "vi", extra: true },
    { locale: secretMarker },
  ];
  const invalidOpenInputs = [null, [], 0, { submit: true }, { message: secretMarker }];
  const invalidCloseInputs = [null, [], 0, { cancel: true }, { message: secretMarker }];
  const invalidReadInputs = [null, [], 0, { include: "private" }, { message: secretMarker }];

  for (const input of invalidNavigationInputs) {
    await assert.rejects(
      navigate.execute(input),
      (error) => error instanceof TypeError && !error.message.includes(secretMarker),
    );
  }
  for (const input of invalidLocaleInputs) {
    await assert.rejects(
      setLocale.execute(input),
      (error) => error instanceof TypeError && !error.message.includes(secretMarker),
    );
  }
  for (const input of invalidOpenInputs) {
    await assert.rejects(
      openAsk.execute(input),
      (error) => error instanceof TypeError && !error.message.includes(secretMarker),
    );
  }
  for (const input of invalidCloseInputs) {
    await assert.rejects(
      closeAsk.execute(input),
      (error) => error instanceof TypeError && !error.message.includes(secretMarker),
    );
  }
  for (const input of invalidReadInputs) {
    await assert.rejects(
      readOverview.execute(input),
      (error) => error instanceof TypeError && !error.message.includes(secretMarker),
    );
  }

  assert.deepEqual(calls, { navigate: 0, locale: 0, open: 0, close: 0, read: 0 });
});

test("treats browsers without a callable imperative WebMCP registry as unsupported", async () => {
  const actions = createActions();
  const unsupportedDocuments = [
    undefined,
    {},
    { modelContext: {} },
    { modelContext: { registerTool: "not-a-function" } },
  ];

  for (const documentObject of unsupportedDocuments) {
    const registration = registerPortfolioWebMcpTools({ actions, documentObject });
    assert.equal(registration.supported, false);
    assert.equal(await registration.ready, false);
    assert.doesNotThrow(() => {
      registration.cleanup();
      registration.cleanup();
    });
  }

  const featureError = new Error("model-context-unavailable");
  const reported = [];
  const registration = registerPortfolioWebMcpTools({
    actions,
    documentObject: Object.defineProperty({}, "modelContext", {
      get() {
        throw featureError;
      },
    }),
    onRegistrationError: (error) => reported.push(error),
  });
  assert.equal(registration.supported, false);
  assert.equal(await registration.ready, false);
  assert.deepEqual(reported, [featureError]);
});

test("registers the complete catalog with one shared signal and idempotent cleanup", async () => {
  const registrations = [];
  const documentObject = {
    modelContext: {
      registerTool(tool, options) {
        registrations.push({ tool, options });
      },
    },
  };

  const registration = registerPortfolioWebMcpTools({
    actions: createActions(),
    documentObject,
  });
  assert.equal(registration.supported, true);
  assert.equal(await registration.ready, true);
  assert.deepEqual(registrations.map(({ tool }) => tool.name), [
    "navigate_portfolio_section",
    "set_portfolio_locale",
    "open_ask_nhan",
    "close_ask_nhan",
    "read_portfolio_overview",
  ]);
  assert.equal(registrations.length, 5);

  const signals = registrations.map(({ options }) => options.signal);
  assert.equal(new Set(signals).size, 1);
  assert.equal(signals[0].aborted, false);

  let abortEvents = 0;
  signals[0].addEventListener("abort", () => {
    abortEvents += 1;
  });
  registration.cleanup();
  registration.cleanup();
  assert.equal(signals[0].aborted, true);
  assert.equal(abortEvents, 1);
});

test("registers once for concurrent consumers, executes no action, and aborts on final release", async () => {
  const registrations = [];
  const calls = {
    navigate: 0,
    locale: 0,
    open: 0,
    close: 0,
    read: 0,
  };
  const actions = createActions({
    async navigatePortfolioSection() { calls.navigate += 1; },
    async setPortfolioLocale() { calls.locale += 1; },
    async openAskNhan() { calls.open += 1; },
    async closeAskNhan() { calls.close += 1; },
    async readPortfolioOverview() { calls.read += 1; },
  });
  const documentObject = {
    modelContext: {
      registerTool(tool, options) {
        registrations.push({ tool, options });
      },
    },
  };

  const first = registerPortfolioWebMcpTools({ actions, documentObject });
  const duplicate = registerPortfolioWebMcpTools({ actions, documentObject });
  assert.equal(first.ready, duplicate.ready);
  assert.equal(await first.ready, true);
  assert.equal(await duplicate.ready, true);
  assert.equal(registrations.length, 5);
  assert.deepEqual(calls, {
    navigate: 0,
    locale: 0,
    open: 0,
    close: 0,
    read: 0,
  });

  const signal = registrations[0].options.signal;
  first.cleanup();
  assert.equal(signal.aborted, false);
  duplicate.cleanup();
  duplicate.cleanup();
  assert.equal(signal.aborted, true);

  const remount = registerPortfolioWebMcpTools({ actions, documentObject });
  assert.equal(await remount.ready, true);
  assert.equal(registrations.length, 10);
  assert.notEqual(registrations[5].options.signal, signal);
  remount.cleanup();
});

test("lifecycle cleanup cancels an execution already waiting on visible UI state", async () => {
  const registeredTools = [];
  let actionSignal;
  const registration = registerPortfolioWebMcpTools({
    actions: createActions({
      async openAskNhan({ signal }) {
        actionSignal = signal;
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
        registerTool(tool) {
          registeredTools.push(tool);
        },
      },
    },
  });

  assert.equal(await registration.ready, true);
  const pending = registeredTools[2].execute({});
  await Promise.resolve();
  assert.equal(actionSignal.aborted, false);
  registration.cleanup();

  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(actionSignal.aborted, true);
});

test("contains a synchronous partial registration failure and aborts the catalog", async () => {
  const registrations = [];
  const reported = [];
  const failure = new Error("sync-registration-failure");
  const registration = registerPortfolioWebMcpTools({
    actions: createActions(),
    documentObject: {
      modelContext: {
        registerTool(tool, options) {
          registrations.push({ tool, options });
          if (registrations.length === 2) throw failure;
        },
      },
    },
    onRegistrationError: (error) => reported.push(error),
  });

  assert.equal(await registration.ready, false);
  assert.deepEqual(registrations.map(({ tool }) => tool.name), [
    "navigate_portfolio_section",
    "set_portfolio_locale",
  ]);
  assert.equal(registrations.every(({ options }) => options.signal.aborted), true);
  assert.deepEqual(reported, [failure]);
  assert.doesNotThrow(() => registration.cleanup());
});

test("contains an asynchronous partial registration failure without leaking a rejection", async () => {
  const registrations = [];
  const reported = [];
  const failure = new Error("async-registration-failure");
  const registration = registerPortfolioWebMcpTools({
    actions: createActions(),
    documentObject: {
      modelContext: {
        registerTool(tool, options) {
          registrations.push({ tool, options });
          return registrations.length === 2 ? Promise.reject(failure) : Promise.resolve();
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
});

test("shares a portfolio registration failure with every active consumer", async () => {
  const failure = new Error("shared-portfolio-registration-failure");
  const registrations = [];
  const firstReported = [];
  const secondReported = [];
  let rejectRegistration;
  let signalRegistration;
  const registrationStarted = new Promise((resolve) => {
    signalRegistration = resolve;
  });
  const documentObject = {
    modelContext: {
      registerTool(tool, options) {
        registrations.push({ tool, options });
        if (registrations.length === 1) return Promise.resolve();
        return new Promise((_resolve, reject) => {
          rejectRegistration = reject;
          signalRegistration();
        });
      },
    },
  };

  const first = registerPortfolioWebMcpTools({
    actions: createActions(),
    documentObject,
    onRegistrationError: (error) => firstReported.push(error),
  });
  const second = registerPortfolioWebMcpTools({
    actions: createActions(),
    documentObject,
    onRegistrationError: (error) => secondReported.push(error),
  });
  await registrationStarted;
  rejectRegistration(failure);

  assert.equal(await first.ready, false);
  assert.equal(await second.ready, false);
  assert.equal(first.ready, second.ready);
  assert.equal(registrations.length, 2);
  assert.equal(registrations[0].options.signal, registrations[1].options.signal);
  assert.equal(registrations[0].options.signal.aborted, true);
  assert.deepEqual(firstReported, [failure]);
  assert.deepEqual(secondReported, [failure]);
  first.cleanup();
  second.cleanup();
});

test("supports StrictMode-style cleanup and remount with independent lifecycles", async () => {
  const registrations = [];
  const documentObject = {
    modelContext: {
      registerTool(tool, options) {
        registrations.push({ tool, options });
      },
    },
  };

  const first = registerPortfolioWebMcpTools({
    actions: createActions(),
    documentObject,
  });
  assert.equal(await first.ready, true);
  const firstSignal = registrations[0].options.signal;
  first.cleanup();

  const second = registerPortfolioWebMcpTools({
    actions: createActions(),
    documentObject,
  });
  assert.equal(await second.ready, true);
  const secondSignal = registrations[5].options.signal;

  assert.notEqual(firstSignal, secondSignal);
  assert.equal(firstSignal.aborted, true);
  assert.equal(secondSignal.aborted, false);
  assert.equal(registrations.length, 10);
  second.cleanup();
  assert.equal(secondSignal.aborted, true);
});

test("settles a stalled StrictMode registration on cleanup before remounting once", async () => {
  const registrations = [];
  const documentObject = {
    modelContext: {
      registerTool(tool, options) {
        registrations.push({ tool, options });
        if (registrations.length === 1) return new Promise(() => {});
      },
    },
  };

  const first = registerPortfolioWebMcpTools({
    actions: createActions(),
    documentObject,
  });
  const firstSignal = registrations[0].options.signal;
  first.cleanup();

  const second = registerPortfolioWebMcpTools({
    actions: createActions(),
    documentObject,
  });
  assert.equal(await first.ready, false);
  assert.equal(await second.ready, true);
  assert.equal(firstSignal.aborted, true);
  assert.equal(registrations.length, 6);
  assert.equal(
    new Set(registrations.slice(1).map(({ options }) => options.signal)).size,
    1,
  );
  assert.equal(registrations[1].options.signal.aborted, false);
  second.cleanup();
  assert.equal(registrations[1].options.signal.aborted, true);
});

test("waits for animation-frame-visible state and respects abort and bounded timeout", async () => {
  const frames = new Map();
  let nextFrameId = 1;
  let visible = false;
  const stateWait = waitForWebMcpState(
    () => visible,
    {
      timeoutMs: 500,
      scheduleFrame(callback) {
        const frameId = nextFrameId;
        nextFrameId += 1;
        frames.set(frameId, callback);
        return frameId;
      },
      cancelFrame(frameId) {
        frames.delete(frameId);
      },
    },
  );

  assert.equal(frames.size, 1);
  visible = true;
  const [[, frameCallback]] = frames;
  frameCallback();
  assert.equal(await stateWait, true);

  const lifecycle = new AbortController();
  const abortedWait = waitForWebMcpState(() => false, {
    signal: lifecycle.signal,
    timeoutMs: 500,
  });
  lifecycle.abort();
  await assert.rejects(abortedWait, { name: "AbortError" });

  await assert.rejects(
    waitForWebMcpState(() => false, { timeoutMs: 10_001 }),
    RangeError,
  );
});

test("keeps WebMCP source isolated from chat data, network, storage, analytics, and privileged APIs", async () => {
  const source = (
    await Promise.all(
      [
        webMcpSourcePath,
        webMcpRuntimeSourcePath,
        webMcpAdapterSourcePath,
      ].map((path) => readFile(path, "utf8")),
    )
  ).join("\n");

  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /\bXMLHttpRequest\b/u);
  assert.doesNotMatch(source, /\bsendBeacon\s*\(/u);
  assert.doesNotMatch(source, /\bnavigator\s*\.\s*clipboard\b/u);
  assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB)\b/u);
  assert.doesNotMatch(source, /\bdocument\s*\.\s*cookie\b/u);
  assert.doesNotMatch(source, /\bnew\s+(?:Worker|SharedWorker)\s*\(/u);
  assert.doesNotMatch(source, /\bturnstile\b/iu);
  assert.doesNotMatch(source, /\banalytics\b/iu);

  const tools = createPortfolioWebMcpTools(createActions());
  assert.deepEqual(
    tools.flatMap(({ inputSchema }) => Object.keys(inputSchema.properties)),
    ["target", "locale"],
  );
  assert.doesNotMatch(source, /\/api\/ask/iu);
  assert.match(source, /without submitting a question or invoking AI/iu);
});
