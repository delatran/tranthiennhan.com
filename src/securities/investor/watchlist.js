import { useEffect, useState } from "react";
import { STOCK_EXCHANGES, stockKey } from "../StockPicker.jsx";

export const WATCHLIST_STORAGE_KEY = "nhan-securities-watchlist";
const safeName = (value) => (typeof value === "string" ? value.trim().slice(0, 256) : "");

export function savedStock(stock) {
  if (
    !stock ||
    typeof stock !== "object" ||
    typeof stock.symbol !== "string" ||
    !/^[A-Z][A-Z0-9]{1,14}$/u.test(stock.symbol) ||
    !STOCK_EXCHANGES.includes(stock.exchange) ||
    (stock.securityType && stock.securityType !== "stock") ||
    (stock.status && stock.status !== "listed")
  )
    return null;
  return {
    symbol: stock.symbol,
    exchange: stock.exchange,
    name: safeName(stock.name) || stock.symbol,
    ...(safeName(stock.nameEn) ? { nameEn: safeName(stock.nameEn) } : {}),
  };
}

export function parseWatchlist(raw) {
  if (typeof raw !== "string" || raw.length > 100_000) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const items = new Map();
    for (const candidate of parsed) {
      const item = savedStock(candidate);
      if (item) items.set(stockKey(item), item);
    }
    return [...items.values()];
  } catch {
    return [];
  }
}

export function toggleWatchedStock(items, stock) {
  const item = savedStock(stock);
  if (!item) return items;
  const key = stockKey(item);
  return items.some((entry) => stockKey(entry) === key)
    ? items.filter((entry) => stockKey(entry) !== key)
    : [...items, item];
}

export function persistWatchlist(storage, items) {
  try {
    storage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(items.map(savedStock).filter(Boolean)));
    return true;
  } catch {
    return false;
  }
}

function loadWatchlist() {
  try {
    return parseWatchlist(window.localStorage.getItem(WATCHLIST_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function useWatchlist() {
  const [items, setItems] = useState(loadWatchlist),
    [sessionOnly, setSessionOnly] = useState(false);
  useEffect(() => {
    const synchronize = (event) => {
      if (event.key === WATCHLIST_STORAGE_KEY || event.key === null) {
        setItems(parseWatchlist(event.newValue));
        setSessionOnly(false);
      }
    };
    window.addEventListener("storage", synchronize);
    return () => window.removeEventListener("storage", synchronize);
  }, []);
  function toggle(stock) {
    const next = toggleWatchedStock(items, stock);
    setItems(next);
    try {
      setSessionOnly(!persistWatchlist(window.localStorage, next));
    } catch {
      setSessionOnly(true);
    }
  }
  return { items, sessionOnly, toggle };
}
