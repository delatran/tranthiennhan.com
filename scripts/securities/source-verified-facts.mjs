import { createHash } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import {
  SECURITIES_SOURCE_DOCUMENTS,
  parseVndToMillion,
} from "../../shared/securities/source-contract.js";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const sourcesDirectory = path.resolve(repository, "../output/securities/sources");
const target = path.join(repository, "shared/securities/verified-source-facts.js");
const hash = (value) => createHash("sha256").update(value).digest("hex");

export const VERIFIED_FACT_LEDGER_DESCRIPTORS = Object.freeze([
  Object.freeze({
    id: "supplemental-source-ledger-v1",
    fileName: "supplemental-source-ledger-v1.json",
    sha256: "3e9145c1f74806209ac91891c312109e1c6a1683ea4eb33902bd9059ddc6fae7",
    proofId: "protocol-freeze-v1",
    proofFileName: "protocol-freeze-v1.json",
    proofSha256: "6251f5d10b8a6b183d0b774eb489f6068547fb4368f30df7dc309082cf20459c",
    acceptedIds: Object.freeze([
      "fpt-h1-cfo-current",
      "fpt-h1-cfo-prior-reported",
      "fpt-h1-nci-current",
      "fpt-h1-nci-prior-restated",
      "fpt-h1-nci-prior-reported",
    ]),
  }),
  Object.freeze({
    id: "supplemental-source-ledger-v2",
    fileName: "supplemental-source-ledger-v2.json",
    sha256: "f288b762da12155e8eb8059cdb8cd94cad12852c37675b7198d0a7e9df625daf",
    proofId: "source-addendum-v2-proof",
    proofFileName: "source-addendum-v2-proof.json",
    proofSha256: "05d5ac4d3445d3991b31a2fad250ce34e282e8950358e20f27944c54737c6adb",
    acceptedIds: Object.freeze(["gmd-h1-disposal-gain-current", "gmd-h1-disposal-gain-prior-dash"]),
  }),
]);

const DEFINITIONS = Object.freeze({
  operating_cash_flow: {
    vi: "Dòng tiền thuần từ hoạt động kinh doanh",
    en: "Net cash from operating activities",
  },
  profit_noncontrolling: {
    vi: "LNST thuộc cổ đông không kiểm soát",
    en: "Profit attributable to non-controlling interests",
  },
  disposal_gain: {
    vi: "Lãi chuyển nhượng khoản đầu tư tài chính dài hạn",
    en: "Long-term investment disposal gain",
  },
});

async function pinnedFile(root, relative, expected, signal) {
  signal?.throwIfAborted();
  const base = await realpath(root);
  const file = await realpath(path.join(base, relative));
  const relation = path.relative(base, file);
  if (
    !relation ||
    relation === ".." ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
  )
    throw new Error("verified_source_fact_path_rejected");
  const info = await stat(file);
  if (!info.isFile() || info.size > 20 * 1024 * 1024)
    throw new Error("verified_source_fact_size_rejected");
  const bytes = await readFile(file, { signal });
  if (hash(bytes) !== expected) throw new Error("verified_source_fact_hash_mismatch");
  return bytes;
}

function projectCell(cell, descriptor) {
  const source = SECURITIES_SOURCE_DOCUMENTS.find(
    (entry) => entry.id === cell.sourceId && entry.hash === cell.sourceSha256,
  );
  const metricId =
    cell.concept === "long_term_financial_investment_disposal_gain"
      ? "disposal_gain"
      : cell.concept;
  if (
    !source ||
    !DEFINITIONS[metricId] ||
    cell.sourceUnit !== "VND" ||
    cell.verification !== "independent_visual_original_render" ||
    !Number.isSafeInteger(cell.locator?.page) ||
    cell.locator.page < 1 ||
    cell.locator.page > source.pageCount ||
    cell.locator.precision !== "cell" ||
    !/^[a-f0-9]{64}$/u.test(cell.render?.sha256 ?? "")
  ) {
    throw new Error("verified_source_fact_invalid");
  }
  if (cell.valueVnd === null) {
    if (cell.rawText !== "-") throw new Error("verified_source_fact_missing_invalid");
  } else if (
    !/^-?(?:0|[1-9][0-9]*)$/u.test(cell.valueVnd) ||
    parseVndToMillion(cell.rawText) !==
      `${BigInt(cell.valueVnd) < 0n ? "-" : ""}${(BigInt(cell.valueVnd) < 0n ? -BigInt(cell.valueVnd) : BigInt(cell.valueVnd)) / 1_000_000n}.${String((BigInt(cell.valueVnd) < 0n ? -BigInt(cell.valueVnd) : BigInt(cell.valueVnd)) % 1_000_000n).padStart(6, "0")}`
  ) {
    throw new Error("verified_source_fact_numeric_mismatch");
  }
  const periodId =
    cell.periodId === "H1_2025" && cell.basisId === "ftel_full_consolidation"
      ? "H1_2025_reported"
      : cell.periodId;
  return {
    id: metricId,
    factId: cell.id,
    side: periodId === source.periodId ? "current" : "comparison",
    label: structuredClone(DEFINITIONS[metricId]),
    sourceId: source.id,
    sourceVersion: `sha256:${source.hash}`,
    sourceHash: source.hash,
    value: cell.valueVnd,
    unit: "VND",
    rawText: cell.rawText,
    periodId,
    scope: cell.scope,
    entityId: source.companyId,
    basisId: cell.basisId === "reported" ? "source_reported" : cell.basisId,
    dataKind: "actual",
    verification: "verified",
    locator: cell.locator,
    verificationReceipt: {
      id: descriptor.id,
      sha256: descriptor.sha256,
      proofId: descriptor.proofId,
      proofSha256: descriptor.proofSha256,
      renderSha256: cell.render.sha256,
      method: cell.verification,
    },
    basisNote: cell.basisNote,
  };
}

/** Maintenance-only projection from an explicitly selected independent review.
 * Runtime readers use the committed facts and public originals instead. */
export async function readPinnedVerifiedSecuritiesFacts(
  { sourceId, sourceHash, pages },
  { directory = sourcesDirectory, qaDirectory, signal } = {},
) {
  if (typeof qaDirectory !== "string" || !qaDirectory.trim())
    throw new Error("verified_source_fact_review_directory_required");
  const source = SECURITIES_SOURCE_DOCUMENTS.find(
    (entry) => entry.id === sourceId && entry.hash === sourceHash,
  );
  if (!source) return { facts: [], ledgerHashes: [] };
  const facts = [];
  const ledgerHashes = [];
  for (const descriptor of VERIFIED_FACT_LEDGER_DESCRIPTORS) {
    const relevant = descriptor.acceptedIds.some((id) =>
      id.startsWith(source.companyId.toLowerCase()),
    );
    if (!relevant) continue;
    const [bytes] = await Promise.all([
      pinnedFile(qaDirectory, descriptor.fileName, descriptor.sha256, signal),
      pinnedFile(qaDirectory, descriptor.proofFileName, descriptor.proofSha256, signal),
    ]);
    const ledger = JSON.parse(bytes.toString("utf8"));
    const selected = ledger.cells.filter((cell) => descriptor.acceptedIds.includes(cell.id));
    if (
      selected.length !== descriptor.acceptedIds.length ||
      new Set(selected.map((cell) => cell.id)).size !== selected.length
    )
      throw new Error("verified_source_fact_ledger_incomplete");
    for (const cell of selected.filter(
      (entry) => entry.sourceId === source.id && (!pages || pages.includes(entry.locator.page)),
    )) {
      const fact = projectCell(cell, descriptor);
      await pinnedFile(
        directory,
        `documents/${source.id}/${source.hash}/extracted/page-${fact.locator.page}.png`,
        fact.verificationReceipt.renderSha256,
        signal,
      );
      facts.push(fact);
    }
    if (facts.some((fact) => fact.verificationReceipt.sha256 === descriptor.sha256))
      ledgerHashes.push(descriptor.sha256);
  }
  return { facts, ledgerHashes };
}

function publicManifest(descriptor) {
  const { acceptedIds, ...manifest } = descriptor;
  return manifest;
}

export async function generateVerifiedSecuritiesFactsModule({
  check = false,
  directory = sourcesDirectory,
  qaDirectory,
} = {}) {
  if (typeof qaDirectory !== "string" || !qaDirectory.trim())
    throw new Error("verified_source_fact_review_directory_required");
  const facts = [];
  for (const source of SECURITIES_SOURCE_DOCUMENTS) {
    await pinnedFile(directory, `documents/${source.id}/${source.hash}/original.pdf`, source.hash);
    const verified = await readPinnedVerifiedSecuritiesFacts(
      { sourceId: source.id, sourceHash: source.hash },
      { directory, qaDirectory },
    );
    facts.push(...verified.facts);
  }
  const moduleSource = `// Generated by scripts/securities/source-verified-facts.mjs from hash-pinned independent QA.\n// Do not hand-edit source values or grant verification from caller-provided receipts.\nexport const VERIFIED_SOURCE_FACTS_VERSION = "securities-verified-source-facts-v1";\n\nconst LEDGERS = ${JSON.stringify(VERIFIED_FACT_LEDGER_DESCRIPTORS.map(publicManifest), null, 2)};\n\nconst FACTS = ${JSON.stringify(facts, null, 2)};\n\nexport function getVerifiedSecuritiesLedgerManifests() { return structuredClone(LEDGERS); }\n\nexport function getVerifiedSecuritiesFacts({ sourceId, sourceVersion } = {}) {\n  return structuredClone(FACTS.filter((fact) => fact.sourceId === sourceId && fact.sourceVersion === sourceVersion));\n}\n\nfunction sameValue(value, canonical) {\n  if (value === canonical) return true;\n  if (!value || !canonical || typeof value !== "object" || typeof canonical !== "object"\n    || Array.isArray(value) !== Array.isArray(canonical)) return false;\n  const keys = Object.keys(canonical);\n  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key) && sameValue(value[key], canonical[key]));\n}\n\nexport function matchVerifiedSecuritiesFact(value) {\n  if (!value || typeof value !== "object" || Array.isArray(value)) return null;\n  const found = FACTS.find((fact) => fact.factId === value.factId && sameValue(value, fact));\n  return found ? structuredClone(found) : null;\n}\n`;
  const serialized = await format(moduleSource, {
    ...(await resolveConfig(target)),
    filepath: target,
  });
  if (check) {
    if ((await readFile(target, "utf8")) !== serialized)
      throw new Error("verified_source_facts_generated_file_differs");
  } else await writeFile(target, serialized);
  return {
    factCount: facts.length,
    ledgerCount: VERIFIED_FACT_LEDGER_DESCRIPTORS.length,
    sha256: hash(serialized),
    checked: check,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const usage =
    "Use --check or --write with --qa-directory <review-directory> and optional --directory <collected-source-directory>.";
  if (!["--write", "--check"].includes(args[0]) || ![3, 5].includes(args.length))
    throw new Error(usage);
  const options = { check: args[0] === "--check" };
  for (let index = 1; index < args.length; index += 2) {
    const key =
      args[index] === "--qa-directory"
        ? "qaDirectory"
        : args[index] === "--directory"
          ? "directory"
          : null;
    if (!key || !args[index + 1] || Object.hasOwn(options, key)) throw new Error(usage);
    options[key] = args[index + 1];
  }
  if (!options.qaDirectory) throw new Error(usage);
  process.stdout.write(JSON.stringify(await generateVerifiedSecuritiesFactsModule(options)) + "\n");
}
