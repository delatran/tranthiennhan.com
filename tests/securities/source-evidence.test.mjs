import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  createSecuritiesSourceEvidenceReader,
  SOURCE_EVIDENCE_LIMITS,
} from "../../scripts/securities/source-evidence.mjs";
import { securitiesExtractionContentSha256 } from "../../scripts/securities/source-extraction-integrity.mjs";
import {
  generateVerifiedSecuritiesFactsModule,
  readPinnedVerifiedSecuritiesFacts,
  VERIFIED_FACT_LEDGER_DESCRIPTORS,
} from "../../scripts/securities/source-verified-facts.mjs";
import { assessSecuritiesExtractionQuality } from "../../scripts/securities/source-quality.mjs";
import {
  getVerifiedSecuritiesFacts,
  getVerifiedSecuritiesLedgerManifests,
  matchVerifiedSecuritiesFact,
} from "../../shared/securities/verified-source-facts.js";
import { SECURITIES_SOURCE_DOCUMENTS } from "../../shared/securities/source-contract.js";
import {
  compareFinancialMetric,
  calculateFinancialRatio,
} from "../../shared/securities/finance.js";
import { getFrozenSecuritiesDatasets } from "../../shared/securities/catalog.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const FPT_HASH = "45636554f28c7e6c2f38458b9a22410ed1f67e80627d672b827019a67f299df8";
const GMD_HASH = "2d4c5cd550d18ec9c84a67b4d74d2f51b883c24f9398fc08df458891ec5ec4d1";

// Files below are synthetic I/O fixtures, separate from issuer evidence and QA.
async function fixture(
  t,
  { pageCount = 2, long = false, textByPage = [], sourceTemplate = {} } = {},
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "securities-evidence-test-"));
  t.after(async () => {
    const target = path.resolve(directory);
    assert.ok(target.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    assert.ok(path.basename(target).startsWith("securities-evidence-test-"));
    await rm(target, { recursive: true, force: true });
  });
  const original = Buffer.from("%PDF-1.7\nSynthetic issuer evidence fixture\n%%EOF");
  const source = {
    id: "fixture-issuer",
    companyId: "FIXTURE",
    periodId: "H1_2026",
    title: "Synthetic financial statement",
    auditStatus: "reviewed",
    scope: "consolidated",
    sourceType: "text_pdf",
    statementPages: [1],
    ...sourceTemplate,
    hash: hash(original),
    pageCount,
  };
  const pages = Array.from({ length: pageCount }, (_, index) => {
    const text =
      textByPage[index] ??
      `Synthetic page ${index + 1}\nUnit VND; current 2026, prior 2025\n` +
        (index === 0
          ? "Net cash from operating activities.\n"
          : "Liabilities and disclosure notes.\n") +
        Array.from(
          { length: long ? 90 : 8 },
          (_, line) =>
            `Row ${line}: Synthetic disclosure about cash flow and unreviewed financial amounts 100.000.000.`,
        ).join("\n");
    return {
      page: index + 1,
      method: "text",
      verified: true,
      text,
      lines: text.split("\n").map((line) => ({ text: line })),
    };
  });
  const extraction = {
    sourceHash: source.hash,
    parserVersion: "synthetic-parser-v1",
    pageCount,
    extractedAt: "2026-09-06T00:00:00.000Z",
    pages,
  };
  const bytes = JSON.stringify(extraction);
  const folder = path.join(directory, "documents", source.id, source.hash);
  await mkdir(path.join(folder, "extracted"), { recursive: true });
  const manifest = {
    id: source.id,
    companyId: source.companyId,
    hash: source.hash,
    pageCount,
    original: "original.pdf",
    parserVersion: extraction.parserVersion,
    verified: true,
  };
  await Promise.all([
    writeFile(path.join(folder, "original.pdf"), original),
    writeFile(path.join(folder, "manifest.json"), JSON.stringify(manifest)),
    writeFile(path.join(folder, "extracted/extraction.json"), bytes),
  ]);
  const create = (extractionHashes = { [source.id]: hash(bytes) }, extractionContentHashes = {}) =>
    createSecuritiesSourceEvidenceReader({
      directory,
      sources: [source],
      extractionHashes,
      extractionContentHashes,
    });
  return {
    directory,
    folder,
    source,
    extraction,
    manifest,
    create,
    read: create(),
    input: { sourceId: source.id, sourceVersion: `sha256:${source.hash}` },
  };
}

test("local evidence returns exact immutable source substrings and a recomputable receipt", async (t) => {
  const f = await fixture(t);
  const result = await f.read({ ...f.input, pages: [1] });
  assert.equal(result.source.auditStatus, "reviewed");
  assert.equal(result.source.originalVerified, true);
  assert.equal(result.coverage.fullTextVerified, false);
  assert.ok(result.passages.length > 0);
  for (const passage of result.passages) {
    const text = f.extraction.pages[passage.locator.page - 1].text;
    assert.equal(
      passage.text,
      text.slice(passage.locator.characterStart, passage.locator.characterEnd),
    );
    assert.ok(passage.text.length >= 12 && passage.text.length <= 1000);
    assert.equal(passage.verification, "extracted_unreviewed");
    assert.equal(passage.originalHash, f.source.hash);
  }
  const { receipt, ...body } = result;
  assert.equal(receipt.responseSha256, hash(JSON.stringify(body)));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= SOURCE_EVIDENCE_LIMITS.responseBytes);
  assert.deepEqual(result.verifiedFacts, []);
});

test("evidence selection rejects extra path authority, wrong versions, invalid pages and aborted reads", async (t) => {
  const f = await fixture(t);
  for (const input of [
    { ...f.input, pages: [1], path: "C:/Windows/system.ini" },
    { ...f.input, pages: [1], url: "https://example.com" },
    { ...f.input, pages: [0] },
    { ...f.input, pages: [1, 1] },
    { ...f.input, query: "a".repeat(501) },
    { ...f.input, query: "\u0000cash flow" },
    { ...f.input },
  ])
    await assert.rejects(f.read(input), { code: "invalid_evidence_input" });
  await assert.rejects(f.read({ ...f.input, pages: [3] }), { code: "source_page_out_of_range" });
  await assert.rejects(f.read({ ...f.input, sourceId: "../fixture-issuer", pages: [1] }), {
    code: "unsupported_source",
  });
  await assert.rejects(
    f.read({ ...f.input, sourceVersion: `sha256:${"a".repeat(64)}`, pages: [1] }),
    { code: "source_version_mismatch" },
  );
  await assert.rejects(f.read({ ...f.input, pages: [1] }, { signal: AbortSignal.abort() }), {
    code: "cancelled",
  });
  const literal = await f.read({ ...f.input, query: "^(a+)+$" });
  assert.equal(literal.passages.length, 0);
});

test("evidence cursors bind selection and extraction and preserve bounded follow-up coverage", async (t) => {
  const f = await fixture(t, { long: true });
  const input = { ...f.input, pages: [1], limit: 1 };
  const first = await f.read(input);
  assert.equal(first.coverage.truncated, true);
  const next = await f.read({ ...input, cursor: first.coverage.nextCursor });
  assert.notEqual(first.passages[0].id, next.passages[0].id);
  await assert.rejects(f.read({ ...input, pages: [2], cursor: first.coverage.nextCursor }), {
    code: "invalid_evidence_cursor",
  });
  await assert.rejects(f.read({ ...input, cursor: "not-json" }), {
    code: "invalid_evidence_cursor",
  });
});

test("bilingual accounting queries prioritize the requested note and match acronym boundaries", async (t) => {
  const f = await fixture(t, {
    pageCount: 3,
    textByPage: [
      "Introductory financial disclosure.\nThis financial report contains the cash flow statement and an investment disposal disclosure. ".repeat(
        3,
      ),
      "Unit VND; current and prior periods.\nLưu chuyển tiền thuần từ hoạt động kinh doanh.\nLợi nhuận sau thuế của cổ đông không kiểm soát. ".repeat(
        3,
      ),
      "Unit VND; current and prior periods.\nLãi chuyển nhượng khoản đầu tư tài chính dài hạn.\nThe exact amount requires separate visual verification. ".repeat(
        3,
      ),
    ],
  });
  for (const [query, expectedPage] of [
    ["cash flow operating activities", 2],
    ["NCI", 2],
    ["disposal investment", 3],
  ]) {
    const result = await f.read({ ...f.input, query, limit: 1 });
    assert.equal(result.passages[0].locator.page, expectedPage);
  }
  const nci = await f.read({ ...f.input, query: "NCI", pages: [1] });
  assert.equal(nci.passages.length, 0);
});

test("corrupted originals, extraction, manifest identity and plausible cropped pages fail closed", async (t) => {
  const f = await fixture(t);
  const originalPath = path.join(f.folder, "original.pdf");
  const original = await readFile(originalPath);
  await writeFile(originalPath, Buffer.concat([original, Buffer.from("changed")]));
  await assert.rejects(f.read({ ...f.input, pages: [1] }), { code: "source_evidence_corrupted" });
  await writeFile(originalPath, original);
  await writeFile(
    path.join(f.folder, "manifest.json"),
    JSON.stringify({ ...f.manifest, companyId: "OTHER" }),
  );
  await assert.rejects(f.read({ ...f.input, pages: [1] }), { code: "source_evidence_corrupted" });
  await writeFile(path.join(f.folder, "manifest.json"), JSON.stringify(f.manifest));
  const cropped = JSON.stringify({ ...f.extraction, pages: f.extraction.pages.slice(0, 1) });
  await writeFile(path.join(f.folder, "extracted/extraction.json"), cropped);
  await assert.rejects(f.read({ ...f.input, pages: [1] }), { code: "source_evidence_corrupted" });
  const readerWithNewHash = f.create({ [f.source.id]: hash(cropped) });
  await assert.rejects(readerWithNewHash({ ...f.input, pages: [1] }), {
    code: "source_evidence_corrupted",
  });
});

test("recollected extraction accepts a fresh timestamp and records its actual file hash", async (t) => {
  const f = await fixture(t, { long: true });
  const read = f.create(undefined, {
    [f.source.id]: securitiesExtractionContentSha256(f.extraction),
  });
  const input = { ...f.input, pages: [1], limit: 1 };
  const original = await read(input);
  const recollected = JSON.stringify(
    { ...f.extraction, extractedAt: "2026-09-07T00:00:00.000Z" },
    null,
    2,
  );
  await writeFile(path.join(f.folder, "extracted/extraction.json"), recollected);
  const result = await read(input);
  assert.equal(result.receipt.extractionFileSha256, hash(recollected));
  assert.notEqual(result.receipt.extractionFileSha256, original.receipt.extractionFileSha256);
  assert.equal(result.passages[0].text, original.passages[0].text);
  assert.equal(result.passages[0].verification, "extracted_unreviewed");
  await assert.rejects(read({ ...input, cursor: original.coverage.nextCursor }), {
    code: "invalid_evidence_cursor",
  });
});

test("the content pin rejects changed source, text, coordinates, page order and parser identity", async (t) => {
  const f = await fixture(t);
  const read = f.create(undefined, {
    [f.source.id]: securitiesExtractionContentSha256(f.extraction),
  });
  const mutations = [
    (value) => {
      value.sourceHash = "a".repeat(64);
    },
    (value) => {
      value.pages[0].text = value.pages[0].text.replace("100.000.000", "900.000.000");
    },
    (value) => {
      value.pages[0].lines[0].items = [{ text: "Synthetic page 1", x: 99, width: 100 }];
    },
    (value) => {
      value.pages.reverse();
    },
    (value) => {
      value.parserVersion = "changed-parser";
    },
    (value) => {
      value.pages[0].extractedAt = "A nested field is part of the content";
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(f.extraction);
    changed.extractedAt = "2026-09-07T00:00:00.000Z";
    mutate(changed);
    await writeFile(path.join(f.folder, "extracted/extraction.json"), JSON.stringify(changed));
    await writeFile(
      path.join(f.folder, "manifest.json"),
      JSON.stringify({ ...f.manifest, parserVersion: changed.parserVersion }),
    );
    await assert.rejects(read({ ...f.input, pages: [1] }), { code: "source_evidence_corrupted" });
  }
});

// A minimal distribution carries the real reader code and generated fact module,
// with only source/render hash pins replaced for this synthetic corpus. It has
// neither the private generator nor review ledgers, and uses no issuer files.
async function distributedFixture(t) {
  const sourceTemplate = SECURITIES_SOURCE_DOCUMENTS.find((source) => source.id === "fpt-h1-2026");
  const f = await fixture(t, { pageCount: sourceTemplate.pageCount, sourceTemplate });
  const checkout = path.join(f.directory, "checkout");
  const scriptDirectory = path.join(checkout, "scripts/securities");
  const sharedDirectory = path.join(checkout, "shared/securities");
  await mkdir(scriptDirectory, { recursive: true });
  await mkdir(sharedDirectory, { recursive: true });
  await writeFile(path.join(checkout, "package.json"), '{"type":"module"}');
  for (const name of [
    "source-evidence.mjs",
    "source-quality.mjs",
    "source-layout.mjs",
    "source-fact-reader.mjs",
    "source-extraction-integrity.mjs",
  ]) {
    const content = await readFile(new URL(`../../scripts/securities/${name}`, import.meta.url));
    await writeFile(path.join(scriptDirectory, name), content);
  }
  const contract = await readFile(
    new URL("../../shared/securities/source-contract.js", import.meta.url),
    "utf8",
  );
  await writeFile(
    path.join(sharedDirectory, "source-contract.js"),
    contract.replaceAll(FPT_HASH, f.source.hash),
  );
  let canonical = await readFile(
    new URL("../../shared/securities/verified-source-facts.js", import.meta.url),
    "utf8",
  );
  canonical = canonical.replaceAll(FPT_HASH, f.source.hash);
  const facts = getVerifiedSecuritiesFacts({
    sourceId: f.source.id,
    sourceVersion: `sha256:${FPT_HASH}`,
  });
  const renders = new Map();
  for (const fact of facts) {
    const bytes = Buffer.from(`Synthetic reviewed page ${fact.locator.page}; no issuer evidence.`);
    renders.set(fact.locator.page, bytes);
    canonical = canonical.replaceAll(fact.verificationReceipt.renderSha256, hash(bytes));
  }
  // Page 18 is intentionally missing until the test supplies its pinned bytes.
  await writeFile(path.join(f.folder, "extracted/page-13.png"), renders.get(13));
  await writeFile(path.join(sharedDirectory, "verified-source-facts.js"), canonical);
  const { createSecuritiesSourceEvidenceReader: create } = await import(
    pathToFileURL(path.join(scriptDirectory, "source-evidence.mjs")).href
  );
  const extractionBytes = await readFile(path.join(f.folder, "extracted/extraction.json"));
  return {
    ...f,
    checkout,
    renders,
    read: create({
      directory: f.directory,
      sources: [f.source],
      extractionHashes: { [f.source.id]: hash(extractionBytes) },
      extractionContentHashes: {},
    }),
  };
}

test("a clean distribution reads committed facts without a private generator or QA ledger", async (t) => {
  const f = await distributedFixture(t);
  await assert.rejects(
    readFile(path.join(f.checkout, "scripts/securities/source-verified-facts.mjs")),
    { code: "ENOENT" },
  );
  await assert.rejects(
    readFile(
      path.join(
        f.directory,
        "output/securities/ux-rework/qa",
        VERIFIED_FACT_LEDGER_DESCRIPTORS[0].fileName,
      ),
    ),
    { code: "ENOENT" },
  );
  const result = await f.read({ ...f.input, pages: [13] });
  assert.deepEqual(
    result.verifiedFacts.map((fact) => fact.factId),
    ["fpt-h1-cfo-current", "fpt-h1-cfo-prior-reported"],
  );
  assert.ok(
    result.verifiedFacts.every(
      (fact) => fact.sourceHash === f.source.hash && fact.locator.page === 13,
    ),
  );
  assert.ok(result.passages.every((passage) => passage.verification === "extracted_unreviewed"));
  assert.equal(result.receipt.verifiedLedgerHashes.length, 1);
  const outsideReviewedPage = await f.read({ ...f.input, pages: [1] });
  assert.deepEqual(outsideReviewedPage.verifiedFacts, []);
});

test("distributed facts still reject missing or changed rendered pages and changed originals", async (t) => {
  const f = await distributedFixture(t);
  await assert.rejects(f.read({ ...f.input, pages: [18] }), { code: "source_evidence_corrupted" });
  await writeFile(path.join(f.folder, "extracted/page-18.png"), f.renders.get(18));
  assert.equal((await f.read({ ...f.input, pages: [18] })).verifiedFacts.length, 3);
  await writeFile(path.join(f.folder, "extracted/page-18.png"), Buffer.from("Changed render"));
  await assert.rejects(f.read({ ...f.input, pages: [18] }), { code: "source_evidence_corrupted" });
  await writeFile(
    path.join(f.folder, "original.pdf"),
    Buffer.from("%PDF-1.7\nChanged original\n%%EOF"),
  );
  await assert.rejects(f.read({ ...f.input, pages: [13] }), { code: "source_evidence_corrupted" });
});

test("fact regeneration requires explicit independent QA and rejects fabricated ledger bytes", async (t) => {
  await assert.rejects(
    generateVerifiedSecuritiesFactsModule({ check: true }),
    /verified_source_fact_review_directory_required/u,
  );
  const f = await fixture(t);
  const qaDirectory = path.join(f.directory, "synthetic-review");
  await mkdir(qaDirectory);
  const descriptor = VERIFIED_FACT_LEDGER_DESCRIPTORS[0];
  await writeFile(path.join(qaDirectory, descriptor.fileName), '{"cells":[]}');
  await writeFile(path.join(qaDirectory, descriptor.proofFileName), '{"status":"passed"}');
  await assert.rejects(
    readPinnedVerifiedSecuritiesFacts(
      { sourceId: "fpt-h1-2026", sourceHash: FPT_HASH },
      { directory: f.directory, qaDirectory },
    ),
    /verified_source_fact_hash_mismatch/u,
  );
});

test("quality distinguishes extracted pages, known failed regions and verified cells", () => {
  const text = "Synthetic readable source paragraph. ".repeat(8);
  const result = assessSecuritiesExtractionQuality(
    {
      sourceHash: GMD_HASH,
      pageCount: 63,
      pages: [
        { page: 11, method: "ocr", ocrConfidence: 90, text, verified: true },
        { page: 62, method: "ocr", ocrConfidence: 49, text, verified: true },
      ],
    },
    { materialCellsVerified: true, materialPages: [11] },
  );
  assert.deepEqual(result.pagesWithoutUsableText, [62]);
  assert.equal(result.pageQuality[0].reviewedNumericCellsOnly, true);
  assert.equal(result.pageQuality[0].status, "extracted_unreviewed");
  assert.equal(result.fullTextVerified, false);
});

test("canonical supplemental facts cannot be forged or changed through returned objects", () => {
  const input = { sourceId: "fpt-h1-2026", sourceVersion: `sha256:${FPT_HASH}` };
  const facts = getVerifiedSecuritiesFacts(input);
  assert.equal(facts.length, 5);
  const valid = structuredClone(facts[0]);
  assert.deepEqual(matchVerifiedSecuritiesFact(valid), valid);
  for (const changed of [
    { ...valid, value: "1" },
    { ...valid, basisId: "other" },
    { ...valid, sourceHash: GMD_HASH },
    { ...valid, extra: true },
    { ...valid, verificationReceipt: { ...valid.verificationReceipt, sha256: "a".repeat(64) } },
  ])
    assert.equal(matchVerifiedSecuritiesFact(changed), null);
  facts[0].value = "1";
  facts[0].label.vi = "Changed";
  facts[0].locator.page = 1;
  const manifests = getVerifiedSecuritiesLedgerManifests();
  manifests[0].sha256 = "a".repeat(64);
  assert.deepEqual(getVerifiedSecuritiesFacts(input)[0], valid);
  assert.notEqual(getVerifiedSecuritiesLedgerManifests()[0].sha256, manifests[0].sha256);
  assert.deepEqual(
    getVerifiedSecuritiesFacts({ ...input, sourceVersion: `sha256:${GMD_HASH}` }),
    [],
  );
});

test("reviewed CFO and NCI preserve signs and accounting basis; a prior disposal dash stays missing", () => {
  const facts = getVerifiedSecuritiesFacts({
    sourceId: "fpt-h1-2026",
    sourceVersion: `sha256:${FPT_HASH}`,
  });
  const cfo = {
    id: "operating_cash_flow",
    unit: "VND",
    current: facts.find((fact) => fact.factId === "fpt-h1-cfo-current"),
    comparison: facts.find((fact) => fact.factId === "fpt-h1-cfo-prior-reported"),
  };
  assert.equal(cfo.current.value, "-1145666005788");
  assert.equal(compareFinancialMetric(cfo).relativeChangePct.status, "incompatible_basis");
  const dataset = getFrozenSecuritiesDatasets().find(
    (entry) => entry.period.id === "H1_2026" && entry.comparisonPeriod.id === "H1_2025_restated",
  );
  const pat = dataset.metrics.find((metric) => metric.id === "profit_after_tax");
  assert.equal(calculateFinancialRatio(cfo, pat).status, "ok");
  assert.ok(calculateFinancialRatio(cfo, pat).value < 0);
  const nci = {
    id: "profit_noncontrolling",
    unit: "VND",
    current: facts.find((fact) => fact.factId === "fpt-h1-nci-current"),
    comparison: facts.find((fact) => fact.factId === "fpt-h1-nci-prior-restated"),
  };
  assert.equal(compareFinancialMetric(nci).relativeChangePct.status, "base_negative");
  assert.equal(compareFinancialMetric(nci).absoluteChange.exact, "-3528114582");
  const disposal = getVerifiedSecuritiesFacts({
    sourceId: "gmd-h1-2026",
    sourceVersion: `sha256:${GMD_HASH}`,
  });
  assert.equal(disposal.find((fact) => fact.side === "comparison").value, null);
  assert.equal(disposal.find((fact) => fact.side === "comparison").rawText, "-");
});
