import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyXNhanTemporalIntent,
  decodeXStatusIdTimestamp,
  rankXPostCandidates,
  resolveXNhanContextualTemporalScope,
  X_STATUS_SNOWFLAKE_EPOCH_MS,
  X_STATUS_TIMESTAMP_PROVENANCE,
} from "../worker/xnhan-ranking.js";

const OBSERVED_AT = "2026-08-28T12:00:00.000Z";

function snowflakeAt(iso, sequence = 0n) {
  return (
    (BigInt(Date.parse(iso) - X_STATUS_SNOWFLAKE_EPOCH_MS) << 22n) |
    sequence
  ).toString();
}

function post(id, text, publishedAt = null, handle = "source") {
  return {
    id,
    url: `https://x.com/${handle}/status/${id}`,
    author: { handle, displayName: null },
    text,
    publishedAt,
  };
}

function entry(
  value,
  { ranks = [1], queryHits = 1, queryFamilies } = {},
) {
  return { post: value, ranks, queryHits, queryFamilies };
}

test("decodes the timestamp bits of a known Snowflake roundtrip", () => {
  const timestamp = "2025-06-15T08:09:10.123Z";
  const id = snowflakeAt(timestamp, 4095n);

  assert.equal(decodeXStatusIdTimestamp(id, OBSERVED_AT), timestamp);
  assert.equal(decodeXStatusIdTimestamp(BigInt(id), OBSERVED_AT), timestamp);
});

test("exports the canonical public status-ID timestamp provenance", () => {
  assert.equal(X_STATUS_TIMESTAMP_PROVENANCE, "status_id");
});

test("rejects malformed, legacy-short, unsafe-number, and future IDs", () => {
  assert.equal(decodeXStatusIdTimestamp("not-an-id", OBSERVED_AT), null);
  assert.equal(decodeXStatusIdTimestamp("000123456789012345", OBSERVED_AT), null);
  assert.equal(decodeXStatusIdTimestamp("1234567890", OBSERVED_AT), null);
  assert.equal(decodeXStatusIdTimestamp(Number.MAX_SAFE_INTEGER + 1, OBSERVED_AT), null);
  assert.equal(
    decodeXStatusIdTimestamp(snowflakeAt("2026-08-28T12:05:01.000Z"), OBSERVED_AT),
    null,
  );
  assert.equal(decodeXStatusIdTimestamp(snowflakeAt("2025-01-01T00:00:00.000Z"), "invalid"), null);
});

test("classifies Vietnamese and English latest/current intent", () => {
  assert.equal(classifyXNhanTemporalIntent("Tin AI mới nhất").kind, "latest");
  assert.equal(classifyXNhanTemporalIntent("latest OpenAI model updates").kind, "latest");
  assert.equal(classifyXNhanTemporalIntent("AI hiện nay đang thay đổi ra sao?").kind, "current");
  assert.equal(classifyXNhanTemporalIntent("current cloud security risks").kind, "current");
  assert.equal(
    classifyXNhanTemporalIntent(
      "Giới công nghệ trên X đang tranh luận gì về tương lai của AI và loài người?",
    ).kind,
    "current",
  );
});

test("classifies narrow implicit present-state questions without recency-filtering definitions", () => {
  for (const query of [
    "Who is the CEO of Example Corp?",
    "What is the service status of Example Cloud?",
    "What are people saying about Example Corp?",
    "Update on Example Cloud",
    "Ai là chủ tịch Example Corp?",
    "Tình hình Example Corp",
    "Giá của Example Phone là bao nhiêu?",
  ]) {
    assert.equal(classifyXNhanTemporalIntent(query, OBSERVED_AT).kind, "current", query);
  }

  for (const query of [
    "What is retrieval augmented generation?",
    "Explain price elasticity in economics",
    "Lịch sử của Example Corp",
    "What happened with Example Launch?",
    "What happened to the Titanic?",
  ]) {
    assert.equal(classifyXNhanTemporalIntent(query, OBSERVED_AT).kind, "general", query);
  }

  assert.equal(
    classifyXNhanTemporalIntent("Who is the CEO of Example Corp?", OBSERVED_AT)
      .freshnessPolicy,
    "prefer",
  );
  assert.equal(
    classifyXNhanTemporalIntent("current CEO of Example Corp", OBSERVED_AT)
      .freshnessPolicy,
    "strict",
  );
  assert.equal(
    classifyXNhanTemporalIntent(
      "What happened with Example Launch recently?",
      OBSERVED_AT,
    ).freshnessPolicy,
    "strict",
  );
});

test("does not mistake a product-version year for a historical scope", () => {
  assert.equal(
    classifyXNhanTemporalIntent(
      "latest Windows Server 2022 security updates",
      OBSERVED_AT,
    ).kind,
    "latest",
  );
  assert.equal(
    classifyXNhanTemporalIntent(
      "cập nhật mới nhất cho Windows Server 2022",
      OBSERVED_AT,
    ).kind,
    "latest",
  );
  assert.equal(
    classifyXNhanTemporalIntent("latest posts from 2022", OBSERVED_AT).kind,
    "historical",
  );
  assert.equal(
    classifyXNhanTemporalIntent(
      "OpenAI announcements published in 2022",
      OBSERVED_AT,
    ).kind,
    "historical",
  );
  assert.equal(
    classifyXNhanTemporalIntent("posts from 2021 to 2022", OBSERVED_AT).kind,
    "historical",
  );
  for (const query of [
    "Windows Server 2022 security architecture",
    "kiến trúc bảo mật Windows Server 2022",
    "ISO 27001:2022 controls explained",
  ]) {
    assert.equal(classifyXNhanTemporalIntent(query, OBSERVED_AT).kind, "general");
  }
  for (const query of [
    "Windows Server 2022 security updates today",
    "Windows Server 2022 CVEs in the last 24 hours",
    "CVE Windows Server 2022 trong 24 giờ qua",
  ]) {
    assert.equal(classifyXNhanTemporalIntent(query, OBSERVED_AT).kind, "current");
  }
});

test("recognizes bounded English year attribution without swallowing product versions", () => {
  for (const query of [
    "OpenAI announcements for 2022",
    "OpenAI announcements dated 2022",
    "2022 OpenAI announcements",
    "OpenAI 2022 announcements",
  ]) {
    const intent = classifyXNhanTemporalIntent(query, OBSERVED_AT);
    assert.equal(intent.kind, "historical", query);
    assert.deepEqual(intent.years, [2022], query);
  }

  for (const [query, kind] of [
    ["latest updates for Windows Server 2022", "latest"],
    ["Windows Server 2022 security architecture", "general"],
    ["Windows Server 2022 announcements", "general"],
    ["latest ISO 27001:2022 controls updates", "latest"],
    ["ISO 27001:2022 controls explained", "general"],
  ]) {
    assert.equal(
      classifyXNhanTemporalIntent(query, OBSERVED_AT).kind,
      kind,
      query,
    );
  }
});

test("previous year uses the exact prior UTC calendar window in English and Vietnamese", () => {
  for (const query of [
    "OpenAI announcements last year",
    "OpenAI announcements previous year",
    "Thông báo OpenAI năm trước",
  ]) {
    assert.deepEqual(classifyXNhanTemporalIntent(query, OBSERVED_AT), {
      kind: "historical",
      window: {
        start: "2025-01-01T00:00:00.000Z",
        endExclusive: "2026-01-01T00:00:00.000Z",
      },
    });
  }

  const firstMoment = post(
    snowflakeAt("2025-01-01T00:00:00.000Z"),
    "OpenAI announcement at the first included instant.",
  );
  const lastMoment = post(
    snowflakeAt("2025-12-31T23:59:59.999Z"),
    "OpenAI announcement at the last included instant.",
  );
  const outside = post(
    snowflakeAt("2026-01-01T00:00:00.000Z"),
    "OpenAI announcement outside the previous year.",
  );
  const unknown = post("legacy-id", "OpenAI announcement with unknown time.");
  assert.deepEqual(
    rankXPostCandidates(
      "OpenAI announcements last year",
      [entry(outside), entry(firstMoment), entry(unknown), entry(lastMoment)],
      { observedAt: OBSERVED_AT, limit: 4 },
    ),
    [lastMoment, firstMoment],
  );
  assert.equal(
    classifyXNhanTemporalIntent(
      "OpenAI announcements last year and previous month",
      OBSERVED_AT,
    ).invalidScope,
    true,
  );
});

test("unscoped product and standard years remain relevance-bearing query tokens", () => {
  const timestamp = "2026-08-27T09:00:00.000Z";
  for (const [query, wrongText, correctText] of [
    [
      "latest Windows Server 2022 security updates",
      "Windows Server 2019 security updates",
      "Windows Server 2022 security updates",
    ],
    [
      "latest ISO 27001:2022 controls updates",
      "ISO 27001:2013 controls updates",
      "ISO 27001:2022 controls updates",
    ],
  ]) {
    const wrong = post(snowflakeAt(timestamp, 1n), wrongText, null, "wrong");
    const correct = post(
      snowflakeAt(timestamp, 2n),
      correctText,
      null,
      "correct",
    );
    const ranked = rankXPostCandidates(
      query,
      [
        entry(wrong, {
          ranks: [1],
          queryHits: 2,
          queryFamilies: ["wrong-a", "wrong-b"],
        }),
        entry(correct, {
          ranks: [10],
          queryHits: 1,
          queryFamilies: ["correct"],
        }),
      ],
      { observedAt: OBSERVED_AT, limit: 1 },
    );
    assert.deepEqual(ranked, [correct], query);
  }
});

test("a product-version year cannot hard-filter a fresh relative-window result", () => {
  const oldVersionPost = post(
    snowflakeAt("2022-08-28T09:00:00.000Z"),
    "Windows Server 2022 security updates and CVE guidance.",
    null,
    "old-source",
  );
  const freshPost = post(
    snowflakeAt("2026-08-28T09:00:00.000Z"),
    "Windows Server 2022 security updates and CVE guidance today.",
    null,
    "fresh-source",
  );

  const ranked = rankXPostCandidates(
    "Windows Server 2022 security updates today",
    [
      entry(oldVersionPost, { ranks: [9], queryFamilies: ["old"] }),
      entry(freshPost, { ranks: [1], queryFamilies: ["fresh-a", "fresh-b"] }),
    ],
    { observedAt: OBSERVED_AT, limit: 2 },
  );

  assert.deepEqual(ranked, [freshPost]);
});

test("matches Vietnamese d input to đ evidence without losing lexical precision", () => {
  const relevant = post(
    snowflakeAt("2026-08-27T08:00:00.000Z"),
    "Giá điện tăng theo biểu giá mới.",
    null,
    "energy",
  );
  const rankOneNoise = post(
    snowflakeAt("2026-08-27T09:00:00.000Z"),
    "Giá xăng tăng theo thị trường.",
    null,
    "fuel",
  );

  const selected = rankXPostCandidates(
    "gia dien tang",
    [
      entry(rankOneNoise, { ranks: [1] }),
      entry(relevant, { ranks: [4] }),
    ],
    { observedAt: OBSERVED_AT, limit: 1 },
  );

  assert.deepEqual(selected.map(({ id }) => id), [relevant.id]);
});

test("latest freshness floor is inclusive, rejects one millisecond older, and is bilingual", () => {
  const atBoundary = post(
    snowflakeAt("2026-07-29T12:00:00.000Z"),
    "retrieval evidence at the latest freshness boundary",
  );
  const oneMillisecondOlder = post(
    snowflakeAt("2026-07-29T11:59:59.999Z"),
    "retrieval evidence one millisecond older than the latest freshness boundary",
  );
  const unknown = post(
    "legacy-id",
    "retrieval evidence with an unknown latest timestamp",
  );

  for (const query of [
    "latest retrieval evidence",
    "recent retrieval evidence",
    "newest retrieval evidence",
    "breaking retrieval evidence",
    "bằng chứng retrieval mới nhất",
    "bằng chứng retrieval gần đây",
    "bằng chứng retrieval mới đây",
  ]) {
    assert.deepEqual(
      rankXPostCandidates(
        query,
        [entry(oneMillisecondOlder), entry(unknown), entry(atBoundary)],
        { observedAt: OBSERVED_AT, limit: 3 },
      ),
      [atBoundary],
      query,
    );
  }
});

test("Vietnamese recent deictic words cannot rescue an off-topic candidate", () => {
  const relevant = post(
    snowflakeAt("2026-08-20T12:00:00.000Z", 1n),
    "OpenAI retrieval release",
    null,
    "openai",
  );
  const deicticOnly = post(
    snowflakeAt("2026-08-21T12:00:00.000Z", 2n),
    "đây đây",
    null,
    "noise",
  );

  for (const query of ["OpenAI gần đây", "OpenAI mới đây"]) {
    assert.deepEqual(
      rankXPostCandidates(
        query,
        [
          entry(deicticOnly, { ranks: [10] }),
          entry(relevant, { ranks: [2] }),
        ],
        { observedAt: OBSERVED_AT, limit: 2 },
      ),
      [relevant],
      query,
    );
  }
});

test("current and now freshness floors are inclusive, reject one millisecond older, and are bilingual", () => {
  const atBoundary = post(
    snowflakeAt("2026-03-01T12:00:00.000Z"),
    "retrieval evidence at the current freshness boundary",
  );
  const oneMillisecondOlder = post(
    snowflakeAt("2026-03-01T11:59:59.999Z"),
    "retrieval evidence one millisecond older than the current freshness boundary",
  );
  const unknown = post(
    "legacy-id",
    "retrieval evidence with an unknown current timestamp",
  );

  for (const query of [
    "current retrieval evidence",
    "now retrieval evidence",
    "bằng chứng retrieval hiện nay",
    "bằng chứng retrieval bây giờ",
  ]) {
    assert.deepEqual(
      rankXPostCandidates(
        query,
        [entry(oneMillisecondOlder), entry(unknown), entry(atBoundary)],
        { observedAt: OBSERVED_AT, limit: 3 },
      ),
      [atBoundary],
      query,
    );
  }
});

test("implicit present-state freshness widens once without admitting unknown, future, or stale evidence", () => {
  const fresh = post(
    "fresh-id",
    "Example Corp CEO is Fresh Person.",
    "2026-08-20T00:00:00.000Z",
    "fresh",
  );
  const fallback = post(
    "fallback-id",
    "Example Corp CEO is Fallback Person.",
    "2026-02-01T00:00:00.000Z",
    "fallback",
  );
  const fallbackBoundary = post(
    "fallback-boundary-id",
    "Example Corp CEO is Boundary Person.",
    "2024-08-28T12:00:00.000Z",
    "fallback-boundary",
  );
  const outsideFallback = post(
    "stale-id",
    "Example Corp CEO is Stale Person.",
    "2024-08-27T11:59:59.999Z",
    "stale",
  );
  const unknown = post(
    "legacy-id",
    "Example Corp CEO has an unknown timestamp.",
    null,
    "unknown",
  );
  const future = post(
    "future-id",
    "Example Corp CEO is Future Person.",
    "2026-08-28T12:00:00.001Z",
    "future",
  );
  const query = "Who is the CEO of Example Corp?";

  assert.deepEqual(
    rankXPostCandidates(
      query,
      [entry(outsideFallback), entry(unknown), entry(future), entry(fallback)],
      { observedAt: OBSERVED_AT, limit: 4 },
    ),
    [fallback],
  );
  assert.deepEqual(
    rankXPostCandidates(query, [entry(fallbackBoundary)], {
      observedAt: OBSERVED_AT,
      limit: 1,
    }),
    [fallbackBoundary],
  );
  for (const rejected of [outsideFallback, unknown, future]) {
    assert.deepEqual(
      rankXPostCandidates(query, [entry(rejected)], {
        observedAt: OBSERVED_AT,
        limit: 1,
      }),
      [],
      rejected.author.handle,
    );
  }
  assert.deepEqual(
    rankXPostCandidates(query, [entry(fallback), entry(fresh)], {
      observedAt: OBSERVED_AT,
      limit: 2,
    }),
    [fresh],
  );
  assert.deepEqual(
    rankXPostCandidates("current Example Corp CEO", [entry(fallback)], {
      observedAt: OBSERVED_AT,
      limit: 1,
    }),
    [],
  );
  assert.deepEqual(
    rankXPostCandidates(
      "Example Corp CEO in the last 30 days",
      [entry(fallback)],
      { observedAt: OBSERVED_AT, limit: 1 },
    ),
    [],
  );
});

test("freshness floors do not change general ranking or explicit historical precedence", () => {
  const oldGeneral = post(
    snowflakeAt("2020-05-01T00:00:00.000Z"),
    "retrieval evidence retained for a general query",
  );
  assert.deepEqual(
    rankXPostCandidates(
      "retrieval evidence",
      [entry(oldGeneral)],
      { observedAt: OBSERVED_AT, limit: 1 },
    ),
    [oldGeneral],
  );

  const historical = post(
    snowflakeAt("2020-05-01T00:00:00.000Z"),
    "retrieval evidence from the requested historical year",
  );
  const current = post(
    snowflakeAt("2026-08-20T00:00:00.000Z"),
    "retrieval evidence from the current period",
  );
  assert.deepEqual(
    rankXPostCandidates(
      "latest retrieval evidence in 2020",
      [entry(current), entry(historical)],
      { observedAt: OBSERVED_AT, limit: 2 },
    ),
    [historical],
  );
});

test("explicit historical years take precedence and expose a bounded window", () => {
  const intent = classifyXNhanTemporalIntent(
    "What were the latest retrieval advances in 2020 and 2021?",
  );

  assert.deepEqual(intent, {
    kind: "historical",
    years: [2020, 2021],
    window: {
      start: "2020-01-01T00:00:00.000Z",
      endExclusive: "2022-01-01T00:00:00.000Z",
    },
  });
});

test("relative calendar windows are anchored to observedAt", () => {
  assert.deepEqual(
    classifyXNhanTemporalIntent("retrieval update yesterday", OBSERVED_AT),
    {
      kind: "historical",
      window: {
        start: "2026-08-27T00:00:00.000Z",
        endExclusive: "2026-08-28T00:00:00.000Z",
      },
    },
  );
  assert.deepEqual(
    classifyXNhanTemporalIntent(
      "retrieval update last week",
      "2020-01-08T23:59:59.000Z",
    ),
    {
      kind: "historical",
      window: {
        start: "2019-12-30T00:00:00.000Z",
        endExclusive: "2020-01-06T00:00:00.000Z",
      },
    },
  );
});

test("current calendar windows stop at observedAt instead of including the future", () => {
  const expectedEndExclusive = "2026-08-28T12:00:00.001Z";
  for (const [query, start] of [
    ["retrieval today", "2026-08-28T00:00:00.000Z"],
    ["retrieval this week", "2026-08-24T00:00:00.000Z"],
    ["retrieval this month", "2026-08-01T00:00:00.000Z"],
    ["retrieval this year", "2026-01-01T00:00:00.000Z"],
    ["retrieval hôm nay", "2026-08-28T00:00:00.000Z"],
    ["retrieval tuần này", "2026-08-24T00:00:00.000Z"],
    ["retrieval tháng này", "2026-08-01T00:00:00.000Z"],
    ["retrieval năm nay", "2026-01-01T00:00:00.000Z"],
  ]) {
    assert.deepEqual(classifyXNhanTemporalIntent(query, OBSERVED_AT), {
      kind: "current",
      window: { start, endExclusive: expectedEndExclusive },
    });
  }
});

test("bounded rolling windows are exact and bilingual-equivalent", () => {
  for (const temporalCase of [
    {
      phrases: ["last 24 hours", "past 24 hours", "24 giờ qua", "24 giờ gần đây"],
      start: "2026-08-27T12:00:00.000Z",
    },
    {
      phrases: ["last 7 days", "past 7 days", "7 ngày qua", "7 ngày gần đây"],
      start: "2026-08-21T12:00:00.000Z",
    },
    {
      phrases: ["last 2 weeks", "past 2 weeks", "2 tuần qua", "2 tuần gần đây"],
      start: "2026-08-14T12:00:00.000Z",
    },
  ]) {
    const expected = {
      kind: "current",
      window: {
        start: temporalCase.start,
        endExclusive: "2026-08-28T12:00:00.001Z",
      },
    };
    for (const phrase of temporalCase.phrases) {
      assert.deepEqual(
        classifyXNhanTemporalIntent(`retrieval ${phrase}`, OBSERVED_AT),
        expected,
      );
    }
  }
});

test("rolling-window hard filtering includes both exact boundaries only", () => {
  const before = post(
    snowflakeAt("2026-08-27T11:59:59.999Z"),
    "retrieval update before rolling window",
  );
  const start = post(
    snowflakeAt("2026-08-27T12:00:00.000Z"),
    "retrieval update at rolling window start",
  );
  const observed = post(
    snowflakeAt("2026-08-28T12:00:00.000Z"),
    "retrieval update at observation time",
  );
  const future = post(
    snowflakeAt("2026-08-28T12:00:00.001Z"),
    "retrieval update after observation time",
  );

  assert.deepEqual(
    rankXPostCandidates(
      "retrieval update last 24 hours",
      [entry(future), entry(before), entry(start), entry(observed)],
      { observedAt: OBSERVED_AT, limit: 4 },
    ),
    [observed, start],
  );
});

test("directional ISO scopes are anchored, bounded, and bilingual-equivalent", () => {
  const sinceExpected = {
    kind: "current",
    window: {
      start: "2026-08-20T00:00:00.000Z",
      endExclusive: "2026-08-28T12:00:00.001Z",
    },
  };
  assert.deepEqual(
    classifyXNhanTemporalIntent("retrieval since 2026-08-20", OBSERVED_AT),
    sinceExpected,
  );
  assert.deepEqual(
    classifyXNhanTemporalIntent("retrieval từ 2026-08-20 đến nay", OBSERVED_AT),
    sinceExpected,
  );

  const beforeExpected = {
    kind: "historical",
    window: {
      start: "2010-11-04T01:42:54.657Z",
      endExclusive: "2026-08-20T00:00:00.000Z",
    },
  };
  assert.deepEqual(
    classifyXNhanTemporalIntent("retrieval before 2026-08-20", OBSERVED_AT),
    beforeExpected,
  );
  assert.deepEqual(
    classifyXNhanTemporalIntent("retrieval trước 2026-08-20", OBSERVED_AT),
    beforeExpected,
  );
  assert.deepEqual(
    classifyXNhanTemporalIntent("retrieval until 2026-08-20", OBSERVED_AT),
    {
      kind: "historical",
      window: {
        start: "2010-11-04T01:42:54.657Z",
        endExclusive: "2026-08-21T00:00:00.000Z",
      },
    },
  );
});

test("directional ISO hard filters respect inclusive and exclusive endpoints", () => {
  const beforeDate = post(
    snowflakeAt("2026-08-19T23:59:59.999Z"),
    "retrieval update before target date",
  );
  const atDate = post(
    snowflakeAt("2026-08-20T00:00:00.000Z"),
    "retrieval update at target date",
  );
  const endOfDate = post(
    snowflakeAt("2026-08-20T23:59:59.999Z"),
    "retrieval update at target date end",
  );
  const nextDate = post(
    snowflakeAt("2026-08-21T00:00:00.000Z"),
    "retrieval update after target date",
  );

  assert.deepEqual(
    rankXPostCandidates(
      "retrieval update before 2026-08-20",
      [entry(atDate), entry(beforeDate)],
      { observedAt: OBSERVED_AT, limit: 2 },
    ),
    [beforeDate],
  );
  assert.deepEqual(
    rankXPostCandidates(
      "retrieval update until 2026-08-20",
      [entry(nextDate), entry(beforeDate), entry(atDate), entry(endOfDate)],
      { observedAt: OBSERVED_AT, limit: 4 },
    ),
    [endOfDate, atDate, beforeDate],
  );
  assert.deepEqual(
    rankXPostCandidates(
      "retrieval update since 2026-08-20",
      [entry(beforeDate), entry(atDate), entry(endOfDate)],
      { observedAt: OBSERVED_AT, limit: 3 },
    ),
    [endOfDate, atDate],
  );
});

test("invalid, future, ambiguous, and overflowing bounded scopes fail closed", () => {
  for (const [query, observedAt = OBSERVED_AT] of [
    ["retrieval last 0 hours"],
    ["retrieval past -2 days"],
    ["retrieval 1.5 tuần gần đây"],
    ["retrieval last 999999999999999 weeks"],
    ["retrieval last 24 hours and past 7 days"],
    ["retrieval today and yesterday"],
    ["retrieval hôm nay và hôm qua"],
    ["retrieval today and this week"],
    ["retrieval hôm nay và tuần này"],
    ["retrieval last week and previous month"],
    ["retrieval tuần trước và tháng trước"],
    ["retrieval last 24 hours and today"],
    ["retrieval 24 giờ qua và hôm nay"],
    ["retrieval since 2026-08-29"],
    ["retrieval since 2100-01-01"],
    ["retrieval before 2026-08-29"],
    ["retrieval until 2026-02-30"],
    ["retrieval last 24 hours", "not-an-observation-time"],
  ]) {
    assert.deepEqual(classifyXNhanTemporalIntent(query, observedAt), {
      kind: query.includes("before") || query.includes("until")
        ? "historical"
        : "current",
      invalidScope: true,
    });
  }

  const candidate = post(
    snowflakeAt("2026-08-28T11:00:00.000Z"),
    "retrieval update candidate",
  );
  assert.deepEqual(
    rankXPostCandidates(
      "retrieval last 0 hours",
      [entry(candidate)],
      { observedAt: OBSERVED_AT, limit: 1 },
    ),
    [],
  );
});

test("ranker excludes all post timestamps after observedAt, including allowed decoder skew", () => {
  const observed = post(
    snowflakeAt(OBSERVED_AT),
    "retrieval update exactly at observation time",
  );
  const oneMillisecondFuture = post(
    snowflakeAt("2026-08-28T12:00:00.001Z"),
    "retrieval update one millisecond after observation",
  );
  const fourMinuteFuture = post(
    snowflakeAt("2026-08-28T12:04:00.000Z"),
    "retrieval update four minutes after observation",
  );
  const directFuture = post(
    snowflakeAt("2026-08-28T11:59:00.000Z"),
    "retrieval update with an untrusted future timestamp field",
    "2026-08-28T12:04:00.000Z",
  );

  assert.notEqual(decodeXStatusIdTimestamp(fourMinuteFuture.id, OBSERVED_AT), null);
  assert.deepEqual(
    rankXPostCandidates(
      "retrieval update today",
      [
        entry(oneMillisecondFuture),
        entry(fourMinuteFuture),
        entry(directFuture),
        entry(observed),
      ],
      { observedAt: OBSERVED_AT, limit: 4 },
    ),
    [observed],
  );
});

test("explicit ISO date/range/year scopes retain precedence over rolling wording", () => {
  assert.deepEqual(
    classifyXNhanTemporalIntent(
      "retrieval on 2024-05-17 during the last 24 hours",
      OBSERVED_AT,
    ),
    {
      kind: "historical",
      window: {
        start: "2024-05-17T00:00:00.000Z",
        endExclusive: "2024-05-18T00:00:00.000Z",
      },
    },
  );
  assert.deepEqual(
    classifyXNhanTemporalIntent(
      "retrieval from 2024-05-17 to 2024-05-20 in the past 7 days",
      OBSERVED_AT,
    ),
    {
      kind: "historical",
      window: {
        start: "2024-05-17T00:00:00.000Z",
        endExclusive: "2024-05-21T00:00:00.000Z",
      },
    },
  );
  assert.deepEqual(
    classifyXNhanTemporalIntent("retrieval in 2020 during the last 2 weeks", OBSERVED_AT),
    {
      kind: "historical",
      years: [2020],
      window: {
        start: "2020-01-01T00:00:00.000Z",
        endExclusive: "2021-01-01T00:00:00.000Z",
      },
    },
  );
});

test("relevance selection prevents a newest irrelevant post from winning", () => {
  const relevant = post(
    snowflakeAt("2026-08-01T00:00:00.000Z"),
    "OpenAI reasoning model release with stronger tool use",
  );
  const irrelevant = post(
    snowflakeAt("2026-08-28T11:59:00.000Z"),
    "Football transfer and stadium ticket announcement",
  );

  const ranked = rankXPostCandidates(
    "latest OpenAI reasoning model release",
    [entry(irrelevant), entry(relevant)],
    { observedAt: OBSERVED_AT, limit: 1 },
  );

  assert.deepEqual(ranked, [relevant]);
});

test("recency breaks a close-relevance tie for a latest query", () => {
  const older = post(
    snowflakeAt("2025-01-01T00:00:00.000Z"),
    "OpenAI model release improves reasoning",
  );
  const newer = post(
    snowflakeAt("2026-08-27T00:00:00.000Z"),
    "OpenAI model release improves reasoning",
  );

  const ranked = rankXPostCandidates(
    "latest OpenAI model release reasoning",
    [entry(older), entry(newer)],
    { observedAt: OBSERVED_AT, limit: 1 },
  );

  assert.deepEqual(ranked, [newer]);
});

test("explicit historical intent hard-excludes posts outside the requested year", () => {
  const requestedYear = post(
    snowflakeAt("2020-05-01T00:00:00.000Z"),
    "neural retrieval benchmark results",
  );
  const recent = post(
    snowflakeAt("2026-08-20T00:00:00.000Z"),
    "neural retrieval benchmark results",
  );

  const ranked = rankXPostCandidates(
    "neural retrieval benchmark in 2020",
    [entry(recent), entry(requestedYear)],
    { observedAt: OBSERVED_AT, limit: 2 },
  );

  assert.deepEqual(ranked, [requestedYear]);
});

test("nonconsecutive requested years exclude every intervening year", () => {
  const year2020 = post(
    snowflakeAt("2020-05-01T00:00:00.000Z"),
    "neural retrieval benchmark evidence from first period",
  );
  const excluded2021 = post(
    snowflakeAt("2021-05-01T00:00:00.000Z"),
    "neural retrieval benchmark evidence from middle period",
  );
  const year2022 = post(
    snowflakeAt("2022-05-01T00:00:00.000Z"),
    "neural retrieval benchmark evidence from second period",
  );

  const ranked = rankXPostCandidates(
    "neural retrieval benchmark in 2020 and 2022",
    [entry(excluded2021), entry(year2020), entry(year2022)],
    { observedAt: OBSERVED_AT, limit: 3 },
  );

  assert.deepEqual(ranked, [year2022, year2020]);
});

test("an explicit year range includes every intervening year", () => {
  const before = post(
    snowflakeAt("2018-06-01T00:00:00.000Z"),
    "retrieval evidence before requested year range",
  );
  const year2019 = post(
    snowflakeAt("2019-06-01T00:00:00.000Z"),
    "retrieval evidence at requested year range start",
  );
  const year2020 = post(
    snowflakeAt("2020-06-01T00:00:00.000Z"),
    "retrieval evidence inside requested year range",
  );
  const year2021 = post(
    snowflakeAt("2021-06-01T00:00:00.000Z"),
    "retrieval evidence at requested year range end",
  );
  const after = post(
    snowflakeAt("2022-06-01T00:00:00.000Z"),
    "retrieval evidence after requested year range",
  );

  const ranked = rankXPostCandidates(
    "retrieval evidence from 2019 to 2021",
    [entry(after), entry(year2019), entry(before), entry(year2020), entry(year2021)],
    { observedAt: OBSERVED_AT, limit: 5 },
  );

  assert.deepEqual(ranked, [year2021, year2020, year2019]);
});

test("an ISO exact date is an inclusive-day hard window", () => {
  const requestedDay = post(
    snowflakeAt("2024-05-17T23:59:59.999Z"),
    "retrieval update inside exact requested date",
  );
  const nextDay = post(
    snowflakeAt("2024-05-18T00:00:00.000Z"),
    "retrieval update outside exact requested date",
  );

  const ranked = rankXPostCandidates(
    "retrieval update on 2024-05-17",
    [entry(nextDay), entry(requestedDay)],
    { observedAt: OBSERVED_AT, limit: 2 },
  );

  assert.deepEqual(ranked, [requestedDay]);
});

test("an ISO date range includes both endpoint dates and excludes adjacent days", () => {
  const before = post(
    snowflakeAt("2024-05-16T23:59:59.999Z"),
    "retrieval update before requested date range",
  );
  const start = post(
    snowflakeAt("2024-05-17T00:00:00.000Z"),
    "retrieval update at requested date range start",
  );
  const end = post(
    snowflakeAt("2024-05-20T23:59:59.999Z"),
    "retrieval update at requested date range end",
  );
  const after = post(
    snowflakeAt("2024-05-21T00:00:00.000Z"),
    "retrieval update after requested date range",
  );

  const ranked = rankXPostCandidates(
    "retrieval update from 2024-05-17 to 2024-05-20",
    [entry(after), entry(start), entry(before), entry(end)],
    { observedAt: OBSERVED_AT, limit: 4 },
  );

  assert.deepEqual(ranked, [end, start]);
});

test("unconnected ISO dates form an exact-day union rather than an implicit range", () => {
  const first = post(
    snowflakeAt("2024-05-17T12:00:00.000Z"),
    "retrieval update on first requested date",
  );
  const intervening = post(
    snowflakeAt("2024-05-18T12:00:00.000Z"),
    "retrieval update between requested dates",
  );
  const second = post(
    snowflakeAt("2024-05-20T12:00:00.000Z"),
    "retrieval update on second requested date",
  );

  const ranked = rankXPostCandidates(
    "retrieval update on 2024-05-17 and 2024-05-20",
    [entry(intervening), entry(first), entry(second)],
    { observedAt: OBSERVED_AT, limit: 3 },
  );

  assert.deepEqual(ranked, [second, first]);
});

test("an ISO range can be combined with a separate exact date", () => {
  const rangeStart = post(
    snowflakeAt("2024-05-17T12:00:00.000Z"),
    "retrieval update at combined range start",
  );
  const rangeMiddle = post(
    snowflakeAt("2024-05-19T12:00:00.000Z"),
    "retrieval update inside combined range",
  );
  const rangeEnd = post(
    snowflakeAt("2024-05-20T12:00:00.000Z"),
    "retrieval update at combined range end",
  );
  const outside = post(
    snowflakeAt("2024-05-22T12:00:00.000Z"),
    "retrieval update outside combined scopes",
  );
  const exact = post(
    snowflakeAt("2024-05-25T12:00:00.000Z"),
    "retrieval update on separate exact date",
  );

  const ranked = rankXPostCandidates(
    "updates from 2024-05-17 to 2024-05-20 and separately 2024-05-25",
    [entry(outside), entry(rangeStart), entry(rangeMiddle), entry(rangeEnd), entry(exact)],
    { observedAt: OBSERVED_AT, limit: 5 },
  );

  assert.deepEqual(ranked, [exact, rangeEnd, rangeMiddle, rangeStart]);
});

test("two connected ISO ranges are parsed and merged independently", () => {
  const may2 = post(
    snowflakeAt("2024-05-02T12:00:00.000Z"),
    "retrieval update inside first explicit range",
  );
  const june2 = post(
    snowflakeAt("2024-06-02T12:00:00.000Z"),
    "retrieval update inside second explicit range",
  );
  const between = post(
    snowflakeAt("2024-05-20T12:00:00.000Z"),
    "retrieval update between explicit ranges",
  );

  const ranked = rankXPostCandidates(
    "2024-05-01 to 2024-05-03 with 2024-06-01 to 2024-06-02",
    [entry(between), entry(may2), entry(june2)],
    { observedAt: OBSERVED_AT, limit: 3 },
  );

  assert.deepEqual(ranked, [june2, may2]);
});

test("unconnected dates can surround a reversed ISO range", () => {
  const firstExact = post(
    snowflakeAt("2024-04-30T12:00:00.000Z"),
    "retrieval update on first surrounding date",
  );
  const reversedMiddle = post(
    snowflakeAt("2024-05-02T12:00:00.000Z"),
    "retrieval update inside reversed range",
  );
  const secondExact = post(
    snowflakeAt("2024-05-10T12:00:00.000Z"),
    "retrieval update on second surrounding date",
  );
  const outside = post(
    snowflakeAt("2024-05-07T12:00:00.000Z"),
    "retrieval update outside surrounding scopes",
  );

  const ranked = rankXPostCandidates(
    "2024-04-30 and 2024-05-03 to 2024-05-01 and 2024-05-10",
    [entry(outside), entry(firstExact), entry(reversedMiddle), entry(secondExact)],
    { observedAt: OBSERVED_AT, limit: 4 },
  );

  assert.deepEqual(ranked, [secondExact, reversedMiddle, firstExact]);
});

test("overlapping ISO ranges with a duplicate endpoint merge without a gap", () => {
  const middle = post(
    snowflakeAt("2024-05-04T12:00:00.000Z"),
    "retrieval update inside merged overlapping ranges",
  );
  const outside = post(
    snowflakeAt("2024-05-06T00:00:00.000Z"),
    "retrieval update after merged overlapping ranges",
  );

  const ranked = rankXPostCandidates(
    "2024-05-01 to 2024-05-03 and 2024-05-03 to 2024-05-05",
    [entry(outside), entry(middle)],
    { observedAt: OBSERVED_AT, limit: 2 },
  );

  assert.deepEqual(ranked, [middle]);
});

test("an invalid explicit ISO date fails closed instead of widening to its year", () => {
  const sameYear = post(
    snowflakeAt("2024-06-01T00:00:00.000Z"),
    "retrieval update elsewhere in invalid date year",
  );

  assert.deepEqual(
    rankXPostCandidates(
      "retrieval update on 2024-02-30",
      [entry(sameYear)],
      { observedAt: OBSERVED_AT, limit: 1 },
    ),
    [],
  );
});

for (const temporalCase of [
  {
    phrases: ["today", "hôm nay"],
    inside: "2026-08-28T10:00:00.000Z",
    outside: "2026-08-27T23:59:59.999Z",
    label: "current UTC day",
  },
  {
    phrases: ["this week", "current week", "tuần này"],
    inside: "2026-08-24T00:00:00.000Z",
    outside: "2026-08-23T23:59:59.999Z",
    label: "current Monday-through-Sunday UTC week",
  },
  {
    phrases: ["this month", "current month", "tháng này"],
    inside: "2026-08-01T00:00:00.000Z",
    outside: "2026-07-31T23:59:59.999Z",
    label: "current UTC calendar month",
  },
  {
    phrases: ["this year", "current year", "năm nay"],
    inside: "2026-01-01T00:00:00.000Z",
    outside: "2025-12-31T23:59:59.999Z",
    label: "current UTC calendar year",
  },
]) {
  for (const phrase of temporalCase.phrases) {
    test(`${phrase} hard-filters to the ${temporalCase.label}`, () => {
      const inside = post(
        snowflakeAt(temporalCase.inside),
        "retrieval update inside current calendar scope",
      );
      const outside = post(
        snowflakeAt(temporalCase.outside),
        "retrieval update outside current calendar scope",
      );
      const unknown = post(
        "legacy-id",
        "retrieval update with unknown current-scope timestamp",
      );

      assert.deepEqual(
        rankXPostCandidates(
          `retrieval update ${phrase}`,
          [entry(outside), entry(unknown), entry(inside)],
          { observedAt: OBSERVED_AT, limit: 3 },
        ),
        [inside],
      );
    });
  }
}

for (const phrase of ["hôm qua", "yesterday"]) {
  test(`${phrase} hard-filters to the previous UTC calendar day`, () => {
    const inside = post(
      snowflakeAt("2026-08-27T12:00:00.000Z"),
      "retrieval update inside previous day",
    );
    const outside = post(
      snowflakeAt("2026-08-28T00:00:00.000Z"),
      "retrieval update outside previous day",
    );

    assert.deepEqual(
      rankXPostCandidates(
        `retrieval update ${phrase}`,
        [entry(outside), entry(inside)],
        { observedAt: OBSERVED_AT, limit: 2 },
      ),
      [inside],
    );
  });
}

for (const phrase of ["tuần trước", "last week", "previous week"]) {
  test(`${phrase} hard-filters to the previous Monday-through-Sunday week`, () => {
    const inside = post(
      snowflakeAt("2026-08-20T12:00:00.000Z"),
      "retrieval update inside previous week",
    );
    const outside = post(
      snowflakeAt("2026-08-24T00:00:00.000Z"),
      "retrieval update outside previous week",
    );

    assert.deepEqual(
      rankXPostCandidates(
        `retrieval update ${phrase}`,
        [entry(outside), entry(inside)],
        { observedAt: OBSERVED_AT, limit: 2 },
      ),
      [inside],
    );
  });
}

for (const phrase of ["tháng trước", "last month", "previous month"]) {
  test(`${phrase} hard-filters to the previous UTC calendar month`, () => {
    const inside = post(
      snowflakeAt("2026-07-31T23:59:59.999Z"),
      "retrieval update inside previous month",
    );
    const outside = post(
      snowflakeAt("2026-08-01T00:00:00.000Z"),
      "retrieval update outside previous month",
    );

    assert.deepEqual(
      rankXPostCandidates(
        `retrieval update ${phrase}`,
        [entry(outside), entry(inside)],
        { observedAt: OBSERVED_AT, limit: 2 },
      ),
      [inside],
    );
  });
}

test("a hard temporal scope excludes posts with unknown timestamps", () => {
  const known = post(
    snowflakeAt("2020-05-01T00:00:00.000Z"),
    "retrieval evidence with known requested timestamp",
  );
  const unknown = post(
    "legacy-id",
    "retrieval evidence with unknown timestamp",
  );

  const ranked = rankXPostCandidates(
    "retrieval evidence in 2020",
    [entry(unknown), entry(known)],
    { observedAt: OBSERVED_AT, limit: 2 },
  );

  assert.deepEqual(ranked, [known]);
});

test("RRF sums evidence across search lists at equal text and time", () => {
  const weakEvidence = post(
    snowflakeAt("2026-08-20T00:00:00.000Z", 1n),
    "hybrid retrieval ranking evaluation",
    null,
    "weak",
  );
  const strongEvidence = post(
    snowflakeAt("2026-08-20T00:00:00.000Z", 2n),
    "hybrid retrieval ranking evaluation",
    null,
    "strong",
  );

  const ranked = rankXPostCandidates(
    "hybrid retrieval ranking evaluation",
    [
      entry(weakEvidence, { ranks: [20], queryHits: 1 }),
      entry(strongEvidence, { ranks: [1, 1, 1], queryHits: 1 }),
    ],
    { observedAt: OBSERVED_AT, limit: 1 },
  );

  assert.deepEqual(ranked, [strongEvidence]);
});

test("observed query coverage disambiguates otherwise equal evidence", () => {
  const narrowCoverage = post(
    snowflakeAt("2026-08-20T00:00:00.000Z", 3n),
    "hybrid retrieval ranking evaluation",
    null,
    "narrow",
  );
  const broadCoverage = post(
    snowflakeAt("2026-08-20T00:00:00.000Z", 4n),
    "hybrid retrieval ranking evaluation",
    null,
    "broad",
  );

  const ranked = rankXPostCandidates(
    "hybrid retrieval ranking evaluation",
    [
      entry(narrowCoverage, { ranks: [5], queryHits: 1 }),
      entry(broadCoverage, { ranks: [5], queryHits: 4 }),
    ],
    { observedAt: OBSERVED_AT, limit: 1 },
  );

  assert.deepEqual(ranked, [broadCoverage]);
});

test("low lexical overlap requires top-three rank or two distinct query families", () => {
  const relevant = post(
    snowflakeAt("2026-08-20T00:00:00.000Z", 10n),
    "quantum retrieval safety evaluation evidence",
    null,
    "relevant",
  );
  const topThreeRescue = post(
    snowflakeAt("2026-08-21T00:00:00.000Z", 11n),
    "tool calling deployment announcement",
    null,
    "topthree",
  );
  const familyRescue = post(
    snowflakeAt("2026-08-22T00:00:00.000Z", 12n),
    "model system card publication",
    null,
    "families",
  );
  const weak = post(
    snowflakeAt("2026-08-23T00:00:00.000Z", 13n),
    "football stadium ticket announcement",
    null,
    "weak",
  );

  const ranked = rankXPostCandidates(
    "quantum retrieval safety evaluation",
    [
      entry(weak, {
        ranks: [4],
        queryHits: 99,
        queryFamilies: ["Tìm gần đây", "  tim---gan DAY "],
      }),
      entry(topThreeRescue, {
        ranks: [3],
        queryFamilies: ["tool use"],
      }),
      entry(familyRescue, {
        ranks: [30],
        queryFamilies: ["model system card", "deployment evidence"],
      }),
      entry(relevant, {
        ranks: [30],
        queryFamilies: ["quantum retrieval"],
      }),
    ],
    { observedAt: OBSERVED_AT, limit: 4 },
  );

  assert.ok(ranked.includes(relevant));
  assert.ok(ranked.includes(topThreeRescue));
  assert.ok(ranked.includes(familyRescue));
  assert.equal(ranked.includes(weak), false);
});

test("evidence-backed lexical rescue never bypasses a hard temporal scope", () => {
  const inside = post(
    snowflakeAt("2026-08-28T11:00:00.000Z"),
    "quantum retrieval safety evaluation",
    null,
    "inside",
  );
  const outside = post(
    snowflakeAt("2026-08-27T11:59:59.999Z"),
    "unrelated deployment announcement",
    null,
    "outside",
  );

  assert.deepEqual(
    rankXPostCandidates(
      "quantum retrieval safety last 24 hours",
      [
        entry(outside, {
          ranks: [1],
          queryFamilies: ["recent systems", "deployment evidence"],
        }),
        entry(inside, { ranks: [20], queryFamilies: ["quantum retrieval"] }),
      ],
      { observedAt: OBSERVED_AT, limit: 2 },
    ),
    [inside],
  );
});

test("a supplied temporal scope must match the query-derived scope", () => {
  const candidate = post(
    snowflakeAt("2026-08-28T11:00:00.000Z"),
    "retrieval update inside rolling window",
  );
  const temporalScope = classifyXNhanTemporalIntent(
    "retrieval last 24 hours",
    OBSERVED_AT,
  );
  const reorderedTemporalScope = {
    window: {
      endExclusive: temporalScope.window.endExclusive,
      start: temporalScope.window.start,
    },
    kind: temporalScope.kind,
  };

  assert.deepEqual(
    rankXPostCandidates(
      "retrieval last 24 hours",
      [entry(candidate)],
      { observedAt: OBSERVED_AT, limit: 1, temporalScope: reorderedTemporalScope },
    ),
    [candidate],
  );
  assert.deepEqual(
    rankXPostCandidates(
      "retrieval last 24 hours",
      [entry(candidate)],
      {
        observedAt: OBSERVED_AT,
        limit: 1,
        temporalScope: { kind: "general", windowDays: 730 },
      },
    ),
    [],
  );

  const implicitCandidate = post(
    snowflakeAt("2026-08-28T11:00:00.000Z", 1n),
    "Example Corp CEO announcement",
  );
  assert.deepEqual(
    rankXPostCandidates(
      "Who is the CEO of Example Corp?",
      [entry(implicitCandidate)],
      {
        observedAt: OBSERVED_AT,
        limit: 1,
        temporalScope: {
          kind: "current",
          windowDays: 180,
          freshnessPolicy: "strict",
        },
      },
    ),
    [],
  );
});

test("context-dependent follow-ups inherit prior time scope while explicit corrections win", () => {
  const contextualQuery =
    "Find the latest posts from @OpenAI and @AnthropicAI What did the second account post about?";
  const inherited = resolveXNhanContextualTemporalScope(
    "What did the second account post about?",
    contextualQuery,
    OBSERVED_AT,
  );
  assert.equal(inherited.temporalQuery, contextualQuery);
  assert.equal(inherited.temporalScope.kind, "latest");

  const anthropic = post(
    snowflakeAt("2026-08-27T10:00:00.000Z"),
    "Claude model update",
    null,
    "AnthropicAI",
  );
  assert.deepEqual(
    rankXPostCandidates(contextualQuery, [entry(anthropic)], {
      observedAt: OBSERVED_AT,
      limit: 1,
      temporalQuery: inherited.temporalQuery,
      temporalScope: inherited.temporalScope,
    }),
    [anthropic],
  );

  const correctedQuery = "What did the second account post in 2020?";
  const corrected = resolveXNhanContextualTemporalScope(
    correctedQuery,
    `${contextualQuery} ${correctedQuery}`,
    OBSERVED_AT,
  );
  assert.equal(corrected.temporalQuery, correctedQuery);
  assert.equal(corrected.temporalScope.kind, "historical");
});

test("MMR/Jaccard removes near-duplicates while retaining a distinct result", () => {
  const original = post(
    snowflakeAt("2026-08-27T00:00:00.000Z", 1n),
    "OpenAI launches a new reasoning model for reliable tool calling today",
    null,
    "alpha",
  );
  const duplicate = post(
    snowflakeAt("2026-08-27T01:00:00.000Z", 2n),
    "OpenAI launches a new reasoning model for reliable tool calling today",
    null,
    "beta",
  );
  const distinct = post(
    snowflakeAt("2026-08-26T00:00:00.000Z", 3n),
    "OpenAI publishes safety evaluations and deployment limits for the model",
    null,
    "gamma",
  );

  const ranked = rankXPostCandidates(
    "latest OpenAI reasoning model safety",
    [entry(original), entry(duplicate), entry(distinct)],
    { observedAt: OBSERVED_AT, limit: 3 },
  );

  assert.equal(ranked.length, 2);
  assert.ok(ranked.includes(distinct));
  assert.equal(ranked.filter((value) => value === original || value === duplicate).length, 1);
});

test("soft author diversity preserves a distinct relevant author without affecting single-author mode", () => {
  const first = post(
    snowflakeAt("2026-08-28T10:00:00.000Z", 1n),
    "OpenAI reasoning model safety release",
    "2026-08-28T10:00:00.000Z",
    "primary",
  );
  const second = post(
    snowflakeAt("2026-08-28T09:00:00.000Z", 2n),
    "OpenAI Agent SDK tracing deployment",
    "2026-08-28T09:00:00.000Z",
    "primary",
  );
  const independent = post(
    snowflakeAt("2026-08-28T08:00:00.000Z", 3n),
    "Independent OpenAI reasoning model safety analysis",
    "2026-08-28T08:00:00.000Z",
    "independent",
  );
  const entries = [
    entry(first, { ranks: [1], queryHits: 1, queryFamilies: ["primary"] }),
    entry(second, { ranks: [2], queryHits: 1, queryFamilies: ["primary"] }),
    entry(independent, { ranks: [3], queryHits: 1, queryFamilies: ["independent"] }),
  ];
  const query =
    "latest OpenAI reasoning model Agent SDK safety tracing deployment release";

  const diverse = rankXPostCandidates(
    query,
    entries,
    { observedAt: OBSERVED_AT, limit: 2, preferAuthorDiversity: true },
  );
  assert.deepEqual(diverse, [second, independent]);

  const focused = rankXPostCandidates(
    query,
    entries,
    { observedAt: OBSERVED_AT, limit: 2, preferAuthorDiversity: false },
  );
  assert.deepEqual(focused, [first, second]);
});

test("soft author diversity cannot replace a materially relevant primary follow-up with unrelated unseen-author noise", () => {
  const lead = post(
    snowflakeAt("2026-08-28T10:00:00.000Z", 1n),
    "OpenAI Agent SDK release adds tracing handoffs and MCP approvals",
    "2026-08-28T10:00:00.000Z",
    "openai",
  );
  const followup = post(
    snowflakeAt("2026-08-28T09:00:00.000Z", 2n),
    "OpenAI Agent SDK release notes explain background mode MCP approval controls and deployment fixes",
    "2026-08-28T09:00:00.000Z",
    "openai",
  );
  const unrelated = post(
    snowflakeAt("2026-08-28T08:00:00.000Z", 3n),
    "Champions League transfer rumors discuss a Barcelona striker and stadium tickets",
    "2026-08-28T08:00:00.000Z",
    "outsider",
  );
  const entries = [
    entry(lead, {
      ranks: [1],
      queryHits: 3,
      queryFamilies: ["primary", "release", "docs"],
    }),
    entry(followup, {
      ranks: [2],
      queryHits: 3,
      queryFamilies: ["primary", "release", "docs"],
    }),
    entry(unrelated, {
      ranks: [3],
      queryHits: 1,
      queryFamilies: ["noise"],
    }),
  ];

  assert.deepEqual(
    rankXPostCandidates("latest OpenAI Agent SDK release notes", entries, {
      observedAt: OBSERVED_AT,
      limit: 2,
      preferAuthorDiversity: true,
    }),
    [lead, followup],
  );
});

test("visible ordering is newest-first with an unknown timestamp last", () => {
  const newest = post(
    snowflakeAt("2026-08-27T00:00:00.000Z"),
    "retrieval quality alpha evidence",
  );
  const older = post(
    snowflakeAt("2026-08-20T00:00:00.000Z"),
    "retrieval quality beta evidence",
  );
  const unknown = post(
    "legacy-id",
    "retrieval quality gamma evidence",
  );

  const ranked = rankXPostCandidates(
    "retrieval quality evidence",
    [entry(unknown), entry(newest), entry(older)],
    { observedAt: OBSERVED_AT, limit: 3 },
  );

  assert.deepEqual(ranked, [newest, older, unknown]);
  assert.equal(ranked[0], newest);
  assert.equal(ranked.at(-1), unknown);
});

test("selected posts are deterministic, newest-first, unknown-last, and capped at 20", () => {
  const newest = post(
    snowflakeAt("2026-08-27T00:00:00.000Z"),
    "retrieval quality result newest",
  );
  const older = post(
    snowflakeAt("2026-08-20T00:00:00.000Z"),
    "retrieval quality result older",
  );
  const unknown = post(
    "legacy-id",
    "retrieval quality result without timestamp",
  );
  const fillers = Array.from({ length: 25 }, (_, index) => {
    const value = post(
      snowflakeAt(`2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`, BigInt(index)),
      `retrieval quality result distinct topic marker${index}`,
      null,
      `source${index}`,
    );
    return entry(value, { ranks: [index + 2], queryHits: 1 });
  });
  const candidates = [entry(unknown), entry(older), ...fillers, entry(newest)];

  const first = rankXPostCandidates("retrieval quality result", candidates, {
    observedAt: OBSERVED_AT,
    limit: 99,
  });
  const second = rankXPostCandidates("retrieval quality result", candidates, {
    observedAt: OBSERVED_AT,
    limit: 99,
  });

  assert.equal(first.length, 20);
  assert.deepEqual(first, second);
  assert.equal(first[0], newest);
  const timestamps = first.map((value) =>
    decodeXStatusIdTimestamp(value.id, OBSERVED_AT),
  );
  const knownTimestamps = timestamps.filter(Boolean);
  assert.deepEqual(knownTimestamps, [...knownTimestamps].sort().reverse());
  if (first.includes(unknown)) assert.equal(first.at(-1), unknown);
  assert.equal(first.every((value) => candidates.some(({ post: candidate }) => candidate === value)), true);
});
