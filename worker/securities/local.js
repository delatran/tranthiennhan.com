import { DossierError } from "../../shared/securities/dossier.js";
import { digestRateLimitKey } from "../rate-limit.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SHARED_HOSTS = new Set(["tranthiennhan.com", "www.tranthiennhan.com"]);

export function securitiesRuntimeEnvironment(env = {}) {
  const shared = env.SECURITIES_SHARED_MODE === "true";
  return {
    ...env,
    ...(env.SECURITIES_DB
      ? {}
      : shared && env.VISITOR_ANALYTICS
        ? { SECURITIES_DB: env.VISITOR_ANALYTICS }
        : {}),
    ...(env.SECURITIES_OPENROUTER_API_KEY
      ? {}
      : shared && env.OPENROUTER_API_KEY
        ? { SECURITIES_OPENROUTER_API_KEY: env.OPENROUTER_API_KEY }
        : {}),
  };
}

export function assertSecuritiesLocalRequest(request, env) {
  const url = new URL(request.url);
  const local = env.SECURITIES_LOCAL_MODE === "true" && LOOPBACK_HOSTS.has(url.hostname);
  const shared = env.SECURITIES_SHARED_MODE === "true" && SHARED_HOSTS.has(url.hostname);
  if (!local && !shared) throw new DossierError("local_only", 403);
  if (!env.SECURITIES_DB) throw new DossierError("storage_not_configured", 503);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) throw new DossierError("origin_not_allowed", 403);
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite))
    throw new DossierError("origin_not_allowed", 403);
  if (
    !["GET", "HEAD"].includes(request.method) &&
    origin !== url.origin &&
    fetchSite !== "same-origin"
  )
    throw new DossierError("origin_required", 403);
}

export async function assertSecuritiesMutationRateLimit(request, env) {
  if (env.SECURITIES_SHARED_MODE !== "true" || ["GET", "HEAD"].includes(request.method)) return;
  if (typeof env.SECURITIES_RATE_LIMIT?.limit !== "function")
    throw new DossierError("service_not_configured", 503);
  const source = (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("User-Agent") ||
    "anonymous"
  ).slice(0, 512);
  try {
    const key = await digestRateLimitKey("securities-mutation", source);
    const result = await env.SECURITIES_RATE_LIMIT.limit({ key });
    if (result?.success === true) return;
    if (result?.success === false) throw new DossierError("rate_limited", 429);
    throw new TypeError("invalid_rate_limit_result");
  } catch (error) {
    if (error instanceof DossierError) throw error;
    throw new DossierError("rate_limit_temporarily_unavailable", 503);
  }
}

export function securitiesRuntimeStatus(env) {
  const enabled = env.SECURITIES_MODEL_MODE === "live";
  const local = env.SECURITIES_LOCAL_MODE === "true";
  const configured =
    typeof env.SECURITIES_OPENROUTER_API_KEY === "string" &&
    env.SECURITIES_OPENROUTER_API_KEY.trim().length > 0;
  return {
    storage: local ? "local_d1" : "shared_d1",
    localOnly: local,
    sharedLibrary: !local && env.SECURITIES_SHARED_MODE === "true",
    deletion: !local && env.SECURITIES_SHARED_MODE === "true" ? "public" : "local",
    model: {
      enabled,
      configured,
      id: "meta/muse-spark-1.3-contributor",
      phase: enabled ? "B" : "A",
    },
    providers: [
      {
        id: "openrouter",
        status: enabled && configured ? "configured" : "unconfigured",
        capabilities: ["analysis", "follow_up", "public_research"],
      },
      {
        id: "vndirect",
        status: "active",
        capabilities: ["directory", "quote", "history", "company_profile"],
      },
      {
        id: "bloomberg",
        status: env.SECURITIES_BLOOMBERG_API_KEY ? "configured" : "unavailable",
        capabilities: ["market_data"],
      },
      {
        id: "fiinpro",
        status: env.SECURITIES_FIINPRO_API_KEY ? "configured" : "unavailable",
        capabilities: ["market_data", "financials"],
      },
      {
        id: "bigquery",
        status: env.SECURITIES_BIGQUERY_PROJECT ? "configured" : "unavailable",
        capabilities: ["analytics"],
      },
    ],
  };
}
