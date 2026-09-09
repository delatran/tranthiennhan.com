import { Button, Icon, Pill } from "./ui.jsx";
import { companyLabel, date, periodLabel, scopeLabel, unresolvedIssues } from "./format.js";
import { FinancialTable } from "./FinancialTable.jsx";
import { AnalysisPanel } from "./AnalysisPanel.jsx";
import { HistoryPanel, ReviewPanel } from "./ReviewPanel.jsx";
import { MarketWorkspace } from "./MarketWorkspace.jsx";

export function DossierWorkspace({ state, controller, copy, onChat }) {
  const { dossier, locale, busy, activeTab, job } = state;
  const active = job && ["queued", "running", "pending", "started"].includes(job.status);
  const issues = unresolvedIssues(dossier);
  const tabs = ["analysis", "financials", "review", "history"];
  const readiness =
    dossier.reportReadiness?.revision === dossier.revision ? dossier.reportReadiness : null;
  const showReportStatus = readiness?.state !== "limited";
  const reportStatus = readiness?.state === "ready" ? copy.reportReady : copy.reportUnavailable;
  const bound = { dossierId: dossier.id, revision: dossier.revision };
  const act = (promise) => {
    void promise.catch(() => {});
  };
  const closeExportMenu = (menu) => {
    if (menu) {
      menu.open = false;
      menu.querySelector("summary")?.focus();
    }
  };
  const download = (format, menu) =>
    act(controller.exportRevision({ ...bound, format }).then(() => closeExportMenu(menu)));
  const handleExportKey = (event) => {
    if (event.key === "Escape" && event.currentTarget.open) {
      event.preventDefault();
      event.stopPropagation();
      closeExportMenu(event.currentTarget);
    }
  };
  const handleTabKey = (event, index) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : delta
            ? (index + delta + tabs.length) % tabs.length
            : null;
    if (next !== null) {
      event.preventDefault();
      controller.setTab(tabs[next]);
      document.getElementById(`ns-tab-${tabs[next]}`)?.focus();
    }
  };
  const freshness = dossier.freshness;
  const freshnessFailure = ["check_failed", "failed", "partial"].includes(freshness?.status);
  return (
    <div className="ns-dossier ns-enter">
      <header className="ns-dossier-header">
        <div>
          <div className="ns-dossier-title">
            <h1 id="ns-dossier-title" tabIndex="-1">
              {dossier.company.ticker ?? dossier.company.id}
            </h1>
            {showReportStatus ? (
              <Pill tone={readiness?.state === "ready" ? "green" : "neutral"} dot>
                {reportStatus}
              </Pill>
            ) : null}
          </div>
          <p className="ns-dossier-company">{companyLabel(dossier.company, locale)}</p>
        </div>
        <div className="ns-dossier-primary-actions">
          <Button icon="quote" onClick={onChat}>
            {copy.ask}
          </Button>
          <details className="ns-export-menu" onKeyDown={handleExportKey}>
            <summary className="ns-button ns-button--primary">
              <span>{copy.export}</span>
              <Icon name="download" size={17} />
            </summary>
            <div>
              <Button
                disabled={Boolean(busy) || !readiness?.canExport}
                onClick={(event) => download("md", event.currentTarget.closest("details"))}
              >
                {copy.exportNotes} · Markdown
              </Button>
              <Button
                disabled={Boolean(busy) || !readiness?.canExport}
                onClick={(event) => download("xlsx", event.currentTarget.closest("details"))}
              >
                {copy.exportXlsx}
              </Button>
              {!readiness?.canExport ? <p>{copy.readinessUnavailable}</p> : null}
            </div>
          </details>
        </div>
      </header>
      <details className="ns-source-status">
        <summary>
          <Icon name={freshnessFailure ? "warning" : "book"} size={15} />
          <span className="ns-source-context">
            <span>
              {periodLabel(dossier.period, locale)} <span className="ns-scope-versus">vs.</span>{" "}
              {periodLabel(dossier.comparisonPeriod, locale)}
            </span>
            <small>
              {scopeLabel(dossier.period.scope, locale)} · {dossier.sources?.length ?? 0}{" "}
              {locale === "en" && dossier.sources?.length === 1
                ? "source"
                : copy.sources.toLowerCase()}
            </small>
          </span>
          <Icon name="plus" size={14} />
        </summary>
        <div className="ns-source-context-details">
          <div className="ns-dossier-scope">
            <div>
              <Icon name="file" size={17} />
              <span>{periodLabel(dossier.period, locale)}</span>
              <span className="ns-scope-versus">vs.</span>
              <span>{periodLabel(dossier.comparisonPeriod, locale)}</span>
              <span className="ns-scope-divider" />
              {scopeLabel(dossier.period.scope, locale)}
            </div>
            <Button
              variant="text"
              disabled={Boolean(busy) || Boolean(active)}
              onClick={() =>
                act(
                  controller.configureScope({
                    companyId: dossier.company.id,
                    periodId: dossier.period.id,
                  }),
                )
              }
            >
              {copy.changeScope}
            </Button>
          </div>
          <div className={`ns-freshness ${freshnessFailure ? "ns-freshness--warning" : ""}`}>
            <Icon name={freshnessFailure ? "warning" : "history"} size={16} />
            <p>
              {freshnessFailure
                ? locale === "vi"
                  ? "Kiểm tra cập nhật chưa thành công đầy đủ. Đang dùng bản nguồn đã lưu."
                  : "The update check did not fully succeed. Using the saved source snapshot."
                : freshness?.status === "revision_detected"
                  ? locale === "vi"
                    ? "Phát hiện phiên bản nguồn mới. Các số liệu bị ảnh hưởng cần kiểm chứng lại."
                    : "A revised source was detected. Affected values require verification."
                  : freshness?.status === "new_documents_discovered"
                    ? locale === "vi"
                      ? "Có tài liệu mới được phát hiện. Tài liệu cần được kiểm chứng trước khi dùng cho hồ sơ."
                      : "New documents were discovered and require verification before use."
                    : copy.frozen}
              <span>
                {copy.fetched}:{" "}
                {date(freshness?.cachedAt ?? dossier.sources?.[0]?.fetchedAt, locale)}
                {freshness?.checkedAt
                  ? ` · ${locale === "vi" ? "Kiểm tra" : "Checked"}: ${date(freshness.checkedAt, locale, true)}`
                  : ""}
              </span>
            </p>
            <Button
              variant="text"
              icon="retry"
              disabled={Boolean(busy) || Boolean(active)}
              onClick={() => act(controller.refreshDossier(bound))}
            >
              {copy.refreshSources}
            </Button>
          </div>
        </div>
      </details>
      <nav className="ns-tabs" role="tablist" aria-label={copy.researchDossier}>
        {tabs.map((tab, index) => (
          <button
            type="button"
            key={tab}
            id={`ns-tab-${tab}`}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`ns-panel-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            onClick={() => controller.setTab(tab)}
            onKeyDown={(event) => handleTabKey(event, index)}
          >
            <span className="ns-tab-number">0{index + 1}</span>
            {copy[tab]}
            {tab === "review" && issues.length > 0 ? (
              <span className="ns-tab-count">{issues.length}</span>
            ) : null}
          </button>
        ))}
      </nav>
      <div
        className="ns-tab-panel"
        role="tabpanel"
        id={`ns-panel-${activeTab}`}
        aria-labelledby={`ns-tab-${activeTab}`}
        tabIndex="0"
      >
        {activeTab === "financials" ? (
          <FinancialTable dossier={dossier} locale={locale} copy={copy} controller={controller} />
        ) : null}
        {activeTab === "analysis" ? (
          <AnalysisPanel state={state} controller={controller} copy={copy} onChat={onChat} />
        ) : null}
        {activeTab === "review" ? (
          <ReviewPanel state={state} controller={controller} copy={copy} />
        ) : null}
        {activeTab === "history" ? (
          <HistoryPanel state={state} controller={controller} copy={copy} />
        ) : null}
      </div>
      <MarketWorkspace
        key={`${dossier.company.exchange ?? ""}:${dossier.company.ticker ?? dossier.company.id}`}
        defaultSymbol={dossier.company.ticker ?? dossier.company.id}
        defaultExchange={dossier.company.exchange}
        locale={locale}
        modelEnabled={
          state.catalog?.runtime?.model?.enabled ?? state.catalog?.model?.enabled ?? false
        }
      />
      <footer className="ns-dossier-footer">
        <span>
          <Icon name="check" size={14} />
          {copy.saved} {date(dossier.updatedAt, locale, true)}
        </span>
      </footer>
    </div>
  );
}
