import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

const requiredProductionFiles = [
  "d1-migrations/0004_securities_comparison_preparations.sql",
  "worker/securities/migrations/0005_comparison_preparations.sql",
  "d1-migrations/0003_securities_comparisons.sql",
  "scripts/securities/source-reviewed-cells.mjs",
  "src/securities/research-library.js",
  "worker/securities/migrations/0004_comparisons.sql",
  "tests/securities/vsc-sources.test.mjs",
  "tests/securities/bank-finance.test.mjs",
  "tests/securities/acb-sources.test.mjs",
  "docs/securities.md",
  "docs/securities-evaluation.md",
  "docs/securities-market-data.md",
  "docs/securities-model.md",
  "docs/securities-webmcp.md",
  "docs/securities-sources.md",
  "securities.html",
  "securities-architecture.html",
  "wrangler.securities.local.jsonc",
  "scripts/securities/collect-sources.mjs",
  "scripts/securities/ingestion-service.mjs",
  "scripts/securities/market-data.mjs",
  "scripts/securities/market-research.mjs",
  "scripts/securities/market-source-reader.mjs",
  "scripts/securities/vnstock/adapter.py",
  "scripts/securities/vnstock/requirements.txt",
  "scripts/securities/vnstock/test_adapter.py",
  "scripts/securities/read-local-key.mjs",
  "scripts/securities/run-local.mjs",
  "scripts/securities/source-extract.mjs",
  "scripts/securities/source-candidates.mjs",
  "scripts/securities/source-layout.mjs",
  "scripts/securities/source-evidence.mjs",
  "scripts/securities/source-quality.mjs",
  "scripts/securities/source-verified-facts.mjs",
  "scripts/securities/summarize-live-receipts.mjs",
  "scripts/securities/source-network.mjs",
  "scripts/securities/verify-live-api.mjs",
  "scripts/securities/verify-live-report.mjs",
  "scripts/securities/live-receipt-costs.mjs",
  "scripts/securities/source-extraction-integrity.mjs",
  "scripts/securities/source-fact-reader.mjs",
  "shared/securities/catalog.js",
  "shared/securities/dossier.js",
  "shared/securities/finance.js",
  "shared/securities/market-data.js",
  "shared/securities/metadata.js",
  "shared/securities/report.js",
  "shared/securities/receipt-identity.js",
  "shared/securities/report-contract.js",
  "shared/securities/routes.js",
  "shared/securities/source-contract.js",
  "shared/securities/verified-source-facts.js",
  "src/securities/AnalysisPanel.jsx",
  "src/securities/ChatPanel.jsx",
  "src/securities/DossierWorkspace.jsx",
  "src/securities/EvidenceDrawer.jsx",
  "src/securities/FinancialTable.jsx",
  "src/securities/MarketWorkspace.jsx",
  "src/securities/ModelProcess.jsx",
  "src/securities/market.css",
  "src/securities/ReviewPanel.jsx",
  "src/securities/ScopeConfirmation.jsx",
  "src/securities/SecuritiesApp.jsx",
  "src/securities/StartWorkspace.jsx",
  "src/securities/StockPicker.jsx",
  "src/securities/ResearchLibrary.jsx",
  "src/securities/use-page-metadata.js",
  "src/securities/architecture-main.jsx",
  "src/securities/architecture/architecture.css",
  "src/securities/architecture/content.js",
  "src/securities/architecture/SecuritiesArchitecturePage.jsx",
  "src/securities/investor/investorIntents.js",
  "src/securities/investor/InvestorIntents.jsx",
  "src/securities/investor/marketCopy.js",
  "src/securities/investor/marketFormatting.js",
  "src/securities/investor/marketRequests.js",
  "src/securities/investor/MarketResults.jsx",
  "src/securities/investor/publicResearch.js",
  "src/securities/investor/PublicResearchResults.jsx",
  "src/securities/investor/useMarketSnapshot.js",
  "src/securities/investor/watchlist.js",
  "src/securities/investor/Watchlist.jsx",
  "src/securities/api.js",
  "src/securities/controller.js",
  "src/securities/copy.js",
  "src/securities/format.js",
  "src/securities/layout.css",
  "src/securities/primitives.css",
  "src/securities/process.css",
  "src/securities/request-ledger.js",
  "src/securities/evidence.css",
  "src/securities/main.jsx",
  "src/securities/securities.css",
  "src/securities/workspace.css",
  "src/securities/ui.jsx",
  "src/securities/webmcp.js",
  "tests/securities/acceptance.test.mjs",
  "tests/securities/api.test.mjs",
  "tests/securities/dossier.test.mjs",
  "tests/securities/controller.test.mjs",
  "tests/securities/export.test.mjs",
  "tests/securities/finance.test.mjs",
  "tests/securities/frontend-report.test.mjs",
  "tests/securities/ingestion-security.test.mjs",
  "tests/securities/integration.test.mjs",
  "tests/securities/market-data.test.mjs",
  "tests/securities/market-frontend.test.mjs",
  "tests/securities/market-research.test.mjs",
  "tests/securities/market-research-service.test.mjs",
  "tests/securities/market-source-reader.test.mjs",
  "tests/securities/model.test.mjs",
  "tests/securities/model-evaluation.test.mjs",
  "tests/securities/model-report.test.mjs",
  "tests/securities/report-finance.test.mjs",
  "tests/securities/report.test.mjs",
  "tests/securities/receipt-identity.test.mjs",
  "tests/securities/security-review.test.mjs",
  "tests/securities/source-layout.test.mjs",
  "tests/securities/source-evidence.test.mjs",
  "tests/securities/sources.test.mjs",
  "tests/securities/ux-boundaries.test.mjs",
  "tests/securities/webmcp.test.mjs",
  "worker/securities/api.js",
  "worker/securities/export.js",
  "worker/securities/ingestion.js",
  "worker/securities/market-research.js",
  "worker/securities/local.js",
  "worker/securities/migrations/0001.sql",
  "worker/securities/migrations/0002_sources.sql",
  "worker/securities/migrations/0003_source_checks.sql",
  "worker/securities/model-contract.js",
  "worker/securities/model-report.js",
  "worker/securities/model-retrieval.js",
  "worker/securities/model-transport.js",
  "worker/securities/model.js",
  "worker/securities/sources.js",
  "worker/securities/store.js",
  "tests/module-boundaries.test.mjs",
  "shared/xnhan/routes.js",
  "worker/xnhan/config.js",
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
  "d1-migrations/0002_securities_shared_history.sql",
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
  "public/assets/flag_of_the_United_Kingdom.svg",
  "public/assets/flag_of_Vietnam.svg",
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
  "public/llms.txt",
  "public/robots.txt",
  "public/sitemap.xml",
  "scripts/build-localized-shells.mjs",
  "scripts/verify-wrangler-dry-run.mjs",
  "shared/xnhan/model-display-name.js",
  "shared/xnhan/contracts.js",
  "shared/answer-language.js",
  "src/App.jsx",
  "src/base.css",
  "src/xnhan/XNhanAboutApp.jsx",
  "src/xnhan/XNhanApp.jsx",
  "src/xnhan/XNhanLogo.jsx",
  "src/xnhan/XNhanTurn.jsx",
  "src/components/AskNhan.jsx",
  "src/components/ask-scroll.js",
  "src/components/Header.jsx",
  "src/components/LocaleFlag.jsx",
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
  "src/xnhan/use-xnhan-search-session.js",
  "src/xnhan/xnhan-search-lifecycle.js",
  "src/xnhan/xnhan-search-request.js",
  "src/xnhan/xnhan-search-status.js",
  "src/xnhan/xnhan-about-content.js",
  "src/xnhan/xnhan-about-main.jsx",
  "src/xnhan/xnhan-about-webmcp.js",
  "src/xnhan/xnhan-content.js",
  "src/xnhan/xnhan-copy.js",
  "shared/xnhan/locales.js",
  "src/xnhan/xnhan-locale.js",
  "src/xnhan/xnhan-main.jsx",
  "src/xnhan/xnhan-model-id.js",
  "src/xnhan/xnhan-session-state.js",
  "src/xnhan/xnhan-stream.js",
  "src/xnhan/xnhan-webmcp-snapshot.js",
  "src/main.jsx",
  "src/portfolio-webmcp.js",
  "src/webmcp-runtime.js",
  "src/webmcp-registration.js",
  "src/styles.css",
  "src/xnhan/xnhan-about.css",
  "src/xnhan/xnhan.css",
  "src/xnhan/xnhan-turn.css",
  "src/webmcp.js",
  "src/xnhan/xnhan-webmcp-input.js",
  "src/xnhan/xnhan-webmcp-results.js",
  "src/xnhan/xnhan-webmcp-scheduler.js",
  "src/xnhan/xnhan-webmcp.js",
  "src/use-visitor-count.js",
  "src/xnhan/use-xnhan-about-webmcp.js",
  "src/xnhan/use-xnhan-webmcp.js",
  "src/xnhan/XNhanActivity.jsx",
  "src/xnhan/XNhanAnswer.jsx",
  "tests/answer-language.test.mjs",
  "tests/ask-scroll.test.mjs",
  "tests/cloudflare-worker.test.mjs",
  "tests/content.test.mjs",
  "tests/contrast.test.mjs",
  "tests/font-subsets.test.mjs",
  "tests/locale-shells.test.mjs",
  "tests/localized-shells.test.mjs",
  "tests/xnhan/openai-response-stream.test.mjs",
  "tests/production-config.test.mjs",
  "tests/repository-hygiene.test.mjs",
  "tests/theme.test.mjs",
  "tests/ux-contract.test.mjs",
  "tests/webmcp.test.mjs",
  "tests/xnhan/xnhan-webmcp.test.mjs",
  "tests/xnhan/xnhan-worker.test.mjs",
  "tests/xnhan/xnhan-about-ui.test.mjs",
  "tests/xnhan/xnhan-about-webmcp.test.mjs",
  "tests/xnhan/xnhan-openai.test.mjs",
  "tests/xnhan/xnhan-ranking.test.mjs",
  "tests/xnhan/xnhan-ui.test.mjs",
  "vite.config.mjs",
  "worker/abort-signal.js",
  "worker/ask-facts.js",
  "worker/ask.js",
  "worker/cloudflare.js",
  "worker/config.js",
  "worker/http.js",
  "worker/xnhan/openai-response-stream.js",
  "worker/rate-limit.js",
  "worker/runtime-model-bindings.d.ts",
  "worker/xnhan/search.js",
  "worker/xnhan/openai.js",
  "worker/xnhan/openai-config.js",
  "worker/xnhan/openrouter.js",
  "worker/xnhan/prompt.js",
  "worker/xnhan/provider.js",
  "worker/xnhan/provider-registry.js",
  "worker/xnhan/ranking.js",
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
  "securities.html",
  "securities-architecture.html",
  "wrangler.securities.local.jsonc",
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
  return (
    allowedEphemeralRootEntries.has(entry) ||
    entry === ".env" ||
    entry.startsWith(".env.") ||
    entry === ".dev.vars" ||
    entry.startsWith(".dev.vars.")
  );
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
      files.push(...(await listSourceFiles(path.join(directory, entry.name), relativePath)));
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
  assert.deepEqual((await listSourceFiles()).sort(), [...requiredProductionFiles].sort());
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
    .filter((entry) => !allowedRootEntries.has(entry) && !isAllowedEphemeralRootEntry(entry))
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
      sourceFiles.map((relativePath) => readFile(path.join(projectRoot, relativePath), "utf8")),
    )
  ).join("\n");
  const retiredProviderName = String.fromCharCode(69, 120, 97);
  const retiredProviderSlug = retiredProviderName.toLowerCase();
  const retiredMarkers = [
    [retiredProviderName.toUpperCase(), "API", "KEY"].join("_"),
    ["api", retiredProviderSlug, "ai"].join("."),
    ["normalize", retiredProviderName, "Result"].join(""),
    ["provider", ": ", '"', retiredProviderSlug, '"'].join(""),
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
  const referencedAssets = [...source.matchAll(/\/assets\/([A-Za-z0-9._-]+)/gu)].map(
    (match) => match[1],
  );

  assert.deepEqual([...new Set(referencedAssets)].sort(), assetFiles);
});
