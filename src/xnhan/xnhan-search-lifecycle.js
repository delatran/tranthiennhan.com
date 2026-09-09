export const XNHAN_REQUEST_TIMEOUT_MS = 810_000;

export function isCurrentXNhanSearchRequest(
  activeRequest,
  candidateRequest,
  mounted,
) {
  return (
    mounted === true &&
    candidateRequest !== null &&
    candidateRequest !== undefined &&
    activeRequest === candidateRequest
  );
}

export function classifyXNhanSearchFailure({
  callerSignal,
  error,
  requestSignal,
  requestTimedOut,
  userCancelled,
}) {
  const requestWasAborted =
    error?.name === "AbortError" || requestSignal?.aborted === true;
  if (requestTimedOut === true) return "timeout";
  if (
    requestWasAborted &&
    (userCancelled === true || callerSignal?.aborted === true)
  ) {
    return "cancelled";
  }
  return "error";
}

export function scheduleXNhanSearchTimeout({
  controller,
  getActiveRequest,
  onTimeout,
  scheduleTimeout = (callback, delay) =>
    globalThis.setTimeout(callback, delay),
}) {
  if (
    !controller ||
    typeof controller.abort !== "function" ||
    typeof getActiveRequest !== "function" ||
    typeof onTimeout !== "function" ||
    typeof scheduleTimeout !== "function"
  ) {
    throw new TypeError("Invalid X Nhân search timeout lifecycle.");
  }

  return scheduleTimeout(() => {
    if (
      getActiveRequest() !== controller ||
      controller.signal?.aborted === true
    ) {
      return;
    }
    onTimeout();
    controller.abort();
  }, XNHAN_REQUEST_TIMEOUT_MS);
}
