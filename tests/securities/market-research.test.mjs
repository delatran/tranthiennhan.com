import assert from "node:assert/strict";
import test from "node:test";
import { marketUnavailable } from "../../shared/securities/market-data.js";
import { SECURITIES_SOURCE_POLICY } from "../../shared/securities/source-contract.js";
import {
  marketResearchDomains,
  publicResearchUrl,
  researchMarketStock,
  validateMarketResearchInput,
  validateMarketResearchResult,
  validateMarketResearchSource,
} from "../../worker/securities/market-research.js";
import { SECURITIES_MODEL_ID } from "../../worker/securities/model-contract.js";
import {
  requestSecuritiesModel,
  validModelSourceDomains,
} from "../../worker/securities/model-transport.js";

// Synthetic public-directory and provider fixtures only. No real model,
// financial-data endpoint, DNS lookup, or source page is requested here.
const NOW = "2026-09-07T08:00:00.000Z";
const INPUT = {
  symbol: "FIX",
  exchange: "UPCOM",
  query: "Latest public disclosures",
  locale: "en",
};
const STOCK = {
  symbol: "FIX",
  exchange: "UPCOM",
  name: "Fixture Public Company",
  nameEn: "Fixture Public Company",
  securityType: "stock",
  status: "listed",
};
const ENV = {
  SECURITIES_MODEL_MODE: "live",
  SECURITIES_OPENROUTER_API_KEY: "sk-or-fixture-research-token-never-a-real-key",
};
const URL = "https://fixture-issuer.vn/disclosures/report.pdf";
const EXCERPT =
  "Fixture Public Company publishes its consolidated financial statements and comparative reporting periods. This synthetic passage tests quotation binding only.";
const SOURCE_ONLY_TEXT =
  "Independent source text retained only by the source audit, never by a model receipt.";

function profile(website = "www.fixture-issuer.vn/investors", overrides = {}) {
  const row = { code: STOCK.symbol, floor: STOCK.exchange, website };
  return {
    ...marketUnavailable(
      { symbol: STOCK.symbol, exchange: STOCK.exchange, dataset: "company" },
      "market_provider_unavailable",
      NOW,
    ),
    status: "ready",
    error: undefined,
    columns: Object.keys(row).map((key) => ({ key, label: key })),
    rows: [row],
    ...overrides,
  };
}

function researchResult(overrides = {}) {
  return {
    schemaVersion: 1,
    symbol: STOCK.symbol,
    exchange: STOCK.exchange,
    companyName: STOCK.name,
    status: "unavailable",
    fetchedAt: NOW,
    sources: [],
    limitations: [],
    evidenceStatus: "public_reading_unverified",
    ...overrides,
  };
}

function sourcePacket(overrides = {}) {
  return {
    schemaVersion: 1,
    url: URL,
    hash: "a".repeat(64),
    byteLength: 4096,
    fetchedAt: NOW,
    contentType: "application/pdf",
    text: `${SOURCE_ONLY_TEXT}\n${EXCERPT}`,
    extraction: { method: "pdf_text", partial: false, pagesRead: 1, totalPages: 1 },
    ...overrides,
  };
}

const discovery = (candidates = [{ url: URL, title: "Public disclosures" }]) => ({
  candidates,
  limitations: [],
});
const reading = (overrides = {}) => ({
  url: URL,
  title: "Public disclosures",
  status: "read",
  contentExcerpt: EXCERPT,
  limitations: [],
  ...overrides,
});
const citation = (url = URL, content) => ({
  type: "url_citation",
  url_citation: { url, ...(content === undefined ? {} : { content }) },
});
function provider(
  output,
  { tool, annotations = [], id = "gen-research-fixture", model = SECURITIES_MODEL_ID } = {},
) {
  return new Response(
    JSON.stringify({
      id,
      model,
      provider: "Meta",
      choices: [
        {
          finish_reason: "stop",
          message: { role: "assistant", content: JSON.stringify(output), annotations },
        },
      ],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 40,
        cost: 0.001,
        server_tool_use: {
          web_search_requests: tool === "web_search" ? 1 : 0,
          web_fetch_requests: tool === "web_fetch" ? 1 : 0,
        },
      },
      openrouter_metadata: { requested: SECURITIES_MODEL_ID, strategy: "direct" },
    }),
    { headers: { "content-type": "application/json" } },
  );
}

function steps(responses) {
  const requests = [];
  return {
    requests,
    async fetchImpl(url, options) {
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(options.body);
      requests.push(body);
      const next = responses[requests.length - 1];
      assert.ok(next, "No undeclared model request or retry is permitted by this fixture.");
      assert.equal(body.model, SECURITIES_MODEL_ID);
      assert.deepEqual(body.provider, { allow_fallbacks: false, require_parameters: true });
      assert.equal(options.redirect, "manual");
      return typeof next === "function" ? next(body, options) : next;
    },
  };
}

const research = (options) =>
  researchMarketStock({
    input: INPUT,
    stock: STOCK,
    profile: profile(),
    env: ENV,
    now: () => NOW,
    ...options,
  });

test("research input is closed and binds a listed stock before any model call", async () => {
  assert.deepEqual(validateMarketResearchInput({ ...INPUT, query: "  useful question  " }), {
    ...INPUT,
    query: "useful question",
  });
  for (const input of [
    null,
    [],
    { ...INPUT, sourceDomains: ["untrusted.vn"] },
    { ...INPUT, url: URL },
    { ...INPUT, symbol: "../FIX" },
    { ...INPUT, exchange: "OTC" },
    { ...INPUT, locale: "fr" },
    { ...INPUT, query: 1 },
    { ...INPUT, query: "x".repeat(1201) },
    { ...INPUT, query: "bad\u0000text" },
    { ...INPUT, symbol: "   " },
  ])
    assert.throws(() => validateMarketResearchInput(input), { code: "invalid_market_research" });
  const noCall = async () => assert.fail("Invalid context must not resolve a model request.");
  for (const stock of [
    null,
    { ...STOCK, symbol: "OTHER" },
    { ...STOCK, exchange: "HNX" },
    { ...STOCK, securityType: "fund" },
    { ...STOCK, status: "delisted" },
    { ...STOCK, nameEn: { instructions: "untrusted" } },
  ]) {
    await assert.rejects(research({ stock, requestModel: noCall }), {
      code: "market_symbol_missing",
    });
  }
  await assert.rejects(research({ onReceipt: "not a callback", requestModel: noCall }), {
    code: "invalid_market_research",
  });
  await assert.rejects(research({ readSource: "not a callback", requestModel: noCall }), {
    code: "invalid_market_research",
  });
});

test("profile identity and safe bare websites determine domains; mismatches fall back to the exchange", () => {
  for (const website of [
    "www.fixture-issuer.vn/investors",
    "fixture-issuer.vn",
    "https://www.fixture-issuer.vn/",
    "http://fixture-issuer.vn/",
  ]) {
    assert.deepEqual(marketResearchDomains(STOCK, profile(website)), [
      "fixture-issuer.vn",
      "hnx.vn",
    ]);
  }
  for (const invalid of [
    profile(undefined, { symbol: "OTHER" }),
    profile(undefined, { exchange: "HOSE" }),
    profile(undefined, { provider: "untrusted" }),
    profile(undefined, { dataset: "quote" }),
    profile(undefined, { rows: [{ code: "OTHER", floor: STOCK.exchange, website: "other.vn" }] }),
    profile(undefined, { rows: [{ code: STOCK.symbol, floor: "HOSE", website: "other.vn" }] }),
    profile(undefined, { status: "empty", rows: [] }),
    undefined,
  ]) {
    assert.deepEqual(marketResearchDomains(STOCK, invalid), ["hnx.vn"]);
  }
  for (const website of [
    "file:///private.txt",
    "javascript:alert(1)",
    "https://localhost/",
    "http://127.0.0.1/",
    "https://169.254.169.254/latest/meta-data",
    "https://user:password@fixture-issuer.vn/",
    "fixture-issuer.vn:8080",
    "https://fixture-issuer.vn:8443/",
    "//fixture-issuer.vn/",
    "fixture-issuer.vn\\@other.vn",
    "fixture issuer.vn",
  ]) {
    assert.deepEqual(marketResearchDomains(STOCK, profile(website)), ["hnx.vn"], website);
  }
  assert.deepEqual(
    marketResearchDomains({ ...STOCK, symbol: "FPT", exchange: "HOSE" }, profile("untrusted.vn")),
    ["fpt.com", "bctn2025.fpt.com", "hsx.vn"],
  );
  assert.deepEqual(marketResearchDomains({ ...STOCK, exchange: "HNX" }), ["hnx.vn"]);
});

test("research URLs retain only canonical public HTTPS URLs in the selected domain scope", () => {
  const domains = ["fixture-issuer.vn", "hnx.vn"];
  assert.equal(publicResearchUrl(`${URL}#page=2`, domains), URL);
  assert.equal(
    publicResearchUrl("https://reports.fixture-issuer.vn/report.pdf", domains),
    "https://reports.fixture-issuer.vn/report.pdf",
  );
  for (const url of [
    "http://fixture-issuer.vn/",
    "https://127.0.0.1/",
    "https://fixture-issuer.vn.attacker.vn/",
    "https://other.vn/",
    "https://fixture-issuer.vn@other.vn/",
    "https://fixture-issuer.vn:8443/",
    "https://fixture-issuer.vn/a%5cb",
    "https://fixture-issuer.vn/?q=%0a",
    "https://fixture-issuer.vn/with space",
    "https://fixture-issuer.vn/\u007f",
  ]) {
    assert.throws(() => publicResearchUrl(url, domains), { code: "unsafe_source_url" }, url);
  }
  for (const domains of [
    null,
    [],
    ["fixture-issuer.vn", "fixture-issuer.vn"],
    ["localhost"],
    ["127.0.0.1"],
    ["company.internal"],
    ["a.vn", "b.vn", "c.vn", "d.vn"],
  ]) {
    assert.equal(validModelSourceDomains(domains), false);
    assert.throws(() => publicResearchUrl(URL, domains), { code: "unsafe_source_url" });
  }
});

test("result schema rejects forged status, unsafe text, duplicate sources and inconsistent cache fields", () => {
  const source = {
    url: URL,
    title: "Public disclosures",
    readStatus: "read",
    excerpt: EXCERPT,
    limitations: [],
  };
  const ready = researchResult({ status: "ready", sources: [source] });
  assert.equal(validateMarketResearchResult(ready, INPUT), ready);
  for (const invalid of [
    { ...ready, extra: true },
    { ...ready, symbol: "OTHER" },
    { ...ready, companyName: " " },
    { ...ready, fetchedAt: "2026-02-30T08:00:00.000Z" },
    { ...ready, status: "unavailable" },
    { ...ready, status: "partial" },
    { ...ready, sources: [] },
    { ...ready, sources: [source, source] },
    { ...ready, evidenceStatus: "verified" },
    { ...ready, sources: [{ ...source, excerpt: " ".repeat(80) }] },
    { ...ready, sources: [{ ...source, url: `${URL}#page=2` }] },
    { ...ready, sources: [{ ...source, excerpt: "Checking your browser. ".repeat(6) }] },
    { ...ready, sources: [{ ...source, readStatus: "unavailable" }], status: "partial" },
    { ...ready, error: { code: "provider_timeout", message: "private" } },
    { ...ready, cache: { hit: true, expiresAt: "tomorrow" } },
    { ...ready, cache: { expiresAt: NOW } },
  ]) {
    assert.throws(() => validateMarketResearchResult(invalid, INPUT), {
      code: "market_research_invalid_response",
    });
  }
});

test("downloaded source validation binds identity, hash type and bounded extraction metadata", () => {
  const full = sourcePacket();
  const html = sourcePacket({
    contentType: "text/html",
    extraction: { method: "static_html", partial: false, pagesRead: null, totalPages: null },
  });
  assert.equal(validateMarketResearchSource(full, URL), full);
  assert.equal(validateMarketResearchSource(html, URL), html);
  for (const byteLength of [8 * 1024 * 1024 + 1, SECURITIES_SOURCE_POLICY.maxBytes]) {
    const source = { ...full, byteLength };
    assert.equal(validateMarketResearchSource(source, URL), source);
  }
  const largestHtml = { ...html, byteLength: SECURITIES_SOURCE_POLICY.maxHtmlBytes };
  assert.equal(validateMarketResearchSource(largestHtml, URL), largestHtml);
  assert.equal(
    validateMarketResearchSource(
      sourcePacket({
        text: "",
        extraction: { method: "pdf_text", partial: true, pagesRead: 20, totalPages: 300 },
      }),
      URL,
    ).extraction.partial,
    true,
  );
  for (const source of [
    null,
    [],
    { ...full, extra: true },
    { ...full, schemaVersion: 2 },
    { ...full, url: "https://fixture-issuer.vn/other.pdf" },
    { ...full, url: `${URL}#page=1` },
    { ...full, hash: [full.hash] },
    { ...full, hash: "a".repeat(63) },
    { ...full, hash: "x".repeat(64) },
    { ...full, byteLength: 0 },
    { ...full, byteLength: SECURITIES_SOURCE_POLICY.maxBytes + 1 },
    { ...full, byteLength: 1.5 },
    { ...html, byteLength: SECURITIES_SOURCE_POLICY.maxHtmlBytes + 1 },
    { ...full, fetchedAt: "2026-02-30T08:00:00.000Z" },
    { ...full, contentType: "text/plain" },
    { ...full, text: "x".repeat(250001) },
    { ...full, text: null },
    { ...full, extraction: { ...full.extraction, raw: SOURCE_ONLY_TEXT } },
    { ...full, extraction: { ...full.extraction, partial: "false" } },
    { ...full, extraction: { ...full.extraction, method: "static_html" } },
    { ...html, extraction: full.extraction },
    { ...full, extraction: { ...full.extraction, pagesRead: 0 } },
    { ...full, extraction: { ...full.extraction, pagesRead: null } },
    { ...full, extraction: { ...full.extraction, pagesRead: 2 } },
    { ...full, extraction: { ...full.extraction, totalPages: 2 } },
    { ...full, extraction: { ...full.extraction, partial: true, pagesRead: 21, totalPages: 30 } },
    { ...full, extraction: { ...full.extraction, partial: true, totalPages: 301 } },
  ])
    assert.throws(() => validateMarketResearchSource(source, URL), {
      code: "market_research_invalid_source",
      status: 502,
    });
  for (const target of [
    "https://localhost/private.pdf",
    "http://fixture-issuer.vn/report.pdf",
    `${URL}#page=1`,
  ]) {
    assert.throws(() => validateMarketResearchSource({ ...full, url: target }, target), {
      code: "market_research_invalid_source",
    });
  }
});

test("discovery and matching fetch evidence bind exact domains, URL and source quotation", async () => {
  const receipts = [];
  const transport = steps([
    (body) => {
      assert.deepEqual(body.tools[0].parameters.allowed_domains, ["fixture-issuer.vn", "hnx.vn"]);
      assert.equal(body.tools[0].type, "openrouter:web_search");
      assert.equal(body.max_tool_calls, 2);
      assert.equal(
        body.response_format.json_schema.schema.properties.candidates.items.properties.title
          .minLength,
        1,
      );
      assert.deepEqual(JSON.parse(body.messages[1].content).allowedDomains, [
        "fixture-issuer.vn",
        "hnx.vn",
      ]);
      return provider(discovery(), { tool: "web_search", annotations: [citation()] });
    },
    (body) => {
      assert.equal(body.tools[0].type, "openrouter:web_fetch");
      assert.equal(body.tools[0].parameters.engine, "parallel");
      assert.deepEqual(body.tools[0].parameters.allowed_domains, ["fixture-issuer.vn"]);
      assert.equal(body.max_tool_calls, 1);
      assert.equal(body.response_format.json_schema.schema.properties.title.minLength, 1);
      assert.equal(JSON.parse(body.messages[1].content).url, URL);
      assert.equal(
        JSON.stringify(body).includes(EXCERPT),
        false,
        "The expected quotation must not be given to the model.",
      );
      return provider(reading(), {
        tool: "web_fetch",
        annotations: [citation(URL, `Opening. ${EXCERPT} Closing.`)],
        id: "gen-read-fixture",
      });
    },
  ]);
  const result = await research({
    ...transport,
    onReceipt: (receipt) => receipts.push(structuredClone(receipt)),
  });
  assert.equal(result.status, "ready");
  assert.equal(result.sources[0].readStatus, "read");
  assert.equal(result.sources[0].excerpt, EXCERPT);
  assert.equal(result.evidenceStatus, "public_reading_unverified");
  assert.equal(receipts.length, 2);
  assert.ok(
    receipts.every(
      (receipt) =>
        receipt.evidenceType === "fixture" && receipt.actualModel === SECURITIES_MODEL_ID,
    ),
  );
  assert.equal(receipts[0].validation.reading, "discovery_only");
  assert.equal(receipts[1].validation.reading, "provider_citation_excerpt_matched");
  assert.equal(receipts[1].validation.financialEvidence, "not_established");
  assert.equal(receipts[1].validation.url, URL);
  assert.equal(JSON.stringify(receipts).includes(EXCERPT), false);
});

test("HTML research uses Parallel with exact request scope and still requires execution and matching citation content", async () => {
  const htmlUrl = "https://reports.fixture-issuer.vn/about-company";
  for (const { tool, annotations, ready } of [
    { tool: "web_fetch", annotations: [citation(htmlUrl, EXCERPT)], ready: true },
    { tool: "web_fetch", annotations: [], ready: false },
    {
      tool: "web_fetch",
      annotations: [citation(htmlUrl, "Different source text without the proposed quotation.")],
      ready: false,
    },
    { tool: undefined, annotations: [citation(htmlUrl, EXCERPT)], ready: false },
  ]) {
    const receipts = [];
    const transport = steps([
      provider(discovery([{ url: htmlUrl, title: "Company information" }]), {
        tool: "web_search",
        annotations: [citation(htmlUrl, EXCERPT)],
      }),
      (body) => {
        assert.deepEqual(body.tools, [
          {
            type: "openrouter:web_fetch",
            parameters: {
              engine: "parallel",
              allowed_domains: ["reports.fixture-issuer.vn"],
              max_uses: 1,
              max_content_tokens: 20_000,
            },
          },
        ]);
        assert.equal(body.max_tool_calls, 1);
        assert.deepEqual(JSON.parse(body.messages[1].content), {
          symbol: STOCK.symbol,
          exchange: STOCK.exchange,
          companyName: STOCK.name,
          query: INPUT.query,
          locale: INPUT.locale,
          url: htmlUrl,
        });
        assert.equal(JSON.stringify(body).includes(EXCERPT), false);
        return provider(reading({ url: htmlUrl }), { tool, annotations });
      },
    ]);
    const result = await research({ ...transport, onReceipt: (receipt) => receipts.push(receipt) });
    assert.equal(transport.requests.length, 2);
    assert.equal(receipts.length, 2);
    assert.deepEqual(receipts[1].requestedServerTools, [
      { type: "openrouter:web_fetch", engine: "parallel" },
    ]);
    assert.equal(result.status, ready ? "ready" : "partial");
    assert.equal(result.sources[0].url, htmlUrl);
    assert.equal(result.sources[0].excerpt, ready ? EXCERPT : "");
    assert.equal(result.evidenceStatus, "public_reading_unverified");
    if (tool === undefined) assert.equal(receipts[1].validation.reason, "execution_unverified");
    else
      assert.equal(
        receipts[1].validation.reading,
        ready ? "provider_citation_excerpt_matched" : "content_unverified",
      );
  }
});

test("source text is read before tool-free quotation selection and annotations cannot replace that source", async () => {
  for (const annotations of [
    [],
    [citation(URL, "Provider content does not contain the proposed excerpt.")],
  ]) {
    const receipts = [];
    let reads = 0;
    const controller = new AbortController();
    const sourceText = `${SOURCE_ONLY_TEXT}\n${EXCERPT.replaceAll(" ", "\n")}`;
    const transport = steps([
      provider(discovery(), { tool: "web_search", annotations: [citation()] }),
      (body) => {
        assert.equal(reads, 1, "Source reading must finish before quotation selection.");
        assert.deepEqual(body.tools, []);
        assert.equal(body.tool_choice, "none");
        assert.equal(body.max_tool_calls, undefined);
        assert.equal(body.response_format.json_schema.name, "market_public_source_quote");
        const provided = JSON.parse(body.messages[1].content);
        assert.equal(provided.url, undefined);
        assert.equal(provided.sources.length, 1);
        assert.equal(provided.sources[0].url, URL);
        assert.equal(provided.sources[0].hash, "a".repeat(64));
        assert.equal(provided.sources[0].text, sourceText);
        assert.equal(provided.sources[0].truncated, false);
        return provider(reading(), { annotations });
      },
    ]);
    const result = await research({
      ...transport,
      signal: controller.signal,
      onReceipt: (receipt) => receipts.push(receipt),
      async readSource(options) {
        reads++;
        assert.deepEqual(options, {
          url: URL,
          domains: ["fixture-issuer.vn"],
          signal: controller.signal,
        });
        await Promise.resolve();
        return sourcePacket({ text: sourceText });
      },
    });
    assert.equal(reads, 1);
    assert.equal(transport.requests.length, 2);
    assert.equal(receipts.length, 2);
    assert.equal(result.status, "ready");
    assert.equal(result.sources[0].excerpt, EXCERPT);
    assert.equal(result.evidenceStatus, "public_reading_unverified");
    const validation = receipts[1].validation;
    assert.equal(validation.reading, "downloaded_source_excerpt_matched");
    assert.equal(validation.financialEvidence, "not_established");
    assert.deepEqual(validation.localSource, {
      url: URL,
      hash: "a".repeat(64),
      byteLength: 4096,
      fetchedAt: NOW,
      contentType: "application/pdf",
      extraction: { method: "pdf_text", partial: false, pagesRead: 1, totalPages: 1 },
      modelContext: {
        providedCharacters: sourceText.length,
        totalCharacters: sourceText.length,
        truncated: false,
      },
      status: "matched",
    });
    assert.deepEqual(validation.execution, {
      invoked: false,
      invocationCount: 0,
      basis: "not_requested",
    });
    assert.deepEqual(receipts[1].requestedServerTools, []);
    assert.equal(validation.sourceReading, "downloaded_before_model");
    for (const value of [SOURCE_ONLY_TEXT, EXCERPT])
      assert.equal(JSON.stringify(receipts).includes(value), false);
    assert.equal(JSON.stringify(result).includes(SOURCE_ONLY_TEXT), false);
  }
});

test("downloaded source cannot bypass output identity and structure or borrow a provider-only quotation", async () => {
  for (const { output, source = sourcePacket(), annotations = [] } of [
    { output: reading({ status: "unavailable" }) },
    { output: reading({ contentExcerpt: "Too short to corroborate." }) },
    { output: reading({ url: "https://fixture-issuer.vn/other.pdf" }) },
    { output: reading({ extra: "Unknown output field" }) },
    { output: reading({ status: "verified" }) },
    {
      output: reading(),
      source: sourcePacket({ text: SOURCE_ONLY_TEXT.repeat(2) }),
      annotations: [citation(URL, EXCERPT)],
    },
  ]) {
    let reads = 0;
    const transport = steps([
      provider(discovery(), { tool: "web_search", annotations: [citation()] }),
      provider(output, { annotations }),
    ]);
    const result = await research({
      ...transport,
      readSource: async () => {
        reads++;
        return source;
      },
    });
    assert.equal(reads, 1);
    assert.equal(transport.requests.length, 2);
    assert.equal(result.status, "partial");
    assert.equal(result.sources[0].excerpt, "");
  }
});

test("invalid, failed, short or blocked downloaded sources admit no quotation request", async () => {
  const privateFailure = "PRIVATE_SOURCE_READER_ERROR_MUST_NOT_BE_RETAINED";
  for (const { source, error } of [
    { source: sourcePacket({ text: "Insufficient source text." }) },
    {
      source: sourcePacket({ url: "https://unapproved.invalid/private-source" }),
    },
    { source: sourcePacket({ hash: ["a".repeat(64)] }) },
    {
      source: sourcePacket({ extraction: { method: "pdf_text", partial: false } }),
    },
    { error: new Error(privateFailure) },
    {
      source: sourcePacket({ text: `Checking your browser. ${EXCERPT}` }),
    },
  ]) {
    const receipts = [];
    let reads = 0;
    const transport = steps([
      provider(discovery(), { tool: "web_search", annotations: [citation()] }),
    ]);
    const result = await research({
      ...transport,
      onReceipt: (receipt) => receipts.push(receipt),
      async readSource() {
        reads++;
        if (error) throw error;
        return source;
      },
    });
    assert.equal(reads, 1);
    assert.equal(transport.requests.length, 1);
    assert.equal(receipts.length, 1);
    assert.equal(result.status, "partial");
    assert.equal(result.sources[0].excerpt, "");
    assert.equal(receipts[0].operation, "discovery");
    assert.match(result.sources[0].limitations[0], /A read was attempted/u);
    assert.match(
      result.limitations.join(" "),
      /None of the discovered links supplied usable source text/u,
    );
    for (const value of [
      privateFailure,
      SOURCE_ONLY_TEXT,
      EXCERPT,
      "https://unapproved.invalid/private-source",
    ]) {
      assert.equal(JSON.stringify(receipts).includes(value), false);
      assert.equal(JSON.stringify(result).includes(value), false);
    }
  }
});

test("all accepted candidates are attempted in order before one quotation request", async () => {
  const second = "https://fixture-issuer.vn/company";
  const third = "https://fixture-issuer.vn/unused";
  const candidates = [URL, second, third].map((url) => ({ url, title: "Synthetic source" }));
  for (const first of ["failed", "short"]) {
    const reads = [];
    const transport = steps([
      provider(discovery(candidates), {
        tool: "web_search",
        annotations: candidates.map(({ url }) => citation(url)),
      }),
      (body) => {
        assert.deepEqual(reads, [URL, second, third]);
        const provided = JSON.parse(body.messages[1].content);
        assert.deepEqual(
          provided.sources.map(({ url }) => url),
          [second, third],
        );
        assert.equal(provided.sources[0].text, sourcePacket().text);
        assert.deepEqual(body.tools, []);
        assert.equal(body.tool_choice, "none");
        return provider(reading({ url: second }));
      },
    ]);
    const result = await research({
      ...transport,
      readSource: async ({ url, domains }) => {
        reads.push(url);
        assert.deepEqual(domains, ["fixture-issuer.vn"]);
        if (url === URL) {
          if (first === "failed")
            throw Object.assign(new Error("Synthetic 404"), { code: "source_fetch_failed" });
          return sourcePacket({ text: "No usable passage." });
        }
        return sourcePacket({ url });
      },
    });
    assert.equal(transport.requests.length, 2);
    assert.equal(result.status, "ready");
    assert.deepEqual(
      result.sources.map(({ readStatus }) => readStatus),
      ["unavailable", "read", "partial"],
    );
    assert.equal(result.sources[1].excerpt, EXCERPT);
    assert.match(result.sources[0].limitations[0], /A read was attempted/u);
    assert.match(result.sources[2].limitations[0], /Source text was read/u);
  }
});

test("large escaped source context stays within transport limits and quotations bind only the supplied portion", async () => {
  const filler = '"\\Việt📄"'.repeat(20_000);
  for (const position of ["start", "end"]) {
    const source = sourcePacket({
      text: position === "start" ? `${EXCERPT} ${filler}` : `${filler} ${EXCERPT}`,
    });
    const receipts = [];
    const transport = steps([
      provider(discovery(), { tool: "web_search", annotations: [citation()] }),
      (body) => {
        assert.ok(Buffer.byteLength(JSON.stringify(body)) <= 300_000);
        const provided = JSON.parse(body.messages[1].content).sources[0];
        assert.equal(provided.truncated, true);
        assert.equal(provided.totalCharacters, source.text.length);
        assert.ok(provided.providedCharacters < source.text.length);
        assert.equal(provided.text.length, provided.providedCharacters);
        assert.equal(/[\uD800-\uDBFF]$/u.test(provided.text), false);
        assert.equal(provided.text.includes(EXCERPT), position === "start");
        return provider(reading(), { annotations: [citation(URL, EXCERPT)] });
      },
    ]);
    const result = await research({
      ...transport,
      readSource: async () => source,
      onReceipt: (receipt) => receipts.push(receipt),
    });
    assert.equal(transport.requests.length, 2);
    assert.equal(result.status, "partial");
    assert.equal(result.sources[0].excerpt, position === "start" ? EXCERPT : "");
    assert.equal(receipts[1].validation.localSource.modelContext.truncated, true);
    assert.equal(
      receipts[1].validation.localSource.status,
      position === "start" ? "matched" : "unmatched",
    );
  }
});

test("a readable navigation shell cannot prevent selecting a useful later source", async () => {
  const second = "https://fixture-issuer.vn/investors/disclosure";
  const third = "https://fixture-issuer.vn/blocked";
  const candidates = [URL, second, third].map((url) => ({ url, title: "Synthetic issuer page" }));
  const navigation =
    "About us Investors Contact Personal banking Business banking Search Financial statements ".repeat(
      3,
    );
  const reads = [];
  const receipts = [];
  const transport = steps([
    provider(discovery(candidates), {
      tool: "web_search",
      annotations: candidates.map(({ url }) => citation(url)),
    }),
    (body) => {
      assert.deepEqual(reads, [URL, second, third]);
      const provided = JSON.parse(body.messages[1].content).sources;
      assert.deepEqual(
        provided.map(({ url }) => url),
        [URL, second],
      );
      assert.equal(provided[0].text, navigation);
      assert.equal(provided[1].text, sourcePacket().text);
      return provider(reading({ url: second }));
    },
  ]);
  const result = await research({
    ...transport,
    readSource: async ({ url }) => {
      reads.push(url);
      if (url === third) throw new Error("Synthetic source access failure");
      return sourcePacket({ url, ...(url === URL ? { text: navigation } : {}) });
    },
    onReceipt: (receipt) => receipts.push(receipt),
  });
  assert.equal(transport.requests.length, 2);
  assert.equal(result.status, "ready");
  assert.deepEqual(
    result.sources.map(({ readStatus }) => readStatus),
    ["partial", "read", "unavailable"],
  );
  assert.equal(result.sources[0].excerpt, "");
  assert.match(result.sources[0].limitations[0], /Source text was read/u);
  assert.equal(result.sources[1].excerpt, EXCERPT);
  assert.equal(receipts[1].validation.localSource.url, second);
  assert.deepEqual(
    receipts[1].validation.sourceContexts.map(({ url }) => url),
    [URL, second],
  );
  assert.equal(JSON.stringify(receipts).includes(navigation), false);
  assert.equal(JSON.stringify(receipts).includes(SOURCE_ONLY_TEXT), false);
});

test("a selected packet cannot borrow another packet's quote or select an unread discovery URL", async () => {
  const second = "https://fixture-issuer.vn/disclosure";
  const unread = "https://fixture-issuer.vn/unread";
  const candidates = [URL, second, unread].map((url) => ({ url, title: "Synthetic source" }));
  for (const selected of [URL, unread]) {
    const receipts = [];
    const transport = steps([
      provider(discovery(candidates), {
        tool: "web_search",
        annotations: candidates.map(({ url }) => citation(url)),
      }),
      provider(reading({ url: selected }), { annotations: [citation(selected, EXCERPT)] }),
    ]);
    const result = await research({
      ...transport,
      readSource: async ({ url }) => {
        if (url === unread) throw new Error("Synthetic inaccessible source");
        return sourcePacket({ url, ...(url === URL ? { text: SOURCE_ONLY_TEXT.repeat(2) } : {}) });
      },
      onReceipt: (receipt) => receipts.push(receipt),
    });
    assert.equal(transport.requests.length, 2);
    assert.equal(result.status, "partial");
    assert.ok(result.sources.every(({ excerpt }) => excerpt === ""));
    if (selected === URL) assert.equal(receipts[1].validation.localSource.status, "unmatched");
    else {
      assert.equal(receipts[1].validation.status, "failed");
      assert.equal(receipts[1].validation.reason, "target_url_mismatch");
    }
  }
});

test("all four large source contexts share one aggregate payload cap and preserve their separate identities", async () => {
  const candidates = Array.from({ length: 4 }, (_, index) => ({
    url: `https://fixture-issuer.vn/report-${index}.pdf`,
    title: "Synthetic disclosure",
  }));
  const packets = candidates.map(({ url }) =>
    sourcePacket({ url, text: `${EXCERPT} ${'"\\Việt📄"'.repeat(20_000)}` }),
  );
  const receipts = [];
  const transport = steps([
    provider(discovery(candidates), {
      tool: "web_search",
      annotations: candidates.map(({ url }) => citation(url)),
    }),
    (body) => {
      const provided = JSON.parse(body.messages[1].content).sources;
      assert.equal(provided.length, 4);
      assert.ok(Buffer.byteLength(JSON.stringify(JSON.stringify(provided))) <= 200_000);
      assert.ok(Buffer.byteLength(JSON.stringify(body)) <= 300_000);
      assert.deepEqual(
        provided.map(({ url }) => url),
        candidates.map(({ url }) => url),
      );
      assert.ok(provided.every((source) => source.truncated && source.text.includes(EXCERPT)));
      assert.deepEqual(body.tools, []);
      assert.equal(body.tool_choice, "none");
      return provider(reading({ url: candidates[3].url }));
    },
  ]);
  const result = await research({
    ...transport,
    readSource: async ({ url }) => packets.find((packet) => packet.url === url),
    onReceipt: (receipt) => receipts.push(receipt),
  });
  assert.equal(transport.requests.length, 2);
  assert.equal(result.status, "partial");
  assert.equal(result.sources[3].excerpt, EXCERPT);
  assert.equal(receipts[1].validation.localSource.url, candidates[3].url);
  assert.equal(receipts[1].validation.sourceContexts.length, 4);
});

test("unsupported discovery prose remains private and cannot establish a public reporting period", async () => {
  const unverified =
    "Search snippets establish a verified H1/Q2 2026 filing and financial results.";
  for (const locale of ["en", "vi"]) {
    const receipts = [];
    const transport = steps([
      provider(
        { ...discovery(), limitations: [unverified] },
        { tool: "web_search", annotations: [citation()] },
      ),
      provider(reading()),
    ]);
    const result = await research({
      ...transport,
      input: { ...INPUT, locale },
      readSource: async () => sourcePacket(),
      onReceipt: (receipt) => receipts.push(receipt),
    });
    assert.equal(result.status, "ready");
    assert.equal(JSON.stringify(result).includes(unverified), false);
    assert.equal(
      JSON.stringify(result).includes("2026"),
      true,
      "The timestamp is preserved independently of model prose.",
    );
    assert.equal(JSON.stringify(result.limitations).includes("H1/Q2"), false);
    assert.deepEqual(receipts[0].validation.discoveryLimitations, [unverified]);
    assert.match(result.limitations[0], locale === "en" ? /do not establish/u : /chưa xác minh/u);
  }
});

test("matching incomplete source extraction and model partial status remain partial", async () => {
  for (const { outputStatus, extraction } of [
    {
      outputStatus: "read",
      extraction: { method: "pdf_text", partial: true, pagesRead: 1, totalPages: 2 },
    },
    {
      outputStatus: "partial",
      extraction: { method: "pdf_text", partial: false, pagesRead: 1, totalPages: 1 },
    },
  ]) {
    const receipts = [];
    const transport = steps([
      provider(discovery(), { tool: "web_search", annotations: [citation()] }),
      provider(reading({ status: outputStatus }), { tool: "web_fetch" }),
    ]);
    const result = await research({
      ...transport,
      readSource: async () => sourcePacket({ extraction }),
      onReceipt: (receipt) => receipts.push(receipt),
    });
    assert.equal(result.status, "partial");
    assert.equal(result.sources[0].readStatus, "partial");
    assert.equal(result.sources[0].excerpt, EXCERPT);
    assert.equal(receipts[1].validation.reading, "downloaded_source_excerpt_matched");
    assert.equal(receipts[1].validation.localSource.extraction.partial, extraction.partial);
  }
});

test("source-read cancellation retains discovery usage and admits no quotation request", async () => {
  for (const explicitSignal of [true, false]) {
    const receipts = [];
    let reads = 0;
    const controller = new AbortController();
    const transport = steps([
      provider(discovery(), { tool: "web_search", annotations: [citation()] }),
    ]);
    await assert.rejects(
      research({
        ...transport,
        signal: explicitSignal ? controller.signal : undefined,
        onReceipt: (receipt) => receipts.push(receipt),
        async readSource() {
          reads++;
          if (explicitSignal) {
            controller.abort();
            return sourcePacket();
          }
          throw new DOMException("PRIVATE_ABORT_REASON", "AbortError");
        },
      }),
      (error) => {
        assert.equal(error.code, "model_cancelled");
        assert.equal(error.status, 499);
        assert.deepEqual(error.receipts, []);
        assert.equal(JSON.stringify(error).includes("PRIVATE_ABORT_REASON"), false);
        return true;
      },
    );
    assert.equal(reads, 1);
    assert.equal(transport.requests.length, 1);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].operation, "discovery");
    assert.equal(receipts[0].costUsd, 0.001);
  }
});

test("source storage failure propagates before quotation selection without retrying the audit write", async () => {
  let reads = 0;
  const receipts = [];
  const transport = steps([
    provider(discovery(), { tool: "web_search", annotations: [citation()] }),
  ]);
  await assert.rejects(
    research({
      ...transport,
      onReceipt: (receipt) => receipts.push(receipt),
      async readSource() {
        reads++;
        throw Object.assign(new Error("PRIVATE_SOURCE_STORAGE_ERROR"), {
          code: "receipt_persistence_failed",
        });
      },
    }),
    (error) => {
      assert.equal(error.code, "receipt_persistence_failed");
      assert.deepEqual(error.receipts, []);
      assert.equal(JSON.stringify(error).includes("PRIVATE_SOURCE_STORAGE_ERROR"), false);
      return true;
    },
  );
  assert.equal(reads, 1);
  assert.equal(transport.requests.length, 1);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].operation, "discovery");
  assert.equal(receipts[0].costUsd, 0.001);
});

test("receipt storage failure after independent corroboration retains source metadata and does not repeat either read", async () => {
  let reads = 0,
    writes = 0;
  const transport = steps([
    provider(discovery(), { tool: "web_search", annotations: [citation()] }),
    provider(reading(), { tool: "web_fetch" }),
  ]);
  await assert.rejects(
    research({
      ...transport,
      readSource: async () => {
        reads++;
        return sourcePacket();
      },
      onReceipt(receipt) {
        writes++;
        if (receipt.operation === "fetch") throw new Error("PRIVATE_RECEIPT_WRITE_ERROR");
      },
    }),
    (error) => {
      assert.equal(error.code, "receipt_persistence_failed");
      assert.equal(error.receipts[0].costUsd, 0.001);
      assert.equal(error.receipts[0].validation.reading, "downloaded_source_excerpt_matched");
      assert.equal(error.receipts[0].validation.localSource.status, "matched");
      for (const value of ["PRIVATE_RECEIPT_WRITE_ERROR", SOURCE_ONLY_TEXT, EXCERPT])
        assert.equal(JSON.stringify(error).includes(value), false);
      return true;
    },
  );
  assert.equal(reads, 1);
  assert.equal(writes, 2);
  assert.equal(transport.requests.length, 2);
});

test("source text needs the same fetch's matching citation content, not invocation, snippets, or another URL", async () => {
  for (const annotations of [
    [],
    [citation()],
    [citation(URL, "Search snippet without the proposed quotation.")],
    [citation("https://fixture-issuer.vn/different.pdf", EXCERPT)],
  ]) {
    const transport = steps([
      provider(discovery(), { tool: "web_search", annotations: [citation(URL, EXCERPT)] }),
      provider(reading(), { tool: "web_fetch", annotations }),
    ]);
    const result = await research(transport);
    assert.equal(result.status, "partial");
    assert.equal(result.sources[0].readStatus, "partial");
    assert.equal(result.sources[0].excerpt, "");
    assert.match(result.sources[0].limitations[0], /unverified quotation is not displayed/);
    assert.equal(JSON.stringify(result).includes(EXCERPT), false);
  }
});

test("a matching partial excerpt remains partial and unsupported source content remains absent", async () => {
  for (const status of ["partial", "unavailable"]) {
    const transport = steps([
      provider(discovery(), { tool: "web_search", annotations: [citation()] }),
      provider(reading({ status }), { tool: "web_fetch", annotations: [citation(URL, EXCERPT)] }),
    ]);
    const result = await research(transport);
    assert.equal(result.status, "partial");
    assert.equal(result.sources[0].readStatus, status);
    assert.equal(result.sources[0].excerpt, status === "partial" ? EXCERPT : "");
  }
});

test("blocked pages cannot be published as read even when their text is cited or the model omits the challenge", async () => {
  for (const [status, contentExcerpt, content] of [
    ["read", "Please verify that you are human before reading these filings. ".repeat(2), EXCERPT],
    ["partial", "Access denied. ".repeat(10), EXCERPT],
    ["read", EXCERPT, `403 Forbidden. ${EXCERPT}`],
    ["read", EXCERPT, `Không tìm thấy trang. ${EXCERPT}`],
  ]) {
    const receipts = [];
    const transport = steps([
      provider(discovery(), { tool: "web_search", annotations: [citation()] }),
      provider(reading({ status, contentExcerpt }), {
        tool: "web_fetch",
        annotations: [citation(URL, content)],
      }),
    ]);
    const result = await research({ ...transport, onReceipt: (receipt) => receipts.push(receipt) });
    assert.equal(result.status, "partial");
    assert.equal(result.sources[0].readStatus, "unavailable");
    assert.equal(result.sources[0].excerpt, "");
    assert.equal(result.error.code, "fetch_challenge_response");
    assert.equal(receipts[1].validation.status, "failed");
    assert.equal(receipts[1].validation.reason, "blocked_content");
    assert.equal(receipts[1].validation.structure.exactTarget, true);
    assert.equal(receipts[1].costUsd, 0.001);
  }
});

test("search requires execution and scoped citations; malformed output never becomes source evidence", async () => {
  for (const reply of [
    provider(discovery(), { annotations: [citation()] }),
    provider(
      { ...discovery(), sourceDomains: ["untrusted.vn"] },
      { tool: "web_search", annotations: [citation()] },
    ),
    provider(discovery([{ url: URL, title: "Public disclosures", snippet: EXCERPT }]), {
      tool: "web_search",
      annotations: [citation()],
    }),
    provider(discovery([{ url: 12345, title: "Invalid URL" }]), {
      tool: "web_search",
      annotations: [citation()],
    }),
    provider(discovery(), { tool: "web_search" }),
    provider(discovery([{ url: "https://untrusted.vn/report", title: "Off-scope" }]), {
      tool: "web_search",
      annotations: [citation("https://untrusted.vn/report")],
    }),
    provider(discovery(), { tool: "web_search", annotations: { invented: true } }),
  ]) {
    const transport = steps([reply]);
    const result = await research(transport);
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.sources, []);
    assert.equal(transport.requests.length, 1);
  }
});

test("failed fetch receipts identify structural reasons without retaining model text or unapproved URLs", async () => {
  const privateMarker = "UNTRUSTED_OUTPUT_MUST_NOT_BE_RETAINED";
  const otherUrl = "https://unapproved.invalid/private-output-path";
  const cases = [
    {
      output: null,
      reason: "top_level_keys",
      fields: { exactKeys: false, propertyCount: null, titleCharacters: null },
    },
    {
      output: reading({ [privateMarker]: privateMarker }),
      reason: "top_level_keys",
      fields: { exactKeys: false, propertyCount: 6 },
    },
    {
      output: reading({ url: otherUrl }),
      reason: "target_url_mismatch",
      fields: { exactTarget: false },
    },
    {
      output: reading({ title: "" }),
      reason: "title_text",
      fields: { titleText: false, titleCharacters: 0 },
    },
    {
      output: reading({ title: "   " }),
      reason: "title_text",
      fields: { titleText: false, titleCharacters: 3 },
    },
    {
      output: reading({ title: privateMarker.repeat(10) }),
      reason: "title_text",
      fields: { titleText: false, titleCharacters: privateMarker.length * 10 },
    },
    {
      output: reading({ contentExcerpt: { text: privateMarker } }),
      reason: "excerpt_text",
      fields: { excerptText: false, excerptCharacters: null },
    },
    {
      output: reading({ limitations: Array(9).fill(privateMarker) }),
      reason: "limitations_array",
      fields: { limitationsArray: false, limitationsCount: 9 },
    },
    {
      output: reading({ status: privateMarker }),
      reason: "reading_status",
      fields: { statusEnum: false, readingStatus: null },
    },
    {
      output: reading(),
      tool: "web_search",
      reason: "execution_unverified",
      fields: { exactTarget: true, readingStatus: "read" },
    },
  ];
  for (const { output, tool = "web_fetch", reason, fields } of cases) {
    const receipts = [];
    const transport = steps([
      provider(discovery(), { tool: "web_search", annotations: [citation()] }),
      provider(output, { tool, annotations: [citation(URL, EXCERPT)] }),
    ]);
    const result = await research({
      ...transport,
      onReceipt: (receipt) => receipts.push(structuredClone(receipt)),
    });
    assert.equal(result.status, "partial");
    assert.equal(result.sources[0].excerpt, "");
    assert.equal(result.error.code, "fetch_content_unverified");
    assert.equal(receipts.length, 2);
    assert.equal(transport.requests.length, 2);
    const validation = receipts[1].validation;
    assert.deepEqual(Object.keys(validation).sort(), [
      "code",
      "execution",
      "reason",
      "status",
      "structure",
    ]);
    assert.equal(validation.status, "failed");
    assert.equal(validation.reason, reason);
    assert.equal(validation.execution.invoked, tool === "web_fetch");
    assert.deepEqual(Object.keys(validation.structure).sort(), [
      "exactKeys",
      "exactTarget",
      "excerptCharacters",
      "excerptText",
      "limitationsArray",
      "limitationsCount",
      "propertyCount",
      "readingStatus",
      "statusEnum",
      "titleCharacters",
      "titleText",
    ]);
    for (const [field, expected] of Object.entries(fields))
      assert.equal(validation.structure[field], expected, `${reason}: ${field}`);
    assert.equal(receipts[1].costUsd, 0.001);
    const persisted = JSON.stringify(receipts);
    for (const value of [privateMarker, otherUrl, EXCERPT, INPUT.query])
      assert.equal(persisted.includes(value), false, `Do not retain ${value}`);
  }
});

test("directory names up to 600 characters survive without truncating stock identity", async () => {
  const name = "Fixture company ".repeat(35);
  const transport = steps([provider(discovery([]), { tool: "web_search" })]);
  const result = await research({ ...transport, stock: { ...STOCK, name } });
  assert.equal(result.companyName, name);
  assert.equal(JSON.parse(transport.requests[0].messages[1].content).companyName, name);
});

test("a receipt write failure preserves paid usage and stops before the next operation", async () => {
  for (const valid of [true, false]) {
    let writes = 0;
    const transport = steps([
      provider(discovery(), { tool: valid ? "web_search" : undefined, annotations: [citation()] }),
    ]);
    await assert.rejects(
      research({
        ...transport,
        onReceipt: () => {
          writes++;
          throw new Error("synthetic persistence error");
        },
      }),
      (error) => {
        assert.equal(error.code, "receipt_persistence_failed");
        assert.equal(error.receipts.length, 1);
        assert.equal(error.receipts[0].costUsd, 0.001);
        assert.equal(error.receipts[0].validation.status, valid ? "passed" : "failed");
        return true;
      },
    );
    assert.equal(writes, 1);
    assert.equal(transport.requests.length, 1);
  }
});

test("cancellation before work or after persisted discovery does not start a fetch or duplicate receipts", async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    research({
      signal: cancelled.signal,
      requestModel: async () => assert.fail("Already cancelled."),
    }),
    { code: "model_cancelled", status: 499 },
  );
  const controller = new AbortController(),
    receipts = [];
  const transport = steps([
    provider(discovery(), { tool: "web_search", annotations: [citation()] }),
  ]);
  await assert.rejects(
    research({
      ...transport,
      signal: controller.signal,
      onReceipt: (receipt) => {
        receipts.push(receipt);
        controller.abort();
      },
    }),
    { code: "model_cancelled", status: 499 },
  );
  assert.equal(receipts.length, 1);
  assert.equal(transport.requests.length, 1);
});

test("transport timeout and cancellation retain failed usage receipts without replaying the operation", async () => {
  const receipts = [];
  let calls = 0;
  const fetchImpl = async (_, { signal }) => {
    calls++;
    return new Promise((resolve, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
    );
  };
  const result = await research({
    fetchImpl,
    requestModel: (options) => requestSecuritiesModel({ ...options, timeoutMs: 15 }),
    onReceipt: (receipt) => receipts.push(receipt),
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.error.code, "provider_timeout");
  assert.equal(calls, 1);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].costUsd, null);
  const controller = new AbortController();
  const pending = research({
    fetchImpl,
    signal: controller.signal,
    onReceipt: (receipt) => receipts.push(receipt),
  });
  setTimeout(() => controller.abort(), 15);
  await assert.rejects(pending, { code: "model_cancelled", status: 499 });
  assert.equal(calls, 2);
  assert.equal(receipts.length, 2);
});

test("all transport retry receipts are published once and exact model routing remains mandatory", async () => {
  const receipts = [];
  const transport = steps([
    new Response(JSON.stringify({ error: { code: 429 } }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "0" },
    }),
    provider(discovery([]), { tool: "web_search" }),
  ]);
  await research({ ...transport, onReceipt: (receipt) => receipts.push(receipt) });
  assert.equal(receipts.length, 2);
  assert.deepEqual(
    receipts.map((receipt) => receipt.attempt),
    [1, 2],
  );
  const wrongModel = steps([
    provider(discovery(), {
      tool: "web_search",
      model: "meta/other-model",
      annotations: [citation()],
    }),
  ]);
  const result = await research(wrongModel);
  assert.equal(result.status, "unavailable");
  assert.equal(result.error.code, "provider_model_mismatch");
  assert.equal(wrongModel.requests.length, 1);
});

const searchTool = (domains) => ({
  type: "openrouter:web_search",
  parameters: {
    engine: "parallel",
    mode: "basic",
    allowed_domains: domains,
    max_results: 4,
    max_total_results: 8,
    max_uses: 2,
    max_characters: 2000,
  },
});
const requestOptions = (domains) => ({
  env: ENV,
  operation: "discovery",
  schema: { type: "object" },
  schemaName: "fixture_domain_contract",
  messages: [{ role: "user", content: "Synthetic source-scope fixture" }],
  tools: [searchTool(domains)],
  maxToolCalls: 2,
});

test("transport keeps the original issuer allowlist by default and permits only explicit bounded server scopes", async () => {
  for (const options of [
    requestOptions(["fpt.com", "bctn2025.fpt.com"]),
    requestOptions(["www.gemadept.com.vn"]),
    {
      ...requestOptions(["fixture-issuer.vn", "hnx.vn"]),
      sourceDomains: ["fixture-issuer.vn", "hnx.vn"],
    },
  ]) {
    const result = await requestSecuritiesModel({
      ...options,
      fetchImpl: async () => provider({}, { tool: "web_search" }),
    });
    assert.equal(result.receipt.actualModel, SECURITIES_MODEL_ID);
  }
  let keyReads = 0,
    calls = 0;
  const env = {
    SECURITIES_MODEL_MODE: "live",
    get SECURITIES_OPENROUTER_API_KEY() {
      keyReads++;
      return ENV.SECURITIES_OPENROUTER_API_KEY;
    },
  };
  for (const options of [
    requestOptions(["fixture-issuer.vn"]),
    { ...requestOptions(["hnx.vn"]), sourceDomains: ["fixture-issuer.vn"] },
    { ...requestOptions(["fpt.com"]), sourceDomains: null },
    { ...requestOptions(["fpt.com"]), sourceDomains: [] },
    { ...requestOptions(["fpt.com"]), sourceDomains: ["fpt.com", "fpt.com"] },
    requestOptions(["fpt.com", "fpt.com"]),
    { ...requestOptions(["fpt.com"]), sourceDomains: ["company.internal"] },
    { ...requestOptions(["fpt.com"]), sourceDomains: ["fpt.com"], tools: undefined },
  ]) {
    await assert.rejects(
      requestSecuritiesModel({
        ...options,
        env,
        fetchImpl: async () => {
          calls++;
          assert.fail("Rejected tool scope.");
        },
      }),
      { code: "invalid_model_tools" },
    );
  }
  await assert.rejects(
    requestSecuritiesModel({ ...requestOptions(["fpt.com"]), env, onReceipt: "not a callback" }),
    { code: "invalid_model_request" },
  );
  assert.equal(keyReads, 0);
  assert.equal(calls, 0);
});

test("cancellation during asynchronous key resolution never dispatches an upstream request", async () => {
  const controller = new AbortController();
  await assert.rejects(
    requestSecuritiesModel({
      ...requestOptions(["fpt.com"]),
      signal: controller.signal,
      env: {
        SECURITIES_MODEL_MODE: "live",
        SECURITIES_OPENROUTER_API_KEY: {
          async get() {
            controller.abort();
            return ENV.SECURITIES_OPENROUTER_API_KEY;
          },
        },
      },
      fetchImpl: async () =>
        assert.fail(
          "Cancellation must be checked after resolving the binding, before network dispatch.",
        ),
    }),
    { code: "model_cancelled", status: 499 },
  );
});
