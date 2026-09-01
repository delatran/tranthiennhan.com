const EMPTY_XNHAN_POSTS = Object.freeze([]);

function visibleAnswerFields(activeResponse) {
  const fields = {};
  if (
    activeResponse.answer &&
    Array.isArray(activeResponse.answerSourceIds) &&
    activeResponse.answerSourceIds.length > 0
  ) {
    fields.answer = activeResponse.answer;
    fields.answerSourceIds = activeResponse.answerSourceIds;
  }

  if (activeResponse.answer && activeResponse.answerBlocks.length > 0) {
    fields.answerLocale = activeResponse.answerLocale;
    fields.answerBlocks = activeResponse.answerBlocks.map((block) => {
      const hasSourcePassage = typeof block.sourcePassage === "string";
      return {
        resultId: block.sourceIds[0],
        sourceIds: block.sourceIds,
        translationStatus: block.translationStatus ?? "not_needed",
        mainText: block.passage,
        mainLocale: block.passageLocale,
        retrievedSourceText: hasSourcePassage
          ? block.sourcePassage
          : block.passage,
        retrievedSourceLocale: hasSourcePassage
          ? block.sourcePassageLocale ?? null
          : block.passageLocale ?? null,
      };
    });
  }
  return fields;
}

function visibleResultSnapshot(activeResponse, revision) {
  if (!activeResponse) {
    return Object.freeze({
      searchId: null,
      revision: 0,
      total: 0,
      observedAt: null,
      provider: null,
      model: null,
      answerLocale: null,
      answerBlocks: Object.freeze([]),
      results: EMPTY_XNHAN_POSTS,
    });
  }

  return Object.freeze({
    searchId: activeResponse.requestId,
    revision,
    total: activeResponse.posts.length,
    observedAt: activeResponse.observedAt,
    provider: activeResponse.retrieval.provider,
    model: activeResponse.retrieval.model,
    ...visibleAnswerFields(activeResponse),
    results: activeResponse.posts.map((post) => ({
      resultId: post.id,
      kind: post.postKind,
      authorHandle: post.author.handle,
      text: post.text,
      url: post.url,
      postedAt: post.publishedAt,
      postedAtProvenance: post.publishedAtProvenance,
      metrics: {
        replyCount: post.engagement.replies.value,
        repostCount: post.engagement.reposts.value,
        likeCount: post.engagement.likes.value,
        viewCount: post.engagement.views.value,
      },
    })),
  });
}

export function createXNhanWebMcpSnapshot({
  activeResponse,
  latestTurn,
  locale,
  query,
  revision,
  visibleConversationHistory,
  defaultProvider,
}) {
  return Object.freeze({
    locale,
    provider: latestTurn?.provider ?? defaultProvider,
    phase: latestTurn?.phase ?? "idle",
    query: latestTurn?.submittedQuery || query,
    searchId: activeResponse?.requestId ?? null,
    posts: activeResponse?.posts ?? EMPTY_XNHAN_POSTS,
    visibleConversationHistory,
    visibleResults: visibleResultSnapshot(activeResponse, revision),
  });
}
