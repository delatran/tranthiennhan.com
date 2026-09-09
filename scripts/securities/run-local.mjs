import { spawn, execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { readLocalSecuritiesKey } from "./read-local-key.mjs";
import { startSecuritiesIngestionService } from "./ingestion-service.mjs";
import { createMarketDataProvider } from "./market-data.mjs";
import { createMarketResearchProvider } from "./market-research.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const live = args.includes("--live");
const receiptIndex = args.indexOf("--phase-a-receipt");
const phaseAReceiptPath = receiptIndex < 0 ? undefined : args[receiptIndex + 1];
const portIndex = args.indexOf("--port");
const port = portIndex < 0 ? 8788 : Number(args[portIndex + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local port.");
const known = new Set(["--live", "--skip-build", "--phase-a-receipt", "--port"]);
for (let i = 0; i < args.length; i++) {
  if (!known.has(args[i])) throw new Error("Unsupported local launcher argument.");
  if (["--port", "--phase-a-receipt"].includes(args[i])) i++;
}

await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", () =>
    reject(
      new Error(
        `Local port ${port} is already in use. Choose another port; no process was stopped.`,
      ),
    ),
  );
  probe.listen(port, "127.0.0.1", () => probe.close(resolve));
});

const childEnv = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
};
for (const key of ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "SECURITIES_OPENROUTER_API_KEY"])
  delete childEnv[key];
let ownedChild;
let stopping = false;
let cleanup = async () => {};
let ingestionService;
let marketProvider;
let marketResearch;
async function stopOwnedService() {
  if (stopping) return;
  stopping = true;
  // Only the process tree started by this launcher is stopped.
  if (ownedChild?.pid && ownedChild.exitCode === null) {
    if (process.platform === "win32") {
      await new Promise((resolve) =>
        execFile(
          "taskkill",
          ["/PID", String(ownedChild.pid), "/T", "/F"],
          { windowsHide: true },
          () => resolve(),
        ),
      );
    } else ownedChild.kill("SIGTERM");
  }
  await cleanup();
  await ingestionService?.close();
  await marketResearch?.close();
  await marketProvider?.close();
}
process.once("SIGINT", () => {
  void stopOwnedService();
});
process.once("SIGTERM", () => {
  void stopOwnedService();
});
function command(script, parameters) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...parameters], {
      cwd: root,
      env: childEnv,
      windowsHide: true,
      stdio: "inherit",
    });
    ownedChild = child;
    child.once("error", () => reject(new Error("The local command could not be started.")));
    child.once("exit", (code) => {
      if (ownedChild === child) ownedChild = undefined;
      code === 0 || stopping
        ? resolve()
        : reject(new Error(`Local command failed with exit ${code}.`));
    });
  });
}

if (!args.includes("--skip-build")) {
  await command(path.join(root, "node_modules/vite/bin/vite.js"), ["build"]);
  await command(path.join(root, "scripts/build-localized-shells.mjs"), []);
}
if (stopping) process.exit(0);

const runtimeDirectory = path.resolve(root, "../output/securities/runtime");
await mkdir(runtimeDirectory, { recursive: true });
const config = JSON.parse(
  await readFile(path.join(root, "wrangler.securities.local.jsonc"), "utf8"),
);
if (
  config.ai ||
  config.routes ||
  config.triggers ||
  config.d1_databases.some((binding) => binding.binding !== "SECURITIES_DB" || binding.remote)
) {
  throw new Error("Local configuration contains an unexpected external binding.");
}
config.main = path.resolve(root, config.main);
config.$schema = path.resolve(root, config.$schema);
config.assets.directory = path.resolve(root, config.assets.directory);
config.d1_databases = config.d1_databases.map((binding) => ({
  ...binding,
  migrations_dir: path.resolve(root, binding.migrations_dir),
}));
config.dev.port = port;
config.vars.SECURITIES_MODEL_MODE = live ? "live" : "off";

const key = live ? await readLocalSecuritiesKey({ phaseAReceiptPath }) : null;
const ingestionToken = randomBytes(32).toString("hex");
const sourceCollector = await import("./collect-sources.mjs");
const sourceEvidence = await import("./source-evidence.mjs");
marketProvider = await createMarketDataProvider({
  directory: path.join(runtimeDirectory, "public-market"),
});
marketResearch = await createMarketResearchProvider({
  directory: path.join(runtimeDirectory, "public-research"),
  marketProvider,
  env: {
    SECURITIES_MODEL_MODE: live ? "live" : "off",
    ...(key ? { SECURITIES_OPENROUTER_API_KEY: key } : {}),
  },
});
ingestionService = await startSecuritiesIngestionService({
  token: ingestionToken,
  directory: path.join(runtimeDirectory, "source-jobs"),
  collect: sourceCollector.collectSecuritiesSources,
  getAsset: sourceCollector.getSecuritiesSourceAsset,
  readEvidence: sourceEvidence.readSecuritiesSourceEvidence,
  readMarket: marketProvider.get,
  readMarketDirectory: marketProvider.getDirectory,
  readMarketResearch: marketResearch.get,
});
void marketProvider.getDirectory().catch(() => {});
config.vars.SECURITIES_INGESTION_URL = ingestionService.url;
const privateDirectory = await mkdtemp(path.join(tmpdir(), "nhan-securities-local-"));
const configPath = path.join(privateDirectory, "wrangler.jsonc");
const varsPath = path.join(privateDirectory, ".dev.vars");
const wranglerPath = path.join(root, "node_modules/wrangler/bin/wrangler.js");
const persistPath = path.join(runtimeDirectory, "state");
cleanup = async () => {
  await Promise.all([configPath, varsPath].map((file) => unlink(file).catch(() => {})));
  await rmdir(privateDirectory).catch(() => {});
};

try {
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await writeFile(
    varsPath,
    `SECURITIES_INGESTION_TOKEN=${ingestionToken}\n${key ? `SECURITIES_OPENROUTER_API_KEY=${key}\n` : "# Phase A: no provider credentials.\n"}`,
    { mode: 0o600 },
  );
  await command(wranglerPath, [
    "d1",
    "migrations",
    "apply",
    "nhan-securities-local",
    "--local",
    "--config",
    configPath,
    "--persist-to",
    persistPath,
  ]);
  if (!stopping) {
    console.log(
      `Nhân for Securities: http://127.0.0.1:${port}/securities?lang=vi (${live ? "live OpenRouter" : "local sources; AI off"})`,
    );
    console.log("Local dossiers persist across restarts. Press Ctrl+C to stop this service.");
    await command(wranglerPath, [
      "dev",
      "--local",
      "--config",
      configPath,
      "--persist-to",
      persistPath,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      "0",
      "--log-level",
      "warn",
    ]);
  }
} finally {
  await cleanup();
  await ingestionService?.close();
  await marketResearch?.close();
  await marketProvider?.close();
}
