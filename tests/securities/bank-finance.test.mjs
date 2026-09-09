import assert from "node:assert/strict";
import test from "node:test";
import { calculateDerivedMetrics } from "../../shared/securities/finance.js";

// These regression values follow the independently inspected ACB H1 2026
// signed and searchable income statements. Fault mutations are synthetic.
function row(id, current, comparison, unit = "VND_million") {
  const point = (value, periodId) => ({
    value,
    unit,
    periodId,
    entityId: "bank",
    scope: "consolidated",
    basisId: "reported",
    dataKind: "actual",
    sourceId: "original",
    sourceVersion: "sha256:" + "a".repeat(64),
    locator: { page: 10, rowLabel: id },
  });
  return { id, unit, current: point(current, "H1_2026"), comparison: point(comparison, "H1_2025") };
}
const rows = () => [
  row("operating_profit_before_provision", 12481235, 11779120),
  row("operating_expenses", -5566330, -5428052),
  row("profit_after_tax", 8612866, 8559425),
  row("bank_operating_cash_flow", -42374834, -9800290),
];
const find = (metrics, id) => calculateDerivedMetrics(metrics).find((entry) => entry.id === id);

test("bank income and CIR preserve the reported expense sign and original source inputs", () => {
  const metrics = rows();
  const income = find(metrics, "bank_total_operating_income");
  const cir = find(metrics, "bank_cost_to_income");
  assert.equal(income.current.exact, "18047565");
  assert.equal(income.comparison.exact, "17207172");
  assert.equal(cir.current.exact, "30.842554");
  assert.equal(cir.comparison.exact, "31.545288");
  assert.equal(cir.current.calculationKind, "bank_cost_to_income_percent");
  assert.deepEqual(
    cir.current.inputRefs.map(({ metricId, value, unit }) => [metricId, value, unit]),
    [
      ["operating_profit_before_provision", 12481235, "VND_million"],
      ["operating_expenses", -5566330, "VND_million"],
    ],
  );
  assert.ok(
    cir.current.inputRefs.every((ref) => ref.sourceId === "original" && ref.locator.page === 10),
  );
  assert.equal(find(metrics, "operating_cash_flow_to_profit"), undefined);
  assert.equal(find(metrics, "profit_after_tax_margin"), undefined);
  assert.equal(find(metrics, "profit_change_revenue_effect"), undefined);
});

test("bank derived values convert mixed units without rewriting the original inputs", () => {
  const metrics = rows();
  metrics[1].current.value = -5566.33;
  metrics[1].current.unit = "VND_billion";
  const cir = find(metrics, "bank_cost_to_income");
  assert.equal(cir.current.exact, "30.842554");
  assert.equal(cir.current.inputRefs[1].value, -5566.33);
  assert.equal(cir.current.inputRefs[1].unit, "VND_billion");
});

test("bank CIR excludes missing, incompatible, nonpositive-income and unsigned-expense inputs", () => {
  const faults = [
    ["value", null, "missing_input"],
    ["unit", "USD", "incompatible_units"],
    ["scope", "separate", "incompatible_scope"],
    ["entityId", "other", "incompatible_entity"],
    ["basisId", "restated", "incompatible_basis"],
    ["periodId", "FY_2025", "incompatible_periods"],
    ["value", 100, "invalid_expense_sign"],
  ];
  for (const [key, value, status] of faults) {
    const metrics = rows();
    metrics[1].current[key] = value;
    const result = find(metrics, "bank_cost_to_income").current;
    assert.equal(result.status, status);
    assert.equal(result.value, null);
    assert.equal(result.exact, null);
  }
  for (const profit of [-5566330, -6000000]) {
    const metrics = rows();
    metrics[0].current.value = profit;
    assert.equal(find(metrics, "bank_cost_to_income").current.status, "nonpositive_denominator");
  }
  assert.equal(find([rows()[0]], "bank_total_operating_income"), undefined);
});
