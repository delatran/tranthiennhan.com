const UNIT_SCALE = Object.freeze({ VND: 0, VND_thousand: 3, VND_million: 6, VND_billion: 9 });
const DECIMAL = /^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/u;

export class FinancialInputError extends Error {
  constructor(code) {
    super(code);
    this.name = "FinancialInputError";
    this.code = code;
  }
}

function decimal(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string")
    throw new FinancialInputError("invalid_number");
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
  ) {
    throw new FinancialInputError("unsafe_number");
  }
  const text = String(value);
  if (!DECIMAL.test(text)) throw new FinancialInputError("invalid_number");
  const [integer, fraction = ""] = text.replace(/^-/, "").split(".");
  return {
    n: BigInt(integer + fraction) * (text.startsWith("-") ? -1n : 1n),
    scale: fraction.length,
  };
}

function pow10(scale) {
  return 10n ** BigInt(scale);
}

function decimalText(n, scale) {
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(scale + 1, "0");
  const text = scale
    ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/u, "")
    : digits;
  return `${negative && n !== 0n ? "-" : ""}${text}`;
}

function numeric(exact) {
  const value = Number(exact);
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
    throw new FinancialInputError("unsafe_result");
  return value;
}

export function normalizeFinancialValue(value) {
  const parsed = decimal(value);
  return parsed === null ? null : numeric(decimalText(parsed.n, parsed.scale));
}

export function convertUnit(value, fromUnit, toUnit) {
  const parsed = decimal(value);
  if (parsed === null) return null;
  if (fromUnit === toUnit) return numeric(decimalText(parsed.n, parsed.scale));
  if (!(fromUnit in UNIT_SCALE) || !(toUnit in UNIT_SCALE))
    throw new FinancialInputError("incompatible_units");
  const scale = parsed.scale + UNIT_SCALE[toUnit] - UNIT_SCALE[fromUnit];
  return numeric(decimalText(scale < 0 ? parsed.n * pow10(-scale) : parsed.n, Math.max(scale, 0)));
}

function subtract(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return { n: left.n * pow10(scale - left.scale) - right.n * pow10(scale - right.scale), scale };
}

function divideRounded(numerator, denominator, precision = 6) {
  const numeratorScaled = numerator.n * pow10(denominator.scale + precision);
  const denominatorScaled = denominator.n * pow10(numerator.scale);
  const sign = numeratorScaled < 0n !== denominatorScaled < 0n ? -1n : 1n;
  const a = numeratorScaled < 0n ? -numeratorScaled : numeratorScaled;
  const b = denominatorScaled < 0n ? -denominatorScaled : denominatorScaled;
  const quotient = a / b + (2n * (a % b) >= b ? 1n : 0n);
  return decimalText(sign * quotient, precision);
}

function dividePercent(numerator, denominator, precision = 6) {
  return divideRounded({ n: numerator.n * 100n, scale: numerator.scale }, denominator, precision);
}

function inputRef(metric, side, value) {
  const input = metric[side] ?? {};
  return {
    metricId: metric.id,
    side,
    value,
    unit: input.unit ?? metric.unit,
    sourceId: input.sourceId ?? null,
    sourceVersion: input.sourceVersion ?? null,
    locator: input.locator ?? null,
    correctionId: input.correctionId ?? null,
  };
}

function durationMonths(period) {
  if (period?.durationMonths) return period.durationMonths;
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(period?.start ?? "") ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(period?.end ?? "")
  )
    return null;
  const [startYear, startMonth] = period.start.split("-").map(Number);
  const [endYear, endMonth] = period.end.split("-").map(Number);
  return (endYear - startYear) * 12 + endMonth - startMonth + 1;
}

export function financialComparability(left = {}, right = {}, { period, comparisonPeriod } = {}) {
  if (
    period &&
    comparisonPeriod &&
    (period.kind !== comparisonPeriod.kind ||
      (durationMonths(period) &&
        durationMonths(comparisonPeriod) &&
        durationMonths(period) !== durationMonths(comparisonPeriod)))
  )
    return "incompatible_periods";
  for (const key of ["entityId", "scope", "basisId", "dataKind"]) {
    const a = left[key] ?? period?.[key];
    const b = right[key] ?? comparisonPeriod?.[key];
    if (a !== undefined && b !== undefined && a !== b)
      return key === "scope"
        ? "incompatible_scope"
        : key === "entityId"
          ? "incompatible_entity"
          : "incompatible_basis";
  }
  return "ok";
}

function result(status, formula, inputRefs, exact = null) {
  return {
    value: exact === null ? null : numeric(exact),
    exact,
    status,
    formula,
    inputRefs,
    rounding: "half_away_from_zero_6dp",
  };
}

export function compareFinancialMetric(metric, { period, comparisonPeriod } = {}) {
  const refs = [
    inputRef(metric, "current", metric.current?.value ?? null),
    inputRef(metric, "comparison", metric.comparison?.value ?? null),
  ];
  const absoluteFormula = "current - comparison";
  const relativeFormula = "(current - comparison) / comparison * 100";
  let current;
  let base;
  try {
    current = decimal(
      convertUnit(metric.current?.value, metric.current?.unit ?? metric.unit, metric.unit),
    );
    base = decimal(
      convertUnit(metric.comparison?.value, metric.comparison?.unit ?? metric.unit, metric.unit),
    );
  } catch (error) {
    if (error.code !== "incompatible_units") throw error;
    return {
      absoluteChange: result("incompatible_units", absoluteFormula, refs),
      relativeChangePct: result("incompatible_units", relativeFormula, refs),
    };
  }
  const compatible = financialComparability(metric.current, metric.comparison, {
    period,
    comparisonPeriod,
  });
  const status =
    compatible !== "ok" ? compatible : current === null || base === null ? "missing_input" : null;
  if (status)
    return {
      absoluteChange: result(status, absoluteFormula, refs),
      relativeChangePct: result(status, relativeFormula, refs),
    };
  const difference = subtract(current, base);
  const exactDifference = decimalText(difference.n, difference.scale);
  const relativeStatus = base.n === 0n ? "base_zero" : base.n < 0n ? "base_negative" : "ok";
  return {
    absoluteChange: result("ok", absoluteFormula, refs, exactDifference),
    relativeChangePct: result(
      relativeStatus,
      relativeFormula,
      refs,
      relativeStatus === "ok" ? dividePercent(difference, base) : null,
    ),
  };
}

export function calculateFinancialRatio(
  profit,
  revenue,
  side = "current",
  { formula = "numerator / denominator * 100", nonpositiveStatus = "nonpositive_denominator" } = {},
) {
  if (!["current", "comparison"].includes(side)) throw new FinancialInputError("invalid_side");
  const compatibility = financialComparability(profit[side], revenue[side]);
  if (
    compatibility !== "ok" ||
    (profit[side]?.periodId &&
      revenue[side]?.periodId &&
      profit[side].periodId !== revenue[side].periodId)
  )
    return result(compatibility === "ok" ? "incompatible_periods" : compatibility, formula, []);
  const numerator = decimal(profit[side]?.value);
  const rawDenominator = revenue[side]?.value;
  let denominator;
  try {
    denominator = decimal(
      convertUnit(
        rawDenominator,
        revenue[side]?.unit ?? revenue.unit,
        profit[side]?.unit ?? profit.unit,
      ),
    );
  } catch {
    return result("incompatible_units", formula, []);
  }
  const refs = [
    inputRef(profit, side, profit[side]?.value ?? null),
    inputRef(revenue, side, rawDenominator ?? null),
  ];
  const status =
    numerator === null || denominator === null
      ? "missing_input"
      : denominator.n <= 0n
        ? nonpositiveStatus
        : "ok";
  return result(
    status,
    formula,
    refs,
    status === "ok" ? dividePercent(numerator, denominator) : null,
  );
}

export function calculateMargin(profit, revenue, side = "current") {
  return calculateFinancialRatio(profit, revenue, side, {
    formula: "profit / revenue * 100",
    nonpositiveStatus: "nonpositive_revenue",
  });
}

export function reconcileReportedChange(
  metric,
  calculation = compareFinancialMetric(metric).relativeChangePct,
) {
  const reported = metric.reportedChangePct;
  if (!reported || calculation.status !== "ok") return null;
  const value = normalizeFinancialValue(reported.value);
  if (value === null) return { status: "missing_reported_rate" };
  const hasPrecision =
    Number.isInteger(reported.displayDecimals) &&
    reported.displayDecimals >= 0 &&
    reported.displayDecimals <= 6;
  const hasTolerance =
    typeof reported.tolerancePp === "number" &&
    Number.isFinite(reported.tolerancePp) &&
    reported.tolerancePp >= 0 &&
    reported.tolerancePp <= 5;
  if (!hasPrecision && !hasTolerance)
    return { status: "unknown_precision", reported: value, calculated: calculation.value };
  const tolerance = hasTolerance ? reported.tolerancePp : 0.5 * 10 ** -reported.displayDecimals;
  const current = convertUnit(
    metric.current.value,
    metric.current.unit ?? metric.unit,
    metric.unit,
  );
  const comparison = convertUnit(
    metric.comparison.value,
    metric.comparison.unit ?? metric.unit,
    metric.unit,
  );
  const aHalf =
    convertUnit(metric.current.roundingUnit ?? 0, metric.current.unit ?? metric.unit, metric.unit) /
    2;
  const bHalf =
    convertUnit(
      metric.comparison.roundingUnit ?? 0,
      metric.comparison.unit ?? metric.unit,
      metric.unit,
    ) / 2;
  if (
    ![aHalf, bHalf].every((half) => Number.isFinite(half) && half >= 0) ||
    comparison - bHalf <= 0
  )
    return { status: "unknown_precision", reported: value, calculated: calculation.value };
  const possibilities = [current - aHalf, current + aHalf].flatMap((a) =>
    [comparison - bHalf, comparison + bHalf].map((b) => ((a - b) / b) * 100),
  );
  const minimum = Math.min(...possibilities) - tolerance;
  const maximum = Math.max(...possibilities) + tolerance;
  return {
    status: value < minimum - 1e-9 || value > maximum + 1e-9 ? "conflict" : "consistent",
    reported: value,
    calculated: calculation.value,
    tolerancePp: tolerance,
    possibleRange: [minimum, maximum],
  };
}

export function reconcileProfitAttribution(total, parent, minority, side = "current") {
  const metrics = [total, parent, minority];
  if (
    !metrics.every(
      (metric) => metric?.[side]?.value !== null && metric?.[side]?.value !== undefined,
    )
  )
    return { status: "missing_input" };
  for (const metric of [parent, minority]) {
    const compatible = financialComparability(total[side], metric[side]);
    if (compatible !== "ok") return { status: compatible };
    if (
      total[side].periodId &&
      metric[side].periodId &&
      total[side].periodId !== metric[side].periodId
    )
      return { status: "incompatible_periods" };
  }
  let values;
  let tolerance;
  try {
    values = metrics.map((metric) =>
      decimal(convertUnit(metric[side].value, metric[side].unit ?? metric.unit, total.unit)),
    );
    tolerance = metrics.reduce(
      (sum, metric) =>
        sum +
        convertUnit(metric[side].roundingUnit ?? 0, metric[side].unit ?? metric.unit, total.unit) /
          2,
      0,
    );
  } catch (error) {
    if (error.code !== "incompatible_units") throw error;
    return { status: "incompatible_units" };
  }
  const sum = subtract(values[1], { ...values[2], n: -values[2].n });
  const difference = subtract(sum, values[0]);
  const exact = decimalText(difference.n, difference.scale);
  return {
    status: Math.abs(Number(exact)) > tolerance ? "conflict" : "consistent",
    difference: Number(exact),
    exact,
    tolerance,
    inputRefs: metrics.map((metric) => inputRef(metric, side, metric[side].value)),
  };
}

export function calculateDossierMetrics(metrics, context) {
  return metrics.map((metric) => ({
    ...metric,
    calculation: compareFinancialMetric(metric, context),
  }));
}

function typedResult(calculation, calculationKind, unit) {
  return { ...calculation, calculationKind, unit };
}

function differenceMetric(left, right, side) {
  const refs = [
    inputRef(left, side, left[side]?.value ?? null),
    inputRef(right, side, right[side]?.value ?? null),
  ];
  const formula = `${left.id} - ${right.id}`;
  const compatible = financialComparability(left[side], right[side]);
  const periodMismatch =
    left[side]?.periodId && right[side]?.periodId && left[side].periodId !== right[side].periodId;
  if (compatible !== "ok" || periodMismatch)
    return typedResult(
      result(periodMismatch ? "incompatible_periods" : compatible, formula, refs),
      "difference",
      left.unit,
    );
  let a;
  let b;
  try {
    a = decimal(convertUnit(left[side]?.value, left[side]?.unit ?? left.unit, left.unit));
    b = decimal(convertUnit(right[side]?.value, right[side]?.unit ?? right.unit, left.unit));
  } catch (error) {
    if (error.code !== "incompatible_units") throw error;
    return typedResult(result("incompatible_units", formula, refs), "difference", left.unit);
  }
  const delta = a === null || b === null ? null : subtract(a, b);
  return typedResult(
    result(
      delta === null ? "missing_input" : "ok",
      formula,
      refs,
      delta === null ? null : decimalText(delta.n, delta.scale),
    ),
    "difference",
    left.unit,
  );
}

function ratioPointChange(numerator, denominator, current, comparison, context) {
  const refs = [
    inputRef(numerator, "current", numerator.current?.value ?? null),
    inputRef(denominator, "current", denominator.current?.value ?? null),
    inputRef(numerator, "comparison", numerator.comparison?.value ?? null),
    inputRef(denominator, "comparison", denominator.comparison?.value ?? null),
  ];
  const formula = `(${numerator.id}.current / ${denominator.id}.current - ${numerator.id}.comparison / ${denominator.id}.comparison) * 100`;
  const failure = [
    current.status,
    comparison.status,
    financialComparability(numerator.current, numerator.comparison, context),
    financialComparability(denominator.current, denominator.comparison, context),
  ].find((status) => status !== "ok");
  if (failure)
    return typedResult(
      result(failure, formula, refs),
      "ratio_difference_percentage_points",
      "percentage_point",
    );
  // Subtract the exact rational values before rounding, rather than subtracting
  // the displayed margins. Both ratio denominators use their numerator's unit.
  const a = decimal(numerator.current.value);
  const b = decimal(
    convertUnit(
      denominator.current.value,
      denominator.current.unit ?? denominator.unit,
      numerator.current.unit ?? numerator.unit,
    ),
  );
  const c = decimal(numerator.comparison.value);
  const d = decimal(
    convertUnit(
      denominator.comparison.value,
      denominator.comparison.unit ?? denominator.unit,
      numerator.comparison.unit ?? numerator.unit,
    ),
  );
  const crossLeft = { n: a.n * d.n, scale: a.scale + d.scale };
  const crossRight = { n: c.n * b.n, scale: c.scale + b.scale };
  const difference = subtract(crossLeft, crossRight);
  const denominatorProduct = { n: b.n * d.n, scale: b.scale + d.scale };
  return typedResult(
    result("ok", formula, refs, dividePercent(difference, denominatorProduct)),
    "ratio_difference_percentage_points",
    "percentage_point",
  );
}

function profitGrowthBridge(profit, revenue, context) {
  const refs = [
    inputRef(profit, "current", profit.current?.value ?? null),
    inputRef(revenue, "current", revenue.current?.value ?? null),
    inputRef(profit, "comparison", profit.comparison?.value ?? null),
    inputRef(revenue, "comparison", revenue.comparison?.value ?? null),
  ];
  const formulas = {
    revenue_growth_effect:
      "(revenue.current - revenue.comparison) * profit_after_tax.comparison / revenue.comparison",
    margin_growth_effect:
      "(profit_after_tax.current * revenue.comparison - profit_after_tax.comparison * revenue.current) / revenue.comparison",
  };
  const definitions = {
    revenue_growth_effect: {
      vi: "Phần chênh lệch doanh thu nhân biên lợi nhuận sau thuế kỳ so sánh. Phép tách tính ảnh hưởng doanh thu trước, biên sau; đây là mô tả số học, không chứng minh nguyên nhân kinh doanh.",
      en: "Revenue change multiplied by the comparison period's net profit margin. This sequential decomposition applies revenue first and margin second; it describes arithmetic rather than establishing business causes.",
    },
    margin_growth_effect: {
      vi: "Phần thay đổi biên lợi nhuận sau thuế tính trên doanh thu hiện tại, gồm phần tương tác với thay đổi doanh thu. Cộng với phần doanh thu sẽ khớp chênh lệch lợi nhuận sau thuế, trong sai số làm tròn; không chứng minh nguyên nhân.",
      en: "The net profit margin change applied to current revenue, including its interaction with revenue change. Together with the revenue effect it reconciles to the net profit change within rounding; it does not establish causality.",
    },
  };
  const failure = [
    calculateMargin(profit, revenue, "current").status,
    calculateMargin(profit, revenue, "comparison").status,
    financialComparability(profit.current, profit.comparison, context),
    financialComparability(revenue.current, revenue.comparison, context),
  ].find((status) => status !== "ok");
  let status = failure ?? "ok";
  let values;
  if (status === "ok") {
    try {
      values = [
        [profit, "current"],
        [revenue, "current"],
        [profit, "comparison"],
        [revenue, "comparison"],
      ].map(([metric, side]) =>
        decimal(convertUnit(metric[side].value, metric[side].unit ?? metric.unit, profit.unit)),
      );
    } catch (error) {
      if (error.code !== "incompatible_units") throw error;
      status = "incompatible_units";
    }
  }
  const product = (left, right) => ({ n: left.n * right.n, scale: left.scale + right.scale });
  return ["revenue_growth_effect", "margin_growth_effect"].map((kind) => {
    let exact = null;
    if (status === "ok") {
      const [currentProfit, currentRevenue, priorProfit, priorRevenue] = values;
      const numerator =
        kind === "revenue_growth_effect"
          ? product(subtract(currentRevenue, priorRevenue), priorProfit)
          : subtract(product(currentProfit, priorRevenue), product(priorProfit, currentRevenue));
      // Keep the rational expression exact until final six-decimal rounding.
      exact = divideRounded(numerator, priorRevenue);
    }
    return {
      id:
        kind === "revenue_growth_effect"
          ? "profit_change_revenue_effect"
          : "profit_change_margin_effect",
      unit: profit.unit,
      metricIds: [profit.id, revenue.id],
      label:
        kind === "revenue_growth_effect"
          ? {
              vi: "Phần chênh lệch lợi nhuận tương ứng doanh thu, giữ biên cũ",
              en: "Profit change associated with revenue at the prior margin",
            }
          : {
              vi: "Phần chênh lệch lợi nhuận tương ứng biên trên doanh thu hiện tại",
              en: "Profit change associated with margin at current revenue",
            },
      definition: definitions[kind],
      current: typedResult(result(status, formulas[kind], refs, exact), kind, profit.unit),
      comparison: typedResult(
        result("not_applicable", "No additional earlier period is used in this decomposition.", []),
        kind,
        profit.unit,
      ),
    };
  });
}

function bankOperatingMetrics(metrics) {
  const profit = metrics.find((metric) => metric.id === "operating_profit_before_provision");
  const expenses = metrics.find((metric) => metric.id === "operating_expenses");
  if (!profit || !expenses) return [];
  const income = {
    id: "bank_total_operating_income",
    unit: profit.unit,
    metricIds: [profit.id, expenses.id],
    label: {
      vi: "Tổng thu nhập hoạt động, tính từ số liệu báo cáo",
      en: "Calculated total operating income",
    },
    definition: {
      vi: "Lợi nhuận trước dự phòng trừ chi phí hoạt động mang dấu âm trong báo cáo. Đây là số tính từ hai dòng đã đối chiếu, không phải một dòng số liệu riêng được trích từ báo cáo.",
      en: "Profit before provisions less the signed operating-expense row. Calculated from two verified rows, rather than a separately reported source row.",
    },
    current: differenceMetric(profit, expenses, "current"),
    comparison: differenceMetric(profit, expenses, "comparison"),
  };
  const ratio = (side) => {
    const denominator = income[side];
    const formula =
      "-operating_expenses / (operating_profit_before_provision - operating_expenses) * 100";
    let status = denominator.status;
    let exact = null;
    if (status === "ok") {
      const cost = decimal(
        convertUnit(expenses[side].value, expenses[side].unit ?? expenses.unit, profit.unit),
      );
      const totalIncome = decimal(denominator.exact);
      status =
        totalIncome.n <= 0n
          ? "nonpositive_denominator"
          : cost.n > 0n
            ? "invalid_expense_sign"
            : "ok";
      if (status === "ok") exact = dividePercent({ ...cost, n: -cost.n }, totalIncome);
    }
    return typedResult(
      result(status, formula, denominator.inputRefs, exact),
      "bank_cost_to_income_percent",
      "percent",
    );
  };
  return [
    income,
    {
      id: "bank_cost_to_income",
      unit: "percent",
      metricIds: [profit.id, expenses.id],
      label: {
        vi: "Chi phí hoạt động / tổng thu nhập hoạt động (CIR)",
        en: "Operating cost / total operating income (CIR)",
      },
      definition: {
        vi: "Đổi dấu dòng chi phí hoạt động rồi chia tổng thu nhập hoạt động tính từ lợi nhuận trước dự phòng trừ chi phí mang dấu âm, nhân 100. Không phải biên lãi ròng (NIM) hoặc chỉ số quy định an toàn vốn.",
        en: "Negated signed operating expenses divided by calculated total operating income, multiplied by 100. This is neither net interest margin (NIM) nor a regulatory capital measure.",
      },
      current: ratio("current"),
      comparison: ratio("comparison"),
    },
  ];
}

export function calculateDerivedMetrics(metrics, context = {}) {
  const revenue = metrics.find((metric) => metric.id === "revenue");
  const margins = !revenue
    ? []
    : ["gross_profit", "profit_before_tax", "profit_after_tax", "profit_parent"].flatMap((id) => {
        const profit = metrics.find((metric) => metric.id === id);
        if (!profit) return [];
        const names = {
          gross_profit: ["Biên lợi nhuận gộp", "Gross profit margin"],
          profit_before_tax: ["Biên lợi nhuận trước thuế", "Pretax profit margin"],
          profit_after_tax: ["Biên lợi nhuận sau thuế", "Net profit margin"],
          profit_parent: ["Lợi nhuận công ty mẹ / doanh thu", "Parent profit / revenue"],
        };
        const current = typedResult(calculateMargin(profit, revenue), "ratio_percent", "percent");
        const comparison = typedResult(
          calculateMargin(profit, revenue, "comparison"),
          "ratio_percent",
          "percent",
        );
        return [
          {
            id: `${id}_margin`,
            unit: "percent",
            metricIds: [id, "revenue"],
            label: { vi: names[id][0], en: names[id][1] },
            definition: {
              vi: "Lợi nhuận cùng kỳ chia doanh thu, nhân 100.",
              en: "Same-period profit divided by revenue, multiplied by 100.",
            },
            current,
            comparison,
            percentagePointChange: ratioPointChange(profit, revenue, current, comparison, context),
          },
        ];
      });
  const total = metrics.find((metric) => metric.id === "profit_after_tax");
  const shares = !total
    ? []
    : ["profit_parent", "profit_noncontrolling"].flatMap((id) => {
        const profit = metrics.find((metric) => metric.id === id);
        if (!profit) return [];
        const ratio = (side) =>
          typedResult(
            calculateFinancialRatio(profit, total, side, {
              formula: `${id} / profit_after_tax * 100`,
              nonpositiveStatus: "nonpositive_total_profit",
            }),
            "ratio_percent",
            "percent",
          );
        return [
          {
            id: `${id}_share`,
            unit: "percent",
            metricIds: [id, "profit_after_tax"],
            label:
              id === "profit_parent"
                ? { vi: "Tỷ trọng lợi nhuận thuộc công ty mẹ", en: "Parent share of net profit" }
                : {
                    vi: "Tỷ trọng lợi ích cổ đông không kiểm soát",
                    en: "Noncontrolling share of net profit",
                  },
            definition: {
              vi: "Lợi nhuận phân bổ chia tổng lợi nhuận sau thuế cùng kỳ, nhân 100.",
              en: "Attributed profit divided by total same-period net profit, multiplied by 100.",
            },
            current: ratio("current"),
            comparison: ratio("comparison"),
          },
        ];
      });
  const parent = metrics.find((metric) => metric.id === "profit_parent");
  const attribution =
    total && parent
      ? [
          {
            id: "inferred_noncontrolling_profit",
            unit: total.unit,
            metricIds: [total.id, parent.id],
            label: {
              vi: "Lợi nhuận cổ đông khác, suy ra từ phân bổ",
              en: "Other shareholders' profit, inferred from attribution",
            },
            definition: {
              vi: "Tổng lợi nhuận sau thuế trừ phần thuộc cổ đông công ty mẹ. Đây là phép suy ra kế toán, không phải giải thích nguyên nhân khoản lỗ.",
              en: "Consolidated profit after tax less the parent shareholders' allocation. This accounting inference does not establish why a loss occurred.",
            },
            current: differenceMetric(total, parent, "current"),
            comparison: differenceMetric(total, parent, "comparison"),
          },
        ]
      : [];
  const ratios = [
    {
      id: "operating_cash_flow_to_profit",
      numerator: "operating_cash_flow",
      denominator: "profit_after_tax",
      label: {
        vi: "Dòng tiền kinh doanh / lợi nhuận sau thuế",
        en: "Operating cash flow / profit after tax",
      },
      definition: {
        vi: "Dòng tiền kinh doanh chia lợi nhuận sau thuế cùng kỳ, nhân 100. Chỉ là chỉ dấu chuyển đổi lợi nhuận thành tiền trong kỳ.",
        en: "Same-period operating cash flow divided by profit after tax, multiplied by 100. A period cash-conversion indicator only.",
      },
    },
    {
      id: "disposal_gain_share_of_financial_income",
      numerator: "disposal_gain",
      denominator: "financial_income",
      label: {
        vi: "Lãi chuyển nhượng / doanh thu tài chính",
        en: "Disposal gain / financial income",
      },
      definition: {
        vi: "Lãi chuyển nhượng chia doanh thu tài chính cùng kỳ, nhân 100. Không phải tỷ lệ lãi chuyển nhượng trong tổng lợi nhuận hay tiền thu về.",
        en: "Same-period disposal gain divided by financial income, multiplied by 100. It is not a share of total profit or cash proceeds.",
      },
    },
  ].flatMap((descriptor) => {
    const numerator = metrics.find((metric) => metric.id === descriptor.numerator);
    const denominator = metrics.find((metric) => metric.id === descriptor.denominator);
    if (!numerator || !denominator) return [];
    const ratio = (side) =>
      typedResult(
        calculateFinancialRatio(numerator, denominator, side, {
          formula: `${numerator.id} / ${denominator.id} * 100`,
        }),
        "ratio_percent",
        "percent",
      );
    return [
      {
        id: descriptor.id,
        unit: "percent",
        metricIds: [numerator.id, denominator.id],
        label: descriptor.label,
        definition: descriptor.definition,
        current: ratio("current"),
        comparison: ratio("comparison"),
      },
    ];
  });
  const bridge = total && revenue ? profitGrowthBridge(total, revenue, context) : [];
  return [
    ...bankOperatingMetrics(metrics),
    ...margins,
    ...shares,
    ...attribution,
    ...ratios,
    ...bridge,
  ];
}
