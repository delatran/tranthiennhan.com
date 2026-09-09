import { XNHAN_LOCALES, XNHAN_LOCALE_QUERY_KEY } from "./locales.js";

export function xNhanHref(pathname, locale) {
  const safePathname = pathname === "/xnhan/about" ? pathname : "/xnhan";
  if (!XNHAN_LOCALES.includes(locale)) return safePathname;
  return `${safePathname}?${XNHAN_LOCALE_QUERY_KEY}=${locale}`;
}
