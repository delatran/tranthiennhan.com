import { createHash } from "node:crypto";

export const SECURITIES_PROSE_REFERENCE_VERSION = "securities-coordinate-prose-v1";
const METHOD = "stable_left_edges_nonoverlapping_columns_ordered_by_pdf_coordinates";
const EDGE_TOLERANCE = 2.5;
const MINIMUM_GUTTER = 12;

function positionedItems(page) {
  return (page.lines || [])
    .flatMap((line, row) =>
      (line.items || []).map((item, index) => ({
        text: item.text,
        x: item.x,
        width: item.width,
        y: line.y,
        identity: `${row}:${index}`,
      })),
    )
    .filter(
      (item) =>
        typeof item.text === "string" &&
        item.text.trim() &&
        [item.x, item.y, item.width].every(Number.isFinite) &&
        item.width > 0 &&
        item.x >= 0,
    );
}

function proseColumns(items) {
  // A recurring left edge of long alphabetic text provides a layout signal;
  // neither a requested quotation nor financial values participate in this step.
  const anchors = items.filter(
    (item) => item.width >= 80 && (item.text.match(/\p{L}/gu) || []).length >= 24,
  );
  const clusters = [];
  for (const item of [...anchors].sort((a, b) => a.x - b.x)) {
    let cluster = clusters.find((entry) => Math.abs(entry.left - item.x) <= EDGE_TOLERANCE);
    if (!cluster) {
      cluster = { left: item.x, items: [] };
      clusters.push(cluster);
    }
    cluster.items.push(item);
  }
  const candidates = clusters
    .filter((cluster) => {
      const rows = [...new Set(cluster.items.map((item) => item.y))];
      return rows.length >= 6 && Math.max(...rows) - Math.min(...rows) >= 60;
    })
    .map((cluster) => {
      const ends = cluster.items.map((item) => item.x + item.width).sort((a, b) => a - b);
      const right = ends[Math.floor((ends.length - 1) * 0.8)];
      return {
        left: cluster.left,
        right,
        supportingRows: new Set(cluster.items.map((item) => item.y)).size,
        weight: cluster.items.length * (right - cluster.left),
      };
    });
  const chosen = [];
  for (const candidate of candidates.sort((a, b) => b.weight - a.weight || a.left - b.left)) {
    if (
      chosen.every(
        (column) =>
          candidate.right + MINIMUM_GUTTER <= column.left ||
          column.right + MINIMUM_GUTTER <= candidate.left,
      )
    )
      chosen.push(candidate);
  }
  if (chosen.length < 2) return [];
  const lastEdge = Math.max(...items.map((item) => item.x + item.width));
  return chosen
    .sort((a, b) => a.left - b.left)
    .map((column, index, ordered) => ({
      left: column.left - EDGE_TOLERANCE,
      right: ordered[index + 1]
        ? ordered[index + 1].left - MINIMUM_GUTTER / 2
        : lastEdge + EDGE_TOLERANCE,
      supportingRows: column.supportingRows,
    }));
}

function orderedText(items) {
  const rows = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    let row = rows.find((entry) => Math.abs(entry.y - item.y) < 2.5);
    if (!row) {
      row = { y: item.y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }
  return rows
    .map((row) =>
      row.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text.trim())
        .join(" "),
    )
    .join("\n");
}

/** Supplemental prose only. It never changes the canonical page text or table
 * rows. Every positioned item is assigned once, and block markers prevent an
 * exact match from silently skipping between unrelated columns or pages. */
export function buildSecuritiesProseReference(extraction) {
  if (
    !extraction ||
    !Array.isArray(extraction.pages) ||
    extraction.pages.length > 300 ||
    !/^[a-f0-9]{64}$/u.test(extraction.sourceHash || "")
  )
    throw new Error("invalid_prose_reference_source");
  const blocks = [];
  let totalItems = 0;
  let positionedPages = 0;
  for (const page of extraction.pages) {
    if (!Number.isSafeInteger(page.page) || page.page < 1 || typeof page.text !== "string")
      throw new Error("invalid_prose_reference_page");
    const items = positionedItems(page);
    totalItems += items.length;
    if (totalItems > 500_000) throw new Error("prose_reference_item_limit");
    const columns = proseColumns(items);
    if (!columns.length) {
      blocks.push({ page: page.page, kind: "canonical_page", text: page.text });
      continue;
    }
    positionedPages += 1;
    const assigned = new Set();
    for (const [index, column] of columns.entries()) {
      const members = items.filter(
        (item) =>
          !assigned.has(item.identity) &&
          item.x >= column.left &&
          item.x + item.width <= column.right,
      );
      for (const item of members) assigned.add(item.identity);
      if (!members.length) continue;
      blocks.push({
        page: page.page,
        kind: "coordinate_column",
        column: index + 1,
        region: {
          left: column.left,
          right: column.right,
          bottom: Math.min(...members.map((item) => item.y)),
          top: Math.max(...members.map((item) => item.y)),
        },
        supportingRows: column.supportingRows,
        itemCount: members.length,
        text: orderedText(members),
      });
    }
    const remaining = items.filter((item) => !assigned.has(item.identity));
    if (remaining.length)
      blocks.push({
        page: page.page,
        kind: "remaining_positioned_text",
        itemCount: remaining.length,
        text: orderedText(remaining),
      });
    if (assigned.size + remaining.length !== items.length)
      throw new Error("prose_reference_item_loss");
  }
  const text = blocks
    .map(
      (block) =>
        `[PDF page ${block.page}; ${block.kind}${block.column ? ` ${block.column}` : ""}]\n${block.text}`,
    )
    .join("\n\n");
  return {
    schemaVersion: 1,
    representationVersion: SECURITIES_PROSE_REFERENCE_VERSION,
    method: METHOD,
    sourceHash: extraction.sourceHash,
    parserVersion: extraction.parserVersion ?? null,
    pageCount: extraction.pages.length,
    positionedPages,
    coordinateConvention: "PDF user units, origin at bottom left",
    canonicalExtractionPreserved: true,
    textSha256: createHash("sha256").update(text).digest("hex"),
    blocks,
    text,
  };
}
