import assert from "node:assert/strict";
import test from "node:test";
import { securitiesReceiptIdentity } from "../../shared/securities/receipt-identity.js";
import { summarizeSecuritiesLiveCosts } from "../../scripts/securities/live-receipt-costs.mjs";
import {
  aggregateLiveReceiptObservations,
  collectLiveReceiptObservations,
} from "../../scripts/securities/summarize-live-receipts.mjs";

const firstAttempt = "b628100c-bb4d-43d1-9057-bdf0867d6bd5";
const secondAttempt = "923520a2-dfe4-4401-bb09-8a5c9979af68";
const anonymous = {
  operation: "analysis",
  attempt: 1,
  requestId: null,
  provider: null,
  startedAt: "2026-09-08T03:53:52.450Z",
  costUsd: null,
  costStatus: "unknown",
};

test("local attempt identity survives copied or enriched observations and distinguishes real attempts", () => {
  const receipt = { ...anonymous, transportAttemptId: firstAttempt };
  const identity = securitiesReceiptIdentity(receipt);
  assert.equal(securitiesReceiptIdentity(structuredClone(receipt)), identity);
  assert.equal(
    securitiesReceiptIdentity({ ...receipt, requestId: "gen-fixture", provider: "fixture" }),
    identity,
  );
  assert.notEqual(
    securitiesReceiptIdentity({ ...receipt, transportAttemptId: secondAttempt }),
    identity,
  );
});

test("legacy identities retain provider and start scope without merging anonymous receipts", () => {
  const receipt = { ...anonymous, requestId: "gen-fixture", provider: "fixture" };
  const identity = securitiesReceiptIdentity(receipt);
  assert.equal(securitiesReceiptIdentity(structuredClone(receipt)), identity);
  assert.notEqual(securitiesReceiptIdentity({ ...receipt, provider: "other" }), identity);
  assert.notEqual(
    securitiesReceiptIdentity({ ...receipt, startedAt: "2026-09-08T03:53:52.451Z" }),
    identity,
  );
  for (const receipt of [undefined, null, anonymous, { ...anonymous, transportAttemptId: " " }])
    assert.equal(securitiesReceiptIdentity(receipt), null);
});

test("cost summaries count copied cancellation once and preserve distinct unknown attempts", () => {
  const receipt = { ...anonymous, transportAttemptId: firstAttempt };
  const other = { ...receipt, transportAttemptId: secondAttempt };
  const observations = [{ receipts: [receipt, structuredClone(receipt), other] }];
  const before = structuredClone(observations);
  assert.deepEqual(summarizeSecuritiesLiveCosts(observations), {
    knownCostUsd: 0,
    unknownCostRequests: 2,
    totalCostUsd: null,
    requestCount: 2,
  });
  assert.deepEqual(observations, before);
  assert.deepEqual(summarizeSecuritiesLiveCosts([{ receipts: [anonymous, { ...anonymous }] }]), {
    knownCostUsd: 0,
    unknownCostRequests: 2,
    totalCostUsd: null,
    requestCount: 2,
  });
});

test("cost copies may enrich unknown usage but contradictory known costs fail aggregation", () => {
  const receipt = { ...anonymous, transportAttemptId: firstAttempt };
  const known = { ...receipt, costUsd: 0.01, costStatus: "reported" };
  for (const receipts of [
    [receipt, known, receipt],
    [known, receipt, known],
  ]) {
    assert.deepEqual(summarizeSecuritiesLiveCosts([{ receipts }]), {
      knownCostUsd: 0.01,
      unknownCostRequests: 0,
      totalCostUsd: 0.01,
      requestCount: 1,
    });
  }
  assert.throws(
    () => summarizeSecuritiesLiveCosts([{ receipts: [known, { ...known, costUsd: 0.02 }] }]),
    /Conflicting receipt copies for costUsd/u,
  );
});

test("archival aggregation prefers local identity while retaining observed copies and cost uncertainty", () => {
  // Synthetic evidence-shaped objects exercise parsing only. No live request is made.
  const receipt = {
    ...anonymous,
    evidenceType: "openrouter_live",
    transportAttemptId: firstAttempt,
    httpStatus: null,
    outcome: "failed",
    errorCode: "model_cancelled",
  };
  const values = [
    receipt,
    structuredClone(receipt),
    { ...receipt, transportAttemptId: secondAttempt },
  ];
  const observations = collectLiveReceiptObservations(values, {
    file: "synthetic-fixture.json",
    sha256: "a".repeat(64),
  });
  assert.equal(observations.length, 3);
  const aggregate = aggregateLiveReceiptObservations(observations);
  assert.equal(aggregate.trackedAttempts, 2);
  assert.equal(aggregate.providerIdentifiedRequests, 0);
  assert.equal(aggregate.unknownCostAttempts, 2);
  assert.equal(aggregate.knownCostUsd, 0);
  assert.equal(aggregate.totalCostUsd, null);
  assert.equal(aggregate.requests[0].transportAttemptId, firstAttempt);
  assert.equal(aggregate.requests[0].observations.length, 2);
});

test("archival receipt fallback keeps historical grouping and detects conflicting copied charges", () => {
  const receipt = { ...anonymous, evidenceType: "openrouter_live", httpStatus: null };
  const collect = (values) =>
    collectLiveReceiptObservations(values, {
      file: "synthetic-fixture.json",
      sha256: "a".repeat(64),
    });
  const legacy = aggregateLiveReceiptObservations(collect([receipt, { ...receipt }]));
  assert.equal(legacy.trackedAttempts, 1);
  assert.equal(legacy.totalCostUsd, null);
  assert.throws(
    () =>
      aggregateLiveReceiptObservations(
        collect([
          { ...receipt, transportAttemptId: firstAttempt, costUsd: 0.01 },
          { ...receipt, transportAttemptId: firstAttempt, costUsd: 0.02 },
        ]),
      ),
    /Conflicting receipt copies for costUsd/u,
  );
});
