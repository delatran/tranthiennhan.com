import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { content, locales } from "../src/content.js";
import { personSchemaForLocale } from "../src/person-schema.js";
import {
  assertLocalizedPersonSchema,
  builtBundleReferences,
  localizeShell,
  serializeJsonForHtml,
} from "../scripts/build-localized-shells.mjs";

const outputDirectory = new URL("../dist/client/", import.meta.url);
const sourceIndexUrl = new URL("../index.html", import.meta.url);
const metadataSourceUrl = new URL(
  "../src/portfolio/hooks/usePortfolioMetadata.js",
  import.meta.url,
);
const canonicalOrigin = "https://tranthiennhan.com";

function getAttribute(tag, attributeName) {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return tag.match(
    new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "iu"),
  )?.[2] ?? null;
}

function personSchemaBlocks(html) {
  return [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu)]
    .map((match) => ({
      block: match[0],
      openingTag: match[0].match(/^<script\b[^>]*>/iu)?.[0] ?? "",
    }))
    .filter(
      ({ openingTag }) =>
        getAttribute(openingTag, "data-portfolio-schema") === "person",
    );
}

function readPersonSchema(html) {
  const matches = personSchemaBlocks(html);
  assert.equal(matches.length, 1, "shell must contain exactly one Person schema");
  assert.equal(getAttribute(matches[0].openingTag, "type"), "application/ld+json");

  return JSON.parse(
    matches[0].block
      .replace(/^<script\b[^>]*>/iu, "")
      .replace(/<\/script\s*>$/iu, ""),
  );
}

function schemaForLocale(locale) {
  return personSchemaForLocale(locale, content[locale]);
}

test("source and built shells contain one locale-correct static Person schema", async () => {
  const [sourceIndex, metadataSource, ...shells] = await Promise.all([
    readFile(sourceIndexUrl, "utf8"),
    readFile(metadataSourceUrl, "utf8"),
    readFile(new URL("index.html", outputDirectory), "utf8"),
    ...locales.map((locale) =>
      readFile(new URL(`${locale}.html`, outputDirectory), "utf8"),
    ),
  ]);

  assert.deepEqual(readPersonSchema(sourceIndex), schemaForLocale("en"));
  assert.match(
    metadataSource,
    /document\.querySelector\(\s*['"]script\[data-portfolio-schema="person"\]['"]\s*,?\s*\)/u,
  );
  assert.match(metadataSource, /if \(!structuredData\)/u);
  assert.match(
    metadataSource,
    /structuredData\.textContent = JSON\.stringify\(\s*personSchemaForLocale\(locale, copy\),?\s*\)/u,
  );

  const [fallback, english, vietnamese] = shells;
  assert.deepEqual(readPersonSchema(fallback), schemaForLocale("en"));
  assert.deepEqual(readPersonSchema(english), schemaForLocale("en"));
  assert.deepEqual(readPersonSchema(vietnamese), schemaForLocale("vi"));

  for (const [locale, html] of [
    ["en", english],
    ["vi", vietnamese],
  ]) {
    const schema = readPersonSchema(html);
    assert.equal(schema.url, `${canonicalOrigin}/${locale}`);
    assert.equal(schema.inLanguage, locale);
    assert.equal(schema.homeLocation.name, content[locale].hero.location);
    assert.deepEqual(schema.sameAs, [
      "https://www.linkedin.com/in/clementtranbe",
      "https://x.com/tran_thien_nhan",
    ]);
  }
});

test("generator rejects missing and duplicate Person schema blocks", async () => {
  const fallback = await readFile(new URL("index.html", outputDirectory), "utf8");
  const expectedBundles = builtBundleReferences(fallback);
  const [schema] = personSchemaBlocks(fallback);
  const missing = fallback.replace(schema.block, "");
  const duplicate = fallback.replace(schema.block, `${schema.block}${schema.block}`);
  const unmarkedDuplicate = `<script type="application/ld+json">${serializeJsonForHtml(
    { "@context": "https://schema.org", "@graph": [schemaForLocale("en")] },
  )}</script>`;
  const nestedDuplicate = `<script type="application/ld+json">${serializeJsonForHtml(
    {
      "@context": "https://schema.org",
      "@type": "Article",
      author: { "@type": "Person", name: "Duplicate" },
    },
  )}</script>`;
  const parameterizedTypeDuplicate = `<script type=" APPLICATION/LD+JSON ; profile=https://schema.org ">${serializeJsonForHtml(
    schemaForLocale("en"),
  )}</script>`;
  const absoluteIriDuplicate = `<script type="application/ld+json">${serializeJsonForHtml(
    {
      "@context": "https://schema.org",
      "@type": "https://schema.org/Person",
      name: "Duplicate",
    },
  )}</script>`;

  assert.throws(
    () => localizeShell(missing, "vi", expectedBundles),
    /Person schema must occur exactly once; found 0/u,
  );
  assert.throws(
    () => localizeShell(duplicate, "vi", expectedBundles),
    /Person schema must occur exactly once; found 2/u,
  );
  assert.throws(
    () =>
      localizeShell(
        fallback.replace("</head>", `${unmarkedDuplicate}</head>`),
        "vi",
        expectedBundles,
      ),
    /exactly one effective Person schema; found 2/u,
  );
  assert.throws(
    () =>
      localizeShell(
        fallback.replace("</head>", `${nestedDuplicate}</head>`),
        "vi",
        expectedBundles,
      ),
    /exactly one effective Person schema; found 2/u,
  );
  assert.throws(
    () =>
      localizeShell(
        fallback.replace("</head>", `${parameterizedTypeDuplicate}</head>`),
        "vi",
        expectedBundles,
      ),
    /exactly one effective Person schema; found 2/u,
  );
  assert.throws(
    () =>
      localizeShell(
        fallback.replace("</head>", `${absoluteIriDuplicate}</head>`),
        "vi",
        expectedBundles,
      ),
    /exactly one effective Person schema; found 2/u,
  );
});

test("schema verifier rejects locale and canonical URL mismatches", async () => {
  const vietnamese = await readFile(new URL("vi.html", outputDirectory), "utf8");
  const schema = readPersonSchema(vietnamese);
  const wrongLocale = vietnamese.replace(
    serializeJsonForHtml(schema),
    serializeJsonForHtml({ ...schema, inLanguage: "en" }),
  );
  const wrongUrl = vietnamese.replace(
    serializeJsonForHtml(schema),
    serializeJsonForHtml({ ...schema, url: `${canonicalOrigin}/en` }),
  );
  const wrongProfile = vietnamese.replace(
    serializeJsonForHtml(schema),
    serializeJsonForHtml({
      ...schema,
      homeLocation: { ...schema.homeLocation, name: "Wrong location" },
    }),
  );
  const wrongType = vietnamese.replace(
    'type="application/ld+json" data-portfolio-schema="person"',
    'type="application/json" data-portfolio-schema="person"',
  );

  assert.throws(
    () => assertLocalizedPersonSchema(wrongLocale, "vi"),
    /language does not match the vi HTML language/u,
  );
  assert.throws(
    () => assertLocalizedPersonSchema(wrongUrl, "vi"),
    /URL does not match the vi canonical URL/u,
  );
  assert.throws(
    () => assertLocalizedPersonSchema(wrongProfile, "vi"),
    /does not match locale vi/u,
  );
  assert.throws(
    () => assertLocalizedPersonSchema(wrongType, "vi"),
    /must use type="application\/ld\+json"/u,
  );
});

test("JSON-LD serialization prevents script breakout without changing data", () => {
  const unsafe = {
    name: "</ScRiPt><script>alert('schema')</script>",
    detail: "A&B<>&\u2028\u2029",
  };
  const serialized = serializeJsonForHtml(unsafe);

  assert.doesNotMatch(serialized, /<\/script/iu);
  assert.doesNotMatch(serialized, /[<>&\u2028\u2029]/u);
  assert.match(serialized, /\\u003C\/ScRiPt\\u003E/u);
  assert.deepEqual(JSON.parse(serialized), unsafe);
});

test("schema localization rejects Vite bundle drift", async () => {
  const fallback = await readFile(new URL("index.html", outputDirectory), "utf8");
  const expectedBundles = builtBundleReferences(fallback);
  const changedBundle = fallback.replace(expectedBundles[0], "/assets/schema-drift.js");

  assert.throws(
    () => localizeShell(changedBundle, "vi", expectedBundles),
    /changed Vite's built bundle references/u,
  );
});
