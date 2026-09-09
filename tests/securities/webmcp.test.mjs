import assert from "node:assert/strict";
import test from "node:test";

import {
  createDossier,
  reviseDossier,
  applyModelAnalysis,
  assertApprovable,
} from "../../shared/securities/dossier.js";
import { projectSecuritiesReport } from "../../shared/securities/report.js";
import {
  getSecuritiesCatalog,
  resolveSecuritiesScope,
  loadFrozenSecuritiesDataset,
} from "../../shared/securities/catalog.js";
import { createSecuritiesController } from "../../src/securities/controller.js";
import {
  createSecuritiesWebMcpTools,
  registerSecuritiesWebMcp,
  SECURITIES_WEBMCP_TOOL_NAMES,
  SECURITIES_WEBMCP_MAX_OUTPUT_CHARS,
} from "../../src/securities/webmcp.js";

const BINDING = Object.freeze({ dossierId: "dossier-1", revision: 1 });
const NOW = "2026-09-06T10:00:00.000Z";
const SOURCE_VERSION = `sha256:${"a".repeat(64)}`;

function dataset() {
  const point = (value) => ({
    value,
    rawText: String(value),
    originalUnit: "VND_million",
    sourceId: "fixture-source",
    sourceVersion: SOURCE_VERSION,
    verification: "verified",
    locator: {
      precision: "table_cell",
      page: 4,
      table: "Fixture income statement",
      rowCode: "10",
      column: "Current year",
    },
  });
  return {
    company: {
      id: "TEST",
      ticker: "TST",
      name: "Internal contract fixture",
      sector: { en: "Fixture", vi: "Dữ liệu kiểm thử" },
    },
    period: {
      id: "FY2025",
      label: { en: "FY 2025", vi: "Năm 2025" },
      kind: "annual",
      scope: "consolidated",
      year: 2025,
    },
    comparisonPeriod: {
      id: "FY2024",
      label: "FY 2024",
      kind: "annual",
      scope: "consolidated",
      year: 2024,
    },
    sources: [
      {
        id: "fixture-source",
        version: SOURCE_VERSION,
        hash: "a".repeat(64),
        url: "https://example.com/fixture.pdf",
        title: "Internal contract fixture; not a fetched financial report",
        fetchedAt: NOW,
        rights: { status: "test_fixture", fullTextRedistribution: false },
      },
    ],
    metrics: [
      {
        id: "revenue",
        unit: "VND_million",
        label: { en: "Revenue", vi: "Doanh thu" },
        definition: "Test net revenue",
        current: point(100),
        comparison: point(80),
      },
    ],
    issues: [
      {
        id: "scope-note",
        code: "source_scope",
        severity: "notice",
        allowAcknowledgment: true,
        message: "Explicitly acknowledge the fixture scope when testing issue resolution.",
        metricIds: [],
        sourceIds: ["fixture-source"],
      },
    ],
  };
}

function modelResultFixture() {
  // Match the structured payload observed at the provider integration gate.
  // All values below are synthetic; the receipt identifies a fixture call.
  const numericOrigins = ["current", "comparison"].map((side) => ({
    id: "fixture-source",
    version: SOURCE_VERSION,
    metricId: "revenue",
    side,
    origin: "source_extraction",
    correctionId: null,
    locator: dataset().metrics[0][side].locator,
    sourceValue: side === "current" ? 100 : 80,
    sourceUnit: "VND_million",
    displayUnit: "VND_million",
  }));
  const receipt = {
    evidenceType: "fixture",
    operation: "analysis",
    attempt: 1,
    requestedModel: "meta/muse-spark-1.3-contributor",
    actualModel: "meta/muse-spark-1.3-contributor",
    provider: "fixture-provider",
    strategy: "direct",
    selectedEndpoints: [{ provider: "fixture-provider", nativeModel: "fixture-native-model" }],
    providerAttempts: [],
    serverTools: [],
    requestId: "fixture-request",
    startedAt: NOW,
    completedAt: NOW,
    latencyMs: 0,
    httpStatus: 200,
    outcome: "completed",
    errorCode: null,
    inputTokens: 100,
    outputTokens: 60,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 10,
    costUsd: null,
    costStatus: "unknown",
    webSearchRequests: null,
    webFetchRequests: null,
    validation: {
      status: "passed",
      checks: [
        "exact_model",
        "immutable_revision",
        "numeric_binding",
        "quote_containment",
        "closed_schema",
      ],
      semanticEntailment: "analyst_review_required",
    },
  };
  return {
    dossierId: BINDING.dossierId,
    revision: BINDING.revision,
    claims: [
      {
        id: "comparable-basis",
        kind: "source_fact",
        metricIds: [],
        sourceIds: ["fixture-source"],
        text: "The source states: The fixture uses the same accounting basis.",
        evidenceQuotes: [
          {
            sourceId: "fixture-source",
            sourceVersion: SOURCE_VERSION,
            sourceExcerptId: "fixture-basis",
            quote: "The fixture uses the same accounting basis.",
            locator: { page: 4, note: "Comparative information", precision: "page" },
          },
        ],
        origin: "ai_synthesis",
        textOrigin: "verbatim_source_quotes",
        numericOrigins: [],
        reviewStatus: "analyst_review_required",
      },
      {
        id: "revenue-change",
        kind: "calculated",
        metricIds: ["revenue"],
        sourceIds: ["fixture-source"],
        text: "Fixture revenue: 100 VND million versus 80 VND million; increase of 20 VND million, or 25%.",
        evidenceQuotes: [],
        origin: "ai_synthesis",
        textOrigin: "server_composed_from_verified_metrics",
        numericOrigins,
        reviewStatus: "analyst_review_required",
      },
    ],
    summary: "The fixture uses a comparable accounting basis. Fixture revenue increased.",
    questions: ["Which source passages explain the change?"],
    limitations: [
      "Synthetic contract fixture; does not establish financial facts or a live provider result.",
    ],
    origin: "ai_synthesis",
    summaryOrigin: "server_composed_from_validated_claims",
    promptVersion: "securities-evidence-v1",
    model: "meta/muse-spark-1.3-contributor",
    locale: "en",
    receipt,
    receipts: [structuredClone(receipt)],
  };
}

function modelReportFixture() {
  const analysis = modelResultFixture();
  const checkedClaims = analysis.claims.map((claim) => ({
    id: claim.id,
    verdict: "supported",
    reason: "Matches the supplied internal fixture evidence.",
  }));
  return {
    ...analysis,
    reportVersion: "securities-report-v2",
    summary: analysis.claims[0].text,
    claims: analysis.claims.map((claim) => ({
      ...claim,
      textOrigin: "model_narrative_with_verified_bindings",
      reviewStatus: "automatically_checked",
      consistencyCheck: checkedClaims.find((check) => check.id === claim.id),
    })),
    report: {
      headline: "Internal fixture research report",
      summaryClaimIds: ["comparable-basis"],
      sections: [{ id: "performance", claimIds: ["revenue-change"] }],
    },
    research: {
      status: "limited",
      steps: [
        {
          id: "read-statement",
          sourceId: "fixture-source",
          sourceVersion: SOURCE_VERSION,
          query: "comparative revenue",
          pages: [4],
          status: "read",
          passageIds: ["fixture-basis"],
          coverage: {
            searchedPageCount: 2,
            totalPages: 5,
            returnedPages: [4],
            truncated: true,
            nextCursor: 1,
            unusablePages: [3],
          },
          sourceQuality: {
            qualityVersion: "fixture-quality-v1",
            fullOriginalFetched: true,
            fullTextVerified: false,
            materialCellsVerified: true,
            method: "ocr",
            pageCount: 5,
            textPages: 0,
            ocrPages: 5,
            extractedPages: 5,
            pagesWithoutText: [],
            pagesWithoutUsableText: [3],
            pagesRequiringReview: [1, 2, 3, 4, 5],
          },
          pageQuality: [
            {
              page: 3,
              method: "ocr",
              status: "unusable",
              ocrConfidence: 0,
              textCharacters: 10,
              qualityFlags: ["sideways_scan"],
              reviewedNumericCellsOnly: false,
            },
            {
              page: 4,
              method: "ocr",
              status: "extracted_unreviewed",
              ocrConfidence: 70,
              textCharacters: 400,
              qualityFlags: ["numeric_cells_verified_only"],
              reviewedNumericCellsOnly: true,
            },
          ],
          receipt: {
            evidenceType: "local_original",
            parserVersion: "fixture-parser",
            extractionFileSha256: "b".repeat(64),
            responseSha256: "c".repeat(64),
            sourceHash: "a".repeat(64),
            fullTextVerified: false,
            verifiedLedgerHashes: ["d".repeat(64), "e".repeat(64)],
            readerVersion: "fixture-reader-v1",
            representationVersion: "fixture-representation-v1",
            representationHash: "f".repeat(64),
            qualityVersion: "fixture-quality-v1",
            manifestSha256: "1".repeat(64),
            requestSha256: "2".repeat(64),
            readAt: NOW,
          },
        },
        {
          id: "read-cash-flow",
          sourceId: "fixture-source",
          sourceVersion: SOURCE_VERSION,
          query: "cash flow",
          pages: [3],
          status: "unavailable",
          passageIds: [],
          code: "source_page_unusable",
        },
      ],
      gaps: [
        {
          topic: "cash_and_funding",
          reason: "The selected fixture passage is unreadable.",
          impact: "Cash conversion cannot be assessed from this fixture.",
        },
      ],
    },
    validation: {
      deterministic: { status: "passed", checks: ["numeric_binding", "quote_containment"] },
      semantic: {
        status: "passed",
        method: "same_model_consistency_check",
        narrativeHash: "e".repeat(64),
        checkedClaimIds: ["comparable-basis", "revenue-change"],
        claims: checkedClaims,
        notes: {
          verdict: "supported",
          reason: "The stated limits match the synthetic source-reading record.",
        },
      },
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function fixture({ overrides = {}, render = true, beforeRequest, scopeResult } = {}) {
  const sourceDataset = dataset();
  let latest = createDossier(sourceDataset, { id: BINDING.dossierId, now: NOW, locale: "en" });
  const revisions = new Map([[1, structuredClone(latest)]]);
  const jobs = new Map();
  const calls = [];
  const publicDossier = (dossier) =>
    structuredClone({ ...dossier, ...projectSecuritiesReport(dossier) });
  const client = {
    async request(path, options = {}) {
      calls.push({ path, ...options });
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      await beforeRequest?.(path, options);
      if (path === "/catalog")
        return {
          companies: [{ ...sourceDataset.company, periods: [sourceDataset.period] }],
          sources: sourceDataset.sources,
        };
      if (path === "/scope") return { ...sourceDataset, ...scopeResult, query: options.body.query };
      if (path === "/dossiers" && options.method !== "POST")
        return { dossiers: [publicDossier(latest)] };
      if (path === "/dossiers" && options.method === "POST")
        return { dossier: publicDossier(latest) };
      if (/^\/dossiers\/dossier-1(?:\?|$)/u.test(path)) {
        const revision = new URL(path, "https://fixture.test").searchParams.get("revision");
        return { dossier: publicDossier(revision ? revisions.get(Number(revision)) : latest) };
      }
      if (path.endsWith("/revise")) {
        latest = reviseDossier(latest, options.body, {
          now: NOW,
          correctionId: () => "correction-1",
        });
        revisions.set(latest.revision, structuredClone(latest));
        return { dossier: publicDossier(latest) };
      }
      if (path.endsWith("/approve")) {
        assertApprovable(latest, options.body);
        latest = {
          ...latest,
          status: "approved",
          approval: { revision: latest.revision, at: NOW },
        };
        revisions.set(latest.revision, structuredClone(latest));
        return { dossier: publicDossier(latest) };
      }
      if (path.endsWith("/analyze") || path.endsWith("/chat")) {
        const job = {
          id: `job-${jobs.size + 1}`,
          dossierId: latest.id,
          revision: options.body.expectedRevision ?? options.body.revision,
          status: "running",
          kind: path.endsWith("/chat") ? "chat" : "analysis",
        };
        jobs.set(job.id, job);
        return { job: structuredClone(job) };
      }
      if (path.startsWith("/jobs/")) {
        const id = path.split("/")[2];
        const job = jobs.get(id);
        if (!job) throw Object.assign(new Error("job_not_found"), { code: "job_not_found" });
        if (path.endsWith("/cancel")) job.status = "cancelled";
        return { job: structuredClone(job) };
      }
      throw new Error("Unexpected contract-fixture request");
    },
    async download(input) {
      calls.push({ path: "download", ...input });
      return {
        filename: `fixture-v${input.revision}.${input.format}`,
        blob: new Blob(["internal export contract fixture"]),
        ...input,
      };
    },
  };
  const controller = createSecuritiesController({ client, locale: "en" });
  if (render)
    controller.subscribe(() => controller.markRendered(controller.getState().renderVersion));
  controller.markRendered(controller.getState().renderVersion);
  const actions = { ...controller, ...overrides };
  const tools = createSecuritiesWebMcpTools(actions);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const invoke = (key, input = {}, options) =>
    byName.get(SECURITIES_WEBMCP_TOOL_NAMES[key]).execute(input, options);
  const open = () => invoke("openDossier", BINDING);
  const cleanup = async () => {
    const job = controller.getState().job;
    if (job && ["queued", "running", "pending", "started"].includes(job.status))
      await controller.cancelAnalysis({ jobId: job.id });
    controller.newResearch();
  };
  return { controller, actions, tools, invoke, open, calls, jobs, cleanup, revisions };
}

test("catalog has closed schemas, stable task names, and truthful side-effect hints", () => {
  const context = fixture();
  assert.equal(context.tools.length, 15);
  assert.equal(new Set(context.tools.map((tool) => tool.name)).size, 15);
  assert.equal(Object.values(SECURITIES_WEBMCP_TOOL_NAMES).length, 15);
  assert.deepEqual(
    context.tools.map((tool) => tool.name),
    Object.values(SECURITIES_WEBMCP_TOOL_NAMES),
  );
  for (const tool of context.tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.untrustedContentHint, true);
    assert.equal(typeof tool.annotations.readOnlyHint, "boolean");
    assert.equal(typeof tool.execute, "function");
  }
  assert.equal(
    context.tools.find((tool) => tool.name === SECURITIES_WEBMCP_TOOL_NAMES.requestApproval)
      .annotations.consequentialHint,
    true,
  );
  assert.equal(
    context.tools.find((tool) => tool.name === SECURITIES_WEBMCP_TOOL_NAMES.startResearch)
      .annotations.consequentialHint,
    true,
  );
  assert.deepEqual(
    context.tools.find((tool) => tool.name === SECURITIES_WEBMCP_TOOL_NAMES.startResearch)
      .inputSchema.properties.defaultScope.required,
    ["companyId"],
  );
  assert.equal(
    context.tools.find((tool) => tool.name === SECURITIES_WEBMCP_TOOL_NAMES.getTaskStatus)
      .annotations.readOnlyHint,
    false,
  );
});

test("plain JSON validation rejects unsupported, inherited, accessor and symbol fields before action", async () => {
  let called = 0;
  const context = fixture({
    overrides: {
      openDossier() {
        called += 1;
      },
    },
  });
  const getter = Object.defineProperty({}, "dossierId", {
    enumerable: true,
    get() {
      called += 100;
      return "dossier-1";
    },
  });
  const invalid = [
    null,
    [],
    new Date(),
    Object.create(BINDING),
    Object.assign(Object.create(null), BINDING),
    getter,
    { ...BINDING, extra: true },
    { ...BINDING, [Symbol("hidden")]: 1 },
    { ...BINDING, revision: 0 },
    { ...BINDING, revision: 1.5 },
    { ...BINDING, revision: "1" },
    { dossierId: "../dossier-1" },
  ];
  for (const input of invalid)
    await assert.rejects(context.invoke("openDossier", input), TypeError);
  assert.equal(called, 0);
  await assert.rejects(context.invoke("configureScope", {}), TypeError);
  await assert.rejects(context.invoke("startResearch", {}), TypeError);
  await assert.rejects(
    context.invoke("startResearch", { query: "Fixture company", model: "other-provider" }),
    TypeError,
  );
  await assert.rejects(
    context.invoke("startResearch", {
      query: "Fixture company",
      defaultScope: { companyId: "TEST", sourceUrl: "https://example.com" },
    }),
    TypeError,
  );
  await assert.rejects(
    context.invoke("startResearch", { defaultScope: { companyId: "TEST" } }),
    TypeError,
  );
  await assert.rejects(
    context.invoke("startResearch", {
      query: "Fixture company",
      defaultScope: Object.create({ companyId: "TEST" }),
    }),
    TypeError,
  );
  for (const defaultScope of [
    {},
    { periodId: "FY2025" },
    { companyId: "T".repeat(81) },
    { companyId: "TEST:OTHER" },
    { companyId: "TEST", periodId: "FY.2025" },
  ]) {
    await assert.rejects(
      context.invoke("startResearch", { query: "Fixture company", defaultScope }),
      TypeError,
    );
  }
  await assert.rejects(
    context.invoke("openEvidence", { ...BINDING, sourceId: "fixture-source", metricId: "revenue" }),
    TypeError,
  );
});

test("one research tool resolves scope, saves a dossier and returns the actual started task after UI commit", async (t) => {
  const visible = deferred();
  const awaitingVisible = deferred();
  const context = fixture({
    overrides: {
      awaitVisible: () => {
        awaitingVisible.resolve();
        return visible.promise;
      },
    },
  });
  t.after(context.cleanup);
  let settled = false;
  const pending = context
    .invoke("startResearch", { query: "Test company FY 2025" })
    .then((result) => {
      settled = true;
      return result;
    });
  await awaitingVisible.promise;
  assert.equal(settled, false);
  assert.equal(context.controller.getState().dossier.id, BINDING.dossierId);
  assert.equal(context.controller.getState().job.status, "running");
  visible.resolve();
  const result = await pending;
  assert.equal(result.status, "started");
  assert.equal(result.jobId, "job-1");
  assert.equal(result.dossierId, BINDING.dossierId);
  assert.equal(result.revision, 1);
  assert.equal(result.taskStatus, "running");
  assert.equal(result.resultSection, "report");
  assert.equal(result.visibleDossier.reportReadiness.state, "limited");
  const submitted = context.calls.filter((call) => call.method === "POST");
  assert.deepEqual(
    submitted.map((call) => call.path),
    ["/scope", "/dossiers", "/dossiers/dossier-1/analyze"],
  );
  assert.deepEqual(
    {
      companyId: submitted[1].body.companyId,
      periodId: submitted[1].body.periodId,
      comparisonPeriodId: submitted[1].body.comparisonPeriodId,
    },
    { companyId: "TEST", periodId: "FY2025", comparisonPeriodId: "FY2024" },
  );
  assert.equal(submitted[2].body.expectedRevision, 1);
});

test("research requires an unambiguous supported scope and preserves the visible selection without creating paid work", async () => {
  for (const code of [
    "ambiguous_company",
    "ambiguous_period",
    "unsupported_period",
    "unsupported_comparison",
    "unsupported_company",
    "no_supported_company",
  ]) {
    const context = fixture({
      beforeRequest(path) {
        if (path === "/scope")
          throw Object.assign(new Error("private-source-response"), {
            code,
            details: { internal: "private-candidate-data" },
          });
      },
    });
    const selection = {
      query: "Resolve this fixture request",
      companyId: "TEST",
      defaultScope: { companyId: "DEFAULT", periodId: "FY2025" },
    };
    const result = await context.invoke("startResearch", selection);
    assert.equal(result.status, "scope_required");
    assert.equal(result.code, code);
    assert.deepEqual(result.selection, selection);
    assert.deepEqual((await context.invoke("getState")).researchDraft, selection);
    assert.equal(context.controller.getState().view, "start");
    assert.equal(context.controller.getState().dossier, null);
    assert.equal(context.jobs.size, 0);
    assert.deepEqual(
      context.calls.map((call) => call.path),
      ["/scope"],
    );
    assert.equal(JSON.stringify(result).includes("private-"), false);
  }
  const unresolved = fixture({ scopeResult: { ready: false, needsClarification: true } });
  const result = await unresolved.invoke("startResearch", { companyId: "TEST" });
  assert.equal(result.status, "scope_required");
  assert.equal(result.scope.ready, false);
  assert.equal(result.scope.needsClarification, true);
  assert.equal(unresolved.controller.getState().view, "scope");
  assert.equal(unresolved.jobs.size, 0);
  assert.deepEqual(
    unresolved.calls.map((call) => call.path),
    ["/scope"],
  );
});

test("research forwards default scope as hints and persists only the resolved selection", async (t) => {
  const context = fixture();
  t.after(context.cleanup);
  const input = {
    query: "Test company FY 2025",
    defaultScope: { companyId: "DEFAULT", periodId: "H1_2026", comparisonPeriodId: "H1_2025" },
  };
  const result = await context.invoke("startResearch", input);
  assert.equal(result.status, "started");
  const submitted = context.calls.filter((call) => call.method === "POST");
  assert.deepEqual(submitted[0].body, { ...input, locale: "en" });
  assert.equal(submitted[0].body.companyId, undefined);
  assert.equal(submitted[1].body.companyId, "TEST");
  assert.equal(submitted[1].body.periodId, "FY2025");
  assert.equal(submitted[1].body.comparisonPeriodId, "FY2024");
  assert.equal(submitted[1].body.defaultScope, undefined);
});

test("research retry reuses the saved revision after task creation fails instead of duplicating the dossier", async (t) => {
  let failAnalysis = true;
  const context = fixture({
    beforeRequest(path) {
      if (path.endsWith("/analyze") && failAnalysis)
        throw Object.assign(new Error("private-provider-response"), {
          code: "provider_rate_limited",
        });
    },
  });
  t.after(context.cleanup);
  const input = { companyId: "TEST", periodId: "FY2025", comparisonPeriodId: "FY2024" };
  assert.deepEqual(await context.invoke("startResearch", input), {
    status: "error",
    error: { code: "provider_rate_limited" },
  });
  assert.equal(context.controller.getState().dossier.id, BINDING.dossierId);
  assert.equal(context.jobs.size, 0);
  failAnalysis = false;
  const retry = await context.invoke("startResearch", input);
  assert.equal(retry.status, "started");
  assert.equal(retry.revision, 1);
  assert.equal(
    context.calls.filter((call) => call.path === "/dossiers" && call.method === "POST").length,
    1,
  );
});

test("create requires the exact configured company and both periods; returns persisted visible revision", async () => {
  const context = fixture();
  const selection = { companyId: "TEST", periodId: "FY2025", comparisonPeriodId: "FY2024" };
  assert.equal((await context.invoke("createDossier", selection)).error.code, "scope_required");
  assert.equal(
    (await context.invoke("configureScope", { query: "Test company FY 2025" })).status,
    "configured",
  );
  assert.equal(
    (await context.invoke("createDossier", { ...selection, companyId: "OTHER" })).error.code,
    "scope_required",
  );
  assert.deepEqual(await context.invoke("createDossier", selection), {
    status: "created",
    ...BINDING,
  });
  assert.equal(context.controller.getState().dossier.id, BINDING.dossierId);
  const request = context.calls.find((call) => call.path === "/dossiers" && call.method === "POST");
  assert.deepEqual(
    {
      companyId: request.body.companyId,
      periodId: request.body.periodId,
      comparisonPeriodId: request.body.comparisonPeriodId,
    },
    selection,
  );
});

test("mutations wait for a committed visible state and reject success for the wrong revision", async () => {
  const visible = deferred();
  const context = fixture({ overrides: { awaitVisible: () => visible.promise } });
  let settled = false;
  const opening = context.open().then((result) => {
    settled = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(context.controller.getState().dossier.revision, 1);
  visible.resolve();
  assert.equal((await opening).status, "opened");
  const bad = fixture({
    overrides: { openDossier: async () => ({ status: "opened", dossierId: "other", revision: 1 }) },
  });
  assert.equal((await bad.open()).error.code, "securities_state_not_visible");
});

test("reads preserve source versions, original values and deterministic calculation inputs", async () => {
  const context = fixture();
  await context.open();
  const metrics = await context.invoke("readDossier", { ...BINDING, section: "metrics", limit: 1 });
  assert.equal(metrics.data[0].current.value, 100);
  assert.equal(metrics.data[0].current.sourceVersion, SOURCE_VERSION);
  assert.equal(metrics.data[0].calculation.absoluteChange.value, 20);
  assert.equal(metrics.data[0].calculation.relativeChangePct.value, 25);
  assert.deepEqual(
    metrics.data[0].calculation.absoluteChange.inputRefs.map((item) => item.value),
    [100, 80],
  );
  const analysis = await context.invoke("readDossier", { ...BINDING, section: "analysis" });
  assert.equal(analysis.data.origin, "rules");
  const stale = await context.invoke("readDossier", {
    ...BINDING,
    revision: 2,
    section: "metrics",
  });
  assert.equal(stale.error.code, "securities_revision_not_visible");
});

test("structured analysis retains quote and numeric provenance across an actual notes-only revision", async () => {
  const context = fixture();
  await context.open();
  const state = context.controller.getState();
  const analyzed = applyModelAnalysis(state.dossier, modelResultFixture(), { now: NOW });
  const carried = reviseDossier(
    analyzed,
    {
      expectedRevision: 2,
      requestId: "fixture-notes-only",
      notes: "Review the comparable basis before approving this fixture.",
    },
    { now: NOW },
  );
  Object.assign(carried, projectSecuritiesReport(carried));
  state.dossier = carried;
  carried.analysis.rawProviderResponse = "private-provider-payload";
  carried.analysis.claims[0].evidenceQuotes[0].rawDocument = "private-document-payload";
  carried.analysis.claims[1].numericOrigins[0].internalPrompt = "private-numeric-prompt";
  carried.analysis.receipt.selectedEndpoints[0].apiKey = "private-endpoint-key";
  carried.analysis.receipt.validation.rawResponse = "private-validation-payload";
  const binding = { dossierId: BINDING.dossierId, revision: 3 };
  const first = await context.invoke("readDossier", { ...binding, section: "analysis", limit: 1 });
  assert.equal(first.status, "available");
  assert.equal(first.revision, 3);
  assert.equal(first.data.dossierId, BINDING.dossierId);
  assert.equal(first.data.revision, 1);
  assert.equal(first.data.inputRevision, 1);
  assert.equal(first.data.origin, "model");
  assert.equal(first.data.summaryOrigin, "server_composed_from_validated_claims");
  assert.deepEqual(first.analysisLineage, {
    generatedInRevision: 2,
    carriedFromRevision: 2,
    carriedAt: NOW,
    reason: "analyst_notes_only",
  });
  assert.equal(first.total, 2);
  assert.equal(first.nextOffset, 1);
  const quote = first.data.claims[0].evidenceQuotes[0];
  assert.equal(quote.sourceVersion, SOURCE_VERSION);
  assert.equal(quote.sourceExcerptId, "fixture-basis");
  assert.deepEqual(quote.locator, { page: 4, note: "Comparative information", precision: "page" });
  assert.equal(first.data.claims[0].textOrigin, "verbatim_source_quotes");
  assert.equal(first.data.claims[0].reviewStatus, "analyst_review_required");
  const second = await context.invoke("readDossier", {
    ...binding,
    section: "analysis",
    offset: first.nextOffset,
    limit: 1,
  });
  assert.equal(second.nextOffset, null);
  assert.equal(second.data.summary, first.data.summary);
  assert.equal(second.data.claims[0].textOrigin, "server_composed_from_verified_metrics");
  assert.deepEqual(
    second.data.claims[0].numericOrigins,
    modelResultFixture().claims[1].numericOrigins,
  );
  assert.equal(second.data.receipt.evidenceType, "fixture");
  assert.equal(second.data.receipt.reasoningTokens, 10);
  assert.equal(second.data.receipt.costUsd, null);
  assert.deepEqual(second.data.receipt.validation, modelResultFixture().receipt.validation);
  assert.deepEqual(
    second.data.receipt.selectedEndpoints,
    modelResultFixture().receipt.selectedEndpoints,
  );
  assert.equal(JSON.stringify([first, second]).includes("private-"), false);
  assert.equal(JSON.stringify(first).length <= SECURITIES_WEBMCP_MAX_OUTPUT_CHARS, true);
  assert.equal(JSON.stringify(second).length <= SECURITIES_WEBMCP_MAX_OUTPUT_CHARS, true);
  const overview = await context.invoke("readDossier", { ...binding, section: "overview" });
  assert.deepEqual(overview.dossier.analysisLineage, first.analysisLineage);
  assert.equal(
    (await context.invoke("readDossier", { ...BINDING, section: "analysis" })).error.code,
    "securities_revision_not_visible",
  );
});

test("analyst notes are fully readable in bounded chunks for the exact visible saved revision", async () => {
  const context = fixture();
  await context.open();
  const notes = `${"Analyst note 🧾.\n".repeat(1000).slice(0, 11_996)}Done`;
  assert.equal(notes.length, 12_000);
  await context.controller.applyCorrection({ ...BINDING, notes });
  const binding = { dossierId: BINDING.dossierId, revision: 2 };
  assert.equal(
    (await context.invoke("readDossier", { ...BINDING, section: "notes" })).error.code,
    "securities_revision_not_visible",
  );
  const chunks = [];
  let offset = 0;
  do {
    const page = await context.invoke("readDossier", {
      ...binding,
      section: "notes",
      offset,
      limit: 2,
    });
    assert.equal(page.status, "available");
    assert.equal(page.total, 6);
    assert.equal(page.totalCharacters, notes.length);
    assert.equal(page.chunkSize, 2_000);
    assert.equal(page.data.length <= 2, true);
    assert.deepEqual(page.truncatedFields, []);
    assert.equal(JSON.stringify(page).length <= SECURITIES_WEBMCP_MAX_OUTPUT_CHARS, true);
    for (const chunk of page.data) {
      assert.equal(chunk.characterOffset, chunks.length * 2_000);
      assert.equal(chunk.text.length <= 2_000, true);
      chunks.push(chunk.text);
    }
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(chunks.join(""), notes);
  assert.equal((await context.invoke("getState")).dossier.notesLength, notes.length);
  assert.deepEqual(
    (await context.invoke("readDossier", { ...binding, section: "notes", offset: 6 })).data,
    [],
  );
  await context.open();
  const historical = await context.invoke("readDossier", { ...BINDING, section: "notes" });
  assert.deepEqual(historical.data, []);
  assert.equal(historical.totalCharacters, 0);
  assert.equal(
    (await context.invoke("readDossier", { ...binding, section: "notes" })).error.code,
    "securities_revision_not_visible",
  );
});

test("escaped maximum-length notes adapt to JSON size without dropping saved characters", async () => {
  const context = fixture();
  await context.open();
  const notes = '"\\'.repeat(6_000);
  assert.equal(notes.length, 12_000);
  await context.controller.applyCorrection({ ...BINDING, notes });
  const binding = { dossierId: BINDING.dossierId, revision: 2 };
  const chunks = [];
  let offset = 0;
  let pageCount = 0;
  do {
    const page = await context.invoke("readDossier", {
      ...binding,
      section: "notes",
      offset,
      limit: 20,
    });
    assert.equal(page.status, "available");
    assert.equal(page.total, 6);
    assert.equal(page.totalCharacters, notes.length);
    assert.equal(page.offset, offset);
    assert.equal(page.data.length > 0, true);
    assert.equal(
      page.nextOffset,
      offset + page.data.length < page.total ? offset + page.data.length : null,
    );
    assert.deepEqual(page.truncatedFields, []);
    assert.equal(JSON.stringify(page).length <= SECURITIES_WEBMCP_MAX_OUTPUT_CHARS, true);
    for (const chunk of page.data) {
      assert.equal(chunk.characterOffset, chunks.length * 2_000);
      chunks.push(chunk.text);
    }
    pageCount += 1;
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(pageCount, 2);
  assert.equal(chunks.join(""), notes);
});

test("revision-bound chat exposes structured answers, evidence and history limits without internal fields", async () => {
  const context = fixture();
  await context.open();
  const answer = modelResultFixture();
  answer.receipt.operation = "chat";
  answer.receipts[0].operation = "chat";
  answer.systemPrompt = "private-chat-prompt";
  answer.claims[1].numericOrigins[0].authorization = "private-chat-authorization";
  const state = context.controller.getState();
  state.dossier.chatHistoryTruncated = true;
  state.chat = [
    {
      role: "assistant",
      revision: 2,
      content: "private-stale-answer",
      answer: "private-stale-answer",
    },
    { role: "user", revision: 1, content: "Which source passages explain the change?", at: NOW },
    { role: "assistant", revision: 1, answer, jobId: "fixture-chat-job", at: NOW },
    { role: "assistant", revision: 1, answer: "Legacy text remains readable." },
  ];
  const first = await context.invoke("readDossier", { ...BINDING, section: "chat", limit: 2 });
  assert.equal(first.status, "available");
  assert.equal(first.total, 3);
  assert.equal(first.nextOffset, 2);
  assert.equal(first.historyTruncated, true);
  assert.equal(first.data[0].role, "user");
  assert.equal(first.data[1].at, NOW);
  const result = first.data[1].answer;
  assert.equal(result.dossierId, BINDING.dossierId);
  assert.equal(result.revision, 1);
  assert.equal(result.summary, answer.summary);
  assert.deepEqual(result.questions, answer.questions);
  assert.deepEqual(result.limitations, answer.limitations);
  assert.equal(result.claims[0].evidenceQuotes[0].sourceVersion, SOURCE_VERSION);
  assert.deepEqual(result.claims[1].numericOrigins, modelResultFixture().claims[1].numericOrigins);
  assert.equal(result.receipt.operation, "chat");
  assert.equal(result.receipts[0].evidenceType, "fixture");
  assert.equal(JSON.stringify(first).includes("private-"), false);
  const last = await context.invoke("readDossier", {
    ...BINDING,
    section: "chat",
    offset: first.nextOffset,
    limit: 2,
  });
  assert.deepEqual(last.data[0].answer, { text: "Legacy text remains readable." });
  assert.equal(last.nextOffset, null);
});

test("large structured chat pages automatically fit both default and requested limits without losing turns or evidence", async () => {
  const context = fixture();
  await context.open();
  const answer = modelResultFixture();
  answer.summary = "S".repeat(2_000);
  for (const claim of answer.claims) claim.text = "C".repeat(2_000);
  const chat = Array.from({ length: 4 }, (_, index) => ({
    role: "assistant",
    revision: 1,
    jobId: `fixture-chat-${index}`,
    answer: structuredClone(answer),
  }));
  context.controller.getState().chat = chat;
  for (const requested of [{}, { limit: 20 }]) {
    const collected = [];
    let offset = 0;
    do {
      const page = await context.invoke("readDossier", {
        ...BINDING,
        section: "chat",
        offset,
        ...requested,
      });
      assert.equal(page.status, "available");
      assert.equal(page.total, chat.length);
      assert.equal(page.offset, offset);
      assert.equal(page.data.length > 0 && page.data.length < chat.length, true);
      assert.equal(
        page.nextOffset,
        offset + page.data.length < chat.length ? offset + page.data.length : null,
      );
      assert.deepEqual(page.truncatedFields, []);
      assert.equal(JSON.stringify(page).length <= SECURITIES_WEBMCP_MAX_OUTPUT_CHARS, true);
      collected.push(...page.data);
      offset = page.nextOffset;
    } while (offset !== null);
    assert.deepEqual(collected, chat);
    assert.equal(new Set(collected.map((turn) => turn.jobId)).size, chat.length);
  }
});

test("one oversized structured turn remains an explicit error instead of an empty page or omitted claims", async () => {
  const context = fixture();
  await context.open();
  const answer = modelResultFixture();
  answer.claims = Array.from({ length: 16 }, (_, index) => ({
    ...structuredClone(answer.claims[index % 2]),
    id: `fixture-long-claim-${index}`,
    text: "C".repeat(2_000),
  }));
  context.controller.getState().chat = [
    { role: "assistant", revision: 1, jobId: "fixture-large-turn", answer },
  ];
  for (const requested of [{}, { limit: 1 }, { limit: 20 }]) {
    assert.deepEqual(
      await context.invoke("readDossier", { ...BINDING, section: "chat", ...requested }),
      { status: "error", error: { code: "securities_result_too_large" } },
    );
  }
});

test("analysis claim pages adapt while preserving the complete structured claims and repeated evidence metadata", async () => {
  const context = fixture();
  await context.open();
  const analysis = modelResultFixture();
  analysis.claims = Array.from({ length: 12 }, (_, index) => ({
    ...structuredClone(analysis.claims[index % 2]),
    id: `fixture-paginated-claim-${index}`,
    text: `Claim ${index}. ` + "C".repeat(1_980),
  }));
  const dossier = applyModelAnalysis(context.controller.getState().dossier, analysis, { now: NOW });
  Object.assign(dossier, projectSecuritiesReport(dossier));
  context.controller.getState().dossier = dossier;
  const binding = { dossierId: BINDING.dossierId, revision: 2 };
  const collected = [];
  let offset = 0;
  let pageCount = 0;
  do {
    const page = await context.invoke("readDossier", {
      ...binding,
      section: "analysis",
      offset,
      limit: 20,
    });
    assert.equal(page.status, "available");
    assert.equal(page.offset, offset);
    assert.equal(page.total, analysis.claims.length);
    assert.equal(page.data.claims.length > 0, true);
    assert.equal(
      page.nextOffset,
      offset + page.data.claims.length < page.total ? offset + page.data.claims.length : null,
    );
    assert.equal(page.data.summary, analysis.summary);
    assert.deepEqual(page.data.receipt, analysis.receipt);
    assert.deepEqual(page.data.receipts, analysis.receipts);
    assert.deepEqual(page.reportReadiness, dossier.reportReadiness);
    assert.deepEqual(page.truncatedFields, []);
    assert.equal(JSON.stringify(page).length <= SECURITIES_WEBMCP_MAX_OUTPUT_CHARS, true);
    collected.push(...page.data.claims);
    pageCount += 1;
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(pageCount > 1, true);
  assert.deepEqual(collected, analysis.claims);
  assert.equal(new Set(collected.map((claim) => claim.id)).size, analysis.claims.length);
});

test("the friendly report retains validated narrative references and reports actual research limits", async () => {
  const context = fixture();
  await context.open();
  const state = context.controller.getState();
  const analyzed = applyModelAnalysis(state.dossier, modelReportFixture(), { now: NOW });
  analyzed.analysis.research.steps[0].receipt.privatePath = "private-local-extraction-path";
  analyzed.analysis.research.steps[0].sourceQuality.privatePath = "private-source-quality-path";
  analyzed.analysis.research.steps[0].pageQuality[0].rawOcr = "private-raw-ocr-text";
  analyzed.analysis.validation.semantic.rawProviderResponse = "private-semantic-response";
  analyzed.analysis.validation.semantic.notes.rawProviderResponse = "private-notes-check-response";
  Object.assign(analyzed, projectSecuritiesReport(analyzed));
  state.dossier = analyzed;
  const binding = { dossierId: BINDING.dossierId, revision: 2 };
  const first = await context.invoke("readDossier", { ...binding, section: "report", limit: 1 });
  assert.equal(first.status, "available");
  assert.equal(first.analysisAvailable, true);
  assert.equal(first.data.reportVersion, "securities-report-v2");
  assert.equal(first.data.reportMode, "automatic");
  assert.deepEqual(first.data.report, analyzed.reportProjection.analysis.report);
  assert.equal(first.data.summary, analyzed.reportProjection.analysis.summary);
  assert.equal(first.total, 2);
  assert.equal(first.nextOffset, 1);
  assert.equal(first.data.claims[0].text, analyzed.analysis.claims[0].text);
  assert.equal(first.data.claims[0].evidenceQuotes, undefined);
  assert.equal(first.reportReadiness.state, "limited");
  assert.equal(first.reportReadiness.canExport, true);
  assert.equal(first.reportReadiness.includedClaimCount, 2);
  assert.equal(
    first.reportReadiness.reasons.some((reason) => reason.code === "research_gap"),
    true,
  );
  assert.equal(first.data.validation.semantic.method, "same_model_consistency_check");
  assert.equal(first.data.validation.semantic.status, "passed");
  assert.deepEqual(
    first.data.validation.semantic.notes,
    modelReportFixture().validation.semantic.notes,
  );
  const second = await context.invoke("readDossier", {
    ...binding,
    section: "report",
    offset: first.nextOffset,
    limit: 1,
  });
  assert.equal(second.data.claims[0].id, "revenue-change");
  assert.equal(second.nextOffset, null);
  const research = await context.invoke("readDossier", {
    ...binding,
    section: "research",
    limit: 1,
  });
  assert.equal(research.total, 2);
  assert.equal(research.nextOffset, 1);
  assert.equal(research.data.steps[0].query, "comparative revenue");
  assert.deepEqual(
    research.data.steps[0].coverage,
    modelReportFixture().research.steps[0].coverage,
  );
  assert.deepEqual(research.data.steps[0].receipt, modelReportFixture().research.steps[0].receipt);
  assert.deepEqual(
    research.data.steps[0].sourceQuality,
    modelReportFixture().research.steps[0].sourceQuality,
  );
  assert.deepEqual(
    research.data.steps[0].pageQuality,
    modelReportFixture().research.steps[0].pageQuality,
  );
  assert.deepEqual(research.data.gaps, modelReportFixture().research.gaps);
  const nextStep = await context.invoke("readDossier", {
    ...binding,
    section: "research",
    offset: 1,
    limit: 1,
  });
  assert.equal(nextStep.data.steps[0].status, "unavailable");
  assert.equal(nextStep.data.steps[0].code, "source_page_unusable");
  const readiness = await context.invoke("readDossier", {
    ...binding,
    section: "readiness",
    limit: 1,
  });
  assert.equal(readiness.data.revision, 2);
  assert.equal(readiness.data.reasons.length, 1);
  assert.equal(readiness.data.reasons[0].category, "limitation");
  assert.equal(readiness.data.reasons[0].affectsReadiness, true);
  assert.equal(readiness.nextOffset, 1);
  const overview = await context.invoke("readDossier", { ...binding, section: "overview" });
  assert.equal(overview.dossier.analysis.summary, first.data.summary);
  assert.equal(overview.dossier.analysis.research.steps[1].status, "unavailable");
  assert.equal(
    JSON.stringify([first, second, research, nextStep, overview]).includes("private-"),
    false,
  );
});

test("readiness distinguishes supported business risk from a report limitation and exposes freshly computed issues", async () => {
  const context = fixture();
  await context.open();
  const analysis = modelReportFixture();
  analysis.research.status = "complete";
  analysis.research.gaps = [];
  const dossier = applyModelAnalysis(context.controller.getState().dossier, analysis, { now: NOW });
  dossier.sourceIssues = [
    {
      id: "fixture-nonrecurring",
      code: "nonrecurring_item",
      severity: "warning",
      message: {
        en: "Assess the recurrence of the source-backed fixture disposal gain.",
        vi: "Đánh giá tính lặp lại của khoản lãi kiểm thử.",
      },
      metricIds: [],
      sourceIds: ["fixture-source"],
      requiresSourceImport: false,
      allowAcknowledgment: true,
    },
  ];
  Object.assign(dossier, projectSecuritiesReport(dossier));
  context.controller.getState().dossier = dossier;
  const binding = { dossierId: BINDING.dossierId, revision: 2 };
  const readiness = await context.invoke("readDossier", { ...binding, section: "readiness" });
  assert.equal(readiness.data.state, "ready");
  assert.equal(readiness.data.canExport, true);
  assert.equal(readiness.data.reasons.length, 1);
  assert.equal(readiness.data.reasons[0].category, "business_risk");
  assert.equal(readiness.data.reasons[0].affectsReadiness, false);
  const reportIssues = await context.invoke("readDossier", {
    ...binding,
    section: "report_issues",
    limit: 1,
  });
  assert.equal(reportIssues.data[0].id, "fixture-nonrecurring");
  assert.equal(reportIssues.data[0].requiresSourceImport, false);
  const originalIssues = await context.invoke("readDossier", { ...binding, section: "issues" });
  assert.equal(originalIssues.data[0].id, "scope-note");
  dossier.analysis.research.status = "limited";
  dossier.analysis.research.gaps = modelReportFixture().research.gaps;
  Object.assign(dossier, projectSecuritiesReport(dossier));
  const limited = await context.invoke("readDossier", { ...binding, section: "readiness" });
  assert.equal(limited.data.state, "limited");
  assert.equal(
    limited.data.reasons.find((reason) => reason.code === "research_gap").category,
    "limitation",
  );
  assert.equal(
    limited.data.reasons.find((reason) => reason.code === "research_gap").affectsReadiness,
    true,
  );
});

test("report source notes retain exact versioned evidence while omitted notes stay in the expert audit", async () => {
  const context = fixture();
  await context.open();
  const dossier = context.controller.getState().dossier;
  const note = {
    id: "fixture-source-note",
    sourceId: "fixture-source",
    sourceVersion: SOURCE_VERSION,
    kind: "source_statement",
    page: 4,
    note: "Comparative information",
    quote: "The fixture uses the same accounting basis.",
    text: {
      en: "The synthetic comparison uses the same accounting basis.",
      vi: "Dữ liệu kiểm thử dùng cùng cơ sở kế toán.",
    },
    locator: { page: 4, note: "Comparative information", precision: "page" },
  };
  dossier.evidenceNotes = [
    note,
    {
      ...note,
      id: "wrong-version-note",
      sourceVersion: "wrong-version",
      text: "Omitted stale fixture note.",
    },
  ];
  Object.assign(dossier, projectSecuritiesReport(dossier));
  dossier.reportProjection.evidenceNotes[0].rawPayload = "private-source-note-payload";
  const report = await context.invoke("readDossier", {
    ...BINDING,
    section: "report_evidence_notes",
    limit: 1,
  });
  assert.deepEqual(report.data, [note]);
  assert.equal(report.total, 1);
  assert.equal(report.nextOffset, null);
  assert.equal(JSON.stringify(report).includes("private-"), false);
  const expert = await context.invoke("readDossier", {
    ...BINDING,
    section: "evidence_notes",
    offset: 1,
    limit: 1,
  });
  assert.equal(expert.total, 2);
  assert.equal(expert.data[0].sourceVersion, "wrong-version");
  assert.equal(expert.data[0].text, "Omitted stale fixture note.");
  delete dossier.reportProjection;
  for (const section of ["report_evidence_notes", "report_issues", "verified_facts"]) {
    assert.equal(
      (await context.invoke("readDossier", { ...BINDING, section })).error.code,
      "report_unavailable",
    );
  }
});

test("filtered report and overview omit unsupported conclusions while expert evidence stays readable", async () => {
  const context = fixture();
  await context.open();
  const state = context.controller.getState();
  const analyzed = applyModelAnalysis(state.dossier, modelReportFixture(), { now: NOW });
  analyzed.metrics[0].current.verification = "needs_review";
  analyzed.analysis.claims[1].text =
    "Unsupported revenue conclusion retained only in the expert evidence.";
  analyzed.analysis.summary = analyzed.analysis.claims[1].text;
  Object.assign(analyzed, projectSecuritiesReport(analyzed));
  state.dossier = analyzed;
  const binding = { dossierId: BINDING.dossierId, revision: 2 };
  const report = await context.invoke("readDossier", { ...binding, section: "report" });
  assert.equal(report.status, "available");
  assert.deepEqual(
    report.data.claims.map((claim) => claim.id),
    ["comparable-basis"],
  );
  assert.deepEqual(report.data.report.summaryClaimIds, ["comparable-basis"]);
  assert.equal(
    report.data.report.sections.some((section) => section.claimIds.includes("revenue-change")),
    false,
  );
  assert.deepEqual(report.reportReadiness.omittedMetricIds, ["revenue"]);
  assert.deepEqual(report.reportReadiness.omittedClaimIds, ["revenue-change"]);
  assert.equal(report.data.summary.includes("Unsupported revenue conclusion"), false);
  const metrics = await context.invoke("readDossier", { ...binding, section: "report_metrics" });
  assert.deepEqual(metrics.data, []);
  const overview = await context.invoke("readDossier", { ...binding, section: "overview" });
  assert.equal(overview.dossier.analysis.summary.includes("Unsupported revenue conclusion"), false);
  const expert = await context.invoke("readDossier", { ...binding, section: "analysis" });
  assert.equal(expert.data.claims[1].text, analyzed.analysis.claims[1].text);
  assert.deepEqual(expert.reportReadiness.omittedClaimIds, ["revenue-change"]);
  const expertMetrics = await context.invoke("readDossier", { ...binding, section: "metrics" });
  assert.equal(expertMetrics.data[0].current.verification, "needs_review");
});

test("data-only reports explicitly identify the unavailable AI answer without requiring a paid rerun", async () => {
  const context = fixture();
  await context.open();
  const report = await context.invoke("readDossier", { ...BINDING, section: "report" });
  assert.equal(report.analysisAvailable, false);
  assert.equal(report.data.reportMode, "data_only");
  assert.match(report.data.summary, /AI answer.*unavailable/u);
  assert.equal(
    report.reportReadiness.reasons.some((reason) => reason.code === "ai_answer_unavailable"),
    true,
  );
  assert.equal(report.reportReadiness.canExport, true);
  assert.equal(context.jobs.size, 0);
  const metrics = await context.invoke("readDossier", { ...BINDING, section: "report_metrics" });
  assert.equal(metrics.data[0].current.value, 100);
});

test("page quality is paginated and source-bound without claiming all fetched text was verified", async () => {
  const context = fixture();
  await context.open();
  const source = context.controller.getState().dossier.sources[0];
  source.extraction = {
    qualityVersion: "fixture-quality-v1",
    fullOriginalFetched: true,
    fullTextVerified: false,
    materialCellsVerified: true,
    pageCount: 5,
    textPages: 0,
    ocrPages: 5,
    extractedPages: 5,
    pagesWithoutText: [],
    pagesWithoutUsableText: [3],
    pagesRequiringReview: [1, 2, 3, 4, 5],
    cellsDigest: "d".repeat(64),
    pageQuality: [
      {
        page: 3,
        method: "ocr",
        status: "unusable",
        ocrConfidence: 0,
        textCharacters: 10,
        qualityFlags: ["sideways_scan"],
        reviewedNumericCellsOnly: false,
      },
      {
        page: 4,
        method: "ocr",
        status: "extracted_unreviewed",
        ocrConfidence: 70,
        textCharacters: 400,
        qualityFlags: ["numeric_cells_verified_only"],
        reviewedNumericCellsOnly: true,
        sourceId: "wrong-source",
        sourceVersion: "wrong-version",
        privateImagePath: "private-page-image",
      },
    ],
  };
  const sources = await context.invoke("readDossier", { ...BINDING, section: "sources" });
  assert.equal(sources.data[0].extraction.fullOriginalFetched, true);
  assert.equal(sources.data[0].extraction.fullTextVerified, false);
  assert.deepEqual(sources.data[0].extraction.pagesWithoutUsableText, [3]);
  assert.equal(sources.data[0].extraction.pageQuality, undefined);
  const first = await context.invoke("readDossier", {
    ...BINDING,
    section: "source_quality",
    limit: 1,
  });
  assert.equal(first.total, 2);
  assert.equal(first.nextOffset, 1);
  assert.equal(first.data[0].status, "unusable");
  assert.equal(first.qualityCoverage[0].sourceSummaryStatus, "available");
  assert.equal(first.qualityCoverage[0].pageAssessmentStatus, "available");
  assert.equal(first.qualityCoverage[0].assessedPageCount, 2);
  assert.equal(first.qualityCoverage[0].totalPages, 5);
  const second = await context.invoke("readDossier", {
    ...BINDING,
    section: "source_quality",
    offset: first.nextOffset,
    limit: 1,
  });
  assert.equal(second.nextOffset, null);
  assert.equal(second.data[0].sourceId, source.id);
  assert.equal(second.data[0].sourceVersion, source.version);
  assert.equal(second.data[0].reviewedNumericCellsOnly, true);
  assert.equal(JSON.stringify(second).includes("private-page-image"), false);
});

test("missing page quality is unknown and current-version research can supply cached dossier assessments", async () => {
  const context = fixture();
  await context.open();
  const initial = context.controller.getState().dossier;
  initial.sources[0].pageCount = 5;
  const unknown = await context.invoke("readDossier", { ...BINDING, section: "source_quality" });
  assert.deepEqual(unknown.data, []);
  assert.deepEqual(unknown.qualityCoverage, [
    {
      sourceId: "fixture-source",
      sourceVersion: SOURCE_VERSION,
      sourceSummaryStatus: "unknown",
      pageAssessmentStatus: "unknown",
      assessedPageCount: 0,
      totalPages: 5,
      sourceQuality: null,
    },
  ]);
  const dossier = applyModelAnalysis(initial, modelReportFixture(), { now: NOW });
  dossier.analysis.research.steps.push({
    id: "stale-quality",
    sourceId: "fixture-source",
    sourceVersion: "wrong-version",
    sourceQuality: { qualityVersion: "stale-quality-v1", pageCount: 999 },
    pageQuality: [{ page: 1, method: "stale", status: "unusable", qualityFlags: [] }],
  });
  dossier.sources[0].excerpts = [
    {
      id: "fixture-read-passage",
      text: "Synthetic source text for the public reader projection.",
      sourceId: "fixture-source",
      sourceVersion: SOURCE_VERSION,
      originalHash: "a".repeat(64),
      extractionHash: "b".repeat(64),
      representationHash: "f".repeat(64),
      locator: { page: 4, precision: "page" },
      extractionMethod: "ocr",
      verification: "extracted_unreviewed",
      qualityFlags: ["ocr_unreviewed"],
      pageHeader: {
        text: "Internal fixture statement",
        locator: { page: 4, precision: "page" },
        privatePath: "private-page-header-path",
      },
    },
  ];
  Object.assign(dossier, projectSecuritiesReport(dossier));
  context.controller.getState().dossier = dossier;
  const binding = { dossierId: BINDING.dossierId, revision: 2 };
  const quality = await context.invoke("readDossier", {
    ...binding,
    section: "source_quality",
    limit: 1,
  });
  assert.equal(quality.total, 2);
  assert.equal(quality.nextOffset, 1);
  assert.equal(quality.data[0].page, 3);
  assert.equal(quality.qualityCoverage[0].sourceSummaryStatus, "available");
  assert.equal(quality.qualityCoverage[0].assessedPageCount, 2);
  assert.equal(quality.qualityCoverage[0].totalPages, 5);
  assert.equal(quality.qualityCoverage[0].sourceQuality.fullTextVerified, false);
  assert.equal(JSON.stringify(quality).includes("stale"), false);
  const sources = await context.invoke("readDossier", { ...binding, section: "sources" });
  assert.deepEqual(sources.data[0].excerpts[0].pageHeader, {
    text: "Internal fixture statement",
    locator: { page: 4, precision: "page" },
  });
  assert.equal(sources.data[0].excerpts[0].representationHash, "f".repeat(64));
  assert.equal(JSON.stringify(sources).includes("private-"), false);
  assert.equal(
    (await context.invoke("readDossier", { ...BINDING, section: "source_quality" })).error.code,
    "securities_revision_not_visible",
  );
});

test("derived evidence preserves currency, ratio and percentage-point units with every calculation input", async () => {
  const context = fixture();
  await context.open();
  const data = dataset();
  const template = data.metrics[0];
  data.metrics = [
    ["revenue", 100, 80],
    ["profit_before_tax", 20, 15],
    ["profit_after_tax", 16, 12],
    ["profit_parent", 18, 10],
    ["operating_cash_flow", 8, 9],
    ["financial_income", 30, 25],
    ["disposal_gain", 12, 2],
  ].map(([id, current, comparison]) => ({
    ...structuredClone(template),
    id,
    label: id,
    current: { ...template.current, value: current, rawText: String(current) },
    comparison: { ...template.comparison, value: comparison, rawText: String(comparison) },
  }));
  const dossier = createDossier(data, { id: BINDING.dossierId, now: NOW, locale: "en" });
  Object.assign(dossier, projectSecuritiesReport(dossier));
  context.controller.getState().dossier = dossier;
  for (const section of ["derived_metrics", "report_derived_metrics"]) {
    const expected =
      section === "derived_metrics"
        ? dossier.derivedMetrics
        : dossier.reportProjection.derivedMetrics;
    assert.equal(JSON.stringify(expected).length > SECURITIES_WEBMCP_MAX_OUTPUT_CHARS, true);
    let collected;
    for (const requested of [{}, { limit: 20 }]) {
      collected = [];
      let offset = 0;
      let pageCount = 0;
      do {
        const page = await context.invoke("readDossier", {
          ...BINDING,
          section,
          offset,
          ...requested,
        });
        assert.equal(page.status, "available");
        assert.equal(page.offset, offset);
        assert.equal(page.total, expected.length);
        assert.equal(page.data.length > 0 && page.data.length <= (requested.limit ?? 8), true);
        assert.equal(
          page.nextOffset,
          offset + page.data.length < expected.length ? offset + page.data.length : null,
        );
        assert.deepEqual(page.data, expected.slice(offset, offset + page.data.length));
        assert.deepEqual(page.truncatedFields, []);
        assert.equal(JSON.stringify(page).length <= SECURITIES_WEBMCP_MAX_OUTPUT_CHARS, true);
        collected.push(...page.data);
        pageCount += 1;
        offset = page.nextOffset;
      } while (offset !== null);
      assert.equal(pageCount > 1, true);
      assert.deepEqual(collected, expected);
      assert.equal(new Set(collected.map((metric) => metric.id)).size, expected.length);
    }
    const byId = new Map(collected.map((metric) => [metric.id, metric]));
    const inferred = byId.get("inferred_noncontrolling_profit");
    assert.equal(inferred.unit, "VND_million");
    assert.equal(inferred.current.unit, "VND_million");
    assert.equal(inferred.current.calculationKind, "difference");
    assert.equal(inferred.current.value, -2);
    assert.deepEqual(inferred.metricIds, ["profit_after_tax", "profit_parent"]);
    assert.equal(typeof inferred.definition.en, "string");
    const margin = byId.get("profit_before_tax_margin");
    assert.equal(margin.current.unit, "percent");
    assert.equal(margin.current.calculationKind, "ratio_percent");
    assert.equal(margin.percentagePointChange.unit, "percentage_point");
    assert.equal(
      margin.percentagePointChange.calculationKind,
      "ratio_difference_percentage_points",
    );
    assert.equal(margin.percentagePointChange.value, 1.25);
    assert.deepEqual(
      margin.percentagePointChange.inputRefs.map((ref) => [ref.metricId, ref.side, ref.value]),
      [
        ["profit_before_tax", "current", 20],
        ["revenue", "current", 100],
        ["profit_before_tax", "comparison", 15],
        ["revenue", "comparison", 80],
      ],
    );
    assert.equal(byId.get("operating_cash_flow_to_profit").current.value, 50);
    assert.equal(byId.get("disposal_gain_share_of_financial_income").current.value, 40);
    for (const [id, kind, value] of [
      ["profit_change_revenue_effect", "revenue_growth_effect", 3],
      ["profit_change_margin_effect", "margin_growth_effect", 1],
    ]) {
      const bridge = byId.get(id);
      assert.equal(bridge.unit, "VND_million");
      assert.equal(bridge.current.unit, "VND_million");
      assert.equal(bridge.current.calculationKind, kind);
      assert.equal(bridge.current.value, value);
      assert.equal(bridge.comparison.status, "not_applicable");
      assert.deepEqual(
        bridge.current.inputRefs.map((ref) => [ref.metricId, ref.side, ref.value]),
        [
          ["profit_after_tax", "current", 16],
          ["revenue", "current", 100],
          ["profit_after_tax", "comparison", 12],
          ["revenue", "comparison", 80],
        ],
      );
    }
  }
});

test("bank sector metadata and CIR retain their exact source calculations through WebMCP", async () => {
  const context = fixture();
  await context.open();
  const data = dataset();
  data.company.sectorId = "banking";
  data.company.sector = { en: "Banking", vi: "Ngân hàng" };
  const template = data.metrics[0];
  data.metrics = [
    ["operating_profit_before_provision", 120, 100],
    ["operating_expenses", -30, -20],
  ].map(([id, current, comparison]) => ({
    ...structuredClone(template),
    id,
    label: id,
    current: { ...template.current, value: current, rawText: String(current) },
    comparison: { ...template.comparison, value: comparison, rawText: String(comparison) },
  }));
  const dossier = createDossier(data, { id: BINDING.dossierId, now: NOW, locale: "en" });
  Object.assign(dossier, projectSecuritiesReport(dossier));
  Object.assign(context.controller.getState(), {
    dossier,
    dossiers: [dossier],
    scope: { company: data.company },
    catalog: { companies: [data.company] },
  });
  const state = await context.invoke("getState");
  for (const company of [
    state.dossier.company,
    state.dossiers[0].company,
    state.scope.company,
    state.catalog.companies[0],
  ])
    assert.equal(company.sectorId, "banking");
  assert.deepEqual(state.dossier.company.sector, data.company.sector);
  for (const section of ["derived_metrics", "report_derived_metrics"]) {
    const page = await context.invoke("readDossier", { ...BINDING, section });
    const expected =
      section === "derived_metrics"
        ? dossier.derivedMetrics
        : dossier.reportProjection.derivedMetrics;
    assert.deepEqual(page.data, expected);
    assert.deepEqual(page.truncatedFields, []);
    const ratio = page.data.find((metric) => metric.id === "bank_cost_to_income");
    assert.equal(ratio.current.calculationKind, "bank_cost_to_income_percent");
    assert.equal(ratio.current.unit, "percent");
    assert.equal(ratio.current.value, 20);
    assert.equal(ratio.comparison.value, 16.666667);
    assert.equal(ratio.percentagePointChange, undefined);
    assert.deepEqual(
      ratio.current.inputRefs.map((ref) => [
        ref.metricId,
        ref.side,
        ref.value,
        ref.sourceVersion,
        ref.locator.page,
      ]),
      [
        ["operating_profit_before_provision", "current", 120, SOURCE_VERSION, 4],
        ["operating_expenses", "current", -30, SOURCE_VERSION, 4],
      ],
    );
  }
});

test("supplemental facts retain exact values and receipts and open evidence only from validated report metrics", async () => {
  const context = fixture();
  await context.open();
  const fact = {
    id: "operating_cash_flow",
    factId: "fixture-cfo-current",
    side: "current",
    label: { en: "Fixture operating cash flow", vi: "Dòng tiền kiểm thử" },
    sourceId: "fixture-source",
    sourceVersion: SOURCE_VERSION,
    sourceHash: "a".repeat(64),
    value: "8000000",
    unit: "VND",
    rawText: "8,000,000",
    periodId: "FY2025",
    scope: "consolidated",
    entityId: "TEST",
    basisId: "fixture-basis",
    dataKind: "actual",
    verification: "verified",
    locator: { page: 4, rowCode: "20", precision: "cell" },
    verificationReceipt: {
      id: "fixture-ledger",
      sha256: "b".repeat(64),
      proofId: "fixture-proof",
      proofSha256: "c".repeat(64),
      renderSha256: "d".repeat(64),
      method: "independent_visual_original_render",
    },
    basisNote: "Internal synthetic fixture only.",
  };
  const report = modelReportFixture();
  report.research.verifiedFacts = [fact];
  const origin = {
    id: fact.sourceId,
    version: fact.sourceVersion,
    metricId: fact.id,
    side: fact.side,
    origin: "verified_supplemental_fact",
    correctionId: null,
    locator: fact.locator,
    sourceValue: 8_000_000,
    sourceUnit: "VND",
    displayUnit: "VND",
    sourceHash: fact.sourceHash,
    factId: fact.factId,
    verificationReceipt: structuredClone(fact.verificationReceipt),
  };
  const display = {
    type: "metric",
    metricId: fact.id,
    field: "current",
    value: 8_000_000,
    unit: "VND",
    format: "compact",
    rendered: "8 million VND",
  };
  const page = {
    sourceId: fact.sourceId,
    sourceVersion: fact.sourceVersion,
    sourceExcerptId: "fixture-basis",
    page: 4,
    locator: fact.locator,
  };
  const expectedFact = structuredClone(fact);
  const expectedOrigin = structuredClone(origin);
  report.claims.push({
    id: "cash-flow",
    kind: "source_fact",
    text: "Fixture operating cash flow is 8 million VND on page 4.",
    metricIds: [fact.id],
    sourceIds: [fact.sourceId],
    evidenceQuotes: [],
    numericOrigins: [origin],
    numericDisplays: [display],
    pageOrigins: [page],
    origin: "ai_synthesis",
    textOrigin: "model_narrative_with_verified_bindings",
    reviewStatus: "automatically_checked",
  });
  report.report.sections.push({ id: "cash_and_funding", claimIds: ["cash-flow"] });
  const dossier = applyModelAnalysis(context.controller.getState().dossier, report, { now: NOW });
  Object.assign(dossier, projectSecuritiesReport(dossier));
  // Simulate a source fact accepted by the backend projection. This fixture
  // exercises browser/controller projection, not authority to verify new facts.
  dossier.reportProjection.metrics.push({
    id: fact.id,
    unit: fact.unit,
    required: false,
    label: fact.label,
    current: { ...fact, value: Number(fact.value), originalUnit: fact.unit },
    comparison: null,
  });
  context.controller.getState().dossier = dossier;
  const binding = { dossierId: BINDING.dossierId, revision: 2 };
  assert.deepEqual(
    (await context.invoke("readDossier", { ...binding, section: "verified_facts" })).data,
    [],
  );
  dossier.reportProjection.verifiedFacts = [structuredClone(expectedFact)];
  dossier.analysis.research.verifiedFacts[0].verificationReceipt.privatePath = "private-fact-path";
  dossier.reportProjection.verifiedFacts[0].verificationReceipt.privatePath =
    "private-projected-fact-path";
  dossier.analysis.claims.at(-1).numericOrigins[0].verificationReceipt.privatePath =
    "private-origin-path";
  const facts = await context.invoke("readDossier", {
    ...binding,
    section: "verified_facts",
    limit: 1,
  });
  assert.equal(facts.data[0].value, "8000000");
  assert.equal(facts.data[0].rawText, "8,000,000");
  assert.deepEqual(facts.data[0].verificationReceipt, expectedFact.verificationReceipt);
  assert.equal((await context.invoke("getState")).dossier.verifiedFactCount, 1);
  const expert = await context.invoke("readDossier", {
    ...binding,
    section: "analysis",
    offset: 2,
    limit: 1,
  });
  assert.deepEqual(expert.data.claims[0].numericOrigins, [expectedOrigin]);
  assert.deepEqual(expert.data.claims[0].numericDisplays, [display]);
  assert.deepEqual(expert.data.claims[0].pageOrigins, [page]);
  assert.equal(JSON.stringify([facts, expert]).includes("private-"), false);
  const opened = await context.invoke("openEvidence", {
    ...binding,
    sourceId: fact.sourceId,
    sourceVersion: fact.sourceVersion,
    metricId: fact.id,
    period: "current",
  });
  assert.equal(opened.status, "opened");
  assert.equal(opened.point.value, 8_000_000);
  assert.equal(opened.point.factId, fact.factId);
  assert.equal(opened.point.sourceHash, fact.sourceHash);
  assert.deepEqual(opened.point.verificationReceipt, expectedFact.verificationReceipt);
  assert.equal(
    (
      await context.invoke("openEvidence", {
        ...binding,
        sourceId: fact.sourceId,
        sourceVersion: "wrong-version",
        metricId: fact.id,
        period: "current",
      })
    ).error.code,
    "source_mismatch",
  );
  dossier.analysis.claims.push({
    id: "unsupported-metric",
    metricIds: ["analysis_only"],
    sourceIds: [fact.sourceId],
  });
  assert.equal(
    (
      await context.invoke("openEvidence", {
        ...binding,
        sourceId: fact.sourceId,
        metricId: "analysis_only",
        period: "current",
      })
    ).error.code,
    "source_mismatch",
  );
});

test("current source-catalog shapes preserve accounting basis, source warnings and freshness limits", async () => {
  const context = fixture();
  await context.open();
  const scope = resolveSecuritiesScope({
    companyId: "FPT",
    periodId: "H1_2026",
    comparisonPeriodId: "H1_2025_reported",
  });
  const dossier = createDossier(loadFrozenSecuritiesDataset(scope), {
    id: BINDING.dossierId,
    now: NOW,
  });
  const actions = {
    ...context.actions,
    getState: () => ({
      ...context.controller.getState(),
      catalog: getSecuritiesCatalog(),
      scope,
      dossier,
    }),
  };
  const tools = createSecuritiesWebMcpTools(actions);
  const get = (key, input) =>
    tools.find((tool) => tool.name === SECURITIES_WEBMCP_TOOL_NAMES[key]).execute(input);
  const state = await get("getState", {});
  assert.equal(state.status, "available");
  assert.equal(state.catalog.defaultCompanyId, "FPT");
  assert.equal(
    state.catalog.companies.find((company) => company.id === "FPT").periods[0].comparisonOptions
      .length,
    2,
  );
  assert.equal(state.scope.freshness.latestMarketPeriodVerified, false);
  assert.equal(state.scope.warnings[0].code, "accounting_basis_changed");
  assert.equal(state.scope.comparisonPeriod.basisId, "ftel_full_consolidation");
  assert.equal(typeof state.scope.comparisonBasis.en, "string");
  assert.equal(state.scope.sources[0].rights.fullTextRedistribution, false);
  const metrics = await get("readDossier", { ...BINDING, section: "metrics", limit: 1 });
  assert.equal(metrics.data[0].current.basisId, "ftel_equity_method");
  assert.equal(metrics.data[0].comparison.basisId, "ftel_full_consolidation");
  assert.equal(metrics.data[0].comparison.locator.printedPage, "14");
});

test("a completed report and a full saved library keep workspace state bounded with recoverable task and validation detail", async () => {
  const context = fixture();
  await context.open();
  const analysis = modelReportFixture();
  analysis.validation.semantic.claims = analysis.validation.semantic.claims.map((claim) => ({
    ...claim,
    reason: "Synthetic support explanation retained in the detailed report. ".repeat(24),
  }));
  const dossier = applyModelAnalysis(context.controller.getState().dossier, analysis, { now: NOW });
  Object.assign(dossier, projectSecuritiesReport(dossier));
  const job = {
    id: "completed-fixture-job",
    ...BINDING,
    kind: "analysis",
    status: "completed",
    startedAt: NOW,
    completedAt: NOW,
    result: { dossierId: dossier.id, revision: dossier.revision },
    receipts: Array.from({ length: 4 }, (_, index) => ({
      ...modelResultFixture().receipt,
      requestId: `fixture-request-${index}`,
    })),
  };
  const scope = resolveSecuritiesScope({
    companyId: "FPT",
    periodId: "H1_2026",
    comparisonPeriodId: "H1_2025_reported",
  });
  const dossiers = Array.from({ length: 20 }, (_, index) => ({
    id: `saved-fixture-${index}`,
    revision: 2,
    status: "draft",
    updatedAt: NOW,
    company: {
      ...dataset().company,
      sector: { vi: "Dữ liệu kiểm thử. ".repeat(30), en: "Synthetic classification. ".repeat(30) },
    },
    period: dossier.period,
  }));
  const actions = {
    ...context.actions,
    getState: () => ({
      ...context.controller.getState(),
      dossier,
      dossiers,
      job,
      scope,
      catalog: getSecuritiesCatalog(),
    }),
    getAnalysisStatus: async () => job,
  };
  const tools = createSecuritiesWebMcpTools(actions);
  const invoke = (key, input = {}) =>
    tools.find((tool) => tool.name === SECURITIES_WEBMCP_TOOL_NAMES[key]).execute(input);
  const state = await invoke("getState");
  assert.equal(state.status, "available");
  assert.ok(JSON.stringify(state).length <= SECURITIES_WEBMCP_MAX_OUTPUT_CHARS);
  assert.equal(state.dossier.revision, 2);
  assert.equal(state.dossier.analysis.validation.semantic.status, "passed");
  assert.equal(state.dossier.analysis.validation.semantic.claims, undefined);
  assert.equal(state.dossier.reportReadiness.state, dossier.reportReadiness.state);
  assert.equal(state.scope.warnings[0].code, "accounting_basis_changed");
  assert.equal(state.dossierCount, 20);
  assert.equal(state.dossiers.length, 20);
  assert.equal(state.dossiers[0].company.sector, undefined);
  assert.equal(state.job.status, "completed");
  assert.equal(state.job.resultRevision, 2);
  assert.equal(state.job.receiptCount, 4);
  assert.equal(state.job.receipts, undefined);
  assert.equal(state.job.detailsTool, SECURITIES_WEBMCP_TOOL_NAMES.getTaskStatus);
  const details = await invoke("getTaskStatus", { ...BINDING, jobId: job.id });
  assert.equal(details.status, "available");
  assert.deepEqual(details.task.receipts, job.receipts);
  const report = await invoke("readDossier", {
    dossierId: dossier.id,
    revision: 2,
    section: "report",
    limit: 1,
  });
  assert.deepEqual(report.data.validation.semantic.claims, analysis.validation.semantic.claims);
});

test("reasoned corrections cannot fabricate source verification or approval intent", async () => {
  const context = fixture();
  await context.open();
  const change = {
    metricId: "revenue",
    periodId: "FY2025",
    value: 110,
    reason: "Recheck this value against the cited fixture page.",
  };
  await assert.rejects(
    context.invoke("stageCorrections", {
      ...BINDING,
      changes: [{ ...change, sourceChecked: true }],
    }),
    TypeError,
  );
  await assert.rejects(
    context.invoke("requestApproval", { ...BINDING, intent: "approve_exact_revision" }),
    TypeError,
  );
  assert.deepEqual(await context.invoke("stageCorrections", { ...BINDING, changes: [change] }), {
    status: "revised",
    dossierId: BINDING.dossierId,
    revision: 2,
    verificationStatus: "needs_review",
  });
  const dossier = context.controller.getState().dossier;
  assert.equal(dossier.metrics[0].current.value, 110);
  assert.equal(dossier.metrics[0].current.originalValue, 100);
  assert.equal(dossier.metrics[0].current.verification, "needs_review");
  assert.equal(
    (await context.invoke("requestApproval", { ...BINDING, revision: 2 })).error.code,
    "approval_blocked",
  );
  assert.equal(
    context.calls.some((call) => call.path.endsWith("/approve")),
    false,
  );
});

test("nested correction arrays reject accessors, sparse entries, nonfinite values and unreasoned changes", async () => {
  const context = fixture();
  await context.open();
  const change = {
    metricId: "revenue",
    periodId: "FY2025",
    value: 110,
    reason: "Review the original fixture page.",
  };
  const before = context.calls.length;
  let getterRead = false;
  const getter = Object.defineProperty({ ...change }, "value", {
    enumerable: true,
    get() {
      getterRead = true;
      return 110;
    },
  });
  const arrays = [
    [getter],
    new Array(1),
    [{ ...change, value: NaN }],
    [{ ...change, value: Infinity }],
    [{ ...change, value: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...change, reason: "short" }],
    [],
  ];
  for (const changes of arrays)
    await assert.rejects(context.invoke("stageCorrections", { ...BINDING, changes }), TypeError);
  assert.equal(getterRead, false);
  assert.equal(context.calls.length, before);
});

test("limited draft export works without approval while optional approval retains its exact-revision dialog", async () => {
  const context = fixture();
  await context.open();
  const draft = await context.invoke("exportRevision", { ...BINDING, format: "xlsx" });
  assert.equal(draft.status, "artifact_ready");
  assert.equal(context.controller.getState().dossier.status, "draft");
  assert.equal(context.controller.getState().dossier.reportReadiness.state, "limited");
  assert.equal(
    context.calls.some((call) => call.path.endsWith("/approve")),
    false,
  );
  assert.equal((await context.invoke("requestApproval", BINDING)).status, "confirmation_required");
  assert.deepEqual(context.controller.getState().approvalRequest, BINDING);
  assert.equal(
    context.calls.some((call) => call.path.endsWith("/approve")),
    false,
  );
  await context.controller.approveRevision({ ...BINDING, intent: "approve_exact_revision" });
  const state = await context.invoke("getState");
  assert.equal(state.dossier.status, "approved");
  assert.equal(state.dossier.approval.revision, 1);
  const output = await context.invoke("exportRevision", { ...BINDING, format: "xlsx" });
  assert.equal(output.status, "artifact_ready");
  assert.equal(output.artifactStatus, "generated");
  assert.equal(output.revision, 1);
  assert.equal(output.bytes > 0, true);
  assert.equal(output.filename, "fixture-v1.xlsx");
  assert.equal((await context.invoke("requestApproval", BINDING)).status, "already_approved");
});

test("export refuses unavailable content and stale revisions before requesting artifact bytes", async () => {
  const context = fixture();
  await context.open();
  await context.invoke("stageCorrections", {
    ...BINDING,
    changes: [
      {
        metricId: "revenue",
        periodId: "FY2025",
        value: 110,
        reason: "This changed fixture cell has not been source-verified.",
      },
    ],
  });
  const binding = { dossierId: BINDING.dossierId, revision: 2 };
  assert.equal(context.controller.getState().dossier.reportReadiness.state, "unavailable");
  assert.equal(
    (await context.invoke("exportRevision", { ...binding, format: "xlsx" })).error.code,
    "report_unavailable",
  );
  assert.equal(
    (await context.invoke("exportRevision", { ...BINDING, format: "xlsx" })).error.code,
    "securities_revision_not_visible",
  );
  assert.equal(
    context.calls.some((call) => call.path === "download"),
    false,
  );
});

test("export preserves a browser download request and rejects incomplete or mismatched artifact claims", async () => {
  const exported = {
    status: "download_requested",
    artifactReady: true,
    ...BINDING,
    format: "xlsx",
    filename: "fixture-v1.xlsx",
    bytes: 32,
  };
  const context = fixture({ overrides: { exportRevision: async () => exported } });
  await context.open();
  const result = await context.invoke("exportRevision", { ...BINDING, format: "xlsx" });
  assert.deepEqual(result, {
    status: "download_requested",
    artifactStatus: "generated",
    ...BINDING,
    format: "xlsx",
    filename: "fixture-v1.xlsx",
    bytes: 32,
  });

  for (const invalid of [
    { ...exported, status: "exported" },
    { ...exported, artifactReady: false },
    { ...exported, revision: 2 },
    { ...exported, format: "md" },
    { ...exported, filename: "" },
    { ...exported, bytes: 0 },
  ]) {
    const tools = createSecuritiesWebMcpTools({
      ...context.actions,
      exportRevision: async () => invalid,
    });
    const output = await tools
      .find((tool) => tool.name === SECURITIES_WEBMCP_TOOL_NAMES.exportRevision)
      .execute({ ...BINDING, format: "xlsx" });
    assert.deepEqual(output, { status: "error", error: { code: "securities_result_invalid" } });
  }
});

test("a serialized stale mutation cannot apply to a revision produced by an earlier call", async () => {
  const context = fixture();
  await context.open();
  const change = {
    metricId: "revenue",
    periodId: "FY2025",
    value: 110,
    reason: "Recheck the cited fixture page before source confirmation.",
  };
  const correction = context.invoke("stageCorrections", { ...BINDING, changes: [change] });
  const approval = context.invoke("requestApproval", BINDING);
  assert.equal((await correction).revision, 2);
  assert.equal((await approval).error.code, "securities_revision_not_visible");
  assert.equal(context.controller.getState().approvalRequest, null);
});

test("source panel verifies source, version, metric and selected period before opening", async () => {
  const context = fixture();
  await context.open();
  assert.equal(
    (
      await context.invoke("openEvidence", {
        ...BINDING,
        sourceId: "fixture-source",
        sourceVersion: "other",
      })
    ).error.code,
    "source_mismatch",
  );
  assert.equal(context.controller.getState().selectedSource, null);
  const result = await context.invoke("openEvidence", {
    ...BINDING,
    sourceId: "fixture-source",
    sourceVersion: SOURCE_VERSION,
    metricId: "revenue",
    period: "comparison",
  });
  assert.equal(result.status, "opened");
  assert.equal(result.source.version, SOURCE_VERSION);
  assert.equal(result.point.value, 80);
  assert.equal(context.controller.getState().selectedSource.period, "comparison");
});

test("tasks report started, persisted completion, mismatched jobs and cancellation distinctly", async (t) => {
  const context = fixture();
  t.after(context.cleanup);
  await context.open();
  const started = await context.invoke("startAnalysis", BINDING);
  assert.equal(started.status, "started");
  assert.equal(started.taskStatus, "running");
  const input = { ...BINDING, jobId: started.jobId };
  context.jobs.get(started.jobId).status = "completed";
  context.jobs.get(started.jobId).result = { dossier: { id: BINDING.dossierId, revision: 2 } };
  const status = await context.invoke("getTaskStatus", input);
  assert.equal(status.task.status, "completed");
  assert.equal(status.visibleTask.status, "running");
  assert.equal(status.resultRevision, 2);
  assert.equal(
    (await context.invoke("getTaskStatus", { ...input, revision: 2 })).error.code,
    "job_context_mismatch",
  );
  context.jobs.get(started.jobId).status = "running";
  const cancelled = await context.invoke("cancelTask", input);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(context.controller.getState().job.status, "cancelled");
});

test("task reads retain real stage, read count and selected pages without inventing progress percentages", async (t) => {
  const context = fixture();
  t.after(context.cleanup);
  await context.open();
  const started = await context.invoke("startAnalysis", BINDING);
  const input = { ...BINDING, jobId: started.jobId };
  const visibleProgress = {
    stage: "reading_sources",
    readCount: 1,
    sourceId: "fixture-source",
    pages: [4],
    at: NOW,
  };
  context.controller.getState().job.progress = {
    ...visibleProgress,
    internalPrompt: "private-stage-prompt",
    percent: 50,
  };
  assert.deepEqual((await context.invoke("getState")).job.progress, visibleProgress);
  for (const progress of [
    { stage: "reading_sources", readCount: 2, sourceId: "fixture-source", pages: [3], at: NOW },
    { stage: "writing_report", at: NOW },
    { stage: "checking_report", at: NOW },
  ]) {
    context.jobs.get(started.jobId).progress = {
      ...progress,
      internalPrompt: "private-persisted-stage-prompt",
      percent: 90,
    };
    const result = await context.invoke("getTaskStatus", input);
    assert.deepEqual(result.task.progress, progress);
    assert.deepEqual(result.visibleTask.progress, visibleProgress);
    assert.equal(JSON.stringify(result).includes("private-"), false);
  }
});

test("cancellation can run while another WebMCP mutation awaits UI commit", async (t) => {
  const context = fixture();
  t.after(context.cleanup);
  await context.open();
  const first = await context.invoke("startAnalysis", BINDING);
  const stalled = deferred();
  let startedWait = false;
  const tools = createSecuritiesWebMcpTools({
    ...context.controller,
    awaitVisible: async () => {
      if (!startedWait) {
        startedWait = true;
        await stalled.promise;
      }
    },
  });
  const run = (key, input) =>
    tools.find((tool) => tool.name === SECURITIES_WEBMCP_TOOL_NAMES[key]).execute(input);
  const pending = run("requestApproval", BINDING);
  await new Promise((resolve) => setImmediate(resolve));
  const cancel = await run("cancelTask", { ...BINDING, jobId: first.jobId });
  assert.equal(cancel.status, "cancelled");
  stalled.resolve();
  await pending;
});

test("execution abort reaches the shared action and stale success is not reported", async () => {
  const reached = deferred();
  const hold = deferred();
  let actionSignal;
  const context = fixture({
    overrides: {
      openDossier: async (_input, { signal }) => {
        actionSignal = signal;
        reached.resolve();
        return hold.promise;
      },
    },
  });
  const execution = new AbortController();
  const pending = context.invoke("openDossier", BINDING, { signal: execution.signal });
  await reached.promise;
  execution.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(actionSignal.aborted, true);
  hold.resolve({ status: "opened", ...BINDING });
});

test("output is bounded, explicitly excerpted and excludes provider secrets and internal prompts", async () => {
  const context = fixture();
  await context.open();
  const state = context.controller.getState();
  state.dossier.analysis.summary = "Untrusted source instruction. ".repeat(200);
  state.dossier.analysis.rawProviderResponse = { apiKey: "private-value" };
  state.dossier.analysis.systemPrompt = "internal instruction";
  state.secret = "must-never-leave";
  const result = await context.invoke("readDossier", { ...BINDING, section: "analysis", limit: 1 });
  assert.deepEqual(result.truncatedFields, ["data.summary"]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.length <= SECURITIES_WEBMCP_MAX_OUTPUT_CHARS, true);
  assert.equal(/private-value|internal instruction|must-never-leave/u.test(serialized), false);
  assert.equal(result.data.origin, "rules");
  const read = await context.invoke("getState");
  assert.equal(JSON.stringify(read).includes("must-never-leave"), false);
});

test("receipt projection retains fixture identity, exact model routing and unknown cost", async () => {
  const context = fixture();
  await context.open();
  const receipt = {
    evidenceType: "fixture",
    transportAttemptId: "b628100c-bb4d-43d1-9057-bdf0867d6bd5",
    operation: "analysis",
    attempt: 1,
    requestedModel: "meta/muse-spark-1.3-contributor",
    actualModel: "meta/muse-spark-1.3-contributor",
    provider: "fixture-provider",
    outcome: "completed",
    inputTokens: 200,
    outputTokens: 100,
    costUsd: null,
    costStatus: "unknown",
    validation: { status: "passed" },
    serverTools: [{ mode: "fixture", tools: ["openrouter:web_fetch"] }],
    rawResponse: "private-response",
  };
  context.controller.getState().dossier.analysis.receipt = receipt;
  const result = await context.invoke("readDossier", { ...BINDING, section: "analysis" });
  assert.equal(result.data.receipt.evidenceType, "fixture");
  assert.equal(result.data.receipt.transportAttemptId, receipt.transportAttemptId);
  assert.equal(result.data.receipt.actualModel, receipt.actualModel);
  assert.equal(result.data.receipt.provider, "fixture-provider");
  assert.equal(result.data.receipt.costUsd, null);
  assert.equal(result.data.receipt.costStatus, "unknown");
  assert.deepEqual(result.data.receipt.validation, { status: "passed" });
  assert.deepEqual(result.data.receipt.serverTools, receipt.serverTools);
  assert.equal(JSON.stringify(result).includes("private-response"), false);
});

test("malformed or provider-bearing errors expose only an allowlisted recovery code", async () => {
  for (const code of ["provider_credit_exhausted", "provider_timeout", "provider_secret_echo"]) {
    const context = fixture({
      overrides: {
        openDossier: async () => {
          throw Object.assign(new Error("PRIVATE_API_KEY"), { code });
        },
      },
    });
    assert.deepEqual(await context.open(), { status: "error", error: { code } });
  }
  const context = fixture({
    overrides: {
      openDossier: async () => {
        throw new Error("PRIVATE_API_KEY");
      },
    },
  });
  assert.deepEqual(await context.open(), { status: "error", error: { code: "request_failed" } });
});

test("registration is progressive enhancement, deduplicates consumers and unregisters on final cleanup", async () => {
  const context = fixture();
  const registered = [];
  const documentObject = {
    modelContext: {
      registerTool(tool, options) {
        registered.push({ tool, ...options });
      },
    },
  };
  const first = registerSecuritiesWebMcp(context.actions, { documentObject });
  const second = registerSecuritiesWebMcp(context.actions, { documentObject });
  assert.equal(await first.ready, true);
  assert.equal(await second.ready, true);
  assert.equal(registered.length, 15);
  first.cleanup();
  assert.equal(
    registered.some((entry) => entry.signal.aborted),
    false,
  );
  second.cleanup();
  assert.equal(
    registered.every((entry) => entry.signal.aborted),
    true,
  );
  await assert.rejects(registered[0].tool.execute({}), { name: "AbortError" });
  const unsupported = registerSecuritiesWebMcp(context.actions, { documentObject: {} });
  assert.equal(unsupported.supported, false);
  assert.equal(await unsupported.ready, false);
});

test("partial registration failure aborts every registered tool and leaves UI actions available", async () => {
  const context = fixture();
  const signals = [];
  const errors = [];
  const registration = registerSecuritiesWebMcp(context.actions, {
    documentObject: {
      modelContext: {
        registerTool(_tool, { signal }) {
          signals.push(signal);
          if (signals.length === 3)
            return Promise.reject(new Error("fixture registration refused"));
        },
      },
    },
    onRegistrationError: (error) => errors.push(error),
  });
  assert.equal(await registration.ready, false);
  assert.equal(
    signals.every((signal) => signal.aborted),
    true,
  );
  assert.equal(errors.length, 1);
  assert.equal((await context.controller.openDossier(BINDING)).status, "opened");
});
