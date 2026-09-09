import { isXNhanModelId } from "./xnhan-model-id.js";
import {
  XNHAN_WEBMCP_LOCALES,
  XNHAN_WEBMCP_PROVIDERS,
  isPlainObject,
  readOwnDataProperty,
  validateSafeId,
  validateXStatusId,
} from "./xnhan-webmcp-input.js";

export const XNHAN_WEBMCP_MAX_OUTPUT_CHARS = 3_000;
export const XNHAN_WEBMCP_MAX_INDEX_OUTPUT_CHARS = 6_000;

const SEARCH_ID_MAX_LENGTH = 64;
const RESULT_TEXT_MAX_LENGTH = 80;
const RESULT_TEXT_MIN_BUDGET_LENGTH = 24;
const MAX_VISIBLE_RESULTS = 3;
const MAX_VISIBLE_ANSWER_BLOCKS = 12;
const MAX_RETURNED_ANSWER_BLOCKS = 2;
const MAX_CURRENT_RESULTS = 20;
const MAX_PROVENANCE_SOURCE_IDS = 10;
const ANSWER_TEXT_MAX_LENGTH = 8_000;
const ANSWER_TEXT_EXCERPT_LENGTH = 80;
const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/u;
const X_POST_URL_PATTERN = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/([1-9][0-9]{0,29})$/u;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const SEARCH_STATUSES = Object.freeze(["complete"]);
const SEARCH_PHASES = Object.freeze([
  "idle",
  "searching",
  "complete",
  "empty",
  "cancelled",
  "error",
]);
const RESULT_KINDS = Object.freeze(["post", "reply", "repost", "unknown"]);
const XNHAN_WEBMCP_PATHS = Object.freeze(["/xnhan", "/xnhan.html"]);

function readResultProperty(result, property) {
  return readOwnDataProperty(
    result,
    property,
    "X Nhân WebMCP action returned an unsupported result.",
  );
}

function readResultString(result, property) {
  const value = readResultProperty(result, property);
  if (typeof value !== "string") {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  return value;
}

function hasResultProperty(result, property) {
  try {
    return Boolean(Object.getOwnPropertyDescriptor(result, property));
  } catch {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
}

function normalizeProviderResult(result, property = "provider") {
  const provider = readResultString(result, property);
  if (!XNHAN_WEBMCP_PROVIDERS.includes(provider)) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  return provider;
}

function normalizeModelResult(result, provider, property = "model") {
  const model = readResultString(result, property);
  if (!isXNhanModelId(model, provider)) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  return model;
}

function normalizeNonNegativeInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  return value;
}

function normalizeResultCount(value) {
  const count = normalizeNonNegativeInteger(value);
  if (count > MAX_CURRENT_RESULTS) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  return count;
}

function normalizeNullableMetric(value) {
  return value === null ? null : normalizeNonNegativeInteger(value);
}

function normalizeUtcTimestamp(value, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !ISO_UTC_PATTERN.test(value)) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  const canonical = date.toISOString();
  const comparable = value.includes(".")
    ? canonical
    : canonical.replace(".000Z", "Z");
  if (comparable !== value) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  return canonical;
}

function parseCanonicalXPostUrl(value) {
  if (typeof value !== "string" || value.length > 80) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  const match = X_POST_URL_PATTERN.exec(value);
  if (!match) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  return match;
}

function normalizeCanonicalXPostUrl(value, authorHandle, resultId) {
  const match = parseCanonicalXPostUrl(value);
  if (
    match[1].toLowerCase() !== authorHandle.toLowerCase() ||
    match[2] !== resultId
  ) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  return value;
}

function normalizeText(value) {
  if (typeof value !== "string" || value.length > 10_000) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  const compact = value.replace(/\s+/gu, " ").trim();
  const characters = Array.from(compact);
  return Object.freeze({
    text: characters.slice(0, RESULT_TEXT_MAX_LENGTH).join(""),
    originalCharacters: characters.length,
  });
}

function normalizeMetrics(value) {
  const normalized = {};
  for (const property of ["replyCount", "repostCount", "likeCount", "viewCount"]) {
    const metric = normalizeNullableMetric(readResultProperty(value, property));
    if (metric !== null) normalized[property] = metric;
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeVisibleItem(value) {
  const resultId = validateXStatusId(
    readResultString(value, "resultId"),
    "result identifier",
  );
  const kind = readResultString(value, "kind");
  if (!RESULT_KINDS.includes(kind)) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  const authorHandle = readResultString(value, "authorHandle");
  if (!X_HANDLE_PATTERN.test(authorHandle)) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }

  const postedAt = normalizeUtcTimestamp(readResultProperty(value, "postedAt"), {
    nullable: true,
  });
  const postedAtProvenance = readResultString(value, "postedAtProvenance");
  if (
    (postedAt === null && postedAtProvenance !== "unavailable") ||
    (postedAt !== null && postedAtProvenance !== "status_id")
  ) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  const metrics = normalizeMetrics(readResultProperty(value, "metrics"));
  const normalizedText = normalizeText(readResultProperty(value, "text"));
  const normalized = {
    resultId,
    kind,
    authorHandle,
    textExcerpt: normalizedText.text,
    textTruncated:
      Array.from(normalizedText.text).length < normalizedText.originalCharacters,
    sourceCharacterCount: normalizedText.originalCharacters,
    url: normalizeCanonicalXPostUrl(
      readResultProperty(value, "url"),
      authorHandle,
      resultId,
    ),
  };
  if (postedAt !== null) {
    normalized.postedAt = postedAt;
    normalized.postedAtProvenance = postedAtProvenance;
  }
  if (metrics !== null) normalized.metrics = metrics;
  return normalized;
}

function readVisibleItems(value) {
  let isArray;
  let lengthDescriptor;
  try {
    isArray = Array.isArray(value);
    lengthDescriptor = isArray
      ? Object.getOwnPropertyDescriptor(value, "length")
      : undefined;
  } catch {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  if (!lengthDescriptor || !("value" in lengthDescriptor)) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }

  const normalized = [];
  const count = Math.min(lengthDescriptor.value, MAX_VISIBLE_RESULTS);
  for (let index = 0; index < count; index += 1) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
    }
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
    }
    normalized.push(normalizeVisibleItem(descriptor.value));
  }
  return Object.freeze({
    items: normalized,
    sourceCount: lengthDescriptor.value,
  });
}

function readVisibleResultIds(value) {
  if (!Array.isArray(value) || value.length > MAX_CURRENT_RESULTS) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  const ids = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
    }
    ids.push(validateXStatusId(
      readResultString(descriptor.value, "resultId"),
      "result identifier",
    ));
  }
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  return Object.freeze(ids);
}

function readClosedSourceIds(value, visibleResultIds, label) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_PROVENANCE_SOURCE_IDS
  ) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }

  const closedIds = new Set(visibleResultIds);
  const sourceIds = [];
  for (let index = 0; index < value.length; index += 1) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
    }
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
    }
    const sourceId = validateXStatusId(descriptor.value, label);
    if (!closedIds.has(sourceId) || sourceIds.includes(sourceId)) {
      throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
    }
    sourceIds.push(sourceId);
  }

  const sourceOrder = new Map(
    visibleResultIds.map((resultId, index) => [resultId, index]),
  );
  if (
    sourceIds.some(
      (sourceId, index) =>
        index > 0 &&
        sourceOrder.get(sourceIds[index - 1]) > sourceOrder.get(sourceId),
    )
  ) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  return Object.freeze(sourceIds);
}

function normalizeAnswerText(value, { natural = false } = {}) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > (natural ? 1_800 : ANSWER_TEXT_MAX_LENGTH) ||
    (natural &&
      (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) ||
        /[<>`]/u.test(value) ||
        /(?:https?:\/\/|www\.|(?:javascript|data|mailto):)/iu.test(value) ||
        /@[A-Za-z0-9_]{1,15}\b/u.test(value) ||
        /#[\p{L}\p{M}\p{N}_]+/u.test(value) ||
        /(?:!\[[^\]]*\]|\[[^\]]*\]\(|^\s{0,3}(?:#{1,6}|>|[-*+]\s|\d+[.)]\s))/mu.test(value)))
  ) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  const characters = Array.from(value);
  return Object.freeze({
    excerpt: characters.slice(0, ANSWER_TEXT_EXCERPT_LENGTH).join(""),
    sourceCharacterCount: characters.length,
  });
}

function normalizeNullableAnswerLocale(value) {
  if (value === null) return null;
  if (!XNHAN_WEBMCP_LOCALES.includes(value)) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  return value;
}

function readAnswerBlocks(value, answerLocale, visibleResultIds = null) {
  if (!Array.isArray(value) || value.length > MAX_VISIBLE_ANSWER_BLOCKS) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  const blocks = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
    }
    const block = descriptor.value;
    const expectedKeys = [
      "resultId",
      "sourceIds",
      "translationStatus",
      "mainText",
      "mainLocale",
      "retrievedSourceText",
      "retrievedSourceLocale",
    ];
    let keys;
    try {
      keys = Reflect.ownKeys(block);
    } catch {
      throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
    }
    if (
      !isPlainObject(block) ||
      keys.length !== expectedKeys.length ||
      keys.some((key) =>
        typeof key !== "string" || !expectedKeys.includes(key))
    ) {
      throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
    }
    const resultId = validateXStatusId(
      readResultString(block, "resultId"),
      "answer result identifier",
    );
    const sourceIds = readClosedSourceIds(
      readResultProperty(block, "sourceIds"),
      visibleResultIds ?? [],
      "answer source identifier",
    );
    if (resultId !== sourceIds[0]) {
      throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
    }
    const translationStatus = readResultString(block, "translationStatus");
    if (
      !["not_needed", "machine_translated", "translation_unavailable"].includes(
        translationStatus,
      )
    ) {
      throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
    }
    const mainLocale = normalizeNullableAnswerLocale(
      readResultProperty(block, "mainLocale"),
    );
    const retrievedSourceLocale = normalizeNullableAnswerLocale(
      readResultProperty(block, "retrievedSourceLocale"),
    );
    if (
      (translationStatus === "machine_translated" &&
        (mainLocale !== answerLocale ||
          retrievedSourceLocale === answerLocale)) ||
      (translationStatus === "translation_unavailable" &&
        mainLocale === answerLocale) ||
      (translationStatus === "not_needed" &&
        mainLocale !== null && mainLocale !== answerLocale)
    ) {
      throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
    }
    const mainText = normalizeAnswerText(
      readResultProperty(block, "mainText"),
    );
    const retrievedSourceText = normalizeAnswerText(
      readResultProperty(block, "retrievedSourceText"),
    );
    blocks.push(Object.freeze({
      resultId,
      sourceIds,
      translationStatus,
      mainTextExcerpt: mainText.excerpt,
      mainTextTruncated:
        Array.from(mainText.excerpt).length < mainText.sourceCharacterCount,
      mainTextCharacterCount: mainText.sourceCharacterCount,
      mainLocale,
      retrievedSourceTextExcerpt: retrievedSourceText.excerpt,
      retrievedSourceTextTruncated:
        Array.from(retrievedSourceText.excerpt).length <
          retrievedSourceText.sourceCharacterCount,
      retrievedSourceTextCharacterCount:
        retrievedSourceText.sourceCharacterCount,
      retrievedSourceLocale,
    }));
  }
  if (visibleResultIds) {
    const visibleIds = new Set(visibleResultIds);
    if (blocks.some(({ resultId }) => !visibleIds.has(resultId))) {
      throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
    }
    const resultOrder = new Map(visibleResultIds.map((resultId, index) => [resultId, index]));
    blocks.sort((left, right) => {
      const leftOrder = resultOrder.get(left.resultId) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = resultOrder.get(right.resultId) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });
  }
  return Object.freeze(blocks.slice(0, MAX_RETURNED_ANSWER_BLOCKS));
}

function refreshTruncationMetadata(
  output,
  initialResultCount,
  budgetOmittedMetricSets,
) {
  const omittedResults = output.total - output.results.length;
  const budgetOmittedResults = initialResultCount - output.results.length;
  if (omittedResults === 0 && budgetOmittedMetricSets === 0) {
    delete output.truncation;
    return;
  }

  const truncation = {};
  if (omittedResults > 0) {
    truncation.omittedResults = omittedResults;
    truncation.resultReason =
      budgetOmittedResults > 0 && omittedResults > budgetOmittedResults
        ? "result+output"
        : budgetOmittedResults > 0
          ? "output"
          : "result";
  }
  if (budgetOmittedMetricSets > 0) {
    truncation.omittedMetricSets = budgetOmittedMetricSets;
  }
  output.truncation = truncation;
}

function fitVisibleOutput(output, initialResultCount) {
  let budgetOmittedMetricSets = 0;
  while (true) {
    refreshTruncationMetadata(
      output,
      initialResultCount,
      budgetOmittedMetricSets,
    );
    const serialized = JSON.stringify(output);
    if (serialized.length <= XNHAN_WEBMCP_MAX_OUTPUT_CHARS) return output;

    const candidate = output.results.reduce((longest, item) => {
      const length = Array.from(item.textExcerpt).length;
      if (length <= RESULT_TEXT_MIN_BUDGET_LENGTH) return longest;
      return length > (longest?.length ?? 0) ? { item, length } : longest;
    }, undefined);
    if (candidate) {
      candidate.item.textExcerpt = Array.from(candidate.item.textExcerpt)
        .slice(0, candidate.length - 1)
        .join("");
      candidate.item.textTruncated = true;
      continue;
    }

    if (output.total > initialResultCount) {
      let metricsCandidate;
      for (let index = output.results.length - 1; index >= 0; index -= 1) {
        if (output.results[index].metrics) {
          metricsCandidate = output.results[index];
          break;
        }
      }
      if (metricsCandidate) {
        delete metricsCandidate.metrics;
        budgetOmittedMetricSets += 1;
        continue;
      }
    }

    if (output.results.length > 1) {
      const citedIds = new Set(
        [
          ...(output.answerSourceIds ?? []),
          ...(output.answerBlocks?.flatMap(({ sourceIds }) => sourceIds) ?? []),
        ],
      );
      let removalIndex = output.results.length - 1;
      for (let index = output.results.length - 1; index >= 0; index -= 1) {
        if (!citedIds.has(output.results[index].resultId)) {
          removalIndex = index;
          break;
        }
      }
      output.results.splice(removalIndex, 1);
      continue;
    }
    throw new TypeError("X Nhân WebMCP action returned an oversized result.");
  }
}

function freezeVisibleOutput(output) {
  if (output.answer) Object.freeze(output.answer);
  if (output.answerSourceIds) Object.freeze(output.answerSourceIds);
  for (const item of output.results) {
    if (item.metrics) Object.freeze(item.metrics);
    Object.freeze(item);
  }
  Object.freeze(output.results);
  if (output.answerBlocks) {
    for (const block of output.answerBlocks) {
      Object.freeze(block.sourceIds);
      Object.freeze(block);
    }
    Object.freeze(output.answerBlocks);
  }
  if (output.answerTruncation) Object.freeze(output.answerTruncation);
  if (output.truncation) Object.freeze(output.truncation);
  return Object.freeze(output);
}

export function normalizeSearchResult(result) {
  const status = readResultString(result, "status");
  if (!SEARCH_STATUSES.includes(status)) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  const provider = normalizeProviderResult(result);
  const normalized = Object.freeze({
    status,
    searchId: validateSafeId(
      readResultString(result, "searchId"),
      SEARCH_ID_MAX_LENGTH,
      "search identifier",
    ),
    resultCount: normalizeResultCount(readResultProperty(result, "resultCount")),
    provider,
    model: normalizeModelResult(result, provider),
  });
  if (JSON.stringify(normalized).length > XNHAN_WEBMCP_MAX_OUTPUT_CHARS) {
    throw new TypeError("X Nhân WebMCP action returned an oversized result.");
  }
  return normalized;
}

export function normalizeVisibleResults(result) {
  const rawSearchId = readResultProperty(result, "searchId");
  const searchId = rawSearchId === null
    ? null
    : validateSafeId(rawSearchId, SEARCH_ID_MAX_LENGTH, "search identifier");
  const rawProvider = readResultProperty(result, "provider");
  const rawModel = readResultProperty(result, "model");
  const provider = searchId === null ? null : normalizeProviderResult(result);
  const model = searchId === null ? null : normalizeModelResult(result, provider);
  const revision = normalizeNonNegativeInteger(readResultProperty(result, "revision"));
  const total = normalizeNonNegativeInteger(readResultProperty(result, "total"));
  const observedAt = normalizeUtcTimestamp(readResultProperty(result, "observedAt"), {
    nullable: true,
  });
  const rawResults = readResultProperty(result, "results");
  const resultIds = readVisibleResultIds(rawResults);
  const { items: results, sourceCount } = readVisibleItems(rawResults);
  const hasAnswerLocale = hasResultProperty(result, "answerLocale");
  const hasAnswerBlocks = hasResultProperty(result, "answerBlocks");
  if (hasAnswerLocale !== hasAnswerBlocks) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  const answerLocale = hasAnswerLocale
    ? normalizeNullableAnswerLocale(readResultProperty(result, "answerLocale"))
    : null;
  const rawAnswerBlocks = hasAnswerBlocks
    ? readResultProperty(result, "answerBlocks")
    : [];
  const answerBlocks = readAnswerBlocks(rawAnswerBlocks, answerLocale, resultIds);
  const hasAnswer = hasResultProperty(result, "answer");
  const hasAnswerSourceIds = hasResultProperty(result, "answerSourceIds");
  if (hasAnswer !== hasAnswerSourceIds) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  const answer = hasAnswer
    ? normalizeAnswerText(readResultProperty(result, "answer"), { natural: true })
    : null;
  const answerSourceIds = hasAnswerSourceIds
    ? readClosedSourceIds(
        readResultProperty(result, "answerSourceIds"),
        resultIds,
        "natural answer source identifier",
      )
    : Object.freeze([]);

  if (
    total !== sourceCount ||
    (searchId !== null && hasAnswerLocale && answerLocale === null) ||
    (hasAnswer && (searchId === null || !hasAnswerLocale || answerLocale === null)) ||
    (hasAnswer && answerSourceIds.length < 1) ||
    answerBlocks.some((block) => !resultIds.includes(block.resultId)) ||
    (searchId === null &&
      (rawProvider !== null ||
        rawModel !== null ||
        revision !== 0 ||
        total !== 0 ||
        observedAt !== null ||
        (hasAnswerLocale && answerLocale !== null) ||
        answer !== null ||
        answerSourceIds.length !== 0 ||
        answerBlocks.length !== 0 ||
        results.length !== 0))
  ) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  const uniqueIds = new Set(results.map(({ resultId }) => resultId));
  if (uniqueIds.size !== results.length) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }

  const output = {
    searchId,
    revision,
    total,
    observedAt,
    provider,
    model,
    results,
  };
  if (hasAnswerBlocks && rawAnswerBlocks.length > 0) {
    output.answerLocale = answerLocale;
    output.answerBlocks = answerBlocks;
  }
  if (answer !== null) output.answer = answer;
  if (answerSourceIds.length > 0) output.answerSourceIds = answerSourceIds;
  if (hasAnswerBlocks && rawAnswerBlocks.length > answerBlocks.length) {
    output.answerTruncation = {
      omittedBlocks: rawAnswerBlocks.length - answerBlocks.length,
    };
  }
  const fitted = fitVisibleOutput(output, results.length);
  if (fitted.answerBlocks) {
    const retainedResultIds = new Set(fitted.results.map(({ resultId }) => resultId));
    const retainedBlocks = fitted.answerBlocks.filter(({ resultId }) =>
      retainedResultIds.has(resultId),
    );
    const omittedByResult = fitted.answerBlocks.length - retainedBlocks.length;
    if (omittedByResult > 0) {
      fitted.answerBlocks = retainedBlocks;
      fitted.answerTruncation = {
        omittedBlocks: (fitted.answerTruncation?.omittedBlocks ?? 0) + omittedByResult,
      };
    }
  }
  return freezeVisibleOutput(fitted);
}

function normalizeIndexItem(value) {
  const resultId = validateXStatusId(
    readResultString(value, "resultId"),
    "result identifier",
  );
  const kind = readResultString(value, "kind");
  const authorHandle = readResultString(value, "authorHandle");
  if (!RESULT_KINDS.includes(kind) || !X_HANDLE_PATTERN.test(authorHandle)) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  const postedAt = normalizeUtcTimestamp(readResultProperty(value, "postedAt"), {
    nullable: true,
  });
  const postedAtProvenance = readResultString(value, "postedAtProvenance");
  if (
    (postedAt === null && postedAtProvenance !== "unavailable") ||
    (postedAt !== null && postedAtProvenance !== "status_id")
  ) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }

  const normalized = {
    resultId,
    kind,
    authorHandle,
    url: normalizeCanonicalXPostUrl(
      readResultProperty(value, "url"),
      authorHandle,
      resultId,
    ),
  };
  if (postedAt !== null) {
    normalized.postedAt = postedAt;
    normalized.postedAtProvenance = postedAtProvenance;
  }
  return Object.freeze(normalized);
}

export function normalizeResultIndex(result) {
  const rawSearchId = readResultProperty(result, "searchId");
  const searchId = rawSearchId === null
    ? null
    : validateSafeId(rawSearchId, SEARCH_ID_MAX_LENGTH, "search identifier");
  const rawProvider = readResultProperty(result, "provider");
  const rawModel = readResultProperty(result, "model");
  const provider = searchId === null ? null : normalizeProviderResult(result);
  const model = searchId === null ? null : normalizeModelResult(result, provider);
  const revision = normalizeNonNegativeInteger(readResultProperty(result, "revision"));
  const total = normalizeNonNegativeInteger(readResultProperty(result, "total"));
  const observedAt = normalizeUtcTimestamp(readResultProperty(result, "observedAt"), {
    nullable: true,
  });
  const rawResults = readResultProperty(result, "results");
  const resultIds = readVisibleResultIds(rawResults);
  const indexItems = [];
  for (let index = 0; index < resultIds.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(rawResults, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
    }
    indexItems.push(normalizeIndexItem(descriptor.value));
  }
  const results = Object.freeze(indexItems);

  if (
    total !== resultIds.length ||
    results.some(({ resultId }, index) => resultId !== resultIds[index]) ||
    (searchId === null &&
      (rawProvider !== null ||
        rawModel !== null ||
        revision !== 0 ||
        total !== 0 ||
        observedAt !== null ||
        results.length !== 0))
  ) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }

  const normalized = Object.freeze({
    searchId,
    revision,
    total,
    observedAt,
    provider,
    model,
    results,
  });
  if (JSON.stringify(normalized).length > XNHAN_WEBMCP_MAX_INDEX_OUTPUT_CHARS) {
    throw new TypeError("X Nhân WebMCP action returned an oversized result.");
  }
  return normalized;
}

export function normalizeSearchStatus(result) {
  const phase = readResultString(result, "phase");
  const active = readResultProperty(result, "active");
  const rawActiveProvider = readResultProperty(result, "activeProvider");
  const activeProvider = rawActiveProvider === null
    ? null
    : normalizeProviderResult(result, "activeProvider");
  const rawVisibleSearchId = readResultProperty(result, "visibleSearchId");
  const visibleSearchId = rawVisibleSearchId === null
    ? null
    : validateSafeId(
        rawVisibleSearchId,
        SEARCH_ID_MAX_LENGTH,
        "visible search identifier",
      );
  const rawVisibleResultProvider = readResultProperty(
    result,
    "visibleResultProvider",
  );
  const visibleResultProvider = rawVisibleResultProvider === null
    ? null
    : normalizeProviderResult(result, "visibleResultProvider");
  const visibleResultCount = normalizeResultCount(
    readResultProperty(result, "visibleResultCount"),
  );
  if (
    !SEARCH_PHASES.includes(phase) ||
    typeof active !== "boolean" ||
    active !== (phase === "searching") ||
    (active && activeProvider === null) ||
    (!active && activeProvider !== null) ||
    (visibleSearchId === null &&
      (visibleResultProvider !== null || visibleResultCount !== 0)) ||
    (visibleSearchId !== null && visibleResultProvider === null)
  ) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  return Object.freeze({
    phase,
    active,
    activeProvider,
    visibleSearchId,
    visibleResultProvider,
    visibleResultCount,
  });
}

export function normalizeOpenResult(result, expectedResultId) {
  const status = readResultString(result, "status");
  const resultId = validateXStatusId(
    readResultString(result, "resultId"),
    "result identifier",
  );
  if (status !== "navigation_requested" || resultId !== expectedResultId) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }

  const url = readResultProperty(result, "url");
  const match = parseCanonicalXPostUrl(url);
  if (match[2] !== expectedResultId) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  const normalized = Object.freeze({ status, resultId, url });
  if (JSON.stringify(normalized).length > XNHAN_WEBMCP_MAX_OUTPUT_CHARS) {
    throw new TypeError("X Nhân WebMCP action returned an oversized result.");
  }
  return normalized;
}

export function normalizeStopResult(result, { supersededSearches = 0 } = {}) {
  const status = readResultString(result, "status");
  if (!["cancelled", "already_idle"].includes(status)) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  return Object.freeze({
    status:
      status === "already_idle" && supersededSearches > 0
        ? "cancelled"
        : status,
  });
}

export function normalizeNewChatResult(result) {
  const status = readResultString(result, "status");
  const locale = readResultString(result, "locale");
  const path = readResultString(result, "path");
  const focused = readResultProperty(result, "focused");
  if (
    status !== "ready" ||
    !XNHAN_WEBMCP_LOCALES.includes(locale) ||
    !XNHAN_WEBMCP_PATHS.includes(path) ||
    focused !== true
  ) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }
  return Object.freeze({ status, locale, path, focused });
}

export function normalizeLocaleResult(result, expectedLocale) {
  const status = readResultString(result, "status");
  const locale = readResultString(result, "locale");
  const path = readResultString(result, "path");
  if (
    !["changed", "unchanged"].includes(status) ||
    locale !== expectedLocale ||
    !XNHAN_WEBMCP_PATHS.includes(path)
  ) {
    throw new TypeError("X Nhân WebMCP action returned an unsupported result.");
  }

  const normalized = Object.freeze({ status, locale, path });
  if (JSON.stringify(normalized).length > XNHAN_WEBMCP_MAX_OUTPUT_CHARS) {
    throw new TypeError("X Nhân WebMCP action returned an oversized result.");
  }
  return normalized;
}
