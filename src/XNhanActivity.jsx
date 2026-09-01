import { useEffect, useRef, useState } from "react";
import { Brain } from "@phosphor-icons/react/dist/csr/Brain";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Globe } from "@phosphor-icons/react/dist/csr/Globe";
import { LinkSimple } from "@phosphor-icons/react/dist/csr/LinkSimple";

function formatDuration(value, locale) {
  const seconds = Math.max(0.1, value / 1_000);
  return new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US", {
    maximumFractionDigits: seconds < 10 ? 1 : 0,
  }).format(seconds) + "s";
}

function activityLabel(activity, copy, locale) {
  if (activity.kind === "reasoning") {
    return activity.status === "started"
      ? copy.reasoningStarted(activity.phase)
      : copy.reasoningCompleted(activity.phase);
  }
  if (activity.kind === "tool") {
    if (activity.status === "started") return copy.webSearchStarted;
    if (activity.status === "searching") return copy.webSearchSearching;
    if (activity.status === "unavailable") return copy.webSearchUnavailable;
    return copy.webSearchCompleted;
  }
  if (activity.phase === "discovery") {
    return activity.status === "started"
      ? copy.discoveryStarted
      : copy.discoveryCompleted(
          activity.acceptedCount ?? 0,
          formatDuration(activity.durationMs ?? 0, locale),
        );
  }
  if (activity.phase === "ranking") {
    return activity.status === "started"
      ? copy.rankingStarted
      : copy.rankingCompleted(
          activity.acceptedCount ?? 0,
          formatDuration(activity.durationMs ?? 0, locale),
        );
  }
  if (activity.status === "started") return copy.synthesisStarted;
  if (activity.status === "unavailable") return copy.synthesisUnavailable;
  return copy.synthesisCompleted(
    formatDuration(activity.durationMs ?? 0, locale),
  );
}

function ActivityIcon({ activity }) {
  if (activity.kind === "reasoning") {
    return <Brain size={16} aria-hidden="true" />;
  }
  if (activity.kind === "tool") {
    return <Globe size={16} aria-hidden="true" />;
  }
  return <CheckCircle size={16} aria-hidden="true" />;
}

export function XNhanActivity({
  activities,
  copy,
  disclosureRef,
  live,
  locale,
  sources,
}) {
  const localDisclosureRef = useRef({ expanded: live, userToggled: false });
  const stableDisclosureRef = disclosureRef ?? localDisclosureRef;
  const [expanded, setExpanded] = useState(() => {
    const saved = stableDisclosureRef.current;
    return saved.userToggled ? saved.expanded : live;
  });
  const showSources = !live && sources.length > 0;

  useEffect(() => {
    const saved = stableDisclosureRef.current;
    setExpanded(saved.userToggled ? saved.expanded : live);
  }, [live, stableDisclosureRef]);

  if (activities.length === 0 && !showSources) return null;
  return (
    <details
      className={`xnhan-activity${live ? " is-live" : ""}`}
      aria-label={copy.title}
      aria-live="off"
      open={expanded}
      onToggle={(event) => {
        const nextExpanded = event.currentTarget.open;
        if (event.nativeEvent?.isTrusted) {
          stableDisclosureRef.current = {
            expanded: nextExpanded,
            userToggled: true,
          };
        }
        setExpanded(nextExpanded);
      }}
    >
      <summary className="xnhan-activity-header">
        <strong>{copy.title}</strong>
        <span>
          {live ? copy.live : copy.complete}
          <CaretDown className="xnhan-activity-chevron" size={14} aria-hidden="true" />
        </span>
      </summary>
      <div className="xnhan-activity-panel">
        <ol className="xnhan-activity-list">
          {activities.map((activity) => (
            <li key={activity.sequence}>
              <span className="xnhan-activity-icon">
                <ActivityIcon activity={activity} />
              </span>
              <div>
                <p>{activityLabel(activity, copy, locale)}</p>
                {activity.queries?.length ? (
                  <p className="xnhan-activity-detail">
                    <strong>{copy.queries}:</strong> {activity.queries.join(" · ")}
                  </p>
                ) : null}
                {activity.summary ? (
                  <p className="xnhan-activity-detail">
                    <strong>{copy.summary}:</strong> {activity.summary}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        {showSources ? (
          <div className="xnhan-consulted-sources">
            <strong>{copy.consultedSources}</strong>
            <div>
              {sources.map((source) => (
                <a
                  href={source.url}
                  key={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={copy.openSource(source.handle)}
                >
                  <LinkSimple size={14} aria-hidden="true" />
                  @{source.handle}
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}
