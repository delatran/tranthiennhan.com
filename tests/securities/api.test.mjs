import assert from "node:assert/strict";
import { readFileSync, realpathSync, mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleSecuritiesRequest } from "../../worker/securities/api.js";
import { createSecuritiesStore } from "../../worker/securities/store.js";
import { readSecuritiesEvidence } from "../../worker/securities/ingestion.js";
import { startSecuritiesIngestionService } from "../../scripts/securities/ingestion-service.mjs";
import { resolveScopeFromDatasets } from "../../shared/securities/catalog.js";
import { normalizeSecuritiesHistory } from "../../worker/securities/model-contract.js";
import { createSecuritiesClient } from "../../src/securities/api.js";

// SQLite executes the real storage SQL. Provider/source outputs below are labelled
// synthetic fixtures and are never claimed as live financial or AI receipts.
const SCHEMA = readFileSync(
  new URL("../../worker/securities/migrations/0001.sql", import.meta.url),
  "utf8",
);

function dbAdapter(database) {
  const run = (sql, values) => {
    const native = database.prepare(sql);
    const result = native.run(...values);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  };
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            sql,
            values,
            run: async () => run(sql, values),
            first: async () => database.prepare(sql).get(...values) ?? null,
            all: async () => ({ results: database.prepare(sql).all(...values) }),
          };
        },
      };
    },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => run(statement.sql, statement.values));
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function data() {
  const point = (value) => ({
    value,
    sourceId: "fixture-source",
    sourceVersion: "1",
    verification: "verified",
    locator: { precision: "cell", page: 3, rowCode: "10", column: "Synthetic column" },
  });
  return {
    company: { id: "FIX", ticker: "FIX", name: "Synthetic API fixture" },
    period: { id: "FY2025", label: "2025", kind: "annual", scope: "consolidated" },
    comparisonPeriod: { id: "FY2024", label: "2024", kind: "annual", scope: "consolidated" },
    sources: [
      {
        id: "fixture-source",
        companyId: "FIX",
        version: "1",
        hash: "a".repeat(64),
        url: "https://example.com/synthetic.pdf",
        fetchedAt: "2026-09-06T00:00:00.000Z",
      },
    ],
    metrics: [
      {
        id: "revenue",
        label: { vi: "Doanh thu", en: "Revenue" },
        unit: "VND_billion",
        current: point(120),
        comparison: point(100),
      },
    ],
    issues: [],
  };
}

function setup(t, { live = false, model, filename = ":memory:" } = {}) {
  const database = new DatabaseSync(filename);
  database.exec(SCHEMA);
  let closed = false;
  const close = () => {
    if (!closed) {
      database.close();
      closed = true;
    }
  };
  t.after(close);
  const db = dbAdapter(database);
  const env = {
    SECURITIES_DB: db,
    SECURITIES_LOCAL_MODE: "true",
    SECURITIES_MODEL_MODE: live ? "live" : "off",
    ...(live ? { SECURITIES_OPENROUTER_API_KEY: "synthetic-unit-test-key-never-transmitted" } : {}),
  };
  const store = createSecuritiesStore(db);
  const operations = [];
  const calls = [];
  const dependencies = {
    store,
    catalog: () => ({ companies: [{ id: "FIX", periods: [{ id: "FY2025" }] }] }),
    resolveScope: (input) => ({
      ...input,
      company: data().company,
      period: data().period,
      comparisonPeriod: data().comparisonPeriod,
      ready: true,
    }),
    loadDataset: () => data(),
    analyze: async (options) => {
      calls.push(options);
      return model
        ? model(options)
        : { summary: "Synthetic result", claims: [], questions: [], limitations: [], receipts: [] };
    },
    chat: async (options) => {
      calls.push(options);
      return model
        ? model(options)
        : {
            summary: "Synthetic contextual answer",
            claims: [],
            questions: [],
            limitations: [],
            receipts: [],
          };
    },
  };
  const rawRequest = async (
    path,
    input,
    { method = input === undefined ? "GET" : "POST", headers = {}, signal } = {},
  ) => {
    const response = await handleSecuritiesRequest(
      new Request(`http://localhost:4313/api/securities${path}`, {
        method,
        signal,
        headers: {
          Origin: "http://localhost:4313",
          Accept: "application/x-ndjson, application/json",
          ...(input !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        ...(input === undefined
          ? {}
          : { body: typeof input === "string" ? input : JSON.stringify(input) }),
      }),
      env,
      { waitUntil: (operation) => operations.push(operation) },
      dependencies,
    );
    return response;
  };
  const request = async (...args) => {
    const response = await rawRequest(...args);
    if (!response.headers.get("Content-Type")?.startsWith("application/x-ndjson")) return response;
    // Model a browser that consumes the accepted event immediately and keeps
    // reading the body. Test completion follows the stream, never waitUntil.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let initial = "";
    while (!initial.includes("\n")) {
      const { value, done } = await reader.read();
      assert.equal(done, false);
      initial += decoder.decode(value, { stream: true });
    }
    operations.push(
      (async () => {
        try {
          while (!(await reader.read()).done) {}
        } finally {
          reader.releaseLock();
        }
      })(),
    );
    return new Response(initial.slice(0, initial.indexOf("\n")), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  };
  const create = async (requestId = "create-fixture-request") => {
    const response = await request("/dossiers", {
      companyId: "FIX",
      periodId: "FY2025",
      locale: "vi",
      requestId,
    });
    assert.equal(response.status, 201);
    return (await response.json()).data.dossier;
  };
  return {
    request,
    rawRequest,
    create,
    store,
    calls,
    operations,
    dependencies,
    env,
    close,
    database,
  };
}

test("removed company-comparison routes return 404 without source, model, or storage activity", async (t) => {
  const app = setup(t, { live: true });
  const dossier = await app.create();
  let transportCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    transportCalls += 1;
    throw new Error("A removed route attempted transport.");
  });
  app.env.SECURITIES_INGESTION_URL = "http://127.0.0.1:9";
  app.env.SECURITIES_INGESTION_TOKEN = "synthetic_removed_route_token_only_0000";
  const sourceCalls = [];
  for (const name of [
    "catalog",
    "resolveScope",
    "loadDataset",
    "readMarket",
    "readMarketDirectory",
    "readMarketResearch",
    "prepareComparison",
  ])
    app.dependencies[name] = async () => {
      sourceCalls.push(name);
      throw new Error("A removed route attempted source preparation.");
    };
  let storageCalls = 0;
  app.dependencies.store = new Proxy(
    {},
    {
      get() {
        storageCalls += 1;
        throw new Error("A removed route attempted storage.");
      },
    },
  );
  const routes = [
    ["GET", "/comparisons"],
    ["POST", "/comparisons"],
    ["GET", "/comparisons/options?left=AAA&right=BBB"],
    ["POST", "/comparisons/prepare"],
    ["GET", "/comparisons/preparations/prep_retired_fixture"],
    ["POST", "/comparisons/preparations/prep_retired_fixture/advance"],
    ["POST", "/comparisons/preparations/prep_retired_fixture/cancel"],
    ["GET", "/comparisons/cp_retired_fixture"],
    ["DELETE", "/comparisons/cp_retired_fixture"],
    ["POST", "/comparisons/cp_retired_fixture/refresh"],
    ["GET", "/comparisons/cp_retired_fixture/export?revision=1&format=xlsx"],
    ["POST", "/comparisons/cp_retired_fixture/chat"],
    ["GET", "/comparisons/cp_retired_fixture/chat/job_retired_fixture"],
  ];
  for (const [method, pathname] of routes) {
    const response = await app.request(
      pathname,
      method === "GET" ? undefined : { requestId: "removed_route_fixture" },
      { method },
    );
    assert.equal(response.status, 404, `${method} ${pathname}`);
    assert.equal((await response.json()).error.code, "not_found");
  }
  assert.equal(transportCalls, 0);
  assert.equal(storageCalls, 0);
  assert.deepEqual(sourceCalls, []);
  assert.deepEqual(app.calls, []);
  assert.deepEqual(app.operations, []);
  assert.deepEqual(await app.store.get(dossier.id), dossier);
});

test("the dossier library remains available without reading or deleting retained comparison history", async (t) => {
  const app = setup(t);
  const dossier = await app.create();
  for (const name of ["0004_comparisons.sql", "0005_comparison_preparations.sql"])
    app.database.exec(
      readFileSync(new URL(`../../worker/securities/migrations/${name}`, import.meta.url), "utf8"),
    );
  app.database
    .prepare(
      "INSERT INTO securities_comparisons (id, revision, snapshot_json, created_at, updated_at) VALUES (?,1,?,?,?)",
    )
    .run("cp_retired_fixture", '{"retained":"synthetic history"}', "2026-01-01", "2026-01-01");
  app.database
    .prepare(
      "INSERT INTO securities_comparison_preparations (id, request_id, input_digest, input_json, status, started_at, updated_at, deadline) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      "prep_retired_fixture",
      "req_retired_fixture",
      "a".repeat(64),
      "{}",
      "cancelled",
      "2026-01-01",
      "2026-01-01",
      "2026-01-02",
    );
  const tables = [
    "securities_comparisons",
    "securities_comparison_revisions",
    "securities_comparison_jobs",
    "securities_comparison_preparations",
  ];
  const retained = () => tables.map((name) => app.database.prepare(`SELECT * FROM ${name}`).all());
  const before = retained();
  const response = await app.request("/dossiers");
  assert.equal(response.status, 200);
  const { data: result } = await response.json();
  assert.deepEqual(Object.keys(result), ["dossiers"]);
  assert.deepEqual(
    result.dossiers.map((entry) => entry.id),
    [dossier.id],
  );
  assert.equal(
    (
      await app.request(
        "/comparisons/cp_retired_fixture",
        { requestId: "removed_delete_fixture", expectedRevision: 1 },
        { method: "DELETE" },
      )
    ).status,
    404,
  );
  assert.deepEqual(retained(), before);
  assert.deepEqual(await app.store.get(dossier.id), dossier);
});

test("API lifecycle creates, corrects, approves, reopens and exports exactly the selected historical revision", async (t) => {
  const app = setup(t);
  const first = await app.create();
  const revised = await app.request(`/dossiers/${first.id}/revise`, {
    expectedRevision: 1,
    requestId: "revision-fixture-request",
    changes: [
      {
        metricId: "revenue",
        periodId: "FY2025",
        value: 125,
        reason: "Checked synthetic financial statement",
        sourceChecked: true,
      },
    ],
    notes: "Synthetic analyst note",
  });
  assert.equal(revised.status, 200);
  const second = (await revised.json()).data.dossier;
  assert.equal(second.revision, 2);
  assert.equal(second.originalMetrics[0].current.value, 120);
  const approved = await app.request(`/dossiers/${first.id}/approve`, {
    expectedRevision: 2,
    requestId: "approve-fixture-request",
    intent: "approve_exact_revision",
  });
  assert.equal((await approved.json()).data.dossier.status, "approved");
  await app.request(`/dossiers/${first.id}/revise`, {
    expectedRevision: 2,
    requestId: "newdraft-fixture-request",
    notes: "New draft after approval",
  });
  const exported = await app.request(`/dossiers/${first.id}/export?revision=2&format=xlsx`);
  assert.equal(exported.status, 200);
  assert.equal(exported.headers.get("X-Dossier-Revision"), "2");
  assert.equal(new Uint8Array(await exported.arrayBuffer())[0], 0x50);
  const notes = await app.request(`/dossiers/${first.id}/export?revision=2&format=md`);
  const markdown = await notes.text();
  assert.match(markdown, /Revision: 2/u);
  assert.match(markdown, /Synthetic analyst note/u);
  assert.doesNotMatch(markdown, /New draft after approval/u);
  const draftExport = await app.request(`/dossiers/${first.id}/export?revision=3&format=xlsx`);
  assert.equal(draftExport.status, 200);
  assert.equal(draftExport.headers.get("X-Dossier-Revision"), "3");
  assert.equal((await app.store.get(first.id, 3)).reportReadiness.state, "limited");
  const reopened = await app.request(`/dossiers/${first.id}?revision=2`);
  assert.equal((await reopened.json()).data.dossier.status, "approved");
});

test("API request ids replay saved revisions and reject changed payloads", async (t) => {
  const app = setup(t);
  const input = {
    companyId: "FIX",
    periodId: "FY2025",
    locale: "vi",
    requestId: "duplicate-create-request",
  };
  const [a, b] = await Promise.all([
    app.request("/dossiers", input),
    app.request("/dossiers", input),
  ]);
  assert.equal((await a.json()).data.dossier.id, (await b.json()).data.dossier.id);
  assert.equal((await app.store.list()).length, 1);
  const conflict = await app.request("/dossiers", { ...input, locale: "en" });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "idempotency_conflict");
});

test("public deletion purges every saved dossier row and safely replays the request", async (t) => {
  const app = setup(t);
  const dossier = await app.create("create-delete-fixture");
  await app.store.approve(dossier, {
    requestId: "approve-delete-fixture",
    fingerprint: "approve-delete-fingerprint",
    now: "2026-09-07T08:00:00.000Z",
  });
  const job = {
    id: "job_delete_fixture",
    requestId: "chat-delete-fixture",
    dossierId: dossier.id,
    revision: dossier.revision,
    kind: "chat",
    question: "Synthetic follow-up",
    startedAt: "2026-09-07T08:01:00.000Z",
    deadline: "2026-09-07T08:05:00.000Z",
  };
  await app.store.startJob(job, "chat-delete-fingerprint");
  await app.store.completeChat(
    job,
    { summary: "Synthetic answer", claims: [], questions: [], limitations: [], receipts: [] },
    "2026-09-07T08:02:00.000Z",
  );

  const input = { expectedRevision: dossier.revision, requestId: "delete-fixture-request" };
  const deleted = await app.request(`/dossiers/${dossier.id}`, input, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), {
    ok: true,
    data: { deleted: true, dossierId: dossier.id, revision: dossier.revision },
  });
  const replay = await app.request(`/dossiers/${dossier.id}`, input, { method: "DELETE" });
  assert.equal((await replay.json()).data.replay, true);
  assert.equal((await app.request(`/dossiers/${dossier.id}`)).status, 404);
  assert.deepEqual(await app.store.list(), []);
  for (const table of [
    "securities_dossiers",
    "securities_revisions",
    "securities_approvals",
    "securities_jobs",
  ])
    assert.equal(app.database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0);
  assert.deepEqual(
    app.database
      .prepare("SELECT result_kind, result_id, result_revision FROM securities_requests")
      .all()
      .map((row) => ({ ...row })),
    [{ result_kind: "deletion", result_id: dossier.id, result_revision: dossier.revision }],
  );
});

test("deletion rejects a stale revision and a running job without removing research", async (t) => {
  const app = setup(t);
  const dossier = await app.create("create-delete-guard-fixture");
  const revised = await app.request(`/dossiers/${dossier.id}/revise`, {
    expectedRevision: 1,
    requestId: "revise-delete-guard-fixture",
    notes: "Revision guard",
  });
  assert.equal(revised.status, 200);
  const stale = await app.request(
    `/dossiers/${dossier.id}`,
    { expectedRevision: 1, requestId: "delete-stale-fixture" },
    { method: "DELETE" },
  );
  assert.equal(stale.status, 409);
  assert.deepEqual((await stale.json()).error.details, { currentRevision: 2 });

  const job = {
    id: "job_delete_guard_fixture",
    requestId: "job-delete-guard-fixture",
    dossierId: dossier.id,
    revision: 2,
    kind: "chat",
    question: "Still running",
    startedAt: "2026-09-07T08:01:00.000Z",
    deadline: "2099-09-07T08:05:00.000Z",
  };
  await app.store.startJob(job, "job-delete-guard-fingerprint");
  const active = await app.request(
    `/dossiers/${dossier.id}`,
    { expectedRevision: 2, requestId: "delete-active-fixture" },
    { method: "DELETE" },
  );
  assert.equal(active.status, 409);
  assert.equal((await active.json()).error.code, "job_in_progress");
  assert.equal((await app.store.get(dossier.id)).revision, 2);
});

test("deleting an already absent opaque dossier is idempotent", async (t) => {
  const app = setup(t);
  const response = await app.request(
    "/dossiers/ds_already_removed",
    { expectedRevision: 4, requestId: "delete-absent-fixture" },
    { method: "DELETE" },
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    deleted: true,
    dossierId: "ds_already_removed",
    revision: 4,
    alreadyDeleted: true,
  });
});

test("explicit catalogue selection creates a dossier with an empty optional natural question", async (t) => {
  const app = setup(t);
  const response = await app.request("/dossiers", {
    companyId: "FIX",
    periodId: "FY2025",
    locale: "vi",
    query: "",
    requestId: "catalog-selection-fixture",
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.dossier.query, "");
});

test("scope treats visible defaults as hints while unsupported and conflicting explicit selections stop before creation", async (t) => {
  const app = setup(t);
  app.dependencies.resolveScope = (input) => resolveScopeFromDatasets(input);
  const defaultScope = {
    companyId: "FPT",
    periodId: "H1_2026",
    comparisonPeriodId: "H1_2025_restated",
  };
  const generic = await app.request("/scope", {
    query: "Lợi nhuận có đi cùng dòng tiền?",
    defaultScope,
    locale: "vi",
  });
  assert.equal(generic.status, 200);
  assert.equal((await generic.json()).data.companyId, "FPT");
  const other = await app.request("/scope", {
    query: "Phân tích GMD 6 tháng 2026",
    defaultScope,
    locale: "vi",
  });
  assert.equal(other.status, 200);
  assert.equal((await other.json()).data.companyId, "GMD");
  const unsupported = await app.request("/scope", {
    query: "Phân tích HPG 6 tháng 2026",
    defaultScope,
    locale: "vi",
  });
  assert.equal(unsupported.status, 422);
  const conflict = await app.request("/scope", {
    query: "Phân tích GMD 6 tháng 2026",
    companyId: "FPT",
    defaultScope,
    locale: "vi",
  });
  assert.equal(conflict.status, 422);
  assert.equal((await conflict.json()).error.code, "ambiguous_company");
  const forged = await app.request("/scope", {
    query: "Dòng tiền",
    defaultScope: { ...defaultScope, sourceUrl: "https://example.invalid/private" },
  });
  assert.equal(forged.status, 422);
  assert.equal((await forged.json()).error.code, "invalid_default_scope");
  assert.equal((await app.store.list()).length, 0);
  assert.equal(app.calls.length, 0);
});

test("idempotency binds the complete default hint without accepting it as an explicit selected company", async (t) => {
  const app = setup(t);
  const input = {
    companyId: "FIX",
    periodId: "FY2025",
    locale: "en",
    requestId: "hint-fingerprint-fixture",
    defaultScope: { companyId: "FPT" },
  };
  assert.equal((await app.request("/dossiers", input)).status, 201);
  const changed = await app.request("/dossiers", { ...input, defaultScope: { companyId: "GMD" } });
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error.code, "idempotency_conflict");
});

test("phase A never invokes a configured test provider and exposes truthful runtime capability", async (t) => {
  const app = setup(t);
  const dossier = await app.create();
  const response = await app.request(`/dossiers/${dossier.id}/analyze`, {
    expectedRevision: 1,
    requestId: "analysis-fixture-request",
    locale: "vi",
  });
  assert.equal(response.status, 503);
  assert.equal(app.calls.length, 0);
  assert.equal(app.operations.length, 0);
  const catalog = (await (await app.request("/catalog")).json()).data;
  assert.equal(catalog.runtime.model.enabled, false);
  assert.equal(catalog.runtime.model.phase, "A");
});

test("API validates schemas, bodies, origin and query fields before changing data", async (t) => {
  const app = setup(t);
  const requests = [
    app.request("/dossiers", "{bad json"),
    app.request("/dossiers", {
      companyId: "FIX",
      periodId: "FY2025",
      locale: "vi",
      requestId: "forged-fixture-request",
      sources: [],
    }),
    app.request("/scope", { query: "x".repeat(25_000) }),
    app.request("/catalog?token=bad"),
    app.request(
      "/scope",
      { companyId: "FIX" },
      { headers: { Origin: "https://malicious.example" } },
    ),
  ];
  const responses = await Promise.all(requests);
  assert.deepEqual(
    responses.map((response) => response.status),
    [400, 400, 413, 400, 403],
  );
  assert.equal((await app.store.list()).length, 0);
});

test("a job stream exposes its ID and persisted progress before completion and closes only after saving the result", async (t) => {
  let finish;
  let progress;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const progressed = new Promise((resolve) => {
    progress = resolve;
  });
  const result = { summary: "Synthetic streamed result", claims: [], receipts: [] };
  const app = setup(t, {
    live: true,
    model: async ({ onProgress }) => {
      await onProgress({ stage: "writing_report", readCount: 1 });
      progress();
      return pending;
    },
  });
  t.after(() => finish(result));
  const dossier = await app.create();
  const input = { expectedRevision: 1, requestId: "stream-start-fixture" };
  const response = await app.rawRequest(`/dossiers/${dossier.id}/analyze`, input);
  assert.equal(response.status, 202);
  assert.match(response.headers.get("Content-Type"), /^application\/x-ndjson;/u);
  const reader = response.body.getReader();
  const first = JSON.parse(new TextDecoder().decode((await reader.read()).value));
  assert.equal(first.event, "accepted");
  assert.equal(first.data.job.status, "running");
  assert.equal(response.headers.get("X-Securities-Job-ID"), first.data.job.id);
  assert.equal(app.operations.length, 0, "model execution must not be put in waitUntil");
  await progressed;
  const current = (await (await app.request(`/jobs/${first.data.job.id}`)).json()).data.job;
  assert.equal(current.progress.stage, "writing_report");
  assert.equal(current.status, "running");
  const replay = await app.request(`/dossiers/${dossier.id}/analyze`, input);
  assert.equal((await replay.json()).data.job.id, first.data.job.id);
  assert.equal(app.calls.length, 1);
  let closed = false;
  const tail = new Response(
    new ReadableStream({
      async start(controller) {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          controller.enqueue(part.value);
        }
        reader.releaseLock();
        controller.close();
      },
    }),
  )
    .text()
    .then((value) => {
      closed = true;
      return value;
    });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(closed, false);
  assert.equal((await app.store.get(dossier.id)).revision, 1);
  finish(result);
  const terminal = JSON.parse((await tail).trim());
  assert.equal(terminal.event, "result");
  assert.equal(terminal.data.job.status, "completed");
  assert.equal(terminal.data.job.result.dossier.revision, 2);
  assert.equal((await app.store.get(dossier.id)).revision, 2);
});

test("a JSON job caller retains the request through completion without scheduling background model work", async (t) => {
  let finish;
  let enter;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  const result = { summary: "Synthetic JSON result", claims: [], receipts: [] };
  const app = setup(t, {
    live: true,
    model: async () => {
      enter();
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  t.after(() => finish?.(result));
  const dossier = await app.create();
  let returned = false;
  const response = app
    .rawRequest(
      `/dossiers/${dossier.id}/analyze`,
      {
        expectedRevision: 1,
        requestId: "json-lifetime-fixture",
      },
      { headers: { Accept: "application/json" } },
    )
    .then((value) => {
      returned = true;
      return value;
    });
  await entered;
  assert.equal(returned, false);
  assert.equal(app.operations.length, 0);
  finish(result);
  const terminal = await (await response).json();
  assert.equal(terminal.data.job.status, "completed");
  assert.equal(terminal.data.job.result.dossier.revision, 2);
});

test("disconnecting either the request or response cancels the model and persists interruption immediately", async (t) => {
  for (const transport of ["request", "response"]) {
    await t.test(transport, async (t) => {
      let observed;
      const receiptObserved = new Promise((resolve) => {
        observed = resolve;
      });
      const receipt = {
        fixture: true,
        transportAttemptId: "bab42920-6dc9-40b5-8534-c664f7b0c1ad",
        operation: "analysis",
        attempt: 1,
        costUsd: null,
        costStatus: "unknown",
      };
      const app = setup(t, {
        live: true,
        model: async ({ signal, onReceipt }) => {
          await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
          await onReceipt(receipt);
          observed();
          throw Object.assign(new Error("Synthetic transport interrupted"), {
            code: "model_cancelled",
            receipts: [receipt],
          });
        },
      });
      const controller = new AbortController();
      t.after(() => controller.abort());
      const dossier = await app.create();
      const response = await app.rawRequest(
        `/dossiers/${dossier.id}/analyze`,
        {
          expectedRevision: 1,
          requestId: `disconnect-${transport}-fixture`,
        },
        { signal: controller.signal },
      );
      const reader = response.body.getReader();
      const first = JSON.parse(new TextDecoder().decode((await reader.read()).value));
      assert.equal(app.calls.length, 1);
      if (transport === "response") await reader.cancel();
      else {
        controller.abort();
        while (!(await reader.read()).done) {}
      }
      reader.releaseLock();
      await receiptObserved;
      await Promise.all(app.operations);
      const job = await app.store.getJob(first.data.job.id);
      assert.equal(app.calls[0].signal.aborted, true);
      assert.equal(job.status, "failed");
      assert.equal(job.error.code, "job_interrupted");
      assert.deepEqual(job.receipts, [receipt]);
      assert.equal((await app.store.get(dossier.id)).revision, 1);
      assert.equal(app.operations.length, 1, "waitUntil owns only the disconnect write");
    });
  }
});

test("the browser receives a streaming job immediately while continuing to consume its response", async (t) => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const result = { summary: "Synthetic browser result", claims: [], receipts: [] };
  const app = setup(t, { live: true, model: () => pending });
  t.after(() => finish(result));
  const dossier = await app.create();
  let response;
  let accepted;
  const client = createSecuritiesClient({
    base: "http://localhost:4313/api/securities",
    fetchImpl: async (url, options) => {
      accepted = options.headers.Accept;
      response = await app.rawRequest(
        new URL(url).pathname.replace("/api/securities", ""),
        options.body ? JSON.parse(options.body) : undefined,
        options,
      );
      return response;
    },
  });
  const started = await client.request(`/dossiers/${dossier.id}/analyze`, {
    method: "POST",
    body: { expectedRevision: 1, requestId: "browser-stream-fixture" },
  });
  assert.match(accepted, /application\/x-ndjson/u);
  assert.equal(started.job.status, "running");
  assert.equal(response.body.locked, true);
  const startedResponse = response;
  const cancel = await client.request(`/jobs/${started.job.id}/cancel`, {
    method: "POST",
    body: { requestId: "browser-cancel-fixture" },
  });
  assert.equal(cancel.job.status, "cancelled");
  finish(result);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await app.store.getJob(started.job.id)).status, "cancelled");
  assert.equal((await app.store.get(dossier.id)).revision, 1);
  assert.equal(startedResponse.bodyUsed, true);
  assert.equal(
    startedResponse.body.locked,
    false,
    "the client drains and releases the completed stream",
  );
});

test("the browser cancels malformed or mismatched job streams instead of leaving an unowned request open", async (t) => {
  const accepted = { event: "accepted", ok: true, data: { job: { id: "job_client_fixture" } } };
  const cases = [
    ["malformed JSON", "{invalid\n"],
    [
      "mismatched job",
      `${JSON.stringify({ ...accepted, data: { job: { id: "job_other_fixture" } } })}\n`,
    ],
    ["missing acceptance", `${JSON.stringify({ ...accepted, event: "result" })}\n`],
    ["oversized initial record", " ".repeat(128_001)],
  ];
  for (const [name, text] of cases) {
    await t.test(name, async () => {
      let cancelled = false;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
        },
        cancel() {
          cancelled = true;
        },
      });
      const client = createSecuritiesClient({
        fetchImpl: async () =>
          new Response(stream, {
            status: 202,
            headers: {
              "Content-Type": "application/x-ndjson; charset=utf-8",
              "X-Securities-Job-ID": "job_client_fixture",
            },
          }),
      });
      await assert.rejects(
        client.request("/dossiers/ds_fixture/analyze", {
          method: "POST",
          body: { expectedRevision: 1, requestId: "invalid-stream-fixture" },
        }),
        { code: "invalid_response" },
      );
      assert.equal(cancelled, true);
      assert.equal(stream.locked, false);
    });
  }
});

test("analysis completes into a new immutable draft and duplicate starts do not call the model twice", async (t) => {
  const app = setup(t, { live: true });
  const dossier = await app.create();
  const input = { expectedRevision: 1, requestId: "analysis-fixture-request", locale: "en" };
  const start = await app.request(`/dossiers/${dossier.id}/analyze`, input);
  assert.equal(start.status, 202);
  const jobId = (await start.json()).data.job.id;
  await Promise.all(app.operations);
  const replay = await app.request(`/dossiers/${dossier.id}/analyze`, input);
  assert.equal((await replay.json()).data.job.id, jobId);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].locale, "en");
  const job = (await (await app.request(`/jobs/${jobId}`)).json()).data.job;
  assert.equal(job.status, "completed");
  assert.equal(job.result.dossier.revision, 2);
  assert.equal((await app.store.get(dossier.id, 1)).analysis.origin, "rules");
});

test("analysis receives the saved natural question through source refresh while chat keeps its own question", async (t) => {
  const app = setup(t, { live: true });
  const query = "Compare FIX consolidated revenue in FY2025 with the same prior period.";
  const created = await app.request("/dossiers", {
    companyId: "FIX",
    periodId: "FY2025",
    locale: "en",
    query,
    requestId: "natural-question-create",
  });
  const dossier = (await created.json()).data.dossier;
  await app.request(`/dossiers/${dossier.id}/analyze`, {
    expectedRevision: 1,
    requestId: "natural-question-analyze",
  });
  await Promise.all(app.operations);
  assert.equal(app.calls[0].question, query);
  const chatQuestion = "Which source row supplies the comparison?";
  await app.request(`/dossiers/${dossier.id}/chat`, {
    revision: 2,
    question: chatQuestion,
    requestId: "natural-question-chat",
  });
  await Promise.all(app.operations);
  assert.equal(app.calls[1].question, chatQuestion);
  const updated = data();
  updated.sources[0].hash = "b".repeat(64);
  updated.sources[0].version = "2";
  for (const metric of updated.metrics)
    for (const side of ["current", "comparison"]) metric[side].sourceVersion = "2";
  app.dependencies.loadDataset = () => updated;
  app.dependencies.refreshSources = async () => ({
    sourceChecks: [],
    freshness: { status: "checked" },
  });
  await app.request(`/dossiers/${dossier.id}/refresh`, {
    expectedRevision: 2,
    requestId: "natural-question-refresh",
  });
  await Promise.all(app.operations);
  const refreshed = await app.store.get(dossier.id);
  assert.equal(refreshed.revision, 3);
  assert.equal(refreshed.sources[0].version, "2");
  assert.equal(refreshed.query, query);
  await app.request(`/dossiers/${dossier.id}/analyze`, {
    expectedRevision: 3,
    requestId: "natural-question-reanalyze",
  });
  await Promise.all(app.operations);
  assert.equal(app.calls[2].question, query);
});

test("analyst annotation retains exact AI output and receipt while approval, chat and export bind to the new revision", async (t) => {
  const receipt = {
    evidenceType: "synthetic_test_fixture",
    actualModel: "meta/muse-spark-1.3-contributor",
    provider: "Meta",
    requestId: "gen-annotation-fixture",
    outcome: "completed",
    costUsd: null,
    costStatus: "unknown",
  };
  const aiWording = "Nhận xét AI gốc dùng thuật ngữ kiểm toán.";
  const annotation =
    "Analyst xác nhận đúng thuật ngữ là soát xét bán niên; giữ nguyên lời AI gốc để đối chiếu.";
  const app = setup(t, {
    live: true,
    model: async () => ({
      summary: aiWording,
      claims: [],
      questions: [],
      limitations: [],
      receipt,
      receipts: [receipt],
    }),
  });
  const first = await app.create();
  await app.request(`/dossiers/${first.id}/analyze`, {
    expectedRevision: 1,
    requestId: "annotation-analyze",
  });
  await Promise.all(app.operations);
  await app.request(`/dossiers/${first.id}/chat`, {
    revision: 2,
    question: "Check the original terminology",
    requestId: "annotation-original-chat",
  });
  await Promise.all(app.operations);
  await app.request(`/dossiers/${first.id}/approve`, {
    expectedRevision: 2,
    intent: "approve_exact_revision",
    requestId: "annotation-original-approve",
  });
  const original = await app.store.get(first.id, 2);
  const analysisJson = JSON.stringify(original.analysis);
  const revised = await app.request(`/dossiers/${first.id}/revise`, {
    expectedRevision: 2,
    notes: annotation,
    requestId: "annotation-save-notes",
  });
  assert.equal(revised.status, 200);
  const current = (await revised.json()).data.dossier;
  assert.equal(current.revision, 3);
  assert.equal(current.status, "draft");
  assert.equal(current.approval, null);
  assert.equal(JSON.stringify(current.analysis), analysisJson);
  assert.equal(current.analysis.inputRevision, 1);
  assert.deepEqual(current.analysis.receipt, receipt);
  assert.equal(current.analysisLineage.generatedInRevision, 2);
  assert.equal(current.analysisLineage.carriedFromRevision, 2);
  assert.equal(current.analysisLineage.reason, "analyst_notes_only");
  assert.deepEqual(current.chat, []);
  assert.equal(app.calls.length, 2);
  const priorReadback = await app.store.get(first.id, 2);
  assert.equal(priorReadback.status, "approved");
  assert.equal(priorReadback.notes, "");
  assert.equal(priorReadback.chat.length, 2);
  assert.equal(JSON.stringify(priorReadback.analysis), analysisJson);
  assert.deepEqual(priorReadback.analysisLineage, original.analysisLineage);
  assert.equal(
    (await app.request(`/dossiers/${first.id}/export?revision=3&format=xlsx`)).status,
    200,
  );
  await app.request(`/dossiers/${first.id}/approve`, {
    expectedRevision: 3,
    intent: "approve_exact_revision",
    requestId: "annotation-new-approve",
  });
  const notes = await (
    await app.request(`/dossiers/${first.id}/export?revision=3&format=md`)
  ).text();
  assert.ok(notes.includes(aiWording));
  assert.ok(notes.includes(annotation));
  assert.match(notes, /Analysis input revision: 1/u);
  assert.match(notes, /Analysis carried from revision: 2/u);
  const xlsx = await app.request(`/dossiers/${first.id}/export?revision=3&format=xlsx`);
  assert.equal(xlsx.headers.get("X-Dossier-Revision"), "3");
  const workbook = Buffer.from(await xlsx.arrayBuffer()).toString("utf8");
  assert.ok(workbook.includes(aiWording));
  assert.ok(workbook.includes(annotation));
  assert.equal((await app.store.get(first.id, 2)).status, "approved");
});

test("a cancelled operation never commits late results and retains its accounting uncertainty", async (t) => {
  let release;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  const app = setup(t, {
    live: true,
    model: async () => {
      await delayed;
      return {
        summary: "Synthetic late result",
        claims: [],
        receipts: [{ fixture: true, costUsd: null, costStatus: "unknown" }],
      };
    },
  });
  const dossier = await app.create();
  const start = await app.request(`/dossiers/${dossier.id}/analyze`, {
    expectedRevision: 1,
    requestId: "delayed-fixture-request",
  });
  const id = (await start.json()).data.job.id;
  const cancel = await app.request(`/jobs/${id}/cancel`, { requestId: "cancel-fixture-request" });
  assert.equal((await cancel.json()).data.job.status, "cancelled");
  release();
  await Promise.all(app.operations);
  assert.equal((await app.store.get(dossier.id)).revision, 1);
  const job = await app.store.getJob(id);
  assert.equal(job.status, "cancelled");
  assert.equal(job.receipts[0].costUsd, null);
});

test("cancelled transport observations reconcile once across callbacks and terminal failure", async (t) => {
  let release;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  const receipt = {
    evidenceType: "fixture",
    transportAttemptId: "b628100c-bb4d-43d1-9057-bdf0867d6bd5",
    operation: "analysis",
    attempt: 1,
    requestId: null,
    provider: null,
    startedAt: "2026-09-08T03:53:52.450Z",
    outcome: "failed",
    errorCode: "model_cancelled",
    costUsd: null,
    costStatus: "unknown",
  };
  const app = setup(t, {
    live: true,
    model: async ({ onReceipt }) => {
      await delayed;
      await onReceipt(structuredClone(receipt));
      throw Object.assign(new Error("Synthetic cancelled transport"), {
        code: "model_cancelled",
        receipts: [structuredClone(receipt)],
      });
    },
  });
  const dossier = await app.create();
  const originalSnapshot = app.database
    .prepare("SELECT snapshot_json FROM securities_revisions WHERE dossier_id=? AND revision=1")
    .get(dossier.id).snapshot_json;
  const start = await app.request(`/dossiers/${dossier.id}/analyze`, {
    expectedRevision: 1,
    requestId: "cancel-receipt-analysis-fixture",
  });
  const id = (await start.json()).data.job.id;
  const cancel = await app.request(`/jobs/${id}/cancel`, {
    requestId: "cancel-receipt-cancel-fixture",
  });
  assert.equal((await cancel.json()).data.job.status, "cancelled");
  release();
  await Promise.all(app.operations);
  const reopened = (await (await app.request(`/jobs/${id}`)).json()).data.job;
  assert.equal(reopened.status, "cancelled");
  assert.equal(reopened.result, null);
  assert.deepEqual(reopened.receipts, [receipt]);
  const persisted = JSON.parse(
    app.database.prepare("SELECT receipt_json FROM securities_jobs WHERE id=?").get(id)
      .receipt_json,
  );
  assert.deepEqual(persisted, [receipt]);
  assert.equal((await app.store.get(dossier.id)).revision, 1);
  assert.equal(
    app.database
      .prepare("SELECT snapshot_json FROM securities_revisions WHERE dossier_id=? AND revision=1")
      .get(dossier.id).snapshot_json,
    originalSnapshot,
  );
  const otherAttempt = { ...receipt, transportAttemptId: "923520a2-dfe4-4401-bb09-8a5c9979af68" };
  await app.store.reconcileReceipts(id, [receipt, otherAttempt, structuredClone(otherAttempt)]);
  assert.deepEqual((await app.store.getJob(id)).receipts, [receipt, otherAttempt]);
});

test("follow-up jobs receive exactly the requested historical dossier revision", async (t) => {
  const app = setup(t, { live: true });
  const dossier = await app.create();
  await app.request(`/dossiers/${dossier.id}/revise`, {
    expectedRevision: 1,
    requestId: "newdraft-fixture-request",
    notes: "Current draft note",
  });
  const start = await app.request(`/dossiers/${dossier.id}/chat`, {
    revision: 1,
    question: "Explain the selected revenue comparison",
    locale: "en",
    requestId: "chat-fixture-request",
  });
  assert.equal(start.status, 202);
  await Promise.all(app.operations);
  assert.equal(app.calls[0].dossier.revision, 1);
  assert.equal(app.calls[0].dossier.notes, "");
  assert.equal((await app.store.get(dossier.id)).revision, 2);
});

test("SQLite persistence restores the dossier and approval after a service restart", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "nhan-securities-test-"));
  const filename = join(directory, "local.sqlite");
  t.after(() => {
    unlinkSync(filename);
    rmdirSync(directory);
  });
  const first = setup(t, { filename });
  const dossier = await first.create();
  await first.request(`/dossiers/${dossier.id}/approve`, {
    expectedRevision: 1,
    requestId: "approve-fixture-request",
    intent: "approve_exact_revision",
  });
  first.close();
  const second = setup(t, { filename });
  const reopened = await second.store.get(dossier.id);
  assert.equal(reopened.status, "approved");
  assert.equal(reopened.revision, 1);
  assert.equal(reopened.metrics[0].current.value, 120);
  second.close();
});

test("intentional refresh from an approved dossier creates a blocked new draft when the source file changed", async (t) => {
  const app = setup(t);
  const first = await app.create();
  const revised = await app.request(`/dossiers/${first.id}/revise`, {
    expectedRevision: 1,
    requestId: "correct-before-refresh",
    changes: [
      {
        metricId: "revenue",
        periodId: "FY2025",
        value: 125,
        reason: "Checked the exact source cell",
        sourceChecked: true,
      },
    ],
  });
  assert.equal(revised.status, 200);
  const corrected = (await revised.json()).data.dossier;
  await app.request(`/dossiers/${first.id}/approve`, {
    expectedRevision: 2,
    requestId: "approve-fixture-request",
    intent: "approve_exact_revision",
  });
  app.dependencies.refreshSources = async () => ({
    status: "changed",
    sourceChecks: [
      {
        sourceId: "fixture-source",
        status: "changed",
        previousHash: "a".repeat(64),
        hash: "b".repeat(64),
      },
    ],
    freshness: { status: "revision_detected", checkedAt: new Date().toISOString() },
  });
  const started = await app.request(`/dossiers/${first.id}/refresh`, {
    expectedRevision: 2,
    requestId: "refresh-fixture-request",
  });
  assert.equal(started.status, 202);
  await Promise.all(app.operations);
  const jobId = (await started.json()).data.job.id;
  assert.equal((await app.store.getJob(jobId)).status, "completed");
  const current = await app.store.get(first.id);
  assert.equal(current.revision, 3);
  assert.equal(current.status, "draft");
  assert.equal(current.sources[0].hash, "a".repeat(64));
  assert.equal(current.pendingSources[0].hash, "b".repeat(64));
  assert.equal(current.metrics[0].current.value, 125);
  assert.equal(current.originalMetrics[0].current.value, 120);
  assert.deepEqual(current.corrections, corrected.corrections);
  assert.equal(current.metrics[0].current.correctionId, corrected.corrections[0].id);
  assert.ok(current.issues.some((issue) => issue.requiresSourceImport));
  const rejected = await app.request(`/dossiers/${first.id}/approve`, {
    expectedRevision: 3,
    requestId: "approve-new-fixture",
    intent: "approve_exact_revision",
  });
  assert.equal(rejected.status, 422);
  assert.equal((await app.store.get(first.id, 2)).status, "approved");
});

test("refresh adopts a newly imported source version and preserves the former approved source", async (t) => {
  const app = setup(t);
  const first = await app.create();
  await app.request(`/dossiers/${first.id}/approve`, {
    expectedRevision: 1,
    requestId: "approve-fixture-request",
    intent: "approve_exact_revision",
  });
  const nextData = data();
  nextData.sources[0].hash = "b".repeat(64);
  nextData.sources[0].version = "2";
  for (const metric of nextData.metrics)
    for (const side of ["current", "comparison"]) metric[side].sourceVersion = "2";
  nextData.metrics[0].current.value = 130;
  app.dependencies.loadDataset = () => nextData;
  app.dependencies.refreshSources = async () => ({
    status: "unchanged",
    sourceChecks: [],
    freshness: { status: "checked" },
  });
  await app.request(`/dossiers/${first.id}/refresh`, {
    expectedRevision: 1,
    requestId: "refresh-import-request",
  });
  await Promise.all(app.operations);
  const current = await app.store.get(first.id);
  assert.equal(current.revision, 2);
  assert.equal(current.sources[0].version, "2");
  assert.equal(current.metrics[0].current.value, 130);
  const original = await app.store.get(first.id, 1);
  assert.equal(original.status, "approved");
  assert.equal(original.sources[0].version, "1");
  assert.equal(original.metrics[0].current.value, 120);
});

test("a post-receipt failure cannot erase already observed provider accounting", async (t) => {
  const receipt = {
    evidenceType: "synthetic_test_fixture",
    outcome: "completed",
    costUsd: null,
    costStatus: "unknown",
  };
  const app = setup(t, {
    live: true,
    model: async ({ onReceipt }) => {
      await onReceipt(receipt);
      throw Object.assign(new Error("Synthetic validation failure after the provider receipt"), {
        code: "model_invalid_output",
      });
    },
  });
  const dossier = await app.create();
  const started = await app.request(`/dossiers/${dossier.id}/analyze`, {
    expectedRevision: 1,
    requestId: "receipt-fixture-request",
  });
  const id = (await started.json()).data.job.id;
  await Promise.all(app.operations);
  const job = await app.store.getJob(id);
  assert.equal(job.status, "failed");
  assert.deepEqual(job.receipts, [receipt]);
  assert.equal((await app.store.get(dossier.id)).revision, 1);
});

test("FN-04 validation observations count one provider request once and preserve the historical analysis snapshot", async (t) => {
  const base = {
    evidenceType: "synthetic_test_fixture",
    provider: "Meta",
    actualModel: "meta/muse-spark-1.3-contributor",
    outcome: "completed",
    costStatus: "provider_reported",
  };
  const failed = {
    ...base,
    requestId: "gen-fn04-failed-fixture",
    startedAt: "2026-09-06T14:49:30.155Z",
    costUsd: 0.0031109,
    validation: { status: "failed", code: "model_invalid_claim" },
  };
  const pending = {
    ...base,
    requestId: "gen-fn04-draft-fixture",
    startedAt: "2026-09-06T14:50:10.233Z",
    costUsd: 0.0027439,
    validation: { status: "pending", stage: "report_draft" },
  };
  const checked = {
    ...base,
    requestId: "gen-fn04-check-fixture",
    startedAt: "2026-09-06T14:50:35.042Z",
    costUsd: 0.0030213,
    validation: { status: "passed", stage: "model_consistency_check" },
  };
  const final = {
    ...pending,
    validation: { status: "passed", stage: "report", semanticStatus: "passed" },
  };
  const observations = [failed, pending, checked, final];
  const originalObservations = structuredClone(observations);
  const app = setup(t, {
    live: true,
    model: async ({ onReceipt }) => {
      for (const receipt of observations) await onReceipt(receipt);
      return {
        summary: "Synthetic FN-04 receipt regression",
        claims: [],
        questions: [],
        limitations: [],
        receipt: final,
        receipts: observations,
      };
    },
  });
  const first = await app.create();
  const started = await app.request(`/dossiers/${first.id}/analyze`, {
    expectedRevision: 1,
    requestId: "fn04-receipts-fixture",
  });
  const jobId = (await started.json()).data.job.id;
  await Promise.all(app.operations);
  const historical = app.database
    .prepare("SELECT snapshot_json FROM securities_revisions WHERE dossier_id=? AND revision=2")
    .get(first.id).snapshot_json;
  assert.equal(
    JSON.parse(historical).analysis.receipts.length,
    4,
    "The immutable analysis preserves its original observations.",
  );
  const assertUniqueAccounting = (job) => {
    assert.equal(job.status, "completed");
    assert.equal(job.receipts.length, 3);
    assert.equal(
      job.receipts.reduce((sum, receipt) => sum + receipt.costUsd, 0).toFixed(7),
      "0.0088761",
    );
    const merged = job.receipts.find((receipt) => receipt.requestId === pending.requestId);
    assert.deepEqual(merged.validation, final.validation);
    assert.deepEqual(merged.validationHistory, [pending.validation, final.validation]);
  };
  assertUniqueAccounting(await app.store.getJob(jobId));
  const persisted = JSON.parse(
    app.database.prepare("SELECT receipt_json FROM securities_jobs WHERE id=?").get(jobId)
      .receipt_json,
  );
  assert.equal(
    persisted.length,
    3,
    "Future writes store one billing receipt per provider request.",
  );
  const legacyJson = JSON.stringify(observations);
  app.database
    .prepare("UPDATE securities_jobs SET receipt_json=? WHERE id=?")
    .run(legacyJson, jobId);
  const reopened = (await (await app.request(`/jobs/${jobId}`)).json()).data.job;
  assertUniqueAccounting(reopened);
  assert.equal(
    app.database.prepare("SELECT receipt_json FROM securities_jobs WHERE id=?").get(jobId)
      .receipt_json,
    legacyJson,
    "Reading old duplicate receipts is a projection, not a historical rewrite.",
  );
  assert.equal(
    app.database
      .prepare("SELECT snapshot_json FROM securities_revisions WHERE dossier_id=? AND revision=2")
      .get(first.id).snapshot_json,
    historical,
  );
  assert.deepEqual((await app.store.get(first.id, 2)).analysis.receipts, observations);
  assert.deepEqual(observations, originalObservations);
  const otherProvider = { ...final, provider: "Synthetic other provider" };
  const otherStart = { ...final, startedAt: "2026-09-06T14:51:10.233Z" };
  const anonymous = {
    ...base,
    requestId: null,
    startedAt: pending.startedAt,
    costUsd: null,
    costStatus: "unknown",
  };
  await app.store.reconcileReceipts(jobId, [
    final,
    otherProvider,
    otherStart,
    anonymous,
    structuredClone(anonymous),
  ]);
  const distinct = await app.store.getJob(jobId);
  assert.equal(distinct.receipts.length, 7);
  assert.equal(
    distinct.receipts.filter((receipt) => receipt.requestId === pending.requestId).length,
    3,
    "Provider and start time both participate in request identity.",
  );
  assert.equal(
    distinct.receipts.filter((receipt) => receipt.requestId === null).length,
    2,
    "Unidentified receipts cannot be assumed to describe one request.",
  );
  assert.equal(
    app.database
      .prepare("SELECT snapshot_json FROM securities_revisions WHERE dossier_id=? AND revision=2")
      .get(first.id).snapshot_json,
    historical,
  );
});

test("completed chat reopens with its original question and feeds only the same revision's follow-up context", async (t) => {
  const app = setup(t, { live: true });
  const dossier = await app.create();
  await app.request(`/dossiers/${dossier.id}/chat`, {
    revision: 1,
    question: "What changed in revenue?",
    requestId: "chat-first-fixture",
    locale: "en",
  });
  await Promise.all(app.operations);
  const reopened = await app.store.get(dossier.id, 1);
  assert.equal(reopened.chat.length, 2);
  assert.equal(reopened.chat[0].content, "What changed in revenue?");
  assert.equal(reopened.chat[1].answer.summary, "Synthetic contextual answer");
  await app.request(`/dossiers/${dossier.id}/chat`, {
    revision: 1,
    question: "Explain that comparison",
    requestId: "chat-second-fixture",
    locale: "en",
  });
  await Promise.all(app.operations);
  assert.equal(app.calls[1].history.length, 1);
  assert.equal(app.calls[1].history[0].user, "What changed in revenue?");
  assert.equal(app.calls[1].history[0].revision, 1);
  await app.request(`/dossiers/${dossier.id}/revise`, {
    expectedRevision: 1,
    requestId: "new-context-fixture",
    notes: "New financial revision",
  });
  const next = await app.store.get(dossier.id);
  assert.deepEqual(next.chat, []);
  assert.equal((await app.store.get(dossier.id, 1)).chat.length, 4);
  const stored = app.database
    .prepare("SELECT snapshot_json FROM securities_revisions WHERE dossier_id=? AND revision=2")
    .get(dossier.id);
  assert.equal(JSON.parse(stored.snapshot_json).chat, undefined);
  assert.equal(JSON.parse(stored.snapshot_json).reportProjection, undefined);
  assert.equal(JSON.parse(stored.snapshot_json).reportReadiness, undefined);
});

test("a new analysis may follow an already approved baseline while preserving its exact historical approval", async (t) => {
  const app = setup(t, { live: true });
  const dossier = await app.create();
  await app.request(`/dossiers/${dossier.id}/approve`, {
    expectedRevision: 1,
    requestId: "legacy-baseline-approve",
    intent: "approve_exact_revision",
  });
  const before = await app.store.get(dossier.id, 1);
  const started = await app.request(`/dossiers/${dossier.id}/analyze`, {
    expectedRevision: 1,
    requestId: "legacy-baseline-analyze",
  });
  assert.equal(started.status, 202);
  const jobId = (await started.json()).data.job.id;
  await Promise.all(app.operations);
  assert.equal((await app.store.getJob(jobId)).status, "completed");
  const current = await app.store.get(dossier.id);
  assert.equal(current.revision, 2);
  assert.equal(current.status, "draft");
  assert.equal(current.approval, null);
  assert.deepEqual((await app.store.get(dossier.id, 1)).approval, before.approval);
  assert.equal(
    (await app.request(`/dossiers/${dossier.id}/export?revision=2&format=xlsx`)).status,
    200,
  );
});

test("approval that arrives before dispatch prevents a stale model start and approval after dispatch prevents its commit", async (t) => {
  const beforeDispatch = setup(t, { live: true });
  const first = await beforeDispatch.create("approval-race-before-create");
  const originalStore = beforeDispatch.store;
  beforeDispatch.dependencies.store = {
    ...originalStore,
    startJob: async (job, fingerprint) => {
      await originalStore.approve(await originalStore.get(first.id), {
        requestId: "approval-race-before-approve",
        fingerprint: "synthetic-race",
        now: new Date().toISOString(),
      });
      return originalStore.startJob(job, fingerprint);
    },
  };
  const prevented = await beforeDispatch.request(`/dossiers/${first.id}/analyze`, {
    expectedRevision: 1,
    requestId: "approval-race-before-analyze",
  });
  assert.equal(prevented.status, 409);
  assert.equal(beforeDispatch.calls.length, 0);
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const during = setup(t, { live: true, model: () => pending });
  const second = await during.create("approval-race-during-create");
  const started = await during.request(`/dossiers/${second.id}/analyze`, {
    expectedRevision: 1,
    requestId: "approval-race-during-analyze",
  });
  const jobId = (await started.json()).data.job.id;
  await during.request(`/dossiers/${second.id}/approve`, {
    expectedRevision: 1,
    requestId: "approval-race-during-approve",
    intent: "approve_exact_revision",
  });
  finish({
    summary: "Synthetic late result",
    claims: [],
    questions: [],
    limitations: [],
    receipts: [],
  });
  await Promise.all(during.operations);
  assert.equal((await during.store.getJob(jobId)).status, "stale");
  assert.equal((await during.store.get(second.id)).revision, 1);
  assert.equal((await during.store.get(second.id)).status, "approved");
});

test("actual research progress is bounded, persisted and cannot replace a terminal job result", async (t) => {
  let finish;
  let progressed;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const progressObserved = new Promise((resolve) => {
    progressed = resolve;
  });
  const app = setup(t, {
    live: true,
    model: async ({ onProgress }) => {
      await onProgress({
        stage: "reading_sources",
        readCount: 1,
        sourceId: "fixture-source",
        pages: [3],
      });
      progressed();
      return pending;
    },
  });
  const dossier = await app.create();
  const response = await app.request(`/dossiers/${dossier.id}/analyze`, {
    expectedRevision: 1,
    requestId: "progress-fixture-analyze",
  });
  const id = (await response.json()).data.job.id;
  await progressObserved;
  const running = await app.store.getJob(id);
  assert.equal(running.status, "running");
  assert.equal(running.progress.stage, "reading_sources");
  assert.equal(running.progress.readCount, 1);
  assert.equal(running.result, null);
  await assert.rejects(
    app.store.updateJobProgress(id, {
      stage: "reading_sources",
      token: "synthetic-unexpected-field",
    }),
    { code: "invalid_job_progress" },
  );
  finish({
    summary: "Synthetic final result",
    claims: [],
    questions: [],
    limitations: [],
    receipts: [],
  });
  await Promise.all(app.operations);
  const completed = await app.store.getJob(id);
  await app.store.updateJobProgress(id, { stage: "checking_report", readCount: 2 });
  assert.deepEqual(await app.store.getJob(id), completed);
  assert.equal(completed.status, "completed");
  assert.equal(completed.result.revision, 2);
});

test("rich v2 chat answers larger than the old 48KB budget persist through two turns and a frontend reload", async (t) => {
  const rich = {
    reportVersion: "securities-report-v2",
    summary: "Synthetic rich answer summary.",
    claims: [
      {
        id: "fixture-answer",
        kind: "source_fact",
        text: "A synthetic answer with extensive evidence metadata.",
      },
    ],
    research: {
      status: "limited",
      gaps: [],
      steps: Array.from({ length: 6 }, (_, read) => ({
        id: `read-${read + 1}`,
        sourceId: "fixture-source",
        sourceVersion: "1",
        status: "read",
        pageQuality: Array.from({ length: 83 }, (_, page) => ({
          page: page + 1,
          method: "text",
          status: "extracted_unreviewed",
          qualityFlags: ["synthetic-unreviewed-source-text", "text-presence-is-not-verification"],
          textCharacters: 1800,
        })),
      })),
    },
    questions: [],
    limitations: [],
    receipts: [],
  };
  assert.ok(Buffer.byteLength(JSON.stringify(rich)) > 48_000);
  const app = setup(t, { live: true, model: async () => structuredClone(rich) });
  const dossier = await app.create();
  for (const [index, question] of [
    "Explain these results.",
    "How does that relate to cash flow?",
  ].entries()) {
    const response = await app.request(`/dossiers/${dossier.id}/chat`, {
      revision: 1,
      question,
      requestId: `rich-conversation-${index}`,
    });
    assert.equal(response.status, 202);
    await Promise.all(app.operations);
  }
  const reloadedStore = createSecuritiesStore(app.env.SECURITIES_DB);
  const restored = await reloadedStore.get(dossier.id, 1);
  assert.equal(restored.chat.length, 4);
  assert.equal(restored.chatHistoryTruncated, false);
  assert.deepEqual(restored.chat[1].answer.research, rich.research);
  assert.deepEqual(restored.chat[3].answer.research, rich.research);
  assert.equal(app.calls[1].history.length, 1);
  assert.equal(app.calls[1].historyTruncated, false);
  assert.equal(JSON.stringify(app.calls[1].history).includes("pageQuality"), false);
  const client = createSecuritiesClient({
    fetchImpl: () => app.request(`/dossiers/${dossier.id}?revision=1`),
  });
  const browserReadback = await client.request(`/dossiers/${dossier.id}?revision=1`);
  assert.equal(browserReadback.dossier.chat.length, 4);
  assert.deepEqual(browserReadback.dossier.chat[3].answer.research, rich.research);
});

test("oversized narrative history retains the complete displayed answer while giving the model an explicit bounded context", async (t) => {
  const narrative = "Bằng chứng tài chính được kiểm tra từ hồ sơ. 📊 ".repeat(75);
  const answer = {
    summary: "Synthetic long narrative",
    claims: Array.from({ length: 14 }, (_, index) => ({ id: `claim-${index}`, text: narrative })),
    research: { status: "limited", steps: [], gaps: [] },
    questions: [],
    limitations: [],
    receipts: [],
  };
  assert.ok(Buffer.byteLength(answer.claims.map((claim) => claim.text).join("\n")) > 48_000);
  const app = setup(t, { live: true, model: async () => structuredClone(answer) });
  const dossier = await app.create();
  await app.request(`/dossiers/${dossier.id}/chat`, {
    revision: 1,
    question: "Synthetic long first turn",
    requestId: "narrative-history-first",
  });
  await Promise.all(app.operations);
  await app.request(`/dossiers/${dossier.id}/chat`, {
    revision: 1,
    question: "Follow up on the last turn",
    requestId: "narrative-history-second",
  });
  await Promise.all(app.operations);
  const options = app.calls[1];
  assert.equal(options.history.length, 1);
  assert.equal(options.historyTruncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(options.history)) <= 48_000);
  assert.match(options.history[0].assistant, /Earlier answer context truncated/u);
  assert.doesNotMatch(options.history[0].assistant, /\uFFFD/u);
  assert.deepEqual(normalizeSecuritiesHistory(options.history, dossier), options.history);
  assert.equal((await app.store.get(dossier.id)).chat[1].answer.claims[0].text, narrative);
});

test("source evidence adapter binds exact document identity and exposes only the authenticated local packet", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "securities-evidence-api-"));
  const hash = "a".repeat(64);
  const source = { id: "fixture-source", version: `sha256:${hash}`, hash };
  const token = "synthetic-local-ingestion-token-" + "x".repeat(32);
  const calls = [];
  const service = await startSecuritiesIngestionService({
    token,
    directory,
    collect: async () => ({ datasets: [] }),
    readEvidence: async (input) => {
      calls.push(input);
      if (input.query === "too-large")
        throw Object.assign(new Error("source_evidence_response_too_large"), { status: 413 });
      return {
        sourceId: source.id,
        sourceVersion: source.version,
        sourceHash: input.query === "wrong-identity" ? "b".repeat(64) : hash,
        passages: [
          {
            id: "synthetic-passage",
            text: "Synthetic local evidence, not a real company result.",
            locator: { page: 3, precision: "page" },
          },
        ],
        coverage: { searchedPageCount: 1 },
        receipt: { evidenceType: "local_original", fixture: "synthetic_api_test" },
      };
    },
  });
  t.after(async () => {
    await service.close();
    rmdirSync(directory);
  });
  const app = setup(t);
  Object.assign(app.env, {
    SECURITIES_INGESTION_URL: service.url,
    SECURITIES_INGESTION_TOKEN: token,
  });
  const evidence = await readSecuritiesEvidence(
    { sourceId: source.id, sourceVersion: source.version, query: "", pages: [3] },
    { env: app.env, allowedSources: [source] },
  );
  assert.equal(evidence.passages[0].id, "synthetic-passage");
  assert.equal(calls.length, 1);
  await assert.rejects(
    readSecuritiesEvidence(
      { sourceId: "other-source", sourceVersion: source.version, pages: [3] },
      { env: app.env, allowedSources: [source] },
    ),
    { code: "source_context_mismatch" },
  );
  assert.equal(
    calls.length,
    1,
    "A source outside the selected dossier never reaches the collector.",
  );
  await assert.rejects(
    readSecuritiesEvidence(
      { sourceId: source.id, sourceVersion: source.version, query: "wrong-identity" },
      { env: app.env },
    ),
    { code: "source_service_invalid_response" },
  );
  const response = await app.request("/sources/evidence", {
    sourceId: source.id,
    sourceVersion: source.version,
    query: "cash flow",
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.evidence.sourceHash, hash);
  assert.equal(JSON.stringify(body).includes(token), false);
  const tooLarge = await app.request("/sources/evidence", {
    sourceId: source.id,
    sourceVersion: source.version,
    query: "too-large",
  });
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).error.code, "source_evidence_response_too_large");
});

test("workerd sends model requests and rejects redirects without following them", async (t) => {
  const model = "meta/muse-spark-1.3-contributor";
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push(request.url);
    for await (const chunk of request) {
      void chunk;
    }
    if (request.url.endsWith("redirect")) {
      response.writeHead(302, { location: "/unexpected-follow" });
      response.end();
      return;
    }
    const payload =
      request.url === "/metadata"
        ? {
            data: {
              id: model,
              endpoints: [
                {
                  model_id: model,
                  provider_name: "Synthetic provider",
                  supported_parameters: ["tools", "tool_choice", "response_format"],
                },
              ],
            },
          }
        : {
            id: "gen-workerd-fixture",
            model,
            provider: "Meta",
            choices: [
              {
                finish_reason: "stop",
                message: { role: "assistant", content: JSON.stringify({ fixture: true }) },
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 },
            openrouter_metadata: {
              requested: model,
              strategy: "direct",
              endpoints: { available: [{ provider: "Meta", model, selected: true }] },
            },
          };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const target = `http://127.0.0.1:${server.address().port}`;
  const modules = Object.fromEntries(
    [
      "worker/securities/model-transport.js",
      "worker/securities/model-contract.js",
      "shared/securities/source-contract.js",
      "shared/securities/finance.js",
    ].map((name) => [
      name,
      { type: "esm", contents: readFileSync(new URL(`../../${name}`, import.meta.url), "utf8") },
    ]),
  );
  modules["test.mjs"] = {
    type: "esm",
    contents: `
    import { requestSecuritiesModel, readSecuritiesModelCapabilities } from './worker/securities/model-transport.js';
    export default { async fetch(request) {
      const path = new URL(request.url).pathname;
      // The only transport destination is the loopback fixture server. No real
      // credential, public provider endpoint or paid request is used here.
      const fetchImpl = (_url, options) => globalThis.fetch(${JSON.stringify(target)} + path, options);
      try {
        if (path.startsWith('/metadata')) {
          const result = await readSecuritiesModelCapabilities({ fetchImpl });
          return Response.json({ ok: true, capable: result.capable, model: result.model });
        }
        const result = await requestSecuritiesModel({
          env: { SECURITIES_MODEL_MODE: 'live', SECURITIES_OPENROUTER_API_KEY: 'sk-or-v1-workerd-synthetic-test-token' },
          fetchImpl, schema: { type: 'object' }, schemaName: 'runtime_fixture',
          messages: [{ role: 'user', content: 'Synthetic runtime transport check.' }], timeoutMs: 5000,
        });
        return Response.json({ ok: true, output: result.output, receipt: result.receipt });
      } catch (error) { return Response.json({ ok: false, code: error.code, receipts: error.receipts ?? [] }); }
    } };
  `,
  };
  const require = createRequire(
    realpathSync(new URL("../../node_modules/wrangler/package.json", import.meta.url)),
  );
  const { Miniflare } = require("miniflare");
  const runtime = new Miniflare({
    host: "127.0.0.1",
    cf: false,
    logRequests: false,
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: "securities-transport-test",
          type: "worker",
          compatibilityDate: "2026-09-04",
          compatibilityFlags: ["enable_request_signal"],
          manifest: { mainModule: "test.mjs", modules },
        },
      },
    ],
  });
  t.after(() => runtime.dispose());
  const run = async (path) => (await runtime.dispatchFetch(`http://localhost${path}`)).json();
  const successful = await run("/completion");
  assert.equal(successful.ok, true);
  assert.deepEqual(successful.output, { fixture: true });
  assert.equal(successful.receipt.evidenceType, "fixture");
  assert.equal(successful.receipt.actualModel, model);
  const redirect = await run("/completion-redirect");
  assert.equal(redirect.ok, false);
  assert.equal(redirect.code, "provider_redirect_rejected");
  assert.equal(redirect.receipts[0].httpStatus, 302);
  const metadata = await run("/metadata");
  assert.deepEqual(metadata, { ok: true, capable: true, model });
  const metadataRedirect = await run("/metadata-redirect");
  assert.equal(metadataRedirect.ok, false);
  assert.equal(metadataRedirect.code, "model_metadata_redirect_rejected");
  assert.deepEqual(requests, [
    "/completion",
    "/completion-redirect",
    "/metadata",
    "/metadata-redirect",
  ]);
});
