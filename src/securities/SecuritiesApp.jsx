import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { LocaleFlag, localeName } from "../components/LocaleFlag.jsx";
import { securitiesMetadata } from "../../shared/securities/metadata.js";
import {
  SECURITIES_CANONICAL_URL,
  securitiesArchitectureHref,
} from "../../shared/securities/routes.js";
import { createSecuritiesController } from "./controller.js";
import { securitiesCopy } from "./copy.js";
import { PRODUCT_NAME, readInitialLocale } from "./format.js";
import { useSecuritiesPageMetadata } from "./use-page-metadata.js";
import { ResearchLibrary } from "./ResearchLibrary.jsx";
import { registerSecuritiesWebMcp } from "./webmcp.js";
import { Dialog, ErrorNotice, Icon, JobProgress } from "./ui.jsx";
import { StartWorkspace } from "./StartWorkspace.jsx";
import { ScopeConfirmation } from "./ScopeConfirmation.jsx";
import { DossierWorkspace } from "./DossierWorkspace.jsx";
import { EvidenceDrawer } from "./EvidenceDrawer.jsx";
import { ApprovalDialog } from "./ReviewPanel.jsx";
import { ChatPanel } from "./ChatPanel.jsx";
import "./securities.css";

export function SecuritiesApp() {
  const [controller] = useState(() => createSecuritiesController({ locale: readInitialLocale() }));
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [mobileNav, setMobileNav] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const previousView = useRef({ view: state.view, dossierId: state.dossier?.id });
  const copy = securitiesCopy[state.locale];
  useSecuritiesPageMetadata(
    state.locale,
    securitiesMetadata[state.locale],
    SECURITIES_CANONICAL_URL,
  );
  useEffect(() => {
    void controller.initialize();
  }, [controller]);
  useLayoutEffect(() => {
    controller.markRendered(state.renderVersion);
  }, [controller, state.renderVersion]);
  useLayoutEffect(() => {
    const changed =
      previousView.current.view !== state.view ||
      previousView.current.dossierId !== state.dossier?.id;
    if (changed) {
      const target =
        state.view === "dossier"
          ? "ns-dossier-title"
          : state.view === "scope"
            ? "ns-scope-title"
            : "ns-title";
      document.getElementById(target)?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    previousView.current = {
      view: state.view,
      dossierId: state.dossier?.id,
    };
  }, [state.view, state.dossier?.id]);
  useLayoutEffect(() => {
    const registration = registerSecuritiesWebMcp(controller);
    return () => registration.cleanup();
  }, [controller]);
  useEffect(() => {
    const handlePop = () => {
      controller.setLocale(readInitialLocale());
      void controller.initialize({ force: true });
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, [controller]);
  useEffect(() => {
    if (state.approvalRequest || state.view !== "dossier") setChatOpen(false);
  }, [state.approvalRequest, state.view]);

  const notices = {
    sourcesUpdated:
      state.locale === "vi" ? "Đã cập nhật danh mục nguồn." : "Source catalog updated.",
    sourcesPartial:
      state.locale === "vi"
        ? "Một số tài liệu chưa đọc được. Phần đã xử lý được giữ lại."
        : "Some documents could not be read. Completed work is retained.",
  };
  const opening = !state.catalog && !state.error;
  return (
    <div className="ns-app" data-securities-render-version={state.renderVersion}>
      <a className="skip-link" href="#ns-main">
        {copy.skip}
      </a>
      <header className="ns-header">
        <div className="ns-header-brand">
          <button
            type="button"
            className="ns-icon-button ns-mobile-menu"
            aria-label={copy.library}
            onClick={() => setMobileNav(true)}
          >
            <Icon name="menu" size={22} />
          </button>
          <a
            className="ns-brand"
            href={`/securities?lang=${state.locale}`}
            aria-label={PRODUCT_NAME}
          >
            <span className="ns-brand-mark" aria-hidden="true">
              n<span>.</span>
            </span>
            <span>{PRODUCT_NAME}</span>
          </a>
        </div>
        <div className="ns-header-actions">
          <a className="ns-architecture-link" href={securitiesArchitectureHref(state.locale)}>
            {copy.insideProduct}
            <Icon name="arrow" size={16} />
          </a>
          <nav className="ns-locale-switch" aria-label={copy.language}>
            {["en", "vi"].map((locale) => (
              <button
                type="button"
                key={locale}
                lang={locale}
                aria-pressed={state.locale === locale}
                aria-label={localeName(locale)}
                title={localeName(locale)}
                onClick={() => controller.setLocale(locale)}
              >
                <LocaleFlag locale={locale} />
              </button>
            ))}
          </nav>
          <a className="ns-portfolio-link" href={`/${state.locale}`} aria-label={copy.portfolio}>
            <span>{copy.portfolio}</span>
            <Icon name="northeast" size={17} />
          </a>
        </div>
      </header>
      <div className="ns-layout">
        <aside className="ns-sidebar">
          <ResearchLibrary state={state} controller={controller} copy={copy} />
        </aside>
        <main
          className="ns-main"
          id="ns-main"
          tabIndex="-1"
          aria-busy={opening || state.busy === "loading"}
        >
          <div className="ns-main-inner">
            {opening || state.busy === "loading" ? (
              <div className="ns-loading-line" role="status">
                <span className="ns-working-mark" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {copy.loading}
              </div>
            ) : null}
            <ErrorNotice
              error={state.error}
              copy={copy}
              locale={state.locale}
              onClose={() => controller.dismissError()}
              onRetry={
                state.catalog
                  ? state.error?.retry === "job"
                    ? () => {
                        void controller.retryJob().catch(() => {});
                      }
                    : state.error?.details?.resumeAction === "startAnalysis"
                      ? () => {
                          void controller
                            .startAnalysis({
                              dossierId: state.error.details.dossierId,
                              revision: state.error.details.revision,
                            })
                            .catch(() => {});
                        }
                      : undefined
                  : () => controller.initialize({ force: true })
              }
            />
            {state.notice ? (
              <div className="ns-notice ns-notice--success" role="status">
                <Icon name="check" size={18} />
                <p>{notices[state.notice] ?? copy[state.notice] ?? copy.saved}</p>
                <button
                  type="button"
                  className="ns-icon-button"
                  aria-label={copy.close}
                  onClick={() => controller.dismissNotice()}
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
            ) : null}
            {state.job && ["sources", "refresh"].includes(state.job.kind) ? (
              <JobProgress
                job={state.job}
                busy={state.busy}
                copy={copy}
                locale={state.locale}
                onCancel={() => {
                  void controller.cancelAnalysis().catch(() => {});
                }}
              />
            ) : null}
            {state.view === "start" && !opening ? (
              <StartWorkspace state={state} controller={controller} copy={copy} />
            ) : null}
            {state.view === "scope" ? (
              <ScopeConfirmation state={state} controller={controller} copy={copy} />
            ) : null}
            {state.view === "dossier" && state.dossier ? (
              <DossierWorkspace
                state={state}
                controller={controller}
                copy={copy}
                onChat={() => setChatOpen(true)}
              />
            ) : null}
          </div>
          <footer className="ns-product-footer">
            <span>{copy.independent}</span>
          </footer>
        </main>
      </div>
      <Dialog
        open={mobileNav}
        title={copy.library}
        onClose={() => setMobileNav(false)}
        closeLabel={copy.close}
        drawer
        className="ns-mobile-library"
      >
        <ResearchLibrary
          state={state}
          controller={controller}
          copy={copy}
          onNavigate={() => setMobileNav(false)}
        />
      </Dialog>
      <EvidenceDrawer state={state} controller={controller} copy={copy} />
      <ApprovalDialog state={state} controller={controller} copy={copy} />
      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        state={state}
        controller={controller}
        copy={copy}
      />
    </div>
  );
}
