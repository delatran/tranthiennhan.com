import { useState } from "react";
import { Button, Icon } from "./ui.jsx";
import { companyLabel, date, localized, periodLabel, scopeLabel } from "./format.js";
import { researchInput } from "./controller.js";
import { MarketWorkspace } from "./MarketWorkspace.jsx";
import { ModelProcess } from "./ModelProcess.jsx";
import {
  findProcessedCompany,
  StockPicker,
  StockSelectionDetails,
  stockKey,
  useStockDirectory,
} from "./StockPicker.jsx";
import { PublicResearchResults } from "./investor/PublicResearchResults.jsx";
import { usePublicResearch } from "./investor/publicResearch.js";
import { InvestorIntents } from "./investor/InvestorIntents.jsx";
import { investorCopy, investorQuestion, researchMode } from "./investor/investorIntents.js";
import { Watchlist } from "./investor/Watchlist.jsx";
import { useWatchlist } from "./investor/watchlist.js";

function companyStock(company) {
  return company
    ? {
        symbol: company.ticker ?? company.id,
        exchange: company.exchange,
        name: companyLabel(company, "vi"),
        nameEn: companyLabel(company, "en"),
        securityType: "stock",
        status: "listed",
      }
    : null;
}

export function stocksWithCatalogNames(items = [], companies = []) {
  return items.map((stock) => {
    const company = findProcessedCompany(companies, stock);
    return company
      ? { ...stock, name: companyLabel(company, "vi"), nameEn: companyLabel(company, "en") }
      : stock;
  });
}

const DEFAULT_EXAMPLE_STOCK = Object.freeze({
  symbol: "ACB",
  exchange: "HOSE",
  securityType: "stock",
  status: "listed",
});

export function resolveStartSelection(
  state,
  explicitStock,
  { periodId = "", comparisonId = "" } = {},
) {
  const catalog = state.catalog,
    companies = catalog?.companies ?? [];
  const scopeCompanyId = state.scope?.company?.id ?? state.scope?.companyId;
  const persistedCompany =
    companies.find((company) => company.id === state.researchDraft?.companyId) ??
    companies.find((company) => company.id === scopeCompanyId) ??
    companies.find((company) => company.id === state.researchDraft?.defaultScope?.companyId);
  const stock = explicitStock ?? companyStock(persistedCompany) ?? DEFAULT_EXAMPLE_STOCK,
    company = findProcessedCompany(companies, stock);
  if (!company)
    return {
      stock,
      company: null,
      periods: [],
      period: null,
      comparisons: [],
      comparison: null,
      selection: null,
    };
  const periods = company.periods ?? [],
    useSaved = !explicitStock;
  const savedScope = useSaved && scopeCompanyId === company.id ? state.scope : null;
  const savedDraft =
    useSaved && state.researchDraft?.defaultScope?.companyId === company.id
      ? state.researchDraft.defaultScope
      : null;
  const period =
    periods.find((item) => item.id === periodId) ??
    periods.find((item) => item.id === (savedScope?.period?.id ?? savedScope?.periodId)) ??
    periods.find((item) => item.id === savedDraft?.periodId) ??
    periods.find((item) => item.id === catalog?.defaultPeriodId) ??
    periods[0];
  const comparisons = period?.comparisonOptions ?? [];
  const comparison =
    comparisons.find((item) => item.id === comparisonId) ??
    comparisons.find(
      (item) => item.id === (savedScope?.comparisonPeriod?.id ?? savedScope?.comparisonPeriodId),
    ) ??
    comparisons.find((item) => item.id === savedDraft?.comparisonPeriodId) ??
    comparisons.find((item) => item.id === period?.comparisonPeriodId) ??
    comparisons[0];
  return {
    stock,
    company,
    periods,
    period,
    comparisons,
    comparison,
    selection: {
      companyId: company.id,
      periodId: period?.id,
      comparisonPeriodId: comparison?.id ?? period?.comparisonPeriodId,
    },
  };
}

export function StartWorkspace({ state, controller, copy }) {
  const [customQuestion, setCustomQuestion] = useState(state.researchDraft?.query ?? null);
  const [explicitStock, setExplicitStock] = useState(null),
    [intent, setIntent] = useState("business");
  const [periodId, setPeriodId] = useState(state.researchDraft?.periodId ?? "");
  const [comparisonId, setComparisonId] = useState(state.researchDraft?.comparisonPeriodId ?? "");
  const { locale, catalog, busy } = state,
    companies = catalog?.companies ?? [];
  const directory = useStockDirectory(),
    watchlist = useWatchlist();
  const displayDirectory = directory.packet
    ? {
        ...directory,
        packet: {
          ...directory.packet,
          items: stocksWithCatalogNames(directory.packet.items, companies),
        },
      }
    : directory;
  const displayWatchlist = {
    ...watchlist,
    items: stocksWithCatalogNames(watchlist.items, companies),
  };
  const resolved = resolveStartSelection(state, explicitStock, { periodId, comparisonId });
  const { stock, company, periods, period, comparisons, comparison } = resolved;
  const labels = investorCopy(locale, company?.sectorId);
  const questionPlaceholder =
    company?.sectorId === "banking"
      ? locale === "vi"
        ? "Ví dụ: Thu nhập lãi thuần và dự phòng ảnh hưởng thế nào đến lợi nhuận?"
        : "For example: How do net interest income and provisions affect profit?"
      : copy.questionPlaceholder;
  const directoryStock = directory.packet?.items?.find(
    (item) => stockKey(item) === stockKey(stock),
  );
  const detailedStock = company
    ? { ...directoryStock, ...companyStock(company) }
    : (directoryStock ?? stock);
  const mode = researchMode(intent, company),
    isPublic = mode === "public";
  const suggestedQuestion = investorQuestion({
    intent,
    stock,
    period,
    comparison,
    locale,
    mode,
    sectorId: company?.sectorId,
  });
  const question = customQuestion ?? suggestedQuestion;
  const enabled = catalog?.runtime?.model?.enabled ?? catalog?.model?.enabled ?? false;
  const publicResearch = usePublicResearch({
    security: stock,
    query: question,
    locale,
    enabled,
    active: isPublic,
  });
  const searching = publicResearch.status === "loading";
  const activeJob =
    state.job && ["queued", "running", "pending", "started"].includes(state.job.status);
  const disabled = Boolean(busy || activeJob || searching);
  const selection = resolved.selection
    ? researchInput(question, resolved.selection, resolved.selection)
    : null;
  const act = (promise) => {
    void promise.catch(() => {});
  };
  const selectStock = (next) => {
    setExplicitStock(next);
    setPeriodId("");
    setComparisonId("");
    setCustomQuestion(null);
  };
  const submit = (event) => {
    event.preventDefault();
    if (disabled || !enabled || !stock) return;
    if (!isPublic && company && period && selection) act(controller.startResearch(selection));
    else if (stock.exchange) void publicResearch.search(question);
  };

  return (
    <div className="ns-start ns-enter ns-investor-start">
      <header className="ns-start-heading">
        <p className="ns-eyebrow">
          <span className="ns-small-rule" />
          {copy.eyebrow}
        </p>
        <h1 id="ns-title" tabIndex="-1">
          {copy.startTitle}
        </h1>
        <p>{copy.startIntro}</p>
      </header>
      <form className="ns-research-input ns-investor-research" onSubmit={submit}>
        <div className="ns-investor-selection" id="ns-source-catalog">
          <StockPicker
            selected={detailedStock}
            directory={displayDirectory}
            locale={locale}
            id="ns-start-company"
            label={copy.company}
            disabled={disabled}
            onSelect={selectStock}
          />
          <Watchlist
            watchlist={displayWatchlist}
            selected={detailedStock}
            onSelect={selectStock}
            locale={locale}
            disabled={disabled}
          />
        </div>
        <InvestorIntents
          selected={intent}
          locale={locale}
          sectorId={company?.sectorId}
          disabled={disabled}
          onSelect={(next) => {
            setIntent(next);
            setCustomQuestion(null);
          }}
        />
        <div className="ns-investor-question">
          <label htmlFor="ns-question">{labels.question}</label>
          <textarea
            id="ns-question"
            rows="3"
            maxLength={1200}
            value={question}
            onChange={(event) => setCustomQuestion(event.target.value)}
            placeholder={stock ? questionPlaceholder : labels.noSelection}
            disabled={disabled}
          />
          {customQuestion !== null && customQuestion !== suggestedQuestion ? (
            <button
              type="button"
              className="ns-text-button ns-question-restore"
              disabled={disabled}
              onClick={() => setCustomQuestion(null)}
            >
              {labels.restoreQuestion}
              <Icon name="retry" size={13} />
            </button>
          ) : null}
          <ModelProcess
            job={
              isPublic
                ? searching
                  ? { status: "running", kind: "public", progress: { stage: "discovering" } }
                  : null
                : state.job?.kind === "analysis"
                  ? state.job
                  : null
            }
            researchStep={isPublic ? null : state.researchStep}
            dossier={state.dossier}
            analysis={isPublic ? publicResearch.result : null}
            kind={isPublic ? "public" : "analysis"}
            locale={locale}
            onCancel={
              searching
                ? publicResearch.cancel
                : activeJob
                  ? () => {
                      void controller.cancelAnalysis().catch(() => {});
                    }
                  : undefined
            }
            className="ns-model-process--start"
          />
        </div>
        {!isPublic && company ? (
          <div className="ns-investor-periods">
            <div className="ns-field">
              <label htmlFor="ns-period">{labels.reportPeriod}</label>
              <select
                id="ns-period"
                value={period?.id ?? ""}
                disabled={disabled || !periods.length}
                onChange={(event) => {
                  setPeriodId(event.target.value);
                  setComparisonId("");
                  setCustomQuestion(null);
                }}
              >
                {periods.map((item) => (
                  <option value={item.id} key={item.id}>
                    {periodLabel(item, locale)}
                  </option>
                ))}
              </select>
            </div>
            <div className="ns-field">
              <label htmlFor="ns-start-comparison">{labels.compare}</label>
              <select
                id="ns-start-comparison"
                value={comparison?.id ?? ""}
                disabled={disabled || !comparisons.length}
                onChange={(event) => {
                  setComparisonId(event.target.value);
                  setCustomQuestion(null);
                }}
              >
                {comparisons.map((item) => (
                  <option value={item.id} key={item.id}>
                    {periodLabel(item, locale)}
                  </option>
                ))}
                {!comparisons.length ? <option value="">{copy.noComparison}</option> : null}
              </select>
            </div>
          </div>
        ) : null}
        <div className="ns-start-submit ns-investor-submit">
          <span className="ns-investor-capability">
            <Icon name={isPublic ? "search" : "book"} size={15} />
            {isPublic ? labels.public : labels.processed}
          </span>
          <Button
            type="submit"
            variant="primary"
            icon={disabled ? undefined : "arrow"}
            disabled={!stock || disabled || !enabled || (isPublic ? !stock.exchange : !period)}
          >
            {searching
              ? labels.researching
              : busy === "research"
                ? copy.working
                : isPublic
                  ? labels.research
                  : labels.analyze}
          </Button>
        </div>
        {!enabled && catalog ? (
          <p className="ns-start-unavailable">
            {labels.modelUnavailable}
            {!isPublic && selection ? (
              <>
                {" "}
                <button
                  type="button"
                  className="ns-text-button"
                  disabled={disabled}
                  onClick={() => act(controller.configureScope(selection))}
                >
                  {copy.openFinancials}
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        {stock ? (
          <details className="ns-investor-coverage">
            <summary>
              {labels.sourceDetails}
              <Icon name="plus" size={14} />
            </summary>
            <div>
              <StockSelectionDetails stock={detailedStock} locale={locale} />
              {isPublic ? (
                <p>
                  {!company ? <strong>{labels.noProcessed}. </strong> : null}
                  {labels.publicScope}
                </p>
              ) : (
                <>
                  <p>
                    {scopeLabel(period?.scope, locale)} · {periodLabel(period, locale)}
                    {comparison
                      ? " · " + labels.compare + " " + periodLabel(comparison, locale)
                      : ""}
                  </p>
                  <p>
                    {copy.frozenNote}
                    {(catalog?.frozenAt ?? catalog?.asOf ?? catalog?.updatedAt)
                      ? " " +
                        copy.fetched +
                        ": " +
                        date(catalog.frozenAt ?? catalog.asOf ?? catalog.updatedAt, locale) +
                        "."
                      : ""}
                  </p>
                  {period?.comparisonBasis ? (
                    <p>{localized(period.comparisonBasis, locale)}</p>
                  ) : null}
                  <Button
                    variant="text"
                    icon="retry"
                    onClick={() => act(controller.refreshSources({ companyId: company.id }))}
                    disabled={disabled}
                  >
                    {copy.refreshSources}
                  </Button>
                </>
              )}
            </div>
          </details>
        ) : null}
      </form>
      <PublicResearchResults research={publicResearch} locale={locale} />
      {!companies.length && !stock ? (
        <div className="ns-inline-empty">
          <Icon name="book" size={26} />
          <p>{copy.noCompanies}</p>
          <Button
            onClick={() => controller.initialize({ force: true })}
            icon="retry"
            disabled={disabled}
          >
            {copy.retry}
          </Button>
        </div>
      ) : null}
      <MarketWorkspace
        security={stock ?? { symbol: "" }}
        locale={locale}
        showPicker={false}
        allowPublicResearch={false}
        modelEnabled={enabled}
        pauseQuotes={searching}
        defaultOpen
      />
    </div>
  );
}
