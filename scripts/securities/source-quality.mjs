export const SOURCE_QUALITY_VERSION = "securities-extraction-quality-v1";

// These observations concern exact preserved originals. A new content hash does
// not inherit them, and a readable original does not verify its OCR output.
const KNOWN_PAGE_ISSUES = Object.freeze({
  "45636554f28c7e6c2f38458b9a22410ed1f67e80627d672b827019a67f299df8": {
    12: ["known_numeric_ocr_error"],
    13: ["known_numeric_ocr_error"],
  },
  "2d4c5cd550d18ec9c84a67b4d74d2f51b883c24f9398fc08df458891ec5ec4d1": {
    58: ["sideways_scan_text_unusable"],
    59: ["sideways_scan_text_unusable"],
    60: ["sideways_scan_text_unusable"],
    61: ["sideways_scan_text_unusable"],
    62: ["sideways_scan_text_unusable"],
    63: ["sideways_scan_text_unusable"],
  },
  "6ead1d852b12f468da71dc3e1ea830549124e99ec073078008051a540402862d": {
    12: ["known_numeric_ocr_error"],
    13: ["known_numeric_ocr_error"],
  },
});

export function assessSecuritiesPageQuality(page, { sourceHash, materialPages = [] } = {}) {
  const text = typeof page?.text === "string" ? page.text : "";
  const method = ["text", "ocr", "scan"].includes(page?.method) ? page.method : "unknown";
  const ocrConfidence =
    method === "ocr" && Number.isFinite(page.ocrConfidence) ? page.ocrConfidence : null;
  const flags = [method === "text" ? "text_layer_unreviewed" : "ocr_unreviewed"];
  if (text.trim().length < 100) flags.push("insufficient_extracted_text");
  if (ocrConfidence !== null && ocrConfidence < 60) flags.push("low_ocr_confidence");
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (
    method === "ocr" &&
    words.length >= 40 &&
    words.filter((word) => word.length === 1).length / words.length > 0.45
  ) {
    flags.push("fragmented_ocr_text");
  }
  flags.push(...(KNOWN_PAGE_ISSUES[sourceHash]?.[page.page] ?? []));
  const unusable =
    text.trim().length < 40 ||
    flags.includes("sideways_scan_text_unusable") ||
    (flags.includes("low_ocr_confidence") && flags.includes("fragmented_ocr_text"));
  return {
    page: page.page,
    method,
    status: unusable ? "unusable" : "extracted_unreviewed",
    ocrConfidence,
    textCharacters: text.length,
    qualityFlags: [...new Set(flags)],
    reviewedNumericCellsOnly: materialPages.includes(page.page),
  };
}

/** Text presence is a processing count, never a semantic completeness claim. */
export function assessSecuritiesExtractionQuality(
  extraction,
  { materialCellsVerified = false, cellsDigest = null, materialPages = [] } = {},
) {
  const pages = Array.isArray(extraction?.pages) ? extraction.pages : [];
  const pageQuality = pages.map((page) =>
    assessSecuritiesPageQuality(page, {
      sourceHash: extraction.sourceHash,
      materialPages: materialCellsVerified ? materialPages : [],
    }),
  );
  return {
    qualityVersion: SOURCE_QUALITY_VERSION,
    fullOriginalFetched: true,
    pageCount: extraction.pageCount,
    extractedPages: pages.length,
    textPages: pages.filter((page) => page.method === "text").length,
    ocrPages: pages.filter((page) => page.method === "ocr").length,
    pagesWithoutText: pageQuality
      .filter((page) => page.textCharacters < 100)
      .map((page) => page.page),
    pagesWithoutUsableText: pageQuality
      .filter((page) => page.status === "unusable")
      .map((page) => page.page),
    pagesRequiringReview: pageQuality.map((page) => page.page),
    fullTextVerified: false,
    materialCellsVerified,
    cellsDigest,
    pageQuality,
    method: "immutable_original_with_unreviewed_page_extraction_and_separately_verified_cells",
  };
}
