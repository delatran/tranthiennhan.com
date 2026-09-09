export const TARGET_FOCUS_IDS = Object.freeze({
  "main-content": "main-content",
  top: "hero-title",
  work: "work-title",
  product: "product-title",
  experience: "experience-title",
  about: "approach-title",
  contact: "contact-title",
  "work-call-scoring": "case-title-call-scoring",
  "work-document-ai": "case-title-document-ai",
  "work-lora-audit": "case-title-lora-audit",
});

export function isPlainPrimaryClick(event) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function scheduleTargetNavigation(target, beforeNavigate, onComplete) {
  if (!(target in TARGET_FOCUS_IDS)) return false;

  beforeNavigate?.();
  window.history.pushState({}, "", `#${target}`);
  window.requestAnimationFrame(() => {
    const targetElement = document.getElementById(target);
    const focusId = TARGET_FOCUS_IDS[target];
    const focusElement = document.getElementById(focusId);

    targetElement?.scrollIntoView({ block: "start", behavior: "instant" });
    focusElement?.focus({ preventScroll: true });
    onComplete?.({
      focusId,
      focused: document.activeElement === focusElement,
      target,
    });
  });
  return true;
}

function createNavigationAbortError() {
  const error = new Error("Programmatic navigation was aborted.");
  error.name = "AbortError";
  return error;
}

export function navigateToTargetById(
  target,
  beforeNavigate,
  { signal } = {},
) {
  if (!(target in TARGET_FOCUS_IDS)) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    if (
      signal !== undefined &&
      (signal === null ||
        typeof signal.aborted !== "boolean" ||
        typeof signal.addEventListener !== "function" ||
        typeof signal.removeEventListener !== "function")
    ) {
      reject(new TypeError("Programmatic navigation signal must be an AbortSignal."));
      return;
    }
    if (signal?.aborted) {
      reject(createNavigationAbortError());
      return;
    }

    let frameId;
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", handleAbort);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const handleAbort = () => {
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      fail(createNavigationAbortError());
    };

    signal?.addEventListener("abort", handleAbort, { once: true });
    try {
      frameId = window.requestAnimationFrame(() => {
        if (signal?.aborted) {
          handleAbort();
          return;
        }

        try {
          const targetElement = document.getElementById(target);
          const focusId = TARGET_FOCUS_IDS[target];
          const focusElement = document.getElementById(focusId);
          if (!targetElement || !focusElement) {
            finish(null);
            return;
          }

          beforeNavigate?.();
          window.history.pushState({}, "", `#${target}`);
          targetElement.scrollIntoView({ block: "start", behavior: "instant" });
          focusElement.focus({ preventScroll: true });
          finish(
            document.activeElement === focusElement
              ? { focusId, focused: true, target }
              : null,
          );
        } catch (error) {
          fail(error);
        }
      });
    } catch (error) {
      fail(error);
    }
  });
}

export function navigateToTarget(event, target, beforeNavigate) {
  if (!isPlainPrimaryClick(event) || !(target in TARGET_FOCUS_IDS)) return false;

  event.preventDefault();
  return scheduleTargetNavigation(target, beforeNavigate);
}

export function closeMobileNavigationAtDesktopBreakpoint(
  event,
  onMenuChange,
  desktopFocusRef,
  scheduleFrame = window.requestAnimationFrame,
) {
  if (event.matches) return false;

  onMenuChange(false);
  scheduleFrame(() => {
    desktopFocusRef.current?.focus({ preventScroll: true });
  });
  return true;
}
