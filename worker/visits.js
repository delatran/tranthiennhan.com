import { SUPPORTED_LOCALES } from "./config.js";
import {
  errorResponse,
  hasStrictSameOriginEvidence,
  noContentResponse,
  jsonResponse,
  readBoundedRequestBody,
  safeErrorName,
} from "./http.js";
import { digestRateLimitKey } from "./rate-limit.js";

const MAX_VISIT_BODY_BYTES = 2_048;
const VISITOR_RAW_RETENTION_DAYS = 7;
const VISIT_FIELDS = new Set([
  "campaignMedium",
  "campaignName",
  "campaignSource",
  "locale",
  "path",
  "referrerHost",
]);
const VIETNAM_TIME_ZONE = "Asia/Ho_Chi_Minh";

function normalizeIpAddress(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 45 || candidate.includes("%")) return null;

  if (/^\d+(?:\.\d+){3}$/u.test(candidate)) {
    const octets = candidate.split(".");
    if (octets.some((octet) => !/^\d{1,3}$/u.test(octet) || Number(octet) > 255)) {
      return null;
    }
    return octets.map((octet) => String(Number(octet))).join(".");
  }

  if (!candidate.includes(":")) return null;
  try {
    const hostname = new URL(`http://[${candidate}]/`).hostname;
    const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
    return /^[0-9a-f:]+$/u.test(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function boundedMetadata(value, maxLength) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeReferrerHost(value) {
  const candidate = boundedMetadata(value, 253).toLowerCase();
  if (!candidate || !/^[a-z0-9.-]+$/u.test(candidate)) return "";
  try {
    const parsed = new URL(`https://${candidate}/`);
    return parsed.hostname === candidate ? candidate : "";
  } catch {
    return "";
  }
}

function normalizeCampaignValue(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._~-]/gu, "")
    .slice(0, 64);
}

function classifyClient(userAgent) {
  const value = typeof userAgent === "string" ? userAgent : "";
  if (/bot|crawler|spider|slurp|headless/iu.test(value)) {
    return { browserFamily: "bot", deviceClass: "bot" };
  }

  let deviceClass = "desktop";
  if (/ipad|tablet/iu.test(value)) deviceClass = "tablet";
  else if (/mobile|android|iphone|ipod/iu.test(value)) deviceClass = "mobile";
  else if (!value) deviceClass = "unknown";

  let browserFamily = "other";
  if (/edg(?:e|a|ios)?\//iu.test(value)) browserFamily = "edge";
  else if (/samsungbrowser\//iu.test(value)) browserFamily = "samsung";
  else if (/opr\//iu.test(value)) browserFamily = "opera";
  else if (/firefox\/|fxios\//iu.test(value)) browserFamily = "firefox";
  else if (/chrome\/|crios\//iu.test(value)) browserFamily = "chrome";
  else if (/safari\//iu.test(value) && /version\//iu.test(value)) browserFamily = "safari";
  else if (!value) browserFamily = "unknown";

  return { browserFamily, deviceClass };
}

const vietnamDateFormatter = new Intl.DateTimeFormat("en", {
  day: "2-digit",
  month: "2-digit",
  timeZone: VIETNAM_TIME_ZONE,
  year: "numeric",
});

function vietnamDateKey(timestamp) {
  const parts = Object.fromEntries(
    vietnamDateFormatter
      .formatToParts(new Date(timestamp))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDateKey(dateKey, dayDelta) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + dayDelta);
  return date.toISOString().slice(0, 10);
}

const RECORD_VISIT_SQL = `
  INSERT INTO visitor_daily (
    day_local,
    ip_address,
    first_seen_utc,
    last_seen_utc,
    page_views,
    country,
    region,
    city,
    asn,
    as_organization,
    colo,
    device_class,
    browser_family,
    first_path,
    last_path,
    first_referrer_host,
    last_referrer_host,
    campaign_source,
    campaign_medium,
    campaign_name
  ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(day_local, ip_address) DO UPDATE SET
    last_seen_utc = excluded.last_seen_utc,
    page_views = visitor_daily.page_views + 1,
    country = CASE WHEN excluded.country <> '' THEN excluded.country ELSE visitor_daily.country END,
    region = CASE WHEN excluded.region <> '' THEN excluded.region ELSE visitor_daily.region END,
    city = CASE WHEN excluded.city <> '' THEN excluded.city ELSE visitor_daily.city END,
    asn = CASE WHEN excluded.asn > 0 THEN excluded.asn ELSE visitor_daily.asn END,
    as_organization = CASE WHEN excluded.as_organization <> '' THEN excluded.as_organization ELSE visitor_daily.as_organization END,
    colo = CASE WHEN excluded.colo <> '' THEN excluded.colo ELSE visitor_daily.colo END,
    device_class = excluded.device_class,
    browser_family = excluded.browser_family,
    last_path = excluded.last_path,
    last_referrer_host = CASE WHEN excluded.last_referrer_host <> '' THEN excluded.last_referrer_host ELSE visitor_daily.last_referrer_host END,
    campaign_source = CASE WHEN excluded.campaign_source <> '' THEN excluded.campaign_source ELSE visitor_daily.campaign_source END,
    campaign_medium = CASE WHEN excluded.campaign_medium <> '' THEN excluded.campaign_medium ELSE visitor_daily.campaign_medium END,
    campaign_name = CASE WHEN excluded.campaign_name <> '' THEN excluded.campaign_name ELSE visitor_daily.campaign_name END
`;

const SUMMARIZE_VISITS_SQL = `
  INSERT INTO daily_visit_summaries (
    day_local,
    total_unique_ips,
    owner_unique_ips,
    external_unique_ips,
    total_page_views,
    owner_page_views,
    external_page_views,
    generated_at_utc
  )
  SELECT
    ?,
    COUNT(*),
    COALESCE(SUM(CASE WHEN owner.ip_address IS NOT NULL THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN owner.ip_address IS NULL THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(visits.page_views), 0),
    COALESCE(SUM(CASE WHEN owner.ip_address IS NOT NULL THEN visits.page_views ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN owner.ip_address IS NULL THEN visits.page_views ELSE 0 END), 0),
    ?
  FROM visitor_daily AS visits
  LEFT JOIN owner_ips AS owner ON owner.ip_address = visits.ip_address
  WHERE visits.day_local = ?
  ON CONFLICT(day_local) DO UPDATE SET
    total_unique_ips = excluded.total_unique_ips,
    owner_unique_ips = excluded.owner_unique_ips,
    external_unique_ips = excluded.external_unique_ips,
    total_page_views = excluded.total_page_views,
    owner_page_views = excluded.owner_page_views,
    external_page_views = excluded.external_page_views,
    generated_at_utc = excluded.generated_at_utc
`;

// Prefer immutable daily summaries when they exist, and fall back to the
// still-live raw rows for any day the summary cron has not materialized yet
// (normally the current Vietnam calendar day). This keeps the public counter
// request-time fresh without exposing IP addresses or adding another binding.
const VISITOR_COUNT_SQL = `
  SELECT COALESCE(SUM(day_total), 0) AS total_page_views
  FROM (
    SELECT
      day_local,
      external_page_views AS day_total
    FROM daily_visit_summaries

    UNION ALL

    SELECT
      visits.day_local,
      COALESCE(
        SUM(CASE WHEN owner.ip_address IS NULL THEN visits.page_views ELSE 0 END),
        0
      ) AS day_total
    FROM visitor_daily AS visits
    LEFT JOIN owner_ips AS owner ON owner.ip_address = visits.ip_address
    WHERE NOT EXISTS (
      SELECT 1
      FROM daily_visit_summaries AS summaries
      WHERE summaries.day_local = visits.day_local
    )
    GROUP BY visits.day_local
  ) AS daily_totals
`;

async function checkVisitorRateLimit(binding, ipAddress) {
  try {
    if (typeof binding?.limit !== "function") {
      throw new TypeError("visitor_rate_limit_not_configured");
    }

    const anonymousKey = await digestRateLimitKey(
      "visitor-analytics",
      ipAddress,
    );
    const result = await binding.limit({ key: anonymousKey });
    if (result?.success === true) return true;

    if (result?.success === false) {
      console.log(
        JSON.stringify({
          event: "visitor_rate_limit",
          outcome: "rate_limited",
        }),
      );
      return false;
    }

    throw new TypeError("invalid_rate_limit_result");
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "visitor_rate_limit",
        outcome: "rate_limit_error",
        errorName: safeErrorName(error),
      }),
    );
    return false;
  }
}

async function recordVisit(request, env, body, ipAddress) {
  const timestamp = new Date().toISOString();
  const cf = request.cf ?? {};
  const { browserFamily, deviceClass } = classifyClient(
    request.headers.get("User-Agent"),
  );
  const country = /^[A-Z]{2}$/u.test(cf.country ?? "") ? cf.country : "";
  const asn = Number.isSafeInteger(cf.asn) && cf.asn > 0 ? cf.asn : 0;

  await env.VISITOR_ANALYTICS.prepare(RECORD_VISIT_SQL)
    .bind(
      vietnamDateKey(timestamp),
      ipAddress,
      timestamp,
      timestamp,
      country,
      boundedMetadata(cf.region, 80),
      boundedMetadata(cf.city, 80),
      asn,
      boundedMetadata(cf.asOrganization, 120),
      /^[A-Z]{3}$/u.test(cf.colo ?? "") ? cf.colo : "",
      deviceClass,
      browserFamily,
      body.path,
      body.path,
      body.referrerHost,
      body.referrerHost,
      body.campaignSource,
      body.campaignMedium,
      body.campaignName,
    )
    .run();
}

export async function handleVisit(request, env, ctx) {
  if (request.method !== "POST") {
    return errorResponse("method_not_allowed", 405, crypto.randomUUID(), {
      Allow: "POST",
    });
  }
  if (!hasStrictSameOriginEvidence(request)) {
    return errorResponse("cross_origin_request_denied", 403, crypto.randomUUID());
  }
  if (request.headers.get("Sec-GPC") === "1") return noContentResponse();

  const mediaType = request.headers.get("Content-Type")?.split(";", 1)[0].trim();
  if (mediaType !== "application/json") {
    return errorResponse("json_content_type_required", 415, crypto.randomUUID());
  }
  if (typeof env.VISITOR_ANALYTICS?.prepare !== "function") {
    return errorResponse("service_not_configured", 503, crypto.randomUUID());
  }

  let body;
  try {
    const requestBody = await readBoundedRequestBody(request, MAX_VISIT_BODY_BYTES);
    if (requestBody.tooLarge) {
      return errorResponse("request_too_large", 413, crypto.randomUUID());
    }
    body = JSON.parse(requestBody.text);
  } catch {
    return errorResponse("invalid_json", 400, crypto.randomUUID());
  }

  const fields = body && !Array.isArray(body) && typeof body === "object"
    ? Object.keys(body)
    : [];
  if (
    fields.length !== VISIT_FIELDS.size ||
    fields.some((field) => !VISIT_FIELDS.has(field)) ||
    [...VISIT_FIELDS].some((field) => typeof body[field] !== "string") ||
    !SUPPORTED_LOCALES.has(body.locale) ||
    body.path !== `/${body.locale}`
  ) {
    return errorResponse("invalid_request", 400, crypto.randomUUID());
  }

  const normalizedBody = {
    campaignMedium: normalizeCampaignValue(body.campaignMedium),
    campaignName: normalizeCampaignValue(body.campaignName),
    campaignSource: normalizeCampaignValue(body.campaignSource),
    path: body.path,
    referrerHost: normalizeReferrerHost(body.referrerHost),
  };
  const ipAddress = normalizeIpAddress(request.headers.get("CF-Connecting-IP"));
  if (!ipAddress) return noContentResponse();

  const rateLimitAllowed = await checkVisitorRateLimit(
    env.VISITOR_RATE_LIMIT,
    ipAddress,
  );
  if (!rateLimitAllowed) return noContentResponse();

  const writeTask = recordVisit(request, env, normalizedBody, ipAddress).catch(
    (error) => {
      console.error(
        JSON.stringify({
          event: "visitor_analytics",
          outcome: "write_error",
          errorName: safeErrorName(error),
        }),
      );
    },
  );

  if (typeof ctx?.waitUntil === "function") ctx.waitUntil(writeTask);
  else await writeTask;
  return noContentResponse();
}

export async function handleVisitorCount(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse("method_not_allowed", 405, crypto.randomUUID(), {
      Allow: "GET, HEAD",
    });
  }
  if (!hasStrictSameOriginEvidence(request)) {
    return errorResponse("cross_origin_request_denied", 403, crypto.randomUUID());
  }
  if (typeof env.VISITOR_ANALYTICS?.prepare !== "function") {
    return errorResponse("service_not_configured", 503, crypto.randomUUID());
  }

  try {
    const row = await env.VISITOR_ANALYTICS.prepare(VISITOR_COUNT_SQL).first();
    const count = Number(row?.total_page_views);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError("invalid_visitor_count");
    }

    return jsonResponse({
      count,
      source: "cloudflare_d1",
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "visitor_count",
        outcome: "read_error",
        errorName: safeErrorName(error),
      }),
    );
    return errorResponse("service_unavailable", 503, crypto.randomUUID());
  }
}

export async function summarizeDailyVisits(env, scheduledTime) {
  if (
    typeof env.VISITOR_ANALYTICS?.prepare !== "function" ||
    typeof env.VISITOR_ANALYTICS?.batch !== "function"
  ) {
    throw new TypeError("visitor_analytics_not_configured");
  }

  const runDay = vietnamDateKey(scheduledTime);
  const reportDay = shiftDateKey(runDay, -1);
  const firstSummaryDay = shiftDateKey(
    runDay,
    -(VISITOR_RAW_RETENTION_DAYS - 1),
  );
  // Keep one fewer date immediately after the job so the next local-date
  // rollover can add a date without exceeding the disclosed seven-date cap.
  const oldestRetainedDay = shiftDateKey(
    runDay,
    -(VISITOR_RAW_RETENTION_DAYS - 2),
  );
  const generatedAt = new Date().toISOString();
  const reportDays = Array.from(
    { length: VISITOR_RAW_RETENTION_DAYS - 1 },
    (_, index) => shiftDateKey(firstSummaryDay, index),
  );
  const summaries = reportDays.map((dayLocal) =>
    env.VISITOR_ANALYTICS.prepare(SUMMARIZE_VISITS_SQL).bind(
      dayLocal,
      generatedAt,
      dayLocal,
    )
  );
  const cleanup = env.VISITOR_ANALYTICS.prepare(
    "DELETE FROM visitor_daily WHERE day_local < ?",
  ).bind(oldestRetainedDay);

  await env.VISITOR_ANALYTICS.batch([...summaries, cleanup]);
  console.log(
    JSON.stringify({
      event: "visitor_daily_summary",
      firstDayLocal: reportDays[0],
      lastDayLocal: reportDay,
      summarizedDays: reportDays.length,
      outcome: "success",
    }),
  );
}
