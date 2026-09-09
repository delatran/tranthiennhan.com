import {
  calculateDerivedMetrics,
  calculateDossierMetrics,
  normalizeFinancialValue,
} from "../../shared/securities/finance.js";
import { matchVerifiedSecuritiesFact } from "../../shared/securities/verified-source-facts.js";
import { buildSecuritiesReportInputs } from "../../shared/securities/report.js";
import {
  buildModelSnapshot,
  buildSecuritiesReviewContext,
  normalizeSecuritiesHistory,
  MODEL_CHAT_CONTEXT_INSTRUCTION,
  SECURITIES_MODEL_ID,
  SecuritiesModelError,
} from "./model-contract.js";
import {
  publishSecuritiesReceipts,
  requestSecuritiesModel,
  SECURITIES_MODEL_TIMEOUT_MS,
} from "./model-transport.js";
import {
  SECURITIES_REPORT_PROMPT_ID,
  securitiesReportInstruction,
  securitiesReportLocaleInstruction,
  operatingCashFlowMetricId,
  SECURITIES_CONSISTENCY_INSTRUCTION,
  SECURITIES_RESEARCH_LIMITS,
  exactKeys,
  safeId,
  safeText,
  plainObject,
  securitiesReportSchema,
  validateReportEnvelope,
  validateSecuritiesReport,
  securitiesReportRepairFeedback,
  reportIdentity,
  securitiesConsistencySchema,
  consistencyFormatRepairState,
  validateConsistencyCheck,
  applyConsistencyCheck,
} from "./model-report.js";

export {
  SECURITIES_MODEL_ID,
  SecuritiesModelError,
  validateSecuritiesAnalysis,
} from "./model-contract.js";
export { SECURITIES_REPORT_PROMPT_ID as SECURITIES_PROMPT_ID } from "./model-report.js";
export { readSecuritiesModelCapabilities } from "./model-transport.js";
export { searchSecuritiesSources, fetchSecuritiesSource } from "./model-retrieval.js";

const bytes = (value) =>
  new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
const HASH = /^[a-f0-9]{64}$/u;
const REPORT_CAPABLE_TIMEOUT_MS = 180_000;
const safeCode = (error) =>
  /^[a-z][a-z0-9_]{1,79}$/u.test(error?.code) ? error.code : "source_read_unavailable";
const abort = (signal, receipts = []) => {
  if (signal?.aborted) throw new SecuritiesModelError("model_cancelled", 499, { receipts });
};
const contextTooLarge = () => {
  throw new SecuritiesModelError("model_context_too_large", 413);
};
const invalidResearch = (reason) => {
  throw new SecuritiesModelError("model_invalid_research", 502, { validationReason: reason });
};
const foldResearchText = (value) =>
  String(value).normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/gu, "d").toLowerCase();
const CASH_NOTE_TOPIC =
  /working capital|receivables?|inventor(?:y|ies)|payables?|phai thu|phai tra|ton kho|von luu dong/u;
const BANK_CASH_NOTE_TOPIC =
  /loan balances?|loans to customers|customer (?:loans|deposits)|lending (?:cash|movements)|deposit (?:balances|movements)|interbank|cho vay khach hang|tien gui (?:cua )?khach hang|tien gui (?:tai )?cac to chuc tin dung|lien ngan hang/u;
const NOTE_TOPICS = {
  net_interest_income: {
    match: /net interest income|interest (?:income|expenses?)|thu nhap lai|chi phi lai/u,
    queries: ["thu nhap lai thuan", "chi phi lai va cac chi phi tuong tu"],
  },
  net_fee_income: {
    match:
      /net fee|fee(?: and commission)? income|lai thuan tu (?:hoat dong )?dich vu|thu nhap (?:tu )?dich vu/u,
    queries: ["lai thuan tu hoat dong dich vu"],
  },
  operating_expenses: {
    match: /operating (?:expenses?|costs?)|staff costs?|chi phi hoat dong|chi phi nhan vien/u,
    queries: ["chi phi hoat dong", "chi phi nhan vien"],
  },
  credit_loss_provision: {
    match:
      /(?:credit|loan)[- ]loss provisions?|provisions? for (?:credit|loan) losses|du phong rui ro tin dung/u,
    queries: ["chi phi du phong rui ro tin dung"],
  },
  expenses: {
    match: /expenses?|costs?|chi phi|gia von/u,
    queries: ["chi phi ban hang", "chi phi quan ly doanh nghiep"],
  },
  financial_income: {
    match:
      /financial income|finance income|disposal gain|doanh thu hoat dong tai chinh|chi phi tai chinh|lai chuyen nhuong/u,
    queries: ["doanh thu hoat dong tai chinh", "chi phi tai chinh"],
  },
  income_tax: {
    match: /income tax|tax expense|thue thu nhap doanh nghiep/u,
    queries: ["thue thu nhap doanh nghiep"],
  },
  transactions: {
    match: /disposal|divest|transfer|transaction|chuyen nhuong|thoai von|thanh ly/u,
    queries: ["chuyen nhuong cong ty con", "lai chuyen nhuong"],
  },
  investing_cash: {
    match:
      /investing cash|cash flow.*invest|cash proceeds|luu chuyen tien.*dau tu|tien thu.*chuyen nhuong/u,
    queries: ["luu chuyen tien tu hoat dong dau tu", "tien thu tu chuyen nhuong"],
  },
};
function analysisNoteTopics(question, operation, dossier) {
  if (operation !== "analysis") return [];
  const query = foldResearchText(question);
  const recurrence =
    /sustainab|repeatab|recurr|one.off|disposal|divest|ben vung|co ben|ben khong|duy tri|tai dien|chuyen nhuong|thoai von/u.test(
      query,
    );
  const profitability = /profitab|efficien|profit margin|kiem loi|hieu qua|bien loi nhuan/u.test(
    query,
  );
  const attribution =
    /parent|non.controlling|co dong cong ty me|khong kiem soat/u.test(query) &&
    /group|total|tong|tap doan/u.test(query);
  const earningsCause =
    !attribution &&
    /caus|driv|why|nguyen nhan|tai sao|vi sao|do dau/u.test(query) &&
    /earnings?|profits?|loi nhuan|doanh thu|revenue/u.test(query);
  if (dossier.company?.sectorId === "banking") {
    const bankTopics = [
      "net_interest_income",
      "net_fee_income",
      "operating_expenses",
      "credit_loss_provision",
    ];
    const performance =
      !attribution &&
      (profitability ||
        earningsCause ||
        recurrence ||
        /performance|earnings?|profits?|ket qua|loi nhuan/u.test(query));
    return [
      ...new Set([
        ...(performance
          ? bankTopics
          : bankTopics.filter((id) => NOTE_TOPICS[id].match.test(query))),
        ...(NOTE_TOPICS.income_tax.match.test(query) ? ["income_tax"] : []),
        ...(NOTE_TOPICS.transactions.match.test(query) ? ["transactions", "investing_cash"] : []),
      ]),
    ].map((id) => ({ id, ...NOTE_TOPICS[id], attempted: false }));
  }
  return [
    ...new Set([
      ...(profitability || earningsCause ? ["expenses", "financial_income", "income_tax"] : []),
      ...(recurrence ? ["financial_income", "transactions", "investing_cash"] : []),
    ]),
  ].map((id) => ({ id, ...NOTE_TOPICS[id], attempted: false }));
}

export function validateSecuritiesReadRequest(input, dossier) {
  if (!exactKeys(input, ["sourceId", "sourceVersion", "query", "pages"]))
    invalidResearch("read_arguments");
  const source = dossier.sources.find(
    (entry) =>
      entry.id === input.sourceId &&
      String(entry.version) === input.sourceVersion &&
      entry.version === "sha256:" + entry.hash,
  );
  // A malformed query cannot hide a different source or version in a repairable
  // syntax error. Scope failures always stop before another provider request.
  if (
    !source ||
    (Array.isArray(input.pages) &&
      input.pages.some((page) => Number.isSafeInteger(page) && page > (source.pageCount ?? 999)))
  )
    invalidResearch("read_scope");
  if (
    !safeId(input.sourceId) ||
    !safeText(input.sourceVersion, 120) ||
    !safeText(input.query, 500, 0) ||
    !Array.isArray(input.pages) ||
    input.pages.length > 6 ||
    new Set(input.pages).size !== input.pages.length ||
    !input.pages.every((page) => Number.isSafeInteger(page) && page > 0 && page <= 999) ||
    (!input.query.trim() && !input.pages.length)
  )
    invalidResearch("read_arguments");
  return { ...input, query: input.query.trim(), pages: [...input.pages] };
}

function supplementalFacts(packet) {
  if (packet.verifiedFacts === undefined) return [];
  if (!Array.isArray(packet.verifiedFacts) || packet.verifiedFacts.length > 40)
    invalidResearch("supplemental_ledger");
  if (!packet.verifiedFacts.length) return [];
  const ledgerHashes = packet.receipt.verifiedLedgerHashes ?? [packet.receipt.verifiedLedgerSha256];
  if (
    !Array.isArray(ledgerHashes) ||
    !ledgerHashes.length ||
    !ledgerHashes.every((hash) => HASH.test(hash))
  )
    invalidResearch("supplemental_ledger");
  const facts = [];
  for (const fact of packet.verifiedFacts) {
    if (
      !plainObject(fact) ||
      !matchVerifiedSecuritiesFact(fact) ||
      !safeId(fact.id) ||
      !safeId(fact.factId) ||
      !["current", "comparison"].includes(fact.side) ||
      fact.verification !== "verified" ||
      fact.sourceId !== packet.sourceId ||
      fact.sourceVersion !== packet.sourceVersion ||
      fact.sourceHash !== packet.sourceHash ||
      !safeId(fact.periodId) ||
      !safeText(fact.scope, 100) ||
      !["VND", "VND_thousand", "VND_million", "VND_billion"].includes(fact.unit) ||
      !Number.isSafeInteger(fact.locator?.page) ||
      !packet.coverage.returnedPages.includes(fact.locator.page) ||
      !plainObject(fact.verificationReceipt) ||
      !ledgerHashes.includes(fact.verificationReceipt.sha256) ||
      !safeText(fact.verificationReceipt.id, 200) ||
      !safeText(fact.verificationReceipt.proofId, 200) ||
      !HASH.test(fact.verificationReceipt.proofSha256) ||
      !HASH.test(fact.verificationReceipt.renderSha256)
    ) {
      invalidResearch("supplemental_identity");
    }
    let value;
    try {
      value = normalizeFinancialValue(fact.value);
    } catch {
      invalidResearch("supplemental_value");
    }
    // A verified source dash remains missing and cannot become zero.
    if (value === null && fact.rawText !== "-" && fact.rawText !== "—")
      invalidResearch("supplemental_value");
    facts.push(structuredClone(fact));
  }
  return facts;
}

function applySupplementalFacts(working, original, facts) {
  for (const fact of facts) {
    const prior = working.supplementalVerifiedFacts.find((item) => item.factId === fact.factId);
    if (prior && JSON.stringify(prior) !== JSON.stringify(fact))
      invalidResearch("supplemental_conflict");
    if (!prior) working.supplementalVerifiedFacts.push(fact);
  }
  const inputs = buildSecuritiesReportInputs(original, working.supplementalVerifiedFacts);
  if (inputs.rejectedFactIds.length) invalidResearch("supplemental_scope");
  // Keep original cached calculations intact so their recomputation guard still
  // detects tampering. Only new source-ledger rows require a new calculation.
  working.metrics = inputs.metrics.map((metric) =>
    original.metrics.some((entry) => entry.id === metric.id)
      ? metric
      : calculateDossierMetrics([metric], original)[0],
  );
}

async function sourcePacket(packet, request, dossier) {
  const source = dossier.sources.find((entry) => entry.id === request.sourceId);
  if (
    !plainObject(packet) ||
    packet.sourceId !== request.sourceId ||
    packet.sourceVersion !== request.sourceVersion ||
    packet.sourceHash !== source.hash ||
    !Array.isArray(packet.passages) ||
    packet.passages.length > 12 ||
    new Set(packet.passages.map((passage) => passage?.id)).size !== packet.passages.length ||
    bytes(packet) > 32_768 ||
    !plainObject(packet.coverage) ||
    !plainObject(packet.receipt) ||
    packet.receipt.evidenceType !== "local_original" ||
    !safeText(packet.receipt.parserVersion, 200) ||
    packet.receipt.sourceId !== packet.sourceId ||
    packet.receipt.sourceVersion !== packet.sourceVersion ||
    packet.receipt.sourceHash !== packet.sourceHash ||
    !HASH.test(packet.receipt.representationHash ?? "") ||
    !HASH.test(packet.receipt.extractionFileSha256 ?? "") ||
    !HASH.test(packet.receipt.responseSha256 ?? "")
  )
    invalidResearch("source_packet_identity");
  const { receipt: _receipt, ...body } = packet;
  const encoded = new TextEncoder().encode(JSON.stringify(body));
  const responseHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoded))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (responseHash !== packet.receipt.responseSha256) invalidResearch("source_response_hash");
  const coverage = packet.coverage;
  if (
    !Number.isSafeInteger(coverage.totalPages) ||
    coverage.totalPages < 1 ||
    coverage.totalPages > 999 ||
    (source.pageCount && coverage.totalPages !== source.pageCount) ||
    !Number.isSafeInteger(coverage.searchedPageCount) ||
    coverage.searchedPageCount < 0 ||
    coverage.searchedPageCount > coverage.totalPages ||
    !Array.isArray(coverage.returnedPages) ||
    !coverage.returnedPages.every(
      (page) =>
        Number.isSafeInteger(page) &&
        page > 0 &&
        page <= coverage.totalPages &&
        (!request.pages.length || request.pages.includes(page)),
    ) ||
    typeof coverage.truncated !== "boolean" ||
    !Array.isArray(coverage.unusablePages) ||
    !coverage.unusablePages.every(
      (page) => Number.isSafeInteger(page) && page > 0 && page <= coverage.totalPages,
    )
  )
    invalidResearch("source_coverage");
  const passages = packet.passages.map((passage) => {
    if (
      !safeId(passage.id) ||
      !safeText(passage.text, 1000, 12) ||
      passage.sourceId !== packet.sourceId ||
      passage.sourceVersion !== packet.sourceVersion ||
      passage.originalHash !== packet.sourceHash ||
      passage.extractionHash !== packet.receipt.extractionFileSha256 ||
      passage.representationHash !== packet.receipt.representationHash ||
      !Number.isSafeInteger(passage.locator?.page) ||
      !coverage.returnedPages.includes(passage.locator.page) ||
      !safeText(passage.extractionMethod, 100) ||
      !["extracted_unreviewed", "unusable", "verified"].includes(passage.verification) ||
      !Array.isArray(passage.qualityFlags) ||
      passage.qualityFlags.length > 20 ||
      !passage.qualityFlags.every((flag) => safeText(flag, 100)) ||
      !plainObject(passage.pageHeader) ||
      !safeText(passage.pageHeader.text, 1000) ||
      passage.pageHeader.locator?.page !== passage.locator.page
    )
      invalidResearch("source_passage");
    return {
      id: passage.id,
      text: passage.text,
      locator: passage.locator,
      extractionMethod: passage.extractionMethod,
      verification: passage.verification,
      qualityFlags: passage.qualityFlags,
      pageHeader: passage.pageHeader,
      sourceId: passage.sourceId,
      sourceVersion: passage.sourceVersion,
      originalHash: passage.originalHash,
      extractionHash: passage.extractionHash,
      representationHash: passage.representationHash,
    };
  });
  const receipt = {
    evidenceType: "local_original",
    parserVersion: packet.receipt.parserVersion,
    sourceHash: packet.sourceHash,
    extractionFileSha256: packet.receipt.extractionFileSha256,
    responseSha256: packet.receipt.responseSha256,
    fullTextVerified: false,
    ...(packet.receipt.verifiedLedgerSha256
      ? { verifiedLedgerSha256: packet.receipt.verifiedLedgerSha256 }
      : {}),
    ...(packet.receipt.verifiedLedgerHashes
      ? { verifiedLedgerHashes: packet.receipt.verifiedLedgerHashes }
      : {}),
    ...Object.fromEntries(
      [
        "representationVersion",
        "representationHash",
        "readerVersion",
        "qualityVersion",
        "manifestSha256",
        "requestSha256",
        "readAt",
      ]
        .filter((key) => safeText(packet.receipt[key], 200))
        .map((key) => [key, packet.receipt[key]]),
    ),
  };
  let sourceQuality = null;
  let pageQuality = [];
  if (packet.source?.extraction !== undefined) {
    const quality = packet.source.extraction;
    if (
      !plainObject(quality) ||
      quality.fullTextVerified !== false ||
      !safeText(quality.qualityVersion, 200) ||
      !["pageCount", "extractedPages", "textPages", "ocrPages"].every(
        (key) =>
          Number.isSafeInteger(quality[key]) &&
          quality[key] >= 0 &&
          quality[key] <= coverage.totalPages,
      ) ||
      !["pagesWithoutText", "pagesWithoutUsableText", "pagesRequiringReview"].every(
        (key) =>
          Array.isArray(quality[key]) &&
          quality[key].length <= coverage.totalPages &&
          quality[key].every(
            (page) => Number.isSafeInteger(page) && page > 0 && page <= coverage.totalPages,
          ),
      )
    )
      invalidResearch("source_quality");
    sourceQuality = Object.fromEntries(
      [
        "qualityVersion",
        "fullOriginalFetched",
        "pageCount",
        "extractedPages",
        "textPages",
        "ocrPages",
        "pagesWithoutText",
        "pagesWithoutUsableText",
        "pagesRequiringReview",
        "fullTextVerified",
        "materialCellsVerified",
        "cellsDigest",
        "method",
      ]
        .filter((key) => quality[key] !== undefined)
        .map((key) => [key, structuredClone(quality[key])]),
    );
  }
  if (packet.pageQuality !== undefined) {
    if (!Array.isArray(packet.pageQuality) || packet.pageQuality.length > coverage.totalPages)
      invalidResearch("page_quality");
    pageQuality = packet.pageQuality.map((page) => {
      if (
        !Number.isSafeInteger(page.page) ||
        page.page < 1 ||
        page.page > coverage.totalPages ||
        !["unusable", "extracted_unreviewed"].includes(page.status) ||
        !safeText(page.method, 100) ||
        !Array.isArray(page.qualityFlags) ||
        !page.qualityFlags.every((flag) => safeText(flag, 100))
      )
        invalidResearch("page_quality");
      return Object.fromEntries(
        [
          "page",
          "method",
          "status",
          "ocrConfidence",
          "textCharacters",
          "qualityFlags",
          "reviewedNumericCellsOnly",
        ]
          .filter((key) => page[key] !== undefined)
          .map((key) => [key, structuredClone(page[key])]),
      );
    });
  }
  return {
    passages,
    coverage: structuredClone(coverage),
    receipt,
    facts: supplementalFacts(packet),
    sourceQuality,
    pageQuality,
  };
}

function createResearch(dossier, readEvidence, signal, locale, progress) {
  const working = structuredClone(dossier);
  working.supplementalVerifiedFacts = [];
  const state = {
    steps: [],
    gaps: [],
    seenRequests: new Set(),
    evidenceBytes: 0,
    passageCount: 0,
    readsAllowed: typeof readEvidence === "function",
  };
  const missing = (reason) => ({
    topic: locale === "vi" ? "Phạm vi tài liệu đã đọc" : "Material read for this report",
    reason,
    impact:
      locale === "vi"
        ? "Kết luận chỉ dựa trên phần tài liệu và số liệu đã kiểm tra."
        : "Conclusions are limited to the material and financial values checked.",
  });
  if (!state.readsAllowed)
    state.gaps.push(
      missing(
        locale === "vi"
          ? "Bộ đọc tài liệu gốc hiện không sẵn sàng; báo cáo vẫn sử dụng bằng chứng đã lưu trong hồ sơ."
          : "The original-document reader is unavailable; the report can still use the evidence already stored in the dossier.",
      ),
    );
  async function read(input) {
    abort(signal);
    const request = validateSecuritiesReadRequest(input, dossier);
    const fingerprint = JSON.stringify([
      request.sourceId,
      request.sourceVersion,
      request.query.normalize("NFKC").toLowerCase(),
      [...request.pages].sort((a, b) => a - b),
    ]);
    const step = {
      id: "read-" + (state.steps.length + 1),
      ...request,
      status: "unavailable",
      passageIds: [],
    };
    if (state.seenRequests.has(fingerprint)) {
      step.status = "repeated";
      step.code = "no_new_query";
      state.steps.push(step);
      return false;
    }
    if (!state.readsAllowed || state.seenRequests.size >= SECURITIES_RESEARCH_LIMITS.maxReads) {
      state.readsAllowed = false;
      step.code = "research_boundary_reached";
      state.steps.push(step);
      return false;
    }
    state.seenRequests.add(fingerprint);
    let raw;
    await progress({
      stage: "reading_sources",
      readCount: state.seenRequests.size,
      sourceId: request.sourceId,
      pages: request.pages,
    });
    try {
      raw = await readEvidence({ ...request, limit: 12 });
    } catch (error) {
      abort(signal);
      step.code = safeCode(error);
      state.steps.push(step);
      state.gaps.push(
        missing(
          locale === "vi"
            ? "Một phần tài liệu không đọc được trong lần chạy này."
            : "A requested part of the document could not be read during this run.",
        ),
      );
      return false;
    }
    abort(signal);
    const checked = await sourcePacket(raw, request, dossier);
    step.coverage = checked.coverage;
    step.receipt = checked.receipt;
    if (checked.sourceQuality) step.sourceQuality = checked.sourceQuality;
    if (checked.pageQuality.length) step.pageQuality = checked.pageQuality;
    const source = working.sources.find((entry) => entry.id === request.sourceId);
    source.excerpts ??= [];
    if (checked.sourceQuality) source.readQuality = checked.sourceQuality;
    source.readPageQuality = [
      ...new Map(
        [...(source.readPageQuality ?? []), ...checked.pageQuality].map((page) => [
          page.page,
          page,
        ]),
      ).values(),
    ];
    const unusablePages = new Set([
      ...checked.coverage.unusablePages,
      ...checked.pageQuality.filter((page) => page.status === "unusable").map((page) => page.page),
      ...(checked.sourceQuality?.pagesWithoutUsableText ?? []),
      ...checked.passages
        .filter(
          (passage) =>
            passage.verification === "unusable" || passage.qualityFlags.includes("unusable"),
        )
        .map((passage) => passage.locator.page),
    ]);
    const usablePassages = checked.passages.filter(
      (passage) => !unusablePages.has(passage.locator.page),
    );
    if (unusablePages.size)
      state.gaps.push(
        missing(
          locale === "vi"
            ? "Bộ đọc ghi nhận trang không có văn bản sử dụng được. Phần đó đã bị loại khỏi bằng chứng; điều này không có nghĩa tài liệu gốc không công bố thông tin."
            : "The reader identified pages without usable text. That material was excluded from the evidence; this does not establish that the original document omitted the information.",
        ),
      );
    if (checked.coverage.truncated)
      state.gaps.push(
        missing(
          locale === "vi"
            ? "Kết quả đọc chỉ trả về một phần văn bản phù hợp. Phạm vi này chưa chứng minh toàn bộ nội dung cần tìm đã được đọc."
            : "The read returned only part of the matching text. This coverage does not establish that all relevant content was read.",
        ),
      );
    const additions = [];
    for (const passage of usablePassages) {
      const previous = source.excerpts.find((entry) => entry.id === passage.id);
      if (
        previous &&
        (previous.text !== passage.text || previous.locator?.page !== passage.locator.page)
      )
        invalidResearch("passage_id_conflict");
      if (!previous) additions.push(passage);
    }
    const addedBytes = bytes(additions);
    if (
      state.evidenceBytes + addedBytes > SECURITIES_RESEARCH_LIMITS.maxEvidenceBytes ||
      state.passageCount + additions.length > SECURITIES_RESEARCH_LIMITS.maxPassages
    ) {
      state.readsAllowed = false;
      step.code = "research_context_boundary";
      state.steps.push(step);
      state.gaps.push(
        missing(
          locale === "vi"
            ? "Phần văn bản đọc thêm đã đạt phạm vi của lần phân tích."
            : "Additional text reached the scope of this analysis run.",
        ),
      );
      return false;
    }
    source.excerpts.push(...additions);
    state.evidenceBytes += addedBytes;
    state.passageCount += additions.length;
    const priorFacts = working.supplementalVerifiedFacts.length;
    applySupplementalFacts(working, dossier, checked.facts);
    step.passageIds = usablePassages.map((passage) => passage.id);
    step.status = usablePassages.length || checked.facts.length ? "read" : "empty";
    if (unusablePages.size) step.code = "source_partially_usable";
    if (!usablePassages.length && !checked.facts.length)
      state.gaps.push(
        missing(
          locale === "vi"
            ? "Lần đọc này không trả về đoạn văn bản dùng được hoặc ô số liệu đã xác minh. Báo cáo không coi đó là bằng chứng thông tin không tồn tại."
            : "This read returned no usable passage or verified financial cell. The report does not treat that as evidence that the information does not exist.",
        ),
      );
    state.steps.push(step);
    return additions.length > 0 || working.supplementalVerifiedFacts.length > priorFacts;
  }
  const snapshot = () => {
    const value = buildModelSnapshot(working);
    value.derivedMetrics = calculateDerivedMetrics(working.metrics, working);
    value.sources = value.sources.map((source) => ({
      ...source,
      pageCount: working.sources.find((item) => item.id === source.id).pageCount,
      readQuality: working.sources.find((item) => item.id === source.id).readQuality ?? null,
      readPageQuality: working.sources.find((item) => item.id === source.id).readPageQuality ?? [],
      evidencePassages:
        working.sources
          .find((item) => item.id === source.id)
          .excerpts?.filter((passage) => safeId(passage.id) && safeText(passage.text, 1000))
          .map((passage) => ({
            id: passage.id,
            text: passage.text,
            locator: passage.locator,
            verification: passage.verification ?? "curated_excerpt",
            extractionMethod: passage.extractionMethod ?? "curated_excerpt",
            qualityFlags: passage.qualityFlags ?? [],
            ...(passage.pageHeader ? { pageHeader: passage.pageHeader } : {}),
          })) ?? [],
    }));
    if (bytes(value) > 240_000) contextTooLarge();
    return value;
  };
  return {
    state,
    working,
    read,
    snapshot,
    summary: () => ({
      readsAllowed: state.readsAllowed,
      readCount: state.seenRequests.size,
      remainingReads: Math.max(0, SECURITIES_RESEARCH_LIMITS.maxReads - state.seenRequests.size),
      steps: state.steps,
      gaps: state.gaps,
      verifiedFacts: working.supplementalVerifiedFacts,
    }),
  };
}

async function synthesize(
  {
    dossier,
    question = "",
    history = [],
    locale = "vi",
    env,
    signal,
    fetchImpl,
    onReceipt,
    onDiagnostic,
    timeoutMs,
    readEvidence,
    onProgress,
    historyTruncated = false,
  },
  operation,
) {
  if (
    !["vi", "en"].includes(locale) ||
    !safeText(question, 4000, 0) ||
    (onDiagnostic !== undefined && typeof onDiagnostic !== "function") ||
    (readEvidence !== undefined && typeof readEvidence !== "function") ||
    (onProgress !== undefined && typeof onProgress !== "function") ||
    typeof historyTruncated !== "boolean"
  )
    throw new SecuritiesModelError("invalid_model_question", 400);
  const base = buildModelSnapshot(dossier);
  const conversation = normalizeSecuritiesHistory(history, dossier);
  const reviewContext =
    operation === "chat" ? buildSecuritiesReviewContext(dossier, locale) : undefined;
  if (bytes({ base, conversation, reviewContext, question }) > 260_000) contextTooLarge();
  if (env?.SECURITIES_MODEL_MODE !== "live")
    throw new SecuritiesModelError("model_not_configured", 503);
  const receipts = [];
  const progress = async (value) => {
    if (onProgress) {
      // Progress is an observation aid. A transient display write cannot erase
      // a valid analysis or substitute for the mandatory receipt persistence.
      try {
        await onProgress(value);
      } catch {
        /* The receipt path remains strict. */
      }
    }
  };
  const research = createResearch(dossier, readEvidence, signal, locale, progress);
  let feedback = null;
  let repairs = 0;
  let technicalRepairs = 0;
  let forceFinal = false;
  let previousFailure = null;
  const failureHistory = [];
  const banking = dossier.company?.sectorId === "banking";
  const cashMetricId = operatingCashFlowMetricId(dossier);
  const cashNoteTopic = banking ? BANK_CASH_NOTE_TOPIC : CASH_NOTE_TOPIC;
  const noteTopics = analysisNoteTopics(question || dossier.query || "", operation, dossier);
  let noteGapRecorded = false;
  let cashReadRequired = false;
  let cashReadAttempted = false;
  let cashGapRecorded = false;
  async function publish(result, validation) {
    for (const receipt of result.receipts) {
      receipt.validation = receipt === result.receipt ? validation : { status: "not_run" };
      if (!receipts.includes(receipt)) receipts.push(receipt);
    }
    await publishSecuritiesReceipts(result.receipts, onReceipt);
  }
  async function call(schema, schemaName, instruction, payload) {
    abort(signal, receipts);
    const content = JSON.stringify(payload);
    if (bytes(content) > 260_000) contextTooLarge();
    // A report-capable round may still choose another read. Mandatory read-only
    // rounds and consistency checks keep the shorter transport deadline.
    const reportCapable = schema.properties?.action?.enum?.includes("final") === true;
    return requestSecuritiesModel({
      env,
      signal,
      fetchImpl,
      timeoutMs:
        timeoutMs ?? (reportCapable ? REPORT_CAPABLE_TIMEOUT_MS : SECURITIES_MODEL_TIMEOUT_MS),
      operation,
      schema,
      schemaName,
      messages: [
        { role: "system", content: instruction },
        { role: "user", content },
      ],
    });
  }
  async function diagnostic(result) {
    if (!onDiagnostic) return;
    try {
      await onDiagnostic({
        event: "analysis_validation_failed",
        operation,
        validation: result.receipt.validation,
        output: result.output,
        receipt: result.receipt,
      });
    } catch {
      throw new SecuritiesModelError("model_diagnostic_persistence_failed", 503, { receipts });
    }
  }
  try {
    if (research.state.readsAllowed) {
      for (const source of dossier.sources) {
        await research.read({
          sourceId: source.id,
          sourceVersion: String(source.version),
          query: banking
            ? "luu chuyen tien thuan tu hoat dong kinh doanh"
            : "lưu chuyển tiền từ hoạt động kinh doanh",
          pages: [],
        });
        if (!research.state.readsAllowed) break;
      }
    }
    cashReadRequired =
      Number(
        research.working.metrics.find((metric) => metric.id === cashMetricId)?.current?.value,
      ) < 0 &&
      /cash|collections?|working capital|dong tien|thanh tien|thu tien|von luu dong/u.test(
        foldResearchText(question || dossier.query || ""),
      );
    for (let round = 0; round < SECURITIES_RESEARCH_LIMITS.maxRounds; round += 1) {
      abort(signal, receipts);
      const finalRequired = forceFinal || round === SECURITIES_RESEARCH_LIMITS.maxRounds - 1;
      const cashPending = cashReadRequired && !cashReadAttempted;
      const pendingNoteTopics = noteTopics.filter((topic) => !topic.attempted);
      const notesPending = pendingNoteTopics.length > 0;
      if (cashPending && (finalRequired || !research.state.readsAllowed) && !cashGapRecorded) {
        research.state.gaps.push({
          topic:
            locale === "vi" ? "Phạm vi đọc nguyên nhân dòng tiền" : "Cash-driver reading scope",
          reason: banking
            ? locale === "vi"
              ? "Lần chạy chưa hoàn thành lần đọc bổ sung về cho vay, tiền gửi khách hàng và dòng tiền liên ngân hàng."
              : "This run did not complete an additional read of lending, customer deposits and interbank cash flows."
            : locale === "vi"
              ? "Lần chạy chưa hoàn thành lần đọc bổ sung về phải thu, tồn kho và phải trả."
              : "This run did not complete an additional read of receivables, inventory and payables.",
          impact:
            locale === "vi"
              ? "Không thể coi phần nguyên nhân chưa đọc là thông tin không có trong tài liệu gốc."
              : "Unread drivers cannot be described as absent from the original disclosure.",
        });
        cashGapRecorded = true;
      }
      if (notesPending && (finalRequired || !research.state.readsAllowed) && !noteGapRecorded) {
        research.state.gaps.push({
          topic:
            locale === "vi"
              ? "Phạm vi đọc thuyết minh cho câu hỏi"
              : "Notes needed for this question",
          reason:
            locale === "vi"
              ? "Lần chạy chưa hoàn thành các lần đọc thuyết minh cần thiết để giải thích nguyên nhân hoặc khả năng duy trì lợi nhuận."
              : "This run did not complete the note reads needed to explain earnings drivers or repeatability.",
          impact:
            locale === "vi"
              ? "Nguyên nhân và khả năng duy trì chưa được xác lập từ phần chưa đọc; không thể coi đó là thông tin không được công bố."
              : "Unread drivers and repeatability remain unestablished; this does not mean the issuer omitted the information.",
        });
        noteGapRecorded = true;
      }
      const payload = {
        task:
          operation === "chat"
            ? "Answer this follow-up directly and complete any needed source reading"
            : "Complete the company analysis and explain the financial meaning",
        operation,
        locale,
        question,
        untrustedDossier: research.snapshot(),
        untrustedHistory: conversation,
        historyTruncated,
        ...(reviewContext ? { untrustedReviewContext: reviewContext } : {}),
        untrustedResearch: research.summary(),
        finalRequired,
        ...(cashReadRequired
          ? {
              cashResearchRequirement: {
                status: cashReadAttempted ? "attempted_check_actual_read_results" : "pending",
                metricId: cashMetricId,
                instruction: banking
                  ? "First discover the original bank lending, customer-deposit and interbank cash-flow notes with short plain ASCII source-language topic queries and empty pages arrays. Prefer distinct lending and funding queries when relevant within the existing read limits; a relevant single query is allowed. Do not substitute industrial inventory or supplier-payables queries. Bank cash flows reflect lending and funding, so a negative sign or comparison with profit alone cannot establish profit quality or cash stress. Follow actual returned note references and page locators after discovery. An attempt is not proof that its results explain a driver; retain unverified amounts as unverified."
                  : "First discover the original working-capital and cash-flow notes with short plain ASCII source-language topic queries and empty pages arrays. Prefer two or three distinct queries for receivables, inventory and supplier-payables when relevant, within the existing read limits; a relevant single query is allowed. The reader matches Vietnamese accents insensitively. Search across the source rather than guessing a page subset. After discovery you may follow actual returned note references and page locators, including a user-requested page. An attempt is not proof that its results explain a driver. Use actual coverage and retain unverified amounts as unverified.",
                queryTopics: banking
                  ? [
                      "cho vay khach hang",
                      "tien gui cua khach hang",
                      "tien gui tai cac to chuc tin dung",
                    ]
                  : [
                      "phai thu khach hang ngan han",
                      "hang ton kho",
                      "phai tra nguoi ban ngan han",
                      "working capital cash flow notes",
                    ],
              },
            }
          : {}),
        ...(noteTopics.length
          ? {
              analysisResearchRequirement: {
                status: notesPending ? "pending" : "attempted_check_actual_read_results",
                instruction:
                  "Plan original-note discovery for every pending topic relevant to the question, using short plain ASCII queries in the source language and pages:[] within the existing limits. A query can cover related topics. These are reading needs, not predetermined findings. Then inspect returned note text and follow observed headings or pages as needed; an attempted query alone does not establish a driver or sustainable earnings. Keep unverified numerical cells unverified.",
                topics: noteTopics.map(({ id, attempted, queries }) => ({
                  id,
                  status: attempted ? "attempted_check_actual_read_results" : "pending",
                  queryTopics: queries,
                })),
              },
            }
          : {}),
        ...(feedback ? { repairFeedback: feedback } : {}),
      };
      await progress({ stage: "writing_report", readCount: research.state.seenRequests.size });
      const schema = structuredClone(securitiesReportSchema(dossier));
      if ((cashPending || notesPending) && research.state.readsAllowed && !finalRequired) {
        schema.properties.action.enum = ["read"];
        schema.properties.readRequests.minItems = 1;
        schema.properties.readRequests.items.properties.pages.maxItems = 0;
        schema.properties.readRequests.items.properties.query.minLength = 1;
        for (const field of [
          schema.properties.claims,
          schema.properties.report.properties.summaryClaimIds,
          schema.properties.report.properties.sections,
          schema.properties.gaps,
          schema.properties.limitations,
        ]) {
          field.maxItems = 0;
          field.description = "Must be an empty array during this read action.";
        }
      }
      const result = await call(
        schema,
        "securities_analyst_report",
        securitiesReportInstruction(operation, locale, dossier) +
          (operation === "chat" ? "\n" + MODEL_CHAT_CONTEXT_INSTRUCTION : ""),
        payload,
      );
      let candidate;
      try {
        validateReportEnvelope(result.output, dossier);
        if (result.output.action === "read") {
          if (payload.finalRequired) invalidResearch("final_required_after_no_progress");
          result.output.readRequests.forEach((request) =>
            validateSecuritiesReadRequest(request, dossier),
          );
          if (
            (cashPending || notesPending) &&
            research.state.readsAllowed &&
            result.output.readRequests.some(
              (request) =>
                request.pages.length ||
                (!(cashPending && cashNoteTopic.test(foldResearchText(request.query))) &&
                  !pendingNoteTopics.some((topic) =>
                    topic.match.test(foldResearchText(request.query)),
                  )),
            )
          ) {
            throw new SecuritiesModelError("model_research_required", 502, {
              validationReason:
                cashPending && !notesPending
                  ? "cash_discovery_requires_topic_queries"
                  : "note_discovery_requires_topic_queries",
            });
          }
        } else {
          if ((cashPending || notesPending) && research.state.readsAllowed && !finalRequired) {
            throw new SecuritiesModelError("model_research_required", 502, {
              validationReason:
                cashPending && !notesPending
                  ? "cash_notes_not_investigated"
                  : "question_notes_not_investigated",
            });
          }
          candidate = validateSecuritiesReport(result.output, research.working, locale);
        }
      } catch (error) {
        await publish(result, {
          status: "failed",
          code: error.code ?? "model_invalid_output",
          ...(error.validationReason ? { reason: error.validationReason } : {}),
          ...(error.validationClaimId ? { claimId: error.validationClaimId } : {}),
        });
        await diagnostic(result);
        const readSyntax =
          error.code === "model_invalid_research" &&
          error.validationReason === "read_arguments" &&
          result.output.action === "read" &&
          result.output.readRequests.every(
            (request) =>
              exactKeys(request, ["sourceId", "sourceVersion", "query", "pages"]) &&
              dossier.sources.some(
                (source) =>
                  source.id === request.sourceId && source.version === request.sourceVersion,
              ),
          );
        if (readSyntax && technicalRepairs < SECURITIES_RESEARCH_LIMITS.maxTechnicalRepairs) {
          const fingerprint = "read_arguments";
          technicalRepairs += 1;
          forceFinal =
            fingerprint === previousFailure ||
            technicalRepairs >= SECURITIES_RESEARCH_LIMITS.maxTechnicalRepairs;
          previousFailure = fingerprint;
          feedback = {
            deterministicFailure: { code: error.code, reason: error.validationReason },
            previousFailures: [...failureHistory],
            ...(feedback?.untrustedRejectedReport
              ? {
                  untrustedRejectedReport: feedback.untrustedRejectedReport,
                  summaryBudget: feedback.summaryBudget,
                }
              : {}),
            instruction:
              (forceFinal
                ? "Return the final report from evidence already read, with the actual remaining gap. Do not request another read."
                : "No rejected read was executed. Write a fresh read plan using the same available source identities and valid pages, with short plain ASCII queries in the source language, such as phai thu khach hang. The reader matches Vietnamese accents insensitively. Do not decode, repair or reuse corrupt escape text. Keep pages empty while discovery is pending; otherwise an empty query is allowed with specific pages.") +
              "\n" +
              securitiesReportLocaleInstruction(locale),
          };
          failureHistory.push(feedback.deterministicFailure);
          continue;
        }
        if (
          ["dossier_id_mismatch", "revision_mismatch"].includes(error.validationReason) ||
          [
            "model_invalid_research",
            "model_invalid_source_binding",
            "model_invalid_metric_binding",
            "model_unverified_numeric_input",
            "model_unverified_correction",
          ].includes(error.code)
        )
          throw error;
        const fingerprint = JSON.stringify([
          error.code,
          error.validationReason,
          error.validationClaimId,
        ]);
        if (
          repairs >= SECURITIES_RESEARCH_LIMITS.maxRepairRounds ||
          fingerprint === previousFailure
        )
          throw error;
        repairs += 1;
        previousFailure = fingerprint;
        feedback = securitiesReportRepairFeedback(
          result.output,
          research.working,
          locale,
          error,
          failureHistory,
          operation,
        );
        failureHistory.push(feedback.deterministicFailure);
        continue;
      }
      if (result.output.action === "read") {
        await publish(result, {
          status: "passed",
          checks: ["exact_model", "immutable_revision", "closed_read_arguments"],
          stage: "research_plan",
        });
        let progress = false;
        for (const request of result.output.readRequests) {
          const priorReadCount = research.state.seenRequests.size;
          progress = (await research.read(request)) || progress;
          const step = research.state.steps.at(-1);
          const source = research.working.sources.find((item) => item.id === request.sourceId);
          const returnedText = (step?.passageIds ?? [])
            .map((id) => {
              const passage = source?.excerpts?.find((item) => item.id === id);
              return passage ? passage.text + " " + (passage.pageHeader?.text ?? "") : "";
            })
            .join("\n");
          if (research.state.seenRequests.size > priorReadCount) {
            const attemptedText = foldResearchText(request.query + "\n" + returnedText);
            if (cashReadRequired && cashNoteTopic.test(attemptedText)) cashReadAttempted = true;
            for (const topic of noteTopics)
              if (topic.match.test(attemptedText)) topic.attempted = true;
          }
        }
        forceFinal = !progress || !research.state.readsAllowed;
        continue;
      }
      await publish(result, {
        status: "pending",
        checks: [
          "exact_model",
          "immutable_revision",
          "numeric_binding",
          "quote_containment",
          "closed_schema",
        ],
        stage: "report_draft",
      });
      const hash = await reportIdentity(candidate, research.working);
      await progress({ stage: "checking_report", readCount: research.state.seenRequests.size });
      let consistency;
      let checked;
      let expectedVerdicts;
      while (!consistency) {
        checked = await call(
          securitiesConsistencySchema(dossier, hash),
          "securities_report_consistency",
          SECURITIES_CONSISTENCY_INSTRUCTION +
            (operation === "chat" ? "\n" + MODEL_CHAT_CONTEXT_INSTRUCTION : ""),
          {
            dossierId: dossier.id,
            revision: dossier.revision,
            narrativeHash: hash,
            operation,
            locale,
            question,
            untrustedDossier: research.snapshot(),
            untrustedResearch: research.summary(),
            untrustedReport: candidate,
            untrustedHistory: conversation,
            historyTruncated,
            ...(reviewContext ? { untrustedReviewContext: reviewContext } : {}),
            ...(payload.analysisResearchRequirement
              ? { analysisResearchRequirement: payload.analysisResearchRequirement }
              : {}),
            ...(expectedVerdicts
              ? {
                  syntaxRepair: {
                    immutableVerdicts: expectedVerdicts,
                    instruction:
                      "Keep every verdict unchanged. Rewrite only malformed reason strings in concise English ASCII; do not re-evaluate or replace the report.",
                  },
                }
              : {}),
          },
        );
        try {
          consistency = validateConsistencyCheck(
            checked.output,
            candidate,
            dossier,
            hash,
            expectedVerdicts,
          );
        } catch (error) {
          await publish(checked, {
            status: "failed",
            code: error.code,
            reason: error.validationReason,
            stage: "model_consistency_check",
          });
          await diagnostic(checked);
          const repair = ["consistency_notes", "consistency_claim"].includes(error.validationReason)
            ? consistencyFormatRepairState(checked.output, candidate, dossier, hash)
            : null;
          if (!repair || technicalRepairs >= SECURITIES_RESEARCH_LIMITS.maxTechnicalRepairs)
            throw error;
          expectedVerdicts = expectedVerdicts ?? repair;
          technicalRepairs += 1;
        }
      }
      await publish(checked, {
        status: "passed",
        stage: "model_consistency_check",
        checks: ["exact_model", "immutable_revision", "narrative_hash", "all_claims_checked"],
        semanticStatus: consistency.status,
        method: "same_model_consistency_check",
      });
      if (consistency.status !== "passed") {
        const failed = consistency.claims.filter(
          (claim) => !["supported", "supported_interpretation"].includes(claim.verdict),
        );
        if (consistency.notes.verdict !== "supported")
          failed.push({ id: "report-notes", ...consistency.notes });
        const fingerprint = JSON.stringify(
          failed.map(({ id, verdict, reason }) => ({ id, verdict, reason })),
        );
        if (
          repairs < SECURITIES_RESEARCH_LIMITS.maxRepairRounds &&
          fingerprint !== previousFailure
        ) {
          repairs += 1;
          previousFailure = fingerprint;
          feedback = {
            consistencyFailures: failed,
            priorReport: candidate,
            previousFailures: [...failureHistory],
            instruction:
              "Repair these specific claims with available evidence, read further if useful, or omit them and explain the actual evidence gap. Preserve corrections to the prior deterministic failures and keep the summary near the target rendered word budget.\n" +
              securitiesReportLocaleInstruction(locale),
          };
          continue;
        }
      }
      const final = applyConsistencyCheck(candidate, consistency, locale);
      const gaps = [
        ...new Map(
          [...research.state.gaps, ...final.gaps].map((gap) => [
            JSON.stringify([gap.topic, gap.reason, gap.impact]),
            gap,
          ]),
        ).values(),
      ];
      delete final.gaps;
      final.research = {
        status: !research.state.steps.some((step) => step.status === "read")
          ? "not_available"
          : gaps.length
            ? "limited"
            : "complete",
        steps: research.state.steps,
        gaps,
        verifiedFacts: research.working.supplementalVerifiedFacts,
      };
      result.receipt.validation = {
        status: "passed",
        stage: "report",
        checks: final.validation.deterministic.checks,
        semanticStatus: consistency.status,
        method: "same_model_consistency_check",
      };
      await publishSecuritiesReceipts([result.receipt], onReceipt);
      abort(signal, receipts);
      return {
        ...final,
        model: SECURITIES_MODEL_ID,
        locale,
        receipt: result.receipt,
        receipts,
        promptVersion: SECURITIES_REPORT_PROMPT_ID,
      };
    }
    throw new SecuritiesModelError("model_research_no_report", 502, { receipts });
  } catch (error) {
    const additional = (error.receipts ?? []).filter((receipt) => !receipts.includes(receipt));
    if (additional.length) {
      receipts.push(...additional);
      await publishSecuritiesReceipts(additional, onReceipt);
    }
    if (signal?.aborted) throw new SecuritiesModelError("model_cancelled", 499, { receipts });
    throw new SecuritiesModelError(error.code ?? "model_invalid_output", error.status ?? 502, {
      receipts,
      ...(error.validationReason ? { validationReason: error.validationReason } : {}),
    });
  }
}

export function analyzeSecurities(options) {
  return synthesize(options, "analysis");
}
export function chatSecurities(options) {
  return synthesize(options, "chat");
}
