import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import worker from "../worker/cloudflare.js";
import { assessWranglerDryRun } from "../scripts/verify-wrangler-dry-run.mjs";
import { content, locales } from "../src/content.js";
import { personSchemaForLocale } from "../src/person-schema.js";
import { xnhanAboutContent } from "../src/xnhan-about-content.js";
import { xnhanContent } from "../src/xnhan-content.js";

const root = new URL("../", import.meta.url);
const wranglerSource = await readFile(new URL("wrangler.jsonc", root), "utf8");
const wrangler = JSON.parse(wranglerSource);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const securityTxtSource = await readFile(
  new URL("public/.well-known/security.txt", root),
  "utf8",
);
const llmsTxtSource = await readFile(new URL("public/llms.txt", root), "utf8");
const generatedBindingsSource = await readFile(
  new URL("worker-configuration.d.ts", root),
  "utf8",
);
const runtimeModelBindingsSource = await readFile(
  new URL("worker/runtime-model-bindings.d.ts", root),
  "utf8",
);
const visitorMigrationSource = await readFile(
  new URL("d1-migrations/0001_visitor_analytics.sql", root),
  "utf8",
);
const htmlSourceInputs = await Promise.all(
  ["index.html", "xnhan.html", "xnhan-about.html"].map(async (fileName) => ({
    fileName,
    source: await readFile(new URL(fileName, root), "utf8"),
  })),
);

const publicProductVersionPattern =
  /\b(?:phiên\s+bản|v|version)\s*#?\s*\d+(?:\.\d+)*\b/giu;
const absoluteTechnicalUrlPattern = /^https?:\/\/[^\s<>"']+$/iu;
const linkTargetPattern = /^(?:https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|\/api(?:\/[^\s<>"']*)?)$/iu;
const doiPattern = /^(?:(?:https:\/\/doi\.org\/|doi:)?10\.\d{4,9}\/[^\s<>"']+)$/iu;
const technicalIdentifierPattern =
  /^(?:urn:[a-z0-9][a-z0-9:._/-]*|[a-z][a-z0-9]*(?:[._/][a-z0-9]+)+)$/u;
const nonRenderedTechnicalReferenceRules = [
  {
    locationPattern: /^src\/content\.js:(?:en|vi)\.contact\.links\.\d+\.href$/u,
    valuePattern: linkTargetPattern,
  },
  {
    locationPattern:
      /^src\/person-schema\.js#(?:en|vi):(?:@context|@id|sameAs\.\d+|url)$/u,
    valuePattern: absoluteTechnicalUrlPattern,
  },
  {
    locationPattern: /^src\/person-schema\.js#(?:en|vi):doi$/u,
    valuePattern: doiPattern,
  },
  {
    locationPattern: /^src\/person-schema\.js#(?:en|vi):identifier$/u,
    valuePattern: technicalIdentifierPattern,
  },
  {
    locationPattern:
      /^(?:index|xnhan|xnhan-about)\.html:jsonLd\.\d+(?:\.[^.]+)*\.(?:@context|@id|sameAs\.\d+|url)$/u,
    valuePattern: absoluteTechnicalUrlPattern,
  },
  {
    locationPattern:
      /^(?:index|xnhan|xnhan-about)\.html:jsonLd\.\d+(?:\.[^.]+)*\.doi$/u,
    valuePattern: doiPattern,
  },
  {
    locationPattern:
      /^(?:index|xnhan|xnhan-about)\.html:jsonLd\.\d+(?:\.[^.]+)*\.identifier$/u,
    valuePattern: technicalIdentifierPattern,
  },
  {
    locationPattern: /^(?:index|xnhan|xnhan-about)\.html:meta\.og:url$/u,
    valuePattern: absoluteTechnicalUrlPattern,
  },
];
const publicHtmlAttributeNames = [
  "alt",
  "aria-description",
  "aria-label",
  "placeholder",
  "title",
];

function collectStringEntries(value, source, path = [], entries = []) {
  if (typeof value === "string") {
    entries.push({ source, path, value });
    return entries;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectStringEntries(item, source, [...path, String(index)], entries),
    );
    return entries;
  }
  if (!value || typeof value !== "object") return entries;

  for (const [key, item] of Object.entries(value)) {
    collectStringEntries(item, source, [...path, key], entries);
  }
  return entries;
}

function readHtmlAttribute(tag, attributeName) {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return tag.match(new RegExp(`\\b${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "iu"))?.[2] ?? null;
}

function collectHtmlPublicCopy({ fileName, source }) {
  const entries = [];
  const title = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1]?.trim();
  if (title) entries.push({ source: fileName, path: ["title"], value: title });

  for (const match of source.matchAll(/<meta\b[^>]*>/giu)) {
    const tag = match[0];
    const metaKey = readHtmlAttribute(tag, "name") ?? readHtmlAttribute(tag, "property");
    const value = readHtmlAttribute(tag, "content");
    if (metaKey && value) {
      entries.push({ source: fileName, path: ["meta", metaKey], value });
    }
  }

  let jsonLdIndex = 0;
  for (const match of source.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/giu)) {
    const block = match[0];
    const openingTag = block.match(/^<script\b[^>]*>/iu)?.[0] ?? "";
    const mediaType = readHtmlAttribute(openingTag, "type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (mediaType !== "application/ld+json") continue;

    const serialized = block
      .replace(/^<script\b[^>]*>/iu, "")
      .replace(/<\/script>$/iu, "");
    let structuredData;
    try {
      structuredData = JSON.parse(serialized);
    } catch (error) {
      throw new Error(`${fileName} contains invalid JSON-LD`, { cause: error });
    }
    collectStringEntries(
      structuredData,
      fileName,
      ["jsonLd", String(jsonLdIndex)],
      entries,
    );
    jsonLdIndex += 1;
  }

  let tagIndex = 0;
  for (const match of source.matchAll(/<[A-Za-z][^>]*>/gu)) {
    const tag = match[0];
    for (const attributeName of publicHtmlAttributeNames) {
      const value = readHtmlAttribute(tag, attributeName);
      if (value) {
        entries.push({
          source: fileName,
          path: ["attribute", String(tagIndex), attributeName],
          value,
        });
      }
    }
    tagIndex += 1;
  }

  const visibleBodyText = source
    .match(/<body\b[^>]*>([\s\S]*?)<\/body>/iu)?.[1]
    ?.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (visibleBodyText) {
    entries.push({ source: fileName, path: ["body"], value: visibleBodyText });
  }
  return entries;
}

function isAllowlistedNonRenderedTechnicalReference({ source, path, value }) {
  const location = `${source}:${path.join(".")}`;
  return nonRenderedTechnicalReferenceRules.some(
    (rule) =>
      rule.locationPattern.test(location) && rule.valuePattern.test(value.trim()),
  );
}

function findPublicProductVersionLabels(entries) {
  return entries.flatMap((entry) => {
    if (isAllowlistedNonRenderedTechnicalReference(entry)) return [];
    return [...entry.value.matchAll(publicProductVersionPattern)].map((match) => ({
      location: `${entry.source}:${entry.path.join(".")}`,
      label: match[0],
    }));
  });
}

test("targets the canonical Cloudflare production Worker directly", () => {
  assert.equal(wrangler.name, "tran-thien-nhan-portfolio");
  assert.equal(wrangler.main, "./worker/cloudflare.js");
  assert.equal(wrangler.compatibility_date, "2026-08-23");
  assert.deepEqual(wrangler.compatibility_flags, ["enable_request_signal"]);
  assert.deepEqual(wrangler.placement, { mode: "smart" });
  assert.doesNotMatch(wranglerSource, /nodejs_compat/u);
  assert.equal(wrangler.workers_dev, false);
  assert.equal(wrangler.preview_urls, false);
  assert.equal(wrangler.env, undefined);
  assert.deepEqual(wrangler.routes, [
    {
      pattern: "tranthiennhan.com",
      custom_domain: true,
    },
  ]);
});

test("keeps RFC 9116 discovery metadata actionable and short lived", () => {
  assert.match(
    securityTxtSource,
    /^Contact: mailto:tranthiennhan\.work@gmail\.com$/mu,
  );
  assert.match(
    securityTxtSource,
    /^Canonical: https:\/\/tranthiennhan\.com\/\.well-known\/security\.txt$/mu,
  );
  assert.match(
    securityTxtSource,
    /^Policy: https:\/\/tranthiennhan\.com\/\.well-known\/security-policy\.md$/mu,
  );

  const expiresValue = securityTxtSource.match(/^Expires: (.+)$/mu)?.[1];
  const expiresAt = Date.parse(expiresValue ?? "");
  const oneYearMs = 366 * 24 * 60 * 60 * 1_000;
  assert.equal(Number.isFinite(expiresAt), true);
  assert.ok(expiresAt > Date.now(), "security.txt must not be expired");
  assert.ok(
    expiresAt - Date.now() < oneYearMs,
    "security.txt expiry must remain less than one year away",
  );
});

test("publishes a source-bounded llms.txt with every canonical product page", () => {
  assert.match(llmsTxtSource, /^# Trần Thiện Nhân — AI Engineer$/mu);
  assert.match(llmsTxtSource, /source-bounded/iu);
  assert.match(llmsTxtSource, /Do not infer unpublished performance figures/iu);

  for (const url of [
    "https://tranthiennhan.com/en",
    "https://tranthiennhan.com/vi",
    "https://tranthiennhan.com/xnhan",
    "https://tranthiennhan.com/xnhan/about",
  ]) {
    assert.match(llmsTxtSource, new RegExp(`\\(${url.replaceAll(".", "\\.")}\\)`, "u"));
  }
});

test("keeps the bounded production assets, AI, metrics, visitor D1, daily cron, and rate-limit bindings", () => {
  assert.deepEqual(wrangler.assets, {
    directory: "./dist/client",
    binding: "ASSETS",
    not_found_handling: "none",
    run_worker_first: [
      "/api/*",
      "/",
      "/index.html",
      "/en",
      "/en.html",
      "/vi",
      "/vi.html",
      "/xnhan",
      "/xnhan/",
      "/xnhan.html",
      "/xnhan/about",
      "/xnhan/about/",
      "/xnhan-about.html",
    ],
  });
  assert.deepEqual(wrangler.ai, { binding: "AI", remote: true });
  assert.deepEqual(wrangler.secrets, {
    required: ["OPENAI_API_KEY", "OPENROUTER_API_KEY"],
  });
  assert.equal(wrangler.secrets_store_secrets, undefined);
  assert.doesNotMatch(wranglerSource, /TURNSTILE_SECRET|ask-nhan-turnstile-secret/u);
  assert.deepEqual(wrangler.analytics_engine_datasets, [
    {
      binding: "ASK_NHAN_METRICS",
      dataset: "ask_nhan_service_metrics",
    },
  ]);
  assert.deepEqual(wrangler.d1_databases, [
    {
      binding: "VISITOR_ANALYTICS",
      database_name: "portfolio-visitor-analytics",
      database_id: "480e313b-2212-40b4-94b2-a1f63c276c5a",
      migrations_dir: "./d1-migrations",
    },
  ]);
  assert.equal(wrangler.durable_objects, undefined);
  assert.deepEqual(wrangler.migrations, [
    {
      tag: "xnhan_budget",
      new_sqlite_classes: ["XNhanBudget"],
    },
    {
      tag: "xnhan_trends",
      new_sqlite_classes: ["XNhanTrends"],
    },
    {
      tag: "remove_xnhan_budget",
      deleted_classes: ["XNhanBudget"],
    },
    {
      tag: "remove_xnhan_trends",
      deleted_classes: ["XNhanTrends"],
    },
  ]);
  assert.deepEqual(wrangler.triggers, {
    crons: ["0 2 * * *"],
  });
  assert.equal(wrangler.ratelimits?.length, 4);
  const rateLimits = Object.fromEntries(
    wrangler.ratelimits.map((binding) => [binding.name, binding]),
  );
  assert.deepEqual(Object.keys(rateLimits).sort(), [
    "ASK_NHAN_RATE_LIMIT",
    "VISITOR_RATE_LIMIT",
    "XNHAN_INFERENCE_RATE_LIMIT",
    "XNHAN_RATE_LIMIT",
  ]);
  assert.match(rateLimits.ASK_NHAN_RATE_LIMIT.namespace_id, /^[1-9]\d*$/u);
  assert.match(rateLimits.VISITOR_RATE_LIMIT.namespace_id, /^[1-9]\d*$/u);
  assert.match(rateLimits.XNHAN_RATE_LIMIT.namespace_id, /^[1-9]\d*$/u);
  assert.match(rateLimits.XNHAN_INFERENCE_RATE_LIMIT.namespace_id, /^[1-9]\d*$/u);
  assert.notEqual(
    rateLimits.ASK_NHAN_RATE_LIMIT.namespace_id,
    rateLimits.VISITOR_RATE_LIMIT.namespace_id,
  );
  assert.notEqual(
    rateLimits.XNHAN_RATE_LIMIT.namespace_id,
    rateLimits.ASK_NHAN_RATE_LIMIT.namespace_id,
  );
  assert.notEqual(
    rateLimits.XNHAN_RATE_LIMIT.namespace_id,
    rateLimits.VISITOR_RATE_LIMIT.namespace_id,
  );
  for (const binding of Object.values(rateLimits)) {
    for (const other of Object.values(rateLimits)) {
      if (binding.name === other.name) continue;
      assert.notEqual(binding.namespace_id, other.namespace_id);
    }
  }
  assert.deepEqual(rateLimits.ASK_NHAN_RATE_LIMIT.simple, {
    limit: 6,
    period: 60,
  });
  assert.deepEqual(rateLimits.VISITOR_RATE_LIMIT.simple, {
    limit: 30,
    period: 60,
  });
  assert.deepEqual(rateLimits.XNHAN_RATE_LIMIT.simple, {
    limit: 4,
    period: 60,
  });
  assert.deepEqual(rateLimits.XNHAN_INFERENCE_RATE_LIMIT.simple, {
    limit: 12,
    period: 60,
  });
  assert.equal(wrangler.limits, undefined);
});

test("runs Worker-first only for APIs and canonical HTML shells, never content-hashed or binary assets", () => {
  const routes = wrangler.assets.run_worker_first;
  assert.deepEqual(routes.filter((route) => route !== "/api/*"), [
    "/",
    "/index.html",
    "/en",
    "/en.html",
    "/vi",
    "/vi.html",
    "/xnhan",
    "/xnhan/",
    "/xnhan.html",
    "/xnhan/about",
    "/xnhan/about/",
    "/xnhan-about.html",
  ]);

  for (const path of [
    "/assets/index-abc123.js",
    "/assets/index-abc123.css",
    "/assets/portrait.png",
    "/robots.txt",
    "/sitemap.xml",
  ]) {
    assert.equal(routes.includes(path), false, path);
    assert.equal(routes.includes("/*"), false, path);
    assert.equal(routes.includes("/assets/*"), false, path);
  }
});

test("preserves the four dashboard-owned model and display-name vars while pinning release routing in code", () => {
  assert.equal(wrangler.keep_vars, true);
  assert.equal(wrangler.vars, undefined);
  assert.doesNotMatch(wranglerSource, /XNHAN_OPENROUTER_SEARCH_TRANSPORT|XNHAN_OPENROUTER_REASONING_EFFORT/u);
  assert.doesNotMatch(wranglerSource, /XNHAN_SAFETY_ID_KEY/u);
  assert.equal(Object.hasOwn(wrangler.vars ?? {}, "XNHAN_OPENAI_MODEL"), false);
  assert.equal(Object.hasOwn(wrangler.vars ?? {}, "XNHAN_OPENROUTER_MODEL"), false);
  assert.equal(
    Object.hasOwn(wrangler.vars ?? {}, "XNHAN_OPENAI_MODEL_DISPLAY_NAME"),
    false,
  );
  assert.equal(
    Object.hasOwn(wrangler.vars ?? {}, "XNHAN_OPENROUTER_MODEL_DISPLAY_NAME"),
    false,
  );
  assert.doesNotMatch(
    wranglerSource,
    /XNHAN_OPENROUTER_MAX_(?:PROMPT|COMPLETION)_PRICE_PER_M|max_price/iu,
  );
  assert.doesNotMatch(
    generatedBindingsSource,
    /XNHAN_(?:OPENAI|OPENROUTER)_MODEL/u,
  );
  assert.match(runtimeModelBindingsSource, /XNHAN_OPENAI_MODEL: string/u);
  assert.match(runtimeModelBindingsSource, /XNHAN_OPENROUTER_MODEL: string/u);
  assert.match(
    runtimeModelBindingsSource,
    /XNHAN_OPENAI_MODEL_DISPLAY_NAME\?: string/u,
  );
  assert.match(
    runtimeModelBindingsSource,
    /XNHAN_OPENROUTER_MODEL_DISPLAY_NAME\?: string/u,
  );
  assert.doesNotMatch(
    wranglerSource,
    /PROMPT_ANALYTICS|prompt_events|analyticsConsent|deletionToken|ask-nhan-prompt-analytics|turnstile-secret\s*[:=]\s*["'][^"']+["']/iu,
  );

  assert.match(visitorMigrationSource, /CREATE TABLE visitor_daily/u);
  assert.match(visitorMigrationSource, /PRIMARY KEY \(day_local, ip_address\)/u);
  assert.match(visitorMigrationSource, /CREATE TABLE owner_ips/u);
  assert.match(visitorMigrationSource, /CREATE TABLE daily_visit_summaries/u);
  const migrationSql = visitorMigrationSource.replace(/^--.*$/gmu, "");
  assert.doesNotMatch(
    migrationSql,
    /\b(?:question|answer|turnstile|prompt|chat|user_agent|cookie)\b/iu,
  );
});

test("keeps the requested observability settings consistent across deployments", () => {
  assert.equal(wrangler.observability?.enabled, false);
  assert.equal(wrangler.observability?.head_sampling_rate, 1);
  assert.equal(Object.hasOwn(wrangler.observability, "redact_query_string"), false);
  assert.deepEqual(wrangler.observability?.logs, {
    enabled: true,
    head_sampling_rate: 1,
    persist: true,
    invocation_logs: true,
  });
  assert.deepEqual(wrangler.observability?.traces, {
    enabled: true,
    persist: true,
    head_sampling_rate: 1,
  });
});

test("health endpoint stays cache-safe and does not expose bindings", async () => {
  const response = await worker.fetch(new Request("https://tranthiennhan.com/api/health"), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "ask-nhan",
  });
});

test("keeps owner-controlled public copy free of sequential product version labels", () => {
  const publicCopyEntries = [
    ...collectStringEntries(content, "src/content.js"),
    ...collectStringEntries(xnhanContent, "src/xnhan-content.js"),
    ...collectStringEntries(xnhanAboutContent, "src/xnhan-about-content.js"),
    ...locales.flatMap((locale) =>
      collectStringEntries(
        personSchemaForLocale(locale, content[locale]),
        `src/person-schema.js#${locale}`,
      ),
    ),
    ...htmlSourceInputs.flatMap(collectHtmlPublicCopy),
  ];

  assert.deepEqual(
    [...new Set(publicCopyEntries.map(({ source }) => source))].sort(),
    [
      "index.html",
      "src/content.js",
      "src/person-schema.js#en",
      "src/person-schema.js#vi",
      "src/xnhan-about-content.js",
      "src/xnhan-content.js",
      "xnhan-about.html",
      "xnhan.html",
    ],
  );
  const allowlistedTechnicalReferences = [
    {
      source: "src/person-schema.js#en",
      path: ["url"],
      value: "https://api.example.test/v1/items",
    },
    {
      source: "src/person-schema.js#en",
      path: ["doi"],
      value: "10.1234/example.v2",
    },
    {
      source: "src/person-schema.js#en",
      path: ["identifier"],
      value: "schema_v3",
    },
  ];
  for (const entry of allowlistedTechnicalReferences) {
    assert.equal(isAllowlistedNonRenderedTechnicalReference(entry), true);
  }
  const rejectedPublicLabelsAtTechnicalLocations = [
    {
      source: "src/person-schema.js#en",
      path: ["url"],
      value: "Product-v1",
    },
    {
      source: "src/person-schema.js#en",
      path: ["identifier"],
      value: "Product-v1",
    },
    {
      source: "src/content.js",
      path: ["en", "contact", "links", "0", "href"],
      value: "Product-v1",
    },
  ];
  for (const entry of rejectedPublicLabelsAtTechnicalLocations) {
    assert.equal(isAllowlistedNonRenderedTechnicalReference(entry), false);
  }
  assert.equal(
    findPublicProductVersionLabels(rejectedPublicLabelsAtTechnicalLocations).length,
    rejectedPublicLabelsAtTechnicalLocations.length,
  );
  assert.deepEqual(
    findPublicProductVersionLabels([
      { source: "fixture", path: ["title"], value: "Product v1" },
      { source: "fixture", path: ["title"], value: "Version 2" },
      { source: "fixture", path: ["title"], value: "Phiên bản 3.1" },
    ]),
    [
      { location: "fixture:title", label: "v1" },
      { location: "fixture:title", label: "Version 2" },
      { location: "fixture:title", label: "Phiên bản 3.1" },
    ],
  );
  const htmlBoundaryFixture = collectHtmlPublicCopy({
    fileName: "xnhan.html",
    source: `<!doctype html>
      <html>
        <head>
          <script type="application/ld+json">{"name":"Product v2","url":"https://api.example.test/v1/items"}</script>
        </head>
        <body><img alt="Version 3"><input placeholder="Phiên bản 4"><p>Visible v5</p></body>
      </html>`,
  });
  assert.deepEqual(
    findPublicProductVersionLabels(htmlBoundaryFixture).map(({ label }) => label),
    ["v2", "Version 3", "Phiên bản 4", "v5"],
  );
  assert.deepEqual(
    findPublicProductVersionLabels(publicCopyEntries),
    [],
    "Public product copy must not expose v1, v2, v3, or equivalent sequential version labels.",
  );
});

test("gates a production deployment behind tests and a Wrangler dry run", () => {
  assert.equal(packageJson.packageManager, "pnpm@11.19.0");
  assert.equal(Object.hasOwn(packageJson, "version"), false);
  assert.equal(
    packageJson.scripts.build,
    "vite build && node scripts/build-localized-shells.mjs",
  );
  assert.equal(
    packageJson.scripts["dev:cloudflare"],
    "pnpm build && pnpm d1:migrate:local && wrangler dev",
  );
  assert.equal(
    packageJson.scripts["d1:migrate:local"],
    "wrangler d1 migrations apply portfolio-visitor-analytics --local",
  );
  assert.equal(
    packageJson.scripts["d1:migrate:production"],
    "wrangler d1 migrations apply portfolio-visitor-analytics --remote",
  );
  assert.equal(
    packageJson.scripts["d1:migrations:list"],
    "wrangler d1 migrations list portfolio-visitor-analytics --remote",
  );
  assert.equal(packageJson.scripts.check, "pnpm build && node --test tests/*.test.mjs");
  assert.equal(
    packageJson.scripts["check:cloudflare-types"],
    "wrangler types --check",
  );
  assert.equal(
    packageJson.scripts["verify:production"],
    "pnpm check && pnpm check:cloudflare-types && node scripts/verify-wrangler-dry-run.mjs",
  );
  assert.equal(
    packageJson.scripts["deploy:production"],
    'pnpm verify:production && wrangler deploy --message "Production #1: Nhan, Nhan and Nhan"',
  );

  const scriptText = Object.values(packageJson.scripts).join("\n");
  assert.doesNotMatch(scriptText, /Sites|prepare-sites-build|wrangler pages/iu);
});

test("treats Wrangler dry-run warnings as a failed production gate", () => {
  assert.deepEqual(assessWranglerDryRun({ status: 0, stdout: "dry-run complete", stderr: "" }), {
    ok: true,
    reason: "clean",
  });
  assert.deepEqual(assessWranglerDryRun({ status: 1, stdout: "", stderr: "failed" }), {
    ok: false,
    reason: "exit_status",
  });
  assert.deepEqual(assessWranglerDryRun({ status: 0, stdout: "WARNING: ignored field", stderr: "" }), {
    ok: false,
    reason: "configuration_warning",
  });
  assert.deepEqual(assessWranglerDryRun({ status: 0, stdout: "", stderr: "Unexpected fields found" }), {
    ok: false,
    reason: "configuration_warning",
  });
  assert.deepEqual(assessWranglerDryRun({ status: null, stdout: "", stderr: "", error: new Error("spawn") }), {
    ok: false,
    reason: "spawn_error",
  });
});
