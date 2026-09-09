import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const loader = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("../../", import.meta.url)),
  plugins: [react()],
  logLevel: "error",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});
after(async () => {
  await loader.close();
});
const {
  MarketWorkspace,
  MarketResults,
  PublicResearchResults,
  QuoteRefreshControls,
  historyChartPoints,
  marketHistory,
  marketErrorMessage,
  safeMarketUrl,
  marketUnit,
  marketPacketMatches,
  createMarketRequestController,
  createPublicResearchController,
} = await loader.ssrLoadModule("/src/securities/MarketWorkspace.jsx");
const {
  StockPicker,
  StockSelectionDetails,
  filterStocks,
  findProcessedCompany,
  createStockDirectoryStore,
  DIRECTORY_REFRESH_MS,
} = await loader.ssrLoadModule("/src/securities/StockPicker.jsx");
const { resolveStartSelection, stocksWithCatalogNames } = await loader.ssrLoadModule(
  "/src/securities/StartWorkspace.jsx",
);
const { investorCopy, investorQuestion, researchMode, INVESTOR_INTENTS } =
  await loader.ssrLoadModule("/src/securities/investor/investorIntents.js");
const { parseWatchlist, savedStock, toggleWatchedStock, persistWatchlist, WATCHLIST_STORAGE_KEY } =
  await loader.ssrLoadModule("/src/securities/investor/watchlist.js");
const { startQuoteRefresh, QUOTE_REFRESH_MS } = await loader.ssrLoadModule(
  "/src/securities/investor/marketRequests.js",
);
const { publicResearchKey } = await loader.ssrLoadModule(
  "/src/securities/investor/publicResearch.js",
);
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const renderPacket = (packet, locale = "en") => render(MarketResults, { packet, locale });

// Synthetic data and injected clients only. This suite performs no market or model calls.
function fixture(overrides = {}) {
  return {
    schemaVersion: 2,
    provider: "vndirect_public_web",
    access: "public",
    symbol: "FPT",
    exchange: "HOSE",
    dataset: "history",
    source: { name: "VNDIRECT Dstock", url: "https://dstock.vndirect.com.vn/" },
    fetchedAt: "2026-09-07T03:00:00.000Z",
    asOf: "2026-09-04",
    status: "ready",
    columns: [
      { key: "time", label: "Time" },
      { key: "close", label: "Close", unit: "unknown" },
      { key: "volume", label: "Volume", unit: "unknown" },
    ],
    rows: [
      { time: "2026-09-03", open: 101, high: 102, low: 99, close: 100.25, volume: 5000 },
      { time: "2026-09-04", open: 100.25, high: 101, low: 99, close: 100.5, volume: 0 },
    ],
    units: { price: "unknown", volume: "unknown" },
    summary: { asOfKind: "market_session", excludedCurrentSessionRows: 1 },
    ...overrides,
  };
}
const stock = (symbol, exchange, extra = {}) => ({
  symbol,
  exchange,
  name: "Synthetic " + symbol,
  nameEn: symbol + " company",
  securityType: "stock",
  status: "listed",
  ...extra,
});
function directory(items = [stock("FPT", "HOSE"), stock("SHS", "HNX"), stock("ACV", "UPCOM")]) {
  return {
    schemaVersion: 1,
    provider: "vndirect_public_web",
    source: { name: "VNDIRECT Dstock", url: "https://dstock.vndirect.com.vn/" },
    fetchedAt: "2026-09-07T03:00:00Z",
    status: "ready",
    items,
    coverage: ["HOSE", "HNX", "UPCOM"].map((exchange) => ({
      exchange,
      status: "complete",
      expectedCount: items.filter((item) => item.exchange === exchange).length,
      receivedCount: items.filter((item) => item.exchange === exchange).length,
    })),
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("market starts collapsed in both languages, with no form, data rows or research side effect", () => {
  for (const [locale, title] of [
    ["vi", "Tra cứu thị trường"],
    ["en", "Market research"],
  ]) {
    const html = render(MarketWorkspace, {
      defaultSymbol: "FPT",
      defaultExchange: "HOSE",
      locale,
      modelEnabled: true,
    });
    assert.ok(html.includes(title));
    assert.match(html, /^<details class="ns-market"><summary>/u);
    assert.ok(!html.includes("<form") && !html.includes("<table") && !html.includes('open=""'));
    assert.ok(!/vnstock|SDK|Guest|Realtime/u.test(html));
  }
});

test("the quote is a last-price snapshot with raw source clock and separate matched volume", () => {
  const packet = fixture({
    dataset: "quote",
    asOf: "2026-09-04",
    columns: [
      { key: "close", label: "close", unit: "unknown" },
      { key: "volume", label: "volume", unit: "unknown" },
      { key: "putThroughVolume", label: "putThroughVolume", unit: "unknown" },
    ],
    rows: [
      {
        date: "2026-09-04",
        time: "09:32:04",
        close: 12.5,
        open: 12,
        high: 13,
        low: 11,
        volume: 0,
        putThroughVolume: 30,
      },
    ],
    summary: {
      asOfKind: "market_quote",
      sourceTime: "09:32:04",
      timezone: "source_local_unspecified",
      volumeBasis: "matched_only",
    },
  });
  const before = JSON.stringify(packet),
    html = renderPacket(packet);
  assert.ok(html.includes("Last price") && !html.includes("<dt>Close</dt>"));
  assert.ok(!html.includes("VNDIRECT Dstock") && !html.includes("dstock.vndirect.com.vn"));
  assert.ok(html.includes("Latest price snapshot; the source delay is unverified."));
  assert.ok(
    html.includes("Source time: 09:32:04") && html.includes("source timezone is unspecified"),
  );
  assert.ok(
    html.includes("Source data date: 04/09/2026") && html.includes("Source retrieved: 07/09/2026"),
  );
  assert.match(html, /<dt>Matched volume<\/dt><dd>0<\/dd>/u);
  assert.ok(html.includes("Put-through volume") && html.includes("30"));
  assert.ok(html.includes("12.5") && !html.includes("12,500") && !html.includes("VND thousand"));
  assert.equal(JSON.stringify(packet), before);
  const vi = renderPacket(packet, "vi");
  assert.ok(
    vi.includes("Giá gần nhất") &&
      vi.includes("Khối lượng khớp lệnh") &&
      vi.includes("chưa xác minh độ trễ"),
  );
});

test("history uses completed prior sessions without rescaling values or assigning unknown units", () => {
  const packet = fixture(),
    before = JSON.stringify(packet),
    html = renderPacket(packet);
  assert.ok(
    html.includes("Completed prior sessions") && html.includes("current calendar day is excluded"),
  );
  assert.ok(
    html.includes("100.5") &&
      !html.includes("100,500") &&
      html.includes("Not specified by the source"),
  );
  assert.match(html, /<dt>Matched volume<\/dt><dd>0<\/dd>/u);
  assert.ok(html.includes('role="img"') && html.includes('scope="col"'));
  assert.equal(JSON.stringify(packet), before);
  const known = renderPacket(fixture({ units: { price: "thousand_vnd", volume: "shares" } }));
  assert.ok(
    known.includes("VND thousand") && known.includes("shares") && !known.includes("100,500"),
  );
});

test("the history chart sorts sessions and handles flat, single, zero and missing values", () => {
  const unsorted = [
      { time: "2026-09-04", close: 0 },
      { time: "2026-09-03", close: 0 },
    ],
    before = JSON.stringify(unsorted);
  assert.deepEqual(historyChartPoints(unsorted).points, [
    { x: 12, y: 72 },
    { x: 588, y: 72 },
  ]);
  assert.equal(historyChartPoints(unsorted).values[0].time, "2026-09-03");
  assert.equal(JSON.stringify(unsorted), before);
  assert.deepEqual(historyChartPoints([{ time: "2026-09-03", close: 20 }]).points, [
    { x: 300, y: 72 },
  ]);
  assert.equal(
    historyChartPoints([
      { time: "not-a-date", close: 100 },
      { time: "2026-09-03", close: null },
    ]),
    null,
  );
  assert.equal(marketHistory([{ time: "bad", close: 100 }]).length, 0);
  assert.ok(!/NaN|Infinity/u.test(renderPacket(fixture({ rows: unsorted }))));
  assert.ok(
    renderPacket(fixture({ rows: [{ time: "2026-09-03", close: 0 }] })).includes("<circle"),
  );
});

test("company data is a vertical field list with missing values, zero counts and unmodified identifiers", () => {
  const packet = fixture({
    dataset: "company",
    asOf: null,
    columns: [
      { key: "vnName" },
      { key: "enName" },
      { key: "employees" },
      { key: "branches" },
      { key: "companyId" },
      { key: "website" },
      { key: "vnSummary" },
    ],
    rows: [
      {
        vnName: "Tên <script>không thực thi</script>",
        enName: null,
        employees: 0,
        branches: null,
        companyId: "000123",
        website: "https://example.com/issuer",
        vnSummary: "Synthetic overview. ".repeat(25),
      },
    ],
    summary: { asOfKind: "unknown" },
  });
  const html = renderPacket(packet);
  assert.ok(html.includes('class="ns-market-profile"') && !html.includes("<table"));
  assert.match(html, /<dt>Employees<\/dt><dd>0<\/dd>/u);
  assert.ok(
    html.includes("000123") &&
      html.includes("Not provided") &&
      html.includes("did not provide an effective date"),
  );
  assert.ok(html.includes('class="ns-market-long-text"') && html.includes("Read content"));
  assert.ok(!html.includes("<script>") && html.includes("&lt;script&gt;"));
  assert.ok(
    html.includes('href="https://example.com/issuer"') &&
      html.includes('rel="noopener noreferrer"'),
  );
  const vi = renderPacket(packet, "vi");
  assert.ok(
    vi.includes("Nhân viên") && vi.includes("Chưa có dữ liệu") && vi.includes("Tên tiếng Việt"),
  );
});

test("reference links allow only credential-free HTTPS", () => {
  for (const value of [
    "javascript:alert(1)",
    "http://example.com",
    "//example.com",
    "https://user:password@example.com",
    "https://exa\nmple.com",
    "data:text/html,test",
  ])
    assert.equal(safeMarketUrl(value), null);
  assert.equal(
    safeMarketUrl("https://example.com/news?q=a%20b"),
    "https://example.com/news?q=a%20b",
  );
  const html = renderPacket(
    fixture({ source: { name: "Synthetic", url: "https://user:password@example.com" } }),
  );
  assert.ok(!html.includes('href="https://user:'));
});

test("stale and unsaved snapshots keep their source date and disclose both limits in each language", () => {
  const packet = fixture({
    cache: { hit: true, stale: true, persisted: false },
    error: { code: "market_rate_limited" },
  });
  for (const locale of ["en", "vi"]) {
    const html = renderPacket(packet, locale);
    assert.ok(
      html.includes(locale === "vi" ? "Đang dùng bản đã lưu" : "Using a previous snapshot"),
    );
    assert.ok(
      html.includes(
        locale === "vi" ? "Dữ liệu chưa lưu được trên máy" : "could not be saved locally",
      ),
    );
    assert.ok(html.includes("04/09/2026") && html.includes("07/09/2026"));
    assert.ok(!html.includes("The source is limiting requests"));
  }
});

test("unavailable and empty responses cannot display invented zero prices or intraday claims", () => {
  const unavailable = renderPacket(
    fixture({
      dataset: "quote",
      status: "unavailable",
      asOf: null,
      rows: [],
      error: { code: "market_timeout", message: "Private traceback" },
    }),
  );
  assert.ok(unavailable.includes("took too long") && !unavailable.includes("Private traceback"));
  assert.ok(
    !unavailable.includes('class="ns-market-quotes"') &&
      !unavailable.includes("Latest price snapshot"),
  );
  const empty = renderPacket(fixture({ status: "empty", rows: [], asOf: null }));
  assert.ok(empty.includes("The source has no data") && !empty.includes("<svg viewBox"));
  assert.ok(
    marketErrorMessage({ code: "unknown", message: "secret" }, "vi").includes("nguồn công khai"),
  );
});

test("unit and quality labels remain explicit without coercing arbitrary metadata", () => {
  assert.equal(marketUnit("people", "en"), "people");
  assert.equal(marketUnit("count", "en"), "count");
  assert.equal(marketUnit({ amount: "VND" }, "en"), "Not specified by the source");
  const html = renderPacket(
    fixture({ summary: { invalidCells: 2, invalidRows: 1, conflictingDates: 1 } }),
  );
  assert.ok(
    html.includes("invalid cells or rows were omitted") && html.includes("conflicting data"),
  );
  assert.ok(!html.includes("[object Object]"));
});

test("market responses must match the exact selected symbol, exchange, dataset and public contract", () => {
  const input = { symbol: "FPT", exchange: "HOSE", dataset: "history" },
    packet = fixture();
  assert.equal(marketPacketMatches(packet, input), true);
  for (const change of [
    { symbol: "ACV" },
    { exchange: "HNX" },
    { dataset: "company" },
    { provider: "vnstock" },
    { access: "guest" },
    { schemaVersion: 1 },
  ])
    assert.equal(marketPacketMatches({ ...packet, ...change }, input), false);
  assert.equal(marketPacketMatches({ ...packet, status: "unavailable", rows: [] }, input), true);
  assert.equal(
    marketPacketMatches({ ...packet, exchange: undefined, request: { exchange: "HOSE" } }, input),
    false,
  );
});

test("market requests include exchange and cancel stale stock responses even if transport ignores abort", async () => {
  const pending = [],
    states = [],
    calls = [];
  const task = createMarketRequestController({
    client: {
      request(path, options) {
        const item = deferred();
        pending.push(item);
        calls.push({ path, options });
        return item.promise;
      },
    },
    onState: (state) => states.push(state),
  });
  assert.equal(calls.length, 0);
  const old = task.load({ symbol: "FPT", exchange: "HOSE", dataset: "quote" });
  const latest = task.load({ symbol: "ACV", exchange: "UPCOM", dataset: "quote" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.signal.aborted, true);
  const params = new URL(calls[1].path, "https://test.invalid").searchParams;
  assert.equal(params.get("exchange"), "UPCOM");
  assert.equal(params.get("symbol"), "ACV");
  assert.equal(params.get("dataset"), "quote");
  pending[0].resolve(fixture({ dataset: "quote" }));
  await old;
  assert.equal(states.filter((state) => state.status === "ready").length, 0);
  pending[1].resolve(fixture({ symbol: "ACV", exchange: "UPCOM", dataset: "quote" }));
  await latest;
  assert.equal(states.at(-1).identity, "UPCOM:ACV:quote");
  assert.equal(states.at(-1).packet.symbol, "ACV");
  assert.equal(task.isPending(), false);
});

test("closing a market task aborts its request and mismatched returned exchanges stay hidden", async () => {
  const pending = deferred(),
    states = [];
  let signal;
  const task = createMarketRequestController({
    client: {
      request(_path, options) {
        signal = options.signal;
        return pending.promise;
      },
    },
    onState: (state) => states.push(state),
  });
  const loading = task.load({ symbol: "FPT", exchange: "HOSE", dataset: "history" });
  task.cancel();
  assert.equal(signal.aborted, true);
  pending.resolve(fixture());
  await loading;
  assert.equal(states.length, 1);
  assert.equal(states[0].status, "loading");
  const bad = createMarketRequestController({
    client: {
      async request() {
        return fixture({ exchange: "HNX" });
      },
    },
    onState: (state) => states.push(state),
  });
  await bad.load({ symbol: "FPT", exchange: "HOSE", dataset: "history" });
  assert.equal(states.at(-1).status, "error");
  assert.equal(states.at(-1).packet, undefined);
});

test("the public research controller sends one explicit request using the current stock and question", async () => {
  const calls = [],
    states = [],
    security = stock("SHS", "HNX");
  const task = createPublicResearchController({
    client: {
      async request(path, options) {
        calls.push({ path, options });
        return {
          symbol: "SHS",
          exchange: "HNX",
          status: "partial",
          sources: [],
          fetchedAt: "2026-09-07T03:00:00Z",
        };
      },
    },
    onState: (state) => states.push(state),
  });
  assert.equal(calls.length, 0);
  await task.search({ security, query: "  Current question about SHS  ", locale: "en" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/market/research");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.body, {
    symbol: "SHS",
    exchange: "HNX",
    query: "Current question about SHS",
    locale: "en",
  });
  assert.equal(states.at(-1).result.symbol, "SHS");
  assert.equal(states.at(-1).identity, "HNX:SHS");
  assert.ok(!calls.some((call) => /scope|dossier|analyze/u.test(call.path)));
});

test("a changed stock or cancellation rejects a late AI result and a mismatched result is an error", async () => {
  const pending = [],
    states = [],
    signals = [];
  const task = createPublicResearchController({
    client: {
      request(_path, options) {
        const item = deferred();
        pending.push(item);
        signals.push(options.signal);
        return item.promise;
      },
    },
    onState: (state) => states.push(state),
  });
  const first = task.search({
    security: stock("SHS", "HNX"),
    query: "Original question",
    locale: "vi",
  });
  task.cancel();
  assert.equal(signals[0].aborted, true);
  const second = task.search({
    security: stock("ACV", "UPCOM"),
    query: "Original question",
    locale: "vi",
  });
  pending[0].resolve({ symbol: "SHS", exchange: "HNX", sources: [], status: "ready" });
  await first;
  assert.equal(states.filter((state) => state.status === "ready").length, 0);
  pending[1].resolve({ symbol: "ACV", exchange: "HOSE", sources: [], status: "ready" });
  await second;
  assert.equal(states.at(-1).status, "error");
  assert.equal(states.at(-1).result, null);
});

test("public source excerpts show partial and unavailable readings without becoming verified financial evidence", () => {
  const result = {
    symbol: "SHS",
    exchange: "HNX",
    status: "partial",
    fetchedAt: "2026-09-07T03:00:00Z",
    sources: [
      {
        url: "https://example.com/report",
        title: "Synthetic report",
        readStatus: "partial",
        excerpt: "",
        limitations: ["The proposed excerpt was not present in fetched text."],
      },
      {
        url: "javascript:alert(1)",
        title: "<script>Untrusted title</script>",
        readStatus: "unavailable",
        excerpt: "",
        limitations: [],
      },
    ],
    limitations: ["Some sources could not be read."],
  };
  const html = render(PublicResearchResults, {
    research: { status: "ready", result },
    locale: "en",
  });
  assert.ok(
    html.includes("The source reading is incomplete") &&
      html.includes("Partially read") &&
      html.includes("Content unavailable"),
  );
  assert.ok(html.includes("not create an analysis dossier or verify financial statement figures"));
  assert.ok(
    html.includes("proposed excerpt was not present") &&
      html.includes('href="https://example.com/report"'),
  );
  assert.ok(
    !html.includes("<script>") &&
      !html.includes('href="javascript:') &&
      html.includes("&lt;script&gt;"),
  );
  assert.ok(!html.includes('class="ns-market-news-summary"'));
});

test("the stock picker searches Vietnamese and English names without accents and filters all three exchanges", () => {
  const items = [
    stock("FPT", "HOSE", { name: "Công ty Cổ phần FPT" }),
    stock("SHS", "HNX", { name: "Chứng khoán Sài Gòn Hà Nội" }),
    stock("ACV", "UPCOM", {
      name: "Tổng công ty Cảng hàng không Việt Nam",
      nameEn: "Airports Corporation of Vietnam",
    }),
    stock("POW", "HOSE", { name: "Điện lực Dầu khí" }),
    stock("FAKE", "HOSE", { securityType: "warrant" }),
    stock("OLD", "HNX", { status: "delisted" }),
  ];
  const before = JSON.stringify(items);
  assert.deepEqual(
    filterStocks(items, "dien luc").map((item) => item.symbol),
    ["POW"],
  );
  assert.deepEqual(
    filterStocks(items, "chung khoan").map((item) => item.symbol),
    ["SHS"],
  );
  assert.deepEqual(
    filterStocks(items, "airports").map((item) => item.symbol),
    ["ACV"],
  );
  assert.deepEqual(
    filterStocks(items, "", "UPCOM").map((item) => item.symbol),
    ["ACV"],
  );
  assert.deepEqual(
    filterStocks(items, "fpt").map((item) => item.symbol),
    ["FPT"],
  );
  assert.equal(filterStocks(items).length, 4);
  assert.equal(JSON.stringify(items), before);
});

test("stock selection and details retain the exact name, exchange and identifiers", () => {
  const selected = stock("ACV", "UPCOM", {
    name: "Tổng công ty Cảng hàng không Việt Nam",
    isin: "VN000000ACV0",
    listedDate: "2016-11-21",
    taxCode: "0000000123",
  });
  const html = render(StockPicker, {
    selected,
    directory: { packet: directory() },
    locale: "vi",
    onSelect() {
      throw new Error("SSR must not select");
    },
  });
  assert.ok(
    html.includes('aria-haspopup="dialog"') &&
      html.includes('aria-expanded="false"') &&
      html.includes("ACV") &&
      html.includes("UPCoM"),
  );
  assert.ok(!html.includes("VNDIRECT Dstock") && !html.includes("dstock.vndirect.com.vn"));
  const details = render(StockSelectionDetails, { stock: selected, locale: "vi" });
  assert.ok(
    details.includes(selected.name) &&
      details.includes("VN000000ACV0") &&
      details.includes("0000000123") &&
      details.includes("2016-11-21"),
  );
});

test("start picker searches catalog names for the exact ticker and exchange without changing provider data", () => {
  const company = {
    id: "GMD",
    ticker: "GMD",
    exchange: "HOSE",
    legalName: "Công ty Cổ phần Tập đoàn Gemadept",
    name: "Gemadept Corporation",
  };
  const packet = directory([
    stock("GMD", "HOSE", {
      name: "Công Ty TNHH Vận Tải Và Công Nghiệp Hàng Hải Gemadept Holding",
      nameEn: "Gemadept Holding",
      isin: "VN000000GMD0",
      listedDate: "2002-04-22",
      taxCode: "synthetic-provider-tax-code",
      source: { rowId: "provider-record-1" },
    }),
    stock("GMD", "HNX", { name: "Different-exchange provider name" }),
    stock("ACB", "HOSE"),
  ]);
  const before = structuredClone(packet);
  const named = stocksWithCatalogNames(packet.items, [company]);
  assert.equal(filterStocks(named, "GMD", "HOSE")[0].name, company.legalName);
  assert.equal(filterStocks(named, "cong ty co phan tap doan gemadept")[0].symbol, "GMD");
  assert.equal(filterStocks(named, "Gemadept Corporation")[0].nameEn, company.name);
  assert.equal(filterStocks(named, "Gemadept Holding", "HOSE").length, 0);
  assert.deepEqual(named[0], {
    ...before.items[0],
    name: company.legalName,
    nameEn: company.name,
  });
  assert.equal(
    named[1],
    packet.items[1],
    "A same-ticker listing on another exchange stays unchanged.",
  );
  assert.equal(named[2], packet.items[2], "Companies outside the catalog keep provider identity.");
  assert.deepEqual(
    named.map(({ symbol, exchange }) => [symbol, exchange]),
    packet.items.map(({ symbol, exchange }) => [symbol, exchange]),
  );
  assert.deepEqual(packet, before);
});

test("saved watchlist names can use the catalog without rewriting saved entries", () => {
  const saved = [{ symbol: "GMD", exchange: "HOSE", name: "Previous saved name" }];
  const company = {
    id: "GMD",
    ticker: "GMD",
    exchange: "HOSE",
    legalName: "Công ty Cổ phần Tập đoàn Gemadept",
    name: "Gemadept Corporation",
  };
  const before = structuredClone(saved);
  const named = stocksWithCatalogNames(saved, [company]);
  assert.equal(named[0].name, company.legalName);
  assert.equal(named[0].nameEn, company.name);
  assert.deepEqual(saved, before);
  assert.equal(Object.hasOwn(named[0], "securityType"), false);
  assert.equal(Object.hasOwn(named[0], "status"), false);
});

test("directory loading deduplicates initial consumers and refreshes after fifteen minutes", async () => {
  const pending = [],
    snapshots = [];
  let time = 0,
    calls = 0;
  const store = createStockDirectoryStore(
    {
      request(path) {
        assert.equal(path, "/market/directory");
        calls++;
        const item = deferred();
        pending.push(item);
        return item.promise;
      },
    },
    () => time,
  );
  const unsubscribe = store.subscribe(() => snapshots.push(store.getSnapshot()));
  const first = store.ensure(),
    second = store.ensure();
  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(store.getSnapshot().loading, true);
  pending[0].resolve(directory());
  await first;
  assert.equal(store.getSnapshot().packet.items.length, 3);
  assert.equal(store.getSnapshot().loading, false);
  time = DIRECTORY_REFRESH_MS - 1;
  await store.ensure();
  assert.equal(calls, 1);
  time = DIRECTORY_REFRESH_MS;
  const refresh = store.ensure();
  assert.equal(calls, 2);
  pending[1].resolve(directory());
  await refresh;
  unsubscribe();
  assert.ok(snapshots.length >= 4);
});

test("failed directory refresh preserves a previously loaded catalogue with an explicit error", async () => {
  let calls = 0;
  const saved = directory();
  const store = createStockDirectoryStore({
    async request() {
      calls++;
      if (calls === 1) return saved;
      throw new Error("Synthetic offline condition");
    },
  });
  await store.ensure();
  await store.refresh();
  assert.equal(store.getSnapshot().packet, saved);
  assert.equal(store.getSnapshot().error, "unavailable");
  assert.equal(store.getSnapshot().loading, false);
  assert.equal(calls, 2);
});

test("a new research desk keeps ACB in public mode when its report data is unavailable", () => {
  const selected = resolveStartSelection(
    {
      catalog: {
        defaultCompanyId: "FPT",
        companies: [
          {
            id: "FPT",
            ticker: "FPT",
            exchange: "HOSE",
            periods: [{ id: "H1_2026" }],
          },
        ],
      },
    },
    null,
  );
  assert.equal(selected.stock.symbol, "ACB");
  assert.equal(selected.stock.exchange, "HOSE");
  assert.equal(selected.company, null);
  assert.equal(selected.period, null);
  assert.equal(selected.selection, null);
});

test("available ACB report data binds the default stock to its own banking sector and periods", () => {
  const comparison = { id: "H1_2025", label: "H1 2025" };
  const company = {
    id: "ACB",
    ticker: "ACB",
    exchange: "HOSE",
    sectorId: "banking",
    periods: [{ id: "H1_2026", comparisonOptions: [comparison] }],
  };
  const selected = resolveStartSelection(
    {
      catalog: {
        defaultCompanyId: "FPT",
        defaultPeriodId: "H1_2026",
        companies: [
          { id: "FPT", ticker: "FPT", exchange: "HOSE", periods: [{ id: "FY_2025" }] },
          company,
        ],
      },
    },
    null,
  );
  assert.equal(selected.stock.symbol, "ACB");
  assert.equal(selected.company, company);
  assert.equal(selected.company.sectorId, "banking");
  assert.deepEqual(selected.selection, {
    companyId: "ACB",
    periodId: "H1_2026",
    comparisonPeriodId: "H1_2025",
  });
  assert.equal(researchMode("earnings", selected.company), "report");
  assert.equal(researchMode("disclosures", selected.company), "public");
});

test("outside-catalogue selections never fall back to FPT/GMD or keep their processed periods", () => {
  const state = {
    researchDraft: {
      query: "Preserved question",
      defaultScope: { companyId: "FPT", periodId: "OLD" },
    },
    scope: { companyId: "FPT", periodId: "OLD" },
    catalog: {
      defaultCompanyId: "FPT",
      defaultPeriodId: "NEW",
      companies: [
        {
          id: "FPT",
          ticker: "FPT",
          exchange: "HOSE",
          name: "FPT",
          periods: [{ id: "NEW", comparisonOptions: [{ id: "PRIOR" }] }, { id: "OLD" }],
        },
        { id: "GMD", ticker: "GMD", exchange: "HOSE", name: "GMD", periods: [{ id: "GMD_NEW" }] },
      ],
    },
  };
  const before = JSON.stringify(state);
  assert.equal(resolveStartSelection(state, null).period.id, "OLD");
  for (const explicit of [stock("SHS", "HNX"), stock("ACV", "UPCOM"), stock("FPT", "HNX")]) {
    const selected = resolveStartSelection(state, explicit, {
      periodId: "OLD",
      comparisonId: "PRIOR",
    });
    assert.equal(selected.stock, explicit);
    assert.equal(selected.company, null);
    assert.equal(selected.period, null);
    assert.deepEqual(selected.periods, []);
    assert.deepEqual(selected.comparisons, []);
    assert.equal(selected.selection, null);
    assert.equal(findProcessedCompany(state.catalog.companies, explicit), null);
  }
  const supported = resolveStartSelection(state, stock("GMD", "HOSE"));
  assert.equal(supported.company.id, "GMD");
  assert.equal(supported.period.id, "GMD_NEW");
  assert.equal(JSON.stringify(state), before);
});

test("investor questions follow the chosen ticker and report periods without leaking a previous company", () => {
  const first = stock("SHS", "HNX"),
    next = stock("ACV", "UPCOM");
  const period = { id: "CURRENT", label: { vi: "Quý 2/2026", en: "Q2 2026" } };
  const comparison = { id: "PRIOR", label: { vi: "Quý 2/2025", en: "Q2 2025" } };
  for (const locale of ["vi", "en"])
    for (const intent of INVESTOR_INTENTS) {
      const firstQuestion = investorQuestion({
        intent,
        stock: first,
        period,
        comparison,
        locale,
        mode: "public",
      });
      const nextQuestion = investorQuestion({
        intent,
        stock: next,
        period,
        comparison,
        locale,
        mode: "public",
      });
      assert.ok(firstQuestion.includes("SHS") && !firstQuestion.includes("ACV"));
      assert.ok(nextQuestion.includes("ACV") && !nextQuestion.includes("SHS"));
      assert.ok(
        !/FPT|GMD|2026|2025/u.test(nextQuestion),
        "Public research cannot inherit another company's processed reporting period",
      );
    }
  const current = investorQuestion({
    intent: "earnings",
    stock: first,
    period,
    comparison,
    locale: "en",
    mode: "report",
  });
  assert.ok(current.includes("SHS") && current.includes("Q2 2026") && current.includes("Q2 2025"));
  const changed = investorQuestion({
    intent: "earnings",
    stock: first,
    period: { label: "Q3 2026" },
    comparison: { label: "Q3 2025" },
    locale: "en",
    mode: "report",
  });
  assert.ok(changed.includes("Q3 2026") && changed.includes("Q3 2025") && !changed.includes("Q2"));
  assert.equal(investorQuestion({ stock: null }), "");
  assert.equal(researchMode("earnings", { id: "SHS" }), "report");
  assert.equal(researchMode("disclosures", { id: "SHS" }), "public");
  assert.equal(researchMode("business", null), "public");
});

test("banking questions and intent labels use income and provisions without inferring sector from a ticker", () => {
  const period = { id: "H1_2026", label: "H1 2026" };
  const comparison = { id: "H1_2025", label: "H1 2025" };
  for (const locale of ["vi", "en"]) {
    const expected =
      locale === "vi"
        ? {
            title: "Lợi nhuận & dự phòng",
            income: "thu nhập lãi thuần",
            provision: "dự phòng",
            generic: "dòng tiền kinh doanh",
          }
        : {
            title: "Profit & provisions",
            income: "net interest income",
            provision: "provisions",
            generic: "operating cash flow",
          };
    assert.equal(investorCopy(locale, "banking").intents.earnings.title, expected.title);
    assert.notEqual(investorCopy(locale).intents.earnings.title, expected.title);
    for (const symbol of ["ACB", "BNK"]) {
      const input = {
        stock: stock(symbol, "HOSE"),
        period,
        comparison,
        locale,
        sectorId: "banking",
      };
      for (const intent of ["business", "earnings"]) {
        const report = investorQuestion({ ...input, intent, mode: "report" });
        assert.ok(
          report.includes(symbol) && report.includes("H1 2026") && report.includes("H1 2025"),
        );
        assert.ok(report.toLowerCase().includes(expected.income));
        assert.ok(report.includes(expected.provision));
        assert.doesNotMatch(report, /dòng tiền kinh doanh|operating cash flow|Doanh thu|revenue/u);
        const publicQuestion = investorQuestion({ ...input, intent, mode: "public" });
        assert.ok(publicQuestion.includes(symbol));
        assert.doesNotMatch(publicQuestion, /2026|2025|dòng tiền kinh doanh|operating cash flow/u);
      }
      const disclosures = investorQuestion({ ...input, intent: "disclosures", mode: "public" });
      assert.equal(
        disclosures,
        investorQuestion({ ...input, sectorId: undefined, intent: "disclosures", mode: "public" }),
      );
    }
    const generic = investorQuestion({
      stock: stock("ACB", "HOSE"),
      intent: "earnings",
      period,
      comparison,
      locale,
      mode: "report",
    });
    assert.ok(generic.includes(expected.generic), "Ticker alone cannot select banking semantics");
  }
});

test("watchlist storage accepts stock identities only and strips private or unrelated fields", () => {
  const candidate = stock("SHS", "HNX", {
    query: "Private question",
    answer: "Private answer",
    holdings: 100,
    accessToken: "not-a-real-key",
  });
  let storedKey, storedValue;
  const storage = {
    setItem(key, value) {
      storedKey = key;
      storedValue = value;
    },
  };
  assert.equal(persistWatchlist(storage, [candidate]), true);
  assert.equal(storedKey, WATCHLIST_STORAGE_KEY);
  assert.deepEqual(JSON.parse(storedValue), [
    { symbol: "SHS", exchange: "HNX", name: "Synthetic SHS", nameEn: "SHS company" },
  ]);
  assert.ok(!/query|answer|holdings|accessToken|Private/u.test(storedValue));
  const parsed = parseWatchlist(
    JSON.stringify([
      candidate,
      candidate,
      stock("ACV", "UPCOM"),
      stock("OLD", "HOSE", { status: "delisted" }),
      stock("FAKE", "HOSE", { securityType: "warrant" }),
      { symbol: "<script>", exchange: "HOSE" },
      { symbol: "FPT", exchange: "UNKNOWN" },
      null,
    ]),
  );
  assert.deepEqual(
    parsed.map((item) => item.symbol),
    ["SHS", "ACV"],
  );
  for (const invalid of [null, "broken json", "{}", "null", "[false, 7]", " ".repeat(100_001)])
    assert.deepEqual(parseWatchlist(invalid), []);
  assert.equal(savedStock({ symbol: "SHS", exchange: "HNX", name: {} }).name, "SHS");
});

test("watchlist add and remove are immutable, exchange-specific and usable when storage fails", () => {
  const original = [savedStock(stock("SHS", "HNX"))],
    before = JSON.stringify(original);
  const added = toggleWatchedStock(original, stock("SHS", "HOSE"));
  assert.equal(added.length, 2);
  assert.equal(JSON.stringify(original), before);
  const removed = toggleWatchedStock(added, stock("SHS", "HNX"));
  assert.deepEqual(
    removed.map((item) => item.exchange),
    ["HOSE"],
  );
  assert.equal(
    persistWatchlist(
      {
        setItem() {
          throw new Error("Storage blocked");
        },
      },
      removed,
    ),
    false,
  );
  assert.equal(persistWatchlist(undefined, removed), false);
  assert.deepEqual(
    removed,
    [savedStock(stock("SHS", "HOSE"))],
    "Failure to persist must not destroy this visit's watchlist",
  );
  assert.equal(toggleWatchedStock(removed, { symbol: "bad", exchange: "HNX" }), removed);
});

test("automatic quote refresh stops on pause, hidden pages and pending requests, and resumes with the same selection", async () => {
  const timers = new Map(),
    calls = [];
  let visible = true,
    pending = false,
    timerSequence = 0;
  const request = { symbol: "ACV", exchange: "UPCOM", dataset: "quote" };
  const task = {
    isPending: () => pending,
    async load(input) {
      calls.push(input);
    },
  };
  const runtime = {
    task,
    request,
    enabled: true,
    paused: false,
    isVisible: () => visible,
    schedule(callback, delay) {
      assert.equal(delay, QUOTE_REFRESH_MS);
      const id = ++timerSequence;
      timers.set(id, callback);
      return id;
    },
    unschedule(id) {
      timers.delete(id);
    },
  };
  let stop = startQuoteRefresh(runtime);
  assert.equal(calls.length, 0, "Enabling the timer does not itself fetch or submit research");
  timers.values().next().value();
  assert.deepEqual(calls, [request]);
  visible = false;
  timers.values().next().value();
  assert.equal(calls.length, 1);
  visible = true;
  pending = true;
  timers.values().next().value();
  assert.equal(calls.length, 1);
  pending = false;
  stop();
  assert.equal(timers.size, 0);
  stop = startQuoteRefresh({ ...runtime, paused: true });
  assert.equal(timers.size, 0);
  await task.load(request);
  assert.equal(calls.length, 2, "A paused timer still permits an explicit manual request");
  stop();
  stop = startQuoteRefresh(runtime);
  assert.equal(timers.size, 1);
  timers.values().next().value();
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1), request);
  stop();
  for (const change of [
    { enabled: false },
    { request: { ...request, dataset: "history" } },
    { request: { ...request, dataset: "company" } },
  ]) {
    startQuoteRefresh({ ...runtime, ...change })();
    assert.equal(timers.size, 0);
  }
});

test("quote pause and resume controls have explicit actions in both languages without a submit side effect", () => {
  for (const locale of ["vi", "en"]) {
    const active = render(QuoteRefreshControls, {
      locale,
      paused: false,
      onToggle() {
        assert.fail("Rendering must not change polling");
      },
    });
    const paused = render(QuoteRefreshControls, {
      locale,
      paused: true,
      onToggle() {
        assert.fail("Rendering must not change polling");
      },
    });
    assert.ok(active.includes('type="button"') && paused.includes('type="button"'));
    assert.ok(active.includes('role="status"') && paused.includes('role="status"'));
    assert.ok(
      active.includes(
        locale === "vi"
          ? 'aria-label="Tạm dừng tự cập nhật"'
          : 'aria-label="Pause automatic updates"',
      ),
    );
    assert.ok(
      paused.includes(
        locale === "vi"
          ? 'aria-label="Tiếp tục tự cập nhật"'
          : 'aria-label="Resume automatic updates"',
      ),
    );
  }
});

test("same-stock research results remain bound to their submitted query and locale after a new request", async () => {
  const security = stock("SHS", "HNX"),
    pending = [],
    states = [];
  const task = createPublicResearchController({
    client: {
      request() {
        const item = deferred();
        pending.push(item);
        return item.promise;
      },
    },
    onState: (state) => states.push(state),
  });
  const first = task.search({ security, query: "First question", locale: "en" });
  const latest = task.search({ security, query: "Second question", locale: "vi" });
  pending[0].resolve({ symbol: "SHS", exchange: "HNX", status: "ready", sources: [] });
  await first;
  assert.equal(states.filter((state) => state.status === "ready").length, 0);
  pending[1].resolve({ symbol: "SHS", exchange: "HNX", status: "ready", sources: [] });
  await latest;
  assert.equal(states.at(-1).query, "Second question");
  assert.equal(states.at(-1).locale, "vi");
  assert.equal(
    states.at(-1).requestKey,
    publicResearchKey({ security, query: " Second question ", locale: "vi" }),
  );
  assert.notEqual(
    states.at(-1).requestKey,
    publicResearchKey({ security, query: "First question", locale: "en" }),
  );
});

test("public source status and matched excerpts stay visible while repetitive reading details are collapsed", () => {
  const result = {
    symbol: "SHS",
    exchange: "HNX",
    status: "ready",
    fetchedAt: "2026-09-07T03:00:00Z",
    limitations: ["Synthetic discovery note"],
    sources: [
      {
        title: "Synthetic source",
        url: "https://example.com/report",
        readStatus: "partial",
        excerpt: "Synthetic matched original passage.",
        limitations: ["Synthetic extraction limit"],
      },
    ],
  };
  const html = render(PublicResearchResults, {
    research: { status: "ready", result },
    locale: "en",
  });
  assert.ok(html.includes('data-status="partial"') && html.includes("Partially read"));
  assert.ok(
    html.includes(
      '<blockquote class="ns-market-news-summary">Synthetic matched original passage.</blockquote>',
    ),
  );
  assert.ok(html.indexOf("Synthetic matched original passage") < html.indexOf("<details"));
  assert.ok(
    html.includes("Synthetic extraction limit") &&
      html.includes("Synthetic discovery note") &&
      !html.includes('open=""'),
  );
});
