import { jsonResponse, readBoundedRequestBody } from "../http.js";
import {
  DossierError,
  createDossier,
  reviseDossier,
  assertApprovable,
  applyModelAnalysis,
  replaceDossierSources,
  carryForwardDossierAnalysis,
  requireClosedObject,
  requireText,
  requireRevision,
  requireRequestId,
} from "../../shared/securities/dossier.js";
import { createSecuritiesStore } from "./store.js";
import {
  assertSecuritiesLocalRequest,
  assertSecuritiesMutationRateLimit,
  securitiesRuntimeEnvironment,
  securitiesRuntimeStatus,
} from "./local.js";
import { createSecuritiesXlsx, createAnalysisNotes, exportFilename, MIME_XLSX } from "./export.js";
import {
  validateMarketInput,
  validateMarketPacket,
  validateMarketDirectory,
} from "../../shared/securities/market-data.js";
import { validateMarketResearchInput, validateMarketResearchResult } from "./market-research.js";

const MAX_BODY_BYTES = 24_576;
const MAX_JOB_MS = 240_000;
const JOB_STREAM_TYPE = "application/x-ndjson";
const JOB_HEARTBEAT_MS = 10_000;
const SAFE_DETAILS = new Set(["issueIds", "currentRevision", "jobId"]);
const MESSAGES = {
  invalid_input: "The request does not match the supported fields.",
  revision_conflict: "The dossier changed. Reload the current revision before continuing.",
  material_issues_unresolved:
    "Resolve the material evidence issues before approving this revision.",
  model_not_configured: "Live model analysis is unavailable in this local mode.",
  report_unavailable: "This revision has no sufficiently supported report content to export.",
  local_only: "This product is available only in the configured local workspace.",
  source_missing: "The selected source data is unavailable.",
  job_in_progress: "Wait for the active research task to finish or stop it before deleting.",
  dossier_not_found: "The saved research no longer exists.",
  storage_not_configured: "Shared research storage is unavailable.",
  service_not_configured: "The shared research service is not fully configured.",
  rate_limited: "Too many changes were requested. Wait a minute and try again.",
  rate_limit_temporarily_unavailable:
    "Changes are temporarily unavailable because the request limit could not be checked.",
  idempotency_conflict: "This request id was already used for a different operation.",
};

function safeCode(error) {
  return typeof error?.code === "string" && /^[a-z][a-z0-9_]{1,79}$/u.test(error.code)
    ? error.code
    : "internal_error";
}

function failure(error, requestId) {
  const code = safeCode(error);
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
      ? error.status
      : 500;
  const details =
    error?.details && typeof error.details === "object"
      ? Object.fromEntries(Object.entries(error.details).filter(([key]) => SAFE_DETAILS.has(key)))
      : undefined;
  return jsonResponse(
    {
      ok: false,
      error: {
        code,
        message:
          MESSAGES[code] ?? "The operation could not be completed. The saved dossier is preserved.",
        ...(details ? { details } : {}),
      },
      requestId,
    },
    {
      status,
      requestId,
      ...(code === "rate_limited"
        ? { headers: { "Retry-After": "60" } }
        : code === "rate_limit_temporarily_unavailable"
          ? { headers: { "Retry-After": "10" } }
          : {}),
    },
  );
}

function success(data, status = 200) {
  return jsonResponse({ ok: true, data }, { status });
}

function validateLocale(value) {
  if (value !== undefined && value !== "vi" && value !== "en")
    throw new DossierError("invalid_locale");
  return value ?? "vi";
}

function validateScope(input, create = false) {
  requireClosedObject(
    input,
    [
      "query",
      "companyId",
      "periodId",
      "comparisonPeriodId",
      "defaultScope",
      "locale",
      ...(create ? ["requestId"] : []),
    ],
    create ? ["companyId", "periodId", "locale", "requestId"] : [],
  );
  if (!input.query && !input.companyId && !input.defaultScope?.companyId)
    throw new DossierError("scope_required", 422);
  for (const key of ["companyId", "periodId", "comparisonPeriodId"]) {
    if (input[key] !== undefined)
      requireText(input[key], { max: 80, pattern: /^[A-Za-z0-9_-]+$/u });
  }
  if (input.defaultScope !== undefined) {
    try {
      requireClosedObject(
        input.defaultScope,
        ["companyId", "periodId", "comparisonPeriodId"],
        ["companyId"],
      );
      for (const value of Object.values(input.defaultScope))
        requireText(value, { max: 80, pattern: /^[A-Za-z0-9_-]+$/u });
    } catch (error) {
      if (error instanceof DossierError) throw new DossierError("invalid_default_scope", 422);
      throw error;
    }
  }
  if (input.query !== undefined) requireText(input.query, { min: 0, max: 2000 });
  validateLocale(input.locale);
  if (create) requireRequestId(input.requestId);
  return input;
}

function validateQuery(url, allowed) {
  for (const key of url.searchParams.keys())
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
      throw new DossierError("invalid_query");
}

function queryRevision(url, required = false) {
  const raw = url.searchParams.get("revision");
  if (raw === null && !required) return undefined;
  if (raw === null || !/^[1-9]\d{0,8}$/u.test(raw)) throw new DossierError("invalid_revision");
  return requireRevision(Number(raw));
}

async function body(request) {
  if (
    request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new DossierError("json_required", 415);
  const read = await readBoundedRequestBody(request, MAX_BODY_BYTES);
  if (read.tooLarge) throw new DossierError("request_too_large", 413);
  try {
    return JSON.parse(read.text);
  } catch {
    throw new DossierError("invalid_json");
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
}

export async function securitiesFingerprint(path, input) {
  const bytes = new TextEncoder().encode(JSON.stringify({ path, input: stable(input) }));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sourceAdapters(dependencies) {
  if (dependencies.catalog && dependencies.resolveScope && dependencies.loadDataset)
    return {
      getSecuritiesCatalog: dependencies.catalog,
      resolveSecuritiesScope: dependencies.resolveScope,
      loadSecuritiesDataset: dependencies.loadDataset,
      refreshSecuritiesSources: dependencies.refreshSources,
    };
  return import("./sources.js");
}

async function readJobResult(store, job) {
  if (
    job.status === "completed" &&
    job.kind !== "chat" &&
    job.result?.dossierId &&
    job.result?.revision
  ) {
    return {
      ...job,
      result: {
        ...job.result,
        dossier: await store.get(job.result.dossierId, job.result.revision),
      },
    };
  }
  return job;
}

function modelConversation(dossier) {
  const pairs = [];
  for (let index = 0; index < (dossier.chat?.length ?? 0) - 1; index += 2) {
    const user = dossier.chat[index];
    const assistant = dossier.chat[index + 1];
    if (
      user.role !== "user" ||
      assistant.role !== "assistant" ||
      user.revision !== dossier.revision ||
      assistant.revision !== dossier.revision
    )
      continue;
    const claims = (assistant.answer?.claims ?? [])
      .map((claim) => claim.text)
      .filter((text) => typeof text === "string");
    const content = claims.length ? claims.join("\n") : assistant.answer?.summary;
    if (typeof content !== "string" || !content.length) continue;
    pairs.push({
      dossierId: dossier.id,
      revision: dossier.revision,
      user: user.content,
      assistant: content,
    });
  }
  const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
  const history = [];
  let truncated = dossier.chatHistoryTruncated === true;
  for (const pair of pairs.toReversed()) {
    if (bytes([pair, ...history]) <= 48_000) {
      history.unshift(pair);
      continue;
    }
    truncated = true;
    if (!history.length) {
      const characters = Array.from(pair.assistant);
      const marker =
        "\n[Earlier answer context truncated; the complete answer remains in the saved conversation.]";
      let left = 0;
      let right = characters.length;
      while (left < right) {
        const middle = Math.ceil((left + right) / 2);
        if (
          bytes([{ ...pair, assistant: characters.slice(0, middle).join("") + marker }]) <= 48_000
        )
          left = middle;
        else right = middle - 1;
      }
      history.push({ ...pair, assistant: characters.slice(0, left).join("") + marker });
    }
    break;
  }
  return { history, historyTruncated: truncated };
}

async function executeJob({
  store,
  job,
  dossier,
  locale,
  question,
  env,
  dependencies,
  now,
  signal,
}) {
  const controller = new AbortController();
  const disconnected = () => controller.abort(new DossierError("job_interrupted", 503));
  signal?.addEventListener("abort", disconnected, { once: true });
  if (signal?.aborted) disconnected();
  let checking = false;
  const timer = setInterval(async () => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    try {
      const current = await store.getJob(job.id);
      if (current.status !== "running")
        controller.abort(new DOMException("Job cancelled or expired", "AbortError"));
    } catch {
      controller.abort(new DOMException("Job state unavailable", "AbortError"));
    } finally {
      checking = false;
    }
  }, 350);
  const deadline = setTimeout(
    () => controller.abort(new DOMException("Job timed out", "TimeoutError")),
    MAX_JOB_MS,
  );
  try {
    controller.signal.throwIfAborted();
    if (job.kind === "refresh") {
      const adapter = await sourceAdapters(dependencies);
      if (!adapter.refreshSecuritiesSources)
        throw new DossierError("source_refresh_unavailable", 503);
      const refreshed = await adapter.refreshSecuritiesSources(
        {
          companyId: dossier.company.id,
          periodId: dossier.period.id,
          comparisonPeriodId: dossier.comparisonPeriod.id,
          sourceIds: dossier.sources.map((source) => source.id),
        },
        { env, signal: controller.signal },
      );
      let dataset = refreshed.dataset;
      if (!dataset) {
        const available = await adapter.loadSecuritiesDataset(
          {
            companyId: dossier.company.id,
            periodId: dossier.period.id,
            comparisonPeriodId: dossier.comparisonPeriod.id,
          },
          { env, signal: controller.signal },
        );
        if (
          available.sources.some(
            (source) =>
              !dossier.sources.some(
                (old) =>
                  old.id === source.id &&
                  old.hash === source.hash &&
                  String(old.version) === String(source.version),
              ),
          )
        )
          dataset = { ...available, freshness: refreshed.freshness };
      }
      const changed = (refreshed.sourceChecks ?? []).filter(
        (check) =>
          check.status === "changed" &&
          dossier.sources.some(
            (source) => source.id === check.sourceId && source.hash !== check.hash,
          ),
      );
      const sourceImported = Boolean(dataset);
      const sourceChanged = sourceImported || changed.length > 0;
      if (!dataset) {
        dataset = { ...dossier, issues: dossier.sourceIssues, freshness: refreshed.freshness };
        if (changed.length) {
          dataset = structuredClone(dataset);
          dataset.pendingSources = changed;
          for (const check of changed) {
            const affected = dataset.metrics.filter((metric) =>
              [metric.current, metric.comparison].some(
                (point) => point.sourceId === check.sourceId,
              ),
            );
            for (const metric of affected)
              for (const side of ["current", "comparison"])
                if (metric[side].sourceId === check.sourceId)
                  metric[side].verification = "needs_review";
            dataset.issues.push({
              id: `source-changed-${check.sourceId}`,
              code: "source_revision_detected",
              severity: "material",
              requiresSourceImport: true,
              sourceIds: [check.sourceId],
              metricIds: affected.map((metric) => metric.id),
              resolution: null,
              message: {
                vi: "Tệp nguồn đã đổi nội dung. Thu thập và kiểm chứng phiên bản mới trước khi duyệt; bảng hiện giữ số của bản đã lưu.",
                en: "The source file changed. Collect and verify its new version before approval; this table retains the saved source figures.",
              },
            });
          }
        }
      }
      const next = replaceDossierSources(dossier, dataset, {
        now: now(),
        preserveSavedInputs: !sourceImported,
      });
      if (!sourceChanged) {
        next.metrics = structuredClone(dossier.metrics);
        next.issues = structuredClone(dossier.issues);
        carryForwardDossierAnalysis(dossier, next, "freshness_checked");
        next.revisionEvent = "freshness_checked";
      }
      controller.signal.throwIfAborted();
      await store.completeAnalysis(job, next, []);
      return;
    }
    const configured = securitiesRuntimeStatus(env).model;
    if (!configured.enabled || !configured.configured)
      throw new DossierError("model_not_configured", 503);
    const model =
      job.kind === "chat"
        ? (dependencies.chat ?? (await import("./model.js")).chatSecurities)
        : (dependencies.analyze ?? (await import("./model.js")).analyzeSecurities);
    const { history, historyTruncated } =
      job.kind === "chat" ? modelConversation(dossier) : { history: [], historyTruncated: false };
    const modelQuestion = job.kind === "analysis" ? (dossier.query ?? "") : (question ?? "");
    const result = await model({
      dossier,
      question: modelQuestion,
      history,
      historyTruncated,
      locale,
      signal: controller.signal,
      env,
      onProgress: async (progress) => store.updateJobProgress(job.id, progress),
      readEvidence: (input) =>
        dependencies.readEvidence
          ? dependencies.readEvidence(input, { signal: controller.signal, dossier })
          : import("./ingestion.js").then(({ readSecuritiesEvidence }) =>
              readSecuritiesEvidence(input, {
                env,
                signal: controller.signal,
                allowedSources: dossier.sources,
              }),
            ),
      onReceipt: async (receipt) => store.reconcileReceipts(job.id, [receipt]),
    });
    if (controller.signal.aborted) {
      await store.failJob(
        job.id,
        controller.signal.reason?.name === "TimeoutError"
          ? "job_timeout"
          : safeCode(controller.signal.reason),
        result.receipts ?? [result.receipt].filter(Boolean),
        now(),
      );
      return;
    }
    if (job.kind === "chat") await store.completeChat(job, result, now());
    else
      await store.completeAnalysis(
        job,
        applyModelAnalysis(dossier, result, { now: now() }),
        result.receipts ?? [result.receipt].filter(Boolean),
      );
  } catch (error) {
    const code =
      controller.signal.aborted && controller.signal.reason?.name === "TimeoutError"
        ? "job_timeout"
        : signal?.aborted
          ? "job_interrupted"
          : safeCode(error);
    await store.failJob(job.id, code, error?.receipts ?? [], now());
  } finally {
    clearInterval(timer);
    clearTimeout(deadline);
    signal?.removeEventListener("abort", disconnected);
  }
}

function streamJob(request, ctx, options, started, requestId) {
  const abortController = new AbortController();
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat;
  let cleanup;
  const disconnect = () => {
    abortController.abort();
    clearInterval(heartbeat);
    if (!cleanup) {
      // Only the bounded disconnect write belongs in waitUntil. The response
      // body keeps model execution alive while the client remains connected.
      cleanup = options.store
        .failJob(started.job.id, "job_interrupted", [], options.now())
        .catch(() => {});
      if (typeof ctx.waitUntil === "function") ctx.waitUntil(cleanup);
    }
    return cleanup;
  };
  const stream = new ReadableStream({
    start(controller) {
      const send = (payload) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(payload ? `${JSON.stringify(payload)}\n` : "\n"));
          return true;
        } catch {
          closed = true;
          void disconnect();
          return false;
        }
      };
      const onAbort = () => {
        void disconnect();
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
      if (request.signal.aborted) onAbort();
      send({ event: "accepted", ok: true, data: { job: started.job } });
      heartbeat = setInterval(() => send(), JOB_HEARTBEAT_MS);
      void (async () => {
        try {
          await executeJob({ ...options, signal: abortController.signal });
          send({
            event: "result",
            ok: true,
            data: {
              job: await readJobResult(options.store, await options.store.getJob(started.job.id)),
            },
          });
        } catch {
          send({ event: "error", ok: false, error: { code: "job_status_unavailable" } });
        } finally {
          clearInterval(heartbeat);
          request.signal.removeEventListener("abort", onAbort);
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      })();
    },
    cancel() {
      closed = true;
      return disconnect();
    },
  });
  const headers = success(null).headers;
  headers.set("Content-Type", `${JOB_STREAM_TYPE}; charset=utf-8`);
  headers.set("X-Request-ID", requestId);
  headers.set("X-Securities-Job-ID", started.job.id);
  return new Response(stream, { status: 202, headers });
}

export async function handleSecuritiesRequest(request, env, ctx = {}, dependencies = {}) {
  const requestId = crypto.randomUUID();
  const now = dependencies.now ?? (() => new Date().toISOString());
  try {
    env = securitiesRuntimeEnvironment(env);
    assertSecuritiesLocalRequest(request, env);
    await assertSecuritiesMutationRateLimit(request, env);
    const url = new URL(request.url);
    const path = url.pathname;
    const store = dependencies.store ?? createSecuritiesStore(env.SECURITIES_DB);
    if (path === "/api/securities/market/directory" && request.method === "GET") {
      validateQuery(url, []);
      const readDirectory =
        dependencies.readMarketDirectory ??
        (await import("./ingestion.js")).readSecuritiesMarketDirectory;
      return success(validateMarketDirectory(await readDirectory({ env, signal: request.signal })));
    }
    if (path === "/api/securities/market/research" && request.method === "POST") {
      validateQuery(url, []);
      const input = validateMarketResearchInput(await body(request));
      if (!securitiesRuntimeStatus(env).model.enabled)
        throw new DossierError("model_not_configured", 503);
      const readResearch =
        dependencies.readMarketResearch ??
        (await import("./ingestion.js")).readSecuritiesMarketResearch;
      return success(
        validateMarketResearchResult(
          await readResearch(input, { env, signal: request.signal }),
          input,
        ),
      );
    }
    if (path === "/api/securities/market" && request.method === "GET") {
      validateQuery(url, ["symbol", "dataset", "exchange"]);
      const input = validateMarketInput(Object.fromEntries(url.searchParams));
      const readMarket =
        dependencies.readMarket ?? (await import("./ingestion.js")).readSecuritiesMarket;
      return success(
        validateMarketPacket(await readMarket(input, { env, signal: request.signal }), input),
      );
    }
    if (path.startsWith("/api/securities/sources/")) {
      const { handleSecuritiesIngestion } = await import("./ingestion.js");
      return await handleSecuritiesIngestion(request, env);
    }
    if (path === "/api/securities/catalog" && request.method === "GET") {
      validateQuery(url, []);
      const adapters = await sourceAdapters(dependencies);
      const catalog = await adapters.getSecuritiesCatalog({ env });
      return success({ ...catalog, runtime: securitiesRuntimeStatus(env) });
    }
    if (path === "/api/securities/scope" && request.method === "POST") {
      validateQuery(url, []);
      const input = validateScope(await body(request));
      const adapters = await sourceAdapters(dependencies);
      return success(await adapters.resolveSecuritiesScope(input, { env, signal: request.signal }));
    }
    if (path === "/api/securities/dossiers") {
      validateQuery(url, []);
      if (request.method === "GET") return success({ dossiers: await store.list() });
      if (request.method === "POST") {
        const input = validateScope(await body(request), true);
        const fingerprint = await securitiesFingerprint(path, input);
        const replay = await store.requestResult(input.requestId, fingerprint);
        if (replay) return success(replay);
        const adapters = await sourceAdapters(dependencies);
        const scope = await adapters.resolveSecuritiesScope(input, { env, signal: request.signal });
        if (scope.ready === false) throw new DossierError("source_missing", 422);
        const dataset = await adapters.loadSecuritiesDataset(scope, {
          env,
          signal: request.signal,
        });
        const dossier = createDossier(dataset, {
          id: `ds_${crypto.randomUUID()}`,
          locale: validateLocale(input.locale),
          query: input.query ?? "",
          now: now(),
        });
        return success(await store.create(dossier, input.requestId, fingerprint), 201);
      }
      throw new DossierError("method_not_allowed", 405);
    }
    const jobMatch = path.match(/^\/api\/securities\/jobs\/([a-zA-Z0-9_-]{8,80})(\/cancel)?$/u);
    if (jobMatch) {
      validateQuery(url, []);
      if (!jobMatch[2] && request.method === "GET")
        return success({ job: await readJobResult(store, await store.getJob(jobMatch[1])) });
      if (jobMatch[2] && request.method === "POST") {
        const input = requireClosedObject(await body(request), ["requestId"], ["requestId"]);
        requireRequestId(input.requestId);
        return success(
          await store.cancelJob(jobMatch[1], {
            requestId: input.requestId,
            fingerprint: await securitiesFingerprint(path, input),
            now: now(),
          }),
        );
      }
      throw new DossierError("method_not_allowed", 405);
    }
    const match = path.match(
      /^\/api\/securities\/dossiers\/([a-zA-Z0-9_-]{8,80})(?:\/(revise|approve|analyze|chat|refresh|export))?$/u,
    );
    if (!match) throw new DossierError("not_found", 404);
    const [, id, action] = match;
    if (!action && request.method === "GET") {
      validateQuery(url, ["revision"]);
      return success({ dossier: await store.get(id, queryRevision(url)) });
    }
    if (!action && request.method === "DELETE") {
      validateQuery(url, []);
      const input = requireClosedObject(
        await body(request),
        ["expectedRevision", "requestId"],
        ["expectedRevision", "requestId"],
      );
      requireRevision(input.expectedRevision);
      requireRequestId(input.requestId);
      return success(
        await store.deleteDossier(id, {
          expectedRevision: input.expectedRevision,
          requestId: input.requestId,
          fingerprint: await securitiesFingerprint(path, input),
          now: now(),
        }),
      );
    }
    if (action === "export" && request.method === "GET") {
      validateQuery(url, ["revision", "format"]);
      const revision = queryRevision(url, true);
      const format = url.searchParams.get("format") ?? "xlsx";
      if (!["xlsx", "md"].includes(format)) throw new DossierError("invalid_export_format");
      const dossier = await store.get(id, revision);
      const content =
        format === "xlsx" ? createSecuritiesXlsx(dossier) : createAnalysisNotes(dossier);
      return new Response(content, {
        headers: {
          "Content-Type": format === "xlsx" ? MIME_XLSX : "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${exportFilename(dossier, format)}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "X-Dossier-ID": dossier.id,
          "X-Dossier-Revision": String(dossier.revision),
        },
      });
    }
    if (request.method !== "POST" || !action) throw new DossierError("method_not_allowed", 405);
    validateQuery(url, []);
    const input = await body(request);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new DossierError("invalid_input");
    requireRequestId(input.requestId);
    const fingerprint = await securitiesFingerprint(path, input);
    const replay = await store.requestResult(input.requestId, fingerprint);
    if (replay) return success(replay);
    if (action === "revise") {
      const previous = await store.get(id);
      const dossier = reviseDossier(previous, input, { now: now() });
      return success(
        await store.saveRevision(dossier, {
          requestId: input.requestId,
          fingerprint,
          expectedRevision: input.expectedRevision,
        }),
      );
    }
    if (action === "approve") {
      const dossier = await store.get(id);
      assertApprovable(dossier, input);
      return success(
        await store.approve(dossier, { requestId: input.requestId, fingerprint, now: now() }),
      );
    }
    if (["analyze", "chat", "refresh"].includes(action)) {
      requireClosedObject(
        input,
        action === "chat"
          ? ["revision", "question", "requestId", "locale"]
          : ["expectedRevision", "requestId", "locale"],
        action === "chat"
          ? ["revision", "question", "requestId"]
          : ["expectedRevision", "requestId"],
      );
      const revision = requireRevision(action === "chat" ? input.revision : input.expectedRevision);
      if (action === "chat") requireText(input.question, { max: 2000 });
      const locale = validateLocale(input.locale);
      const dossier = await store.get(id, action === "chat" ? revision : undefined);
      if (dossier.revision !== revision)
        throw new DossierError("revision_conflict", 409, { currentRevision: dossier.revision });
      if (action !== "refresh") {
        const model = securitiesRuntimeStatus(env).model;
        if (!model.enabled || !model.configured)
          throw new DossierError("model_not_configured", 503);
      }
      const startedAt = now();
      const job = {
        id: `job_${crypto.randomUUID()}`,
        requestId: input.requestId,
        dossierId: id,
        revision,
        kind: action === "analyze" ? "analysis" : action,
        ...(action === "chat" ? { question: input.question } : {}),
        baseWasApproved: action === "analyze" && dossier.status === "approved",
        startedAt,
        deadline: new Date(Date.parse(startedAt) + MAX_JOB_MS).toISOString(),
      };
      const started = await store.startJob(job, fingerprint);
      if (!started.replay) {
        const options = {
          store,
          job,
          dossier,
          locale,
          question: input.question,
          env,
          dependencies,
          now,
        };
        if (
          request.headers
            .get("Accept")
            ?.split(",")
            .some((type) => type.split(";", 1)[0].trim() === JOB_STREAM_TYPE)
        )
          return streamJob(request, ctx, options, started, requestId);
        // A JSON caller also owns the request until execution finishes. Returning
        // early here would leave only Workers' short post-response grace period.
        await executeJob({ ...options, signal: request.signal });
      }
      return success({ job: await readJobResult(store, await store.getJob(started.job.id)) }, 202);
    }
    throw new DossierError("not_found", 404);
  } catch (error) {
    return failure(error, requestId);
  }
}
