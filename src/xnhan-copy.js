export function supportingAnswerSources(response) {
  const supportingIds = new Set(
    Array.isArray(response?.answerSourceIds) ? response.answerSourceIds : [],
  );
  if (supportingIds.size === 0 || !Array.isArray(response?.posts)) return [];
  return response.posts.filter((post) => supportingIds.has(post.id));
}

export function formatXNhanAnswerForClipboard(response, sourcesLabel) {
  const answer = typeof response?.answer === "string" ? response.answer.trim() : "";
  if (!answer) return "";

  const sources = supportingAnswerSources(response);
  if (sources.length === 0) return answer;

  const sourceLines = sources.map((post, index) => {
    const handle = post?.author?.handle ? `@${post.author.handle}` : "X";
    return `[${index + 1}] ${handle} — ${post.url}`;
  });
  return [answer, sourcesLabel, ...sourceLines].join("\n\n");
}
