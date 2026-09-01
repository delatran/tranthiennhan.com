import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

const requiredProductionFiles = [
  ".dev.vars.example",
  ".gitattributes",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/pull_request_template.md",
  ".gitignore",
  ".node-version",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "README.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  "docs/architecture.md",
  "docs/assets/portfolio-preview.png",
  "docs/development.md",
  "docs/privacy.md",
  "d1-migrations/0001_visitor_analytics.sql",
  "index.html",
  "xnhan-about.html",
  "xnhan.html",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "public/.well-known/security-policy.md",
  "public/.well-known/security.txt",
  "public/_headers",
  "public/_redirects",
  "public/assets/kienlongbank-symbol-6ddcb463.png",
  "public/assets/kienlongbank-symbol-2x-07bba4e7.png",
  "public/assets/mercedes-benz-mark-1ac65e81.jpg",
  "public/assets/mercedes-benz-mark-2x-7f72465a.png",
  "public/assets/portrait-icon-20d683e7-32.png",
  "public/assets/portrait-icon-20d683e7-180.png",
  "public/assets/portrait-icon-20d683e7-192.png",
  "public/assets/portrait-icon-20d683e7-512.png",
  "public/assets/ptit-mark-3ae2f7aa.png",
  "public/assets/ptit-mark-2x-a6a58dca.png",
  "public/robots.txt",
  "public/sitemap.xml",
  "scripts/build-localized-shells.mjs",
  "scripts/verify-wrangler-dry-run.mjs",
  "shared/xnhan-model-display-name.js",
  "shared/xnhan.js",
  "src/answer-language.js",
  "src/App.jsx",
  "src/base.css",
  "src/XNhanAboutApp.jsx",
  "src/XNhanApp.jsx",
  "src/XNhanLogo.jsx",
  "src/XNhanTurn.jsx",
  "src/components/AskNhan.jsx",
  "src/components/Header.jsx",
  "src/components/modal-inertness.js",
  "src/components/navigation.js",
  "src/content.js",
  "src/fonts.css",
  "src/person-schema.js",
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
  "src/portfolio/styles/approach.css",
  "src/portfolio/styles/ask-nhan.css",
  "src/portfolio/styles/contact.css",
  "src/portfolio/styles/experience.css",
  "src/portfolio/styles/footer.css",
  "src/portfolio/styles/header.css",
  "src/portfolio/styles/hero.css",
  "src/portfolio/styles/layout.css",
  "src/portfolio/styles/product.css",
  "src/portfolio/styles/work.css",
  "src/use-autosize-textarea.js",
  "src/use-xnhan-search-session.js",
  "src/xnhan-search-lifecycle.js",
  "src/xnhan-search-request.js",
  "src/xnhan-search-status.js",
  "src/xnhan-about-content.js",
  "src/xnhan-about-main.jsx",
  "src/xnhan-about-webmcp.js",
  "src/xnhan-content.js",
  "src/xnhan-copy.js",
  "src/xnhan-locale-constants.js",
  "src/xnhan-locale.js",
  "src/xnhan-main.jsx",
  "src/xnhan-model-id.js",
  "src/xnhan-session-state.js",
  "src/xnhan-stream.js",
  "src/xnhan-webmcp-snapshot.js",
  "src/main.jsx",
  "src/portfolio-webmcp.js",
  "src/webmcp-runtime.js",
  "src/webmcp-registration.js",
  "src/styles.css",
  "src/xnhan-about.css",
  "src/xnhan.css",
  "src/xnhan-turn.css",
  "src/webmcp.js",
  "src/xnhan-webmcp-input.js",
  "src/xnhan-webmcp-results.js",
  "src/xnhan-webmcp-scheduler.js",
  "src/xnhan-webmcp.js",
  "src/use-visitor-count.js",
  "src/use-xnhan-about-webmcp.js",
  "src/use-xnhan-webmcp.js",
  "src/XNhanActivity.jsx",
  "src/XNhanAnswer.jsx",
  "tests/answer-language.test.mjs",
  "tests/cloudflare-worker.test.mjs",
  "tests/content.test.mjs",
  "tests/contrast.test.mjs",
  "tests/font-subsets.test.mjs",
  "tests/locale-shells.test.mjs",
  "tests/localized-shells.test.mjs",
  "tests/openai-response-stream.test.mjs",
  "tests/production-config.test.mjs",
  "tests/repository-hygiene.test.mjs",
  "tests/theme.test.mjs",
  "tests/ux-contract.test.mjs",
  "tests/webmcp.test.mjs",
  "tests/xnhan-webmcp.test.mjs",
  "tests/xnhan-worker.test.mjs",
  "tests/xnhan-about-ui.test.mjs",
  "tests/xnhan-about-webmcp.test.mjs",
  "tests/xnhan-openai.test.mjs",
  "tests/xnhan-ranking.test.mjs",
  "tests/xnhan-ui.test.mjs",
  "vite.config.mjs",
  "worker/abort-signal.js",
  "worker/ask-facts.js",
  "worker/ask.js",
  "worker/cloudflare.js",
  "worker/config.js",
  "worker/http.js",
  "worker/openai-response-stream.js",
  "worker/rate-limit.js",
  "worker/runtime-model-bindings.d.ts",
  "worker/xnhan.js",
  "worker/xnhan-openai.js",
  "worker/xnhan-openai-config.js",
  "worker/xnhan-openrouter.js",
  "worker/xnhan-prompt.js",
  "worker/xnhan-provider.js",
  "worker/xnhan-provider-registry.js",
  "worker/xnhan-ranking.js",
  "worker/visits.js",
  "worker-configuration.d.ts",
  "wrangler.jsonc",
];

const retiredPaths = [
  ".npmrc",
  ".openai/hosting.json",
  "deployments",
  "design-qa.md",
  "docs/research",
  "i18n",
  "migrations",
  "privacy",
  "qa-captures",
  "research",
  "scripts/codex-cloud-maintenance.sh",
  "scripts/codex-cloud-setup.sh",
  "scripts/prepare-sites-build.mjs",
  "scripts/read-prompt-analytics.mjs",
  "tests/sites-worker.test.mjs",
  "worker/index.js",
];

const allowedRootEntries = new Set([
  ".dev.vars.example",
  ".gitattributes",
  ".github",
  ".gitignore",
  ".node-version",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "README.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  "docs",
  "d1-migrations",
  "index.html",
  "xnhan-about.html",
  "xnhan.html",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "public",
  "scripts",
  "shared",
  "src",
  "tests",
  "vite.config.mjs",
  "worker",
  "worker-configuration.d.ts",
  "wrangler.jsonc",
]);

// Git metadata and local verifier output are not authoritative source. Runtime
// directories must be removed before a clean source handoff; `.git` may exist
// after the owner initializes this exact directory as the repository root.
const allowedEphemeralRootEntries = new Set([".git", ".wrangler", "dist", "node_modules"]);

function isAllowedEphemeralRootEntry(entry) {
  if (entry === ".dev.vars.example") return false;
  return allowedEphemeralRootEntries.has(entry)
    || entry === ".env"
    || entry.startsWith(".env.")
    || entry === ".dev.vars"
    || entry.startsWith(".dev.vars.");
}

async function exists(relativePath) {
  try {
    await access(path.join(projectRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function listSourceFiles(directory = projectRoot, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (!prefix && isAllowedEphemeralRootEntry(entry.name)) continue;
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(path.join(directory, entry.name), relativePath));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

test("keeps every production source file required by the repository contract", async () => {
  const checks = await Promise.all(
    requiredProductionFiles.map(async (relativePath) => [relativePath, await exists(relativePath)]),
  );
  const missing = checks.filter(([, present]) => !present).map(([relativePath]) => relativePath);
  assert.deepEqual(missing, []);
  assert.deepEqual(
    (await listSourceFiles()).sort(),
    [...requiredProductionFiles].sort(),
  );
});

test("does not retain research, cloud bootstrap, or superseded hosting paths", async () => {
  const checks = await Promise.all(
    retiredPaths.map(async (relativePath) => [relativePath, await exists(relativePath)]),
  );
  const retained = checks.filter(([, present]) => present).map(([relativePath]) => relativePath);
  assert.deepEqual(retained, []);
});

test("keeps the website root limited to production source and verifier runtime directories", async () => {
  const rootEntries = await readdir(projectRoot);
  const unexpected = rootEntries
    .filter(
      (entry) => !allowedRootEntries.has(entry) && !isAllowedEphemeralRootEntry(entry),
    )
    .sort();

  assert.deepEqual(unexpected, []);
});

test("keeps allowed local runtime configuration outside the Git payload", async () => {
  const ignoreLines = new Set(
    (await readFile(path.join(projectRoot, ".gitignore"), "utf8"))
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean),
  );

  for (const pattern of [".env", ".env.*", ".dev.vars*", "!.dev.vars.example"]) {
    assert.equal(ignoreLines.has(pattern), true, `${pattern} must stay in .gitignore`);
  }
  assert.equal(isAllowedEphemeralRootEntry(".dev.vars"), true);
  assert.equal(isAllowedEphemeralRootEntry(".dev.vars.local"), true);
  assert.equal(isAllowedEphemeralRootEntry(".env"), true);
  assert.equal(isAllowedEphemeralRootEntry(".env.local"), true);
  assert.equal(isAllowedEphemeralRootEntry(".dev.vars.example"), false);
});

test("does not retain prompt-analytics migrations, readers, databases, or exports", async () => {
  const checks = await Promise.all(
    [
      "migrations",
      "scripts/read-prompt-analytics.mjs",
      "prompt-analytics",
      "prompt_events.sql",
      "ask-nhan-prompt-analytics.sqlite",
    ].map(async (relativePath) => [relativePath, await exists(relativePath)]),
  );
  const retained = checks.filter(([, present]) => present).map(([relativePath]) => relativePath);
  assert.deepEqual(retained, []);

  const sourcePaths = await listSourceFiles();
  const analyticsArtifacts = sourcePaths.filter((relativePath) =>
    /(?:prompt[-_]?analytics|prompt[-_]?events|redacted[-_]?prompts|d1[-_]?backup)|\.(?:db|sqlite3?)$/iu.test(
      relativePath,
    ),
  );
  assert.deepEqual(analyticsArtifacts, []);
});

test("does not reintroduce the retired search provider or obsolete display name", async () => {
  const textFilePattern = /\.(?:css|d\.ts|html|js|json|jsonc|jsx|md|mjs|sql|txt|xml|ya?ml)$/u;
  const sourceFiles = requiredProductionFiles.filter((relativePath) =>
    textFilePattern.test(relativePath),
  );
  const source = (
    await Promise.all(
      sourceFiles.map((relativePath) =>
        readFile(path.join(projectRoot, relativePath), "utf8"),
      ),
    )
  ).join("\n");
  const retiredProviderName = String.fromCharCode(69, 120, 97);
  const retiredProviderSlug = retiredProviderName.toLowerCase();
  const retiredMarkers = [
    [retiredProviderName.toUpperCase(), "API", "KEY"].join("_"),
    ["api", retiredProviderSlug, "ai"].join("."),
    ["normalize", retiredProviderName, "Result"].join(""),
    ["provider", ": ", "\"", retiredProviderSlug, "\""].join(""),
    ["X", "Nhân"].join(""),
  ];

  for (const marker of retiredMarkers) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test("keeps only public image assets referenced by application source", async () => {
  const assetDirectory = path.join(projectRoot, "public", "assets");
  const assetFiles = (await readdir(assetDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  const sourceFiles = requiredProductionFiles.filter(
    (relativePath) =>
      /^(?:shared|src)\/.*\.(?:css|js|jsx)$/u.test(relativePath) ||
      /^(?:index|xnhan|xnhan-about)\.html$/u.test(relativePath),
  );
  const source = (
    await Promise.all(
      sourceFiles.map((relativePath) => readFile(path.join(projectRoot, relativePath), "utf8")),
    )
  ).join("\n");
  const referencedAssets = [
    ...source.matchAll(/\/assets\/([A-Za-z0-9._-]+)/gu),
  ].map((match) => match[1]);

  assert.deepEqual([...new Set(referencedAssets)].sort(), assetFiles);
});
