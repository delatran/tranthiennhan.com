import { createServer } from "node:http";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import {
  marketUnavailable,
  validateMarketInput,
  validateMarketPacket,
  marketDirectoryUnavailable,
  validateMarketDirectory,
} from "../../shared/securities/market-data.js";
import {
  validateMarketResearchInput,
  validateMarketResearchResult,
} from "../../worker/securities/market-research.js";

const JOB_ID = /^[a-zA-Z0-9_-]{8,96}$/u;
const COMPANY_ID = /^[a-zA-Z0-9_-]{1,24}$/u;
const ACTIVE = new Set(["running", "queued"]);
const MAX_BODY_BYTES = 4096;
const MAX_JOB_MS = 15 * 60 * 1000;
const ERROR_CODES = new Set([
  "cancelled",
  "source_job_timeout",
  "source_job_interrupted",
  "source_processing_failed",
  "model_not_configured",
  "invalid_market_research",
  "market_research_busy",
  "market_research_timeout",
  "market_research_unavailable",
  "market_research_invalid_response",
  "market_research_source_missing",
  "market_symbol_missing",
  "market_cancelled",
  "receipt_persistence_failed",
  "source_result_too_large",
  "unsupported_company",
  "source_missing",
  "source_forbidden",
  "source_rate_limited",
  "source_timeout",
  "source_not_found",
  "source_too_large",
  "source_invalid_type",
  "source_invalid_content",
  "source_redirect_rejected",
  "source_access_challenge",
  "source_page_limit",
  "source_page_pixels_exceeded",
  "source_partial_content",
  "source_parse_failed",
  "unsupported_content_type",
  "request_too_large",
  "invalid_input",
  "invalid_evidence_input",
  "unsupported_source",
  "source_version_mismatch",
  "source_page_out_of_range",
  "invalid_evidence_cursor",
  "source_evidence_unavailable",
  "source_evidence_corrupted",
  "source_evidence_response_too_large",
  "idempotency_conflict",
  "source_job_already_running",
  "source_job_corrupted",
  "source_service_closed",
]);

function safeError(error) {
  const code = error?.name === "AbortError" ? "cancelled" : (error?.code ?? error?.message);
  return ERROR_CODES.has(code) ? code : "source_processing_failed";
}

async function readInput(request) {
  if (!(request.headers["content-type"] ?? "").startsWith("application/json"))
    throw Object.assign(new Error("unsupported_content_type"), { status: 415 });
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES)
      throw Object.assign(new Error("request_too_large"), { status: 413 });
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid_input"), { status: 400 });
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Object.assign(new Error("invalid_input"), { status: 400 });
  return value;
}

function json(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

/** One local collector, owned by the launcher; the browser never receives its credential. */
export async function startSecuritiesIngestionService({
  token,
  directory,
  collect,
  getAsset,
  readEvidence,
  readMarket,
  readMarketDirectory,
  readMarketResearch,
  port = 0,
  jobTimeoutMs = MAX_JOB_MS,
}) {
  if (typeof token !== "string" || token.length < 32 || typeof collect !== "function")
    throw new Error("invalid_ingestion_configuration");
  if (!Number.isSafeInteger(jobTimeoutMs) || jobTimeoutMs < 1 || jobTimeoutMs > MAX_JOB_MS)
    throw new Error("invalid_ingestion_timeout");
  const tokenBytes = Buffer.from(`Bearer ${token}`);
  await mkdir(directory, { recursive: true });
  const jobs = new Map();
  const controllers = new Map();
  const files = (id) => path.join(directory, `${id}.json`);
  const writes = new Map();
  let admission = Promise.resolve();
  const serialAdmission = (operation) => {
    const pending = admission.catch(() => {}).then(operation);
    admission = pending;
    return pending;
  };
  async function save(job) {
    jobs.set(job.id, job);
    const serialized = JSON.stringify(job);
    const previous = writes.get(job.id) ?? Promise.resolve();
    const pending = previous
      .catch(() => {})
      .then(async () => {
        const temporary = `${files(job.id)}.tmp`;
        await writeFile(temporary, serialized, { mode: 0o600 });
        await rename(temporary, files(job.id));
      });
    writes.set(job.id, pending);
    await pending;
  }
  async function getJob(id) {
    if (!JOB_ID.test(id)) return null;
    if (jobs.has(id)) return jobs.get(id);
    let saved;
    try {
      saved = JSON.parse(await readFile(files(id), "utf8"));
    } catch {
      return null;
    }
    if (ACTIVE.has(saved.status)) {
      saved = {
        ...saved,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: { code: "source_job_interrupted" },
      };
      await save(saved);
    }
    jobs.set(id, saved);
    return saved;
  }
  function queue(job) {
    const controller = new AbortController();
    controllers.set(job.id, controller);
    const deadline = setTimeout(() => {
      controller.abort(new DOMException("Timed out", "TimeoutError"));
      const current = jobs.get(job.id);
      if (ACTIVE.has(current?.status))
        void save({
          ...current,
          status: "failed",
          completedAt: new Date().toISOString(),
          error: { code: "source_job_timeout" },
        }).catch(() => {});
    }, jobTimeoutMs);
    void (async () => {
      try {
        const result = await collect({
          companyId: job.companyId,
          forceRefresh: true,
          signal: controller.signal,
          onProgress(progress) {
            if (controller.signal.aborted) return;
            const phase =
              typeof progress?.phase === "string" && /^[a-z_]{1,40}$/u.test(progress.phase)
                ? progress.phase
                : "extracting";
            const next = {
              ...jobs.get(job.id),
              progress: {
                phase,
                ...(Number.isSafeInteger(progress?.page) ? { page: progress.page } : {}),
                ...(Number.isSafeInteger(progress?.total) ? { total: progress.total } : {}),
              },
            };
            void save(next).catch(() => controller.abort());
          },
        });
        if (controller.signal.aborted || jobs.get(job.id)?.status === "cancelled") return;
        const bytes = Buffer.byteLength(JSON.stringify(result));
        if (bytes > 6_000_000) throw new Error("source_result_too_large");
        const datasets = Array.isArray(result?.datasets) ? result.datasets : [];
        await save({
          ...jobs.get(job.id),
          status: datasets.length ? "completed" : "partial",
          progress: { phase: "complete" },
          result,
          completedAt: new Date().toISOString(),
        });
      } catch (error) {
        if (ACTIVE.has(jobs.get(job.id)?.status))
          await save({
            ...jobs.get(job.id),
            status: "failed",
            error: { code: safeError(error) },
            completedAt: new Date().toISOString(),
          });
      } finally {
        clearTimeout(deadline);
        controllers.delete(job.id);
      }
    })().catch(() => {});
  }
  const server = createServer(async (request, response) => {
    try {
      const authorization = Buffer.from(request.headers.authorization ?? "");
      if (authorization.length !== tokenBytes.length || !timingSafeEqual(authorization, tokenBytes))
        return json(response, 401, { error: "unauthorized" });
      if (request.headers.origin)
        return json(response, 403, { error: "browser_origin_not_allowed" });
      const host = request.headers.host ?? "";
      if (!/^127\.0\.0\.1:\d+$/u.test(host)) return json(response, 403, { error: "invalid_host" });
      const url = new URL(request.url, `http://${host}`);
      if (url.pathname === "/market/directory" && request.method === "GET") {
        if ([...url.searchParams].length) return json(response, 400, { error: "invalid_input" });
        const packet =
          typeof readMarketDirectory === "function"
            ? await readMarketDirectory()
            : marketDirectoryUnavailable();
        return json(response, 200, { directory: validateMarketDirectory(packet) });
      }
      if (url.pathname === "/market/research" && request.method === "POST") {
        if ([...url.searchParams].length) return json(response, 400, { error: "invalid_input" });
        const input = validateMarketResearchInput(await readInput(request));
        if (typeof readMarketResearch !== "function")
          return json(response, 503, { error: "model_not_configured" });
        const controller = new AbortController();
        const id = randomUUID();
        controllers.set(id, controller);
        const deadline = setTimeout(
          () => controller.abort(new DOMException("Timed out", "TimeoutError")),
          190_000,
        );
        response.once("close", () => {
          if (!response.writableEnded)
            controller.abort(new DOMException("Request closed", "AbortError"));
        });
        try {
          const research = validateMarketResearchResult(
            await readMarketResearch(input, { signal: controller.signal }),
            input,
          );
          return json(response, 200, { research });
        } finally {
          clearTimeout(deadline);
          controllers.delete(id);
        }
      }
      if (url.pathname === "/market" && request.method === "GET") {
        for (const key of url.searchParams.keys())
          if (
            !["symbol", "dataset", "exchange"].includes(key) ||
            url.searchParams.getAll(key).length !== 1
          )
            return json(response, 400, { error: "invalid_input" });
        let input;
        try {
          input = validateMarketInput(Object.fromEntries(url.searchParams));
        } catch {
          return json(response, 400, { error: "invalid_input" });
        }
        const packet =
          typeof readMarket === "function" ? await readMarket(input) : marketUnavailable(input);
        return json(response, 200, { market: validateMarketPacket(packet, input) });
      }
      if (url.pathname === "/evidence" && request.method === "POST") {
        if (typeof readEvidence !== "function")
          return json(response, 503, { error: "source_evidence_unavailable" });
        const input = await readInput(request);
        const controller = new AbortController();
        const deadline = setTimeout(
          () => controller.abort(new DOMException("Timed out", "TimeoutError")),
          18_000,
        );
        response.once("close", () => {
          if (!response.writableEnded)
            controller.abort(new DOMException("Request closed", "AbortError"));
        });
        try {
          const evidence = await readEvidence(input, { signal: controller.signal });
          if (Buffer.byteLength(JSON.stringify(evidence)) > 6_000_000)
            throw Object.assign(new Error("source_result_too_large"), { status: 502 });
          return json(response, 200, { evidence });
        } finally {
          clearTimeout(deadline);
        }
      }
      if (url.pathname === "/jobs" && request.method === "POST") {
        const input = await readInput(request);
        if (
          Object.keys(input).some((key) => !["companyId", "requestId"].includes(key)) ||
          typeof input.companyId !== "string" ||
          typeof input.requestId !== "string" ||
          !COMPANY_ID.test(input.companyId) ||
          !JOB_ID.test(input.requestId)
        )
          return json(response, 400, { error: "invalid_input" });
        return await serialAdmission(async () => {
          const replay = await getJob(input.requestId);
          if (replay)
            return json(
              response,
              replay.companyId === input.companyId ? 200 : 409,
              replay.companyId === input.companyId
                ? { job: replay }
                : { error: "idempotency_conflict" },
            );
          if ([...jobs.values()].some((job) => ACTIVE.has(job.status)))
            return json(response, 409, { error: "source_job_already_running" });
          const job = {
            id: input.requestId,
            companyId: input.companyId,
            status: "running",
            startedAt: new Date().toISOString(),
            progress: { phase: "discovering" },
            result: null,
            error: null,
          };
          await save(job);
          queue(job);
          return json(response, 202, { job });
        });
      }
      const route = /^\/jobs\/([a-zA-Z0-9_-]{8,96})(\/cancel)?$/u.exec(url.pathname);
      if (route) {
        const job = await getJob(route[1]);
        if (!job) return json(response, 404, { error: "source_job_not_found" });
        if (route[2] && request.method === "POST") {
          const input = await readInput(request);
          if (
            Object.keys(input).some((key) => key !== "requestId") ||
            typeof input.requestId !== "string" ||
            !JOB_ID.test(input.requestId)
          )
            return json(response, 400, { error: "invalid_input" });
          const current = await getJob(job.id);
          if (ACTIVE.has(current.status)) {
            controllers.get(job.id)?.abort(new DOMException("Cancelled", "AbortError"));
            await save({
              ...current,
              status: "cancelled",
              completedAt: new Date().toISOString(),
              error: { code: "cancelled" },
            });
          }
          return json(response, 200, { job: jobs.get(job.id) });
        }
        if (!route[2] && request.method === "GET") return json(response, 200, { job });
        return json(response, 405, { error: "method_not_allowed" });
      }
      const assetRoute =
        /^\/documents\/([a-zA-Z0-9_-]{1,100})\/([a-f0-9]{64})\/(?:original|pages\/([1-9][0-9]{0,2}))$/u.exec(
          url.pathname,
        );
      if (assetRoute && request.method === "GET" && getAsset) {
        const asset = await getAsset({
          sourceId: assetRoute[1],
          hash: assetRoute[2],
          page: assetRoute[3] ? Number(assetRoute[3]) : undefined,
          kind: assetRoute[3] ? "page" : "original",
        });
        if (!asset) return json(response, 404, { error: "source_asset_unavailable" });
        response.writeHead(200, {
          "Content-Type": asset.contentType,
          "Cache-Control": "private, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(asset.bytes);
        return;
      }
      return json(response, 404, { error: "not_found" });
    } catch (error) {
      if (!response.headersSent) json(response, error.status ?? 500, { error: safeError(error) });
      else response.end();
    }
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      for (const controller of controllers.values())
        controller.abort(new DOMException("Stopped", "AbortError"));
      await Promise.allSettled([...writes.values()]);
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    },
    id: randomUUID(),
  };
}
