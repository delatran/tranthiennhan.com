import { DossierError } from "./dossier.js";

export const MARKET_DATASETS = Object.freeze(["quote", "history", "company"]);
export const MARKET_EXCHANGES = Object.freeze(["HOSE", "HNX", "UPCOM"]);
export const MARKET_PROVIDER = "vndirect_public_web";
export const MARKET_SOURCE = Object.freeze({
  name: "VNDIRECT Dstock",
  url: "https://dstock.vndirect.com.vn/",
});
export const MARKET_ERROR_CODES = Object.freeze([
  "market_timeout",
  "market_rate_limited",
  "market_busy",
  "market_cancelled",
  "market_provider_unavailable",
  "market_invalid_response",
  "market_result_too_large",
  "market_access_denied",
  "market_incomplete_directory",
]);
export const MAX_MARKET_BYTES = 1_500_000;
export const MAX_MARKET_DIRECTORY_BYTES = 5_000_000;
export const MAX_MARKET_DIRECTORY_ITEMS = 10_000;

const unsafeKey = (key) => ["__proto__", "constructor", "prototype"].includes(key);
const plain = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const closed = (value, keys) =>
  plain(value) && Object.keys(value).every((key) => keys.includes(key));
const text = (value, max) =>
  typeof value === "string" &&
  value.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const symbol = (value) => typeof value === "string" && /^[A-Z][A-Z0-9]{2,7}$/u.test(value);
export const marketDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const sourceTime = (value) =>
  typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/u.test(value);
const timestamp = (value) =>
  typeof value === "string" &&
  value.length <= 40 &&
  /^\d{4}-\d{2}-\d{2}T[0-9:.+-]+(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
  marketDate(value.slice(0, 10)) &&
  Number.isFinite(Date.parse(value));
const cell = (value) =>
  value === null ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value)) ||
  text(value, 12_000);
const sourceValid = (value) =>
  closed(value, ["name", "url"]) &&
  value.name === MARKET_SOURCE.name &&
  value.url === MARKET_SOURCE.url;
const errorValid = (value) =>
  value === undefined || (closed(value, ["code"]) && MARKET_ERROR_CODES.includes(value.code));
const cacheValid = (value) =>
  value === undefined ||
  (closed(value, ["hit", "stale", "expiresAt", "persisted"]) &&
    typeof value.hit === "boolean" &&
    typeof value.stale === "boolean" &&
    timestamp(value.expiresAt) &&
    (value.persisted === undefined || typeof value.persisted === "boolean"));
const bounded = (value, bytes) => {
  if (new TextEncoder().encode(JSON.stringify(value)).length > bytes)
    throw new DossierError("market_result_too_large", 502);
};
const errorCode = (code) =>
  MARKET_ERROR_CODES.includes(code) ? code : "market_provider_unavailable";

export function validateMarketInput(input) {
  if (
    !closed(input, ["symbol", "dataset", "exchange"]) ||
    !symbol(input.symbol) ||
    !MARKET_DATASETS.includes(input.dataset) ||
    (input.exchange !== undefined && !MARKET_EXCHANGES.includes(input.exchange))
  )
    throw new DossierError("invalid_market_query", 400);
  return {
    symbol: input.symbol,
    dataset: input.dataset,
    ...(input.exchange !== undefined ? { exchange: input.exchange } : {}),
  };
}

export function marketUnavailable(
  input,
  code = "market_provider_unavailable",
  now = new Date().toISOString(),
) {
  return {
    schemaVersion: 2,
    provider: MARKET_PROVIDER,
    access: "public",
    ...validateMarketInput(input),
    source: { ...MARKET_SOURCE },
    fetchedAt: now,
    asOf: null,
    status: "unavailable",
    columns: [],
    rows: [],
    units: {},
    error: { code: errorCode(code) },
  };
}

const COUNTERS = [
  "totalRows",
  "returnedRows",
  "invalidRows",
  "invalidCells",
  "duplicateRows",
  "conflictingDates",
  "truncatedRows",
  "truncatedColumns",
  "excludedCurrentSessionRows",
];

/** Public snapshots remain separate from the original-document evidence ledger. */
export function validateMarketPacket(packet, rawInput) {
  const input = validateMarketInput(rawInput);
  const fail = () => {
    throw new DossierError("market_invalid_response", 502);
  };
  if (
    !closed(packet, [
      "schemaVersion",
      "provider",
      "access",
      "symbol",
      "dataset",
      "exchange",
      "source",
      "fetchedAt",
      "asOf",
      "status",
      "columns",
      "rows",
      "units",
      "summary",
      "error",
      "cache",
    ]) ||
    packet.schemaVersion !== 2 ||
    packet.provider !== MARKET_PROVIDER ||
    packet.access !== "public" ||
    packet.symbol !== input.symbol ||
    packet.dataset !== input.dataset ||
    (packet.exchange !== undefined && !MARKET_EXCHANGES.includes(packet.exchange)) ||
    (input.exchange !== undefined && packet.exchange !== input.exchange) ||
    !["ready", "empty", "unavailable"].includes(packet.status) ||
    !timestamp(packet.fetchedAt) ||
    !(packet.asOf === null || marketDate(packet.asOf) || timestamp(packet.asOf)) ||
    !sourceValid(packet.source) ||
    !Array.isArray(packet.columns) ||
    packet.columns.length > 100 ||
    !Array.isArray(packet.rows) ||
    packet.rows.length > (input.dataset === "history" ? 300 : 1) ||
    !plain(packet.units) ||
    !errorValid(packet.error) ||
    !cacheValid(packet.cache)
  )
    fail();
  const keys = new Set();
  for (const column of packet.columns) {
    if (
      !closed(column, ["key", "label", "unit"]) ||
      !text(column.key, 200) ||
      !column.key.length ||
      unsafeKey(column.key) ||
      keys.has(column.key) ||
      !text(column.label, 300) ||
      (column.unit !== undefined && !text(column.unit, 100))
    )
      fail();
    keys.add(column.key);
  }
  for (const row of packet.rows) {
    if (
      !plain(row) ||
      Object.keys(row).some((key) => !keys.has(key)) ||
      Object.values(row).some((value) => !cell(value))
    )
      fail();
  }
  if (
    Object.keys(packet.units).length > 100 ||
    Object.entries(packet.units).some(([key, value]) => unsafeKey(key) || !text(value, 100))
  )
    fail();
  if (
    packet.status === "ready" &&
    (!packet.rows.length || !MARKET_EXCHANGES.includes(packet.exchange))
  )
    fail();
  if (packet.status !== "ready" && packet.rows.length) fail();
  if (packet.status === "unavailable" && !packet.error) fail();
  if (packet.status === "ready") {
    if (
      input.dataset === "company" &&
      (packet.asOf !== null ||
        packet.rows[0].code !== input.symbol ||
        packet.rows[0].floor !== packet.exchange)
    )
      fail();
    if (
      input.dataset === "quote" &&
      (!marketDate(packet.rows[0].date) ||
        packet.asOf !== packet.rows[0].date ||
        !(packet.rows[0].time === null || sourceTime(packet.rows[0].time)))
    )
      fail();
    if (
      input.dataset === "history" &&
      (packet.rows.some(
        (row, index) =>
          !marketDate(row.time) || (index > 0 && packet.rows[index - 1].time >= row.time),
      ) ||
        packet.asOf !== packet.rows.at(-1).time)
    )
      fail();
  }
  if (packet.summary !== undefined) {
    const summary = packet.summary;
    if (
      !closed(summary, [
        ...COUNTERS,
        "asOfKind",
        "interval",
        "adapterRescaledValues",
        "sourceTime",
        "timezone",
        "basis",
        "volumeBasis",
      ])
    )
      fail();
    for (const key of COUNTERS)
      if (
        summary[key] !== undefined &&
        (!Number.isSafeInteger(summary[key]) || summary[key] < 0 || summary[key] > 10_000_000)
      )
        fail();
    if (summary.returnedRows !== undefined && summary.returnedRows !== packet.rows.length) fail();
    if (summary.totalRows !== undefined && summary.totalRows < packet.rows.length) fail();
    if (
      summary.asOfKind !== undefined &&
      !["unknown", "market_session", "market_quote"].includes(summary.asOfKind)
    )
      fail();
    if (summary.interval !== undefined && summary.interval !== "1D") fail();
    if (summary.adapterRescaledValues !== undefined && summary.adapterRescaledValues !== false)
      fail();
    if (
      summary.sourceTime !== undefined &&
      !(summary.sourceTime === null || sourceTime(summary.sourceTime))
    )
      fail();
    if (
      summary.timezone !== undefined &&
      !["source_local_unspecified", "Asia/Ho_Chi_Minh"].includes(summary.timezone)
    )
      fail();
    if (
      summary.basis !== undefined &&
      ![
        "provider_quote_date_time",
        "provider_daily_session",
        "provider_profile_without_timestamp",
      ].includes(summary.basis)
    )
      fail();
    if (summary.volumeBasis !== undefined && summary.volumeBasis !== "matched_only") fail();
  }
  bounded(packet, MAX_MARKET_BYTES);
  return packet;
}

export function marketDirectoryUnavailable(
  code = "market_provider_unavailable",
  now = new Date().toISOString(),
) {
  return {
    schemaVersion: 1,
    provider: MARKET_PROVIDER,
    source: { ...MARKET_SOURCE },
    fetchedAt: now,
    status: "unavailable",
    items: [],
    coverage: MARKET_EXCHANGES.map((exchange) => ({
      exchange,
      status: "unavailable",
      expectedCount: null,
      receivedCount: 0,
    })),
    error: { code: errorCode(code) },
  };
}

export function validateMarketDirectory(directory) {
  const fail = () => {
    throw new DossierError("market_invalid_response", 502);
  };
  if (
    !closed(directory, [
      "schemaVersion",
      "provider",
      "source",
      "fetchedAt",
      "status",
      "items",
      "coverage",
      "cache",
      "error",
    ]) ||
    directory.schemaVersion !== 1 ||
    directory.provider !== MARKET_PROVIDER ||
    !sourceValid(directory.source) ||
    !timestamp(directory.fetchedAt) ||
    !["ready", "partial", "unavailable"].includes(directory.status) ||
    !Array.isArray(directory.items) ||
    directory.items.length > MAX_MARKET_DIRECTORY_ITEMS ||
    !Array.isArray(directory.coverage) ||
    directory.coverage.length !== MARKET_EXCHANGES.length ||
    !cacheValid(directory.cache) ||
    !errorValid(directory.error)
  )
    fail();
  const identities = new Set(),
    counts = Object.fromEntries(MARKET_EXCHANGES.map((exchange) => [exchange, 0]));
  for (const item of directory.items) {
    if (
      !closed(item, [
        "symbol",
        "name",
        "nameEn",
        "exchange",
        "securityType",
        "status",
        "isin",
        "listedDate",
        "companyId",
        "taxCode",
        "faceValue",
      ]) ||
      !symbol(item.symbol) ||
      !text(item.name, 600) ||
      !item.name.trim() ||
      !MARKET_EXCHANGES.includes(item.exchange) ||
      item.securityType !== "stock" ||
      item.status !== "listed"
    )
      fail();
    const identity = `${item.exchange}:${item.symbol}`;
    if (identities.has(identity)) fail();
    identities.add(identity);
    counts[item.exchange] += 1;
    for (const key of ["nameEn", "isin", "companyId", "taxCode"])
      if (
        item[key] !== undefined &&
        item[key] !== null &&
        !text(item[key], key === "nameEn" ? 600 : 100)
      )
        fail();
    if (item.listedDate !== undefined && item.listedDate !== null && !marketDate(item.listedDate))
      fail();
    if (
      item.faceValue !== undefined &&
      item.faceValue !== null &&
      (typeof item.faceValue !== "number" || !Number.isFinite(item.faceValue) || item.faceValue < 0)
    )
      fail();
  }
  const covered = new Set();
  for (const coverage of directory.coverage) {
    if (
      !closed(coverage, ["exchange", "status", "expectedCount", "receivedCount"]) ||
      !MARKET_EXCHANGES.includes(coverage.exchange) ||
      covered.has(coverage.exchange) ||
      !["complete", "incomplete", "unavailable"].includes(coverage.status) ||
      !(
        coverage.expectedCount === null ||
        (Number.isSafeInteger(coverage.expectedCount) &&
          coverage.expectedCount >= 0 &&
          coverage.expectedCount <= MAX_MARKET_DIRECTORY_ITEMS)
      ) ||
      coverage.receivedCount !== counts[coverage.exchange]
    )
      fail();
    if (
      coverage.status === "complete" &&
      (coverage.expectedCount === null || coverage.expectedCount !== coverage.receivedCount)
    )
      fail();
    if (coverage.status === "unavailable" && coverage.receivedCount !== 0) fail();
    covered.add(coverage.exchange);
  }
  const complete = directory.coverage.every((coverage) => coverage.status === "complete");
  if (
    (directory.status === "ready" && !complete) ||
    (directory.status === "partial" && complete) ||
    (directory.status === "unavailable" &&
      (directory.items.length ||
        directory.coverage.some((coverage) => coverage.status !== "unavailable") ||
        !directory.error))
  )
    fail();
  bounded(directory, MAX_MARKET_DIRECTORY_BYTES);
  return directory;
}
