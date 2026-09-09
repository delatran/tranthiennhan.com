import assert from "node:assert/strict";
import test from "node:test";
import { createSecuritiesController, researchInput } from "../../src/securities/controller.js";
import { dossierMetrics, metricValue, reportFigure } from "../../src/securities/format.js";
import { SecuritiesApiError } from "../../src/securities/api.js";
import { createRequestLedger } from "../../src/securities/request-ledger.js";

const scope = {
  companyId: "FPT",
  periodId: "H1_2026",
  comparisonPeriodId: "H1_2025_restated",
  query: "",
  company: { id: "FPT", ticker: "FPT" },
  period: { id: "H1_2026" },
  comparisonPeriod: { id: "H1_2025_restated" },
  sources: [],
  ready: true,
};
const dossier = {
  id: "ds_controller_test",
  revision: 1,
  status: "draft",
  company: scope.company,
  period: scope.period,
  comparisonPeriod: scope.comparisonPeriod,
  metrics: [
    {
      id: "revenue",
      current: { sourceId: "source", sourceVersion: "v2", value: 12 },
      comparison: { sourceId: "source", sourceVersion: "v1", value: 10 },
    },
  ],
  sources: [
    { id: "source", version: "v1" },
    { id: "source", version: "v2" },
  ],
  issues: [],
  chat: [],
};

function createClient(handler = () => undefined) {
  const requests = [];
  const client = {
    requests,
    async request(path, options = {}) {
      requests.push({ path, ...options });
      const value = await handler(path, options, requests);
      if (value !== undefined) return value;
      if (path === "/catalog")
        return {
          companies: [{ ...scope.company, periods: [scope.period] }],
          runtime: { model: { enabled: true, configured: true } },
        };
      if (path === "/scope") return structuredClone(scope);
      if (path === "/dossiers" && options.method !== "POST") return { dossiers: [] };
      if (path === "/dossiers" || path === `/dossiers/${dossier.id}`)
        return { dossier: structuredClone(dossier) };
      throw new Error(`Unhandled test path: ${path}`);
    },
  };
  return client;
}

function makeController(client) {
  return createSecuritiesController({
    client,
    locale: "vi",
    ledger: createRequestLedger({ storage: null }),
  });
}

test("initialization loads only dossiers and normalizes retired company-comparison links", async () => {
  const previousWindow = globalThis.window;
  try {
    for (const query of ["comparison=cp_retired&revision=2", "preparation=prep_retired"]) {
      let location = new URL(`https://example.com/securities?lang=vi&${query}#research`);
      globalThis.window = {
        get location() {
          return location;
        },
        history: {
          replaceState(_state, _title, path) {
            location = new URL(path, location);
          },
        },
      };
      const client = createClient();
      const controller = makeController(client);
      await controller.initialize();
      assert.deepEqual(
        client.requests.map((request) => request.path),
        ["/catalog", "/dossiers"],
      );
      assert.equal(controller.getState().view, "start");
      assert.equal(controller.getState().error, null);
      assert.equal(location.href, "https://example.com/securities?lang=vi#research");
      assert.equal(
        Object.keys(controller).some((name) => /comparison/i.test(name)),
        false,
      );
      assert.equal(
        Object.keys(controller.getState()).some((name) => /comparison/i.test(name)),
        false,
      );
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("an explicitly selected scope creates a dossier without an invalid empty query field", async () => {
  const client = createClient();
  const controller = makeController(client);
  await controller.configureScope({
    companyId: "FPT",
    periodId: "H1_2026",
    comparisonPeriodId: "H1_2025_restated",
  });
  const result = await controller.createDossier();
  const request = client.requests.find(
    (entry) => entry.path === "/dossiers" && entry.method === "POST",
  );
  assert.equal(Object.hasOwn(request.body, "query"), false);
  assert.equal(request.body.comparisonPeriodId, "H1_2025_restated");
  assert.equal(result.status, "created");
  assert.equal(controller.getState().dossier.id, dossier.id);
  assert.equal(controller.getState().scope, null);
});

test("deleting shared research uses DELETE, clears an open dossier and refreshes the library", async () => {
  const saved = {
    id: dossier.id,
    revision: dossier.revision,
    company: dossier.company,
    period: dossier.period,
    updatedAt: "2026-09-07T08:00:00.000Z",
  };
  let library = [saved];
  const client = createClient((path, options) => {
    if (path === "/dossiers" && options.method !== "POST") return { dossiers: library };
    if (path === `/dossiers/${dossier.id}` && options.method === "DELETE") {
      assert.equal(options.body.expectedRevision, 1);
      assert.match(options.body.requestId, /^[a-f0-9-]{36}$/u);
      library = [];
      return { deleted: true, dossierId: dossier.id, revision: 1 };
    }
  });
  const controller = makeController(client);
  await controller.initialize();
  await controller.openDossier({ dossierId: dossier.id });
  const result = await controller.deleteDossier({ dossierId: dossier.id, revision: 1 });
  assert.deepEqual(result, { status: "deleted", dossierId: dossier.id, revision: 1 });
  assert.equal(
    client.requests.some(
      (request) => request.path === `/dossiers/${dossier.id}` && request.method === "DELETE",
    ),
    true,
  );
  assert.equal(controller.getState().view, "start");
  assert.equal(controller.getState().dossier, null);
  assert.deepEqual(controller.getState().dossiers, []);
  assert.equal(controller.getState().notice, "researchDeleted");
});

test("a natural-language request survives scope confirmation without being substituted", async () => {
  const client = createClient();
  const controller = makeController(client);
  const query = "FPT kỳ mới nhất trong nguồn hiện có thay đổi thế nào?";
  await controller.configureScope({ query });
  assert.equal(controller.getState().scope.query, query);
  await controller.createDossier();
  assert.equal(
    client.requests.find((entry) => entry.path === "/dossiers" && entry.method === "POST").body
      .query,
    query,
  );
});

test("evidence selects the exact metric source version and rejects a mismatching explicit version", async () => {
  const controller = makeController(createClient());
  await controller.openDossier({ dossierId: dossier.id });
  const result = controller.getEvidence({
    dossierId: dossier.id,
    revision: 1,
    sourceId: "source",
    metricId: "revenue",
    period: "current",
  });
  assert.equal(result.source.version, "v2");
  assert.throws(
    () =>
      controller.getEvidence({
        dossierId: dossier.id,
        revision: 1,
        sourceId: "source",
        sourceVersion: "v1",
        metricId: "revenue",
        period: "current",
      }),
    { code: "evidence_mismatch" },
  );
  assert.throws(
    () => controller.getEvidence({ dossierId: dossier.id, revision: 1, sourceId: "source" }),
    { code: "source_version_required" },
  );
});

test("approval requires a visible exact-revision request and does not accept stale context", async () => {
  const controller = makeController(createClient());
  await controller.openDossier({ dossierId: dossier.id });
  await assert.rejects(
    controller.approveRevision({
      dossierId: dossier.id,
      revision: 1,
      intent: "approve_exact_revision",
    }),
    { code: "confirmation_required" },
  );
  assert.throws(() => controller.requestApproval({ dossierId: dossier.id, revision: 2 }), {
    code: "context_mismatch",
  });
  const result = controller.requestApproval({ dossierId: dossier.id, revision: 1 });
  assert.equal(result.status, "confirmation_required");
  assert.deepEqual(controller.getState().approvalRequest, { dossierId: dossier.id, revision: 1 });
});

test("visible-state acknowledgement waits for the current React commit", async () => {
  const controller = makeController(createClient());
  controller.markRendered(controller.getState().renderVersion);
  controller.setLocale("en");
  let acknowledged = false;
  const visible = controller.awaitVisible().then(() => {
    acknowledged = true;
  });
  await Promise.resolve();
  assert.equal(acknowledged, false);
  controller.markRendered(controller.getState().renderVersion);
  await visible;
  assert.equal(acknowledged, true);
});

test("terminal failed analysis retry starts a new provider job while a status retry keeps the same job", async () => {
  let count = 0;
  let finished;
  const terminal = new Promise((resolve) => {
    finished = resolve;
  });
  const client = createClient((path) => {
    if (path.endsWith("/analyze"))
      return { job: { id: `job_retry_${++count}`, status: "running", kind: "analysis" } };
    if (path === "/jobs/job_retry_1") {
      finished();
      return {
        job: {
          id: "job_retry_1",
          status: "failed",
          kind: "analysis",
          dossierId: dossier.id,
          revision: 1,
          error: { code: "provider_rate_limited" },
        },
      };
    }
    if (path.endsWith("/cancel")) return { job: { id: "job_retry_2", status: "cancelled" } };
  });
  const controller = makeController(client);
  await controller.openDossier({ dossierId: dossier.id });
  await controller.startAnalysis({ dossierId: dossier.id, revision: 1 });
  const polling = await controller.retryJob();
  assert.equal(polling.status, "polling");
  assert.equal(count, 1);
  await terminal;
  // Allow the awaited API result to commit before retrying.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getState().job.status, "failed");
  const retry = await controller.retryJob();
  assert.equal(retry.status, "started");
  assert.equal(retry.jobId, "job_retry_2");
  assert.equal(count, 2);
  assert.throws(() => controller.newResearch(), { code: "job_in_progress" });
  await controller.cancelAnalysis();
});

test("uncertain mutation retries reuse an opaque persisted idempotency key without storing the request text", async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const first = createRequestLedger({ storage });
  const requests = [];
  const client = {
    async request(path, options) {
      requests.push({ path, ...options });
      if (requests.length === 1) throw new SecuritiesApiError("connection_failed");
      return { dossier: structuredClone(dossier) };
    },
  };
  const body = { companyId: "FPT", periodId: "H1_2026", query: "A private user research question" };
  await assert.rejects(first.execute(client, "/dossiers", body));
  assert.equal([...values.values()].join("").includes(body.query), false);
  assert.equal([...values.values()].join("").includes("FPT"), false);
  const restored = createRequestLedger({ storage });
  await restored.execute(client, "/dossiers", body);
  assert.equal(requests[0].body.requestId, requests[1].body.requestId);
  await restored.execute(client, "/dossiers", body);
  assert.notEqual(requests[1].body.requestId, requests[2].body.requestId);
});

test("DELETE retries keep their request id separate from POST mutations on the same path", async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const requests = [];
  const client = {
    async request(path, options) {
      requests.push({ path, ...options });
      if (requests.length === 1) throw new SecuritiesApiError("connection_failed");
      return { deleted: true };
    },
  };
  const path = `/dossiers/${dossier.id}`;
  const body = { expectedRevision: 1 };
  await assert.rejects(
    createRequestLedger({ storage }).execute(client, path, body, { method: "DELETE" }),
  );
  await createRequestLedger({ storage }).execute(client, path, body, { method: "POST" });
  await createRequestLedger({ storage }).execute(client, path, body, { method: "DELETE" });
  assert.notEqual(requests[0].body.requestId, requests[1].body.requestId);
  assert.equal(requests[0].body.requestId, requests[2].body.requestId);
  assert.equal(requests[2].method, "DELETE");
});

test("a chat resumed while loading a dossier restores the complete persisted transcript", async () => {
  const job = {
    id: "job_resumed_chat",
    kind: "chat",
    status: "running",
    dossierId: dossier.id,
    revision: 1,
  };
  const chat = [
    { role: "user", content: "What needs checking?", revision: 1 },
    {
      role: "assistant",
      answer: { origin: "model", claims: [{ text: "Read the source note.", kind: "hypothesis" }] },
      revision: 1,
    },
  ];
  let readTranscript;
  const transcript = new Promise((resolve) => {
    readTranscript = resolve;
  });
  const client = createClient((path) => {
    if (path === `/dossiers/${dossier.id}`)
      return { dossier: { ...structuredClone(dossier), activeJob: job } };
    if (path === `/jobs/${job.id}`)
      return { job: { ...job, status: "completed", result: { answer: chat[1].answer } } };
    if (path === `/dossiers/${dossier.id}?revision=1`) {
      readTranscript();
      return {
        dossier: { ...structuredClone(dossier), chat, chatHistoryTruncated: true, activeJob: null },
      };
    }
  });
  const controller = makeController(client);
  await controller.openDossier({ dossierId: dossier.id });
  controller.setTab("analysis");
  await transcript;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(controller.getState().chat, chat);
  assert.equal(controller.getState().dossier.chatHistoryTruncated, true);
  assert.equal(controller.getState().activeTab, "analysis");
  assert.equal(controller.getState().job.status, "completed");
  assert.equal(
    client.requests.some((request) => request.method === "POST"),
    false,
  );
});

test("chat completion replaces the optimistic question with the persisted conversation without duplication", async () => {
  const job = {
    id: "job_local_chat",
    kind: "chat",
    status: "running",
    dossierId: dossier.id,
    revision: 1,
  };
  const question = "Explain the comparison basis.";
  const chat = [
    { role: "user", content: question, revision: 1 },
    { role: "assistant", content: "Use the restated comparison.", revision: 1 },
  ];
  let readTranscript;
  const transcript = new Promise((resolve) => {
    readTranscript = resolve;
  });
  const client = createClient((path) => {
    if (path === `/dossiers/${dossier.id}/chat`) return { job };
    if (path === `/jobs/${job.id}`)
      return { job: { ...job, status: "completed", result: { answer: chat[1].content } } };
    if (path === `/dossiers/${dossier.id}?revision=1`) {
      readTranscript();
      return { dossier: { ...structuredClone(dossier), chat } };
    }
  });
  const controller = makeController(client);
  await controller.openDossier({ dossierId: dossier.id });
  await controller.askFollowup({ dossierId: dossier.id, revision: 1, question });
  assert.equal(controller.getState().chat.length, 1);
  await transcript;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(controller.getState().chat, chat);
  assert.equal(
    client.requests.filter((request) => request.path.endsWith("/chat") && request.method === "POST")
      .length,
    1,
  );
});

test("a failed transcript read retries the completed job without submitting another model call", async () => {
  const job = {
    id: "job_chat_sync_retry",
    kind: "chat",
    status: "running",
    dossierId: dossier.id,
    revision: 1,
  };
  const chat = [
    { role: "user", content: "A preserved question", revision: 1 },
    { role: "assistant", content: "A preserved answer", revision: 1 },
  ];
  let readCount = 0;
  let firstRead;
  let secondRead;
  const failedRead = new Promise((resolve) => {
    firstRead = resolve;
  });
  const successfulRead = new Promise((resolve) => {
    secondRead = resolve;
  });
  const client = createClient((path) => {
    if (path === `/dossiers/${dossier.id}`)
      return { dossier: { ...structuredClone(dossier), activeJob: job } };
    if (path === `/jobs/${job.id}`)
      return { job: { ...job, status: "completed", result: { answer: chat[1].content } } };
    if (path === `/dossiers/${dossier.id}?revision=1`) {
      if (++readCount === 1) {
        firstRead();
        throw new SecuritiesApiError("connection_failed");
      }
      secondRead();
      return { dossier: { ...structuredClone(dossier), chat, activeJob: null } };
    }
  });
  const controller = makeController(client);
  await controller.openDossier({ dossierId: dossier.id });
  await failedRead;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getState().error.code, "connection_failed");
  assert.equal(controller.getState().error.retry, "job");
  assert.equal(controller.getState().job.status, "running");
  assert.equal(controller.getState().chat.length, 0);
  assert.throws(() => controller.newResearch(), { code: "job_in_progress" });
  assert.deepEqual(await controller.retryJob(), { status: "polling", jobId: job.id });
  await successfulRead;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(controller.getState().chat, chat);
  assert.equal(controller.getState().job.status, "completed");
  assert.equal(controller.getState().error, null);
  assert.equal(
    client.requests.some((request) => request.method === "POST"),
    false,
  );
});

test("question scope hints remain separate from user-edited explicit selections", () => {
  const defaults = {
    companyId: "FPT",
    periodId: "H1_2026",
    comparisonPeriodId: "H1_2025_restated",
  };
  assert.deepEqual(researchInput("GMD H1 2026 earnings quality?", defaults, {}), {
    query: "GMD H1 2026 earnings quality?",
    defaultScope: defaults,
  });
  assert.deepEqual(researchInput("FPT annual 2025?", defaults, {}), {
    query: "FPT annual 2025?",
    defaultScope: defaults,
  });
  assert.deepEqual(researchInput("GMD H1 2026?", defaults, { companyId: "FPT", periodId: "" }), {
    companyId: "FPT",
    query: "GMD H1 2026?",
    defaultScope: defaults,
  });
  assert.deepEqual(researchInput("  ", defaults), defaults);
});

test("one research action resolves the question, creates the exact scope and starts analysis", async () => {
  const resolved = {
    ...structuredClone(scope),
    companyId: "GMD",
    company: { id: "GMD", ticker: "GMD" },
  };
  const created = { ...structuredClone(dossier), company: resolved.company };
  const client = createClient((path, options) => {
    if (path === "/scope") {
      assert.equal(options.body.companyId, undefined);
      return resolved;
    }
    if (path === "/dossiers" && options.method === "POST") return { dossier: created };
    if (path.endsWith("/analyze"))
      return { job: { id: "job_one_action", status: "running", kind: "analysis" } };
    if (path.endsWith("/cancel")) return { job: { id: "job_one_action", status: "cancelled" } };
  });
  const controller = makeController(client);
  const views = [];
  controller.subscribe(() => views.push(controller.getState().view));
  const input = { query: "GMD H1 2026 earnings quality?" };
  const result = await controller.startResearch(input);
  assert.deepEqual(result, {
    status: "started",
    jobId: "job_one_action",
    dossierId: dossier.id,
    revision: 1,
  });
  const create = client.requests.find(
    (request) => request.path === "/dossiers" && request.method === "POST",
  );
  assert.equal(create.body.companyId, "GMD");
  assert.equal(create.body.comparisonPeriodId, scope.comparisonPeriodId);
  assert.equal(create.body.query, input.query);
  assert.equal(views.includes("scope"), false);
  assert.equal(controller.getState().activeTab, "analysis");
  assert.equal(controller.getState().researchStep, null);
  await controller.cancelAnalysis();
});

test("an explicit conflicting selection returns to editing without creating a dossier or model job", async () => {
  const client = createClient((path) => {
    if (path === "/scope")
      throw new SecuritiesApiError("ambiguous_company", "Selection conflict", 422);
  });
  const controller = makeController(client);
  const input = { query: "GMD H1 2026?", companyId: "FPT" };
  const result = await controller.startResearch(input);
  assert.equal(result.status, "scope_required");
  assert.equal(result.code, "ambiguous_company");
  assert.deepEqual(result.selection, input);
  assert.equal(controller.getState().view, "start");
  assert.deepEqual(controller.getState().researchDraft, input);
  assert.equal(controller.getState().error.code, "ambiguous_company");
  assert.deepEqual(
    client.requests.map((request) => request.path),
    ["/scope"],
  );
});

test("lost create responses reuse the same idempotency key when the research action is retried", async () => {
  let creates = 0;
  const client = createClient((path, options) => {
    if (path === "/dossiers" && options.method === "POST" && ++creates === 1)
      throw new SecuritiesApiError("connection_failed");
    if (path.endsWith("/analyze"))
      return { job: { id: "job_create_retry", status: "running", kind: "analysis" } };
    if (path.endsWith("/cancel")) return { job: { id: "job_create_retry", status: "cancelled" } };
  });
  const controller = makeController(client);
  const input = { companyId: "FPT", periodId: "H1_2026", query: "FPT earnings quality?" };
  await assert.rejects(controller.startResearch(input), { code: "connection_failed" });
  await controller.startResearch(input);
  const mutations = client.requests.filter(
    (request) => request.path === "/dossiers" && request.method === "POST",
  );
  assert.equal(mutations.length, 2);
  assert.equal(mutations[0].body.requestId, mutations[1].body.requestId);
  assert.equal(client.requests.filter((request) => request.path.endsWith("/analyze")).length, 1);
  await controller.cancelAnalysis();
});

test("a failed analysis start preserves the created dossier and resumes with its original request key", async () => {
  let analyses = 0;
  const client = createClient((path) => {
    if (path.endsWith("/analyze")) {
      if (++analyses === 1) throw new SecuritiesApiError("connection_failed");
      return { job: { id: "job_analysis_retry", status: "running", kind: "analysis" } };
    }
    if (path.endsWith("/cancel")) return { job: { id: "job_analysis_retry", status: "cancelled" } };
  });
  const controller = makeController(client);
  const input = { companyId: "FPT", periodId: "H1_2026", query: "FPT earnings quality?" };
  await assert.rejects(controller.startResearch(input), { code: "connection_failed" });
  assert.equal(controller.getState().view, "dossier");
  assert.deepEqual(controller.getState().error.details, {
    dossierId: dossier.id,
    revision: 1,
    resumeAction: "startAnalysis",
  });
  controller.setLocale("en");
  await controller.startResearch(input);
  assert.equal(
    client.requests.filter((request) => request.path === "/dossiers" && request.method === "POST")
      .length,
    1,
  );
  const mutations = client.requests.filter((request) => request.path.endsWith("/analyze"));
  assert.equal(mutations[0].body.requestId, mutations[1].body.requestId);
  assert.equal(mutations[1].body.locale, "vi");
  await controller.cancelAnalysis();
});

test("ready and limited exact revisions export without personal approval while unavailable and stale readiness do not", async () => {
  for (const status of ["ready", "limited"]) {
    const current = {
      ...structuredClone(dossier),
      reportReadiness: { state: status, revision: 1, canExport: true },
    };
    const client = createClient((path) =>
      path === `/dossiers/${dossier.id}` ? { dossier: current } : undefined,
    );
    client.download = async (input) => {
      assert.equal(input.revision, 1);
      return { blob: new Blob(["report"]), filename: "report.md" };
    };
    const controller = makeController(client);
    await controller.openDossier({ dossierId: dossier.id });
    assert.equal(controller.getState().dossier.status, "draft");
    assert.equal(
      (await controller.exportRevision({ dossierId: dossier.id, revision: 1, format: "md" }))
        .status,
      "artifact_ready",
    );
  }
  for (const readiness of [
    { revision: 1, state: "unavailable", canExport: false },
    { revision: 2, state: "ready", canExport: true },
    undefined,
  ]) {
    const client = createClient((path) =>
      path === `/dossiers/${dossier.id}`
        ? {
            dossier: {
              ...structuredClone(dossier),
              status: "approved",
              reportReadiness: readiness,
            },
          }
        : undefined,
    );
    client.download = () => {
      throw new Error("Unsupported report must not download");
    };
    const controller = makeController(client);
    await controller.openDossier({ dossierId: dossier.id });
    await assert.rejects(
      controller.exportRevision({ dossierId: dossier.id, revision: 1, format: "md" }),
      { code: "report_unavailable" },
    );
  }
});

test("supplemental metric evidence uses the projection and exact source version while canonical IDs keep priority", async () => {
  const supplemental = {
    id: "operating_cash_flow",
    unit: "VND_million",
    current: { sourceId: "source", sourceVersion: "v2", value: -1145666005788, unit: "VND" },
  };
  const current = {
    ...structuredClone(dossier),
    reportProjection: {
      metrics: [
        supplemental,
        { ...dossier.metrics[0], current: { sourceId: "source", sourceVersion: "v1", value: 999 } },
      ],
    },
    analysis: { metrics: [{ id: "model_only" }] },
  };
  const controller = makeController(
    createClient((path) => (path === `/dossiers/${dossier.id}` ? { dossier: current } : undefined)),
  );
  await controller.openDossier({ dossierId: dossier.id });
  assert.equal(
    controller.getEvidence({
      dossierId: dossier.id,
      revision: 1,
      sourceId: "source",
      sourceVersion: "v2",
      metricId: supplemental.id,
    }).metric.id,
    supplemental.id,
  );
  assert.throws(
    () =>
      controller.getEvidence({
        sourceId: "source",
        sourceVersion: "v1",
        metricId: supplemental.id,
      }),
    { code: "evidence_mismatch" },
  );
  assert.throws(() => controller.getEvidence({ sourceId: "source", metricId: "model_only" }), {
    code: "metric_not_found",
  });
  assert.equal(dossierMetrics(current).find((metric) => metric.id === "revenue").current.value, 12);
  assert.equal(metricValue(supplemental, "current"), -1145666.005788);
  assert.deepEqual(reportFigure(supplemental, "en"), { value: "-1,145.7", unit: "VND billion" });
  assert.deepEqual(reportFigure({ ...supplemental, current: { value: null, unit: "VND" } }, "vi"), {
    value: "—",
    unit: "Tỷ đồng",
  });
});

test("uncertain mutation retries preserve their original locale and request ID across reload and language changes", async () => {
  const saved = new Map();
  const storage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
  const requests = [];
  const client = {
    async request(path, options) {
      requests.push({ path, ...options });
      if (requests.length === 1) throw new SecuritiesApiError("connection_failed");
      return { dossier: structuredClone(dossier) };
    },
  };
  const input = {
    companyId: "FPT",
    periodId: "H1_2026",
    query: "A research question",
    locale: "vi",
  };
  await assert.rejects(createRequestLedger({ storage }).execute(client, "/dossiers", input));
  const restored = createRequestLedger({ storage });
  await restored.execute(client, "/dossiers", { ...input, locale: "en" });
  assert.equal(requests[0].body.requestId, requests[1].body.requestId);
  assert.equal(requests[1].body.locale, "vi");
  await restored.execute(client, "/dossiers", { ...input, locale: "en" });
  assert.notEqual(requests[1].body.requestId, requests[2].body.requestId);
  assert.equal(requests[2].body.locale, "en");
  assert.ok(![...saved.values()].join("").includes(input.query));
});

test("detected scope is committed to the visible form before the research action creates a dossier", async () => {
  let scopeVisible;
  const resolved = new Promise((resolve) => {
    scopeVisible = resolve;
  });
  const client = createClient((path) => {
    if (path.endsWith("/analyze"))
      return { job: { id: "job_visible_scope", status: "running", kind: "analysis" } };
    if (path.endsWith("/cancel")) return { job: { id: "job_visible_scope", status: "cancelled" } };
  });
  const controller = makeController(client);
  controller.markRendered(controller.getState().renderVersion);
  controller.subscribe(() => {
    if (controller.getState().scope) scopeVisible();
  });
  const operation = controller.startResearch({ query: "FPT H1 2026?" });
  await resolved;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    client.requests.some((request) => request.path === "/dossiers" && request.method === "POST"),
    false,
  );
  controller.markRendered(controller.getState().renderVersion);
  await operation;
  assert.equal(client.requests.filter((request) => request.path.endsWith("/analyze")).length, 1);
  await controller.cancelAnalysis();
});
