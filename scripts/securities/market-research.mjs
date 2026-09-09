import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { DossierError } from "../../shared/securities/dossier.js";
import {
  validateMarketDirectory,
  validateMarketPacket,
} from "../../shared/securities/market-data.js";
import {
  researchMarketStock,
  validateMarketResearchInput,
  validateMarketResearchResult,
  validateMarketResearchSource,
  validateMarketResearchSourceAccess,
} from "../../worker/securities/market-research.js";
import { readMarketResearchSource } from "./market-source-reader.mjs";

const CACHE_MS = 5 * 60_000;
const safeCode = (error) =>
  /^[a-z][a-z0-9_]{1,79}$/u.test(error?.code ?? "") ? error.code : "market_research_unavailable";

/** Explicit local research requests only. Public directory loading never calls a model. */
export async function createMarketResearchProvider({
  directory,
  marketProvider,
  env = {},
  research = researchMarketStock,
  readSource = readMarketResearchSource,
  now = () => Date.now(),
  timeoutMs = 180_000,
} = {}) {
  if (
    !path.isAbsolute(directory) ||
    typeof marketProvider?.getDirectory !== "function" ||
    typeof marketProvider?.get !== "function" ||
    typeof readSource !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 180_000
  )
    throw new Error("invalid_market_research_configuration");
  await mkdir(directory, { recursive: true });
  const cache = new Map();
  let active = null,
    closed = false;
  async function persist(file, data) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: "wx" });
      await rename(temporary, file);
    } catch {
      await unlink(temporary).catch(() => {});
      throw new DossierError("receipt_persistence_failed", 503);
    }
  }
  function throwIfAborted(signal) {
    if (signal.aborted)
      throw new DossierError(
        signal.reason?.name === "TimeoutError" ? "market_research_timeout" : "market_cancelled",
        signal.reason?.name === "TimeoutError" ? 504 : 499,
      );
  }
  async function preflight(promise, signal) {
    let cancel;
    try {
      return await Promise.race([
        promise,
        new Promise((resolve, reject) => {
          cancel = () => reject(signal.reason);
          if (signal.aborted) cancel();
          else signal.addEventListener("abort", cancel, { once: true });
        }),
      ]);
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }
  async function execute(input, fingerprint, controller, receiptObserver) {
    const id = randomUUID();
    const file = path.join(directory, `${id}.json`);
    const audit = {
      schemaVersion: 1,
      id,
      fingerprint,
      symbol: input.symbol,
      exchange: input.exchange,
      locale: input.locale,
      startedAt: new Date(now()).toISOString(),
      status: "running",
      receipts: [],
    };
    // Verify audit storage before admitting any paid request.
    await persist(file, audit);
    try {
      const directoryPacket = validateMarketDirectory(
        await preflight(marketProvider.getDirectory(), controller.signal),
      );
      throwIfAborted(controller.signal);
      const stock = directoryPacket.items.find(
        (item) => item.symbol === input.symbol && item.exchange === input.exchange,
      );
      if (!stock) throw new DossierError("market_symbol_missing", 422);
      const profileInput = { symbol: input.symbol, exchange: input.exchange, dataset: "company" };
      const profile = validateMarketPacket(
        await preflight(marketProvider.get(profileInput), controller.signal),
        profileInput,
      );
      throwIfAborted(controller.signal);
      const result = validateMarketResearchResult(
        await research({
          input,
          stock,
          profile,
          env,
          signal: controller.signal,
          now: () => new Date(now()).toISOString(),
          async readSource(options) {
            throwIfAborted(controller.signal);
            const attempt = {
              url: options.url,
              startedAt: new Date(now()).toISOString(),
              status: "running",
            };
            (audit.sourceReads ||= []).push(attempt);
            await persist(file, audit);
            let source;
            try {
              source = validateMarketResearchSource(
                await preflight(
                  readSource({ ...options, signal: controller.signal }),
                  controller.signal,
                ),
                options.url,
              );
            } catch (error) {
              attempt.status = controller.signal.aborted ? "cancelled" : "failed";
              attempt.completedAt = new Date(now()).toISOString();
              attempt.error = { code: safeCode(error) };
              if (error?.sourceAccess) {
                try {
                  attempt.access = validateMarketResearchSourceAccess(
                    error.sourceAccess,
                    options.url,
                  );
                } catch {
                  // Untrusted diagnostic text and URLs never enter an audit.
                }
              }
              await persist(file, audit);
              throw error;
            }
            throwIfAborted(controller.signal);
            const sourceNumber = (audit.sources?.length || 0) + 1;
            const sourceFile = `${id}.source${sourceNumber === 1 ? "" : `-${sourceNumber}`}.json`;
            await persist(path.join(directory, sourceFile), source);
            const metadata = {
              file: sourceFile,
              url: source.url,
              hash: source.hash,
              byteLength: source.byteLength,
              fetchedAt: source.fetchedAt,
              contentType: source.contentType,
              extraction: source.extraction,
              ...(source.access ? { access: source.access } : {}),
            };
            (audit.sources ||= []).push(metadata);
            // Preserve the existing first-source pointer; all attempts remain separate.
            audit.source ||= metadata;
            attempt.status = "read";
            attempt.completedAt = new Date(now()).toISOString();
            attempt.source = metadata;
            await persist(file, audit);
            throwIfAborted(controller.signal);
            return source;
          },
          async onReceipt(receipt) {
            audit.receipts.push(receipt);
            await persist(file, audit);
            if (receiptObserver) {
              try {
                await receiptObserver({ ...structuredClone(receipt), researchAuditId: id });
              } catch {
                throw new DossierError("receipt_persistence_failed", 503);
              }
            }
          },
        }),
        input,
      );
      throwIfAborted(controller.signal);
      audit.status = result.status;
      audit.completedAt = new Date(now()).toISOString();
      audit.result = result;
      await persist(file, audit);
      const expiresAt = now() + CACHE_MS;
      cache.set(fingerprint, { result: structuredClone(result), expiresAt });
      for (const [key, item] of cache) if (item.expiresAt <= now()) cache.delete(key);
      return { ...result, cache: { hit: false, expiresAt: new Date(expiresAt).toISOString() } };
    } catch (error) {
      const timedOut =
        controller.signal.aborted && controller.signal.reason?.name === "TimeoutError";
      audit.status = controller.signal.aborted && !timedOut ? "cancelled" : "failed";
      audit.completedAt = new Date(now()).toISOString();
      audit.error = {
        code: timedOut
          ? "market_research_timeout"
          : controller.signal.aborted
            ? "market_cancelled"
            : safeCode(error),
      };
      for (const attempt of audit.sourceReads ?? []) {
        if (attempt.status !== "running") continue;
        attempt.status = audit.status === "cancelled" ? "cancelled" : "failed";
        attempt.completedAt = audit.completedAt;
        attempt.error = { ...audit.error };
      }
      await persist(file, audit);
      throwIfAborted(controller.signal);
      throw error;
    }
  }
  async function get(raw, { signal, onReceipt } = {}) {
    const input = validateMarketResearchInput(raw);
    if (onReceipt !== undefined && typeof onReceipt !== "function")
      throw new DossierError("invalid_market_research", 400);
    if (closed || signal?.aborted) throw new DossierError("market_cancelled", 499);
    if (
      env.SECURITIES_MODEL_MODE !== "live" ||
      typeof env.SECURITIES_OPENROUTER_API_KEY !== "string" ||
      !/^sk-or-[A-Za-z0-9_-]{16,256}$/u.test(env.SECURITIES_OPENROUTER_API_KEY)
    )
      throw new DossierError("model_not_configured", 503);
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const cached = cache.get(fingerprint);
    if (cached?.expiresAt > now())
      return validateMarketResearchResult(
        {
          ...structuredClone(cached.result),
          cache: { hit: true, expiresAt: new Date(cached.expiresAt).toISOString() },
        },
        input,
      );
    if (active) throw new DossierError("market_research_busy", 409);
    const controller = new AbortController();
    const cancel = () => controller.abort(new DOMException("Request closed", "AbortError"));
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(
      () => controller.abort(new DOMException("Timed out", "TimeoutError")),
      timeoutMs,
    );
    const operation = { controller, promise: null };
    active = operation;
    operation.promise = execute(input, fingerprint, controller, onReceipt);
    try {
      return await operation.promise;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (active === operation) active = null;
    }
  }
  return {
    get,
    async close() {
      closed = true;
      active?.controller.abort(new DOMException("Stopped", "AbortError"));
      if (active) await active.promise.catch(() => {});
    },
  };
}
