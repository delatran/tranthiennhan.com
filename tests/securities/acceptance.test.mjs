import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateMargin,
  compareFinancialMetric,
  convertUnit,
  normalizeFinancialValue,
  reconcileReportedChange,
} from "../../shared/securities/finance.js";
import { assertApprovable, createDossier, reviseDossier } from "../../shared/securities/dossier.js";
import { extractStatementCells } from "../../scripts/securities/source-extract.mjs";
import { validateSecuritiesAnalysis } from "../../worker/securities/model-contract.js";
import { resolveSecuritiesScope } from "../../shared/securities/catalog.js";

// Independently authored, unblinded regression cases. These synthetic fixtures
// are not live financial data or evidence of a hidden/market-wide evaluation.
const NOW = "2026-09-06T11:20:00.000Z";
const CURRENT = { id: "FY2026", kind: "annual", durationMonths: 12, scope: "consolidated" };
const COMPARISON = { id: "FY2025", kind: "annual", durationMonths: 12, scope: "consolidated" };

function point(value, column) {
  return {
    value,
    sourceId: "synthetic-statement",
    sourceVersion: 1,
    verification: "verified",
    locator: { precision: "cell", page: 9, table: "Synthetic statement", rowCode: "10", column },
  };
}

function metric(current = 100, comparison = 80, id = "revenue") {
  return {
    id,
    label: { vi: "Chỉ tiêu kiểm thử", en: "Test metric" },
    unit: "VND_billion",
    definition: { vi: "Dữ liệu tổng hợp để kiểm thử", en: "Synthetic regression input" },
    current: point(current, "2026"),
    comparison: point(comparison, "2025"),
  };
}

function dataset() {
  return {
    company: {
      id: "QA",
      ticker: "QA",
      name: { vi: "Doanh nghiệp kiểm thử", en: "Synthetic test entity" },
      sector: "technology",
    },
    period: structuredClone(CURRENT),
    comparisonPeriod: structuredClone(COMPARISON),
    metrics: [metric()],
    sources: [
      {
        id: "synthetic-statement",
        version: 1,
        companyId: "QA",
        hash: "1".repeat(64),
        url: "https://example.com/synthetic-statement.pdf",
        role: "synthetic_test_fixture",
      },
    ],
  };
}

function approval(dossier, overrides = {}) {
  return {
    expectedRevision: dossier.revision,
    requestId: "qa-approval-0001",
    intent: "approve_exact_revision",
    ...overrides,
  };
}

test("acceptance: zero is a value; missing is not coerced to zero", () => {
  assert.equal(normalizeFinancialValue(null), null);
  assert.equal(normalizeFinancialValue(undefined), null);
  assert.equal(normalizeFinancialValue(""), null);
  assert.equal(normalizeFinancialValue(0), 0);
  assert.equal(normalizeFinancialValue("0.000"), 0);
  const zero = compareFinancialMetric(metric(0, 80));
  assert.equal(zero.absoluteChange.value, -80);
  assert.equal(zero.relativeChangePct.value, -100);
  const absent = compareFinancialMetric(metric(null, 80));
  assert.equal(absent.absoluteChange.value, null);
  assert.equal(absent.relativeChangePct.value, null);
  assert.equal(absent.relativeChangePct.status, "missing_input");
});

test("acceptance: zero and negative bases retain absolute change without misleading growth", () => {
  const zero = compareFinancialMetric(metric(40, 0));
  assert.equal(zero.absoluteChange.value, 40);
  assert.equal(zero.relativeChangePct.value, null);
  assert.equal(zero.relativeChangePct.status, "base_zero");
  const lossNarrowed = compareFinancialMetric(metric(-50, -100));
  assert.equal(lossNarrowed.absoluteChange.value, 50);
  assert.equal(lossNarrowed.relativeChangePct.value, null);
  assert.equal(lossNarrowed.relativeChangePct.status, "base_negative");
  const lossDeepened = compareFinancialMetric(metric(-150, -100));
  assert.equal(lossDeepened.absoluteChange.value, -50);
  assert.equal(lossDeepened.relativeChangePct.value, null);
  assert.equal(lossDeepened.relativeChangePct.status, "base_negative");
});

test("acceptance: decimal arithmetic preserves the actual inputs and source revision", () => {
  const value = metric("0.3", "0.1");
  value.current.sourceVersion = 2;
  value.current.correctionId = "reviewed-cell-1";
  const calculated = compareFinancialMetric(value);
  assert.equal(calculated.absoluteChange.exact, "0.2");
  assert.equal(calculated.relativeChangePct.value, 200);
  assert.equal(calculated.absoluteChange.inputRefs[0].value, "0.3");
  assert.equal(calculated.absoluteChange.inputRefs[0].sourceVersion, 2);
  assert.equal(calculated.absoluteChange.inputRefs[0].correctionId, "reviewed-cell-1");
  assert.equal(calculated.absoluteChange.inputRefs[1].sourceVersion, 1);
  assert.match(calculated.relativeChangePct.formula, /comparison/u);
});

test("acceptance: published NLG development example exposes arithmetic conflict without guessed repair", () => {
  // The supplied research PDF, page 2, reports these displayed inputs. This case
  // verifies inconsistency, not the economically correct NLG result.
  const input = metric("9.5", "149.1", "profit_before_tax");
  const calculated = compareFinancialMetric(input);
  assert.equal(calculated.absoluteChange.value, -139.6);
  assert.equal(calculated.relativeChangePct.value, -93.628437);
  assert.notEqual(calculated.relativeChangePct.value, -36.6);
  assert.equal(input.current.value, "9.5");
  assert.equal(input.comparison.value, "149.1");
});

test("acceptance: published KBC rounded positive rate is not itself a sign conflict", () => {
  const calculated = compareFinancialMetric(metric(589, 575));
  assert.equal(calculated.relativeChangePct.value, 2.434783);
  assert.equal(Math.round(calculated.relativeChangePct.value), 2);
  assert.ok(calculated.relativeChangePct.value > 0);
});

test("acceptance: reported growth uses source rounding precision rather than a fixed tolerance", () => {
  const input = metric(589, 575);
  input.reportedChangePct = {
    value: 2,
    displayDecimals: 0,
    sourceId: "synthetic-statement",
    sourceVersion: 1,
  };
  assert.equal(reconcileReportedChange(input).status, "consistent");
  input.reportedChangePct.value = -57;
  assert.equal(reconcileReportedChange(input).status, "conflict");
  const data = dataset();
  data.metrics = [input];
  const dossier = createDossier(data, { id: "qa-source-rate", now: NOW });
  assert.ok(
    dossier.issues.some(
      (issue) => issue.code === "source_rate_conflict" && issue.severity === "material",
    ),
  );
  assert.throws(() => assertApprovable(dossier, approval(dossier)), {
    code: "material_issues_unresolved",
  });
});

test("acceptance: displayed rounded input intervals prevent a false arithmetic alarm", () => {
  const input = metric(123, 100);
  input.current.roundingUnit = 1;
  input.comparison.roundingUnit = 1;
  input.reportedChangePct = { value: 24, displayDecimals: 0 };
  assert.equal(reconcileReportedChange(input).status, "consistent");
  input.current.roundingUnit = 0;
  input.comparison.roundingUnit = 0;
  assert.equal(reconcileReportedChange(input).status, "conflict");
});

test("acceptance: rounding intervals use the same converted scale as their financial inputs", () => {
  const input = metric(1000, 1000);
  for (const side of ["current", "comparison"]) {
    input[side].unit = "VND_million";
    input[side].roundingUnit = 1;
  }
  input.reportedChangePct = { value: 100, displayDecimals: 0 };
  assert.equal(reconcileReportedChange(input).status, "conflict");
  input.reportedChangePct.value = 0;
  assert.equal(reconcileReportedChange(input).status, "consistent");
});

test("acceptance: the NLG conflict remains material even after input and percentage rounding", () => {
  const input = metric(9.5, 149.1, "profit_before_tax");
  input.current.roundingUnit = 0.1;
  input.comparison.roundingUnit = 0.1;
  input.reportedChangePct = { value: -36.6, displayDecimals: 1 };
  assert.equal(reconcileReportedChange(input).status, "conflict");
  input.reportedChangePct.value = -93.6;
  assert.equal(reconcileReportedChange(input).status, "consistent");
  assert.equal(input.current.value, 9.5);
  assert.equal(input.comparison.value, 149.1);
});

test("acceptance: unknown source precision is disclosed instead of asserted as an error", () => {
  const input = metric();
  input.reportedChangePct = { value: 30 };
  assert.equal(reconcileReportedChange(input).status, "unknown_precision");
  const data = dataset();
  data.metrics = [input];
  const dossier = createDossier(data, { id: "qa-precision", now: NOW });
  assert.ok(dossier.issues.some((issue) => issue.code === "reported_rate_precision_unknown"));
  assert.ok(!dossier.issues.some((issue) => issue.code === "source_rate_conflict"));
});

test("acceptance: periods must match kind, scope and duration before arithmetic", () => {
  for (const [incompatible, status] of [
    [{ ...COMPARISON, kind: "quarter" }, "incompatible_periods"],
    [{ ...COMPARISON, scope: "separate" }, "incompatible_scope"],
    [{ ...COMPARISON, durationMonths: 6 }, "incompatible_periods"],
  ]) {
    const result = compareFinancialMetric(metric(), {
      period: CURRENT,
      comparisonPeriod: incompatible,
    });
    assert.equal(result.absoluteChange.value, null);
    assert.equal(result.relativeChangePct.value, null);
    assert.equal(result.relativeChangePct.status, status);
  }
  const compatible = compareFinancialMetric(metric(), {
    period: CURRENT,
    comparisonPeriod: COMPARISON,
  });
  assert.equal(compatible.absoluteChange.value, 20);
  assert.equal(compatible.relativeChangePct.value, 25);
});

test("acceptance: money scales convert before ratio arithmetic and retain input scale", () => {
  assert.equal(convertUnit("70112825100710", "VND", "VND_billion"), 70112.82510071);
  assert.equal(convertUnit("1.25", "VND_billion", "VND_million"), 1250);
  assert.equal(convertUnit(null, "VND", "VND_billion"), null);
  const profit = metric(25, 20, "profit_before_tax");
  const revenue = { ...metric(100_000, 80_000), unit: "VND_million" };
  const margin = calculateMargin(profit, revenue);
  assert.equal(margin.value, 25);
  assert.equal(margin.inputRefs[0].unit, "VND_billion");
  assert.equal(margin.inputRefs[1].unit, "VND_million");
  assert.equal(margin.inputRefs[1].value, 100_000);
});

test("acceptance: margins reject missing, nonpositive and incompatible revenue", () => {
  const profit = metric(-10, -20, "profit_after_tax");
  assert.equal(calculateMargin(profit, metric(100, 80)).value, -10);
  assert.equal(calculateMargin(profit, metric(null, 80)).status, "missing_input");
  assert.equal(calculateMargin(profit, metric(0, 80)).status, "nonpositive_revenue");
  assert.equal(calculateMargin(profit, metric(-100, 80)).status, "nonpositive_revenue");
  assert.equal(calculateMargin(profit, { ...metric(), unit: "USD" }).status, "incompatible_units");
});

test("acceptance: margin arithmetic honors cell-level unit metadata", () => {
  const profit = metric(25_000, 20_000, "profit_before_tax");
  profit.current.unit = "VND_million";
  const revenue = metric(100_000_000_000, 80_000_000_000);
  revenue.current.unit = "VND";
  const margin = calculateMargin(profit, revenue);
  assert.equal(margin.value, 25);
  assert.equal(margin.inputRefs[0].unit, "VND_million");
  assert.equal(margin.inputRefs[1].unit, "VND");
});

test("acceptance: cells of different entity, scope, basis or fact status cannot compare", () => {
  for (const [key, first, second] of [
    ["entityId", "QA", "OTHER"],
    ["scope", "consolidated", "separate"],
    ["basisId", "same_method", "reported_original"],
    ["dataKind", "actual", "analyst_estimate"],
  ]) {
    const input = metric();
    input.current[key] = first;
    input.comparison[key] = second;
    const compared = compareFinancialMetric(input, {
      period: CURRENT,
      comparisonPeriod: COMPARISON,
    });
    assert.equal(compared.relativeChangePct.value, null, key);
    assert.match(compared.relativeChangePct.status, /^incompatible_/u, key);
    input.comparison[key] = first;
    assert.equal(compareFinancialMetric(input).relativeChangePct.value, 25, `compatible ${key}`);
  }
});

test("acceptance: margins require the same entity, period and comparison method", () => {
  for (const [key, first, second] of [
    ["entityId", "QA", "OTHER"],
    ["scope", "consolidated", "separate"],
    ["basisId", "same_method", "reported_original"],
    ["dataKind", "actual", "analyst_estimate"],
    ["periodId", "FY2026", "H1_2026"],
  ]) {
    const profit = metric(25, 20, "profit_before_tax");
    const revenue = metric();
    profit.current[key] = first;
    revenue.current[key] = second;
    const margin = calculateMargin(profit, revenue);
    assert.equal(margin.value, null, key);
    assert.match(margin.status, /^incompatible_/u, key);
  }
});

test("acceptance: a mutually consistent pair from another company cannot approve this dossier", () => {
  for (const location of ["point", "source"]) {
    const input = dataset();
    if (location === "point") {
      input.metrics[0].current.entityId = "OTHER";
      input.metrics[0].comparison.entityId = "OTHER";
    } else {
      input.sources[0].companyId = "OTHER";
    }
    assert.throws(() => {
      const dossier = createDossier(input, { id: "qa-wrong-company", now: NOW });
      assertApprovable(dossier, approval(dossier));
    }, `Wrong company in ${location} was approved`);
  }
});

test("acceptance: valid evidence reaches approval while unverified or missing material inputs do not", () => {
  const valid = createDossier(dataset(), { id: "qa-valid", now: NOW });
  assert.equal(assertApprovable(valid, approval(valid)), true);
  for (const mutate of [
    (data) => {
      data.metrics[0].current.value = null;
    },
    (data) => {
      data.metrics[0].current.verification = "ocr_unverified";
    },
    (data) => {
      data.metrics[0].current.sourceVersion = 99;
    },
    (data) => {
      data.metrics[0].current.locator = null;
    },
  ]) {
    const input = dataset();
    mutate(input);
    const dossier = createDossier(input, { id: "qa-invalid", now: NOW });
    assert.throws(() => assertApprovable(dossier, approval(dossier)), {
      code: "material_issues_unresolved",
    });
  }
});

test("acceptance: a genuine zero and negative minority interest are valid financial observations", () => {
  const input = dataset();
  input.metrics = [
    metric(0, 80),
    metric(50, 44, "profit_after_tax"),
    metric(51, 45, "profit_parent"),
    metric(-1, -1, "profit_noncontrolling"),
  ];
  const dossier = createDossier(input, { id: "qa-valid-finance", now: NOW });
  assert.equal(assertApprovable(dossier, approval(dossier)), true);
  assert.equal(dossier.metrics.find((row) => row.id === "revenue").current.value, 0);
  assert.equal(dossier.metrics.find((row) => row.id === "profit_parent").current.value, 51);
});

test("acceptance: profit attribution reconciles compatible values after converting each cell's units", () => {
  const input = dataset();
  input.metrics = [
    metric(100, 80),
    metric(50, 44, "profit_after_tax"),
    metric(51_000, 45_000, "profit_parent"),
    metric(-1, -1, "profit_noncontrolling"),
  ];
  input.metrics[2].current.unit = "VND_million";
  input.metrics[2].comparison.unit = "VND_million";
  const dossier = createDossier(input, { id: "qa-profit-units", now: NOW });
  assert.ok(!dossier.issues.some((issue) => issue.code === "profit_attribution_conflict"));
  assert.equal(assertApprovable(dossier, approval(dossier)), true);
});

test("acceptance: an amendment keeps originals and requires source checking before approval", () => {
  const original = createDossier(dataset(), { id: "qa-amend", now: NOW });
  original.status = "approved";
  original.approval = { revision: 1, at: NOW };
  const changed = reviseDossier(
    original,
    {
      expectedRevision: 1,
      requestId: "qa-amend-0001",
      changes: [
        {
          metricId: "revenue",
          periodId: "FY2026",
          value: 110,
          reason: "Corrected from the rendered source cell.",
        },
      ],
    },
    { now: NOW, correctionId: () => "qa-correction-1" },
  );
  assert.equal(original.revision, 1);
  assert.equal(original.status, "approved");
  assert.equal(original.metrics[0].current.value, 100);
  assert.equal(changed.revision, 2);
  assert.equal(changed.status, "draft");
  assert.equal(changed.approval, null);
  assert.equal(changed.originalMetrics[0].current.value, 100);
  assert.equal(changed.corrections[0].originalValue, 100);
  assert.equal(changed.corrections[0].value, 110);
  assert.throws(() => assertApprovable(changed, approval(changed)), {
    code: "material_issues_unresolved",
  });
  const checked = reviseDossier(
    changed,
    {
      expectedRevision: 2,
      requestId: "qa-amend-0002",
      changes: [
        {
          metricId: "revenue",
          periodId: "FY2026",
          value: 110,
          reason: "Checked exact source table and column.",
          sourceChecked: true,
        },
      ],
    },
    { now: NOW, correctionId: () => "qa-correction-2" },
  );
  assert.equal(checked.originalMetrics[0].current.value, 100);
  assert.equal(checked.metrics[0].current.verification, "user_verified");
  assert.equal(assertApprovable(checked, approval(checked)), true);
});

test("acceptance: approval binds to explicit intent and the exact revision", () => {
  const dossier = createDossier(dataset(), { id: "qa-intent", now: NOW });
  assert.throws(() => assertApprovable(dossier, approval(dossier, { intent: "view" })), {
    code: "explicit_approval_required",
  });
  assert.throws(() => assertApprovable(dossier, approval(dossier, { expectedRevision: 2 })), {
    code: "revision_conflict",
  });
  assert.throws(
    () =>
      reviseDossier(dossier, {
        expectedRevision: 2,
        requestId: "qa-stale-0001",
        notes: "Changed note",
      }),
    { code: "revision_conflict" },
  );
});

test("acceptance: a material source contradiction cannot be acknowledged without evidence", () => {
  const input = dataset();
  input.issues = [
    {
      id: "table-caption-conflict",
      code: "contradictory_source",
      severity: "material",
      allowAcknowledgment: false,
      message: { vi: "Bảng và chú thích trái dấu", en: "Table and caption have conflicting signs" },
      metricIds: ["revenue"],
      sourceIds: ["synthetic-statement"],
    },
  ];
  const dossier = createDossier(input, { id: "qa-conflict", now: NOW });
  assert.throws(() => assertApprovable(dossier, approval(dossier)), {
    code: "material_issues_unresolved",
  });
  assert.throws(
    () =>
      reviseDossier(dossier, {
        expectedRevision: 1,
        requestId: "qa-resolve-0001",
        resolutions: [
          {
            issueId: "table-caption-conflict",
            reason: "Acknowledged without another supporting source.",
          },
        ],
      }),
    { code: "issue_requires_evidence" },
  );
});

function extractedRow(text, overrides = {}) {
  return extractStatementCells({ pages: [{ page: 9, lines: [{ text }] }] }, [
    { id: "profit_after_tax", page: 9, match: "Net profit", rowCode: "60", ...overrides },
  ])[0];
}

test("acceptance: raw statement extraction preserves negative signs and original text", () => {
  for (const signed of ["-123,456,789", "−123,456,789", "(123,456,789)"]) {
    const original = `Net profit 60 ${signed} 234,567,890`;
    const row = extractedRow(original);
    assert.equal(row.extractionIssue, null);
    assert.equal(row.rawCurrent, signed);
    assert.equal(row.rawComparison, "234,567,890");
    assert.equal(row.rawRow, original);
  }
});

test("acceptance: OCR whitespace around a negative sign never silently becomes positive", () => {
  for (const signed of ["- 123,456,789", "− 123,456,789", "( 123,456,789 )"]) {
    const row = extractedRow(`Net profit 60 ${signed} 234,567,890`);
    assert.ok(
      row.extractionIssue || /^[\-(−]/u.test(row.rawCurrent),
      `Silently dropped sign: ${signed}`,
    );
  }
});

test("acceptance: malformed numeric grouping cannot silently select a plausible suffix", () => {
  for (const malformed of ["1234,567,890", "12.34.567.890", "1,234.567,890"]) {
    const row = extractedRow(`Net profit 60 ${malformed} 234,567,890`);
    assert.ok(row.extractionIssue, `Accepted malformed source token: ${malformed}`);
  }
});

test("acceptance: a source column rule selects the restated comparator explicitly", () => {
  // FPT's H1 2026 note, rendered PDF page 18, contains current, originally
  // reported prior, same-method prior, and absolute change in that order.
  const text =
    "Net profit 60 5.047.128.933.102 5.335.828.880.987 4.427.462.420.799 619.666.512.303 14,0%";
  const row = extractedRow(text, { comparisonIndex: 2, valueCount: 4 });
  assert.equal(row.extractionIssue, null);
  assert.equal(row.rawCurrent, "5.047.128.933.102");
  assert.equal(row.rawComparison, "4.427.462.420.799");
  assert.equal(row.rawReportedComparison, "5.335.828.880.987");
  assert.equal(row.rawRow, text);
});

test("acceptance: missing or duplicate statement rows do not fabricate usable cells", () => {
  const missing = extractedRow("Revenue 10 123,456,789 234,567,890");
  assert.equal(missing.extractionIssue, "ambiguous_row");
  assert.equal(missing.rawCurrent, null);
  const duplicates = extractStatementCells(
    {
      pages: [
        {
          page: 9,
          lines: [
            { text: "Net profit 60 123,456,789 234,567,890" },
            { text: "Net profit 60 987,654,321 876,543,210" },
          ],
        },
      ],
    },
    [{ id: "profit_after_tax", page: 9, match: "Net profit", rowCode: "60" }],
  )[0];
  assert.equal(duplicates.extractionIssue, "ambiguous_row");
  assert.equal(duplicates.rawCurrent, null);
});

function modelOutput(dossier, text, kind = "calculated") {
  return {
    dossierId: dossier.id,
    revision: dossier.revision,
    claims: [
      {
        id: "qa-numeric-claim",
        kind,
        text,
        sourceIds: ["synthetic-statement"],
        metricIds: ["revenue"],
        evidenceQuotes: [],
      },
    ],
    questions: [],
    limitations: [],
  };
}

test("acceptance: AI numeric rendering cannot label a cell with the wrong money scale", () => {
  const input = dataset();
  input.metrics[0].current.value = 25_000;
  input.metrics[0].current.unit = "VND_million";
  const dossier = createDossier(input, { id: "qa-model-units", now: NOW });
  const result = validateSecuritiesAnalysis(
    modelOutput(dossier, "Revenue is {{metric:revenue:current}}.", "source_fact"),
    dossier,
    "en",
  );
  assert.match(result.claims[0].text, /25 VND billion|25,000 VND million/u);
  assert.doesNotMatch(result.claims[0].text, /25,000 VND billion/u);
});

test("acceptance: valid calculation binding cannot legitimize an inverted AI direction", () => {
  const dossier = createDossier(dataset(), { id: "qa-model-direction", now: NOW });
  try {
    const result = validateSecuritiesAnalysis(
      modelOutput(dossier, "Revenue decreased by {{metric:revenue:relativeChangePct}}."),
      dossier,
      "en",
    );
    assert.doesNotMatch(result.claims[0].text, /decreas|declin|fell/iu);
    assert.match(result.claims[0].text, /25%/u);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.match(error.code ?? "", /^model_/u);
  }
});

test("acceptance: a bound actual amount cannot legitimize an unsupported AI causal fact", () => {
  const dossier = createDossier(dataset(), { id: "qa-model-cause", now: NOW });
  try {
    const result = validateSecuritiesAnalysis(
      modelOutput(
        dossier,
        "Revenue reached {{metric:revenue:current}} because a guaranteed overseas contract eliminated all business risks.",
        "source_fact",
      ),
      dossier,
      "en",
    );
    assert.doesNotMatch(result.claims[0].text, /guaranteed|eliminated|overseas contract/iu);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.match(error.code ?? "", /^model_/u);
  }
});

test("acceptance: a beginner question resolves the supported company, period and comparison basis", () => {
  const latest = resolveSecuritiesScope({
    query: "FPT kỳ mới nhất trong nguồn hiện có thay đổi thế nào so với cùng kỳ?",
  });
  assert.equal(latest.companyId, "FPT");
  assert.equal(latest.periodId, "H1_2026");
  assert.equal(latest.comparisonPeriodId, "H1_2025_restated");
  assert.equal(latest.latestRequested, true);
  assert.equal(latest.freshness.latestMarketPeriodVerified, false);
  assert.equal(
    resolveSecuritiesScope({ query: "FPT năm 2025 so với năm 2024" }).periodId,
    "FY2025",
  );
  assert.equal(resolveSecuritiesScope({ query: "GMD 6 tháng 2026" }).companyId, "GMD");
  assert.throws(() => resolveSecuritiesScope({ query: "VNM năm 2025" }), {
    code: "unsupported_company",
  });
});

test("acceptance: an unsupported explicit period is not silently replaced by a supported half-year", () => {
  for (const query of ["FPT H2 2026", "FPT 9 tháng 2026", "GMD Q4 2026"]) {
    assert.throws(
      () => resolveSecuritiesScope({ query }),
      `Unsupported requested period was replaced: ${query}`,
    );
  }
});

test("acceptance: the question and an explicit period selector cannot silently disagree", () => {
  assert.throws(() =>
    resolveSecuritiesScope({ companyId: "FPT", periodId: "FY2025", query: "FPT H1 2026" }),
  );
  assert.throws(() => resolveSecuritiesScope({ companyId: "GMD", query: "FPT H1 2026" }), {
    code: "ambiguous_company",
  });
});

test("acceptance: issuer aliases require complete tokens", () => {
  assert.throws(() => resolveSecuritiesScope({ query: "FPTS năm 2025" }), {
    code: "unsupported_company",
  });
  assert.equal(resolveSecuritiesScope({ query: "FPT Corporation FY 2025" }).companyId, "FPT");
  assert.equal(resolveSecuritiesScope({ query: "Gemadept H1 2026" }).companyId, "GMD");
});

test("acceptance: compact period notation keeps its explicitly requested year", () => {
  for (const query of ["FPT FY2025", "FPT FY_2025", "FPT FY 2025"]) {
    assert.equal(resolveSecuritiesScope({ query }).periodId, "FY2025", query);
  }
  for (const query of ["FPT H1_2025", "FPT H12025", "FPT H1 2025"]) {
    assert.throws(() => resolveSecuritiesScope({ query }), { code: "unsupported_period" }, query);
  }
  assert.equal(resolveSecuritiesScope({ query: "FPT H1_2026" }).periodId, "H1_2026");
});
