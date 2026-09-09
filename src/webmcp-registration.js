const ACTIVE_CATALOGS = new WeakMap();

function reportRegistrationError(reporter, error) {
  if (typeof reporter !== "function") return;
  try {
    void Promise.resolve(reporter(error)).catch(() => {});
  } catch {
    // A reporting failure must not escape the progressive-enhancement boundary.
  }
}

function unsupportedRegistration(reporter, error) {
  if (error !== undefined) reportRegistrationError(reporter, error);
  return Object.freeze({
    supported: false,
    ready: Promise.resolve(false),
    cleanup() {},
  });
}

function waitForRegistration(registration, signal) {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (handler, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", handleAbort);
      handler(value);
    };
    const handleAbort = () => settle(resolve, false);

    signal.addEventListener("abort", handleAbort, { once: true });
    Promise.resolve(registration).then(
      () => settle(resolve, true),
      (error) => settle(reject, error),
    );
  });
}

function closeEntry(entry) {
  if (entry.closed) return;
  entry.closed = true;
  entry.lifecycle.abort();

  const catalogs = ACTIVE_CATALOGS.get(entry.modelContext);
  if (catalogs?.get(entry.catalogKey) === entry) {
    catalogs.delete(entry.catalogKey);
    if (catalogs.size === 0) ACTIVE_CATALOGS.delete(entry.modelContext);
  }
}

function reportEntryFailure(entry, error) {
  for (const consumer of entry.consumers) {
    if (!consumer.released) {
      reportRegistrationError(consumer.reporter, error);
    }
  }
}

function acquireEntry(entry, reporter) {
  const consumer = { released: false, reporter };
  entry.consumers.add(consumer);

  return Object.freeze({
    supported: true,
    ready: entry.ready,
    cleanup() {
      if (consumer.released) return;
      consumer.released = true;
      entry.consumers.delete(consumer);
      if (entry.consumers.size === 0) closeEntry(entry);
    },
  });
}

export function registerImperativeWebMcpCatalog({
  catalogKey,
  createTools,
  documentObject = globalThis.document,
  onRegistrationError,
} = {}) {
  let modelContext;
  let registerTool;
  try {
    modelContext = documentObject?.modelContext;
    registerTool = modelContext?.registerTool;
  } catch (error) {
    return unsupportedRegistration(onRegistrationError, error);
  }

  if (
    (modelContext === null ||
      (typeof modelContext !== "object" && typeof modelContext !== "function")) ||
    typeof registerTool !== "function" ||
    typeof AbortController !== "function"
  ) {
    return unsupportedRegistration(onRegistrationError);
  }
  if (catalogKey === null || catalogKey === undefined || typeof createTools !== "function") {
    return unsupportedRegistration(
      onRegistrationError,
      new TypeError("Invalid WebMCP catalog registration."),
    );
  }

  let catalogs = ACTIVE_CATALOGS.get(modelContext);
  if (!catalogs) {
    catalogs = new Map();
    ACTIVE_CATALOGS.set(modelContext, catalogs);
  }
  const activeEntry = catalogs.get(catalogKey);
  if (activeEntry && !activeEntry.closed) {
    return acquireEntry(activeEntry, onRegistrationError);
  }

  const lifecycle = new AbortController();
  let settleReady;
  const entry = {
    catalogKey,
    closed: false,
    consumers: new Set(),
    lifecycle,
    modelContext,
    ready: new Promise((resolve) => {
      settleReady = resolve;
    }),
  };
  catalogs.set(catalogKey, entry);
  const registration = acquireEntry(entry, onRegistrationError);

  void (async () => {
    try {
      const tools = createTools(lifecycle.signal);
      if (!Array.isArray(tools) || tools.length === 0) {
        throw new TypeError("Invalid WebMCP tool catalog.");
      }

      for (const tool of tools) {
        if (lifecycle.signal.aborted) return false;
        const registered = await waitForRegistration(
          registerTool.call(modelContext, tool, { signal: lifecycle.signal }),
          lifecycle.signal,
        );
        if (!registered) return false;
      }
      return !lifecycle.signal.aborted;
    } catch (error) {
      closeEntry(entry);
      reportEntryFailure(entry, error);
      return false;
    }
  })().then(settleReady, () => settleReady(false));

  return registration;
}
