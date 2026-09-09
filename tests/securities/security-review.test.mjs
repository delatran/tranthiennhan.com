import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import https from "node:https";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import {
  assertApprovable,
  applyModelAnalysis,
  createDossier,
  reviseDossier,
  replaceDossierSources,
} from "../../shared/securities/dossier.js";
import {
  buildModelSnapshot,
  validateSecuritiesAnalysis,
} from "../../worker/securities/model-contract.js";
import {
  readBoundedProviderJson,
  readSecuritiesModelCapabilities,
  requestSecuritiesModel,
} from "../../worker/securities/model-transport.js";
import { createSecuritiesStore } from "../../worker/securities/store.js";
import {
  assertSecuritiesLocalRequest,
  assertSecuritiesMutationRateLimit,
} from "../../worker/securities/local.js";
import { createSecuritiesXlsx } from "../../worker/securities/export.js";
import { handleSecuritiesRequest } from "../../worker/securities/api.js";
import {
  discoverSecuritiesDocuments,
  fetchSecuritiesSource,
  validateSecuritiesSourceUrl,
} from "../../worker/securities/sources.js";
import {
  isPublicSourceAddress,
  nodeSecuritiesFetch,
} from "../../scripts/securities/source-network.mjs";

// These are adversarial development fixtures. Their values, hashes and source
// excerpts are synthetic; they are not source receipts or model-quality proof.
const FIXTURE_TIME = "2026-09-06T00:00:00.000Z";
const FIXTURE_KEY = ["sk", "or", "synthetic_security_fixture_only"].join("-");
const FIXTURE_MODEL = "meta/muse-spark-1.3-contributor";

function sourcePoint(value) {
  return {
    value,
    sourceId: "fixture-report",
    sourceVersion: "fixture-v1",
    verification: "verified",
    locator: {
      precision: "table",
      page: 1,
      table: "Synthetic test table",
      rowLabel: "Synthetic revenue",
    },
  };
}

function fixtureDossier({ durationMonths = 12 } = {}) {
  return createDossier(
    {
      company: { id: "FPT", ticker: "FPT", name: "Synthetic security test company" },
      period: { id: "FY2025", kind: "annual", scope: "consolidated", durationMonths: 12 },
      comparisonPeriod: { id: "FY2024", kind: "annual", scope: "consolidated", durationMonths },
      sources: [
        {
          id: "fixture-report",
          version: "fixture-v1",
          hash: "a".repeat(64),
          url: "https://fpt.com/api/media/synthetic-security-fixture.pdf",
          title: "Synthetic security fixture; not an actual company report",
          excerpt: "The synthetic report describes the change in revenue.",
        },
      ],
      metrics: [
        {
          id: "revenue",
          label: { en: "Revenue", vi: "Doanh thu" },
          unit: "VND_billion",
          current: sourcePoint(120),
          comparison: sourcePoint(100),
        },
      ],
    },
    { id: "security-fixture", locale: "en", now: FIXTURE_TIME },
  );
}

function approval(revision = 1) {
  return {
    expectedRevision: revision,
    requestId: "security-approval",
    intent: "approve_exact_revision",
  };
}

function validModelOutput(dossier) {
  return {
    dossierId: dossier.id,
    revision: dossier.revision,
    claims: [
      {
        id: "fixture-change",
        kind: "calculated",
        text: "Revenue changed by {{metric:revenue:absoluteChange}}.",
        sourceIds: ["fixture-report"],
        metricIds: ["revenue"],
        evidenceQuotes: [],
      },
    ],
    questions: [],
    limitations: [],
  };
}

test("security fixture: approval rejects incompatible duration even when period kind and scope match", () => {
  const dossier = fixtureDossier({ durationMonths: 6 });
  assert.equal(dossier.metrics[0].calculation.absoluteChange.status, "incompatible_periods");
  assert.throws(() => assertApprovable(dossier, approval()), {
    code: "material_issues_unresolved",
  });
});

test("security fixture: corrections preserve original and prior value, and unreviewed corrections block approval", () => {
  const initial = fixtureDossier();
  const first = reviseDossier(
    initial,
    {
      expectedRevision: 1,
      requestId: "security-correction-one",
      changes: [
        {
          metricId: "revenue",
          periodId: "FY2025",
          value: 121,
          reason: "Synthetic test correction",
          sourceChecked: false,
        },
      ],
    },
    { now: FIXTURE_TIME, correctionId: () => "fixture-correction-one" },
  );
  assert.equal(initial.revision, 1);
  assert.equal(initial.metrics[0].current.value, 120);
  assert.equal(first.originalMetrics[0].current.value, 120);
  assert.equal(first.corrections[0].previousValue, 120);
  assert.throws(() => assertApprovable(first, approval(2)), { code: "material_issues_unresolved" });

  const second = reviseDossier(
    first,
    {
      expectedRevision: 2,
      requestId: "security-correction-two",
      changes: [
        {
          metricId: "revenue",
          periodId: "FY2025",
          value: 122,
          reason: "Checked the synthetic fixture",
          sourceChecked: true,
        },
      ],
    },
    { now: FIXTURE_TIME, correctionId: () => "fixture-correction-two" },
  );
  assert.equal(second.originalMetrics[0].current.value, 120);
  assert.equal(second.corrections[1].originalValue, 120);
  assert.equal(second.corrections[1].previousValue, 121);
  assert.equal(second.corrections[1].sourceVersion, "fixture-v1");
  assert.equal(second.metrics[0].current.verification, "user_verified");
  assert.equal(assertApprovable(second, approval(3)), true);
});

test("security fixture: stale corrections and forged approval fields leave the current dossier untouched", () => {
  const dossier = fixtureDossier();
  const original = structuredClone(dossier);
  assert.throws(
    () =>
      reviseDossier(dossier, {
        expectedRevision: 2,
        requestId: "security-stale-request",
        notes: "A stale local edit",
      }),
    { code: "revision_conflict" },
  );
  assert.throws(() => assertApprovable(dossier, { ...approval(), approved: true }), {
    code: "invalid_input",
  });
  assert.throws(() => assertApprovable(dossier, { ...approval(), intent: "true" }), {
    code: "explicit_approval_required",
  });
  assert.deepEqual(dossier, original);
});

test("security fixture: generated missing-evidence issues cannot be acknowledged away", () => {
  const dossier = fixtureDossier();
  dossier.metrics[0].current.verification = "needs_review";
  assert.throws(
    () =>
      reviseDossier(dossier, {
        expectedRevision: 1,
        requestId: "security-forged-resolution",
        resolutions: [
          {
            issueId: "revenue-current-verification",
            reason: "Ignore this synthetic missing evidence",
          },
        ],
      }),
    { code: "issue_requires_evidence" },
  );
  assert.throws(() => assertApprovable(dossier, approval()), {
    code: "material_issues_unresolved",
  });
});

test("security fixture: the valid model control renders server arithmetic and rejects invented numeric literals", () => {
  const dossier = fixtureDossier();
  const output = validModelOutput(dossier);
  assert.match(validateSecuritiesAnalysis(output, dossier, "en").claims[0].text, /20 VND billion/u);
  for (const literal of ["999", "９９９", "٩٩٩", "⑨⑨⑨"]) {
    const invalid = structuredClone(output);
    invalid.claims[0].text = `Revenue changed by ${literal} billion.`;
    assert.throws(() => validateSecuritiesAnalysis(invalid, dossier), {
      code: "model_unbound_numeric_output",
    });
  }
});

test("security fixture: model outputs cannot add executable tools or silently cross a dossier revision", () => {
  const dossier = fixtureDossier();
  const output = validModelOutput(dossier);
  assert.throws(
    () => validateSecuritiesAnalysis({ ...output, tools: [{ name: "read_secret" }] }, dossier),
    { code: "model_invalid_output" },
  );
  assert.throws(() => validateSecuritiesAnalysis({ ...output, revision: 2 }, dossier), {
    code: "model_invalid_output",
  });
  const undeclaredMetric = structuredClone(output);
  undeclaredMetric.claims[0].metricIds = [];
  assert.throws(() => validateSecuritiesAnalysis(undeclaredMetric, dossier), {
    code: "model_invalid_metric_binding",
  });
});

test("security fixture: a changed source version invalidates otherwise verified model numeric evidence", () => {
  const dossier = fixtureDossier();
  dossier.sources[0].version = "fixture-v2";
  assert.throws(() => validateSecuritiesAnalysis(validModelOutput(dossier), dossier), {
    code: "model_invalid_source_binding",
  });
});

test("security fixture: fabricated source quotes and oversized evidence fail closed without truncating", () => {
  const dossier = fixtureDossier();
  const output = validModelOutput(dossier);
  output.claims[0] = {
    id: "fixture-forged-quote",
    kind: "source_fact",
    text: "This is an unsupported source claim.",
    sourceIds: ["fixture-report"],
    metricIds: [],
    evidenceQuotes: [
      {
        sourceId: "fixture-report",
        quote: "This fabricated sentence does not occur in the source.",
      },
    ],
  };
  assert.throws(() => validateSecuritiesAnalysis(output, dossier), {
    code: "model_unverified_quote",
  });
  dossier.sources[0].extractedText = "synthetic evidence ".repeat(20_000);
  assert.throws(() => buildModelSnapshot(dossier), { code: "model_context_too_large" });
});

function providerResult(overrides = {}) {
  return {
    id: "synthetic-generation-id",
    model: FIXTURE_MODEL,
    provider: "SyntheticFixtureProvider",
    choices: [{ finish_reason: "stop", message: { role: "assistant", content: "{}" } }],
    ...overrides,
  };
}

function providerResponse(result, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(result), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function modelRequest(fetchImpl, options = {}) {
  return requestSecuritiesModel({
    env: { SECURITIES_MODEL_MODE: "live", SECURITIES_OPENROUTER_API_KEY: FIXTURE_KEY },
    messages: [{ role: "user", content: "Synthetic transport boundary test; no remote request." }],
    schema: { type: "object", additionalProperties: false, properties: {} },
    schemaName: "security_fixture",
    fetchImpl,
    timeoutMs: 1000,
    ...options,
  });
}

test("security fixture: non-text and oversized model requests fail before credentials or transport are used", async () => {
  let credentialReads = 0,
    calls = 0;
  const env = {
    SECURITIES_MODEL_MODE: "live",
    get SECURITIES_OPENROUTER_API_KEY() {
      credentialReads += 1;
      return FIXTURE_KEY;
    },
  };
  const fetchImpl = async () => {
    calls += 1;
    return providerResponse(providerResult());
  };
  for (const [content, code] of [
    [
      [{ type: "image_url", image_url: { url: "https://example.invalid/unsupported.png" } }],
      "invalid_model_request",
    ],
    ["x".repeat(300_001), "model_context_too_large"],
  ])
    await assert.rejects(
      () => modelRequest(fetchImpl, { env, messages: [{ role: "user", content }] }),
      { code },
    );
  assert.equal(credentialReads, 0);
  assert.equal(calls, 0);
  const result = await modelRequest(fetchImpl, {
    env,
    messages: [{ role: "user", content: [{ type: "text", text: "Synthetic dossier text." }] }],
  });
  assert.deepEqual(result.output, {});
  assert.equal(calls, 1);
  assert.ok(credentialReads > 0);
});

test("security fixture: model transport fixes the exact model, disables fallback and confines the key to the server header", async () => {
  let requests = 0;
  const result = await modelRequest(async (url, init) => {
    requests += 1;
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(init.redirect, "manual");
    const body = JSON.parse(init.body);
    assert.equal(body.model, FIXTURE_MODEL);
    assert.equal(body.provider.allow_fallbacks, false);
    assert.deepEqual(body.tools, []);
    assert.equal(body.tool_choice, "none");
    assert.equal(init.headers.Authorization, `Bearer ${FIXTURE_KEY}`);
    assert.equal(init.body.includes(FIXTURE_KEY), false);
    return providerResponse(providerResult());
  });
  assert.equal(requests, 1);
  assert.equal(result.receipt.actualModel, FIXTURE_MODEL);
  assert.equal(result.receipt.evidenceType, "fixture");
  assert.equal(result.receipt.costUsd, null);
  assert.equal(result.receipt.costStatus, "unknown");
});

test("security fixture: model and capability redirects are cancelled without forwarding credentials or reflecting locations", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
    let cancelled = false;
    const observedReceipts = [];
    await assert.rejects(
      () =>
        modelRequest(
          async (url, init) => {
            calls += 1;
            assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
            assert.equal(init.redirect, "manual");
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(`Synthetic redirect body ${FIXTURE_KEY}`),
                  );
                },
                cancel() {
                  cancelled = true;
                },
              }),
              {
                status,
                headers: {
                  Location: `https://attacker.invalid/${FIXTURE_KEY}`,
                  "X-Generation-ID": FIXTURE_KEY,
                },
              },
            );
          },
          { onReceipt: (receipt) => observedReceipts.push(receipt) },
        ),
      (error) => {
        assert.equal(error.code, "provider_redirect_rejected");
        assert.equal(error.receipts.length, 1);
        assert.equal(error.receipts[0].requestId, null);
        assert.equal(JSON.stringify(error.receipts).includes(FIXTURE_KEY), false);
        assert.equal(JSON.stringify(error.receipts).includes("attacker.invalid"), false);
        return true;
      },
    );
    assert.equal(calls, 1);
    assert.equal(cancelled, true);
    assert.equal(JSON.stringify(observedReceipts).includes(FIXTURE_KEY), false);

    let metadataCalls = 0;
    let metadataCancelled = false;
    await assert.rejects(
      () =>
        readSecuritiesModelCapabilities({
          fetchImpl: async (url, init) => {
            metadataCalls += 1;
            assert.equal(url, `https://openrouter.ai/api/v1/models/${FIXTURE_MODEL}/endpoints`);
            assert.equal(init.redirect, "manual");
            assert.equal(init.headers, undefined);
            return new Response(
              new ReadableStream({
                cancel() {
                  metadataCancelled = true;
                },
              }),
              {
                status,
                headers: { Location: "http://127.0.0.1/private-fixture" },
              },
            );
          },
        }),
      { code: "model_metadata_redirect_rejected" },
    );
    assert.equal(metadataCalls, 1);
    assert.equal(metadataCancelled, true);
  }
});

test("security fixture: provider errors and identifiers cannot reflect the configured key through receipts", async () => {
  let calls = 0;
  const observedReceipts = [];
  await assert.rejects(
    () =>
      modelRequest(
        async () => {
          calls += 1;
          return providerResponse(
            {
              id: FIXTURE_KEY,
              error: { code: 402, message: `Synthetic malicious error echo ${FIXTURE_KEY}` },
            },
            { status: 402 },
          );
        },
        { onReceipt: (receipt) => observedReceipts.push(receipt) },
      ),
    (error) => {
      assert.equal(error.code, "provider_secret_echo");
      assert.equal(JSON.stringify(error.receipts).includes(FIXTURE_KEY), false);
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(observedReceipts).includes(FIXTURE_KEY), false);
});

test("security fixture: an escaped key in nested model JSON is rejected before decoded output reaches consumers", async () => {
  const observedReceipts = [];
  const content = JSON.stringify({ privateEcho: FIXTURE_KEY }).replace("sk-or-", "\\u0073k-or-");
  let calls = 0;
  await assert.rejects(
    () =>
      modelRequest(
        async () => {
          calls += 1;
          return providerResponse(
            providerResult({
              choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
            }),
          );
        },
        { onReceipt: (receipt) => observedReceipts.push(receipt) },
      ),
    (error) => {
      assert.equal(error.code, "provider_secret_echo");
      assert.equal(JSON.stringify(error.receipts).includes(FIXTURE_KEY), false);
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(observedReceipts).includes(FIXTURE_KEY), false);
  assert.equal(
    observedReceipts.some((receipt) => receipt.outcome === "completed"),
    false,
  );
});

test("security fixture: checked corrections remain usable by the model and fabricated correction lineage is rejected", () => {
  const initial = fixtureDossier();
  const corrected = reviseDossier(
    initial,
    {
      expectedRevision: 1,
      requestId: "security-model-correction",
      changes: [
        {
          metricId: "revenue",
          periodId: "FY2025",
          value: 125,
          reason: "Verified against the synthetic fixture",
          sourceChecked: true,
        },
      ],
    },
    { now: FIXTURE_TIME, correctionId: () => "fixture-model-correction" },
  );
  const valid = validateSecuritiesAnalysis(validModelOutput(corrected), corrected, "en");
  assert.match(valid.claims[0].text, /25 VND billion/u);
  assert.equal(
    valid.claims[0].numericOrigins.find((entry) => entry.side === "current").origin,
    "analyst_correction",
  );
  assert.equal(
    valid.claims[0].numericOrigins.find((entry) => entry.side === "current").correctionId,
    "fixture-model-correction",
  );
  corrected.corrections[0].value = 999;
  assert.throws(() => validateSecuritiesAnalysis(validModelOutput(corrected), corrected), {
    code: "model_unverified_correction",
  });
});

test("security fixture: a provider generation identifier suppresses duplicate rate-limit retries", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      modelRequest(async () => {
        calls += 1;
        return providerResponse(
          { error: { code: 429 } },
          {
            status: 429,
            headers: { "retry-after": "0", "x-generation-id": "synthetic-existing-generation" },
          },
        );
      }),
    { code: "provider_rate_limited" },
  );
  assert.equal(calls, 1);
});

test("security fixture: a timed-out provider operation is cancelled and never replayed", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      modelRequest(
        async (_url, { signal }) => {
          calls += 1;
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
        { timeoutMs: 20 },
      ),
    (error) => {
      assert.equal(error.code, "provider_timeout");
      assert.equal(error.receipts.length, 1);
      assert.equal(error.receipts[0].costUsd, null);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("security fixture: a different model and an attempted client tool call fail before completion", async () => {
  await assert.rejects(
    () =>
      modelRequest(async () =>
        providerResponse(providerResult({ model: "synthetic/unauthorized-model" })),
      ),
    { code: "provider_model_mismatch" },
  );
  await assert.rejects(
    () =>
      modelRequest(async () =>
        providerResponse(
          providerResult({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "{}",
                  tool_calls: [{ function: { name: "read_secret", arguments: "{}" } }],
                },
              },
            ],
          }),
        ),
      ),
    { code: "model_invalid_output" },
  );
});

test("security fixture: provider readers reject wrong content types and cancel oversized chunked bodies", async () => {
  await assert.rejects(
    () =>
      readBoundedProviderJson(
        new Response("<html>Challenge</html>", {
          headers: { "Content-Type": "text/html" },
        }),
      ),
    { code: "provider_invalid_response" },
  );
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(33)));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    () =>
      readBoundedProviderJson(
        new Response(body, {
          headers: { "Content-Type": "application/json" },
        }),
        32,
      ),
    { code: "provider_response_too_large" },
  );
  assert.equal(cancelled, true);
});

function localEnvironment() {
  return { SECURITIES_LOCAL_MODE: "true", SECURITIES_DB: {} };
}

test("security fixture: browser-local writes require same-origin evidence and reject hostile origins and hosts", () => {
  const origin = "http://127.0.0.1:8788";
  const request = (headers = {}, url = `${origin}/api/securities/dossiers`) =>
    new Request(url, { method: "POST", headers });
  assert.doesNotThrow(() =>
    assertSecuritiesLocalRequest(request({ Origin: origin }), localEnvironment()),
  );
  assert.doesNotThrow(() =>
    assertSecuritiesLocalRequest(request({ "Sec-Fetch-Site": "same-origin" }), localEnvironment()),
  );
  assert.throws(() => assertSecuritiesLocalRequest(request(), localEnvironment()), {
    code: "origin_required",
  });
  for (const hostileOrigin of ["null", "https://attacker.invalid", "http://127.0.0.1:9999"]) {
    assert.throws(
      () => assertSecuritiesLocalRequest(request({ Origin: hostileOrigin }), localEnvironment()),
      { code: "origin_not_allowed" },
    );
  }
  assert.throws(
    () =>
      assertSecuritiesLocalRequest(request({ "Sec-Fetch-Site": "cross-site" }), localEnvironment()),
    { code: "origin_not_allowed" },
  );
  assert.throws(
    () =>
      assertSecuritiesLocalRequest(
        request(
          { Origin: "http://attacker.invalid" },
          "http://attacker.invalid/api/securities/dossiers",
        ),
        localEnvironment(),
      ),
    { code: "local_only" },
  );
  assert.throws(
    () =>
      assertSecuritiesLocalRequest(request({ Origin: origin }), {
        ...localEnvironment(),
        SECURITIES_LOCAL_MODE: "false",
      }),
    { code: "local_only" },
  );
});

test("security fixture: shared mutations fail closed behind an anonymous rate limit", async () => {
  const mutation = new Request("https://tranthiennhan.com/api/securities/dossiers", {
    method: "DELETE",
    headers: {
      Origin: "https://tranthiennhan.com",
      "CF-Connecting-IP": "203.0.113.10",
    },
  });
  const keys = [];
  await assertSecuritiesMutationRateLimit(mutation, {
    SECURITIES_SHARED_MODE: "true",
    SECURITIES_RATE_LIMIT: {
      async limit(input) {
        keys.push(input.key);
        return { success: true };
      },
    },
  });
  assert.match(keys[0], /^[a-f0-9]{32}$/u);
  assert.equal(keys[0].includes("203.0.113.10"), false);
  await assert.rejects(
    assertSecuritiesMutationRateLimit(mutation, {
      SECURITIES_SHARED_MODE: "true",
      SECURITIES_RATE_LIMIT: { limit: async () => ({ success: false }) },
    }),
    { code: "rate_limited", status: 429 },
  );
  await assert.rejects(
    assertSecuritiesMutationRateLimit(mutation, { SECURITIES_SHARED_MODE: "true" }),
    { code: "service_not_configured", status: 503 },
  );
  await assert.rejects(
    assertSecuritiesMutationRateLimit(mutation, {
      SECURITIES_SHARED_MODE: "true",
      SECURITIES_RATE_LIMIT: { limit: async () => Promise.reject(new Error("fixture outage")) },
    }),
    { code: "rate_limit_temporarily_unavailable", status: 503 },
  );
  await assert.doesNotReject(
    assertSecuritiesMutationRateLimit(
      new Request("https://tranthiennhan.com/api/securities/dossiers"),
      { SECURITIES_SHARED_MODE: "true" },
    ),
  );
  await assert.doesNotReject(assertSecuritiesMutationRateLimit(mutation, localEnvironment()));
});

async function fixtureStore(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(
    await readFile(new URL("../../worker/securities/migrations/0001.sql", import.meta.url), "utf8"),
  );
  // Exercise the production SQL with SQLite transactions. This implements the
  // small D1 interface used by the store; it is not a hosted D1 receipt.
  const adapter = {
    prepare(sql) {
      return {
        bind(...values) {
          const statement = sqlite.prepare(sql);
          const run = () => ({ meta: { changes: Number(statement.run(...values).changes) } });
          return {
            first: async () => statement.get(...values) ?? null,
            all: async () => ({ results: statement.all(...values) }),
            run: async () => run(),
            runSynchronously: run,
          };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => statement.runSynchronously());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return createSecuritiesStore(adapter);
}

function runningJob(dossier, suffix) {
  const now = Date.now();
  return {
    id: `fixture-job-${suffix}`,
    requestId: `fixture-request-${suffix}`,
    dossierId: dossier.id,
    revision: dossier.revision,
    kind: "analysis",
    startedAt: new Date(now).toISOString(),
    deadline: new Date(now + 60_000).toISOString(),
  };
}

test("security SQLite fixture: simultaneous duplicate dossier requests persist one idempotent result", async (t) => {
  const store = await fixtureStore(t);
  const first = fixtureDossier();
  const second = { ...fixtureDossier(), id: "duplicate-candidate-id" };
  const results = await Promise.all([
    store.create(first, "concurrent-create-request", "same-fingerprint"),
    store.create(second, "concurrent-create-request", "same-fingerprint"),
  ]);
  assert.equal(results[0].dossier.id, results[1].dossier.id);
  assert.equal((await store.list()).length, 1);
  await assert.rejects(
    () => store.create(second, "concurrent-create-request", "different-fingerprint"),
    { code: "idempotency_conflict" },
  );
});

test("security SQLite fixture: concurrent edits of one revision commit one winner and preserve the original", async (t) => {
  const store = await fixtureStore(t);
  const initial = fixtureDossier();
  await store.create(initial, "concurrent-edit-create", "fixture-create");
  const next = (notes, requestId) =>
    reviseDossier(initial, { expectedRevision: 1, requestId, notes });
  const results = await Promise.allSettled([
    store.saveRevision(next("First synthetic edit", "concurrent-edit-one"), {
      expectedRevision: 1,
      requestId: "concurrent-edit-one",
      fingerprint: "edit-one",
    }),
    store.saveRevision(next("Second synthetic edit", "concurrent-edit-two"), {
      expectedRevision: 1,
      requestId: "concurrent-edit-two",
      fingerprint: "edit-two",
    }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(
    results.find((result) => result.status === "rejected").reason.code,
    "revision_conflict",
  );
  assert.equal((await store.get(initial.id)).revision, 2);
  assert.equal((await store.get(initial.id, 1)).notes, "");
});

test("security SQLite fixture: approval during analysis makes the late result stale without changing the approved revision", async (t) => {
  const store = await fixtureStore(t);
  const initial = fixtureDossier();
  await store.create(initial, "approval-race-create", "fixture-create");
  const job = runningJob(initial, "approval-race");
  await store.startJob(job, "fixture-analysis");
  await store.approve(initial, {
    requestId: "approval-race-confirm",
    fingerprint: "fixture-approval",
    now: new Date().toISOString(),
  });
  const completed = await store.completeAnalysis(
    job,
    applyModelAnalysis(initial, { summary: "Synthetic late analysis", claims: [] }),
  );
  assert.equal(completed.status, "stale");
  const current = await store.get(initial.id);
  assert.equal(current.revision, 1);
  assert.equal(current.status, "approved");
  assert.equal(current.analysis.origin, "rules");
});

test("security SQLite fixture: cancelled analysis preserves state and retains later unknown-cost receipts", async (t) => {
  const store = await fixtureStore(t);
  const initial = fixtureDossier();
  await store.create(initial, "cancel-race-create", "fixture-create");
  const job = runningJob(initial, "cancel-race");
  await store.startJob(job, "fixture-analysis");
  await store.cancelJob(job.id, {
    requestId: "cancel-race-confirm",
    fingerprint: "fixture-cancel",
  });
  const receipts = [
    {
      evidenceType: "fixture",
      requestId: "synthetic-provider-generation",
      outcome: "cancelled",
      costUsd: null,
      costStatus: "unknown",
    },
  ];
  const completed = await store.completeAnalysis(
    job,
    applyModelAnalysis(initial, { summary: "Synthetic cancelled analysis", claims: [] }),
    receipts,
  );
  assert.equal(completed.status, "cancelled");
  assert.deepEqual(completed.receipts, receipts);
  assert.equal((await store.get(initial.id)).revision, 1);
});

test("security SQLite fixture: an intentional source refresh creates a draft while retaining the approved source history", async (t) => {
  const store = await fixtureStore(t);
  const initial = fixtureDossier();
  await store.create(initial, "approved-refresh-create", "fixture-create");
  await store.approve(initial, {
    requestId: "approved-refresh-confirm",
    fingerprint: "fixture-approval",
    now: new Date().toISOString(),
  });
  const approved = await store.get(initial.id);
  const job = { ...runningJob(approved, "approved-refresh"), kind: "refresh" };
  await store.startJob(job, "fixture-refresh");
  const replacement = fixtureDossier();
  replacement.sources[0].hash = "b".repeat(64);
  replacement.sources[0].version = "fixture-v2";
  replacement.metrics[0].current.sourceVersion = "fixture-v2";
  replacement.metrics[0].comparison.sourceVersion = "fixture-v2";
  const next = replaceDossierSources(approved, replacement);
  assert.equal((await store.completeAnalysis(job, next)).status, "completed");
  assert.equal((await store.get(initial.id)).revision, 2);
  assert.equal((await store.get(initial.id)).status, "draft");
  assert.equal((await store.get(initial.id, 1)).status, "approved");
  assert.equal((await store.get(initial.id, 1)).sources[0].hash, "a".repeat(64));
});

test("security SQLite fixture: a response after the persisted deadline cannot commit even without status polling", async (t) => {
  const store = await fixtureStore(t);
  const initial = fixtureDossier();
  await store.create(initial, "deadline-race-create", "fixture-create");
  const job = runningJob(initial, "deadline-race");
  await store.startJob(job, "fixture-analysis");
  const late = applyModelAnalysis(
    initial,
    { summary: "Synthetic expired analysis", claims: [] },
    {
      now: new Date(Date.parse(job.deadline) + 1).toISOString(),
    },
  );
  const completed = await store.completeAnalysis(job, late);
  assert.equal(completed.status, "failed");
  assert.equal(completed.error.code, "job_timeout");
  assert.equal((await store.get(initial.id)).revision, 1);
});

test("security SQLite fixture: cancelled and expired chat cannot reopen or append conversation, while receipts survive", async (t) => {
  for (const outcome of ["cancelled", "expired"]) {
    const store = await fixtureStore(t);
    const initial = fixtureDossier();
    await store.create(initial, `chat-${outcome}-create`, "fixture-create");
    const job = {
      ...runningJob(initial, `chat-${outcome}`),
      kind: "chat",
      question: "Synthetic follow-up question",
    };
    await store.startJob(job, "fixture-chat");
    if (outcome === "cancelled")
      await store.cancelJob(job.id, {
        requestId: "chat-cancel-confirm",
        fingerprint: "fixture-cancel",
      });
    const receipt = {
      evidenceType: "fixture",
      requestId: `synthetic-chat-${outcome}`,
      outcome,
      costUsd: null,
      costStatus: "unknown",
    };
    const completionTime =
      outcome === "expired"
        ? new Date(Date.parse(job.deadline) + 1).toISOString()
        : new Date().toISOString();
    const completed = await store.completeChat(
      job,
      { summary: "Synthetic late answer", claims: [], receipts: [receipt] },
      completionTime,
    );
    assert.equal(completed.status, outcome === "expired" ? "failed" : "cancelled");
    assert.equal(completed.error.code, outcome === "expired" ? "job_timeout" : "cancelled");
    assert.equal(completed.result, null);
    assert.deepEqual(completed.receipts, [receipt]);
    const dossier = await store.get(initial.id);
    assert.deepEqual(dossier.chat, []);
    assert.equal(dossier.revision, 1);
    assert.equal(dossier.analysis.origin, "rules");
  }
});

test("security SQLite fixture: a historical chat attaches only to its approved revision and cannot change the newer draft", async (t) => {
  const store = await fixtureStore(t);
  const initial = fixtureDossier();
  await store.create(initial, "historical-chat-create", "fixture-create");
  await store.approve(initial, {
    requestId: "historical-chat-approval",
    fingerprint: "fixture-approval",
    now: new Date().toISOString(),
  });
  const approved = await store.get(initial.id, 1);
  const job = {
    ...runningJob(approved, "historical-chat"),
    kind: "chat",
    question: "Explain the originally approved comparison",
  };
  await store.startJob(job, "fixture-chat");
  const next = reviseDossier(approved, {
    expectedRevision: 1,
    requestId: "historical-chat-new-draft",
    notes: "A separate newer draft",
  });
  await store.saveRevision(next, {
    requestId: "historical-chat-new-draft",
    fingerprint: "fixture-draft",
    expectedRevision: 1,
  });
  const completed = await store.completeChat(job, {
    summary: "Synthetic historical answer",
    claims: [],
    receipts: [],
  });
  assert.equal(completed.status, "completed");
  const current = await store.get(initial.id);
  const historical = await store.get(initial.id, 1);
  assert.equal(current.revision, 2);
  assert.equal(current.status, "draft");
  assert.equal(current.notes, "A separate newer draft");
  assert.deepEqual(current.chat, []);
  assert.equal(historical.chat.length, 2);
  assert.equal(historical.chat[0].content, job.question);
  assert.equal(historical.chat[1].answer.summary, "Synthetic historical answer");
  for (const key of [
    "revision",
    "status",
    "approval",
    "metrics",
    "originalMetrics",
    "sources",
    "analysis",
    "corrections",
    "notes",
  ]) {
    assert.deepEqual(
      historical[key],
      approved[key],
      `Historical financial field ${key} is immutable`,
    );
  }
});

function unzipFixture(bytes) {
  const buffer = Buffer.from(bytes);
  const files = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const compression = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    const raw = buffer.subarray(start, start + size);
    assert.ok(
      compression === 0 || compression === 8,
      "The fixture supports standard stored or deflate ZIP entries.",
    );
    files.set(name, (compression === 8 ? inflateRawSync(raw) : raw).toString("utf8"));
    offset = start + size;
  }
  return files;
}

test("security export fixture: formulas and XML supplied as analyst/source text remain inert spreadsheet strings", () => {
  const dossier = fixtureDossier();
  dossier.status = "approved";
  dossier.approval = { revision: dossier.revision, at: FIXTURE_TIME };
  dossier.notes = '=HYPERLINK("https://example.invalid/fixture","Synthetic note")';
  dossier.sources[0].title = '</t></is><f>HYPERLINK("https://example.invalid/fixture")</f><t>';
  const archive = unzipFixture(createSecuritiesXlsx(dossier));
  const sheets = [...archive]
    .filter(([name]) => /^xl\/worksheets\//u.test(name))
    .map(([, xml]) => xml);
  const formulas = sheets.flatMap((xml) =>
    [...xml.matchAll(/<f>(.*?)<\/f>/gu)].map((match) => match[1]),
  );
  assert.deepEqual(formulas, ["D2-E2", "(D2-E2)/E2"]);
  assert.ok(
    sheets.some(
      (xml) =>
        xml.includes('t="inlineStr"') &&
        xml.includes("=HYPERLINK(&quot;https://example.invalid/fixture&quot;"),
    ),
  );
  assert.ok(sheets.some((xml) => xml.includes("&lt;/t&gt;&lt;/is&gt;&lt;f&gt;HYPERLINK")));
  assert.equal(
    [...archive.keys()].some((name) => /vbaProject|externalLinks/iu.test(name)),
    false,
  );
  assert.equal(
    [...archive.values()].some((xml) => /TargetMode="External"/u.test(xml)),
    false,
  );
});

test("security export fixture: drafts export labelled supported data and approval cannot override invalid evidence", () => {
  const dossier = fixtureDossier();
  const draft = unzipFixture(createSecuritiesXlsx(dossier));
  assert.equal(dossier.status, "draft");
  assert.ok([...draft.values()].some((xml) => xml.includes("data_only")));
  assert.ok(
    [...draft.values()].some((xml) => xml.includes("An AI answer to this request is unavailable")),
  );
  dossier.status = "approved";
  dossier.approval = { revision: 2, at: FIXTURE_TIME };
  dossier.metrics[0].current.verification = "needs_review";
  dossier.metrics[0].comparison.verification = "needs_review";
  assert.throws(() => createSecuritiesXlsx(dossier), { code: "report_unavailable" });
});

test("security fixture: asynchronous ingestion failures remain structured API errors", async () => {
  const response = await handleSecuritiesRequest(
    new Request("http://127.0.0.1:8788/api/securities/sources/jobs/fixture-job-request"),
    localEnvironment(),
    {},
    { store: {} },
  );
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "source_service_unavailable");
});

const FIXTURE_PDF_URL = "https://fpt.com/api/media/synthetic-security-fixture.pdf";
const FIXTURE_PDF_BODY =
  "%PDF-1.7\n% synthetic HTTP fixture, not a real financial document\n%%EOF\n";

test("security source fixture: exact issuer URL validation rejects encoded local targets and authority tricks", () => {
  assert.equal(validateSecuritiesSourceUrl(FIXTURE_PDF_URL), FIXTURE_PDF_URL);
  for (const rejected of [
    "http://fpt.com/api/media/report.pdf",
    "https://localhost/api/media/report.pdf",
    "https://127.0.0.1/api/media/report.pdf",
    "https://2130706433/api/media/report.pdf",
    "https://0177.0.0.1/api/media/report.pdf",
    "https://0x7f000001/api/media/report.pdf",
    "https://[::1]/api/media/report.pdf",
    "https://[::ffff:127.0.0.1]/api/media/report.pdf",
    "https://169.254.169.254/api/media/report.pdf",
    "https://fpt.com.attacker.invalid/api/media/report.pdf",
    "https://fpt.com@127.0.0.1/api/media/report.pdf",
    "https://user:password@fpt.com/api/media/report.pdf",
    "https://fpt.com:8443/api/media/report.pdf",
    "https://fpt.com./api/media/report.pdf",
    "https://fpt.com/api/media/report.pdf?next=http://localhost",
    "https://fpt.com/api/media/report.pdf#metadata",
    "https://fpt.com/api/media/%2e%2e/report.pdf",
    "https://fpt.com/api/media/%252e%252e%252freport.pdf",
    "https://fpt.com/api/media/report.pdf%00",
    "file:///synthetic-security-fixture",
    "data:application/pdf,synthetic",
  ])
    assert.throws(() => validateSecuritiesSourceUrl(rejected), { code: "unsafe_url" }, rejected);
});

test("security source fixture: an unsafe redirect is rejected before a second network request", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      fetchSecuritiesSource(FIXTURE_PDF_URL, {
        fetchImpl: async (_url, options) => {
          calls += 1;
          assert.equal(options.redirect, "manual");
          return new Response(null, {
            status: 302,
            headers: { Location: "http://169.254.169.254/metadata" },
          });
        },
      }),
    { code: "unsafe_url" },
  );
  assert.equal(calls, 1);
});

test("security source fixture: global source allowlists cannot misattribute a peer issuer document", () => {
  const gemadept =
    "https://www.gemadept.com.vn/wp-content/uploads/2026/08/20260829-GMD-BCTC-Hop-nhat-soat-xet-ban-nien-2026.pdf";
  const html = `<html><a href="${gemadept}">Gemadept consolidated financial statements</a></html>`;
  assert.deepEqual(
    discoverSecuritiesDocuments(html, "https://fpt.com/vi/nha-dau-tu/thong-tin-cong-bo", "FPT"),
    [],
  );
});

test("security source fixture: response failures preserve challenge, partial, denied, and size distinctions", async () => {
  const fixtures = [
    [() => new Response("Denied", { status: 403 }), "access_denied"],
    [() => new Response("Missing", { status: 404 }), "not_found"],
    [
      () =>
        new Response(FIXTURE_PDF_BODY, {
          status: 206,
          headers: { "Content-Type": "application/pdf" },
        }),
      "partial_content",
    ],
    [
      () =>
        new Response("<html><title>Just a moment</title><body>Challenge</body></html>", {
          headers: { "Content-Type": "text/html" },
        }),
      "challenge",
    ],
    [
      () =>
        new Response("%PDF-1.7\nTruncated synthetic document", {
          headers: { "Content-Type": "application/pdf" },
        }),
      "partial_content",
    ],
    [
      () =>
        new Response(FIXTURE_PDF_BODY, {
          headers: { "Content-Type": "application/pdf", "Content-Length": "999" },
        }),
      "partial_content",
    ],
  ];
  for (const [response, code] of fixtures) {
    await assert.rejects(
      () =>
        fetchSecuritiesSource(FIXTURE_PDF_URL, {
          fetchImpl: async () => response(),
          maxAttempts: 1,
        }),
      { code },
    );
  }
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(65));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    () =>
      fetchSecuritiesSource(FIXTURE_PDF_URL, {
        maxBytes: 64,
        fetchImpl: async () =>
          new Response(stream, { headers: { "Content-Type": "application/pdf" } }),
      }),
    { code: "too_large" },
  );
  assert.equal(cancelled, true);
});

test("security source fixture: explicit retry limits and ignored transport aborts do not create unbounded attempts", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      fetchSecuritiesSource(FIXTURE_PDF_URL, {
        maxAttempts: 2,
        fetchImpl: async () => {
          calls += 1;
          return new Response(null, { status: 429, headers: { "Retry-After": "0" } });
        },
      }),
    { code: "rate_limited" },
  );
  assert.equal(calls, 2);
  await assert.rejects(
    () =>
      fetchSecuritiesSource(FIXTURE_PDF_URL, {
        timeoutMs: 20,
        fetchImpl: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return new Response(FIXTURE_PDF_BODY, { headers: { "Content-Type": "application/pdf" } });
        },
      }),
    { code: "timeout" },
  );
});

test("security DNS fixture: public-address classification excludes canonical and expanded non-global IPv6", () => {
  // IANA special-purpose registry: documentation and benchmarking ranges are
  // non-global, including the newer 3fff::/20 documentation allocation.
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "100.64.0.1",
    "198.18.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2001:0db8::1",
    "2001:2::1",
    "2001:0002::1",
    "3fff::1",
    "3fff:0fff::1",
  ])
    assert.equal(isPublicSourceAddress(address), false, address);
  for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isPublicSourceAddress(address), true, address);
  }
});

test("security DNS fixture: a mixed public/private DNS answer is rejected before opening TLS", async (t) => {
  t.mock.method(dns, "lookup", async () => [
    { address: "1.1.1.1", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  let calls = 0;
  t.mock.method(https, "request", () => {
    calls += 1;
    throw new Error("Unexpected synthetic TLS request");
  });
  await assert.rejects(() => nodeSecuritiesFetch(FIXTURE_PDF_URL), {
    code: "private_source_address",
  });
  assert.equal(calls, 0);
});

test("security DNS fixture: the accepted address is pinned to TLS lookup while preserving the issuer server name", async (t) => {
  let dnsCalls = 0;
  t.mock.method(dns, "lookup", async () => {
    dnsCalls += 1;
    return [{ address: "1.1.1.1", family: 4 }];
  });
  t.mock.method(https, "request", (url, options, callback) => {
    assert.equal(url.hostname, "fpt.com");
    assert.equal(options.servername, "fpt.com");
    assert.equal(options.agent, false);
    options.lookup("fpt.com", { all: true }, (error, records) => {
      assert.equal(error, null);
      assert.deepEqual(records, [{ address: "1.1.1.1", family: 4 }]);
    });
    const incoming = Readable.from([Buffer.from(FIXTURE_PDF_BODY)]);
    Object.assign(incoming, {
      statusCode: 200,
      statusMessage: "OK",
      headers: { "content-type": "application/pdf" },
    });
    const outgoing = new EventEmitter();
    outgoing.end = () => callback(incoming);
    return outgoing;
  });
  const response = await nodeSecuritiesFetch(FIXTURE_PDF_URL);
  assert.equal(await response.text(), FIXTURE_PDF_BODY);
  assert.equal(dnsCalls, 1);
});

test("security source fixture: unexpected null-body HTTP statuses cannot escape the Node transport callback", async (t) => {
  t.mock.method(dns, "lookup", async () => [{ address: "1.1.1.1", family: 4 }]);
  for (const status of [204, 205, 304]) {
    const mocked = t.mock.method(https, "request", (_url, _options, callback) => {
      const incoming = Readable.from([]);
      Object.assign(incoming, {
        statusCode: status,
        statusMessage: "Synthetic status",
        headers: {},
      });
      const outgoing = new EventEmitter();
      outgoing.end = () => callback(incoming);
      return outgoing;
    });
    const response = await nodeSecuritiesFetch(FIXTURE_PDF_URL);
    assert.equal(response.status, status);
    assert.equal(response.body, null);
    mocked.mock.restore();
  }
});
