import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  buildSecuritiesDataset,
  catalogFromDatasets,
  getFrozenSecuritiesDatasets,
  resolveScopeFromDatasets,
} from "../../shared/securities/catalog.js";
import {
  SECURITIES_SOURCE_DOCUMENTS,
  parseVndToMillion,
} from "../../shared/securities/source-contract.js";
import {
  compareFinancialMetric,
  reconcileReportedChange,
} from "../../shared/securities/finance.js";
import {
  discoverSecuritiesDisclosurePages,
  discoverSecuritiesDocuments,
  inferDiscoveredPeriod,
  refreshSecuritiesSources,
} from "../../worker/securities/sources.js";
import {
  createCandidateSource,
  validateCandidateOriginal,
} from "../../scripts/securities/source-candidates.mjs";

// Synthetic transport/layout fixtures below are distinct from the real issuer receipts in output/securities.
const FPT = SECURITIES_SOURCE_DOCUMENTS.find((source) => source.id === "fpt-h1-2026");
const PDF = "%PDF-1.7\nSynthetic transport fixture; not financial evidence.\n%%EOF";
const digest = (value) => createHash("sha256").update(value).digest("hex");

function importedFixture() {
  const dataset = getFrozenSecuritiesDatasets().find(
    (entry) => entry.company.id === "FPT" && entry.period.id === "H1_2026",
  );
  dataset.sources[0].hash = digest(PDF);
  dataset.sources[0].version = `sha256:${digest(PDF)}`;
  for (const metric of dataset.metrics)
    for (const side of ["current", "comparison"])
      metric[side].sourceVersion = dataset.sources[0].version;
  return dataset;
}

test("source catalog and exact scope include dynamically prepared quarter datasets without changing known issuer defaults", () => {
  const dataset = importedFixture();
  dataset.company = {
    id: "HOSE_XYZ",
    ticker: "XYZ",
    exchange: "HOSE",
    name: "Synthetic dynamic quarter issuer",
  };
  dataset.period = {
    ...dataset.period,
    id: "Q1_2026",
    start: "2026-01-01",
    end: "2026-03-31",
    kind: "quarter",
  };
  dataset.comparisonPeriod = {
    ...dataset.comparisonPeriod,
    id: "Q1_2025",
    start: "2025-01-01",
    end: "2025-03-31",
    kind: "quarter",
  };
  dataset.sources[0].companyId = dataset.company.id;
  dataset.sources[0].periodId = dataset.period.id;
  for (const metric of dataset.metrics)
    for (const side of ["current", "comparison"]) {
      metric[side].entityId = dataset.company.id;
      metric[side].periodId = side === "current" ? dataset.period.id : dataset.comparisonPeriod.id;
    }
  const datasets = [dataset, ...getFrozenSecuritiesDatasets()];
  const catalog = catalogFromDatasets(datasets);
  assert.equal(catalog.defaultCompanyId, "FPT");
  assert.equal(
    catalog.companies.find((company) => company.id === "HOSE_XYZ").periods[0].id,
    "Q1_2026",
  );
  for (const input of [
    { companyId: "HOSE_XYZ", periodId: "Q1_2026" },
    { companyId: "XYZ", query: "XYZ Q1 2026" },
    { query: "XYZ quý 1 năm 2026" },
  ]) {
    const scope = resolveScopeFromDatasets(input, datasets);
    assert.equal(scope.companyId, "HOSE_XYZ");
    assert.equal(scope.periodId, "Q1_2026");
    assert.equal(scope.comparisonPeriodId, "Q1_2025");
  }
  assert.throws(() => resolveScopeFromDatasets({ query: "XYZ Q2 2026" }, datasets), {
    code: "unsupported_period",
  });
  assert.throws(
    () => resolveScopeFromDatasets({ companyId: "FPT", query: "XYZ Q1 2026" }, datasets),
    { code: "ambiguous_company" },
  );
  assert.throws(
    () => resolveScopeFromDatasets({ companyId: "FPT", query: "ZZZ Q1 2026" }, datasets),
    { code: "unsupported_company" },
  );
});

function sqliteBinding(database) {
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        bind(...args) {
          return {
            first: async () => statement.get(...args) ?? null,
            run: async () => {
              statement.run(...args);
              return { success: true };
            },
          };
        },
      };
    },
  };
}

test("source catalog: database ordering cannot make FPT default to the incompatible reported comparator", () => {
  const reversed = getFrozenSecuritiesDatasets().reverse();
  const scope = resolveScopeFromDatasets(
    { query: "FPT 6 tháng 2026 thay đổi thế nào so với cùng kỳ?" },
    reversed,
  );
  assert.equal(scope.comparisonPeriodId, "H1_2025_restated");
  const period = catalogFromDatasets(reversed)
    .companies.find((company) => company.id === "FPT")
    .periods.find((entry) => entry.id === "H1_2026");
  assert.equal(period.comparisonOptions[0].id, "H1_2025_restated");
  assert.equal(
    resolveScopeFromDatasets(
      { companyId: "FPT", periodId: "H1_2026", comparisonPeriodId: "H1_2025_reported" },
      reversed,
    ).comparisonPeriodId,
    "H1_2025_reported",
  );
});

test("source scope: a generic question uses visible defaults while a named issuer or period takes priority", () => {
  const defaultScope = {
    companyId: "FPT",
    periodId: "H1_2026",
    comparisonPeriodId: "H1_2025_restated",
  };
  const generic = resolveScopeFromDatasets({
    query: "Lợi nhuận có đi cùng dòng tiền?",
    defaultScope,
  });
  assert.equal(generic.companyId, "FPT");
  assert.equal(generic.periodId, "H1_2026");
  assert.equal(generic.comparisonPeriodId, "H1_2025_restated");
  const annual = resolveScopeFromDatasets({
    query: "FPT FY2025: CFO có đi cùng LNST?",
    defaultScope,
  });
  assert.equal(annual.periodId, "FY2025");
  assert.equal(annual.comparisonPeriodId, "FY2024");
  const gmd = resolveScopeFromDatasets({
    query: "GMD: lợi nhuận có đi cùng dòng tiền?",
    defaultScope,
  });
  assert.equal(gmd.companyId, "GMD");
  assert.equal(gmd.periodId, "H1_2026");
  assert.equal(gmd.comparisonPeriodId, "H1_2025");
  const annualHint = { companyId: "FPT", periodId: "FY2025", comparisonPeriodId: "FY2024" };
  assert.equal(
    resolveScopeFromDatasets({ query: "FPT kỳ mới nhất", defaultScope: annualHint }).periodId,
    "H1_2026",
  );
  assert.equal(
    resolveScopeFromDatasets({ query: "FPT latest annual report", defaultScope }).periodId,
    "FY2025",
  );
  assert.equal(
    resolveScopeFromDatasets({ query: "GMD", defaultScope: annualHint }).comparisonPeriodId,
    "H1_2025",
  );
});

test("source scope: defaults never override explicit selectors, unsupported requested periods or issuer cues", () => {
  const defaultScope = {
    companyId: "FPT",
    periodId: "H1_2026",
    comparisonPeriodId: "H1_2025_restated",
  };
  for (const query of [
    "HPG H1 2026",
    "hpg lợi nhuận",
    "FPTS FY2025",
    "FPT Securities năm 2025",
    "FPT và HPG",
    "TCB có dòng tiền thế nào?",
    "Mã cổ phiếu vnm năm 2025",
    "ticker ssi H1 2026",
  ]) {
    assert.throws(
      () => resolveScopeFromDatasets({ query, defaultScope }),
      { code: "unsupported_company" },
      query,
    );
  }
  for (const query of ["FPT Q2 2026", "FPT H2 2026", "GMD FY2025", "FPT H1 2025", "FPT năm 2027"]) {
    assert.throws(
      () => resolveScopeFromDatasets({ query, defaultScope }),
      { code: "unsupported_period" },
      query,
    );
  }
  assert.throws(() => resolveScopeFromDatasets({ query: "GMD", companyId: "FPT", defaultScope }), {
    code: "ambiguous_company",
  });
  assert.throws(
    () => resolveScopeFromDatasets({ query: "FPT FY2025", periodId: "H1_2026", defaultScope }),
    { code: "ambiguous_period" },
  );
  assert.throws(
    () => resolveScopeFromDatasets({ query: "FPT kỳ mới nhất", periodId: "FY2025", defaultScope }),
    { code: "ambiguous_period" },
  );
  assert.throws(
    () => resolveScopeFromDatasets({ query: "FPT 2025", periodId: "H1_2026", defaultScope }),
    { code: "ambiguous_period" },
  );
  assert.throws(() => resolveScopeFromDatasets({ query: "FPT và GMD", defaultScope }), {
    code: "ambiguous_company",
  });
  assert.throws(() => resolveScopeFromDatasets({ query: "Lợi nhuận thế nào?" }), {
    code: "unsupported_company",
  });
  for (const query of [
    "FPT CFO / PAT / NCI trong BCTC",
    "FTEL chuyển sang phương pháp vốn chủ sở hữu?",
    "FPT VND và EPS",
  ]) {
    assert.equal(resolveScopeFromDatasets({ query, defaultScope }).companyId, "FPT");
  }
});

test("source scope: default hints have a closed shape and only apply to a compatible scope", () => {
  for (const defaultScope of [
    null,
    [],
    {},
    { companyId: "FPT", url: "https://example.com" },
    { companyId: "FPT", periodId: "" },
    { companyId: "FPT", comparisonPeriodId: null },
  ]) {
    assert.throws(() => resolveScopeFromDatasets({ query: "Lợi nhuận thế nào?", defaultScope }), {
      code: "invalid_default_scope",
    });
  }
  assert.throws(
    () =>
      resolveScopeFromDatasets({ query: "Lợi nhuận thế nào?", defaultScope: { companyId: "HPG" } }),
    { code: "unsupported_company" },
  );
  const result = resolveScopeFromDatasets({
    query: "GMD H1 2026",
    defaultScope: { companyId: "FPT", periodId: "FY2025", comparisonPeriodId: "FY2024" },
  });
  assert.equal(result.companyId, "GMD");
  assert.equal(result.comparisonPeriodId, "H1_2025");
});

test("source catalog: current public-source rates reconcile against server arithmetic only on their actual basis", () => {
  const datasets = getFrozenSecuritiesDatasets().filter(
    (dataset) => dataset.sources[0].id === FPT.id,
  );
  const comparable = datasets.find((dataset) => dataset.comparisonPeriod.id === "H1_2025_restated");
  assert.deepEqual(
    comparable.metrics.map((metric) => metric.reportedChangePct.value),
    [12.6, 18.1, 14, 14.1],
  );
  for (const metric of comparable.metrics) {
    assert.equal(metric.reportedChangePct.displayDecimals, 1);
    assert.equal(metric.reportedChangePct.sourceVersion, `sha256:${FPT.hash}`);
    assert.equal(
      reconcileReportedChange(metric, compareFinancialMetric(metric).relativeChangePct).status,
      "consistent",
    );
  }
  assert.ok(
    datasets
      .find((dataset) => dataset.comparisonPeriod.id === "H1_2025_reported")
      .metrics.every((metric) => !metric.reportedChangePct),
  );
});

test("source numeric parser: original VND precision, signs, zero and missing remain distinct", () => {
  assert.equal(parseVndToMillion("70.112.825.100.710"), "70112825.100710");
  assert.equal(parseVndToMillion("( 1.234.567 )"), "-1.234567");
  assert.equal(parseVndToMillion("− 1,234,567"), "-1.234567");
  assert.equal(parseVndToMillion("0"), "0.000000");
  assert.equal(parseVndToMillion(null), null);
  for (const raw of ["1.234,567", "1.23.456", "1O.234.567", "(1.234.567", "1234567"])
    assert.throws(() => parseVndToMillion(raw), { code: "invalid_numeric_extraction" });
});

test("source discovery: only issuer URLs are candidates and a filename date is not a publication date", () => {
  const url =
    "https://fpt.com/api/media/20270821_FPT_BCTC_hop_nhat_ban_nien_da_soat_xet_nam_2027_abc.pdf";
  const html = `<html><body><a href="${url}">BCTC hợp nhất bán niên 2027</a><a href="https://evil.example/report.pdf">Report</a></body></html>`;
  const [candidate] = discoverSecuritiesDocuments(html, FPT.landingUrl, "FPT");
  assert.equal(candidate.periodId, "H1_2027");
  assert.equal(candidate.publishedAt, null);
  assert.equal(candidate.periodBasis, "filename_requires_original_check");
  assert.equal(candidate.status, "discovered_requires_metadata_review");
  assert.equal(
    inferDiscoveredPeriod("https://fpt.com/api/media/FPT_BCTC_hop_nhat_quy_2_2027.pdf"),
    null,
  );
  assert.throws(() => discoverSecuritiesDocuments(html, FPT.landingUrl, "GMD"), {
    code: "invalid_discovery_content",
  });
});

test("source discovery: Gemadept's index traverses only bounded official disclosure pages", () => {
  const base = "https://www.gemadept.com.vn/co-dong/bao-cao-tai-chinh/";
  const html =
    '<html><a href="/gmd-bctc-soat-xet-ban-nien-2026/">Report</a><a href="http://127.0.0.1/">Unsafe</a><a href="/co-dong/bao-cao-tai-chinh/">Index</a></html>';
  assert.deepEqual(discoverSecuritiesDisclosurePages(html, base, "GMD"), [
    "https://www.gemadept.com.vn/gmd-bctc-soat-xet-ban-nien-2026/",
  ]);
});

test("source refresh: durable TTL cache uses the imported version baseline and expires after 24 hours", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(
    await readFile(
      new URL("../../worker/securities/migrations/0003_source_checks.sql", import.meta.url),
      "utf8",
    ),
  );
  const env = {
    SECURITIES_DB: sqliteBinding(database),
    SECURITIES_DATASET_LOADER: async () => [importedFixture()],
  };
  let calls = 0;
  let body = PDF;
  const fetchImpl = async (url) => {
    calls += 1;
    return url.endsWith(".pdf")
      ? new Response(body, { headers: { "Content-Type": "application/pdf" } })
      : new Response("<html><body>No additional report links in this fixture.</body></html>", {
          headers: { "Content-Type": "text/html" },
        });
  };
  const input = { companyId: "FPT", sourceIds: [FPT.id] };
  const first = await refreshSecuritiesSources(input, {
    env,
    fetchImpl,
    now: () => "2026-09-06T00:00:00.000Z",
  });
  assert.equal(first.status, "unchanged");
  assert.equal(first.sourceChecks[0].previousHash, digest(PDF));
  assert.equal(calls, 2);
  const reconstructedEnv = { ...env, SECURITIES_DB: sqliteBinding(database) };
  const cached = await refreshSecuritiesSources(input, {
    env: reconstructedEnv,
    fetchImpl,
    forceRefresh: false,
    now: () => "2026-09-06T12:00:00.000Z",
  });
  assert.equal(cached.cacheHit, true);
  assert.equal(calls, 2);
  body = PDF.replace("fixture", "revision fixture");
  const revised = await refreshSecuritiesSources(input, {
    env,
    fetchImpl,
    forceRefresh: false,
    now: () => "2026-09-07T00:00:00.001Z",
  });
  assert.equal(revised.status, "changed");
  assert.equal(revised.freshness.status, "revision_detected");
  assert.equal(revised.sourceChecks[0].previousHash, digest(PDF));
  assert.equal(calls, 4);
  database.close();
});

function candidateFixture() {
  const candidate = {
    companyId: "FPT",
    periodId: "H1_2027",
    url: "https://fpt.com/api/media/FPT_BCTC_hop_nhat_ban_nien_2027.pdf",
    landingUrl: FPT.landingUrl,
    title: "Synthetic layout control",
    titleBasis: "fixture",
  };
  const rows = [
    "Doanh thu thuần 10 2.000.000 1.000.000",
    "Lợi nhuận gộp 20 1.000.000 500.000.000",
    "Tổng lợi nhuận kế toán trước thuế 50 900.000.000 800.000.000",
    "Lợi nhuận sau thuế 60 700.000.000 600.000.000",
    "Cổ đông công ty mẹ 61 650.000.000 550.000.000",
  ];
  const cover =
    "CÔNG TY CỔ PHẦN FPT\nBÁO CÁO TÀI CHÍNH HỢP NHẤT\ncho kỳ sáu tháng kết thúc ngày 30 tháng 06 năm 2027";
  const statement =
    "BÁO CÁO KẾT QUẢ HOẠT ĐỘNG KINH DOANH HỢP NHẤT\nĐơn vị tính: VND\n" + rows.join("\n");
  const extraction = {
    pageCount: 2,
    textPageCount: 2,
    ocrPageCount: 0,
    pages: [
      { page: 1, text: cover, lines: [{ text: cover }] },
      { page: 2, text: statement, lines: rows.map((text) => ({ text })) },
    ],
  };
  return {
    candidate,
    extraction,
    fetched: {
      url: candidate.url,
      hash: "b".repeat(64),
      byteLength: 1024,
      fetchedAt: "2027-08-21T00:00:00Z",
    },
  };
}

test("source ingestion fixture: a discovered original can produce a new period dataset without inheriting verification", () => {
  const fixture = candidateFixture();
  const { source, cells } = createCandidateSource(
    fixture.candidate,
    fixture.fetched,
    fixture.extraction,
  );
  assert.match(source.id, /^fpt-discovered-[a-f0-9]{16}$/u);
  assert.equal(source.publishedAt, null);
  assert.equal(source.auditStatus, "not_verified");
  const dataset = buildSecuritiesDataset(source, cells);
  assert.equal(dataset.period.id, "H1_2027");
  assert.equal(dataset.comparisonPeriod.id, "H1_2026");
  assert.equal(dataset.metrics.find((metric) => metric.id === "revenue").current.value, "2.000000");
  assert.ok(dataset.metrics.every((metric) => metric.current.verification !== "verified"));
  assert.equal(dataset.evidenceNotes.length, 0);
  assert.ok(dataset.issues.some((issue) => issue.code === "source_verification_required"));
});

test("source ingestion fixture: a subsidiary, wrong period or unknown original unit cannot be mislabeled", () => {
  const fixture = candidateFixture();
  for (const text of [
    fixture.extraction.pages[0].text.replace("CỔ PHẦN FPT", "CỔ PHẦN VIỄN THÔNG FPT"),
    fixture.extraction.pages[0].text.replace("2027", "2026"),
  ]) {
    const extraction = structuredClone(fixture.extraction);
    extraction.pages[0].text = text;
    assert.throws(() => validateCandidateOriginal(fixture.candidate, extraction), {
      code: "candidate_identity_unconfirmed",
    });
  }
  fixture.extraction.pages[1].text = fixture.extraction.pages[1].text.replace("VND", "USD");
  assert.throws(
    () => createCandidateSource(fixture.candidate, fixture.fetched, fixture.extraction),
    { code: "candidate_unit_unconfirmed" },
  );
});
