const INPUT_TYPE_ERROR = "WebMCP tool input must be a plain object.";
const INPUT_FIELDS_ERROR = "WebMCP tool input contains unsupported fields.";
const INPUT_VALUE_ERROR = "WebMCP tool input contains an unsupported value.";
const RESULT_ERROR = "WebMCP action returned an unsupported result.";

function typeError(message) {
  return new TypeError(message);
}

function readOwnDataDescriptors(value, errorMessage) {
  let prototype;
  let descriptors;
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError();
    }
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw typeError(errorMessage);
  }

  // WebMCP inputs and action results cross a trust boundary. Accept only an
  // ordinary record, not class instances, inherited records, or null-prototype
  // dictionaries. The latter are safe as maps but are not JSON-shaped records.
  if (prototype !== Object.prototype) {
    throw typeError(errorMessage);
  }
  return descriptors;
}

export function validateExactWebMcpInput(
  input,
  expectedProperty,
  allowedValues = undefined,
) {
  let descriptors;
  try {
    descriptors = readOwnDataDescriptors(input, INPUT_TYPE_ERROR);
  } catch {
    throw typeError(INPUT_TYPE_ERROR);
  }

  let keys;
  try {
    keys = Reflect.ownKeys(descriptors);
  } catch {
    throw typeError(INPUT_FIELDS_ERROR);
  }

  if (expectedProperty === null) {
    if (keys.length !== 0) throw typeError(INPUT_FIELDS_ERROR);
    return undefined;
  }

  if (
    typeof expectedProperty !== "string" ||
    keys.length !== 1 ||
    keys[0] !== expectedProperty
  ) {
    throw typeError(INPUT_FIELDS_ERROR);
  }

  const descriptor = descriptors[expectedProperty];
  if (
    !descriptor ||
    !("value" in descriptor) ||
    !descriptor.enumerable ||
    typeof descriptor.value !== "string" ||
    !Array.isArray(allowedValues) ||
    !allowedValues.includes(descriptor.value)
  ) {
    throw typeError(INPUT_VALUE_ERROR);
  }

  return descriptor.value;
}

export function requireWebMcpAction(actions, name) {
  if (
    actions === null ||
    (typeof actions !== "object" && typeof actions !== "function")
  ) {
    throw new TypeError("WebMCP actions must be provided.");
  }

  let action;
  try {
    action = actions[name];
  } catch {
    throw new TypeError("A required WebMCP action is unavailable.");
  }
  if (typeof action !== "function") {
    throw new TypeError("A required WebMCP action is unavailable.");
  }
  return action.bind(actions);
}

export function isWebMcpAbortSignal(value) {
  if (value === null || typeof value !== "object") return false;
  try {
    const abortedGetter = Object.getOwnPropertyDescriptor(
      globalThis.AbortSignal?.prototype ?? {},
      "aborted",
    )?.get;
    return (
      typeof abortedGetter === "function" &&
      typeof abortedGetter.call(value) === "boolean"
    );
  } catch {
    return false;
  }
}

function abortSignalIsAborted(signal) {
  return Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")
    .get.call(signal);
}

function abortSignalReason(signal) {
  return Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason")
    ?.get?.call(signal);
}

function addAbortListener(signal, listener) {
  EventTarget.prototype.addEventListener.call(signal, "abort", listener, {
    once: true,
  });
}

function removeAbortListener(signal, listener) {
  EventTarget.prototype.removeEventListener.call(signal, "abort", listener);
}

export function resolveWebMcpLifecycleSignal(signal) {
  if (signal === undefined) {
    if (typeof AbortController !== "function") {
      throw new TypeError("WebMCP cancellation is unavailable.");
    }
    return new AbortController().signal;
  }
  if (!isWebMcpAbortSignal(signal)) {
    throw new TypeError("WebMCP lifecycle signal must be an AbortSignal.");
  }
  return signal;
}

export function createWebMcpAbortError() {
  const error = new Error("WebMCP action was aborted.");
  error.name = "AbortError";
  return error;
}

function linkActionSignals(lifecycleSignal, executionSignal) {
  if (!isWebMcpAbortSignal(lifecycleSignal)) {
    throw new TypeError("WebMCP lifecycle signal must be an AbortSignal.");
  }
  if (
    executionSignal !== undefined &&
    !isWebMcpAbortSignal(executionSignal)
  ) {
    throw new TypeError("WebMCP execution signal must be an AbortSignal.");
  }

  if (executionSignal === undefined || executionSignal === lifecycleSignal) {
    return { signal: lifecycleSignal, cleanup() {} };
  }

  if (typeof globalThis.AbortSignal?.any === "function") {
    return {
      signal: globalThis.AbortSignal.any([lifecycleSignal, executionSignal]),
      cleanup() {},
    };
  }

  if (typeof AbortController !== "function") {
    throw new TypeError("WebMCP cancellation is unavailable.");
  }
  const controller = new AbortController();
  let cleanedUp = false;
  const handleAbort = (event) => {
    const reason = isWebMcpAbortSignal(event?.target)
      ? abortSignalReason(event.target)
      : undefined;
    controller.abort(reason ?? createWebMcpAbortError());
  };
  for (const source of [lifecycleSignal, executionSignal]) {
    addAbortListener(source, handleAbort);
    if (
      abortSignalIsAborted(source) &&
      !abortSignalIsAborted(controller.signal)
    ) {
      controller.abort(abortSignalReason(source) ?? createWebMcpAbortError());
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      removeAbortListener(lifecycleSignal, handleAbort);
      removeAbortListener(executionSignal, handleAbort);
    },
  };
}

export function createSerializedWebMcpActionRunner(lifecycleSignal) {
  const resolvedLifecycleSignal = resolveWebMcpLifecycleSignal(lifecycleSignal);
  let tail = Promise.resolve();

  return function runSerializedWebMcpAction(
    action,
    args,
    executionSignal,
    normalizeResult,
  ) {
    if (typeof action !== "function" || !Array.isArray(args)) {
      return Promise.reject(
        new TypeError("A required WebMCP action is unavailable."),
      );
    }
    if (typeof normalizeResult !== "function") {
      return Promise.reject(
        new TypeError("A required WebMCP result normalizer is unavailable."),
      );
    }

    let linked;
    try {
      linked = linkActionSignals(resolvedLifecycleSignal, executionSignal);
    } catch (error) {
      return Promise.reject(error);
    }

    const execute = async () => {
      if (abortSignalIsAborted(linked.signal)) throw createWebMcpAbortError();
      const result = await action(...args, { signal: linked.signal });
      if (abortSignalIsAborted(linked.signal)) throw createWebMcpAbortError();
      return normalizeResult(result);
    };
    const queued = tail.then(execute, execute);
    tail = queued.catch(() => {});

    let handleAbort;
    const aborted = new Promise((_, reject) => {
      handleAbort = () => reject(createWebMcpAbortError());
      addAbortListener(linked.signal, handleAbort);
      if (abortSignalIsAborted(linked.signal)) handleAbort();
    });

    return Promise.race([queued, aborted]).finally(() => {
      removeAbortListener(linked.signal, handleAbort);
      linked.cleanup();
    });
  };
}

export function readWebMcpResultProperty(result, property) {
  let descriptors;
  try {
    descriptors = readOwnDataDescriptors(result, RESULT_ERROR);
  } catch {
    throw typeError(RESULT_ERROR);
  }
  const descriptor = descriptors[property];
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw typeError(RESULT_ERROR);
  }
  return descriptor.value;
}

export function readWebMcpResultString(result, property) {
  const value = readWebMcpResultProperty(result, property);
  if (typeof value !== "string") throw typeError(RESULT_ERROR);
  return value;
}

export function readExactWebMcpResultObject(value, propertyNames) {
  if (!Array.isArray(propertyNames)) throw typeError(RESULT_ERROR);

  let descriptors;
  try {
    descriptors = readOwnDataDescriptors(value, RESULT_ERROR);
  } catch {
    throw typeError(RESULT_ERROR);
  }
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== propertyNames.length ||
    keys.some((key) =>
      typeof key !== "string" || !propertyNames.includes(key)
    )
  ) {
    throw typeError(RESULT_ERROR);
  }

  const normalized = {};
  for (const property of propertyNames) {
    const descriptor = descriptors[property];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw typeError(RESULT_ERROR);
    }
    normalized[property] = descriptor.value;
  }
  return normalized;
}

export function readExactWebMcpResultArray(value, expectedLength) {
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 0) {
    throw typeError(RESULT_ERROR);
  }

  let descriptors;
  try {
    if (!Array.isArray(value)) throw new TypeError();
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw typeError(RESULT_ERROR);
  }
  const expectedKeys = [
    ...Array.from({ length: expectedLength }, (_, index) => String(index)),
    "length",
  ];
  const keys = Reflect.ownKeys(descriptors);
  if (
    descriptors.length?.value !== expectedLength ||
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  ) {
    throw typeError(RESULT_ERROR);
  }

  return Array.from({ length: expectedLength }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw typeError(RESULT_ERROR);
    }
    return descriptor.value;
  });
}

export function requireBoundedWebMcpString(
  value,
  { allowedValues, maxLength = 1_000 } = {},
) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    !Number.isSafeInteger(maxLength) ||
    maxLength < 1 ||
    value.length > maxLength ||
    (allowedValues !== undefined &&
      (!Array.isArray(allowedValues) || !allowedValues.includes(value)))
  ) {
    throw typeError(RESULT_ERROR);
  }
  return value;
}
