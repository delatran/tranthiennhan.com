import assert from "node:assert/strict";
import test from "node:test";
import { buildSecuritiesProseReference } from "../../scripts/securities/source-layout.mjs";

function fixture() {
  const central = [
    "The company recorded consolidated revenue of 1,234 units.",
    "The current statement compares the same reporting scope.",
    "Amounts remain tied to their original statement period.",
    "The next paragraph belongs to this same prose column.",
    "The original disclosure retains its accounting notes.",
    "No other company or reporting period is substituted.",
    "A final sentence ends the column without an inference.",
  ];
  const right = central.map(
    (_, index) => `Separate right-column observation number ${index} has independent content.`,
  );
  const lines = central.map((text, index) => ({
    y: 500 - index * 12,
    text: `Navigation ${index} ${text} ${right[index]}`,
    items: [
      { text: `Navigation ${index}`, x: 10, width: 70 },
      { text, x: 110, width: 250 },
      { text: right[index], x: 400, width: 250 },
    ],
  }));
  return {
    sourceHash: "a".repeat(64),
    parserVersion: "fixture-only",
    pages: [{ page: 1, text: lines.map((line) => line.text).join("\n"), lines }],
    central,
    right,
  };
}

test("prose layout fixture: coordinates recover ordered columns without mutating canonical rows", () => {
  const source = fixture();
  const before = structuredClone(source);
  const result = buildSecuritiesProseReference(source);
  assert.deepEqual(source, before);
  assert.equal(result.positionedPages, 1);
  const central = result.blocks.find(
    (block) => block.kind === "coordinate_column" && block.column === 1,
  );
  assert.equal(central.text, source.central.join("\n"));
  const right = result.blocks.find(
    (block) => block.kind === "coordinate_column" && block.column === 2,
  );
  assert.equal(right.text, source.right.join("\n"));
  const retained = result.blocks.reduce((sum, block) => sum + (block.itemCount || 0), 0);
  assert.equal(
    retained,
    source.pages[0].lines.reduce((sum, line) => sum + line.items.length, 0),
  );
  assert.match(result.text, /\[PDF page 1; coordinate_column 2\]/u);
});

test("prose layout fixture: changing a number, sentence order or crossing columns never passes exact containment", () => {
  const source = fixture();
  const result = buildSecuritiesProseReference(source);
  const normalize = (text) => text.replace(/\s+/gu, " ");
  const text = normalize(result.text);
  assert.ok(text.includes(normalize(source.central.slice(0, 2).join("\n"))));
  assert.ok(
    !text.includes(normalize(source.central.slice(0, 2).join("\n").replace("1,234", "9,999"))),
  );
  assert.ok(!text.includes(normalize(source.central.slice(0, 2).reverse().join("\n"))));
  assert.ok(!text.includes(`${source.central[0]} ${source.right[1]}`));
  assert.ok(!text.includes(`${source.central.at(-1)} ${source.right[0]}`));
});

test("prose layout fixture: short tables, absent coordinates and overlapping text retain canonical text", () => {
  const source = fixture();
  source.pages[0].lines = source.pages[0].lines.slice(0, 3);
  assert.equal(buildSecuritiesProseReference(source).blocks[0].kind, "canonical_page");
  source.pages[0].lines = [];
  assert.equal(buildSecuritiesProseReference(source).blocks[0].text, source.pages[0].text);
  const overlapping = fixture();
  for (const line of overlapping.pages[0].lines) line.items[2].x = 200;
  assert.equal(buildSecuritiesProseReference(overlapping).positionedPages, 0);
});

test("prose layout fixture: representation is deterministic and includes its own version and hash", () => {
  const result = buildSecuritiesProseReference(fixture());
  assert.deepEqual(result, buildSecuritiesProseReference(fixture()));
  assert.equal(result.representationVersion, "securities-coordinate-prose-v1");
  assert.match(result.textSha256, /^[a-f0-9]{64}$/u);
  assert.equal(result.canonicalExtractionPreserved, true);
});
