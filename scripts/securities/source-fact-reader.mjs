import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SECURITIES_SOURCE_DOCUMENTS } from "../../shared/securities/source-contract.js";
import {
  getVerifiedSecuritiesFacts,
  getVerifiedSecuritiesLedgerManifests,
  matchVerifiedSecuritiesFact,
} from "../../shared/securities/verified-source-facts.js";

const SOURCE_DIRECTORY = fileURLToPath(
  new URL("../../../output/securities/sources/", import.meta.url),
);
const HASH = /^[a-f0-9]{64}$/u;

async function verifyFile(directory, relative, expectedHash, signal) {
  signal?.throwIfAborted();
  const root = await realpath(directory);
  const resolved = await realpath(path.join(root, relative));
  const relation = path.relative(root, resolved);
  if (
    !relation ||
    relation === ".." ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
  ) {
    throw new Error("verified_source_fact_path_rejected");
  }
  const info = await stat(resolved);
  if (!info.isFile() || info.size < 1 || info.size > 20 * 1024 * 1024) {
    throw new Error("verified_source_fact_size_rejected");
  }
  const bytes = await readFile(resolved, { signal });
  if (
    bytes.length !== info.size ||
    bytes.length > 20 * 1024 * 1024 ||
    createHash("sha256").update(bytes).digest("hex") !== expectedHash
  ) {
    throw new Error("verified_source_fact_hash_mismatch");
  }
}

function validateFact(fact, source, ledgers) {
  const receipt = fact.verificationReceipt;
  const ledger = ledgers.find((entry) => entry.id === receipt?.id);
  if (
    !matchVerifiedSecuritiesFact(fact) ||
    fact.sourceHash !== source.hash ||
    fact.entityId !== source.companyId ||
    fact.verification !== "verified" ||
    !Number.isSafeInteger(fact.locator?.page) ||
    fact.locator.page < 1 ||
    fact.locator.page > source.pageCount ||
    fact.locator.precision !== "cell" ||
    !HASH.test(receipt?.renderSha256 ?? "") ||
    !ledger ||
    receipt.sha256 !== ledger.sha256 ||
    receipt.proofId !== ledger.proofId ||
    receipt.proofSha256 !== ledger.proofSha256 ||
    receipt.method !== "independent_visual_original_render"
  ) {
    throw new Error("verified_source_fact_invalid");
  }
}

/** Runtime validation uses committed reviewed facts as its trust root. Private
 * review ledgers are inputs to their generator, never dependencies of a read. */
export async function readVerifiedSecuritiesSourceFacts(
  { sourceId, sourceHash, pages },
  { directory = SOURCE_DIRECTORY, signal } = {},
) {
  signal?.throwIfAborted();
  const source = SECURITIES_SOURCE_DOCUMENTS.find(
    (entry) => entry.id === sourceId && entry.hash === sourceHash,
  );
  if (!source) return { facts: [], ledgerHashes: [] };
  if (
    pages !== undefined &&
    (!Array.isArray(pages) ||
      new Set(pages).size !== pages.length ||
      pages.some((page) => !Number.isSafeInteger(page) || page < 1 || page > source.pageCount))
  ) {
    throw new Error("verified_source_fact_pages_invalid");
  }
  const facts = getVerifiedSecuritiesFacts({
    sourceId,
    sourceVersion: `sha256:${sourceHash}`,
  }).filter((fact) => pages === undefined || pages.includes(fact.locator.page));
  if (!facts.length) return { facts: [], ledgerHashes: [] };
  const ledgers = getVerifiedSecuritiesLedgerManifests();
  facts.forEach((fact) => validateFact(fact, source, ledgers));
  const folder = `documents/${source.id}/${source.hash}`;
  await verifyFile(directory, `${folder}/original.pdf`, source.hash, signal);
  const pageHashes = new Map();
  for (const fact of facts) {
    const previous = pageHashes.get(fact.locator.page);
    if (previous && previous !== fact.verificationReceipt.renderSha256)
      throw new Error("verified_source_fact_page_conflict");
    pageHashes.set(fact.locator.page, fact.verificationReceipt.renderSha256);
  }
  for (const [page, expectedHash] of pageHashes) {
    await verifyFile(directory, `${folder}/extracted/page-${page}.png`, expectedHash, signal);
  }
  signal?.throwIfAborted();
  return {
    facts,
    ledgerHashes: [...new Set(facts.map((fact) => fact.verificationReceipt.sha256))],
  };
}
