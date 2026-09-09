import { Button, Icon, Pill } from "./ui.jsx";
import {
  companyLabel,
  date,
  localized,
  periodLabel,
  safeSourceUrl,
  scopeLabel,
  sourceTypeLabel,
  unitLabel,
} from "./format.js";

export function ScopeConfirmation({ state, controller, copy }) {
  const { scope, locale, busy } = state;
  if (!scope) return null;
  const sources = scope.sources ?? [];
  const enabled = state.catalog?.runtime?.model?.enabled ?? state.catalog?.model?.enabled ?? false;
  const warnings = scope.warnings ?? scope.issues ?? [];
  const company = state.catalog?.companies?.find((item) => item.id === scope.company.id);
  const periods = company?.periods ?? [];
  const selectedPeriod = periods.find((period) => period.id === scope.period.id);
  const comparisons = selectedPeriod?.comparisonOptions?.length
    ? selectedPeriod.comparisonOptions
    : [scope.comparisonPeriod].filter(Boolean);
  const changeSelection = (input) => {
    void controller
      .configureScope({ companyId: scope.company.id, periodId: scope.period.id, ...input })
      .catch(() => {});
  };
  return (
    <section className="ns-scope ns-enter" aria-labelledby="ns-scope-title">
      <Button variant="text" icon="back" onClick={() => controller.newResearch()}>
        {copy.back}
      </Button>
      <div className="ns-scope-heading">
        <p className="ns-eyebrow">01 / {copy.scope}</p>
        <h1 id="ns-scope-title" tabIndex="-1">
          {copy.scopeTitle}
        </h1>
        <p>{copy.scopeIntro}</p>
      </div>
      {scope.query ? (
        <blockquote className="ns-scope-question">
          <Icon name="quote" size={22} />
          <p>{scope.query}</p>
        </blockquote>
      ) : null}
      <div className="ns-scope-grid">
        <div className="ns-scope-identity">
          <span>{copy.company}</span>
          <strong>
            {scope.company?.ticker ?? scope.company?.symbol ?? scope.company?.id?.toUpperCase()}
          </strong>
          <p>{companyLabel(scope.company, locale)}</p>
        </div>
        <dl className="ns-scope-facts">
          <div>
            <dt>
              <label htmlFor="ns-confirm-period">{copy.period}</label>
            </dt>
            <dd>
              <select
                id="ns-confirm-period"
                value={scope.period.id}
                disabled={Boolean(busy)}
                onChange={(event) => changeSelection({ periodId: event.target.value })}
              >
                {(periods.length ? periods : [scope.period]).map((period) => (
                  <option value={period.id} key={period.id}>
                    {periodLabel(period, locale)}
                  </option>
                ))}
              </select>
            </dd>
          </div>
          <div>
            <dt>
              <label htmlFor="ns-confirm-comparison">{copy.comparison}</label>
            </dt>
            <dd>
              <select
                id="ns-confirm-comparison"
                value={scope.comparisonPeriod?.id ?? ""}
                disabled={Boolean(busy) || !comparisons.length}
                onChange={(event) => changeSelection({ comparisonPeriodId: event.target.value })}
              >
                {comparisons.map((period) => (
                  <option value={period.id} key={period.id}>
                    {periodLabel(period, locale)}
                  </option>
                ))}
              </select>
            </dd>
          </div>
          <div>
            <dt>{copy.accounting}</dt>
            <dd>
              {scopeLabel(scope.period?.scope ?? scope.accountingScope ?? scope.scope, locale) ||
                "—"}
            </dd>
          </div>
          <div>
            <dt>{locale === "vi" ? "Đơn vị tài liệu nguồn" : "Source document unit"}</dt>
            <dd>{unitLabel(sources[0]?.unit ?? scope.unit, locale) || "—"}</dd>
          </div>
        </dl>
      </div>
      {scope.comparisonBasis ? (
        <p className="ns-comparison-basis">
          <Icon name="book" size={16} />
          {localized(scope.comparisonBasis, locale)}
        </p>
      ) : null}
      <div className="ns-section-title">
        <h2>{copy.sources}</h2>
        <span>
          {sources.length} {locale === "en" && sources.length === 1 ? "document" : copy.documents}
        </span>
      </div>
      <div className="ns-scope-sources">
        {sources.map((source, index) => (
          <article key={source.id}>
            <span className="ns-source-index">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <h3>{localized(source.title, locale)}</h3>
              <p>
                {source.publishedAt
                  ? `${copy.published} ${date(source.publishedAt, locale)}`
                  : copy.unknownDate}{" "}
                · {copy.fetched} {date(source.fetchedAt, locale)}
              </p>
              <div className="ns-source-tags">
                <Pill>{scopeLabel(source.scope, locale)}</Pill>
                {source.auditStatus ? <Pill>{scopeLabel(source.auditStatus, locale)}</Pill> : null}
                <Pill>{sourceTypeLabel(source.sourceType, locale) || "PDF"}</Pill>
              </div>
            </div>
            {safeSourceUrl(source) ? (
              <a
                className="ns-icon-button"
                href={safeSourceUrl(source)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${copy.openOriginal}: ${localized(source.title, locale)}`}
              >
                <Icon name="northeast" size={21} />
              </a>
            ) : null}
          </article>
        ))}
        {!sources.length ? <p className="ns-empty-note">{copy.noSource}</p> : null}
      </div>
      <div className="ns-source-note">
        <Icon name="history" size={18} />
        <p>
          <strong>{copy.frozen}.</strong>{" "}
          {localized(scope.freshness?.message ?? scope.freshness?.note, locale) || copy.frozenNote}
        </p>
      </div>
      {warnings.length ? (
        <div className="ns-scope-warnings">
          {warnings.map((warning, index) => (
            <p key={warning.id ?? index}>
              <Icon name="warning" size={18} />
              {localized(warning.message ?? warning, locale)}
            </p>
          ))}
        </div>
      ) : null}
      <div className="ns-scope-actions">
        <p>{copy.steps[0].text}</p>
        <Button
          variant="primary"
          icon="arrow"
          disabled={Boolean(busy) || scope.ready === false || !sources.length}
          onClick={() => {
            void (
              enabled
                ? controller.startResearch({
                    companyId: scope.company.id,
                    periodId: scope.period.id,
                    comparisonPeriodId: scope.comparisonPeriod?.id,
                    ...(scope.query ? { query: scope.query } : {}),
                  })
                : controller.createDossier()
            ).catch(() => {});
          }}
        >
          {busy ? copy.working : enabled ? copy.analyze : copy.createDossier}
        </Button>
      </div>
    </section>
  );
}
