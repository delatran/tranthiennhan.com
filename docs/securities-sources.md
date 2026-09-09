# Public source adapter

The reviewed baseline catalog contains FPT H1 2026 against H1 2025, FPT FY 2025 against FY 2024, Gemadept H1 2026 against H1 2025, and Viconship (VSC) H1 2026 against H1 2025. These are processed public issuer reports, not a market feed. Source dates identify their actual evidence basis; collection times are separate UTC timestamps. The product never claims that discovery alone establishes the latest market reporting period.

For processed-report analysis, `StartWorkspace` sends the displayed company, reporting period, and comparison period as explicit `companyId`, `periodId`, and `comparisonPeriodId` fields alongside the question. A generic question uses that selected scope. If the question names a different issuer or reporting period, scope resolution stops before creating a dossier or starting research. The user can then correct the question or the selection. The same selected values also populate `defaultScope`; they remain explicit selectors in this workflow.

The source API also accepts hint-only `defaultScope` requests from other callers. When no conflicting explicit selector is supplied, an issuer or period named in the question can replace those hints. Unsupported processed-report issuers and periods are rejected before fallback. A latest-period request refers to the latest processed source for the resolved issuer, and malformed or unavailable scope never silently becomes FPT H1 2026.

## Reviewed originals

| Source                                                  | Official original                                                                                                              | Publication               | PDF pages                     | Statement evidence                                 | SHA-256                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | ----------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| FPT H1 2026, reviewed consolidated statements           | [Issuer PDF](https://fpt.com/api/media/20260821_FPT_BCTC_hop_nhat_ban_nien_da_soat_xet_nam_2026_3b1ebb3536.pdf)                | 2026-08-21                | 66, scanned                   | PDF 18, note 1; four metric pairs                  | `45636554f28c7e6c2f38458b9a22410ed1f67e80627d672b827019a67f299df8` |
| FPT annual report 2025, audited consolidated statements | [Issuer PDF](https://bctn2025.fpt.com/wp-content/uploads/2026/04/BCTN-2025.pdf)                                                | 2026-04-08                | 232, text with an image cover | PDF 169–170; five metric pairs                     | `9449a7251d126b635988974dbc72c2773c7fff39f4e5e858b5f7d3928b4e0e6c` |
| GMD H1 2026, reviewed consolidated statements           | [Issuer PDF](https://www.gemadept.com.vn/wp-content/uploads/2026/08/20260829-GMD-BCTC-Hop-nhat-soat-xet-ban-nien-2026.pdf)     | 2026-08-29                | 63, scanned                   | PDF 11–12; eight metric pairs, notes 47–50         | `2d4c5cd550d18ec9c84a67b4d74d2f51b883c24f9398fc08df458891ec5ec4d1` |
| VSC H1 2026, reviewed consolidated statements           | [Issuer PDF](https://viconship.com/wp-content/uploads/2026/08/20260828-VSC-Bao-cao-tai-chinh-hop-nhat-ban-nien-30.06.2026.pdf) | 2026-08-28, issuer letter | 59, scanned                   | PDF 12–13; eight visually transcribed metric pairs | `6ead1d852b12f468da71dc3e1ea830549124e99ec073078008051a540402862d` |

FPT changed FTEL from full consolidation to the equity method in 2026. The default H1 comparison uses the 2025 figures re-presented by FPT on PDF page 18 under the same method. The alternative prior reported column remains available with a material accounting-basis warning. The published growth rates on that page belong only to the re-presented comparison and are reconciled against application arithmetic using the source's one decimal place. Import order cannot change this default.

Gemadept's financial income includes a disclosed investment disposal gain on PDF page 48. The statement and borrowing-cost note contain different interest figures, so that metric is excluded from normalized calculations. These observations are attached only to the reviewed content hash. New bytes never inherit old narrative notes or visual verification.

VSC's shareholder index links the reviewed consolidated original. The disclosure letter and review report are dated 28 August 2026; the date is recorded as `issuer_disclosure_letter`, without inventing an index publication timestamp. The report is reviewed, not an annual audit. The issuer attributes higher profit to gross profit and associates, partly offset by finance costs. Parent profit remains separate from consolidated profit, and the negative prior CFO does not support a conventional growth percentage. PDF page 13 line 13 includes changes in trading securities within operating cash flow; the source-bound `vsc-cfo-trading-securities` evidence note preserves this context for CFO/PAT. These observations come from PDF pages 1, 7–8 and 12–13.

## Collection and versioning

The source adapter is part of the website's shared Vite/Worker application. The browser starts a public-source job through the local Worker. The authenticated loopback ingestion service runs `scripts/securities/collect-sources.mjs`; no provider credentials are needed. It reads each issuer's financial disclosure index, follows the allowed Gemadept disclosure pages, downloads original PDFs, verifies their content, and runs PDF.js plus local Tesseract OCR. Originals, text coordinates, OCR text/TSV, selected page images, cells, and manifests live outside the website repository in `../output/securities/sources/documents/<source-id>/<sha256>/`.

Every original is immutable by hash. The frozen catalog combines original text/OCR extraction with separately identified visual transcriptions. A verified source hash and reviewed cell digest are both required to retain verified status. VSC's material scan pages contain numeric OCR errors. Its committed transcription is additionally bound to the original PDF, PDF.js page 12 and 13 render hashes, and the frozen visual oracle hash. `source-reviewed-cells.mjs` verifies these artifacts before collection can use those cells. It leaves the raw extraction unchanged, records `rawExtractedCells` beside the accepted cells, and cannot transfer the transcription to changed source bytes or renders. Re-running the same parser on cached material does not count as a fresh network download or a second independent review. Local receipts distinguish `succeeded`, `cached`, `cached_after_failure`, `needs_review`, and failures. A cached read preserves the original successful check time and cannot extend freshness indefinitely.

The Worker imports versioned datasets into local D1. A dossier pins its source hash, extracted values, and review state. New imported source versions and a changed remote content hash are compared against the current imported version, not always against the initial catalog. Explicit refresh checks the issuer again. A natural-language latest request may reuse a persistent 24-hour check keyed by the actual source IDs, URLs, and hashes. A failed refresh retains the last successful timestamp and the earlier original; it does not become a successful check.

Discovery also handles previously unseen annual or half-year report URLs. It fetches the original, extracts its pages, checks issuer identity, reporting-period evidence, consolidated scope, and VND units, and attempts a conservative statement mapping. The inferred filename period is never a publication date. New originals and their cells remain unverified. A changed layout, ambiguous row or column, missing metadata, unsupported quarter, or unsupported unit remains explicit review work; original bytes and extraction receipts are retained. Synthetic tests cover this extension; no future-period issuer document has been represented as independently verified.

Run the collector directly from the website directory:

```powershell
node scripts/securities/collect-sources.mjs --company=FPT
node scripts/securities/collect-sources.mjs --company=GMD
node scripts/securities/collect-sources.mjs --company=VSC
node scripts/securities/collect-sources.mjs --company=FPT --cached
node --test tests/securities/sources.test.mjs tests/securities/acceptance.test.mjs tests/securities/security-review.test.mjs
```

The first scan extraction can take several minutes. Job progress reports per-page work and supports cancellation. `--cached` permits reuse only within the freshness TTL; the HTML discovery receipt is still current. The API serves tracked originals and page images by source ID and hash, never by a caller-supplied local path.

After installing the pinned dependencies in a fresh checkout, collect the required issuers with the commands above, then run the offline reader check:

```powershell
node scripts/securities/source-evidence.mjs --check
```

This validates all four collected originals, extraction content, reviewed page images, the seven committed supplemental facts, and VSC's reviewed statement transcription. It needs no private QA directory or provider credential and makes no model call. To inspect a separately collected corpus, add `--directory <collected-source-directory>`. To check an explicit subset, repeat `--source-id`; the result labels its scope `explicit_source_selection` and never implies that omitted sources passed. Unknown, empty and duplicate selections are rejected. The command emits source identities, checked pages, fact counts, transcription counts, and the actual extraction-file hashes. It does not claim a new independent financial review.

```powershell
node scripts/securities/source-evidence.mjs --check --source-id gmd-h1-2026 --source-id vsc-h1-2026
```

## Evidence and failure boundaries

Real full-original downloads succeeded with HTTP 200 for all three PDFs on 6 September 2026. The first complete scan runs processed all 66 FPT interim pages and all 63 GMD pages. The annual report's 231 text pages were extracted; the image cover is separately rendered and OCR-processed. The review oracle checks 16 current/prior metric pairs against rendered originals. Review files and real run receipts are in `../output/securities/qa/` and `../output/securities/sources/runs/`. Later receipts with cached originals are cache tests, not fresh full downloads.

On 8 September 2026, fresh GMD and VSC downloads succeeded through the public-source collector. The GMD original and deterministic extraction content reproduced the existing pins; its disposal-gain page render also reproduced the historical pin. The new review checked eight metric pairs for each issuer, including GMD CFO and the eight VSC transcriptions. All eight GMD pairs match raw OCR; the VSC parser did not reproduce any complete reviewed cell pair, and its OCR remains unverified. Ten arithmetic cross-checks on the statement values pass. GMD and VSC's explicit offline evidence check passes. The first FPT H1 fetch returned HTTP 403 while its original was absent locally, so that attempt could not establish full-corpus source access. Its failure receipt and the frozen visual oracle remain in `../output/qa/securities-comparison-20260908/vsc-sources/`.

During the later authorized local live test on 8 September 2026, both FPT originals returned HTTP 200 from their canonical URLs. The collector restored all 66 interim pages and 232 annual pages; both original hashes and deterministic extraction-content hashes matched the existing reviewed pins without source-code or trust-root changes. The complete four-document evidence check then passed. These current observations, including the retained earlier failure, are recorded in `../output/qa/securities-live-20260908/sources/source-restoration-result.json` and `full-source-evidence-check.json`. The gate verifies source identity and reviewed cells, not every OCR passage or future issuer availability.

Processing the historical 361 pages or the new 59-page VSC original does not establish readable or correct text on every page. The quality assessment flags GMD PDF pages 58–63 as unusable sideways-scan OCR. FPT interim pages 12–13 and VSC pages 12–13 have observed numeric OCR errors. Where the original is locally available, separately reviewed cells can be used without marking the surrounding OCR as verified. The earlier pipeline receipt counted text presence, so it must not be interpreted as semantic completeness. Current responses expose `pagesWithoutUsableText`, `pagesRequiringReview`, individual page flags, and `fullTextVerified: false`. A historical dossier with missing quality metadata or an empty page-quality array has unknown page quality; absence of recorded failures is not a verified full-document result.

The exact-host and path allowlist is applied before fetch and on every redirect. Node resolves DNS, rejects the entire result if any address is non-public, then pins the accepted address into TLS lookup while retaining the issuer server name. The adapter bounds HTML/PDF bytes, page count, image size, time, redirects, and retries. It rejects partial responses, truncated PDFs, wrong MIME types, login/challenge pages, unsafe redirects, private addresses, and cross-issuer substitutions. HTTP 403, 404, 429, cancellation, and timeout retain different error codes. The adversarial transport, cache, and new-layout tests are labeled fixtures and are separate from real issuer receipts.

The local D1 migrations must include `0003_source_checks.sql`; `pnpm dev:securities` applies the local migrations. No production database, deployment, DNS, or public tunnel is involved.

## Supplemental prose reading order

`scripts/securities/source-layout.mjs` creates the separately versioned `securities-coordinate-prose-v1` representation for held-back retrieval verification. Recurring left edges of long text identify non-overlapping prose columns. Within each column, original text items remain in PDF coordinate order; remaining items are retained separately. Explicit block markers prevent a quotation from matching by skipping between columns or pages. This representation does not alter canonical `page.text`, OCR output, financial row extraction, or verified cells, and never uses the proposed quotation to choose its layout.

The FPT annual report's native PDF page 7 was rendered with Poppler and visually checked after a real provider excerpt failed against interleaved row text. Its paragraph matches the ordered central column exactly. The new reference has its own source hash, extraction-file hash, method, version, file hash, and text hash in `../output/securities/sources/reading-references/`; the visual check is recorded in `../output/securities/qa/source-reading-order-check.json`. This is a targeted development regression. It does not prove all page layouts are correctly reconstructed, complete provider PDF reading, or full OCR capability. `tests/securities/source-layout.test.mjs` checks unchanged canonical data, retained positioned items, and rejection of changed numbers, reordered sentences, and cross-column splicing under exact containment.

## Original-document evidence reads

`scripts/securities/source-evidence.mjs` reads the locally available reviewed originals through a closed source-ID and SHA-256 contract. The Worker binds a read to the current dossier revision and source version before calling the authenticated local ingestion service. A request supplies `sourceId`, `sourceVersion`, and a literal `query`, one to six PDF `pages`, or both. Optional `limit` and `cursor` fields support bounded continuation. Callers cannot supply a URL, local path, extraction hash, verification state, or alternate source definition.

Each read verifies the original PDF, extraction integrity, manifest identity, page count, and ordered page array. `scripts/securities/source-extraction-integrity.mjs` pins both the reviewed extraction-file hash and a deterministic content hash. The latter permits a new collection timestamp and JSON formatting while retaining every other field, including source hash, parser identity, page text, OCR output, coordinates, verification fields, and page order. Only the top-level `extractedAt` field is excluded. The read receipt always records the actual file hash, and continuation cursors remain bound to that file. A changed source, parser, text, or locator fails closed. OCR or rendering differences on another system require review; changing a pin merely to pass the check would grant unsupported trust.

Even a warm search index requires file verification again. The response contains exact 12–1,000-character passages, stable passage IDs, source offsets and page locators, bounded page headers for year and unit context, extraction method, and quality flags. Text-layer documents may also expose the separately versioned coordinate prose representation. Bilingual accounting aliases improve literal matching; a retrieved passage retains its original text and is always `extracted_unreviewed`.

The response is at most 32,000 bytes. Its coverage identifies returned pages, truncation, a cursor bound to the request and extraction hash, and known unusable pages. A request for unusable OCR returns the gap without substituting text from another page. A read receipt includes the immutable source identity, parser and representation versions, extraction-file hash, manifest hash, request hash, response hash, and timestamp. `responseSha256` hashes `JSON.stringify(response)` before adding the `receipt` field. Reading a passage does not verify its financial amounts or mean the model read the whole document.

The independent QA ledger adds seven scoped facts: FPT H1 operating cash flow for the current and prior reported periods, three non-controlling-interest profit cells from note 1, and GMD's current disposal gain plus the prior-period dash. Their canonical values and provenance are committed in `shared/securities/verified-source-facts.js`. At runtime, `scripts/securities/source-fact-reader.mjs` checks those complete records against the committed ledger manifests and verifies the original PDF and reviewed page-render hashes. It never opens a private ledger or proof file. Missing or changed source bytes and rendered pages cannot receive verified facts.

A reader only returns a reviewed fact when its corresponding page was returned. The model and backend also match the complete fact record against the generated canonical data; caller-supplied verification receipts cannot promote another value. The historical review identities remain attached to the facts so their provenance is stable.

FPT's prior cash-flow column still includes full FTEL consolidation and cannot support growth against the 2026 equity-method CFO. The restated income-statement column on PDF page 18 does not provide a restated CFO. Non-controlling-interest losses retain their signs; a negative comparison base blocks a conventional growth percentage. GMD's prior disposal-gain dash remains missing. These controls do not install balance-sheet or segment numbers that have not been accepted for this product scope. FTEL method and segment-grouping prose can be cited as extracted text, with its actual page and verification boundary.

Run the source checks from the website directory:

```powershell
node scripts/securities/source-evidence.mjs --check
node --test tests/securities/source-evidence.test.mjs tests/securities/source-layout.test.mjs tests/securities/sources.test.mjs tests/securities/vsc-sources.test.mjs tests/securities/ux-boundaries.test.mjs
```

Maintainers regenerating the canonical fact module must explicitly provide the independently reviewed ledger directory. This separate maintenance operation continues to require the exact ledger, proof, original, and page-render hashes:

```powershell
node scripts/securities/source-verified-facts.mjs --check --qa-directory <independent-review-directory>
```

Use `--write` in place of `--check` only when intentionally regenerating the committed module from the reviewed inputs. Neither command creates missing evidence, grants a new visual review, or falls back to unverified data. A normal checkout does not need those private review files to run the product.

The self-contained regression suite runs a copied reader and synthetic canonical corpus with no generator or QA ledger present, rejects missing or changed page images and original bytes, accepts only the volatile collection timestamp change, and rejects modified text, coordinates, page order, and parser identity. These fixture checks are separate from real local evidence-read packets, provider execution, and analyst-report quality evaluation. Historical local packets remain outside the repository in `../output/securities/ux-rework/sources/`.

## Retention and attribution

[FPT's terms](https://fpt.com/vi/dieu-khoan-su-dung) permit personal, noncommercial viewing, downloading, and extraction with attribution, `©2015 Copyright by FPT Corp.` Commercial reuse is not granted by this implementation. Gemadept and Viconship offer public report attachments while reserving copyright; no broad redistribution grant was identified. Their attributions are `Copyright © 2024 Gemadept. All Rights Reserved.` and `Copyright 2025 © Công ty Cổ phần Container Việt Nam`. Originals and full text are retained for private local analysis, excluded from frontend public assets, and not published by this workflow. Rights records remain attached to each source version.
