import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRED_PHASE_A_GATES } from "../../scripts/securities/read-local-key.mjs";
import {
  SECURITIES_LIVE_EVALUATION_PROTOCOL,
  runSecuritiesLiveEvaluation,
} from "../../scripts/securities/verify-live-api.mjs";
import {
  SECURITIES_REPORT_EVALUATION_PROTOCOL,
  assertReportLocalGates,
  getLiveReportImplementationIdentity,
  runSecuritiesLiveReportEvaluation,
} from "../../scripts/securities/verify-live-report.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const liveRoot = path.resolve(repositoryRoot, "../output/securities/receipts/live");
const hash = (value) => createHash("sha256").update(value).digest("hex");

async function phaseAFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "securities-model-gates-"));
  const file = path.join(directory, "phase-a.json");
  await writeFile(
    file,
    JSON.stringify({
      status: "passed",
      gates: Object.fromEntries(REQUIRED_PHASE_A_GATES.map((gate) => [gate, { status: "passed" }])),
    }),
  );
  t.after(async () => {
    await rm(file, { force: true });
    await rmdir(directory);
  });
  return file;
}

test("report execution requires current local gates before metadata, key resolution or transport", async (t) => {
  const phaseAReceiptPath = await phaseAFixture(t);
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    assert.fail("Missing report gates must stop before the network.");
  };
  try {
    await assert.rejects(
      runSecuritiesLiveReportEvaluation({ phaseAReceiptPath, caseId: "fpt-h1-friendly" }),
      { code: "report_local_gates_required" },
    );
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("report local gates reject incomplete, unbound and stale receipts", async (t) => {
  const file = await phaseAFixture(t);
  const implementation = await getLiveReportImplementationIdentity();
  const valid = {
    status: "passed",
    implementationHash: implementation.sha256,
    gates: Object.fromEntries(
      ["pnpm_check", "source_pipeline", "security_boundaries"].map((gate) => [
        gate,
        { status: "passed" },
      ]),
    ),
  };
  for (const [receipt, code] of [
    [{ ...valid, status: "pending" }, "report_local_gates_incomplete"],
    [{ ...valid, implementationHash: undefined }, "report_local_gates_identity_required"],
    [{ ...valid, implementationHash: "f".repeat(64) }, "report_local_gates_stale"],
    [
      { ...valid, gates: { ...valid.gates, source_pipeline: { status: "failed" } } },
      "report_local_gates_incomplete",
    ],
  ]) {
    await writeFile(file, JSON.stringify(receipt));
    await assert.rejects(assertReportLocalGates(file, implementation), { code });
  }
  await writeFile(file, JSON.stringify(valid));
  assert.equal(
    (await assertReportLocalGates(file, implementation)).implementationHash,
    implementation.sha256,
  );
});

test("report identity binds runtime evidence and accounting helpers and rejects gates after each changes", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "securities-identity-test-"));
  t.after(async () => {
    const target = path.resolve(directory);
    assert.ok(target.startsWith(`${path.resolve(tmpdir())}${path.sep}`));
    assert.ok(path.basename(target).startsWith("securities-identity-test-"));
    await rm(target, { recursive: true, force: true });
  });
  const runtimeHelpers = [
    "scripts/securities/source-fact-reader.mjs",
    "scripts/securities/source-extraction-integrity.mjs",
    "shared/securities/receipt-identity.js",
  ];
  const current = await getLiveReportImplementationIdentity();
  for (const helper of runtimeHelpers) {
    assert.ok(
      current.files.some(({ file }) => file === helper),
      `${helper} must be pinned`,
    );
  }
  for (const { file } of current.files) {
    const target = path.join(directory, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `// Synthetic implementation fixture for ${file}\n`);
  }
  const baseline = await getLiveReportImplementationIdentity({ directory });
  const gateFile = path.join(directory, "local-gates.json");
  await writeFile(
    gateFile,
    JSON.stringify({
      status: "passed",
      implementationHash: baseline.sha256,
      gates: Object.fromEntries(
        ["pnpm_check", "source_pipeline", "security_boundaries"].map((gate) => [
          gate,
          { status: "passed" },
        ]),
      ),
    }),
  );
  await assertReportLocalGates(gateFile, baseline);
  for (const helper of runtimeHelpers) {
    const target = path.join(directory, helper);
    const bytes = await readFile(target);
    await writeFile(target, Buffer.concat([bytes, Buffer.from("// Changed fixture behavior\n")]));
    const changed = await getLiveReportImplementationIdentity({ directory });
    assert.notEqual(changed.sha256, baseline.sha256, helper);
    assert.notEqual(
      changed.files.find(({ file }) => file === helper).sha256,
      baseline.files.find(({ file }) => file === helper).sha256,
    );
    assert.deepEqual(
      changed.files.filter(({ file }) => file !== helper),
      baseline.files.filter(({ file }) => file !== helper),
    );
    await assert.rejects(assertReportLocalGates(gateFile, changed), {
      code: "report_local_gates_stale",
    });
    await writeFile(target, bytes);
  }
  assert.deepEqual(await getLiveReportImplementationIdentity({ directory }), baseline);
});

test("prepare-only freezes the current report, original source hashes and implementation without a network call", async (t) => {
  const phaseAReceiptPath = await phaseAFixture(t);
  await mkdir(liveRoot, { recursive: true });
  const directory = await mkdtemp(path.join(liveRoot, "test-report-preflight-"));
  const file = path.join(directory, "protocol.json");
  t.after(async () => {
    await rm(file, { force: true });
    await rmdir(directory);
  });
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    assert.fail("Prepare-only must not reach metadata or provider transport.");
  };
  try {
    const options = {
      phaseAReceiptPath,
      outputDirectory: directory,
      caseId: "fpt-h1-friendly",
      prepareOnly: true,
    };
    const prepared = await runSecuritiesLiveReportEvaluation(options);
    const bytes = await readFile(file);
    const frozen = JSON.parse(bytes.toString("utf8"));
    assert.equal(prepared.prepared, true);
    assert.equal(networkCalls, 0);
    assert.equal(prepared.protocolHash, hash(bytes));
    assert.equal(frozen.model, "meta/muse-spark-1.3-contributor");
    assert.equal(frozen.promptVersion, "securities-evidence-guided-analyst");
    assert.equal(frozen.reportVersion, "securities-analyst-report");
    assert.equal(frozen.version, "securities-report-development");
    assert.equal(frozen.frozenAcceptance, "docs/securities-evaluation.md");
    assert.equal(
      frozen.acceptanceProtocolSha256,
      hash(await readFile(path.join(repositoryRoot, frozen.frozenAcceptance))),
    );
    assert.equal(frozen.snapshots[0].dossier.company.id, "FPT");
    assert.equal(frozen.snapshots[0].dossier.comparisonPeriod.id, "H1_2025_restated");
    assert.equal(
      frozen.snapshots[0].dossier.sources.every((source) => /^[a-f0-9]{64}$/u.test(source.hash)),
      true,
    );
    assert.equal(frozen.localGates, null);
    assert.equal(frozen.implementation.files.length >= 15, true);
    assert.equal(
      frozen.implementation.files.some(
        ({ file }) => file === "shared/securities/report-contract.js",
      ),
      true,
    );
    assert.equal(
      frozen.implementation.files.some(
        ({ file }) => file === "scripts/securities/live-receipt-costs.mjs",
      ),
      true,
    );
    assert.equal(
      frozen.implementation.files.some(({ file }) => /probe|oracle/iu.test(file)),
      false,
    );
    await assert.rejects(runSecuritiesLiveReportEvaluation(options), { code: "EEXIST" });
    assert.equal(hash(await readFile(file)), prepared.protocolHash);
    await assert.rejects(
      runSecuritiesLiveReportEvaluation({ ...options, outputDirectory: liveRoot }),
      { code: "report_output_directory_invalid" },
    );
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy evaluation cannot run current synthesis under its retired protocol", async (t) => {
  const phaseAReceiptPath = await phaseAFixture(t);
  assert.equal(SECURITIES_LIVE_EVALUATION_PROTOCOL.promptVersion, "securities-evidence-v3");
  assert.equal(SECURITIES_REPORT_EVALUATION_PROTOCOL.split, "shared_team_development_evaluation");
  assert.equal(SECURITIES_REPORT_EVALUATION_PROTOCOL.noMonetaryCap, true);
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    assert.fail("Retired synthesis must stop before the network.");
  };
  try {
    await assert.rejects(
      runSecuritiesLiveEvaluation({ phaseAReceiptPath, caseId: "fpt-annual-analysis" }),
      { code: "legacy_synthesis_protocol_retired" },
    );
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
