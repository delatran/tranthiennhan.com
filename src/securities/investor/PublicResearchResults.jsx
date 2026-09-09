import { date } from "../format.js";
import { Button, Icon } from "../ui.jsx";
import { exchangeLabel } from "../StockPicker.jsx";
import { marketCopy as copyFor } from "./marketCopy.js";
import { safeMarketUrl } from "./marketFormatting.js";

export function PublicResearchResults({ research, locale = "vi" }) {
  const copy = copyFor(locale),
    result = research?.result;
  if (research?.status === "loading")
    return (
      <div className="ns-public-loading">
        <p className="ns-market-empty" role="status">
          <span className="ns-working-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {copy.publicLoading}
        </p>
        {research.cancel ? (
          <Button variant="text" onClick={research.cancel}>
            {copy.stopWaiting}
          </Button>
        ) : null}
      </div>
    );
  if (research?.status === "error")
    return (
      <p className="ns-market-empty" role="alert">
        <Icon name="warning" size={17} />
        {copy.publicError}
      </p>
    );
  if (!result) return null;
  return (
    <section className="ns-public-results" aria-label={copy.publicResultsTitle}>
      <header>
        <h3>
          {result.symbol} · {exchangeLabel(result.exchange)} · {copy.publicResultsTitle}
        </h3>
        <p>
          {copy.fetched}: {date(result.fetchedAt, locale, true)}
        </p>
      </header>
      {result.status !== "ready" ? (
        <p className="ns-market-warning">
          <Icon name="warning" size={16} />
          {result.status === "partial" ? copy.publicIncomplete : copy.publicUnavailable}
        </p>
      ) : null}
      {result.sources.length ? (
        <div className="ns-market-news">
          {result.sources.map((source, index) => {
            const url = safeMarketUrl(source.url);
            return (
              <article key={`${source.url ?? "source"}-${index}`}>
                <div className="ns-public-source-meta">
                  <span className="ns-source-reading-status" data-status={source.readStatus}>
                    <Icon name={source.readStatus === "read" ? "check" : "warning"} size={13} />
                    {source.readStatus === "read"
                      ? copy.publicRead
                      : source.readStatus === "partial"
                        ? copy.publicPartial
                        : copy.publicUnavailable}
                  </span>
                  {url ? <span>{new URL(url).hostname}</span> : null}
                </div>
                <h4>
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      {source.title || url}
                      <Icon name="northeast" size={12} />
                    </a>
                  ) : (
                    source.title || copy.publicUnavailable
                  )}
                </h4>
                {source.excerpt ? (
                  <blockquote className="ns-market-news-summary">{source.excerpt}</blockquote>
                ) : null}
                {source.limitations?.length ? (
                  <details className="ns-market-source-fields">
                    <summary>
                      {copy.limitations}
                      <Icon name="plus" size={13} />
                    </summary>
                    <ul className="ns-public-limitations" aria-label={copy.limitations}>
                      {source.limitations.map((item, itemIndex) => (
                        <li key={itemIndex}>{item}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="ns-market-empty">{copy.publicEmpty}</p>
      )}
      <details className="ns-market-source-fields">
        <summary>
          {copy.sourceMethod}
          <Icon name="plus" size={13} />
        </summary>
        <p className="ns-market-boundary">{copy.publicBoundary}</p>
        {result.limitations?.length ? (
          <ul
            className="ns-public-limitations"
            aria-label={result.status === "ready" ? copy.discoveryNotes : copy.limitations}
          >
            {result.limitations.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        ) : null}
      </details>
    </section>
  );
}
