import { useId, useState } from "react";
import { Button, Icon } from "./ui.jsx";
import { StockPicker, StockSelectionDetails, stockKey, useStockDirectory } from "./StockPicker.jsx";
import { marketCopy } from "./investor/marketCopy.js";
import { marketErrorMessage } from "./investor/marketFormatting.js";
import { MARKET_DATASETS } from "./investor/marketRequests.js";
import { usePublicResearch } from "./investor/publicResearch.js";
import { useMarketSnapshot, usePageVisibility } from "./investor/useMarketSnapshot.js";
import { MarketResults } from "./investor/MarketResults.jsx";
import { PublicResearchResults } from "./investor/PublicResearchResults.jsx";
import "./market.css";

export {
  MARKET_DATASETS,
  QUOTE_REFRESH_MS,
  marketPacketMatches,
  createMarketRequestController,
} from "./investor/marketRequests.js";
export {
  safeMarketUrl,
  marketUnit,
  historyChartPoints,
  marketHistory,
  marketErrorMessage,
} from "./investor/marketFormatting.js";
export { MarketResults, MarketDataTable } from "./investor/MarketResults.jsx";
export { PublicResearchResults } from "./investor/PublicResearchResults.jsx";
export { createPublicResearchController, usePublicResearch } from "./investor/publicResearch.js";

export function QuoteRefreshControls({ paused, suspended = false, onToggle, locale }) {
  const copy = marketCopy(locale);
  const stopped = paused || suspended;
  return (
    <div className="ns-quote-updates">
      <span role="status">{stopped ? copy.paused : copy.autoUpdates}</span>
      <button
        type="button"
        onClick={onToggle}
        disabled={suspended}
        aria-label={stopped ? copy.resume : copy.pause}
      >
        <Icon name={stopped ? "retry" : "stop"} size={13} />
        {stopped ? copy.resumeShort : copy.pauseShort}
      </button>
    </div>
  );
}

export function MarketWorkspace({
  security: controlledSecurity,
  defaultSecurity,
  defaultSymbol = "ACB",
  defaultExchange,
  locale = "vi",
  showPicker = true,
  modelEnabled = false,
  allowPublicResearch = true,
  pauseQuotes = false,
  defaultOpen = false,
}) {
  const copy = marketCopy(locale),
    id = useId(),
    visible = usePageVisibility();
  const [open, setOpen] = useState(defaultOpen),
    [dataset, setDataset] = useState("quote"),
    [query, setQuery] = useState("");
  const [selected, setSelected] = useState(
    defaultSecurity ?? { symbol: defaultSymbol, exchange: defaultExchange },
  );
  const directory = useStockDirectory({ enabled: open && showPicker }),
    security = controlledSecurity ?? selected;
  const research = usePublicResearch({
    security,
    query,
    locale,
    enabled: modelEnabled,
    active: open && visible && allowPublicResearch,
  });
  const suspended = dataset === "quote" && (pauseQuotes || research.status === "loading");
  const market = useMarketSnapshot({ security, dataset, active: open && visible, suspended });

  return (
    <details
      className="ns-market"
      open={open}
      onToggle={(event) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <Icon name="search" size={19} />
        <span>
          {copy.title}
          <small>{copy.subtitle}</small>
        </span>
        <Icon name="plus" size={17} />
      </summary>
      {open ? (
        <div className="ns-market-body">
          {showPicker ? (
            <div className="ns-market-picker">
              <StockPicker
                selected={security}
                onSelect={(stock) => {
                  setSelected(stock);
                  setQuery("");
                }}
                directory={directory}
                locale={locale}
                id={"ns-market-stock-" + id}
              />
              <StockSelectionDetails
                stock={
                  directory.packet?.items?.find((item) => stockKey(item) === stockKey(security)) ??
                  security
                }
                locale={locale}
              />
            </div>
          ) : null}
          <div className="ns-market-toolbar">
            <div className="ns-market-datasets" role="group" aria-label={copy.dataset}>
              {MARKET_DATASETS.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={dataset === value}
                  onClick={() => setDataset(value)}
                >
                  {copy[value]}
                </button>
              ))}
            </div>
            <div className="ns-market-controls">
              <Button
                variant="text"
                icon="retry"
                aria-label={copy.refresh}
                aria-busy={market.status === "loading"}
                disabled={!security?.symbol || market.status === "loading" || suspended}
                onClick={market.refresh}
              >
                {copy.refresh}
              </Button>
              {dataset === "quote" && security?.symbol ? (
                <QuoteRefreshControls
                  paused={market.paused}
                  suspended={suspended}
                  onToggle={market.togglePaused}
                  locale={locale}
                />
              ) : null}
            </div>
          </div>
          {!security?.symbol ? <p className="ns-market-empty">{copy.choose}</p> : null}
          {market.status === "loading" && !market.packet ? (
            <p className="ns-market-empty" role="status">
              <span className="ns-working-mark" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {copy.loading}
            </p>
          ) : null}
          {market.error ? (
            <p className="ns-market-empty" role="alert">
              <Icon name="warning" size={17} />
              {marketErrorMessage(market.error, locale)}
            </p>
          ) : null}
          {market.packet ? (
            <MarketResults key={market.identity} packet={market.packet} locale={locale} />
          ) : null}
          {allowPublicResearch ? (
            <div className="ns-public-research">
              <h3>{copy.publicTitle}</h3>
              <div className="ns-field">
                <label htmlFor={"ns-public-query-" + id}>{copy.publicLabel}</label>
                <textarea
                  id={"ns-public-query-" + id}
                  rows="2"
                  maxLength={1200}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={copy.publicPlaceholder}
                  disabled={research.status === "loading"}
                />
              </div>
              <Button
                icon="search"
                disabled={!modelEnabled || !security?.exchange || research.status === "loading"}
                onClick={() => {
                  void research.search();
                }}
              >
                {copy.publicButton}
              </Button>
              {!modelEnabled ? <p className="ns-market-boundary">{copy.publicDisabled}</p> : null}
              <PublicResearchResults research={research} locale={locale} />
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
