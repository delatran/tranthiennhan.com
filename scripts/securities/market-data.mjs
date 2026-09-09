import { mkdir, readFile, writeFile, rename, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID, createHash } from "node:crypto";
import {
  MAX_MARKET_BYTES,
  MAX_MARKET_DIRECTORY_BYTES,
  MAX_MARKET_DIRECTORY_ITEMS,
  MARKET_EXCHANGES,
  MARKET_ERROR_CODES,
  marketDate,
  marketUnavailable,
  marketDirectoryUnavailable,
  validateMarketInput,
  validateMarketPacket,
  validateMarketDirectory,
} from "../../shared/securities/market-data.js";

const API = "https://api-finfo.vndirect.com.vn";
const PAGE_SIZE = 500;
const TTL = {
  quote: 30_000,
  history: 15 * 60_000,
  company: 6 * 60 * 60_000,
  directory: 15 * 60_000,
};
const MAX_STALE_MS = 7 * 24 * 60 * 60_000;
const vietnamDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const problem = (code = "market_invalid_response") => Object.assign(new Error(code), { code });
const normalizedError = (error, signal) =>
  signal?.aborted
    ? signal.reason?.name === "TimeoutError"
      ? "market_timeout"
      : "market_cancelled"
    : error?.name === "TimeoutError"
      ? "market_timeout"
      : MARKET_ERROR_CODES.includes(error?.code)
        ? error.code
        : "market_provider_unavailable";
const nullableText = (value, maximum = 600) =>
  typeof value === "string" &&
  value.length <= maximum &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
    ? value.trim() || null
    : null;
const nullableId = (value) =>
  typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : nullableText(value, 100);
const clockText = (now) => new Date(now()).toISOString();

/** Only these anonymous public read operations can leave the local service. */
export function publicMarketUrl(operation, input, page = 1) {
  const url = new URL(
    `/v4/${operation === "directory" ? "stocks" : input?.dataset === "company" ? "company_profiles" : "stock_prices"}`,
    API,
  );
  if (operation === "directory") {
    if (
      !MARKET_EXCHANGES.includes(input?.exchange) ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 20
    )
      throw problem();
    url.search = new URLSearchParams({
      q: `type:STOCK~status:listed~floor:${input.exchange}`,
      size: String(PAGE_SIZE),
      page: String(page),
      sort: "code:asc",
    });
  } else if (operation === "market") {
    validateMarketInput(input);
    url.search = new URLSearchParams({
      q: `code:${input.symbol}`,
      size: input.dataset === "history" ? "300" : "1",
      ...(input.dataset === "company" ? {} : { sort: "date:desc" }),
    });
  } else throw problem();
  return validatePublicMarketUrl(url.href);
}

export function validatePublicMarketUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw problem("market_access_denied");
  }
  if (
    url.origin !== API ||
    url.username ||
    url.password ||
    url.hash ||
    url.port ||
    !["/v4/stocks", "/v4/stock_prices", "/v4/company_profiles"].includes(url.pathname)
  )
    throw problem("market_access_denied");
  const parameters = url.searchParams;
  const expected =
    url.pathname === "/v4/stocks"
      ? ["q", "size", "page", "sort"]
      : url.pathname === "/v4/stock_prices"
        ? ["q", "size", "sort"]
        : ["q", "size"];
  if (
    [...parameters.keys()].length !== expected.length ||
    expected.some((key) => parameters.getAll(key).length !== 1)
  )
    throw problem("market_access_denied");
  if (url.pathname === "/v4/stocks") {
    if (
      !/^type:STOCK~status:listed~floor:(?:HOSE|HNX|UPCOM)$/u.test(parameters.get("q")) ||
      parameters.get("size") !== "500" ||
      !/^(?:[1-9]|1\d|20)$/u.test(parameters.get("page")) ||
      parameters.get("sort") !== "code:asc"
    )
      throw problem("market_access_denied");
  } else if (
    !/^code:[A-Z][A-Z0-9]{2,7}$/u.test(parameters.get("q")) ||
    !(url.pathname === "/v4/company_profiles"
      ? parameters.get("size") === "1"
      : ["1", "300"].includes(parameters.get("size")) && parameters.get("sort") === "date:desc")
  )
    throw problem("market_access_denied");
  return url.href;
}

async function withSignal(promise, signal) {
  signal.throwIfAborted();
  let abort;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function fetchJson(url, { fetchImpl, signal, now, onReceipt }) {
  validatePublicMarketUrl(url);
  let response;
  try {
    response = await withSignal(
      fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { Accept: "application/json" },
        signal,
      }),
      signal,
    );
  } catch (error) {
    throw problem(normalizedError(error, signal));
  }
  const receipt = {
    kind: "anonymous_public_json_fetch",
    url,
    status: response.status,
    fetchedAt: clockText(now),
    responseDate: response.headers.get("date"),
    etag: response.headers.get("etag"),
  };
  if (
    (response.status >= 300 && response.status < 400) ||
    response.status === 401 ||
    response.status === 403
  ) {
    await response.body?.cancel();
    throw problem("market_access_denied");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw problem(response.status === 429 ? "market_rate_limited" : "market_provider_unavailable");
  }
  if (response.url && validatePublicMarketUrl(response.url) !== url) {
    await response.body?.cancel();
    throw problem("market_access_denied");
  }
  if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")) {
    await response.body?.cancel();
    throw problem();
  }
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > MAX_MARKET_DIRECTORY_BYTES)
  ) {
    await response.body?.cancel();
    throw problem("market_result_too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw problem();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await withSignal(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MARKET_DIRECTORY_BYTES) throw problem("market_result_too_large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (
    !size ||
    (declared !== null && !response.headers.get("content-encoding") && Number(declared) !== size)
  )
    throw problem();
  const bytes = Buffer.concat(chunks, size);
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw problem();
  }
  if (!plain(parsed)) throw problem();
  if (onReceipt)
    await onReceipt({
      ...receipt,
      bytes: size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      currentPage: parsed.currentPage ?? null,
      size: parsed.size ?? null,
      totalElements: parsed.totalElements ?? null,
      totalPages: parsed.totalPages ?? null,
      returnedRows: Array.isArray(parsed.data) ? parsed.data.length : null,
    });
  return parsed;
}

function envelope(value, size, page = 1, priorTotals = null) {
  // The public API omits count metadata after page one. Continue only against
  // the validated first-page totals, while still checking page identity and size.
  if (plain(value) && page > 1 && priorTotals)
    value = {
      ...value,
      ...(value.totalElements === undefined ? { totalElements: priorTotals.totalElements } : {}),
      ...(value.totalPages === undefined ? { totalPages: priorTotals.totalPages } : {}),
    };
  if (
    !plain(value) ||
    !Array.isArray(value.data) ||
    value.data.length > size ||
    value.currentPage !== page ||
    value.size !== size ||
    !Number.isSafeInteger(value.totalElements) ||
    value.totalElements < 0 ||
    value.totalElements > 10_000_000 ||
    !Number.isSafeInteger(value.totalPages) ||
    value.totalPages < 0 ||
    (value.totalElements > 0 && value.totalPages !== Math.ceil(value.totalElements / size)) ||
    (value.totalElements === 0 && ![0, 1].includes(value.totalPages)) ||
    value.data.length > Math.max(0, Math.min(size, value.totalElements - (page - 1) * size))
  )
    throw problem();
  return value;
}

function numberCell(value, summary, { integer = false, negative = false } = {}) {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (!negative && value < 0) ||
    (integer && !Number.isSafeInteger(value))
  ) {
    summary.invalidCells += 1;
    return null;
  }
  return value;
}

function identity(row, input, stock = false) {
  if (
    !plain(row) ||
    row.code !== input.symbol ||
    !MARKET_EXCHANGES.includes(row.floor) ||
    (input.exchange !== undefined && row.floor !== input.exchange) ||
    (stock && row.type !== "STOCK")
  )
    throw problem();
}

const profileTextFields = [
  "vnName",
  "enName",
  "taxCode",
  "registrationCode",
  "vnAddress",
  "enAddress",
  "website",
  "vnSummary",
  "enSummary",
];
function normalizeProfile(row, summary) {
  const profile = { code: row.code, floor: row.floor };
  for (const key of profileTextFields)
    profile[key] = nullableText(row[key], key.endsWith("Summary") ? 12_000 : 1000);
  profile.foundDate = marketDate(row.foundDate) ? row.foundDate : null;
  for (const key of ["employees", "branches"])
    profile[key] = numberCell(row[key], summary, { integer: true });
  profile.companyId = nullableId(row.companyId);
  return profile;
}

function normalizePrice(row, dataset, summary) {
  const price =
    dataset === "quote"
      ? {
          date: row.date,
          time:
            typeof row.time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/u.test(row.time)
              ? row.time
              : null,
        }
      : { time: row.date };
  for (const key of ["open", "high", "low", "close"]) price[key] = numberCell(row[key], summary);
  price.volume = numberCell(row.nmVolume, summary, { integer: true });
  price.matchedValue = numberCell(row.nmValue, summary);
  if (dataset === "quote") {
    for (const key of ["basicPrice", "ceilingPrice", "floorPrice", "average"])
      price[key] = numberCell(row[key], summary);
    price.putThroughVolume = numberCell(row.ptVolume, summary, { integer: true });
    price.putThroughValue = numberCell(row.ptValue, summary);
    price.change = numberCell(row.change, summary, { negative: true });
    price.pctChange = numberCell(row.pctChange, summary, { negative: true });
  }
  return price;
}

function columnsFor(rows, dataset) {
  const numbers = new Set([
    "open",
    "high",
    "low",
    "close",
    "basicPrice",
    "ceilingPrice",
    "floorPrice",
    "average",
    "change",
    "volume",
    "matchedValue",
    "putThroughVolume",
    "putThroughValue",
  ]);
  return Object.keys(rows[0] ?? {}).map((key) => ({
    key,
    label: key,
    ...(numbers.has(key)
      ? { unit: "unknown" }
      : key === "pctChange"
        ? { unit: "percent" }
        : dataset === "company" && key === "employees"
          ? { unit: "people" }
          : dataset === "company" && key === "branches"
            ? { unit: "count" }
            : {}),
  }));
}

export async function fetchPublicMarket(
  rawInput,
  { fetchImpl = fetch, signal, now = Date.now, timeoutMs = 45_000, onReceipt } = {},
) {
  const input = validateMarketInput(rawInput);
  const operationSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  try {
    const value = envelope(
      await fetchJson(publicMarketUrl("market", input), {
        fetchImpl,
        signal: operationSignal,
        now,
        onReceipt,
      }),
      input.dataset === "history" ? 300 : 1,
    );
    if (value.data.length !== Math.min(value.size, value.totalElements)) throw problem();
    const summary = {
      totalRows: value.totalElements,
      returnedRows: 0,
      invalidRows: 0,
      invalidCells: 0,
      duplicateRows: 0,
      conflictingDates: 0,
      truncatedRows: 0,
      adapterRescaledValues: false,
    };
    let exchange = input.exchange;
    const rows = [],
      seen = new Map(),
      today = vietnamDate.format(new Date(now()));
    for (const row of value.data) {
      identity(row, input, input.dataset !== "company");
      if (exchange && exchange !== row.floor) throw problem();
      exchange = row.floor;
      if (input.dataset === "company") {
        rows.push(normalizeProfile(row, summary));
        continue;
      }
      if (!marketDate(row.date) || row.date > today) throw problem();
      if (input.dataset === "history" && row.date === today) {
        summary.excludedCurrentSessionRows = (summary.excludedCurrentSessionRows ?? 0) + 1;
        continue;
      }
      const normalized = normalizePrice(row, input.dataset, summary);
      if (seen.has(row.date)) {
        summary.duplicateRows += 1;
        if (JSON.stringify(seen.get(row.date)) !== JSON.stringify(normalized)) throw problem();
        continue;
      }
      seen.set(row.date, normalized);
      rows.push(normalized);
    }
    if (input.dataset === "history") rows.sort((a, b) => a.time.localeCompare(b.time));
    summary.returnedRows = rows.length;
    // A latest-quote request is complete with one row. Its API total counts
    // historical sessions, not missing rows in the requested quote.
    summary.truncatedRows =
      input.dataset === "history" ? Math.max(0, value.totalElements - value.data.length) : 0;
    if (input.dataset === "company")
      Object.assign(summary, { asOfKind: "unknown", basis: "provider_profile_without_timestamp" });
    else
      Object.assign(summary, {
        asOfKind: input.dataset === "quote" ? "market_quote" : "market_session",
        volumeBasis: "matched_only",
        basis: input.dataset === "quote" ? "provider_quote_date_time" : "provider_daily_session",
        ...(input.dataset === "quote"
          ? { sourceTime: rows[0]?.time ?? null, timezone: "source_local_unspecified" }
          : { interval: "1D" }),
      });
    const packet = {
      ...marketUnavailable(input, "market_provider_unavailable", clockText(now)),
      status: rows.length ? "ready" : "empty",
      ...(exchange ? { exchange } : {}),
      rows,
      columns: columnsFor(rows, input.dataset),
      units:
        input.dataset === "company"
          ? { employees: "people", branches: "count" }
          : { price: "unknown", volume: "unknown", value: "unknown" },
      asOf:
        input.dataset === "company"
          ? null
          : input.dataset === "quote"
            ? (rows[0]?.date ?? null)
            : (rows.at(-1)?.time ?? null),
      summary,
    };
    delete packet.error;
    return validateMarketPacket(packet, input);
  } catch (error) {
    return marketUnavailable(input, normalizedError(error, operationSignal), clockText(now));
  }
}

function directoryItem(row, exchange) {
  if (
    !plain(row) ||
    row.floor !== exchange ||
    row.type !== "STOCK" ||
    row.status !== "listed" ||
    typeof row.code !== "string" ||
    !/^[A-Z][A-Z0-9]{2,7}$/u.test(row.code) ||
    !nullableText(row.companyName)
  )
    return null;
  return {
    symbol: row.code,
    name: row.companyName.trim(),
    nameEn: nullableText(row.companyNameEng),
    exchange,
    securityType: "stock",
    status: "listed",
    isin: nullableText(row.isin, 100),
    listedDate: marketDate(row.listedDate) ? row.listedDate : null,
    companyId: nullableId(row.companyId),
    taxCode: nullableText(row.taxCode, 100),
    faceValue:
      typeof row.faceValue === "number" && Number.isFinite(row.faceValue) && row.faceValue >= 0
        ? row.faceValue
        : null,
  };
}

export async function fetchPublicMarketDirectory({
  fetchImpl = fetch,
  signal,
  now = Date.now,
  timeoutMs = 45_000,
  onReceipt,
} = {}) {
  const operationSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  const directory = marketDirectoryUnavailable("market_provider_unavailable", clockText(now));
  const items = [],
    coverage = [];
  let failure = "market_incomplete_directory";
  for (const exchange of MARKET_EXCHANGES) {
    const owned = new Map();
    let expectedCount = null,
      pages = 1,
      complete = true;
    try {
      for (let page = 1; page <= pages; page++) {
        const value = envelope(
          await fetchJson(publicMarketUrl("directory", { exchange }, page), {
            fetchImpl,
            signal: operationSignal,
            now,
            onReceipt,
          }),
          PAGE_SIZE,
          page,
          expectedCount === null ? null : { totalElements: expectedCount, totalPages: pages },
        );
        if (value.totalElements > MAX_MARKET_DIRECTORY_ITEMS || value.totalPages > 20)
          throw problem("market_result_too_large");
        if (expectedCount === null) {
          expectedCount = value.totalElements;
          pages = Math.max(1, value.totalPages);
        } else if (expectedCount !== value.totalElements || pages !== Math.max(1, value.totalPages))
          complete = false;
        if (
          value.data.length !==
          Math.max(0, Math.min(PAGE_SIZE, expectedCount - (page - 1) * PAGE_SIZE))
        )
          complete = false;
        for (const row of value.data) {
          const item = directoryItem(row, exchange);
          if (!item || owned.has(item.symbol)) {
            complete = false;
            continue;
          }
          if (items.length + owned.size >= MAX_MARKET_DIRECTORY_ITEMS)
            throw problem("market_result_too_large");
          owned.set(item.symbol, item);
        }
      }
    } catch (error) {
      complete = false;
      failure = normalizedError(error, operationSignal);
    }
    items.push(...owned.values());
    coverage.push({
      exchange,
      status:
        complete && expectedCount === owned.size
          ? "complete"
          : expectedCount === null
            ? "unavailable"
            : "incomplete",
      expectedCount,
      receivedCount: owned.size,
    });
  }
  if (operationSignal.aborted)
    return marketDirectoryUnavailable(
      normalizedError(operationSignal.reason, operationSignal),
      clockText(now),
    );
  Object.assign(directory, {
    items: items.sort(
      (a, b) => a.symbol.localeCompare(b.symbol) || a.exchange.localeCompare(b.exchange),
    ),
    coverage,
    fetchedAt: clockText(now),
    status: coverage.every((entry) => entry.status === "complete")
      ? "ready"
      : coverage.every((entry) => entry.status === "unavailable")
        ? "unavailable"
        : "partial",
  });
  if (directory.status === "ready") delete directory.error;
  else directory.error = { code: failure };
  try {
    return validateMarketDirectory(directory);
  } catch (error) {
    return marketDirectoryUnavailable(normalizedError(error, operationSignal), clockText(now));
  }
}

/** One local provider owns all anonymous requests, snapshots and cancellation. */
export async function createMarketDataProvider({
  directory,
  run = fetchPublicMarket,
  runDirectory = fetchPublicMarketDirectory,
  fetchImpl = fetch,
  now = Date.now,
  minIntervalMs = 1000,
  timeoutMs = 45_000,
  onReceipt,
} = {}) {
  if (
    !directory ||
    !Number.isFinite(minIntervalMs) ||
    minIntervalMs < 0 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000 ||
    typeof run !== "function" ||
    typeof runDirectory !== "function" ||
    typeof fetchImpl !== "function" ||
    typeof now !== "function" ||
    (onReceipt !== undefined && typeof onReceipt !== "function")
  )
    throw new Error("invalid_market_configuration");
  await mkdir(directory, { recursive: true });
  const cache = new Map(),
    failures = new Map(),
    volatile = new Set(),
    controller = new AbortController();
  let active = null,
    nextAllowed = 0,
    closed = false;
  const descriptor = (input) =>
    input
      ? {
          key: `${input.symbol}-${input.dataset}${input.exchange ? `-${input.exchange}` : ""}`,
          ttl: TTL[input.dataset],
          bytes: MAX_MARKET_BYTES,
          validate: (value) => validateMarketPacket(value, input),
          unavailable: (code) => marketUnavailable(input, code, clockText(now)),
          execute: (options) => run(input, options),
        }
      : {
          key: "directory",
          ttl: TTL.directory,
          bytes: MAX_MARKET_DIRECTORY_BYTES,
          validate: validateMarketDirectory,
          unavailable: (code) => marketDirectoryUnavailable(code, clockText(now)),
          execute: runDirectory,
        };
  const filename = (entry) => path.join(directory, `${entry.key}.json`);
  const decorate = (packet, entry, hit, stale, error) => ({
    ...structuredClone(packet),
    ...(error ? { error: { code: error } } : {}),
    cache: {
      hit,
      stale,
      persisted: !volatile.has(entry.key),
      expiresAt: new Date(Date.parse(packet.fetchedAt) + entry.ttl).toISOString(),
    },
  });
  async function read(entry) {
    if (cache.has(entry.key)) return cache.get(entry.key);
    try {
      if ((await stat(filename(entry))).size > entry.bytes) return null;
      const raw = await readFile(filename(entry), "utf8");
      if (Buffer.byteLength(raw) > entry.bytes) return null;
      const saved = entry.validate(JSON.parse(raw));
      if (saved.status !== "unavailable") {
        cache.set(entry.key, saved);
        return saved;
      }
    } catch {
      /* Missing, obsolete or corrupt snapshots are replaced by a normal public read. */
    }
    return null;
  }
  async function persist(packet, entry) {
    const temporary = `${filename(entry)}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(packet), { mode: 0o600 });
      await rename(temporary, filename(entry));
      volatile.delete(entry.key);
    } catch {
      volatile.add(entry.key);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    cache.set(entry.key, packet);
  }
  async function getSnapshot(entry) {
    if (closed) return entry.unavailable("market_cancelled");
    const saved = await read(entry),
      age = saved ? now() - Date.parse(saved.fetchedAt) : Infinity;
    if (saved && age >= 0 && age < entry.ttl) return decorate(saved, entry, true, false);
    const usable = () =>
      saved &&
      now() - Date.parse(saved.fetchedAt) >= 0 &&
      now() - Date.parse(saved.fetchedAt) < MAX_STALE_MS;
    const fallback = (code) =>
      usable() ? decorate(saved, entry, true, true, code) : entry.unavailable(code);
    if (active) return active.key === entry.key ? active.promise : fallback("market_busy");
    const previousFailure = failures.get(entry.key);
    if (previousFailure && now() - previousFailure.at < 30_000)
      return fallback(previousFailure.code);
    const operation = (async () => {
      try {
        await delay(Math.max(0, nextAllowed - now()), undefined, { signal: controller.signal });
        nextAllowed = now() + minIntervalMs;
        const packet = entry.validate(
          await withSignal(
            entry.execute({ fetchImpl, now, timeoutMs, onReceipt, signal: controller.signal }),
            controller.signal,
          ),
        );
        if (closed) return entry.unavailable("market_cancelled");
        if (Date.parse(packet.fetchedAt) > now()) throw problem();
        if (
          packet.status === "unavailable" ||
          (entry.key === "directory" &&
            packet.status === "partial" &&
            saved?.status === "ready" &&
            usable())
        ) {
          const code = packet.error?.code ?? "market_incomplete_directory";
          failures.set(entry.key, { at: now(), code });
          return fallback(code);
        }
        await persist(packet, entry);
        failures.delete(entry.key);
        return decorate(packet, entry, false, false);
      } catch (error) {
        const code = normalizedError(error, controller.signal);
        if (closed) return entry.unavailable("market_cancelled");
        failures.set(entry.key, { at: now(), code });
        return fallback(code);
      } finally {
        if (active?.key === entry.key) active = null;
      }
    })();
    active = { key: entry.key, promise: operation };
    return operation;
  }
  return {
    get: (raw) => getSnapshot(descriptor(validateMarketInput(raw))),
    getDirectory: () => getSnapshot(descriptor()),
    async close() {
      closed = true;
      controller.abort();
      await active?.promise;
    },
  };
}
