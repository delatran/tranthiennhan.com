import assert from "node:assert/strict";
import test from "node:test";
import {
  compareFinancialMetric,
  normalizeFinancialValue,
  reconcileReportedChange,
} from "../../shared/securities/finance.js";

// Synthetic development fixtures exercise arithmetic boundaries, not market accuracy.
const row = (current, comparison, reportedChangePct) => ({
  id: "revenue",
  unit: "VND_billion",
  current: { value: current },
  comparison: { value: comparison },
  reportedChangePct,
});

test("reported whole-percent figures allow their documented display rounding", () => {
  const metric = row(589, 575, { value: 2, displayDecimals: 0 });
  assert.equal(reconcileReportedChange(metric).status, "consistent");
  metric.reportedChangePct.displayDecimals = 1;
  assert.equal(reconcileReportedChange(metric).status, "conflict");
});

test("a reported rate with unknown precision remains an uncertainty", () => {
  assert.equal(reconcileReportedChange(row(589, 575, { value: 2 })).status, "unknown_precision");
});

test("reported-rate validation considers rounded input intervals", () => {
  const metric = row(1, 1, { value: 10, displayDecimals: 1 });
  metric.current.roundingUnit = 0.2;
  metric.comparison.roundingUnit = 0.2;
  assert.equal(reconcileReportedChange(metric).status, "consistent");
  metric.reportedChangePct.value = 90;
  assert.equal(reconcileReportedChange(metric).status, "conflict");
});

test("cell-unit conversions retain actual original inputs in the formula receipt", () => {
  const metric = row(120_000, 100_000_000_000);
  metric.current.unit = "VND_million";
  metric.comparison.unit = "VND";
  const result = compareFinancialMetric(metric);
  assert.equal(result.absoluteChange.value, 20);
  assert.equal(result.relativeChangePct.value, 20);
  assert.equal(result.absoluteChange.inputRefs[0].value, 120_000);
  assert.equal(result.absoluteChange.inputRefs[1].unit, "VND");
});

test("unsafe and malformed values fail before any arithmetic", () => {
  for (const value of [Infinity, NaN, true, "1,000", "1e9", "-", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => normalizeFinancialValue(value));
  }
});
