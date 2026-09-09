import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startSecuritiesIngestionService } from "../../scripts/securities/ingestion-service.mjs";
import { handleSecuritiesIngestion } from "../../worker/securities/ingestion.js";

// All collectors and document bodies in this suite are synthetic development
// fixtures. HTTP requests stay on the suite-owned loopback server; no financial
// website, model, OCR, production resource, or real credential is used.
const FIXTURE_TOKEN = "synthetic_ingestion_fixture_token_only";
const QA_ROOT = fileURLToPath(new URL("../../../output/securities/qa/", import.meta.url));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function localService(
  t,
  { collect = async () => ({ datasets: [], evidenceType: "fixture" }), ...options } = {},
) {
  await mkdir(QA_ROOT, { recursive: true });
  const directory = await mkdtemp(path.join(QA_ROOT, "ingestion-fixture-"));
  const service = await startSecuritiesIngestionService({
    token: FIXTURE_TOKEN,
    directory,
    collect,
    ...options,
  });
  t.after(async () => {
    await service.close();
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${path.resolve(QA_ROOT)}${path.sep}`));
    await rm(resolved, { recursive: true, force: true });
  });
  return { ...service, directory };
}

async function request(
  service,
  pathname,
  { method = "GET", body, headers = {}, authenticated = true } = {},
) {
  const response = await fetch(`${service.url}${pathname}`, {
    method,
    headers: {
      ...(authenticated ? { Authorization: `Bearer ${FIXTURE_TOKEN}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}

async function waitForJob(service, id, predicate) {
  const deadline = Date.now() + 2000;
  let current;
  while (Date.now() < deadline) {
    current = await request(service, `/jobs/${id}`);
    if (predicate(current.data.job)) return current.data.job;
    await delay(10);
  }
  assert.fail(`Fixture job did not reach the required state: ${JSON.stringify(current?.data)}`);
}

function rawRequest(service, pathname, { body, headers = {}, chunks } = {}) {
  assert.equal(new URL(service.url).hostname, "127.0.0.1");
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      `${service.url}${pathname}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FIXTURE_TOKEN}`,
          "Content-Type": "application/json",
          ...headers,
        },
      },
      (incoming) => {
        let text = "";
        incoming.on("data", (chunk) => {
          text += chunk;
        });
        incoming.on("end", () => {
          try {
            resolve({ status: incoming.statusCode, data: JSON.parse(text) });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    outgoing.on("error", reject);
    if (chunks) chunks(outgoing);
    else outgoing.end(JSON.stringify(body));
  });
}

test("ingestion security fixture: bearer authentication, browser origins, and Host are checked before collection", async (t) => {
  let calls = 0;
  const service = await localService(t, {
    collect: async () => {
      calls += 1;
      return { datasets: [] };
    },
  });
  const payload = { companyId: "FPT", requestId: "auth-fixture-request" };
  assert.equal(
    (await request(service, "/jobs", { method: "POST", body: payload, authenticated: false }))
      .status,
    401,
  );
  assert.equal(
    (
      await request(service, "/jobs", {
        method: "POST",
        body: payload,
        headers: { Authorization: "Bearer invalid" },
      })
    ).status,
    401,
  );
  for (const origin of ["null", "https://attacker.invalid", service.url]) {
    const result = await request(service, "/jobs", {
      method: "POST",
      body: payload,
      headers: { Origin: origin },
    });
    assert.equal(result.status, 403);
    assert.equal(result.data.error, "browser_origin_not_allowed");
  }
  // Fetch may normalize Host. Send the hostile header on the actual HTTP wire.
  const hostileHost = await rawRequest(service, "/jobs", {
    body: payload,
    headers: { Host: "attacker.invalid" },
  });
  assert.equal(hostileHost.status, 403);
  assert.equal(calls, 0);
});

test("retired comparison preparation routes cannot execute or mutate retained jobs", async (t) => {
  let calls = 0;
  const service = await localService(t, {
    collect: async () => {
      calls += 1;
      return { datasets: [] };
    },
  });
  const id = "retained-preparation-fixture";
  const retainedDirectory = path.join(service.directory, "comparison-preparations");
  await mkdir(retainedDirectory);
  const retainedFile = path.join(retainedDirectory, `${id}.json`);
  const retainedBytes = JSON.stringify({
    id,
    status: "running",
    result: { evidenceType: "synthetic retained historical data" },
  });
  await writeFile(retainedFile, retainedBytes);
  for (const [pathname, options] of [
    ["/comparison-preparations", { method: "POST", body: { requestId: id } }],
    [`/comparison-preparations/${id}`, {}],
    [
      `/comparison-preparations/${id}/cancel`,
      { method: "POST", body: { requestId: "retired-cancel-fixture" } },
    ],
  ]) {
    const result = await request(service, pathname, options);
    assert.equal(result.status, 404);
    assert.equal(result.data.error, "not_found");
  }
  assert.equal(calls, 0);
  assert.equal(await readFile(retainedFile, "utf8"), retainedBytes);
});

test("ingestion security fixture: malformed identifier types and extra fields cannot start a collector", async (t) => {
  let calls = 0;
  const service = await localService(t, {
    collect: async () => {
      calls += 1;
      return { datasets: [] };
    },
  });
  for (const payload of [
    { companyId: ["FPT"], requestId: "array-company-request" },
    { companyId: "FPT", requestId: ["array-request-identifier"] },
    { companyId: "FPT", requestId: "extra-field-request", url: "http://169.254.169.254/metadata" },
  ]) {
    const result = await request(service, "/jobs", { method: "POST", body: payload });
    assert.equal(result.status, 400);
    assert.equal(result.data.error, "invalid_input");
  }
  assert.equal(calls, 0);
});

test("ingestion security fixture: simultaneous duplicate requests share one job and one collector", async (t) => {
  const gate = deferred();
  let calls = 0;
  const service = await localService(t, {
    collect: async () => {
      calls += 1;
      return gate.promise;
    },
  });
  t.after(() => gate.resolve({ datasets: [], evidenceType: "fixture" }));
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      request(service, "/jobs", {
        method: "POST",
        body: { companyId: "FPT", requestId: "duplicate-fixture-request" },
      }),
    ),
  );
  for (const result of results) {
    assert.ok(
      [200, 202].includes(result.status),
      `Expected an idempotent replay, received ${JSON.stringify(result)}`,
    );
    assert.equal(result.data.job.id, "duplicate-fixture-request");
  }
  assert.equal(calls, 1);
  const conflict = await request(service, "/jobs", {
    method: "POST",
    body: { companyId: "GMD", requestId: "duplicate-fixture-request" },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.error, "idempotency_conflict");
  gate.resolve({ datasets: [], evidenceType: "fixture" });
});

test("ingestion security fixture: cancelling a job prevents a late collector result from replacing persisted cancellation", async (t) => {
  const gate = deferred();
  let collectorSignal;
  const service = await localService(t, {
    collect: async ({ signal }) => {
      collectorSignal = signal;
      return gate.promise;
    },
  });
  t.after(() => gate.resolve({ datasets: [], evidenceType: "fixture" }));
  const id = "cancel-fixture-request";
  assert.equal(
    (await request(service, "/jobs", { method: "POST", body: { companyId: "FPT", requestId: id } }))
      .status,
    202,
  );
  const cancel = await request(service, `/jobs/${id}/cancel`, {
    method: "POST",
    body: { requestId: "cancel-fixture-confirm" },
  });
  assert.equal(cancel.data.job.status, "cancelled");
  assert.equal(collectorSignal.aborted, true);
  gate.resolve({
    datasets: [{ synthetic: "late result must be discarded" }],
    evidenceType: "fixture",
  });
  await delay(10);
  const job = await waitForJob(service, id, (value) => value?.status === "cancelled");
  assert.equal(job.result, null);
  assert.equal(
    JSON.parse(await readFile(path.join(service.directory, `${id}.json`), "utf8")).status,
    "cancelled",
  );
});

test("ingestion security fixture: timeout becomes a persisted terminal failure even when the collector ignores abort", async (t) => {
  const gate = deferred();
  let collectorSignal;
  const service = await localService(t, {
    jobTimeoutMs: 25,
    collect: async ({ signal }) => {
      collectorSignal = signal;
      return gate.promise;
    },
  });
  t.after(() => gate.resolve({ datasets: [], evidenceType: "fixture" }));
  const id = "timeout-fixture-request";
  await request(service, "/jobs", { method: "POST", body: { companyId: "FPT", requestId: id } });
  const timedOut = await waitForJob(service, id, (job) => job?.status === "failed");
  assert.equal(timedOut.error.code, "source_job_timeout");
  assert.equal(collectorSignal.aborted, true);
  gate.resolve({ datasets: [{ synthetic: "late timed-out result" }], evidenceType: "fixture" });
  await delay(10);
  const final = await request(service, `/jobs/${id}`);
  assert.equal(final.data.job.status, "failed");
  assert.equal(final.data.job.error.code, "source_job_timeout");
  assert.equal(final.data.job.result, null);
});

test("ingestion security fixture: a slow cancellation body cannot overwrite an already completed job", async (t) => {
  const gate = deferred();
  const service = await localService(t, { collect: async () => gate.promise });
  t.after(() => gate.resolve({ datasets: [], evidenceType: "fixture" }));
  const id = "slow-cancel-fixture";
  await request(service, "/jobs", { method: "POST", body: { companyId: "FPT", requestId: id } });
  let completeBody;
  const cancellation = rawRequest(service, `/jobs/${id}/cancel`, {
    chunks(outgoing) {
      outgoing.write("{");
      completeBody = () => outgoing.end('"requestId":"slow-cancel-confirm"}');
    },
  });
  // Deliver the cancellation headers and first body byte, while its payload is
  // intentionally incomplete, then finish collection before ending that body.
  await delay(30);
  gate.resolve({ datasets: [], evidenceType: "fixture", completedMarker: "retained" });
  await waitForJob(service, id, (job) => job?.status === "partial");
  completeBody();
  const cancelled = await cancellation;
  assert.equal(cancelled.data.job.status, "partial");
  assert.equal(cancelled.data.job.result.completedMarker, "retained");
});

test("ingestion security fixture: oversized request bodies are rejected before collection", async (t) => {
  let calls = 0;
  const service = await localService(t, {
    collect: async () => {
      calls += 1;
      return { datasets: [] };
    },
  });
  const result = await request(service, "/jobs", {
    method: "POST",
    body: { companyId: "FPT", requestId: "oversized-body-fixture", padding: "x".repeat(5000) },
  });
  assert.equal(result.status, 413);
  assert.equal(result.data.error, "request_too_large");
  assert.equal(calls, 0);
});

test("ingestion security fixture: collector errors never echo the configured service token", async (t) => {
  const service = await localService(t, {
    collect: async () => {
      throw new Error(FIXTURE_TOKEN);
    },
  });
  const id = "error-echo-fixture";
  await request(service, "/jobs", { method: "POST", body: { companyId: "FPT", requestId: id } });
  const job = await waitForJob(service, id, (value) => value?.status === "failed");
  assert.equal(JSON.stringify(job).includes(FIXTURE_TOKEN), false);
  assert.equal(job.error.code, "source_processing_failed");
});

test("ingestion security fixture: oversized collector results fail with a bounded public error", async (t) => {
  const service = await localService(t, {
    collect: async () => ({ datasets: [], synthetic: "x".repeat(6_000_001) }),
  });
  const id = "oversized-result-fixture";
  await request(service, "/jobs", { method: "POST", body: { companyId: "FPT", requestId: id } });
  const job = await waitForJob(service, id, (value) => value?.status === "failed");
  assert.equal(job.error.code, "source_result_too_large");
  assert.equal(job.result, null);
  assert.ok(JSON.stringify(job).length < 2000);
});

test("ingestion security fixture: prior interrupted jobs become explicit failures on restart", async (t) => {
  const service = await localService(t);
  const id = "interrupted-source-fixture";
  await writeFile(
    path.join(service.directory, `${id}.json`),
    JSON.stringify({
      id,
      companyId: "FPT",
      status: "running",
      startedAt: "2026-09-06T00:00:00.000Z",
      result: null,
    }),
  );
  const result = await request(service, `/jobs/${id}`);
  assert.equal(result.data.job.status, "failed");
  assert.equal(result.data.job.error.code, "source_job_interrupted");
});

test("ingestion security fixture: Worker bridge rejects non-loopback, credential-bearing and path-bearing service targets before network", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    throw new Error("Unexpected fixture network request");
  });
  for (const target of [
    "https://127.0.0.1:8789",
    "http://localhost:8789",
    "http://169.254.169.254:80",
    "http://127.0.0.1:8789/other",
    "http://user:password@127.0.0.1:8789",
    "http://127.0.0.1:8789/?secret=value",
  ]) {
    const env = {
      SECURITIES_LOCAL_MODE: "true",
      SECURITIES_INGESTION_TOKEN: FIXTURE_TOKEN,
      SECURITIES_INGESTION_URL: target,
    };
    await assert.rejects(
      () =>
        handleSecuritiesIngestion(
          new Request("http://127.0.0.1:8788/api/securities/sources/jobs/fixture-job-request"),
          env,
        ),
      { code: "source_service_unavailable" },
    );
  }
  assert.equal(calls, 0);
});

test("ingestion security fixture: Worker bridge rejects redirects from the privileged local service", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls += 1;
    assert.equal(options.redirect, "manual");
    return new Response(null, {
      status: 302,
      headers: { Location: "http://169.254.169.254/metadata" },
    });
  });
  const env = {
    SECURITIES_LOCAL_MODE: "true",
    SECURITIES_INGESTION_TOKEN: FIXTURE_TOKEN,
    SECURITIES_INGESTION_URL: "http://127.0.0.1:8789",
  };
  await assert.rejects(
    () =>
      handleSecuritiesIngestion(
        new Request("http://127.0.0.1:8788/api/securities/sources/jobs/fixture-job-request"),
        env,
      ),
    { code: "source_service_redirect_rejected" },
  );
  assert.equal(calls, 1);
});
