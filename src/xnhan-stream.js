import { isXNhanModelId } from "./xnhan-model-id.js";
import { normalizeXNhanModelDisplayName } from "../shared/xnhan-model-display-name.js";

const MAX_STREAM_BYTES = 2 * 1_024 * 1_024;
const MAX_EVENT_BYTES = 512 * 1_024;
const XNHAN_ACCEPTED_KEYS = Object.freeze([
  "model",
  "modelDisplayName",
  "provider",
  "requestId",
]);
const XNHAN_PROVIDERS = Object.freeze(["openai", "openrouter"]);
const XNHAN_REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACTIVITY_KEYS = new Set([
  "sequence",
  "phase",
  "kind",
  "status",
  "tool",
  "queries",
  "summary",
  "acceptedCount",
  "durationMs",
]);
const STREAM_STATES = Object.freeze({
  initial: "initial",
  accepted: "accepted",
  active: "active",
  outcome: "outcome",
  done: "done",
});

function streamError(code = "invalidResponse") {
  const error = new TypeError(code);
  error.code = code;
  return error;
}

function plainRecord(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedString(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || Array.from(normalized).length > maxLength) return null;
  return normalized;
}

export function normalizeXNhanAccepted(value) {
  if (!plainRecord(value)) throw streamError();
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(XNHAN_ACCEPTED_KEYS)) {
    throw streamError();
  }

  const requestId = boundedString(value.requestId, 128);
  const provider = boundedString(value.provider, 32);
  const model = boundedString(value.model, 200);
  const modelDisplayName = normalizeXNhanModelDisplayName(
    value.modelDisplayName,
  );
  if (
    !requestId ||
    !XNHAN_REQUEST_ID_PATTERN.test(requestId) ||
    !provider ||
    !XNHAN_PROVIDERS.includes(provider) ||
    !model ||
    !isXNhanModelId(model, provider) ||
    !modelDisplayName
  ) {
    throw streamError();
  }

  return Object.freeze({ requestId, provider, model, modelDisplayName });
}

export function stripActivitySummaryMarkup(value) {
  return value
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/\*\*([^*\n]+)\*\*/gu, "$1")
    .replace(/__([^_\n]+)__/gu, "$1")
    .replace(/`([^`\n]+)`/gu, "$1")
    .trim();
}

export function normalizeXNhanActivity(value) {
  if (
    !plainRecord(value) ||
    Object.keys(value).some((key) => !ACTIVITY_KEYS.has(key)) ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    value.sequence > 128 ||
    !["discovery", "ranking", "synthesis"].includes(value.phase) ||
    !["phase", "reasoning", "tool"].includes(value.kind) ||
    !["started", "searching", "completed", "unavailable"].includes(
      value.status,
    )
  ) {
    throw streamError();
  }

  const normalized = {
    sequence: value.sequence,
    phase: value.phase,
    kind: value.kind,
    status: value.status,
  };
  if (value.tool !== undefined) {
    if (value.kind !== "tool" || value.tool !== "web_search") throw streamError();
    normalized.tool = value.tool;
  } else if (value.kind === "tool") {
    throw streamError();
  }
  if (value.queries !== undefined) {
    if (
      value.kind !== "tool" ||
      !Array.isArray(value.queries) ||
      value.queries.length > 8
    ) {
      throw streamError();
    }
    normalized.queries = value.queries.map((query) => {
      const bounded = boundedString(query, 300);
      if (!bounded) throw streamError();
      return bounded;
    });
  }
  if (value.summary !== undefined && value.summary !== null) {
    if (value.kind !== "reasoning") throw streamError();
    const summary = boundedString(value.summary, 1_200);
    if (!summary) throw streamError();
    normalized.summary = stripActivitySummaryMarkup(summary);
  }
  for (const key of ["acceptedCount", "durationMs"]) {
    if (value[key] === undefined) continue;
    if (
      value.kind !== "phase" ||
      !Number.isSafeInteger(value[key]) ||
      value[key] < 0 ||
      value[key] > (key === "acceptedCount" ? 20 : 600_000)
    ) {
      throw streamError();
    }
    normalized[key] = value[key];
  }
  return Object.freeze(normalized);
}

export function normalizeXNhanConsultedSource(value) {
  if (!plainRecord(value)) throw streamError();
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["handle", "id", "url"])) {
    throw streamError();
  }
  const handle = boundedString(value.handle, 15);
  const id = boundedString(value.id, 30);
  const url = boundedString(value.url, 2_048);
  if (
    !handle ||
    !/^[a-z0-9_]{1,15}$/u.test(handle) ||
    !id ||
    !/^[1-9][0-9]{0,29}$/u.test(id) ||
    url !== `https://x.com/${handle}/status/${id}`
  ) {
    throw streamError();
  }
  return Object.freeze({ handle, id, url });
}

function parseEventBlock(block) {
  let eventName = "message";
  const dataLines = [];
  for (const line of block.replaceAll("\r", "").split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (
    !/^[a-z_]{1,32}$/u.test(eventName) ||
    dataLines.length === 0
  ) {
    throw streamError();
  }
  try {
    const payload = JSON.parse(dataLines.join("\n"));
    if (!plainRecord(payload)) throw streamError();
    return { eventName, payload };
  } catch (error) {
    if (error?.code === "invalidResponse") throw error;
    throw streamError();
  }
}

function isCommentOnlyEventBlock(block) {
  return block
    .split("\n")
    .every((line) => line.trim() === "" || line.startsWith(":"));
}

function transitionStreamState(state, eventName) {
  if (state === STREAM_STATES.initial && eventName === "accepted") {
    return STREAM_STATES.accepted;
  }
  if (state === STREAM_STATES.accepted) {
    if (eventName === "activity") return STREAM_STATES.active;
    if (eventName === "result" || eventName === "error") {
      return STREAM_STATES.outcome;
    }
  }
  if (state === STREAM_STATES.active) {
    if (eventName === "activity" || eventName === "source") {
      return STREAM_STATES.active;
    }
    if (eventName === "result" || eventName === "error") {
      return STREAM_STATES.outcome;
    }
  }
  if (state === STREAM_STATES.outcome && eventName === "done") {
    return STREAM_STATES.done;
  }
  throw streamError();
}

export async function readXNhanEventStream(response, onEvent) {
  const mediaType = response.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "text/event-stream" || !response.body) throw streamError();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let totalBytes = 0;
  let streamState = STREAM_STATES.initial;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_STREAM_BYTES) throw streamError();
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r", "");
      if (encoder.encode(buffer).byteLength > MAX_EVENT_BYTES) throw streamError();

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block.trim() && !isCommentOnlyEventBlock(block)) {
          const parsed = parseEventBlock(block);
          streamState = transitionStreamState(streamState, parsed.eventName);
          await onEvent(parsed.eventName, parsed.payload);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode().replaceAll("\r", "");
    if (buffer.trim() && !isCommentOnlyEventBlock(buffer)) {
      const parsed = parseEventBlock(buffer);
      streamState = transitionStreamState(streamState, parsed.eventName);
      await onEvent(parsed.eventName, parsed.payload);
    }
  } catch (error) {
    try {
      await reader.cancel("xnhan_stream_rejected");
    } catch {
      // Cancellation is best effort after rejecting an invalid event stream.
    }
    if (error?.name === "AbortError") throw error;
    throw typeof error?.code === "string" ? error : streamError();
  } finally {
    reader.releaseLock();
  }
  if (streamState !== STREAM_STATES.done) throw streamError();
}
