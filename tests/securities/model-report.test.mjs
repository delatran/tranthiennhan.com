import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  analyzeSecurities,
  chatSecurities,
  SECURITIES_MODEL_ID,
  validateSecuritiesReadRequest,
} from "../../worker/securities/model.js";
import {
  validateSecuritiesReport,
  securitiesReportRepairFeedback,
  validateConsistencyCheck,
  applyConsistencyCheck,
  reportIdentity,
  securitiesReportSchema,
  securitiesReportInstruction,
  SECURITIES_CONSISTENCY_INSTRUCTION,
} from "../../worker/securities/model-report.js";
import {
  calculateDerivedMetrics,
  calculateDossierMetrics,
} from "../../shared/securities/finance.js";
import { createDossier } from "../../shared/securities/dossier.js";
import { loadSecuritiesDataset } from "../../worker/securities/sources.js";
import { getVerifiedSecuritiesFacts } from "../../shared/securities/verified-source-facts.js";
import { SECURITIES_METRICS } from "../../shared/securities/source-contract.js";

// These fixtures exercise the runtime contract. Simulated model verdicts and
// packets are never evidence of real model or original-document quality.
const env = {
  SECURITIES_MODEL_MODE: "live",
  SECURITIES_OPENROUTER_API_KEY: "sk-or-fixture-report-contract",
};
const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
function dossier() {
  const sourceHash = "a".repeat(64);
  const source = {
    id: "annual",
    version: "sha256:" + sourceHash,
    hash: sourceHash,
    url: "https://fpt.com/vi/nha-dau-tu/thong-tin-cong-bo",
    title: "Fixture financial source",
    pageCount: 20,
    excerpts: [
      {
        id: "basis",
        text: "The consolidated statement identifies the current and comparative reporting periods.",
        locator: { page: 1, precision: "page" },
      },
    ],
  };
  const point = (value, periodId) => ({
    value,
    unit: "VND",
    verification: "verified",
    sourceId: source.id,
    sourceVersion: source.version,
    periodId,
    entityId: "FPT",
    scope: "consolidated",
    basisId: "same_basis",
    dataKind: "actual",
    locator: { page: 1, precision: "cell" },
  });
  const value = {
    id: "fixture-report",
    revision: 1,
    locale: "en",
    company: { id: "FPT", ticker: "FPT", name: "FPT Corporation" },
    period: {
      id: "FY2025",
      label: { vi: "năm 2025", en: "FY 2025" },
      kind: "annual",
      scope: "consolidated",
      basisId: "same_basis",
    },
    comparisonPeriod: {
      id: "FY2024",
      label: { vi: "năm 2024", en: "FY 2024" },
      kind: "annual",
      scope: "consolidated",
      basisId: "same_basis",
    },
    metrics: [
      {
        id: "revenue",
        label: { vi: "Doanh thu", en: "Revenue" },
        unit: "VND",
        current: point(120_000_000_000, "FY2025"),
        comparison: point(100_000_000_000, "FY2024"),
      },
      {
        id: "profit_after_tax",
        label: { vi: "Lợi nhuận sau thuế", en: "Profit after tax" },
        unit: "VND",
        current: point(12_000_000_000, "FY2025"),
        comparison: point(15_000_000_000, "FY2024"),
      },
    ],
    sources: [source],
    issues: [],
    corrections: [],
    notes: "",
  };
  value.metrics = calculateDossierMetrics(value.metrics, value);
  return value;
}
function report(value = dossier(), overrides = {}) {
  const claims = [
    {
      id: "revenue",
      kind: "calculated",
      text: "Revenue {{metric:revenue:relativeChangePct:movement}} to {{metric:revenue:current}}, giving a larger sales base.",
      metricIds: ["revenue"],
      sourceIds: [value.sources[0].id],
      evidenceQuotes: [],
    },
  ];
  return {
    dossierId: value.id,
    revision: value.revision,
    action: "final",
    readRequests: [],
    claims,
    report: { summaryClaimIds: ["revenue"], sections: [] },
    gaps: [],
    limitations: [],
    ...overrides,
  };
}
function readRequest(value, query = "cash conversion", pages = [2]) {
  return { sourceId: value.sources[0].id, sourceVersion: value.sources[0].version, query, pages };
}
function readAction(value, requests) {
  return {
    dossierId: value.id,
    revision: value.revision,
    action: "read",
    readRequests: requests,
    claims: [],
    report: { summaryClaimIds: [], sections: [] },
    gaps: [],
    limitations: [],
  };
}
function packet(
  source,
  {
    pages = [1],
    facts = [],
    text = "Cash-flow source text is untrusted reference material and does not verify financial values.",
    mutate,
  } = {},
) {
  const extractionHash = "b".repeat(64);
  const representationHash = "c".repeat(64);
  const body = {
    sourceId: source.id,
    sourceVersion: source.version,
    sourceHash: source.hash,
    passages: pages.map((page) => ({
      id: "page-" + page,
      text,
      sourceId: source.id,
      sourceVersion: source.version,
      originalHash: source.hash,
      extractionHash,
      representationHash,
      locator: { page, precision: "passage", lineStart: 1, lineEnd: 3 },
      extractionMethod: "text",
      verification: "extracted_unreviewed",
      qualityFlags: ["text_layer_unreviewed"],
      pageHeader: {
        text: "Consolidated source page header with period and currency context.",
        locator: { page, precision: "passage" },
      },
    })),
    coverage: {
      searchedPageCount: source.pageCount,
      totalPages: source.pageCount,
      returnedPages: pages,
      truncated: false,
      nextCursor: null,
      unusablePages: [],
    },
    verifiedFacts: facts,
  };
  if (mutate) mutate(body);
  const ledgerHashes = [...new Set(facts.map((fact) => fact.verificationReceipt.sha256))];
  return {
    ...body,
    receipt: {
      evidenceType: "local_original",
      sourceId: source.id,
      sourceVersion: source.version,
      sourceHash: source.hash,
      parserVersion: "fixture-parser",
      extractionFileSha256: extractionHash,
      representationHash,
      verifiedLedgerSha256: ledgerHashes.length === 1 ? ledgerHashes[0] : null,
      verifiedLedgerHashes: ledgerHashes,
      responseSha256: hash(body),
    },
  };
}
function provider(candidate, { inspect, verdict, notesVerdict = "supported" } = {}) {
  let calls = 0;
  let drafts = 0;
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    const payload = JSON.parse(body.messages[1].content);
    calls += 1;
    assert.equal(body.model, SECURITIES_MODEL_ID);
    assert.deepEqual(body.provider, { allow_fallbacks: false, require_parameters: true });
    assert.deepEqual(body.tools, []);
    inspect?.(body, payload);
    let output;
    if (body.response_format.json_schema.name === "securities_report_consistency") {
      output = {
        dossierId: payload.dossierId,
        revision: payload.revision,
        narrativeHash: payload.narrativeHash,
        claims: payload.untrustedReport.claims.map((claim) => ({
          id: claim.id,
          verdict:
            verdict?.(claim, payload) ??
            (["hypothesis", "analyst_opinion"].includes(claim.kind)
              ? "supported_interpretation"
              : "supported"),
          reason: "Fixture check of the exact narrative and supplied evidence.",
        })),
        notes: {
          verdict: typeof notesVerdict === "function" ? notesVerdict(payload) : notesVerdict,
          reason: "Fixture notes support check.",
        },
      };
    } else {
      drafts += 1;
      output = typeof candidate === "function" ? candidate(drafts, payload) : candidate;
    }
    return new Response(
      JSON.stringify({
        id: "gen-report-fixture-" + calls,
        model: SECURITIES_MODEL_ID,
        provider: "Meta",
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: JSON.stringify(output) },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 40, cost: 0.00002 },
        openrouter_metadata: {
          requested: SECURITIES_MODEL_ID,
          strategy: "direct",
          endpoints: {
            available: [{ provider: "Meta", model: SECURITIES_MODEL_ID, selected: true }],
          },
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  };
  return {
    fetchImpl,
    get calls() {
      return calls;
    },
    get drafts() {
      return drafts;
    },
  };
}

function holdProviderResponse(signal) {
  let control;
  const aborted = () => control.error(signal.reason);
  const response = new Response(
    new ReadableStream({
      start(controller) {
        control = controller;
        control.enqueue(new TextEncoder().encode(" \n"));
        signal.addEventListener("abort", aborted, { once: true });
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
  return {
    response,
    signal,
    complete(json) {
      signal.removeEventListener("abort", aborted);
      control.enqueue(new TextEncoder().encode(json));
      control.close();
    },
  };
}

test("mandatory reading and consistency retain shorter deadlines while report-capable generation and explicit overrides use their own bounds", async (t) => {
  for (const phase of [
    { name: "mandatory reading", call: 1, budget: 90_000, actions: ["read"] },
    { name: "report-capable generation", call: 1, budget: 180_000, actions: ["read", "final"] },
    { name: "consistency", call: 2, budget: 90_000, actions: undefined },
  ]) {
    for (const override of [undefined, 25]) {
      await t.test(
        `${phase.name}, ${override === undefined ? "default" : "explicit"} deadline`,
        async (t) => {
          t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
          const value = dossier();
          const engine = provider(report(value));
          const ready = Promise.withResolvers();
          let calls = 0;
          const pending = analyzeSecurities({
            dossier: value,
            env,
            locale: "en",
            timeoutMs: override,
            ...(phase.name === "mandatory reading"
              ? {
                  question: "Why did profit change?",
                  readEvidence: async () => packet(value.sources[0]),
                }
              : {}),
            fetchImpl: async (url, options) => {
              calls += 1;
              if (calls !== phase.call) return engine.fetchImpl(url, options);
              const request = JSON.parse(options.body);
              assert.deepEqual(
                request.response_format.json_schema.schema.properties.action?.enum,
                phase.actions,
              );
              assert.equal(request.max_tokens, 12_000);
              const held = holdProviderResponse(options.signal);
              ready.resolve(held);
              return held.response;
            },
          });
          const failed = assert.rejects(pending, (error) => {
            assert.equal(error.code, "provider_timeout");
            assert.equal(error.receipts.length, phase.call);
            const receipt = error.receipts.at(-1);
            assert.equal(receipt.costUsd, null);
            assert.equal(receipt.httpStatus, 200);
            assert.equal(receipt.responseDiagnostic.phase, "stream_read");
            assert.equal(receipt.responseDiagnostic.endOfStream, false);
            return true;
          });
          const held = await ready.promise;
          const budget = override ?? phase.budget;
          t.mock.timers.tick(budget - 1);
          assert.equal(held.signal.aborted, false);
          t.mock.timers.tick(1);
          await failed;
          assert.equal(held.signal.reason.name, "TimeoutError");
          assert.equal(calls, phase.call, "a timed-out generation must not be replayed or checked");
        },
      );
    }
  }
});

test("a report completed after the former deadline reaches every validation check without extending a finished request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const value = dossier();
  const engine = provider(report(value));
  const ready = Promise.withResolvers();
  const pending = analyzeSecurities({
    dossier: value,
    env,
    locale: "en",
    fetchImpl: async (url, options) => {
      const response = await engine.fetchImpl(url, options);
      if (engine.calls !== 1) return response;
      const body = await response.text();
      const held = holdProviderResponse(options.signal);
      ready.resolve({ ...held, body });
      return held.response;
    },
  });
  const held = await ready.promise;
  t.mock.timers.tick(116_269);
  assert.equal(held.signal.aborted, false);
  held.complete(held.body);
  const result = await pending;
  assert.equal(result.validation.deterministic.status, "passed");
  assert.equal(result.validation.semantic.status, "passed");
  assert.equal(result.receipts[0].latencyMs, 116_269);
  assert.equal(result.receipts.length, 2);
  assert.equal(engine.calls, 2);
  t.mock.timers.tick(180_000);
  assert.equal(held.signal.aborted, false, "the completed request must clear its timer");
});

test("parent cancellation still aborts a report-capable stream after the shorter deadline and preserves its unknown-cost receipt", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const controller = new AbortController();
  const ready = Promise.withResolvers();
  let calls = 0;
  const pending = analyzeSecurities({
    dossier: dossier(),
    env,
    signal: controller.signal,
    fetchImpl: async (_url, options) => {
      calls += 1;
      const held = holdProviderResponse(options.signal);
      ready.resolve(held);
      return held.response;
    },
  });
  const failed = assert.rejects(pending, (error) => {
    assert.equal(error.code, "model_cancelled");
    assert.equal(error.receipts.length, 1);
    assert.equal(error.receipts[0].errorCode, "model_cancelled");
    assert.equal(error.receipts[0].costUsd, null);
    return true;
  });
  const held = await ready.promise;
  t.mock.timers.tick(90_001);
  assert.equal(held.signal.aborted, false);
  controller.abort(new DOMException("Parent job expired", "TimeoutError"));
  await failed;
  assert.equal(held.signal.aborted, true);
  assert.equal(calls, 1);
});

test("concise report guidance preserves the existing hard claim, quotation and summary bounds", () => {
  const value = dossier();
  const schema = securitiesReportSchema(value);
  assert.equal(schema.properties.claims.maxItems, 14);
  assert.equal(schema.properties.claims.items.properties.text.maxLength, 1800);
  assert.equal(schema.properties.claims.items.properties.evidenceQuotes.maxItems, 6);
  assert.equal(schema.properties.report.properties.summaryClaimIds.maxItems, 3);
  assert.match(schema.properties.claims.description, /six to eight/u);
  assert.match(schema.properties.claims.items.properties.evidenceQuotes.description, /one or two/u);
  assert.match(
    securitiesReportInstruction("analysis"),
    /never a reason to omit a material answer or supporting evidence/u,
  );
  assert.equal(
    validateSecuritiesReport(report(value), value).claims.length,
    1,
    "the concision target must not impose a minimum claim count",
  );
});

test("natural report retains readable prose while currency rounding and evidence remain server-bound", () => {
  const value = dossier();
  value.metrics[0].current.value = 26_268_500_667_974;
  value.metrics[0].comparison.value = 23_325_685_794_923;
  value.metrics = calculateDossierMetrics(value.metrics, value);
  const input = report(value);
  input.claims[0].text =
    "Doanh thu {{metric:revenue:relativeChangePct:movement}} lên {{metric:revenue:current}}.";
  const result = validateSecuritiesReport(input, value, "vi");
  assert.equal(result.claims[0].text, "Doanh thu tăng 12,62% lên 26,27 nghìn tỷ đồng.");
  assert.equal(result.claims[0].numericOrigins[0].sourceValue, 26_268_500_667_974);
  const percentage = result.claims[0].numericDisplays.find(
    (item) => item.field === "relativeChangePct",
  );
  assert.equal(percentage.unit, "percent");
  assert.equal(percentage.value.toFixed(2), "12.62");
  assert.equal(result.claims[0].numericOrigins[0].sourceUnit, "VND");
  assert.equal(result.claims[0].numericOrigins[0].displayUnit, "VND");
  assert.equal(
    result.claims[0].numericDisplays.find((item) => item.field === "current").value,
    26_268_500_667_974,
  );
  assert.equal(result.summary, result.claims[0].text);
  assert.equal(result.reportVersion, "securities-analyst-report");
});

test("derived margin and percentage-point change use the shared ledger with all four input origins", () => {
  const value = dossier();
  const input = report(value, {
    claims: [
      {
        id: "margin",
        kind: "calculated",
        text: "Profit after tax retained {{derived:profit_after_tax_margin:current}} of revenue versus {{derived:profit_after_tax_margin:comparison}}; the change was {{derived:profit_after_tax_margin:percentagePointChange}}.",
        metricIds: ["profit_after_tax", "revenue"],
        sourceIds: ["annual"],
        evidenceQuotes: [],
      },
    ],
    report: { summaryClaimIds: ["margin"], sections: [] },
  });
  const checked = validateSecuritiesReport(input, value, "en");
  assert.match(checked.summary, /10% of revenue versus 15%; the change was -5 percentage points/);
  assert.equal(checked.claims[0].numericOrigins.length, 4);
  input.claims[0].metricIds = ["profit_after_tax"];
  assert.throws(() => validateSecuritiesReport(input, value), {
    code: "model_invalid_metric_binding",
  });
});

test("period and page answers use exact source context without permitting free numeric literals", () => {
  const value = dossier();
  const input = report(value, {
    claims: [
      {
        id: "page",
        kind: "source_fact",
        text: "For {{context:period}} versus {{context:comparisonPeriod}}, the cited disclosure is on PDF page {{source_page:basis}}.",
        metricIds: [],
        sourceIds: ["annual"],
        evidenceQuotes: [{ sourceId: "annual", quote: "{{source_excerpt:basis}}" }],
      },
    ],
    report: { summaryClaimIds: ["page"], sections: [] },
  });
  const checked = validateSecuritiesReport(input, value, "en");
  assert.equal(
    checked.summary,
    "For FY 2025 versus FY 2024, the cited disclosure is on PDF page 1.",
  );
  assert.equal(checked.claims[0].pageOrigins[0].page, 1);
  input.claims[0].text = input.claims[0].text.replace("{{source_page:basis}}", "18");
  assert.throws(() => validateSecuritiesReport(input, value), {
    code: "model_unbound_numeric_output",
  });
});

test("bare page tokens remain visibly labeled next to a numerical value in both languages", () => {
  for (const locale of ["vi", "en"]) {
    const value = dossier();
    const input = report(value);
    input.claims[0].text =
      "Revenue {{metric:revenue:relativeChangePct:movement}}{{source_page:basis}}.";
    const result = validateSecuritiesReport(input, value, locale);
    assert.match(result.summary, locale === "vi" ? /20% \(trang 1\)/u : /20% \(PDF page 1\)/u);
    assert.equal(result.claims[0].pageOrigins[0].page, 1);
    assert.equal(result.claims[0].pageOrigins[0].sourceVersion, value.sources[0].version);
  }
});

test("the summary limit counts expanded values and never truncates an accepted finding", () => {
  const value = dossier();
  const input = report(value);
  input.claims[0].text =
    "Revenue {{metric:revenue:relativeChangePct:movement}}. " + "Useful explanation ".repeat(90);
  assert.throws(() => validateSecuritiesReport(input, value, "en"), {
    code: "model_summary_too_long",
  });
  input.claims[0].text =
    "Revenue {{metric:revenue:relativeChangePct:movement}}. " + "Useful explanation ".repeat(60);
  assert.doesNotThrow(() => validateSecuritiesReport(input, value, "en"));
});

test("summary references repeated in one body section are normalized without altering financial claims", () => {
  const value = dossier();
  const input = report(value);
  input.claims.push({
    id: "profit",
    kind: "source_fact",
    text: "Profit after tax was {{metric:profit_after_tax:current}}.",
    metricIds: ["profit_after_tax"],
    sourceIds: ["annual"],
    evidenceQuotes: [],
  });
  input.report.sections = [{ id: "performance", claimIds: ["revenue", "profit"] }];
  const before = JSON.stringify(input);
  const result = validateSecuritiesReport(input, value, "en");
  assert.deepEqual(result.report.summaryClaimIds, ["revenue"]);
  assert.deepEqual(result.report.sections, [{ id: "performance", claimIds: ["profit"] }]);
  assert.deepEqual(
    result.claims.map((claim) => claim.id),
    ["revenue", "profit"],
  );
  assert.equal(result.claims[0].numericOrigins[0].metricId, "revenue");
  assert.equal(JSON.stringify(input), before);
  input.report.summaryClaimIds.push("profit");
  assert.deepEqual(validateSecuritiesReport(input, value).report.sections, []);
});

test("section schema requires claim references and runtime rejects empty sections without changing claims", () => {
  const value = dossier();
  const sectionsSchema = securitiesReportSchema(value).properties.report.properties.sections;
  assert.equal(sectionsSchema.items.properties.claimIds.minItems, 1);
  const input = report(value);
  input.claims.push({
    id: "profit",
    kind: "source_fact",
    text: "Profit after tax was {{metric:profit_after_tax:current}}.",
    metricIds: ["profit_after_tax"],
    sourceIds: ["annual"],
    evidenceQuotes: [],
  });
  input.report.sections = [
    { id: "performance", claimIds: ["profit"] },
    { id: "earnings_quality", claimIds: [] },
    { id: "outlook", claimIds: [] },
  ];
  const originalClaims = structuredClone(input.claims);
  assert.throws(() => validateSecuritiesReport(input, value, "en"), {
    code: "model_invalid_output",
    validationReason: "section_claim_refs",
  });
  input.report.sections = [{ id: "performance", claimIds: ["profit"] }];
  const result = validateSecuritiesReport(input, value, "en");
  assert.deepEqual(result.report.sections, input.report.sections);
  assert.deepEqual(input.claims, originalClaims);
  assert.equal(result.claims[1].numericOrigins[0].metricId, "profit_after_tax");
  assert.doesNotThrow(() => validateSecuritiesReport(report(value), value, "en"));
});

test("layout normalization still rejects unknown, repeated body and omitted claim references", () => {
  for (const mutate of [
    (input) => {
      input.report.sections = [{ id: "performance", claimIds: ["unknown"] }];
    },
    (input) => {
      input.report.sections = [{ id: "performance", claimIds: ["revenue", "revenue"] }];
    },
    (input) => {
      input.report.sections = [
        { id: "performance", claimIds: ["revenue"] },
        { id: "outlook", claimIds: ["revenue"] },
      ];
    },
    (input) => {
      input.claims.push({ ...structuredClone(input.claims[0]), id: "omitted" });
    },
  ]) {
    const value = dossier(),
      input = report(value);
    mutate(input);
    assert.throws(() => validateSecuritiesReport(input, value), { code: "model_invalid_output" });
  }
});

test("fixed hundred-unit definitions require the verified ratio denominator and cannot conceal an amount", () => {
  const value = dossier();
  const template = (definition, token = "{{derived:profit_after_tax_margin:current:per100}}") =>
    report(value, {
      claims: [
        {
          id: "margin",
          kind: "calculated",
          text: definition + token + ".",
          sourceIds: ["annual"],
          metricIds: ["profit_after_tax", "revenue"],
          evidenceQuotes: [],
        },
      ],
      report: { summaryClaimIds: ["margin"], sections: [] },
    });
  for (const [locale, definition] of [
    ["vi", "Biên lợi nhuận, hiểu là lợi nhuận giữ lại trên mỗi trăm đồng doanh thu, là "],
    ["vi", "Biên lợi nhuận, hiểu là lợi nhuận giữ lại trên mỗi một trăm đồng doanh thu, là "],
    ["en", "Profit margin, meaning retained profit per one hundred VND of revenue, was "],
  ])
    assert.doesNotThrow(() => validateSecuritiesReport(template(definition), value, locale));
  for (const definition of [
    "Biên lợi nhuận giữ lại trên mỗi năm trăm đồng doanh thu là ",
    "Profit margin, meaning an additional one hundred billion dollars, was ",
    "Biên lợi nhuận giữ lại trên mỗi trăm đồng lợi nhuận sau thuế là ",
  ])
    assert.throws(() => validateSecuritiesReport(template(definition), value, "en"), {
      code: "model_unbound_numeric_output",
    });
  assert.throws(
    () =>
      validateSecuritiesReport(
        template(
          "Biên lợi nhuận trên mỗi trăm đồng doanh thu là ",
          "{{metric:profit_after_tax:current}}",
        ),
        value,
        "vi",
      ),
    { code: "model_unbound_numeric_output" },
  );
});

test("negative CFO alone cannot assert weak collections even if a model checker would agree", () => {
  const value = dossier();
  const cfo = structuredClone(value.metrics[0]);
  cfo.id = "operating_cash_flow";
  cfo.label = { vi: "Dòng tiền kinh doanh", en: "Operating cash flow" };
  cfo.current.value = -1_000_000_000;
  value.metrics = calculateDossierMetrics([...value.metrics, cfo], value);
  const input = report(value);
  input.claims[0] = {
    id: "cash",
    kind: "source_fact",
    sourceIds: ["annual"],
    metricIds: ["operating_cash_flow"],
    evidenceQuotes: [],
    text: "Operating cash flow was {{metric:operating_cash_flow:current}}, showing weak cash collection.",
  };
  input.report.summaryClaimIds = ["cash"];
  assert.throws(() => validateSecuritiesReport(input, value, "en"), {
    code: "model_unsupported_causal_claim",
  });
  input.claims[0].text =
    "Operating cash flow was {{metric:operating_cash_flow:current}}. This means net cash used in operations; it does not necessarily prove weak cash collection.";
  assert.doesNotThrow(() => validateSecuritiesReport(input, value, "en"));
  input.claims[0].text =
    "Dòng tiền kinh doanh là {{metric:operating_cash_flow:current}}, cho thấy thu tiền yếu.";
  assert.throws(() => validateSecuritiesReport(input, value, "vi"), {
    code: "model_unsupported_causal_claim",
  });
  input.claims[0].text =
    "Dòng tiền kinh doanh là {{metric:operating_cash_flow:current}}. Dòng tiền âm chỉ cho biết tiền ròng dùng trong hoạt động kinh doanh, chưa tự nó kết luận thu tiền yếu hay mất tiền.";
  assert.doesNotThrow(() => validateSecuritiesReport(input, value, "vi"));
  input.claims[0].text =
    "Dòng tiền kinh doanh là {{metric:operating_cash_flow:current}}. Dòng tiền âm nghĩa là hoạt động kinh doanh dùng tiền ròng trong kỳ, không đồng nghĩa với thu tiền kém hay gian lận khi chưa có thuyết minh vốn lưu động đầy đủ.";
  assert.doesNotThrow(() => validateSecuritiesReport(input, value, "vi"));
  for (const text of [
    "Operating cash flow was {{metric:operating_cash_flow:current}}. This does not prove fraud, but weak cash collection is established.",
    "Dòng tiền kinh doanh là {{metric:operating_cash_flow:current}}. Chưa tự nó kết luận gian lận nhưng thu tiền yếu đã rõ.",
  ]) {
    input.claims[0].text = text;
    assert.throws(() => validateSecuritiesReport(input, value, "en"), {
      code: "model_unsupported_causal_claim",
    });
  }
});

test("complete observed cash-risk denial lists retain negation through bad debt and lost money", () => {
  const value = dossier();
  const cfo = structuredClone(value.metrics[0]);
  cfo.id = "operating_cash_flow";
  cfo.current.value = -1_000_000_000;
  value.metrics = calculateDossierMetrics([...value.metrics, cfo], value);
  const input = report(value, {
    claims: [
      {
        id: "c-cash",
        kind: "calculated",
        sourceIds: ["annual"],
        metricIds: ["operating_cash_flow", "profit_after_tax"],
        evidenceQuotes: [],
        text: "",
      },
    ],
    report: { summaryClaimIds: ["c-cash"], sections: [] },
  });
  for (const text of [
    "Dòng tiền thuần từ hoạt động kinh doanh kỳ này mang giá trị âm, trong khi lợi nhuận sau thuế dương, nên tỷ lệ dòng tiền kinh doanh trên lợi nhuận sau thuế mang giá trị âm là {{derived:operating_cash_flow_to_profit:current}}. Dòng tiền âm nghĩa là hoạt động kinh doanh dùng tiền ròng trong kỳ, nhưng tự nó không chứng minh thu tiền kém, nợ xấu, mất tiền hay mất khả năng thanh toán.",
    "Dòng tiền thuần từ hoạt động kinh doanh kỳ này là {{metric:operating_cash_flow:current}} trong khi lợi nhuận sau thuế dương, nên chỉ dấu dòng tiền kinh doanh trên lợi nhuận sau thuế là {{derived:operating_cash_flow_to_profit:current}}. Dòng tiền âm nghĩa là hoạt động kinh doanh dùng tiền ròng trong kỳ, nhưng tự nó không chứng minh thu tiền kém, nợ xấu, mất tiền hay mất khả năng thanh toán, và cũng không phải tỷ lệ thu tiền của khách hàng.",
  ]) {
    input.claims[0].text = text;
    assert.doesNotThrow(() => validateSecuritiesReport(input, value, "vi"));
  }
  input.claims[0].kind = "source_fact";
  for (const conclusion of [
    "Dòng tiền âm cho thấy nợ xấu, mất tiền và mất khả năng thanh toán.",
    "Dòng tiền âm không chứng minh thu tiền kém, nợ xấu, nhưng mất tiền đã rõ.",
    "Dòng tiền âm không chứng minh thu tiền kém, nợ xấu, và mất khả năng thanh toán đã được xác lập.",
    "Dòng tiền âm không chứng minh thu tiền kém, nợ xấu. Mất tiền.",
  ]) {
    input.claims[0].text =
      "Dòng tiền kinh doanh là {{metric:operating_cash_flow:current}}. " + conclusion;
    assert.throws(() => validateSecuritiesReport(input, value, "vi"), {
      code: "model_unsupported_causal_claim",
    });
  }
  value.sources[0].excerpts.push({
    id: "bad-debt",
    text: "The company reported bad debts during the period.",
    locator: { page: 1, precision: "page" },
  });
  input.claims[0].evidenceQuotes = [{ sourceId: "annual", quote: "{{source_excerpt:bad-debt}}" }];
  input.claims[0].text =
    "Operating cash flow was {{metric:operating_cash_flow:current}}. The company reported bad debts during the period.";
  assert.doesNotThrow(() => validateSecuritiesReport(input, value, "en"));
  input.claims[0].text =
    "Operating cash flow was {{metric:operating_cash_flow:current}}, establishing lost money and weak collections.";
  assert.throws(() => validateSecuritiesReport(input, value, "en"), {
    code: "model_unsupported_causal_claim",
  });
});

test("Vietnamese cash-cause disclaimers stay non-assertive with numeric or qualitative CFO evidence", async (t) => {
  const pairs = [
    {
      name: "cannot conclude",
      denial: "Không thể kết luận thu tiền kém.",
      assertion: "Có thể kết luận thu tiền kém.",
    },
    {
      name: "no evidence",
      denial: "Chưa có bằng chứng về thu tiền kém.",
      assertion: "Đã có bằng chứng về thu tiền kém.",
    },
    {
      name: "not established",
      denial: "Thu tiền kém chưa được xác lập từ tài liệu đã đọc.",
      assertion: "Thu tiền kém đã được xác lập từ tài liệu đã đọc.",
    },
  ];
  for (const [binding, prefix] of [
    ["numeric", "Dòng tiền kinh doanh kỳ này là {{metric:operating_cash_flow:current}}."],
    ["qualitative", "Dòng tiền kinh doanh kỳ này âm."],
  ]) {
    for (const { name, denial, assertion } of pairs) {
      await t.test(`${binding}: ${name}`, () => {
        const { value, claim } = cashBindingFixture();
        Object.assign(claim, {
          kind: "source_fact",
          metricIds: ["operating_cash_flow"],
          evidenceQuotes: [{ sourceId: "annual", quote: "{{source_excerpt:cash-note}}" }],
          text: `${prefix} ${denial}`,
        });
        const candidate = report(value, {
          claims: [claim],
          report: { summaryClaimIds: [claim.id], sections: [] },
        });
        const accepted = validateSecuritiesReport(candidate, value, "vi");
        assert.ok(accepted.claims[0].text.endsWith(denial));
        assert.equal(accepted.claims[0].evidenceQuotes[0].locator.page, 13);
        claim.text = `${prefix} ${assertion}`;
        assert.throws(() => validateSecuritiesReport(candidate, value, "vi"), {
          code: "model_unsupported_causal_claim",
          validationReason: "cash_cause_without_support",
          validationClaimId: claim.id,
        });
      });
    }
  }
});

test("cash-cause disclaimers do not excuse an affirmative clause or create supporting source evidence", () => {
  const { value, claim } = cashBindingFixture();
  Object.assign(claim, {
    kind: "source_fact",
    metricIds: ["operating_cash_flow"],
    evidenceQuotes: [{ sourceId: "annual", quote: "{{source_excerpt:cash-note}}" }],
  });
  const candidate = report(value, {
    claims: [claim],
    report: { summaryClaimIds: [claim.id], sections: [] },
  });
  const prefix = "Dòng tiền kinh doanh kỳ này là {{metric:operating_cash_flow:current}}. ";
  for (const text of [
    "Không thể kết luận nợ xấu, nhưng thu tiền kém đã rõ.",
    "Chưa có bằng chứng về nợ xấu, và thu tiền kém đã được xác lập.",
    "Thu tiền kém chưa được xác lập từ tài liệu đã đọc; mất tiền đã rõ.",
    "Không thể kết luận nợ xấu. Thu tiền kém.",
    "Thu tiền kém đã rõ, nhưng chưa có bằng chứng về nợ xấu.",
    "Thu tiền kém đã được xác lập, còn mất tiền chưa được xác lập từ tài liệu đã đọc.",
  ]) {
    claim.text = prefix + text;
    assert.throws(
      () => validateSecuritiesReport(candidate, value, "vi"),
      { code: "model_unsupported_causal_claim", validationReason: "cash_cause_without_support" },
      text,
    );
  }
  const excerpt = { id: "cash-cause", text: "", locator: { page: 13 } };
  value.sources[0].excerpts.push(excerpt);
  claim.evidenceQuotes.push({ sourceId: "annual", quote: "{{source_excerpt:cash-cause}}" });
  claim.text = prefix + "Thu tiền kém đã được xác lập từ tài liệu đã đọc.";
  for (const text of [
    "Không thể kết luận thu tiền kém.",
    "Chưa có bằng chứng về thu tiền kém.",
    "Thu tiền kém chưa được xác lập từ tài liệu đã đọc.",
  ]) {
    excerpt.text = text;
    assert.throws(
      () => validateSecuritiesReport(candidate, value, "vi"),
      { code: "model_unsupported_causal_claim", validationReason: "cash_cause_without_support" },
      text,
    );
  }
  excerpt.text = "Báo cáo xác nhận tình trạng thu tiền kém trong kỳ.";
  assert.doesNotThrow(() => validateSecuritiesReport(candidate, value, "vi"));
});

test("numeric labels reject direct metric swaps and sign reversal while accepting valid multi-clause language", () => {
  const value = dossier();
  for (const [text, code] of [
    ["Profit grew by {{metric:revenue:relativeChangePct}}.", "model_numeric_narrative_mismatch"],
    [
      "Revenue decreased by {{metric:revenue:relativeChangePct}}.",
      "model_numeric_narrative_mismatch",
    ],
    ["Revenue was {{metric:revenue:current}} trillion dollars.", "model_unbound_numeric_output"],
  ]) {
    const input = report(value);
    input.claims[0].text = text;
    assert.throws(() => validateSecuritiesReport(input, value), { code });
  }
  const input = report(value);
  input.claims[0].text = "Profit fell, but revenue {{metric:revenue:relativeChangePct:movement}}.";
  assert.match(validateSecuritiesReport(input, value).summary, /revenue tăng 20%/);
  const cfo = structuredClone(value.metrics[0]);
  cfo.id = "operating_cash_flow";
  cfo.current.value = -1_000_000_000;
  cfo.calculation = calculateDossierMetrics([cfo], value)[0].calculation;
  value.metrics.push(cfo);
  input.claims[0] = {
    id: "cash",
    kind: "source_fact",
    text: "Lợi nhuận tăng nhưng dòng tiền kinh doanh là {{metric:operating_cash_flow:current}}.",
    sourceIds: ["annual"],
    metricIds: ["operating_cash_flow"],
    evidenceQuotes: [],
  };
  input.report.summaryClaimIds = ["cash"];
  assert.match(validateSecuritiesReport(input, value).summary, /-1 tỷ đồng/);
});

test("invented financial amounts in words are rejected without banning ordinary qualitative prose", () => {
  for (const amount of [
    "one hundred billion dollars",
    "fifty billion dollars",
    "chín trăm tỷ đồng",
    "hai mươi phần trăm",
  ]) {
    const value = report();
    value.claims[0].text += " Additional revenue was " + amount + ".";
    assert.throws(() => validateSecuritiesReport(value, dossier()), {
      code: "model_unbound_numeric_output",
    });
  }
  const value = report();
  value.limitations = ["One concern remains the distinction between accounting income and cash."];
  assert.doesNotThrow(() => validateSecuritiesReport(value, dossier()));
});

const CFO_CURRENT = "{{metric:operating_cash_flow:current}}";
const PAT_CURRENT = "{{metric:profit_after_tax:current}}";

async function vscLabelFixture() {
  const dataset = await loadSecuritiesDataset({
    companyId: "VSC",
    periodId: "H1_2026",
    comparisonPeriodId: "H1_2025",
  });
  return createDossier(dataset, { id: "fixture-vsc-label-binding", locale: "vi" });
}

function labelReport(value, text, id = "label-check") {
  const metricIds = [
    ...new Set([...text.matchAll(/\{\{metric:([^:]+):/gu)].map((match) => match[1])),
  ];
  return report(value, {
    claims: [
      {
        id,
        kind: metricIds.some((metricId) => text.includes(`{{metric:${metricId}:relativeChangePct`))
          ? "calculated"
          : "source_fact",
        text,
        metricIds,
        sourceIds: ["vsc-h1-2026"],
        evidenceQuotes: metricIds.map((metricId) => ({
          sourceId: "vsc-h1-2026",
          quote: `{{source_excerpt:row-${metricId}}}`,
        })),
      },
    ],
    report: { summaryClaimIds: [id], sections: [] },
  });
}

test("the frozen ten Vietnamese label probes accept truthful syntax and reject the exact swapped negatives", async () => {
  const value = await vscLabelFixture();
  const evidenceBefore = JSON.stringify({ metrics: value.metrics, sources: value.sources });
  // These exact sentences and expectations were frozen before the fix. They are
  // synthetic syntax probes, not the unavailable failed provider claim.
  const probes = [
    [
      "direct_correct",
      true,
      `Dòng tiền kinh doanh đạt ${CFO_CURRENT}; lợi nhuận sau thuế đạt ${PAT_CURRENT}.`,
    ],
    [
      "parallel_lan_luot_correct",
      true,
      `Dòng tiền kinh doanh và lợi nhuận sau thuế lần lượt đạt ${CFO_CURRENT} và ${PAT_CURRENT}.`,
    ],
    [
      "parallel_tuong_ung_correct",
      true,
      `Lợi nhuận sau thuế và dòng tiền kinh doanh có giá trị tương ứng là ${PAT_CURRENT} và ${CFO_CURRENT}.`,
    ],
    [
      "comparison_prefix_correct",
      true,
      `Khi đối chiếu với lợi nhuận sau thuế, dòng tiền kinh doanh đạt ${CFO_CURRENT}.`,
    ],
    [
      "comparison_parenthetical_correct",
      true,
      `Dòng tiền kinh doanh (khi đối chiếu với lợi nhuận sau thuế) đạt ${CFO_CURRENT}.`,
    ],
    [
      "discussion_repeated_subjects_correct",
      true,
      `Đọc lợi nhuận sau thuế cùng dòng tiền kinh doanh để phân biệt kết quả kế toán với tiền. Lợi nhuận sau thuế đạt ${PAT_CURRENT}; dòng tiền kinh doanh đạt ${CFO_CURRENT}.`,
    ],
    [
      "direct_swapped",
      false,
      `Dòng tiền kinh doanh đạt ${PAT_CURRENT}; lợi nhuận sau thuế đạt ${CFO_CURRENT}.`,
    ],
    [
      "parallel_lan_luot_swapped",
      false,
      `Dòng tiền kinh doanh và lợi nhuận sau thuế lần lượt đạt ${PAT_CURRENT} và ${CFO_CURRENT}.`,
    ],
    [
      "parallel_tuong_ung_swapped",
      false,
      `Lợi nhuận sau thuế và dòng tiền kinh doanh có giá trị tương ứng là ${CFO_CURRENT} và ${PAT_CURRENT}.`,
    ],
    [
      "comparison_parenthetical_swapped",
      false,
      `Dòng tiền kinh doanh (khi đối chiếu với lợi nhuận sau thuế) đạt ${PAT_CURRENT}.`,
    ],
  ];
  for (const [id, accepted, text] of probes) {
    const candidate = labelReport(value, text, id);
    if (accepted) {
      const validated = validateSecuritiesReport(candidate, value, "vi");
      assert.ok(
        validated.claims[0].numericOrigins.every(
          (origin) => origin.version === value.sources[0].version,
        ),
      );
    } else
      assert.throws(
        () => validateSecuritiesReport(candidate, value, "vi"),
        { validationReason: "numeric_label_mismatch" },
        id,
      );
  }
  assert.equal(JSON.stringify({ metrics: value.metrics, sources: value.sources }), evidenceBefore);
});

test("ordered lists bind English respectively and every value in longer bilingual lists", async () => {
  const value = await vscLabelFixture();
  const revenue = "{{metric:revenue:current}}";
  for (const [locale, text] of [
    [
      "en",
      `Operating cash flow and profit after tax were ${CFO_CURRENT} and ${PAT_CURRENT}, respectively.`,
    ],
    [
      "en",
      `Operating cash flow (compared with profit after tax) and profit after tax were ${CFO_CURRENT} and ${PAT_CURRENT}, respectively.`,
    ],
    [
      "vi",
      `Dòng tiền kinh doanh (theo báo cáo về lợi nhuận sau thuế) và lợi nhuận sau thuế lần lượt đạt ${CFO_CURRENT} và ${PAT_CURRENT}.`,
    ],
    [
      "en",
      `Revenue, operating cash flow and profit after tax were ${revenue}, ${CFO_CURRENT} and ${PAT_CURRENT}, respectively.`,
    ],
    [
      "vi",
      `Doanh thu, dòng tiền kinh doanh và lợi nhuận sau thuế lần lượt đạt ${revenue}, ${CFO_CURRENT} và ${PAT_CURRENT}.`,
    ],
  ]) {
    assert.doesNotThrow(
      () => validateSecuritiesReport(labelReport(value, text), value, locale),
      text,
    );
    const swapped = text
      .replace(CFO_CURRENT, "SWAP_CFO")
      .replace(PAT_CURRENT, CFO_CURRENT)
      .replace("SWAP_CFO", PAT_CURRENT);
    assert.throws(
      () => validateSecuritiesReport(labelReport(value, swapped), value, locale),
      { validationReason: "numeric_label_mismatch" },
      swapped,
    );
  }
  for (const text of [
    `Dòng tiền kinh doanh kỳ này và kỳ trước lần lượt đạt ${CFO_CURRENT} và {{metric:operating_cash_flow:comparison}}.`,
    `Operating cash flow in the current and comparison periods was ${CFO_CURRENT} and {{metric:operating_cash_flow:comparison}}, respectively.`,
    `Dòng tiền kinh doanh đạt ${CFO_CURRENT}, so với {{metric:operating_cash_flow:comparison}} trong kỳ trước.`,
  ])
    assert.doesNotThrow(
      () =>
        validateSecuritiesReport(
          labelReport(value, text),
          value,
          text.startsWith("Operating") ? "en" : "vi",
        ),
      text,
    );
});

test("parenthetical numerical assertions keep their own labels and restore the outer subject", async () => {
  const value = await vscLabelFixture();
  for (const [locale, outerLabel, innerLabel, predicate] of [
    ["vi", "Dòng tiền kinh doanh", "lợi nhuận sau thuế", "đạt"],
    ["en", "Operating cash flow", "profit after tax", "was"],
  ]) {
    const sentence = (outer, inner) =>
      `${outerLabel} (${innerLabel} ${predicate} ${inner}) ${predicate} ${outer}.`;
    assert.doesNotThrow(() =>
      validateSecuritiesReport(
        labelReport(value, sentence(CFO_CURRENT, PAT_CURRENT)),
        value,
        locale,
      ),
    );
    for (const [outer, inner] of [
      [PAT_CURRENT, PAT_CURRENT],
      [CFO_CURRENT, CFO_CURRENT],
      [PAT_CURRENT, CFO_CURRENT],
    ]) {
      assert.throws(
        () => validateSecuritiesReport(labelReport(value, sentence(outer, inner)), value, locale),
        { validationReason: "numeric_label_mismatch" },
      );
    }
  }
  const parent = "{{metric:profit_parent:current}}";
  assert.doesNotThrow(() =>
    validateSecuritiesReport(
      labelReport(value, `Lợi nhuận (thuộc công ty mẹ) đạt ${parent}.`),
      value,
      "vi",
    ),
  );
  assert.throws(
    () =>
      validateSecuritiesReport(
        labelReport(value, `Lợi nhuận (thuộc công ty mẹ) đạt ${PAT_CURRENT}.`),
        value,
        "vi",
      ),
    { validationReason: "numeric_label_mismatch" },
  );
  assert.throws(
    () =>
      validateSecuritiesReport(
        labelReport(
          value,
          `Dòng tiền kinh doanh (theo báo cáo, lợi nhuận sau thuế đạt 999 đồng) đạt ${CFO_CURRENT}.`,
        ),
        value,
        "vi",
      ),
    { code: "model_unbound_numeric_output" },
  );
});

test("ordered and parenthetical mappings retain shared and per-value movement-direction checks", async () => {
  const value = await vscLabelFixture();
  const revenue = "{{metric:revenue:relativeChangePct}}";
  const profit = "{{metric:profit_after_tax:relativeChangePct}}";
  for (const [locale, text] of [
    ["vi", `Doanh thu và lợi nhuận sau thuế lần lượt tăng ${revenue} và ${profit}.`],
    ["en", `Revenue and profit after tax increased by ${revenue} and ${profit}, respectively.`],
  ])
    assert.doesNotThrow(
      () => validateSecuritiesReport(labelReport(value, text), value, locale),
      text,
    );
  for (const [locale, text] of [
    ["vi", `Doanh thu và lợi nhuận sau thuế lần lượt giảm ${revenue} và ${profit}.`],
    ["vi", `Doanh thu và lợi nhuận sau thuế lần lượt tăng ${revenue} và giảm ${profit}.`],
    [
      "en",
      `Revenue and profit after tax increased by ${revenue} and decreased by ${profit}, respectively.`,
    ],
    ["vi", `Dòng tiền kinh doanh (lợi nhuận sau thuế giảm ${profit}) đạt ${CFO_CURRENT}.`],
    ["vi", `Doanh thu (lợi nhuận sau thuế tăng ${profit}) giảm ${revenue}.`],
  ])
    assert.throws(
      () => validateSecuritiesReport(labelReport(value, text), value, locale),
      { validationReason: "numeric_direction_mismatch" },
      text,
    );
});

test("Vietnamese corresponding change fields retain metric labels and direction checks", async () => {
  const value = await vscLabelFixture();
  const absolute = "{{metric:profit_after_tax:absoluteChange}}";
  const relative = "{{metric:profit_after_tax:relativeChangePct}}";
  for (const pair of [
    `${absolute} tương ứng ${relative}`,
    `${absolute}, tương ứng ${relative}`,
    `${relative} tương ứng ${absolute}`,
    `${relative} tương ứng chênh lệch tuyệt đối ${absolute}`,
    `${relative} tương ứng mức thay đổi tuyệt đối ${absolute}`,
    `${absolute} tương ứng mức thay đổi tương đối ${relative}`,
  ]) {
    const text = `Lợi nhuận sau thuế đạt ${PAT_CURRENT} so với {{metric:profit_after_tax:comparison}}, tăng ${pair}.`;
    assert.doesNotThrow(() => validateSecuritiesReport(labelReport(value, text), value, "vi"));
    assert.throws(() =>
      validateSecuritiesReport(
        labelReport(value, text.replace(relative, "{{metric:revenue:relativeChangePct}}")),
        value,
        "vi",
      ),
    );
    assert.throws(
      () => validateSecuritiesReport(labelReport(value, text.replace("tăng", "giảm")), value, "vi"),
      { validationReason: "numeric_direction_mismatch" },
    );
    assert.throws(
      () =>
        validateSecuritiesReport(
          labelReport(value, text.replace("Lợi nhuận sau thuế", "Doanh thu")),
          value,
          "vi",
        ),
      { code: "model_numeric_narrative_mismatch" },
    );
  }
});

test("ordered mapping rejects incomplete or ambiguous lists without weakening other financial guards", async () => {
  const value = await vscLabelFixture();
  for (const text of [
    `Dòng tiền kinh doanh và lợi nhuận sau thuế lần lượt đạt ${CFO_CURRENT}.`,
    `Dòng tiền kinh doanh và lợi nhuận sau thuế lần lượt đạt ${CFO_CURRENT}, ${PAT_CURRENT} và ${CFO_CURRENT}.`,
    `Operating cash flow and profit after tax were ${CFO_CURRENT}, respectively, and ${PAT_CURRENT}.`,
    `Dòng tiền kinh doanh và lợi nhuận sau thuế lần lượt đạt ${CFO_CURRENT}, rồi báo cáo đề cập ${PAT_CURRENT}.`,
  ])
    assert.throws(
      () =>
        validateSecuritiesReport(
          labelReport(value, text),
          value,
          text.startsWith("Operating") ? "en" : "vi",
        ),
      { validationReason: "numeric_label_ambiguous_ordered_list" },
      text,
    );
  const correct = `Dòng tiền kinh doanh và lợi nhuận sau thuế lần lượt đạt ${CFO_CURRENT} và ${PAT_CURRENT}.`;
  const missingBinding = labelReport(value, correct);
  missingBinding.claims[0].metricIds = ["operating_cash_flow"];
  assert.throws(() => validateSecuritiesReport(missingBinding, value, "vi"), {
    code: "model_invalid_metric_binding",
  });
  const missingQuote = labelReport(value, correct);
  missingQuote.claims[0].evidenceQuotes[0].quote = "{{source_excerpt:does-not-exist}}";
  assert.throws(() => validateSecuritiesReport(missingQuote, value, "vi"), {
    code: "model_unverified_quote",
  });
  const changedSource = structuredClone(value);
  changedSource.metrics.find(
    (metric) => metric.id === "operating_cash_flow",
  ).current.sourceVersion = "sha256:" + "f".repeat(64);
  assert.throws(
    () => validateSecuritiesReport(labelReport(changedSource, correct), changedSource, "vi"),
    { code: "model_invalid_source_binding" },
  );
});

test("bound period modifiers and introductory comparison context do not become ordered subjects", async () => {
  const value = await vscLabelFixture();
  for (const [locale, text] of [
    [
      "vi",
      `Dòng tiền kinh doanh và lợi nhuận sau thuế trong {{context:period}} lần lượt đạt ${CFO_CURRENT} và ${PAT_CURRENT}.`,
    ],
    [
      "en",
      `Operating cash flow and profit after tax in {{context:period}} were ${CFO_CURRENT} and ${PAT_CURRENT}, respectively.`,
    ],
    [
      "vi",
      `Khi đối chiếu với doanh thu, dòng tiền kinh doanh và lợi nhuận sau thuế lần lượt đạt ${CFO_CURRENT} và ${PAT_CURRENT}.`,
    ],
    [
      "en",
      `Compared with revenue, operating cash flow and profit after tax were ${CFO_CURRENT} and ${PAT_CURRENT}, respectively.`,
    ],
  ]) {
    const accepted = validateSecuritiesReport(labelReport(value, text), value, locale);
    assert.ok(
      accepted.claims[0].numericOrigins.every(
        (origin) => origin.version === value.sources[0].version,
      ),
    );
    const swapped = text
      .replace(CFO_CURRENT, "SWAP_CFO")
      .replace(PAT_CURRENT, CFO_CURRENT)
      .replace("SWAP_CFO", PAT_CURRENT);
    assert.throws(() => validateSecuritiesReport(labelReport(value, swapped), value, locale), {
      validationReason: "numeric_label_mismatch",
    });
  }
  const invalidPeriod = `Dòng tiền kinh doanh và lợi nhuận sau thuế trong {{context:unknown}} lần lượt đạt ${CFO_CURRENT} và ${PAT_CURRENT}.`;
  assert.throws(() => validateSecuritiesReport(labelReport(value, invalidPeriod), value, "vi"), {
    validationReason: "numeric_label_ambiguous_ordered_list",
  });
});

test("an unnamed current-to-comparison continuation retains its explicitly named financial subject", async () => {
  const value = await vscLabelFixture();
  const cfoComparison = "{{metric:operating_cash_flow:comparison}}";
  const patComparison = "{{metric:profit_after_tax:comparison}}";
  for (const [locale, text] of [
    [
      "vi",
      `Dòng tiền kinh doanh đạt ${CFO_CURRENT}, so với ${cfoComparison} ở kỳ so sánh; lợi nhuận sau thuế đạt ${PAT_CURRENT}.`,
    ],
    [
      "en",
      `Operating cash flow was ${CFO_CURRENT}, compared with ${cfoComparison} in the comparison period; profit after tax was ${PAT_CURRENT}.`,
    ],
  ]) {
    assert.doesNotThrow(() => validateSecuritiesReport(labelReport(value, text), value, locale));
    assert.throws(
      () =>
        validateSecuritiesReport(
          labelReport(value, text.replace(cfoComparison, patComparison)),
          value,
          locale,
        ),
      { validationReason: "numeric_label_mismatch" },
    );
  }
  const explicitDifferentSubject = `Dòng tiền kinh doanh đạt ${CFO_CURRENT}, so với lợi nhuận sau thuế ${patComparison} ở kỳ so sánh.`;
  assert.doesNotThrow(() =>
    validateSecuritiesReport(labelReport(value, explicitDifferentSubject), value, "vi"),
  );
});

test("long parenthetical source context cannot push a subject outside its numeric binding check", async () => {
  const value = await vscLabelFixture();
  const context =
    "theo báo cáo và phần thuyết minh được công bố cùng báo cáo hợp nhất về cơ sở lập báo cáo và lợi nhuận sau thuế";
  const correct = `Dòng tiền kinh doanh (${context}) đạt ${CFO_CURRENT}.`;
  const accepted = validateSecuritiesReport(labelReport(value, correct), value, "vi");
  assert.ok(
    accepted.summary.includes(context),
    "The actual prose is preserved, including its full aside.",
  );
  for (const token of [PAT_CURRENT, "{{metric:revenue:current}}"])
    assert.throws(
      () =>
        validateSecuritiesReport(
          labelReport(value, correct.replace(CFO_CURRENT, token)),
          value,
          "vi",
        ),
      { validationReason: "numeric_label_mismatch" },
    );
});

test("read loop performs actual local reads, binds page headers and emits real progress", async () => {
  const value = dossier();
  const reads = [];
  const stages = [];
  const engine = provider(
    (round) => (round === 1 ? readAction(value, [readRequest(value)]) : report(value)),
    {
      inspect: (_body, payload) => {
        assert.doesNotMatch(JSON.stringify(payload), /sk-or-fixture-report-contract/);
        if (payload.untrustedResearch.steps.length > 1) {
          assert.equal(
            payload.untrustedDossier.sources[0].evidencePassages.find(
              (item) => item.id === "page-2",
            ).pageHeader.locator.page,
            2,
          );
        }
      },
    },
  );
  const result = await analyzeSecurities({
    dossier: value,
    env,
    locale: "en",
    fetchImpl: engine.fetchImpl,
    readEvidence: async (request) => {
      reads.push(request);
      return packet(value.sources[0], { pages: request.pages.length ? request.pages : [1] });
    },
    onProgress: (progress) => stages.push(progress.stage),
  });
  assert.equal(reads.length, 2);
  assert.equal(result.research.steps.length, 2);
  assert.equal(result.research.status, "complete");
  assert.deepEqual(stages, [
    "reading_sources",
    "writing_report",
    "reading_sources",
    "writing_report",
    "checking_report",
  ]);
  assert.equal(result.receipts.length, 3);
  assert.equal(
    result.receipts.every((receipt) => receipt.evidenceType === "fixture"),
    true,
  );
  assert.equal(result.validation.semantic.method, "same_model_consistency_check");
  assert.equal(value.sources[0].excerpts.length, 1);
});

test("unusable and partial reads create server-owned gaps even when the model omits every limitation", async () => {
  for (const kind of ["unusable", "truncated"]) {
    const value = dossier();
    let sent;
    const engine = provider(report(value), {
      inspect: (body, payload) => {
        if (body.response_format.json_schema.name !== "securities_report_consistency")
          sent = payload;
      },
    });
    const result = await analyzeSecurities({
      dossier: value,
      env,
      locale: "en",
      fetchImpl: engine.fetchImpl,
      readEvidence: async () =>
        packet(value.sources[0], {
          mutate: (body) => {
            if (kind === "truncated") body.coverage.truncated = true;
            else {
              body.coverage.unusablePages = [1];
              body.passages[0].verification = "unusable";
              body.passages[0].qualityFlags = ["unusable"];
            }
          },
        }),
    });
    assert.notEqual(result.research.status, "complete");
    assert.ok(result.research.gaps.length > 0);
    assert.match(
      JSON.stringify(result.research.gaps),
      kind === "unusable" ? /without usable text/ : /only part of the matching text/,
    );
    assert.ok(sent.untrustedResearch.gaps.length > 0);
    if (kind === "unusable") {
      assert.equal(result.research.steps[0].status, "empty");
      assert.deepEqual(result.research.steps[0].passageIds, []);
      assert.ok(
        !sent.untrustedDossier.sources[0].evidencePassages.some(
          (passage) => passage.id === "page-1",
        ),
      );
    }
  }
});

test("repair feedback identifies the exact invalid claim and measures expanded summary words without accepting it", () => {
  const value = dossier();
  const input = report(value);
  input.claims[0].id = "sum-cash";
  input.claims[0].text = "Revenue was {{metric:revenue:current}}. " + "Short note ".repeat(90);
  input.report.summaryClaimIds = ["sum-cash"];
  let failure;
  assert.throws(
    () => validateSecuritiesReport(input, value, "en"),
    (error) => {
      failure = error;
      return (
        error.code === "model_missing_calculation_binding" && error.validationClaimId === "sum-cash"
      );
    },
  );
  const feedback = securitiesReportRepairFeedback(input, value, "en", failure, [
    { code: "model_invalid_claim", claimId: "old" },
  ]);
  assert.equal(feedback.deterministicFailure.claimId, "sum-cash");
  assert.equal(feedback.previousFailures[0].code, "model_invalid_claim");
  assert.ok(feedback.summaryBudget.renderedWords > 180);
  assert.equal(feedback.summaryBudget.maximumRenderedWords, 180);
  assert.equal(feedback.summaryBudget.targetRenderedWords, 120);
  assert.equal(feedback.untrustedRejectedReport.claims[0].text, input.claims[0].text);
  input.claims[0].text = "Corrupt \u0001 field";
  input.claims[0].extra = "untrusted-extra-field-must-not-propagate";
  const bounded = securitiesReportRepairFeedback(input, value, "en", failure);
  assert.equal(bounded.untrustedRejectedReport.claims[0].text, null);
  assert.equal(bounded.summaryBudget.renderedWords, null);
  assert.doesNotMatch(JSON.stringify(bounded), /extra-field|Corrupt/);
});

test("deterministic repairs retain prior drafts and failures while permitting a genuinely new source read", async () => {
  const value = dossier();
  const invalidKind = report(value);
  invalidKind.claims[0].text = "Revenue was {{metric:revenue:current}}.";
  const oversized = report(value);
  oversized.claims[0].text += " Short note ".repeat(100);
  let reads = 0;
  const engine = provider((round, payload) => {
    if (round === 1) return invalidKind;
    if (round === 2) {
      assert.equal(payload.finalRequired, false);
      assert.equal(payload.repairFeedback.deterministicFailure.claimId, "revenue");
      assert.equal(
        payload.repairFeedback.untrustedRejectedReport.claims[0].text,
        invalidKind.claims[0].text,
      );
      return readAction(value, [readRequest(value, "working capital notes", [2])]);
    }
    if (round === 3) return oversized;
    assert.equal(round, 4);
    assert.equal(payload.finalRequired, false);
    assert.equal(payload.repairFeedback.deterministicFailure.code, "model_summary_too_long");
    assert.equal(
      payload.repairFeedback.previousFailures[0].code,
      "model_missing_calculation_binding",
    );
    assert.ok(payload.repairFeedback.summaryBudget.renderedWords > 180);
    return report(value);
  });
  const result = await analyzeSecurities({
    dossier: value,
    env,
    locale: "en",
    fetchImpl: engine.fetchImpl,
    readEvidence: async (request) => {
      reads += 1;
      return packet(value.sources[0], { pages: request.pages.length ? request.pages : [1] });
    },
  });
  assert.equal(reads, 2);
  assert.equal(engine.calls, 5);
  assert.equal(result.receipts[0].validation.claimId, "revenue");
  assert.equal(result.validation.semantic.status, "passed");
});

test("a cash question with negative CFO requires a real additional source attempt before a final report", async () => {
  const value = dossier();
  const cfo = structuredClone(value.metrics[0]);
  cfo.id = "operating_cash_flow";
  cfo.current.value = -1_000_000_000;
  value.metrics = calculateDossierMetrics([...value.metrics, cfo], value);
  let reads = 0;
  const engine = provider(
    (round, payload) => {
      if (round === 1) return report(value); // Deliberate simulated schema violation.
      if (round === 2) {
        assert.equal(payload.repairFeedback.deterministicFailure.code, "model_research_required");
        assert.equal(payload.finalRequired, false);
        return readAction(value, [readRequest(value, "", [2])]);
      }
      if (round === 3) {
        assert.equal(
          payload.cashResearchRequirement.status,
          "pending",
          "An unrelated cover-page plan cannot satisfy the cash-note requirement.",
        );
        assert.equal(
          payload.repairFeedback.deterministicFailure.reason,
          "cash_discovery_requires_topic_queries",
        );
        return readAction(value, [
          readRequest(value, "phải thu khách hàng ngắn hạn", []),
          readRequest(value, "hàng tồn kho", []),
        ]);
      }
      if (round === 4) {
        assert.equal(payload.cashResearchRequirement.status, "attempted_check_actual_read_results");
        return readAction(value, [readRequest(value, "", [2])]);
      }
      assert.equal(payload.cashResearchRequirement.status, "attempted_check_actual_read_results");
      return report(value);
    },
    {
      inspect: (body, payload) => {
        if (
          body.response_format.json_schema.name === "securities_analyst_report" &&
          payload.cashResearchRequirement.status === "pending"
        ) {
          assert.deepEqual(body.response_format.json_schema.schema.properties.action.enum, [
            "read",
          ]);
          assert.equal(
            body.response_format.json_schema.schema.properties.readRequests.items.properties.pages
              .maxItems,
            0,
          );
          assert.equal(body.response_format.json_schema.schema.properties.readRequests.maxItems, 4);
        } else if (body.response_format.json_schema.name === "securities_analyst_report") {
          assert.equal(
            body.response_format.json_schema.schema.properties.readRequests.items.properties.pages
              .maxItems,
            6,
            "A discovery-only schema restriction must not mutate later read schemas.",
          );
        }
      },
    },
  );
  const result = await analyzeSecurities({
    dossier: value,
    question: "Has profit become cash?",
    env,
    locale: "en",
    fetchImpl: engine.fetchImpl,
    readEvidence: async (request) => {
      reads += 1;
      assert.ok(
        !request.pages.length || reads === 4,
        "The rejected guessed page plan must never reach the reader.",
      );
      return packet(value.sources[0], {
        pages: request.pages.length
          ? request.pages
          : request.query.includes("phải thu")
            ? [2]
            : request.query.includes("tồn kho")
              ? [3]
              : [1],
      });
    },
  });
  assert.equal(reads, 4);
  assert.equal(engine.calls, 6);
  assert.equal(result.research.steps[1].query, "phải thu khách hàng ngắn hạn");
  assert.deepEqual(result.research.steps[1].pages, []);
  assert.equal(result.research.steps[1].status, "read");
  assert.equal(result.receipts[0].validation.code, "model_research_required");
});

test("a failed additional cash-note attempt keeps an explicit gap and never claims a successful read", async () => {
  const value = dossier();
  const cfo = structuredClone(value.metrics[0]);
  cfo.id = "operating_cash_flow";
  cfo.current.value = -1_000_000_000;
  value.metrics = calculateDossierMetrics([...value.metrics, cfo], value);
  let reads = 0;
  const engine = provider((round, payload) => {
    if (round === 1) return readAction(value, [readRequest(value, "inventory", [])]);
    assert.equal(payload.finalRequired, true);
    assert.equal(payload.cashResearchRequirement.status, "attempted_check_actual_read_results");
    return report(value);
  });
  const result = await analyzeSecurities({
    dossier: value,
    question: "Explain cash conversion.",
    env,
    locale: "en",
    fetchImpl: engine.fetchImpl,
    readEvidence: async () => {
      if (++reads >= 2) throw new Error("read unavailable");
      return packet(value.sources[0]);
    },
  });
  assert.equal(reads, 2);
  assert.equal(result.research.status, "limited");
  assert.equal(result.research.steps[1].status, "unavailable");
  assert.equal(result.research.steps[1].receipt, undefined);
  assert.match(JSON.stringify(result.research.gaps), /could not be read/);
});

test("profitability and sustainability questions require topical note attempts while bound attribution stays direct", async () => {
  for (const [question, topics, queries] of [
    [
      "FPT năm này có kiếm lời hiệu quả hơn kỳ trước không?",
      ["expenses", "financial_income", "income_tax"],
      ["chi phi ban hang", "doanh thu hoat dong tai chinh", "thue thu nhap doanh nghiep"],
    ],
    [
      "Why did earnings improve?",
      ["expenses", "financial_income", "income_tax"],
      ["selling expenses", "financial income", "income tax expense"],
    ],
    [
      "GMD lợi nhuận tăng mạnh như vậy có bền không?",
      ["financial_income", "transactions", "investing_cash"],
      [
        "doanh thu hoat dong tai chinh",
        "chuyen nhuong cong ty con",
        "luu chuyen tien tu hoat dong dau tu",
      ],
    ],
  ]) {
    const value = dossier();
    const reads = [];
    const engine = provider(
      (round, payload) => {
        assert.deepEqual(
          payload.analysisResearchRequirement.topics.map((topic) => topic.id),
          topics,
        );
        if (round === 1) {
          assert.equal(payload.analysisResearchRequirement.status, "pending");
          return report(value); // Simulate a model skipping the requested investigation.
        }
        if (round === 2) {
          assert.equal(
            payload.repairFeedback.deterministicFailure.reason,
            "question_notes_not_investigated",
          );
          return readAction(
            value,
            queries.map((query) => readRequest(value, query, [])),
          );
        }
        assert.equal(
          payload.analysisResearchRequirement.status,
          "attempted_check_actual_read_results",
        );
        assert.ok(
          payload.analysisResearchRequirement.topics.every(
            (topic) => topic.status === "attempted_check_actual_read_results",
          ),
        );
        return report(value);
      },
      {
        inspect: (body, payload) => {
          if (
            body.response_format.json_schema.name === "securities_analyst_report" &&
            payload.analysisResearchRequirement.status === "pending"
          ) {
            assert.deepEqual(body.response_format.json_schema.schema.properties.action.enum, [
              "read",
            ]);
            assert.equal(
              body.response_format.json_schema.schema.properties.readRequests.items.properties.pages
                .maxItems,
              0,
            );
          }
        },
      },
    );
    const result = await analyzeSecurities({
      dossier: value,
      question,
      env,
      locale: "en",
      fetchImpl: engine.fetchImpl,
      readEvidence: async (request) => {
        reads.push(request);
        return packet(value.sources[0], {
          pages: reads.length === 1 ? [1] : [2 + (reads.length % 2)],
        });
      },
    });
    assert.deepEqual(
      reads.slice(1).map((request) => request.query),
      queries,
    );
    assert.equal(result.research.steps.length, 4);
    assert.equal(
      result.research.verifiedFacts.length,
      0,
      "Reading explanatory notes cannot create verified numerical cells.",
    );
    assert.equal(result.receipts[0].validation.reason, "question_notes_not_investigated");
  }
  const value = dossier();
  let reads = 0;
  const engine = provider(report(value), {
    inspect: (_body, payload) => assert.equal(payload.analysisResearchRequirement, undefined),
  });
  await analyzeSecurities({
    dossier: value,
    question: "Why is parent profit higher than group profit, and what is the difference?",
    env,
    fetchImpl: engine.fetchImpl,
    readEvidence: async () => {
      reads += 1;
      return packet(value.sources[0]);
    },
  });
  assert.equal(
    reads,
    1,
    "An ownership-attribution identity does not mandate unrelated expense and tax research.",
  );
});

test("disposal investigation does not turn an unsupported core-sustainability claim into an accepted interpretation", async () => {
  const value = dossier();
  const bad = report(value);
  bad.claims.push({
    id: "core-sustainability",
    kind: "analyst_opinion",
    text: "The remaining core earnings are sustainable.",
    sourceIds: ["annual"],
    metricIds: [],
    evidenceQuotes: [{ sourceId: "annual", quote: "{{source_excerpt:basis}}" }],
  });
  bad.report.sections.push({ id: "outlook", claimIds: ["core-sustainability"] });
  const engine = provider(
    (round, payload) => {
      if (round === 1)
        return readAction(
          value,
          ["financial income", "disposal transaction", "investing cash flow"].map((query) =>
            readRequest(value, query, []),
          ),
        );
      if (round === 2) return bad;
      assert.equal(payload.repairFeedback.deterministicFailure.claimId, "core-sustainability");
      assert.equal(
        payload.repairFeedback.deterministicFailure.reason,
        "repeatability_without_support",
      );
      assert.equal(
        payload.repairFeedback.untrustedRejectedReport.claims[0].text,
        bad.claims[0].text,
      );
      return report(value);
    },
    {
      verdict: () => "supported",
      inspect: (body, payload) => {
        if (body.response_format.json_schema.name === "securities_report_consistency") {
          assert.match(
            body.messages[0].content,
            /does not establish sustainable or recurring remaining earnings/,
          );
          assert.equal(
            payload.untrustedReport.claims.some((claim) => claim.id === "core-sustainability"),
            false,
          );
        }
      },
    },
  );
  let reads = 0;
  const result = await analyzeSecurities({
    dossier: value,
    question: "Are the stronger earnings sustainable?",
    env,
    fetchImpl: engine.fetchImpl,
    readEvidence: async () => packet(value.sources[0], { pages: [1 + (reads++ % 3)] }),
  });
  assert.equal(reads, 4);
  assert.equal(
    result.claims.some((claim) => claim.id === "core-sustainability"),
    false,
  );
  assert.equal(result.receipts[1].validation.reason, "repeatability_without_support");
  assert.equal(result.validation.semantic.status, "passed");
});

test("observed categorical repeatability is rejected while denials, conditional hypotheses and attributed source descriptions remain distinct", () => {
  const value = dossier();
  value.sources[0].excerpts.push(
    {
      id: "disposal-note",
      text: "The financial-income note records an accounting gain from a disposal transaction.",
      locator: { page: 2 },
    },
    {
      id: "recurring-category",
      text: "The disclosure classifies service-contract revenue as recurring revenue.",
      locator: { page: 2 },
    },
    {
      id: "issuer-expectation",
      text: "Management expects core earnings to be sustainable if service contracts renew.",
      locator: { page: 3 },
    },
    {
      id: "issuer-denial",
      text: "Management does not establish that core earnings are sustainable.",
      locator: { page: 3 },
    },
  );
  const input = (text, kind = "analyst_opinion", excerpt = "disposal-note") =>
    report(value, {
      claims: [
        {
          id: "c-sum2",
          kind,
          text,
          metricIds: [],
          sourceIds: ["annual"],
          evidenceQuotes: [{ sourceId: "annual", quote: "{{source_excerpt:" + excerpt + "}}" }],
        },
      ],
      report: { summaryClaimIds: ["c-sum2"], sections: [] },
    });
  for (const text of [
    "Mức tăng này chỉ bền một phần vì hoạt động cốt lõi có cải thiện qua lợi nhuận gộp, nhưng không thể ngoại suy toàn bộ lợi nhuận kỳ này cho các kỳ tới.",
    "Lợi nhuận kỳ này chỉ bền ở phần hoạt động cốt lõi. Tách khoản lãi chuyển nhượng không làm cho phần lợi nhuận còn lại trở thành bền vững một cách tự động.",
    "The profit increase is partly sustainable because gross profit improved, but removing the gain does not prove future sustainability.",
    "The source does not establish that core earnings are sustainable, but core earnings are sustainable.",
  ])
    assert.throws(
      () => validateSecuritiesReport(input(text), value),
      (error) =>
        error.code === "model_unsupported_causal_claim" &&
        error.validationReason === "repeatability_without_support" &&
        error.validationClaimId === "c-sum2",
    );
  for (const [text, kind, excerpt] of [
    [
      "Chưa đủ cơ sở để kết luận phần lợi nhuận cốt lõi bền vững.",
      "analyst_opinion",
      "disposal-note",
    ],
    [
      "Tách khoản lãi chuyển nhượng không làm cho phần lợi nhuận còn lại trở thành bền vững một cách tự động.",
      "analyst_opinion",
      "disposal-note",
    ],
    [
      "Cần thêm bằng chứng để đánh giá tính bền vững của lợi nhuận.",
      "analyst_opinion",
      "disposal-note",
    ],
    ["Tính bền vững của lợi nhuận vẫn cần kiểm chứng.", "analyst_opinion", "disposal-note"],
    [
      "Core earnings could be sustainable if service contracts renew.",
      "hypothesis",
      "disposal-note",
    ],
    [
      "The disclosure classifies service-contract revenue as recurring revenue.",
      "source_fact",
      "recurring-category",
    ],
    [
      "Management expects core earnings to be sustainable if service contracts renew.",
      "source_fact",
      "issuer-expectation",
    ],
  ])
    assert.doesNotThrow(() => validateSecuritiesReport(input(text, kind, excerpt), value));
  assert.throws(
    () =>
      validateSecuritiesReport(
        input(
          "Management expects core earnings to be sustainable.",
          "source_fact",
          "issuer-denial",
        ),
        value,
      ),
    { code: "model_unsupported_causal_claim" },
  );
});

// Exact parsed rejected drafts from the retained VSC diagnostic replay.
// Replaying them below is offline contract verification, not a new provider run.
const observedVscCorruptReports = [
  {
    action: "final",
    claims: [
      {
        evidenceQuotes: [
          {
            quote: "{{source_excerpt:row-operating_cash_flow}}",
            sourceId: "vsc-h1-2026",
          },
          {
            quote: "{{source_excerpt:row-profit_after_tax}}",
            sourceId: "vsc-h1-2026",
          },
        ],
        id: "sum1",
        kind: "calculated",
        metricIds: ["operating_cash_flow", "profit_after_tax"],
        sourceIds: ["vsc-h1-2026"],
        text: "Ch\t9 ti\nau gi\nap ph\nan bi\tt l\n3i nhu\ndn v\n1i d\nang ti\n3n l\n0 D\nang ti\n3n thu\n7n t\nb ho\n1t \t\n9ng kinh doanh so v\n1i L\n3i nhu\ndn sau thu\n9 to\n0n t\ndp \to\n0n trong {{context:period}} so v\n1i {{context:comparisonPeriod}}, v\n1i d\nang ti\n3n \n1 m\nbc {{metric:operating_cash_flow:current}} so v\n1i {{metric:operating_cash_flow:comparison}} v\n0 l\n3i nhu\ndn \n1 m\nbc {{metric:profit_after_tax:current}} so v\n1i {{metric:profit_after_tax:comparison}}, ch\nanh l\tch d\nang ti\n3n \n1 m\nbc {{metric:operating_cash_flow:absoluteChange}}.",
      },
      {
        evidenceQuotes: [
          {
            quote: "{{source_excerpt:vsc-cfo-trading-securities}}",
            sourceId: "vsc-h1-2026",
          },
          {
            quote: "{{source_excerpt:vsc-cfo-negative-base}}",
            sourceId: "vsc-h1-2026",
          },
        ],
        id: "b-cash",
        kind: "source_fact",
        metricIds: ["operating_cash_flow"],
        sourceIds: ["vsc-h1-2026"],
        text: "B\n1o c\n1o l\nbu chuy\n3n ti\n3n t\n3 tr\ncnh b\n0y d\nang Gi\n3m ch\nbang kho\n1n kinh doanh trong c\nang khu v\nbc v\n1i D\nang ti\n3n thu\n7n t\nb ho\n1t \t\n9ng kinh doanh \n1 m\nbc {{metric:operating_cash_flow:current}} so v\n1i {{metric:operating_cash_flow:comparison}}.",
      },
      {
        evidenceQuotes: [
          {
            quote: "{{source_excerpt:vsc-cfo-trading-securities}}",
            sourceId: "vsc-h1-2026",
          },
        ],
        id: "b-limit",
        kind: "analyst_opinion",
        metricIds: ["operating_cash_flow"],
        sourceIds: ["vsc-h1-2026"],
        text: "Ch\nba \t\n7 c\n1n c\n9 \t\n3 l\nb\n3ng h\n3a ch\nbang kho\n1n kinh doanh \t\n3 \t\n3ng g\n3p bao nhi\nau v\n0o thay \t\n5i d\nang ti\n3n kinh doanh, v\nc gi\n1 tr\n9 ki\n3m ch\nbang c\n7a d\nang \ti\n3u ch\n9nh n\n0y ch\nba c\n3 trong b\n3ng s\n1 li\n3u \t\nb\n3c cung c\n5p v\n0 \to\n1n tr\ncch thu h\n5i ch\n9 cho bi\n3t t\nan d\nang tr\ncnh b\n0y.",
      },
    ],
    dossierId: "ds_0f98eb9a-a3f8-4e75-96db-3370ac1662c6",
    gaps: [
      {
        impact:
          "Ch\nba th\n3 k\n3t lu\ndn ch\nbang kho\n1n kinh doanh \t\n3ng g\n3p bao nhi\nau v\n0o ch\nanh l\tch d\nang ti\n3n gi\nba hai k\nc.",
        reason:
          "Gi\n1 tr\n9 ki\n3m ch\nbang c\n7a d\nang \ti\n3u ch\n9nh ch\nbang kho\n1n kinh doanh ch\nba c\n3 trong b\n3ng s\n1 li\n3u \t\nb\n3c cung c\n5p, ch\n9 c\n3 t\nan d\nang tr\ncnh b\n0y \n1 d\n1ng tr\ncch d\n9n.",
        topic: "Chi ti\n3t bi\n3n \t\n9ng ch\nbang kho\n1n kinh doanh",
      },
    ],
    limitations: [
      "B\n1o c\n1o l\n0 b\n1o c\n1o gi\nba ni\nan \t\n9 \t\n3 so\n1t x\n9t n\nan m\nbc \t\n3m b\n3o th\n5p h\n1n ki\n3m to\n1n n\n3m, v\n0 trang l\nbu chuy\n3n ti\n3n t\n3 thu h\n5i qua nh\ndn d\n1ng k\nc t\nb ch\nba \t\nb\n3c so\n1t x\n9t \t\n7y \t\n7.",
    ],
    readRequests: [],
    report: {
      sections: [
        {
          claimIds: ["sum1", "b-cash", "b-limit"],
          id: "cash_and_funding",
        },
      ],
      summaryClaimIds: ["sum1", "b-limit"],
    },
    revision: 2,
  },
  {
    action: "final",
    claims: [
      {
        evidenceQuotes: [
          {
            quote: "{{source_excerpt:row-operating_cash_flow}}",
            sourceId: "vsc-h1-2026",
          },
          {
            quote: "{{source_excerpt:row-profit_after_tax}}",
            sourceId: "vsc-h1-2026",
          },
        ],
        id: "sum1",
        kind: "calculated",
        metricIds: ["operating_cash_flow", "profit_after_tax"],
        sourceIds: ["vsc-h1-2026"],
        text: "Trong {{context:period}} so với {{context:comparisonPeriod}}, d\t4ng ti\t4n thu\t4n t\t4 ho\t4t \t4\t9ng kinh doanh \t4 m\t4c {{metric:operating_cash_flow:current}} so v\t4i {{metric:operating_cash_flow:comparison}} gi\nap ph\nan bi\t4t v\t4i l\t4i nhu\t4n sau thu\t4 \t4 m\t4c {{metric:profit_after_tax:current}} so v\t4i {{metric:profit_after_tax:comparison}}, v\t4i ch\nanh l\t4ch tuy\t4t \t4\t4i {{metric:operating_cash_flow:absoluteChange}}.",
      },
      {
        evidenceQuotes: [
          {
            quote: "{{source_excerpt:vsc-cfo-trading-securities}}",
            sourceId: "vsc-h1-2026",
          },
          {
            quote: "{{source_excerpt:vsc-cfo-negative-base}}",
            sourceId: "vsc-h1-2026",
          },
        ],
        id: "b-cash-line",
        kind: "source_fact",
        metricIds: ["operating_cash_flow"],
        sourceIds: ["vsc-h1-2026"],
        text: "B\n1o c\n1o l\nbu chuy\t4n ti\t4n t\t4 tr\ncnh b\n0y d\t4ng Gi\t4m ch\nbang kho\t4n kinh doanh trong c\n3ng khu v\t4c kinh doanh n\nan giao d\t4ch danh m\t4c n\n0y tr\t4c ti\t4p c\t9ng tr\t4 v\n0o d\t4ng ti\t4n kinh doanh {{source_page:vsc-cfo-trading-securities}}.",
      },
      {
        evidenceQuotes: [
          {
            quote: "{{source_excerpt:vsc-cfo-trading-securities}}",
            sourceId: "vsc-h1-2026",
          },
        ],
        id: "b-limit-trading",
        kind: "analyst_opinion",
        metricIds: ["operating_cash_flow"],
        sourceIds: ["vsc-h1-2026"],
        text: "Ch\nba \t4\t5 c\n1n c\t4 \t4\t4 l\nb\t4ng h\n3a m\t4c \t4\n3ng g\n3p c\t5a bi\t4n \t4\t9ng ch\nbang kho\t4n kinh doanh v\n0o d\t4ng ti\t4n kinh doanh v\nc gi\n1 tr\t4 ki\t4m ch\nbang c\t5a d\t4ng \t4i\t4u ch\t4nh n\n0y ch\nba c\n3 trong b\t4ng s\t4 li\t4u \t4b\t4c cung c\t5p.",
      },
    ],
    dossierId: "ds_0f98eb9a-a3f8-4e75-96db-3370ac1662c6",
    gaps: [
      {
        impact:
          "Ch\nba th\t4 k\t4t lu\t4n ch\nbang kho\t4n kinh doanh \t4\n3ng g\n3p bao nhi\nau v\n0o thay \t4\t4i d\t4ng ti\t4n kinh doanh gi\nba c\n1c k\nc.",
        reason:
          "Gi\n1 tr\t4 ki\t4m ch\nbang c\t5a d\t4ng \t4i\t4u ch\t4nh ch\nbang kho\t4n kinh doanh ch\nba c\n3 trong b\t4ng s\t4 li\t4u \t4b\t4c cung c\t5p, ch\t4 c\n3 t\nan d\t4ng tr\ncnh b\n0y.",
        topic: "Chi ti\t4t bi\t4n \t4\t9ng ch\nbang kho\t4n kinh doanh",
      },
    ],
    limitations: [
      "B\n1o c\n1o l\n0 b\n1o c\n1o gi\nba ni\nan \t4\n3 \t4\n3 so\n1t x\n9t n\nan m\t4c \t4\t4m b\t4o th\t5p h\n1n ki\t4m to\n1n n\n3m.",
    ],
    readRequests: [],
    report: {
      sections: [
        {
          claimIds: ["b-cash-line", "b-limit-trading"],
          id: "cash_and_funding",
        },
      ],
      summaryClaimIds: ["sum1", "b-limit-trading"],
    },
    revision: 2,
  },
];

for (const [index, captured] of observedVscCorruptReports.entries()) {
  test(`observed VSC whitespace corruption ${index + 1} regenerates clean Vietnamese without changing its ledger`, async () => {
    const dataset = await loadSecuritiesDataset({
      companyId: "VSC",
      periodId: "H1_2026",
      comparisonPeriodId: "H1_2025",
    });
    const value = createDossier(dataset, { id: captured.dossierId, locale: "vi" });
    value.revision = captured.revision;
    const originalEvidence = JSON.stringify({ metrics: value.metrics, sources: value.sources });
    const corrupt = structuredClone(captured);
    let failure;
    assert.throws(
      () => validateSecuritiesReport(corrupt, value, "vi"),
      (error) => {
        failure = error;
        return (
          error.code === "model_invalid_text_encoding" &&
          error.validationReason === "text_control_characters" &&
          error.validationClaimId === "sum1"
        );
      },
    );
    const feedback = securitiesReportRepairFeedback(corrupt, value, "vi", failure, [], "chat");
    assert.ok(feedback.untrustedRejectedReport.claims.every(({ text }) => text === null));
    assert.ok(
      feedback.untrustedRejectedReport.gaps.every((gap) =>
        Object.values(gap).every((text) => text === null),
      ),
    );
    assert.ok(feedback.untrustedRejectedReport.limitations.every((text) => text === null));
    assert.deepEqual(
      feedback.untrustedRejectedReport.claims[0].metricIds,
      corrupt.claims[0].metricIds,
    );
    assert.deepEqual(
      feedback.untrustedRejectedReport.claims[0].evidenceQuotes,
      corrupt.claims[0].evidenceQuotes,
    );
    assert.match(feedback.instruction, /Write fresh readable prose/);
    const clean = report(value, {
      claims: [
        {
          id: "cash-distinction",
          kind: "source_fact",
          metricIds: ["operating_cash_flow", "profit_after_tax"],
          sourceIds: ["vsc-h1-2026"],
          text: "Đọc dòng tiền kinh doanh cùng lợi nhuận sau thuế để phân biệt kết quả kế toán với tiền từ hoạt động kinh doanh. Dòng tiền kinh doanh đạt {{metric:operating_cash_flow:current}}; lợi nhuận sau thuế đạt {{metric:profit_after_tax:current}} trong {{context:period}}.",
          evidenceQuotes: [
            { sourceId: "vsc-h1-2026", quote: "{{source_excerpt:row-operating_cash_flow}}" },
            { sourceId: "vsc-h1-2026", quote: "{{source_excerpt:row-profit_after_tax}}" },
          ],
        },
        {
          id: "trading-limit",
          kind: "analyst_opinion",
          metricIds: ["operating_cash_flow"],
          sourceIds: ["vsc-h1-2026"],
          text: "Chưa đủ căn cứ để lượng hóa đóng góp của chứng khoán kinh doanh vào dòng tiền, vì hồ sơ chưa có giá trị đã kiểm chứng cho khoản mục này.",
          evidenceQuotes: [
            { sourceId: "vsc-h1-2026", quote: "{{source_excerpt:vsc-cfo-trading-securities}}" },
          ],
        },
      ],
      report: { summaryClaimIds: ["cash-distinction", "trading-limit"], sections: [] },
    });
    const schema = securitiesReportSchema(value);
    const pattern = new RegExp(schema.properties.claims.items.properties.text.pattern, "u");
    assert.equal(pattern.test(corrupt.claims[0].text), false);
    assert.equal(pattern.test(clean.claims[0].text), true);
    assert.doesNotThrow(() => validateSecuritiesReport(clean, value, "vi"));
    const literal = structuredClone(clean);
    literal.claims[0].text += " Tiền mặt là 999 đồng.";
    assert.throws(() => validateSecuritiesReport(literal, value, "vi"), {
      code: "model_unbound_numeric_output",
    });
    const engine = provider((round, payload) => {
      if (round === 1) return corrupt;
      assert.equal(payload.repairFeedback.deterministicFailure.code, "model_invalid_text_encoding");
      assert.equal(payload.repairFeedback.untrustedRejectedReport.claims[0].text, null);
      return clean;
    });
    const result = await chatSecurities({
      dossier: value,
      question:
        "Trong báo cáo VSC đang mở, chỉ tiêu nào giúp phân biệt lợi nhuận với dòng tiền? Nếu chưa có chi tiết biến động chứng khoán kinh doanh, hãy nói rõ phần chưa đủ căn cứ.",
      locale: "vi",
      env,
      fetchImpl: engine.fetchImpl,
    });
    assert.equal(result.receipts[0].validation.code, "model_invalid_text_encoding");
    assert.equal(result.validation.deterministic.status, "passed");
    assert.equal(result.validation.semantic.status, "passed");
    assert.match(result.summary, /^Đọc dòng tiền kinh doanh cùng lợi nhuận sau thuế/u);
    assert.equal(engine.calls, 3, "one existing repair round and the normal consistency check");
    assert.equal(
      JSON.stringify({ metrics: value.metrics, sources: value.sources }),
      originalEvidence,
    );
    assert.deepEqual(
      corrupt,
      captured,
      "the rejected draft is retained without decoding or normalization",
    );
  });
}

test("generated prose rejects C0 DEL and C1 controls while source text, retrieval queries and JSON whitespace remain valid", () => {
  const value = dossier();
  value.sources[0].excerpts[0].text =
    "Báo cáo tài chính hợp nhất.\nDữ liệu gồm kỳ hiện tại và kỳ so sánh.";
  const clean = report(value, {
    claims: [
      {
        id: "source-basis",
        kind: "source_fact",
        metricIds: [],
        sourceIds: ["annual"],
        text: "Tài liệu trình bày cơ sở hợp nhất của báo cáo.",
        evidenceQuotes: [{ sourceId: "annual", quote: "{{source_excerpt:basis}}" }],
      },
    ],
    report: { summaryClaimIds: ["source-basis"], sections: [] },
  });
  assert.doesNotThrow(() =>
    validateSecuritiesReport(JSON.parse(JSON.stringify(clean, null, 2)), value, "vi"),
  );
  const query = "doanh\nthu\tthuan\r";
  assert.equal(
    validateSecuritiesReadRequest(readRequest(value, query, []), value).query,
    query.trim(),
  );
  const schema = securitiesReportSchema(value);
  assert.equal(
    new RegExp(schema.properties.readRequests.items.properties.query.pattern, "u").test(query),
    true,
  );
  const controls = [
    ...Array.from({ length: 32 }, (_, index) => String.fromCodePoint(index)),
    ...Array.from({ length: 33 }, (_, index) => String.fromCodePoint(127 + index)),
  ];
  for (const control of controls) {
    for (const field of ["claim", "topic", "reason", "impact", "limitation"]) {
      const corrupt = structuredClone(clean);
      const text = `Nguồn${control}4 bị hỏng.`;
      let fieldSchema;
      if (field === "claim") {
        corrupt.claims[0].text = text;
        fieldSchema = schema.properties.claims.items.properties.text;
      } else if (field === "limitation") {
        corrupt.limitations = [text];
        fieldSchema = schema.properties.limitations.items;
      } else {
        corrupt.gaps = [
          {
            topic: "Chi tiết",
            reason: "Chưa có căn cứ.",
            impact: "Chưa thể kết luận.",
            [field]: text,
          },
        ];
        fieldSchema = schema.properties.gaps.items.properties[field];
      }
      assert.equal(new RegExp(fieldSchema.pattern, "u").test(text), false);
      assert.throws(() => validateSecuritiesReport(corrupt, value, "vi"), {
        code: "model_invalid_text_encoding",
        validationReason: "text_control_characters",
      });
    }
  }
  assert.match(
    value.sources[0].excerpts[0].text,
    /\n/u,
    "the original source newline is preserved",
  );
});

test("the observed DEL in Vietnamese prose enters fresh encoding repair before it can be published", async () => {
  const value = dossier();
  const clean = report(value);
  clean.claims[0].text =
    "Chỉ tiêu doanh thu {{metric:revenue:relativeChangePct:movement}}; số liệu giữ đúng phạm vi đã kiểm chứng.";
  const corrupt = structuredClone(clean);
  corrupt.claims[0].text = clean.claims[0].text.replace("Chỉ", "Ch\u007f");
  const original = JSON.stringify(value);
  assert.equal(corrupt.claims[0].text.codePointAt(2), 127);
  assert.throws(() => validateSecuritiesReport(corrupt, value, "vi"), {
    code: "model_invalid_text_encoding",
    validationReason: "text_control_characters",
  });
  const schema = securitiesReportSchema(value);
  const pattern = new RegExp(schema.properties.claims.items.properties.text.pattern, "u");
  assert.equal(pattern.test(corrupt.claims[0].text), false);
  assert.equal(pattern.test(clean.claims[0].text), true);
  const engine = provider((round, payload) => {
    if (round === 1) return corrupt;
    assert.equal(payload.repairFeedback.deterministicFailure.reason, "text_control_characters");
    assert.equal(payload.repairFeedback.untrustedRejectedReport.claims[0].text, null);
    assert.equal(JSON.stringify(payload).includes("\u007f"), false);
    return clean;
  });
  const result = await chatSecurities({
    dossier: value,
    question: "Chỉ tiêu nào cần đọc trong phạm vi báo cáo?",
    locale: "vi",
    env,
    fetchImpl: engine.fetchImpl,
  });
  assert.equal(result.receipts[0].validation.code, "model_invalid_text_encoding");
  assert.equal(result.validation.deterministic.status, "passed");
  assert.equal(result.validation.semantic.status, "passed");
  assert.match(result.summary, /^Chỉ tiêu doanh thu tăng 20%/u);
  assert.equal(result.summary.includes("\u007f"), false);
  assert.equal(engine.calls, 3, "one existing repair round and the normal consistency check");
  assert.equal(JSON.stringify(value), original);
  assert.equal(corrupt.claims[0].text.codePointAt(2), 127, "the rejected draft stays unchanged");
});

test("observed corrupt Vietnamese gets an encoding-specific failure and fresh literal regeneration with no corrupted text propagated", async () => {
  const value = dossier();
  const corrupt = report(value);
  corrupt.claims[0].text =
    "B\u001eb1ng ch\u001ee9ng \u001edf {{source_page:basis}}, doanh thu {{metric:revenue:relativeChangePct:movement}}.";
  corrupt.claims[0].evidenceQuotes = [{ sourceId: "annual", quote: "{{source_excerpt:basis}}" }];
  const clean = report(value, {
    claims: [
      {
        id: "page-answer",
        kind: "source_fact",
        metricIds: [],
        sourceIds: ["annual"],
        text: "Bằng chứng nằm ở {{source_page:basis}}; tài liệu trình bày cơ sở hợp nhất của báo cáo.",
        evidenceQuotes: [{ sourceId: "annual", quote: "{{source_excerpt:basis}}" }],
      },
    ],
    report: { summaryClaimIds: ["page-answer"], sections: [] },
  });
  let error;
  assert.throws(
    () => validateSecuritiesReport(corrupt, value),
    (caught) => {
      error = caught;
      return (
        caught.code === "model_invalid_text_encoding" &&
        caught.validationReason === "text_control_characters" &&
        caught.validationClaimId === "revenue"
      );
    },
  );
  const feedback = securitiesReportRepairFeedback(corrupt, value, "vi", error, [], "chat");
  assert.equal(feedback.untrustedRejectedReport.claims[0].text, null);
  assert.equal(feedback.summaryBudget.targetRenderedWords, undefined);
  assert.doesNotMatch(JSON.stringify(feedback), /\\u001e/iu);
  const engine = provider(
    (round, payload) => {
      if (round === 1) return corrupt;
      assert.equal(payload.repairFeedback.deterministicFailure.reason, "text_control_characters");
      assert.equal(payload.repairFeedback.untrustedRejectedReport.claims[0].text, null);
      assert.match(payload.repairFeedback.instruction, /Write fresh readable prose/);
      assert.match(payload.repairFeedback.instruction, /Bằng chứng nằm ở trang nguồn/);
      assert.doesNotMatch(JSON.stringify(payload), /\\u001e/iu);
      return clean;
    },
    {
      inspect: (body) => {
        if (body.response_format.json_schema.name !== "securities_analyst_report") return;
        const textPattern = new RegExp(
          body.response_format.json_schema.schema.properties.claims.items.properties.text.pattern,
          "u",
        );
        assert.equal(textPattern.test(corrupt.claims[0].text), false);
        assert.equal(textPattern.test(clean.claims[0].text), true);
      },
    },
  );
  const result = await chatSecurities({
    dossier: value,
    question: "Bằng chứng nằm ở trang nào?",
    locale: "vi",
    env,
    fetchImpl: engine.fetchImpl,
  });
  assert.equal(result.receipts[0].validation.code, "model_invalid_text_encoding");
  assert.match(result.summary, /^Bằng chứng nằm ở \(trang 1\)/u);
  assert.equal(result.claims[0].pageOrigins[0].page, 1);
  assert.equal(
    engine.calls,
    3,
    "The existing repair budget suffices; no transport retry or lossy decoder is introduced.",
  );
});

test("a rejected control-character read is replaced by a fresh ASCII source-language query without guessed decoding", async () => {
  const value = dossier();
  const cfo = structuredClone(value.metrics[0]);
  cfo.id = "operating_cash_flow";
  cfo.current.value = -1_000_000_000;
  value.metrics = calculateDossierMetrics([...value.metrics, cfo], value);
  const corrupt = "ph\u001ea3i thu kh\u001eafch h\u0000e0ng";
  const fresh = "phai thu khach hang ngan han";
  const reads = [];
  const engine = provider((round, payload) => {
    if (round === 1) return readAction(value, [readRequest(value, corrupt, [])]);
    if (round === 2) {
      assert.equal(payload.repairFeedback.deterministicFailure.reason, "read_arguments");
      assert.match(payload.repairFeedback.instruction, /fresh read plan.*plain ASCII/u);
      assert.equal(payload.cashResearchRequirement.status, "pending");
      return readAction(value, [readRequest(value, fresh, [])]);
    }
    assert.equal(payload.cashResearchRequirement.status, "attempted_check_actual_read_results");
    return report(value);
  });
  const result = await analyzeSecurities({
    dossier: value,
    question: "Did profit become cash?",
    locale: "en",
    env,
    fetchImpl: engine.fetchImpl,
    readEvidence: async (request) => {
      assert.equal(/[\u0000-\u001f]/u.test(request.query), false);
      reads.push(request);
      return packet(value.sources[0], { pages: reads.length === 1 ? [1] : [2] });
    },
  });
  assert.deepEqual(
    reads.map((request) => request.query),
    ["lưu chuyển tiền từ hoạt động kinh doanh", fresh],
  );
  assert.equal(result.receipts[0].validation.reason, "read_arguments");
  assert.equal(result.validation.semantic.status, "passed");
});

test("a first evidence follow-up passes the same selected context to writer and checker and repairs an unrelated overview", async () => {
  const value = dossier();
  value.revision = 2;
  value.query = "Why does parent shareholders' profit exceed consolidated profit?";
  value.analysis = {
    origin: "model",
    dossierId: value.id,
    revision: 1,
    inputRevision: 1,
    summary: "The non-controlling share is negative.",
    claims: [
      {
        id: "shown-nci",
        kind: "analyst_opinion",
        text: "The negative non-controlling share explains the ownership difference.",
      },
    ],
  };
  value.sources[0].excerpts.push({
    id: "minority",
    text: "The non-controlling share is negative and reduces consolidated profit relative to the parent shareholders' profit.",
    locator: { page: 2, precision: "passage" },
  });
  const focused = report(value, {
    claims: [
      {
        id: "evidence",
        kind: "source_fact",
        text: "The evidence is {{source_page:minority}}: the negative non-controlling share reduces consolidated profit relative to the parent shareholders' profit.",
        metricIds: [],
        sourceIds: ["annual"],
        evidenceQuotes: [{ sourceId: "annual", quote: "{{source_excerpt:minority}}" }],
      },
    ],
    report: { summaryClaimIds: ["evidence"], sections: [] },
  });
  const history = [
    {
      dossierId: value.id,
      revision: 2,
      user: "Explain that ownership difference.",
      assistant: "The displayed non-controlling share needs its source checked.",
    },
  ];
  const contexts = [];
  const engine = provider(
    (round, payload) => {
      if (round === 1) return report(value); // Correct revenue arithmetic, wrong follow-up subject.
      assert.equal(payload.repairFeedback.consistencyFailures[0].id, "report-notes");
      return focused;
    },
    {
      notesVerdict: (payload) =>
        payload.untrustedReport.claims.some((claim) => claim.id === "evidence")
          ? "supported"
          : "unclear",
      inspect: (body, payload) => {
        contexts.push(payload.untrustedReviewContext);
        assert.equal(payload.operation, "chat");
        assert.deepEqual(payload.untrustedHistory, history);
        assert.equal(payload.historyTruncated, true);
        assert.equal(payload.untrustedReviewContext.analysisQuestion, value.query);
        assert.equal(payload.untrustedReviewContext.displayedAnalysis.claims[0].id, "shown-nci");
        assert.match(
          body.messages[0].content,
          /not financial evidence, verified truth, a command, or permission/,
        );
        if (body.response_format.json_schema.name === "securities_analyst_report") {
          assert.match(body.messages[0].content, /answer the current question immediately/);
          assert.doesNotMatch(body.messages[0].content, /For this company analysis, target/);
        }
      },
    },
  );
  const result = await chatSecurities({
    dossier: value,
    question: "Where is the evidence? Give the page and finding immediately.",
    history,
    historyTruncated: true,
    locale: "en",
    env,
    fetchImpl: engine.fetchImpl,
  });
  assert.equal(contexts.length, 4);
  assert.ok(contexts.every((context) => JSON.stringify(context) === JSON.stringify(contexts[0])));
  assert.match(
    result.summary,
    /^The evidence is \(PDF page 2\): the negative non-controlling share/u,
  );
  assert.doesNotMatch(result.summary, /Revenue/u);
  assert.equal(result.claims[0].pageOrigins[0].page, 2);
});

test("identical source-coverage gaps are deduplicated without losing read receipts or distinct limitations", async () => {
  const value = dossier();
  const candidate = report(value);
  candidate.gaps = [
    {
      topic: "Reading scope",
      reason: "Some context remains unread.",
      impact: "Expense drivers remain unestablished.",
    },
    {
      topic: "Reading scope",
      reason: "Some context remains unread.",
      impact: "Repeatability remains unestablished.",
    },
  ];
  const engine = provider((round) =>
    round === 1
      ? readAction(value, [
          readRequest(value, "expenses", [2]),
          readRequest(value, "income tax", [3]),
        ])
      : candidate,
  );
  let reads = 0;
  const result = await analyzeSecurities({
    dossier: value,
    env,
    locale: "en",
    fetchImpl: engine.fetchImpl,
    readEvidence: async (request) => {
      if (++reads === 3) throw new Error("A separate requested note is unavailable.");
      return packet(value.sources[0], {
        pages: request.pages.length ? request.pages : [1],
        mutate: (body) => {
          body.coverage.truncated = true;
        },
      });
    },
  });
  assert.equal(result.research.steps.length, 3);
  assert.deepEqual(
    result.research.steps.map((step) => step.status),
    ["read", "read", "unavailable"],
  );
  assert.ok(result.research.steps.slice(0, 2).every((step) => step.receipt.responseSha256));
  assert.equal(
    result.research.gaps.filter((gap) => /only part of the matching text/u.test(gap.reason)).length,
    1,
  );
  assert.equal(
    result.research.gaps.filter((gap) => /could not be read/u.test(gap.reason)).length,
    1,
  );
  assert.deepEqual(
    result.research.gaps.filter((gap) => gap.topic === "Reading scope"),
    candidate.gaps,
  );
});

test("repeated reads without new work force a final answer instead of replaying the same reader request", async () => {
  const value = dossier();
  let reads = 0;
  let sawFinal = false;
  const repeated = readRequest(value, "lưu chuyển tiền từ hoạt động kinh doanh", []);
  const engine = provider((round, payload) => {
    if (round === 1) return readAction(value, [repeated]);
    sawFinal = payload.finalRequired;
    return report(value);
  });
  const result = await analyzeSecurities({
    dossier: value,
    env,
    fetchImpl: engine.fetchImpl,
    readEvidence: async () => {
      reads += 1;
      return packet(value.sources[0]);
    },
  });
  assert.equal(reads, 1);
  assert.equal(sawFinal, true);
  assert.equal(result.research.steps[1].status, "repeated");
  assert.equal(engine.calls, 3);
});

test("closed read requests reject hidden URLs, wrong source versions and invalid page ranges", () => {
  const value = dossier();
  const original = readRequest(value);
  for (const input of [
    { ...original, url: "http://127.0.0.1/private" },
    { ...original, sourceVersion: "sha256:" + "b".repeat(64) },
    { ...original, sourceId: "unrelated" },
    { ...original, pages: [0] },
    { ...original, pages: [-1] },
    { ...original, pages: [21] },
    { ...original, pages: [1, 1] },
    { ...original, query: "", pages: [] },
    { ...original, query: "x".repeat(501) },
  ])
    assert.throws(() => validateSecuritiesReadRequest(input, value), {
      code: "model_invalid_research",
    });
});

test("wrong packet identity, payload hash and passage provenance fail before key resolution", async () => {
  const value = dossier();
  for (const mutate of [
    (body) => {
      body.sourceHash = "d".repeat(64);
    },
    (body) => {
      body.passages[0].sourceId = "another-dossier-source";
    },
    (body) => {
      body.passages[0].extractionHash = "d".repeat(64);
    },
    (body) => {
      body.passages[0].representationHash = "d".repeat(64);
    },
    (body) => {
      body.passages[0].pageHeader.locator.page = 2;
    },
  ]) {
    let keyReads = 0;
    let calls = 0;
    await assert.rejects(
      analyzeSecurities({
        dossier: value,
        env: {
          SECURITIES_MODEL_MODE: "live",
          get SECURITIES_OPENROUTER_API_KEY() {
            keyReads += 1;
            return env.SECURITIES_OPENROUTER_API_KEY;
          },
        },
        readEvidence: async () => packet(value.sources[0], { mutate }),
        fetchImpl: async () => {
          calls += 1;
          assert.fail("Invalid source packets cannot reach the provider.");
        },
      }),
      { code: "model_invalid_research" },
    );
    assert.equal(keyReads, 0);
    assert.equal(calls, 0);
  }
  const forged = packet(value.sources[0]);
  forged.passages[0].text += " Mutated after hashing.";
  await assert.rejects(
    analyzeSecurities({
      dossier: value,
      env,
      readEvidence: async () => forged,
      fetchImpl: async () => assert.fail("Bad hash cannot reach the provider."),
    }),
    { code: "model_invalid_research" },
  );
});

test("a page-specific research read cannot return a different page", async () => {
  const value = dossier();
  let reads = 0;
  const engine = provider(readAction(value, [readRequest(value, "", [2])]));
  await assert.rejects(
    analyzeSecurities({
      dossier: value,
      env,
      fetchImpl: engine.fetchImpl,
      readEvidence: async () => packet(value.sources[0], { pages: ++reads === 1 ? [1] : [3] }),
    }),
    (error) =>
      error.code === "model_invalid_research" &&
      error.validationReason === "source_coverage" &&
      error.receipts.length === 1,
  );
  assert.equal(engine.calls, 1);
});

test("cancel during a later read retains the already completed planning receipt", async () => {
  const value = dossier();
  const controller = new AbortController();
  let reads = 0;
  const engine = provider(readAction(value, [readRequest(value)]));
  await assert.rejects(
    analyzeSecurities({
      dossier: value,
      env,
      signal: controller.signal,
      fetchImpl: engine.fetchImpl,
      readEvidence: async () => {
        reads += 1;
        if (reads === 2) controller.abort();
        return packet(value.sources[0]);
      },
    }),
    (error) =>
      error.code === "model_cancelled" &&
      error.receipts.length === 1 &&
      error.receipts[0].costUsd === 0.00002,
  );
  assert.equal(engine.calls, 1);
});

test("progress callback failure is isolated while receipt persistence remains mandatory", async () => {
  const value = dossier();
  const engine = provider(report(value));
  let writes = 0;
  const result = await analyzeSecurities({
    dossier: value,
    env,
    fetchImpl: engine.fetchImpl,
    onProgress: () => {
      throw new Error("Transient progress UI failure.");
    },
    onReceipt: () => {
      writes += 1;
    },
  });
  assert.equal(result.validation.semantic.status, "passed");
  assert.equal(writes, 3);
});

test("unsupported causal wording is repaired then omitted; no positive consistency default exists", async () => {
  const value = dossier();
  const candidate = report(value);
  candidate.claims.push({
    id: "cause",
    kind: "source_fact",
    text: "The revenue increase was caused by a new acquisition.",
    sourceIds: ["annual"],
    metricIds: [],
    evidenceQuotes: [{ sourceId: "annual", quote: "{{source_excerpt:basis}}" }],
  });
  candidate.report.sections = [{ id: "earnings_quality", claimIds: ["cause"] }];
  const engine = provider(candidate, {
    verdict: (claim) => (claim.id === "cause" ? "unsupported" : "supported"),
  });
  const result = await analyzeSecurities({ dossier: value, env, fetchImpl: engine.fetchImpl });
  assert.equal(engine.drafts, 2);
  assert.deepEqual(
    result.claims.map((claim) => claim.id),
    ["revenue"],
  );
  assert.equal(result.validation.semantic.status, "limited");
  assert.doesNotMatch(result.summary, /acquisition/);
  assert.equal(result.research.gaps.length > 0, true);
  assert.equal(result.receipts.length, 4);
});

test("unsupported claims cannot be smuggled through gaps or limitations", async () => {
  const value = dossier();
  const candidate = report(value);
  candidate.limitations = ["The company has already become insolvent."];
  const engine = provider(candidate, { notesVerdict: "unsupported" });
  const result = await analyzeSecurities({ dossier: value, env, fetchImpl: engine.fetchImpl });
  assert.equal(result.validation.semantic.status, "limited");
  assert.deepEqual(result.limitations, []);
  assert.doesNotMatch(JSON.stringify(result.research.gaps), /insolvent/);
});

test("consistency identity binds the exact narrative and rejects missing claim or notes verdicts", async () => {
  const value = dossier();
  const candidate = validateSecuritiesReport(report(value), value);
  const identity = await reportIdentity(candidate, value);
  const checked = {
    dossierId: value.id,
    revision: value.revision,
    narrativeHash: identity,
    claims: [{ id: "revenue", verdict: "supported", reason: "Fixture." }],
    notes: { verdict: "supported", reason: "Fixture." },
  };
  assert.equal(validateConsistencyCheck(checked, candidate, value, identity).status, "passed");
  for (const mutate of [
    (item) => {
      item.narrativeHash = "d".repeat(64);
    },
    (item) => {
      item.revision += 1;
    },
    (item) => {
      item.claims = [];
    },
    (item) => {
      delete item.notes;
    },
  ]) {
    const invalid = structuredClone(checked);
    mutate(invalid);
    assert.throws(() => validateConsistencyCheck(invalid, candidate, value, identity), {
      code: "model_invalid_consistency_check",
    });
  }
  assert.throws(
    () =>
      applyConsistencyCheck(candidate, {
        ...checked,
        status: "limited",
        claims: [{ id: "revenue", verdict: "unclear", reason: "Fixture." }],
      }),
    { code: "model_no_supported_report" },
  );
});

test("verified supplemental CFO is usable while a differently based prior CFO remains audit-only", async () => {
  const dataset = await loadSecuritiesDataset({
    companyId: "FPT",
    periodId: "H1_2026",
    comparisonPeriodId: "H1_2025_restated",
  });
  const value = createDossier(dataset, { id: "fixture-fpt-h1", locale: "en" });
  const source = value.sources.find((item) => item.id === "fpt-h1-2026");
  const facts = getVerifiedSecuritiesFacts({
    sourceId: source.id,
    sourceVersion: source.version,
  }).filter((fact) => fact.locator.page === 13);
  const candidate = report(value, {
    claims: [
      {
        id: "cash",
        kind: "calculated",
        text: "Net operating cash flow was {{metric:operating_cash_flow:current}}; cash from operations relative to profit after tax was {{derived:operating_cash_flow_to_profit:current}}.",
        metricIds: ["operating_cash_flow", "profit_after_tax"],
        sourceIds: [source.id],
        evidenceQuotes: [],
      },
    ],
    report: { summaryClaimIds: ["cash"], sections: [] },
  });
  let snapshot;
  const engine = provider(candidate, {
    inspect: (_body, payload) => {
      snapshot = payload.untrustedDossier;
    },
  });
  const result = await analyzeSecurities({
    dossier: value,
    env,
    locale: "en",
    fetchImpl: engine.fetchImpl,
    readEvidence: async () => packet(source, { pages: [13], facts }),
  });
  assert.match(result.summary, /-1.15 VND trillion/);
  assert.match(result.summary, /-22.7%/);
  assert.equal(
    snapshot.metrics.find((metric) => metric.id === "operating_cash_flow").comparison.value,
    null,
  );
  assert.equal(result.research.verifiedFacts.length, 2);
  const origin = result.claims[0].numericOrigins.find(
    (item) => item.metricId === "operating_cash_flow",
  );
  assert.equal(origin.origin, "verified_supplemental_fact");
  assert.equal(origin.factId, "fpt-h1-cfo-current");
  assert.equal(
    value.metrics.some((metric) => metric.id === "operating_cash_flow"),
    false,
  );
});

test("a copied valid ledger receipt cannot promote a tampered supplemental amount", async () => {
  const dataset = await loadSecuritiesDataset({
    companyId: "FPT",
    periodId: "H1_2026",
    comparisonPeriodId: "H1_2025_restated",
  });
  const value = createDossier(dataset, { id: "fixture-fpt-forged", locale: "en" });
  const source = value.sources.find((item) => item.id === "fpt-h1-2026");
  const fact = getVerifiedSecuritiesFacts({
    sourceId: source.id,
    sourceVersion: source.version,
  }).find((item) => item.factId === "fpt-h1-cfo-current");
  fact.value = "999999999";
  let calls = 0;
  await assert.rejects(
    analyzeSecurities({
      dossier: value,
      env,
      readEvidence: async () => packet(source, { pages: [13], facts: [fact] }),
      fetchImpl: async () => {
        calls += 1;
        assert.fail("Forged numeric ledger cannot reach model.");
      },
    }),
    (error) =>
      error.code === "model_invalid_research" && error.validationReason === "supplemental_identity",
  );
  assert.equal(calls, 0);
});

const VI_REVENUE_PROSE =
  "Trong {{context:period}} so với {{context:comparisonPeriod}}, doanh thu thuần {{metric:revenue:relativeChangePct:movement}}, tạo nên quy mô bán hàng lớn hơn trong kỳ báo cáo.";
const ASCII_REVENUE_PROSE =
  "Trong {{context:period}} so voi {{context:comparisonPeriod}}, doanh thu thuan {{metric:revenue:relativeChangePct:movement}}, tao nen quy mo ban hang lon hon trong ky bao cao.";

test("Vietnamese report prose cannot borrow diacritics from rendered values, quotations or punctuation", () => {
  const value = dossier();
  value.sources[0].excerpts[0].text = "Báo cáo hợp nhất trình bày kỳ hiện tại và kỳ so sánh.";
  const candidate = report(value);
  candidate.claims[0].evidenceQuotes = [{ sourceId: "annual", quote: "{{source_excerpt:basis}}" }];
  for (const text of [ASCII_REVENUE_PROSE, `“${ASCII_REVENUE_PROSE}”`]) {
    candidate.claims[0].text = text;
    assert.throws(
      () => validateSecuritiesReport(candidate, value, "vi"),
      (error) =>
        error.code === "model_invalid_report_locale" &&
        error.validationReason === "vietnamese_diacritics_required" &&
        error.validationClaimId === "revenue",
    );
  }
  candidate.claims[0].text = VI_REVENUE_PROSE;
  const accepted = validateSecuritiesReport(candidate, value, "vi");
  assert.match(accepted.summary, /doanh thu thuần tăng 20%/u);
  assert.equal(accepted.claims[0].evidenceQuotes[0].quote, value.sources[0].excerpts[0].text);
  candidate.claims[0].text = VI_REVENUE_PROSE.normalize("NFD");
  assert.doesNotThrow(() => validateSecuritiesReport(candidate, value, "vi"));
  candidate.claims[0].text =
    "During {{context:period}}, revenue {{metric:revenue:relativeChangePct:movement}} against {{context:comparisonPeriod}}, giving the company a larger sales base across the selected reporting period.";
  assert.doesNotThrow(() => validateSecuritiesReport(candidate, value, "en"));
  candidate.claims[0].text =
    "FPT " +
    "{{metric:revenue:relativeChangePct:movement}} {{context:period}} {{source_page:basis}} ".repeat(
      5,
    );
  assert.doesNotThrow(() => validateSecuritiesReport(candidate, value, "vi"));
  candidate.claims[0].text = "FPT: doanh thu {{metric:revenue:current}}.";
  candidate.claims[0].kind = "source_fact";
  assert.doesNotThrow(() => validateSecuritiesReport(candidate, value, "vi"));
});

test("Vietnamese locale covers long gap and limitation prose without weakening numeric errors", () => {
  const value = dossier();
  const ascii =
    "Pham vi tai lieu da doc va thong tin chua du dieu kien kiem chung can duoc trinh bay ro rang.";
  const accented =
    "Phạm vi tài liệu đã đọc và thông tin chưa đủ điều kiện kiểm chứng cần được trình bày rõ ràng.";
  for (const field of ["topic", "reason", "impact", "limitation"]) {
    const candidate = report(value);
    candidate.gaps = [
      { topic: "Tài liệu", reason: "Chưa đủ dữ liệu.", impact: "Kết luận có giới hạn." },
    ];
    if (field === "limitation") candidate.limitations = [ascii];
    else candidate.gaps[0][field] = ascii;
    assert.throws(() => validateSecuritiesReport(candidate, value, "vi"), {
      code: "model_invalid_report_locale",
      validationReason: "vietnamese_diacritics_required",
    });
    if (field === "limitation") candidate.limitations[0] = accented;
    else candidate.gaps[0][field] = accented;
    assert.doesNotThrow(() => validateSecuritiesReport(candidate, value, "vi"));
  }
  const invalidAmount = report(value);
  invalidAmount.claims[0].text = ASCII_REVENUE_PROSE + " Unbound amount 123.";
  assert.throws(() => validateSecuritiesReport(invalidAmount, value, "vi"), {
    code: "model_unbound_numeric_output",
  });
});

test("ASCII read repair never changes Vietnamese report language and a rejected unaccented draft is regenerated", async () => {
  const value = dossier();
  const unaccented = report(value);
  unaccented.claims[0].text = ASCII_REVENUE_PROSE;
  const clean = structuredClone(unaccented);
  clean.claims[0].text = VI_REVENUE_PROSE;
  const original = JSON.stringify(value);
  const reads = [];
  const engine = provider(
    (round, payload) => {
      assert.equal(payload.locale, "vi");
      if (round === 1) return readAction(value, [readRequest(value, "ph\u001eai thu", [])]);
      if (round === 2) {
        assert.equal(payload.repairFeedback.deterministicFailure.reason, "read_arguments");
        assert.match(payload.repairFeedback.instruction, /plain ASCII queries/u);
        assert.match(payload.repairFeedback.instruction, /Vietnamese with full diacritics/u);
        return readAction(value, [readRequest(value, "doanh thu", [])]);
      }
      if (round === 3) return unaccented;
      assert.equal(
        payload.repairFeedback.deterministicFailure.reason,
        "vietnamese_diacritics_required",
      );
      assert.match(payload.repairFeedback.instruction, /Check every prose field/u);
      assert.equal(
        payload.repairFeedback.untrustedRejectedReport.claims[0].text,
        ASCII_REVENUE_PROSE,
      );
      return clean;
    },
    {
      inspect: (body) => {
        if (body.response_format.json_schema.name === "securities_analyst_report") {
          assert.match(body.messages[0].content, /The report locale is vi/u);
          assert.match(body.messages[0].content, /Vietnamese with full diacritics/u);
          assert.match(body.messages[0].content, /ONLY internal readRequests\[\]\.query/u);
        }
      },
    },
  );
  const result = await chatSecurities({
    dossier: value,
    question: "Giải thích biến động doanh thu.",
    locale: "vi",
    env,
    fetchImpl: engine.fetchImpl,
    readEvidence: async (request) => {
      reads.push(request.query);
      return packet(value.sources[0]);
    },
  });
  assert.ok(reads.includes("doanh thu"));
  assert.ok(reads.every((query) => !query.includes("\u001e")));
  assert.equal(engine.calls, 5);
  assert.equal(
    result.receipts.filter((receipt) => receipt.validation.code === "model_invalid_report_locale")
      .length,
    1,
  );
  assert.equal(result.validation.semantic.status, "passed");
  assert.match(result.summary, /doanh thu thuần tăng 20%/u);
  assert.deepEqual(
    result.claims[0].numericOrigins,
    validateSecuritiesReport(clean, value, "vi").claims[0].numericOrigins,
  );
  assert.equal(JSON.stringify(value), original);
});

function cashBindingFixture() {
  const value = dossier();
  value.metrics[1].current.value = 18_000_000_000;
  const cfo = structuredClone(value.metrics[0]);
  cfo.id = "operating_cash_flow";
  cfo.label = { vi: "Dòng tiền kinh doanh", en: "Operating cash flow" };
  cfo.current.value = -1_000_000_000;
  cfo.current.locator = { page: 13, rowCode: "20", precision: "cell" };
  const parent = structuredClone(value.metrics[1]);
  parent.id = "profit_parent";
  parent.current.value = 20_000_000_000;
  value.metrics = calculateDossierMetrics([...value.metrics, cfo, parent], value);
  value.sources[0].excerpts.push(
    {
      id: "profit-note",
      text: "The profit disclosure separates group profit and the parent shareholders' share.",
      locator: { page: 18 },
    },
    {
      id: "cash-note",
      text: "Lưu chuyển tiền thuần sử dụng vào hoạt động kinh doanh được trình bày trong kỳ hiện tại.",
      locator: { page: 13 },
    },
  );
  const claim = {
    id: "b4",
    kind: "analyst_opinion",
    text: "Điểm cần xem kỹ là sự phân kỳ giữa lợi nhuận tăng và dòng tiền kinh doanh âm; nguyên nhân vốn lưu động cụ thể chưa được xác lập từ phần đọc đã có.",
    metricIds: ["profit_after_tax", "profit_parent"],
    sourceIds: ["annual"],
    evidenceQuotes: [{ sourceId: "annual", quote: "{{source_excerpt:profit-note}}" }],
  };
  return { value, claim };
}

test("the observed qualitative cash concern cannot borrow another claim's CFO or profit-only page evidence", () => {
  const { value, claim } = cashBindingFixture();
  const candidate = report(value, {
    claims: [
      {
        id: "s2",
        kind: "source_fact",
        text: "Dòng tiền kinh doanh kỳ này là {{metric:operating_cash_flow:current}}.",
        metricIds: ["operating_cash_flow"],
        sourceIds: ["annual"],
        evidenceQuotes: [{ sourceId: "annual", quote: "{{source_excerpt:cash-note}}" }],
      },
      claim,
    ],
    report: { summaryClaimIds: ["s2"], sections: [{ id: "cash_and_funding", claimIds: ["b4"] }] },
  });
  const accented = claim.text;
  for (const [locale, text] of [
    ["vi", accented],
    [
      "vi",
      "Diem can xem ky la su phan ky giua loi nhuan tang va dong tien kinh doanh am, cung voi viec loi nhuan thuoc cong ty me cao hon tong loi nhuan do phan co dong khac suy ra la am; nguyen nhan von luu dong cu the chua duoc xac lap tu phan doc da co.",
    ],
    ["en", "Operating cash flow is negative in the current period, while profit is positive."],
  ]) {
    claim.text = text;
    const original = JSON.stringify(candidate);
    assert.throws(() => validateSecuritiesReport(candidate, value, locale), {
      code: "model_unsupported_fact",
      validationReason: "negative_cfo_metric_binding",
      validationClaimId: "b4",
    });
    assert.equal(JSON.stringify(candidate), original);
  }
  claim.text = accented;
  claim.metricIds.push("operating_cash_flow");
  assert.throws(() => validateSecuritiesReport(candidate, value, "vi"), {
    code: "model_unsupported_fact",
    validationReason: "negative_cfo_evidence_binding",
  });
  const withCurrentNumber = structuredClone(candidate);
  withCurrentNumber.claims[1].text +=
    " Dòng tiền kinh doanh kỳ này là {{metric:operating_cash_flow:current}}.";
  const bound = validateSecuritiesReport(withCurrentNumber, value, "vi").claims.find(
    (entry) => entry.id === "b4",
  );
  assert.equal(
    bound.numericOrigins.find(
      (origin) => origin.metricId === "operating_cash_flow" && origin.side === "current",
    ).locator.page,
    13,
  );
  claim.evidenceQuotes.push({ sourceId: "annual", quote: "{{source_excerpt:cash-note}}" });
  const accepted = validateSecuritiesReport(candidate, value, "vi").claims.find(
    (entry) => entry.id === "b4",
  );
  assert.equal(
    accepted.numericOrigins.length,
    0,
    "No unrequested number or synthetic numeric origin was inserted.",
  );
  assert.equal(
    accepted.evidenceQuotes.find((quote) => quote.sourceExcerptId === "cash-note").locator.page,
    13,
  );
  assert.equal(accepted.text, accented);
});

test("qualitative negative current cash requires its actual verified sign, source and current-page evidence", () => {
  const { value, claim } = cashBindingFixture();
  claim.metricIds.push("operating_cash_flow");
  claim.evidenceQuotes.push({ sourceId: "annual", quote: "{{source_excerpt:cash-note}}" });
  const candidate = report(value, {
    claims: [claim],
    report: { summaryClaimIds: [claim.id], sections: [] },
  });
  for (const [amount, verification, code] of [
    [0, "verified", "model_numeric_narrative_mismatch"],
    [1_000_000_000, "verified", "model_numeric_narrative_mismatch"],
    [null, "verified", "model_unverified_numeric_input"],
    [-1_000_000_000, "unverified", "model_unverified_numeric_input"],
    [-1_000_000_000, "user_verified", "model_unverified_correction"],
  ]) {
    const invalid = structuredClone(value);
    const cfo = invalid.metrics.find((metric) => metric.id === "operating_cash_flow");
    cfo.current.value = amount;
    cfo.current.verification = verification;
    assert.throws(() => validateSecuritiesReport(candidate, invalid, "vi"), { code });
  }
  const source = { ...structuredClone(value.sources[0]), id: "cash-source" };
  value.sources.push(source);
  value.metrics.find((metric) => metric.id === "operating_cash_flow").current.sourceId = source.id;
  assert.throws(() => validateSecuritiesReport(candidate, value, "vi"), {
    validationReason: "negative_cfo_source_binding",
  });
  claim.sourceIds.push(source.id);
  assert.throws(() => validateSecuritiesReport(candidate, value, "vi"), {
    validationReason: "negative_cfo_evidence_binding",
  });
  claim.evidenceQuotes.push({ sourceId: source.id, quote: "{{source_excerpt:cash-note}}" });
  assert.doesNotThrow(() => validateSecuritiesReport(candidate, value, "vi"));
});

test("cash binding guard preserves questions, unknown signs, negations, definitions and other periods", () => {
  const { value, claim } = cashBindingFixture();
  const candidate = report(value, {
    claims: [claim],
    report: { summaryClaimIds: [claim.id], sections: [] },
  });
  for (const [locale, text] of [
    ["vi", "Dòng tiền kinh doanh có âm không?"],
    ["vi", "Dòng tiền kinh doanh âm?"],
    ["vi", "Chưa rõ liệu dòng tiền kinh doanh âm hay dương."],
    ["vi", "Chưa rõ dòng tiền kinh doanh âm."],
    ["vi", "Không khẳng định dòng tiền kinh doanh âm."],
    ["vi", "Dòng tiền kinh doanh không âm."],
    ["vi", "Nếu dòng tiền kinh doanh âm thì cần kiểm tra thuyết minh."],
    ["vi", "Dòng tiền kinh doanh âm trong kỳ trước."],
    ["vi", "Trong {{context:comparisonPeriod}}, dòng tiền kinh doanh âm."],
    ["vi", "Dòng tiền kinh doanh âm nghĩa là hoạt động kinh doanh dùng tiền ròng."],
    ["en", "Is operating cash flow negative?"],
    ["en", "Operating cash flow is not negative."],
    ["en", "Whether operating cash flow is negative remains unknown."],
    ["en", "If current operating cash flow is negative, inspect the notes."],
    ["en", "Operating cash flow was negative in the previous period."],
    ["en", "Negative operating cash flow means net cash used in operations."],
  ]) {
    claim.text = text;
    assert.doesNotThrow(() => validateSecuritiesReport(candidate, value, locale), text);
  }
  claim.text = "Chưa rõ nguyên nhân khiến dòng tiền kinh doanh âm.";
  assert.throws(() => validateSecuritiesReport(candidate, value, "vi"), {
    validationReason: "negative_cfo_metric_binding",
  });
});

test("a qualitative cash binding repair adds the exact CFO excerpt to that claim before consistency checking", async () => {
  const { value, claim } = cashBindingFixture();
  const factual = report(value).claims[0];
  factual.text = VI_REVENUE_PROSE;
  const candidate = report(value, {
    claims: [claim, factual],
    report: {
      summaryClaimIds: [claim.id],
      sections: [{ id: "performance", claimIds: [factual.id] }],
    },
  });
  const fixed = structuredClone(candidate);
  fixed.claims[0].metricIds.push("operating_cash_flow");
  fixed.claims[0].evidenceQuotes.push({
    sourceId: "annual",
    quote: "{{source_excerpt:cash-note}}",
  });
  const engine = provider(
    (round, payload) => {
      if (round === 1) return candidate;
      assert.equal(
        payload.repairFeedback.deterministicFailure.reason,
        "negative_cfo_metric_binding",
      );
      assert.match(
        payload.repairFeedback.instruction,
        /select an exact excerpt on the verified current CFO cell's page/u,
      );
      return fixed;
    },
    {
      inspect: (body) =>
        assert.match(body.messages[0].content, /Qualitative financial assertions also/u),
    },
  );
  const result = await chatSecurities({
    dossier: value,
    question: "Nêu điểm cần xem kỹ.",
    locale: "vi",
    env,
    fetchImpl: engine.fetchImpl,
  });
  assert.equal(engine.calls, 3);
  assert.equal(result.validation.semantic.status, "passed");
  assert.equal(
    result.claims[0].evidenceQuotes.find((quote) => quote.sourceExcerptId === "cash-note").locator
      .page,
    13,
  );
  assert.match(
    securitiesReportInstruction("analysis", "vi"),
    /answer that relationship directly in plain language from the verified evidence/u,
  );
});

function bankDossier() {
  const value = dossier();
  value.id = "fixture-bank-report";
  value.company = { id: "ACB", ticker: "ACB", name: "Fixture bank", sectorId: "banking" };
  value.sources[0].url = "https://acb.com.vn/bao-cao-tai-chinh";
  const template = value.metrics[0];
  value.metrics = [
    ["net_interest_income", "Thu nhập lãi thuần", "Net interest income", 80, 70],
    ["net_fee_income", "Lãi thuần từ hoạt động dịch vụ", "Net fee income", 10, 9],
    ["operating_expenses", "Chi phí hoạt động", "Operating expenses", -44, -40],
    [
      "operating_profit_before_provision",
      "Lợi nhuận trước dự phòng",
      "Operating profit before provisions",
      56,
      45,
    ],
    ["credit_loss_provision", "Chi phí dự phòng rủi ro tín dụng", "Credit-loss provisions", -6, -5],
    ["profit_before_tax", "Lợi nhuận trước thuế", "Profit before tax", 50, 40],
    ["profit_after_tax", "Lợi nhuận sau thuế", "Profit after tax", 40, 32],
    ["bank_operating_cash_flow", "Dòng tiền kinh doanh", "Operating cash flow", -30, 20],
  ].map(([id, vi, en, current, comparison]) => ({
    id,
    label: { vi, en },
    unit: "VND",
    ...Object.fromEntries(
      Object.entries({ current, comparison }).map(([side, amount]) => [
        side,
        {
          ...structuredClone(template[side]),
          entityId: "ACB",
          value: amount * 1_000_000_000,
          locator: { page: id === "bank_operating_cash_flow" ? 13 : 6, precision: "cell" },
        },
      ]),
    ),
  }));
  value.metrics = calculateDossierMetrics(value.metrics, value);
  value.sources[0].excerpts.push(
    {
      id: "bank-income",
      text: "The banking income statement separates interest income, fee income and signed expense rows.",
      locator: { page: 6 },
    },
    {
      id: "bank-cash",
      text: "The operating cash-flow statement identifies customer lending and deposit movements.",
      locator: { page: 13 },
    },
  );
  return value;
}

function bankReport(value, text, metricIds, extra = {}) {
  return report(value, {
    claims: [
      {
        id: "bank-finding",
        kind: "source_fact",
        text,
        metricIds,
        sourceIds: ["annual"],
        evidenceQuotes: [],
        ...extra,
      },
    ],
    report: { summaryClaimIds: ["bank-finding"], sections: [] },
  });
}

test("bank statement labels bind distinct signed metrics in both locales without revenue aliases", () => {
  const value = bankDossier();
  const original = JSON.stringify(value);
  assert.equal(value.metrics.length, 8);
  assert.equal(
    value.metrics.some((metric) => metric.id === "revenue"),
    false,
  );
  assert.equal(
    value.metrics.some((metric) => metric.id === "operating_cash_flow"),
    false,
  );
  for (const metric of value.metrics) {
    for (const locale of ["en", "vi"]) {
      const text =
        `${metric.label[locale]} ` +
        (locale === "vi" ? "là " : "was ") +
        `{{metric:${metric.id}:current}}` +
        (locale === "vi" ? " so với " : " compared with ") +
        `{{metric:${metric.id}:comparison}}.`;
      const claim = validateSecuritiesReport(bankReport(value, text, [metric.id]), value, locale)
        .claims[0];
      assert.deepEqual(
        claim.numericOrigins.map((origin) => origin.metricId),
        [metric.id, metric.id],
      );
      assert.deepEqual(
        claim.numericDisplays.map((display) => display.value),
        [metric.current.value, metric.comparison.value],
      );
    }
  }
  for (const [label, id] of [
    ["Revenue", "net_interest_income"],
    ["Net fee income", "net_interest_income"],
    ["Operating profit before provisions", "profit_before_tax"],
    ["Credit-loss provisions", "operating_expenses"],
    ["CFO", "profit_after_tax"],
    ["Lưu chuyển tiền thuần từ hoạt động kinh doanh", "profit_after_tax"],
  ]) {
    assert.throws(
      () =>
        validateSecuritiesReport(
          bankReport(value, `${label} was {{metric:${id}:current}}.`, [id]),
          value,
          "en",
        ),
      { validationReason: "numeric_label_mismatch" },
      label,
    );
  }
  assert.equal(JSON.stringify(value), original);
});

test("canonical bank catalog labels bind their own metric and reject a profit swap in both locales", async (t) => {
  const value = bankDossier();
  for (const metric of value.metrics) {
    for (const locale of ["en", "vi"]) {
      await t.test(`${metric.id}: ${locale}`, () => {
        const label = SECURITIES_METRICS[metric.id].label[locale];
        const predicate = locale === "vi" ? "là" : "was";
        const candidate = bankReport(
          value,
          `${label} ${predicate} {{metric:${metric.id}:current}}.`,
          [metric.id],
        );
        assert.doesNotThrow(() => validateSecuritiesReport(candidate, value, locale));
        const wrongId =
          metric.id === "profit_after_tax" ? "net_interest_income" : "profit_after_tax";
        candidate.claims[0].text = `${label} ${predicate} {{metric:${wrongId}:current}}.`;
        candidate.claims[0].metricIds = [wrongId];
        assert.throws(() => validateSecuritiesReport(candidate, value, locale), {
          validationReason: "numeric_label_mismatch",
        });
      });
    }
  }
});

test("canonical bank CFO prose without a number still requires its own current source and page", async (t) => {
  for (const [locale, text] of [
    ["vi", "Dòng tiền thuần từ hoạt động kinh doanh ngân hàng trong kỳ âm."],
    ["en", "Net cash from banking operating activities is negative."],
  ]) {
    await t.test(locale, () => {
      const value = bankDossier();
      const candidate = bankReport(value, text, ["profit_after_tax"], {
        kind: "analyst_opinion",
        evidenceQuotes: [{ sourceId: "annual", quote: "{{source_excerpt:bank-income}}" }],
      });
      assert.throws(() => validateSecuritiesReport(candidate, value, locale), {
        validationReason: "negative_cfo_metric_binding",
      });
      candidate.claims[0].metricIds.push("bank_operating_cash_flow");
      assert.throws(() => validateSecuritiesReport(candidate, value, locale), {
        validationReason: "negative_cfo_evidence_binding",
      });
      candidate.claims[0].evidenceQuotes.push({
        sourceId: "annual",
        quote: "{{source_excerpt:bank-cash}}",
      });
      assert.doesNotThrow(() => validateSecuritiesReport(candidate, value, locale));
      const cfo = value.metrics.find((metric) => metric.id === "bank_operating_cash_flow");
      cfo.current.value = 1;
      assert.throws(() => validateSecuritiesReport(candidate, value, locale), {
        validationReason: "negative_cfo_sign_mismatch",
      });
      cfo.current.value = -30_000_000_000;
      const source = { ...structuredClone(value.sources[0]), id: "separate-bank-cash" };
      value.sources.push(source);
      cfo.current.sourceId = source.id;
      assert.throws(() => validateSecuritiesReport(candidate, value, locale), {
        validationReason: "negative_cfo_source_binding",
      });
      candidate.claims[0].sourceIds.push(source.id);
      assert.throws(() => validateSecuritiesReport(candidate, value, locale), {
        validationReason: "negative_cfo_evidence_binding",
      });
      candidate.claims[0].evidenceQuotes.push({
        sourceId: source.id,
        quote: "{{source_excerpt:bank-cash}}",
      });
      assert.equal(
        validateSecuritiesReport(candidate, value, locale).claims[0].numericOrigins.length,
        0,
      );
    });
  }
});

test("bank CFO wording preserves questions, denied signs and comparison-period scope", () => {
  const value = bankDossier();
  for (const [locale, text] of [
    ["vi", "Dòng tiền thuần từ hoạt động kinh doanh ngân hàng trong kỳ âm?"],
    ["vi", "Không khẳng định dòng tiền thuần từ hoạt động kinh doanh ngân hàng trong kỳ âm."],
    [
      "vi",
      "Nếu dòng tiền thuần từ hoạt động kinh doanh ngân hàng trong kỳ âm thì cần đọc thuyết minh.",
    ],
    ["vi", "Dòng tiền thuần từ hoạt động kinh doanh ngân hàng âm trong kỳ trước."],
    ["en", "Is net cash from banking operating activities negative?"],
    ["en", "Net cash from banking operating activities is not negative."],
    ["en", "If net cash from banking operating activities is negative, inspect the notes."],
    ["en", "Net cash from banking operating activities was negative in the previous period."],
  ]) {
    assert.doesNotThrow(
      () =>
        validateSecuritiesReport(
          bankReport(value, text, ["profit_after_tax"], {
            kind: "analyst_opinion",
            evidenceQuotes: [{ sourceId: "annual", quote: "{{source_excerpt:bank-income}}" }],
          }),
          value,
          locale,
        ),
      text,
    );
  }
  assert.throws(
    () =>
      validateSecuritiesReport(
        bankReport(value, "Profit was {{metric:operating_profit_before_provision:current}}.", [
          "operating_profit_before_provision",
        ]),
        value,
        "en",
      ),
    {
      validationReason: "numeric_label_mismatch",
    },
  );
});

test("ordered banking values and signed expense changes retain label and direction checks", () => {
  const value = bankDossier();
  const ids = ["net_interest_income", "net_fee_income", "operating_profit_before_provision"];
  const text =
    "Net interest income, net fee income and operating profit before provisions were " +
    ids.map((id) => `{{metric:${id}:current}}`).join(", ") +
    " respectively.";
  const valid = bankReport(value, text, ids);
  assert.doesNotThrow(() => validateSecuritiesReport(valid, value, "en"));
  const swapped = structuredClone(valid);
  swapped.claims[0].text = text.replace("metric:net_fee_income:", "metric:net_interest_income:");
  assert.throws(() => validateSecuritiesReport(swapped, value, "en"), {
    validationReason: "numeric_label_mismatch",
  });
  for (const id of ["operating_expenses", "credit_loss_provision"]) {
    const label = value.metrics.find((metric) => metric.id === id).label.en;
    const validChange = bankReport(
      value,
      `The signed ${label.toLowerCase()} row {{metric:${id}:absoluteChange:movement}}.`,
      [id],
      { kind: "calculated" },
    );
    assert.doesNotThrow(() => validateSecuritiesReport(validChange, value, "en"));
    validChange.claims[0].text = `${label} {{metric:${id}:absoluteChange:movement}}.`;
    assert.throws(() => validateSecuritiesReport(validChange, value, "en"), {
      validationReason: "signed_expense_direction_requires_context",
    });
    validChange.claims[0].text = `${label} decreased by {{metric:${id}:absoluteChange}}.`;
    assert.throws(() => validateSecuritiesReport(validChange, value, "en"), {
      validationReason: "signed_expense_direction_requires_context",
    });
    validChange.claims[0].text = `${label} increased by {{metric:${id}:absoluteChange}}.`;
    assert.throws(() => validateSecuritiesReport(validChange, value, "en"), {
      validationReason: "numeric_direction_mismatch",
    });
    validChange.claims[0].text = `${label} {{metric:${id}:relativeChangePct:movement}}.`;
    assert.throws(() => validateSecuritiesReport(validChange, value, "en"), {
      code: "model_unavailable_calculation",
    });
  }
});

test("expense direction repair offers valid signed pairs without waiving the rejected direction", () => {
  const value = bankDossier();
  for (const locale of ["vi", "en"]) {
    const id = "operating_expenses";
    const text =
      locale === "vi"
        ? `Dòng chi phí hoạt động mang dấu âm tăng thêm {{metric:${id}:absoluteChange}}.`
        : `The signed operating expenses increased by {{metric:${id}:absoluteChange}}.`;
    const rejected = bankReport(value, text, [id], { kind: "calculated" });
    let failure;
    try {
      validateSecuritiesReport(rejected, value, locale);
    } catch (error) {
      failure = error;
    }
    assert.equal(failure?.validationReason, "numeric_direction_mismatch");
    const feedback = securitiesReportRepairFeedback(rejected, value, locale, failure);
    assert.equal(feedback.expenseComparisonTemplates.length, 1);
    const suggested = feedback.expenseComparisonTemplates[0];
    const repaired = bankReport(value, suggested.text, [id]);
    assert.doesNotThrow(() => validateSecuritiesReport(repaired, value, locale));
    repaired.claims[0].text = suggested.text.replace(
      `metric:${id}:current`,
      "metric:profit_after_tax:current",
    );
    assert.throws(() => validateSecuritiesReport(repaired, value, locale));
    assert.throws(() => validateSecuritiesReport(rejected, value, locale), {
      validationReason: "numeric_direction_mismatch",
    });
  }
});

test("bank operating income and CIR render only verified compound inputs and supported fields", () => {
  const value = bankDossier();
  const ids = ["operating_profit_before_provision", "operating_expenses"];
  const derived = calculateDerivedMetrics(value.metrics, value);
  assert.equal(
    derived.find((metric) => metric.id === "bank_total_operating_income").current.value,
    100_000_000_000,
  );
  assert.equal(derived.find((metric) => metric.id === "bank_cost_to_income").current.value, 44);
  assert.equal(
    derived.some((metric) => metric.id === "operating_cash_flow_to_profit"),
    false,
  );
  const candidate = bankReport(
    value,
    "Calculated total operating income was {{derived:bank_total_operating_income:current}}. " +
      "The cost-to-income ratio was {{derived:bank_cost_to_income:current}} compared with {{derived:bank_cost_to_income:comparison}}.",
    ids,
    { kind: "calculated" },
  );
  const claim = validateSecuritiesReport(candidate, value, "en").claims[0];
  assert.equal(claim.numericDisplays[1].value, 44);
  assert.deepEqual(
    new Set(claim.numericOrigins.map((origin) => `${origin.metricId}:${origin.side}`)),
    new Set(ids.flatMap((id) => [`${id}:current`, `${id}:comparison`])),
  );
  const missingExpense = structuredClone(candidate);
  missingExpense.claims[0].metricIds = [ids[0]];
  assert.throws(() => validateSecuritiesReport(missingExpense, value, "en"), {
    validationReason: "derived_metric_binding",
  });
  for (const token of [
    "{{derived:bank_cost_to_income:current:per100}}",
    "{{derived:bank_cost_to_income:percentagePointChange}}",
  ]) {
    assert.throws(() =>
      validateSecuritiesReport(
        bankReport(value, `CIR was ${token}.`, ids, { kind: "calculated" }),
        value,
        "en",
      ),
    );
  }
  const unverified = structuredClone(value);
  unverified.metrics.find((metric) => metric.id === "operating_expenses").current.verification =
    "unverified";
  assert.throws(() => validateSecuritiesReport(candidate, unverified, "en"), {
    code: "model_unverified_numeric_input",
  });
  const otherSource = { ...structuredClone(value.sources[0]), id: "expenses-source" };
  value.sources.push(otherSource);
  value.metrics.find((metric) => metric.id === "operating_expenses").current.sourceId =
    otherSource.id;
  assert.throws(() => validateSecuritiesReport(candidate, value, "en"), {
    validationReason: "derived_source_binding",
  });
});

test("negative bank CFO needs its own verified current metric, sign, source and page", () => {
  const value = bankDossier();
  const candidate = bankReport(
    value,
    "Operating cash flow is negative in the current period.",
    ["profit_after_tax"],
    {
      kind: "analyst_opinion",
      evidenceQuotes: [{ sourceId: "annual", quote: "{{source_excerpt:bank-income}}" }],
    },
  );
  assert.throws(() => validateSecuritiesReport(candidate, value, "en"), {
    validationReason: "negative_cfo_metric_binding",
  });
  candidate.claims[0].metricIds.push("bank_operating_cash_flow");
  assert.throws(() => validateSecuritiesReport(candidate, value, "en"), {
    validationReason: "negative_cfo_evidence_binding",
  });
  candidate.claims[0].evidenceQuotes.push({
    sourceId: "annual",
    quote: "{{source_excerpt:bank-cash}}",
  });
  assert.doesNotThrow(() => validateSecuritiesReport(candidate, value, "en"));
  for (const [amount, verification, code] of [
    [0, "verified", "model_numeric_narrative_mismatch"],
    [1, "verified", "model_numeric_narrative_mismatch"],
    [null, "verified", "model_unverified_numeric_input"],
    [-30_000_000_000, "unverified", "model_unverified_numeric_input"],
  ]) {
    const invalid = structuredClone(value);
    const cfo = invalid.metrics.find((metric) => metric.id === "bank_operating_cash_flow");
    cfo.current.value = amount;
    cfo.current.verification = verification;
    assert.throws(() => validateSecuritiesReport(candidate, invalid, "en"), { code });
  }
  const numeric = bankReport(
    value,
    "Operating cash flow is negative at {{metric:bank_operating_cash_flow:current}}.",
    ["bank_operating_cash_flow"],
  );
  const bound = validateSecuritiesReport(numeric, value, "en").claims[0];
  assert.equal(bound.numericOrigins[0].metricId, "bank_operating_cash_flow");
  assert.equal(bound.numericOrigins[0].locator.page, 13);
  const cashSource = { ...structuredClone(value.sources[0]), id: "cash-source" };
  value.sources.push(cashSource);
  value.metrics.find((metric) => metric.id === "bank_operating_cash_flow").current.sourceId =
    cashSource.id;
  assert.throws(() => validateSecuritiesReport(candidate, value, "en"), {
    validationReason: "negative_cfo_source_binding",
  });
});

test("mandatory read schemas exclude report content and repair mixed read drafts before executing requests", async () => {
  const value = bankDossier();
  const final = bankReport(
    value,
    "Operating cash flow was {{metric:bank_operating_cash_flow:current}}.",
    ["bank_operating_cash_flow"],
  );
  const reads = [];
  let readSchemas = 0;
  let reportSchemas = 0;
  const engine = provider(
    (round, payload) => {
      if (round === 1) {
        const mixed = readAction(value, [readRequest(value, "cho vay khach hang", [])]);
        mixed.claims = structuredClone(final.claims);
        return mixed;
      }
      if (round === 2) {
        assert.equal(reads.length, 1, "The rejected plan must not execute its read request.");
        assert.equal(payload.repairFeedback.deterministicFailure.reason, "read_action_shape");
        assert.match(payload.repairFeedback.instruction, /read action only/u);
        assert.match(
          payload.repairFeedback.instruction,
          /claims.*summaryClaimIds.*sections.*gaps.*limitations.*empty arrays/u,
        );
        return readAction(value, [readRequest(value, "cho vay khach hang", [])]);
      }
      return final;
    },
    {
      inspect: (body, payload) => {
        if (body.response_format.json_schema.name !== "securities_analyst_report") return;
        const properties = body.response_format.json_schema.schema.properties;
        if (payload.cashResearchRequirement.status === "pending") {
          readSchemas += 1;
          assert.deepEqual(properties.action.enum, ["read"]);
          assert.equal(properties.readRequests.minItems, 1);
          assert.equal(properties.readRequests.maxItems, 4);
          for (const field of [
            properties.claims,
            properties.report.properties.summaryClaimIds,
            properties.report.properties.sections,
            properties.gaps,
            properties.limitations,
          ])
            assert.equal(field.maxItems, 0, "Read-only schemas must require empty report arrays.");
        } else {
          reportSchemas += 1;
          assert.deepEqual(properties.action.enum, ["read", "final"]);
          assert.equal(properties.claims.maxItems, 14);
          assert.equal(properties.report.properties.sections.maxItems, 4);
          assert.equal(properties.gaps.maxItems, 8);
        }
      },
    },
  );
  const result = await analyzeSecurities({
    dossier: value,
    question: "Explain operating cash flow.",
    locale: "en",
    env,
    fetchImpl: engine.fetchImpl,
    readEvidence: async (request) => {
      reads.push(request);
      return packet(value.sources[0], { pages: [reads.length === 1 ? 1 : 13] });
    },
  });
  assert.equal(readSchemas, 2);
  assert.equal(reportSchemas, 1);
  assert.equal(reads.length, 2);
  assert.equal(result.receipts[0].validation.reason, "read_action_shape");
  assert.equal(result.validation.semantic.status, "passed");
});

test("report guidance binds each metric to its own clause and missing inputs to the verified dataset", () => {
  const value = bankDossier();
  for (const locale of ["vi", "en"]) {
    const instruction = securitiesReportInstruction("analysis", locale, value);
    assert.match(instruction, /separate clause or sentence/u);
    for (const term of ["respectively", "lần lượt", "tương ứng"])
      assert.ok(instruction.includes(term), `The ordered-list restriction must cover ${term}.`);
    assert.match(instruction, /current verified dataset/u);
    assert.match(instruction, /does not establish absence from the whole original report/u);
  }
  const feedback = securitiesReportRepairFeedback(report(value), value, "en", {
    code: "model_numeric_narrative_mismatch",
    validationReason: "numeric_label_ambiguous_ordered_list",
    validationClaimId: "sum1",
  });
  assert.match(feedback.instruction, /each metric.*separate clause or sentence/u);
  assert.match(SECURITIES_CONSISTENCY_INSTRUCTION, /missing verified inputs.*whole report/u);
});

test("bank cash discovery rejects inventory queries and requires a separate lending or funding read", async () => {
  const value = bankDossier();
  const reads = [];
  const final = bankReport(
    value,
    "Operating cash flow was {{metric:bank_operating_cash_flow:current}}.",
    ["bank_operating_cash_flow"],
  );
  let writerChecked = false;
  let checkerChecked = false;
  const engine = provider(
    (round, payload) => {
      assert.equal(payload.cashResearchRequirement.metricId, "bank_operating_cash_flow");
      assert.deepEqual(payload.cashResearchRequirement.queryTopics, [
        "cho vay khach hang",
        "tien gui cua khach hang",
        "tien gui tai cac to chuc tin dung",
      ]);
      assert.equal(payload.analysisResearchRequirement, undefined);
      if (round === 1) return readAction(value, [readRequest(value, "inventory", [])]);
      if (round === 2) {
        assert.equal(payload.cashResearchRequirement.status, "pending");
        assert.equal(
          payload.repairFeedback.deterministicFailure.reason,
          "cash_discovery_requires_topic_queries",
        );
        return readAction(value, [readRequest(value, "cho vay khach hang", [])]);
      }
      assert.equal(payload.cashResearchRequirement.status, "attempted_check_actual_read_results");
      return final;
    },
    {
      inspect: (body) => {
        const instruction = body.messages[0].content;
        if (body.response_format.json_schema.name === "securities_report_consistency") {
          checkerChecked = true;
          assert.match(
            instruction,
            /Bank operating cash flow includes lending, customer deposits and interbank movements/u,
          );
          assert.match(instruction, /Do not infer NIM, NPL ratios, ROE/u);
        } else {
          writerChecked = true;
          assert.match(instruction, /The supplied company sector is banking/u);
          assert.match(instruction, /actual signed operating_expenses and credit_loss_provision/u);
          assert.match(instruction, /does not establish profit quality/u);
        }
      },
    },
  );
  const result = await analyzeSecurities({
    dossier: value,
    question: "Explain operating cash flow.",
    locale: "en",
    env,
    fetchImpl: engine.fetchImpl,
    readEvidence: async (request) => {
      reads.push(request);
      return packet(value.sources[0], { pages: [reads.length === 1 ? 1 : 13] });
    },
  });
  assert.deepEqual(
    reads.map((request) => request.query),
    ["luu chuyen tien thuan tu hoat dong kinh doanh", "cho vay khach hang"],
  );
  assert.equal(result.receipts[0].validation.reason, "cash_discovery_requires_topic_queries");
  assert.equal(result.validation.semantic.status, "passed");
  assert.equal(writerChecked && checkerChecked, true);
  assert.equal(engine.calls, 4);
});

test("bank earnings research uses bank income, costs and provisions before a separate cash-note attempt", async () => {
  const value = bankDossier();
  const original = JSON.stringify(value);
  const ids = [
    "net_interest_income",
    "net_fee_income",
    "operating_expenses",
    "credit_loss_provision",
  ];
  const queries = [
    "thu nhap lai thuan",
    "lai thuan tu hoat dong dich vu",
    "chi phi hoat dong",
    "chi phi du phong rui ro tin dung",
  ];
  const reads = [];
  const final = bankReport(value, "Profit before tax was {{metric:profit_before_tax:current}}.", [
    "profit_before_tax",
  ]);
  const engine = provider((round, payload) => {
    assert.deepEqual(
      payload.analysisResearchRequirement.topics.map((topic) => topic.id),
      ids,
    );
    if (round === 1) return final;
    if (round === 2) {
      assert.equal(
        payload.repairFeedback.deterministicFailure.reason,
        "question_notes_not_investigated",
      );
      return readAction(
        value,
        queries.map((query) => readRequest(value, query, [])),
      );
    }
    assert.equal(payload.analysisResearchRequirement.status, "attempted_check_actual_read_results");
    if (round === 3) {
      assert.equal(
        payload.cashResearchRequirement.status,
        "pending",
        "A provision-note query is not a lending cash-flow investigation.",
      );
      return readAction(value, [readRequest(value, "tien gui cua khach hang", [])]);
    }
    assert.equal(payload.cashResearchRequirement.status, "attempted_check_actual_read_results");
    return final;
  });
  const result = await analyzeSecurities({
    dossier: value,
    question:
      "Why did earnings improve, are they sustainable, and what explains operating cash flow?",
    locale: "en",
    env,
    fetchImpl: engine.fetchImpl,
    readEvidence: async (request) => {
      reads.push(request);
      return packet(value.sources[0], { pages: [reads.length] });
    },
  });
  assert.deepEqual(
    reads.slice(1).map((request) => request.query),
    [...queries, "tien gui cua khach hang"],
  );
  assert.equal(result.research.verifiedFacts.length, 0);
  assert.equal(result.validation.semantic.status, "passed");
  assert.equal(engine.calls, 5);
  assert.equal(JSON.stringify(value), original);
});

test("an unavailable bank reader retains a banking cash-scope gap without inventing note findings", async () => {
  const value = bankDossier();
  const final = bankReport(
    value,
    "Operating cash flow was {{metric:bank_operating_cash_flow:current}}.",
    ["bank_operating_cash_flow"],
  );
  const engine = provider(final, {
    inspect: (body, payload) => {
      if (body.response_format.json_schema.name === "securities_analyst_report") {
        assert.equal(payload.cashResearchRequirement.status, "pending");
        assert.equal(payload.untrustedResearch.readsAllowed, false);
      }
    },
  });
  const result = await analyzeSecurities({
    dossier: value,
    question: "Explain operating cash flow.",
    locale: "en",
    env,
    fetchImpl: engine.fetchImpl,
  });
  const gap = result.research.gaps.find((entry) => entry.topic === "Cash-driver reading scope");
  assert.match(gap.reason, /lending, customer deposits and interbank cash flows/u);
  assert.doesNotMatch(gap.reason, /inventory|receivables|payables/u);
  assert.equal(result.research.steps.length, 0);
  assert.equal(result.research.verifiedFacts.length, 0);
});
