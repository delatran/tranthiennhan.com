import assert from "node:assert/strict";
import test from "node:test";
import { createDossier } from "../../shared/securities/dossier.js";
import { createAnalysisNotes, createSecuritiesXlsx } from "../../worker/securities/export.js";

function entries(bytes) {
  const result = new Map();
  const data = Buffer.from(bytes);
  let position = 0;
  while (data.readUInt32LE(position) === 0x04034b50) {
    const length = data.readUInt32LE(position + 18);
    const nameLength = data.readUInt16LE(position + 26);
    const extraLength = data.readUInt16LE(position + 28);
    const start = position + 30 + nameLength + extraLength;
    result.set(
      data.subarray(position + 30, position + 30 + nameLength).toString(),
      data.subarray(start, start + length).toString(),
    );
    position = start + length;
  }
  return result;
}

function textRows(sheet) {
  const entities = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: String.fromCharCode(34),
    apos: String.fromCharCode(39),
  };
  return [...sheet.matchAll(/<row r="(\d+)" ht="([\d.]+)"[^>]*>(.*?)<\/row>/gsu)].map(
    ([, number, height, row]) => ({
      number: Number(number),
      height: Number(height),
      cells: Object.fromEntries(
        [
          ...row.matchAll(
            /<c r="([A-Z]+)\d+"[^>]*t="inlineStr"><is><t xml:space="preserve">(.*?)<\/t><\/is><\/c>/gsu,
          ),
        ].map(([, column, value]) => [
          column,
          value.replace(/&(amp|lt|gt|quot|apos);/gu, (_, name) => entities[name]),
        ]),
      ),
    }),
  );
}

function financialCells(sheet) {
  return new Map(
    [...sheet.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/gsu)].map(
      ([, ref, attributes, content = ""]) => [
        ref,
        {
          value: content.includes("<v>") ? Number(content.match(/<v>(.*?)<\/v>/u)[1]) : null,
          formula: content.match(/<f>(.*?)<\/f>/u)?.[1] ?? null,
          style: Number(attributes.match(/s="(\d+)"/u)?.[1] ?? 0),
        },
      ],
    ),
  );
}

function evaluateArithmetic(formula, cells) {
  const tokens = formula.match(/[A-Z]+\d+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[()+*/-]/gu) ?? [];
  assert.equal(tokens.join(""), formula, "The evaluator only supports cell arithmetic.");
  let position = 0;
  const atom = () => {
    const token = tokens[position++];
    if (token === "-" || token === "+") return (token === "-" ? -1 : 1) * atom();
    if (token === "(") {
      const value = expression();
      assert.equal(tokens[position++], ")");
      return value;
    }
    if (/^[A-Z]/u.test(token ?? "")) {
      const value = cells.get(token)?.value;
      assert.equal(typeof value, "number", `Missing numeric input ${token}.`);
      return value;
    }
    assert.ok(token !== undefined && Number.isFinite(Number(token)));
    return Number(token);
  };
  const product = () => {
    let value = atom();
    while (["*", "/"].includes(tokens[position])) {
      const operator = tokens[position++];
      const right = atom();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  const expression = () => {
    let value = product();
    while (["+", "-"].includes(tokens[position])) {
      const operator = tokens[position++];
      const right = product();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  const value = expression();
  assert.equal(position, tokens.length);
  return value;
}

function bankExportDossier({ currentProfit = 12_000_000_000, currentExpense = -3 } = {}) {
  const point = (value, unit, side) => ({
    value,
    unit,
    rawText: String(value),
    originalUnit: unit,
    sourceId: "bank-fixture",
    sourceVersion: "bank-v1",
    verification: "verified",
    locator: { precision: "cell", page: 3, column: side },
  });
  return createDossier(
    {
      company: { id: "BNK", ticker: "BNK", name: "Synthetic bank export", sectorId: "banking" },
      period: { id: "FY2025", kind: "annual", scope: "consolidated" },
      comparisonPeriod: { id: "FY2024", kind: "annual", scope: "consolidated" },
      sources: [
        {
          id: "bank-fixture",
          version: "bank-v1",
          hash: "b".repeat(64),
          url: "https://example.com/synthetic-bank.pdf",
        },
      ],
      metrics: [
        {
          id: "operating_profit_before_provision",
          label: "Profit before provisions",
          unit: "VND_billion",
          current: point(currentProfit, "VND", "current"),
          comparison: point(10_000, "VND_million", "comparison"),
        },
        {
          id: "operating_expenses",
          label: "Signed operating expenses",
          unit: "VND_million",
          current: point(currentExpense, "VND_billion", "current"),
          comparison: point(-2_000_000_000, "VND", "comparison"),
        },
      ],
    },
    { id: "bank-export-fixture", locale: "en" },
  );
}

test("bank CIR workbook formulas recompute from signed source cells in mixed units", () => {
  const dossier = bankExportDossier();
  const files = entries(createSecuritiesXlsx(dossier));
  const financials = files.get("xl/worksheets/sheet2.xml");
  const cells = financialCells(financials);
  assert.equal(cells.get("D2").value, 12);
  assert.equal(cells.get("E2").value, 10);
  assert.equal(cells.get("D3").value, -3000);
  assert.equal(cells.get("E3").value, -2000);
  const findRow = (id) => {
    const metric = dossier.derivedMetrics.find((entry) => entry.id === id);
    return textRows(financials).find((row) => row.cells.A === metric.label.en).number;
  };
  const incomeRow = findRow("bank_total_operating_income");
  const ratioRow = findRow("bank_cost_to_income");
  for (const [column, expectedIncome, expectedRatio] of [
    ["D", 15, 1 / 5],
    ["E", 12, 1 / 6],
  ]) {
    const income = cells.get(`${column}${incomeRow}`);
    const ratio = cells.get(`${column}${ratioRow}`);
    assert.equal(evaluateArithmetic(income.formula, cells), expectedIncome);
    assert.equal(income.value, expectedIncome);
    assert.ok(Math.abs(evaluateArithmetic(ratio.formula, cells) - expectedRatio) < 1e-12);
    assert.ok(Math.abs(ratio.value - expectedRatio) <= 5e-9);
    assert.equal(ratio.style, 3, "CIR must retain Excel percentage formatting.");
    assert.deepEqual(
      new Set(ratio.formula.match(/[A-Z]+\d+/gu)),
      new Set([`${column}2`, `${column}3`]),
    );
  }
  assert.deepEqual(cells.get(`F${ratioRow}`), { value: null, formula: null, style: 0 });
  const changed = new Map(cells);
  changed.set("D3", { value: -6000 });
  assert.equal(evaluateArithmetic(cells.get(`D${ratioRow}`).formula, changed), 1 / 3);
  const audit = files.get("xl/worksheets/sheet4.xml");
  for (const original of [
    "12000000000 VND",
    "-3 VND_billion",
    "10000 VND_million",
    "-2000000000 VND",
    "bank-v1",
  ])
    assert.ok(audit.includes(original), original);
  const markdown = createAnalysisNotes(dossier);
  assert.ok(markdown.includes(dossier.id));
  assert.ok(markdown.includes(dossier.sources[0].hash));
  assert.ok(markdown.includes(dossier.sources[0].url));
});

test("bank CIR exports no number or formula for a nonpositive denominator or positive expense", () => {
  for (const [options, status] of [
    [{ currentProfit: -3_000_000_000 }, "nonpositive_denominator"],
    [{ currentProfit: -4_000_000_000 }, "nonpositive_denominator"],
    [{ currentExpense: 3 }, "invalid_expense_sign"],
  ]) {
    const dossier = bankExportDossier(options);
    const ratio = dossier.derivedMetrics.find((metric) => metric.id === "bank_cost_to_income");
    assert.equal(ratio.current.status, status);
    assert.equal(ratio.comparison.status, "ok");
    const files = entries(createSecuritiesXlsx(dossier));
    const financials = files.get("xl/worksheets/sheet2.xml");
    const row = textRows(financials).find((entry) => entry.cells.A === ratio.label.en).number;
    const cells = financialCells(financials);
    assert.deepEqual(cells.get(`D${row}`), { value: null, formula: null, style: 0 });
    assert.ok(Math.abs(evaluateArithmetic(cells.get(`E${row}`).formula, cells) - 1 / 6) < 1e-12);
    assert.ok(files.get("xl/worksheets/sheet4.xml").includes(status));
    assert.ok(createAnalysisNotes(dossier).includes(dossier.id));
  }
});

test("workbook normalizes mixed input units and preserves long analyst text in continuation rows", () => {
  const point = (value, unit) => ({
    value,
    unit,
    sourceId: "fixture",
    sourceVersion: "1",
    verification: "verified",
    locator: { precision: "cell", page: 1, column: "Synthetic" },
  });
  const dossier = createDossier(
    {
      company: { id: "FIX", ticker: "FIX", name: "Synthetic export fixture" },
      period: { id: "FY2025", kind: "annual", scope: "consolidated" },
      comparisonPeriod: { id: "FY2024", kind: "annual", scope: "consolidated" },
      sources: [
        {
          id: "fixture",
          version: "1",
          hash: "a".repeat(64),
          url: "https://example.com/synthetic.pdf",
        },
      ],
      metrics: [
        {
          id: "revenue",
          label: "Revenue",
          unit: "VND_billion",
          current: point(120_000, "VND_million"),
          comparison: point(100_000_000_000, "VND"),
        },
      ],
    },
    { id: "fixture-export" },
  );
  dossier.status = "approved";
  dossier.approval = { revision: 1, at: new Date().toISOString() };
  dossier.notes =
    "A".repeat(1399) + "📊 " + "Synthetic long analyst note. ".repeat(300) + "UNIQUE_NOTE_END";
  const files = entries(createSecuritiesXlsx(dossier));
  const financials = files.get("xl/worksheets/sheet2.xml");
  assert.match(financials, /<c r="D2"[^>]*><v>120<\/v>/u);
  assert.match(financials, /<c r="E2"[^>]*><v>100<\/v>/u);
  assert.match(financials, /<f>D2-E2<\/f><v>20<\/v>/u);
  assert.match(files.get("xl/worksheets/sheet1.xml"), /UNIQUE_NOTE_END/u);
  assert.match(files.get("xl/worksheets/sheet7.xml"), /UNIQUE_NOTE_END/u);
  assert.match(files.get("xl/worksheets/sheet1.xml"), /📊/u);
  assert.match(files.get("xl/worksheets/sheet7.xml"), /📊/u);
  assert.equal(files.size, 12);
  for (const [name, content] of files)
    if (name.startsWith("xl/worksheets/")) {
      assert.match(content, /&amp;RPage &amp;P<\/oddFooter>/u);
      assert.doesNotMatch(content, /&amp;N/u);
    }
});

test("AI exports retain claim source versions and locators alongside analysis lineage without changing the financial sheet", () => {
  const point = {
    value: 120,
    sourceId: "fixture",
    sourceVersion: "source-v1",
    verification: "verified",
    locator: { precision: "cell", page: 3, rowCode: "10", column: "Current" },
  };
  const dossier = createDossier(
    {
      company: { id: "FIX", ticker: "FIX", name: "Synthetic annotated export" },
      period: { id: "FY2025", kind: "annual", scope: "consolidated" },
      comparisonPeriod: { id: "FY2024", kind: "annual", scope: "consolidated" },
      sources: [
        {
          id: "fixture",
          version: "source-v1",
          hash: "a".repeat(64),
          url: "https://example.com/synthetic.pdf",
        },
      ],
      metrics: [
        {
          id: "revenue",
          label: "Revenue",
          unit: "VND_billion",
          current: point,
          comparison: { ...point, value: 100 },
        },
      ],
    },
    { id: "annotated-export-fixture" },
  );
  dossier.revision = 3;
  dossier.status = "approved";
  dossier.approval = { revision: 3, at: "2026-09-06T00:00:00.000Z" };
  const before = entries(createSecuritiesXlsx(dossier));
  dossier.analysis = {
    origin: "model",
    model: "meta/muse-spark-1.3-contributor",
    inputRevision: 1,
    summary: "Original AI terminology: kiểm toán.",
    claims: [
      {
        id: "source-review",
        kind: "source_fact",
        text: "Original model wording remains unchanged.",
        metricIds: ["revenue"],
        sourceIds: ["fixture"],
        evidenceQuotes: [
          {
            sourceId: "fixture",
            sourceVersion: "source-v1",
            sourceExcerptId: "review-note",
            quote: "The interim statement was reviewed.",
            locator: { precision: "page", page: 3, note: "Review opinion" },
          },
        ],
        numericOrigins: [
          {
            id: "fixture",
            version: "source-v1",
            metricId: "revenue",
            side: "current",
            origin: "source_extraction",
            locator: point.locator,
            sourceValue: 120,
            sourceUnit: "VND_billion",
            displayUnit: "VND_billion",
            correctionId: null,
          },
        ],
      },
    ],
    receipt: {
      evidenceType: "synthetic_test_fixture",
      actualModel: "meta/muse-spark-1.3-contributor",
      provider: "Meta",
      requestId: "gen-export-fixture",
    },
  };
  dossier.analysisLineage = {
    generatedInRevision: 2,
    carriedFromRevision: 2,
    carriedAt: "2026-09-06T00:01:00.000Z",
    reason: "analyst_notes_only",
  };
  dossier.notes = "Analyst correction: soát xét bán niên.";
  const files = entries(createSecuritiesXlsx(dossier));
  const analysis = files.get("xl/worksheets/sheet7.xml");
  for (const value of [
    "source-v1",
    "PDF page 3",
    "Row code: 10",
    "Column: Current",
    "Note: Review opinion",
    "review-note",
    "The interim statement was reviewed.",
    "Original model wording remains unchanged.",
    "soát xét bán niên",
  ])
    assert.ok(analysis.includes(value), value);
  const overview = files.get("xl/worksheets/sheet1.xml");
  for (const value of [
    "meta/muse-spark-1.3-contributor",
    "gen-export-fixture",
    "Analysis input revision",
    "Analysis carried from revision",
  ])
    assert.ok(overview.includes(value), value);
  assert.ok(
    files.get("xl/worksheets/sheet3.xml").includes("kiểm toán"),
    "Original historical summary stays in the labelled evidence audit.",
  );
  assert.equal(files.get("xl/worksheets/sheet2.xml"), before.get("xl/worksheets/sheet2.xml"));
  assert.equal(files.get("xl/styles.xml"), before.get("xl/styles.xml"));
  const markdown = createAnalysisNotes(dossier);
  for (const value of [
    "Version: source-v1",
    "PDF page 3",
    "Row code: 10",
    "Column: Current",
    "Note: Review opinion",
    "Analysis input revision: 1",
    "Analysis generated in revision: 2",
    "Analysis carried from revision: 2",
    "kiểm toán",
    "soát xét bán niên",
  ])
    assert.ok(markdown.includes(value), value);
  assert.doesNotMatch(
    files.get("xl/worksheets/sheet3.xml"),
    /Local workspace (?:original|page) path/u,
  );
  assert.doesNotMatch(markdown, /Local workspace (?:original|page) path/u);
  const source = dossier.sources[0];
  source.localOriginalUrl = `/api/securities/sources/documents/${source.id}/${source.hash}/original`;
  source.localPageUrl = `/api/securities/sources/documents/${source.id}/${source.hash}/pages/`;
  const pinnedFiles = entries(createSecuritiesXlsx(dossier));
  const pinnedMarkdown = createAnalysisNotes(dossier);
  for (const content of [pinnedFiles.get("xl/worksheets/sheet3.xml"), pinnedMarkdown]) {
    assert.ok(content.includes(source.localOriginalUrl));
    assert.ok(content.includes(`${source.localPageUrl}{pdfPage}`));
    assert.ok(content.includes("Local workspace original path"));
    assert.ok(content.includes("Local workspace page path pattern"));
    assert.ok(content.includes("Requires the running local workspace application."));
    assert.ok(
      content.indexOf(source.url) < content.indexOf(source.localOriginalUrl),
      "The official original remains primary.",
    );
  }
  assert.equal(pinnedFiles.get("xl/worksheets/sheet2.xml"), files.get("xl/worksheets/sheet2.xml"));
  delete source.localPageUrl;
  assert.ok(createAnalysisNotes(dossier).includes(source.localOriginalUrl));
  assert.doesNotMatch(createAnalysisNotes(dossier), /Local workspace page path pattern/u);
  source.localOriginalUrl = source.localOriginalUrl.replace(source.hash, "b".repeat(64));
  assert.doesNotMatch(
    createAnalysisNotes(dossier),
    /Local workspace original path/u,
    "A path pinned to another hash must not be labelled as this source.",
  );
});

test("profit growth bridge exports reproducible mixed-unit formulas with an exact sum and no invented prior comparison", () => {
  const point = (value, unit, side) => ({
    value,
    unit,
    entityId: "FIX",
    periodId: side === "current" ? "FY2025" : "FY2024",
    scope: "consolidated",
    basisId: "synthetic-consistent",
    dataKind: "actual",
    sourceId: "fixture",
    sourceVersion: "bridge-v1",
    verification: "verified",
    locator: { precision: "cell", page: 3, column: side },
  });
  const dossier = createDossier(
    {
      company: { id: "FIX", ticker: "FIX", name: "Synthetic growth bridge export" },
      period: { id: "FY2025", kind: "annual", scope: "consolidated" },
      comparisonPeriod: { id: "FY2024", kind: "annual", scope: "consolidated" },
      sources: [
        {
          id: "fixture",
          version: "bridge-v1",
          hash: "b".repeat(64),
          url: "https://example.com/synthetic-bridge.pdf",
        },
      ],
      metrics: [
        {
          id: "revenue",
          label: "Revenue",
          unit: "VND_billion",
          current: point(120_000, "VND_million", "current"),
          comparison: point(100_000_000_000, "VND", "comparison"),
        },
        {
          id: "profit_after_tax",
          label: "Consolidated profit after tax",
          unit: "VND_million",
          current: point(18, "VND_billion", "current"),
          comparison: point(10_000_000_000, "VND", "comparison"),
        },
      ],
    },
    { id: "growth-bridge-export-fixture", locale: "en" },
  );
  const files = entries(createSecuritiesXlsx(dossier));
  const financials = files.get("xl/worksheets/sheet2.xml");
  const expected = new Map([
    ["((D2*1000)-(E2*1000))*E3/(E2*1000)", 2000],
    ["(D3*(E2*1000)-E3*(D2*1000))/(E2*1000)", 6000],
  ]);
  const bridgeValues = [];
  for (const [, rowNumber, row] of financials.matchAll(/<row r="(\d+)"[^>]*>(.*?)<\/row>/gu)) {
    const current = row.match(/<c r="D\d+" s="2"><f>(.*?)<\/f><v>(.*?)<\/v><\/c>/u);
    if (!current || !expected.has(current[1])) continue;
    assert.equal(Number(current[2]), expected.get(current[1]));
    assert.match(
      row,
      /<c r="C\d+"[^>]*t="inlineStr"><is><t xml:space="preserve">VND_million<\/t><\/is><\/c>/u,
    );
    for (const column of ["E", "F", "G"])
      assert.match(row, new RegExp(`<c r="${column}${rowNumber}" s="0"/>`, "u"));
    bridgeValues.push(Number(current[2]));
  }
  assert.equal(
    bridgeValues.length,
    2,
    "Both monetary bridge components must be native Excel formulas.",
  );
  const profitChange = financials.match(/<c r="F3" s="2"><f>D3-E3<\/f><v>(.*?)<\/v><\/c>/u);
  assert.equal(Number(profitChange?.[1]), 8000);
  assert.equal(
    bridgeValues.reduce((sum, value) => sum + value, 0),
    Number(profitChange[1]),
  );
  const audit = files.get("xl/worksheets/sheet4.xml");
  for (const value of [
    "not_applicable",
    "bridge-v1",
    "120000 VND_million",
    "100000000000 VND",
    "18 VND_billion",
    "10000000000 VND",
  ])
    assert.ok(audit.includes(value), value);
  const fourthInputs = textRows(audit).filter((row) => row.cells.A?.endsWith(" · input 4"));
  assert.equal(
    fourthInputs.length,
    3,
    "The margin-point change and both growth components must each expose their fourth input in a separate audit row.",
  );
  for (const row of fourthInputs) {
    assert.match(row.cells.B, /Metric: revenue\nPeriod side: comparison\n100000000000 VND/u);
    assert.match(row.cells.B, /Version: bridge-v1/u);
    assert.match(row.cells.B, /PDF page 3\nColumn: comparison/u);
  }
});

test("long audit text splits by explicit and wrapped lines before the height ceiling without losing text or shifting financials", () => {
  const point = (value) => ({
    value,
    unit: "VND_billion",
    sourceId: "fixture",
    sourceVersion: "text-v1",
    verification: "verified",
    locator: { precision: "cell", page: 3, rowCode: "10", column: "Synthetic" },
  });
  const dossier = createDossier(
    {
      company: { id: "FIX", ticker: "FIX", name: "Synthetic multiline export" },
      period: { id: "FY2025", kind: "annual", scope: "consolidated" },
      comparisonPeriod: { id: "FY2024", kind: "annual", scope: "consolidated" },
      sources: [
        {
          id: "fixture",
          version: "text-v1",
          hash: "c".repeat(64),
          url: "https://example.com/synthetic-multiline.pdf",
        },
      ],
      metrics: [
        {
          id: "revenue",
          label: "Revenue",
          unit: "VND_billion",
          current: point(120),
          comparison: point(100),
        },
      ],
    },
    { id: "multiline-export-fixture" },
  );
  const originalFinancials = entries(createSecuritiesXlsx(dossier)).get("xl/worksheets/sheet2.xml");
  const explicitLines = Array.from(
    { length: 72 },
    (_, index) => `LINE_${String(index).padStart(2, "0")} · dữ liệu 📊`,
  ).join("\n");
  const longText = `${explicitLines}\n${"WRAPPED_".repeat(280)}\nFINAL_TEXT_SENTINEL 📊`;
  dossier.query = explicitLines;
  dossier.notes = longText;
  dossier.sources[0].rights = { note: explicitLines };
  dossier.sourceIssues.push({
    id: "synthetic-long-warning",
    code: "synthetic_long_context",
    severity: "warning",
    message: longText,
  });
  dossier.evidenceNotes.push({
    sourceId: "fixture",
    sourceVersion: "text-v1",
    locator: { page: 3 },
    text: longText,
  });
  dossier.corrections.push({
    metricId: "revenue",
    side: "current",
    periodId: "FY2025",
    revision: 1,
    originalValue: 120,
    previousValue: 120,
    value: 120,
    reason: longText,
    at: "2026-09-06T00:00:00.000Z",
    sourceChecked: true,
    sourceId: "fixture",
    sourceVersion: "text-v1",
  });
  dossier.analysis.research = {
    steps: [
      {
        id: "synthetic-long-read",
        status: "completed",
        sourceId: "fixture",
        sourceVersion: "text-v1",
        pages: [3],
        pageQuality: Array.from({ length: 72 }, (_, index) => ({
          page: index + 1,
          status: "synthetic",
          method: "fixture",
          qualityFlags: [`FLAG_${index}`],
        })),
        receipt: { evidenceType: "synthetic_test_fixture" },
      },
    ],
  };
  const files = entries(createSecuritiesXlsx(dossier));
  assert.equal(files.get("xl/worksheets/sheet2.xml"), originalFinancials);
  for (const [name, content] of files)
    if (name.startsWith("xl/worksheets/") && name !== "xl/worksheets/sheet2.xml") {
      const rows = textRows(content);
      assert.ok(
        rows.every((row) => row.height <= 308),
        `${name} must split before the 409-point ceiling.`,
      );
      for (const row of rows)
        for (const [column, value] of Object.entries(row.cells)) {
          const width = Number(
            content.match(
              new RegExp(`<col min="${column === "A" ? 1 : 2}"[^>]* width="(\\d+)"`, "u"),
            )?.[1],
          );
          const estimated = value
            .split("\n")
            .reduce(
              (sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(8, width - 6))),
              0,
            );
          assert.ok(
            estimated <= 18,
            `${name} ${column}${row.number} has ${estimated} estimated lines.`,
          );
        }
    }
  for (const [sheet, label] of [
    [1, "Analyst notes"],
    [7, "Analyst opinion"],
    [3, "Original source note for audit"],
    [5, "Analyst reason"],
  ]) {
    const rows = textRows(files.get(`xl/worksheets/sheet${sheet}.xml`)).filter(
      (row) => row.cells.A === label || row.cells.A === `${label} (continued)`,
    );
    assert.ok(rows.length > 1, `${label} needs explicit continuation rows.`);
    const expectedText =
      sheet === 3 ? `${longText}\nSource: fixture\nVersion: text-v1\nPDF page 3` : longText;
    assert.equal(rows.map((row) => row.cells.B ?? "").join(""), expectedText);
  }
  const quality = textRows(files.get("xl/worksheets/sheet3.xml")).filter((row) =>
    row.cells.A?.startsWith("Page quality observations"),
  );
  assert.ok(quality.length > 1);
  assert.match(
    quality.map((row) => row.cells.B ?? "").join(""),
    /Page 72: synthetic; method fixture; FLAG_71/u,
  );
});
