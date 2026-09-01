import { isXNhanModelId } from "./xnhan-model-id.js";
import { answerMatchesLocale } from "./answer-language.js";
import { normalizeXNhanModelDisplayName } from "../shared/xnhan-model-display-name.js";
import {
  XNHAN_DEFAULT_LOCALE,
  XNHAN_LOCALES,
} from "./xnhan-locale-constants.js";

export {
  XNHAN_DEFAULT_LOCALE,
  XNHAN_LOCALES,
} from "./xnhan-locale-constants.js";
export const XNHAN_DEFAULT_PROVIDER = "openrouter";
export const XNHAN_PROVIDERS = Object.freeze(["openai", "openrouter"]);

const XNHAN_POST_KINDS = Object.freeze(["unknown", "post", "reply", "repost"]);
const XNHAN_RESPONSE_MODES = Object.freeze(["ai", "retrieval_only"]);
const XNHAN_METRIC_KEYS = Object.freeze(["replies", "reposts", "likes", "views"]);
const XNHAN_ANSWER_BLOCK_BASE_KEYS = Object.freeze([
  "text",
  "prefix",
  "passage",
  "passageLocale",
  "sourceIds",
]);
const XNHAN_ANSWER_BLOCK_TRANSLATION_KEYS = Object.freeze([
  "translationStatus",
  "sourcePassagePrefix",
  "sourcePassage",
  "sourcePassageLocale",
]);
const XNHAN_ANSWER_BLOCK_KEYS = Object.freeze([
  ...XNHAN_ANSWER_BLOCK_BASE_KEYS,
  ...XNHAN_ANSWER_BLOCK_TRANSLATION_KEYS,
]);
// Keep the client boundary defensive when a cached or manually supplied
// response still contains legacy numeric citation markers. Source chips are
// rendered from normalized post IDs, never from answer text.
const LEGACY_CITATION_MARKER_PATTERN = /\[\s*\d{1,2}\s*\]/gu;

export const xnhanContent = Object.freeze({
  vi: Object.freeze({
      meta: Object.freeze({
      title: "X Nhân · Tìm và tổng hợp nội dung từ X",
      description:
        "Tìm bài đăng công khai trên X bằng OpenRouter mặc định, tổng hợp câu trả lời có nguồn và giữ liên kết tới các mục X.",
    }),
    skip: "Đi đến nội dung chính",
    owner: "Trần Thiện Nhân",
    ownerLink: "Về trang cá nhân của Trần Thiện Nhân",
    language: "Ngôn ngữ",
    aboutLink: "Về X Nhân",
    product: "X Nhân",
    newChat: "Tìm kiếm mới",
    heading: "Hỏi một vấn đề. Đọc cuộc trò chuyện đang diễn ra trên X.",
    introduction:
      "X Nhân tìm các post, reply và tín hiệu repost liên quan, sau đó xếp hạng, tổng hợp câu trả lời ngắn và giữ liên kết tới nguồn.",
    conversation: "Cuộc trò chuyện với X Nhân",
    latestUpdate: "Có cập nhật mới · Đi đến cuối",
    initialTitle: "Bạn muốn tìm gì trên X?",
    initialText:
      "Đặt một câu hỏi cụ thể. X Nhân tìm các mục X công khai, tổng hợp ý chính có căn cứ và giữ liên kết ngay bên cạnh kết quả.",
    suggestionsLabel: "Câu hỏi gợi ý",
    suggestions: Object.freeze([
      "Các nhà phát triển đang nói gì về coding agent trong tuần này?",
      "OpenAI, Anthropic và Google đang được so sánh ra sao về mô hình suy luận?",
      "Theo dõi @OpenAI: những thông báo nào đang tạo nhiều thảo luận nhất?",
    ]),
    providers: Object.freeze({
      openai: Object.freeze({
        name: "OpenAI",
      }),
      openrouter: Object.freeze({
        name: "OpenRouter",
      }),
      modelPending: "đang nhận tên model",
      modelUnconfirmed: "chưa nhận tên model",
      snapshotLabel: "Tên model hiển thị của lượt này",
    }),
    form: Object.freeze({
      label: "Câu hỏi tìm kiếm trên X",
      placeholder: "Hỏi X Nhân về một vấn đề…",
      hint: "Enter để tìm · Shift + Enter để xuống dòng",
      submit: "Tìm trên X",
      searching: "Đang tìm",
      retry: "Thử lại",
      tooLong: "Câu hỏi sau khi chuẩn hóa vượt quá giới hạn 400 ký tự.",
    }),
    status: Object.freeze({
      idle: "Sẵn sàng tìm kiếm trên X.",
      loading:
        "X Nhân đang tìm, kiểm tra, xếp hạng và tổng hợp nội dung công khai. Hoạt động thật sẽ xuất hiện ngay bên dưới.",
      error: "Không thể hoàn tất lượt tìm kiếm.",
      cancelled: "Đã dừng chờ kết quả.",
      empty: "Không tìm thấy bài đăng phù hợp trong lượt tìm kiếm này.",
      complete: "Đã tổng hợp câu trả lời và tải các mục X được liên kết.",
    }),
    progress: Object.freeze({
      title: "Đang nghiên cứu trên X",
      label: "X Nhân đang xử lý lượt tìm kiếm",
      elapsed: (value) => `Đã chờ ${value}`,
      stop: "Dừng chờ",
      cancelledTitle: "Đã dừng chờ kết quả",
      cancelledText:
        "Tab và luồng đang hoạt động đã được dừng. Nhà cung cấp có thể đã tiếp nhận một phần công việc trước thời điểm hủy.",
    }),
    activity: Object.freeze({
      title: "Hoạt động",
      live: "Đang cập nhật",
      complete: "Đã hoàn tất",
      discoveryStarted: "Bắt đầu tìm nội dung công khai trên X",
      discoveryCompleted: (count, duration) =>
        `Đã kiểm tra nội dung truy xuất và chấp nhận ${count} bài đăng trong ${duration}`,
      rankingStarted:
        "Đang xếp hạng theo độ liên quan, thời gian, độ phủ truy vấn và tính đa dạng",
      rankingCompleted: (count, duration) =>
        `Đã giữ lại và sắp xếp ${count} mục theo cấu hình xếp hạng trong ${duration}`,
      synthesisStarted: "Bắt đầu tổng hợp câu trả lời từ các mục X đã chọn",
      synthesisCompleted: (duration) => `Đã tổng hợp câu trả lời từ các mục X trong ${duration}`,
      synthesisUnavailable:
        "Không có đoạn truy xuất phù hợp được chọn; các mục X đã truy xuất vẫn được giữ lại",
      reasoningStarted: (phase) =>
        `Mô hình bắt đầu suy luận cho pha ${phase === "discovery" ? "tìm kiếm" : "tổng hợp câu trả lời"}`,
      reasoningCompleted: (phase) =>
        `Mô hình hoàn tất suy luận cho pha ${phase === "discovery" ? "tìm kiếm" : "tổng hợp câu trả lời"}`,
      webSearchStarted: "Đã gọi công cụ web search giới hạn tại x.com",
      webSearchSearching: "Công cụ đang tìm trên x.com",
      webSearchCompleted: "Công cụ đã hoàn tất một lượt tìm trên x.com",
      webSearchUnavailable:
        "Lượt tìm bổ sung đã hết thời gian; các nguồn hợp lệ trước đó vẫn được giữ lại",
      queries: "Truy vấn",
      summary: "Reasoning summary do mô hình cung cấp",
      consultedSources: "Post X đã được công cụ tư vấn",
      openSource: (handle) => `Mở post của @${handle} trên X`,
    }),
    errors: Object.freeze({
      generic: Object.freeze({
        openai: "OpenAI chưa thể trả kết quả cho lượt này.",
        openrouter: "OpenRouter chưa thể trả kết quả cho lượt này.",
      }),
      timeout: "Lượt tìm kiếm mất quá nhiều thời gian. Hãy thử lại với câu hỏi ngắn hơn.",
      rateLimited: "Bạn đã tìm quá nhanh. Hãy đợi một lúc rồi thử lại.",
      invalidResponse: "Dữ liệu trả về không đúng định dạng an toàn của X Nhân.",
      noFallback: (provider) =>
        `X Nhân giữ nguyên ${provider} và không tự chuyển nhà cung cấp.`,
    }),
    results: Object.freeze({
      userLabel: "Câu hỏi của bạn",
      assistantLabel: "X Nhân",
      answerTitle: "Tóm tắt từ các mục X đã chọn",
      answerUnavailable:
        "X Nhân không chọn được nội dung truy xuất phù hợp cho lượt này. Các mục đã truy xuất được liệt kê bên dưới.",
      answerSourcesLabel: "Nguồn hỗ trợ tóm tắt",
      copy: "Sao chép",
      copyWithSources: "Sao chép câu trả lời và nguồn",
      copied: "Đã sao chép",
      copyFailed: "Không thể sao chép",
      openAnswerSource: (index) =>
        `Mở mục X được liên kết số ${index} trong thẻ mới`,
      openCitationSource: (index, handle) =>
        handle
          ? `Mở nguồn @${handle}, mục X số ${index}, trong thẻ mới`
          : `Mở nguồn X số ${index} trong thẻ mới`,
      sourcesTitle: "Các mục X đã truy xuất",
      sourceTextLabel: "Đoạn trích từ kết quả tìm kiếm",
      usedSourcesDescription:
        "Các nguồn bên dưới hỗ trợ cho phần tóm tắt. Mỗi chip mở đúng bài đăng X tương ứng; nội dung hiển thị có thể là đoạn trích hoặc tóm lược do công cụ tìm kiếm trả về, vì vậy hãy mở nguồn để xem ngữ cảnh hiện tại.",
      retrievedSourcesDescription:
        "Các bài đăng X này được truy xuất để tham khảo nhưng chưa được chọn làm nguồn hỗ trợ cho câu trả lời. Nội dung hiển thị có thể là đoạn trích hoặc tóm lược do công cụ tìm kiếm trả về.",
      coverageNote:
        "Phạm vi tìm kiếm có thể thiếu hoặc chậm hơn X. Đây không phải dòng thời gian đầy đủ và không bảo đảm bao quát mọi bài đăng.",
      sourceCount: (count) => `${count} bài đăng`,
      retrievalTime: "Thời gian truy xuất",
      estimatedPublishedTime: (value) => `Thời gian bài đăng ước tính: ${value}`,
      openOriginal: "Mở bài đăng gốc trên X",
      postKinds: Object.freeze({
        post: "Post",
        reply: "Reply",
        repost: "Repost",
      }),
      metrics: Object.freeze({
        replies: "Phản hồi",
        reposts: "Repost",
        likes: "Lượt thích",
        views: "Lượt xem",
      }),
      unnamedAuthor: "Tài khoản X",
    }),
    emptyTitle: "Chưa thấy bài đăng phù hợp",
    emptyText:
      "Hãy thử một cụm từ cụ thể hơn, thêm tên tài khoản, hashtag hoặc mốc thời gian.",
  }),
  en: Object.freeze({
      meta: Object.freeze({
      title: "X Nhân · Search and synthesize sourced answers from X",
      description:
        "Find public X posts with OpenRouter by default, synthesize a grounded answer, and keep links to the corresponding X items.",
    }),
    skip: "Skip to content",
    owner: "Trần Thiện Nhân",
    ownerLink: "Back to Trần Thiện Nhân's portfolio",
    language: "Language",
    aboutLink: "About X Nhân",
    product: "X Nhân",
    newChat: "New search",
    heading: "Ask about a topic. Read the conversation unfolding on X.",
    introduction:
      "X Nhân finds related public posts, replies, and repost signals, then ranks them, synthesizes a concise grounded answer, and keeps source links.",
    conversation: "Conversation with X Nhân",
    latestUpdate: "New update · Jump to latest",
    initialTitle: "What do you want to find on X?",
    initialText:
      "Ask a specific question. X Nhân finds public X items, synthesizes the main themes with evidence, and keeps linked items next to the result.",
    suggestionsLabel: "Suggested questions",
    suggestions: Object.freeze([
      "What are developers saying about coding agents this week?",
      "How are OpenAI, Anthropic, and Google being compared on reasoning models?",
      "Track @OpenAI: which announcements are generating the most discussion?",
    ]),
    providers: Object.freeze({
      openai: Object.freeze({
        name: "OpenAI",
      }),
      openrouter: Object.freeze({
        name: "OpenRouter",
      }),
      modelPending: "loading model name",
      modelUnconfirmed: "model name unavailable",
      snapshotLabel: "Displayed model name for this turn",
    }),
    form: Object.freeze({
      label: "Question to search on X",
      placeholder: "Ask X Nhân about a topic…",
      hint: "Enter to search · Shift + Enter for a new line",
      submit: "Search X",
      searching: "Searching",
      retry: "Try again",
      tooLong: "The normalized question exceeds the 400-character limit.",
    }),
    status: Object.freeze({
      idle: "Ready to search X.",
      loading:
        "X Nhân is finding, checking, ranking, and synthesizing public content. Live activity will appear below.",
      error: "The search could not be completed.",
      cancelled: "Stopped waiting for the result.",
      empty: "No matching posts were found in this search.",
      complete: "The synthesized answer and linked X items are ready.",
    }),
    progress: Object.freeze({
      title: "Researching X",
      label: "X Nhân is processing this search",
      elapsed: (value) => `Waiting ${value}`,
      stop: "Stop waiting",
      cancelledTitle: "Stopped waiting for the result",
      cancelledText:
        "This tab and its active stream have stopped. The provider may have accepted some work before cancellation.",
    }),
    activity: Object.freeze({
      title: "Activity",
      live: "Updating",
      complete: "Complete",
      discoveryStarted: "Started finding public content on X",
      discoveryCompleted: (count, duration) =>
        `Checked retrieved content and accepted ${count} ${count === 1 ? "post" : "posts"} in ${duration}`,
      rankingStarted:
        "Ranking by relevance, time, query coverage, and diversity",
      rankingCompleted: (count, duration) =>
        `Retained and ordered ${count} ${count === 1 ? "item" : "items"} using the configured ranking in ${duration}`,
      synthesisStarted: "Started synthesizing an answer from the selected X items",
      synthesisCompleted: (duration) => `Finished synthesizing the answer in ${duration}`,
      synthesisUnavailable:
        "No relevant retrieved passage was selected; retrieved X items remain available",
      reasoningStarted: (phase) =>
        `The model started reasoning for ${phase === "discovery" ? "discovery" : "answer synthesis"}`,
      reasoningCompleted: (phase) =>
        `The model completed reasoning for ${phase === "discovery" ? "discovery" : "answer synthesis"}`,
      webSearchStarted: "Called the web search tool restricted to x.com",
      webSearchSearching: "The tool is searching x.com",
      webSearchCompleted: "The tool completed one x.com search pass",
      webSearchUnavailable:
        "The follow-up search reached its deadline; earlier valid sources were retained",
      queries: "Queries",
      summary: "Model-provided reasoning summary",
      consultedSources: "X posts consulted by the tool",
      openSource: (handle) => `Open @${handle}'s post on X`,
    }),
    errors: Object.freeze({
      generic: Object.freeze({
        openai: "OpenAI could not return a result for this search.",
        openrouter: "OpenRouter could not return a result for this search.",
      }),
      timeout: "The search took too long. Try again with a shorter question.",
      rateLimited: "You are searching too quickly. Wait a moment and try again.",
      invalidResponse: "The response did not match X Nhân's safe data contract.",
      noFallback: (provider) =>
        `X Nhân kept ${provider} selected and did not switch providers automatically.`,
    }),
    results: Object.freeze({
      userLabel: "Your question",
      assistantLabel: "X Nhân",
      answerTitle: "Summary from selected X items",
      answerUnavailable:
        "X Nhân could not select a relevant retrieved passage for this search. The retrieved items are listed below.",
      answerSourcesLabel: "Sources supporting this summary",
      copy: "Copy",
      copyWithSources: "Copy answer and sources",
      copied: "Copied",
      copyFailed: "Could not copy",
      openAnswerSource: (index) =>
        `Open linked X item ${index} in a new tab`,
      openCitationSource: (index, handle) =>
        handle
          ? `Open source @${handle}, X item ${index}, in a new tab`
          : `Open X source ${index} in a new tab`,
      sourcesTitle: "Retrieved X items",
      sourceTextLabel: "Excerpt from search results",
      usedSourcesDescription:
        "The sources below support the summary. Each chip opens the corresponding X post; displayed text may be an excerpt or synopsis returned by the search tool, so open a source to inspect its current context.",
      retrievedSourcesDescription:
        "These X posts were retrieved for reference but were not selected as supporting sources for the answer. Displayed text may be an excerpt or synopsis returned by the search tool.",
      coverageNote:
        "Search coverage can be incomplete or lag behind X. This is not a complete timeline and does not guarantee every relevant post is included.",
      sourceCount: (count) => `${count} ${count === 1 ? "post" : "posts"}`,
      retrievalTime: "Retrieval time",
      estimatedPublishedTime: (value) => `Estimated post time: ${value}`,
      openOriginal: "Open the original post on X",
      postKinds: Object.freeze({
        post: "Post",
        reply: "Reply",
        repost: "Repost",
      }),
      metrics: Object.freeze({
        replies: "Replies",
        reposts: "Reposts",
        likes: "Likes",
        views: "Views",
      }),
      unnamedAuthor: "X account",
    }),
    emptyTitle: "No matching posts yet",
    emptyText:
      "Try a more specific phrase, account name, hashtag, or time reference.",
  }),
});

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isPlainRecord(value)) throw new TypeError(`Invalid ${label}.`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`Invalid ${label}.`);
  }
}

function normalizeBoundedString(value, label, maxLength, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string") throw new TypeError(`Invalid ${label}.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new TypeError(`Invalid ${label}.`);
  }
  return normalized;
}

function normalizeExactBoundedString(value, label, maxLength) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength
  ) {
    throw new TypeError(`Invalid ${label}.`);
  }
  return value;
}

function normalizeNaturalAnswer(value, locale) {
  const normalized = normalizeBoundedString(value, "X Nhân natural answer", 1_800)
    .normalize("NFKC")
    .replace(LEGACY_CITATION_MARKER_PATTERN, "")
    .replace(/[ \t]+/gu, " ")
    .replace(/[ \t]+([,.;:!?])/gu, "$1")
    .replace(/[ \t]*\n[ \t]*/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized) ||
    /[<>`]/u.test(normalized) ||
    /(?:https?:\/\/|www\.|(?:javascript|data|mailto):)/iu.test(normalized) ||
    /@[A-Za-z0-9_]{1,15}\b/u.test(normalized) ||
    /#[\p{L}\p{M}\p{N}_]+/u.test(normalized) ||
    /(?:!\[[^\]]*\]|\[[^\]]*\]\(|^\s{0,3}(?:#{1,6}|>|[-*+]\s|\d+[.)]\s))/mu.test(normalized) ||
    /(?:selected retrieved|retrieved source-language|machine translation|nội dung truy xuất|bản dịch máy|sign up|trending now|terms of service|privacy policy|open original post)/iu.test(normalized) ||
    !answerMatchesLocale(normalized, locale)
  ) {
    throw new TypeError("Invalid X Nhân natural answer.");
  }
  const sentenceCount = Math.max(
    1,
    Array.from(
      normalized.matchAll(/(?:[.!?…]+["'”’)}\]]*|\r?\n+)(?=\s|$)/gu),
    ).length,
  );
  if (sentenceCount < 1 || sentenceCount > 6) {
    throw new TypeError("Invalid X Nhân natural answer sentence count.");
  }
  return normalized;
}

function normalizeTimestamp(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const normalized = normalizeBoundedString(value, label, 64);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== normalized) {
    throw new TypeError(`Invalid ${label}.`);
  }
  return normalized;
}

function normalizePostId(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const normalized = normalizeBoundedString(value, label, 32);
  if (!/^\d+$/u.test(normalized)) throw new TypeError(`Invalid ${label}.`);
  return normalized;
}

function normalizeCount(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Invalid ${label}.`);
  }
  return value;
}

function normalizeProvider(value) {
  const provider = normalizeBoundedString(value, "X Nhân provider", 32);
  if (!XNHAN_PROVIDERS.includes(provider)) {
    throw new TypeError("Invalid X Nhân provider.");
  }
  return provider;
}

function normalizeModel(value, provider) {
  const model = normalizeBoundedString(value, "X Nhân model", 200);
  if (!isXNhanModelId(model, provider)) {
    throw new TypeError("Invalid X Nhân model.");
  }
  return model;
}

function normalizeXPostUrl(value, expectedHandle, expectedId) {
  const raw = normalizeBoundedString(value, "X post URL", 2_048);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError("Invalid X post URL.");
  }

  const pathMatch = parsed.pathname.match(
    /^\/([A-Za-z0-9_]{1,15})\/status\/([1-9]\d{0,29})$/u,
  );
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "x.com" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    !pathMatch ||
    pathMatch[1] !== expectedHandle ||
    pathMatch[2] !== expectedId
  ) {
    throw new TypeError("Invalid X post URL.");
  }

  const canonicalUrl = `https://x.com/${expectedHandle}/status/${expectedId}`;
  if (raw !== canonicalUrl) throw new TypeError("Invalid X post URL.");
  return canonicalUrl;
}

function normalizeMetric(value, label) {
  assertExactKeys(value, ["value", "availability", "observedAt"], label);
  const metricValue = normalizeCount(value.value, `${label} value`, {
    nullable: true,
  });
  const availability = normalizeBoundedString(
    value.availability,
    `${label} availability`,
    64,
  );
  const observedAt = normalizeTimestamp(value.observedAt, `${label} observedAt`, {
    nullable: true,
  });
  if (
    (metricValue === null && (availability !== "unavailable" || observedAt !== null)) ||
    (metricValue !== null && (availability !== "available" || observedAt === null))
  ) {
    throw new TypeError(`Invalid ${label}.`);
  }

  return Object.freeze({
    value: metricValue,
    availability,
    observedAt,
  });
}

export function normalizeXPost(value) {
  assertExactKeys(
    value,
    [
      "id",
      "url",
      "author",
      "text",
      "publishedAt",
      "publishedAtProvenance",
      "postKind",
      "replyToPostId",
      "repostOfPostId",
      "quoteOfPostId",
      "engagement",
    ],
    "X post",
  );
  assertExactKeys(value.author, ["handle", "displayName"], "X post author");
  assertExactKeys(value.engagement, XNHAN_METRIC_KEYS, "X post engagement");

  const handle = normalizeBoundedString(value.author.handle, "X author handle", 15)
    .replace(/^@/u, "");
  if (!/^[A-Za-z0-9_]{1,15}$/u.test(handle)) {
    throw new TypeError("Invalid X author handle.");
  }
  if (handle !== handle.toLowerCase()) {
    throw new TypeError("Invalid X author handle.");
  }
  if (!XNHAN_POST_KINDS.includes(value.postKind)) {
    throw new TypeError("Invalid X post kind.");
  }
  if (!["status_id", "unavailable"].includes(value.publishedAtProvenance)) {
    throw new TypeError("Invalid X post timestamp provenance.");
  }

  const id = normalizePostId(value.id, "X post id");
  if (!/^[1-9]\d{0,29}$/u.test(id)) {
    throw new TypeError("Invalid X post id.");
  }
  const engagement = Object.fromEntries(
    XNHAN_METRIC_KEYS.map((metric) => [
      metric,
      normalizeMetric(value.engagement[metric], `X ${metric} metric`),
    ]),
  );

  const publishedAt = normalizeTimestamp(
    value.publishedAt,
    "X post publishedAt",
    { nullable: true },
  );
  if (
    (publishedAt === null && value.publishedAtProvenance !== "unavailable") ||
    (publishedAt !== null && value.publishedAtProvenance !== "status_id")
  ) {
    throw new TypeError("Invalid X post timestamp provenance state.");
  }

  return Object.freeze({
    id,
    url: normalizeXPostUrl(value.url, handle, id),
    author: Object.freeze({
      handle,
      displayName: normalizeBoundedString(
        value.author.displayName,
        "X author display name",
        200,
        { nullable: true },
      ),
    }),
    text: normalizeBoundedString(value.text, "X post text", 10_000),
    publishedAt,
    publishedAtProvenance: value.publishedAtProvenance,
    postKind: value.postKind,
    replyToPostId: normalizePostId(value.replyToPostId, "replyToPostId", {
      nullable: true,
    }),
    repostOfPostId: normalizePostId(value.repostOfPostId, "repostOfPostId", {
      nullable: true,
    }),
    quoteOfPostId: normalizePostId(value.quoteOfPostId, "quoteOfPostId", {
      nullable: true,
    }),
    engagement: Object.freeze(engagement),
  });
}

export function normalizeXNhanResponse(value) {
  const hasAnswerSourceIds =
    isPlainRecord(value) && Object.hasOwn(value, "answerSourceIds");
  assertExactKeys(
    value,
    [
      "requestId",
      "query",
      "answerLocale",
      "observedAt",
      "answer",
      "answerBlocks",
      "mode",
      "posts",
      "retrieval",
      ...(hasAnswerSourceIds ? ["answerSourceIds"] : []),
    ],
    "X Nhân response",
  );
  if (!XNHAN_RESPONSE_MODES.includes(value.mode)) {
    throw new TypeError("Invalid X Nhân response mode.");
  }
  if (!XNHAN_LOCALES.includes(value.answerLocale)) {
    throw new TypeError("Invalid X Nhân answer locale.");
  }
  if (!Array.isArray(value.posts) || value.posts.length > 20) {
    throw new TypeError("Invalid X Nhân posts.");
  }
  assertExactKeys(
    value.retrieval,
    [
      "provider",
      "model",
      "modelDisplayName",
      "complete",
      "rawCount",
      "acceptedCount",
      "sourceCount",
    ],
    "X Nhân retrieval",
  );
  if (value.retrieval.complete !== false) {
    throw new TypeError("Invalid X Nhân retrieval provider state.");
  }
  const provider = normalizeProvider(value.retrieval.provider);
  const model = normalizeModel(value.retrieval.model, provider);
  const modelDisplayName = normalizeXNhanModelDisplayName(
    value.retrieval.modelDisplayName,
  );
  if (!modelDisplayName) {
    throw new TypeError("Invalid X Nhân model display name.");
  }

  const posts = Object.freeze(value.posts.map(normalizeXPost));
  const rawCount = normalizeCount(value.retrieval.rawCount, "raw result count");
  const acceptedCount = normalizeCount(
    value.retrieval.acceptedCount,
    "accepted result count",
  );
  const sourceCount = normalizeCount(
    value.retrieval.sourceCount,
    "answer source count",
  );
  if (
    acceptedCount > rawCount ||
    sourceCount !== posts.length ||
    sourceCount > acceptedCount
  ) {
    throw new TypeError("Invalid X Nhân retrieval counts.");
  }

  const ids = new Set(posts.map((post) => post.id));
  const urls = new Set(posts.map((post) => post.url));
  if (ids.size !== posts.length || urls.size !== posts.length) {
    throw new TypeError("Duplicate X posts are not allowed.");
  }

  let answer =
    value.answer === null
      ? null
      : normalizeBoundedString(value.answer, "X Nhân answer", 8_000);
  const answerSourceIds = hasAnswerSourceIds
    ? (() => {
        if (!Array.isArray(value.answerSourceIds)) {
          throw new TypeError("Invalid X Nhân answer source IDs.");
        }
        const normalized = value.answerSourceIds.map((sourceId) =>
          normalizePostId(sourceId, "X Nhân answer source id"),
        );
        if (
          normalized.length > 10 ||
          new Set(normalized).size !== normalized.length ||
          normalized.some((sourceId) => !ids.has(sourceId))
        ) {
          throw new TypeError("Invalid X Nhân answer source IDs.");
        }
        const postOrder = new Map(
          posts.map((post, index) => [post.id, index]),
        );
        return Object.freeze(
          normalized.sort((left, right) => postOrder.get(left) - postOrder.get(right)),
        );
      })()
    : null;
  if (
    (value.mode === "ai" && answer === null) ||
    (value.mode === "retrieval_only" && answer !== null)
  ) {
    throw new TypeError("Invalid X Nhân answer mode.");
  }
  if (
    !Array.isArray(value.answerBlocks) ||
    value.answerBlocks.length > 12 ||
    (value.mode === "ai" && value.answerBlocks.length < 1) ||
    (value.mode === "retrieval_only" && value.answerBlocks.length !== 0)
  ) {
    throw new TypeError("Invalid X Nhân answer blocks.");
  }
  const postById = new Map(posts.map((post) => [post.id, post]));
  const citedPostIds = new Set();
  const answerBlocks = Object.freeze(
    value.answerBlocks.map((block) => {
      // Same-locale passages use the compact base shape. Translation metadata
      // is an all-or-nothing extension so a partial or unknown shape still
      // fails closed while valid compact responses remain interoperable with
      // the Worker renderer.
      const hasTranslationMetadata = Object.keys(block).some((key) =>
        XNHAN_ANSWER_BLOCK_TRANSLATION_KEYS.includes(key),
      );
      assertExactKeys(
        block,
        hasTranslationMetadata
          ? XNHAN_ANSWER_BLOCK_KEYS
          : XNHAN_ANSWER_BLOCK_BASE_KEYS,
        "X Nhân answer block",
      );
      if (
        !Array.isArray(block.sourceIds) ||
        block.sourceIds.length !== 1
      ) {
        throw new TypeError("Invalid X Nhân answer block sources.");
      }
      const sourceIds = block.sourceIds.map((sourceId) =>
        normalizePostId(sourceId, "X Nhân answer block source id"),
      );
      const uniqueSourceIds = new Set(sourceIds);
      if (
        uniqueSourceIds.size !== sourceIds.length ||
        sourceIds.some((sourceId) => !ids.has(sourceId))
      ) {
        throw new TypeError("Invalid X Nhân answer block sources.");
      }
      const text = normalizeExactBoundedString(
        block.text,
        "X Nhân answer block text",
        8_000,
      );
      const prefix = normalizeExactBoundedString(
        block.prefix,
        "X Nhân answer block prefix",
        1_000,
      );
      const passage = normalizeExactBoundedString(
        block.passage,
        "X Nhân answer block passage",
        8_000,
      );
      const passageLocale = block.passageLocale;
      const translationStatus = hasTranslationMetadata
        ? block.translationStatus
        : "not_needed";
      const sourcePassagePrefix = !hasTranslationMetadata ||
        block.sourcePassagePrefix === null
        ? null
        : normalizeExactBoundedString(
            block.sourcePassagePrefix,
            "X Nhân source passage prefix",
            1_000,
          );
      const sourcePassage = !hasTranslationMetadata || block.sourcePassage === null
        ? null
        : normalizeExactBoundedString(
            block.sourcePassage,
            "X Nhân source passage",
            8_000,
          );
      const sourcePassageLocale = hasTranslationMetadata
        ? block.sourcePassageLocale
        : null;
      const sourcePost = postById.get(sourceIds[0]);
      const sourceText = sourcePassage ?? passage;
      const expectedText = sourcePassage === null
        ? `${prefix}${passage}`
        : `${prefix}${passage}\n${sourcePassagePrefix}${sourcePassage}`;
      if (
        ![null, ...XNHAN_LOCALES].includes(passageLocale) ||
        !["not_needed", "machine_translated", "translation_unavailable"].includes(
          translationStatus,
        ) ||
        ![null, ...XNHAN_LOCALES].includes(sourcePassageLocale) ||
        text !== expectedText ||
        !prefix.endsWith(`@${sourcePost.author.handle} — `) ||
        !sourcePost.text.includes(sourceText) ||
        (translationStatus === "machine_translated" &&
          (passageLocale !== value.answerLocale ||
            sourcePassage === null ||
            sourcePassagePrefix === null ||
            !sourcePassagePrefix.endsWith(
              `@${sourcePost.author.handle} — `,
            ))) ||
        (translationStatus !== "machine_translated" &&
          (sourcePassage !== null ||
            sourcePassagePrefix !== null ||
            sourcePassageLocale !== null)) ||
        (translationStatus === "not_needed" &&
          passageLocale !== null &&
          passageLocale !== value.answerLocale) ||
        (translationStatus === "translation_unavailable" &&
          passageLocale === value.answerLocale)
      ) {
        throw new TypeError("Invalid X Nhân answer block content.");
      }
      for (const sourceId of sourceIds) citedPostIds.add(sourceId);
      return Object.freeze({
        text,
        prefix,
        passage,
        passageLocale,
        translationStatus,
        sourcePassagePrefix,
        sourcePassage,
        sourcePassageLocale,
        sourceIds: Object.freeze(sourceIds),
      });
    }),
  );
  const legacyAnswer = answerBlocks.map((block) => block.text).join("\n\n");
  const hasNaturalAnswer = value.mode === "ai" && answer !== legacyAnswer;
  if (hasNaturalAnswer) {
    answer = normalizeNaturalAnswer(answer, value.answerLocale);
    if (!hasAnswerSourceIds || answerSourceIds.length < 1) {
      throw new TypeError("Invalid X Nhân natural answer provenance.");
    }
  } else if (hasAnswerSourceIds && value.mode === "retrieval_only" && answerSourceIds.length > 0) {
    throw new TypeError("Invalid X Nhân retrieval answer source IDs.");
  }
  if (
    value.mode === "ai" &&
    (!hasNaturalAnswer && legacyAnswer !== answer ||
      citedPostIds.size !== posts.length)
  ) {
    throw new TypeError("Invalid X Nhân answer block coverage.");
  }

  const requestId = normalizeBoundedString(value.requestId, "request id", 128);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(requestId)) {
    throw new TypeError("Invalid request id.");
  }

  return Object.freeze({
    requestId,
    query: normalizeBoundedString(value.query, "response query", 400),
    answerLocale: value.answerLocale,
    observedAt: normalizeTimestamp(value.observedAt, "retrieval observedAt"),
    answer,
    ...(hasAnswerSourceIds ? { answerSourceIds } : {}),
    answerBlocks,
    mode: value.mode,
    posts,
    retrieval: Object.freeze({
      provider,
      model,
      modelDisplayName,
      complete: false,
      rawCount,
      acceptedCount,
      sourceCount,
    }),
  });
}

export function formatMetric(value, locale = XNHAN_DEFAULT_LOCALE) {
  if (value === null) return "-";
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Metric value must be a non-negative integer or null.");
  }
  const languageTag = locale === "vi" ? "vi-VN" : "en-US";
  return new Intl.NumberFormat(languageTag, { maximumFractionDigits: 0 }).format(value);
}
