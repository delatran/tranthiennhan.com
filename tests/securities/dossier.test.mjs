import assert from "node:assert/strict";
import test from "node:test";
import {
  applyModelAnalysis,
  assertApprovable,
  createDossier,
  replaceDossierSources,
  reviseDossier,
} from "../../shared/securities/dossier.js";

function fixture(version = "1", verification = "verified") {
  const point = (value) => ({
    value,
    rawText: `${value},000,000`,
    originalUnit: "VND",
    sourceId: "synthetic-source",
    sourceVersion: version,
    verification,
    locator: { page: 1, precision: "cell", rowCode: "10", column: "Synthetic column" },
  });
  return {
    company: { id: "FIXTURE", ticker: "FIXTURE", name: "Synthetic dossier test" },
    period: { id: "FY2025", kind: "annual", scope: "consolidated" },
    comparisonPeriod: { id: "FY2024", kind: "annual", scope: "consolidated" },
    sources: [
      {
        id: "synthetic-source",
        companyId: "FIXTURE",
        version,
        hash: version.repeat(64),
        url: "https://example.com/synthetic.pdf",
      },
    ],
    metrics: [{ id: "revenue", unit: "VND_million", current: point(120), comparison: point(100) }],
    issues: [],
  };
}

test("source replacement produces a new reviewable draft while the approved original stays immutable", () => {
  const approved = createDossier(fixture(), { id: "dossier-fixture" });
  approved.status = "approved";
  approved.approval = { revision: 1, at: "2026-09-06T00:00:00.000Z" };
  const next = replaceDossierSources(approved, fixture("2", "needs_review"));
  assert.equal(approved.sources[0].version, "1");
  assert.equal(approved.status, "approved");
  assert.equal(next.revision, 2);
  assert.equal(next.status, "draft");
  assert.equal(next.previousAnalysis.reason, "source_version_changed");
  assert.throws(
    () =>
      assertApprovable(next, {
        expectedRevision: 2,
        requestId: "approve-fixture",
        intent: "approve_exact_revision",
      }),
    { code: "material_issues_unresolved" },
  );
});

test("source replacement cannot change the company or selected comparison implicitly", () => {
  const original = createDossier(fixture(), { id: "dossier-fixture" });
  const changed = fixture("2");
  changed.comparisonPeriod.id = "FY2023";
  assert.throws(() => replaceDossierSources(original, changed), {
    code: "source_context_mismatch",
  });
});

test("reported numeric contradictions block approval and disappear only after a checked correction reconciles them", () => {
  const data = fixture();
  data.metrics[0].reportedChangePct = { value: 30, displayDecimals: 0 };
  const original = createDossier(data, { id: "dossier-fixture" });
  assert.ok(original.issues.some((issue) => issue.code === "source_rate_conflict"));
  const next = reviseDossier(original, {
    expectedRevision: 1,
    requestId: "correction-fixture",
    changes: [
      {
        metricId: "revenue",
        periodId: "FY2025",
        value: 130,
        reason: "Checked source cell in synthetic fixture",
        sourceChecked: true,
      },
    ],
  });
  assert.equal(next.originalMetrics[0].current.rawText, "120,000,000");
  assert.equal(next.corrections[0].originalValue, 120);
  assert.equal(
    next.issues.some((issue) => issue.code === "source_rate_conflict"),
    false,
  );
  assert.equal(
    assertApprovable(next, {
      expectedRevision: 2,
      requestId: "approve-fixture",
      intent: "approve_exact_revision",
    }),
    true,
  );
});

test("a source marked partial or snippet is not acceptable evidence despite a verified cell flag", () => {
  for (const patch of [{ contentTruncated: true }, { sourceType: "search_snippet" }]) {
    const data = fixture();
    Object.assign(data.sources[0], patch);
    const dossier = createDossier(data, { id: "dossier-fixture" });
    assert.throws(
      () =>
        assertApprovable(dossier, {
          expectedRevision: 1,
          requestId: "approve-fixture",
          intent: "approve_exact_revision",
        }),
      { code: "material_issues_unresolved" },
    );
  }
});

test("a newly imported extraction is approvable only after every affected cell is explicitly verified", () => {
  const data = fixture("2", "needs_review");
  data.issues = [
    {
      id: "new-source",
      code: "source_verification_required",
      severity: "material",
      metricIds: ["revenue"],
      sourceIds: ["synthetic-source"],
      message: "Synthetic new extraction needs review",
    },
  ];
  const original = createDossier(data, { id: "dossier-fixture" });
  const changed = reviseDossier(original, {
    expectedRevision: 1,
    requestId: "correction-fixture",
    changes: [
      {
        metricId: "revenue",
        periodId: "FY2025",
        value: 120,
        reason: "Checked current synthetic source cell",
        sourceChecked: true,
      },
      {
        metricId: "revenue",
        periodId: "FY2024",
        value: 100,
        reason: "Checked prior synthetic source cell",
        sourceChecked: true,
      },
    ],
  });
  assert.equal(
    assertApprovable(changed, {
      expectedRevision: 2,
      requestId: "approve-fixture",
      intent: "approve_exact_revision",
    }),
    true,
  );
  assert.equal(
    changed.issues.find((issue) => issue.id === "new-source").resolution.method,
    "cell_verification",
  );
});

test("notes preserve AI analysis but a value, evidence resolution or source change invalidates the carried result", () => {
  const data = fixture();
  data.issues = [
    {
      id: "source-warning",
      code: "source_warning",
      severity: "warning",
      allowAcknowledgment: true,
      message: "Synthetic review note",
    },
  ];
  const first = createDossier(data, { id: "annotation-fixture" });
  const analyzed = applyModelAnalysis(first, {
    summary: "Original synthetic AI wording",
    claims: [],
    receipt: { evidenceType: "synthetic_test_fixture" },
  });
  analyzed.status = "approved";
  analyzed.approval = { revision: 2, at: "2026-09-06T00:00:00.000Z" };
  const before = JSON.stringify(analyzed);
  const annotated = reviseDossier(analyzed, {
    expectedRevision: 2,
    requestId: "annotation-fixture",
    notes: "Analyst terminology annotation",
  });
  assert.deepEqual(annotated.analysis, analyzed.analysis);
  assert.equal(annotated.previousAnalysis, analyzed.previousAnalysis);
  assert.equal(annotated.analysisLineage.generatedInRevision, 2);
  assert.equal(annotated.analysisLineage.carriedFromRevision, 2);
  assert.equal(annotated.status, "draft");
  assert.equal(annotated.approval, null);
  const reannotated = reviseDossier(annotated, {
    expectedRevision: 3,
    requestId: "annotation-second-fixture",
    notes: "Additional analyst annotation",
  });
  assert.deepEqual(reannotated.analysis, analyzed.analysis);
  assert.equal(reannotated.analysisLineage.generatedInRevision, 2);
  assert.equal(reannotated.analysisLineage.carriedFromRevision, 3);
  const amended = reviseDossier(annotated, {
    expectedRevision: 3,
    requestId: "annotation-value-fixture",
    notes: "Value was corrected too",
    changes: [
      {
        metricId: "revenue",
        periodId: "FY2025",
        value: 130,
        reason: "Source-checked synthetic correction",
        sourceChecked: true,
      },
    ],
  });
  const resolved = reviseDossier(annotated, {
    expectedRevision: 3,
    requestId: "annotation-resolution-fixture",
    resolutions: [{ issueId: "source-warning", reason: "Checked the relevant synthetic evidence" }],
  });
  const refreshed = replaceDossierSources(annotated, fixture("2"));
  for (const changed of [amended, resolved, refreshed]) {
    assert.equal(changed.analysis.origin, "rules");
    assert.equal(changed.analysisLineage, null);
    assert.equal(changed.previousAnalysis.revision, 3);
  }
  assert.equal(JSON.stringify(analyzed), before);
});
