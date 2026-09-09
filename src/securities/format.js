import { convertUnit } from "../../shared/securities/finance.js";

export const PRODUCT_NAME = "Nhân for Securities";
export const MODEL_NAME = "Meta Muse Spark 1.3 Contributor";

export function localized(value, locale = "vi") {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return String(
    value[locale] ?? value.vi ?? value.en ?? value.label ?? value.name ?? value.id ?? "",
  );
}

export function number(value, locale = "vi", digits = 2) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)))
    return "—";
  return new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-GB", {
    maximumFractionDigits: digits,
  }).format(Number(value));
}

export function percent(value, locale = "vi") {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)))
    return "—";
  return `${Number(value) > 0 ? "+" : ""}${number(value, locale, 2)}%`;
}

export function reportFigure(metric, locale = "vi") {
  const unit = /^VND(?:_|$)/.test(metric?.unit ?? "") ? "VND_billion" : metric?.unit;
  let value;
  try {
    value = convertUnit(metric?.current?.value, metric?.current?.unit ?? metric?.unit, unit);
  } catch {
    value = null;
  }
  return { value: number(value, locale, 1), unit: unitLabel(unit, locale) };
}

export function metricValue(metric, side) {
  try {
    return convertUnit(metric?.[side]?.value, metric?.[side]?.unit ?? metric?.unit, metric?.unit);
  } catch {
    return null;
  }
}

export function dossierMetrics(dossier) {
  const metrics = new Map((dossier?.metrics ?? []).map((metric) => [metric.id, metric]));
  for (const metric of dossier?.reportProjection?.metrics ?? [])
    if (!metrics.has(metric.id)) metrics.set(metric.id, metric);
  return [...metrics.values()];
}

export function date(value, locale = "vi", includeTime = false) {
  if (!value || Number.isNaN(new Date(value).getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

export function periodLabel(period, locale = "vi") {
  return localized(period?.label ?? period?.name ?? period?.id ?? period, locale);
}

export function companyLabel(company, locale = "vi") {
  return localized(
    (locale === "vi" ? company?.legalName : null) ??
      company?.name ??
      company?.label ??
      company?.ticker ??
      company?.id,
    locale,
  );
}

export function unitLabel(unit, locale = "vi") {
  const units = {
    VND_million: { vi: "Triệu đồng", en: "VND million" },
    VND_billion: { vi: "Tỷ đồng", en: "VND billion" },
    VND: { vi: "Đồng", en: "VND" },
    percent: { vi: "%", en: "%" },
    percentage_point: { vi: "điểm %", en: "pp" },
  };
  return localized(units[unit] ?? unit, locale);
}

export function sourceTypeLabel(type, locale = "vi") {
  return localized(
    {
      scan_pdf: { vi: "PDF scan", en: "Scanned PDF" },
      text_pdf: { vi: "PDF có văn bản", en: "Text PDF" },
      html: { vi: "Trang công bố", en: "Disclosure page" },
    }[type] ?? type,
    locale,
  );
}

export function scopeLabel(scope, locale = "vi") {
  const values = {
    consolidated: { vi: "Hợp nhất", en: "Consolidated" },
    separate: { vi: "Riêng lẻ", en: "Separate" },
    standalone: { vi: "Riêng lẻ", en: "Separate" },
    reviewed: { vi: "Đã soát xét", en: "Reviewed" },
    audited: { vi: "Đã kiểm toán", en: "Audited" },
    unaudited: { vi: "Chưa kiểm toán", en: "Unaudited" },
  };
  return localized(values[scope] ?? scope, locale);
}

export function sourceLocation(locator, locale = "vi") {
  if (!locator) return locale === "vi" ? "Cấp tài liệu" : "Document level";
  const parts = [
    locator.page ? `${locale === "vi" ? "Trang" : "Page"} ${locator.page}` : "",
    localized(locator.table, locale),
    locator.rowCode
      ? `${locale === "vi" ? "Mã số" : "Row"} ${locator.rowCode}`
      : localized(locator.rowLabel, locale),
    localized(locator.column, locale),
  ].filter(Boolean);
  return parts.join(" · ") || (locale === "vi" ? "Cấp tài liệu" : "Document level");
}

export function safeSourceUrl(source, locator) {
  try {
    const url = new URL(source?.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (locator?.page && /\.pdf$/i.test(url.pathname))
      url.hash = `page=${Number(locator.page)}&view=FitH`;
    return url.href;
  } catch {
    return null;
  }
}

export function localSourceUrl(source, page) {
  const path = page ? `${source?.localPageUrl ?? ""}${Number(page)}` : source?.localOriginalUrl;
  if (
    typeof path !== "string" ||
    !/^\/api\/securities\/sources\/documents\/[a-zA-Z0-9_-]+\/[a-f0-9]{64}\/(?:original|pages\/[1-9]\d{0,3})$/.test(
      path,
    )
  )
    return null;
  return path;
}

export function unresolvedIssues(dossier) {
  return (dossier?.issues ?? []).filter((issue) => !issue.resolution);
}

export function readInitialLocale() {
  const query = new URLSearchParams(window.location.search).get("lang");
  if (["vi", "en"].includes(query)) return query;
  try {
    const stored = window.localStorage.getItem("portfolio-locale");
    if (["vi", "en"].includes(stored)) return stored;
  } catch {
    /* The URL remains usable when browser storage is restricted. */
  }
  return "en";
}

export function writeLocalePreference(locale) {
  if (typeof window === "undefined" || !["vi", "en"].includes(locale)) return;
  const url = new URL(window.location.href);
  url.searchParams.set("lang", locale);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  try {
    window.localStorage.setItem("portfolio-locale", locale);
  } catch {
    /* The URL remains usable without storage. */
  }
}
