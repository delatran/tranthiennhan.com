import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { Copy } from "@phosphor-icons/react/dist/csr/Copy";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Stop } from "@phosphor-icons/react/dist/csr/Stop";

import { formatMetric, xnhanContent } from "./xnhan-content.js";
import {
  formatXNhanAnswerForClipboard,
  supportingAnswerSources,
} from "./xnhan-copy.js";
import { XNhanActivity } from "./XNhanActivity.jsx";
import { XNhanAnswer } from "./XNhanAnswer.jsx";
import { XNhanAvatar } from "./XNhanLogo.jsx";
import "./xnhan-turn.css";

function formatTimestamp(value, locale) {
  if (value === null) return null;
  const languageTag = locale === "vi" ? "vi-VN" : "en-US";
  return new Intl.DateTimeFormat(languageTag, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
}

function formatElapsedTime(elapsedSeconds) {
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function AssistantMark() {
  return (
    <span className="xnhan-assistant-mark" aria-hidden="true">
      <XNhanAvatar className="xnhan-assistant-avatar" />
    </span>
  );
}

function ProviderSnapshot({ copy, modelDisplayName, pending = false }) {
  const modelName =
    modelDisplayName ??
    (pending
      ? copy.providers.modelPending
      : copy.providers.modelUnconfirmed);
  return (
    <p
      className="xnhan-provider-snapshot"
      aria-label={`${copy.providers.snapshotLabel}: ${modelName}`}
    >
      <span>{modelName}</span>
    </p>
  );
}

export function ResearchProgress({
  activityDisclosureRef,
  activities,
  consultedSources,
  copy,
  locale,
  modelDisplayName,
  onStop,
  startedAt,
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)),
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));
    }, 1_000);
    return () => window.clearInterval(intervalId);
  }, [startedAt]);

  return (
    <div className="xnhan-loading-state">
      <AssistantMark />
      <div className="xnhan-loading-content">
        <p className="xnhan-turn-label">{copy.results.assistantLabel}</p>
        <ProviderSnapshot
          copy={copy}
          modelDisplayName={modelDisplayName}
          pending
        />
        <h2>{copy.progress.title}</h2>
        <p>{copy.status.loading}</p>
        <XNhanActivity
          activities={activities}
          copy={copy.activity}
          disclosureRef={activityDisclosureRef}
          live
          locale={locale}
          sources={consultedSources}
        />
        <div
          className="xnhan-progress-track"
          role="progressbar"
          aria-label={copy.progress.label}
        >
          <span aria-hidden="true" />
        </div>
        <div className="xnhan-progress-meta">
          <span className="xnhan-elapsed" aria-hidden="true">
            {copy.progress.elapsed(formatElapsedTime(elapsedSeconds))}
          </span>
          <button type="button" onClick={onStop}>
            <Stop size={15} weight="fill" aria-hidden="true" />
            {copy.progress.stop}
          </button>
        </div>
      </div>
    </div>
  );
}

function XPostCard({ copy, locale, post, searchId, sourceIndex }) {
  const displayName = post.author.displayName ?? `@${post.author.handle}`;
  const publishedTime = formatTimestamp(post.publishedAt, locale);
  const visibleMetrics = Object.entries(copy.results.metrics).filter(
    ([metric]) => post.engagement[metric].value !== null,
  );
  const authorHeadingId = `xnhan-post-author-${searchId}-${post.id}`;

  return (
    <article
      className="xnhan-source-card"
      id={`xnhan-post-${searchId}-${post.id}`}
      aria-labelledby={authorHeadingId}
    >
      <header className="xnhan-source-header">
        <div className="xnhan-source-lead">
          <span className="xnhan-source-index" aria-hidden="true">
            [{sourceIndex}]
          </span>
          <div className="xnhan-source-author">
            <h3 id={authorHeadingId}>{displayName}</h3>
            {post.author.displayName ? <span>@{post.author.handle}</span> : null}
          </div>
        </div>
        {post.postKind !== "unknown" ? (
          <span className="xnhan-source-kind">
            {copy.results.postKinds[post.postKind]}
          </span>
        ) : null}
      </header>

      <p className="xnhan-source-text-label">{copy.results.sourceTextLabel}</p>
      <p className="xnhan-source-text">{post.text}</p>

      {publishedTime ? (
        <p className="xnhan-source-time">
          <time
            dateTime={post.publishedAt}
            aria-label={copy.results.estimatedPublishedTime(publishedTime)}
          >
            {publishedTime}
          </time>
        </p>
      ) : null}

      {visibleMetrics.length > 0 ? (
        <dl className={`xnhan-metrics xnhan-metrics-${visibleMetrics.length}`}>
          {visibleMetrics.map(([metric, label]) => (
            <div key={metric}>
              <dt>{label}</dt>
              <dd>{formatMetric(post.engagement[metric].value, locale)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <a
        className="xnhan-source-link"
        id={`xnhan-post-link-${searchId}-${post.id}`}
        href={post.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span>{copy.results.openOriginal}</span>
        <ArrowUpRight size={18} aria-hidden="true" />
      </a>
    </article>
  );
}

export function XNhanResults({
  activityDisclosureRef,
  activities,
  answerLocale,
  consultedSources,
  copy,
  locale,
  response,
}) {
  const observedTime = formatTimestamp(response.observedAt, locale);
  const answerCopy = xnhanContent[answerLocale];
  const visibleAnswerText = response.answer ?? "";
  const supportingSources = supportingAnswerSources(response);
  const [copyStatus, setCopyStatus] = useState("idle");

  const copyAnswer = async () => {
    if (!visibleAnswerText) return;
    try {
      await navigator.clipboard.writeText(
        formatXNhanAnswerForClipboard(
          response,
          answerCopy.results.answerSourcesLabel,
        ),
      );
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  const copyLabel =
    copyStatus === "copied"
      ? copy.results.copied
      : copyStatus === "failed"
        ? copy.results.copyFailed
        : supportingSources.length > 0
          ? copy.results.copyWithSources
          : copy.results.copy;

  return (
    <div className="xnhan-results" id={`xnhan-results-${response.requestId}`}>
      <article className="xnhan-answer">
        <AssistantMark />
        <div className="xnhan-answer-content">
          <p className="xnhan-turn-label">{copy.results.assistantLabel}</p>
          <ProviderSnapshot
            copy={copy}
            modelDisplayName={response.retrieval.modelDisplayName}
          />
          <h2
            className="sr-only"
            id={`xnhan-answer-title-${response.requestId}`}
            lang={answerLocale}
          >
            {answerCopy.results.answerTitle}
          </h2>
          <XNhanActivity
            activities={activities}
            copy={copy.activity}
            disclosureRef={activityDisclosureRef}
            live={false}
            locale={locale}
            sources={consultedSources}
          />
          <XNhanAnswer
            answerCopy={answerCopy}
            answerLocale={answerLocale}
            copy={copy}
            response={response}
          />

          {visibleAnswerText ? (
            <div className="xnhan-answer-actions">
              <button type="button" onClick={copyAnswer}>
                {copyStatus === "copied" ? (
                  <Check size={17} weight="bold" aria-hidden="true" />
                ) : (
                  <Copy size={17} aria-hidden="true" />
                )}
                {copyLabel}
              </button>
              <span className="sr-only" role="status" aria-live="polite">
                {copyStatus === "idle" ? "" : copyLabel}
              </span>
            </div>
          ) : null}

          <details
            className="xnhan-sources"
            id={`xnhan-sources-details-${response.requestId}`}
          >
            <summary>
              <span className="xnhan-sources-summary-icon" aria-hidden="true">
                <MagnifyingGlass size={17} />
              </span>
              <span className="xnhan-sources-summary-copy">
                <strong>{copy.results.sourcesTitle}</strong>
                <span>{copy.results.sourceCount(response.posts.length)}</span>
              </span>
              <CaretDown
                className="xnhan-sources-chevron"
                size={18}
                weight="bold"
                aria-hidden="true"
              />
            </summary>

            <div className="xnhan-sources-panel">
              <p className="xnhan-sources-description">
                {response.mode === "ai"
                  ? copy.results.usedSourcesDescription
                  : copy.results.retrievedSourcesDescription}
              </p>
              <p className="xnhan-coverage-note">
                {copy.results.coverageNote}
              </p>
              <p className="xnhan-retrieval-time">
                <span>{copy.results.retrievalTime}</span>
                <time dateTime={response.observedAt}>{observedTime}</time>
              </p>

              <div className="xnhan-source-list">
                {response.posts.map((post, index) => (
                  <XPostCard
                    copy={copy}
                    key={post.id}
                    locale={locale}
                    post={post}
                    searchId={response.requestId}
                    sourceIndex={index + 1}
                  />
                ))}
              </div>
            </div>
          </details>
        </div>
      </article>
    </div>
  );
}

export function XNhanTurn({
  busy,
  copy,
  locale,
  onRetry,
  onStop,
  turn,
}) {
  const turnCopy = xnhanContent[turn.answerLocale];
  const activityDisclosureRef = useRef({
    expanded: true,
    userToggled: false,
  });

  return (
    <div className="xnhan-chat-turn">
      <article className="xnhan-user-turn">
        <p className="sr-only">{copy.results.userLabel}</p>
        <ProviderSnapshot
          copy={copy}
          modelDisplayName={turn.modelDisplayName}
          pending={turn.phase === "loading"}
        />
        <p lang={turn.answerLocale}>{turn.submittedQuery}</p>
      </article>

      {turn.phase === "loading" ? (
        <ResearchProgress
          activityDisclosureRef={activityDisclosureRef}
          activities={turn.activities}
          consultedSources={turn.consultedSources}
          copy={copy}
          locale={locale}
          modelDisplayName={turn.modelDisplayName}
          onStop={onStop}
          startedAt={turn.startedAt}
        />
      ) : null}

      {turn.phase === "cancelled" ? (
        <div className="xnhan-cancelled-state" lang={turn.answerLocale}>
          <AssistantMark />
          <div>
            <h2>{turnCopy.progress.cancelledTitle}</h2>
            <ProviderSnapshot
              copy={turnCopy}
              modelDisplayName={turn.modelDisplayName}
            />
            <p>{turnCopy.progress.cancelledText}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void onRetry(turn.submittedQuery, {
                  answerLocale: turn.answerLocale,
                  historySnapshot: turn.requestHistory,
                  provider: turn.provider,
                })
              }
            >
              <ArrowCounterClockwise size={18} aria-hidden="true" />
              {turnCopy.form.retry}
            </button>
          </div>
        </div>
      ) : null}

      {turn.phase === "error" ? (
        <div
          className="xnhan-error-state"
          lang={turn.answerLocale}
          role="alert"
        >
          <AssistantMark />
          <div>
            <h2>{turnCopy.status.error}</h2>
            <ProviderSnapshot
              copy={turnCopy}
              modelDisplayName={turn.modelDisplayName}
            />
            <p>{turn.error}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void onRetry(turn.submittedQuery, {
                  answerLocale: turn.answerLocale,
                  historySnapshot: turn.requestHistory,
                  provider: turn.provider,
                })
              }
            >
              <ArrowCounterClockwise size={18} aria-hidden="true" />
              {turnCopy.form.retry}
            </button>
          </div>
        </div>
      ) : null}

      {turn.phase === "empty" && turn.response ? (
        <div className="xnhan-empty-state">
          <AssistantMark />
          <div>
            <h2
              id={`xnhan-empty-title-${turn.response.requestId}`}
              lang={turn.answerLocale}
            >
              {xnhanContent[turn.answerLocale].emptyTitle}
            </h2>
            <ProviderSnapshot
              copy={copy}
              modelDisplayName={turn.response.retrieval.modelDisplayName}
            />
            <p lang={turn.answerLocale}>
              {xnhanContent[turn.answerLocale].emptyText}
            </p>
          </div>
        </div>
      ) : null}

      {turn.phase === "complete" && turn.response ? (
        <XNhanResults
          activityDisclosureRef={activityDisclosureRef}
          activities={turn.activities}
          answerLocale={turn.answerLocale}
          consultedSources={turn.consultedSources}
          copy={copy}
          locale={locale}
          response={turn.response}
        />
      ) : null}
    </div>
  );
}
