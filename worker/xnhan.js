import {
  normalizeXNhanConversationHistory,
  normalizeXNhanQuery,
  xNhanQueryLength,
  XNHAN_QUERY_MAX_LENGTH,
  XNHAN_REQUEST_MAX_BYTES,
} from "../shared/xnhan.js";
import { resolveAnswerLocale } from "../src/answer-language.js";
import { createDeadlineSignal } from "./abort-signal.js";
import { SUPPORTED_LOCALES } from "./config.js";
import {
  errorResponse,
  hasStrictSameOriginEvidence,
  jsonResponse,
  readBoundedRequestBody,
  safeErrorName,
  streamResponse,
} from "./http.js";
import { digestRateLimitKey } from "./rate-limit.js";
import { readXNhanProviderUsages } from "./xnhan-openai-config.js";
import {
  XNhanProviderError,
} from "./xnhan-provider.js";
import {
  getXNhanProvider,
  normalizeXNhanProvider,
} from "./xnhan-provider-registry.js";
import {
  markXNhanTranslationUnavailable,
  requiresXNhanTranslation,
} from "./xnhan-prompt.js";

const MAX_CONNECTION_SOURCE_LENGTH = 512;
// Provider API keys are high-entropy in production; keep a conservative
// lower bound while allowing provider-specific key prefixes and test fixtures.
const MIN_SAFETY_ID_KEY_LENGTH = 16;
const MAX_SAFETY_ID_KEY_LENGTH = 8_192;
const REQUEST_FIELDS = new Set(["history", "locale", "provider", "query"]);
const PRODUCTION_HOSTNAME = "tranthiennhan.com";
const XNHAN_INFERENCE_RATE_LIMIT_KEY = "xnhan-inference";
// Budget ledger for the longest valid OpenAI path:
// discovery 240 s + synthesis 240 s + one contract correction 240 s +
// translation and its correction 30 s + 30 s orchestration reserve.
// Provider calls still keep their own shorter deadlines, while this outer
// deadline prevents a disconnected or stalled pipeline from running forever.
export const XNHAN_PIPELINE_TIMEOUT_MS = 780_000;
const XNHAN_SSE_HEARTBEAT_MS = 20_000;
const XNHAN_SYNTHESIS_CORRECTION_RESERVE_MS = 270_000;
const XNHAN_TRANSLATION_RESERVE_MS = 30_000;
const XNHAN_TRANSLATION_CORRECTION_RESERVE_MS = 15_000;

function logOperationalError(event, requestId, outcome, error) {
  console.error(
    JSON.stringify({
      event,
      requestId,
      outcome,
      errorName: safeErrorName(error),
      ...(error instanceof XNhanProviderError && { errorCode: error.code }),
      ...(error instanceof XNhanProviderError &&
        error.diagnosticCode !== undefined && {
          diagnosticCode: error.diagnosticCode,
        }),
      ...(error instanceof XNhanProviderError &&
        error.upstreamStatus !== undefined && {
          upstreamStatus: error.upstreamStatus,
        }),
    }),
  );
}

function hasApiKeyBinding(binding) {
  return (
    typeof binding === "string" || typeof binding?.get === "function"
  );
}

function anonymousConnectionSource(request) {
  const value =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("User-Agent") ||
    "anonymous";
  return value.slice(0, MAX_CONNECTION_SOURCE_LENGTH);
}

async function anonymousRateLimitKey(request) {
  return digestRateLimitKey("xnhan", anonymousConnectionSource(request));
}

async function createSafetyIdentifier(providerApiKey, request) {
  if (typeof providerApiKey !== "string") return null;

  const keyMaterial = providerApiKey.trim();
  if (
    keyMaterial.length < MIN_SAFETY_ID_KEY_LENGTH ||
    keyMaterial.length > MAX_SAFETY_ID_KEY_LENGTH
  ) {
    return null;
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyMaterial),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(
      `xnhan-safety:${anonymousConnectionSource(request)}`,
    ),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function checkXNhanRateLimit(request, binding, requestId) {
  try {
    const key = await anonymousRateLimitKey(request);
    const result = await binding.limit({ key });
    if (result?.success === true) {
      return { status: "allowed" };
    }
    if (result?.success === false) {
      return { status: "limited" };
    }
    throw new TypeError("invalid_rate_limit_result");
  } catch (error) {
    logOperationalError(
      "xnhan_rate_limit",
      requestId,
      "rate_limit_error",
      error,
    );
    return { status: "unavailable" };
  }
}

async function checkXNhanInferenceRateLimit(binding, requestId) {
  try {
    const result = await binding.limit({ key: XNHAN_INFERENCE_RATE_LIMIT_KEY });
    if (result?.success === true) return "allowed";
    if (result?.success === false) return "limited";
    throw new TypeError("invalid_rate_limit_result");
  } catch (error) {
    logOperationalError(
      "xnhan_inference_rate_limit",
      requestId,
      "rate_limit_error",
      error,
    );
    return "unavailable";
  }
}

function providerErrorResponse(error, requestId) {
  const headers = error.retryAfter
    ? { "Retry-After": error.retryAfter }
    : undefined;
  return errorResponse(error.code, error.status, requestId, headers);
}

function metricNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : -1;
}

function writeProviderUsageMetric(env, payload) {
  try {
    env.ASK_NHAN_METRICS?.writeDataPoint({
      indexes: ["xnhan_provider_usage"],
      blobs: [
        payload.provider,
        payload.model,
        payload.operation,
        payload.promptVersion,
        payload.outcome,
        payload.usage?.cachedInputTokens === null ||
        payload.usage?.cachedInputTokens === undefined
          ? "cache_metric_unknown"
          : "cache_metric_present",
      ],
      doubles: [
        metricNumber(payload.durationMs),
        metricNumber(payload.usage?.inputTokens),
        metricNumber(payload.usage?.cachedInputTokens),
        metricNumber(payload.usage?.cacheWriteTokens),
        metricNumber(payload.usage?.outputTokens),
        metricNumber(payload.usage?.cost),
        metricNumber(payload.usage?.webSearchRequests),
      ],
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "xnhan_provider_metrics",
        outcome: "write_error",
        errorName: safeErrorName(error),
      }),
    );
  }
}

function writeXNhanResultMetric(env, payload) {
  try {
    env.ASK_NHAN_METRICS?.writeDataPoint({
      indexes: ["xnhan_result_quality"],
      blobs: [
        payload.provider,
        payload.model,
        payload.mode,
        payload.distinctAuthorCount > 1
          ? "multi_author"
          : payload.sourceCount === 0
            ? "no_sources"
            : "single_author",
      ],
      doubles: [
        metricNumber(payload.durationMs),
        metricNumber(payload.rawCount),
        metricNumber(payload.acceptedCount),
        metricNumber(payload.sourceCount),
        metricNumber(payload.distinctAuthorCount),
        metricNumber(payload.datedSourceCount),
        metricNumber(payload.newestSourceAgeSeconds),
        metricNumber(payload.oldestSourceAgeSeconds),
        metricNumber(payload.answerBlockCount),
        metricNumber(payload.answerSourceCount),
      ],
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "xnhan_result_metrics",
        outcome: "write_error",
        errorName: safeErrorName(error),
      }),
    );
  }
}

function reportProviderErrorUsage(
  error,
  onUsage,
  operation,
  promptVersion,
  durationMs,
) {
  for (const usage of readXNhanProviderUsages(error)) {
    onUsage?.({
      operation,
      promptVersion,
      outcome: "error",
      durationMs,
      usage,
    });
  }
}

async function executeXNhanSearch({
  apiKey,
  environment,
  history,
  locale,
  onActivity,
  query,
  requestId,
  safetyIdentifier,
  signal,
  providerConfig,
  onResult,
  onUsage,
}) {
  const pipelineStartedAt = Date.now();
  const pipelineDeadlineAt = pipelineStartedAt + XNHAN_PIPELINE_TIMEOUT_MS;
  const pipelineSignal = createDeadlineSignal(
    XNHAN_PIPELINE_TIMEOUT_MS,
    signal,
  );
  const pipelineRemainingMs = () => Math.max(0, pipelineDeadlineAt - Date.now());
  let searchResult;
  const discoveryStartedAt = Date.now();
  await onActivity?.({
    phase: "discovery",
    kind: "phase",
    status: "started",
  });
  try {
    searchResult = await providerConfig.search(apiKey, query, {
      environment,
      history,
      locale,
      requestId,
      safetyIdentifier,
      signal: pipelineSignal,
      onActivity: (activity) =>
        onActivity?.({ phase: "discovery", ...activity }),
    });
  } catch (error) {
    reportProviderErrorUsage(
      error,
      onUsage,
      "discovery",
      providerConfig.discoveryPromptVersion,
      Date.now() - discoveryStartedAt,
    );
    logOperationalError(
      "xnhan_search",
      requestId,
      "search_error",
      error,
    );
    throw error;
  }
  await onActivity?.({
    phase: "discovery",
    kind: "phase",
    status: "completed",
    acceptedCount: searchResult.posts.length,
    durationMs: Date.now() - discoveryStartedAt,
  });
  const discoveryDurationMs = Date.now() - discoveryStartedAt;
  for (const usage of Array.isArray(searchResult.providerUsage)
    ? searchResult.providerUsage
    : [searchResult.providerUsage]) {
    if (!usage) continue;
    onUsage?.({
      operation: "discovery",
      promptVersion: providerConfig.discoveryPromptVersion,
      outcome: "completed",
      durationMs: discoveryDurationMs,
      usage,
    });
  }

  let answer = null;
  let answerBlocks = [];
  let answerSourceIds = null;
  let mode = "retrieval_only";
  let responsePosts = searchResult.posts;
  if (searchResult.posts.length > 0) {
    let summary = null;
    const synthesisStartedAt = Date.now();
    await onActivity?.({
      phase: "synthesis",
      kind: "phase",
      status: "started",
    });
    const synthesisOptions = {
      environment,
      history,
      locale,
      query,
      posts: searchResult.posts,
      requestId,
      safetyIdentifier,
      signal: pipelineSignal,
      onActivity: (activity) =>
        onActivity?.({ phase: "synthesis", ...activity }),
    };
    let summaryError = null;
    try {
      summary = await providerConfig.summarize(apiKey, synthesisOptions);
    } catch (error) {
      reportProviderErrorUsage(
        error,
        onUsage,
        "synthesis",
        providerConfig.synthesisPromptVersion,
        Date.now() - synthesisStartedAt,
      );
      if (
        providerConfig.id === "openai" &&
        error?.code === "invalid_openai_answer_contract" &&
        pipelineSignal?.aborted !== true &&
        pipelineRemainingMs() >= XNHAN_SYNTHESIS_CORRECTION_RESERVE_MS
      ) {
        try {
          summary = await providerConfig.summarize(apiKey, {
            ...synthesisOptions,
            qualityCorrection: true,
          });
        } catch (retryError) {
          reportProviderErrorUsage(
            retryError,
            onUsage,
            "synthesis",
            providerConfig.synthesisPromptVersion,
            Date.now() - synthesisStartedAt,
          );
          summaryError = retryError;
        }
      } else {
        summaryError = error;
      }
    }
    if (summary) {
      for (const usage of Array.isArray(summary?.providerUsage)
        ? summary.providerUsage
        : [summary?.providerUsage]) {
        if (!usage) continue;
        onUsage?.({
          operation: "synthesis",
          promptVersion: providerConfig.synthesisPromptVersion,
          outcome: "completed",
          durationMs: Date.now() - synthesisStartedAt,
          usage,
        });
      }
    }
    if (summaryError) {
      logOperationalError(
        "xnhan_summary",
        requestId,
        "summary_unavailable",
        summaryError,
      );
      await onActivity?.({
        phase: "synthesis",
        kind: "phase",
        status: "unavailable",
        durationMs: Date.now() - synthesisStartedAt,
      });
    }

    const translationRequired =
      summary?.state === "selected" &&
      requiresXNhanTranslation(summary, locale);
    if (
      translationRequired &&
      pipelineRemainingMs() >= XNHAN_TRANSLATION_RESERVE_MS
    ) {
      const translationStartedAt = Date.now();
      let translatedSummary = null;
      let translationError = null;
      const translationOptions = {
        environment,
        locale,
        requestId,
        safetyIdentifier,
        signal: pipelineSignal,
        summary,
      };
      try {
        translatedSummary = await providerConfig.translate(
          apiKey,
          translationOptions,
        );
      } catch (error) {
        reportProviderErrorUsage(
          error,
          onUsage,
          "translation",
          providerConfig.translationPromptVersion,
          Date.now() - translationStartedAt,
        );
        if (
          providerConfig.id === "openai" &&
          error?.code === "invalid_openai_translation_contract" &&
          pipelineSignal?.aborted !== true &&
          pipelineRemainingMs() >=
            XNHAN_TRANSLATION_CORRECTION_RESERVE_MS
        ) {
          try {
            translatedSummary = await providerConfig.translate(apiKey, {
              ...translationOptions,
              qualityCorrection: true,
            });
          } catch (retryError) {
            reportProviderErrorUsage(
              retryError,
              onUsage,
              "translation",
              providerConfig.translationPromptVersion,
              Date.now() - translationStartedAt,
            );
            translationError = retryError;
          }
        } else {
          translationError = error;
        }
      }
      if (translatedSummary) {
        for (const usage of Array.isArray(translatedSummary.providerUsage)
          ? translatedSummary.providerUsage
          : [translatedSummary.providerUsage]) {
          if (!usage) continue;
          onUsage?.({
            operation: "translation",
            promptVersion: providerConfig.translationPromptVersion,
            outcome: "completed",
            durationMs: Date.now() - translationStartedAt,
            usage,
          });
        }
        summary = translatedSummary;
      } else if (translationError) {
        logOperationalError(
          "xnhan_translation",
          requestId,
          "translation_unavailable",
          translationError,
        );
        summary = markXNhanTranslationUnavailable(summary, locale);
      }
    } else if (translationRequired) {
      summary = markXNhanTranslationUnavailable(summary, locale);
    }

    if (summary) {
      try {
        if (summary.state === "no_selection") {
          if (
            summary.answer !== null ||
            !Array.isArray(summary.answerBlocks) ||
            summary.answerBlocks.length !== 0 ||
            !Array.isArray(summary.usedSourceIds) ||
            summary.usedSourceIds.length !== 0
          ) {
            throw new Error("invalid_openai_source_selection");
          }
          answer = null;
          answerBlocks = [];
          answerSourceIds = null;
          responsePosts = searchResult.posts;
          mode = "retrieval_only";
        } else {
          if (summary.state !== "selected") {
            throw new Error("invalid_openai_source_selection");
          }
          answer = summary.answer;
          const usedSourceIds = new Set(summary.usedSourceIds);
          responsePosts = searchResult.posts.filter((_, index) =>
            usedSourceIds.has(`P${index + 1}`),
          );
          if (responsePosts.length !== usedSourceIds.size) {
            throw new Error("invalid_openai_source_selection");
          }
          const postIdBySourceId = new Map(
            searchResult.posts.map((post, index) => [`P${index + 1}`, post.id]),
          );
          answerBlocks = summary.answerBlocks.map((block) => {
            const rendered = {
              text: block.text,
              prefix: block.prefix,
              passage: block.passage,
              passageLocale: block.passageLocale,
              sourceIds: block.sourceIds.map((sourceId) => {
                const postId = postIdBySourceId.get(sourceId);
                if (!postId || !usedSourceIds.has(sourceId)) {
                  throw new Error("invalid_openai_source_selection");
                }
                return postId;
              }),
            };
            // Keep the public response compact for the common same-locale
            // path.  Translation metadata is emitted only when it changes
            // how the client must render the passage or its source disclosure.
            if (block.translationStatus !== "not_needed") {
              rendered.translationStatus = block.translationStatus;
              rendered.sourcePassagePrefix = block.sourcePassagePrefix;
              rendered.sourcePassage = block.sourcePassage;
              rendered.sourcePassageLocale = block.sourcePassageLocale;
            }
            return rendered;
          });
          if (Array.isArray(summary.answerSourceIds)) {
            const sourceOrder = new Map(
              summary.usedSourceIds.map((sourceId, index) => [sourceId, index]),
            );
            const canonicalAnswerSourceIds = [...summary.answerSourceIds].sort(
              (left, right) => sourceOrder.get(left) - sourceOrder.get(right),
            );
            answerSourceIds = canonicalAnswerSourceIds.map((sourceId) => {
              const postId = postIdBySourceId.get(sourceId);
              if (!postId || !usedSourceIds.has(sourceId)) {
                throw new Error("invalid_openai_source_selection");
              }
              return postId;
            });
          } else {
            answerSourceIds = null;
          }
          mode = "ai";
        }
        await onActivity?.({
          phase: "synthesis",
          kind: "phase",
          status: "completed",
          durationMs: Date.now() - synthesisStartedAt,
        });
      } catch (error) {
        answer = null;
        answerBlocks = [];
        answerSourceIds = null;
        responsePosts = searchResult.posts;
        logOperationalError(
          "xnhan_summary",
          requestId,
          "summary_unavailable",
          error,
        );
        await onActivity?.({
          phase: "synthesis",
          kind: "phase",
          status: "unavailable",
          durationMs: Date.now() - synthesisStartedAt,
        });
      }
    }
  }

  const observedAtMs = Date.parse(searchResult.observedAt);
  const sourceAgesSeconds = responsePosts
    .map((post) => Date.parse(post.publishedAt))
    .filter(
      (publishedAtMs) =>
        Number.isFinite(observedAtMs) &&
        Number.isFinite(publishedAtMs) &&
        publishedAtMs <= observedAtMs,
    )
    .map((publishedAtMs) => (observedAtMs - publishedAtMs) / 1_000);
  const result = {
    requestId,
    query,
    answerLocale: locale,
    observedAt: searchResult.observedAt,
    answer,
    ...(answerSourceIds ? { answerSourceIds } : {}),
    answerBlocks,
    mode,
    posts: responsePosts,
    retrieval: {
      provider: providerConfig.id,
      model: providerConfig.model,
      modelDisplayName: providerConfig.modelDisplayName,
      complete: false,
      rawCount: searchResult.rawCount,
      acceptedCount: searchResult.posts.length,
      sourceCount: responsePosts.length,
    },
  };
  onResult?.({
    durationMs: Date.now() - pipelineStartedAt,
    mode,
    rawCount: searchResult.rawCount,
    acceptedCount: searchResult.posts.length,
    sourceCount: responsePosts.length,
    distinctAuthorCount: new Set(
      responsePosts.map((post) => post.author.handle),
    ).size,
    datedSourceCount: sourceAgesSeconds.length,
    newestSourceAgeSeconds:
      sourceAgesSeconds.length > 0 ? Math.min(...sourceAgesSeconds) : -1,
    oldestSourceAgeSeconds:
      sourceAgesSeconds.length > 0 ? Math.max(...sourceAgesSeconds) : -1,
    answerBlockCount: answerBlocks.length,
    answerSourceCount: answerSourceIds?.length ?? 0,
  });
  return result;
}

async function executeXNhanJsonSearch(options) {
  try {
    return jsonResponse(await executeXNhanSearch(options), {
      requestId: options.requestId,
    });
  } catch (error) {
    if (error instanceof XNhanProviderError) {
      return providerErrorResponse(error, options.requestId);
    }
    return errorResponse(
      "search_temporarily_unavailable",
      503,
      options.requestId,
      { "Retry-After": "10" },
    );
  }
}

function xnhanEventStream(options, requestSignal) {
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  let sequence = 0;
  let closed = false;
  let heartbeatTimer = null;

  const clearHeartbeat = () => {
    if (heartbeatTimer === null) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  const readable = new ReadableStream({
    start(controller) {
      const closeAfterEnqueueFailure = () => {
        clearHeartbeat();
        closed = true;
        abortController.abort("xnhan_stream_closed");
      };
      const send = (event, payload) => {
        if (closed) return false;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
            ),
          );
          return true;
        } catch {
          closeAfterEnqueueFailure();
          return false;
        }
      };

      const sendHeartbeat = () => {
        if (closed) {
          clearHeartbeat();
          return;
        }
        try {
          // SSE comments carry no product or user content and are ignored by
          // conforming clients. They keep an intentionally long search visibly
          // alive without weakening the event state machine.
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          closeAfterEnqueueFailure();
        }
      };

      const forwardActivity = async (activity) => {
        const { sources = [], ...boundedActivity } = activity;
        send("activity", {
          sequence: ++sequence,
          ...boundedActivity,
        });
        for (const source of sources) {
          if (!source) continue;
          send("source", {
            id: source.id,
            url: source.url,
            handle: source.handle,
          });
        }
      };

      const abortFromRequest = () =>
        abortController.abort("xnhan_client_disconnected");
      requestSignal?.addEventListener("abort", abortFromRequest, { once: true });
      if (requestSignal?.aborted) {
        abortFromRequest();
        requestSignal.removeEventListener("abort", abortFromRequest);
        closed = true;
        controller.close();
        return;
      }

      const accepted = send("accepted", {
        requestId: options.requestId,
        provider: options.providerConfig.id,
        model: options.providerConfig.model,
        modelDisplayName: options.providerConfig.modelDisplayName,
      });
      if (accepted) {
        heartbeatTimer = setInterval(sendHeartbeat, XNHAN_SSE_HEARTBEAT_MS);
      }
      void (async () => {
        try {
          const result = await executeXNhanSearch({
            ...options,
            signal: abortController.signal,
            onActivity: forwardActivity,
          });
          send("result", result);
        } catch (error) {
          send("error", {
            error:
              error instanceof XNhanProviderError
                ? error.code
                : "search_temporarily_unavailable",
            requestId: options.requestId,
          });
        } finally {
          clearHeartbeat();
          requestSignal?.removeEventListener("abort", abortFromRequest);
          send("done", { requestId: options.requestId });
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      })();
    },
    cancel() {
      clearHeartbeat();
      closed = true;
      abortController.abort("xnhan_stream_cancelled");
    },
  });

  return streamResponse(readable, { requestId: options.requestId });
}

export async function handleXNhanSearch(request, env) {
  const requestId = crypto.randomUUID();

  if (request.method !== "POST") {
    return errorResponse("method_not_allowed", 405, requestId, {
      Allow: "POST",
    });
  }
  if (!hasStrictSameOriginEvidence(request)) {
    return errorResponse("cross_origin_request_denied", 403, requestId);
  }

  const mediaType = request.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return errorResponse("json_content_type_required", 415, requestId);
  }

  let body;
  try {
    const requestBody = await readBoundedRequestBody(
      request,
      XNHAN_REQUEST_MAX_BYTES,
    );
    if (requestBody.tooLarge) {
      return errorResponse("request_too_large", 413, requestId);
    }
    body = JSON.parse(requestBody.text);
  } catch {
    return errorResponse("invalid_json", 400, requestId);
  }

  if (!body || Array.isArray(body) || typeof body !== "object") {
    return errorResponse("invalid_request", 400, requestId);
  }

  const bodyFields = Object.keys(body);
  const pageLocale = body.locale;
  const providerId = body.provider;
  const history = normalizeXNhanConversationHistory(body.history);
  if (
    bodyFields.length !== REQUEST_FIELDS.size ||
    bodyFields.some((field) => !REQUEST_FIELDS.has(field)) ||
    !SUPPORTED_LOCALES.has(pageLocale) ||
    !normalizeXNhanProvider(providerId) ||
    history === null ||
    typeof body.query !== "string"
  ) {
    return errorResponse("invalid_request", 400, requestId);
  }

  const query = normalizeXNhanQuery(body.query);
  if (!query) return errorResponse("query_required", 400, requestId);
  if (xNhanQueryLength(query) > XNHAN_QUERY_MAX_LENGTH) {
    return errorResponse("query_too_long", 413, requestId);
  }
  const locale = resolveAnswerLocale(query, pageLocale);

  if (
    typeof env.XNHAN_RATE_LIMIT?.limit !== "function" ||
    typeof env.XNHAN_INFERENCE_RATE_LIMIT?.limit !== "function"
  ) {
    return errorResponse("service_not_configured", 503, requestId);
  }

  const rateLimitResult = await checkXNhanRateLimit(
    request,
    env.XNHAN_RATE_LIMIT,
    requestId,
  );
  if (rateLimitResult.status === "unavailable") {
    return errorResponse("rate_limit_temporarily_unavailable", 503, requestId, {
      "Retry-After": "10",
    });
  }
  if (rateLimitResult.status === "limited") {
    return errorResponse("rate_limited", 429, requestId, {
      "Retry-After": "60",
    });
  }

  const providerConfig = getXNhanProvider(providerId, env);
  if (!providerConfig || !hasApiKeyBinding(providerConfig.apiKeyBinding)) {
    return errorResponse(
      "search_provider_not_configured",
      503,
      requestId,
    );
  }

  let apiKey;
  try {
    apiKey = await providerConfig.resolveApiKey(providerConfig.apiKeyBinding);
  } catch (error) {
    logOperationalError(
      "xnhan_provider_key",
      requestId,
      "provider_not_configured",
      error,
    );
    return errorResponse(
      "search_provider_not_configured",
      503,
      requestId,
    );
  }
  if (!apiKey) {
    return errorResponse(
      "search_provider_not_configured",
      503,
      requestId,
    );
  }

  let safetyIdentifier;
  try {
    // Reuse the already-resolved requested provider key as the HMAC material;
    // no additional secret binding is required or exposed.
    safetyIdentifier = await createSafetyIdentifier(apiKey, request);
    if (!safetyIdentifier) throw new TypeError("invalid_safety_identifier_key");
  } catch (error) {
    logOperationalError(
      "xnhan_safety_identifier",
      requestId,
      "safety_identifier_unavailable",
      error,
    );
    return errorResponse("service_not_configured", 503, requestId);
  }

  const environment =
    new URL(request.url).hostname === PRODUCTION_HOSTNAME
      ? "production"
      : "local_canary";

  const inferenceRateLimitStatus = await checkXNhanInferenceRateLimit(
    env.XNHAN_INFERENCE_RATE_LIMIT,
    requestId,
  );
  if (inferenceRateLimitStatus === "unavailable") {
    return errorResponse("rate_limit_temporarily_unavailable", 503, requestId, {
      "Retry-After": "10",
    });
  }
  if (inferenceRateLimitStatus === "limited") {
    return errorResponse("rate_limited", 429, requestId, {
      "Retry-After": "60",
    });
  }

  const options = {
    apiKey,
    environment,
    history,
    locale,
    query,
    requestId,
    safetyIdentifier,
    providerConfig,
    onResult: (payload) =>
      writeXNhanResultMetric(env, {
        ...payload,
        provider: providerConfig.id,
        model: providerConfig.model,
      }),
    onUsage: (payload) =>
      writeProviderUsageMetric(env, {
        ...payload,
        provider: providerConfig.id,
        model: providerConfig.model,
      }),
  };
  const acceptsEvents = request.headers
    .get("Accept")
    ?.split(",")
    .some((value) => value.split(";", 1)[0].trim() === "text/event-stream");
  return acceptsEvents
    ? xnhanEventStream(options, request.signal)
    : executeXNhanJsonSearch({ ...options, signal: request.signal });
}
