import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";

export const SOURCE_PARSER_VERSION = "securities-pdfjs6-tesseract7-v1";

export function normalizeSourceText(text) {
  return String(text)
    .replace(/\/uni([0-9a-f]{4})/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .normalize("NFC")
    .replace(/\u00a0/g, " ")
    .replace(/[\t ]+/g, " ")
    .trim();
}

function pdfLines(items) {
  const rows = [];
  for (const item of items.filter((entry) => typeof entry.str === "string" && entry.str.trim())) {
    const y = item.transform[5];
    let row = rows.find((entry) => Math.abs(entry.y - y) < 2.5);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ text: item.str, x: item.transform[4], width: item.width });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => ({
      y: row.y,
      text: normalizeSourceText(
        row.items
          .sort((a, b) => a.x - b.x)
          .map((item) => item.text)
          .join(" "),
      ),
      items: row.items,
    }));
}

function ocrLines(tsv) {
  const groups = new Map();
  for (const row of String(tsv || "")
    .split("\n")
    .slice(1)) {
    const fields = row.split("\t");
    if (fields.length < 12 || fields[0] !== "5" || !fields[11]?.trim()) continue;
    const key = fields.slice(1, 5).join(":");
    const line = groups.get(key) || { y: Number(fields[7]), words: [], confidence: 100 };
    line.words.push({
      text: fields.slice(11).join("\t"),
      x: Number(fields[6]),
      confidence: Number(fields[10]),
    });
    line.confidence = Math.min(line.confidence, Number(fields[10]));
    groups.set(key, line);
  }
  return [...groups.values()].map((line) => ({
    ...line,
    text: normalizeSourceText(line.words.map((word) => word.text).join(" ")),
  }));
}

/** Local parser. The original file remains immutable; OCR never grants verified status. */
export async function extractSecuritiesPdf(
  file,
  outputDirectory,
  { pages, ocr = true, signal, timeoutMs = 1_200_000, onProgress = () => {} } = {},
) {
  if ((await stat(file)).size > 20 * 1024 * 1024) throw new Error("source_too_large");
  signal?.throwIfAborted();
  await mkdir(outputDirectory, { recursive: true });
  const deadline = AbortSignal.timeout(timeoutMs);
  const taskSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const bounded = async (promise, stageTimeoutMs = 60_000) => {
    const stage = AbortSignal.any([taskSignal, AbortSignal.timeout(stageTimeoutMs)]);
    let stop;
    const cancelled = new Promise((_, reject) => {
      stop = () =>
        reject(
          new Error(
            stage.reason?.name === "TimeoutError" ? "source_parser_timeout" : "source_cancelled",
          ),
        );
      stage.addEventListener("abort", stop, { once: true });
    });
    try {
      stage.throwIfAborted();
      return await Promise.race([promise, cancelled]);
    } finally {
      stage.removeEventListener("abort", stop);
    }
  };
  const bytes = new Uint8Array(await readFile(file, { signal: taskSignal }));
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  let previous;
  try {
    previous = JSON.parse(await readFile(path.join(outputDirectory, "extraction.json"), "utf8"));
  } catch {
    previous = null;
  }
  const cache =
    previous?.sourceHash === sourceHash && previous?.parserVersion === SOURCE_PARSER_VERSION
      ? new Map(previous.pages.map((entry) => [entry.page, entry]))
      : new Map();
  const loadingTask = getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  });
  const results = [];
  let ocrWorker;
  try {
    const document = await bounded(loadingTask.promise);
    if (document.numPages > 300) throw new Error("source_page_limit");
    for (let number = 1; number <= document.numPages; number += 1) {
      taskSignal.throwIfAborted();
      const cached = cache.get(number);
      const requested = !pages || pages.includes(number);
      if (
        cached &&
        (cached.method === "text" || cached.method === "ocr") &&
        !cached.fittedRender &&
        (!requested || cached.render)
      ) {
        results.push(cached);
        onProgress({ page: number, total: document.numPages, method: cached.method, cached: true });
        continue;
      }
      const page = await bounded(document.getPage(number));
      const content = await bounded(page.getTextContent());
      const rawText = content.items.map((item) => item.str || "").join(" ");
      const textLines = pdfLines(content.items);
      const hasText = normalizeSourceText(rawText).length >= 100;
      const entry = {
        page: number,
        method: hasText ? "text" : "scan",
        rawText,
        text: textLines.map((line) => line.text).join("\n"),
        lines: textLines,
        textLayerCharacters: rawText.length,
        verified: false,
      };
      if (requested || (!hasText && ocr)) {
        const viewport = page.getViewport({ scale: 2.5 });
        if (Math.ceil(viewport.width) * Math.ceil(viewport.height) > 12_000_000)
          throw new Error("source_page_pixels_exceeded");
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await bounded(page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise);
        const image = canvas.toBuffer("image/png");
        entry.render = `page-${number}.png`;
        await writeFile(path.join(outputDirectory, entry.render), image);
        if (!hasText && ocr) {
          ocrWorker ||= await bounded(
            createWorker(["vie", "eng"], 1, { cachePath: outputDirectory, logger: () => {} }),
            120_000,
          );
          await bounded(ocrWorker.setParameters({ preserve_interword_spaces: "1" }));
          const result = await bounded(
            ocrWorker.recognize(image, {}, { text: true, tsv: true, blocks: false }),
          );
          entry.method = "ocr";
          entry.rawOcrText = result.data.text;
          entry.rawOcrTsv = result.data.tsv;
          entry.ocrConfidence = result.data.confidence;
          entry.lines = ocrLines(result.data.tsv);
          entry.text = normalizeSourceText(result.data.text);
        }
      }
      results.push(entry);
      await writeFile(
        path.join(outputDirectory, `page-${number}.json`),
        JSON.stringify(entry, null, 2),
      );
      onProgress({ page: number, total: document.numPages, method: entry.method });
      page.cleanup();
    }
    const result = {
      schemaVersion: 1,
      parserVersion: SOURCE_PARSER_VERSION,
      sourceHash,
      pageCount: document.numPages,
      extractedAt: new Date().toISOString(),
      extractionComplete: results.every((page) => page.text.length >= 100),
      textPageCount: results.filter((page) => page.method === "text").length,
      ocrPageCount: results.filter((page) => page.method === "ocr").length,
      pages: results,
    };
    await writeFile(path.join(outputDirectory, "extraction.json"), JSON.stringify(result, null, 2));
    return result;
  } finally {
    await ocrWorker?.terminate();
    await loadingTask.destroy();
  }
}

export function extractStatementCells(extraction, rules) {
  return rules.map((rule) => {
    const page = extraction.pages.find((entry) => entry.page === rule.page);
    if (!page) throw new Error(`missing_statement_page:${rule.page}`);
    const candidates = page.lines.filter((line) => new RegExp(rule.match, "iu").test(line.text));
    if (candidates.length !== 1)
      return {
        id: rule.id,
        page: rule.page,
        rowCode: rule.rowCode,
        rawCurrent: null,
        rawComparison: null,
        extractionIssue: "ambiguous_row",
        candidates: candidates.map((line) => line.text),
      };
    const row = candidates[0];
    const numberTokens =
      row.text.match(/(?<![\d.,(−-])(?:\(\s*|[-−]\s*)?\d+(?:[.,]\d+)+(?:\s*\))?(?![\d.,])/g) || [];
    const numbers = numberTokens.filter((token) => token.replace(/\D/g, "").length >= 7);
    if (
      numbers.some(
        (token) =>
          !/^(?:\(\s*|[-−]\s*)?\d{1,3}(?:[.,]\d{3}){2,}(?:\s*\))?$/.test(token) ||
          (token.includes(".") && token.includes(",")) ||
          token.startsWith("(") !== token.trimEnd().endsWith(")"),
      )
    )
      return {
        id: rule.id,
        page: rule.page,
        rowCode: rule.rowCode,
        rawCurrent: null,
        rawComparison: null,
        extractionIssue: "invalid_numeric_pattern",
        rawRow: row.text,
      };
    if (numbers.length !== (rule.valueCount || 2))
      return {
        id: rule.id,
        page: rule.page,
        rowCode: rule.rowCode,
        rawCurrent: null,
        rawComparison: null,
        extractionIssue: "column_count",
        rawRow: row.text,
      };
    return {
      id: rule.id,
      page: rule.page,
      rowCode: rule.rowCode,
      rawCurrent: numbers[0],
      rawComparison: numbers[rule.comparisonIndex || 1],
      rawReportedComparison: rule.comparisonIndex ? numbers[1] : undefined,
      rawRow: row.text,
      extractionIssue: null,
    };
  });
}

export function cellsDigest(cells) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        cells.map(({ id, page, rowCode, rawCurrent, rawComparison }) => ({
          id,
          page,
          rowCode,
          rawCurrent,
          rawComparison,
        })),
      ),
    )
    .digest("hex");
}
