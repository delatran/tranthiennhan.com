import { collectDossierIssues } from "./dossier.js";
import {
  calculateDossierMetrics,
  calculateDerivedMetrics,
  normalizeFinancialValue,
} from "./finance.js";
import { matchVerifiedSecuritiesFact } from "./verified-source-facts.js";
import { hasStructuredSecuritiesReport } from "./report-contract.js";

export const SECURITIES_REPORT_POLICY = "automatic-evidence-checks";

const message = (vi, en) => ({ vi, en });
const plainText = (value, locale) =>
  typeof value === "string" ? value : (value?.[locale] ?? value?.en ?? value?.vi ?? "");
const comparisonIssue = (issue) =>
  issue.code === "accounting_basis_changed" ||
  (issue.code.startsWith("incompatible_") &&
    issue.code !== "incompatible_units" &&
    issue.id?.endsWith("comparability"));
const sameRecord = (left, right) =>
  left === right ||
  (left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    Array.isArray(left) === Array.isArray(right) &&
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(
      (key) => Object.hasOwn(right, key) && sameRecord(left[key], right[key]),
    ));

const supplementalDefinitions = {
  operating_cash_flow: message(
    "Tiền thuần tạo ra hoặc sử dụng trong hoạt động kinh doanh trong kỳ, theo báo cáo hợp nhất.",
    "Net cash generated or used by operating activities during the consolidated reporting period.",
  ),
  profit_noncontrolling: message(
    "Phần lợi nhuận sau thuế phân bổ cho các cổ đông khác ngoài cổ đông công ty mẹ.",
    "The portion of consolidated profit after tax allocated to shareholders other than the parent's shareholders.",
  ),
  disposal_gain: message(
    "Khoản lãi kế toán từ chuyển nhượng khoản đầu tư tài chính dài hạn, ghi trong doanh thu hoạt động tài chính.",
    "The accounting gain on disposal of a long-term financial investment, included in financial income.",
  ),
};
const supplementalContextNotes = {
  "fpt-h1-cfo-current": message(
    "Dòng tiền kỳ trước có phạm vi hợp nhất FTEL khác, nên chưa đủ cơ sở tính tăng trưởng trên cùng phạm vi.",
    "The prior reported cash flow has a different FTEL consolidation scope, so like-for-like growth is not established.",
  ),
  "fpt-h1-cfo-prior-reported": message(
    "Số kỳ trước hợp nhất toàn bộ FTEL. Bảng lợi nhuận so sánh cùng phương pháp chưa cung cấp số dòng tiền tương ứng.",
    "The prior reported amount fully consolidated FTEL. The same-method income comparison does not supply corresponding comparable cash flow.",
  ),
  "fpt-h1-nci-current": message(
    "Số này khớp với tổng lợi nhuận sau thuế hợp nhất trừ phần lợi nhuận thuộc cổ đông công ty mẹ.",
    "This amount matches consolidated profit after tax less the parent's profit allocation.",
  ),
  "fpt-h1-nci-prior-restated": message(
    "Số so sánh cùng phương pháp do FPT trình bày trong báo cáo.",
    "FPT presented the comparator on the same accounting method in its report.",
  ),
  "fpt-h1-nci-prior-reported": message(
    "Số kỳ trước theo phạm vi hợp nhất đã công bố ban đầu; phạm vi này khác cột so sánh cùng phương pháp.",
    "The original prior reported amount has a different consolidation scope from the same-method comparison.",
  ),
  "gmd-h1-disposal-gain-current": message(
    "Cần thêm bằng chứng để xác định tiền thực thu và phần đóng góp vào lợi nhuận sau thuế của cổ đông công ty mẹ.",
    "Additional evidence is needed to establish the cash proceeds and the contribution to the parent's after-tax profit.",
  ),
  "gmd-h1-disposal-gain-prior-dash": message(
    "Ô kỳ trước là dấu gạch ngang; dữ liệu giữ trạng thái thiếu số, chưa xác nhận là số 0.",
    "The prior source cell is a dash; it remains non-numeric and is not a verified zero.",
  ),
};

function supplementalDefinition(id, facts) {
  const definition =
    supplementalDefinitions[id] ??
    message(
      "Chỉ tiêu bổ sung được đối chiếu với tài liệu gốc.",
      "A supplemental metric checked against the original document.",
    );
  const notes = facts.map((fact) => supplementalContextNotes[fact.factId]).filter(Boolean);
  return message(
    [definition.vi, ...notes.map((note) => note.vi)].join(" "),
    [definition.en, ...notes.map((note) => note.en)].join(" "),
  );
}

/** Match read-time facts to the independent source ledger before constructing report inputs. */
export function buildSecuritiesReportInputs(dossier, verifiedFacts = []) {
  const metrics = structuredClone(dossier.metrics);
  const supplementalVerifiedFacts = [];
  const rejectedFactIds = [];
  const candidates = new Map();
  for (const record of Array.isArray(verifiedFacts) ? verifiedFacts : []) {
    const fact = matchVerifiedSecuritiesFact(record);
    if (!fact) {
      rejectedFactIds.push(typeof record?.factId === "string" ? record.factId : "unknown_fact");
      continue;
    }
    const period = fact.side === "current" ? dossier.period : dossier.comparisonPeriod;
    const knownBases = [
      ...new Set(dossier.metrics.map((metric) => metric[fact.side]?.basisId).filter(Boolean)),
    ];
    const selectedBasis = period.basisId ?? (knownBases.length === 1 ? knownBases[0] : null);
    if (
      fact.entityId !== dossier.company.id ||
      fact.periodId !== period.id ||
      fact.scope !== period.scope ||
      (selectedBasis && fact.basisId !== selectedBasis) ||
      !dossier.sources.some(
        (source) =>
          source.id === fact.sourceId &&
          String(source.version) === fact.sourceVersion &&
          source.hash === fact.sourceHash,
      ) ||
      metrics.some((metric) => metric.id === fact.id)
    )
      continue;
    const key = `${fact.id}:${fact.side}`;
    const previous = candidates.get(key);
    if (previous && previous.factId !== fact.factId) {
      rejectedFactIds.push(fact.factId, previous.factId);
      candidates.set(key, null);
    } else if (!candidates.has(key)) candidates.set(key, fact);
  }
  const usable = [...candidates.values()].filter(Boolean);
  for (const id of new Set(usable.map((fact) => fact.id))) {
    const facts = usable.filter((fact) => fact.id === id);
    const unit = metrics.find((metric) => /^VND(?:_|$)/u.test(metric.unit))?.unit ?? facts[0].unit;
    const metric = {
      id,
      label: facts[0].label,
      definition: supplementalDefinition(id, facts),
      unit,
      required: false,
      reportInputOrigin: "verified_supplemental_fact",
    };
    for (const side of ["current", "comparison"]) {
      const fact = facts.find((entry) => entry.side === side);
      metric[side] = fact
        ? { ...structuredClone(fact), value: normalizeFinancialValue(fact.value) }
        : {
            value: null,
            unit,
            verification: "missing",
            periodId: (side === "current" ? dossier.period : dossier.comparisonPeriod).id,
          };
    }
    metrics.push(metric);
    supplementalVerifiedFacts.push(...facts);
  }
  return { metrics, supplementalVerifiedFacts, rejectedFactIds: [...new Set(rejectedFactIds)] };
}

/** Derive a report from this exact immutable snapshot; stored readiness is never authority. */
export function projectSecuritiesReport(dossier) {
  const locale = dossier.locale ?? "vi";
  const inputs = buildSecuritiesReportInputs(dossier, dossier.analysis?.research?.verifiedFacts);
  const metrics = calculateDossierMetrics(inputs.metrics, dossier);
  const issues = collectDossierIssues({ ...dossier, metrics });
  const openIssues = issues.filter((issue) => !issue.resolution || issue.requiresSourceImport);
  const reasons = openIssues.map((issue) => ({
    code: issue.code,
    message: structuredClone(issue.message),
    category:
      issue.code === "nonrecurring_item" && issue.severity === "warning"
        ? "business_risk"
        : "limitation",
    affectsReadiness: !(issue.code === "nonrecurring_item" && issue.severity === "warning"),
    metricIds: [...(issue.metricIds ?? [])],
    sourceIds: [...(issue.sourceIds ?? [])],
  }));
  const material = openIssues.filter((issue) => issue.severity === "material");
  const blockedSources = new Set(
    material.filter((issue) => !comparisonIssue(issue)).flatMap((issue) => issue.sourceIds ?? []),
  );
  const globalBlock = material.some(
    (issue) => !issue.metricIds?.length && !issue.sourceIds?.length && !comparisonIssue(issue),
  );
  const safeMetrics = metrics
    .filter(
      (metric) =>
        !globalBlock &&
        !material.some(
          (issue) =>
            !comparisonIssue(issue) &&
            (issue.metricIds?.includes(metric.id) ||
              [metric.current?.sourceId, metric.comparison?.sourceId].some((id) =>
                issue.sourceIds?.includes(id),
              )),
        ),
    )
    .filter((metric) =>
      [metric.current, metric.comparison].some(
        (point) => point?.value !== null && point?.value !== undefined,
      ),
    );
  const includedMetricIds = new Set(safeMetrics.map((metric) => metric.id));
  const omittedMetricIds = metrics
    .filter((metric) => !includedMetricIds.has(metric.id))
    .map((metric) => metric.id);
  const nonComparable = new Set(
    safeMetrics
      .filter((metric) => metric.calculation.absoluteChange.status.startsWith("incompatible_"))
      .map((metric) => metric.id),
  );
  const derivedMetrics = calculateDerivedMetrics(safeMetrics, dossier);
  const includedDerivedIds = new Set(derivedMetrics.map((metric) => metric.id));
  const original = dossier.analysis ?? {
    origin: "rules",
    claims: [],
    questions: [],
    limitations: [],
  };
  const claims = Array.isArray(original.claims) ? original.claims : [];
  const structuredReport = original.origin === "model" && hasStructuredSecuritiesReport(original);
  const semantic = original.validation?.semantic;
  const semanticOmittedClaimIds = new Set(
    structuredReport && Array.isArray(semantic?.claims) && Array.isArray(semantic.checkedClaimIds)
      ? semantic.claims
          .filter(
            (check) =>
              typeof check?.id === "string" &&
              check.id.length > 0 &&
              semantic.checkedClaimIds.includes(check.id) &&
              ["unsupported", "unclear"].includes(check.verdict),
          )
          .map((check) => check.id)
      : [],
  );
  const lineage = dossier.analysisLineage;
  const modelContextValid =
    original.origin !== "model" ||
    (Number.isSafeInteger(original.inputRevision) &&
      original.inputRevision < dossier.revision &&
      (original.dossierId === undefined || original.dossierId === dossier.id) &&
      (original.revision === undefined || original.revision === original.inputRevision) &&
      (!lineage ||
        (lineage.generatedInRevision === original.inputRevision + 1 &&
          lineage.generatedInRevision <= dossier.revision)));
  const failedValidation =
    structuredReport &&
    (original.validation?.deterministic?.status !== "passed" ||
      original.validation?.semantic?.status === "failed");
  const sourceMatches = (id, version) =>
    !blockedSources.has(id) &&
    dossier.sources.some(
      (source) =>
        source.id === id &&
        (version === undefined || String(source.version) === String(version)) &&
        /^[a-f0-9]{64}$/iu.test(source.hash ?? ""),
    );
  const originMatches = (origin) => {
    const metric = safeMetrics.find((item) => item.id === origin.metricId);
    const point = ["current", "comparison"].includes(origin.side) ? metric?.[origin.side] : null;
    if (
      !point ||
      typeof origin.sourceValue !== "number" ||
      origin.sourceValue !== point.value ||
      origin.sourceUnit !== (point.unit ?? metric.unit) ||
      origin.displayUnit !== metric.unit ||
      (origin.id ?? origin.sourceId) !== point.sourceId ||
      String(origin.version ?? origin.sourceVersion) !== String(point.sourceVersion) ||
      (origin.correctionId ?? null) !== (point.correctionId ?? null) ||
      !sameRecord(origin.locator, point.locator)
    )
      return false;
    if (origin.origin === "verified_supplemental_fact")
      return inputs.supplementalVerifiedFacts.some(
        (fact) =>
          fact.factId === origin.factId &&
          fact.id === origin.metricId &&
          fact.side === origin.side &&
          Number(fact.value) === origin.sourceValue &&
          matchVerifiedSecuritiesFact({
            ...fact,
            sourceHash: origin.sourceHash,
            locator: origin.locator,
            verificationReceipt: origin.verificationReceipt,
          }),
      );
    return (
      origin.origin ===
      (point.verification === "user_verified" ? "analyst_correction" : "source_extraction")
    );
  };
  const claimSafe = (claim) =>
    modelContextValid &&
    !failedValidation &&
    !globalBlock &&
    (claim.metricIds ?? []).every(
      (id) => (includedMetricIds.has(id) || includedDerivedIds.has(id)) && !nonComparable.has(id),
    ) &&
    (claim.sourceIds ?? []).every((id) => sourceMatches(id)) &&
    (claim.evidenceQuotes ?? []).every(
      (quote) =>
        quote.sourceVersion !== undefined && sourceMatches(quote.sourceId, quote.sourceVersion),
    ) &&
    (claim.numericOrigins ?? []).every(
      (origin) =>
        sourceMatches(origin.id ?? origin.sourceId, origin.version ?? origin.sourceVersion) &&
        originMatches(origin),
    );
  const eligibleClaims = claims.filter(claimSafe);
  const eligibleClaimIds = new Set(eligibleClaims.map((claim) => claim.id));
  const acceptedClaims = eligibleClaims.filter((claim) => !semanticOmittedClaimIds.has(claim.id));
  const acceptedClaimIds = new Set(acceptedClaims.map((claim) => claim.id));
  const policyOmittedClaimIds = claims
    .filter((claim) => !eligibleClaimIds.has(claim.id))
    .map((claim) => claim.id);
  const omittedClaimIds = [...new Set([...policyOmittedClaimIds, ...semanticOmittedClaimIds])];
  const storedClaimIds = new Set(claims.map((claim) => claim.id));
  const totalClaimCount =
    claims.length + [...semanticOmittedClaimIds].filter((id) => !storedClaimIds.has(id)).length;
  const add = (code, vi, en, metricIds = [], sourceIds = []) =>
    reasons.push({
      code,
      message: message(vi, en),
      metricIds,
      sourceIds,
      category: "limitation",
      affectsReadiness: true,
    });
  const evidenceNotes = (dossier.evidenceNotes ?? []).filter(
    (note) =>
      note.sourceVersion !== undefined &&
      sourceMatches(note.sourceId, note.sourceVersion) &&
      note.locator &&
      (note.locator.page || note.locator.table || note.locator.rowCode || note.locator.rowLabel),
  );
  if (evidenceNotes.length !== (dossier.evidenceNotes ?? []).length)
    add(
      "source_notes_omitted",
      "Ghi chú nguồn không khớp tài liệu và phiên bản đã chọn được giữ riêng trong lịch sử bằng chứng.",
      "Source notes that do not match the selected document and version remain in the evidence audit only.",
    );
  if (inputs.rejectedFactIds.length)
    add(
      "supplemental_evidence_rejected",
      "Một số số liệu bổ sung không khớp bằng chứng đã kiểm chứng và không được sử dụng.",
      "Some supplemental facts do not match independently verified evidence and are not used.",
    );
  if (original.origin !== "model")
    add(
      "ai_answer_unavailable",
      "Chưa có câu trả lời AI cho yêu cầu này. Báo cáo chỉ gồm dữ liệu được kiểm chứng và phép tính bằng mã.",
      "An AI answer to this request is unavailable. This report contains verified data and calculations only.",
    );
  else if (!modelContextValid)
    add(
      "analysis_context_mismatch",
      "Phân tích AI không khớp phiên bản đầu vào đã lưu; chỉ hiển thị dữ liệu được kiểm chứng.",
      "The AI analysis does not match its saved input revision; only verified data are shown.",
    );
  else if (!structuredReport)
    add(
      "historical_analysis",
      "Đây là phân tích AI đã lưu từ phiên bản trước, chưa có quy trình kiểm tra báo cáo hiện tại.",
      "This is historical AI analysis without the current report validation record.",
    );
  else if (failedValidation)
    add(
      "ai_validation_failed",
      "Câu trả lời AI chưa vượt qua kiểm tra; báo cáo chỉ giữ phần dữ liệu có thể đối chiếu.",
      "The AI answer did not pass validation; the report retains only traceable data.",
    );
  else if (original.validation?.semantic?.status !== "passed")
    add(
      "semantic_validation_limited",
      "Một số diễn giải AI chưa được kiểm tra đầy đủ và được ghi rõ trong giới hạn báo cáo.",
      "Some AI interpretations have limited semantic validation, as disclosed in the report gaps.",
    );
  if (
    structuredReport &&
    original.research?.status !== "complete" &&
    !original.research?.gaps?.length
  )
    add(
      "research_incomplete",
      "Phạm vi đọc nguồn chưa đầy đủ cho yêu cầu; không coi phần chưa đọc là đã xác nhận.",
      "Source coverage is incomplete for the request; unread material is not treated as confirmed.",
    );
  for (const gap of original.research?.gaps ?? [])
    add(
      "research_gap",
      `${plainText(gap.topic, locale)}: ${plainText(gap.reason, locale)}${gap.impact ? ` ${plainText(gap.impact, locale)}` : ""}`,
      `${plainText(gap.topic, "en")}: ${plainText(gap.reason, "en")}${gap.impact ? ` ${plainText(gap.impact, "en")}` : ""}`,
    );
  if (omittedMetricIds.length)
    add(
      "metrics_omitted",
      "Các chỉ tiêu còn thiếu bằng chứng hoặc có mâu thuẫn được loại khỏi bảng kết quả; bản gốc vẫn nằm trong phần nguồn.",
      "Metrics with missing evidence or contradictions are excluded from reported results; originals remain in the evidence audit.",
      omittedMetricIds,
    );
  if (omittedClaimIds.length)
    add(
      "claims_omitted",
      "Nhận xét phụ thuộc dữ liệu chưa đủ cơ sở đã được loại khỏi phần kết luận.",
      "Claims relying on unsupported inputs are excluded from the conclusions.",
    );
  const modelAvailable =
    original.origin === "model" &&
    modelContextValid &&
    !failedValidation &&
    acceptedClaims.length > 0;
  if (
    original.origin === "model" &&
    !modelAvailable &&
    !reasons.some((entry) =>
      ["analysis_context_mismatch", "ai_validation_failed"].includes(entry.code),
    )
  ) {
    add(
      "ai_answer_unavailable",
      "Chưa có câu trả lời AI đủ cơ sở cho yêu cầu này; bảng dữ liệu không thay thế câu trả lời phân tích.",
      "A supported AI answer is unavailable for this request; the data table is not a substitute for that answer.",
    );
  }
  const hasFacts =
    safeMetrics.length > 0 ||
    acceptedClaims.some((claim) => ["source_fact", "calculated"].includes(claim.kind));
  const state = !hasFacts
    ? "unavailable"
    : reasons.some((reason) => reason.affectsReadiness)
      ? "limited"
      : "ready";
  if (!hasFacts)
    add(
      "no_supported_report_content",
      "Chưa có đủ dữ liệu có thể kiểm chứng để tạo báo cáo; cần bổ sung hoặc đọc lại nguồn phù hợp.",
      "There is no sufficiently supported content for a report; suitable sources need to be added or read again.",
    );
  const summaryIds = structuredReport
    ? (original.report?.summaryClaimIds ?? []).filter((id) => acceptedClaimIds.has(id))
    : acceptedClaims.slice(0, 2).map((claim) => claim.id);
  const summary = modelAvailable
    ? summaryIds
        .map((id) => plainText(acceptedClaims.find((claim) => claim.id === id)?.text, locale))
        .join(" ") ||
      acceptedClaims
        .slice(0, 2)
        .map((claim) => plainText(claim.text, locale))
        .join(" ")
    : plainText(
        message(
          "Chưa có câu trả lời AI cho yêu cầu này. Dưới đây là dữ liệu được kiểm chứng và các giới hạn còn lại.",
          "An AI answer to this request is unavailable. Verified data and remaining limitations are shown below.",
        ),
        locale,
      );
  const analysis = {
    ...structuredClone(original),
    origin: modelAvailable ? "model" : "rules",
    summary,
    claims: structuredClone(acceptedClaims),
    reportMode: modelAvailable ? (structuredReport ? "automatic" : "historical") : "data_only",
    questions: policyOmittedClaimIds.length ? [] : structuredClone(original.questions ?? []),
    limitations: policyOmittedClaimIds.length ? [] : structuredClone(original.limitations ?? []),
  };
  if (analysis.report)
    analysis.report = {
      ...analysis.report,
      summaryClaimIds: summaryIds,
      sections: (analysis.report.sections ?? [])
        .map((section) => ({
          ...section,
          claimIds: section.claimIds.filter((id) => acceptedClaimIds.has(id)),
        }))
        .filter((section) => section.claimIds.length),
    };
  const reportReadiness = {
    policyVersion: SECURITIES_REPORT_POLICY,
    revision: dossier.revision,
    state,
    canExport: hasFacts,
    reasons,
    omittedMetricIds,
    omittedClaimIds,
    includedMetricCount: safeMetrics.length,
    totalMetricCount: metrics.length,
    includedClaimCount: acceptedClaims.length,
    totalClaimCount,
  };
  return {
    reportReadiness,
    reportProjection: {
      metrics: structuredClone(safeMetrics),
      derivedMetrics,
      analysis,
      verifiedFacts: structuredClone(
        inputs.supplementalVerifiedFacts.filter((fact) => includedMetricIds.has(fact.id)),
      ),
      evidenceNotes: structuredClone(evidenceNotes),
      issues,
    },
  };
}
