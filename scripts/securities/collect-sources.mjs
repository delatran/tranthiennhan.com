import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SECURITIES_EXTRACTION_RULES,
  SECURITIES_ISSUERS,
  SECURITIES_SOURCE_DOCUMENTS,
  SECURITIES_SOURCE_POLICY,
  sourceError,
} from "../../shared/securities/source-contract.js";
import { buildSecuritiesDataset, VERIFIED_CELLS_DIGESTS } from "../../shared/securities/catalog.js";
import {
  checkReviewedSecuritiesCompanions,
  discoverSecuritiesDisclosurePages,
  discoverSecuritiesDocuments,
  fetchSecuritiesSource,
} from "../../worker/securities/sources.js";
import {
  cellsDigest,
  extractSecuritiesPdf,
  extractStatementCells,
  SOURCE_PARSER_VERSION,
} from "./source-extract.mjs";
import { nodeSecuritiesFetch } from "./source-network.mjs";
import {
  createCandidateSource,
  discoveredSourceId,
  validateCandidateOriginal,
} from "./source-candidates.mjs";
import { assessSecuritiesExtractionQuality } from "./source-quality.mjs";
import { readReviewedSecuritiesStatementCells } from "./source-reviewed-cells.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SECURITIES_SOURCES_DIRECTORY = path.resolve(
  repository,
  "../output/securities/sources",
);
const hashOf = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const writeJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2));

async function immutableWrite(file, bytes) {
  try {
    const present = await readFile(file);
    if (hashOf(present) !== hashOf(bytes)) throw sourceError("immutable_source_conflict");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(file, bytes, { flag: "wx" });
  }
}

function sourceDirectory(id, hash) {
  if (!/^[a-z0-9-]{1,80}$/.test(id) || !/^[a-f0-9]{64}$/.test(hash))
    throw sourceError("invalid_source_identity");
  return path.join(SECURITIES_SOURCES_DIRECTORY, "documents", id, hash);
}

async function migrateVerifiedLocalCopy(source, directory) {
  const legacy = path.join(SECURITIES_SOURCES_DIRECTORY, `${source.id}.pdf`);
  try {
    const bytes = await readFile(legacy);
    if (hashOf(bytes) !== source.hash) return false;
    await mkdir(directory, { recursive: true });
    await immutableWrite(path.join(directory, "original.pdf"), bytes);
    try {
      const existing = await readJson(
        path.join(SECURITIES_SOURCES_DIRECTORY, `${source.id}-extracted`, "extraction.json"),
      );
      if (existing.sourceHash === source.hash && existing.parserVersion === SOURCE_PARSER_VERSION)
        await cp(
          path.join(SECURITIES_SOURCES_DIRECTORY, `${source.id}-extracted`),
          path.join(directory, "extracted"),
          { recursive: true, force: false, errorOnExist: false },
        );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function discoverIssuer(company, signal, receipts) {
  const result = await fetchSecuritiesSource(company.landingUrl, {
    fetchImpl: nodeSecuritiesFetch,
    signal,
  });
  receipts.push({
    kind: "public_html_fetch",
    companyId: company.id,
    url: result.url,
    status: "succeeded",
    hash: result.hash,
    bytes: result.byteLength,
    fetchedAt: result.fetchedAt,
    requests: result.requests,
  });
  await mkdir(path.join(SECURITIES_SOURCES_DIRECTORY, "discovery"), { recursive: true });
  await immutableWrite(
    path.join(SECURITIES_SOURCES_DIRECTORY, "discovery", `${result.hash}.html`),
    result.bytes,
  );
  const candidates = discoverSecuritiesDocuments(result.text, result.url, company.id);
  // Gemadept's financial index uses disclosure pages. Read only allowed issuer paths.
  for (const url of discoverSecuritiesDisclosurePages(result.text, result.url, company.id)) {
    const disclosure = await fetchSecuritiesSource(url, { fetchImpl: nodeSecuritiesFetch, signal });
    receipts.push({
      kind: "public_html_fetch",
      companyId: company.id,
      url: disclosure.url,
      status: "succeeded",
      hash: disclosure.hash,
      bytes: disclosure.byteLength,
      fetchedAt: disclosure.fetchedAt,
      requests: disclosure.requests,
    });
    await immutableWrite(
      path.join(SECURITIES_SOURCES_DIRECTORY, "discovery", `${disclosure.hash}.html`),
      disclosure.bytes,
    );
    candidates.push(...discoverSecuritiesDocuments(disclosure.text, disclosure.url, company.id));
  }
  return [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()];
}

/** Public-only local ingestion. A new hash never inherits a previous visual verification. */
export async function collectSecuritiesSources({
  companyId,
  sourceIds,
  forceRefresh = true,
  signal,
  onProgress = () => {},
} = {}) {
  const company = SECURITIES_ISSUERS.find((item) => item.id === companyId);
  if (!company) throw sourceError("unsupported_company");
  const selected = SECURITIES_SOURCE_DOCUMENTS.filter(
    (source) => source.companyId === companyId && (!sourceIds || sourceIds.includes(source.id)),
  );
  if (
    !selected.length ||
    (sourceIds && (sourceIds.length > 4 || selected.length !== new Set(sourceIds).size))
  )
    throw sourceError("unsupported_source");
  await mkdir(SECURITIES_SOURCES_DIRECTORY, { recursive: true });
  const receipts = [];
  const documents = [];
  const datasets = [];
  let candidates = [];
  let discoveryFailed = false;
  let reviewedCompanionChanged = false;
  const fetchedSources = new Map();
  onProgress({
    phase: "discovery",
    message: "Reading the official issuer disclosure index",
    done: 0,
    total: selected.length,
  });
  try {
    candidates = await discoverIssuer(company, signal, receipts);
    const companionResult = await checkReviewedSecuritiesCompanions(candidates, {
      fetchImpl: nodeSecuritiesFetch,
      fetchedSources,
      signal,
    });
    candidates = companionResult.candidates;
    receipts.push(
      ...companionResult.checks.map((check) => ({
        kind: "public_pdf_companion_fetch",
        ...check,
      })),
    );
    discoveryFailed = companionResult.checks.some((check) => check.status === "failed");
    reviewedCompanionChanged = companionResult.checks.some((check) => check.status === "changed");
  } catch (error) {
    if (signal?.aborted) throw sourceError("cancelled");
    discoveryFailed = true;
    receipts.push({
      kind: "public_html_fetch",
      companyId,
      status: "failed",
      code: error.code || "network_error",
      fetchedAt: new Date().toISOString(),
    });
  }
  for (const [index, frozen] of selected.entries()) {
    signal?.throwIfAborted();
    onProgress({
      phase: "fetch",
      sourceId: frozen.id,
      message: "Fetching the original issuer PDF",
      done: index,
      total: selected.length,
    });
    let result;
    const frozenDirectory = sourceDirectory(frozen.id, frozen.hash);
    try {
      const manifest = await readJson(path.join(frozenDirectory, "manifest.json"));
      if (
        !forceRefresh &&
        Date.now() - Date.parse(manifest.checkedAt) < SECURITIES_SOURCE_POLICY.freshnessTtlMs
      ) {
        const bytes = await readFile(path.join(frozenDirectory, "original.pdf"));
        if (hashOf(bytes) !== manifest.hash) throw sourceError("source_cache_corrupted");
        result = { ...manifest, bytes, byteLength: bytes.length, cacheHit: true };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!result) {
      try {
        if (!fetchedSources.has(frozen.url))
          fetchedSources.set(
            frozen.url,
            fetchSecuritiesSource(frozen.url, { fetchImpl: nodeSecuritiesFetch, signal }),
          );
        result = await fetchedSources.get(frozen.url);
      } catch (error) {
        if (signal?.aborted) throw sourceError("cancelled");
        receipts.push({
          kind: "public_pdf_fetch",
          sourceId: frozen.id,
          status: "failed",
          code: error.code || "network_error",
          fetchedAt: new Date().toISOString(),
        });
        const migrated = await migrateVerifiedLocalCopy(frozen, frozenDirectory);
        try {
          const bytes = await readFile(path.join(frozenDirectory, "original.pdf"));
          if (hashOf(bytes) !== frozen.hash) throw sourceError("source_cache_corrupted");
          result = {
            url: frozen.url,
            hash: frozen.hash,
            bytes,
            byteLength: bytes.length,
            fetchedAt: frozen.fetchedAt,
            cacheHit: true,
            refreshFailed: true,
            migrated,
          };
        } catch (cacheError) {
          if (cacheError.code === "ENOENT") continue;
          throw cacheError;
        }
      }
    }
    const directory = sourceDirectory(frozen.id, result.hash);
    await mkdir(directory, { recursive: true });
    await immutableWrite(path.join(directory, "original.pdf"), result.bytes);
    if (result.hash === frozen.hash) await migrateVerifiedLocalCopy(frozen, directory);
    const checkedAt = result.cacheHit
      ? result.checkedAt || result.fetchedAt
      : new Date().toISOString();
    const source = {
      ...frozen,
      hash: result.hash,
      fetchedAt: result.fetchedAt,
      bytes: result.byteLength,
      revisionStatus:
        result.hash === frozen.hash ? "frozen_verified_version" : "new_content_requires_review",
    };
    receipts.push({
      kind: "public_pdf_fetch",
      sourceId: source.id,
      url: result.url,
      status: result.refreshFailed
        ? "cached_after_failure"
        : result.cacheHit
          ? "cached"
          : "succeeded",
      hash: result.hash,
      bytes: result.byteLength,
      fetchedAt: result.fetchedAt,
      checkedAt,
      requests: result.requests || [],
    });
    onProgress({
      phase: "extract",
      sourceId: source.id,
      message: "Reading text and applying local OCR to scanned pages",
      done: index,
      total: selected.length,
    });
    const extraction = await extractSecuritiesPdf(
      path.join(directory, "original.pdf"),
      path.join(directory, "extracted"),
      {
        pages:
          source.sourceType === "text_pdf"
            ? [...source.statementPages, ...source.contextualPages]
            : undefined,
        signal,
        onProgress: (progress) =>
          onProgress({
            phase: progress.method === "ocr" ? "ocr" : "extract",
            sourceId: source.id,
            message: progress.cached
              ? "Reusing extraction bound to unchanged source hash"
              : "Reading an original source page",
            done: progress.page,
            total: progress.total,
          }),
      },
    );
    source.pageCount = extraction.pageCount;
    source.sourceType = extraction.textPageCount > 0 ? "text_pdf" : "scan_pdf";
    if (source.hash !== frozen.hash) {
      try {
        source.metadata = validateCandidateOriginal(source, extraction);
      } catch (error) {
        await writeJson(path.join(directory, "manifest.json"), {
          schemaVersion: 1,
          id: source.id,
          companyId,
          hash: source.hash,
          url: source.url,
          fetchedAt: source.fetchedAt,
          checkedAt,
          pageCount: extraction.pageCount,
          renderedPages: extraction.pages.filter((page) => page.render).map((page) => page.page),
          verified: false,
          status: "identity_review_required",
        });
        documents.push({ ...source, status: "identity_review_required" });
        receipts.push({
          kind: "local_parser",
          sourceId: source.id,
          hash: source.hash,
          status: "needs_review",
          code: error.code || "candidate_identity_unconfirmed",
        });
        continue;
      }
    }
    const extractedCells = extractStatementCells(
      extraction,
      SECURITIES_EXTRACTION_RULES[source.id],
    );
    const reviewedCells = await readReviewedSecuritiesStatementCells(source, { directory, signal });
    const cells = reviewedCells?.cells || extractedCells;
    const digest = cellsDigest(cells);
    const verified = source.hash === frozen.hash && digest === VERIFIED_CELLS_DIGESTS[source.id];
    const quality = assessSecuritiesExtractionQuality(extraction, {
      materialCellsVerified: verified,
      cellsDigest: digest,
      materialPages: source.statementPages,
    });
    if (reviewedCells) quality.cellReview = reviewedCells.receipt;
    const freshness = {
      status:
        discoveryFailed || result.refreshFailed
          ? "check_failed"
          : reviewedCompanionChanged
            ? "revision_detected"
            : candidates.some(
                  (candidate) => !["known", "known_companion"].includes(candidate.status),
                )
              ? "new_documents_discovered"
              : "checked",
      checkedAt,
      lastSuccessfulCheckAt: discoveryFailed || result.refreshFailed ? null : checkedAt,
      cachedAt: source.fetchedAt,
      latestMarketPeriodVerified: false,
      policy: "24h-issuer-discovery-and-content-hash",
      pendingCandidateCount: candidates.filter(
        (candidate) => !["known", "known_companion"].includes(candidate.status),
      ).length,
    };
    const dataset = buildSecuritiesDataset(source, cells, {
      verified,
      extraction: quality,
      freshness,
    });
    datasets.push(dataset);
    if (source.id === "fpt-h1-2026")
      datasets.push(
        buildSecuritiesDataset(source, cells, {
          verified,
          comparisonPeriodId: "H1_2025_reported",
          extraction: quality,
          freshness,
        }),
      );
    const manifest = {
      schemaVersion: 1,
      id: source.id,
      companyId,
      hash: source.hash,
      url: source.url,
      fetchedAt: source.fetchedAt,
      checkedAt,
      parserVersion: SOURCE_PARSER_VERSION,
      original: "original.pdf",
      extractionDirectory: "extracted",
      pageCount: extraction.pageCount,
      renderedPages: extraction.pages.filter((page) => page.render).map((page) => page.page),
      verified,
      cellsDigest: digest,
      extractionQuality: quality,
    };
    await writeJson(path.join(directory, "manifest.json"), manifest);
    await writeJson(path.join(directory, "cells.json"), {
      sourceHash: source.hash,
      cellsDigest: digest,
      cells,
      ...(reviewedCells
        ? { rawExtractedCells: extractedCells, cellReview: reviewedCells.receipt }
        : {}),
      verified,
    });
    documents.push({ ...source, version: `sha256:${source.hash}`, extraction: quality });
    receipts.push({
      kind: "local_parser",
      sourceId: source.id,
      hash: source.hash,
      parserVersion: SOURCE_PARSER_VERSION,
      status: verified ? "verified_against_reviewed_source_cells" : "needs_review",
      cellsDigest: digest,
      materialRowCount: cells.length,
      extractedAt: extraction.extractedAt,
      quality,
    });
  }
  const newestKnownEnd = selected
    .map(
      (source) =>
        `${source.periodId.match(/20\d{2}/u)[0]}-${source.periodId.startsWith("FY") ? "12-31" : "06-30"}`,
    )
    .sort()
    .at(-1);
  for (const candidate of candidates) {
    if (candidate.companionOf || candidate.status === "known" || !candidate.periodId) continue;
    const candidateEnd = `${candidate.periodId.match(/20\d{2}/u)[0]}-${candidate.periodId.startsWith("FY") ? "12-31" : "06-30"}`;
    if (candidateEnd < newestKnownEnd) {
      candidate.status = "historical_discovery_outside_current_refresh";
      continue;
    }
    signal?.throwIfAborted();
    const id = discoveredSourceId(candidate);
    candidate.sourceId = id;
    onProgress({
      phase: "fetch",
      sourceId: id,
      message: "Fetching a newly discovered official report",
      done: documents.length,
      total: documents.length + 1,
    });
    try {
      const fetched = await fetchSecuritiesSource(candidate.url, {
        fetchImpl: nodeSecuritiesFetch,
        signal,
      });
      const directory = sourceDirectory(id, fetched.hash);
      await mkdir(directory, { recursive: true });
      await immutableWrite(path.join(directory, "original.pdf"), fetched.bytes);
      receipts.push({
        kind: "public_pdf_fetch",
        sourceId: id,
        url: fetched.url,
        status: "succeeded",
        hash: fetched.hash,
        bytes: fetched.byteLength,
        fetchedAt: fetched.fetchedAt,
        requests: fetched.requests,
      });
      const extraction = await extractSecuritiesPdf(
        path.join(directory, "original.pdf"),
        path.join(directory, "extracted"),
        {
          signal,
          onProgress: (progress) =>
            onProgress({
              phase: progress.method === "ocr" ? "ocr" : "extract",
              sourceId: id,
              message: "Reading a newly discovered report",
              done: progress.page,
              total: progress.total,
            }),
        },
      );
      const manifest = {
        schemaVersion: 1,
        id,
        companyId,
        hash: fetched.hash,
        url: fetched.url,
        fetchedAt: fetched.fetchedAt,
        checkedAt: new Date().toISOString(),
        parserVersion: SOURCE_PARSER_VERSION,
        original: "original.pdf",
        pageCount: extraction.pageCount,
        renderedPages: extraction.pages.filter((page) => page.render).map((page) => page.page),
        verified: false,
      };
      await writeJson(path.join(directory, "manifest.json"), manifest);
      candidate.hash = fetched.hash;
      candidate.localOriginalUrl = `/api/securities/sources/documents/${id}/${fetched.hash}/original`;
      const entry = {
        id,
        companyId,
        url: fetched.url,
        title: candidate.title,
        hash: fetched.hash,
        pageCount: extraction.pageCount,
        status: "original_extracted_requires_metadata_review",
      };
      documents.push(entry);
      try {
        const { source, cells } = createCandidateSource(candidate, fetched, extraction);
        const digest = cellsDigest(cells);
        const quality = assessSecuritiesExtractionQuality(extraction, {
          materialCellsVerified: false,
          cellsDigest: digest,
        });
        const freshness = {
          status: "new_document_imported_needs_review",
          checkedAt: manifest.checkedAt,
          lastSuccessfulCheckAt: manifest.checkedAt,
          cachedAt: fetched.fetchedAt,
          latestMarketPeriodVerified: false,
          policy: "24h-issuer-discovery-and-content-hash",
        };
        datasets.push(
          buildSecuritiesDataset(source, cells, {
            verified: false,
            extraction: quality,
            freshness,
          }),
        );
        Object.assign(entry, source, {
          extraction: quality,
          status: "dataset_created_requires_review",
        });
        candidate.status = "dataset_created_requires_review";
        manifest.cellsDigest = digest;
        manifest.extractionQuality = quality;
        await writeJson(path.join(directory, "manifest.json"), manifest);
        await writeJson(path.join(directory, "cells.json"), {
          sourceHash: source.hash,
          cellsDigest: digest,
          cells,
          verified: false,
        });
        receipts.push({
          kind: "local_parser",
          sourceId: id,
          hash: source.hash,
          status: "needs_review",
          parserVersion: SOURCE_PARSER_VERSION,
          cellsDigest: digest,
          materialRowCount: cells.length,
          quality,
        });
      } catch (error) {
        candidate.status = "original_extracted_requires_metadata_review";
        candidate.reviewCode = error.code || "candidate_layout_requires_review";
        receipts.push({
          kind: "local_parser",
          sourceId: id,
          hash: fetched.hash,
          status: "needs_review",
          code: candidate.reviewCode,
        });
      }
    } catch (error) {
      if (signal?.aborted) throw sourceError("cancelled");
      candidate.status = "collection_failed";
      candidate.error = error.code || "source_collection_failed";
      receipts.push({
        kind: "source_collection",
        sourceId: id,
        status: "failed",
        code: candidate.error,
      });
    }
  }
  const result = {
    schemaVersion: 1,
    companyId,
    datasets,
    documents,
    candidates,
    receipts,
    completedAt: new Date().toISOString(),
  };
  await mkdir(path.join(SECURITIES_SOURCES_DIRECTORY, "runs"), { recursive: true });
  await writeJson(
    path.join(SECURITIES_SOURCES_DIRECTORY, "runs", `${companyId}-${randomUUID()}.json`),
    result,
  );
  onProgress({
    phase: datasets.length ? "completed" : "partial",
    message: datasets.length
      ? "Source versions and extracted datasets are ready"
      : "No usable source dataset could be produced",
    done: selected.length,
    total: selected.length,
  });
  return result;
}

/** Resolve only tracked immutable originals or rendered pages. No caller supplies a filesystem path. */
export async function getSecuritiesSourceAsset({ sourceId, hash, page, kind = "original" } = {}) {
  if (
    !SECURITIES_SOURCE_DOCUMENTS.some((source) => source.id === sourceId) &&
    !/^(?:fpt|gmd)-discovered-[a-f0-9]{16}$/u.test(sourceId || "")
  )
    throw sourceError("unsupported_source");
  const directory = sourceDirectory(sourceId, hash);
  const manifest = await readJson(path.join(directory, "manifest.json"));
  if (
    manifest.id !== sourceId ||
    manifest.hash !== hash ||
    !SECURITIES_ISSUERS.some((company) => company.id === manifest.companyId) ||
    sourceId.startsWith(manifest.companyId.toLowerCase() + "-") === false
  )
    throw sourceError("source_manifest_mismatch");
  let filename;
  if (kind === "original") filename = "original.pdf";
  else if (
    kind === "page" &&
    Number.isSafeInteger(page) &&
    page >= 1 &&
    manifest.renderedPages.includes(page)
  )
    filename = path.join("extracted", `page-${page}.png`);
  else throw sourceError("source_page_unavailable");
  const resolved = await realpath(path.join(directory, filename));
  const allowed = await realpath(directory);
  if (!resolved.startsWith(allowed + path.sep)) throw sourceError("unsafe_source_path");
  if ((await stat(resolved)).size > SECURITIES_SOURCE_POLICY.maxBytes)
    throw sourceError("source_asset_too_large");
  const bytes = await readFile(resolved);
  if (kind === "original" && hashOf(bytes) !== hash) throw sourceError("source_cache_corrupted");
  return {
    bytes,
    contentType: kind === "original" ? "application/pdf" : "image/png",
    filename: `${sourceId}-${hash.slice(0, 12)}${kind === "original" ? ".pdf" : `-page-${page}.png`}`,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const companyId = process.argv.find((arg) => /^--company=/.test(arg))?.split("=")[1];
  if (!companyId) {
    process.stderr.write(
      "Usage: node scripts/securities/collect-sources.mjs --company=FPT|GMD|VSC|ACB [--cached]\n",
    );
    process.exitCode = 1;
  } else {
    const result = await collectSecuritiesSources({
      companyId,
      forceRefresh: !process.argv.includes("--cached"),
      onProgress: (progress) => process.stdout.write(JSON.stringify(progress) + "\n"),
    });
    process.stdout.write(
      JSON.stringify({
        companyId,
        datasets: result.datasets.length,
        documents: result.documents.length,
        receiptCount: result.receipts.length,
      }) + "\n",
    );
  }
}
