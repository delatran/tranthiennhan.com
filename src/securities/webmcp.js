import { registerImperativeWebMcpCatalog } from "../webmcp-registration.js";
import {
  createSerializedWebMcpActionRunner,
  requireWebMcpAction,
  resolveWebMcpLifecycleSignal,
} from "../webmcp-runtime.js";

const CATALOG = Object.freeze({ name: "nhan-for-securities" });
export const SECURITIES_WEBMCP_MAX_OUTPUT_CHARS = 24_000;
const MAX_TEXT_CHARS = 2_000;
const MAX_PAGE_SIZE = 20;

function frozen(value) {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === "object") frozen(child);
  }
  return Object.freeze(value);
}

function objectSchema(properties, required = Object.keys(properties), rules = {}) {
  return frozen({ type: "object", properties, required, additionalProperties: false, ...rules });
}

const idSchema = frozen({
  type: "string",
  minLength: 1,
  maxLength: 160,
  pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]*$",
});
const revisionSchema = frozen({ type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const bindingProperties = frozen({ dossierId: idSchema, revision: revisionSchema });
const bindingSchema = objectSchema(bindingProperties);
const emptySchema = objectSchema({});

function ownData(value, array = false) {
  let descriptors;
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) !== array) {
      throw new TypeError();
    }
    if (!array && Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError();
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new TypeError("Securities WebMCP input must contain plain JSON data.");
  }
  for (const key of Reflect.ownKeys(descriptors)) {
    if (array && key === "length") continue;
    const descriptor = descriptors[key];
    if (typeof key !== "string" || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Securities WebMCP input must contain own enumerable data fields.");
    }
  }
  return descriptors;
}

function validate(input, schema) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (schema.type === "object") {
    const descriptors = ownData(input);
    const keys = Object.keys(descriptors);
    if (
      keys.some((key) => !Object.hasOwn(schema.properties, key)) ||
      schema.required.some((key) => !Object.hasOwn(descriptors, key)) ||
      (schema.anyOf &&
        !schema.anyOf.some((rule) =>
          rule.required.every((key) => Object.hasOwn(descriptors, key)),
        )) ||
      Object.entries(schema.dependentRequired ?? {}).some(
        ([key, required]) =>
          Object.hasOwn(descriptors, key) &&
          required.some((name) => !Object.hasOwn(descriptors, name)),
      )
    ) {
      throw new TypeError("Securities WebMCP input has missing or unsupported fields.");
    }
    return Object.fromEntries(
      keys.map((key) => [key, validate(descriptors[key].value, schema.properties[key])]),
    );
  }
  if (schema.type === "array") {
    const descriptors = ownData(input, true);
    const length = descriptors.length.value;
    if (
      length < (schema.minItems ?? 0) ||
      length > schema.maxItems ||
      Reflect.ownKeys(descriptors).length !== length + 1
    ) {
      throw new TypeError("Securities WebMCP input array is outside the supported range.");
    }
    return Array.from({ length }, (_, index) => {
      if (!Object.hasOwn(descriptors, index))
        throw new TypeError("Sparse input arrays are unsupported.");
      return validate(descriptors[index].value, schema.items);
    });
  }
  if (input === null && types.includes("null")) return null;
  if (types.includes("string") && typeof input === "string") {
    if (
      input.length < (schema.minLength ?? 0) ||
      input.length > (schema.maxLength ?? MAX_TEXT_CHARS) ||
      (schema.enum && !schema.enum.includes(input)) ||
      (schema.pattern && !new RegExp(schema.pattern, "u").test(input)) ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(input)
    ) {
      throw new TypeError("Securities WebMCP input contains an unsupported string.");
    }
    return input;
  }
  if (
    (!types.includes("number") && !types.includes("integer")) ||
    typeof input !== "number" ||
    !Number.isFinite(input) ||
    (!types.includes("number") && !Number.isSafeInteger(input)) ||
    input < (schema.minimum ?? -Infinity) ||
    input > (schema.maximum ?? Infinity)
  ) {
    throw new TypeError("Securities WebMCP input contains an unsupported number.");
  }
  return input;
}

function requireBinding(snapshot, input) {
  if (snapshot?.dossier?.id !== input.dossierId || snapshot.dossier.revision !== input.revision) {
    throw new Error("securities_revision_not_visible");
  }
  return snapshot.dossier;
}

function boundedResult(result) {
  const json = JSON.stringify(result);
  if (json.length > SECURITIES_WEBMCP_MAX_OUTPUT_CHARS) {
    throw new Error("securities_result_too_large");
  }
  return JSON.parse(json);
}

const TEXT = Symbol("localized-text");
const fields = (names) => Object.fromEntries(names.split(" ").map((name) => [name, true]));
const COMPANY = {
  ...fields("id ticker exchange legalName landingUrl sectorId"),
  name: TEXT,
  sector: TEXT,
};
const PERIOD = {
  ...fields(
    "id kind scope year quarter durationMonths start end startDate endDate comparisonPeriodId basisId presentation",
  ),
  label: TEXT,
};
const LOCATOR = {
  ...fields("precision page printedPage rowCode"),
  table: TEXT,
  rowLabel: TEXT,
  column: TEXT,
  note: TEXT,
};
const VERIFICATION_RECEIPT = fields("id sha256 proofId proofSha256 renderSha256 method");
const POINT = {
  ...fields(
    "value rawText originalUnit unit sourceId sourceVersion sourceHash factId entityId periodId scope dataKind basisId verification extractionIssue corrected originalValue correctionId",
  ),
  locator: LOCATOR,
  verificationReceipt: VERIFICATION_RECEIPT,
};
const INPUT_REF = {
  ...fields("metricId side value unit sourceId sourceVersion sourceHash factId correctionId"),
  locator: LOCATOR,
  verificationReceipt: VERIFICATION_RECEIPT,
};
const CALCULATION = {
  ...fields("value exact status formula rounding unit calculationKind"),
  inputRefs: [INPUT_REF],
};
const METRIC = {
  ...fields("id unit required"),
  label: TEXT,
  definition: TEXT,
  current: POINT,
  comparison: POINT,
  calculation: { absoluteChange: CALCULATION, relativeChangePct: CALCULATION },
};
const DERIVED_METRIC = {
  id: true,
  unit: true,
  label: TEXT,
  definition: TEXT,
  metricIds: [true],
  current: CALCULATION,
  comparison: CALCULATION,
  percentagePointChange: CALCULATION,
};
const CORRECTION = {
  ...fields(
    "id metricId periodId side originalValue previousValue value reason sourceChecked sourceId sourceVersion at revision",
  ),
  locator: LOCATOR,
};
const ISSUE = {
  ...fields("id code severity generated allowAcknowledgment requiresSourceImport"),
  message: TEXT,
  metricIds: [true],
  sourceIds: [true],
  resolution: fields("issueId reason at revision"),
};
const EVIDENCE_NOTE = {
  ...fields("id page sourceId sourceVersion kind quote"),
  note: TEXT,
  text: TEXT,
  locator: LOCATOR,
};
const RECEIPT = {
  ...fields(
    "id requestId transportAttemptId evidenceType operation attempt model requestedModel actualModel provider strategy status outcome errorCode httpStatus startedAt completedAt durationMs latencyMs cost costUsd costStatus inputTokens outputTokens cachedInputTokens cacheWriteTokens reasoningTokens webSearchRequests webFetchRequests",
  ),
  usage: fields(
    "promptTokens completionTokens totalTokens inputTokens outputTokens prompt_tokens completion_tokens total_tokens cost",
  ),
  validation: {
    ...fields("status code stage semanticEntailment semanticStatus method"),
    checks: [true],
  },
  selectedEndpoints: [fields("provider nativeModel")],
  providerAttempts: [fields("provider model status")],
  serverTools: [{ mode: true, tools: [true] }],
  sourceIds: [true],
};
const CONSISTENCY_CHECK = fields("id verdict reason");
const CLAIM = {
  ...fields("id kind origin textOrigin reviewStatus"),
  text: TEXT,
  metricIds: [true],
  sourceIds: [true],
  evidenceQuotes: [
    {
      ...fields("sourceId sourceVersion sourceExcerptId quote extractionMethod verification"),
      locator: LOCATOR,
      qualityFlags: [true],
    },
  ],
  numericOrigins: [
    {
      ...fields(
        "id version metricId side origin correctionId sourceValue sourceUnit displayUnit sourceHash factId",
      ),
      locator: LOCATOR,
      verificationReceipt: VERIFICATION_RECEIPT,
    },
  ],
  numericDisplays: [fields("type metricId field value unit format rendered")],
  pageOrigins: [{ ...fields("sourceId sourceVersion sourceExcerptId page"), locator: LOCATOR }],
  consistencyCheck: CONSISTENCY_CHECK,
};
const VERIFIED_FACT = {
  ...fields(
    "id factId side sourceId sourceVersion sourceHash value unit rawText periodId scope entityId basisId dataKind verification basisNote",
  ),
  label: TEXT,
  locator: LOCATOR,
  verificationReceipt: VERIFICATION_RECEIPT,
};
const REPORT = {
  headline: TEXT,
  summaryClaimIds: [true],
  sections: [{ id: true, claimIds: [true] }],
};
const ANALYSIS_VALIDATION = {
  deterministic: { status: true, checks: [true] },
  semantic: {
    ...fields("status method narrativeHash"),
    checkedClaimIds: [true],
    claims: [CONSISTENCY_CHECK],
    notes: fields("verdict reason"),
  },
};
const VALIDATION_OVERVIEW = {
  deterministic: ANALYSIS_VALIDATION.deterministic,
  semantic: {
    ...fields("status method narrativeHash"),
    checkedClaimIds: [true],
    notes: fields("verdict"),
  },
};
const PAGE_QUALITY = {
  ...fields("page method status ocrConfidence textCharacters reviewedNumericCellsOnly"),
  qualityFlags: [true],
};
const SOURCE_QUALITY = {
  ...fields(
    "qualityVersion fullOriginalFetched fullTextVerified materialCellsVerified method parserVersion pageCount textPages ocrPages extractedPages cellsDigest",
  ),
  pagesWithoutText: [true],
  pagesWithoutUsableText: [true],
  pagesRequiringReview: [true],
};
const RESEARCH_GAP = fields("topic reason impact");
const RESEARCH_STEP = {
  ...fields("id sourceId sourceVersion query status code"),
  pages: [true],
  passageIds: [true],
  coverage: {
    ...fields("searchedPageCount totalPages truncated nextCursor"),
    returnedPages: [true],
    unusablePages: [true],
  },
  sourceQuality: SOURCE_QUALITY,
  pageQuality: [PAGE_QUALITY],
  receipt: {
    ...fields(
      "evidenceType parserVersion sourceHash extractionFileSha256 responseSha256 fullTextVerified verifiedLedgerSha256 readerVersion representationVersion representationHash qualityVersion manifestSha256 requestSha256 readAt",
    ),
    verifiedLedgerHashes: [true],
  },
};
const RESEARCH = {
  status: true,
  steps: [RESEARCH_STEP],
  gaps: [RESEARCH_GAP],
  verifiedFacts: [VERIFIED_FACT],
};
const REPORT_READINESS = {
  ...fields(
    "policyVersion revision state canExport includedMetricCount totalMetricCount includedClaimCount totalClaimCount",
  ),
  reasons: [
    {
      ...fields("code category affectsReadiness"),
      message: TEXT,
      metricIds: [true],
      sourceIds: [true],
    },
  ],
  omittedMetricIds: [true],
  omittedClaimIds: [true],
};
const ANALYSIS_LINEAGE = fields("generatedInRevision carriedFromRevision carriedAt reason");
const ANALYSIS = {
  ...fields(
    "dossierId revision origin model locale inputRevision summaryOrigin promptVersion reportVersion reportMode",
  ),
  summary: TEXT,
  claims: [CLAIM],
  report: REPORT,
  research: RESEARCH,
  validation: ANALYSIS_VALIDATION,
  questions: [TEXT],
  limitations: [TEXT],
  receipt: RECEIPT,
  receipts: [RECEIPT],
};
const FRIENDLY_ANALYSIS = {
  ...ANALYSIS,
  claims: [
    {
      ...fields("id kind origin textOrigin reviewStatus"),
      text: TEXT,
      metricIds: [true],
      sourceIds: [true],
    },
  ],
  research: { status: true, gaps: [RESEARCH_GAP] },
};
const SOURCE = {
  ...fields(
    "id companyId periodId comparisonPeriodId version hash url landingUrl fetchedAt publishedAt retrievedAt contentType reportType scope unit auditStatus parserVersion status format sourceType pageCount publicationDateBasis signedAt contentTruncated revisionStatus",
  ),
  title: TEXT,
  note: TEXT,
  excerpt: TEXT,
  extractedText: TEXT,
  excerpts: [
    {
      ...fields(
        "id text page normalization extractionMethod verification sourceId sourceVersion originalHash extractionHash representationHash",
      ),
      qualityFlags: [true],
      locator: LOCATOR,
      pageHeader: { text: true, locator: LOCATOR },
    },
  ],
  extraction: SOURCE_QUALITY,
  readQuality: SOURCE_QUALITY,
  rights: fields(
    "status termsUrl checkedAt attribution localOriginalAllowed fullTextRedistribution note",
  ),
};
const FRESHNESS = {
  ...fields(
    "status checkedAt fetchedAt snapshotAt cachedAt lastSuccessfulCheckAt latestVerified latestAvailablePeriodId latestMarketPeriodVerified policy pendingCandidateCount",
  ),
  label: TEXT,
  message: TEXT,
  note: TEXT,
};
const SCOPE = {
  ...fields(
    "companyId periodId comparisonPeriodId query status sourceStatus ready needsClarification latestRequested",
  ),
  company: COMPANY,
  period: PERIOD,
  comparisonPeriod: PERIOD,
  comparisonBasis: TEXT,
  scopeNotice: TEXT,
  sources: [SOURCE],
  sourceIds: [true],
  freshness: FRESHNESS,
  warnings: [ISSUE],
  limitations: [TEXT],
};
const JOB = {
  ...fields(
    "id status kind dossierId revision createdAt startedAt completedAt updatedAt resultRevision",
  ),
  progress: { ...fields("stage readCount sourceId at"), pages: [true] },
  error: fields("code"),
  receipt: RECEIPT,
  receipts: [RECEIPT],
};
const JOB_OVERVIEW = {
  ...fields(
    "id status kind dossierId revision createdAt startedAt completedAt updatedAt resultRevision",
  ),
  progress: JOB.progress,
  error: JOB.error,
};
const RESEARCH_SELECTION = {
  ...fields("query companyId periodId comparisonPeriodId"),
  defaultScope: fields("companyId periodId comparisonPeriodId"),
};

function project(value, shape, truncatedFields, path = "data", depth = 0) {
  if (value === undefined || value === null) return value ?? null;
  if (depth > 12) throw new Error("securities_result_invalid");
  if (shape === true || (shape === TEXT && typeof value === "string")) {
    if (typeof value === "string") {
      if (value.length <= MAX_TEXT_CHARS) return value;
      truncatedFields.push(path);
      return `${value.slice(0, MAX_TEXT_CHARS - 1)}…`;
    }
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))
      return value;
    throw new Error("securities_result_invalid");
  }
  if (shape === TEXT)
    return project(value, { vi: true, en: true }, truncatedFields, path, depth + 1);
  if (Array.isArray(shape)) {
    const descriptors = ownData(value, true);
    const count = descriptors.length.value;
    if (count > 80) truncatedFields.push(path);
    return Array.from({ length: Math.min(count, 80) }, (_, index) => {
      if (!Object.hasOwn(descriptors, index)) throw new Error("securities_result_invalid");
      return project(
        descriptors[index].value,
        shape[0],
        truncatedFields,
        `${path}[${index}]`,
        depth + 1,
      );
    });
  }
  const descriptors = ownData(value);
  const output = {};
  for (const [key, child] of Object.entries(shape)) {
    if (Object.hasOwn(descriptors, key))
      output[key] = project(
        descriptors[key].value,
        child,
        truncatedFields,
        `${path}.${key}`,
        depth + 1,
      );
  }
  return output;
}

function summary(dossier, truncatedFields) {
  if (!dossier) return null;
  const reportAnalysis = dossier.reportProjection?.analysis;
  const visibleAnalysis =
    reportAnalysis ??
    (dossier.analysis
      ? {
          origin: dossier.analysis.origin,
          model: dossier.analysis.model,
          inputRevision: dossier.analysis.inputRevision,
          reportVersion: dossier.analysis.reportVersion,
          research: dossier.analysis.research,
          validation: dossier.analysis.validation,
        }
      : null);
  return {
    ...project(
      { ...dossier, analysis: visibleAnalysis },
      {
        ...fields("id revision status createdAt updatedAt revisionEvent"),
        company: COMPANY,
        period: PERIOD,
        comparisonPeriod: PERIOD,
        approval: fields("revision approvedAt at"),
        freshness: FRESHNESS,
        reportReadiness: REPORT_READINESS,
        analysisLineage: ANALYSIS_LINEAGE,
        analysis: {
          ...fields("origin model inputRevision reportVersion reportMode"),
          summary: TEXT,
          report: REPORT,
          validation: VALIDATION_OVERVIEW,
          research: {
            status: true,
            gaps: [RESEARCH_GAP],
            steps: [{ ...fields("id sourceId sourceVersion status code"), pages: [true] }],
          },
        },
      },
      truncatedFields,
      "dossier",
    ),
    metricCount: dossier.metrics?.length ?? 0,
    unresolvedIssueCount: dossier.issues?.filter((issue) => !issue.resolution).length ?? 0,
    materialIssueCount:
      dossier.issues?.filter((issue) => issue.severity === "material" && !issue.resolution)
        .length ?? 0,
    sourceCount: dossier.sources?.length ?? 0,
    analysisOrigin: dossier.analysis?.origin ?? null,
    analysisAvailable: reportAnalysis?.origin === "model",
    verifiedFactCount: dossier.reportProjection?.verifiedFacts?.length ?? null,
    notesLength: typeof dossier.notes === "string" ? dossier.notes.length : 0,
  };
}

function stateResult(snapshot) {
  const truncatedFields = [];
  const catalogShape = {
    ...fields(
      "schemaVersion version updatedAt asOf snapshotAt frozenAt mode defaultCompanyId defaultPeriodId",
    ),
    scopeNotice: TEXT,
    companies: [
      {
        ...COMPANY,
        defaultPeriodId: true,
        available: true,
        periods: [
          {
            ...PERIOD,
            comparisonPeriod: PERIOD,
            comparisonOptions: [PERIOD],
            sources: [SOURCE],
            sourceIds: [true],
            status: true,
          },
        ],
        sourceIds: [true],
        status: true,
      },
    ],
    sources: [SOURCE],
    limitations: [TEXT],
  };
  return {
    status: "available",
    product: "Nhân for Securities",
    locale: snapshot.locale,
    view: snapshot.view,
    busy: snapshot.busy ?? null,
    researchStep: project(snapshot.researchStep, true, truncatedFields, "researchStep"),
    researchDraft: project(
      snapshot.researchDraft,
      RESEARCH_SELECTION,
      truncatedFields,
      "researchDraft",
    ),
    catalog: project(snapshot.catalog, catalogShape, truncatedFields, "catalog"),
    scope: project(snapshot.scope, SCOPE, truncatedFields, "scope"),
    dossier: summary(snapshot.dossier, truncatedFields),
    dossiers: project(
      (snapshot.dossiers ?? []).slice(0, 20),
      [
        {
          ...fields("id revision status updatedAt"),
          company: { ...fields("id ticker legalName exchange sectorId"), name: TEXT },
          period: { ...fields("id kind scope year quarter"), label: TEXT },
        },
      ],
      truncatedFields,
      "dossiers",
    ),
    dossierCount: snapshot.dossiers?.length ?? 0,
    job: snapshot.job
      ? {
          ...project(snapshot.job, JOB_OVERVIEW, truncatedFields, "job"),
          resultRevision:
            snapshot.job.result?.dossier?.revision ??
            snapshot.job.result?.revision ??
            snapshot.job.resultRevision ??
            null,
          receiptCount: snapshot.job.receipts?.length ?? (snapshot.job.receipt ? 1 : 0),
          detailsTool: SECURITIES_WEBMCP_TOOL_NAMES.getTaskStatus,
        }
      : null,
    approvalRequest: project(
      snapshot.approvalRequest,
      fields("dossierId revision"),
      truncatedFields,
      "approvalRequest",
    ),
    error: snapshot.error ? { code: safeErrorCode(snapshot.error) } : null,
    truncatedFields,
  };
}

function sourceQualityData(dossier) {
  const steps = dossier.analysis?.research?.steps ?? [];
  if (!Array.isArray(steps)) throw new Error("securities_result_invalid");
  const pages = [];
  const coverage = [];
  for (const source of dossier.sources ?? []) {
    let quality = source.readQuality?.qualityVersion
      ? source.readQuality
      : source.extraction?.qualityVersion
        ? source.extraction
        : null;
    const byPage = new Map();
    const collect = (records = []) => {
      if (!Array.isArray(records)) throw new Error("securities_result_invalid");
      for (const record of records) {
        if (!Number.isSafeInteger(record?.page) || record.page < 1)
          throw new Error("securities_result_invalid");
        byPage.set(record.page, { ...record, sourceId: source.id, sourceVersion: source.version });
      }
    };
    collect(source.extraction?.pageQuality);
    collect(source.readPageQuality);
    for (const step of steps) {
      if (
        step.sourceId !== source.id ||
        step.sourceVersion === undefined ||
        String(step.sourceVersion) !== String(source.version)
      )
        continue;
      if (step.sourceQuality?.qualityVersion) quality = step.sourceQuality;
      collect(step.pageQuality);
    }
    pages.push(...[...byPage.values()].sort((left, right) => left.page - right.page));
    coverage.push({
      sourceId: source.id,
      sourceVersion: source.version,
      sourceSummaryStatus: quality ? "available" : "unknown",
      pageAssessmentStatus: byPage.size ? "available" : "unknown",
      assessedPageCount: byPage.size,
      totalPages: quality?.pageCount ?? source.pageCount ?? null,
      sourceQuality: quality,
    });
  }
  return { pages, coverage };
}

function readDossierPage(snapshot, input) {
  const dossier = requireBinding(snapshot, input);
  const truncatedFields = [];
  const section = input.section;
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 8;
  if (
    [
      "report",
      "report_metrics",
      "report_derived_metrics",
      "report_issues",
      "report_evidence_notes",
      "verified_facts",
    ].includes(section) &&
    !dossier.reportProjection
  )
    throw new Error("report_unavailable");
  if (section === "notes") {
    const notes = dossier.notes ?? "";
    if (typeof notes !== "string") throw new Error("securities_result_invalid");
    const total = Math.ceil(notes.length / MAX_TEXT_CHARS);
    const data = Array.from(
      { length: Math.max(0, Math.min(limit, total - offset)) },
      (_, index) => {
        const characterOffset = (offset + index) * MAX_TEXT_CHARS;
        return {
          characterOffset,
          text: notes.slice(characterOffset, characterOffset + MAX_TEXT_CHARS),
        };
      },
    );
    return {
      status: "available",
      dossierId: dossier.id,
      revision: dossier.revision,
      section,
      data,
      offset,
      total,
      nextOffset: offset + limit < total ? offset + limit : null,
      totalCharacters: notes.length,
      chunkSize: MAX_TEXT_CHARS,
      truncatedFields,
    };
  }
  const quality = section === "source_quality" ? sourceQualityData(dossier) : null;
  const collections = {
    metrics: [dossier.metrics, METRIC],
    report_metrics: [dossier.reportProjection?.metrics, METRIC],
    derived_metrics: [dossier.derivedMetrics, DERIVED_METRIC],
    report_derived_metrics: [dossier.reportProjection?.derivedMetrics, DERIVED_METRIC],
    verified_facts: [dossier.reportProjection?.verifiedFacts, VERIFIED_FACT],
    report_issues: [dossier.reportProjection?.issues, ISSUE],
    report_evidence_notes: [dossier.reportProjection?.evidenceNotes, EVIDENCE_NOTE],
    evidence_notes: [dossier.evidenceNotes, EVIDENCE_NOTE],
    issues: [dossier.issues, ISSUE],
    corrections: [dossier.corrections, CORRECTION],
    sources: [dossier.sources, SOURCE],
    source_quality: [quality?.pages, { sourceId: true, sourceVersion: true, ...PAGE_QUALITY }],
    history: [
      dossier.history,
      fields("id revision status createdAt updatedAt revisionEvent event approvedAt"),
    ],
    chat: [
      (snapshot.chat ?? [])
        .filter((turn) => turn.revision === input.revision)
        .map((turn) => ({
          ...turn,
          answer: typeof turn.answer === "string" ? { text: turn.answer } : turn.answer,
        })),
      {
        ...fields("role revision jobId at"),
        content: TEXT,
        answer: { ...ANALYSIS, text: TEXT, answer: TEXT, sourceIds: [true], metricIds: [true] },
      },
    ],
  };
  if (section === "overview")
    return { status: "available", dossier: summary(dossier, truncatedFields), truncatedFields };
  if (section === "readiness" || section === "research") {
    const value = section === "readiness" ? dossier.reportReadiness : dossier.analysis?.research;
    const field = section === "readiness" ? "reasons" : "steps";
    const all = value?.[field] ?? [];
    if (!Array.isArray(all)) throw new Error("securities_result_invalid");
    return {
      status: "available",
      dossierId: dossier.id,
      revision: dossier.revision,
      section,
      data: project(
        value ? { ...value, [field]: all.slice(offset, offset + limit) } : null,
        section === "readiness" ? REPORT_READINESS : RESEARCH,
        truncatedFields,
      ),
      offset,
      total: all.length,
      nextOffset: offset + limit < all.length ? offset + limit : null,
      truncatedFields,
    };
  }
  if (section === "analysis" || section === "report") {
    const analysis = section === "report" ? dossier.reportProjection.analysis : dossier.analysis;
    const claims = analysis?.claims ?? [];
    if (!Array.isArray(claims)) throw new Error("securities_result_invalid");
    return {
      status: "available",
      dossierId: dossier.id,
      revision: dossier.revision,
      section,
      data: project(
        analysis ? { ...analysis, claims: claims.slice(offset, offset + limit) } : null,
        section === "report" ? FRIENDLY_ANALYSIS : ANALYSIS,
        truncatedFields,
      ),
      analysisAvailable: analysis?.origin === "model",
      reportReadiness: project(
        dossier.reportReadiness,
        REPORT_READINESS,
        truncatedFields,
        "reportReadiness",
      ),
      analysisLineage: project(
        dossier.analysisLineage,
        ANALYSIS_LINEAGE,
        truncatedFields,
        "analysisLineage",
      ),
      offset,
      total: claims.length,
      nextOffset: offset + limit < claims.length ? offset + limit : null,
      truncatedFields,
    };
  }
  const [all = [], shape] = collections[section];
  if (!Array.isArray(all)) throw new Error("securities_result_invalid");
  return {
    status: "available",
    dossierId: dossier.id,
    revision: dossier.revision,
    section,
    data: project(all.slice(offset, offset + limit), [shape], truncatedFields),
    offset,
    total: all.length,
    nextOffset: offset + limit < all.length ? offset + limit : null,
    ...(section === "chat" ? { historyTruncated: dossier.chatHistoryTruncated === true } : {}),
    ...(quality
      ? {
          qualityCoverage: project(
            quality.coverage,
            [
              {
                ...fields(
                  "sourceId sourceVersion sourceSummaryStatus pageAssessmentStatus assessedPageCount totalPages",
                ),
                sourceQuality: SOURCE_QUALITY,
              },
            ],
            truncatedFields,
            "qualityCoverage",
          ),
        }
      : {}),
    truncatedFields,
  };
}

function readDossierResult(snapshot, input) {
  let limit = input.limit ?? 8;
  while (true) {
    const page = readDossierPage(snapshot, { ...input, limit });
    if (JSON.stringify(page).length <= SECURITIES_WEBMCP_MAX_OUTPUT_CHARS) return page;
    const returnedCount = Math.min(limit, page.total - page.offset);
    if (!Number.isSafeInteger(returnedCount) || returnedCount <= 1)
      throw new Error("securities_result_too_large");
    limit = returnedCount - 1;
  }
}

const ERROR_CODES = new Set([
  "evidence_mismatch",
  "invalid_locale",
  "source_service_unavailable",
  "source_service_invalid_response",
  "source_service_redirect_rejected",
  "source_result_too_large",
  "invalid_source_dataset",
  "source_company_mismatch",
  "source_dataset_too_large",
  "model_unbound_numeric_output",
  "model_unsupported_fact",
  "securities_revision_not_visible",
  "securities_result_too_large",
  "securities_result_invalid",
  "securities_state_not_visible",
  "context_mismatch",
  "revision_conflict",
  "invalid_revision",
  "scope_required",
  "unsupported_company",
  "unsupported_period",
  "source_not_found",
  "metric_not_found",
  "source_mismatch",
  "invalid_correction",
  "empty_revision",
  "missing_evidence",
  "issue_requires_evidence",
  "material_issues_unresolved",
  "approval_blocked",
  "approval_required",
  "confirmation_required",
  "job_not_active",
  "job_not_found",
  "job_context_mismatch",
  "job_in_progress",
  "action_in_progress",
  "connection_failed",
  "request_failed",
  "invalid_input",
  "invalid_number",
  "unsafe_number",
  "export_failed",
  "invalid_export_format",
  "visible_state_timeout",
  "model_not_configured",
  "provider_rate_limited",
  "provider_payment_required",
  "provider_unavailable",
  "model_output_invalid",
  "provider_credit_exhausted",
  "provider_secret_echo",
  "model_cancelled",
  "provider_timeout",
  "job_interrupted",
  "dossier_not_found",
  "storage_not_configured",
  "idempotency_conflict",
  "invalid_model_dossier",
  "model_context_too_large",
  "ambiguous_company",
  "ambiguous_period",
  "no_supported_company",
  "unsupported_comparison",
  "unsupported_scope",
  "query_too_long",
  "source_missing",
  "approved_revision_required",
  "report_unavailable",
  "revision_required",
  "invalid_default_scope",
]);

function safeErrorCode(error) {
  const code = typeof error?.code === "string" ? error.code : error?.message;
  return ERROR_CODES.has(code) ? code : "request_failed";
}

export const SECURITIES_WEBMCP_TOOL_NAMES = frozen({
  getState: "get_securities_state",
  startResearch: "start_securities_research",
  configureScope: "configure_securities_scope",
  createDossier: "create_securities_dossier",
  openDossier: "open_securities_dossier",
  readDossier: "read_securities_dossier",
  startAnalysis: "start_securities_analysis",
  getTaskStatus: "get_securities_task_status",
  cancelTask: "cancel_securities_task",
  openEvidence: "open_securities_evidence",
  stageCorrections: "stage_securities_corrections",
  resolveIssue: "resolve_securities_issue",
  requestApproval: "request_securities_approval",
  exportRevision: "export_securities_revision",
  startFollowup: "start_securities_followup",
});

export function createSecuritiesWebMcpTools(actions, { signal } = {}) {
  const lifecycle = resolveWebMcpLifecycleSignal(signal);
  const readState = requireWebMcpAction(actions, "getState");
  const awaitVisible = requireWebMcpAction(actions, "awaitVisible");
  const runMutation = createSerializedWebMcpActionRunner(lifecycle);
  const actionNames = [
    "startResearch",
    "configureScope",
    "createDossier",
    "openDossier",
    "startAnalysis",
    "getAnalysisStatus",
    "cancelAnalysis",
    "getEvidence",
    "applyCorrection",
    "resolveIssue",
    "requestApproval",
    "exportRevision",
    "askFollowup",
  ];
  const action = Object.fromEntries(
    actionNames.map((name) => [name, requireWebMcpAction(actions, name)]),
  );

  async function perform(name, input, options, { bound = true } = {}) {
    if (bound) requireBinding(readState(), input);
    const result = await action[name](input, options);
    await awaitVisible(options);
    return result;
  }

  function completedBinding(result, input, expectedStatus) {
    const snapshot = readState();
    if (
      result?.status !== expectedStatus ||
      result.dossierId !== snapshot.dossier?.id ||
      result.revision !== snapshot.dossier.revision ||
      (input.dossierId && result.dossierId !== input.dossierId) ||
      (expectedStatus === "opened" && input.revision && result.revision !== input.revision) ||
      (expectedStatus === "revised" && result.revision <= input.revision)
    ) {
      throw new Error("securities_state_not_visible");
    }
    return { status: expectedStatus, dossierId: result.dossierId, revision: result.revision };
  }

  function tool(
    key,
    title,
    description,
    inputSchema,
    handler,
    { readOnly = false, consequential = false, control = false } = {},
  ) {
    const runner =
      readOnly || control ? createSerializedWebMcpActionRunner(lifecycle) : runMutation;
    return frozen({
      name: SECURITIES_WEBMCP_TOOL_NAMES[key] ?? key,
      title,
      description,
      inputSchema,
      annotations: {
        readOnlyHint: readOnly,
        untrustedContentHint: true,
        consequentialHint: consequential,
      },
      async execute(input, { signal: executionSignal } = {}) {
        const normalized = validate(input, inputSchema);
        try {
          return await runner(handler, [normalized], executionSignal, boundedResult);
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          return { status: "error", error: { code: safeErrorCode(error) } };
        }
      },
    });
  }

  const query = { type: "string", minLength: 2, maxLength: 2000 };
  const taskSchema = objectSchema({ ...bindingProperties, jobId: idSchema });
  const scopeSchema = objectSchema(
    { query, companyId: idSchema, periodId: idSchema, comparisonPeriodId: idSchema },
    [],
    { anyOf: [{ required: ["query"] }, { required: ["companyId"] }] },
  );
  const defaultScopeId = { ...idSchema, maxLength: 80, pattern: "^[A-Za-z0-9_-]+$" };
  const researchSchema = objectSchema(
    {
      ...scopeSchema.properties,
      defaultScope: objectSchema(
        { companyId: defaultScopeId, periodId: defaultScopeId, comparisonPeriodId: defaultScopeId },
        ["companyId"],
      ),
    },
    [],
    {
      anyOf: [{ required: ["query"] }, { required: ["companyId"] }],
      dependentRequired: { defaultScope: ["query"] },
    },
  );
  const changeSchema = objectSchema({
    metricId: idSchema,
    periodId: idSchema,
    value: {
      type: ["number", "null"],
      minimum: -Number.MAX_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    },
    reason: { type: "string", minLength: 8, maxLength: 1000 },
  });

  async function startTask(name, input, options) {
    const result = await perform(name, input, options);
    const snapshot = readState();
    if (result?.status === "completed" && name === "askFollowup") {
      requireBinding(snapshot, input);
      return {
        status: "completed",
        dossierId: input.dossierId,
        revision: input.revision,
        resultSection: "chat",
      };
    }
    const job = snapshot.job;
    if (
      result?.status !== "started" ||
      !job ||
      result.jobId !== job.id ||
      job.dossierId !== input.dossierId ||
      job.revision !== input.revision
    )
      throw new Error("securities_state_not_visible");
    return {
      status: "started",
      jobId: job.id,
      dossierId: input.dossierId,
      revision: input.revision,
      taskStatus: job.status,
      nextTool: SECURITIES_WEBMCP_TOOL_NAMES.getTaskStatus,
    };
  }

  return Object.freeze([
    tool(
      "getState",
      "Read research workspace",
      "Read the supported company and source scope, visible report readiness, saved dossier index, and current research task overview. Detailed report validation is available through read_securities_dossier; task receipts through get_securities_task_status. Does not fetch financial sources or start AI work.",
      emptySchema,
      async (_input, options) => {
        await awaitVisible(options);
        return stateResult(readState());
      },
      { readOnly: true },
    ),
    tool(
      "startResearch",
      "Research a company",
      "Start the complete research workflow from a question or supported company and period selection. Optional defaultScope contains visible form defaults for a generic question; company or period named in the query can replace these hints. Top-level selectors are explicit and conflicting selections require clarification. Resolves scope, creates the saved dossier and starts the configured AI research task. Ambiguous or unsupported scope does not create a dossier or start AI work. A scope_required result needs a clearer supported selection. Returns started only after a task exists; read task status and the report for its outcome. The backend's configured provider work may incur API cost.",
      researchSchema,
      async (input, options) => {
        const result = await perform("startResearch", input, options, { bound: false });
        const snapshot = readState();
        const truncatedFields = [];
        if (result?.status === "scope_required") {
          if (result.code) {
            if (
              snapshot.view !== "start" ||
              !snapshot.researchDraft ||
              ![
                "ambiguous_company",
                "ambiguous_period",
                "unsupported_period",
                "unsupported_comparison",
                "unsupported_company",
                "no_supported_company",
              ].includes(result.code)
            )
              throw new Error("securities_state_not_visible");
            return {
              status: "scope_required",
              code: result.code,
              selection: project(
                snapshot.researchDraft,
                RESEARCH_SELECTION,
                truncatedFields,
                "selection",
              ),
              truncatedFields,
            };
          }
          if (
            snapshot.view !== "scope" ||
            !snapshot.scope ||
            (snapshot.scope.ready === true && !snapshot.scope.needsClarification)
          )
            throw new Error("securities_state_not_visible");
          return {
            status: "scope_required",
            scope: project(snapshot.scope, SCOPE, truncatedFields, "scope"),
            truncatedFields,
          };
        }
        const job = snapshot.job;
        if (
          result?.status !== "started" ||
          !job ||
          result.jobId !== job.id ||
          result.dossierId !== job.dossierId ||
          result.revision !== job.revision ||
          !Number.isSafeInteger(result.revision) ||
          result.revision < 1 ||
          snapshot.dossier?.id !== result.dossierId ||
          snapshot.dossier.revision < result.revision
        )
          throw new Error("securities_state_not_visible");
        return {
          status: "started",
          jobId: job.id,
          dossierId: result.dossierId,
          revision: result.revision,
          taskStatus: job.status,
          visibleDossier: summary(snapshot.dossier, truncatedFields),
          nextTool: SECURITIES_WEBMCP_TOOL_NAMES.getTaskStatus,
          resultSection: "report",
          truncatedFields,
        };
      },
      { consequential: true },
    ),
    tool(
      "configureScope",
      "Resolve research scope",
      "Resolve a natural-language query or a supported company selection through the same source service as the UI. This configures the visible scope; it does not create a dossier. Latest-period requests obey backend freshness checks and may report cached or missing sources.",
      scopeSchema,
      async (input, options) => {
        if (!input.query && !input.companyId) throw new Error("scope_required");
        await perform("configureScope", input, options, { bound: false });
        const truncatedFields = [];
        const scope = project(readState().scope, SCOPE, truncatedFields, "scope");
        if (!scope) throw new Error("securities_state_not_visible");
        return { status: "configured", scope, truncatedFields };
      },
    ),
    tool(
      "createDossier",
      "Create sourced dossier",
      "Persist and open a draft for the exact company and comparison periods previously configured in the visible scope. Returns created only after the persisted revision is visible. Does not run the language model.",
      objectSchema({ companyId: idSchema, periodId: idSchema, comparisonPeriodId: idSchema }),
      async (input, options) => {
        const scope = readState().scope;
        if (
          !scope ||
          (scope.company?.id ?? scope.companyId) !== input.companyId ||
          (scope.period?.id ?? scope.periodId) !== input.periodId ||
          (scope.comparisonPeriod?.id ?? scope.comparisonPeriodId) !== input.comparisonPeriodId
        )
          throw new Error("scope_required");
        return completedBinding(
          await perform("createDossier", input, options, { bound: false }),
          input,
          "created",
        );
      },
    ),
    tool(
      "openDossier",
      "Open saved dossier",
      "Load and display a saved dossier. Specify revision to open an immutable historical version; omit it to request the current saved revision. This changes the visible research context.",
      objectSchema(bindingProperties, ["dossierId"]),
      async (input, options) =>
        completedBinding(
          await perform("openDossier", input, options, { bound: false }),
          input,
          "opened",
        ),
    ),
    tool(
      "readDossier",
      "Read report and research evidence",
      "Read one bounded section of the exact visible revision. Use report, report_metrics, report_derived_metrics, verified_facts, report_issues and report_evidence_notes for the automatically filtered report; readiness explains limits and omitted items. The analysis, metrics, derived_metrics and evidence_notes expert sections retain original claims and evidence, including flagged items. Research lists actual reading steps and gaps; source_quality lists page assessments and explicitly unknown coverage. Report and analysis paginate claims, research paginates steps, readiness paginates reasons, notes use 2,000-character chunks, and other sections paginate rows or turns. A page may contain fewer rows than limit to fit the response cap while retaining each row's evidence fields. Follow nextOffset, which accounts for the rows actually returned. truncatedFields identifies text excerpts. If a single row and its section metadata exceed the cap, the result is explicitly too large.",
      objectSchema(
        {
          ...bindingProperties,
          section: {
            type: "string",
            enum: [
              "overview",
              "report",
              "report_metrics",
              "report_derived_metrics",
              "report_issues",
              "report_evidence_notes",
              "readiness",
              "research",
              "source_quality",
              "verified_facts",
              "metrics",
              "derived_metrics",
              "issues",
              "evidence_notes",
              "analysis",
              "corrections",
              "notes",
              "sources",
              "history",
              "chat",
            ],
          },
          offset: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          limit: { type: "integer", minimum: 1, maximum: MAX_PAGE_SIZE },
        },
        ["dossierId", "revision", "section"],
      ),
      async (input, options) => {
        await awaitVisible(options);
        return readDossierResult(readState(), input);
      },
      { readOnly: true },
    ),
    tool(
      "startAnalysis",
      "Start evidence-based analysis",
      "Start the application's analysis task for the exact visible revision. Returns started with a task ID, not completed analysis. The configured backend may call the owner-selected OpenRouter model and incur API cost. Read task status to learn the real outcome; no model override or fallback parameter is exposed.",
      bindingSchema,
      (input, options) => startTask("startAnalysis", input, options),
      { consequential: true },
    ),
    tool(
      "getTaskStatus",
      "Read persisted task status",
      "Read a persisted task bound to its original dossier and input revision; the backend may mark an expired interrupted task failed. Reports backend task status separately from the visible task and dossier. Completed backend work may still need to be opened or rendered. No new model request is made.",
      taskSchema,
      async (input, options) => {
        const job = await action.getAnalysisStatus(input, options);
        if (
          job?.id !== input.jobId ||
          job.dossierId !== input.dossierId ||
          job.revision !== input.revision
        )
          throw new Error("job_context_mismatch");
        await awaitVisible(options);
        const truncatedFields = [];
        const snapshot = readState();
        return {
          status: "available",
          task: project(job, JOB, truncatedFields, "task"),
          resultRevision: job.result?.dossier?.revision ?? job.result?.revision ?? null,
          visibleTask:
            snapshot.job?.id === input.jobId
              ? project(snapshot.job, JOB, truncatedFields, "visibleTask")
              : null,
          visibleDossier: summary(snapshot.dossier, truncatedFields),
          truncatedFields,
        };
      },
      { control: true },
    ),
    tool(
      "cancelTask",
      "Cancel research task",
      "Request cancellation of the exact visible task and report its observed persisted state. Cancellation cannot undo a completed task or guarantee that an already accepted provider request was free.",
      taskSchema,
      async (input, options) => {
        const snapshot = readState();
        if (
          snapshot.job?.id !== input.jobId ||
          snapshot.job.dossierId !== input.dossierId ||
          snapshot.job.revision !== input.revision
        )
          throw new Error("job_context_mismatch");
        await perform("cancelAnalysis", input, options, { bound: false });
        const job = readState().job;
        if (job?.id !== input.jobId) throw new Error("securities_state_not_visible");
        return {
          status: job.status === "cancelled" ? "cancelled" : "cancellation_requested",
          jobId: job.id,
          dossierId: input.dossierId,
          revision: input.revision,
          taskStatus: job.status,
        };
      },
      { control: true },
    ),
    tool(
      "openEvidence",
      "Open exact source evidence",
      "Open the application's evidence panel for a source already attached to the exact visible dossier revision. For a metric, period selects its current or comparison source point. Does not fetch an arbitrary URL or claim the source website has finished loading.",
      objectSchema(
        {
          ...bindingProperties,
          sourceId: idSchema,
          sourceVersion: { type: ["string", "integer"], minLength: 1, maxLength: 160, minimum: 1 },
          metricId: idSchema,
          period: { type: "string", enum: ["current", "comparison"] },
        },
        ["dossierId", "revision", "sourceId"],
        { dependentRequired: { metricId: ["period"] } },
      ),
      async (input, options) => {
        const dossier = requireBinding(readState(), input);
        const metric = input.metricId
          ? ((dossier.metrics ?? []).find((item) => item.id === input.metricId) ??
            (dossier.reportProjection?.metrics ?? []).find((item) => item.id === input.metricId))
          : null;
        const point = metric?.[input.period] ?? null;
        if (
          input.metricId &&
          (!input.period ||
            point?.sourceId !== input.sourceId ||
            (input.sourceVersion !== undefined &&
              String(point.sourceVersion) !== String(input.sourceVersion)))
        )
          throw new Error("source_mismatch");
        const candidates = (dossier.sources ?? []).filter((source) => source.id === input.sourceId);
        const version = input.sourceVersion ?? point?.sourceVersion;
        const selected =
          version === undefined && candidates.length === 1
            ? candidates[0]
            : candidates.find((source) => String(source.version) === String(version));
        if (!selected) throw new Error("source_mismatch");
        const result = await perform("getEvidence", input, options);
        const snapshot = readState();
        if (
          result?.status !== "opened" ||
          snapshot.selectedSource?.source?.id !== input.sourceId ||
          String(snapshot.selectedSource.source.version) !== String(selected.version) ||
          result.source?.id !== input.sourceId ||
          String(result.source.version) !== String(selected.version) ||
          snapshot.selectedSource.dossierId !== input.dossierId ||
          snapshot.selectedSource.revision !== input.revision
        )
          throw new Error("securities_state_not_visible");
        const truncatedFields = [];
        return {
          status: "opened",
          dossierId: input.dossierId,
          revision: input.revision,
          source: project(result.source, SOURCE, truncatedFields, "source"),
          point: project(point, POINT, truncatedFields, "point"),
          truncatedFields,
        };
      },
    ),
    tool(
      "stageCorrections",
      "Stage reasoned corrections",
      "Persist a new draft revision with one or more value corrections and a reason for each. Original values and sources are retained. Corrected cells remain needs_review and can be omitted by the automatic report policy; this tool cannot assert source verification.",
      objectSchema(
        {
          ...bindingProperties,
          changes: { type: "array", minItems: 1, maxItems: 20, items: changeSchema },
          notes: { type: "string", minLength: 0, maxLength: 12000 },
        },
        ["dossierId", "revision", "changes"],
      ),
      async (input, options) => ({
        ...completedBinding(await perform("applyCorrection", input, options), input, "revised"),
        verificationStatus: "needs_review",
      }),
    ),
    tool(
      "resolveIssue",
      "Record issue resolution",
      "Save a reasoned acknowledgement only for a source issue that the application's rules allow acknowledging. This creates a new draft revision. Material missing evidence and unverified values cannot be waived through this tool.",
      objectSchema({
        ...bindingProperties,
        issueId: idSchema,
        reason: { type: "string", minLength: 8, maxLength: 1000 },
      }),
      async (input, options) =>
        completedBinding(await perform("resolveIssue", input, options), input, "revised"),
    ),
    tool(
      "requestApproval",
      "Request optional revision approval",
      "Open the optional legacy approval dialog for the exact visible revision when the user wants a recorded approval. Approval is not required to read or export a ready or limited report. Returns confirmation_required until the application's explicit confirmation occurs; this tool cannot supply approval intent.",
      bindingSchema,
      async (input, options) => {
        const result = await perform("requestApproval", input, options);
        const snapshot = readState();
        const dossier = requireBinding(snapshot, input);
        if (result?.status === "already_approved" && dossier.status === "approved")
          return { status: "already_approved", ...input };
        if (
          result?.status !== "confirmation_required" ||
          snapshot.approvalRequest?.dossierId !== input.dossierId ||
          snapshot.approvalRequest.revision !== input.revision
        )
          throw new Error("securities_state_not_visible");
        return {
          status: "confirmation_required",
          ...input,
          nextStep: "Confirm or cancel the exact revision in the visible application dialog.",
        };
      },
      { consequential: true },
    ),
    tool(
      "exportRevision",
      "Export research report",
      "Generate and retrieve XLSX or Markdown bytes for the exact visible ready or limited report, including its evidence limits. Human approval is optional. An unavailable report cannot be exported. Returns download_requested only after the controller requests a browser download; otherwise artifact_ready identifies generated bytes. Browser download completion is separate.",
      objectSchema({ ...bindingProperties, format: { type: "string", enum: ["xlsx", "md"] } }),
      async (input, options) => {
        if (requireBinding(readState(), input).reportReadiness?.canExport === false)
          throw new Error("report_unavailable");
        const result = await perform("exportRevision", input, options);
        if (
          !["artifact_ready", "download_requested"].includes(result?.status) ||
          result.artifactReady !== true ||
          result.dossierId !== input.dossierId ||
          result.revision !== input.revision ||
          result.format !== input.format ||
          typeof result.filename !== "string" ||
          result.filename.length < 1 ||
          result.filename.length > 250 ||
          !Number.isSafeInteger(result.bytes) ||
          result.bytes < 1
        )
          throw new Error("securities_result_invalid");
        return {
          status: result.status,
          artifactStatus: "generated",
          ...input,
          filename: result.filename,
          bytes: result.bytes,
        };
      },
    ),
    tool(
      "startFollowup",
      "Start dossier follow-up",
      "Ask a follow-up anchored to the exact visible company, comparison periods, and dossier revision. May start a paid OpenRouter task under the backend configuration. Read task status, then the chat section for the bound result; document text cannot change tools or permissions.",
      objectSchema({ ...bindingProperties, question: query }),
      (input, options) => startTask("askFollowup", input, options),
      { consequential: true },
    ),
  ]);
}

export function registerSecuritiesWebMcp(
  actions,
  { documentObject = globalThis.document, onRegistrationError } = {},
) {
  return registerImperativeWebMcpCatalog({
    catalogKey: CATALOG,
    documentObject,
    onRegistrationError,
    createTools: (signal) => createSecuritiesWebMcpTools(actions, { signal }),
  });
}
