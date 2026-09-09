import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  getFrozenSecuritiesDatasets,
  getReviewedSecuritiesSourceCells,
  resolveScopeFromDatasets,
} from "../../shared/securities/catalog.js";
import {
  SECURITIES_SOURCE_DOCUMENTS,
  parseSourceAmountToMillion,
  parseVndToMillion,
  validateSecuritiesSourceUrl,
} from "../../shared/securities/source-contract.js";
import {
  checkReviewedSecuritiesCompanions,
  discoverSecuritiesDocuments,
  inferDiscoveredPeriod,
  refreshSecuritiesSources,
} from "../../worker/securities/sources.js";

const ACB = SECURITIES_SOURCE_DOCUMENTS.find((source) => source.id === "acb-h1-2026");
const FUTURE =
  "https://acb.com.vn/acbwebsite/files/ACB%20BCTC%20hop%20nhat%20ban%20nien%202028.pdf";
const PDF = "%PDF-1.7\nSynthetic companion transport fixture; not financial evidence.\n%%EOF";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const syntheticSource = () => ({
  ...ACB,
  hash: digest(PDF),
  reviewedCompanion: { ...ACB.reviewedCompanion, hash: digest(PDF) },
});
const pdfResponse = () => new Response(PDF, { headers: { "Content-Type": "application/pdf" } });
const post = (url, extra = {}) => ({
  is_active: 1,
  type: "nha-dau-tu",
  title: "Synthetic consolidated financial report listing",
  featured_image: { path: url },
  ...extra,
});
function listing(posts) {
  const value = {
    props: { pageProps: { blocks: [{ formdata: { default_data: { data: posts } } }] } },
  };
  // The live issuer's Next.js listing uses escaped JSON string URLs, not PDF anchors.
  return (
    '<html><body><script id="__NEXT_DATA__" type="application/json">' +
    JSON.stringify(value).replace(/\//gu, "\\/") +
    "</script></body></html>"
  );
}

test("ACB source amounts preserve native million-VND signs and existing VND conversion", () => {
  assert.equal(parseSourceAmountToMillion("14.773.853", "VND_million"), "14773853.000000");
  assert.equal(parseSourceAmountToMillion("(42.374.834)", "VND_million"), "-42374834.000000");
  assert.equal(parseSourceAmountToMillion("−1.234", "VND_million"), "-1234.000000");
  assert.equal(parseVndToMillion("14.773.853"), "14.773853");
  assert.equal(parseVndToMillion("(42.374.834)"), "-42.374834");
  assert.throws(() => parseSourceAmountToMillion("1.234", "USD"), {
    code: "unsupported_source_unit",
  });
  assert.throws(() => parseSourceAmountToMillion("1.234,567", "VND_million"), {
    code: "invalid_numeric_extraction",
  });
});

test("ACB catalog exposes eight reviewed bank pairs with exact periods and native units", () => {
  const dataset = getFrozenSecuritiesDatasets().find((item) => item.company.id === "ACB");
  assert.equal(dataset.company.sectorId, "banking");
  assert.equal(dataset.period.id, "H1_2026");
  assert.equal(dataset.comparisonPeriod.id, "H1_2025");
  assert.equal(dataset.sources[0].auditStatus, "reviewed");
  assert.match(dataset.sources[0].title, /Bản tra cứu/u);
  const expected = {
    net_interest_income: [14773853, 13042713],
    net_fee_income: [1818343, 1457044],
    operating_expenses: [-5566330, -5428052],
    operating_profit_before_provision: [12481235, 11779120],
    credit_loss_provision: [-1746196, -1089167],
    profit_before_tax: [10735039, 10689953],
    profit_after_tax: [8612866, 8559425],
    bank_operating_cash_flow: [-42374834, -9800290],
  };
  assert.deepEqual(dataset.metrics.map((metric) => metric.id).sort(), Object.keys(expected).sort());
  for (const metric of dataset.metrics) {
    for (const [index, side] of ["current", "comparison"].entries()) {
      assert.equal(metric[side].value, `${expected[metric.id][index]}.000000`);
      assert.equal(metric[side].originalUnit, "VND_million");
      assert.equal(metric[side].verification, "verified");
      assert.equal(metric[side].sourceVersion, `sha256:${ACB.hash}`);
      assert.equal(metric[side].locator.page, metric.id === "bank_operating_cash_flow" ? 11 : 10);
    }
  }
  assert.equal(getReviewedSecuritiesSourceCells(ACB.id, "0".repeat(64)), null);
  assert.equal(getReviewedSecuritiesSourceCells(ACB.id, ACB.hash).cells.length, 8);
});

test("ACB financial abbreviations resolve only in bank context and never hide explicit unknown tickers", () => {
  for (const query of ["CIR NII NIM của ACB H1 2026", "NPL LDR PPOP của Ngân hàng Á Châu H1 2026"])
    assert.equal(resolveScopeFromDatasets({ query }).companyId, "ACB");
  assert.equal(
    resolveScopeFromDatasets({ companyId: "ACB", query: "CIR thay đổi thế nào?" }).companyId,
    "ACB",
  );
  assert.equal(
    resolveScopeFromDatasets({
      defaultScope: { companyId: "ACB", periodId: "H1_2026" },
      query: "NII và CIR",
    }).companyId,
    "ACB",
  );
  for (const input of [
    { companyId: "FPT", query: "NII" },
    { companyId: "ACB", query: "mã NII" },
    { companyId: "ACB", query: "ticker NIM" },
    { companyId: "ACB", query: "ZZZ H1 2026" },
  ])
    assert.throws(() => resolveScopeFromDatasets(input), { code: "unsupported_company" });
  assert.throws(() => resolveScopeFromDatasets({ query: "ACB Q2 2026" }), {
    code: "unsupported_period",
  });
});

test("ACB curated source quotes retain printed note references before the amount columns", () => {
  const dataset = getFrozenSecuritiesDatasets().find((item) => item.company.id === "ACB");
  const expected = {
    operating_expenses: "VIII Chi phí hoạt động 29 (5.566.330) (5.428.052)",
    credit_loss_provision: "X Chi phí dự phòng rủi ro tín dụng 30 (1.746.196) (1.089.167)",
  };
  for (const [metricId, text] of Object.entries(expected)) {
    const excerpt = dataset.sources[0].excerpts.find((entry) => entry.id === `row-${metricId}`);
    assert.equal(excerpt.text, text);
    assert.equal(excerpt.locator.page, 10);
  }
  const review = getReviewedSecuritiesSourceCells(ACB.id, ACB.hash);
  assert.equal(
    review.oracleSha256,
    "1eb8b8265d067768231cd2c512b36c0795744c56c0809fe5a045d564d6695907",
  );
  assert.match(review.quoteCorrectionSha256, /^[a-f0-9]{64}$/u);
  assert.equal(
    review.cellsDigest,
    "18972fd4941ce26ec867afc664aadc76d34bae6083592ef6c8a0df253563f263",
  );
});

test("ACB source routes accept consolidated reports while rejecting separate, arbitrary and credentialed resources", () => {
  for (const url of [ACB.url, ACB.reviewedCompanion.url, FUTURE, ACB.landingUrl])
    assert.equal(validateSecuritiesSourceUrl(url), url);
  for (const url of [
    ACB.url.replace("hop%20nhat", "rieng"),
    "https://acb.com.vn/acbwebsite/files/arbitrary.pdf",
    ACB.url + "?token=public",
    ACB.url.replace("https://", "https://user@"),
    ACB.url.replace("acb.com.vn", "acb.com.vn.example.test"),
  ])
    assert.throws(() => validateSecuritiesSourceUrl(url), { code: "unsafe_url" });
  assert.equal(inferDiscoveredPeriod(FUTURE), "H1_2028");
});

test("ACB Next.js discovery reads exact escaped public report-card URLs and keeps future documents unreviewed", () => {
  const candidates = discoverSecuritiesDocuments(
    listing([
      post(decodeURI(ACB.url)),
      post(decodeURI(ACB.reviewedCompanion.url)),
      post(decodeURI(FUTURE)),
      post(ACB.url.replace("hop%20nhat", "rieng")),
      post("https://outside.example.test/report.pdf"),
      post(FUTURE.replace("2028", "2029"), { is_active: 0 }),
      post(FUTURE, { type: "unrelated" }),
    ]),
    ACB.landingUrl,
    "ACB",
  );
  assert.equal(candidates.length, 3);
  assert.equal(candidates.find((candidate) => candidate.url === ACB.url).status, "known");
  assert.equal(
    candidates.find((candidate) => candidate.url === ACB.reviewedCompanion.url).status,
    "discovered_requires_metadata_review",
  );
  const future = candidates.find((candidate) => candidate.url === FUTURE);
  assert.equal(future.periodId, "H1_2028");
  assert.equal(future.status, "discovered_requires_metadata_review");
  assert.equal(future.titleBasis, "issuer_listing_metadata");
  assert.equal(future.sourceId, null);
  assert.equal(future.publishedAt, null);
});

test("ACB discovery ignores unrecognized JSON paths and rejects malformed issuer listing data", () => {
  const html =
    '<html><script id="__NEXT_DATA__" type="application/json">' +
    JSON.stringify({ props: { pageProps: { blocks: [], unrelated: [post(FUTURE)] } } }) +
    "</script></html>";
  assert.deepEqual(discoverSecuritiesDocuments(html, ACB.landingUrl, "ACB"), []);
  assert.throws(
    () =>
      discoverSecuritiesDocuments(
        '<html><script id="__NEXT_DATA__">invalid</script></html>',
        ACB.landingUrl,
        "ACB",
      ),
    { code: "invalid_discovery_content" },
  );
});

test("reviewed companion hash verification deduplicates downloads and preserves unrelated future candidates", async () => {
  const candidates = [
    {
      companyId: "ACB",
      url: ACB.reviewedCompanion.url,
      status: "discovered_requires_metadata_review",
    },
    {
      companyId: "ACB",
      url: ACB.reviewedCompanion.url,
      status: "discovered_requires_metadata_review",
    },
    { companyId: "ACB", url: FUTURE, status: "discovered_requires_metadata_review" },
  ];
  let calls = 0;
  const result = await checkReviewedSecuritiesCompanions(candidates, {
    sources: [syntheticSource()],
    fetchImpl: async () => {
      calls += 1;
      return pdfResponse();
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0].status, "unchanged");
  assert.equal(result.candidates[0].status, "known_companion");
  assert.equal(result.candidates[0].periodId, "H1_2026");
  assert.equal(result.candidates[0].periodBasis, "reviewed_companion_original");
  assert.equal(result.candidates[1].status, "known_companion");
  assert.equal(result.candidates[2].status, "discovered_requires_metadata_review");
  assert.equal(result.candidates[2].companionOf, undefined);
  assert.equal(candidates[0].status, "discovered_requires_metadata_review");
});

test("reviewed companion checks reuse a source fetch already performed in the same request", async () => {
  const url = ACB.reviewedCompanion.url;
  const result = await checkReviewedSecuritiesCompanions([{ companyId: "ACB", url }], {
    sources: [syntheticSource()],
    fetchedSources: new Map([
      [url, Promise.resolve({ hash: digest(PDF), byteLength: PDF.length })],
    ]),
    fetchImpl: async () => {
      assert.fail("Duplicate companion download");
    },
  });
  assert.equal(result.candidates[0].status, "known_companion");
});

test("changed and failed reviewed companions stay visible and unreviewed", async () => {
  const candidate = { companyId: "ACB", url: ACB.reviewedCompanion.url };
  const changed = await checkReviewedSecuritiesCompanions([candidate], {
    sources: [ACB],
    fetchImpl: async () => pdfResponse(),
  });
  assert.equal(changed.checks[0].status, "changed");
  assert.equal(changed.candidates[0].status, "reviewed_companion_changed");
  assert.equal(changed.candidates[0].periodId, undefined);
  assert.equal(changed.candidates[0].periodBasis, undefined);
  const failed = await checkReviewedSecuritiesCompanions([candidate], {
    sources: [ACB],
    fetchImpl: async () => new Response("", { status: 404 }),
  });
  assert.equal(failed.checks[0].status, "failed");
  assert.equal(failed.checks[0].code, "not_found");
  assert.equal(failed.candidates[0].status, "reviewed_companion_check_failed");
});

test("cancelled companion checks propagate cancellation instead of suppressing the candidate", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    checkReviewedSecuritiesCompanions([{ companyId: "ACB", url: ACB.reviewedCompanion.url }], {
      signal: controller.signal,
      fetchImpl: async () => assert.fail("Unexpected network call"),
    }),
    { code: "cancelled" },
  );
});

test("ACB refresh checks the exact companion and exposes genuinely new periods without asserting latest-period verification", async () => {
  const dataset = getFrozenSecuritiesDatasets().find((item) => item.company.id === "ACB");
  dataset.sources[0] = { ...dataset.sources[0], ...syntheticSource() };
  const result = await refreshSecuritiesSources(
    { companyId: "ACB" },
    {
      env: { SECURITIES_DATASET_LOADER: async () => [dataset] },
      sources: [syntheticSource()],
      fetchImpl: async (url) =>
        url === ACB.landingUrl
          ? new Response(listing([post(ACB.url), post(ACB.reviewedCompanion.url), post(FUTURE)]), {
              headers: { "Content-Type": "text/html" },
            })
          : pdfResponse(),
    },
  );
  assert.equal(result.status, "changed");
  assert.equal(result.freshness.status, "new_documents_discovered");
  assert.equal(result.freshness.pendingCandidateCount, 1);
  assert.equal(result.freshness.latestMarketPeriodVerified, false);
  assert.deepEqual(
    result.discovery.newCandidates.map((candidate) => candidate.url),
    [FUTURE],
  );
  assert.equal(
    result.sourceChecks.filter((check) => check.role === "reviewed_companion").length,
    1,
  );
  assert.ok(result.sourceChecks.every((check) => check.status === "unchanged"));
});

test("a changed companion produces a revision warning even when the canonical report is unchanged", async () => {
  const dataset = getFrozenSecuritiesDatasets().find((item) => item.company.id === "ACB");
  dataset.sources[0] = { ...dataset.sources[0], ...syntheticSource() };
  const expected = syntheticSource();
  expected.reviewedCompanion.hash = "0".repeat(64);
  const result = await refreshSecuritiesSources(
    { companyId: "ACB" },
    {
      env: { SECURITIES_DATASET_LOADER: async () => [dataset] },
      sources: [expected],
      fetchImpl: async (url) =>
        url === ACB.landingUrl
          ? new Response(listing([post(ACB.url), post(ACB.reviewedCompanion.url)]), {
              headers: { "Content-Type": "text/html" },
            })
          : pdfResponse(),
    },
  );
  assert.equal(result.status, "changed");
  assert.equal(result.freshness.status, "revision_detected");
  assert.equal(result.freshness.latestMarketPeriodVerified, false);
  assert.equal(
    result.sourceChecks.find((check) => check.role === "reviewed_companion").status,
    "changed",
  );
  assert.equal(result.sourceChecks.find((check) => !check.role).status, "unchanged");
  assert.equal(result.discovery.newCandidates[0].status, "reviewed_companion_changed");
});
