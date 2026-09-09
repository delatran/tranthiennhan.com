import { DossierError } from "../../shared/securities/dossier.js";
import { convertUnit } from "../../shared/securities/finance.js";
import { projectSecuritiesReport } from "../../shared/securities/report.js";

const encoder = new TextEncoder();
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export { MIME_XLSX };

function localized(value, locale) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object")
    return value[locale] ?? value.en ?? value.vi ?? JSON.stringify(value);
  return value === null || value === undefined ? "" : String(value);
}

function freshnessText(freshness) {
  if (!freshness) return "No freshness receipt available.";
  return [
    `Status: ${freshness.status ?? "unknown"}`,
    `Checked: ${freshness.checkedAt ?? "not checked"}`,
    `Last successful check: ${freshness.lastSuccessfulCheckAt ?? "unknown"}`,
    `Frozen cache: ${freshness.cachedAt ?? "unknown"}`,
    "A check of supported source URLs does not establish the latest reporting period across the market.",
  ].join("\n");
}

function rightsText(rights, locale) {
  if (!rights || typeof rights === "string" || rights[locale] || rights.en || rights.vi)
    return localized(rights, locale);
  return Object.entries(rights)
    .map(([key, value]) => `${key}: ${localized(value, locale)}`)
    .join("\n");
}

function locatorText(locator) {
  if (!locator) return "Document-level evidence only; no exact locator is available.";
  return [
    locator.precision ? `Precision: ${locator.precision}` : null,
    locator.page ? `PDF page ${locator.page}` : null,
    locator.printedPage ? `Printed page ${locator.printedPage}` : null,
    locator.table ? `Table: ${locator.table}` : null,
    locator.rowCode ? `Row code: ${locator.rowCode}` : null,
    locator.rowLabel ? `Row: ${locator.rowLabel}` : null,
    locator.column ? `Column: ${locator.column}` : null,
    locator.note ? `Note: ${locator.note}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function valueWithUnit(value, unit) {
  return value === null || value === undefined ? "Missing; not zero" : `${value} ${unit}`;
}

function localSourceReferences(source) {
  if (
    !/^[a-zA-Z0-9_-]{1,100}$/u.test(source.id ?? "") ||
    !/^[a-f0-9]{64}$/u.test(source.hash ?? "")
  )
    return [];
  const prefix = `/api/securities/sources/documents/${source.id}/${source.hash}/`;
  const rows = [];
  if (source.localOriginalUrl === `${prefix}original`)
    rows.push([
      "Local workspace original path",
      `${source.localOriginalUrl}\nPinned to the source SHA-256 above. Requires the running local workspace application.`,
    ]);
  if (source.localPageUrl === `${prefix}pages/`)
    rows.push([
      "Local workspace page path pattern",
      `${source.localPageUrl}{pdfPage}\nReplace {pdfPage} with the 1-based PDF page number. Requires the running local workspace application.`,
    ]);
  return rows;
}

function analysisIdentity(dossier) {
  const analysis = dossier.analysis;
  if (analysis.origin !== "model") return [];
  const lineage = dossier.analysisLineage;
  const rows = [
    ["Model", analysis.receipt?.actualModel ?? analysis.model ?? "Not recorded"],
    ["Model provider", analysis.receipt?.provider ?? "Not recorded"],
    ["Analysis input revision", String(analysis.inputRevision ?? "Not recorded")],
    [
      "Analysis generated in revision",
      String(
        lineage?.generatedInRevision ??
          (Number.isSafeInteger(analysis.inputRevision)
            ? analysis.inputRevision + 1
            : "Not recorded"),
      ),
    ],
  ];
  if (analysis.receipt?.requestId) rows.push(["Model request ID", analysis.receipt.requestId]);
  if (lineage?.carriedFromRevision)
    rows.push(
      ["Analysis carried from revision", String(lineage.carriedFromRevision)],
      [
        "Analysis carry reason",
        lineage.reason === "analyst_notes_only"
          ? "Analyst notes changed; financial inputs and original AI wording are unchanged."
          : lineage.reason === "freshness_checked"
            ? "Source freshness checked; financial inputs and original AI wording are unchanged."
            : lineage.reason,
      ],
      ["Analysis carried at", lineage.carriedAt],
    );
  return rows;
}

function claimEvidence(claim) {
  const rows = [];
  for (const quote of claim.evidenceQuotes ?? []) {
    const reference = [
      `Source: ${quote.sourceId}`,
      `Version: ${quote.sourceVersion ?? "Not recorded"}`,
      locatorText(quote.locator),
    ];
    if (quote.sourceExcerptId) reference.push(`Excerpt: ${quote.sourceExcerptId}`);
    if (
      typeof quote.quote === "string" &&
      !(typeof claim.text === "string" && claim.text.includes(quote.quote))
    )
      reference.push(`Quote: ${quote.quote}`);
    rows.push(["Claim source evidence", reference.join("\n")]);
  }
  for (const origin of claim.numericOrigins ?? [])
    rows.push([
      `Numeric input · ${origin.metricId} · ${origin.side}`,
      [
        `Source: ${origin.id ?? origin.sourceId}`,
        `Version: ${origin.version ?? origin.sourceVersion ?? "Not recorded"}`,
        `Exact source value: ${valueWithUnit(origin.sourceValue, origin.sourceUnit)}`,
        `Display unit: ${origin.displayUnit ?? "Not recorded"}`,
        `Value origin: ${origin.origin ?? "Not recorded"}`,
        locatorText(origin.locator),
        ...(origin.correctionId ? [`Analyst correction: ${origin.correctionId}`] : []),
      ].join("\n"),
    ]);
  return rows;
}

function supplementalEvidence(facts, includedFacts) {
  const included = new Set(includedFacts.map((fact) => fact.factId));
  return (facts ?? []).flatMap((fact) => [
    [
      `Supplemental fact · ${fact.id} · ${fact.side}`,
      `Report use: ${included.has(fact.factId) ? "Included from the independent source ledger" : "AUDIT ONLY: outside the selected report or not validated"}\nExact source value: ${valueWithUnit(fact.value, fact.unit)}\nOriginal source text: ${fact.rawText ?? "Not recorded"}\n${fact.basisNote ?? ""}`,
    ],
    [
      "Supplemental source",
      `Source: ${fact.sourceId}\nVersion: ${fact.sourceVersion}\nSHA-256: ${fact.sourceHash}\nPeriod: ${fact.periodId}\nAccounting basis: ${fact.basisId}\n${locatorText(fact.locator)}`,
    ],
    [
      "Independent source verification",
      `Ledger: ${fact.verificationReceipt?.id ?? "Not recorded"}\nLedger SHA-256: ${fact.verificationReceipt?.sha256 ?? "Not recorded"}\nProof SHA-256: ${fact.verificationReceipt?.proofSha256 ?? "Not recorded"}\nRendered page SHA-256: ${fact.verificationReceipt?.renderSha256 ?? "Not recorded"}\nMethod: ${fact.verificationReceipt?.method ?? "Not recorded"}`,
    ],
  ]);
}

function researchEvidence(research) {
  const rows = [];
  for (const step of research?.steps ?? []) {
    rows.push([
      `Source read · ${step.id}`,
      `Status: ${step.status}\nSource: ${step.sourceId}\nVersion: ${step.sourceVersion}\nQuery: ${step.query || "Selected pages"}\nRequested pages: ${(step.pages ?? []).join(", ") || "Search"}\nPassages: ${(step.passageIds ?? []).join(", ") || "None recorded"}`,
    ]);
    if (step.coverage)
      rows.push([
        "Read coverage",
        `Searched pages: ${step.coverage.searchedPageCount} / ${step.coverage.totalPages}\nReturned pages: ${(step.coverage.returnedPages ?? []).join(", ") || "None"}\nTruncated: ${step.coverage.truncated === true}\nUnusable pages in this result: ${(step.coverage.unusablePages ?? []).join(", ") || "None recorded"}`,
      ]);
    rows.push(
      [
        "Source quality observation",
        step.sourceQuality?.qualityVersion
          ? `Quality policy: ${step.sourceQuality.qualityVersion}\nPages without usable text: ${(step.sourceQuality.pagesWithoutUsableText ?? []).join(", ") || "None recorded"}\nPages requiring review: ${(step.sourceQuality.pagesRequiringReview ?? []).join(", ") || "None recorded"}\nFull text verified: false`
          : "Unknown: this saved read has no source quality assessment.",
      ],
      [
        "Page quality observations",
        step.pageQuality?.length
          ? step.pageQuality
              .map(
                (page) =>
                  `Page ${page.page}: ${page.status}; method ${page.method}; ${(page.qualityFlags ?? []).join(", ")}`,
              )
              .join("\n")
          : "Unknown: no page quality observations are recorded. An empty list does not prove there were no unusable pages.",
      ],
    );
    if (step.receipt)
      rows.push([
        "Local read receipt",
        `Evidence type: ${step.receipt.evidenceType}\nParser: ${step.receipt.parserVersion}\nSource SHA-256: ${step.receipt.sourceHash}\nExtraction SHA-256: ${step.receipt.extractionFileSha256}\nResponse SHA-256: ${step.receipt.responseSha256}\nRead at: ${step.receipt.readAt ?? "Not recorded"}`,
      ]);
  }
  return rows;
}

function xml(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function exportReport(dossier) {
  const report = projectSecuritiesReport(dossier);
  if (!report.reportReadiness.canExport) throw new DossierError("report_unavailable", 409);
  return report;
}

function reportSections(analysis, locale) {
  const titles = {
    performance: { vi: "Kết quả kinh doanh", en: "Business performance" },
    earnings_quality: { vi: "Chất lượng lợi nhuận", en: "Earnings quality" },
    cash_and_funding: { vi: "Dòng tiền và nguồn vốn", en: "Cash flow and funding" },
    outlook: { vi: "Triển vọng và rủi ro", en: "Outlook and risks" },
  };
  if (!analysis.report?.sections?.length)
    return [
      {
        title: locale === "vi" ? "Nhận xét từ dữ liệu" : "Findings",
        claims: analysis.claims ?? [],
      },
    ];
  return analysis.report.sections.map((section) => ({
    title: localized(titles[section.id] ?? section.title ?? section.id, locale),
    claims: section.claimIds
      .map((id) => analysis.claims.find((claim) => claim.id === id))
      .filter(Boolean),
  }));
}

function reportCoverage(readiness) {
  return `${readiness.includedMetricCount}/${readiness.totalMetricCount} metrics and ${readiness.includedClaimCount}/${readiness.totalClaimCount} claims included. ${readiness.omittedMetricIds.length} metrics and ${readiness.omittedClaimIds.length} claims excluded from reported conclusions.`;
}

function column(index) {
  let text = "";
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26))
    text = String.fromCharCode(65 + ((n - 1) % 26)) + text;
  return text;
}

function cell(value, ref, style = 0) {
  if (value === null || value === undefined) return `<c r="${ref}" s="${style}"/>`;
  if (typeof value === "object" && "formula" in value) {
    const cached = value.value;
    if (typeof cached !== "number" || !Number.isFinite(cached))
      throw new DossierError("invalid_export_formula", 422);
    return `<c r="${ref}" s="${value.style ?? style}"><f>${xml(value.formula)}</f><v>${cached}</v></c>`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DossierError("invalid_export_number", 422);
    return `<c r="${ref}" s="${style || 2}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

const MAX_TEXT_ROW_LINES = 18;

function textLineCount(value, width) {
  return value
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(8, width - 6))), 0);
}

function textRowParts(value, width) {
  const characters = Array.from(value);
  const parts = [];
  const maxCharacters = Math.max(8, width - 6) * MAX_TEXT_ROW_LINES;
  for (let offset = 0; offset < characters.length;) {
    let left = 1;
    let right = Math.min(characters.length - offset, maxCharacters);
    while (left < right) {
      const middle = Math.ceil((left + right) / 2);
      const candidate = characters.slice(offset, offset + middle).join("");
      if (textLineCount(candidate, width) <= MAX_TEXT_ROW_LINES) left = middle;
      else right = middle - 1;
    }
    parts.push(characters.slice(offset, offset + left).join(""));
    offset += left;
  }
  return parts.length ? parts : [""];
}

function worksheet(rows, widths, { filter = false, splitLongRows = true, paperSize = 9 } = {}) {
  if (splitLongRows)
    rows = rows.flatMap((row) => {
      if (row.some((value) => value && typeof value === "object" && "formula" in value))
        return [row];
      const parts = row.map((value, index) =>
        typeof value === "string" ? textRowParts(value, widths[index]) : [value],
      );
      const count = Math.max(...parts.map((part) => part.length));
      const heading =
        typeof row[0] === "string"
          ? Array.from(row[0].split("\n")[0]).slice(0, 80).join("")
          : "Text";
      return Array.from({ length: count }, (_, index) =>
        parts.map((part, col) => part[index] ?? (col === 0 ? `${heading} (continued)` : null)),
      );
    });
  const last = `${column(widths.length - 1)}${Math.max(rows.length, 1)}`;
  const rowHeight = (row) =>
    Math.max(
      36,
      Math.min(
        409,
        Math.max(
          ...row.map((value, index) =>
            typeof value === "string" ? textLineCount(value, widths[index]) : 1,
          ),
        ) *
          16 +
          20,
      ),
    );
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="21"/><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${rows.map((row, index) => `<row r="${index + 1}" ht="${index === 0 ? 32 : rowHeight(row)}" customHeight="1">${row.map((value, col) => cell(value, `${column(col)}${index + 1}`, index === 0 ? 1 : 0)).join("")}</row>`).join("")}</sheetData>${filter && rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : ""}<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="${paperSize}" fitToWidth="1" fitToHeight="0"/><headerFooter><oddHeader>&amp;LNhân for Securities</oddHeader><oddFooter>&amp;LFinancial report · see coverage and limitations&amp;RPage &amp;P</oddFooter></headerFooter></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00;[Red](#,##0.00);0.00"/><numFmt numFmtId="165" formatCode="0.00%;[Red](0.00%);0.00%"/></numFmts><fonts count="2"><font><sz val="11"/><color rgb="FF0D190D"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFF5F7F0"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1C3C1E"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function joinBytes(chunks) {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, contents] of files) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(contents);
    const crc = crc32(data);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(12, 0x5d26, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    header.set(nameBytes, 30);
    local.push(header, data);
    const entry = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(entry.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(14, 0x5d26, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    entry.set(nameBytes, 46);
    central.push(entry);
    offset += header.length + data.length;
  }
  const directory = joinBytes(central);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, directory.length, true);
  endView.setUint32(16, offset, true);
  return joinBytes([...local, directory, end]);
}

export function exportFilename(dossier, format) {
  const ticker = String(dossier.company.ticker ?? dossier.company.id).replace(
    /[^A-Za-z0-9_-]/gu,
    "",
  );
  const period = String(dossier.period.id).replace(/[^A-Za-z0-9_-]/gu, "");
  return `Nhan-for-Securities_${ticker}_${period}_r${dossier.revision}.${format}`;
}

export function createAnalysisNotes(dossier) {
  const { reportReadiness: readiness, reportProjection: projection } = exportReport(dossier);
  const locale = dossier.locale ?? "vi";
  const text = (value) => localized(value, locale);
  const analysis = projection.analysis;
  const lines = [
    "# Nhân for Securities",
    "",
    `${text(dossier.company.name)} (${dossier.company.ticker ?? dossier.company.id})`,
    `Period: ${text(dossier.period.label) || dossier.period.id}; comparison: ${text(dossier.comparisonPeriod.label) || dossier.comparisonPeriod.id}`,
    "",
    locale === "vi" ? "## Yêu cầu phân tích" : "## Analysis request",
    "",
    dossier.query ||
      (locale === "vi"
        ? "So sánh tài chính theo doanh nghiệp và kỳ đã chọn."
        : "Compare financial performance for the selected company and periods."),
    "",
    locale === "vi" ? "## Kết luận chính" : "## Main findings",
    "",
    text(analysis.summary),
    "",
    `Report state: ${readiness.state}. ${reportCoverage(readiness)}`,
  ];
  if (readiness.reasons.some((reason) => reason.affectsReadiness)) {
    lines.push(
      "",
      locale === "vi"
        ? "## Giới hạn cần đọc cùng kết luận"
        : "## Limitations alongside the conclusions",
      "",
    );
    for (const reason of readiness.reasons.filter((entry) => entry.affectsReadiness))
      lines.push(`- ${text(reason.message)}`);
  }
  if (readiness.reasons.some((reason) => !reason.affectsReadiness)) {
    lines.push("", locale === "vi" ? "## Rủi ro kinh doanh cần lưu ý" : "## Business risks", "");
    for (const reason of readiness.reasons.filter((entry) => !entry.affectsReadiness))
      lines.push(`- ${text(reason.message)}`);
  }
  for (const section of reportSections(analysis, locale)) {
    if (!section.claims.length) continue;
    lines.push("", `## ${section.title}`, "");
    for (const claim of section.claims)
      lines.push(
        text(claim.text),
        "",
        `Evidence: ${(claim.sourceIds ?? []).join(", ") || "Computed source values"}.`,
      );
  }
  lines.push(
    "",
    "## Analyst notes",
    "",
    dossier.notes || "No analyst notes.",
    "",
    "## Questions and limitations",
    "",
  );
  for (const entry of [...(analysis.questions ?? []), ...(analysis.limitations ?? [])])
    lines.push(`- ${text(entry)}`);
  lines.push(
    "",
    "## Evidence and calculation audit",
    "",
    `Dossier: ${dossier.id} | Revision: ${dossier.revision}`,
    `Scope: ${dossier.period.scope}; comparison basis: ${text(dossier.comparisonBasis) || "Selected source basis"}`,
    `Analysis mode: ${analysis.reportMode}`,
    ...analysisIdentity(dossier).map(([label, value]) => `${label}: ${value}`),
    `Optional human approval: ${dossier.approval?.revision === dossier.revision ? dossier.approval.at : "Not recorded; not required for report export"}`,
    "",
  );
  for (const claim of analysis.claims ?? []) {
    lines.push(`### ${claim.id}`, "");
    for (const [label, value] of claimEvidence(claim))
      lines.push(`- ${label}: ${value.replaceAll("\n", "; ")}`);
  }
  lines.push("", "### Verified source notes", "");
  for (const note of projection.evidenceNotes)
    lines.push(
      `- ${text(note.text)} (source ${note.sourceId}, version ${note.sourceVersion}, PDF page ${note.locator?.page ?? note.page ?? "unknown"}, note ${note.note ?? note.locator?.note ?? "unspecified"})`,
    );
  for (const issue of projection.issues)
    lines.push(
      `- [${issue.severity}; ${issue.resolution ? "resolved" : "open"}] ${text(issue.message)}${issue.resolution ? ` Resolution: ${issue.resolution.reason}` : ""}`,
    );
  lines.push("", "## Source versions", "");
  for (const source of dossier.sources) {
    lines.push(
      `- ${source.id} | version ${source.version} | SHA-256 ${source.hash} | ${source.url} | fetched ${source.fetchedAt} | published ${source.publishedAt ?? "unknown"}`,
    );
    for (const [label, value] of localSourceReferences(source))
      lines.push(`- ${label} (${source.id}): ${value.replaceAll("\n", "; ")}`);
  }
  const research = [
    ...researchEvidence(dossier.analysis.research),
    ...supplementalEvidence(dossier.analysis.research?.verifiedFacts, projection.verifiedFacts),
  ];
  if (research.length) {
    lines.push("", "## Source reading and supplemental evidence", "");
    for (const [label, value] of research) lines.push(`### ${label}`, "", value, "");
  }
  lines.push("", "## Corrections", "");
  for (const correction of dossier.corrections)
    lines.push(
      `- ${correction.metricId}/${correction.periodId}: ${correction.previousValue} → ${correction.value}; original ${correction.originalValue}. ${correction.reason} (${correction.at}; source checked: ${correction.sourceChecked})`,
    );
  if (
    dossier.analysis.origin === "model" &&
    (analysis.reportMode !== "automatic" || readiness.omittedClaimIds.length)
  ) {
    lines.push(
      "",
      "## Original saved AI output for audit",
      "",
      "Historical or excluded text below is preserved for comparison. It is not an automatically validated conclusion of this report.",
      "",
      text(dossier.analysis.summary),
    );
    for (const claim of dossier.analysis.claims ?? [])
      lines.push("", `[Original ${claim.id}] ${text(claim.text)}`);
  }
  lines.push(
    "",
    "This local dossier is a versioned financial analysis work product. Frozen source coverage does not establish the latest market reporting period.",
    "",
  );
  return lines.join("\n");
}

export function createSecuritiesXlsx(dossier) {
  const { reportReadiness: readiness, reportProjection: projection } = exportReport(dossier);
  const text = (value) => localized(value, dossier.locale ?? "vi");
  const overview = [
    ["Nhân for Securities", "Financial analysis report"],
    ["Company", `${text(dossier.company.name)} (${dossier.company.ticker ?? dossier.company.id})`],
    ["Analysis request", dossier.query || "Compare the selected company and reporting periods."],
    ["Main findings", text(projection.analysis.summary)],
    ["Report state", readiness.state],
    ["Coverage", reportCoverage(readiness)],
    ...readiness.reasons.map((reason) => [
      reason.affectsReadiness ? "Limitation" : "Business risk",
      text(reason.message),
    ]),
    ["Period", text(dossier.period.label) || dossier.period.id],
    ["Comparison period", text(dossier.comparisonPeriod.label) || dossier.comparisonPeriod.id],
    ["Scope", dossier.period.scope],
    ["Comparison basis", text(dossier.comparisonBasis)],
    ...reportSections(projection.analysis, dossier.locale ?? "vi").flatMap((section) =>
      section.claims.map((claim) => [section.title, text(claim.text)]),
    ),
    ["Analyst notes", dossier.notes],
    ["Source freshness", freshnessText(dossier.freshness)],
    [
      "Reading guide",
      "Financials contains cached values and native Excel formulas. Evidence and Formula audit identify the source versions and exact inputs. Blank values mean missing or not comparable, never zero.",
    ],
    ["Dossier ID", dossier.id],
    ["Revision", String(dossier.revision)],
    ["Analysis mode", projection.analysis.reportMode],
    ...analysisIdentity(dossier),
    [
      "Optional human approval",
      dossier.approval?.revision === dossier.revision
        ? dossier.approval.at
        : "Not recorded; not required for report export",
    ],
    [
      "Boundary",
      "Frozen supported source coverage. This file does not establish the latest market reporting period or give a trading instruction.",
    ],
  ];
  const financials = [
    ["Metric", "Definition", "Unit", "Current", "Comparison", "Absolute change", "Change %"],
  ];
  const formulas = [["Calculation field", "Definition and exact inputs"]];
  for (const [index, metric] of projection.metrics.entries()) {
    const row = index + 2;
    const abs = metric.calculation.absoluteChange;
    const relative = metric.calculation.relativeChangePct;
    financials.push([
      text(metric.label),
      text(metric.definition),
      metric.unit,
      convertUnit(metric.current.value, metric.current.unit ?? metric.unit, metric.unit),
      convertUnit(metric.comparison.value, metric.comparison.unit ?? metric.unit, metric.unit),
      abs.status === "ok" ? { formula: `D${row}-E${row}`, value: abs.value, style: 2 } : null,
      relative.status === "ok"
        ? { formula: `(D${row}-E${row})/E${row}`, value: relative.value / 100, style: 3 }
        : null,
    ]);
    for (const [name, calculation] of Object.entries(metric.calculation)) {
      formulas.push(
        [`${text(metric.label)} · ${name}`, calculation.formula],
        [
          "Result / state",
          `${valueWithUnit(calculation.exact, name === "relativeChangePct" ? "percent" : metric.unit)}\nState: ${calculation.status}`,
        ],
      );
      for (const input of calculation.inputRefs)
        formulas.push([
          `${input.metricId} · ${input.side}`,
          `${valueWithUnit(input.value, input.unit)}\nSource: ${input.sourceId}\nVersion: ${input.sourceVersion}\n${locatorText(input.locator)}${input.correctionId ? `\nAnalyst correction: ${input.correctionId}` : ""}`,
        ]);
    }
  }
  const metricRows = new Map(projection.metrics.map((metric, index) => [metric.id, index + 2]));
  const formulaRef = (ref, targetUnit) => {
    const sourceMetric = projection.metrics.find((metric) => metric.id === ref.metricId);
    if (
      !sourceMetric ||
      !metricRows.has(ref.metricId) ||
      !["current", "comparison"].includes(ref.side)
    )
      throw new DossierError("export_missing_formula_input", 422);
    const cellRef = `${ref.side === "current" ? "D" : "E"}${metricRows.get(ref.metricId)}`;
    const scale = convertUnit(1, sourceMetric.unit, targetUnit);
    return scale === 1 ? cellRef : `(${cellRef}*${scale})`;
  };
  const derivedCell = (calculation) => {
    if (!calculation || calculation.status !== "ok") return null;
    const refs = calculation.inputRefs;
    if (calculation.calculationKind === "difference" && refs.length === 2)
      return {
        formula: `${formulaRef(refs[0], calculation.unit)}-${formulaRef(refs[1], calculation.unit)}`,
        value: calculation.value,
        style: 2,
      };
    if (
      ["revenue_growth_effect", "margin_growth_effect"].includes(calculation.calculationKind) &&
      refs.length === 4
    ) {
      const [profit, revenue, priorProfit, priorRevenue] = refs.map((ref) =>
        formulaRef(ref, calculation.unit),
      );
      const formula =
        calculation.calculationKind === "revenue_growth_effect"
          ? `(${revenue}-${priorRevenue})*${priorProfit}/${priorRevenue}`
          : `(${profit}*${priorRevenue}-${priorProfit}*${revenue})/${priorRevenue}`;
      return { formula, value: calculation.value, style: 2 };
    }
    const fraction = (numerator, denominator) => {
      const unit = projection.metrics.find((metric) => metric.id === numerator.metricId)?.unit;
      return `${formulaRef(numerator, unit)}/${formulaRef(denominator, unit)}`;
    };
    if (calculation.calculationKind === "bank_cost_to_income_percent" && refs.length === 2) {
      const unit = projection.metrics.find((metric) => metric.id === refs[0].metricId)?.unit;
      const profit = formulaRef(refs[0], unit);
      const expenses = formulaRef(refs[1], unit);
      return {
        formula: `-${expenses}/(${profit}-${expenses})`,
        value: calculation.value / 100,
        style: 3,
      };
    }
    if (calculation.calculationKind === "ratio_percent" && refs.length === 2)
      return {
        formula: fraction(refs[0], refs[1]),
        value: calculation.value / 100,
        style: 3,
      };
    if (calculation.calculationKind === "ratio_difference_percentage_points" && refs.length === 4)
      return {
        formula: `(${fraction(refs[0], refs[1])}-${fraction(refs[2], refs[3])})*100`,
        value: calculation.value,
        style: 2,
      };
    throw new DossierError("invalid_export_calculation", 422);
  };
  if (projection.derivedMetrics.length)
    financials.push([
      "Derived indicator",
      "Definition",
      "Unit",
      "Current",
      "Comparison",
      "Change (pp)",
      "",
    ]);
  for (const metric of projection.derivedMetrics) {
    financials.push([
      text(metric.label),
      text(metric.definition),
      metric.unit,
      derivedCell(metric.current),
      derivedCell(metric.comparison),
      derivedCell(metric.percentagePointChange),
      null,
    ]);
    for (const side of [
      "current",
      "comparison",
      ...(metric.percentagePointChange ? ["percentagePointChange"] : []),
    ]) {
      const calculation = metric[side];
      const field = `${text(metric.label)} · ${side}`;
      formulas.push([
        field,
        `${calculation.formula}\nResult: ${valueWithUnit(calculation.exact, calculation.unit ?? metric.unit)}\nState: ${calculation.status}`,
      ]);
      for (const [index, input] of calculation.inputRefs.entries())
        formulas.push([
          `${field} · input ${index + 1}`,
          `Metric: ${input.metricId}\nPeriod side: ${input.side}\n${valueWithUnit(input.value, input.unit)}\nSource: ${input.sourceId}\nVersion: ${input.sourceVersion}\n${locatorText(input.locator)}${input.correctionId ? `\nAnalyst correction: ${input.correctionId}` : ""}`,
        ]);
    }
  }
  const evidence = [["Evidence field", "Source version and original values"]];
  for (const source of dossier.sources)
    evidence.push(
      [source.id, text(source.title)],
      ["Official URL", source.url],
      ["Source version", source.version],
      ["SHA-256", source.hash],
      ...localSourceReferences(source),
      [
        "Published / fetched",
        `Published: ${source.publishedAt ?? "Unknown"}\nFetched: ${source.fetchedAt}`,
      ],
      [
        "Scope / reporting",
        `Period: ${source.periodId}\nScope: ${source.scope}\nSource unit: ${source.unit}\nAudit status: ${source.auditStatus}`,
      ],
      [
        "Parser / access rights",
        `${source.parserVersion}\n${rightsText(source.rights, dossier.locale ?? "vi")}`,
      ],
    );
  for (const metric of dossier.metrics) {
    const original = dossier.originalMetrics.find((entry) => entry.id === metric.id);
    for (const side of ["current", "comparison"]) {
      const point = metric[side];
      const originalPoint = original?.[side];
      evidence.push(
        [
          `${text(metric.label)} · ${side}`,
          `Report use: ${readiness.omittedMetricIds.includes(metric.id) ? "EXCLUDED: unresolved evidence or contradiction; audit only" : "Included as a sourced value; comparison is shown only when valid"}\nSelected value: ${valueWithUnit(point.value, point.unit ?? metric.unit)}\nOriginal extracted value: ${valueWithUnit(originalPoint?.value, originalPoint?.unit ?? metric.unit)}\nOriginal source text: ${originalPoint?.rawText ?? "Not available"}\nOriginal source unit: ${originalPoint?.originalUnit ?? originalPoint?.unit ?? metric.unit}`,
        ],
        [
          "Exact evidence",
          `Source: ${point.sourceId}\nVersion: ${point.sourceVersion}\n${locatorText(point.locator)}`,
        ],
        [
          "Verification",
          `${point.verification}${point.correctionId ? `\nAnalyst correction: ${point.correctionId}` : ""}`,
        ],
      );
    }
  }
  for (const note of dossier.evidenceNotes ?? [])
    evidence.push([
      "Original source note for audit",
      `${text(note.text)}\nSource: ${note.sourceId}\nVersion: ${note.sourceVersion}\n${locatorText(note.locator)}`,
    ]);
  evidence.push(
    ...researchEvidence(dossier.analysis.research),
    ...supplementalEvidence(dossier.analysis.research?.verifiedFacts, projection.verifiedFacts),
  );
  if (
    dossier.analysis.origin === "model" &&
    (projection.analysis.reportMode !== "automatic" || readiness.omittedClaimIds.length)
  ) {
    evidence.push(
      [
        "Original saved AI output for audit",
        "Historical or excluded text below is not an automatically validated conclusion of this report.",
      ],
      ["Original AI summary", text(dossier.analysis.summary)],
    );
    for (const claim of dossier.analysis.claims ?? [])
      evidence.push(
        [`Original ${claim.id} · ${claim.kind}`, text(claim.text)],
        ...claimEvidence(claim),
      );
  }
  const changes = [["Correction field", "Immutable analyst edit history"]];
  for (const change of dossier.corrections) {
    const metric = dossier.metrics.find((entry) => entry.id === change.metricId);
    const unit = metric?.[change.side]?.unit ?? metric?.unit ?? "Source unit";
    changes.push(
      [
        `Revision ${change.revision} · ${change.metricId}`,
        `Period: ${change.periodId}\nOriginal: ${valueWithUnit(change.originalValue, unit)}\nPrevious: ${valueWithUnit(change.previousValue, unit)}\nCorrected: ${valueWithUnit(change.value, unit)}`,
      ],
      ["Analyst reason", change.reason],
      [
        "Source verification",
        `Explicitly checked: ${change.sourceChecked}\nSource: ${change.sourceId}\nVersion: ${change.sourceVersion}\n${locatorText(change.locator)}`,
      ],
      ["Recorded at", change.at],
    );
  }
  if (!dossier.corrections.length)
    changes.push(["No corrections", "This revision uses the original extracted values."]);
  const issues = [["Issue field", "Review state and resolution"]];
  for (const issue of projection.issues)
    issues.push(
      [issue.id, `${issue.severity} · ${issue.code}\n${text(issue.message)}`],
      ["Resolution", issue.resolution ? `Resolved: ${issue.resolution.reason}` : "Open"],
      [
        "Affected evidence",
        `Metrics: ${(issue.metricIds ?? []).join(", ")}\nSources: ${(issue.sourceIds ?? []).join(", ")}`,
      ],
    );
  if (!projection.issues.length)
    issues.push([
      "No financial input issues",
      "The selected source values pass the financial input checks. Report coverage and AI validation are disclosed separately on Report.",
    ]);
  const analysis = [["Analysis type", "Analysis and evidence references"]];
  analysis.push(
    [projection.analysis.reportMode, text(projection.analysis.summary)],
    ["Coverage", reportCoverage(readiness)],
    ...readiness.reasons.map((reason) => [
      reason.affectsReadiness ? "Limitation" : "Business risk",
      text(reason.message),
    ]),
  );
  for (const claim of projection.analysis.claims ?? [])
    analysis.push(
      [
        claim.kind,
        `${text(claim.text)}\nMetrics: ${(claim.metricIds ?? []).join(", ")}\nSources: ${(claim.sourceIds ?? []).join(", ")}`,
      ],
      ...claimEvidence(claim),
    );
  for (const note of projection.evidenceNotes)
    analysis.push([
      "Verified source note",
      `${text(note.text)}\nSource: ${note.sourceId}\nVersion: ${note.sourceVersion}\nPDF page ${note.locator?.page ?? note.page ?? "unknown"}; note ${note.note ?? note.locator?.note ?? "unspecified"}`,
    ]);
  for (const question of projection.analysis.questions ?? [])
    analysis.push(["Open question", text(question)]);
  for (const limitation of projection.analysis.limitations ?? [])
    analysis.push(["Limitation", text(limitation)]);
  analysis.push(["Analyst opinion", dossier.notes]);
  const sheets = [
    ["Report", overview, [28, 100]],
    ["Financials", financials, [30, 42, 18, 22, 22, 22, 18]],
    ["Evidence", evidence, [30, 100]],
    ["Formula audit", formulas, [32, 98]],
    ["Corrections", changes, [30, 100]],
    ["Issues", issues, [30, 100]],
    ["Analysis", analysis, [28, 102]],
  ];
  return createSecuritiesWorkbook(sheets);
}

export function createSecuritiesWorkbook(sheets) {
  const files = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map(([name], index) => `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets><definedNames>${sheets.map(([name], index) => `<definedName name="_xlnm.Print_Titles" localSheetId="${index}">'${xml(name)}'!$1:$1</definedName>`).join("")}</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ["xl/styles.xml", STYLES],
    ...sheets.map(([, rows, widths, options], index) => [
      `xl/worksheets/sheet${index + 1}.xml`,
      worksheet(rows, widths, {
        filter: index === 1,
        splitLongRows: index !== 1,
        paperSize: index === 1 ? 8 : 9,
        ...options,
      }),
    ]),
  ];
  return zip(files);
}
