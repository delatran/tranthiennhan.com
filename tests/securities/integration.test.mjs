import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker from "../../worker/cloudflare.js";
import { rewriteProductShellRequestUrl } from "../../vite.config.mjs";
import {
  localizeSecuritiesShell,
  builtBundleReferences,
} from "../../scripts/build-localized-shells.mjs";
import {
  securitiesHref,
  securitiesArchitectureHref,
  SECURITIES_CANONICAL_URL,
  SECURITIES_ARCHITECTURE_URL,
} from "../../shared/securities/routes.js";
import { securitiesArchitectureMetadata } from "../../shared/securities/metadata.js";
import { parseSecuritiesKey, assertPhaseAGates } from "../../scripts/securities/read-local-key.mjs";
import { content } from "../../src/content.js";

function htmlAttributes(html, tagName, selector = {}) {
  const matches = [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "giu"))]
    .map(([tag]) =>
      Object.fromEntries(
        [...tag.matchAll(/([a-z_:][-a-z0-9_:.]*)\s*=\s*(["'])([\s\S]*?)\2/giu)].map(
          ([, name, , value]) => [name.toLowerCase(), value],
        ),
      ),
    )
    .filter((attributes) =>
      Object.entries(selector).every(([name, value]) => attributes[name] === value),
    );
  assert.equal(matches.length, 1, `Expected one ${tagName} ${JSON.stringify(selector)} tag`);
  return matches[0];
}

test("Securities route dispatch uses one canonical product path and a localized nonce-bearing shell", async () => {
  for (const [lang, asset] of [
    ["vi", "/securities-vi"],
    ["en", "/securities"],
    ["invalid", "/securities"],
  ]) {
    let fetched;
    const response = await worker.fetch(
      new Request(`http://127.0.0.1:8788/securities?lang=${lang}`),
      {
        ASSETS: {
          async fetch(request) {
            fetched = new URL(request.url).pathname;
            return new Response("<html></html>", {
              headers: {
                "Content-Type": "text/html",
                "Content-Security-Policy": "default-src 'self'; script-src 'self'",
              },
            });
          },
        },
      },
    );
    assert.equal(response.status, 200);
    assert.equal(fetched, asset);
    assert.match(response.headers.get("Content-Security-Policy"), /nonce-/u);
  }
});

test("Securities aliases preserve valid locale and dossier revision while dropping unrelated parameters", async () => {
  for (const route of ["/securities/", "/securities.html"]) {
    const response = await worker.fetch(
      new Request(
        `http://127.0.0.1:8788${route}?lang=vi&dossier=ds_example1234&revision=2&private=no`,
      ),
      {},
    );
    assert.equal(response.status, 308);
    assert.equal(
      response.headers.get("Location"),
      "/securities?lang=vi&dossier=ds_example1234&revision=2",
    );
  }
  const invalid = await worker.fetch(
    new Request("http://127.0.0.1:8788/securities/?lang=vi&lang=en&dossier=../../key.txt"),
    {},
  );
  assert.equal(invalid.headers.get("Location"), "/securities");
  for (const route of ["/securities/", "/securities.html", "/securities-vi.html", "/securities"]) {
    assert.equal(
      (await worker.fetch(new Request(`http://127.0.0.1:8788${route}`, { method: "POST" }), {}))
        .status,
      405,
    );
  }
});

test("Vite direct and trailing-slash product loads resolve the Securities input", () => {
  assert.equal(rewriteProductShellRequestUrl("/securities?lang=vi"), "/securities.html?lang=vi");
  assert.equal(
    rewriteProductShellRequestUrl("/securities/?lang=en&dossier=ds_example1234"),
    "/securities.html?lang=en&dossier=ds_example1234",
  );
  assert.equal(securitiesHref("vi"), "/securities?lang=vi");
  assert.equal(securitiesHref("bad"), "/securities");
});

test("Securities shells preserve build references, product identity and canonical metadata in both locales", async () => {
  const base = await readFile(new URL("../../securities.html", import.meta.url), "utf8");
  for (const locale of ["vi", "en"]) {
    const localized = localizeSecuritiesShell(base, locale);
    assert.match(localized, new RegExp(`<html lang="${locale}">`));
    assert.ok(localized.includes(`href="${SECURITIES_CANONICAL_URL}"`));
    assert.ok(localized.includes("Nhân for Securities"));
    assert.deepEqual(builtBundleReferences(localized), builtBundleReferences(base));
    const built = await readFile(
      new URL(
        `../../dist/client/${locale === "vi" ? "securities-vi" : "securities"}.html`,
        import.meta.url,
      ),
      "utf8",
    );
    assert.ok(builtBundleReferences(built).length > 0);
    assert.match(built, new RegExp(`<html lang="${locale}">`));
    assert.equal(content[locale].securitiesProduct.name, "Nhân for Securities");
    assert.doesNotMatch(content[locale].securitiesProduct.body, /ACBS|ACB Securities/u);
  }
});

test("Securities architecture GET and HEAD select the localized shell, strip asset queries and generate fresh CSP nonces", async () => {
  const nonces = new Set();
  const queries = [
    ["", "/securities-architecture"],
    ["lang=en", "/securities-architecture"],
    ["lang=vi", "/securities-architecture-vi"],
    ["lang=invalid", "/securities-architecture"],
    ["lang=vi&lang=en", "/securities-architecture"],
    ["lang=vi&lang=vi", "/securities-architecture"],
  ];
  for (const method of ["GET", "HEAD"]) {
    for (const [query, asset] of queries) {
      const fetched = [];
      const body = "<html><body>Architecture shell</body></html>";
      const response = await worker.fetch(
        new Request(
          `http://127.0.0.1:8788/securities/architecture?${query}&dossier=ds_example1234&revision=2&private=discard#section`,
          { method },
        ),
        {
          ASSETS: {
            async fetch(request) {
              fetched.push({ url: request.url, method: request.method });
              return new Response(request.method === "HEAD" ? null : body, {
                headers: {
                  "Content-Type": "text/html; charset=utf-8",
                  "Content-Security-Policy":
                    "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'",
                  "Cache-Control": "public, max-age=3600",
                },
              });
            },
          },
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(fetched, [{ url: `http://127.0.0.1:8788${asset}`, method }]);
      assert.equal(await response.text(), method === "HEAD" ? "" : body);
      assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
      const policy = response.headers.get("Content-Security-Policy");
      const nonce = policy.match(/'nonce-([A-Za-z0-9_-]{22})'/u)?.[1];
      assert.ok(nonce, "each successful HTML response must contain a nonce");
      assert.equal(nonces.has(nonce), false, "nonces must differ between requests");
      nonces.add(nonce);
      assert.equal(
        policy,
        `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; frame-ancestors 'none'`,
      );
    }
  }
});

test("Securities architecture aliases canonicalize GET and HEAD without retaining dossier state or private query parameters", async () => {
  const aliases = [
    ["/securities/architecture/", false],
    ["/securities-architecture.html", false],
    ["/securities-architecture-vi", true],
    ["/securities-architecture-vi.html", true],
  ];
  const queries = [
    ["", ""],
    ["lang=vi", "?lang=vi"],
    ["lang=en", "?lang=en"],
    ["lang=invalid", ""],
    ["lang=vi&lang=en", ""],
    ["lang=vi&lang=vi", ""],
  ];
  for (const method of ["GET", "HEAD"]) {
    for (const [alias, forceVietnamese] of aliases) {
      for (const [query, localeQuery] of queries) {
        const response = await worker.fetch(
          new Request(
            `http://127.0.0.1:8788${alias}?${query}&dossier=ds_example1234&revision=2&private=discard`,
            { method },
          ),
          {
            ASSETS: {
              fetch() {
                assert.fail("aliases must redirect before reading an asset");
              },
            },
          },
        );
        assert.equal(response.status, 308);
        assert.equal(
          response.headers.get("Location"),
          `/securities/architecture${forceVietnamese ? "?lang=vi" : localeQuery}`,
        );
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
        assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
        assert.equal(await response.text(), "");
      }
    }
  }
});

test("Securities architecture rejects unsupported methods on canonical and alias routes before dispatch", async () => {
  for (const route of [
    "/securities/architecture",
    "/securities/architecture/",
    "/securities-architecture.html",
    "/securities-architecture-vi",
    "/securities-architecture-vi.html",
  ]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await worker.fetch(
        new Request(`http://127.0.0.1:8788${route}?lang=vi`, { method }),
        {
          ASSETS: {
            fetch() {
              assert.fail("unsupported methods must not read an asset");
            },
          },
        },
      );
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("Allow"), "GET, HEAD");
      assert.equal(response.headers.get("Location"), null);
      assert.equal((await response.json()).error, "method_not_allowed");
    }
  }
});

test("Securities architecture preserves asset failures and keeps local shells uncached", async () => {
  const request = new Request("http://127.0.0.1:8788/securities/architecture?lang=vi");
  assert.equal((await worker.fetch(request, {})).status, 404);
  for (const status of [200, 404, 503]) {
    const response = await worker.fetch(request, {
      SECURITIES_LOCAL_MODE: "true",
      ASSETS: {
        async fetch() {
          return new Response("Architecture asset", {
            status,
            headers: {
              "Content-Type": "text/html",
              "Content-Security-Policy": "default-src 'self'; script-src 'self'",
              "Cache-Control": "public, max-age=31556952, immutable",
            },
          });
        },
      },
    });
    assert.equal(response.status, status);
    assert.equal(await response.text(), "Architecture asset");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(
      response.headers.get("Content-Security-Policy").includes("nonce-"),
      status === 200,
    );
  }
});

test("Securities architecture links and Vite direct loads resolve the dedicated page", () => {
  assert.equal(securitiesArchitectureHref("vi"), "/securities/architecture?lang=vi");
  assert.equal(securitiesArchitectureHref("en"), "/securities/architecture?lang=en");
  assert.equal(securitiesArchitectureHref("invalid"), "/securities/architecture");
  assert.equal(securitiesArchitectureHref(), "/securities/architecture");
  assert.equal(
    rewriteProductShellRequestUrl("/securities/architecture"),
    "/securities-architecture.html",
  );
  assert.equal(
    rewriteProductShellRequestUrl("/securities/architecture/?lang=vi"),
    "/securities-architecture.html?lang=vi",
  );
  assert.equal(
    rewriteProductShellRequestUrl("/securities/architecture?lang=en&dossier=ds_example1234"),
    "/securities-architecture.html?lang=en&dossier=ds_example1234",
  );
  assert.equal(
    rewriteProductShellRequestUrl("/securities/architecture/unknown?lang=vi"),
    "/securities/architecture/unknown?lang=vi",
  );
});

test("Securities architecture source and built shells retain distinct localized metadata and the same built assets", async () => {
  const base = await readFile(
    new URL("../../securities-architecture.html", import.meta.url),
    "utf8",
  );
  const builtEnglish = await readFile(
    new URL("../../dist/client/securities-architecture.html", import.meta.url),
    "utf8",
  );
  const expectedBundles = builtBundleReferences(builtEnglish);
  assert.ok(expectedBundles.length > 0);
  assert.ok(
    expectedBundles.some((reference) =>
      /^\/assets\/securitiesArchitecture-[^/]+\.js$/u.test(reference),
    ),
  );
  assert.equal(
    htmlAttributes(base, "script", { type: "module" }).src,
    "/src/securities/architecture-main.jsx",
  );
  for (const locale of ["en", "vi"]) {
    const localized = localizeSecuritiesShell(base, locale, securitiesArchitectureMetadata);
    const built =
      locale === "en"
        ? builtEnglish
        : await readFile(
            new URL("../../dist/client/securities-architecture-vi.html", import.meta.url),
            "utf8",
          );
    const metadata = securitiesArchitectureMetadata[locale];
    assert.deepEqual(builtBundleReferences(localized), builtBundleReferences(base));
    assert.deepEqual(builtBundleReferences(built), expectedBundles);
    for (const shell of [localized, built]) {
      assert.equal(htmlAttributes(shell, "html").lang, locale);
      assert.ok(shell.includes(`<title>${metadata.title}</title>`));
      assert.equal(
        htmlAttributes(shell, "link", { rel: "canonical" }).href,
        SECURITIES_ARCHITECTURE_URL,
      );
      for (const [attribute, key, value] of [
        ["name", "description", metadata.description],
        ["property", "og:title", metadata.title],
        ["property", "og:description", metadata.description],
        ["property", "og:url", SECURITIES_ARCHITECTURE_URL],
        ["property", "og:locale", metadata.ogLocale],
        ["property", "og:locale:alternate", metadata.ogAlternate],
        ["name", "twitter:title", metadata.title],
        ["name", "twitter:description", metadata.description],
      ])
        assert.equal(
          htmlAttributes(shell, "meta", { [attribute]: key }).content,
          value,
          `${locale} ${key}`,
        );
    }
  }
  assert.throws(
    () => localizeSecuritiesShell(base, "invalid", securitiesArchitectureMetadata),
    /Unsupported Securities locale/u,
  );
});

test("Securities API is unavailable without the explicit local guard even when its route is built", async () => {
  for (const url of [
    "https://tranthiennhan.com/api/securities/catalog",
    "http://127.0.0.1:8788/api/securities/catalog",
  ]) {
    const response = await worker.fetch(new Request(url), {});
    assert.equal(response.status, 403);
  }
});

test("dedicated local runtime excludes production AI, analytics, routes and scheduled work", async () => {
  const config = JSON.parse(
    await readFile(new URL("../../wrangler.securities.local.jsonc", import.meta.url), "utf8"),
  );
  for (const name of [
    "ai",
    "routes",
    "triggers",
    "ratelimits",
    "analytics_engine_datasets",
    "secrets",
  ])
    assert.equal(config[name], undefined);
  assert.equal(config.dev.ip, "127.0.0.1");
  assert.equal(config.vars.SECURITIES_MODEL_MODE, "off");
  assert.equal(config.vars.SECURITIES_LOCAL_MODE, "true");
  assert.deepEqual(
    config.d1_databases.map((db) => db.binding),
    ["SECURITIES_DB"],
  );
  assert.equal(config.d1_databases[0].remote, undefined);
});

test("key parser accepts inert formats only and live reads require completed local gates", async () => {
  const fake = "sk-or-v1-fixture_key_12345678901234567890";
  assert.equal(parseSecuritiesKey(fake), fake);
  assert.equal(parseSecuritiesKey(`\uFEFFOPENROUTER_API_KEY=${fake}\n`), fake);
  for (const invalid of [
    "",
    "$(echo secret)",
    `${fake}\nOTHER=not-allowed`,
    `OPENROUTER_API_KEY=${fake};Get-Content x`,
  ])
    assert.throws(() => parseSecuritiesKey(invalid));
  await assert.rejects(() => assertPhaseAGates(undefined), /phase A receipt/u);
});

test("local asset rebuild misses cannot poison the browser cache", async () => {
  const assets = {
    fetch: async () =>
      new Response("Not found", {
        status: 404,
        headers: { "Cache-Control": "public, max-age=31556952, immutable" },
      }),
  };
  const request = new Request("http://127.0.0.1:8788/assets/flag_of_Vietnam.svg");
  const local = await worker.fetch(request, { ASSETS: assets, SECURITIES_LOCAL_MODE: "true" });
  assert.equal(local.status, 404);
  assert.equal(local.headers.get("Cache-Control"), "no-store");
  const regular = await worker.fetch(request, { ASSETS: assets });
  assert.equal(regular.headers.get("Cache-Control"), "public, max-age=31556952, immutable");
});
