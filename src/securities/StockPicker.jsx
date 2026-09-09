import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createSecuritiesClient } from "./api.js";
import { date } from "./format.js";
import { Button, Icon } from "./ui.jsx";
import "./market.css";

export const STOCK_EXCHANGES = ["HOSE", "HNX", "UPCOM"];
export const DIRECTORY_REFRESH_MS = 15 * 60_000;
const emptyDirectory = { packet: null, loading: false, error: null };
const normalize = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/giu, "d")
    .toUpperCase()
    .trim();
export const stockKey = (stock) =>
  stock ? `${stock.exchange ?? ""}:${stock.symbol ?? stock.ticker ?? stock.id ?? ""}` : "";
export const exchangeLabel = (exchange) => (exchange === "UPCOM" ? "UPCoM" : (exchange ?? ""));
export const stockName = (stock, locale = "vi") =>
  (locale === "en" ? stock?.nameEn : null) ||
  stock?.name ||
  stock?.legalName ||
  stock?.symbol ||
  "";

export function filterStocks(items = [], query = "", exchange = "") {
  const terms = normalize(query).split(/\s+/u).filter(Boolean);
  return items
    .filter(
      (item) =>
        item &&
        typeof item.symbol === "string" &&
        STOCK_EXCHANGES.includes(item.exchange) &&
        item.securityType === "stock" &&
        item.status === "listed" &&
        (!exchange || item.exchange === exchange) &&
        terms.every((term) =>
          normalize(`${item.symbol} ${item.name ?? ""} ${item.nameEn ?? ""}`).includes(term),
        ),
    )
    .sort((a, b) => {
      const score = (item) =>
        normalize(item.symbol) === normalize(query)
          ? 0
          : normalize(item.symbol).startsWith(normalize(query))
            ? 1
            : 2;
      return (
        score(a) - score(b) ||
        a.symbol.localeCompare(b.symbol) ||
        a.exchange.localeCompare(b.exchange)
      );
    });
}

export function findProcessedCompany(companies = [], stock) {
  if (!stock) return null;
  return (
    companies.find(
      (company) =>
        (company.ticker ?? company.id) === stock.symbol && company.exchange === stock.exchange,
    ) ?? null
  );
}

export function createStockDirectoryStore(client = createSecuritiesClient(), now = Date.now) {
  let state = emptyDirectory,
    pending = null,
    lastAttemptAt = null;
  const listeners = new Set();
  const update = (next) => {
    state = next;
    for (const listener of listeners) listener();
  };
  function refresh() {
    if (pending) return pending;
    lastAttemptAt = now();
    update({ ...state, loading: true, error: null });
    pending = (async () => {
      try {
        const packet = await client.request("/market/directory");
        if (
          packet?.schemaVersion !== 1 ||
          packet.provider !== "vndirect_public_web" ||
          !Array.isArray(packet.items) ||
          !["ready", "partial", "unavailable"].includes(packet.status)
        )
          throw new Error("Invalid directory response");
        if (packet.status === "unavailable" && state.packet?.items?.length)
          update({ ...state, loading: false, error: "unavailable" });
        else
          update({
            packet,
            loading: false,
            error: packet.status === "unavailable" ? "unavailable" : null,
          });
      } catch {
        update({ ...state, loading: false, error: "unavailable" });
      } finally {
        pending = null;
      }
      return state;
    })();
    return pending;
  }
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    ensure: () =>
      lastAttemptAt === null || now() - lastAttemptAt >= DIRECTORY_REFRESH_MS
        ? refresh()
        : (pending ?? Promise.resolve(state)),
    refresh,
  };
}

const directoryStore = createStockDirectoryStore();
export function useStockDirectory({ enabled = true } = {}) {
  const state = useSyncExternalStore(
    directoryStore.subscribe,
    directoryStore.getSnapshot,
    () => emptyDirectory,
  );
  useEffect(() => {
    if (!enabled) return undefined;
    const ensureVisible = () => {
      if (document.visibilityState !== "hidden") void directoryStore.ensure();
    };
    ensureVisible();
    document.addEventListener("visibilitychange", ensureVisible);
    const timer = window.setInterval(ensureVisible, DIRECTORY_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", ensureVisible);
    };
  }, [enabled]);
  return { ...state, refresh: directoryStore.refresh, ensure: directoryStore.ensure };
}

const pickerCopy = (locale) =>
  locale === "vi"
    ? {
        label: "Mã chứng khoán",
        choose: "Chọn mã chứng khoán",
        search: "Tìm mã hoặc tên doanh nghiệp",
        exchange: "Sàn",
        all: "Tất cả",
        loading: "Đang tải danh mục…",
        empty: "Không có mã khớp với từ khóa và sàn đã chọn.",
        unavailable: "Chưa tải được danh mục chứng khoán. Thử cập nhật lại.",
        partial: "Danh mục chưa đầy đủ ở một số sàn.",
        old: "Đang dùng danh mục đã lưu; kiểm tra cập nhật chưa thành công.",
        saved: "Danh mục lưu lúc",
        refresh: "Cập nhật danh mục",
        more: "Xem thêm mã",
        close: "Đóng danh mục",
        matches: (count) => `${count} mã phù hợp`,
        shown: (count, total) => `${count}/${total} mã`,
        details: "Thông tin mã đã chọn",
        type: "Cổ phiếu",
        listed: "Ngày niêm yết / đăng ký giao dịch",
        tax: "Mã số thuế",
        missing: "Chưa có dữ liệu",
      }
    : {
        label: "Stock",
        choose: "Choose a stock",
        search: "Search ticker or company name",
        exchange: "Exchange",
        all: "All",
        loading: "Loading the directory…",
        empty: "No stock matches the search and selected exchange.",
        unavailable: "The stock directory could not be loaded. Try refreshing it.",
        partial: "Coverage is incomplete for some exchanges.",
        old: "Using the saved directory; its update check did not succeed.",
        saved: "Directory retrieved",
        refresh: "Refresh directory",
        more: "Show more stocks",
        close: "Close directory",
        matches: (count) => `${count} matching ${count === 1 ? "stock" : "stocks"}`,
        shown: (count, total) => `${count}/${total} stocks`,
        details: "Selected stock details",
        type: "Stock",
        listed: "Listing / trading registration date",
        tax: "Tax number",
        missing: "Not provided",
      };

export function StockSelectionDetails({ stock, locale = "vi" }) {
  if (!stock) return null;
  const copy = pickerCopy(locale);
  return (
    <div className="ns-stock-identity">
      <p>
        <strong>{stock.symbol}</strong>
        <span>{stockName(stock, locale)}</span>
        <span className="ns-stock-exchange">{exchangeLabel(stock.exchange)}</span>
      </p>
      <details>
        <summary>
          {copy.details}
          <Icon name="plus" size={13} />
        </summary>
        <dl>
          <div>
            <dt>{copy.label}</dt>
            <dd>
              {stock.symbol} · {copy.type} · {exchangeLabel(stock.exchange)}
            </dd>
          </div>
          {stock.isin ? (
            <div>
              <dt>ISIN</dt>
              <dd>{stock.isin}</dd>
            </div>
          ) : null}
          {stock.listedDate ? (
            <div>
              <dt>{copy.listed}</dt>
              <dd>{String(stock.listedDate).slice(0, 10)}</dd>
            </div>
          ) : null}
          {stock.taxCode ? (
            <div>
              <dt>{copy.tax}</dt>
              <dd>{stock.taxCode}</dd>
            </div>
          ) : null}
        </dl>
      </details>
    </div>
  );
}

export function StockPicker({
  selected,
  onSelect,
  directory,
  locale = "vi",
  disabled = false,
  id: providedId,
  label,
}) {
  const generatedId = useId(),
    id = providedId ?? `ns-stock-${generatedId}`,
    copy = pickerCopy(locale);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [exchange, setExchange] = useState("");
  const [active, setActive] = useState(0),
    [limit, setLimit] = useState(20);
  const rootRef = useRef(null),
    inputRef = useRef(null),
    triggerRef = useRef(null);
  const packet = directory?.packet,
    items = packet?.items ?? [];
  const matches = useMemo(() => filterStocks(items, query, exchange), [items, query, exchange]);
  const shown = matches.slice(0, limit),
    activeIndex = Math.min(active, shown.length - 1);
  const listId = `${id}-list`,
    searchId = `${id}-search`;
  const close = (focus = false) => {
    setOpen(false);
    if (focus) triggerRef.current?.focus();
  };
  const choose = (stock) => {
    onSelect(stock);
    setQuery("");
    close(true);
  };
  const partial =
    packet?.status === "partial" || packet?.coverage?.some((entry) => entry.status !== "complete");
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      void directory?.ensure?.();
    }
  }, [open, directory?.ensure]);
  useEffect(() => {
    if (open && activeIndex >= 0)
      document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, id]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const editSearch = (value) => {
    setQuery(value);
    setActive(0);
    setLimit(20);
  };
  const handleKeys = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      setActive(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? Math.max(0, shown.length - 1)
            : Math.max(
                0,
                Math.min(shown.length - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1)),
              ),
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (shown[activeIndex]) choose(shown[activeIndex]);
    }
  };
  return (
    <div
      className="ns-stock-picker ns-field"
      ref={rootRef}
      onBlurCapture={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))
          setOpen(false);
      }}
    >
      <label id={`${id}-label`} htmlFor={id}>
        {label ?? copy.label}
      </label>
      <button
        type="button"
        id={id}
        className="ns-stock-trigger"
        ref={triggerRef}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-dialog` : undefined}
        onClick={() => {
          setOpen((current) => !current);
          setActive(0);
        }}
      >
        <span>
          {selected ? (
            <>
              <strong>{selected.symbol}</strong>
              <span>{stockName(selected, locale)}</span>
            </>
          ) : (
            copy.choose
          )}
        </span>
        {selected?.exchange ? <small>{exchangeLabel(selected.exchange)}</small> : null}
        <Icon name="search" size={17} />
      </button>
      {open ? (
        <div
          className="ns-stock-popover"
          id={`${id}-dialog`}
          role="dialog"
          aria-labelledby={`${id}-label`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close(true);
            }
          }}
        >
          <div className="ns-stock-search">
            <label className="sr-only" htmlFor={searchId}>
              {copy.search}
            </label>
            <input
              id={searchId}
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => editSearch(event.target.value)}
              onKeyDown={handleKeys}
              placeholder={copy.search}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={shown[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
              autoComplete="off"
            />
            <label className="sr-only" htmlFor={`${id}-exchange`}>
              {copy.exchange}
            </label>
            <select
              id={`${id}-exchange`}
              value={exchange}
              onChange={(event) => {
                setExchange(event.target.value);
                setActive(0);
                setLimit(20);
              }}
            >
              <option value="">{copy.all}</option>
              {STOCK_EXCHANGES.map((value) => (
                <option key={value} value={value}>
                  {exchangeLabel(value)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ns-icon-button"
              onClick={() => close(true)}
              aria-label={copy.close}
            >
              <Icon name="close" size={17} />
            </button>
          </div>
          <p className="ns-stock-match-count" role="status">
            {directory?.loading ? copy.loading : copy.matches(matches.length)}
          </p>
          <div className="ns-stock-options" id={listId} role="listbox" aria-label={copy.choose}>
            {shown.map((stock, index) => (
              <button
                type="button"
                role="option"
                tabIndex="-1"
                id={`${id}-option-${index}`}
                key={stockKey(stock)}
                aria-selected={stockKey(stock) === stockKey(selected)}
                className={index === activeIndex ? "is-active" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(stock)}
                onMouseMove={() => setActive(index)}
              >
                <strong>{stock.symbol}</strong>
                <span>{stockName(stock, locale)}</span>
                <small>{exchangeLabel(stock.exchange)}</small>
              </button>
            ))}
          </div>
          {!shown.length && !directory?.loading ? (
            <p className="ns-stock-directory-note">
              {packet?.items?.length ? copy.empty : copy.unavailable}
            </p>
          ) : null}
          {shown.length < matches.length ? (
            <Button variant="text" onClick={() => setLimit((value) => value + 40)}>
              {copy.more} · {copy.shown(shown.length, matches.length)}
            </Button>
          ) : null}
          {directory?.error || packet?.cache?.stale ? (
            <p className="ns-stock-directory-note ns-market-warning">
              {packet?.items?.length ? copy.old : copy.unavailable}
            </p>
          ) : partial ? (
            <p className="ns-stock-directory-note ns-market-warning">{copy.partial}</p>
          ) : null}
          <div className="ns-stock-directory-foot">
            {packet?.fetchedAt || packet?.coverage?.length ? (
              <span>
                {packet?.fetchedAt ? `${copy.saved}: ${date(packet.fetchedAt, locale, true)}` : ""}
                {packet?.coverage?.length ? (
                  <>
                    {packet?.fetchedAt ? <br /> : null}
                    {packet.coverage
                      .map(
                        (entry) =>
                          `${exchangeLabel(entry.exchange)}: ${entry.receivedCount}/${entry.expectedCount ?? "?"}`,
                      )
                      .join(" · ")}
                  </>
                ) : null}
              </span>
            ) : null}
            {directory?.refresh ? (
              <Button
                variant="text"
                icon="retry"
                disabled={directory.loading}
                onClick={() => {
                  void directory.refresh();
                }}
              >
                {copy.refresh}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
