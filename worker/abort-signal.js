function abortController(reason) {
  const controller = new AbortController();
  controller.abort(reason);
  return controller;
}

export function combineAbortSignals(signals) {
  const active = signals.filter((signal) => signal instanceof AbortSignal);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(active);
  }

  const controller = new AbortController();
  const onAbort = (event) => {
    const reason =
      event.target?.reason ?? new DOMException("Aborted", "AbortError");
    controller.abort(reason);
  };

  for (const signal of active) {
    if (signal.aborted) {
      return abortController(signal.reason).signal;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  controller.signal.addEventListener(
    "abort",
    () => {
      for (const signal of active) {
        signal.removeEventListener("abort", onAbort);
      }
    },
    { once: true },
  );

  return controller.signal;
}

export function createDeadlineSignal(timeoutMs, parentSignal) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("invalid_deadline_timeout");
  }

  return combineAbortSignals([
    AbortSignal.timeout(timeoutMs),
    parentSignal,
  ]);
}
