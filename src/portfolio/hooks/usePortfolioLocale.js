import { useEffect, useState } from "react";
import { locales } from "../../content.js";

const DEFAULT_LOCALE = "en";
const LOCALE_STORAGE_KEY = "portfolio-locale";

function readStoredLocale() {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredLocale(locale) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Locale persistence is optional; the URL remains the source of truth.
  }
}

function readLocale() {
  const pathLocale = window.location.pathname.split("/")[1];
  if (locales.includes(pathLocale)) return pathLocale;

  const savedLocale = readStoredLocale();
  return locales.includes(savedLocale) ? savedLocale : DEFAULT_LOCALE;
}

function applyLocaleChange(nextLocale, currentLocale, commitLocale) {
  if (!locales.includes(nextLocale) || nextLocale === currentLocale) return;

  writeStoredLocale(nextLocale);
  window.history.pushState({}, "", `/${nextLocale}${window.location.hash}`);
  commitLocale(nextLocale);
}

export function usePortfolioLocale() {
  const [locale, setLocale] = useState(readLocale);

  useEffect(() => {
    const pathLocale = window.location.pathname.split("/")[1];
    if (!locales.includes(pathLocale)) {
      window.history.replaceState({}, "", `/${locale}${window.location.hash}`);
    }

    const handlePopState = () => setLocale(readLocale());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [locale]);

  const changeLocale = (nextLocale) => {
    applyLocaleChange(nextLocale, locale, setLocale);
  };

  return [locale, changeLocale];
}
