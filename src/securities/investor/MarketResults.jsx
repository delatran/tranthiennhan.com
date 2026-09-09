import { useState } from "react";
import { date, number } from "../format.js";
import { Button, Icon } from "../ui.jsx";
import { exchangeLabel } from "../StockPicker.jsx";
import { marketCopy as copyFor, fieldLabel } from "./marketCopy.js";
import {
  safeMarketUrl,
  marketUnit,
  sourceDate,
  historyChartPoints,
  marketErrorMessage,
} from "./marketFormatting.js";

function FieldValue({ value, field, locale }) {
  const copy = copyFor(locale);
  if (value === null || value === undefined || value === "")
    return <span className="ns-market-missing">{copy.missing}</span>;
  if (typeof value === "number") return number(value, locale, 4);
  if (typeof value !== "string") return <span className="ns-market-missing">{copy.missing}</span>;
  if (field === "website") {
    const url = safeMarketUrl(value);
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {value}
        <Icon name="northeast" size={12} />
      </a>
    ) : (
      value
    );
  }
  if (value.length > 240 || /Summary$/u.test(field))
    return (
      <details className="ns-market-long-text">
        <summary>
          {copy.readMore}
          <Icon name="plus" size={12} />
        </summary>
        <p>{value}</p>
      </details>
    );
  return value;
}

function DataFields({ packet, locale, row = packet.rows?.[0] ?? {} }) {
  const keys = [
    ...new Set([...(packet.columns ?? []).map((column) => column.key), ...Object.keys(row)]),
  ];
  return (
    <dl className="ns-market-profile">
      {keys.map((key) => (
        <div key={key}>
          <dt>{fieldLabel(key, locale, packet.dataset)}</dt>
          <dd>
            <FieldValue value={row[key]} field={key} locale={locale} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function MarketDataTable({ packet, locale = "vi" }) {
  const copy = copyFor(locale),
    [limit, setLimit] = useState(8);
  const rows = packet.rows ?? [],
    columns = packet.columns?.length
      ? packet.columns
      : Object.keys(rows[0] ?? {}).map((key) => ({ key }));
  return (
    <>
      <div className="ns-market-table-scroll" tabIndex="0" role="region" aria-label={copy.rows}>
        <table className="ns-market-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th scope="col" key={column.key}>
                  {fieldLabel(column.key, locale, packet.dataset)}
                  {column.unit ? <span>{marketUnit(column.unit, locale)}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows
              .slice(-limit)
              .reverse()
              .map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={
                        typeof row[column.key] === "number" ? "ns-market-number" : undefined
                      }
                    >
                      <FieldValue value={row[column.key]} field={column.key} locale={locale} />
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="ns-market-pagination">
        <span>
          {Math.min(limit, rows.length)}/{rows.length}
        </span>
        <div>
          {limit < rows.length ? (
            <Button variant="text" onClick={() => setLimit((value) => value + 40)}>
              {copy.more}
            </Button>
          ) : null}
          {limit > 8 ? (
            <Button variant="text" onClick={() => setLimit(8)}>
              {copy.fewer}
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}

function PriceFigures({ packet, row, locale }) {
  const quote = packet.dataset === "quote",
    keys = ["close", "open", "high", "low", "volume"];
  const unknown = copyFor(locale).unknownUnit;
  const hasUnknownUnit = [packet.units?.price, packet.units?.volume].some(
    (unit) => marketUnit(unit, locale) === unknown,
  );
  return (
    <>
      <dl className="ns-market-quotes">
        {keys.map((key) => (
          <div key={key}>
            <dt>{fieldLabel(key, locale, quote ? "quote" : "history")}</dt>
            <dd>{number(row?.[key], locale, 4)}</dd>
            {marketUnit(key === "volume" ? packet.units?.volume : packet.units?.price, locale) !==
            unknown ? (
              <span>
                {marketUnit(key === "volume" ? packet.units?.volume : packet.units?.price, locale)}
              </span>
            ) : null}
          </div>
        ))}
      </dl>
      {hasUnknownUnit ? <p className="ns-market-session">{unknown}</p> : null}
    </>
  );
}

function HistoryView({ packet, locale }) {
  const copy = copyFor(locale),
    chart = historyChartPoints(packet.rows),
    unit = marketUnit(packet.units?.price, locale);
  return (
    <div className="ns-market-history">
      <p className="ns-market-session">
        {copy.historical}
        {packet.summary?.excludedCurrentSessionRows ? `. ${copy.excludedToday}` : ""}
      </p>
      <PriceFigures packet={packet} row={chart?.values.at(-1)} locale={locale} />
      {chart ? (
        <figure className="ns-market-chart">
          <figcaption>
            {copy.chart}
            <span>{unit}</span>
          </figcaption>
          <div className="ns-market-chart-body">
            <div className="ns-market-chart-scale">
              <span>{number(chart.max, locale)}</span>
              <span>{number(chart.min, locale)}</span>
            </div>
            <svg
              viewBox="0 0 600 144"
              preserveAspectRatio="none"
              role="img"
              aria-label={copy.chart}
            >
              <line x1="12" y1="12" x2="588" y2="12" />
              <line x1="12" y1="132" x2="588" y2="132" />
              {chart.points.length === 1 ? (
                <circle cx={chart.points[0].x} cy={chart.points[0].y} r="3" />
              ) : (
                <path
                  d={chart.points
                    .map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`)
                    .join(" ")}
                />
              )}
            </svg>
          </div>
          <div className="ns-market-chart-dates">
            <span>{sourceDate(chart.values[0].time.slice(0, 10), locale)}</span>
            <span>{sourceDate(chart.values.at(-1).time.slice(0, 10), locale)}</span>
          </div>
        </figure>
      ) : null}
      <MarketDataTable packet={packet} locale={locale} />
    </div>
  );
}

function CompanyProfile({ packet, locale }) {
  const row = packet.rows?.[0] ?? {},
    copy = copyFor(locale);
  const name = locale === "vi" ? row.vnName || row.enName : row.enName || row.vnName;
  const overview =
    locale === "vi" ? row.vnSummary || row.enSummary : row.enSummary || row.vnSummary;
  return (
    <div className="ns-company-profile">
      {typeof name === "string" && name ? <h4>{name}</h4> : null}
      {typeof overview === "string" && overview ? (
        <p>{overview.length > 520 ? `${overview.slice(0, 520).trimEnd()}…` : overview}</p>
      ) : null}
      <details className="ns-market-source-fields">
        <summary>
          {copy.company}
          <Icon name="plus" size={13} />
        </summary>
        <DataFields packet={packet} locale={locale} />
      </details>
    </div>
  );
}

export function MarketResults({ packet, locale = "vi" }) {
  const copy = copyFor(locale),
    hasRows = packet.rows?.length > 0;
  const invalid = [packet.summary?.invalidCells, packet.summary?.invalidRows].some((value) =>
    Array.isArray(value) ? value.length > 0 : typeof value === "number" && value > 0,
  );
  return (
    <section
      className="ns-market-results"
      aria-label={`${packet.symbol} · ${copy[packet.dataset] ?? copy.rows}`}
    >
      <header>
        <h3>
          {packet.symbol}
          {packet.exchange ? ` · ${exchangeLabel(packet.exchange)}` : ""} ·{" "}
          {copy[packet.dataset] ?? copy.rows}
        </h3>
      </header>
      <div className="ns-market-provenance">
        <span>
          {packet.asOf
            ? `${copy.sourceDate}: ${sourceDate(packet.asOf, locale)}`
            : copy.unknownDate}
        </span>
        {packet.dataset === "quote" && packet.summary?.sourceTime ? (
          <span>
            {copy.sourceClock}: {packet.summary.sourceTime}
          </span>
        ) : null}
        {packet.dataset === "quote" && hasRows ? <span>{copy.priceDelay}</span> : null}
      </div>
      {packet.cache?.stale ? (
        <p className="ns-market-warning">
          <Icon name="warning" size={16} />
          {copy.stale}
        </p>
      ) : null}
      {invalid ? <p className="ns-market-warning">{copy.quality}</p> : null}
      {packet.summary?.conflictingDates > 0 ? (
        <p className="ns-market-warning">{copy.conflicts}</p>
      ) : null}
      {hasRows ? (
        packet.dataset === "history" ? (
          <HistoryView packet={packet} locale={locale} />
        ) : packet.dataset === "company" ? (
          <CompanyProfile packet={packet} locale={locale} />
        ) : (
          <div className="ns-market-history">
            <PriceFigures packet={packet} row={packet.rows[0]} locale={locale} />
            <details className="ns-market-source-fields">
              <summary>
                {copy.rows}
                <Icon name="plus" size={13} />
              </summary>
              <DataFields packet={packet} locale={locale} />
            </details>
          </div>
        )
      ) : (
        <p className="ns-market-empty">
          <Icon name="warning" size={17} />
          {packet.status === "unavailable" ? marketErrorMessage(packet.error, locale) : copy.empty}
        </p>
      )}
      <details className="ns-market-source-fields">
        <summary>
          {copy.sourceDetails}
          <Icon name="plus" size={13} />
        </summary>
        <p className="ns-market-boundary">
          {copy.fetched}: {date(packet.fetchedAt, locale, true)}
        </p>
        {packet.dataset === "quote" && hasRows ? (
          <>
            <p className="ns-market-boundary">{copy.intraday}</p>
            {packet.summary?.sourceTime ? (
              <p className="ns-market-boundary">{copy.clockNote}</p>
            ) : null}
          </>
        ) : null}
        {packet.cache?.persisted === false ? (
          <p className="ns-market-boundary">{copy.unsaved}</p>
        ) : null}
      </details>
    </section>
  );
}
