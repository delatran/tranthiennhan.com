import { readFile, readdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { content, locales } from "../src/content.js";
import { personSchemaForLocale } from "../src/person-schema.js";

const outputDirectory = new URL("../dist/client/", import.meta.url);
const fallbackUrl = new URL("index.html", outputDirectory);
const canonicalOrigin = "https://tranthiennhan.com";
const ogLocales = {
  en: { primary: "en_US", alternate: "vi_VN" },
  vi: { primary: "vi_VN", alternate: "en_US" },
};

function fail(message) {
  throw new Error(`[localized-shells] ${message}`);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function serializeJsonForHtml(value) {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    fail("structured data must be JSON-serializable");
  }

  return serialized
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003C")
    .replaceAll(">", "\\u003E")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function attributePattern(attributeName, flags = "iu") {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(^|\\s)${escapedName}\\s*=\\s*(["'])(.*?)\\2`,
    flags,
  );
}

function getAttribute(tag, attributeName) {
  return tag.match(attributePattern(attributeName))?.[3] ?? null;
}

function setAttribute(tag, attributeName, value, selectorDescription) {
  const pattern = attributePattern(attributeName, "giu");
  const matches = [...tag.matchAll(pattern)];

  if (matches.length !== 1) {
    fail(
      `${selectorDescription} must have exactly one ${attributeName} attribute; found ${matches.length}`,
    );
  }

  return tag.replace(
    pattern,
    (_match, prefix) => `${prefix}${attributeName}="${escapeHtml(value)}"`,
  );
}

function replaceSingleTag(html, tagName, predicate, transform, selectorDescription) {
  const tags = [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "giu"))].map(
    (match) => match[0],
  );
  const matches = tags.filter(predicate);

  if (matches.length !== 1) {
    fail(`${selectorDescription} must occur exactly once; found ${matches.length}`);
  }

  const currentTag = matches[0];
  return html.replace(currentTag, transform(currentTag));
}

function replaceTagAttribute(
  html,
  tagName,
  selectorAttribute,
  selectorValue,
  targetAttribute,
  targetValue,
  selectorDescription,
) {
  return replaceSingleTag(
    html,
    tagName,
    (tag) => getAttribute(tag, selectorAttribute) === selectorValue,
    (tag) => setAttribute(tag, targetAttribute, targetValue, selectorDescription),
    selectorDescription,
  );
}

function replaceTitle(html, title) {
  const pattern = /<title\b[^>]*>[\s\S]*?<\/title>/giu;
  const matches = [...html.matchAll(pattern)];

  if (matches.length !== 1) {
    fail(`<title> must occur exactly once; found ${matches.length}`);
  }

  return html.replace(pattern, `<title>${escapeHtml(title)}</title>`);
}

function scriptBlocks(html) {
  return [
    ...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu),
  ].map((match) => ({
    block: match[0],
    openingTag: match[0].match(/^<script\b[^>]*>/iu)?.[0] ?? "",
  }));
}

function personSchemaBlocks(html) {
  return scriptBlocks(html)
    .filter(
      ({ openingTag }) =>
        getAttribute(openingTag, "data-portfolio-schema") === "person",
    );
}

function isJsonLdScript(openingTag) {
  const mediaType = getAttribute(openingTag, "type");
  const essence = mediaType?.split(";", 1)[0].trim().toLowerCase();
  return essence === "application/ld+json";
}

function isPersonType(type) {
  return (
    type === "Person" ||
    type === "https://schema.org/Person" ||
    type === "http://schema.org/Person"
  );
}

function jsonLdNodes(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => jsonLdNodes(item));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return [value, ...Object.values(value).flatMap((item) => jsonLdNodes(item))];
}

function effectivePersonSchemaCount(html) {
  return scriptBlocks(html)
    .filter(({ openingTag }) => isJsonLdScript(openingTag))
    .flatMap(({ block }) => {
      const source = block
        .replace(/^<script\b[^>]*>/iu, "")
        .replace(/<\/script\s*>$/iu, "");

      try {
        return jsonLdNodes(JSON.parse(source));
      } catch {
        fail("JSON-LD script must contain valid JSON");
      }
    })
    .filter((node) => {
      const types = Array.isArray(node["@type"])
        ? node["@type"]
        : [node["@type"]];
      return types.some((type) => isPersonType(type));
    }).length;
}

function replacePersonSchema(html, locale) {
  const matches = personSchemaBlocks(html);

  if (matches.length !== 1) {
    fail(`Person schema must occur exactly once; found ${matches.length}`);
  }

  if (getAttribute(matches[0].openingTag, "type") !== "application/ld+json") {
    fail('Person schema must use type="application/ld+json"');
  }

  const replacement = `<script type="application/ld+json" data-portfolio-schema="person">${serializeJsonForHtml(
    personSchemaForLocale(locale, content[locale]),
  )}</script>`;
  return html.replace(matches[0].block, replacement);
}

function readPersonSchema(html) {
  const matches = personSchemaBlocks(html);

  if (matches.length !== 1) {
    fail(`Person schema must occur exactly once; found ${matches.length}`);
  }

  if (getAttribute(matches[0].openingTag, "type") !== "application/ld+json") {
    fail('Person schema must use type="application/ld+json"');
  }

  const effectivePersonCount = effectivePersonSchemaCount(html);
  if (effectivePersonCount !== 1) {
    fail(
      `shell must contain exactly one effective Person schema; found ${effectivePersonCount}`,
    );
  }

  const source = matches[0].block
    .replace(/^<script\b[^>]*>/iu, "")
    .replace(/<\/script\s*>$/iu, "");

  try {
    return JSON.parse(source);
  } catch {
    fail("Person schema must contain valid JSON");
  }
}

export function assertLocalizedPersonSchema(html, locale) {
  const expected = personSchemaForLocale(locale, content[locale]);
  const actual = readPersonSchema(html);
  const canonicalTag = [...html.matchAll(/<link\b[^>]*>/giu)]
    .map((match) => match[0])
    .find((tag) => getAttribute(tag, "rel") === "canonical");
  const htmlTag = html.match(/<html\b[^>]*>/iu)?.[0];

  if (getAttribute(canonicalTag ?? "", "href") !== actual.url) {
    fail(`Person schema URL does not match the ${locale} canonical URL`);
  }

  if (getAttribute(htmlTag ?? "", "lang") !== actual.inLanguage) {
    fail(`Person schema language does not match the ${locale} HTML language`);
  }

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`Person schema does not match locale ${locale}`);
  }
}

export function builtBundleReferences(html) {
  return [...html.matchAll(/<(?:script|link)\b[^>]*>/giu)]
    .flatMap((match) => [getAttribute(match[0], "src"), getAttribute(match[0], "href")])
    .filter((value) => /^\/assets\/[^?#]+\.(?:css|js)$/iu.test(value ?? ""))
    .sort();
}

function assertShellIsComplete(html, locale, expectedBundleReferences) {
  if (/\{\{[^{}]+\}\}|__LOCALE_[A-Z_]+__/u.test(html)) {
    fail(`${locale} shell contains an unresolved placeholder`);
  }

  const bundleReferences = builtBundleReferences(html);
  if (JSON.stringify(bundleReferences) !== JSON.stringify(expectedBundleReferences)) {
    fail(`${locale} shell changed Vite's built bundle references`);
  }

  assertLocalizedPersonSchema(html, locale);
}

export function localizeShell(
  baseHtml,
  locale,
  expectedBundleReferences,
  metadata = content[locale]?.meta,
) {
  const localeMapping = ogLocales[locale];

  if (!metadata?.title || !metadata?.description || !localeMapping) {
    fail(`missing metadata configuration for locale ${locale}`);
  }

  const canonicalUrl = `${canonicalOrigin}/${locale}`;
  let html = baseHtml;

  html = replaceSingleTag(
    html,
    "html",
    () => true,
    (tag) => setAttribute(tag, "lang", locale, "<html lang>"),
    "<html>",
  );
  html = replaceTitle(html, metadata.title);
  html = replaceTagAttribute(
    html,
    "meta",
    "name",
    "description",
    "content",
    metadata.description,
    'meta[name="description"]',
  );
  html = replaceTagAttribute(
    html,
    "link",
    "rel",
    "canonical",
    "href",
    canonicalUrl,
    'link[rel="canonical"]',
  );
  html = replaceTagAttribute(
    html,
    "meta",
    "property",
    "og:title",
    "content",
    metadata.title,
    'meta[property="og:title"]',
  );
  html = replaceTagAttribute(
    html,
    "meta",
    "property",
    "og:description",
    "content",
    metadata.description,
    'meta[property="og:description"]',
  );
  html = replaceTagAttribute(
    html,
    "meta",
    "property",
    "og:url",
    "content",
    canonicalUrl,
    'meta[property="og:url"]',
  );
  html = replaceTagAttribute(
    html,
    "meta",
    "property",
    "og:locale",
    "content",
    localeMapping.primary,
    'meta[property="og:locale"]',
  );
  html = replaceTagAttribute(
    html,
    "meta",
    "property",
    "og:locale:alternate",
    "content",
    localeMapping.alternate,
    'meta[property="og:locale:alternate"]',
  );
  html = replaceTagAttribute(
    html,
    "meta",
    "name",
    "twitter:title",
    "content",
    metadata.title,
    'meta[name="twitter:title"]',
  );
  html = replaceTagAttribute(
    html,
    "meta",
    "name",
    "twitter:description",
    "content",
    metadata.description,
    'meta[name="twitter:description"]',
  );
  html = replacePersonSchema(html, locale);

  assertShellIsComplete(html, locale, expectedBundleReferences);
  return html;
}

export async function buildLocalizedShells() {
  if (JSON.stringify(locales) !== JSON.stringify(["en", "vi"])) {
    fail(`expected exactly the supported locales en and vi; received ${locales.join(", ")}`);
  }

  const builtFallback = await readFile(fallbackUrl, "utf8");
  const expectedBundleReferences = builtBundleReferences(builtFallback);

  if (expectedBundleReferences.length === 0) {
    fail("the Vite build did not contain any hashed CSS or JavaScript bundle references");
  }

  const shells = Object.fromEntries(
    locales.map((locale) => [
      locale,
      localizeShell(builtFallback, locale, expectedBundleReferences),
    ]),
  );

  await Promise.all([
    writeFile(fallbackUrl, shells.en, "utf8"),
    writeFile(new URL("en.html", outputDirectory), shells.en, "utf8"),
    writeFile(new URL("vi.html", outputDirectory), shells.vi, "utf8"),
  ]);

  const generatedEntries = await readdir(outputDirectory);
  const temporaryEntries = generatedEntries.filter((entry) => /(?:\.tmp|~)$/u.test(entry));
  if (temporaryEntries.length > 0) {
    fail(`temporary build artifacts remain: ${temporaryEntries.join(", ")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildLocalizedShells();
}
