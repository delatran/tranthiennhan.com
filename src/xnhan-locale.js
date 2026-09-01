import {
  XNHAN_DEFAULT_LOCALE,
  XNHAN_LOCALES,
} from "./xnhan-locale-constants.js";

const LOCALE_STORAGE_KEY = "portfolio-locale";
const XNHAN_LOCALE_QUERY_KEY = "lang";

export function readExplicitXNhanLocale(search = "") {
  const value = new URLSearchParams(search).get(XNHAN_LOCALE_QUERY_KEY);
  return XNHAN_LOCALES.includes(value) ? value : null;
}

export function readInitialXNhanLocale({
  search = window.location.search,
  storage,
} = {}) {
  const explicitLocale = readExplicitXNhanLocale(search);
  if (explicitLocale) return explicitLocale;

  try {
    const availableStorage =
      storage === undefined ? window.localStorage : storage;
    const storedLocale = availableStorage.getItem(LOCALE_STORAGE_KEY);
    return XNHAN_LOCALES.includes(storedLocale)
      ? storedLocale
      : XNHAN_DEFAULT_LOCALE;
  } catch {
    return XNHAN_DEFAULT_LOCALE;
  }
}

export function writeStoredXNhanLocale(locale, storage) {
  if (!XNHAN_LOCALES.includes(locale)) return false;

  try {
    const availableStorage =
      storage === undefined ? window.localStorage : storage;
    availableStorage.setItem(LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    // The explicit URL remains authoritative when persistence is unavailable.
    return false;
  }
}

export function xNhanHref(pathname, locale) {
  const safePathname = pathname === "/xnhan/about" ? pathname : "/xnhan";
  if (!XNHAN_LOCALES.includes(locale)) return safePathname;
  return `${safePathname}?${XNHAN_LOCALE_QUERY_KEY}=${locale}`;
}

export function replaceXNhanLocaleInUrl(
  locale,
  {
    historyObject = window.history,
    locationObject = window.location,
  } = {},
) {
  if (!XNHAN_LOCALES.includes(locale)) return false;

  const nextUrl = new URL(locationObject.href);
  nextUrl.search = "";
  nextUrl.searchParams.set(XNHAN_LOCALE_QUERY_KEY, locale);
  historyObject.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  return true;
}
