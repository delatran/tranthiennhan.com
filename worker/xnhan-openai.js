import {
  isXNhanOpenAiModelId,
  isXNhanOpenAiModelResponse,
} from "./config.js";
import { normalizeXNhanConversationHistory } from "../shared/xnhan.js";
import { createDeadlineSignal } from "./abort-signal.js";
import { readBoundedRequestBody, WORKER_FETCH_REDIRECT, isUpstreamRedirectResponse } from "./http.js";
import { readOpenAIResponseStream } from "./openai-response-stream.js";
import {
  attachXNhanProviderUsage,
  buildXNhanOpenAiRequest,
  normalizeXNhanOpenAiUsage,
  XNHAN_OPENAI_MAX_API_KEY_LENGTH,
  XNHAN_OPENAI_MAX_OUTPUT_TOKENS,
  XNHAN_OPENAI_MAX_RESPONSE_BYTES,
  XNHAN_OPENAI_RESPONSES_URL,
  XNHAN_OPENAI_TIMEOUT_MS,
} from "./xnhan-openai-config.js";
import {
  applyXNhanTranslationPlan,
  buildXNhanEvidencePlanSchema,
  buildXNhanEvidenceSnapshot,
  buildXNhanSourceMessage,
  buildXNhanLanguageInstruction,
  buildXNhanSystemPrompt,
  buildXNhanTranslationMessage,
  buildXNhanTranslationSchema,
  buildXNhanTranslationSnapshot,
  buildXNhanTranslationSystemPrompt,
  extractXNhanEvidencePlan,
  extractXNhanTranslationPlan,
  MAX_EVIDENCE_PLAN_BYTES,
  MAX_TRANSLATION_PLAN_BYTES,
} from "./xnhan-prompt.js";

export { XNHAN_OPENAI_MAX_OUTPUT_TOKENS, XNHAN_OPENAI_TIMEOUT_MS };
export const XNHAN_SYNTHESIS_MAX_OUTPUT_TOKENS = 10_000;
export const XNHAN_TRANSLATION_MAX_OUTPUT_TOKENS = 4_096;

export class XNhanOpenAIError extends Error {
  constructor(code, status = 502, { providerStateUncertain = false } = {}) {
    super(code);
    this.name = "XNhanOpenAIError";
    this.code = code;
    this.status = status;
    this.providerStateUncertain = providerStateUncertain;
  }
}

function openAiError(
  code,
  status,
  providerStateUncertain = false,
  providerUsage = null,
) {
  return attachXNhanProviderUsage(
    new XNhanOpenAIError(code, status, { providerStateUncertain }),
    providerUsage,
  );
}

export async function resolveOpenAiApiKey(binding) {
  let value = binding;
  if (typeof binding?.get === "function") value = await binding.get();
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (!normalized || normalized.length > XNHAN_OPENAI_MAX_API_KEY_LENGTH) {
    return null;
  }
  return normalized;
}

function responseSchema() {
  return buildXNhanEvidencePlanSchema();
}

function translationResponseSchema() {
  return buildXNhanTranslationSchema();
}

function buildRequestBody({
  environment,
  history,
  locale,
  model,
  evidenceSnapshot,
  query,
  requestId,
  safetyIdentifier,
  qualityCorrection = false,
}) {
  const sourceIds = evidenceSnapshot.sourceIds;

  const stablePrompt = buildXNhanSystemPrompt("en")
    .split("\n")
    .filter((line) => line !== "Reply in English.")
    .join("\n");
  const languageInstruction = buildXNhanLanguageInstruction(locale, {
    correction: qualityCorrection,
  });

  return {
    body: buildXNhanOpenAiRequest({
      instructions: `${stablePrompt}\n\n${languageInstruction}`,
      input: JSON.stringify({
        sourcePayload: JSON.parse(
          buildXNhanSourceMessage(query, evidenceSnapshot, history),
        ),
      }),
      schema: responseSchema(),
      schemaName: "xnhan_synthesis",
      tools: [],
      toolChoice: "none",
      maxOutputTokens: XNHAN_SYNTHESIS_MAX_OUTPUT_TOKENS,
      model,
      reasoningEffort: "high",
      stream: true,
      textVerbosity: "medium",
      safetyIdentifier,
      promptCacheKey: "xnhan-openai-synthesis",
      metadata: {
        application: "xnhan",
        environment,
        operation: "synthesis",
        request_id: requestId,
        locale,
        prompt_version: "xnhan-synthesis",
        source_count: String(sourceIds.length),
      },
    }),
  };
}

function buildTranslationRequestBody({
  environment,
  model,
  qualityCorrection = false,
  requestId,
  safetyIdentifier,
  translationSnapshot,
}) {
  return {
    body: buildXNhanOpenAiRequest({
      instructions: buildXNhanTranslationSystemPrompt({
        correction: qualityCorrection,
      }),
      input: buildXNhanTranslationMessage(translationSnapshot),
      schema: translationResponseSchema(),
      schemaName: "xnhan_translation",
      tools: [],
      toolChoice: "none",
      maxOutputTokens: XNHAN_TRANSLATION_MAX_OUTPUT_TOKENS,
      model,
      reasoningEffort: "low",
      stream: true,
      textVerbosity: "low",
      safetyIdentifier,
      promptCacheKey: "xnhan-openai-translation",
      metadata: {
        application: "xnhan",
        environment,
        operation: "translation",
        request_id: requestId,
        locale: translationSnapshot.targetLocale,
        prompt_version: "xnhan-translation",
        passage_count: String(translationSnapshot.items.length),
      },
    }),
  };
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best effort after an unusable upstream response.
  }
}

function extractOutputText(result, expectedModel) {
  if (
    !result ||
    Array.isArray(result) ||
    typeof result !== "object" ||
    result.status !== "completed" ||
    result.error !== null ||
    result.incomplete_details !== null ||
    typeof result.model !== "string" ||
    !isXNhanOpenAiModelResponse(expectedModel, result.model) ||
    !Array.isArray(result.output)
  ) {
    return null;
  }

  const messages = [];
  for (const item of result.output) {
    if (!item || Array.isArray(item) || typeof item !== "object") return null;
    if (item.type === "reasoning") continue;
    if (item.type !== "message") return null;
    messages.push(item);
  }
  if (messages.length !== 1) return null;

  const message = messages[0];
  if (
    message.role !== "assistant" ||
    (message.status !== undefined && message.status !== "completed") ||
    !Array.isArray(message.content) ||
    message.content.length !== 1
  ) {
    return null;
  }

  const content = message.content[0];
  if (
    !content ||
    Array.isArray(content) ||
    typeof content !== "object" ||
    content.type !== "output_text" ||
    typeof content.text !== "string"
  ) {
    return null;
  }
  return content.text;
}

function combinedSignal(signal, timeoutMs) {
  return createDeadlineSignal(
    timeoutMs,
    signal instanceof AbortSignal ? signal : undefined,
  );
}

function boundedReasoningSummary(value) {
  if (typeof value !== "string") return null;
  const normalized = value
    .normalize("NFKC")
    .replace(/[\p{Cf}\p{Cs}\u0000-\u001F\u007F-\u009F]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return null;
  return Array.from(normalized).slice(0, 1_200).join("");
}

function summaryFromReasoningItem(item) {
  if (!Array.isArray(item?.summary)) return null;
  return boundedReasoningSummary(
    item.summary
      .map((part) =>
        part?.type === "summary_text" && typeof part.text === "string"
          ? part.text
          : "",
      )
      .filter(Boolean)
      .join("\n"),
  );
}

async function emitSynthesisActivity(event, onActivity, state) {
  if (typeof onActivity !== "function") return;
  if (
    event.type === "response.output_item.added" &&
    event.item?.type === "reasoning"
  ) {
    await onActivity({ kind: "reasoning", status: "started" });
    return;
  }
  if (
    event.type === "response.reasoning_summary_text.done" &&
    typeof event.text === "string"
  ) {
    const summary = boundedReasoningSummary(event.text);
    if (summary && state.reasoningSummaries.has(summary)) return;
    if (summary) state.reasoningSummaries.add(summary);
    await onActivity({
      kind: "reasoning",
      status: "completed",
      summary,
    });
    return;
  }
  if (
    event.type === "response.output_item.done" &&
    event.item?.type === "reasoning"
  ) {
    const summary = summaryFromReasoningItem(event.item);
    if (summary && state.reasoningSummaries.has(summary)) return;
    if (summary) state.reasoningSummaries.add(summary);
    await onActivity({
      kind: "reasoning",
      status: "completed",
      summary,
    });
  }
}

export async function runXNhanSummary(
  apiKey,
  {
    environment = "local_canary",
    history = [],
    locale,
    model,
    query,
    posts,
    requestId,
    safetyIdentifier,
    signal,
    onActivity,
    qualityCorrection = false,
    fetchImpl = globalThis.fetch,
    timeoutMs = XNHAN_OPENAI_TIMEOUT_MS,
  },
) {
  const conversationContext = normalizeXNhanConversationHistory(history);
  if (
    !["local_canary", "production", "test"].includes(environment) ||
    !isXNhanOpenAiModelId(model) ||
    !Array.isArray(posts) ||
    posts.length < 1 ||
    conversationContext === null ||
    typeof safetyIdentifier !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(safetyIdentifier) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > XNHAN_OPENAI_TIMEOUT_MS
  ) {
    throw openAiError("invalid_openai_request", 500);
  }

  let evidenceSnapshot;
  try {
    evidenceSnapshot = buildXNhanEvidenceSnapshot(posts);
  } catch {
    throw openAiError("invalid_openai_request", 500);
  }

  const { body } = buildRequestBody({
    environment,
    history: conversationContext,
    locale,
    model,
    query,
    evidenceSnapshot,
    requestId,
    safetyIdentifier,
    qualityCorrection,
  });

  let response;
  try {
    response = await fetchImpl(XNHAN_OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Client-Request-Id": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
      redirect: WORKER_FETCH_REDIRECT,
      signal: combinedSignal(signal, timeoutMs),
    });
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw openAiError("openai_timeout", 504, true);
    }
    throw openAiError("openai_unavailable", 503, true);
  }

  if (isUpstreamRedirectResponse(response)) {
    await cancelResponseBody(response);
    throw openAiError("openai_upstream_error", 502);
  }

  if (!response.ok) {
    await cancelResponseBody(response);
    if (response.status === 429) {
      throw openAiError("openai_rate_limited", 429);
    }
    if (response.status === 401 || response.status === 403) {
      throw openAiError("openai_not_authorized", 503);
    }
    throw openAiError("openai_upstream_error", 502);
  }

  const mediaType = response.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json" && mediaType !== "text/event-stream") {
    await cancelResponseBody(response);
    throw openAiError("invalid_openai_response", 502);
  }

  let result;
  try {
    if (mediaType === "text/event-stream") {
      const activityState = { reasoningSummaries: new Set() };
      result = await readOpenAIResponseStream(response, {
        maxBytes: XNHAN_OPENAI_MAX_RESPONSE_BYTES,
        onEvent: (event) =>
          emitSynthesisActivity(event, onActivity, activityState),
      });
    } else {
      const responseBody = await readBoundedRequestBody(
        response,
        XNHAN_OPENAI_MAX_RESPONSE_BYTES,
      );
      if (responseBody.tooLarge) {
        await cancelResponseBody(response);
        throw openAiError("openai_response_too_large", 502);
      }
      result = JSON.parse(responseBody.text);
    }
  } catch (error) {
    if (error instanceof XNhanOpenAIError) throw error;
    if (error?.code === "openai_response_too_large") {
      throw openAiError("openai_response_too_large", 502);
    }
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw openAiError("openai_timeout", 504, true);
    }
    throw openAiError("invalid_openai_response", 502);
  }

  const providerUsage = normalizeXNhanOpenAiUsage(result.usage);
  const outputText = extractOutputText(result, model);
  if (!outputText) {
    throw openAiError("invalid_openai_response", 502, false, providerUsage);
  }

  let structured;
  if (
    new TextEncoder().encode(outputText.trim()).byteLength >
      MAX_EVIDENCE_PLAN_BYTES
  ) {
    throw openAiError("invalid_openai_summary", 502, false, providerUsage);
  }
  try {
    structured = JSON.parse(outputText);
  } catch {
    throw openAiError("invalid_openai_summary", 502, false, providerUsage);
  }
  const summary = extractXNhanEvidencePlan(
    structured,
    evidenceSnapshot,
    locale,
    { requireNaturalAnswer: true },
  );
  if (!summary) {
    throw openAiError(
      "invalid_openai_answer_contract",
      502,
      false,
      providerUsage,
    );
  }
  return providerUsage ? { ...summary, providerUsage } : summary;
}

export async function runXNhanTranslation(
  apiKey,
  {
    environment = "local_canary",
    locale,
    model,
    qualityCorrection = false,
    requestId,
    safetyIdentifier,
    signal,
    summary,
    fetchImpl = globalThis.fetch,
    timeoutMs = XNHAN_OPENAI_TIMEOUT_MS,
  },
) {
  if (
    !["local_canary", "production", "test"].includes(environment) ||
    !["en", "vi"].includes(locale) ||
    !isXNhanOpenAiModelId(model) ||
    typeof safetyIdentifier !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(safetyIdentifier) ||
    typeof requestId !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(requestId) ||
    typeof fetchImpl !== "function" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > XNHAN_OPENAI_TIMEOUT_MS
  ) {
    throw openAiError("invalid_openai_translation_request", 500);
  }

  let translationSnapshot;
  try {
    translationSnapshot = buildXNhanTranslationSnapshot(summary, locale);
  } catch {
    throw openAiError("invalid_openai_translation_request", 500);
  }
  if (translationSnapshot.items.length === 0) return summary;

  const { body } = buildTranslationRequestBody({
    environment,
    model,
    qualityCorrection,
    requestId,
    safetyIdentifier,
    translationSnapshot,
  });

  let response;
  try {
    response = await fetchImpl(XNHAN_OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Client-Request-Id": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
      redirect: WORKER_FETCH_REDIRECT,
      signal: combinedSignal(signal, timeoutMs),
    });
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw openAiError("openai_timeout", 504, true);
    }
    throw openAiError("openai_unavailable", 503, true);
  }

  if (isUpstreamRedirectResponse(response)) {
    await cancelResponseBody(response);
    throw openAiError("openai_upstream_error", 502);
  }
  if (!response.ok) {
    await cancelResponseBody(response);
    if (response.status === 429) {
      throw openAiError("openai_rate_limited", 429);
    }
    if (response.status === 401 || response.status === 403) {
      throw openAiError("openai_not_authorized", 503);
    }
    throw openAiError("openai_upstream_error", 502);
  }

  const mediaType = response.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json" && mediaType !== "text/event-stream") {
    await cancelResponseBody(response);
    throw openAiError("invalid_openai_response", 502);
  }

  let result;
  try {
    if (mediaType === "text/event-stream") {
      result = await readOpenAIResponseStream(response, {
        maxBytes: XNHAN_OPENAI_MAX_RESPONSE_BYTES,
      });
    } else {
      const responseBody = await readBoundedRequestBody(
        response,
        XNHAN_OPENAI_MAX_RESPONSE_BYTES,
      );
      if (responseBody.tooLarge) {
        await cancelResponseBody(response);
        throw openAiError("openai_response_too_large", 502);
      }
      result = JSON.parse(responseBody.text);
    }
  } catch (error) {
    if (error instanceof XNhanOpenAIError) throw error;
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw openAiError("openai_timeout", 504, true);
    }
    throw openAiError("invalid_openai_response", 502);
  }

  const providerUsage = normalizeXNhanOpenAiUsage(result.usage);
  const outputText = extractOutputText(result, model);
  if (!outputText) {
    throw openAiError("invalid_openai_response", 502, false, providerUsage);
  }
  if (
    new TextEncoder().encode(outputText.trim()).byteLength >
      MAX_TRANSLATION_PLAN_BYTES
  ) {
    throw openAiError(
      "invalid_openai_translation_contract",
      502,
      false,
      providerUsage,
    );
  }

  let structured;
  try {
    structured = JSON.parse(outputText);
  } catch {
    throw openAiError(
      "invalid_openai_translation_contract",
      502,
      false,
      providerUsage,
    );
  }
  const plan = extractXNhanTranslationPlan(structured, translationSnapshot);
  if (!plan) {
    throw openAiError(
      "invalid_openai_translation_contract",
      502,
      false,
      providerUsage,
    );
  }

  let translated;
  try {
    translated = applyXNhanTranslationPlan(
      summary,
      translationSnapshot,
      plan,
    );
  } catch {
    throw openAiError(
      "invalid_openai_translation_contract",
      502,
      false,
      providerUsage,
    );
  }
  return providerUsage ? { ...translated, providerUsage } : translated;
}
