import {
  createDossier,
  DossierError,
  requireClosedObject,
  requireRequestId,
  requireText,
} from "../../shared/securities/dossier.js";
import { jsonResponse } from "../http.js";
import {
  validateMarketInput,
  validateMarketPacket,
  marketUnavailable,
  validateMarketDirectory,
  marketDirectoryUnavailable,
} from "../../shared/securities/market-data.js";
import { validateMarketResearchInput, validateMarketResearchResult } from "./market-research.js";

const MAX_RESULT_BYTES = 6_000_000;
const ID = /^[a-zA-Z0-9_-]{8,96}$/u;

function ingestionEndpoint(env, pathname) {
  if (
    env.SECURITIES_LOCAL_MODE !== "true" ||
    typeof env.SECURITIES_INGESTION_TOKEN !== "string" ||
    env.SECURITIES_INGESTION_TOKEN.length < 32
  )
    throw new DossierError("source_service_unavailable", 503);
  let base;
  try {
    base = new URL(env.SECURITIES_INGESTION_URL);
  } catch {
    throw new DossierError("source_service_unavailable", 503);
  }
  if (
    base.protocol !== "http:" ||
    base.hostname !== "127.0.0.1" ||
    !base.port ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw new DossierError("source_service_unavailable", 503);
  return new URL(pathname, base).href;
}

async function callService(
  env,
  pathname,
  { method = "GET", body, signal, timeoutMs = 20_000 } = {},
) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(ingestionEndpoint(env, pathname), {
    method,
    redirect: "manual",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: {
      Authorization: `Bearer ${env.SECURITIES_INGESTION_TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new DossierError("source_service_redirect_rejected", 502);
  }
  return response;
}

export async function readSecuritiesMarket(input, { env, signal } = {}) {
  validateMarketInput(input);
  try {
    const response = await callService(env, `/market?${new URLSearchParams(input)}`, {
      signal,
      timeoutMs: 55_000,
    });
    const payload = await boundedJson(response);
    if (!response.ok) return marketUnavailable(input, "market_provider_unavailable");
    return validateMarketPacket(payload.market, input);
  } catch (error) {
    if (signal?.aborted) throw new DossierError("market_cancelled", 499);
    return marketUnavailable(
      input,
      error.name === "TimeoutError" ? "market_timeout" : "market_provider_unavailable",
    );
  }
}

export async function readSecuritiesMarketDirectory({ env, signal } = {}) {
  try {
    const response = await callService(env, "/market/directory", { signal, timeoutMs: 55_000 });
    const payload = await boundedJson(response);
    return response.ok ? validateMarketDirectory(payload.directory) : marketDirectoryUnavailable();
  } catch (error) {
    if (signal?.aborted) throw new DossierError("market_cancelled", 499);
    return marketDirectoryUnavailable(
      error.name === "TimeoutError" ? "market_timeout" : "market_provider_unavailable",
    );
  }
}

export async function readSecuritiesMarketResearch(raw, { env, signal } = {}) {
  const input = validateMarketResearchInput(raw);
  try {
    const response = await callService(env, "/market/research", {
      method: "POST",
      body: input,
      signal,
      timeoutMs: 200_000,
    });
    const payload = await boundedJson(response);
    if (!response.ok)
      throw new DossierError(
        typeof payload.error === "string" && /^[a-z][a-z0-9_]{1,79}$/u.test(payload.error)
          ? payload.error
          : "market_research_unavailable",
        response.status,
      );
    return validateMarketResearchResult(payload.research, input);
  } catch (error) {
    if (signal?.aborted) throw new DossierError("market_cancelled", 499);
    if (error instanceof DossierError) throw error;
    throw new DossierError(
      error.name === "TimeoutError" ? "market_research_timeout" : "market_research_unavailable",
      503,
    );
  }
}

async function boundedJson(response) {
  if (!(response.headers.get("Content-Type") ?? "").startsWith("application/json")) {
    await response.body?.cancel();
    throw new DossierError("source_service_invalid_response", 502);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new DossierError("source_service_invalid_response", 502);
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESULT_BYTES) throw new DossierError("source_result_too_large", 502);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof DossierError) throw error;
    throw new DossierError("source_service_invalid_response", 502);
  } finally {
    reader.releaseLock();
  }
}

async function importDatasets(env, job) {
  const previous = await env.SECURITIES_DB.prepare(
    "SELECT summary_json FROM securities_source_imports WHERE job_id = ?",
  )
    .bind(job.id)
    .first();
  if (previous) return JSON.parse(previous.summary_json);
  const result = job.result ?? {};
  const datasets = result.datasets ?? [];
  if (!Array.isArray(datasets) || datasets.length > 40)
    throw new DossierError("invalid_source_dataset", 422);
  const statements = [];
  const importedAt = new Date().toISOString();
  for (const dataset of datasets) {
    if (dataset.company?.id !== job.companyId)
      throw new DossierError("source_company_mismatch", 422);
    createDossier(dataset, { id: "source-validation", now: importedAt });
    const serialized = JSON.stringify(dataset);
    if (new TextEncoder().encode(serialized).length > 1_000_000)
      throw new DossierError("source_dataset_too_large", 413);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized)),
    );
    const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    statements.push(
      env.SECURITIES_DB.prepare(
        `INSERT OR IGNORE INTO securities_source_datasets
      (company_id,period_id,comparison_period_id,version_hash,dataset_json,imported_at) VALUES (?,?,?,?,?,?)`,
      ).bind(
        dataset.company.id,
        dataset.period.id,
        dataset.comparisonPeriod.id,
        hash,
        serialized,
        importedAt,
      ),
    );
  }
  const summary = {
    companyId: job.companyId,
    datasetCount: datasets.length,
    documentCount: Array.isArray(result.documents) ? result.documents.length : 0,
    candidates: (Array.isArray(result.candidates) ? result.candidates : [])
      .slice(0, 30)
      .map((candidate) => ({
        id: candidate.id ?? null,
        title: String(candidate.title ?? "").slice(0, 300),
        status: candidate.status ?? "needs_review",
        periodId: candidate.periodId ?? null,
      })),
    importedAt,
    receiptCount: Array.isArray(result.receipts) ? result.receipts.length : 0,
    materialIssueCount: datasets.reduce(
      (count, dataset) =>
        count +
        createDossier(dataset, { id: "source-check", now: importedAt }).issues.filter(
          (issue) => issue.severity === "material" && !issue.resolution,
        ).length,
      0,
    ),
  };
  statements.push(
    env.SECURITIES_DB.prepare(
      "INSERT OR IGNORE INTO securities_source_imports (job_id,company_id,imported_at,summary_json) VALUES (?,?,?,?)",
    ).bind(job.id, job.companyId, importedAt, JSON.stringify(summary)),
  );
  await env.SECURITIES_DB.batch(statements);
  return summary;
}

export async function getImportedDatasets(env) {
  if (!env.SECURITIES_DB) return [];
  const rows = await env.SECURITIES_DB.prepare(
    `SELECT dataset_json FROM securities_source_datasets ORDER BY imported_at DESC, rowid DESC LIMIT 200`,
  ).all();
  const seen = new Set();
  const result = [];
  for (const row of rows.results) {
    const dataset = JSON.parse(row.dataset_json);
    const identity = `${dataset.company.id}:${dataset.period.id}:${dataset.comparisonPeriod.id}`;
    if (!seen.has(identity)) {
      seen.add(identity);
      result.push(dataset);
    }
  }
  return result;
}

export async function readSecuritiesEvidence(input, { env, signal, allowedSources } = {}) {
  requireClosedObject(
    input,
    ["sourceId", "sourceVersion", "query", "pages", "cursor", "limit"],
    ["sourceId", "sourceVersion"],
  );
  requireText(input.sourceId, { max: 100, pattern: /^[a-zA-Z0-9_-]+$/u });
  requireText(input.sourceVersion, { max: 71, pattern: /^sha256:[a-f0-9]{64}$/u });
  if (input.query !== undefined) requireText(input.query, { min: 0, max: 500 });
  if (
    input.pages !== undefined &&
    (!Array.isArray(input.pages) ||
      input.pages.length > 6 ||
      new Set(input.pages).size !== input.pages.length ||
      input.pages.some((page) => !Number.isSafeInteger(page) || page < 1 || page > 999))
  )
    throw new DossierError("invalid_evidence_input");
  if (!input.query && !input.pages?.length) throw new DossierError("invalid_evidence_input");
  if (input.cursor !== undefined) requireText(input.cursor, { max: 512 });
  if (
    input.limit !== undefined &&
    (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 12)
  )
    throw new DossierError("invalid_evidence_input");
  const source = allowedSources?.find(
    (item) =>
      item.id === input.sourceId &&
      String(item.version) === input.sourceVersion &&
      `sha256:${item.hash}` === input.sourceVersion,
  );
  if (allowedSources && !source) throw new DossierError("source_context_mismatch", 422);
  const response = await callService(env, "/evidence", { method: "POST", body: input, signal });
  const data = await boundedJson(response);
  if (!response.ok)
    throw new DossierError(
      typeof data.error === "string" && /^[a-z_]+$/u.test(data.error)
        ? data.error
        : "source_evidence_unavailable",
      response.status,
    );
  const evidence = data.evidence;
  if (
    !evidence ||
    evidence.sourceId !== input.sourceId ||
    evidence.sourceVersion !== input.sourceVersion ||
    `sha256:${evidence.sourceHash}` !== input.sourceVersion ||
    !Array.isArray(evidence.passages) ||
    evidence.passages.length > 12 ||
    evidence.receipt?.evidenceType !== "local_original"
  )
    throw new DossierError("source_service_invalid_response", 502);
  return evidence;
}

export async function handleSecuritiesIngestion(request, env) {
  const pathname = new URL(request.url).pathname;
  const prefix = "/api/securities/sources";
  const suffix = pathname.slice(prefix.length);
  if (suffix === "/evidence" && request.method === "POST") {
    if (!(request.headers.get("Content-Type") ?? "").startsWith("application/json"))
      throw new DossierError("json_required", 415);
    const { readBoundedRequestBody } = await import("../http.js");
    const body = await readBoundedRequestBody(request, 4096);
    if (body.tooLarge) throw new DossierError("request_too_large", 413);
    let input;
    try {
      input = JSON.parse(body.text);
    } catch {
      throw new DossierError("invalid_json");
    }
    return jsonResponse({
      ok: true,
      data: { evidence: await readSecuritiesEvidence(input, { env, signal: request.signal }) },
    });
  }
  if (
    /^\/documents\/[a-zA-Z0-9_-]{1,100}\/[a-f0-9]{64}\/(?:original|pages\/[1-9][0-9]{0,2})$/u.test(
      suffix,
    ) &&
    request.method === "GET"
  ) {
    const response = await callService(env, suffix, { signal: request.signal });
    if (!response.ok) {
      await response.body?.cancel();
      throw new DossierError("source_asset_unavailable", 404);
    }
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!["application/pdf", "image/png"].includes(contentType)) {
      await response.body?.cancel();
      throw new DossierError("source_asset_invalid_type", 502);
    }
    return new Response(response.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'",
      },
    });
  }
  if (suffix !== "/jobs" && !/^\/jobs\/[a-zA-Z0-9_-]{8,96}(?:\/cancel)?$/u.test(suffix))
    throw new DossierError("not_found", 404);
  if (
    !new Set(["GET", "POST"]).has(request.method) ||
    (suffix === "/jobs" && request.method !== "POST") ||
    (suffix.endsWith("/cancel") && request.method !== "POST")
  )
    throw new DossierError("method_not_allowed", 405);
  let body;
  if (request.method === "POST") {
    const reader = request.body?.getReader();
    let bytes = 0;
    let text = "";
    if (!reader) throw new DossierError("invalid_input");
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 4096) throw new DossierError("request_too_large", 413);
        text += new TextDecoder().decode(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    try {
      body = JSON.parse(text);
    } catch {
      throw new DossierError("invalid_input");
    }
    requireClosedObject(
      body,
      suffix === "/jobs" ? ["companyId", "requestId"] : ["requestId"],
      suffix === "/jobs" ? ["companyId", "requestId"] : ["requestId"],
    );
    requireRequestId(body.requestId);
    if (suffix === "/jobs") requireText(body.companyId, { max: 24, pattern: /^[a-zA-Z0-9_-]+$/u });
  }
  const response = await callService(env, suffix, {
    method: request.method,
    body,
    signal: request.signal,
  });
  const data = await boundedJson(response);
  if (!response.ok)
    throw new DossierError(
      typeof data.error === "string" && /^[a-z_]+$/u.test(data.error)
        ? data.error
        : "source_service_failed",
      response.status,
    );
  const job = data.job;
  if (
    !job ||
    !ID.test(job.id) ||
    !["queued", "running", "completed", "partial", "failed", "cancelled"].includes(job.status)
  )
    throw new DossierError("source_service_invalid_response", 502);
  const summary = ["completed", "partial"].includes(job.status)
    ? await importDatasets(env, job)
    : null;
  return jsonResponse(
    {
      job: {
        id: job.id,
        companyId: job.companyId,
        status: job.status,
        progress: job.progress,
        startedAt: job.startedAt,
        completedAt: job.completedAt ?? null,
        error: job.error,
        result: summary,
      },
    },
    { status: response.status },
  );
}
