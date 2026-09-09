import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDossier } from "../../shared/securities/dossier.js";
import { securitiesReceiptIdentity } from "../../shared/securities/receipt-identity.js";
import { loadSecuritiesDataset } from "../../worker/securities/sources.js";
import {
  analyzeSecurities,
  SECURITIES_MODEL_ID,
  SECURITIES_PROMPT_ID,
  readSecuritiesModelCapabilities,
} from "../../worker/securities/model.js";
import {
  SECURITIES_REPORT_CONTRACT,
  SECURITIES_RESEARCH_LIMITS,
} from "../../worker/securities/model-report.js";
import {
  SECURITIES_MODEL_OUTPUT_TOKENS,
  SECURITIES_MODEL_REASONING_EFFORT,
} from "../../worker/securities/model-transport.js";
import { getVerifiedSecuritiesLedgerManifests } from "../../shared/securities/verified-source-facts.js";
import { readSecuritiesSourceEvidence } from "./source-evidence.mjs";
import { assertPhaseAGates, readLocalSecuritiesKey } from "./read-local-key.mjs";
import { summarizeSecuritiesLiveCosts } from "./live-receipt-costs.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const receiptRoot = path.resolve(root, "../output/securities/receipts/live");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const safeCode = (error) =>
  /^[a-z][a-z0-9_]{1,80}$/u.test(error?.code) ? error.code : "report_evaluation_failed";
const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};

// These are known development questions. Independent source review and unseen
// evaluation questions remain separate from this reproducible regression suite.
export const SECURITIES_REPORT_EVALUATION_PROTOCOL = Object.freeze({
  version: "securities-report-development",
  split: "shared_team_development_evaluation",
  historicalEvidence:
    "Existing reports, protocols and failed attempts retain their original bytes and identifiers. New runs freeze the current implementation hash before execution.",
  model: SECURITIES_MODEL_ID,
  promptVersion: SECURITIES_PROMPT_ID,
  reportVersion: SECURITIES_REPORT_CONTRACT,
  frozenAcceptance: "docs/securities-evaluation.md",
  noMonetaryCap: true,
  limitsAre: "Per-analysis execution and context boundaries, not an API testing spend cap",
  independentReview:
    "Required against original source pages; same-model consistency is not independent fact proof",
  cases: [
    {
      id: "fpt-h1-friendly",
      companyId: "FPT",
      periodId: "H1_2026",
      comparisonPeriodId: "H1_2025_restated",
      locale: "vi",
      question:
        "Phân tích FPT 6 tháng 2026 cho tôi dễ hiểu: kết quả có tốt lên không, lợi nhuận có thành tiền không, và điều gì đáng lo nhất?",
      requiredMetricIds: ["profit_after_tax", "operating_cash_flow"],
    },
    {
      id: "fpt-annual-profitability",
      companyId: "FPT",
      periodId: "FY2025",
      comparisonPeriodId: "FY2024",
      locale: "vi",
      question: "FPT năm 2025 có kiếm lời hiệu quả hơn năm 2024 không? Giải thích ngắn gọn.",
      requiredMetricIds: ["gross_profit", "profit_after_tax", "revenue"],
    },
    {
      id: "fpt-h1-attribution",
      companyId: "FPT",
      periodId: "H1_2026",
      comparisonPeriodId: "H1_2025_restated",
      locale: "vi",
      question: "Sao lợi nhuận của cổ đông công ty mẹ lại cao hơn tổng lợi nhuận? Lệch bao nhiêu?",
      requiredMetricIds: ["profit_after_tax", "profit_parent"],
    },
    {
      id: "gmd-h1-earnings-quality",
      companyId: "GMD",
      periodId: "H1_2026",
      comparisonPeriodId: "H1_2025",
      locale: "en",
      question:
        "Is GMD's strong interim profit repeatable? Explain the disclosed disposal gain, its share of financial income, available cash evidence and what remains uncertain.",
      requiredMetricIds: ["financial_income", "disposal_gain"],
    },
  ],
});

// The evaluator uses the repository root; an explicit directory supports
// isolated identity regression fixtures without changing application files.
export async function getLiveReportImplementationIdentity({ directory = root } = {}) {
  const paths = [
    "worker/securities/model.js",
    "worker/securities/model-contract.js",
    "worker/securities/model-report.js",
    "worker/securities/model-transport.js",
    "shared/securities/finance.js",
    "shared/securities/report.js",
    "shared/securities/verified-source-facts.js",
    "shared/securities/report-contract.js",
    "shared/securities/receipt-identity.js",
    "scripts/securities/source-evidence.mjs",
    "scripts/securities/source-fact-reader.mjs",
    "scripts/securities/source-extraction-integrity.mjs",
    "scripts/securities/source-verified-facts.mjs",
    "scripts/securities/source-quality.mjs",
    "scripts/securities/source-layout.mjs",
    "scripts/securities/verify-live-report.mjs",
    "scripts/securities/live-receipt-costs.mjs",
    "shared/securities/catalog.js",
    "shared/securities/source-contract.js",
    "shared/securities/dossier.js",
  ];
  const files = await Promise.all(
    paths.map(async (file) => ({
      file,
      sha256: sha256(await readFile(path.join(directory, file))),
    })),
  );
  return { files, sha256: sha256(JSON.stringify(files)) };
}

export async function assertReportLocalGates(receiptPath, implementation) {
  if (typeof receiptPath !== "string" || !receiptPath) fail("report_local_gates_required");
  let raw;
  try {
    raw = await readFile(receiptPath);
  } catch {
    fail("report_local_gates_unreadable");
  }
  let receipt;
  try {
    receipt = JSON.parse(raw.toString("utf8"));
  } catch {
    fail("report_local_gates_invalid");
  }
  if (
    receipt.status !== "passed" ||
    !["pnpm_check", "source_pipeline", "security_boundaries"].every(
      (gate) => receipt.gates?.[gate]?.status === "passed",
    )
  )
    fail("report_local_gates_incomplete");
  if (!/^[a-f0-9]{64}$/u.test(receipt.implementationHash ?? ""))
    fail("report_local_gates_identity_required");
  if (receipt.implementationHash !== implementation.sha256) fail("report_local_gates_stale");
  return {
    sha256: sha256(raw),
    status: receipt.status,
    implementationHash: receipt.implementationHash,
  };
}

function outputDirectory(value) {
  const directory = value
    ? path.resolve(value)
    : path.join(receiptRoot, "report-" + new Date().toISOString().replace(/[:.]/gu, "-"));
  const relative = path.relative(receiptRoot, directory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    fail("report_output_directory_invalid");
  return directory;
}

function scoreReport(entry, result) {
  const metrics = new Set(
    result.claims.flatMap((claim) => (claim.numericOrigins ?? []).map((origin) => origin.metricId)),
  );
  const checks = {
    exactModel:
      result.receipts.length > 0 &&
      result.receipts.every(
        (receipt) =>
          receipt.requestedModel === SECURITIES_MODEL_ID &&
          (receipt.outcome !== "completed" || receipt.actualModel === SECURITIES_MODEL_ID),
      ),
    realTransport: result.receipts.every((receipt) => receipt.evidenceType === "openrouter_live"),
    reportContract:
      result.reportVersion === SECURITIES_REPORT_CONTRACT &&
      result.validation?.deterministic?.status === "passed",
    consistencyCheck: result.validation?.semantic?.status === "passed",
    immutableRevision: result.revision === 1,
    requiredNumericCoverage: entry.requiredMetricIds.every((metricId) => metrics.has(metricId)),
    actualSourceReads: result.research?.steps.some(
      (step) => step.status === "read" && step.receipt?.evidenceType === "local_original",
    ),
    usefulSummary: typeof result.summary === "string" && result.summary.trim().length > 0,
    noHumanApprovalGate: result.claims.every(
      (claim) => claim.reviewStatus === "automatically_checked",
    ),
  };
  return {
    status: Object.values(checks).every(Boolean) ? "contract_checks_passed" : "partial",
    checks,
    independentSemanticReview: "pending_original_source_review",
  };
}

export async function runSecuritiesLiveReportEvaluation({
  phaseAReceiptPath,
  localGatesReceiptPath,
  outputDirectory: requestedDirectory,
  caseId,
  prepareOnly = false,
  signal,
} = {}) {
  await assertPhaseAGates(phaseAReceiptPath);
  const entries = SECURITIES_REPORT_EVALUATION_PROTOCOL.cases.filter(
    (entry) => !caseId || entry.id === caseId,
  );
  if (!entries.length) fail("unknown_report_case");
  const implementation = await getLiveReportImplementationIdentity();
  const localGates = localGatesReceiptPath
    ? await assertReportLocalGates(localGatesReceiptPath, implementation)
    : null;
  if (!prepareOnly && !localGates) fail("report_local_gates_required");
  const protocolBytes = await readFile(
    path.join(root, SECURITIES_REPORT_EVALUATION_PROTOCOL.frozenAcceptance),
  );
  const prepared = [];
  for (const entry of entries) {
    const dataset = await loadSecuritiesDataset({
      companyId: entry.companyId,
      periodId: entry.periodId,
      comparisonPeriodId: entry.comparisonPeriodId,
    });
    const dossier = createDossier(dataset, {
      id: "report-eval-" + entry.id,
      locale: entry.locale,
      query: entry.question,
    });
    prepared.push({ entry, dossier });
  }
  const frozen = {
    ...SECURITIES_REPORT_EVALUATION_PROTOCOL,
    frozenAt: new Date().toISOString(),
    selectedCases: entries,
    implementation,
    localGates,
    acceptanceProtocolSha256: sha256(protocolBytes),
    researchLimits: SECURITIES_RESEARCH_LIMITS,
    verifiedLedgers: getVerifiedSecuritiesLedgerManifests(),
    transportProfile: {
      model: SECURITIES_MODEL_ID,
      reasoningEffort: SECURITIES_MODEL_REASONING_EFFORT,
      maxOutputTokens: SECURITIES_MODEL_OUTPUT_TOKENS,
      redirects: "manual_reject_all",
      providerFallback: false,
    },
    snapshots: prepared.map(({ entry, dossier }) => ({ caseId: entry.id, dossier })),
  };
  const serialized = JSON.stringify(frozen, null, 2) + "\n";
  const protocolHash = sha256(serialized);
  const directory = outputDirectory(requestedDirectory);
  await mkdir(directory, { recursive: true });
  // An existing frozen run is never overwritten, including a failed run.
  await writeFile(path.join(directory, "protocol.json"), serialized, { flag: "wx" });
  if (prepareOnly)
    return { prepared: true, directory, protocolHash, implementationHash: implementation.sha256 };
  const capabilities = await readSecuritiesModelCapabilities();
  await writeFile(
    path.join(directory, "capabilities.json"),
    JSON.stringify(capabilities, null, 2) + "\n",
    { flag: "wx" },
  );
  if (!capabilities.capable) fail("report_model_capabilities_unavailable");
  if (signal?.aborted) fail("report_evaluation_cancelled");
  const apiKey = await readLocalSecuritiesKey({ phaseAReceiptPath });
  const env = { SECURITIES_MODEL_MODE: "live", SECURITIES_OPENROUTER_API_KEY: apiKey };
  const results = [];
  const startedAt = new Date().toISOString();
  let persistence = Promise.resolve();
  const persist = () => {
    const summary = {
      protocolVersion: frozen.version,
      protocolHash,
      requestedModel: SECURITIES_MODEL_ID,
      promptVersion: SECURITIES_PROMPT_ID,
      reportVersion: SECURITIES_REPORT_CONTRACT,
      startedAt,
      updatedAt: new Date().toISOString(),
      independentSemanticReview: "pending_original_source_review",
      costs: summarizeSecuritiesLiveCosts(results),
      results,
    };
    const text = JSON.stringify(summary, null, 2);
    if (text.includes(apiKey) || /sk-or-/iu.test(text)) fail("report_credential_output_blocked");
    persistence = persistence.then(async () => {
      const temporary = path.join(directory, "results.json.tmp");
      await writeFile(temporary, text + "\n");
      await rename(temporary, path.join(directory, "results.json"));
    });
    return persistence;
  };
  await persist();
  for (const { entry, dossier } of prepared) {
    if (signal?.aborted) break;
    const record = { caseId: entry.id, operation: "analysis", status: "running", receipts: [] };
    results.push(record);
    let diagnosticCount = 0;
    const retain = (receipt) => {
      const identity = securitiesReceiptIdentity(receipt);
      const index =
        identity === null
          ? -1
          : record.receipts.findIndex((item) => securitiesReceiptIdentity(item) === identity);
      if (index < 0) record.receipts.push(structuredClone(receipt));
      else record.receipts[index] = structuredClone(receipt);
    };
    try {
      const result = await analyzeSecurities({
        dossier,
        question: entry.question,
        locale: entry.locale,
        env,
        signal,
        readEvidence: (input) => readSecuritiesSourceEvidence(input, { signal }),
        onProgress: (progress) => {
          record.progress = progress;
          console.log(entry.id + ": " + progress.stage);
        },
        onReceipt: async (receipt) => {
          retain(receipt);
          await persist();
        },
        onDiagnostic: async (diagnostic) => {
          const text = JSON.stringify(diagnostic, null, 2);
          if (text.includes(apiKey) || /sk-or-/iu.test(text))
            fail("report_credential_output_blocked");
          diagnosticCount += 1;
          await writeFile(
            path.join(directory, entry.id + "-validation-" + diagnosticCount + ".json"),
            text + "\n",
            { flag: "wx" },
          );
        },
      });
      result.receipts.forEach(retain);
      record.result = Object.fromEntries(
        Object.entries(result).filter(([key]) => !["receipt", "receipts"].includes(key)),
      );
      record.score = scoreReport(entry, result);
      record.status = record.score.status;
    } catch (error) {
      (error.receipts ?? []).forEach(retain);
      record.status = "failed";
      record.errorCode = safeCode(error);
      if (error.validationReason) record.validationReason = error.validationReason;
    }
    await persist();
    console.log(entry.id + ": " + record.status);
    if (
      ["provider_invalid_key", "provider_credit_exhausted", "provider_request_denied"].includes(
        record.errorCode,
      )
    )
      break;
  }
  await persist();
  return {
    directory,
    protocolHash,
    results,
    costs: summarizeSecuritiesLiveCosts(results),
    passed:
      results.length === prepared.length &&
      results.every((record) => record.status === "contract_checks_passed"),
  };
}

function argumentsFrom(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (Object.hasOwn(values, key)) fail("duplicate_report_argument");
    if (key === "--prepare-only") {
      values[key] = true;
      continue;
    }
    if (
      !["--phase-a-receipt", "--local-gates-receipt", "--output-dir", "--case"].includes(key) ||
      !args[index + 1]
    )
      fail("invalid_report_arguments");
    values[key] = args[++index];
  }
  return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  try {
    const args = argumentsFrom(process.argv.slice(2));
    const result = await runSecuritiesLiveReportEvaluation({
      phaseAReceiptPath: args["--phase-a-receipt"],
      localGatesReceiptPath: args["--local-gates-receipt"],
      outputDirectory: args["--output-dir"],
      caseId: args["--case"],
      prepareOnly: args["--prepare-only"] === true,
      signal: controller.signal,
    });
    console.log(
      JSON.stringify({
        prepared: result.prepared ?? false,
        passed: result.passed ?? null,
        receiptDirectory: result.directory,
        protocolHash: result.protocolHash,
        costs: result.costs ?? null,
      }),
    );
    if (!result.prepared && !result.passed) process.exitCode = 1;
  } catch (error) {
    console.error("Report evaluation stopped: " + safeCode(error));
    process.exitCode = 1;
  }
}
