import assert from "node:assert/strict";
import test from "node:test";
import {
  applyModelAnalysis,
  createDossier,
  reviseDossier,
} from "../../shared/securities/dossier.js";
import {
  buildSecuritiesReportInputs,
  projectSecuritiesReport,
} from "../../shared/securities/report.js";
import {
  SECURITIES_REPORT_CONTRACT,
  hasStructuredSecuritiesReport,
} from "../../shared/securities/report-contract.js";
import { getFrozenSecuritiesDatasets } from "../../shared/securities/catalog.js";
import { getVerifiedSecuritiesFacts } from "../../shared/securities/verified-source-facts.js";
import { createAnalysisNotes, createSecuritiesXlsx } from "../../worker/securities/export.js";
import { applyConsistencyCheck } from "../../worker/securities/model-report.js";

function fixture() {
  const point = (value, periodId) => ({
    value,
    unit: "VND_billion",
    periodId,
    entityId: "FIX",
    scope: "consolidated",
    basisId: "same-basis",
    sourceId: "fixture-source",
    sourceVersion: "1",
    verification: "verified",
    locator: { precision: "cell", page: 3, rowCode: "10", column: periodId },
  });
  return createDossier(
    {
      company: { id: "FIX", ticker: "FIX", name: "Synthetic report fixture" },
      period: { id: "FY2025", kind: "annual", scope: "consolidated" },
      comparisonPeriod: { id: "FY2024", kind: "annual", scope: "consolidated" },
      sources: [
        {
          id: "fixture-source",
          companyId: "FIX",
          version: "1",
          hash: "a".repeat(64),
          url: "https://example.com/synthetic.pdf",
        },
      ],
      metrics: [
        {
          id: "revenue",
          label: "Revenue",
          unit: "VND_billion",
          current: point(120, "FY2025"),
          comparison: point(100, "FY2024"),
        },
        {
          id: "profit_after_tax",
          label: "Profit",
          unit: "VND_billion",
          current: point(18, "FY2025"),
          comparison: point(10, "FY2024"),
        },
      ],
      issues: [],
    },
    { id: "report-fixture", locale: "en", query: "Explain the business results." },
  );
}

function analyzed(dossier = fixture()) {
  return applyModelAnalysis(dossier, {
    reportVersion: SECURITIES_REPORT_CONTRACT,
    dossierId: dossier.id,
    revision: dossier.revision,
    summary: "Untrusted cached summary must be rebuilt from accepted claims.",
    claims: [
      {
        id: "sales",
        kind: "calculated",
        metricIds: ["revenue"],
        sourceIds: ["fixture-source"],
        text: "Supported sales finding.",
      },
      {
        id: "earnings",
        kind: "calculated",
        metricIds: ["profit_after_tax"],
        sourceIds: ["fixture-source"],
        text: "Supported earnings finding.",
      },
    ],
    report: {
      headline: "Synthetic company analysis",
      summaryClaimIds: ["sales", "earnings"],
      sections: [{ id: "performance", claimIds: ["sales", "earnings"] }],
    },
    research: { status: "complete", steps: [], gaps: [] },
    validation: { deterministic: { status: "passed" }, semantic: { status: "passed" } },
    questions: [],
    limitations: [],
    receipt: {
      evidenceType: "synthetic_test_fixture",
      actualModel: "meta/muse-spark-1.3-contributor",
    },
  });
}

function worksheets(bytes) {
  const buffer = Buffer.from(bytes);
  const result = new Map();
  let cursor = 0;
  while (buffer.readUInt32LE(cursor) === 0x04034b50) {
    const size = buffer.readUInt32LE(cursor + 18);
    const nameLength = buffer.readUInt16LE(cursor + 26);
    const extraLength = buffer.readUInt16LE(cursor + 28);
    const start = cursor + 30 + nameLength + extraLength;
    result.set(
      buffer.subarray(cursor + 30, cursor + 30 + nameLength).toString(),
      buffer.subarray(start, start + size).toString(),
    );
    cursor = start + size;
  }
  return result;
}

function consistencyRecord(verdicts, notesVerdict = "supported") {
  const claims = Object.entries(verdicts).map(([id, verdict]) => ({
    id,
    verdict,
    reason: "Synthetic consistency verdict for the report coverage regression.",
  }));
  return {
    status:
      notesVerdict === "supported" && claims.every((claim) => claim.verdict === "supported")
        ? "passed"
        : "limited",
    method: "same_model_consistency_check",
    narrativeHash: "b".repeat(64),
    checkedClaimIds: claims.map((claim) => claim.id),
    claims,
    notes: { verdict: notesVerdict, reason: "Synthetic review of report notes." },
  };
}

test("semantic pruning keeps original coverage and validated notes in readiness and both exports", () => {
  const dossier = analyzed();
  dossier.analysis.limitations = ["The original source is an interim reviewed statement."];
  dossier.analysis.questions = ["A source-backed follow-up question."];
  const consistency = consistencyRecord({ sales: "supported", earnings: "unsupported" });
  const filtered = applyConsistencyCheck({ ...dossier.analysis, gaps: [] }, consistency, "en");
  dossier.analysis = {
    ...filtered,
    research: { ...dossier.analysis.research, gaps: filtered.gaps },
  };
  assert.deepEqual(
    dossier.analysis.claims.map((claim) => claim.id),
    ["sales"],
  );
  const before = JSON.stringify(dossier);
  const { reportReadiness: readiness, reportProjection: projection } =
    projectSecuritiesReport(dossier);
  assert.equal(readiness.state, "limited");
  assert.equal(readiness.includedClaimCount, 1);
  assert.equal(readiness.totalClaimCount, 2);
  assert.deepEqual(readiness.omittedClaimIds, ["earnings"]);
  assert.deepEqual(projection.analysis.validation.semantic, consistency);
  assert.deepEqual(projection.analysis.limitations, dossier.analysis.limitations);
  assert.deepEqual(projection.analysis.questions, dossier.analysis.questions);
  const markdown = createAnalysisNotes(dossier);
  const workbook = worksheets(createSecuritiesXlsx(dossier));
  const reportSheet = workbook.get("xl/worksheets/sheet1.xml");
  for (const output of [markdown, reportSheet]) {
    assert.match(output, /1\/2 claims included/u);
    assert.match(output, /1 claims excluded/u);
    assert.doesNotMatch(output, /Supported earnings finding/u);
  }
  assert.match(markdown, /interim reviewed statement/u);
  assert.match(workbook.get("xl/worksheets/sheet7.xml"), /interim reviewed statement/u);
  assert.equal(JSON.stringify(dossier), before);
});

test("semantic and report-policy exclusions merge without counting a claim or verdict twice", () => {
  const dossier = analyzed();
  dossier.metrics[1].current.verification = "needs_review";
  dossier.analysis.limitations = ["A note depending on the now-unsafe inputs."];
  dossier.analysis.validation.semantic = consistencyRecord({
    sales: "supported",
    earnings: "unsupported",
    removed: "unclear",
  });
  dossier.analysis.validation.semantic.claims.push(
    { id: "removed", verdict: "unclear", reason: "Repeated stored verdict." },
    { id: "unbound", verdict: "unsupported", reason: "Not bound to checked claim IDs." },
  );
  const { reportReadiness: readiness, reportProjection: projection } =
    projectSecuritiesReport(dossier);
  assert.equal(readiness.includedClaimCount, 1);
  assert.equal(readiness.totalClaimCount, 3);
  assert.deepEqual(readiness.omittedClaimIds, ["earnings", "removed"]);
  assert.deepEqual(readiness.omittedMetricIds, ["profit_after_tax"]);
  assert.deepEqual(projection.analysis.limitations, []);
  assert.equal(
    readiness.includedClaimCount + readiness.omittedClaimIds.length,
    readiness.totalClaimCount,
  );
});

test("a rejected semantic finding stays excluded even if a stored claim array was not pruned", () => {
  const dossier = analyzed();
  dossier.analysis.validation.semantic = consistencyRecord({
    sales: "supported",
    earnings: "unclear",
  });
  const { reportReadiness: readiness, reportProjection: projection } =
    projectSecuritiesReport(dossier);
  assert.equal(readiness.includedClaimCount, 1);
  assert.equal(readiness.totalClaimCount, 2);
  assert.deepEqual(readiness.omittedClaimIds, ["earnings"]);
  assert.deepEqual(
    projection.analysis.claims.map((claim) => claim.id),
    ["sales"],
  );
});

test("supported claims and notes-only limitations do not invent claim omissions", () => {
  for (const notesVerdict of ["supported", "unclear"]) {
    const dossier = analyzed();
    const consistency = consistencyRecord(
      { sales: "supported", earnings: "supported" },
      notesVerdict,
    );
    const filtered = applyConsistencyCheck({ ...dossier.analysis, gaps: [] }, consistency, "en");
    dossier.analysis = {
      ...filtered,
      research: { ...dossier.analysis.research, gaps: filtered.gaps },
    };
    const { reportReadiness: readiness } = projectSecuritiesReport(dossier);
    assert.equal(readiness.state, notesVerdict === "supported" ? "ready" : "limited");
    assert.equal(readiness.includedClaimCount, 2);
    assert.equal(readiness.totalClaimCount, 2);
    assert.deepEqual(readiness.omittedClaimIds, []);
    assert.match(createAnalysisNotes(dossier), /0 claims excluded/u);
  }
});

test("semantic report identity preserves existing dossiers without upgrading unvalidated analyses", () => {
  const current = analyzed();
  const historical = structuredClone(current);
  historical.analysis.reportVersion = "securities-report-v2";
  const originalBytes = JSON.stringify(historical);

  for (const dossier of [current, historical]) {
    assert.equal(hasStructuredSecuritiesReport(dossier.analysis), true);
    const projected = projectSecuritiesReport(dossier);
    assert.equal(projected.reportReadiness.state, "ready");
    assert.equal(projected.reportProjection.analysis.reportMode, "automatic");
    assert.equal(
      projected.reportProjection.analysis.summary,
      "Supported sales finding. Supported earnings finding.",
    );
    assert.ok(createSecuritiesXlsx(dossier).byteLength > 1000);
  }
  assert.equal(JSON.stringify(historical), originalBytes);

  historical.analysis.validation.deterministic.status = "failed";
  assert.equal(
    projectSecuritiesReport(historical).reportProjection.analysis.reportMode,
    "data_only",
  );
  assert.equal(hasStructuredSecuritiesReport({ reportVersion: "unknown-report-format" }), false);
  assert.equal(hasStructuredSecuritiesReport(null), false);
});

test("automatic readiness is recomputed from the exact unapproved snapshot and notes do not invalidate valid analysis", () => {
  const dossier = analyzed();
  dossier.reportReadiness = { state: "unavailable", canExport: false };
  const before = JSON.stringify(dossier);
  const result = projectSecuritiesReport(dossier);
  assert.equal(result.reportReadiness.state, "ready");
  assert.equal(result.reportReadiness.canExport, true);
  assert.equal(result.reportReadiness.revision, 2);
  assert.equal(dossier.status, "draft");
  assert.equal(result.reportReadiness.includedMetricCount, 2);
  assert.equal(result.reportReadiness.totalMetricCount, 2);
  assert.equal(
    result.reportProjection.analysis.summary,
    "Supported sales finding. Supported earnings finding.",
  );
  assert.equal(JSON.stringify(dossier), before);
  assert.ok(createSecuritiesXlsx(dossier).byteLength > 1000);
  const revised = reviseDossier(dossier, {
    expectedRevision: 2,
    requestId: "report-annotation",
    notes: "Optional analyst annotation",
  });
  assert.equal(projectSecuritiesReport(revised).reportReadiness.state, "ready");
  assert.equal(revised.approval, null);
  assert.equal(revised.analysis.inputRevision, 1);
});

test("unrun AI yields an explicit data-only report and source verification does not require a human approval", () => {
  const dossier = fixture();
  dossier.sourceIssues.push({
    id: "source-check",
    code: "source_verification_required",
    severity: "material",
    metricIds: ["revenue", "profit_after_tax"],
    sourceIds: ["fixture-source"],
    message: "Source cells need validation",
  });
  const result = projectSecuritiesReport(dossier);
  assert.equal(result.reportReadiness.state, "limited");
  assert.equal(result.reportReadiness.canExport, true);
  assert.deepEqual(
    result.reportReadiness.reasons.map((reason) => reason.code),
    ["ai_answer_unavailable"],
  );
  assert.equal(result.reportProjection.analysis.reportMode, "data_only");
  assert.match(createAnalysisNotes(dossier), /AI answer to this request is unavailable/u);
  assert.equal(result.reportReadiness.omittedMetricIds.length, 0);
});

test("a partial report omits unsafe values and dependent prose and formulas while preserving labelled originals", () => {
  const dossier = analyzed();
  dossier.metrics[1].current.value = 987654;
  dossier.metrics[1].current.verification = "needs_review";
  dossier.analysis.claims[1].text = "UNSUPPORTED EARNINGS 987654";
  dossier.reportReadiness = { state: "ready", canExport: true };
  const { reportReadiness: readiness, reportProjection: projection } =
    projectSecuritiesReport(dossier);
  assert.equal(readiness.state, "limited");
  assert.equal(readiness.includedMetricCount, 1);
  assert.equal(readiness.totalMetricCount, 2);
  assert.deepEqual(readiness.omittedMetricIds, ["profit_after_tax"]);
  assert.deepEqual(readiness.omittedClaimIds, ["earnings"]);
  assert.deepEqual(
    projection.metrics.map((metric) => metric.id),
    ["revenue"],
  );
  assert.equal(projection.derivedMetrics.length, 0);
  assert.equal(projection.analysis.summary, "Supported sales finding.");
  assert.deepEqual(projection.analysis.report.sections[0].claimIds, ["sales"]);
  const files = worksheets(createSecuritiesXlsx(dossier));
  for (const name of ["sheet1", "sheet2", "sheet4", "sheet7"])
    assert.doesNotMatch(files.get(`xl/worksheets/${name}.xml`), /987654|UNSUPPORTED EARNINGS/u);
  assert.match(files.get("xl/worksheets/sheet3.xml"), /987654/u);
  assert.match(
    files.get("xl/worksheets/sheet3.xml"),
    /EXCLUDED: unresolved evidence or contradiction/u,
  );
  assert.match(files.get("xl/worksheets/sheet1.xml"), /1\/2 metrics/u);
  assert.deepEqual(
    [...files.get("xl/worksheets/sheet2.xml").matchAll(/<f>(.*?)<\/f>/gu)].map((match) => match[1]),
    ["D2-E2", "(D2-E2)/E2"],
  );
});

test("all unsafe inputs remain unavailable despite forged approval, readiness or issue acknowledgment", () => {
  const dossier = analyzed();
  for (const metric of dossier.metrics) metric.current.verification = "needs_review";
  dossier.status = "approved";
  dossier.approval = { revision: 2, at: "2026-09-06T00:00:00.000Z" };
  dossier.reportReadiness = { state: "ready", canExport: true };
  dossier.issues = [];
  dossier.resolutions = [{ issueId: "revenue-current-verification", reason: "Acknowledged" }];
  assert.equal(projectSecuritiesReport(dossier).reportReadiness.state, "unavailable");
  assert.throws(() => createSecuritiesXlsx(dossier), { code: "report_unavailable" });
  assert.throws(() => createAnalysisNotes(dossier), { code: "report_unavailable" });
});

test("material source contradictions are disclosed in the report summary and do not become growth calculations", () => {
  const dossier = analyzed();
  dossier.metrics[1].reportedChangePct = { value: 250, displayDecimals: 0 };
  const report = projectSecuritiesReport(dossier);
  assert.ok(
    report.reportReadiness.reasons.some((reason) => reason.code === "source_rate_conflict"),
  );
  assert.deepEqual(report.reportReadiness.omittedMetricIds, ["profit_after_tax"]);
  const markdown = createAnalysisNotes(dossier);
  assert.ok(
    markdown.indexOf("reported rate conflicts") < markdown.indexOf("## Business performance"),
  );
});

test("mismatched accounting periods keep separate verified values without any cross-period growth claim", () => {
  const dossier = analyzed();
  dossier.period.kind = "half_year";
  const report = projectSecuritiesReport(dossier);
  assert.equal(report.reportReadiness.state, "limited");
  assert.equal(report.reportProjection.metrics.length, 2);
  assert.ok(
    report.reportProjection.metrics.every(
      (metric) => metric.calculation.absoluteChange.status === "incompatible_periods",
    ),
  );
  assert.equal(report.reportProjection.analysis.claims.length, 0);
  const financials = worksheets(createSecuritiesXlsx(dossier)).get("xl/worksheets/sheet2.xml");
  assert.doesNotMatch(financials, /<f>D2-E2<\/f>|<f>\(D2-E2\)\/E2<\/f>/u);
  assert.match(financials, /<c r="D2"[^>]*><v>120<\/v>/u);
});

test("stale source versions and failed model validation cannot appear as accepted report claims", () => {
  const stale = analyzed();
  stale.analysis.claims[0].evidenceQuotes = [
    {
      sourceId: "fixture-source",
      sourceVersion: "old",
      quote: "Stale statement",
      locator: { page: 3 },
    },
  ];
  assert.deepEqual(projectSecuritiesReport(stale).reportReadiness.omittedClaimIds, ["sales"]);
  const failed = analyzed();
  failed.analysis.validation.deterministic.status = "failed";
  const report = projectSecuritiesReport(failed);
  assert.equal(report.reportReadiness.state, "limited");
  assert.equal(report.reportProjection.analysis.reportMode, "data_only");
  assert.equal(report.reportProjection.analysis.claims.length, 0);
  assert.ok(
    report.reportReadiness.reasons.some((reason) => reason.code === "ai_validation_failed"),
  );
});

test("legacy AI output remains historical and semantic or research gaps keep a useful automatic report limited", () => {
  const legacy = analyzed();
  delete legacy.analysis.reportVersion;
  const historical = projectSecuritiesReport(legacy);
  assert.equal(historical.reportReadiness.state, "limited");
  assert.equal(historical.reportProjection.analysis.reportMode, "historical");
  const limited = analyzed();
  limited.analysis.validation.semantic.status = "limited";
  limited.analysis.research = {
    status: "limited",
    steps: [],
    gaps: [
      {
        topic: "Cash flow",
        reason: "No comparable statement",
        impact: "No cash conversion conclusion",
      },
    ],
  };
  const result = projectSecuritiesReport(limited);
  assert.equal(result.reportReadiness.state, "limited");
  assert.equal(result.reportProjection.analysis.claims.length, 2);
  assert.ok(result.reportReadiness.reasons.some((reason) => reason.code === "research_gap"));
});

test("a supported business risk is disclosed without mislabelling the report as missing evidence", () => {
  const dossier = analyzed();
  dossier.sourceIssues.push({
    id: "business-risk",
    code: "nonrecurring_item",
    severity: "warning",
    metricIds: ["profit_after_tax"],
    sourceIds: ["fixture-source"],
    message: "Synthetic supported non-recurring gain affects earnings quality.",
  });
  const report = projectSecuritiesReport(dossier);
  assert.equal(report.reportReadiness.state, "ready");
  const risk = report.reportReadiness.reasons.find((reason) => reason.code === "nonrecurring_item");
  assert.equal(risk.category, "business_risk");
  assert.equal(risk.affectsReadiness, false);
  const markdown = createAnalysisNotes(dossier);
  assert.match(markdown, /## Business risks/u);
  assert.match(markdown, /Synthetic supported non-recurring gain/u);
  assert.doesNotMatch(markdown, /## Limitations alongside/u);
});

test("supplemental original-source facts keep exact units and select the matching comparison without promoting an unmatched prior", () => {
  const dataset = getFrozenSecuritiesDatasets().find(
    (entry) =>
      entry.company.id === "FPT" &&
      entry.period.id === "H1_2026" &&
      entry.comparisonPeriod.id === "H1_2025_restated",
  );
  const first = createDossier(dataset, { id: "supplemental-report-fixture", locale: "en" });
  const facts = getVerifiedSecuritiesFacts({
    sourceId: first.sources[0].id,
    sourceVersion: first.sources[0].version,
  });
  const before = JSON.stringify(first);
  const inputs = buildSecuritiesReportInputs(first, facts);
  assert.equal(JSON.stringify(first), before);
  const cash = inputs.metrics.find((metric) => metric.id === "operating_cash_flow");
  assert.equal(cash.current.value, -1145666005788);
  assert.equal(cash.current.unit, "VND");
  assert.equal(cash.unit, "VND_million");
  assert.equal(
    cash.comparison.value,
    null,
    "The prior reported CFO cannot fill a restated comparison column.",
  );
  assert.equal(
    inputs.supplementalVerifiedFacts.some((fact) => fact.factId === "fpt-h1-cfo-prior-reported"),
    false,
  );
  const cashFact = inputs.supplementalVerifiedFacts.find(
    (fact) => fact.factId === "fpt-h1-cfo-current",
  );
  const analysis = {
    reportVersion: SECURITIES_REPORT_CONTRACT,
    dossierId: first.id,
    revision: 1,
    claims: [
      {
        id: "cash",
        kind: "source_fact",
        text: "Synthetic source-bound fixture: operating cash flow was negative.",
        metricIds: ["operating_cash_flow"],
        sourceIds: [cashFact.sourceId],
        numericOrigins: [
          {
            id: cashFact.sourceId,
            version: cashFact.sourceVersion,
            metricId: cashFact.id,
            side: cashFact.side,
            origin: "verified_supplemental_fact",
            sourceHash: cashFact.sourceHash,
            factId: cashFact.factId,
            sourceValue: Number(cashFact.value),
            sourceUnit: cashFact.unit,
            displayUnit: cash.unit,
            correctionId: null,
            locator: cashFact.locator,
            verificationReceipt: cashFact.verificationReceipt,
          },
        ],
      },
    ],
    report: {
      headline: "Synthetic source-bound report",
      summaryClaimIds: ["cash"],
      sections: [{ id: "cash_and_funding", claimIds: ["cash"] }],
    },
    research: {
      status: "limited",
      steps: [],
      gaps: [
        {
          topic: "Cash flow comparison",
          reason: "No same-basis prior cash flow",
          impact: "No ordinary cash-flow growth rate",
        },
      ],
      verifiedFacts: facts,
    },
    validation: { deterministic: { status: "passed" }, semantic: { status: "passed" } },
    questions: [],
    limitations: [],
  };
  const dossier = applyModelAnalysis(first, analysis);
  const report = projectSecuritiesReport(dossier);
  assert.equal(report.reportReadiness.state, "limited");
  assert.equal(report.reportReadiness.includedClaimCount, 1);
  assert.equal(report.reportReadiness.totalMetricCount, first.metrics.length + 2);
  const ratio = report.reportProjection.derivedMetrics.find(
    (metric) => metric.id === "operating_cash_flow_to_profit",
  );
  assert.equal(ratio.current.exact, "-22.699361");
  assert.equal(ratio.comparison.status, "missing_input");
  const files = worksheets(createSecuritiesXlsx(dossier));
  const row =
    report.reportProjection.metrics.findIndex((metric) => metric.id === "operating_cash_flow") + 2;
  assert.match(
    files.get("xl/worksheets/sheet2.xml"),
    new RegExp(`<c r="D${row}"[^>]*><v>-1145666\\.005788<\\/v>`, "u"),
  );
  assert.doesNotMatch(
    files.get("xl/worksheets/sheet2.xml"),
    new RegExp(`<f>D${row}-E${row}<\\/f>`, "u"),
  );
  const forged = structuredClone(dossier);
  forged.analysis.research.verifiedFacts[0].value = "1";
  const rejected = projectSecuritiesReport(forged);
  assert.ok(
    rejected.reportReadiness.reasons.some(
      (reason) => reason.code === "supplemental_evidence_rejected",
    ),
  );
  assert.ok(rejected.reportReadiness.omittedClaimIds.includes("cash"));
  const wrongBasis = structuredClone(first);
  for (const metric of wrongBasis.metrics) metric.current.basisId = "unmatched-synthetic-basis";
  assert.equal(
    buildSecuritiesReportInputs(wrongBasis, facts).supplementalVerifiedFacts.some(
      (fact) => fact.side === "current",
    ),
    false,
  );
});

test("typed derived Excel formulas normalize mixed display units and preserve percentage-point and currency differences", () => {
  const dossier = fixture();
  const profit = dossier.metrics.find((metric) => metric.id === "profit_after_tax");
  profit.unit = "VND_million";
  for (const side of ["current", "comparison"]) {
    profit[side].value *= 1000;
    profit[side].unit = "VND_million";
  }
  dossier.metrics.push({
    ...structuredClone(profit),
    id: "profit_parent",
    label: "Parent profit",
    unit: "VND_billion",
    current: { ...profit.current, value: 18.5, unit: "VND_billion" },
    comparison: { ...profit.comparison, value: 11, unit: "VND_billion" },
  });
  const report = projectSecuritiesReport(dossier);
  const financials = worksheets(createSecuritiesXlsx(dossier)).get("xl/worksheets/sheet2.xml");
  const formulas = [...financials.matchAll(/<f>(.*?)<\/f>/gu)].map((match) => match[1]);
  assert.ok(formulas.includes("D3/(D2*1000)"));
  assert.ok(formulas.includes("(D3/(D2*1000)-E3/(E2*1000))*100"));
  assert.ok(formulas.includes("D3-(D4*1000)"));
  const inferred = report.reportProjection.derivedMetrics.find(
    (metric) => metric.id === "inferred_noncontrolling_profit",
  );
  assert.equal(inferred.current.exact, "-500");
  assert.equal(inferred.current.unit, "VND_million");
  const net = report.reportProjection.derivedMetrics.find(
    (metric) => metric.id === "profit_after_tax_margin",
  );
  assert.equal(net.percentagePointChange.exact, "5");
});

test("supplemental metric definitions localize meaningful context without changing canonical facts or numeric origins", () => {
  const covered = new Set();
  for (const dataset of getFrozenSecuritiesDatasets().filter(
    (entry) => entry.period.id === "H1_2026" && ["FPT", "GMD"].includes(entry.company.id),
  )) {
    const dossier = createDossier(dataset, {
      id: `localized-supplemental-${dataset.company.id}-${dataset.comparisonPeriod.id}`,
      locale: "vi",
    });
    const facts = getVerifiedSecuritiesFacts({
      sourceId: dossier.sources[0].id,
      sourceVersion: dossier.sources[0].version,
    });
    const originalFacts = structuredClone(facts);
    const originalDossier = structuredClone(dossier);
    const inputs = buildSecuritiesReportInputs(dossier, facts);
    for (const metric of inputs.metrics.filter(
      (entry) => entry.reportInputOrigin === "verified_supplemental_fact",
    )) {
      covered.add(metric.id);
      assert.equal(typeof metric.definition.vi, "string");
      assert.equal(typeof metric.definition.en, "string");
      assert.notEqual(metric.definition.vi, metric.definition.en);
      if (metric.id === "operating_cash_flow") {
        assert.match(metric.definition.vi, /Tiền thuần.*hoạt động kinh doanh/u);
        assert.match(metric.definition.vi, /phạm vi hợp nhất FTEL khác/u);
        assert.match(metric.definition.en, /different FTEL consolidation scope/u);
      } else if (metric.id === "profit_noncontrolling") {
        assert.match(metric.definition.vi, /lợi nhuận sau thuế phân bổ.*cổ đông công ty mẹ/u);
        assert.match(metric.definition.en, /consolidated profit after tax allocated/u);
        assert.match(
          metric.definition.vi,
          dossier.comparisonPeriod.id === "H1_2025_restated"
            ? /Số so sánh cùng phương pháp do FPT trình bày/u
            : /phạm vi hợp nhất đã công bố ban đầu/u,
        );
      } else if (metric.id === "disposal_gain") {
        assert.match(metric.definition.vi, /lãi kế toán.*chuyển nhượng/u);
        assert.match(metric.definition.vi, /tiền thực thu/u);
        assert.match(metric.definition.vi, /dấu gạch ngang.*chưa xác nhận là số 0/u);
        assert.match(metric.definition.en, /cash proceeds/u);
        assert.equal(metric.comparison.value, null);
      }
      for (const side of ["current", "comparison"]) {
        const fact = inputs.supplementalVerifiedFacts.find(
          (entry) => entry.id === metric.id && entry.side === side,
        );
        if (!fact) continue;
        assert.deepEqual(
          fact,
          originalFacts.find((entry) => entry.factId === fact.factId),
        );
        assert.deepEqual(metric[side], {
          ...fact,
          value: fact.value === null ? null : Number(fact.value),
        });
        assert.equal(
          metric.definition.vi.includes(fact.basisNote),
          false,
          "The original English audit note must not substitute for Vietnamese presentation.",
        );
      }
    }
    assert.deepEqual(facts, originalFacts);
    assert.deepEqual(dossier, originalDossier);
    assert.deepEqual(
      getVerifiedSecuritiesFacts({
        sourceId: dossier.sources[0].id,
        sourceVersion: dossier.sources[0].version,
      }),
      originalFacts,
    );
  }
  assert.deepEqual([...covered].sort(), [
    "disposal_gain",
    "operating_cash_flow",
    "profit_noncontrolling",
  ]);
});
