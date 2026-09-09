import { useEffect, useState } from "react";
import { Button, Icon, Pill } from "./ui.jsx";
import { ModelProcess } from "./ModelProcess.jsx";
import { hasStructuredSecuritiesReport } from "../../shared/securities/report-contract.js";
import {
  dossierMetrics,
  localized,
  localSourceUrl,
  percent,
  periodLabel,
  reportFigure,
  safeSourceUrl,
  sourceLocation,
} from "./format.js";

export function ClaimKind({ kind, copy, locale }) {
  const label =
    {
      calculated: copy.calculated,
      fact: copy.sourceFact,
      source_fact: copy.sourceFact,
      observation: copy.sourceFact,
      inference: copy.inference,
      hypothesis: copy.hypothesis,
      analyst_opinion: locale === "vi" ? "Nhận định phân tích" : "Analyst opinion",
    }[kind] ?? copy.inference;
  return <Pill tone={kind === "hypothesis" ? "warning" : "neutral"}>{label}</Pill>;
}

export function ClaimEvidence({ claim, dossier, locale, copy, controller }) {
  const findSource = (id, version) =>
    (dossier.sources ?? []).find(
      (source) =>
        source.id === id && (version === undefined || String(source.version) === String(version)),
    );
  const numeric = new Map();
  for (const reference of claim.numericOrigins ?? []) {
    const metric = dossierMetrics(dossier).find((item) => item.id === reference.metricId);
    const point = metric?.[reference.side];
    const source = findSource(reference.id, reference.version);
    if (
      ["current", "comparison"].includes(reference.side) &&
      source &&
      point?.sourceId === source.id &&
      String(point.sourceVersion) === String(source.version)
    ) {
      numeric.set(`${metric.id}:${reference.side}`, { reference, metric, source });
    }
  }
  const quotes = (claim.evidenceQuotes ?? []).flatMap((quote) => {
    const source = findSource(quote.sourceId, quote.sourceVersion);
    if (!source) return [];
    const page =
      Number.isSafeInteger(quote.locator?.page) && quote.locator.page > 0
        ? quote.locator.page
        : null;
    const original = localSourceUrl(source);
    return [
      {
        quote,
        source,
        page,
        href: original
          ? `${original}${page ? `#page=${page}&view=FitH` : ""}`
          : safeSourceUrl(source, page ? { page } : undefined),
      },
    ];
  });
  const quotedPages = [
    ...new Map(
      quotes.map((entry) => [
        `${entry.source.id}:${entry.source.version}:${entry.page ?? "document"}`,
        entry,
      ]),
    ).values(),
  ];
  const coveredSources = new Set(
    [...numeric.values()]
      .map((entry) => entry.source.id)
      .concat(quotes.map((entry) => entry.source.id)),
  );
  const remainingSources = [...new Set(claim.sourceIds ?? [])]
    .filter((id) => !coveredSources.has(id))
    .map((id) => findSource(id))
    .filter(Boolean);
  const open = (selection) => {
    controller.getEvidence({ dossierId: dossier.id, revision: dossier.revision, ...selection });
  };
  const sourceLabel = (source) => `${copy.source} ${(dossier.sources ?? []).indexOf(source) + 1}`;
  return (
    <>
      <div className="ns-claim-sources">
        {[...numeric.values()].map(({ reference, metric, source }) => (
          <button
            type="button"
            key={`${metric.id}:${reference.side}`}
            onClick={() =>
              open({
                sourceId: source.id,
                sourceVersion: source.version,
                metricId: metric.id,
                period: reference.side,
              })
            }
            aria-label={`${copy.openEvidence}: ${localized(metric.label, locale)}, ${periodLabel(reference.side === "current" ? dossier.period : dossier.comparisonPeriod, locale)}`}
            title={sourceLocation(reference.locator, locale)}
          >
            <Icon name="file" size={13} />
            <span>
              {localized(metric.label, locale)} ·{" "}
              {periodLabel(
                reference.side === "current" ? dossier.period : dossier.comparisonPeriod,
                locale,
              )}
            </span>
            <Icon name="northeast" size={12} />
          </button>
        ))}
        {quotedPages.map(({ source, quote, page, href }) =>
          href ? (
            <a
              key={`${source.id}:${source.version}:${page ?? "document"}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${copy.openOriginal}: ${localized(source.title, locale)}, ${sourceLocation(quote.locator, locale)}`}
            >
              <Icon name="file" size={13} />
              <span>
                {sourceLabel(source)} · {sourceLocation(quote.locator, locale)}
              </span>
              <Icon name="northeast" size={12} />
            </a>
          ) : null,
        )}
        {remainingSources.map((source) => (
          <button
            type="button"
            key={`${source.id}:${source.version}`}
            aria-label={`${copy.openEvidence}: ${localized(source.title, locale)}`}
            onClick={() => open({ sourceId: source.id, sourceVersion: source.version })}
          >
            <Icon name="file" size={13} />
            <span>
              {sourceLabel(source)} · {sourceLocation(null, locale)}
            </span>
            <Icon name="northeast" size={12} />
          </button>
        ))}
      </div>
      {quotes.length ? (
        <details className="ns-claim-quotes">
          <summary>{locale === "vi" ? "Trích dẫn từ nguồn" : "Source excerpts"}</summary>
          {quotes.map(({ quote, source }, index) => (
            <blockquote key={`${source.id}:${index}`}>
              <p>{quote.quote}</p>
              <cite>
                {localized(source.title, locale)} · {sourceLocation(quote.locator, locale)}
              </cite>
            </blockquote>
          ))}
        </details>
      ) : null}
    </>
  );
}

export function AnalysisNotes({ analysis, locale }) {
  return (
    <>
      {(analysis?.questions ?? []).length ? (
        <div className="ns-open-questions">
          <h3>
            <Icon name="search" size={20} />
            {locale === "vi" ? "Câu hỏi cần đọc tiếp" : "Questions for further reading"}
          </h3>
          <ol>
            {analysis.questions.map((question, index) => (
              <li key={index}>
                {localized(question.text ?? question.question ?? question, locale)}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {(analysis?.limitations ?? []).length ? (
        <div className="ns-analysis-limitations">
          <h3>{locale === "vi" ? "Giới hạn của phân tích" : "Analysis limitations"}</h3>
          {analysis.limitations.map((limitation, index) => (
            <p key={index}>{localized(limitation.text ?? limitation, locale)}</p>
          ))}
        </div>
      ) : null}
    </>
  );
}

export function ReportReadiness({ dossier, copy, locale, onChecks }) {
  const readiness = dossier.reportReadiness;
  const status = readiness?.state ?? "unavailable";
  const limitations = (readiness?.reasons ?? []).filter(
    (reason) => reason.category !== "business_risk" && reason.affectsReadiness !== false,
  );
  const priority = [
    "no_supported_report_content",
    "ai_validation_failed",
    "analysis_context_mismatch",
    "ai_answer_unavailable",
    "historical_analysis",
    "research_gap",
  ];
  const primary =
    priority.map((code) => limitations.find((reason) => reason.code === code)).find(Boolean) ??
    limitations[0];
  const preview =
    (copy.readinessShort[primary?.code] ?? localized(primary?.message, locale)) ||
    copy.readinessUnavailable;
  if (status === "ready" || status === "limited") return null;
  return (
    <aside className="ns-report-readiness" data-readiness={status} aria-label={copy.readinessTitle}>
      <details>
        <summary>
          <Icon name="warning" size={17} />
          <span>
            <strong>{copy.reportUnavailable}</strong>
            <span className="ns-readiness-preview">{preview}</span>
          </span>
          <Icon name="plus" size={15} />
        </summary>
        <div className="ns-readiness-details">
          {limitations.length ? (
            <ul>
              {limitations.map((reason, index) => (
                <li key={`${reason.code}:${index}`}>{localized(reason.message, locale)}</li>
              ))}
            </ul>
          ) : null}
          {onChecks ? (
            <button type="button" className="ns-text-button" onClick={onChecks}>
              {copy.viewChecks}
              <Icon name="arrow" size={14} />
            </button>
          ) : null}
        </div>
      </details>
    </aside>
  );
}

export function ReportBusinessRisks({ dossier, locale }) {
  const risks = (dossier.reportReadiness?.reasons ?? []).filter(
    (reason) => reason.category === "business_risk",
  );
  return risks.length ? (
    <aside className="ns-business-risks">
      <Icon name="book" size={18} />
      <div>
        <strong>
          {locale === "vi" ? "Điểm kinh doanh cần theo dõi" : "Business points to watch"}
        </strong>
        <ul>
          {risks.map((risk, index) => (
            <li key={`${risk.code}:${index}`}>{localized(risk.message, locale)}</li>
          ))}
        </ul>
      </div>
    </aside>
  ) : null;
}

function ReportClaim({ claim, dossier, locale, copy, controller }) {
  const evidenceCount = new Set(claim.sourceIds ?? []).size;
  return (
    <article className="ns-report-claim">
      {["analyst_opinion", "hypothesis", "inference"].includes(claim.kind) ? (
        <span className="ns-report-interpretation">
          {claim.kind === "hypothesis" ? copy.hypothesis : copy.inference}
        </span>
      ) : null}
      <p>{localized(claim.text ?? claim.statement, locale)}</p>
      <details className="ns-report-evidence">
        <summary>
          <Icon name="file" size={14} />
          {copy.viewSources}
          {evidenceCount ? <span>{evidenceCount}</span> : null}
        </summary>
        <div>
          <ClaimKind kind={claim.kind} copy={copy} locale={locale} />
          <ClaimEvidence
            claim={claim}
            dossier={dossier}
            locale={locale}
            copy={copy}
            controller={controller}
          />
        </div>
      </details>
    </article>
  );
}

function ReportFigures({ dossier, locale, copy, controller }) {
  const metrics = dossier.reportProjection?.metrics ?? [];
  const preferredIds =
    dossier.company?.sectorId === "banking"
      ? [
          "net_interest_income",
          "profit_before_tax",
          "credit_loss_provision",
          "operating_profit_before_provision",
          "profit_after_tax",
          "net_fee_income",
        ]
      : [
          "revenue",
          "profit_after_tax",
          "operating_cash_flow",
          "profit_parent",
          "profit_before_tax",
        ];
  const preferred = preferredIds
    .map((id) =>
      metrics.find(
        (metric) =>
          metric.id === id && metric.current?.value !== null && metric.current?.value !== undefined,
      ),
    )
    .filter(Boolean);
  const selected = preferred.length ? preferred.slice(0, 3) : metrics.slice(0, 3);
  if (!selected.length) return null;
  return (
    <section className="ns-report-figures" aria-label={copy.keyFigures}>
      <div className="ns-report-figure-list">
        {selected.map((metric) => {
          const figure = reportFigure(metric, locale);
          const comparable = metric.calculation?.relativeChangePct?.status === "ok";
          return (
            <button
              type="button"
              key={metric.id}
              disabled={!metric.current?.sourceId}
              onClick={() =>
                controller.getEvidence({
                  dossierId: dossier.id,
                  revision: dossier.revision,
                  sourceId: metric.current?.sourceId,
                  sourceVersion: metric.current?.sourceVersion,
                  metricId: metric.id,
                  period: "current",
                })
              }
              aria-label={`${copy.openEvidence}: ${localized(metric.label, locale)}`}
            >
              <span>
                {localized(metric.label, locale)}
                <Icon name="northeast" size={15} />
              </span>
              <strong>
                {figure.value}
                <small>{figure.unit}</small>
              </strong>
              <span className="ns-report-figure-change">
                {comparable ? (
                  <>
                    {percent(metric.calculation.relativeChangePct.value, locale)}{" "}
                    <small>{locale === "vi" ? "so với kỳ so sánh" : "vs. comparison period"}</small>
                  </>
                ) : (
                  <small>{copy.growthComparisonUnavailable}</small>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ReportFollowup({ state, controller, copy, onChat }) {
  const [question, setQuestion] = useState("");
  const { dossier, busy, job, catalog } = state;
  const enabled = catalog?.runtime?.model?.enabled ?? catalog?.model?.enabled ?? false;
  const active = job && ["queued", "running", "pending", "started"].includes(job.status);
  useEffect(() => {
    setQuestion("");
  }, [dossier.id, dossier.revision]);
  const send = async (event) => {
    event.preventDefault();
    if (!question.trim()) return;
    try {
      await controller.askFollowup({
        dossierId: dossier.id,
        revision: dossier.revision,
        question: question.trim(),
      });
      setQuestion("");
      onChat?.();
    } catch {
      /* The question stays available beside the visible error. */
    }
  };
  return (
    <section className="ns-report-followup" aria-labelledby="ns-report-followup-title">
      <div>
        <h3 id="ns-report-followup-title">{copy.askMoreTitle}</h3>
        <p>{copy.askMoreText}</p>
      </div>
      <form onSubmit={send}>
        <label className="sr-only" htmlFor="ns-report-question">
          {copy.ask}
        </label>
        <textarea
          id="ns-report-question"
          rows="2"
          maxLength={2000}
          value={question}
          placeholder={copy.chatPlaceholder}
          disabled={!enabled || Boolean(busy) || Boolean(active)}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          icon="send"
          disabled={!question.trim() || !enabled || Boolean(busy) || Boolean(active)}
        >
          {busy === "chat" ? copy.working : copy.send}
        </Button>
      </form>
      <div className="ns-report-followup-examples">
        {copy.askExamples.map((example) => (
          <button
            type="button"
            key={example}
            onClick={() => {
              setQuestion(example);
              document.getElementById("ns-report-question")?.focus();
            }}
            disabled={!enabled || Boolean(active)}
          >
            {example}
          </button>
        ))}
      </div>
      {(state.chat ?? []).length ? (
        <Button variant="text" icon="quote" onClick={onChat}>
          {copy.showConversation}
        </Button>
      ) : null}
      {!enabled ? <p className="ns-fineprint">{copy.modelUnavailable}</p> : null}
    </section>
  );
}

export function AnalysisPanel({ state, controller, copy, onChat }) {
  const { dossier, locale, busy, job, catalog } = state;
  const analysis = dossier.reportProjection?.analysis;
  const fromModel = analysis?.origin === "model";
  const isReport = fromModel && hasStructuredSecuritiesReport(analysis);
  const enabled = catalog?.runtime?.model?.enabled ?? catalog?.model?.enabled ?? false;
  const active = job && ["queued", "running", "pending", "started"].includes(job.status);
  const start = () => {
    void controller
      .startAnalysis({ dossierId: dossier.id, revision: dossier.revision })
      .catch(() => {});
  };
  const claims = analysis?.claims ?? [];
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const summaryIds = [...new Set(analysis?.report?.summaryClaimIds ?? [])].filter((id) =>
    byId.has(id),
  );
  const displayed = new Set(summaryIds);
  const sections = (analysis?.report?.sections ?? [])
    .map((section) => {
      const sectionClaims = section.claimIds
        .filter((id) => byId.has(id) && !displayed.has(id))
        .map((id) => {
          displayed.add(id);
          return byId.get(id);
        });
      return { ...section, claims: sectionClaims };
    })
    .filter((section) => section.claims.length);
  const remaining = claims.filter((claim) => !displayed.has(claim.id));
  const renderClaim = (claim) => (
    <ReportClaim
      key={claim.id}
      claim={claim}
      dossier={dossier}
      locale={locale}
      copy={copy}
      controller={controller}
    />
  );
  const process = (
    <ModelProcess
      job={job?.kind === "analysis" ? job : null}
      researchStep={state.researchStep}
      dossier={dossier}
      analysis={analysis}
      kind="analysis"
      locale={locale}
      onCancel={
        active && job?.kind === "analysis"
          ? () => {
              void controller.cancelAnalysis().catch(() => {});
            }
          : undefined
      }
    />
  );
  const questionContext = dossier.query ? (
    <div className="ns-question-process">
      <details className="ns-report-question">
        <summary>
          <Icon name="quote" size={15} />
          {copy.questionBeingAnswered}
          <Icon name="plus" size={14} />
        </summary>
        <p>{dossier.query}</p>
      </details>
      {process}
    </div>
  ) : null;

  return (
    <section className="ns-analysis ns-report ns-enter">
      {!dossier.query ? process : null}
      <ReportReadiness
        dossier={dossier}
        locale={locale}
        copy={copy}
        onChecks={() => controller.setTab("review")}
      />
      {isReport ? (
        <>
          <header className="ns-report-heading">
            <h2>{localized(analysis.report?.headline, locale) || copy.analysisTitle}</h2>
          </header>
          {summaryIds.length ? (
            <section className="ns-report-summary" aria-label={copy.summary}>
              <h3>{copy.summary}</h3>
              {summaryIds.map((id) => renderClaim(byId.get(id)))}
            </section>
          ) : null}
          {questionContext}
          <ReportBusinessRisks dossier={dossier} locale={locale} />
          <ReportFigures dossier={dossier} locale={locale} copy={copy} controller={controller} />
          <div className="ns-report-sections">
            {sections.map((section) => (
              <details
                className="ns-report-section"
                key={section.id}
                open={summaryIds.length === 0 || undefined}
              >
                <summary>
                  <h3>{copy.reportSections[section.id] ?? copy.analysisTitle}</h3>
                  <Icon name="plus" size={18} />
                </summary>
                <div>{section.claims.map(renderClaim)}</div>
              </details>
            ))}
            {remaining.length ? (
              <details className="ns-report-section" open={summaryIds.length === 0 || undefined}>
                <summary>
                  <h3>{copy.analysisTitle}</h3>
                  <Icon name="plus" size={18} />
                </summary>
                <div>{remaining.map(renderClaim)}</div>
              </details>
            ) : null}
          </div>
          <AnalysisNotes analysis={{ questions: analysis.questions }} locale={locale} />
        </>
      ) : (
        <>
          <div className="ns-analysis-empty">
            <span className="ns-analysis-mark">
              <Icon name="quote" size={28} />
            </span>
            <h2>{fromModel ? copy.historicalAnalysis : copy.noAnalysisTitle}</h2>
            <p>{fromModel ? copy.historicalAnalysisNote : copy.noAnalysisText}</p>
            <Button
              variant="primary"
              icon="arrow"
              disabled={!enabled || Boolean(busy) || Boolean(active)}
              onClick={start}
            >
              {active && job.kind === "analysis" ? copy.analyzing : copy.analyze}
            </Button>
            {!enabled ? <p className="ns-fineprint">{copy.modelUnavailable}</p> : null}
          </div>
          {questionContext}
          <ReportBusinessRisks dossier={dossier} locale={locale} />
          <ReportFigures dossier={dossier} locale={locale} copy={copy} controller={controller} />
          {fromModel ? (
            <details className="ns-report-historical">
              <summary>{copy.historicalAnalysis}</summary>
              {claims.map(renderClaim)}
              <AnalysisNotes analysis={analysis} locale={locale} />
            </details>
          ) : null}
        </>
      )}
      {dossier.notes?.trim() ? (
        <details className="ns-report-notes">
          <summary>
            <Icon name="edit" size={15} />
            {copy.retainedNotes}
          </summary>
          <p>{dossier.notes}</p>
          {dossier.analysisLineage?.reason === "analyst_notes_only" ? (
            <small>
              {locale === "vi"
                ? "Phân tích đã lưu được giữ nguyên khi thêm ghi chú."
                : "The saved analysis is preserved when notes are added."}
            </small>
          ) : null}
          <Button variant="text" icon="edit" onClick={() => controller.setTab("review")}>
            {copy.review}
          </Button>
        </details>
      ) : null}
      {isReport ? (
        <details className="ns-report-method">
          <summary>
            <Icon name="shield" size={15} />
            {copy.reportDetails}
          </summary>
          <div>
            <p>{copy.reviewAnalysis}</p>
            {(analysis.research?.steps ?? []).length ? (
              <ol>
                {analysis.research.steps.map((step, index) => {
                  const source = dossier.sources?.find(
                    (item) =>
                      item.id === step.sourceId &&
                      String(item.version) === String(step.sourceVersion),
                  );
                  const status = {
                    read: { vi: "Đã đọc", en: "Read" },
                    empty: { vi: "Không có nội dung phù hợp", en: "No matching content" },
                    unavailable: { vi: "Chưa đọc được", en: "Unavailable" },
                    repeated: { vi: "Yêu cầu đã đọc trước đó", en: "Previously requested" },
                  }[step.status];
                  return (
                    <li key={step.id ?? index}>
                      <strong>{localized(source?.title ?? step.sourceId, locale)}</strong>
                      <span>
                        {localized(status ?? step.status, locale)}
                        {step.pages?.length
                          ? ` · ${locale === "vi" ? "Phạm vi trang yêu cầu" : "Requested pages"}: ${step.pages.join(", ")}`
                          : ""}
                      </span>
                      {step.query ? (
                        <small>
                          {locale === "vi" ? "Nội dung tìm" : "Search"}: {step.query}
                        </small>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : null}
            <AnalysisNotes analysis={{ limitations: analysis.limitations }} locale={locale} />
            {analysis.validation?.semantic?.method ? (
              <p className="ns-fineprint">
                {locale === "vi"
                  ? "Tính nhất quán của diễn giải được rà lại bởi cùng model; đây không phải đánh giá độc lập."
                  : "The same model reviewed narrative consistency; this is not an independent assessment."}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
      <ReportFollowup state={state} controller={controller} copy={copy} onChat={onChat} />
    </section>
  );
}
