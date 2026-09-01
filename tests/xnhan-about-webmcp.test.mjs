import assert from "node:assert/strict";
import test from "node:test";

import {
  createXNhanAboutWebMcpTools,
  registerXNhanAboutWebMcpTools,
  XNHAN_ABOUT_WEBMCP_TOOL_NAME,
  XNHAN_ABOUT_WEBMCP_TOOL_NAMES,
} from "../src/xnhan-about-webmcp.js";

function createOverview(locale = "en", path = "/xnhan/about") {
  return {
    status: "read",
    locale,
    path,
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
    routes: {
      product: `/xnhan?lang=${locale}`,
      portfolio: `/${locale}`,
    },
  };
}

function createActions(overrides = {}) {
  return {
    async readXNhanAboutOverview() {
      return createOverview();
    },
    async setXNhanAboutLocale(locale) {
      return { status: "changed", locale, path: "/xnhan/about" };
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

test("publishes one bounded read tool and one route-scoped locale tool", () => {
  const [readTool, localeTool] = createXNhanAboutWebMcpTools(createActions());
  assert.deepEqual(
    [readTool.name, localeTool.name],
    ["read_xnhan_about_overview", "set_xnhan_about_locale"],
  );
  assert.equal(readTool.name, XNHAN_ABOUT_WEBMCP_TOOL_NAMES.readOverview);
  assert.deepEqual(readTool.inputSchema.properties, {});
  assert.deepEqual(readTool.inputSchema.required, []);
  assert.equal(readTool.inputSchema.additionalProperties, false);
  assert.deepEqual(readTool.annotations, {
    readOnlyHint: true,
    untrustedContentHint: false,
  });
  assert.match(readTool.description, /does not read chat transcripts/iu);

  assert.equal(localeTool.name, XNHAN_ABOUT_WEBMCP_TOOL_NAME);
  assert.equal(localeTool.name, XNHAN_ABOUT_WEBMCP_TOOL_NAMES.setLocale);
  assert.deepEqual(localeTool.inputSchema.required, ["locale"]);
  assert.equal(
    localeTool.inputSchema.properties.locale.description,
    "Visible About page language: English or Vietnamese.",
  );
  assert.deepEqual(localeTool.inputSchema.properties.locale.enum, ["en", "vi"]);
  assert.equal(localeTool.inputSchema.additionalProperties, false);
  assert.deepEqual(localeTool.annotations, {
    readOnlyHint: false,
    untrustedContentHint: false,
  });
  assert.throws(
    () => createXNhanAboutWebMcpTools(createActions(), { signal: {} }),
    TypeError,
  );
});

test("reads only the bounded trusted public About overview", async () => {
  let receivedSignal;
  const [tool] = createXNhanAboutWebMcpTools(
    createActions({
      async readXNhanAboutOverview({ signal }) {
        receivedSignal = signal;
        return createOverview("vi", "/xnhan-about.html");
      },
    }),
  );

  const result = await tool.execute({});
  assert.equal(receivedSignal.aborted, false);
  assert.deepEqual(result, createOverview("vi", "/xnhan-about.html"));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.hero), true);
  assert.equal(Object.isFrozen(result.hero.titleLines), true);
  assert.equal(Object.isFrozen(result.sections), true);
  assert.equal(Object.isFrozen(result.sections[0]), true);
  assert.equal(Object.isFrozen(result.sections[0].highlights), true);
  assert.equal(Object.isFrozen(result.routes), true);
  assert.doesNotMatch(
    JSON.stringify(result),
    /transcript|history|storage|provider|analytics|prompt|credential/iu,
  );
});

test("requires an exact empty read input and a closed bounded overview result", async () => {
  const [tool] = createXNhanAboutWebMcpTools(createActions());
  const symbolInput = { [Symbol("hidden")]: true };
  const hostileInput = new Proxy({}, {
    getPrototypeOf() {
      throw new Error("private-input-marker");
    },
  });
  for (const input of [
    null,
    [],
    { extra: true },
    Object.create(null),
    Object.assign(Object.create({ inherited: true }), {}),
    symbolInput,
    hostileInput,
  ]) {
    await assert.rejects(
      tool.execute(input),
      (error) =>
        error instanceof TypeError && !error.message.includes("private-input-marker"),
    );
  }

  const invalidResults = [
    Object.assign(Object.create(null), createOverview()),
    { ...createOverview(), transcript: [] },
    { ...createOverview(), path: "/xnhan" },
    {
      ...createOverview("vi"),
      routes: { product: "/xnhan?lang=en", portfolio: "/vi" },
    },
    { ...createOverview(), sections: createOverview().sections.slice(0, 3) },
    {
      ...createOverview(),
      hero: { ...createOverview().hero, titleLines: ["Only one line"] },
    },
  ];
  for (const invalidResult of invalidResults) {
    const [invalidTool] = createXNhanAboutWebMcpTools(
      createActions({
        async readXNhanAboutOverview() {
          return invalidResult;
        },
      }),
    );
    await assert.rejects(invalidTool.execute({}), TypeError);
  }
});

test("does not invoke or echo an accessor embedded in the public overview", async () => {
  let getterCalls = 0;
  const hostileOverview = createOverview();
  Object.defineProperty(hostileOverview, "title", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("private-overview-marker");
    },
  });
  const [tool] = createXNhanAboutWebMcpTools(
    createActions({
      async readXNhanAboutOverview() {
        return hostileOverview;
      },
    }),
  );

  await assert.rejects(
    tool.execute({}),
    (error) =>
      error instanceof TypeError &&
      !error.message.includes("private-overview-marker"),
  );
  assert.equal(getterCalls, 0);
});

test("propagates read execution and catalog lifecycle cancellation", async () => {
  const registered = [];
  let actionSignal;
  const registration = registerXNhanAboutWebMcpTools({
    actions: createActions({
      readXNhanAboutOverview({ signal }) {
        actionSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    }),
    documentObject: {
      modelContext: {
        registerTool(tool) {
          registered.push(tool);
        },
      },
    },
  });
  assert.equal(await registration.ready, true);
  const pending = registered[0].execute({});
  await Promise.resolve();
  assert.equal(actionSignal.aborted, false);

  registration.cleanup();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(actionSignal.aborted, true);
});

test("rejects invalid or pre-aborted read signals before the action runs", async () => {
  let calls = 0;
  const [tool] = createXNhanAboutWebMcpTools(
    createActions({
      async readXNhanAboutOverview() {
        calls += 1;
        return createOverview();
      },
    }),
  );
  await assert.rejects(tool.execute({}, { signal: {} }), TypeError);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    tool.execute({}, { signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(calls, 0);
});

test("executes locale changes and preserves supported About aliases", async () => {
  for (const path of [
    "/xnhan/about",
    "/xnhan/about/",
    "/xnhan-about.html",
  ]) {
    let received;
    const [, tool] = createXNhanAboutWebMcpTools(
      createActions({
        async setXNhanAboutLocale(locale, options) {
          received = { locale, signal: options.signal };
          return { status: "changed", locale, path };
        },
      }),
    );
    assert.deepEqual(await tool.execute({ locale: "vi" }), {
      status: "changed",
      locale: "vi",
      path,
    });
    assert.equal(received.locale, "vi");
    assert.equal(received.signal.aborted, false);
  }
});

test("rejects accessor, extra, inherited, and unsupported locale input", async () => {
  const [, tool] = createXNhanAboutWebMcpTools(createActions());
  const accessor = {};
  let accessorCalls = 0;
  Object.defineProperty(accessor, "locale", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return "en";
    },
  });
  const nullPrototype = Object.assign(Object.create(null), { locale: "en" });
  const hostileProxy = new Proxy({ locale: "en" }, {
    ownKeys() {
      throw new Error("PRIVATE_ABOUT_RUNTIME_TRAP");
    },
  });
  for (const input of [
    accessor,
    nullPrototype,
    hostileProxy,
    { locale: "fr" },
    { locale: "en", extra: true },
    Object.assign(Object.create({ inherited: true }), { locale: "en" }),
  ]) {
    await assert.rejects(
      tool.execute(input),
      (error) =>
        error instanceof TypeError &&
        !error.message.includes("PRIVATE_ABOUT_RUNTIME_TRAP"),
    );
  }
  assert.equal(accessorCalls, 0);

  await assert.rejects(
    tool.execute({ locale: "en" }, {
      signal: {
        aborted: false,
        addEventListener() {},
        removeEventListener() {},
      },
    }),
    TypeError,
  );
});

test("propagates execution cancellation into the route action", async () => {
  const controller = new AbortController();
  let actionSignal;
  const [, tool] = createXNhanAboutWebMcpTools(
    createActions({
      setXNhanAboutLocale(_locale, { signal }) {
        actionSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    }),
  );
  const pending = tool.execute({ locale: "en" }, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(actionSignal.aborted, true);
});

test("serializes concurrent locale mutations in invocation order", async () => {
  const calls = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const [, tool] = createXNhanAboutWebMcpTools(
    createActions({
      async setXNhanAboutLocale(locale) {
        calls.push(locale);
        if (locale === "vi") await firstGate;
        return { status: "changed", locale, path: "/xnhan/about" };
      },
    }),
  );

  const vietnamese = tool.execute({ locale: "vi" });
  const english = tool.execute({ locale: "en" });
  await Promise.resolve();
  assert.deepEqual(calls, ["vi"]);
  releaseFirst();
  assert.deepEqual(await vietnamese, {
    status: "changed",
    locale: "vi",
    path: "/xnhan/about",
  });
  assert.deepEqual(await english, {
    status: "changed",
    locale: "en",
    path: "/xnhan/about",
  });
  assert.deepEqual(calls, ["vi", "en"]);
});

test("serializes the public read snapshot with a following locale mutation", async () => {
  const calls = [];
  let releaseRead;
  const readGate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const [readTool, localeTool] = createXNhanAboutWebMcpTools(
    createActions({
      async readXNhanAboutOverview() {
        calls.push("read:start");
        await readGate;
        calls.push("read:end");
        return createOverview();
      },
      async setXNhanAboutLocale(locale) {
        calls.push(`locale:${locale}`);
        return { status: "changed", locale, path: "/xnhan/about" };
      },
    }),
  );

  const reading = readTool.execute({});
  const changing = localeTool.execute({ locale: "vi" });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, ["read:start"]);

  releaseRead();
  assert.equal((await reading).status, "read");
  assert.deepEqual(await changing, {
    status: "changed",
    locale: "vi",
    path: "/xnhan/about",
  });
  assert.deepEqual(calls, ["read:start", "read:end", "locale:vi"]);
});

test("an aborted queued locale mutation rejects promptly and never runs later", async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const calls = [];
  const [, tool] = createXNhanAboutWebMcpTools(
    createActions({
      async setXNhanAboutLocale(locale) {
        calls.push(locale);
        if (locale === "vi") await firstGate;
        return { status: "changed", locale, path: "/xnhan/about" };
      },
    }),
  );
  const first = tool.execute({ locale: "vi" });
  await Promise.resolve();
  const controller = new AbortController();
  const second = tool.execute({ locale: "en" }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(second, { name: "AbortError" });
  assert.deepEqual(calls, ["vi"]);
  releaseFirst();
  await first;
  await Promise.resolve();
  assert.deepEqual(calls, ["vi"]);
});

test("registers progressively and aborts the catalog on cleanup", async () => {
  const registered = [];
  const documentObject = {
    modelContext: {
      registerTool(tool, options) {
        registered.push({ tool, signal: options.signal });
      },
    },
  };
  const registration = registerXNhanAboutWebMcpTools({
    actions: createActions(),
    documentObject,
  });
  assert.equal(registration.supported, true);
  assert.equal(await registration.ready, true);
  assert.deepEqual(registered.map(({ tool }) => tool.name), [
    "read_xnhan_about_overview",
    "set_xnhan_about_locale",
  ]);
  assert.equal(registered[0].signal.aborted, false);
  registration.cleanup();
  assert.equal(registered[0].signal.aborted, true);

  assert.equal(
    registerXNhanAboutWebMcpTools({
      actions: createActions(),
      documentObject: {},
    }).supported,
    false,
  );
});

test("cleanup settles ready when the browser registration promise stalls", async () => {
  const registration = registerXNhanAboutWebMcpTools({
    actions: createActions(),
    documentObject: {
      modelContext: {
        registerTool() {
          return new Promise(() => {});
        },
      },
    },
  });
  assert.equal(registration.supported, true);
  await Promise.resolve();
  registration.cleanup();
  assert.equal(await registration.ready, false);
});

test("reference-counts concurrent About catalog consumers and retries after final cleanup", async () => {
  const registered = [];
  const documentObject = {
    modelContext: {
      registerTool(tool, options) {
        registered.push({ tool, options });
      },
    },
  };
  const first = registerXNhanAboutWebMcpTools({
    actions: createActions(),
    documentObject,
  });
  const second = registerXNhanAboutWebMcpTools({
    actions: createActions(),
    documentObject,
  });
  assert.equal(first.ready, second.ready);
  assert.equal(await first.ready, true);
  assert.equal(registered.length, 2);
  const firstSignal = registered[0].options.signal;

  first.cleanup();
  assert.equal(firstSignal.aborted, false);
  second.cleanup();
  second.cleanup();
  assert.equal(firstSignal.aborted, true);

  const retry = registerXNhanAboutWebMcpTools({
    actions: createActions(),
    documentObject,
  });
  assert.equal(await retry.ready, true);
  assert.equal(registered.length, 4);
  retry.cleanup();
});

test("keeps a stalled About catalog until its final concurrent consumer releases it", async () => {
  const registered = [];
  const documentObject = {
    modelContext: {
      registerTool(tool, options) {
        registered.push({ tool, options });
        return new Promise(() => {});
      },
    },
  };
  const first = registerXNhanAboutWebMcpTools({
    actions: createActions(),
    documentObject,
  });
  const second = registerXNhanAboutWebMcpTools({
    actions: createActions(),
    documentObject,
  });
  assert.equal(registered.length, 1);

  let settled = false;
  void first.ready.then(() => {
    settled = true;
  });
  first.cleanup();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(registered[0].options.signal.aborted, false);

  second.cleanup();
  assert.equal(await settleWithin(first.ready), false);
  assert.equal(registered[0].options.signal.aborted, true);
});

test("shares an About registration failure with every active consumer", async () => {
  const failure = new Error("about-registration-failure");
  let rejectRegistration;
  let signalRegistration;
  const registrationStarted = new Promise((resolve) => {
    signalRegistration = resolve;
  });
  const registered = [];
  const firstReported = [];
  const secondReported = [];
  const documentObject = {
    modelContext: {
      registerTool(tool, options) {
        registered.push({ tool, options });
        return new Promise((_resolve, reject) => {
          rejectRegistration = reject;
          signalRegistration();
        });
      },
    },
  };
  const first = registerXNhanAboutWebMcpTools({
    actions: createActions(),
    documentObject,
    onRegistrationError: (error) => firstReported.push(error),
  });
  const second = registerXNhanAboutWebMcpTools({
    actions: createActions(),
    documentObject,
    onRegistrationError: (error) => secondReported.push(error),
  });
  await settleWithin(registrationStarted);
  rejectRegistration(failure);

  assert.equal(await settleWithin(first.ready), false);
  assert.equal(await settleWithin(second.ready), false);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].options.signal.aborted, true);
  assert.deepEqual(firstReported, [failure]);
  assert.deepEqual(secondReported, [failure]);
  first.cleanup();
  second.cleanup();
});
