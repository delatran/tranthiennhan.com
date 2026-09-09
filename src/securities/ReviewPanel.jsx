import { useEffect, useState } from "react";
import { Button, Dialog, Icon, Pill, SectionHeading } from "./ui.jsx";
import { companyLabel, date, localized, number, periodLabel, unresolvedIssues } from "./format.js";
import { ReportBusinessRisks, ReportReadiness } from "./AnalysisPanel.jsx";

export function ReviewPanel({ state, controller, copy }) {
  const { dossier, locale, busy } = state;
  const [notes, setNotes] = useState(dossier.notes ?? "");
  const [resolving, setResolving] = useState(null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    setNotes(dossier.notes ?? "");
    setResolving(null);
    setReason("");
  }, [dossier.id, dossier.revision]);
  const issues = dossier.issues ?? [];
  const unresolved = unresolvedIssues(dossier);
  const blockers = unresolved.filter((issue) => issue.severity === "material");
  const active =
    state.job && ["queued", "running", "pending", "started"].includes(state.job.status);
  const inspect = (issue) => {
    const metric = dossier.metrics.find((item) => issue.metricIds?.includes(item.id));
    if (metric) {
      const side = issue.id?.includes("comparison") ? "comparison" : "current";
      controller.getEvidence({
        dossierId: dossier.id,
        revision: dossier.revision,
        sourceId: metric[side].sourceId,
        metricId: metric.id,
        period: side,
      });
    } else if (issue.sourceIds?.[0])
      controller.getEvidence({
        dossierId: dossier.id,
        revision: dossier.revision,
        sourceId: issue.sourceIds[0],
      });
  };
  return (
    <section className="ns-review ns-enter">
      <SectionHeading number="03 / REVIEW" title={copy.reviewTitle} text={copy.reviewIntro}>
        <Pill tone={blockers.length ? "warning" : "green"}>
          {unresolved.length} {copy.openIssues}
        </Pill>
      </SectionHeading>
      <ReportReadiness dossier={dossier} locale={locale} copy={copy} />
      <ReportBusinessRisks dossier={dossier} locale={locale} />
      <div className="ns-issue-list">
        {issues.length ? (
          issues.map((issue) => (
            <article key={issue.id} className={`ns-issue ${issue.resolution ? "is-resolved" : ""}`}>
              <Icon name={issue.resolution ? "verified" : "warning"} size={21} />
              <div>
                <div className="ns-issue-heading">
                  <Pill
                    tone={
                      issue.resolution
                        ? "green"
                        : issue.severity === "material"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {issue.resolution
                      ? copy.resolved
                      : issue.severity === "material"
                        ? copy.material
                        : copy.warning}
                  </Pill>
                </div>
                <p>{localized(issue.message, locale)}</p>
                {(issue.metricIds ?? []).length ? (
                  <div className="ns-issue-metrics">
                    {issue.metricIds.map((id) => (
                      <span key={id}>
                        {localized(
                          dossier.metrics.find((metric) => metric.id === id)?.label ?? id,
                          locale,
                        )}
                      </span>
                    ))}
                  </div>
                ) : null}
                {issue.resolution ? (
                  <p className="ns-resolution">
                    {issue.resolution.reason} · {date(issue.resolution.at, locale)}
                  </p>
                ) : (
                  <div className="ns-issue-actions">
                    {issue.metricIds?.length || issue.sourceIds?.length ? (
                      <Button variant="text" icon="northeast" onClick={() => inspect(issue)}>
                        {copy.openEvidence}
                      </Button>
                    ) : null}
                    {issue.allowAcknowledgment ? (
                      <Button
                        variant="text"
                        icon="check"
                        disabled={Boolean(busy) || Boolean(active)}
                        onClick={() => {
                          setResolving(issue.id);
                          setReason("");
                        }}
                      >
                        {copy.resolve}
                      </Button>
                    ) : null}
                  </div>
                )}
                {resolving === issue.id ? (
                  <form
                    className="ns-resolution-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void controller
                        .resolveIssue({
                          dossierId: dossier.id,
                          revision: dossier.revision,
                          issueId: issue.id,
                          reason,
                        })
                        .catch(() => {});
                    }}
                  >
                    <label htmlFor={`ns-resolve-${issue.id}`}>{copy.resolveHint}</label>
                    <textarea
                      id={`ns-resolve-${issue.id}`}
                      rows="3"
                      required
                      minLength={8}
                      maxLength={1000}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={reason.trim().length < 8 || Boolean(busy)}
                    >
                      {copy.saveCorrection}
                    </Button>
                  </form>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <div className="ns-clean-review">
            <Icon name="verified" size={28} />
            <p>{copy.noIssues}</p>
          </div>
        )}
      </div>
      <form
        className="ns-notes-form"
        onSubmit={(event) => {
          event.preventDefault();
          void controller
            .applyCorrection({
              dossierId: dossier.id,
              revision: dossier.revision,
              changes: [],
              notes,
            })
            .catch(() => {});
        }}
      >
        <div className="ns-section-title">
          <label htmlFor="ns-analyst-notes">{copy.retainedNotes}</label>
          <Pill>{locale === "vi" ? "Góc nhìn bổ sung" : "Additional perspective"}</Pill>
        </div>
        <textarea
          id="ns-analyst-notes"
          rows="5"
          maxLength={12000}
          value={notes}
          placeholder={
            locale === "vi"
              ? "Ghi lại điều cần theo dõi, giả định và góc nhìn của bạn…"
              : "Record your considerations, assumptions and follow-up work…"
          }
          onChange={(event) => setNotes(event.target.value)}
        />
        <div className="ns-notes-footer">
          <p>
            {locale === "vi"
              ? "Ghi chú được lưu trong lịch sử và bản xuất báo cáo."
              : "Notes are kept in history and included in the exported report."}
          </p>
          <Button
            type="submit"
            disabled={notes === (dossier.notes ?? "") || Boolean(busy) || Boolean(active)}
            icon="check"
          >
            {copy.saveCorrection}
          </Button>
        </div>
      </form>
      <details className="ns-optional-confirmation">
        <summary>
          {locale === "vi"
            ? "Ghi nhận xác nhận cá nhân (tùy chọn)"
            : "Record a personal confirmation (optional)"}
        </summary>
        <p>{copy.approvalIntro}</p>
        {dossier.status === "approved" ? (
          <Pill tone="green">{copy.approved}</Pill>
        ) : (
          <Button
            icon="check"
            disabled={
              Boolean(busy) ||
              Boolean(active) ||
              blockers.length > 0 ||
              notes !== (dossier.notes ?? "")
            }
            onClick={() =>
              controller.requestApproval({ dossierId: dossier.id, revision: dossier.revision })
            }
          >
            {copy.approve}
          </Button>
        )}
      </details>
    </section>
  );
}

export function ApprovalDialog({ state, controller, copy }) {
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    setChecked(false);
  }, [state.approvalRequest]);
  const { dossier, locale, approvalRequest } = state;
  return (
    <Dialog
      open={Boolean(approvalRequest)}
      title={copy.approvalTitle}
      closeLabel={copy.close}
      onClose={() => controller.closeApproval()}
    >
      {dossier ? (
        <div className="ns-approval-dialog">
          <span className="ns-approval-emblem">
            <Icon name="shield" size={36} />
          </span>
          <h2>{copy.approvalTitle}</h2>
          <p>{copy.approvalIntro}</p>
          <div className="ns-approval-bound">
            <strong>{companyLabel(dossier.company, locale)}</strong>
            <span>
              {periodLabel(dossier.period, locale)} · {date(dossier.updatedAt, locale, true)}
            </span>
          </div>
          <label className="ns-checkbox">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            <span>{copy.approvalCheck}</span>
          </label>
          <Button
            variant="primary"
            icon="check"
            disabled={!checked || Boolean(state.busy)}
            onClick={() => {
              void controller
                .approveRevision({ ...approvalRequest, intent: "approve_exact_revision" })
                .catch(() => {});
            }}
          >
            {state.busy === "approve" ? copy.working : copy.confirmApproval}
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}

export function HistoryPanel({ state, controller, copy }) {
  const { dossier, locale, busy } = state;
  const history = dossier.history?.length
    ? dossier.history
    : [
        {
          revision: dossier.revision,
          status: dossier.status,
          createdAt: dossier.updatedAt,
          event: dossier.revisionEvent,
        },
      ];
  const events = {
    created: { vi: "Tạo hồ sơ từ nguồn", en: "Created from sources" },
    revised: { vi: "Cập nhật số liệu hoặc ghi chú", en: "Updated values or notes" },
    analyzed: { vi: "Bổ sung phân tích AI", en: "Added AI analysis" },
    refreshed: { vi: "Cập nhật phiên bản nguồn", en: "Updated source version" },
    approved: { vi: "Xác nhận duyệt", en: "Approval confirmed" },
  };
  const active =
    state.job && ["queued", "running", "pending", "started"].includes(state.job.status);
  return (
    <section className="ns-history ns-enter">
      <SectionHeading number="04 / HISTORY" title={copy.historyTitle} text={copy.historyIntro} />
      <ol className="ns-timeline">
        {[...history]
          .sort((a, b) => b.revision - a.revision)
          .map((entry) => (
            <li key={entry.revision}>
              <span className="ns-timeline-marker">
                <Icon name={entry.status === "approved" ? "check" : "history"} size={16} />
              </span>
              <div>
                <div className="ns-timeline-top">
                  <h3>
                    {localized(
                      events[entry.event ?? entry.revisionEvent] ?? entry.event ?? copy.saved,
                      locale,
                    )}
                  </h3>
                  <Pill tone={entry.status === "approved" ? "green" : "neutral"}>
                    {entry.status === "approved" ? copy.approved : copy.saved}
                  </Pill>
                </div>
                <time dateTime={entry.createdAt ?? entry.updatedAt}>
                  {date(entry.createdAt ?? entry.updatedAt, locale, true)}
                </time>
              </div>
              {Number(entry.revision) === Number(dossier.revision) ? (
                <span className="ns-timeline-current">{copy.currentRevision}</span>
              ) : (
                <Button
                  icon="arrow"
                  disabled={Boolean(busy) || Boolean(active)}
                  onClick={() => {
                    void controller
                      .openDossier({ dossierId: dossier.id, revision: entry.revision })
                      .catch(() => {});
                  }}
                >
                  {copy.openRevision}
                </Button>
              )}
            </li>
          ))}
      </ol>
      {(dossier.corrections ?? []).length ? (
        <div className="ns-correction-history">
          <h3>{locale === "vi" ? "Các chỉnh sửa trong hồ sơ" : "Dossier corrections"}</h3>
          {dossier.corrections.map((correction) => (
            <article key={correction.id}>
              <p>
                <strong>
                  {localized(
                    dossier.metrics.find((metric) => metric.id === correction.metricId)?.label ??
                      correction.metricId,
                    locale,
                  )}
                </strong>
              </p>
              <p className="ns-correction-numbers">
                {number(correction.previousValue, locale, 12)} <Icon name="arrow" size={15} />{" "}
                {number(correction.value, locale, 12)}
              </p>
              <p>{correction.reason}</p>
              <small>{date(correction.at, locale, true)}</small>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
