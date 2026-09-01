import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { xnhanAboutContent } from "../src/xnhan-about-content.js";
import {
  createXNhanAboutRouteWebMcpActions,
  createXNhanAboutOverview,
  xNhanAboutOverviewMatchesDocument,
} from "../src/use-xnhan-about-webmcp.js";

const root = new URL("../", import.meta.url);

function source(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

function flattenShape(value, prefix = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenShape(item, `${prefix}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      flattenShape(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

function flattenStringValues(value) {
  if (Array.isArray(value)) return value.flatMap(flattenStringValues);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(flattenStringValues);
  }
  return typeof value === "string" ? [value] : [];
}

function textElement(text, attributes = {}) {
  return {
    textContent: text,
    getAttribute(name) {
      return attributes[name] ?? null;
    },
  };
}

function createOverviewDocument(overview) {
  const [origin, principles, how, boundary] = overview.sections;
  const single = new Map([
    [".xnhan-about-eyebrow", textElement(overview.hero.eyebrow)],
    [".xnhan-about-lede", textElement(overview.hero.lede)],
    [".xnhan-about-hero-aside blockquote", textElement(overview.hero.thesis)],
    ["#xnhan-about-origin h2", textElement(origin.title)],
    ["#xnhan-about-principles h2", textElement(principles.title)],
    ["#xnhan-about-how h2", textElement(how.title)],
    ["#xnhan-about-boundary h2", textElement(boundary.title)],
    [
      ".xnhan-about-product-link",
      textElement("Product", { href: overview.routes.product }),
    ],
    [
      ".xnhan-about-owner",
      textElement("Portfolio", { href: overview.routes.portfolio }),
    ],
  ]);
  const multiple = new Map([
    [
      "#xnhan-about-title [data-title-line]",
      overview.hero.titleLines.map((text) => textElement(text)),
    ],
    [
      "#xnhan-about-origin .xnhan-about-prose > p:first-child",
      origin.highlights.map((text) => textElement(text)),
    ],
    [
      "#xnhan-about-principles h3",
      principles.highlights.map((text) => textElement(text)),
    ],
    [
      "#xnhan-about-how h3",
      how.highlights.map((text) => textElement(text)),
    ],
    [
      "#xnhan-about-boundary > .xnhan-about-section-intro, #xnhan-about-boundary > .xnhan-about-boundary-note",
      boundary.highlights.map((text) => textElement(text)),
    ],
  ]);
  return {
    documentElement: { lang: overview.locale },
    title: overview.title,
    querySelector(selector) {
      return single.get(selector) ?? null;
    },
    querySelectorAll(selector) {
      return multiple.get(selector) ?? [];
    },
    single,
    multiple,
  };
}

test("keeps the X Nhân product story bilingual and structurally aligned", () => {
  assert.deepEqual(flattenShape(xnhanAboutContent.vi), flattenShape(xnhanAboutContent.en));

  for (const locale of ["vi", "en"]) {
    const copy = xnhanAboutContent[locale];
    assert.equal(copy.hero.titleLines.length, 2);
    assert.equal(copy.principles.items.length, 3);
    assert.equal(copy.how.stages.length, 3);
    assert.equal(copy.boundary.rows.length, 4);
    assert.equal(copy.notes.paragraphs.length, 2);
  }

  assert.match(xnhanAboutContent.vi.hero.lede, /thích X.+tin tức.+công nghệ/iu);
  assert.match(xnhanAboutContent.en.hero.lede, /like X.+technology news/iu);
  assert.match(xnhanAboutContent.vi.hero.thesis, /nội dung gốc tồn tại/iu);
  assert.match(xnhanAboutContent.en.hero.thesis, /original content lives/iu);
  assert.match(xnhanAboutContent.vi.boundary.title, /không thay thế X API/iu);
  assert.match(xnhanAboutContent.en.boundary.title, /does not replace the X API/iu);
  assert.match(xnhanAboutContent.vi.footer.independence, /không được X Corp\./iu);
  assert.match(xnhanAboutContent.en.footer.independence, /not sponsored.+X Corp\./iu);
  assert.match(xnhanAboutContent.vi.how.intro, /OpenAI/iu);
  assert.match(xnhanAboutContent.vi.how.intro, /OpenRouter/iu);
  assert.match(xnhanAboutContent.en.how.intro, /OpenAI/iu);
  assert.match(xnhanAboutContent.en.how.intro, /OpenRouter/iu);
  assert.match(xnhanAboutContent.vi.how.intro, /ngữ cảnh gần đây.+bằng chứng X mới/iu);
  assert.match(xnhanAboutContent.en.how.intro, /bounded slice of recent context.+fresh X evidence/iu);
  assert.match(xnhanAboutContent.vi.notes.paragraphs[0], /không lưu nội dung câu hỏi.+lịch sử trò chuyện/iu);
  assert.match(xnhanAboutContent.en.notes.paragraphs[0], /does not persist question text.+chat history/iu);
  assert.match(xnhanAboutContent.vi.notes.paragraphs[0], /tạo cuộc trò chuyện mới.+xóa/iu);
  assert.match(xnhanAboutContent.en.notes.paragraphs[0], /starting a new chat.+clears/iu);
  const publicCopy = flattenStringValues(xnhanAboutContent).join("\n");
  assert.doesNotMatch(
    publicCopy,
    /không tự chuyển|does not switch automatically|lịch sử bạn nhìn thấy|history you see|provider-side retention|lưu giữ phía nhà cung cấp/iu,
  );
});

test("describes grounded synthesis from selected retrieval without presenting provider text as a verified quotation", () => {
  const vietnamese = xnhanAboutContent.vi;
  const english = xnhanAboutContent.en;

  assert.match(vietnamese.principles.items[1].text, /nội dung truy xuất đã chọn/iu);
  assert.match(vietnamese.principles.items[1].text, /đoạn trích hoặc tóm lược/iu);
  assert.match(vietnamese.principles.items[1].text, /xem nội dung hiện tại/iu);
  assert.match(vietnamese.how.stages[2].title, /nội dung truy xuất đã chọn/iu);
  assert.match(vietnamese.boundary.rows[1].xnhan, /liên kết đến mục X/iu);

  assert.match(english.principles.items[1].text, /selected retrieval/iu);
  assert.match(english.principles.items[1].text, /excerpt or synopsis/iu);
  assert.match(english.principles.items[1].text, /inspect its current content/iu);
  assert.match(english.how.stages[2].title, /selected retrieval/iu);
  assert.match(english.boundary.rows[1].xnhan, /links to the corresponding X items/iu);

  const publicCopy = flattenStringValues(xnhanAboutContent).join("\n");
  assert.match(publicCopy, /\bsynthesi[sz](?:e|ed|es|ing|ation)?\b/iu);
  assert.doesNotMatch(
    publicCopy,
    /\b(?:verified|verbatim|strongest)\b|\u0111ã xác minh|nguyên văn|mạnh nhất/iu,
  );
});

test("renders one editorial About page without mounting either assistant", async () => {
  const [app, styles, webMcpAdapter] = await Promise.all([
    source("src/XNhanAboutApp.jsx"),
    source("src/xnhan-about.css"),
    source("src/use-xnhan-about-webmcp.js"),
  ]);

  assert.equal((app.match(/<h1\b/gu) ?? []).length, 1);
  assert.match(app, /id="xnhan-about-main"/u);
  assert.match(app, /<table>/u);
  assert.match(app, /<caption className="sr-only">/u);
  assert.match(app, /<th scope="row">/u);
  assert.match(
    app,
    /className="xnhan-about-table-wrap"[\s\S]*?role="region"[\s\S]*?aria-label=\{copy\.boundary\.tableLabel\}[\s\S]*?tabIndex="0"/u,
  );
  assert.match(app, /<details className="xnhan-about-notes"/u);
  assert.doesNotMatch(app, /<details[^>]*\sopen(?:=|\s|>)/u);
  assert.match(app, /href=\{xNhanHref\("\/xnhan", locale\)\}/u);
  assert.match(app, /href=\{`\/\$\{locale\}`\}/u);
  assert.doesNotMatch(app, /target="_blank"/u);
  assert.doesNotMatch(app, /style=\{\{\s*"--title-line"/u);
  assert.match(app, /data-title-line=\{index\}/u);
  assert.doesNotMatch(app, /AskNhan|usePortfolioWebMcp|useXNhanWebMcp|fetch\(/u);
  assert.match(app, /useXNhanAboutWebMcp\(\{ bridgeRef: webMcpBridgeRef \}\)/u);
  for (const id of ["origin", "principles", "how", "boundary"]) {
    assert.match(app, new RegExp(`id="xnhan-about-${id}"`, "u"));
  }
  assert.match(webMcpAdapter, /async readXNhanAboutOverview\(\{ signal \} = \{\}\)/u);
  assert.match(
    webMcpAdapter,
    /readXNhanAboutOverview[\s\S]*?await waitForState\([\s\S]*?xNhanAboutOverviewMatchesDocument/u,
  );
  assert.doesNotMatch(
    webMcpAdapter,
    /fetch\(|localStorage|sessionStorage|transcript|history|provider|analytics/iu,
  );
  assert.match(
    app,
    /setLinkHref\('link\[rel="canonical"\]', XNHAN_ABOUT_CANONICAL_URL\)/u,
  );
  assert.match(
    app,
    /setMetaContent\('meta\[property="og:url"\]', XNHAN_ABOUT_CANONICAL_URL\)/u,
  );

  assert.match(
    styles,
    /\.xnhan-about-hero\s*\{[^}]*min-height:\s*clamp\(38rem,\s*calc\(82dvh - 4\.75rem\),\s*48rem\)[^}]*align-items:\s*center/su,
  );
  assert.match(styles, /\.xnhan-about-hero-copy\s*\{[^}]*min-width:\s*0/su);
  assert.match(styles, /@keyframes xnhan-about-title-enter/u);
  assert.match(
    styles,
    /\.xnhan-about-title-line > span\[data-title-line="1"\]\s*\{[^}]*animation-delay:\s*90ms/su,
  );
  const titleEnterKeyframes = styles.match(
    /@keyframes xnhan-about-title-enter\s*\{[\s\S]*?\n\}/u,
  )?.[0];
  assert.ok(titleEnterKeyframes);
  assert.doesNotMatch(titleEnterKeyframes, /opacity\s*:/u);
  assert.match(
    styles,
    /html\[lang="en"\] \.xnhan-about-title-line > span\s*\{[^}]*white-space:\s*nowrap/su,
  );
  assert.match(styles, /@media \(max-width:\s*52\.5rem\)/u);
  assert.match(
    styles,
    /html\[lang="en"\] \.xnhan-about-hero h1\s*\{[^}]*font-size:[^}]*line-height:\s*1\.08/su,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.xnhan-about-title-line > span[\s\S]*?animation:\s*none/u,
  );
});

test("publishes About locale bridges only after React commits", async () => {
  const [app, adapter] = await Promise.all([
    source("src/XNhanAboutApp.jsx"),
    source("src/use-xnhan-about-webmcp.js"),
  ]);
  const bridgeEffect = app.match(
    /useLayoutEffect\(\(\) => \{\s*webMcpBridgeRef\.current = Object\.freeze\(\{\s*mounted: true,\s*locale,\s*copy,\s*changeLocale,\s*\}\);\s*return \(\) => \{\s*webMcpBridgeRef\.current = UNMOUNTED_XNHAN_ABOUT_WEBMCP_BRIDGE;\s*\};\s*\}, \[changeLocale, copy, locale\]\);/u,
  )?.[0];

  assert.ok(bridgeEffect, "the complete About bridge publication must be a layout effect");
  assert.doesNotMatch(
    app.replace(bridgeEffect, ""),
    /webMcpBridgeRef\.current\s*=/u,
    "no About bridge may be published outside the committed layout effect",
  );
  assert.match(
    app,
    /const changeLocale = useCallback\(\s*\(nextLocale\) => \{\s*if \(!XNHAN_LOCALES\.includes\(nextLocale\) \|\| nextLocale === locale\) return;\s*writeStoredXNhanLocale\(nextLocale\);\s*replaceXNhanLocaleInUrl\(nextLocale\);\s*setLocale\(nextLocale\);\s*\},\s*\[locale\],\s*\);/u,
  );
  assert.ok(
    app.indexOf(bridgeEffect) < app.indexOf("useXNhanAboutWebMcp({"),
    "the committed bridge must be declared before the WebMCP layout registration",
  );
  assert.match(adapter, /import \{ useLayoutEffect \} from "react"/u);
  assert.doesNotMatch(adapter, /\buseEffect\b/u);
  assert.match(
    adapter,
    /useLayoutEffect\(\(\) => \{[\s\S]*?return registration\.cleanup;[\s\S]*?\}, \[bridgeRef\]\);/u,
  );
});

test("About WebMCP bridge blocks cleanup races before URL or locale mutation", async () => {
  const unmounted = Object.freeze({ mounted: false });
  const bridgeRef = { current: unmounted };
  const effects = {
    domReads: 0,
    historyWrites: 0,
    localeStateWrites: 0,
    localeStorageWrites: 0,
    waits: 0,
  };
  const documentObject = new Proxy(
    {},
    {
      get() {
        effects.domReads += 1;
        throw new Error("late About DOM read");
      },
    },
  );
  const windowObject = {
    location: { pathname: "/xnhan/about" },
  };
  const waitForState = (_predicate, { signal }) => {
    effects.waits += 1;
    return new Promise((_resolve, reject) => {
      const rejectAbort = () => reject(signal.reason);
      if (signal.aborted) rejectAbort();
      else signal.addEventListener("abort", rejectAbort, { once: true });
    });
  };
  const actions = createXNhanAboutRouteWebMcpActions({
    bridgeRef,
    documentObject,
    waitForState,
    windowObject,
  });

  const lifecycle = new AbortController();
  bridgeRef.current = Object.freeze({
    mounted: true,
    locale: "en",
    copy: xnhanAboutContent.en,
    changeLocale() {
      effects.localeStorageWrites += 1;
      effects.historyWrites += 1;
      effects.localeStateWrites += 1;
    },
  });
  const localeChange = actions.setXNhanAboutLocale("vi", {
    signal: lifecycle.signal,
  });
  assert.deepEqual(
    [
      effects.localeStorageWrites,
      effects.historyWrites,
      effects.localeStateWrites,
      effects.waits,
    ],
    [1, 1, 1, 1],
  );

  bridgeRef.current = unmounted;
  lifecycle.abort();
  await assert.rejects(localeChange, { name: "AbortError" });
  assert.deepEqual(
    [
      effects.localeStorageWrites,
      effects.historyWrites,
      effects.localeStateWrites,
      effects.waits,
      effects.domReads,
    ],
    [1, 1, 1, 1, 0],
    "cleanup must cancel the wait without any late URL, state, storage, or DOM work",
  );

  const beforeLateInvoke = { ...effects };
  await assert.rejects(
    actions.readXNhanAboutOverview({ signal: new AbortController().signal }),
    /webmcp_bridge_unmounted/u,
  );
  await assert.rejects(
    actions.setXNhanAboutLocale("vi", {
      signal: new AbortController().signal,
    }),
    /webmcp_bridge_unmounted/u,
  );
  assert.deepEqual(effects, beforeLateInvoke, "post-cleanup tools must cause no effects");
});

test("builds the read-only About snapshot from public copy and validates its DOM commit", () => {
  const overview = createXNhanAboutOverview({
    locale: "vi",
    copy: xnhanAboutContent.vi,
    path: "/xnhan/about",
  });
  const documentObject = createOverviewDocument(overview);
  const locationObject = { pathname: "/xnhan/about" };

  assert.equal(
    xNhanAboutOverviewMatchesDocument(overview, {
      documentObject,
      locationObject,
    }),
    true,
  );
  assert.equal(overview.sections.length, 4);
  assert.deepEqual(
    overview.sections.map(({ id }) => id),
    ["origin", "principles", "how", "boundary"],
  );
  assert.deepEqual(overview.routes, {
    product: "/xnhan?lang=vi",
    portfolio: "/vi",
  });

  documentObject.documentElement.lang = "en";
  assert.equal(
    xNhanAboutOverviewMatchesDocument(overview, {
      documentObject,
      locationObject,
    }),
    false,
  );
  documentObject.documentElement.lang = "vi";
  documentObject.multiple.set("#xnhan-about-principles h3", [
    textElement("stale visible copy"),
    ...overview.sections[1].highlights.slice(1).map((text) => textElement(text)),
  ]);
  assert.equal(
    xNhanAboutOverviewMatchesDocument(overview, {
      documentObject,
      locationObject,
    }),
    false,
  );
});

test("builds a product-specific canonical shell for /xnhan/about", async () => {
  const [sourceShell, builtShell] = await Promise.all([
    source("xnhan-about.html"),
    source("dist/client/xnhan-about.html"),
  ]);

  for (const shell of [sourceShell, builtShell]) {
    assert.match(shell, /<html lang="en">/u);
    assert.match(
      shell,
      /<link rel="canonical" href="https:\/\/tranthiennhan\.com\/xnhan\/about" \/>/u,
    );
    assert.match(shell, /<meta property="og:type" content="website" \/>/u);
    assert.match(shell, /<meta property="og:site_name" content="X Nhân" \/>/u);
    assert.match(shell, /<meta property="og:locale" content="en_US" \/>/u);
    assert.match(shell, /<meta property="og:locale:alternate" content="vi_VN" \/>/u);
    assert.doesNotMatch(shell, /data-portfolio-schema|"@type"\s*:\s*"Person"/u);
  }

  assert.match(sourceShell, /src\/xnhan-about-main\.jsx/u);
  assert.match(builtShell, /\/assets\/xnhanAbout-[^/]+\.css/u);
  assert.doesNotMatch(builtShell, /\/assets\/portfolio-[^/]+\.css/u);
  assert.match(builtShell, /\/assets\/[A-Za-z0-9._-]+\.js/u);
  assert.match(builtShell, /\/assets\/[A-Za-z0-9._-]+\.css/u);
});

test("keeps the about footer editorial without external documentation links", () => {
  for (const locale of ["vi", "en"]) {
    assert.match(xnhanAboutContent[locale].footer.independence, /X Corp\./u);
    assert.equal(xnhanAboutContent[locale].footer.sources, undefined);
  }
});
