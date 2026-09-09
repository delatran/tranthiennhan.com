import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SECURITIES_SOURCE_DOCUMENTS } from "../../shared/securities/source-contract.js";
import { assessSecuritiesExtractionQuality, SOURCE_QUALITY_VERSION } from "./source-quality.mjs";
import {
  buildSecuritiesProseReference,
  SECURITIES_PROSE_REFERENCE_VERSION,
} from "./source-layout.mjs";
import { readVerifiedSecuritiesSourceFacts } from "./source-fact-reader.mjs";
import {
  SECURITIES_EXTRACTION_PINS,
  securitiesExtractionContentSha256,
} from "./source-extraction-integrity.mjs";
import {
  getVerifiedSecuritiesFacts,
  matchVerifiedSecuritiesFact,
} from "../../shared/securities/verified-source-facts.js";

export const SOURCE_EVIDENCE_VERSION = "securities-local-evidence-v1";
export const SOURCE_EVIDENCE_LIMITS = Object.freeze({
  queryCharacters: 500,
  pages: 6,
  passages: 12,
  responseBytes: 32_000,
  manifestBytes: 128_000,
  extractionBytes: 12_000_000,
  originalBytes: 20 * 1024 * 1024,
});

const SOURCE_DIRECTORY = fileURLToPath(
  new URL("../../../output/securities/sources/", import.meta.url),
);
const EXTRACTION_HASHES = Object.freeze(
  Object.fromEntries(
    Object.entries(SECURITIES_EXTRACTION_PINS).map(([sourceId, pin]) => [sourceId, pin.fileSha256]),
  ),
);
const EXTRACTION_CONTENT_HASHES = Object.freeze(
  Object.fromEntries(
    Object.entries(SECURITIES_EXTRACTION_PINS).map(([sourceId, pin]) => [
      sourceId,
      pin.contentSha256,
    ]),
  ),
);
const HASH = /^[a-f0-9]{64}$/u;
const INPUT_KEYS = new Set(["sourceId", "sourceVersion", "query", "pages", "cursor", "limit"]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fold = (value) =>
  String(value).normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/gu, "d").toLowerCase();
const ALIASES = Object.freeze([
  [
    "cash flow",
    "cashflow",
    "operating cash",
    "operating activities",
    "cfo",
    "luu chuyen tien",
    "dong tien",
    "luu chuyen tien thuan",
    "luu chuyen tien tu hoat dong kinh doanh",
    "net cash from operating activities",
  ],
  [
    "non controlling",
    "noncontrolling",
    "nci",
    "khong kiem soat",
    "loi nhuan sau thue cua co dong khong kiem soat",
    "profit attributable to non controlling interests",
  ],
  ["segment", "segments", "bo phan", "linh vuc kinh doanh"],
  ["equity method", "von chu so huu", "ftel"],
  [
    "disposal",
    "divestment",
    "chuyen nhuong",
    "thoai von",
    "disposal gain",
    "lai chuyen nhuong",
    "long term financial investment",
    "dau tu tai chinh dai han",
  ],
  ["cash and cash equivalents", "tien va cac khoan tuong duong tien", "tien va tuong duong tien"],
  ["current liabilities", "no ngan han"],
  ["borrowings", "debt", "vay", "no thue tai chinh"],
]);

export class SourceEvidenceError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "SourceEvidenceError";
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status = 400) => {
  throw new SourceEvidenceError(code, status);
};
function aborted(signal) {
  if (signal?.aborted) fail("cancelled", 409);
}

function parseInput(value, sources) {
  if (
    !plain(value) ||
    Object.keys(value).some((key) => !INPUT_KEYS.has(key)) ||
    typeof value.sourceId !== "string" ||
    typeof value.sourceVersion !== "string"
  )
    fail("invalid_evidence_input");
  const source = sources.find((entry) => entry.id === value.sourceId);
  if (!source) fail("unsupported_source", 404);
  if (value.sourceVersion !== `sha256:${source.hash}`) fail("source_version_mismatch", 409);
  if (
    value.query !== undefined &&
    (typeof value.query !== "string" ||
      value.query.length > SOURCE_EVIDENCE_LIMITS.queryCharacters ||
      /[\u0000-\u001f\u007f]/u.test(value.query))
  )
    fail("invalid_evidence_input");
  const query = value.query?.trim() ?? "";
  const pages = value.pages ?? [];
  if (
    !Array.isArray(pages) ||
    pages.length > SOURCE_EVIDENCE_LIMITS.pages ||
    pages.some((page) => !Number.isSafeInteger(page) || page < 1) ||
    new Set(pages).size !== pages.length
  )
    fail("invalid_evidence_input");
  if (pages.some((page) => page > source.pageCount)) fail("source_page_out_of_range", 422);
  if (!query && pages.length === 0) fail("invalid_evidence_input");
  const limit = value.limit ?? 8;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > SOURCE_EVIDENCE_LIMITS.passages)
    fail("invalid_evidence_input");
  if (
    value.cursor !== undefined &&
    (typeof value.cursor !== "string" ||
      value.cursor.length > 512 ||
      !/^[a-zA-Z0-9_-]+$/u.test(value.cursor))
  )
    fail("invalid_evidence_cursor");
  return { source, query, pages: [...pages].sort((a, b) => a - b), limit, cursor: value.cursor };
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

async function trackedFile(root, file, maxBytes, signal) {
  aborted(signal);
  try {
    const resolved = await realpath(file);
    if (!inside(root, resolved)) fail("source_evidence_corrupted", 409);
    const info = await stat(resolved);
    if (!info.isFile() || info.size < 1 || info.size > maxBytes)
      fail("source_evidence_corrupted", 409);
    const bytes = await readFile(resolved, { signal });
    if (bytes.length !== info.size || bytes.length > maxBytes)
      fail("source_evidence_corrupted", 409);
    return bytes;
  } catch (error) {
    aborted(signal);
    if (error instanceof SourceEvidenceError) throw error;
    fail("source_evidence_unavailable", 503);
  }
}

function parsedJson(bytes) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("source_evidence_corrupted", 409);
  }
}

async function loadOriginal(
  directory,
  source,
  expectedFileHash,
  expectedContentHash,
  signal,
  maximumOriginalBytes,
) {
  let root;
  let folder;
  try {
    root = await realpath(directory);
    folder = await realpath(path.join(root, "documents", source.id, source.hash));
  } catch {
    fail("source_evidence_unavailable", 503);
  }
  if (!inside(root, folder)) fail("source_evidence_corrupted", 409);
  const [manifestBytes, originalBytes, extractionBytes] = await Promise.all([
    trackedFile(
      folder,
      path.join(folder, "manifest.json"),
      SOURCE_EVIDENCE_LIMITS.manifestBytes,
      signal,
    ),
    trackedFile(
      folder,
      path.join(folder, "original.pdf"),
      maximumOriginalBytes ?? SOURCE_EVIDENCE_LIMITS.originalBytes,
      signal,
    ),
    trackedFile(
      folder,
      path.join(folder, "extracted", "extraction.json"),
      SOURCE_EVIDENCE_LIMITS.extractionBytes,
      signal,
    ),
  ]);
  const manifest = parsedJson(manifestBytes);
  const extraction = parsedJson(extractionBytes);
  const extractionHash = sha256(extractionBytes);
  if (!plain(manifest) || !plain(extraction)) fail("source_evidence_corrupted", 409);
  if (
    sha256(originalBytes) !== source.hash ||
    (extractionHash !== expectedFileHash &&
      (!expectedContentHash ||
        securitiesExtractionContentSha256(extraction) !== expectedContentHash)) ||
    manifest.id !== source.id ||
    manifest.companyId !== source.companyId ||
    manifest.hash !== source.hash ||
    manifest.pageCount !== source.pageCount ||
    manifest.original !== "original.pdf" ||
    manifest.parserVersion !== extraction.parserVersion ||
    extraction.sourceHash !== source.hash ||
    extraction.pageCount !== source.pageCount ||
    !Array.isArray(extraction.pages) ||
    extraction.pages.length !== source.pageCount ||
    extraction.pages.some(
      (page, index) =>
        page.page !== index + 1 ||
        typeof page.text !== "string" ||
        page.text.length > 100_000 ||
        !Array.isArray(page.lines),
    )
  )
    fail("source_evidence_corrupted", 409);
  return { manifest, extraction, extractionHash, manifestHash: sha256(manifestBytes) };
}

function lineRanges(text) {
  const result = [];
  let offset = 0;
  for (const value of text.split("\n")) {
    result.push({ start: offset, end: offset + value.length, text: value });
    offset += value.length + 1;
  }
  return result;
}

function chunkText(text, locator, representation) {
  const lines = lineRanges(text);
  const chunks = [];
  for (let first = 0; first < lines.length;) {
    let last = first;
    while (last + 1 < lines.length && lines[last + 1].end - lines[first].start <= 1000) last += 1;
    const begin = lines[first].start;
    const end = lines[last].end;
    // Long source lines remain exact substrings with offsets; no ellipsis is
    // inserted into quoted source text and no text is silently discarded.
    for (let start = begin; start < end; start += 1000) {
      const stop = Math.min(start + 1000, end);
      const excerpt = text.slice(start, stop);
      if (excerpt.trim().length >= 12)
        chunks.push({
          text: excerpt,
          locator: {
            ...locator,
            lineStart: first + 1,
            lineEnd: last + 1,
            characterStart: start,
            characterEnd: stop,
            precision: "passage",
            representation,
          },
          boundaries: {
            continuesBefore: start > 0,
            continuesAfter: stop < text.length,
            splitsLongSourceLine: end - begin > 1000,
            shortFragmentsMayBeOmitted: true,
          },
          representationVersion:
            representation === "canonical_page_text"
              ? SOURCE_EVIDENCE_VERSION
              : SECURITIES_PROSE_REFERENCE_VERSION,
        });
    }
    first = last + 1;
  }
  return chunks;
}

function indexExtraction(extraction, quality) {
  const chunks = [];
  const prose = buildSecuritiesProseReference(extraction);
  for (const page of extraction.pages) {
    const pageQuality = quality.pageQuality[page.page - 1];
    if (pageQuality.status === "unusable") continue;
    const locator = { page: page.page };
    const canonical = chunkText(page.text, locator, "canonical_page_text");
    // Canonical rows are always retained. Supplemental columns are additional
    // exact-coordinate views for prose, never replacements for financial rows.
    const columns =
      page.method === "text"
        ? prose.blocks.filter(
            (block) => block.page === page.page && Number.isSafeInteger(block.column),
          )
        : [];
    const supplemental = columns.flatMap((block) =>
      chunkText(
        block.text,
        { ...locator, column: block.column, region: block.region },
        "coordinate_prose",
      ),
    );
    const header = page.text.slice(0, Math.min(page.text.length, 1000));
    for (const chunk of [...canonical, ...supplemental]) {
      const id = `evidence-${sha256(JSON.stringify({ sourceHash: extraction.sourceHash, locator: chunk.locator, text: chunk.text })).slice(0, 32)}`;
      chunks.push({
        id,
        ...chunk,
        extractionMethod: page.method,
        verification: "extracted_unreviewed",
        qualityFlags: pageQuality.qualityFlags,
        pageHeader: {
          text: header,
          locator: {
            page: page.page,
            characterStart: 0,
            characterEnd: header.length,
            representation: "canonical_page_text",
            precision: "passage",
          },
        },
      });
    }
  }
  return { chunks, representationHash: sha256(JSON.stringify(chunks)) };
}

function termsForQuery(query) {
  const normalized = fold(query)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const phrases = new Set(normalized.length >= 3 ? [normalized] : []);
  for (const group of ALIASES)
    if (group.some((term) => ` ${normalized} `.includes(` ${term} `)))
      group.forEach((term) => phrases.add(term));
  const words = [...new Set(normalized.split(" ").filter((word) => word.length >= 3))];
  return { phrases: [...phrases], words };
}

function scoreChunk(chunk, terms) {
  const value = fold(chunk.text).replace(/[^\p{L}\p{N}]+/gu, " ");
  // Acronyms such as NCI must match words, not the middle of "financial".
  // Complete accounting labels outrank a generic disclosure mention through
  // their additional exact synonym matches; no source text is rewritten.
  return (
    terms.phrases.reduce(
      (score, term) => score + (` ${value} `.includes(` ${term} `) ? 10 : 0),
      0,
    ) + terms.words.reduce((score, term) => score + (` ${value} `.includes(` ${term} `) ? 1 : 0), 0)
  );
}

function cursorOffset(cursor, selectionHash, extractionHash) {
  if (!cursor) return 0;
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    fail("invalid_evidence_cursor");
  }
  if (
    !plain(decoded) ||
    Object.keys(decoded).sort().join(",") !== "extractionHash,offset,selectionHash" ||
    decoded.selectionHash !== selectionHash ||
    decoded.extractionHash !== extractionHash ||
    !Number.isSafeInteger(decoded.offset) ||
    decoded.offset < 0
  )
    fail("invalid_evidence_cursor");
  return decoded.offset;
}

/** Trusted construction options are for a deployment or isolated test fixture,
 * never request fields. The exported production reader pins the reviewed corpus. */
export function createSecuritiesSourceEvidenceReader({
  directory = SOURCE_DIRECTORY,
  sources = SECURITIES_SOURCE_DOCUMENTS,
  extractionHashes = EXTRACTION_HASHES,
  extractionContentHashes = EXTRACTION_CONTENT_HASHES,
  maximumOriginalBytes = SOURCE_EVIDENCE_LIMITS.originalBytes,
} = {}) {
  if (
    typeof directory !== "string" ||
    !Number.isSafeInteger(maximumOriginalBytes) ||
    maximumOriginalBytes < 1 ||
    maximumOriginalBytes > 32 * 1024 * 1024 ||
    !Array.isArray(sources) ||
    !sources.length ||
    sources.some(
      (source) =>
        !/^[a-z0-9-]{1,80}$/u.test(source.id) ||
        !HASH.test(source.hash) ||
        !HASH.test(extractionHashes[source.id] ?? "") ||
        (extractionContentHashes[source.id] !== undefined &&
          !HASH.test(extractionContentHashes[source.id])) ||
        !Number.isSafeInteger(source.pageCount) ||
        source.pageCount < 1 ||
        source.pageCount > 300,
    )
  ) {
    fail("invalid_evidence_configuration");
  }
  const cache = new Map();
  return async function readEvidence(input, { signal } = {}) {
    aborted(signal);
    const selection = parseInput(input, sources);
    const { source, query, pages, limit, cursor } = selection;
    const loaded = await loadOriginal(
      directory,
      source,
      extractionHashes[source.id],
      extractionContentHashes[source.id],
      signal,
      maximumOriginalBytes,
    );
    aborted(signal);
    const quality = assessSecuritiesExtractionQuality(loaded.extraction, {
      materialCellsVerified: loaded.manifest.verified === true,
      cellsDigest: loaded.manifest.cellsDigest ?? null,
      materialPages: source.statementPages ?? [],
    });
    let index = cache.get(loaded.extractionHash);
    if (!index) {
      index = indexExtraction(loaded.extraction, quality);
      cache.set(loaded.extractionHash, index);
    }
    const terms = termsForQuery(query);
    const selectedPages = pages.length ? pages : loaded.extraction.pages.map((page) => page.page);
    const candidates = index.chunks
      .filter((chunk) => selectedPages.includes(chunk.locator.page))
      .map((chunk) => ({ chunk, score: query ? scoreChunk(chunk, terms) : 1 }))
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.chunk.locator.page - b.chunk.locator.page ||
          a.chunk.locator.representation.localeCompare(b.chunk.locator.representation) ||
          a.chunk.locator.characterStart - b.chunk.locator.characterStart,
      );
    const selectionHash = sha256(
      JSON.stringify({
        sourceId: source.id,
        sourceVersion: input.sourceVersion,
        query,
        pages,
        limit,
      }),
    );
    const offset = cursorOffset(cursor, selectionHash, loaded.extractionHash);
    if (offset > candidates.length) fail("invalid_evidence_cursor");
    const passages = [];
    let consumed = 0;
    for (const { chunk } of candidates.slice(offset, offset + limit)) {
      const entry = {
        ...structuredClone(chunk),
        sourceId: source.id,
        sourceVersion: input.sourceVersion,
        originalHash: source.hash,
        extractionHash: loaded.extractionHash,
        representationHash: index.representationHash,
      };
      if (Buffer.byteLength(JSON.stringify([...passages, entry])) > 16_000) break;
      passages.push(entry);
      consumed += 1;
    }
    let supplemental;
    try {
      supplemental = await readVerifiedSecuritiesSourceFacts(
        { sourceId: source.id, sourceHash: source.hash, pages: responsePages(passages) },
        { directory, signal },
      );
      if (supplemental.facts.some((fact) => !matchVerifiedSecuritiesFact(fact)))
        fail("source_evidence_corrupted", 409);
    } catch (error) {
      aborted(signal);
      if (error instanceof SourceEvidenceError) throw error;
      fail("source_evidence_corrupted", 409);
    }
    const nextOffset = offset + consumed;
    const truncated = nextOffset < candidates.length;
    const { pageQuality: allPageQuality, ...qualitySummary } = quality;
    const response = {
      schemaVersion: 1,
      sourceId: source.id,
      sourceVersion: input.sourceVersion,
      sourceHash: source.hash,
      source: {
        title: source.title,
        companyId: source.companyId,
        periodId: source.periodId,
        auditStatus: source.auditStatus,
        sourceType: source.sourceType,
        scope: source.scope,
        originalVerified: true,
        extraction: qualitySummary,
      },
      passages,
      verifiedFacts: structuredClone(supplemental.facts),
      coverage: {
        searchedPageCount: selectedPages.length,
        totalPages: source.pageCount,
        returnedPages: [...new Set(passages.map((passage) => passage.locator.page))],
        truncated,
        nextCursor: truncated
          ? Buffer.from(
              JSON.stringify({
                selectionHash,
                extractionHash: loaded.extractionHash,
                offset: nextOffset,
              }),
            ).toString("base64url")
          : null,
        matchingPassages: candidates.length,
        unusablePages: quality.pagesWithoutUsableText,
        fullDocumentRead: false,
        fullTextVerified: false,
      },
      pageQuality: allPageQuality.filter((page) =>
        pages.length
          ? pages.includes(page.page)
          : responsePages(passages).includes(page.page) || page.status === "unusable",
      ),
    };
    const serialized = JSON.stringify(response);
    response.receipt = {
      evidenceType: "local_original",
      operation: "read_evidence",
      readerVersion: SOURCE_EVIDENCE_VERSION,
      sourceId: source.id,
      sourceVersion: input.sourceVersion,
      sourceHash: source.hash,
      parserVersion: loaded.extraction.parserVersion,
      extractionFileSha256: loaded.extractionHash,
      representationVersion: SECURITIES_PROSE_REFERENCE_VERSION,
      representationHash: index.representationHash,
      qualityVersion: SOURCE_QUALITY_VERSION,
      manifestSha256: loaded.manifestHash,
      requestSha256: selectionHash,
      verifiedLedgerSha256:
        supplemental.ledgerHashes.length === 1 ? supplemental.ledgerHashes[0] : null,
      verifiedLedgerHashes: supplemental.ledgerHashes,
      responseSha256: sha256(serialized),
      responseBytes: Buffer.byteLength(serialized),
      readAt: new Date().toISOString(),
      numericVerification: "retrieval_does_not_verify_or_promote_numbers",
    };
    if (Buffer.byteLength(JSON.stringify(response)) > SOURCE_EVIDENCE_LIMITS.responseBytes)
      fail("source_evidence_response_too_large", 413);
    aborted(signal);
    return response;
  };
}

function responsePages(passages) {
  return [...new Set(passages.map((passage) => passage.locator.page))];
}

export const readSecuritiesSourceEvidence = createSecuritiesSourceEvidenceReader();

/** Offline verification for a checkout with collected public originals. */
export async function verifyLocalSecuritiesSourceEvidence({
  directory = SOURCE_DIRECTORY,
  sourceIds,
} = {}) {
  if (
    sourceIds !== undefined &&
    (!Array.isArray(sourceIds) ||
      !sourceIds.length ||
      new Set(sourceIds).size !== sourceIds.length ||
      sourceIds.some((id) => !SECURITIES_SOURCE_DOCUMENTS.some((source) => source.id === id)))
  )
    fail("invalid_evidence_source_selection");
  const selected = SECURITIES_SOURCE_DOCUMENTS.filter(
    (source) => sourceIds === undefined || sourceIds.includes(source.id),
  );
  const read = createSecuritiesSourceEvidenceReader({ directory });
  const { readReviewedSecuritiesStatementCells } = await import("./source-reviewed-cells.mjs");
  const results = [];
  for (const source of selected) {
    const statementReview = await readReviewedSecuritiesStatementCells(source, {
      directory: path.join(directory, "documents", source.id, source.hash),
    });
    const sourceVersion = `sha256:${source.hash}`;
    const facts = getVerifiedSecuritiesFacts({ sourceId: source.id, sourceVersion });
    const pages = [
      ...new Set([...source.statementPages, ...facts.map((fact) => fact.locator.page)]),
    ].sort((a, b) => a - b);
    const found = new Set();
    let receipt;
    for (const page of pages) {
      const response = await read({ sourceId: source.id, sourceVersion, pages: [page] });
      response.verifiedFacts.forEach((fact) => found.add(fact.factId));
      receipt = response.receipt;
    }
    if (facts.some((fact) => !found.has(fact.factId))) fail("source_evidence_incomplete", 409);
    results.push({
      sourceId: source.id,
      sourceHash: source.hash,
      pageCount: source.pageCount,
      checkedPages: pages,
      verifiedFactCount: found.size,
      reviewedTranscriptionCellPairs: statementReview?.cells.length || 0,
      extractionFileSha256: receipt.extractionFileSha256,
    });
  }
  return {
    status: "passed",
    scope: sourceIds === undefined ? "entire_reviewed_corpus" : "explicit_source_selection",
    sourceCount: results.length,
    sources: results,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const usage =
    "Use --check [--directory <collected-source-directory>] [--source-id <reviewed-source-id>]...";
  if (args[0] !== "--check" || args.length % 2 !== 1) throw new Error(usage);
  const options = {};
  for (let index = 1; index < args.length; index += 2) {
    if (!args[index + 1]) throw new Error(usage);
    if (args[index] === "--directory" && options.directory === undefined)
      options.directory = args[index + 1];
    else if (args[index] === "--source-id") (options.sourceIds ||= []).push(args[index + 1]);
    else throw new Error(usage);
  }
  process.stdout.write(JSON.stringify(await verifyLocalSecuritiesSourceEvidence(options)) + "\n");
}
