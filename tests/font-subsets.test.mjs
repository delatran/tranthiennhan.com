import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { content } from "../src/content.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const weights = ["400", "500", "600", "700"];
const subsets = ["vietnamese", "latin"];
const formats = ["woff2", "woff"];

async function source(relativePath) {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

function normalizeRange(value) {
  return value.replace(/\s+/gu, "").toUpperCase();
}

function parseUnicodeRange(value) {
  return normalizeRange(value)
    .split(",")
    .map((entry) => {
      const match = /^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/u.exec(entry);
      assert.ok(match, `invalid unicode-range entry: ${entry}`);
      return [
        Number.parseInt(match[1], 16),
        Number.parseInt(match[2] ?? match[1], 16),
      ];
    });
}

function isCovered(codePoint, ranges) {
  return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function assertFontFaceDescriptors(css, unicodeMetadata) {
  const faces = css.match(/@font-face\s*\{[^}]+\}/gu) ?? [];

  assert.equal(faces.length, weights.length * subsets.length);
  assert.doesNotMatch(css, /latin-ext/iu);

  for (const weight of weights) {
    for (const subset of subsets) {
      const marker = `be-vietnam-pro-${subset}-${weight}-normal`;
      const face = faces.find((candidate) => candidate.includes(marker));

      assert.ok(face, `missing ${subset} ${weight} font face`);
      assert.match(
        face,
        /font-family:\s*(?:["']Be Vietnam Pro["']|Be Vietnam Pro);/u,
      );
      assert.match(face, /font-style:\s*normal;/u);
      assert.match(face, new RegExp(`font-weight:\\s*${weight};`, "u"));
      assert.match(face, /font-display:\s*swap;/u);

      const declaredRange = /unicode-range:\s*([^;}]+)[;}]/u.exec(face)?.[1];
      assert.ok(declaredRange, `${marker} must declare unicode-range`);
      assert.equal(
        normalizeRange(declaredRange),
        normalizeRange(unicodeMetadata[subset]),
        `${marker} must match Fontsource unicode metadata`,
      );
    }
  }

  return faces;
}

function collectStrings(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, output);
  }

  return output;
}

async function collectTextSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      chunks.push(...(await collectTextSources(absolutePath)));
      continue;
    }
    if (/\.(?:css|js|jsx)$/u.test(entry.name)) {
      chunks.push(await readFile(absolutePath, "utf8"));
    }
  }

  return chunks;
}

async function productionOutputs() {
  const result = await build({
    root: projectRoot,
    logLevel: "silent",
    build: { write: false },
  });

  return (Array.isArray(result) ? result : [result]).flatMap(
    (entry) => entry.output ?? [],
  );
}

test("local font faces keep only the Latin and Vietnamese subsets", async () => {
  const [fontCss, unicodeMetadata] = await Promise.all([
    source("src/fonts.css"),
    source("node_modules/@fontsource/be-vietnam-pro/unicode.json").then(JSON.parse),
  ]);
  const faces = assertFontFaceDescriptors(fontCss, unicodeMetadata);

  for (const weight of weights) {
    for (const subset of subsets) {
      const marker = `be-vietnam-pro-${subset}-${weight}-normal`;
      const face = faces.find((candidate) => candidate.includes(marker));

      assert.ok(face, `missing ${subset} ${weight} font face`);
      for (const format of formats) {
        assert.ok(
          face.includes(`${marker}.${format}") format("${format}")`),
          `${marker} must retain its ${format} source`,
        );
      }

    }
  }
});

test("every website source code point is covered by the retained subsets", async () => {
  const [unicodeMetadata, sourceChunks, indexHtml] = await Promise.all([
    source("node_modules/@fontsource/be-vietnam-pro/unicode.json").then(JSON.parse),
    collectTextSources(path.join(projectRoot, "src")),
    source("index.html"),
  ]);
  const ranges = parseUnicodeRange(
    `${unicodeMetadata.vietnamese},${unicodeMetadata.latin}`,
  );
  const uncovered = new Map();

  const runtimeContent = collectStrings(content).join("\n");

  for (const character of [...sourceChunks, indexHtml, runtimeContent].join("\n")) {
    const codePoint = character.codePointAt(0);
    if (!isCovered(codePoint, ranges)) {
      uncovered.set(
        `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`,
        character,
      );
    }
  }

  assert.deepEqual(
    [...uncovered.entries()],
    [],
    "website source introduced glyphs outside the retained Latin/Vietnamese coverage",
  );
});

test("fresh production build excludes every Latin-ext font artifact", async () => {
  const [outputs, unicodeMetadata] = await Promise.all([
    productionOutputs(),
    source("node_modules/@fontsource/be-vietnam-pro/unicode.json").then(JSON.parse),
  ]);
  const assets = outputs.filter((entry) => entry.type === "asset");
  const fontAssets = assets
    .map((entry) => path.posix.basename(entry.fileName))
    .filter((name) => name.startsWith("be-vietnam-pro-"));
  const combinations = fontAssets.map((name) => {
    const match = /^be-vietnam-pro-(vietnamese|latin)-(400|500|600|700)-normal-[^.]+\.(woff2|woff)$/u.exec(
      name,
    );
    assert.ok(match, `unexpected font artifact: ${name}`);
    return `${match[1]}-${match[2]}-${match[3]}`;
  });
  const expected = subsets.flatMap((subset) =>
    weights.flatMap((weight) =>
      formats.map((format) => `${subset}-${weight}-${format}`),
    ),
  );

  assert.equal(fontAssets.length, expected.length);
  assert.deepEqual(combinations.sort(), expected.sort());
  assert.equal(assets.some((entry) => /latin-ext/iu.test(entry.fileName)), false);

  const builtCss = assets
    .filter((entry) => entry.fileName.endsWith(".css"))
    .map((entry) =>
      typeof entry.source === "string"
        ? entry.source
        : Buffer.from(entry.source).toString("utf8"),
    )
    .join("\n");

  assertFontFaceDescriptors(builtCss, unicodeMetadata);
  for (const asset of fontAssets) assert.ok(builtCss.includes(asset));
});
