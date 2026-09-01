import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildXNhanAuthorFocusedSearchQuery,
  buildXNhanContextualRankingQuery,
  buildXNhanConversationHistory,
  isXNhanAboutPath,
  isXNhanPath,
  normalizeXNhanConversationHistory,
  normalizeXNhanQuery,
  readXNhanSearchQuery,
  resolveXNhanContextualAuthorHandle,
  xNhanQueryLength,
  XNHAN_CONVERSATION_MAX_BYTES,
  XNHAN_CONVERSATION_MAX_TURNS,
  XNHAN_QUERY_INPUT_MAX_UTF16_LENGTH,
  XNHAN_QUERY_MAX_LENGTH,
} from "../shared/xnhan.js";
import {
  formatMetric,
  normalizeXNhanResponse,
  normalizeXPost,
  XNHAN_DEFAULT_LOCALE,
  XNHAN_DEFAULT_PROVIDER,
  XNHAN_LOCALES,
  XNHAN_PROVIDERS,
  xnhanContent,
} from "../src/xnhan-content.js";
import {
  normalizeXNhanAccepted,
  normalizeXNhanActivity,
  normalizeXNhanConsultedSource,
  readXNhanEventStream,
  stripActivitySummaryMarkup,
} from "../src/xnhan-stream.js";
import { isXNhanModelId } from "../src/xnhan-model-id.js";
import {
  formatXNhanAnswerForClipboard,
  supportingAnswerSources,
} from "../src/xnhan-copy.js";
import {
  readExplicitXNhanLocale,
  readInitialXNhanLocale,
  replaceXNhanLocaleInUrl,
  writeStoredXNhanLocale,
  xNhanHref,
} from "../src/xnhan-locale.js";
import { isOpenRouterLogicalModel } from "../worker/xnhan-openrouter.js";
import { rewriteProductShellRequestUrl } from "../vite.config.mjs";
import {
  XNHAN_MODEL_DISPLAY_NAME_FALLBACK,
  XNHAN_MODEL_DISPLAY_NAME_MAX_LENGTH,
  normalizeXNhanModelDisplayName,
  resolveXNhanModelDisplayName,
} from "../shared/xnhan-model-display-name.js";
import {
  observeAutosizeTextarea,
  resizeAutosizeTextarea,
} from "../src/use-autosize-textarea.js";
import {
  createXNhanChatTurn,
  reduceXNhanTurns,
} from "../src/xnhan-session-state.js";
import { executeXNhanSearchRequest } from "../src/xnhan-search-request.js";
import {
  classifyXNhanSearchFailure,
  isCurrentXNhanSearchRequest,
  scheduleXNhanSearchTimeout,
  XNHAN_REQUEST_TIMEOUT_MS,
} from "../src/xnhan-search-lifecycle.js";
import { createXNhanSearchStatus } from "../src/xnhan-search-status.js";
import { createXNhanWebMcpSnapshot } from "../src/xnhan-webmcp-snapshot.js";

const root = new URL("../", import.meta.url);

function source(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

function sseFrame(eventName, payload) {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function eventStreamResponse(frames) {
  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

function engagement(values = {}) {
  return Object.fromEntries(
    ["replies", "reposts", "likes", "views"].map((metric) => [
      metric,
      {
        value: Object.hasOwn(values, metric) ? values[metric] : null,
        availability: values[metric] === null || !Object.hasOwn(values, metric)
          ? "unavailable"
          : "available",
        observedAt: values[metric] === null || !Object.hasOwn(values, metric)
          ? null
          : "2026-08-26T10:00:00.000Z",
      },
    ]),
  );
}

function post(overrides = {}) {
  return {
    id: "1234567890",
    url: "https://x.com/example/status/1234567890",
    author: { handle: "example", displayName: "Example" },
    text: "A public X post.",
    publishedAt: null,
    publishedAtProvenance: "unavailable",
    postKind: "unknown",
    replyToPostId: null,
    repostOfPostId: null,
    quoteOfPostId: null,
    engagement: engagement(),
    ...overrides,
  };
}

function answerBlock(sourcePost, blockIndex = 0, overrides = {}) {
  const prefix = blockIndex === 0
    ? `Selected retrieved text (may be an excerpt or synopsis): @${sourcePost.author.handle} — `
    : `Additional selected retrieved text (may be an excerpt or synopsis): @${sourcePost.author.handle} — `;
  const passage = sourcePost.text;
  return {
    text: `${prefix}${passage}`,
    prefix,
    passage,
    passageLocale: "en",
    translationStatus: "not_needed",
    sourcePassagePrefix: null,
    sourcePassage: null,
    sourcePassageLocale: null,
    sourceIds: [sourcePost.id],
    ...overrides,
  };
}

function response(overrides = {}) {
  const posts = overrides.posts ?? [post()];
  const mode = overrides.mode ?? "ai";
  const answerBlocks =
    overrides.answerBlocks ??
    (mode === "ai"
      ? posts.map((sourcePost, index) => answerBlock(sourcePost, index))
      : []);
  const answer = Object.hasOwn(overrides, "answer")
    ? overrides.answer
    : mode === "ai"
      ? answerBlocks.map((block) => block.text).join("\n\n")
      : null;
  return {
    requestId: "6dcf1e38-4c5f-4f0b-b1b4-23e327726d1f",
    query: "What is being discussed?",
    answerLocale: overrides.answerLocale ?? "en",
    observedAt: "2026-08-26T10:00:00.000Z",
    answer,
    answerBlocks,
    mode,
    posts,
    retrieval: {
      provider: "openai",
      model: "gpt-5.6-luna",
      modelDisplayName: "X Nhân OpenAI",
      complete: false,
      rawCount: posts.length,
      acceptedCount: posts.length,
      sourceCount: posts.length,
    },
    ...overrides,
  };
}

test("keeps path matching exact and gives every product a route-specific entry", async () => {
  assert.equal(isXNhanPath("/xnhan"), true);
  assert.equal(isXNhanPath("/xnhan/"), true);
  assert.equal(isXNhanPath("/xnhan.html"), true);
  assert.equal(isXNhanAboutPath("/xnhan/about"), true);
  assert.equal(isXNhanAboutPath("/xnhan/about/"), true);
  assert.equal(isXNhanAboutPath("/xnhan-about.html"), true);
  for (const pathname of ["/", "/en", "/vi", "/xnhan-old", "/vi/xnhan", "/xnhan/about"]) {
    assert.equal(isXNhanPath(pathname), false, pathname);
  }
  assert.equal(rewriteProductShellRequestUrl("/xnhan"), "/xnhan.html");
  assert.equal(rewriteProductShellRequestUrl("/xnhan/"), "/xnhan.html");
  assert.equal(
    rewriteProductShellRequestUrl("/xnhan/about/?locale=vi"),
    "/xnhan-about.html?locale=vi",
  );
  assert.equal(rewriteProductShellRequestUrl("/vi?ref=xnhan"), "/vi?ref=xnhan");

  const [main, xnhanMain, aboutMain, xnhan, about, portfolio, portfolioRoute] = await Promise.all([
    source("src/main.jsx"),
    source("src/xnhan-main.jsx"),
    source("src/xnhan-about-main.jsx"),
    source("src/XNhanApp.jsx"),
    source("src/XNhanAboutApp.jsx"),
    source("src/App.jsx"),
    source("src/portfolio/PortfolioRoute.jsx"),
  ]);
  assert.match(main, /import \{ App \} from "\.\/App\.jsx"/u);
  assert.match(xnhanMain, /import \{ XNhanApp \} from "\.\/XNhanApp\.jsx"/u);
  assert.match(
    aboutMain,
    /import \{ XNhanAboutApp \} from "\.\/XNhanAboutApp\.jsx"/u,
  );
  assert.match(main, /<App \/>/u);
  assert.match(xnhanMain, /<XNhanApp \/>/u);
  assert.match(aboutMain, /<XNhanAboutApp \/>/u);
  assert.doesNotMatch(`${main}\n${xnhanMain}\n${aboutMain}`, /import\(/u);
  assert.doesNotMatch(`${xnhanMain}\n${aboutMain}`, /styles\.css/u);
  for (const entry of [main, xnhanMain, aboutMain]) {
    assert.match(entry, /import "\.\/fonts\.css"/u);
    assert.match(entry, /import "\.\/base\.css"/u);
  }
  assert.doesNotMatch(xnhan, /AskNhan|usePortfolioWebMcp|portfolio-webmcp/u);
  assert.match(xnhan, /setLinkHref\('link\[rel="canonical"\]', XNHAN_CANONICAL_URL\)/u);
  assert.match(xnhan, /setMetaContent\('meta\[property="og:url"\]', XNHAN_CANONICAL_URL\)/u);
  assert.doesNotMatch(about, /AskNhan|usePortfolioWebMcp|useXNhanWebMcp|fetch\(/u);
  assert.match(about, /useXNhanAboutWebMcp/u);
  assert.match(portfolio, /<PortfolioRoute \/>/u);
  assert.match(portfolioRoute, /<AskNhan/u);
  assert.match(portfolioRoute, /usePortfolioWebMcp/u);
});

test("normalizes every client and Worker query through one bounded contract", async () => {
  const cases = new Map([
    ["  Cloudflare   Workers AI  ", "Cloudflare Workers AI"],
    ["dòng một\ndòng hai", "dòng một dòng hai"],
    ["na\u0301y", "náy"],
    ["ＡＩ", "AI"],
    ["\u0000 câu\u200B hỏi ", "câu hỏi"],
  ]);
  for (const [input, expected] of cases) {
    assert.equal(normalizeXNhanQuery(input), expected, JSON.stringify(input));
  }
  assert.equal(normalizeXNhanQuery(" ".repeat(500) + "ok"), "ok");
  assert.equal(normalizeXNhanQuery("ﬃ".repeat(150)).length, 450);
  assert.equal(XNHAN_QUERY_MAX_LENGTH, 400);
  assert.equal(XNHAN_QUERY_INPUT_MAX_UTF16_LENGTH, 800);
  assert.throws(() => xNhanQueryLength(null), TypeError);

  const fourHundredAstral = "🧠".repeat(400);
  const fourHundredOneAstral = `${fourHundredAstral}🧠`;
  assert.equal(fourHundredAstral.length, 800);
  assert.equal(xNhanQueryLength(fourHundredAstral), 400);
  assert.equal(xNhanQueryLength(fourHundredOneAstral), 401);
  assert.deepEqual(readXNhanSearchQuery(fourHundredAstral), {
    normalizedQuery: fourHundredAstral,
    queryLength: 400,
    queryTooLong: false,
    valid: true,
  });
  assert.deepEqual(readXNhanSearchQuery(fourHundredOneAstral), {
    normalizedQuery: fourHundredOneAstral,
    queryLength: 401,
    queryTooLong: true,
    valid: false,
  });
  assert.equal(readXNhanSearchQuery("a".repeat(400)).valid, true);
  assert.equal(readXNhanSearchQuery("a".repeat(401)).valid, false);

  const [app, session, worker] = await Promise.all([
    source("src/XNhanApp.jsx"),
    source("src/use-xnhan-search-session.js"),
    source("worker/xnhan.js"),
  ]);
  assert.match(session, /readXNhanSearchQuery\(requestedQuery\)/u);
  assert.match(app, /readXNhanSearchQuery\(query\)/u);
  assert.match(
    app,
    /maxLength=\{XNHAN_QUERY_INPUT_MAX_UTF16_LENGTH\}/u,
  );
  assert.match(app, /aria-invalid=\{queryTooLong \|\| undefined\}/u);
  assert.match(app, /disabled=\{!queryIsValid \|\| busy\}/u);
  assert.match(app, /\{queryLength\} \/ \{XNHAN_QUERY_MAX_LENGTH\}/u);
  assert.match(worker, /normalizeXNhanQuery\(body\.query\)/u);
  assert.match(worker, /xNhanQueryLength\(query\) > XNHAN_QUERY_MAX_LENGTH/u);
});

test("builds a bounded transient conversation context from completed turns", () => {
  const normalized = normalizeXNhanConversationHistory([
    {
      user: "  So sa\u0301nh   Sam và Dario  ",
      assistant: " Dario\u200B được nhắc ở kết quả thứ hai. ",
    },
  ]);
  assert.deepEqual(normalized, [
    {
      user: "So sánh Sam và Dario",
      assistant: "Dario được nhắc ở kết quả thứ hai.",
    },
  ]);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized[0]), true);
  assert.equal(
    buildXNhanContextualRankingQuery("người thứ hai", normalized),
    "So sánh Sam và Dario người thứ hai",
  );
  assert.doesNotMatch(
    buildXNhanContextualRankingQuery("người thứ hai", normalized),
    /Dario được nhắc/u,
  );
  assert.equal(
    buildXNhanContextualRankingQuery(
      "Azure confidential computing",
      normalized,
    ),
    "Azure confidential computing",
  );
  const handleHistory = normalizeXNhanConversationHistory([
    {
      user: "Find posts from @OpenAI and @AnthropicAI",
      assistant: "Previous result 1 and previous result 2.",
    },
  ]);
  assert.equal(
    resolveXNhanContextualAuthorHandle("What did the second account post?", handleHistory),
    "AnthropicAI",
  );
  assert.equal(
    resolveXNhanContextualAuthorHandle("What did the first account post?", handleHistory),
    "OpenAI",
  );
  assert.equal(
    buildXNhanAuthorFocusedSearchQuery(
      buildXNhanContextualRankingQuery(
        "What did the second account post?",
        handleHistory,
      ),
      "AnthropicAI",
    ),
    "Find direct public X status posts authored by @AnthropicAI. " +
      "Search X using from:AnthropicAI. " +
      "Return only x.com/AnthropicAI/status URLs. " +
      "Topic context: Find posts from and What did the second account post?",
  );
  assert.equal(
    resolveXNhanContextualAuthorHandle("What did the second model do?", handleHistory),
    null,
  );

  const history = buildXNhanConversationHistory([
    {
      submittedQuery: "lượt lỗi không được ghi nhớ",
      response: null,
    },
    {
      submittedQuery: "Tìm Sam Altman và Dario Amodei",
      response: {
        answer: "Hai người đều xuất hiện trong phần truy xuất.",
        posts: [
          {
            author: { handle: "sama" },
            text: "A first selected passage.",
            url: "https://x.com/sama/status/1234567890",
          },
          {
            author: { handle: "DarioAmodei" },
            text: "A second selected passage.",
            url: "https://x.com/DarioAmodei/status/2234567890",
          },
        ],
      },
    },
  ]);
  assert.equal(history.length, 1);
  assert.equal(history[0].user, "Tìm Sam Altman và Dario Amodei");
  assert.match(history[0].assistant, /Previous answer:/u);
  assert.match(history[0].assistant, /Previous result 1: @sama/u);
  assert.match(history[0].assistant, /Previous result 2: @DarioAmodei/u);
  assert.doesNotMatch(JSON.stringify(history), /lượt lỗi/u);

  const manyTurns = buildXNhanConversationHistory(
    Array.from({ length: 12 }, (_, index) => ({
      submittedQuery: `question ${index}`,
      response: { answer: `answer ${index}`, posts: [] },
    })),
  );
  assert.equal(manyTurns.length, XNHAN_CONVERSATION_MAX_TURNS);
  assert.equal(manyTurns[0].user, "question 5");
  assert.equal(manyTurns.at(-1).user, "question 11");
  assert.ok(
    new TextEncoder().encode(JSON.stringify(manyTurns)).byteLength <=
      XNHAN_CONVERSATION_MAX_BYTES,
  );
});

test("keeps X Nhân turn transitions pure, bounded, and provenance preserving", () => {
  const turn = createXNhanChatTurn(
    "What changed?",
    "openai",
    "en",
    [{ user: "Earlier", assistant: "Context" }],
    { createId: () => "turn-1", now: () => 123_456 },
  );
  assert.deepEqual(
    {
      id: turn.id,
      phase: turn.phase,
      provider: turn.provider,
      answerLocale: turn.answerLocale,
      startedAt: turn.startedAt,
      requestHistory: turn.requestHistory,
    },
    {
      id: "turn-1",
      phase: "loading",
      provider: "openai",
      answerLocale: "en",
      startedAt: 123_456,
      requestHistory: [{ user: "Earlier", assistant: "Context" }],
    },
  );

  const appended = reduceXNhanTurns([{ id: "retired" }], {
    type: "append",
    turn,
    maximumTurns: 1,
  });
  assert.deepEqual(appended, [turn]);

  const accepted = reduceXNhanTurns(appended, {
    type: "accepted",
    turnId: turn.id,
    accepted: {
      requestId: "request-1",
      model: "gpt-5.6-luna",
      modelDisplayName: "X Nhân OpenAI",
    },
  });
  const activity = { sequence: 1, summary: "Searching" };
  const withActivity = reduceXNhanTurns(accepted, {
    type: "activity",
    turnId: turn.id,
    activity,
  });
  assert.equal(
    reduceXNhanTurns(withActivity, {
      type: "activity",
      turnId: turn.id,
      activity,
    }),
    withActivity,
    "duplicate activity events must not allocate a new turn list",
  );

  const sourceItem = { url: "https://x.com/example/status/1234567890" };
  const withSource = reduceXNhanTurns(withActivity, {
    type: "source",
    turnId: turn.id,
    source: sourceItem,
  });
  assert.equal(
    reduceXNhanTurns(withSource, {
      type: "source",
      turnId: turn.id,
      source: sourceItem,
    }),
    withSource,
    "duplicate consulted sources must not allocate a new turn list",
  );

  const normalized = normalizeXNhanResponse(response());
  const completed = reduceXNhanTurns(withSource, {
    type: "completed",
    turnId: turn.id,
    response: normalized,
  });
  assert.equal(completed[0].phase, "complete");
  assert.equal(completed[0].provider, normalized.retrieval.provider);
  assert.equal(completed[0].model, normalized.retrieval.model);
  assert.equal(completed[0].response, normalized);
  assert.deepEqual(reduceXNhanTurns(completed, { type: "reset" }), []);
});

test("autosizes on value changes without coupling ResizeObserver lifetime to typing", async () => {
  const input = {
    parentElement: { name: "composer" },
    scrollHeight: 240,
    style: { height: "12px" },
  };
  assert.equal(resizeAutosizeTextarea(input), true);
  assert.equal(input.style.height, "160px");
  assert.equal(resizeAutosizeTextarea(input, 200), true);
  assert.equal(input.style.height, "200px");
  assert.equal(resizeAutosizeTextarea(null), false);

  const events = [];
  class FakeResizeObserver {
    constructor(callback) {
      events.push(["construct", callback]);
    }

    observe(target) {
      events.push(["observe", target]);
    }

    disconnect() {
      events.push(["disconnect"]);
    }
  }
  const resize = () => {};
  const disconnect = observeAutosizeTextarea(input, resize, FakeResizeObserver);
  assert.deepEqual(events, [
    ["construct", resize],
    ["observe", input.parentElement],
  ]);
  disconnect();
  assert.deepEqual(events.at(-1), ["disconnect"]);
  assert.doesNotThrow(() => observeAutosizeTextarea(input, resize, undefined)());

  const hookSource = await source("src/use-autosize-textarea.js");
  assert.match(
    hookSource,
    /useLayoutEffect\(\(\) => \{\s*resize\(\);\s*\}, \[resize, value\]\)/u,
  );
  assert.match(
    hookSource,
    /useEffect\(\(\) => \{[\s\S]*?observeAutosizeTextarea\(input, resize\);[\s\S]*?\}, \[inputRef, resize\]\)/u,
  );
});

test("projects the visible X Nhân state into an immutable WebMCP snapshot", () => {
  const normalized = normalizeXNhanResponse(response({ answerSourceIds: [post().id] }));
  const history = Object.freeze([{ user: "Earlier", assistant: "Context" }]);
  const snapshot = createXNhanWebMcpSnapshot({
    activeResponse: normalized,
    defaultProvider: XNHAN_DEFAULT_PROVIDER,
    latestTurn: {
      phase: "complete",
      provider: normalized.retrieval.provider,
      submittedQuery: normalized.query,
    },
    locale: "en",
    query: "draft query",
    revision: 7,
    visibleConversationHistory: history,
  });

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.visibleResults), true);
  assert.equal(snapshot.visibleConversationHistory, history);
  assert.equal(snapshot.query, normalized.query);
  assert.equal(snapshot.searchId, normalized.requestId);
  assert.equal(snapshot.visibleResults.revision, 7);
  assert.deepEqual(snapshot.visibleResults.answerSourceIds, normalized.answerSourceIds);
  assert.deepEqual(snapshot.visibleResults.answerBlocks[0].sourceIds, [post().id]);
  assert.equal(snapshot.visibleResults.results[0].text, post().text);

  const empty = createXNhanWebMcpSnapshot({
    activeResponse: null,
    defaultProvider: XNHAN_DEFAULT_PROVIDER,
    latestTurn: null,
    locale: "vi",
    query: "",
    revision: 99,
    visibleConversationHistory: [],
  });
  assert.equal(empty.phase, "idle");
  assert.equal(empty.provider, XNHAN_DEFAULT_PROVIDER);
  assert.equal(empty.visibleResults.revision, 0);
  assert.deepEqual(empty.visibleResults.results, []);
});

test("rejects malformed or over-budget conversation context", () => {
  const pair = { user: "question", assistant: "answer" };
  for (const value of [
    null,
    {},
    [{ ...pair, extra: true }],
    [{ user: "", assistant: "answer" }],
    [{ user: "question", assistant: "" }],
    [{ user: "question", assistant: "a".repeat(2_801) }],
    Array.from({ length: XNHAN_CONVERSATION_MAX_TURNS + 1 }, () => pair),
    Array.from({ length: 3 }, () => ({
      user: "question",
      assistant: "🙂".repeat(1_100),
    })),
  ]) {
    assert.equal(normalizeXNhanConversationHistory(value), null);
  }
  assert.deepEqual(normalizeXNhanConversationHistory([]), []);
});

test("keeps the X Nhân HTML shell product-specific and free of portfolio Person data", async () => {
  const [sourceShell, builtShell] = await Promise.all([
    source("xnhan.html"),
    source("dist/client/xnhan.html"),
  ]);

  for (const shell of [sourceShell, builtShell]) {
    assert.match(shell, /<html lang="en">/u);
    assert.match(
      shell,
      /<link rel="canonical" href="https:\/\/tranthiennhan\.com\/xnhan" \/>/u,
    );
    assert.match(shell, /<meta property="og:type" content="website" \/>/u);
    assert.match(shell, /<meta property="og:site_name" content="X Nhân" \/>/u);
    assert.match(shell, /<meta property="og:locale" content="en_US" \/>/u);
    assert.match(shell, /<meta property="og:locale:alternate" content="vi_VN" \/>/u);
    assert.doesNotMatch(shell, /data-portfolio-schema|"@type"\s*:\s*"Person"/u);
  }
  assert.match(sourceShell, /src\/xnhan-main\.jsx/u);
  const stylesheetHrefs = [
    ...builtShell.matchAll(/<link\b[^>]*href="([^"]+\.css)"/gu),
  ].map((match) => match[1]);
  assert.equal(
    stylesheetHrefs.filter((href) =>
      /^\/assets\/xnhan-(?!locale-)[A-Za-z0-9_-]+\.css$/u.test(href),
    ).length,
    1,
  );
  assert.doesNotMatch(builtShell, /\/assets\/portfolio-[^/]+\.css/u);
  assert.match(builtShell, /\/assets\/[A-Za-z0-9._-]+\.js/u);
  assert.match(builtShell, /\/assets\/[A-Za-z0-9._-]+\.css/u);
});

test("accepts explicit null source data and preserves observed numeric zero", () => {
  const normalized = normalizeXNhanResponse(
    response({
      posts: [
        post({
          engagement: engagement({ replies: 0, reposts: null, likes: 12, views: null }),
        }),
      ],
    }),
  );

  assert.equal(normalized.posts[0].publishedAt, null);
  assert.equal(normalized.posts[0].postKind, "unknown");
  assert.equal(normalized.posts[0].engagement.replies.value, 0);
  assert.equal(normalized.posts[0].engagement.reposts.value, null);
  assert.equal(formatMetric(0, "vi"), "0");
  assert.equal(formatMetric(null, "vi"), "-");
});

test("accepts the Worker compact answer-block shape for same-locale passages", () => {
  const sourcePost = post();
  const fullBlock = answerBlock(sourcePost);
  const compactBlock = {
    text: fullBlock.text,
    prefix: fullBlock.prefix,
    passage: fullBlock.passage,
    passageLocale: fullBlock.passageLocale,
    sourceIds: fullBlock.sourceIds,
  };
  const normalized = normalizeXNhanResponse(
    response({ posts: [sourcePost], answerBlocks: [compactBlock] }),
  );

  assert.deepEqual(normalized.answerBlocks[0], {
    ...compactBlock,
    translationStatus: "not_needed",
    sourcePassagePrefix: null,
    sourcePassage: null,
    sourcePassageLocale: null,
  });
  assert.throws(
    () =>
      normalizeXNhanResponse(
        response({
          posts: [sourcePost],
          answerBlocks: [{ ...compactBlock, translationStatus: "not_needed" }],
        }),
      ),
    TypeError,
  );
});

test("rejects noncanonical or author-mismatched source links", () => {
  for (const url of [
    "http://x.com/example/status/1234567890",
    "https://www.x.com/example/status/1234567890",
    "https://twitter.com/example/status/1234567890",
    "https://x.com/example/status/1234567890?tracking=1",
    "https://x.com/example/status/1234567890#fragment",
    "https://x.com.evil.example/example/status/1234567890",
    "javascript:alert(1)",
  ]) {
    assert.throws(() => normalizeXPost(post({ url })), TypeError, url);
  }
  assert.throws(
    () => normalizeXPost(post({ url: "https://x.com/other/status/1234567890" })),
    TypeError,
  );
});

test("enforces the bounded response shape and separates posting from retrieval time", () => {
  assert.throws(
    () => normalizeXNhanResponse({ ...response(), extra: true }),
    TypeError,
  );
  assert.throws(
    () =>
      normalizeXNhanResponse(
        response({
          posts: [post(), post()],
          retrieval: {
            provider: "openai",
            model: "gpt-5.6-luna",
            modelDisplayName: "X Nhân OpenAI",
            complete: false,
            rawCount: 2,
            acceptedCount: 2,
            sourceCount: 2,
          },
        }),
      ),
    TypeError,
  );
  assert.throws(
    () =>
      normalizeXNhanResponse(
        response({
          answerBlocks: [
            answerBlock(post(), 0, { sourceIds: ["9999999999"] }),
          ],
        }),
      ),
    TypeError,
  );
  assert.throws(
    () =>
      normalizeXNhanResponse(
        response({
          answer: "One answer.",
          answerBlocks: [answerBlock(post(), 1)],
        }),
      ),
    TypeError,
  );

  const normalized = normalizeXNhanResponse(response());
  assert.equal(normalized.posts[0].publishedAt, null);
  assert.equal(normalized.observedAt, "2026-08-26T10:00:00.000Z");
  assert.equal(normalized.retrieval.provider, "openai");
  assert.equal(normalized.retrieval.model, "gpt-5.6-luna");
  assert.equal(normalized.retrieval.modelDisplayName, "X Nhân OpenAI");

  const openrouter = normalizeXNhanResponse(
    response({
      retrieval: {
        provider: "openrouter",
        model: "z-ai/glm-5.3-flash",
        modelDisplayName: "X Nhân Nhanh",
        complete: false,
        rawCount: 1,
        acceptedCount: 1,
        sourceCount: 1,
      },
    }),
  );
  assert.equal(openrouter.retrieval.provider, "openrouter");
  assert.equal(openrouter.retrieval.model, "z-ai/glm-5.3-flash");
  assert.equal(openrouter.retrieval.modelDisplayName, "X Nhân Nhanh");

  const genericOpenRouter = normalizeXNhanResponse(
    response({
      retrieval: {
        provider: "openrouter",
        model: "research-lab/Model.family+fast:beta",
        modelDisplayName: "Model nghiên cứu",
        complete: false,
        rawCount: 1,
        acceptedCount: 1,
        sourceCount: 1,
      },
    }),
  );
  assert.equal(
    genericOpenRouter.retrieval.model,
    "research-lab/Model.family+fast:beta",
  );

  for (const retrieval of [
    { ...response().retrieval, provider: "openai_web_search" },
    { ...response().retrieval, model: "model with spaces" },
    { ...response().retrieval, model: "" },
    { ...response().retrieval, model: "author/model" },
    {
      ...response().retrieval,
      provider: "openrouter",
      model: "Uppercase-author/model",
    },
    {
      ...response().retrieval,
      provider: "openrouter",
      model: "author+suffix/model",
    },
    {
      ...response().retrieval,
      provider: "openrouter",
      model: "author/nested/model",
    },
  ]) {
    assert.throws(
      () => normalizeXNhanResponse(response({ retrieval })),
      TypeError,
    );
  }
});

test("accepts only exact server-confirmed provider, model, and display-name snapshots", () => {
  const accepted = normalizeXNhanAccepted({
    requestId: "6dcf1e38-4c5f-4f0b-b1b4-23e327726d1f",
    provider: "openrouter",
    model: "z-ai/glm-5.3-flash",
    modelDisplayName: "X Nhân Nhanh",
  });
  assert.deepEqual(accepted, {
    requestId: "6dcf1e38-4c5f-4f0b-b1b4-23e327726d1f",
    provider: "openrouter",
    model: "z-ai/glm-5.3-flash",
    modelDisplayName: "X Nhân Nhanh",
  });
  assert.equal(Object.isFrozen(accepted), true);

  assert.deepEqual(
    normalizeXNhanAccepted({
      requestId: "9f1dc85b-2a3b-4dd9-9a45-9eaabaf420de",
      provider: "openrouter",
      model: "research-lab/Model.family+fast:beta",
      modelDisplayName: "  Ｘ Nhân   Nghiên cứu  ",
    }),
    {
      requestId: "9f1dc85b-2a3b-4dd9-9a45-9eaabaf420de",
      provider: "openrouter",
      model: "research-lab/Model.family+fast:beta",
      modelDisplayName: "X Nhân Nghiên cứu",
    },
  );

  for (const payload of [
    { ...accepted, extra: true },
    { ...accepted, provider: "automatic" },
    { ...accepted, model: "model with spaces" },
    { ...accepted, modelDisplayName: "" },
    { ...accepted, modelDisplayName: "X\u202ENhân" },
    { ...accepted, modelDisplayName: "x".repeat(81) },
    { ...accepted, requestId: "not-a-request-id" },
    {
      requestId: accepted.requestId,
      provider: accepted.provider,
      model: accepted.model,
    },
  ]) {
    assert.throws(() => normalizeXNhanAccepted(payload), TypeError);
  }
});

test("normalizes owner-configured model display names without exposing unsafe labels", () => {
  assert.equal(
    normalizeXNhanModelDisplayName("  Ｘ Nhân   Cận cao cấp  "),
    "X Nhân Cận cao cấp",
  );
  assert.equal(
    normalizeXNhanModelDisplayName("M".repeat(XNHAN_MODEL_DISPLAY_NAME_MAX_LENGTH)),
    "M".repeat(XNHAN_MODEL_DISPLAY_NAME_MAX_LENGTH),
  );
  for (const value of [
    undefined,
    "",
    " ",
    "M".repeat(XNHAN_MODEL_DISPLAY_NAME_MAX_LENGTH + 1),
    "X\u0000Nhân",
    "X\u202ENhân",
    "X\u200BNhân",
    "\ud800",
  ]) {
    assert.equal(normalizeXNhanModelDisplayName(value), null);
    assert.equal(resolveXNhanModelDisplayName(value), XNHAN_MODEL_DISPLAY_NAME_FALLBACK);
  }
});

test("keeps the frontend OpenRouter model grammar exactly aligned with the Worker", () => {
  const candidates = [
    "z-ai/glm-5.3-flash",
    "research-lab/Model.family+fast:beta",
    `${"a".repeat(64)}/${"M".repeat(128)}`,
    `${"a".repeat(65)}/model`,
    `author/${"m".repeat(129)}`,
    "Uppercase-author/model",
    "author+suffix/model",
    "author/nested/model",
    "author/model with spaces",
    "glm-only",
    "",
  ];
  for (const candidate of candidates) {
    assert.equal(
      isXNhanModelId(candidate, "openrouter"),
      isOpenRouterLogicalModel(candidate),
      candidate,
    );
  }
  assert.equal(isXNhanModelId("gpt-5.6-luna+fast:2026", "openai"), true);
  assert.equal(isXNhanModelId("author/model", "openai"), false);
  assert.equal(isXNhanModelId("z-ai/glm-5.3-flash", "automatic"), false);
});

test("keeps bilingual X Nhân copy structurally aligned without guaranteed metric claims", () => {
  assert.deepEqual(XNHAN_LOCALES, ["en", "vi"]);
  assert.equal(XNHAN_DEFAULT_LOCALE, "en");
  assert.deepEqual(XNHAN_PROVIDERS, ["openai", "openrouter"]);
  assert.equal(XNHAN_DEFAULT_PROVIDER, "openrouter");
  assert.deepEqual(
    Object.keys(xnhanContent.vi).sort(),
    Object.keys(xnhanContent.en).sort(),
  );
  assert.equal(Object.hasOwn(xnhanContent.vi, "privacySummary"), false);
  assert.equal(Object.hasOwn(xnhanContent.en, "privacySummary"), false);
  assert.equal(Object.hasOwn(xnhanContent.vi, "privacy"), false);
  assert.equal(Object.hasOwn(xnhanContent.en, "privacy"), false);
  assert.match(xnhanContent.vi.results.usedSourcesDescription, /nguồn.+hỗ trợ.+tóm tắt/iu);
  assert.match(xnhanContent.en.results.usedSourcesDescription, /sources.+support.+summary/iu);
  assert.equal(
    xnhanContent.vi.results.answerSourcesLabel,
    "Nguồn hỗ trợ tóm tắt",
  );
  assert.equal(xnhanContent.en.results.answerSourcesLabel, "Sources supporting this summary");
  assert.match(xnhanContent.vi.results.openAnswerSource(2), /mục X.+số 2.+thẻ mới/iu);
  assert.match(xnhanContent.en.results.openAnswerSource(2), /linked X item 2.+new tab/iu);
  assert.match(
    xnhanContent.vi.results.openCitationSource(2, "openai"),
    /@openai.+mục X số 2.+thẻ mới/iu,
  );
  assert.match(
    xnhanContent.en.results.openCitationSource(2, "openai"),
    /@openai.+X item 2.+new tab/iu,
  );
  assert.match(xnhanContent.vi.results.coverageNote, /không phải.+đầy đủ/iu);
  assert.match(xnhanContent.en.results.coverageNote, /not a complete timeline/iu);
  assert.match(xnhanContent.vi.progress.cancelledText, /luồng.+dừng.+nhà cung cấp/iu);
  assert.match(xnhanContent.en.progress.cancelledText, /stream.+stopped.+provider/iu);
  assert.equal(Object.hasOwn(xnhanContent.vi, "capabilities"), false);
  assert.equal(Object.hasOwn(xnhanContent.en, "capabilities"), false);
  assert.equal(Object.hasOwn(xnhanContent.vi.activity, "boundary"), false);
  assert.equal(Object.hasOwn(xnhanContent.en.activity, "boundary"), false);
  assert.equal(Object.hasOwn(xnhanContent.vi.results, "publishedTimeDerived"), false);
  assert.equal(Object.hasOwn(xnhanContent.en.results, "publishedTimeDerived"), false);
  assert.match(
    xnhanContent.en.results.estimatedPublishedTime("Aug 28, 2026"),
    /Estimated post time/u,
  );
});

test("accepts only the exact server-rendered retrieval block contract", () => {
  const vietnamesePost = post({
    text: "Nội dung truy xuất bằng tiếng Việt.",
  });
  const prefix =
    "Nội dung truy xuất đã chọn (có thể là đoạn trích hoặc tóm lược): @example — ";
  const passage = vietnamesePost.text;
  const validBlock = answerBlock(vietnamesePost, 0, {
    text: `${prefix}${passage}`,
    prefix,
    passage,
    passageLocale: "vi",
  });
  const normalized = normalizeXNhanResponse(
    response({
      posts: [vietnamesePost],
      answerLocale: "vi",
      answer: validBlock.text,
      answerBlocks: [validBlock],
    }),
  );

  assert.deepEqual(normalized.answerBlocks[0], validBlock);
  assert.equal(Object.isFrozen(normalized.answerBlocks[0]), true);
  assert.equal(Object.isFrozen(normalized.answerBlocks[0].sourceIds), true);

  const invalidBlocks = [
    { ...validBlock, extra: true },
    (({ passageLocale, ...missingLocale }) => missingLocale)(validBlock),
    { ...validBlock, text: `${validBlock.text} changed` },
    { ...validBlock, passageLocale: "fr" },
    { ...validBlock, prefix: validBlock.prefix.replace("@example", "@other") },
    { ...validBlock, passage: "Text that is not in the linked X item." },
    { ...validBlock, sourceIds: [] },
    { ...validBlock, sourceIds: [vietnamesePost.id, vietnamesePost.id] },
  ];
  for (const invalidBlock of invalidBlocks) {
    assert.throws(
      () =>
        normalizeXNhanResponse(
          response({
            posts: [vietnamesePost],
            answerLocale: "vi",
            answer: invalidBlock.text,
            answerBlocks: [invalidBlock],
          }),
        ),
      TypeError,
    );
  }
});

test("keeps literal retrieval text identical across response, UI copy, and WebMCP source state", async () => {
  const literal =
    '<img src=x onerror="globalThis.compromised=true"><script>unsafe()</script>';
  const literalPost = post({ text: literal });
  const block = answerBlock(literalPost, 0, {
    passageLocale: null,
  });
  const normalized = normalizeXNhanResponse(
    response({ posts: [literalPost], answer: block.text, answerBlocks: [block] }),
  );
  const [answerSource, turnSource, snapshotSource] = await Promise.all([
    source("src/XNhanAnswer.jsx"),
    source("src/XNhanTurn.jsx"),
    source("src/xnhan-webmcp-snapshot.js"),
  ]);

  assert.equal(normalized.answerBlocks[0].passage, literal);
  assert.equal(normalized.posts[0].text, literal);
  assert.equal(
    normalized.answerBlocks.map(({ text }) => text).join("\n\n"),
    normalized.answer,
  );
  assert.match(answerSource, /\{block\.passage\}/u);
  assert.doesNotMatch(answerSource, /dangerouslySetInnerHTML|innerHTML/u);
  assert.match(
    turnSource,
    /visibleAnswerText = response\.answer \?\? ""[\s\S]*?formatXNhanAnswerForClipboard/u,
  );
  assert.match(answerSource, /xnhan-natural-answer/u);
  assert.match(snapshotSource, /text:\s*post\.text/u);
});

test("copies only the sources that support the whole X Nhân answer", () => {
  const first = post({
    id: "1234567890123456789",
    url: "https://x.com/example_user/status/1234567890123456789",
  });
  const second = post({
    id: "2234567890123456789",
    url: "https://x.com/other_user/status/2234567890123456789",
    author: { handle: "other_user", displayName: "Other User" },
  });
  const value = {
    answer: "A grounded summary.",
    answerSourceIds: [second.id],
    posts: [first, second],
  };

  assert.deepEqual(supportingAnswerSources(value), [second]);
  assert.equal(
    formatXNhanAnswerForClipboard(value, "Sources supporting the summary"),
    [
      "A grounded summary.",
      "Sources supporting the summary",
      `[1] @other_user — ${second.url}`,
    ].join("\n\n"),
  );
  assert.doesNotMatch(
    formatXNhanAnswerForClipboard(value, "Sources supporting the summary"),
    new RegExp(first.url.replaceAll("/", "\\/"), "u"),
  );
});

test("keeps the X Nhân locale explicit in product links and history state", () => {
  assert.equal(readExplicitXNhanLocale("?lang=vi"), "vi");
  assert.equal(readExplicitXNhanLocale("?lang=fr"), null);
  assert.equal(
    readInitialXNhanLocale({
      search: "?lang=vi",
      storage: { getItem: () => { throw new Error("blocked"); } },
    }),
    "vi",
  );
  assert.equal(
    readInitialXNhanLocale({
      search: "",
      storage: { getItem: () => "vi" },
    }),
    "vi",
  );
  assert.equal(xNhanHref("/xnhan", "vi"), "/xnhan?lang=vi");
  assert.equal(xNhanHref("/xnhan/about", "en"), "/xnhan/about?lang=en");

  let replacedUrl = null;
  assert.equal(
    replaceXNhanLocaleInUrl("vi", {
      historyObject: {
        replaceState: (_state, _title, url) => { replacedUrl = url; },
      },
      locationObject: {
        href: "https://tranthiennhan.com/xnhan/about?lang=en#boundary",
      },
    }),
    true,
  );
  assert.equal(replacedUrl, "/xnhan/about?lang=vi#boundary");

  const previousWindowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "window",
  );
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { search: "?lang=vi" },
      get localStorage() {
        const error = new Error("blocked");
        error.name = "SecurityError";
        throw error;
      },
    },
  });
  try {
    assert.equal(readInitialXNhanLocale(), "vi");
    assert.equal(readInitialXNhanLocale({ search: "" }), "en");
    assert.equal(writeStoredXNhanLocale("vi"), false);
  } finally {
    if (previousWindowDescriptor) {
      Object.defineProperty(globalThis, "window", previousWindowDescriptor);
    } else {
      delete globalThis.window;
    }
  }
});

test("uses the answer locale for result semantics while preserving a separately detected passage locale", async () => {
  const [answerSource, turnSource] = await Promise.all([
    source("src/XNhanAnswer.jsx"),
    source("src/XNhanTurn.jsx"),
  ]);

  assert.match(answerSource, /<span lang=\{answerLocale\}>\{block\.prefix\}<\/span>/u);
  assert.match(
    answerSource,
    /<bdi dir="auto" lang=\{block\.passageLocale \?\? undefined\}>[\s\S]*?\{block\.passage\}[\s\S]*?<\/bdi>/u,
  );
  assert.match(
    answerSource,
    /className="xnhan-citation-chip"[\s\S]*?aria-label=\{copy\.results\.openCitationSource\(sourceIndex, handle\)\}/u,
  );
  assert.match(turnSource, /const answerCopy = xnhanContent\[answerLocale\]/u);
  assert.match(
    turnSource,
    /id=\{`xnhan-answer-title-\$\{response\.requestId\}`\}[\s\S]*?lang=\{answerLocale\}[\s\S]*?\{answerCopy\.results\.answerTitle\}/u,
  );
  assert.match(turnSource, /<XNhanAnswer[\s\S]*?response=\{response\}/u);
  assert.doesNotMatch(turnSource, /className="xnhan-answer-sources"/u);
});

test("canonicalizes model citation order to the visible source catalog", () => {
  const posts = [1, 2, 3].map((index) =>
    post({
      id: `${index}234567890`,
      url: `https://x.com/example${index}/status/${index}234567890`,
      author: { handle: `example${index}`, displayName: `Example ${index}` },
      text: `Source ${index} supports the summary.`,
    }),
  );
  const answerBlocks = posts.map((sourcePost, index) =>
    answerBlock(sourcePost, index),
  );
  const normalized = normalizeXNhanResponse(
    response({
      posts,
      answerBlocks,
      answer: "A concise synthesis supported by the selected posts.",
      answerSourceIds: [posts[2].id, posts[0].id],
    }),
  );
  assert.deepEqual(normalized.answerSourceIds, [posts[0].id, posts[2].id]);
});

test("normalizes legacy numeric citation markers before rendering natural answers", () => {
  const sourcePost = post({ text: "The source supports the summary." });
  const normalized = normalizeXNhanResponse(
    response({
      posts: [sourcePost],
      answer: "A concise synthesis [2].",
      answerBlocks: [answerBlock(sourcePost)],
      answerSourceIds: [sourcePost.id],
    }),
  );
  assert.equal(normalized.answer, "A concise synthesis.");
});

test("keeps error and cancelled turn prose in the question language across opposite page locales", async () => {
  const [sessionSource, turnSource] = await Promise.all([
    source("src/use-xnhan-search-session.js"),
    source("src/XNhanTurn.jsx"),
  ]);

  const oppositeLocaleCases = [
    { answerLocale: "en", pageLocale: "vi" },
    { answerLocale: "vi", pageLocale: "en" },
  ];
  for (const { answerLocale, pageLocale } of oppositeLocaleCases) {
    const answerCopy = xnhanContent[answerLocale];
    const pageCopy = xnhanContent[pageLocale];
    const localizedGenericError = `${answerCopy.errors.generic.openrouter} ${answerCopy.errors.noFallback(answerCopy.providers.openrouter.name)}`;

    assert.notEqual(answerCopy.status.error, pageCopy.status.error);
    assert.notEqual(answerCopy.progress.cancelledTitle, pageCopy.progress.cancelledTitle);
    assert.notEqual(answerCopy.progress.cancelledText, pageCopy.progress.cancelledText);
    assert.notEqual(answerCopy.form.retry, pageCopy.form.retry);
    assert.notEqual(
      localizedGenericError,
      `${pageCopy.errors.generic.openrouter} ${pageCopy.errors.noFallback(pageCopy.providers.openrouter.name)}`,
    );
  }

  assert.match(
    sessionSource,
    /localizedError\(\s*boundedError,\s*xnhanContent\[turnAnswerLocale\],\s*turnProvider,?\s*\)/u,
  );
  assert.match(turnSource, /const turnCopy = xnhanContent\[turn\.answerLocale\]/u);
  assert.match(
    turnSource,
    /className="xnhan-cancelled-state" lang=\{turn\.answerLocale\}[\s\S]*?turnCopy\.progress\.cancelledTitle[\s\S]*?copy=\{turnCopy\}[\s\S]*?turnCopy\.progress\.cancelledText[\s\S]*?turnCopy\.form\.retry/u,
  );
  assert.match(
    turnSource,
    /className="xnhan-error-state"[\s\S]*?lang=\{turn\.answerLocale\}[\s\S]*?role="alert"[\s\S]*?turnCopy\.status\.error[\s\S]*?copy=\{turnCopy\}[\s\S]*?\{turn\.error\}[\s\S]*?turnCopy\.form\.retry/u,
  );
});

test("renders retrieval-only as an explicit no-selection state without a copy payload", () => {
  const normalized = normalizeXNhanResponse(
    response({ mode: "retrieval_only", answer: null, answerBlocks: [] }),
  );

  assert.equal(normalized.mode, "retrieval_only");
  assert.equal(normalized.answer, null);
  assert.deepEqual(normalized.answerBlocks, []);
  assert.equal(
    xnhanContent.en.results.answerUnavailable,
    "X Nhân could not select a relevant retrieved passage for this search. The retrieved items are listed below.",
  );
  assert.equal(
    xnhanContent.vi.results.answerUnavailable,
    "X Nhân không chọn được nội dung truy xuất phù hợp cho lượt này. Các mục đã truy xuất được liệt kê bên dưới.",
  );
});

test("parses bounded live activity and only canonical consulted X post links", async () => {
  const activity = normalizeXNhanActivity({
    sequence: 1,
    phase: "discovery",
    kind: "tool",
    status: "completed",
    tool: "web_search",
    queries: ["Workers AI site:x.com"],
  });
  const source = normalizeXNhanConsultedSource({
    handle: "example",
    id: "1234567890",
    url: "https://x.com/example/status/1234567890",
  });
  assert.equal(activity.tool, "web_search");
  assert.equal(source.handle, "example");
  assert.throws(
    () => normalizeXNhanActivity({ ...activity, privateThought: "hidden" }),
    TypeError,
  );
  assert.throws(
    () =>
      normalizeXNhanConsultedSource({
        ...source,
        url: "https://x.com/example/status/1234567890?tracking=1",
      }),
    TypeError,
  );

  const requestId = "6dcf1e38-4c5f-4f0b-b1b4-23e327726d1f";
  const frames = [
    sseFrame("accepted", {
      requestId,
      provider: "openrouter",
      model: "research-lab/Model.family+fast:beta",
      modelDisplayName: "X Nhân Nghiên cứu",
    }),
    ": keep-alive\n\n",
    sseFrame("activity", activity),
    ": keep-alive\n\n",
    sseFrame("source", source),
    sseFrame("result", { requestId }),
    sseFrame("done", { requestId }),
  ];
  const observed = [];
  await readXNhanEventStream(
    eventStreamResponse(frames),
    (eventName, payload) => observed.push([eventName, payload]),
  );
  assert.deepEqual(
    observed.map(([eventName]) => eventName),
    ["accepted", "activity", "source", "result", "done"],
  );
});

test("requires one exact terminal SSE sequence and rejects every frame after done", async () => {
  const requestId = "6dcf1e38-4c5f-4f0b-b1b4-23e327726d1f";
  const accepted = sseFrame("accepted", {
    requestId,
    provider: "openai",
    model: "gpt-5.6-luna",
    modelDisplayName: "X Nhân OpenAI",
  });
  const activity = sseFrame("activity", {
    sequence: 1,
    phase: "discovery",
    kind: "phase",
    status: "started",
  });
  const source = sseFrame("source", {
    handle: "example",
    id: "1234567890",
    url: "https://x.com/example/status/1234567890",
  });
  const result = sseFrame("result", { requestId });
  const providerError = sseFrame("error", {
    requestId,
    error: "search_temporarily_unavailable",
  });
  const done = sseFrame("done", { requestId });

  await readXNhanEventStream(
    eventStreamResponse([accepted, providerError, done]),
    () => {},
  );
  const chunkedWire = `${accepted}${activity}${source}${result}${done}`;
  const chunkedObserved = [];
  await readXNhanEventStream(
    eventStreamResponse(chunkedWire.match(/[\s\S]{1,7}/gu)),
    (eventName) => chunkedObserved.push(eventName),
  );
  assert.deepEqual(chunkedObserved, [
    "accepted",
    "activity",
    "source",
    "result",
    "done",
  ]);

  const invalidSequences = [
    [activity, accepted, result, done],
    [accepted, accepted, result, done],
    [accepted, source, result, done],
    [accepted, done],
    [accepted, result, activity, done],
    [accepted, result, result, done],
    [accepted, providerError, result, done],
    [accepted, result],
    [accepted, result, done, done],
    [accepted, result, done, activity],
    [accepted, result, done, 'data: {"unexpected":true}\n\n'],
    `${accepted}${result}${done}${activity}`.match(/[\s\S]{1,5}/gu),
  ];
  for (const frames of invalidSequences) {
    const observed = [];
    await assert.rejects(
      readXNhanEventStream(
        eventStreamResponse(frames),
        (eventName) => observed.push(eventName),
      ),
      (error) => error instanceof TypeError && error.code === "invalidResponse",
    );
    if (observed.includes("done")) {
      assert.equal(observed.at(-1), "done");
    }
  }
});

test("executes the X Nhân SSE transport with an exact request and bounded event callbacks", async () => {
  const query = "What is being discussed?";
  const answerLocale = "en";
  const provider = "openrouter";
  const history = Object.freeze([
    Object.freeze({ user: "Earlier question", assistant: "Earlier answer" }),
  ]);
  const requestId = "6dcf1e38-4c5f-4f0b-b1b4-23e327726d1f";
  const retrieval = {
    ...response().retrieval,
    provider,
    model: "research-lab/Model.family+fast:beta",
    modelDisplayName: "X Nhân Nghiên cứu",
  };
  const result = response({ retrieval });
  const activity = {
    sequence: 1,
    phase: "discovery",
    kind: "tool",
    status: "completed",
    tool: "web_search",
    queries: ["Workers AI site:x.com"],
  };
  const consultedSource = {
    handle: "example",
    id: "1234567890",
    url: "https://x.com/example/status/1234567890",
  };
  const controller = new AbortController();
  const observedEvents = [];
  let observedRequest = null;

  const normalized = await executeXNhanSearchRequest({
    answerLocale,
    fetchImpl: async (url, options) => {
      observedRequest = { url, options };
      return eventStreamResponse([
        sseFrame("accepted", {
          requestId,
          provider,
          model: retrieval.model,
          modelDisplayName: retrieval.modelDisplayName,
        }),
        sseFrame("activity", activity),
        sseFrame("source", consultedSource),
        sseFrame("result", result),
        sseFrame("done", { requestId }),
      ]);
    },
    history,
    onAccepted: (accepted) => observedEvents.push(["accepted", accepted]),
    onActivity: (nextActivity) =>
      observedEvents.push(["activity", nextActivity]),
    onSource: (nextSource) => observedEvents.push(["source", nextSource]),
    provider,
    query,
    signal: controller.signal,
  });

  assert.equal(observedRequest.url, "/api/xnhan/search");
  assert.equal(observedRequest.options.method, "POST");
  assert.deepEqual(observedRequest.options.headers, {
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  });
  assert.equal(observedRequest.options.credentials, "same-origin");
  assert.equal(observedRequest.options.signal, controller.signal);
  assert.deepEqual(JSON.parse(observedRequest.options.body), {
    locale: answerLocale,
    query,
    provider,
    history,
  });
  assert.deepEqual(
    observedEvents.map(([eventName]) => eventName),
    ["accepted", "activity", "source"],
  );
  assert.equal(Object.isFrozen(observedEvents[0][1]), true);
  assert.equal(Object.isFrozen(observedEvents[1][1]), true);
  assert.equal(Object.isFrozen(observedEvents[2][1]), true);
  assert.equal(normalized.requestId, requestId);
  assert.equal(normalized.retrieval.provider, provider);
  assert.equal(normalized.retrieval.model, retrieval.model);
  assert.equal(normalized.retrieval.modelDisplayName, retrieval.modelDisplayName);
});

test("normalizes JSON search responses without manufacturing stream activity", async () => {
  let callbackCount = 0;
  const normalized = await executeXNhanSearchRequest({
    answerLocale: "en",
    fetchImpl: async () =>
      new Response(JSON.stringify(response()), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }),
    history: [],
    onAccepted: () => {
      callbackCount += 1;
    },
    onActivity: () => {
      callbackCount += 1;
    },
    onSource: () => {
      callbackCount += 1;
    },
    provider: "openai",
    query: "What is being discussed?",
    signal: new AbortController().signal,
  });

  assert.equal(normalized.requestId, response().requestId);
  assert.equal(normalized.retrieval.provider, "openai");
  assert.equal(callbackCount, 0);
});

test("fails closed on search transport errors and exact-result provenance mismatches", async () => {
  const baseRequest = {
    answerLocale: "en",
    history: [],
    provider: "openai",
    query: "What is being discussed?",
    signal: new AbortController().signal,
  };
  const cases = [
    {
      expectedCode: "rateLimited",
      response: new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 503,
      }),
    },
    {
      expectedCode: "rateLimited",
      response: new Response("not-json", { status: 429 }),
    },
    {
      expectedCode: "generic",
      response: new Response("not-json", { status: 502 }),
    },
    {
      expectedCode: "invalidResponse",
      response: new Response(
        JSON.stringify(response({ query: "A different query" })),
        { headers: { "Content-Type": "application/json" } },
      ),
    },
    {
      expectedCode: "invalidResponse",
      response: eventStreamResponse([
        sseFrame("accepted", {
          requestId: response().requestId,
          provider: "openrouter",
          model: "research-lab/Model.family+fast:beta",
          modelDisplayName: "X Nhân Nghiên cứu",
        }),
        sseFrame("result", response()),
        sseFrame("done", { requestId: response().requestId }),
      ]),
    },
  ];

  for (const testCase of cases) {
    await assert.rejects(
      executeXNhanSearchRequest({
        ...baseRequest,
        fetchImpl: async () => testCase.response,
      }),
      (error) => error?.code === testCase.expectedCode,
    );
  }
});

test("passes the request AbortSignal through without converting cancellation into an error code", async () => {
  const controller = new AbortController();
  let observedSignal = null;
  const pending = executeXNhanSearchRequest({
    answerLocale: "en",
    fetchImpl: async (_url, { signal }) => {
      observedSignal = signal;
      return await new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted by test");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });
    },
    history: [],
    provider: "openai",
    query: "What is being discussed?",
    signal: controller.signal,
  });

  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(observedSignal, controller.signal);

  const bodyAbort = new Error("response body aborted by test");
  bodyAbort.name = "AbortError";
  await assert.rejects(
    executeXNhanSearchRequest({
      answerLocale: "en",
      fetchImpl: async () => ({
        ok: true,
        headers: new Headers({ "Content-Type": "application/json" }),
        async json() {
          throw bodyAbort;
        },
      }),
      history: [],
      provider: "openai",
      query: "What is being discussed?",
      signal: new AbortController().signal,
    }),
    (error) => error === bodyAbort && error.code === undefined,
  );
});

test("prevents a reset request from clearing or replacing a newer search generation", () => {
  const oldRequest = new AbortController();
  const newRequest = new AbortController();
  const state = {
    activeRequest: oldRequest,
    mounted: true,
    pendingCompletion: "old-pending",
    revision: 0,
    status: "searching-old",
  };
  const publish = (request, completion) => {
    if (
      !isCurrentXNhanSearchRequest(
        state.activeRequest,
        request,
        state.mounted,
      )
    ) {
      return false;
    }
    state.pendingCompletion = completion;
    state.revision += 1;
    state.status = `complete-${completion}`;
    return true;
  };
  const reject = (request) => {
    if (
      !isCurrentXNhanSearchRequest(
        state.activeRequest,
        request,
        state.mounted,
      )
    ) {
      return false;
    }
    state.pendingCompletion = null;
    state.status = "error";
    return true;
  };

  oldRequest.abort();
  state.activeRequest = null;
  state.pendingCompletion = null;
  state.status = "idle";
  assert.equal(publish(oldRequest, "stale-after-reset"), false);
  assert.equal(reject(oldRequest), false);

  state.activeRequest = newRequest;
  state.pendingCompletion = "new-pending";
  state.status = "searching-new";
  assert.equal(reject(oldRequest), false);
  assert.equal(publish(oldRequest, "stale-after-new-search"), false);
  assert.deepEqual(state, {
    activeRequest: newRequest,
    mounted: true,
    pendingCompletion: "new-pending",
    revision: 0,
    status: "searching-new",
  });
  assert.equal(publish(newRequest, "new-result"), true);
  assert.equal(state.pendingCompletion, "new-result");
  assert.equal(state.revision, 1);
  assert.equal(state.status, "complete-new-result");

  state.mounted = false;
  assert.equal(publish(newRequest, "after-unmount"), false);
  assert.equal(reject(newRequest), false);
  assert.equal(state.pendingCompletion, "new-result");
  assert.equal(state.revision, 1);
});

test("times out only the request that still owns the session at exactly 810 seconds", () => {
  const oldRequest = new AbortController();
  const newRequest = new AbortController();
  let activeRequest = oldRequest;
  let scheduled = null;
  let timeoutCount = 0;
  const scheduleTimeout = (callback, delay) => {
    scheduled = { callback, delay };
    return "fake-timeout-id";
  };

  const oldTimeoutId = scheduleXNhanSearchTimeout({
    controller: oldRequest,
    getActiveRequest: () => activeRequest,
    onTimeout: () => {
      timeoutCount += 1;
    },
    scheduleTimeout,
  });
  assert.equal(oldTimeoutId, "fake-timeout-id");
  assert.equal(scheduled.delay, XNHAN_REQUEST_TIMEOUT_MS);
  assert.equal(scheduled.delay, 810_000);

  activeRequest = newRequest;
  scheduled.callback();
  assert.equal(oldRequest.signal.aborted, false);
  assert.equal(timeoutCount, 0);

  const callerCancelledRequest = new AbortController();
  activeRequest = callerCancelledRequest;
  scheduleXNhanSearchTimeout({
    controller: callerCancelledRequest,
    getActiveRequest: () => activeRequest,
    onTimeout: () => {
      timeoutCount += 1;
    },
    scheduleTimeout,
  });
  callerCancelledRequest.abort();
  scheduled.callback();
  assert.equal(timeoutCount, 0);

  activeRequest = newRequest;
  scheduleXNhanSearchTimeout({
    controller: newRequest,
    getActiveRequest: () => activeRequest,
    onTimeout: () => {
      timeoutCount += 1;
    },
    scheduleTimeout,
  });
  scheduled.callback();
  assert.equal(newRequest.signal.aborted, true);
  assert.equal(timeoutCount, 1);
});

test("maps only intentional aborts to cancellation and never leaves an unexpected abort loading", () => {
  const unexpectedAbort = new Error("unexpected transport abort");
  unexpectedAbort.name = "AbortError";
  assert.equal(
    classifyXNhanSearchFailure({
      callerSignal: new AbortController().signal,
      error: unexpectedAbort,
      requestSignal: new AbortController().signal,
      requestTimedOut: false,
      userCancelled: false,
    }),
    "error",
  );

  const stoppedRequest = new AbortController();
  stoppedRequest.abort();
  assert.equal(
    classifyXNhanSearchFailure({
      error: new Error("transport ignored stop before rejecting"),
      requestSignal: stoppedRequest.signal,
      requestTimedOut: false,
      userCancelled: true,
    }),
    "cancelled",
  );

  const caller = new AbortController();
  const callerRequest = new AbortController();
  caller.abort();
  callerRequest.abort();
  assert.equal(
    classifyXNhanSearchFailure({
      callerSignal: caller.signal,
      error: new Error("transport ignored caller abort before rejecting"),
      requestSignal: callerRequest.signal,
      requestTimedOut: false,
      userCancelled: false,
    }),
    "cancelled",
  );

  assert.equal(
    classifyXNhanSearchFailure({
      callerSignal: caller.signal,
      error: unexpectedAbort,
      requestSignal: stoppedRequest.signal,
      requestTimedOut: true,
      userCancelled: true,
    }),
    "timeout",
  );
  assert.equal(
    classifyXNhanSearchFailure({
      error: new Error("network unavailable"),
      requestSignal: new AbortController().signal,
      requestTimedOut: false,
      userCancelled: false,
    }),
    "error",
  );
});

test("keeps completed activity collapsible and removes presentation-only summary markup", async () => {
  const [component, turn] = await Promise.all([
    source("src/XNhanActivity.jsx"),
    source("src/XNhanTurn.jsx"),
  ]);
  assert.match(component, /<details/u);
  assert.match(component, /stableDisclosureRef = disclosureRef \?\? localDisclosureRef/u);
  assert.match(component, /saved\.userToggled \? saved\.expanded : live/u);
  assert.match(component, /stableDisclosureRef\.current = \{\s*expanded: nextExpanded,\s*userToggled: true/u);
  assert.match(component, /aria-live="off"/u);
  assert.match(
    turn,
    /const activityDisclosureRef = useRef\(\{\s*expanded: true,\s*userToggled: false/u,
  );
  assert.equal(
    (turn.match(/activityDisclosureRef=\{activityDisclosureRef\}/gu) ?? []).length,
    2,
    "loading and completed activity must share the stable turn-owned disclosure state",
  );
  assert.match(
    component,
    /activity\.status === "unavailable"[\s\S]*?copy\.webSearchUnavailable/u,
  );
  assert.match(component, /const showSources = !live && sources\.length > 0/u);
  assert.match(component, /activities\.length === 0 && !showSources/u);
  assert.match(component, /\{showSources \? \(/u);
  assert.equal(
    stripActivitySummaryMarkup("**Clarifying JSON Requirements** Use `strict` JSON."),
    "Clarifying JSON Requirements Use strict JSON.",
  );
  assert.equal(
    normalizeXNhanActivity({
      sequence: 1,
      phase: "synthesis",
      kind: "reasoning",
      status: "completed",
      summary: "## **Grounded synthesis**",
    }).summary,
    "Grounded synthesis",
  );
});

test("keeps exactly three fixed bilingual starter prompts with no trend runtime", async () => {
  const [app, contentSource, styles] = await Promise.all([
    source("src/XNhanApp.jsx"),
    source("src/xnhan-content.js"),
    source("src/xnhan.css"),
  ]);
  assert.deepEqual(xnhanContent.vi.suggestions, [
    "Các nhà phát triển đang nói gì về coding agent trong tuần này?",
    "OpenAI, Anthropic và Google đang được so sánh ra sao về mô hình suy luận?",
    "Theo dõi @OpenAI: những thông báo nào đang tạo nhiều thảo luận nhất?",
  ]);
  assert.deepEqual(xnhanContent.en.suggestions, [
    "What are developers saying about coding agents this week?",
    "How are OpenAI, Anthropic, and Google being compared on reasoning models?",
    "Track @OpenAI: which announcements are generating the most discussion?",
  ]);
  assert.equal(xnhanContent.vi.suggestions.length, 3);
  assert.equal(xnhanContent.en.suggestions.length, 3);
  assert.match(app, /const suggestions = copy\.suggestions/u);
  assert.doesNotMatch(`${app}\n${contentSource}`, /useXNhanTrends|trendSnapshot|xnhan\/trends|trends:\s*Object\.freeze/iu);
  assert.match(app, /key=\{`xnhan-suggestion-\$\{index \+ 1\}`\}/u);
  assert.match(app, /className="xnhan-suggestion-copy"/u);
  assert.match(styles, /@keyframes xnhan-suggestion-refresh/u);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.xnhan-suggestion-copy[\s\S]*?animation:\s*none/u,
  );
});

test("keeps X Nhân orchestration separate from turn presentation", async () => {
  const [app, turn, shellStyles, turnStyles] = await Promise.all([
    source("src/XNhanApp.jsx"),
    source("src/XNhanTurn.jsx"),
    source("src/xnhan.css"),
    source("src/xnhan-turn.css"),
  ]);

  assert.ok(app.split(/\r?\n/u).length < 1_000);
  assert.ok(turn.split(/\r?\n/u).length < 500);
  assert.ok(shellStyles.split(/\r?\n/u).length < 1_000);
  assert.ok(turnStyles.split(/\r?\n/u).length < 1_000);
  assert.match(app, /from "\.\/XNhanTurn\.jsx"/u);
  assert.match(app, /<XNhanTurn/u);
  assert.doesNotMatch(app, /function XPostCard|navigator\.clipboard|turn\.phase ===/u);
  assert.match(turn, /import "\.\/xnhan-turn\.css"/u);
  assert.match(turn, /export function ResearchProgress/u);
  assert.match(turn, /export function XNhanResults/u);
  assert.match(turn, /export function XNhanTurn/u);
  assert.doesNotMatch(turn, /fetch\(|loadTurnstile|useXNhanWebMcp/u);
  assert.doesNotMatch(
    shellStyles,
    /\.xnhan-(?:chat-turn|loading-state|answer-text|source-card|progress-track)/u,
  );
  assert.match(turnStyles, /\.xnhan-chat-turn/u);
  assert.match(turnStyles, /\.xnhan-source-card/u);
});

test("makes long research interruptible without inventing persistence or provider cancellation", async () => {
  const [app, session, sessionState, autosize, turn, activity, styles, turnStyles] = await Promise.all([
    source("src/XNhanApp.jsx"),
    source("src/use-xnhan-search-session.js"),
    source("src/xnhan-session-state.js"),
    source("src/use-autosize-textarea.js"),
    source("src/XNhanTurn.jsx"),
    source("src/XNhanActivity.jsx"),
    source("src/xnhan.css"),
    source("src/xnhan-turn.css"),
  ]);
  const ui = `${app}\n${turn}\n${activity}`;

  assert.match(sessionState, /startedAt:\s*now\(\)/u);
  assert.match(turn, /function ResearchProgress\(/u);
  assert.match(turn, /window\.setInterval\([\s\S]*?1_000/u);
  assert.match(
    autosize,
    /const observer = new ResizeObserverClass\(onResize\)[\s\S]*?observer\.observe\(input\.parentElement \?\? input\)[\s\S]*?observer\.disconnect\(\)/u,
  );
  assert.match(
    turn,
    /className="xnhan-progress-track"[\s\S]*?role="progressbar"[\s\S]*?aria-label=\{copy\.progress\.label\}/u,
  );
  assert.match(
    session,
    /const stopSearch = useCallback\([\s\S]*?userCancelledRequestRef\.current = controller;[\s\S]*?controller\.abort\(\)/u,
  );
  assert.match(app, /const handleStopSearch = \(\) => \{\s*void stopSearch\(\)/u);
  assert.match(session, /userCancelledRequestRef\.current === controller/u);
  assert.match(sessionState, /phase: "cancelled"/u);
  assert.match(turn, /turnCopy\.progress\.cancelledText/u);
  assert.doesNotMatch(
    ui,
    /xnhan-title-intro|xnhan-initial-icon|xnhan-principles|copy\.capabilities|copy\.eyebrow|xnhan-composer-scope|copy\.form\.(?:scope|independent)/u,
  );
  assert.doesNotMatch(
    ui,
    /xnhan-product-link|xnhan-brand-mark|xnhan-product-copy|copy\.productDescriptor/u,
  );
  assert.doesNotMatch(
    `${xnhanContent.vi.initialTitle} ${xnhanContent.en.initialTitle} ${xnhanContent.vi.form.hint} ${xnhanContent.en.form.hint}`,
    /Tìm kiếm có nguồn trên X|Source-backed search on X|Tìm trên X công khai|Search public X|Mỗi lượt độc lập|Independent turns/u,
  );
  assert.match(turn, /formatXNhanAnswerForClipboard/u);
  assert.doesNotMatch(turn, /copy\.results\.independentTurn/u);
  assert.match(
    turn,
    /<details[\s\S]*?className="xnhan-sources"[\s\S]*?className="xnhan-sources-panel"[\s\S]*?copy\.results\.coverageNote/u,
  );
  assert.doesNotMatch(app, /xnhan-privacy|copy\.privacy(?:Summary)?/u);
  assert.doesNotMatch(activity, /xnhan-activity-boundary|copy\.boundary/u);

  const localeStart = app.indexOf("const changeLocale = useCallback");
  const localeEnd = app.indexOf("const activeResultTurn", localeStart);
  assert.notEqual(localeStart, -1);
  assert.notEqual(localeEnd, -1);
  const localeSource = app.slice(localeStart, localeEnd);
  assert.match(localeSource, /isSearchInFlight\(\)/u);
  assert.match(localeSource, /setLocale\(nextLocale\)/u);
  assert.doesNotMatch(localeSource, /setTurns|setQuery|\.abort\(/u);
  assert.match(
    app,
    /aria-pressed=\{locale === item\}[\s\S]*?disabled=\{busy\}[\s\S]*?changeLocale\(item\)/u,
  );

  assert.match(styles, /--xnhan-control-height:\s*2\.75rem/u);
  assert.doesNotMatch(
    styles,
    /\.xnhan-(?:product-link|product-copy|brand-mark)/u,
  );
  assert.doesNotMatch(
    styles,
    /\.xnhan-suggestions button\s*\{[^}]*transition:[^}]*padding/u,
  );
  assert.doesNotMatch(styles, /xnhan-turnstile/u);
  assert.doesNotMatch(
    styles,
    /\.xnhan-locale-switch button\s*\{[^}]*(?:min-width|min-height):\s*2\.35rem/u,
  );
  assert.match(turnStyles, /@keyframes xnhan-progress[\s\S]*?transform:\s*translateX/u);
  assert.match(styles, /@keyframes xnhan-enter[\s\S]*?transform:\s*translateY/u);
  assert.doesNotMatch(
    styles,
    /@keyframes xnhan-enter\s*\{\s*from\s*\{[^}]*opacity:/u,
  );
  assert.match(
    turnStyles,
    /\.xnhan-source-card\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?border:\s*0;[\s\S]*?border-bottom:/u,
  );
  assert.match(
    turnStyles,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.xnhan-progress-track > span[\s\S]*?animation:\s*none/u,
  );
});

test("shares the owner portrait across X Nhân brand and assistant marks", async () => {
  const [app, about, turn, logo, baseStyles, styles, aboutStyles, turnStyles] = await Promise.all([
    source("src/XNhanApp.jsx"),
    source("src/XNhanAboutApp.jsx"),
    source("src/XNhanTurn.jsx"),
    source("src/XNhanLogo.jsx"),
    source("src/base.css"),
    source("src/xnhan.css"),
    source("src/xnhan-about.css"),
    source("src/xnhan-turn.css"),
  ]);

  for (const routeSource of [app, about]) {
    assert.match(routeSource, /import \{ XNhanLogo \} from "\.\/XNhanLogo\.jsx"/u);
    assert.equal(routeSource.match(/<XNhanLogo \/>/gu)?.length, 1);
  }
  assert.match(logo, /portrait-icon-20d683e7-192\.png/u);
  assert.match(logo, /portrait-icon-20d683e7-32\.png/u);
  assert.match(logo, /className=\{className\}[\s\S]*?alt=""/u);
  assert.match(logo, /sizes="32px"/u);
  assert.match(logo, /width="192"[\s\S]*?height="192"/u);
  assert.match(logo, /className="xnhan-logo-name" aria-hidden="true"/u);
  assert.match(baseStyles, /\.xnhan-logo-avatar[\s\S]*?border-radius:\s*50%/u);
  assert.match(app, /className="xnhan-brand-lockup"[\s\S]*?role="img"[\s\S]*?aria-label="X Nhân"/u);
  assert.doesNotMatch(app, /className="xnhan-brand-lockup"[\s\S]{0,160}?href=/u);
  assert.match(styles, /\.xnhan-brand-lockup/u);
  assert.match(aboutStyles, /\.xnhan-about-back/u);
  assert.match(turn, /import \{ XNhanAvatar \} from "\.\/XNhanLogo\.jsx"/u);
  assert.match(turn, /function AssistantMark\(\)/u);
  assert.equal(turn.match(/<AssistantMark \/>/gu)?.length, 5);
  assert.doesNotMatch(turn, />\s*XN\s*</u);
  assert.match(
    turnStyles,
    /\.xnhan-loading-state,[\s\S]*?grid-template-columns:\s*2rem minmax\(0, 1fr\)/u,
  );
  assert.match(
    turnStyles,
    /\.xnhan-assistant-mark\s*\{[^}]*width:\s*2rem;[^}]*height:\s*2rem;/su,
  );
  assert.match(turnStyles, /\.xnhan-assistant-avatar[\s\S]*?object-fit:\s*cover/u);
});

test("wires OpenRouter-default search, a bounded chat transcript, collapsible sources, and route-scoped WebMCP", async () => {
  const [app, session, request, lifecycle, searchStatus, sessionState, snapshot, turn, answer, hook, styles, turnStyles, globalStyles] = await Promise.all([
    source("src/XNhanApp.jsx"),
    source("src/use-xnhan-search-session.js"),
    source("src/xnhan-search-request.js"),
    source("src/xnhan-search-lifecycle.js"),
    source("src/xnhan-search-status.js"),
    source("src/xnhan-session-state.js"),
    source("src/xnhan-webmcp-snapshot.js"),
    source("src/XNhanTurn.jsx"),
    source("src/XNhanAnswer.jsx"),
    source("src/use-xnhan-webmcp.js"),
    source("src/xnhan.css"),
    source("src/xnhan-turn.css"),
    source("src/styles.css"),
  ]);

  assert.match(session, /executeXNhanSearchRequest\(\{/u);
  assert.doesNotMatch(session, /fetch\(|readXNhanEventStream|normalizeXNhanActivity/u);
  assert.match(request, /fetchImpl\(XNHAN_SEARCH_ENDPOINT/u);
  assert.match(request, /Accept:\s*"text\/event-stream"/u);
  assert.match(request, /readXNhanEventStream\(response/u);
  assert.match(request, /normalizeXNhanActivity\(payload\)/u);
  assert.match(request, /normalizeXNhanConsultedSource\(payload\)/u);
  assert.match(
    request,
    /JSON\.stringify\(\{\s*locale: answerLocale,\s*query,\s*provider,\s*history,\s*\}\)/u,
  );
  assert.match(
    session,
    /Array\.isArray\(historySnapshot\)[\s\S]*?normalizeXNhanConversationHistory\(historySnapshot\)[\s\S]*?buildXNhanConversationHistory\(turnsRef\.current\)/u,
  );
  assert.match(sessionState, /requestHistory,\s*model:/u);
  assert.match(
    turn,
    /historySnapshot:\s*turn\.requestHistory[\s\S]*?provider:\s*turn\.provider/u,
  );
  assert.match(
    app,
    /className="xnhan-header-start"[\s\S]*?<button[\s\S]*?className="xnhan-new-chat"/u,
  );
  await assert.rejects(source("src/XNhanProviderPicker.jsx"), { code: "ENOENT" });
  assert.doesNotMatch(app, /XNhanProviderPicker|selectedProvider|changeProvider|setSelectedProvider/u);
  assert.doesNotMatch(styles, /xnhan-provider-picker|xnhan-provider-menu-enter/u);
  assert.doesNotMatch(`${app}\n${styles}`, /\/assets\/(?:openai|openrouter)\.jpg/u);
  assert.match(
    session,
    /provider:\s*requestedProvider = XNHAN_DEFAULT_PROVIDER/u,
  );
  assert.match(
    app,
    /startSearch\(suggestion, \{ provider: XNHAN_DEFAULT_PROVIDER \}\)/u,
  );
  assert.doesNotMatch(app, /PROVIDER_STORAGE|localStorage\.(?:getItem|setItem)\([^)]*provider/iu);
  assert.match(session, /buildXNhanConversationHistory\(turnsRef\.current\)/u);
  assert.match(
    app,
    /webMcpVisibleConversationHistory = useMemo\([\s\S]*?buildXNhanConversationHistory\(turns\)/u,
  );
  assert.match(
    app,
    /visibleConversationHistory: webMcpVisibleConversationHistory/u,
  );
  assert.match(
    hook,
    /contextMode === "standalone"[\s\S]*?visible_conversation[\s\S]*?visibleConversationHistory/u,
  );
  assert.match(
    hook,
    /captureXNhanSearchHistory\(contextMode\)[\s\S]*?resolveXNhanWebMcpHistory\(contextMode, snapshotRef\.current\)/u,
  );
  assert.match(
    hook,
    /async searchXPosts\(question, provider, historySnapshot[\s\S]*?search\(question, \{\s*provider,\s*historySnapshot,\s*signal,/u,
  );
  assert.match(session, /const commitTurns = useCallback/u);
  assert.match(session, /commitTurns\(\{ type: "reset" \}\)/u);
  assert.doesNotMatch(
    `${app}\n${session}`,
    /localStorage\.(?:getItem|setItem)\([^)]*(?:history|turns|query|answer)/iu,
  );
  assert.match(request, /normalizeXNhanAccepted\(payload\)/u);
  assert.match(
    request,
    /normalized\.retrieval\.provider !== accepted\.provider[\s\S]*?normalized\.retrieval\.model !== accepted\.model[\s\S]*?normalized\.retrieval\.modelDisplayName !==[\s\S]*?accepted\.modelDisplayName/u,
  );
  assert.match(
    turn,
    /onRetry\(turn\.submittedQuery, \{\s*answerLocale: turn\.answerLocale,\s*historySnapshot: turn\.requestHistory,\s*provider: turn\.provider,\s*\}\)/u,
  );
  assert.match(answer, /<span lang=\{answerLocale\}>\{block\.prefix\}<\/span>/u);
  assert.match(
    answer,
    /<bdi dir="auto" lang=\{block\.passageLocale \?\? undefined\}>[\s\S]*?\{block\.passage\}[\s\S]*?<\/bdi>/u,
  );
  assert.doesNotMatch(answer, /<div className="xnhan-answer-text" lang=/u);
  assert.match(turn, /className="xnhan-provider-snapshot"/u);
  assert.match(turn, /modelDisplayName=\{response\.retrieval\.modelDisplayName\}/u);
  assert.doesNotMatch(turn, /PROVIDER_LOGOS|<img\s/u);
  assert.doesNotMatch(turn, /providerName|providers\[provider\]|\$\{providerName\}\s*·/u);
  assert.doesNotMatch(turn, /model=\{response\.retrieval\.model\}/u);
  assert.doesNotMatch(app, /turnstile|verification_required|turnstile_verification_failed/iu);
  assert.doesNotMatch(turn, /turnstileReady/u);
  assert.match(app, /<main[^>]*id="xnhan-main"/u);
  assert.equal((app.match(/<h1\b/gu) ?? []).length, 1);
  assert.match(app, /role="log"[\s\S]*?aria-live="polite"/u);
  assert.match(app, /turns\.map\(\(turn\)/u);
  assert.match(
    session,
    /XNHAN_MAX_CHAT_TURNS = XNHAN_CONVERSATION_MAX_TURNS \+ 1/u,
  );
  assert.match(lifecycle, /XNHAN_REQUEST_TIMEOUT_MS = 810_000/u);
  assert.match(session, /setQuery\(""\)/u);
  assert.match(session, /const requestTimeoutId = scheduleXNhanSearchTimeout/u);
  assert.match(
    session,
    /getActiveRequest: \(\) => requestRef\.current[\s\S]*?requestTimedOut = true/u,
  );
  assert.match(session, /window\.clearTimeout\(requestTimeoutId\)/u);
  assert.ok(session.split(/\r?\n/u).length < 375);
  assert.ok(request.split(/\r?\n/u).length < 250);
  assert.ok(lifecycle.split(/\r?\n/u).length < 100);
  assert.doesNotMatch(session, /from "\.\/use-xnhan-webmcp\.js"/u);
  assert.match(session, /from "\.\/xnhan-search-status\.js"/u);
  assert.match(session, /from "\.\/xnhan-search-lifecycle\.js"/u);
  assert.match(lifecycle, /export function isCurrentXNhanSearchRequest/u);
  assert.match(lifecycle, /export function classifyXNhanSearchFailure/u);
  assert.match(lifecycle, /export function scheduleXNhanSearchTimeout/u);
  assert.doesNotMatch(lifecycle, /react|webmcp|fetch\(/iu);
  assert.match(
    session,
    /const ownsRequest = \(\) =>[\s\S]*?isCurrentXNhanSearchRequest\([\s\S]*?requestRef\.current,[\s\S]*?controller,[\s\S]*?mountedRef\.current/u,
  );
  assert.match(
    session,
    /if \(!ownsRequest\(\)\) return null;[\s\S]*?webMcpPendingCompletionRef\.current = normalized;[\s\S]*?catch \(error\) \{\s*if \(!ownsRequest\(\)\) return null;\s*webMcpPendingCompletionRef\.current = null/u,
  );
  assert.match(
    session,
    /classifyXNhanSearchFailure\(\{[\s\S]*?if \(failure === "cancelled"\)[\s\S]*?failure === "timeout"[\s\S]*?createXNhanSearchStatus\(\s*"error"[\s\S]*?type: "failed"[\s\S]*?inFlightRef\.current = false/u,
  );
  assert.doesNotMatch(
    session,
    /requestWasAborted\s*&&\s*!requestTimedOut\)\s*return null/u,
  );
  assert.match(searchStatus, /export function createXNhanSearchStatus/u);
  assert.doesNotMatch(searchStatus, /react|webmcp/iu);
  assert.match(session, /const mountedRef = useRef\(false\)/u);
  assert.match(
    session,
    /useLayoutEffect\(\(\) => \{\s*mountedRef\.current = true;\s*return \(\) => \{\s*mountedRef\.current = false;\s*requestRef\.current\?\.abort\(\)/u,
  );
  assert.match(
    session,
    /if \(!mountedRef\.current\) return false;[\s\S]*?if \(!ownsRequest\(\) \|\| controller\.signal\.aborted\)[\s\S]*?executeXNhanSearchRequest\(\{/u,
  );
  assert.match(
    session,
    /window\.requestAnimationFrame\(\(\) => \{\s*if \(mountedRef\.current\) inputRef\.current\?\.focus\(\);\s*\}\)/u,
  );
  assert.match(
    app,
    /useLayoutEffect\(\(\) => \{\s*const lifecycle = createXNhanWebMcpLifecycle\(\);[\s\S]*?return \(\) => \{\s*lifecycle\.close\(\);\s*webMcpBridgeCleanupRef\.current\?\.\(\)/u,
  );
  assert.match(
    app,
    /useLayoutEffect\(\(\) => \{\s*const lifecycle = webMcpBridgeLifecycleRef\.current;[\s\S]*?commitXNhanWebMcpBridge\(\{\s*lifecycle,[\s\S]*?snapshot: webMcpSnapshot,[\s\S]*?webMcpBridgeCleanupRef\.current = bridge\.cleanup/u,
  );
  assert.match(
    session,
    /webMcpSearchStatusRef\.current = createXNhanSearchStatus\(\s*"searching"[\s\S]*?inFlightRef\.current = true/u,
  );
  assert.match(
    session,
    /webMcpPendingCompletionRef\.current = normalized;[\s\S]*?commitTurns/u,
  );
  assert.match(
    app,
    /commitXNhanWebMcpBridge\(\{[\s\S]*?snapshot: webMcpSnapshot,[\s\S]*?publishCompletedXNhanWebMcpSearchStatus\([\s\S]*?webMcpSnapshot/u,
  );
  assert.match(hook, /import \{ useLayoutEffect \} from "react"/u);
  assert.match(hook, /export function createXNhanWebMcpLifecycle/u);
  assert.match(hook, /export function commitXNhanWebMcpBridge/u);
  assert.match(hook, /export function createXNhanWebMcpActions/u);
  assert.match(
    hook,
    /useLayoutEffect\(\(\) => \{[\s\S]*?const lifecycle = createXNhanWebMcpLifecycle\(\);[\s\S]*?return \(\) => \{\s*lifecycle\.close\(\);\s*registration\.cleanup\(\)/u,
  );
  assert.match(
    hook,
    /const result = await action\(\.\.\.args\);\s*lifecycle\.requireActive\(\)/u,
  );
  assert.match(hook, /const searchStatus = searchStatusRef\?\.current/u);
  assert.match(snapshot, /fields\.answerSourceIds = activeResponse\.answerSourceIds/u);
  assert.match(snapshot, /sourceIds: block\.sourceIds/u);
  assert.match(hook, /sameAnswerProvenance\(visibleResults, response\)/u);
  assert.match(hook, /async getCurrentXResultIndex/u);
  assert.match(hook, /async getXNhanSearchStatus/u);
  assert.doesNotMatch(app, /(?:locale|search|openPost|stopSearch|newChat)ActionRef\.current\s*=/u);
  assert.match(app, /scrollIntoView\(\{[\s\S]*?prefers-reduced-motion/u);
  assert.equal((app.match(/<form className="xnhan-composer"/gu) ?? []).length, 1);
  assert.match(turn, /<details[\s\S]*?className="xnhan-sources"[\s\S]*?<summary>/u);
  assert.match(turn, /<XNhanActivity/u);
  assert.match(answer, /function citationEntries\(response, sourceIds\)/u);
  assert.match(answer, /naturalSourceEntries = citationEntries\([\s\S]*?response\.answerSourceIds/u);
  assert.match(answer, /className="xnhan-answer-citation-row"/u);
  assert.match(answer, /response\.answerBlocks\.map[\s\S]*?citationEntries\(response, block\.sourceIds\)/u);
  assert.match(
    answer,
    /className=\{inline \? "xnhan-citation-chips is-inline"[\s\S]*?href=\{source\.url\}[\s\S]*?openCitationSource\(sourceIndex, handle\)/u,
  );
  assert.doesNotMatch(turn, /response\.posts\.map\(\(post, index\)[\s\S]*?openAnswerSource/u);
  assert.match(
    turn,
    /response\.mode === "ai"[\s\S]*?usedSourcesDescription[\s\S]*?retrievedSourcesDescription/u,
  );
  assert.doesNotMatch(turn, /<details[^>]*\sopen(?:=|\s|>)/u);
  assert.match(turn, /<article\s+className="xnhan-source-card"/u);
  assert.match(turn, /aria-labelledby=\{authorHeadingId\}/u);
  assert.match(turn, /xnhan-results-\$\{response\.requestId\}/u);
  assert.match(turn, /<time[\s\S]*?dateTime=\{post\.publishedAt\}/u);
  assert.match(
    turn,
    /aria-label=\{copy\.results\.estimatedPublishedTime\(publishedTime\)\}/u,
  );
  assert.match(
    turn,
    /visibleMetrics = Object\.entries\(copy\.results\.metrics\)\.filter\([\s\S]*?value !== null/u,
  );
  assert.match(
    turn,
    /visibleMetrics\.length > 0[\s\S]*?xnhan-metrics-\$\{visibleMetrics\.length\}/u,
  );
  assert.doesNotMatch(turn, /publishedTimeDerived|UnavailableValue|MetricValue/u);
  assert.match(turn, /xnhan-post-link-\$\{searchId\}-\$\{post\.id\}/u);
  assert.match(session, /sourceDisclosure\.open = true[\s\S]*?requestAnimationFrame/u);
  assert.doesNotMatch(`${app}\n${turn}`, /claim|SUPPORTED|REFUTED/u);
  assert.match(app, /useXNhanWebMcp\(\{/u);
  assert.match(app, /useXNhanWebMcp\(\{\s*localeActionRef,/u);
  assert.match(hook, /isXNhanPath\(window\.location\.pathname\)/u);
  assert.match(hook, /async setXNhanLocale\(nextLocale/u);
  assert.match(hook, /xnhan-answer-title-\$\{response\.requestId\}/u);
  assert.doesNotMatch(hook, /fetch\(|localStorage|sessionStorage|analytics/iu);

  assert.match(styles, /\.xnhan-app\s*\{/u);
  assert.match(styles, /\.xnhan-transcript\s*\{[\s\S]*?overflow-y:\s*auto/u);
  assert.match(styles, /\.xnhan-composer-dock\s*\{[\s\S]*?position:\s*sticky/u);
  assert.match(
    styles,
    /\.xnhan-composer textarea\s*\{[\s\S]*?padding:\s*0\.58rem 0\.55rem 0\.78rem;[\s\S]*?line-height:\s*1\.35/u,
  );
  assert.match(
    styles,
    /\.xnhan-composer textarea::placeholder\s*\{\s*color:\s*var\(--text-secondary\);\s*\}/u,
  );
  assert.doesNotMatch(
    styles,
    /\.xnhan-composer textarea::placeholder\s*\{[^}]*var\(--text-disabled\)/u,
  );
  for (const selector of [
    String.raw`\.xnhan-app \.xnhan-provider-snapshot`,
    String.raw`\.xnhan-composer-meta`,
  ]) {
    assert.match(styles, new RegExp(`${selector}\\s*\\{[^}]*font-size:\\s*0\\.75rem`, "u"));
  }
  for (const selector of [
    String.raw`\.xnhan-activity-header > span`,
    String.raw`\.xnhan-consulted-sources > strong`,
    String.raw`\.xnhan-source-kind`,
    String.raw`\.xnhan-source-text-label`,
    String.raw`\.xnhan-metrics dt`,
  ]) {
    assert.match(
      turnStyles,
      new RegExp(`${selector}\\s*\\{[^}]*font-size:\\s*0\\.75rem`, "u"),
    );
  }
  assert.match(styles, /\.xnhan-suggestion-index\s*\{[^}]*font-size:\s*0\.66rem/u);
  assert.match(turnStyles, /\.xnhan-citation-index\s*\{[^}]*font-size:\s*0\.66rem/u);
  assert.match(turnStyles, /\.xnhan-answer-citation-row\s*\{[\s\S]*?border-top:/u);
  assert.match(turnStyles, /\.xnhan-citation-chip:focus-visible\s*\{/u);
  assert.match(
    turnStyles,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.xnhan-citation-chip[\s\S]*?transition:\s*none/u,
  );
  assert.match(styles, /env\(safe-area-inset-bottom\)/u);
  assert.match(styles, /@media \(max-width:\s*52\.5rem\)[\s\S]*?\.xnhan-/u);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.xnhan-/u);
  assert.doesNotMatch(globalStyles, /\.xnhan-/u);
  assert.equal(xnhanContent.vi.results.sourcesTitle, "Các mục X đã truy xuất");
  assert.equal(xnhanContent.en.results.sourcesTitle, "Retrieved X items");
});
