import { Fragment } from "react";

function citationEntries(response, sourceIds) {
  const sourceIndexByPostId = new Map(
    response.posts.map((post, index) => [post.id, index + 1]),
  );
  return (Array.isArray(sourceIds) ? sourceIds : [])
    .map((sourceId) => {
      const sourceIndex = sourceIndexByPostId.get(sourceId);
      return Number.isInteger(sourceIndex)
        ? {
            sourceId,
            sourceIndex,
            source: response.posts[sourceIndex - 1],
          }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.sourceIndex - right.sourceIndex);
}

function CitationChips({ answerLocale, copy, entries, inline = false }) {
  if (entries.length === 0) return null;
  return (
    <span
      className={inline ? "xnhan-citation-chips is-inline" : "xnhan-citation-chips"}
      role="list"
    >
      {entries.map(({ source, sourceId, sourceIndex }) => {
        const handle = source?.author?.handle;
        return (
          <a
            className="xnhan-citation-chip"
            key={sourceId}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            lang={answerLocale}
            role="listitem"
            aria-label={copy.results.openCitationSource(sourceIndex, handle)}
            title={copy.results.openCitationSource(sourceIndex, handle)}
          >
            <span className="xnhan-citation-index" aria-hidden="true">
              {sourceIndex}
            </span>
            <span className="xnhan-citation-handle">
              {handle ? `@${handle}` : copy.results.unnamedAuthor}
            </span>
          </a>
        );
      })}
    </span>
  );
}

export function XNhanAnswer({ answerCopy, answerLocale, copy, response }) {
  const localizedCopy = answerCopy ?? copy;
  const legacyAnswer = response.answerBlocks
    .map((block) => block.text)
    .join("\n\n");
  const hasNaturalAnswer =
    typeof response.answer === "string" &&
    response.answer !== legacyAnswer;

  if (response.answerBlocks.length === 0) {
    return (
      <p className="xnhan-answer-text" lang={answerLocale}>
        {response.answer ?? localizedCopy.results.answerUnavailable}
      </p>
    );
  }

  if (hasNaturalAnswer) {
    const naturalSourceEntries = citationEntries(
      response,
      response.answerSourceIds,
    );
    return (
      <div className="xnhan-answer-text xnhan-natural-answer" lang={answerLocale}>
        {response.answer.split(/\n{2,}/u).map((paragraph, paragraphIndex) => (
          <p key={`${response.requestId}-natural-answer-${paragraphIndex + 1}`}>
            {paragraph}
          </p>
        ))}
        <div className="xnhan-answer-citation-row">
          <span className="xnhan-citation-label" lang={answerLocale}>
            {localizedCopy.results.answerSourcesLabel}
          </span>
          <CitationChips
            answerLocale={answerLocale}
            copy={localizedCopy}
            entries={naturalSourceEntries}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="xnhan-answer-text">
      {response.answerBlocks.map((block, blockIndex) => {
        const key = `${response.requestId}-answer-${blockIndex + 1}`;
        return (
          <Fragment key={key}>
            <p data-translation-status={block.translationStatus}>
              <span lang={answerLocale}>{block.prefix}</span>
              <bdi dir="auto" lang={block.passageLocale ?? undefined}>
                {block.passage}
              </bdi>{" "}
              <CitationChips
                answerLocale={answerLocale}
                copy={localizedCopy}
                entries={citationEntries(response, block.sourceIds)}
                inline
              />
            </p>
            {block.sourcePassage !== null && block.sourcePassage !== undefined ? (
              <p className="xnhan-source-language-passage">
                <span lang={answerLocale}>{block.sourcePassagePrefix}</span>
                <bdi dir="auto" lang={block.sourcePassageLocale ?? undefined}>
                  {block.sourcePassage}
                </bdi>{" "}
                <CitationChips
                  answerLocale={answerLocale}
                  copy={localizedCopy}
                  entries={citationEntries(response, block.sourceIds)}
                  inline
                />
              </p>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
