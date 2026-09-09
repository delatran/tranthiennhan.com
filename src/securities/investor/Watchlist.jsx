import { Button, Icon } from "../ui.jsx";
import { exchangeLabel, stockKey, stockName } from "../StockPicker.jsx";
import { investorCopy } from "./investorIntents.js";
import { savedStock } from "./watchlist.js";

export function Watchlist({ watchlist, selected, onSelect, locale, disabled }) {
  const copy = investorCopy(locale),
    watched = watchlist.items.some((item) => stockKey(item) === stockKey(selected));
  return (
    <section className="ns-watchlist" aria-label={copy.watchlist}>
      <div className="ns-watchlist-heading">
        <span>{copy.watchlist}</span>
        {savedStock(selected) ? (
          <Button
            variant="text"
            icon={watched ? "check" : "plus"}
            aria-pressed={watched}
            disabled={disabled}
            onClick={() => watchlist.toggle(selected)}
            aria-label={`${watched ? copy.remove : copy.add}: ${selected.symbol}`}
          >
            {watched ? copy.saved : copy.add}
          </Button>
        ) : null}
      </div>
      {watchlist.items.length ? (
        <ul className="ns-watchlist-items">
          {watchlist.items.map((stock) => (
            <li
              key={stockKey(stock)}
              className={stockKey(stock) === stockKey(selected) ? "is-selected" : undefined}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(stock)}
                aria-pressed={stockKey(stock) === stockKey(selected)}
                aria-label={`${stock.symbol} · ${stockName(stock, locale)} · ${exchangeLabel(stock.exchange)}`}
              >
                <strong>{stock.symbol}</strong>
                <span>{exchangeLabel(stock.exchange)}</span>
              </button>
              <button
                type="button"
                disabled={disabled}
                className="ns-watchlist-remove"
                onClick={() => watchlist.toggle(stock)}
                aria-label={`${copy.remove}: ${stock.symbol}`}
              >
                <Icon name="close" size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {watchlist.sessionOnly ? (
        <p className="ns-watchlist-status" role="status">
          {copy.sessionOnly}
        </p>
      ) : null}
    </section>
  );
}
