import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { securitiesReceiptIdentity } from "../../shared/securities/receipt-identity.js";

const websiteRoot = fileURLToPath(new URL("../../", import.meta.url));
const outputRoot = path.resolve(websiteRoot, "../output/securities");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const label = (value) =>
  typeof value === "string" &&
  value.length <= 180 &&
  !/sk-or-/i.test(value) &&
  /^[a-zA-Z0-9_.:/ |()-]+$/.test(value)
    ? value
    : null;
const number = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const date = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

function receiptObservation(value, location) {
  if (!value || typeof value !== "object") return null;
  if (value.evidenceType === "evaluation_interruption") {
    return {
      identity: `interrupted:${location.file}:${value.interruptedCase}`,
      evidenceType: value.evidenceType,
      operation: "interrupted_evaluation",
      requestId: null,
      transportAttemptId: null,
      requestedModel: "meta/muse-spark-1.3-contributor",
      actualModel: null,
      provider: null,
      selectedEndpoints: [],
      requestedServerTools: [],
      startedAt: null,
      completedAt: date(value.recordedAt),
      outcome: "upstream_completion_unknown",
      errorCode: "evaluation_interrupted",
      httpStatus: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      validation: null,
      location,
    };
  }
  if (!["openrouter_live", "openrouter_live_control"].includes(value.evidenceType)) return null;
  const raw = { ...value.routing, ...value.usage, ...value };
  if (!Object.hasOwn(raw, "costUsd") || !Object.hasOwn(raw, "httpStatus")) return null;
  const requestId = label(raw.requestId);
  const transportAttemptId = label(raw.transportAttemptId);
  const startedAt = date(raw.startedAt);
  const operation =
    label(raw.operation) ??
    (value.evidenceType === "openrouter_live_control" ? "control" : "encoding_control");
  if (!transportAttemptId && !requestId && !startedAt)
    throw new Error("A live receipt has no stable request identity.");
  return {
    identity:
      securitiesReceiptIdentity({ transportAttemptId }) ??
      (requestId
        ? `provider:${requestId}`
        : `anonymous:${operation}:${raw.attempt ?? 1}:${startedAt}`),
    evidenceType: value.evidenceType,
    operation,
    requestId,
    transportAttemptId,
    requestedModel: label(raw.requestedModel),
    actualModel: label(raw.actualModel),
    provider: label(raw.provider),
    selectedEndpoints: (raw.selectedEndpoints ?? []).map((entry) => ({
      provider: label(entry.provider),
      nativeModel: label(entry.nativeModel ?? entry.model),
    })),
    requestedServerTools: (raw.requestedServerTools ?? []).map((entry) => ({
      type: label(entry.type),
      engine: label(entry.engine),
    })),
    startedAt,
    completedAt: date(raw.completedAt),
    latencyMs: number(raw.latencyMs),
    outcome: label(raw.outcome) ?? (raw.httpStatus === 200 ? "completed_control" : "unknown"),
    errorCode: label(raw.errorCode),
    httpStatus: number(raw.httpStatus),
    inputTokens: number(raw.inputTokens),
    outputTokens: number(raw.outputTokens),
    costUsd: number(raw.costUsd),
    validation: raw.validation
      ? {
          status: label(raw.validation.status),
          code: label(raw.validation.code),
          reason: label(raw.validation.reason),
        }
      : null,
    location,
  };
}

export function collectLiveReceiptObservations(value, location, pointer = "") {
  const own = receiptObservation(value, { ...location, pointer });
  if (own) return [own];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    collectLiveReceiptObservations(
      child,
      location,
      `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
    ),
  );
}

export function aggregateLiveReceiptObservations(observations) {
  const entries = new Map();
  for (const observation of observations) {
    const { location, ...value } = observation;
    let entry = entries.get(value.identity);
    if (!entry) {
      entry = { ...value, providersReported: [], transportOutcomes: [], observations: [] };
      entries.set(value.identity, entry);
    }
    for (const field of [
      "requestedModel",
      "actualModel",
      "costUsd",
      "inputTokens",
      "outputTokens",
    ]) {
      if (entry[field] !== null && value[field] !== null && entry[field] !== value[field]) {
        throw new Error(`Conflicting receipt copies for ${field}.`);
      }
      if (entry[field] === null && value[field] !== null) entry[field] = value[field];
    }
    if (value.provider && !entry.providersReported.includes(value.provider))
      entry.providersReported.push(value.provider);
    if (!entry.transportOutcomes.includes(value.outcome))
      entry.transportOutcomes.push(value.outcome);
    entry.observations.push({
      ...location,
      validation: value.validation,
      outcome: value.outcome,
      costUsd: value.costUsd,
    });
  }
  const requests = [...entries.values()].sort((a, b) =>
    (a.startedAt ?? a.completedAt ?? "").localeCompare(b.startedAt ?? b.completedAt ?? ""),
  );
  const knownCostUsd =
    Number(
      requests.reduce(
        (sum, entry) =>
          sum + (entry.costUsd === null ? 0n : BigInt(entry.costUsd.toFixed(12).replace(".", ""))),
        0n,
      ),
    ) / 1e12;
  const unknownCostAttempts = requests.filter((entry) => entry.costUsd === null).length;
  return {
    trackedAttempts: requests.length,
    providerIdentifiedRequests: requests.filter((entry) => entry.requestId).length,
    unknownCostAttempts,
    knownCostUsd,
    totalCostUsd: unknownCostAttempts === 0 ? knownCostUsd : null,
    requests,
  };
}

export async function summarizeLiveReceipts() {
  const liveRoot = path.join(outputRoot, "receipts/live");
  const qaRoot = path.join(outputRoot, "qa");
  const paths = [];
  for (const entry of await readdir(liveRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) paths.push(path.join(liveRoot, entry.name, "results.json"));
  }
  paths.push(
    path.join(liveRoot, "routing-canary.json"),
    path.join(liveRoot, "phase-b-initial/interruption.json"),
  );
  for (const name of await readdir(qaRoot)) {
    if (/^browser-live-.*\.json$/.test(name)) paths.push(path.join(qaRoot, name));
  }
  const observations = [];
  const inputFiles = [];
  for (const file of paths.sort()) {
    let bytes;
    try {
      bytes = await readFile(file);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const location = {
      file: path.relative(outputRoot, file).replaceAll(path.sep, "/"),
      sha256: hash(bytes),
    };
    const found = collectLiveReceiptObservations(JSON.parse(bytes.toString("utf8")), location);
    if (found.length) {
      observations.push(...found);
      inputFiles.push({ ...location, observedReceiptCopies: found.length });
    }
  }
  const totals = aggregateLiveReceiptObservations(observations);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope:
      "All retained live CLI evaluation attempts, routing/Unicode controls, explicit interruption, and browser-live QA receipt copies. No provider account billing API was queried.",
    deduplication:
      "Local transport attempt ID first. Legacy receipts retain provider request ID or exact operation/attempt/start time fallback, with an explicit identity for the interrupted unreceipted evaluation. Unknown cost stays null. Conflicting copied cost/token/model values stop aggregation.",
    costPrecision:
      "Provider numbers retained per request; sums use twelve decimal fractional digits.",
    provenance:
      "Top-level provider labels and selected native endpoints are retained separately. A selected endpoint label never replaces the actual gateway model ID.",
    inputFiles,
    ...totals,
  };
  const serialized = JSON.stringify(report, null, 2);
  if (/sk-or-/i.test(serialized)) throw new Error("Credential-like ledger content blocked.");
  const destination = path.join(qaRoot, "phase-b-receipt-ledger.json");
  await writeFile(destination, serialized + "\n");
  return {
    destination,
    trackedAttempts: totals.trackedAttempts,
    providerIdentifiedRequests: totals.providerIdentifiedRequests,
    knownCostUsd: totals.knownCostUsd,
    unknownCostAttempts: totals.unknownCostAttempts,
    totalCostUsd: totals.totalCostUsd,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await summarizeLiveReceipts()));
  } catch {
    console.error(
      "Receipt aggregation did not complete. Check identity, conflicting copies, and input files; no key or network was used.",
    );
    process.exitCode = 1;
  }
}
