import { SECURITIES_MODEL_ID, SecuritiesModelError } from "./model-contract.js";
import {
  SECURITIES_ISSUERS,
  SECURITIES_SOURCE_DOCUMENTS,
} from "../../shared/securities/source-contract.js";

export const SECURITIES_OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const SECURITIES_MODEL_METADATA_ENDPOINT = `https://openrouter.ai/api/v1/models/${SECURITIES_MODEL_ID}/endpoints`;
export const SECURITIES_MODEL_TIMEOUT_MS = 90_000;
export const SECURITIES_MODEL_RESPONSE_BYTES = 1_500_000;
export const SECURITIES_MODEL_OUTPUT_TOKENS = 12_000;
export const SECURITIES_MODEL_REASONING_EFFORT = "low";
const safeInteger = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const safeNumber = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const safeLabel = (value, max = 160) =>
  typeof value === "string" &&
  !/sk-or-/i.test(value) &&
  new RegExp(`^[a-zA-Z0-9_.:/ |()-]{1,${max}}$`).test(value)
    ? value
    : null;

export function validModelSourceDomains(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 3 &&
    new Set(value).size === value.length &&
    value.every(
      (domain) =>
        typeof domain === "string" &&
        domain.length <= 253 &&
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/u.test(domain) &&
        !/(?:^|\.)(?:localhost|local|internal|invalid|test|onion)$/u.test(domain),
    )
  );
}

function permittedServerTool(tool, steps, sourceDomains) {
  if (
    !tool ||
    typeof tool !== "object" ||
    Array.isArray(tool) ||
    Object.keys(tool).sort().join(",") !== "parameters,type" ||
    !tool.parameters ||
    typeof tool.parameters !== "object" ||
    Array.isArray(tool.parameters)
  )
    return false;
  const params = tool.parameters;
  // The default remains the original issuer allowlist. The three-domain bound
  // applies to one request's scope, not the number of issuers in that registry.
  if (sourceDomains !== undefined && !validModelSourceDomains(sourceDomains)) return false;
  const approved =
    sourceDomains === undefined
      ? [
          ...new Set(
            [
              ...SECURITIES_ISSUERS.map((issuer) => issuer.landingUrl),
              ...SECURITIES_SOURCE_DOCUMENTS.map((document) => document.url),
            ].map((url) => new URL(url).hostname),
          ),
        ]
      : sourceDomains;
  const domains = new Set(approved);
  const domainScope =
    validModelSourceDomains(params.allowed_domains) &&
    params.allowed_domains.every((domain) => domains.has(domain));
  const within = (value, maximum) => Number.isSafeInteger(value) && value >= 1 && value <= maximum;
  if (!domainScope) return false;
  if (tool.type === "openrouter:web_search")
    return (
      params.engine === "parallel" &&
      params.mode === "basic" &&
      Object.keys(params).sort().join(",") ===
        "allowed_domains,engine,max_characters,max_results,max_total_results,max_uses,mode" &&
      within(params.max_results, 8) &&
      within(params.max_total_results, 16) &&
      within(params.max_uses, 4) &&
      within(params.max_characters, 2000) &&
      within(steps, 4)
    );
  if (tool.type === "openrouter:web_fetch")
    return (
      ["openrouter", "parallel"].includes(params.engine) &&
      Object.keys(params).sort().join(",") ===
        "allowed_domains,engine,max_content_tokens,max_uses" &&
      within(params.max_uses, 2) &&
      within(params.max_content_tokens, 40_000) &&
      within(steps, 2)
    );
  return false;
}

function deadline(timeoutMs, upstream) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new DOMException("Cancelled", "AbortError"));
  if (upstream?.aborted) cancel();
  else upstream?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Timed out", "TimeoutError")),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timeout);
      upstream?.removeEventListener("abort", cancel);
    },
  };
}

export async function readBoundedProviderJson(
  response,
  maximumBytes = SECURITIES_MODEL_RESPONSE_BYTES,
) {
  const contentLength = response.headers.get("content-length");
  const declared =
    contentLength !== null && /^\d+$/u.test(contentLength)
      ? safeInteger(Number(contentLength))
      : null;
  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const isJson = /^application\/(?:[a-z0-9.+-]+\+)?json$/u.test(contentType);
  const encoding = (response.headers.get("content-encoding") ?? "").trim().toLowerCase();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let reader;
  let phase = "headers";
  let size = 0;
  let chunkCount = 0;
  let endOfStream = false;
  let content = "";
  // Record structural categories and counters only. Never retain body samples,
  // header values, provider error messages, prompts, or exception messages.
  const diagnostic = (error) => {
    const prefix = content.trimStart();
    const prefixKind = !prefix
      ? "empty"
      : prefix.startsWith("{")
        ? "json_object"
        : prefix.startsWith("[")
          ? "json_array"
          : prefix.startsWith('"')
            ? "json_string"
            : /^(?:data:|event:|:)/u.test(prefix)
              ? "sse"
              : /^<(?:!doctype\s+html|html)\b/iu.test(prefix)
                ? "html"
                : /^(?:true|false|null)(?:\s|$)/u.test(prefix)
                  ? "json_scalar"
                  : /^-?\d/u.test(prefix)
                    ? "json_number"
                    : "other";
    const exceptionName = [
      "SecuritiesModelError",
      "AbortError",
      "TimeoutError",
      "TypeError",
      "SyntaxError",
      "RangeError",
      "Error",
    ].includes(error?.name)
      ? error.name
      : "other";
    return {
      version: "provider-response-read",
      phase,
      exceptionName,
      contentType: isJson
        ? "json"
        : contentType === "text/event-stream"
          ? "sse"
          : contentType === "text/html"
            ? "html"
            : contentType === "text/plain"
              ? "text"
              : contentType
                ? "other"
                : "missing",
      contentEncoding: ["identity", "gzip", "br", "deflate"].includes(encoding)
        ? encoding
        : encoding
          ? "other"
          : "missing",
      declaredBytes: declared,
      receivedBytes: size,
      chunkCount,
      endOfStream,
      decodedCharacters: content.length,
      prefixKind,
    };
  };
  try {
    if (declared !== null && declared > maximumBytes)
      throw new SecuritiesModelError("provider_response_too_large");
    if (!response.body || !isJson) throw new SecuritiesModelError("provider_invalid_response");
    reader = response.body.getReader();
    for (;;) {
      phase = "stream_read";
      const { done, value } = await reader.read();
      if (done) {
        endOfStream = true;
        break;
      }
      chunkCount += 1;
      size += value.byteLength;
      phase = "body_limit";
      if (size > maximumBytes) throw new SecuritiesModelError("provider_response_too_large");
      phase = "utf8_decode";
      content += decoder.decode(value, { stream: true });
    }
    phase = "utf8_decode";
    content += decoder.decode();
    phase = "json_parse";
    const parsed = JSON.parse(content);
    phase = "envelope_shape";
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SecuritiesModelError("provider_invalid_response");
    }
    return parsed;
  } catch (error) {
    if (reader) await reader.cancel().catch(() => {});
    else await response.body?.cancel().catch(() => {});
    throw new SecuritiesModelError(
      error instanceof SecuritiesModelError ? error.code : "provider_invalid_json",
      502,
      { responseDiagnostic: diagnostic(error) },
    );
  } finally {
    reader?.releaseLock();
  }
}

export function normalizeSecuritiesUsage(usage) {
  const tools = usage?.server_tool_use ?? usage?.server_tool_use_details;
  const tokenDetails = usage?.prompt_tokens_details ?? usage?.input_tokens_details;
  return {
    inputTokens: safeInteger(usage?.prompt_tokens) ?? safeInteger(usage?.input_tokens),
    outputTokens: safeInteger(usage?.completion_tokens) ?? safeInteger(usage?.output_tokens),
    cachedInputTokens: safeInteger(tokenDetails?.cached_tokens),
    cacheWriteTokens: safeInteger(tokenDetails?.cache_write_tokens),
    reasoningTokens:
      safeInteger(usage?.completion_tokens_details?.reasoning_tokens) ??
      safeInteger(usage?.output_tokens_details?.reasoning_tokens),
    costUsd: safeNumber(usage?.cost),
    costStatus: safeNumber(usage?.cost) === null ? "unknown" : "provider_reported",
    webSearchRequests: safeInteger(tools?.web_search_requests),
    webFetchRequests: safeInteger(tools?.web_fetch_requests),
  };
}

export async function publishSecuritiesReceipts(receipts, onReceipt) {
  if (!onReceipt) return;
  try {
    for (const receipt of receipts) await onReceipt(receipt);
  } catch {
    throw new SecuritiesModelError("receipt_persistence_failed", 503, { receipts });
  }
}

function safeToolNames(value) {
  const known = new Set([
    "openrouter:web_search",
    "openrouter:web_fetch",
    "web_search",
    "web_fetch",
  ]);
  const found = [];
  const visit = (item, depth) => {
    if (depth > 5 || found.length > 60) return;
    if (typeof item === "string" && known.has(item)) found.push(item);
    if (Array.isArray(item)) item.slice(0, 60).forEach((entry) => visit(entry, depth + 1));
    else if (item && typeof item === "object") {
      for (const key of [
        "tools",
        "tools_invoked",
        "tool_names",
        "tool_calls",
        "name",
        "type",
        "tool",
        "function",
      ]) {
        if (Object.hasOwn(item, key)) visit(item[key], depth + 1);
      }
    }
  };
  visit(value, 0);
  return [...new Set(found)];
}

function modelOutputDiagnostic(result, phase) {
  const choice = result?.choices?.[0];
  const message = choice?.message;
  const kind = (value) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);
  const category = (value, allowed) =>
    value === undefined
      ? "missing"
      : value === null
        ? "null"
        : allowed.includes(value)
          ? value
          : "other";
  // The response is untrusted. Record structural enums and counts only; never
  // retain content, tool arguments, IDs, arbitrary names or exception messages.
  return {
    version: "provider-output-shape",
    phase,
    choicesType: kind(result?.choices),
    choiceCount: Array.isArray(result?.choices) ? result.choices.length : null,
    finishReason: category(choice?.finish_reason, [
      "stop",
      "length",
      "tool_calls",
      "content_filter",
      "function_call",
      "error",
    ]),
    role: category(message?.role, ["assistant", "user", "system", "developer", "tool", "function"]),
    contentType: kind(message?.content),
    contentCharacters: typeof message?.content === "string" ? message.content.length : null,
    contentItems: Array.isArray(message?.content) ? message.content.length : null,
    toolCallsType: kind(message?.tool_calls),
    remainingToolCallCount: Array.isArray(message?.tool_calls) ? message.tool_calls.length : null,
    remainingToolNames: safeToolNames(message?.tool_calls),
  };
}

export function normalizeSecuritiesRouting(result) {
  const metadata = result?.openrouter_metadata;
  const selected = Array.isArray(metadata?.endpoints?.available)
    ? metadata.endpoints.available.filter((endpoint) => endpoint?.selected === true)
    : [];
  const stages = Array.isArray(metadata?.pipeline) ? metadata.pipeline : [];
  return {
    requestedModel: safeLabel(metadata?.requested),
    actualModel: safeLabel(result?.model),
    provider: safeLabel(result?.provider) ?? safeLabel(selected[0]?.provider),
    strategy: safeLabel(metadata?.strategy),
    selectedEndpoints: selected.map((endpoint) => ({
      provider: safeLabel(endpoint.provider),
      nativeModel: safeLabel(endpoint.model),
    })),
    providerAttempts: Array.isArray(metadata?.attempts)
      ? metadata.attempts.slice(0, 10).map((attempt) => ({
          provider: safeLabel(attempt?.provider),
          model: safeLabel(attempt?.model),
          status: safeInteger(attempt?.status),
        }))
      : [],
    serverTools: stages
      .filter((stage) => stage?.type === "server_tools" && stage.name === "server-tools")
      .map((stage) => ({ mode: safeLabel(stage.data?.mode), tools: safeToolNames(stage.data) })),
  };
}

function validateRouting(result) {
  const metadata = result.openrouter_metadata;
  const routing = normalizeSecuritiesRouting(result);
  if (
    result.model !== SECURITIES_MODEL_ID ||
    (metadata?.requested !== undefined && metadata.requested !== SECURITIES_MODEL_ID) ||
    (metadata?.strategy !== undefined && metadata.strategy !== "direct") ||
    routing.providerAttempts.some((attempt) => attempt.model !== SECURITIES_MODEL_ID)
  ) {
    throw new SecuritiesModelError("provider_model_mismatch");
  }
  // `endpoints.available[].model` is the provider's native deployment label,
  // observed as a dated Meta revision in the current API. It is not the gateway
  // model ID. Never normalize an arbitrary gateway model from that native label:
  // the exact response.model and metadata.requested checks above remain binding.
  if (!routing.provider) throw new SecuritiesModelError("provider_provenance_missing");
  return routing;
}

function responseError(status) {
  if (status === 401) return new SecuritiesModelError("provider_invalid_key", 503);
  if (status === 402) return new SecuritiesModelError("provider_credit_exhausted", 503);
  if (status === 403) return new SecuritiesModelError("provider_request_denied", 502);
  if (status === 429) return new SecuritiesModelError("provider_rate_limited", 429);
  if ([400, 404, 422].includes(status))
    return new SecuritiesModelError("provider_capability_rejected", 502);
  if (status === 408 || status === 504) return new SecuritiesModelError("provider_timeout", 504);
  return new SecuritiesModelError("provider_unavailable", 503);
}

function retryAfterMilliseconds(response) {
  const header = response.headers.get("retry-after");
  if (!header) return 1000;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 1000;
}

function pause(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const done = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function resolveModelKey(env) {
  if (env?.SECURITIES_MODEL_MODE !== "live")
    throw new SecuritiesModelError("model_not_configured", 503);
  const binding = env.SECURITIES_OPENROUTER_API_KEY;
  const key =
    typeof binding === "string"
      ? binding
      : typeof binding?.get === "function"
        ? await binding.get()
        : null;
  if (typeof key !== "string" || !/^sk-or-[A-Za-z0-9_-]{16,256}$/.test(key)) {
    throw new SecuritiesModelError("model_not_configured", 503);
  }
  return key;
}

/** One logical operation. Only explicit rate-limit/service rejection gets one
 * retry. Transport timeout/cancellation is not replayed because billing and
 * upstream completion may be unknown. There is no session or monetary cap. */
export async function requestSecuritiesModel({
  env,
  messages,
  schema,
  schemaName,
  operation = "analysis",
  tools,
  maxToolCalls,
  sourceDomains,
  signal,
  fetchImpl = globalThis.fetch,
  timeoutMs = SECURITIES_MODEL_TIMEOUT_MS,
  onReceipt,
}) {
  if (
    !Array.isArray(messages) ||
    !messages.length ||
    typeof fetchImpl !== "function" ||
    !["analysis", "chat", "discovery", "fetch"].includes(operation) ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 180_000 ||
    (onReceipt !== undefined && typeof onReceipt !== "function") ||
    !schema ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(schemaName)
  ) {
    throw new SecuritiesModelError("invalid_model_request", 400);
  }
  if (
    (sourceDomains !== undefined &&
      (!validModelSourceDomains(sourceDomains) || tools === undefined)) ||
    (tools !== undefined &&
      (!Array.isArray(tools) ||
        tools.length !== 1 ||
        !permittedServerTool(tools[0], maxToolCalls, sourceDomains)))
  ) {
    throw new SecuritiesModelError("invalid_model_tools", 400);
  }
  if (signal?.aborted) throw new SecuritiesModelError("model_cancelled", 499);
  if (
    messages.some(
      (message) =>
        Array.isArray(message.content) && message.content.some((part) => part?.type !== "text"),
    )
  )
    throw new SecuritiesModelError("invalid_model_request", 400);
  const body = {
    model: SECURITIES_MODEL_ID,
    stream: false,
    temperature: 0.1,
    max_tokens: SECURITIES_MODEL_OUTPUT_TOKENS,
    reasoning: { effort: SECURITIES_MODEL_REASONING_EFFORT, exclude: true },
    provider: { allow_fallbacks: false, require_parameters: true },
    messages,
    response_format: {
      type: "json_schema",
      json_schema: { name: schemaName, strict: true, schema },
    },
    // Disable account-level legacy web plugins. Only declared server tools may run.
    plugins: [{ id: "web", enabled: false }],
    ...(tools ? { tools, max_tool_calls: maxToolCalls } : { tools: [], tool_choice: "none" }),
  };
  const encoded = JSON.stringify(body);
  if (new TextEncoder().encode(encoded).byteLength > 300_000)
    throw new SecuritiesModelError("model_context_too_large", 413);
  const key = await resolveModelKey(env);
  if (signal?.aborted) throw new SecuritiesModelError("model_cancelled", 499);
  const receipts = [];
  const overallStarted = Date.now();
  const expires = overallStarted + timeoutMs;
  const bounded = deadline(timeoutMs, signal);
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const transportAttemptId = crypto.randomUUID();
      const started = Date.now();
      let response;
      let parsed;
      let responseDiagnostic;
      let outputDiagnostic;
      let recorded = false;
      const record = async (outcome, code) => {
        const receipt = {
          evidenceType: fetchImpl === globalThis.fetch ? "openrouter_live" : "fixture",
          operation,
          attempt,
          transportAttemptId,
          ...normalizeSecuritiesRouting(parsed),
          requestedServerTools: (tools ?? []).map((tool) => ({
            type: tool.type,
            engine: tool.parameters.engine,
          })),
          // The request model is fixed even when router metadata is absent.
          requestedModel: SECURITIES_MODEL_ID,
          requestId: safeLabel(parsed?.id) ?? safeLabel(response?.headers.get("x-generation-id")),
          startedAt: new Date(started).toISOString(),
          completedAt: new Date().toISOString(),
          latencyMs: Date.now() - started,
          httpStatus: response?.status ?? null,
          outcome,
          errorCode: code ?? null,
          ...normalizeSecuritiesUsage(parsed?.usage),
          ...(responseDiagnostic ? { responseDiagnostic } : {}),
          ...(outputDiagnostic ? { outputDiagnostic } : {}),
        };
        receipts.push(receipt);
        recorded = true;
        await publishSecuritiesReceipts([receipt], onReceipt);
      };
      try {
        response = await fetchImpl(SECURITIES_OPENROUTER_ENDPOINT, {
          method: "POST",
          redirect: "manual",
          signal: bounded.signal,
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://tranthiennhan.com/securities",
            "X-OpenRouter-Title": "Nhân for Securities",
            "X-OpenRouter-Metadata": "enabled",
            "X-OpenRouter-Cache": "false",
          },
          body: encoded,
        });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          throw new SecuritiesModelError("provider_redirect_rejected", 502);
        }
        try {
          parsed = await readBoundedProviderJson(response);
        } catch (error) {
          responseDiagnostic = error.responseDiagnostic;
          if (response.ok) throw error;
        }
        if (parsed && JSON.stringify(parsed).includes(key))
          throw new SecuritiesModelError("provider_secret_echo");
        if (!response.ok || parsed?.error) {
          const errorStatus =
            response.ok && Number.isInteger(parsed?.error?.code)
              ? parsed.error.code
              : response.status;
          const error = responseError(errorStatus);
          await record("rejected", error.code);
          const delay = retryAfterMilliseconds(response);
          error.retryAfter = Math.ceil(delay / 1000);
          if (
            [429, 503].includes(errorStatus) &&
            attempt === 1 &&
            !receipts.at(-1).requestId &&
            Date.now() + delay + 500 < expires
          ) {
            await pause(delay, bounded.signal);
            continue;
          }
          throw error;
        }
        validateRouting(parsed);
        const choice = parsed.choices?.[0];
        if (
          !Array.isArray(parsed.choices) ||
          parsed.choices.length !== 1 ||
          choice?.finish_reason !== "stop" ||
          choice?.message?.role !== "assistant" ||
          typeof choice?.message?.content !== "string" ||
          (Array.isArray(choice?.message?.tool_calls) && choice.message.tool_calls.length > 0)
        ) {
          outputDiagnostic = modelOutputDiagnostic(parsed, "choice_validation");
          throw new SecuritiesModelError(
            choice?.finish_reason === "length" ? "model_output_truncated" : "model_invalid_output",
          );
        }
        let output;
        try {
          output = JSON.parse(choice.message.content);
        } catch {
          outputDiagnostic = modelOutputDiagnostic(parsed, "content_json");
          throw new SecuritiesModelError("model_invalid_json");
        }
        // Content is a second JSON layer. Escaped characters can hide a key
        // from the envelope scan, so validate again after decoding it.
        if (JSON.stringify(output).includes(key))
          throw new SecuritiesModelError("provider_secret_echo");
        await record("completed");
        return { output, response: parsed, receipt: receipts.at(-1), receipts };
      } catch (error) {
        const code = bounded.signal.aborted
          ? signal?.aborted
            ? "model_cancelled"
            : "provider_timeout"
          : error instanceof SecuritiesModelError
            ? error.code
            : "provider_transport_error";
        if (!recorded) await record("failed", code);
        throw new SecuritiesModelError(
          code,
          code === "model_cancelled"
            ? 499
            : code === "provider_timeout"
              ? 504
              : (error.status ?? 502),
          { receipts, retryAfter: error.retryAfter },
        );
      }
    }
    throw new SecuritiesModelError("provider_unavailable", 503, { receipts });
  } finally {
    bounded.close();
  }
}

/** Public metadata lookup. It does not read or send an API key. */
export async function readSecuritiesModelCapabilities({
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const bounded = deadline(15_000, signal);
  try {
    const response = await fetchImpl(SECURITIES_MODEL_METADATA_ENDPOINT, {
      signal: bounded.signal,
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new SecuritiesModelError("model_metadata_redirect_rejected", 502);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SecuritiesModelError("model_metadata_unavailable", 503);
    }
    const payload = await readBoundedProviderJson(response, 150_000);
    if (payload.data?.id !== SECURITIES_MODEL_ID || !Array.isArray(payload.data.endpoints)) {
      throw new SecuritiesModelError("model_metadata_invalid", 502);
    }
    const endpoints = payload.data.endpoints.filter(
      (endpoint) => endpoint.model_id === SECURITIES_MODEL_ID,
    );
    return {
      model: SECURITIES_MODEL_ID,
      checkedAt: new Date().toISOString(),
      endpoint: SECURITIES_MODEL_METADATA_ENDPOINT,
      capable: endpoints.some((endpoint) =>
        ["tools", "tool_choice", "response_format"].every((parameter) =>
          endpoint.supported_parameters?.includes(parameter),
        ),
      ),
      endpoints: endpoints.map((endpoint) => ({
        provider: endpoint.provider_name,
        supportedParameters: endpoint.supported_parameters,
        inputModalities: payload.data.architecture?.input_modalities,
        contextLength: endpoint.context_length,
        pricing: endpoint.pricing,
        supportsToolChoice: endpoint.supports_tool_choice,
      })),
    };
  } finally {
    bounded.close();
  }
}
