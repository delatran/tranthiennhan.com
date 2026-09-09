import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { content, locales } from "../src/content.js";
import {
  builtBundleReferences,
  localizeShell,
} from "../scripts/build-localized-shells.mjs";

const outputDirectory = new URL("../dist/client/", import.meta.url);
const canonicalOrigin = "https://tranthiennhan.com";
const ogLocales = {
  en: { primary: "en_US", alternate: "vi_VN" },
  vi: { primary: "vi_VN", alternate: "en_US" },
};

function getAttribute(tag, attributeName) {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = tag.match(
    new RegExp(`\\b${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "iu"),
  );
  return match?.[2] ?? null;
}

function tags(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "giu"))].map(
    (match) => match[0],
  );
}

function singleTagByAttribute(html, tagName, attributeName, attributeValue) {
  const matches = tags(html, tagName).filter(
    (tag) => getAttribute(tag, attributeName) === attributeValue,
  );
  assert.equal(
    matches.length,
    1,
    `${tagName}[${attributeName}="${attributeValue}"] must occur exactly once`,
  );
  return matches[0];
}

function bundleReferences(html) {
  const moduleScripts = tags(html, "script").filter(
    (tag) => getAttribute(tag, "type") === "module",
  );
  const stylesheets = tags(html, "link").filter(
    (tag) => getAttribute(tag, "rel") === "stylesheet",
  );

  assert.equal(moduleScripts.length, 1, "each shell must contain one module script");
  assert.equal(
    stylesheets.length,
    2,
    "each portfolio shell must contain shared fonts and portfolio styles",
  );

  const scriptSource = getAttribute(moduleScripts[0], "src");
  const stylesheetSources = stylesheets.map((tag) => getAttribute(tag, "href"));
  assert.match(scriptSource, /^\/assets\/[A-Za-z0-9._-]+-[A-Za-z0-9_-]+\.js$/u);
  for (const stylesheetSource of stylesheetSources) {
    assert.match(
      stylesheetSource,
      /^\/assets\/[A-Za-z0-9._-]+-[A-Za-z0-9_-]+\.css$/u,
    );
  }
  assert.equal(
    stylesheetSources.filter((source) => /\/portfolio-[^/]+\.css$/u.test(source)).length,
    1,
    "each portfolio shell must contain exactly one route-specific stylesheet",
  );

  return { scriptSource, stylesheetSources };
}

function assertHreflangSet(html) {
  const alternates = tags(html, "link")
    .filter((tag) => getAttribute(tag, "rel") === "alternate")
    .map((tag) => [getAttribute(tag, "hreflang"), getAttribute(tag, "href")]);

  assert.deepEqual(alternates, [
    ["en", `${canonicalOrigin}/en`],
    ["vi", `${canonicalOrigin}/vi`],
    ["x-default", `${canonicalOrigin}/en`],
  ]);
}

async function readShell(fileName) {
  return readFile(new URL(fileName, outputDirectory), "utf8");
}

async function readJavaScriptClosure(fileUrl, visited = new Set()) {
  if (visited.has(fileUrl.href)) return "";
  visited.add(fileUrl.href);

  const javascript = await readFile(fileUrl, "utf8");
  const dependencyPaths = [
    ...javascript.matchAll(/\b(?:from|import)\s*\(?["'](\.\/[^"']+\.js)["']/gu),
  ].map((match) => match[1]);
  const dependencies = await Promise.all(
    dependencyPaths.map((dependencyPath) =>
      readJavaScriptClosure(new URL(dependencyPath, fileUrl), visited),
    ),
  );
  return [javascript, ...dependencies].join("\n");
}

test("build emits locale-correct static HTML shells from bilingual content", async () => {
  const shellEntries = await Promise.all(
    locales.map(async (locale) => [locale, await readShell(`${locale}.html`)]),
  );
  const shells = Object.fromEntries(shellEntries);

  for (const locale of locales) {
    const html = shells[locale];
    const localeContent = content[locale];
    const canonicalUrl = `${canonicalOrigin}/${locale}`;

    const htmlTags = tags(html, "html");
    assert.equal(htmlTags.length, 1);
    assert.equal(getAttribute(htmlTags[0], "lang"), locale);

    const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/giu)];
    assert.equal(titles.length, 1);
    assert.equal(titles[0][1], localeContent.meta.title);

    const description = singleTagByAttribute(html, "meta", "name", "description");
    assert.equal(getAttribute(description, "content"), localeContent.meta.description);

    const canonical = singleTagByAttribute(html, "link", "rel", "canonical");
    assert.equal(getAttribute(canonical, "href"), canonicalUrl);
    assert.doesNotMatch(getAttribute(canonical, "href"), /\/$/u);

    const openGraphExpectations = {
      "og:title": localeContent.meta.title,
      "og:description": localeContent.meta.description,
      "og:url": canonicalUrl,
      "og:locale": ogLocales[locale].primary,
      "og:locale:alternate": ogLocales[locale].alternate,
    };
    for (const [property, expected] of Object.entries(openGraphExpectations)) {
      const tag = singleTagByAttribute(html, "meta", "property", property);
      assert.equal(getAttribute(tag, "content"), expected);
    }

    const twitterExpectations = {
      "twitter:title": localeContent.meta.title,
      "twitter:description": localeContent.meta.description,
    };
    for (const [name, expected] of Object.entries(twitterExpectations)) {
      const tag = singleTagByAttribute(html, "meta", "name", name);
      assert.equal(getAttribute(tag, "content"), expected);
    }

    assertHreflangSet(html);
    assert.doesNotMatch(html, new RegExp(`${canonicalOrigin}/${locale}/`, "u"));
  }

  assert.doesNotMatch(shells.vi, /<link\s+rel="canonical"\s+href="https:\/\/tranthiennhan\.com\/en"/iu);
  assert.equal(
    getAttribute(singleTagByAttribute(shells.vi, "meta", "property", "og:locale"), "content"),
    "vi_VN",
  );

  assert.deepEqual(bundleReferences(shells.en), bundleReferences(shells.vi));
});

test("index.html remains the normalized English fallback with the same bundles", async () => {
  const [fallback, englishShell, vietnameseShell] = await Promise.all([
    readShell("index.html"),
    readShell("en.html"),
    readShell("vi.html"),
  ]);

  assert.equal(fallback, englishShell);
  assert.equal(getAttribute(tags(fallback, "html")[0], "lang"), "en");
  assert.equal(
    getAttribute(singleTagByAttribute(fallback, "link", "rel", "canonical"), "href"),
    `${canonicalOrigin}/en`,
  );
  assertHreflangSet(fallback);
  assert.deepEqual(bundleReferences(fallback), bundleReferences(vietnameseShell));
});

test("portfolio JavaScript closure excludes X Nhân response and product copy", async () => {
  const englishShell = await readShell("en.html");
  const { scriptSource } = bundleReferences(englishShell);
  const closure = await readJavaScriptClosure(
    new URL(scriptSource.replace(/^\//u, ""), outputDirectory),
  );

  assert.doesNotMatch(closure, /Invalid X Nhân natural answer provenance\./u);
  assert.doesNotMatch(closure, /Bạn muốn tìm gì trên X\?/u);
});

test("generator rejects missing, duplicate, and misleading metadata tags", async () => {
  const fallback = await readShell("index.html");
  const expectedBundles = builtBundleReferences(fallback);
  const withoutCanonical = fallback.replace(/\s*<link\s+rel="canonical"[^>]*>/iu, "");
  const duplicateDescription = fallback.replace(
    "</head>",
    '<meta name="description" content="duplicate" /></head>',
  );
  const misleadingDataName = fallback.replace(
    'name="description"',
    'data-name="description"',
  );

  assert.throws(
    () => localizeShell(withoutCanonical, "vi", expectedBundles),
    /link\[rel="canonical"\] must occur exactly once; found 0/u,
  );
  assert.throws(
    () => localizeShell(duplicateDescription, "vi", expectedBundles),
    /meta\[name="description"\] must occur exactly once; found 2/u,
  );
  assert.throws(
    () => localizeShell(misleadingDataName, "vi", expectedBundles),
    /meta\[name="description"\] must occur exactly once; found 0/u,
  );

  const harmlessDataName = fallback.replace(
    'name="description"',
    'name="description" data-name="description"',
  );
  assert.doesNotThrow(() => localizeShell(harmlessDataName, "vi", expectedBundles));
});

test("generator rejects placeholders and altered Vite bundle references", async () => {
  const fallback = await readShell("index.html");
  const expectedBundles = builtBundleReferences(fallback);

  assert.throws(
    () => localizeShell(fallback.replace("</head>", "{{PENDING}}</head>"), "vi", expectedBundles),
    /contains an unresolved placeholder/u,
  );

  const alteredBundle = fallback.replace(expectedBundles[0], "/assets/changed-bundle.js");
  assert.throws(
    () => localizeShell(alteredBundle, "vi", expectedBundles),
    /changed Vite's built bundle references/u,
  );
});

test("generator escapes untrusted metadata before inserting it into text and attributes", async () => {
  const fallback = await readShell("index.html");
  const expectedBundles = builtBundleReferences(fallback);
  const escaped = localizeShell(fallback, "vi", expectedBundles, {
    title: `A & B < "C">'`,
    description: `D & E < "F">'`,
  });

  assert.match(escaped, /<title>A &amp; B &lt; &quot;C&quot;&gt;&#39;<\/title>/u);
  assert.match(
    escaped,
    /name="description"\s+content="D &amp; E &lt; &quot;F&quot;&gt;&#39;"/u,
  );
  assert.doesNotMatch(escaped, /<title>A & B/u);
});
