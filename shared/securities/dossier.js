import {
  calculateDossierMetrics,
  calculateDerivedMetrics,
  compareFinancialMetric,
  financialComparability,
  normalizeFinancialValue,
  reconcileReportedChange,
  reconcileProfitAttribution,
} from "./finance.js";

export const DOSSIER_SCHEMA_VERSION = 1;
const MAX_METRICS = 80;
const VERIFICATIONS = new Set(["verified", "user_verified"]);

export class DossierError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.name = "DossierError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function requireClosedObject(value, allowed, required = []) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new DossierError("invalid_input");
  if (
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    required.some((key) => !(key in value))
  )
    throw new DossierError("invalid_input");
  return value;
}

export function requireText(value, { min = 1, max = 1000, pattern } = {}) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value) ||
    (pattern && !pattern.test(value))
  ) {
    throw new DossierError("invalid_input");
  }
  return value.trim();
}

export function requireRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new DossierError("invalid_revision");
  return value;
}

export function requireRequestId(value) {
  return requireText(value, { min: 8, max: 96, pattern: /^[a-zA-Z0-9_-]+$/u });
}

function hasEvidence(point, sources) {
  const source = sources.find(
    (item) => item.id === point?.sourceId && String(item.version) === String(point?.sourceVersion),
  );
  return Boolean(
    /^[a-f0-9]{64}$/iu.test(source?.hash ?? "") &&
    source?.url &&
    /^https:\/\//u.test(source.url) &&
    !["search_snippet", "snippet", "challenge"].includes(source.sourceType) &&
    source.contentTruncated !== true &&
    point?.locator &&
    point.locator.precision &&
    (point.locator.precision === "document" ||
      point.locator.page ||
      point.locator.table ||
      point.locator.rowCode ||
      point.locator.rowLabel),
  );
}

export function collectDossierIssues(dossier) {
  const generated = [];
  const add = (id, code, metricIds, message) =>
    generated.push({
      id,
      code,
      severity: "material",
      metricIds,
      sourceIds: [],
      message,
      generated: true,
      resolution: null,
    });
  if (financialComparability({}, {}, dossier) !== "ok") {
    add("period-comparability", "incompatible_periods", [], {
      vi: "Hai kỳ không cùng loại hoặc phạm vi kế toán.",
      en: "Periods differ in type or accounting scope.",
    });
  }
  for (const metric of dossier.metrics) {
    const comparison = compareFinancialMetric(metric, dossier);
    if (comparison.absoluteChange.status.startsWith("incompatible_")) {
      add(`${metric.id}-comparability`, comparison.absoluteChange.status, [metric.id], {
        vi: "Hai giá trị không cùng thực thể, kỳ, đơn vị hoặc cơ sở so sánh.",
        en: "The values differ in entity, period, unit or comparison basis.",
      });
    }
    const reported = reconcileReportedChange(metric, comparison.relativeChangePct);
    if (reported?.status === "conflict")
      add(`${metric.id}-reported-rate`, "source_rate_conflict", [metric.id], {
        vi: "Tỷ lệ trong nguồn không khớp số liệu đã chọn sau khi xét độ làm tròn.",
        en: "The reported rate conflicts with the selected figures after allowing for stated rounding.",
      });
    if (reported?.status === "unknown_precision")
      generated.push({
        id: `${metric.id}-rate-precision`,
        code: "reported_rate_precision_unknown",
        severity: "warning",
        metricIds: [metric.id],
        sourceIds: [],
        resolution: null,
        generated: true,
        message: {
          vi: "Chưa xác định độ làm tròn của tỷ lệ nguồn để kết luận mâu thuẫn.",
          en: "The reported rate's rounding precision is unknown; an arithmetic conflict is not established.",
        },
      });
    for (const side of ["current", "comparison"]) {
      const point = metric[side];
      const period = side === "current" ? dossier.period : dossier.comparisonPeriod;
      const source = dossier.sources.find(
        (item) =>
          item.id === point?.sourceId && String(item.version) === String(point?.sourceVersion),
      );
      if (
        (point?.entityId && point.entityId !== dossier.company.id) ||
        (source?.companyId && source.companyId !== dossier.company.id) ||
        (point?.periodId && point.periodId !== period.id) ||
        (point?.scope && point.scope !== period.scope)
      ) {
        add(`${metric.id}-${side}-context`, "source_context_mismatch", [metric.id], {
          vi: "Số liệu hoặc tài liệu thuộc doanh nghiệp, kỳ hoặc phạm vi khác hồ sơ.",
          en: "The value or source belongs to a different company, period or accounting scope.",
        });
      }
      if (point?.value === null || point?.value === undefined) {
        if (metric.required !== false)
          add(`${metric.id}-${side}-missing`, "missing_input", [metric.id], {
            vi: "Thiếu số liệu cần thiết; không thay bằng 0.",
            en: "A required value is missing; it is not zero.",
          });
      } else if (!hasEvidence(point, dossier.sources)) {
        add(`${metric.id}-${side}-evidence`, "missing_evidence", [metric.id], {
          vi: "Giá trị chưa gắn đủ tài liệu và phiên bản nguồn.",
          en: "The value lacks a traceable source version.",
        });
      } else if (
        !VERIFICATIONS.has(point.verification) ||
        (point.verification === "user_verified" &&
          !(dossier.corrections ?? []).some(
            (correction) =>
              correction.id === point.correctionId &&
              correction.sourceChecked === true &&
              correction.metricId === metric.id &&
              correction.side === side &&
              correction.value === point.value &&
              correction.sourceId === point.sourceId &&
              String(correction.sourceVersion) === String(point.sourceVersion),
          ))
      ) {
        add(`${metric.id}-${side}-verification`, "unverified_value", [metric.id], {
          vi: "Số liệu trọng yếu chưa được kiểm chứng từ nguồn.",
          en: "A material value has not been verified against its source.",
        });
      }
    }
  }
  for (const side of ["current", "comparison"]) {
    const profit = dossier.metrics.find((metric) => metric.id === "profit_after_tax");
    const parent = dossier.metrics.find((metric) => metric.id === "profit_parent");
    const minority = dossier.metrics.find((metric) => metric.id === "profit_noncontrolling");
    if (profit && parent && minority) {
      const attribution = reconcileProfitAttribution(profit, parent, minority, side);
      if (attribution.status === "conflict" || attribution.status.startsWith("incompatible_"))
        add(
          `profit-attribution-${side}`,
          attribution.status === "conflict" ? "profit_attribution_conflict" : attribution.status,
          [profit.id, parent.id, minority.id],
          {
            vi: "Phân bổ lợi nhuận sau thuế chưa đối chiếu được với tổng cùng đơn vị, kỳ và cơ sở kế toán.",
            en: "Parent and noncontrolling profit do not reconcile to the total on the same unit, period and accounting basis.",
          },
        );
    }
  }
  const originals = (dossier.sourceIssues ?? []).map((issue) => {
    let resolution =
      dossier.resolutions?.find((entry) => entry.issueId === issue.id) ?? issue.resolution ?? null;
    if (
      !resolution &&
      !issue.requiresSourceImport &&
      ["source_verification_required", "source_revision_detected"].includes(issue.code) &&
      issue.metricIds?.length
    ) {
      const metrics = issue.metricIds.map((id) =>
        dossier.metrics.find((metric) => metric.id === id),
      );
      const checked = metrics.every(
        (metric) =>
          metric &&
          [metric.current, metric.comparison].every(
            (point) =>
              VERIFICATIONS.has(point?.verification) && hasEvidence(point, dossier.sources),
          ),
      );
      if (checked) {
        const humanChecked = metrics.every((metric) =>
          [metric.current, metric.comparison].every(
            (point) => point.verification === "user_verified",
          ),
        );
        resolution = {
          reason: humanChecked
            ? "Each affected material cell was explicitly checked against the source in recorded corrections."
            : "Each affected material cell has a verified source version and traceable evidence.",
          at: dossier.updatedAt,
          revision: dossier.revision,
          method: humanChecked ? "cell_verification" : "source_validation",
        };
      }
    }
    return { ...issue, resolution };
  });
  return [...originals, ...generated];
}

function rulesAnalysis(dossier) {
  return {
    origin: "rules",
    model: null,
    summary: {
      vi: "Bảng so sánh được tính bằng mã từ số liệu có nguồn. Phân tích AI chưa chạy.",
      en: "The comparison is calculated in code from sourced figures. AI analysis has not run.",
    },
    claims: dossier.metrics
      .filter((metric) => metric.calculation.absoluteChange.status === "ok")
      .map((metric) => ({
        id: `change-${metric.id}`,
        kind: "calculated",
        metricIds: [metric.id],
        sourceIds: [
          ...new Set([metric.current.sourceId, metric.comparison.sourceId].filter(Boolean)),
        ],
        text: {
          vi: "Chênh lệch và tỷ lệ thay đổi được tính từ hai cột nguồn đã chọn.",
          en: "The change is calculated from the two selected source columns.",
        },
      })),
    questions: [],
    limitations: [],
    receipt: null,
  };
}

function recompute(dossier) {
  dossier.metrics = calculateDossierMetrics(dossier.metrics, dossier);
  dossier.derivedMetrics = calculateDerivedMetrics(dossier.metrics, dossier);
  dossier.issues = collectDossierIssues(dossier);
  dossier.analysis = rulesAnalysis(dossier);
  dossier.analysisLineage = null;
  return dossier;
}

export function carryForwardDossierAnalysis(previous, next, reason) {
  next.analysis = structuredClone(previous.analysis);
  next.previousAnalysis = structuredClone(previous.previousAnalysis ?? null);
  next.analysisLineage =
    previous.analysis?.origin === "model"
      ? {
          generatedInRevision:
            previous.analysisLineage?.generatedInRevision ??
            (Number.isSafeInteger(previous.analysis.inputRevision)
              ? previous.analysis.inputRevision + 1
              : null),
          carriedFromRevision: previous.revision,
          carriedAt: next.updatedAt,
          reason,
        }
      : null;
  return next;
}

export function createDossier(
  dataset,
  { id, locale = "vi", query = "", now = new Date().toISOString() },
) {
  if (
    !dataset?.company?.id ||
    !dataset.period?.id ||
    !dataset.comparisonPeriod?.id ||
    !Array.isArray(dataset.metrics) ||
    dataset.metrics.length < 1 ||
    dataset.metrics.length > MAX_METRICS ||
    !Array.isArray(dataset.sources) ||
    dataset.sources.length > 32
  )
    throw new DossierError("invalid_source_dataset", 422);
  if (
    new Set(dataset.metrics.map((metric) => metric.id)).size !== dataset.metrics.length ||
    new Set(dataset.sources.map((source) => `${source.id}:${source.version}`)).size !==
      dataset.sources.length
  )
    throw new DossierError("duplicate_source_identifier", 422);
  const source = structuredClone(dataset);
  const metrics = source.metrics.map((metric) => ({
    ...metric,
    current: { ...metric.current, value: normalizeFinancialValue(metric.current?.value) },
    comparison: { ...metric.comparison, value: normalizeFinancialValue(metric.comparison?.value) },
  }));
  return recompute({
    schemaVersion: DOSSIER_SCHEMA_VERSION,
    id,
    revision: 1,
    status: "draft",
    locale,
    query,
    company: source.company,
    period: source.period,
    comparisonPeriod: source.comparisonPeriod,
    comparisonBasis: source.comparisonBasis ?? null,
    sources: source.sources,
    metrics,
    originalMetrics: structuredClone(metrics),
    sourceIssues: source.issues ?? [],
    evidenceNotes: source.evidenceNotes ?? [],
    freshness: source.freshness ?? null,
    corrections: [],
    resolutions: [],
    notes: "",
    previousAnalysis: null,
    approval: null,
    createdAt: now,
    updatedAt: now,
    revisionEvent: "created",
  });
}

export function reviseDossier(
  previous,
  input,
  { now = new Date().toISOString(), correctionId = () => crypto.randomUUID() } = {},
) {
  requireClosedObject(
    input,
    ["expectedRevision", "requestId", "changes", "resolutions", "notes"],
    ["expectedRevision", "requestId"],
  );
  requireRevision(input.expectedRevision);
  requireRequestId(input.requestId);
  if (input.expectedRevision !== previous.revision)
    throw new DossierError("revision_conflict", 409, { currentRevision: previous.revision });
  const changes = input.changes ?? [];
  const resolutions = input.resolutions ?? [];
  if (
    !Array.isArray(changes) ||
    changes.length > MAX_METRICS * 2 ||
    !Array.isArray(resolutions) ||
    resolutions.length > 80 ||
    (!changes.length && !resolutions.length && input.notes === undefined)
  )
    throw new DossierError("empty_revision");
  const next = structuredClone(previous);
  delete next.history;
  delete next.chat;
  delete next.chatHistoryTruncated;
  next.revision += 1;
  next.status = "draft";
  next.approval = null;
  next.updatedAt = now;
  next.revisionEvent = "revised";
  const seen = new Set();
  for (const change of changes) {
    requireClosedObject(
      change,
      ["metricId", "periodId", "value", "reason", "sourceChecked"],
      ["metricId", "periodId", "value", "reason"],
    );
    const reason = requireText(change.reason, { min: 8, max: 1000 });
    const metric = next.metrics.find((item) => item.id === change.metricId);
    const side =
      change.periodId === next.period.id
        ? "current"
        : change.periodId === next.comparisonPeriod.id
          ? "comparison"
          : null;
    if (
      !metric ||
      !side ||
      seen.has(`${metric.id}:${side}`) ||
      (change.sourceChecked !== undefined && typeof change.sourceChecked !== "boolean")
    )
      throw new DossierError("invalid_correction");
    seen.add(`${metric.id}:${side}`);
    const value = normalizeFinancialValue(change.value);
    const point = metric[side];
    if (change.sourceChecked === true && !hasEvidence(point, next.sources))
      throw new DossierError("missing_evidence", 422);
    const correction = {
      id: correctionId(),
      metricId: metric.id,
      periodId: change.periodId,
      side,
      originalValue: next.originalMetrics.find((item) => item.id === metric.id)[side].value,
      previousValue: point.value,
      value,
      reason,
      sourceChecked: change.sourceChecked === true,
      sourceId: point.sourceId,
      sourceVersion: point.sourceVersion,
      locator: point.locator,
      at: now,
      revision: next.revision,
    };
    next.corrections.push(correction);
    metric[side] = {
      ...point,
      value,
      originalValue: correction.originalValue,
      corrected: true,
      correctionId: correction.id,
      verification: change.sourceChecked === true ? "user_verified" : "needs_review",
    };
  }
  for (const entry of resolutions) {
    requireClosedObject(entry, ["issueId", "reason"], ["issueId", "reason"]);
    const issue = next.sourceIssues.find((item) => item.id === entry.issueId);
    if (!issue || issue.allowAcknowledgment !== true)
      throw new DossierError("issue_requires_evidence", 422);
    next.resolutions = next.resolutions.filter((item) => item.issueId !== entry.issueId);
    next.resolutions.push({
      issueId: entry.issueId,
      reason: requireText(entry.reason, { min: 8, max: 1000 }),
      at: now,
      revision: next.revision,
    });
  }
  if (input.notes !== undefined) next.notes = requireText(input.notes, { min: 0, max: 12000 });
  if (!changes.length && !resolutions.length)
    return carryForwardDossierAnalysis(previous, next, "analyst_notes_only");
  next.previousAnalysis =
    previous.analysis?.origin === "model"
      ? { revision: previous.revision, invalidatedAt: now, reason: "inputs_changed" }
      : previous.previousAnalysis;
  return recompute(next);
}

export function assertApprovable(dossier, input) {
  requireClosedObject(
    input,
    ["expectedRevision", "requestId", "intent"],
    ["expectedRevision", "requestId", "intent"],
  );
  requireRevision(input.expectedRevision);
  requireRequestId(input.requestId);
  if (input.intent !== "approve_exact_revision")
    throw new DossierError("explicit_approval_required", 422);
  if (input.expectedRevision !== dossier.revision)
    throw new DossierError("revision_conflict", 409, { currentRevision: dossier.revision });
  const blockers = collectDossierIssues(dossier).filter(
    (issue) => issue.severity === "material" && !issue.resolution,
  );
  if (blockers.length)
    throw new DossierError("material_issues_unresolved", 422, {
      issueIds: blockers.map((issue) => issue.id),
    });
  return true;
}

export function applyModelAnalysis(previous, analysis, { now = new Date().toISOString() } = {}) {
  const next = structuredClone(previous);
  delete next.history;
  next.revision += 1;
  next.status = "draft";
  next.approval = null;
  next.updatedAt = now;
  next.revisionEvent = "analyzed";
  next.analysis = {
    ...analysis,
    origin: "model",
    inputRevision: previous.revision,
    model: analysis.receipt?.model ?? "meta/muse-spark-1.3-contributor",
  };
  next.analysisLineage = {
    generatedInRevision: next.revision,
    generatedAt: now,
    reason: "model_generated",
  };
  return next;
}

export function replaceDossierSources(
  previous,
  dataset,
  { now = new Date().toISOString(), preserveSavedInputs = false } = {},
) {
  if (
    dataset.company?.id !== previous.company.id ||
    dataset.period?.id !== previous.period.id ||
    dataset.comparisonPeriod?.id !== previous.comparisonPeriod.id
  )
    throw new DossierError("source_context_mismatch", 422);
  const next = createDossier(dataset, {
    id: previous.id,
    locale: previous.locale,
    query: previous.query,
    now,
  });
  next.revision = previous.revision + 1;
  next.createdAt = previous.createdAt;
  next.notes = previous.notes;
  next.revisionEvent = "sources_refreshed";
  next.previousAnalysis = {
    revision: previous.revision,
    invalidatedAt: now,
    reason: "source_version_changed",
  };
  next.pendingSources = dataset.pendingSources ?? [];
  if (preserveSavedInputs) {
    next.originalMetrics = structuredClone(previous.originalMetrics);
    next.corrections = structuredClone(previous.corrections);
    next.resolutions = structuredClone(previous.resolutions);
    recompute(next);
  }
  return next;
}
