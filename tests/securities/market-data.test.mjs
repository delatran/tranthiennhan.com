import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MARKET_EXCHANGES,
  MAX_MARKET_DIRECTORY_BYTES,
  marketUnavailable,
  marketDirectoryUnavailable,
  validateMarketInput,
  validateMarketPacket,
  validateMarketDirectory,
} from "../../shared/securities/market-data.js";
import {
  createMarketDataProvider,
  fetchPublicMarket,
  fetchPublicMarketDirectory,
  publicMarketUrl,
  validatePublicMarketUrl,
} from "../../scripts/securities/market-data.mjs";
import { startSecuritiesIngestionService } from "../../scripts/securities/ingestion-service.mjs";
import { handleSecuritiesRequest } from "../../worker/securities/api.js";

// All provider fixtures are synthetic. This suite never requests a live market or model.
const INPUT = { symbol: "FIX", dataset: "history" };
const NOW = Date.parse("2026-09-07T02:45:00Z");
const TOKEN = "synthetic-market-fixture-local-token-only";
function packet(input = INPUT, at = NOW) {
  const exchange = input.exchange ?? "HOSE";
  const row =
    input.dataset === "company"
      ? { code: input.symbol, floor: exchange, vnName: "Synthetic company" }
      : input.dataset === "quote"
        ? { date: "2026-09-07", time: "09:32:00", close: 12.5, volume: 0 }
        : { time: "2026-09-04", close: 12.5, volume: 0 };
  const result = {
    ...marketUnavailable(input, "market_provider_unavailable", new Date(at).toISOString()),
    exchange,
    status: "ready",
    asOf: input.dataset === "company" ? null : input.dataset === "quote" ? row.date : row.time,
    units: { price: "unknown", volume: "unknown" },
    columns: Object.keys(row).map((key) => ({ key, label: key })),
    rows: [row],
  };
  delete result.error;
  return result;
}
function listing(code, floor, extra = {}) {
  return {
    code,
    floor,
    type: "STOCK",
    status: "listed",
    companyName: `Synthetic ${code}`,
    companyNameEng: `${code} fixture`,
    listedDate: "2020-01-01",
    delistedDate: "2010-01-01",
    faceValue: 0,
    isin: `VN${code}`,
    companyId: "fixture-id",
    taxCode: "0000000000",
    ...extra,
  };
}
function directory(at = NOW) {
  const result = marketDirectoryUnavailable(
    "market_provider_unavailable",
    new Date(at).toISOString(),
  );
  result.status = "ready";
  result.items = MARKET_EXCHANGES.map((exchange, index) => ({
    symbol: `FX${index}`,
    name: `Synthetic ${exchange}`,
    nameEn: null,
    exchange,
    securityType: "stock",
    status: "listed",
    isin: null,
    listedDate: null,
    companyId: null,
    taxCode: null,
    faceValue: 0,
  }));
  result.coverage = MARKET_EXCHANGES.map((exchange) => ({
    exchange,
    status: "complete",
    expectedCount: 1,
    receivedCount: 1,
  }));
  delete result.error;
  return result;
}
const response = (
  data,
  { size = 1, currentPage = 1, totalElements = data.length, ...extra } = {},
) =>
  new Response(
    JSON.stringify({
      data,
      currentPage,
      size,
      totalElements,
      totalPages: Math.ceil(totalElements / size),
      ...extra,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
const price = (extra = {}) => ({
  code: "FIX",
  floor: "HOSE",
  type: "STOCK",
  date: "2026-09-07",
  time: "09:32:00",
  open: 12,
  high: 13,
  low: 11,
  close: 12.5,
  basicPrice: 12,
  ceilingPrice: 13,
  floorPrice: 11,
  average: 12.4,
  nmVolume: 0,
  nmValue: 0,
  ptVolume: 30,
  ptValue: 375000,
  change: 0.5,
  pctChange: 4.1667,
  ...extra,
});
async function temporary(t) {
  const targetDirectory = await mkdtemp(path.join(tmpdir(), "securities-market-fixture-"));
  t.after(async () => {
    assert.ok(path.resolve(targetDirectory).startsWith(`${path.resolve(tmpdir())}${path.sep}`));
    await rm(targetDirectory, { recursive: true, force: true });
  });
  return targetDirectory;
}

test("public market input permits only three datasets and an optional exact exchange", () => {
  assert.deepEqual(validateMarketInput(INPUT), INPUT);
  assert.deepEqual(validateMarketInput({ ...INPUT, exchange: "UPCOM" }), {
    ...INPUT,
    exchange: "UPCOM",
  });
  for (const input of [
    null,
    [],
    { ...INPUT, tier: "guest" },
    { ...INPUT, url: "https://attacker.invalid" },
    { ...INPUT, symbol: "../FPT" },
    { ...INPUT, symbol: "FPT;echo" },
    { ...INPUT, dataset: "income_statement" },
    { ...INPUT, exchange: "UPCoM" },
    { ...INPUT, exchange: null },
    { ...INPUT, symbol: ["FPT"] },
  ]) {
    assert.throws(() => validateMarketInput(input), { code: "invalid_market_query" });
  }
});

test("fixed public URL families reject credentials, private hosts, unknown queries and duplicate parameters", () => {
  const allowed = publicMarketUrl("market", { symbol: "FIX", dataset: "quote" });
  assert.equal(validatePublicMarketUrl(allowed), allowed);
  for (const url of [
    allowed.replace("api-finfo.vndirect.com.vn", "127.0.0.1"),
    allowed.replace("https:", "http:"),
    allowed.replace("https://", "https://synthetic:secret@"),
    `${allowed}&token=synthetic`,
    `${allowed}&size=1`,
    `${allowed}#fragment`,
    allowed.replace("stock_prices", "company_ratios"),
    allowed.replace("code%3AFIX", "code%3AFIX~type%3AINDEX"),
  ]) {
    assert.throws(() => validatePublicMarketUrl(url), { code: "market_access_denied" });
  }
});

test("quote keeps source-local time and raw units, separates matched/put-through volume, and sends no credentials", async () => {
  let calls = 0;
  const input = { symbol: "FIX", dataset: "quote", exchange: "HOSE" };
  const result = await fetchPublicMarket(input, {
    now: () => NOW,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(new URL(url).pathname, "/v4/stock_prices");
      assert.deepEqual(options.headers, { Accept: "application/json" });
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "manual");
      return response([price({ average: null, nmValue: undefined })], { totalElements: 3408 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "ready");
  assert.equal(result.provider, "vndirect_public_web");
  assert.equal(result.exchange, "HOSE");
  assert.equal(result.asOf, "2026-09-07");
  assert.equal(result.rows[0].time, "09:32:00");
  assert.equal(result.summary.timezone, "source_local_unspecified");
  assert.equal(result.summary.volumeBasis, "matched_only");
  assert.equal(result.units.price, "unknown");
  assert.equal(result.units.volume, "unknown");
  assert.equal(result.summary.adapterRescaledValues, false);
  assert.equal(result.rows[0].volume, 0);
  assert.equal(result.rows[0].putThroughVolume, 30);
  assert.equal(result.rows[0].average, null);
  assert.equal(result.rows[0].matchedValue, null);
  assert.equal(result.summary.totalRows, 3408);
  assert.equal(result.summary.truncatedRows, 0);
});

test("history excludes today's mutable session using the Vietnam calendar and keeps prior bars in date order", async () => {
  const result = await fetchPublicMarket(INPUT, {
    now: () => Date.parse("2026-09-06T18:01:00Z"),
    fetchImpl: async () =>
      response(
        [
          price(),
          price({ date: "2026-09-04" }),
          price({ date: "2026-09-03", close: null, nmVolume: null }),
        ],
        { size: 300 },
      ),
  });
  assert.equal(result.status, "ready");
  assert.equal(result.summary.excludedCurrentSessionRows, 1);
  assert.deepEqual(
    result.rows.map((row) => row.time),
    ["2026-09-03", "2026-09-04"],
  );
  assert.equal(result.rows[0].close, null);
  assert.equal(result.rows[0].volume, null);
  assert.equal(result.rows[1].volume, 0);
  assert.equal(result.asOf, "2026-09-04");
  assert.equal(result.summary.asOfKind, "market_session");
});

test("company profiles retain missing values and zero counts without inventing an as-of date", async () => {
  const input = { symbol: "FIX", dataset: "company", exchange: "HNX" };
  const result = await fetchPublicMarket(input, {
    now: () => NOW,
    fetchImpl: async () =>
      response([
        {
          code: "FIX",
          floor: "HNX",
          vnName: "Synthetic",
          enName: null,
          foundDate: "2026-02-30",
          employees: 0,
          branches: undefined,
          vnSummary: "Synthetic profile",
          companyId: "0001",
        },
      ]),
  });
  assert.equal(result.status, "ready");
  assert.equal(result.asOf, null);
  assert.equal(result.summary.asOfKind, "unknown");
  assert.equal(result.rows[0].employees, 0);
  assert.equal(result.rows[0].branches, null);
  assert.equal(result.rows[0].foundDate, null);
  assert.equal(result.rows[0].vnSummary, "Synthetic profile");
});

test("incorrect ticker, exchange or security type cannot become a matching quote", async () => {
  for (const extra of [
    { code: "WRONG" },
    { floor: "HNX" },
    { type: "INDEX" },
    { date: "2026-02-30" },
    { date: "2026-09-08" },
  ]) {
    const result = await fetchPublicMarket(
      { symbol: "FIX", dataset: "quote", exchange: "HOSE" },
      { now: () => NOW, fetchImpl: async () => response([price(extra)]) },
    );
    assert.equal(result.status, "unavailable");
    assert.equal(result.error.code, "market_invalid_response");
  }
});

test("invalid numeric strings are null with a quality counter, not zero or guessed coercions", async () => {
  const result = await fetchPublicMarket(
    { symbol: "FIX", dataset: "quote" },
    {
      now: () => NOW,
      fetchImpl: async () => response([price({ close: "12.5", nmVolume: -1, ptVolume: 0 })]),
    },
  );
  assert.equal(result.rows[0].close, null);
  assert.equal(result.rows[0].volume, null);
  assert.equal(result.rows[0].putThroughVolume, 0);
  assert.equal(result.summary.invalidCells, 2);
});

test("conflicting duplicate daily bars fail instead of silently selecting a price", async () => {
  const result = await fetchPublicMarket(INPUT, {
    now: () => NOW,
    fetchImpl: async () =>
      response([price({ date: "2026-09-04" }), price({ date: "2026-09-04", close: 99 })], {
        size: 300,
      }),
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.error.code, "market_invalid_response");
});

test("only a counted empty source response produces an empty result", async () => {
  const input = { symbol: "FIX", dataset: "quote" };
  const empty = await fetchPublicMarket(input, {
    now: () => NOW,
    fetchImpl: async () => response([]),
  });
  assert.equal(empty.status, "empty");
  assert.equal(empty.asOf, null);
  const broken = await fetchPublicMarket(input, {
    now: () => NOW,
    fetchImpl: async () => response([], { totalElements: 1 }),
  });
  assert.equal(broken.status, "unavailable");
});

test("anonymous fetch refuses redirects, non-JSON, invalid UTF-8, malformed envelopes and oversized bodies", async () => {
  const input = { symbol: "FIX", dataset: "quote" };
  const factories = [
    () => new Response("", { status: 302, headers: { Location: "https://attacker.invalid/" } }),
    () => new Response("{}", { headers: { "Content-Type": "text/html" } }),
    () => new Response("{broken", { headers: { "Content-Type": "application/json" } }),
    () =>
      new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { "Content-Type": "application/json" },
      }),
    () => response([price()], { currentPage: 2 }),
    () =>
      new Response("{}", {
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(MAX_MARKET_DIRECTORY_BYTES + 1),
        },
      }),
    () =>
      new Response(" ".repeat(MAX_MARKET_DIRECTORY_BYTES + 1), {
        headers: { "Content-Type": "application/json" },
      }),
  ];
  for (const create of factories) {
    let calls = 0;
    const result = await fetchPublicMarket(input, {
      now: () => NOW,
      fetchImpl: async () => {
        calls++;
        return create();
      },
    });
    assert.equal(result.status, "unavailable");
    assert.equal(calls, 1);
  }
});

test("fetch timeout is bounded even when a transport ignores cancellation", async () => {
  const result = await fetchPublicMarket(INPUT, {
    now: () => NOW,
    timeoutMs: 15,
    fetchImpl: () => new Promise(() => {}),
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.error.code, "market_timeout");
});

function directoryFetch({
  duplicate = false,
  missingExchange = null,
  wrongFloor = false,
  omitContinuationTotals = false,
} = {}) {
  return async (url) => {
    const query = new URL(url).searchParams,
      exchange = query.get("q").split(":").at(-1),
      page = Number(query.get("page"));
    if (exchange === missingExchange) return new Response("", { status: 429 });
    const total = exchange === "HOSE" ? 501 : 1;
    const count = Math.min(500, total - (page - 1) * 500);
    const data = Array.from({ length: count }, (_, index) =>
      listing(
        exchange === "HOSE"
          ? `A${String(duplicate && page === 2 ? 0 : (page - 1) * 500 + index).padStart(4, "0")}`
          : exchange === "HNX"
            ? "HFX"
            : "UFX",
        wrongFloor && exchange === "HNX" ? "HOSE" : exchange,
      ),
    );
    if (omitContinuationTotals && page > 1)
      return new Response(JSON.stringify({ data, currentPage: page, size: 500 }), {
        headers: { "Content-Type": "application/json" },
      });
    return response(data, { size: 500, currentPage: page, totalElements: total });
  };
}

test("directory follows every counted page and includes only current listed stocks across all exchanges", async () => {
  const calls = [],
    receipts = [],
    fetchImpl = directoryFetch();
  const result = await fetchPublicMarketDirectory({
    now: () => NOW,
    onReceipt: (receipt) => receipts.push(receipt),
    fetchImpl: (url, options) => {
      calls.push(url);
      return fetchImpl(url, options);
    },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.items.length, 503);
  assert.equal(calls.length, 4);
  assert.equal(receipts.length, 4);
  assert.deepEqual(
    result.coverage.map((entry) => [
      entry.exchange,
      entry.expectedCount,
      entry.receivedCount,
      entry.status,
    ]),
    [
      ["HOSE", 501, 501, "complete"],
      ["HNX", 1, 1, "complete"],
      ["UPCOM", 1, 1, "complete"],
    ],
  );
  assert.equal(result.items[0].faceValue, 0);
  assert.equal(result.items[0].status, "listed");
  assert.match(receipts[0].sha256, /^[a-f0-9]{64}$/u);
});

test("duplicate pages, wrong exchanges and one failed exchange cannot masquerade as complete coverage", async () => {
  for (const options of [{ duplicate: true }, { wrongFloor: true }, { missingExchange: "HNX" }]) {
    const result = await fetchPublicMarketDirectory({
      now: () => NOW,
      fetchImpl: directoryFetch(options),
    });
    assert.equal(result.status, "partial");
    assert.ok(result.coverage.some((entry) => entry.status !== "complete"));
    assert.equal(validateMarketDirectory(result), result);
  }
});

test("continuation pages may omit totals only after a counted first page establishes exact coverage", async () => {
  const complete = await fetchPublicMarketDirectory({
    now: () => NOW,
    fetchImpl: directoryFetch({ omitContinuationTotals: true }),
  });
  assert.equal(complete.status, "ready");
  assert.equal(complete.items.length, 503);
  assert.deepEqual(complete.coverage[0], {
    exchange: "HOSE",
    status: "complete",
    expectedCount: 501,
    receivedCount: 501,
  });
  const missingFirstPageTotals = await fetchPublicMarketDirectory({
    now: () => NOW,
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: [], currentPage: 1, size: 500 }), {
        headers: { "Content-Type": "application/json" },
      }),
  });
  assert.equal(missingFirstPageTotals.status, "unavailable");
});

test("directory schema rejects false coverage counts, duplicate identities and obsolete provider snapshots", () => {
  assert.equal(validateMarketDirectory(directory()).items.length, 3);
  for (const broken of [
    { ...directory(), provider: "vnstock" },
    { ...directory(), status: "partial" },
    { ...directory(), items: [...directory().items, directory().items[0]] },
    {
      ...directory(),
      coverage: directory().coverage.map((entry, index) =>
        index === 0 ? { ...entry, expectedCount: 2 } : entry,
      ),
    },
    {
      ...directory(),
      items: directory().items.map((item, index) =>
        index === 0 ? { ...item, exchange: "UPCoM" } : item,
      ),
    },
  ]) {
    assert.throws(() => validateMarketDirectory(broken), { code: "market_invalid_response" });
  }
});

test("packet validation preserves zero and rejects mismatched identities, legacy packets and invalid values", () => {
  assert.equal(validateMarketPacket(packet(), INPUT).rows[0].volume, 0);
  for (const broken of [
    { ...packet(), symbol: "FPT" },
    { ...packet(), access: "guest" },
    { ...packet(), schemaVersion: 1, provider: "vnstock", providerVersion: "4.0.7" },
    { ...packet(), source: { name: "VNDIRECT Dstock", url: "https://attacker.invalid/" } },
    { ...packet(), fetchedAt: "tomorrow" },
    { ...packet(), units: [] },
    { ...packet(), rows: [{ time: "2026-09-04", close: Infinity, volume: 0 }] },
    { ...packet(), rows: [{ ...packet().rows[0], secret: "unexpected" }] },
    { ...packet(), columns: [...packet().columns, packet().columns[0]] },
    { ...packet(), summary: { asOfKind: "realtime" } },
    { ...packet(), summary: { adapterRescaledValues: true } },
    { ...packet(), error: { code: "market_timeout", message: "synthetic-debug" } },
    { ...packet(), status: "empty" },
  ]) {
    assert.throws(() => validateMarketPacket(broken, INPUT), { code: "market_invalid_response" });
  }
  assert.throws(() => validateMarketPacket(packet(), { ...INPUT, exchange: "HNX" }), {
    code: "market_invalid_response",
  });
});

test("cache write failure retains valid data, reports non-persistence, and removes temporary files", async (t) => {
  const targetDirectory = await temporary(t);
  let calls = 0;
  await mkdir(path.join(targetDirectory, "FIX-history.json"));
  const provider = await createMarketDataProvider({
    directory: targetDirectory,
    now: () => NOW,
    minIntervalMs: 0,
    run: async (input) => {
      calls++;
      return packet(input);
    },
  });
  const first = await provider.get(INPUT);
  assert.equal(first.status, "ready");
  assert.equal(first.cache.persisted, false);
  assert.equal((await provider.get(INPUT)).cache.persisted, false);
  assert.equal(calls, 1);
  assert.equal(
    (await readdir(targetDirectory)).some((name) => name.endsWith(".tmp")),
    false,
  );
  await provider.close();
});

test("concurrent identical reads share one request and a later provider uses the persistent snapshot", async (t) => {
  const targetDirectory = await temporary(t);
  let calls = 0,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const provider = await createMarketDataProvider({
    directory: targetDirectory,
    now: () => NOW,
    minIntervalMs: 0,
    run: async (input) => {
      calls++;
      await gate;
      return packet(input);
    },
  });
  const pending = Array.from({ length: 4 }, () => provider.get(INPUT));
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  await Promise.all(pending);
  assert.equal(calls, 1);
  assert.equal((await provider.get(INPUT)).cache.hit, true);
  await provider.close();
  const next = await createMarketDataProvider({
    directory: targetDirectory,
    now: () => NOW + 1000,
    run: () => assert.fail("persistent cache must not fetch"),
  });
  assert.equal((await next.get(INPUT)).rows[0].close, 12.5);
  await next.close();
  assert.equal(
    JSON.parse(await readFile(path.join(targetDirectory, "FIX-history.json"), "utf8")).access,
    "public",
  );
});

test("different symbols share bounded concurrency and request cooldown", async (t) => {
  const targetDirectory = await temporary(t),
    starts = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const provider = await createMarketDataProvider({
    directory: targetDirectory,
    minIntervalMs: 70,
    run: async (input) => {
      starts.push(Date.now());
      if (starts.length === 1) await gate;
      return packet(input, Date.now());
    },
  });
  const first = provider.get(INPUT);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal((await provider.get({ ...INPUT, symbol: "SYN" })).error.code, "market_busy");
  release();
  await first;
  await provider.get({ ...INPUT, symbol: "SYN" });
  assert.ok(starts[1] - starts[0] >= 60);
  await provider.close();
});

test("quote, history, company and directory use their explicit TTLs without automatic all-stock quotes", async (t) => {
  const targetDirectory = await temporary(t);
  let clock = NOW;
  const calls = [];
  const provider = await createMarketDataProvider({
    directory: targetDirectory,
    now: () => clock,
    minIntervalMs: 0,
    run: async (input) => {
      calls.push(input.dataset);
      return packet(input, clock);
    },
    runDirectory: async () => {
      calls.push("directory");
      return directory(clock);
    },
  });
  await provider.getDirectory();
  assert.deepEqual(calls, ["directory"]);
  for (const dataset of ["quote", "history", "company"])
    await provider.get({ symbol: "FIX", dataset });
  clock += 30_000;
  await provider.get({ symbol: "FIX", dataset: "quote" });
  await provider.get(INPUT);
  await provider.get({ symbol: "FIX", dataset: "company" });
  await provider.getDirectory();
  assert.deepEqual(calls, ["directory", "quote", "history", "company", "quote"]);
  clock = NOW + 15 * 60_000;
  await provider.get(INPUT);
  await provider.getDirectory();
  assert.deepEqual(calls.slice(-2), ["history", "directory"]);
  clock = NOW + 6 * 60 * 60_000;
  await provider.get({ symbol: "FIX", dataset: "company" });
  assert.equal(calls.at(-1), "company");
  await provider.close();
});

test("failed refresh keeps an old snapshot visibly stale and throttles retries", async (t) => {
  const targetDirectory = await temporary(t);
  let clock = NOW,
    calls = 0;
  const provider = await createMarketDataProvider({
    directory: targetDirectory,
    now: () => clock,
    minIntervalMs: 0,
    run: async (input) => {
      calls++;
      return calls === 1
        ? packet(input, clock)
        : marketUnavailable(input, "market_rate_limited", new Date(clock).toISOString());
    },
  });
  await provider.get(INPUT);
  clock += 16 * 60_000;
  const stale = await provider.get(INPUT);
  assert.equal(stale.cache.stale, true);
  assert.equal(stale.fetchedAt, new Date(NOW).toISOString());
  assert.equal(stale.error.code, "market_rate_limited");
  assert.equal(stale.status, "ready");
  assert.deepEqual((await provider.get(INPUT)).rows, stale.rows);
  assert.equal(calls, 2);
  clock += 8 * 24 * 60 * 60_000;
  assert.equal((await provider.get(INPUT)).status, "unavailable");
  await provider.close();
});

test("partial refresh preserves an old complete directory visibly stale and leaves the saved complete file intact", async (t) => {
  const targetDirectory = await temporary(t);
  let clock = NOW,
    calls = 0;
  const provider = await createMarketDataProvider({
    directory: targetDirectory,
    now: () => clock,
    minIntervalMs: 0,
    runDirectory: async () => {
      calls++;
      const result = directory(clock);
      if (calls > 1) {
        result.status = "partial";
        result.items = result.items.filter((item) => item.exchange !== "HNX");
        result.coverage[1] = {
          exchange: "HNX",
          status: "unavailable",
          expectedCount: null,
          receivedCount: 0,
        };
        result.error = { code: "market_incomplete_directory" };
      }
      return result;
    },
  });
  await provider.getDirectory();
  const original = await readFile(path.join(targetDirectory, "directory.json"), "utf8");
  clock += 16 * 60_000;
  const result = await provider.getDirectory();
  assert.equal(result.status, "ready");
  assert.equal(result.items.length, 3);
  assert.equal(result.cache.stale, true);
  assert.equal(result.fetchedAt, new Date(NOW).toISOString());
  assert.equal(result.error.code, "market_incomplete_directory");
  assert.equal(await readFile(path.join(targetDirectory, "directory.json"), "utf8"), original);
  await provider.close();
});

test("old vnstock and future-dated snapshots cannot serve as current public data", async (t) => {
  const targetDirectory = await temporary(t);
  let calls = 0;
  await writeFile(
    path.join(targetDirectory, "FIX-history.json"),
    JSON.stringify({
      ...packet(),
      schemaVersion: 1,
      provider: "vnstock",
      providerVersion: "4.0.7",
      access: "guest",
    }),
  );
  const provider = await createMarketDataProvider({
    directory: targetDirectory,
    now: () => NOW,
    minIntervalMs: 0,
    run: async (input) => {
      calls++;
      return packet(input);
    },
  });
  assert.equal((await provider.get(INPUT)).provider, "vndirect_public_web");
  assert.equal(calls, 1);
  await provider.close();
  await writeFile(
    path.join(targetDirectory, "FIX-history.json"),
    JSON.stringify(packet(INPUT, NOW + 60_000)),
  );
  const future = await createMarketDataProvider({
    directory: targetDirectory,
    now: () => NOW,
    minIntervalMs: 0,
    run: async (input) => marketUnavailable(input, "market_timeout", new Date(NOW).toISOString()),
  });
  assert.equal((await future.get(INPUT)).status, "unavailable");
  await future.close();
});

test("closing aborts the owned operation and cannot publish a late result", async (t) => {
  const targetDirectory = await temporary(t);
  let started, release;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const provider = await createMarketDataProvider({
    directory: targetDirectory,
    minIntervalMs: 0,
    run: async (input) => {
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
      return packet(input);
    },
  });
  const pending = provider.get(INPUT);
  await ready;
  await provider.close();
  release();
  assert.equal((await pending).error.code, "market_cancelled");
  await assert.rejects(readFile(path.join(targetDirectory, "FIX-history.json")), {
    code: "ENOENT",
  });
});

test("Worker-to-sidecar routes authenticate locally and preserve public market and directory identity", async (t) => {
  const targetDirectory = await temporary(t);
  let calls = 0;
  const service = await startSecuritiesIngestionService({
    token: TOKEN,
    directory: targetDirectory,
    collect: async () => ({ datasets: [] }),
    readMarket: async (input) => {
      calls++;
      return packet(input);
    },
    readMarketDirectory: async () => directory(),
  });
  t.after(() => service.close());
  const env = {
    SECURITIES_LOCAL_MODE: "true",
    SECURITIES_DB: {},
    SECURITIES_INGESTION_TOKEN: TOKEN,
    SECURITIES_INGESTION_URL: service.url,
  };
  const make = (query, headers = {}, runtime = env) =>
    handleSecuritiesRequest(
      new Request(`http://localhost:8788/api/securities/market${query}`, { headers }),
      runtime,
      {},
      { store: {} },
    );
  const reply = await make("?symbol=FIX&dataset=quote&exchange=HOSE");
  assert.equal(reply.status, 200);
  const body = await reply.json();
  assert.equal(body.data.provider, "vndirect_public_web");
  assert.equal(body.data.exchange, "HOSE");
  assert.equal(calls, 1);
  const catalog = await make("/directory");
  assert.equal(catalog.status, 200);
  assert.equal((await catalog.json()).data.items.length, 3);
  for (const query of [
    "?symbol=FIX&dataset=history&tier=guest",
    "?symbol=FIX&symbol=FPT&dataset=history",
    "?symbol=FIX&dataset=raw",
    "?dataset=history",
    "/directory?exchange=HOSE",
  ])
    assert.equal((await make(query)).status, 400);
  assert.equal(
    (await make("?symbol=FIX&dataset=history", { Origin: "https://attacker.invalid" })).status,
    403,
  );
  assert.equal(
    (await make("?symbol=FIX&dataset=history", {}, { ...env, SECURITIES_LOCAL_MODE: "false" }))
      .status,
    403,
  );
  assert.equal((await fetch(`${service.url}/market?symbol=FIX&dataset=history`)).status, 401);
  assert.equal(
    (
      await fetch(`${service.url}/market?symbol=FIX&dataset=history`, {
        headers: { Authorization: `Bearer ${TOKEN}`, Origin: service.url },
      })
    ).status,
    403,
  );
  assert.equal(calls, 1);
});
