import { date } from "../format.js";
import { marketCopy as copyFor } from "./marketCopy.js";

export function safeMarketUrl(value) {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function marketUnit(unit, locale = "vi") {
  const labels = {
    VND: ["đồng", "VND"],
    VND_thousand: ["nghìn đồng", "VND thousand"],
    thousand_vnd: ["nghìn đồng", "VND thousand"],
    shares: ["cổ phiếu", "shares"],
    percent: ["%", "%"],
    persons: ["người", "people"],
    people: ["người", "people"],
    count: ["đơn vị", "count"],
  };
  return typeof unit === "string"
    ? (labels[unit]?.[locale === "vi" ? 0 : 1] ?? copyFor(locale).unknownUnit)
    : copyFor(locale).unknownUnit;
}

export function sourceDate(value, locale) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value))
    return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));
  return value ? date(value, locale) : copyFor(locale).missing;
}

export function marketHistory(rows = []) {
  return rows
    .filter(
      (row) =>
        typeof row?.time === "string" &&
        /^\d{4}-\d{2}-\d{2}/u.test(row.time) &&
        !Number.isNaN(Date.parse(row.time)) &&
        typeof row.close === "number" &&
        Number.isFinite(row.close),
    )
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function historyChartPoints(rows) {
  const values = marketHistory(rows);
  if (!values.length) return null;
  const min = Math.min(...values.map((row) => row.close)),
    max = Math.max(...values.map((row) => row.close));
  const points = values.map((row, index) => ({
    x: values.length === 1 ? 300 : 12 + (index * 576) / (values.length - 1),
    y: max === min ? 72 : 132 - ((row.close - min) * 120) / (max - min),
  }));
  return { values, points, min, max };
}

export function marketErrorMessage(error, locale = "vi") {
  const codes = {
    market_rate_limited: [
      "Nguồn đang giới hạn số lượt truy cập. Thử lại sau.",
      "The source is limiting requests. Try again later.",
    ],
    market_timeout: [
      "Nguồn phản hồi quá lâu. Thử cập nhật lại.",
      "The source took too long to respond. Try refreshing.",
    ],
    market_source_timeout: [
      "Nguồn phản hồi quá lâu. Thử cập nhật lại.",
      "The source took too long to respond. Try refreshing.",
    ],
    market_exchange_mismatch: [
      "Mã và sàn tại nguồn không khớp với lựa chọn. Dữ liệu chưa được hiển thị.",
      "The source stock or exchange does not match the selection. Its data is not shown.",
    ],
  };
  return (
    codes[error?.code]?.[locale === "vi" ? 0 : 1] ??
    (locale === "vi"
      ? "Chưa đọc được dữ liệu từ nguồn công khai. Thử cập nhật lại."
      : "The public data source could not be read. Try refreshing.")
  );
}
