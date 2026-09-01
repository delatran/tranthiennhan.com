import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { content } from "../src/content.js";
import {
  ASK_NHAN_MODAL_BACKGROUND_SELECTORS,
  askNhanModalBackgroundElements,
  focusAskDialogIfNeeded,
  setElementsTemporarilyInert,
} from "../src/components/modal-inertness.js";
import {
  closeMobileNavigationAtDesktopBreakpoint,
  navigateToTarget,
  navigateToTargetById,
} from "../src/components/navigation.js";
import { createPortfolioRouteWebMcpActions } from "../src/portfolio-webmcp.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function source(relativePath) {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

const applicationSourcePaths = [
  "src/components/Header.jsx",
  "src/components/LocaleFlag.jsx",
  "src/components/AskNhan.jsx",
  "src/components/modal-inertness.js",
  "src/components/navigation.js",
  "src/portfolio-webmcp.js",
  "src/webmcp.js",
  "src/App.jsx",
  "src/portfolio/PortfolioRoute.jsx",
  "src/portfolio/PortfolioSections.jsx",
  "src/portfolio/components/SectionRail.jsx",
  "src/portfolio/components/TagList.jsx",
  "src/portfolio/hooks/usePortfolioLocale.js",
  "src/portfolio/hooks/usePortfolioMetadata.js",
  "src/portfolio/hooks/usePortfolioReveal.js",
  "src/portfolio/hooks/usePortfolioScroll.js",
  "src/portfolio/hooks/usePortfolioVisitorTracking.js",
  "src/portfolio/layout/PortfolioFooter.jsx",
  "src/portfolio/sections/Approach.jsx",
  "src/portfolio/sections/Contact.jsx",
  "src/portfolio/sections/Experience.jsx",
  "src/portfolio/sections/Hero.jsx",
  "src/portfolio/sections/PersonalProduct.jsx",
  "src/portfolio/sections/SelectedWork.jsx",
  "src/use-visitor-count.js",
];

const portfolioStylePaths = [
  "src/portfolio/styles/header.css",
  "src/portfolio/styles/layout.css",
  "src/portfolio/styles/hero.css",
  "src/portfolio/styles/approach.css",
  "src/portfolio/styles/experience.css",
  "src/portfolio/styles/work.css",
  "src/portfolio/styles/product.css",
  "src/portfolio/styles/contact.css",
  "src/portfolio/styles/footer.css",
  "src/portfolio/styles/ask-nhan.css",
];

async function applicationSource() {
  return (await Promise.all(applicationSourcePaths.map(source))).join("\n");
}

async function portfolioStyles() {
  return (await Promise.all(portfolioStylePaths.map(source))).join("\n");
}

test("portfolio style entry preserves component order and responsive ownership", async () => {
  const [entry, header, layout, hero, approach, product, askNhan] = await Promise.all([
    source("src/styles.css"),
    source("src/portfolio/styles/header.css"),
    source("src/portfolio/styles/layout.css"),
    source("src/portfolio/styles/hero.css"),
    source("src/portfolio/styles/approach.css"),
    source("src/portfolio/styles/product.css"),
    source("src/portfolio/styles/ask-nhan.css"),
  ]);
  const imports = [...entry.matchAll(/@import "([^"]+)";/gu)].map(
    (match) => match[1],
  );

  assert.deepEqual(
    imports,
    portfolioStylePaths.map((relativePath) => `./${relativePath.slice("src/".length)}`),
  );
  assert.doesNotMatch(
    entry,
    /\.(?:site-header|hero|approach|experience|work|product|contact|site-footer|ask-nhan)\b/u,
  );
  assert.match(header, /\.site-header\s*\{/u);
  assert.match(header, /@media \(max-width: 52\.5rem\)[\s\S]*?\.mobile-menu-overlay\s*\{/u);
  assert.match(layout, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\[data-reveal\]\s*\{/u);
  assert.match(hero, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.hero-name-word\s*\{/u);
  assert.match(approach, /@media \(max-width: 52\.5rem\)[\s\S]*?\.approach-main\s*\{[^}]*padding-top:\s*2\.2rem;/u);
  assert.match(product, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.product-flow li::before\s*\{/u);
  assert.match(
    askNhan,
    /@media \(max-width: 37\.5rem\) and \(max-height: 43rem\)[\s\S]*?\.chat-transcript\s*\{/u,
  );
  assert.match(
    entry,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\*,\s*\*::before,\s*\*::after\s*\{/u,
  );
});

test("the shared motion system stays composited, staged, and reduced-motion safe", async () => {
  const [base, portfolio, work, experience, askNhan, xnhan, xnhanTurn, xnhanAbout] =
    await Promise.all([
      source("src/base.css"),
      portfolioStyles(),
      source("src/portfolio/styles/work.css"),
      source("src/portfolio/styles/experience.css"),
      source("src/portfolio/styles/ask-nhan.css"),
      source("src/xnhan.css"),
      source("src/xnhan-turn.css"),
      source("src/xnhan-about.css"),
    ]);
  const styles = [portfolio, xnhan, xnhanTurn, xnhanAbout].join("\n");

  assert.match(base, /--motion-duration-medium:\s*420ms/u);
  assert.match(base, /--motion-ease-out:\s*cubic-bezier\(0\.16, 1, 0\.3, 1\)/u);
  assert.match(portfolio, /\[data-reveal="stagger"\]\.is-visible/u);
  assert.match(work, /\.case-flow ol\s*\{[^}]*grid-template-columns:\s*repeat\(4/su);
  assert.match(experience, /\.capability-map\[data-reveal\]\.is-visible/u);
  assert.match(askNhan, /@keyframes chat-message-enter/u);
  assert.match(xnhan, /@keyframes xnhan-suggestion-enter/u);
  assert.match(xnhanTurn, /@keyframes xnhan-assistant-turn-enter/u);
  assert.match(xnhanAbout, /\.xnhan-about-stage-list\[data-about-reveal\]\.is-visible/u);
  assert.doesNotMatch(
    styles,
    /transition\s*:[^}]*\b(?:top|right|bottom|left|width|height|margin|padding)\s+[0-9]/iu,
  );

  const keyframeBlocks = [];
  let cursor = 0;
  while (true) {
    const start = styles.indexOf("@keyframes", cursor);
    if (start === -1) break;
    const bodyStart = styles.indexOf("{", start);
    let depth = 0;
    let end = bodyStart;
    for (; end < styles.length; end += 1) {
      if (styles[end] === "{") depth += 1;
      if (styles[end] === "}") depth -= 1;
      if (depth === 0) break;
    }
    keyframeBlocks.push(styles.slice(start, end + 1));
    cursor = end + 1;
  }

  assert.ok(keyframeBlocks.length >= 12);
  for (const block of keyframeBlocks) {
    const declarations = [...block.matchAll(/^\s*([a-z-]+)\s*:/gmu)].map(
      (match) => match[1],
    );
    assert.ok(
      declarations.every((property) => property === "opacity" || property === "transform"),
      `keyframe may only animate opacity/transform:\n${block}`,
    );
  }

  for (const reducedSource of [portfolio, askNhan, xnhan, xnhanTurn, xnhanAbout]) {
    assert.match(reducedSource, /@media \(prefers-reduced-motion:\s*reduce\)/u);
  }
});

function extractFunctionSource(sourceText, name) {
  const start = sourceText.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} source must be discoverable`);

  const bodyStart = sourceText.indexOf("{", start);
  let depth = 0;

  for (let index = bodyStart; index < sourceText.length; index += 1) {
    if (sourceText[index] === "{") depth += 1;
    if (sourceText[index] === "}") depth -= 1;
    if (depth === 0) return sourceText.slice(start, index + 1);
  }

  assert.fail(`${name} source must have a complete function body`);
}

function evaluateLocaleHelpers(appSource, browserWindow) {
  const sandbox = {
    DEFAULT_LOCALE: "en",
    LOCALE_STORAGE_KEY: "portfolio-locale",
    locales: ["en", "vi"],
    window: browserWindow,
  };
  const helperNames = [
    "readStoredLocale",
    "writeStoredLocale",
    "readLocale",
    "applyLocaleChange",
  ];
  const helperSource = helperNames
    .map((name) => extractFunctionSource(appSource, name))
    .join("\n");

  runInNewContext(
    `${helperSource}\nglobalThis.localeHelpers = { ${helperNames.join(", ")} };`,
    sandbox,
  );

  return sandbox.localeHelpers;
}

function evaluateAskFallbackHelpers(askSource) {
  const sandbox = {};
  const helperNames = [
    "normalizeIntentText",
    "isContactIntent",
    "chooseReply",
    "chooseRelatedSection",
  ];
  const helperSource = helperNames
    .map((name) => extractFunctionSource(askSource, name))
    .join("\n");

  runInNewContext(
    `${helperSource}\nglobalThis.askFallbackHelpers = { ${helperNames.join(", ")} };`,
    sandbox,
  );

  return sandbox.askFallbackHelpers;
}

function rasterDimensions(image) {
  if (image.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
    return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
  }

  if (image.subarray(0, 2).toString("hex") !== "ffd8") {
    assert.fail("organization logo must be a PNG or JPEG image");
  }

  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;

  while (offset < image.length) {
    while (image[offset] === 0xff) offset += 1;
    const marker = image[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= image.length) break;

    const segmentLength = image.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > image.length) break;

    if (startOfFrameMarkers.has(marker)) {
      return {
        width: image.readUInt16BE(offset + 5),
        height: image.readUInt16BE(offset + 3),
      };
    }

    offset += segmentLength;
  }

  assert.fail("JPEG organization logo must contain a supported start-of-frame marker");
}

test("hashed assets have one unambiguous immutable cache policy", async () => {
  const headers = await source("public/_headers");
  const globalRule = headers.split(/\r?\n\r?\n/u, 1)[0];
  const cacheDeclarations = headers.match(/^\s+Cache-Control:/gmu) ?? [];

  assert.doesNotMatch(globalRule, /Cache-Control:/u);
  assert.equal(cacheDeclarations.length, 1);
  assert.match(
    headers,
    /\/assets\/\*\r?\n\s+Cache-Control: public, max-age=31556952, immutable/u,
  );
});

test("locale navigation uses accessible flag links and complete head metadata", async () => {
  const [
    app,
    index,
    styles,
    localizedContent,
    baseStyles,
    xnhanApp,
    xnhanAboutApp,
    localeFlag,
  ] = await Promise.all([
    applicationSource(),
    source("index.html"),
    portfolioStyles(),
    source("src/content.js"),
    source("src/base.css"),
    source("src/XNhanApp.jsx"),
    source("src/XNhanAboutApp.jsx"),
    source("src/components/LocaleFlag.jsx"),
  ]);

  assert.ok(app.includes('href={`/${item}${window.location.hash}`}'));
  assert.ok(app.includes("hrefLang={item}"));
  assert.ok(app.includes('aria-current={locale === item ? "page" : undefined}'));
  assert.match(app, /hreflang="x-default"/u);
  assert.match(app, /meta\[property="og:title"\]/u);
  assert.match(app, /meta\[name="twitter:card"\]/u);
  assert.match(app, /data-portfolio-schema/u);
  assert.match(app, /application\/ld\+json/u);
  assert.match(app, /max-image-preview:large/u);
  assert.match(index, /<link rel="canonical" href="https:\/\/tranthiennhan\.com\/en"/u);
  assert.match(index, /hreflang="x-default" href="https:\/\/tranthiennhan\.com\/en"/u);
  assert.match(index, /property="og:url" content="https:\/\/tranthiennhan\.com\/en"/u);

  const localeSwitch = app.match(
    /function LocaleSwitch[\s\S]*?\n\}\n\nexport function MobileNavigationMenu/u,
  )?.[0];
  assert.ok(localeSwitch, "LocaleSwitch source must be discoverable");
  assert.match(localeSwitch, /<nav className="locale-switch" aria-label=\{label\}>/u);
  assert.doesNotMatch(localeSwitch, /className="sr-only"/u);
  assert.match(localizedContent, /export const locales = \["en", "vi"\];/u);
  assert.match(localeSwitch, /\{locales\.map\(\(item\) => \(/u);
  assert.match(localeSwitch, /lang=\{item\}[\s\S]*?aria-label=\{localeName\(item\)\}/u);
  assert.match(localeSwitch, /title=\{localeName\(item\)\}/u);
  assert.match(localeSwitch, /<LocaleFlag locale=\{item\} \/>/u);
  assert.doesNotMatch(localeSwitch, /toUpperCase\(|locale-divider|>\s*\{item\}\s*</u);
  const localeLinkAttributes = localeSwitch.match(/<a\b([\s\S]*?)>/u)?.[1];
  assert.ok(localeLinkAttributes, "locale link attributes must be discoverable");
  assert.match(localeLinkAttributes, /\baria-label=\{localeName\(item\)\}/u);
  assert.match(localeSwitch, /<a/u);
  assert.doesNotMatch(localeSwitch, /<button/u);
  assert.equal(
    (app.match(/<LocaleSwitch\b/gu) ?? []).length,
    1,
    "the language selector must have one source location",
  );
  assert.match(
    app,
    /<header className="site-header">[\s\S]*?<LocaleSwitch locale=\{locale\}/u,
  );
  assert.doesNotMatch(app, /mobile-nav-footer/u);
  assert.doesNotMatch(app, /function Footer[\s\S]*?<LocaleSwitch/u);
  assert.match(
    styles,
    /\.locale-switch a\s*\{[\s\S]*?min-width:\s*2\.75rem;[\s\S]*?min-height:\s*2\.75rem;/u,
  );
  assert.doesNotMatch(
    styles,
    /\.header-actions\s*>\s*\.locale-switch\s*\{[^}]*display:\s*none/u,
  );
  assert.match(
    localeFlag,
    /en:[\s\S]*?flag_of_the_United_Kingdom\.svg[\s\S]*?vi:[\s\S]*?flag_of_Vietnam\.svg/u,
  );
  assert.match(localeFlag, /alt=""[\s\S]*?aria-hidden="true"/u);
  assert.match(localeFlag, /width=\{presentation\.width\}[\s\S]*?height=\{presentation\.height\}/u);
  assert.match(baseStyles, /\.locale-flag\s*\{[^}]*width:\s*auto;[^}]*height:\s*1rem;/su);
  for (const application of [xnhanApp, xnhanAboutApp]) {
    assert.match(application, /aria-label=\{localeName\(item\)\}/u);
    assert.match(application, /title=\{localeName\(item\)\}/u);
    assert.match(application, /<LocaleFlag locale=\{item\} \/>/u);
    assert.doesNotMatch(application, /item\.toUpperCase\(\)/u);
  }
});

test("locale routing remains usable when localStorage is blocked", async () => {
  const app = await applicationSource();
  const historyCalls = [];
  const committedLocales = [];
  let storageReads = 0;
  let storageWrites = 0;
  const blockedStorageError = () => {
    const error = new Error("Access to storage is blocked");
    error.name = "SecurityError";
    return error;
  };
  const browserWindow = {
    location: { pathname: "/vi", hash: "#contact" },
    history: {
      pushState(...args) {
        historyCalls.push(args);
      },
    },
    localStorage: {
      getItem() {
        storageReads += 1;
        throw blockedStorageError();
      },
      setItem() {
        storageWrites += 1;
        throw blockedStorageError();
      },
    },
  };
  const { applyLocaleChange, readLocale } = evaluateLocaleHelpers(
    app,
    browserWindow,
  );

  assert.equal(readLocale(), "vi", "the locale in the URL must win");
  assert.equal(
    storageReads,
    0,
    "a valid locale URL must not depend on storage access",
  );

  browserWindow.location.pathname = "/";
  assert.doesNotThrow(() => readLocale());
  assert.equal(readLocale(), "en", "blocked storage must fall back to English");

  browserWindow.location.pathname = "/en";
  assert.doesNotThrow(() =>
    applyLocaleChange("vi", "en", (locale) => committedLocales.push(locale)),
  );
  assert.equal(historyCalls.length, 1);
  assert.equal(historyCalls[0][1], "");
  assert.equal(historyCalls[0][2], "/vi#contact");
  assert.deepEqual(Object.keys(historyCalls[0][0]), []);
  assert.deepEqual(committedLocales, ["vi"]);
  assert.equal(storageReads, 2, "the blocked read path must be exercised");
  assert.equal(storageWrites, 1, "the blocked write path must be exercised");
  assert.match(app, /writeStoredLocale\(nextLocale\);[\s\S]*?history\.pushState[\s\S]*?commitLocale\(nextLocale\)/u);
});

test("portrait favicon assets are complete, square, and explicitly wired", async () => {
  const index = await source("index.html");
  const icons = [
    { filename: "portrait-icon-20d683e7-32.png", relation: "icon", size: 32, maxBytes: 4_000 },
    {
      filename: "portrait-icon-20d683e7-180.png",
      relation: "apple-touch-icon",
      size: 180,
      maxBytes: 60_000,
    },
    {
      filename: "portrait-icon-20d683e7-192.png",
      relation: "icon",
      size: 192,
      maxBytes: 70_000,
    },
    {
      filename: "portrait-icon-20d683e7-512.png",
      relation: "icon",
      size: 512,
      maxBytes: 450_000,
    },
  ];

  for (const { filename, relation, size, maxBytes } of icons) {
    assert.match(
      index,
      new RegExp(
        `rel="${relation}"[\\s\\S]*?sizes="${size}x${size}"[\\s\\S]*?href="/assets/${filename}"`,
        "u",
      ),
    );

    const image = await readFile(path.join(projectRoot, "public", "assets", filename));
    assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(image.readUInt32BE(16), size);
    assert.equal(image.readUInt32BE(20), size);
    assert.ok(image.byteLength <= maxBytes, `${filename} should remain lightweight`);
  }

  assert.doesNotMatch(index, /resume|old_money|cv\.jpg/iu);
});

test("owner-supplied organization marks stay exact while responsive derivatives bound normal-DPR payload", async () => {
  const [app, experienceSource, baseStyles, styles] = await Promise.all([
    applicationSource(),
    source("src/portfolio/sections/Experience.jsx"),
    source("src/base.css"),
    portfolioStyles(),
  ]);
  const brandMarkSource = experienceSource.match(
    /function BrandMark[\s\S]*?\n\}\n\nexport function Experience/u,
  )?.[0];
  const educationMarkSource = experienceSource.match(
    /<div className="education-wordmark">[\s\S]*?<\/div>/u,
  )?.[0];

  assert.ok(brandMarkSource, "BrandMark source must be discoverable");
  assert.ok(educationMarkSource, "education mark source must be discoverable");
  assert.match(
    brandMarkSource,
    /srcSet=\{`\$\{asset\.derivativeSrc\} \$\{asset\.derivativeWidth\}w, \$\{asset\.src\} \$\{asset\.width\}w`\}[\s\S]*?sizes=\{asset\.sizes\}[\s\S]*?alt=""[\s\S]*?width=\{asset\.width\}[\s\S]*?height=\{asset\.height\}/u,
  );
  assert.match(brandMarkSource, /loading="lazy"[\s\S]*?decoding="async"/u);
  assert.match(experienceSource, /className="role-heading"/u);
  assert.match(experienceSource, /className="role-card" data-reveal/u);
  assert.doesNotMatch(experienceSource, /className="experience-timeline" data-reveal/u);
  assert.match(experienceSource, /className="education-identity"/u);
  assert.match(
    educationMarkSource,
    /srcSet=\{`\$\{PTIT_LOGO\.derivativeSrc\} \$\{PTIT_LOGO\.derivativeWidth\}w, \$\{PTIT_LOGO\.src\} \$\{PTIT_LOGO\.width\}w`\}[\s\S]*?sizes=\{PTIT_LOGO\.sizes\}[\s\S]*?alt=""[\s\S]*?width=\{PTIT_LOGO\.width\}[\s\S]*?height=\{PTIT_LOGO\.height\}/u,
  );
  assert.match(educationMarkSource, /loading="lazy"[\s\S]*?decoding="async"/u);
  assert.doesNotMatch(experienceSource, /<a\b/u);
  assert.doesNotMatch(app, /https?:\/\/[^"']+\.(?:png|svg|webp|jpe?g)/iu);
  assert.match(baseStyles, /--surface-brand-frame:\s*#ffffff/u);
  assert.match(styles, /\.brand-mark\s*\{[\s\S]*?place-items:\s*center/u);
  assert.match(styles, /\.education-identity\s*\{[\s\S]*?grid-template-columns:\s*4\.75rem minmax\(0, 1fr\)/u);
  assert.match(styles, /\.education-wordmark img\s*\{[\s\S]*?height:\s*5\.5rem/u);

  const originalRasterAssets = [
    {
      filename: "kienlongbank-symbol-6ddcb463.png",
      width: 1200,
      height: 1207,
      sha256: "6ddcb4635c179d084efbd11c0bea81cbe809a477a3fba6f85dc8d0c8cb58034a",
    },
    {
      filename: "mercedes-benz-mark-1ac65e81.jpg",
      width: 1756,
      height: 1756,
      sha256: "1ac65e815ae0960df33c3de8476f9d36ddbb788b3cbef71800db62b16815cd7e",
    },
    {
      filename: "ptit-mark-3ae2f7aa.png",
      width: 1200,
      height: 1525,
      sha256: "3ae2f7aa2c227b992915fb1b89a367cf5930237ef891d684d526335109b573d3",
    },
  ];
  let originalTotalBytes = 0;

  for (const { filename, width, height, sha256 } of originalRasterAssets) {
    const image = await readFile(path.join(projectRoot, "public", "assets", filename));
    originalTotalBytes += image.byteLength;
    assert.deepEqual(rasterDimensions(image), { width, height });
    assert.equal(createHash("sha256").update(image).digest("hex"), sha256);
  }

  assert.ok(
    originalTotalBytes < 250_000,
    "owner-supplied organization logo sources should stay below 250 KB",
  );

  const derivativeRasterAssets = [
    {
      filename: "kienlongbank-symbol-2x-07bba4e7.png",
      width: 96,
      height: 97,
      sourceWidth: 1200,
      sourceHeight: 1207,
      sha256: "07bba4e7adb70654b68470f033deaec381ecf4c8d0bc927497ee577c757ba9cb",
      maxBytes: 8_000,
    },
    {
      filename: "mercedes-benz-mark-2x-7f72465a.png",
      width: 100,
      height: 100,
      sourceWidth: 1756,
      sourceHeight: 1756,
      sha256: "7f72465a2a7d1202bd81c3f5f0eaef61ce6685cdd788306a2857ddda29051f88",
      maxBytes: 4_000,
    },
    {
      filename: "ptit-mark-2x-a6a58dca.png",
      width: 144,
      height: 183,
      sourceWidth: 1200,
      sourceHeight: 1525,
      sha256: "a6a58dcae73322cfa944305747241bdc6e6175b9466d36a3b717e566f827c0be",
      maxBytes: 16_000,
    },
  ];
  let derivativeTotalBytes = 0;

  for (const asset of derivativeRasterAssets) {
    const image = await readFile(path.join(projectRoot, "public", "assets", asset.filename));
    derivativeTotalBytes += image.byteLength;
    assert.deepEqual(rasterDimensions(image), { width: asset.width, height: asset.height });
    assert.equal(createHash("sha256").update(image).digest("hex"), asset.sha256);
    assert.ok(image.byteLength <= asset.maxBytes, `${asset.filename} should stay within budget`);
    assert.ok(
      Math.abs(asset.width / asset.height - asset.sourceWidth / asset.sourceHeight) < 0.006,
      `${asset.filename} must preserve its source aspect ratio within integer rounding`,
    );
    assert.ok(app.includes(`/assets/${asset.filename}`));
  }

  assert.ok(
    derivativeTotalBytes < 30_000,
    "normal-DPR organization logo candidates should stay below 30 KB total",
  );
  assert.match(app, /derivativeWidth: 96,[\s\S]*?sizes: "\(max-width: 64rem\) 2\.4rem, 2\.7rem"/u);
  assert.match(app, /derivativeWidth: 100,[\s\S]*?sizes: "\(max-width: 64rem\) 2\.75rem, 3\.05rem"/u);
  assert.match(app, /derivativeWidth: 144,[\s\S]*?sizes: "4\.33rem"/u);
});

test("navigation exposes location and fixed UI preserves focus space", async () => {
  const [app, baseStyles, styles, scrollHook] = await Promise.all([
    applicationSource(),
    source("src/base.css"),
    portfolioStyles(),
    source("src/portfolio/hooks/usePortfolioScroll.js"),
  ]);

  assert.match(app, /function useActivePortfolioSection/u);
  assert.match(app, /decodeURIComponent\(encodedTarget\)/u);
  assert.match(app, /target in TARGET_FOCUS_IDS/u);
  assert.match(app, /document\.fonts\?\.ready/u);
  assert.match(app, /document\.fonts\.ready\.then\(alignTarget\)/u);
  assert.match(scrollHook, /new window\.IntersectionObserver/u);
  assert.doesNotMatch(scrollHook, /addEventListener\("scroll"/u);
  assert.doesNotMatch(scrollHook, /getBoundingClientRect/u);
  assert.match(
    app,
    /getElementById\(target\)[\s\S]*?scrollIntoView\(\{ block: "start", behavior: "instant" \}\)/u,
  );
  assert.match(app, /function navigateToTarget/u);
  assert.match(app, /isPlainPrimaryClick\(event\)/u);
  assert.match(app, /window\.history\.pushState\(\{\}, "", `#\$\{target\}`\)/u);
  assert.match(app, /const focusId = TARGET_FOCUS_IDS\[target\]/u);
  assert.match(app, /const focusElement = document\.getElementById\(focusId\)/u);
  assert.match(app, /focusElement\?\.focus\(\{ preventScroll: true \}\)/u);
  assert.match(app, /!event\.metaKey[\s\S]*!event\.ctrlKey[\s\S]*!event\.shiftKey[\s\S]*!event\.altKey/u);
  assert.ok(
    app.includes('aria-current={activeSection === target ? "location" : undefined}'),
  );
  assert.match(app, /openerRef\.current\?\.focus/u);
  assert.match(app, /closeMenuAtDestination/u);
  assert.match(styles, /\.site-header\s*\{[\s\S]*?position:\s*sticky/u);
  assert.match(baseStyles, /body\s*\{[\s\S]*?overflow-x:\s*clip/u);
  assert.match(baseStyles, /scroll-padding-top:\s*7\.75rem/u);
  assert.match(styles, /\.wordmark\s*\{[\s\S]*?min-height:\s*2\.75rem/u);
  assert.match(styles, /\.mobile-menu-overlay\s*\{/u);
  assert.match(styles, /\.ask-nhan\.is-suppressed/u);
});

test("App delegates route composition, navigation, Ask Nhân, and WebMCP to bounded modules", async () => {
  const [app, route, header, ask, webMcpAdapter] = await Promise.all([
    source("src/App.jsx"),
    source("src/portfolio/PortfolioRoute.jsx"),
    source("src/components/Header.jsx"),
    source("src/components/AskNhan.jsx"),
    source("src/portfolio-webmcp.js"),
  ]);

  assert.match(app, /import \{ PortfolioRoute \} from "\.\/portfolio\/PortfolioRoute\.jsx"/u);
  assert.match(app, /export function App\(\) \{\s*return <PortfolioRoute \/>;\s*\}/u);
  assert.doesNotMatch(app, /AskNhan|Header|usePortfolioWebMcp/u);
  assert.match(route, /import \{ AskNhan \} from "\.\.\/components\/AskNhan\.jsx"/u);
  assert.match(route, /import \{ Header \} from "\.\.\/components\/Header\.jsx"/u);
  assert.match(route, /import \{ usePortfolioWebMcp \} from "\.\.\/portfolio-webmcp\.js"/u);
  assert.match(route, /<Header[\s\S]*?<PortfolioSections[\s\S]*?<PortfolioFooter[\s\S]*?<AskNhan/u);
  assert.doesNotMatch(app, /function (?:Header|MobileNavigationMenu|AskNhan)\b/u);
  assert.doesNotMatch(
    route,
    /async (?:navigatePortfolioSection|setPortfolioLocale|openAskNhan|closeAskNhan)\b/u,
  );
  assert.match(header, /export function MobileNavigationMenu/u);
  assert.match(header, /export function Header/u);
  assert.match(ask, /export function AskNhan/u);
  assert.match(webMcpAdapter, /export function usePortfolioWebMcp/u);
  assert.match(
    route,
    /usePortfolioWebMcp\(\{\s*askPrivateStateRef,\s*bridgeRef: webMcpBridgeRef,\s*\}\)/u,
  );
  assert.match(route, /onPrivacyStateChange=\{handleAskPrivacyStateChange\}/u);
  assert.match(ask, /useLayoutEffect\([\s\S]*?messages\.length > 1 \|\| draft\.length > 0 \|\| typing/u);
  assert.match(webMcpAdapter, /if \(askPrivateStateRef\.current\)[\s\S]*?webmcp_ask_private_state_present/u);
  assert.ok(
    app.split(/\r?\n/u).length < 10,
    "App.jsx should remain a thin route entry",
  );
  assert.ok(
    route.split(/\r?\n/u).length < 150,
    "PortfolioRoute should remain bounded to route-level orchestration",
  );
});

test("Portfolio publishes its WebMCP bridges only after React commits", async () => {
  const [route, adapter] = await Promise.all([
    source("src/portfolio/PortfolioRoute.jsx"),
    source("src/portfolio-webmcp.js"),
  ]);
  const bridgeEffect = route.match(
    /useLayoutEffect\(\(\) => \{\s*webMcpBridgeRef\.current = Object\.freeze\(\{[\s\S]*?mounted: true,[\s\S]*?changeLocale: setLocale,[\s\S]*?setChatOpen,[\s\S]*?setMenuOpen,[\s\S]*?\}\);\s*return \(\) => \{\s*webMcpBridgeRef\.current = UNMOUNTED_PORTFOLIO_WEBMCP_BRIDGE;\s*\};\s*\}, \[chatOpen, locale, openChat, setLocale\]\);/u,
  )?.[0];

  assert.ok(bridgeEffect, "the complete bridge publication must be a layout effect");
  assert.doesNotMatch(
    route.replace(bridgeEffect, ""),
    /webMcpBridgeRef\.current\s*=/u,
    "no WebMCP bridge may be published outside the committed layout effect",
  );
  assert.ok(
    route.indexOf(bridgeEffect) < route.indexOf("usePortfolioWebMcp({"),
    "the committed bridge must be declared before the WebMCP layout registration",
  );
  assert.match(
    route,
    /const openChat = useCallback\(\(\) => \{\s*setMenuOpen\(false\);\s*setChatOpen\(true\);\s*\}, \[\]\);/u,
  );
  assert.match(adapter, /import \{ useLayoutEffect \} from "react"/u);
  assert.doesNotMatch(adapter, /\buseEffect\b/u);
  assert.match(
    adapter,
    /useLayoutEffect\(\(\) => \{[\s\S]*?return registration\.cleanup;[\s\S]*?\}, \[askPrivateStateRef, bridgeRef\]\);/u,
  );
});

test("Portfolio WebMCP bridge fails closed after cleanup and aborts in-flight work", async () => {
  const unmounted = Object.freeze({ mounted: false });
  const bridgeRef = { current: unmounted };
  const effects = {
    chatSetters: 0,
    domReads: 0,
    historyWrites: 0,
    localeStateWrites: 0,
    localeStorageWrites: 0,
    menuSetters: 0,
    navigations: 0,
    opens: 0,
    waits: 0,
  };
  const documentObject = {
    body: { style: {} },
    documentElement: { lang: "en" },
    get activeElement() {
      effects.domReads += 1;
      return null;
    },
    getElementById() {
      effects.domReads += 1;
      return null;
    },
    querySelector() {
      effects.domReads += 1;
      return null;
    },
  };
  const windowObject = {
    location: { hash: "#about", pathname: "/en" },
  };
  const waitForState = (_predicate, { signal }) => {
    effects.waits += 1;
    return new Promise((_resolve, reject) => {
      const rejectAbort = () => reject(signal.reason);
      if (signal.aborted) rejectAbort();
      else signal.addEventListener("abort", rejectAbort, { once: true });
    });
  };
  const actions = createPortfolioRouteWebMcpActions({
    askPrivateStateRef: { current: false },
    bridgeRef,
    documentObject,
    navigate: async () => {
      effects.navigations += 1;
      return null;
    },
    waitForState,
    windowObject,
  });

  const navigationLifecycle = new AbortController();
  bridgeRef.current = Object.freeze({
    mounted: true,
    chatOpen: false,
    locale: "en",
    changeLocale() {},
    openChat() {
      effects.opens += 1;
    },
    setChatOpen() {
      effects.chatSetters += 1;
    },
    setMenuOpen() {
      effects.menuSetters += 1;
    },
  });
  const navigation = actions.navigatePortfolioSection("about", {
    signal: navigationLifecycle.signal,
  });
  assert.equal(effects.menuSetters, 1);
  assert.equal(effects.chatSetters, 1);
  assert.equal(effects.waits, 1);

  bridgeRef.current = unmounted;
  navigationLifecycle.abort();
  await assert.rejects(navigation, { name: "AbortError" });
  assert.equal(effects.navigations, 0, "navigation must not run after cleanup");
  assert.equal(effects.domReads, 0, "no delayed DOM predicate may run after cleanup");

  const localeLifecycle = new AbortController();
  bridgeRef.current = Object.freeze({
    mounted: true,
    chatOpen: false,
    locale: "en",
    changeLocale() {
      effects.localeStorageWrites += 1;
      effects.historyWrites += 1;
      effects.localeStateWrites += 1;
    },
    openChat() {},
    setChatOpen() {},
    setMenuOpen() {},
  });
  const localeChange = actions.setPortfolioLocale("vi", {
    signal: localeLifecycle.signal,
  });
  assert.deepEqual(
    [
      effects.localeStorageWrites,
      effects.historyWrites,
      effects.localeStateWrites,
    ],
    [1, 1, 1],
    "the mounted action may commit exactly once before cleanup",
  );
  bridgeRef.current = unmounted;
  localeLifecycle.abort();
  await assert.rejects(localeChange, { name: "AbortError" });
  assert.deepEqual(
    [
      effects.localeStorageWrites,
      effects.historyWrites,
      effects.localeStateWrites,
    ],
    [1, 1, 1],
    "cleanup must prevent every late locale side effect",
  );

  const invokeAfterCleanup = [
    () => actions.readPortfolioOverview({ signal: new AbortController().signal }),
    () =>
      actions.navigatePortfolioSection("about", {
        signal: new AbortController().signal,
      }),
    () =>
      actions.setPortfolioLocale("vi", {
        signal: new AbortController().signal,
      }),
    () => actions.openAskNhan({ signal: new AbortController().signal }),
    () => actions.closeAskNhan({ signal: new AbortController().signal }),
  ];
  const beforeLateInvoke = { ...effects };
  for (const invoke of invokeAfterCleanup) {
    await assert.rejects(invoke(), /webmcp_bridge_unmounted/u);
  }
  assert.deepEqual(effects, beforeLateInvoke, "post-cleanup tools must cause no effects");
});

test("visitor counter is a supplemental one-shot Cloudflare read", async () => {
  const [route, footer, visitorCount] = await Promise.all([
    source("src/portfolio/PortfolioRoute.jsx"),
    source("src/portfolio/layout/PortfolioFooter.jsx"),
    source("src/use-visitor-count.js"),
  ]);

  assert.match(route, /import \{ useVisitorCount \} from "\.\.\/use-visitor-count\.js"/u);
  assert.match(route, /const visitorCount = useVisitorCount\(\)/u);
  assert.match(visitorCount, /fetch\("\/api\/visitor-count"/u);
  assert.match(visitorCount, /void load\(\)/u);
  assert.doesNotMatch(visitorCount, /setInterval|visibilitychange|document\.visibilityState/u);
  assert.match(visitorCount, /credentials: "omit"/u);
  assert.match(visitorCount, /cache: "no-store"/u);
  assert.match(footer, /className="footer-visits"/u);
  assert.doesNotMatch(footer, /className="footer-visits"[^>]*aria-live=/u);
});

test("WebMCP navigation waits for mobile overlays and inertness to clear before focus", async () => {
  const webMcpAdapter = await source("src/portfolio-webmcp.js");
  const actionStart = webMcpAdapter.indexOf("async navigatePortfolioSection");
  const closeMenu = webMcpAdapter.indexOf("setMenuOpen(false);", actionStart);
  const closeChat = webMcpAdapter.indexOf("setChatOpen(false);", closeMenu);
  const waitForOverlayCleanup = webMcpAdapter.indexOf(
    "await waitForState",
    closeChat,
  );
  const navigate = webMcpAdapter.indexOf(
    "const navigation = await navigate",
    waitForOverlayCleanup,
  );

  assert.ok(actionStart >= 0);
  assert.ok(closeMenu > actionStart);
  assert.ok(closeChat > closeMenu);
  assert.ok(waitForOverlayCleanup > closeChat);
  assert.ok(navigate > waitForOverlayCleanup);
  assert.match(webMcpAdapter, /!documentObject\.getElementById\("ask-nhan-dialog"\)/u);
  assert.match(webMcpAdapter, /!documentObject\.querySelector\("\.mobile-menu-overlay"\)/u);
  assert.match(
    webMcpAdapter,
    /!documentObject\.getElementById\("main-content"\)\?\.hasAttribute\("inert"\)/u,
  );
});

test("WebMCP opening waits for focus and mobile modal isolation", async () => {
  const webMcpAdapter = await source("src/portfolio-webmcp.js");
  const openStateSource = extractFunctionSource(
    webMcpAdapter,
    "askNhanModalOpenFinished",
  );

  assert.match(openStateSource, /!dialog \|\| !focusAskNhanInput\(documentObject\)/u);
  assert.match(
    openStateSource,
    /dialog\.getAttribute\("aria-modal"\) !== "true"\) return true/u,
  );
  assert.match(openStateSource, /documentObject\.body\.style\.overflow === "hidden"/u);
  assert.match(openStateSource, /element\.hasAttribute\("inert"\)/u);
  assert.match(
    openStateSource,
    /element\.getAttribute\("aria-hidden"\) === "true"/u,
  );
  assert.equal(
    (webMcpAdapter.match(/askNhanModalOpenFinished\(dialog, documentObject\)/gu) ?? []).length,
    3,
    "the helper declaration and both open paths must share the same readiness invariant",
  );
});

test("navigation, DOM order, mobile numbering, and section rails share one sequence", async () => {
  const app = await applicationSource();

  assert.match(
    app,
    /const PORTFOLIO_SECTION_IDS = \[\s*"top",\s*"work",\s*"product",\s*"experience",\s*"about",\s*"contact",\s*\];/u,
  );
  assert.match(
    app,
    /const navItems = \[\s*\["work", copy\.nav\.work\],\s*\["product", copy\.nav\.product\],\s*\["experience", copy\.nav\.experience\],\s*\["about", copy\.nav\.about\],\s*\["contact", copy\.nav\.contact\],\s*\];/u,
  );
  assert.match(
    app,
    /<main id="main-content" tabIndex="-1">\s*<Hero copy=\{copy\} \/>\s*<SelectedWork copy=\{copy\} \/>\s*<PersonalProduct copy=\{copy\} locale=\{locale\} \/>\s*<Experience copy=\{copy\} \/>\s*<Approach copy=\{copy\} \/>\s*<Contact copy=\{copy\} \/>\s*<\/main>/u,
  );
  assert.match(
    app,
    /<span className="mobile-nav-index" aria-hidden="true">\s*0\{index \+ 2\}\s*<\/span>/u,
  );
  assert.match(app, /function Hero[\s\S]*?<SectionRail index="01" label=\{copy\.hero\.eyebrow\} \/>/u);
  assert.match(app, /function SelectedWork[\s\S]*?<SectionRail index="02" label=\{copy\.work\.eyebrow\} \/>/u);
  assert.match(app, /function PersonalProduct[\s\S]*?<SectionRail index="03" label=\{copy\.product\.eyebrow\} \/>/u);
  assert.match(app, /function Experience[\s\S]*?<SectionRail index="04" label=\{copy\.experience\.eyebrow\} \/>/u);
  assert.match(app, /function Approach[\s\S]*?<SectionRail index="05" label=\{copy\.about\.eyebrow\} \/>/u);
  assert.match(app, /function Contact[\s\S]*?<SectionRail index="06" label=\{copy\.contact\.eyebrow\} \/>/u);
});

test("mobile navigation is a full-screen fixed modal with an independent scroll region", async () => {
  const [app, styles] = await Promise.all([
    applicationSource(),
    portfolioStyles(),
  ]);
  const overlayRules = [
    ...styles.matchAll(/\.mobile-menu-overlay\s*\{([^}]*)\}/gu),
  ].map((match) => match[1]);
  const headerRules = [
    ...styles.matchAll(/\.mobile-menu-header\s*\{([^}]*)\}/gu),
  ].map((match) => match[1]);
  const mobileNavRules = [...styles.matchAll(/\.mobile-nav\s*\{([^}]*)\}/gu)].map(
    (match) => match[1],
  );

  assert.match(app, /import \{ createPortal \} from "react-dom"/u);
  assert.match(app, /aria-controls=\{menuOpen \? "mobile-navigation" : undefined\}/u);
  assert.match(app, /return createPortal\([\s\S]*?document\.body/u);
  assert.match(app, /role="dialog"/u);
  assert.match(app, /aria-modal="true"/u);
  assert.match(
    app,
    /Object\.assign\(document\.body\.style, \{[\s\S]*?overflow: "hidden",[\s\S]*?position: "fixed",[\s\S]*?top: `\$\{-lockedScrollY\}px`/u,
  );
  assert.match(app, /Object\.assign\(document\.body\.style, previousBodyStyle\)/u);
  assert.match(app, /const previousBodyStyle = \{[\s\S]*?overflow: document\.body\.style\.overflow/u);
  assert.match(app, /classList\.add\("mobile-menu-open"\)/u);
  assert.match(app, /classList\.remove\("mobile-menu-open"\)/u);
  assert.match(
    app,
    /menuButtonScrollRef\.current = \{\s*x: window\.scrollX,\s*y: window\.scrollY,\s*\};\s*onMenuChange\(true\)/u,
  );
  assert.match(app, /openerScrollRef\.current\?\.y \?\? window\.scrollY/u);
  assert.match(app, /top:\s*lockedScrollY,[\s\S]*?behavior:\s*"instant"/u);
  assert.match(app, /restoreBackgroundScrollRef\.current = false/u);
  assert.match(
    app,
    /getElementById\(target\)[\s\S]*?scrollIntoView\(\{ block: "start", behavior: "instant" \}\)/u,
  );
  assert.match(app, /appRoot\?\.setAttribute\("inert", ""\)/u);
  assert.match(app, /mobileMedia\.addEventListener\("change", closeOnDesktop\)/u);
  assert.doesNotMatch(app, /addEventListener\("touchmove"/u);
  assert.doesNotMatch(app, /rootElement\.style\.overflow/u);
  assert.doesNotMatch(styles, /mobile-nav-scrim/u);
  assert.ok(
    overlayRules.some(
      (rule) =>
        /position:\s*fixed/u.test(rule) &&
        /inset:\s*0/u.test(rule) &&
        /z-index:\s*9999/u.test(rule) &&
        /width:\s*100vw/u.test(rule) &&
        /height:\s*100dvh/u.test(rule) &&
        /overflow:\s*hidden/u.test(rule) &&
        /background:\s*var\(--surface-inverse\)/u.test(rule),
    ),
    "the modal must fully cover and clip the viewport",
  );
  assert.ok(
    overlayRules.every((rule) => !/position:\s*absolute/u.test(rule)) &&
      mobileNavRules.every((rule) => !/position:\s*absolute/u.test(rule)),
    "no mobile menu layer may be positioned against a scrolling ancestor",
  );
  assert.ok(
    headerRules.some(
      (rule) =>
        /position:\s*sticky/u.test(rule) &&
        /top:\s*0/u.test(rule) &&
        /z-index:\s*2/u.test(rule),
    ),
    "the logo and close control must remain pinned above the menu content",
  );
  assert.ok(
    mobileNavRules.some(
      (rule) =>
        /flex:\s*1 1 auto/u.test(rule) &&
        /min-height:\s*0/u.test(rule) &&
        /overflow-y:\s*auto/u.test(rule) &&
        /-webkit-overflow-scrolling:\s*touch/u.test(rule) &&
        /overscroll-behavior-y:\s*contain/u.test(rule) &&
        /touch-action:\s*pan-y/u.test(rule),
    ),
    "short viewports must scroll inside the menu without freezing touch input",
  );
});

test("mobile navigation transfers focus to a visible desktop control at the breakpoint", async () => {
  const headerSource = await source("src/components/Header.jsx");

  assert.match(headerSource, /const desktopFirstLinkRef = useRef\(null\)/u);
  assert.match(headerSource, /ref=\{index === 0 \? desktopFirstLinkRef : undefined\}/u);
  assert.match(headerSource, /desktopFocusRef=\{desktopFirstLinkRef\}/u);
  assert.match(
    headerSource,
    /closeMobileNavigationAtDesktopBreakpoint\(\s*event,\s*onMenuChange,\s*desktopFocusRef/u,
  );

  const scheduledFrames = [];
  const focusCalls = [];
  const menuChanges = [];
  const desktopFocusRef = {
    current: {
      focus(options) {
        focusCalls.push(options);
      },
    },
  };
  const scheduleFrame = (callback) => scheduledFrames.push(callback);

  assert.equal(
    closeMobileNavigationAtDesktopBreakpoint(
      { matches: true },
      (nextOpen) => menuChanges.push(nextOpen),
      desktopFocusRef,
      scheduleFrame,
    ),
    false,
  );
  assert.deepEqual(menuChanges, []);
  assert.deepEqual(scheduledFrames, []);

  assert.equal(
    closeMobileNavigationAtDesktopBreakpoint(
      { matches: false },
      (nextOpen) => menuChanges.push(nextOpen),
      desktopFocusRef,
      scheduleFrame,
    ),
    true,
  );
  assert.deepEqual(menuChanges, [false]);
  assert.equal(focusCalls.length, 0, "focus must wait until React has closed the mobile menu");
  assert.equal(scheduledFrames.length, 1);

  scheduledFrames[0]();
  assert.deepEqual(focusCalls, [{ preventScroll: true }]);
});

test("in-page navigation does not inherit multi-second smooth scrolling", () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const hadWindow = Object.hasOwn(globalThis, "window");
  const hadDocument = Object.hasOwn(globalThis, "document");
  const scheduledFrames = [];
  const historyCalls = [];
  const scrollCalls = [];
  const focusCalls = [];
  let prevented = false;

  globalThis.window = {
    history: {
      pushState(state, title, url) {
        historyCalls.push({ state, title, url });
      },
    },
    requestAnimationFrame(callback) {
      scheduledFrames.push(callback);
    },
  };
  globalThis.document = {
    getElementById(id) {
      if (id === "work") {
        return {
          scrollIntoView(options) {
            scrollCalls.push(options);
          },
        };
      }
      if (id === "work-title") {
        return {
          focus(options) {
            focusCalls.push(options);
          },
        };
      }
      return null;
    },
  };

  try {
    const event = {
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {
        prevented = true;
      },
    };

    assert.equal(navigateToTarget(event, "work"), true);
    assert.equal(prevented, true);
    assert.deepEqual(historyCalls, [{ state: {}, title: "", url: "#work" }]);
    assert.equal(scheduledFrames.length, 1);

    scheduledFrames[0]();
    assert.deepEqual(scrollCalls, [{ block: "start", behavior: "instant" }]);
    assert.deepEqual(focusCalls, [{ preventScroll: true }]);
  } finally {
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
    if (hadDocument) globalThis.document = previousDocument;
    else delete globalThis.document;
  }
});

test("programmatic navigation resolves only after scroll and focus are visible", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const hadWindow = Object.hasOwn(globalThis, "window");
  const hadDocument = Object.hasOwn(globalThis, "document");
  const scheduledFrames = [];
  const targetElement = {
    scrollIntoView() {},
  };
  const focusElement = {
    focus() {
      globalThis.document.activeElement = focusElement;
    },
  };

  globalThis.window = {
    history: { pushState() {} },
    requestAnimationFrame(callback) {
      scheduledFrames.push(callback);
    },
  };
  globalThis.document = {
    activeElement: null,
    getElementById(id) {
      if (id === "work") return targetElement;
      if (id === "work-title") return focusElement;
      return null;
    },
  };

  try {
    let settled = false;
    const navigation = navigateToTargetById("work").then((result) => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(scheduledFrames.length, 1);

    scheduledFrames[0]();
    const result = await navigation;
    assert.deepEqual(result, {
      focusId: "work-title",
      focused: true,
      target: "work",
    });
    assert.equal(await navigateToTargetById("not-a-target"), null);
  } finally {
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
    if (hadDocument) globalThis.document = previousDocument;
    else delete globalThis.document;
  }
});

test("programmatic navigation fails closed before mutation when unavailable or aborted", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const hadWindow = Object.hasOwn(globalThis, "window");
  const hadDocument = Object.hasOwn(globalThis, "document");
  const scheduledFrames = new Map();
  let nextFrameId = 1;
  let historyCalls = 0;
  let beforeCalls = 0;
  let focusSucceeds = false;
  let targetAvailable = false;
  const targetElement = { scrollIntoView() {} };
  const focusElement = {
    focus() {
      if (focusSucceeds) globalThis.document.activeElement = focusElement;
    },
  };

  globalThis.window = {
    history: {
      pushState() {
        historyCalls += 1;
      },
    },
    requestAnimationFrame(callback) {
      const frameId = nextFrameId;
      nextFrameId += 1;
      scheduledFrames.set(frameId, callback);
      return frameId;
    },
    cancelAnimationFrame(frameId) {
      scheduledFrames.delete(frameId);
    },
  };
  globalThis.document = {
    activeElement: null,
    getElementById(id) {
      if (!targetAvailable) return null;
      if (id === "work") return targetElement;
      if (id === "work-title") return focusElement;
      return null;
    },
  };

  try {
    const unavailable = navigateToTargetById("work", () => {
      beforeCalls += 1;
    });
    scheduledFrames.get(1)();
    assert.equal(await unavailable, null);
    assert.equal(beforeCalls, 0);
    assert.equal(historyCalls, 0);

    targetAvailable = true;
    const unfocused = navigateToTargetById("work", () => {
      beforeCalls += 1;
    });
    scheduledFrames.get(2)();
    assert.equal(await unfocused, null);
    assert.equal(beforeCalls, 1);
    assert.equal(historyCalls, 1);

    const execution = new AbortController();
    const aborted = navigateToTargetById(
      "work",
      () => {
        beforeCalls += 1;
      },
      { signal: execution.signal },
    );
    execution.abort();
    await assert.rejects(aborted, { name: "AbortError" });
    assert.equal(scheduledFrames.has(3), false);
    assert.equal(beforeCalls, 1);
    assert.equal(historyCalls, 1);
  } finally {
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
    if (hadDocument) globalThis.document = previousDocument;
    else delete globalThis.document;
  }
});

test("mobile Ask Nhân completes its modal focus and inertness contract", async () => {
  const app = await applicationSource();

  assert.ok(app.includes("aria-modal={modalMode}"));
  assert.match(app, /element\.setAttribute\("inert", ""\)/u);
  assert.match(app, /element\.setAttribute\("aria-hidden", "true"\)/u);
  assert.match(app, /element\.removeAttribute\("inert"\)/u);
  assert.match(app, /element\.removeAttribute\("aria-hidden"\)/u);
  assert.match(app, /event\.key === "Escape"/u);
  assert.match(app, /launcherRef\.current\?\.focus/u);
  assert.match(app, /modalMode \|\| event\.key !== "Tab"/u);
  assert.match(app, /setElementsTemporarilyInert\(\s*askNhanModalBackgroundElements\(document\)/u);
  assert.match(app, /restoreBackgroundAccessibility\(\)/u);
  assert.match(
    app,
    /focusAskDialogIfNeeded\(\s*panelRef\.current,\s*inputRef\.current,\s*document\.activeElement/u,
  );
  assert.match(app, /return \(\) => window\.cancelAnimationFrame\(animationFrame\)/u);
  assert.match(app, /\}, \[isOpen, modalMode\]\)/u);

  assert.deepEqual(ASK_NHAN_MODAL_BACKGROUND_SELECTORS, [
    ".skip-link",
    ".site-header",
    "#main-content",
    ".site-footer",
  ]);

  const makeElement = (initialAttributes = {}) => {
    const attributes = new Map(Object.entries(initialAttributes));
    return {
      attributes,
      getAttribute(name) {
        return attributes.has(name) ? attributes.get(name) : null;
      },
      removeAttribute(name) {
        attributes.delete(name);
      },
      setAttribute(name, value) {
        attributes.set(name, value);
      },
    };
  };
  const skipLink = makeElement();
  const header = makeElement({ inert: "inherited", "aria-hidden": "false" });
  const main = makeElement({ "aria-hidden": "true" });
  const footer = makeElement({ inert: "" });
  const elementsBySelector = new Map([
    [".skip-link", skipLink],
    [".site-header", header],
    ["#main-content", main],
    [".site-footer", footer],
  ]);
  const queriedSelectors = [];
  const backgroundElements = askNhanModalBackgroundElements({
    querySelector(selector) {
      queriedSelectors.push(selector);
      return elementsBySelector.get(selector) ?? null;
    },
  });

  assert.deepEqual(queriedSelectors, ASK_NHAN_MODAL_BACKGROUND_SELECTORS);
  assert.deepEqual(backgroundElements, [skipLink, header, main, footer]);
  const restore = setElementsTemporarilyInert(backgroundElements);
  backgroundElements.forEach((element) => {
    assert.equal(element.getAttribute("inert"), "");
    assert.equal(element.getAttribute("aria-hidden"), "true");
  });

  restore();
  assert.deepEqual(Object.fromEntries(skipLink.attributes), {});
  assert.deepEqual(Object.fromEntries(header.attributes), {
    inert: "inherited",
    "aria-hidden": "false",
  });
  assert.deepEqual(Object.fromEntries(main.attributes), { "aria-hidden": "true" });
  assert.deepEqual(Object.fromEntries(footer.attributes), { inert: "" });

  const focusCalls = [];
  const input = {
    focus(options) {
      focusCalls.push(options);
    },
  };
  const insideDialog = {};
  const outsideDialog = {};
  const panel = {
    contains(element) {
      return element === insideDialog;
    },
  };

  assert.equal(focusAskDialogIfNeeded(panel, input, insideDialog), false);
  assert.deepEqual(focusCalls, []);
  assert.equal(focusAskDialogIfNeeded(panel, input, outsideDialog), true);
  assert.deepEqual(focusCalls, [{ preventScroll: true }]);
});

test("hero name uses exact title case and a reduced-motion-safe masked reveal", async () => {
  const [app, contentSource, main, styles] = await Promise.all([
    applicationSource(),
    source("src/content.js"),
    source("src/main.jsx"),
    portfolioStyles(),
  ]);

  assert.match(app, /aria-label="Trần Thiện Nhân"/u);
  assert.match(
    app,
    /hero-name-word">Trần<[\s\S]*hero-name-word">Thiện<[\s\S]*hero-name-word">Nhân</u,
  );
  assert.doesNotMatch(app, /hero-art|kinetic-loop-willow|fetchPriority/u);
  assert.doesNotMatch(contentSource, /artAlt/u);
  assert.match(styles, /\.hero-name\s*\{[^}]*text-transform:\s*none/su);
  assert.match(styles, /\.hero-name-line\s*\{[^}]*overflow:\s*hidden/su);
  assert.match(
    styles,
    /\.hero-name-word\s*\{[^}]*animation:\s*hero-name-word-enter 640ms cubic-bezier\(0, 0, 0\.3, 1\) both/su,
  );
  assert.match(
    styles,
    /@keyframes hero-name-word-enter\s*\{[\s\S]*opacity:\s*0;[\s\S]*translate3d\(0, 112%, 0\)[\s\S]*opacity:\s*1;[\s\S]*translate3d\(0, 0, 0\)/u,
  );
  assert.doesNotMatch(
    styles,
    /\.hero-art|@keyframes art-enter|--line-scale|scaleX\(var\(--line-scale/u,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.hero-name-word\s*\{[^}]*animation:\s*none;[^}]*opacity:\s*1;[^}]*transform:\s*none;/u,
  );
  assert.doesNotMatch(main, /be-vietnam-pro\/800\.css/u);
});

test("selected work exposes goals, contributions, results, metrics, and scope semantically", async () => {
  const [app, styles] = await Promise.all([
    applicationSource(),
    portfolioStyles(),
  ]);

  assert.match(app, /function SelectedWork/u);
  assert.match(app, /id="work"/u);
  assert.match(app, /aria-labelledby="work-title"/u);
  assert.match(app, /<article[\s\S]*className="case-study"/u);
  assert.match(app, /<dl className="case-details">/u);
  assert.match(app, /copy\.work\.labels\.goal/u);
  assert.match(app, /copy\.work\.labels\.contribution/u);
  assert.match(app, /copy\.work\.labels\.outcome/u);
  assert.match(app, /copy\.work\.labels\.scope/u);
  assert.match(app, /className="case-metrics"/u);
  assert.match(app, /data-metric-count=\{item\.metrics\.length\}/u);
  assert.match(app, /className="work-index"/u);
  assert.match(app, /aria-label=\{copy\.work\.labels\.index\}/u);
  assert.match(app, /id=\{`work-\$\{item\.slug\}`\}/u);
  assert.match(app, /copy\.work\.labels\.period/u);
  assert.match(app, /navigateToTarget\(event, `work-\$\{item\.slug\}`\)/u);
  assert.doesNotMatch(app, /style=\{\{/u);
  assert.match(styles, /\.work-index ol\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/su);
  assert.match(styles, /\.case-study\s*\{[^}]*scroll-margin-top:\s*7\.75rem/su);
  assert.match(styles, /\.case-metrics\[data-metric-count="2"\]/u);
  assert.match(styles, /\.case-metrics\[data-metric-count="3"\]/u);
  assert.match(styles, /\.case-metrics\[data-metric-count="4"\]/u);
  assert.doesNotMatch(styles, /--metric-count/u);
});

test("X Nhân remains a distinct personal-product section with two product routes", async () => {
  const [app, header, styles] = await Promise.all([
    source("src/portfolio/sections/PersonalProduct.jsx"),
    source("src/components/Header.jsx"),
    portfolioStyles(),
  ]);

  assert.match(app, /function PersonalProduct/u);
  assert.match(app, /function PersonalProduct\(\{ copy, locale \}\)/u);
  assert.match(app, /id="product"/u);
  assert.match(app, /aria-labelledby="product-title"/u);
  assert.match(app, /href=\{xNhanHref\("\/xnhan", locale\)\}/u);
  assert.match(app, /href=\{xNhanHref\("\/xnhan\/about", locale\)\}/u);
  assert.match(app, /<ol className="product-flow"/u);
  assert.match(app, /<ul\s+className="product-proofs"/u);
  assert.match(
    app,
    /className="product-name"[\s\S]*?copy\.product\.name[\s\S]*?className="product-new-badge"[\s\S]*?copy\.product\.badge/u,
  );
  assert.equal((header.match(/copy\.product\.badge/gu) ?? []).length, 2);
  assert.match(header, /className="mobile-nav-index" aria-hidden="true"/u);
  assert.doesNotMatch(
    `${app}\n${header}`,
    /product-new-badge"[^>]*aria-hidden/u,
  );
  assert.match(styles, /\.product-section\s*\{[^}]*background:\s*var\(--surface-inverse\)/su);
  assert.match(
    styles,
    /\.product-new-badge\s*\{[^}]*color:\s*var\(--surface-inverse\)[^}]*background:\s*var\(--accent-signal-on-dark\)[^}]*animation:\s*product-badge-enter/su,
  );
  assert.match(styles, /@keyframes product-badge-enter/u);
  assert.match(styles, /@keyframes product-signal/u);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.product-flow li::before\s*\{[^}]*animation:\s*none/su,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.product-new-badge\s*\{[^}]*animation:\s*none[^}]*transform:\s*none/su,
  );
});

test("visitor tracking stays same-origin and content-free while the footer omits retired copy", async () => {
  const app = await applicationSource();
  const styles = await portfolioStyles();
  const trackingSource = extractFunctionSource(app, "usePortfolioVisitorTracking");

  assert.match(trackingSource, /navigator\.globalPrivacyControl === true/u);
  assert.match(trackingSource, /fetch\("\/api\/visit"/u);
  assert.match(trackingSource, /credentials: "omit"/u);
  assert.match(trackingSource, /keepalive: true/u);
  assert.match(trackingSource, /referrerPolicy: "no-referrer"/u);
  assert.match(trackingSource, /campaignSource/u);
  assert.match(trackingSource, /campaignMedium/u);
  assert.match(trackingSource, /campaignName/u);
  assert.doesNotMatch(
    trackingSource,
    /message|answer|turnstile|chat|userAgent|navigator\.userAgent|cookie|localStorage|sessionStorage/iu,
  );
  assert.match(app, /usePortfolioVisitorTracking\(locale\)/u);
  const visitorCount = await source("src/use-visitor-count.js");
  assert.match(visitorCount, /fetch\("\/api\/visitor-count"/u);
  assert.doesNotMatch(visitorCount, /setInterval|visibilitychange|document\.visibilityState/u);
  assert.match(app, /className="footer-visits"/u);
  assert.doesNotMatch(app, /className="footer-(?:privacy|credit)"/u);
  assert.match(styles, /\.footer-visits/u);
  assert.doesNotMatch(styles, /\.footer-(?:privacy|credit)/u);
  assert.match(
    styles,
    /\.site-footer\s*\{[^}]*padding:\s*4rem var\(--page-gutter\) calc\(7rem \+ env\(safe-area-inset-bottom\)\)/su,
  );
  assert.equal("privacy" in content.en.footer, false);
  assert.equal("privacy" in content.vi.footer, false);
  assert.equal("credit" in content.en.footer, false);
  assert.equal("credit" in content.vi.footer, false);
  assert.equal(content.en.footer.visitorCountLabel, "Website visits");
  assert.equal(content.vi.footer.visitorCountLabel, "Lượt truy cập website");
  assert.doesNotMatch(
    JSON.stringify({ en: content.en.footer, vi: content.vi.footer }),
    /limited technical visit data|một số dữ liệu kỹ thuật về lượt truy cập|GPT 5\.6 Sol|Claude Opus 5|Claude Fable 5/iu,
  );
});

test("the public privacy contract stays provider-neutral and documents fixed X Nhân prompts", async () => {
  const privacyDocument = await source("docs/privacy.md");
  const browserBoundary = privacyDocument.match(
    /## Browser boundary\s+([\s\S]*?)(?=\n## Ask Nhân)/u,
  )?.[1] ?? "";
  const visitorBoundary = privacyDocument.match(
    /## Visitor analytics\s+([\s\S]*?)(?=\n## Cloudflare platform processing)/u,
  )?.[1] ?? "";

  assert.match(privacyDocument, /additional platform or provider data/iu);
  assert.match(browserBoundary, /three starter questions are fixed bilingual copy/iu);
  assert.match(browserBoundary, /not fetched, polled, ranked, or stored/iu);
  assert.match(browserBoundary, /WebMCP exposes only bounded public portfolio controls/iu);
  assert.match(visitorBoundary, /normalized `CF-Connecting-IP` address/iu);
  assert.match(visitorBoundary, /rolling seven-local-date operational window/iu);
  assert.match(visitorBoundary, /never exposes raw rows/iu);
  assert.match(privacyDocument, /The selected application provider is explicit and is never silently replaced/iu);
  assert.match(privacyDocument, /The model's private chain of thought/iu);
  assert.doesNotMatch(privacyDocument, /hourly discovery job|trend provider|trend Durable Object/iu);
});

test("Ask Nhân local fallback routes exact X contact queries before generic profile", async () => {
  const askSource = await source("src/components/AskNhan.jsx");
  const helpers = evaluateAskFallbackHelpers(askSource);
  const cases = [
    ["What is Nhân's X profile?", "en"],
    ["Can you help me find Nhân's X profile?", "en"],
    ["Hồ sơ X của Nhân là gì?", "vi"],
    ["Hồ sơ X của Nhân là gì?".normalize("NFD"), "vi"],
    ["@tran_thien_nhan", "en"],
    ["tran_thien_nhan", "vi"],
  ];

  for (const [message, locale] of cases) {
    assert.equal(helpers.isContactIntent(message), true, message);
    assert.equal(
      helpers.chooseReply(message, content[locale]),
      content[locale].contact.body,
      message,
    );
    assert.equal(helpers.chooseRelatedSection(message), "contact", message);
  }

  for (const message of ["x", "X Nhân"]) {
    assert.equal(helpers.isContactIntent(message), false, message);
    assert.notEqual(helpers.chooseRelatedSection(message), "contact", message);
  }
  assert.equal(
    helpers.chooseReply("Tell me about Nhân's profile", content.en),
    content.en.chat.replies.profile,
  );
});

test("Ask Nhân bounds requests and distinguishes timeout aborts from intentional cancellation", async () => {
  const askSource = await source("src/components/AskNhan.jsx");
  const sendStart = askSource.indexOf("const sendMessage = async (");
  const sendEnd = askSource.indexOf("\n  const headerStatus =", sendStart);

  assert.ok(sendStart >= 0, "sendMessage source must be discoverable");
  assert.ok(sendEnd > sendStart, "sendMessage source must have a complete body");
  const sendSource = askSource.slice(sendStart, sendEnd);

  assert.match(askSource, /const ASK_REQUEST_TIMEOUT_MS = 120_000;/u);
  assert.equal(
    (askSource.match(/ASK_REQUEST_TIMEOUT_MS = 120_000/gu) ?? []).length,
    1,
    "the request timeout must have one authoritative 120-second constant",
  );
  assert.match(
    sendSource,
    /requestRef\.current = controller;\s*let requestTimedOut = false;\s*const requestTimeoutId = window\.setTimeout\(\(\) => \{\s*if \(requestRef\.current !== controller\) return;\s*requestTimedOut = true;\s*controller\.abort\(\);\s*\}, ASK_REQUEST_TIMEOUT_MS\);/u,
  );

  const controllerCurrentIndex = sendSource.indexOf("requestRef.current = controller;");
  const timerIndex = sendSource.indexOf("const requestTimeoutId = window.setTimeout");
  const fetchIndex = sendSource.indexOf('fetch("/api/ask"');
  assert.ok(
    controllerCurrentIndex >= 0 && timerIndex > controllerCurrentIndex && fetchIndex > timerIndex,
    "the bounded timer must start after the controller becomes current and before fetch",
  );

  assert.match(
    sendSource,
    /const requestWasAborted =\s*error instanceof DOMException && error\.name === "AbortError";\s*if \(requestWasAborted && !requestTimedOut\) return;\s*setMessages\(\(items\) => \[/u,
  );
  assert.ok(
    sendSource.indexOf("text: chooseReply(clean, answerCopy)") >
      sendSource.indexOf("if (requestWasAborted && !requestTimedOut) return;"),
    "a timed-out abort must continue into the bounded local fallback",
  );

  assert.match(
    sendSource,
    /finally \{\s*window\.clearTimeout\(requestTimeoutId\);\s*if \(requestRef\.current === controller\) \{\s*requestRef\.current = null;\s*inFlightRef\.current = false;\s*setTyping\(false\);\s*\}/u,
  );
  assert.equal(
    (sendSource.match(/window\.clearTimeout\(requestTimeoutId\);/gu) ?? []).length,
    1,
    "the request timer must be cleared exactly once from finally",
  );
  assert.doesNotMatch(sendSource, /verification|turnstile/iu);
});

test("Ask Nhân exposes only public material and keeps the transcript in page memory", async () => {
  const [app, askSource, headers, index, styles] = await Promise.all([
    applicationSource(),
    source("src/components/AskNhan.jsx"),
    source("public/_headers"),
    source("index.html"),
    portfolioStyles(),
  ]);
  const { chat: englishChat, ...englishPage } = content.en;
  const { chat: vietnameseChat, ...vietnamesePage } = content.vi;

  assert.match(askSource, /export function AskNhan/u);

  assert.equal("resume" in content.en, false);
  assert.equal("resume" in content.vi, false);
  assert.doesNotMatch(app, /copy\.resume|resume-button|source-toast|onResume|resumeNotice/u);
  assert.doesNotMatch(JSON.stringify(englishPage), /resume/iu);
  assert.doesNotMatch(JSON.stringify(vietnamesePage), /resume/iu);
  assert.equal("sourceNote" in content.en.experience, false);
  assert.equal("sourceNote" in content.vi.experience, false);
  assert.doesNotMatch(englishChat.replies.profile, /resume|download|private documents/iu);
  assert.doesNotMatch(vietnameseChat.replies.profile, /resume|tải xuống|tài liệu riêng tư/iu);
  assert.doesNotMatch(content.en.chat.introduction, /I[’']m Ask Nhân/u);
  assert.doesNotMatch(content.vi.chat.introduction, /tôi là Ask Nhân/iu);
  assert.equal("analytics" in englishChat, false);
  assert.equal("analytics" in vietnameseChat, false);
  assert.doesNotMatch(englishChat.disclosure, /browser is checked|security check/iu);
  assert.match(englishChat.disclosure, /does not save questions, replies, or chat history/u);
  assert.match(englishChat.disclosure, /conversation disappears when you reload/u);
  assert.match(englishChat.disclosure, /visit and page-performance analytics never receive chat text/iu);
  assert.match(englishChat.disclosure, /AI can be wrong/u);
  assert.match(englishChat.disclosure, /do not share sensitive information/u);
  assert.doesNotMatch(vietnameseChat.disclosure, /Trình duyệt được kiểm tra|kiểm tra bảo mật/iu);
  assert.match(vietnameseChat.disclosure, /không lưu câu hỏi, câu trả lời hay lịch sử trò chuyện/u);
  assert.match(vietnameseChat.disclosure, /nội dung sẽ mất khi tải lại/u);
  assert.match(vietnameseChat.disclosure, /không nhận nội dung trò chuyện/u);
  assert.match(vietnameseChat.disclosure, /AI có thể trả lời sai/u);
  assert.match(vietnameseChat.disclosure, /đừng gửi thông tin nhạy cảm/u);
  assert.doesNotMatch(
    JSON.stringify({ en: englishChat, vi: vietnameseChat }),
    /redacted|30 days|30 ngày|che dữ liệu|\bCloudflare\b|\bTurnstile\b|Workers\s+AI|@cf\//iu,
  );
  assert.match(askSource, /fetch\("\/api\/ask"/u);
  assert.match(askSource, /const inFlightRef = useRef\(false\)/u);
  assert.match(
    askSource,
    /if \(!clean \|\| typing \|\| inFlightRef\.current\) return;/u,
  );
  const submitGuardIndex = askSource.indexOf("inFlightRef.current = true;");
  const submitStateUpdateIndex = askSource.indexOf("setMessages((items) => {", submitGuardIndex);
  const submitFetchIndex = askSource.indexOf('fetch("/api/ask"', submitGuardIndex);
  assert.ok(submitGuardIndex >= 0, "the synchronous request guard must be claimed");
  assert.ok(
    submitStateUpdateIndex > submitGuardIndex,
    "the request guard must be claimed before submit state updates",
  );
  assert.ok(
    submitFetchIndex > submitStateUpdateIndex,
    "the request guard must be claimed before fetch",
  );
  assert.ok(
    (askSource.match(/inFlightRef\.current = false;/gu) ?? []).length >= 4,
    "locale changes, unmount, new conversation, and request completion must release the guard",
  );
  assert.match(
    askSource,
    /if \(requestRef\.current === controller\) \{\s*requestRef\.current = null;\s*inFlightRef\.current = false;\s*setTyping\(false\);/u,
  );
  assert.match(
    askSource,
    /body: JSON\.stringify\(\{\s*message: clean,\s*locale,\s*\}\)/u,
  );
  assert.doesNotMatch(askSource, /sessionStorage|localStorage|analyticsConsent|storedCopies/u);
  assert.doesNotMatch(askSource, /\/api\/ask\/data|method: "DELETE"|type="checkbox"/u);
  assert.match(askSource, /role="log"/u);
  assert.match(askSource, /aria-relevant="additions text"/u);
  assert.match(askSource, /aria-describedby="ask-nhan-disclosure"/u);
  assert.match(askSource, /resetConversation/u);
  assert.match(askSource, /navigator\.clipboard\?\.writeText/u);
  assert.match(askSource, /replaceMessageId: message\.id/u);
  assert.match(askSource, /chooseReply\(clean, answerCopy\)/u);
  assert.match(
    askSource,
    /<p lang=\{message\.language \?\? locale\}>\{message\.text\}<\/p>/u,
  );
  assert.doesNotMatch(
    askSource,
    /className=\{`message is-\$\{message\.role\}`\}[\s\S]{0,100}lang=/u,
  );
  assert.equal(
    app.includes("if (/(\\bai\\b|model|chatbot|live|thật|trực tiếp)/u.test(normalized))"),
    true,
  );
  assert.equal(
    app.includes("if (/(ai|model|chatbot|live|thật|trực tiếp)/u.test(normalized))"),
    false,
  );
  assert.match(askSource, /validatedRelatedLinks\(payload\.related, copy, clean\)/u);
  assert.match(askSource, /localRelatedLinks\(clean, copy\)/u);
  assert.doesNotMatch(app, /turnstile|browser verification/iu);
  assert.doesNotMatch(askSource, /turnstile|verification/iu);
  assert.doesNotMatch(index, /turnstile/iu);
  assert.match(askSource, /const headerStatus = typing \? "thinking" : serviceMode;/u);
  assert.match(askSource, /copy\.chat\.status\[headerStatus\]/u);
  assert.match(askSource, /disabled=\{!draft\.trim\(\) \|\| typing\}/u);
  assert.doesNotMatch(headers, /challenges\.cloudflare\.com|frame-src/iu);
  assert.doesNotMatch(styles, /\.turnstile/iu);
  assert.doesNotMatch(styles, /message-analytics|chat-privacy|stored-copy-controls/u);
  assert.match(styles, /\.chat-form:focus-within\s*\{[^}]*outline:\s*3px solid var\(--focus-on-light\)/su);
  assert.match(
    styles,
    /@media \(max-width: 37\.5rem\) and \(max-height: 43rem\)[\s\S]*?\.chat-transcript\s*\{[^}]*min-height:\s*7rem[^}]*max-height:\s*12rem/su,
  );
  assert.match(
    styles,
    /@media \(max-width: 37\.5rem\) and \(max-height: 43rem\)[\s\S]*?\.chat-suggestions\s*\{[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/su,
  );
});
