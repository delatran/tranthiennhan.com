import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const run = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const authorizedKeyPath = path.resolve(repositoryRoot, "../key.txt");
export const REQUIRED_PHASE_A_GATES = Object.freeze([
  "pnpm_check",
  "source_pipeline",
  "browser_workflow",
  "webmcp_bridge",
  "export_roundtrip",
  "security_boundaries",
]);

export function parseSecuritiesKey(raw) {
  const value = raw.replace(/^\uFEFF/u, "").trim();
  const match = /^(?:OPENROUTER_API_KEY\s*=\s*)?([A-Za-z0-9_-]{20,256})$/u.exec(value);
  if (!match) throw new Error("The authorized OpenRouter key file has an unsupported format.");
  return match[1];
}

export async function assertPhaseAGates(phaseAReceiptPath) {
  if (!phaseAReceiptPath)
    throw new Error("A verified phase A receipt is required before live API testing.");
  let receipt;
  try {
    receipt = JSON.parse(await readFile(phaseAReceiptPath, "utf8"));
  } catch {
    throw new Error("The phase A receipt could not be read.");
  }
  if (
    receipt.status !== "passed" ||
    REQUIRED_PHASE_A_GATES.some((gate) => receipt.gates?.[gate]?.status !== "passed")
  ) {
    throw new Error(
      "Phase A is incomplete. Complete every required local gate before live API testing.",
    );
  }
  return receipt;
}

export async function readLocalSecuritiesKey({ phaseAReceiptPath } = {}) {
  await assertPhaseAGates(phaseAReceiptPath);
  const { stdout } = await run("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    windowsHide: true,
  });
  const trackedSecrets = stdout
    .split("\0")
    .filter(
      (file) =>
        /(?:^|\/)(?:key\.txt|\.env(?:\..*)?|\.dev\.vars(?:\..*)?)$/iu.test(file) &&
        file !== ".dev.vars.example",
    );
  if (trackedSecrets.length)
    throw new Error(
      "A local credential file is tracked by Git. Resolve its repository boundary before live testing.",
    );
  let raw;
  try {
    const info = await stat(authorizedKeyPath);
    if (!info.isFile() || info.size > 4096) throw new Error("invalid file");
    raw = await readFile(authorizedKeyPath, "utf8");
  } catch {
    throw new Error("The authorized parent-directory key.txt could not be read safely.");
  }
  return parseSecuritiesKey(raw);
}
