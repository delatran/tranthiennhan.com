function createAbortError() {
  const error = new Error("X Nhân WebMCP action was aborted.");
  error.name = "AbortError";
  return error;
}

function isAbortSignal(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.aborted === "boolean" &&
    typeof value.addEventListener === "function" &&
    typeof value.removeEventListener === "function"
  );
}

function combineActionSignals(...candidateSignals) {
  if (
    candidateSignals.some(
      (signal) => signal !== undefined && !isAbortSignal(signal),
    )
  ) {
    throw new TypeError("X Nhân WebMCP execution signal must be an AbortSignal.");
  }

  const signals = [...new Set(candidateSignals.filter(isAbortSignal))];
  if (signals.length === 0) return { signal: undefined, cleanup() {} };
  if (signals.length === 1 || signals[0] === signals[1]) {
    return { signal: signals[0], cleanup() {} };
  }
  if (typeof globalThis.AbortSignal?.any === "function") {
    return { signal: globalThis.AbortSignal.any(signals), cleanup() {} };
  }

  const controller = new AbortController();
  let cleanedUp = false;
  const handleAbort = () => controller.abort();
  for (const signal of signals) {
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) handleAbort();
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      for (const signal of signals) {
        signal.removeEventListener("abort", handleAbort);
      }
    },
  };
}

function raceActionWithAbort(operation, combined) {
  if (!combined.signal) return operation.finally(combined.cleanup);

  let handleAbort;
  const aborted = new Promise((_, reject) => {
    handleAbort = () => reject(createAbortError());
    combined.signal.addEventListener("abort", handleAbort, { once: true });
    if (combined.signal.aborted) handleAbort();
  });

  return Promise.race([operation, aborted]).finally(() => {
    combined.signal.removeEventListener("abort", handleAbort);
    combined.cleanup();
  });
}

export function createDetachedSignal() {
  return typeof AbortController === "function"
    ? new AbortController().signal
    : undefined;
}

export function createActionRunners(lifecycleSignal) {
  let mutationTail = Promise.resolve();
  let controlTail = Promise.resolve();
  let searchGeneration = 0;
  let controlSequence = 0;
  let completedControlSequence = 0;
  const searchIntents = new Map();

  const executeAction = async (action, args, signal, normalizeResult) => {
    if (signal?.aborted) throw createAbortError();
    const result = await action(...args, { signal });
    if (signal?.aborted) throw createAbortError();
    return normalizeResult(result);
  };

  return Object.freeze({
    runMutation(action, args, executionSignal, normalizeResult) {
      const combined = combineActionSignals(lifecycleSignal, executionSignal);
      const execute = () => executeAction(
        action,
        args,
        combined.signal,
        normalizeResult,
      );
      const queued = mutationTail.then(execute, execute);
      mutationTail = queued.catch(() => {});
      return raceActionWithAbort(queued, combined);
    },
    runSearch(action, args, executionSignal, normalizeResult) {
      const generation = ++searchGeneration;
      const controller = new AbortController();
      const combined = combineActionSignals(
        lifecycleSignal,
        executionSignal,
        controller.signal,
      );
      const intent = {
        generation,
        state: "scheduled",
        ownedByControl: null,
        superseded: false,
        controller,
        controlBarrier: controlTail,
        requiredControlSequence: controlSequence,
      };
      searchIntents.set(generation, intent);

      const execute = async () => {
        try {
          if (completedControlSequence < intent.requiredControlSequence) {
            await intent.controlBarrier;
          }
          if (intent.superseded || combined.signal?.aborted) {
            throw createAbortError();
          }

          intent.state = "started";
          try {
            const result = await action(...args, { signal: combined.signal });
            if (intent.superseded || combined.signal?.aborted) {
              throw createAbortError();
            }
            return normalizeResult(result);
          } catch (error) {
            if (intent.superseded || combined.signal?.aborted) {
              throw createAbortError();
            }
            throw error;
          }
        } finally {
          intent.state = "settled";
          searchIntents.delete(generation);
        }
      };

      const queued = mutationTail.then(execute, execute);
      mutationTail = queued.catch(() => {});
      return raceActionWithAbort(queued, combined);
    },
    runControl(action, args, executionSignal, normalizeResult) {
      const combined = combineActionSignals(lifecycleSignal, executionSignal);
      const cutoffGeneration = searchGeneration;
      const sequence = ++controlSequence;

      const execute = async () => {
        try {
          if (combined.signal?.aborted) throw createAbortError();

          const affected = [];
          for (const intent of searchIntents.values()) {
            if (
              intent.generation > cutoffGeneration ||
              intent.state === "settled" ||
              intent.ownedByControl !== null
            ) {
              continue;
            }
            intent.ownedByControl = sequence;
            intent.superseded = true;
            if (intent.state === "scheduled") {
              intent.controller.abort();
            }
            affected.push(intent);
          }

          try {
            const result = await action(...args, { signal: combined.signal });
            if (combined.signal?.aborted) throw createAbortError();
            return normalizeResult(result, {
              supersededSearches: affected.length,
            });
          } finally {
            for (const intent of affected) {
              if (intent.state !== "settled") intent.controller.abort();
            }
          }
        } finally {
          completedControlSequence = Math.max(
            completedControlSequence,
            sequence,
          );
        }
      };

      const queued = controlTail.then(execute, execute);
      controlTail = queued.catch(() => {});
      return raceActionWithAbort(queued, combined);
    },
    runRead(action, args, executionSignal, normalizeResult) {
      const combined = combineActionSignals(lifecycleSignal, executionSignal);
      const operation = executeAction(action, args, combined.signal, normalizeResult);
      return raceActionWithAbort(operation, combined);
    },
  });
}
