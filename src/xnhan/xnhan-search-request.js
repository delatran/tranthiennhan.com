import { normalizeXNhanResponse } from "./xnhan-content.js";
import {
  normalizeXNhanAccepted,
  normalizeXNhanActivity,
  normalizeXNhanConsultedSource,
  readXNhanEventStream,
} from "./xnhan-stream.js";

export const XNHAN_SEARCH_ENDPOINT = "/api/xnhan/search";

const NOOP_EVENT_CALLBACK = () => {};

export function createXNhanSearchError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireEventCallback(callback, name) {
  if (callback === undefined) return NOOP_EVENT_CALLBACK;
  if (typeof callback !== "function") {
    throw new TypeError(`Invalid X Nhân ${name} callback.`);
  }
  return callback;
}

async function readNormalizedSearchResponse(
  response,
  expectedProvider,
  { onAccepted, onActivity, onSource },
) {
  let normalized = null;
  let accepted = null;
  const mediaType = response.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();

  if (mediaType !== "text/event-stream") {
    try {
      return normalizeXNhanResponse(await response.json());
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw createXNhanSearchError("invalidResponse");
    }
  }

  await readXNhanEventStream(response, async (eventName, payload) => {
    if (eventName === "accepted") {
      if (accepted !== null) throw createXNhanSearchError("invalidResponse");
      try {
        accepted = normalizeXNhanAccepted(payload);
      } catch {
        throw createXNhanSearchError("invalidResponse");
      }
      if (accepted.provider !== expectedProvider) {
        throw createXNhanSearchError("invalidResponse");
      }
      await onAccepted(accepted);
      return;
    }

    if (eventName === "activity") {
      if (!accepted) throw createXNhanSearchError("invalidResponse");
      await onActivity(normalizeXNhanActivity(payload));
      return;
    }

    if (eventName === "source") {
      if (!accepted) throw createXNhanSearchError("invalidResponse");
      await onSource(normalizeXNhanConsultedSource(payload));
      return;
    }

    if (eventName === "result") {
      if (!accepted || normalized) {
        throw createXNhanSearchError("invalidResponse");
      }
      try {
        normalized = normalizeXNhanResponse(payload);
      } catch {
        throw createXNhanSearchError("invalidResponse");
      }
      if (
        normalized.requestId !== accepted.requestId ||
        normalized.retrieval.provider !== accepted.provider ||
        normalized.retrieval.model !== accepted.model ||
        normalized.retrieval.modelDisplayName !== accepted.modelDisplayName
      ) {
        throw createXNhanSearchError("invalidResponse");
      }
      return;
    }

    if (eventName === "error") {
      if (!accepted || payload.requestId !== accepted.requestId) {
        throw createXNhanSearchError("invalidResponse");
      }
      throw createXNhanSearchError(
        payload.error === "rate_limited" ? "rateLimited" : "generic",
      );
    }

    if (eventName === "done") {
      if (
        !accepted ||
        !normalized ||
        Object.keys(payload).length !== 1 ||
        payload.requestId !== accepted.requestId
      ) {
        throw createXNhanSearchError("invalidResponse");
      }
      return;
    }

    throw createXNhanSearchError("invalidResponse");
  });

  if (!normalized) throw createXNhanSearchError("invalidResponse");
  return normalized;
}

export async function executeXNhanSearchRequest({
  answerLocale,
  fetchImpl = globalThis.fetch,
  history,
  onAccepted,
  onActivity,
  onSource,
  provider,
  query,
  signal,
}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("X Nhân search transport is unavailable.");
  }

  const callbacks = {
    onAccepted: requireEventCallback(onAccepted, "accepted-event"),
    onActivity: requireEventCallback(onActivity, "activity-event"),
    onSource: requireEventCallback(onSource, "source-event"),
  };
  const response = await fetchImpl(XNHAN_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify({
      locale: answerLocale,
      query,
      provider,
      history,
    }),
    signal,
  });

  if (!response.ok) {
    let errorCode = "";
    try {
      const payload = await response.json();
      errorCode = typeof payload?.error === "string" ? payload.error : "";
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      // Status-specific handling remains bounded without trusting an error body.
    }
    if (response.status === 429 || errorCode === "rate_limited") {
      throw createXNhanSearchError("rateLimited");
    }
    throw createXNhanSearchError("generic");
  }

  const normalized = await readNormalizedSearchResponse(
    response,
    provider,
    callbacks,
  );
  if (
    normalized.query !== query ||
    normalized.retrieval.provider !== provider ||
    normalized.answerLocale !== answerLocale
  ) {
    throw createXNhanSearchError("invalidResponse");
  }
  return normalized;
}
