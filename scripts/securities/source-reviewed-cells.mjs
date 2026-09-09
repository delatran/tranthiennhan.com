import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  getReviewedSecuritiesSourceCells,
  VERIFIED_CELLS_DIGESTS,
} from "../../shared/securities/catalog.js";
import { cellsDigest } from "./source-extract.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function verifyArtifact(directory, relative, expected, signal) {
  signal?.throwIfAborted();
  const root = await realpath(directory);
  const file = await realpath(path.join(root, relative));
  const relation = path.relative(root, file);
  if (
    !relation ||
    relation === ".." ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
  )
    throw new Error("reviewed_cell_artifact_path_rejected");
  const info = await stat(file);
  if (!info.isFile() || info.size > 20 * 1024 * 1024)
    throw new Error("reviewed_cell_artifact_size_rejected");
  if (hash(await readFile(file, { signal })) !== expected)
    throw new Error("reviewed_cell_artifact_hash_mismatch");
}

/** Only committed transcriptions can replace known OCR errors. Raw extraction stays intact. */
export async function readReviewedSecuritiesStatementCells(source, { directory, signal } = {}) {
  const review = getReviewedSecuritiesSourceCells(source.id, source.hash);
  if (!review) return null;
  if (
    cellsDigest(review.cells) !== review.cellsDigest ||
    review.cellsDigest !== VERIFIED_CELLS_DIGESTS[source.id] ||
    review.cells.some((cell) => !Object.hasOwn(review.pageRenderHashes, cell.page))
  )
    throw new Error("reviewed_cell_contract_mismatch");
  await verifyArtifact(directory, "original.pdf", review.sourceHash, signal);
  for (const [page, expected] of Object.entries(review.pageRenderHashes))
    await verifyArtifact(directory, `extracted/page-${page}.png`, expected, signal);
  const { cells, ...receipt } = review;
  return { cells, receipt };
}
