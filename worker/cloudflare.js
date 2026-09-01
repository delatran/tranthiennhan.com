import { handleAsk } from "./ask.js";
import {
  errorResponse,
  jsonResponse,
  safeErrorName,
  withHtmlCspNonce,
} from "./http.js";
import {
  handleVisit,
  handleVisitorCount,
  summarizeDailyVisits,
} from "./visits.js";
import { handleXNhanSearch } from "./xnhan.js";

const XNHAN_CANONICAL_PATH = "/xnhan";
// Fetch the extensionless asset aliases internally. The .html aliases are
// Worker-first redirect paths, so fetching them from this Worker would return
// the redirect instead of the static shell and can loop on the canonical URL.
const XNHAN_ASSET_PATH = "/xnhan";
const XNHAN_SHELL_ALIAS_PATH = "/xnhan.html";
const XNHAN_ABOUT_CANONICAL_PATH = "/xnhan/about";
const XNHAN_ABOUT_ASSET_PATH = "/xnhan-about";
const XNHAN_ABOUT_SHELL_ALIAS_PATH = "/xnhan-about.html";

function redirectToCanonicalXNhan(
  url,
  canonicalPath = XNHAN_CANONICAL_PATH,
) {
  const langValues = url.searchParams.getAll("lang");
  const lang = langValues.length === 1 &&
    (langValues[0] === "en" || langValues[0] === "vi")
    ? langValues[0]
    : null;
  const location = lang ? `${canonicalPath}?lang=${lang}` : canonicalPath;

  return new Response(null, {
    status: 308,
    headers: {
      "Cache-Control": "public, max-age=3600",
      Location: location,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function serveXNhanShell(request, env, shellPath = XNHAN_ASSET_PATH) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse("method_not_allowed", 405, crypto.randomUUID(), {
      Allow: "GET, HEAD",
    });
  }
  if (!env.ASSETS) return new Response("Not found", { status: 404 });

  const assetUrl = new URL(request.url);
  assetUrl.pathname = shellPath;
  assetUrl.search = "";
  assetUrl.hash = "";
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
  return withHtmlCspNonce(assetResponse);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return errorResponse("method_not_allowed", 405, crypto.randomUUID(), {
          Allow: "GET, HEAD",
        });
      }
      return jsonResponse({ status: "ok", service: "ask-nhan" });
    }

    if (url.pathname === "/api/ask") return handleAsk(request, env);
    if (url.pathname === "/api/xnhan/search") {
      return handleXNhanSearch(request, env);
    }
    if (url.pathname === "/api/visit") return handleVisit(request, env, ctx);
    if (url.pathname === "/api/visitor-count") {
      return handleVisitorCount(request, env);
    }
    if (url.pathname.startsWith("/api/")) {
      return errorResponse("not_found", 404, crypto.randomUUID());
    }

    if (url.pathname === XNHAN_SHELL_ALIAS_PATH || url.pathname === "/xnhan/") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return errorResponse("method_not_allowed", 405, crypto.randomUUID(), {
          Allow: "GET, HEAD",
        });
      }
      return redirectToCanonicalXNhan(url);
    }
    if (url.pathname === XNHAN_CANONICAL_PATH) {
      return serveXNhanShell(request, env);
    }
    if (
      url.pathname === XNHAN_ABOUT_SHELL_ALIAS_PATH ||
      url.pathname === `${XNHAN_ABOUT_CANONICAL_PATH}/`
    ) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return errorResponse("method_not_allowed", 405, crypto.randomUUID(), {
          Allow: "GET, HEAD",
        });
      }
      return redirectToCanonicalXNhan(url, XNHAN_ABOUT_CANONICAL_PATH);
    }
    if (url.pathname === XNHAN_ABOUT_CANONICAL_PATH) {
      return serveXNhanShell(request, env, XNHAN_ABOUT_ASSET_PATH);
    }

    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      return withHtmlCspNonce(assetResponse);
    }
    return new Response("Not found", { status: 404 });
  },

  scheduled(controller, env, ctx) {
    if (controller.cron === "0 2 * * *") {
      const summaryTask = summarizeDailyVisits(
        env,
        controller.scheduledTime,
      ).catch((error) => {
        console.error(
          JSON.stringify({
            event: "visitor_daily_summary",
            outcome: "error",
            errorName: safeErrorName(error),
          }),
        );
        throw error;
      });
      ctx.waitUntil(summaryTask);
      return;
    }

  },
};
