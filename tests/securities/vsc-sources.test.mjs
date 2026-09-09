import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  buildSecuritiesDataset,
  getFrozenSecuritiesDatasets,
  getReviewedSecuritiesSourceCells,
  resolveScopeFromDatasets,
  VERIFIED_CELLS_DIGESTS,
} from "../../shared/securities/catalog.js";
import {
  SECURITIES_SOURCE_DOCUMENTS,
  sourceIssuerForUrl,
  validateSecuritiesSourceUrl,
} from "../../shared/securities/source-contract.js";
import { compareFinancialMetric } from "../../shared/securities/finance.js";
import { discoverSecuritiesDocuments } from "../../worker/securities/sources.js";
import { validateCandidateOriginal } from "../../scripts/securities/source-candidates.mjs";
import { cellsDigest } from "../../scripts/securities/source-extract.mjs";
import { assessSecuritiesPageQuality } from "../../scripts/securities/source-quality.mjs";
import { verifyLocalSecuritiesSourceEvidence } from "../../scripts/securities/source-evidence.mjs";

const VSC = SECURITIES_SOURCE_DOCUMENTS.find((source) => source.id === "vsc-h1-2026");
const hash = (value) => createHash("sha256").update(value).digest("hex");

test("VSC reviewed cells retain issuer, period, exact VND precision and the negative CFO comparison base", () => {
  const vsc = getFrozenSecuritiesDatasets().find((dataset) => dataset.company.id === "VSC");
  const gmd = getFrozenSecuritiesDatasets().find((dataset) => dataset.company.id === "GMD");
  assert.equal(vsc.company.sectorId, "ports_logistics");
  assert.equal(gmd.company.sectorId, vsc.company.sectorId);
  assert.equal(vsc.metrics.length, 8);
  assert.equal(vsc.sources[0].auditStatus, "reviewed");
  assert.equal(vsc.period.id, "H1_2026");
  assert.equal(vsc.comparisonPeriod.id, "H1_2025");
  const revenue = vsc.metrics.find((metric) => metric.id === "revenue");
  assert.equal(revenue.current.value, "1721819.309583");
  assert.equal(revenue.comparison.value, "1489029.514792");
  assert.equal(revenue.current.entityId, "VSC");
  assert.equal(revenue.current.sourceVersion, `sha256:${VSC.hash}`);
  assert.equal(revenue.current.locator.page, 12);
  assert.equal(revenue.current.locator.printedPage, "8");
  const cfo = vsc.metrics.find((metric) => metric.id === "operating_cash_flow");
  assert.equal(cfo.current.value, "364275.715936");
  assert.equal(cfo.comparison.value, "-445314.319497");
  assert.equal(cfo.current.locator.page, 13);
  assert.equal(cfo.current.locator.table, "Báo cáo lưu chuyển tiền tệ hợp nhất");
  const change = compareFinancialMetric(cfo, vsc);
  assert.equal(change.absoluteChange.status, "ok");
  assert.equal(change.absoluteChange.exact, "809590.035433");
  assert.equal(change.relativeChangePct.status, "base_negative");
  assert.equal(change.relativeChangePct.value, null);
  const gmdCfo = gmd.metrics.find((metric) => metric.id === "operating_cash_flow");
  assert.equal(gmdCfo.current.value, "1023998.149944");
  assert.equal(gmdCfo.comparison.value, "1090272.860986");
  assert.equal(gmdCfo.current.locator.page, 12);
  assert.equal(gmdCfo.current.locator.printedPage, "11");
  assert.ok(vsc.evidenceNotes.every((note) => note.sourceId === VSC.id));
  assert.ok(vsc.evidenceNotes.every((note) => !note.id.startsWith("annual-")));
  const context = vsc.evidenceNotes.find((note) => note.id === "vsc-cfo-trading-securities");
  assert.equal(context.sourceVersion, `sha256:${VSC.hash}`);
  assert.equal(context.locator.page, 13);
  assert.equal(context.locator.rowCode, "13");
  assert.equal(context.quote, "Giảm/(tăng) chứng khoán kinh doanh");
  const changedSource = buildSecuritiesDataset(
    { ...VSC, hash: "f".repeat(64) },
    getReviewedSecuritiesSourceCells(VSC.id, VSC.hash).cells,
    { verified: true },
  );
  assert.deepEqual(changedSource.evidenceNotes, []);
});

test("VSC issuer aliases resolve independently and unsupported periods do not fall back", () => {
  for (const query of ["VSC", "Viconship", "Container Việt Nam H1 2026"])
    assert.equal(resolveScopeFromDatasets({ query }).companyId, "VSC");
  assert.equal(resolveScopeFromDatasets({ query: "FPT" }).companyId, "FPT");
  assert.throws(() => resolveScopeFromDatasets({ query: "FPT và VSC" }), {
    code: "ambiguous_company",
  });
  assert.throws(() => resolveScopeFromDatasets({ query: "VSC FY2025" }), {
    code: "unsupported_period",
  });
});

test("VSC discovery only accepts the official issuer family and consolidated reports", () => {
  assert.equal(sourceIssuerForUrl(VSC.url), "VSC");
  const separate = VSC.url.replace("hop-nhat", "rieng");
  const html = `<a href="${VSC.url}">Hợp nhất</a><a href="${separate}">Riêng</a>`;
  const candidates = discoverSecuritiesDocuments(html, VSC.landingUrl, "VSC");
  assert.deepEqual(
    candidates.map((candidate) => candidate.url),
    [VSC.url],
  );
  assert.equal(candidates[0].sourceId, VSC.id);
  for (const url of [
    VSC.url.replace("viconship.com", "viconship.com.example.org"),
    VSC.url.replace("https:", "http:"),
    VSC.url + "?next=http://127.0.0.1",
    "https://viconship.com/wp-admin/export.php",
  ])
    assert.throws(() => validateSecuritiesSourceUrl(url), { code: "unsafe_url" });
  const candidate = {
    companyId: "VSC",
    periodId: "H1_2027",
    url: VSC.url.replaceAll("2026", "2027"),
  };
  const extraction = {
    pages: [
      {
        page: 1,
        text: "CÔNG TY CỔ PHẦN CONTAINER VIỆT NAM\nBÁO CÁO TÀI CHÍNH HỢP NHẤT\nCho kỳ sáu tháng kết thúc ngày 30 tháng 6 năm 2027",
      },
    ],
  };
  assert.equal(
    validateCandidateOriginal(candidate, extraction).status,
    "original_metadata_requires_review",
  );
  extraction.pages[0].text = extraction.pages[0].text.replace(
    "CONTAINER VIỆT NAM",
    "CONTAINER VIỆT NAM HẢI PHÒNG",
  );
  assert.throws(() => validateCandidateOriginal(candidate, extraction), {
    code: "candidate_identity_unconfirmed",
  });
});

test("VSC transcriptions and OCR issue observations remain bound to their exact source", () => {
  const review = getReviewedSecuritiesSourceCells(VSC.id, VSC.hash);
  assert.equal(cellsDigest(review.cells), VERIFIED_CELLS_DIGESTS[VSC.id]);
  assert.deepEqual(Object.keys(review.pageRenderHashes), ["12", "13"]);
  assert.equal(getReviewedSecuritiesSourceCells(VSC.id, "f".repeat(64)), null);
  assert.equal(getReviewedSecuritiesSourceCells("gmd-h1-2026", VSC.hash), null);
  review.cells[0].rawCurrent = "1.000.000";
  assert.equal(
    getReviewedSecuritiesSourceCells(VSC.id, VSC.hash).cells[0].rawCurrent,
    "1.721.819.309.583",
  );
  const page = { page: 12, method: "ocr", ocrConfidence: 99, text: "Synthetic text. ".repeat(20) };
  assert.ok(
    assessSecuritiesPageQuality(page, { sourceHash: VSC.hash }).qualityFlags.includes(
      "known_numeric_ocr_error",
    ),
  );
  assert.ok(
    !assessSecuritiesPageQuality(page, { sourceHash: "f".repeat(64) }).qualityFlags.includes(
      "known_numeric_ocr_error",
    ),
  );
});

test("reviewed-cell reader fixture rejects changed originals and material render bytes", async (t) => {
  // Synthetic I/O corpus exercises the production reader without private issuer or review files.
  const directory = await mkdtemp(path.join(os.tmpdir(), "securities-reviewed-cell-test-"));
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(directory).startsWith("securities-reviewed-cell-test-"));
    await rm(directory, { recursive: true, force: true });
  });
  const original = Buffer.from("Synthetic original, not financial evidence");
  const render = Buffer.from("Synthetic page render, not financial evidence");
  const cells = [
    { id: "revenue", page: 12, rowCode: "10", rawCurrent: "1.000.000", rawComparison: "900.000" },
  ];
  const source = { id: "fixture-review", hash: hash(original) };
  const review = {
    sourceId: source.id,
    sourceHash: source.hash,
    cellsDigest: cellsDigest(cells),
    pageRenderHashes: { 12: hash(render) },
    cells,
  };
  await mkdir(path.join(directory, "extracted"));
  await writeFile(path.join(directory, "original.pdf"), original);
  await writeFile(path.join(directory, "extracted", "page-12.png"), render);
  const catalogFile = path.join(directory, "fixture-catalog.mjs");
  await writeFile(
    catalogFile,
    `const review = ${JSON.stringify(review)}; export const VERIFIED_CELLS_DIGESTS = { [review.sourceId]: review.cellsDigest }; export function getReviewedSecuritiesSourceCells(id, hash) { return id === review.sourceId && hash === review.sourceHash ? structuredClone(review) : null; }`,
  );
  const readerFile = path.join(directory, "source-reviewed-cells.mjs");
  const readerSource = (
    await readFile(
      new URL("../../scripts/securities/source-reviewed-cells.mjs", import.meta.url),
      "utf8",
    )
  )
    .replace(
      '"../../shared/securities/catalog.js"',
      JSON.stringify(pathToFileURL(catalogFile).href),
    )
    .replace(
      '"./source-extract.mjs"',
      JSON.stringify(new URL("../../scripts/securities/source-extract.mjs", import.meta.url).href),
    );
  await writeFile(readerFile, readerSource);
  const { readReviewedSecuritiesStatementCells } = await import(pathToFileURL(readerFile).href);
  assert.deepEqual(
    (await readReviewedSecuritiesStatementCells(source, { directory })).cells,
    cells,
  );
  assert.equal(
    await readReviewedSecuritiesStatementCells({ ...source, hash: "f".repeat(64) }, { directory }),
    null,
  );
  await writeFile(path.join(directory, "extracted", "page-12.png"), "Changed render");
  await assert.rejects(
    readReviewedSecuritiesStatementCells(source, { directory }),
    /reviewed_cell_artifact_hash_mismatch/u,
  );
  await writeFile(path.join(directory, "extracted", "page-12.png"), render);
  await writeFile(path.join(directory, "original.pdf"), "Changed original");
  await assert.rejects(
    readReviewedSecuritiesStatementCells(source, { directory }),
    /reviewed_cell_artifact_hash_mismatch/u,
  );
});

test("scoped offline evidence checks reject unknown, empty and duplicate source selections", async () => {
  for (const sourceIds of [[], ["unsupported"], [VSC.id, VSC.id], "vsc-h1-2026"])
    await assert.rejects(verifyLocalSecuritiesSourceEvidence({ sourceIds }), {
      code: "invalid_evidence_source_selection",
    });
});
