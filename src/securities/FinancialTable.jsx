import { Button, Icon, Pill, SectionHeading } from "./ui.jsx";
import {
  dossierMetrics,
  localized,
  metricValue,
  number,
  percent,
  periodLabel,
  unitLabel,
} from "./format.js";

function DerivedMetrics({ dossier, locale, copy, controller }) {
  const derived = dossier.reportProjection?.derivedMetrics ?? [];
  const metrics = dossierMetrics(dossier);
  if (!derived.length) return null;
  const columns = [
    ["current", periodLabel(dossier.period, locale)],
    ["comparison", periodLabel(dossier.comparisonPeriod, locale)],
    [
      "percentagePointChange",
      locale === "vi" ? "Chênh lệch điểm %" : "Change in percentage points",
    ],
  ];
  return (
    <section
      className="ns-derived-metrics"
      aria-label={locale === "vi" ? "Chỉ tiêu tính từ dữ liệu" : "Metrics calculated from the data"}
    >
      <div className="ns-section-title">
        <h2>{locale === "vi" ? "Phép tính bổ sung" : "Additional calculations"}</h2>
        <Pill>{copy.calculated}</Pill>
      </div>
      <p>
        {locale === "vi"
          ? "Mở một kết quả để xem công thức, độ chính xác và từng đầu vào. Đơn vị được ghi riêng cho tỷ lệ, điểm phần trăm và giá trị tiền."
          : "Open a result for its formula, precision and source inputs. Ratios, percentage-point changes and currency values retain their own units."}
      </p>
      {derived.map((metric) => (
        <article key={metric.id} id={`ns-derived-${metric.id}`}>
          <h3>{localized(metric.label, locale)}</h3>
          <p>{localized(metric.definition, locale)}</p>
          <div className="ns-derived-values">
            {columns
              .filter(([field]) => metric[field])
              .map(([field, label]) => {
                const calculation = metric[field];
                return (
                  <details key={field}>
                    <summary>
                      <span>{label}</span>
                      <strong>
                        {calculation.status === "ok"
                          ? `${number(calculation.value, locale, 2)} ${unitLabel(calculation.unit ?? metric.unit, locale)}`
                          : "—"}
                      </strong>
                      <Icon name="plus" size={14} />
                    </summary>
                    <div>
                      <code>{calculation.formula}</code>
                      <p>
                        {copy.precision}:{" "}
                        {calculation.status === "ok"
                          ? `${calculation.exact ?? calculation.value} ${unitLabel(calculation.unit ?? metric.unit, locale)}`
                          : copy.noFormula}
                      </p>
                      <ul>
                        {(calculation.inputRefs ?? []).map((reference, index) => {
                          const input = metrics.find((item) => item.id === reference.metricId);
                          const point = input?.[reference.side];
                          const matches =
                            input &&
                            reference.sourceId &&
                            point?.sourceId === reference.sourceId &&
                            String(point.sourceVersion) === String(reference.sourceVersion);
                          const text = `${localized(input?.label ?? reference.metricId, locale)} · ${periodLabel(reference.side === "current" ? dossier.period : dossier.comparisonPeriod, locale)}: ${number(reference.value, locale, 12)} ${unitLabel(reference.unit, locale)}`;
                          return (
                            <li key={`${reference.metricId}:${reference.side}:${index}`}>
                              {matches ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    controller.getEvidence({
                                      dossierId: dossier.id,
                                      revision: dossier.revision,
                                      sourceId: reference.sourceId,
                                      sourceVersion: reference.sourceVersion,
                                      metricId: reference.metricId,
                                      period: reference.side,
                                    })
                                  }
                                >
                                  {text}
                                  <Icon name="northeast" size={14} />
                                </button>
                              ) : (
                                text
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </details>
                );
              })}
          </div>
        </article>
      ))}
    </section>
  );
}

export function FinancialTable({ dossier, locale, copy, controller }) {
  const metrics = dossierMetrics(dossier);
  const preferred =
    dossier.company?.sectorId === "banking"
      ? ["net_interest_income", "profit_before_tax", "credit_loss_provision"]
      : ["revenue", "profit_before_tax", "profit_parent"];
  const highlights = preferred
    .map((id) => metrics.find((metric) => metric.id === id))
    .filter(Boolean);
  const summary = highlights.length ? highlights : metrics.slice(0, 3);
  const openMetric = (metric, period) => {
    try {
      controller.getEvidence({
        dossierId: dossier.id,
        revision: dossier.revision,
        sourceId: metric[period]?.sourceId,
        metricId: metric.id,
        period,
      });
    } catch {
      controller.setTab("review");
    }
  };
  const statusText = (status) =>
    ({
      base_zero: locale === "vi" ? "Nền bằng 0" : "Zero base",
      base_negative: locale === "vi" ? "Nền âm" : "Negative base",
      missing_input: copy.noValue,
      incompatible_periods: locale === "vi" ? "Khác cơ sở" : "Incompatible basis",
    })[status] ?? copy.noValue;

  return (
    <section className="ns-financials ns-enter" aria-labelledby="ns-financial-title">
      <div className="ns-key-figures">
        {summary.map((metric, index) => (
          <button
            type="button"
            key={metric.id}
            onClick={() => openMetric(metric, "current")}
            aria-label={`${copy.openEvidence}: ${localized(metric.label, locale)}`}
          >
            <div className="ns-figure-heading">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <Icon name="northeast" size={16} />
            </div>
            <p>{localized(metric.label, locale)}</p>
            <strong>{number(metricValue(metric, "current"), locale)}</strong>
            <div className="ns-figure-foot">
              <span>{unitLabel(metric.unit, locale)}</span>
              <span>
                {percent(metric.calculation?.relativeChangePct?.value, locale)}{" "}
                <small>{locale === "vi" ? "so với kỳ gốc" : "vs. comparison"}</small>
              </span>
            </div>
          </button>
        ))}
      </div>

      <SectionHeading
        id="ns-financial-title"
        number="01 / DATA"
        title={copy.overview}
        text={copy.financialIntro}
      >
        <Pill dot tone="green">
          {copy.calculated}
        </Pill>
      </SectionHeading>
      <p className="ns-table-scroll-hint">
        <Icon name="arrow" size={15} />
        {locale === "vi"
          ? "Cuộn ngang bảng để xem đủ các kỳ và chênh lệch."
          : "Scroll the table horizontally for all periods and changes."}
      </p>
      <div className="ns-table-scroll" role="region" aria-label={copy.overview} tabIndex="0">
        <table className="ns-financial-table">
          <caption className="sr-only">
            {copy.overview}: {periodLabel(dossier.period, locale)} /{" "}
            {periodLabel(dossier.comparisonPeriod, locale)}. {unitLabel(metrics[0]?.unit, locale)}
          </caption>
          <thead>
            <tr>
              <th scope="col">{copy.metric}</th>
              <th scope="col">
                {periodLabel(dossier.period, locale)}
                <span>{locale === "vi" ? "Kỳ phân tích" : "Current period"}</span>
              </th>
              <th scope="col">
                {periodLabel(dossier.comparisonPeriod, locale)}
                <span>{copy.comparison}</span>
              </th>
              <th scope="col">
                {copy.absoluteChange}
                <span>{unitLabel(metrics[0]?.unit, locale)}</span>
              </th>
              <th scope="col">
                {copy.relativeChange}
                <span>%</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => (
              <tr key={metric.id}>
                <th scope="row">
                  <span>{localized(metric.label, locale)}</span>
                  <small>{unitLabel(metric.unit, locale)}</small>
                </th>
                {["current", "comparison"].map((side) => (
                  <td key={side}>
                    <button
                      className={`ns-value ${metric[side]?.corrected ? "ns-value--corrected" : ""}`}
                      type="button"
                      onClick={() => openMetric(metric, side)}
                      disabled={!metric[side]?.sourceId}
                      aria-label={`${copy.openEvidence}: ${localized(metric.label, locale)}, ${periodLabel(side === "current" ? dossier.period : dossier.comparisonPeriod, locale)}, ${number(metricValue(metric, side), locale)}`}
                    >
                      {number(metricValue(metric, side), locale)}
                      {metric[side]?.corrected ? (
                        <Icon name="edit" size={12} />
                      ) : (
                        <span
                          className={`ns-value-dot ${["verified", "user_verified"].includes(metric[side]?.verification) ? "" : "ns-value-dot--warning"}`}
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="ns-calculated-value"
                    onClick={() => openMetric(metric, "current")}
                    aria-label={`${copy.formula}: ${localized(metric.label, locale)}, ${copy.absoluteChange}`}
                  >
                    {metric.calculation?.absoluteChange?.value > 0 ? "+" : ""}
                    {number(metric.calculation?.absoluteChange?.value, locale)}
                  </button>
                </td>
                <td>
                  {metric.calculation?.relativeChangePct?.status === "ok" ? (
                    <button
                      type="button"
                      className="ns-calculated-value"
                      onClick={() => openMetric(metric, "current")}
                      aria-label={`${copy.formula}: ${localized(metric.label, locale)}, ${copy.relativeChange}`}
                    >
                      {percent(metric.calculation.relativeChangePct.value, locale)}
                    </button>
                  ) : (
                    <span className="ns-table-exception">
                      {statusText(metric.calculation?.relativeChangePct?.status)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ns-table-caption">
        <p>
          <span className="ns-value-dot" />
          {copy.verified} <span className="ns-value-dot ns-value-dot--warning" />
          {copy.needsReview} <Icon name="edit" size={12} />
          {copy.corrected}
        </p>
        <p>
          {locale === "vi"
            ? "Hiển thị tối đa 2 chữ số thập phân. Mở bằng chứng để xem đầu vào đầy đủ."
            : "Shown to a maximum of 2 decimals. Open the evidence for complete input values."}
        </p>
      </div>

      <DerivedMetrics dossier={dossier} locale={locale} copy={copy} controller={controller} />

      <section className="ns-source-strip" aria-label={copy.sourceReference}>
        <div>
          <Icon name="file" size={20} />
          <strong>{copy.sourceReference}</strong>
          <span>
            {dossier.sources?.length ?? 0}{" "}
            {locale === "en" && dossier.sources?.length === 1 ? "document" : copy.documents}
          </span>
        </div>
        {(dossier.sources ?? []).map((source) => (
          <Button
            key={`${source.id}:${source.version}`}
            variant="text"
            icon="northeast"
            onClick={() =>
              controller.getEvidence({
                dossierId: dossier.id,
                revision: dossier.revision,
                sourceId: source.id,
                sourceVersion: source.version,
              })
            }
          >
            {localized(source.title, locale)}
          </Button>
        ))}
      </section>
    </section>
  );
}
