import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import {
  calculateDerivedMetrics,
  calculateDossierMetrics,
} from "../../shared/securities/finance.js";
import { researchLibraryEntries } from "../../src/securities/research-library.js";

const loader = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("../../", import.meta.url)),
  plugins: [react()],
  logLevel: "error",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true },
  appType: "custom",
});
after(async () => {
  await loader.close();
});
const { AnalysisPanel, ClaimEvidence } = await loader.ssrLoadModule(
  "/src/securities/AnalysisPanel.jsx",
);
const { FinancialTable } = await loader.ssrLoadModule("/src/securities/FinancialTable.jsx");
const { EvidenceDrawer } = await loader.ssrLoadModule("/src/securities/EvidenceDrawer.jsx");
const { StartWorkspace } = await loader.ssrLoadModule("/src/securities/StartWorkspace.jsx");
const { DossierWorkspace } = await loader.ssrLoadModule("/src/securities/DossierWorkspace.jsx");
const { ChatPanel } = await loader.ssrLoadModule("/src/securities/ChatPanel.jsx");
const { ResearchLibrary } = await loader.ssrLoadModule("/src/securities/ResearchLibrary.jsx");
const { JobProgress } = await loader.ssrLoadModule("/src/securities/ui.jsx");
const { buildModelProcess, ModelProcess } = await loader.ssrLoadModule(
  "/src/securities/ModelProcess.jsx",
);
const { securitiesCopy } = await loader.ssrLoadModule("/src/securities/copy.js");
const { investorCopy } = await loader.ssrLoadModule("/src/securities/investor/investorIntents.js");
const hash = "a".repeat(64);
const version = `sha256:${hash}`;
const source = {
  id: "source_fpt",
  version,
  hash,
  title: "Preserved issuer report",
  url: "https://example.com/report.pdf",
  localOriginalUrl: `/api/securities/sources/documents/source_fpt/${hash}/original`,
  localPageUrl: `/api/securities/sources/documents/source_fpt/${hash}/pages/`,
};
const point = (value, periodId, unit = "VND_million") => ({
  value,
  periodId,
  unit,
  sourceId: source.id,
  sourceVersion: version,
  entityId: "FPT",
  scope: "consolidated",
  basisId: "same",
  dataKind: "actual",
  verification: "verified",
  locator: { page: 18, precision: "cell" },
});
const metric = (id, label, current, comparison) => ({
  id,
  label,
  unit: "VND_million",
  current: point(current, "H1_2026"),
  comparison: point(comparison, "H1_2025"),
});

function fixture() {
  const dossier = {
    id: "ds_frontend_report",
    revision: 2,
    status: "draft",
    query: "What is driving performance?",
    company: { id: "FPT", ticker: "FPT", name: "FPT Corporation" },
    period: { id: "H1_2026", label: "H1 2026", scope: "consolidated" },
    comparisonPeriod: { id: "H1_2025", label: "H1 2025", scope: "consolidated" },
    sources: [source],
    notes: "",
    issues: [],
    chat: [],
  };
  dossier.metrics = calculateDossierMetrics(
    [
      metric("revenue", "Revenue", 26268500.667974, 20000000),
      metric("profit_before_tax", "Profit before tax", 5000000, 4000000),
      metric("profit_after_tax", "Profit after tax", 4000000, 3000000),
      metric("profit_parent", "Parent profit", 4200000, 2800000),
    ],
    dossier,
  );
  const claims = [
    {
      id: "c1",
      kind: "source_fact",
      text: "A supported summary finding appears once.",
      sourceIds: [source.id],
      evidenceQuotes: [
        {
          sourceId: source.id,
          sourceVersion: version,
          quote: "An exact source excerpt.",
          locator: { page: 18 },
        },
      ],
      numericOrigins: [],
    },
    {
      id: "c2",
      kind: "analyst_opinion",
      text: "A supported interpretation appears once.",
      sourceIds: [source.id],
      evidenceQuotes: [],
      numericOrigins: [],
    },
  ];
  dossier.analysis = {
    origin: "model",
    reportVersion: "securities-report-v2",
    claims,
    summary: claims.map((claim) => claim.text).join(" "),
    questions: ["Which evidence should be read next?"],
    limitations: ["A stated research limitation."],
    report: {
      headline: "An evidence-based company view",
      summaryClaimIds: ["c1"],
      sections: [{ id: "performance", claimIds: ["c1", "c2"] }],
    },
    research: {
      status: "complete",
      steps: [
        {
          id: "read-1",
          sourceId: source.id,
          sourceVersion: version,
          pages: [18],
          query: "profit attribution",
          status: "read",
          passageIds: ["passage-1"],
        },
      ],
    },
    validation: {
      deterministic: { status: "passed" },
      semantic: { status: "passed", method: "same_model_consistency_check" },
    },
  };
  dossier.reportProjection = {
    metrics: structuredClone(dossier.metrics),
    derivedMetrics: calculateDerivedMetrics(dossier.metrics, dossier),
    analysis: structuredClone(dossier.analysis),
  };
  dossier.reportReadiness = {
    revision: 2,
    state: "ready",
    canExport: true,
    reasons: [],
    includedMetricCount: 4,
    totalMetricCount: 4,
    includedClaimCount: 2,
    totalClaimCount: 2,
    omittedMetricIds: [],
    omittedClaimIds: [],
  };
  return {
    dossier,
    locale: "en",
    chat: [],
    busy: null,
    job: null,
    error: null,
    activeTab: "analysis",
    catalog: {
      companies: [
        {
          ...dossier.company,
          periods: [
            {
              ...dossier.period,
              comparisonPeriodId: dossier.comparisonPeriod.id,
              comparisonOptions: [dossier.comparisonPeriod],
            },
          ],
        },
      ],
      defaultCompanyId: "FPT",
      defaultPeriodId: "H1_2026",
      runtime: { model: { enabled: true } },
    },
  };
}

const controller = {
  getEvidence() {
    throw new Error("Rendering must not perform actions");
  },
};
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
const propsFor = (state) => ({
  state,
  controller,
  copy: securitiesCopy[state.locale],
  onChat() {},
});

test("report summaries and section findings are rendered once, with sources and notes behind details", () => {
  const state = fixture();
  state.dossier.notes = "A preserved user note.";
  state.dossier.analysisLineage = {
    generatedInRevision: 2,
    carriedFromRevision: 2,
    reason: "analyst_notes_only",
  };
  const before = JSON.stringify(state.dossier);
  const html = render(AnalysisPanel, propsFor(state));
  assert.equal(html.split(state.dossier.analysis.claims[0].text).length - 1, 1);
  assert.equal(html.split(state.dossier.analysis.claims[1].text).length - 1, 1);
  assert.match(html, /<details class="ns-report-evidence"><summary>/);
  assert.match(html, /<details class="ns-report-section"><summary>/);
  assert.match(html, /<details class="ns-report-notes"><summary>/);
  assert.match(html, /<details class="ns-report-question"><summary>/);
  assert.ok(
    html.indexOf(state.dossier.analysis.claims[0].text) < html.indexOf(state.dossier.query),
  );
  assert.ok(
    html.indexOf("A preserved user note.") > html.indexOf(state.dossier.analysis.claims[1].text),
  );
  assert.ok(html.includes(`href="${source.localOriginalUrl}#page=18&amp;view=FitH"`));
  assert.ok(html.includes("Requested pages: 18") && html.includes("profit attribution"));
  assert.ok(html.includes("26,268.5") && html.includes("VND billion"));
  assert.equal(JSON.stringify(state.dossier), before);
});

test("the report uses only the safe projection and explains omitted data and findings", () => {
  const state = fixture();
  state.dossier.metrics.push(metric("unsafe_metric", "Excluded private metric label", 99999999, 1));
  state.dossier.analysis.claims.push({
    id: "excluded",
    kind: "source_fact",
    text: "An unsupported claim must never appear in the report.",
  });
  state.dossier.reportReadiness = {
    ...state.dossier.reportReadiness,
    state: "limited",
    includedMetricCount: 4,
    totalMetricCount: 5,
    includedClaimCount: 2,
    totalClaimCount: 3,
    reasons: [
      {
        code: "metrics_omitted",
        category: "limitation",
        affectsReadiness: true,
        message: "One metric lacks supporting evidence.",
      },
    ],
  };
  const html = render(AnalysisPanel, propsFor(state));
  assert.ok(
    !html.includes("Excluded private metric label") &&
      !html.includes("An unsupported claim must never appear"),
  );
  assert.ok(!html.includes("Using 4/5 metrics and 2/3 findings."));
  assert.ok(!html.includes('class="ns-report-readiness"'));
  state.dossier.reportProjection.analysis = null;
  const noAnswer = render(AnalysisPanel, propsFor(state));
  assert.ok(noAnswer.includes(securitiesCopy.en.noAnalysisTitle));
  assert.ok(!noAnswer.includes(state.dossier.analysis.claims[0].text));
});

test("limited report coverage stays available in data without a limited status banner", () => {
  const state = fixture();
  state.locale = "vi";
  state.dossier.reportReadiness = {
    ...state.dossier.reportReadiness,
    state: "limited",
    reasons: [
      {
        code: "research_gap",
        category: "limitation",
        affectsReadiness: true,
        message: "The source coverage does not answer the whole question.",
      },
    ],
  };
  const html = render(DossierWorkspace, propsFor(state));
  assert.ok(!html.includes('class="ns-report-readiness"'));
  assert.ok(!html.includes('data-readiness="limited"'));
});

test("historical analysis stays explicitly historical and business risks do not become evidence limitations", () => {
  const state = fixture();
  delete state.dossier.reportProjection.analysis.reportVersion;
  state.dossier.reportReadiness.state = "limited";
  const historical = render(AnalysisPanel, propsFor(state));
  assert.ok(historical.includes("Analysis saved in an earlier format"));
  assert.match(historical, /<details class="ns-report-historical"><summary>/);
  const ready = fixture();
  ready.dossier.reportReadiness.reasons = [
    {
      code: "nonrecurring_item",
      category: "business_risk",
      affectsReadiness: false,
      message: "A disposal gain may not recur.",
    },
  ];
  const html = render(AnalysisPanel, propsFor(ready));
  assert.ok(
    html.includes("Business points to watch") && html.includes("A disposal gain may not recur."),
  );
  assert.ok(!html.includes('class="ns-report-readiness"'));
});

test("supplemental VND facts display in consistent units and stay read-only in the evidence drawer", () => {
  const state = fixture();
  const supplemental = {
    id: "operating_cash_flow",
    label: "Operating cash flow",
    unit: "VND_million",
    reportInputOrigin: "verified_supplemental_fact",
    current: {
      ...point(-1145666005788, "H1_2026", "VND"),
      rawText: "(1.145.666.005.788)",
      factId: "verified-cfo",
      verificationReceipt: { id: "source-ledger", sha256: hash, renderSha256: hash },
    },
    comparison: { value: null, unit: "VND_million", verification: "missing" },
  };
  state.dossier.reportProjection.metrics.push(
    ...calculateDossierMetrics([supplemental], state.dossier),
  );
  const report = render(AnalysisPanel, propsFor(state));
  const primaryFigures = /<section class="ns-report-figures"[\s\S]*?<\/section>/.exec(report)?.[0];
  assert.ok(primaryFigures?.includes("Operating cash flow") && primaryFigures.includes("-1,145.7"));
  assert.ok(primaryFigures.includes("Growth comparison is not available"));
  assert.ok(!primaryFigures.includes("Profit before tax"));
  const table = render(FinancialTable, {
    dossier: state.dossier,
    locale: "en",
    copy: securitiesCopy.en,
    controller,
  });
  assert.ok(table.includes("-1,145,666.01") && !table.includes("-1,145,666,005,788"));
  state.selectedSource = {
    source,
    metric: state.dossier.reportProjection.metrics.at(-1),
    period: "current",
    dossierId: state.dossier.id,
    revision: 2,
  };
  const drawer = render(EvidenceDrawer, propsFor(state));
  assert.ok(drawer.includes(`href="${source.localOriginalUrl}#page=18&amp;view=FitH"`));
  assert.ok(drawer.includes(`href="${source.url}#page=18&amp;view=FitH"`));
  assert.ok(drawer.includes("-1,145,666.005788") && drawer.includes("(1.145.666.005.788)"));
  assert.ok(drawer.includes("Supplemental verification") && drawer.includes("source-ledger"));
  assert.ok(!drawer.includes("Correct with a reason"));
  state.selectedSource.metric = state.dossier.metrics[0];
  assert.ok(render(EvidenceDrawer, propsFor(state)).includes("Correct with a reason"));
});

test("derived calculations preserve currency, ratio and percentage-point units with exact input references", () => {
  const state = fixture();
  const html = render(FinancialTable, {
    dossier: state.dossier,
    locale: "en",
    copy: securitiesCopy.en,
    controller,
  });
  const currency =
    /<article[^>]+id="ns-derived-inferred_noncontrolling_profit"[\s\S]*?<\/article>/.exec(
      html,
    )?.[0];
  const margin = /<article[^>]+id="ns-derived-profit_after_tax_margin"[\s\S]*?<\/article>/.exec(
    html,
  )?.[0];
  assert.ok(currency && margin);
  assert.ok(currency.includes("-200,000 VND million") && !currency.includes("-200,000 %"));
  assert.ok(margin.includes("pp") && margin.includes("%"));
  assert.ok(currency.includes("profit_after_tax - profit_parent"));
  assert.ok(currency.includes("Profit after tax · H1 2026: 4,000,000 VND million"));
});

test("the report offers export without a personal approval step and keeps the expert tabs", () => {
  const state = fixture();
  const html = render(DossierWorkspace, propsFor(state));
  assert.ok(html.includes("Download report · Markdown") && html.includes("Download XLSX"));
  assert.ok(!html.includes("Approve revision"));
  assert.doesNotMatch(html, /Compare companies|So sánh doanh nghiệp|ns-comparison-entry/u);
  assert.ok(html.includes('aria-selected="true"') && html.includes('id="ns-tab-analysis"'));
  assert.ok(
    html.includes("Data &amp; sources") &&
      html.includes("Notes &amp; checks") &&
      html.includes("History"),
  );
});

test("the stock-first start form keeps an ACB public-source fallback in both interface languages", () => {
  for (const locale of ["vi", "en"]) {
    const state = { ...fixture(), locale };
    const copy = securitiesCopy[locale];
    const html = render(StartWorkspace, { state, copy, controller });
    assert.ok(
      html.includes(copy.startTitle) &&
        html.includes(investorCopy(locale).research.replaceAll("&", "&amp;")),
    );
    assert.ok(
      html.includes('id="ns-question"') &&
        html.includes('id="ns-start-company"') &&
        !html.includes('id="ns-start-comparison"'),
    );
    assert.ok(html.includes("ACB") && !html.includes("FPT"));
    assert.ok(html.includes(`placeholder="${copy.questionPlaceholder}"`));
    assert.doesNotMatch(html, /Compare companies|So sánh doanh nghiệp|ns-comparison-entry/u);
    assert.equal((html.match(/type="submit"/g) ?? []).length, 1);
    assert.ok(html.indexOf('id="ns-start-company"') < html.indexOf('id="ns-question"'));
    assert.ok(!html.includes(copy.sourceAssuranceTitle));
  }
  const progress = render(JobProgress, {
    job: { status: "running", kind: "analysis", progress: { stage: "checking_report" } },
    copy: securitiesCopy.en,
    locale: "en",
  });
  assert.ok(
    progress.includes("Checking findings against the data and sources") && !progress.includes("%"),
  );
});

test("the processed ACB start form renders banking questions, intent labels and exact periods in both languages", () => {
  for (const locale of ["vi", "en"]) {
    const state = { ...fixture(), locale, dossier: null };
    const company = {
      id: "ACB",
      ticker: "ACB",
      exchange: "HOSE",
      name: "Synthetic ACB bank",
      sectorId: "banking",
      periods: [
        {
          id: "H1_2026",
          label: "H1 2026",
          comparisonOptions: [{ id: "H1_2025", label: "H1 2025" }],
        },
      ],
    };
    state.catalog.companies.push(company);
    const html = render(StartWorkspace, { state, copy: securitiesCopy[locale], controller });
    const labels = investorCopy(locale, "banking");
    assert.ok(html.includes("ACB") && !html.includes("FPT"));
    assert.ok(html.includes(labels.intents.earnings.title.replaceAll("&", "&amp;")));
    assert.ok(
      html.includes(labels.processed) && html.includes(labels.analyze.replaceAll("&", "&amp;")),
    );
    assert.ok(html.includes('id="ns-period"') && html.includes('id="ns-start-comparison"'));
    assert.ok(html.includes("H1 2026") && html.includes("H1 2025"));
    assert.match(html, locale === "vi" ? /Thu nhập lãi thuần/u : /net interest income/u);
    const placeholder = /<textarea[^>]+placeholder="([^"]+)"/u.exec(html)?.[1];
    assert.ok(placeholder);
    assert.notEqual(placeholder, securitiesCopy[locale].questionPlaceholder);
    assert.match(
      placeholder,
      locale === "vi" ? /Thu nhập lãi thuần và dự phòng/u : /net interest income and provisions/u,
    );
    assert.doesNotMatch(
      html,
      /Lợi nhuận &amp; dòng tiền|Profit &amp; cash flow|Doanh thu|revenue/u,
    );
    assert.equal((html.match(/type="submit"/g) ?? []).length, 1);
    company.sectorId = "technology";
    const nonbank = render(StartWorkspace, { state, copy: securitiesCopy[locale], controller });
    assert.ok(nonbank.includes(`placeholder="${securitiesCopy[locale].questionPlaceholder}"`));
  }
});

test("banking report and financial summaries surface income, profit and provisions from the safe metrics", () => {
  const state = fixture();
  state.dossier.company = { id: "ACB", ticker: "ACB", exchange: "HOSE", sectorId: "banking" };
  const entries = [
    [
      "bank_operating_cash_flow",
      { vi: "Dòng tiền kinh doanh ngân hàng", en: "Bank operating cash flow" },
      -500,
      -450,
    ],
    ["operating_expenses", { vi: "Chi phí hoạt động", en: "Operating expenses" }, -300, -250],
    ["profit_after_tax", { vi: "Lợi nhuận sau thuế", en: "Profit after tax" }, 400, 360],
    ["net_interest_income", { vi: "Thu nhập lãi thuần", en: "Net interest income" }, 900, 800],
    ["net_fee_income", { vi: "Thu nhập phí thuần", en: "Net fee income" }, 70, 65],
    [
      "operating_profit_before_provision",
      { vi: "Lợi nhuận trước dự phòng", en: "Operating profit before provisions" },
      700,
      600,
    ],
    [
      "credit_loss_provision",
      { vi: "Chi phí dự phòng rủi ro tín dụng", en: "Credit loss provisions" },
      -200,
      -150,
    ],
    ["profit_before_tax", { vi: "Lợi nhuận trước thuế", en: "Profit before tax" }, 500, 450],
  ];
  const metrics = entries.map((entry) => {
    const result = metric(...entry);
    result.current.entityId = "ACB";
    result.comparison.entityId = "ACB";
    return result;
  });
  state.dossier.metrics = calculateDossierMetrics(metrics, state.dossier);
  state.dossier.reportProjection.metrics = structuredClone(state.dossier.metrics);
  state.dossier.reportProjection.derivedMetrics = [];
  state.dossier.reportReadiness.includedMetricCount = metrics.length;
  state.dossier.reportReadiness.totalMetricCount = metrics.length;
  const before = JSON.stringify(state.dossier);
  for (const locale of ["vi", "en"]) {
    state.locale = locale;
    const report = render(AnalysisPanel, propsFor(state));
    const figures = /<section class="ns-report-figures"[\s\S]*?<\/section>/u.exec(report)?.[0];
    const table = render(FinancialTable, {
      dossier: state.dossier,
      locale,
      copy: securitiesCopy[locale],
      controller,
    });
    const highlights = /<div class="ns-key-figures">[\s\S]*?<\/button><\/div>/u.exec(table)?.[0];
    assert.ok(figures && highlights);
    for (const section of [figures, highlights]) {
      for (const id of ["net_interest_income", "profit_before_tax", "credit_loss_provision"]) {
        const label = entries.find((entry) => entry[0] === id)[1][locale];
        assert.ok(section.includes(label), `Missing bank highlight: ${id}`);
      }
      assert.doesNotMatch(
        section,
        /Dòng tiền kinh doanh ngân hàng|Bank operating cash flow|Lợi nhuận sau thuế|Profit after tax/u,
      );
      assert.equal((section.match(/<button /g) ?? []).length, 3);
    }
    assert.ok(
      table.includes(
        locale === "vi" ? "Dòng tiền kinh doanh ngân hàng" : "Bank operating cash flow",
      ),
    );
  }
  assert.equal(JSON.stringify(state.dossier), before);

  state.locale = "en";
  state.dossier.reportProjection.metrics = state.dossier.reportProjection.metrics.filter(
    (item) => item.id !== "net_interest_income",
  );
  const limited = render(AnalysisPanel, propsFor(state));
  const limitedFigures = /<section class="ns-report-figures"[\s\S]*?<\/section>/u.exec(
    limited,
  )?.[0];
  assert.ok(limitedFigures?.includes("Operating profit before provisions"));
  assert.ok(
    !limitedFigures.includes("Net interest income"),
    "Omitted evidence cannot become a headline figure",
  );
});

test("model processing shows only observed progress below the question and ignores private payload fields", () => {
  const state = fixture();
  const hidden = "PRIVATE_CHAIN_OF_THOUGHT_MUST_STAY_HIDDEN";
  const job = {
    status: "running",
    kind: "analysis",
    startedAt: "2026-09-07T06:47:15.000Z",
    progress: {
      stage: "reading_sources",
      readCount: 2,
      sourceId: source.id,
      pages: [18],
      reasoning: hidden,
    },
    reasoning: hidden,
    rawResponse: hidden,
    receipts: [
      {
        actualModel: "meta/muse-spark-1.3-contributor",
        startedAt: "2026-09-07T06:47:15.000Z",
        completedAt: "2026-09-07T06:47:22.000Z",
        rawResponse: hidden,
        reasoning: hidden,
      },
    ],
  };
  const trace = buildModelProcess({
    job,
    dossier: state.dossier,
    analysis: { ...state.dossier.analysis, reasoning: hidden },
    kind: "analysis",
    locale: "en",
  });
  assert.equal(trace.active, true);
  assert.equal(trace.stage, "reading_sources");
  assert.equal(trace.readCount, 2);
  assert.equal(trace.receiptCount, 1);
  assert.deepEqual(trace.reads[0].pages, [18]);
  const html = render(ModelProcess, {
    job,
    dossier: state.dossier,
    analysis: state.dossier.analysis,
    kind: "analysis",
    locale: "en",
  });
  assert.ok(html.includes("Reading data and source documents"));
  assert.ok(html.includes("This is a summary of system-observed steps"));
  assert.ok(html.includes("Preserved issuer report") && html.includes("Pages: 18"));
  assert.ok(!html.includes(hidden));
  state.job = job;
  const report = render(AnalysisPanel, propsFor(state));
  assert.ok(
    report.indexOf(state.dossier.query) < report.indexOf("Reading data and source documents"),
  );
});

test("a completed model trace keeps duration, reads, checks and receipts with bilingual copy", () => {
  const state = fixture();
  state.dossier.analysis.receipts = [
    {
      actualModel: "meta/muse-spark-1.3-contributor",
      startedAt: "2026-09-07T06:47:15.000Z",
      completedAt: "2026-09-07T06:47:22.000Z",
    },
    {
      actualModel: "meta/muse-spark-1.3-contributor",
      startedAt: "2026-09-07T06:47:22.000Z",
      completedAt: "2026-09-07T06:48:33.000Z",
    },
  ];
  state.dossier.reportProjection.analysis = structuredClone(state.dossier.analysis);
  const html = render(ModelProcess, {
    dossier: state.dossier,
    analysis: state.dossier.reportProjection.analysis,
    kind: "analysis",
    locale: "vi",
  });
  assert.ok(html.includes("Đã xử lý trong 1 phút 18 giây"));
  assert.ok(html.includes("Lượt đọc nguồn") && html.includes("Lượt xử lý"));
  assert.ok(html.includes("Các kiểm tra đã vượt qua"));
  assert.ok(html.includes("Nội dung tìm: profit attribution"));
  assert.ok(html.includes("meta/muse-spark-1.3-contributor"));
});

test("the shared library discloses public history and exposes confirmed deletion per dossier", () => {
  const state = fixture();
  state.catalog = { runtime: { sharedLibrary: true, deletion: "public" } };
  state.dossiers = [
    {
      id: state.dossier.id,
      revision: state.dossier.revision,
      query: state.dossier.query,
      company: state.dossier.company,
      period: state.dossier.period,
      updatedAt: "2026-09-07T08:00:00.000Z",
    },
  ];
  const html = render(ResearchLibrary, {
    state,
    controller: { openDossier() {}, newResearch() {}, deleteDossier() {} },
    copy: securitiesCopy.en,
  });
  assert.ok(html.includes("Shared history: everyone can view and delete saved research."));
  assert.match(html, /aria-label="Delete research: FPT"/u);
  assert.ok(html.includes("Delete saved research?"));
  assert.ok(html.includes("cannot be undone"));
});

test("the dossier library retains localized search and newest-first ordering", () => {
  const dossiers = [
    {
      id: "older",
      company: { ticker: "TEST", name: { vi: "Doanh nghiệp kiểm thử", en: "Test company" } },
      period: { id: "H1_2026", label: { vi: "6 tháng đầu năm 2026", en: "H1 2026" } },
      query: "Dòng tiền của doanh nghiệp kiểm thử",
      updatedAt: "2026-09-06T00:00:00.000Z",
    },
    {
      id: "newer",
      company: { ticker: "TEST", name: { vi: "Doanh nghiệp kiểm thử", en: "Test company" } },
      period: { id: "H1_2026", label: { vi: "6 tháng đầu năm 2026", en: "H1 2026" } },
      query: "Kết quả kinh doanh của doanh nghiệp kiểm thử",
      updatedAt: "2026-09-07T00:00:00.000Z",
    },
  ];
  assert.deepEqual(
    researchLibraryEntries(dossiers, "test dong tien", "vi").map((item) => item.id),
    ["older"],
  );
  assert.deepEqual(
    researchLibraryEntries(dossiers, "test H1 2026", "en").map((item) => item.id),
    ["newer", "older"],
  );
  assert.deepEqual(
    dossiers.map((item) => item.id),
    ["older", "newer"],
  );
});

test("follow-up claims stay unique and keep exact-version evidence while projection-only sources remain inspectable", () => {
  const state = fixture();
  state.chat = [
    { role: "assistant", content: state.dossier.analysis.summary, answer: state.dossier.analysis },
  ];
  const html = render(ChatPanel, { ...propsFor(state), open: true, onClose() {} });
  assert.equal(html.split(state.dossier.analysis.claims[0].text).length - 1, 1);
  assert.ok(html.includes(`href="${source.localOriginalUrl}#page=18&amp;view=FitH"`));
  const bad = {
    ...state.dossier.analysis.claims[0],
    evidenceQuotes: [
      { sourceId: source.id, sourceVersion: "wrong", quote: "Stale quote", locator: { page: 18 } },
    ],
  };
  assert.ok(
    !render(ClaimEvidence, {
      claim: bad,
      dossier: state.dossier,
      locale: "en",
      copy: securitiesCopy.en,
      controller,
    }).includes("#page=18"),
  );
});
