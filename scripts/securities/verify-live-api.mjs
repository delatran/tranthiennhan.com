import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createDossier } from "../../shared/securities/dossier.js";
import { SECURITIES_SOURCE_DOCUMENTS } from "../../shared/securities/source-contract.js";
import {
  analyzeSecurities,
  chatSecurities,
  searchSecuritiesSources,
  fetchSecuritiesSource,
  readSecuritiesModelCapabilities,
  SECURITIES_MODEL_ID,
  SECURITIES_PROMPT_ID,
} from "../../worker/securities/model.js";
import { assertPhaseAGates, readLocalSecuritiesKey } from "./read-local-key.mjs";
import {
  SECURITIES_MODEL_OUTPUT_TOKENS,
  SECURITIES_MODEL_REASONING_EFFORT,
} from "../../worker/securities/model-transport.js";
import {
  securitiesFetchEngine,
  SECURITIES_SEARCH_ENGINE,
} from "../../worker/securities/model-retrieval.js";
import { SECURITIES_CHAT_CONTEXT_CONTRACT } from "../../worker/securities/model-contract.js";
import { summarizeSecuritiesLiveCosts } from "./live-receipt-costs.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const receiptRoot = path.resolve(root, "../output/securities/receipts/live");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// Freeze the protocol before any paid request. These are shared-team development
// cases; neither these prompts nor their already-inspected source documents are
// an independent holdout. Any later protocol change gets a new version.
export const SECURITIES_LIVE_EVALUATION_PROTOCOL = Object.freeze({
  version: "securities-live-development-v3.1",
  frozenOn: "2026-09-06",
  amendment: {
    previousVersion: "securities-live-development-v3",
    reason:
      "After v3 synthesis passed the fixed cases, add current displayed-analysis/notes context for first chat follow-up and a supplemental coordinate-ordered prose reference for the text PDF. The previously rejected PDF paragraph matches the rendered original, while canonical raw extraction interleaves adjacent columns. The new source reference preserves all coordinate text and exact containment; it does not alter canonical extraction or verified financial cells. The v3 synthesis prompt, exact model, and output gates remain unchanged.",
    unchanged:
      "Companies, periods, source documents, user questions, numerical requirements, citation/containment gates, exact model, and analyst semantic review remain fixed. Original outcomes are retained.",
    chatOnlyExtension:
      "First follow-up receives bounded current displayed analysis and analyst notes as explicitly untrusted reference context. Historical analyses are excluded; context and UTF-8 bounds are checked before key resolution. The v3 analysis operation and its accepted financial outputs are unchanged.",
  },
  model: SECURITIES_MODEL_ID,
  promptVersion: "securities-evidence-v3",
  dataClass: "public_issuer_documents",
  split: "shared_team_development_evaluation",
  baseline: "Deterministic calculations from verified source cells and immutable source versions",
  numericAcceptance:
    "Every rendered number must be server-bound to verified metric inputs and recomputed formula results",
  interpretationAcceptance:
    "Independent analyst review of source entailment, accounting scope, restatement and causal uncertainty",
  failures: "Preserve original failed attempts; no hidden fallback; unknown cost remains null",
  noMonetaryCap: true,
  cases: [
    {
      id: "fpt-annual-analysis",
      operation: "analysis",
      companyId: "FPT",
      periodId: "FY2025",
      comparisonPeriodId: "FY2024",
      locale: "vi",
      requiredMetricIds: ["revenue", "profit_parent"],
      question:
        "Đối chiếu doanh thu và lợi nhuận của kỳ này với cùng kỳ. Nêu thay đổi đáng chú ý, bằng chứng đang có và những điểm cần kiểm chứng trước khi viết nhận định.",
    },
    {
      id: "fpt-interim-accounting",
      operation: "analysis",
      companyId: "FPT",
      periodId: "H1_2026",
      comparisonPeriodId: "H1_2025_restated",
      locale: "vi",
      requiredMetricIds: ["profit_after_tax", "profit_parent"],
      question:
        "So sánh đúng nền điều chỉnh trong hồ sơ. Giải thích vì sao lợi nhuận thuộc cổ đông công ty mẹ có thể lớn hơn lợi nhuận sau thuế hợp nhất, nếu tài liệu trong hồ sơ hỗ trợ. Phân biệt kết luận đã có nguồn với phần cần xem thêm.",
    },
    {
      id: "gmd-interim-income",
      operation: "analysis",
      companyId: "GMD",
      periodId: "H1_2026",
      comparisonPeriodId: "H1_2025",
      locale: "en",
      requiredMetricIds: ["revenue", "financial_income"],
      question:
        "Explain the period comparison and the disclosed disposal component of financial income. Distinguish the source fact from any view about recurrence or future earnings quality; retain evidence gaps.",
    },
    {
      id: "fpt-dossier-follow-up",
      operation: "chat",
      companyId: "FPT",
      periodId: "FY2025",
      comparisonPeriodId: "FY2024",
      locale: "en",
      question:
        "Within this exact company, period and dossier revision, what should I inspect in the evidence before approving the analysis? Give concrete next checks and avoid unsupported causes.",
    },
    {
      id: "fpt-official-search",
      operation: "discovery",
      companyId: "FPT",
      period: "2026 interim consolidated financial statements",
      locale: "vi",
    },
    {
      id: "fpt-disclosure-fetch",
      operation: "fetch",
      companyId: "FPT",
      locale: "vi",
      url: "https://fpt.com/vi/nha-dau-tu/thong-tin-cong-bo",
      sourceKind: "html",
    },
    {
      id: "fpt-text-pdf-fetch",
      operation: "fetch",
      companyId: "FPT",
      locale: "vi",
      sourceId: "fpt-annual-2025",
      sourceKind: "text_pdf",
    },
    {
      id: "gmd-scan-pdf-fetch",
      operation: "fetch",
      companyId: "GMD",
      locale: "vi",
      sourceId: "gmd-h1-2026",
      sourceKind: "scan_pdf",
    },
  ],
});

async function prepareRetrievalReference(entry, source) {
  if (entry.operation !== "fetch") return null;
  const sourceRoot = path.resolve(root, "../output/securities/sources");
  if (source) {
    const relativePath = `documents/${source.id}/${source.hash}/extracted/extraction.json`;
    const original = await readFile(path.join(sourceRoot, relativePath));
    const parsed = JSON.parse(original.toString("utf8"));
    if (
      parsed.sourceHash !== source.hash ||
      !Array.isArray(parsed.pages) ||
      parsed.pages.some((page, index) => page.page !== index + 1 || typeof page.text !== "string")
    ) {
      throw new Error("The frozen local PDF extraction is invalid; no key was read.");
    }
    let expectedText = parsed.pages.map((page) => page.text).join("\n\n");
    let readingOrderReference = null;
    if (source.id === "fpt-annual-2025") {
      const relativePath =
        "reading-references/fpt-annual-2025-securities-coordinate-prose-v1-9cc4484298f3d484666dd413fcb32e26016867db8802bac41f6bee32052fbd72.json";
      const bytes = await readFile(path.join(sourceRoot, relativePath));
      const fileHash = sha256(bytes);
      const reference = JSON.parse(bytes.toString("utf8"));
      if (
        fileHash !== "5703500387d0a1d56e474fbd8e1ff634360a907537b57ade9db3ae13700fb1b9" ||
        reference.sourceHash !== source.hash ||
        reference.sourceExtractionFileSha256 !== sha256(original) ||
        reference.representationVersion !== "securities-coordinate-prose-v1" ||
        typeof reference.text !== "string" ||
        reference.textSha256 !== sha256(reference.text)
      ) {
        throw new Error("The coordinate-ordered local prose reference changed; no key was read.");
      }
      expectedText = reference.text;
      readingOrderReference = {
        relativePath,
        fileHash,
        representationVersion: reference.representationVersion,
        sourceExtractionFileSha256: reference.sourceExtractionFileSha256,
        method: reference.method,
        canonicalExtractionPreserved: reference.canonicalExtractionPreserved,
      };
    }
    return {
      expectedText,
      identity: {
        kind: source.sourceType,
        sourceId: source.id,
        sourceHash: source.hash,
        relativePath,
        fileHash: sha256(original),
        textHash: sha256(expectedText),
        parserVersion: parsed.parserVersion,
        readingOrderReference,
        textCharacters: expectedText.length,
        withheldFromModel: true,
      },
    };
  }
  const expectedHash = "92e40b3258085b56cfbac91faee9628978d0470c676c56c985a634396249f452";
  const relativePath = `discovery/${expectedHash}.html`;
  const original = await readFile(path.join(sourceRoot, relativePath));
  if (sha256(original) !== expectedHash)
    throw new Error("The frozen local HTML original changed; no key was read.");
  const expectedText = original.toString("utf8");
  return {
    expectedText,
    identity: {
      kind: "html",
      sourceUrl: entry.url,
      sourceHash: expectedHash,
      relativePath,
      fileHash: expectedHash,
      textHash: sha256(expectedText),
      textCharacters: expectedText.length,
      withheldFromModel: true,
    },
  };
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (
      !["--phase-a-receipt", "--output-dir", "--case"].includes(name) ||
      !args[index + 1] ||
      Object.hasOwn(values, name)
    ) {
      throw new Error(
        "Use --phase-a-receipt <path>, with optional --output-dir <path> and --case <case-id>.",
      );
    }
    values[name] = args[index + 1];
  }
  return values;
}

function safeOutputDirectory(value) {
  const directory = value
    ? path.resolve(value)
    : path.join(receiptRoot, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const relative = path.relative(receiptRoot, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(
      "Live QA receipts must stay under the workspace output/securities/receipts/live directory.",
    );
  return directory;
}

function sourceIdentities(dossier) {
  return dossier.sources.map((source) => ({
    id: source.id,
    version: source.version,
    hash: source.hash,
    url: source.url,
    fetchedAt: source.fetchedAt,
    publishedAt: source.publishedAt,
    periodId: source.periodId,
    scope: source.scope,
    unit: source.unit,
    parserVersion: source.parserVersion,
  }));
}

function scoreResult(entry, result) {
  const checks = {
    exactModel:
      result.receipts.length > 0 &&
      result.receipts.every(
        (receipt) =>
          receipt.requestedModel === SECURITIES_MODEL_ID &&
          (receipt.outcome !== "completed" || receipt.actualModel === SECURITIES_MODEL_ID),
      ),
    realTransport: result.receipts.every((receipt) => receipt.evidenceType === "openrouter_live"),
    contract: result.receipt.validation?.status === "passed",
  };
  if (["analysis", "chat"].includes(entry.operation)) {
    checks.usefulSupportedClaim = result.claims.some((claim) =>
      ["calculated", "source_fact"].includes(claim.kind),
    );
    checks.immutableRevision = result.revision === 1;
    if (entry.operation === "analysis") {
      const coveredMetrics = new Set(
        result.claims.flatMap((claim) =>
          (claim.numericOrigins ?? []).map((origin) => origin.metricId),
        ),
      );
      checks.requiredNumericalCoverage = entry.requiredMetricIds.every((metricId) =>
        coveredMetrics.has(metricId),
      );
    }
  } else if (entry.operation === "discovery") {
    checks.searchExecuted = result.receipt.validation?.execution?.invoked === true;
    checks.officialCandidates = result.candidates.length > 0;
  } else {
    checks.fetchExecuted = result.receipt.validation?.execution?.invoked === true;
    checks.usableContent = result.status === "read";
    // A truthful scan limitation is preserved as partial, never mislabeled as
    // successful document reading merely because the provider returned 200.
  }
  return {
    status: Object.values(checks).every(Boolean) ? "passed" : "partial",
    checks,
    semanticReview: ["analysis", "chat"].includes(entry.operation) ? "required" : "not_applicable",
  };
}

export async function runSecuritiesLiveEvaluation({
  phaseAReceiptPath,
  outputDirectory,
  caseId,
  signal,
} = {}) {
  await assertPhaseAGates(phaseAReceiptPath);
  const chosen = SECURITIES_LIVE_EVALUATION_PROTOCOL.cases.filter(
    (entry) => !caseId || entry.id === caseId,
  );
  if (!chosen.length) throw new Error("Unknown evaluation case.");
  if (
    chosen.some((entry) => ["analysis", "chat"].includes(entry.operation)) &&
    SECURITIES_PROMPT_ID !== SECURITIES_LIVE_EVALUATION_PROTOCOL.promptVersion
  ) {
    const error = new Error(
      "The legacy synthesis protocol is preserved. Use verify-live-report.mjs for the current report contract; no key was read.",
    );
    error.code = "legacy_synthesis_protocol_retired";
    throw error;
  }
  const directory = safeOutputDirectory(outputDirectory);
  await mkdir(directory, { recursive: true });
  const { loadSecuritiesDataset } = await import("../../worker/securities/sources.js");
  const prepared = [];
  for (const entry of chosen) {
    const source = entry.sourceId
      ? SECURITIES_SOURCE_DOCUMENTS.find((document) => document.id === entry.sourceId)
      : null;
    const dataset = ["analysis", "chat"].includes(entry.operation)
      ? await loadSecuritiesDataset({
          companyId: entry.companyId,
          periodId: entry.periodId,
          comparisonPeriodId: entry.comparisonPeriodId,
        })
      : null;
    if (
      (entry.sourceId && !source) ||
      (["analysis", "chat"].includes(entry.operation) && !dataset)
    ) {
      throw new Error("A required frozen source dataset is unavailable; no key was read.");
    }
    const dossier = dataset
      ? createDossier(dataset, {
          id: `eval-${entry.id}`,
          locale: entry.locale,
          query: entry.question,
        })
      : null;
    const reference = await prepareRetrievalReference(entry, source);
    prepared.push({ entry, dossier, url: entry.url ?? source?.url, reference });
  }
  const frozen = {
    ...SECURITIES_LIVE_EVALUATION_PROTOCOL,
    selectedCases: chosen.map((entry) => entry.id),
    chatContextVersion: SECURITIES_CHAT_CONTEXT_CONTRACT,
    transportProfile: {
      model: SECURITIES_MODEL_ID,
      reasoningEffort: SECURITIES_MODEL_REASONING_EFFORT,
      outputTokenAllowance: SECURITIES_MODEL_OUTPUT_TOKENS,
      redirectPolicy: "manual_reject_all_redirects",
    },
    retrievalProfiles: prepared
      .filter((item) => ["discovery", "fetch"].includes(item.entry.operation))
      .map((item) => ({
        caseId: item.entry.id,
        engine:
          item.entry.operation === "discovery"
            ? SECURITIES_SEARCH_ENGINE
            : securitiesFetchEngine(item.url),
        reference: item.reference?.identity ?? null,
      })),
    sourceSnapshots: prepared
      .filter((item) => item.dossier)
      .map((item) => ({
        caseId: item.entry.id,
        dossierId: item.dossier.id,
        sourceIdentities: sourceIdentities(item.dossier),
        deterministicMetrics: item.dossier.metrics.map((metric) => ({
          id: metric.id,
          unit: metric.unit,
          current: metric.current.value,
          comparison: metric.comparison.value,
          calculation: metric.calculation,
        })),
      })),
  };
  const frozenJson = JSON.stringify(frozen, null, 2);
  const protocolHash = sha256(frozenJson);
  const protocolPath = path.join(directory, "protocol.json");
  try {
    const existing = await readFile(protocolPath, "utf8");
    if (existing !== frozenJson + "\n")
      throw new Error("This output directory already contains a different frozen protocol.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(protocolPath, frozenJson + "\n", { flag: "wx" }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  // The frozen protocol and source identity now exist on disk. Only here may the
  // gated reader resolve the authorized key. It is never written to receipts.
  const apiKey = await readLocalSecuritiesKey({ phaseAReceiptPath });
  const env = { SECURITIES_MODEL_MODE: "live", SECURITIES_OPENROUTER_API_KEY: apiKey };
  const capabilities = await readSecuritiesModelCapabilities();
  await writeFile(
    path.join(directory, "capabilities.json"),
    JSON.stringify(capabilities, null, 2) + "\n",
  );
  if (!capabilities.capable)
    throw new Error(
      "The selected model does not advertise the required capabilities. No completion was sent.",
    );
  const results = [];
  const startedAt = new Date().toISOString();
  const persist = async () => {
    const payload = {
      protocolVersion: frozen.version,
      protocolHash,
      promptVersion: frozen.promptVersion,
      requestedModel: SECURITIES_MODEL_ID,
      startedAt,
      updatedAt: new Date().toISOString(),
      status:
        results.length === prepared.length &&
        results.every((result) => result.score?.status === "passed")
          ? "contract_checks_passed"
          : "incomplete",
      independentSemanticReview: "required",
      costs: summarizeSecuritiesLiveCosts(results),
      results,
    };
    const serialized = JSON.stringify(payload, null, 2);
    if (serialized.includes(apiKey))
      throw new Error(
        "A provider response attempted to echo a credential; the artifact was blocked.",
      );
    await writeFile(path.join(directory, "results.json"), serialized + "\n");
  };
  for (const { entry, dossier, url, reference } of prepared) {
    if (signal?.aborted) break;
    try {
      let result;
      const common = {
        env,
        locale: entry.locale,
        timeoutMs: 90_000,
        signal,
        onDiagnostic: async (diagnostic) => {
          const serialized = JSON.stringify(diagnostic, null, 2);
          if (serialized.includes(apiKey) || /sk-or-/i.test(serialized))
            throw new Error("Credential-like output blocked.");
          await writeFile(path.join(directory, `${entry.id}-validation.json`), serialized + "\n");
        },
      };
      if (entry.operation === "analysis")
        result = await analyzeSecurities({ ...common, dossier, question: entry.question });
      else if (entry.operation === "chat")
        result = await chatSecurities({ ...common, dossier, question: entry.question });
      else if (entry.operation === "discovery")
        result = await searchSecuritiesSources({
          ...common,
          company: entry.companyId,
          period: entry.period,
        });
      else
        result = await fetchSecuritiesSource({
          ...common,
          company: entry.companyId,
          url,
          expectedText: reference.expectedText,
        });
      const score = scoreResult(entry, result);
      results.push({
        caseId: entry.id,
        operation: entry.operation,
        score,
        receipts: result.receipts,
        // Public-source output retained in this private QA artifact for analyst
        // review. No full raw provider envelope or application log is written.
        result: Object.fromEntries(
          Object.entries(result).filter(([key]) => !["receipts", "receipt"].includes(key)),
        ),
      });
      console.log(`${entry.id}: ${score.status}`);
    } catch (error) {
      const code =
        typeof error.code === "string" && /^[a-z][a-z0-9_]{1,80}$/.test(error.code)
          ? error.code
          : "verification_failed";
      results.push({
        caseId: entry.id,
        operation: entry.operation,
        score: { status: "failed" },
        errorCode: code,
        receipts: error.receipts ?? [],
      });
      console.log(`${entry.id}: failed (${code})`);
      if (
        ["provider_invalid_key", "provider_credit_exhausted", "provider_request_denied"].includes(
          code,
        )
      ) {
        await persist();
        break;
      }
    }
    await persist();
  }
  await persist();
  return {
    directory,
    results,
    costs: summarizeSecuritiesLiveCosts(results),
    passed:
      results.length === prepared.length &&
      results.every((result) => result.score?.status === "passed"),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  process.once("SIGINT", () =>
    controller.abort(new DOMException("Evaluation cancelled", "AbortError")),
  );
  process.once("SIGTERM", () =>
    controller.abort(new DOMException("Evaluation cancelled", "AbortError")),
  );
  try {
    const args = parseArguments(process.argv.slice(2));
    const result = await runSecuritiesLiveEvaluation({
      phaseAReceiptPath: args["--phase-a-receipt"],
      outputDirectory: args["--output-dir"],
      caseId: args["--case"],
      signal: controller.signal,
    });
    console.log(
      JSON.stringify({
        status: result.passed ? "contract_checks_passed" : "incomplete",
        receiptDirectory: result.directory,
        costs: result.costs,
      }),
    );
    if (!result.passed) process.exitCode = 1;
  } catch {
    // Deliberately omit raw exceptions: an upstream client or filesystem error
    // may contain headers, private paths, or uncontrolled diagnostic text.
    console.error(
      "Live verification did not complete. Check the Phase A receipt, source availability, and any saved operation receipts.",
    );
    process.exitCode = 1;
  }
}
