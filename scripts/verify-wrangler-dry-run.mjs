import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const WRANGLER_WARNING_PATTERN = /\bWARNING\b|Unexpected fields found/iu;

export function assessWranglerDryRun({ status, stdout = "", stderr = "", error = null }) {
  if (error) return { ok: false, reason: "spawn_error" };
  if (status !== 0) return { ok: false, reason: "exit_status" };
  if (WRANGLER_WARNING_PATTERN.test(`${stdout}\n${stderr}`)) {
    return { ok: false, reason: "configuration_warning" };
  }
  return { ok: true, reason: "clean" };
}

export function runWranglerDryRun() {
  const wranglerBin = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
  const result = spawnSync(process.execPath, [wranglerBin, "deploy", "--dry-run"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) process.stderr.write(`Wrangler dry-run process error: ${result.error.message}\n`);

  const assessment = assessWranglerDryRun(result);
  if (!assessment.ok) {
    process.stderr.write(`Wrangler dry-run gate failed: ${assessment.reason}.\n`);
    process.exitCode = 1;
  }
  return assessment;
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedUrl === import.meta.url) runWranglerDryRun();
