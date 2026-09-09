/**
 * Deterministic ranking utilities for X Nhân search results.
 *
 * The ranker intentionally uses only retrievable evidence: post text, a
 * timestamp encoded in an X status ID (or an already validated timestamp),
 * search-result ranks, and observed query coverage. It never estimates
 * engagement, popularity, or account authority.
 */

export const X_STATUS_SNOWFLAKE_EPOCH_MS = 1_288_834_974_657;
export const X_STATUS_TIMESTAMP_PROVENANCE = "status_id";

const X_STATUS_TIMESTAMP_SHIFT = 22n;
const X_STATUS_MIN_DIGITS = 15;
const X_STATUS_MAX_DIGITS = 20;
const X_STATUS_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_RANKED_POSTS = 20;
const RRF_K = 60;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const NEAR_DUPLICATE_THRESHOLD = 0.82;
const MMR_LAMBDA = 0.78;
const SAME_AUTHOR_SIMILARITY_FLOOR = 0.65;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const IMPLICIT_FRESHNESS_FALLBACK_DAYS = 730;
const MAX_RELATIVE_WINDOW_MS = 10 * 365 * DAY_MS;
const MAX_QUERY_FAMILIES = 32;
const MAX_QUERY_FAMILY_LENGTH = 300;
const MAX_DATE_MS = 8_640_000_000_000_000;

const TEMPORAL_STOP_WORDS = new Set([
  "ago",
  "breaking",
  "cap",
  "current",
  "currently",
  "before",
  "den",
  "day",
  "daya",
  "đay",
  "đây",
  "days",
  "dayday",
  "daynay",
  "dang",
  "gan",
  "ganday",
  "gio",
  "hien",
  "hom",
  "hour",
  "hours",
  "latest",
  "last",
  "moi",
  "month",
  "months",
  "nam",
  "nay",
  "newest",
  "news",
  "now",
  "previous",
  "recent",
  "recently",
  "since",
  "qua",
  "thang",
  "this",
  "today",
  "tuan",
  "truoc",
  "until",
  "update",
  "updated",
  "week",
  "weeks",
  "year",
  "years",
  "yesterday",
]);

const GENERAL_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "boi",
  "cac",
  "cho",
  "co",
  "cua",
  "da",
  "de",
  "do",
  "duoc",
  "for",
  "from",
  "gi",
  "in",
  "is",
  "la",
  "nhung",
  "of",
  "on",
  "or",
  "the",
  "thi",
  "to",
  "tren",
  "tu",
  "va",
  "ve",
  "voi",
  "what",
  "which",
  "who",
  "why",
]);

function parseObservedAt(value) {
  if (value === undefined) return Date.now();
  const timestamp =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeStatusId(statusId) {
  if (typeof statusId === "bigint") {
    if (statusId < 0n) return null;
    return statusId.toString();
  }
  if (typeof statusId === "number") {
    if (!Number.isSafeInteger(statusId) || statusId < 0) return null;
    return String(statusId);
  }
  if (typeof statusId !== "string") return null;

  const normalized = statusId.trim();
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  return normalized;
}

/**
 * Decode a numeric X status ID using the documented Snowflake layout.
 *
 * Short pre-Snowflake/legacy IDs are rejected instead of being assigned a
 * misleading date near the Snowflake epoch. IDs whose decoded timestamp is
 * later than the observation time plus five minutes of clock skew are also
 * rejected.
 *
 * @param {string|bigint|number} statusId
 * @param {string|Date} observedAt
 * @returns {string|null} An ISO-8601 timestamp or null when it is not provable.
 */
export function decodeXStatusIdTimestamp(statusId, observedAt) {
  const normalized = normalizeStatusId(statusId);
  const observedAtMs = parseObservedAt(observedAt);
  if (
    !normalized ||
    observedAtMs === null ||
    normalized.length < X_STATUS_MIN_DIGITS ||
    normalized.length > X_STATUS_MAX_DIGITS
  ) {
    return null;
  }

  let snowflake;
  try {
    snowflake = BigInt(normalized);
  } catch {
    return null;
  }

  const timestamp =
    Number(snowflake >> X_STATUS_TIMESTAMP_SHIFT) +
    X_STATUS_SNOWFLAKE_EPOCH_MS;
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp < X_STATUS_SNOWFLAKE_EPOCH_MS ||
    timestamp > observedAtMs + X_STATUS_CLOCK_SKEW_MS
  ) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function normalizeForMatching(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/đ/gu, "d");
}

function tokenList(value, { query = false, temporalYears = new Set() } = {}) {
  let normalized = normalizeForMatching(value).replace(
    /https?:\/\/\S+/gu,
    " ",
  );
  if (query) {
    normalized = normalized
      .replace(
        /\b(?:last|past)\s+[+-]?\d+(?:\.\d+)?\s+(?:hours?|days?|weeks?)\b/gu,
        " ",
      )
      .replace(
        /\b[+-]?\d+(?:\.\d+)?\s+(?:gio|ngay|tuan)\s+(?:qua|gan (?:day|đay))\b/gu,
        " ",
      )
      .replace(
        /\b(?:since|before|until)\s+\d{4}-\d{2}-\d{2}\b/gu,
        " ",
      )
      .replace(
        /\b(?:tu\s+\d{4}-\d{2}-\d{2}\s+(?:den|đen) nay|truoc\s+\d{4}-\d{2}-\d{2})\b/gu,
        " ",
      )
      .replace(/\b(?:19|20)\d{2}-\d{2}-\d{2}\b/gu, " ");
  }
  const matches = normalized.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return matches.filter((token) => {
    if (GENERAL_STOP_WORDS.has(token)) return false;
    if (query && TEMPORAL_STOP_WORDS.has(token)) return false;
    if (query && temporalYears.has(Number(token))) return false;
    return token.length > 1;
  });
}

function unique(values) {
  return [...new Set(values)];
}

function parseIsoCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return timestamp;
}

function isoWindow(startMs, endExclusiveMs) {
  return {
    start: new Date(startMs).toISOString(),
    endExclusive: new Date(endExclusiveMs).toISOString(),
  };
}

function boundedObservedEndExclusive(observedAtMs) {
  if (
    !Number.isSafeInteger(observedAtMs) ||
    observedAtMs < X_STATUS_SNOWFLAKE_EPOCH_MS ||
    observedAtMs >= MAX_DATE_MS
  ) {
    return null;
  }
  return observedAtMs + 1;
}

function boundedRelativeDuration(rawCount, unitMs) {
  if (!/^\d+$/u.test(rawCount) || rawCount.length > 15) return null;
  const count = Number(rawCount);
  const duration = count * unitMs;
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isSafeInteger(duration) ||
    duration > MAX_RELATIVE_WINDOW_MS
  ) {
    return null;
  }
  return duration;
}

function relativeQuantityScope(normalizedQuery, observedAtMs) {
  const matches = [];
  for (const match of normalizedQuery.matchAll(
    /\b(?:last|past)\s+([+-]?\d+(?:\.\d+)?)\s+(hours?|days?|weeks?)\b/gu,
  )) {
    matches.push({ count: match[1], unit: match[2] });
  }
  for (const match of normalizedQuery.matchAll(
    /\b([+-]?\d+(?:\.\d+)?)\s+(gio|ngay|tuan)\s+(?:qua|gan (?:day|đay))\b/gu,
  )) {
    matches.push({ count: match[1], unit: match[2] });
  }
  if (matches.length === 0) return null;
  if (matches.length !== 1) return { invalidScope: true };

  const [{ count, unit }] = matches;
  const unitMs = {
    hour: HOUR_MS,
    hours: HOUR_MS,
    gio: HOUR_MS,
    day: DAY_MS,
    days: DAY_MS,
    ngay: DAY_MS,
    week: WEEK_MS,
    weeks: WEEK_MS,
    tuan: WEEK_MS,
  }[unit];
  const duration = boundedRelativeDuration(count, unitMs);
  const endExclusive = boundedObservedEndExclusive(observedAtMs);
  if (duration === null || endExclusive === null) {
    return { invalidScope: true };
  }

  const start = observedAtMs - duration;
  if (!Number.isSafeInteger(start) || start < -MAX_DATE_MS) {
    return { invalidScope: true };
  }
  return { window: isoWindow(start, endExclusive) };
}

function directionalIsoDateScope(normalizedQuery, observedAtMs) {
  const dateMatches = [
    ...normalizedQuery.matchAll(/\b\d{4}-\d{2}-\d{2}\b/gu),
  ];
  if (dateMatches.length !== 1) return null;

  const patterns = [
    { kind: "current", mode: "since", pattern: /\bsince\s+(\d{4}-\d{2}-\d{2})\b/u },
    { kind: "current", mode: "since", pattern: /\btu\s+(\d{4}-\d{2}-\d{2})\s+(?:den|đen) nay\b/u },
    { kind: "historical", mode: "before", pattern: /\bbefore\s+(\d{4}-\d{2}-\d{2})\b/u },
    { kind: "historical", mode: "until", pattern: /\buntil\s+(\d{4}-\d{2}-\d{2})\b/u },
    { kind: "historical", mode: "before", pattern: /\btruoc\s+(\d{4}-\d{2}-\d{2})\b/u },
  ];
  const matches = patterns
    .map((candidate) => ({ ...candidate, match: candidate.pattern.exec(normalizedQuery) }))
    .filter(({ match }) => match !== null);
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    return { kind: "historical", invalidScope: true };
  }

  const [{ kind, mode, match }] = matches;
  const dateMs = parseIsoCalendarDate(match[1]);
  const observedEndExclusive = boundedObservedEndExclusive(observedAtMs);
  if (
    dateMs === null ||
    observedEndExclusive === null ||
    dateMs > observedAtMs
  ) {
    return { kind, invalidScope: true };
  }

  if (mode === "since") {
    return { kind, window: isoWindow(dateMs, observedEndExclusive) };
  }

  const requestedEndExclusive =
    mode === "until" ? dateMs + DAY_MS : dateMs;
  const endExclusive = Math.min(requestedEndExclusive, observedEndExclusive);
  if (endExclusive <= X_STATUS_SNOWFLAKE_EPOCH_MS) {
    return { kind, invalidScope: true };
  }
  return {
    kind,
    window: isoWindow(X_STATUS_SNOWFLAKE_EPOCH_MS, endExclusive),
  };
}

function hasRangeConnectorBetween(normalizedQuery, left, right) {
  const between = normalizedQuery
    .slice(left.endIndex, right.index)
    .trim();
  if (/^(?:to|through|thru|until|till|den|đen|toi|-|–|—)$/u.test(between)) {
    return true;
  }

  if (!/^(?:and|va)$/u.test(between)) return false;
  const prefix = normalizedQuery.slice(0, left.index).trimEnd();
  return /\b(?:between|from|tu)\s*$/u.test(prefix);
}

function mergeIsoWindows(windows) {
  const ordered = windows
    .map(({ start, endExclusive }) => ({
      endExclusive: Date.parse(endExclusive),
      start: Date.parse(start),
    }))
    .filter(
      ({ start, endExclusive }) =>
        Number.isFinite(start) &&
        Number.isFinite(endExclusive) &&
        start < endExclusive,
    )
    .sort(
      (left, right) =>
        left.start - right.start || left.endExclusive - right.endExclusive,
    );
  const merged = [];
  for (const current of ordered) {
    const previous = merged.at(-1);
    if (!previous || current.start > previous.endExclusive) {
      merged.push({ ...current });
      continue;
    }
    previous.endExclusive = Math.max(previous.endExclusive, current.endExclusive);
  }
  return merged.map(({ start, endExclusive }) => isoWindow(start, endExclusive));
}

function explicitIsoDateScope(normalizedQuery) {
  const matches = [
    ...normalizedQuery.matchAll(/\b(?:19|20)\d{2}-\d{2}-\d{2}\b/gu),
  ];
  const dates = [];
  for (const match of matches) {
    const timestamp = parseIsoCalendarDate(match[0]);
    if (timestamp === null) return { invalidScope: true };
    dates.push({
      endIndex: match.index + match[0].length,
      index: match.index,
      timestamp,
    });
  }
  if (dates.length === 0) return null;

  const windows = [];
  for (let index = 0; index < dates.length; ) {
    const current = dates[index];
    const next = dates[index + 1];
    if (next && hasRangeConnectorBetween(normalizedQuery, current, next)) {
      const start = Math.min(current.timestamp, next.timestamp);
      const end = Math.max(current.timestamp, next.timestamp);
      windows.push(isoWindow(start, end + DAY_MS));
      index += 2;
      continue;
    }
    windows.push(isoWindow(current.timestamp, current.timestamp + DAY_MS));
    index += 1;
  }
  const merged = mergeIsoWindows(windows);
  return merged.length === 1 ? { window: merged[0] } : { windows: merged };
}

function explicitYearValues(normalizedQuery) {
  const values = [];
  for (const match of normalizedQuery.matchAll(/\b(?:19|20)\d{2}\b/gu)) {
    const year = Number(match[0]);
    values.push({
      endIndex: match.index + match[0].length,
      index: match.index,
      year,
    });
  }
  if (values.length === 0) return [];

  const explicitlyScopedIndexes = new Set();
  values.forEach(({ index }, valueIndex) => {
    const prefix = normalizedQuery.slice(Math.max(0, index - 32), index);
    if (
      /(?:^|\b)(?:in|during|from|for|since|before|after|until|through|year|dated|published in|posted in|nam|vao nam|trong nam|tu nam|truoc nam|sau nam)\s*$/u.test(
        prefix,
      )
    ) {
      explicitlyScopedIndexes.add(valueIndex);
    }

    const suffix = normalizedQuery.slice(
      index + String(values[valueIndex].year).length,
      index + String(values[valueIndex].year).length + 40,
    );
    const temporalDocumentSuffix =
      /^\s*(?:announcements?|posts?|news|articles?|reports?|tweets?|publications?)\b/u.test(
        suffix,
      );
    const atQueryStart = normalizedQuery.slice(0, index).trim() === "";
    const versionedProductPrefix =
      /(?:windows server|sql server|office|ubuntu|android|ios|macos|(?:iso|iec)\s+\d+)\s*:?\s*$/u.test(
        prefix,
      );
    if (
      (temporalDocumentSuffix && !versionedProductPrefix) ||
      (atQueryStart &&
        /\b(?:announcements?|posts?|news|articles?|reports?|tweets?|publications?)\b/u.test(
          suffix,
        ))
    ) {
      explicitlyScopedIndexes.add(valueIndex);
    }
  });
  values.forEach((current, index) => {
    const next = values[index + 1];
    if (next && hasRangeConnectorBetween(normalizedQuery, current, next)) {
      explicitlyScopedIndexes.add(index);
      explicitlyScopedIndexes.add(index + 1);
    }
  });
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < values.length - 1; index += 1) {
      const between = normalizedQuery.slice(
        values[index].endIndex,
        values[index + 1].index,
      );
      if (!/^\s*(?:,|and|or|&|va|hoac)\s*$/u.test(between)) continue;
      if (
        explicitlyScopedIndexes.has(index) &&
        !explicitlyScopedIndexes.has(index + 1)
      ) {
        explicitlyScopedIndexes.add(index + 1);
        changed = true;
      }
      if (
        explicitlyScopedIndexes.has(index + 1) &&
        !explicitlyScopedIndexes.has(index)
      ) {
        explicitlyScopedIndexes.add(index);
        changed = true;
      }
    }
  }
  return values.filter((_, index) => explicitlyScopedIndexes.has(index));
}

function explicitYearScope(normalizedQuery) {
  const values = explicitYearValues(normalizedQuery);
  if (values.length === 0) return null;

  let hasRange = false;
  const windows = [];
  for (let index = 0; index < values.length; ) {
    const current = values[index];
    const next = values[index + 1];
    if (next && hasRangeConnectorBetween(normalizedQuery, current, next)) {
      hasRange = true;
      const startYear = Math.min(current.year, next.year);
      const endYear = Math.max(current.year, next.year);
      windows.push(
        isoWindow(Date.UTC(startYear, 0, 1), Date.UTC(endYear + 1, 0, 1)),
      );
      index += 2;
      continue;
    }
    windows.push(
      isoWindow(Date.UTC(current.year, 0, 1), Date.UTC(current.year + 1, 0, 1)),
    );
    index += 1;
  }
  const years = unique(values.map(({ year }) => year)).sort(
    (left, right) => left - right,
  );
  if (hasRange) {
    const merged = mergeIsoWindows(windows);
    return merged.length === 1 ? { window: merged[0] } : { windows: merged };
  }
  return {
    years,
    window: {
      start: `${years[0]}-01-01T00:00:00.000Z`,
      endExclusive: `${years.at(-1) + 1}-01-01T00:00:00.000Z`,
    },
  };
}

function previousCalendarScope(normalizedQuery, observedAtMs) {
  const wantsYesterday = /\b(yesterday|hom qua)\b/u.test(normalizedQuery);
  const wantsPreviousWeek = /\b((?:last|previous) week|tuan truoc)\b/u.test(
    normalizedQuery,
  );
  const wantsPreviousMonth = /\b((?:last|previous) month|thang truoc)\b/u.test(
    normalizedQuery,
  );
  const wantsPreviousYear = /\b((?:last|previous) year|nam truoc)\b/u.test(
    normalizedQuery,
  );
  const requestedScopeCount = [
    wantsYesterday,
    wantsPreviousWeek,
    wantsPreviousMonth,
    wantsPreviousYear,
  ].filter(Boolean).length;
  if (requestedScopeCount === 0) return null;
  if (requestedScopeCount !== 1) return { invalidScope: true };
  if (observedAtMs === null) return { invalidScope: true };

  const observed = new Date(observedAtMs);
  const observedDayStart = Date.UTC(
    observed.getUTCFullYear(),
    observed.getUTCMonth(),
    observed.getUTCDate(),
  );

  if (wantsYesterday) {
    return { window: isoWindow(observedDayStart - DAY_MS, observedDayStart) };
  }

  if (wantsPreviousWeek) {
    const daysSinceMonday = (observed.getUTCDay() + 6) % 7;
    const currentWeekStart = observedDayStart - daysSinceMonday * DAY_MS;
    return {
      window: isoWindow(currentWeekStart - 7 * DAY_MS, currentWeekStart),
    };
  }

  if (wantsPreviousMonth) {
    const currentMonthStart = Date.UTC(
      observed.getUTCFullYear(),
      observed.getUTCMonth(),
      1,
    );
    const previousMonthStart = Date.UTC(
      observed.getUTCFullYear(),
      observed.getUTCMonth() - 1,
      1,
    );
    return { window: isoWindow(previousMonthStart, currentMonthStart) };
  }

  if (wantsPreviousYear) {
    const currentYearStart = Date.UTC(observed.getUTCFullYear(), 0, 1);
    const previousYearStart = Date.UTC(observed.getUTCFullYear() - 1, 0, 1);
    return { window: isoWindow(previousYearStart, currentYearStart) };
  }

  return null;
}

function currentCalendarScope(normalizedQuery, observedAtMs) {
  const wantsToday = /\b(today|hom nay)\b/u.test(normalizedQuery);
  const wantsThisWeek = /\b((?:this|current) week|tuan nay)\b/u.test(
    normalizedQuery,
  );
  const wantsThisMonth = /\b((?:this|current) month|thang nay)\b/u.test(
    normalizedQuery,
  );
  const wantsThisYear = /\b((?:this|current) year|nam nay)\b/u.test(
    normalizedQuery,
  );
  const requestedScopeCount = [
    wantsToday,
    wantsThisWeek,
    wantsThisMonth,
    wantsThisYear,
  ].filter(Boolean).length;
  if (requestedScopeCount === 0) return null;
  if (requestedScopeCount !== 1 || observedAtMs === null) {
    return { invalidScope: true };
  }
  const observedEndExclusive = boundedObservedEndExclusive(observedAtMs);
  if (observedEndExclusive === null) return { invalidScope: true };

  const observed = new Date(observedAtMs);
  const year = observed.getUTCFullYear();
  const month = observed.getUTCMonth();
  const observedDayStart = Date.UTC(year, month, observed.getUTCDate());
  if (wantsToday) {
    return { window: isoWindow(observedDayStart, observedEndExclusive) };
  }
  if (wantsThisWeek) {
    const daysSinceMonday = (observed.getUTCDay() + 6) % 7;
    const currentWeekStart = observedDayStart - daysSinceMonday * DAY_MS;
    return {
      window: isoWindow(currentWeekStart, observedEndExclusive),
    };
  }
  if (wantsThisMonth) {
    return {
      window: isoWindow(Date.UTC(year, month, 1), observedEndExclusive),
    };
  }
  return {
    window: isoWindow(Date.UTC(year, 0, 1), observedEndExclusive),
  };
}

/**
 * Classify temporal wording before scoring. Explicit ISO dates/ranges and
 * locally scoped years take precedence over relative wording such as "latest"
 * or "last 24 hours" so a historical request cannot be silently converted
 * into a current-events request. Unscoped four-digit values remain ordinary
 * query data because they may be product, model, or standards versions.
 *
 * @param {string} query
 * @param {string|Date|number} observedAt Observation time used for relative
 *   windows. It is never replaced with wall-clock time during classification.
 * @returns {{kind: "historical"|"current", invalidScope?: boolean, years?: number[], window?: {start: string, endExclusive: string}, windows?: Array<{start: string, endExclusive: string}>}|{kind: "latest"|"current", windowDays: number, freshnessPolicy: "strict"|"prefer"}|{kind: "general", windowDays: number}}
 */
export function classifyXNhanTemporalIntent(query, observedAt) {
  const normalized = normalizeForMatching(query);
  const observedAtMs =
    observedAt === undefined ? null : parseObservedAt(observedAt);
  const directionalDateScope = directionalIsoDateScope(normalized, observedAtMs);
  if (directionalDateScope !== null) {
    return directionalDateScope;
  }

  const dateScope = explicitIsoDateScope(normalized);
  if (dateScope !== null) {
    return { kind: "historical", ...dateScope };
  }

  const yearScope = explicitYearScope(normalized);
  if (yearScope !== null) {
    return { kind: "historical", ...yearScope };
  }

  // Rolling, previous-calendar, and current-calendar scopes deliberately share
  // one ambiguity gate. Silently choosing one of multiple expressions would
  // discard intent (for example, "today and yesterday") or invent union/AND
  // semantics that the query never made explicit.
  const quantityScope = relativeQuantityScope(normalized, observedAtMs);
  const previousScope = previousCalendarScope(normalized, observedAtMs);
  const currentScope = currentCalendarScope(normalized, observedAtMs);
  const relativeScopes = [quantityScope, previousScope, currentScope].filter(
    (scope) => scope !== null,
  );
  if (
    relativeScopes.length > 1 ||
    relativeScopes.some((scope) => scope.invalidScope === true)
  ) {
    return { kind: "current", invalidScope: true };
  }
  if (quantityScope !== null) {
    return { kind: "current", ...quantityScope };
  }
  if (previousScope !== null) {
    return { kind: "historical", ...previousScope };
  }
  if (currentScope !== null) {
    return { kind: "current", ...currentScope };
  }

  if (
    /\b(latest|newest|recent|recently|breaking|up[ -]?to[ -]?date)\b/u.test(
      normalized,
    ) ||
    /\b(moi nhat|gan day|gan đay|moi day|moi đay|gan nhat|vua moi|cap nhat)\b/u.test(
      normalized,
    )
  ) {
    return { kind: "latest", windowDays: 30, freshnessPolicy: "strict" };
  }

  if (
    /\b(current|currently|now|at present)\b/u.test(
      normalized,
    ) ||
    /\b(hien nay|hien tai|bay gio|dang)\b/u.test(
      normalized,
    )
  ) {
    return { kind: "current", windowDays: 180, freshnessPolicy: "strict" };
  }

  // A small set of state-bearing question forms is temporally current even
  // when the user omits an explicit word such as "now". Keep this deliberately
  // narrow so definitions and historical questions are not recency-filtered.
  if (
    /\b(?:who is|who's)\s+(?:the\s+)?(?:ceo|cto|president|chair(?:man|woman|person)?|head|leader|owner|minister|prime minister|governor|coach)\b/u.test(normalized) ||
    /\b(?:what (?:are|is) .{0,80} saying|update on|so far)\b/u.test(normalized) ||
    /\b(?:price|availability|service status|system status|release date|launch date|schedule|standings)\s+(?:of|for)\b/u.test(normalized) ||
    /\b(?:ai la|la ai)\s+(?:ceo|cto|giam doc|chu tich|lanh dao|chu so huu|bo truong|thu tuong|thong doc|huan luyen vien)\b/u.test(normalized) ||
    /\b(?:tinh hinh|cap nhat ve|cho den nay)\b/u.test(normalized) ||
    /\b(?:gia|tinh trang|lich trinh|ngay phat hanh|ngay ra mat)\s+(?:cua|cho)\b/u.test(normalized)
  ) {
    return { kind: "current", windowDays: 180, freshnessPolicy: "prefer" };
  }

  return { kind: "general", windowDays: 730 };
}

function postDocument(post) {
  return [
    post?.text,
    post?.author?.handle,
    post?.author?.displayName,
  ]
    .filter((value) => typeof value === "string")
    .join(" ");
}

function termFrequency(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function bm25Scores(queryTokens, documentTokens) {
  if (queryTokens.length === 0 || documentTokens.length === 0) {
    return documentTokens.map(() => 0);
  }

  const queryTerms = unique(queryTokens);
  const documentFrequencies = new Map();
  const frequencies = documentTokens.map((tokens) => termFrequency(tokens));
  for (const term of queryTerms) {
    documentFrequencies.set(
      term,
      frequencies.reduce(
        (count, frequency) => count + (frequency.has(term) ? 1 : 0),
        0,
      ),
    );
  }

  const averageLength =
    documentTokens.reduce((sum, tokens) => sum + tokens.length, 0) /
      documentTokens.length || 1;
  return frequencies.map((frequency, index) => {
    const documentLength = documentTokens[index].length;
    let score = 0;
    for (const term of queryTerms) {
      const occurrences = frequency.get(term) ?? 0;
      if (occurrences === 0) continue;
      const documentFrequency = documentFrequencies.get(term) ?? 0;
      const inverseDocumentFrequency = Math.log(
        1 +
          (documentTokens.length - documentFrequency + 0.5) /
            (documentFrequency + 0.5),
      );
      const denominator =
        occurrences +
        BM25_K1 *
          (1 - BM25_B + BM25_B * (documentLength / averageLength));
      score +=
        inverseDocumentFrequency *
        ((occurrences * (BM25_K1 + 1)) / denominator);
    }
    return score;
  });
}

function safePositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function reciprocalRankScore(ranks) {
  if (!Array.isArray(ranks)) return 0;
  return ranks.map(safePositiveInteger).filter(Boolean).reduce(
    (score, rank) => score + 1 / (RRF_K + rank),
    0,
  );
}

function bestCompletedSearchRank(ranks) {
  if (!Array.isArray(ranks)) return null;
  const validRanks = ranks.map(safePositiveInteger).filter(Boolean);
  return validRanks.length === 0 ? null : Math.min(...validRanks);
}

function normalizedQueryFamilyCount(queryFamilies) {
  if (!Array.isArray(queryFamilies)) return 0;
  const normalizedFamilies = new Set();
  for (const family of queryFamilies.slice(0, MAX_QUERY_FAMILIES)) {
    if (typeof family !== "string") continue;
    const normalized = normalizeForMatching(family)
      .replace(/đ/gu, "d")
      .replace(/[^\p{L}\p{N}_]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (
      normalized.length < 2 ||
      normalized.length > MAX_QUERY_FAMILY_LENGTH
    ) {
      continue;
    }
    normalizedFamilies.add(normalized);
  }
  return normalizedFamilies.size;
}

function validPublishedAt(post, observedAtMs) {
  if (typeof post?.publishedAt === "string") {
    const timestamp = Date.parse(post.publishedAt);
    if (
      Number.isFinite(timestamp) &&
      timestamp >= X_STATUS_SNOWFLAKE_EPOCH_MS &&
      timestamp <= observedAtMs
    ) {
      return timestamp;
    }
    // A present but invalid timestamp is contradictory evidence. Do not hide it
    // by falling back to the status ID and ranking the post under a different
    // time than the object declares.
    return null;
  }

  const decoded = decodeXStatusIdTimestamp(
    post?.id,
    new Date(observedAtMs).toISOString(),
  );
  if (decoded === null) return null;
  const timestamp = Date.parse(decoded);
  return Number.isFinite(timestamp) && timestamp <= observedAtMs
    ? timestamp
    : null;
}

function hasHardTemporalScope(intent) {
  return (
    intent.invalidScope === true ||
    (Array.isArray(intent.years) && intent.years.length > 0) ||
    (Array.isArray(intent.windows) && intent.windows.length > 0) ||
    (intent.window && typeof intent.window === "object")
  );
}

function validIntentWindow(window) {
  if (!window || Array.isArray(window) || typeof window !== "object") {
    return false;
  }
  const start = Date.parse(window.start);
  const endExclusive = Date.parse(window.endExclusive);
  return (
    Number.isFinite(start) &&
    Number.isFinite(endExclusive) &&
    start < endExclusive
  );
}

function validProvidedTemporalScope(scope) {
  if (!scope || Array.isArray(scope) || typeof scope !== "object") return false;
  if (!["historical", "current", "latest", "general"].includes(scope.kind)) {
    return false;
  }
  if (scope.invalidScope === true) {
    return scope.kind === "historical" || scope.kind === "current";
  }

  if (
    scope.years !== undefined &&
    (!Array.isArray(scope.years) || scope.years.length === 0)
  ) {
    return false;
  }
  const hasYears = Array.isArray(scope.years);
  if (
    hasYears &&
    (scope.years.length > 64 ||
      scope.years.some(
        (year) =>
          !Number.isSafeInteger(year) || year < 1900 || year > 2099,
      ))
  ) {
    return false;
  }
  const hasWindow = scope.window !== undefined;
  if (hasWindow && !validIntentWindow(scope.window)) return false;
  if (
    scope.windows !== undefined &&
    (!Array.isArray(scope.windows) || scope.windows.length === 0)
  ) {
    return false;
  }
  const hasWindows = Array.isArray(scope.windows);
  if (
    hasWindows &&
    (scope.windows.length > 64 ||
      scope.windows.some((window) => !validIntentWindow(window)))
  ) {
    return false;
  }

  if (hasYears || hasWindow || hasWindows) {
    return scope.kind === "historical" || scope.kind === "current";
  }
  if (scope.kind === "general" && scope.freshnessPolicy !== undefined) {
    return false;
  }
  if (
    scope.kind === "latest" &&
    scope.freshnessPolicy !== "strict"
  ) {
    return false;
  }
  if (
    scope.kind === "current" &&
    !["strict", "prefer"].includes(scope.freshnessPolicy)
  ) {
    return false;
  }
  return (
    ["latest", "current", "general"].includes(scope.kind) &&
    Number.isSafeInteger(scope.windowDays) &&
    scope.windowDays > 0 &&
    scope.windowDays <= 10 * 365
  );
}

function sameIntentWindow(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.start === right.start && left.endExclusive === right.endExclusive
  );
}

function sameTemporalScope(left, right) {
  if (
    left.kind !== right.kind ||
    left.invalidScope !== right.invalidScope ||
    left.windowDays !== right.windowDays ||
    left.freshnessPolicy !== right.freshnessPolicy ||
    !sameIntentWindow(left.window, right.window)
  ) {
    return false;
  }

  const leftYears = left.years ?? [];
  const rightYears = right.years ?? [];
  if (
    leftYears.length !== rightYears.length ||
    leftYears.some((year, index) => year !== rightYears[index])
  ) {
    return false;
  }

  const leftWindows = left.windows ?? [];
  const rightWindows = right.windows ?? [];
  return (
    leftWindows.length === rightWindows.length &&
    leftWindows.every((window, index) =>
      sameIntentWindow(window, rightWindows[index]),
    )
  );
}

/**
 * Keep lexical follow-up context separate from temporal intent. An explicit
 * temporal instruction in the current question wins; an otherwise general
 * context-dependent follow-up inherits the immediately preceding user's scope.
 */
export function resolveXNhanContextualTemporalScope(
  currentQuery,
  contextualQuery,
  observedAt,
) {
  const currentScope = classifyXNhanTemporalIntent(currentQuery, observedAt);
  const useContextualScope =
    typeof contextualQuery === "string" &&
    contextualQuery !== currentQuery &&
    currentScope.kind === "general" &&
    currentScope.invalidScope !== true;
  const temporalQuery = useContextualScope ? contextualQuery : currentQuery;
  return {
    temporalQuery,
    temporalScope: classifyXNhanTemporalIntent(temporalQuery, observedAt),
  };
}

function satisfiesHardTemporalScope(timestamp, intent) {
  if (!hasHardTemporalScope(intent)) return true;
  if (intent.invalidScope === true) return false;
  if (timestamp === null) return false;

  if (Array.isArray(intent.years) && intent.years.length > 0) {
    return intent.years.includes(new Date(timestamp).getUTCFullYear());
  }

  if (Array.isArray(intent.windows) && intent.windows.length > 0) {
    return intent.windows.some(({ start, endExclusive }) => {
      const startMs = Date.parse(start);
      const endExclusiveMs = Date.parse(endExclusive);
      return (
        Number.isFinite(startMs) &&
        Number.isFinite(endExclusiveMs) &&
        timestamp >= startMs &&
        timestamp < endExclusiveMs
      );
    });
  }

  const start = Date.parse(intent.window?.start);
  const endExclusive = Date.parse(intent.window?.endExclusive);
  return (
    Number.isFinite(start) &&
    Number.isFinite(endExclusive) &&
    timestamp >= start &&
    timestamp < endExclusive
  );
}

function satisfiesFreshnessFloor(timestamp, intent, observedAtMs) {
  // Explicit date/year/calendar/rolling windows own their temporal boundary.
  // Do not layer the default freshness floor on top of them: a historical
  // request must retain precedence over generic "latest" or "current" words.
  if (hasHardTemporalScope(intent)) return true;
  if (intent.kind !== "latest" && intent.kind !== "current") return true;
  if (
    timestamp === null ||
    !Number.isSafeInteger(intent.windowDays) ||
    intent.windowDays <= 0
  ) {
    return false;
  }

  const ageMs = observedAtMs - timestamp;
  const windowMs = intent.windowDays * DAY_MS;
  return ageMs >= 0 && ageMs <= windowMs;
}

function satisfiesImplicitFreshnessFallback(timestamp, intent, observedAtMs) {
  if (
    intent.freshnessPolicy !== "prefer" ||
    hasHardTemporalScope(intent) ||
    timestamp === null
  ) {
    return false;
  }

  const ageMs = observedAtMs - timestamp;
  return (
    ageMs >= 0 && ageMs <= IMPLICIT_FRESHNESS_FALLBACK_DAYS * DAY_MS
  );
}

function temporalScore(timestamp, intent, observedAtMs) {
  if (timestamp === null) return 0;

  if (hasHardTemporalScope(intent)) return 1;

  const ageDays = Math.max(0, observedAtMs - timestamp) / 86_400_000;
  const halfLifeDays = {
    latest: 14,
    current: 90,
    general: 365,
  }[intent.kind];
  return Math.exp((-Math.LN2 * ageDays) / halfLifeDays);
}

function normalizeScores(values) {
  const maximum = Math.max(0, ...values);
  if (maximum === 0) return values.map(() => 0);
  return values.map((value) => value / maximum);
}

function scoreWeights(kind) {
  return {
    latest: { relevance: 0.56, temporal: 0.25, evidence: 0.19 },
    current: { relevance: 0.62, temporal: 0.18, evidence: 0.2 },
    historical: { relevance: 0.55, temporal: 0.27, evidence: 0.18 },
    general: { relevance: 0.7, temporal: 0.1, evidence: 0.2 },
  }[kind];
}

function stablePostKey(post, originalIndex) {
  for (const value of [post?.id, post?.url]) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return String(originalIndex).padStart(8, "0");
}

function compareScored(left, right) {
  return (
    right.score - left.score ||
    right.relevance - left.relevance ||
    right.timestampSort - left.timestampSort ||
    left.key.localeCompare(right.key) ||
    left.originalIndex - right.originalIndex
  );
}

function jaccardSimilarity(leftTokens, rightTokens) {
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function normalizedAuthorHandle(post) {
  return typeof post?.author?.handle === "string"
    ? post.author.handle.trim().toLowerCase()
    : "";
}

function diversify(scored, limit, { preferAuthorDiversity = false } = {}) {
  const remaining = [...scored].sort(compareScored);
  const selected = [];
  while (remaining.length > 0 && selected.length < limit) {
    let bestIndex = -1;
    let bestMmr = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const candidateAuthor = normalizedAuthorHandle(candidate.post);
      const maximumSimilarity = selected.reduce(
        (maximum, chosen) => {
          const lexicalSimilarity = jaccardSimilarity(
            candidate.textTokens,
            chosen.textTokens,
          );
          const repeatedAuthorSimilarity =
            preferAuthorDiversity &&
            candidateAuthor &&
            candidateAuthor === normalizedAuthorHandle(chosen.post)
              ? SAME_AUTHOR_SIMILARITY_FLOOR
              : 0;
          return Math.max(maximum, lexicalSimilarity, repeatedAuthorSimilarity);
        },
        0,
      );
      if (maximumSimilarity >= NEAR_DUPLICATE_THRESHOLD) continue;

      const mmr =
        MMR_LAMBDA * candidate.score -
        (1 - MMR_LAMBDA) * maximumSimilarity;
      if (
        mmr > bestMmr ||
        (mmr === bestMmr &&
          (bestIndex === -1 ||
            compareScored(candidate, remaining[bestIndex]) < 0))
      ) {
        bestMmr = mmr;
        bestIndex = index;
      }
    }

    if (bestIndex === -1) break;
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected;
}

/**
 * Rank X post candidates under a transparent scoring hypothesis:
 *
 * 1. Original-query relevance is a blend of corpus BM25 and query-term
 *    coverage. A lexical gate excludes low-overlap candidates unless completed
 *    search evidence places them in the top three or two distinct normalized
 *    query families retrieved them.
 * 2. Explicit years, ISO dates/ranges, bounded rolling windows, and calendar
 *    windows are hard filters: unknown or out-of-window timestamps cannot
 *    enter selection. Explicit latest/current wording also keeps its default
 *    freshness floor. Implicit present-state questions prefer that floor and,
 *    only when it yields no timestamp-valid candidates, widen once to a bounded
 *    two-year floor. Other intents use a query-adaptive temporal score with a
 *    14-day half-life for "latest", 90 days for "current", or 365 days for
 *    general queries.
 * 3. Search evidence combines reciprocal-rank fusion (k=60) with observed
 *    query-hit coverage. It is not a popularity signal.
 * 4. MMR/Jaccard selection removes near-duplicates and rewards diversity.
 * 5. The selected set is presented newest-to-oldest, with unknown timestamps
 *    last. Temporal presentation never bypasses relevance selection.
 *
 * The function returns the original post objects without mutation.
 *
 * @param {string} query
 * @param {Array<{post: object, ranks?: number[], queryHits?: number, queryFamilies?: string[]}>} entries
 * @param {{observedAt?: string|Date, limit?: number, preferAuthorDiversity?: boolean, temporalScope?: object}} options
 * @returns {object[]}
 */
export function rankXPostCandidates(
  query,
  entries,
  {
    observedAt,
    limit = MAX_RANKED_POSTS,
    preferAuthorDiversity = false,
    temporalQuery = query,
    temporalScope,
  } = {},
) {
  if (!Array.isArray(entries)) return [];
  const observedAtMs = parseObservedAt(observedAt);
  if (observedAtMs === null) return [];
  const boundedLimit = Math.min(
    MAX_RANKED_POSTS,
    Math.max(0, Number.isFinite(limit) ? Math.floor(limit) : MAX_RANKED_POSTS),
  );
  if (boundedLimit === 0) return [];

  const derivedIntent = classifyXNhanTemporalIntent(
    temporalQuery,
    new Date(observedAtMs),
  );
  if (
    temporalScope !== undefined &&
    (!validProvidedTemporalScope(temporalScope) ||
      !sameTemporalScope(temporalScope, derivedIntent))
  ) {
    return [];
  }
  const intent = temporalScope ?? derivedIntent;
  const timestampedEntries = entries
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .filter(
      ({ entry }) =>
        entry &&
        !Array.isArray(entry) &&
        typeof entry === "object" &&
        entry.post &&
        !Array.isArray(entry.post) &&
        typeof entry.post === "object",
    )
    .map(({ entry, originalIndex }) => ({
      entry,
      originalIndex,
      timestamp: validPublishedAt(entry.post, observedAtMs),
    }));
  let validEntries = timestampedEntries.filter(
    ({ timestamp }) =>
      satisfiesHardTemporalScope(timestamp, intent) &&
      satisfiesFreshnessFloor(timestamp, intent, observedAtMs),
  );
  if (
    validEntries.length === 0 &&
    intent.freshnessPolicy === "prefer" &&
    !hasHardTemporalScope(intent)
  ) {
    validEntries = timestampedEntries.filter(({ timestamp }) =>
      satisfiesImplicitFreshnessFallback(timestamp, intent, observedAtMs),
    );
  }
  if (validEntries.length === 0) return [];

  const temporalYears = new Set(
    explicitYearValues(normalizeForMatching(query)).map(({ year }) => year),
  );
  const queryTokens = tokenList(query, { query: true, temporalYears });
  const documentTokens = validEntries.map(({ entry }) =>
    tokenList(postDocument(entry.post)),
  );
  const rawBm25 = bm25Scores(queryTokens, documentTokens);
  const normalizedBm25 = normalizeScores(rawBm25);
  const queryTermSet = new Set(queryTokens);
  const queryCoverage = documentTokens.map((tokens) => {
    if (queryTermSet.size === 0) return 0;
    const documentTermSet = new Set(tokens);
    let matched = 0;
    for (const term of queryTermSet) {
      if (documentTermSet.has(term)) matched += 1;
    }
    return matched / queryTermSet.size;
  });

  const rawRrf = validEntries.map(({ entry }) =>
    reciprocalRankScore(entry.ranks),
  );
  const normalizedRrf = normalizeScores(rawRrf);
  const rawQueryHits = validEntries.map(({ entry }) =>
    Number.isSafeInteger(entry.queryHits) && entry.queryHits > 0
      ? entry.queryHits
      : 0,
  );
  const normalizedQueryHits = normalizeScores(rawQueryHits);
  const weights = scoreWeights(intent.kind);

  let scored = validEntries.map(({ entry, originalIndex, timestamp }, index) => {
    const relevance =
      0.7 * normalizedBm25[index] + 0.3 * queryCoverage[index];
    const evidence =
      0.6 * normalizedRrf[index] + 0.4 * normalizedQueryHits[index];
    const time = temporalScore(timestamp, intent, observedAtMs);
    return {
      post: entry.post,
      evidenceBackedLowOverlap:
        normalizedQueryFamilyCount(entry.queryFamilies) >= 2 ||
        (bestCompletedSearchRank(entry.ranks) ?? Number.POSITIVE_INFINITY) <= 3,
      originalIndex,
      key: stablePostKey(entry.post, originalIndex),
      timestamp,
      timestampSort: timestamp ?? Number.NEGATIVE_INFINITY,
      relevance,
      score:
        weights.relevance * relevance +
        weights.temporal * time +
        weights.evidence * evidence,
      textTokens: new Set(tokenList(entry.post?.text)),
    };
  });

  const maximumRelevance = Math.max(...scored.map(({ relevance }) => relevance));
  const relevanceFloor = Math.max(0.08, maximumRelevance * 0.2);
  scored = scored.filter(
    ({ evidenceBackedLowOverlap, relevance }) =>
      relevance >= relevanceFloor || evidenceBackedLowOverlap,
  );

  const selected = diversify(scored, boundedLimit, { preferAuthorDiversity });
  selected.sort(
    (left, right) =>
      right.timestampSort - left.timestampSort || compareScored(left, right),
  );
  return selected.map(({ post }) => post);
}
