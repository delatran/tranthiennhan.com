import assert from "node:assert/strict";
import test from "node:test";
import { calculateDerivedMetrics } from "../../shared/securities/finance.js";

// Source values reproduce the independently frozen FPT/GMD oracle. Mutations
// below are synthetic faults, not additional observed issuer results.
function metric(id, current, comparison, unit = "VND") {
  const point = (value, periodId) => ({
    value,
    unit,
    periodId,
    entityId: "issuer",
    scope: "consolidated",
    basisId: "comparable",
    dataKind: "actual",
    sourceId: "original",
    sourceVersion: "sha256:" + "a".repeat(64),
    locator: { page: 18, rowLabel: id },
  });
  return {
    id,
    unit,
    current: point(current, "current"),
    comparison: point(comparison, "comparison"),
  };
}
const select = (metrics, id, context) =>
  calculateDerivedMetrics(metrics, context).find((entry) => entry.id === id);

test("annual gross and net margin changes distinguish percentage points from growth", () => {
  const rows = [
    metric("revenue", "70112825100710", "62848794351367"),
    metric("gross_profit", "25888529512413", "23698348369916"),
    metric("profit_after_tax", "11232339450734", "9427422530444"),
  ];
  const gross = select(rows, "gross_profit_margin");
  const net = select(rows, "profit_after_tax_margin");
  assert.equal(gross.current.exact, "36.9241");
  assert.equal(gross.comparison.exact, "37.706926");
  assert.equal(gross.percentagePointChange.exact, "-0.782826");
  assert.equal(net.percentagePointChange.exact, "1.020213");
  assert.equal(gross.percentagePointChange.unit, "percentage_point");
  assert.equal(gross.percentagePointChange.calculationKind, "ratio_difference_percentage_points");
  assert.deepEqual(
    gross.percentagePointChange.inputRefs.map((ref) => [ref.metricId, ref.side]),
    [
      ["gross_profit", "current"],
      ["revenue", "current"],
      ["gross_profit", "comparison"],
      ["revenue", "comparison"],
    ],
  );
});

test("interim PAT margin is distinct from parent-attributable margin", () => {
  const rows = [
    metric("revenue", "26268500667974", "23325685794923"),
    metric("profit_after_tax", "5047128933102", "4427462420799"),
    metric("profit_parent", "5054958601533", "4431763974648"),
  ];
  const net = select(rows, "profit_after_tax_margin");
  assert.equal(net.current.exact, "19.213616");
  assert.equal(net.comparison.exact, "18.98106");
  assert.equal(net.percentagePointChange.exact, "0.232556");
  assert.notEqual(select(rows, "profit_parent_margin").current.exact, net.current.exact);
});

test("negative non-controlling allocation is a sourced-input accounting inference", () => {
  const rows = [
    metric("profit_after_tax", "5047128933102", "4427462420799"),
    metric("profit_parent", "5054958601533", "4431763974648"),
  ];
  const inferred = select(rows, "inferred_noncontrolling_profit");
  assert.equal(inferred.current.exact, "-7829668431");
  assert.equal(inferred.comparison.exact, "-4301553849");
  assert.equal(inferred.current.calculationKind, "difference");
  assert.equal(inferred.current.unit, "VND");
  assert.equal(inferred.current.inputRefs[1].sourceVersion, rows[1].current.sourceVersion);
  assert.equal(inferred.current.formula, "profit_after_tax - profit_parent");
});

test("mixed monetary units retain originals and produce the same attribution difference", () => {
  const total = metric("profit_after_tax", "5047128.933102", null, "VND_million");
  const parent = metric("profit_parent", "5054.958601533", null, "VND_billion");
  const inferred = select([total, parent], "inferred_noncontrolling_profit");
  assert.equal(inferred.current.exact, "-7829.668431");
  assert.equal(inferred.current.inputRefs[1].unit, "VND_billion");
  assert.equal(inferred.comparison.status, "missing_input");
});

test("negative operating cash conversion is valid and an incompatible prior basis is excluded", () => {
  const cash = metric("operating_cash_flow", "-1145666005788", "1683573278329");
  const profit = metric("profit_after_tax", "5047128933102", "4427462420799");
  cash.comparison.basisId = "original_full_consolidation";
  cash.comparison.periodId = "comparison_reported";
  const ratio = select([cash, profit], "operating_cash_flow_to_profit");
  assert.equal(ratio.current.exact, "-22.699361");
  assert.equal(ratio.current.calculationKind, "ratio_percent");
  assert.equal(ratio.comparison.status, "incompatible_basis");
  assert.equal(ratio.comparison.value, null);
});

test("disposal gain share uses financial income and keeps an absent comparator null", () => {
  const rows = [
    metric("disposal_gain", "599837509022", null),
    metric("financial_income", "749692570788", "91517551504"),
    metric("profit_after_tax", "1938610299268", "1131775875175"),
  ];
  const ratio = select(rows, "disposal_gain_share_of_financial_income");
  assert.equal(ratio.current.exact, "80.011132");
  assert.equal(ratio.current.inputRefs[1].metricId, "financial_income");
  assert.equal(ratio.comparison.status, "missing_input");
  assert.equal(ratio.comparison.value, null);
});

test("point-change calculation does not compound displayed margin rounding", () => {
  const rows = [
    metric("gross_profit", "20000003", "20000002"),
    metric("revenue", "100000000", "100000000"),
  ];
  const delta = select(rows, "gross_profit_margin").percentagePointChange;
  assert.equal(delta.exact, "0.000001");
});

test("same-period ratios do not imply comparable growth across reporting durations", () => {
  const rows = [metric("profit_after_tax", "30", "10"), metric("revenue", "100", "50")];
  const context = {
    period: { kind: "half_year", durationMonths: 6 },
    comparisonPeriod: { kind: "quarter", durationMonths: 3 },
  };
  const margin = select(rows, "profit_after_tax_margin", context);
  assert.equal(margin.current.status, "ok");
  assert.equal(margin.percentagePointChange.status, "incompatible_periods");
  assert.equal(margin.percentagePointChange.value, null);
});

test("derived arithmetic rejects wrong entity, scope, accounting basis and period", () => {
  for (const [key, value, expected] of [
    ["entityId", "different", "incompatible_entity"],
    ["scope", "separate", "incompatible_scope"],
    ["basisId", "other", "incompatible_basis"],
    ["periodId", "other", "incompatible_periods"],
  ]) {
    const rows = [metric("profit_after_tax", "50", "40"), metric("profit_parent", "45", "30")];
    rows[1].current[key] = value;
    assert.equal(select(rows, "inferred_noncontrolling_profit").current.status, expected);
  }
});

test("zero and negative profit denominators do not become ordinary cash conversion", () => {
  for (const denominator of [0, -1]) {
    const ratio = select(
      [metric("operating_cash_flow", "10", null), metric("profit_after_tax", denominator, null)],
      "operating_cash_flow_to_profit",
    );
    assert.equal(ratio.current.status, "nonpositive_denominator");
    assert.equal(ratio.current.value, null);
  }
});

test("wrong units cannot become a margin point change or monetary difference", () => {
  const rows = [metric("profit_after_tax", "50", "40"), metric("profit_parent", "45", "30")];
  rows[1].current.unit = "USD";
  assert.equal(select(rows, "inferred_noncontrolling_profit").current.status, "incompatible_units");
  const revenue = metric("revenue", "100", "80");
  revenue.comparison.unit = "USD";
  assert.equal(
    select([rows[0], revenue], "profit_after_tax_margin").percentagePointChange.status,
    "incompatible_units",
  );
});

test("PAT growth bridge matches the independently scored first-probe arithmetic", () => {
  const rows = [
    metric("revenue", "26268500667974", "23325685794923"),
    metric("profit_after_tax", "5047128933102", "4427462420799"),
  ];
  const revenue = select(rows, "profit_change_revenue_effect");
  const margin = select(rows, "profit_change_margin_effect");
  // This regression follows the preserved failed first run. It is not a blind test.
  assert.equal(revenue.current.exact, "558577457329.789638");
  assert.equal(margin.current.exact, "61089054973.210362");
  assert.equal(revenue.current.calculationKind, "revenue_growth_effect");
  assert.equal(margin.current.calculationKind, "margin_growth_effect");
  assert.equal(revenue.current.unit, "VND");
  assert.equal(revenue.comparison.status, "not_applicable");
  assert.equal(revenue.comparison.value, null);
  assert.deepEqual(
    revenue.current.inputRefs.map((ref) => [ref.metricId, ref.side]),
    [
      ["profit_after_tax", "current"],
      ["revenue", "current"],
      ["profit_after_tax", "comparison"],
      ["revenue", "comparison"],
    ],
  );
  assert.deepEqual(revenue.current.inputRefs, margin.current.inputRefs);
  assert.ok(
    revenue.current.inputRefs.every((ref) => ref.sourceVersion === "sha256:" + "a".repeat(64)),
  );
});

test("PAT bridge normalizes each original unit before multiplying or dividing", () => {
  const profit = metric("profit_after_tax", "5047128.933102", "4427462.420799", "VND_million");
  const revenue = metric("revenue", "26268.500667974", "23325.685794923", "VND_billion");
  profit.current.value = "5047128933102";
  profit.current.unit = "VND";
  revenue.comparison.value = "23325685794.923";
  revenue.comparison.unit = "VND_thousand";
  const rows = [profit, revenue];
  assert.equal(select(rows, "profit_change_revenue_effect").current.exact, "558577.45733");
  const margin = select(rows, "profit_change_margin_effect");
  assert.equal(margin.current.exact, "61089.054973");
  assert.equal(margin.current.unit, "VND_million");
  assert.deepEqual(
    margin.current.inputRefs.map((ref) => ref.unit),
    ["VND", "VND_billion", "VND_million", "VND_thousand"],
  );
});

test("PAT bridge reconciles losses, falling revenue, unchanged margins and fractional results", () => {
  for (const [
    currentProfit,
    priorProfit,
    currentRevenue,
    priorRevenue,
    revenueEffect,
    marginEffect,
  ] of [
    [35, 20, 100, 80, 5, 10],
    [-5, 20, 100, 80, 5, -30],
    [30, 20, 80, 80, 0, 10],
    [15, 20, 60, 80, -5, 0],
    [2, 1, 4, 3, 0.333333, 0.666667],
    [-1, -2, 4, 3, -0.666667, 1.666667],
  ]) {
    const rows = [
      metric("profit_after_tax", currentProfit, priorProfit),
      metric("revenue", currentRevenue, priorRevenue),
    ];
    const revenue = select(rows, "profit_change_revenue_effect").current;
    const margin = select(rows, "profit_change_margin_effect").current;
    assert.equal(revenue.status, "ok");
    assert.equal(margin.status, "ok");
    assert.equal(revenue.value, revenueEffect);
    assert.equal(margin.value, marginEffect);
    assert.ok(Math.abs(revenue.value + margin.value - (currentProfit - priorProfit)) <= 0.000001);
  }
});

test("PAT bridge rejects invalid denominators, incomplete inputs and incompatible provenance", () => {
  const makeRows = () => [metric("profit_after_tax", 35, 20), metric("revenue", 100, 80)];
  for (const value of [0, -1, null]) {
    const rows = makeRows();
    rows[1].comparison.value = value;
    for (const id of ["profit_change_revenue_effect", "profit_change_margin_effect"]) {
      const bridge = select(rows, id);
      assert.equal(bridge.current.value, null);
      assert.equal(bridge.current.status, value === null ? "missing_input" : "nonpositive_revenue");
    }
  }
  for (const [key, value, expected] of [
    ["entityId", "different", "incompatible_entity"],
    ["scope", "separate", "incompatible_scope"],
    ["basisId", "other", "incompatible_basis"],
    ["periodId", "other", "incompatible_periods"],
    ["unit", "USD", "incompatible_units"],
  ]) {
    const rows = makeRows();
    rows[1].comparison[key] = value;
    assert.equal(select(rows, "profit_change_revenue_effect").current.status, expected);
    assert.equal(select(rows, "profit_change_margin_effect").current.value, null);
  }
  const context = {
    period: { kind: "half_year", durationMonths: 6 },
    comparisonPeriod: { kind: "quarter", durationMonths: 3 },
  };
  assert.equal(
    select(makeRows(), "profit_change_revenue_effect", context).current.status,
    "incompatible_periods",
  );
});
