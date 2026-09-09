import { createHash } from "node:crypto";
import {
  SECURITIES_METRICS,
  SECURITIES_SOURCE_DOCUMENTS,
  sourceError,
  sourceIssuerForUrl,
} from "../../shared/securities/source-contract.js";
import { extractStatementCells } from "./source-extract.mjs";

const plain = (value) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/gu, "d")
    .toLowerCase();
export const discoveredSourceId = (candidate) =>
  `${candidate.companyId.toLowerCase()}-discovered-${createHash("sha256").update(candidate.url).digest("hex").slice(0, 16)}`;

/** Filename metadata selects work. Only the downloaded original can support a dataset identity. */
export function validateCandidateOriginal(candidate, extraction) {
  if (
    sourceIssuerForUrl(candidate.url) !== candidate.companyId ||
    !/^(?:FY|H1_)20\d{2}$/u.test(candidate.periodId || "")
  )
    throw sourceError("unsupported_candidate_metadata");
  const year = candidate.periodId.match(/20\d{2}/u)[0];
  const annual = candidate.periodId.startsWith("FY");
  const firstPages = extraction.pages.slice(0, Math.min(extraction.pages.length, 20));
  const issuerPattern = {
    FPT: /^(?:cong ty co phan fpt|tap doan fpt|fpt corporation)$/u,
    GMD: /^(?:cong ty co phan (?:tap doan )?gemadept|gemadept corporation)$/u,
    VSC: /^(?:cong ty (?:co phan|cp) container viet nam|vietnam container shipping (?:corporation|joint stock company))$/u,
    ACB: /^(?:ngan hang thuong mai co phan a chau|asia commercial joint stock bank)$/u,
  }[candidate.companyId];
  if (!issuerPattern) throw sourceError("unsupported_candidate_metadata");
  const issuer = firstPages.slice(0, 3).find((page) =>
    plain(page.text)
      .split(/\r?\n/u)
      .some((line) => issuerPattern.test(line.trim())),
  );
  const scope = firstPages.find((page) =>
    /(?:bao cao tai chinh hop nhat|consolidated financial statements)/u.test(plain(page.text)),
  );
  const reportingPeriod = firstPages.find((page) => {
    const text = plain(page.text);
    return new RegExp(
      `(?:${annual ? "nam tai chinh|nam ket thuc|year ended|bao cao thuong nien" : "6 thang|sau thang|ban nien|six.month|half.year"})[^\\n]{0,140}\\b${year}\\b`,
      "u",
    ).test(text);
  });
  if (!issuer || !scope || !reportingPeriod) throw sourceError("candidate_identity_unconfirmed");
  return {
    status: "original_metadata_requires_review",
    issuerPage: issuer.page,
    scopePage: scope.page,
    periodPage: reportingPeriod.page,
    periodEvidence: reportingPeriod.text.slice(0, 1400),
  };
}

/** Unrecognized layouts remain review work: no numbers are accepted from ambiguous rows or columns. */
export function extractCandidateCells(extraction) {
  const rows = [
    ["revenue", "10", "doanh thu thuan"],
    ["gross_profit", "20", "loi nhuan gop"],
    ["profit_before_tax", "50", "tong loi nhuan ke toan truoc thue"],
    ["profit_after_tax", "60", "loi nhuan sau thue"],
    ["profit_parent", "61", "(?:co dong.*cong ty me|loi nhuan sau thue.*cong ty me)"],
  ];
  const statementPages = extraction.pages.filter(
    (page) =>
      /(?:ket qua.*hoat dong kinh doanh|bao cao ket qua kinh doanh|income statement)/u.test(
        plain(page.text),
      ) && /doanh thu thuan/u.test(plain(page.text)),
  );
  if (!statementPages.length) throw sourceError("candidate_statement_not_identified");
  const cells = rows.map(([id, rowCode, match]) => {
    const matching = statementPages.flatMap((page) =>
      page.lines
        .filter((line) => new RegExp(match, "u").test(plain(line.text)))
        .filter((line) => new RegExp(`(?:^|\\s)${rowCode}(?:\\s|$)`, "u").test(line.text))
        .map((line) => ({ page, line })),
    );
    if (matching.length !== 1)
      return {
        id,
        rowCode,
        page: statementPages[0].page,
        rawCurrent: null,
        rawComparison: null,
        extractionIssue: "candidate_ambiguous_row",
        candidates: matching.map(({ page, line }) => ({ page: page.page, text: line.text })),
      };
    const selected = matching[0];
    return extractStatementCells({ pages: [{ ...selected.page, lines: [selected.line] }] }, [
      { id, rowCode, page: selected.page.page, match: ".*" },
    ])[0];
  });
  return {
    cells,
    statementPages: [...new Set(cells.map((cell) => cell.page))],
    unitConfirmed: statementPages.some((page) =>
      /(?:don vi(?: tinh)?\s*[:(]?\s*(?:vnd|dong)|currency\s*:\s*vnd|don vi tien te.*dong)/u.test(
        plain(page.text),
      ),
    ),
  };
}

export function createCandidateSource(candidate, fetched, extraction) {
  const metadata = validateCandidateOriginal(candidate, extraction);
  const parsed = extractCandidateCells(extraction);
  if (!parsed.unitConfirmed) throw sourceError("candidate_unit_unconfirmed");
  const template = SECURITIES_SOURCE_DOCUMENTS.find(
    (source) => source.companyId === candidate.companyId,
  );
  const source = {
    id: discoveredSourceId(candidate),
    companyId: candidate.companyId,
    periodId: candidate.periodId,
    title: candidate.title,
    titleBasis: candidate.titleBasis,
    url: fetched.url,
    landingUrl: candidate.landingUrl,
    publishedAt: null,
    publicationDateBasis: "not_verified",
    signedAt: null,
    fetchedAt: fetched.fetchedAt,
    hash: fetched.hash,
    bytes: fetched.byteLength,
    pageCount: extraction.pageCount,
    sourceType: extraction.textPageCount > 0 ? "text_pdf" : "scan_pdf",
    auditStatus: "not_verified",
    scope: "consolidated",
    unit: "VND",
    reportType: candidate.periodId.startsWith("FY")
      ? "annual_financial_statements"
      : "interim_financial_statements",
    rights: { ...template.rights, checkedAt: template.rights.checkedAt },
    statementPages: parsed.statementPages,
    contextualPages: [metadata.issuerPage, metadata.scopePage, metadata.periodPage],
    printedPageOffset: null,
    revisionStatus: "discovered_original_requires_review",
    metadata,
  };
  return { source, cells: parsed.cells.filter((cell) => SECURITIES_METRICS[cell.id]) };
}
