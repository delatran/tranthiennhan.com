import {
  SECURITIES_ISSUERS,
  SECURITIES_SOURCE_DOCUMENTS,
  SECURITIES_SOURCE_POLICY,
  sourceError,
  sourceIssuerForUrl,
  validateSecuritiesSourceUrl,
} from "../../shared/securities/source-contract.js";
import {
  catalogFromDatasets,
  getFrozenSecuritiesDatasets,
  resolveScopeFromDatasets,
} from "../../shared/securities/catalog.js";

export { validateSecuritiesSourceUrl } from "../../shared/securities/source-contract.js";

async function availableDatasets(env = {}) {
  const imported = env.SECURITIES_DATASET_LOADER
    ? await env.SECURITIES_DATASET_LOADER()
    : env.SECURITIES_DB
      ? await (await import("./ingestion.js")).getImportedDatasets(env)
      : [];
  const frozen = getFrozenSecuritiesDatasets();
  const identity = (dataset) =>
    `${dataset.company.id}:${dataset.period.id}:${dataset.comparisonPeriod.id}`;
  const overrides = new Set(imported.map(identity));
  return [...imported, ...frozen.filter((dataset) => !overrides.has(identity(dataset)))];
}

export async function getSecuritiesCatalog({ env } = {}) {
  return catalogFromDatasets(await availableDatasets(env));
}

export async function resolveSecuritiesScope(input, { env, signal } = {}) {
  signal?.throwIfAborted();
  const scope = resolveScopeFromDatasets(input, await availableDatasets(env));
  if (scope.latestRequested) {
    if (!SECURITIES_ISSUERS.some((company) => company.id === scope.companyId)) {
      scope.freshness = {
        ...scope.freshness,
        status: "not_checked",
        latestMarketPeriodVerified: false,
        label: {
          vi: "Kỳ mới nhất trong dữ liệu đã chuẩn bị; chưa xác minh đây là công bố mới nhất của doanh nghiệp.",
          en: "Latest prepared period; the issuer's latest publication has not been verified.",
        },
      };
      scope.warnings = [
        ...(scope.warnings ?? []),
        {
          id: "dynamic-latest-source-check",
          severity: "warning",
          code: "latest_market_period_not_verified",
          message: scope.freshness.label,
        },
      ];
      return scope;
    }
    const checked = await refreshSecuritiesSources(
      { companyId: scope.companyId, sourceIds: scope.sources.map((source) => source.id) },
      { env, signal, forceRefresh: false },
    );
    scope.freshness = checked.freshness;
    scope.sourceRefresh = checked;
    if (checked.status !== "unchanged")
      scope.warnings = [
        ...(scope.warnings ?? []),
        {
          id: "latest-source-check",
          severity: "warning",
          code: checked.freshness.status,
          message: {
            vi: "Đang dùng kỳ đã xử lý. Xem trạng thái cập nhật nguồn trước khi kết luận đây là kỳ mới nhất.",
            en: "Using the processed period. Review source refresh status before calling it the latest period.",
          },
        },
      ];
  }
  return scope;
}

export async function loadSecuritiesDataset(scope, { env, signal } = {}) {
  signal?.throwIfAborted();
  const datasets = await availableDatasets(env);
  const found = datasets.find(
    (dataset) =>
      dataset.company.id === scope.companyId &&
      dataset.period.id === scope.periodId &&
      dataset.comparisonPeriod.id === scope.comparisonPeriodId,
  );
  if (!found) throw sourceError("unsupported_scope");
  const result = structuredClone(found);
  if (scope.freshness) result.freshness = scope.freshness;
  return result;
}

const textDecoder = new TextDecoder();
const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      resolve();
    };
    const aborted = () => {
      clearTimeout(timer);
      reject(sourceError("cancelled"));
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", aborted, { once: true });
  });

async function withSignal(promise, signal) {
  signal.throwIfAborted();
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () =>
      reject(sourceError(signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function readBounded(response, maxBytes, signal) {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw sourceError("too_large");
  }
  if (!response.body) throw sourceError("empty_document");
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await withSignal(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw sourceError("too_large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!size) throw sourceError("empty_document");
  if (declared > 0 && !response.headers.get("content-encoding") && declared !== size)
    throw sourceError("partial_content");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Bounded HTTP transport; callers pass an issuer-validated resource, never provider instructions. */
export async function fetchSecuritiesSource(
  input,
  {
    fetchImpl = fetch,
    signal,
    maxBytes = SECURITIES_SOURCE_POLICY.maxBytes,
    timeoutMs = SECURITIES_SOURCE_POLICY.timeoutMs,
    maxRedirects = SECURITIES_SOURCE_POLICY.maxRedirects,
    maxAttempts = SECURITIES_SOURCE_POLICY.maxAttempts,
    now = () => new Date().toISOString(),
  } = {},
) {
  let url = validateSecuritiesSourceUrl(input);
  const issuer = sourceIssuerForUrl(url);
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > SECURITIES_SOURCE_POLICY.maxBytes ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120_000 ||
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 3 ||
    !Number.isSafeInteger(maxRedirects) ||
    maxRedirects < 0 ||
    maxRedirects > 5
  )
    throw sourceError("invalid_fetch_limits");
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const requests = [];
  let redirects = 0;
  let attempts = 0;
  while (true) {
    combined.throwIfAborted();
    let response;
    try {
      response = await withSignal(
        fetchImpl(url, {
          method: "GET",
          redirect: "manual",
          headers: {
            Accept: url.endsWith(".pdf") ? "application/pdf" : "text/html",
            "User-Agent": "NhanForSecurities-LocalResearch/1.0",
          },
          signal: combined,
        }),
        combined,
      );
    } catch (error) {
      throw sourceError(
        error.code ||
          (timeout.aborted ? "timeout" : combined.aborted ? "cancelled" : "network_error"),
      );
    }
    requests.push({ url, status: response.status });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      if (redirects >= maxRedirects) throw sourceError("redirect_limit", { requests });
      const location = response.headers.get("location");
      if (!location) throw sourceError("broken_redirect", { requests });
      url = validateSecuritiesSourceUrl(new URL(location, url).href);
      if (sourceIssuerForUrl(url) !== issuer) throw sourceError("source_company_mismatch");
      redirects += 1;
      continue;
    }
    attempts += 1;
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      if (attempts < maxAttempts) {
        await wait(
          Math.min(2_000, Math.max(100, Number(response.headers.get("retry-after")) * 1000 || 250)),
          combined,
        );
        continue;
      }
      throw sourceError(response.status === 429 ? "rate_limited" : "source_unavailable", {
        status: response.status,
        requests,
      });
    }
    if (response.status === 403 || response.status === 401) {
      await response.body?.cancel();
      throw sourceError("access_denied", { status: response.status, requests });
    }
    if (response.status === 206 || response.headers.has("content-range")) {
      await response.body?.cancel();
      throw sourceError("partial_content", { status: response.status, requests });
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw sourceError(response.status === 404 ? "not_found" : "source_http_error", {
        status: response.status,
        requests,
      });
    }
    const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    const isPdf = url.toLowerCase().endsWith(".pdf");
    const bytes = await readBounded(
      response,
      isPdf ? maxBytes : Math.min(maxBytes, SECURITIES_SOURCE_POLICY.maxHtmlBytes),
      combined,
    );
    const head = textDecoder.decode(bytes.subarray(0, 4096));
    if (
      /(?:<title[^>]*>\s*(?:just a moment|access denied|security check)|cf-chl-|challenge-platform|verify you are human|captcha challenge|<form[^>]+(?:login|signin))/i.test(
        head,
      )
    )
      throw sourceError("challenge", { requests });
    if (isPdf) {
      if (contentType !== "application/pdf" || !head.startsWith("%PDF-"))
        throw sourceError(
          /text\/html/.test(contentType) ? "challenge_or_wrong_content" : "wrong_content_type",
          { requests },
        );
      if (!textDecoder.decode(bytes.subarray(Math.max(0, bytes.length - 4096))).includes("%%EOF"))
        throw sourceError("partial_content", { requests });
    } else if (contentType !== "text/html" || !/<(?:!doctype\s+html|html|body)\b/i.test(head))
      throw sourceError("wrong_content_type", { requests });
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    return {
      url,
      contentType,
      bytes,
      byteLength: bytes.length,
      hash,
      fetchedAt: now(),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      requests,
      text: isPdf ? undefined : textDecoder.decode(bytes),
    };
  }
}

function cleanHtml(value) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#0*39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function inferDiscoveredPeriod(url) {
  const filename = decodeURIComponent(new URL(url).pathname.split("/").at(-1))
    .toLowerCase()
    .replace(/\s+/gu, "_");
  const years = [...filename.matchAll(/(?:^|[_-])(20\d{2})(?=[_.-]|$)/gu)].map((match) =>
    Number(match[1]),
  );
  const year = years.at(-1);
  if (!year || year < 2000 || year > 2100 || /(?:quy|quarter|q)[_-]?[1-4]/u.test(filename))
    return null;
  if (/(?:ban[_-]nien|6[_-]thang|h1)/u.test(filename)) return `H1_${year}`;
  if (/(?:bctn|thuong[_-]nien|kiem[_-]toan|ca[_-]nam)/u.test(filename)) return `FY${year}`;
  return null;
}

export function discoverSecuritiesDisclosurePages(html, landingUrl, companyId) {
  if (
    sourceIssuerForUrl(landingUrl) !== companyId ||
    typeof html !== "string" ||
    html.length > SECURITIES_SOURCE_POLICY.maxHtmlBytes
  )
    throw sourceError("invalid_discovery_content");
  const result = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    let url;
    try {
      url = validateSecuritiesSourceUrl(new URL(match[1].replace(/&amp;/g, "&"), landingUrl).href);
    } catch {
      continue;
    }
    if (
      sourceIssuerForUrl(url) !== companyId ||
      companyId !== "GMD" ||
      !/^\/(?:gmd-|bao-cao-tai-chinh-)/u.test(new URL(url).pathname) ||
      !/(?:bctc|bao-cao-tai-chinh)/u.test(url)
    )
      continue;
    if (!result.includes(url)) result.push(url);
  }
  return result.slice(0, 3);
}

export function discoverSecuritiesDocuments(html, landingUrl, companyId) {
  validateSecuritiesSourceUrl(landingUrl);
  if (
    sourceIssuerForUrl(landingUrl) !== companyId ||
    typeof html !== "string" ||
    html.length > SECURITIES_SOURCE_POLICY.maxHtmlBytes
  )
    throw sourceError("invalid_discovery_content");
  const links = [];
  for (const match of html.matchAll(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    links.push({
      href: match[1].replace(/&amp;/g, "&"),
      label: cleanHtml(match[2]),
      basis: "anchor",
    });
  }
  if (companyId === "ACB") {
    // The official listing stores its downloadable report cards in inert Next.js data.
    const embedded = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find((match) =>
      /\bid\s*=\s*["']__NEXT_DATA__["']/iu.test(match[1]),
    );
    if (embedded) {
      let blocks;
      try {
        blocks = JSON.parse(embedded[2])?.props?.pageProps?.blocks;
      } catch {
        throw sourceError("invalid_discovery_content");
      }
      if (!Array.isArray(blocks) || blocks.length > 20)
        throw sourceError("invalid_discovery_content");
      for (const block of blocks) {
        const posts = block?.formdata?.default_data?.data;
        if (!Array.isArray(posts)) continue;
        for (const post of posts.slice(0, 40)) {
          if (
            post?.is_active !== 1 ||
            post.type !== "nha-dau-tu" ||
            typeof post.featured_image?.path !== "string" ||
            typeof post.title !== "string"
          )
            continue;
          links.push({
            href: post.featured_image.path,
            label: cleanHtml(post.title).slice(0, 300),
            basis: "issuer_listing_metadata",
          });
        }
      }
    }
  }
  const found = new Map();
  for (const { href, label, basis } of links) {
    let url;
    try {
      url = validateSecuritiesSourceUrl(new URL(href, landingUrl).href);
    } catch {
      continue;
    }
    if (sourceIssuerForUrl(url) !== companyId) continue;
    if (!url.toLowerCase().endsWith(".pdf")) continue;
    const name = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
    if (
      companyId === "FPT" &&
      !/(?:bctc.*hop[_-]?nhat|BCTN-20\d{2}|bao_cao_thuong_nien)/i.test(name)
    )
      continue;
    if (
      ["GMD", "VSC"].includes(companyId) &&
      !/(?:bctc|bao-cao-tai-chinh).*hop[_-]?nhat/i.test(name)
    )
      continue;
    const known = SECURITIES_SOURCE_DOCUMENTS.find(
      (source) => source.url === url && source.companyId === companyId,
    );
    found.set(url, {
      url,
      companyId,
      landingUrl,
      title: known?.title || (label.length > 5 && !/^(xem|tải)/i.test(label) ? label : name),
      titleBasis: known ? "verified_catalog" : label.length > 5 ? basis : "filename",
      periodId: known?.periodId || inferDiscoveredPeriod(url),
      periodBasis: known ? "reviewed_original" : "filename_requires_original_check",
      publishedAt: known?.publishedAt || null,
      status: known ? "known" : "discovered_requires_metadata_review",
      sourceId: known?.id || null,
    });
  }
  return [...found.values()].slice(0, 40);
}

/** A reviewed companion stops being a new candidate only after its exact bytes match. */
export async function checkReviewedSecuritiesCompanions(
  candidates,
  { sources = SECURITIES_SOURCE_DOCUMENTS, fetchedSources = new Map(), ...options } = {},
) {
  const checked = candidates.map((candidate) => ({ ...candidate }));
  const checks = [];
  for (const candidate of checked) {
    const source = sources.find(
      (entry) =>
        entry.companyId === candidate.companyId && entry.reviewedCompanion?.url === candidate.url,
    );
    if (!source) continue;
    const priorCheck = checks.find((check) => check.url === candidate.url);
    let check = priorCheck;
    if (!check) {
      try {
        if (!fetchedSources.has(candidate.url))
          fetchedSources.set(candidate.url, fetchSecuritiesSource(candidate.url, options));
        const result = await fetchedSources.get(candidate.url);
        check = {
          sourceId: source.id,
          role: "reviewed_companion",
          url: candidate.url,
          status: result.hash === source.reviewedCompanion.hash ? "unchanged" : "changed",
          previousHash: source.reviewedCompanion.hash,
          hash: result.hash,
          bytes: result.byteLength,
          fetchedAt: result.fetchedAt,
          requests: result.requests || [],
        };
      } catch (error) {
        if (options.signal?.aborted) throw sourceError("cancelled");
        check = {
          sourceId: source.id,
          role: "reviewed_companion",
          url: candidate.url,
          status: "failed",
          previousHash: source.reviewedCompanion.hash,
          code: error.code || "network_error",
        };
      }
      checks.push(check);
    }
    candidate.companionOf = source.id;
    if (check.status === "unchanged") {
      candidate.periodId = source.periodId;
      candidate.periodBasis = "reviewed_companion_original";
    }
    candidate.status =
      check.status === "unchanged"
        ? "known_companion"
        : check.status === "changed"
          ? "reviewed_companion_changed"
          : "reviewed_companion_check_failed";
    if (check.hash) candidate.hash = check.hash;
    if (check.status !== "unchanged") candidate.reviewCode = candidate.status;
  }
  return { candidates: checked, checks };
}

async function sourceCheckCache(env, key, value) {
  if (env?.SECURITIES_SOURCE_CHECK_CACHE) {
    if (value) {
      await env.SECURITIES_SOURCE_CHECK_CACHE.set(key, structuredClone(value));
      return value;
    }
    return env.SECURITIES_SOURCE_CHECK_CACHE.get(key);
  }
  if (!env?.SECURITIES_DB) return null;
  if (value) {
    await env.SECURITIES_DB.prepare(
      "INSERT INTO securities_source_checks (cache_key,result_json,checked_at) VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET result_json=excluded.result_json, checked_at=excluded.checked_at",
    )
      .bind(key, JSON.stringify(value), value.checkedAt)
      .run();
    return value;
  }
  const row = await env.SECURITIES_DB.prepare(
    "SELECT result_json FROM securities_source_checks WHERE cache_key = ?",
  )
    .bind(key)
    .first();
  return row ? JSON.parse(row.result_json) : null;
}

export async function refreshSecuritiesSources({ companyId, sourceIds } = {}, options = {}) {
  const company = SECURITIES_ISSUERS.find((item) => item.id === companyId);
  if (!company) throw sourceError("unsupported_company");
  if (sourceIds && (!Array.isArray(sourceIds) || sourceIds.length > 4))
    throw sourceError("unsupported_source");
  const datasets = (await availableDatasets(options.env)).filter(
    (dataset) => dataset.company.id === companyId,
  );
  const tracked = [
    ...new Map(
      datasets
        .flatMap((dataset) => dataset.sources)
        .reverse()
        .map((source) => [source.id, source]),
    ).values(),
  ];
  const sources = tracked.filter((source) => !sourceIds || sourceIds.includes(source.id));
  if (
    sourceIds &&
    (!Array.isArray(sourceIds) ||
      sourceIds.length > 4 ||
      sources.length !== new Set(sourceIds).size)
  )
    throw sourceError("unsupported_source");
  const checkedAt = options.now ? options.now() : new Date().toISOString();
  const key = JSON.stringify([
    companyId,
    ...sources
      .map(({ id, url, hash, reviewedCompanion }) => [
        id,
        url,
        hash,
        ...(reviewedCompanion ? [reviewedCompanion.url, reviewedCompanion.hash] : []),
      ])
      .sort((a, b) => a[0].localeCompare(b[0])),
  ]);
  const prior = await sourceCheckCache(options.env, key);
  if (
    options.forceRefresh === false &&
    ["unchanged", "changed"].includes(prior?.status) &&
    Date.parse(checkedAt) - Date.parse(prior.checkedAt) >= 0 &&
    Date.parse(checkedAt) - Date.parse(prior.checkedAt) < SECURITIES_SOURCE_POLICY.freshnessTtlMs
  )
    return { ...prior, cacheHit: true };
  const checks = [];
  const fetchedSources = new Map();
  let discovery;
  try {
    const landing = await fetchSecuritiesSource(company.landingUrl, options);
    const candidates = discoverSecuritiesDocuments(landing.text, company.landingUrl, companyId);
    const disclosureChecks = [];
    for (const url of discoverSecuritiesDisclosurePages(
      landing.text,
      company.landingUrl,
      companyId,
    )) {
      const disclosure = await fetchSecuritiesSource(url, options);
      candidates.push(...discoverSecuritiesDocuments(disclosure.text, disclosure.url, companyId));
      disclosureChecks.push({
        url: disclosure.url,
        hash: disclosure.hash,
        checkedAt: disclosure.fetchedAt,
      });
    }
    const companionResult = await checkReviewedSecuritiesCompanions(
      [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()],
      { ...options, fetchedSources },
    );
    const unique = companionResult.candidates;
    checks.push(...companionResult.checks);
    const latestEnd = datasets
      .map((dataset) => dataset.period.end)
      .sort()
      .at(-1);
    const pending = unique.filter(
      (item) =>
        item.status !== "known_companion" &&
        !tracked.some((source) => source.url === item.url) &&
        (!item.periodId ||
          `${item.periodId.match(/20\d{2}/u)?.[0]}-${item.periodId.startsWith("FY") ? "12-31" : "06-30"}` >=
            latestEnd),
    );
    discovery = {
      status: "checked",
      landingUrl: company.landingUrl,
      checkedAt: landing.fetchedAt,
      hash: landing.hash,
      disclosureChecks,
      documentCandidates: unique,
      newCandidates: pending,
    };
  } catch (error) {
    if (options.signal?.aborted) throw sourceError("cancelled");
    discovery = {
      status: "failed",
      landingUrl: company.landingUrl,
      checkedAt,
      code: error.code || "network_error",
      documentCandidates: [],
      newCandidates: [],
    };
  }
  for (const source of sources) {
    if (options.signal?.aborted) throw sourceError("cancelled");
    try {
      if (!fetchedSources.has(source.url))
        fetchedSources.set(source.url, fetchSecuritiesSource(source.url, options));
      const result = await fetchedSources.get(source.url);
      checks.push({
        sourceId: source.id,
        status: result.hash === source.hash ? "unchanged" : "changed",
        previousHash: source.hash,
        hash: result.hash,
        fetchedAt: result.fetchedAt,
        url: result.url,
      });
    } catch (error) {
      checks.push({
        sourceId: source.id,
        status: "failed",
        previousHash: source.hash,
        code: error.code || "network_error",
        url: source.url,
      });
    }
  }
  const failed =
    checks.filter((item) => item.status === "failed").length +
    (discovery.status === "failed" ? 1 : 0);
  const changed = checks.some((item) => item.status === "changed");
  const status =
    failed === checks.length + 1
      ? "failed"
      : failed
        ? "partial"
        : changed || discovery.newCandidates.length
          ? "changed"
          : "unchanged";
  const result = {
    companyId,
    status,
    checkedAt,
    cacheHit: false,
    sourceChecks: checks,
    discovery,
    freshness: {
      status: failed
        ? "check_failed"
        : changed
          ? "revision_detected"
          : discovery.newCandidates.length
            ? "new_documents_discovered"
            : "checked",
      checkedAt,
      lastSuccessfulCheckAt: failed ? prior?.freshness.lastSuccessfulCheckAt || null : checkedAt,
      cachedAt:
        sources
          .map((source) => source.fetchedAt)
          .sort()
          .at(-1) || null,
      latestMarketPeriodVerified: false,
      policy: "24h-issuer-discovery-and-content-hash",
      pendingCandidateCount: discovery.newCandidates.length,
    },
  };
  await sourceCheckCache(options.env, key, result);
  return result;
}
